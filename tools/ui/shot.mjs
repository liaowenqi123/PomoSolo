#!/usr/bin/env node
/**
 * UI 取证 · 网页截图（零依赖 CDP）
 *
 * 用法示例：
 *   # 桌面端真机尺寸（520×560），自动起 vite dev server
 *   npm run ui:shot -- --target desktop
 *
 *   # PWA 断点巡检（自动起 pwa dev server）
 *   npm run ui:shot -- --target pwa
 *
 *   # 任意 URL，指定视口与"点开面板再截"
 *   npm run ui:shot -- --url http://127.0.0.1:18421/ --view 800x600 \
 *       --click ".settings-btn" --wait 300
 *
 *   # 整页 + 只截某个元素
 *   npm run ui:shot -- --target pwa --view mobile --full
 *   npm run ui:shot -- --target desktop --selector ".container"
 *
 *   # 只要诊断不要图（纯审计）
 *   npm run ui:shot -- --target desktop --no-image
 *
 * 产物：temp-debug/ui-shots/<时间戳>-<标签>/（PNG + index.md + manifest.json）
 * 读 index.md 即可知道截了什么、哪里有问题。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { Browser, sleep } from "./lib/cdp.mjs";
import { findBrowser, listBrowsers } from "./lib/browsers.mjs";
import { TARGETS, VIEWPORTS, resolveView } from "./lib/targets.mjs";
import { ensureServer, SERVERS } from "./lib/servers.mjs";
import { createRunDir, writeManifest, slug, SHOT_ROOT } from "./lib/shots.mjs";
import { startProbe, auditLayout } from "./lib/probe.mjs";
import { buildMockInitScript, SCENARIOS } from "./lib/tauri-mock.mjs";
import { RECIPES, listRecipes } from "./lib/recipes.mjs";

/* ─────────────── 参数解析 ─────────────── */

function parseArgs(argv) {
  const a = {
    urls: [], views: [], evals: [], clicks: [], names: [],
    full: false, selector: null, wait: 200, waitFor: null,
    settle: true, settleTimeout: 12000,
    audit: true, image: true, browser: null, dpr: 2, bg: null,
    out: null, label: null, serve: null, keepOpen: false, json: false,
    timeout: 30000, listTargets: false, listBrowsers: false, listViews: false,
    includeErrors: false, tinyTarget: 24, noServer: false,
    mock: false, scenario: null, listScenarios: false, mockQuiet: false,
    recipe: null, listRecipes: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    switch (k) {
      case "--url": a.urls.push(next()); break;
      case "--target": a.target = next(); break;
      case "--view": a.views.push(next()); break;
      case "--eval": a.evals.push(next()); break;
      case "--click": a.clicks.push(next()); break;
      case "--name": a.names.push(next()); break;
      case "--wait-for": a.waitFor = next(); break;
      case "--selector": a.selector = next(); break;
      case "--bg": a.bg = next(); break;
      case "--out": a.out = next(); break;
      case "--label": a.label = next(); break;
      case "--serve": a.serve = next(); break;
      case "--browser": a.browser = next(); break;
      case "--dpr": a.dpr = Number(next()); break;
      case "--wait": a.wait = Number(next()); break;
      case "--no-settle": a.settle = false; break;
      case "--settle-timeout": a.settleTimeout = Number(next()); break;
      case "--timeout": a.timeout = Number(next()); break;
      case "--tiny-target": a.tinyTarget = Number(next()); break;
      case "--full": a.full = true; break;
      case "--no-audit": a.audit = false; break;
      case "--no-image": a.image = false; break;
      case "--no-server": a.noServer = true; break;
      case "--mock": a.mock = true; break;
      case "--no-mock": a.mock = false; a.noMock = true; break;
      case "--scenario": a.scenario = next(); a.mock = true; break;
      case "--mock-quiet": a.mockQuiet = true; break;
      case "--list-scenarios": a.listScenarios = true; break;
      case "--recipe": a.recipe = next(); break;
      case "--list-recipes": a.listRecipes = true; break;
      case "--errors-only": a.includeErrors = true; break;
      case "--keep-open": a.keepOpen = true; break;
      case "--json": a.json = true; break;
      case "--list-targets": a.listTargets = true; break;
      case "--list-browsers": a.listBrowsers = true; break;
      case "--list-views": a.listViews = true; break;
      case "-h": case "--help": a.help = true; break;
      default:
        if (k.startsWith("--")) throw new Error(`未知参数 ${k}（--help 看用法）`);
        a.urls.push(k);
    }
  }
  return a;
}

