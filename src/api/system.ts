/**
 * 系统集成 API
 *
 * 对应 Rust 命令（src-tauri/src/commands/system.rs）：
 * - autostart_enable(enabled: bool) -> Result<bool, String>
 * - autostart_is_enabled() -> Result<bool, String>
 *
 * 对应旧版 Electron 的 `set-auto-start` / `get-auto-start` IPC。
 */
import { invoke } from "@tauri-apps/api/core";

/**
 * 开启或关闭开机自启。
 *
 * 后端会调用 `tauri-plugin-autostart` 注册/取消系统登录项
 * （Windows 注册表 / macOS LaunchAgent / Linux .desktop）。
 *
 * @param enabled true=开启，false=关闭
 * @returns 最终系统状态（可能因权限不足而与请求不同）
 */
export function autostartEnable(enabled: boolean): Promise<boolean> {
  return invoke<boolean>("autostart_enable", { enabled });
}

/**
 * 查询当前开机自启状态。
 *
 * @returns 系统是否已注册登录项
 */
export function autostartIsEnabled(): Promise<boolean> {
  return invoke<boolean>("autostart_is_enabled");
}
