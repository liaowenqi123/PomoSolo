<script setup lang="ts">
/**
 * 音乐播放器组件
 * 迁移自 deprecated/electron/src/scripts/modules/musicPlayer.js
 *
 * 播放/暂停/上一首/下一首、音量控制、进度条、播放列表。
 * 音乐播放通过 Rust 后端调用 Python 子进程，前端只管 UI 与状态同步。
 *
 * 事件监听通过 useTauriEvent 注册，组件卸载时自动取消监听。
 */
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useMusicStore } from "@/stores/music";
import { useSettingsStore } from "@/stores/settings";
import { useTauriEvent } from "@/api/events";
import MusicTagModal from "./MusicTagModal.vue";
import type {
  MusicReadyPayload,
  MusicStatus,
  MusicPlayStatePayload,
  MusicProgressPayload,
  MusicDevicesPayload,
  MusicVolumePayload,
  MusicPlayModePayload,
  MusicPlayErrorPayload,
  MusicSongMissingPayload,
  PlaylistData,
} from "@/api/music";

const store = useMusicStore();
/** 传歌自动续传上限（与 music store 的 TRANSFER_MAX_RETRY 一致，仅用于展示"第 n/10 次续传"） */
const TRANSFER_MAX_RETRY_HINT = 10;
const settings = useSettingsStore();

const emit = defineEmits<{
  (e: "charts"): void;
}>();

// ===== 局部 UI 状态 =====
const isPlaylistOpen = ref(false);
const isVolumeOpen = ref(false);
const isDeviceOpen = ref(false);

/**
 * 音乐库是全窗 sheet，需要 <Teleport to=".container"> 才能铺满窗口
 * （组件自身嵌套在 .music-player 里，而它带 transform，position:fixed 会以它为
 * 包含块，所以必须传送出去）。
 *
 * 但**单测是孤立挂载组件的**，DOM 里没有 .container → Teleport 解析不到目标，
 * 面板整个不渲染（27 个用例因此失败）。
 * 所以先探测目标是否存在：不存在就 `disabled` 掉传送，内容**就地渲染**，
 * wrapper.find 照常可查；生产环境里 .container 一定在，走正常传送。
 *
 * 为什么不用 VTU 的 `stubs: { teleport: true }`：那会把**所有** Teleport 都戳掉，
 * 连带改变右键菜单（to="body"）的传送语义，导致"两步确认删除"用例失败。
 */
const sheetTeleportEnabled = ref(false);
onMounted(() => {
  sheetTeleportEnabled.value = !!document.querySelector(".container");
});

/** 同步听歌时非 DJ 用户禁止控制播放器（由 DJ 统一控制播放/切歌/进度/音量） */
const controlsDisabled = computed(() => store.syncEnabled && !store.isDj);

/**
 * 曲名显示：优先 P2P 传输进度 / 等待全员下载提示，其次"无这首歌"，再是正常曲名。
 * 传输提示只在"当前没有歌在播放"时占用曲名位置（此时曲名本来要显示传输目标）；
 * 一旦有歌在播放（传完/已切到别的歌），曲名显示歌名，不被进度提示锁定。
 */
const trackDisplay = computed(() => {
  const transfer = store.songTransfer;
  const transferActive =
    (transfer.state === "requesting" || transfer.state === "downloading") && !store.playing;
  if (transferActive) {
    const retry = transfer.retryCount > 0 ? `（第 ${transfer.retryCount}/${TRANSFER_MAX_RETRY_HINT} 次续传）` : "";
    if (transfer.total > 0) {
      // 钳制到 [0,100]：received/total 可能因跨通道切换/重传累积而越界（实测 112%、200w%），
      // 展示层一律不超 100%
      const pct = Math.max(0, Math.min(100, Math.floor((transfer.received / transfer.total) * 100)));
      return `⏳ 获取歌曲中… ${pct}%${retry}`;
    }
    return `⏳ 获取歌曲中…《${transfer.songName}》${retry}`;
  }
  if (store.waitingForSongs) return "⏳ 等待其他用户下载歌曲…";
  if (store.missingSongName) return `⚠️ 无这首歌：《${store.missingSongName}》`;
  return store.playError || (store.hasMusic ? (store.trackName || "未播放") : "无音乐");
});

/**
 * 当前传输通道标记（v4.6.0 可观察性）：P2P 直连 / 服务器中转 / 未确定。
 * 传输结束后展示"通道已确定"的结果，方便用户确认 P2P 是否真的建立。
 */
const transferChannelLabel = computed(() => {
  const channel = store.songTransfer.channel;
  if (channel === "p2p") return "P2P 直连";
  if (channel === "server") return "服务器中转";
  return null;
});

/**
 * 曲名是否溢出（v4.6.0）：溢出时启用横向滚动，避免长歌名被截断看不到全名。
 * 用 ResizeObserver 监听曲名容器宽度变化，scrollWidth > clientWidth 即为溢出。
 */
const trackNameRef = ref<HTMLElement | null>(null);
const isTrackOverflow = ref(false);
let trackNameObserver: ResizeObserver | null = null;

/**
 * 传输状态展示中（"⏳ 获取歌曲中… x%（第 N 次续传）"）：该文本每收一片就变化，
 * 若对它做 marquee，动画目标/内容频繁变化会表现为"反向滚动/回跳"（实测）。
 * 传输状态本身很短且是临时文案，不滚动；只有真实曲名（稳定文本）启用滚动。
 */
const isTransferStatus = computed(() => {
  const t = store.songTransfer;
  return (t.state === "requesting" || t.state === "downloading") && !store.playing;
});

function updateTrackOverflow(): void {
  const el = trackNameRef.value;
  if (!el) return;
  // 先更新滚动终点余量（容器宽），传输状态时也更新以便恢复曲名后立即可用
  el.style.setProperty("--track-marquee-end", `${el.clientWidth}px`);
  if (isTransferStatus.value) {
    isTrackOverflow.value = false;
    return;
  }
  isTrackOverflow.value = el.scrollWidth > el.clientWidth + 1;
}

onMounted(() => {
  // 注册曲名容器溢出检测（曲名变化/窗口缩放都会触发 ResizeObserver）
  updateTrackOverflow();
  if (typeof ResizeObserver !== "undefined") {
    trackNameObserver = new ResizeObserver(() => updateTrackOverflow());
    if (trackNameRef.value) trackNameObserver.observe(trackNameRef.value);
  }
});

// 监听曲名文本变化（trackDisplay 变化时重新计算是否溢出）；setup 顶层同步创建，随组件自动停止
watch(trackDisplay, () => updateTrackOverflow(), { flush: "post" });

onUnmounted(() => {
  trackNameObserver?.disconnect();
  trackNameObserver = null;
});

// ===== 进度条拖拽 =====
const progressBarRef = ref<HTMLDivElement | null>(null);
const isDraggingProgress = ref(false);
const dragProgress = ref(0); // 拖拽期间的临时进度（0-100）
const seekTarget = ref<number | null>(null); // seek 后等待后端确认的目标位置（秒）

function calcProgress(clientX: number): number {
  if (!progressBarRef.value) return 0;
  const rect = progressBarRef.value.getBoundingClientRect();
  const progress = (clientX - rect.left) / rect.width;
  return Math.max(0, Math.min(1, progress));
}

function handleProgressMouseDown(e: MouseEvent) {
  if (controlsDisabled.value) return;
  if (!progressBarRef.value || store.duration <= 0) return;
  isDraggingProgress.value = true;
  store.isDragging = true;
  dragProgress.value = calcProgress(e.clientX) * 100;
  // 拖拽期间阻止文本选中
  e.preventDefault();
}

function handleProgressMouseMove(e: MouseEvent) {
  if (!isDraggingProgress.value) return;
  dragProgress.value = calcProgress(e.clientX) * 100;
}

function handleProgressMouseUp(e: MouseEvent) {
  if (!isDraggingProgress.value) return;
  const progress = calcProgress(e.clientX);
  const newTime = Math.floor(progress * store.duration);
  isDraggingProgress.value = false;
  store.isDragging = false;
  // 设置 seekTarget，在 music-progress 确认到达前持续显示目标位置
  seekTarget.value = newTime;
  void store.seek(newTime);
}

// 点击（非拖拽）也跳转
function handleProgressClick(e: MouseEvent) {
  if (isDraggingProgress.value) return;
  if (controlsDisabled.value) return;
  if (!progressBarRef.value || store.duration <= 0) return;
  const progress = calcProgress(e.clientX);
  const newTime = Math.floor(progress * store.duration);
  seekTarget.value = newTime;
  void store.seek(newTime);
}

// 实际显示的进度（拖拽 > seek等待 > 实时）
const displayProgress = computed(() => {
  if (isDraggingProgress.value) return dragProgress.value;
  if (seekTarget.value !== null) {
    return store.duration > 0 ? (seekTarget.value / store.duration) * 100 : 0;
  }
  return store.progress;
});

