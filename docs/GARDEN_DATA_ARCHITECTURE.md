# 菜园子数据架构说明

## 背景

菜园子系统涉及多个窗口（主窗口 `index.html` 和菜园子窗口 `garden.html`）的并发访问，同时还有计时器每分钟触发的作物生长更新。在 v2.4.0 之前，由于缺乏并发保护机制，存在数据竞争问题，导致：

- 作物数据丢失
- 进度被错误覆盖
- 专注模式下重置时枯萎弹窗显示不正确

## 架构设计

### 原子操作 + 互斥锁

v2.4.0 重构后，所有菜园子数据操作都采用**原子操作**模式：

```
读取最新数据 → 执行修改 → 写回文件 → 返回结果
```

每次操作都通过**互斥锁**保护，确保同一时间只有一个操作能访问数据文件。

### 数据流

```
┌─────────────────────────────────────────────────────────────────┐
│                        渲染进程                                  │
│  index.html (garden.js)  │  garden.html (garden.js)             │
│  - handleResetPunishment │  - 种植、收获、商店、签到、成就        │
└───────────┬─────────────┴──────────────┬────────────────────────┘
            │ IPC                        │ IPC
            ▼                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     主进程 (main.js)                             │
│  IPC Handlers: garden-plant, garden-harvest, garden-punishment   │
│  等，每个操作调用 dataManager 对应的原子操作函数                   │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                 dataManager.js (带锁保护)                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ gardenLock = { locked: false, queue: [] }               │    │
│  └─────────────────────────────────────────────────────────┘    │
│  withGardenLock(fn) → 获取锁 → 执行 fn → 释放锁                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ 原子操作函数:                                            │    │
│  │ - gardenPlant()      种植                               │    │
│  │ - gardenHarvest()    收获                               │    │
│  │ - gardenBuySeed()    购买种子                           │    │
│  │ - gardenSellCrop()   出售作物                           │    │
│  │ - gardenSellAllCrops() 一键出售                         │    │
│  │ - gardenUnlockPlot() 解锁土地                           │    │
│  │ - gardenSignIn()     签到                               │    │
│  │ - gardenUpdateFocusMinutes() 更新专注时间               │    │
│  │ - updateGardenProgress() 作物生长                       │    │
│  │ - handleGardenPunishment() 惩罚处理                     │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                     数据文件 (data.json)                         │
│  %APPDATA%/pomodoro-timer/data/data.json                        │
└─────────────────────────────────────────────────────────────────┘
```

## 互斥锁实现

```javascript
// dataManager.js
const gardenLock = {
  locked: false,
  queue: []
}

async function acquireGardenLock() {
  return new Promise((resolve) => {
    if (!gardenLock.locked) {
      gardenLock.locked = true
      resolve()
    } else {
      gardenLock.queue.push(resolve)  // 等待队列
    }
  })
}

function releaseGardenLock() {
  if (gardenLock.queue.length > 0) {
    const next = gardenLock.queue.shift()
    next()  // 唤醒下一个等待者
  } else {
    gardenLock.locked = false
  }
}

async function withGardenLock(fn) {
  await acquireGardenLock()
  try {
    return await fn()
  } finally {
    releaseGardenLock()
  }
}
```

## 原子操作示例

### 种植操作

```javascript
async function gardenPlant(plotIndex, cropKey) {
  return withGardenLock(() => {
    // 1. 读取最新数据
    const data = readData()
    const garden = data.garden || createDefaultData().garden
    
    // 2. 验证条件
    const seeds = garden.seeds || {}
    if (!seeds[cropKey] || seeds[cropKey] <= 0) {
      return { success: false, message: '种子不足', garden }
    }
    
    // 3. 执行修改
    seeds[cropKey]--
    garden.plots[plotIndex] = {
      id: plotIndex,
      crop: cropKey,
      progress: 0,
      plantedAt: new Date().toISOString()
    }
    
    // 4. 写回文件
    data.garden = garden
    writeData(data)
    
    // 5. 返回结果
    return { success: true, message: '种植成功', garden }
  })
}
```

