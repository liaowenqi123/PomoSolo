/**
 * 窗口控制 API
 *
 * 对应 Rust 命令（src-tauri/src/commands/window.rs）：
 * - close_window
 * - minimize_window
 * - set_always_on_top(on_top: bool)
 * - bring_to_front
 * - cancel_always_on_top
 * - enter_mini_mode
 * - exit_mini_mode
 * - update_mini_position
 * - open_external
 */
import { invoke } from "@tauri-apps/api/core";

/**
 * 关闭主窗口。
 * 后端：`close_window(app: AppHandle)`
 */
export function closeWindow(): Promise<void> {
  return invoke<void>("close_window");
}

/**
 * 最小化主窗口。
 * 后端：`minimize_window(app: AppHandle)`
 */
export function minimizeWindow(): Promise<void> {
  return invoke<void>("minimize_window");
}

/**
 * 设置主窗口是否始终置顶。
 * 后端：`set_always_on_top(app: AppHandle, on_top: bool)`
 */
export function setAlwaysOnTop(onTop: boolean): Promise<void> {
  return invoke<void>("set_always_on_top", { onTop });
}

/**
 * 将主窗口置顶并抢占前台焦点。
 * 后端：`bring_to_front(app: AppHandle)`
 */
export function bringToFront(): Promise<void> {
  return invoke<void>("bring_to_front");
}

/**
 * 取消主窗口的始终置顶状态。
 * 后端：`cancel_always_on_top(app: AppHandle)`
 */
export function cancelAlwaysOnTop(): Promise<void> {
  return invoke<void>("cancel_always_on_top");
}

/**
 * 显示菜园子窗口。
 * 后端：`show_garden_window(app: AppHandle)`
 */
export function showGardenWindow(): Promise<void> {
  return invoke<void>("show_garden_window");
}

/**
 * 隐藏菜园子窗口。
 * 后端：`hide_garden_window(app: AppHandle)`
 */
export function hideGardenWindow(): Promise<void> {
  return invoke<void>("hide_garden_window");
}

/**
 * 进入迷你模式：将主窗口尺寸缩小为 180x220 并置顶，禁止最小化，从任务栏隐藏。
 * 后端：`enter_mini_mode(app: AppHandle)`
 */
export function enterMiniMode(): Promise<void> {
  return invoke<void>("enter_mini_mode");
}

/**
 * 退出迷你模式：恢复主窗口尺寸为 520x560，取消置顶，恢复最小化与任务栏显示。
 * 后端：`exit_mini_mode(app: AppHandle)`
 */
export function exitMiniMode(): Promise<void> {
  return invoke<void>("exit_mini_mode");
}

/**
 * 保存迷你模式当前位置到 data.json（拖动结束后调用）。
 * 后端：`update_mini_position(app: AppHandle)`
 */
export function updateMiniPosition(): Promise<void> {
  return invoke<void>("update_mini_position");
}

/**
 * 在系统默认浏览器中打开外部链接。
 * 后端：`open_external(url: String) -> Result<(), String>`
 *
 * 仅支持 http/https 协议。
 */
export function openExternal(url: string): Promise<void> {
  return invoke<void>("open_external", { url });
}

/**
 * 显示系统通知（使用 Web Notification API）。
 *
 * 与旧版 Electron 的 show-notification IPC 等价，但直接在 webview 中调用
 * 浏览器原生 Notification API，无需经过 Rust 后端。
 *
 * @param title 通知标题（缺省"番茄钟"）
 * @param body 通知正文（缺省空）
 */
export function showNotification(title = "番茄钟", body = ""): void {
  try {
    if ("Notification" in window) {
      if (Notification.permission === "granted") {
        new Notification(title, { body, silent: false });
      } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then((perm) => {
          if (perm === "granted") {
            new Notification(title, { body, silent: false });
          }
        });
      }
    }
  } catch {
    // 通知 API 不可用时静默降级
  }
}
