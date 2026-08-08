<script setup lang="ts">
/**
 * P2P 连通性测试工具（Phase 1.2+，v4.7.7 升级为"3 种打洞方式 × 双向测速"）
 *
 * 选择一位在线用户，一次点击跑 6 项测试（3 打洞方式 × 每管道上行/下行）：
 *  1. A 打洞：本机（A）作 offerer 打通 → 测 A→B（上行）+ B→A（下行）
 *  2. B 打洞：对端（B）作 offerer 打通 → 测 B→A（下行）+ A→B（上行）
 *  3. AB 互相打洞：两端**同时**各打一条连接（A offerer + B offerer）→ 双向同时测
 * 目标端自动配合（music store 监听 p2p:*_test_request），无需打开本面板。
 * 结论：对比三种打洞方式的"双向总吞吐"，标记洞质量最好的一种。
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useAuthStore } from "@/stores/auth";
import {
  p2pOnline,
  p2pTestRequest,
  p2pReverseTestRequest,
  p2pBidirTestRequest,
  type P2POnlineUser,
} from "@/api/p2pTest";
import { p2pSend, p2pReceive, setP2PTestResultHandler } from "@/p2p";

/** 单个方向（上行/下行）测速结果 */
interface DirStat {
  ok: boolean;
  speedBps: number;
  ms: number;
  error: string;
}
/** 一种打洞方式的管道测试结果：up=A→B，down=B→A */
interface PunchResult {
  punchOk: boolean;
  up: DirStat;
  down: DirStat;
}
/** duplex 一程的速率统计（与 p2p 层 onDuplexComplete 的 stats 对应） */
interface SpeedStat {
  bytes: number;
  ms: number;
  speedBps: number;
}

const auth = useAuthStore();
const loggedIn = computed(() => !!auth.session);

const emit = defineEmits<{ login: [] }>();

const users = ref<P2POnlineUser[]>([]);
const loading = ref(false);
const loadError = ref("");
const testing = ref<P2POnlineUser | null>(null);
const progress = ref(0);
const diagnostics = ref<string[]>([]);
/** 当前阶段文案（进度展示） */
const currentStage = ref("");
/** 3 种打洞方式的结果 */
const punchResults = ref<{ a: PunchResult; b: PunchResult; c: PunchResult }>({
  a: { punchOk: false, up: emptyDir(), down: emptyDir() },
  b: { punchOk: false, up: emptyDir(), down: emptyDir() },
  c: { punchOk: false, up: emptyDir(), down: emptyDir() },
});
/** 目标端回传的确认（对方视角速率，可选展示） */
const remoteResult = ref<DirStat | null>(null);
/** 全部 6 项是否已出结果（用于展示结论） */
const allDone = ref(false);

/** 测试数据量：2MB/程（与旧版一致，够测速） */
const TEST_BYTES = 2 * 1024 * 1024;
const TEST_CHUNK = 64 * 1024;

