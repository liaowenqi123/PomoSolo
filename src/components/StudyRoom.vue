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
import { ref, onUnmounted } from "vue";
import Modal from "./Modal.vue";
import {
  studyRoomGetActive,
  studyRoomCreate,
  studyRoomJoin,
  studyRoomLeave,
  studyRoomGetRanking,
  studyRoomGetMembers,
  type StudyRoom,
  type StudyRoomMember,
  type StudyRoomRankingEntry,
} from "@/api/studyRoom";

interface Props {
  /** 是否显示 */
  visible: boolean;
  /** 是否允许点击背景关闭 */
  closeOnBackground?: boolean;
}

withDefaults(defineProps<Props>(), {
  closeOnBackground: true,
});

const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
  (e: "joined", room: StudyRoom): void;
  (e: "left"): void;
}>();

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
});

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
  await refreshRoomData();
  startRefresh();
  emit("joined", room);
}

/** 刷新成员 & 排名 */
async function refreshRoomData(): Promise<void> {
  if (!currentRoom.value) return;
  const roomId = currentRoom.value.id;
  try {
    const [m, r] = await Promise.all([
      studyRoomGetMembers(roomId),
      studyRoomGetRanking(roomId),
    ]);
    members.value = m;
    ranking.value = r;
  } catch (err) {
    // 后端未实现时会失败，静默处理
    console.warn("[StudyRoom] refreshRoomData failed:", err);
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
    view.value = "main";
    emit("left");
  } catch (err) {
    console.warn("[StudyRoom] leave failed:", err);
    showToast("退出失败：" + (err instanceof Error ? err.message : String(err)));
  } finally {
    loading.value = false;
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
      <div v-if="currentRoom" class="current-room-card">
        <div class="current-room-info">
          <div class="current-room-name">{{ currentRoom.name }}</div>
          <div class="current-room-id">ID: {{ shortId(currentRoom.id) }}</div>
        </div>
        <button class="btn btn-secondary" @click="enterRoom(currentRoom)">
          查看
        </button>
      </div>
      <div class="main-actions">
        <button class="btn btn-primary" @click="goCreate">创建自习室</button>
        <button class="btn btn-secondary" @click="goJoin">加入自习室</button>
      </div>
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
            <div class="room-list-name">{{ room.name }}</div>
            <div class="room-list-meta">
              ID: {{ shortId(room.id) }}
              <span v-if="room.memberCount !== undefined">
                · {{ room.memberCount }} 人
              </span>
            </div>
            <div v-if="room.description" class="room-list-desc">
              {{ room.description }}
            </div>
          </div>
          <button class="btn btn-secondary btn-sm" @click="handleJoinFromList(room)">
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
        <button
          class="btn btn-danger"
          :disabled="loading"
          @click="handleLeave"
        >
          退出
        </button>
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
            <span class="member-time">{{ formatMinutes(m.todayMinutes) }}</span>
          </li>
        </ul>
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
  justify-content: space-between;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
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
  gap: 10px;
}

.main-actions .btn {
  flex: 1;
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

.room-list-meta {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  margin-top: 4px;
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
