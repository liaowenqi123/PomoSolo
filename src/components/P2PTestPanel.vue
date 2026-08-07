<script setup lang="ts">
/**
 * P2P 连通性测试工具（Phase 1.2+）
 *
 * 列出在线用户 → 选择目标发起 WebRTC 直连测试（跨 NAT 打洞 + 2MB 测速）。
 * - 发起方：p2pStartTest（offerer 推测试数据）
 * - 目标端：全局自动接受（music store 监听 p2p:test_request），无需打开本面板
 * - 结果：本地视角（建连/测速）+ 对方回传确认（p2p:test_result）
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useAuthStore } from "@/stores/auth";
import { p2pOnline, p2pTestRequest, p2pReverseTestRequest, type P2POnlineUser } from "@/api/p2pTest";
import { p2pStartTest, setP2PTestResultHandler, p2pReceive } from "@/p2p";

interface TestResult {
  ok: boolean;
  ms: number;
  speedBps: number;
  bytes: number;
  error: string;
  label: string;
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
const localResult = ref<TestResult | null>(null);
const remoteResult = ref<TestResult | null>(null);

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

/** 测试阶段：正向（本机 offerer）/ 反向（对端 offerer） */
type TestPhase = "normal" | "reverse";
let currentPhase: TestPhase = "normal";

/** 记录本次测试最终结果（只写一次，双向容错判成功即定） */
function setFinalResult(r: TestResult): void {
  localResult.value = r;
  testing.value = null;
}

function finishOk(stats: { ms: number; speedBps: number; bytes: number }, label: string): void {
  setFinalResult({
    ok: true,
    ms: stats.ms,
    speedBps: stats.speedBps,
    bytes: stats.bytes,
    error: "",
    label,
  });
}

function fail(err: string, label: string): void {
  setFinalResult({
    ok: false,
    ms: 0,
    speedBps: 0,
    bytes: 0,
    error: err,
    label,
  });
}

/**
 * 发起单方向测试（v4.7.3 双向打洞容错）：
 * 1. normal：本机作为 offerer（p2pTestRequest 通知对端挂起接收 + p2pStartTest 主动推数据）
 * 2. 失败 → reverse：请求对端作为 offerer 反向推（p2pReverseTestRequest + 本机 p2pReceive 挂起接收）
 * 两边都失败才判失败；任一边成功即成功（NAT 打洞方向不对称，换方向常能打通）。
 */
function runDirection(u: P2POnlineUser): void {
  // 守卫：结果已定（双向中任一方成功）后，迟到的另一方向回调不得再覆盖/重复尝试
  if (!testing.value) return;
  const phase = currentPhase;
  if (phase === "normal") {
    // 正向：本机 offerer，主动推 2MB 测试数据
    void p2pTestRequest(u.userId).catch((e) => {
      console.warn("[P2PTest] 发送测试请求失败:", e);
      // 请求都发不出去 → 尝试反向（对端可能在线但服务器暂未响应）
      diagnostics.value.push("正向测试请求发送失败，尝试反向打洞");
      currentPhase = "reverse";
      runDirection(u);
    });
    p2pStartTest(u.userId, {
      onDiagnose: (info) => {
        diagnostics.value.push(info);
      },
      onOpen: () => {
        // 建连成功（DataChannel 可传）——但不代表测速完成，等 onComplete
      },
      onProgress: (p) => {
        progress.value = p;
      },
      onComplete: (stats) => {
        finishOk(stats, "P2P 直连打通，2MB 测速完成（本机发起方向）");
      },
      onError: (err) => {
        diagnostics.value.push(`正向打洞失败：${err}，尝试反向打洞`);
        currentPhase = "reverse";
        runDirection(u);
      },
    });
  } else {
    // 反向：本机 answerer，挂起等待对端 offer 推数据
    diagnostics.value.push("反向打洞：请求对端作为发起方推测试数据…");
    void p2pReverseTestRequest(u.userId).catch((e) => {
      console.warn("[P2PTest] 发送反向测试请求失败:", e);
      fail(String(e), "双向打洞均失败");
    });
    p2pReceive({
      peerId: u.userId,
      role: "answerer",
      timeoutMs: 12_000,
      onDiagnose: (info) => {
        diagnostics.value.push(`[反向] ${info}`);
      },
      onChunk: async () => {},
      callbacks: {
        onProgress: (_received, _total, percent) => {
          progress.value = percent;
        },
        onComplete: (stats) => {
          finishOk(stats, "P2P 直连打通，2MB 测速完成（对端发起方向）");
        },
        onError: (err) => {
          fail(err, "双向打洞均失败（对端发起方向也失败）");
        },
      },
    });
  }
}