// 实际显示的时间文本
const displayTimeText = computed(() => {
  if (isDraggingProgress.value) {
    const seconds = Math.floor((dragProgress.value / 100) * store.duration);
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  if (seekTarget.value !== null) {
    const seconds = seekTarget.value;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return store.currentTimeText;
});

// 监听后端进度更新，到达 seekTarget 附近时清除（让进度条恢复实时跟随）
watch(
  () => store.currentTime,
  (current) => {
    if (seekTarget.value === null) return;
    // 后端进度到达目标 ±2 秒内，或者超过目标（说明已跳过），清除 seekTarget
    if (Math.abs(current - seekTarget.value) <= 2 || current >= seekTarget.value) {
      seekTarget.value = null;
    }
  },
);

// 切歌时清除 seekTarget
watch(
  () => store.trackName,
  () => {
    seekTarget.value = null;
    isDraggingProgress.value = false;
  },
);

// ===== 播放列表 =====
/**
 * 音乐库的两种尺寸（同一个界面的两种形态，不是两个功能）：
 *   compact —— 轻量浮层，锚在播放器上方，**扁平列表 + 小行高**，
 *              用来"瞄一眼队列 / 随手切一首"。退出成本必须接近零。
 *   full    —— 全窗 sheet，目录树 + 筛选 + 批量管理，用来"挑选 / 整理"。
 *
 * 为什么分两种：这两个任务的**频率和退出成本要求差一个数量级**。挤在一起时，
 * 为 full 争取空间就会牺牲 compact 的退出成本（点外部即关）。
 * 详见 docs/modules/music-player.md §8.6。
 */
const panelMode = ref<"compact" | "full">("compact");

/**
 * 紧凑模式显示的歌：
 *   · 已建播放集合（队列）→ 显示**队列**（这是"再次打开面板"的主要动机：
 *     看队列里有什么 / 下一首是什么）
 *   · 否则 → 显示全部歌曲（退回上一版的行为，避免打开一个空面板）
 */
const compactSongs = computed<string[]>(() =>
  store.playSetActive ? [...store.playSet] : store.playlist,
);

const compactTitle = computed(() => (store.playSetActive ? "播放列表" : "全部歌曲"));

/** 紧凑模式里"下一首"提示（给 📋 按钮的 title 用，零成本满足"瞄一眼"需求） */
const nextSongName = computed(() => {
  const list = store.playSetActive ? [...store.playSet] : store.playlist;
  if (list.length === 0) return "";
  const idx = list.indexOf(store.trackName);
  const next = idx >= 0 ? list[(idx + 1) % list.length] : list[0];
  return next && next !== store.trackName ? displayName(next) : "";
});

/** 从紧凑模式展开成全窗曲库 */
function expandToFull() {
  panelMode.value = "full";
}

/** 从全窗曲库收回紧凑模式（不是关闭面板） */
function collapseToCompact() {
  panelMode.value = "compact";
}

function togglePlaylist() {
  isPlaylistOpen.value = !isPlaylistOpen.value;
  if (isPlaylistOpen.value) {
    // 每次**打开**都从紧凑模式起（展开是本次会话内的临时动作，不跨次记忆）
    panelMode.value = "compact";
    void store.requestPlaylist();
  }
}

function handleSongClick(songName: string) {
  if (controlsDisabled.value) return;
  if (songName !== store.trackName) {
    void store.playSong(songName);
  }
}

async function handleDeleteSong(songName: string, e: MouseEvent) {
  if (controlsDisabled.value) return;
  e.stopPropagation();
  if (songName === store.trackName) return;
  await store.deleteSong(songName);
}

// ===== 标签编辑 =====
const tagModalVisible = ref(false);
const tagEditSong = ref<string>("");
const tagEditCurrent = ref<{ name: string; color: string | null } | null>(null);

// ===== 音乐库管理（目录树 / 标签筛选 / 播放集合 / 右键批量） =====
const expandedDirs = ref<Set<string>>(new Set());
/** 右键菜单内「设置标签」子菜单草稿 */
const batchTagDraft = ref<Set<string>>(new Set());
/** 右键菜单「删除所选」两步确认 */
const confirmDeleteSelection = ref(false);
let confirmDeleteTimer: ReturnType<typeof setTimeout> | null = null;

function toggleExpandDir(path: string) {
  const next = new Set(expandedDirs.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  expandedDirs.value = next;
}

/** 目录树扁平化（展开节点递归），用于渲染缩进行 */
const flatDirs = computed(() => {
  const rows: { path: string; name: string; depth: number; count: number; hasChildren: boolean }[] = [];
  const walk = (nodes: unknown, depth: number) => {
    if (!Array.isArray(nodes)) return;
    for (const n of nodes as { path: string; name: string; children: unknown[]; subtreeCount: number }[]) {
      rows.push({ path: n.path, name: n.name, depth, count: n.subtreeCount, hasChildren: n.children.length > 0 });
      if (expandedDirs.value.has(n.path) && n.children.length > 0) walk(n.children, depth + 1);
    }
  };
  walk(store.dirTree, 0);
  return rows;
});

function songMetaOf(song: string): { path: string; tags: string[] } {
  const meta = store.songMeta?.[song];
  return meta ?? { path: "", tags: [] };
}

function songTagsOf(song: string): string[] {
  return songMetaOf(song).tags ?? [];
}

function shortPath(p: string): string {
  const segs = p.split("/").filter(Boolean);
  return segs[segs.length - 1] ?? p;
}

function tagChipStyle(tag: string): Record<string, string> {
  const color = store.customTags?.[tag];
  if (color) {
    return {
      background: hexToRgba(color, 0.3),
      color: lightenColor(color, 0.3),
    };
  }
  return {};
}

/** 目录行缩进（按深度） */
function depthPadding(depth: number): string {
  return `${10 + depth * 14}px`;
}

/** 批量标签草稿切换 */
function toggleBatchTag(name: string) {
  const next = new Set(batchTagDraft.value);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  batchTagDraft.value = next;
}

/** 筛选区是否展开（默认收起：筛选往往是关闭的，歌曲再多也不挤压） */
const filterOpen = ref(false);

/** 面板当前标签：dir=目录浏览，filter=筛选浏览，playlist=播放列表（集合） */
const panelTab = ref<"dir" | "filter" | "playlist">("dir");

/** 加入播放列表（集合，Set 语义去重；支持单曲或批量） */
async function handleAddToPlaylist(song: string | string[]) {
  const songs = Array.isArray(song) ? song : [song];
  const added = await store.addSongsToPlaylist(songs);
  if (added > 0) showToast(`已加入播放列表（${store.playSet.size} 首）`);
  else showToast("已在播放列表中");
}

/** 筛选结果全部加入播放列表，并切到播放列表标签让用户看到集合 */
async function handleAddViewToPlaylist() {
  const added = await store.addViewToPlaylist();
  if (added > 0) {
    showToast(`已加入播放列表（共 ${store.playSet.size} 首）`);
    panelTab.value = "playlist";
  }
}

// ===== 多选 + 双击加入 + 拖拽 + 右键菜单（批量操作走右键，Windows 风格） =====

/** 右键菜单状态（fixed 定位，视口坐标；song 为右键点击的行） */
const ctxMenu = ref<{ visible: boolean; x: number; y: number; song: string }>({
  visible: false,
  x: 0,
  y: 0,
  song: "",
});
const ctxMenuMoveOpen = ref(false);
const ctxMenuTagOpen = ref(false);

function openCtxMenu(song: string, e: MouseEvent) {
  e.preventDefault();
  // 右键点击的行若不在当前选择中，则单选它（后续菜单操作作用于整个选择集，Windows 风格）
  if (!store.selection.has(song)) store.replaceSelection([song]);
  // 锚定鼠标位置：下方空间足够 → 向下展开；不够 → 向上展开（原生右键菜单手感）
  const menuW = 190;
  const menuH = 230;
  let x = e.clientX;
  let y = e.clientY;
  if (x + menuW > window.innerWidth) x = Math.max(0, window.innerWidth - menuW);
  if (y + menuH > window.innerHeight) y = Math.max(0, e.clientY - menuH);
  ctxMenu.value = {
    visible: true,
    x,
    y,
    song,
  };
  ctxMenuMoveOpen.value = false;
  ctxMenuTagOpen.value = false;
}

function closeCtxMenu() {
  ctxMenu.value = { visible: false, x: 0, y: 0, song: "" };
  ctxMenuMoveOpen.value = false;
  ctxMenuTagOpen.value = false;
}

/** 当前选择集在浏览列表中的最后索引（Shift 连续选中锚点） */
function lastSelectedIndex(): number {
  const songs = store.filteredSongs;
  let idx = -1;
  songs.forEach((s, i) => {
    if (store.selection.has(s)) idx = i;
  });
  return idx;
}

/** 浏览行单击 = 选中；已选中的行再次单击 = 取消选中；Shift 连续 / Ctrl 增减 */
function handleRowClick(song: string, e: MouseEvent, index: number) {
  if (e.shiftKey) {
    const anchor = lastSelectedIndex();
    const songs = store.filteredSongs;
    if (anchor >= 0 && anchor !== index) {
      const [lo, hi] = anchor < index ? [anchor, index] : [index, anchor];
      store.replaceSelection(songs.slice(lo, hi + 1));
    } else {
      store.replaceSelection([song]);
    }
  } else if (e.ctrlKey || e.metaKey) {
    store.toggleSelection(song);
  } else {
    // 已选中 → 取消；未选中 → 单选
    if (store.selection.has(song)) {
      store.replaceSelection([]);
    } else {
      store.replaceSelection([song]);
    }
  }
}

/** 浏览行双击 = 加入播放列表（集合） */
function handleRowDblClick(song: string) {
  void handleAddToPlaylist(song);
}

/** 拖拽开始：携带当前选择集（含被拖行） */
function handleDragStart(e: DragEvent, song: string) {
  const payload = store.selection.has(song) ? [...store.selection] : [song];
  if (e.dataTransfer) {
    try {
      e.dataTransfer.setData("text/plain", JSON.stringify(payload));
      e.dataTransfer.effectAllowed = "copy";
    } catch {
      /* jsdom/测试环境可能无 setData，忽略 */
    }
  }
}

/** 拖入播放列表区：把拖拽的歌曲加入集合 */
function handleDropToCollection(e: DragEvent) {
  e.preventDefault();
  collectionDragOver.value = false;
  const raw = e.dataTransfer?.getData("text/plain");
  if (!raw) return;
  try {
    const songs = JSON.parse(raw) as string[];
    if (Array.isArray(songs) && songs.length > 0) {
      void handleAddToPlaylist(songs);
    }
  } catch {
    /* 忽略非本组件拖入 */
  }
}

const collectionDragOver = ref(false);

function onCollectionDragOver(e: DragEvent) {
  e.preventDefault();
  collectionDragOver.value = true;
}

function onCollectionDragLeave() {
  collectionDragOver.value = false;
}

// ===== 右键菜单动作（作用于整个选择集，Windows 风格） =====

/** 右键菜单项执行后统一收尾 */
function finishCtxAction() {
  closeCtxMenu();
  store.clearSelection();
}

/** ▶ 播放：只作用于右键点击的那一行（预览） */
function ctxPlay(song: string) {
  finishCtxAction();
  if (song !== store.trackName) void store.playSong(song);
}

/** 🎵 添加到播放列表：作用于整个选择集 */
function ctxAdd() {
  const songs = [...store.selection];
  finishCtxAction();
  void store.addSongsToPlaylist(songs);
}

/** 📁 移动到目录：作用于整个选择集 */
function ctxMove(path: string) {
  const songs = [...store.selection];
  finishCtxAction();
  void store.moveSongsToDir(songs, path).then((ok) => {
    if (ok) showToast(`已移动到「${path || "未分类"}」`);
  });
}

/** ♥ 标记到「喜欢」：作用于整个选择集 */
function ctxFav() {
  const songs = [...store.selection];
  finishCtxAction();
  void store.moveSongsToDir(songs, "喜欢").then((ok) => {
    if (ok) showToast(`已标记到「喜欢」`);
  });
}

/** 🏷 设置标签草稿切换（右键子菜单） */
function toggleCtxTag(name: string) {
  const next = new Set(batchTagDraft.value);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  batchTagDraft.value = next;
}

/** 🏷 应用标签：作用于整个选择集 */
function ctxApplyTags() {
  const songs = [...store.selection];
  const tags = [...batchTagDraft.value];
  finishCtxAction();
  batchTagDraft.value = new Set();
  void store.setSongsTags(songs, tags).then((ok) => {
    if (ok) showToast(tags.length > 0 ? `已设置 ${tags.join("、")} 标签` : "已清除标签");
  });
}

/** 🗑 删除所选：两步确认，作用于整个选择集 */
function ctxDelete() {
  if (!confirmDeleteSelection.value) {
    confirmDeleteSelection.value = true;
    if (confirmDeleteTimer) clearTimeout(confirmDeleteTimer);
    confirmDeleteTimer = setTimeout(() => {
      confirmDeleteSelection.value = false;
    }, 3000);
    return;
  }
  const songs = [...store.selection];
  finishCtxAction();
  confirmDeleteSelection.value = false;
  void (async () => {
    for (const s of songs) await store.deleteSong(s);
    showToast(`已删除 ${songs.length} 首`);
  })();
}

// ===== Toast 提示 =====
const toastMessage = ref("");
const toastVisible = ref(false);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(message: string) {
  toastMessage.value = message;
  toastVisible.value = true;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastVisible.value = false;
  }, 2000);
}

// 颜色工具：hex 转 rgba
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// 颜色工具：hex 变亮
function lightenColor(hex: string, amount: number): string {
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + Math.round(255 * amount));
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + Math.round(255 * amount));
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + Math.round(255 * amount));
  return `rgb(${r}, ${g}, ${b})`;
}

