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
 * - study_room_upload_stats   （上传今日专注统计，番茄钟完成时调用）
 * - study_room_update_status  （心跳：更新在线状态 + 清理超时成员）
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
  /** 用户 ID（服务器 UUID 字符串） */
  userId: string;
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

/**
 * 上传今日专注统计（番茄钟完成时调用）。
 * 后端：`study_room_upload_stats(room_id, today_minutes, today_count) -> Result<bool, String>`
 *
 * 每用户每天一条记录，已有则覆盖（非累加）。
 */
export function studyRoomUploadStats(
  roomId: string,
  todayMinutes: number,
  todayCount: number,
): Promise<boolean> {
  return invoke<boolean>("study_room_upload_stats", {
    roomId,
    todayMinutes,
    todayCount,
  });
}

/**
 * 心跳：更新在线状态 + 清理超时成员 + 下线空房间。
 * 后端：`study_room_update_status(room_id: String) -> Result<bool, String>`
 *
 * 超时阈值 11 分钟（与旧版一致）。
 */
export function studyRoomUpdateStatus(roomId: string): Promise<boolean> {
  return invoke<boolean>("study_room_update_status", { roomId });
}
