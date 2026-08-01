import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  studyRoomGetActive,
  studyRoomCreate,
  studyRoomJoin,
  studyRoomLeave,
  studyRoomGetRanking,
  studyRoomGetMembers,
  studyRoomUploadStats,
  studyRoomUpdateStatus,
  studyRoomUpdate,
} from "../studyRoom";

describe("api/studyRoom", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("studyRoomGetActive 默认 publicOnly=true 调用 invoke('study_room_get_active', { publicOnly })", async () => {
    const rooms = [{ id: "abc", name: "Room" }];
    invokeMock.mockResolvedValue(rooms);
    const result = await studyRoomGetActive();
    expect(invokeMock).toHaveBeenCalledWith("study_room_get_active", {
      publicOnly: true,
    });
    expect(result).toEqual(rooms);
  });

  it("studyRoomGetActive 可传 publicOnly=false", async () => {
    invokeMock.mockResolvedValue([]);
    await studyRoomGetActive(false);
    expect(invokeMock).toHaveBeenCalledWith("study_room_get_active", {
      publicOnly: false,
    });
  });

  it("studyRoomCreate 应调用 invoke('study_room_create', { name, description, password }) 并返回 room", async () => {
    const room = { id: "xyz", name: "自习室" };
    invokeMock.mockResolvedValue(room);
    const result = await studyRoomCreate("自习室", "一起学习");
    expect(invokeMock).toHaveBeenCalledWith("study_room_create", {
      name: "自习室",
      description: "一起学习",
      password: "",
    });
    expect(result).toEqual(room);
  });

  it("studyRoomCreate 带密码创建私密房间", async () => {
    invokeMock.mockResolvedValue({ id: "xyz", name: "私密" });
    await studyRoomCreate("私密", "", "8888");
    expect(invokeMock).toHaveBeenCalledWith("study_room_create", {
      name: "私密",
      description: "",
      password: "8888",
    });
  });

  it("studyRoomJoin 应调用 invoke('study_room_join', { roomId, password })", async () => {
    invokeMock.mockResolvedValue(undefined);
    await studyRoomJoin("room-id-123");
    expect(invokeMock).toHaveBeenCalledWith("study_room_join", {
      roomId: "room-id-123",
      password: "",
    });
  });

  it("studyRoomJoin 带密码加入私密房间", async () => {
    invokeMock.mockResolvedValue(undefined);
    await studyRoomJoin("room-id-123", "8888");
    expect(invokeMock).toHaveBeenCalledWith("study_room_join", {
      roomId: "room-id-123",
      password: "8888",
    });
  });

  it("studyRoomUpdate 应调用 invoke('study_room_update', { roomId, ...payload })", async () => {
    invokeMock.mockResolvedValue(true);
    const result = await studyRoomUpdate("room-id", { isPublic: false, password: "1234" });
    expect(invokeMock).toHaveBeenCalledWith("study_room_update", {
      roomId: "room-id",
      isPublic: false,
      password: "1234",
    });
    expect(result).toBe(true);
  });

  it("studyRoomLeave 应调用 invoke('study_room_leave', { roomId })", async () => {
    invokeMock.mockResolvedValue(undefined);
    await studyRoomLeave("room-id-123");
    expect(invokeMock).toHaveBeenCalledWith("study_room_leave", {
      roomId: "room-id-123",
    });
  });

  it("studyRoomGetRanking 应调用 invoke('study_room_get_ranking', { roomId })", async () => {
    const ranking = [{ username: "u", todayMinutes: 30, rank: 1 }];
    invokeMock.mockResolvedValue(ranking);
    const result = await studyRoomGetRanking("room-id");
    expect(invokeMock).toHaveBeenCalledWith("study_room_get_ranking", {
      roomId: "room-id",
    });
    expect(result).toEqual(ranking);
  });

  it("studyRoomGetMembers 应调用 invoke('study_room_get_members', { roomId })", async () => {
    const members = [{ userId: "u-1", username: "u", online: true }];
    invokeMock.mockResolvedValue(members);
    const result = await studyRoomGetMembers("room-id");
    expect(invokeMock).toHaveBeenCalledWith("study_room_get_members", {
      roomId: "room-id",
    });
    expect(result).toEqual(members);
  });

  it("invoke 抛错时应向上传播", async () => {
    invokeMock.mockRejectedValue(new Error("backend error"));
    await expect(studyRoomGetActive()).rejects.toThrow("backend error");
    await expect(studyRoomCreate("n", "d")).rejects.toThrow("backend error");
    await expect(studyRoomJoin("id")).rejects.toThrow("backend error");
    await expect(studyRoomLeave("id")).rejects.toThrow("backend error");
    await expect(studyRoomGetRanking("id")).rejects.toThrow("backend error");
    await expect(studyRoomGetMembers("id")).rejects.toThrow("backend error");
    await expect(studyRoomUploadStats("id", 1, 1)).rejects.toThrow("backend error");
    await expect(studyRoomUpdateStatus("id")).rejects.toThrow("backend error");
    await expect(studyRoomUpdate("id", { isPublic: true })).rejects.toThrow("backend error");
  });

  it("studyRoomUploadStats 应调用 invoke('study_room_upload_stats', { roomId, todayMinutes, todayCount })", async () => {
    invokeMock.mockResolvedValue(true);
    const result = await studyRoomUploadStats("room-1", 25, 1);
    expect(invokeMock).toHaveBeenCalledWith("study_room_upload_stats", {
      roomId: "room-1",
      todayMinutes: 25,
      todayCount: 1,
    });
    expect(result).toBe(true);
  });

  it("studyRoomUpdateStatus 应调用 invoke('study_room_update_status', { roomId })", async () => {
    invokeMock.mockResolvedValue(true);
    const result = await studyRoomUpdateStatus("room-1");
    expect(invokeMock).toHaveBeenCalledWith("study_room_update_status", {
      roomId: "room-1",
    });
    expect(result).toBe(true);
  });

  it("各命令使用不同的 command 名", async () => {
    invokeMock.mockResolvedValue([]);
    await studyRoomGetActive();
    await studyRoomCreate("n", "d");
    invokeMock.mockResolvedValue(undefined);
    await studyRoomJoin("id");
    await studyRoomLeave("id");
    invokeMock.mockResolvedValue([]);
    await studyRoomGetRanking("id");
    await studyRoomGetMembers("id");
    invokeMock.mockResolvedValue(true);
    await studyRoomUploadStats("id", 1, 1);
    await studyRoomUpdateStatus("id");
    await studyRoomUpdate("id", { isPublic: true });
    const names = invokeMock.mock.calls.map((c) => c[0]);
    expect(names).toEqual([
      "study_room_get_active",
      "study_room_create",
      "study_room_join",
      "study_room_leave",
      "study_room_get_ranking",
      "study_room_get_members",
      "study_room_upload_stats",
      "study_room_update_status",
      "study_room_update",
    ]);
  });
});
