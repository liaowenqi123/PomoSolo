import { describe, it, expect, vi, afterEach } from "vitest";
import { generateRoomName } from "@/utils/roomName";

describe("generateRoomName", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("生成格式为「时段词+名词+空格+两位数编号」", () => {
    const name = generateRoomName();
    expect(name).toMatch(/^[\u4e00-\u9fa5]{2,6} \d{2}$/);
  });

  it("编号在 10-99 之间（两位数）", () => {
    const name = generateRoomName();
    const num = Number(name.split(" ")[1]);
    expect(num).toBeGreaterThanOrEqual(10);
    expect(num).toBeLessThanOrEqual(99);
  });

  it("时段词随当前小时变化（20-23 点为夜晚意象）", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 2, 21, 0, 0)); // 21:00 → 夜读/灯下/萤火…
    const name = generateRoomName();
    expect(name).toMatch(/^(夜读|灯下|萤火|星夜|晚风|月下)/);
  });

  it("凌晨 2 点为守夜意象", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 2, 2, 0, 0)); // 02:00 → 静夜/星火/守夜…
    const name = generateRoomName();
    expect(name).toMatch(/^(静夜|星火|守夜|子时|深蓝|零点)/);
  });

  it("词池充足：同一时段下连续生成 200 个名字互不重复（组合空间大）", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 2, 21, 0, 0));
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(generateRoomName());
    }
    // 时段 6 词 × 名词 37 × 编号 90 ≈ 2 万种组合，200 个采样应几乎全不同
    expect(seen.size).toBeGreaterThan(180);
  });

  it("多次调用可生成不同名字（随机性）", () => {
    vi.spyOn(Math, "random").mockReturnValueOnce(0.1).mockReturnValueOnce(0.9).mockReturnValueOnce(0.5);
    const a = generateRoomName();
    vi.spyOn(Math, "random").mockReturnValueOnce(0.1).mockReturnValueOnce(0.2).mockReturnValueOnce(0.5);
    const b = generateRoomName();
    // 名词池下标不同（0.9 vs 0.2）→ 名字不同
    expect(a).not.toBe(b);
  });
});
