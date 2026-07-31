import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  submitFeedback,
  getUserFeedbacks,
  deleteFeedback,
  FEEDBACK_STATUS,
  FEEDBACK_STATUS_LABELS,
} from "../feedback";

describe("api/feedback", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  // ===== submitFeedback =====

  it("submitFeedback 应调用 invoke('submit_feedback', { content })", async () => {
    invokeMock.mockResolvedValue(true);

    const result = await submitFeedback("希望增加深色模式");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("submit_feedback", {
      content: "希望增加深色模式",
    });
    expect(result).toBe(true);
  });

  it("submitFeedback 空串应透传给后端（由后端校验）", async () => {
    invokeMock.mockResolvedValue(true);
    await submitFeedback("");
    expect(invokeMock).toHaveBeenCalledWith("submit_feedback", { content: "" });
  });

  it("submitFeedback 长文本应正常透传", async () => {
    invokeMock.mockResolvedValue(true);
    const long = "x".repeat(500);
    await submitFeedback(long);
    expect(invokeMock).toHaveBeenCalledWith("submit_feedback", { content: long });
  });

  // ===== getUserFeedbacks =====

  it("getUserFeedbacks 应调用 invoke('get_user_feedbacks') 无参数", async () => {
    const fakeList = [
      {
        id: 1,
        feedbackContent: "建议1",
        feedbackStatus: 0,
        createTime: "2026-01-01T00:00:00Z",
        remark: null,
      },
    ];
    invokeMock.mockResolvedValue(fakeList);

    const result = await getUserFeedbacks();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("get_user_feedbacks");
    expect(result).toEqual(fakeList);
  });

  it("getUserFeedbacks 无反馈时应返回空数组", async () => {
    invokeMock.mockResolvedValue([]);
    const result = await getUserFeedbacks();
    expect(result).toEqual([]);
  });

  it("getUserFeedbacks 应保留完整字段（含 remark）", async () => {
    const fakeList = [
      {
        id: 7,
        feedbackContent: "已采纳的建议",
        feedbackStatus: 2,
        createTime: "2026-07-31T12:00:00Z",
        remark: "v4.1 已上线",
      },
    ];
    invokeMock.mockResolvedValue(fakeList);
    const result = await getUserFeedbacks();
    expect(result[0].remark).toBe("v4.1 已上线");
    expect(result[0].feedbackStatus).toBe(2);
  });

  // ===== deleteFeedback =====

  it("deleteFeedback 应调用 invoke('delete_feedback', { feedbackId })", async () => {
    invokeMock.mockResolvedValue(true);

    const result = await deleteFeedback(42);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("delete_feedback", { feedbackId: 42 });
    expect(result).toBe(true);
  });

  it("deleteFeedback id=0 时应透传（由后端校验）", async () => {
    invokeMock.mockResolvedValue(false);
    await deleteFeedback(0);
    expect(invokeMock).toHaveBeenCalledWith("delete_feedback", { feedbackId: 0 });
  });

  it("deleteFeedback 负数 id 应透传", async () => {
    invokeMock.mockResolvedValue(false);
    await deleteFeedback(-1);
    expect(invokeMock).toHaveBeenCalledWith("delete_feedback", { feedbackId: -1 });
  });

  // ===== 错误传播 =====

  it("invoke 抛错时应向上传播错误", async () => {
    invokeMock.mockRejectedValue(new Error("backend error"));

    await expect(submitFeedback("x")).rejects.toThrow("backend error");
    await expect(getUserFeedbacks()).rejects.toThrow("backend error");
    await expect(deleteFeedback(1)).rejects.toThrow("backend error");
  });

  // ===== 常量 =====

  it("FEEDBACK_STATUS 应包含 4 个状态码", () => {
    expect(FEEDBACK_STATUS.RECEIVED).toBe(0);
    expect(FEEDBACK_STATUS.ACCEPTED_PENDING).toBe(1);
    expect(FEEDBACK_STATUS.ACCEPTED_UPDATED).toBe(2);
    expect(FEEDBACK_STATUS.REJECTED).toBe(3);
  });

  it("FEEDBACK_STATUS_LABELS 应覆盖所有状态码", () => {
    // 每个状态码都应有对应的中文标签
    for (const code of Object.values(FEEDBACK_STATUS)) {
      expect(FEEDBACK_STATUS_LABELS[code]).toBeTruthy();
      expect(typeof FEEDBACK_STATUS_LABELS[code]).toBe("string");
    }
  });

  it("FEEDBACK_STATUS_LABELS 标签应为预期中文文案", () => {
    expect(FEEDBACK_STATUS_LABELS[0]).toBe("已收到");
    expect(FEEDBACK_STATUS_LABELS[1]).toBe("已采纳(待更新)");
    expect(FEEDBACK_STATUS_LABELS[2]).toBe("已采纳(已更新)");
    expect(FEEDBACK_STATUS_LABELS[3]).toBe("已拒绝");
  });

  // ===== 命令名互不相同 =====

  it("所有命令名应互不相同", async () => {
    invokeMock.mockResolvedValue(undefined);
    await submitFeedback("x");
    await getUserFeedbacks();
    await deleteFeedback(1);

    const names = invokeMock.mock.calls.map((c) => c[0]);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
    expect(unique).toEqual(
      new Set(["submit_feedback", "get_user_feedbacks", "delete_feedback"]),
    );
  });
});
