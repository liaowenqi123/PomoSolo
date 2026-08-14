/**
 * PWA 构建配置（位于 src/pwa/，与桌面端前端源码同仓库）
 *
 * 关键：真实复用桌面端源码（src/ 下的组件/store/API 原样编译进 PWA）。
 * - `@` → ../（即 src/，桌面端前端源码根）
 * - `@tauri-apps/api/*` → ./tauri/*（浏览器 shim：invoke/listen）
 * - `@tauri-apps/plugin-dialog` → ./tauri/plugin-dialog.ts
 *
 * Vite root = src/pwa（本配置文件所在目录），PWA 自身的
 * index.html / main.ts / App.vue / public/（tracks、icons、manifest）都在这里。
 *
 * Service Worker：vite-plugin-pwa（generateSW）。注意：
 * - 预缓存只含应用外壳（JS/CSS/manifest 等），**排除 mp3**（内置曲目 14.5MB，避免首屏过重）
 * - /tracks/ 与 /music/ 走运行时 CacheFirst（播放即缓存 → 满足"缓存那三首 → 离线可听"）
 *
 * 部门：PWA部门 —— 2026-08 PWA 第一版
 */
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  // root = src/pwa（配置文件所在目录），由 start.pomogrow.top 站点根目录托管
  root: fileURLToPath(new URL("./", import.meta.url)),
  base: "/",
  plugins: [
    vue(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon-128.png", "icons/icon-512.png", "manifest.webmanifest"],
      manifest: false, // 使用 public/manifest.webmanifest
      workbox: {
        // 预缓存应用外壳，但不含音乐文件
        globPatterns: ["**/*.{js,css,html,json,png,webmanifest}"],
        globIgnores: ["**/tracks/**", "**/*.mp3"],
        runtimeCaching: [
          {
            // 内置主题曲（播放时缓存 → 离线可听）
            urlPattern: ({ url }) => url.pathname.startsWith("/tracks/"),
            handler: "CacheFirst",
            options: {
              cacheName: "pomo-pwa-music-v1",
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            // 服务器曲库（/music/，生产同源；播放时缓存）
            urlPattern: ({ url }) => url.pathname.startsWith("/music/"),
            handler: "CacheFirst",
            options: {
              cacheName: "pomo-pwa-music-v1",
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            // 音乐清单
            urlPattern: ({ url }) => url.pathname.endsWith("/music-manifest.json"),
            handler: "NetworkFirst",
            options: {
              cacheName: "pomo-pwa-manifest-v1",
              networkTimeoutSeconds: 5,
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      // @ → src/（桌面端前端源码根）
      "@": fileURLToPath(new URL("../", import.meta.url)),
      "@tauri-apps/api": fileURLToPath(new URL("./tauri", import.meta.url)),
      "@tauri-apps/api/core": fileURLToPath(new URL("./tauri/core.ts", import.meta.url)),
      "@tauri-apps/api/event": fileURLToPath(new URL("./tauri/event.ts", import.meta.url)),
      "@tauri-apps/api/app": fileURLToPath(new URL("./tauri/app.ts", import.meta.url)),
      "@tauri-apps/plugin-dialog": fileURLToPath(
        new URL("./tauri/plugin-dialog.ts", import.meta.url),
      ),
    },
  },
  build: {
    // 构建产物输出到仓库根 pwa-dist/（不污染 src/）
    outDir: fileURLToPath(new URL("../../pwa-dist", import.meta.url)),
    emptyOutDir: true,
    target: "es2020",
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          vue: ["vue", "pinia"],
        },
      },
    },
  },
  server: {
    port: 5199,
    host: "127.0.0.1",
  },
});