// 计算标签 span 的内联样式：优先用 playlistTags 的 color，其次用 customTags 的颜色
function tagStyle(songName: string): Record<string, string> {
  const tagData = store.playlistTags[songName];
  if (!tagData) return {};
  const tagName = tagData.name || "自定义";
  const tagColor = tagData.color;
  if (tagColor) {
    return {
      background: hexToRgba(tagColor, 0.3),
      color: lightenColor(tagColor, 0.3),
    };
  }
  // 自定义标签使用定义的颜色
  const customColor = store.customTags[tagName];
  if (customColor) {
    return {
      background: hexToRgba(customColor, 0.3),
      color: lightenColor(customColor, 0.3),
    };
  }
  return {};
}

// 点击标签：检查内置歌曲，弹出标签选择弹窗
function handleTagClick(songName: string, e: MouseEvent) {
  e.stopPropagation();
  const name = displayName(songName);
  if (name.endsWith(" - 番茄钟")) {
    showToast("内置歌曲标签不可更改");
    return;
  }
  tagEditSong.value = songName;
  const tagData = store.playlistTags[songName];
  tagEditCurrent.value = tagData
    ? { name: tagData.name || "自定义", color: tagData.color ?? null }
    : null;
  tagModalVisible.value = true;
}

// 选择预设/已有标签
async function onTagSelect(tag: string, color: string | null) {
  const ok = await store.updateSongTag(tagEditSong.value, tag, color);
  if (ok) {
    showToast("标签已更新");
  } else {
    showToast("更新失败");
  }
}

// 添加自定义标签
async function onTagAdd(name: string, color: string) {
  const ok = await store.addCustomTag(name, color);
  if (ok) {
    // 选中新添加的标签
    const ok2 = await store.updateSongTag(tagEditSong.value, name, color);
    if (ok2) {
      showToast("标签已添加");
    } else {
      showToast("标签已添加，但应用失败");
    }
  } else {
    showToast("添加失败");
  }
}

// 删除自定义标签
async function onTagDelete(name: string) {
  const ok = await store.deleteCustomTag(name);
  if (ok) {
    showToast("标签已删除");
  } else {
    showToast("删除失败");
  }
}

// 去掉扩展名的显示名
function displayName(name: string): string {
  return name.replace(/\.[^/.]+$/, "");
}

// ===== 音量控制 =====
// 音量是本地输出，非 DJ 也可调整（不影响同步，DJ 调整才会广播给房间）
function handleVolumeInput(e: Event) {
  const target = e.target as HTMLInputElement;
  const v = parseInt(target.value, 10) / 100;
  void store.setVolume(v);
}

// ===== 设备选择 =====
function toggleDeviceList() {
  isDeviceOpen.value = !isDeviceOpen.value;
  if (isDeviceOpen.value) {
    void store.requestDevices();
  }
}

// ===== 注册后端事件监听 =====
useTauriEvent<MusicReadyPayload>("music-ready", (e) => {
  store.handleReady(e.payload);
});
useTauriEvent<MusicStatus>("music-status", (e) => {
  store.handleStatus(e.payload);
});
useTauriEvent<MusicPlayStatePayload>("music-play-state", (e) => {
  store.handlePlayState(e.payload);
});
useTauriEvent<MusicProgressPayload>("music-progress", (e) => {
  store.handleProgress(e.payload);
});
useTauriEvent<MusicDevicesPayload>("music-devices", (e) => {
  store.handleDevices(e.payload);
});
useTauriEvent<MusicVolumePayload>("music-volume-change", (e) => {
  store.handleVolumeChange(e.payload);
});
useTauriEvent<MusicPlayModePayload>("music-play-mode", (e) => {
  store.handlePlayModeChange(e.payload);
});
useTauriEvent<MusicReadyPayload>("music-track-change", (e) => {
  store.handleTrackChange(e.payload);
});
useTauriEvent<unknown>("music-no-music", () => {
  store.handleNoMusic();
});
useTauriEvent<MusicPlayErrorPayload>("music-play-error", (e) => {
  store.handlePlayError(e.payload);
});
useTauriEvent<PlaylistData>("music-playlist", (e) => {
  store.handlePlaylist(e.payload);
});
useTauriEvent<MusicSongMissingPayload>("music-song-missing", (e) => {
  store.handleSongMissing(e.payload);
});

// 自习室同步听歌：WS 推送的 music:* 事件（dj_changed / state / volume / playlist_updated）
useTauriEvent<unknown>("ws-event", (e) => {
  store.handleSyncWsEvent(e.payload);
});

// ===== 初始化 =====
onMounted(async () => {
  await store.loadSavedVolume();
  await store.loadCustomTags();
  void store.requestStatus();
  void store.requestDevices();
  // 提前加载本地歌单：同步广播可能先于歌单到达，playlist 空数组会被误判
  // "缺歌"触发 P2P 下载（本地明确有的歌也被误下载）
  void store.requestPlaylist();
  // 注册全局拖拽事件（mouseup/mousemove 需在 document 上监听，避免拖出进度条后失效）
  if (typeof document !== "undefined") {
    document.addEventListener("mousemove", handleProgressMouseMove);
    document.addEventListener("mouseup", handleProgressMouseUp);
  }
});

onUnmounted(() => {
  if (typeof document !== "undefined") {
    document.removeEventListener("pointerdown", handleGlobalPointerDown);
    document.removeEventListener("keydown", handleGlobalKeydown);
    document.removeEventListener("mousemove", handleProgressMouseMove);
    document.removeEventListener("mouseup", handleProgressMouseUp);
  }
});

// 关闭弹层（点击外部）
/*
 * ⚠️ 使用 **mousedown（pointerdown）**，不是 click！
 *
 * 这是一个很容易踩的坑：click 是 **mouseup 语义**。若在面板内按下鼠标、
 * 移到面板外再松开，click 会在共同祖先上触发 → 面板被误关。
 * 典型受害场景：想从面板里把东西拖出去、或"按下后觉得不该点、往外滑走再松手"。
 * 用 mousedown（按下的那一刻判定）就没有这个问题：
 *   · 在面板内按下 → 不关（不论在哪松手）
 *   · 在面板外按下 → 立刻关（响应也更跟手）
 *
 * 同理，**不要做"窗口失焦自动关"**（本组件是 in-app 面板，不是独立窗口）：
 * 面板只需要"按下外部 + Esc"两种零瞄准退出方式。
 */
function handleGlobalPointerDown(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (isVolumeOpen.value && !target.closest(".music-volume")) {
    isVolumeOpen.value = false;
  }
  if (isDeviceOpen.value && !target.closest(".music-device")) {
    isDeviceOpen.value = false;
  }
  if (
    isPlaylistOpen.value &&
    !target.closest(".music-playlist") &&
    !target.closest(".music-list") &&
    !target.closest(".music-playlist-btn")
  ) {
    isPlaylistOpen.value = false;
  }
  // 右键菜单：在菜单外按下关闭
  if (ctxMenu.value.visible && !target.closest(".music-playlist__ctxmenu")) {
    closeCtxMenu();
  }
}

/** Esc 关闭弹层（第二种零瞄准退出方式） */
function handleGlobalKeydown(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  if (ctxMenu.value.visible) { closeCtxMenu(); return; }
  if (isPlaylistOpen.value) {
    // 全屏时先收回紧凑模式；再按一次才关闭 —— 与「← 返回」语义一致
    if (panelMode.value === "full") { panelMode.value = "compact"; return; }
    isPlaylistOpen.value = false;
    return;
  }
  if (isDeviceOpen.value) { isDeviceOpen.value = false; return; }
  if (isVolumeOpen.value) { isVolumeOpen.value = false; }
}

// 注册全局监听：关闭弹层用 pointerdown（不是 click，见 handleGlobalPointerDown 注释）
if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", handleGlobalPointerDown);
  document.addEventListener("keydown", handleGlobalKeydown);
}
</script>

