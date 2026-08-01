<script setup lang="ts">
/**
 * 自习室面板组件
 *
 * 简化版，参考 electron/src/scripts/modules/studyRoom.js（1704 行）。
 *
 * 功能：
 * - 创建自习室（名称、描述）
 * - 加入自习室（通过 ID 或从公开列表）
 * - 退出当前自习室
 * - 在线成员列表
 * - 今日排名
 *
 * 通过 v-model:visible 控制显示。
 */
import { ref, watch, onUnmounted } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import Modal from "./Modal.vue";
import {
  studyRoomGetActive,
  studyRoomCreate,
  studyRoomJoin,
  studyRoomLeave,
  studyRoomGetRanking,
  studyRoomGetMembers,
  studyRoomGetDetail,
  studyRoomDelete,
  studyRoomUpdate,
  studyRoomUpdateStatus,
  type StudyRoom,
  type StudyRoomMember,
  type StudyRoomRankingEntry,
} from "@/api/studyRoom";
import { useAuthStore } from "@/stores/auth";
import { useMusicStore } from "@/stores/music";
import { musicSyncRequestState } from "@/api/musicSync";

interface Props {
  /** 是否显示 */
  visible: boolean;
  /** 是否允许点击背景关闭 */
  closeOnBackground?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  closeOnBackground: true,
});

const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
  (e: "joined", room: StudyRoom): void;
  (e: "left"): void;
}>();

const authStore = useAuthStore();
const music = useMusicStore();

// ===== 视图状态 =====
type View = "main" | "create" | "join" | "room";

const view = ref<View>("main");
const loading = ref(false);
const toast = ref<string>("");
let toastTimer: ReturnType<typeof setTimeout> | null = null;

// ===== 当前自习室 =====
const currentRoom = ref<StudyRoom | null>(null);
const members = ref<StudyRoomMember[]>([]);
const ranking = ref<StudyRoomRankingEntry[]>([]);
/** 是否房主（决定是否显示删除按钮） */
const isOwner = ref(false);
/** 是否已拉取房间详情（避免重复请求） */
let detailLoaded = false;
/** 加入流程中暂存的成员列表（join 时服务器已推送 room:members，进房间前先缓存） */
let pendingMembers: StudyRoomMember[] | null = null;

// 心跳/刷新定时器
let refreshTimer: ReturnType<typeof setInterval> | null = null;
// 纯心跳定时器：5s 一次 studyRoomUpdateStatus（WS 消息极小，几乎不耗流量）。
// 心跳与数据刷新分离：高频保活（防代理/NAT 掐断 + 维持在线），低频刷新数据。
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
// 15s 一次：成员/排名/房间详情刷新（REST）。
// 旧 30s 在抢 DJ/换房等操作时易被代理掐断导致"莫名掉线"，故提高频率。
const REFRESH_INTERVAL_MS = 15_000;
// 心跳间隔：WS 心跳消息仅几十字节，5s 一跳流量可忽略；配合 Rust 协议层 10s Ping 双保活
const HEARTBEAT_INTERVAL_MS = 5_000;

// ===== 创建表单 =====
const createForm = ref({
  name: "",
  description: "",
  /** 隐私：public 公开 / private 私密（仅 ID 或 ID+密码加入） */
  privacy: "public",
  /** 私密房间可选密码（设置密码后只能通过 ID+密码加入） */
  password: "",
});

// ===== 加入表单 =====
const joinIdInput = ref("");
/** 加入时输入的密码（私密房间需要） */
const joinPwInput = ref("");
/** 是否显示密码输入框（查询到房间需要密码时自动展开） */
const joinPwMode = ref(false);
const publicRooms = ref<StudyRoom[]>([]);

onUnmounted(() => {
  stopRefresh();
  if (toastTimer) clearTimeout(toastTimer);
  if (unlistenWs) unlistenWs();
  if (unlistenWsDisconnected) unlistenWsDisconnected();
  if (reconnectTimer) clearTimeout(reconnectTimer);
});

// ===== WebSocket 实时事件 =====
// 服务端推送通过 "ws-event" 事件进入（见 modules/ws.rs），
// 成员列表主要依赖实时推送更新；进入房间后由 studyRoomGetMembers
// 触发一次 presence:update，服务端随即推送 room:members。
let unlistenWs: UnlistenFn | null = null;
void listen<unknown>("ws-event", (e) => handleWsEvent(e.payload))
  .then((fn) => {
    unlistenWs = fn;
  })
  .catch(() => {
    /* jsdom 测试环境无 Tauri，静默 */
  });

// WS 断开（Rust ws.rs 清理连接时 emit）：若正在房间内，提示并自动重连恢复
// （先触发 WS 重连，再重新 join 让服务器恢复成员关系，避免"要退出重进才行"）
let unlistenWsDisconnected: UnlistenFn | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnecting = false;
/** 自动重连失败后的冷却截止时间（冷却期内不再自动重连，避免反复失败刷屏） */
let reconnectCooldownUntil = 0;

