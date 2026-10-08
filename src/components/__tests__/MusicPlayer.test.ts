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
        // 音乐库管理
        songMeta: {} as Record<string, { path: string; tags: string[]; source: string }>,
        activeDir: null as string | null,
        selectedTags: new Set<string>(),
        searchQuery: "",
        selection: new Set<string>(),
        playSet: new Set<string>(),
        playSetSource: "",
        playSetActive: false,
        dirTree: [] as { path: string; name: string; children: unknown[]; count: number; subtreeCount: number }[],
        allTags: [] as { name: string; count: number }[],
        filteredSongs: [] as string[],
        filteredCount: 0,
        hasFilter: false,
        isDragging: false,
        syncEnabled: false,
        isDj: false,
        djName: "",
        waitingForSongs: false,
        transferMode: "immediate",
        songTransfer: { state: "idle", songName: "", received: 0, total: 0 },
        missingSongName: null as string | null,
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
        toggleDir: vi.fn(),
        clearFilters: vi.fn(),
        toggleTag: vi.fn(),
        toggleSelection: vi.fn(),
        replaceSelection: vi.fn(),
        clearSelection: vi.fn(),
        addSongsToPlaylist: vi.fn(async () => 1),
        addViewToPlaylist: vi.fn(async () => 2),
        playCollection: vi.fn(async () => true),
        removeFromPlaylist: vi.fn(async () => undefined),
        clearPlaylistSet: vi.fn(),
        moveSongsToDir: vi.fn(async () => true),
        setSongsTags: vi.fn(async () => true),
        addToFavorites: vi.fn(async () => true),
        markP2pSong: vi.fn(),
        renameDir: vi.fn(),
        deleteDir: vi.fn(),
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

  /**
   * 打开音乐库并**展开成全屏曲库**。
   * 设计变更：点 📋 默认开的是**紧凑浮层**（`.music-list`，扁平列表，
   * 用于"瞄一眼队列 / 随手切一首"），全屏曲库（目录树/筛选/批量）需要显式展开。
   * 详见 docs/modules/music-player.md §8.6。
   */
  const openFullLibrary = async (wrapper: ReturnType<typeof mountComponent>) => {
    await wrapper.find(".music-playlist-btn").trigger("click");
    await wrapper.find(".music-list__btn").trigger("click");   // 第一个按钮 = ⤢ 展开
    await wrapper.vm.$nextTick();
  };

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

  it("播放列表按钮：默认打开紧凑浮层并调用 requestPlaylist；⤢ 可展开为全屏曲库", async () => {
    const wrapper = mountComponent();
    expect(wrapper.find(".music-list").isVisible()).toBe(false);
    expect(wrapper.find(".music-playlist").isVisible()).toBe(false);

    await wrapper.find(".music-playlist-btn").trigger("click");
    expect(mockStore.requestPlaylist).toHaveBeenCalled();

    // 默认 = 紧凑浮层（扁平列表），全屏曲库还不显示
    expect(wrapper.find(".music-list").isVisible()).toBe(true);
    expect(wrapper.find(".music-playlist").isVisible()).toBe(false);

    // ⤢ 展开 → 全屏曲库；紧凑浮层隐藏
    await wrapper.find(".music-list__btn").trigger("click");
    expect(wrapper.find(".music-playlist").isVisible()).toBe(true);
    expect(wrapper.find(".music-list").isVisible()).toBe(false);

    // ← 返回 → 收回紧凑浮层（**不是**关闭面板）
    await wrapper.find(".music-playlist__back").trigger("click");
    expect(wrapper.find(".music-list").isVisible()).toBe(true);
    expect(wrapper.find(".music-playlist").isVisible()).toBe(false);

    wrapper.unmount();
  });

  it("紧凑浮层：显示队列（无队列时退回全部歌曲），点行即播放，标签 chip 前置", async () => {
    mockStore = makeStore({
      playlist: ["a.mp3", "b.mp3"],
      playSet: new Set(["b.mp3", "a.mp3"]),
      playSetActive: true,
      playSetSource: "目录 · 导入",
      trackName: "b.mp3",
    });
    const wrapper = mountComponent();
    await wrapper.find(".music-playlist-btn").trigger("click");

    // 有队列 → 显示队列（顺序按 Set 推入序）
    const rows = wrapper.findAll(".music-list__item");
    expect(rows).toHaveLength(2);
    expect(rows[0].find(".music-list__name").text()).toBe("b");
    // 当前歌显示 ▶ 而不是删除/移除按钮
    expect(rows[0].find(".music-list__playing").exists()).toBe(true);
    // 队列模式用 ✕ 从队列移除（非破坏性），不是 🗑 删文件
    expect(rows[1].find(".music-list__action").text()).toBe("✕");
    // 标签 chip 是每行的**第一个**子元素（上一版的设计语言）
    expect(rows[0].element.firstElementChild?.className).toContain("music-list__tag");
    // 点行即播放
    await rows[1].trigger("click");
    expect(mockStore.playSong).toHaveBeenCalledWith("a.mp3");
    wrapper.unmount();
  });

  it("紧凑浮层：无队列时退回显示全部歌曲（避免打开一个空面板）", async () => {
    mockStore = makeStore({
      playlist: ["a.mp3", "b.mp3"],
      playSet: new Set<string>(),
      playSetActive: false,
    });
    const wrapper = mountComponent();
    await wrapper.find(".music-playlist-btn").trigger("click");
    expect(wrapper.findAll(".music-list__item")).toHaveLength(2);
    // 曲库模式用 🗑 删除文件（上一版行为）
    expect(wrapper.find(".music-list__action").text()).toBe("🗑");
    wrapper.unmount();
  });

  it("📋 的 title：本机播放时显示「下一首」，同步听歌当听众时改显示「由 DJ 控制」", () => {
    // 本机：显示队列/全部歌曲 + 首数 + 下一首
    mockStore = makeStore({
      playlist: ["a.mp3", "b.mp3", "c.mp3"],
      trackName: "a.mp3",
      syncEnabled: false,
      isDj: false,
    });
    let wrapper = mountComponent();
    let title = wrapper.find(".music-playlist-btn").attributes("title") ?? "";
    expect(title).toContain("3 首");
    expect(title).toContain("下一首：b");
    wrapper.unmount();

    // 同步听歌当听众：播放由 DJ 决定，本地算的"下一首"是错的 → 不能显示
    mockStore = makeStore({
      playlist: ["a.mp3", "b.mp3", "c.mp3"],
      trackName: "a.mp3",
      syncEnabled: true,
      isDj: false,
      djName: "汤圆",
    });
    wrapper = mountComponent();
    title = wrapper.find(".music-playlist-btn").attributes("title") ?? "";
    expect(title).not.toContain("下一首");
    expect(title).toContain("由 汤圆 控制");
    wrapper.unmount();

    // 自己是 DJ：队列就是播放顺序，可以显示"下一首"
    mockStore = makeStore({
      playlist: ["a.mp3", "b.mp3"],
      trackName: "a.mp3",
      syncEnabled: true,
      isDj: true,
      djName: "我",
    });
    wrapper = mountComponent();
    title = wrapper.find(".music-playlist-btn").attributes("title") ?? "";
    expect(title).toContain("下一首：b");
    wrapper.unmount();
  });

  it("弹层关闭用 pointerdown 而非 click：面板内按下、面板外松开**不关**", async () => {
    const wrapper = mountComponent();
    await wrapper.find(".music-playlist-btn").trigger("click");
    expect(wrapper.find(".music-list").isVisible()).toBe(true);

    // 在面板内按下，在面板外松开 —— click 语义会误关，pointerdown 语义不会
    const inside = wrapper.find(".music-list__items").element as HTMLElement;
    inside.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".music-list").isVisible()).toBe(true);

    // 在面板外按下 → 关
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".music-list").isVisible()).toBe(false);

    wrapper.unmount();
  });

  it("浏览行：单击选中/再次单击取消，Ctrl 增减，Shift 连续选中", async () => {
    mockStore = makeStore({
      playlist: ["a.mp3", "b.mp3", "c.mp3"],
      filteredSongs: ["a.mp3", "b.mp3", "c.mp3"],
      selection: new Set<string>(),
      replaceSelection: vi.fn((songs: string[]) => {
        mockStore.selection = new Set(songs);
      }),
      toggleSelection: vi.fn((song: string) => {
        const next = new Set(mockStore.selection as Set<string>);
        if (next.has(song)) next.delete(song);
        else next.add(song);
        mockStore.selection = next;
      }),
    });
    const wrapper = mountComponent();
    await openFullLibrary(wrapper);
    const items = wrapper.findAll(".music-playlist__item");
    expect(items).toHaveLength(3);
    // 单击未选中行 → 单选
    await items[0].trigger("click");
    expect(mockStore.selection).toEqual(new Set(["a.mp3"]));
    // 再次单击已选中行 → 取消选中
    await items[0].trigger("click");
    expect(mockStore.selection).toEqual(new Set());
    // Ctrl 单击 → 增减
    await items[1].trigger("click", { ctrlKey: true });
    expect(mockStore.selection).toEqual(new Set(["b.mp3"]));
    await items[1].trigger("click", { ctrlKey: true });
    expect(mockStore.selection).toEqual(new Set());
    // Shift 单击 → 连续范围
    await items[0].trigger("click");
    await items[2].trigger("click", { shiftKey: true });
    expect(mockStore.selection).toEqual(new Set(["a.mp3", "b.mp3", "c.mp3"]));
    // 单击不再触发播放（播放改走右键菜单/集合区）
    expect(mockStore.playSong).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("浏览行双击 = 加入播放列表（集合）", async () => {
    mockStore = makeStore({
      playlist: ["a.mp3"],
      filteredSongs: ["a.mp3"],
    });
    const wrapper = mountComponent();
    await openFullLibrary(wrapper);
    await wrapper.find(".music-playlist__item").trigger("dblclick");
    expect(mockStore.addSongsToPlaylist).toHaveBeenCalledWith(["a.mp3"]);
    wrapper.unmount();
  });

  /** 从 body 取 Teleport 出去的右键菜单 */
  function ctxMenuEl(): HTMLElement | null {
    return document.body.querySelector(".music-playlist__ctxmenu");
  }

  it("浏览行右键：弹出菜单（Teleport 到 body），「添加到播放列表」加入集合", async () => {
    mockStore = makeStore({
      playlist: ["a.mp3"],
      filteredSongs: ["a.mp3"],
      selection: new Set(["a.mp3"]),
    });
    const wrapper = mountComponent();
    await openFullLibrary(wrapper);
    await wrapper.find(".music-playlist__item").trigger("contextmenu", { clientX: 100, clientY: 100 });
    const menu = ctxMenuEl();
    expect(menu).toBeTruthy();
    // 单曲选择不显示"已选 N 首"提示
    expect(menu!.querySelector(".music-playlist__ctxmenu-hint")).toBeNull();
    const addBtn = [...menu!.querySelectorAll("button")].find((b) => b.textContent?.includes("添加到播放列表"))!;
    addBtn.click();
    expect(mockStore.addSongsToPlaylist).toHaveBeenCalledWith(["a.mp3"]);
    wrapper.unmount();
  });

  it("多选时右键：菜单作用于整个选择集（Windows 风格）", async () => {
    mockStore = makeStore({
      playlist: ["a.mp3", "b.mp3"],
      filteredSongs: ["a.mp3", "b.mp3"],
      selection: new Set(["a.mp3", "b.mp3"]),
    });
    const wrapper = mountComponent();
    await openFullLibrary(wrapper);
    // 在任意一个已选中的行右键
    await wrapper.findAll(".music-playlist__item")[1].trigger("contextmenu", { clientX: 100, clientY: 100 });
    const menu = ctxMenuEl();
    expect(menu).toBeTruthy();
    expect(menu!.querySelector(".music-playlist__ctxmenu-hint")?.textContent).toContain("已选 2 首");
    const addBtn = [...menu!.querySelectorAll("button")].find((b) => b.textContent?.includes("添加到播放列表"))!;
    addBtn.click();
    expect(mockStore.addSongsToPlaylist).toHaveBeenCalledWith(["a.mp3", "b.mp3"]);
    wrapper.unmount();
  });

  it("右键「删除所选」两步确认后批量删除", async () => {
    mockStore = makeStore({
      playlist: ["a.mp3", "b.mp3"],
      filteredSongs: ["a.mp3", "b.mp3"],
      selection: new Set(["a.mp3", "b.mp3"]),
      deleteSong: vi.fn(async () => true),
    });
    const wrapper = mountComponent();
    await openFullLibrary(wrapper);
    await wrapper.findAll(".music-playlist__item")[0].trigger("contextmenu", { clientX: 100, clientY: 100 });
    const menu = ctxMenuEl();
    expect(menu).toBeTruthy();
    const delBtn = [...menu!.querySelectorAll("button")].find((b) => b.textContent?.includes("删除所选"))!;
    delBtn.click();
    await wrapper.vm.$nextTick();
    expect(mockStore.deleteSong).not.toHaveBeenCalled();
    expect([...menu!.querySelectorAll("button")].some((b) => b.textContent?.includes("确认删除"))).toBe(true);
    delBtn.click();
    await wrapper.vm.$nextTick();
    expect(mockStore.deleteSong).toHaveBeenCalledWith("a.mp3");
    expect(mockStore.deleteSong).toHaveBeenCalledWith("b.mp3");
    wrapper.unmount();
  });

  it("拖拽歌曲到播放列表区 → 加入集合", async () => {
    mockStore = makeStore({
      playlist: ["a.mp3"],
      filteredSongs: ["a.mp3"],
    });
    const wrapper = mountComponent();
    await openFullLibrary(wrapper);
    await wrapper.find(".music-playlist__tab.playlist").trigger("click");
    const item = wrapper.find(".music-playlist__item");
    // 先选中 a.mp3 并开始拖拽（dragstart 携带选择集）
    await item.trigger("click");
    const data = {
      getData: () => JSON.stringify(["a.mp3"]),
      setData: () => undefined,
    } as unknown as DataTransfer;
    await item.trigger("dragstart", { dataTransfer: data });
    const zone = wrapper.find(".music-playlist__collection-items");
    await zone.trigger("drop", { dataTransfer: data });
    expect(mockStore.addSongsToPlaylist).toHaveBeenCalledWith(["a.mp3"]);
    wrapper.unmount();
  });

  it("浏览行不再提供逐行删除（删除走批量），当前歌曲显示播放标记", async () => {
    mockStore = makeStore({
      playlist: ["a.mp3", "b.mp3"],
      filteredSongs: ["a.mp3", "b.mp3"],
      trackName: "a.mp3",
    });
    const wrapper = mountComponent();
    await openFullLibrary(wrapper);
    const items = wrapper.findAll(".music-playlist__item");
    // 当前歌曲显示播放标记
    expect(items[0].find(".music-playlist__playing").exists()).toBe(true);
    // 浏览行无逐行删除按钮（删除是破坏性操作，统一走批量）
    expect(items[1].find(".music-playlist__delete").exists()).toBe(false);
    expect(wrapper.find(".music-playlist__collection").exists()).toBe(true);
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

  it("传输进行中：目标歌未播放 → 曲名显示获取进度", () => {
    mockStore = makeStore({
      playing: false,
      trackName: "old.mp3",
      songTransfer: { state: "downloading", songName: "new.mp3", received: 1, total: 48 },
    });
    const wrapper = mountComponent();
    expect(wrapper.find(".music-player__track-name").text()).toContain("获取歌曲中");
    wrapper.unmount();
  });

  it("传输百分比越界（received>total）→ 钳制为 100%（回归：实测 112%/200w%）", () => {
    mockStore = makeStore({
      playing: false,
      trackName: "old.mp3",
      songTransfer: { state: "downloading", songName: "new.mp3", received: 9999, total: 48 },
    });
    const wrapper = mountComponent();
    const text = wrapper.find(".music-player__track-name").text();
    expect(text).toContain("100%");
    expect(text).not.toContain("20831%");
    wrapper.unmount();
  });

  it("传输状态残留但歌已播放 → 曲名正常显示歌名（不被进度提示锁定）", () => {
    // 回归：传完/本地已有导致 songTransfer 未及时复位时，曲名不能被"获取歌曲中 2%"占住
    mockStore = makeStore({
      playing: true,
      trackName: "a.mp3",
      songTransfer: { state: "downloading", songName: "a.mp3", received: 1, total: 48 },
    });
    const wrapper = mountComponent();
    const name = wrapper.find(".music-player__track-name");
    expect(name.text()).toBe("a.mp3");
    expect(name.text()).not.toContain("获取歌曲中");
    expect(name.classes()).not.toContain("error");
    wrapper.unmount();
  });

  it("传输状态残留但已切到别的歌播放 → 曲名显示当前歌名", () => {
    mockStore = makeStore({
      playing: true,
      trackName: "b.mp3",
      songTransfer: { state: "downloading", songName: "a.mp3", received: 1, total: 48 },
    });
    const wrapper = mountComponent();
    expect(wrapper.find(".music-player__track-name").text()).toBe("b.mp3");
    wrapper.unmount();
  });

  // ===== v4.6.0：传输通道可观察性 =====

  it("P2P 直连通道 → 显示绿色『P2P 直连』徽章", () => {
    mockStore = makeStore({
      playing: false,
      trackName: "old.mp3",
      songTransfer: { state: "downloading", songName: "new.mp3", received: 1, total: 48, channel: "p2p" },
    });
    const wrapper = mountComponent();
    const badge = wrapper.find(".music-player__transfer-channel");
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe("P2P 直连");
    expect(badge.classes()).toContain("music-player__transfer-channel--p2p");
    wrapper.unmount();
  });

  it("服务器中转通道 → 显示黄色『服务器中转』徽章", () => {
    mockStore = makeStore({
      playing: false,
      trackName: "old.mp3",
      songTransfer: { state: "downloading", songName: "new.mp3", received: 1, total: 48, channel: "server" },
    });
    const wrapper = mountComponent();
    const badge = wrapper.find(".music-player__transfer-channel");
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe("服务器中转");
    expect(badge.classes()).toContain("music-player__transfer-channel--server");
    wrapper.unmount();
  });

  it("传输通道未确定（channel=null）→ 不显示徽章", () => {
    mockStore = makeStore({
      playing: false,
      trackName: "old.mp3",
      songTransfer: { state: "requesting", songName: "new.mp3", received: 0, total: 0, channel: null },
    });
    const wrapper = mountComponent();
    expect(wrapper.find(".music-player__transfer-channel").exists()).toBe(false);
    wrapper.unmount();
  });

  it("长曲名溢出 → 启用横向滚动动画（track-scroll active）", async () => {
    const longName = "这是一首特别长的歌曲名称用来测试曲名溢出时是否启用横向滚动动画效果.mp3";
    mockStore = makeStore({ playing: true, trackName: longName });
    const wrapper = mountComponent();
    // jsdom 无真实布局，scrollWidth/clientWidth 恒为 0 → 直接断言滚动容器结构存在
    const scroll = wrapper.find(".music-player__track-scroll");
    expect(scroll.exists()).toBe(true);
    expect(scroll.text()).toBe(longName);
    wrapper.unmount();
  });

  // ===== 音乐库管理（目录树 / 标签筛选 / 播放集合 / 批量） =====

  it("面板显示搜索框与统计（filtered/总数，筛选模式）", async () => {
    mockStore = makeStore({
      playlist: ["a.mp3", "b.mp3"],
      filteredSongs: ["a.mp3"],
      filteredCount: 1,
    });
    const wrapper = mountComponent();
    await openFullLibrary(wrapper);
    await wrapper.find(".music-playlist__tab.filter").trigger("click");
    expect(wrapper.find(".music-playlist__search").exists()).toBe(true);
    expect(wrapper.find(".music-playlist__stats").text()).toBe("1 / 2");
    wrapper.unmount();
  });

  it("目录 tab 点目录调用 toggleDir，筛选 tab 点标签 chip 调用 toggleTag", async () => {
    mockStore = makeStore({
      dirTree: [
        { path: "导入", name: "导入", children: [], count: 0, subtreeCount: 2 },
        { path: "喜欢", name: "喜欢", children: [], count: 1, subtreeCount: 1 },
      ],
      allTags: [{ name: "学习", count: 2 }],
    });
    const wrapper = mountComponent();
    await openFullLibrary(wrapper);
    // 目录 tab（默认）
    const dirs = wrapper.findAll(".music-playlist__dir");
    // 全部 / 未分类 / 导入 / 喜欢
    await dirs[2].trigger("click");
    expect(mockStore.toggleDir).toHaveBeenCalledWith("导入");
    // 筛选 tab：标签 chips
    await wrapper.find(".music-playlist__tab.filter").trigger("click");
    const chips = wrapper.findAll(".music-playlist__tagchip");
    await chips[0].trigger("click");
    expect(mockStore.toggleTag).toHaveBeenCalledWith("学习");
    wrapper.unmount();
  });

  it("播放集合 / 随机播放集合按钮调用 playCollection(false/true)", async () => {
    mockStore = makeStore({
      playlist: ["a.mp3", "b.mp3"],
      filteredSongs: ["a.mp3", "b.mp3"],
      playSet: new Set(["a.mp3", "b.mp3"]),
    });
    const wrapper = mountComponent();
    await openFullLibrary(wrapper);
    // 切到播放列表 tab
    await wrapper.find(".music-playlist__tab.playlist").trigger("click");
    const actions = wrapper.findAll(".music-playlist__collection-actions button");
    await actions[0].trigger("click");
    expect(mockStore.playCollection).toHaveBeenCalledWith(false);
    await actions[1].trigger("click");
    expect(mockStore.playCollection).toHaveBeenCalledWith(true);
    wrapper.unmount();
  });

  it("浏览区底部「全部加入播放列表」调用 addViewToPlaylist 并切到播放列表 tab", async () => {
    mockStore = makeStore({
      playlist: ["a.mp3", "b.mp3"],
      filteredSongs: ["a.mp3", "b.mp3"],
    });
    const wrapper = mountComponent();
    await openFullLibrary(wrapper);
    const addBtn = wrapper
      .findAll(".music-playlist__browse-actions button")
      .find((b) => b.text().includes("全部加入播放列表"))!;
    expect(addBtn.exists()).toBe(true);
    await addBtn.trigger("click");
    await wrapper.vm.$nextTick();
    expect(mockStore.addViewToPlaylist).toHaveBeenCalled();
    // 自动切到播放列表 tab
    expect(wrapper.find(".music-playlist__tab.playlist").classes()).toContain("active");
    wrapper.unmount();
  });

  it("播放列表 tab：显示集合成员与来源，清空按钮调用 clearPlaylistSet", async () => {
    mockStore = makeStore({
      playlist: ["a.mp3", "b.mp3"],
      filteredSongs: ["a.mp3", "b.mp3"],
      playSetActive: true,
      playSetSource: "目录 · 导入",
      playSet: new Set(["a.mp3", "b.mp3"]),
    });
    const wrapper = mountComponent();
    await openFullLibrary(wrapper);
    // 默认目录 tab，播放列表 tab 带数量徽标
    expect(wrapper.find(".music-playlist__tab.dir").classes()).toContain("active");
    expect(wrapper.find(".music-playlist__tab-badge").text()).toBe("2");
    await wrapper.find(".music-playlist__tab.playlist").trigger("click");
    expect(wrapper.find(".music-playlist__source").text()).toContain("目录 · 导入");
    expect(wrapper.findAll(".music-playlist__collection-item")).toHaveLength(2);
    await wrapper.find(".music-playlist__collection-clear").trigger("click");
    expect(mockStore.clearPlaylistSet).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("播放列表 tab：点击集合成员行的 ✕ 调用 removeFromPlaylist", async () => {
    mockStore = makeStore({
      playSet: new Set(["a.mp3", "b.mp3"]),
    });
    const wrapper = mountComponent();
    await openFullLibrary(wrapper);
    await wrapper.find(".music-playlist__tab.playlist").trigger("click");
    const removes = wrapper.findAll(".music-playlist__collection-remove");
    await removes[1].trigger("click");
    expect(mockStore.removeFromPlaylist).toHaveBeenCalledWith("b.mp3");
    wrapper.unmount();
  });

  it("浏览行点击 + 加入播放列表（集合）", async () => {
    mockStore = makeStore({
      playlist: ["x.mp3"],
      filteredSongs: ["x.mp3"],
      songMeta: { "x.mp3": { path: "", tags: [], source: "" } },
    });
    const wrapper = mountComponent();
    await openFullLibrary(wrapper);
    await wrapper.find(".music-playlist__add").trigger("click");
    expect(mockStore.addSongsToPlaylist).toHaveBeenCalledWith(["x.mp3"]);
    wrapper.unmount();
  });

  it("三个选项卡并排：默认目录 tab，切筛选 tab 显示搜索；清除筛选不影响面板与播放列表", async () => {
    mockStore = makeStore({
      playlist: ["a.mp3"],
      filteredSongs: ["a.mp3"],
      hasFilter: true,
      dirTree: [{ path: "导入", name: "导入", children: [], count: 0, subtreeCount: 1 }],
    });
    const wrapper = mountComponent();
    await openFullLibrary(wrapper);
    // 三个 tab 并排
    expect(wrapper.findAll(".music-playlist__tab")).toHaveLength(3);
    // 默认目录 tab：目录树可见，筛选表单不可见
    expect(wrapper.find(".music-playlist__tab.dir").classes()).toContain("active");
    expect(wrapper.find(".music-playlist__dirs").isVisible()).toBe(true);
    expect(wrapper.find(".music-playlist__filters").isVisible()).toBe(false);
    // 切到筛选 tab：搜索框可见
    await wrapper.find(".music-playlist__tab.filter").trigger("click");
    expect(wrapper.find(".music-playlist__filters").isVisible()).toBe(true);
    expect(wrapper.find(".music-playlist__search").isVisible()).toBe(true);
    // 清除筛选：只清筛选，面板仍打开，播放列表区仍在
    await wrapper.find(".music-playlist__clearfilter").trigger("click");
    expect(mockStore.clearFilters).toHaveBeenCalled();
    expect(wrapper.find(".music-playlist").isVisible()).toBe(true);
    expect(wrapper.find(".music-playlist__collection").exists()).toBe(true);
    wrapper.unmount();
  });
});