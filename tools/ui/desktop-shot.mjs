#!/usr/bin/env node
/**
 * UI 取证 · Tauri 桌面端**真窗口**截图
 *
 * 与 shot.mjs 的区别：
 *   shot.mjs 截的是"浏览器里跑的前端"（含 IPC mock，快、可编排、可查任意状态）；
 *   本脚本截的是**真实 Tauri 进程的窗口**（真 WebView2、真 Rust 后端、真数据），
 *   用来确认"浏览器里的效果"和"真机上一致"。
 *
 * 实现：调用同目录的 capture-window.ps1（Win32 PrintWindow，DPI 感知）。
 *   PrintWindow 对 WebView2 需要 PW_RENDERFULLCONTENT（flag=2）才能抓到内容，
 *   脚本会依次尝试 flag=2 与 flag=0 并各存一张。
 *
 * 用法：
 *   npm run ui:desktop                     # 抓 pomo-solo 主窗口
 *   npm run ui:desktop -- --title 菜园子    # 抓标题含"菜园子"的窗口
 *   npm run ui:desktop -- --process pomo-solo --label after-fix
 *   npm run ui:desktop -- --list           # 只列出候选窗口
 *
 * 前置：应用必须在运行（npm run tauri:dev / 或已安装版 pomo-solo.exe）。
 * 产物：temp-debug/ui-shots/<时间戳>-desktop-window/
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRunDir } from "./lib/shots.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PS1 = join(HERE, "capture-window.ps1");

function parseArgs(argv) {
  const a = { process: "pomo-solo", title: null, label: "desktop-window", out: null, list: false, flags: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    switch (k) {
      case "--process": a.process = next(); break;
      case "--title": a.title = next(); break;
      case "--label": a.label = next(); break;
      case "--out": a.out = next(); break;
      case "--flags": a.flags = next(); break;
      case "--list": a.list = true; break;
      case "-h": case "--help": a.help = true; break;
      default: if (k.startsWith("--")) throw new Error(`未知参数 ${k}`);
    }
  }
  return a;
}

const HELP = `
Tauri 桌面端真窗口截图（Win32 PrintWindow）

  npm run ui:desktop -- [选项]

  --process <名>    进程名（默认 pomo-solo，不带 .exe）
  --title <子串>    只抓标题含该子串的窗口（如 "菜园子"）
  --label <名>      产物目录标签
  --flags <n>       只试某个 PrintWindow flag（2=PW_RENDERFULLCONTENT，0=兼容模式）
  --list            只列出当前可见窗口，不截图

前置：应用要在运行。没有窗口时本脚本会明确报错并给出启动建议。
`;

function listWindows(procName) {
  const cmd = `
$ErrorActionPreference='Stop'
Add-Type @"
using System;using System.Text;using System.Runtime.InteropServices;using System.Collections.Generic;
public class W {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  public static List<string> Find(string procName) {
    var outp = new List<string>();
    var pids = new HashSet<uint>();
    foreach (var p in System.Diagnostics.Process.GetProcessesByName(procName)) pids.Add((uint)p.Id);
    EnumWindows((h, p) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (!pids.Contains(pid)) return true;
      var t = new StringBuilder(512); GetWindowTextW(h, t, 512);
      var c = new StringBuilder(256); GetClassNameW(h, c, 256);
      outp.Add(h.ToInt64() + "|" + (IsWindowVisible(h) ? "1" : "0") + "|" + c.ToString() + "|" + t.ToString());
      return true;
    }, IntPtr.Zero);
    return outp;
  }
}
"@
$rows = [W]::Find('${procName}')
if ($rows.Count -eq 0) { Write-Output 'NONE' } else { $rows | ForEach-Object { Write-Output $_ } }
`;
  const r = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", cmd], { encoding: "utf8" });
  if (r.status !== 0) return { error: (r.stderr || "").trim() || `pwsh 退出码 ${r.status}` };
  const out = (r.stdout || "").trim();
  if (out === "NONE" || !out) return { windows: [] };
  return {
    windows: out.split(/\r?\n/).filter(Boolean).map((line) => {
      const [hwnd, visible, cls, ...title] = line.split("|");
      return { hwnd, visible: visible === "1", cls, title: title.join("|") };
    }),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return; }

  if (!existsSync(PS1)) throw new Error(`找不到 ${PS1}`);

  // 先探测窗口，好给出有用的报错
  const probe = listWindows(args.process);
  if (probe.error) throw new Error(`探测窗口失败：${probe.error}`);

  if (args.list) {
    if (!probe.windows.length) {
      console.log(`进程 "${args.process}" 没有窗口。应用没在运行？`);
      return;
    }
    console.log(`进程 "${args.process}" 的窗口：\n`);
    for (const w of probe.windows) {
      console.log(`  hwnd=${w.hwnd} 可见=${w.visible ? "是" : "否"} class=${w.cls}`);
      console.log(`      标题：${w.title || "(无)"}`);
    }
    return;
  }

  const visible = probe.windows.filter((w) => w.visible && w.title);
  if (!visible.length) {
    const anyWin = probe.windows.length;
    throw new Error(
      `找不到可截图的窗口（进程 "${args.process}"，共 ${anyWin} 个窗口）。\n` +
      `  · 应用没在运行？开发模式启动：npm run tauri:dev\n` +
      `  · 或直接跑 release exe：.\\src-tauri\\target\\release\\pomo-solo.exe\n` +
      `  · 想看有哪些窗口：npm run ui:desktop -- --list\n` +
      `  · 进程名不对？用 --process <名> 指定（不带 .exe）`,
    );
  }

  if (args.title) {
    const hit = visible.find((w) => w.title.includes(args.title));
    if (!hit) {
      throw new Error(
        `没有标题含 "${args.title}" 的窗口。现有：\n` +
        visible.map((w) => `  · ${w.title}`).join("\n"),
      );
    }
  }

  const run = createRunDir({ label: args.label, out: args.out });
  const psArgs = ["-NoProfile", "-NonInteractive", "-File", PS1,
    "-ProcessName", args.process, "-OutDir", run.dir];
  if (args.title) psArgs.push("-TitleMatch", args.title);
  if (args.flags != null) psArgs.push("-Flags", String(args.flags));

  console.log(`▸ 抓取进程 "${args.process}"${args.title ? ` 标题含 "${args.title}"` : ""} 的窗口…`);
  const r = spawnSync("pwsh", psArgs, { encoding: "utf8" });
  const stdout = (r.stdout || "").trim();
  if (stdout) console.log(stdout);
  if (r.stderr?.trim()) console.error(r.stderr.trim());
  if (r.status !== 0) throw new Error(`capture-window.ps1 退出码 ${r.status}`);

  // 汇总产物
  const pngs = existsSync(run.dir)
    ? readdirSync(run.dir).filter((f) => f.toLowerCase().endsWith(".png"))
    : [];
  if (!pngs.length) throw new Error(`脚本没产出 PNG。目录：${run.dir}`);

  const rows = pngs.map((f) => {
    const st = statSync(join(run.dir, f));
    return `| [${f}](${f}) | ${(st.size / 1024).toFixed(1)} KB |`;
  });
  const index = [
    `# UI 取证 · 桌面端真窗口`,
    ``,
    `- 生成时间：${new Date().toLocaleString("zh-CN")}`,
    `- 进程：\`${args.process}\`${args.title ? `（标题含 \`${args.title}\`）` : ""}`,
    `- 产物目录：\`${run.rel}\`　共 **${pngs.length}** 张`,
    ``,
    `> 这是**真实 Tauri 进程**的窗口（真 WebView2 + 真 Rust 后端 + 真数据），`,
    `> 与 \`shot.mjs\`（浏览器 + IPC mock）互为对照。两者不一致时以本结果为准。`,
    ``,
    `| 文件 | 体积 |`,
    `|------|------|`,
    ...rows,
    ``,
    `---`,
    ``,
    `*由 \`tools/ui/desktop-shot.mjs\` 生成。*`,
  ].join("\n");
  writeFileSync(join(run.dir, "index.md"), index, "utf8");

  console.log(`\n✅ 完成 ${pngs.length} 张 → ${run.rel}`);
  console.log(`   清单：${run.rel}/index.md`);
}

try { main(); }
catch (e) { console.error(`\n✗ ${e.message}\n`); process.exit(1); }
