#!/usr/bin/env node
/**
 * 从代码生成“整体结构总览”。
 *
 * 设计原则：
 * - 根 README 只做入口，不手写目录树 / 版本号 / 模块清单；
 * - 这些会快速过期的“整体内容”统一由本脚本扫描代码生成；
 * - `--check` 只比较不写盘，供 `npm run docs:check` / CI 使用。
 *
 * 用法：
 *   npm run docs:map
 *   node scripts/docs/generate-project-map.mjs --check
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectVersions } from "../release/check-versions.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TARGET = path.join(ROOT, "docs", "PROJECT_MAP.md");

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

function exists(relPath) {
  return fs.existsSync(path.join(ROOT, relPath));
}

function listFiles(dir, filter = () => true) {
  if (!exists(dir)) return [];
  return fs
    .readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    .filter((entry) => entry.isFile() && filter(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "en"));
}

function walkFiles(dir, filter = () => true) {
  if (!exists(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(rel, filter));
    else if (filter(entry.name)) out.push(rel);
  }
  return out.sort((a, b) => a.localeCompare(b, "en"));
}

function readmeLink(dir) {
  const readme = path.posix.join(dir, "README.md");
  return exists(readme) ? `[${readme}](../${readme})` : "—";
}

function pwaVersion() {
  const text = read("src/pwa/config.ts");
  return text.match(/PWA_VERSION\s*:[^=]*=\s*"([^"]+)"/)?.[1] ?? "MISSING";
}

function parsePackageVersion() {
  return JSON.parse(read("package.json")).version;
}

function sectionTable() {
  const rows = [
    ["`src/`", "桌面端前端：Vue 3 组件 / Pinia store / Tauri invoke 封装", "src"],
    ["`src-tauri/`", "桌面端后端：Tauri commands、纯 Rust 业务模块", "src-tauri"],
    ["`src/pwa/`", "PWA 专属层：复用 `src/`，替换 `@tauri-apps/api` 为浏览器 shim", "src/pwa"],
    [
      "`server-planning/`",
      "服务器接口文档（运行代码不在本仓库）",
      "server-planning",
    ],
    ["`tools/ui/`", "UI 截图 / 布局审计 / 真实窗口驱动", "tools/ui"],
    ["`scripts/`", "构建、P2P 联调、留言板、文档/版本检查脚本", "scripts"],
    ["`docs/`", "架构、模块、安全、排错与历史文档", "docs"],
    ["`music-player/`", "内置音乐资源与标签", "music-player"],
    ["`deprecated/`", "冻结的历史归档，不改不删", "deprecated"],
    ["`.local/`", "本机/服务器私密区（仅 README 入库）", ".local"],
  ];
  return [
    "| 目录 | 作用 | 入口文档 |",
    "|---|---|---|",
    ...rows.map(([dir, desc, readmeDir]) => `| ${dir} | ${desc} | ${readmeLink(readmeDir)} |`),
  ].join("\n");
}

function versionTable() {
  const entries = collectVersions();
  const rows = entries.map(
    (entry) => `| \`${entry.file}\` | ${entry.label} | \`${entry.version ?? "MISSING"}\` |`,
  );
  return [
    "| 文件 | 字段 | 版本 |",
    "|---|---|---|",
    ...rows,
    `| \`src/pwa/config.ts\` | PWA_VERSION（独立于桌面端） | \`${pwaVersion()}\` |`,
  ].join("\n");
}

function metricTable() {
  const apiFiles = listFiles("src/api", (name) => name.endsWith(".ts"));
  const storeFiles = listFiles("src/stores", (name) => name.endsWith(".ts"));
  const componentFiles = walkFiles("src/components", (name) => name.endsWith(".vue"));
  const commandFiles = listFiles(
    "src-tauri/src/commands",
    (name) => name.endsWith(".rs") && name !== "mod.rs",
  );
  const moduleFiles = listFiles(
    "src-tauri/src/modules",
    (name) => name.endsWith(".rs") && name !== "mod.rs",
  );
  const frontendTests = walkFiles("src", (name) => name.endsWith(".test.ts"));

  return [
    "| 指标 | 数量 | 扫描路径 |",
    "|---|---:|---|",
    `| 前端 API 封装 | ${apiFiles.length} | \`src/api/*.ts\` |`,
    `| Pinia stores | ${storeFiles.length} | \`src/stores/*.ts\` |`,
    `| Vue 组件 | ${componentFiles.length} | \`src/components/**/*.vue\` |`,
    `| Tauri command 文件 | ${commandFiles.length} | \`src-tauri/src/commands/*.rs\` |`,
    `| Rust module 文件 | ${moduleFiles.length} | \`src-tauri/src/modules/*.rs\` |`,
    `| 前端测试文件 | ${frontendTests.length} | \`src/**/*.test.ts\` |`,
  ].join("\n");
}

