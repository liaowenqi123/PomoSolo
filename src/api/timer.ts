/**
 * 计时器状态 API
 *
 * 对应 Rust 命令（src-tauri/src/commands/timer.rs）：
 * - get_timer_state() -> TimerState
 */
import { invoke } from "@tauri-apps/api/core";

/** 计时器状态（与 Rust `TimerState` 结构对应） */
export interface TimerState {
  /** 是否运行中 */
  isRunning: boolean;
  /** 当前模式：'work' | 'break' 等 */
  mode: string;
  /** 剩余时间（毫秒） */
  remainingMs: number;
}

/**
 * 查询计时器当前状态。
 * 后端：`get_timer_state() -> TimerState`
 */
export function getTimerState(): Promise<TimerState> {
  return invoke<TimerState>("get_timer_state");
}
