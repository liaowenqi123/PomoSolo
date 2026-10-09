/**
 * 生成一个**可压缩的音频文件**用于压缩传输测试。
 *
 * 为什么需要它：真实曲库全是 MP3（本身已压缩），deflate 只能再省约 0.5%（实测
 * 3,482,510 → 3,465,810 字节），压缩路径的收益看不出来。要看出压缩到底有没有用、
 * 并验证压缩帧格式与 deflate-raw 解压正确性，需要一个**未压缩**的音频作为对照。
 * 实测这个 WAV 能省 **72.5%**（1,764,044 → 484,805 字节）。
 *
 * 注：`src/p2p.ts` 有 `ok = comp.length < data.length` 兜底 —— 万一某片压后更大就发原片，
 * 保证"压缩绝不劣于不压缩"。
 *
 * 这里生成标准 16-bit PCM WAV，内容是正弦波（真实音频、非填充噪声，可被 deflate 压缩）。
 */
import { writeFileSync } from "node:fs";

export function makeWav(filePath, { seconds = 20, sampleRate = 44100, freq = 440 } = {}) {
  const numSamples = Math.floor(seconds * sampleRate);
  const dataBytes = numSamples * 2;                 // 单声道 16-bit
  const buf = Buffer.alloc(44 + dataBytes);

  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);          // fmt chunk 大小
  buf.writeUInt16LE(1, 20);           // PCM
  buf.writeUInt16LE(1, 22);           // 单声道
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);  // 字节率
  buf.writeUInt16LE(2, 32);           // 块对齐
  buf.writeUInt16LE(16, 34);          // 位深
  buf.write("data", 36);
  buf.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < numSamples; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 20000);
    buf.writeInt16LE(v, 44 + i * 2);
  }
  writeFileSync(filePath, buf);
  return { bytes: buf.length, path: filePath };
}
