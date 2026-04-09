# 单点登录设计文档

## 一、问题背景

云端登录功能（获取 DeepSeek API Key）在**多个客户端同时登录同一个账号**的情况下，会导致自习室相关的统计数据出现 bug。

虽然云端登录和自习室模块的数据库调用大多独立，但**自习室强绑定登录系统**（如 `study_room_members` 关联 `user_id`），当同一账号在多端同时登录时，会产生数据冲突：

- 多个客户端同时更新同一用户的学习统计
- 心跳状态混乱（一个客户端在线，另一个被标记为离线）
- 排行榜数据不一致

需要实现单点登录机制，防止同一账号被多个客户端同时登录。

**核心原则**：宁愿没有客户端能登录，也不能让两个客户端同时登录。

## 二、技术约束

- 云端只有 Supabase，没有独立后端服务器
- 无法实现反向握手或主动询问客户端
- 无法实现"强制下线"功能（Supabase 不是服务器，无法反向推送通知）
- 只能通过客户端主动上报状态的方式实现

## 三、基础方案

### 3.1 状态记录

在 `users` 表中新增以下字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `is_online` | boolean | 是否在线（全局登录状态） |
| `last_main_login_heartbeat` | timestamp | 登录心跳时间（与自习室心跳区分） |
| `client_id` | string | 客户端唯一标识（持久化存储在本地） |

> **命名说明**：使用 `main_login_` 前缀与自习室的 `last_active` / `last_heartbeat` 区分，避免混淆。

### 3.2 上线流程

```
客户端启动/登录 → 检查云端状态 → 决定是否允许登录
```

**上线登记一定是可靠的**，因为这是登录流程的一部分。

### 3.3 下线流程

```
客户端正常退出 → 标记 is_online = false
```

**下线登记不一定可靠**，因为进程可能被强制杀掉（任务管理器、系统关机、崩溃等）。

## 四、心跳机制

### 4.1 设计

- 心跳间隔：**1 分钟**
- 每次心跳更新 `last_main_login_heartbeat` 时间戳
- 字段命名使用 `last_main_login_heartbeat`，与自习室的 `last_active` 区分

### 4.2 问题

即使有心跳，如果进程被杀掉，心跳停止了也没人发现。这需要通过登录时的检查来解决。

## 五、登录检查逻辑

**判断顺序**：client_id → is_online → last_main_login_heartbeat

```
客户端请求登录
    ↓
获取本地 client_id（若不存在则生成并持久化）
    ↓
从云端获取该用户的 is_online、last_main_login_heartbeat、client_id
    ↓
                    ┌─────────────────────────────┐
                    │   cloud.client_id 与        │
                    │   local.client_id 比较      │
                    └──────────────┬──────────────┘
                          ↙              ↘
                   一致（同一设备）    不一致（不同设备）
                          ↓                ↓
              ┌─────────────────┐   检查 is_online
              │ 直接允许登录     │        ↓
              │ 更新心跳时间     │   ┌─────┴─────┐
              └─────────────────┘   ↓           ↓
                              false         true
                                ↓             ↓
                        ┌───────────┐  检查心跳超时
                        │ 允许登录   │        ↓
                        └───────────┘  ┌──────┴──────┐
                                       ↓             ↓
                                   超过2分钟      未超时
                                       ↓             ↓
                              ┌─────────────┐ ┌─────────────┐
                              │ 允许登录     │ │ 拒绝登录     │
                              │ （对方掉线） │ │ （对方在线） │
                              └─────────────┘ └─────────────┘
```

### 5.1 判断逻辑详解

| 优先级 | 检查项 | 条件 | 结果 | 说明 |
|--------|--------|------|------|------|
| 1 | client_id | 一致 | 允许登录 | 同一设备重新登录，直接放行 |
| 2 | is_online | false | 允许登录 | 云端显示离线 |
| 3 | last_main_login_heartbeat | 超过2分钟 | 允许登录 | 对方已掉线 |
| 3 | last_main_login_heartbeat | 未超时 | 拒绝登录 | 对方确实在线 |

