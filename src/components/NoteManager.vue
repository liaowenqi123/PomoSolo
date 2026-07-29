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
/* 备注框 - 绝对定位在 timer-container 内顶部，居中且不顶到时钟圆框 */
.note-manager {
  position: absolute;
  top: 50px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: 100px;
  width: 100px;
  z-index: 10;
  animation: fadeInDown 0.3s ease;
}

@keyframes fadeInDown {
  from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}

.note-manager__input {
  flex: 1;
  padding: 4px 8px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.25);
  color: #fff;
  font-size: 11px;
  font-family: inherit;
  outline: none;
  text-align: center;
  transition: border-color 0.15s ease;
  height: 26px;
  min-width: 0;
}

.note-manager__input:focus {
  border-color: rgba(255, 255, 255, 0.5);
  background: rgba(255, 255, 255, 0.15);
}

.note-manager__input::placeholder {
  color: rgba(255, 255, 255, 0.5);
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
  color: rgba(255, 255, 255, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.note-manager__clear:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}
</style>
