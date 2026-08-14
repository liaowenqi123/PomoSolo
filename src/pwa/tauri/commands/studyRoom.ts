/**
 * 自习室命令（PWA 实现：REST + WebSocket）
 *
 * 与桌面端 Rust commands/study_room.rs 行为对齐：
 * - 列表/详情/删除/更新/排名 → REST（/api/v1/rooms...）
 * - 创建/加入/退出/统计 → WebSocket（room:create / room:join / room:leave / room:pomo_done）
 * - 成员列表 → presence:update 触达 + 服务器 room:members 推送（组件经 ws-event 消费）
 * - 心跳 → ping
 *
 * 部门：PWA部门 —— 2026-08 PWA 第一版
 */

import { apiGet, apiPut, apiDelete } from "../../http";
import { send as wsSend } from "../../ws";

export interface StudyRoom {
  id: string;
  name: string;
  description?: string;
  ownerId?: string;
  creatorName?: string;
  memberCount?: number;
  isPublic?: boolean;
  hasPassword?: boolean;
}

export interface StudyRoomMember {
  userId: string;
  username: string;
  todayMinutes?: number;
  online?: boolean;
  status?: string;
}

export interface StudyRoomRankingEntry {
  username: string;
  todayMinutes: number;
  rank: number;
}

function parseRoom(row: Record<string, unknown>): StudyRoom {
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    description: row.description as string | undefined,
    ownerId: (row.owner_id ?? row.ownerId) as string | undefined,
    creatorName: row.creator_name as string | undefined,
    memberCount: row.member_count as number | undefined,
    isPublic: row.is_public as boolean | undefined,
    hasPassword: row.has_password as boolean | undefined,
  };
}

function requireLogin(): void {
  // 未登录时 REST 会返回 401（http.ts 自动刷新失败后抛错），WS 由服务器认证
}

export async function cmdStudyRoomGetActive(): Promise<StudyRoom[]> {
  requireLogin();
  const data = await apiGet<{ rooms?: Record<string, unknown>[] }>("/rooms");
  return (data.rooms ?? []).map(parseRoom);
}

export async function cmdStudyRoomCreate(
  args: Record<string, unknown>,
): Promise<StudyRoom> {
  const name = String(args.name ?? "").trim();
  if (!name) throw new Error("自习室名称不能为空");
  const resp = (await wsSend("room:create", {
    name,
    max_members: 50,
    password: String(args.password ?? ""),
    description: String(args.description ?? ""),
  })) ?? {};
  const roomVal = (resp.room ?? resp) as Record<string, unknown>;
  const room = parseRoom(roomVal);
  room.creatorName = String(resp.username ?? room.creatorName ?? "");
  room.memberCount = 1;
  room.hasPassword = !!args.password;
  return room;
}

export async function cmdStudyRoomJoin(args: Record<string, unknown>): Promise<void> {
  await wsSend("room:join", {
    room_id: String(args.roomId ?? ""),
    password: String(args.password ?? ""),
  });
}

export async function cmdStudyRoomLeave(args: Record<string, unknown>): Promise<void> {
  await wsSend("room:leave", { room_id: String(args.roomId ?? "") }, { withId: false });
}

export async function cmdStudyRoomGetDetail(args: Record<string, unknown>): Promise<StudyRoom> {
  const roomId = String(args.roomId ?? "");
  const data = await apiGet<Record<string, unknown>>(`/rooms/${roomId}`);
  return parseRoom(data);
}

export async function cmdStudyRoomDelete(args: Record<string, unknown>): Promise<boolean> {
  const roomId = String(args.roomId ?? "");
  await apiDelete(`/rooms/${roomId}`);
  return true;
}

export async function cmdStudyRoomUpdate(
  args: Record<string, unknown>,
): Promise<boolean> {
  const roomId = String(args.roomId ?? "");
  const body: Record<string, unknown> = {};
  if (args.isPublic !== undefined) body.is_public = args.isPublic;
  if (args.name !== undefined) body.name = args.name;
  if (args.description !== undefined) body.description = args.description;
  if (args.password !== undefined) body.password = args.password;
  if (Object.keys(body).length === 0) throw new Error("没有需要更新的字段");
  await apiPut(`/rooms/${roomId}`, body);
  return true;
}

export async function cmdStudyRoomGetRanking(
  args: Record<string, unknown>,
): Promise<StudyRoomRankingEntry[]> {
  const roomId = String(args.roomId ?? "");
  const data = await apiGet<{ leaderboard?: Record<string, unknown>[] }>(
    `/rooms/${roomId}/leaderboard?period=today`,
  );
  return (data.leaderboard ?? []).map((e, i) => ({
    username: String(e.nickname ?? e.username ?? "未知用户"),
    todayMinutes: Math.floor(Number(e.focus_seconds ?? 0) / 60),
    rank: i + 1,
  }));
}

export async function cmdStudyRoomGetMembers(
  args: Record<string, unknown>,
): Promise<StudyRoomMember[]> {
  // 触发一次 presence:update，服务器随即推送 room:members（组件经 ws-event 消费）
  await wsSend(
    "presence:update",
    { status: "idle", room_id: String(args.roomId ?? "") },
    { withId: false },
  ).catch(() => {});
  return [];
}

export async function cmdStudyRoomUploadStats(
  args: Record<string, unknown>,
): Promise<boolean> {
  const todayCount = Number(args.todayCount ?? 0);
  const mode = todayCount > 0 ? "focus" : "short_break";
  await wsSend(
    "room:pomo_done",
    {
      room_id: String(args.roomId ?? ""),
      mode,
      duration: Number(args.todayMinutes ?? 0) * 60,
    },
    { withId: false },
  );
  return true;
}

export async function cmdStudyRoomUpdateStatus(
  args: Record<string, unknown>,
): Promise<boolean> {
  await wsSend("ping", { room_id: String(args.roomId ?? "") }, { withId: false });
  return true;
}