/** 自动重连：触发 WS 重连 + 重新 join 房间恢复成员关系（防抖：reconnecting 期间不重复） */
async function autoReconnect(): Promise<void> {
  if (reconnecting) return;
  if (Date.now() < reconnectCooldownUntil) return;
  const roomId = currentRoom.value?.id;
  if (!roomId || view.value !== "room") return;
  reconnecting = true;
  showToast("连接断开，正在自动重连…");
  try {
    // 触发 Rust 端重新建立 WS 连接（ensure_connected 幂等）
    await musicSyncRequestState();
    await studyRoomJoin(roomId);
    await refreshRoomData();
    showToast("已重新连接");
  } catch (err) {
    console.warn("[StudyRoom] 自动重连失败:", err);
    showToast("自动重连失败，请退出后重新进入");
    reconnectCooldownUntil = Date.now() + 60_000;
  } finally {
    reconnecting = false;
  }
}

void listen<unknown>("ws-disconnected", () => {
  if (!currentRoom.value || view.value !== "room") return;
  if (reconnecting) return;
  showToast("网络连接断开，正在自动重连…");
  reconnectTimer = setTimeout(() => {
    void autoReconnect();
  }, 3000);
})
  .then((fn) => {
    unlistenWsDisconnected = fn;
  })
  .catch(() => {
    /* jsdom 测试环境无 Tauri，静默 */
  });

/** 成员专注状态 → 展示文案 */
const STATUS_LABELS: Record<string, string> = {
  idle: "空闲",
  focusing: "专注中",
  short_break: "短休息",
  long_break: "长休息",
};

/** 处理服务端 WS 推送（room:members / member_joined / member_left / member_status / pomo_done） */
function handleWsEvent(payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  const evt = payload as Record<string, unknown>;
  // room:members 在 join 请求发出后即被服务端广播，此时可能尚未进入房间视图
  // （currentRoom 为 null），必须先处理缓存，否则进房间后成员列表会一直为空
  if (evt.type === "room:members") {
    // { members: [{ userId, username, online, status }] }
    if (Array.isArray(evt.members)) {
      const parsed = evt.members.map((m) => {
        const obj = (m ?? {}) as Record<string, unknown>;
        return {
          userId: String(obj.userId ?? obj.user_id ?? ""),
          username: String(obj.username ?? ""),
          online: obj.online !== false,
          status: typeof obj.status === "string" ? obj.status : undefined,
        };
      });
      if (currentRoom.value) {
        members.value = parsed;
      } else {
        // 加入流程中（join 后、进房间前）到达的成员列表先缓存，进房间后应用
        pendingMembers = parsed;
      }
    }
    return;
  }
  if (!currentRoom.value) return;
  switch (evt.type) {
    case "room:member_joined": {
      // { user: { id, username } }
      const u = evt.user as Record<string, unknown> | undefined;
      if (u) {
        const member: StudyRoomMember = {
          userId: String(u.id ?? u.userId ?? ""),
          username: String(u.username ?? ""),
          online: true,
          status: "idle",
        };
        if (member.userId && !members.value.some((m) => m.userId === member.userId)) {
          members.value.push(member);
        }
      }
      break;
    }
    case "room:member_left": {
      // { user_id }
      const uid = evt.user_id;
      if (typeof uid === "string") {
        members.value = members.value.filter((m) => m.userId !== uid);
      }
      break;
    }
    case "room:member_status": {
      // { user_id, status }：更新成员专注状态，同时确认其仍在线
      const uid = evt.user_id;
      const status = evt.status;
      if (typeof uid === "string") {
        const m = members.value.find((x) => x.userId === uid);
        if (m) {
          m.online = true;
          if (typeof status === "string") m.status = status;
        }
      }
      break;
    }
    case "room:pomo_done": {
      // 有成员完成番茄 → 刷新今日排名
      void refreshRoomData();
      break;
    }
    default:
      break;
  }
}

// 关闭弹窗时停止心跳刷新，避免后台定时器持续请求
watch(
  () => props.visible,
  (v) => {
    if (!v) {
      stopRefresh();
      return;
    }
    // 打开面板时主动检查"自己是否还在房间"（所见即所得：若已掉线立即自动重连）
    if (currentRoom.value && view.value === "room") {
      window.setTimeout(() => void checkRoomPresence(), 500);
    }
  },
);

/**
 * 检查自己是否仍在房间成员列表（服务器视角）。
 * 若服务器返回的成员列表不含自己 → 已掉线 → 自动重连（重新 join 恢复成员关系）。
 * 列表为空时跳过（可能服务器未同步/刚加入，避免误判）。
 */
async function checkRoomPresence(): Promise<void> {
  if (!currentRoom.value || view.value !== "room") return;
  const me = authStore.session?.id;
  if (!me) return;
  try {
    const m = await studyRoomGetMembers(currentRoom.value.id);
    if (m.length > 0 && !m.some((x) => x.userId === me)) {
      console.warn("[StudyRoom] 检测到自己不在房间成员列表，自动重连…");
      void autoReconnect();
    }
  } catch (err) {
    console.warn("[StudyRoom] 成员资格检查失败:", err);
  }
}

function showToast(message: string): void {
  toast.value = message;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.value = "";
  }, 2500);
}

function onClose(): void {
  emit("update:visible", false);
}

