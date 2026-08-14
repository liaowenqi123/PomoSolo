<script setup lang="ts">
/**
 * PomoSolo PWA 主壳（重设计：流式全窗口布局，复用 ≠ UI 完全一致）
 *
 * 设计原则：
 * - 复用组件/store/API（Timer/MusicPlayer/SettingsPanel/StudyRoom/...原样 import），
 *   但 PWA 外壳有自己的布局：不整壳缩放，改为流式尺寸（clamp）+ 断点适配；
 * - 颜色/圆角/触摸尺寸统一引用 `src/styles/global.css` 的共享 token
 *   （--shell-*），改色只需改 global.css 一处，两端生效；
 * - 桌面（≥560px）：侧边栏常驻（无收起按钮，PWA 独特性），大屏内容流式放大；
 * - 手机（<560px）：侧边栏变抽屉（☰ 打开），主按钮加大到触摸友好尺寸（≥44px），
 *   播放器贴底并适配安全区。
 *
 * 砍去（PWA v1）：菜园子、专注模式/前台检测、统计与图表面板、AI、窗口/迷你模式、B站下载。
 *
 * 部门：PWA部门 —— 2026-08 PWA 第一版
 */
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import Timer from "@/components/Timer.vue";
import TimerProgress from "@/components/TimerProgress.vue";
import ModeSwitch from "@/components/ModeSwitch.vue";
import ModeSlider from "@/components/ModeSlider.vue";
import HeaderButtons from "@/components/HeaderButtons.vue";
import MusicPlayer from "@/components/MusicPlayer.vue";
import SettingsPanel from "@/components/SettingsPanel.vue";
import Presets from "@/components/Presets.vue";
import NoteManager from "@/components/NoteManager.vue";
import AuthPanel from "@/components/AuthPanel.vue";
import StudyRoom from "@/components/StudyRoom.vue";
import TutorialModal from "@/components/TutorialModal.vue";
import LoadingOverlay from "@/components/LoadingOverlay.vue";
import { useTimerStore, type TimerMode } from "@/stores/timer";
import { useSettingsStore } from "@/stores/settings";
import { useStatsStore } from "@/stores/stats";
import { useAuthStore } from "@/stores/auth";
import { loadManifest } from "./music/manifest";
import { audioEngine } from "./music/engine";

const timer = useTimerStore();
const settings = useSettingsStore();
const stats = useStatsStore();
const auth = useAuthStore();

// ===== 加载状态 =====
const loading = ref(true);

// ===== 面板可见性 =====
const showSettings = ref(false);
const showAuth = ref(false);
const showStudyRoom = ref(false);
const showTutorial = ref(false);

// ===== 响应式：手机断点（<560px 视为移动端） =====
const MOBILE_MQ = "(max-width: 559px)";
const isMobile = ref(false);
let mq: MediaQueryList | null = null;
function onMqChange(e: MediaQueryListEvent) {
  isMobile.value = e.matches;
  if (!e.matches) mobileSidebarOpen.value = false;
}

// ===== 手机侧边栏抽屉 =====
const mobileSidebarOpen = ref(false);
function toggleMobileSidebar() {
  mobileSidebarOpen.value = !mobileSidebarOpen.value;
}
function closeMobileSidebar() {
  mobileSidebarOpen.value = false;
}

// ===== 当前专注任务备注 =====
const note = ref("");

// ===== 计划模式任务列表 =====
interface PlanItem {
  id: number;
  minutes: number;
  type: "work" | "break";
  note?: string;
}
const planList = ref<PlanItem[]>([]);
const planCurrentIndex = ref(-1);
const planRunning = ref(false);
let planIdCounter = 1;

function planAddItem(minutes: number, type: "work" | "break") {
  planList.value.push({ id: planIdCounter++, minutes, type });
}
function planDeleteItem(index: number) {
  if (planRunning.value) return;
  planList.value.splice(index, 1);
}
function planClearAll() {
  if (planRunning.value) return;
  planList.value = [];
}

