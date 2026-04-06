/**
 * 自习室数据同步模块 - 主进程
 * 负责与 Supabase 同步自习室数据
 */

const { createClient } = require('@supabase/supabase-js')

// Supabase 配置
const SUPABASE_URL = 'https://sjexeynibnfqxvwehnxk.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_NtzlEhTWwC4qpSY0DEvQ0Q_ER6yJoTz'

let supabase = null
let currentUser = null
let currentRoom = null
let subscriptions = []

/**
 * 初始化模块
 */
function init() {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  console.log('[StudyRoomSync] 模块已初始化')
}

/**
 * 设置当前用户
 * @param {object} user - 用户信息 { id, username }
 */
function setCurrentUser(user) {
  currentUser = user
  console.log('[StudyRoomSync] 当前用户:', user?.username)
}

/**
 * 获取活跃的自习室列表
 * @param {boolean} publicOnly - 是否只获取公开的自习室
 * @returns {Promise<{success: boolean, data?: array, error?: string}>}
 */
async function getActiveRooms(publicOnly = false) {
  if (!supabase) {
    return { success: false, error: 'Supabase 未初始化' }
  }

  try {
    // 构建查询
    let query = supabase
      .from('study_rooms')
      .select('*')
      .eq('is_active', true)
    
    // 如果只获取公开的自习室
    if (publicOnly) {
      query = query.eq('is_public', true)
    }
    
    const { data: rooms, error: roomsError } = await query.order('created_at', { ascending: false })

    if (roomsError) {
      console.error('[StudyRoomSync] 获取自习室列表失败:', roomsError)
      return { success: false, error: roomsError.message }
    }

    // 为每个自习室获取创建者用户名和成员数
    const roomsWithDetails = await Promise.all(rooms.map(async (room) => {
      // 获取创建者用户名
      const creatorName = await getUsernameById(room.creator_id)
      
      // 获取成员数
      const { count } = await supabase
        .from('study_room_members')
        .select('*', { count: 'exact', head: true })
        .eq('room_id', room.id)
      
      return {
        ...room,
        creator_name: creatorName,
        member_count: count || 0
      }
    }))

    return { success: true, data: roomsWithDetails }
  } catch (err) {
    console.error('[StudyRoomSync] 获取自习室列表异常:', err)
    return { success: false, error: err.message }
  }
}

/**
 * 根据用户ID获取用户名
 * @param {number} userId - 用户ID
 * @returns {Promise<string>}
 */
async function getUsernameById(userId) {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('username')
      .eq('id', userId)
      .single()
    
    if (error || !data) {
      return '未知用户'
    }
    
    return data.username
  } catch (err) {
    return '未知用户'
  }
}

