/**
 * 窗口控制 API
 *
 * 对应 Rust 命令（src-tauri/src/commands/window.rs）：
 * - close_window
 * - minimize_window
 * - set_always_on_top(on_top: bool)
 * - bring_to_front
 * - cancel_always_on_top
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
