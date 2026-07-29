/**
 * 自习室 API
 *
 * 对应 Electron 旧版 studyRoom.js + studyRoomSync.js 的 IPC 部分。
 *
 * 命令命名（Rust 端 snake_case）：
 * - study_room_get_active
 * - study_room_create
 * - study_room_join
 * - study_room_leave
 * - study_room_get_ranking
 * - study_room_get_members
 *
 * 注意：当前 src-tauri/src/lib.rs 暂未注册这些命令，调用会失败。
 * 等后端 commands 注册后即可直接使用。
 */
import { invoke } from "@tauri-apps/api/core";

// ===== 类型定义 =====

/** 自习室信息 */
export interface StudyRoom {
  /** 自习室唯一 ID */
  id: string;
  /** 自习室名称 */
  name: string;
  /** 描述（可选） */
  description?: string;
  /** 创建者用户名 */
  creatorName?: string;
  /** 当前成员数 */
  memberCount?: number;
  /** 是否公开 */
  isPublic?: boolean;
}

/** 自习室成员 */
export interface StudyRoomMember {
  /** 用户 ID */
  userId: number;
  /** 用户名 */
  username: string;
  /** 今日专注时长（分钟） */
  todayMinutes?: number;
  /** 是否在线 */
  online?: boolean;
}

/** 排名条目 */
export interface StudyRoomRankingEntry {
  /** 用户名 */
  username: string;
  /** 今日专注时长（分钟） */
  todayMinutes: number;
  /** 排名序号（1 开始） */
  rank: number;
}

// ===== 命令调用 =====

/**
 * 获取活跃的自习室列表。
 * 后端：`study_room_get_active(public_only: bool) -> Result<Vec<StudyRoom>, String>`
 *
 * @param publicOnly 是否只返回公开自习室（默认 true）
 */
export function studyRoomGetActive(publicOnly = true): Promise<StudyRoom[]> {
  return invoke<StudyRoom[]>("study_room_get_active", {
    publicOnly,
  });
}

/**
 * 创建自习室。
 * 后端：`study_room_create(name: String, description: String) -> Result<StudyRoom, String>`
 */
export function studyRoomCreate(
  name: string,
  description: string,
): Promise<StudyRoom> {
  return invoke<StudyRoom>("study_room_create", { name, description });
}

/**
 * 加入自习室。
 * 后端：`study_room_join(room_id: String) -> Result<(), String>`
 */
export function studyRoomJoin(roomId: string): Promise<void> {
  return invoke<void>("study_room_join", { roomId });
}

/**
 * 退出自习室。
 * 后端：`study_room_leave(room_id: String) -> Result<(), String>`
 */
export function studyRoomLeave(roomId: string): Promise<void> {
  return invoke<void>("study_room_leave", { roomId });
}

/**
 * 获取自习室今日排名。
 * 后端：`study_room_get_ranking(room_id: String) -> Result<Vec<StudyRoomRankingEntry>, String>`
 */
export function studyRoomGetRanking(
  roomId: string,
): Promise<StudyRoomRankingEntry[]> {
  return invoke<StudyRoomRankingEntry[]>("study_room_get_ranking", { roomId });
}

/**
 * 获取自习室在线成员列表。
 * 后端：`study_room_get_members(room_id: String) -> Result<Vec<StudyRoomMember>, String>`
 */
export function studyRoomGetMembers(
  roomId: string,
): Promise<StudyRoomMember[]> {
  return invoke<StudyRoomMember[]>("study_room_get_members", { roomId });
}
