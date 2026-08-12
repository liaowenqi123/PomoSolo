#!/usr/bin/env node
/**
 * 番茄钟备用原创纯音乐生成脚本
 *
 * 通过本地 ComfyUI 的 stable-audio-3-medium 工作流生成无版权纯音乐，
 * 产出到 music-player/generated-music/（git 追踪，不进安装包）。
 *
 * 用法：
 *   node scripts/generate-music.mjs                 # 生成全部歌曲
 *   node scripts/generate-music.mjs --limit 3       # 只生成前 3 首
 *   node scripts/generate-music.mjs --duration 150  # 覆盖时长（秒）
 *   node scripts/generate-music.mjs --out <目录>    # 自定义输出目录
 *
 * 环境变量：
 *   COMFY_URL       ComfyUI 地址（默认 http://127.0.0.1:8188）
 *   WORKFLOW_PATH   工作流 JSON 路径（默认下载文件夹里那份）
 */
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const COMFY = process.env.COMFY_URL || "http://127.0.0.1:8188";
const WORKFLOW_PATH =
  process.env.WORKFLOW_PATH ||
  "C:\\Users\\admin\\Downloads\\audio_stable_audio_3_medium.json";
const OUT_DIR = process.env.OUT_DIR || join(ROOT, "music-player", "generated-music");

// 节点 ID（工作流固定）
const NODE_DESC = "52:31"; // PrimitiveStringMultiline：用户短描述
const NODE_SEED = "52:3"; // KSampler：随机种子
const NODE_DUR = "52:36"; // PrimitiveFloat：时长（秒）

