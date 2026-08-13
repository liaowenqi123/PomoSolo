/**
 * 认证辅助：注册/登录测试用户，返回 user id + access_token。
 * 服务器 REST: POST /api/v1/auth/register | /login
 */
import process from "node:process";

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

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const results = [];
    for (const u of TEST_USERS) {
      const info = await ensureUser(u.username, u.password);
      results.push(info);
      console.log(`user ${info.username} -> id=${info.id} token=${info.token.slice(0, 24)}...`);
    }
  } catch (e) {
    console.error("auth 失败:", e.message);
    process.exit(1);
  }
}