<template>
  <div class="music-player" :class="{ collapsed: store.isCollapsed }">
    <!-- 顶部收起按钮（始终可见） -->
    <button class="music-collapse-btn" title="收起" @click="store.toggleCollapse()">
      <span class="music-collapse-icon">▼</span>
    </button>

    <!-- 收起状态：律动条 + 曲名（绝对定位，opacity 过渡） -->
    <div class="music-player__collapsed" @click="store.toggleCollapse()">
      <div class="music-visualizer">
        <span
          v-for="i in 4"
          :key="i"
          class="music-visualizer__bar"
          :class="{ playing: store.playing }"
          :style="{ animationDelay: (i - 1) * 0.15 + 's' }"
        ></span>
      </div>
      <span class="music-player__collapsed-track">{{ store.trackName || "未播放" }}</span>
    </div>

    <!-- 展开内容（max-height 过渡动画，收起时挤压上方空间） -->
    <div class="music-wrapper">
      <div class="music-player__main">
        <!-- 顶部信息行：🎵 曲名 + 音量 + 设备 + 播放列表 -->
        <div class="music-info">
          <span class="music-icon">🎵</span>
          <span
            ref="trackNameRef"
            class="music-player__track-name"
            :class="{
              error: !!store.playError || !!store.missingSongName || store.waitingForSongs || (store.songTransfer.state !== 'idle' && !store.playing),
              empty: !store.hasMusic,
            }"
            :title="trackDisplay"
          >
            <span class="music-player__track-scroll" :class="{ active: isTrackOverflow }">
              {{ trackDisplay }}
            </span>
          </span>
          <!-- v4.6.0：传输通道标记（P2P 直连 / 服务器中转），便于确认 P2P 是否建立 -->
          <span
            v-if="transferChannelLabel"
            class="music-player__transfer-channel"
            :class="`music-player__transfer-channel--${store.songTransfer.channel}`"
            :title="`当前传输通道：${transferChannelLabel}`"
          >
            {{ transferChannelLabel }}
          </span>

          <!-- 音量（本地输出，非 DJ 也可调整） -->
          <div class="music-volume">
            <button
              class="music-btn"
              :title="`音量 ${Math.round(store.volume * 100)}%`"
              @click="isVolumeOpen = !isVolumeOpen"
            >
              {{ store.volumeIcon }}
            </button>
            <div v-show="isVolumeOpen" class="music-volume__slider">
              <input
                type="range"
                min="0"
                max="100"
                :value="Math.round(store.volume * 100)"
                @input="handleVolumeInput"
              />
            </div>
          </div>

          <!-- 设备 -->
          <div class="music-device">
            <button class="music-btn" title="输出设备" @click="toggleDeviceList">🎧</button>
            <div v-show="isDeviceOpen" class="music-device__list">
              <div class="music-device__warning">⚠️ 除非你真的知道你在做什么，请不要更改此设置</div>
              <div
                v-for="device in store.devices"
                :key="device.id"
                class="music-device__item"
                :class="{ current: device.id === store.currentDeviceId }"
                @click="store.setDevice(device.id); isDeviceOpen = false"
              >
                <span class="music-device__name">{{ device.name }}</span>
                <span v-if="device.id === store.currentDeviceId" class="music-device__check">✓</span>
              </div>
            </div>
          </div>

          <!-- 播放列表 -->
          <button class="music-btn music-playlist-btn" title="播放列表" @click="togglePlaylist">
            📋
          </button>
        </div>

        <!-- 中间进度条行：当前时间 + 进度条 + 总时长 -->
        <div
          class="music-progress"
          :class="{ 'music-progress--dragging': isDraggingProgress || seekTarget !== null }"
          @click="handleProgressClick"
        >
          <span class="music-progress__time">{{ displayTimeText }}</span>
          <div ref="progressBarRef" class="music-progress__bar" @mousedown="handleProgressMouseDown">
            <div
              class="music-progress__fill"
              :style="{ width: displayProgress + '%' }"
            ></div>
            <div
              class="music-progress__handle"
              :style="{ left: displayProgress + '%' }"
            ></div>
          </div>
          <span class="music-progress__time">{{ store.durationText }}</span>
        </div>

        <!-- 底部控制行：📊榜单(左) + ⏮上一首 + ▶播放 + ⏭下一首 + 🔀模式(右) -->
        <div class="music-controls">
          <button
            v-if="settings.settings.showChartsBtn"
            class="music-btn music-btn--small music-charts-btn"
            title="热歌榜单"
            @click="emit('charts')"
          >
            📊
          </button>
          <button
            class="music-btn music-btn--prev"
            :disabled="!store.hasPrev || controlsDisabled"
            title="上一首"
            @click="store.prev()"
          >
            ⏮
          </button>
          <button
            class="music-btn music-btn--play"
            :data-playing="store.playing"
            :disabled="controlsDisabled"
            @click="store.togglePlay()"
          >
            {{ store.playing ? "⏸" : "▶" }}
          </button>
          <button
            class="music-btn music-btn--next"
            :disabled="controlsDisabled"
            title="下一首"
            @click="store.next()"
          >
            ⏭
          </button>
          <button
            class="music-btn music-btn--mode"
            :class="{ active: store.playMode !== 'order' }"
            :disabled="controlsDisabled"
            :title="store.playModeTitle"
            @click="store.cyclePlayMode()"
          >
            {{ store.playModeIcon }}
          </button>
        </div>

        <!--
          ===== 紧凑模式：轻量浮层（默认）=====
          留在播放器内部（**不 Teleport**），沿用上一版验证过的锚定方式
          `bottom:100%; right:0` —— 这样它天然贴着播放器，且"点外部即关"
          仍然成立（浮层之外就是"外部"）。

          设计语言刻意对齐上一版（cd5a1ed^）：
            标签 chip 前置 → 曲名 → 🗑/▶，行高 28px，窄（260px）。
          它的好用来自**密度**（一眼扫完），不是面积 —— 上一版用 240×280
          就能一屏 8 首；全窗 sheet 一屏 13 首但"扫得慢"。
        -->
        <div
          v-show="isPlaylistOpen && panelMode === 'compact'"
          class="music-list"
        >
          <div class="music-list__header">
            <span class="music-list__title">{{ compactTitle }}</span>
            <span class="music-list__count">{{ compactSongs.length }}</span>
            <button
              class="music-list__btn"
              title="展开为音乐库（目录 / 筛选 / 批量）"
              aria-label="展开为音乐库"
              @click.stop="expandToFull"
            >⤢</button>
            <button
              class="music-list__btn"
              title="刷新曲库"
              aria-label="刷新曲库"
              @click.stop="store.requestPlaylist()"
            >⟳</button>
          </div>

          <div class="music-list__items">
            <div v-if="compactSongs.length === 0" class="music-list__empty">暂无音乐</div>
            <div
              v-for="song in compactSongs"
              :key="song"
              class="music-list__item"
              :class="{ current: song === store.trackName, disabled: controlsDisabled }"
              :title="displayName(song)"
              @click="handleSongClick(song)"
            >
              <!-- 标签 chip 前置：上一版的设计语言（一眼看出分类） -->
              <span
                class="music-list__tag"
                :data-tag="store.playlistTags[song]?.name || '自定义'"
                :style="tagStyle(song)"
                @click.stop="handleTagClick(song, $event)"
              >{{ store.playlistTags[song]?.name || "自定义" }}</span>

              <span class="music-list__name">{{ displayName(song) }}</span>

              <!--
                队列模式 → ✕ 从队列移除（非破坏性）
                曲库模式 → 🗑 删除文件（上一版行为，破坏性）
                用不同图标区分两种语义，避免同一个 🗑 一会儿删队列一会儿删文件
              -->
              <button
                v-if="song !== store.trackName && store.playSetActive"
                class="music-list__action"
                :disabled="controlsDisabled"
                title="从播放列表移除"
                @click.stop="store.removeFromPlaylist(song)"
              >✕</button>
              <button
                v-else-if="song !== store.trackName"
                class="music-list__action"
                :disabled="controlsDisabled"
                title="删除歌曲文件"
                @click.stop="handleDeleteSong(song, $event)"
              >🗑</button>
              <span v-else class="music-list__playing">▶</span>
            </div>
          </div>
        </div>

        <!--
          ===== 全屏模式：曲库管理（显式展开进入）=====
          全窗 sheet，铺满窗口（原为锚在播放器上方的 348×340 小弹窗）。
          为什么改结构见 docs/modules/music-player.md §8.6。
        -->
        <Teleport to=".container" :disabled="!sheetTeleportEnabled" defer>
        <div v-show="isPlaylistOpen && panelMode === 'full'" class="music-playlist">
          <div class="music-playlist__header">
            <!--
              返回按钮放**左侧**，不放右侧：
              右侧紧邻窗口 chrome（📍−×，浮在 sheet 之上），放个 ✕ 会看起来
              像"第 4 个窗口按钮"，用户会犹豫该点哪个关闭。左侧从空间上把
              "内容控件"和"窗口 chrome"分开，也是全屏浮层最常规的关闭位置。
            -->
            <button
              class="music-playlist__back"
              title="返回紧凑列表（不是关闭面板）"
              aria-label="返回紧凑列表"
              @click.stop="collapseToCompact"
            >←</button>
            <span class="music-playlist__title">音乐库</span>
            <span
              v-if="store.playSetActive"
              class="music-playlist__source"
              :title="`播放集合来源：${store.playSetSource}`"
            >🎵 {{ store.playSetSource }}</span>
            <div class="music-playlist__header-actions">
              <!--
                刷新按钮：原来用 emoji「🔄」，它在 Windows 上渲染成**亮蓝色方块**，
                与面板的暗红主题冲突、看着像个没样式化的默认按钮。
                改用文本字形「⟳」（U+27F3，由 CSS 着色），并补 title ——
                title 会变成 UIA 的 HelpText，是自动化里最稳定的定位标识。
              -->
              <button
                class="music-playlist__refresh"
                title="刷新曲库"
                aria-label="刷新曲库"
                @click.stop="store.requestPlaylist()"
              >⟳</button>
            </div>
          </div>

          <!-- 三个选项卡并排：目录 / 筛选 / 播放列表 -->
          <div class="music-playlist__tabs">
            <button
              class="music-playlist__tab dir"
              :class="{ active: panelTab === 'dir' }"
              @click="panelTab = 'dir'"
            >📁 目录</button>
            <button
              class="music-playlist__tab filter"
              :class="{ active: panelTab === 'filter' }"
              @click="panelTab = 'filter'"
            >🔍 筛选</button>
            <button
              class="music-playlist__tab playlist"
              :class="{ active: panelTab === 'playlist' }"
              @click="panelTab = 'playlist'"
            >🎵 播放列表
              <span v-if="store.playSet.size > 0" class="music-playlist__tab-badge">{{ store.playSet.size }}</span>
            </button>
          </div>

          <!--
            主体：目录 tab 时是「左栏目录树 | 右栏歌单」的两栏（master-detail），
            其余 tab 是单栏。--split 只在目录 tab 生效，避免其它 tab 留一条空栏。
          -->
          <div
            class="music-playlist__body"
            :class="{ 'music-playlist__body--split': panelTab === 'dir' }"
          >
          <!-- 左栏：目录树（字段投影，实时派生）。独立滚动，不再抢歌单的纵向空间 -->
          <aside v-show="panelTab === 'dir'" class="music-playlist__dirs">
            <div class="music-playlist__dir-row">
              <span class="music-playlist__dir-caret music-playlist__dir-caret--leaf">·</span>
              <button
                class="music-playlist__dir"
                :class="{ active: store.activeDir === null }"
                @click="store.toggleDir(null)"
              >📁 全部</button>
            </div>
            <div class="music-playlist__dir-row">
              <span class="music-playlist__dir-caret music-playlist__dir-caret--leaf">·</span>
              <button
                class="music-playlist__dir"
                :class="{ active: store.activeDir === '' }"
                @click="store.toggleDir('')"
              >🗂 未分类</button>
            </div>
            <div v-for="row in flatDirs" :key="row.path" class="music-playlist__dir-row">
              <span
                v-if="row.hasChildren"
                class="music-playlist__dir-caret"
                @click.stop="toggleExpandDir(row.path)"
              >{{ expandedDirs.has(row.path) ? "▾" : "▸" }}</span>
              <span v-else class="music-playlist__dir-caret music-playlist__dir-caret--leaf">·</span>
              <button
                class="music-playlist__dir"
                :class="{ active: store.activeDir === row.path }"
                :style="{ paddingLeft: depthPadding(row.depth) }"
                @click="store.toggleDir(row.path)"
              >📁 {{ row.name }} <span class="music-playlist__dir-count">{{ row.count }}</span></button>
            </div>
          </aside>

          <!-- 右栏：筛选条 / 歌单 / 底部动作（目录与筛选两个 tab 共用同一个歌单列表） -->
          <section class="music-playlist__main">
          <!-- 筛选 tab：搜索 + 标签 chips（多选 AND + 计数） -->
          <div v-show="panelTab === 'filter'" class="music-playlist__filters">
            <div class="music-playlist__toolbar">
              <input
                v-model="store.searchQuery"
                class="music-playlist__search"
                type="text"
                placeholder="🔍 搜索歌曲…"
              />
              <span class="music-playlist__stats">{{ store.filteredCount }} / {{ store.playlist.length }}</span>
            </div>
            <div v-if="store.allTags.length > 0" class="music-playlist__tags">
              <button
                v-for="t in store.allTags"
                :key="t.name"
                class="music-playlist__tagchip"
                :class="{ active: store.selectedTags.has(t.name) }"
                :style="tagChipStyle(t.name)"
                @click="store.toggleTag(t.name)"
              >{{ t.name }} <span class="music-playlist__tagchip-count">{{ t.count }}</span></button>
            </div>
          </div>

          <!-- 浏览列表（目录/筛选共用）：单击=选中、Shift/Ctrl 多选、再次单击取消、双击=加入、右键=菜单、可拖入播放列表 -->
          <div v-show="panelTab !== 'playlist'" class="music-playlist__items">
            <div v-if="store.playlist.length === 0" class="music-playlist__empty">暂无音乐</div>
            <div v-else-if="store.filteredSongs.length === 0" class="music-playlist__empty">没有符合筛选的歌曲</div>
            <div
              v-for="(song, index) in store.filteredSongs"
              :key="song"
              class="music-playlist__item"
              :class="{
                current: song === store.trackName,
                selected: store.selection.has(song),
                disabled: controlsDisabled,
                inSet: store.playSet.has(song),
              }"
              draggable="true"
              @click="handleRowClick(song, $event, index)"
              @dblclick.prevent="handleRowDblClick(song)"
              @contextmenu.prevent="openCtxMenu(song, $event)"
              @dragstart="handleDragStart($event, song)"
            >
              <span v-if="song === store.trackName" class="music-playlist__playing">▶</span>
              <span class="music-playlist__name">{{ displayName(song) }}</span>
              <span v-if="songMetaOf(song).path" class="music-playlist__path" :title="songMetaOf(song).path">📁{{ shortPath(songMetaOf(song).path) }}</span>
              <span
                v-for="(tg, i) in songTagsOf(song).slice(0, 2)"
                :key="i"
                class="music-playlist__tag"
                :data-tag="tg"
                :style="tagChipStyle(tg)"
                @click.stop="handleTagClick(song, $event)"
              >{{ tg }}</span>
              <button
                class="music-playlist__add"
                :class="{ active: store.playSet.has(song) }"
                :title="store.playSet.has(song) ? '已在播放列表（集合）' : '加入播放列表（集合）'"
                @click.stop="handleAddToPlaylist(song)"
              >{{ store.playSet.has(song) ? "✓" : "+" }}</button>
            </div>
          </div>

          <!-- 浏览区底部：全部加入播放列表 + 清除筛选（同一行，位置稳定）；批量操作走右键 -->
          <div v-show="panelTab !== 'playlist'" class="music-playlist__browse-actions">
            <button
              class="music-playlist__action music-playlist__action--primary"
              :disabled="store.filteredSongs.length === 0 || controlsDisabled"
              @click="handleAddViewToPlaylist"
            >➕ 全部加入播放列表</button>
            <button
              v-if="store.hasFilter"
              class="music-playlist__clearfilter"
              title="清除筛选：只重置浏览，不影响播放列表"
              @click.stop="store.clearFilters()"
            >✕ 清除筛选</button>
            <span v-if="store.selection.size > 0" class="music-playlist__selection-count">已选 {{ store.selection.size }} 首（右键批量操作）</span>
          </div>

          <!-- ===== 播放列表 tab（集合：无序、独立；所有播放行为都在这里） ===== -->
          <div v-show="panelTab === 'playlist'" class="music-playlist__collection">
            <div class="music-playlist__collection-header">
              <span>🎵 播放列表（集合 · {{ store.playSet.size }} 首）</span>
              <button
                v-if="store.playSetActive"
                class="music-playlist__collection-clear"
                title="清空播放列表：播完当前歌即停"
                @click="store.clearPlaylistSet()"
              >⏹ 清空</button>
            </div>
            <div
              v-if="store.playSet.size === 0"
              class="music-playlist__collection-items music-playlist__collection-items--empty"
              :class="{ 'music-playlist__collection-items--dragover': collectionDragOver }"
              @dragover="onCollectionDragOver"
              @dragleave="onCollectionDragLeave"
              @drop="handleDropToCollection"
            >
              <div class="music-playlist__empty music-playlist__empty--collection">
                空集合：双击歌曲 / 拖到这里 / 点 <b>+</b> 加入
              </div>
            </div>
            <div
              v-else
              class="music-playlist__collection-items"
              :class="{ 'music-playlist__collection-items--dragover': collectionDragOver }"
              @dragover="onCollectionDragOver"
              @dragleave="onCollectionDragLeave"
              @drop="handleDropToCollection"
            >
              <div
                v-for="song in [...store.playSet]"
                :key="song"
                class="music-playlist__collection-item"
                :class="{ current: song === store.trackName }"
                @click="handleSongClick(song)"
              >
                <span class="music-playlist__collection-name">{{ displayName(song) }}</span>
                <button
                  class="music-playlist__collection-remove"
                  title="从播放列表移除"
                  @click.stop="store.removeFromPlaylist(song)"
                >✕</button>
              </div>
            </div>
            <div class="music-playlist__collection-actions">
              <button
                class="music-playlist__action music-playlist__action--primary"
                :disabled="store.playSet.size === 0 || controlsDisabled || store.syncEnabled"
                title="按当前播放模式从集合第一首播"
                @click="store.playCollection(false)"
              >▶ 播放集合</button>
              <button
                class="music-playlist__action"
                :disabled="store.playSet.size === 0 || controlsDisabled || store.syncEnabled"
                title="切随机模式并从集合随机抽歌"
                @click="store.playCollection(true)"
              >🔀 随机播放集合</button>
            </div>
          </div>
          </section>
          </div>

          <!--
            Toast 提示：浮在 sheet 底部动作条上方（不是面板外）。
            全窗 sheet 下它不再有"遮住面板按钮"的风险，但仍在 sheet 内部，
            保证任何布局下都不会跑到窗口外面。
          -->
          <div v-if="toastVisible" class="music-toast">{{ toastMessage }}</div>
        </div>
        </Teleport>
      </div>
    </div>

    <!-- 右键菜单（Teleport 到 body，锚定鼠标位置，向上/向下展开；批量操作作用于整个选择集，Windows 风格） -->
    <Teleport to="body">
      <div
        v-if="ctxMenu.visible"
        class="music-playlist__ctxmenu"
        :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
        @click.stop
        @contextmenu.prevent
      >
        <div v-if="store.selection.size > 1" class="music-playlist__ctxmenu-hint">
          已选 {{ store.selection.size }} 首 · 操作作用于全部选中项
        </div>
        <button @click="ctxPlay(ctxMenu.song)">▶ 播放</button>
        <button @click="ctxAdd()">🎵 添加到播放列表</button>
        <button @click="ctxMenuMoveOpen = !ctxMenuMoveOpen">📁 移动到目录…</button>
        <div v-if="ctxMenuMoveOpen" class="music-playlist__ctxmenu-sub">
          <button @click="ctxMove('')">🗂 未分类</button>
          <button v-for="row in flatDirs" :key="row.path" @click="ctxMove(row.path)">
            📁 {{ row.path }}
          </button>
        </div>
        <button @click="ctxMenuTagOpen = !ctxMenuTagOpen">🏷 设置标签…</button>
        <div v-if="ctxMenuTagOpen" class="music-playlist__ctxmenu-sub">
          <button
            v-for="t in store.allTags"
            :key="t.name"
            :class="{ active: batchTagDraft.has(t.name) }"
            @click="toggleCtxTag(t.name)"
          >{{ t.name }}</button>
          <button class="apply" @click="ctxApplyTags()">✓ 应用（{{ batchTagDraft.size }}）</button>
        </div>
        <button @click="ctxFav()">♥ 标记到「喜欢」</button>
        <button class="danger" @click="ctxDelete()">
          {{ confirmDeleteSelection ? "确认删除？" : "🗑 删除所选" }}
        </button>
      </div>
    </Teleport>

    <!-- 标签选择弹窗 -->
    <MusicTagModal
      v-model:visible="tagModalVisible"
      :song-name="displayName(tagEditSong)"
      :current-tag="tagEditCurrent"
      :custom-tags="store.customTags"
      :advanced-color-enabled="settings.settings.advancedColorCustomization"
      @select-tag="onTagSelect"
      @add-tag="onTagAdd"
      @delete-tag="onTagDelete"
    />
  </div>
