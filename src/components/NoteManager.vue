<script setup lang="ts">
/**
 * 备注管理
 *
 * 参考 electron/src/scripts/modules/noteManager.js。
 * 当前专注任务的备注输入，完成番茄钟时随统计记录一起保存。
 */
import { ref, watch } from "vue";

const props = defineProps<{
  /** 受控值（v-model） */
  modelValue?: string;
  /** 是否禁用（计时运行中不允许编辑） */
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
}>();

const note = ref(props.modelValue ?? "");

// 外部值变化时同步到本地
watch(
  () => props.modelValue,
  (val) => {
    if (val !== note.value) {
      note.value = val ?? "";
    }
  },
);

function onInput(): void {
  emit("update:modelValue", note.value);
}

function onClear(): void {
  note.value = "";
  emit("update:modelValue", "");
}
</script>

<template>
  <div class="note-manager">
    <input
      v-model="note"
      type="text"
      class="note-manager__input"
      :placeholder="disabled ? '—' : '正在做什么？'"
      :disabled="disabled"
      maxlength="50"
      @input="onInput"
    />
    <button
      v-if="note && !disabled"
      class="note-manager__clear"
      title="清除"
      @click="onClear"
    >
      ×
    </button>
  </div>
</template>

<style scoped>
.note-manager {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  max-width: 280px;
  position: relative;
}

.note-manager__input {
  flex: 1;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  text-align: center;
  transition: border-color 0.15s ease;
}

.note-manager__input:focus {
  border-color: var(--accent);
}

.note-manager__input::placeholder {
  color: var(--text-secondary);
}

.note-manager__input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.note-manager__clear {
  position: absolute;
  right: 6px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  font-size: 14px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.note-manager__clear:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
}
</style>
