#!/usr/bin/env node
/**
 * UI 取证 · 驱动**真实 Tauri 桌面窗口**（点击 + 截图 + 校验 + 审计）
 *
 * 与 shot.mjs / desktop-shot.mjs 的分工：
 *   shot.mjs         在**浏览器**里跑前端（含 IPC mock）→ 快、可摆任意状态
 *   desktop-shot.mjs 只截**真实窗口**的图 → 看真机长什么样
 *   desktop-drive.mjs（本脚本）**用代码点击真实窗口**，并校验点击真的生效 → 端到端功能核对
 *
 * ── 为什么不用 CDP 驱动 WebView2 ──────────────────────────────────────
 * 实测：Tauri v2 会**程序化注入** WebView2 的 additionalBrowserArgs，从而覆盖
 * `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 环境变量 → 调试端口不开放
 * （`--remote-debugging-port=9333` 探测失败）。要开 CDP 必须改
 * `tauri.conf.json` 的 `additionalBrowserArgs` 并**重新编译**。
 *
 * 所以改用 **UI Automation**：无需改动应用、无需重编译，而且拿到的是
 * 真实屏幕坐标与真实热区尺寸（还能与 Web 端审计互相印证）。
 *
 * ── 两种点击方式（重要区别）─────────────────────────────────────────
 *   默认：UIA InvokePattern / LegacyIAccessible / SelectionItem
 *         → **不动鼠标光标**，但会**绕过命中测试**（直接调 handler）
 *         → 能证明"功能逻辑通"，**不能**证明"用户点得到"
 *   --allow-sendinput：Win32 SendInput 在元素中心点真鼠标
 *         → 走**真实输入管线**，能测出"被浮层盖住/热区太小点不到"
 *         → 但会移动你的鼠标光标
 *
 * 两种都做一遍才完整：InvokePattern 通 + SendInput 也通 = 功能与可用性都 OK。
 *
 * 用法：
 *   npm run ui:drive -- --recipe desktop-quick      # 快速巡检（推荐先跑这个）
 *   npm run ui:drive -- --recipe desktop-panels     # 各面板逐个点开校验
 *   npm run ui:drive -- --click "⚙️" --name settings  # 点单个元素
 *   npm run ui:drive -- --recipe desktop-quick --allow-sendinput  # 真鼠标模式
 *   npm run ui:drive -- --no-launch                 # 附着到已在跑的应用
 *   npm run ui:drive -- --list-recipes
 *
 * 前置：默认自动起 dev server 并启动 debug exe（它指向 localhost:18421）。
 * 产物：temp-debug/ui-shots/<时间戳>-drive-<标签>/（PNG + index.md + manifest.json）
 */
import { spawnSync } from "node:child_process";
import { openSync, mkdirSync, writeFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createRunDir, slug } from "./lib/shots.mjs";
import { ensureServer, isPortOpen } from "./lib/servers.mjs";
import { DRIVE_RECIPES, listDriveRecipes } from "./lib/recipes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const UIA_PS1 = join(HERE, "lib", "uia.ps1");
const CAPTURE_PS1 = join(HERE, "capture-window.ps1");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ─────────────── UIA 调用 ─────────────── */

function uia(args) {
  const r = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", UIA_PS1, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  const out = (r.stdout || "").trim();
  if (!out) {
    return { ok: false, error: `uia.ps1 无输出（退出码 ${r.status}）：${(r.stderr || "").slice(0, 500)}` };
  }
  try {
    return JSON.parse(out);
  } catch {
    return { ok: false, error: `uia.ps1 输出不是 JSON：${out.slice(0, 500)}` };
  }
}

