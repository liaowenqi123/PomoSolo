/**
 * Phase0 双端实测编排：
 * - 注册/登录两个测试用户
 * - 并发启动 offerer（发送端）与 answerer（接收端）两个 peer 进程
 * - 汇总 RESULT
 *
 * 本地模式：node run.js --mode local
 * Docker 模式：先 `node run.js --mode prep` 拿 ids/tokens，再按打印的命令起两个容器
 */
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { TEST_USERS, ensureUser } from "./auth.js";

const CWD = fileURLToPath(new URL(".", import.meta.url));
const NODE_BIN = process.execPath; // 当前运行中的 node 绝对路径，保证可执行

const mode = process.argv[2] ?? "--mode=local";
const [a, b] = TEST_USERS;

async function prep() {
  const ra = await ensureUser(a.username, a.password);
  const rb = await ensureUser(b.username, b.password);
  return { ra, rb };
}

if (mode === "--mode=prep") {
  const { ra, rb } = await prep();
  console.log(`P2P_USERNAME_A=${ra.username}`);
  console.log(`P2P_ME_ID_A=${ra.id}`);
  console.log(`P2P_USERNAME_B=${rb.username}`);
  console.log(`P2P_ME_ID_B=${rb.id}`);
  process.exit(0);
}

if (mode === "--mode=local") {
  const { ra, rb } = await prep();
  console.log(`offerer=${ra.username}(${ra.id})  answerer=${rb.username}(${rb.id})`);
  const envA = {
    ...process.env,
    P2P_USERNAME: a.username,
    P2P_PASSWORD: a.password,
    P2P_ME_ID: ra.id,
    P2P_PEER_ID: rb.id,
    P2P_ROLE: "offerer",
  };
  const envB = {
    ...process.env,
    P2P_USERNAME: b.username,
    P2P_PASSWORD: b.password,
    P2P_ME_ID: rb.id,
    P2P_PEER_ID: ra.id,
    P2P_ROLE: "answerer",
  };
  const run = (env, label) =>
    new Promise((resolve) => {
      const child = spawn(NODE_BIN, ["peer.js"], {
        cwd: CWD,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      child.stdout.on("data", (d) => {
        out += d.toString();
        process.stdout.write(`[${label}] ${d}`);
      });
      child.stderr.on("data", (d) => process.stderr.write(`[${label}] ${d}`));
      child.on("close", (code) => resolve({ label, code, out }));
    });
  const results = await Promise.all([run(envA, "offerer"), run(envB, "answerer")]);
  const ok = results.every((r) => r.code === 0);
  console.log(ok ? "\n=== 全部成功 ===" : "\n=== 存在失败 ===");
  process.exit(ok ? 0 : 1);
}

console.error("未知模式，使用 --mode=local 或 --mode=prep");
process.exit(2);
