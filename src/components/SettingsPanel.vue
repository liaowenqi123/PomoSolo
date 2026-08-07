<script setup lang="ts">
/**
 * 设置面板
 *
 * 参考 electron/src/scripts/modules/settings.js 的核心设置项，
 * 用 Vue 响应式数据替代原来的 DOM 操作。
 *
 * 包含：主题切换、最小化行为、迷你退出方式、开机自启、界面显示开关。
 */
import { computed, ref } from "vue";
import { getVersion } from "@tauri-apps/api/app";
import {
  useSettingsStore,
  type MinimizeBehavior,
  type MiniExitMode,
  type Theme,
  type UpdateSource,
} from "../stores/settings";
import {
  checkUpdate,
  downloadAndInstall,
  updateDownloadPause,
  updateDownloadResume,
  installLocalInstaller,
  fetchNotice,
  updateSeedDownloadBegin,
  updateSeedDownloadChunk,
  updateSeedDownloadAbort,
  type UpdateNotice,
  type UpdateInfo,
  type UpdateStatusPayload,
} from "@/api/update";
import { open } from "@tauri-apps/plugin-dialog";
import { seedList, seedFetch, type P2PSeedPeer } from "@/api/seed";
import { p2pReceive } from "@/p2p";
import { startSeedSharing, stopSeedSharing } from "@/seed";
import { useTauriEvent } from "@/api/events";
import { cloudGetSession, type Session } from "@/api/auth";
import {
  submitFeedback,
  getUserFeedbacks,
  deleteFeedback,
  FEEDBACK_STATUS_LABELS,
  type FeedbackItem,
} from "@/api/feedback";
import P2PTestPanel from "./P2PTestPanel.vue";
import { autostartEnable } from "@/api/system";
import { openExternal } from "@/api/window";
import { gardenUnlockEasteregg } from "@/api/garden";
import { useGardenStore } from "../stores/garden";

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "open-auth"): void;
  /** 彩蛋触发完成（由父组件接管全屏太空旅行，面板关闭后彩蛋仍在） */
  (e: "easter-egg"): void;
}>();

const settings = useSettingsStore();
const garden = useGardenStore();

// 本地编辑副本——只在面板可见时同步，避免直接修改 store 导致中途自动保存
const local = computed(() => settings.settings);

// ===== 隐藏彩蛋（连续点击版本号 5 次触发）=====
// 参照旧版 electron/src/scripts/modules/settings.js 的 handleVersionClick：
// 5 次点击间隔 < 1.5s 即触发彩蛋（粒子效果 + 解锁 easteregg 成就 + 太空旅行）。
const EASTER_EGG_REQUIRED_CLICKS = 5;
const EASTER_EGG_CLICK_INTERVAL_MS = 1500;
const EASTER_EGG_PARTICLE_COUNT = 20;

let easterEggClickCount = 0;
let easterEggLastClickTime = 0;
/** 彩蛋粒子（固定定位，动画后自动移除） */
const easterEggParticles = ref<Array<{ id: number; left: string; top: string; dx: string; dy: string; color: string }>>([]);
let particleIdCounter = 0;

/** 处理版本号点击（彩蛋入口） */
function handleVersionClick(e: MouseEvent): void {
  const now = Date.now();
  const timeSinceLastClick = now - easterEggLastClickTime;

  // 间隔超过阈值则重置计数
  if (easterEggLastClickTime !== 0 && timeSinceLastClick > EASTER_EGG_CLICK_INTERVAL_MS) {
    easterEggClickCount = 0;
  }
  easterEggLastClickTime = now;
  easterEggClickCount++;

  // 轻微缩放动画反馈
  const el = e.currentTarget as HTMLElement;
  el.style.transition = "transform 0.1s ease";
  el.style.transform = "scale(1.15)";
  setTimeout(() => {
    el.style.transform = "scale(1)";
  }, 100);

  // 达到 5 次触发彩蛋
  if (easterEggClickCount >= EASTER_EGG_REQUIRED_CLICKS) {
    easterEggClickCount = 0;
    easterEggLastClickTime = 0;
    void triggerEasterEgg();
  }
}

/** 触发彩蛋：粒子效果 + 解锁成就 + 太空旅行 */
async function triggerEasterEgg(): Promise<void> {
  createParticleEffect();

  // 解锁隐藏成就（幂等）
  try {
    const result = await gardenUnlockEasteregg();
    if (result.success) {
      // 新解锁：刷新菜园子数据（成就 UI 同步）
      await garden.load();
    }
  } catch (e) {
    console.warn("[Settings] 解锁彩蛋成就失败:", e);
  }

  // 延迟启动太空旅行（让粒子效果先播放）。
  // 彩蛋画面由 App.vue 顶层的 SpaceTravel 播放（emit close 关闭面板后组件依然存活）。
  setTimeout(() => {
    emit("easter-egg");
    emit("close");
  }, 800);
}

/** 创建粒子效果（在版本号位置向四周飞散） */
function createParticleEffect(): void {
  const rect = document.querySelector(".version-text")?.getBoundingClientRect();
  const centerX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const centerY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
  const colors = ["#ff6b6b", "#ffd93d", "#6bcb77", "#4ecdc4", "#a29bfe", "#ff7675"];

  const particles = Array.from({ length: EASTER_EGG_PARTICLE_COUNT }, () => {
    const angle = Math.random() * Math.PI * 2;
    const dist = 40 + Math.random() * 70;
    return {
      id: particleIdCounter++,
      left: `${centerX}px`,
      top: `${centerY}px`,
      dx: `${Math.cos(angle) * dist}px`,
      dy: `${Math.sin(angle) * dist}px`,
      color: colors[Math.floor(Math.random() * colors.length)],
    };
  });
  easterEggParticles.value = particles;

  // 动画结束后清空粒子
  setTimeout(() => {
    easterEggParticles.value = [];
  }, 900);
}