function captureWindow(procName, outDir, titleMatch) {
  mkdirSync(outDir, { recursive: true });
  const args = ["-NoProfile", "-NonInteractive", "-File", CAPTURE_PS1,
    "-ProcessName", procName, "-OutDir", outDir];
  if (titleMatch) args.push("-TitleMatch", titleMatch);
  const r = spawnSync("pwsh", args, { encoding: "utf8", windowsHide: true });
  return { ok: r.status === 0, stdout: (r.stdout || "").trim(), stderr: (r.stderr || "").trim() };
}

/* ─────────────── CLI ─────────────── */

function parseArgs(argv) {
  const a = {
    label: "drive", out: null, recipe: null, clicks: [], name: null,
    proc: "pomo-solo", title: "PomoSolo", exe: null, launch: true, server: true,
    allowSendInput: false, audit: true, minTargetCss: 24, keepOpen: false,
    listRecipes: false, json: false, expectTimeout: 4000,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]; const next = () => argv[++i];
    switch (k) {
      case "--label": a.label = next(); break;
      case "--out": a.out = next(); break;
      case "--recipe": a.recipe = next(); break;
      case "--click": a.clicks.push(next()); break;
      case "--name": a.name = next(); break;
      case "--process": a.proc = next(); break;
      case "--title": a.title = next(); break;
      case "--exe": a.exe = next(); break;
      case "--no-launch": a.launch = false; break;
      case "--no-server": a.server = false; break;
      case "--allow-sendinput": a.allowSendInput = true; break;
      case "--no-audit": a.audit = false; break;
      case "--min-target-css": a.minTargetCss = Number(next()); break;
      case "--keep-open": a.keepOpen = true; break;
      case "--list-recipes": a.listRecipes = true; break;
      case "--json": a.json = true; break;
      case "-h": case "--help": a.help = true; break;
      default: if (k.startsWith("--")) throw new Error(`未知参数 ${k}（--help 看用法）`);
    }
  }
  return a;
}

const HELP = `
驱动真实 Tauri 桌面窗口：点击 + 截图 + 校验 + 审计（UI Automation）

  npm run ui:drive -- [选项]

配方（--list-recipes 看全部）：
  --recipe desktop-quick     主界面 + 设置面板 + 主题切换（推荐先跑）
  --recipe desktop-panels    各面板逐个点开并校验
  --recipe desktop-plain     只截主界面

自定义：
  --click <UIA名称>          点击该名称的元素（可重复，如 "⚙️"、"开始"）
  --name <标签>              本轮标签

点击方式：
  （默认）UIA Invoke/Legacy/Selection —— 不动光标，但绕过命中测试
  --allow-sendinput          回退 Win32 真鼠标 —— 走真实输入管线，能测遮挡，但会移动光标

运行方式：
  --no-launch                附着到已在运行的应用（不自己启动）
  --no-server                不起 dev server（假定已在跑）
  --exe <路径>               指定 exe（默认 src-tauri/target/debug/pomo-solo.exe）
  --process <名> / --title <子串>   定位窗口（默认 pomo-solo / PomoSolo）

诊断：
  --no-audit                 跳过真实点击热区审计
  --min-target-css <px>      热区阈值（默认 24）
                             24 = 桌面指针目标下限（WCAG 2.5.8）
                             44 = 触摸目标（WCAG 2.5.5 / 本项目 PWA 规矩，用于手机）
                             ⚠️ 对 520×560 桌面窗口用 44 会把 39×39 的正常图标全报成问题
  --keep-open                驱动完不关应用

产物：temp-debug/ui-shots/<时间戳>-drive-<标签>/
  ├─ *.png           每步一张真窗口截图（Win32 PrintWindow）
  ├─ uia-*.json      每步的 UIA 树（可查元素名称与真实坐标）
  ├─ index.md        ★ 步骤表 + 点击校验结果 + 热区审计
  └─ manifest.json
`;

