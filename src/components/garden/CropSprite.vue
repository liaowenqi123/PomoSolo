<script setup lang="ts">
/**
 * 菜园子 - 作物 SVG 精灵（手绘 Q 版 · 渐变质感增强版）
 *
 * 5 种作物 × 3 生长阶段：1 幼苗 / 2 成株 / 3 成熟。
 * 统一 viewBox="0 0 64 64"、底部带土丘，格子里居中放大。
 * 阶段由父组件按 progress/growTime 计算传入。
 *
 * 每个实例生成唯一 id 后缀，保证多格子共存时 SVG 渐变引用不串。
 */
import { computed } from "vue";

const props = defineProps<{
  crop: string;
  stage: 1 | 2 | 3;
  /** 枯萎态：植物垂头枯黄（专注模式中断惩罚后） */
  wilted?: boolean;
}>();

const uid = `cs${Math.random().toString(36).slice(2, 9)}`;
const soilGrad = computed(() => `url(#soil-${uid})`);
const stemGrad = computed(() => `url(#stem-${uid})`);
const leafGrad = computed(() => `url(#leaf-${uid})`);
const leafDarkGrad = computed(() => `url(#leafDark-${uid})`);
const rootGrad = computed(() => `url(#root-${uid})`);
const fruitGrad = computed(() => `url(#fruit-${uid})`);
const petalGrad = computed(() => `url(#petal-${uid})`);
const coreGrad = computed(() => `url(#core-${uid})`);
const trunkGrad = computed(() => `url(#trunk-${uid})`);
const crownGrad = computed(() => `url(#crown-${uid})`);
const rosePetalGrad = computed(() => `url(#rosePetal-${uid})`);
const roseCoreGrad = computed(() => `url(#roseCore-${uid})`);
const blossomGrad = computed(() => `url(#blossom-${uid})`);
</script>

