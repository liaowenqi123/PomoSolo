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

/**
 * 获取当前用户反馈列表（未登录时服务器返回空数组）。
 *
 * ⚠️ 服务器 GET /api/v1/feedback 返回的是**对象**：
 *   { "feedbacks": [ { "id", "feedback_content"|"content", "feedback_status"|"status",
 *                      "remark", "create_time" } ] }
 * 旧实现把整个响应当数组用（Array.isArray 恒 false）→ 永远返回 [] ——
 * 这是"提交反馈后列表不可见"的根因（field 名两种写法都兼容，见 server-planning/README.md）。
 */
export async function cmdGetUserFeedbacks(): Promise<FeedbackItem[]> {
  const data = (await apiGet<unknown>("/feedback").catch(() => ({}))) as Record<string, unknown>;
  const rows = Array.isArray(data)
    ? data
    : Array.isArray(data.feedbacks)
      ? (data.feedbacks as unknown[])
      : [];
  return rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: Number(row.id ?? 0),
      feedbackContent: String(row.feedback_content ?? row.content ?? ""),
      feedbackStatus: Number(row.feedback_status ?? row.status ?? 0),
      createTime: row.create_time != null ? String(row.create_time) : null,
      remark: row.remark != null ? String(row.remark) : null,
    };
  });
}

/** 删除指定反馈（仅自己的） */
export async function cmdDeleteFeedback(args: Record<string, unknown>): Promise<boolean> {
  const id = Number(args.feedbackId ?? 0);
  await apiDelete(`/feedback/${id}`);
  return true;
}