// ===== 歌曲目录（歌名 / 描述 / 标签 / 时长秒） =====
const SONGS = [
  // relax 放松
  { name: "云上漂流 Cloud Drift", desc: "soft dreamy ambient with gentle piano, airy pads and slow warm strings for floating relaxation", tag: "relax 放松", duration: 150 },
  { name: "午后暖阳 Afternoon Sunbeam", desc: "warm acoustic guitar fingerpicking with soft shaker and mellow pads for cozy afternoon relaxation", tag: "relax 放松", duration: 150 },
  { name: "清风拂面 Gentle Breeze", desc: "peaceful nature-inspired instrumental with soft flute, wind textures and gentle piano for calm relaxation", tag: "relax 放松", duration: 150 },
  // study 学习
  { name: "笔尖沙沙 Pen Scratch", desc: "light lo-fi hip hop with mellow electric piano, vinyl crackle and soft boom bap drums for studying", tag: "study 学习", duration: 150 },
  { name: "知识星河 Galaxy of Knowledge", desc: "calm electronic study beats with warm synth pads, gentle arpeggios and steady soft drums for focused learning", tag: "study 学习", duration: 150 },
  { name: "图书馆时光 Library Hours", desc: "soft academic jazz with piano chords, upright bass and brushed drums for quiet library study", tag: "study 学习", duration: 150 },
  // workout 运动
  { name: "热血跑道 Racing Track", desc: "energetic electronic workout track with driving four-on-the-floor kick, pumping bass and uplifting synth hooks", tag: "workout 运动", duration: 150 },
  { name: "力量觉醒 Power Awakening", desc: "high energy rock fitness track with distorted guitars, punchy drums and powerful anthemic energy", tag: "workout 运动", duration: 150 },
  { name: "心跳加速 Accelerated Heartbeat", desc: "fast-paced EDM exercise track with pulsing synths, aggressive drop and high-tempo percussion", tag: "workout 运动", duration: 150 },
  // reading 阅读
  { name: "书页之间 Between the Pages", desc: "delicate acoustic fingerstyle guitar with subtle reverb and occasional soft strings for quiet reading", tag: "reading 阅读", duration: 150 },
  { name: "静谧书房 Quiet Study Nook", desc: "minimal piano with warm felted tone and soft string pads for intimate peaceful reading", tag: "reading 阅读", duration: 150 },
  // focus 专注
  { name: "深度专注 Deep Focus", desc: "minimal ambient techno with steady pulse, filtered textures and hypnotic repeating patterns for deep concentration", tag: "focus 专注", duration: 150 },
  { name: "心流时刻 Flow State", desc: "steady electronic focus track with clean synth melodies, calm rhythmic groove and spacious atmosphere", tag: "focus 专注", duration: 150 },
  { name: "时间之沙 Sand of Time", desc: "slow ambient rhythm with deep soft drums, warm pads and meditative tones for sustained focus work", tag: "focus 专注", duration: 150 },
  // night 深夜
  { name: "午夜霓虹 Midnight Neon", desc: "synthwave night drive track with arpeggiated analog synths, gated reverb snares and retro electric bass", tag: "night 深夜", duration: 150 },
  { name: "星光低语 Starry Whisper", desc: "nocturnal ambient with twinkling bells, slow piano and airy pads for quiet late night", tag: "night 深夜", duration: 150 },
  // coding 编程
  { name: "代码之光 Code Glow", desc: "upbeat electronic coding track with clean synth leads, tight digital percussion and smooth bass groove", tag: "coding 编程", duration: 150 },
  { name: "逻辑迷宫 Logic Labyrinth", desc: "techy synth instrumental with precise arpeggios, rhythmic bleeps and subtle sci-fi atmosphere for programming", tag: "coding 编程", duration: 150 },
  { name: "键盘交响乐 Keyboard Symphony", desc: "rhythmic electronic track for developers with steady hi-hats, layered synth lines and focused momentum", tag: "coding 编程", duration: 150 },
  // sleep 睡眠
  { name: "月光摇篮 Moonlight Cradle", desc: "gentle lullaby music box melody with soft metallic tones, slow arpeggios and dreamy reverb for sleep", tag: "sleep 睡眠", duration: 150 },
  { name: "深海入眠 Deep Sea Slumber", desc: "slow ambient drone with soft underwater textures, distant bells and gentle wash for falling asleep", tag: "sleep 睡眠", duration: 150 },
  // cafe 咖啡
  { name: "咖啡时光 Coffee Time", desc: "cozy cafe jazz with smooth piano, soft brushed drums and warm double bass for a relaxed coffee break", tag: "cafe 咖啡", duration: 150 },
  { name: "烘焙香气 Roasted Aroma", desc: "smooth bossa nova instrumental with nylon guitar, light percussion and mellow keys for cafe ambience", tag: "cafe 咖啡", duration: 150 },
  // creativity 创作
  { name: "灵感火花 Spark of Inspiration", desc: "dreamy indie electronic with shimmering keys, soft pad swells and delicate rhythms for creative flow", tag: "creativity 创作", duration: 150 },
  { name: "笔绘星河 Painting the Galaxy", desc: "imaginative ambient track with evolving pads, gentle bells and cinematic sweeps for creative work", tag: "creativity 创作", duration: 150 },
];

// 标签配色（写入 tags.json 的 _customTags）
const TAG_COLORS = {
  "relax 放松": "#7ec8ff",
  "study 学习": "#64b4ff",
  "workout 运动": "#ff9664",
  "reading 阅读": "#b4a0ff",
  "focus 专注": "#ffb84d",
  "night 深夜": "#6e7bff",
  "coding 编程": "#4dd0a8",
  "sleep 睡眠": "#9db8ff",
  "cafe 咖啡": "#c8906e",
  "creativity 创作": "#ff8ac2",
};