### 5.2 时间阈值选择

- 心跳间隔：1 分钟
- 超时阈值：**2 分钟**（心跳间隔 × 2）
- 选择 2 分钟的原因：
  - 给心跳一定的宽限时间（网络延迟等）
  - 同时也不会让被踢下线的用户等太久

## 六、客户端 ID 机制

### 6.1 问题场景

如果客户端进程被杀掉，在 1 分钟内无法重新登录，因为云端仍然显示 `is_online = true` 且 `last_heartbeat` 未超时。这会影响用户体验。

### 6.2 解决方案

每个客户端生成一个**唯一的客户端 ID**，同时存储在本地和云端。登录时检查 ID：

```
客户端请求登录
    ↓
检查云端 client_id
    ↓
┌─ 云端 client_id 为空 ────────→ 首次登录，允许登录，记录 client_id
│
├─ client_id 与本地一致 ──────→ 同一设备重新登录，允许登录
│
└─ client_id 与本地不一致
       ↓
   执行 5.2 的心跳超时检查
       ↓
   ┌─ 超时 ──→ 允许登录，更新 client_id
   │
   └─ 未超时 ──→ 拒绝登录
```

### 6.3 客户端 ID 的生成

客户端 ID 由以下因素计算：

1. **电脑标识**：机器码、MAC 地址哈希、或系统 UUID（不需要绝对稳定，只要不容易重复即可）
2. **客户端路径**：可执行文件路径（同一台电脑的不同安装位置视为不同客户端）

计算公式：
```
client_id = hash(machine_id + executable_path)
```

**重要说明**：
- client_id 可以**持久化存储**在本地配置文件中
- 即使机器标识获取方式不稳定也没关系，只要生成的值**不容易重复**即可
- 首次生成后存储在本地，后续直接读取本地存储的值

### 6.4 本地持久化存储

```javascript
// client_id 存储位置：userData/credentials.json 或单独的文件
{
  "client_id": "abc123...",  // 首次生成后持久化存储
  "username": "...",
  "password": "...",
  "autoLogin": true
}
```

## 七、完整流程图

```
┌─────────────────────────────────────────────────────────────────────┐
│                         客户端启动/登录                               │
└───────────────────────────────┬─────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────┐
│  获取本地 client_id（不存在则生成并持久化存储）                         │
│  client_id = hash(machine_id + executable_path)                     │
└───────────────────────────────┬─────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────┐
│  从云端获取该用户的 is_online、last_main_login_heartbeat、client_id  │
└───────────────────────────────┬─────────────────────────────────────┘
                                ↓
                    ┌───────────┴───────────┐
                    │   cloud.client_id    │
                    │   == local.client_id? │
                    └───────────┬───────────┘
                          ↙           ↘
                   是（同一设备）    否（不同设备）
                          ↓              ↓
              ┌───────────────┐  ┌───────────────────┐
              │  允许登录      │  │  cloud.is_online? │
              │  更新心跳      │  └─────────┬─────────┘
              └───────────────┘      ↙          ↘
                                false          true
                                  ↓              ↓
                          ┌───────────┐  ┌─────────────────────┐
                          │ 允许登录   │  │ last_main_login_    │
                          │ 更新状态   │  │ heartbeat 超时？    │
                          └───────────┘  └────────┬────────────┘
                                         ↙           ↘
                                      是             否
                                       ↓             ↓
                              ┌─────────────┐ ┌─────────────┐
                              │ 允许登录     │ │ 拒绝登录     │
                              │ （对方掉线） │ │ （对方在线） │
                              └─────────────┘ └─────────────┘
```

## 八、实现要点

### 8.1 数据库修改

在 `users` 表中添加字段：