// ===== 自动更新状态 =====
const appVersion = ref("...");
const updateBtnText = ref("检查更新");
const updateBtnAction = ref<"check" | "download">("check");
const updateBtnDisabled = ref(false);
const updateStatusText = ref("");
const updateStatusType = ref<"info" | "success" | "error">("info");
const updateProgressVisible = ref(false);
const updateProgressPercent = ref(0);
const updateProgressText = ref("");
/** 是否处于暂停状态（暂停后显示"继续下载"） */
const updatePaused = ref(false);
/** 当前下载通道（P2P 种子快，无暂停按钮；HTTP 下载支持暂停/继续） */
const updateChannel = ref<"idle" | "p2p" | "http">("idle");
let statusTimer: ReturnType<typeof setTimeout> | null = null;
/** checkUpdate 返回的完整更新信息（含签名，P2P 种子下载用） */
const latestUpdateInfo = ref<UpdateInfo | null>(null);
/** 分享安装包状态提示 */
const seedStatusText = ref("");

// 监听后端 update-status 事件
useTauriEvent<UpdateStatusPayload>("update-status", (e) => {
  const payload = e.payload;
  switch (payload.status) {
    case "checking":
      updateBtnText.value = "检查中...";
      updateBtnDisabled.value = true;
      updateStatusText.value = "";
      updateProgressVisible.value = false;
      updatePaused.value = false;
      updateChannel.value = "idle";
      break;
    case "available":
      updateStatusText.value = `发现新版本 v${payload.version}，点击下载`;
      updateStatusType.value = "info";
      updateBtnText.value = "下载更新";
      updateBtnAction.value = "download";
      updateBtnDisabled.value = false;
      updateProgressVisible.value = false;
      updatePaused.value = false;
      updateChannel.value = "idle";
      break;
    case "not-available":
      // v4.5.18：最新版本是 Beta 且未开启接收 → 提示存在 Beta，引导用户开开关
      if (payload.betaOnly) {
        updateStatusText.value = payload.betaVersion
          ? `正式版已是最新；存在 Beta 版 v${payload.betaVersion}，可在下方开启接收`
          : "正式版已是最新；存在 Beta 版本，可在下方开启接收";
        updateStatusType.value = "info";
      } else {
        // v4.6.6：展示更新源上的最新版本号，避免"服务器有新版但查不到"的困惑
        updateStatusText.value = payload.latestVersion
          ? `已是最新版本（${local.value.updateSource === "server" ? "服务器" : "GitHub"}最新 v${payload.latestVersion}）`
          : "已是最新版本";
        updateStatusType.value = "success";
      }
      updateBtnText.value = "检查更新";
      updateBtnAction.value = "check";
      updateBtnDisabled.value = false;
      updateProgressVisible.value = false;
      if (statusTimer) clearTimeout(statusTimer);
      statusTimer = setTimeout(() => {
        updateStatusText.value = "";
      }, 5000);
      break;
    case "downloading":
      updateProgressVisible.value = true;
      // percent 保留 1 位小数（v4.7.0 起后端上报小数精度）
      updateProgressPercent.value = payload.percent ?? 0;
      updatePaused.value = false;
      const total = payload.total ?? 0;
      const totalMB = total > 0 ? ` / ${(total / 1048576).toFixed(1)}MB` : "";
      updateProgressText.value = `下载中 ${(payload.percent ?? 0).toFixed(1)}%${totalMB}`;
      // 主按钮复用为暂停/继续：仅 HTTP 下载可暂停（P2P 种子传输快，保持禁用）
      updateBtnText.value = updateChannel.value === "http" ? "暂停下载" : "下载中...";
      updateBtnDisabled.value = updateChannel.value !== "http";
      break;
    case "downloaded":
      updateStatusText.value = "更新已下载，即将安装重启";
      updateStatusType.value = "success";
      updateProgressVisible.value = false;
      updateBtnText.value = "安装中...";
      updateBtnDisabled.value = true;
      updatePaused.value = false;
      updateChannel.value = "idle";
      break;
    case "error":
      updateStatusText.value = `更新失败: ${payload.message ?? "未知错误"}`;
      updateStatusType.value = "error";
      updateBtnText.value = "检查更新";
      updateBtnAction.value = "check";
      updateBtnDisabled.value = false;
      updateProgressVisible.value = false;
      updatePaused.value = false;
      updateChannel.value = "idle";
      // v4.5.21：更新出错时拉取服务器公告，让用户知道该怎么做（教训：v4.5.20 曾逼用户重装）
      void showUpdateNoticeOnError();
      break;
  }
});

/** 服务器公告（更新出错时展示官方指引，v4.5.21） */
const updateNotice = ref<UpdateNotice | null>(null);

async function showUpdateNoticeOnError(): Promise<void> {
  try {
    const notice = await fetchNotice(appVersion.value);
    updateNotice.value = notice;
  } catch {
    updateNotice.value = null; // 公告拉取失败不打扰用户
  }
}

function closeUpdateNotice(): void {
  updateNotice.value = null;
}

/** 打开更新指引外链（Tauri WebView2 下 <a target="_blank"> 不生效，须走 open_external） */
function openUpdateGuide(): void {
  if (updateNotice.value?.url) {
    void openExternal(updateNotice.value.url).catch(() => {});
  }
}

// 加载版本号
void getVersion().then((v) => {
  appVersion.value = v;
});

async function handleUpdateBtnClick(): Promise<void> {
  // 暂停态 → 继续（断点续传）
  if (updatePaused.value) {
    updateBtnDisabled.value = true;
    updateBtnText.value = "继续中...";
    try {
      await updateDownloadResume();
      // 恢复后 Rust 会重新 emit downloading，按钮文本由事件接管
    } catch (e) {
      updateStatusText.value = `继续下载失败: ${String(e)}`;
      updateStatusType.value = "error";
      updateBtnText.value = "继续下载";
      updateBtnDisabled.value = false;
    }
    return;
  }
  // 下载中（HTTP 通道）→ 暂停（保留已下载数据，可断点续传）
  if (updateChannel.value === "http" && updateBtnAction.value === "download") {
    updateBtnDisabled.value = true;
    try {
      await updateDownloadPause();
      updatePaused.value = true;
      updateBtnText.value = "继续下载";
      updateBtnDisabled.value = false;
      updateProgressText.value = `已暂停 ${updateProgressPercent.value.toFixed(1)}%`;
      updateStatusText.value = "";
    } catch (e) {
      updateStatusText.value = `暂停失败: ${String(e)}`;
      updateStatusType.value = "error";
      updateBtnText.value = "暂停下载";
      updateBtnDisabled.value = false;
    }
    return;
  }
  if (updateBtnAction.value === "check") {
    latestUpdateInfo.value = await checkUpdate(
      local.value.updateSource,
      local.value.allowBetaUpdates,
    );
  } else {
    updateBtnDisabled.value = true;
    updateBtnText.value = "准备下载...";
    // Phase 2：P2P 种子优先（直连在线种子拉安装包，不经服务器/GitHub）
    if (latestUpdateInfo.value) {
      const p2pOk = await trySeedDownload(latestUpdateInfo.value);
      if (p2pOk) return; // P2P 成功：Rust 收齐后自动校验并启动安装器（应用退出）
    }
    updateChannel.value = "http"; // P2P 失败回退 → 服务器/GitHub HTTP 下载（可暂停）
    updateBtnText.value = "下载中...";
    await downloadAndInstall(
      local.value.updateSource,
      local.value.allowBetaUpdates,
    );
  }
}

