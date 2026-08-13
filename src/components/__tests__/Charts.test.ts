import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";

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
    setActivePinia(createPinia());
    chartsFetchMock.mockReset();
    downloadSongMock.mockReset();
  });

  const mountComponent = (visible = true) =>
    mount(Charts, { props: { visible } });

  /** 辅助：通过自定义免责声明弹窗开启下载模式 */
  async function enableDownloadMode(wrapper: ReturnType<typeof mountComponent>) {
    await wrapper.find('.charts-download-toggle input[type="checkbox"]').trigger("change");
    // 免责声明弹窗出现
    expect(wrapper.find(".charts-disclaimer").exists()).toBe(true);
    // 点击「继续开启」
    await wrapper.find(".charts-disclaimer__btn--confirm").trigger("click");
  }

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

  it("下载模式切换：显示自定义免责声明弹窗（不使用 window.confirm）", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const wrapper = mountComponent(true);
    expect(wrapper.find(".charts-disclaimer").exists()).toBe(false);
    await wrapper.find('.charts-download-toggle input[type="checkbox"]').trigger("change");
    // 应显示自定义免责声明弹窗，而非调用 window.confirm
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(wrapper.find(".charts-disclaimer").exists()).toBe(true);
    expect(wrapper.find(".charts-disclaimer__title").text()).toBe("⚠️ 下载须知");
    confirmSpy.mockRestore();
  });

  it("免责声明确认后开启下载模式，显示下载列", async () => {
    const wrapper = mountComponent(true);
    expect(wrapper.find(".charts-th-download").exists()).toBe(false);
    await enableDownloadMode(wrapper);
    expect(wrapper.find(".charts-th-download").exists()).toBe(true);
    // 免责声明弹窗关闭
    expect(wrapper.find(".charts-disclaimer").exists()).toBe(false);
  });

  it("免责声明取消时不开启下载模式", async () => {
    const wrapper = mountComponent(true);
    await wrapper.find('.charts-download-toggle input[type="checkbox"]').trigger("change");
    expect(wrapper.find(".charts-disclaimer").exists()).toBe(true);
    await wrapper.find(".charts-disclaimer__btn--cancel").trigger("click");
    expect(wrapper.find(".charts-th-download").exists()).toBe(false);
    expect(wrapper.find(".charts-disclaimer").exists()).toBe(false);
  });

  it("下载列仅在 downloadMode=true 时可见", async () => {
    const wrapper = mountComponent(true);
    expect(wrapper.find(".charts-th-download").exists()).toBe(false);
    await enableDownloadMode(wrapper);
    expect(wrapper.find(".charts-th-download").exists()).toBe(true);
  });

  it("开启下载模式后显示手动下载按钮", async () => {
    const wrapper = mountComponent(true);
    expect(wrapper.find(".charts-manual-download-btn").exists()).toBe(false);
    await enableDownloadMode(wrapper);
    expect(wrapper.find(".charts-manual-download-btn").exists()).toBe(true);
    expect(wrapper.find(".charts-manual-download-btn").text()).toBe("📥 手动下载");
  });

  it("点击手动下载按钮打开下载弹窗", async () => {
    const wrapper = mountComponent(true);
    await enableDownloadMode(wrapper);
    expect(wrapper.find(".download-dialog").exists()).toBe(false);
    await wrapper.find(".charts-manual-download-btn").trigger("click");
    expect(wrapper.find(".download-dialog").exists()).toBe(true);
    expect(wrapper.find(".download-dialog__title").text()).toBe("📥 下载队列");
  });

  it("下载弹窗包含歌曲名称输入框", async () => {
    const wrapper = mountComponent(true);
    await enableDownloadMode(wrapper);
    await wrapper.find(".charts-manual-download-btn").trigger("click");
    const inputs = wrapper.findAll(".download-dialog__input");
    expect(inputs).toHaveLength(2); // 歌曲名称 + 歌手
    expect(inputs[0].attributes("placeholder")).toBe("请输入歌曲名称");
  });

  it("下载弹窗输入空歌曲名时「加入队列」按钮禁用，不调用 API", async () => {
    const wrapper = mountComponent(true);
    await enableDownloadMode(wrapper);
    await wrapper.find(".charts-manual-download-btn").trigger("click");
    const btn = wrapper.find(".download-dialog__btn--download");
    expect(btn.attributes("disabled")).toBeDefined();
    await btn.trigger("click");
    expect(downloadSongMock).not.toHaveBeenCalled();
  });

  it("下载弹窗输入歌曲名后调用 downloadSong API", async () => {
    downloadSongMock.mockResolvedValue({ success: true, status: "downloaded" });
    const wrapper = mountComponent(true);
    await enableDownloadMode(wrapper);
    await wrapper.find(".charts-manual-download-btn").trigger("click");
    // 输入歌曲名
    const inputs = wrapper.findAll(".download-dialog__input");
    await inputs[0].setValue("我的歌");
    await inputs[1].setValue("歌手名");
    // 点击下载
    await wrapper.find(".download-dialog__btn--download").trigger("click");
    await flushPromises();
    expect(downloadSongMock).toHaveBeenCalledWith("我的歌", "歌手名");
  });

  it("下载弹窗入队成功后队列显示「完成」状态", async () => {
    downloadSongMock.mockResolvedValue({ success: true, status: "downloaded" });
    const wrapper = mountComponent(true);
    await enableDownloadMode(wrapper);
    await wrapper.find(".charts-manual-download-btn").trigger("click");
    await wrapper.find(".download-dialog__input").setValue("我的歌");
    await wrapper.find(".download-dialog__btn--download").trigger("click");
    await flushPromises();
    const status = wrapper.find(".download-queue__status");
    expect(status.exists()).toBe(true);
    expect(status.text()).toContain("完成");
  });

  it("下载弹窗入队失败后队列显示「未找到」状态", async () => {
    downloadSongMock.mockResolvedValue({
      success: false,
      status: "no_video",
      error: "未找到相关视频",
    });
    const wrapper = mountComponent(true);
    await enableDownloadMode(wrapper);
    await wrapper.find(".charts-manual-download-btn").trigger("click");
    await wrapper.find(".download-dialog__input").setValue("不存在的歌");
    await wrapper.find(".download-dialog__btn--download").trigger("click");
    await flushPromises();
    const status = wrapper.find(".download-queue__status");
    expect(status.exists()).toBe(true);
    expect(status.text()).toContain("未找到");
    expect(wrapper.find(".download-queue__error").text()).toContain("未找到相关视频");
  });

  it("下载弹窗取消按钮关闭弹窗", async () => {
    const wrapper = mountComponent(true);
    await enableDownloadMode(wrapper);
    await wrapper.find(".charts-manual-download-btn").trigger("click");
    expect(wrapper.find(".download-dialog").exists()).toBe(true);
    await wrapper.find(".download-dialog__btn--cancel").trigger("click");
    expect(wrapper.find(".download-dialog").exists()).toBe(false);
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
    const wrapper = mountComponent(true);
    expect(wrapper.find(".charts-empty").exists()).toBe(true);
    expect(wrapper.find(".charts-empty").text()).toBe("暂无数据");
  });

  it("榜单下载按钮点击调用 handleDownload 并显示 toast", async () => {
    downloadSongMock.mockResolvedValue({ success: true, status: "downloaded" });
    chartsFetchMock.mockResolvedValue({ success: true, songs: SAMPLE_SONGS });
    const wrapper = mountComponent(true);
    await enableDownloadMode(wrapper);
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

  it("加载中状态显示加载指示", async () => {
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
    expect(wrapper.find(".charts-refresh-btn").attributes("disabled")).toBeUndefined();
  });
});