/** 在线用户 ID 短显（前 8 位）；字段缺失时容错，避免渲染崩溃 */
function shortId(id: string | undefined): string {
  if (!id) return "";
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function fmtSpeed(bps: number): string {
  if (bps >= 1024 * 1024) return `${(bps / 1024 / 1024).toFixed(2)} MB/s`;
  if (bps >= 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${bps} B/s`;
}

function emptyDir(): DirStat {
  return { ok: false, speedBps: 0, ms: 0, error: "" };
}

/** 一键复制诊断日志（全局 user-select:none，鼠标选中不便 → 提供复制按钮） */
async function copyDiagnostics(): Promise<void> {
  const text = diagnostics.value.join("\n");
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // WebView2 旧版/无权限时回退到临时 textarea
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

async function refresh(): Promise<void> {
  if (!loggedIn.value) return;
  loading.value = true;
  loadError.value = "";
  try {
    // 8s 超时兜底：WS 请求默认 15s 太久，服务器未响应时界面长时间空白
    users.value = await Promise.race([
      p2pOnline(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("请求超时（服务器未响应，请检查网络/登录状态）")), 8000),
      ),
    ]);
  } catch (e) {
    loadError.value = String(e);
  } finally {
    loading.value = false;
  }
}

function dirFrom(s: SpeedStat): DirStat {
  return { ok: true, speedBps: s.speedBps, ms: s.ms, error: "" };
}
function dirFail(err: string): DirStat {
  return { ok: false, speedBps: 0, ms: 0, error: err };
}

/**
 * 一次 duplex 双向测速（同一连接上测上行+下行）：
 * - role="offerer"：本机打洞，先推（self）再收（peer）
 * - role="answerer"：对端打洞，先收（peer）再推（self）
 * offerer 延迟 400ms 发起，给对端收到请求并挂起的时间（防 offer 早到被丢弃）。
 */
function duplexOnce(
  u: P2POnlineUser,
  cfg: { role: "offerer" | "answerer"; tag: string },
): Promise<{ ok: true; self: SpeedStat; peer: SpeedStat } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: { ok: true; self: SpeedStat; peer: SpeedStat } | { ok: false; error: string }) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const start = () => {
      const opts = {
        peerId: u.userId,
        role: cfg.role,
        mode: "duplex-test" as const,
        tag: cfg.tag,
        timeoutMs: 15_000,
        bytes: TEST_BYTES,
        chunkSize: TEST_CHUNK,
        onDiagnose: (info: string) => {
          diagnostics.value.push(`[${cfg.tag}] ${info}`);
        },
        callbacks: {
          onProgress: (p: number) => {
            progress.value = p;
          },
          onDuplexComplete: (stats: { self: SpeedStat | null; peer: SpeedStat | null }) => {
            if (stats.self && stats.peer) {
              finish({ ok: true, self: stats.self, peer: stats.peer });
            } else {
              finish({ ok: false, error: "双向测速未完整完成" });
            }
          },
          onError: (err: string) => {
            finish({ ok: false, error: err });
          },
        },
      };
      if (cfg.role === "offerer") p2pSend(opts);
      else p2pReceive(opts);
    };
    if (cfg.role === "offerer") {
      // 给对端收到 test_request / bidir_test_request 并挂起的时间（offer 竞态防护）
      window.setTimeout(start, 400);
    } else {
      start();
    }
  });
}

async function runTest(u: P2POnlineUser): Promise<void> {
  if (testing.value) return;
  testing.value = u;
  progress.value = 0;
  diagnostics.value = [];
  allDone.value = false;
  remoteResult.value = null;
  punchResults.value = {
    a: { punchOk: false, up: emptyDir(), down: emptyDir() },
    b: { punchOk: false, up: emptyDir(), down: emptyDir() },
    c: { punchOk: false, up: emptyDir(), down: emptyDir() },
  };

  // ── 阶段 1：A 打洞（本机 A 作 offerer，tag="a"）──
  // self = A→B（上行），peer = B→A（下行）
  currentStage.value = "A 打洞（1/3）";
  await p2pTestRequest(u.userId, "a").catch((e) => {
    console.warn("[P2PTest] 发送 A 打洞请求失败:", e);
  });
  const r1 = await duplexOnce(u, { role: "offerer", tag: "a" });
  punchResults.value.a = {
    punchOk: r1.ok,
    up: r1.ok ? dirFrom(r1.self) : dirFail(r1.error),
    down: r1.ok ? dirFrom(r1.peer) : dirFail(r1.error),
  };
  if (!r1.ok) diagnostics.value.push(`[A 打洞] 失败：${r1.error}`);

  // ── 阶段 2：B 打洞（对端 B 作 offerer，tag="b"）──
  // self = A→B（上行，本机后推），peer = B→A（下行，对端先推）
  currentStage.value = "B 打洞（2/3）";
  await p2pReverseTestRequest(u.userId, "b").catch((e) => {
    console.warn("[P2PTest] 发送 B 打洞请求失败:", e);
  });
  const r2 = await duplexOnce(u, { role: "answerer", tag: "b" });
  punchResults.value.b = {
    punchOk: r2.ok,
    up: r2.ok ? dirFrom(r2.self) : dirFail(r2.error),
    down: r2.ok ? dirFrom(r2.peer) : dirFail(r2.error),
  };
  if (!r2.ok) diagnostics.value.push(`[B 打洞] 失败：${r2.error}`);

  // ── 阶段 3：AB 互相打洞（两条连接同时打，tag="c1"/"c2"）──
  // C1：本机 offerer → self = A→B（上行）；C2：本机 answerer → peer = B→A（下行）
  currentStage.value = "AB 互相打洞（3/3）";
  await p2pBidirTestRequest(u.userId, "c1", "c2").catch((e) => {
    console.warn("[P2PTest] 发送 AB 互相打洞请求失败:", e);
  });
  const [r3a, r3b] = await Promise.all([
    duplexOnce(u, { role: "offerer", tag: "c1" }),
    duplexOnce(u, { role: "answerer", tag: "c2" }),
  ]);
  punchResults.value.c = {
    punchOk: r3a.ok || r3b.ok,
    up: r3a.ok ? dirFrom(r3a.self) : r3b.ok ? dirFrom(r3b.self) : dirFail(`C1:${r3a.error}`),
    down: r3b.ok ? dirFrom(r3b.peer) : r3a.ok ? dirFrom(r3a.peer) : dirFail(`C2:${r3b.error}`),
  };
  if (!r3a.ok) diagnostics.value.push(`[AB-C1] 失败：${r3a.error}`);
  if (!r3b.ok) diagnostics.value.push(`[AB-C2] 失败：${r3b.error}`);

  currentStage.value = "全部完成";
  allDone.value = true;
  testing.value = null;
}

/** 结论：三种打洞方式双向总吞吐对比，标记质量最高的一种 */
const conclusion = computed(() => {
  if (!allDone.value) return "";
  const rows = [
    { key: "a", label: "A 打洞", total: punchResults.value.a.up.speedBps + punchResults.value.a.down.speedBps, ok: punchResults.value.a.punchOk },
    { key: "b", label: "B 打洞", total: punchResults.value.b.up.speedBps + punchResults.value.b.down.speedBps, ok: punchResults.value.b.punchOk },
    { key: "c", label: "AB 互相打洞", total: punchResults.value.c.up.speedBps + punchResults.value.c.down.speedBps, ok: punchResults.value.c.punchOk },
  ];
  const okRows = rows.filter((r) => r.ok);
  if (!okRows.length) return "三种打洞方式均未能打通";
  const best = okRows.reduce((a, b) => (b.total > a.total ? b : a));
  const multi = okRows.filter((r) => r.total > 0).length;
  if (multi < 2) return `仅 ${best.label} 打通（双向总 ${fmtSpeed(best.total)}）`;
  return `双向总吞吐最高：${best.label}（${fmtSpeed(best.total)}）${best.key === "c" ? "，验证 AB 同时打洞的洞质量" : ""}`;
});

function goLogin(): void {
  emit("login");
}

onMounted(() => {
  void refresh();
  // 目标端回传的确认结果（对方视角速率，展示为参考）
  setP2PTestResultHandler((r) => {
    remoteResult.value = {
      ok: r.ok,
      speedBps: r.speedBps,
      ms: r.ms,
      error: r.error ?? "",
    };
  });
});

onUnmounted(() => {
  setP2PTestResultHandler(null);
});
</script>

<template>
  <div class="p2p-test">
    <div class="p2p-test__toolbar">
      <span class="p2p-test__title">P2P 连通性测试</span>
      <button class="p2p-test__refresh" :disabled="loading || !!testing" @click="refresh">
        {{ loading ? "加载中…" : "刷新列表" }}
      </button>
    </div>
    <p class="p2p-test__desc">
      选择一位在线用户，一键测试 <b>3 种打洞方式 × 双向测速 = 6 项</b>：A 打洞、B 打洞、AB 互相打洞，
      每种管道分别测上行（A→B）与下行（B→A）。对方会自动配合，无需操作。
      <span class="p2p-test__warn">注意：两台设备请用不同账号登录——同一账号会互相挤下线，导致列表加载失败。</span>
    </p>

    <!-- 未登录 -->
    <div v-if="!loggedIn" class="p2p-test__empty">
      <p>请先登录后再使用 P2P 测试工具</p>
      <button class="p2p-test__login-btn" @click="goLogin">去登录</button>
    </div>

    <template v-else>
      <!-- 加载中 -->
      <div v-if="loading && !users.length" class="p2p-test__empty">
        正在获取在线用户…
      </div>

      <!-- 在线列表 -->
      <div v-else-if="users.length" class="p2p-test__users">
        <div v-for="u in users" :key="u.userId" class="p2p-test__user">
          <div class="p2p-test__user-info">
            <span class="p2p-test__user-name">{{ u.username || "匿名用户" }}</span>
            <span class="p2p-test__user-id">{{ shortId(u.userId) }}</span>
          </div>
          <button
            class="p2p-test__test-btn"
            :disabled="testing !== null"
            @click="runTest(u)"
          >
            {{ testing?.userId === u.userId ? "测试中…" : "测试" }}
          </button>
        </div>
      </div>
      <div v-else-if="!loading" class="p2p-test__empty">
        {{ loadError || "暂无在线用户（需要其他客户端登录并在线）" }}
      </div>

      <!-- 进度 -->
      <div v-if="testing" class="p2p-test__status">
        <div class="p2p-test__status-line">
          正在测试 <b>{{ testing.username || shortId(testing.userId) }}</b> — {{ currentStage }}
          <span v-if="progress > 0">{{ progress }}%</span>
        </div>
      </div>

      <!-- 3×2 结果矩阵 -->
      <div v-if="allDone" class="p2p-test__matrix">
        <div class="p2p-test__matrix-head">
          <span class="p2p-test__matrix-cell p2p-test__matrix-label">打洞方式</span>
          <span class="p2p-test__matrix-cell">上行 A→B</span>
          <span class="p2p-test__matrix-cell">下行 B→A</span>
        </div>
        <div
          v-for="row in [
            { key: 'a', label: 'A 打洞', p: punchResults.a },
            { key: 'b', label: 'B 打洞', p: punchResults.b },
            { key: 'c', label: 'AB 互相打洞', p: punchResults.c },
          ]"
          :key="row.key"
          class="p2p-test__matrix-row"
          :class="row.p.punchOk ? 'p2p-test__matrix-row--ok' : 'p2p-test__matrix-row--fail'"
        >
          <span class="p2p-test__matrix-cell p2p-test__matrix-label">{{ row.label }}</span>
          <span class="p2p-test__matrix-cell">
            <template v-if="row.p.up.ok">{{ fmtSpeed(row.p.up.speedBps) }}</template>
            <template v-else>—</template>
          </span>
          <span class="p2p-test__matrix-cell">
            <template v-if="row.p.down.ok">{{ fmtSpeed(row.p.down.speedBps) }}</template>
            <template v-else>—</template>
          </span>
        </div>
        <div v-if="conclusion" class="p2p-test__conclusion">{{ conclusion }}</div>
      </div>

      <!-- 对方回传确认 -->
      <div v-if="remoteResult" class="p2p-test__result p2p-test__result--info">
        <div class="p2p-test__result-label">
          {{ remoteResult.ok ? "对方已确认打通" : "对方侧失败" }}
        </div>
        <template v-if="remoteResult.ok">
          <div class="p2p-test__result-row">
            <span>对方视角速率</span><b>{{ fmtSpeed(remoteResult.speedBps) }}</b>
          </div>
        </template>
        <div v-else class="p2p-test__result-error">{{ remoteResult.error }}</div>
      </div>

      <!-- ICE 诊断日志（排障 P2P 打洞失败：候选类型/状态变化） -->
      <div v-if="diagnostics.length" class="p2p-test__diag">
        <div class="p2p-test__diag-head">
          <span class="p2p-test__diag-title">ICE 诊断（候选/状态）</span>
          <button class="p2p-test__diag-copy" @click="copyDiagnostics">复制诊断</button>
        </div>
        <div v-for="(d, i) in diagnostics" :key="i" class="p2p-test__diag-line">{{ d }}</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.p2p-test {
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 13px;
  /* P2P 面板容器固定黑底（#1a1a1a），文字固定亮色，勿用 var(--text-color)（亮色主题下会变黑字） */
  color: #f0f0f0;
}
.p2p-test__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.p2p-test__title {
  font-weight: 600;
}
.p2p-test__refresh {
  background: var(--accent, #4f9cf9);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
}
.p2p-test__refresh:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.p2p-test__desc {
  color: #f0f0f0;
  line-height: 1.5;
  margin: 0;
}
.p2p-test__warn {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: #ffb84d;
}
.p2p-test__users {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 220px;
  overflow-y: auto;
}
.p2p-test__user {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 8px 12px;
}
.p2p-test__user-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.p2p-test__user-name {
  font-weight: 500;
  color: #f0f0f0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.p2p-test__user-id {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
}
.p2p-test__test-btn {
  background: var(--accent, #e94560);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 5px 14px;
  cursor: pointer;
  flex-shrink: 0;
}
.p2p-test__test-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.p2p-test__empty {
  color: #f0f0f0;
  text-align: center;
  padding: 14px 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
}
.p2p-test__login-btn {
  background: var(--accent, #e94560);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 6px 18px;
  cursor: pointer;
}
.p2p-test__status {
  color: #f0f0f0;
  padding: 6px 2px;
}
.p2p-test__status-line {
  display: flex;
  gap: 6px;
  align-items: center;
}
.p2p-test__matrix {
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  overflow: hidden;
}
.p2p-test__matrix-head,
.p2p-test__matrix-row {
  display: grid;
  grid-template-columns: 1.4fr 1fr 1fr;
}
.p2p-test__matrix-head {
  background: rgba(255, 255, 255, 0.08);
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.6);
}
.p2p-test__matrix-cell {
  padding: 7px 10px;
}
.p2p-test__matrix-label {
  font-weight: 500;
}
.p2p-test__matrix-row {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.p2p-test__matrix-row--ok {
  background: rgba(52, 199, 89, 0.08);
}
.p2p-test__matrix-row--fail {
  background: rgba(255, 59, 48, 0.08);
  opacity: 0.8;
}
.p2p-test__conclusion {
  border-top: 1px solid rgba(255, 255, 255, 0.15);
  padding: 8px 10px;
  font-weight: 600;
  background: rgba(79, 156, 249, 0.12);
  color: #7fb4ff;
}
.p2p-test__result {
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.p2p-test__result--info {
  background: rgba(255, 184, 77, 0.1);
  border: 1px solid rgba(255, 184, 77, 0.35);
}
.p2p-test__result-label {
  font-weight: 600;
}
.p2p-test__result-row {
  display: flex;
  justify-content: space-between;
  color: #f0f0f0;
}
.p2p-test__result-error {
  color: #ff3b30;
  word-break: break-all;
  font-size: 12px;
}
.p2p-test__diag {
  margin-top: 4px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px dashed rgba(255, 255, 255, 0.15);
  max-height: 160px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 3px;
  /* 诊断信息允许鼠标选中复制（全局 user-select:none，需显式放开） */
  user-select: text;
  -webkit-user-select: text;
}
/* 深色底自定义滚动条（默认滚动条在 WebView2 深色容器里不可见/突兀） */
.p2p-test__diag::-webkit-scrollbar,
.p2p-test__users::-webkit-scrollbar {
  width: 8px;
}
.p2p-test__diag::-webkit-scrollbar-track,
.p2p-test__users::-webkit-scrollbar-track {
  background: transparent;
}
.p2p-test__diag::-webkit-scrollbar-thumb,
.p2p-test__users::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.22);
  border-radius: 4px;
}
.p2p-test__diag::-webkit-scrollbar-thumb:hover,
.p2p-test__users::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.38);
}
.p2p-test__diag-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.p2p-test__diag-title {
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.6);
}
.p2p-test__diag-copy {
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 5px;
  padding: 2px 10px;
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.p2p-test__diag-copy:hover {
  background: rgba(255, 255, 255, 0.22);
}
.p2p-test__diag-line {
  font-size: 11px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.65);
  word-break: break-all;
}
</style>
