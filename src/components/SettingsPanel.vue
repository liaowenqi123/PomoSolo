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
} from "../stores/settings";
import { checkUpdate, downloadAndInstall, type UpdateStatusPayload } from "@/api/update";
import { useTauriEvent } from "@/api/events";
import { cloudGetSession, type Session } from "@/api/auth";
import {
  submitFeedback,
  getUserFeedbacks,
  deleteFeedback,
  FEEDBACK_STATUS_LABELS,
  type FeedbackItem,
} from "@/api/feedback";

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "open-auth"): void;
}>();

const settings = useSettingsStore();

// 本地编辑副本——只在面板可见时同步，避免直接修改 store 导致中途自动保存
const local = computed(() => settings.settings);

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
let statusTimer: ReturnType<typeof setTimeout> | null = null;

// 监听后端 update-status 事件
useTauriEvent<UpdateStatusPayload>("update-status", (e) => {
  const payload = e.payload;
  switch (payload.status) {
    case "checking":
      updateBtnText.value = "检查中...";
      updateBtnDisabled.value = true;
      updateStatusText.value = "";
      updateProgressVisible.value = false;
      break;
    case "available":
      updateStatusText.value = `发现新版本 v${payload.version}，点击下载`;
      updateStatusType.value = "info";
      updateBtnText.value = "下载更新";
      updateBtnAction.value = "download";
      updateBtnDisabled.value = false;
      updateProgressVisible.value = false;
      break;
    case "not-available":
      updateStatusText.value = "已是最新版本";
      updateStatusType.value = "success";
      updateBtnText.value = "检查更新";
      updateBtnAction.value = "check";
      updateBtnDisabled.value = false;
      updateProgressVisible.value = false;
      if (statusTimer) clearTimeout(statusTimer);
      statusTimer = setTimeout(() => {
        updateStatusText.value = "";
      }, 3000);
      break;
    case "downloading":
      updateProgressVisible.value = true;
      updateProgressPercent.value = payload.percent ?? 0;
      const total = payload.total ?? 0;
      const totalMB = total > 0 ? ` / ${(total / 1048576).toFixed(1)}MB` : "";
      updateProgressText.value = `下载中 ${payload.percent ?? 0}%${totalMB}`;
      updateBtnText.value = "下载中...";
      updateBtnDisabled.value = true;
      break;
    case "downloaded":
      updateStatusText.value = "更新已下载，即将安装重启";
      updateStatusType.value = "success";
      updateProgressVisible.value = false;
      updateBtnText.value = "安装中...";
      updateBtnDisabled.value = true;
      break;
    case "error":
      updateStatusText.value = `更新失败: ${payload.message ?? "未知错误"}`;
      updateStatusType.value = "error";
      updateBtnText.value = "检查更新";
      updateBtnAction.value = "check";
      updateBtnDisabled.value = false;
      updateProgressVisible.value = false;
      break;
  }
});

// 加载版本号
void getVersion().then((v) => {
  appVersion.value = v;
});

async function handleUpdateBtnClick(): Promise<void> {
  if (updateBtnAction.value === "check") {
    await checkUpdate();
  } else {
    updateBtnDisabled.value = true;
    updateBtnText.value = "准备下载...";
    await downloadAndInstall();
  }
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
          <!-- 主题 -->
          <section class="settings-section">
            <h3 class="settings-section__title">主题</h3>
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
          </section>

          <!-- 计时器行为 -->
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

          <!-- 界面显示 -->
          <section class="settings-section">
            <h3 class="settings-section__title">界面显示</h3>
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
              <label class="settings-row__label">显示展开按钮</label>
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

          <!-- 音乐播放器 -->
          <section class="settings-section">
            <h3 class="settings-section__title">音乐播放器</h3>
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
            <div class="settings-row">
              <label class="settings-row__label">检查更新</label>
              <button
                class="update-btn"
                :disabled="updateBtnDisabled"
                @click="handleUpdateBtnClick"
              >
                {{ updateBtnText }}
              </button>
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
            <div class="settings-row">
              <label class="settings-row__label">版本</label>
              <span class="version-text">v{{ appVersion }}</span>
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

.update-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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

.version-text {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
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
