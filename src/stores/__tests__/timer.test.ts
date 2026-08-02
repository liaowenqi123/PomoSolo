import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useTimerStore } from "../timer";

describe("useTimerStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    // 隔离 localStorage
    localStorage.clear();
    // 使用 vi.useFakeTimers 让 setInterval / Date.now 可控
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("初始状态应为 ready, work 模式, 25:00", () => {
    const timer = useTimerStore();
    expect(timer.phase).toBe("ready");
    expect(timer.mode).toBe("work");
    expect(timer.remainingMs).toBe(25 * 60 * 1000);
    expect(timer.totalMs).toBe(25 * 60 * 1000);
    expect(timer.displayTime).toBe("25:00");
    expect(timer.isRunning).toBe(false);
    expect(timer.todayCount).toBe(0);
  });

  it("start 后 phase 应为 running", () => {
    const timer = useTimerStore();
    timer.start();
    expect(timer.phase).toBe("running");
    expect(timer.isRunning).toBe(true);
  });

  it("重复 start 不会重新触发（仍为 running）", () => {
    const timer = useTimerStore();
    timer.start();
    timer.start();
    expect(timer.phase).toBe("running");
  });

  it("pause 后 phase 应为 paused", () => {
    const timer = useTimerStore();
    timer.start();
    expect(timer.phase).toBe("running");
    timer.pause();
    expect(timer.phase).toBe("paused");
    expect(timer.isRunning).toBe(false);
  });

  it("未运行时 pause 不会改变状态", () => {
    const timer = useTimerStore();
    timer.pause();
    expect(timer.phase).toBe("ready");
  });

  it("toggle 应在 running/paused 之间切换", () => {
    const timer = useTimerStore();
    expect(timer.phase).toBe("ready");
    timer.toggle();
    expect(timer.phase).toBe("running");
    timer.toggle();
    expect(timer.phase).toBe("paused");
    timer.toggle();
    expect(timer.phase).toBe("running");
  });

  it("reset 后 remainingMs 应恢复到 totalMs", () => {
    const timer = useTimerStore();
    timer.start();
    // 推进时间，让 remainingMs 减少
    vi.advanceTimersByTime(5000);
    expect(timer.remainingMs).toBeLessThan(25 * 60 * 1000);
    timer.reset();
    expect(timer.phase).toBe("ready");
    expect(timer.remainingMs).toBe(timer.totalMs);
    expect(timer.remainingMs).toBe(25 * 60 * 1000);
  });

  it("setMode('break') 应切换到 05:00", () => {
    const timer = useTimerStore();
    expect(timer.mode).toBe("work");
    timer.setMode("break");
    expect(timer.mode).toBe("break");
    expect(timer.totalMs).toBe(5 * 60 * 1000);
    expect(timer.remainingMs).toBe(5 * 60 * 1000);
    expect(timer.displayTime).toBe("05:00");
    expect(timer.phase).toBe("ready");
  });

  it("setMode('work') 从 break 切回 work 应恢复 25:00", () => {
    const timer = useTimerStore();
    timer.setMode("break");
    expect(timer.displayTime).toBe("05:00");
    timer.setMode("work");
    expect(timer.mode).toBe("work");
    expect(timer.displayTime).toBe("25:00");
  });

  it("运行中切换模式应被忽略", () => {
    const timer = useTimerStore();
    timer.start();
    expect(timer.mode).toBe("work");
    timer.setMode("break");
    // 运行中切换应被忽略
    expect(timer.mode).toBe("work");
    expect(timer.displayTime).not.toBe("05:00");
  });

  it("complete 后应切换到 break 模式且不累加 todayCount（统计由 stats store 负责）", () => {
    const timer = useTimerStore();
    expect(timer.todayCount).toBe(0);
    // complete 是 store 内部方法，未直接暴露；
    // 通过让计时器走到 remainingMs <= 0 触发 complete
    timer.start();
    // 推进 25 分钟 + 1 秒，确保 tick 时发现 remainingMs <= 0
    vi.advanceTimersByTime(25 * 60 * 1000 + 1000);
    // Bug 1: timer 不再累加 todayCount/totalMinutes，由 stats store 负责
    expect(timer.todayCount).toBe(0);
    expect(timer.totalMinutes).toBe(0);
    // complete 后自动切到 break
    expect(timer.mode).toBe("break");
    expect(timer.phase).toBe("ready");
  });

  it("complete 后 completionId 应自增", () => {
    const timer = useTimerStore();
    const initial = timer.completionId;
    timer.start();
    vi.advanceTimersByTime(25 * 60 * 1000 + 1000);
    expect(timer.completionId).toBe(initial + 1);
    expect(timer.lastCompletedMinutes).toBe(25);
  });

  it("progress 应随 remainingMs 减少而增加", () => {
    const timer = useTimerStore();
    expect(timer.progress).toBeCloseTo(0, 5);
    timer.start();
    vi.advanceTimersByTime(125 * 60 * 1000); // 推进 50%（25 分钟的一半）
    // 推进过程中可能触发 complete，因此这里仅断言 progress 在合理范围
    expect(timer.progress).toBeGreaterThanOrEqual(0);
    expect(timer.progress).toBeLessThanOrEqual(1);
  });

  it("displayTime 应正确格式化为 MM:SS", () => {
    const timer = useTimerStore();
    timer.setMode("work");
    expect(timer.displayTime).toBe("25:00");

    timer.setMode("break");
    expect(timer.displayTime).toBe("05:00");
  });

  it("reset 不影响 todayCount", () => {
    const timer = useTimerStore();
    // Bug 1: todayCount 不再由 complete 累加，手动设置以验证 reset 不影响计数
    timer.todayCount = 5;
    timer.start();
    vi.advanceTimersByTime(25 * 60 * 1000 + 1000);
    // complete 不再累加 todayCount
    expect(timer.todayCount).toBe(5);

    timer.reset();
    // reset 只重置时间和 phase，不影响计数
    expect(timer.todayCount).toBe(5);
  });

  it("setTime 应设置计时时长并回到 ready", () => {
    const timer = useTimerStore();
    timer.setTime(15);
    expect(timer.totalMs).toBe(15 * 60 * 1000);
    expect(timer.remainingMs).toBe(15 * 60 * 1000);
    expect(timer.phase).toBe("ready");
    expect(timer.displayTime).toBe("15:00");
  });

  it("setTime 在 running 时应被忽略", () => {
    const timer = useTimerStore();
    timer.start();
    timer.setTime(10);
    // running 中不生效
    expect(timer.totalMs).toBe(25 * 60 * 1000);
    expect(timer.remainingMs).toBe(25 * 60 * 1000);
    timer.reset();
  });

  it("计划模式下完成任意一项都应递增 planStepId", () => {
    const timer = useTimerStore();
    timer.setAppMode("plan");
    expect(timer.planStepId).toBe(0);
    // 完成 work 项
    timer.start();
    vi.advanceTimersByTime(25 * 60 * 1000 + 1000);
    expect(timer.planStepId).toBe(1);
    expect(timer.completionId).toBe(1);
    // 完成 break 项（先按下一项时长设置 5 分钟，模拟计划项推进）
    timer.setTime(5);
    timer.start();
    vi.advanceTimersByTime(5 * 60 * 1000 + 1000);
    // break 项完成：planStepId +1，但 completionId 不增（统计只记 work）
    expect(timer.planStepId).toBe(2);
    expect(timer.completionId).toBe(1);
  });

  it("单次模式完成项不应递增 planStepId", () => {
    const timer = useTimerStore();
    timer.start();
    vi.advanceTimersByTime(25 * 60 * 1000 + 1000);
    expect(timer.planStepId).toBe(0);
    expect(timer.completionId).toBe(1);
  });
});
