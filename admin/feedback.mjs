/**
 * 反馈管理 CLI 工具
 * 用法: node admin/feedback.mjs [--all] [--status 0|1|2|3]
 */
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://sjexeynibnfqxvwehnxk.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_NtzlEhTWwC4qpSY0DEvQ0Q_ER6yJoTz'

const STATUS_LABELS = ['已收到', '已采纳(待更新)', '已采纳(已更新)', '已拒绝']

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

  const statusFilter = process.argv.includes('--status')
    ? parseInt(process.argv[process.argv.indexOf('--status') + 1])
    : null

  let query = supabase.from('feedback').select('*').order('create_time', { ascending: false }).limit(100)
  if (statusFilter !== null && !isNaN(statusFilter)) {
    query = query.eq('feedback_status', statusFilter)
  }

  const { data, error } = await query
  if (error) { console.error('查询失败:', error.message); process.exit(1) }
  if (!data?.length) { console.log('暂无反馈'); return }

  // 获取用户名
  const userIds = [...new Set(data.map(f => f.user_id))]
  const { data: users } = await supabase.from('users').select('id,username').in('id', userIds)
  const userMap = {}
  if (users) users.forEach(u => { userMap[u.id] = u.username || `#${u.id}` })

  console.log(`\n共 ${data.length} 条反馈\n`)

  for (const f of data) {
    const status = f.feedback_status ?? 0
    const emoji = ['🆕', '⏳', '✅', '❌'][status] || '🆕'
    const time = f.create_time ? new Date(f.create_time).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '?'
    const user = userMap[f.user_id] || '?'

    console.log(`#${f.id}  ${emoji} ${STATUS_LABELS[status]}  ${time}  @${user}`)
    console.log(`   ${f.feedback_content}`)
    if (f.remark) console.log(`   └─ 备注: ${f.remark}`)
    console.log()
  }
}

main()
