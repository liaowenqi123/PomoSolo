/**
 * PWA 入口
 *
 * 真实复用：@ 别名指向 ../src（桌面端前端源码），因此 Timer/MusicPlayer/
 * SettingsPanel/StudyRoom 等组件与 stores 全部原样复用；
 * @tauri-apps/api 被 alias 到 ./tauri（浏览器 shim），invoke/listen 落到
 * localStorage / REST / WebSocket / HTML5 Audio。
 *
 * 部门：PWA部门 —— 2026-08 PWA 第一版
 */
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "../styles/global.css";
import "./styles.css";
import { LS_PREFIX } from "./config";

// ===== 开机自检：预置 PWA 默认设置（砍去功能的按钮默认关闭，避免闪出空按钮） =====
bootstrapSettings();

// ===== Service Worker 注册（PWA 离线能力；生产环境 vite-plugin-pwa 注入） =====
if ("serviceWorker" in navigator && !import.meta.env.DEV) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .catch((e) => console.warn("[PWA] SW 注册失败:", e));
  });
}

const app = createApp(App);
app.use(createPinia());
app.mount("#app");

/** PWA 默认设置：保留核心（计时/音乐/自习室/统计计数），关闭被砍板块的按钮 */
function bootstrapSettings(): void {
  try {
    const key = `${LS_PREFIX}settings`;
    if (localStorage.getItem(key)) return;
    const defaults = {
      minimizeBehavior: "tray",
      miniExitMode: "button",
      showDarkModeBtn: true,
      showGardenBtn: false,
      plantWheelMode: false,
      showStatsBtn: false,
      showAiBtn: false,
      showStudyRoomBtn: true,
      showSidebarCollapseBtn: true,
      showHeaderExpandBtn: true,
      showShuffleBtn: true,
      showVolumeBtn: true,
      showDeviceBtn: false,
      showChartsBtn: false,
      advancedColorCustomization: false,
      syncTransferMode: "immediate",
      p2pCompress: true,
      updateSource: "github",
      allowBetaUpdates: false,
      shareInstaller: false,
      autoStart: false,
      theme: "light",
    };
    localStorage.setItem(key, JSON.stringify(defaults));
  } catch {
    /* 忽略 */
  }
}
