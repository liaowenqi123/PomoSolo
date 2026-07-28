/**
 * 统计 Store
 *
 * 管理 todayCount（今日番茄数）与 totalMinutes（总专注分钟数），
 * 通过 src/api/data.ts 的 readData/writeData 持久化到 data.json。
 */
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { readData, writeData, type JsonObject } from "../api/data";

/** 统计数据结构（对应 electron dataStore.js getStats()） */
export interface StatsData {
  /** 日期标记（用于跨天重置 todayCount） */
  date: string;
  /** 今日完成的番茄钟数量 */
  todayCount: number;
  /** 累计专注分钟数 */
  totalMinutes: number;
  /** 历史记录（每条对应一次完成的番茄钟） */
  statisticsHistory: StatsHistoryEntry[];
}

/** 单条历史记录 */
export interface StatsHistoryEntry {
  /** 日期 YYYY-MM-DD */
  date: string;
  /** 完成时间戳 ISO 字符串 */
  timestamp: string;
  /** 本次专注分钟数 */
  minutes: number;
  /** 关联备注 */
  note?: string;
  /** 是否部分完成 */
  partial?: boolean;
}

/** 默认统计数据 */
export const DEFAULT_STATS: StatsData = {
  date: new Date().toDateString(),
  todayCount: 0,
  totalMinutes: 0,
  statisticsHistory: [],
};

const STORAGE_KEY = "pomodoro-stats";

/** 将后端 JsonObject 收敛为 StatsData */
function toStatsData(raw: JsonObject): StatsData {
  const today = new Date().toDateString();
  const result: StatsData = { ...DEFAULT_STATS, date: today };

  const rawDate = raw.date;
  if (typeof rawDate === "string") {
    result.date = rawDate;
  }
  // 跨天重置 todayCount
  if (result.date !== today) {
    result.date = today;
    result.todayCount = 0;
  } else {
    const rawCount = raw.todayCount;
    result.todayCount =
      typeof rawCount === "number" ? rawCount : DEFAULT_STATS.todayCount;
  }

  const rawMinutes = raw.totalMinutes;
  result.totalMinutes =
    typeof rawMinutes === "number" ? rawMinutes : DEFAULT_STATS.totalMinutes;

  const rawHistory = raw.statisticsHistory;
  result.statisticsHistory = Array.isArray(rawHistory)
    ? (rawHistory as StatsHistoryEntry[])
    : [];

  return result;
}

export const useStatsStore = defineStore("stats", () => {
  // ===== State =====
  const stats = ref<StatsData>({ ...DEFAULT_STATS });
  const loaded = ref(false);

  // ===== Getters =====
  const todayCount = computed(() => stats.value.todayCount);
  const totalMinutes = computed(() => stats.value.totalMinutes);
  const history = computed(() => stats.value.statisticsHistory);

  /** 今日专注时长（分钟） */
  const todayMinutes = computed(() => {
    const todayStr = new Date().toISOString().split("T")[0];
    return stats.value.statisticsHistory
      .filter((h) => h.date === todayStr)
      .reduce((sum, h) => sum + (h.minutes || 0), 0);
  });

  /** 最近 7 天的历史聚合 */
  const last7Days = computed(() => {
    const now = new Date();
    const result: { label: string; date: string; minutes: number; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      const dayRecords = stats.value.statisticsHistory.filter(
        (h) => h.date === dateStr,
      );
      const completed = dayRecords.filter((h) => !h.partial);
      result.push({
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        date: dateStr,
        minutes: dayRecords.reduce((s, h) => s + (h.minutes || 0), 0),
        count: completed.length,
      });
    }
    return result;
  });

  // ===== Actions =====

  /** 从后端加载统计数据 */
  async function load(): Promise<void> {
    try {
      const raw = await readData();
      stats.value = toStatsData(raw);
      // 跨天重置后写回
      if (raw.date !== new Date().toDateString()) {
        await persist();
      }
    } catch {
      // 回退到 localStorage
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          stats.value = toStatsData(JSON.parse(saved) as JsonObject);
        } catch {
          stats.value = { ...DEFAULT_STATS };
        }
      } else {
        stats.value = { ...DEFAULT_STATS };
      }
    } finally {
      loaded.value = true;
    }
  }

  /** 持久化到后端 + localStorage 备份 */
  async function persist(): Promise<void> {
    const payload: JsonObject = {
      date: stats.value.date,
      todayCount: stats.value.todayCount,
      totalMinutes: stats.value.totalMinutes,
      statisticsHistory: stats.value.statisticsHistory,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // 忽略
    }
    try {
      // 合并写入：先读取完整 data 再覆盖统计字段
      let fullData: JsonObject = {};
      try {
        fullData = await readData();
      } catch {
        // 读取失败时仅写入统计字段
      }
      await writeData({ ...fullData, ...payload });
    } catch {
      // 后端未就绪时静默
    }
  }

  /** 记录一次完成的番茄钟 */
  async function recordSession(minutes: number, note?: string): Promise<void> {
    const now = new Date();
    stats.value.todayCount += 1;
    stats.value.totalMinutes += minutes;
    stats.value.statisticsHistory.push({
      date: now.toISOString().split("T")[0],
      timestamp: now.toISOString(),
      minutes,
      note: note || "",
      partial: false,
    });
    await persist();
  }

  /** 重置今日计数（手动） */
  async function resetToday(): Promise<void> {
    stats.value.date = new Date().toDateString();
    stats.value.todayCount = 0;
    await persist();
  }

  return {
    stats,
    loaded,
    todayCount,
    totalMinutes,
    history,
    todayMinutes,
    last7Days,
    load,
    persist,
    recordSession,
    resetToday,
  };
});