</template>

<style scoped>
/* 音乐播放器 - 绝对定位在 main-content 底部居中（匹配原版） */
/* z-index 使用 --z-overlay-ui(200)，高于 header-btn(100)/mode-slider(50)/sidebar-btn(10)，
   确保输出设备弹框与播放列表浮层不被侧边栏区域遮挡 */
.music-player {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  width: 100%;
  max-width: 300px;
  overflow: visible;
  z-index: var(--z-overlay-ui);
  color: #fff;
  font-size: 13px;
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
}

/* 收起按钮 - 顶部小条（紧贴播放器顶部边缘） */
.music-collapse-btn {
  position: absolute;
  top: -1px;
  left: 50%;
  transform: translateX(-50%);
  width: 60px;
  height: 8px;
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-top: none;
  border-radius: 0 0 6px 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  z-index: var(--z-sidebar-btn);
}

.music-collapse-btn:hover {
  background: rgba(255, 255, 255, 0.25);
  width: 70px;
  height: 10px;
  border-radius: 0 0 9px 9px;
}

.music-collapse-icon {
  font-size: 6px;
  color: rgba(255, 255, 255, 0.6);
  transition: transform 0.45s cubic-bezier(0.5, 0, 0.5, 1);
  transform: rotate(0deg);  /* 展开状态：▼向下 */
}

