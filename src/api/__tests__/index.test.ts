import { describe, it, expect, vi } from "vitest";

// 使用 vi.hoisted 确保 mock 变量在 vi.mock 工厂中可用（vi.mock 会被提升到文件顶部）
const { invokeMock, listenMock, onceMock, emitMock, emitToMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
  onceMock: vi.fn(),
  emitMock: vi.fn(),
  emitToMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: listenMock,
  once: onceMock,
  emit: emitMock,
  emitTo: emitToMock,
  TauriEvent: {
    WINDOW_FOCUS: "tauri://window-focus",
    WINDOW_BLUR: "tauri://window-blur",
  },
}));

import * as apiIndex from "../index";

// 导入各子模块的具名导出，验证 index re-export 它们
import * as dataApi from "../data";
import * as windowApi from "../window";
import * as authApi from "../auth";
import * as gardenApi from "../garden";
import * as foregroundApi from "../foreground";
import * as timerApi from "../timer";
import * as musicApi from "../music";
import * as chartsApi from "../charts";
import * as aiApi from "../ai";
import * as studyRoomApi from "../studyRoom";
import * as systemApi from "../system";

describe("api/index.ts — 统一出口", () => {
  it("应 re-export invoke 自 @tauri-apps/api/core", () => {
    expect(apiIndex.invoke).toBe(invokeMock);
  });

  it("应 re-export listen / once / emit / emitTo 自 @tauri-apps/api/event", () => {
    expect(apiIndex.listen).toBe(listenMock);
    expect(apiIndex.once).toBe(onceMock);
    expect(apiIndex.emit).toBe(emitMock);
    expect(apiIndex.emitTo).toBe(emitToMock);
  });

  it("应 re-export TauriEvent 枚举", () => {
    expect(apiIndex.TauriEvent).toBeDefined();
    expect(apiIndex.TauriEvent.WINDOW_FOCUS).toBe("tauri://window-focus");
  });

  it("应 re-export data 模块的所有导出", () => {
    expect(apiIndex.readData).toBe(dataApi.readData);
    expect(apiIndex.writeData).toBe(dataApi.writeData);
    expect(apiIndex.readSettings).toBe(dataApi.readSettings);
    expect(apiIndex.writeSettings).toBe(dataApi.writeSettings);
  });

  it("应 re-export window 模块的所有导出", () => {
    expect(apiIndex.closeWindow).toBe(windowApi.closeWindow);
    expect(apiIndex.minimizeWindow).toBe(windowApi.minimizeWindow);
    expect(apiIndex.setAlwaysOnTop).toBe(windowApi.setAlwaysOnTop);
    expect(apiIndex.bringToFront).toBe(windowApi.bringToFront);
    expect(apiIndex.cancelAlwaysOnTop).toBe(windowApi.cancelAlwaysOnTop);
  });

  it("应 re-export auth 模块的所有导出", () => {
    expect(apiIndex.cloudLogin).toBe(authApi.cloudLogin);
    expect(apiIndex.cloudRegister).toBe(authApi.cloudRegister);
    expect(apiIndex.cloudLogout).toBe(authApi.cloudLogout);
    expect(apiIndex.cloudGetSession).toBe(authApi.cloudGetSession);
  });

  it("应 re-export garden 模块的所有导出", () => {
    expect(apiIndex.gardenRead).toBe(gardenApi.gardenRead);
    expect(apiIndex.gardenPlant).toBe(gardenApi.gardenPlant);
    expect(apiIndex.gardenHarvest).toBe(gardenApi.gardenHarvest);
  });

  it("应 re-export foreground 模块的所有导出", () => {
    expect(apiIndex.foregroundStart).toBe(foregroundApi.foregroundStart);
    expect(apiIndex.foregroundStop).toBe(foregroundApi.foregroundStop);
  });

  it("应 re-export timer 模块的所有导出", () => {
    expect(apiIndex.getTimerState).toBe(timerApi.getTimerState);
  });

  it("应 re-export events 模块的所有导出", () => {
    // events 模块也导出 listen/once/emit/emitTo，与 index 直连的相同
    expect(typeof apiIndex.useTauriEvent).toBe("function");
    expect(typeof apiIndex.useTauriEventOnce).toBe("function");
  });

  it("应 re-export music 模块的所有导出", () => {
    expect(apiIndex.musicTogglePlay).toBe(musicApi.musicTogglePlay);
    expect(apiIndex.musicNext).toBe(musicApi.musicNext);
    expect(apiIndex.musicPrev).toBe(musicApi.musicPrev);
  });

  it("应 re-export charts 模块的所有导出", () => {
    expect(apiIndex.chartsFetch).toBe(chartsApi.chartsFetch);
  });

  it("应 re-export ai 模块的所有导出", () => {
    expect(apiIndex.aiGeneratePlan).toBe(aiApi.aiGeneratePlan);
  });

  it("应 re-export studyRoom 模块的所有导出", () => {
    expect(apiIndex.studyRoomCreate).toBe(studyRoomApi.studyRoomCreate);
    expect(apiIndex.studyRoomJoin).toBe(studyRoomApi.studyRoomJoin);
    expect(apiIndex.studyRoomLeave).toBe(studyRoomApi.studyRoomLeave);
  });

  it("应 re-export system 模块的所有导出", () => {
    expect(apiIndex.autostartEnable).toBe(systemApi.autostartEnable);
    expect(apiIndex.autostartIsEnabled).toBe(systemApi.autostartIsEnabled);
  });
});
