import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const seedApi = vi.hoisted(() => ({
  seedRegister: vi.fn(),
  seedHeartbeat: vi.fn(),
  seedUnregister: vi.fn(),
  seedList: vi.fn(),
}));

vi.mock("@/api/seed", () => seedApi);

import {
  startSeedSharing,
  stopSeedSharing,
  isSeeding,
  seedFileName,
} from "../seed";

describe("seed（Phase 2 种子管理器）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    for (const fn of Object.values(seedApi)) fn.mockReset();
    seedApi.seedRegister.mockResolvedValue(undefined);
    seedApi.seedHeartbeat.mockResolvedValue(undefined);
    seedApi.seedUnregister.mockResolvedValue(undefined);
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
});
