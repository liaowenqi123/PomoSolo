<script setup lang="ts">
/**
 * 预设管理
 *
 * 参照原 Electron 版 presets.js + .preset-list / .preset-item 样式：
 *   工作 / 休息时间预设列表，支持添加 / 删除 / 选中。
 *   添加预设使用滚轮选择器（WheelPicker），1-120 分钟。
 */
import { ref, computed, onMounted } from "vue";
import { useTimerStore } from "../stores/timer";
import { readData, writeData, type JsonObject } from "../api/data";
import WheelPicker from "./WheelPicker.vue";

/** 单条预设 */
interface Preset {
  minutes: number;
  note?: string | null;
}

/** 预设集合 */
interface PresetsData {
  work: Preset[];
  break: Preset[];
}

/** 默认预设（参考 electron utils.js DEFAULT_PRESETS） */
const DEFAULT_PRESETS: PresetsData = {
  work: [15, 25, 45, 60].map((m) => ({ minutes: m, note: null })),
  break: [5, 10, 15].map((m) => ({ minutes: m, note: null })),
};

const STORAGE_KEY = "pomodoro-presets";

const timer = useTimerStore();

// ===== State =====
const presets = ref<PresetsData>({
  work: [...DEFAULT_PRESETS.work],
  break: [...DEFAULT_PRESETS.break],
});
const activeMinutes = ref<number | null>(null);
const newMinutes = ref<number>(25);
const loaded = ref(false);

// ===== Getters =====
const currentMode = computed(() => timer.mode);
const currentList = computed(() => presets.value[currentMode.value]);

// ===== Actions =====

/** 从后端加载预设，失败回退 localStorage */
async function load(): Promise<void> {
  try {
    const raw = await readData();
    const rawPresets = raw.presets as JsonObject | undefined;
    if (rawPresets) {
      presets.value = normalizePresets(rawPresets);
    } else {
      presets.value = { ...DEFAULT_PRESETS };
    }
  } catch {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as JsonObject;
        const rawPresets = (parsed.presets as JsonObject | undefined) ?? parsed;
        presets.value = normalizePresets(rawPresets);
      } catch {
        presets.value = { ...DEFAULT_PRESETS };
      }
    } else {
      presets.value = { ...DEFAULT_PRESETS };
    }
  } finally {
    loaded.value = true;
  }
}

/** 将后端 JsonObject 收敛为 PresetsData */
function normalizePresets(raw: JsonObject): PresetsData {
  const result: PresetsData = { work: [], break: [] };
  for (const mode of ["work", "break"] as const) {
    const arr = raw[mode];
    if (Array.isArray(arr)) {
      result[mode] = arr.map((item) => {
        if (typeof item === "number") {
          return { minutes: item, note: null };
        }
        const obj = item as JsonObject;
        return {
          minutes: typeof obj.minutes === "number" ? obj.minutes : 0,
          note: typeof obj.note === "string" ? obj.note : null,
        };
      });
    } else {
      result[mode] = [...DEFAULT_PRESETS[mode]];
    }
  }
  return result;
}

/** 持久化预设 */
async function persist(): Promise<void> {
  const payload: JsonObject = { presets: presets.value };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // 忽略
  }
  try {
    let fullData: JsonObject = {};
    try {
      fullData = await readData();
    } catch {
      // 读取失败
    }
    await writeData({ ...fullData, ...payload });
  } catch {
    // 后端未就绪
  }
}

/** 选中预设，更新计时器时长 */
function selectPreset(preset: Preset): void {
  if (timer.phase === "running") return;
  activeMinutes.value = preset.minutes;
  const ms = preset.minutes * 60 * 1000;
  timer.totalMs = ms;
  timer.remainingMs = ms;
  timer.phase = "ready";
}

/** 添加预设 */
async function addPreset(): Promise<void> {
  const minutes = newMinutes.value;
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 120) return;

  const list = presets.value[currentMode.value];
  // 不允许重复
  if (list.some((p) => p.minutes === minutes)) return;

  list.push({ minutes, note: null });
  list.sort((a, b) => a.minutes - b.minutes);
  await persist();
}

/** 删除预设 */
async function deletePreset(index: number): Promise<void> {
  const list = presets.value[currentMode.value];
  const removed = list[index];
  list.splice(index, 1);
  if (activeMinutes.value === removed?.minutes) {
    activeMinutes.value = null;
  }
  await persist();
}

onMounted(() => {
  void load();
});
</script>

<template>
  <div class="preset-list scrollable">
    <div
      v-for="(preset, index) in currentList"
      :key="preset.minutes"
      class="preset-item"
      :class="{
        active: activeMinutes === preset.minutes,
        disabled: timer.phase === 'running',
      }"
      @click="selectPreset(preset)"
    >
      <div class="preset-item-left">
        <span class="preset-time">{{ preset.minutes }}分钟</span>
      </div>
      <button
        class="preset-delete"
        title="删除"
        @click.stop="deletePreset(index)"
      >
        ×
      </button>
    </div>
  </div>

  <div class="add-preset-section">
    <div class="wheel-picker-container">
      <WheelPicker v-model="newMinutes" :min="1" :max="120" :disabled="timer.phase === 'running'" />
      <span class="wheel-picker-label">分钟</span>
      <button
        class="btn-add-preset"
        title="添加预设"
        :disabled="timer.phase === 'running'"
        @click="addPreset"
      >
        +
      </button>
    </div>
  </div>
</template>

<style scoped>
.preset-list {
  flex: 0 1 auto;
  max-height: 320px;
  margin-bottom: 10px;
  overflow-y: auto;
}

.preset-list::-webkit-scrollbar {
  width: 5px;
}

.preset-list::-webkit-scrollbar-track {
  background: transparent;
  border-radius: 3px;
}

.preset-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.25);
  border-radius: 3px;
}

.preset-list::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.4);
}

.preset-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  margin-bottom: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid rgba(255, 255, 255, 0.5);
}

.preset-item:hover {
  background: rgba(255, 255, 255, 0.18);
}

.preset-item.active {
  background: rgba(255, 255, 255, 0.25);
  border-color: rgba(255, 255, 255, 0.4);
}

.preset-item.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.preset-item-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.preset-time {
  font-size: 14px;
  font-weight: 600;
  color: #fff;
}

.preset-delete {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  cursor: pointer;
  display: none;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.preset-item:hover .preset-delete {
  display: flex;
}

.preset-delete:hover {
  background: rgba(255, 100, 100, 0.5);
  color: #fff;
}

.add-preset-section {
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.15);
  flex-shrink: 0;
}

.wheel-picker-container {
  display: flex;
  align-items: center;
  gap: 6px;
  color: rgba(255, 255, 255, 0.9);
  font-size: 12px;
}

.wheel-picker-label {
  color: rgba(255, 255, 255, 0.9);
  font-size: 12px;
}

.btn-add-preset {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  font-size: 18px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-add-preset:hover {
  background: rgba(255, 255, 255, 0.25);
}

.btn-add-preset:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
