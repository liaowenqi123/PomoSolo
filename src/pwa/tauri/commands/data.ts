/**
 * 数据/设置命令（PWA 实现：localStorage）
 *
 * 对应桌面端 Rust commands/data.rs 的 read_data/write_data/read_settings/write_settings。
 * 部门：PWA部门 —— 2026-08 PWA 第一版
 */

import { loadData, saveData, loadSettings, saveSettings, type JsonObject } from "../../storage";

export async function cmdReadData(): Promise<JsonObject> {
  return loadData();
}

export async function cmdWriteData(args: Record<string, unknown>): Promise<void> {
  const data = (args.data ?? {}) as JsonObject;
  saveData(data);
}

export async function cmdReadSettings(): Promise<JsonObject> {
  return loadSettings();
}

export async function cmdWriteSettings(args: Record<string, unknown>): Promise<void> {
  const settings = (args.settings ?? {}) as JsonObject;
  saveSettings(settings);
}
