/**
 * 真实老客户端在环：**虚拟 DJ（新方言）→ 真实 v4.7.12 应用（老客户端）**
 *
 * 为什么需要它（这是 `compat-v4712` 场景**覆盖不到**的那一半）：
 *   `compat-v4712` 里的"老客户端"是**我写的虚拟端**，只能验证**服务器**与老方言互通。
 *   而"**v4.7.12 应用本体能否容忍新消息**"只能靠读源码推断 —— 除非把真应用跑起来。
 *
 * 本脚本做后者：虚拟 DJ 建房间、当 DJ、放 `Are you lost.mp3`（应用曲库里**没有**这首，
 * 所以"文件是否落盘"就是**可观测的成功判据**），广播里带 v4.12 新增的 `next_song_id`。
 * 然后你把真实应用加入这个房间 —— 老客户端若容忍该字段，就会正常把歌拉下来并播放。
 *
 * 用法：
 *   cd scripts/p2p-test
 *   node real-client-compat.mjs --seconds 240
 *
 * 它会把房间 ID 打在最显眼的位置，并持续打印：
 *   · 收到的 music:request_song / song_requested（证明应用真的来要歌了）
 *   · 应用请求的是哪首歌、走 P2P 还是中转
 * 结束时打印结论。
 */
import { fileURLToPath } from "node:url";
import { VirtualClient } from "./lib/client.js";
import { C2S, S2C } from "./lib/protocol.js";
import { testUser, ensureUser } from "./auth.js";

const args = (() => {
  const a = process.argv.slice(2);
  const get = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  return {
    ws: get("--ws", "wss://api.pomogrow.top"),
    seconds: Number(get("--seconds", 240)),
    song: get("--song", "Are you lost.mp3"),
    // 曲名与文件路径解耦：用一个**应用绝对没有的曲名**，才能靠"文件是否新落盘"判定成功。
    // ⚠️ 踩过：一开始用 `Are you lost.mp3`，结果应用曲库里**本来就有**它，
    // 于是"文件存在"看起来像成功，实际什么都没传（靠时间戳才发现）。
    songPath: get("--song-path", null),
    /*
     * `--next-song`：让 DJ 在广播里预告"下一首"，并**也把这首歌挂上服务**。
     *
     * 这是**预取功能的真机判据**：DJ 全程只放 `--song`、**永不切歌**，
     * 所以"下一首"的文件出现在应用曲库里**只可能来自预取**。
     * 用 4.8.0 客户端跑，就能证明新版本的预取真的在工作。
     */
    nextSong: get("--next-song", null),
    nextSongPath: get("--next-song-path", null),
    verbose: a.includes("--verbose"),
  };
})();

const SONG_PATH = args.songPath
  ? fileURLToPath(new URL(args.songPath, import.meta.url))
  : fileURLToPath(new URL(`../../music-player/music/${args.song}`, import.meta.url));
const NEXT_SONG_PATH = args.nextSong
  ? (args.nextSongPath
      ? fileURLToPath(new URL(args.nextSongPath, import.meta.url))
      : fileURLToPath(new URL(`../../music-player/music/${args.nextSong}`, import.meta.url)))
  : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const djUser = testUser(1);
const user = await ensureUser(djUser.username, djUser.password);
const dj = new VirtualClient({ label: "虚拟DJ", wsBase: args.ws, verbose: args.verbose });
dj.id = user.id; dj.username = user.username; dj.token = user.token;
await dj.connect();

const roomId = await dj.createRoom(`real-client-compat-${Date.now()}`);
await dj.requestDj();

const served = dj.startServing(args.song, SONG_PATH, { p2p: true, djBroadcast: true });
// 下一首也要挂上服务 —— 否则应用来预取时会找不到持有者
const servedNext = args.nextSong ? dj.startServing(args.nextSong, NEXT_SONG_PATH, { p2p: true }) : null;
// ★ 关键：广播里带上 next_song_id。老客户端（v4.7.12）不认识该字段、会忽略；
//   新客户端（v4.8.0）应当据此**在当前歌还在播时就预取它**。
dj.startDjPlayback(args.song, {
  positionMs: 0, transferMode: "immediate", broadcastEveryMs: 5000,
  nextSongId: args.nextSong ?? "【v4.12 新字段】这是老客户端不该认识的下一首.mp3",
});

console.log("\n" + "═".repeat(72));
console.log("  虚拟 DJ 已就绪（广播里带 v4.12 新增的 next_song_id）");
console.log(`  正在放：${args.song}（${served.size} 字节）`);
if (args.nextSong) console.log(`  预告下一首：${args.nextSong}（${servedNext.size} 字节）—— **全程不会切歌**`);
console.log(`  房间 ID：${roomId}`);
console.log("═".repeat(72));
console.log("\n  ★ 请在真实应用里：自习室 → 🚪 加入自习室 → 选这个房间 → 开启同步\n");

// 记录应用侧的活动 —— 这些是"老客户端真的来要歌了"的证据
let requestCount = 0;
let p2pRequestCount = 0;
dj.on(S2C.SONG_REQUESTED, (m) => {
  requestCount++;
  if (m.p2p) p2pRequestCount++;
  console.log(`  ← [${new Date().toLocaleTimeString()}] 应用请求传歌：`
    + `requester=${m.requester_user_id?.slice(0, 8)}… p2p=${!!m.p2p} from_chunk=${m.from_chunk ?? 0}`);
});

const t0 = Date.now();
const total = args.seconds * 1000;
while (Date.now() - t0 < total) {
  await sleep(5000);
  const left = Math.ceil((total - (Date.now() - t0)) / 1000);
  const st = dj._playback;
  if (args.verbose || requestCount > 0) {
    console.log(`  · 剩余 ${left}s | 应用请求 ${requestCount} 次（其中带 p2p ${p2pRequestCount}）`
      + ` | 已服务 ${served.transfers ?? 0} 次 | 我在放 ${st.songId} @ ${Math.floor(dj._currentPositionMs() / 1000)}s`);
  } else {
    console.log(`  · 剩余 ${left}s | 还没收到应用请求（是否已加入房间 ${roomId}？）`);
  }
}

console.log("\n" + "═".repeat(72));
console.log("  结论");
console.log("═".repeat(72));
console.log(`  应用请求传歌次数：${requestCount}（带 p2p：${p2pRequestCount}）`);
console.log(`  DJ 实际服务次数：${served.transfers ?? 0}`);
if (requestCount === 0) {
  console.log("  ⚠️ 应用从未请求传歌 —— 检查它是否加入了房间、是否开启了同步听歌");
} else {
  console.log("  ✅ 老客户端（v4.7.12）能正常向新 DJ 请求传歌，未被 next_song_id 等新字段影响");
}
console.log("  另请在应用曲库目录确认是否出现（真身 %APPDATA%\com.pomosolo.app\music\）：" + args.song);
console.log("    %LOCALAPPDATA%\\PomoSolo\\music\\\n");

try { dj.leaveRoom(roomId); } catch { /* ignore */ }
await sleep(300);
dj.close();
process.exit(0);