function parseArgs(argv) {
  const opts = { limit: Infinity };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit") opts.limit = parseInt(argv[i + 1], 10);
    if (argv[i] === "--duration") opts.duration = parseInt(argv[i + 1], 10);
    if (argv[i] === "--out") opts.out = argv[i + 1];
  }
  return opts;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function submitPrompt(workflow) {
  const res = await fetch(`${COMFY}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`提交失败: ${JSON.stringify(data.error || data)}`);
  }
  return data.prompt_id;
}

async function waitForDone(promptId) {
  for (;;) {
    const res = await fetch(`${COMFY}/history/${promptId}`);
    const h = await res.json();
    const entry = h[promptId];
    if (entry) {
      const status = entry.status || {};
      if (status.status_str === "error") {
        throw new Error(`生成出错: ${JSON.stringify(status.messages || status)}`);
      }
      if (status.completed || status.status_str === "success") {
        return entry.outputs || {};
      }
    }
    await sleep(3000);
  }
}

async function downloadOutput(outputs) {
  for (const nodeId of Object.keys(outputs)) {
    const out = outputs[nodeId];
    const audio = out && out.audio && out.audio[0];
    if (audio) {
      const qs = `filename=${encodeURIComponent(audio.filename)}&subfolder=${encodeURIComponent(audio.subfolder || "")}&type=${audio.type || "output"}`;
      const r = await fetch(`${COMFY}/view?${qs}`);
      if (!r.ok) throw new Error(`下载失败: HTTP ${r.status}`);
      return { buffer: Buffer.from(await r.arrayBuffer()), filename: audio.filename };
    }
  }
  throw new Error("输出中未找到音频");
}

function sanitize(name) {
  return name.replace(/[\\/:*?"<>|]/g, "").trim();
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const outDir = opts.out || OUT_DIR;
  mkdirSync(outDir, { recursive: true });

  if (!existsSync(WORKFLOW_PATH)) {
    console.error(`找不到工作流文件: ${WORKFLOW_PATH}`);
    process.exit(1);
  }
  const template = JSON.parse(readFileSync(WORKFLOW_PATH, "utf8"));

  const songs = SONGS.slice(0, opts.limit);
  console.log(`[generate-music] 工作流: ${WORKFLOW_PATH}`);
  console.log(`[generate-music] 输出目录: ${outDir}`);
  console.log(`[generate-music] 本次生成 ${songs.length} 首`);

  const done = [];
  for (let i = 0; i < songs.length; i++) {
    const song = songs[i];
    const duration = opts.duration || song.duration;
    const seed = Math.floor(Math.random() * 0xffffffff);
    const file = `${sanitize(song.name)}.mp3`;
    console.log(`\n[${i + 1}/${songs.length}] ${file} (${duration}s) 标签「${song.tag}」`);

    // 基于模板构造本次请求（每次深拷贝避免串改）
    const wf = JSON.parse(JSON.stringify(template));
    wf[NODE_DESC].inputs.value = song.desc;
    wf[NODE_SEED].inputs.seed = seed;
    wf[NODE_DUR].inputs.value = duration;

    const t0 = Date.now();
    const promptId = await submitPrompt(wf);
    console.log(`      队列号 ${promptId} 已提交，等待生成...`);
    const outputs = await waitForDone(promptId);
    const { buffer, filename } = await downloadOutput(outputs);

    // 校验 2-3 分钟目标（如有完整版 ffprobe 则输出真实时长）
    const dest = join(outDir, file);
    writeFileSync(dest, buffer);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    let realDur = "";
    if (process.env.FFPROBE) {
      const { execFileSync } = await import("node:child_process");
      try {
        const out = execFileSync(process.env.FFPROBE, [
          "-v", "error", "-show_entries", "format=duration",
          "-of", "default=noprint_wrappers=1:nokey=1", dest,
        ], { encoding: "utf8" }).trim();
        realDur = `, 实际时长 ${out}s`;
      } catch { realDur = ", 时长校验失败(ffprobe 不可用)"; }
    }
    console.log(`      ✓ 已保存 ${file} (${buffer.length} 字节, 源文件 ${filename}, 耗时 ${secs}s${realDur})`);
    done.push({ file, name: song.name, tag: song.tag, duration, seed });
  }

  // ===== 写 tags.json（与 app 音乐目录格式一致） =====
  const tags = { _customTags: { ...TAG_COLORS } };
  for (const s of done) {
    tags[s.file] = { name: s.tag, color: TAG_COLORS[s.tag] };
  }
  const tagsPath = join(outDir, "tags.json");
  writeFileSync(tagsPath, JSON.stringify(tags, null, 2) + "\n");
  console.log(`\n[generate-music] 完成 ${done.length} 首，tags.json 已写入 ${tagsPath}`);
}

main().catch((err) => {
  console.error(`[generate-music] 失败: ${err.message || err}`);
  process.exit(1);
});
