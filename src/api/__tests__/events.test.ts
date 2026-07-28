import { describe, it, expect, beforeEach, vi } from "vitest";
import { effectScope } from "vue";

// Mock @tauri-apps/api/event
const listenMock = vi.fn();
const onceMock = vi.fn();
const emitMock = vi.fn();
const emitToMock = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
  once: (...args: unknown[]) => onceMock(...args),
  emit: (...args: unknown[]) => emitMock(...args),
  emitTo: (...args: unknown[]) => emitToMock(...args),
  TauriEvent: {
    WINDOW_CLOSE: "tauri://close-requested",
    WINDOW_FOCUS: "tauri://window-focus",
    WINDOW_BLUR: "tauri://window-blur",
  },
}));

import {
  listen,
  once,
  emit,
  emitTo,
  TauriEvent,
  useTauriEvent,
  useTauriEventOnce,
} from "../events";

// 辅助：等待微任务队列排空（让 void start() 的 async 完成）
function flushMicrotasks(): Promise<void> {
  return Promise.resolve().then(() => Promise.resolve()).then(() => undefined);
}

describe("api/events — re-exports", () => {
  beforeEach(() => {
    listenMock.mockReset();
    onceMock.mockReset();
    emitMock.mockReset();
    emitToMock.mockReset();
  });

  it("listen 应是 @tauri-apps/api/event 的 listen 包装", async () => {
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);

    const handler = () => {};
    const result = await listen("test-event", handler);

    expect(listenMock).toHaveBeenCalledTimes(1);
    expect(listenMock).toHaveBeenCalledWith("test-event", handler);
    expect(result).toBe(unlisten);
  });

  it("emit 应是 @tauri-apps/api/event 的 emit 包装", async () => {
    emitMock.mockResolvedValue(undefined);

    await emit("test-event", { foo: "bar" });

    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(emitMock).toHaveBeenCalledWith("test-event", { foo: "bar" });
  });

  it("once 应是 @tauri-apps/api/event 的 once 包装", async () => {
    const unlisten = vi.fn();
    onceMock.mockResolvedValue(unlisten);

    const handler = () => {};
    const result = await once("once-event", handler);

    expect(onceMock).toHaveBeenCalledTimes(1);
    expect(onceMock).toHaveBeenCalledWith("once-event", handler);
    expect(result).toBe(unlisten);
  });

  it("emitTo 应是 @tauri-apps/api/event 的 emitTo 包装", async () => {
    emitToMock.mockResolvedValue(undefined);

    await emitTo("target", "event", { data: 1 });

    expect(emitToMock).toHaveBeenCalledTimes(1);
    expect(emitToMock).toHaveBeenCalledWith("target", "event", { data: 1 });
  });

  it("TauriEvent 应被正确 re-export", () => {
    expect(TauriEvent).toBeDefined();
    // 验证 mock 中定义的 TauriEvent 成员可访问
    expect(TauriEvent.WINDOW_FOCUS).toBe("tauri://window-focus");
  });

  it("listen 与 emit 应使用不同的 mock（非同一函数）", async () => {
    listenMock.mockResolvedValue(() => {});
    emitMock.mockResolvedValue(undefined);

    await listen("a", () => {});
    await emit("a", 1);

    expect(listenMock).toHaveBeenCalledTimes(1);
    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(listenMock).not.toBe(emitMock);
  });
});

