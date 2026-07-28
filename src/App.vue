<script setup lang="ts">
import Timer from "./components/Timer.vue";
import TimerProgress from "./components/TimerProgress.vue";
import ModeSwitch from "./components/ModeSwitch.vue";
import { useTimerStore } from "./stores/timer";
import { onMounted, onUnmounted } from "vue";

const timer = useTimerStore();

onMounted(() => {
  timer.init();
  window.addEventListener("keydown", handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeydown);
});

function handleKeydown(e: KeyboardEvent) {
  if (e.code === "Space" && e.target === document.body) {
    e.preventDefault();
    timer.toggle();
  }
}
</script>

<template>
  <div class="app" :class="{ 'app--break': timer.mode === 'break' }">
    <div class="app__container">
      <ModeSwitch />
      <TimerProgress />
      <Timer />
    </div>
  </div>
</template>

<style scoped>
.app {
  --bg-primary: #1a1a2e;
  --bg-secondary: #16213e;
  --accent: #e94560;
  --text-primary: #eee;
  --text-secondary: #888;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-primary);
  color: var(--text-primary);
  transition: background 0.3s ease;
}

.app--break {
  --bg-primary: #0f3460;
  --accent: #4ecca3;
}

.app__container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
}
</style>