function fileList(title, dir, suffix) {
  const files = listFiles(dir, (name) => name.endsWith(suffix) && name !== "mod.rs");
  return [`### ${title}（${files.length}）`, "", files.map((name) => `- \`${name}\``).join("\n")].join(
    "\n",
  );
}

function mermaid() {
  return [
    "```mermaid",
    "flowchart LR",
    '  F["src/ 桌面端前端<br/>Vue 3 + Pinia"] -->|invoke / event| B["src-tauri/<br/>Rust 后端"]',
    '  P["src/pwa/<br/>PWA"] -->|alias 复用| F',
    '  B -->|REST / WebSocket| API["服务器 API<br/>（代码不在本仓库）"]',
    '  P -->|REST / WebSocket| API',
    '  A["安卓端<br/>（独立仓库）"] -.->|同一套接口| API',
    '  API -.->|接口文档| S["server-planning/"]',
    "```",
  ].join("\n");
}

/**
 * 生成 PROJECT_MAP.md 的完整文本。必须保持确定性（无时间戳、排序稳定），
 * 这样 `--check` 才能做纯文本比较。
 */
export function generateProjectMap() {
  const version = parsePackageVersion();
  const lines = [
    "# 项目结构总览（自动生成）",
    "",
    "> **不要手改。** 本文件由 `npm run docs:map` 扫描代码生成。",
    "> 版本、目录、模块清单都以代码为准；手写文档只写“范围”和“入口”。",
    "> CI 会运行 `npm run docs:check`，本文件与代码不一致时会失败。",
    "",
    `当前 \`package.json\` 版本：\`${version}\`。`,
    "",
    "## 1. 仓库范围",
    "",
    "本仓库包含：桌面端（`src/` + `src-tauri/`）、PWA 专属层（`src/pwa/`）、",
    "服务器接口文档（`server-planning/`）、UI 工具、脚本与项目文档。",
    "",
    "不包含：服务器运行代码（在服务器上维护）、安卓端代码（独立仓库）。",
    "",
    "## 2. 目录与入口",
    "",
    sectionTable(),
    "",
    "## 3. 架构（由代码结构生成）",
    "",
    mermaid(),
    "",
    "## 4. 版本快照",
    "",
    versionTable(),
    "",
    "> 桌面端版本是同一套值；PWA 的 `PWA_VERSION` 独立，只在发布 PWA 时更新。",
    "",
    "## 5. 代码规模（扫描快照）",
    "",
    metricTable(),
    "",
    "> 这里只统计结构规模，不代替测试结果。测试请运行 `npm test` / `cargo test --lib`。",
    "",
    "## 6. 后端模块清单",
    "",
    fileList("Tauri commands", "src-tauri/src/commands", ".rs"),
    "",
    fileList("Rust modules", "src-tauri/src/modules", ".rs"),
    "",
    "## 7. 维护方式",
    "",
    "```bash",
    "npm run docs:map      # 重新生成本文件",
    "npm run docs:check    # 校验本文件、版本号、必需 README",
    "npm run versions:check",
    "```",
    "",
    "> 根 README / AGENTS 不写目录树、版本号、测试数量；需要整体视图时读本文件。",
    "",
  ];
  return lines.join("\n");
}

function normalize(text) {
  return text.replace(/\r\n/g, "\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const expected = generateProjectMap();
  if (process.argv.includes("--check")) {
    const actual = fs.existsSync(TARGET) ? normalize(fs.readFileSync(TARGET, "utf8")) : "";
    if (actual !== expected) {
      console.error("❌ docs/PROJECT_MAP.md 已过期。运行 `npm run docs:map` 重新生成。");
      process.exit(1);
    }
    console.log("✅ docs/PROJECT_MAP.md 与代码一致");
  } else {
    fs.mkdirSync(path.dirname(TARGET), { recursive: true });
    fs.writeFileSync(TARGET, expected, "utf8");
    console.log(`✅ 已生成 ${path.relative(ROOT, TARGET)}`);
  }
}
