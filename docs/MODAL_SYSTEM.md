# 弹窗系统说明

## 核心实现

弹窗系统集中在 `src/scripts/modules/modal.js`，提供两个类：

| 类 | 作用 | 关键差异 |
|------|------|----------|
| `BaseModal` | 基础弹窗 | 直接 `add/remove` 显示类，无进入/退出动画 |
| `AnimatedModal` | 带动画弹窗 | 继承 `BaseModal`，额外支持 `hidingClass`、`noAnimationClass`、`animationDuration` |

`BaseModal` 的默认配置如下：

| 配置项 | 默认值 | 说明 |
|------|------|------|
| `showClass` | `'show'` | 控制显示状态的 CSS 类 |
| `closeOnBackground` | `true` | 点击遮罩层时允许关闭 |
| `expandSidebarOnShow` | `true` | 显示时自动展开侧边栏 |
| `onShow` / `onHide` | `null` | 生命周期回调 |
| `onBackgroundClick` | `null` | 背景点击前置拦截，返回 `false` 可阻止关闭 |

## 侧边栏展开控制

弹窗是否展开侧边栏，由统一链路控制：

1. `renderer.js` 在模块初始化前挂载 `window.expandSidebarIfNeeded()`。
2. 该函数检查 `window.isSidebarCollapsed`。
3. 若侧边栏处于收起状态，则移除 `.container.sidebar-collapsed` 并重置 `window.isSidebarCollapsed = false`。
4. `BaseModal.show()` 和 `AnimatedModal.show()` 会在 `expandSidebarOnShow === true` 时自动调用 `window.expandSidebarIfNeeded()`。

结论：

- 主页面弹窗默认会在显示前展开侧边栏。
- 统一开关是 `expandSidebarOnShow`。
- 菜园子窗口内的商店 / 签到 / 成就墙弹窗显式设置了 `expandSidebarOnShow: false`。

## 多级弹窗关闭规则

`modal.js` 现在通过 `window.modalManager` 维护打开中的弹窗栈：

- 弹窗 `show()` 时入栈
- 弹窗 `hide()` 时出栈
- 只有栈顶弹窗允许响应背景点击关闭

这条规则用于避免“弹窗套弹窗”时点击外层遮罩，一次性把多个弹窗都关掉。

## 例外路径

有两类显式例外：

1. 菜园子窗口不属于主页面侧边栏体系，因此弹窗不参与侧边栏展开。
2. 一些旧逻辑仍然保留在代码中作为历史实现，但实际运行已经由 `BaseModal` / `AnimatedModal` 接管。

## 各弹窗实际配置

| 弹窗 | 模块 | 类 | showClass | 背景关闭 | 侧边栏展开 | 额外设置 / 备注 |
|------|------|------|------|------|------|------|
| 教程弹窗 | `tutorial.js` | `AnimatedModal` | `show` | ✅ 默认 | ✅ 默认 | `hidingClass: 'hiding'`，`animationDuration: 500` |
| 统计弹窗 | `statistics.js` | `AnimatedModal` | `show` | ✅ 默认 | ✅ 默认 | 打开时同步统计并渲染图表；关闭时销毁图表实例 |
| AI 助手弹窗 | `aiHelper.js` | `AnimatedModal` | `show` | ✅，但生成中会被拦截 | ✅ 默认 | 生成中关闭会弹出二级确认框 |
| AI 生成中确认弹窗 | `aiHelper.js` | `BaseModal` | `show` | ✅ 默认 | ❌ 显式禁用 | 二级确认框，不应触发展开侧边栏 |
| 登录 / API Key 主弹窗 | `apiKeyManager.js` | `AnimatedModal` | `show` | ✅ 默认 | ✅ 默认 | `hidingClass: 'hiding'`，`noAnimationClass: 'no-animation'` |
| 登录确认弹窗 | `apiKeyManager.js` | `BaseModal` | `show` | ✅ 默认 | ✅ 默认 | 使用默认基础配置 |
| 设置弹窗 | `settings.js` | `BaseModal` | `show` | ✅ 默认 | ✅ 默认 | `onShow` 重新加载并回填设置；`onHide` 清理确认状态 |
| 热歌榜弹窗 | `charts.js` | `BaseModal` | `open` | ✅ 默认 | ✅ 默认 | `onShow` 拉取榜单，`onHide` 更新 `state.isOpen` |
| 下载免责声明弹窗 | `charts.js` | `BaseModal` | `open` | ❌ 配置禁用 | ✅ 默认 | 只能通过按钮确认/取消关闭 |
| 标签选择弹窗 | `musicPlayer.js` | `BaseModal` | `show` | ✅ | ✅ 默认 | 实际效果等同默认值 |
| 删除歌曲确认弹窗 | `musicPlayer.js` | `BaseModal` | `show` | ✅ | ✅ 默认 | 实际效果等同默认值 |
| 单次模式备注弹窗 | `presets.js` | `BaseModal` | `show` | ✅ | ✅ 默认 | 文件中有两处创建逻辑，配置一致 |
| 计划模式备注弹窗 | `planMode.js` | `BaseModal` | `show` | ✅ | ✅ 默认 | 用于计划项备注编辑 |
| 备注查看弹窗 | `noteManager.js` | `BaseModal` | `show` | ✅ | ✅ 默认 | 只有 `BaseModal` 已加载时才创建实例 |
| 前台检测警告弹窗 | `foregroundDetection.js` | `BaseModal` | `visible` | ❌ 配置禁用 | ✅ 默认 | `onShow` 退出迷你模式并调用 `bringToFront()` |
| API Key 错误弹窗 | `foregroundDetection.js` | `BaseModal` | `visible` | ❌ 配置禁用 | ✅ 默认 | `onShow` 抢前台，`onHide` 取消置顶 |
| 商店弹窗 | `garden.js` | `BaseModal` | `show` | ✅ 默认 | ❌ 显式禁用 | 菜园子是独立窗口 |
| 签到弹窗 | `garden.js` | `BaseModal` | `show` | ✅ 默认 | ❌ 显式禁用 | 同上 |
| 成就墙弹窗 | `garden.js` | `BaseModal` | `show` | ✅ 默认 | ❌ 显式禁用 | 同上 |
| 中断专注确认弹窗 | `renderer.js` | `BaseModal` | `show` | ✅ 默认 | ✅ 默认 | 当前运行时已由 `BaseModal` 接管 |

## 当前结论

- 主页面的大多数弹窗已经统一到 `BaseModal` / `AnimatedModal`
- 侧边栏展开策略已经被显式建模
- 菜园子弹窗是有意识的例外，不属于主页面侧边栏体系
- 多级弹窗的背景点击关闭现在只作用于栈顶弹窗
