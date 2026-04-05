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
│  isGardenPage = false    │  isGardenPage = true                 │
│  - handleResetPunishment │  - 种植、收获、商店、签到、成就        │
│    (仅数据操作，无UI)     │  - handleResetPunishment (数据+UI)    │
└───────────┬─────────────┴──────────────┬────────────────────────┘
            │ IPC                        │ IPC
            ▼                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     主进程 (main.js)                             │
│  IPC Handlers: garden-plant, garden-harvest, garden-punishment   │
│  等，每个操作调用 dataManager 对应的原子操作函数                   │
│  操作完成后向 gardenWindow 发送 garden-refresh 事件               │
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
│  │ - readGardenData()   读取数据                           │    │
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
  if (!window.electronAPI || !window.electronAPI.gardenPunishment) {
    return { hasLoss: false, losses: [], totalMinutes: 0 }
  }

  const result = await window.electronAPI.gardenPunishment()

  // 仅在菜园子页面刷新 UI
  if (result.hasLoss && isGardenPage) {
    await loadAndRender()
    updateTip('⚠️ 专注模式中断！所有正在生长的作物已枯萎')
  }

  return result
}
```

## 多页面架构

`garden.js` 被两个页面引入，但行为不同：

| 页面 | DOM 环境 | 执行的操作 |
|------|----------|-----------|
| `index.html` | 无菜园子 DOM | 只提供 `handleResetPunishment` 供专注模式惩罚调用 |
| `garden.html` | 完整菜园子 DOM | 完整功能：种植、收获、商店、签到、成就等 |

**初始化时的判断：**
```javascript
async function init() {
  // 没有 gardenGrid 说明不是菜园子页面，直接返回
  if (!document.getElementById('gardenGrid')) {
    return
  }
  isGardenPage = true
  // ... 继续初始化
}
```
```

## 关键修复点

### 1. 多页面运行环境判断

**问题：** `garden.js` 同时被 `index.html` 和 `garden.html` 引入，但 DOM 元素只存在于 `garden.html` 中。当在 `index.html` 中调用 `handleResetPunishment` 时，如果尝试执行 UI 渲染，会因为 DOM 元素不存在而抛出异常。

**修复：** 使用 `isGardenPage` 变量判断当前运行环境，只在正确的页面执行 UI 操作。

```javascript
// garden.js
let isGardenPage = false

async function init() {
  // 检测当前页面是否是菜园子页面
  if (!document.getElementById('gardenGrid')) {
    return  // 不初始化，避免操作不存在的 DOM
  }
  isGardenPage = true
  // ... 初始化 DOM 元素和事件
}

async function handleResetPunishment() {
  if (!window.electronAPI || !window.electronAPI.gardenPunishment) {
    return { hasLoss: false, losses: [], totalMinutes: 0 }
  }

  const result = await window.electronAPI.gardenPunishment()

  // 仅在菜园子页面刷新 UI，index.html 中无此 DOM，不执行
  if (result.hasLoss && isGardenPage) {
    await loadAndRender()
    updateTip('⚠️ 专注模式中断！所有正在生长的作物已枯萎')
  }

  return result
}
```

**设计原则：**
- **数据操作**：在任何页面都可以执行（通过 IPC 调用主进程）
- **UI 渲染**：只在有对应 DOM 的页面执行

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
