<script setup lang="ts">
/**
 * PomoSolo 主应用
 *
 * 布局严格参照原 Electron 版 index.html：
 *   .window-frame
 *     ├── MiniMode（迷你番茄，运行时可切换）
 *     └── .container（渐变背景，含 appMode / break-mode / plan-mode class）
 *           ├── .draggable（顶部拖动区）
 *           ├── WindowControls（关闭/最小化，右上）
 *           ├── PinButton（置顶，右上）
 *           ├── ModeSlider（单次/计划/正向拨杆，左上）
 *           ├── HeaderButtons（功能按钮列，左上偏下，可展开收起）
 *           ├── .sidebar（左侧：预设/计划/正向说明 + 统计）
 *           ├── SidebarCollapse（侧边栏收起按钮）
 *           ├── .main-content（右侧：标题 + 模式 + 计时器 + 专注 + 按钮 + 音乐）
 *           │     ├── .timer-section
 *           │     └── MusicPlayer（底部音乐播放器）
 *           └── Statistics / SettingsPanel / AIHelper / AuthPanel / StudyRoom / Charts（浮层）
 */
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import Timer from "./components/Timer.vue";
import TimerProgress from "./components/TimerProgress.vue";
import ModeSwitch from "./components/ModeSwitch.vue";
import ModeSlider from "./components/ModeSlider.vue";
import WindowControls from "./components/WindowControls.vue";
import PinButton from "./components/PinButton.vue";
import HeaderButtons from "./components/HeaderButtons.vue";
import SidebarCollapse from "./components/SidebarCollapse.vue";
import FocusModeSwitch from "./components/FocusModeSwitch.vue";
import MiniMode from "./components/MiniMode.vue";
import MusicPlayer from "./components/MusicPlayer.vue";
import SettingsPanel from "./components/SettingsPanel.vue";
import Statistics from "./components/Statistics.vue";
import Presets from "./components/Presets.vue";
import NoteManager from "./components/NoteManager.vue";
import AIHelper from "./components/AIHelper.vue";
import AuthPanel from "./components/AuthPanel.vue";
import StudyRoom from "./components/StudyRoom.vue";
import Charts from "./components/Charts.vue";
import ForegroundWarning from "./components/ForegroundWarning.vue";
import PunishmentResultModal from "./components/PunishmentResultModal.vue";
import TutorialModal from "./components/TutorialModal.vue";
import LoadingOverlay from "./components/LoadingOverlay.vue";
import SpaceTravel from "./components/SpaceTravel.vue";
import { showGardenWindow, enterMiniMode as enterMiniModeApi, exitMiniMode as exitMiniModeApi } from "./api/window";
import { listen } from "@tauri-apps/api/event";
import { useTimerStore, type TimerMode } from "./stores/timer";
import { useSettingsStore } from "./stores/settings";
import { useStatsStore } from "./stores/stats";
import { useGardenStore } from "./stores/garden";
import { useAuthStore } from "./stores/auth";
import {
  foregroundStart,
  foregroundStop,
  foregroundMarkHistoryNot,
  foregroundMoveBlacklistToWhitelist,
  type DetectionResult,
} from "./api/foreground";
import type { PunishmentResult } from "./api/garden";
import type { AiPlanItem } from "./api/ai";

const timer = useTimerStore();
const settings = useSettingsStore();
const stats = useStatsStore();
const garden = useGardenStore();
const auth = useAuthStore();

// ===== ForegroundWarning ref（用于重置警告次数）=====
const fgWarningRef = ref<{ resetWarningCount: () => void } | null>(null);

// ===== 加载状态 =====
const loading = ref(true);

// ===== 面板可见性 =====
const showSettings = ref(false);
const showStats = ref(false);
const showAi = ref(false);
const showAuth = ref(false);
const showStudyRoom = ref(false);
const showCharts = ref(false);
const showForegroundWarning = ref(false);
const showTutorial = ref(false);
/** 隐藏彩蛋：太空旅行（设置面板版本号点击 5 次触发，面板关闭后全屏播放） */
const spaceTravelVisible = ref(false);

