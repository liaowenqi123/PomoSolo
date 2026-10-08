/**
 * UI 取证：输出目录、清单（manifest.json）与人读索引（index.md）
 *
 * 产物一律落 temp-debug/ui-shots/（已 gitignore）。
 * index.md 的用途：让 agent **读一个文本文件**就知道这轮截了什么、哪里有问题，
 * 不必逐张打开图片。
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, relative, basename } from "node:path";

export const SHOT_ROOT = join(process.cwd(), "temp-debug", "ui-shots");

/** 时间戳：20260910-143012 */
function stamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 清理标签，避免出现非法路径字符 */
export function slug(s) {
  return String(s ?? "run").trim().replace(/[^\w\u4e00-\u9fa5.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "run";
}

/**
 * 建一个运行目录。
 * @param {{ label?: string, out?: string }} opts
 * @returns {{ dir: string, label: string, rel: string }}
 */
export function createRunDir(opts = {}) {
  const label = slug(opts.label ?? "web");
  const dir = opts.out ? join(process.cwd(), opts.out) : join(SHOT_ROOT, `${stamp()}-${label}`);
  mkdirSync(dir, { recursive: true });
  return { dir, label, rel: relative(process.cwd(), dir) };
}

/**
 * 写清单。entries 每项形如：
 * { file, url, viewport, dpr, mode, full, bytes, ms, note, errors: [], warnings: [], audit: {...} }
 */
export function writeManifest(run, entries, meta = {}) {
  const manifest = {
    generatedAt: new Date().toISOString(),
    label: run.label,
    dir: run.rel,
    browser: meta.browser ?? null,
    browserVersion: meta.browserVersion ?? null,
    server: meta.server ?? null,
    targets: meta.targets ?? null,
    count: entries.length,
    shots: entries,
  };
  writeFileSync(join(run.dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  writeFileSync(join(run.dir, "index.md"), renderIndex(run, entries, meta), "utf8");

  // 供 shell 快速定位最近一次产物
  try {
    mkdirSync(SHOT_ROOT, { recursive: true });
    writeFileSync(join(SHOT_ROOT, "LATEST.txt"), run.rel + "\n", "utf8");
  } catch { /* ignore */ }

  return manifest;
}

function renderIndex(run, entries, meta) {
  const L = [];
  L.push(`# UI 取证 · ${run.label}`);
  L.push("");
  L.push(`- 生成时间：${new Date().toLocaleString("zh-CN")}`);
  if (meta.browser) L.push(`- 浏览器：${meta.browser}${meta.browserVersion ? ` (${meta.browserVersion})` : ""}`);
  if (meta.server) L.push(`- 服务：${meta.server}`);
  if (meta.note) L.push(`- 说明：${meta.note}`);
  L.push(`- 产物目录：\`${run.rel}\`　共 **${entries.length}** 张`);
  L.push("");

  // 概览表
  L.push("| # | 文件 | 视口 | 模式 | 体积 | 耗时 | 问题 |");
  L.push("|---|------|------|------|------|------|------|");
  entries.forEach((e, i) => {
    const vp = e.viewport ? `${e.viewport.width}×${e.viewport.height}@${e.dpr ?? 1}x` : "-";
    const issues = [];
    if (e.errors?.length) issues.push(`❌ 错误 ${e.errors.length}`);
    if (e.warnings?.length) issues.push(`⚠️ 告警 ${e.warnings.length}`);
    if (e.audit?.findings?.length) issues.push(`🔍 布局 ${e.audit.findings.length}`);
    L.push(
      `| ${i + 1} | [${basename(e.file)}](${basename(e.file)}) | ${vp} | ${e.mode ?? "viewport"}${e.full ? "+整页" : ""} | ` +
      `${e.bytes ? (e.bytes / 1024).toFixed(1) + " KB" : "-"} | ${e.ms ? e.ms + " ms" : "-"} | ${issues.join(" / ") || "✅ 干净"} |`,
    );
  });
  L.push("");

  // 逐张详情（只在有问题时展开，保持索引精简）
  const problematic = entries.filter(
    (e) => e.errors?.length || e.warnings?.length || e.audit?.findings?.length,
  );
  if (problematic.length) {
    L.push("## 问题详情");
    L.push("");
    for (const e of problematic) {
      L.push(`### ${basename(e.file) ?? e.viewKey}${e.note ? ` — ${e.note}` : ""}`);
      if (e.url) L.push(`\`${e.url}\``);
      L.push("");
      if (e.errors?.length) {
        L.push("**页面错误 / 控制台 error：**");
        L.push("");
        for (const x of e.errors) L.push(`- \`${x}\``);
        L.push("");
      }
      if (e.warnings?.length) {
        L.push("**告警：**");
        L.push("");
        for (const x of e.warnings) L.push(`- \`${x}\``);
        L.push("");
      }
      if (e.audit?.findings?.length) {
        L.push(`**布局审计（${e.audit.findings.length} 条）：**`);
        L.push("");
        L.push("| 类型 | 元素 | 数值 | 说明 |");
        L.push("|------|------|------|------|");
        for (const f of e.audit.findings) {
          L.push(`| \`${f.kind}\` | \`${f.selector}\` | ${f.value} | ${f.detail} |`);
        }
        L.push("");
      }
    }
  } else if (entries.length) {
    L.push("## 问题详情");
    L.push("");
    L.push("✅ 本轮未发现页面错误或布局审计问题。");
    L.push("");
  }

  // mock 覆盖情况：未 mock 的命令 = 下一步要补的 fixture 清单
  const mocked = entries.filter((e) => e.mock?.installed);
  if (mocked.length) {
    const all = new Set();
    for (const e of mocked) for (const c of e.mock.unmocked ?? []) all.add(c);
    L.push("## Tauri IPC mock 覆盖情况");
    L.push("");
    L.push(`- 场景：\`${mocked[0].mock.scenario}\``);
    L.push(`- 页面已调用的 Tauri 命令数：${mocked[0].mock.commandCalls}`);
    L.push(`- 页面已监听的事件：${(mocked[0].mock.listenedEvents ?? []).join(", ") || "（无）"}`);
    L.push("");
    if (all.size) {
      L.push(`**未被 fixture 覆盖的命令（返回 null，共 ${all.size} 个）：**`);
      L.push("");
      L.push("> 这些命令说明 UI 在 mock 下这些数据是空的。要摆出对应状态，");
      L.push("> 就在 `tools/ui/lib/tauri-mock.mjs` 的 `BASE_FIXTURES` / `SCENARIOS` 里补一条。");
      L.push("");
      for (const c of [...all].sort()) L.push(`- \`${c}\``);
      L.push("");
    } else {
      L.push("✅ 页面调用的所有 Tauri 命令都已有 fixture。");
      L.push("");
    }
  }

  L.push("---");
  L.push("");
  L.push("*由 `tools/ui/shot.mjs` 生成。看图片请直接打开上方链接；`manifest.json` 是同一份数据的机读版。*");
  return L.join("\n");
}

/** 读取最近一次运行的目录路径（相对仓库根） */
export function readLatest() {
  const p = join(SHOT_ROOT, "LATEST.txt");
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8").trim();
}