/* ─────────────── 主流程 ─────────────── */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return; }

  if (args.listRecipes) {
    console.log("真实窗口驱动配方（--recipe <名>）：\n");
    for (const r of listDriveRecipes()) {
      console.log(`  ${r.name}  —  ${r.label}`);
      for (const s of r.steps) console.log(`      ${s}`);
    }
    return;
  }

  if (!existsSync(UIA_PS1)) throw new Error(`缺少 ${UIA_PS1}`);

  /* 1) 组装步骤 */
  let steps;
  let recipeLabel = null;
  if (args.recipe) {
    const r = DRIVE_RECIPES[args.recipe];
    if (!r) throw new Error(`未知配方 "${args.recipe}"。--list-recipes 看全部。`);
    steps = r.steps;
    recipeLabel = args.recipe;
  } else if (args.clicks.length) {
    steps = args.clicks.map((c, i) => ({ name: args.name ?? `${String(i).padStart(2, "0")}-${slug(c)}`, click: { name: c } }));
  } else {
    steps = [{ name: args.name ?? "00-main" }];
  }

  const run = createRunDir({ label: `drive-${args.label}`, out: args.out });
  console.log(`▸ 输出：${run.rel}`);
  console.log(`▸ 步骤：${steps.length} 步${recipeLabel ? `（配方 ${recipeLabel}）` : ""}`);
  console.log(`▸ 点击方式：${args.allowSendInput ? "UIA 优先 + SendInput 真鼠标回退" : "仅 UIA（不动光标，绕过命中测试）"}`);

  /* 2) dev server + 应用 */
  let server = null;
  let app = null;
  try {
    if (args.server && args.launch) {
      process.stdout.write("▸ 准备 dev server … ");
      server = await ensureServer("desktop", { logDir: join(run.dir, "_servers") });
      console.log(server.reused ? "复用已在跑的" : "已启动");
    }

    if (args.launch) {
      const exe = args.exe ?? join(process.cwd(), "src-tauri", "target", "debug", "pomo-solo.exe");
      if (!existsSync(exe)) {
        throw new Error(
          `找不到 exe：${exe}\n` +
          `  · 先构建：cd src-tauri && cargo build\n` +
          `  · 或直接开发模式：npm run tauri:dev（然后用 --no-launch 附着）`,
        );
      }
      console.log(`▸ 启动应用：${basename(exe)}（不抢焦点）`);
      /*
       * 用 launch-app.ps1 而不是 spawn：
       *   spawn/Start-Process 会按 SW_SHOWNORMAL 创建窗口 → **激活**新窗口，
       *   把用户正在用的前台窗口挤到后台。UI 取证工具每次跑都打断用户工作，
       *   体验很差。
       * launch-app.ps1 用 CreateProcess + SW_SHOWNOACTIVATE(4) 让窗口
       *   **可见但不激活**（可见是必需的：最小化/隐藏时 WebView2 不渲染，
       *   PrintWindow 抓空白、无障碍树退化），并在启动后把焦点还给原窗口。
       *
       * ⚠️ 这里必须用 `stdio: "ignore"`，**不能用管道**（encoding/pipes）：
       *   为了让子进程拿到 NUL 标准句柄，launch-app.ps1 里 CreateProcess 要以
       *   bInheritHandles=true 调用 —— 那会连带继承 pwsh **所有**可继承句柄，
       *   其中包括 Node 给 stdout 的管道（Node 特意把它标记为可继承）。
       *   结果是：pwsh 早就退出，但**应用一直持着管道写端**，管道永不 EOF，
       *   spawnSync 就永远等下去（实测卡死 10 分钟以上）。
       *   stdio:"ignore" 让 pwsh 根本没有管道可继承，问题从根上消失。
       *   代价是拿不到 pid 输出 —— 但清理走 taskkill /IM，本来就不需要 pid。
       */
      const launchScript = join(HERE, "lib", "launch-app.ps1");
      const launched = spawnSync(
        "pwsh",
        ["-NoProfile", "-NonInteractive", "-File", launchScript, "-Exe", exe],
        { stdio: "ignore", timeout: 30000 },
      );
      if (launched.error?.code === "ETIMEDOUT") {
        throw new Error("启动应用超时（30s 未返回）。检查 launch-app.ps1 / 是否有残留进程。");
      }
      if (launched.status !== 0) {
        throw new Error(`启动失败（退出码 ${launched.status}）。用 pwsh -File tools/ui/lib/launch-app.ps1 -Exe <exe> 手工复现看报错。`);
      }
      // 清理阶段按进程名 taskkill，不需要 pid；这里只标记"应用由本次运行启动"
      app = { launched: true, exe };
      await sleep(9000);   // 等窗口出现 + 前端加载 + 加载遮罩消失
    } else {
      console.log("▸ --no-launch：附着到已在运行的应用");
    }

    /* 3) 确认窗口可被 UIA 看到 */
    let info = uia(["-Action", "list", "-ProcessName", args.proc, "-TitleMatch", args.title]);
    if (!info.ok) {
      throw new Error(
        `找不到可驱动的窗口：${info.error}\n` +
        `  · 应用没在跑？去掉 --no-launch 让本脚本启动它\n` +
        `  · 进程名/标题不对？--process <名> --title <子串>`,
      );
    }
    console.log(`▸ 窗口：hwnd=${info.hwnd} 标题="${info.title}" DPI=${info.dpi}（${info.dpiScale}x）`);
    console.log(`   UIA 首遍 ${info.firstPass} 节点 → WebView2 无障碍树需唤醒，脚本已内置双次遍历`);

    /* 4) 真实点击热区审计 */
    let audit = null;
    if (args.audit) {
      process.stdout.write("▸ 真实点击热区审计 … ");
      const a = uia(["-Action", "audit", "-ProcessName", args.proc, "-TitleMatch", args.title,
        "-MinTargetCss", String(args.minTargetCss)]);
      if (a.ok) {
        audit = a;
        console.log(`${a.findings.length} 条问题（节点 ${a.nodeCount}）`);
      } else {
        console.log(`跳过（${a.error}）`);
      }
    }

    /* 5) 逐步执行 */
    const entries = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const idx = String(i).padStart(2, "0");
      const t0 = Date.now();
      const record = { name: step.name, note: step.note ?? null, click: null, clicks: [], shot: null, uiaDump: null, expect: step.expect ?? null, expectGone: step.expectGone ?? null, expectHits: [], goneHits: [], verified: null, notes: [] };

      // 5a) 点击前的元素名称集合（用于"从无到有"/"从有到无"校验）
      let namesBefore = new Set();
      if ((step.expect?.length || step.expectGone?.length) && (step.click || step.clicks?.length)) {
        const b = uia(["-Action", "dump", "-ProcessName", args.proc, "-TitleMatch", args.title, "-MaxNodes", "500"]);
        if (b.ok) namesBefore = new Set((b.nodes || []).map((n) => n.name).filter(Boolean));
      }

      // 5b) 点击（支持一步多点：step.clicks 数组按顺序执行；step.click 为单个的简写）
      const clickList = step.clicks?.length ? step.clicks : (step.click ? [step.click] : []);
      for (let ci = 0; ci < clickList.length; ci++) {
        const spec = clickList[ci];
        const cliArgs = ["-Action", "click", "-ProcessName", args.proc, "-TitleMatch", args.title];
        if (spec.name) cliArgs.push("-Name", spec.name);
        if (spec.nameContains) cliArgs.push("-NameContains", spec.nameContains);
        if (spec.controlType) cliArgs.push("-ControlType", spec.controlType);
        if (spec.classNameContains) cliArgs.push("-ClassNameContains", spec.classNameContains);
        if (spec.classNameNotContains) cliArgs.push("-ClassNameNotContains", spec.classNameNotContains);
        if (spec.helpTextContains) cliArgs.push("-HelpTextContains", spec.helpTextContains);
        if (spec.index != null) cliArgs.push("-Index", String(spec.index));
        if (args.allowSendInput) cliArgs.push("-AllowSendInput");

        const res = uia(cliArgs);
        record.clicks.push(res);
        if (ci === 0) record.click = res;   // 首点作为"主点击"记入清单
        if (!res.ok) {
          const msg = `点击「${spec.name ?? spec.nameContains}」失败：${res.error}`;
          if (step.optional) { record.notes.push(`（可选步骤，忽略）${msg}`); }
          else { record.notes.push(`❌ ${msg}`); console.log(`  ❌ [${idx}] ${step.name} — ${msg}`); }
          break;   // 前一步没点成，后面的坐标前提已不成立
        }
        const seq = clickList.length > 1 ? `（${ci + 1}/${clickList.length}）` : "";
        console.log(`  ✓ [${idx}] ${step.name}${seq} — 点「${res.element.name}」(${res.method}) @ ${res.clickAt.x},${res.clickAt.y}`);
        await sleep(450);
      }
      if (record.click?.ok) await sleep(400);

      // 5c) 校验：expect 应"从无到有"，expectGone 应"从有到无"
      const needExpect = step.expect?.length > 0;
      const needGone = step.expectGone?.length > 0;
      if ((needExpect || needGone) && record.click?.ok) {
        const deadline = Date.now() + args.expectTimeout;
        let hits = [], gone = [];
        while (Date.now() < deadline) {
          const d = uia(["-Action", "dump", "-ProcessName", args.proc, "-TitleMatch", args.title, "-MaxNodes", "500"]);
          const now = new Set((d.nodes || []).map((n) => n.name).filter(Boolean));
          hits = needExpect ? step.expect.filter((m) => now.has(m) && !namesBefore.has(m)) : [];
          gone = needGone ? step.expectGone.filter((m) => !now.has(m) && namesBefore.has(m)) : [];
          const okHits = !needExpect || hits.length === step.expect.length;
          const okGone = !needGone || gone.length === step.expectGone.length;
          if (okHits && okGone) break;
          await sleep(500);
        }
        record.expectHits = hits;
        record.goneHits = gone;
        const okHits = !needExpect || hits.length === step.expect.length;
        const okGone = !needGone || gone.length === step.expectGone.length;
        record.verified = okHits && okGone;
        if (!okHits) record.notes.push(`⚠️ 期望出现但未命中 ${hits.length}/${step.expect.length}：${step.expect.join(", ")}`);
        if (!okGone) record.notes.push(`⚠️ 期望消失但仍在 ${gone.length}/${step.expectGone.length}：${step.expectGone.join(", ")}`);
      }

      // 5d) 截图（真窗口）
      const shotDir = join(run.dir, `${idx}-${slug(step.name)}`);
      const cap = captureWindow(args.proc, shotDir, args.title);
      const pngs = existsSync(shotDir) ? readdirSync(shotDir).filter((f) => f.endsWith(".png")) : [];
      record.shot = pngs.length ? `${run.rel}/${idx}-${slug(step.name)}/${pngs[0]}` : null;
      record.shotAll = pngs.map((f) => `${run.rel}/${idx}-${slug(step.name)}/${f}`);
      if (!cap.ok) record.notes.push(`截图失败：${cap.stderr.slice(0, 200)}`);

      // 5e) 保存该步的 UIA 树（便于事后查元素名称与真实坐标）
      const d = uia(["-Action", "dump", "-ProcessName", args.proc, "-TitleMatch", args.title, "-MaxNodes", "600"]);
      if (d.ok) {
        const p = join(run.dir, `${idx}-${slug(step.name)}-uia.json`);
        writeFileSync(p, JSON.stringify({ hwnd: d.hwnd, dpi: d.dpi, dpiScale: d.dpiScale, nodeCount: d.nodeCount, nodes: d.nodes }, null, 2), "utf8");
        record.uiaDump = `${run.rel}/${basename(p)}`;
        record.uiaNodeCount = d.nodeCount;
      }

      record.ms = Date.now() - t0;
      entries.push(record);

      const flag = record.notes.some((n) => n.startsWith("❌")) ? "❌"
        : (record.verified === false || record.notes.length ? "⚠️" : "✓");
      if (!clickList.length) console.log(`  ${flag} [${idx}] ${step.name} — 仅截图（${record.ms}ms）`);
      else if (record.verified) {
        const detail = record.expect?.length ? `出现 ${record.expectHits.join(", ")}`
          : (record.expectGone?.length ? `消失 ${record.goneHits.join(", ")}` : "（无断言）");
        console.log(`     → 校验通过：${detail}`);
      } else if (record.verified === false) {
        console.log(`     → ⚠️ 校验未通过（见清单）`);
      }
    }

    /* 6) 写清单 */
    writeManifest(run, { args, info, audit, entries, recipeLabel });

    if (args.json) {
      console.log(JSON.stringify({ run: run.rel, entries, audit: audit?.findings ?? [] }, null, 2));
    } else {
      const bad = entries.filter((e) => e.notes.some((n) => n.startsWith("❌")) || e.verified === false);
      console.log("");
      console.log(`✅ 完成 ${entries.length} 步 → ${run.rel}`);
      console.log(`   清单（先读这个）：${run.rel}/index.md`);
      if (bad.length) console.log(`   ⚠️ ${bad.length} 步有问题，详情见清单`);
      else console.log("   所有点击均生效");
      if (audit?.findings?.length) {
        console.log("");
        console.log(`   🔍 真实点击热区审计：${audit.findings.length} 条（阈值 ${args.minTargetCss} css px）`);
        for (const f of audit.findings.slice(0, 8)) {
          console.log(`      · ${f.selector}  ${f.value}`);
        }
        if (audit.findings.length > 8) console.log(`      … 其余 ${audit.findings.length - 8} 条见清单`);
      }
    }
  } finally {
    if (!args.keepOpen) {
      if (app) {
        spawnSync("taskkill", ["/IM", `${args.proc}.exe`, "/F"], { stdio: "ignore", windowsHide: true });
      }
      server?.stop();
    } else {
      console.log("\n--keep-open：应用与 dev server 保持运行。");
    }
  }
}

