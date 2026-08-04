/**
 * 设置 Store
 *
 * 从 electron/src/scripts/modules/settings.js 提取核心设置项，
 * 通过 src/api/data.ts 的 readSettings/writeSettings 持久化。
 */
import { defineStore, acceptHMRUpdate } from "pinia";
import { ref, computed } from "vue";
import { readSettings, writeSettings, type JsonObject } from "../api/data";

/** 更新源：github（默认，快但可能不稳定）/ server（稳定但慢） */
export type UpdateSource = "github" | "server";

/** 最小化行为 */
export type MinimizeBehavior = "tray" | "minimize";

/** 迷你模式退出方式 */
export type MiniExitMode = "double-click" | "button";

/** 主题 */
export type Theme = "dark" | "light";

/** 同步听歌传歌方案：immediate 边下边播 / wait_all 全员就绪统一播 */
export type SyncTransferMode = "immediate" | "wait_all";

/** 应用设置（核心子集，对应 electron settings.js 的 SETTING_MAP） */
export interface AppSettings {
  // 计时器
  minimizeBehavior: MinimizeBehavior;
  miniExitMode: MiniExitMode;
  // 界面显示开关
  showDarkModeBtn: boolean;
  showGardenBtn: boolean;
  plantWheelMode: boolean;
  showStatsBtn: boolean;
  showAiBtn: boolean;
  showStudyRoomBtn: boolean;
  showSidebarCollapseBtn: boolean;
  showHeaderExpandBtn: boolean;
  // 音乐播放器
  showShuffleBtn: boolean;
  showVolumeBtn: boolean;
  showDeviceBtn: boolean;
  showChartsBtn: boolean;
  advancedColorCustomization: boolean;
  // 同步听歌（DJ 生效）
  syncTransferMode: SyncTransferMode;
  // 更新
  updateSource: UpdateSource;
  /** 是否接收 Beta 版本更新（v4.5.18，默认 false：正式渠道跳过 prerelease） */
  allowBetaUpdates: boolean;
  // 系统
  autoStart: boolean;
  // 主题
  theme: Theme;
}

/** 默认设置 */
export const DEFAULT_SETTINGS: AppSettings = {
  minimizeBehavior: "tray",
  miniExitMode: "button",
  showDarkModeBtn: true,
  showGardenBtn: true,
  plantWheelMode: true,
  showStatsBtn: true,
  showAiBtn: true,
  showStudyRoomBtn: true,
  showSidebarCollapseBtn: true,
  showHeaderExpandBtn: true,
  showShuffleBtn: true,
  showVolumeBtn: true,
  showDeviceBtn: true,
  showChartsBtn: true,
  advancedColorCustomization: false,
  syncTransferMode: "immediate",
  updateSource: "github",
  allowBetaUpdates: false,
  autoStart: false,
  theme: "light",
};

const STORAGE_KEY = "pomodoro-settings";

/** 将后端返回的 JsonObject 合并到默认设置上，做类型收敛 */
function mergeSettings(raw: JsonObject): AppSettings {
  const result: AppSettings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
    const val = raw[key];
    if (val === undefined || val === null) continue;
    const defaultVal = DEFAULT_SETTINGS[key];
    if (typeof defaultVal === "boolean") {
      (result[key] as boolean) = Boolean(val);
    } else if (typeof defaultVal === "string") {
      (result[key] as string) = String(val);
    }
  }
  return result;
}

export const useSettingsStore = defineStore("settings", () => {
  // ===== State =====
  const settings = ref<AppSettings>({ ...DEFAULT_SETTINGS });
  const loaded = ref(false);

  // ===== Getters =====
  const theme = computed(() => settings.value.theme);
  const isDark = computed(() => settings.value.theme === "dark");
  const minimizeBehavior = computed(() => settings.value.minimizeBehavior);
  const autoStart = computed(() => settings.value.autoStart);

  // ===== Actions =====

  /** 从后端加载设置，失败时回退到 localStorage */
  async function load(): Promise<void> {
    try {
      const raw = await readSettings();
      settings.value = mergeSettings(raw);
    } catch {
      // 后端未就绪时回退到 localStorage
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          settings.value = mergeSettings(JSON.parse(saved) as JsonObject);
        } catch {
          settings.value = { ...DEFAULT_SETTINGS };
        }
      } else {
        settings.value = { ...DEFAULT_SETTINGS };
      }
    } finally {
      loaded.value = true;
    }
  }

  /** 持久化设置到后端，并同步 localStorage 作为备份 */
  async function save(): Promise<void> {
    const payload: JsonObject = { ...settings.value };
    // 同步写入 localStorage 备份
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // 忽略 localStorage 写入失败
    }
    try {
      await writeSettings(payload);
    } catch {
      // 后端未就绪时静默失败，localStorage 已有备份
    }
  }

  /** 更新单个设置项并持久化 */
  async function update<K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ): Promise<void> {
    settings.value[key] = value;
    await save();
  }

  /** 批量更新设置项并持久化 */
  async function updateAll(patch: Partial<AppSettings>): Promise<void> {
    settings.value = { ...settings.value, ...patch };
    await save();
  }

  /** 重置为默认设置 */
  async function reset(): Promise<void> {
    settings.value = { ...DEFAULT_SETTINGS };
    await save();
  }

  /** 切换主题 */
  async function toggleTheme(): Promise<void> {
    settings.value.theme = settings.value.theme === "dark" ? "light" : "dark";
    await save();
  }

  return {
    settings,
    loaded,
    theme,
    isDark,
    minimizeBehavior,
    autoStart,
    load,
    save,
    update,
    updateAll,
    reset,
    toggleTheme,
  };
});

// HMR: 支持 Vite 热更新，避免 HMR 后丢失 Pinia 上下文
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useSettingsStore, import.meta.hot));
}