const HELP = `
UI 取证 · 网页截图（零依赖 CDP，不下载浏览器、不新增依赖）

用法：
  npm run ui:shot -- [选项]

目标（三选一）：
  --target <名>          内置目标预设（--list-targets 看全部）
  --url <地址>           任意 URL（可重复，逐个截）
  --recipe <名>          ★ 截图配方：一次把一组真实界面状态全截下来（--list-recipes 看全部）
  --serve <名>           强制起某个 dev server（desktop|pwa|gallery）

视口：
  --view <名|WxH>        预设名或 宽x高（可重复；默认取目标的默认视口）
  --dpr <n>              设备像素比，默认 2（出图更清晰）
  --full                 整页截图（默认只截视口）
  --selector <css>       只截某个元素（自动滚到可见）
  --bg <颜色>            在 html 垫底色 —— 桌面端窗口 transparent:true，不垫会看不清边界

截图前的页面操作（用来"打开某个面板再截"）：
  --click <css>          点击元素（可重复，按顺序）
  --eval <js>            执行脚本（可重复）
  --wait-for <js>        等待页面内条件为真
  --wait <ms>            最后额外等待，默认 200

诊断：
  --no-audit             跳过布局审计（默认会审计，见下）
  --tiny-target <px>     点击热区告警阈值，默认 24
  --errors-only          只输出有问题的截图条目（索引里仍列全部）

Tauri IPC mock（浏览器里让真实前端跑起来，**桌面端目标默认开启**）：
  --mock                 注入 window.__TAURI_INTERNALS__，把 invoke 路由到 fixture
  --scenario <名>        使用场景预设（隐含 --mock；--list-scenarios 看全部）
  --mock-quiet           不打印未覆盖命令的告警
  → 截图后会报告"未被 mock 覆盖的命令"，据此补 fixture（见 lib/tauri-mock.mjs）

其它：
  --label <名>           本轮标签（用于产物目录名 / 索引标题）
  --out <目录>           自定义输出目录
  --browser <edge|chrome>  默认 Edge（与桌面端同为 WebView2 内核）
  --no-server            不起 dev server（假定已经在跑）
  --keep-open            截完不关浏览器（调试用；需自己收拾）
  --json                 只把 manifest JSON 打到 stdout（给脚本用）

查看清单：
  --list-targets / --list-views / --list-browsers

布局审计会检查（对应本项目历史真出过的 bug）：
  overflow-x / overflow-y  内容超出容器但没开滚动 → 被裁
  text-clip                overflow:hidden 且文字超出 → 文字被裁
  out-of-viewport          元素跑出可视区域 → 被祖先裁剪或要滚动才可见
  tiny-target              点击热区过小（<阈值）→ 手机上点不到
  tiny-font                字号 <10px
  covered                  元素中心被别的元素盖住 → 用户点不到（z-index/浮层问题）

产物：temp-debug/ui-shots/<时间戳>-<标签>/
  ├─ *.png          截图
  ├─ index.md       ★ 人/agent 读这个：截了什么 + 问题详情表
  └─ manifest.json  同数据的机读版
`;

/* ─────────────── 终端问题摘要 ─────────────── */

/**
 * 把布局审计结果**汇总打印到终端**。
 *
 * 为什么要有：早期版本只把问题写进 index.md，结果使用者（包括 agent）
 * 根本没注意到有问题 —— 报告埋在 gitignored 的产物目录里。
 * 现在跑完命令就能直接看到"哪些元素有问题、多大、该改哪个类"。
 *
 * 汇总策略：按 `kind` 分组、**按元素选择器去重**（同一元素在多张图里重复出现只报一次），
 * 每组最多列 N 条，避免刷屏。
 */
