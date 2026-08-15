/**
 * Tauri 命令注册表（PWA）
 *
 * 这是 alias 换层方案的"唯一咽喉"：桌面端 src/api/*.ts 全部经
 * invoke("cmd", args) 调到这里，由本表路由到浏览器实现。
 *
 * - 保留功能 → 指向真实实现（数据/认证/自习室/音乐/同步/P2P 信令）
 * - 砍去功能 → 指向 unsupported 桩（组件 .catch() 兜底）
 * - 窗口/系统等无浏览器等价物 → 安全 no-op
 *
 * 部门：PWA部门 —— 2026-08 PWA 第一版
 */

import type { CommandRegistry } from "./types";
import * as data from "./data";
import * as auth from "./auth";
import * as sync from "./sync";
import * as studyRoom from "./studyRoom";
import * as music from "./music";
import * as musicSync from "./musicSync";
import * as p2pTest from "./p2pTest";
import * as feedback from "./feedback";
import * as windowCmds from "./window";
import * as systemCmds from "./system";
import * as stubs from "./stubs";
import { send as wsSend } from "../../ws";

/** p2p_signal：WebRTC 信令经服务器 WS 定向转发（与桌面端 commands/p2p.rs 一致） */
async function cmdP2PSignal(args: Record<string, unknown>): Promise<void> {
  const msgType = String(args.msgType ?? "");
  const toUserId = String(args.toUserId ?? "");
  const payload = (args.payload ?? {}) as Record<string, unknown>;
  if (!["peer:offer", "peer:answer", "peer:ice", "peer:bye"].includes(msgType)) {
    throw new Error(`非法信令类型: ${msgType}`);
  }
  if (!toUserId) throw new Error("缺少目标用户");
  await wsSend(msgType, { to_user_id: toUserId, ...payload }, { withId: false });
}