const currentPlanType = computed<TimerMode>(() => {
  if (planRunning.value && planCurrentIndex.value >= 0) {
    return planList.value[planCurrentIndex.value]?.type ?? "work";
  }
  return planList.value[0]?.type ?? "work";
});

const displayMode = computed<TimerMode>(() =>
  timer.appMode === "plan" ? currentPlanType.value : timer.mode,
);

function applyPlanItem(item: PlanItem): void {
  timer.setMode(item.type);
  timer.setTime(item.minutes);
}

function startPlan(): void {
  if (planList.value.length === 0) return;
  planRunning.value = true;
  planCurrentIndex.value = 0;
  applyPlanItem(planList.value[0]);
  timer.start();
}

function nextPlanItem(): void {
  planCurrentIndex.value++;
  if (planCurrentIndex.value < planList.value.length) {
    applyPlanItem(planList.value[planCurrentIndex.value]);
    setTimeout(() => {
      if (planRunning.value && timer.phase === "ready") {
        timer.start();
      }
    }, 1000);
  } else {
    planRunning.value = false;
    planCurrentIndex.value = -1;
  }
}

function stopPlan(): void {
  planRunning.value = false;
  planCurrentIndex.value = -1;
}

watch(
  () => timer.appMode,
  (mode) => {
    if (mode !== "plan") stopPlan();
  },
);

// ===== container 上的 class =====
const themeClass = computed(() => (settings.isDark ? "dark-theme" : ""));
const modeClass = computed(() => (displayMode.value === "break" ? "break-mode" : ""));
const appModeClass = computed(() => {
  if (timer.appMode === "plan") return "plan-mode";
  if (timer.appMode === "stopwatch") return "stopwatch-mode";
  return "";
});

// ===== 深色模式同步到 document =====
watch(
  () => settings.isDark,
  (isDark) => {
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark-theme", isDark);
      document.body.classList.toggle("dark-theme", isDark);
    }
  },
  { immediate: true },
);

// ===== 生命周期 =====
onMounted(async () => {
  await Promise.all([settings.load(), stats.load()]);
  timer.todayCount = stats.todayCount;
  timer.totalMinutes = stats.totalMinutes;
  timer.init();
  // PWA 侧收尾：把桌面端 PWA 不适用的设置项关掉（按钮隐藏）
  await settings.updateAll({
    showGardenBtn: false,
    showStatsBtn: false,
    showAiBtn: false,
    showChartsBtn: false,
    plantWheelMode: false,
    showDeviceBtn: false,
    shareInstaller: false,
  });
  // 初始化认证 store（加载模式 + 测试连接 + 恢复会话）
  void auth.init();
  document.documentElement.classList.toggle("dark-theme", settings.isDark);
  document.body.classList.toggle("dark-theme", settings.isDark);
  window.addEventListener("keydown", handleKeydown);
  // 手机断点监听
  mq = window.matchMedia(MOBILE_MQ);
  isMobile.value = mq.matches;
  mq.addEventListener("change", onMqChange);
  setTimeout(() => {
    loading.value = false;
  }, 400);
});

// 音乐清单 → 音频引擎（内置 3 首 + 服务器曲库；服务器曲库在线与否不影响清单）
void loadManifest()
  .then((manifest) => {
    audioEngine.setPlaylist(manifest.songs);
  })
  .catch((e) => {
    console.warn("[PWA] 音乐清单加载失败，曲库为空:", e);
    audioEngine.setPlaylist([]);
  });

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeydown);
  mq?.removeEventListener("change", onMqChange);
});

// ===== 完成事件 → 记录统计（菜园子/专注模式已在 PWA 砍去） =====
watch(
  () => timer.completionId,
  async (id, prevId) => {
    if (id > prevId) {
      const minutes = timer.lastCompletedMinutes;
      await stats.recordSession(minutes, note.value);
      timer.todayCount = stats.todayCount;
      timer.totalMinutes = stats.totalMinutes;
    }
  },
);

// ===== 计划模式：完成任意一项 → 自动进入下一项 =====
watch(
  () => timer.planStepId,
  (id, prevId) => {
    if (id > prevId && planRunning.value) {
      nextPlanItem();
    }
  },
);

