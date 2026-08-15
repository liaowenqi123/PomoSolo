/**
 * 用户反馈命令（PWA 实现：REST /api/v1/feedback）
 *
 * 与桌面端 Rust commands/cloud_auth.rs 的 submit_feedback / get_user_feedbacks /
 * delete_feedback 对齐：POST / GET / DELETE /api/v1/feedback（Bearer 鉴权，
 * 401 由 http.ts 自动刷新重试）。未登录提交返回"请先登录"；列表未登录返回空数组。
 *
 * 部门：PWA部门 —— 2026-08 PWA 第一版
 */

import { apiGet, apiPost, apiDelete } from "../../http";

/** 反馈记录（与前端 src/api/feedback.ts 的 FeedbackItem 对齐，camelCase） */
export interface FeedbackItem {
  id: number;
  feedbackContent: string;
  feedbackStatus: number;
  createTime: string | null;
  remark: string | null;
}

/** 提交反馈（服务器行字段为 content；返回 true） */
export async function cmdSubmitFeedback(args: Record<string, unknown>): Promise<boolean> {
  const content = String(args.content ?? "").trim();
  if (!content) throw new Error("反馈内容不能为空");
  if (content.length > 500) throw new Error("反馈内容不能超过 500 字");
  await apiPost("/feedback", { content });
  return true;
}

/** 获取当前用户反馈列表（未登录时服务器返回空数组） */
export async function cmdGetUserFeedbacks(): Promise<FeedbackItem[]> {
  const rows = (await apiGet<unknown>("/feedback").catch(() => [])) as Record<string, unknown>[];
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    id: Number(r.id ?? 0),
    feedbackContent: String(r.content ?? ""),
    feedbackStatus: Number(r.status ?? 0),
    createTime: r.create_time != null ? String(r.create_time) : null,
    remark: r.remark != null ? String(r.remark) : null,
  }));
}

/** 删除指定反馈（仅自己的） */
export async function cmdDeleteFeedback(args: Record<string, unknown>): Promise<boolean> {
  const id = Number(args.feedbackId ?? 0);
  await apiDelete(`/feedback/${id}`);
  return true;
}
