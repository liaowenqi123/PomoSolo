/**
 * AI 规划助手 API
 *
 * 对应 Electron 旧版 ipc-ai.js + aiHelper.js 中的 window.electronAPI.aiGeneratePlan 调用。
 * 调用后端（DeepSeek 云端或本地）生成番茄钟计划。
 *
 * 命令命名（Rust 端 snake_case）：
 * - ai_generate_plan(input) -> 生成计划
 */
import { invoke } from "@tauri-apps/api/core";

// ===== 类型定义 =====

export interface AiPlanItem {
  type: "work" | "break";
  minutes: number;
  description?: string;
}

export interface AiPlanData {
  summary?: string;
  plan: AiPlanItem[];
}

export interface AiGenerateResult {
  success: boolean;
  data?: AiPlanData;
  error?: string;
}

// ===== API =====

/** 生成番茄钟计划 */
export function aiGeneratePlan(input: string): Promise<AiGenerateResult> {
  return invoke<AiGenerateResult>("ai_generate_plan", { input });
}
