#!/usr/bin/env node
/**
 * UI 约定静态检查（发布前跑）
 *
 * 把“靠人记得”的约定变成脚本：
 *   1. 滚动条只能有一个全局来源 src/styles/scrollbar.css；
 *   2. 任何 overflow-y:auto 的 .vue 必须至少使用一个 .app-scroll/.scrollable（稳定留槽）；
 *   3. 禁止 >=20 的 z-index magic number（MiniMode 内部 <20 的堆叠保留；
 *      真正的高层必须走 global.css 的 --z-* token）；
 *   4. z-index token 不得重复，避免“同级不同值”；
 *   5. 必须保留 .app-modal-overlay 的公共遮罩契约。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const GLOBAL_CSS = join(SRC, "styles", "global.css");
const SCROLLBAR_CSS = join(SRC, "styles", "scrollbar.css");
const errors = [];
const warnings = [];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(SRC).filter((f) => /\.(vue|css)$/.test(f));
const rel = (f) => relative(ROOT, f).replace(/\\/g, "/");

function err(msg, file, line) {
  errors.push(`${rel(file)}${line ? `:${line}` : ""}  ${msg}`);
}

// 1) 全局滚动条唯一来源
if (!files.includes(SCROLLBAR_CSS)) {
  errors.push("缺少 src/styles/scrollbar.css（全局滚动条基线）");
} else {
  const css = readFileSync(SCROLLBAR_CSS, "utf8");
  for (const needle of [
    "--scrollbar-size",
    "@supports selector(::-webkit-scrollbar)",
    "*::-webkit-scrollbar",
    ".app-scroll",
  ]) {
    if (!css.includes(needle)) errors.push(`scrollbar.css 缺少关键约定：${needle}`);
  }
}

// 2) 组件里不允许再写滚动条细节
for (const file of files) {
  if (file === SCROLLBAR_CSS) continue;
  const text = readFileSync(file, "utf8");
  text.split(/\r?\n/).forEach((line, i) => {
    if (/::-webkit-scrollbar/.test(line)) err("滚动条样式必须收口到 scrollbar.css", file, i + 1);
    if (/^(?:scrollbar-width|scrollbar-color)\s*:/.test(line.trim())) {
      err("滚动条宽度/颜色必须收口到 scrollbar.css", file, i + 1);
    }
  });
}

// 3) overflow-y:auto 的组件至少使用一个 app-scroll/scrollable
const vueFiles = files.filter((f) => f.endsWith(".vue"));
for (const file of vueFiles) {
  const text = readFileSync(file, "utf8");
  if (!/overflow-y\s*:\s*auto/.test(text)) continue;
  if (!/class="[^"]*(?:app-scroll|scrollable)[^"]*"/.test(text)) {
    err("有 overflow-y:auto 但没有 app-scroll/scrollable（滚动条会没有稳定留槽）", file);
  }
}

// 4) z-index magic number（>=20）
for (const file of files) {
  if (file === GLOBAL_CSS) continue;
  const text = readFileSync(file, "utf8");
  let inComment = false;
  text.split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim();
    if (inComment) {
      if (trimmed.includes("*/")) inComment = false;
      return;
    }
    if (trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/")) inComment = true;
      return;
    }
    if (trimmed.startsWith("*") || trimmed.startsWith("//")) return;
    const m = line.match(/z-index\s*:\s*(\d+)/);
    if (!m) return;
    const n = Number(m[1]);
    if (n >= 20) err(`z-index:${n} 是 magic number；请用 global.css 的 --z-* token`, file, i + 1);
  });
}

// 5) z-index token 唯一
const globalCss = readFileSync(GLOBAL_CSS, "utf8");
const tokens = [...globalCss.matchAll(/--z-([a-z0-9-]+)\s*:\s*(\d+)/g)].map((m) => ({
  name: `--z-${m[1]}`,
  value: Number(m[2]),
}));
const byValue = new Map();
for (const t of tokens) {
  if (byValue.has(t.value)) {
    errors.push(`z-index token 重复：${byValue.get(t.value)} 与 ${t.name} 都是 ${t.value}`);
  }
  byValue.set(t.value, t.name);
}
if (!tokens.length) errors.push("global.css 没有解析到 --z-* token");

// 6) Modal 遮罩公共契约
if (!/\.app-modal-overlay\s*\{/.test(globalCss)) {
  errors.push("global.css 缺少 .app-modal-overlay（Modal 遮罩公共模板）");
}

// 7) .main-content 不得裁剪/自建层叠上下文（历史 bug：弹窗被裁剪、播放器被盖）
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/\.main-content\s*\{[^}]*\}/g)) {
    if (/(?:overflow\s*:\s*hidden|overflow-[xy]\s*:\s*hidden)/.test(m[0])) {
      err(".main-content 不能 overflow:hidden（会裁剪内部弹窗/播放器）", file);
    }
    if (/z-index\s*:\s*(?!var\()[^;]+/.test(m[0])) {
      err(".main-content 不能设 z-index（会自建层叠上下文）", file);
    }
  }
}

// 7) 滚动条细宽度约定（防止将来有人把全局 6px 改回默认）
const scrollbarCss = files.includes(SCROLLBAR_CSS) ? readFileSync(SCROLLBAR_CSS, "utf8") : "";
if (scrollbarCss && !/--scrollbar-size\s*:\s*(?:4|5|6|7|8)px/.test(scrollbarCss)) {
  warnings.push("scrollbar.css 的 --scrollbar-size 不是 4-8px 的细滚动条");
}

if (warnings.length) {
  console.log("UI 约定检查（警告）");
  for (const w of warnings) console.log(`  ⚠ ${w}`);
}
if (errors.length) {
  console.error("UI 约定检查失败");
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log(`✅ UI 约定检查通过（${files.length} 个 Vue/CSS 文件，${tokens.length} 个 z-index token）`);
