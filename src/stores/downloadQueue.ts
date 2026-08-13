/**
 * 音乐下载任务队列
 *
 * 把「点击下载 → 一直 loading」改为队列：多首可排队，串行下载。
 * 每首显示状态（排队/下载中/完成/失败）+ 一条「虚假进度条」——
 * 进度不反映真实阶段，而是随时间缓慢前进（约 1%/秒，封顶 90%），
 * 任务真正完成时才跳到 100%，把"正在处理"的情绪价值给到用户。
 */
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { downloadSong, type DownloadStatus } from "@/api/charts";

export type DownloadTaskStatus =
  | "queued"
  | "downloading"
  | "downloaded"
  | "exists"
  | "no_video"
  | "no_instrumental"
  | "failed";

export interface DownloadTask {
  id: number;
  title: string;
  artist: string;
  status: DownloadTaskStatus;
  /** 0-100 的虚假进度（约 1%/秒，封顶 90%，完成时 100） */
  progress: number;
  error?: string;
}

let nextId = 1;

export const useDownloadQueue = defineStore("downloadQueue", () => {
  const tasks = ref<DownloadTask[]>([]);
  let pumping = false;
  let tickTimer: ReturnType<typeof setInterval> | null = null;

  const hasActive = computed(() =>
    tasks.value.some((t) => t.status === "queued" || t.status === "downloading"),
  );

  function keyOf(title: string, artist: string): string {
    return `${title.trim()} - ${artist.trim()}`;
  }

  /** 该歌是否已在队列中（排队或下载中） */
  function isQueued(title: string, artist: string): boolean {
    const k = keyOf(title, artist);
    return tasks.value.some(
      (t) =>
        keyOf(t.title, t.artist) === k &&
        (t.status === "queued" || t.status === "downloading"),
    );
  }

  function startTicking(): void {
    if (tickTimer) return;
    tickTimer = setInterval(() => {
      const task = tasks.value.find((t) => t.status === "downloading");
      if (task && task.progress < 90) {
        task.progress = Math.min(90, task.progress + 1);
      }
    }, 1000);
  }

  function stopTicking(): void {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  }

  /** 入队一首，返回任务 id；空名或已在队列则返回 null */
  function enqueue(title: string, artist: string): number | null {
    const trimmed = title.trim();
    if (!trimmed) return null;
    if (isQueued(trimmed, artist.trim())) return null;
    const task: DownloadTask = {
      id: nextId++,
      title: trimmed,
      artist: artist.trim(),
      status: "queued",
      progress: 0,
    };
    tasks.value.push(task);
    void pump();
    return task.id;
  }

  /** 串行消费队列：一次只下载一首 */
  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      for (;;) {
        const task = tasks.value.find((t) => t.status === "queued");
        if (!task) break;
        task.status = "downloading";
        task.progress = 0;
        startTicking();
        try {
          const result = await downloadSong(task.title, task.artist);
          if (result.success) {
            task.status = (result.status as DownloadStatus) ?? "downloaded";
            task.progress = 100;
          } else {
            task.status = (result.status as DownloadStatus) ?? "failed";
            task.error = result.error;
          }
        } catch (e) {
          task.status = "failed";
          task.error = e instanceof Error ? e.message : String(e);
        } finally {
          stopTicking();
        }
      }
    } finally {
      stopTicking();
      pumping = false;
    }
  }

  /** 清除已结束的任务（保留排队/下载中） */
  function clearFinished(): void {
    tasks.value = tasks.value.filter(
      (t) => t.status === "queued" || t.status === "downloading",
    );
  }

  return { tasks, hasActive, enqueue, isQueued, clearFinished };
});
