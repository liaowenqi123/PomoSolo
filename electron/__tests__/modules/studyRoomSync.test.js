/**
 * studyRoomSync.js 测试
 * 覆盖：init、setCurrentUser、自习室 CRUD、加入/离开、
 * 统计上传、排名、成员列表、在线状态、房间状态检查
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'

const studyRoomSync = require('../../src/modules/studyRoomSync')

function getClient() {
  const results = __supabaseMock.createClient.mock.results
  return results[results.length - 1].value
}

beforeAll(() => {
  studyRoomSync.init()
})

beforeEach(() => {
  vi.clearAllMocks()
  // 重新 init 以获得干净的 supabase client
  studyRoomSync.init()
  studyRoomSync.setCurrentUser({ id: 1, username: 'tester' })
})

describe('studyRoomSync - init & setCurrentUser', () => {
  it('init 不抛错', () => {
    expect(() => studyRoomSync.init()).not.toThrow()
  })

  it('setCurrentUser 设置用户', () => {
    expect(() => studyRoomSync.setCurrentUser({ id: 2, username: 'u2' })).not.toThrow()
  })
})

describe('studyRoomSync - getActiveRooms', () => {
  it('Supabase 未初始化失败', async () => {
    __supabaseMock.createClient.mockImplementationOnce(() => null)
    studyRoomSync.init()
    const result = await studyRoomSync.getActiveRooms()
    expect(result.success).toBe(false)
  })

  it('成功获取活跃自习室（含创建者名+成员数）', async () => {
    const client = getClient()
    client.__setRows('study_rooms', [
      { id: 'r1', name: 'room1', creator_id: 10, is_active: true, is_public: true, created_at: '2024-01-01' }
    ])
    client.__setRows('users', [{ id: 10, username: 'creator1' }])
    client.__setRows('study_room_members', [{ room_id: 'r1', user_id: 1 }])
    const result = await studyRoomSync.getActiveRooms()
    expect(result.success).toBe(true)
    expect(result.data).toHaveLength(1)
    expect(result.data[0].creator_name).toBe('creator1')
    expect(result.data[0].member_count).toBe(1)
  })

  it('publicOnly=true 时仅返回公开自习室', async () => {
    const client = getClient()
    client.__setRows('study_rooms', [
      { id: 'r1', name: 'public', creator_id: 10, is_active: true, is_public: true, created_at: '2024-01-01' },
      { id: 'r2', name: 'private', creator_id: 11, is_active: true, is_public: false, created_at: '2024-01-02' }
    ])
    client.__setRows('users', [{ id: 10, username: 'c1' }, { id: 11, username: 'c2' }])
    const result = await studyRoomSync.getActiveRooms(true)
    expect(result.success).toBe(true)
    expect(result.data).toHaveLength(1)
    expect(result.data[0].name).toBe('public')
  })

  it('查询返回错误时失败', async () => {
    const client = getClient()
    const origFrom = client.from.bind(client)
    client.from = (t) => {
      const q = origFrom(t)
      if (t === 'study_rooms') q._error = { message: 'db error' }
      return q
    }
    const result = await studyRoomSync.getActiveRooms()
    expect(result.success).toBe(false)
    expect(result.error).toContain('db error')
  })
})

describe('studyRoomSync - createRoom', () => {
  it('未登录失败', async () => {
    studyRoomSync.setCurrentUser(null)
    const result = await studyRoomSync.createRoom('room', 'desc')
    expect(result.success).toBe(false)
  })

  it('创建成功并自动加入', async () => {
    const client = getClient()
    client.__setRows('study_rooms', [{ id: 'new1', name: 'room', creator_id: 1 }])
    // joinRoom 会查询 study_rooms by id - 设置为返回新创建的房间
    // 由于 mock 的 single() 在有数据时返回第一行，我们预设一行
    client.__setRows('study_room_members', [])
    const result = await studyRoomSync.createRoom('myroom', 'desc', true)
    expect(result.success).toBe(true)
  })

  it('插入失败时返回错误', async () => {
    const client = getClient()
    const origFrom = client.from.bind(client)
    client.from = (t) => {
      const q = origFrom(t)
      if (t === 'study_rooms') q._error = { message: 'permission denied' }
      return q
    }
    const result = await studyRoomSync.createRoom('room', 'desc')
    expect(result.success).toBe(false)
    expect(result.error).toContain('permission denied')
  })
})

describe('studyRoomSync - joinRoom', () => {
  it('未登录失败', async () => {
    studyRoomSync.setCurrentUser(null)
    const result = await studyRoomSync.joinRoom('r1')
    expect(result.success).toBe(false)
  })

  it('自习室不存在失败', async () => {
    const client = getClient()
    client.__setRows('study_rooms', [])
    const result = await studyRoomSync.joinRoom('nonexistent')
    expect(result.success).toBe(false)
    expect(result.error).toContain('不存在')
  })

  it('房间不活跃且非创建者失败', async () => {
    const client = getClient()
    client.__setRows('study_rooms', [{ id: 'r1', creator_id: 999, is_active: false }])
    const result = await studyRoomSync.joinRoom('r1')
    expect(result.success).toBe(false)
    expect(result.error).toContain('只有创建者')
  })

  it('已加入时更新在线状态并重激活房间', async () => {
    const client = getClient()
    client.__setRows('study_rooms', [{ id: 'r1', creator_id: 1, is_active: false }])
    client.__setRows('study_room_members', [{ id: 5, room_id: 'r1', user_id: 1, is_online: false }])
    const result = await studyRoomSync.joinRoom('r1')
    expect(result.success).toBe(true)
    expect(result.rejoined).toBe(true)
  })

  it('首次加入成功', async () => {
    const client = getClient()
    client.__setRows('study_rooms', [{ id: 'r1', creator_id: 1, is_active: true }])
    client.__setRows('study_room_members', [])
    const result = await studyRoomSync.joinRoom('r1')
    expect(result.success).toBe(true)
  })

  it('房间不存在错误', async () => {
    const client = getClient()
    const origFrom = client.from.bind(client)
    client.from = (t) => {
      const q = origFrom(t)
      if (t === 'study_rooms') q._error = { message: 'not found' }
      return q
    }
    const result = await studyRoomSync.joinRoom('r1')
    expect(result.success).toBe(false)
    expect(result.error).toContain('不存在')
  })
})

describe('studyRoomSync - leaveRoom', () => {
  it('未登录失败', async () => {
    studyRoomSync.setCurrentUser(null)
    const result = await studyRoomSync.leaveRoom('r1')
    expect(result.success).toBe(false)
  })

  it('成功离开', async () => {
    const client = getClient()
    const result = await studyRoomSync.leaveRoom('r1')
    expect(result.success).toBe(true)
  })

  it('更新失败时返回错误', async () => {
    const client = getClient()
    const origFrom = client.from.bind(client)
    client.from = (t) => {
      const q = origFrom(t)
      if (t === 'study_room_members') q._error = { message: 'update failed' }
      return q
    }
    const result = await studyRoomSync.leaveRoom('r1')
    expect(result.success).toBe(false)
  })
})

describe('studyRoomSync - deleteRoom', () => {
  it('未登录失败', async () => {
    studyRoomSync.setCurrentUser(null)
    const result = await studyRoomSync.deleteRoom('r1')
    expect(result.success).toBe(false)
  })

  it('自习室不存在失败', async () => {
    const client = getClient()
    client.__setRows('study_rooms', [])
    const result = await studyRoomSync.deleteRoom('r1')
    expect(result.success).toBe(false)
    expect(result.error).toContain('不存在')
  })

  it('非创建者失败', async () => {
    const client = getClient()
    client.__setRows('study_rooms', [{ id: 'r1', creator_id: 999 }])
    const result = await studyRoomSync.deleteRoom('r1')
    expect(result.success).toBe(false)
    expect(result.error).toContain('创建者')
  })

  it('创建者删除成功', async () => {
    const client = getClient()
    client.__setRows('study_rooms', [{ id: 'r1', creator_id: 1 }])
    const result = await studyRoomSync.deleteRoom('r1')
    expect(result.success).toBe(true)
  })

  it('删除时 fetchError 失败', async () => {
    const client = getClient()
    const origFrom = client.from.bind(client)
    client.from = (t) => {
      const q = origFrom(t)
      if (t === 'study_rooms') q._error = { message: 'fetch failed' }
      return q
    }
    const result = await studyRoomSync.deleteRoom('r1')
    expect(result.success).toBe(false)
  })
})

describe('studyRoomSync - uploadTodayStats', () => {
  it('未登录失败', async () => {
    studyRoomSync.setCurrentUser(null)
    const result = await studyRoomSync.uploadTodayStats('r1', 30, 2)
    expect(result.success).toBe(false)
  })

  it('已有今日记录时更新', async () => {
    const client = getClient()
    const today = new Date().toISOString().split('T')[0]
    client.__setRows('daily_focus_records', [{ id: 1, user_id: 1, date: today, total_minutes: 10, session_count: 1 }])
    const result = await studyRoomSync.uploadTodayStats('r1', 30, 2)
    expect(result.success).toBe(true)
  })

  it('无今日记录时创建', async () => {
    const client = getClient()
    client.__setRows('daily_focus_records', [])
    const result = await studyRoomSync.uploadTodayStats('r1', 30, 2)
    expect(result.success).toBe(true)
  })

  it('更新失败时返回错误', async () => {
    const client = getClient()
    const today = new Date().toISOString().split('T')[0]
    client.__setRows('daily_focus_records', [{ id: 1, user_id: 1, date: today }])
    const origFrom = client.from.bind(client)
    client.from = (t) => {
      const q = origFrom(t)
      if (t === 'daily_focus_records') q._error = { message: 'update error' }
      return q
    }
    const result = await studyRoomSync.uploadTodayStats('r1', 30, 2)
    expect(result.success).toBe(false)
  })
})

describe('studyRoomSync - uploadFocusSession (deprecated)', () => {
  it('window.Stats 不可用时返回错误', async () => {
    const result = await studyRoomSync.uploadFocusSession('r1', 25, 'note')
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('window.Stats 可用时调用 uploadTodayStats', async () => {
    window.Stats = {
      getTodayMinutes: vi.fn().mockReturnValue(30),
      getTodayCount: vi.fn().mockReturnValue(2)
    }
    const result = await studyRoomSync.uploadFocusSession('r1', 25, 'note')
    expect(result.success).toBe(true)
    delete window.Stats
  })
})

describe('studyRoomSync - getTodayRanking', () => {
  it('Supabase 未初始化失败', async () => {
    __supabaseMock.createClient.mockImplementationOnce(() => null)
    studyRoomSync.init()
    const result = await studyRoomSync.getTodayRanking('r1')
    expect(result.success).toBe(false)
  })

  it('无成员时返回空数组', async () => {
    const client = getClient()
    client.__setRows('study_room_members', [])
    const result = await studyRoomSync.getTodayRanking('r1')
    expect(result.success).toBe(true)
    expect(result.data).toEqual([])
  })

  it('成功获取排名（含用户名）', async () => {
    const client = getClient()
    client.__setRows('study_room_members', [{ room_id: 'r1', user_id: 1 }])
    client.__setRows('users', [{ id: 1, username: 'u1' }])
    const today = new Date().toISOString().split('T')[0]
    client.__setRows('daily_focus_records', [{ user_id: 1, date: today, total_minutes: 60, session_count: 2 }])
    const result = await studyRoomSync.getTodayRanking('r1')
    expect(result.success).toBe(true)
    expect(result.data).toHaveLength(1)
    expect(result.data[0].username).toBe('u1')
  })

  it('查询成员列表失败', async () => {
    const client = getClient()
    const origFrom = client.from.bind(client)
    client.from = (t) => {
      const q = origFrom(t)
      if (t === 'study_room_members') q._error = { message: 'fail' }
      return q
    }
    const result = await studyRoomSync.getTodayRanking('r1')
    expect(result.success).toBe(false)
  })

  it('查询记录失败', async () => {
    const client = getClient()
    client.__setRows('study_room_members', [{ room_id: 'r1', user_id: 1 }])
    const origFrom = client.from.bind(client)
    client.from = (t) => {
      const q = origFrom(t)
      if (t === 'daily_focus_records') q._error = { message: 'records fail' }
      return q
    }
    const result = await studyRoomSync.getTodayRanking('r1')
    expect(result.success).toBe(false)
  })
})

describe('studyRoomSync - getRoomMembers', () => {
  it('Supabase 未初始化失败', async () => {
    __supabaseMock.createClient.mockImplementationOnce(() => null)
    studyRoomSync.init()
    const result = await studyRoomSync.getRoomMembers('r1')
    expect(result.success).toBe(false)
  })

  it('成功获取成员列表', async () => {
    const client = getClient()
    client.__setRows('study_room_members', [{ room_id: 'r1', user_id: 1, is_online: true }])
    client.__setRows('users', [{ id: 1, username: 'u1' }])
    const result = await studyRoomSync.getRoomMembers('r1')
    expect(result.success).toBe(true)
    expect(result.data).toHaveLength(1)
    expect(result.data[0].username).toBe('u1')
  })

  it('查询失败', async () => {
    const client = getClient()
    const origFrom = client.from.bind(client)
    client.from = (t) => {
      const q = origFrom(t)
      if (t === 'study_room_members') q._error = { message: 'fail' }
      return q
    }
    const result = await studyRoomSync.getRoomMembers('r1')
    expect(result.success).toBe(false)
  })
})

describe('studyRoomSync - getRoomById', () => {
  it('Supabase 未初始化失败', async () => {
    __supabaseMock.createClient.mockImplementationOnce(() => null)
    studyRoomSync.init()
    const result = await studyRoomSync.getRoomById('r1')
    expect(result.success).toBe(false)
  })

  it('成功获取自习室信息', async () => {
    const client = getClient()
    client.__setRows('study_rooms', [{ id: 'r1', name: 'room', creator_id: 1 }])
    client.__setRows('users', [{ id: 1, username: 'creator' }])
    client.__setRows('study_room_members', [{ room_id: 'r1', user_id: 1 }])
    const result = await studyRoomSync.getRoomById('r1')
    expect(result.success).toBe(true)
    expect(result.data.name).toBe('room')
    expect(result.data.creator_name).toBe('creator')
    expect(result.data.member_count).toBe(1)
  })

  it('自习室不存在失败', async () => {
    const client = getClient()
    client.__setRows('study_rooms', [])
    const result = await studyRoomSync.getRoomById('nonexistent')
    expect(result.success).toBe(false)
    expect(result.error).toContain('不存在')
  })
})

describe('studyRoomSync - getMyRooms', () => {
  it('未登录失败', async () => {
    studyRoomSync.setCurrentUser(null)
    const result = await studyRoomSync.getMyRooms()
    expect(result.success).toBe(false)
  })

  it('成功获取我创建的自习室', async () => {
    const client = getClient()
    client.__setRows('study_rooms', [{ id: 'r1', creator_id: 1, name: 'room1' }])
    client.__setRows('study_room_members', [{ room_id: 'r1', user_id: 1, is_online: true }])
    const result = await studyRoomSync.getMyRooms()
    expect(result.success).toBe(true)
    expect(result.data).toHaveLength(1)
    expect(result.data[0].member_count).toBe(1)
    expect(result.data[0].online_count).toBe(1)
  })

  it('查询失败', async () => {
    const client = getClient()
    const origFrom = client.from.bind(client)
    client.from = (t) => {
      const q = origFrom(t)
      if (t === 'study_rooms') q._error = { message: 'fail' }
      return q
    }
    const result = await studyRoomSync.getMyRooms()
    expect(result.success).toBe(false)
  })
})

describe('studyRoomSync - updateOnlineStatus', () => {
  it('未登录失败', async () => {
    studyRoomSync.setCurrentUser(null)
    const result = await studyRoomSync.updateOnlineStatus('r1')
    expect(result.success).toBe(false)
  })

  it('成功更新在线状态（无超时成员）', async () => {
    const client = getClient()
    client.__setRows('study_room_members', [{ user_id: 1, room_id: 'r1', is_online: true, last_active: new Date().toISOString() }])
    client.__setRows('study_rooms', [{ id: 'r1', is_active: true }])
    const result = await studyRoomSync.updateOnlineStatus('r1')
    expect(result.success).toBe(true)
  })

  it('成功更新 - 有超时成员', async () => {
    const client = getClient()
    const oldTime = new Date(Date.now() - 30 * 60 * 1000).toISOString() // 30 分钟前
    client.__setRows('study_room_members', [
      { user_id: 1, room_id: 'r1', is_online: true, last_active: new Date().toISOString() },
      { user_id: 2, room_id: 'r1', is_online: true, last_active: oldTime }
    ])
    client.__setRows('study_rooms', [{ id: 'r1', is_active: true }])
    const result = await studyRoomSync.updateOnlineStatus('r1')
    expect(result.success).toBe(true)
  })

  it('成功更新 - 无在线成员的房间被下线', async () => {
    const client = getClient()
    client.__setRows('study_room_members', [{ user_id: 1, room_id: 'r1', is_online: true, last_active: new Date().toISOString() }])
    // 房间 r2 无在线成员
    client.__setRows('study_rooms', [{ id: 'r2', is_active: true }])
    const result = await studyRoomSync.updateOnlineStatus('r1')
    expect(result.success).toBe(true)
  })

  it('更新自己在线状态失败时返回错误', async () => {
    const client = getClient()
    const origFrom = client.from.bind(client)
    let firstCall = true
    client.from = (t) => {
      const q = origFrom(t)
      if (firstCall && t === 'study_room_members') {
        q._error = { message: 'update fail' }
        firstCall = false
      }
      return q
    }
    const result = await studyRoomSync.updateOnlineStatus('r1')
    expect(result.success).toBe(false)
  })
})

describe('studyRoomSync - checkRoomStatus', () => {
  it('Supabase 未初始化失败', async () => {
    __supabaseMock.createClient.mockImplementationOnce(() => null)
    studyRoomSync.init()
    const result = await studyRoomSync.checkRoomStatus('r1')
    expect(result.success).toBe(false)
  })

  it('获取成员失败时返回成功', async () => {
    const client = getClient()
    const origFrom = client.from.bind(client)
    client.from = (t) => {
      const q = origFrom(t)
      if (t === 'study_room_members') q._error = { message: 'fail' }
      return q
    }
    const result = await studyRoomSync.checkRoomStatus('r1')
    expect(result.success).toBe(true)
  })

  it('有超时成员时标记离线', async () => {
    const client = getClient()
    const oldTime = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    client.__setRows('study_room_members', [
      { user_id: 1, room_id: 'r1', is_online: true, last_active: oldTime },
      { user_id: 2, room_id: 'r1', is_online: true, last_active: new Date().toISOString() }
    ])
    const result = await studyRoomSync.checkRoomStatus('r1')
    expect(result.success).toBe(true)
  })

  it('无在线成员时下线房间', async () => {
    const client = getClient()
    client.__setRows('study_room_members', [])
    const result = await studyRoomSync.checkRoomStatus('r1')
    expect(result.success).toBe(true)
  })

  it('有在线成员时保持房间活跃', async () => {
    const client = getClient()
    client.__setRows('study_room_members', [
      { user_id: 1, room_id: 'r1', is_online: true, last_active: new Date().toISOString() }
    ])
    const result = await studyRoomSync.checkRoomStatus('r1')
    expect(result.success).toBe(true)
  })
})

describe('studyRoomSync - subscribeRoomUpdates & unsubscribeAll', () => {
  it('subscribe 成功', () => {
    const result = studyRoomSync.subscribeRoomUpdates('r1', vi.fn(), vi.fn())
    expect(result.success).toBe(true)
  })

  it('Supabase 未初始化失败', () => {
    __supabaseMock.createClient.mockImplementationOnce(() => null)
    studyRoomSync.init()
    const result = studyRoomSync.subscribeRoomUpdates('r1', vi.fn(), vi.fn())
    expect(result.success).toBe(false)
  })

  it('unsubscribeAll 不抛错', () => {
    expect(() => studyRoomSync.unsubscribeAll()).not.toThrow()
  })
})

// ============ 错误路径覆盖测试 ============

describe('studyRoomSync - 错误路径覆盖', () => {
  it('getActiveRooms - from 抛异常时返回错误', async () => {
    const client = getClient()
    client.from = () => { throw new Error('connection lost') }
    const result = await studyRoomSync.getActiveRooms()
    expect(result.success).toBe(false)
    expect(result.error).toContain('connection lost')
  })

  it('getActiveRooms - 创建者不存在时返回未知用户', async () => {
    const client = getClient()
    client.__setRows('study_rooms', [
      { id: 'r1', name: 'room1', creator_id: 999, is_active: true, is_public: true, created_at: '2024-01-01' }
    ])
    client.__setRows('users', [])
    client.__setRows('study_room_members', [])
    const result = await studyRoomSync.getActiveRooms()
    expect(result.success).toBe(true)
    expect(result.data[0].creator_name).toBe('未知用户')
  })

  it('createRoom - from 抛异常时返回错误', async () => {
    const client = getClient()
    client.from = () => { throw new Error('create conn error') }
    const result = await studyRoomSync.createRoom('room', 'desc')
    expect(result.success).toBe(false)
    expect(result.error).toContain('create conn error')
  })

  it('joinRoom - 已加入成员更新失败', async () => {
    const client = getClient()
    client.__setRows('study_rooms', [{ id: 'r1', creator_id: 1, is_active: false }])
    client.__setRows('study_room_members', [{ id: 5, room_id: 'r1', user_id: 1, is_online: false }])
    const origFrom = client.from.bind(client)
    client.from = (t) => {
      const q = origFrom(t)
      if (t === 'study_room_members') {
        const origUpdate = q.update.bind(q)
        q.update = (values) => {
          const r = origUpdate(values)
          r._error = { message: 'rejoin update fail' }
          return r
        }
      }
      return q
    }
    const result = await studyRoomSync.joinRoom('r1')
    expect(result.success).toBe(false)
    expect(result.error).toContain('rejoin update fail')
  })

  it('joinRoom - 首次加入 insert 失败', async () => {
    const client = getClient()
    client.__setRows('study_rooms', [{ id: 'r1', creator_id: 1, is_active: true }])
    client.__setRows('study_room_members', [])
    const origFrom = client.from.bind(client)
    client.from = (t) => {
      const q = origFrom(t)
      if (t === 'study_room_members') {
        const origInsert = q.insert.bind(q)
        q.insert = (rows) => {
          const r = origInsert(rows)
          r._error = { message: 'insert member fail' }
          return r
        }
      }
      return q
    }
    const result = await studyRoomSync.joinRoom('r1')
    expect(result.success).toBe(false)
    expect(result.error).toContain('insert member fail')
  })

  it('joinRoom - from 抛异常时返回错误', async () => {
    const client = getClient()
    client.from = () => { throw new Error('join conn error') }
    const result = await studyRoomSync.joinRoom('r1')
    expect(result.success).toBe(false)
    expect(result.error).toContain('join conn error')
  })

  it('leaveRoom - from 抛异常时返回错误', async () => {
    const client = getClient()
    client.from = () => { throw new Error('leave conn error') }
    const result = await studyRoomSync.leaveRoom('r1')
    expect(result.success).toBe(false)
    expect(result.error).toContain('leave conn error')
  })

  it('uploadTodayStats - 更新已有记录失败', async () => {
    const client = getClient()
    const today = new Date().toISOString().split('T')[0]
    client.__setRows('daily_focus_records', [{ id: 1, user_id: 1, date: today, total_minutes: 10, session_count: 1 }])
    const origFrom = client.from.bind(client)
    client.from = (t) => {
      const q = origFrom(t)
      if (t === 'daily_focus_records') {
        const origUpdate = q.update.bind(q)
        q.update = (values) => {
          const r = origUpdate(values)
          r._error = { message: 'stats update fail' }
          return r
        }
      }
      return q
    }
    const result = await studyRoomSync.uploadTodayStats('r1', 30, 2)
    expect(result.success).toBe(false)
    expect(result.error).toContain('stats update fail')
  })

  it('uploadTodayStats - from 抛异常时返回错误', async () => {
    const client = getClient()
    client.from = () => { throw new Error('upload conn error') }
    const result = await studyRoomSync.uploadTodayStats('r1', 30, 2)
    expect(result.success).toBe(false)
    expect(result.error).toContain('upload conn error')
  })

  it('getRoomMembers - from 抛异常时返回错误', async () => {
    const client = getClient()
    client.from = () => { throw new Error('members conn error') }
    const result = await studyRoomSync.getRoomMembers('r1')
    expect(result.success).toBe(false)
    expect(result.error).toContain('members conn error')
  })

  it('getTodayRanking - records 查询抛异常时返回错误', async () => {
    const client = getClient()
    client.__setRows('study_room_members', [{ room_id: 'r1', user_id: 1 }])
    const origFrom = client.from.bind(client)
    client.from = (t) => {
      if (t === 'daily_focus_records') throw new Error('records conn error')
      return origFrom(t)
    }
    const result = await studyRoomSync.getTodayRanking('r1')
    expect(result.success).toBe(false)
    expect(result.error).toContain('records conn error')
  })

  it('getRoomById - from 抛异常时返回错误', async () => {
    const client = getClient()
    client.from = () => { throw new Error('getroom conn error') }
    const result = await studyRoomSync.getRoomById('r1')
    expect(result.success).toBe(false)
    expect(result.error).toContain('getroom conn error')
  })

  it('getMyRooms - from 抛异常时返回错误', async () => {
    const client = getClient()
    client.from = () => { throw new Error('myrooms conn error') }
    const result = await studyRoomSync.getMyRooms()
    expect(result.success).toBe(false)
    expect(result.error).toContain('myrooms conn error')
  })

  it('checkRoomStatus - 成员查询后 update 抛异常', async () => {
    const client = getClient()
    const oldTime = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    client.__setRows('study_room_members', [
      { user_id: 1, room_id: 'r1', is_online: true, last_active: oldTime }
    ])
    const origFrom = client.from.bind(client)
    let throwOnUpdate = false
    client.from = (t) => {
      const q = origFrom(t)
      if (throwOnUpdate && t === 'study_room_members') {
        const origUpdate = q.update.bind(q)
        q.update = (values) => {
          const r = origUpdate(values)
          r._error = { message: 'timeout update fail' }
          return r
        }
      }
      return q
    }
    throwOnUpdate = true
    const result = await studyRoomSync.checkRoomStatus('r1')
    expect(result.success).toBe(true)
  })

  it('updateOnlineStatus - 获取所有成员失败但仍返回成功', async () => {
    const client = getClient()
    client.__setRows('study_room_members', [{ user_id: 1, room_id: 'r1', is_online: true, last_active: new Date().toISOString() }])
    const origFrom = client.from.bind(client)
    let callIdx = 0
    client.from = (t) => {
      const q = origFrom(t)
      callIdx++
      // 第 2 次调用是获取所有成员（select all without filter）
      if (callIdx === 2) {
        q._error = { message: 'get all members fail' }
      }
      return q
    }
    const result = await studyRoomSync.updateOnlineStatus('r1')
    expect(result.success).toBe(true)
  })
})