<template>
  <svg class="crop-sprite" viewBox="0 0 64 64" aria-hidden="true">
    <defs>
      <!-- 土壤：上浅下深（明暗对比加强） -->
      <linearGradient :id="`soil-${uid}`" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#c08a52" />
        <stop offset="40%" stop-color="#8a5a33" />
        <stop offset="100%" stop-color="#452a10" />
      </linearGradient>
      <!-- 茎：渐变描边 -->
      <linearGradient :id="`stem-${uid}`" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stop-color="#5c9a3d" />
        <stop offset="100%" stop-color="#7ec850" />
      </linearGradient>
      <!-- 叶子：亮绿渐变 -->
      <linearGradient :id="`leaf-${uid}`" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0%" stop-color="#5fae45" />
        <stop offset="100%" stop-color="#8fd468" />
      </linearGradient>
      <!-- 深色叶/树冠（备用加深） -->
      <linearGradient :id="`leafDark-${uid}`" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0%" stop-color="#3f7a32" />
        <stop offset="100%" stop-color="#63b04a" />
      </linearGradient>
      <!-- 胡萝卜根：橙渐变 -->
      <linearGradient :id="`root-${uid}`" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ffb347" />
        <stop offset="100%" stop-color="#e07b2f" />
      </linearGradient>
      <!-- 番茄果实：径向高光 -->
      <radialGradient :id="`fruit-${uid}`" cx="0.38" cy="0.3" r="0.75">
        <stop offset="0%" stop-color="#ff9588" />
        <stop offset="55%" stop-color="#f0534d" />
        <stop offset="100%" stop-color="#c2322e" />
      </radialGradient>
      <!-- 花瓣：亮黄 -->
      <linearGradient :id="`petal-${uid}`" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ffe066" />
        <stop offset="100%" stop-color="#f2a63a" />
      </linearGradient>
      <!-- 花盘中心 -->
      <radialGradient :id="`core-${uid}`" cx="0.5" cy="0.42" r="0.6">
        <stop offset="0%" stop-color="#c9965a" />
        <stop offset="100%" stop-color="#7c5326" />
      </radialGradient>
      <!-- 树干 -->
      <linearGradient :id="`trunk-${uid}`" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stop-color="#6e4523" />
        <stop offset="100%" stop-color="#a26a3a" />
      </linearGradient>
      <!-- 树冠：径向绿 -->
      <radialGradient :id="`crown-${uid}`" cx="0.45" cy="0.35" r="0.7">
        <stop offset="0%" stop-color="#8ad06a" />
        <stop offset="70%" stop-color="#5aa743" />
        <stop offset="100%" stop-color="#3f7a32" />
      </radialGradient>
      <!-- 玫瑰花瓣 -->
      <radialGradient :id="`rosePetal-${uid}`" cx="0.35" cy="0.3" r="0.8">
        <stop offset="0%" stop-color="#ff9daf" />
        <stop offset="100%" stop-color="#e0556f" />
      </radialGradient>
      <!-- 玫瑰核心 -->
      <radialGradient :id="`roseCore-${uid}`" cx="0.4" cy="0.35" r="0.75">
        <stop offset="0%" stop-color="#ff7b93" />
        <stop offset="100%" stop-color="#c23d56" />
      </radialGradient>
      <!-- 金桂花 -->
      <radialGradient :id="`blossom-${uid}`" cx="0.4" cy="0.35" r="0.7">
        <stop offset="0%" stop-color="#ffdf7e" />
        <stop offset="100%" stop-color="#e8a82e" />
      </radialGradient>
    </defs>

    <!-- ========== 植物部分：独立摇摆动画，底部会被土壤覆盖层遮挡 ========== -->
    <g class="cs-plant" :class="{ 'cs-wilted': wilted }">
    <!-- ========== 胡萝卜（地下根 + 缨子） ========== -->
    <g v-if="crop === 'carrot'">
      <g v-if="stage === 1">
        <path class="cs-stem" :stroke="stemGrad" d="M32 44 C31 40 31 37 32 33" />
        <path class="cs-leaf" :fill="leafGrad" d="M32 37 C25 36 22 30 26 26 C33 28 35 33 32 37 Z" />
        <path class="cs-leaf" :fill="leafDarkGrad" d="M32 37 C39 36 42 30 38 26 C31 28 29 33 32 37 Z" />
      </g>
      <g v-else-if="stage === 2">
        <path class="cs-stem" :stroke="stemGrad" d="M32 44 C31 38 31 34 32 28" />
        <path class="cs-leaf" :fill="leafGrad" d="M32 33 C24 32 19 25 25 20 C33 22 35 28 32 33 Z" />
        <path class="cs-leaf" :fill="leafDarkGrad" d="M32 33 C40 32 45 25 39 20 C31 22 29 28 32 33 Z" />
        <path class="cs-leaf" :fill="leafGrad" d="M32 40 C26 40 23 35 27 31 C32 32 34 36 32 40 Z" />
        <path class="cs-leaf" :fill="leafDarkGrad" d="M32 40 C38 40 41 35 37 31 C32 32 30 36 32 40 Z" />
      </g>
      <g v-else>
        <path class="cs-stem" :stroke="stemGrad" d="M32 44 C31 37 31 33 32 26" />
        <path class="cs-leaf" :fill="leafGrad" d="M32 32 C23 31 18 23 25 18 C34 20 36 27 32 32 Z" />
        <path class="cs-leaf" :fill="leafDarkGrad" d="M32 32 C41 31 46 23 39 18 C30 20 28 27 32 32 Z" />
        <path class="cs-leaf" :fill="leafGrad" d="M32 39 C25 39 21 34 26 29 C32 31 34 35 32 39 Z" />
        <path class="cs-leaf" :fill="leafDarkGrad" d="M32 39 C39 39 43 34 38 29 C32 31 30 35 32 39 Z" />
        <!-- 露出橙根 -->
        <path class="cs-root" :fill="rootGrad" d="M26 51 C26 44 28 40 32 40 C36 40 38 44 38 51 Z" />
        <ellipse class="cs-root-shine" cx="29.5" cy="45.5" rx="2" ry="4" transform="rotate(-8 29.5 45.5)" />
      </g>
    </g>

    <!-- ========== 番茄（藤蔓 + 红果） ========== -->
    <g v-if="crop === 'tomato'">
      <g v-if="stage === 1">
        <path class="cs-stem" :stroke="stemGrad" d="M32 46 C31 42 31 39 32 36" />
        <ellipse class="cs-leaf" :fill="leafGrad" cx="26" cy="38" rx="5.5" ry="4" transform="rotate(-28 26 38)" />
        <ellipse class="cs-leaf" :fill="leafDarkGrad" cx="38" cy="38" rx="5.5" ry="4" transform="rotate(28 38 38)" />
      </g>
      <g v-else-if="stage === 2">
        <path class="cs-stem" :stroke="stemGrad" d="M32 47 C31 41 31 37 32 32" />
        <ellipse class="cs-leaf" :fill="leafGrad" cx="24" cy="39" rx="7" ry="4.5" transform="rotate(-32 24 39)" />
        <ellipse class="cs-leaf" :fill="leafDarkGrad" cx="40" cy="39" rx="7" ry="4.5" transform="rotate(32 40 39)" />
        <ellipse class="cs-leaf" :fill="leafGrad" cx="32" cy="33" rx="7" ry="4" transform="rotate(10 32 33)" />
      </g>
      <g v-else>
        <path class="cs-stem" :stroke="stemGrad" d="M32 47 C31 41 31 37 32 30" />
        <ellipse class="cs-leaf" :fill="leafGrad" cx="23" cy="40" rx="7.5" ry="4.5" transform="rotate(-34 23 40)" />
        <ellipse class="cs-leaf" :fill="leafDarkGrad" cx="41" cy="40" rx="7.5" ry="4.5" transform="rotate(34 41 40)" />
        <ellipse class="cs-leaf" :fill="leafGrad" cx="32" cy="32" rx="7" ry="4" transform="rotate(12 32 32)" />
        <circle class="cs-fruit" :fill="fruitGrad" cx="27" cy="42" r="5.5" />
        <circle class="cs-fruit" :fill="fruitGrad" cx="38" cy="43" r="5" />
        <circle class="cs-fruit" :fill="fruitGrad" cx="32" cy="36" r="4.5" />
        <circle class="cs-fruit-shine" cx="25.5" cy="40.5" r="1.5" />
        <circle class="cs-fruit-shine" cx="36.5" cy="41.5" r="1.4" />
      </g>
    </g>

    <!-- ========== 向日葵（高茎 + 大花盘） ========== -->
    <g v-if="crop === 'sunflower'">
      <g v-if="stage === 1">
        <path class="cs-stem" :stroke="stemGrad" d="M32 46 C31 42 31 39 32 35" />
        <path class="cs-leaf" :fill="leafGrad" d="M32 38 C25 37 22 32 26 28 C32 30 34 34 32 38 Z" />
        <path class="cs-leaf" :fill="leafDarkGrad" d="M32 38 C39 37 42 32 38 28 C32 30 30 34 32 38 Z" />
      </g>
      <g v-else-if="stage === 2">
        <path class="cs-stem" :stroke="stemGrad" d="M32 47 C31 41 31 37 32 28" />
        <path class="cs-leaf" :fill="leafGrad" d="M32 36 C22 34 16 40 12 36 C20 28 28 30 32 36 Z" />
        <path class="cs-leaf" :fill="leafDarkGrad" d="M32 36 C42 34 48 40 52 36 C44 28 36 30 32 36 Z" />
      </g>
      <g v-else>
        <path class="cs-stem" :stroke="stemGrad" d="M32 49 C31 40 31 34 32 24" />
        <path class="cs-leaf" :fill="leafGrad" d="M32 38 C21 36 14 43 10 38 C19 28 28 31 32 38 Z" />
        <path class="cs-leaf" :fill="leafDarkGrad" d="M32 38 C43 36 50 43 54 38 C45 28 36 31 32 38 Z" />
        <g class="cs-flower">
          <ellipse class="cs-petal" :fill="petalGrad" cx="32" cy="25" rx="3.5" ry="9" transform="rotate(0 32 25)" />
          <ellipse class="cs-petal" :fill="petalGrad" cx="32" cy="25" rx="3.5" ry="9" transform="rotate(45 32 25)" />
          <ellipse class="cs-petal" :fill="petalGrad" cx="32" cy="25" rx="3.5" ry="9" transform="rotate(90 32 25)" />
          <ellipse class="cs-petal" :fill="petalGrad" cx="32" cy="25" rx="3.5" ry="9" transform="rotate(135 32 25)" />
          <ellipse class="cs-petal" :fill="petalGrad" cx="32" cy="25" rx="3.5" ry="9" transform="rotate(22.5 32 25)" />
          <ellipse class="cs-petal" :fill="petalGrad" cx="32" cy="25" rx="3.5" ry="9" transform="rotate(67.5 32 25)" />
          <ellipse class="cs-petal" :fill="petalGrad" cx="32" cy="25" rx="3.5" ry="9" transform="rotate(112.5 32 25)" />
          <ellipse class="cs-petal" :fill="petalGrad" cx="32" cy="25" rx="3.5" ry="9" transform="rotate(157.5 32 25)" />
          <circle class="cs-flower-core" :fill="coreGrad" cx="32" cy="25" r="5.5" />
          <circle class="cs-core-dot" cx="29.5" cy="23" r="0.9" />
          <circle class="cs-core-dot" cx="34.5" cy="23.5" r="0.9" />
          <circle class="cs-core-dot" cx="32" cy="27.5" r="0.9" />
        </g>
      </g>
    </g>

    <!-- ========== 玫瑰（带刺茎 + 红花） ========== -->
    <g v-if="crop === 'rose'">
      <g v-if="stage === 1">
        <path class="cs-stem" :stroke="stemGrad" d="M32 46 C31 42 31 39 32 35" />
        <path class="cs-leaf" :fill="leafGrad" d="M32 38 C25 37 22 32 26 28 C32 30 34 34 32 38 Z" />
        <path class="cs-leaf" :fill="leafDarkGrad" d="M32 38 C39 37 42 32 38 28 C32 30 30 34 32 38 Z" />
      </g>
      <g v-else-if="stage === 2">
        <path class="cs-stem" :stroke="stemGrad" d="M32 48 C31 41 31 36 32 30" />
        <ellipse class="cs-leaf" :fill="leafGrad" cx="25" cy="38" rx="6.5" ry="4" transform="rotate(-30 25 38)" />
        <ellipse class="cs-leaf" :fill="leafDarkGrad" cx="39" cy="36" rx="6.5" ry="4" transform="rotate(34 39 36)" />
        <ellipse class="cs-leaf" :fill="leafGrad" cx="33" cy="42" rx="6" ry="3.5" transform="rotate(-8 33 42)" />
      </g>
      <g v-else>
        <path class="cs-stem" :stroke="stemGrad" d="M32 48 C31 41 31 36 32 29" />
        <ellipse class="cs-leaf" :fill="leafGrad" cx="24" cy="39" rx="7" ry="4" transform="rotate(-30 24 39)" />
        <ellipse class="cs-leaf" :fill="leafDarkGrad" cx="40" cy="37" rx="7" ry="4" transform="rotate(34 40 37)" />
        <ellipse class="cs-leaf" :fill="leafGrad" cx="33" cy="43" rx="6" ry="3.5" transform="rotate(-8 33 43)" />
        <g class="cs-flower">
          <ellipse class="cs-rose-petal" :fill="rosePetalGrad" cx="32" cy="27" rx="6" ry="5" transform="rotate(-20 32 27)" />
          <ellipse class="cs-rose-petal" :fill="rosePetalGrad" cx="32" cy="27" rx="6" ry="5" transform="rotate(25 32 27)" />
          <ellipse class="cs-rose-petal" :fill="rosePetalGrad" cx="32" cy="27" rx="5" ry="4.2" transform="rotate(85 32 27)" />
          <path class="cs-rose-core" :fill="roseCoreGrad" d="M32 27 C29 24.5 26.5 26 27 29 C24.5 30.5 26 34 29 33.5 C30 36.5 34 36.5 35 33.5 C38 34 39.5 30.5 37 29 C37.5 26 35 24.5 32 27 Z" />
        </g>
      </g>
    </g>

    <!-- ========== 金桂树（树干 + 树冠 + 金花） ========== -->
    <g v-if="crop === 'osmanthus'">
      <g v-if="stage === 1">
        <path class="cs-stem" :stroke="stemGrad" d="M32 46 C31 42 31 39 32 35" />
        <path class="cs-leaf" :fill="leafGrad" d="M32 38 C25 37 22 32 26 28 C32 30 34 34 32 38 Z" />
        <path class="cs-leaf" :fill="leafDarkGrad" d="M32 38 C39 37 42 32 38 28 C32 30 30 34 32 38 Z" />
      </g>
      <g v-else-if="stage === 2">
        <path class="cs-trunk" :stroke="trunkGrad" d="M32 49 C31 45 31 42 32 38" />
        <ellipse class="cs-crown" :fill="crownGrad" cx="32" cy="33" rx="11" ry="9" />
        <ellipse class="cs-crown" :fill="crownGrad" cx="27" cy="35" rx="5" ry="4" />
        <ellipse class="cs-crown" :fill="crownGrad" cx="37" cy="35" rx="5" ry="4" />
      </g>
      <g v-else>
        <path class="cs-trunk" :stroke="trunkGrad" d="M32 50 C31 44 31 40 32 34" />
        <ellipse class="cs-crown" :fill="crownGrad" cx="32" cy="29" rx="13" ry="11" />
        <ellipse class="cs-crown" :fill="crownGrad" cx="26" cy="32" rx="6" ry="5" />
        <ellipse class="cs-crown" :fill="crownGrad" cx="38" cy="32" rx="6" ry="5" />
        <ellipse class="cs-crown" :fill="crownGrad" cx="32" cy="24" rx="6" ry="5" />
        <!-- 金桂花 -->
        <circle class="cs-blossom" :fill="blossomGrad" cx="27" cy="27" r="1.6" />
        <circle class="cs-blossom" :fill="blossomGrad" cx="33" cy="24" r="1.6" />
        <circle class="cs-blossom" :fill="blossomGrad" cx="38" cy="29" r="1.6" />
        <circle class="cs-blossom" :fill="blossomGrad" cx="29" cy="33" r="1.6" />
        <circle class="cs-blossom" :fill="blossomGrad" cx="35" cy="34" r="1.6" />
        <circle class="cs-blossom" :fill="blossomGrad" cx="31" cy="31" r="1.6" />
        <circle class="cs-blossom" :fill="blossomGrad" cx="33" cy="30.5" r="1.3" />
      </g>
    </g>
    </g>

    <!-- 土壤覆盖层：盖住植物根部，静止不动 -->
    <path
      class="cs-soil"
      :fill="soilGrad"
      d="M3 54 Q5 49 10 50 Q14 45 20 47 Q25 42 31 46 Q36 41 42 45 Q47 41 52 45 Q57 43 60 49 Q62 52 61 54 L61 60 Q52 57 42 59 Q31 61 20 58 Q11 56 3 60 Z"
    />
    <path
      class="cs-soil-light"
      d="M3 54 Q5 49 10 50 Q14 45 20 47 Q25 42 31 46 Q36 41 42 45 Q47 41 52 45 Q57 43 60 49 Q62 52 61 54 L61 57 Q55 54 49 56 Q42 54 36 55 Q30 57 22 55 Q14 57 8 56 L3 57 Z"
    />
    <circle class="cs-pebble" cx="14" cy="55" r="1.6" />
    <circle class="cs-pebble" cx="23" cy="57.5" r="1.2" />
    <circle class="cs-pebble" cx="32" cy="54.5" r="1.7" />
    <circle class="cs-pebble" cx="41" cy="56" r="1.3" />
    <circle class="cs-pebble" cx="50" cy="54" r="1.5" />
    <circle class="cs-pebble dark" cx="18" cy="58.5" r="1.2" />
    <circle class="cs-pebble dark" cx="36" cy="58" r="1.4" />
    <circle class="cs-pebble dark" cx="46" cy="59" r="1.1" />
    <circle class="cs-pebble dark" cx="55" cy="57" r="1.2" />
    <g class="cs-grass">
      <path d="M9 51 L8 45.5 L11 50" />
      <path d="M17 48.5 L16.5 43.5 L19 48" />
      <path d="M47 46.5 L46 41.5 L49 46" />
      <path d="M55 49 L56 44 L58 48.5" />
    </g>
  </svg>