// ===== 键盘快捷键 =====
function handleKeydown(e: KeyboardEvent) {
  if (e.code === "Space" && e.target === document.body) {
    e.preventDefault();
    onToggleClick();
  }
  if (e.key === "Escape") {
    showSettings.value = false;
    showAuth.value = false;
    showStudyRoom.value = false;
    mobileSidebarOpen.value = false;
  }
}

// ===== 被砍板块的 HeaderButtons 事件（stats/ai/garden/charts）→ 无操作 =====
function showStatsNoop() {
  /* 无操作 */
}

// ===== 开始/暂停 =====
function onToggleClick(): void {
  if (timer.appMode === "plan" && !planRunning.value) {
    startPlan();
    return;
  }
  timer.toggle();
}

// ===== 重置 =====
function onResetClick(): void {
  if (timer.appMode === "plan" && planRunning.value) {
    stopPlan();
  }
  timer.reset();
}

// ===== 模式切换动画 =====
const modeAnimating = ref(false);
let modeAnimTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => timer.appMode,
  () => {
    modeAnimating.value = true;
    clearTimeout(modeAnimTimer);
    modeAnimTimer = setTimeout(() => {
      modeAnimating.value = false;
    }, 320);
  },
);
</script>

<template>
  <div class="window-frame">
    <!-- 加载进度条 -->
    <LoadingOverlay :visible="loading" />

    <!-- 内层容器：position:relative + overflow:hidden，是复用组件
         .app-modal-overlay（设置/自习室/登录/教程）的定位锚点，必须保留 -->
    <div
      class="container"
      :class="[themeClass, modeClass, appModeClass]"
    >
      <!-- 桌面：模式拨杆浮在左上角（与桌面端一致） -->
      <ModeSlider v-if="!isMobile" />

      <!-- 手机：顶栏（☰ 抽屉 + 模式拨杆；功能按钮列在主区域右上、蒙版下方） -->
      <div v-else class="app-topbar">
        <button
          class="hamburger"
          :class="{ open: mobileSidebarOpen }"
          aria-label="菜单"
          @click="toggleMobileSidebar"
        >☰</button>
        <ModeSlider />
      </div>

      <div class="app-body">
        <!-- 侧边栏：桌面常驻；手机为抽屉（isMobile 时绝对定位 + 平移隐藏） -->
        <aside class="sidebar" :class="{ 'sidebar-open': isMobile && mobileSidebarOpen }">
          <div v-if="!isMobile" class="sidebar-brand">🍅 PomoSolo</div>

          <!-- 单次模式：时间预设 -->
          <div v-if="timer.appMode === 'single'" class="single-mode-content">
            <h2 class="sidebar-title">时间预设</h2>
            <Presets />
          </div>

          <!-- 计划模式：任务列表 -->
          <div v-else-if="timer.appMode === 'plan'" class="plan-mode-content">
            <h2 class="sidebar-title">番茄计划</h2>
            <div class="plan-list scrollable">
              <div
                v-for="(item, idx) in planList"
                :key="item.id"
                class="plan-item"
                :class="[item.type, { active: idx === planCurrentIndex, disabled: planRunning }]"
              >
                <span class="plan-item__icon">{{ item.type === "work" ? "🍅" : "☕" }}</span>
                <span class="plan-item__time">{{ item.minutes }}min</span>
                <button
                  v-if="!planRunning && planList.length > 1"
                  class="plan-item__delete"
                  @click="planDeleteItem(idx)"
                >×</button>
              </div>
              <p v-if="planList.length === 0" class="plan-empty-hint">点击下方按钮添加计划</p>
            </div>
            <div class="plan-add-buttons">
              <button class="btn-add-plan btn-add-work" @click="planAddItem(25, 'work')">+ 工作</button>
              <button class="btn-add-plan btn-add-break" @click="planAddItem(5, 'break')">+ 休息</button>
            </div>
          </div>

          <!-- 正向计时模式：说明 -->
          <div v-else class="stopwatch-mode-content">
            <h2 class="sidebar-title">正向计时</h2>
            <div class="stopwatch-description">
              <p>从零开始累计</p>
              <p>适合不确定时长的任务</p>
              <p>💡 超过1分钟才会计入统计</p>
            </div>
          </div>

          <!-- 统计信息（保留侧栏计数，砍统计/图表面板） -->
          <div class="sidebar-stats">
            <div class="stat-item">
              <span class="stat-label">今日完成</span>
              <span class="stat-value">{{ timer.todayCount }}</span>
              <span class="stat-unit">个</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">累计专注</span>
              <span class="stat-value">{{ timer.totalMinutes }}</span>
              <span class="stat-unit">分钟</span>
            </div>
          </div>
        </aside>

        <!-- 右侧主区域 -->
        <main class="main" :class="{ 'mode-animating': modeAnimating }">
          <!-- 功能按钮列（桌面左上；手机右上、顶栏蒙版下方） -->
          <HeaderButtons
            @tutorial="showTutorial = true"
            @settings="showSettings = true"
            @theme="settings.toggleTheme()"
            @stats="showStatsNoop"
            @ai="showStatsNoop"
            @study-room="showStudyRoom = true"
            @garden="showStatsNoop"
            @auth="showAuth = true"
            @charts="showStatsNoop"
          />

          <div class="timer-section">
            <h1 class="title">🍅 番茄钟</h1>

            <!-- 工作/休息模式切换（计划/正向模式隐藏） -->
            <ModeSwitch v-if="timer.appMode === 'single'" />

            <div class="timer-container">
              <!-- 备注（在计时器圆圈上方） -->
              <NoteManager v-model="note" :disabled="timer.isRunning" />

              <TimerProgress />
              <div class="timer-inner">
                <Timer />
              </div>
            </div>

            <div class="buttons">
              <button class="btn btn-start" @click="onToggleClick">
                {{ timer.isRunning ? "暂停" : "开始" }}
              </button>
              <button class="btn btn-reset" @click="onResetClick">重置</button>
            </div>

            <p class="status">
              {{
                timer.phase === "running"
                  ? displayMode === "work"
                    ? "专注中..."
                    : "休息中..."
                  : timer.appMode === "plan"
                    ? "准备开始计划"
                    : "准备开始专注工作"
              }}
            </p>
          </div>

          <!-- 音乐播放器（绝对定位在 main 底部居中） -->
          <MusicPlayer />
        </main>
      </div>

      <!-- 手机抽屉遮罩 -->
      <div
        v-if="isMobile && mobileSidebarOpen"
        class="drawer-backdrop"
        @click="closeMobileSidebar"
      />

      <!-- 浮层面板 -->
      <SettingsPanel
        :visible="showSettings"
        @close="showSettings = false"
        @open-auth="showSettings = false; showAuth = true"
      />
      <AuthPanel :visible="showAuth" @update:visible="showAuth = $event" />
      <StudyRoom :visible="showStudyRoom" @update:visible="showStudyRoom = $event" />
      <TutorialModal :visible="showTutorial" @close="showTutorial = false" />
    </div>
  </div>
