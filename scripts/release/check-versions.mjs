#!/usr/bin/env node
/**
 * 版本号一致性检查。
 *
 * 单一基准：package.json 的 version。
 * 检查其余所有会被 Tauri/CI 读取的版本位置，避免“改了 package.json 忘了 Cargo.toml”类问题。
 *
 * 用法：
 *   node scripts/release/check-versions.mjs
 *   npm run versions:check
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

/**
 * 收集所有需要同步的版本值。
 * 返回 [{ file, label, version }]；package.json 永远排第一。
 */
export function collectVersions() {
  const pkg = JSON.parse(read("package.json"));
  const packageLock = JSON.parse(read("package-lock.json"));
  const cargoToml = read("src-tauri/Cargo.toml");
  const cargoLock = read("src-tauri/Cargo.lock");
  const tauriConf = JSON.parse(read("src-tauri/tauri.conf.json"));

  const cargoTomlVersion = cargoToml.match(
    /\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m,
  )?.[1];
  const cargoLockVersion = cargoLock.match(
    /name\s*=\s*"pomo-solo"\s*\r?\nversion\s*=\s*"([^"]+)"/,
  )?.[1];

  return [
    { file: "package.json", label: "version", version: pkg.version },
    {
      file: "package-lock.json",
      label: "version",
      version: packageLock.version,
    },
    {
      file: "package-lock.json",
      label: 'packages[""].version',
      version: packageLock.packages?.[""]?.version,
    },
    {
      file: "src-tauri/Cargo.toml",
      label: "[package] version",
      version: cargoTomlVersion,
    },
    {
      file: "src-tauri/Cargo.lock",
      label: 'pomo-solo version',
      version: cargoLockVersion,
    },
    {
      file: "src-tauri/tauri.conf.json",
      label: "version",
      version: tauriConf.version,
    },
  ];
}

export function formatVersionReport(entries) {
  const base = entries[0]?.version;
  const ok = Boolean(base) && entries.every((entry) => entry.version === base);
  const fileWidth = Math.max(...entries.map((entry) => entry.file.length));
  const labelWidth = Math.max(...entries.map((entry) => entry.label.length));

  const lines = [
    `版本号一致性检查（基准：package.json = ${base ?? "MISSING"}）`,
    "",
  ];
  for (const entry of entries) {
    const mark = entry.version === base ? "✅" : "❌";
    lines.push(
      `  ${mark} ${entry.file.padEnd(fileWidth)}  ` +
        `${entry.label.padEnd(labelWidth)}  ${entry.version ?? "MISSING"}`,
    );
  }
  lines.push(
    "",
    ok
      ? `✅ 全部一致：${base}`
      : "❌ 版本不一致。请同步 6 处版本值后再发版（README badge 已改为动态，不再手写）。",
  );
  return { ok, text: lines.join("\n") };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = formatVersionReport(collectVersions());
  console.log(report.text);
  process.exit(report.ok ? 0 : 1);
}