/**
 * 创建自习室
 * @param {string} name - 自习室名称
 * @param {string} description - 描述
 * @param {boolean} isPublic - 是否公开
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
async function createRoom(name, description = '', isPublic = true) {
  if (!supabase || !currentUser) {
    return { success: false, error: '未登录或 Supabase 未初始化' }
  }

  try {
    const { data, error } = await supabase
      .from('study_rooms')
      .insert([{
        name,
        description,
        creator_id: currentUser.id,
        is_public: isPublic
      }])
      .select()
      .single()

    if (error) {
      console.error('[StudyRoomSync] 创建自习室失败:', error)
      return { success: false, error: error.message }
    }

    // 自动加入自己创建的自习室
    await joinRoom(data.id)

    console.log('[StudyRoomSync] 创建自习室成功:', data.name, isPublic ? '(公开)' : '(私密)')
    return { success: true, data }
  } catch (err) {
    console.error('[StudyRoomSync] 创建自习室异常:', err)
    return { success: false, error: err.message }
  }
}

/**
 * 加入自习室
 * @param {string} roomId - 自习室 ID
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
async function joinRoom(roomId) {
  if (!supabase || !currentUser) {
    return { success: false, error: '未登录或 Supabase 未初始化' }
  }

  try {
    // 检查是否已加入
    const { data: existing } = await supabase
      .from('study_room_members')
      .select('*')
      .eq('room_id', roomId)
      .eq('user_id', currentUser.id)
      .single()

    if (existing) {
      // 已加入，更新在线状态
      const { data, error } = await supabase
        .from('study_room_members')
        .update({
          is_online: true,
          last_active: new Date().toISOString()
        })
        .eq('id', existing.id)
        .select()
        .single()

      if (error) {
        return { success: false, error: error.message }
      }

      currentRoom = roomId
      return { success: true, data, rejoined: true }
    }

    // 首次加入
    const { data, error } = await supabase
      .from('study_room_members')
      .insert([{
        room_id: roomId,
        user_id: currentUser.id
      }])
      .select()
      .single()

    if (error) {
      console.error('[StudyRoomSync] 加入自习室失败:', error)
      return { success: false, error: error.message }
    }

    currentRoom = roomId
    console.log('[StudyRoomSync] 加入自习室成功')
    return { success: true, data }
  } catch (err) {
    console.error('[StudyRoomSync] 加入自习室异常:', err)
    return { success: false, error: err.message }
  }
}

/**
 * 离开自习室
 * @param {string} roomId - 自习室 ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function leaveRoom(roomId) {
  if (!supabase || !currentUser) {
    return { success: false, error: '未登录或 Supabase 未初始化' }
  }

  try {
    // 标记为离线
    const { error } = await supabase
      .from('study_room_members')
      .update({
        is_online: false,
        last_active: new Date().toISOString()
      })
      .eq('room_id', roomId)
      .eq('user_id', currentUser.id)

    if (error) {
      console.error('[StudyRoomSync] 离开自习室失败:', error)
      return { success: false, error: error.message }
    }

    // 取消订阅
    unsubscribeAll()

    if (currentRoom === roomId) {
      currentRoom = null
    }

    console.log('[StudyRoomSync] 离开自习室成功')
    return { success: true }
  } catch (err) {
    console.error('[StudyRoomSync] 离开自习室异常:', err)
    return { success: false, error: err.message }
  }
}

/**
 * 上传今日统计数据到自习室
 * @param {string} roomId - 自习室 ID（用于触发更新，但不存储在记录中）
 * @param {number} todayMinutes - 今日累计分钟数
 * @param {number} todayCount - 今日完成次数
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function uploadTodayStats(roomId, todayMinutes, todayCount) {
  if (!supabase || !currentUser) {
    return { success: false, error: '未登录或 Supabase 未初始化' }
  }

  try {
    const today = new Date().toISOString().split('T')[0]

    // 检查是否已有今日记录（不按room_id过滤，每个用户每天只有一条记录）
    const { data: existing } = await supabase
      .from('daily_focus_records')
      .select('*')
      .eq('user_id', currentUser.id)
      .eq('date', today)
      .single()

    if (existing) {
      // 更新现有记录（直接覆盖为最新的统计数据）
      const { error: updateError } = await supabase
        .from('daily_focus_records')
        .update({
          total_minutes: todayMinutes,
          session_count: todayCount,
          room_id: roomId, // 更新最后活跃的自习室ID
          last_updated: new Date().toISOString()
        })
        .eq('id', existing.id)

      if (updateError) {
        console.error('[StudyRoomSync] 更新今日统计失败:', updateError)
        return { success: false, error: updateError.message }
      }
    } else {
      // 创建新记录
      const { error: insertError } = await supabase
        .from('daily_focus_records')
        .insert([{
          user_id: currentUser.id,
          room_id: roomId,
          date: today,
          total_minutes: todayMinutes,
          session_count: todayCount
        }])

      if (insertError) {
        console.error('[StudyRoomSync] 创建今日统计失败:', insertError)
        return { success: false, error: insertError.message }
      }
    }

    console.log('[StudyRoomSync] 上传今日统计成功:', todayMinutes, '分钟,', todayCount, '次')
    return { success: true }
  } catch (err) {
    console.error('[StudyRoomSync] 上传今日统计异常:', err)
    return { success: false, error: err.message }
  }
}

/**
 * 上传专注会话（已废弃，保留用于兼容）
 * @deprecated 使用 uploadTodayStats 代替
 */
async function uploadFocusSession(roomId, minutes, note = '') {
  console.warn('[StudyRoomSync] uploadFocusSession 已废弃，请使用 uploadTodayStats')
  
  // 获取当前的今日统计
  if (typeof window !== 'undefined' && window.Stats) {
    const todayMinutes = window.Stats.getTodayMinutes ? window.Stats.getTodayMinutes() : 0
    const todayCount = window.Stats.getTodayCount ? window.Stats.getTodayCount() : 0
    return uploadTodayStats(roomId, todayMinutes, todayCount)
  }
  
  return { success: false, error: '无法获取统计数据' }
}

/**
 * 获取今日排名
 * @param {string} roomId - 自习室 ID
 * @returns {Promise<{success: boolean, data?: array, error?: string}>}
 */
