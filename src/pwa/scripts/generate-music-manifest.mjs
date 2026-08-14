/**
 * 生成音乐清单（music-manifest.json）
 *
 * 输入：music-player/music/*.mp3 + music-player/music/tags.json
 * 输出：src/pwa/public/music-manifest.json
 *
 * 规则：
 * - 3 首番茄钟主题曲 → source: "bundled"（内置离线）
 * - 其余曲目 → source: "library"（服务器曲库，托管于 start.pomogrow.top/music/）
 * - 标签取 tags.json（fallback 空）
 *
 * 部门：PWA部门 —— 2026-08 PWA 第一版
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 本脚本位于 <仓库根>/src/pwa/scripts/，上溯三级到仓库根
const ROOT = path.resolve(__dirname, "../../..");
const MUSIC_DIR = path.join(ROOT, "music-player", "music");
const TAGS_FILE = path.join(MUSIC_DIR, "tags.json");
const OUT_DIR = path.join(__dirname, "..", "public");
const OUT_FILE = path.join(OUT_DIR, "music-manifest.json");

const BUNDLED = new Set([
  "番茄倒数快一点 - 番茄钟.mp3",
  "番茄小宇宙 - 番茄钟.mp3",
  "Tick Tock, Take Control - 番茄钟.mp3",
]);

async function main() {
  let files = [];
  try {
    files = await readdir(MUSIC_DIR);
  } catch (e) {
    console.warn(`[manifest] 读取音乐目录失败，生成空清单: ${MUSIC_DIR}`, e.message);
  }

  let tags = {};
  try {
    tags = JSON.parse(await readFile(TAGS_FILE, "utf-8"));
  } catch {
    /* 无 tags.json 时全部无标签 */
  }
  // tags.json 结构：{ "_customTags": {标签名: 颜色}, "歌曲名.mp3": "标签名" }
  const customTags = tags._customTags ?? {};
  const songTags = { ...tags };
  delete songTags._customTags;

  const songs = files
    .filter((f) => f.toLowerCase().endsWith(".mp3"))
    .map((name) => {
      const tag = songTags[name] || null;
      const color = tag ? customTags[tag] ?? null : null;
      return {
        name,
        source: BUNDLED.has(name) ? "bundled" : "library",
        tag,
        color,
      };
    })
    .sort((a, b) => {
      // 内置曲目排最前，其余按名字
      if (a.source !== b.source) return a.source === "bundled" ? -1 : 1;
      return a.name.localeCompare(b.name, "zh");
    });

  const manifest = { version: Date.now(), songs };
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(manifest, null, 2), "utf-8");
  console.log(`[manifest] 已生成 ${OUT_FILE}: ${songs.length} 首（bundled ${songs.filter(s => s.source === "bundled").length} / library ${songs.filter(s => s.source === "library").length}）`);
}

main().catch((e) => {
  console.error("[manifest] 生成失败:", e);
  process.exit(1);
});
