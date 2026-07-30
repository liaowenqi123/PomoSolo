<script setup lang="ts">
/**
 * 菜园子 - 种植轮盘组件
 * 迁移自 electron/src/scripts/modules/gardenPlantWheel.js
 *
 * 点击空地时弹出的径向选种子菜单。使用 Canvas 绘制 5 个扇形，
 * 鼠标悬停高亮，点击选中可种植的种子。
 */
import { ref, watch, onMounted, onUnmounted, nextTick } from "vue";
import { CROP_CONFIG, CROP_ORDER } from "@/stores/garden";

const props = defineProps<{
  visible: boolean;
  /** 轮盘定位 X（clientX） */
  x: number;
  /** 轮盘定位 Y（clientY） */
  y: number;
  /** 拥有的种子数量映射 */
  seeds: Record<string, number>;
}>();

const emit = defineEmits<{
  (e: "select", seedKey: string): void;
  (e: "close"): void;
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const wheelRef = ref<HTMLDivElement | null>(null);
const hoverIdx = ref(-1);

const SIZE = 200;
const CANVAS_SIZE = 500;

interface WheelItem {
  key: string;
  icon: string;
  count: number;
}

let ctx: CanvasRenderingContext2D | null = null;

/** 获取轮盘作物列表（固定 5 种） */
function getItems(): WheelItem[] {
  return CROP_ORDER.map((key) => {
    const config = CROP_CONFIG[key];
    return {
      key,
      icon: config.icon,
      count: props.seeds[key] || 0,
    };
  });
}

/** 绘制轮盘 */
function drawWheel(hoverIdx: number) {
  if (!ctx) return;
  const items = getItems();
  if (items.length === 0) return;

  const w = CANVAS_SIZE;
  const cx = w / 2;
  const cy = w / 2;
  const radius = w * 0.44;
  const segCount = items.length;
  const angleStep = (Math.PI * 2) / segCount;
  const startOffset = -Math.PI / 2;

  ctx.clearRect(0, 0, w, w);

  // 绘制扇形
  for (let i = 0; i < segCount; i++) {
    const start = i * angleStep + startOffset;
    const end = (i + 1) * angleStep + startOffset;
    const isHover = hoverIdx === i;
    const item = items[i];
    const isDisabled = item.count <= 0;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, end);
    ctx.closePath();

    if (isDisabled) {
      ctx.fillStyle = "rgba(20, 20, 20, 0.6)";
    } else if (isHover) {
      ctx.fillStyle = "rgba(60, 60, 60, 0.85)";
    } else {
      ctx.fillStyle = "rgba(35, 35, 35, 0.8)";
    }
    ctx.shadowBlur = isHover ? 6 : 2;
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.fill();
  }

  // 内圈中心区域
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.25, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(25, 25, 25, 0.9)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.15, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(15, 15, 15, 0.95)";
  ctx.fill();

  // 绘制图标和数量
  for (let i = 0; i < segCount; i++) {
    const midAngle = i * angleStep + startOffset + angleStep / 2;
    const textR = radius * 0.62;
    const ix = cx + Math.cos(midAngle) * textR;
    const iy = cy + Math.sin(midAngle) * textR;

    const item = items[i];
    const isHover = hoverIdx === i;
    const isDisabled = item.count <= 0;

    // 图标
    ctx.font = `${Math.floor(radius * 0.32)}px "Segoe UI Emoji", "Apple Color Emoji", system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowBlur = isHover ? 3 : 1;
    ctx.shadowColor = "rgba(0,0,0,0.3)";

    if (isDisabled) {
      ctx.fillStyle = "rgba(120, 120, 120, 0.5)";
    } else if (isHover) {
      ctx.fillStyle = "#ffffff";
    } else {
      ctx.fillStyle = "rgba(220, 220, 220, 0.9)";
    }
    ctx.fillText(item.icon, ix, iy);

    // 数量
    ctx.font = `700 ${Math.floor(radius * 0.14)}px "Segoe UI", system-ui`;
    ctx.shadowBlur = 0;
    ctx.textAlign = "left";

    if (isDisabled) {
      ctx.fillStyle = "rgba(150, 150, 150, 0.4)";
      ctx.fillText("×0", ix + 18, iy + 12);
    } else if (isHover) {
      ctx.fillStyle = "#ffffff";
      ctx.fillText(`×${item.count}`, ix + 18, iy + 12);
    } else {
      ctx.fillStyle = "rgba(200, 200, 200, 0.8)";
      ctx.fillText(`×${item.count}`, ix + 18, iy + 12);
    }
    ctx.textAlign = "center";
  }
  ctx.shadowBlur = 0;
}

/** 获取扇区索引 */
function getSectorIndex(clientX: number, clientY: number): number {
  const el = wheelRef.value;
  if (!el) return -1;
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = clientX - cx;
  const dy = clientY - cy;
  const dist = Math.hypot(dx, dy);

  // 中心区域返回 -1
  if (dist < (rect.width / 2) * 0.27) return -1;

  let angle = Math.atan2(dy, dx);
  const offset = -Math.PI / 2;
  let local = angle - offset;
  if (local < 0) local += Math.PI * 2;
  const step = (Math.PI * 2) / getItems().length;
  const idx = Math.floor(local / step);
  return Math.min(getItems().length - 1, Math.max(0, idx));
}

/** 处理鼠标移动 */
function handleMouseMove(e: MouseEvent) {
  const idx = getSectorIndex(e.clientX, e.clientY);
  if (idx !== hoverIdx.value) {
    hoverIdx.value = idx;
    drawWheel(idx);
  }
}

/** 处理画布点击 */
function handleClick(e: MouseEvent) {
  const idx = getSectorIndex(e.clientX, e.clientY);
  if (idx === -1) return;
  const items = getItems();
  if (idx >= items.length) return;
  const selected = items[idx];
  if (selected.count <= 0) return;
  emit("select", selected.key);
}

/** 处理关闭按钮 */
function handleClose() {
  emit("close");
}

/** 计算定位 */
function getPosition() {
  const gardenFrame = document.querySelector(".garden-frame");
  let left = props.x - SIZE / 2;
  let top = props.y - SIZE / 2;

  if (gardenFrame) {
    const frameRect = gardenFrame.getBoundingClientRect();
    left = Math.max(frameRect.left + 10, Math.min(frameRect.right - SIZE - 10, left));
    top = Math.max(frameRect.top + 10, Math.min(frameRect.bottom - SIZE - 10, top));
  } else {
    left = Math.min(window.innerWidth - SIZE - 10, Math.max(10, left));
    top = Math.min(window.innerHeight - SIZE - 10, Math.max(10, top));
  }
  return { left, top };
}

/** 点击外部关闭 */
function handleDocumentClick(e: MouseEvent) {
  const el = wheelRef.value;
  if (el && !el.contains(e.target as Node)) {
    emit("close");
  }
}

// 监听 visible 变化，重绘并注册/取消全局监听
watch(
  () => props.visible,
  async (v) => {
    if (v) {
      hoverIdx.value = -1;
      await nextTick();
      if (canvasRef.value) {
        ctx = canvasRef.value.getContext("2d");
        drawWheel(-1);
      }
      // 延迟注册，避免触发显示的同一个事件冒泡
      setTimeout(() => {
        document.addEventListener("click", handleDocumentClick);
      }, 50);
    } else {
      document.removeEventListener("click", handleDocumentClick);
    }
  },
  { immediate: true },
);

onMounted(() => {
  if (canvasRef.value) {
    ctx = canvasRef.value.getContext("2d");
  }
});

onUnmounted(() => {
  document.removeEventListener("click", handleDocumentClick);
});
</script>

<template>
  <div
    v-if="props.visible"
    ref="wheelRef"
    class="plant-wheel"
    :style="{ left: getPosition().left + 'px', top: getPosition().top + 'px' }"
  >
    <canvas
      ref="canvasRef"
      class="plant-wheel__canvas"
      :width="CANVAS_SIZE"
      :height="CANVAS_SIZE"
      @click.stop="handleClick"
      @mousemove="handleMouseMove"
    ></canvas>
    <button class="plant-wheel__close" @click.stop="handleClose">✕</button>
  </div>
</template>

<style scoped>
.plant-wheel {
  position: fixed;
  width: 200px;
  height: 200px;
  z-index: var(--z-modal-upper);
}

.plant-wheel__canvas {
  width: 200px;
  height: 200px;
  cursor: pointer;
}

.plant-wheel__close {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.plant-wheel__close:hover {
  background: rgba(233, 69, 96, 0.8);
}
</style>