/* 收起状态：图标翻转 ▲向上 */
.music-player.collapsed .music-collapse-icon {
  transform: rotate(180deg);
}

/* ============ 收起状态：律动条 + 曲名（绝对定位，opacity 过渡） ============ */
.music-player__collapsed {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  cursor: pointer;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 0.45s cubic-bezier(0.5, 0, 0.5, 1);
}

.music-player.collapsed .music-player__collapsed {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}

.music-player__collapsed-track {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.music-visualizer {
  display: flex;
  gap: 2px;
  align-items: flex-end;
  height: 16px;
}

.music-visualizer__bar {
  width: 3px;
  height: 4px;
  background: rgba(255, 255, 255, 0.5);
  border-radius: 2px;
}

.music-visualizer__bar.playing {
  animation: visualizerBounce 0.8s ease-in-out infinite;
}

@keyframes visualizerBounce {
  0%, 100% { height: 4px; }
  50% { height: 14px; }
}

/* ============ 展开内容容器：max-height 过渡实现收起/展开动画 ============ */
.music-wrapper {
  overflow: visible;
  max-height: 300px;
  transition: max-height 0.45s cubic-bezier(0.5, 0, 0.5, 1);
}

.music-player.collapsed .music-wrapper {
  max-height: 0;
  overflow: hidden;
}

.music-player__main {
  display: flex;
  flex-direction: column;
  padding: 10px 14px 6px 14px;
  gap: 6px;
}

/* ============ 顶部信息行：🎵 曲名 + 音量 + 设备 + 播放列表 ============ */
.music-info {
  display: flex;
  align-items: center;
  gap: 6px;
  position: relative;
  overflow: visible;
}

.music-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.music-player__track-name {
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  flex: 1;
  color: rgba(255, 255, 255, 0.95);
  position: relative;
  /* v4.6.0：长歌名内部横向滚动（scrollWidth > clientWidth 时启用），
     不设 text-overflow 截断，改用 .track-scroll 滚动显示完整曲名 */
}

.music-player__track-name.error {
  color: rgba(255, 150, 100, 0.95);
}

.music-player__track-name.empty {
  color: rgba(255, 255, 255, 0.5);
}

/* 曲名滚动容器：溢出时横向平移，未溢出保持静止 */
.music-player__track-scroll {
  display: inline-block;
  white-space: nowrap;
  will-change: transform;
}

.music-player__track-scroll.active {
  animation: trackNameMarquee 12s linear infinite;
}

@keyframes trackNameMarquee {
  0% {
    transform: translateX(0);
  }
  8% {
    transform: translateX(0);
  }
  92% {
    transform: translateX(calc(-100% + var(--track-marquee-end, 160px)));
  }
  100% {
    transform: translateX(calc(-100% + var(--track-marquee-end, 160px)));
  }
}

/* v4.6.0：传输通道徽章（P2P 直连 / 服务器中转） */
.music-player__transfer-channel {
  flex-shrink: 0;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  line-height: 1.5;
  font-weight: 500;
  white-space: nowrap;
}

.music-player__transfer-channel--p2p {
  background: rgba(102, 187, 106, 0.18);
  color: #66bb6a;
  border: 1px solid rgba(102, 187, 106, 0.35);
}

.music-player__transfer-channel--server {
  background: rgba(255, 193, 7, 0.15);
  color: #ffca28;
  border: 1px solid rgba(255, 193, 7, 0.3);
}

/* ============ 底部控制行：榜单(左) + 上一首 + 播放 + 下一首 + 模式(右) ============ */
.music-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  position: relative;
}

/* 左侧榜单按钮用绝对定位，不影响中间按钮居中 */
.music-controls .music-charts-btn {
  position: absolute;
  left: 0;
}

/* 右侧模式按钮用绝对定位，不影响中间按钮居中 */
.music-controls .music-btn--mode {
  position: absolute;
  right: 0;
}

/* 基础按钮（音量/设备/播放列表）：24x24 圆形，参照原版 .music-device-btn */
.music-btn {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 0;
}

.music-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.9);
  transform: scale(1.1);
}

.music-btn:active {
  transform: scale(0.95);
}

/* 同步听歌：非 DJ 用户禁用播放器控制 */
.music-btn:disabled,
.music-playlist__delete:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  pointer-events: none;
  transform: none;
}

.music-playlist__item.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* 小按钮（榜单/模式/播放列表）：20x20 圆形，参照原版 .music-btn-small */
.music-btn--small,
.music-btn--mode,
.music-playlist-btn {
  width: 20px;
  height: 20px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.1);
}

.music-btn--small:hover,
.music-btn--mode:hover,
.music-playlist-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.9);
  transform: scale(1.1);
}

/* 主控制按钮（上一首/下一首）：32x32 圆形，参照原版 .music-btn */
.music-btn--prev,
.music-btn--next {
  width: 32px;
  height: 32px;
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  font-size: 12px;
}

.music-btn--prev:hover,
.music-btn--next:hover {
  background: rgba(255, 255, 255, 0.25);
  transform: scale(1.05);
}

/* 播放按钮：38x38 圆形，参照原版 .music-play */
.music-btn--play {
  width: 38px;
  height: 38px;
  background: rgba(255, 255, 255, 0.25);
  color: #fff;
  font-size: 14px;
}

.music-btn--play:hover {
  background: rgba(255, 255, 255, 0.35);
  transform: scale(1.05);
}

.music-btn--play[data-playing="true"] {
  background: rgba(255, 255, 255, 0.35);
}

/* 模式按钮 active 状态：参照原版，背景变亮 */
.music-btn--mode.active {
  background: rgba(255, 255, 255, 0.3);
  color: rgba(255, 255, 255, 0.95);
}

/* ============ 进度条行 ============ */
.music-progress {
  display: flex;
  align-items: center;
  gap: 8px;
}

.music-progress__time {
  font-size: 11px;
  color: #fff;
  font-variant-numeric: tabular-nums;
  width: 36px;
  text-align: center;
}

.music-progress__bar {
  flex: 1;
  height: 4px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 2px;
  cursor: pointer;
  position: relative;
  user-select: none;
}

.music-progress--dragging .music-progress__bar {
  cursor: grabbing;
}

.music-progress__fill {
  height: 100%;
  background: #e94560;
  border-radius: 2px;
  transition: width 0.2s ease;
}

.music-progress--dragging .music-progress__fill {
  transition: none;
}

.music-progress__handle {
  position: absolute;
  top: 50%;
  width: 10px;
  height: 10px;
  background: #fff;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.4);
  transition: left 0.2s ease;
}

.music-progress--dragging .music-progress__handle {
  transition: none;
  width: 14px;
  height: 14px;
}

/* ============ 音量控制 ============ */
/* 仅 .music-volume 设为 relative，让音量拨动条相对其定位 */
/* .music-device 不设 relative，让设备列表相对 .music-info 定位（参照原版） */
.music-volume {
  position: relative;
}

/* 音量拨动条：z-index 使用 --z-popup，可暂时遮住展开/收起按钮 */
.music-volume__slider {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-bottom: 6px;
  background: linear-gradient(145deg, rgba(255, 120, 120, 0.5), rgba(255, 100, 100, 0.4));
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  padding: 10px 6px;
  z-index: var(--z-popup);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  backdrop-filter: blur(4px);
}

/* 休息模式 - 绿色调 */
.container.break-mode .music-volume__slider {
  background: linear-gradient(145deg, rgba(100, 200, 140, 0.5), rgba(80, 180, 120, 0.4));
}

/* 竖向滑块：4px 宽 × 100px 高（参照原版） */
.music-volume__slider input {
  -webkit-appearance: none;
  appearance: none;
  width: 4px;
  height: 100px;
  background: rgba(255, 255, 255, 0.25);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
  writing-mode: vertical-lr;
  direction: rtl;
}

.music-volume__slider input::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  background: #fff;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  transition: transform 0.15s ease;
}

.music-volume__slider input::-webkit-slider-thumb:hover {
  transform: scale(1.1);
}

.music-volume__slider input::-moz-range-thumb {
  width: 14px;
  height: 14px;
  background: #fff;
  border-radius: 50%;
  cursor: pointer;
  border: none;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
}

/* ============ 输出设备列表 ============ */
/* z-index 使用 --z-popup，在 .music-player 层叠上下文内高于其他浮层；
   .music-player 自身 z-index 为 --z-overlay-ui(200)，高于侧边栏与 HeaderButtons */
.music-device__list {
  position: absolute;
  bottom: 100%;
  right: 0;
  margin-bottom: 4px;
  background: rgba(40, 40, 50, 0.98);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  padding: 6px;
  min-width: 220px;
  max-height: 200px;
  overflow-y: auto;
  z-index: var(--z-popup);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

/* 设备列表滚动条 */
.music-device__list::-webkit-scrollbar {
  width: 6px;
}

.music-device__list::-webkit-scrollbar-track {
  background: transparent;
}

.music-device__list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
}

.music-device__list::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.4);
}

.music-device__warning {
  font-size: 10px;
  color: rgba(255, 200, 100, 0.8);
  padding: 4px 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  margin-bottom: 4px;
}

.music-device__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}

.music-device__item:hover {
  background: rgba(255, 255, 255, 0.08);
}

.music-device__item.current {
  background: rgba(233, 69, 96, 0.2);
}

.music-device__name {
  color: #ddd;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.music-device__check {
  color: #4caf50;
  font-weight: 700;
}

/* ============ 紧凑模式：轻量浮层 ============ */
/*
 * 对齐上一版（cd5a1ed^）的设计语言，只做必要的现代化修正：
 *   · 240→262px：上一版长曲名截断得厉害；262 是"少截断"与"保持窄"的折中
 *   · max-height 280→340：可用的纵向空间本来就有约 430px，多显示几首
 *   · 背景 rgba(...,0.98)→不透明：半透明会让背后的计时器留下可见鬼影（实测过）
 *   · 行高保持 28px —— 这是"一眼扫完"的关键，不要为了好看加大
 */
.music-list {
  position: absolute;
  bottom: 100%;
  right: 0;
  margin-bottom: 8px;
  width: 262px;
  max-height: 340px;
  display: flex;
  flex-direction: column;
  background: #282833;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(0, 0, 0, 0.25);
  z-index: var(--z-popup);
  overflow: hidden;
}

