import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

// Tauri 期望前端在固定端口，且使用固定的 IP
// 用 18421，避开 Windows Hyper-V/WSL 动态端口排除范围（万以上端口极少被保留）
export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  server: {
    port: 18421,
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
