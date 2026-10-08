/**
 * 页面诊断采集 + 布局审计
 *
 * 目标：截图之外，**主动发现 UI 问题**。审计项对应本项目历史上真出过的 bug：
 *   - 面板内容少导致高度收缩/跳动（→ `covered` / `out-of-viewport` 能提前暴露）
 *   - 分类按钮太小点不到（→ `tiny-target`，项目规矩是点击热区 ≥44px）
 *   - 工具栏按钮文字被挤成两排（→ `text-clip` / `overflow-x`）
 *   - flex 子项不收缩导致内容被裁（→ `text-clip`）
 *   - 弹窗被祖先 overflow:hidden 物理裁剪（→ `out-of-viewport`）
 *   - 元素被浮层盖住点不到（→ `covered`，命中测试）
 */

/* ─────────────────── 控制台 / 异常 / 网络 采集 ─────────────────── */

/**
 * 开始采集运行时消息。返回 stop()，调用后拿到汇总。
 * @param {import("./cdp.mjs").Page} page
 */
export async function startProbe(page) {
  const errors = [];
  const warnings = [];

  const fmt = (arg) => {
    if (arg == null) return "undefined";
    if ("value" in arg) {
      const v = arg.value;
      if (typeof v === "string") return v;
      try { return JSON.stringify(v); } catch { return String(v); }
    }
    return arg.description ?? arg.unserializableValue ?? arg.type ?? "?";
  };

  await page.send("Runtime.enable");
  await page.send("Log.enable").catch(() => {});
  await page.send("Network.enable").catch(() => {});

  const offConsole = page.on("Runtime.consoleAPICalled", (p) => {
    const text = (p.args ?? []).map(fmt).join(" ");
    if (p.type === "error" || p.type === "assert") errors.push(`[console.${p.type}] ${text}`);
    else if (p.type === "warning") warnings.push(`[console.warn] ${text}`);
  });

  const offEx = page.on("Runtime.exceptionThrown", (p) => {
    const d = p.exceptionDetails;
    const desc = d?.exception?.description ?? d?.text ?? "未知异常";
    errors.push(`[uncaught] ${String(desc).split("\n")[0]}`);
  });

  const offLog = page.on("Log.entryAdded", (p) => {
    const e = p.entry;
    if (!e) return;
    const line = `[${e.source}] ${e.text}${e.url ? ` @ ${e.url}` : ""}`;
    if (e.level === "error") errors.push(line);
    else if (e.level === "warning") warnings.push(line);
  });

  const offNetFail = page.on("Network.loadingFailed", (p) => {
    if (p.canceled) return;
    warnings.push(`[network] 加载失败 ${p.errorText} (${p.type ?? "?"})`);
  });

  return function stop() {
    offConsole(); offEx(); offLog(); offNetFail();
    return { errors: dedupe(errors), warnings: dedupe(warnings) };
  };
}

