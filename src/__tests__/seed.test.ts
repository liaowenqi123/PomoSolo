import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const seedApi = vi.hoisted(() => ({
  seedRegister: vi.fn(),
  seedHeartbeat: vi.fn(),
  seedUnregister: vi.fn(),
  seedList: vi.fn(),
}));

vi.mock("@/api/seed", () => seedApi);

const updateApi = vi.hoisted(() => ({
  updateSeedHasInstaller: vi.fn(),
  updateSeedReadChunk: vi.fn(),
}));

vi.mock("@/api/update", () => updateApi);

const p2pApi = vi.hoisted(() => ({
  p2pSend: vi.fn<any>(() => ({ close: vi.fn() })),
}));

vi.mock("@/p2p", () => p2pApi);

import {
  startSeedSharing,
  stopSeedSharing,
  isSeeding,
  seedFileName,
  serveInstaller,
} from "../seed";

describe("seed（Phase 2 种子管理器）", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    for (const fn of Object.values(seedApi)) fn.mockReset();
    for (const fn of Object.values(updateApi)) fn.mockReset();
    p2pApi.p2pSend.mockReset();
    seedApi.seedRegister.mockResolvedValue(undefined);
    seedApi.seedHeartbeat.mockResolvedValue(undefined);
    seedApi.seedUnregister.mockResolvedValue(undefined);
    updateApi.updateSeedHasInstaller.mockResolvedValue(true);
    // 重置模块级心跳状态（上个用例可能已启动心跳定时器，否则 isSeeding 判断会串）
    await stopSeedSharing();
    // 清掉 beforeEach 自身触发的注销调用，避免影响用例内的断言计数
    seedApi.seedUnregister.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("seedFileName 应构造发版命名格式", () => {
    expect(seedFileName("4.6.0-beta.0")).toBe("PomoSolo_4.6.0-beta.0_x64-setup.exe");
    expect(seedFileName("4.5.17")).toBe("PomoSolo_4.5.17_x64-setup.exe");
  });

  it("未分享时 isSeeding 为 false", () => {
    expect(isSeeding()).toBe(false);
  });

  it("startSeedSharing 应注册种子并启动心跳定时器", async () => {
    await startSeedSharing("4.6.0-beta.0");

    expect(updateApi.updateSeedHasInstaller).toHaveBeenCalledWith("4.6.0-beta.0");
    expect(seedApi.seedRegister).toHaveBeenCalledTimes(1);
    expect(seedApi.seedRegister).toHaveBeenCalledWith(
      "4.6.0-beta.0",
      "PomoSolo_4.6.0-beta.0_x64-setup.exe",
      0,
    );
    expect(isSeeding()).toBe(true);

    // 30s 后触发心跳
    seedApi.seedHeartbeat.mockClear();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(seedApi.seedHeartbeat).toHaveBeenCalledTimes(1);

    // 60s → 第二次心跳
    await vi.advanceTimersByTimeAsync(30_000);
    expect(seedApi.seedHeartbeat).toHaveBeenCalledTimes(2);
  });

  it("本机未留存安装包时 startSeedSharing 应抛错且不注册（v4.6.6）", async () => {
    updateApi.updateSeedHasInstaller.mockResolvedValue(false);

    await expect(startSeedSharing("4.6.0-beta.0")).rejects.toThrow("本机暂无安装包可分享");
    expect(seedApi.seedRegister).not.toHaveBeenCalled();
    expect(isSeeding()).toBe(false);
  });

  it("stopSeedSharing 应注销并停止心跳", async () => {
    await startSeedSharing("4.6.0-beta.0");
    seedApi.seedHeartbeat.mockClear();
    seedApi.seedUnregister.mockClear(); // start 内部清理已注销过，此处只看 stop 的行为

    await stopSeedSharing();

    expect(seedApi.seedUnregister).toHaveBeenCalledTimes(1);
    expect(isSeeding()).toBe(false);

    // 心跳定时器已清理，时间推进不再触发
    await vi.advanceTimersByTimeAsync(90_000);
    expect(seedApi.seedHeartbeat).not.toHaveBeenCalled();
  });

  it("stopSeedSharing 未分享时应静默返回（幂等）", async () => {
    await stopSeedSharing();
    expect(seedApi.seedUnregister).toHaveBeenCalledTimes(1);
    expect(isSeeding()).toBe(false);
  });

  it("startSeedSharing 重复调用应先注销旧种子再重新注册（幂等）", async () => {
    await startSeedSharing("4.6.0-beta.0");
    seedApi.seedUnregister.mockClear(); // 第一次 start 内部清理注销，清除后看第二次的行为
    await startSeedSharing("4.6.0-beta.1");

    expect(seedApi.seedUnregister).toHaveBeenCalledTimes(1);
    expect(seedApi.seedRegister).toHaveBeenCalledTimes(2);
    expect(seedApi.seedRegister).toHaveBeenLastCalledWith(
      "4.6.0-beta.1",
      "PomoSolo_4.6.0-beta.1_x64-setup.exe",
      0,
    );
  });

  it("心跳失败不应中断定时器（catch 吞掉）", async () => {
    seedApi.seedHeartbeat.mockRejectedValue(new Error("ws down"));
    await startSeedSharing("4.6.0-beta.0");

    seedApi.seedHeartbeat.mockClear();
    await vi.advanceTimersByTimeAsync(30_000);
    // 下次仍会触发（interval 未清除）
    seedApi.seedHeartbeat.mockClear();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(seedApi.seedHeartbeat).toHaveBeenCalledTimes(1);
  });

  it("serveInstaller 收到 seed_request 应读安装包分片并发起 offerer（v4.6.6）", async () => {
    updateApi.updateSeedReadChunk.mockImplementation(
      async (_v: string, index: number) => ({
        success: true,
        total_chunks: 3,
        chunk_size: 256 * 1024,
        data: [index, index + 1, index + 2],
      }),
    );

    serveInstaller({ from_user_id: "peer-123", version: "4.6.6" });

    // 异步初始化：读第一片后再 p2pSend
    await Promise.resolve();
    await Promise.resolve();

    expect(updateApi.updateSeedReadChunk).toHaveBeenCalledWith("4.6.6", 0);
    expect(p2pApi.p2pSend).toHaveBeenCalledTimes(1);
    const sendOpts = p2pApi.p2pSend.mock.calls[0][0] as {
      peerId: string;
      role: string;
      totalBytes: number;
      chunkSize: number;
      sendChunk: (index: number) => Promise<Uint8Array>;
    };
    expect(sendOpts.peerId).toBe("peer-123");
    expect(sendOpts.role).toBe("offerer");
    expect(sendOpts.totalBytes).toBe(3 * 256 * 1024);
    expect(sendOpts.chunkSize).toBe(256 * 1024);

    // sendChunk 逐片读取
    const chunk = await sendOpts.sendChunk(1);
    expect(updateApi.updateSeedReadChunk).toHaveBeenCalledWith("4.6.6", 1);
    expect(chunk).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("serveInstaller 缺失 from_user_id/version 应忽略", () => {
    serveInstaller({});
    serveInstaller({ from_user_id: "x" });
    expect(updateApi.updateSeedReadChunk).not.toHaveBeenCalled();
    expect(p2pApi.p2pSend).not.toHaveBeenCalled();
  });

  it("serveInstaller 读第一片失败应放弃响应", async () => {
    updateApi.updateSeedReadChunk.mockResolvedValue({ success: false, error: "文件不存在" });

    serveInstaller({ from_user_id: "peer-123", version: "4.6.6" });
    await Promise.resolve();
    await Promise.resolve();

    expect(p2pApi.p2pSend).not.toHaveBeenCalled();
  });
});