/** 进入某个自习室后初始化房间视图 */
async function enterRoom(room: StudyRoom): Promise<void> {
  currentRoom.value = room;
  view.value = "room";
  // 应用加入流程中缓存的成员列表（join 时服务器已推送过 room:members）
  if (pendingMembers) {
    members.value = pendingMembers;
    pendingMembers = null;
  } else {
    // 无缓存（创建房间 / join 响应先于 room:members 广播到达）：
    // 乐观加入自己，避免房间视图显示"空无一人"，服务器 room:members 推送后自动覆盖校准
    const me = authStore.session;
    if (me?.id && !members.value.some((m) => m.userId === me.id)) {
      members.value = [
        {
          userId: me.id,
          username: me.username || "我",
          online: true,
          status: "idle",
        },
      ];
    }
  }
  detailLoaded = false;
  isOwner.value = false;
  await refreshRoomData();
  startRefresh();
  emit("joined", room);
}

/** 刷新成员 & 排名 & 房间详情（房主判断） */
async function refreshRoomData(): Promise<void> {
  if (!currentRoom.value) return;
  const roomId = currentRoom.value.id;
  // 业务心跳（WS ping）：保持在线状态 + 防止连接被中间设备掐断
  void studyRoomUpdateStatus(roomId).catch(() => {});
  try {
    const [m, r] = await Promise.all([
      studyRoomGetMembers(roomId),
      studyRoomGetRanking(roomId),
    ]);
    // 成员列表以 WS room:members 实时推送为主；
    // REST 返回值非空才覆盖，避免推送先到后被空数组清空
    if (m.length > 0) members.value = m;
    ranking.value = r;
    // 定时心跳：检测到自己已不在服务器成员列表 → 掉线 → 自动重连恢复成员关系
    // （所见即所得：显示"在房间"但实际已掉线时自动拉回）
    const me = authStore.session?.id;
    if (m.length > 0 && me && !m.some((x) => x.userId === me)) {
      console.warn("[StudyRoom] 心跳发现不在成员列表，自动重连…");
      void autoReconnect();
    }
  } catch (err) {
    // 后端未实现时会失败，静默处理
    console.warn("[StudyRoom] refreshRoomData failed:", err);
  }

  // 拉取房间详情（名称/描述/房主/隐私），仅首次进入时
  if (!detailLoaded) {
    detailLoaded = true;
    try {
      const detail = await studyRoomGetDetail(roomId);
      currentRoom.value = {
        ...currentRoom.value,
        name: detail.name || currentRoom.value.name,
        description: detail.description ?? currentRoom.value.description,
        ownerId: detail.ownerId,
        isPublic: detail.isPublic ?? currentRoom.value.isPublic,
        hasPassword: detail.hasPassword ?? currentRoom.value.hasPassword,
      };
      isOwner.value = !!detail.ownerId && detail.ownerId === authStore.session?.id;
    } catch (err) {
      console.warn("[StudyRoom] get detail failed:", err);
    }
  }
}

function startRefresh(): void {
  stopRefresh();
  // 高频纯心跳：维持 WS 在线（消息极小，不耗流量）
  heartbeatTimer = setInterval(() => {
    const roomId = currentRoom.value?.id;
    if (roomId) void studyRoomUpdateStatus(roomId).catch(() => {});
  }, HEARTBEAT_INTERVAL_MS);
  // 低频数据刷新：成员/排名 + 顺带心跳 + 掉线检测
  refreshTimer = setInterval(() => {
    void refreshRoomData();
  }, REFRESH_INTERVAL_MS);
}

function stopRefresh(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

/** 切换到创建视图 */
function goCreate(): void {
  createForm.value = { name: "", description: "", privacy: "public", password: "" };
  view.value = "create";
}

/** 切换到加入视图 */
async function goJoin(): Promise<void> {
  view.value = "join";
  await loadPublicRooms();
}

/** 加载公开自习室列表 */
async function loadPublicRooms(): Promise<void> {
  loading.value = true;
  try {
    publicRooms.value = await studyRoomGetActive(true);
  } catch (err) {
    console.warn("[StudyRoom] loadPublicRooms failed:", err);
    publicRooms.value = [];
    showToast("获取自习室列表失败");
  } finally {
    loading.value = false;
  }
}

/** 提交创建 */
async function handleCreate(): Promise<void> {
  const name = createForm.value.name.trim();
  if (!name) {
    showToast("请输入自习室名称");
    return;
  }
  loading.value = true;
  try {
    const isPrivate = createForm.value.privacy === "private";
    const password = isPrivate ? createForm.value.password.trim() : "";
    const room = await studyRoomCreate(
      name,
      createForm.value.description.trim(),
      password,
    );
    showToast(isPrivate ? "创建成功（私密）" : "创建成功（公开）");
    await enterRoom(room);
  } catch (err) {
    console.warn("[StudyRoom] create failed:", err);
    showToast("创建失败：" + (err instanceof Error ? err.message : String(err)));
  } finally {
    loading.value = false;
  }
}

/** 通过 ID 加入 */
async function handleJoinById(): Promise<void> {
  const id = joinIdInput.value.trim();
  if (!id) {
    showToast("请输入自习室 ID");
    return;
  }
  loading.value = true;
  try {
    // 先查详情判断房间是否需要密码，并拿到名称/隐私信息
    let detail: StudyRoom | null = null;
    try {
      detail = await studyRoomGetDetail(id);
    } catch {
      /* 详情查询失败不阻塞加入流程 */
    }
    if (detail?.hasPassword === true && !joinPwMode.value) {
      joinPwMode.value = true;
      loading.value = false;
      showToast("该房间需要密码，请输入后加入");
      return;
    }
    await studyRoomJoin(id, joinPwInput.value.trim());
    // 后端目前不返回 room 信息，前端构造最小信息
    const room: StudyRoom = {
      id,
      name: detail?.name || `自习室 ${id.slice(0, 8)}`,
      description: detail?.description,
      isPublic: detail?.isPublic,
      hasPassword: detail?.hasPassword,
    };
    showToast("加入成功");
    joinPwMode.value = false;
    joinPwInput.value = "";
    await enterRoom(room);
  } catch (err) {
    console.warn("[StudyRoom] join by id failed:", err);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("密码")) {
      joinPwMode.value = true;
    }
    showToast("加入失败：" + msg);
  } finally {
    loading.value = false;
  }
}