// ===== 侧边栏收起 =====
const sidebarCollapsed = ref(false);

// ===== 迷你模式 =====
const miniModeVisible = ref(false);

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

/**
 * 当前"即将开始/正在进行"的计划项类型（work/break），用于容器整体颜色联动。
 * 参照旧版 planMode.js + AppState.updateContainerColor：
 * - 计划运行中 → 当前项（planCurrentIndex）类型
 * - 计划未开始 → 第一项类型（进入计划模式即按第一项着色）
 */
const currentPlanType = computed<TimerMode>(() => {
  if (planRunning.value && planCurrentIndex.value >= 0) {
    return planList.value[planCurrentIndex.value]?.type ?? "work";
  }
  return planList.value[0]?.type ?? "work";
});

/** 当前模式（单次模式用 timer.mode，计划模式用当前计划项类型） */
const displayMode = computed<TimerMode>(() =>
  timer.appMode === "plan" ? currentPlanType.value : timer.mode,
);

/** 应用计划项到计时器（类型 + 时长，参照旧版 Timer.setTime + updateContainerColor） */
function applyPlanItem(item: PlanItem): void {
  timer.setMode(item.type);
  timer.setTime(item.minutes);
}

/** 开始执行计划（从第一项） */
function startPlan(): void {
  if (planList.value.length === 0) return;
  planRunning.value = true;
  planCurrentIndex.value = 0;
  applyPlanItem(planList.value[0]);
  timer.start();
}

/** 进入下一个计划项（1s 后自动开始，参照旧版 handlePlanModeComplete） */
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
    // 计划全部完成
    planRunning.value = false;
    planCurrentIndex.value = -1;
  }
}

/** 停止计划 */
function stopPlan(): void {
  planRunning.value = false;
  planCurrentIndex.value = -1;
}

// 离开计划模式时停止计划状态
watch(
  () => timer.appMode,
  (mode) => {
    if (mode !== "plan") {
      stopPlan();
    }
  },
);

// ===== container 上的 class =====
const themeClass = computed(() => (settings.isDark ? "dark-theme" : ""));
const modeClass = computed(() =>
  displayMode.value === "break" ? "break-mode" : "",
);
const appModeClass = computed(() => {
  if (timer.appMode === "plan") return "plan-mode";
  if (timer.appMode === "stopwatch") return "stopwatch-mode";
  return "";
});

// ===== 深色模式：将 dark-theme class 同步到 document.documentElement =====
// global.css 中 body.dark-theme 选择器才能生效（Vue 应用挂载在 #app，body 在 index.html）
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
  await Promise.all([settings.load(), stats.load(), garden.load()]);
  timer.todayCount = stats.todayCount;
  timer.totalMinutes = stats.totalMinutes;
  timer.init();
  // 初始化认证 store（加载模式 + 测试连接 + 恢复会话）
  void auth.init();
  // 应用初始深色模式
  document.documentElement.classList.toggle("dark-theme", settings.isDark);
  document.body.classList.toggle("dark-theme", settings.isDark);
  window.addEventListener("keydown", handleKeydown);
  // 加载完成，延迟一点让进度条到 90% 后淡出
  setTimeout(() => {
    loading.value = false;
  }, 800);

  // 监听迷你模式下任务栏关闭事件 → 退出迷你模式（仅在 Tauri 环境生效）
  void listen("exit-mini-mode-from-close", () => {
    exitMiniMode();
  }).catch(() => {});
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeydown);
});

// ===== 完成事件 → 记录统计 =====
watch(
  () => timer.completionId,
  async (id, prevId) => {
    if (id > prevId) {
      const minutes = timer.lastCompletedMinutes;
      await stats.recordSession(minutes, note.value);
      timer.todayCount = stats.todayCount;
      timer.totalMinutes = stats.totalMinutes;
      void garden.addFocus(minutes);
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
    showStats.value = false;
    showAi.value = false;
    showAuth.value = false;
    showStudyRoom.value = false;
    showCharts.value = false;
  }
}

// ===== 侧边栏收起 =====
function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
}

