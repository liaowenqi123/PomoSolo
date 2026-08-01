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
}));
vi.mock("@/api/studyRoom", () => studyRoomApi);

import StudyRoom from "../StudyRoom.vue";

describe("StudyRoom.vue", () => {
  let setIntervalSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    Object.values(studyRoomApi).forEach((fn) => fn.mockReset());
    studyRoomApi.studyRoomGetActive.mockResolvedValue([]);
    studyRoomApi.studyRoomCreate.mockResolvedValue({ id: "abcdefgh", name: "R" });
    studyRoomApi.studyRoomJoin.mockResolvedValue(undefined);
    studyRoomApi.studyRoomLeave.mockResolvedValue(undefined);
    studyRoomApi.studyRoomGetRanking.mockResolvedValue([]);
    studyRoomApi.studyRoomGetMembers.mockResolvedValue([]);
    // 拦截 setInterval，避免真实 30s 定时器
    setIntervalSpy = vi.fn(() => 0 as unknown as ReturnType<typeof setInterval>);
    global.setInterval = setIntervalSpy as unknown as typeof setInterval;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mountComponent = (visible = true) =>
    mount(StudyRoom, { props: { visible } });

  it("弹窗标题为『👥 自习室』", () => {
    const wrapper = mountComponent(true);
    expect(wrapper.find(".modal-title").text()).toBe("👥 自习室");
  });

  it("主视图：创建/加入按钮", () => {
    const wrapper = mountComponent(true);
    expect(wrapper.find(".study-main").exists()).toBe(true);
    const btns = wrapper.find(".main-actions").findAll("button");
    expect(btns).toHaveLength(2);
    expect(btns[0].text()).toBe("创建自习室");
    expect(btns[1].text()).toBe("加入自习室");
  });

  it("点击创建按钮切换到创建视图", async () => {
    const wrapper = mountComponent(true);
    await wrapper.find(".main-actions .btn-primary").trigger("click");
    expect(wrapper.find(".study-create").exists()).toBe(true);
    expect(wrapper.find(".study-create input.form-input").exists()).toBe(true);
    expect(wrapper.find(".study-create .form-textarea").exists()).toBe(true);
    expect(wrapper.find(".study-create .btn-secondary").text()).toBe("取消");
    expect(wrapper.find(".study-create .btn-primary").text()).toBe("创建");
  });

  it("点击加入按钮切换到加入视图", async () => {
    const wrapper = mountComponent(true);
    await wrapper.find(".main-actions .btn-secondary").trigger("click");
    await flushPromises();
    expect(wrapper.find(".study-join").exists()).toBe(true);
    expect(wrapper.find(".study-join input.form-input").exists()).toBe(true);
    expect(wrapper.find(".study-join .input-with-btn .btn-primary").text()).toBe("加入");
    expect(wrapper.find(".study-join .form-actions .btn-secondary").text()).toBe("返回");
  });

  it("点击取消/返回回到主视图", async () => {
    const wrapper = mountComponent(true);
    // 创建视图取消
    await wrapper.find(".main-actions .btn-primary").trigger("click");
    await wrapper.find(".study-create .btn-secondary").trigger("click");
    expect(wrapper.find(".study-main").exists()).toBe(true);
    // 加入视图返回
    await wrapper.find(".main-actions .btn-secondary").trigger("click");
    await flushPromises();
    await wrapper.find(".study-join .form-actions .btn-secondary").trigger("click");
    expect(wrapper.find(".study-main").exists()).toBe(true);
  });

  it("创建自习室：调用 studyRoomCreate 后进入房间视图并 emit joined", async () => {
    const wrapper = mountComponent(true);
    await wrapper.find(".main-actions .btn-primary").trigger("click");
    await wrapper.find(".study-create input.form-input").setValue("我的自习室");
    await wrapper.find(".study-create textarea.form-textarea").setValue("一起学");
    await wrapper.find(".study-create .btn-primary").trigger("click");
    await flushPromises();
    expect(studyRoomApi.studyRoomCreate).toHaveBeenCalledWith("我的自习室", "一起学");
    expect(studyRoomApi.studyRoomGetMembers).toHaveBeenCalled();
    expect(studyRoomApi.studyRoomGetRanking).toHaveBeenCalled();
    expect(wrapper.find(".study-room").exists()).toBe(true);
    expect(wrapper.emitted("joined")).toBeTruthy();
  });

  it("通过 ID 加入：调用 studyRoomJoin 后进入房间视图", async () => {
    const wrapper = mountComponent(true);
    await wrapper.find(".main-actions .btn-secondary").trigger("click");
    await flushPromises();
    await wrapper.find(".study-join .input-with-btn input.form-input").setValue("room-id-xyz");
    await wrapper.find(".study-join .input-with-btn .btn-primary").trigger("click");
    await flushPromises();
    expect(studyRoomApi.studyRoomJoin).toHaveBeenCalledWith("room-id-xyz");
    expect(wrapper.find(".study-room").exists()).toBe(true);
  });

  it("退出按钮调用 studyRoomLeave、emit left、回到主视图", async () => {
    const wrapper = mountComponent(true);
    await wrapper.find(".main-actions .btn-primary").trigger("click");
    await wrapper.find(".study-create input.form-input").setValue("R");
    await wrapper.find(".study-create .btn-primary").trigger("click");
    await flushPromises();
    expect(wrapper.find(".study-room").exists()).toBe(true);
    await wrapper.find(".room-header .btn-danger").trigger("click");
    await flushPromises();
    expect(studyRoomApi.studyRoomLeave).toHaveBeenCalled();
    expect(wrapper.emitted("left")).toBeTruthy();
    expect(wrapper.find(".study-main").exists()).toBe(true);
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
    await wrapper.find(".main-actions .btn-secondary").trigger("click");
    await flushPromises();
    expect(wrapper.find(".study-toast").exists()).toBe(true);
    expect(wrapper.find(".study-toast").text()).toContain("获取自习室列表失败");
  });

  it("shortId: ID 长度 >8 截断并加『…』", async () => {
    studyRoomApi.studyRoomGetActive.mockResolvedValue([
      { id: "abcdefghijk", name: "R" },
    ]);
    const wrapper = mountComponent(true);
    await wrapper.find(".main-actions .btn-secondary").trigger("click");
    await flushPromises();
    expect(wrapper.find(".room-list-meta").text()).toContain("abcdefgh…");
  });

  it("shortId: ID 长度 ≤8 不截断", async () => {
    studyRoomApi.studyRoomGetActive.mockResolvedValue([
      { id: "abc", name: "R" },
    ]);
    const wrapper = mountComponent(true);
    await wrapper.find(".main-actions .btn-secondary").trigger("click");
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
    await wrapper.find(".main-actions .btn-primary").trigger("click");
    await wrapper.find(".study-create input.form-input").setValue("R");
    await wrapper.find(".study-create .btn-primary").trigger("click");
    await flushPromises();
    const times = wrapper.findAll(".ranking-time").map((e) => e.text());
    expect(times).toContain("30 分钟");
    expect(times).toContain("1 小时 30 分钟");
    expect(times).toContain("1 小时");
  });

  it("空排名显示占位", async () => {
    studyRoomApi.studyRoomCreate.mockResolvedValue({ id: "abc", name: "R" });
    studyRoomApi.studyRoomGetRanking.mockResolvedValue([]);
    const wrapper = mountComponent(true);
    await wrapper.find(".main-actions .btn-primary").trigger("click");
    await wrapper.find(".study-create input.form-input").setValue("R");
    await wrapper.find(".study-create .btn-primary").trigger("click");
    await flushPromises();
    expect(wrapper.find(".ranking-list").exists()).toBe(false);
    expect(wrapper.text()).toContain("暂无排名数据");
  });

  it("空成员显示占位", async () => {
    studyRoomApi.studyRoomCreate.mockResolvedValue({ id: "abc", name: "R" });
    studyRoomApi.studyRoomGetMembers.mockResolvedValue([]);
    const wrapper = mountComponent(true);
    await wrapper.find(".main-actions .btn-primary").trigger("click");
    await wrapper.find(".study-create input.form-input").setValue("R");
    await wrapper.find(".study-create .btn-primary").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("暂无在线成员");
  });

  it("在线成员有 .online 类", async () => {
    studyRoomApi.studyRoomCreate.mockResolvedValue({ id: "abc", name: "R" });
    studyRoomApi.studyRoomGetMembers.mockResolvedValue([
      { userId: "u-1", username: "a", online: true },
    ]);
    const wrapper = mountComponent(true);
    await wrapper.find(".main-actions .btn-primary").trigger("click");
    await wrapper.find(".study-create input.form-input").setValue("R");
    await wrapper.find(".study-create .btn-primary").trigger("click");
    await flushPromises();
    expect(wrapper.find(".member-dot").classes()).toContain("online");
  });

  it("30s 自动刷新：setInterval 注册并在触发时再次拉取数据", async () => {
    studyRoomApi.studyRoomCreate.mockResolvedValue({ id: "abc", name: "R" });
    const wrapper = mountComponent(true);
    await wrapper.find(".main-actions .btn-primary").trigger("click");
    await wrapper.find(".study-create input.form-input").setValue("R");
    await wrapper.find(".study-create .btn-primary").trigger("click");
    await flushPromises();
    // 进入房间时已刷新一次
    expect(studyRoomApi.studyRoomGetMembers).toHaveBeenCalledTimes(1);
    // setInterval 应以 30000ms 注册
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30000);
    // 手动触发定时器回调模拟 30s 后刷新
    const refreshCallback = setIntervalSpy.mock.calls[0][0] as () => void;
    refreshCallback();
    await flushPromises();
    expect(studyRoomApi.studyRoomGetMembers).toHaveBeenCalledTimes(2);
    expect(studyRoomApi.studyRoomGetRanking).toHaveBeenCalledTimes(2);
  });

  it("创建时名称为空显示 toast 提示（按钮禁用）", async () => {
    const wrapper = mountComponent(true);
    await wrapper.find(".main-actions .btn-primary").trigger("click");
    // 名称空时创建按钮禁用
    const createBtn = wrapper.find(".study-create .btn-primary");
    expect(createBtn.attributes("disabled")).toBeDefined();
  });
});
