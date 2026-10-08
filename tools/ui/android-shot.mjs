#!/usr/bin/env node
/**
 * UI 取证 · Android 端截图（adb）
 *
 * 安卓端是**独立仓库**（PomoSolo-Android，Kotlin + Compose 原生），
 * 本脚本只负责"把手机/模拟器上现在显示的东西取回来"。
 *
 * 除了截图，还会 dump UI 层级（uiautomator）做一次**布局审计**：
 * 找出点击热区过小（< 44dp）、越界、不可见但有文字的节点 —— 与 Web 端
 * shot.mjs 的布局审计同一套判据，便于两端对齐问题清单。
 *
 * 用法：
 *   npm run ui:android                  # 自动挑一台设备截图
 *   npm run ui:android -- --serial 127.0.0.1:16480
 *   npm run ui:android -- --all         # 所有已连接设备各截一张
 *   npm run ui:android -- --devices     # 只列出设备
 *   npm run ui:android -- --no-hierarchy  # 跳过 UI 层级审计
 *
 * 前置：模拟器/真机已连上（MuMu 没启动时 adb devices 为空）。
 *       MuMu 端口规则见 .local/ANDROID.md。
 * 产物：temp-debug/ui-shots/<时间戳>-android/
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRunDir } from "./lib/shots.mjs";
import { auditHierarchy } from "./lib/android-audit.mjs";

/* ─────────────── adb 定位 ─────────────── */

function findAdb() {
  if (process.env.ADB) {
    if (!existsSync(process.env.ADB)) throw new Error(`ADB 环境变量指向的文件不存在：${process.env.ADB}`);
    return process.env.ADB;
  }
  const candidates = [];
  for (const key of ["ANDROID_HOME", "ANDROID_SDK_ROOT"]) {
    if (process.env[key]) candidates.push(join(process.env[key], "platform-tools", process.platform === "win32" ? "adb.exe" : "adb"));
  }
  if (process.platform === "win32") {
    candidates.push(
      "C:\\Users\\admin\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe",
      join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk", "platform-tools", "adb.exe"),
    );
  } else {
    candidates.push("/usr/local/bin/adb", "/usr/bin/adb", join(process.env.HOME ?? "", "Library/Android/sdk/platform-tools/adb"));
  }
  for (const c of candidates) if (c && existsSync(c)) return c;

  // 退回 PATH
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["adb"], { encoding: "utf8" });
  if (probe.status === 0) {
    const p = probe.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (p && existsSync(p)) return p;
  }
  throw new Error(
    "找不到 adb。\n" +
    "  · 装了 Android SDK？设 ANDROID_HOME 或 ADB 环境变量指向 adb。\n" +
    "  · 本机默认位置见 .local/MACHINE.md §4。",
  );
}

/* ─────────────── adb 封装 ─────────────── */

