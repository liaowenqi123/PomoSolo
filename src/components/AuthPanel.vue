<script setup lang="ts">
/**
 * 认证面板组件
 *
 * 简化版登录/注册面板，参考 electron/src/scripts/modules/apiKeyManager.js（967 行）。
 *
 * 功能：
 * - 模式切换拨杆：云端登录 ↔ 本地配置
 * - 云端模式：登录表单 + 注册表单（Tab 切换）
 * - 本地模式：手动输入 API Key
 *
 * 通过 v-model:visible 控制显示。
 */
import { ref, watch } from "vue";
import Modal from "./Modal.vue";
import { useAuthStore } from "@/stores/auth";

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
  (e: "logged-in"): void;
}>();

const auth = useAuthStore();

// 当前激活的 Tab：login / register
const activeTab = ref<"login" | "register">("login");

// 登录表单
const loginForm = ref({
  username: "",
  password: "",
  rememberPassword: false,
  autoLogin: false,
});

// 注册表单
const registerForm = ref({
  username: "",
  password: "",
  confirmPassword: "",
});

// 本地 API Key 输入
const localApiKeyInput = ref("");
const showApiKey = ref(false);

// 待确认的模式切换（用于确认弹窗）
const pendingMode = ref<"cloud" | "local" | null>(null);

// 内部确认弹窗
const confirmVisible = ref(false);

// 同步 store 中的 localApiKey 到输入框
watch(
  () => auth.localApiKey,
  (k) => {
    if (k) localApiKeyInput.value = k;
  },
);

// 当弹窗打开时，确保模式已加载
watch(
  () => props.visible,
  (v) => {
    if (v && !auth.mode) {
      void auth.loadMode();
    }
  },
);

function onClose(): void {
  emit("update:visible", false);
}

/** 触发模式切换：先弹确认 */
function onModeToggleClick(target: "cloud" | "local"): void {
  if (target === auth.mode) return;
  pendingMode.value = target;
  confirmVisible.value = true;
}

/** 确认模式切换 */
async function confirmSwitchMode(): Promise<void> {
  if (!pendingMode.value) return;
  const target = pendingMode.value;
  pendingMode.value = null;
  confirmVisible.value = false;
  await auth.switchMode(target);
  // 重置表单
  loginForm.value = {
    username: "",
    password: "",
    rememberPassword: false,
    autoLogin: false,
  };
  registerForm.value = {
    username: "",
    password: "",
    confirmPassword: "",
  };
  localApiKeyInput.value = "";
}

/** 取消模式切换 */
function cancelSwitchMode(): void {
  pendingMode.value = null;
  confirmVisible.value = false;
}

/** 提交登录 */
async function handleLogin(): Promise<void> {
  const { username, password, rememberPassword, autoLogin } = loginForm.value;
  if (!username.trim() || !password) {
    return;
  }
  const ok = await auth.login(
    username.trim(),
    password,
    rememberPassword,
    autoLogin,
  );
  if (ok) {
    emit("logged-in");
    emit("update:visible", false);
  }
}

/** 提交注册 */
async function handleRegister(): Promise<void> {
  const { username, password, confirmPassword } = registerForm.value;
  if (!username.trim() || !password) {
    return;
  }
  if (password !== confirmPassword) {
    return;
  }
  await auth.register(username.trim(), password);
}

/** 保存本地 API Key */
async function handleSaveLocalApiKey(): Promise<void> {
  const ok = await auth.saveLocalApiKey(localApiKeyInput.value.trim());
  if (ok) {
    emit("logged-in");
    emit("update:visible", false);
  }
}

/** 退出登录 */
async function handleLogout(): Promise<void> {
  await auth.logout();
}

function onLoginEnter(e: KeyboardEvent): void {
  if (e.key === "Enter") {
    void handleLogin();
  }
}

function onRegisterEnter(e: KeyboardEvent): void {
  if (e.key === "Enter") {
    void handleRegister();
  }
}

function onLocalKeyEnter(e: KeyboardEvent): void {
  if (e.key === "Enter") {
    void handleSaveLocalApiKey();
  }
}
</script>

