import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock @tauri-apps/api/core 的 invoke 函数
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { aiGeneratePlan } from "../ai";

describe("api/ai", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("aiGeneratePlan 应调用 invoke('ai_generate_plan', { input })", async () => {
    const fakeResult = {
      success: true,
      data: {
        summary: "计划摘要",
        plan: [
          { type: "work" as const, minutes: 25, description: "任务1" },
          { type: "break" as const, minutes: 5 },
        ],
      },
    };
    invokeMock.mockResolvedValue(fakeResult);

    const result = await aiGeneratePlan("复习高数");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("ai_generate_plan", {
      input: "复习高数",
    });
    expect(result).toEqual(fakeResult);
  });

  it("aiGeneratePlan 传空串时应将空串透传给后端", async () => {
    invokeMock.mockResolvedValue({ success: false, error: "输入为空" });

    await aiGeneratePlan("");

    expect(invokeMock).toHaveBeenCalledWith("ai_generate_plan", { input: "" });
  });

  it("aiGeneratePlan 传含空格的特殊字符串时应原样透传", async () => {
    invokeMock.mockResolvedValue({ success: true });

    const input = "  我需要 复习 高数  ";
    await aiGeneratePlan(input);

    expect(invokeMock).toHaveBeenCalledWith("ai_generate_plan", { input });
  });

  it("aiGeneratePlan 失败结果应原样透传", async () => {
    const failResult = { success: false, error: "API Key 无效" };
    invokeMock.mockResolvedValue(failResult);

    const result = await aiGeneratePlan("test");
    expect(result).toEqual(failResult);
    expect(result.success).toBe(false);
  });

  it("invoke 抛错时应向上传播错误", async () => {
    invokeMock.mockRejectedValue(new Error("network error"));

    await expect(aiGeneratePlan("test")).rejects.toThrow("network error");
  });

  it("命令名应为 ai_generate_plan（snake_case）", async () => {
    invokeMock.mockResolvedValue({ success: true });

    await aiGeneratePlan("test");

    const cmdName = invokeMock.mock.calls[0][0];
    expect(cmdName).toBe("ai_generate_plan");
    // 不应是 camelCase
    expect(cmdName).not.toBe("aiGeneratePlan");
  });

  it("参数名应为 input（snake_case）", async () => {
    invokeMock.mockResolvedValue({ success: true });

    await aiGeneratePlan("test");

    const args = invokeMock.mock.calls[0][1] as Record<string, unknown>;
    expect(args).toHaveProperty("input");
    expect(args.input).toBe("test");
    // 不应使用其他参数名
    expect(args).not.toHaveProperty("prompt");
    expect(args).not.toHaveProperty("text");
  });
});
