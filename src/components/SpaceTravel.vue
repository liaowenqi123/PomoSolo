<script setup lang="ts">
/**
 * 太空旅行彩蛋动画
 *
 * 隐藏彩蛋（点击设置面板版本号 5 次）触发后的全屏太空动画：
 * 深空背景 + 闪烁星星 + 漂浮行星 + 番茄火箭升空 + 感谢信息。
 * 8 秒后出现"点击任意处或按 ESC 返回"，点击 / ESC 退出。
 *
 * 参照旧版 electron/src/scripts/modules/settings.js 的 launchSpaceTravel
 * 与 index.html 的 #space-travel 容器 + settings.css 动画。
 */
import { ref, watch, onBeforeUnmount } from "vue";

const props = defineProps<{
  /** 是否显示 */
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
}>();

/** 是否允许退出（感谢信息显示后） */
const exitReady = ref(false);
/** 是否正在退出（淡出动画） */
const exiting = ref(false);
/** 未到退出时间就点击时的提示（短暂显示，避免"点击没反应"的困惑） */
const earlyHintVisible = ref(false);

/** 随机生成的星星 */
const stars = ref<Array<{ left: string; top: string; delay: string; duration: string }>>([]);

const STAR_COUNT = 50;
const EXIT_DELAY_MS = 8000;
const EXIT_ANIMATION_MS = 500;
const EARLY_HINT_MS = 1200;

let exitTimer: ReturnType<typeof setTimeout> | null = null;
let earlyHintTimer: ReturnType<typeof setTimeout> | null = null;
let cleanup: (() => void) | null = null;

function generateStars(): void {
  stars.value = Array.from({ length: STAR_COUNT }, () => ({
    left: `${Math.random() * 100}%`,
    top: `${Math.random() * 100}%`,
    delay: `${Math.random() * 2}s`,
    duration: `${1.5 + Math.random() * 1.5}s`,
  }));
}

/** 未到退出时间：短暂提示，让用户知道点击已被接收 */
function showEarlyHint(): void {
  earlyHintVisible.value = true;
  if (earlyHintTimer) clearTimeout(earlyHintTimer);
  earlyHintTimer = setTimeout(() => {
    earlyHintVisible.value = false;
  }, EARLY_HINT_MS);
}

function exitSpaceTravel(): void {
  if (exiting.value) return;
  if (!exitReady.value) {
    showEarlyHint();
    return;
  }
  exiting.value = true;
  emit("update:visible", false);
  // 动画结束后彻底重置（下次触发可重新显示）
  setTimeout(() => {
    exiting.value = false;
    exitReady.value = false;
  }, EXIT_ANIMATION_MS);
}

function onContainerClick(): void {
  exitSpaceTravel();
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape" && props.visible) {
    exitSpaceTravel();
  }
}