<template>
  <Modal
    :visible="visible"
    :title="auth.isLocalMode ? '⚙️ 本地配置' : '☁️ 云端登录'"
    :close-on-background="closeOnBackground"
    width="380px"
    @close="onClose"
    @update:visible="(v) => emit('update:visible', v)"
  >
    <!-- 模式切换拨杆 -->
    <div class="mode-toggle-container">
      <span
        class="mode-label"
        :class="{ active: auth.isCloudMode }"
        @click="onModeToggleClick('cloud')"
      >☁️ 云端</span>
      <label class="mode-toggle-switch">
        <input
          type="checkbox"
          :checked="auth.isLocalMode"
          @change="onModeToggleClick(auth.isCloudMode ? 'local' : 'cloud')"
        />
        <span class="mode-toggle-slider"></span>
      </label>
      <span
        class="mode-label"
        :class="{ active: auth.isLocalMode }"
        @click="onModeToggleClick('local')"
      >⚙️ 本地</span>
    </div>

    <!-- 连接状态 -->
    <div
      v-if="auth.isCloudMode"
      class="connection-status"
      :class="{
        connected: auth.connectionOk === true,
        disconnected: auth.connectionOk === false,
      }"
    >
      {{ auth.connectionOk === true ? "● 已连接" : "● 连接失败" }}
    </div>

    <!-- 云端模式 -->
    <div v-if="auth.isCloudMode" class="auth-cloud-panel">
      <!-- 已登录 -->
      <div v-if="auth.isLoggedIn" class="logged-in-panel">
        <p class="welcome-text">欢迎, {{ auth.session?.username }}!</p>
        <p class="user-meta">
          ID: {{ auth.session?.id }}
          <span v-if="auth.session?.admin"> | Admin</span>
        </p>
        <button class="btn btn-secondary" @click="handleLogout">退出登录</button>
      </div>

      <!-- 未登录：登录/注册 Tab -->
      <div v-else class="auth-form-panel">
        <div class="login-tabs">
          <div
            class="login-tab"
            :class="{ active: activeTab === 'login' }"
            @click="activeTab = 'login'"
          >
            登录
          </div>
          <div
            class="login-tab"
            :class="{ active: activeTab === 'register' }"
            @click="activeTab = 'register'"
          >
            注册
          </div>
        </div>

        <!-- 登录表单 -->
        <div v-if="activeTab === 'login'" class="login-form">
          <input
            v-model="loginForm.username"
            class="form-input"
            type="text"
            placeholder="用户名"
            @keydown="onLoginEnter"
          />
          <input
            v-model="loginForm.password"
            class="form-input"
            type="password"
            placeholder="密码"
            @keydown="onLoginEnter"
          />
          <label class="checkbox-row">
            <input v-model="loginForm.rememberPassword" type="checkbox" />
            <span>记住密码</span>
          </label>
          <label class="checkbox-row">
            <input v-model="loginForm.autoLogin" type="checkbox" />
            <span>自动登录</span>
          </label>
          <button
            class="btn btn-primary"
            :disabled="auth.loading"
            @click="handleLogin"
          >
            {{ auth.loading ? "登录中..." : "登录" }}
          </button>
        </div>

        <!-- 注册表单 -->
        <div v-else class="login-form">
          <input
            v-model="registerForm.username"
            class="form-input"
            type="text"
            placeholder="用户名"
            @keydown="onRegisterEnter"
          />
          <input
            v-model="registerForm.password"
            class="form-input"
            type="password"
            placeholder="密码"
            @keydown="onRegisterEnter"
          />
          <input
            v-model="registerForm.confirmPassword"
            class="form-input"
            type="password"
            placeholder="确认密码"
            @keydown="onRegisterEnter"
          />
          <button
            class="btn btn-primary"
            :disabled="auth.loading"
            @click="handleRegister"
          >
            {{ auth.loading ? "注册中..." : "注册" }}
          </button>
        </div>
      </div>
    </div>

    <!-- 本地模式 -->
    <div v-else class="auth-local-panel">
      <p class="local-hint">
        手动输入 DeepSeek API Key（
        <a
          href="https://platform.deepseek.com"
          target="_blank"
          rel="noopener"
        >去申请</a
        >）
      </p>
      <input
        v-model="localApiKeyInput"
        class="form-input"
        :type="showApiKey ? 'text' : 'password'"
        placeholder="sk-..."
        @keydown="onLocalKeyEnter"
      />
      <label class="checkbox-row">
        <input v-model="showApiKey" type="checkbox" />
        <span>显示 API Key</span>
      </label>
      <button
        class="btn btn-primary"
        :disabled="auth.loading"
        @click="handleSaveLocalApiKey"
      >
        保存配置
      </button>
    </div>

    <!-- 错误信息 -->
    <p v-if="auth.lastError" class="auth-message error">{{ auth.lastError }}</p>

    <!-- 模式切换确认弹窗 -->
    <Modal
      :visible="confirmVisible"
      :title="pendingMode === 'local' ? '切换到本地配置' : '切换到云端登录'"
      :close-on-background="true"
      width="360px"
      @close="cancelSwitchMode"
      @update:visible="(v) => (confirmVisible = v)"
    >
      <p class="confirm-message">
        {{
          pendingMode === "local"
            ? "切换后云端登录凭据将被清除，需要重新输入 API Key。确定要切换吗？"
            : "切换后本地保存的 API Key 将被删除。确定要切换吗？"
        }}
      </p>
      <template #footer>
        <button class="btn btn-secondary" @click="cancelSwitchMode">取消</button>
        <button class="btn btn-primary" @click="confirmSwitchMode">确定</button>
      </template>
    </Modal>
  </Modal>
