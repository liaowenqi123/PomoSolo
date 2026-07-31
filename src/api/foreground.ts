/**
 * 前台检测 API
 *
 * 用于检测用户当前前台窗口是否为娱乐类应用，触发惩罚机制。
 * 对应 Electron 旧版 foregroundInspection + ipc-foreground.js。
 *
 * 命令命名（Rust 端 snake_case）：
 * - foreground_is_ready
 * - foreground_start / foreground_stop
 * - foreground_get_status
 * - foreground_set_api_key(api_key)
 * - foreground_add_whitelist(keyword) / foreground_add_blacklist(keyword)
 * - foreground_mark_history_not(window_title)
 * - foreground_move_blacklist_to_whitelist(keyword)
 * - foreground_get_config
 *
 * 事件名（与旧 Electron 版一致，kebab-case）：
 * - 'foreground-ready'
 * - 'foreground-api-key-invalid'
 * - 'foreground-entertainment-detected'
 * - 'foreground-status'
 * - 'foreground-error'
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn, type EventCallback } from "@tauri-apps/api/event";

// ===== 类型定义 =====

/** 前台检测结果（与 Rust `foreground_inspection::DetectionResult` 对应） */
export interface DetectionResult {
  /** 前台窗口标题 */
  windowTitle: string;
  /** 是否被判定为娱乐 */
  isEntertainment: boolean;
  /** 判定来源：'blacklist' | 'whitelist' | 'ai' | 'history' */
  source: string;
  /** 命中的关键词（如有） */
  keyword: string;
}

/** 前台检测运行状态 */
export interface ForegroundStatus {
  /** 是否正在运行检测 */
  running: boolean;
  /** 是否已配置 API Key */
  hasApiKey: boolean;
  /** 最近一次检测时间（毫秒时间戳） */
  lastCheckAt?: number;
  /** 最近一次检测结果 */
  lastResult?: DetectionResult;
}

// ===== 命令调用 =====

/**
 * 查询前台检测是否就绪（模块已加载）。
 * 后端：`foreground_is_ready() -> bool`
 */
export function foregroundIsReady(): Promise<boolean> {
  return invoke<boolean>("foreground_is_ready");
}

/**
 * 启动前台检测循环。
 * 后端：`foreground_start()`
 */
export function foregroundStart(): Promise<void> {
  return invoke<void>("foreground_start");
}

/**
 * 停止前台检测循环。
 * 后端：`foreground_stop()`
 */
export function foregroundStop(): Promise<void> {
  return invoke<void>("foreground_stop");
}

/**
 * 主动查询当前前台检测状态。
 * 后端：`foreground_get_status() -> Option<ForegroundStatus>`
 */
export function foregroundGetStatus(): Promise<ForegroundStatus | null> {
  return invoke<ForegroundStatus | null>("foreground_get_status");
}

/**
 * 设置 DeepSeek API Key（用于 AI 判断娱乐性）。
 * 后端：`foreground_set_api_key(api_key: String)`
 */
export function foregroundSetApiKey(key: string): Promise<void> {
  return invoke<void>("foreground_set_api_key", { apiKey: key });
}

// ===== 名单管理 =====

/** 名单配置（与 Rust `foreground_inspection::ListConfig` 对应） */
export interface ForegroundListConfig {
  /** 用户自定义白名单关键词 */
  whitelist: string[];
  /** 用户自定义黑名单关键词 */
  blacklist: string[];
  /** AI 判断历史：窗口标题 → 是否娱乐 */
  history: Record<string, boolean>;
}

/**
 * 添加关键词到白名单（命中 → 非娱乐）。返回是否真正新增（重复/空关键词返回 false）。
 * 后端：`foreground_add_whitelist(keyword) -> bool`
 */
export function foregroundAddWhitelist(keyword: string): Promise<boolean> {
  return invoke<boolean>("foreground_add_whitelist", { keyword });
}

/**
 * 添加关键词到黑名单（命中 → 娱乐）。返回是否真正新增。
 * 后端：`foreground_add_blacklist(keyword) -> bool`
 */
export function foregroundAddBlacklist(keyword: string): Promise<boolean> {
  return invoke<boolean>("foreground_add_blacklist", { keyword });
}

/**
 * 将历史记录中的窗口标题标记为"不是娱乐"。
 * ForegroundWarning"不是娱乐"按钮：source 为 history/ai 时调用。
 * 后端：`foreground_mark_history_not(window_title) -> bool`
 */
export function foregroundMarkHistoryNot(windowTitle: string): Promise<boolean> {
  return invoke<boolean>("foreground_mark_history_not", { windowTitle });
}

/**
 * 把黑名单关键词移到白名单（误判纠正）。
 * ForegroundWarning"不是娱乐"按钮：source 为 blacklist 时调用。
 * 后端：`foreground_move_blacklist_to_whitelist(keyword) -> bool`
 */
export function foregroundMoveBlacklistToWhitelist(
  keyword: string,
): Promise<boolean> {
  return invoke<boolean>("foreground_move_blacklist_to_whitelist", { keyword });
}

/**
 * 获取当前名单配置（用户白/黑名单 + 历史记录）。
 * 后端：`foreground_get_config() -> ForegroundListConfig`
 */
export function foregroundGetConfig(): Promise<ForegroundListConfig> {
  return invoke<ForegroundListConfig>("foreground_get_config");
}

// ===== 事件监听 =====

/** 事件名常量 */
export const FOREGROUND_EVENTS = {
  /** 前台检测就绪 */
  ready: "foreground-ready",
  /** API Key 失效 */
  apiKeyInvalid: "foreground-api-key-invalid",
  /** 检测到娱乐类应用 */
  entertainmentDetected: "foreground-entertainment-detected",
  /** 状态更新 */
  status: "foreground-status",
  /** 检测出错 */
  error: "foreground-error",
} as const;

/**
 * 监听 `foreground-ready` 事件。
 * 返回 Promise<UnlistenFn>，调用方需在适当时机调用以取消监听。
 */
export function onForegroundReady(
  handler: EventCallback<unknown>,
): Promise<UnlistenFn> {
  return listen(FOREGROUND_EVENTS.ready, handler);
}

/**
 * 监听 `foreground-api-key-invalid` 事件。
 */
export function onForegroundApiKeyInvalid(
  handler: EventCallback<unknown>,
): Promise<UnlistenFn> {
  return listen(FOREGROUND_EVENTS.apiKeyInvalid, handler);
}

/**
 * 监听 `foreground-entertainment-detected` 事件（payload 为 DetectionResult）。
 */
export function onForegroundEntertainmentDetected(
  handler: EventCallback<DetectionResult>,
): Promise<UnlistenFn> {
  return listen<DetectionResult>(
    FOREGROUND_EVENTS.entertainmentDetected,
    handler,
  );
}

/**
 * 监听 `foreground-status` 事件（payload 为 ForegroundStatus）。
 */
export function onForegroundStatus(
  handler: EventCallback<ForegroundStatus>,
): Promise<UnlistenFn> {
  return listen<ForegroundStatus>(FOREGROUND_EVENTS.status, handler);
}

/**
 * 监听 `foreground-error` 事件（payload 为错误信息）。
 */
export function onForegroundError(
  handler: EventCallback<string>,
): Promise<UnlistenFn> {
  return listen<string>(FOREGROUND_EVENTS.error, handler);
}
