/**
 * 系统集成命令（PWA 实现：浏览器无开机自启，安全 no-op）
 * 对应桌面端 Rust commands/system.rs。
 * 部门：PWA部门 —— 2026-08 PWA 第一版
 */

export async function cmdAutostartEnable(): Promise<boolean> {
  return false;
}

export async function cmdAutostartIsEnabled(): Promise<boolean> {
  return false;
}