// visible 变化时：生成星星、启动退出计时、注册/注销 ESC 监听
// immediate: true 保证首次挂载（visible=true）时同步生成星星并注册监听
watch(
  () => props.visible,
  (v) => {
    if (v) {
      exitReady.value = false;
      exiting.value = false;
      earlyHintVisible.value = false;
      generateStars();
      if (exitTimer) clearTimeout(exitTimer);
      exitTimer = setTimeout(() => {
        exitReady.value = true;
      }, EXIT_DELAY_MS);
      document.addEventListener("keydown", onKeydown);
    } else {
      if (exitTimer) clearTimeout(exitTimer);
      if (earlyHintTimer) clearTimeout(earlyHintTimer);
      document.removeEventListener("keydown", onKeydown);
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (exitTimer) clearTimeout(exitTimer);
  if (earlyHintTimer) clearTimeout(earlyHintTimer);
  document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div
    v-if="visible"
    class="space-travel-container"
    :class="{ 'exit-ready': exitReady, exiting }"
    @click="onContainerClick"
  >
    <div class="space-background"></div>
    <div class="stars-container">
      <div
        v-for="(star, i) in stars"
        :key="i"
        class="star"
        :style="{ left: star.left, top: star.top, animationDelay: star.delay, animationDuration: star.duration }"
      ></div>
    </div>
    <div class="planets-container">
      <div class="planet planet-moon">🌙</div>
      <div class="planet planet-saturn">🪐</div>
      <div class="planet planet-star">⭐</div>
      <div class="planet planet-comet">☄️</div>
    </div>
    <div class="tomato-rocket">
      <div class="tomato-emoji">🍅</div>
      <div class="rocket-trail"></div>
    </div>
    <div class="thank-you-message">
      <div class="message-title">🚀 感谢使用番茄钟</div>
      <div class="message-subtitle">让我们一起专注成长！</div>
      <div v-if="exitReady" class="message-hint">点击任意处或按 ESC 返回</div>
    </div>
    <div v-if="exitReady" class="skip-hint">点击任意处或按 ESC 返回</div>
    <!-- 未到退出时间的点击反馈（短暂提示，避免"点击没反应"） -->
    <div v-if="earlyHintVisible" class="early-hint">彩蛋播放中，稍等片刻即可退出…</div>
  </div>
</template>

<style scoped>
.space-travel-container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 99999;
  overflow: hidden;
  cursor: default;
}

.space-travel-container.exit-ready {
  cursor: pointer;
}

/* 深空背景 */
.space-background {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(to bottom,
    #0a0e27 0%,
    #1a1f3a 30%,
    #2d1b4e 60%,
    #0f1419 100%);
  opacity: 0;
  animation: fadeInSpace 1s ease-out forwards;
}

@keyframes fadeInSpace {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* 星星容器 */
.stars-container {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

/* 单个星星 */
.star {
  position: absolute;
  width: 2px;
  height: 2px;
  background: white;
  border-radius: 50%;
  opacity: 0;
  animation: twinkle 2s ease-in-out infinite;
}

@keyframes twinkle {
  0%, 100% { opacity: 0.3; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.3); }
}

/* 行星容器 */
.planets-container {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.planet {
  position: absolute;
  font-size: 40px;
  opacity: 0;
  filter: drop-shadow(0 0 10px rgba(255, 255, 255, 0.5));
}

.planet-moon {
  top: 20%;
  right: 15%;
  animation: floatPlanet 8s ease-in-out infinite, fadeInPlanet 1s ease-out 0.5s forwards;
}

.planet-saturn {
  top: 35%;
  left: 12%;
  font-size: 50px;
  animation: floatPlanet 10s ease-in-out infinite, fadeInPlanet 1s ease-out 1s forwards;
}

.planet-star {
  top: 15%;
  left: 25%;
  font-size: 30px;
  animation: floatPlanet 6s ease-in-out infinite, fadeInPlanet 1s ease-out 1.5s forwards;
}

.planet-comet {
  top: 50%;
  right: 20%;
  font-size: 35px;
  animation: floatPlanet 9s ease-in-out infinite, fadeInPlanet 1s ease-out 2s forwards;
}

@keyframes floatPlanet {
  0%, 100% { transform: translateY(0px) rotate(0deg); }
  50% { transform: translateY(-20px) rotate(5deg); }
}

@keyframes fadeInPlanet {
  from { opacity: 0; transform: scale(0.5); }
  to { opacity: 0.8; transform: scale(1); }
}

/* 番茄火箭 */
.tomato-rocket {
  position: absolute;
  left: 50%;
  bottom: -100px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  animation: flyUp 8s ease-in-out forwards;
}

.tomato-emoji {
  font-size: 60px;
  filter: drop-shadow(0 0 20px rgba(255, 107, 107, 0.8));
  animation: tomatoWobble 0.5s ease-in-out infinite;
}

.rocket-trail {
  width: 20px;
  height: 60px;
  background: linear-gradient(to bottom,
    rgba(255, 107, 107, 0.8) 0%,
    rgba(255, 200, 100, 0.5) 50%,
    transparent 100%);
  border-radius: 50%;
  filter: blur(5px);
  animation: trailFlicker 0.2s ease-in-out infinite;
}

@keyframes flyUp {
  0% {
    bottom: -100px;
    opacity: 0;
  }
  10% {
    opacity: 1;
  }
  80% {
    bottom: 60%;
    opacity: 1;
  }
  100% {
    bottom: 55%;
    opacity: 1;
  }
}

@keyframes tomatoWobble {
  0%, 100% { transform: rotate(-5deg); }
  50% { transform: rotate(5deg); }
}

@keyframes trailFlicker {
  0%, 100% { opacity: 0.6; height: 60px; }
  50% { opacity: 1; height: 70px; }
}

/* 感谢信息 */
.thank-you-message {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  opacity: 0;
  animation: showMessage 2s ease-out 6s forwards;
  pointer-events: none;
}

.message-title {
  font-size: 28px;
  font-weight: bold;
  color: white;
  text-shadow: 0 0 20px rgba(255, 107, 107, 0.8),
              0 0 40px rgba(255, 107, 107, 0.5);
  margin-bottom: 10px;
  white-space: nowrap;
}

.message-subtitle {
  font-size: 18px;
  color: rgba(255, 255, 255, 0.9);
  text-shadow: 0 0 10px rgba(255, 255, 255, 0.5);
  margin-bottom: 20px;
}

.message-hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 30px;
}

@keyframes showMessage {
  from {
    opacity: 0;
    transform: translate(-50%, -40%) scale(0.8);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
}

/* 跳过提示 */
.skip-hint {
  position: absolute;
  bottom: 30px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 14px;
  color: rgba(255, 255, 255, 0.6);
  opacity: 0;
  animation: fadeInHint 1s ease-out 8s forwards;
  pointer-events: none;
}

/* 未到退出时间的点击反馈 */
.early-hint {
  position: absolute;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 13px;
  color: rgba(255, 255, 255, 0.75);
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 20px;
  padding: 6px 16px;
  pointer-events: none;
  animation: earlyHintPulse 1.2s ease-in-out infinite;
}

@keyframes earlyHintPulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}

@keyframes fadeInHint {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* 退出动画 */
.space-travel-container.exiting {
  animation: fadeOutSpace 0.5s ease-out forwards;
}

@keyframes fadeOutSpace {
  from { opacity: 1; }
  to { opacity: 0; }
}
</style>
