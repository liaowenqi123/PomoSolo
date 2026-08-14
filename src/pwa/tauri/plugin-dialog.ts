/**
 * @tauri-apps/plugin-dialog 的浏览器替身（PWA）
 *
 * SettingsPanel.vue 用它打开"选择本地安装包"文件框——PWA 无本地文件安装，
 * 直接返回 null（与用户取消一致）。
 * 部门：PWA部门 —— 2026-08 PWA 第一版
 */

export interface OpenDialogOptions {
  title?: string;
  multiple?: boolean;
  directory?: boolean;
  filters?: { name: string; extensions: string[] }[];
  defaultPath?: string;
  [key: string]: unknown;
}

export async function open(
  _options?: OpenDialogOptions | string,
): Promise<string | string[] | null> {
  return null;
}

export async function save(_options?: unknown): Promise<string | null> {
  return null;
}

export async function ask(_message: string, _options?: unknown): Promise<boolean> {
  return false;
}

export async function message(_message: string, _options?: unknown): Promise<void> {
  // PWA 中弹浏览器原生提示
  alert(_message);
}