/** 从公开列表加入 */
async function handleJoinFromList(room: StudyRoom): Promise<void> {
  loading.value = true;
  try {
    await studyRoomJoin(room.id);
    showToast("加入成功");
    await enterRoom(room);
  } catch (err) {
    console.warn("[StudyRoom] join from list failed:", err);
    showToast("加入失败：" + (err instanceof Error ? err.message : String(err)));
  } finally {
    loading.value = false;
  }
}

/** 退出当前自习室 */
async function handleLeave(): Promise<void> {
  if (!currentRoom.value) return;
  const roomId = currentRoom.value.id;
  loading.value = true;
  try {
    await studyRoomLeave(roomId);
    showToast("已退出自习室");
    stopRefresh();
    currentRoom.value = null;
    members.value = [];
    ranking.value = [];
    isOwner.value = false;
    pendingMembers = null;
    view.value = "main";
    music.setSyncEnabled(false);
    emit("left");
  } catch (err) {
    console.warn("[StudyRoom] leave failed:", err);
    showToast("退出失败：" + (err instanceof Error ? err.message : String(err)));
  } finally {
    loading.value = false;
  }
}

/** 删除自习室（仅房主） */
async function handleDelete(): Promise<void> {
  if (!currentRoom.value || !isOwner.value) return;
  const roomId = currentRoom.value.id;
  loading.value = true;
  try {
    await studyRoomDelete(roomId);
    showToast("自习室已删除");
    stopRefresh();
    currentRoom.value = null;
    members.value = [];
    ranking.value = [];
    isOwner.value = false;
    pendingMembers = null;
    view.value = "main";
    music.setSyncEnabled(false);
    emit("left");
  } catch (err) {
    console.warn("[StudyRoom] delete failed:", err);
    showToast("删除失败：" + (err instanceof Error ? err.message : String(err)));
  } finally {
    loading.value = false;
  }
}

// ===== 房主管理：公开/私密切换 + 密码设置 =====

/** 公开/私密切换（仅房主，调用服务器 PUT /api/v1/rooms/:id） */
async function handleTogglePublic(): Promise<void> {
  if (!currentRoom.value || !isOwner.value) return;
  const target = !(currentRoom.value.isPublic ?? true);
  loading.value = true;
  try {
    await studyRoomUpdate(currentRoom.value.id, { isPublic: target });
    currentRoom.value.isPublic = target;
    currentRoom.value.hasPassword = target ? false : currentRoom.value.hasPassword;
    showToast(target ? "已设为公开房间，所有人可加入" : "已设为私密房间，只能通过 ID 加入");
  } catch (err) {
    console.warn("[StudyRoom] toggle public failed:", err);
    showToast("切换失败：" + (err instanceof Error ? err.message : String(err)));
  } finally {
    loading.value = false;
  }
}

/** 设置/清除房间密码（仅房主；设密码后自动转为私密） */
async function handleSetPassword(): Promise<void> {
  if (!currentRoom.value || !isOwner.value) return;
  const pw = setPwInput.value.trim();
  loading.value = true;
  try {
    await studyRoomUpdate(currentRoom.value.id, { password: pw });
    currentRoom.value.hasPassword = !!pw;
    if (pw) currentRoom.value.isPublic = false;
    showToast(pw ? "已设置加入密码（房间转为私密）" : "已清除加入密码");
    setPwMode.value = false;
    setPwInput.value = "";
  } catch (err) {
    console.warn("[StudyRoom] set password failed:", err);
    showToast("设置失败：" + (err instanceof Error ? err.message : String(err)));
  } finally {
    loading.value = false;
  }
}

/** 是否显示密码设置输入（房主管理） */
const setPwMode = ref(false);
/** 密码设置输入值 */
const setPwInput = ref("");

// ===== 同步听歌（房间内） =====

/** 切换同步听歌开关 */
function toggleSync(): void {
  music.setSyncEnabled(!music.syncEnabled);
  if (music.syncEnabled) {
    showToast("同步听歌已开启");
  }
}

/** 返回主视图 */
function backToMain(): void {
  view.value = "main";
}

/** 格式化时长（分钟） */
function formatMinutes(min?: number): string {
  if (!min || min <= 0) return "0 分钟";
  if (min < 60) return `${min} 分钟`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
}

/** 显示 ID 的简短形式 */
function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) + "…" : id;
}
</script>

