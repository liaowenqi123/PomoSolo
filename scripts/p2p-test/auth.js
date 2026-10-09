/**
 * 认证辅助：注册/登录测试用户，返回 user id + access_token。
 * 服务器 REST: POST /api/v1/auth/register | /login
 */
import process from "node:process";
import { pathToFileURL } from "node:url";

const SERVER = process.env.P2P_SERVER ?? "https://api.pomogrow.top";

async function api(path, body) {
  const res = await fetch(`${SERVER}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

/** 注册或登录，返回 { id, username, token } */
export async function ensureUser(username, password) {
  let r = await api("/api/v1/auth/register", { username, password });
  if (r.status === 409) {
    r = await api("/api/v1/auth/login", { username, password });
  }
  if (r.status !== 200 && r.status !== 201) {
    throw new Error(`认证失败(${r.status}): ${JSON.stringify(r.data)}`);
  }
  const { user, access_token } = r.data;
  return { id: user.id, username: user.username, token: access_token };
}

export const TEST_USERS = [
  { username: "p2ptest_a", password: "P2pTestPass123" },
  { username: "p2ptest_b", password: "P2pTestPass123" },
];

/**
 * 生成第 n 个测试账号（n 从 0 开始）。
 * 多客户端扇出测试需要 1 个 DJ + N 个听众，两个账号不够用。
 * 命名固定为 p2ptest_a..p2ptest_z，服务器上首次调用时自动注册。
 */
export function testUser(n) {
  const letter = String.fromCharCode(97 + (n % 26));
  const suffix = n >= 26 ? String(Math.floor(n / 26)) : "";
  return { username: `p2ptest_${letter}${suffix}`, password: "P2pTestPass123" };
}

/** 一次拿到 count 个测试账号 */
export function testUsers(count) {
  return Array.from({ length: count }, (_, i) => testUser(i));
}

/*
 * CLI 模式：`node auth.js [数量]`
 *
 * ⚠️ 原来的守卫 `import.meta.url === \`file://${process.argv[1]}\`` 在 Windows 上
 * **永远不成立**：`process.argv[1]` 是 `D:\...\auth.js`，而 import.meta.url 是
 * `file:///D:/...`（三斜杠 + 正斜杠）。后果是 `node auth.js` **静默什么都不做**
 * 却返回退出码 0 —— 看起来像成功，实际一个账号都没测。
 * 改用 pathToFileURL 规范化比较，跨平台成立。
 */
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  const raw = Number(process.argv[2] ?? TEST_USERS.length);
  const count = Number.isFinite(raw) && raw > 0 ? raw : TEST_USERS.length;
  try {
    for (const u of testUsers(count)) {
      const info = await ensureUser(u.username, u.password);
      console.log(`user ${info.username} -> id=${info.id} token=${info.token.slice(0, 20)}...`);
    }
  } catch (e) {
    console.error("auth 失败:", e.message);
    process.exit(1);
  }
}
