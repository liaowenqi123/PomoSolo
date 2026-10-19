#!/usr/bin/env node
/**
 * 留言板命令行工具（Agent 用）
 *
 *   node scripts/board/board.mjs                 # 默认 = digest，一页速览（工作前后看这个）
 *   node scripts/board/board.mjs digest          # 同上，--md 输出纯文本
 *   node scripts/board/board.mjs list            # 项目（一级）总览 + 各状态计数
 *   node scripts/board/board.mjs posts [--project p] [--status s] [--q 词] [--limit n]
 *   node scripts/board/board.mjs read <id>       # 帖子详情（含全部评论）
 *   node scripts/board/board.mjs post --title "..." [--project p] [--body "..."] [--tags a,b] [--priority 0|1|2]
 *   node scripts/board/board.mjs comment <id> --body "..." [--kind comment|question|answer|review]
 *   node scripts/board/board.mjs status <id> <状态> [--note "..."]
 *   node scripts/board/board.mjs project --slug x --name "..." [--desc "..."]
 *   node scripts/board/board.mjs open <id>       # 打印网页地址
 *
 * 通用：--author "名字"（或用环境变量 BOARD_AUTHOR / 默认 agent@主机名）
 *       --json 输出原始 JSON   --url <地址> 覆盖服务地址（默认环境变量 BOARD_URL）
 */
import os from "node:os";

const DEFAULT_URL = process.env.BOARD_URL || "https://board.pomogrow.top";

// ── 参数解析 ──
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (key === "json" || key === "md" || key === "help" || key === "h" || key === "quiet") out[key] = true;
      else out[key] = argv[++i];
    } else out._.push(a);
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const base = (args.url || DEFAULT_URL).replace(/\/+$/, "");
const AUTHOR = args.author || process.env.BOARD_AUTHOR || `agent@${os.hostname()}`;

const C = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  blue: "\x1b[34m", magenta: "\x1b[35m", cyan: "\x1b[36m", gray: "\x1b[90m",
};
const noColor = !process.stdout.isTTY || process.env.NO_COLOR;
const c = (col, s) => (noColor ? String(s) : C[col] + s + C.reset);
const useColor = !noColor;

const STATUS_ORDER = ["open", "discussing", "pending_review", "pending_done", "done", "archived"];

function die(msg, code = 1) {
  console.error(c("red", "✖ " + msg));
  process.exit(code);
}

async function req(path, opts = {}) {
  let res;
  try {
    res = await fetch(base + path, {
      ...opts,
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    });
  } catch (e) {
    die(`连不上留言板 ${base}\n  ${e.message}\n  （离线也能继续干活，但留言板上的问题你看不到了）`);
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* 非 JSON（如 --md 纯文本） */ }
  if (!res.ok) {
    const msg = (json && json.error) || text.slice(0, 300) || `HTTP ${res.status}`;
    die(`请求失败（HTTP ${res.status}）：${msg}`);
  }
  return json !== null ? json : text;
}
const get = (p) => req(p);
const post = (p, body) => req(p, { method: "POST", body: JSON.stringify(body) });