<template>
  <Modal
    :visible="visible"
    title="👥 自习室"
    :close-on-background="closeOnBackground"
    width="520px"
    @close="onClose"
    @update:visible="(v) => emit('update:visible', v)"
  >
    <!-- Toast -->
    <p v-if="toast" class="study-toast">{{ toast }}</p>

    <!-- 主视图 -->
    <div v-if="view === 'main'" class="study-main">
      <!-- 顶部介绍区 -->
      <div class="study-hero">
        <div class="study-hero-icon">📚</div>
        <div class="study-hero-title">一起自习，效率翻倍</div>
        <div class="study-hero-desc">
          创建自己的自习室邀请好友，或加入别人的房间共同专注。房间里能实时看到大家的专注状态与今日排名，还能同步听歌一起学习。
        </div>
        <div class="study-hero-features">
          <span>👥 在线成员</span>
          <span>📊 今日排名</span>
          <span>🎵 同步听歌</span>
        </div>
      </div>

      <!-- 当前房间卡片 -->
      <div v-if="currentRoom" class="current-room-card">
        <div class="current-room-icon">🏠</div>
        <div class="current-room-info">
          <div class="current-room-name">{{ currentRoom.name }}</div>
          <div class="current-room-id">ID: {{ shortId(currentRoom.id) }}</div>
        </div>
        <button class="btn btn-primary btn-sm" @click="enterRoom(currentRoom)">
          进入
        </button>
      </div>

      <!-- 功能入口卡片 -->
      <div class="main-actions">
        <button class="action-card" @click="goCreate">
          <span class="action-card__icon">✨</span>
          <span class="action-card__title">创建自习室</span>
          <span class="action-card__desc">开一间房，邀请大家一起专注</span>
        </button>
        <button class="action-card" @click="goJoin">
          <span class="action-card__icon">🚪</span>
          <span class="action-card__title">加入自习室</span>
          <span class="action-card__desc">输入 ID 或从公开列表加入</span>
        </button>
      </div>

      <p v-if="!authStore.isLoggedIn" class="login-hint">
        ⚠️ 需要先登录账号才能使用自习室
      </p>
    </div>

    <!-- 创建视图 -->
    <div v-else-if="view === 'create'" class="study-create">
      <div class="form-group">
        <label class="form-label">自习室名称 <span class="required">*</span></label>
        <input
          v-model="createForm.name"
          class="form-input"
          type="text"
          maxlength="50"
          placeholder="例如：深夜学习室"
        />
      </div>
      <div class="form-group">
        <label class="form-label">自习室描述</label>
        <textarea
          v-model="createForm.description"
          class="form-textarea"
          maxlength="200"
          placeholder="例如：一起加油！（可选）"
        ></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">隐私设置</label>
        <div class="privacy-options">
          <button
            type="button"
            class="privacy-option"
            :class="{ active: createForm.privacy === 'public' }"
            @click="createForm.privacy = 'public'"
          >
            <span class="privacy-option-icon">🌐</span>
            <span class="privacy-option-text">
              <span class="privacy-option-title">公开</span>
              <span class="privacy-option-desc">所有人可以浏览并加入</span>
            </span>
          </button>
          <button
            type="button"
            class="privacy-option"
            :class="{ active: createForm.privacy === 'private' }"
            @click="createForm.privacy = 'private'"
          >
            <span class="privacy-option-icon">🔒</span>
            <span class="privacy-option-text">
              <span class="privacy-option-title">私密</span>
              <span class="privacy-option-desc">只能通过 ID 加入</span>
            </span>
          </button>
        </div>
      </div>
      <div v-if="createForm.privacy === 'private'" class="form-group">
        <label class="form-label">加入密码（可选，设置后需输入密码才能进入）</label>
        <input
          v-model="createForm.password"
          class="form-input"
          type="password"
          maxlength="20"
          placeholder="留空则仅凭 ID 加入"
        />
      </div>
      <div class="form-actions">
        <button class="btn btn-secondary" @click="backToMain">取消</button>
        <button
          class="btn btn-primary"
          :disabled="loading || !createForm.name.trim()"
          @click="handleCreate"
        >
          {{ loading ? "创建中..." : "创建" }}
        </button>
      </div>
    </div>

    <!-- 加入视图 -->
    <div v-else-if="view === 'join'" class="study-join">
      <div class="form-group">
        <label class="form-label">通过 ID 加入</label>
        <div class="input-with-btn">
          <input
            v-model="joinIdInput"
            class="form-input"
            type="text"
            placeholder="粘贴自习室 ID"
          />
          <button
            class="btn btn-primary"
            :disabled="loading || !joinIdInput.trim()"
            @click="handleJoinById"
          >
            加入
          </button>
        </div>
        <div v-if="joinPwMode" class="form-group join-pw-group">
          <label class="form-label">该房间需要密码</label>
          <div class="input-with-btn">
            <input
              v-model="joinPwInput"
              class="form-input"
              type="password"
              maxlength="20"
              placeholder="输入加入密码"
            />
          </div>
        </div>
      </div>

      <div class="divider"></div>

      <div class="form-group">
        <label class="form-label">公开自习室</label>
        <button
          class="btn btn-secondary btn-sm"
          :disabled="loading"
          @click="loadPublicRooms"
        >
          刷新
        </button>
      </div>
      <div v-if="loading" class="empty-hint">加载中...</div>
      <div v-else-if="publicRooms.length === 0" class="empty-hint">
        暂无公开的自习室
      </div>
      <div v-else class="room-list">
        <div
          v-for="room in publicRooms"
          :key="room.id"
          class="room-list-item"
        >
          <div class="room-list-info">
            <div class="room-list-top">
              <span class="room-list-name">{{ room.name }}</span>
              <span class="room-tag" :class="room.isPublic ? 'tag-public' : 'tag-private'">
                {{ room.isPublic ? "公开" : "私密" }}
              </span>
            </div>
            <div class="room-list-meta">
              <span class="room-meta-item">🆔 {{ shortId(room.id) }}</span>
              <span v-if="room.memberCount !== undefined" class="room-meta-item">
                👥 {{ room.memberCount }} 人
              </span>
              <span v-if="room.creatorName" class="room-meta-item">
                👤 {{ room.creatorName }}
              </span>
            </div>
            <div v-if="room.description" class="room-list-desc">
              {{ room.description }}
            </div>
          </div>
          <button class="btn btn-primary btn-sm" @click="handleJoinFromList(room)">
            加入
          </button>
        </div>
      </div>

      <div class="form-actions">
        <button class="btn btn-secondary" @click="backToMain">返回</button>
      </div>
    </div>

    <!-- 房间视图 -->
    <div v-else-if="view === 'room'" class="study-room">
      <div v-if="currentRoom" class="room-header">
        <div>
          <div class="room-header-top">
            <span class="room-header-name">{{ currentRoom.name }}</span>
            <span
              class="room-tag"
              :class="currentRoom.isPublic !== false ? 'tag-public' : 'tag-private'"
            >
              {{ currentRoom.isPublic !== false ? "🌐 公开" : "🔒 私密" }}
            </span>
            <span v-if="currentRoom.hasPassword" class="room-tag tag-private">🔑 有密码</span>
          </div>
          <div class="room-header-id">ID: {{ currentRoom.id }}</div>
        </div>
        <div class="room-header-actions">
          <button
            v-if="isOwner"
            class="btn btn-danger-outline btn-sm"
            :disabled="loading"
            title="删除自习室（仅房主）"
            @click="handleDelete"
          >
            🗑 删除
          </button>
          <button
            class="btn btn-danger"
            :disabled="loading"
            @click="handleLeave"
          >
            退出
          </button>
        </div>
      </div>

      <div v-if="currentRoom?.description" class="room-desc">
        {{ currentRoom.description }}
      </div>

      <!-- 房主管理 -->
      <div v-if="isOwner" class="owner-panel">
        <div class="owner-panel-title">🏠 房主管理</div>
        <div class="owner-panel-row">
          <span class="owner-panel-label">
            {{ currentRoom?.isPublic !== false ? "当前为公开房间" : "当前为私密房间" }}
          </span>
          <button
            class="btn btn-secondary btn-sm"
            :disabled="loading"
            @click="handleTogglePublic"
          >
            {{ currentRoom?.isPublic !== false ? "设为私密" : "设为公开" }}
          </button>
        </div>
        <div class="owner-panel-row">
          <span class="owner-panel-label">
            {{ currentRoom?.hasPassword ? "已设置加入密码" : "未设置加入密码" }}
          </span>
          <button
            class="btn btn-secondary btn-sm"
            :disabled="loading"
            @click="setPwMode = !setPwMode"
          >
            {{ currentRoom?.hasPassword ? "修改/清除密码" : "设置密码" }}
          </button>
        </div>
        <div v-if="setPwMode" class="owner-panel-pw">
          <div class="input-with-btn">
            <input
              v-model="setPwInput"
              class="form-input"
              type="password"
              maxlength="20"
              placeholder="输入新密码（留空清除密码）"
            />
            <button class="btn btn-primary btn-sm" :disabled="loading" @click="handleSetPassword">
              保存
            </button>
          </div>
          <p class="owner-panel-hint">设置密码后房间自动转为私密，成员需输入密码才能加入</p>
        </div>
      </div>

      <div class="room-section">
        <h4 class="section-title">📊 今日排名</h4>
        <div v-if="ranking.length === 0" class="empty-hint">暂无排名数据</div>
        <ol v-else class="ranking-list">
          <li v-for="entry in ranking" :key="entry.username" class="ranking-item">
            <span class="ranking-rank">#{{ entry.rank }}</span>
            <span class="ranking-name">{{ entry.username }}</span>
            <span class="ranking-time">{{ formatMinutes(entry.todayMinutes) }}</span>
          </li>
        </ol>
      </div>

      <div class="room-section">
        <h4 class="section-title">👥 在线成员 ({{ members.length }})</h4>
        <div v-if="members.length === 0" class="empty-hint">暂无在线成员</div>
        <ul v-else class="member-list">
          <li
            v-for="m in members"
            :key="m.userId"
            class="member-item"
          >
            <span class="member-dot" :class="{ online: m.online !== false }"></span>
            <span class="member-name">{{ m.username }}</span>
            <span
              v-if="m.status"
              class="member-status"
              :class="'status-' + m.status"
            >
              {{ STATUS_LABELS[m.status] || m.status }}
            </span>
            <span class="member-time">{{ formatMinutes(m.todayMinutes) }}</span>
          </li>
        </ul>
      </div>

      <!-- 同步听歌 -->
      <div class="room-section">
        <h4 class="section-title">🎵 同步听歌</h4>
        <div class="sync-card">
          <div class="sync-row">
            <span class="sync-label">
              {{ music.syncEnabled ? "已开启" : "未开启" }}
            </span>
            <button class="btn btn-secondary btn-sm" @click="toggleSync">
              {{ music.syncEnabled ? "关闭同步" : "开启同步" }}
            </button>
          </div>
          <template v-if="music.syncEnabled">
            <div class="sync-dj">
              <span class="sync-dj-label">DJ</span>
              <span class="sync-dj-name">
                {{ music.isDj ? "我" : music.djName || "暂无（点下方按钮申请）" }}
              </span>
            </div>
            <button
              v-if="!music.isDj"
              class="btn btn-primary btn-sm sync-dj-btn"
              @click="music.requestDj()"
            >
              🎤 申请当 DJ
            </button>
            <template v-else>
              <p class="sync-hint">
                你是 DJ：在音乐播放器中操作（播放/暂停/切歌/跳转/音量）将同步给房间所有成员
              </p>
              <!-- DJ 专属：P2P 传歌方案切换 -->
              <div class="sync-mode">
                <span class="sync-mode-label">缺歌传歌</span>
                <div class="sync-mode-options">
                  <button
                    class="btn btn-sm sync-mode-btn"
                    :class="{ active: music.transferMode === 'immediate' }"
                    title="听众下载完成后立即播放并跳到当前进度，开头可能缺几秒"
                    @click="music.setTransferMode('immediate')"
                  >
                    边下边播
                  </button>
                  <button
                    class="btn btn-sm sync-mode-btn"
                    :class="{ active: music.transferMode === 'wait_all' }"
                    title="等所有听众都下载完再统一从头播放（最大等待时间由服务器控制）"
                    @click="music.setTransferMode('wait_all')"
                  >
                    全员就绪统一播
                  </button>
                </div>
                <span class="sync-mode-desc">
                  {{ music.transferMode === "immediate" ? "听众下完即播，开头可能缺几秒" : "全员下完统一从头播放" }}
                </span>
              </div>
              <p v-if="music.waitingForSongs" class="sync-hint sync-waiting">
                ⏳ 等待其他用户下载歌曲…
              </p>
            </template>
            <p v-if="!music.isDj" class="sync-hint">
              开启后由 DJ 控制播放，大家同步收听同一首歌；只有 DJ 能操作播放器
            </p>
          </template>
        </div>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.study-toast {
  margin: 0 0 12px;
  padding: 8px 12px;
  background: rgba(78, 204, 163, 0.1);
  color: #4ecca3;
  border-radius: 6px;
  font-size: 13px;
  text-align: center;
}

