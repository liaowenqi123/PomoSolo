#!/usr/bin/env node
/**
 * CSS 规则使用率报告（可选诊断，不作为硬门禁）
 *
 * 为什么不直接做“CSS 行覆盖率”：
 *   CSS 规则是否命中取决于当前界面状态（没打开的设置面板天然未使用），
 *   用单页百分比当门禁会误杀。这里用 CDP CSS.startRuleUsageTracking 收集
 *   一组主要界面状态下的**规则命中数/总规则数**，并列出未命中选择器，
 *   用于发现“永远不可能命中”的死样式；硬门禁仍由 npm run ui:check 负责。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Browser } from "./lib/cdp.mjs";
import { ensureServer } from "./lib/servers.mjs";
import { TARGETS } from "./lib/targets.mjs";
import { buildMockInitScript } from "./lib/tauri-mock.mjs";

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** 极简 CSS 规则扫描：只取顶层/嵌套规则的 selector 与字符区间 */
function scanRules(text) {
  const rules = [];
  let i = 0;
  let last = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open < 0) break;
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === "{") depth += 1;
      else if (text[j] === "}") depth -= 1;
      j += 1;
    }
    const raw = text.slice(last, open).trim();
    const selector = raw.split(/[;}]/).pop().trim();
    if (selector && !selector.startsWith("@")) {
      rules.push({ start: last, end: j, selector });
    }
    last = j;
    i = j;
  }
  return rules;
}

async function main() {
  const server = await ensureServer("desktop");
  const browser = await Browser.launch({ hideScrollbars: true });
  const page = await browser.newPage({
    viewport: { width: 520, height: 560, deviceScaleFactor: 1 },
    freezeAnimations: true,
  });

  const sheets = new Map();
  page.on("CSS.styleSheetAdded", (p) => {
    if (p?.header) sheets.set(p.header.styleSheetId, p.header);
  });
  await page.send("DOM.enable");
  await page.send("CSS.enable");
  await page.send("CSS.startRuleUsageTracking");

  await page.addInitScript(buildMockInitScript({ scenario: "music-playing", quiet: true }));
  await page.goto(TARGETS.desktop.url);
  await page.waitForFunction("document.querySelector('.music-playlist-btn')", { timeout: 15000 });
  await page.waitForFunction(
    "(() => { const e = document.querySelector('.loading-overlay'); return !e || getComputedStyle(e).display === 'none' || e.getBoundingClientRect().width === 0; })()",
    { timeout: 20000 },
  );

  // 覆盖几个主要状态：紧凑列表 → 全屏 → 目录/筛选/播放列表 → 设置
  const click = async (sel) => {
    try {
      const r = await page.clickSelector(sel);
      if (r.hitOk === false) return false;
      return true;
    } catch {
      return false;
    }
  };
  await click(".music-playlist-btn");
  await new Promise((r) => setTimeout(r, 300));
  await click(".music-list__btn");
  await new Promise((r) => setTimeout(r, 400));
  await click(".music-playlist__tab.filter");
  await click(".music-playlist__tab.playlist");
  await click(".music-playlist__close");
  await click('[title="设置"]');
  await new Promise((r) => setTimeout(r, 400));
  await click(".settings-panel__close");

  const stop = await page.send("CSS.stopRuleUsageTracking");
  const usage = stop.ruleUsage || [];

  let totalRules = 0;
  let usedRules = 0;
  const unused = [];
  for (const id of sheets.keys()) {
    let text = "";
    try {
      text = (await page.send("CSS.getStyleSheetText", { styleSheetId: id })).text || "";
    } catch {
      continue;
    }
    const rules = scanRules(stripComments(text));
    totalRules += rules.length;
    const ranges = usage
      .filter((u) => u.styleSheetId === id)
      .map((u) => [u.startOffset, u.endOffset]);
    for (const rule of rules) {
      const hit = ranges.some(([a, b]) => rule.start <= b && rule.end >= a);
      if (hit) usedRules += 1;
      else if (unused.length < 80) unused.push(rule.selector);
    }
  }

  const pct = totalRules ? Math.round((usedRules / totalRules) * 1000) / 10 : 0;
  const report = {
    generatedAt: new Date().toISOString(),
    usedRules,
    totalRules,
    percent: pct,
    note: "CSS 命中率随界面状态变化，本报告只用于发现死样式，不作为发布门禁。",
    unusedSelectors: unused,
  };
  const dir = join(process.cwd(), "temp-debug", "style-coverage");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "style-coverage.json"), JSON.stringify(report, null, 2));
  writeFileSync(
    join(dir, "style-coverage.md"),
    [
      "# CSS 规则使用率",
      "",
      `- 命中：${usedRules}`,
      `- 总规则：${totalRules}`,
      `- 使用率：${pct}%`,
      "",
      "> 只统计当前打开的主要界面状态；未打开的面板天然未命中，不能当作删除依据。",
      "",
      "## 未命中选择器（前 80 条）",
      "",
      ...unused.map((s) => `- \`${s.replace(/\s+/g, " ").slice(0, 160)}\``),
      "",
    ].join("\n"),
  );

  console.log(`▸ CSS 规则：${usedRules}/${totalRules} 命中（${pct}%）`);
  console.log(`▸ 报告：${join("temp-debug", "style-coverage", "style-coverage.md")}`);
  await browser.close();
  server.stop();
}

main().catch((e) => {
  console.error(`\n✗ CSS 使用率报告失败：${e.message}\n`);
  process.exitCode = 1;
});
