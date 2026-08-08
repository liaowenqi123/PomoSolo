<script setup lang="ts">
/**
 * 菜园子 - 作物 SVG 精灵（手绘 Q 版）
 *
 * 5 种作物 × 3 生长阶段：1 幼苗 / 2 成株 / 3 成熟。
 * 统一 viewBox="0 0 64 64"、底部带土丘，格子里居中放大。
 * 阶段由父组件按 progress/growTime 计算传入。
 */
defineProps<{
  crop: string;
  stage: 1 | 2 | 3;
}>();
</script>

<template>
  <svg class="crop-sprite" viewBox="0 0 64 64" aria-hidden="true">
    <!-- 底部土丘 -->
    <path class="cs-soil" d="M9 50 Q32 42 55 50 L55 60 Q32 56 9 60 Z" />

    <!-- ========== 胡萝卜（地下根 + 缨子） ========== -->
    <g v-if="crop === 'carrot'">
      <g v-if="stage === 1">
        <path class="cs-stem" d="M32 44 C31 40 31 37 32 33" />
        <path class="cs-leaf" d="M32 37 C25 36 22 30 26 26 C33 28 35 33 32 37 Z" />
        <path class="cs-leaf" d="M32 37 C39 36 42 30 38 26 C31 28 29 33 32 37 Z" />
      </g>
      <g v-else-if="stage === 2">
        <path class="cs-stem" d="M32 44 C31 38 31 34 32 28" />
        <path class="cs-leaf" d="M32 33 C24 32 19 25 25 20 C33 22 35 28 32 33 Z" />
        <path class="cs-leaf" d="M32 33 C40 32 45 25 39 20 C31 22 29 28 32 33 Z" />
        <path class="cs-leaf" d="M32 40 C26 40 23 35 27 31 C32 32 34 36 32 40 Z" />
        <path class="cs-leaf" d="M32 40 C38 40 41 35 37 31 C32 32 30 36 32 40 Z" />
      </g>
      <g v-else>
        <path class="cs-stem" d="M32 44 C31 37 31 33 32 26" />
        <path class="cs-leaf" d="M32 32 C23 31 18 23 25 18 C34 20 36 27 32 32 Z" />
        <path class="cs-leaf" d="M32 32 C41 31 46 23 39 18 C30 20 28 27 32 32 Z" />
        <path class="cs-leaf" d="M32 39 C25 39 21 34 26 29 C32 31 34 35 32 39 Z" />
        <path class="cs-leaf" d="M32 39 C39 39 43 34 38 29 C32 31 30 35 32 39 Z" />
        <!-- 露出橙根 -->
        <path class="cs-root" d="M26 51 C26 44 28 40 32 40 C36 40 38 44 38 51 Z" />
      </g>
    </g>

    <!-- ========== 番茄（藤蔓 + 红果） ========== -->
    <g v-if="crop === 'tomato'">
      <g v-if="stage === 1">
        <path class="cs-stem" d="M32 46 C31 42 31 39 32 36" />
        <ellipse class="cs-leaf" cx="26" cy="38" rx="5.5" ry="4" transform="rotate(-28 26 38)" />
        <ellipse class="cs-leaf" cx="38" cy="38" rx="5.5" ry="4" transform="rotate(28 38 38)" />
      </g>
      <g v-else-if="stage === 2">
        <path class="cs-stem" d="M32 47 C31 41 31 37 32 32" />
        <ellipse class="cs-leaf" cx="24" cy="39" rx="7" ry="4.5" transform="rotate(-32 24 39)" />
        <ellipse class="cs-leaf" cx="40" cy="39" rx="7" ry="4.5" transform="rotate(32 40 39)" />
        <ellipse class="cs-leaf" cx="32" cy="33" rx="7" ry="4" transform="rotate(10 32 33)" />
      </g>
      <g v-else>
        <path class="cs-stem" d="M32 47 C31 41 31 37 32 30" />
        <ellipse class="cs-leaf" cx="23" cy="40" rx="7.5" ry="4.5" transform="rotate(-34 23 40)" />
        <ellipse class="cs-leaf" cx="41" cy="40" rx="7.5" ry="4.5" transform="rotate(34 41 40)" />
        <ellipse class="cs-leaf" cx="32" cy="32" rx="7" ry="4" transform="rotate(12 32 32)" />
        <circle class="cs-fruit" cx="27" cy="42" r="5.5" />
        <circle class="cs-fruit" cx="38" cy="43" r="5" />
        <circle class="cs-fruit" cx="32" cy="36" r="4.5" />
        <circle class="cs-fruit-shine" cx="25.5" cy="40.5" r="1.5" />
        <circle class="cs-fruit-shine" cx="36.5" cy="41.5" r="1.4" />
      </g>
    </g>

    <!-- ========== 向日葵（高茎 + 大花盘） ========== -->
    <g v-if="crop === 'sunflower'">
      <g v-if="stage === 1">
        <path class="cs-stem" d="M32 46 C31 42 31 39 32 35" />
        <path class="cs-leaf" d="M32 38 C25 37 22 32 26 28 C32 30 34 34 32 38 Z" />
        <path class="cs-leaf" d="M32 38 C39 37 42 32 38 28 C32 30 30 34 32 38 Z" />
      </g>
      <g v-else-if="stage === 2">
        <path class="cs-stem" d="M32 47 C31 41 31 37 32 28" />
        <path class="cs-leaf" d="M32 36 C22 34 16 40 12 36 C20 28 28 30 32 36 Z" />
        <path class="cs-leaf" d="M32 36 C42 34 48 40 52 36 C44 28 36 30 32 36 Z" />
      </g>
      <g v-else>
        <path class="cs-stem" d="M32 49 C31 40 31 34 32 24" />
        <path class="cs-leaf" d="M32 38 C21 36 14 43 10 38 C19 28 28 31 32 38 Z" />
        <path class="cs-leaf" d="M32 38 C43 36 50 43 54 38 C45 28 36 31 32 38 Z" />
        <g class="cs-flower">
          <ellipse class="cs-petal" cx="32" cy="25" rx="3.5" ry="9" transform="rotate(0 32 25)" />
          <ellipse class="cs-petal" cx="32" cy="25" rx="3.5" ry="9" transform="rotate(45 32 25)" />
          <ellipse class="cs-petal" cx="32" cy="25" rx="3.5" ry="9" transform="rotate(90 32 25)" />
          <ellipse class="cs-petal" cx="32" cy="25" rx="3.5" ry="9" transform="rotate(135 32 25)" />
          <ellipse class="cs-petal" cx="32" cy="25" rx="3.5" ry="9" transform="rotate(22.5 32 25)" />
          <ellipse class="cs-petal" cx="32" cy="25" rx="3.5" ry="9" transform="rotate(67.5 32 25)" />
          <ellipse class="cs-petal" cx="32" cy="25" rx="3.5" ry="9" transform="rotate(112.5 32 25)" />
          <ellipse class="cs-petal" cx="32" cy="25" rx="3.5" ry="9" transform="rotate(157.5 32 25)" />
          <circle class="cs-flower-core" cx="32" cy="25" r="5.5" />
        </g>
      </g>
    </g>

    <!-- ========== 玫瑰（带刺茎 + 红花） ========== -->
    <g v-if="crop === 'rose'">
      <g v-if="stage === 1">
        <path class="cs-stem" d="M32 46 C31 42 31 39 32 35" />
        <path class="cs-leaf" d="M32 38 C25 37 22 32 26 28 C32 30 34 34 32 38 Z" />
        <path class="cs-leaf" d="M32 38 C39 37 42 32 38 28 C32 30 30 34 32 38 Z" />
      </g>
      <g v-else-if="stage === 2">
        <path class="cs-stem" d="M32 48 C31 41 31 36 32 30" />
        <ellipse class="cs-leaf" cx="25" cy="38" rx="6.5" ry="4" transform="rotate(-30 25 38)" />
        <ellipse class="cs-leaf" cx="39" cy="36" rx="6.5" ry="4" transform="rotate(34 39 36)" />
        <ellipse class="cs-leaf" cx="33" cy="42" rx="6" ry="3.5" transform="rotate(-8 33 42)" />
      </g>
      <g v-else>
        <path class="cs-stem" d="M32 48 C31 41 31 36 32 29" />
        <ellipse class="cs-leaf" cx="24" cy="39" rx="7" ry="4" transform="rotate(-30 24 39)" />
        <ellipse class="cs-leaf" cx="40" cy="37" rx="7" ry="4" transform="rotate(34 40 37)" />
        <ellipse class="cs-leaf" cx="33" cy="43" rx="6" ry="3.5" transform="rotate(-8 33 43)" />
        <g class="cs-flower">
          <ellipse class="cs-rose-petal" cx="32" cy="27" rx="6" ry="5" transform="rotate(-20 32 27)" />
          <ellipse class="cs-rose-petal" cx="32" cy="27" rx="6" ry="5" transform="rotate(25 32 27)" />
          <ellipse class="cs-rose-petal" cx="32" cy="27" rx="5" ry="4.2" transform="rotate(85 32 27)" />
          <path class="cs-rose-core" d="M32 27 C29 24.5 26.5 26 27 29 C24.5 30.5 26 34 29 33.5 C30 36.5 34 36.5 35 33.5 C38 34 39.5 30.5 37 29 C37.5 26 35 24.5 32 27 Z" />
        </g>
      </g>
    </g>

    <!-- ========== 金桂树（树干 + 树冠 + 金花） ========== -->
    <g v-if="crop === 'osmanthus'">
      <g v-if="stage === 1">
        <path class="cs-stem" d="M32 46 C31 42 31 39 32 35" />
        <path class="cs-leaf" d="M32 38 C25 37 22 32 26 28 C32 30 34 34 32 38 Z" />
        <path class="cs-leaf" d="M32 38 C39 37 42 32 38 28 C32 30 30 34 32 38 Z" />
      </g>
      <g v-else-if="stage === 2">
        <path class="cs-trunk" d="M32 49 C31 45 31 42 32 38" />
        <ellipse class="cs-crown" cx="32" cy="33" rx="11" ry="9" />
        <ellipse class="cs-crown" cx="27" cy="35" rx="5" ry="4" />
        <ellipse class="cs-crown" cx="37" cy="35" rx="5" ry="4" />
      </g>
      <g v-else>
        <path class="cs-trunk" d="M32 50 C31 44 31 40 32 34" />
        <ellipse class="cs-crown" cx="32" cy="29" rx="13" ry="11" />
        <ellipse class="cs-crown" cx="26" cy="32" rx="6" ry="5" />
        <ellipse class="cs-crown" cx="38" cy="32" rx="6" ry="5" />
        <ellipse class="cs-crown" cx="32" cy="24" rx="6" ry="5" />
        <!-- 金桂花 -->
        <circle class="cs-blossom" cx="27" cy="27" r="1.6" />
        <circle class="cs-blossom" cx="33" cy="24" r="1.6" />
        <circle class="cs-blossom" cx="38" cy="29" r="1.6" />
        <circle class="cs-blossom" cx="29" cy="33" r="1.6" />
        <circle class="cs-blossom" cx="35" cy="34" r="1.6" />
        <circle class="cs-blossom" cx="31" cy="31" r="1.6" />
      </g>
    </g>
  </svg>
