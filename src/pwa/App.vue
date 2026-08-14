<script setup lang="ts">
/**
 * PomoSolo PWA 主壳（桌面端 App.vue 的 PWA 裁剪版）
 *
 * 与桌面端布局一致：侧边栏（预设/计划/正向 + 统计计数）+ 主区域（计时器 + 音乐播放器）
 * + 浮层面板（设置/教程/自习室/登录）。真实复用 src/components 与 src/stores：
 * Timer/ModeSwitch/ModeSlider/Presets/NoteManager/TimerProgress/MusicPlayer/
 * SettingsPanel/TutorialModal/StudyRoom/AuthPanel/HeaderButtons/SidebarCollapse/LoadingOverlay
 * 全部原样 import，唯一的差异是底层运输（invoke → PWA shim）。
 *
 * 砍去（PWA v1）：菜园子、专注模式/前台检测、统计与图表面板、AI 助手、
 * 窗口控制/迷你模式、B站下载（待服务器部门接口）。
 *
 * 部门：PWA部门 —— 2026-08 PWA 第一版
 */
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import Timer from "@/components/Timer.vue";
import TimerProgress from "@/components/TimerProgress.vue";
import ModeSwitch from "@/components/ModeSwitch.vue";
import ModeSlider from "@/components/ModeSlider.vue";
import HeaderButtons from "@/components/HeaderButtons.vue";
import SidebarCollapse from "@/components/SidebarCollapse.vue";
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

// ===== 侧边栏收起 =====
const sidebarCollapsed = ref(false);

/** 被砍板块的 HeaderButtons 事件（stats/ai/garden/charts）→ 无操作（按钮已在 PWA 隐藏） */
function showStatsNoop() {
  /* 无操作 */
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
  setTimeout(() => {
    loading.value = false;
  }, 600);
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
  }
}

// ===== 侧边栏收起 =====
function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
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

    <div
      class="container"
      :class="[themeClass, modeClass, appModeClass, { 'sidebar-collapsed': sidebarCollapsed }]"
    >
      <!-- 左上角模式切换拨杆（单次/计划/正向） -->
      <ModeSlider />

      <!-- 左侧边栏 -->
      <div class="sidebar">
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
      </div>

      <!-- 侧边栏收起按钮 -->
      <SidebarCollapse
        v-if="settings.settings.showSidebarCollapseBtn"
        :collapsed="sidebarCollapsed"
        @toggle="toggleSidebar"
      />

      <!-- 右侧主区域 -->
      <div class="main-content" :class="{ 'mode-animating': modeAnimating }">
        <!-- 功能按钮列：教程/设置/登录/自习室（被砍板块按钮已在 PWA 设置中隐藏） -->
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

        <!-- 音乐播放器（绝对定位在 main-content 底部） -->
        <MusicPlayer />
      </div>

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
/* ============ 外层容器 - 全视口（PWA 浏览器场景） ============ */
.window-frame {
  width: 100%;
  height: 100%;
  border-radius: 0;
  overflow: hidden;
  position: relative;
}

/* ============ 内层容器 - 实际背景 ============ */
.container {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: linear-gradient(
    135deg,
    var(--container-gradient-start),
    var(--container-gradient-end)
  );
  display: flex;
  position: relative;
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

/* ============ 左侧边栏 ============ */
.sidebar {
  width: 160px;
  height: 100%;
  background: transparent;
  display: flex;
  flex-direction: column;
  padding: 38px 12px 15px 12px;
  border-right: 1px solid var(--sidebar-border, rgba(255, 255, 255, 0.15));
  flex-shrink: 0;
  overflow: hidden;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1),
              padding 0.3s cubic-bezier(0.4, 0, 0.2, 1),
              opacity 0.2s ease;
}

.container.sidebar-collapsed .sidebar {
  width: 0;
  padding-left: 0;
  padding-right: 0;
  border-right: none;
  opacity: 0;
}

.container.sidebar-collapsed :deep(.mode-slider-container) {
  opacity: 0;
  pointer-events: none;
  transform: translateX(-160px);
}

.container:not(.break-mode) {
  --sidebar-border: var(--sidebar-border-work);
}

.container.break-mode {
  --sidebar-border: var(--sidebar-border-break);
}

.sidebar-title {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.9);
  font-weight: 600;
  margin-bottom: 10px;
  text-align: center;
  flex-shrink: 0;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.plan-empty-hint {
  text-align: center;
  color: rgba(255, 255, 255, 0.5);
  font-size: 12px;
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
  padding: 8px 10px;
  border-radius: 8px;
  margin-bottom: 4px;
  font-size: 12px;
  color: #fff;
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
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: rgba(255, 255, 255, 0.6);
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
  padding: 6px 0;
  border: none;
  border-radius: 8px;
  font-size: 12px;
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
  color: rgba(255, 255, 255, 0.95);
  text-align: center;
  line-height: 2;
  font-size: 14px;
}

