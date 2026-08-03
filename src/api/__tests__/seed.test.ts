import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { seedRegister, seedHeartbeat, seedUnregister, seedList } from "../seed";

describe("api/seed（Phase 2 安装包种子）", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("seedRegister 应调用 invoke('p2p_seed_register') 并透传版本/文件名/大小", async () => {
    invokeMock.mockResolvedValue(undefined);

    await seedRegister("4.6.0-beta.0", "PomoSolo_4.6.0-beta.0_x64-setup.exe", 12345678);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("p2p_seed_register", {
      version: "4.6.0-beta.0",
      file: "PomoSolo_4.6.0-beta.0_x64-setup.exe",
      size: 12345678,
    });
  });

  it("seedRegister 未传大小时应默认 0", async () => {
    invokeMock.mockResolvedValue(undefined);

    await seedRegister("4.6.0-beta.0", "PomoSolo_4.6.0-beta.0_x64-setup.exe");

    expect(invokeMock).toHaveBeenCalledWith("p2p_seed_register", {
      version: "4.6.0-beta.0",
      file: "PomoSolo_4.6.0-beta.0_x64-setup.exe",
      size: 0,
    });
  });

  it("seedHeartbeat 应调用 invoke('p2p_seed_heartbeat')", async () => {
    invokeMock.mockResolvedValue(undefined);

    await seedHeartbeat();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("p2p_seed_heartbeat");
  });

  it("seedUnregister 应调用 invoke('p2p_seed_unregister')", async () => {
    invokeMock.mockResolvedValue(undefined);

    await seedUnregister();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("p2p_seed_unregister");
  });

  it("seedList 应调用 invoke('p2p_seed_list') 并返回在线种子列表", async () => {
    invokeMock.mockResolvedValue(["uuid-a", "uuid-b"]);

    const peers = await seedList("4.6.0-beta.0");

    expect(invokeMock).toHaveBeenCalledWith("p2p_seed_list", {
      version: "4.6.0-beta.0",
    });
    expect(peers).toEqual(["uuid-a", "uuid-b"]);
  });

  it("seedList 不传版本时应传空字符串（查询全部在线种子）", async () => {
    invokeMock.mockResolvedValue([]);

    await seedList();

    expect(invokeMock).toHaveBeenCalledWith("p2p_seed_list", { version: "" });
  });

  it("seedList 出错时应向上传播", async () => {
    invokeMock.mockRejectedValue(new Error("ws timeout"));
    await expect(seedList("4.6.0-beta.0")).rejects.toThrow("ws timeout");
  });
});
