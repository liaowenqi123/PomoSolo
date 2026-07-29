import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref, computed, reactive, nextTick } from "vue";
import { setActivePinia, createPinia } from "pinia";

// Mock @tauri-apps/api/core（AuthPanel 通过 store 间接依赖）
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// ===== Mock auth store =====
// 使用 reactive 包裹以模拟 Pinia 的 ref 自动解包行为
function createMockStore() {
  const mode = ref<"cloud" | "local">("cloud");
  const session = ref<{
    id: number;
    username: string;
    admin: boolean;
  } | null>(null);
  const localApiKey = ref<string | null>(null);
  const loading = ref(false);
  const connectionOk = ref<boolean | null>(null);
  const lastError = ref<string | null>(null);

  return reactive({
    mode,
    session,
    localApiKey,
    loading,
    connectionOk,
    lastError,
    isLoggedIn: computed(() => session.value !== null),
    isLocalMode: computed(() => mode.value === "local"),
    isCloudMode: computed(() => mode.value === "cloud"),
    hasApiKey: computed(() =>
      mode.value === "local" ? !!localApiKey.value : session.value !== null,
    ),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    saveLocalApiKey: vi.fn(),
    switchMode: vi.fn(),
    loadMode: vi.fn(),
    clearError: vi.fn(),
  });
}

let mockStore: ReturnType<typeof createMockStore>;

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => mockStore,
}));

import AuthPanel from "../AuthPanel.vue";

