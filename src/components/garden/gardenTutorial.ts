/**
 * 菜园子教程数据 + 渐进解锁判定
 *
 * 每张教程卡片对应菜园子的一块设计，按"行为里程碑"渐进解锁（对应设计蓝图 3.13
 * 「渐进引入节奏」：机制按使用进度逐步解锁，未解锁显示解锁方式，避免认知过载）。
 *
 * 解锁判定全部基于 store 的响应式状态（achievementStats / combo / signIn / tier /
 * plots / achievements），状态变化后教程面板自动解锁，无需额外持久化。
 */
import type { GardenState } from "@/stores/garden";

export interface TutorialCard {
  /** 唯一 key */
  key: string;
  /** 图标 */
  icon: string;
  /** 标题 */
  title: string;
  /** 一句话简介（已解锁时展示） */
  desc: string;
  /** 展开详情（点击卡片后展示） */
  details: string[];
  /** 未解锁时的提示文案 */
  unlockHint: string;
  /** 解锁判定 */
  unlocked: (s: GardenState) => boolean;
}

/** 累计专注分钟数（历史统计） */
function focusMinutes(s: GardenState): number {
  return s.achievementStats?.totalFocusMinutes ?? 0;
}

/** 累计种植次数 */
function plantCount(s: GardenState): number {
  return s.achievementStats?.totalPlantCount ?? 0;
}

/** 累计收获次数 */
function harvestCount(s: GardenState): number {
  return s.achievementStats?.totalHarvestCount ?? 0;
}

/** 是否有枯萎中的作物 */
function hasWiltedPlot(s: GardenState): boolean {
  return (s.plots ?? []).some((p) => p.wilted);
}

/** 是否解锁过隐藏彩蛋成就 */
function hasEasteregg(s: GardenState): boolean {
  return !!s.achievements?.easteregg?.unlocked;
}