function makeAdb(adbPath) {
  const run = (args, { binary = false, allowFail = false } = {}) => {
    const r = spawnSync(adbPath, args, {
      encoding: binary ? "buffer" : "utf8",
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
    if (r.error) throw new Error(`执行 adb 失败：${r.error.message}`);
    if (r.status !== 0 && !allowFail) {
      const err = binary ? (r.stderr?.toString() ?? "") : (r.stderr ?? "");
      throw new Error(`adb ${args.join(" ")} 失败（退出码 ${r.status}）：${err.trim()}`);
    }
    return r;
  };
  return {
    run,
    devices() {
      const out = run(["devices", "-l"]).stdout ?? "";
      return out.split(/\r?\n/).slice(1).map((l) => l.trim()).filter(Boolean).map((l) => {
        const parts = l.split(/\s+/);
        const serial = parts[0];
        const state = parts[1];
        const meta = {};
        for (const kv of parts.slice(2)) {
          const i = kv.indexOf(":");
          if (i > 0) meta[kv.slice(0, i)] = kv.slice(i + 1);
        }
        return { serial, state, model: meta.model ?? "", product: meta.product ?? "", device: meta.device ?? "" };
      }).filter((d) => d.state === "device");
    },
    prop(serial, name) {
      const r = run(["-s", serial, "shell", "getprop", name], { allowFail: true });
      return (r.stdout ?? "").trim();
    },
    size(serial) {
      const r = run(["-s", serial, "shell", "wm", "size"], { allowFail: true });
      const m = /(\d+)x(\d+)/.exec(r.stdout ?? "");
      return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
    },
    density(serial) {
      const r = run(["-s", serial, "shell", "wm", "density"], { allowFail: true });
      const m = /(\d+)/.exec(r.stdout ?? "");
      return m ? Number(m[1]) : null;
    },
    /** 截图：走"设备内落盘 + pull"，避免 exec-out 在 Windows 上被 CRLF 破坏二进制 */
    screenshot(serial, dest) {
      const remote = `/sdcard/_ui_shot_${Date.now()}.png`;
      run(["-s", serial, "shell", "screencap", "-p", remote]);
      const r = run(["-s", serial, "pull", remote, dest], { allowFail: true });
      run(["-s", serial, "shell", "rm", "-f", remote], { allowFail: true });
      if (!existsSync(dest) || statSync(dest).size === 0) {
        throw new Error(`截图失败：${r.stderr?.toString?.() ?? r.stderr ?? "未知原因"}`);
      }
      return statSync(dest).size;
    },
    /** UI 层级 XML */
    hierarchy(serial) {
      const remote = `/sdcard/_ui_dump_${Date.now()}.xml`;
      run(["-s", serial, "shell", "uiautomator", "dump", remote], { allowFail: true });
      const r = run(["-s", serial, "shell", "cat", remote], { allowFail: true });
      run(["-s", serial, "shell", "rm", "-f", remote], { allowFail: true });
      return r.stdout ?? "";
    },
  };
}

/* ─────────────── CLI ─────────────── */

function parseArgs(argv) {
  const a = { label: "android", out: null, serial: null, all: false, devices: false, hierarchy: true, tinyTargetDp: 44 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]; const next = () => argv[++i];
    switch (k) {
      case "--label": a.label = next(); break;
      case "--out": a.out = next(); break;
      case "--serial": a.serial = next(); break;
      case "--all": a.all = true; break;
      case "--devices": a.devices = true; break;
      case "--no-hierarchy": a.hierarchy = false; break;
      case "--tiny-target-dp": a.tinyTargetDp = Number(next()); break;
      case "-h": case "--help": a.help = true; break;
      default: if (k.startsWith("--")) throw new Error(`未知参数 ${k}`);
    }
  }
  return a;
}

const HELP = `
Android 端截图（adb）+ UI 层级布局审计

  npm run ui:android -- [选项]

  --serial <地址>     指定设备（如 127.0.0.1:16448）
  --all               所有已连接设备各截一张
  --devices           只列出设备，不截图
  --no-hierarchy      跳过 uiautomator 层级审计
  --tiny-target-dp n  点击热区告警阈值（默认 44dp）
  --label <名>        产物目录标签

前置：模拟器/真机已连上。MuMu 端口规则见 .local/ANDROID.md
      （竖屏常用 127.0.0.1:16448；横屏 16480 需先 adb connect）
`;

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return; }

  const adbPath = findAdb();
  const adb = makeAdb(adbPath);
  console.log(`▸ adb：${adbPath}`);

  const devices = adb.devices();
  if (!devices.length) {
    throw new Error(
      "没有已连接的 Android 设备（adb devices 为空）。\n" +
      "  · MuMu 模拟器没启动？先开模拟器。\n" +
      "  · 端口规则：从 16384 起，每多开一个实例 +32（见 .local/ANDROID.md）。\n" +
      "  · 手动连一下：adb connect 127.0.0.1:16448\n" +
      `  · 确认一下：\"${adbPath}\" devices`,
    );
  }

  if (args.devices) {
    console.log(`\n已连接设备（${devices.length}）：\n`);
    for (const d of devices) {
      const size = adb.size(d.serial);
      const density = adb.density(d.serial);
      const dp = size && density ? `${Math.round(size.width / (density / 160))}×${Math.round(size.height / (density / 160))}dp` : "?";
      console.log(`  ${d.serial}`);
      console.log(`      model=${d.model || "?"} device=${d.device || "?"}`);
      console.log(`      屏幕=${size ? `${size.width}×${size.height}px` : "?"} density=${density ?? "?"} ≈ ${dp}`);
    }
    return;
  }

  let targets;
  if (args.serial) {
    const hit = devices.find((d) => d.serial === args.serial);
    if (!hit) {
      throw new Error(
        `找不到设备 "${args.serial}"。当前：\n` + devices.map((d) => `  · ${d.serial}`).join("\n"),
      );
    }
    targets = [hit];
  } else if (args.all) {
    targets = devices;
  } else {
    targets = [devices[0]];
    if (devices.length > 1) {
      console.log(`▸ 检测到 ${devices.length} 台设备，默认用第一台：${devices[0].serial}（--all 全截，--serial 指定）`);
    }
  }

  const run = createRunDir({ label: args.label, out: args.out });
  const entries = [];

  for (const d of targets) {
    const size = adb.size(d.serial);
    const density = adb.density(d.serial);
    const androidVer = adb.prop(d.serial, "ro.build.version.release");
    const sdk = adb.prop(d.serial, "ro.build.version.sdk");
    const safeSerial = d.serial.replace(/[^\w.-]/g, "_");

    const png = join(run.dir, `${safeSerial}.png`);
    process.stdout.write(`▸ ${d.serial} 截图… `);
    const bytes = adb.screenshot(d.serial, png);
    console.log(`${(bytes / 1024).toFixed(1)} KB`);

    let audit = null;
    if (args.hierarchy) {
      process.stdout.write(`  UI 层级审计… `);
      const xml = adb.hierarchy(d.serial);
      audit = auditHierarchy(xml, { density: density ?? 160, screen: size, tinyTargetDp: args.tinyTargetDp });
      if (xml) writeFileSync(join(run.dir, `${safeSerial}-hierarchy.xml`), xml, "utf8");
      console.log(`${audit.findings.length} 条问题（节点 ${audit.nodeCount ?? "?"}）`);
    }

    entries.push({
      serial: d.serial,
      model: d.model,
      device: d.device,
      android: androidVer,
      sdk,
      screen: size,
      density,
      dp: size && density ? { width: Math.round(size.width / (density / 160)), height: Math.round(size.height / (density / 160)) } : null,
      file: `${run.rel}/${safeSerial}.png`,
      bytes,
      audit,
    });
  }

  // index.md
  const L = [];
  L.push(`# UI 取证 · Android`);
  L.push("");
  L.push(`- 生成时间：${new Date().toLocaleString("zh-CN")}`);
  L.push(`- adb：\`${adbPath}\``);
  L.push(`- 产物目录：\`${run.rel}\`　共 **${entries.length}** 张`);
  L.push("");
  L.push("| 设备 | 型号 | 系统 | 屏幕 | dp | 截图 | 层级问题 |");
  L.push("|------|------|------|------|----|------|---------|");
  for (const e of entries) {
    L.push(
      `| \`${e.serial}\` | ${e.model || "?"} | Android ${e.android} (SDK ${e.sdk}) | ` +
      `${e.screen ? `${e.screen.width}×${e.screen.height}px` : "?"} @${e.density} | ` +
      `${e.dp ? `${e.dp.width}×${e.dp.height}dp` : "?"} | [png](${e.serial.replace(/[^\w.-]/g, "_")}.png) | ` +
      `${e.audit ? (e.audit.findings.length ? `🔍 ${e.audit.findings.length}` : "✅ 干净") : "（未审计）"} |`,
    );
  }
  L.push("");
  const withFindings = entries.filter((e) => e.audit?.findings?.length);
  if (withFindings.length) {
    L.push("## UI 层级审计问题");
    L.push("");
    L.push("> 判据与 Web 端一致：点击热区 <44dp、节点越界。bounds 为物理像素。");
    L.push("");
    for (const e of withFindings) {
      L.push(`### \`${e.serial}\``);
      L.push("");
      L.push("| 类型 | 节点 | 数值 | 说明 |");
      L.push("|------|------|------|------|");
      for (const f of e.audit.findings) L.push(`| \`${f.kind}\` | \`${f.selector}\` | ${f.value} | ${f.detail} |`);
      L.push("");
    }
  } else {
    L.push("## UI 层级审计问题");
    L.push("");
    L.push("✅ 未发现点击热区过小或越界节点。");
    L.push("");
  }
  L.push("---");
  L.push("");
  L.push("*由 `tools/ui/android-shot.mjs` 生成。安卓端源码在独立仓库 `PomoSolo-Android`。*");
  writeFileSync(join(run.dir, "index.md"), L.join("\n"), "utf8");

  console.log(`\n✅ 完成 ${entries.length} 张 → ${run.rel}`);
  console.log(`   清单：${run.rel}/index.md`);
}

try { main(); }
catch (e) { console.error(`\n✗ ${e.message}\n`); process.exit(1); }
