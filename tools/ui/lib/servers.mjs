/**
 * dev server 生命周期管理（给 UI 取证工具"一条命令出图"用）
 *
 * 关键实现细节：
 *  - **不用管道**捕获子进程输出，改为把 stdout/stderr 重定向到日志文件。
 *    管道在受限沙箱下会 EPERM，而且日志文件更利于事后排查（shell:true → npm.cmd）。
 *  - 关闭时用 `taskkill /T /F` 杀**整棵进程树**（vite 会再 spawn 子进程，只杀父进程会留孤儿）。
 */
import { spawn, spawnSync } from "node:child_process";
import { openSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 预设：name → { cmd, args, port, cwd, label } */
export const SERVERS = {
  desktop: {
    label: "桌面端 dev server (vite)",
    cmd: "npm",
    args: ["run", "dev"],
    port: 18421,
    ready: "/",
  },
  pwa: {
    label: "PWA dev server (vite)",
    cmd: "npm",
    args: ["run", "pwa:dev"],
    port: 5199,
    ready: "/",
  },
  gallery: {
    label: "组件画廊 dev server (vite)",
    cmd: "npm",
    args: ["run", "ui:gallery:dev"],
    port: 5299,
    ready: "/",
  },
};

/** 端口是否已被监听 */
export function isPortOpen(port, host = "127.0.0.1", timeout = 700) {
  return new Promise((resolve) => {
    const sock = createConnection({ port, host });
    const done = (v) => { try { sock.destroy(); } catch { /* ignore */ } resolve(v); };
    sock.setTimeout(timeout);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
  });
}

/**
 * 确保某个 dev server 在跑。已经有人在跑就直接复用（不重复起）。
 * @param {keyof typeof SERVERS} name
 * @param {{ logDir?: string, timeout?: number, reuse?: boolean }} [opts]
 * @returns {Promise<{ name, port, reused: boolean, logPath?: string, stop: () => void }>}
 */
export async function ensureServer(name, opts = {}) {
  const cfg = SERVERS[name];
  if (!cfg) throw new Error(`未知 dev server "${name}"。可用：${Object.keys(SERVERS).join(", ")}`);

  const reuse = opts.reuse !== false;
  if (reuse && await isPortOpen(cfg.port)) {
    return { name, port: cfg.port, reused: true, stop: () => {} };
  }

  const logDir = opts.logDir ?? join(process.cwd(), "temp-debug", "ui-shots", "_servers");
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, `${name}.log`);
  const fd = openSync(logPath, "a");

  const child = spawn(cfg.cmd, cfg.args, {
    cwd: process.cwd(),
    stdio: ["ignore", fd, fd],
    shell: true,
    windowsHide: true,
  });

  let exited = null;
  child.on("exit", (code) => { exited = code; });

  const timeout = opts.timeout ?? 90000;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await isPortOpen(cfg.port)) {
      // 端口开了，再稍微等 Vite 完成首轮依赖预构建
      await sleep(400);
      return {
        name, port: cfg.port, reused: false, logPath,
        stop: () => killTree(child),
      };
    }
    if (exited != null) {
      throw new Error(
        `${cfg.label} 启动失败（退出码 ${exited}）。日志尾部：\n${tail(logPath, 25)}`,
      );
    }
    await sleep(300);
  }

  killTree(child);
  throw new Error(`${cfg.label} 启动超时（${timeout}ms）。日志：${logPath}\n${tail(logPath, 25)}`);
}

function killTree(child) {
  if (!child || child.exitCode != null) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      child.kill("SIGKILL");
    }
  } catch { /* ignore */ }
}

function tail(path, n) {
  try {
    if (!existsSync(path)) return "(无日志)";
    const lines = readFileSync(path, "utf8").split(/\r?\n/);
    return lines.slice(-n).join("\n");
  } catch { return "(读日志失败)"; }
}
