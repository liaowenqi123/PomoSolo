import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

// Tauri 期望前端在固定端口，且使用固定的 IP
// 用 1430（Tauri 官方默认），避开 Windows 动态端口排除范围（5173 在 5141-5240 内会被 EACCES）
export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  server: {
    port: 1430,
    strictPort: true,
    host: "0.0.0.0",
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    target: "es2021",
    minify: "esbuild",
    sourcemap: false,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        garden: fileURLToPath(new URL("./garden.html", import.meta.url)),
      },
    },
  },
});
