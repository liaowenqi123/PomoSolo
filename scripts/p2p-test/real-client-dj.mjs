/**
 * 真实老客户端在环 · **反向**：真实 v4.7.12 应用当 **DJ（持有端）**，虚拟端当听众。
 *
 * 与 `real-client-compat.mjs` 互补：
 *   · 那个测"**老客户端当听众** ← 新 DJ"（已验证通过）
 *   · 本脚本测"**老客户端当 DJ** → 新听众"，即**真实 WebView2 当 P2P 发送方**
 *     —— 这条路径用虚拟端互测是覆盖不到的（werift ↔ WebView2 的收发方向不同）
 *
 * 为什么不让应用自己建房：建房要填房间名，而 UIA 只能 click、不能打字。
 * 所以改成**虚拟端建房（不申请 DJ）→ 应用加入 → 应用点「🎤 申请当 DJ」接管**，
 * 全程不需要在应用里输入任何文字。
 *
 * 用法：
 *   cd scripts/p2p-test
 *   node real-client-dj.mjs --seconds 420
 * 然后把应用加入打印出来的房间 ID，并点「🎤 申请当 DJ」。
 */
import { VirtualClient } from "./lib/client.js";
import { S2C } from "./lib/protocol.js";
import { testUser, ensureUser } from "./auth.js";

const args = (() => {
  const a = process.argv.slice(2);
  const get = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  return {
    ws: get("--ws", "wss://api.pomogrow.top"),
    seconds: Number(get("--seconds", 420)),
    // --room：复用**已存在**的房间（应用已在里面当 DJ）→ 跳过建房，直接等状态并拉歌。
    // 免得每次都要等满 --seconds 才发起传输。
    room: get("--room", null),
    verbose: a.includes("--verbose"),
  };
})();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const me = testUser(1);
const u = await ensureUser(me.username, me.password);
const listener = new VirtualClient({ label: "虚拟听众", wsBase: args.ws, verbose: args.verbose });
listener.id = u.id; listener.username = u.username; listener.token = u.token;
await listener.connect();

// 建房但**不申请 DJ** —— 把 DJ 位留给真实应用
const roomId = args.room ?? await listener.createRoom(`real-client-dj-${Date.now()}`);
if (args.room) {
  await listener.joinRoom(roomId);
  listener.send("music:request_state", {});   // 主动要一次当前状态
  console.log(`\n  复用房间 ${roomId}，等待 DJ 状态…\n`);
} else {
  console.log("\n" + "═".repeat(74));
  console.log("  虚拟端已建房（未申请 DJ，DJ 位留给真实应用）");
  console.log(`  房间 ID：${roomId}`);
  console.log("═".repeat(74));
  console.log("\n  ★ 请在真实 v4.7.12 应用里：自习室 → 🚪 加入自习室 → 选这个房间");
  console.log("     加入后点「🎤 申请当 DJ」，再让它播放一首歌\n");
}

// 等应用加入并当上 DJ
// ⚠️ 字段名必须与服务器一致：`{ dj_user_id, dj_username }`（不是 user_id/username）。
//    替身漏一个字段就会得出"服务器有 bug"的错误结论 —— 已在 lib/client.js 里记过一次教训。
let djId = null;
listener.on(S2C.DJ_CHANGED, (m) => {
  if (m.dj_user_id && m.dj_user_id !== listener.id) {
    djId = m.dj_user_id;
    console.log(`  ← 应用已成为 DJ：${m.dj_username ?? m.dj_user_id?.slice(0, 8)}`);
  }
});

// 等 DJ 的 sync_state 出现，从中得知它在放哪首歌
let song = null;
listener.on(S2C.SYNC_STATE, (m) => {
  if (typeof m.song_id === "string" && m.song_id && m.song_id !== song) {
    song = m.song_id;
    console.log(`  ← DJ 正在放：${song}（playing=${m.playing}）`);
  }
});

const t0 = Date.now();
const total = args.seconds * 1000;
while (Date.now() - t0 < total) {
  await sleep(5000);
  const left = Math.ceil((total - (Date.now() - t0)) / 1000);
  console.log(`  · 剩余 ${left}s | DJ=${djId ? djId.slice(0, 8) + "…" : "（还没人当 DJ）"} | 曲目=${song ?? "（未知）"}`);
}

console.log("\n" + "═".repeat(74));
if (!djId || !song) {
  console.log("  ⚠️ 未能完成：应用是否加入了房间、是否点了「🎤 申请当 DJ」、是否在播放？");
} else {
  console.log(`  开始从真实应用拉歌：${song}`);
  const t = Date.now();
  const r = await listener.fetchSong(song, { p2p: true, timeoutMs: 180000 });
  console.log(`  结果：ok=${r.ok} path=${r.path} 字节=${r.bytes} 耗时=${Date.now() - t}ms`);
  console.log(`  sha256=${r.sha256}`);
  console.log(`  ${r.ok ? "✅ 新听众从真实老 DJ 拿到了完整歌曲" : "❌ 失败：" + (r.reason ?? "")}`);
  console.log("\n  请与真实应用曲库里的同名文件比对 sha256：");
  console.log("    %APPDATA%\\com.pomosolo.app\\music\\" + song);
}
console.log("═".repeat(74) + "\n");

try { listener.leaveRoom(roomId); } catch { /* ignore */ }
await sleep(300);
listener.close();
process.exit(0);