</template>

<style scoped>
.crop-sprite {
  width: 100%;
  height: 100%;
  display: block;
  overflow: visible;
  filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.18));
}

/* 基础元素配色（统一描边，Q 版手绘感） */
.cs-soil {
  stroke: #4a2d14;
  stroke-width: 1.5;
  stroke-linejoin: round;
}

/* 土壤上沿受光带（立体凸起） */
.cs-soil-light {
  fill: rgba(255, 255, 255, 0.16);
}

/* 植物整体：以根部为轴的轻微摇摆（土壤层不参与） */
.cs-plant {
  transform-box: view-box;
  transform-origin: 32px 50px;
  animation: csSway 3.5s ease-in-out infinite;
}

@keyframes csSway {
  0%, 100% { transform: rotate(-1.5deg); }
  50% { transform: rotate(1.5deg); }
}

/* 叶子呼吸：以叶柄为轴轻微开合（上下起伏） */
.cs-leaf {
  transform-box: fill-box;
  transform-origin: 50% 100%;
  animation: csLeafBreath 3s ease-in-out infinite;
}

/* 相邻叶子反相呼吸，错开节奏更自然 */
.cs-plant .cs-leaf + .cs-leaf {
  animation-delay: -1.5s;
}

@keyframes csLeafBreath {
  0%, 100% { transform: scale(1, 1); }
  50% { transform: scale(1.06, 0.93); }
}