function dedupe(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const k = String(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

/* ─────────────────── 布局审计 ─────────────────── */

/**
 * 在页面内跑布局审计。
 * @param {import("./cdp.mjs").Page} page
 * @param {{ maxFindings?: number, tinyTarget?: number }} [opts]
 */
export async function auditLayout(page, opts = {}) {
  const maxFindings = opts.maxFindings ?? 80;
  const tinyTarget = opts.tinyTarget ?? 24;

  // 注意：整个审计函数会被序列化注入页面，不能引用外部变量 → 参数显式传入
  const result = await page.evaluate(
    function runAudit(maxFindings, tinyTarget) {
      const findings = [];
      const push = (kind, el, selector, value, detail) => {
        if (findings.length >= maxFindings) return;
        findings.push({ kind, selector, value: String(value), detail, tag: el?.tagName?.toLowerCase?.() ?? "?" });
      };

      const sel = (el) => {
        if (!el || el.nodeType !== 1) return "?";
        const parts = [];
        let cur = el;
        let depth = 0;
        while (cur && cur.nodeType === 1 && depth < 4) {
          let s = cur.tagName.toLowerCase();
          if (cur.id) { s += `#${cur.id}`; parts.unshift(s); break; }
          const cls = (cur.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
          if (cls.length) s += "." + cls.join(".");
          const parent = cur.parentElement;
          if (parent) {
            const sibs = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
            if (sibs.length > 1) s += `:nth-of-type(${sibs.indexOf(cur) + 1})`;
          }
          parts.unshift(s);
          cur = cur.parentElement;
          depth++;
        }
        return parts.join(" > ");
      };

      const visible = (el, cs) => {
        if (cs.display === "none" || cs.visibility === "hidden") return false;
        if (Number(cs.opacity) === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };

      const all = Array.from(document.querySelectorAll("body *"))
        .filter((el) => !el.closest("[data-ui-tool]") && !el.hasAttribute("data-ui-tool"));

      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;

      for (const el of all) {
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;

        // 1) 水平溢出但没给滚动 → 内容被裁
        const scrollableX = cs.overflowX === "auto" || cs.overflowX === "scroll";
        if (!scrollableX && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
          push("overflow-x", el, sel(el), `${el.scrollWidth}>${el.clientWidth}`,
            "内容比容器宽且未开横向滚动，右侧内容被裁");
        }

        // 2) 垂直溢出但没给滚动 → 内容被裁（flex 子项 min-height:auto 的典型症状）
        const scrollableY = cs.overflowY === "auto" || cs.overflowY === "scroll";
        if (!scrollableY && el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0) {
          push("overflow-y", el, sel(el), `${el.scrollHeight}>${el.clientHeight}`,
            "内容比容器高且未开纵向滚动，底部内容被裁（常见根因：flex 子项缺 min-height:0）");
        }

        // 3) 文字被 overflow:hidden 裁掉
        if (cs.overflow === "hidden" && (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2)) {
          const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
          if (hasText) {
            push("text-clip", el, sel(el), `${el.scrollWidth}×${el.scrollHeight} vs ${el.clientWidth}×${el.clientHeight}`,
              "容器 overflow:hidden 且文字超出，文字被裁");
          }
        }

        // 4) 元素跑出视口
        if (r.width > 0 && r.height > 0) {
          const overR = r.right - vw, overB = r.bottom - vh, overL = -r.left, overT = -r.top;
          const worst = Math.max(overR, overB, overL, overT);
          if (worst > 2) {
            const dirs = [];
            if (overR > 2) dirs.push(`右溢 ${Math.round(overR)}px`);
            if (overB > 2) dirs.push(`下溢 ${Math.round(overB)}px`);
            if (overL > 2) dirs.push(`左溢 ${Math.round(overL)}px`);
            if (overT > 2) dirs.push(`上溢 ${Math.round(overT)}px`);
            push("out-of-viewport", el, sel(el), dirs.join(" / "), "元素超出可视区域，可能被祖先 overflow:hidden 裁剪或需滚动才可见");
          }
        }

        // 5) 点击热区过小
        const interactive = el.matches("button, a[href], input, select, textarea, [role=button], [role=tab], [role=menuitem], [onclick], [tabindex]:not([tabindex='-1'])");
        if (interactive && visible(el, cs)) {
          if (r.width < tinyTarget || r.height < tinyTarget) {
            push("tiny-target", el, sel(el), `${Math.round(r.width)}×${Math.round(r.height)}px`,
              `点击热区小于 ${tinyTarget}px，手机上难点击（项目规矩：触摸目标 ≥44px）`);
          }
        }

        // 6) 字号过小
        const fs = parseFloat(cs.fontSize);
        const hasOwnText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
        if (hasOwnText && fs && fs < 10) {
          push("tiny-font", el, sel(el), `${fs}px`, "字号小于 10px，可读性差");
        }
      }

      // 7) 命中测试：可见的交互元素中心点是否真的点到它自己（检测被浮层盖住）
      //    先收集原始结果，再决定是否折叠 —— 整屏遮罩会一次性盖住几十个元素，
      //    逐个报会淹没有效信息（本项目"卡在启动遮罩"就是这种情形）。
      const coveredRaw = [];
      const clickables = all
        .filter((el) => el.matches("button, a[href], input, select, [role=button], [role=tab]"))
        .filter((el) => visible(el, getComputedStyle(el)))
        .slice(0, 120);

      for (const el of clickables) {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        if (cx < 0 || cy < 0 || cx > vw || cy > vh) continue;   // 视口外不算"被盖住"
        const top = document.elementFromPoint(cx, cy);
        if (!top) continue;
        if (top === el || el.contains(top) || top.contains(el)) continue;
        coveredRaw.push({ el, top, cx, cy });
      }

      // 按"遮挡者"分组；某个遮挡者盖住了很多元素 → 判定为整屏遮罩，折叠成一条
      const byBlocker = new Map();
      for (const c of coveredRaw) {
        const k = sel(c.top);
        if (!byBlocker.has(k)) byBlocker.set(k, { top: c.top, items: [] });
        byBlocker.get(k).items.push(c);
      }

      for (const [blockerSel, group] of byBlocker) {
        const rect = group.top.getBoundingClientRect();
        const area = (rect.width * rect.height) / Math.max(1, vw * vh);
        const cs = getComputedStyle(group.top);
        const isOverlay = (cs.position === "fixed" || cs.position === "absolute") && area >= 0.5;

        if (isOverlay) {
          // 一条顶多条：说明界面被一层遮罩整体盖住（典型：加载遮罩 / 模态未关）
          push("overlay-blocking", group.top, blockerSel,
            `覆盖 ${Math.round(area * 100)}% 视口，挡住 ${group.items.length} 个可交互元素`,
            `整屏遮罩（position:${cs.position} z-index:${cs.zIndex}）盖住了界面。` +
            `若是加载遮罩，说明页面仍未进入就绪态（常见根因：后端命令失败/数据未就绪）；` +
            `若是模态遮罩，说明有弹窗没关闭。`);
        } else {
          for (const c of group.items) {
            push("covered", c.el, sel(c.el),
              `中心(${Math.round(c.cx)},${Math.round(c.cy)}) 命中 <${c.top.tagName.toLowerCase()}>`,
              `元素中心被 ${blockerSel} 覆盖，用户点不到它（z-index / 浮层问题）`);
          }
        }
      }

      // 排序：整屏遮罩最能解释其它异常，排最前；其余按"严重程度"排
      const priority = {
        "overlay-blocking": 0,
        "text-clip": 1,
        "out-of-viewport": 2,
        "overflow-y": 3,
        "overflow-x": 4,
        covered: 5,
        "tiny-target": 6,
        "tiny-font": 7,
      };
      findings.sort((a, b) => (priority[a.kind] ?? 99) - (priority[b.kind] ?? 99));

      return {
        viewport: { width: vw, height: vh },
        elementCount: all.length,
        findings,
      };
    },
    maxFindings,
    tinyTarget,
  );

  return result;
}
