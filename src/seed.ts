/**
 * 安装包种子管理器（Phase 2：P2P 分享安装包）
 *
 * 生命周期：
 * - startSeedSharing：开启"分享安装包" → 注册种子 + 每 30s 心跳保活
 * - stopSeedSharing：关闭分享 / 退出登录 / 应用卸载 → 注销种子 + 停心跳
 *
 * 服务器 60s 无心跳自动清理（SEED_TTL），客户端注销是 best-effort，
 * 异常退出（应用被强杀）时由服务器 TTL 兜底。
 */
import { seedRegister, seedHeartbeat, seedUnregister } from "@/api/seed";

const HEARTBEAT_INTERVAL_MS = 30_000;

let heartbeatTimer: number | null = null;

/** 构造安装包文件名（与发版产物命名一致） */
export function seedFileName(version: string): string {
  return `PomoSolo_${version}_x64-setup.exe`;
}

/** 是否正在分享（供 UI 状态同步） */
export function isSeeding(): boolean {
  return heartbeatTimer !== null;
}

/**
 * 开启种子分享（需已登录）：
 * 注册本机持有的安装包版本 → 启动 30s 心跳。
 * 重复调用会先注销旧的再重新注册（幂等）。
 */
export async function startSeedSharing(version: string): Promise<void> {
  await stopSeedSharing();
  await seedRegister(version, seedFileName(version), 0);
  heartbeatTimer = window.setInterval(() => {
    void seedHeartbeat().catch((e) => {
      console.warn("[Seed] 心跳失败:", e);
    });
  }, HEARTBEAT_INTERVAL_MS);
}

/**
 * 关闭种子分享：停心跳 + 注销（幂等，未分享时静默返回）
 */
export async function stopSeedSharing(): Promise<void> {
  if (heartbeatTimer !== null) {
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  try {
    await seedUnregister();
  } catch (e) {
    // 未登录/WS 断开等场景注销失败无需上报，服务器 TTL 会兜底清理
    console.warn("[Seed] 注销失败（服务器 TTL 将兜底）:", e);
  }
}