function printFindingsToStdout(entries, tinyTarget) {
  const KIND_LABEL = {
    "overlay-blocking": "整屏遮罩挡住界面",
    "text-clip": "文字被裁",
    "overflow-x": "内容横向溢出未滚动",
    "overflow-y": "内容纵向溢出未滚动",
    "out-of-viewport": "元素越界",
    covered: "元素被遮挡点不到",
    "tiny-target": `点击热区过小（<${tinyTarget}px）`,
    "tiny-font": "字号过小",
  };
  const KIND_ORDER = ["overlay-blocking", "text-clip", "out-of-viewport", "overflow-y", "overflow-x", "covered", "tiny-target", "tiny-font"];

  // 按 kind → 去重后的选择器 → 首次出现的信息
  const byKind = new Map();
  const errorSet = new Map();   // 页面错误去重
  for (const e of entries) {
    for (const err of e.errors ?? []) {
      const key = String(err).split("\n")[0].slice(0, 160);
      if (!errorSet.has(key)) errorSet.set(key, { count: 0, shots: new Set() });
      const rec = errorSet.get(key);
      rec.count++;
      rec.shots.add(e.viewKey ?? e.name);
    }
    for (const f of e.audit?.findings ?? []) {
      if (!byKind.has(f.kind)) byKind.set(f.kind, new Map());
      const m = byKind.get(f.kind);
      if (!m.has(f.selector)) m.set(f.selector, { ...f, shots: new Set(), count: 0 });
      const rec = m.get(f.selector);
      rec.count++;
      rec.shots.add(e.viewKey ?? e.name);
    }
  }

  const realErrors = [...errorSet.entries()].filter(([k]) => !k.includes("favicon.ico"));
  const totalFindings = [...byKind.values()].reduce((n, m) => n + m.size, 0);

  if (!realErrors.length && !totalFindings) return;

  console.log("");
  console.log("┌─ 发现的问题 ─────────────────────────────────────────────");

  if (realErrors.length) {
    console.log(`│ ❌ 页面错误 ${realErrors.length} 类（favicon 404 已忽略）`);
    for (const [msg, rec] of realErrors.slice(0, 6)) {
      console.log(`│    · ${msg}`);
      if (rec.count > 1) console.log(`│      （在 ${rec.count} 张里出现：${[...rec.shots].join(", ")}）`);
    }
    if (realErrors.length > 6) console.log(`│    … 其余 ${realErrors.length - 6} 类见 index.md`);
  }

  for (const kind of KIND_ORDER) {
    const m = byKind.get(kind);
    if (!m?.size) continue;
    const items = [...m.values()];
    // tiny-target / tiny-font 按"越小越严重"排序，其余按出现次数
    if (kind === "tiny-target" || kind === "tiny-font") {
      items.sort((a, b) => parseFloat(a.value) - parseFloat(b.value));
    } else {
      items.sort((a, b) => b.count - a.count);
    }
    console.log(`│ 🔍 ${KIND_LABEL[kind] ?? kind}：${items.length} 个元素`);
    for (const f of items.slice(0, 6)) {
      const short = shortenSelector(f.selector);
      console.log(`│    · ${short}   ${f.value}${f.count > 1 ? `  ×${f.count}` : ""}`);
    }
    if (items.length > 6) console.log(`│    … 其余 ${items.length - 6} 个见 index.md`);
  }

  console.log("└──────────────────────────────────────────────────────────");
  console.log("  完整表格（含说明与复现信息）：上面那个 index.md");
}

/** 选择器太长，压成"最后 2 段 + 关键类名"，终端里才读得下 */
function shortenSelector(sel) {
  const parts = String(sel).split(" > ").filter(Boolean);
  if (parts.length <= 2) return sel;
  return "… > " + parts.slice(-2).join(" > ");
}