export function buildTutorialCards(): TutorialCard[] {
  return [
    {
      key: "intro",
      icon: "🌱",
      title: "认识菜园",
      desc: "菜园是专注的影子：你专注的每一分钟，都会变成作物的成长。",
      details: [
        "种下种子后，专注期间作物自动生长——专注 1 分钟 = 作物 +1 分钟成长。",
        "菜园不是主菜：打开 App 的核心是专注，菜园只是把专注时长翻译成看得见的反馈。",
        "菜园独立成窗，点击主界面侧边栏的菜园图标即可进入。",
      ],
      unlockHint: "进入菜园即可解锁",
      unlocked: () => true,
    },
    {
      key: "plant",
      icon: "🥕",
      title: "第一次种植",
      desc: "点击空土地，弹出选种轮盘，选中种子即可种下。",
      details: [
        "种子从哪来？商店购买、每日签到、成就奖励都会给种子。",
        "点轮盘中带图标的扇区选中种子，灰色扇区表示该种子库存为 0。",
        "种下后作物就开始生长，每种作物成熟所需时间不同（胡萝卜 25 分钟 → 金桂树 180 分钟）。",
      ],
      unlockHint: "进入菜园即可解锁",
      unlocked: () => true,
    },
    {
      key: "stage",
      icon: "🌿",
      title: "生长阶段",
      desc: "作物会经历 幼苗 → 成株 → 成熟 三阶段，有手绘 SVG 生长动画。",
      details: [
        "格子下方进度条显示当前生长进度，达到 100% 即成熟。",
        "成熟后作物披上金色光晕、轻轻摇摆召唤你收获。",
        "枯萎的作物进度冻结，等待专注救活（见「枯萎与救活」）。",
      ],
      unlockHint: "种下一株作物后解锁",
      unlocked: (s) => plantCount(s) >= 1,
    },
    {
      key: "harvest",
      icon: "🌾",
      title: "收获",
      desc: "成熟作物点击即可收获入库；也可以一键全收。",
      details: [
        "点击成熟作物 → 收获进背包（作物背包）；顶部的 🌾 按钮可一键全收所有成熟作物。",
        "收获的作物可以卖给商店换金币，也可以留种再种（设计蓝图已规划，UI 排期中）。",
        "收获越多，成就「初次丰收 / 小有收成 / 丰收达人…」进度越高。",
      ],
      unlockHint: "第一次收获后解锁",
      unlocked: (s) => harvestCount(s) >= 1,
    },
    {
      key: "combo",
      icon: "🔥",
      title: "专注连击",
      desc: "连续完成番茄钟会积累连击，连击 ≥2 时生长速度 ×1.2。",
      details: [
        "每完成一个番茄钟，连击 +1；专注中断（关闭 / 重置 / 被检测违规）连击清零。",
        "连击 ≥2 时状态条显示「🔥 连击×N(加速)」，作物生长享受 ×1.2 加成。",
        "连击是「奖励坚持」：不需要为了种菜过度专注，专注本身就是目的。",
      ],
      unlockHint: "完成一个番茄钟后解锁",
      unlocked: (s) => (s.combo?.best ?? 0) >= 1,
    },
    {
      key: "wilt",
      icon: "🥀",
      title: "枯萎与救活",
      desc: "专注模式被中断（3 次警告 / 运行中重置 / 手动关闭），未成熟作物会枯萎。",
      details: [
        "枯萎的作物垂头枯黄、进度冻结，不会消失——完成一个番茄钟即可救活。",
        "已枯萎的作物再次遭遇惩罚会永久失去（不可挽回）。",
        "枯萎是违规的代价，专注完成后自动恢复，无需担心离线损失。",
      ],
      unlockHint: "体验一次专注中断后解锁",
      unlocked: (s) => hasWiltedPlot(s) || focusMinutes(s) >= 25,
    },
    {
      key: "shop",
      icon: "🏪",
      title: "商店与背包",
      desc: "商店买种子、卖作物；背包查看种子与作物库存。",
      details: [
        "商店：用金币购买种子，或把背包里的作物卖成金币（保底价）。",
        "背包：种子背包 + 作物背包，作物收获后先进背包。",
        "金币来源：卖作物 / 签到 / 成就奖励。",
      ],
      unlockHint: "进入菜园即可解锁",
      unlocked: () => true,
    },
    {
      key: "signin",
      icon: "📅",
      title: "每日签到与成就",
      desc: "每天签到领种子和金币，坚持签到还有里程碑奖励；成就墙记录你的成长。",
      details: [
        "每日签到：当天签到领 1 种随机种子 + 金币；连续签到 7/14/30 天解锁额外奖励。",
        "成就墙：专注 / 收获 / 种植 / 收藏 / 财富 / 坚持 六大类共 23 个成就。",
        "达成成就解锁条件会发放种子 / 金币奖励。",
      ],
      unlockHint: "签到一次后解锁",
      unlocked: (s) => (s.signIn?.totalDays ?? 0) >= 1,
    },
    {
      key: "unlock",
      icon: "🔓",
      title: "解锁土地",
      desc: "菜园默认开放前 6 块地，更多土地用金币或成就解锁。",
      details: [
        "金币解锁：积攒足够金币点击「解锁」即可开垦新地。",
        "成就解锁：部分土地需要达成指定成就（如连续签到 100 天）。",
        "土地越多，可同时种植的作物越多，收获节奏越灵活。",
      ],
      unlockHint: "第一次收获后解锁",
      unlocked: (s) => harvestCount(s) >= 1,
    },
    {
      key: "tier",
      icon: "📊",
      title: "段位与微黄",
      desc: "连续专注天数决定段位（萌芽 → 初绿 → 繁茂 → 丰收）；长时间不打开菜园会「微黄」。",
      details: [
        "段位：连续签到 7 / 14 / 30 天 → Lv1 初绿 / Lv2 繁茂 / Lv3 丰收。",
        "离线太久：菜园变蔫（微黄），完成 1 个番茄钟即恢复生机，段位按连续天数重新计算。",
        "微黄不是惩罚——菜园是等你的，不删作物、不扣进度。",
      ],
      unlockHint: "连续签到 3 天或连击 3 次后解锁",
      unlocked: (s) => (s.tier?.current ?? 0) >= 1 || (s.signIn?.continuousDays ?? 0) >= 3,
    },
    {
      key: "cap",
      icon: "⏱",
      title: "每日生长配额",
      desc: "每天作物最多生长 120 分钟，防止过度专注。",
      details: [
        "专注生长计入每日配额（120 分钟封顶），当天配额用尽后不再生长。",
        "配额按自然日重置——专注之外，请把时间留给生活。",
      ],
      unlockHint: "完成一个番茄钟后解锁",
      unlocked: (s) => focusMinutes(s) >= 25,
    },
    {
      key: "egg",
      icon: "🥚",
      title: "隐藏彩蛋",
      desc: "在设置面板连续点击版本号 5 次，可以解锁隐藏的「发现彩蛋」成就。",
      details: [
        "彩蛋奖励：金桂树种子 ×1 + 金币 ×50。",
        "彩蛋只增不减——是给长期坚持的专注者的惊喜，不会带来任何损失。",
      ],
      unlockHint: "解锁隐藏成就后解锁",
      unlocked: (s) => hasEasteregg(s) || focusMinutes(s) >= 250,
    },
  ];
}