// ===== 专注模式（奖惩机制核心）=====
// 专注模式 = 奖惩开关：开启后番茄钟运行中不可暂停、不可轻易重置（重置=中断=惩罚），
// 菜园子每分钟成长（garden.grow），前台检测启动（work 模式）；
// 关闭（警告 3 次 / 运行中重置 / 手动关闭开关）→ 花园未成熟作物枯萎 + 损失弹窗。
const focusModeEnabled = ref(false);

/** 本次专注模式会话起始时的完成信号（用于判断本会话是否完成过番茄钟） */
const focusSessionBaseId = ref(0);

/** 惩罚结果弹窗 */
const showPunishmentResult = ref(false);
const punishmentResult = ref<PunishmentResult | null>(null);

/** 每分钟菜园成长定时器（仅专注模式开启且计时器运行中） */
let growTimer: ReturnType<typeof setInterval> | null = null;
function stopGrowTimer(): void {
  if (growTimer) {
    clearInterval(growTimer);
    growTimer = null;
  }
}
function startGrowTimer(): void {
  if (growTimer) return;
  growTimer = setInterval(() => {
    // 仅当仍处于专注模式运行中才继续成长，防止迟到 tick
    if (focusModeEnabled.value && timer.phase === "running") {
      void garden.grow(1).catch(() => {});
    } else {
      stopGrowTimer();
    }
  }, 60000);
}

/** 专注模式联动：前台检测启停 + 每分钟菜园成长 */
watch(
  () => [focusModeEnabled.value, timer.phase, timer.mode] as const,
  ([enabled, phase, mode]) => {
    // 前台检测：专注模式 + running + work 模式才检测
    if (enabled && phase === "running" && mode === "work") {
      void foregroundStart().catch((e) => console.warn("[foreground] start failed:", e));
    } else {
      void foregroundStop().catch((e) => console.warn("[foreground] stop failed:", e));
    }
    // 菜园成长：专注模式 + running 期间每分钟成长（work/break 都成长，与旧版一致）
    if (enabled && phase === "running") {
      startGrowTimer();
    } else {
      stopGrowTimer();
    }
  },
);

/**
 * 执行惩罚（专注模式被中断的统一入口）
 * - 停止前台检测与成长
 * - 花园未成熟作物枯萎，取得损失明细
 * - 重置计时器
 * - 关闭专注模式
 * - 弹出损失提示
 */
async function runPunishment(): Promise<void> {
  stopGrowTimer();
  void foregroundStop().catch(() => {});
  // 花园枯萎（Rust 清空所有未成熟作物并返回损失明细）
  const result = await garden.punish(0);
  punishmentResult.value = result;
  showPunishmentResult.value = true;
  // 计划模式下中断 → 停止整个计划
  if (timer.appMode === "plan") {
    stopPlan();
  }
  // 重置计时器（若运行中则中断；非运行中无效果）
  timer.reset();
  // 关闭专注模式
  focusModeEnabled.value = false;
}

/**
 * 专注模式开关切换
 * - 开启：进入奖惩机制，记录本会话起始 completionId；若计时器正在运行则立即启动成长/检测
 * - 关闭：手动关闭 = 放弃专注承诺 → 触发惩罚；
 *   例外：本会话已完成过番茄钟（completionId 有增长）→ 仅关闭开关，不惩罚（承诺已兑现）
 */
