/**
 * 用户反馈 API
 *
 * 对接 Supabase `feedback` 表，与旧 Electron 版 cloudAuth.js 的三个反馈方法对齐。
 * 用户身份由后端从 AppState.cloud_session 取，前端无需传 user_id。
 */
import { invoke } from "@tauri-apps/api/core";

/** 反馈状态码（与后端 Rust 定义一致） */
export const FEEDBACK_STATUS = {
  RECEIVED: 0, // 已收到
  ACCEPTED_PENDING: 1, // 已采纳（待更新）
  ACCEPTED_UPDATED: 2, // 已采纳（已更新）
  REJECTED: 3, // 已拒绝
} as const;

/** 反馈状态标签（与 temp-debug/feedback.mjs 的 STATUS_LABELS 一致） */
export const FEEDBACK_STATUS_LABELS: Record<number, string> = {
  0: "已收到",
  1: "已采纳(待更新)",
  2: "已采纳(已更新)",
  3: "已拒绝",
};

/** 反馈记录（与 Rust `FeedbackItem` 对齐，camelCase） */
export interface FeedbackItem {
  id: number;
  feedbackContent: string;
  feedbackStatus: number;
  createTime: string | null;
  remark: string | null;
}

/**
 * 提交反馈。
 * 后端：`submit_feedback(content: String) -> Result<bool, String>`
 * 未登录会返回错误 "请先登录后再提交反馈"。
 */
export function submitFeedback(content: string): Promise<boolean> {
  return invoke<boolean>("submit_feedback", { content });
}

/**
 * 获取当前用户的反馈列表（按创建时间降序，最多 50 条）。
 * 后端：`get_user_feedbacks() -> Result<Vec<FeedbackItem>, String>`
 * 未登录返回空数组（前端据此显示"去登录"提示）。
 */
export function getUserFeedbacks(): Promise<FeedbackItem[]> {
  return invoke<FeedbackItem[]>("get_user_feedbacks");
}

/**
 * 删除指定反馈（仅可删除自己的反馈）。
 * 后端：`delete_feedback(feedback_id: i64) -> Result<bool, String>`
 */
export function deleteFeedback(feedbackId: number): Promise<boolean> {
  return invoke<boolean>("delete_feedback", { feedbackId });
}