describe("api/events — useTauriEvent", () => {
  beforeEach(() => {
    listenMock.mockReset();
    onceMock.mockReset();
    emitMock.mockReset();
    emitToMock.mockReset();
  });

  it("默认 immediate=true 时应自动开始监听", async () => {
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);

    const scope = effectScope();
    const result = scope.run(() => {
      return useTauriEvent("test-event", () => {});
    });

    await flushMicrotasks();

    expect(listenMock).toHaveBeenCalledTimes(1);
    expect(listenMock).toHaveBeenCalledWith(
      "test-event",
      expect.any(Function),
      undefined
    );
    expect(result!.ready).toBe(true);
    expect(result!.unlisten).toBe(unlisten);

    scope.stop();
  });

  it("immediate=false 时不应自动监听", async () => {
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);

    const scope = effectScope();
    const result = scope.run(() => {
      return useTauriEvent("test-event", () => {}, { immediate: false });
    });

    await flushMicrotasks();

    expect(listenMock).not.toHaveBeenCalled();
    expect(result!.ready).toBe(false);
    expect(result!.unlisten).toBeNull();

    scope.stop();
  });

  it("immediate=false 时手动 start() 后应开始监听", async () => {
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);

    const scope = effectScope();
    const result = scope.run(() => {
      return useTauriEvent("test-event", () => {}, { immediate: false });
    });

    await flushMicrotasks();
    expect(result!.ready).toBe(false);

    await result!.start();
    expect(listenMock).toHaveBeenCalledTimes(1);
    expect(result!.ready).toBe(true);

    scope.stop();
  });

  it("重复 start() 不应重复注册监听", async () => {
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);

    const scope = effectScope();
    const result = scope.run(() => {
      return useTauriEvent("test-event", () => {});
    });

    await flushMicrotasks();
    expect(listenMock).toHaveBeenCalledTimes(1);

    await result!.start();
    expect(listenMock).toHaveBeenCalledTimes(1); // 仍是 1 次

    scope.stop();
  });

  it("stop() 应调用 unlisten 并清除状态", async () => {
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);

    const scope = effectScope();
    const result = scope.run(() => {
      return useTauriEvent("test-event", () => {});
    });

    await flushMicrotasks();
    expect(result!.ready).toBe(true);

    result!.stop();
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(result!.ready).toBe(false);
    expect(result!.unlisten).toBeNull();

    scope.stop();
  });

  it("作用域销毁时应自动调用 stop（onScopeDispose）", async () => {
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);

    const scope = effectScope();
    scope.run(() => {
      useTauriEvent("test-event", () => {});
    });

    await flushMicrotasks();
    expect(unlisten).not.toHaveBeenCalled();

    scope.stop();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("传入 target 时应将其作为 listenOptions 传递", async () => {
    listenMock.mockResolvedValue(vi.fn());

    const scope = effectScope();
    scope.run(() => {
      useTauriEvent("test-event", () => {}, { target: { label: "main" } as any });
    });

    await flushMicrotasks();

    expect(listenMock).toHaveBeenCalledWith(
      "test-event",
      expect.any(Function),
      { target: { label: "main" } }
    );

    scope.stop();
  });

  it("未传 target 时 listenOptions 应为 undefined", async () => {
    listenMock.mockResolvedValue(vi.fn());

    const scope = effectScope();
    scope.run(() => {
      useTauriEvent("test-event", () => {});
    });

    await flushMicrotasks();

    expect(listenMock).toHaveBeenCalledWith(
      "test-event",
      expect.any(Function),
      undefined
    );

    scope.stop();
  });

  it("stop() 后再次 stop() 不应重复调用 unlisten", async () => {
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);

    const scope = effectScope();
    const result = scope.run(() => {
      return useTauriEvent("test-event", () => {});
    });

    await flushMicrotasks();

    result!.stop();
    result!.stop(); // 再次调用

    expect(unlisten).toHaveBeenCalledTimes(1);

    scope.stop();
  });
});

describe("api/events — useTauriEventOnce", () => {
  beforeEach(() => {
    onceMock.mockReset();
    listenMock.mockReset();
  });

  it("应使用 once 而非 listen 注册监听", async () => {
    const unlisten = vi.fn();
    onceMock.mockResolvedValue(unlisten);

    const scope = effectScope();
    scope.run(() => {
      useTauriEventOnce("once-event", () => {});
    });

    await flushMicrotasks();

    expect(onceMock).toHaveBeenCalledTimes(1);
    expect(onceMock).toHaveBeenCalledWith(
      "once-event",
      expect.any(Function),
      undefined
    );
    expect(listenMock).not.toHaveBeenCalled();

    scope.stop();
  });

  it("作用域销毁时应自动调用 unlisten", async () => {
    const unlisten = vi.fn();
    onceMock.mockResolvedValue(unlisten);

    const scope = effectScope();
    scope.run(() => {
      useTauriEventOnce("once-event", () => {});
    });

    await flushMicrotasks();
    expect(unlisten).not.toHaveBeenCalled();

    scope.stop();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("返回的对象应包含 stop 方法", () => {
    onceMock.mockResolvedValue(vi.fn());

    const scope = effectScope();
    const result = scope.run(() => {
      return useTauriEventOnce("once-event", () => {});
    });

    expect(result).toHaveProperty("stop");
    expect(typeof result!.stop).toBe("function");

    scope.stop();
  });

  it("传入 target 时应传递给 once", async () => {
    onceMock.mockResolvedValue(vi.fn());

    const scope = effectScope();
    scope.run(() => {
      useTauriEventOnce("once-event", () => {}, { target: { label: "main" } as never });
    });

    await flushMicrotasks();

    expect(onceMock).toHaveBeenCalledWith(
      "once-event",
      expect.any(Function),
      { target: { label: "main" } }
    );

    scope.stop();
  });

  it("手动 stop() 应调用 unlisten", async () => {
    const unlisten = vi.fn();
    onceMock.mockResolvedValue(unlisten);

    const scope = effectScope();
    const result = scope.run(() => {
      return useTauriEventOnce("once-event", () => {});
    });

    await flushMicrotasks();

    result!.stop();
    expect(unlisten).toHaveBeenCalledTimes(1);

    scope.stop();
    // scope.stop 后不应再次调用（已清空）
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