async function onFocusModeToggle(active: boolean): Promise<void> {
  if (active) {
    focusModeEnabled.value = true;
    focusSessionBaseId.value = timer.completionId;
    if (timer.phase === "running") {
      startGrowTimer();
      if (timer.mode === "work") {
        void foregroundStart().catch((e) => console.warn("[foreground] start failed:", e));
      }
    }
    return;
  }
  // 手动关闭
  if (timer.completionId > focusSessionBaseId.value) {
    // 本会话已完成过番茄钟（专注承诺已兑现）→ 仅关闭开关，不惩罚
    focusModeEnabled.value = false;
    stopGrowTimer();
    void foregroundStop().catch(() => {});
    return;
  }
  await runPunishment();
}

/** 开始/暂停按钮：专注模式运行中禁止暂停（奖惩机制）；计划模式下未运行时点击开始整个计划 */
function onToggleClick(): void {
  // 计划模式：未运行时开始计划（从第一项）；运行中走常规暂停/继续
  if (timer.appMode === "plan" && !planRunning.value) {
    startPlan();
    return;
  }
  if (focusModeEnabled.value && timer.phase === "running") return;
  timer.toggle();
}

/** 重置按钮：专注模式运行中重置 = 中断专注 → 惩罚；计划模式运行中重置 = 停止整个计划 */
function onResetClick(): void {
  if (focusModeEnabled.value && timer.phase === "running") {
    void runPunishment();
    return;
  }
  if (timer.appMode === "plan" && planRunning.value) {
    stopPlan();
  }
  timer.reset();
}

// ===== 前台娱乐检测惩罚（三次警告 → 断掉专注模式）=====
async function onPunishment(): Promise<void> {
  await runPunishment();
}

// ===== 模式切换动画 =====
// 拨杆切换 appMode 时，给 .main-content 临时加 mode-animating class，
// 触发 .timer-section 淡入+位移过渡动画（参照原版交互体验）
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

// ===== 迷你模式 =====
function exitMiniMode() {
  miniModeVisible.value = false;
  void exitMiniModeApi();
}

// ===== 最小化按钮 → 迷你模式 =====
async function onMinimize() {
  // 计时器运行中时进入迷你模式，否则直接最小化
  if (timer.isRunning && settings.settings.minimizeBehavior === "tray") {
    miniModeVisible.value = true;
    void enterMiniModeApi();
  } else {
    try {
      const { minimizeWindow } = await import("./api/window");
      await minimizeWindow();
    } catch (e) {
      console.warn("[App] minimize failed:", e);
    }
  }
}

// 提供 onMinimize 给 WindowControls（通过 provide/inject 或直接修改）


// ===== 菜园子窗口 =====
function onGardenClick() {
  // 正向计时模式下菜园子不可用
  if (timer.appMode === "stopwatch") {
    alert("正向计时模式下菜园子不可用");
    return;
  }
  void showGardenWindow();
}

// ===== AI 计划应用 =====
function onApplyAiPlan(plan: AiPlanItem[]): void {
  // 将 AI 返回的计划写入 planList
  planList.value = plan.map((item) => ({
    id: planIdCounter++,
    minutes: item.minutes,
    type: item.type,
    note: item.description,
  }));
  // 切换到计划模式
  timer.setAppMode("plan");
}

// ===== “不是娱乐”误判纠正（对齐旧版 foregroundDetection.js 的 handleNotEntertainment） =====
async function onNotEntertainment(result: DetectionResult): Promise<void> {
  try {
    if (result.source === "blacklist" && result.keyword) {
      // 来自黑名单：将关键词从黑名单移到白名单
      await foregroundMoveBlacklistToWhitelist(result.keyword);
    } else if (
      (result.source === "history" || result.source === "ai") &&
      result.windowTitle
    ) {
      // 来自历史记录或 AI 判断：将历史记录中的该项标记为“不是”
      await foregroundMarkHistoryNot(result.windowTitle);
    }
  } catch (e) {
    console.warn("[foreground] 名单纠正失败:", e);
  }
}