/**
 * 从本地安装包覆盖安装（v4.7.0）
 *
 * 文件选择器选 .exe → 后端静默覆盖安装（/S /UPDATE，不卸载旧版、
 * 保留任务栏/开始菜单固定快捷方式）。文件名版本与本机留存 latest.json
 * 匹配时后端会先校验签名，失败拒绝。成功安装后应用自动退出重启。
 */
async function handleLocalInstall(): Promise<void> {
  updateBtnDisabled.value = true;
  let selected: string | null = null;
  try {
    const picked = await open({
      title: "选择 PomoSolo 安装包",
      filters: [{ name: "安装包", extensions: ["exe"] }],
      multiple: false,
    });
    selected = typeof picked === "string" ? picked : null;
  } catch (e) {
    updateStatusText.value = `打开文件选择器失败: ${String(e)}`;
    updateStatusType.value = "error";
    updateBtnDisabled.value = false;
    return;
  }
  if (!selected) {
    updateBtnDisabled.value = false; // 用户取消选择
    return;
  }
  try {
    updateStatusText.value = "正在从本地安装包覆盖安装...";
    updateStatusType.value = "info";
    updateProgressVisible.value = true;
    updateProgressText.value = "覆盖安装中（保留任务栏固定）...";
    // 成功后应用退出重启，无需恢复按钮
    await installLocalInstaller(selected);
  } catch (e) {
    updateStatusText.value = `本地安装失败: ${String(e)}`;
    updateStatusType.value = "error";
    updateProgressVisible.value = false;
    updateBtnDisabled.value = false;
  }
}

/**
 * 尝试从 P2P 种子直连下载安装包。
 *
 * 流程：查在线种子 → 有则 WebRTC 收片（DataChannel 分片逐片调 Rust 落盘）→
 * Rust 收齐后自动校验签名并启动安装器。失败/无种子返回 false 由调用方回退。
 */
async function trySeedDownload(info: UpdateInfo): Promise<boolean> {
  const { version, signature } = info;
  if (!signature || !version) return false;
  updateChannel.value = "p2p"; // P2P 种子通道（传输快，无暂停按钮）
  let peers: P2PSeedPeer[] = [];
  try {
    peers = await seedList(version);
  } catch (e) {
    console.warn("[Update] 查询在线种子失败，回退服务器/GitHub:", e);
    return false;
  }
  if (peers.length === 0) return false;
  const peer = peers[0];
  const peerId = peer.userId;
  // v4.7.3 下载观测：展示种子用户名，让用户知道从谁那里直连拉取安装包
  updateStatusText.value = peer.username
    ? `正在从「${peer.username}」直连下载（P2P 种子）`
    : "正在从在线种子直连下载（P2P）";

  return await new Promise<boolean>((resolve) => {
    void updateSeedDownloadBegin(version, signature)
      .then(async () => {
        // 通知种子端发起 WebRTC offer（v4.6.6 补齐种子端；失败不阻塞，等 p2pReceive 超时兜底）
        await seedFetch(version, peerId).catch((e) => {
          console.warn("[Update] 通知种子端发起失败，将等待超时兜底:", e);
        });
        p2pReceive({
          peerId,
          role: "answerer",
          timeoutMs: 10_000,
          onChunk: async (chunk, index, totalChunks) => {
            try {
              await updateSeedDownloadChunk(Array.from(chunk), index, totalChunks);
            } catch (e) {
              throw new Error(`分片落盘失败: ${String(e)}`);
            }
          },
          callbacks: {
            onComplete: () => {
              // Rust 收齐后自动校验签名并启动安装器（emit downloaded → 应用退出）
              updateStatusText.value = "P2P 下载完成，即将安装重启";
              updateStatusType.value = "success";
              resolve(true);
            },
            onError: (err) => {
              console.warn("[Update] P2P 种子下载失败，回退服务器/GitHub:", err);
              void updateSeedDownloadAbort().catch(() => {});
              resolve(false);
            },
          },
        });
      })
      .catch((e) => {
        console.warn("[Update] 初始化种子下载失败，回退服务器/GitHub:", e);
        resolve(false);
      });
  });
}

/**
 * 分享安装包开关（Phase 2）：开启需登录，注册种子 + 30s 心跳；关闭注销。
 * 未登录或注册失败时回滚开关。
 */
async function onShareInstallerChange(value: boolean): Promise<void> {
  if (value) {
    const session = await cloudGetSession().catch(() => null);
    if (!session) {
      seedStatusText.value = "分享安装包需先登录";
      await settings.update("shareInstaller", false);
      return;
    }
    try {
      await startSeedSharing(appVersion.value);
      seedStatusText.value = "分享中（本机作为 P2P 种子）";
      await settings.update("shareInstaller", true);
    } catch (e) {
      console.warn("[Update] 开启种子分享失败:", e);
      seedStatusText.value =
        e instanceof Error ? e.message : "开启分享失败，请检查登录状态";
      await settings.update("shareInstaller", false);
    }
  } else {
    await stopSeedSharing();
    seedStatusText.value = "";
    await settings.update("shareInstaller", false);
  }
}

/** 切换更新源（github 快但可能不稳定 / server 稳定但慢），持久化设置 */
async function onUpdateSourceChange(value: UpdateSource): Promise<void> {
  await settings.update("updateSource", value);
}

/** 切换是否接收 Beta 版本更新（v4.5.18），持久化设置 */
async function onAllowBetaUpdatesChange(value: boolean): Promise<void> {
  await settings.update("allowBetaUpdates", value);
}

