import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { reactive } from "vue";
import { setActivePinia, createPinia } from "pinia";

// Mock @tauri-apps/api/event（useTauriEvent 依赖 listen）
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  once: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(() => Promise.resolve()),
  emitTo: vi.fn(() => Promise.resolve()),
  TauriEvent: {},
}));

// Mock 音乐 store
let mockStore: Record<string, unknown>;
vi.mock("@/stores/music", () => ({
  useMusicStore: () => mockStore,
}));

import MusicPlayer from "../MusicPlayer.vue";

function makeStore(overrides: Record<string, unknown> = {}) {
  return reactive(
    Object.assign(
      {
        isCollapsed: false,
        playing: false,
        trackName: "",
        currentTime: 0,
        duration: 0,
        volume: 1.0,
        playMode: "shuffle",
        hasMusic: true,
        hasPrev: false,
        playError: null as string | null,
        devices: [] as { id: number; name: string; hostapi: string }[],
        currentDeviceId: null as number | null,
        playlist: [] as string[],
        playlistTags: {} as Record<string, { name: string; color: string | null }>,
        customTags: {} as Record<string, string>,
        isDragging: false,
        progress: 0,
        currentTimeText: "0:00",
        durationText: "0:00",
        volumeIcon: "🔊",
        playModeIcon: "🔀",
        playModeTitle: "随机播放",
        toggleCollapse: vi.fn(),
        togglePlay: vi.fn(),
        prev: vi.fn(),
        next: vi.fn(),
        seek: vi.fn(),
        setVolume: vi.fn(),
        setDevice: vi.fn(),
        requestDevices: vi.fn(),
        requestPlaylist: vi.fn(),
        playSong: vi.fn(),
        deleteSong: vi.fn(),
        requestStatus: vi.fn(),
        loadSavedVolume: vi.fn(),
        loadCustomTags: vi.fn(),
        cyclePlayMode: vi.fn(),
        handleSyncWsEvent: vi.fn(),
      },
      overrides,
    ),
  ) as Record<string, unknown>;
}