.study-main {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ============ 顶部介绍区 ============ */
.study-hero {
  padding: 20px 18px;
  border-radius: 14px;
  text-align: center;
  background: linear-gradient(135deg, rgba(233, 69, 96, 0.22), rgba(78, 204, 163, 0.14));
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.study-hero-icon {
  font-size: 30px;
  margin-bottom: 8px;
}

.study-hero-title {
  font-size: 17px;
  font-weight: 700;
  color: #fff;
  margin-bottom: 8px;
}

.study-hero-desc {
  font-size: 12px;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.65);
  margin-bottom: 12px;
}

.study-hero-features {
  display: flex;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
}

.study-hero-features span {
  font-size: 11px;
  padding: 3px 12px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.8);
  white-space: nowrap;
}

.current-room-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(233, 69, 96, 0.18), rgba(78, 204, 163, 0.12));
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.current-room-icon {
  font-size: 26px;
  flex-shrink: 0;
}

.current-room-name {
  font-size: 15px;
  font-weight: 600;
  color: #fff;
}

.current-room-id {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  margin-top: 4px;
}

.main-actions {
  display: flex;
  gap: 12px;
}

.main-actions .action-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 18px 16px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  cursor: pointer;
  text-align: left;
  transition: all 0.2s ease;
  font-family: inherit;
}

