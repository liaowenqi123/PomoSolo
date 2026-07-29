import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";

// Mock garden store
vi.mock("@/stores/garden", () => ({
  CROP_CONFIG: {
    carrot: { name: "胡萝卜", growTime: 25, icon: "🥕", seedType: "carrot", rarity: "common", value: 10, seedPrice: 8, sellPrice: 10 },
    tomato: { name: "番茄", growTime: 50, icon: "🍅", seedType: "tomato", rarity: "common", value: 20, seedPrice: 16, sellPrice: 20 },
    sunflower: { name: "向日葵", growTime: 90, icon: "🌻", seedType: "sunflower", rarity: "rare", value: 50, seedPrice: 40, sellPrice: 50 },
    rose: { name: "玫瑰", growTime: 120, icon: "🌹", seedType: "rose", rarity: "rare", value: 80, seedPrice: 64, sellPrice: 80 },
    osmanthus: { name: "金桂树", growTime: 180, icon: "🌳", seedType: "osmanthus", rarity: "legend", value: 150, seedPrice: 120, sellPrice: 150 },
  },
  CROP_ORDER: ["carrot", "tomato", "sunflower", "rose", "osmanthus"],
}));

import GardenPlantWheel from "../garden/GardenPlantWheel.vue";

// Canvas 2D 上下文 stub
const ctxStub = {
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  arc: vi.fn(),
  closePath: vi.fn(),
  fill: vi.fn(),
  fillText: vi.fn(),
  fillStyle: "",
  font: "",
  textAlign: "",
  textBaseline: "",
  shadowBlur: 0,
  shadowColor: "",
};