// ===== 新专注周期开始时重置前台警告次数 =====
watch(
  () => timer.phase,
  (phase) => {
    if (phase === "running") {
      // 使用 typeof 守卫，避免 ForegroundWarning 被 stub 时 ref 无此方法
      const ref = fgWarningRef.value as { resetWarningCount?: () => void } | null;
      if (typeof ref?.resetWarningCount === "function") {
        ref.resetWarningCount();
      }
    }
  },
);
</script>

<template>
  <div class="window-frame" :class="{ 'mini-mode-active': miniModeVisible }">
    <!-- 加载进度条 -->
    <LoadingOverlay :visible="loading" />

    <!-- 迷你模式 -->
    <MiniMode :visible="miniModeVisible" @expand="exitMiniMode" />

    <div
      v-show="!miniModeVisible"
      class="container"
      :class="[themeClass, modeClass, appModeClass, { 'sidebar-collapsed': sidebarCollapsed }]"
    >
      <!-- 顶部拖动区 -->
      <div class="draggable"></div>

      <!-- 右上角窗口控制按钮 -->
      <WindowControls :on-minimize="onMinimize" />

      <!-- 右上角置顶按钮 -->
      <PinButton />

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

        <!-- 统计信息 -->
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
        <!-- 左上角功能按钮列（教程/设置 + 展开后更多）- 在 main-content 内部 -->
        <HeaderButtons
          @tutorial="showTutorial = true"
          @settings="showSettings = true"
          @theme="settings.toggleTheme()"
          @stats="showStats = true"
          @ai="showAi = true"
          @study-room="showStudyRoom = true"
          @garden="onGardenClick"
          @auth="showAuth = true"
          @charts="showCharts = true"
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

          <!-- 专注模式开关（正向模式隐藏） -->
          <FocusModeSwitch
            v-if="timer.appMode !== 'stopwatch'"
            :disabled="timer.phase !== 'ready'"
            v-model="focusModeEnabled"
            @toggle="onFocusModeToggle"
          />

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
        <MusicPlayer @charts="showCharts = true" />
      </div>

      <!-- 浮层面板 -->
      <Statistics :visible="showStats" @close="showStats = false" />
      <SettingsPanel
        :visible="showSettings"
        @close="showSettings = false"
        @open-auth="showSettings = false; showAuth = true"
        @easter-egg="showSettings = false; spaceTravelVisible = true"
      />
      <AIHelper :visible="showAi" @close="showAi = false" @apply="onApplyAiPlan" />
      <AuthPanel :visible="showAuth" @update:visible="showAuth = $event" />
      <StudyRoom :visible="showStudyRoom" @update:visible="showStudyRoom = $event" />
      <Charts :visible="showCharts" @close="showCharts = false" />
      <ForegroundWarning
        ref="fgWarningRef"
        :visible="showForegroundWarning"
        :active="focusModeEnabled && timer.phase === 'running'"
        @update:visible="showForegroundWarning = $event"
        @punishment="onPunishment"
        @not-entertainment="onNotEntertainment"
      />
      <PunishmentResultModal
        :visible="showPunishmentResult"
        :result="punishmentResult"
        @update:visible="showPunishmentResult = $event"
      />
      <TutorialModal :visible="showTutorial" @close="showTutorial = false" />
      <!-- 隐藏彩蛋：太空旅行（全屏最顶层，设置面板关闭后依然播放） -->
      <SpaceTravel
        :visible="spaceTravelVisible"
        @update:visible="spaceTravelVisible = $event"
      />
    </div>
  </div>
</template>

<style scoped>
/* ============ 外层容器 - 用于裁剪圆角 ============ */
.window-frame {
  width: 520px;
  height: 560px;
  border-radius: 20px;
  overflow: hidden;
  position: relative;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
}

/* 迷你模式激活时：缩小外层容器以匹配窗口尺寸 180x220，
   否则 body 的 flex 居中会将 520x560 的容器居中，导致 MiniMode 被推出视口外。
   移除 border-radius / overflow:hidden / box-shadow / border，
   让 MiniMode 番茄造型不受外框裁剪，避免出现可见的外框。 */