.main-actions .action-card:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: var(--accent, #e94560);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
}

.action-card__icon {
  font-size: 24px;
}

.action-card__title {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
}

.action-card__desc {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  line-height: 1.4;
}

.login-hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: rgba(255, 200, 100, 0.9);
  text-align: center;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

/* ============ 隐私选择 ============ */
.privacy-options {
  display: flex;
  gap: 10px;
}

.privacy-option {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.05);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: all 0.2s ease;
}

.privacy-option.active {
  border-color: var(--accent, #e94560);
  background: rgba(233, 69, 96, 0.12);
  box-shadow: 0 0 0 1px var(--accent, #e94560);
}

.privacy-option-icon {
  font-size: 20px;
  flex-shrink: 0;
}

.privacy-option-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.privacy-option-title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
}

.privacy-option-desc {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
}

.join-pw-group {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 200, 100, 0.08);
  border: 1px solid rgba(255, 200, 100, 0.2);
}

/* ============ 房主管理 ============ */
.owner-panel {
  margin-bottom: 16px;
  padding: 12px;
  border: 1px solid rgba(233, 69, 96, 0.25);
  border-radius: 10px;
  background: rgba(233, 69, 96, 0.06);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.owner-panel-title {
  font-size: 13px;
  font-weight: 600;
  color: #ff7a8f;
}

.owner-panel-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.owner-panel-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
}

