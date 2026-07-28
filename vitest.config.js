import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      'electron': resolve(__dirname, '__tests__/__mocks__/electron-mock.js')
    }
  },
  test: {
    include: ['__tests__/**/*.test.js'],
    exclude: ['__tests__/__mocks__/**', 'node_modules/**'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['__tests__/setup.js'],
    pool: 'forks',
    maxWorkers: 4,
    server: {
      deps: {
        inline: [
          'electron',
          '@supabase/supabase-js',
          'axios',
          'electron-updater',
          'https',
          'http',
          'child_process',
          'fs',
          'path',
          'os',
          'crypto',
          'stream',
          'url',
          'zlib',
          'events',
          'util',
          'net',
          'tls',
          'dns'
        ]
      }
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov', 'html'],
      reportsDirectory: './coverage',
      include: [
        'main.js',
        'preload.js',
        'main/**/*.js',
        'src/modules/**/*.js',
        'src/scripts/modules/**/*.js'
      ],
      exclude: [
        '__tests__/**',
        'node_modules/**',
        'dist/**',
        'build/**',
        'coverage/**',
        'supabase-test/**',
        'music-player/**',
        'foreground_inspection/**',
        'count-up-test/**',
        'admin/**',
        '**/*.config.js',
        '调试脚本.js',
        '一键诊断.js'
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 70,
        statements: 90
      }
    }
  }
})
