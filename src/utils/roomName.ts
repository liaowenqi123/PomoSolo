/**
 * 自习室随机名称生成器（🎲 一键随机，可多次随机）
 *
 * 设计：时段意象 + 学习名词 + 两位数编号
 * - 时段意象按当前小时分段（晨光/午后/夜读…），让名字与时间相关、不完全无意义
 * - 名词池为自习/专注意象；每次调用随机组合，多点几次每次都是新名字
 * - 格式示例：`暮色书桌 23`、`夜读萤火 41`、`晨光心流 07`
 */
export function generateRoomName(): string {
  const hour = new Date().getHours();
  const timeWords = pickTimeWords(hour);
  const nouns = ["番茄", "书桌", "笔尖", "心流", "灯塔", "岛屿", "树洞", "穹顶", "花园", "时光"];
  const timeWord = timeWords[Math.floor(Math.random() * timeWords.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  // 两位数编号（10-99），同前缀多房间可区分
  const num = Math.floor(Math.random() * 90) + 10;
  return `${timeWord}${noun} ${num}`;
}

/** 按当前小时返回该时段的意象词池（7 个时段，含凌晨/清晨/上午/正午/午后/黄昏/夜晚） */
function pickTimeWords(hour: number): string[] {
  if (hour >= 5 && hour < 8) return ["晨光", "破晓", "朝阳"];
  if (hour >= 8 && hour < 11) return ["书页", "启程", "窗台"];
  if (hour >= 11 && hour < 13) return ["正午", "日悬", "暖阳"];
  if (hour >= 13 && hour < 17) return ["午后", "余晖", "慢煮"];
  if (hour >= 17 && hour < 20) return ["黄昏", "暮色", "归途"];
  if (hour >= 20 && hour < 23) return ["夜读", "灯下", "萤火"];
  return ["静夜", "星火", "守夜"]; // 23:00 - 05:00
}
