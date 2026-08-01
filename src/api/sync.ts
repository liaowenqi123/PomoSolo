/**
 * 云端同步 API
 *
 * 对接自建服务器（server-planning/API-implementation.md）：
 * - 设置同步（GET/PUT /api/v1/settings）
 * - 番茄钟记录上传（POST /api/v1/pomodoro/records/batch）
 *
 * 由 Rust 后端 `commands/sync.rs` 提供，前端只需调用 invoke。
 */
import { invoke } from "@tauri-apps/api/core";

/** 云端设置（服务器返回结构） */
export interface CloudSettings {
  settings: Record<string, unknown>;
  updated_at?: string;
}

/** 番茄钟记录上传项 */
export interface PomodoroRecord {
  mode: string;
  duration: number;
  completed?: boolean;
  started_at?: string;
  ended_at?: string;
}

/**
 * 拉取云端设置并合并写入本地 settings.json。
 * 后端：`cloud_sync_pull_settings() -> Result<CloudSettings, String>`
 * 需登录；返回的 settings 已合并到本地。
 */
export function cloudSyncPullSettings(): Promise<CloudSettings> {
  return invoke<CloudSettings>("cloud_sync_pull_settings");
}

/**
 * 上传本地 settings.json 到云端。
 * 后端：`cloud_sync_push_settings() -> Result<bool, String>`
 */
export function cloudSyncPushSettings(): Promise<boolean> {
  return invoke<boolean>("cloud_sync_push_settings");
}

/**
 * 批量上传番茄钟记录。
 * 后端：`cloud_upload_pomodoro_records(records) -> Result<i64, String>`
 * 返回服务器确认同步的记录数。空列表直接返回 0（不触发 IPC）。
 */
export function cloudUploadPomodoroRecords(
  records: PomodoroRecord[],
): Promise<number> {
  if (records.length === 0) {
    return Promise.resolve(0);
  }
  return invoke<number>("cloud_upload_pomodoro_records", { records });
}
