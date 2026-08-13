import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { flushPromises } from "@vue/test-utils";

const downloadSongMock = vi.hoisted(() => vi.fn());
vi.mock("@/api/charts", () => ({
  downloadSong: (...a: unknown[]) => downloadSongMock(...a),
}));

import { useDownloadQueue } from "../downloadQueue";

describe("downloadQueue store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    downloadSongMock.mockReset();
  });

  it("enqueue 空名返回 null，不入队", () => {
    const queue = useDownloadQueue();
    expect(queue.enqueue("", "")).toBeNull();
    expect(queue.enqueue("   ", "")).toBeNull();
    expect(queue.tasks).toHaveLength(0);
  });

  it("enqueue 添加任务并立即开始下载", async () => {
    downloadSongMock.mockResolvedValue({ success: true, status: "downloaded" });
    const queue = useDownloadQueue();
    const id = queue.enqueue("晴天", "周杰伦");
    expect(id).not.toBeNull();
    expect(queue.tasks).toHaveLength(1);
    expect(queue.tasks[0].title).toBe("晴天");
    // 单任务时 enqueue 立即开始下载
    expect(queue.tasks[0].status).toBe("downloading");
    await flushPromises(); // 让 pump 完成，清理计时器
    expect(queue.tasks[0].status).toBe("downloaded");
  });

  it("多任务时后续任务保持 queued，当前任务 downloading", async () => {
    downloadSongMock.mockResolvedValue({ success: true, status: "downloaded" });
    const queue = useDownloadQueue();
    queue.enqueue("歌一", "甲");
    queue.enqueue("歌二", "乙");
    expect(queue.tasks[0].status).toBe("downloading");
    expect(queue.tasks[1].status).toBe("queued");
    await flushPromises();
    await flushPromises();
    expect(queue.tasks.every((t) => t.status === "downloaded")).toBe(true);
  });

  it("isQueued 对已排队任务返回 true，其他返回 false", () => {
    const queue = useDownloadQueue();
    queue.enqueue("晴天", "周杰伦");
    expect(queue.isQueued("晴天", "周杰伦")).toBe(true);
    expect(queue.isQueued("七里香", "周杰伦")).toBe(false);
  });

  it("重复 enqueue 同一首返回 null，不重复入队", () => {
    const queue = useDownloadQueue();
    queue.enqueue("晴天", "周杰伦");
    expect(queue.enqueue("晴天", "周杰伦")).toBeNull();
    expect(queue.tasks).toHaveLength(1);
  });

  it("pump 下载成功后状态变为 downloaded 且 progress=100", async () => {
    downloadSongMock.mockResolvedValue({ success: true, status: "downloaded" });
    const queue = useDownloadQueue();
    queue.enqueue("晴天", "周杰伦");
    await flushPromises();
    expect(downloadSongMock).toHaveBeenCalledWith("晴天", "周杰伦");
    expect(queue.tasks[0].status).toBe("downloaded");
    expect(queue.tasks[0].progress).toBe(100);
  });

  it("pump 下载失败后状态变为对应失败状态", async () => {
    downloadSongMock.mockResolvedValue({ success: false, status: "no_video", error: "未找到" });
    const queue = useDownloadQueue();
    queue.enqueue("不存在的歌", "");
    await flushPromises();
    expect(queue.tasks[0].status).toBe("no_video");
    expect(queue.tasks[0].error).toBe("未找到");
  });

  it("pump 串行下载：多个任务依次调用 downloadSong", async () => {
    downloadSongMock.mockResolvedValue({ success: true, status: "downloaded" });
    const queue = useDownloadQueue();
    queue.enqueue("歌一", "甲");
    queue.enqueue("歌二", "乙");
    await flushPromises();
    await flushPromises();
    expect(downloadSongMock).toHaveBeenCalledTimes(2);
    expect(downloadSongMock).toHaveBeenNthCalledWith(1, "歌一", "甲");
    expect(downloadSongMock).toHaveBeenNthCalledWith(2, "歌二", "乙");
    expect(queue.tasks.every((t) => t.status === "downloaded")).toBe(true);
  });

  it("clearFinished 清除已结束任务，保留未结束任务", async () => {
    downloadSongMock.mockResolvedValue({ success: true, status: "downloaded" });
    const queue = useDownloadQueue();
    queue.enqueue("歌一", "甲");
    await flushPromises(); // 歌一完成
    queue.enqueue("歌二", "乙"); // 歌二进入下载中
    queue.clearFinished();
    expect(queue.tasks.some((t) => t.title === "歌一")).toBe(false);
  });
});