/* 枯萎态：垂头 + 枯黄干瘪，停止所有摇摆/呼吸动画 */
.cs-plant.cs-wilted {
  animation: none;
  transform: rotate(10deg) translateX(2px) translateY(1px);
  filter: grayscale(0.55) sepia(0.4) saturate(0.4) brightness(0.92);
}
.cs-wilted .cs-leaf {
  animation: none;
}

/* 土壤上沿草丛 */
.cs-grass {
  fill: none;
  stroke: #7ec850;
  stroke-width: 1.4;
  stroke-linecap: round;
  opacity: 0.9;
}

/* 土壤颗粒（浅色石子 + 深色碎石） */
.cs-pebble {
  fill: rgba(255, 255, 255, 0.32);
  stroke: rgba(255, 255, 255, 0.18);
  stroke-width: 0.4;
}
.cs-pebble.dark {
  fill: rgba(30, 16, 6, 0.4);
  stroke: none;
}

.cs-stem {
  fill: none;
  stroke-width: 3;
  stroke-linecap: round;
}

.cs-leaf {
  stroke: #3f7a32;
  stroke-width: 1.5;
  stroke-linejoin: round;
}

/* 胡萝卜根高光 */
.cs-root {
  stroke: #c96a26;
  stroke-width: 1.5;
  stroke-linejoin: round;
}
.cs-root-shine {
  fill: rgba(255, 255, 255, 0.5);
}

.cs-fruit {
  stroke: #a92b26;
  stroke-width: 1.5;
}

.cs-fruit-shine {
  fill: rgba(255, 255, 255, 0.85);
}

.cs-petal {
  stroke: #d99b26;
  stroke-width: 1.2;
}

.cs-flower-core {
  stroke: #5d3a1a;
  stroke-width: 1.2;
}

/* 花盘上的瓜子点 */
.cs-core-dot {
  fill: rgba(70, 40, 12, 0.6);
}

.cs-trunk {
  fill: none;
  stroke-width: 4;
  stroke-linecap: round;
}

.cs-crown {
  stroke: #35682a;
  stroke-width: 1.5;
}

.cs-blossom {
  stroke: #c8891e;
  stroke-width: 0.8;
}

.cs-rose-petal {
  stroke: #c23d56;
  stroke-width: 1.2;
}

.cs-rose-core {
  stroke: #a83249;
  stroke-width: 1;
}
</style>