### 惩罚操作

```javascript
async function handleGardenPunishment() {
  return withGardenLock(() => {
    const data = readData()
    const plots = data.garden.plots || []
    const losses = []
    
    for (let i = 0; i < plots.length; i++) {
      const plot = plots[i]
      if (!plot.locked && plot.crop && plot.progress < totalTime) {
        losses.push({ crop: plot.crop, name: '...', ... })
        plots[i] = { id: i, crop: null, progress: 0, plantedAt: null }
      }
    }
    
    if (losses.length > 0) {
      data.garden.plots = plots
      writeData(data)
    }
    
    return { hasLoss: losses.length > 0, losses, totalMinutes }
  })
}
```

## IPC 处理器

每个菜园子操作都有独立的 IPC 处理器：

```javascript
// main.js
ipcMain.handle('garden-plant', async (event, plotIndex, cropKey) => {
  const result = await dataManager.gardenPlant(plotIndex, cropKey)
  // 通知菜园子窗口刷新
  if (gardenWindow && !gardenWindow.isDestroyed()) {
    gardenWindow.webContents.send('garden-refresh')
  }
  return result
})

ipcMain.handle('garden-punishment', async () => {
  const result = await dataManager.handleGardenPunishment()
  if (gardenWindow && !gardenWindow.isDestroyed()) {
    gardenWindow.webContents.send('garden-refresh')
  }
  return result
})
```

## 渲染进程调用

```javascript
// garden.js
async function plant(plotIndex, cropKey) {
  const result = await window.electronAPI.gardenPlant(plotIndex, cropKey)
  if (result.success) {
    currentGardenData = result.garden
    render()
  }
  return result
}

async function handleResetPunishment() {
  // 只调用 IPC，不做 UI 渲染（因为可能在 index.html 中调用）
  const result = await window.electronAPI.gardenPunishment()
  return result
}
```

## 关键修复点

### 1. try-catch 范围问题

**问题：** `garden.js` 的 `handleResetPunishment` 原来将 IPC 调用和 UI 渲染放在同一个 try-catch 中。当在 `index.html` 中调用时，UI 渲染会因为 DOM 元素不存在而抛出异常，导致正确的数据被覆盖。

**修复：** 分离 IPC 调用和 UI 渲染的错误处理。

```javascript
// 修复前（错误）
async function handleResetPunishment() {
  try {
    const result = await window.electronAPI.gardenPunishment()
    if (result.hasLoss) {
      await loadAndRender()  // 可能在 index.html 中抛出异常
    }
    return result
  } catch (e) {
    return { hasLoss: false, ... }  // 异常覆盖了正确结果
  }
}

// 修复后（正确）
async function handleResetPunishment() {
  let result = { hasLoss: false, losses: [], totalMinutes: 0 }
  
  try {
    result = await window.electronAPI.gardenPunishment()
  } catch (e) {
    console.error('IPC 调用失败:', e)
    return { hasLoss: false, ... }
  }
  
  // 单独处理 UI，不影响 result
  if (result.hasLoss) {
    try {
      await loadAndRender()
    } catch (e) {
      console.warn('UI 渲染失败:', e)
    }
  }
  
  return result
}
```

### 2. 多窗口并发问题

**问题：** 主窗口和菜园子窗口同时操作数据时，可能出现读写冲突。

**修复：** 互斥锁确保操作的原子性。

### 3. 作物生长时机问题

**问题：** 作物在非专注模式下也会生长。

**修复：** `timer.js` 只在专注模式开启时才调用 `gardenGrow`。

## 最佳实践

1. **所有数据操作都通过 IPC 调用主进程的原子操作函数**
2. **不要在渲染进程直接操作数据文件**
3. **UI 渲染和数据处理分离，避免相互影响**
4. **使用互斥锁保护并发访问**
5. **每个操作返回最新数据，减少额外的读取调用**
