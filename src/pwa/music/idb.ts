/**
 * IndexedDB 歌曲存储（P2P 传歌落盘 + 合并）
 *
 * 桌面端收到分片后写入本地音乐文件夹；PWA 不能写文件系统，改为 IndexedDB：
 * - store "chunks"：key `${songName}::${index}` → ArrayBuffer（收到的分片）
 * - store "blobs"：key songName → Blob（合并后的完整音频，供 object URL 播放）
 *
 * 命令 music_receive_song_chunk(_bin) / music_finalize_song 走这里。
 * 部门：PWA部门 —— 2026-08 PWA 第一版
 */

const DB_NAME = "pomo-pwa-songs";
const DB_VERSION = 1;
const STORE_CHUNKS = "chunks";
const STORE_BLOBS = "blobs";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) db.createObjectStore(STORE_CHUNKS);
      if (!db.objectStoreNames.contains(STORE_BLOBS)) db.createObjectStore(STORE_BLOBS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function chunkKey(songName: string, index: number): string {
  return `${songName}::${index}`;
}

export async function idbSaveChunk(songName: string, index: number, data: ArrayBuffer): Promise<void> {
  await run(STORE_CHUNKS, "readwrite", (s) => s.put(data, chunkKey(songName, index)));
}

export async function idbGetChunk(songName: string, index: number): Promise<ArrayBuffer | null> {
  return run(STORE_CHUNKS, "readonly", (s) => s.get(chunkKey(songName, index)) as IDBRequest<ArrayBuffer>);
}

export async function idbCountChunks(songName: string): Promise<number> {
  const db = await openDb();
  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction(STORE_CHUNKS, "readonly");
    const store = tx.objectStore(STORE_CHUNKS);
    const keysReq = store.getAllKeys();
    keysReq.onsuccess = () => {
      const prefix = `${songName}::`;
      const count = (keysReq.result as IDBValidKey[]).filter((k) =>
        String(k).startsWith(prefix),
      ).length;
      resolve(count);
    };
    keysReq.onerror = () => reject(keysReq.error);
  });
}

/** 合并分片 → Blob（成功后清理分片） */
export async function idbAssembleBlob(songName: string, totalChunks: number): Promise<Blob | null> {
  const parts: BlobPart[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const chunk = await idbGetChunk(songName, i);
    if (!chunk) return null;
    parts.push(chunk);
  }
  const blob = new Blob(parts, { type: "audio/mpeg" });
  await idbSaveBlob(songName, blob);
  await idbDeleteChunks(songName);
  return blob;
}

export async function idbSaveBlob(songName: string, blob: Blob): Promise<void> {
  await run(STORE_BLOBS, "readwrite", (s) => s.put(blob, songName));
}

export async function idbGetBlob(songName: string): Promise<Blob | null> {
  return run(STORE_BLOBS, "readonly", (s) => s.get(songName) as IDBRequest<Blob>);
}

export async function idbDeleteChunks(songName: string): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_CHUNKS, "readwrite");
    const store = tx.objectStore(STORE_CHUNKS);
    const keysReq = store.getAllKeys();
    keysReq.onsuccess = () => {
      const prefix = `${songName}::`;
      for (const k of keysReq.result as IDBValidKey[]) {
        if (String(k).startsWith(prefix)) store.delete(k);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 删除歌曲全部本地数据（分片 + blob） */
export async function idbDeleteSong(songName: string): Promise<void> {
  await idbDeleteChunks(songName);
  await run(STORE_BLOBS, "readwrite", (s) => s.delete(songName));
}
