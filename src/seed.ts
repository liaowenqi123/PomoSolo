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
import {
  updateSeedReadChunk,
  updateSeedHasInstaller,
} from "@/api/update";
import { p2pSend } from "@/p2p";

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
 * 校验本机已留存安装包 → 注册本机持有的安装包版本 → 启动 30s 心跳。
 * 重复调用会先注销旧的再重新注册（幂等）。
 *
 * 安装包来源：更新成功后由 Rust 自动留存到安装目录
 * resources/installers/PomoSolo_<version>_x64-setup.exe（只保留最新版本）。
 * 从未更新过的安装版本机没有留存文件 → 抛错提示先完成一次更新。
 */
export async function startSeedSharing(version: string): Promise<void> {
  const has = await updateSeedHasInstaller(version).catch(() => false);
  if (!has) {
    throw new Error("本机暂无安装包可分享（完成一次更新后自动留存）");
  }
  await stopSeedSharing();
  await seedRegister(version, seedFileName(version), 0);
  heartbeatTimer = window.setInterval(() => {
    void seedHeartbeat().catch((e) => {
      console.warn("[Seed] 心跳失败:", e);
    });
  }, HEARTBEAT_INTERVAL_MS);
}

/**
 * 种子端：响应下载端的 P2P 安装包请求（v4.6.6 补齐种子端后新增）。
 *
 * 下载端 `seedFetch` → 服务器向本机转发 `p2p:seed_request` →
 * 本机作为 offerer 读留存的安装包分片推送给下载端（WebRTC DataChannel）。
 * 之前种子端从不主动发起，导致下载端只能挂 10s 超时回退服务器/GitHub。
 */
export function serveInstaller(evt: Record<string, unknown>): void {
  const fromUserId = typeof evt.from_user_id === "string" ? evt.from_user_id : "";
  const version = typeof evt.version === "string" ? evt.version : "";
  if (!fromUserId || !version) return;
  void (async () => {
    try {
      // 先读第一片拿 total_chunks / chunk_size，估算文件总字节数（供 meta 通知下载端）
      const first = await updateSeedReadChunk(version, 0);
      if (!first.success || !first.total_chunks || !first.chunk_size) {
        console.warn("[Seed] 读取安装包失败，无法响应:", first.error ?? "未知错误");
        return;
      }
      const totalChunks = first.total_chunks;
      const chunkSize = first.chunk_size;
      p2pSend({
        peerId: fromUserId,
        role: "offerer",
        totalBytes: totalChunks * chunkSize, // 估算：最后一片不满，下载端按 totalChunks 判定收齐
        chunkSize,
        timeoutMs: 8_000,
        sendChunk: async (index) => {
          const res = await updateSeedReadChunk(version, index);
          if (!res.success || !res.data) throw new Error(res.error ?? "读取安装包分片失败");
          return new Uint8Array(res.data);
        },
        callbacks: {
          onComplete: (stats) => {
            console.log(
              `[Seed] 已分享安装包 ${version}（${totalChunks} 片，${(stats.speedBps / 1048576).toFixed(1)} MB/s）`,
            );
          },
          onError: (err) => {
            console.warn("[Seed] 分享安装包失败:", err);
          },
        },
      });
    } catch (e) {
      console.warn("[Seed] 响应种子请求失败:", e);
    }
  })();
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