.music-list__header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

.music-list__title {
  font-size: 13px;
  font-weight: 600;
  color: #fff;
}

.music-list__count {
  font-size: 10px;
  font-weight: 600;
  min-width: 16px;
  padding: 1px 5px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.8);
  text-align: center;
  font-variant-numeric: tabular-nums;
}

/* ⤢ / ⟳ 图标按钮：28×28（达到桌面指针目标下限），放在 count 之后的右侧 */
.music-list__btn {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.62);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

/* 第一个按钮（⤢）推开到最右，⟳ 紧跟其后 */
.music-list__btn:first-of-type {
  margin-left: auto;
}

.music-list__btn:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(233, 69, 96, 0.6);
  color: #fff;
}

.music-list__items {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.music-list__items::-webkit-scrollbar {
  width: 4px;
}

.music-list__items::-webkit-scrollbar-track {
  background: transparent;
}

.music-list__items::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
}

.music-list__items::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.4);
}

.music-list__empty {
  padding: 22px 24px;
  text-align: center;
  color: rgba(255, 255, 255, 0.42);
  font-size: 12px;
}

/* 行：上一版是 min-height:28px + padding 6px 10px —— 保持这个密度 */
.music-list__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  min-height: 28px;
  box-sizing: border-box;
  cursor: pointer;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
}

.music-list__item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.music-list__item.current {
  background: rgba(233, 69, 96, 0.14);
}

.music-list__item.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 标签 chip：固定最小宽度，让右侧曲名起始位置对齐（上一版的观感） */
.music-list__tag {
  font-size: 9px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  color: #ccc;
  flex-shrink: 0;
  min-width: 28px;
  text-align: center;
  cursor: pointer;
  transition: filter 0.15s ease;
}

.music-list__tag:hover {
  filter: brightness(1.25);
}

.music-list__tag[data-tag="学习"] { background: rgba(116, 185, 255, 0.28); color: #cfe6ff; }
.music-list__tag[data-tag="运动"] { background: rgba(255, 150, 100, 0.28); color: #ffd9c4; }
.music-list__tag[data-tag="休息"] { background: rgba(90, 180, 140, 0.28); color: #c6f0dc; }
.music-list__tag[data-tag="白噪音"] { background: rgba(72, 219, 251, 0.28); color: #c9f2fd; }

.music-list__name {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.9);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.music-list__item.current .music-list__name {
  color: #fff;
  font-weight: 600;
}

/* ✕ 移除 / 🗑 删除：24×24 热区，hover 才显形（不抢曲名的视觉注意力） */
.music-list__action {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border: none;
  background: none;
  color: rgba(255, 255, 255, 0.4);
  font-size: 12px;
  line-height: 1;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, color 0.15s ease;
}

.music-list__item:hover .music-list__action {
  color: rgba(255, 255, 255, 0.75);
}

.music-list__action:hover {
  background: rgba(233, 69, 96, 0.35);
  color: #fff;
}

.music-list__playing {
  width: 24px;
  flex-shrink: 0;
  text-align: center;
  font-size: 10px;
  color: #ff8a9c;
}

/* ============ 音乐库（全窗 sheet）============ */
/*
 * 设计：铺满整个窗口（520×560），不是锚在播放器上方的小弹窗。
 *
 * 为什么必须改结构：原来只有 348×340，却要同时放「目录树」和「歌单」两个
 * 纵向列表 → 两者互相挤压、必须长距离上下滚动。这是结构问题，微调细节解决不了。
 * 现在：目录树是左栏（独立滚动），歌单占右栏全部高度。
 *
 * 定位说明：属性写 absolute + inset:0，实际相对 .container（Teleport 目标）。
 * 圆角由上层 .window-frame 的 overflow:hidden 提供 —— 这里**不要再写
 * border-radius**，否则会在圆角处露出 .container 的红色渐变。
 *
 * z-index: --z-popup(1000)。窗口 chrome（📍−×）已抬到 --z-window-chrome(1100)
 * 浮在其上，保证 decorations:false 的窗口始终关得掉。
 */
.music-playlist {
  position: absolute;
  inset: 0;
  /* 不透明：半透明会让背后的计时器透出来（实测有可见鬼影），
     而且歌单文字需要实心表面保证对比度 */
  background: #282833;
  display: flex;
  flex-direction: column;
  z-index: var(--z-popup);
}

/* 浏览 tab 内模式切换（目录 / 筛选 拆开） */
.music-playlist__browse-modes {
  display: flex;
  gap: 4px;
  padding: 6px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.music-playlist__browse-mode {
  flex: 1;
  padding: 4px 0;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid transparent;
  color: rgba(255, 255, 255, 0.65);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.music-playlist__browse-mode:hover {
  background: rgba(255, 255, 255, 0.1);
}

.music-playlist__browse-mode.active {
  background: rgba(233, 69, 96, 0.22);
  border-color: #e94560;
  color: #fff;
}

/* 小标签切换（全宽三段，高 44px：整条都是热区，好点） */
.music-playlist__tabs {
  display: flex;
  gap: 6px;
  padding: 6px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
  height: 44px;
  box-sizing: border-box;
}

/*
 * 主体：目录 tab = 两栏（目录树 | 歌单），其余 tab = 单栏。
 * 这是本次设计的核心 —— 把目录树从"占纵向空间的一行"改成"占横向空间的一栏"，
 * 两个列表从此各有一整列高度、各自独立滚动，不再互相挤压。
 */
.music-playlist__body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.music-playlist__main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.music-playlist__tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 5px 0;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid transparent;
  color: rgba(255, 255, 255, 0.65);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.music-playlist__tab:hover {
  background: rgba(255, 255, 255, 0.1);
}

/*
 * 激活态：**实心填充**而不是描边。
 * 原来用 border-color:#e94560 的描边，三个 tab 看起来像三个输入框、
 * 而不是"当前选中的页签"。实心填充才是分段控件的通用语义。
 */
.music-playlist__tab.active {
  background: #c8405a;
  border-color: #c8405a;
  color: #fff;
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(200, 64, 90, 0.35);
}

.music-playlist__tab-badge {
  font-size: 10px;
  font-weight: 600;
  min-width: 16px;
  padding: 1px 5px;
  border-radius: 8px;
  /* 改用中性浅色胶囊：原来的半透明红在"已激活的红底 tab"上会糊成一片看不见 */
  background: rgba(255, 255, 255, 0.28);
  color: #fff;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

/* ── 全窗 sheet 分三层：header / tabs / body（+ 主体内部各自的底栏）─── */

.music-playlist__header {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 52px;
  box-sizing: border-box;
  /*
   * 右侧留 108px：窗口 chrome（📍置顶 + − 最小化 + × 关闭）浮在 sheet 之上，
   * 占据 x≈426..510。不留空位的话本面板的按钮会被压在它们下面、点不到。
   */
  padding: 0 108px 0 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
}

/* 刷新按钮靠右（返回按钮在左，见 header 注释） */
.music-playlist__header-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.music-playlist__title {
  font-size: 15px;
  font-weight: 600;
  color: #fff;
  flex-shrink: 0;
}

/* 返回 / 刷新共用一套图标按钮外观（都是 28×28，达到桌面指针目标下限） */
.music-playlist__back,
.music-playlist__refresh {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.62);
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, transform 0.2s ease;
}

.music-playlist__back:hover,
.music-playlist__refresh:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(233, 69, 96, 0.6);
  color: #fff;
}

.music-playlist__refresh:active {
  transform: rotate(180deg);
}

/* 返回按钮 hover 用红色，语义上区别于刷新 */
.music-playlist__back:hover {
  background: rgba(233, 69, 96, 0.75);
  border-color: rgba(233, 69, 96, 0.9);
  color: #fff;
}

.music-playlist__items {
  overflow-y: auto;
  /* min-height:0 是必需的：flex 子项默认 min-height:auto 会拒绝收缩，
     列表就无法在 sheet 内滚动 */
  flex: 1 1 auto;
  min-height: 0;
}

/* 播放列表滚动条 */
.music-playlist__items::-webkit-scrollbar {
  width: 4px;
}

.music-playlist__items::-webkit-scrollbar-track {
  background: transparent;
}

.music-playlist__items::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
}

.music-playlist__items::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.4);
}

.music-playlist__empty {
  /* 在整片列表区里**垂直居中**（原来只是顶部一块小 padding，
     在全窗 sheet 的大片空白里会显得像"内容丢了"） */
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  box-sizing: border-box;
  padding: 24px;
  color: rgba(255, 255, 255, 0.42);
  font-size: 13px;
  text-align: center;
}

.music-playlist__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
  min-height: 28px;
  box-sizing: border-box;
}

.music-playlist__item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.music-playlist__item.current {
  background: rgba(233, 69, 96, 0.12);
}

.music-playlist__item.selected {
  background: rgba(233, 69, 96, 0.18);
  box-shadow: inset 2px 0 0 #e94560;
}

.music-playlist__item.selected.current {
  background: rgba(180, 120, 160, 0.25);
  box-shadow: inset 2px 0 0 #e94560;
}

.music-playlist__tag {
  font-size: 8px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  color: #ccc;
  flex-shrink: 0;
  cursor: pointer;
  transition: filter 0.15s ease, transform 0.15s ease;
}

.music-playlist__tag:hover {
  filter: brightness(1.2);
  transform: scale(1.05);
}

/* 预设标签默认配色（与弹窗 .tag-option[data-tag] 一致） */
.music-playlist__tag[data-tag="学习"] {
  background: rgba(100, 180, 255, 0.3);
  color: rgba(200, 230, 255, 1);
}

.music-playlist__tag[data-tag="运动"] {
  background: rgba(255, 150, 100, 0.3);
  color: rgba(255, 210, 180, 1);
}

.music-playlist__tag[data-tag="休息"] {
  background: rgba(100, 230, 100, 0.3);
  color: rgba(200, 255, 200, 1);
}

.music-playlist__name {
  flex: 1;
  font-size: 10px;
  color: #ddd;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.music-playlist__delete,
.music-playlist__playing {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  box-sizing: border-box;
}

.music-playlist__delete {
  background: none;
  border: none;
  color: #666;
  cursor: pointer;
  font-size: 12px;
  padding: 0;
}

.music-playlist__delete:hover {
  color: #e94560;
}

.music-playlist__playing {
  color: #e94560;
  font-size: 10px;
}

/* ============ 音乐库管理：工具栏 / 目录树 / 标签筛选 / 动作条 ============ */

.music-playlist__source {
  flex: 1;
  margin: 0 8px;
  font-size: 11px;
  font-weight: 500;
  color: #ffd54f;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.music-playlist__toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.music-playlist__search {
  flex: 1;
  min-width: 0;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  color: #eee;
  font-size: 12px;
  padding: 5px 8px;
  outline: none;
}

.music-playlist__search::placeholder {
  color: rgba(255, 255, 255, 0.4);
}

.music-playlist__search:focus {
  border-color: rgba(255, 255, 255, 0.35);
}

.music-playlist__stats {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

/* 左栏：目录树。固定宽 150px，占满主体高度、自己滚动。
   原来它是主体里的一个"行"（max-height:112px），会把歌单挤到只剩 2-3 行。 */
.music-playlist__dirs {
  flex: 0 0 150px;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 6px;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  box-sizing: border-box;
}

/* 目录树的滚动条（与歌单一致） */
.music-playlist__dirs::-webkit-scrollbar {
  width: 4px;
}

.music-playlist__dirs::-webkit-scrollbar-track {
  background: transparent;
}

.music-playlist__dirs::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
}

.music-playlist__dir-row {
  display: flex;
  align-items: center;
  gap: 2px;
}

.music-playlist__dir-caret {
  width: 14px;
  text-align: center;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  flex-shrink: 0;
  user-select: none;
}

.music-playlist__dir-caret--leaf {
  cursor: default;
  /* 原来是一个"·"点：既无信息量又是视觉噪声（每行都有）。
     改成透明但保留宽度 —— 缩进对齐不受影响。 */
  color: transparent;
}

.music-playlist__dir {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 6px;
  background: none;
  border: 1px solid transparent;
  color: rgba(255, 255, 255, 0.75);
  font-size: 12px;
  cursor: pointer;
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
}

.music-playlist__dir:hover {
  background: rgba(255, 255, 255, 0.08);
}

.music-playlist__dir.active {
  /* 同 tab：实心填充，去掉"红框"（原来满宽的描边像被聚焦的输入框） */
  background: rgba(233, 69, 96, 0.26);
  border-color: transparent;
  color: #fff;
  font-weight: 600;
}

.music-playlist__dir-count {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.45);
  font-variant-numeric: tabular-nums;
  margin-left: auto;
}

/* 标签筛选 chips */
.music-playlist__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.music-playlist__tagchip {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.8);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s ease;
}

