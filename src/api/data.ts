/**
 * 数据持久化 API
 *
 * 对应 Rust 命令（src-tauri/src/commands/data.rs）：
 * - read_data / write_data：应用主数据（data.json）
 * - read_settings / write_settings：用户设置（settings.json）
 *
 * 所有命令的参数名遵循 Tauri v2 约定：Rust 端 snake_case，JS 端 camelCase。
 */
import { invoke } from "@tauri-apps/api/core";

/** 通用 JSON 对象类型（用于 data.json 与 settings.json） */
export type JsonObject = Record<string, unknown>;

/**
 * 读取应用主数据。
 * 后端：`read_data() -> Result<Value, String>`
 */
export function readData(): Promise<JsonObject> {
  return invoke<JsonObject>("read_data");
}

/**
 * 写入应用主数据。
 * 后端：`write_data(data: Value) -> Result<(), String>`
 */
export function writeData(data: JsonObject): Promise<void> {
  return invoke<void>("write_data", { data });
}

/**
 * 读取用户设置。
 * 后端：`read_settings() -> Result<Value, String>`
 */
export function readSettings(): Promise<JsonObject> {
  return invoke<JsonObject>("read_settings");
}

/**
 * 写入用户设置。
 * 后端：`write_settings(settings: Value) -> Result<(), String>`
 */
export function writeSettings(settings: JsonObject): Promise<void> {
  return invoke<void>("write_settings", { settings });
}