async function onThemeChange(value: Theme): Promise<void> {
  await settings.update("theme", value);
}

async function onMinimizeBehaviorChange(
  value: MinimizeBehavior,
): Promise<void> {
  await settings.update("minimizeBehavior", value);
}

async function onMiniExitModeChange(value: MiniExitMode): Promise<void> {
  await settings.update("miniExitMode", value);
}

async function onToggle(
  key:
    | "showDarkModeBtn"
    | "showGardenBtn"
    | "showStatsBtn"
    | "showAiBtn"
    | "showStudyRoomBtn"
    | "showSidebarCollapseBtn"
    | "showHeaderExpandBtn"
    | "showShuffleBtn"
    | "showVolumeBtn"
    | "showDeviceBtn"
    | "showChartsBtn"
    | "advancedColorCustomization"
    | "autoStart"
    | "plantWheelMode",
  value: boolean,
): Promise<void> {
  await settings.update(key, value);
  // 开机自启需同步到系统登录项（对应旧版 Electron 的 set-auto-start）
  if (key === "autoStart") {
    try {
      const actual = await autostartEnable(value);
      // 系统实际状态可能与请求不同（如权限不足），回写保证 UI 一致
      if (actual !== value) {
        await settings.update("autoStart", actual);
      }
    } catch {
      // 后端调用失败时静默降级，设置已保存到 data.json，启动时会同步
    }
  }
}

async function onReset(): Promise<void> {
  await settings.reset();
}

function onBackdropClick(): void {
  emit("close");
}

function onContentClick(e: MouseEvent): void {
  e.stopPropagation();
}

// ===== 意见反馈 =====
const feedbackVisible = ref(false);
const feedbackLoggedIn = ref(false);
const feedbackList = ref<FeedbackItem[]>([]);
const feedbackInput = ref("");
const feedbackSubmitting = ref(false);
const feedbackLoading = ref(false);
const feedbackError = ref("");

function openFeedbackModal(): void {
  feedbackVisible.value = true;
  void refreshFeedback();
}

function closeFeedbackModal(): void {
  feedbackVisible.value = false;
  feedbackInput.value = "";
  feedbackError.value = "";
}

// ===== P2P 连通性测试工具 =====
const p2pTestVisible = ref(false);

function openP2PTestModal(): void {
  p2pTestVisible.value = true;
}

function closeP2PTestModal(): void {
  p2pTestVisible.value = false;
}

function handleP2PTestLogin(): void {
  closeP2PTestModal();
  emit("close");
  emit("open-auth");
}

async function refreshFeedback(): Promise<void> {
  feedbackLoading.value = true;
  feedbackError.value = "";
  try {
    const session = await cloudGetSession();
    feedbackLoggedIn.value = !!session;
    if (session) {
      feedbackList.value = await getUserFeedbacks();
    } else {
      feedbackList.value = [];
    }
  } catch (e) {
    feedbackError.value = String(e);
  } finally {
    feedbackLoading.value = false;
  }
}

async function handleSubmitFeedback(): Promise<void> {
  const content = feedbackInput.value.trim();
  if (!content) {
    feedbackError.value = "请输入反馈内容";
    return;
  }
  if (content.length > 500) {
    feedbackError.value = "反馈内容不能超过 500 字";
    return;
  }

  feedbackSubmitting.value = true;
  feedbackError.value = "";
  try {
    await submitFeedback(content);
    feedbackInput.value = "";
    await refreshFeedback();
  } catch (e) {
    feedbackError.value = String(e);
  } finally {
    feedbackSubmitting.value = false;
  }
}

async function handleDeleteFeedback(id: number): Promise<void> {
  if (!confirm("确定要删除这条反馈吗？")) return;
  try {
    await deleteFeedback(id);
    await refreshFeedback();
  } catch (e) {
    feedbackError.value = String(e);
  }
}

function goLogin(): void {
  closeFeedbackModal();
  emit("close");
  emit("open-auth");
}

function formatFeedbackTime(time: string | null): string {
  if (!time) return "?";
  try {
    return new Date(time).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return time;
  }
}

function statusClass(status: number): string {
  return `feedback-status--${status}`;
}

function statusLabel(status: number): string {
  return FEEDBACK_STATUS_LABELS[status] ?? "已收到";
}
</script>