// ── 输出辅助 ──
function statusColor(key) {
  return { open: "yellow", discussing: "blue", pending_review: "magenta",
           pending_done: "cyan", done: "green", archived: "gray" }[key] || "gray";
}
function badge(key, label) {
  return c(statusColor(key), `[${label || key}]`);
}
function trunc(s, n) {
  s = String(s ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
function pad(s, n) {
  // 中文按 2 宽度算，终端里才对齐
  let w = 0;
  for (const ch of String(s)) w += /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(ch) ? 2 : 1;
  return String(s) + " ".repeat(Math.max(0, n - w));
}
const postUrl = (id) => `${base}/#/post/${id}`;

/** 两个维度取较高者显示旗帜（兼容只有 priority 的旧数据） */
function prioFlag(p) {
  const u = p.urgency != null ? p.urgency : (p.priority || 0);
  const s = p.severity != null ? p.severity : (p.priority || 0);
  const max = Math.max(u, s);
  return max === 2 ? c("red", "❗") : max === 1 ? c("yellow", "⭐") : "  ";
}

/** 终端的维度文字，例：急:紧急/重:严重 */
function prioText(p) {
  const u = p.urgency != null ? p.urgency : (p.priority || 0);
  const s = p.severity != null ? p.severity : (p.priority || 0);
  const ul = ["不急", "近期", "紧急"][u] || "?";
  const sl = ["轻微", "一般", "严重"][s] || "?";
  return c("gray", `〔急:${ul}/重:${sl}〕`);
}

// ══════════════════ 子命令 ══════════════════

async function cmdDigest() {
  if (args.md || !useColor) {
    const t = await req("/api/digest?format=md");
    console.log(t);
    return;
  }
  const d = await get("/api/digest");
  const s = await get("/api/statuses");
  const labels = Object.fromEntries(s.statuses.map((x) => [x.key, x.label]));

  console.log(c("bold", "🐘 留言板 · 待办速览  ") + c("gray", base));
  const stat = STATUS_ORDER.map((k) => {
    const n = d.by_status[k] || 0;
    return (n ? c(statusColor(k), `${labels[k]} ${n}`) : c("gray", `${labels[k]} 0`));
  }).join(c("gray", "  ·  "));
  console.log("   " + stat);
  console.log("");

  if (!d.pending.length) {
    console.log(c("green", "   ✓ 没有未完结的帖子 —— 干净，可以放心开工。"));
    return;
  }
  let cur = null;
  for (const p of d.pending) {
    if (p.status !== cur) {
      cur = p.status;
      console.log(c("bold", `   ${labels[cur] || cur}`));
    }
    const flag = prioFlag(p);
    console.log(`   ${flag} #${c("cyan", String(p.id))} ${prioText(p)} ${c("bold", trunc(p.title, 62))}`);
    console.log(c("gray", `        ${p.project_name} · ${p.author} · 评论 ${p.comment_count} · ${p.updated_at}`));
  }
  console.log("");
  console.log(c("gray", `   共 ${d.count} 条待跟进 · 看详情： node scripts/board/board.mjs read <id>`));
}

async function cmdList() {
  // /api/summary 的 projects 自 2026-10-11 起已带 post_count / last_activity，
  // 与 /api/projects 字段一致，一次请求就够。
  const s = await get("/api/summary");
  const projects = s.projects || [];
  if (args.json) return console.log(JSON.stringify(s, null, 2));
  const labels = Object.fromEntries(s.statuses.map((x) => [x.key, x.label]));
  console.log(c("bold", "🐘 留言板 · 项目总览  ") + c("gray", base));
  console.log("");
  console.log("   " + c("bold", pad("项目", 26) + pad("总帖", 6) + pad("待处理", 8) + pad("待评价", 8) + pad("待完成", 8) + "最近活动"));
  for (const p of projects) {
    const k = p.counts || {};
    const open = (k.open || 0) + (k.discussing || 0);
    const row = pad(`${p.name}`, 26) + pad(p.post_count || 0, 6) +
      pad(open || "-", 8) + pad(k.pending_review || "-", 8) + pad(k.pending_done || "-", 8) +
      (p.last_activity || "-");
    console.log("   " + row);
    console.log(c("gray", `   ${" ".repeat(3)}slug=${p.slug}`));
  }
  console.log("");
  const by = STATUS_ORDER.map((x) => `${labels[x]}=${s.by_status[x] || 0}`).join("  ");
  console.log(c("gray", `   全站：${by}   共 ${s.total_posts} 帖`));
}

async function cmdPosts() {
  const qs = new URLSearchParams();
  if (args.project) qs.set("project", args.project);
  if (args.status) qs.set("status", args.status);
  if (args.q) qs.set("q", args.q);
  qs.set("limit", args.limit || "50");
  const d = await get("/api/posts?" + qs);
  if (args.json) return console.log(JSON.stringify(d, null, 2));
  console.log(c("bold", `🐘 留言板 · 帖子（${d.total} 条）`));
  console.log("");
  if (!d.posts.length) { console.log(c("gray", "   （没有符合条件的帖子）")); return; }
  for (const p of d.posts) {
    const flag = prioFlag(p);
    console.log(`   ${flag} #${c("cyan", String(p.id))} ${badge(p.status, p.status_label)} ${prioText(p)} ${c("bold", trunc(p.title, 58))}`);
    console.log(c("gray", `        ${p.project_name} · ${p.author} · 评论 ${p.comment_count} · ${p.updated_at}` +
      (p.tags.length ? ` · ${p.tags.join(",")}` : "")));
  }
}

async function cmdRead() {
  const id = args._[1];
  if (!id) die("用法：read <id>");
  const d = await get("/api/posts/" + id);
  if (args.json) return console.log(JSON.stringify(d, null, 2));
  const p = d.post;
  console.log(c("bold", `#${p.id}  ${p.title}`));
  console.log("   " + badge(p.status, p.status_label) + c("gray", `  ${p.project_name} · 👤${p.author} · 创建 ${p.created_at} · 更新 ${p.updated_at}`));
  if (p.tags.length) console.log(c("gray", "   标签：" + p.tags.join(", ")));
  console.log("   " + c("gray", postUrl(p.id)));
  console.log("");
  if (p.body) {
    console.log(c("gray", "   ── 正文 ──"));
    for (const line of p.body.split("\n")) console.log("   " + line);
    console.log("");
  }
  console.log(c("gray", `   ── 讨论（${p.comments.length}）──`));
  if (!p.comments.length) console.log(c("gray", "   （还没有人评论）"));
  for (const cm of p.comments) {
    const col = { system: "magenta", answer: "green", question: "yellow", review: "magenta" }[cm.kind] || "blue";
    console.log(`   ${c(col, "▍")}${c("bold", cm.author)} ${c("gray", cm.kind + " · " + cm.created_at)}`);
    for (const line of cm.body.split("\n")) console.log("     " + line);
    console.log("");
  }
}

async function cmdPost() {
  if (!args.title) die('用法：post --title "标题" [--body "正文"] [--project slug] [--tags a,b] [--urgency 0|1|2] [--severity 0|1|2]');
  const legacy = args.priority ? parseInt(args.priority, 10) : 0;
  const urgency = args.urgency ? parseInt(args.urgency, 10) : legacy;
  const severity = args.severity ? parseInt(args.severity, 10) : legacy;
  const r = await post("/api/posts", {
    project: args.project || "",
    title: args.title,
    body: args.body || "",
    author: AUTHOR,
    tags: args.tags || "",
    urgency,
    severity,
  });
  if (args.json) return console.log(JSON.stringify(r, null, 2));
  console.log(c("green", `✔ 已发帖 #${r.id}`) + c("gray", `  ${r.title}`));
  console.log("   " + c("gray", r.url || postUrl(r.id)));
}

async function cmdComment() {
  const id = args._[1];
  if (!id || !args.body) die('用法：comment <id> --body "内容" [--kind comment|question|answer|review]');
  const r = await post(`/api/posts/${id}/comments`, {
    body: args.body, author: AUTHOR, kind: args.kind || "comment",
  });
  if (args.json) return console.log(JSON.stringify(r, null, 2));
  console.log(c("green", `✔ 已评论 #${r.post_id}（${r.kind}）`) + c("gray", `  作者 ${r.author}`));
}

async function cmdStatus() {
  const id = args._[1];
  const st = args._[2];
  if (!id || !st) die("用法：status <id> <open|discussing|pending_review|pending_done|done|archived> [--note \"...\"]");
  const r = await post(`/api/posts/${id}/status`, {
    status: st, author: AUTHOR, note: args.note || "",
  });
  if (args.json) return console.log(JSON.stringify(r, null, 2));
  if (r.unchanged) console.log(c("gray", `= #${r.id} 状态本来就是 ${r.status_label || st}`));
  else console.log(c("green", `✔ #${r.id} 状态：${r.from} → ${r.status_label}`) + c("gray", `  ${r.url || postUrl(r.id)}`));
}

async function cmdProject() {
  if (!args.slug || !args.name) die('用法：project --slug x --name "显示名" [--desc "..."]');
  const r = await post("/api/projects", {
    slug: args.slug, name: args.name, description: args.desc || "",
  });
  if (args.json) return console.log(JSON.stringify(r, null, 2));
  console.log(c("green", `✔ 已创建项目 ${r.slug}`) + c("gray", `  ${r.name}`));
}

function cmdOpen() {
  const id = args._[1];
  if (!id) die("用法：open <id>");
  console.log(postUrl(id));
}

function usage() {
  console.log(`
${c("bold", "🐘 留言板 CLI")}   ${c("gray", base)}

  digest                    一页速览：所有未完结的帖子（${c("bold", "工作前后先看这个")}）
  list                      项目（一级）总览 + 各状态计数
  posts [--project p] [--status s] [--q 词] [--limit n]
                            帖子列表（二级）
  read <id>                 帖子详情 + 全部评论
  post --title "..." [--project p] [--body "..."] [--tags a,b] [--urgency 0|1|2] [--severity 0|1|2]
                            发帖（提问 / 任何内容）
  comment <id> --body "..." [--kind comment|question|answer|review]
                            评论 / 回答 / 评价
  status <id> <状态> [--note "..."]
                            改状态并留一条系统评论
  project --slug x --name "..." [--desc "..."]
                            新建项目（一级）
  open <id>                 打印帖子网页地址

状态：open 待处理 · discussing 讨论中 · pending_review 待评价 · pending_done 待完成 · done 已完成 · archived 已归档

通用参数
  --author "名字"   默认 $BOARD_AUTHOR 或 agent@主机名（当前：${AUTHOR}）
  --json            输出原始 JSON
  --md              digest 输出纯 Markdown
  --url <地址>      覆盖服务地址（也可用环境变量 BOARD_URL）
`);
}

// ══════════════════ 入口 ══════════════════
(async () => {
  const cmd = args._[0] || "digest";
  try {
    switch (cmd) {
      case "digest": case "d": case "todo": await cmdDigest(); break;
      case "list": case "ls": case "projects": await cmdList(); break;
      case "posts": case "ls-posts": await cmdPosts(); break;
      case "read": case "show": case "get": await cmdRead(); break;
      case "post": case "new": case "ask": await cmdPost(); break;
      case "comment": case "reply": await cmdComment(); break;
      case "status": case "st": await cmdStatus(); break;
      case "project": case "newproject": await cmdProject(); break;
      case "open": cmdOpen(); break;
      case "help": case "h": case "--help": usage(); break;
      default:
        console.error(c("red", `✖ 未知命令：${cmd}`));
        usage();
        process.exit(1);
    }
  } catch (e) {
    die(e && e.message ? e.message : String(e));
  }
})();
