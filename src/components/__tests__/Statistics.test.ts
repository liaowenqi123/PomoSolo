import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";

// Mock chart.js/auto（Statistics.vue 通过 import Chart from "chart.js/auto" 引入）
const { ChartMock, chartInstance } = vi.hoisted(() => {
  const inst = {
    destroy: vi.fn(),
    update: vi.fn(),
    data: { labels: [], datasets: [{ data: [] }] },
  };
  const Mock = vi.fn().mockImplementation(() => inst);
  return { ChartMock: Mock, chartInstance: inst };
});
vi.mock("chart.js/auto", () => ({
  default: ChartMock,
}));

import Statistics from "../Statistics.vue";
import { useStatsStore } from "../../stores/stats";

describe("Statistics.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    ChartMock.mockClear();
    chartInstance.destroy.mockClear();
    chartInstance.update.mockClear();
  });

  const mountComponent = (visible = true) =>
    mount(Statistics, { props: { visible } });

  it("visible=false 时不渲染", () => {
    const wrapper = mountComponent(false);
    expect(wrapper.find(".stats-overlay").exists()).toBe(false);
  });

  it("标题为『统计』并有关闭按钮", () => {
    const wrapper = mountComponent(true);
    expect(wrapper.find(".stats-panel__title").text()).toBe("统计");
    expect(wrapper.find(".stats-panel__close").exists()).toBe(true);
  });

  it("三张卡片：今日番茄 / 今日专注(分钟) / 累计专注(分钟)", () => {
    const wrapper = mountComponent(true);
    const cards = wrapper.findAll(".stats-card");
    expect(cards).toHaveLength(3);
    const labels = cards.map((c) => c.find(".stats-card__label").text());
    expect(labels).toContain("今日番茄");
    expect(labels).toContain("今日专注（分钟）");
    expect(labels).toContain("累计专注（分钟）");
  });

  it("卡片显示 stats.todayCount / stats.todayMinutes / stats.totalMinutes", async () => {
    const stats = useStatsStore();
    // stats store 使用 toDateString() 格式标记日期
    const todayStr = new Date().toDateString();
    stats.stats.todayCount = 3;
    stats.stats.totalMinutes = 100;
    stats.stats.statisticsHistory = [
      { date: todayStr, timestamp: "", minutes: 40 },
      { date: todayStr, timestamp: "", minutes: 20 },
    ];
    const wrapper = mountComponent(true);
    await wrapper.vm.$nextTick();
    const values = wrapper.findAll(".stats-card__value").map((v) => v.text());
    expect(values).toContain("3");
    expect(values).toContain("60");
    expect(values).toContain("100");
  });

  it("渲染 chart canvas", () => {
    const wrapper = mountComponent(true);
    expect(wrapper.find("canvas").exists()).toBe(true);
  });

  it("visible=true 时创建 Chart 实例（传入 canvas + 配置）", async () => {
    const wrapper = mountComponent(true);
    await flushPromises();
    expect(ChartMock).toHaveBeenCalledTimes(1);
    const [canvas, config] = ChartMock.mock.calls[0];
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect((config as { type: string }).type).toBe("bar");
    expect((config as { data: { datasets: unknown[] } }).data.datasets).toHaveLength(1);
  });

  it("visible 从 true 变 false 时销毁 Chart 实例", async () => {
    const wrapper = mountComponent(true);
    await flushPromises();
    expect(ChartMock).toHaveBeenCalledTimes(1);
    await wrapper.setProps({ visible: false });
    await flushPromises();
    expect(chartInstance.destroy).toHaveBeenCalled();
  });

  it("点击遮罩 emit close", async () => {
    const wrapper = mountComponent(true);
    await wrapper.find(".stats-overlay").trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("点击关闭按钮 emit close", async () => {
    const wrapper = mountComponent(true);
    await wrapper.find(".stats-panel__close").trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("点击内容区 stopPropagation 不 emit close", async () => {
    const wrapper = mountComponent(true);
    await wrapper.find(".stats-panel").trigger("click");
    expect(wrapper.emitted("close")).toBeFalsy();
  });

  it("visible 时 stats.last7Days 变化应触发 chartInstance.update()", async () => {
    const wrapper = mountComponent(true);
    await flushPromises();
    expect(ChartMock).toHaveBeenCalledTimes(1);
    chartInstance.update.mockClear();
    // 修改统计数据触发 last7Days 重新计算
    const stats = useStatsStore();
    stats.stats.statisticsHistory.push({
      date: new Date().toISOString().split("T")[0],
      timestamp: new Date().toISOString(),
      minutes: 30,
    });
    await flushPromises();
    expect(chartInstance.update).toHaveBeenCalled();
  });

  it("visible=false 时不应创建 Chart 实例", async () => {
    const wrapper = mountComponent(false);
    await flushPromises();
    expect(ChartMock).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("组件卸载时应销毁 Chart 实例（onUnmounted）", async () => {
    const wrapper = mountComponent(true);
    await flushPromises();
    expect(ChartMock).toHaveBeenCalledTimes(1);
    chartInstance.destroy.mockClear();
    wrapper.unmount();
    expect(chartInstance.destroy).toHaveBeenCalled();
  });

  it("visible 从 false 变 true 时应重新渲染 Chart", async () => {
    const wrapper = mountComponent(false);
    await flushPromises();
    expect(ChartMock).not.toHaveBeenCalled();
    await wrapper.setProps({ visible: true });
    await flushPromises();
    expect(ChartMock).toHaveBeenCalledTimes(1);
  });

  it("Chart 实例已存在时再次渲染应先销毁旧实例", async () => {
    const wrapper = mountComponent(true);
    await flushPromises();
    expect(ChartMock).toHaveBeenCalledTimes(1);
    chartInstance.destroy.mockClear();
    // 切换 visible 触发重新渲染
    await wrapper.setProps({ visible: false });
    await flushPromises();
    await wrapper.setProps({ visible: true });
    await flushPromises();
    // 第一次 destroy（visible false）+ 第二次 destroy（重新渲染前）应都被调用
    expect(chartInstance.destroy).toHaveBeenCalled();
    expect(ChartMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