describe("AuthPanel.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    invokeMock.mockReset();
    mockStore = createMockStore();
  });

  const mountComponent = (props: Record<string, unknown> = {}) =>
    mount(AuthPanel, {
      props: { visible: true, ...props },
    });

  // ===== 可见性 =====

  it("visible=false 时 Modal 不渲染内容", () => {
    const wrapper = mountComponent({ visible: false });
    expect(wrapper.find(".mode-toggle-container").exists()).toBe(false);
  });

  it("visible=true 时应渲染模式切换容器", () => {
    const wrapper = mountComponent();
    expect(wrapper.find(".mode-toggle-container").exists()).toBe(true);
  });

  // ===== 模式切换 =====

  it("cloud 模式应显示登录表单面板（auth-cloud-panel）", () => {
    mockStore.mode = "cloud";
    const wrapper = mountComponent();
    expect(wrapper.find(".auth-cloud-panel").exists()).toBe(true);
    expect(wrapper.find(".auth-local-panel").exists()).toBe(false);
  });

  it("local 模式应显示本地 API Key 输入面板（auth-local-panel）", () => {
    mockStore.mode = "local";
    const wrapper = mountComponent();
    expect(wrapper.find(".auth-local-panel").exists()).toBe(true);
    expect(wrapper.find(".auth-cloud-panel").exists()).toBe(false);
  });

  // ===== 连接状态 =====

  it("cloud 模式 + 连接成功时 connection-status 应有 connected 类", () => {
    mockStore.mode = "cloud";
    mockStore.connectionOk = true;
    const wrapper = mountComponent();
    const status = wrapper.find(".connection-status");
    expect(status.exists()).toBe(true);
    expect(status.classes()).toContain("connected");
    expect(status.classes()).not.toContain("disconnected");
    expect(status.text()).toContain("已连接");
  });

  it("cloud 模式 + 连接失败时 connection-status 应有 disconnected 类", () => {
    mockStore.mode = "cloud";
    mockStore.connectionOk = false;
    const wrapper = mountComponent();
    const status = wrapper.find(".connection-status");
    expect(status.exists()).toBe(true);
    expect(status.classes()).toContain("disconnected");
    expect(status.text()).toContain("连接失败");
  });

  // ===== 登录/注册 Tab =====

  it("cloud 未登录时应显示登录/注册 Tab", () => {
    mockStore.mode = "cloud";
    mockStore.session = null;
    const wrapper = mountComponent();
    const tabs = wrapper.findAll(".login-tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0].text()).toBe("登录");
    expect(tabs[1].text()).toBe("注册");
  });

  it("初始 Tab 应为 login", () => {
    mockStore.mode = "cloud";
    const wrapper = mountComponent();
    const tabs = wrapper.findAll(".login-tab");
    expect(tabs[0].classes()).toContain("active");
    expect(tabs[1].classes()).not.toContain("active");
  });

  it("点击注册 Tab 应切换到注册表单", async () => {
    mockStore.mode = "cloud";
    const wrapper = mountComponent();
    const tabs = wrapper.findAll(".login-tab");
    await tabs[1].trigger("click");

    expect(tabs[1].classes()).toContain("active");
    const inputs = wrapper.findAll(".login-form .form-input");
    expect(inputs).toHaveLength(3);
    expect(inputs[2].attributes("placeholder")).toBe("确认密码");
  });

  it("登录 Tab 应有用户名 + 密码输入框", () => {
    mockStore.mode = "cloud";
    const wrapper = mountComponent();
    const inputs = wrapper.findAll(".login-form .form-input");
    expect(inputs).toHaveLength(2);
    expect(inputs[0].attributes("placeholder")).toBe("用户名");
    expect(inputs[1].attributes("placeholder")).toBe("密码");
  });

  it("登录 Tab 应有记住密码 + 自动登录复选框", () => {
    mockStore.mode = "cloud";
    const wrapper = mountComponent();
    const checkboxes = wrapper.findAll(".checkbox-row");
    const labels = checkboxes.map((c) => c.text());
    expect(labels).toContain("记住密码");
    expect(labels).toContain("自动登录");
  });

  it("注册 Tab 应有用户名 + 密码 + 确认密码输入框", async () => {
    mockStore.mode = "cloud";
    const wrapper = mountComponent();
    await wrapper.findAll(".login-tab")[1].trigger("click");

    const inputs = wrapper.findAll(".login-form .form-input");
    expect(inputs).toHaveLength(3);
    expect(inputs[0].attributes("placeholder")).toBe("用户名");
    expect(inputs[1].attributes("placeholder")).toBe("密码");
    expect(inputs[2].attributes("placeholder")).toBe("确认密码");
  });

  // ===== 登录行为 =====

  it("点击登录按钮应调用 auth.login 并传递表单参数", async () => {
    mockStore.mode = "cloud";
    mockStore.login.mockResolvedValue(true);
    const wrapper = mountComponent();

    const inputs = wrapper.findAll(".login-form .form-input");
    await inputs[0].setValue("alice");
    await inputs[1].setValue("secret123");

    const checkboxes = wrapper.findAll('.checkbox-row input[type="checkbox"]');
    await checkboxes[0].setValue(true); // rememberPassword
    await checkboxes[1].setValue(true); // autoLogin

    const loginBtn = wrapper.find(".btn-primary");
    await loginBtn.trigger("click");

    expect(mockStore.login).toHaveBeenCalledWith(
      "alice",
      "secret123",
      true,
      true,
    );
  });

  it("登录成功后应 emit logged-in + update:visible(false)", async () => {
    mockStore.mode = "cloud";
    mockStore.login.mockResolvedValue(true);
    const wrapper = mountComponent();

    const inputs = wrapper.findAll(".login-form .form-input");
    await inputs[0].setValue("alice");
    await inputs[1].setValue("secret123");

    await wrapper.find(".btn-primary").trigger("click");

    expect(wrapper.emitted("logged-in")).toBeTruthy();
    const updateEvents = wrapper.emitted("update:visible");
    expect(updateEvents).toBeTruthy();
    expect(updateEvents![updateEvents!.length - 1]).toEqual([false]);
  });

  it("登录失败时不应 emit logged-in", async () => {
    mockStore.mode = "cloud";
    mockStore.login.mockResolvedValue(false);
    const wrapper = mountComponent();

    const inputs = wrapper.findAll(".login-form .form-input");
    await inputs[0].setValue("alice");
    await inputs[1].setValue("secret123");

    await wrapper.find(".btn-primary").trigger("click");

    expect(wrapper.emitted("logged-in")).toBeFalsy();
  });

  it("密码框按 Enter 应触发登录", async () => {
    mockStore.mode = "cloud";
    mockStore.login.mockResolvedValue(true);
    const wrapper = mountComponent();

    const inputs = wrapper.findAll(".login-form .form-input");
    await inputs[0].setValue("alice");
    await inputs[1].setValue("secret123");

    await inputs[1].trigger("keydown", { key: "Enter" });

    expect(mockStore.login).toHaveBeenCalledWith(
      "alice",
      "secret123",
      false,
      false,
    );
  });

  it("用户名或密码为空时点击登录不应调用 auth.login", async () => {
    mockStore.mode = "cloud";
    const wrapper = mountComponent();

    await wrapper.find(".btn-primary").trigger("click");

    expect(mockStore.login).not.toHaveBeenCalled();
  });

  // ===== 注册行为 =====

  it("注册时密码不匹配不应调用 auth.register", async () => {
    mockStore.mode = "cloud";
    const wrapper = mountComponent();

    await wrapper.findAll(".login-tab")[1].trigger("click");

    const inputs = wrapper.findAll(".login-form .form-input");
    await inputs[0].setValue("bob");
    await inputs[1].setValue("password123");
    await inputs[2].setValue("different456");

    await wrapper.find(".btn-primary").trigger("click");

    expect(mockStore.register).not.toHaveBeenCalled();
  });

  it("注册时密码匹配应调用 auth.register", async () => {
    mockStore.mode = "cloud";
    mockStore.register.mockResolvedValue(true);
    const wrapper = mountComponent();

    await wrapper.findAll(".login-tab")[1].trigger("click");

    const inputs = wrapper.findAll(".login-form .form-input");
    await inputs[0].setValue("bob");
    await inputs[1].setValue("password123");
    await inputs[2].setValue("password123");

    await wrapper.find(".btn-primary").trigger("click");

    expect(mockStore.register).toHaveBeenCalledWith("bob", "password123");
  });

  // ===== 已登录状态 =====

  it("已登录时应显示欢迎信息 + 用户名", () => {
    mockStore.mode = "cloud";
    mockStore.session = { id: 42, username: "alice", admin: false };
    const wrapper = mountComponent();

    const welcome = wrapper.find(".welcome-text");
    expect(welcome.exists()).toBe(true);
    expect(welcome.text()).toContain("alice");
  });

  it("已登录时应显示用户 ID", () => {
    mockStore.mode = "cloud";
    mockStore.session = { id: 42, username: "alice", admin: false };
    const wrapper = mountComponent();

    const meta = wrapper.find(".user-meta");
    expect(meta.exists()).toBe(true);
    expect(meta.text()).toContain("42");
  });

  it("已登录 + admin 应显示 Admin 标识", () => {
    mockStore.mode = "cloud";
    mockStore.session = { id: 1, username: "root", admin: true };
    const wrapper = mountComponent();

    const meta = wrapper.find(".user-meta");
    expect(meta.text()).toContain("Admin");
  });

  it("已登录 + 非 admin 不应显示 Admin 标识", () => {
    mockStore.mode = "cloud";
    mockStore.session = { id: 1, username: "alice", admin: false };
    const wrapper = mountComponent();

    const meta = wrapper.find(".user-meta");
    expect(meta.text()).not.toContain("Admin");
  });

  it("点击退出登录按钮应调用 auth.logout", async () => {
    mockStore.mode = "cloud";
    mockStore.session = { id: 1, username: "alice", admin: false };
    mockStore.logout.mockResolvedValue(undefined);
    const wrapper = mountComponent();

    const logoutBtn = wrapper.find(".btn-secondary");
    expect(logoutBtn.text()).toContain("退出登录");

    await logoutBtn.trigger("click");

    expect(mockStore.logout).toHaveBeenCalled();
  });

  // ===== 本地模式 =====

  it("local 模式应显示 API Key 输入框 + 保存按钮", () => {
    mockStore.mode = "local";
    const wrapper = mountComponent();

    const input = wrapper.find(".auth-local-panel .form-input");
    expect(input.exists()).toBe(true);
    expect(input.attributes("placeholder")).toBe("sk-...");

    const btn = wrapper.find(".auth-local-panel .btn-primary");
    expect(btn.exists()).toBe(true);
    expect(btn.text()).toContain("保存配置");
  });

  it("local 模式 API Key 输入框默认 type=password", () => {
    mockStore.mode = "local";
    const wrapper = mountComponent();

    const input = wrapper.find(".auth-local-panel .form-input");
    expect(input.attributes("type")).toBe("password");
  });

  it("勾选『显示 API Key』后输入框 type 应变为 text", async () => {
    mockStore.mode = "local";
    const wrapper = mountComponent();

    const checkbox = wrapper.find(
      '.auth-local-panel .checkbox-row input[type="checkbox"]',
    );
    await checkbox.setValue(true);

    const input = wrapper.find(".auth-local-panel .form-input");
    expect(input.attributes("type")).toBe("text");
  });

  it("点击保存配置应调用 auth.saveLocalApiKey", async () => {
    mockStore.mode = "local";
    mockStore.saveLocalApiKey.mockResolvedValue(true);
    const wrapper = mountComponent();

    const input = wrapper.find(".auth-local-panel .form-input");
    await input.setValue("sk-my-key");

    await wrapper.find(".auth-local-panel .btn-primary").trigger("click");

    expect(mockStore.saveLocalApiKey).toHaveBeenCalledWith("sk-my-key");
  });

  it("保存成功后应 emit logged-in + update:visible(false)", async () => {
    mockStore.mode = "local";
    mockStore.saveLocalApiKey.mockResolvedValue(true);
    const wrapper = mountComponent();

    const input = wrapper.find(".auth-local-panel .form-input");
    await input.setValue("sk-my-key");

    await wrapper.find(".auth-local-panel .btn-primary").trigger("click");

    expect(wrapper.emitted("logged-in")).toBeTruthy();
    const updateEvents = wrapper.emitted("update:visible");
    expect(updateEvents).toBeTruthy();
    expect(updateEvents![updateEvents!.length - 1]).toEqual([false]);
  });

  // ===== 错误信息 =====

  it("auth.lastError 存在时应显示错误信息", () => {
    mockStore.lastError = "用户名或密码错误";
    const wrapper = mountComponent();

    const err = wrapper.find(".auth-message.error");
    expect(err.exists()).toBe(true);
    expect(err.text()).toBe("用户名或密码错误");
  });

  it("auth.lastError 为 null 时不应显示错误信息", () => {
    mockStore.lastError = null;
    const wrapper = mountComponent();

    expect(wrapper.find(".auth-message.error").exists()).toBe(false);
  });

  // ===== 模式切换确认弹窗 =====

  it("点击模式切换应弹出确认弹窗", async () => {
    mockStore.mode = "cloud";
    const wrapper = mountComponent();

    const localLabel = wrapper.findAll(".mode-label")[1];
    await localLabel.trigger("click");

    expect(wrapper.text()).toContain("确定要切换吗？");
  });

  it("确认弹窗点击『取消』应关闭弹窗且不切换模式", async () => {
    mockStore.mode = "cloud";
    const wrapper = mountComponent();

    await wrapper.findAll(".mode-label")[1].trigger("click");
    expect(wrapper.text()).toContain("确定要切换吗？");

    const cancelBtn = wrapper.findAll("button").find((b) => b.text() === "取消");
    await cancelBtn!.trigger("click");

    await nextTick();
    expect(wrapper.text()).not.toContain("确定要切换吗？");
    expect(mockStore.switchMode).not.toHaveBeenCalled();
  });

  it("确认弹窗点击『确定』应调用 auth.switchMode 并重置表单", async () => {
    mockStore.mode = "cloud";
    mockStore.switchMode.mockResolvedValue(undefined);
    const wrapper = mountComponent();

    await wrapper.findAll(".mode-label")[1].trigger("click");

    const confirmBtn = wrapper.findAll("button").find((b) => b.text() === "确定");
    await confirmBtn!.trigger("click");

    expect(mockStore.switchMode).toHaveBeenCalledWith("local");
  });

  it("切换到 cloud 时确认弹窗标题应为『切换到云端登录』", async () => {
    mockStore.mode = "local";
    const wrapper = mountComponent();

    await wrapper.findAll(".mode-label")[0].trigger("click");

    expect(wrapper.text()).toContain("切换到云端登录");
  });

  it("切换到 local 时确认弹窗标题应为『切换到本地配置』", async () => {
    mockStore.mode = "cloud";
    const wrapper = mountComponent();

    await wrapper.findAll(".mode-label")[1].trigger("click");

    expect(wrapper.text()).toContain("切换到本地配置");
  });

  // ===== loading 状态 =====

  it("loading=true 时登录按钮应禁用并显示『登录中...』", () => {
    mockStore.mode = "cloud";
    mockStore.loading = true;
    const wrapper = mountComponent();

    const btn = wrapper.find(".btn-primary");
    expect(btn.attributes("disabled")).toBeDefined();
    expect(btn.text()).toContain("登录中...");
  });

  it("loading=true 时注册按钮应禁用并显示『注册中...』", async () => {
    mockStore.mode = "cloud";
    mockStore.loading = true;
    const wrapper = mountComponent();

    await wrapper.findAll(".login-tab")[1].trigger("click");

    const btn = wrapper.find(".btn-primary");
    expect(btn.attributes("disabled")).toBeDefined();
    expect(btn.text()).toContain("注册中...");
  });
});