<template>
  <Transition name="panel">
    <div
      v-if="props.visible"
      class="settings-overlay"
      @click="onBackdropClick"
    >
      <div class="settings-panel" @click="onContentClick">
        <div class="settings-panel__header">
          <h2 class="settings-panel__title">设置</h2>
          <button class="settings-panel__close" @click="emit('close')">
            ×
          </button>
        </div>

        <div class="settings-panel__body">
          <!-- 外观 -->
          <section class="settings-section">
            <h3 class="settings-section__title">外观</h3>
            <div class="settings-row">
              <label class="settings-row__label">外观模式</label>
              <div class="settings-row__control">
                <button
                  class="theme-btn"
                  :class="{ 'theme-btn--active': local.theme === 'dark' }"
                  @click="onThemeChange('dark')"
                >
                  深色
                </button>
                <button
                  class="theme-btn"
                  :class="{ 'theme-btn--active': local.theme === 'light' }"
                  @click="onThemeChange('light')"
                >
                  浅色
                </button>
              </div>
            </div>
            <div class="settings-row settings-row--toggle">
              <label class="settings-row__label">显示深色模式按钮</label>
              <label class="toggle">
                <input
                  type="checkbox"
                  :checked="local.showDarkModeBtn"
                  @change="
                    onToggle('showDarkModeBtn', ($event.target as HTMLInputElement).checked)
                  "
                />
                <span class="toggle__slider"></span>
              </label>
            </div>
            <div class="settings-row settings-row--toggle">
              <label class="settings-row__label">高级颜色自定义</label>
              <label class="toggle">
                <input
                  type="checkbox"
                  :checked="local.advancedColorCustomization"
                  @change="
                    onToggle('advancedColorCustomization', ($event.target as HTMLInputElement).checked)
                  "
                />
                <span class="toggle__slider"></span>
              </label>
            </div>
          </section>

          <!-- 计时器 -->
          <section class="settings-section">
            <h3 class="settings-section__title">计时器</h3>
            <div class="settings-row">
              <label class="settings-row__label">最小化行为</label>
              <select
                class="settings-select"
                :value="local.minimizeBehavior"
                @change="
                  onMinimizeBehaviorChange(
                    ($event.target as HTMLSelectElement).value as MinimizeBehavior,
                  )
                "
              >
                <option value="tray">最小化到托盘</option>
                <option value="minimize">最小化窗口</option>
              </select>
            </div>
            <div class="settings-row">
              <label class="settings-row__label">迷你模式退出</label>
              <select
                class="settings-select"
                :value="local.miniExitMode"
                @change="
                  onMiniExitModeChange(
                    ($event.target as HTMLSelectElement).value as MiniExitMode,
                  )
                "
              >
                <option value="double-click">双击退出</option>
                <option value="button">按钮退出</option>
              </select>
            </div>
          </section>

          <!-- 功能按钮 -->
          <section class="settings-section">
            <h3 class="settings-section__title">功能按钮</h3>
            <div class="settings-row settings-row--toggle">
              <label class="settings-row__label">显示菜园子按钮</label>
              <label class="toggle">
                <input
                  type="checkbox"
                  :checked="local.showGardenBtn"
                  @change="
                    onToggle('showGardenBtn', ($event.target as HTMLInputElement).checked)
                  "
                />
                <span class="toggle__slider"></span>
              </label>
            </div>
            <div class="settings-row settings-row--toggle">
              <label class="settings-row__label">显示统计按钮</label>
              <label class="toggle">
                <input
                  type="checkbox"
                  :checked="local.showStatsBtn"
                  @change="
                    onToggle('showStatsBtn', ($event.target as HTMLInputElement).checked)
                  "
                />
                <span class="toggle__slider"></span>
              </label>
            </div>
            <div class="settings-row settings-row--toggle">
              <label class="settings-row__label">显示 AI 助手按钮</label>
              <label class="toggle">
                <input
                  type="checkbox"
                  :checked="local.showAiBtn"
                  @change="
                    onToggle('showAiBtn', ($event.target as HTMLInputElement).checked)
                  "
                />
                <span class="toggle__slider"></span>
              </label>
            </div>
            <div class="settings-row settings-row--toggle">
              <label class="settings-row__label">显示自习室按钮</label>
              <label class="toggle">
                <input
                  type="checkbox"
                  :checked="local.showStudyRoomBtn"
                  @change="
                    onToggle('showStudyRoomBtn', ($event.target as HTMLInputElement).checked)
                  "
                />
                <span class="toggle__slider"></span>
              </label>
            </div>
            <div class="settings-row settings-row--toggle">
              <label class="settings-row__label">显示图表按钮</label>
              <label class="toggle">
                <input
                  type="checkbox"
                  :checked="local.showChartsBtn"
                  @change="
                    onToggle('showChartsBtn', ($event.target as HTMLInputElement).checked)
                  "
                />
                <span class="toggle__slider"></span>
              </label>
            </div>
          </section>

          <!-- 导航 -->
          <section class="settings-section">
            <h3 class="settings-section__title">导航</h3>
            <div class="settings-row settings-row--toggle">
              <label class="settings-row__label">显示侧边栏收起按钮</label>
              <label class="toggle">
                <input
                  type="checkbox"
                  :checked="local.showSidebarCollapseBtn"
                  @change="
                    onToggle('showSidebarCollapseBtn', ($event.target as HTMLInputElement).checked)
                  "
                />
                <span class="toggle__slider"></span>
              </label>
            </div>
            <div class="settings-row settings-row--toggle">
              <label class="settings-row__label">显示功能区展开按钮</label>
              <label class="toggle">
                <input
                  type="checkbox"
                  :checked="local.showHeaderExpandBtn"
                  @change="
                    onToggle('showHeaderExpandBtn', ($event.target as HTMLInputElement).checked)
                  "
                />
                <span class="toggle__slider"></span>
              </label>
            </div>
          </section>

          <!-- 音乐 -->
          <section class="settings-section">
            <h3 class="settings-section__title">音乐</h3>
            <div class="settings-row settings-row--toggle">
              <label class="settings-row__label">显示随机按钮</label>
              <label class="toggle">
                <input
                  type="checkbox"
                  :checked="local.showShuffleBtn"
                  @change="
                    onToggle('showShuffleBtn', ($event.target as HTMLInputElement).checked)
                  "
                />
                <span class="toggle__slider"></span>
              </label>
            </div>
            <div class="settings-row settings-row--toggle">
              <label class="settings-row__label">显示音量按钮</label>
              <label class="toggle">
                <input
                  type="checkbox"
                  :checked="local.showVolumeBtn"
                  @change="
                    onToggle('showVolumeBtn', ($event.target as HTMLInputElement).checked)
                  "
                />
                <span class="toggle__slider"></span>
              </label>
            </div>
            <div class="settings-row settings-row--toggle">
              <label class="settings-row__label">显示设备按钮</label>
              <label class="toggle">
                <input
                  type="checkbox"
                  :checked="local.showDeviceBtn"
                  @change="
                    onToggle('showDeviceBtn', ($event.target as HTMLInputElement).checked)
                  "
                />
                <span class="toggle__slider"></span>
              </label>
            </div>
          </section>

          <!-- 种植 -->
          <section class="settings-section">
            <h3 class="settings-section__title">种植</h3>
            <div class="settings-row settings-row--toggle">
              <label class="settings-row__label">种植轮盘模式</label>
              <label class="toggle">
                <input
                  type="checkbox"
                  :checked="local.plantWheelMode"
                  @change="
                    onToggle('plantWheelMode', ($event.target as HTMLInputElement).checked)
                  "
                />
                <span class="toggle__slider"></span>
              </label>
            </div>
          </section>

          <!-- 系统 -->
          <section class="settings-section">
            <h3 class="settings-section__title">系统</h3>
            <div class="settings-row settings-row--toggle">
              <label class="settings-row__label">开机自启动</label>
              <label class="toggle">
                <input
                  type="checkbox"
                  :checked="local.autoStart"
                  @change="
                    onToggle('autoStart', ($event.target as HTMLInputElement).checked)
                  "
                />
                <span class="toggle__slider"></span>
              </label>
            </div>
            <div class="settings-row">
              <label class="settings-row__label">P2P 测试工具</label>
              <button class="p2p-test-open-btn" @click="openP2PTestModal">
                打开测试
              </button>
            </div>
            <p class="p2p-test-hint">
              列出在线用户并测试 WebRTC 直连（跨 NAT 打洞）是否打通，排查 P2P 传歌问题。
            </p>
          </section>

          <!-- 关于 / 更新 -->
          <section class="settings-section">
            <h3 class="settings-section__title">关于</h3>
            <div class="settings-row">
              <label class="settings-row__label">意见反馈</label>
              <button class="update-btn" @click="openFeedbackModal">
                提交反馈
              </button>
            </div>
            <div class="settings-row settings-row--toggle">
              <label class="settings-row__label">更新源</label>
              <div class="update-source-seg">
                <button
                  class="update-source-seg__btn"
                  :class="{ 'update-source-seg__btn--active': local.updateSource === 'github' }"
                  @click="onUpdateSourceChange('github')"
                >
                  GitHub
                </button>
                <button
                  class="update-source-seg__btn"
                  :class="{ 'update-source-seg__btn--active': local.updateSource === 'server' }"
                  @click="onUpdateSourceChange('server')"
                >
                  服务器
                </button>
              </div>
            </div>
            <p class="update-source-hint">
              GitHub 下载快但可能不稳定；服务器稳定但较慢。若更新下载中断，可切换更新源后重试。
            </p>
            <div class="settings-row settings-row--toggle">
              <label class="settings-row__label">接收 Beta 版本更新</label>
              <label class="toggle">
                <input
                  type="checkbox"
                  :checked="local.allowBetaUpdates"
                  @change="
                    onAllowBetaUpdatesChange(($event.target as HTMLInputElement).checked)
                  "
                />
                <span class="toggle__slider"></span>
              </label>
            </div>
            <p class="update-source-hint">
              默认只推送正式版本；开启后可接收 Beta/测试版（如 4.6.0-beta），Beta 版本可能有未修复的问题。
            </p>
            <div class="settings-row settings-row--toggle">
              <label class="settings-row__label">分享安装包（P2P）</label>
              <label class="toggle">
                <input
                  type="checkbox"
                  :checked="local.shareInstaller"
                  @change="
                    onShareInstallerChange(($event.target as HTMLInputElement).checked)
                  "
                />
                <span class="toggle__slider"></span>
              </label>
            </div>
            <p class="update-source-hint">
              {{ seedStatusText || "开启后本机作为种子，其他客户端更新时可 P2P 直连下载安装包（需登录）。" }}
            </p>
            <div class="settings-row">
              <label class="settings-row__label">检查更新</label>
              <div class="update-btns">
                <button
                  class="update-btn"
                  :disabled="updateBtnDisabled"
                  @click="handleUpdateBtnClick"
                >
                  {{ updateBtnText }}
                </button>
                <button
                  class="update-btn update-btn--local"
                  :disabled="updateBtnDisabled"
                  title="选择本地安装包直接覆盖安装（不卸载旧版，保留任务栏固定）"
                  @click="handleLocalInstall"
                >
                  本地安装包
                </button>
              </div>
            </div>
            <div v-if="updateProgressVisible" class="update-progress">
              <div class="update-progress-bar">
                <div
                  class="update-progress-fill"
                  :style="{ width: updateProgressPercent + '%' }"
                ></div>
              </div>
              <span class="update-progress-text">{{ updateProgressText }}</span>
            </div>
            <div
              v-if="updateStatusText"
              class="update-status"
              :class="`update-status--${updateStatusType}`"
            >
              {{ updateStatusText }}
            </div>
            <!-- v4.5.21：更新出错时展示服务器公告（官方升级指引），避免用户不知道怎么办 -->
            <div
              v-if="updateNotice"
              class="update-notice"
              :class="`update-notice--${updateNotice.level ?? 'warning'}`"
            >
              <span class="update-notice__text">
                {{ updateNotice.text ?? "更新出现问题，请查看升级指引" }}
              </span>
              <a
                v-if="updateNotice.url"
                class="update-notice__link"
                :href="updateNotice.url"
                @click.prevent="openUpdateGuide"
              >
                查看升级指引
              </a>
              <button
                class="update-notice__close"
                title="关闭"
                @click="closeUpdateNotice"
              >
                ×
              </button>
            </div>
            <div class="settings-row">
              <label class="settings-row__label">版本</label>
              <span class="version-text" @click="handleVersionClick">v{{ appVersion }}</span>
            </div>
          </section>
        </div>

        <div class="settings-panel__footer">
          <button class="settings-btn settings-btn--reset" @click="onReset">
            恢复默认
          </button>
          <button
            class="settings-btn settings-btn--save"
            @click="emit('close')"
          >
            完成
          </button>
        </div>

        <!-- 意见反馈模态框（覆盖在设置面板上方） -->
        <Transition name="panel">
          <div
            v-if="feedbackVisible"
            class="feedback-overlay"
            @click="closeFeedbackModal"
          >
            <div class="feedback-modal" @click.stop>
              <div class="feedback-modal__header">
                <h3 class="feedback-modal__title">意见反馈</h3>
                <button class="feedback-modal__close" @click="closeFeedbackModal">
                  ×
                </button>
              </div>

              <div class="feedback-modal__body">
                <!-- 未登录 -->
                <div v-if="!feedbackLoggedIn" class="feedback-login-prompt">
                  <p>请先登录后再提交反馈</p>
                  <button class="feedback-login-btn" @click="goLogin">
                    去登录
                  </button>
                </div>

                <!-- 已登录 -->
                <template v-else>
                  <div class="feedback-submit-area">
                    <textarea
                      v-model="feedbackInput"
                      class="feedback-input"
                      placeholder="请输入你的反馈意见（最多 500 字）"
                      maxlength="500"
                      rows="4"
                    ></textarea>
                    <div class="feedback-submit-footer">
                      <span class="feedback-count">{{ feedbackInput.length }}/500</span>
                      <button
                        class="feedback-submit-btn"
                        :disabled="feedbackSubmitting || !feedbackInput.trim()"
                        @click="handleSubmitFeedback"
                      >
                        {{ feedbackSubmitting ? "提交中..." : "提交反馈" }}
                      </button>
                    </div>
                  </div>

                  <div v-if="feedbackError" class="feedback-error">
                    {{ feedbackError }}
                  </div>

                  <div class="feedback-list-section">
                    <div class="feedback-list-header">
                      <span>我的反馈</span>
                      <button class="feedback-refresh-btn" @click="refreshFeedback">
                        刷新
                      </button>
                    </div>
                    <div class="feedback-list-container">
                      <div v-if="feedbackLoading" class="feedback-empty">
                        加载中...
                      </div>
                      <div v-else-if="feedbackList.length === 0" class="feedback-empty">
                        暂无反馈
                      </div>
                      <div
                        v-for="item in feedbackList"
                        :key="item.id"
                        class="feedback-item"
                      >
                        <div class="feedback-item__header">
                          <span class="feedback-item__time">
                            {{ formatFeedbackTime(item.createTime) }}
                          </span>
                          <div class="feedback-item__actions">
                            <span
                              class="feedback-status-badge"
                              :class="statusClass(item.feedbackStatus)"
                            >
                              {{ statusLabel(item.feedbackStatus) }}
                            </span>
                            <button
                              class="feedback-delete-btn"
                              title="删除"
                              @click="handleDeleteFeedback(item.id)"
                            >
                              删除
                            </button>
                          </div>
                        </div>
                        <div class="feedback-item__content">{{ item.feedbackContent }}</div>
                        <div
                          v-if="item.feedbackStatus === 3 && item.remark"
                          class="feedback-item__remark"
                        >
                          拒绝理由：{{ item.remark }}
                        </div>
                      </div>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </Transition>

        <!-- P2P 测试工具模态框（覆盖在设置面板上方） -->
        <Transition name="panel">
          <div
            v-if="p2pTestVisible"
            class="feedback-overlay"
            @click="closeP2PTestModal"
          >
            <div class="feedback-modal" @click.stop>
              <div class="feedback-modal__header">
                <h3 class="feedback-modal__title">P2P 测试工具</h3>
                <button class="feedback-modal__close" @click="closeP2PTestModal">
                  ×
                </button>
              </div>
              <div class="feedback-modal__body">
                <P2PTestPanel @login="handleP2PTestLogin" />
              </div>
            </div>
          </div>
        </Transition>
      </div>

      <!-- 彩蛋粒子效果（版本号点击 5 次触发，向四周飞散） -->
      <div v-if="easterEggParticles.length > 0" class="easter-egg-particle-layer">
        <span
          v-for="p in easterEggParticles"
          :key="p.id"
          class="easter-egg-particle"
          :style="{ left: p.left, top: p.top, '--dx': p.dx, '--dy': p.dy, background: p.color }"
        ></span>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.settings-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
}

