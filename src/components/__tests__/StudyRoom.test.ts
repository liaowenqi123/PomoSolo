import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

// Mock @/api/studyRoom
const studyRoomApi = vi.hoisted(() => ({
  studyRoomGetActive: vi.fn(),
  studyRoomCreate: vi.fn(),
  studyRoomJoin: vi.fn(),
  studyRoomLeave: vi.fn(),
  studyRoomGetRanking: vi.fn(),
  studyRoomGetMembers: vi.fn(),
  studyRoomGetDetail: vi.fn(),
  studyRoomDelete: vi.fn(),
  studyRoomUpdate: vi.fn(),
  studyRoomUpdateStatus: vi.fn(),
}));
vi.mock("@/api/studyRoom", () => studyRoomApi);

// Mock @/stores/auth（房主判断用当前用户 id）
vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({
    session: { id: "me-1", username: "me", admin: false },
    isLoggedIn: true,
  }),
}));

// Mock @/stores/music（同步听歌状态）
const musicMock = vi.hoisted(() => ({
  syncEnabled: false,
  isDj: false,
  djName: "",
  djUserId: null,
  waitingForSongs: false,
  songTransfer: { state: "idle", songName: "", received: 0, total: 0, startedAt: 0, retryCount: 0, channel: null },
  setSyncEnabled: vi.fn(),
  requestDj: vi.fn(),
  setTransferMode: vi.fn(),
  transferMode: "immediate",
}));
vi.mock("@/stores/music", () => ({
  useMusicStore: () => musicMock,
}));

// Mock @/stores/settings（压缩传歌开关等）
vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => ({
    settings: { p2pCompress: true },
    update: vi.fn(),
  }),
}));

// Mock @tauri-apps/api/event（ws-event 监听）
type WsEventListener = (
  event: string,
  handler: (e: { payload: unknown }) => void,
) => Promise<() => void>;
const eventListenMock = vi.hoisted(() =>
  vi.fn<WsEventListener>(() => Promise.resolve(() => {})),
);
vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, handler: (e: { payload: unknown }) => void) =>
    eventListenMock(event, handler),
}));

import StudyRoom from "../StudyRoom.vue";