.music-playlist__tagchip:hover {
  filter: brightness(1.15);
}

.music-playlist__tagchip.active {
  border-color: #e94560;
  background: rgba(233, 69, 96, 0.25);
  color: #fff;
}

.music-playlist__tagchip-count {
  font-size: 10px;
  opacity: 0.7;
  margin-left: 2px;
  font-variant-numeric: tabular-nums;
}

.music-playlist__clearfilter {
  margin-left: auto;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.15);
  cursor: pointer;
}

.music-playlist__clearfilter:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.12);
}

/* 歌曲行：目录/标签/喜欢 */
.music-playlist__path {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.07);
  color: rgba(255, 255, 255, 0.5);
  flex-shrink: 0;
  white-space: nowrap;
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.music-playlist__fav {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.3);
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
  padding: 0 2px;
  transition: color 0.15s ease, transform 0.15s ease;
}

.music-playlist__fav:hover {
  color: #ff6b9d;
  transform: scale(1.15);
}

.music-playlist__fav.active {
  color: #ff6b9d;
}

/* ===== 浏览区与播放列表（集合）分区 ===== */

.music-playlist__browse {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.music-playlist__items {
  flex: 1;
  min-height: 0;
}

/* 筛选折叠开关（默认收起） */
.music-playlist__filter-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: none;
  border: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.8);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
  width: 100%;
}

.music-playlist__filter-toggle:hover {
  background: rgba(255, 255, 255, 0.05);
}

.music-playlist__filter-caret {
  width: 12px;
  color: rgba(255, 255, 255, 0.5);
}

.music-playlist__filter-badge {
  margin-left: auto;
  font-size: 10px;
  font-weight: 500;
  padding: 1px 7px;
  border-radius: 8px;
  background: rgba(233, 69, 96, 0.35);
  color: #ffd0d6;
  font-variant-numeric: tabular-nums;
}

.music-playlist__filters {
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.music-playlist__filterbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
}

.music-playlist__filter-hint {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
}

/* 浏览区底部：全部加入播放列表 */
.music-playlist__browse-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

/* 单曲加入播放列表（集合）按钮 */
.music-playlist__add {
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.25);
  color: rgba(255, 255, 255, 0.7);
  border-radius: 6px;
  width: 20px;
  height: 20px;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.music-playlist__add:hover {
  border-color: #e94560;
  color: #ffd0d6;
  transform: scale(1.1);
}

.music-playlist__add.active {
  background: rgba(233, 69, 96, 0.35);
  border-color: #e94560;
  color: #fff;
}

.music-playlist__item.inSet .music-playlist__name {
  color: #ffd0d6;
}

/* ===== 播放列表区（集合：无序、独立；在播放列表 tab 内填充） ===== */

.music-playlist__collection {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.music-playlist__collection-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.music-playlist__collection-clear {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  font-size: 11px;
  cursor: pointer;
}

.music-playlist__collection-clear:hover {
  color: #ff8a8a;
}

.music-playlist__empty--collection {
  padding: 14px;
  font-size: 11px;
}

.music-playlist__collection-items {
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.music-playlist__collection-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  cursor: pointer;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
}

.music-playlist__collection-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.music-playlist__collection-item.current {
  background: rgba(233, 69, 96, 0.14);
}

.music-playlist__collection-name {
  flex: 1;
  font-size: 11px;
  color: #ddd;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.music-playlist__collection-item.current .music-playlist__collection-name {
  color: #fff;
  font-weight: 600;
}

.music-playlist__collection-remove {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.35);
  font-size: 11px;
  cursor: pointer;
  flex-shrink: 0;
}

.music-playlist__collection-remove:hover {
  color: #ff8a8a;
}

.music-playlist__collection-actions {
  display: flex;
  gap: 6px;
  padding: 8px 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

/* 底部动作条 */
.music-playlist__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

.music-playlist__action {
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 6px;
  background: rgba(233, 69, 96, 0.2);
  color: #ffd0d6;
  border: 1px solid rgba(233, 69, 96, 0.4);
  cursor: pointer;
  transition: background 0.15s ease;
}

.music-playlist__action:hover:not(:disabled) {
  background: rgba(233, 69, 96, 0.35);
}

.music-playlist__action:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.music-playlist__action--batch {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.85);
  border-color: rgba(255, 255, 255, 0.2);
}

/*
 * 主操作（每个 tab 里"最该点的那个"）：
 *   · 浏览 tab → 「全部加入播放列表」
 *   · 播放列表 tab → 「播放集合」
 * 原来是和其它动作一样的浅红描边（看着像次要/半禁用）。改实心，
 * 让"下一步该点哪"一眼可见。
 */
.music-playlist__action--primary {
  background: #c8405a;
  border-color: #c8405a;
  color: #fff;
  font-weight: 600;
}

.music-playlist__action--primary:hover:not(:disabled) {
  background: #d94a63;
  border-color: #d94a63;
}

/* 批量菜单 */
.music-playlist__batchmenu {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(0, 0, 0, 0.2);
}

.music-playlist__batchmenu button {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.85);
  border: 1px solid transparent;
  cursor: pointer;
}

.music-playlist__batchmenu button:hover {
  background: rgba(255, 255, 255, 0.15);
}

.music-playlist__batchmenu button.active {
  border-color: #e94560;
  background: rgba(233, 69, 96, 0.25);
  color: #fff;
}

.music-playlist__batchmenu button.danger {
  color: #ff8a8a;
}

/* 选中计数 + 清除筛选（与"全部加入播放列表"同行） */
.music-playlist__selection-count {
  font-size: 11px;
  color: #ff8a9c;
  align-self: center;
  font-variant-numeric: tabular-nums;
}

.music-playlist__clearfilter {
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.75);
  border: 1px solid rgba(255, 255, 255, 0.2);
  cursor: pointer;
  transition: all 0.15s ease;
}

.music-playlist__clearfilter:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.14);
}

/* 播放列表集合区：拖入高亮 */
.music-playlist__collection-items--dragover {
  outline: 2px dashed rgba(233, 69, 96, 0.7);
  outline-offset: -2px;
  background: rgba(233, 69, 96, 0.08);
}

.music-playlist__collection-items--empty {
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 右键菜单（Teleport 到 body，fixed 锚定鼠标位置，原生上下拉菜单手感） */
.music-playlist__ctxmenu {
  position: fixed;
  z-index: var(--z-modal-top);
  min-width: 180px;
  background: rgba(38, 38, 48, 0.99);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 8px;
  padding: 4px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
  font-size: 12px;
}

.music-playlist__ctxmenu button {
  text-align: left;
  padding: 6px 10px;
  border-radius: 6px;
  border: none;
  background: none;
  color: rgba(255, 255, 255, 0.88);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 6px;
}

.music-playlist__ctxmenu button:hover {
  background: rgba(233, 69, 96, 0.28);
  color: #fff;
}

.music-playlist__ctxmenu button.danger {
  color: #ff9b9b;
}

.music-playlist__ctxmenu button.danger:hover {
  background: rgba(233, 69, 96, 0.35);
  color: #fff;
}

.music-playlist__ctxmenu button.apply {
  color: #ffd54f;
}

.music-playlist__ctxmenu button.active {
  background: rgba(233, 69, 96, 0.25);
  color: #fff;
}

.music-playlist__ctxmenu-hint {
  padding: 5px 10px 7px;
  font-size: 11px;
  color: #ff8a9c;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  margin-bottom: 3px;
  white-space: nowrap;
}

.music-playlist__ctxmenu-sub {
  display: flex;
  flex-direction: column;
  max-height: 160px;
  overflow-y: auto;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  margin-top: 2px;
  padding-top: 2px;
}

/* ============ Toast 提示 ============ */
/*
 * 位置：浮在 sheet 底部动作条**上方**（原来是 bottom:100% = 面板之上，
 * 在全窗 sheet 下那已经跑到窗口外面去了，必须改）。
 * 用几何而非"面板之上"来定位，任何 tab 下都落在可视区内。
 */
.music-toast {
  position: absolute;
  bottom: 66px;
  left: 50%;
  transform: translateX(-50%);
  /* 不透明：与 sheet 一致，避免半透明造成的鬼影/对比度问题 */
  background: #32323f;
  color: #fff;
  font-size: 12px;
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
  white-space: nowrap;
  z-index: var(--z-popup);
  pointer-events: none;
}
</style>
