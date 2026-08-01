#!/usr/bin/env node
/**
 * Supabase → 自建服务器 数据迁移导出脚本
 *
 * 从 Supabase 的 users / feedback / study_rooms 表导出 JSON，
 * 输出到项目根目录 migrate/ 下，供服务器部门导入新数据库。
 *
 * 使用方法：
 *   node scripts/migrate-supabase.mjs
 *
 * 需要环境变量（或 .env 文件）：
 *   SUPABASE_URL       Supabase 项目 URL（https://xxx.supabase.co）
 *   SUPABASE_ANON_KEY  Supabase anon/publishable key
 *
 * 说明：
 * - 密码哈希原样导出（PBKDF2-SHA512 + salt），服务器需支持该格式导入
 *   （或脚本内提供"迁移后统一重置密码"选项，见 --reset-passwords）
 * - 用户 id 为 Supabase 的 BIGINT，新服务器 users.id 是 UUID，
 *   导出时会生成 idMap.json（old_id → new_uuid）供 feedback 等表关联转换
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../migrate");

// ===== 读取环境变量 =====
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const RESET_PASSWORDS = process.argv.includes("--reset-passwords");

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("缺少环境变量 SUPABASE_URL / SUPABASE_ANON_KEY");
  process.exit(1);
}

async function fetchTable(table, query = "") {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=*${query}`;
  const resp = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });
  if (!resp.ok) {
    throw new Error(`读取 ${table} 失败 (${resp.status}): ${await resp.text()}`);
  }
  return resp.json();
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 1. 导出 users
  console.log("导出 users ...");
  const users = await fetchTable("users");
  const idMap = {}; // old_id → new_uuid

  const exportedUsers = users.map((u) => {
    const newId = randomUUID();
    idMap[u.id] = newId;
    return {
      old_id: u.id,
      new_id: newId,
      username: u.username ?? u.email ?? `user_${u.id}`,
      email: u.email ?? null,
      // 密码哈希原样导出（服务器需兼容 PBKDF2-SHA512 格式）
      password_hash: RESET_PASSWORDS ? null : (u.password_hash ?? null),
      salt: RESET_PASSWORDS ? null : (u.salt ?? null),
      nickname: u.nickname ?? null,
      admin: !!u.admin,
      created_at: u.created_at ?? null,
    };
  });

  fs.writeFileSync(
    path.join(OUT_DIR, "users.json"),
    JSON.stringify(exportedUsers, null, 2)
  );
  console.log(`  → ${exportedUsers.length} 个用户`);

  // 2. 导出 feedback
  try {
    console.log("导出 feedback ...");
    const feedbacks = await fetchTable("feedback");
    const exportedFeedbacks = feedbacks.map((f) => ({
      old_id: f.id,
      user_id: f.user_id != null ? idMap[f.user_id] ?? null : null,
      feedback_content: f.feedback_content ?? "",
      feedback_status: f.feedback_status ?? 0,
      remark: f.remark ?? null,
      create_time: f.create_time ?? null,
    }));
    fs.writeFileSync(
      path.join(OUT_DIR, "feedbacks.json"),
      JSON.stringify(exportedFeedbacks, null, 2)
    );
    console.log(`  → ${exportedFeedbacks.length} 条反馈`);
  } catch (e) {
    console.warn(`  ⚠ 反馈表导出失败: ${e.message}`);
  }

  // 3. 导出自习室（供参考）
  try {
    console.log("导出 study_rooms ...");
    const rooms = await fetchTable("study_rooms");
    fs.writeFileSync(
      path.join(OUT_DIR, "study_rooms.json"),
      JSON.stringify(rooms, null, 2)
    );
    console.log(`  → ${rooms.length} 个自习室`);
  } catch (e) {
    console.warn(`  ⚠ 自习室导出失败: ${e.message}`);
  }

  // 4. id 映射表
  fs.writeFileSync(
    path.join(OUT_DIR, "idMap.json"),
    JSON.stringify(idMap, null, 2)
  );
  console.log("  → idMap.json 已生成（旧 id → 新 UUID）");

  console.log(`\n完成！导出文件位于: ${OUT_DIR}`);
  if (RESET_PASSWORDS) {
    console.log("注意：--reset-passwords 已启用，密码字段为空，用户需通过找回密码重新设置。");
  } else {
    console.log("提示：密码哈希以 PBKDF2-SHA512 格式导出，服务器导入时需兼容。");
  }
}

main().catch((e) => {
  console.error("迁移失败:", e);
  process.exit(1);
});