.window-frame.mini-mode-active {
  width: 180px;
  height: 220px;
  border-radius: 0;
  overflow: visible;
  box-shadow: none;
  border: none;
}

/* ============ 内层容器 - 实际背景 ============ */
/* 与 .window-frame 相同的 border-radius + overflow:hidden，
   确保内层渐变背景、Modal/遮罩层的暗色背景都被裁剪在圆角内，
   避免圆角处出现方形不透明痕迹，以及遮罩暗色扩散到圆角外。
   不会产生双层圆角缝隙：.container 填满 .window-frame，二者圆角一致。 */
.container {
  width: 100%;
  height: 100%;
  border-radius: 20px;
  overflow: hidden;
  background: linear-gradient(
    135deg,
    var(--container-gradient-start),
    var(--container-gradient-end)
  );
  display: flex;
  position: relative;
}

/* 休息模式渐变 */
.container.break-mode {
  background: linear-gradient(
    135deg,
    var(--break-gradient-start),
    var(--break-gradient-end)
  );
}

/* 正向计时模式渐变 */
.container.stopwatch-mode {
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.88) 0%, rgba(118, 75, 162, 0.78) 100%);
}

/* ============ 顶部拖动区 ============ */
.draggable {
  -webkit-app-region: drag;
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 35px;
  z-index: var(--z-base);
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

/* 侧边栏收起：宽度变为 0，内容淡出，不产生透明区域 */
.container.sidebar-collapsed .sidebar {
  width: 0;
  padding-left: 0;
  padding-right: 0;
  border-right: none;
  opacity: 0;
}

/* 侧边栏收起时，左上角模式拨杆（ModeSlider）一并滑出视窗并禁用交互 */
:deep(.mode-slider-container) {
  transition: opacity 0.3s ease,
              transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
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

/* 计划模式空列表提示 */
.plan-empty-hint {
  text-align: center;
  color: rgba(255, 255, 255, 0.5);
  font-size: 12px;
  padding: 20px 0;
}

/* 计划列表 */
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

/* 计划添加按钮 */
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

/* 正向计时说明 */
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
/* 注意：不要设置 overflow:hidden，否则音乐播放器的设备弹框/播放列表/音量滑块
   会被物理裁剪，视觉上表现为"被左侧侧边栏遮挡"。
   圆角裁剪由 .container 的 overflow:hidden 统一负责。 */
/* 不要设置 z-index（如 z-index:1）：那会创建独立层叠上下文，导致内部
   MusicPlayer(z-index:200)/设备列表(z-index:9999) 被困在 main-content 上下文里，
   对外只表现为 z-index:1，被 SidebarCollapse(z-index:10) 覆盖。
   不设 z-index 时，内部元素直接在 .container 上下文中比较：
   MusicPlayer(200) > SidebarCollapse(10)，Modal(3000) > MusicPlayer(200)。 */
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
/* 底部留出空间给绝对定位的音乐播放器 */
/* 默认（展开音乐播放器时）：上方快速腾出空间，无延迟 */
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

/* 音乐播放器收起时：减小底部留白 + 增大间距，挤压上方空间以保持密度平衡 */
/* 收起时上方延迟 0.3s 后慢速过渡，等待播放器先收起 */
.main-content:has(.music-player.collapsed) .timer-section {
  gap: 18px;
  padding-bottom: 20px;
  transition: padding-bottom 0.45s cubic-bezier(0.5, 0, 0.5, 1) 0.3s,
    gap 0.45s cubic-bezier(0.5, 0, 0.5, 1) 0.3s;
}

/* 计时环收起时放大 */
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
/* 默认（展开音乐播放器时）：快速回弹，无延迟 */
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

/* 收起时：慢速放大，带 0.3s 延迟 */
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
/* 拨杆切换 appMode 时，右侧主区域内容淡入+轻微位移，
   与 ModeSlider thumb 的 0.3s 过渡节奏一致 */
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