export const commandRegistry: CommandRegistry = {
  // ===== 数据 / 设置 =====
  read_data: data.cmdReadData,
  write_data: data.cmdWriteData,
  read_settings: data.cmdReadSettings,
  write_settings: data.cmdWriteSettings,

  // ===== 认证 =====
  cloud_test_connection: auth.cmdCloudTestConnection,
  cloud_login: auth.cmdCloudLogin,
  cloud_register: auth.cmdCloudRegister,
  cloud_logout: auth.cmdCloudLogout,
  cloud_get_session: auth.cmdCloudGetSession,
  get_api_mode: auth.cmdGetApiMode,
  set_api_mode: auth.cmdSetApiMode,
  get_api_key: auth.cmdGetApiKey,
  save_api_key: auth.cmdSaveApiKey,
  save_credentials: auth.cmdSaveCredentials,
  load_credentials: auth.cmdLoadCredentials,
  clear_credentials: auth.cmdClearCredentials,

  // ===== 云端同步 =====
  cloud_sync_pull_settings: sync.cmdCloudSyncPullSettings,
  cloud_sync_push_settings: sync.cmdCloudSyncPushSettings,
  cloud_upload_pomodoro_records: sync.cmdCloudUploadPomodoroRecords,

  // ===== 自习室 =====
  study_room_get_active: studyRoom.cmdStudyRoomGetActive,
  study_room_create: studyRoom.cmdStudyRoomCreate,
  study_room_join: studyRoom.cmdStudyRoomJoin,
  study_room_leave: studyRoom.cmdStudyRoomLeave,
  study_room_get_detail: studyRoom.cmdStudyRoomGetDetail,
  study_room_delete: studyRoom.cmdStudyRoomDelete,
  study_room_update: studyRoom.cmdStudyRoomUpdate,
  study_room_get_ranking: studyRoom.cmdStudyRoomGetRanking,
  study_room_get_members: studyRoom.cmdStudyRoomGetMembers,
  study_room_upload_stats: studyRoom.cmdStudyRoomUploadStats,
  study_room_update_status: studyRoom.cmdStudyRoomUpdateStatus,

  // ===== 音乐播放 =====
  music_toggle_play: music.cmdMusicTogglePlay,
  music_next: music.cmdMusicNext,
  music_prev: music.cmdMusicPrev,
  music_seek: music.cmdMusicSeek,
  music_set_volume: music.cmdMusicSetVolume,
  music_set_auto_next: music.cmdMusicSetAutoNext,
  music_set_play_mode: music.cmdMusicSetPlayMode,
  music_get_status: music.cmdMusicGetStatus,
  music_get_playlist: music.cmdMusicGetPlaylist,
  music_get_devices: music.cmdMusicGetDevices,
  music_set_device: music.cmdMusicSetDevice,
  music_play_song: music.cmdMusicPlaySong,
  music_play_song_at: music.cmdMusicPlaySongAt,
  music_delete_song: music.cmdMusicDeleteSong,
  music_get_custom_tags: music.cmdMusicGetCustomTags,
  music_add_custom_tag: music.cmdMusicAddCustomTag,
  music_delete_custom_tag: music.cmdMusicDeleteCustomTag,
  music_update_tag: music.cmdMusicUpdateTag,
  music_read_song_chunk: music.cmdMusicReadSongChunk,
  music_read_song_chunk_bin: music.cmdMusicReadSongChunkBin,
  music_receive_song_chunk: music.cmdMusicReceiveSongChunk,
  music_receive_song_chunk_bin: music.cmdMusicReceiveSongChunkBin,
  music_finalize_song: music.cmdMusicFinalizeSong,

  // ===== 同步听歌 =====
  music_sync_play: musicSync.cmdMusicSyncPlay,
  music_sync_pause: musicSync.cmdMusicSyncPause,
  music_sync_seek: musicSync.cmdMusicSyncSeek,
  music_sync_next: musicSync.cmdMusicSyncNext,
  music_sync_volume: musicSync.cmdMusicSyncVolume,
  music_sync_add_song: musicSync.cmdMusicSyncAddSong,
  music_sync_request_dj: musicSync.cmdMusicSyncRequestDj,
  music_sync_state: musicSync.cmdMusicSyncState,
  music_sync_measure_time_offset: musicSync.cmdMusicSyncMeasureTimeOffset,
  music_sync_request_song: musicSync.cmdMusicSyncRequestSong,
  music_sync_offer_song: musicSync.cmdMusicSyncOfferSong,
  music_sync_transfer_done: musicSync.cmdMusicSyncTransferDone,
  music_sync_transfer_failed: musicSync.cmdMusicSyncTransferFailed,
  music_sync_set_config: musicSync.cmdMusicSyncSetConfig,
  music_sync_request_state: musicSync.cmdMusicSyncRequestState,
  p2p_reverse_transfer_request: musicSync.cmdP2PReverseTransferRequest,

  // ===== P2P 信令 =====
  p2p_signal: cmdP2PSignal,

  // ===== 窗口（no-op） =====
  close_window: windowCmds.cmdNoop,
  minimize_window: windowCmds.cmdNoop,
  set_always_on_top: windowCmds.cmdNoop,
  bring_to_front: windowCmds.cmdNoop,
  cancel_always_on_top: windowCmds.cmdNoop,
  show_garden_window: windowCmds.cmdNoop,
  hide_garden_window: windowCmds.cmdNoop,
  enter_mini_mode: windowCmds.cmdNoop,
  exit_mini_mode: windowCmds.cmdNoop,
  update_mini_position: windowCmds.cmdNoop,
  open_external: windowCmds.cmdOpenExternal,

  // ===== 系统（no-op） =====
  autostart_enable: systemCmds.cmdAutostartEnable,
  autostart_is_enabled: systemCmds.cmdAutostartIsEnabled,

  // ===== 图表（无下载队列，setApiKey no-op） =====
  charts_set_api_key: stubs.cmdChartsSetApiKey,
  get_download_status: stubs.cmdGetDownloadStatus,
  charts_fetch: stubs.cmdUnsupported,
  download_song: stubs.cmdUnsupported,
  preprocess_all_songs: stubs.cmdUnsupported,

  // ===== 砍去功能：菜园子 / 专注模式 / AI / 更新 / 种子 / 反馈 / P2P 测试 =====
  garden_read: stubs.cmdUnsupported,
  garden_plant: stubs.cmdUnsupported,
  garden_grow: stubs.cmdUnsupported,
  garden_harvest: stubs.cmdUnsupported,
  garden_check_in: stubs.cmdUnsupported,
  garden_unlock_easteregg: stubs.cmdUnsupported,
  garden_save_achievements: stubs.cmdUnsupported,
  foreground_start: stubs.cmdUnsupported,
  foreground_stop: stubs.cmdUnsupported,
  foreground_mark_history_not: stubs.cmdUnsupported,
  foreground_move_blacklist_to_whitelist: stubs.cmdUnsupported,
  ai_plan: stubs.cmdUnsupported,
  update_check: stubs.cmdUnsupported,
  update_download: stubs.cmdUnsupported,
  update_install: stubs.cmdUnsupported,
  update_seed_read_chunk: stubs.cmdUnsupported,
  update_seed_has_installer: stubs.cmdUnsupported,
  p2p_seed_register: stubs.cmdUnsupported,
  p2p_seed_heartbeat: stubs.cmdUnsupported,
  p2p_seed_unregister: stubs.cmdUnsupported,
  p2p_seed_list: stubs.cmdUnsupported,
  p2p_seed_fetch: stubs.cmdUnsupported,
  p2p_online: p2pTest.cmdP2POnline,
  p2p_test_request: p2pTest.cmdP2PTestRequest,
  p2p_reverse_test_request: p2pTest.cmdP2PReverseTestRequest,
  p2p_bidir_test_request: p2pTest.cmdP2PBidirTestRequest,
  p2p_test_result: p2pTest.cmdP2PTestResult,
  submit_feedback: feedback.cmdSubmitFeedback,
  get_user_feedbacks: feedback.cmdGetUserFeedbacks,
  delete_feedback: feedback.cmdDeleteFeedback,
  get_timer_state: stubs.cmdUnsupported,
  timer_set_state: stubs.cmdUnsupported,
  cloud_fetch_music: stubs.cmdUnsupported,
};
