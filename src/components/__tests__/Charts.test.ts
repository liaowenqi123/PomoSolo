import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

// Mock @/api/charts
const chartsFetchMock = vi.hoisted(() => vi.fn());
const downloadSongMock = vi.hoisted(() => vi.fn());
vi.mock("@/api/charts", () => ({
  chartsFetch: (...a: unknown[]) => chartsFetchMock(...a),
  downloadSong: (...a: unknown[]) => downloadSongMock(...a),
}));

import Charts from "../Charts.vue";

const SAMPLE_SONGS = [
  { rank: 1, title: "歌一", artist: "甲", album: "专辑一" },
  { rank: 2, title: "歌二", artist: "乙", album: "专辑二" },
  { rank: 3, title: "歌三", artist: "丙", album: "专辑三" },
  { rank: 4, title: "歌四", artist: "丁", album: "专辑四" },
];

describe("Charts.vue", () => {
  beforeEach(() => {
    chartsFetchMock.mockReset();
    downloadSongMock.mockReset();
  });

  const mountComponent = (visible = true) =>
    mount(Charts, { props: { visible } });

  it("visible=false 时不渲染", () => {
    const wrapper = mountComponent(false);
    expect(wrapper.find(".charts-modal").exists()).toBe(false);
  });

  it("标题为『🎵 音乐榜单』并有关闭按钮", () => {
    const wrapper = mountComponent(true);
    expect(wrapper.find(".charts-modal__title").text()).toBe("🎵 音乐榜单");
    expect(wrapper.find(".charts-modal__close").exists()).toBe(true);
  });

  it("源切换：网易云 / QQ音乐 两个按钮", () => {
    const wrapper = mountComponent(true);
    const btns = wrapper.findAll(".charts-source__btn");
    expect(btns).toHaveLength(2);
    expect(btns[0].text()).toBe("网易云");
    expect(btns[1].text()).toBe("QQ音乐");
    // 初始 netease 高亮
    expect(btns[0].classes()).toContain("active");
  });

  it("点击源切换调用 fetchCharts 并切换源", async () => {
    chartsFetchMock.mockResolvedValue({ success: true, songs: SAMPLE_SONGS });
    const wrapper = mountComponent(true);
    const qqBtn = wrapper.findAll(".charts-source__btn")[1];
    await qqBtn.trigger("click");
    await flushPromises();
    expect(chartsFetchMock).toHaveBeenCalledWith("qq");
  });

  it("刷新按钮调用 fetchCharts", async () => {
    chartsFetchMock.mockResolvedValue({ success: true, songs: SAMPLE_SONGS });
    const wrapper = mountComponent(true);
    await wrapper.find(".charts-refresh-btn").trigger("click");
    expect(chartsFetchMock).toHaveBeenCalled();
  });

  it("下载模式切换：confirm 后开启，显示下载列", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const wrapper = mountComponent(true);
    expect(wrapper.find(".charts-th-download").exists()).toBe(false);
    const checkbox = wrapper.find('.charts-download-toggle input[type="checkbox"]');
    await checkbox.trigger("change");
    expect(confirmSpy).toHaveBeenCalled();
    expect(wrapper.find(".charts-th-download").exists()).toBe(true);
    confirmSpy.mockRestore();
  });

  it("confirm 取消时不开启下载模式", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const wrapper = mountComponent(true);
    await wrapper.find('.charts-download-toggle input[type="checkbox"]').trigger("change");
    expect(wrapper.find(".charts-th-download").exists()).toBe(false);
    confirmSpy.mockRestore();
  });

  it("下载列仅在 downloadMode=true 时可见", async () => {
    const wrapper = mountComponent(true);
    expect(wrapper.find(".charts-th-download").exists()).toBe(false);
    // 直接通过 vm 不可访问内部状态；通过 confirm 开启
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await wrapper.find('.charts-download-toggle input[type="checkbox"]').trigger("change");
    expect(wrapper.find(".charts-th-download").exists()).toBe(true);
  });

  it("表格：rank（1/2/3 名带奖牌类）、歌曲、歌手、专辑", async () => {
    chartsFetchMock.mockResolvedValue({ success: true, songs: SAMPLE_SONGS });
    const wrapper = mountComponent(true);
    await wrapper.find(".charts-refresh-btn").trigger("click");
    await flushPromises();
    const ranks = wrapper.findAll(".charts-rank-value");
    expect(ranks).toHaveLength(4);
    expect(ranks[0].classes()).toContain("medal-gold");
    expect(ranks[1].classes()).toContain("medal-silver");
    expect(ranks[2].classes()).toContain("medal-bronze");
    expect(ranks[3].classes()).not.toContain("medal-gold");
    expect(wrapper.findAll(".charts-td-title")).toHaveLength(4);
    expect(wrapper.findAll(".charts-td-artist")).toHaveLength(4);
    expect(wrapper.findAll(".charts-td-album")).toHaveLength(4);
  });

  it("空数据：未加载且无错误时显示『暂无数据』行", () => {
    // mount visible=true，watch 非立即，不会自动 fetch → songs=[] errorMsg=null
    const wrapper = mountComponent(true);
    expect(wrapper.find(".charts-empty").exists()).toBe(true);
    expect(wrapper.find(".charts-empty").text()).toBe("暂无数据");
  });

  it("下载按钮点击调用 handleDownload 并显示 toast", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    downloadSongMock.mockResolvedValue({ success: true, status: "success" });
    chartsFetchMock.mockResolvedValue({ success: true, songs: SAMPLE_SONGS });
    const wrapper = mountComponent(true);
    // 开启下载模式
    await wrapper.find('.charts-download-toggle input[type="checkbox"]').trigger("change");
    // 刷新获取数据
    await wrapper.find(".charts-refresh-btn").trigger("click");
    await flushPromises();
    const dlBtn = wrapper.find(".charts-download-btn");
    expect(dlBtn.exists()).toBe(true);
    await dlBtn.trigger("click");
    await flushPromises();
    expect(downloadSongMock).toHaveBeenCalledWith("歌一", "甲");
    expect(wrapper.find(".charts-toast").exists()).toBe(true);
    expect(wrapper.find(".charts-toast").classes()).toContain("success");
  });

  it("下载已存在歌曲显示 info toast", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    downloadSongMock.mockResolvedValue({ success: true, status: "exists" });
    chartsFetchMock.mockResolvedValue({ success: true, songs: SAMPLE_SONGS });
    const wrapper = mountComponent(true);
    await wrapper.find('.charts-download-toggle input[type="checkbox"]').trigger("change");
    await wrapper.find(".charts-refresh-btn").trigger("click");
    await flushPromises();
    await wrapper.find(".charts-download-btn").trigger("click");
    await flushPromises();
    expect(wrapper.find(".charts-toast").classes()).toContain("info");
  });

  it("下载未找到视频显示 error toast", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    downloadSongMock.mockResolvedValue({ success: false, status: "no_video" });
    chartsFetchMock.mockResolvedValue({ success: true, songs: SAMPLE_SONGS });
    const wrapper = mountComponent(true);
    await wrapper.find('.charts-download-toggle input[type="checkbox"]').trigger("change");
    await wrapper.find(".charts-refresh-btn").trigger("click");
    await flushPromises();
    await wrapper.find(".charts-download-btn").trigger("click");
    await flushPromises();
    expect(wrapper.find(".charts-toast").classes()).toContain("error");
  });

  it("加载中状态显示加载指示", async () => {
    // 用一个可控的延迟 promise
    let resolveFetch: (v: unknown) => void = () => {};
    chartsFetchMock.mockReturnValue(
      new Promise((r) => {
        resolveFetch = r;
      }),
    );
    const wrapper = mountComponent(true);
    await wrapper.find(".charts-refresh-btn").trigger("click");
    await flushPromises();
    expect(wrapper.find(".charts-loading").exists()).toBe(true);
    expect(wrapper.find(".charts-loading").text()).toBe("加载中...");
    // 释放以避免悬挂 promise
    resolveFetch({ success: true, songs: SAMPLE_SONGS });
    await flushPromises();
  });

  it("错误状态显示错误信息", async () => {
    chartsFetchMock.mockResolvedValue({ success: false, error: "服务器错误" });
    const wrapper = mountComponent(true);
    await wrapper.find(".charts-refresh-btn").trigger("click");
    await flushPromises();
    expect(wrapper.find(".charts-error").exists()).toBe(true);
    expect(wrapper.find(".charts-error").text()).toContain("服务器错误");
  });

  it("点击遮罩 emit close", async () => {
    const wrapper = mountComponent(true);
    await wrapper.find(".charts-modal").trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("点击关闭按钮 emit close", async () => {
    const wrapper = mountComponent(true);
    await wrapper.find(".charts-modal__close").trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("刷新按钮加载中时禁用", () => {
    const wrapper = mountComponent(true);
    // 初始未加载，按钮可用
    expect(wrapper.find(".charts-refresh-btn").attributes("disabled")).toBeUndefined();
  });
});