.settings-panel {
  width: 460px;
  max-width: 90vw;
  max-height: 88vh;
  background: #1a1a1a;
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
}

.settings-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.settings-panel__title {
  font-size: 18px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
}

.settings-panel__close {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  font-size: 20px;
  color: rgba(255, 255, 255, 0.6);
  transition: all 0.15s ease;
}

.settings-panel__close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
}

.settings-panel__body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 20px 16px;
}

.settings-section {
  padding: 12px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.settings-section:last-child {
  border-bottom: none;
}

.settings-section__title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 8px;
}

.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
}

.settings-row__label {
  font-size: 14px;
  color: #fff;
}

.settings-select {
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  cursor: pointer;
}

/* 下拉选项背景色（WebView2/Chromium 支持 option 样式） */
.settings-select option {
  background: #1a1a1a;
  color: #fff;
}

.settings-select:focus {
  border-color: var(--accent, #e94560);
}

.settings-row__control {
  display: flex;
  gap: 4px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  padding: 3px;
}

.theme-btn {
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
  transition: all 0.15s ease;
}

.theme-btn--active {
  background: var(--accent, #e94560);
  color: #fff;
}

/* Toggle switch */
.toggle {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 22px;
  cursor: pointer;
}

.toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle__slider {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 22px;
  transition: 0.2s;
}

.toggle__slider::before {
  content: "";
  position: absolute;
  width: 16px;
  height: 16px;
  left: 3px;
  top: 3px;
  background: #fff;
  border-radius: 50%;
  transition: 0.2s;
}

.toggle input:checked + .toggle__slider {
  background: var(--accent, #e94560);
}

.toggle input:checked + .toggle__slider::before {
  transform: translateX(18px);
}

.settings-panel__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.settings-btn {
  padding: 8px 20px;
  border-radius: 8px;
  font-size: 13px;
  transition: all 0.15s ease;
}

.settings-btn--reset {
  color: rgba(255, 255, 255, 0.85);
  background: rgba(255, 255, 255, 0.08);
}

.settings-btn--reset:hover {
  color: rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.1);
}

.settings-btn--save {
  background: var(--accent, #e94560);
  color: #fff;
}

.settings-btn--save:hover {
  opacity: 0.9;
}

/* ===== 自动更新 ===== */
.update-btn {
  padding: 6px 16px;
  border-radius: 8px;
  font-size: 13px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.9);
  transition: all 0.15s ease;
}

.update-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
}

/* v4.7.0：检查更新 + 本地安装包两个按钮并排 */
.update-btns {
  display: flex;
  gap: 8px;
}

.update-btn--local {
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: transparent;
  color: rgba(255, 255, 255, 0.75);
}

.p2p-test-open-btn {
  padding: 6px 16px;
  border-radius: 8px;
  font-size: 13px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.9);
  transition: all 0.15s ease;
}