</template>

<style scoped>
/* ============ 外层容器 - 全视口 ============ */
.window-frame {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: #141414;
}

/* ============ 内层容器 - 实际背景（复用组件 .app-modal-overlay 的定位锚点） ============ */
.container {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: linear-gradient(
    135deg,
    var(--container-gradient-start),
    var(--container-gradient-end)
  );
}

.container.break-mode {
  background: linear-gradient(
    135deg,
    var(--break-gradient-start),
    var(--break-gradient-end)
  );
}

.container.stopwatch-mode {
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.88) 0%, rgba(118, 75, 162, 0.78) 100%);
}

/* ============ 大屏氛围光（填充两侧留白，避免"右侧太空"） ============ */
.container::before,
.container::after {
  content: "";
  position: absolute;
  border-radius: 50%;
  filter: blur(90px);
  pointer-events: none;
  z-index: 0;
}

.container::before {
  width: 70vmin;
  height: 70vmin;
  left: -18vmin;
  top: -18vmin;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.16), transparent 62%);
}

.container::after {
  width: 80vmin;
  height: 80vmin;
  right: -22vmin;
  bottom: -22vmin;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.12), transparent 62%);
}

/* ============ 主体：侧边栏 + 主区域 ============ */
.app-body {
  position: absolute;
  inset: 0;
  display: flex;
  z-index: 1;
}