.stopwatch-description p {
  margin: 8px 0;
  font-weight: 500;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.stopwatch-description p:last-child {
  margin-top: 18px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
  line-height: 1.6;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 8px;
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
  border-top: 1px solid rgba(255, 255, 255, 0.15);
  flex-shrink: 0;
}

.stat-item {
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-size: 11px;
}

.stat-label {
  color: rgba(255, 255, 255, 0.7);
  flex: 1;
}

.stat-value {
  font-weight: 600;
  color: #fff;
  font-size: 13px;
}

.stat-unit {
  color: rgba(255, 255, 255, 0.6);
}

/* ============ 右侧主区域 ============ */
.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px;
  padding-bottom: 10px;
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
  gap: 8px;
  min-height: 0;
  padding-bottom: 120px;
  transition: padding-bottom 0.15s cubic-bezier(0.5, 0, 0.5, 1) 0s,
    gap 0.15s cubic-bezier(0.5, 0, 0.5, 1) 0s;
}

.main-content:has(.music-player.collapsed) .timer-section {
  gap: 18px;
  padding-bottom: 20px;
  transition: padding-bottom 0.45s cubic-bezier(0.5, 0, 0.5, 1) 0.3s,
    gap 0.45s cubic-bezier(0.5, 0, 0.5, 1) 0.3s;
}

.main-content:has(.music-player.collapsed) .timer-container {
  width: 220px;
  height: 220px;
  transition: width 0.45s cubic-bezier(0.5, 0, 0.5, 1) 0.3s,
    height 0.45s cubic-bezier(0.5, 0, 0.5, 1) 0.3s;
}

.main-content:has(.music-player.collapsed) :deep(.progress-ring) {
  width: 220px;
  height: 220px;
  transition: width 0.45s cubic-bezier(0.5, 0, 0.5, 1) 0.3s,
    height 0.45s cubic-bezier(0.5, 0, 0.5, 1) 0.3s;
}

.title {
  font-size: 24px;
  color: #fff;
  font-weight: 600;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

/* ============ 计时器圆环容器 ============ */
.timer-container {
  width: 200px;
  height: 200px;
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
  position: relative;
  transition: width 0.15s cubic-bezier(0.5, 0, 0.5, 1) 0s,
    height 0.15s cubic-bezier(0.5, 0, 0.5, 1) 0s;
}

.timer-inner {
  width: 165px;
  height: 165px;
  border-radius: 50%;
  background: linear-gradient(
    145deg,
    rgba(255, 255, 255, 0.08),
    rgba(255, 255, 255, 0.03)
  );
  display: flex;
  justify-content: center;
  align-items: center;
  box-shadow: inset 0 0 20px rgba(255, 255, 255, 0.08);
  border: 2px solid rgba(255, 255, 255, 0.12);
  transition: width 0.15s cubic-bezier(0.5, 0, 0.5, 1) 0s,
    height 0.15s cubic-bezier(0.5, 0, 0.5, 1) 0s;
}

.main-content:has(.music-player.collapsed) .timer-inner {
  width: 182px;
  height: 182px;
  transition: width 0.45s cubic-bezier(0.5, 0, 0.5, 1) 0.3s,
    height 0.45s cubic-bezier(0.5, 0, 0.5, 1) 0.3s;
}

/* ============ 按钮 ============ */
.buttons {
  display: flex;
  gap: 12px;
}

.btn {
  width: 70px;
  height: 36px;
  border: none;
  border-radius: 18px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  justify-content: center;
  align-items: center;
}

.btn-start {
  background: linear-gradient(
    145deg,
    rgba(255, 255, 255, 0.3),
    rgba(255, 255, 255, 0.2)
  );
  color: white;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
  width: 90px;
}

.btn-start:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
}

.btn-start:active {
  transform: translateY(0);
}

.btn-reset {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.btn-reset:hover {
  background: rgba(255, 255, 255, 0.25);
  transform: translateY(-2px);
}

/* ============ 状态文本 ============ */
.status {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
}

/* ============ 模式切换动画 ============ */
.main-content.mode-animating .timer-section {
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
</style>

<style>
/* PWA 页面级背景（浏览器场景，非桌面透明窗口） */
html,
body {
  background: #1a1a1a;
}
</style>