describe("GardenPlantWheel.vue", () => {
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
  let originalGetBoundingClientRect: typeof Element.prototype.getBoundingClientRect;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    // 重置 ctx stub 调用历史
    Object.values(ctxStub).forEach((v) => {
      if (typeof v === "function" && "mockReset" in v) {
        (v as ReturnType<typeof vi.fn>).mockReset();
      }
    });
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ctxStub) as any;

    originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    // 模拟一个 200x200 的轮盘在 (100,100) 处
    Element.prototype.getBoundingClientRect = function (this: Element) {
      // 对 .plant-wheel 返回已知 rect；其他元素返回 0
      if (this.classList && this.classList.contains("plant-wheel")) {
        return {
          left: 100,
          top: 100,
          width: 200,
          height: 200,
          right: 300,
          bottom: 300,
          x: 100,
          y: 100,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return {
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        right: 0,
        bottom: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    } as any;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  const mountComponent = (props: {
    visible: boolean;
    x?: number;
    y?: number;
    seeds?: Record<string, number>;
  }) => {
    return mount(GardenPlantWheel, {
      props: {
        visible: props.visible,
        x: props.x ?? 200,
        y: props.y ?? 200,
        seeds: props.seeds ?? { carrot: 5, tomato: 0, sunflower: 2, rose: 1, osmanthus: 0 },
      },
    });
  };

  it("visible=false 时不应渲染任何内容", () => {
    const wrapper = mountComponent({ visible: false });
    expect(wrapper.find(".plant-wheel").exists()).toBe(false);
  });

  it("visible=true 时应渲染 .plant-wheel 容器", () => {
    const wrapper = mountComponent({ visible: true });
    expect(wrapper.find(".plant-wheel").exists()).toBe(true);
  });

  it("visible=true 时应渲染 canvas 元素", () => {
    const wrapper = mountComponent({ visible: true });
    expect(wrapper.find("canvas").exists()).toBe(true);
  });

  it("canvas 应有 width/height 属性 (CANVAS_SIZE=500)", () => {
    const wrapper = mountComponent({ visible: true });
    const canvas = wrapper.find("canvas");
    expect(canvas.attributes("width")).toBe("500");
    expect(canvas.attributes("height")).toBe("500");
  });

  it("应有 close 按钮 ✕", () => {
    const wrapper = mountComponent({ visible: true });
    const closeBtn = wrapper.find(".plant-wheel__close");
    expect(closeBtn.exists()).toBe(true);
    expect(closeBtn.text()).toBe("✕");
  });

  it("点击 close 按钮应 emit close", async () => {
    const wrapper = mountComponent({ visible: true });
    const closeBtn = wrapper.find(".plant-wheel__close");
    await closeBtn.trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("visible 切换为 true 时应调用 canvas.getContext('2d')", async () => {
    const wrapper = mountComponent({ visible: false });
    (HTMLCanvasElement.prototype.getContext as any).mockClear();
    await wrapper.setProps({ visible: true });
    await wrapper.vm.$nextTick();
    expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledWith("2d");
  });

  it("visible=true 时应调用 drawWheel（调用 ctx.fillRect/clearRect 等）", async () => {
    const wrapper = mountComponent({ visible: true });
    await wrapper.vm.$nextTick();
    expect(ctxStub.clearRect).toHaveBeenCalled();
    expect(ctxStub.beginPath).toHaveBeenCalled();
    expect(ctxStub.fill).toHaveBeenCalled();
  });

  it("点击 canvas 在有效扇区上应 emit select(seedKey) - 扇区 0 (carrot)", async () => {
    const wrapper = mountComponent({
      visible: true,
      seeds: { carrot: 5, tomato: 0, sunflower: 0, rose: 0, osmanthus: 0 },
    });
    await wrapper.vm.$nextTick();
    const canvas = wrapper.find("canvas");
    // 扇区 0 中心角 -54°，距离中心 50
    // rect: left=100, top=100, width=200, height=200 -> 中心 (200, 200)
    // dx = 50*cos(-54°) ≈ 29.4, dy = 50*sin(-54°) ≈ -40.4
    // clientX ≈ 229.4, clientY ≈ 159.6
    await canvas.trigger("click", { clientX: 229.4, clientY: 159.6 });
    expect(wrapper.emitted("select")).toBeTruthy();
    expect(wrapper.emitted("select")![0]).toEqual(["carrot"]);
  });

  it("点击 canvas 在另一扇区应 emit 对应的 seedKey - 扇区 1 (tomato)", async () => {
    const wrapper = mountComponent({
      visible: true,
      seeds: { carrot: 0, tomato: 3, sunflower: 0, rose: 0, osmanthus: 0 },
    });
    await wrapper.vm.$nextTick();
    const canvas = wrapper.find("canvas");
    // 扇区 1 中心角 0°，距离 50
    // clientX = 200+50 = 250, clientY = 200
    await canvas.trigger("click", { clientX: 250, clientY: 200 });
    expect(wrapper.emitted("select")).toBeTruthy();
    expect(wrapper.emitted("select")![0]).toEqual(["tomato"]);
  });

  it("点击 canvas 在第三个扇区应 emit 对应 seedKey - 扇区 2 (sunflower)", async () => {
    const wrapper = mountComponent({
      visible: true,
      seeds: { carrot: 0, tomato: 0, sunflower: 7, rose: 0, osmanthus: 0 },
    });
    await wrapper.vm.$nextTick();
    const canvas = wrapper.find("canvas");
    // 扇区 2 中心角 90°（下方），距离 50
    // clientX = 200, clientY = 200+50 = 250
    await canvas.trigger("click", { clientX: 200, clientY: 250 });
    expect(wrapper.emitted("select")).toBeTruthy();
    expect(wrapper.emitted("select")![0]).toEqual(["sunflower"]);
  });

  it("点击 canvas 在第四扇区应 emit 对应 seedKey - 扇区 3 (rose)", async () => {
    const wrapper = mountComponent({
      visible: true,
      seeds: { carrot: 0, tomato: 0, sunflower: 0, rose: 4, osmanthus: 0 },
    });
    await wrapper.vm.$nextTick();
    const canvas = wrapper.find("canvas");
    // 扇区 3 中心角 180°（左侧），距离 50
    // clientX = 200-50 = 150, clientY = 200
    await canvas.trigger("click", { clientX: 150, clientY: 200 });
    expect(wrapper.emitted("select")).toBeTruthy();
    expect(wrapper.emitted("select")![0]).toEqual(["rose"]);
  });

  it("点击 canvas 在第五扇区应 emit 对应 seedKey - 扇区 4 (osmanthus)", async () => {
    const wrapper = mountComponent({
      visible: true,
      seeds: { carrot: 0, tomato: 0, sunflower: 0, rose: 0, osmanthus: 6 },
    });
    await wrapper.vm.$nextTick();
    const canvas = wrapper.find("canvas");
    // 扇区 4 中心角 234° = -126°，距离 50
    // dx = 50*cos(-126°) ≈ -29.4, dy = 50*sin(-126°) ≈ -40.4
    // clientX ≈ 170.6, clientY ≈ 159.6
    await canvas.trigger("click", { clientX: 170.6, clientY: 159.6 });
    expect(wrapper.emitted("select")).toBeTruthy();
    expect(wrapper.emitted("select")![0]).toEqual(["osmanthus"]);
  });

  it("点击 canvas 中心区域不应 emit select", async () => {
    const wrapper = mountComponent({
      visible: true,
      seeds: { carrot: 5, tomato: 0, sunflower: 0, rose: 0, osmanthus: 0 },
    });
    await wrapper.vm.$nextTick();
    const canvas = wrapper.find("canvas");
    // 点击中心点 (200, 200)，距离 0，应返回 -1
    await canvas.trigger("click", { clientX: 200, clientY: 200 });
    expect(wrapper.emitted("select")).toBeFalsy();
  });

  it("点击 count=0 的种子扇区不应 emit select", async () => {
    const wrapper = mountComponent({
      visible: true,
      seeds: { carrot: 0, tomato: 0, sunflower: 0, rose: 0, osmanthus: 0 },
    });
    await wrapper.vm.$nextTick();
    const canvas = wrapper.find("canvas");
    // 点击 carrot 扇区，但 count=0
    await canvas.trigger("click", { clientX: 229.4, clientY: 159.6 });
    expect(wrapper.emitted("select")).toBeFalsy();
  });

  it("x, y prop 改变时应更新 .plant-wheel 的 left/top 样式", async () => {
    const wrapper = mountComponent({ visible: true, x: 100, y: 100 });
    await wrapper.vm.$nextTick();
    const wheel = wrapper.find(".plant-wheel");
    const style = wheel.attributes("style") || "";
    // left/top 应该是数值
    expect(style).toMatch(/left:\s*\d+(\.\d+)?px/);
    expect(style).toMatch(/top:\s*\d+(\.\d+)?px/);
  });

  it("位置 left/top 应被约束在合理范围内", async () => {
    // 设置一个超出窗口的位置
    const wrapper = mountComponent({ visible: true, x: -1000, y: -1000 });
    await wrapper.vm.$nextTick();
    const wheel = wrapper.find(".plant-wheel");
    const style = wheel.attributes("style") || "";
    // 提取 left 和 top
    const leftMatch = style.match(/left:\s*(-?\d+(?:\.\d+)?)px/);
    const topMatch = style.match(/top:\s*(-?\d+(?:\.\d+)?)px/);
    expect(leftMatch).not.toBeNull();
    expect(topMatch).not.toBeNull();
    const left = parseFloat(leftMatch![1]);
    const top = parseFloat(topMatch![1]);
    // 应被约束在 [10, window.innerWidth - 200 - 10] 等范围内
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
    // 不应该出现负值
    expect(left).toBeLessThan(window.innerWidth);
    expect(top).toBeLessThan(window.innerHeight);
  });

  it("items 列表应从 CROP_ORDER 派生，包含所有 5 个作物", async () => {
    const wrapper = mountComponent({ visible: true });
    await wrapper.vm.$nextTick();
    // 通过 drawWheel 调用次数间接验证：会绘制 5 个扇形
    expect(ctxStub.arc).toHaveBeenCalled();
    // arc 调用次数应该是 5（扇形）+ 2（中心圈）+ 0 = 7次，但每次 beginPath+arc+fill
    // 至少 5 次
    expect(ctxStub.arc.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it("items 中每个作物的 count 应来自 props.seeds", async () => {
    const wrapper = mountComponent({
      visible: true,
      seeds: { carrot: 7, tomato: 0, sunflower: 0, rose: 0, osmanthus: 0 },
    });
    await wrapper.vm.$nextTick();
    // fillText 调用应包含 "×7" 数量
    const fillTextCalls = ctxStub.fillText.mock.calls.map((c) => String(c[0]));
    expect(fillTextCalls.some((t) => t.includes("×7"))).toBe(true);
    // 也应包含 ×0（其他种子）
    expect(fillTextCalls.some((t) => t.includes("×0"))).toBe(true);
  });
});
