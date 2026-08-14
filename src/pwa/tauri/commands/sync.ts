/**
 * 云端同步命令（PWA 实现：REST）
 *
 * 对应桌面端 Rust commands/sync.rs：
 * - GET  /api/v1/settings         拉取云端设置
 * - PUT  /api/v1/settings         上传设置
 * - POST /api/v1/pomodoro/records/batch  批量上传番茄钟记录
 * 需登录（Authorization: Bearer）。401 由 http.ts 自动刷新重试。
 *
 * 部门：PWA部门 —— 2026-08 PWA 第一版
 */

import { apiGet, apiPut, apiPost } from "../../http";
import { loadSettings, saveSettings, type JsonObject } from "../../storage";

export interface CloudSettings {
  settings: Record<string, unknown>;
  updated_at?: string;
}

/** 拉取云端设置并合并写入本地 */
export async function cmdCloudSyncPullSettings(): Promise<CloudSettings> {
  const data = await apiGet<{ settings?: Record<string, unknown>; updated_at?: string }>(
    "/settings",
  );
  const merged: Record<string, unknown> = { ...loadSettings(), ...(data.settings ?? {}) };
  saveSettings(merged);
  return { settings: merged, updated_at: data.updated_at };
}

/** 上传本地设置到云端 */
export async function cmdCloudSyncPushSettings(): Promise<boolean> {
  await apiPut("/settings", { settings: loadSettings() });
  return true;
}

export interface PomodoroRecord {
  mode: string;
  duration: number;
  completed?: boolean;
  started_at?: string;
  ended_at?: string;
}

/** 批量上传番茄钟记录，返回确认同步条数 */
export async function cmdCloudUploadPomodoroRecords(
  args: Record<string, unknown>,
): Promise<number> {
  const records = Array.isArray(args.records) ? (args.records as PomodoroRecord[]) : [];
  if (records.length === 0) return 0;
  const data = await apiPost<{ synced?: number }>("/pomodoro/records/batch", { records });
  return data.synced ?? records.length;
}
