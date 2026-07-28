/**
 * 测试全局 setup
 *
 * 在每个测试文件运行前：
 * 1. 注册 electron / @supabase/supabase-js / fs 等 mock
 * 2. 提供全局 mock 引用，方便断言
 *
 * 注意：Vitest 4 的 vi.mock 在 forks/vmThreads pool 下只拦截 ESM import，
 * 不拦截 CJS require。因此我们同时使用 Module._load 覆盖来拦截 require('electron')
 * 等调用（源代码模块内部使用 require）。
 */
import { vi, beforeAll, beforeEach, afterAll } from 'vitest'
import Module from 'node:module'

// ============ 加载 mock 模块 ============
const path = require('node:path')
const mocksDir = path.join(process.cwd(), '__tests__', '__mocks__')
const electronMockModule = require(path.join(mocksDir, 'electron-mock'))
const supabaseMockModule = require(path.join(mocksDir, 'supabase-mock'))
const fsMockModule = require(path.join(mocksDir, 'fileSystem-mock'))
const httpsMockModule = require(path.join(mocksDir, 'https-mock'))
const childProcessMockModule = require(path.join(mocksDir, 'child-process-mock'))
const readlineMockModule = require(path.join(mocksDir, 'readline-mock'))

// ============ Module._load 覆盖（拦截 CJS require） ============
const originalLoad = Module._load
const originalResolve = Module._resolveFilename
const mockAutoUpdater = {
  autoDownload: false,
  allowPrerelease: false,
  on: vi.fn(),
  once: vi.fn(),
  off: vi.fn(),
  checkForUpdates: vi.fn().mockResolvedValue(null),
  downloadUpdate: vi.fn().mockResolvedValue(null),
  quitAndInstall: vi.fn(),
  setFeedURL: vi.fn()
}
const mockRequireMap = {
  'electron': electronMockModule,
  '@supabase/supabase-js': { createClient: supabaseMockModule.createClient },
  'axios': {
    default: {
      get: vi.fn().mockResolvedValue({ data: {} }),
      post: vi.fn().mockResolvedValue({ data: {} }),
      put: vi.fn().mockResolvedValue({ data: {} }),
      delete: vi.fn().mockResolvedValue({ data: {} }),
      create: vi.fn().mockReturnThis()
    },
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({ data: {} })
  },
  'electron-updater': { autoUpdater: mockAutoUpdater },
  'fs': fsMockModule,
  'https': httpsMockModule,
  'http': httpsMockModule,
  'child_process': childProcessMockModule,
  'readline': readlineMockModule
}

// 全局 mock 注册表：测试文件可通过 __registerRequireMock 注册
// 键为模块的绝对路径（已 resolve），值为 mock 对象
const mockPathRegistry = new Map()

/**
 * 注册 CJS require mock
 * @param {string} modulePath - 相对于项目根目录的模块路径 (如 'src/modules/dataManager')
 * @param {*} mockObj - mock 对象
 */
global.__registerRequireMock = function (modulePath, mockObj) {
  const cwd = process.cwd()
  // 尝试多种路径格式来匹配 Module._resolveFilename 的结果
  const candidates = [
    path.join(cwd, modulePath),
    path.join(cwd, modulePath + '.js'),
    path.join(cwd, modulePath + '.cjs'),
    path.join(cwd, modulePath, 'index.js')
  ]
  for (const c of candidates) {
    mockPathRegistry.set(c, mockObj)
    // 也存储正斜杠版本（Windows 兼容）
    mockPathRegistry.set(c.replace(/\\/g, '/'), mockObj)
  }
  // 也尝试用 _resolveFilename 解析
  try {
    const fakeParent = path.join(cwd, 'package.json')
    const resolved = originalResolve.call(Module, modulePath, fakeParent)
    mockPathRegistry.set(resolved, mockObj)
  } catch (e) {
    // 忽略
  }
}

Module._load = function (request, parent, isMain) {
  // 1. 检查简单名称映射
  if (mockRequireMap[request]) {
    return mockRequireMap[request]
  }
  // 2. 检查绝对路径注册表
  try {
    const resolved = originalResolve.call(Module, request, parent)
    if (mockPathRegistry.has(resolved)) {
      return mockPathRegistry.get(resolved)
    }
  } catch (e) {
    // 路径解析失败，继续正常加载
  }
  return originalLoad.apply(this, arguments)
}

// ============ vi.mock（拦截 ESM import） ============
vi.mock('electron', () => electronMockModule)
vi.mock('@supabase/supabase-js', () => ({ createClient: supabaseMockModule.createClient }))
vi.mock('electron-updater', () => ({ autoUpdater: mockAutoUpdater }))
vi.mock('axios', () => mockRequireMap['axios'])

// ============ 全局 helper：清空文件系统 mock ============
beforeEach(() => {
  fsMockModule.__clear()
  httpsMockModule.__reset()
  childProcessMockModule.__reset()
})

// ============ 全局 helper：每个测试文件开始前清除 src 模块缓存 ============
// 这确保每个测试文件获得新鲜的模块状态（IIFE 重新执行，window.X 重新赋值）
// 否则 require 缓存会导致跨测试文件的状态泄漏
beforeAll(() => {
  const srcDir = path.join(process.cwd(), 'src')
  Object.keys(require.cache).forEach(key => {
    if (key.startsWith(srcDir)) {
      delete require.cache[key]
    }
  })
})

// ============ 全局 helper：DOM 清空 ============
beforeEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
  delete window.electronAPI
  delete window.Timer
  // 注意：不删除 window.Utils，因为 utils.js 是无状态工具模块，
  // 且许多测试文件在 beforeEach 中通过 window.Utils.CROP_CONFIG 等访问它。
  // 各测试文件如需 mock Utils，可在自己的 beforeEach 中覆盖。
})

// ============ 提供 mock 单例访问 ============
global.__electronMock = electronMockModule
global.__fsMock = fsMockModule
global.__supabaseMock = supabaseMockModule
global.__httpsMock = httpsMockModule
global.__childProcessMock = childProcessMockModule
global.__readlineMock = readlineMockModule

// ============ jsdom 增强：localStorage / matchMedia ============
if (typeof window !== 'undefined') {
  if (!window.localStorage) {
    const storage = new Map()
    window.localStorage = {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
      clear: () => storage.clear()
    }
  }
  if (!window.matchMedia) {
    window.matchMedia = (q) => ({
      matches: false,
      media: q,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    })
  }
  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16)
    window.cancelAnimationFrame = (id) => clearTimeout(id)
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  if (!window.IntersectionObserver) {
    window.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return [] }
    }
  }
  // Chart.js 需要的 canvas context
  if (!HTMLCanvasElement.prototype.getContext) {
    HTMLCanvasElement.prototype.getContext = () => ({
      fillRect: () => {},
      clearRect: () => {},
      getImageData: () => ({ data: [] }),
      putImageData: () => {},
      createImageData: () => [],
      setTransform: () => {},
      drawImage: () => {},
      save: () => {},
      fillText: () => {},
      restore: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      stroke: () => {},
      translate: () => {},
      scale: () => {},
      rotate: () => {},
      arc: () => {},
      fill: () => {},
      measureText: () => ({ width: 0 }),
      transform: () => {},
      rect: () => {},
      clip: () => {}
    })
  }
  // getBoundingClientRect 默认值
  if (!Element.prototype.getBoundingClientRect) {
    Element.prototype.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 100, height: 100, top: 0, left: 0, right: 100, bottom: 100
    })
  }
}
