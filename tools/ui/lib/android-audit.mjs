/**
 * Android UI 层级（uiautomator dump XML）解析与布局审计
 *
 * 判据与 Web 端 tools/ui/lib/probe.mjs 的布局审计**保持一致**，
 * 这样两端的问题清单可以直接对照：
 *   tiny-target      点击热区过小（Android 无障碍建议 ≥48dp，本项目规矩 ≥44dp）
 *   out-of-viewport  节点越界
 *
 * bounds 为物理像素，形如 "[0,0][1080,1920]"；dp = px / (density / 160)。
 */

/**
 * @param {string} xml uiautomator dump 的输出
 * @param {{ density?: number, screen?: {width:number,height:number}|null, tinyTargetDp?: number }} [opts]
 * @returns {{ findings: Array<{kind:string,selector:string,value:string,detail:string}>, nodeCount?: number, labeledNodeCount?: number, note?: string }}
 */
export function auditHierarchy(xml, opts = {}) {
  const { density = 160, screen = null, tinyTargetDp = 44 } = opts;
  const findings = [];

  if (!xml || !xml.includes("<hierarchy")) {
    return { findings, note: "未取到 UI 层级（uiautomator 可能被应用禁用、超时，或 dump 到了空文件）" };
  }

  const scale = density / 160; // px → dp 的除数

  // 解析 <node .../>：只取属性，不建树（审计只需要扁平列表）
  const nodes = [];
  const nodeRe = /<node\b([^>]*?)\/?>/g;
  let m;
  while ((m = nodeRe.exec(xml))) {
    const attrs = {};
    const attrRe = /([\w-]+)="([^"]*)"/g;
    let a;
    while ((a = attrRe.exec(m[1]))) attrs[a[1]] = a[2];

    const bm = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(attrs.bounds ?? "");
    if (!bm) continue;
    const x1 = Number(bm[1]), y1 = Number(bm[2]), x2 = Number(bm[3]), y2 = Number(bm[4]);

    nodes.push({
      cls: attrs["class"] ?? "",
      text: attrs["text"] ?? "",
      desc: attrs["content-desc"] ?? "",
      res: attrs["resource-id"] ?? "",
      clickable: attrs["clickable"] === "true",
      enabled: attrs["enabled"] !== "false",
      displayed: attrs["displayed"] !== "false",
      x: x1, y: y1, w: x2 - x1, h: y2 - y1,
      bounds: attrs.bounds,
    });
  }

  const label = (n) => {
    const t = (n.text || n.desc || n.res || n.cls).replace(/\s+/g, " ").trim();
    return t.length > 40 ? t.slice(0, 40) + "…" : t;
  };
  const shortCls = (n) => n.cls.split(".").pop() || n.cls;
  const sel = (n) => `${shortCls(n)}${n.res ? "#" + n.res.split("/").pop() : ""}`;

  for (const n of nodes) {
    if (!n.displayed || !n.enabled) continue;
    if (n.w <= 0 || n.h <= 0) continue;

    // 1) 点击热区过小
    if (n.clickable) {
      const wDp = n.w / scale, hDp = n.h / scale;
      if (wDp < tinyTargetDp || hDp < tinyTargetDp) {
        findings.push({
          kind: "tiny-target",
          selector: sel(n),
          value: `${wDp.toFixed(0)}×${hDp.toFixed(0)}dp`,
          detail: `点击热区小于 ${tinyTargetDp}dp（Android 无障碍建议 ≥48dp）：${label(n)}`,
        });
      }
    }

    // 2) 越界
    if (screen) {
      const over = [];
      if (n.x + n.w > screen.width + 2) over.push(`右溢 ${n.x + n.w - screen.width}px`);
      if (n.y + n.h > screen.height + 2) over.push(`下溢 ${n.y + n.h - screen.height}px`);
      if (n.x < -2) over.push(`左溢 ${-n.x}px`);
      if (n.y < -2) over.push(`上溢 ${-n.y}px`);
      if (over.length) {
        findings.push({
          kind: "out-of-viewport",
          selector: sel(n),
          value: over.join(" / "),
          detail: `节点超出屏幕：${label(n)}`,
        });
      }
    }
  }

  const labeledNodeCount = nodes.filter((n) => n.displayed && (n.text || n.desc)).length;

  return {
    findings,
    nodeCount: nodes.length,
    labeledNodeCount,
    note: labeledNodeCount === 0
      ? "页面上没有任何带文字/描述的可显示节点 —— 可能截到了空白页、启动闪屏，或 uiautomator 被限制"
      : null,
  };
}