/* ============ 左侧边栏（桌面常驻，流式宽度；手机为抽屉） ============ */
.sidebar {
  width: clamp(170px, 17vw, 250px);
  height: 100%;
  background: transparent;
  display: flex;
  flex-direction: column;
  /* 左内边距 8px：与左上角模式拨杆（left:8px）左缘对齐，
     品牌/预设/统计全部从同一左缘开始，不再出现"细白线不从最左侧延伸"的缺口 */
  padding: 44px 12px 16px 8px;
  border-right: 1px solid var(--sidebar-border, var(--shell-border));
  flex-shrink: 0;
  overflow: hidden;
  z-index: var(--z-content);
}

.container:not(.break-mode) .sidebar {
  --sidebar-border: var(--sidebar-border-work);
}
.container.break-mode .sidebar {
  --sidebar-border: var(--sidebar-border-break);
}

.sidebar-brand {
  font-size: 18px;
  font-weight: 700;
  color: var(--shell-text-primary);
  margin-bottom: 14px;
  letter-spacing: 0.5px;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  flex-shrink: 0;
  /* 与侧栏内容同左缘（8px），与模式拨杆平齐；番茄不再贴死屏幕左缘 */
}

.sidebar-title {
  font-size: 15px;
  color: var(--shell-text-secondary);
  font-weight: 600;
  margin-bottom: 10px;
  text-align: center;
  flex-shrink: 0;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  line-height: 1.6;
}

.plan-empty-hint {
  text-align: center;
  color: var(--shell-text-muted);
  font-size: 14px;
  line-height: 1.7;
  padding: 20px 0;
}

.plan-list {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.plan-list::-webkit-scrollbar {
  width: 4px;
}
.plan-list::-webkit-scrollbar-track {
  background: transparent;
}
.plan-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
}

.plan-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 10px;
  border-radius: var(--shell-radius-sm);
  margin-bottom: 6px;
  font-size: 14px;
  line-height: 1.5;
  color: var(--shell-text-primary);
  transition: all 0.2s ease;
}

.plan-item.work {
  background: rgba(233, 69, 96, 0.2);
  border: 1px solid rgba(233, 69, 96, 0.3);
}

.plan-item.break {
  background: rgba(76, 175, 80, 0.2);
  border: 1px solid rgba(76, 175, 80, 0.3);
}

.plan-item.active {
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.5);
}

.plan-item.disabled {
  opacity: 0.6;
}

.plan-item__icon {
  font-size: 14px;
}

.plan-item__time {
  flex: 1;
  font-weight: 600;
}

