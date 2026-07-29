import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";

// Mock api/data 模块（使用 vi.hoisted 避免 hoist 顺序问题）
const dataApi = vi.hoisted(() => ({
  readData: vi.fn(),
  writeData: vi.fn(),
}));
vi.mock("@/api/data", () => dataApi);

import { useStatsStore, DEFAULT_STATS } from "../stats";

describe("useStatsStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    dataApi.readData.mockReset();
    dataApi.writeData.mockReset();
    dataApi.writeData.mockResolvedValue(undefined);
    // DEFAULT_STATS.statisticsHistory 是共享数组（store 用浅拷贝 { ...DEFAULT_STATS }），
    // 多个 store 实例会共享同一个数组导致测试间污染。这里在 beforeEach 重置以隔离测试。
    // 注：这暴露了 stats.ts 中 DEFAULT_STATS.statisticsHistory 共享引用的潜在 bug。
    DEFAULT_STATS.statisticsHistory.length = 0;
  });

  function todayIso(): string {
    return new Date().toISOString().split("T")[0];
  }

  function todayStr(): string {
    return new Date().toDateString();
  }

  it("初始状态应为默认值", () => {
    const s = useStatsStore();
    expect(s.todayCount).toBe(0);
    expect(s.totalMinutes).toBe(0);
    expect(s.history).toEqual([]);
    expect(s.loaded).toBe(false);
    expect(s.stats.date).toBe(DEFAULT_STATS.date);
  });

  it("load 调用 readData 并设置 stats", async () => {
    dataApi.readData.mockResolvedValue({
      date: todayStr(),
      todayCount: 3,
      totalMinutes: 100,
      statisticsHistory: [
        { date: todayIso(), timestamp: new Date().toISOString(), minutes: 25 },
      ],
    });
    const s = useStatsStore();
    await s.load();
    expect(s.loaded).toBe(true);
    expect(s.todayCount).toBe(3);
    expect(s.totalMinutes).toBe(100);
    expect(s.history).toHaveLength(1);
  });

  it("load 后端失败时回退到 localStorage", async () => {
    dataApi.readData.mockRejectedValue(new Error("down"));
    localStorage.setItem(
      "pomodoro-stats",
      JSON.stringify({
        date: todayStr(),
        todayCount: 2,
        totalMinutes: 50,
        statisticsHistory: [],
      }),
    );
    const s = useStatsStore();
    await s.load();
    expect(s.loaded).toBe(true);
    expect(s.todayCount).toBe(2);
    expect(s.totalMinutes).toBe(50);
  });

  it("load 后端失败且无 localStorage 时使用默认", async () => {
    dataApi.readData.mockRejectedValue(new Error("down"));
    const s = useStatsStore();
    await s.load();
    expect(s.todayCount).toBe(0);
    expect(s.totalMinutes).toBe(0);
    expect(s.history).toEqual([]);
  });

  it("跨天重置：stats.date !== today 时 todayCount 归零并 persist", async () => {
    dataApi.readData.mockResolvedValue({
      date: "Mon Jan 01 2024",
      todayCount: 5,
      totalMinutes: 100,
      statisticsHistory: [],
    });
    const s = useStatsStore();
    await s.load();
    expect(s.todayCount).toBe(0);
    expect(s.stats.date).toBe(todayStr());
    expect(s.totalMinutes).toBe(100);
    // 跨天后应写回
    expect(dataApi.writeData).toHaveBeenCalled();
  });

  it("recordSession 增加 todayCount/totalMinutes/history 并 persist", async () => {
    const s = useStatsStore();
    await s.recordSession(25, "note");
    expect(s.todayCount).toBe(1);
    expect(s.totalMinutes).toBe(25);
    expect(s.history).toHaveLength(1);
    expect(s.history[0].minutes).toBe(25);
    expect(s.history[0].note).toBe("note");
    expect(s.history[0].partial).toBe(false);
    expect(s.history[0].date).toBe(todayIso());
    expect(dataApi.writeData).toHaveBeenCalled();
  });

  it("recordSession 多次累加", async () => {
    const s = useStatsStore();
    await s.recordSession(25);
    await s.recordSession(10);
    expect(s.todayCount).toBe(2);
    expect(s.totalMinutes).toBe(35);
    expect(s.history).toHaveLength(2);
  });

  it("resetToday 设置 todayCount=0 + date=today 并 persist", async () => {
    const s = useStatsStore();
    await s.recordSession(25);
    expect(s.todayCount).toBe(1);
    await s.resetToday();
    expect(s.todayCount).toBe(0);
    expect(s.stats.date).toBe(todayStr());
    expect(dataApi.writeData).toHaveBeenCalled();
  });

  it("todayMinutes 汇总今日历史分钟数", async () => {
    const s = useStatsStore();
    s.stats.statisticsHistory = [
      { date: todayIso(), timestamp: "", minutes: 25 },
      { date: todayIso(), timestamp: "", minutes: 10 },
      { date: "2024-01-01", timestamp: "", minutes: 100 },
    ];
    expect(s.todayMinutes).toBe(35);
  });

  it("todayMinutes 无今日记录时为 0", () => {
    const s = useStatsStore();
    s.stats.statisticsHistory = [
      { date: "2024-01-01", timestamp: "", minutes: 100 },
    ];
    expect(s.todayMinutes).toBe(0);
  });

  it("last7Days 返回 7 条记录，含 label/date/minutes/count", () => {
    const s = useStatsStore();
    const result = s.last7Days;
    expect(result).toHaveLength(7);
    result.forEach((d) => {
      expect(d).toHaveProperty("label");
      expect(d).toHaveProperty("date");
      expect(d).toHaveProperty("minutes");
      expect(d).toHaveProperty("count");
    });
    // 第一条应是 6 天前，最后一条是今天
    const today = todayIso();
    expect(result[6].date).toBe(today);
  });

  it("last7Days count 仅统计非 partial 条目", () => {
    const s = useStatsStore();
    const today = todayIso();
    s.stats.statisticsHistory = [
      { date: today, timestamp: "", minutes: 25, partial: false },
      { date: today, timestamp: "", minutes: 10, partial: true },
      { date: today, timestamp: "", minutes: 30, partial: false },
    ];
    const result = s.last7Days;
    const todayEntry = result[6];
    expect(todayEntry.count).toBe(2); // 两个非 partial
    expect(todayEntry.minutes).toBe(65); // 25+10+30
  });

  it("persist 写入 localStorage 与 writeData", async () => {
    const s = useStatsStore();
    s.stats.todayCount = 4;
    s.stats.totalMinutes = 80;
    dataApi.readData.mockResolvedValue({});
    await s.persist();
    const saved = localStorage.getItem("pomodoro-stats");
    expect(saved).not.toBeNull();
    expect(JSON.parse(saved!).todayCount).toBe(4);
    expect(dataApi.writeData).toHaveBeenCalled();
    const payload = dataApi.writeData.mock.calls[0][0];
    expect(payload.todayCount).toBe(4);
    expect(payload.totalMinutes).toBe(80);
  });

  it("persist 合并已有 data 后写入", async () => {
    const s = useStatsStore();
    dataApi.readData.mockResolvedValue({ presets: { work: [] }, other: 1 });
    await s.persist();
    const payload = dataApi.writeData.mock.calls[0][0];
    expect(payload.other).toBe(1);
    expect(payload).toHaveProperty("todayCount");
    expect(payload).toHaveProperty("statisticsHistory");
  });
});