/* 设置面板黑底，入口提示文字固定亮色（勿用 var(--text-color)，亮色主题下会变黑字） */
.p2p-test-hint {
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
  line-height: 1.5;
}

.p2p-test-open-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
}

.update-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 更新源分段选择（GitHub / 服务器） */
.update-source-seg {
  display: flex;
  gap: 4px;
  padding: 3px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
}

.update-source-seg__btn {
  padding: 4px 12px;
  border-radius: 6px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  transition: all 0.15s ease;
}

.update-source-seg__btn:hover {
  color: rgba(255, 255, 255, 0.95);
}

.update-source-seg__btn--active {
  background: var(--accent, #e94560);
  color: #fff;
}

/* 更新源提示文案 */
.update-source-hint {
  margin: 2px 0 10px;
  font-size: 11px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.55);
}

.update-progress {
  margin-top: 8px;
}

.update-progress-bar {
  height: 6px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  overflow: hidden;
}

.update-progress-fill {
  height: 100%;
  background: var(--accent, #e94560);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.update-progress-text {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
}

.update-status {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.4;
}

.update-status--info {
  color: #64b5f6;
}

.update-status--success {
  color: #66bb6a;
}

.update-status--error {
  color: #ef5350;
}

/* v4.5.21：服务器公告条（更新出错时展示官方指引） */
.update-notice {
  margin-top: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  position: relative;
}

.update-notice--warning {
  background: rgba(255, 193, 7, 0.1);
  border: 1px solid rgba(255, 193, 7, 0.3);
  color: #ffd54f;
}

.update-notice--error {
  background: rgba(239, 83, 80, 0.1);
  border: 1px solid rgba(239, 83, 80, 0.3);
  color: #ef9a9a;
}

.update-notice--info {
  background: rgba(100, 181, 246, 0.1);
  border: 1px solid rgba(100, 181, 246, 0.3);
  color: #90caf9;
}

.update-notice__text {
  flex: 1;
  word-break: break-word;
}

.update-notice__link {
  flex-shrink: 0;
  color: #ffd54f;
  text-decoration: underline;
  cursor: pointer;
  font-weight: 500;
}

.update-notice__link:hover {
  opacity: 0.85;
}

.update-notice__close {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  font-size: 14px;
  line-height: 1;
  color: rgba(255, 255, 255, 0.5);
  transition: all 0.15s ease;
}

.update-notice__close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
}

