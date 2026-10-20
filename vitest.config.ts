import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // 仅运行 src/ 下的测试，排除旧 Electron 代码（deprecated/electron/ 目录不修改）
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['node_modules/**', 'dist/**', 'deprecated/electron/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.{ts,vue}'],
      // PWA 是 P2（苹果生态妥协替代品），不参与桌面端覆盖率门禁；
      // 入口/纯类型文件没有可执行逻辑，也不计入分母。
      exclude: [
        'src/pwa/**',
        'src/main.ts',
        'src/garden.ts',
        'src/env.d.ts',
        'src/**/*.d.ts',
        'src/**/types.ts',
        'src/**/__tests__/**',
        'src/**/*.test.ts',
      ],
      // 先设一个能拦住明显倒退的门槛；后续测试增加再逐步提高。
      thresholds: {
        statements: 85,
        branches: 80,
        functions: 75,
        lines: 85,
      },
    },
  },
})
