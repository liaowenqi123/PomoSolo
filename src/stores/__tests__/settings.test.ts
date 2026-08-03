import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";

// Mock @/api/data 模块，避免依赖 Tauri 运行时
const dataApiMock = {
  readSettings: vi.fn(),
  writeSettings: vi.fn(),
};

vi.mock("../../api/data", () => ({
  get readSettings() {
    return dataApiMock.readSettings;
  },
  get writeSettings() {
    return dataApiMock.writeSettings;
  },
}));

import { useSettingsStore, DEFAULT_SETTINGS } from "../settings";

describe("useSettingsStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    dataApiMock.readSettings.mockReset();
    dataApiMock.writeSettings.mockReset();
    // 默认 writeSettings 解析为成功
    dataApiMock.writeSettings.mockResolvedValue(undefined);
  });

  it("初始状态应使用 DEFAULT_SETTINGS", () => {
    const store = useSettingsStore();
    expect(store.settings).toEqual(DEFAULT_SETTINGS);
    expect(store.loaded).toBe(false);
    expect(store.theme).toBe("light");
    expect(store.isDark).toBe(false);
    expect(store.minimizeBehavior).toBe("tray");
    expect(store.autoStart).toBe(false);
  });

  it("load 在后端返回数据时应合并到默认设置", async () => {
    dataApiMock.readSettings.mockResolvedValue({
      theme: "light",
      autoStart: true,
      showGardenBtn: false,
    });

    const store = useSettingsStore();
    await store.load();

    expect(store.loaded).toBe(true);
    expect(store.theme).toBe("light");
    expect(store.isDark).toBe(false);
    expect(store.autoStart).toBe(true);
    expect(store.settings.showGardenBtn).toBe(false);
    // 未提供的字段保持默认
    expect(store.settings.showAiBtn).toBe(DEFAULT_SETTINGS.showAiBtn);
  });

  it("load 在后端失败时应回退到 localStorage", async () => {
    dataApiMock.readSettings.mockRejectedValue(new Error("backend down"));
    localStorage.setItem(
      "pomodoro-settings",
      JSON.stringify({ theme: "light", autoStart: true })
    );

    const store = useSettingsStore();
    await store.load();

    expect(store.loaded).toBe(true);
    expect(store.theme).toBe("light");
    expect(store.autoStart).toBe(true);
  });

  it("load 在后端失败且无 localStorage 时应使用默认", async () => {
    dataApiMock.readSettings.mockRejectedValue(new Error("backend down"));

    const store = useSettingsStore();
    await store.load();

    expect(store.loaded).toBe(true);
    expect(store.settings).toEqual(DEFAULT_SETTINGS);
  });

  it("save 应同时写入后端和 localStorage", async () => {
    const store = useSettingsStore();
    await store.save();

    expect(dataApiMock.writeSettings).toHaveBeenCalledTimes(1);
    const payload = dataApiMock.writeSettings.mock.calls[0][0];
    expect(payload).toMatchObject({ theme: "light" });

    // localStorage 也应被写入
    const saved = localStorage.getItem("pomodoro-settings");
    expect(saved).not.toBeNull();
    expect(JSON.parse(saved!).theme).toBe("light");
  });

  it("update 应更新单个字段并持久化", async () => {
    const store = useSettingsStore();
    await store.update("theme", "light");

    expect(store.theme).toBe("light");
    expect(store.isDark).toBe(false);
    expect(dataApiMock.writeSettings).toHaveBeenCalled();
  });

  it("updateAll 应批量更新", async () => {
    const store = useSettingsStore();
    await store.updateAll({ theme: "light", autoStart: true });

    expect(store.theme).toBe("light");
    expect(store.autoStart).toBe(true);
    expect(dataApiMock.writeSettings).toHaveBeenCalledTimes(1);
  });

  it("reset 应恢复默认设置并持久化", async () => {
    const store = useSettingsStore();
    await store.update("theme", "dark");
    expect(store.theme).toBe("dark");

    await store.reset();
    expect(store.settings).toEqual(DEFAULT_SETTINGS);
    expect(store.theme).toBe("light");
  });

  it("toggleTheme 应在 dark/light 之间切换", async () => {
    const store = useSettingsStore();
    expect(store.theme).toBe("light");
    await store.toggleTheme();
    expect(store.theme).toBe("dark");
    await store.toggleTheme();
    expect(store.theme).toBe("light");
  });

  it("DEFAULT_SETTINGS 应包含所有必需字段", () => {
    const keys = Object.keys(DEFAULT_SETTINGS);
    expect(keys).toContain("theme");
    expect(keys).toContain("autoStart");
    expect(keys).toContain("minimizeBehavior");
    expect(keys).toContain("miniExitMode");
    expect(keys).toContain("showGardenBtn");
    expect(keys).toContain("showAiBtn");
    expect(keys).toContain("updateSource");
  });

  it("mergeSettings 应忽略非法类型并保留默认", async () => {
    // 给一个奇怪类型的值，应被 boolean() 强转为默认逻辑下的值
    dataApiMock.readSettings.mockResolvedValue({
      theme: 123, // 非字符串 -> 被强转为 "123"，但仍是 string，所以 theme 变 "123"
      autoStart: "yes", // 非 boolean -> Boolean("yes") = true
      showGardenBtn: 0, // Boolean(0) = false
    });

    const store = useSettingsStore();
    await store.load();

    // autoStart: Boolean("yes") => true
    expect(store.autoStart).toBe(true);
    // showGardenBtn: Boolean(0) => false
    expect(store.settings.showGardenBtn).toBe(false);
  });
});
