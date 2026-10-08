/**
 * Android UI 层级审计的单元自测（不需要设备）
 *
 * 用样例 XML 验证：bounds 解析、px→dp 换算、点击热区判据、越界判据、隐藏节点跳过。
 *
 *   node tools/ui/lib/_android-audit-selftest.mjs
 */
import { auditHierarchy } from "./android-audit.mjs";

/** 样例：1080×1920 @ density 480（=3.0，故 1dp = 3px） */
const SAMPLE_XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" bounds="[0,0][1080,1920]" clickable="false" enabled="true" displayed="true">
    <node index="0" text="专注" resource-id="com.pomogrow.pomosolo:id/tabFocus" class="android.widget.Button" bounds="[0,1800][360,1920]" clickable="true" enabled="true" displayed="true" />
    <node index="1" text="音乐" resource-id="com.pomogrow.pomosolo:id/tabMusic" class="android.widget.Button" bounds="[360,1800][720,1920]" clickable="true" enabled="true" displayed="true" />
    <node index="2" text="太小" resource-id="com.pomogrow.pomosolo:id/tinyBtn" class="android.widget.ImageButton" bounds="[900,100][960,160]" clickable="true" enabled="true" displayed="true" />
    <node index="3" text="越界元素" resource-id="com.pomogrow.pomosolo:id/offScreen" class="android.widget.TextView" bounds="[1000,1900][1200,2000]" clickable="false" enabled="true" displayed="true" />
    <node index="4" text="隐藏的" resource-id="com.pomogrow.pomosolo:id/hidden" class="android.widget.TextView" bounds="[0,0][100,100]" clickable="true" enabled="true" displayed="false" />
    <node index="5" text="25:00" resource-id="com.pomogrow.pomosolo:id/timerText" class="android.widget.TextView" bounds="[300,700][780,1000]" clickable="false" enabled="true" displayed="true" />
  </node>
</hierarchy>`;

const screen = { width: 1080, height: 1920 };
const r = auditHierarchy(SAMPLE_XML, { density: 480, screen, tinyTargetDp: 44 });

console.log(`节点数：${r.nodeCount}（期望 7：根 FrameLayout + 6 个子节点）`);
console.log(`带标签可显示节点：${r.labeledNodeCount}（期望 5：专注/音乐/太小/越界元素/25:00；hidden 因 displayed=false 被排除）`);
console.log(`发现 ${r.findings.length} 条问题：`);
for (const f of r.findings) console.log(`  [${f.kind}] ${f.selector} = ${f.value}`);

let pass = 0, fail = 0;
const check = (cond, okMsg, failMsg) => {
  if (cond) { console.log(`✓ ${okMsg}`); pass++; }
  else { console.error(`✗ ${failMsg}`); fail++; }
};

check(r.nodeCount === 7, "解析出 7 个节点（含根）", `节点数应为 7，实际 ${r.nodeCount}`);
check(r.labeledNodeCount === 5, "带标签可显示节点数为 5", `应为 5，实际 ${r.labeledNodeCount}`);

// tinyBtn: 60×60px @3.0 = 20×20dp < 44dp → 应报 tiny-target
const tiny = r.findings.find((f) => f.kind === "tiny-target" && f.selector.includes("tinyBtn"));
check(!!tiny, `tinyBtn 被报为热区不足（${tiny?.value}）`, "tinyBtn(20×20dp) 应被报为 tiny-target");
check(tiny?.value === "20×20dp", "px→dp 换算正确（60px/3.0 = 20dp）", `换算错误：${tiny?.value}`);

// offScreen: right 1200>1080 且 bottom 2000>1920 → 应报 out-of-viewport
const off = r.findings.find((f) => f.kind === "out-of-viewport" && f.selector.includes("offScreen"));
check(!!off, `offScreen 被报为越界（${off?.value}）`, "offScreen 应被报为 out-of-viewport");
check(off?.value.includes("右溢") && off?.value.includes("下溢"), "越界方向同时报出右溢与下溢", `越界方向不完整：${off?.value}`);

// displayed=false 的节点必须跳过
check(!r.findings.some((f) => f.selector.includes("hidden")), "displayed=false 的节点被正确跳过", "displayed=false 的节点不该被审计");

// 底栏按钮 360×120px @3.0 = 120×40dp → 高度 40dp < 44dp，会被报出来（这是真实发现，不是误报）
const tab = r.findings.find((f) => f.selector.includes("tabFocus"));
check(!!tab && tab.value === "120×40dp", `底栏按钮高度 40dp 被如实报出（${tab?.value}）`, "底栏按钮 40dp 应被报出");

// 不可点击的文本节点不应进 tiny-target（只查 clickable）
check(!r.findings.some((f) => f.kind === "tiny-target" && f.selector.includes("timerText")), "不可点击节点不参与热区判据", "不可点击节点不该报 tiny-target");

// 空 XML 的兜底
const empty = auditHierarchy("", { density: 480 });
check(empty.findings.length === 0 && !!empty.note, "空 XML 不崩且给出说明", "空 XML 处理不正确");

console.log(`\n${fail === 0 ? "✅ 通过" : "❌ 失败"}：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