.owner-panel-pw {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.owner-panel-hint {
  margin: 0;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.45);
}

.form-label {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
}

.required {
  color: #e94560;
}

.form-input {
  width: 100%;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  font-size: 14px;
  box-sizing: border-box;
  outline: none;
  transition: border-color 0.2s ease;
  min-height: 44px;
}

.form-input:focus {
  border-color: var(--accent, #e94560);
}

.form-textarea {
  width: 100%;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  font-size: 14px;
  min-height: 100px;
  resize: vertical;
  box-sizing: border-box;
  outline: none;
  font-family: inherit;
}

.form-textarea:focus {
  border-color: var(--accent, #e94560);
}

.input-with-btn {
  display: flex;
  gap: 8px;
}

.input-with-btn .form-input {
  flex: 1;
}

.divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.08);
  margin: 12px 0;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}

.btn {
  padding: 9px 16px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: opacity 0.2s ease;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-sm {
  padding: 6px 12px;
  font-size: 12px;
}

.btn-primary {
  background: var(--accent, #e94560);
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.9);
}

.btn-danger {
  background: rgba(233, 69, 96, 0.15);
  color: #e94560;
  border: 1px solid rgba(233, 69, 96, 0.3);
}

.btn-danger-outline {
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.25);
}

.btn-danger-outline:hover {
  background: rgba(233, 69, 96, 0.12);
  color: #e94560;
  border-color: rgba(233, 69, 96, 0.4);
}

/* ============ 同步听歌 ============ */
.sync-card {
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sync-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sync-label {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
  font-weight: 500;
}

.sync-dj {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.sync-dj-label {
  font-size: 10px;
  padding: 2px 10px;
  border-radius: 8px;
  background: rgba(233, 69, 96, 0.2);
  color: #ff7a8f;
  font-weight: 600;
}

.sync-dj-name {
  color: rgba(255, 255, 255, 0.9);
}

.sync-dj-btn {
  align-self: flex-start;
}

.sync-hint {
  margin: 0;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  line-height: 1.5;
}

.sync-waiting {
  color: rgba(255, 200, 120, 0.9);
}

/* DJ 传歌方案切换 */
.sync-mode {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px dashed rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
}

.sync-mode-label {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.6);
  font-weight: 600;
  letter-spacing: 0.5px;
}

.sync-mode-options {
  display: flex;
  gap: 6px;
}

.sync-mode-btn {
  flex: 1;
  padding: 4px 0;
  font-size: 11px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  transition: all 0.15s ease;
}

.sync-mode-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

.sync-mode-btn.active {
  background: rgba(78, 204, 163, 0.25);
  border-color: rgba(78, 204, 163, 0.6);
  color: #4ecca3;
  font-weight: 600;
}

.sync-mode-desc {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
}

.empty-hint {
  text-align: center;
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  padding: 16px 0;
}

.room-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.room-list-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
}

.room-list-name {
  font-size: 14px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.9);
}

.room-list-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.room-tag {
  font-size: 10px;
  padding: 1px 8px;
  border-radius: 8px;
  flex-shrink: 0;
}

.room-tag.tag-public {
  background: rgba(78, 204, 163, 0.18);
  color: #4ecca3;
}

.room-tag.tag-private {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.6);
}

.room-list-meta {
  display: flex;
  gap: 10px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  margin-top: 4px;
  flex-wrap: wrap;
}

.room-meta-item {
  white-space: nowrap;
}

.room-list-desc {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  margin-top: 4px;
}

.room-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.room-header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.room-header-name {
  font-size: 16px;
  font-weight: 600;
  color: #fff;
}

.room-header-top {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.room-header-id {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  margin-top: 4px;
}

.room-desc {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 12px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 6px;
}

.room-section {
  margin-bottom: 16px;
}

.section-title {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
}

.ranking-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ranking-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
  font-size: 13px;
}

.ranking-rank {
  width: 32px;
  font-weight: 700;
  color: var(--accent, #e94560);
}

.ranking-name {
  flex: 1;
  color: rgba(255, 255, 255, 0.9);
}

.ranking-time {
  color: rgba(255, 255, 255, 0.6);
}

.member-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.member-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  font-size: 13px;
}

.member-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #888;
}

.member-dot.online {
  background: #4ecca3;
  box-shadow: 0 0 6px rgba(78, 204, 163, 0.6);
}

.member-name {
  flex: 1;
  color: rgba(255, 255, 255, 0.9);
}

.member-status {
  font-size: 11px;
  padding: 2px 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.6);
  white-space: nowrap;
}

.member-status.status-focusing {
  background: rgba(233, 69, 96, 0.16);
  color: #e94560;
}

.member-status.status-short_break,
.member-status.status-long_break {
  background: rgba(78, 204, 163, 0.16);
  color: #4ecca3;
}

.member-time {
  color: rgba(255, 255, 255, 0.6);
}

/* Scrollbar */
::-webkit-scrollbar {
  width: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.4);
}
</style>