.version-text {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  user-select: none;
  display: inline-block;
}

/* 彩蛋粒子层 */
.easter-egg-particle-layer {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 99998;
  pointer-events: none;
}

.easter-egg-particle {
  position: fixed;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  animation: easterEggFly 0.9s ease-out forwards;
  box-shadow: 0 0 6px currentColor;
}

@keyframes easterEggFly {
  0% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
  100% {
    opacity: 0;
    transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(0.3);
  }
}

/* Scrollbar */
::-webkit-scrollbar {
  width: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.4);
}

/* Range slider */
input[type="range"] {
  -webkit-appearance: none;
  height: 4px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  outline: none;
}
input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  background: #fff;
  border-radius: 50%;
  cursor: pointer;
}

/* Transition：遮罩层 opacity 0→1，内容 scale 0.92→1 */
.panel-enter-active,
.panel-leave-active {
  transition: opacity 0.25s ease;
}

.panel-enter-active .settings-panel,
.panel-leave-active .settings-panel {
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.panel-enter-from,
.panel-leave-to {
  opacity: 0;
}

.panel-enter-from .settings-panel,
.panel-leave-to .settings-panel {
  transform: scale(0.92);
}

/* ===== 意见反馈模态框 ===== */
.feedback-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  z-index: var(--z-modal-upper);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
}

.feedback-modal {
  width: 380px;
  max-width: 90%;
  max-height: 80%;
  background: #1a1a1a;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
}

.feedback-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.feedback-modal__title {
  font-size: 15px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
}

.feedback-modal__close {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  font-size: 18px;
  color: rgba(255, 255, 255, 0.6);
  transition: all 0.15s ease;
}

.feedback-modal__close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
}

.feedback-modal__body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 18px;
}

/* 未登录提示 */
.feedback-login-prompt {
  text-align: center;
  padding: 30px 0;
}

.feedback-login-prompt p {
  color: rgba(255, 255, 255, 0.7);
  font-size: 14px;
  margin-bottom: 16px;
}

.feedback-login-btn {
  padding: 8px 24px;
  border-radius: 8px;
  font-size: 13px;
  background: var(--accent, #e94560);
  color: #fff;
  transition: opacity 0.15s ease;
}

.feedback-login-btn:hover {
  opacity: 0.9;
}

/* 提交区 */
.feedback-input {
  width: 100%;
  min-height: 80px;
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
  outline: none;
  box-sizing: border-box;
}

.feedback-input:focus {
  border-color: var(--accent, #e94560);
}

.feedback-input::placeholder {
  color: rgba(255, 255, 255, 0.35);
}

.feedback-submit-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
}

.feedback-count {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
}

.feedback-submit-btn {
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 12px;
  background: var(--accent, #e94560);
  color: #fff;
  transition: opacity 0.15s ease;
}

.feedback-submit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.feedback-submit-btn:not(:disabled):hover {
  opacity: 0.9;
}

.feedback-error {
  margin-top: 8px;
  font-size: 12px;
  color: #ef5350;
}

/* 反馈列表 */
.feedback-list-section {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px dashed rgba(255, 255, 255, 0.1);
}

.feedback-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
}

.feedback-refresh-btn {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
  padding: 2px 8px;
  border-radius: 4px;
  transition: all 0.15s ease;
}

.feedback-refresh-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
}

.feedback-list-container {
  max-height: 200px;
  overflow-y: auto;
}

.feedback-empty {
  text-align: center;
  padding: 20px 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
}

.feedback-item {
  padding: 10px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.feedback-item:last-child {
  border-bottom: none;
}

.feedback-item__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.feedback-item__time {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
}

.feedback-item__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.feedback-status-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 500;
}

.feedback-status--0 {
  background: rgba(100, 181, 246, 0.15);
  color: #64b5f6;
}

.feedback-status--1 {
  background: rgba(255, 193, 7, 0.15);
  color: #ffc107;
}

.feedback-status--2 {
  background: rgba(102, 187, 106, 0.15);
  color: #66bb6a;
}

.feedback-status--3 {
  background: rgba(239, 83, 80, 0.15);
  color: #ef5350;
}

.feedback-delete-btn {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  padding: 2px 6px;
  border-radius: 4px;
  transition: all 0.15s ease;
}

.feedback-delete-btn:hover {
  background: rgba(239, 83, 80, 0.15);
  color: #ef5350;
}

.feedback-item__content {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.85);
  line-height: 1.5;
  word-break: break-word;
}

.feedback-item__remark {
  margin-top: 6px;
  font-size: 11px;
  color: #ef5350;
  background: rgba(239, 83, 80, 0.08);
  padding: 4px 8px;
  border-radius: 4px;
}
</style>
