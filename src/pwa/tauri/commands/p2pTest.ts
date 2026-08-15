/**
 * P2P 连通性测试命令（PWA 实现：WebSocket 信令）
 *
 * 对应桌面端 Rust commands/p2p.rs 的测试工具命令，消息名/字段与桌面端完全一致：
 * - p2p_online                → WS `p2p:online`（请求-响应，服务器回 users: [{userId, username}]）
 * - p2p_test_request          → WS `p2p:test_request` { to_user_id, tag? }
 * - p2p_reverse_test_request  → WS `p2p:reverse_test_request` { to_user_id, tag? }
 * - p2p_bidir_test_request    → WS `p2p:bidir_test_request` { to_user_id, tag1, tag2 }
 * - p2p_test_result           → WS `p2p:test_result` { to_user_id, ok, ms, speed_bps, bytes, error? }
 *
 * 媒体数据走 WebRTC 直连（src/p2p.ts 复用，P2PTestPanel 与 music store 的事件处理原样可用）。
 * 部门：PWA部门 —— 2026-08 PWA 第一版
 */

import { send as wsSend } from "../../ws";

export interface P2POnlineUser {
  userId: string;
  username: string;
}

/** 查询在线用户列表（服务器已排除自己；需登录并连上 WS） */
export async function cmdP2POnline(): Promise<P2POnlineUser[]> {
  const resp = (await wsSend("p2p:online", {})) ?? {};
  const users = Array.isArray(resp.users) ? (resp.users as Record<string, unknown>[]) : [];
  return users.map((u) => ({
    userId: String(u.userId ?? ""),
    username: String(u.username ?? ""),
  }));
}

/** 发起 P2P 测试请求（fire-and-forget，目标端自动挂起 WebRTC 接收） */
export async function cmdP2PTestRequest(args: Record<string, unknown>): Promise<void> {
  const toUserId = String(args.toUserId ?? "");
  if (!toUserId) throw new Error("缺少测试目标");
  const params: Record<string, unknown> = { to_user_id: toUserId };
  const tag = String(args.tag ?? "");
  if (tag) params.tag = tag;
  await wsSend("p2p:test_request", params, { withId: false });
}

/** 请求目标端反向发起 P2P 测试（首个方向失败后调用） */
export async function cmdP2PReverseTestRequest(args: Record<string, unknown>): Promise<void> {
  const toUserId = String(args.toUserId ?? "");
  if (!toUserId) throw new Error("缺少测试目标");
  const params: Record<string, unknown> = { to_user_id: toUserId };
  const tag = String(args.tag ?? "");
  if (tag) params.tag = tag;
  await wsSend("p2p:reverse_test_request", params, { withId: false });
}

/** AB 互相打洞测试请求（目标端同时挂 answerer(tag1) + offerer(tag2)） */
export async function cmdP2PBidirTestRequest(args: Record<string, unknown>): Promise<void> {
  const toUserId = String(args.toUserId ?? "");
  const tag1 = String(args.tag1 ?? "");
  const tag2 = String(args.tag2 ?? "");
  if (!toUserId || !tag1 || !tag2) throw new Error("缺少互相打洞测试参数");
  await wsSend("p2p:bidir_test_request", { to_user_id: toUserId, tag1, tag2 }, { withId: false });
}

/** 目标端回传测试结果给发起方 */
export async function cmdP2PTestResult(args: Record<string, unknown>): Promise<void> {
  const toUserId = String(args.toUserId ?? "");
  if (!toUserId) throw new Error("缺少测试目标");
  const params: Record<string, unknown> = {
    to_user_id: toUserId,
    ok: !!args.ok,
    ms: Number(args.ms ?? 0),
    speed_bps: Number(args.speedBps ?? 0),
    bytes: Number(args.bytes ?? 0),
  };
  const error = String(args.error ?? "");
  if (error) params.error = error;
  await wsSend("p2p:test_result", params, { withId: false });
}
