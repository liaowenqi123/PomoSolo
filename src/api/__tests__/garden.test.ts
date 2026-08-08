import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock @tauri-apps/api/core 的 invoke 函数
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  gardenRead,
  gardenWrite,
  gardenPlant,
  gardenPlantQuick,
  gardenHarvest,
  gardenHarvestAll,
  gardenBuySeed,
  gardenSellCrop,
  gardenSellAll,
  gardenUnlockPlot,
  gardenSignin,
  gardenUpdateFocus,
  gardenPunishment,
  gardenGrow,
  gardenRecordFocus,
  gardenCheckState,
  gardenSeedFromCrop,
} from "../garden";

describe("api/garden", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("gardenRead 应调用 invoke('garden_read') 且无参数", async () => {
    const fakeData = { coins: 100, plots: [] };
    invokeMock.mockResolvedValue(fakeData);

    const result = await gardenRead();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("garden_read");
    expect(result).toEqual(fakeData);
  });

  it("gardenWrite 应调用 invoke('garden_write', { data }) ", async () => {
    invokeMock.mockResolvedValue(true);
    const payload = { coins: 5, plots: [{ id: 0 }] };

    const result = await gardenWrite(payload);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("garden_write", {
      data: payload,
    });
    expect(result).toBe(true);
  });

  it("gardenPlant 应调用 invoke('garden_plant', { plotId, crop })", async () => {
    const fakeResult = { success: true, gardenData: { coins: 1 } };
    invokeMock.mockResolvedValue(fakeResult);

    const result = await gardenPlant(2, "carrot");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("garden_plant", {
      plotId: 2,
      crop: "carrot",
    });
    expect(result).toEqual(fakeResult);
  });

  it("gardenHarvest 应调用 invoke('garden_harvest', { plotId })", async () => {
    const fakeResult = { success: true };
    invokeMock.mockResolvedValue(fakeResult);

    const result = await gardenHarvest(3);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("garden_harvest", {
      plotId: 3,
    });
    expect(result).toEqual(fakeResult);
  });

  it("gardenPlantQuick 应调用 invoke('garden_plant_quick', { plotId }) 并透传 crop 字段", async () => {
    const fakeResult = { success: true, crop: "osmanthus", gardenData: {} };
    invokeMock.mockResolvedValue(fakeResult);

    const result = await gardenPlantQuick(0);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("garden_plant_quick", {
      plotId: 0,
    });
    expect(result.crop).toBe("osmanthus");
  });

  it("gardenHarvestAll 应调用 invoke('garden_harvest_all') 且无参数", async () => {
    const fakeResult = {
      success: true,
      harvested: [{ crop: "carrot", name: "胡萝卜", icon: "🥕", count: 2 }],
      totalCoins: 10,
      gardenData: {},
    };
    invokeMock.mockResolvedValue(fakeResult);

    const result = await gardenHarvestAll();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("garden_harvest_all");
    expect(result.harvested).toEqual([
      { crop: "carrot", name: "胡萝卜", icon: "🥕", count: 2 },
    ]);
    expect(result.totalCoins).toBe(10);
  });

  it("gardenBuySeed 应调用 invoke('garden_buy', { item, price, quantity })", async () => {
    const fakeResult = { success: true };
    invokeMock.mockResolvedValue(fakeResult);

    const result = await gardenBuySeed("tomato", 5);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("garden_buy", {
      item: "tomato",
      price: 16,
      quantity: 5,
    });
    expect(result).toEqual(fakeResult);
  });

  it("gardenSellCrop 应调用 invoke('garden_sell', { item, price, quantity })", async () => {
    const fakeResult = { success: true };
    invokeMock.mockResolvedValue(fakeResult);

    const result = await gardenSellCrop("rose", 2);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("garden_sell", {
      item: "rose",
      price: 80,
      quantity: 2,
    });
    expect(result).toEqual(fakeResult);
  });

  it("gardenUnlockPlot 应调用 invoke('garden_unlock', { plotId })", async () => {
    const fakeResult = { success: true };
    invokeMock.mockResolvedValue(fakeResult);

    const result = await gardenUnlockPlot(7);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("garden_unlock", {
      plotId: 7,
    });
    expect(result).toEqual(fakeResult);
  });

  it("gardenSellAll 应调用 invoke('garden_sell_all') 且无参数", async () => {
    const fakeResult = {
      success: true,
      gardenData: {},
      totalCoins: 120,
      totalItems: 3,
      unlockedAchievements: [],
    };
    invokeMock.mockResolvedValue(fakeResult);

    const result = await gardenSellAll();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("garden_sell_all");
    expect(result).toEqual(fakeResult);
  });

  it("gardenSignin 应调用 invoke('garden_signin') 且无参数", async () => {
    const fakeResult = { success: true, unlockedAchievements: [] };
    invokeMock.mockResolvedValue(fakeResult);

    const result = await gardenSignin();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("garden_signin");
    expect(result).toEqual(fakeResult);
  });

  it("gardenUpdateFocus 应调用 invoke('garden_update_focus', { minutes })", async () => {
    const fakeResult = { success: true };
    invokeMock.mockResolvedValue(fakeResult);

    const result = await gardenUpdateFocus(25);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("garden_update_focus", {
      minutes: 25,
    });
    expect(result).toEqual(fakeResult);
  });

  it("gardenPunishment 应调用 invoke('garden_punishment', { lossAmount })", async () => {
    const fakePunishment = {
      hasLoss: true,
      losses: [
        { crop: "carrot", name: "胡萝卜", icon: "🥕", progress: 10, growTime: 25, revivable: true },
      ],
      totalMinutes: 10,
    };
    invokeMock.mockResolvedValue(fakePunishment);

    const result = await gardenPunishment(30);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("garden_punishment", {
      lossAmount: 30,
    });
    expect(result).toEqual(fakePunishment);
  });

  it("gardenGrow 应调用 invoke('garden_grow', { minutes })", async () => {
    const fakeResult = { success: true, growthApplied: 1, capped: false, gardenData: {} };
    invokeMock.mockResolvedValue(fakeResult);

    const result = await gardenGrow(1);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("garden_grow", { minutes: 1 });
    expect(result.success).toBe(true);
  });

  it("gardenRecordFocus 应调用 invoke('garden_record_focus', { completed }) 并透传 revivedCount", async () => {
    const fakeResult = { success: true, revivedCount: 2, gardenData: {} };
    invokeMock.mockResolvedValue(fakeResult);

    const result = await gardenRecordFocus(true);
    expect(invokeMock).toHaveBeenCalledWith("garden_record_focus", {
      completed: true,
    });
    expect(result.revivedCount).toBe(2);

    await gardenRecordFocus(false);
    expect(invokeMock).toHaveBeenLastCalledWith("garden_record_focus", {
      completed: false,
    });
  });

  it("gardenCheckState 应调用 invoke('garden_check_state') 并透传 tier/languish/unlocks", async () => {
    const fakeResult = {
      success: true,
      tier: { current: 1, best: 1 },
      languish: { level: 0 },
      unlocks: { marketAt: "x" },
      gardenData: {},
    };
    invokeMock.mockResolvedValue(fakeResult);

    const result = await gardenCheckState();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("garden_check_state");
    expect(result.tier?.current).toBe(1);
    expect(result.languish?.level).toBe(0);
    expect(result.unlocks?.marketAt).toBe("x");
  });

  it("gardenSeedFromCrop 应调用 invoke('garden_seed_from_crop', { crop, count })", async () => {
    const fakeResult = { success: true, gardenData: {} };
    invokeMock.mockResolvedValue(fakeResult);

    await gardenSeedFromCrop("carrot", 2);
    expect(invokeMock).toHaveBeenCalledWith("garden_seed_from_crop", {
      crop: "carrot",
      count: 2,
    });

    await gardenSeedFromCrop("tomato");
    expect(invokeMock).toHaveBeenLastCalledWith("garden_seed_from_crop", {
      crop: "tomato",
      count: undefined,
    });
  });

  it("invoke 抛错时应向上传播错误", async () => {
    invokeMock.mockRejectedValue(new Error("backend error"));

    await expect(gardenRead()).rejects.toThrow("backend error");
    await expect(gardenWrite({})).rejects.toThrow("backend error");
    await expect(gardenPlant(0, "x")).rejects.toThrow("backend error");
    await expect(gardenPlantQuick(0)).rejects.toThrow("backend error");
    await expect(gardenHarvest(0)).rejects.toThrow("backend error");
    await expect(gardenHarvestAll()).rejects.toThrow("backend error");
    await expect(gardenBuySeed("x", 1)).rejects.toThrow("backend error");
    await expect(gardenSellCrop("x", 1)).rejects.toThrow("backend error");
    await expect(gardenSellAll()).rejects.toThrow("backend error");
    await expect(gardenUnlockPlot(0)).rejects.toThrow("backend error");
    await expect(gardenSignin()).rejects.toThrow("backend error");
    await expect(gardenUpdateFocus(1)).rejects.toThrow("backend error");
    await expect(gardenPunishment(1)).rejects.toThrow("backend error");
    await expect(gardenGrow(1)).rejects.toThrow("backend error");
    await expect(gardenRecordFocus(true)).rejects.toThrow("backend error");
    await expect(gardenCheckState()).rejects.toThrow("backend error");
    await expect(gardenSeedFromCrop("carrot")).rejects.toThrow("backend error");
  });

  it("所有命令名应使用 snake_case", async () => {
    invokeMock.mockResolvedValue(undefined);

    await gardenRead();
    await gardenWrite({});
    await gardenPlant(0, "carrot");
    await gardenPlantQuick(0);
    await gardenHarvest(0);
    await gardenHarvestAll();
    await gardenBuySeed("carrot", 1);
    await gardenSellCrop("carrot", 1);
    await gardenSellAll();
    await gardenUnlockPlot(0);
    await gardenSignin();
    await gardenUpdateFocus(1);
    await gardenPunishment(1);
    await gardenGrow(1);
    await gardenRecordFocus(true);
    await gardenCheckState();
    await gardenSeedFromCrop("carrot");

    const commands = invokeMock.mock.calls.map((c) => c[0]);
    expect(commands).toEqual([
      "garden_read",
      "garden_write",
      "garden_plant",
      "garden_plant_quick",
      "garden_harvest",
      "garden_harvest_all",
      "garden_buy",
      "garden_sell",
      "garden_sell_all",
      "garden_unlock",
      "garden_signin",
      "garden_update_focus",
      "garden_punishment",
      "garden_grow",
      "garden_record_focus",
      "garden_check_state",
      "garden_seed_from_crop",
    ]);
    // 所有命令名都不应包含大写字符
    for (const cmd of commands) {
      expect(cmd).toBe(cmd.toLowerCase());
    }
  });

  it("gardenWrite 参数名应为 data（不是 gardenData/garden_data）", async () => {
    invokeMock.mockResolvedValue(undefined);
    await gardenWrite({ a: 1 });

    const args = invokeMock.mock.calls[0][1] as Record<string, unknown>;
    expect(args.data).toEqual({ a: 1 });
    expect(args.gardenData).toBeUndefined();
    expect(args.garden_data).toBeUndefined();
  });

  it("gardenPlant/gardenHarvest 参数名应为 plotId（对应 Rust plot_id）", async () => {
    invokeMock.mockResolvedValue(undefined);
    await gardenPlant(5, "x");
    await gardenHarvest(5);

    const plantArgs = invokeMock.mock.calls[0][1] as Record<string, unknown>;
    expect(plantArgs.plotId).toBe(5);
    expect(plantArgs.plotIndex).toBeUndefined();

    const harvestArgs = invokeMock.mock.calls[1][1] as Record<string, unknown>;
    expect(harvestArgs.plotId).toBe(5);
    expect(harvestArgs.plotIndex).toBeUndefined();
  });
});
