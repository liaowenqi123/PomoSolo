<script setup lang="ts">
/**
 * 预设管理
 *
 * 参考 electron/src/scripts/modules/presets.js。
 * 工作 / 休息时间预设列表，支持添加 / 删除 / 选中。
 * 选中预设后直接更新计时器 store 的时长。
 */
import { ref, computed, onMounted } from "vue";
import { useTimerStore } from "../stores/timer";
import { readData, writeData, type JsonObject } from "../api/data";

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
        presets.value = normalizePresets(JSON.parse(saved) as JsonObject);
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
  activeMinutes.value = preset.minutes;
  const ms = preset.minutes * 60 * 1000;
  // Pinia setup store 暴露的 ref 可直接写入
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
  <div class="presets">
    <div class="presets__header">
      <span class="presets__title">
        {{ currentMode === "work" ? "工作预设" : "休息预设" }}
      </span>
    </div>

    <div class="presets__list">
      <button
        v-for="(preset, index) in currentList"
        :key="preset.minutes"
        class="preset-item"
        :class="{ 'preset-item--active': activeMinutes === preset.minutes }"
        @click="selectPreset(preset)"
      >
        <span class="preset-item__time">{{ preset.minutes }}分钟</span>
        <span
          class="preset-item__delete"
          title="删除"
          @click.stop="deletePreset(index)"
        >
          ×
        </span>
      </button>
    </div>

    <div class="presets__add">
      <input
        v-model.number="newMinutes"
        type="number"
        min="1"
        max="120"
        class="presets__input"
        placeholder="分钟"
        @keydown.enter="addPreset"
      />
      <button class="presets__add-btn" @click="addPreset">添加</button>
    </div>
  </div>
</template>

<style scoped>
.presets {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 360px;
}

.presets__header {
  display: flex;
  align-items: center;
  justify-content: center;
}

.presets__title {
  font-size: 12px;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 1px;
}

.presets__list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}

.preset-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 13px;
  color: var(--text-secondary);
  transition: all 0.15s ease;
}

.preset-item:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
}

.preset-item--active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.preset-item__time {
  font-variant-numeric: tabular-nums;
}

.preset-item__delete {
  font-size: 16px;
  line-height: 1;
  opacity: 0.5;
  cursor: pointer;
  padding: 0 2px;
}

.preset-item__delete:hover {
  opacity: 1;
}

.presets__add {
  display: flex;
  gap: 6px;
  justify-content: center;
}

.presets__input {
  width: 80px;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
  outline: none;
}

.presets__input:focus {
  border-color: var(--accent);
}

.presets__add-btn {
  padding: 6px 16px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-primary);
  font-size: 13px;
  transition: all 0.15s ease;
}

.presets__add-btn:hover {
  background: rgba(255, 255, 255, 0.15);
}
</style>
