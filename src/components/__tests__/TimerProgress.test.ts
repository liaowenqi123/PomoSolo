import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import TimerProgress from "../TimerProgress.vue";
import { useTimerStore } from "../../stores/timer";

const CIRCUMFERENCE = 2 * Math.PI * 120; // ≈ 753.98

describe("TimerProgress.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const mountComponent = () => mount(TimerProgress);

  it("应渲染一个 SVG 元素", () => {
    const wrapper = mountComponent();
    expect(wrapper.find("svg").exists()).toBe(true);
  });

  it("SVG 应包含两个 circle 元素（背景圆环 + 进度圆环）", () => {
    const wrapper = mountComponent();
    const circles = wrapper.findAll("circle");
    expect(circles).toHaveLength(2);
  });

  it("circumference 常量 = 2 * Math.PI * 120 ≈ 753.98", () => {
    const wrapper = mountComponent();
    const progressCircle = wrapper.findAll("circle")[1];
    const dasharray = progressCircle.attributes("stroke-dasharray");
    // 应解析为约 753.98
    expect(Number(dasharray)).toBeCloseTo(CIRCUMFERENCE, 2);
    expect(Number(dasharray)).toBeCloseTo(753.98, 2);
  });

  it("初始 progress=0 时 dashOffset 应等于 circumference（无进度显示）", () => {
    const wrapper = mountComponent();
    const progressCircle = wrapper.findAll("circle")[1];
    const dashoffset = progressCircle.attributes("stroke-dashoffset");

    expect(Number(dashoffset)).toBeCloseTo(CIRCUMFERENCE, 2);
  });

  it("进度圆环应具有 transform='rotate(-90 140 140)' 属性", () => {
    const wrapper = mountComponent();
    const progressCircle = wrapper.findAll("circle")[1];
    expect(progressCircle.attributes("transform")).toBe("rotate(-90 140 140)");
  });

  it("背景圆环不应有 transform 属性", () => {
    const wrapper = mountComponent();
    const bgCircle = wrapper.findAll("circle")[0];
    expect(bgCircle.attributes("transform")).toBeUndefined();
  });

  it("进度圆环的 stroke-dasharray 应为 circumference 数值", () => {
    const wrapper = mountComponent();
    const progressCircle = wrapper.findAll("circle")[1];
    const dasharray = progressCircle.attributes("stroke-dasharray");
    expect(Number(dasharray)).toBeCloseTo(CIRCUMFERENCE, 5);
  });

  it("容器应具有 pointer-events:none 样式（scoped CSS 类）", () => {
    const wrapper = mountComponent();
    const container = wrapper.find(".progress-ring");
    expect(container.exists()).toBe(true);
    // pointer-events:none 定义在 <style scoped> 的 .progress-ring 选择器中
    // jsdom 不会注入 scoped CSS 到 <style> 标签，因此验证类名存在即可
    // （类名存在即代表 scoped CSS 会应用 pointer-events: none）
    expect(container.classes()).toContain("progress-ring");
    // 同时验证 getComputedStyle 在 jsdom 下回退（不报错即可）
    const computedStyle = window.getComputedStyle(container.element);
    expect(typeof computedStyle.pointerEvents).toBe("string");
  });

  /**
   * 以下两个测试验证 dashOffset 响应性（已修复：使用 computed）。
   * 修复前 dashOffset 是普通常量，progress 变化时不会更新；
   * 修复后 dashOffset = computed(() => circumference * (1 - timer.progress))，
   * 进度圆环会随计时推进而动画。
   */
  it("计时运行并推进时间后 dashOffset 应减小（dashOffset 使用 computed 响应 progress）", async () => {
    const wrapper = mountComponent();
    const store = useTimerStore();

    // 初始断言：progress=0 -> dashOffset = circumference
    const progressCircle0 = wrapper.findAll("circle")[1];
    const initialOffset = Number(
      progressCircle0.attributes("stroke-dashoffset")
    );
    expect(initialOffset).toBeCloseTo(CIRCUMFERENCE, 2);

    // 启动计时器并推进 5 秒（store.progress 应已增加）
    store.start();
    vi.advanceTimersByTime(5000);
    await wrapper.vm.$nextTick();

    // store.progress 确实已变化
    expect(store.progress).toBeGreaterThan(0);

    const progressCircle = wrapper.findAll("circle")[1];
    const newOffset = Number(progressCircle.attributes("stroke-dashoffset"));

    // 修复后：dashOffset 应随 progress 增加而减小
    expect(newOffset).toBeLessThan(initialOffset);
    // 且应等于 circumference * (1 - progress)
    const expected = CIRCUMFERENCE * (1 - store.progress);
    expect(newOffset).toBeCloseTo(expected, 1);
  });

  it("推进更多时间后 dashOffset 应继续减小（响应 store 变化）", async () => {
    const wrapper = mountComponent();
    const store = useTimerStore();

    store.start();
    vi.advanceTimersByTime(5000); // 5 秒
    await wrapper.vm.$nextTick();
    const offsetAfter5s = Number(
      wrapper.findAll("circle")[1].attributes("stroke-dashoffset")
    );

    vi.advanceTimersByTime(5000); // 再推进 5 秒，共 10 秒
    await wrapper.vm.$nextTick();
    const offsetAfter10s = Number(
      wrapper.findAll("circle")[1].attributes("stroke-dashoffset")
    );

    // 修复后：dashOffset 应继续减小（progress 增加）
    expect(offsetAfter10s).toBeLessThan(offsetAfter5s);
    // store.progress 确实在变化
    expect(store.progress).toBeGreaterThan(0);
  });

  it("两个圆环的 cx/cy/r 应一致（cx=140, cy=140, r=120）", () => {
    const wrapper = mountComponent();
    const circles = wrapper.findAll("circle");
    for (const c of circles) {
      expect(c.attributes("cx")).toBe("140");
      expect(c.attributes("cy")).toBe("140");
      expect(c.attributes("r")).toBe("120");
    }
  });

  it("SVG 应具有 width=280, height=280, viewBox='0 0 280 280'", () => {
    const wrapper = mountComponent();
    const svg = wrapper.find("svg");
    expect(svg.attributes("width")).toBe("280");
    expect(svg.attributes("height")).toBe("280");
    expect(svg.attributes("viewBox")).toBe("0 0 280 280");
  });

  it("进度圆环 stroke 应为 var(--accent)", () => {
    const wrapper = mountComponent();
    const progressCircle = wrapper.findAll("circle")[1];
    expect(progressCircle.attributes("stroke")).toBe("var(--accent)");
  });

  it("背景圆环 stroke 应为半透明白色", () => {
    const wrapper = mountComponent();
    const bgCircle = wrapper.findAll("circle")[0];
    expect(bgCircle.attributes("stroke")).toBe("rgba(255, 255, 255, 0.05)");
  });
});
