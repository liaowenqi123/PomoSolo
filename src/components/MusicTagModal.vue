<script setup lang="ts">
/**
 * 音乐标签选择弹窗
 *
 * 迁移自 electron/src/scripts/modules/musicPlayer.js 第 257-701 行标签逻辑。
 * 用户点击播放列表中歌曲的标签后弹出，可：
 * 1. 选择预设标签（学习/运动/休息）
 * 2. 添加自定义标签（最多 3 字，带颜色）
 * 3. 选择标签颜色（9 个预设色 + 高级模式下的 HSL 色相滑块）
 * 4. 删除自定义标签
 *
 * 弹窗本身不负责持久化，只 emit 事件由父组件调用 store。
 */
import { ref, watch, computed } from "vue";

interface TagData {
  name: string;
  color: string | null;
}

const props = defineProps<{
  visible: boolean;
  songName: string;
  currentTag: TagData | null;
  customTags: Record<string, string>;
  advancedColorEnabled: boolean;
}>();

const emit = defineEmits<{
  (e: "update:visible", v: boolean): void;
  (e: "select-tag", tag: string, color: string | null): void;
  (e: "add-tag", name: string, color: string): void;
  (e: "delete-tag", name: string): void;
}>();

// ===== 常量 =====
const PRESET_TAGS = ["学习", "运动", "休息"];
const PRESET_COLORS = [
  "#ff6b6b",
  "#ff9f43",
  "#feca57",
  "#5cd85c",
  "#48dbfb",
  "#5f9df7",
  "#a55eea",
  "#ff6b9d",
  "#8c8c8c",
];

// ===== 局部 UI 状态 =====
const customInput = ref("");
const selectedColor = ref<string>(PRESET_COLORS[0]);
const showCustomColorPicker = ref(false);
const hueValue = ref<number>(0);

// 当前标签名（用于高亮 active 项）
const currentTagName = computed(() => props.currentTag?.name || "自定义");

// 合并预设与自定义标签
const allTags = computed<string[]>(() => [
  ...PRESET_TAGS,
  ...Object.keys(props.customTags),
]);

// ===== 颜色工具函数 =====
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function lightenColor(hex: string, amount: number): string {
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + Math.round(255 * amount));
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + Math.round(255 * amount));
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + Math.round(255 * amount));
  return `rgb(${r}, ${g}, ${b})`;
}

function hslToHex(h: number, s: number, l: number): string {
  const sNorm = s / 100;
  const lNorm = l / 100;
  const a = sNorm * Math.min(lNorm, 1 - lNorm);
  const f = (n: number): string => {
    const k = (n + h / 30) % 12;
    const color = lNorm - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

// ===== 标签按钮内联样式 =====
function tagOptionStyle(tag: string): Record<string, string> {
  // 自定义标签使用存储的颜色
  if (props.customTags[tag]) {
    const color = props.customTags[tag];
    return {
      background: hexToRgba(color, 0.4),
      color: lightenColor(color, 0.3),
    };
  }
  // 预设标签使用 data-tag 全局样式（无内联样式）
  return {};
}

// ===== 事件处理 =====
function close() {
  emit("update:visible", false);
}

function handleBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget) {
    close();
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    close();
  }
}

function selectPresetColor(color: string) {
  selectedColor.value = color;
  showCustomColorPicker.value = false;
}

function toggleAdvancedPicker() {
  if (!props.advancedColorEnabled) return;
  showCustomColorPicker.value = !showCustomColorPicker.value;
  if (showCustomColorPicker.value) {
    // 初始化滑块为当前选中颜色的色相
    const hsl = hexToHsl(selectedColor.value);
    hueValue.value = hsl.h;
    selectedColor.value = hslToHex(hsl.h, 80, 55);
  }
}

function onHueInput(e: Event) {
  const target = e.target as HTMLInputElement;
  const hue = parseInt(target.value, 10);
  hueValue.value = hue;
  selectedColor.value = hslToHex(hue, 80, 55);
}

