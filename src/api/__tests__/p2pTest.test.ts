import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  p2pOnline,
  p2pTestRequest,
  p2pReverseTestRequest,
  p2pBidirTestRequest,
  p2pTestResult,
} from "../p2pTest";

describe("api/p2pTest", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("p2pOnline 返回在线用户", async () => {
    const users = [{ userId: "u1", username: "alice" }];
    invokeMock.mockResolvedValue(users);
    await expect(p2pOnline()).resolves.toEqual(users);
    expect(invokeMock).toHaveBeenCalledWith("p2p_online");
  });

  it("p2pTestRequest 缺省 tag 传空串", async () => {
    invokeMock.mockResolvedValue(undefined);
    await p2pTestRequest("u2");
    expect(invokeMock).toHaveBeenCalledWith("p2p_test_request", { toUserId: "u2", tag: "" });
  });

  it("p2pReverseTestRequest 透传 tag", async () => {
    invokeMock.mockResolvedValue(undefined);
    await p2pReverseTestRequest("u3", "reverse");
    expect(invokeMock).toHaveBeenCalledWith("p2p_reverse_test_request", {
      toUserId: "u3",
      tag: "reverse",
    });
  });

  it("p2pBidirTestRequest 透传两个 tag", async () => {
    invokeMock.mockResolvedValue(undefined);
    await p2pBidirTestRequest("u4", "offer", "answer");
    expect(invokeMock).toHaveBeenCalledWith("p2p_bidir_test_request", {
      toUserId: "u4",
      tag1: "offer",
      tag2: "answer",
    });
  });

  it("p2pTestResult 缺省 error 传空串", async () => {
    invokeMock.mockResolvedValue(undefined);
    await p2pTestResult({ toUserId: "u5", ok: true, ms: 12, speedBps: 1024, bytes: 2048 });
    expect(invokeMock).toHaveBeenCalledWith("p2p_test_result", {
      toUserId: "u5",
      ok: true,
      ms: 12,
      speedBps: 1024,
      bytes: 2048,
      error: "",
    });
  });
});