/* ─────────────── 主流程 ─────────────── */

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) { console.log(HELP); return; }
  if (args.listTargets) {
    console.log("内置目标：\n");
    for (const [k, t] of Object.entries(TARGETS)) {
      console.log(`  ${k.padEnd(18)} ${t.label}`);
      console.log(`  ${"".padEnd(18)} url=${t.url}  views=${(t.views ?? []).join(",") || "(自带)"}`);
      if (t.note) console.log(`  ${"".padEnd(18)} ${t.note}`);
      console.log("");
    }
    console.log(`dev server：${Object.keys(SERVERS).join(", ")}`);
    return;
  }
  if (args.listViews) {
    console.log("视口预设：\n");
    for (const [k, v] of Object.entries(VIEWPORTS)) {
      console.log(`  ${k.padEnd(18)} ${String(v.width).padStart(5)}×${String(v.height).padEnd(5)}  ${v.label ?? ""}`);
    }
    console.log("\n也可直接写 宽x高，如 --view 800x600");
    return;
  }
  if (args.listRecipes) {
    console.log("截图配方（--recipe <名>）：\n");
    for (const r of listRecipes()) {
      console.log(`  ${r.name}`);
      console.log(`      target=${r.target}`);
      console.log(`      shots(${r.shots.length})：${r.shots.join(", ")}`);
    }
    return;
  }
  if (args.listScenarios) {
    console.log("Tauri IPC mock 场景预设（--scenario <名>）：\n");
    for (const [k, v] of Object.entries(SCENARIOS)) {
      const keys = Object.keys(v);
      console.log(`  ${k}`);
      console.log(`      ${keys.length ? "覆盖：" + keys.join(", ") : "（不覆盖任何命令 = 全新安装态）"}`);
    }
    return;
  }
  if (args.listBrowsers) {
    const list = listBrowsers();
    if (!list.length) { console.log("未找到 Chrome/Edge。用 UI_BROWSER=<路径> 指定。"); return; }
    console.log("本机可用浏览器：\n");
    for (const b of list) console.log(`  ${b.name.padEnd(8)} ${b.path}\n  ${"".padEnd(8)} ${b.label}`);
    return;
  }

  /* 1) 解析目标 / 配方 */
  const recipe = args.recipe ? RECIPES[args.recipe] : null;
  if (args.recipe && !recipe) {
    throw new Error(`未知配方 "${args.recipe}"。--list-recipes 看全部。`);
  }

  const effectiveTarget = args.target ?? recipe?.target ?? null;
  const targetCfg = effectiveTarget ? TARGETS[effectiveTarget] : null;
  if (effectiveTarget && !targetCfg) {
    throw new Error(`未知目标 "${effectiveTarget}"。--list-targets 看全部。`);
  }

  const baseUrl = targetCfg?.url ?? recipe?.url ?? null;
  const jobs = [];

  if (recipe) {
    if (!baseUrl) throw new Error(`配方 "${args.recipe}" 未提供 url，也未指定 target`);
    const shots = recipe.shots ?? [{}];
    shots.forEach((s, i) => {
      jobs.push({
        ...s,
        url: s.url ?? baseUrl,
        name: s.name ?? String(i).padStart(2, "0"),
      });
    });
  } else if (args.urls.length) {
    for (const u of args.urls) jobs.push({ url: u, name: slug(u) });
  } else if (targetCfg) {
    jobs.push({ url: targetCfg.url, name: args.target });
  } else {
    throw new Error("必须给 --target / --url / --recipe（--help 看用法）");
  }

  // 视口：命令行 > 配方默认 > 目标默认 > laptop
  const viewSpecs = args.views.length
    ? args.views
    : (recipe?.views?.length ? recipe.views : (targetCfg?.views?.length ? targetCfg.views : ["laptop"]));
  const views = viewSpecs.map((s) => ({ key: s, ...resolveView(s) }));

  const label = args.label ?? args.recipe ?? args.target ?? jobs[0].name ?? "web";
  const run = createRunDir({ label, out: args.out });

  // Tauri IPC mock：桌面端目标默认开（浏览器里没有 Tauri，不开会卡在启动遮罩）
  const useMock = args.noMock ? false : (args.mock || (recipe?.mock ?? false) || (targetCfg?.mock ?? false));
  const scenario = args.scenario ?? recipe?.scenario ?? targetCfg?.scenario ?? "fresh";
  if (useMock) {
    const known = Object.keys(SCENARIOS);
    if (!known.includes(scenario)) {
      throw new Error(`未知场景 "${scenario}"。可用：${known.join(", ")}`);
    }
    // 配方里每个 shot 可以覆盖场景 → 一并校验
    for (const j of jobs) {
      if (j.scenario && !known.includes(j.scenario)) {
        throw new Error(`配方 shot "${j.name}" 引用了未知场景 "${j.scenario}"`);
      }
    }
  }

  /* 2) dev server */
  let server = null;
  const serveName = args.serve ?? recipe?.serve ?? targetCfg?.serve ?? null;
  if (serveName && !args.noServer) {
    process.stdout.write(`▸ 准备 dev server：${serveName} … `);
    server = await ensureServer(serveName, { logDir: join(run.dir, "_servers") });
    console.log(server.reused ? "复用已在跑的" : `已启动 (pid 树)`);
  }

  /* 3) 浏览器 */
  const browser = await Browser.launch({ prefer: args.browser ?? undefined });
  console.log(`▸ 浏览器：${browser.info.label} — ${browser.info.version}`);
  console.log(`▸ 输出：${run.rel}`);
  if (recipe) console.log(`▸ 配方：${args.recipe}（${jobs.length} 个 shot）`);

  const entries = [];
  let idx = 0;

  try {
    for (const job of jobs) {
      // 每个 shot 可覆盖视口
      const jobViews = job.views?.length ? job.views.map((s) => ({ key: s, ...resolveView(s) })) : views;
      // 每个 shot 可覆盖 mock 场景
      const jobScenario = job.scenario ?? scenario;
      // 每个 shot 可覆盖截图前的操作
      const jobClicks = job.clicks ?? args.clicks;
      const jobEvals = job.evals ?? args.evals;
      const jobWaitFor = job.waitFor ?? args.waitFor;
      const jobWait = job.wait ?? args.wait;
      const jobFull = job.full ?? args.full;
      const jobSelector = job.selector ?? args.selector;

      for (const v of jobViews) {
        idx++;
        const t0 = Date.now();
        const page = await browser.newPage({
          viewport: { width: v.width, height: v.height, deviceScaleFactor: args.dpr, mobile: v.width < 560 },
        });

        const stopProbe = await startProbe(page);

        // 注入顺序很重要：mock → 底色 → 导航（两个都是"页面脚本前执行"）
        if (useMock) {
          await page.addInitScript(buildMockInitScript({ scenario: jobScenario, quiet: args.mockQuiet }));
        }

        // 桌面端窗口 transparent:true → 垫底色，才看得见容器圆角与边界
        const bg = args.bg ?? targetCfg?.bg ?? null;
        if (bg) await page.addInitScript(`document.addEventListener('DOMContentLoaded',()=>{document.documentElement.style.background=${JSON.stringify(bg)}});`);

        try {
          await page.goto(job.url, { timeout: args.timeout });

          // 等 DOM 静止：本项目加载遮罩是 onMounted 后再 setTimeout 800ms 才隐藏，
          // 固定 sleep 会抢在它前面截到"正在启动…"（src/App.vue）
          if (args.settle) {
            const verdict = await page.waitForDomIdle({ idleMs: 350, timeout: args.settleTimeout });
            if (verdict === "timeout") warnings.push("[settle] DOM 在超时前未静止，截图可能截到过渡态");
          }

          if (jobWaitFor) await page.waitForFunction(jobWaitFor, { timeout: args.timeout });

          for (const sel of jobClicks) {
            await page.evaluate(`(() => {
              const el = document.querySelector(${JSON.stringify(sel)});
              if (!el) throw new Error('点击目标不存在: ' + ${JSON.stringify(sel)});
              el.scrollIntoView({block:'center'});
              el.click();
            })()`);
            await sleep(220);
          }
          for (const js of jobEvals) { await page.evaluate(js); await sleep(120); }
          // 点开面板后也可能有过渡动画，再等一次 DOM 静止
          if (jobClicks.length && args.settle) await page.waitForDomIdle({ idleMs: 300, timeout: 4000 });
          if (jobWait) await sleep(jobWait);
        } catch (e) {
          console.log(`  ✗ [${idx}] ${job.name} · ${v.key} 加载/操作失败：${e.message}`);
        }

        const { errors, warnings } = stopProbe();

        // 读 mock 的覆盖情况：未被 fixture 覆盖的命令 = 后续要补的清单
        let mockInfo = null;
        if (useMock) {
          mockInfo = await page.evaluate(`(() => {
            const m = window.__UI_MOCK__;
            if (!m) return { installed: false };
            return {
              installed: true,
              scenario: m.scenario,
              unmocked: m.unmocked,
              listenedEvents: m.listenedEvents,
              commandCalls: m.calls.length,
            };
          })()`).catch(() => null);
          if (mockInfo?.installed === false) {
            errors.push("[ui-mock] 注入失败：页面里没有 window.__UI_MOCK__（mock 脚本未在页面脚本前执行？）");
          }
        }

        let audit = null;
        if (args.audit) {
          try { audit = await auditLayout(page, { tinyTarget: args.tinyTarget }); }
          catch (e) { warnings.push(`[audit] 审计失败：${e.message}`); }
        }

        let file = null;
        let bytes = 0;
        if (args.image) {
          const mode = jobSelector ? "element" : (jobFull ? "fullpage" : "viewport");
          const suffix = `${String(idx).padStart(2, "0")}-${slug(job.name)}-${slug(v.key)}-${mode}.png`;
          file = join(run.dir, suffix);
          try {
            const buf = await page.screenshot({
              path: file,
              fullPage: jobFull && !jobSelector,
              selector: jobSelector ?? undefined,
              padding: jobSelector ? 8 : 0,
            });
            bytes = buf.length;
          } catch (e) {
            file = null;
            errors.push(`截图失败：${e.message}`);
          }
        }

        const ms = Date.now() - t0;
        const entry = {
          file: file ? `${run.rel}/${basename(file)}` : null,
          url: job.url,
          name: job.name,
          viewport: { width: v.width, height: v.height },
          viewKey: v.key,
          dpr: args.dpr,
          mode: jobSelector ? `element(${jobSelector})` : (jobFull ? "fullpage" : "viewport"),
          full: jobFull,
          scenario: useMock ? jobScenario : null,
          bytes, ms,
          errors, warnings,
          mock: mockInfo,
          audit: audit ? { viewport: audit.viewport, elementCount: audit.elementCount, findings: audit.findings } : null,
        };
        entries.push(entry);

        const flag = errors.length ? "❌" : (audit?.findings?.length ? "🔍" : "✓");
        const detail = errors.length ? `${errors.length} 个错误`
          : (audit?.findings?.length ? `${audit.findings.length} 条布局问题` : "干净");
        console.log(`  ${flag} [${idx}] ${job.name} · ${v.key} ${v.width}×${v.height}@${args.dpr}x — ${detail} (${ms}ms)`);

        if (!args.keepOpen) await page.close();
      }
    }

    const manifest = writeManifest(run, entries, {
      browser: browser.info.label,
      browserVersion: browser.info.version,
      server: server ? `${serveName} (port ${server.port}${server.reused ? ", 复用" : ""})` : null,
      targets: jobs.map((j) => j.url),
      note: recipe ? `配方 ${args.recipe}` : (targetCfg?.note ?? null),
      mock: useMock ? scenario : null,
      recipe: args.recipe ?? null,
    });

    if (args.json) {
      console.log(JSON.stringify(manifest, null, 2));
    } else {
      const bad = entries.filter((e) => e.errors.length || e.audit?.findings?.length);
      console.log("");
      console.log(`✅ 完成 ${entries.length} 张 → ${run.rel}`);
      console.log(`   清单（先读这个）：${run.rel}/index.md`);
      if (bad.length) console.log(`   ⚠️ ${bad.length} 张有问题`);
      else console.log("   未发现页面错误或布局问题");

      // ★ 把问题**直接打到终端**，不要只埋在 index.md 里
      printFindingsToStdout(entries, args.tinyTarget);
    }
  } finally {
    if (!args.keepOpen) {
      await browser.close();
      server?.stop();
    } else {
      console.log("\n--keep-open：浏览器与服务保持运行；记得手动关闭。");
    }
  }
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}\n`);
  process.exit(1);
});