describe("StudyRoom.vue", () => {
  let setIntervalSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    Object.values(studyRoomApi).forEach((fn) => fn.mockReset());
    eventListenMock.mockReset();
    eventListenMock.mockImplementation(() => Promise.resolve(() => {}));
    studyRoomApi.studyRoomGetActive.mockResolvedValue([]);
    studyRoomApi.studyRoomCreate.mockResolvedValue({ id: "abcdefgh", name: "R" });
    studyRoomApi.studyRoomJoin.mockResolvedValue(undefined);
    studyRoomApi.studyRoomLeave.mockResolvedValue(undefined);
    studyRoomApi.studyRoomGetRanking.mockResolvedValue([]);
    studyRoomApi.studyRoomGetMembers.mockResolvedValue([]);
    studyRoomApi.studyRoomGetDetail.mockResolvedValue({
      id: "abcdefgh",
      name: "R",
      ownerId: "",
    });
    studyRoomApi.studyRoomDelete.mockResolvedValue(true);
    studyRoomApi.studyRoomUpdate.mockResolvedValue(true);
    studyRoomApi.studyRoomUpdateStatus.mockResolvedValue(undefined);
    // 复位同步听歌 mock 状态
    musicMock.setSyncEnabled.mockReset();
    musicMock.requestDj.mockReset();
    musicMock.syncEnabled = false;
    musicMock.isDj = false;
    musicMock.djName = "";
    musicMock.djUserId = null;
    // 拦截 setInterval，避免真实 30s 定时器
    setIntervalSpy = vi.fn(() => 0 as unknown as ReturnType<typeof setInterval>);
    globalThis.setInterval = setIntervalSpy as unknown as typeof setInterval;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mountComponent = (visible = true) =>
    mount(StudyRoom, { props: { visible } });

  /** 获取组件注册的 ws-event handler（未注册返回 null） */
  const getWsHandler = (): ((e: { payload: unknown }) => void) | null => {
    const call = eventListenMock.mock.calls.find((c) => c[0] === "ws-event");
    return call ? (call[1] as (e: { payload: unknown }) => void) : null;
  };

  /** 点击主视图『创建自习室』入口卡片 */
  const clickCreateCard = async (wrapper: ReturnType<typeof mountComponent>) => {
    await wrapper.findAll(".action-card")[0].trigger("click");
  };

  /** 点击主视图『加入自习室』入口卡片 */
  const clickJoinCard = async (wrapper: ReturnType<typeof mountComponent>) => {
    await wrapper.findAll(".action-card")[1].trigger("click");
  };

  /** 进入房间视图（创建自习室） */
  const enterRoom = async (wrapper: ReturnType<typeof mountComponent>) => {
    await clickCreateCard(wrapper);
    await wrapper.find(".study-create input.form-input").setValue("R");
    await wrapper.find(".study-create .btn-primary").trigger("click");
    await flushPromises();
  };

  /** 触发一条 ws-event */
  const fireWs = async (payload: unknown) => {
    const handler = getWsHandler();
    expect(handler).toBeTruthy();
    await handler!({ payload });
    await flushPromises();
  };

  it("弹窗标题为『👥 自习室』", () => {
    const wrapper = mountComponent(true);
    expect(wrapper.find(".modal-title").text()).toBe("👥 自习室");
  });

  it("主视图：创建/加入入口卡片", () => {
    const wrapper = mountComponent(true);
    expect(wrapper.find(".study-main").exists()).toBe(true);
    const cards = wrapper.find(".main-actions").findAll(".action-card");
    expect(cards).toHaveLength(2);
    expect(cards[0].text()).toContain("创建自习室");
    expect(cards[1].text()).toContain("加入自习室");
  });

  it("点击创建入口切换到创建视图", async () => {
    const wrapper = mountComponent(true);
    await clickCreateCard(wrapper);
    expect(wrapper.find(".study-create").exists()).toBe(true);
    expect(wrapper.find(".study-create input.form-input").exists()).toBe(true);
    expect(wrapper.find(".study-create .form-textarea").exists()).toBe(true);
    expect(wrapper.find(".study-create .btn-secondary").text()).toBe("取消");
    expect(wrapper.find(".study-create .btn-primary").text()).toBe("创建");
  });

  it("点击加入入口切换到加入视图", async () => {
    const wrapper = mountComponent(true);
    await clickJoinCard(wrapper);
    await flushPromises();
    expect(wrapper.find(".study-join").exists()).toBe(true);
    expect(wrapper.find(".study-join input.form-input").exists()).toBe(true);
    expect(wrapper.find(".study-join .input-with-btn .btn-primary").text()).toBe("加入");
    expect(wrapper.find(".study-join .form-actions .btn-secondary").text()).toBe("返回");
  });

  it("点击取消/返回回到主视图", async () => {
    const wrapper = mountComponent(true);
    // 创建视图取消
    await clickCreateCard(wrapper);
    await wrapper.find(".study-create .btn-secondary").trigger("click");
    expect(wrapper.find(".study-main").exists()).toBe(true);
    // 加入视图返回
    await clickJoinCard(wrapper);
    await flushPromises();
    await wrapper.find(".study-join .form-actions .btn-secondary").trigger("click");
    expect(wrapper.find(".study-main").exists()).toBe(true);
  });

  it("创建自习室：调用 studyRoomCreate 后进入房间视图并 emit joined", async () => {
    const wrapper = mountComponent(true);
    await clickCreateCard(wrapper);
    await wrapper.find(".study-create input.form-input").setValue("我的自习室");
    await wrapper.find(".study-create textarea.form-textarea").setValue("一起学");
    await wrapper.find(".study-create .btn-primary").trigger("click");
    await flushPromises();
    expect(studyRoomApi.studyRoomCreate).toHaveBeenCalledWith("我的自习室", "一起学", "");
    expect(studyRoomApi.studyRoomGetMembers).toHaveBeenCalled();
    expect(studyRoomApi.studyRoomGetRanking).toHaveBeenCalled();
    expect(wrapper.find(".study-room").exists()).toBe(true);
    expect(wrapper.emitted("joined")).toBeTruthy();
  });

  it("通过 ID 加入：调用 studyRoomJoin 后进入房间视图", async () => {
    const wrapper = mountComponent(true);
    await clickJoinCard(wrapper);
    await flushPromises();
    await wrapper.find(".study-join .input-with-btn input.form-input").setValue("room-id-xyz");
    await wrapper.find(".study-join .input-with-btn .btn-primary").trigger("click");
    await flushPromises();
    expect(studyRoomApi.studyRoomJoin).toHaveBeenCalledWith("room-id-xyz", "");
    expect(wrapper.find(".study-room").exists()).toBe(true);
  });

  it("退出按钮调用 studyRoomLeave、emit left、回到主视图并关闭同步听歌", async () => {
    const wrapper = mountComponent(true);
    await enterRoom(wrapper);
    expect(wrapper.find(".study-room").exists()).toBe(true);
    await wrapper.find(".room-header .btn-danger").trigger("click");
    await flushPromises();
    expect(studyRoomApi.studyRoomLeave).toHaveBeenCalled();
    expect(wrapper.emitted("left")).toBeTruthy();
    expect(wrapper.find(".study-main").exists()).toBe(true);
    expect(musicMock.setSyncEnabled).toHaveBeenCalledWith(false);
  });

  it("点击遮罩 emit update:visible false", async () => {
    const wrapper = mountComponent(true);
    await wrapper.find(".modal-overlay").trigger("click");
    const events = wrapper.emitted("update:visible");
    expect(events).toBeTruthy();
    expect(events![0]).toEqual([false]);
  });

  it("toast 在获取公开列表失败时显示", async () => {
    studyRoomApi.studyRoomGetActive.mockRejectedValue(new Error("net"));
    const wrapper = mountComponent(true);
    await clickJoinCard(wrapper);
    await flushPromises();
    expect(wrapper.find(".study-toast").exists()).toBe(true);
    expect(wrapper.find(".study-toast").text()).toContain("获取自习室列表失败");
  });

  it("shortId: ID 长度 >8 截断并加『…』", async () => {
    studyRoomApi.studyRoomGetActive.mockResolvedValue([
      { id: "abcdefghijk", name: "R" },
    ]);
    const wrapper = mountComponent(true);
    await clickJoinCard(wrapper);
    await flushPromises();
    expect(wrapper.find(".room-list-meta").text()).toContain("abcdefgh…");
  });

  it("shortId: ID 长度 ≤8 不截断", async () => {
    studyRoomApi.studyRoomGetActive.mockResolvedValue([
      { id: "abc", name: "R" },
    ]);
    const wrapper = mountComponent(true);
    await clickJoinCard(wrapper);
    await flushPromises();
    expect(wrapper.find(".room-list-meta").text()).toContain("abc");
    expect(wrapper.find(".room-list-meta").text()).not.toContain("…");
  });

  it("formatMinutes: <60 显示『X 分钟』，≥60 显示『X 小时 Y 分钟』", async () => {
    studyRoomApi.studyRoomCreate.mockResolvedValue({ id: "abc", name: "R" });
    studyRoomApi.studyRoomGetRanking.mockResolvedValue([
      { username: "a", todayMinutes: 30, rank: 1 },
      { username: "b", todayMinutes: 90, rank: 2 },
      { username: "c", todayMinutes: 60, rank: 3 },
    ]);
    const wrapper = mountComponent(true);
    await enterRoom(wrapper);
    const times = wrapper.findAll(".ranking-time").map((e) => e.text());
    expect(times).toContain("30 分钟");
    expect(times).toContain("1 小时 30 分钟");
    expect(times).toContain("1 小时");
  });

  it("空排名显示占位", async () => {
    studyRoomApi.studyRoomCreate.mockResolvedValue({ id: "abc", name: "R" });
    studyRoomApi.studyRoomGetRanking.mockResolvedValue([]);
    const wrapper = mountComponent(true);
    await enterRoom(wrapper);
    expect(wrapper.find(".ranking-list").exists()).toBe(false);
    expect(wrapper.text()).toContain("暂无排名数据");
  });

  it("进入房间乐观添加自己（无需等服务器推送）", async () => {
    studyRoomApi.studyRoomCreate.mockResolvedValue({ id: "abc", name: "R" });
    studyRoomApi.studyRoomGetMembers.mockResolvedValue([]);
    const wrapper = mountComponent(true);
    await enterRoom(wrapper);
    // 服务器成员列表为空时，乐观显示自己（bug 修复：创建并加入瞬间就能看到自己）
    expect(wrapper.text()).toContain("me");
    expect(wrapper.findAll(".member-item")).toHaveLength(1);
  });

  it("在线成员有 .online 类", async () => {
    studyRoomApi.studyRoomCreate.mockResolvedValue({ id: "abc", name: "R" });
    studyRoomApi.studyRoomGetMembers.mockResolvedValue([
      { userId: "u-1", username: "a", online: true },
    ]);
    const wrapper = mountComponent(true);
    await enterRoom(wrapper);
    expect(wrapper.find(".member-dot").classes()).toContain("online");
  });

  it("15s 自动刷新：setInterval 注册并在触发时再次拉取数据", async () => {
    studyRoomApi.studyRoomCreate.mockResolvedValue({ id: "abc", name: "R" });
    const wrapper = mountComponent(true);
    await enterRoom(wrapper);
    // 进入房间时已刷新一次
    expect(studyRoomApi.studyRoomGetMembers).toHaveBeenCalledTimes(1);
    // setInterval 应以 5000ms（纯心跳）和 15000ms（数据刷新）注册
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 15000);
    // 手动触发 15000ms 刷新定时器回调模拟 15s 后刷新
    const refreshCallback = setIntervalSpy.mock.calls.find((c) => c[1] === 15000)![0] as () => void;
    refreshCallback();
    await flushPromises();
    expect(studyRoomApi.studyRoomGetMembers).toHaveBeenCalledTimes(2);
    expect(studyRoomApi.studyRoomGetRanking).toHaveBeenCalledTimes(2);
  });

  it("创建时名称为空显示 toast 提示（按钮禁用）", async () => {
    const wrapper = mountComponent(true);
    await clickCreateCard(wrapper);
    // 名称空时创建按钮禁用
    const createBtn = wrapper.find(".study-create .btn-primary");
    expect(createBtn.attributes("disabled")).toBeDefined();
  });

  it("WS room:members 推送后渲染成员列表（覆盖乐观的自己）", async () => {
    const wrapper = mountComponent(true);
    await enterRoom(wrapper);
    // 推送前乐观显示自己
    expect(wrapper.text()).toContain("me");
    await fireWs({
      type: "room:members",
      members: [
        { userId: "u-1", username: "alice", online: true },
        { userId: "u-2", username: "bob", online: false },
      ],
    });
    const items = wrapper.findAll(".member-item");
    expect(items).toHaveLength(2);
    expect(wrapper.text()).toContain("alice");
    expect(wrapper.text()).toContain("bob");
  });

  it("WS room:member_joined 追加成员（重复 userId 不重复添加）", async () => {
    const wrapper = mountComponent(true);
    await enterRoom(wrapper);
    await fireWs({ type: "room:member_joined", user: { id: "u-1", username: "carol" } });
    expect(wrapper.text()).toContain("carol");
    // 乐观的自己 + carol = 2；重复 joined 不再添加
    await fireWs({ type: "room:member_joined", user: { id: "u-1", username: "carol" } });
    expect(wrapper.findAll(".member-item")).toHaveLength(2);
    expect(wrapper.findAll(".member-name").filter((e) => e.text() === "carol")).toHaveLength(1);
  });

  it("WS room:member_left 移除成员", async () => {
    const wrapper = mountComponent(true);
    await enterRoom(wrapper);
    await fireWs({
      type: "room:members",
      members: [
        { userId: "u-1", username: "alice", online: true },
        { userId: "u-2", username: "bob", online: true },
      ],
    });
    expect(wrapper.findAll(".member-item")).toHaveLength(2);
    await fireWs({ type: "room:member_left", user_id: "u-1" });
    expect(wrapper.findAll(".member-item")).toHaveLength(1);
    expect(wrapper.text()).toContain("bob");
    expect(wrapper.text()).not.toContain("alice");
  });

  it("WS room:pomo_done 触发排名刷新", async () => {
    const wrapper = mountComponent(true);
    await enterRoom(wrapper);
    const rankCallsBefore = studyRoomApi.studyRoomGetRanking.mock.calls.length;
    await fireWs({ type: "room:pomo_done", user_id: "u-1", username: "alice", mode: "focus" });
    expect(studyRoomApi.studyRoomGetRanking.mock.calls.length).toBeGreaterThan(
      rankCallsBefore,
    );
  });

  it("成员状态文案：focusing 显示『专注中』，short_break 显示『短休息』", async () => {
    const wrapper = mountComponent(true);
    await enterRoom(wrapper);
    await fireWs({
      type: "room:members",
      members: [
        { userId: "u-1", username: "alice", online: true, status: "focusing" },
        { userId: "u-2", username: "bob", online: true, status: "short_break" },
      ],
    });
    expect(wrapper.text()).toContain("专注中");
    expect(wrapper.text()).toContain("短休息");
    // 状态徽标带对应 class
    expect(wrapper.find(".member-status.status-focusing").exists()).toBe(true);
    expect(wrapper.find(".member-status.status-short_break").exists()).toBe(true);
  });

  it("WS room:member_status 实时更新状态文案", async () => {
    const wrapper = mountComponent(true);
    await enterRoom(wrapper);
    // 新成员默认空闲
    await fireWs({ type: "room:member_joined", user: { id: "u-1", username: "alice" } });
    expect(wrapper.text()).toContain("空闲");
    // 推送状态更新 → alice 文案切换为长休息（me 仍是空闲，不影响 alice 断言）
    await fireWs({ type: "room:member_status", user_id: "u-1", status: "long_break" });
    expect(wrapper.text()).toContain("长休息");
    const aliceItem = wrapper
      .findAll(".member-item")
      .find((e) => e.text().includes("alice"));
    expect(aliceItem?.text()).toContain("长休息");
    expect(aliceItem?.text()).not.toContain("空闲");
  });

  it("主视图收到 room:members 时缓存而非渲染（pendingMembers）", async () => {
    const wrapper = mountComponent(true);
    await fireWs({
      type: "room:members",
      members: [{ userId: "u-1", username: "alice", online: true }],
    });
    // 主视图，未进入房间 → 不渲染成员
    expect(wrapper.find(".member-item").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("alice");
  });

  it("加入流程中服务器推送的成员列表不丢失（修复在线成员为空的根因）", async () => {
    // 模拟 join 请求挂起：服务器在 join 请求发出后立即广播 room:members，
    // 此时客户端仍处于加入视图（currentRoom 为 null）
    let resolveJoin!: () => void;
    studyRoomApi.studyRoomJoin.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveJoin = resolve;
        }),
    );
    const wrapper = mountComponent(true);
    await clickJoinCard(wrapper);
    await flushPromises();
    await wrapper
      .find(".study-join .input-with-btn input.form-input")
      .setValue("room-id-xyz");
    await wrapper.find(".study-join .input-with-btn .btn-primary").trigger("click");
    await flushPromises();
    // join 尚未完成，成员推送先到达 → 缓存
    await fireWs({
      type: "room:members",
      members: [
        { userId: "u-1", username: "alice", online: true },
        { userId: "u-2", username: "bob", online: false },
      ],
    });
    expect(wrapper.find(".member-item").exists()).toBe(false);
    // join 完成进入房间 → 缓存成员被应用，不再显示『暂无在线成员』
    resolveJoin();
    await flushPromises();
    expect(wrapper.find(".study-room").exists()).toBe(true);
    expect(wrapper.findAll(".member-item")).toHaveLength(2);
    expect(wrapper.text()).toContain("alice");
    expect(wrapper.text()).toContain("bob");
    expect(wrapper.text()).not.toContain("暂无在线成员");
  });

  it("房主可见删除按钮，点击调用 studyRoomDelete 并回到主视图", async () => {
    studyRoomApi.studyRoomGetDetail.mockResolvedValue({
      id: "abcdefgh",
      name: "R",
      ownerId: "me-1",
    });
    const wrapper = mountComponent(true);
    await enterRoom(wrapper);
    expect(wrapper.find(".btn-danger-outline").exists()).toBe(true);
    await wrapper.find(".btn-danger-outline").trigger("click");
    await flushPromises();
    expect(studyRoomApi.studyRoomDelete).toHaveBeenCalledWith("abcdefgh");
    expect(studyRoomApi.studyRoomLeave).not.toHaveBeenCalled();
    expect(wrapper.find(".study-main").exists()).toBe(true);
    expect(wrapper.emitted("left")).toBeTruthy();
    expect(musicMock.setSyncEnabled).toHaveBeenCalledWith(false);
  });

  it("非房主不显示删除按钮", async () => {
    studyRoomApi.studyRoomGetDetail.mockResolvedValue({
      id: "abcdefgh",
      name: "R",
      ownerId: "other-1",
    });
    const wrapper = mountComponent(true);
    await enterRoom(wrapper);
    expect(wrapper.find(".btn-danger-outline").exists()).toBe(false);
  });

  it("房间视图显示同步听歌面板，点击开关调用 setSyncEnabled", async () => {
    const wrapper = mountComponent(true);
    await enterRoom(wrapper);
    expect(wrapper.text()).toContain("同步听歌");
    expect(wrapper.text()).toContain("未开启");
    await wrapper.find(".sync-row .btn-secondary").trigger("click");
    expect(musicMock.setSyncEnabled).toHaveBeenCalledWith(true);
  });

  it("同步开启且我是 DJ 时显示 DJ 提示", async () => {
    musicMock.syncEnabled = true;
    musicMock.isDj = true;
    const wrapper = mountComponent(true);
    await enterRoom(wrapper);
    expect(wrapper.text()).toContain("已开启");
    expect(wrapper.text()).toContain("你是 DJ");
    expect(wrapper.find(".sync-dj-btn").exists()).toBe(false);
  });

  it("同步开启且非 DJ 时显示申请按钮，点击调用 requestDj", async () => {
    musicMock.syncEnabled = true;
    musicMock.isDj = false;
    musicMock.djName = "bob";
    const wrapper = mountComponent(true);
    await enterRoom(wrapper);
    expect(wrapper.text()).toContain("已开启");
    expect(wrapper.text()).toContain("bob");
    await wrapper.find(".sync-dj-btn").trigger("click");
    expect(musicMock.requestDj).toHaveBeenCalledTimes(1);
  });

  it("创建私密房间：选私密并填密码后带密码创建", async () => {
    const wrapper = mountComponent(true);
    await clickCreateCard(wrapper);
    await wrapper.find(".study-create input.form-input").setValue("秘密自习室");
    // 默认公开；切到私密后出现密码输入框
    expect(wrapper.find(".privacy-option").exists()).toBe(true);
    await wrapper.findAll(".privacy-option")[1].trigger("click");
    await wrapper.find(".study-create input[type=password]").setValue("8888");
    await wrapper.find(".study-create .btn-primary").trigger("click");
    await flushPromises();
    expect(studyRoomApi.studyRoomCreate).toHaveBeenCalledWith("秘密自习室", "", "8888");
    expect(wrapper.find(".study-room").exists()).toBe(true);
  });

  it("通过 ID 加入需要密码的房间：先提示密码输入，再带密码加入", async () => {
    studyRoomApi.studyRoomGetDetail.mockResolvedValue({
      id: "secret-room",
      name: "秘密自习室",
      hasPassword: true,
      isPublic: false,
    });
    const wrapper = mountComponent(true);
    await clickJoinCard(wrapper);
    await flushPromises();
    await wrapper
      .find(".study-join .input-with-btn input.form-input")
      .setValue("secret-room");
    await wrapper.find(".study-join .input-with-btn .btn-primary").trigger("click");
    await flushPromises();
    // 第一次：需要密码，未直接加入
    expect(studyRoomApi.studyRoomJoin).not.toHaveBeenCalled();
    expect(wrapper.find(".join-pw-group").exists()).toBe(true);
    // 输入密码后加入
    await wrapper.find(".join-pw-group input[type=password]").setValue("8888");
    await wrapper.find(".study-join .input-with-btn .btn-primary").trigger("click");
    await flushPromises();
    expect(studyRoomApi.studyRoomJoin).toHaveBeenCalledWith("secret-room", "8888");
    expect(wrapper.find(".study-room").exists()).toBe(true);
  });

  it("房主可切换公开/私密并调用 studyRoomUpdate", async () => {
    studyRoomApi.studyRoomGetDetail.mockResolvedValue({
      id: "abcdefgh",
      name: "R",
      ownerId: "me-1",
      isPublic: true,
      hasPassword: false,
    });
    const wrapper = mountComponent(true);
    await enterRoom(wrapper);
    expect(wrapper.find(".owner-panel").exists()).toBe(true);
    // 当前公开 → 点击切换为私密
    await wrapper.find(".owner-panel-row .btn-secondary").trigger("click");
    await flushPromises();
    expect(studyRoomApi.studyRoomUpdate).toHaveBeenCalledWith("abcdefgh", {
      isPublic: false,
    });
  });

  it("房主可设置加入密码", async () => {
    studyRoomApi.studyRoomGetDetail.mockResolvedValue({
      id: "abcdefgh",
      name: "R",
      ownerId: "me-1",
      isPublic: true,
      hasPassword: false,
    });
    const wrapper = mountComponent(true);
    await enterRoom(wrapper);
    // 打开密码设置输入
    const pwBtn = wrapper.findAll(".owner-panel-row .btn-secondary");
    await pwBtn[1].trigger("click");
    await wrapper.find(".owner-panel-pw input[type=password]").setValue("1234");
    await wrapper.find(".owner-panel-pw .btn-primary").trigger("click");
    await flushPromises();
    expect(studyRoomApi.studyRoomUpdate).toHaveBeenCalledWith("abcdefgh", {
      password: "1234",
    });
  });

  it("非房主不显示房主管理面板", async () => {
    studyRoomApi.studyRoomGetDetail.mockResolvedValue({
      id: "abcdefgh",
      name: "R",
      ownerId: "other-1",
      isPublic: true,
    });
    const wrapper = mountComponent(true);
    await enterRoom(wrapper);
    expect(wrapper.find(".owner-panel").exists()).toBe(false);
  });

  it("主视图顶部显示自习室介绍区", () => {
    const wrapper = mountComponent(true);
    expect(wrapper.find(".study-hero").exists()).toBe(true);
    expect(wrapper.text()).toContain("一起自习，效率翻倍");
  });

  it("加入视图公开房间列表无独立滚动条（room-list 不设 max-height）", async () => {
    studyRoomApi.studyRoomGetActive.mockResolvedValue([
      { id: "abc", name: "R1", isPublic: true },
      { id: "def", name: "R2", isPublic: true },
    ]);
    const wrapper = mountComponent(true);
    await clickJoinCard(wrapper);
    await flushPromises();
    const list = wrapper.find(".room-list");
    expect(list.exists()).toBe(true);
    expect(list.attributes("style") || "").not.toContain("max-height");
    expect(list.findAll(".room-list-item")).toHaveLength(2);
  });

  it("组件卸载时取消 ws-event / ws-disconnected 监听", async () => {
    const unlistenSpy = vi.fn();
    eventListenMock.mockImplementation(() => Promise.resolve(unlistenSpy));
    const wrapper = mountComponent(true);
    await flushPromises();
    // 组件挂载时注册了 ws-event + ws-disconnected 监听
    expect(eventListenMock).toHaveBeenCalledWith("ws-event", expect.any(Function));
    expect(eventListenMock).toHaveBeenCalledWith("ws-disconnected", expect.any(Function));
    wrapper.unmount();
    await flushPromises();
    // 卸载时应调用 unlisten 清理两个监听
    expect(unlistenSpy).toHaveBeenCalledTimes(2);
  });
});