async function getTodayRanking(roomId) {
  if (!supabase) {
    return { success: false, error: 'Supabase 未初始化' }
  }

  try {
    const today = new Date().toISOString().split('T')[0]
    
    // 获取该自习室的所有成员
    const { data: members, error: membersError } = await supabase
      .from('study_room_members')
      .select('user_id')
      .eq('room_id', roomId)

    if (membersError) {
      console.error('[StudyRoomSync] 获取成员列表失败:', membersError)
      return { success: false, error: membersError.message }
    }

    if (!members || members.length === 0) {
      return { success: true, data: [] }
    }

    const userIds = members.map(m => m.user_id)

    // 获取这些成员的今日统计数据（不按room_id过滤，因为现在存储的是总统计）
    const { data: records, error } = await supabase
      .from('daily_focus_records')
      .select('*')
      .in('user_id', userIds)
      .eq('date', today)
      .order('total_minutes', { ascending: false })
      .limit(50)

    if (error) {
      console.error('[StudyRoomSync] 获取排名失败:', error)
      return { success: false, error: error.message }
    }

    // 为每条记录添加用户名
    const recordsWithUsername = await Promise.all(records.map(async (record) => {
      const username = await getUsernameById(record.user_id)
      return {
        ...record,
        username
      }
    }))

    return { success: true, data: recordsWithUsername }
  } catch (err) {
    console.error('[StudyRoomSync] 获取排名异常:', err)
    return { success: false, error: err.message }
  }
}

/**
 * 获取自习室成员列表
 * @param {string} roomId - 自习室 ID
 * @returns {Promise<{success: boolean, data?: array, error?: string}>}
 */
async function getRoomMembers(roomId) {
  if (!supabase) {
    return { success: false, error: 'Supabase 未初始化' }
  }

  try {
    // 先获取成员列表
    const { data: members, error } = await supabase
      .from('study_room_members')
      .select('*')
      .eq('room_id', roomId)
      .eq('is_online', true)
      .order('last_active', { ascending: false })

    if (error) {
      console.error('[StudyRoomSync] 获取成员列表失败:', error)
      return { success: false, error: error.message }
    }

    // 为每个成员添加用户名
    const membersWithUsername = await Promise.all(members.map(async (member) => {
      const username = await getUsernameById(member.user_id)
      return {
        ...member,
        username
      }
    }))

    return { success: true, data: membersWithUsername }
  } catch (err) {
    console.error('[StudyRoomSync] 获取成员列表异常:', err)
    return { success: false, error: err.message }
  }
}

/**
 * 订阅自习室实时更新
 * @param {string} roomId - 自习室 ID
 * @param {function} onRankingUpdate - 排名更新回调
 * @param {function} onMemberUpdate - 成员更新回调
 * @returns {{success: boolean, error?: string}}
 */
function subscribeRoomUpdates(roomId, onRankingUpdate, onMemberUpdate) {
  if (!supabase) {
    return { success: false, error: 'Supabase 未初始化' }
  }

  try {
    // 订阅每日专注记录变化
    const recordChannel = supabase
      .channel(`daily-records-${roomId}`)
      .on('postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'daily_focus_records',
          filter: `room_id=eq.${roomId}`
        },
        (payload) => {
          console.log('[StudyRoomSync] 排名数据更新:', payload)
          if (onRankingUpdate) {
            onRankingUpdate(payload)
          }
        }
      )
      .subscribe()

    subscriptions.push(recordChannel)

    // 订阅成员变化
    const memberChannel = supabase
      .channel(`room-members-${roomId}`)
      .on('postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'study_room_members',
          filter: `room_id=eq.${roomId}`
        },
        (payload) => {
          console.log('[StudyRoomSync] 成员数据更新:', payload)
          if (onMemberUpdate) {
            onMemberUpdate(payload)
          }
        }
      )
      .subscribe()

    subscriptions.push(memberChannel)

    console.log('[StudyRoomSync] 已订阅自习室实时更新')
    return { success: true }
  } catch (err) {
    console.error('[StudyRoomSync] 订阅失败:', err)
    return { success: false, error: err.message }
  }
}

/**
 * 取消所有订阅
 */
function unsubscribeAll() {
  subscriptions.forEach(channel => {
    supabase.removeChannel(channel)
  })
  subscriptions = []
  console.log('[StudyRoomSync] 已取消所有订阅')
}