</template>

<style scoped>
.crop-sprite {
  width: 100%;
  height: 100%;
  display: block;
  overflow: visible;
}

/* 基础元素配色（统一描边，Q 版手绘感） */
.cs-soil {
  fill: #8a5a33;
  stroke: #5d3a1a;
  stroke-width: 1.5;
  stroke-linejoin: round;
}
.cs-stem {
  fill: none;
  stroke: #5c9a3d;
  stroke-width: 3;
  stroke-linecap: round;
}
.cs-leaf {
  fill: #7ec850;
  stroke: #4c8f3d;
  stroke-width: 1.5;
  stroke-linejoin: round;
}
.cs-root {
  fill: #ff9f43;
  stroke: #e07b2f;
  stroke-width: 1.5;
  stroke-linejoin: round;
}
.cs-fruit {
  fill: #ff6b6b;
  stroke: #d94f4f;
  stroke-width: 1.5;
}
.cs-fruit-shine {
  fill: rgba(255, 255, 255, 0.85);
}
.cs-petal {
  fill: #ffd93d;
  stroke: #e0a800;
  stroke-width: 1.2;
}
.cs-flower-core {
  fill: #a4703a;
  stroke: #7c5326;
  stroke-width: 1.2;
}
.cs-trunk {
  fill: none;
  stroke: #8a5a33;
  stroke-width: 4;
  stroke-linecap: round;
}
.cs-crown {
  fill: #63b04a;
  stroke: #4c8f3d;
  stroke-width: 1.5;
}
.cs-blossom {
  fill: #ffc93c;
  stroke: #e0a800;
  stroke-width: 0.8;
}
.cs-rose-petal {
  fill: #ff7b93;
  stroke: #e0556f;
  stroke-width: 1.2;
}
.cs-rose-core {
  fill: #e0556f;
  stroke: #c23d56;
  stroke-width: 1;
}
</style>
