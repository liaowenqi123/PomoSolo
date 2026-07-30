/**
 * 构建前资源准备脚本
 *
 * Tauri 打包 resources 时不支持 `..` 路径（会被替换为 `_up_/` 子目录），
 * 导致安装后 music.exe 位于 resource_dir/_up_/music-player/music.exe，
 * 而代码期望 resource_dir/music.exe。
 *
 * 本脚本在 vite build 前把所需资源复制到 src-tauri/resources/ 下，
 * 让 tauri.conf.json 用不带 `..` 的路径引用，确保打包后目录结构正确。
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const SRC_MUSIC_PLAYER = join(root, "music-player");
const DEST_RESOURCES = join(root, "src-tauri", "resources");

// 清理旧的 resources 目录（避免残留旧文件）
if (existsSync(DEST_RESOURCES)) {
  rmSync(DEST_RESOURCES, { recursive: true, force: true });
}
mkdirSync(DEST_RESOURCES, { recursive: true });

// 1. 复制 music.exe（Python 子进程，PyInstaller 产物）
const musicExeSrc = join(SRC_MUSIC_PLAYER, "music.exe");
const musicExeDest = join(DEST_RESOURCES, "music.exe");
if (!existsSync(musicExeSrc)) {
  console.error(`[copy-resources] 错误: 未找到 ${musicExeSrc}`);
  console.error(`[copy-resources] 请先在 music-player/ 目录下运行: pyinstaller --onefile music.py`);
  process.exit(1);
}
copyFileSync(musicExeSrc, musicExeDest);
console.log(`[copy-resources] ✓ music.exe -> ${musicExeDest}`);

// 2. 复制内置三首歌（* - 番茄钟.mp3）+ tags.json 到 resources/music/
const musicDirSrc = join(SRC_MUSIC_PLAYER, "music");
const musicDirDest = join(DEST_RESOURCES, "music");
mkdirSync(musicDirDest, { recursive: true });

if (existsSync(musicDirSrc)) {
  const builtinSongs = readdirSync(musicDirSrc).filter(
    (f) => f.endsWith(" - 番茄钟.mp3") || f === "tags.json",
  );
  for (const file of builtinSongs) {
    const src = join(musicDirSrc, file);
    const dest = join(musicDirDest, file);
    copyFileSync(src, dest);
    console.log(`[copy-resources] ✓ ${file} -> ${dest}`);
  }
  if (builtinSongs.length === 0) {
    console.warn(`[copy-resources] 警告: music-player/music/ 下未找到内置歌曲`);
  }
} else {
  console.warn(`[copy-resources] 警告: ${musicDirSrc} 不存在，跳过内置歌曲复制`);
}

console.log("[copy-resources] 资源准备完成");
