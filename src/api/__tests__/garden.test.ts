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
  gardenHarvest,
  gardenBuySeed,
  gardenSellCrop,
  gardenUnlockPlot,
  gardenSignin,
  gardenUpdateFocus,
  gardenPunishment,
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

  it("gardenWrite 应调用 invoke('garden_write', { gardenData }) ", async () => {
    invokeMock.mockResolvedValue(true);
    const payload = { coins: 5, plots: [{ id: 0 }] };

    const result = await gardenWrite(payload);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("garden_write", {
      gardenData: payload,
    });
    expect(result).toBe(true);
  });

  it("gardenPlant 应调用 invoke('garden_plant', { plotIndex, seedId })", async () => {
    const fakeResult = { success: true, gardenData: { coins: 1 } };
    invokeMock.mockResolvedValue(fakeResult);

    const result = await gardenPlant(2, "carrot");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("garden_plant", {
      plotIndex: 2,
      seedId: "carrot",
    });
    expect(result).toEqual(fakeResult);
  });

  it("gardenHarvest 应调用 invoke('garden_harvest', { plotIndex })", async () => {
    const fakeResult = { success: true };
    invokeMock.mockResolvedValue(fakeResult);

    const result = await gardenHarvest(3);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("garden_harvest", {
      plotIndex: 3,
    });
    expect(result).toEqual(fakeResult);
  });

  it("gardenBuySeed 应调用 invoke('garden_buy_seed', { seedId, quantity })", async () => {
    const fakeResult = { success: true };
    invokeMock.mockResolvedValue(fakeResult);

    const result = await gardenBuySeed("tomato", 5);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("garden_buy_seed", {
      seedId: "tomato",
      quantity: 5,
    });
    expect(result).toEqual(fakeResult);
  });

  it("gardenSellCrop 应调用 invoke('garden_sell_crop', { cropId, quantity })", async () => {
    const fakeResult = { success: true };
    invokeMock.mockResolvedValue(fakeResult);

    const result = await gardenSellCrop("rose", 2);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("garden_sell_crop", {
      cropId: "rose",
      quantity: 2,
    });
    expect(result).toEqual(fakeResult);
  });

  it("gardenUnlockPlot 应调用 invoke('garden_unlock_plot', { plotIndex })", async () => {
    const fakeResult = { success: true };
    invokeMock.mockResolvedValue(fakeResult);

    const result = await gardenUnlockPlot(7);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("garden_unlock_plot", {
      plotIndex: 7,
    });
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
      losses: [{ type: "coins", amount: 10 }],
      totalMinutes: 30,
    };
    invokeMock.mockResolvedValue(fakePunishment);

    const result = await gardenPunishment(30);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("garden_punishment", {
      lossAmount: 30,
    });
    expect(result).toEqual(fakePunishment);
  });

  it("invoke 抛错时应向上传播错误", async () => {
    invokeMock.mockRejectedValue(new Error("backend error"));

    await expect(gardenRead()).rejects.toThrow("backend error");
    await expect(gardenWrite({})).rejects.toThrow("backend error");
    await expect(gardenPlant(0, "x")).rejects.toThrow("backend error");
    await expect(gardenHarvest(0)).rejects.toThrow("backend error");
    await expect(gardenBuySeed("x", 1)).rejects.toThrow("backend error");
    await expect(gardenSellCrop("x", 1)).rejects.toThrow("backend error");
    await expect(gardenUnlockPlot(0)).rejects.toThrow("backend error");
    await expect(gardenSignin()).rejects.toThrow("backend error");
    await expect(gardenUpdateFocus(1)).rejects.toThrow("backend error");
    await expect(gardenPunishment(1)).rejects.toThrow("backend error");
  });

  it("所有命令名应使用 snake_case", async () => {
    invokeMock.mockResolvedValue(undefined);

    await gardenRead();
    await gardenWrite({});
    await gardenPlant(0, "carrot");
    await gardenHarvest(0);
    await gardenBuySeed("carrot", 1);
    await gardenSellCrop("carrot", 1);
    await gardenUnlockPlot(0);
    await gardenSignin();
    await gardenUpdateFocus(1);
    await gardenPunishment(1);

    const commands = invokeMock.mock.calls.map((c) => c[0]);
    expect(commands).toEqual([
      "garden_read",
      "garden_write",
      "garden_plant",
      "garden_harvest",
      "garden_buy_seed",
      "garden_sell_crop",
      "garden_unlock_plot",
      "garden_signin",
      "garden_update_focus",
      "garden_punishment",
    ]);
    // 所有命令名都不应包含大写字符
    for (const cmd of commands) {
      expect(cmd).toBe(cmd.toLowerCase());
    }
  });

  it("gardenWrite 参数名应为 gardenData（不是 data/garden_data）", async () => {
    invokeMock.mockResolvedValue(undefined);
    await gardenWrite({ a: 1 });

    const args = invokeMock.mock.calls[0][1] as Record<string, unknown>;
    expect(args.gardenData).toEqual({ a: 1 });
    expect(args.data).toBeUndefined();
    expect(args.garden_data).toBeUndefined();
  });

  it("gardenPlant/gardenHarvest 参数名应为 plotIndex", async () => {
    invokeMock.mockResolvedValue(undefined);
    await gardenPlant(5, "x");
    await gardenHarvest(5);

    const plantArgs = invokeMock.mock.calls[0][1] as Record<string, unknown>;
    expect(plantArgs.plotIndex).toBe(5);
    expect(plantArgs.plot_index).toBeUndefined();

    const harvestArgs = invokeMock.mock.calls[1][1] as Record<string, unknown>;
    expect(harvestArgs.plotIndex).toBe(5);
    expect(harvestArgs.plot_index).toBeUndefined();
  });
});
