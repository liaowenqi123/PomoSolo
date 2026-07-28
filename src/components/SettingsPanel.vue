<script setup lang="ts">
/**
 * 设置面板
 *
 * 参考 electron/src/scripts/modules/settings.js 的核心设置项，
 * 用 Vue 响应式数据替代原来的 DOM 操作。
 *
 * 包含：主题切换、最小化行为、迷你退出方式、开机自启、界面显示开关。
 */
import { computed } from "vue";
import {
  useSettingsStore,
  type MinimizeBehavior,
  type MiniExitMode,
  type Theme,
} from "../stores/settings";

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

const settings = useSettingsStore();

// 本地编辑副本——只在面板可见时同步，避免直接修改 store 导致中途自动保存
const local = computed(() => settings.settings);

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
    | "autoStart"
    | "plantWheelMode"
    | "showHeaderExpandBtn",
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
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.settings-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
}

.settings-panel {
  width: 460px;
  max-width: 90vw;
  max-height: 80vh;
  background: var(--bg-secondary, #16213e);
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
  color: var(--text-primary);
}

.settings-panel__close {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  font-size: 20px;
  color: var(--text-secondary);
  transition: all 0.15s ease;
}

.settings-panel__close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
}

.settings-panel__body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 20px;
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
  color: var(--text-secondary);
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
  color: var(--text-primary);
}

.settings-select {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  cursor: pointer;
}

.settings-select:focus {
  border-color: var(--accent);
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
  color: var(--text-secondary);
  transition: all 0.15s ease;
}

.theme-btn--active {
  background: var(--accent);
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
  background: var(--accent);
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
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.05);
}

.settings-btn--reset:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.1);
}

.settings-btn--save {
  background: var(--accent);
  color: #fff;
}

.settings-btn--save:hover {
  opacity: 0.9;
}

/* Transition */
.panel-enter-active,
.panel-leave-active {
  transition: opacity 0.2s ease;
}

.panel-enter-from,
.panel-leave-to {
  opacity: 0;
}
</style>
