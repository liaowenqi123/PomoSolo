/**
 * 文件系统 mock - 提供 fs 模块的内存实现
 *
 * 测试中通过 setFile / getFile / clear 操作虚拟文件系统
 *
 * 注意：依赖 vitest globals（vitest.config.js 中 globals: true）
 * 如果 vi 不可用（CommonJS 上下文），回退到本地 mockFn 实现。
 */
const mockFn = require('./mock-fn')
const vi = (typeof globalThis !== 'undefined' && globalThis.vi) ? globalThis.vi : { fn: mockFn }

const store = new Map()

const fsMock = {
  existsSync: vi.fn((path) => store.has(path)),
  readFileSync: vi.fn((path, enc) => {
    if (!store.has(path)) {
      const err = new Error(`ENOENT: no such file or directory, open '${path}'`)
      err.code = 'ENOENT'
      throw err
    }
    return store.get(path)
  }),
  writeFileSync: vi.fn((path, content, enc) => {
    store.set(path, content)
  }),
  mkdirSync: vi.fn((path, opts) => {
    if (!store.has(path + '/')) store.set(path + '/', true)
  }),
  readdirSync: vi.fn((path) => {
    const result = []
    for (const key of store.keys()) {
      if (key.startsWith(path + '/')) {
        const rest = key.slice(path.length + 1)
        if (rest && !rest.includes('/')) result.push(rest)
      }
    }
    return result
  }),
  rmSync: vi.fn((path, opts) => {
    const toDelete = []
    for (const key of store.keys()) {
      if (key === path || key.startsWith(path + '/')) toDelete.push(key)
    }
    toDelete.forEach((k) => store.delete(k))
  }),
  unlinkSync: vi.fn((path) => {
    store.delete(path)
  }),
  copyFileSync: vi.fn((src, dest) => {
    if (store.has(src)) store.set(dest, store.get(src))
  }),
  cpSync: vi.fn((src, dest, opts) => {
    for (const [key, value] of store.entries()) {
      if (key === src || key.startsWith(src + '/')) {
        const newKey = key === src ? dest : dest + key.slice(src.length)
        store.set(newKey, value)
      }
    }
  }),
  statSync: vi.fn((path) => ({
    isFile: () => !store.has(path + '/'),
    isDirectory: () => store.has(path + '/'),
    size: store.has(path) ? (store.get(path) || '').length : 0,
    mtime: new Date(),
    mtimeMs: Date.now()
  })),
  renameSync: vi.fn((oldPath, newPath) => {
    if (store.has(oldPath)) {
      store.set(newPath, store.get(oldPath))
      store.delete(oldPath)
    }
  }),
  appendFileSync: vi.fn((path, content, enc) => {
    const existing = store.has(path) ? store.get(path) : ''
    store.set(path, existing + content)
  }),
  watch: vi.fn(() => ({ close: vi.fn() })),
  promises: {
    readFile: vi.fn(async (path, enc) => {
      if (!store.has(path)) {
        const err = new Error(`ENOENT: no such file or directory, open '${path}'`)
        err.code = 'ENOENT'
        throw err
      }
      return store.get(path)
    }),
    writeFile: vi.fn(async (path, content, enc) => {
      store.set(path, content)
    }),
    mkdir: vi.fn(async (path, opts) => {}),
    readdir: vi.fn(async (path) => {
      const result = []
      for (const key of store.keys()) {
        if (key.startsWith(path + '/')) {
          const rest = key.slice(path.length + 1)
          if (rest && !rest.includes('/')) result.push(rest)
        }
      }
      return result
    }),
    unlink: vi.fn(async (path) => {
      store.delete(path)
    }),
    rm: vi.fn(async (path, opts) => {
      const toDelete = []
      for (const key of store.keys()) {
        if (key === path || key.startsWith(path + '/')) toDelete.push(key)
      }
      toDelete.forEach((k) => store.delete(k))
    })
  }
}

// 测试辅助方法
fsMock.__setFile = (path, content) => {
  store.set(path, content)
}

fsMock.__getFile = (path) => store.get(path)

fsMock.__hasFile = (path) => store.has(path)

fsMock.__clear = () => {
  store.clear()
}

fsMock.__snapshot = () => {
  const result = {}
  for (const [k, v] of store.entries()) {
    result[k] = v
  }
  return result
}

module.exports = fsMock