/* ─────────────── 清单渲染 ─────────────── */

function writeManifest(run, { args, info, audit, entries, recipeLabel }) {
  const L = [];
  L.push(`# UI 取证 · 真实 Tauri 窗口驱动 · ${args.label}`);
  L.push("");
  L.push(`- 生成时间：${new Date().toLocaleString("zh-CN")}`);
  L.push(`- 窗口：hwnd=${info.hwnd} 标题="${info.title}" **DPI ${info.dpi}（${info.dpiScale}x）**`);
  L.push(`- 驱动方式：UI Automation（Tauri v2 覆盖了 WebView2 的调试端口环境变量，CDP 不可用）`);
  L.push(`- 点击方式：${args.allowSendInput ? "UIA 优先 + SendInput 真鼠标回退" : "仅 UIA（不动光标，绕过命中测试）"}`);
  if (recipeLabel) L.push(`- 配方：\`${recipeLabel}\``);
  L.push(`- 产物目录：\`${run.rel}\`　共 **${entries.length}** 步`);
  L.push("");
  L.push("> 这是**真实 Tauri 进程**：真 WebView2 + 真 Rust 后端 + 真数据。");
  L.push("> 截图用 Win32 PrintWindow，点击走 UIA —— 与浏览器侧的 `shot.mjs` 互为对照。");
  L.push("");

  L.push("## 步骤与点击校验");
  L.push("");
  L.push("| # | 步骤 | 点击元素 | 方式 | 点击生效 | 文案校验 | UIA 节点 | 截图 |");
  L.push("|---|------|---------|------|---------|------------|---------|------|");
  entries.forEach((e, i) => {
    const el = e.click?.ok ? `${e.click.element.type}「${e.click.element.name}」` : (e.click ? "（失败）" : "—");
    const method = e.click?.ok ? e.click.method : "—";
    const verified = e.verified === null ? "—" : (e.verified ? "✅ 是" : "❌ 否");
    const hits = e.expect?.length ? `${e.expectHits.length}/${e.expect.length}` : (e.expectGone?.length ? `消失 ${e.goneHits.length}/${e.expectGone.length}` : "—");
    const shot = e.shot ? `[png](${e.shot.replace(`${run.rel}/`, "")})` : "—";
    L.push(`| ${i + 1} | ${e.name} | ${el} | ${method} | ${verified} | ${hits} | ${e.uiaNodeCount ?? "—"} | ${shot} |`);
  });
  L.push("");
  L.push("> **「点击生效」怎么判的**：点击前记录全部 UIA 元素名称，点击后要求");
  L.push("> `expect` 里的文案**从无到有**出现（最多重试 4s）。这比「没报错就算成功」可靠得多 ——");
  L.push("> 早期版本就是因为判据写错，把「点击失败」误判成了「生效」。");
  L.push("");
  const noted = entries.filter((e) => e.note);
  if (noted.length) {
    L.push("**步骤说明**");
    L.push("");
    for (const e of noted) L.push(`- **${e.name}**：${e.note}`);
    L.push("");
  }

  const withNotes = entries.filter((e) => e.notes.length);
  if (withNotes.length) {
    L.push("## 步骤问题");
    L.push("");
    for (const e of withNotes) {
      L.push(`### ${e.name}`);
      L.push("");
      for (const n of e.notes) L.push(`- ${n}`);
      L.push("");
    }
  }

  if (audit?.ok) {
    L.push(`## 真实点击热区审计（阈值 ${audit.minTargetCss} css px）`);
    L.push("");
    L.push(`- 窗口 DPI：${audit.dpi}（${audit.dpiScale}x）→ 物理像素 ÷ ${audit.dpiScale} = CSS 像素`);
    L.push(`- 树节点数：${audit.nodeCount}`);
    L.push("");
    if (audit.findings?.length) {
      L.push("| 类型 | 元素（UIA 名称） | 实测尺寸 | 说明 |");
      L.push("|------|-----------------|---------|------|");
      for (const f of audit.findings) {
        L.push(`| \`${f.kind}\` | \`${f.selector}\` | ${f.value} | ${f.detail} |`);
      }
      L.push("");
      L.push("> 这些是**真实窗口**里量出来的热区，不是从 CSS 推断的。");
      L.push("> 可与 Web 端 `shot.mjs` 的 `tiny-target` 交叉核对（同一元素应成比例一致）。");
    } else {
      L.push("✅ 未发现过小的点击热区。");
    }
    L.push("");
  }

  L.push("## 每步的 UIA 树");
  L.push("");
  L.push("每步都存了 `*-uia.json`，含**元素名称、真实屏幕坐标、尺寸、支持的 UIA 模式**。");
  L.push("用途：想知道某个按钮叫什么名字、真实热区多大、能不能 Invoke，直接查它，不用靠猜。");
  L.push("");
  for (const e of entries) {
    if (e.uiaDump) L.push(`- ${e.name} → [${basename(e.uiaDump)}](${basename(e.uiaDump)})（${e.uiaNodeCount} 节点）`);
  }
  L.push("");
  L.push("---");
  L.push("");
  L.push("*由 `tools/ui/desktop-drive.mjs` 生成。*");
  writeFileSync(join(run.dir, "index.md"), L.join("\n"), "utf8");
  writeFileSync(join(run.dir, "manifest.json"), JSON.stringify({ run: run.rel, args, info, audit, entries }, null, 2), "utf8");
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}\n`);
  process.exit(1);
});
