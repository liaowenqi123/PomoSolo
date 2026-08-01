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
  type StudyRoom,
  type StudyRoomMember,
  type StudyRoomRankingEntry,
} from "@/api/studyRoom";
import { useAuthStore } from "@/stores/auth";
import { useMusicStore } from "@/stores/music";

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
const REFRESH_INTERVAL_MS = 30_000;

// ===== 创建表单 =====
const createForm = ref({
  name: "",
  description: "",
});

// ===== 加入表单 =====
const joinIdInput = ref("");
const publicRooms = ref<StudyRoom[]>([]);

onUnmounted(() => {
  stopRefresh();
  if (toastTimer) clearTimeout(toastTimer);
  if (unlistenWs) unlistenWs();
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
    }
  },
);

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
  try {
    const [m, r] = await Promise.all([
      studyRoomGetMembers(roomId),
      studyRoomGetRanking(roomId),
    ]);
    // 成员列表以 WS room:members 实时推送为主；
    // REST 返回值非空才覆盖，避免推送先到后被空数组清空
    if (m.length > 0) members.value = m;
    ranking.value = r;
  } catch (err) {
    // 后端未实现时会失败，静默处理
    console.warn("[StudyRoom] refreshRoomData failed:", err);
  }

  // 拉取房间详情（名称/描述/房主），仅首次进入时
  if (!detailLoaded) {
    detailLoaded = true;
    try {
      const detail = await studyRoomGetDetail(roomId);
      currentRoom.value = {
        ...currentRoom.value,
        name: detail.name || currentRoom.value.name,
        description: detail.description ?? currentRoom.value.description,
        ownerId: detail.ownerId,
      };
      isOwner.value = !!detail.ownerId && detail.ownerId === authStore.session?.id;
    } catch (err) {
      console.warn("[StudyRoom] get detail failed:", err);
    }
  }
}

function startRefresh(): void {
  stopRefresh();
  refreshTimer = setInterval(() => {
    void refreshRoomData();
  }, REFRESH_INTERVAL_MS);
}

function stopRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

/** 切换到创建视图 */
function goCreate(): void {
  createForm.value = { name: "", description: "" };
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
    const room = await studyRoomCreate(name, createForm.value.description.trim());
    showToast("创建成功");
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
    await studyRoomJoin(id);
    // 后端目前不返回 room 信息，前端构造最小信息
    const room: StudyRoom = { id, name: `自习室 ${id.slice(0, 8)}` };
    showToast("加入成功");
    await enterRoom(room);
  } catch (err) {
    console.warn("[StudyRoom] join by id failed:", err);
    showToast("加入失败：" + (err instanceof Error ? err.message : String(err)));
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
          <div class="room-header-name">{{ currentRoom.name }}</div>
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
            <p v-else class="sync-hint">
              你是 DJ：在音乐播放器中操作（播放/暂停/切歌/跳转/音量）将同步给房间所有成员
            </p>
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
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
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
  max-height: 240px;
  overflow-y: auto;
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