</template>

<style scoped>
.mode-toggle-container {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-bottom: 16px;
}

.mode-label {
  font-size: 13px;
  color: var(--text-secondary, #888);
  cursor: pointer;
  user-select: none;
  transition: color 0.2s ease;
}

.mode-label.active {
  color: var(--accent, #e94560);
  font-weight: 600;
}

.mode-toggle-switch {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 22px;
  flex-shrink: 0;
}

.mode-toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.mode-toggle-slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 22px;
  transition: background 0.25s ease;
}

.mode-toggle-slider::before {
  content: "";
  position: absolute;
  height: 16px;
  width: 16px;
  left: 3px;
  bottom: 3px;
  background: #fff;
  border-radius: 50%;
  transition: transform 0.25s ease;
}

.mode-toggle-switch input:checked + .mode-toggle-slider {
  background: var(--accent, #e94560);
}

.mode-toggle-switch input:checked + .mode-toggle-slider::before {
  transform: translateX(18px);
}

.connection-status {
  text-align: center;
  font-size: 12px;
  margin-bottom: 12px;
}

.connection-status.connected {
  color: #4ecca3;
}

.connection-status.disconnected {
  color: #e94560;
}

.login-tabs {
  display: flex;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 10px;
  padding: 3px;
  margin-bottom: 14px;
}

.login-tab {
  flex: 1;
  text-align: center;
  padding: 8px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-secondary, #888);
  transition: all 0.2s ease;
}

.login-tab.active {
  background: var(--accent, #e94560);
  color: #fff;
  font-weight: 600;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.form-input {
  width: 100%;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary, #eee);
  font-size: 14px;
  box-sizing: border-box;
  outline: none;
  transition: border-color 0.2s ease;
}

.form-input:focus {
  border-color: var(--accent, #e94560);
}

.checkbox-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-secondary, #888);
  cursor: pointer;
}

.checkbox-row input[type="checkbox"] {
  cursor: pointer;
}

.btn {
  padding: 10px 16px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: opacity 0.2s ease;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
  color: var(--text-primary, #eee);
}

.logged-in-panel {
  text-align: center;
  padding: 12px 0;
}

.welcome-text {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 6px;
}

.user-meta {
  font-size: 12px;
  color: var(--text-secondary, #888);
  margin: 0 0 16px;
}

.auth-local-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.local-hint {
  font-size: 13px;
  color: var(--text-secondary, #888);
  margin: 0 0 4px;
}

.local-hint a {
  color: var(--accent, #e94560);
}

.auth-message {
  margin-top: 12px;
  font-size: 13px;
  padding: 8px 10px;
  border-radius: 6px;
}

.auth-message.error {
  color: #e94560;
  background: rgba(233, 69, 96, 0.1);
}

.confirm-message {
  margin: 0;
  line-height: 1.5;
  font-size: 14px;
}
</style>
