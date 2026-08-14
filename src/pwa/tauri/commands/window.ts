/**
 * 窗口命令（PWA 实现：无窗口概念，安全 no-op）
 *
 * 对应桌面端 Rust commands/window.rs。PWA 在浏览器标签页中运行，
 * 窗口控制命令全部 no-op；open_external 用 window.open 打开新标签。
 * 部门：PWA部门 —— 2026-08 PWA 第一版
 */

export async function cmdNoop(): Promise<void> {
  /* no-op */
}

export async function cmdOpenExternal(args: Record<string, unknown>): Promise<void> {
  const url = String(args.url ?? "");
  if (/^https?:\/\//.test(url)) {
    window.open(url, "_blank", "noopener");
  }
}
