/**
 * 安装包种子 API（Phase 2：P2P 分享安装包）
 *
 * 服务器只维护"谁在线、谁有哪个版本"的目录服务（ws_server.py p2p:seed_* 消息）：
 * - 种子端：开启分享后注册 + 每 30s 心跳保活 + 关闭时注销
 * - 下载端：更新前查 seed_list 拿在线种子 user_id，再经 peer:* 信令 → WebRTC 直连拉包
 */
import { invoke } from "@tauri-apps/api/core";

/**
 * 注册本机为安装包种子（需已登录）
 *
 * @param version 持有的安装包版本（当前应用版本）
 * @param file 安装包文件名（如 PomoSolo_4.6.0-beta.0_x64-setup.exe）
 * @param size 安装包字节数（未知可传 0，服务器仅做目录服务不校验）
 */
export async function seedRegister(
  version: string,
  file: string,
  size: number = 0,
): Promise<void> {
  await invoke("p2p_seed_register", { version, file, size });
}

/** 种子心跳保活（服务器 60s 无心跳自动清理，客户端每 30s 发一次） */
export async function seedHeartbeat(): Promise<void> {
  await invoke("p2p_seed_heartbeat");
}

/** 注销种子（关闭分享 / 退出登录 / 应用卸载时调用） */
export async function seedUnregister(): Promise<void> {
  await invoke("p2p_seed_unregister");
}

/**
 * 查询持有指定版本安装包的在线种子 user_id 列表（服务器已排除自己）
 *
 * @param version 目标版本；不传则返回全部在线种子
 */
export async function seedList(version?: string): Promise<string[]> {
  return await invoke<string[]>("p2p_seed_list", {
    version: version ?? "",
  });
}

/**
 * 通知某个种子端发起 P2P 传输（v4.6.6 补齐种子端后新增）。
 *
 * 下载端查完种子列表后调用：服务器向种子端转发 `p2p:seed_request`，
 * 种子端据此发起 WebRTC offer 推安装包分片（此前种子端从不主动发起）。
 *
 * @param version 目标安装包版本
 * @param toUserId 种子端 user_id（seedList 返回的第一个）
 */
export async function seedFetch(version: string, toUserId: string): Promise<void> {
  await invoke("p2p_seed_fetch", { version, toUserId });
}