describe("MusicPlayer.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockStore = makeStore();
  });

  const mountComponent = () => mount(MusicPlayer, { attachTo: document.body });

  it("收起状态：显示律动条 + 曲名，点击展开调用 toggleCollapse", async () => {
    mockStore = makeStore({ isCollapsed: true, trackName: "song.mp3" });
    const wrapper = mountComponent();
    expect(wrapper.find(".music-player__collapsed").exists()).toBe(true);
    expect(wrapper.findAll(".music-visualizer__bar")).toHaveLength(4);
    expect(wrapper.find(".music-player__collapsed-track").text()).toBe("song.mp3");
    await wrapper.find(".music-player__collapsed").trigger("click");
    expect(mockStore.toggleCollapse).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("展开状态：显示完整控制栏", () => {
    const wrapper = mountComponent();
    expect(wrapper.find(".music-player__main").exists()).toBe(true);
    expect(wrapper.find(".music-btn--prev").exists()).toBe(true);
    expect(wrapper.find(".music-btn--play").exists()).toBe(true);
    expect(wrapper.find(".music-btn--next").exists()).toBe(true);
    expect(wrapper.find(".music-btn--mode").exists()).toBe(true);
    expect(wrapper.find(".music-progress").exists()).toBe(true);
    expect(wrapper.find(".music-volume").exists()).toBe(true);
    expect(wrapper.find(".music-device").exists()).toBe(true);
    expect(wrapper.find(".music-playlist-btn").exists()).toBe(true);
    expect(wrapper.find('button[title="收起"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("播放按钮：未播放显示 ▶，播放中显示 ⏸", async () => {
    const wrapper = mountComponent();
    expect(wrapper.find(".music-btn--play").text()).toBe("▶");
    (mockStore.playing as boolean) = true;
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".music-btn--play").text()).toBe("⏸");
    wrapper.unmount();
  });

  it("点击播放按钮调用 store.togglePlay", async () => {
    const wrapper = mountComponent();
    await wrapper.find(".music-btn--play").trigger("click");
    expect(mockStore.togglePlay).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("点击上一首/下一首调用 store.prev / store.next", async () => {
    mockStore = makeStore({ hasPrev: true });
    const wrapper = mountComponent();
    await wrapper.find(".music-btn--prev").trigger("click");
    expect(mockStore.prev).toHaveBeenCalled();
    await wrapper.find(".music-btn--next").trigger("click");
    expect(mockStore.next).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("点击模式按钮调用 store.cyclePlayMode", async () => {
    const wrapper = mountComponent();
    await wrapper.find(".music-btn--mode").trigger("click");
    expect(mockStore.cyclePlayMode).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("模式按钮在 playMode !== 'order' 时有 active 类", async () => {
    mockStore = makeStore({ playMode: "shuffle" });
    const wrapper = mountComponent();
    expect(wrapper.find(".music-btn--mode").classes()).toContain("active");
    (mockStore.playMode as string) = "order";
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".music-btn--mode").classes()).not.toContain("active");
    wrapper.unmount();
  });

  it("上一首按钮在 !hasPrev 时禁用", async () => {
    const wrapper = mountComponent();
    expect(wrapper.find(".music-btn--prev").attributes("disabled")).toBeDefined();
    (mockStore.hasPrev as boolean) = true;
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".music-btn--prev").attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("进度条显示 currentTimeText / durationText", () => {
    mockStore = makeStore({ currentTimeText: "1:30", durationText: "3:00" });
    const wrapper = mountComponent();
    const times = wrapper.findAll(".music-progress__time");
    expect(times).toHaveLength(2);
    expect(times[0].text()).toBe("1:30");
    expect(times[1].text()).toBe("3:00");
    wrapper.unmount();
  });

  it("进度条填充宽度 = progress + '%'", async () => {
    mockStore = makeStore({ progress: 50 });
    const wrapper = mountComponent();
    const fill = wrapper.find(".music-progress__fill");
    expect(fill.attributes("style")).toContain("width: 50%");
    wrapper.unmount();
  });

  it("点击进度条根据位置调用 store.seek(seconds)", async () => {
    mockStore = makeStore({ duration: 200 });
    const wrapper = mountComponent();
    const bar = wrapper.find(".music-progress__bar").element as HTMLElement;
    bar.getBoundingClientRect = vi.fn(
      () =>
        ({
          left: 0,
          width: 100,
          right: 100,
          bottom: 0,
          top: 0,
          height: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
    );
    await wrapper
      .find(".music-progress")
      .trigger("click", { clientX: 50 });
    expect(mockStore.seek).toHaveBeenCalledWith(100);
    wrapper.unmount();
  });

  it("duration<=0 时点击进度条不 seek", async () => {
    mockStore = makeStore({ duration: 0 });
    const wrapper = mountComponent();
    await wrapper.find(".music-progress").trigger("click", { clientX: 50 });
    expect(mockStore.seek).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("音量按钮切换音量面板可见性", async () => {
    const wrapper = mountComponent();
    expect(wrapper.find(".music-volume__slider").isVisible()).toBe(false);
    await wrapper.find(".music-volume .music-btn").trigger("click");
    expect(wrapper.find(".music-volume__slider").isVisible()).toBe(true);
    wrapper.unmount();
  });

  it("音量滑块 input 调用 store.setVolume", async () => {
    const wrapper = mountComponent();
    await wrapper.find(".music-volume .music-btn").trigger("click");
    const input = wrapper.find('.music-volume__slider input[type="range"]');
    await input.setValue(50);
    expect(mockStore.setVolume).toHaveBeenCalledWith(0.5);
    wrapper.unmount();
  });

  it("音量图标按 4 个等级变化", async () => {
    mockStore = makeStore({ volume: 0 });
    (mockStore.volumeIcon as string) = "🔇";
    const wrapper = mountComponent();
    expect(wrapper.find(".music-volume .music-btn").text()).toBe("🔇");
    (mockStore.volumeIcon as string) = "🔈";
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".music-volume .music-btn").text()).toBe("🔈");
    (mockStore.volumeIcon as string) = "🔉";
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".music-volume .music-btn").text()).toBe("🔉");
    (mockStore.volumeIcon as string) = "🔊";
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".music-volume .music-btn").text()).toBe("🔊");
    wrapper.unmount();
  });

  it("设备按钮切换设备面板并调用 requestDevices", async () => {
    const wrapper = mountComponent();
    // onMounted 已调用一次 requestDevices，清除后断言点击行为
    (mockStore.requestDevices as ReturnType<typeof vi.fn>).mockClear();
    expect(wrapper.find(".music-device__list").isVisible()).toBe(false);
    await wrapper.find(".music-device > .music-btn").trigger("click");
    expect(mockStore.requestDevices).toHaveBeenCalled();
    expect(wrapper.find(".music-device__list").isVisible()).toBe(true);
    wrapper.unmount();
  });

  it("点击设备项调用 store.setDevice 并关闭面板", async () => {
    mockStore = makeStore({
      devices: [
        { id: 1, name: "Dev1", hostapi: "x" },
        { id: 2, name: "Dev2", hostapi: "x" },
      ],
    });
    const wrapper = mountComponent();
    await wrapper.find(".music-device > .music-btn").trigger("click");
    expect(wrapper.find(".music-device__list").isVisible()).toBe(true);
    await wrapper.find(".music-device__item").trigger("click");
    expect(mockStore.setDevice).toHaveBeenCalledWith(1);
    expect(wrapper.find(".music-device__list").isVisible()).toBe(false);
    wrapper.unmount();
  });

  it("播放列表按钮切换面板并调用 requestPlaylist", async () => {
    const wrapper = mountComponent();
    expect(wrapper.find(".music-playlist").isVisible()).toBe(false);
    await wrapper.find(".music-playlist-btn").trigger("click");
    expect(mockStore.requestPlaylist).toHaveBeenCalled();
    expect(wrapper.find(".music-playlist").isVisible()).toBe(true);
    wrapper.unmount();
  });

  it("点击当前歌曲不调用 playSong，点击其他歌曲调用 playSong", async () => {
    mockStore = makeStore({
      playlist: ["a.mp3", "b.mp3"],
      trackName: "a.mp3",
    });
    const wrapper = mountComponent();
    await wrapper.find(".music-playlist-btn").trigger("click");
    const items = wrapper.findAll(".music-playlist__item");
    expect(items).toHaveLength(2);
    // 点击当前歌曲 a.mp3
    await items[0].trigger("click");
    expect(mockStore.playSong).not.toHaveBeenCalled();
    // 点击其他歌曲 b.mp3
    await items[1].trigger("click");
    expect(mockStore.playSong).toHaveBeenCalledWith("b.mp3");
    wrapper.unmount();
  });

  it("删除按钮 stopPropagation 并调用 deleteSong，当前歌曲无删除按钮", async () => {
    mockStore = makeStore({
      playlist: ["a.mp3", "b.mp3"],
      trackName: "a.mp3",
    });
    const wrapper = mountComponent();
    await wrapper.find(".music-playlist-btn").trigger("click");
    const items = wrapper.findAll(".music-playlist__item");
    // 当前歌曲 a.mp3 无删除按钮，显示播放标记
    expect(items[0].find(".music-playlist__delete").exists()).toBe(false);
    expect(items[0].find(".music-playlist__playing").exists()).toBe(true);
    // b.mp3 有删除按钮
    const delBtn = items[1].find(".music-playlist__delete");
    expect(delBtn.exists()).toBe(true);
    await delBtn.trigger("click");
    expect(mockStore.deleteSong).toHaveBeenCalledWith("b.mp3");
    // stopPropagation：不应触发 playSong
    expect(mockStore.playSong).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("空播放列表显示『暂无音乐』", async () => {
    mockStore = makeStore({ playlist: [] });
    const wrapper = mountComponent();
    await wrapper.find(".music-playlist-btn").trigger("click");
    expect(wrapper.find(".music-playlist__empty").text()).toBe("暂无音乐");
    wrapper.unmount();
  });

  it("点击收起按钮调用 toggleCollapse", async () => {
    const wrapper = mountComponent();
    await wrapper.find('button[title="收起"]').trigger("click");
    expect(mockStore.toggleCollapse).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("playError 时曲名带 error 类并显示错误信息", () => {
    mockStore = makeStore({ playError: "boom" });
    const wrapper = mountComponent();
    const name = wrapper.find(".music-player__track-name");
    expect(name.classes()).toContain("error");
    expect(name.text()).toBe("boom");
    wrapper.unmount();
  });

  it("无音乐时曲名显示『无音乐』并带 empty 类", () => {
    mockStore = makeStore({ hasMusic: false, playError: null });
    const wrapper = mountComponent();
    const name = wrapper.find(".music-player__track-name");
    expect(name.classes()).toContain("empty");
    expect(name.text()).toBe("无音乐");
    wrapper.unmount();
  });

  it("有音乐无曲名时显示『未播放』", () => {
    mockStore = makeStore({ hasMusic: true, trackName: "", playError: null });
    const wrapper = mountComponent();
    expect(wrapper.find(".music-player__track-name").text()).toBe("未播放");
    wrapper.unmount();
  });
});