/**
 * 更新在线状态（心跳）
 * @param {string} roomId - 自习室 ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function updateOnlineStatus(roomId) {
  if (!supabase || !currentUser) {
    return { success: false, error: '未登录或 Supabase 未初始化' }
  }

  try {
    const { error } = await supabase
      .from('study_room_members')
      .update({
        last_active: new Date().toISOString(),
        is_online: true
      })
      .eq('room_id', roomId)
      .eq('user_id', currentUser.id)

    if (error) {
      console.error('[StudyRoomSync] 更新在线状态失败:', error)
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (err) {
    console.error('[StudyRoomSync] 更新在线状态异常:', err)
    return { success: false, error: err.message }
  }
}

/**
 * 删除自习室（仅创建者可删除）
 * @param {string} roomId - 自习室 ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function deleteRoom(roomId) {
  if (!supabase || !currentUser) {
    return { success: false, error: '未登录或 Supabase 未初始化' }
  }

  try {
    // 检查是否是创建者
    const { data: room, error: roomError } = await supabase
      .from('study_rooms')
      .select('creator_id')
      .eq('id', roomId)
      .single()
    
    if (roomError || !room) {
      return { success: false, error: '自习室不存在' }
    }
    
    if (room.creator_id !== currentUser.id) {
      return { success: false, error: '只有创建者可以删除自习室' }
    }

    // 删除所有相关数据（按依赖顺序）
    // 1. 删除会话记录
    await supabase
      .from('focus_sessions')
      .delete()
      .eq('room_id', roomId)
    
    // 2. 删除每日记录
    await supabase
      .from('daily_focus_records')
      .delete()
      .eq('room_id', roomId)
    
    // 3. 删除成员记录
    await supabase
      .from('study_room_members')
      .delete()
      .eq('room_id', roomId)
    
    // 4. 删除自习室
    const { error: deleteError } = await supabase
      .from('study_rooms')
      .delete()
      .eq('id', roomId)

    if (deleteError) {
      console.error('[StudyRoomSync] 删除自习室失败:', deleteError)
      return { success: false, error: deleteError.message }
    }

    // 取消订阅
    unsubscribeAll()

    if (currentRoom === roomId) {
      currentRoom = null
    }

    console.log('[StudyRoomSync] 删除自习室成功')
    return { success: true }
  } catch (err) {
    console.error('[StudyRoomSync] 删除自习室异常:', err)
    return { success: false, error: err.message }
  }
}

/**
 * 根据ID获取自习室信息
 * @param {string} roomId - 自习室 ID
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
async function getRoomById(roomId) {
  if (!supabase) {
    return { success: false, error: 'Supabase 未初始化' }
  }

  try {
    const { data: room, error } = await supabase
      .from('study_rooms')
      .select('*')
      .eq('id', roomId)
      .single()

    if (error || !room) {
      return { success: false, error: '自习室不存在' }
    }

    // 获取创建者用户名
    const creatorName = await getUsernameById(room.creator_id)
    
    // 获取成员数
    const { count } = await supabase
      .from('study_room_members')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', room.id)

    return {
      success: true,
      data: {
        ...room,
        creator_name: creatorName,
        member_count: count || 0
      }
    }
  } catch (err) {
    console.error('[StudyRoomSync] 获取自习室信息异常:', err)
    return { success: false, error: err.message }
  }
}

/**
 * 获取我创建的自习室列表
 * @returns {Promise<{success: boolean, data?: array, error?: string}>}
 */
async function getMyRooms() {
  if (!supabase || !currentUser) {
    return { success: false, error: '未登录或 Supabase 未初始化' }
  }

  try {
    const { data: rooms, error: roomsError } = await supabase
      .from('study_rooms')
      .select('*')
      .eq('creator_id', currentUser.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (roomsError) {
      console.error('[StudyRoomSync] 获取我的自习室失败:', roomsError)
      return { success: false, error: roomsError.message }
    }

    // 为每个自习室获取成员数
    const roomsWithDetails = await Promise.all(rooms.map(async (room) => {
      const { count } = await supabase
        .from('study_room_members')
        .select('*', { count: 'exact', head: true })
        .eq('room_id', room.id)
      
      return {
        ...room,
        member_count: count || 0
      }
    }))

    return { success: true, data: roomsWithDetails }
  } catch (err) {
    console.error('[StudyRoomSync] 获取我的自习室异常:', err)
    return { success: false, error: err.message }
  }
}

module.exports = {
  init,
  setCurrentUser,
  getActiveRooms,
  getMyRooms,
  getRoomById,
  createRoom,
  joinRoom,
  leaveRoom,
  deleteRoom,
  uploadFocusSession,
  uploadTodayStats,
  getTodayRanking,
  getRoomMembers,
  subscribeRoomUpdates,
  unsubscribeAll,
  updateOnlineStatus
}
