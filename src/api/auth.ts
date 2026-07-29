/**
 * 认证相关 API
 *
 * 包含：
 * - 本地凭据存储（save_credentials / load_credentials / clear_credentials）
 * - 云端账号系统（cloud_login / cloud_register / cloud_logout / cloud_get_session / cloud_test_connection）
 * - API Key 管理（get_api_key / save_api_key）
 * - API 模式切换（get_api_mode / set_api_mode）
 *
 * 对应 Electron 旧版的 cloudAuth 模块 + ipc-cloud.js。
 *
 * 注意：当前 src-tauri/src/lib.rs 暂未注册这些命令，调用会失败。
 * 等后端 commands 注册后即可直接使用。
 */
import { invoke } from "@tauri-apps/api/core";

// ===== 类型定义 =====

/** API 模式：云端（用 Session Key）或本地（用自有 API Key） */
export type ApiMode = "cloud" | "local";

/** 用户会话（与 Rust `cloud_auth::Session` 对应） */
export interface Session {
  id: number;
  username: string;
  admin: boolean;
}

/** 本地凭据记录（与 Rust `cloud_auth::Credentials` 对应） */
export interface Credentials {
  username: string;
  /** AES-GCM 加密后的密码（base64），由后端处理；前端读取时仍为加密态 */
  passwordEncrypted?: string;
  /** 客户端标识 */
  clientId?: string;
  /** 是否自动登录 */
  autoLogin?: boolean;
}

/** 登录结果 */
export interface LoginResult {
  success: boolean;
  user?: Session;
  /** 错误信息（失败时） */
  error?: string;
}

/** 注册结果 */
export interface RegisterResult {
  success: boolean;
  /** 错误信息（失败时） */
  error?: string;
}

/** 连接测试结果 */
export interface ConnectionTestResult {
  /** 是否连通 */
  ok: boolean;
  /** 延迟（毫秒） */
  latency?: number;
  /** 错误信息 */
  error?: string;
}

// ===== 凭据存储 =====

/**
 * 保存用户凭据（密码会经 AES-256-GCM 加密后落盘）。
 * 后端：`save_credentials(username, password, auto_login) -> Result<(), String>`
 */
export function saveCredentials(
  username: string,
  password: string,
  autoLogin: boolean,
): Promise<void> {
  return invoke<void>("save_credentials", { username, password, autoLogin });
}

/**
 * 读取本地凭据。返回 null 表示无凭据。
 * 后端：`load_credentials() -> Result<Option<Credentials>, String>`
 */
export function loadCredentials(): Promise<Credentials | null> {
  return invoke<Credentials | null>("load_credentials");
}

/**
 * 清除本地凭据文件。
 * 后端：`clear_credentials() -> Result<(), String>`
 */
export function clearCredentials(): Promise<void> {
  return invoke<void>("clear_credentials");
}

// ===== 云端账号 =====

/**
 * 测试云端连接。
 * 后端：`cloud_test_connection() -> Result<ConnectionTestResult, String>`
 */
export function cloudTestConnection(): Promise<ConnectionTestResult> {
  return invoke<ConnectionTestResult>("cloud_test_connection");
}

/**
 * 获取当前会话（未登录返回 null）。
 * 后端：`cloud_get_session() -> Result<Option<Session>, String>`
 */
export function cloudGetSession(): Promise<Session | null> {
  return invoke<Session | null>("cloud_get_session");
}

/**
 * 登录账号。
 * 后端：`cloud_login(username, password) -> Result<LoginResult, String>`
 */
export function cloudLogin(
  username: string,
  password: string,
): Promise<LoginResult> {
  return invoke<LoginResult>("cloud_login", { username, password });
}

/**
 * 注册账号。
 * 后端：`cloud_register(username, password) -> Result<RegisterResult, String>`
 */
export function cloudRegister(
  username: string,
  password: string,
): Promise<RegisterResult> {
  return invoke<RegisterResult>("cloud_register", { username, password });
}

/**
 * 退出登录。
 * 后端：`cloud_logout() -> Result<(), String>`
 */
export function cloudLogout(): Promise<void> {
  return invoke<void>("cloud_logout");
}

// ===== API Key 管理 =====

/**
 * 读取已保存的 API Key（后端从 data.json 读取）。
 * 后端：`get_api_key() -> Result<Option<String>, String>`
 */
export function getApiKey(): Promise<string | null> {
  return invoke<string | null>("get_api_key");
}

/**
 * 保存 API Key，并通知相关后端模块（AI 助手 / 前台检测 / 歌曲下载）。
 * 后端：`save_api_key(api_key: String) -> Result<bool, String>`
 */
export function saveApiKey(key: string): Promise<boolean> {
  return invoke<boolean>("save_api_key", { apiKey: key });
}

// ===== API 模式 =====

/**
 * 读取当前 API 模式。默认为 'cloud'。
 * 后端：`get_api_mode() -> Result<ApiMode, String>`
 */
export function getApiMode(): Promise<ApiMode> {
  return invoke<ApiMode>("get_api_mode");
}

/**
 * 设置 API 模式。
 * 后端：`set_api_mode(mode: String) -> Result<bool, String>`
 */
export function setApiMode(mode: ApiMode): Promise<boolean> {
  return invoke<boolean>("set_api_mode", { mode });
}
