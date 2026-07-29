/**
 * Supabase 客户端 mock
 *
 * 提供 from().select/insert/update/delete/eq/limit/order/single 链式 API
 * 测试中可通过 mockSupabase.__setRows / __setError 控制返回值
 *
 * 注意：依赖 vitest globals（vitest.config.js 中 globals: true）
 * 如果 vi 不可用（CommonJS 上下文），回退到本地 mockFn 实现。
 */
const mockFn = require('./mock-fn')
const vi = (typeof globalThis !== 'undefined' && globalThis.vi) ? globalThis.vi : { fn: mockFn }

class SupabaseQueryMock {
  constructor(client) {
    this.client = client
    this._filters = []
    this._data = null
    this._error = null
    this._single = false
    this._limit = null
    this._order = null
    this._op = null
    this._selectOptions = null
  }

  select(cols = '*', options = {}) {
    // 不覆盖 insert/update/delete 操作；.select() 在它们之后表示返回数据
    if (this._op !== 'insert' && this._op !== 'update' && this._op !== 'delete') {
      this._op = 'select'
    }
    this._cols = cols
    this._selectOptions = options
    return this
  }
  insert(rows) {
    this._op = 'insert'
    this._rows = rows
    return this
  }
  update(values) {
    this._op = 'update'
    this._values = values
    return this
  }
  delete() {
    this._op = 'delete'
    return this
  }
  eq(col, val) {
    this._filters.push({ type: 'eq', col, val })
    return this
  }
  neq(col, val) {
    this._filters.push({ type: 'neq', col, val })
    return this
  }
  in(col, vals) {
    this._filters.push({ type: 'in', col, vals })
    return this
  }
  limit(n) {
    this._limit = n
    return this
  }
  order(col, opts) {
    this._order = { col, opts }
    return this
  }
  single() {
    this._single = true
    return this._execute()
  }
  then(resolve, reject) {
    return this._execute().then(resolve, reject)
  }
  catch(reject) {
    return this._execute().catch(reject)
  }

  _matchFilters(row) {
    for (const f of this._filters) {
      if (f.type === 'eq' && row[f.col] !== f.val) return false
      if (f.type === 'neq' && row[f.col] === f.val) return false
      if (f.type === 'in' && !f.vals.includes(row[f.col])) return false
    }
    return true
  }

  _execute() {
    // 记录调用，方便断言
    this.client.__calls.push({
      table: this._table,
      op: this._op,
      filters: this._filters,
      values: this._values,
      rows: this._rows,
      single: this._single
    })

    // 应用错误覆盖
    if (this._error) {
      return Promise.resolve({ data: null, error: this._error })
    }

    // head: true 只返回 count，不返回 data
    if (this._selectOptions && this._selectOptions.head) {
      let data = this.client.__rows[this._table] || []
      data = data.filter((r) => this._matchFilters(r))
      return Promise.resolve({ count: data.length, data: null, error: null })
    }

    // 取数据
    let data = this.client.__rows[this._table] || []

    // 应用所有过滤器
    data = data.filter((r) => this._matchFilters(r))

    // limit
    if (this._limit) {
      data = data.slice(0, this._limit)
    }

    // order
    if (this._order) {
      const { col, opts } = this._order
      data = [...data].sort((a, b) => {
        const av = a[col]
        const bv = b[col]
        if (av < bv) return opts?.ascending ? -1 : 1
        if (av > bv) return opts?.ascending ? 1 : -1
        return 0
      })
    }

    // insert/update/delete 修改内部状态
    if (this._op === 'insert') {
      const newRows = Array.isArray(this._rows) ? this._rows : [this._rows]
      this.client.__rows[this._table] = [...(this.client.__rows[this._table] || []), ...newRows]
      data = newRows
    } else if (this._op === 'update') {
      const rows = this.client.__rows[this._table] || []
      const updatedRows = []
      for (let i = 0; i < rows.length; i++) {
        if (this._matchFilters(rows[i])) {
          rows[i] = { ...rows[i], ...this._values }
          updatedRows.push(rows[i])
        }
      }
      data = updatedRows
    } else if (this._op === 'delete') {
      const rows = this.client.__rows[this._table] || []
      this.client.__rows[this._table] = rows.filter((r) => !this._matchFilters(r))
      data = null
    }

    if (this._single) {
      data = data && data.length > 0 ? data[0] : null
      if (!data) {
        // single() 在没数据时返回 PGRST116 错误
        return Promise.resolve({
          data: null,
          error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }
        })
      }
    }

    return Promise.resolve({ data, error: null })
  }
}

class SupabaseClientMock {
  constructor() {
    this.__rows = {}
    this.__calls = []
    this.__errors = {}
    this.auth = {
      signInWithPassword: vi.fn().mockResolvedValue({ data: { user: null, session: null }, error: null }),
      signUp: vi.fn().mockResolvedValue({ data: { user: null, session: null }, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
    }
    this.channel = vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis()
    })
    this.removeChannel = vi.fn()
  }

  from(table) {
    const q = new SupabaseQueryMock(this)
    q._table = table
    return q
  }

  // 测试辅助方法
  __setRows(table, rows) {
    this.__rows[table] = rows
  }

  __setRow(table, row) {
    this.__rows[table] = [row]
  }

  __setError(table, error) {
    this.__errors[table] = error
    // 临时方案：把错误塞到下一次查询
    const origFrom = this.from.bind(this)
    this.from = (t) => {
      const q = origFrom(t)
      if (t === table) {
        q._error = error
      }
      return q
    }
    // 一次性的，下次调用恢复
    setTimeout(() => { this.from = origFrom }, 0)
  }

  __reset() {
    this.__rows = {}
    this.__calls = []
  }
}

const createClientMock = vi.fn(function (url, key) {
  return new SupabaseClientMock()
})

module.exports = {
  createClient: createClientMock,
  createClientMock,
  SupabaseClientMock,
  SupabaseQueryMock
}
