/**
 * @tauri-apps/api/app 的浏览器替身（PWA）
 *
 * SettingsPanel.vue 用 getVersion() 展示版本号；PWA 返回自身版本。
 * 部门：PWA部门 —— 2026-08 PWA 第一版
 */

import { PWA_VERSION } from "../config";

export async function getVersion(): Promise<string> {
  return PWA_VERSION;
}

export async function getName(): Promise<string> {
  return "PomoSolo PWA";
}

export async function getTauriVersion(): Promise<string> {
  return "0.0.0-pwa";
}
