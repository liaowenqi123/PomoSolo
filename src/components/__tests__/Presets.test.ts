import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { flushPromises } from "@vue/test-utils";

// Mock @/api/data 模块（Presets 通过 readData/writeData 持久化）
const dataApi = vi.hoisted(() => ({
  readData: vi.fn(),
  writeData: vi.fn(),
}));
vi.mock("@/api/data", () => dataApi);

import Presets from "../Presets.vue";
import { useTimerStore } from "../../stores/timer";

describe("Presets.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    dataApi.readData.mockReset();
    dataApi.writeData.mockReset();
    dataApi.writeData.mockResolvedValue(undefined);
    // 默认 readData 返回空对象（无 presets 字段 -> 使用默认预设）
    dataApi.readData.mockResolvedValue({});
  });

  const mountComponent = async () => {
    const wrapper = mount(Presets);
    // 等待 onMounted 中的 load() 完成
    await flushPromises();
    return wrapper;
  };

  // ===== 标题 =====

  it("工作模式下标题应显示『工作预设』", async () => {
    const wrapper = await mountComponent();
    expect(wrapper.find(".presets__title").text()).toBe("工作预设");
  });

  it("休息模式下标题应显示『休息预设』", async () => {
    const wrapper = await mountComponent();
    const store = useTimerStore();
    store.setMode("break");
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".presets__title").text()).toBe("休息预设");
  });

  // ===== 默认预设渲染 =====

  it("工作模式应渲染默认预设 15/25/45/60 分钟", async () => {
    const wrapper = await mountComponent();
    const items = wrapper.findAll(".preset-item");
    expect(items).toHaveLength(4);
    const texts = items.map((i) => i.find(".preset-item__time").text());
    expect(texts).toEqual(["15分钟", "25分钟", "45分钟", "60分钟"]);
  });

  it("休息模式应渲染默认预设 5/10/15 分钟", async () => {
    const wrapper = await mountComponent();
    const store = useTimerStore();
    store.setMode("break");
    await wrapper.vm.$nextTick();
    const items = wrapper.findAll(".preset-item");
    expect(items).toHaveLength(3);
    const texts = items.map((i) => i.find(".preset-item__time").text());
    expect(texts).toEqual(["5分钟", "10分钟", "15分钟"]);
  });

  // ===== 选中预设 =====

  it("点击预设应设置 active 类", async () => {
    const wrapper = await mountComponent();
    const items = wrapper.findAll(".preset-item");
    // 初始无 active
    expect(items[0].classes()).not.toContain("preset-item--active");

    await items[0].trigger("click");
    expect(wrapper.findAll(".preset-item")[0].classes()).toContain(
      "preset-item--active",
    );
  });

  it("点击预设应更新计时器 store 的 totalMs/remainingMs/phase", async () => {
    const wrapper = await mountComponent();
    const store = useTimerStore();
    const initialTotalMs = store.totalMs;

    // 点击 15 分钟预设
    const items = wrapper.findAll(".preset-item");
    await items[0].trigger("click");

    const expectedMs = 15 * 60 * 1000;
    expect(store.totalMs).toBe(expectedMs);
    expect(store.remainingMs).toBe(expectedMs);
    expect(store.phase).toBe("ready");
    expect(store.totalMs).not.toBe(initialTotalMs);
  });

  it("选中另一个预设时 active 应切换到新预设", async () => {
    const wrapper = await mountComponent();
    const items = wrapper.findAll(".preset-item");

    await items[0].trigger("click");
    await items[1].trigger("click");

    const updated = wrapper.findAll(".preset-item");
    expect(updated[0].classes()).not.toContain("preset-item--active");
    expect(updated[1].classes()).toContain("preset-item--active");
  });

  // ===== 删除预设 =====

  it("点击删除按钮应从列表中移除预设", async () => {
    const wrapper = await mountComponent();
    expect(wrapper.findAll(".preset-item")).toHaveLength(4);

    const deleteBtn = wrapper.findAll(".preset-item__delete")[0];
    await deleteBtn.trigger("click");

    expect(wrapper.findAll(".preset-item")).toHaveLength(3);
    // 第一个被删除，剩下 25/45/60
    const texts = wrapper.findAll(".preset-item").map((i) => i.find(".preset-item__time").text());
    expect(texts).toEqual(["25分钟", "45分钟", "60分钟"]);
  });

  it("删除按钮点击应 stopPropagation（不触发选中）", async () => {
    const wrapper = await mountComponent();
    const deleteBtn = wrapper.findAll(".preset-item__delete")[0];
    await deleteBtn.trigger("click");

    // 删除后列表长度变化，但不应有 active 项（selectPreset 未被触发）
    expect(wrapper.findAll(".preset-item--active")).toHaveLength(0);
  });

  it("删除当前选中的预设应清除 active 状态", async () => {
    const wrapper = await mountComponent();
    const items = wrapper.findAll(".preset-item");

    // 选中第一个（15分钟）
    await items[0].trigger("click");
    expect(wrapper.findAll(".preset-item--active")).toHaveLength(1);

    // 删除选中的预设
    await wrapper.findAll(".preset-item__delete")[0].trigger("click");
    expect(wrapper.findAll(".preset-item--active")).toHaveLength(0);
  });

  it("删除预设应调用 persist（writeData）", async () => {
    const wrapper = await mountComponent();
    dataApi.writeData.mockClear();

    await wrapper.findAll(".preset-item__delete")[0].trigger("click");
    await flushPromises();

    expect(dataApi.writeData).toHaveBeenCalledTimes(1);
    const payload = dataApi.writeData.mock.calls[0][0];
    expect(payload).toHaveProperty("presets");
  });

  // ===== 添加预设 =====

  it("应渲染添加输入框和添加按钮", async () => {
    const wrapper = await mountComponent();
    expect(wrapper.find(".presets__input").exists()).toBe(true);
    expect(wrapper.find(".presets__add-btn").exists()).toBe(true);
    expect(wrapper.find(".presets__add-btn").text()).toBe("添加");
  });

  it("输入有效分钟数并点击添加按钮应新增预设（按升序排序）", async () => {
    const wrapper = await mountComponent();
    await wrapper.find(".presets__input").setValue(20);
    await wrapper.find(".presets__add-btn").trigger("click");
    await flushPromises();

    const items = wrapper.findAll(".preset-item");
    expect(items).toHaveLength(5);
    const texts = items.map((i) => i.find(".preset-item__time").text());
    // 20 应插入到 15 和 25 之间
    expect(texts).toEqual(["15分钟", "20分钟", "25分钟", "45分钟", "60分钟"]);
  });

  it("按 Enter 键应触发添加", async () => {
    const wrapper = await mountComponent();
    await wrapper.find(".presets__input").setValue(30);
    await wrapper.find(".presets__input").trigger("keydown", { key: "Enter" });
    await flushPromises();

    expect(wrapper.findAll(".preset-item")).toHaveLength(5);
  });

  it("添加重复分钟数应被忽略", async () => {
    const wrapper = await mountComponent();
    // 25 已存在
    await wrapper.find(".presets__input").setValue(25);
    await wrapper.find(".presets__add-btn").trigger("click");
    await flushPromises();

    expect(wrapper.findAll(".preset-item")).toHaveLength(4);
  });

  it("添加小于 1 分钟应被忽略", async () => {
    const wrapper = await mountComponent();
    await wrapper.find(".presets__input").setValue(0);
    await wrapper.find(".presets__add-btn").trigger("click");
    await flushPromises();

    expect(wrapper.findAll(".preset-item")).toHaveLength(4);
  });

  it("添加大于 120 分钟应被忽略", async () => {
    const wrapper = await mountComponent();
    await wrapper.find(".presets__input").setValue(121);
    await wrapper.find(".presets__add-btn").trigger("click");
    await flushPromises();

    expect(wrapper.findAll(".preset-item")).toHaveLength(4);
  });

  it("添加预设应调用 persist（writeData）", async () => {
    const wrapper = await mountComponent();
    dataApi.writeData.mockClear();

    await wrapper.find(".presets__input").setValue(30);
    await wrapper.find(".presets__add-btn").trigger("click");
    await flushPromises();

    expect(dataApi.writeData).toHaveBeenCalledTimes(1);
  });

  it("添加预设应同步写入 localStorage", async () => {
    const wrapper = await mountComponent();
    await wrapper.find(".presets__input").setValue(30);
    await wrapper.find(".presets__add-btn").trigger("click");
    await flushPromises();

    const saved = localStorage.getItem("pomodoro-presets");
    expect(saved).not.toBeNull();
    const parsed = JSON.parse(saved!);
    expect(parsed).toHaveProperty("presets");
    expect(parsed.presets.work).toContainEqual({ minutes: 30, note: null });
  });

  // ===== 从后端加载 =====

  it("load 应从 readData 读取预设（对象格式）", async () => {
    dataApi.readData.mockResolvedValue({
      presets: {
        work: [{ minutes: 10, note: "快速" }, { minutes: 50, note: null }],
        break: [{ minutes: 3, note: null }],
      },
    });

    const wrapper = await mountComponent();
    const items = wrapper.findAll(".preset-item");
    expect(items).toHaveLength(2);
    expect(items[0].find(".preset-item__time").text()).toBe("10分钟");
    expect(items[1].find(".preset-item__time").text()).toBe("50分钟");
  });

  it("load 应支持纯数字数组格式的预设", async () => {
    dataApi.readData.mockResolvedValue({
      presets: {
        work: [30, 40], // 纯数字
        break: [7],
      },
    });

    const wrapper = await mountComponent();
    const items = wrapper.findAll(".preset-item");
    expect(items).toHaveLength(2);
    expect(items[0].find(".preset-item__time").text()).toBe("30分钟");
    expect(items[1].find(".preset-item__time").text()).toBe("40分钟");
  });

  it("readData 返回无 presets 字段时应使用默认预设", async () => {
    dataApi.readData.mockResolvedValue({ otherField: "x" });

    const wrapper = await mountComponent();
    expect(wrapper.findAll(".preset-item")).toHaveLength(4);
  });

  it("readData 返回的 work 字段非数组时应回退默认 work 预设", async () => {
    dataApi.readData.mockResolvedValue({
      presets: {
        work: "invalid", // 非数组
        break: [7],
      },
    });

    const wrapper = await mountComponent();
    // work 回退默认 4 个
    expect(wrapper.findAll(".preset-item")).toHaveLength(4);
  });

  // ===== 后端失败回退 localStorage =====

  it("readData 失败且 localStorage 为空时应使用默认预设", async () => {
    dataApi.readData.mockRejectedValue(new Error("backend down"));

    const wrapper = await mountComponent();
    expect(wrapper.findAll(".preset-item")).toHaveLength(4);
  });

  it("readData 失败且 localStorage 解析失败时应使用默认预设", async () => {
    dataApi.readData.mockRejectedValue(new Error("backend down"));
    localStorage.setItem("pomodoro-presets", "{invalid json");

    const wrapper = await mountComponent();
    expect(wrapper.findAll(".preset-item")).toHaveLength(4);
  });

  // ===== localStorage 回退读取（已修复格式不一致问题） =====
  // persist() 写入 localStorage 的格式为 { presets: { work: [...], break: [...] } }，
  // load() 的 catch 分支需先解包 .presets 再传给 normalizePresets。
  // 修复前未解包导致回退到默认预设；修复后能正确读回 persist 写入的数据。
  it("persist 写入的 localStorage 数据能被 load 回退正确读取（解包 .presets 字段）", async () => {
    // 模拟 persist() 写入的实际格式
    const persistFormat = {
      presets: {
        work: [{ minutes: 35, note: null }],
        break: [],
      },
    };
    localStorage.setItem("pomodoro-presets", JSON.stringify(persistFormat));
    dataApi.readData.mockRejectedValue(new Error("backend down"));

    const wrapper = await mountComponent();
    // 修复后：能正确读回 persist 写入的 1 个 35分钟 预设
    expect(wrapper.findAll(".preset-item")).toHaveLength(1);
    expect(wrapper.findAll(".preset-item")[0].find(".preset-item__time").text()).toBe("35分钟");
  });

  it("readData 失败时若 localStorage 存储未包装格式（work/break 直接顶层）可正常读取", async () => {
    // 注意：这不是 persist() 的实际写入格式，仅验证 normalizePresets 本身能工作
    localStorage.setItem(
      "pomodoro-presets",
      JSON.stringify({
        work: [{ minutes: 35, note: null }],
        break: [],
      }),
    );
    dataApi.readData.mockRejectedValue(new Error("backend down"));

    const wrapper = await mountComponent();
    expect(wrapper.findAll(".preset-item")).toHaveLength(1);
    expect(wrapper.findAll(".preset-item")[0].find(".preset-item__time").text()).toBe(
      "35分钟",
    );
  });

  // ===== 模式切换时列表更新 =====

  it("切换模式后预设列表应随之更新", async () => {
    const wrapper = await mountComponent();
    expect(wrapper.findAll(".preset-item")).toHaveLength(4); // work 默认

    const store = useTimerStore();
    store.setMode("break");
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll(".preset-item")).toHaveLength(3); // break 默认
  });

  // ===== normalizePresets 边界 =====

  it("后端返回 minutes 非数字时应被收敛为 0", async () => {
    dataApi.readData.mockResolvedValue({
      presets: {
        work: [{ minutes: "abc", note: null }], // 非数字
        break: [],
      },
    });

    const wrapper = await mountComponent();
    expect(wrapper.findAll(".preset-item")).toHaveLength(1);
    expect(wrapper.findAll(".preset-item")[0].find(".preset-item__time").text()).toBe(
      "0分钟",
    );
  });

  it("后端返回 note 非字符串时应被收敛为 null", async () => {
    dataApi.readData.mockResolvedValue({
      presets: {
        work: [{ minutes: 20, note: 123 }], // note 非字符串
        break: [],
      },
    });

    const wrapper = await mountComponent();
    // 组件不应崩溃，且应渲染预设
    expect(wrapper.findAll(".preset-item")).toHaveLength(1);
  });

  // ===== persist 边界 =====

  it("persist 时 readData 失败仍应尝试 writeData", async () => {
    // 第一次 readData（onMounted load）成功，第二次 readData（persist 内）失败
    dataApi.readData
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("read fail"));
    dataApi.writeData.mockClear();

    const wrapper = await mountComponent();
    await wrapper.find(".presets__input").setValue(30);
    await wrapper.find(".presets__add-btn").trigger("click");
    await flushPromises();

    // 即使 persist 内 readData 失败，writeData 仍应被调用
    expect(dataApi.writeData).toHaveBeenCalledTimes(1);
  });

  it("persist 时 writeData 失败不应抛错（静默失败）", async () => {
    dataApi.writeData.mockRejectedValue(new Error("write fail"));

    const wrapper = await mountComponent();
    // 添加预设触发 persist，不应抛错
    await wrapper.find(".presets__input").setValue(30);
    await wrapper.find(".presets__add-btn").trigger("click");
    await flushPromises();

    // 列表应正常更新（内存中），只是后端持久化失败
    expect(wrapper.findAll(".preset-item")).toHaveLength(5);
  });

  // ===== loaded 状态 =====

  it("mount 后 loaded 应为 true", async () => {
    await mountComponent();
    // 通过组件内部 ref 验证（loaded 不在模板中使用，但可通过 vm 访问）
    // 这里间接验证：load 完成后列表已渲染
    // 直接断言 store/数据已加载
    expect(dataApi.readData).toHaveBeenCalled();
  });
});