.plan-item__delete {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: var(--shell-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}

.plan-item__delete:hover {
  background: rgba(255, 100, 100, 0.3);
  color: #fff;
}

.plan-add-buttons {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  flex-shrink: 0;
}

.btn-add-plan {
  flex: 1;
  padding: 10px 0;
  border: none;
  border-radius: var(--shell-radius-sm);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-add-work {
  background: rgba(233, 69, 96, 0.3);
  color: #fff;
}

.btn-add-work:hover {
  background: rgba(233, 69, 96, 0.5);
}

.btn-add-break {
  background: rgba(76, 175, 80, 0.3);
  color: #fff;
}

.btn-add-break:hover {
  background: rgba(76, 175, 80, 0.5);
}

.stopwatch-description {
  padding: 20px 5px;
  color: var(--shell-text-primary);
  text-align: center;
  line-height: 2;
  font-size: 15px;
}

.stopwatch-description p {
  margin: 8px 0;
  font-weight: 500;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.stopwatch-description p:last-child {
  margin-top: 18px;
  font-size: 14px;
  color: var(--shell-text-secondary);
  line-height: 1.8;
  padding: 12px 12px;
  background: var(--shell-surface);
  border-radius: var(--shell-radius-sm);
  border-left: 3px solid rgba(255, 255, 255, 0.4);
  font-weight: 500;
}

/* ============ 侧边栏统计 ============ */
.sidebar-stats {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 10px;
  border-top: 1px solid var(--shell-border);
  flex-shrink: 0;
}

.stat-item {
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-size: 13px;
  line-height: 1.6;
}

.stat-label {
  color: var(--shell-text-secondary);
  flex: 1;
}

.stat-value {
  font-weight: 600;
  color: var(--shell-text-primary);
  font-size: 16px;
}

.stat-unit {
  color: var(--shell-text-muted);
}

/* ============ 主区域 ============ */
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px;
  position: relative;
  min-width: 0;
}

/* ============ 计时器区域 ============ */
.timer-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 0;
  padding-bottom: 128px;
  width: 100%;
}

/* 播放器收起时让计时器占据更多空间 */
.main:has(.music-player.collapsed) .timer-section {
  padding-bottom: 40px;
}

.title {
  font-size: clamp(20px, 3.5vmin, 26px);
  color: var(--shell-text-primary);
  font-weight: 600;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

/* ============ 计时器圆环容器（尺寸由容器控制，进度环 SVG 自适应填充） ============ */
.timer-container {
  width: clamp(220px, 30vmin, 330px);
  height: clamp(220px, 30vmin, 330px);
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
  position: relative;
}

.timer-container :deep(.progress-ring) {
  width: 100% !important;
  height: 100% !important;
}

.timer-inner {
  position: absolute;
  inset: 18px;
  border-radius: 50%;
  background: linear-gradient(145deg, var(--shell-surface), rgba(255, 255, 255, 0.03));
  display: flex;
  justify-content: center;
  align-items: center;
  box-shadow: inset 0 0 20px rgba(255, 255, 255, 0.08);
  border: 2px solid rgba(255, 255, 255, 0.12);
}

/* ============ 按钮（触摸友好 ≥44px） ============ */
.buttons {
  display: flex;
  gap: 14px;
}

.btn {
  height: 46px;
  border: none;
  border-radius: 23px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  justify-content: center;
  align-items: center;
}

.btn-start {
  width: clamp(110px, 14vw, 150px);
  background: linear-gradient(145deg, var(--shell-surface-strong), var(--shell-surface));
  color: #fff;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
}

.btn-start:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
}

.btn-start:active {
  transform: translateY(0);
}

.btn-reset {
  width: clamp(80px, 9vw, 110px);
  background: var(--shell-btn-bg);
  color: #fff;
  border: 1px solid var(--shell-btn-border);
}

.btn-reset:hover {
  background: var(--shell-btn-bg-hover);
  transform: translateY(-2px);
}

/* ============ 状态文本 ============ */
.status {
  font-size: 14px;
  color: var(--shell-text-secondary);
  line-height: 1.6;
}

/* ============ 模式切换动画 ============ */
.main.mode-animating .timer-section {
  animation: modeSwitchFade 0.32s cubic-bezier(0.4, 0, 0.2, 1);
}

@keyframes modeSwitchFade {
  0% {
    opacity: 0;
    transform: translateY(8px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ============================================================
   大屏（≥1200px 宽）：整块居中限宽 + 尺寸上档，避免横屏"右侧太空"
   ============================================================ */
@media (min-width: 1200px) {
  .app-body {
    max-width: clamp(1100px, 86vw, 1560px);
    margin: 0 auto;
  }

  .sidebar {
    width: clamp(210px, 13vw, 300px);
  }

  .sidebar-brand {
    font-size: 22px;
  }

  .sidebar-title {
    font-size: 17px;
  }

  .timer-container {
    width: clamp(280px, 30vmin, 400px);
    height: clamp(280px, 30vmin, 400px);
  }

  .timer-section {
    gap: 14px;
  }

  .title {
    font-size: clamp(28px, 2vw, 34px);
  }

  .btn {
    height: 56px;
    border-radius: 28px;
    font-size: 17px;
  }

  .btn-start {
    width: clamp(150px, 10vw, 200px);
  }

  .btn-reset {
    width: clamp(100px, 6vw, 130px);
  }

  .status {
    font-size: 15px;
  }
}

/* ============================================================
   4K / 高分辨率（≥1920px 宽 且 ≥1200px 高）：再上档，按钮更大
   ============================================================ */
@media (min-width: 1920px) and (min-height: 1200px) {
  .app-body {
    max-width: clamp(1300px, 80vw, 1760px);
  }

  .sidebar {
    width: clamp(240px, 12vw, 320px);
  }

  .sidebar-brand {
    font-size: 26px;
  }

  .sidebar-title {
    font-size: 19px;
  }

  .timer-container {
    width: clamp(340px, 28vmin, 460px);
    height: clamp(340px, 28vmin, 460px);
  }

  .timer-section {
    gap: 18px;
  }

  .title {
    font-size: clamp(32px, 1.8vw, 40px);
  }

  .btn {
    height: 64px;
    border-radius: 32px;
    font-size: 19px;
  }

  .btn-start {
    width: clamp(180px, 9vw, 240px);
  }

  .btn-reset {
    width: clamp(120px, 5vw, 150px);
  }

  .status {
    font-size: 16px;
  }
}

/* ============================================================
   手机端（<560px）：顶栏 + 抽屉侧栏 + 触摸优先
   ============================================================ */
@media (max-width: 559px) {
  /* 顶栏 */
  .app-topbar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: var(--shell-header-h);
    display: flex;
    align-items: center;
    z-index: var(--z-header-btn);
    background: rgba(0, 0, 0, 0.14);
  }

  .hamburger {
    width: 40px;
    height: 40px;
    margin-left: 6px;
    border-radius: 12px;
    background: var(--shell-btn-bg);
    border: 1px solid var(--shell-btn-border);
    color: var(--shell-text-primary);
    font-size: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: var(--z-header-btn);
  }

  .hamburger.open {
    background: var(--shell-btn-bg-hover);
  }

  .app-topbar :deep(.mode-slider-container) {
    left: 50px;
    top: 16px;
  }

  /* 功能按钮列：位于主区域右上（主区域起点在顶栏之下），
     避开顶栏半透明黑色蒙版遮挡的区域 */
  .main :deep(.header-buttons) {
    top: 4px;
    left: auto;
    right: 8px;
  }

  /* 主区域占满，顶栏下方留白 */
  .app-body {
    padding-top: var(--shell-header-h);
  }

  .main {
    padding: 14px;
    padding-bottom: 8px;
  }

  /* 侧边栏 → 抽屉 */
  .sidebar {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: min(78vw, 280px);
    padding: 18px 14px 20px 14px;
    background: var(--shell-drawer-bg);
    border-right: 1px solid var(--shell-border);
    transform: translateX(-105%);
    transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
    z-index: var(--z-modal);
    box-shadow: 4px 0 24px rgba(0, 0, 0, 0.35);
  }

  .sidebar.sidebar-open {
    transform: translateX(0);
  }

  .drawer-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: calc(var(--z-modal) - 1);
  }

  /* 计时器与按钮加大（触摸优先） */
  .timer-container {
    width: min(56vw, 250px);
    height: min(56vw, 250px);
  }

  .timer-section {
    gap: 14px;
    padding-bottom: 136px;
  }

  .main:has(.music-player.collapsed) .timer-section {
    padding-bottom: 30px;
  }

  .btn {
    height: 52px;
    border-radius: 26px;
    font-size: 16px;
  }

  .btn-start {
    width: min(56vw, 210px);
  }

  .btn-reset {
    width: min(26vw, 110px);
  }

  .title {
    font-size: 20px;
  }
}

/* ============ 手机顶栏 HeaderButtons 在非顶栏场景的兜底 ============ */
@media (min-width: 560px) and (max-width: 719px) {
  .main :deep(.header-buttons) {
    top: 8px;
  }
}
</style>

<style>
/* PWA 页面级背景（浏览器场景，非桌面透明窗口） */
html,
body {
  background: #141414;
}
</style>
