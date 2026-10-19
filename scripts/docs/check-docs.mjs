#!/usr/bin/env node
/**
 * 文档一致性防御检查。
 *
 * 目标不是“检查文风”，而是拦住会随着迭代必然过期的几类内容：
 * 1. 版本号多处不一致；
 * 2. 根 README / AGENTS 手写版本号、测试数量、目录树；
 * 3. 代码结构变了但 PROJECT_MAP.md 没重新生成；
 * 4. 目录 README 缺失。
 *
 * 用法：
 *   npm run docs:check
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectVersions, formatVersionReport } from "../release/check-versions.mjs";
import { generateProjectMap } from "./generate-project-map.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const errors = [];

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8").replace(/\r\n/g, "\n");
}

function exists(relPath) {
  return fs.existsSync(path.join(ROOT, relPath));
}

// 1) 必需 README：每个主要目录只维护自己范围内的文档
const requiredReadmes = [
  "README.md",
  "AGENTS.md",
  "src/README.md",
  "src-tauri/README.md",
  "src/pwa/README.md",
  "server-planning/README.md",
  "tools/ui/README.md",
  "scripts/README.md",
  "scripts/server/README.md",
  "docs/README.md",
  "music-player/README.md",
  ".local/README.md",
  "deprecated/README.md",
];
for (const relPath of requiredReadmes) {
  if (!exists(relPath)) errors.push(`缺少目录 README：${relPath}`);
}

// 2) 版本号一致性
const versionReport = formatVersionReport(collectVersions());
console.log(versionReport.text);
if (!versionReport.ok) errors.push("版本号不一致（见上方表格）");

// 3) 生成物是否过期
const mapPath = path.join(ROOT, "docs", "PROJECT_MAP.md");
const expectedMap = generateProjectMap();
const actualMap = fs.existsSync(mapPath)
  ? fs.readFileSync(mapPath, "utf8").replace(/\r\n/g, "\n")
  : "";
if (actualMap !== expectedMap) {
  errors.push("docs/PROJECT_MAP.md 已过期：运行 `npm run docs:map` 重新生成");
}

// 4) 根入口文档禁止手写“整体快照”
const semverLike = /(?<![\d.])v?\d+\.\d+\.\d+(?![\d.])/g;
const testCountLike = /\d+\s*(?:个)?\s*(?:文件|用例|例子|例)\s*\d*/g;

for (const relPath of ["README.md", "AGENTS.md"]) {
  const text = read(relPath);
  const semverHits = text.match(semverLike) ?? [];
  if (semverHits.length > 0) {
    errors.push(
      `${relPath} 不应手写具体版本号（${[...new Set(semverHits)].join(", ")}）；` +
        "版本由 docs/PROJECT_MAP.md 生成",
    );
  }
  const countHits = text.match(testCountLike) ?? [];
  if (countHits.length > 0) {
    errors.push(
      `${relPath} 不应手写测试数量（${[...new Set(countHits)].join(", ")}）；运行测试即可`,
    );
  }
}

const teamGuide = read("TEAM_GUIDE.md");
const currentVersionPatterns = [
  /当前版本[：:]\s*\**v?\d/,
  /当前正式版为\s*\**v?\d/,
  /已上线（v\d/,
];
for (const pattern of currentVersionPatterns) {
  if (pattern.test(teamGuide)) {
    errors.push(
      `TEAM_GUIDE.md 不应写死“当前版本”（命中 ${pattern}）；以 package.json / GitHub Releases 为准`,
    );
  }
}

// 5) 根 README 必须能指向自动生成的整体视图
if (!read("README.md").includes("docs/PROJECT_MAP.md")) {
  errors.push("README.md 缺少指向 docs/PROJECT_MAP.md 的链接（整体视图应自动生成）");
}

if (errors.length > 0) {
  console.error("\n❌ 文档一致性检查失败：");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log("\n✅ 文档一致性检查通过");