```sql
ALTER TABLE users ADD COLUMN is_online BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN last_main_login_heartbeat TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN client_id VARCHAR(64);
```

### 8.2 客户端需要实现的模块

1. **client_id 生成与存储模块**：
   - 首次运行时生成 client_id
   - 持久化存储到本地配置文件
   - 后续直接读取本地存储

2. **心跳模块**：每 1 分钟向云端发送心跳（更新 `main_login_heartbeat`）

3. **登录检查模块**：登录前检查云端状态，决定是否允许登录

### 8.3 心跳实现

```javascript
// 心跳间隔：1 分钟
const HEARTBEAT_INTERVAL = 60 * 1000;

// 登录成功后启动心跳
function startHeartbeat() {
  setInterval(async () => {
    await supabase
      .from('users')
      .update({
        last_main_login_heartbeat: new Date().toISOString(),
        is_online: true
      })
      .eq('id', userId);
  }, HEARTBEAT_INTERVAL);
}
```

### 8.4 登录检查实现

```javascript
const HEARTBEAT_TIMEOUT = 2 * 60 * 1000; // 2 分钟

async function checkLoginAllowed(userId, localClientId) {
  const { data: user } = await supabase
    .from('users')
    .select('is_online, last_main_login_heartbeat, client_id')
    .eq('id', userId)
    .single();
  
  // 优先级 1：client_id 一致，同一设备重新登录
  if (user.client_id === localClientId) {
    return { allowed: true, reason: 'same_device' };
  }
  
  // 优先级 2：云端显示 offline
  if (!user.is_online) {
    return { allowed: true, reason: 'offline' };
  }
  
  // 优先级 3：云端显示 online，检查心跳超时
  const lastHeartbeat = new Date(user.last_main_login_heartbeat);
  const elapsed = Date.now() - lastHeartbeat.getTime();
  
  if (elapsed > HEARTBEAT_TIMEOUT) {
    return { allowed: true, reason: 'heartbeat_timeout' };
  }
  
  // 对方确实在线
  return { allowed: false, reason: 'already_online' };
}
```

## 九、边缘情况处理

| 场景 | 处理方式 |
|------|----------|
| 网络断开导致心跳失败 | 下次网络恢复时继续心跳；登录检查仍以云端 `last_main_login_heartbeat` 为准 |
| 用户快速切换设备 | 需等待 2 分钟超时后才能在新设备登录 |
| 同一设备崩溃重启 | client_id 一致（本地持久化），直接允许登录 |
| 系统时间被修改 | 可能导致误判，可考虑使用服务器时间（但 Supabase 无服务器） |
| 本地配置文件被删除 | 重新生成 client_id，需等待 2 分钟超时才能登录 |

## 十、与现有代码的集成

### 10.1 现有登录流程（cloudAuth.js）

```
用户输入用户名密码 → 验证 → 创建会话 → 获取 API Key
```

### 10.2 新增登录流程

```
用户输入用户名密码 → 检查单点登录状态 → 验证密码 → 创建会话 → 启动心跳
```

### 10.3 修改点

1. `login()` 函数中，密码验证前增加单点登录检查
2. 登录成功后启动心跳定时器
3. 退出登录时标记 `is_online = false` 并停止心跳
4. `credentials.json` 中增加 `client_id` 字段

## 十一、同一个 exe 多实例问题

暂不处理，后续如果发现可以同时运行多个实例，可通过以下方式解决：

1. Electron 的 `app.requestSingleInstanceLock()` API
2. 在 app ready 时检查是否已有实例运行
3. 如果已有实例，聚焦到已有实例窗口并退出当前实例

```javascript
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // 聚焦到已有实例的主窗口
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
```

## 十二、不做的事项

1. **强制下线功能**：Supabase 不是服务器，无法反向推送通知，精度最高的方式只能是心跳检测
2. **复杂的设备管理**：不提供设备列表查看、设备命名等功能
