/**
 * PWA 更新检测与一键更新（手机端强制刷新到新版本的解决方案）
 *
 * 背景：桌面浏览器有 Ctrl+Shift+R 强制刷新，手机浏览器没有可靠方式绕过
 * Service Worker 缓存。vite-plugin-pwa 生成的 sw.js 自带 skipWaiting + clientsClaim
 * （新 SW 安装即接管），缺的是"主动检查 + 触发刷新"。
 *
 * 方案：
 * - checkForUpdate()：调 reg.update() 强制检查（绕过浏览器默认的懒调度），
 *   检测到新 SW（waiting/installing）即置 available；
 * - applyUpdate()：等 controllerchange 后刷新页面加载新资源（4s 兜底强刷）；
 * - App 侧：启动后自动检查一次 + 提供"刷新"按钮 + 检测到新版本弹提示条。
 */
import { PWA_VERSION } from "./config";

export interface UpdateStatus {
  checking: boolean;
  /** 检测到新版本（SW 已就绪待激活） */
  available: boolean;
  message: string;
}

let status: UpdateStatus = { checking: false, available: false, message: "" };
const listeners = new Set<(s: UpdateStatus) => void>();

function setStatus(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch };
  listeners.forEach((fn) => {
    try {
      fn(status);
    } catch {
      /* 忽略监听器异常 */
    }
  });
}

/** 订阅更新状态（返回取消函数） */
export function onUpdateStatus(fn: (s: UpdateStatus) => void): () => void {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

export function isUpdateSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

/** 强制检查更新：reg.update() 绕过浏览器懒调度，检测新 SW 即 available=true */
export async function checkForUpdate(): Promise<boolean> {
  if (!isUpdateSupported()) return false;
  setStatus({ checking: true });
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) {
      setStatus({ checking: false });
      return false;
    }
    if (reg.waiting || reg.installing) {
      setStatus({ checking: false, available: true, message: `新版本已就绪（v${PWA_VERSION} → 最新）` });
      return true;
    }
    await reg.update();
    // updatefound 后轮询 waiting/installing 出现（最长 8s）
    await new Promise<void>((resolve) => {
      const t0 = Date.now();
      const check = () => {
        if (reg.waiting || reg.installing) {
          resolve();
          return;
        }
        if (Date.now() - t0 > 8000) {
          resolve();
          return;
        }
        setTimeout(check, 200);
      };
      check();
    });
    const available = !!(reg.waiting || reg.installing);
    setStatus({
      checking: false,
      available,
      message: available ? `新版本已就绪（v${PWA_VERSION} → 最新）` : "",
    });
    return available;
  } catch (e) {
    console.warn("[PWA] 更新检查失败:", e);
    setStatus({ checking: false });
    return false;
  }
}

/**
 * 应用更新：新 SW 自带 skipWaiting + clientsClaim，激活后 controllerchange
 * 触发 → 刷新页面加载新资源（4s 兜底强刷）。
 */
export function applyUpdate(): void {
  void (async () => {
    const reload = () => window.location.reload();
    if (!isUpdateSupported()) {
      reload();
      return;
    }
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) {
      reload();
      return;
    }
    const sw = reg.waiting || reg.installing;
    if (sw) {
      navigator.serviceWorker.addEventListener("controllerchange", reload);
      // sw.js 自带 skipWaiting；若仍卡在 installing 稍后自动接管
      setTimeout(reload, 4000);
    } else {
      // 无待激活 SW：先强制检查，再试一次；仍无则直接强刷兜底
      const found = await checkForUpdate();
      if (found) {
        applyUpdate();
      } else {
        reload();
      }
    }
  })();
}
