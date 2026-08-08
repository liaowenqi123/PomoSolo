/**
 * P2P 连通性测试 API（Phase 1.2+）
 *
 * 设置面板"P2P 测试工具"：查询在线用户 → 选目标发起 WebRTC 建连测试（跨 NAT 打洞 + 直连测速）。
 * 服务器只做 KB 级信令转发 + 在线目录（ws_server.py p2p:online / p2p:test_request / p2p:test_result），
 * 媒体数据仍走两端 WebRTC 直连。
 */
import { invoke } from "@tauri-apps/api/core";

/** 在线用户（测试目标候选） */
export interface P2POnlineUser {
  userId: string;
  username: string;
}

/** 查询在线用户列表（服务器已排除自己） */
export async function p2pOnline(): Promise<P2POnlineUser[]> {
  return await invoke<P2POnlineUser[]>("p2p_online");
}

/** 发起 P2P 测试请求（fire-and-forget，目标端自动挂起 WebRTC 接收）。
 *  `tag`（v4.7.7）：3 种打洞方式用不同 tag 区分多条并发连接。 */
export async function p2pTestRequest(toUserId: string, tag?: string): Promise<void> {
  await invoke("p2p_test_request", { toUserId, tag: tag ?? "" });
}

/** 请求目标端反向发起 P2P 测试（v4.7.3 双向打洞容错：首个方向失败后调用） */
export async function p2pReverseTestRequest(toUserId: string, tag?: string): Promise<void> {
  await invoke("p2p_reverse_test_request", { toUserId, tag: tag ?? "" });
}

/** AB 互相打洞测试请求（v4.7.7）：目标端同时挂 answerer(tag1) + 发起 offerer(tag2)，
 *  两条连接同时打洞、双向同时测速。 */
export async function p2pBidirTestRequest(toUserId: string, tag1: string, tag2: string): Promise<void> {
  await invoke("p2p_bidir_test_request", { toUserId, tag1, tag2 });
}

/** 目标端回传 P2P 测试结果给发起方（发起方 UI 显示双方视角） */
export async function p2pTestResult(params: {
  toUserId: string;
  ok: boolean;
  ms: number;
  speedBps: number;
  bytes: number;
  error?: string;
}): Promise<void> {
  await invoke("p2p_test_result", {
    toUserId: params.toUserId,
    ok: params.ok,
    ms: params.ms,
    speedBps: params.speedBps,
    bytes: params.bytes,
    error: params.error ?? "",
  });
}