function onTagClick(tag: string) {
  // 自定义标签用存储颜色；预设标签使用选中颜色
  let color: string | null = null;
  if (props.customTags[tag]) {
    color = props.customTags[tag];
  } else if (!PRESET_TAGS.includes(tag)) {
    color = selectedColor.value;
  }
  emit("select-tag", tag, color);
  close();
}

function onDeleteTag(tag: string, e: MouseEvent) {
  e.stopPropagation();
  emit("delete-tag", tag);
}

function onAddCustom() {
  const tagName = customInput.value.trim();
  if (!tagName) return;
  if (tagName.length > 3) return;
  if (PRESET_TAGS.includes(tagName) || props.customTags[tagName]) return;
  const color = selectedColor.value;
  emit("add-tag", tagName, color);
  customInput.value = "";
  close();
}

// 弹窗打开/关闭时重置状态
watch(
  () => props.visible,
  (v) => {
    if (v) {
      customInput.value = "";
      selectedColor.value = PRESET_COLORS[0];
      showCustomColorPicker.value = false;
      hueValue.value = 0;
    }
  },
);
</script>

<template>
  <div
    v-if="visible"
    class="app-modal-overlay music-tag-modal-overlay"
    @click="handleBackdropClick"
    @keydown="handleKeydown"
  >
    <div class="music-tag-modal" role="dialog" aria-modal="true">
      <h3 class="music-tag-modal__title">选择标签</h3>
      <p class="music-tag-modal__song-name">{{ songName }}</p>

      <!-- 标签选项 -->
      <div class="music-tag-modal__options">
        <button
          v-for="tag in allTags"
          :key="tag"
          class="tag-option"
          :class="{ active: tag === currentTagName }"
          :data-tag="tag"
          :style="tagOptionStyle(tag)"
          type="button"
          @click="onTagClick(tag)"
        >
          <span>{{ tag }}</span>
          <span
            v-if="customTags[tag]"
            class="tag-delete-btn"
            :title="`删除标签 ${tag}`"
            @click="onDeleteTag(tag, $event)"
          >×</span>
        </button>
      </div>

      <!-- 自定义标签输入区 -->
      <div class="music-tag-modal__custom">
        <div class="music-tag-modal__custom-row">
          <input
            v-model="customInput"
            type="text"
            class="tag-custom-input"
            placeholder="自定义标签"
            maxlength="3"
          />
        </div>

        <!-- 颜色选择 -->
        <div class="tag-color-section">
          <div class="tag-color-presets">
            <div
              v-for="color in PRESET_COLORS"
              :key="color"
              class="tag-color-preset"
              :class="{ active: color === selectedColor && !showCustomColorPicker }"
              :style="{ background: color }"
              :data-color="color"
              @click="selectPresetColor(color)"
            ></div>
            <!-- 高级模式：第 10 个调色盘按钮 -->
            <div
              v-if="advancedColorEnabled"
              class="tag-color-preset tag-color-advanced"
              :class="{ active: showCustomColorPicker }"
              :style="{ background: selectedColor }"
              title="自定义颜色"
              @click="toggleAdvancedPicker"
            >
              <span class="tag-color-picker-icon">🎨</span>
            </div>
          </div>

          <!-- HSL 色相滑块 -->
          <div v-if="showCustomColorPicker" class="tag-custom-color-picker">
            <div class="color-picker-header">
              <span>自定义颜色</span>
              <div class="color-preview" :style="{ background: selectedColor }"></div>
            </div>
            <div class="color-slider-container">
              <input
                type="range"
                class="color-hue-slider"
                min="0"
                max="360"
                :value="hueValue"
                @input="onHueInput"
              />
            </div>
          </div>
        </div>

        <button class="tag-add-btn" type="button" @click="onAddCustom">添加</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.music-tag-modal-overlay {
  z-index: var(--z-modal-top); /* 高于 Charts / DownloadDialog 等弹窗 */
}

.music-tag-modal {
  background: linear-gradient(135deg, rgba(50, 50, 70, 0.99), rgba(40, 40, 60, 0.99));
  border-radius: 20px;
  padding: 20px 25px;
  width: 340px;
  max-width: 100%;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 8px 24px rgba(0, 0, 0, 0.3);
  color: #fff;
  display: flex;
  flex-direction: column;
}

