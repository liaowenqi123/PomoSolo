import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// Tauri 期望前端在 5173 端口，且使用固定的 IP
export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: "0.0.0.0",
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: "es2021",
    minify: "esbuild",
    sourcemap: false,
  },
});