function runTest(u: P2POnlineUser): void {
  if (testing.value) return;
  testing.value = u;
  progress.value = 0;
  diagnostics.value = [];
  localResult.value = null;
  remoteResult.value = null;
  currentPhase = "normal";
  runDirection(u);
}

function goLogin(): void {
  emit("login");
}

onMounted(() => {
  void refresh();
  // 发起方注册结果处理器：目标端回传的确认结果
  setP2PTestResultHandler((r) => {
    remoteResult.value = {
      ok: r.ok,
      ms: r.ms,
      speedBps: r.speedBps,
      bytes: r.bytes,
      error: r.error ?? "",
      label: r.ok ? "对方已确认打通" : `对方侧失败：${r.error ?? "未知错误"}`,
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
      选择一位在线用户发起 WebRTC 直连测试（跨 NAT 打洞 + 2MB 测速）。对方会自动接受，无需操作。
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

      <!-- 进度 / 本地结果 -->
      <div v-if="testing" class="p2p-test__status">
        <div class="p2p-test__status-line">
          正在测试 <b>{{ testing.username || shortId(testing.userId) }}</b>…
          <span v-if="progress > 0">{{ progress }}%</span>
        </div>
      </div>

      <div
        v-if="localResult"
        class="p2p-test__result"
        :class="localResult.ok ? 'p2p-test__result--ok' : 'p2p-test__result--fail'"
      >
        <div class="p2p-test__result-label">
          {{ localResult.label }}
        </div>
        <template v-if="localResult.ok">
          <div class="p2p-test__result-row">
            <span>耗时</span><b>{{ localResult.ms }} ms</b>
          </div>
          <div class="p2p-test__result-row">
            <span>速率</span><b>{{ fmtSpeed(localResult.speedBps) }}</b>
          </div>
          <div class="p2p-test__result-row">
            <span>数据</span><b>{{ (localResult.bytes / 1024 / 1024).toFixed(2) }} MB</b>
          </div>
        </template>
        <div v-else class="p2p-test__result-error">{{ localResult.error }}</div>
      </div>

      <!-- 对方回传确认 -->
      <div
        v-if="remoteResult"
        class="p2p-test__result"
        :class="remoteResult.ok ? 'p2p-test__result--ok' : 'p2p-test__result--fail'"
      >
        <div class="p2p-test__result-label">{{ remoteResult.label }}</div>
        <template v-if="remoteResult.ok">
          <div class="p2p-test__result-row">
            <span>对方速率</span><b>{{ fmtSpeed(remoteResult.speedBps) }}</b>
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
  max-height: 260px;
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
.p2p-test__result {
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.p2p-test__result--ok {
  background: rgba(52, 199, 89, 0.12);
  border: 1px solid rgba(52, 199, 89, 0.4);
}
.p2p-test__result--fail {
  background: rgba(255, 59, 48, 0.1);
  border: 1px solid rgba(255, 59, 48, 0.4);
}
.p2p-test__result-label {
  font-weight: 600;
}
.p2p-test__result-row {
  display: flex;
  justify-content: space-between;
  color: #f0f0f0;
}
.p2p-test__result-label {
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