.music-tag-modal__title {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 8px 0;
  color: #ff8a8a;
}

.music-tag-modal__song-name {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.9);
  margin: 0 0 15px 0;
  word-break: break-all;
}

.music-tag-modal__options {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  margin-top: 10px;
}

.tag-option {
  font-size: 13px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.85);
  background: rgba(255, 255, 255, 0.15);
  padding: 8px 16px;
  border-radius: 14px;
  cursor: pointer;
  transition: all 0.15s ease;
  border: none;
  outline: none;
  display: inline-flex;
  align-items: center;
}

.tag-option:hover {
  transform: scale(1.05);
  filter: brightness(1.2);
}

.tag-option.active {
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.6);
}

/* 预设标签默认配色（与原版 modal.css 一致） */
.tag-option[data-tag="学习"] {
  background: rgba(100, 180, 255, 0.4);
  color: rgba(200, 230, 255, 1);
}

.tag-option[data-tag="运动"] {
  background: rgba(255, 150, 100, 0.4);
  color: rgba(255, 210, 180, 1);
}

.tag-option[data-tag="休息"] {
  background: rgba(100, 230, 100, 0.4);
  color: rgba(200, 255, 200, 1);
}

/* 标签删除按钮 */
.tag-delete-btn {
  margin-left: 8px;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  transition: color 0.15s ease;
  line-height: 1;
}

.tag-delete-btn:hover {
  color: #ff6b6b;
}

/* 自定义标签区域 */
.music-tag-modal__custom {
  margin-top: 18px;
  padding-top: 15px;
  border-top: 1px solid rgba(255, 255, 255, 0.2);
}

.music-tag-modal__custom-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.tag-custom-input {
  flex: 1;
  min-width: 0;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 14px;
  color: #fff;
  outline: none;
  transition: all 0.15s ease;
  box-sizing: border-box;
}

.tag-custom-input::placeholder {
  color: rgba(255, 255, 255, 0.5);
}

.tag-custom-input:focus {
  border-color: rgba(255, 255, 255, 0.5);
  background: rgba(255, 255, 255, 0.18);
}

/* 预设颜色选择 */
.tag-color-section {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 12px 0;
  justify-content: center;
  position: relative;
}

.tag-color-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}

.tag-color-preset {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: all 0.15s ease;
}

.tag-color-preset:hover {
  transform: scale(1.15);
}

.tag-color-preset.active {
  border-color: #fff;
  box-shadow: 0 0 8px rgba(255, 255, 255, 0.4);
}

/* 高级颜色选择器按钮 */
.tag-color-advanced {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tag-color-picker-icon {
  font-size: 12px;
  line-height: 1;
}

.tag-add-btn {
  background: rgba(255, 107, 107, 0.85);
  border: none;
  border-radius: 10px;
  padding: 10px 18px;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
  width: 100%;
  margin-top: 4px;
}

.tag-add-btn:hover {
  background: rgba(255, 107, 107, 1);
  transform: scale(1.02);
}

/* HSL 自定义颜色选择器 */
.tag-custom-color-picker {
  padding: 12px;
  background: rgba(40, 40, 55, 0.99);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  width: 100%;
  box-sizing: border-box;
}

.color-picker-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.color-picker-header span {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
}

.color-preview {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  background: #ff0000;
}

.color-slider-container {
  margin-bottom: 10px;
}

.color-hue-slider {
  width: 100%;
  height: 16px;
  border-radius: 8px;
  background: linear-gradient(
    to right,
    hsl(0, 100%, 50%),
    hsl(60, 100%, 50%),
    hsl(120, 100%, 50%),
    hsl(180, 100%, 50%),
    hsl(240, 100%, 50%),
    hsl(300, 100%, 50%),
    hsl(360, 100%, 50%)
  );
  -webkit-appearance: none;
  appearance: none;
  cursor: pointer;
  outline: none;
}

.color-hue-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  border: 3px solid rgba(0, 0, 0, 0.3);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
  cursor: pointer;
}

.color-hue-slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  border: 3px solid rgba(0, 0, 0, 0.3);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
  cursor: pointer;
}
</style>
