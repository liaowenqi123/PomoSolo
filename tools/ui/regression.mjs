#!/usr/bin/env node
/**
 * UI 回归冒烟测试（发布前跑）
 *
 * 目标不是“截图好看”，而是把项目反复踩过的 UI 类问题变成**断言**：
 *   1. 全局滚动条兜底：任意意外溢出容器都要有 6px 滚动条，不再裸奔；
 *   2. .app-scroll 稳定留槽：内容多少都不挤压布局；
 *   3. z-index 契约：窗口 chrome > 音乐库 sheet，Modal > chrome；
 *   4. 交互回归：右键菜单内 pointerdown 不关面板、✕ 能关面板。
 *
 * 用现有零依赖 CDP 工具，不新增 Playwright 依赖；CI 的自建 Windows runner
 * 自带 Edge，可直接跑。
 */
import { Browser } from "./lib/cdp.mjs";
import { ensureServer } from "./lib/servers.mjs";
import { TARGETS } from "./lib/targets.mjs";
import { buildMockInitScript } from "./lib/tauri-mock.mjs";

const checks = [];
let browser;
let server;

async function check(name, fn) {
  try {
    const detail = await fn();
    checks.push({ name, ok: true, detail });
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (e) {
    checks.push({ name, ok: false, detail: e.message });
    console.error(`  ✗ ${name} — ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function zIndex(page, selector) {
  return page.evaluate(
    (s) => {
      const el = document.querySelector(s);
      return el ? Number(getComputedStyle(el).zIndex) : null;
    },
    selector,
  );
}

async function click(page, selector) {
  const r = await page.clickSelector(selector);
  // 注意：不能断言 clickSelector 的 hitOk —— 展开按钮点完会消失，post-click 校验必然 false。
  // 这里只拦截“启动遮罩还在时就点”的真实事故。
  const cls = String(r.hitBefore?.cls || "");
  assert(!cls.includes("loading-overlay"), `点击被启动遮罩拦截：${selector}`);
  return r;
}

async function isVisible(page, selector) {
  return page.evaluate(
    (s) => {
      const el = document.querySelector(s);
      if (!el) return false;
      const st = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      // position:fixed 元素的 offsetParent 恒为 null，不能用它判断可见
      return st.display !== "none" && st.visibility !== "hidden" && r.width > 0 && r.height > 0;
    },
    selector,
  );
}

async function main() {
  const t = TARGETS.desktop;
  server = await ensureServer("desktop");
  browser = await Browser.launch({ hideScrollbars: false });
  console.log(`▸ 浏览器：${browser.info.label} — ${browser.info.version}`);
  console.log(`▸ ${t.url}  520×560（Tauri 真机尺寸）`);

  const page = await browser.newPage({
    viewport: { width: 520, height: 560, deviceScaleFactor: 1 },
    freezeAnimations: true,
  });
  await page.addInitScript(buildMockInitScript({ scenario: "music-playing", quiet: true }));
  await page.goto(t.url);
  await page.waitForFunction("document.querySelector('.music-playlist-btn')", { timeout: 15000 });
  await page.waitForFunction("document.querySelector('.window-controls')", { timeout: 5000 });
  // 启动遮罩会拦截所有点击（真实用户也要等它消失）
  await page.waitForFunction(
    "(() => { const e = document.querySelector('.loading-overlay'); return !e || getComputedStyle(e).display === 'none' || e.getBoundingClientRect().width === 0; })()",
    { timeout: 20000 },
  );

  await check("全局滚动条兜底：新容器自动获得细滚动条", async () => {
    const width = await page.evaluate(() => {
      const box = document.createElement("div");
      box.id = "__scroll_probe__";
      box.style.cssText =
        "position:fixed;left:-9999px;top:0;width:120px;height:80px;overflow-y:auto";
      box.innerHTML = '<div style="height:500px"></div>';
      document.body.appendChild(box);
      const w = box.offsetWidth - box.clientWidth;
      box.remove();
      return w;
    });
    assert(width >= 4 && width <= 12, `滚动条宽度 ${width}px，期望 4-12px（全局兜底失效？）`);
    return `${width}px`;
  });

  await check(".app-scroll 稳定留槽：内容不溢出也预留滚动条槽", async () => {
    const width = await page.evaluate(() => {
      const box = document.createElement("div");
      box.className = "app-scroll";
      box.style.cssText = "position:fixed;left:-9999px;top:0;width:120px;height:80px";
      box.innerHTML = '<div style="height:20px"></div>';
      document.body.appendChild(box);
      const w = box.offsetWidth - box.clientWidth;
      box.remove();
      return w;
    });
    assert(width >= 4 && width <= 12, `稳定槽宽 ${width}px，期望 4-12px`);
    return `${width}px`;
  });

  await check("窗口圆角契约：.window-frame 为 20px", async () => {
    const radius = await page.evaluate(() => {
      const el = document.querySelector(".window-frame");
      return el ? getComputedStyle(el).borderRadius : null;
    });
    assert(radius === "20px", `.window-frame border-radius=${radius}，期望 20px`);
    return "20px";
  });

  await check("窗口 chrome 的 z-index 高于播放器主体", async () => {
    const zChrome = await zIndex(page, ".window-controls__btn--close");
    const zPlayer = await zIndex(page, ".music-player");
    assert(zChrome > zPlayer, `chrome=${zChrome} 应 > player=${zPlayer}`);
    return `chrome ${zChrome} > player ${zPlayer}`;
  });

  // 打开方式由用户偏好决定：可能先出紧凑浮层，也可能直接全屏
  if (!(await isVisible(page, ".music-list")) && !(await isVisible(page, ".music-playlist"))) {
    await click(page, ".music-playlist-btn");
  }
  await page.waitForFunction(
    "(() => { const a = document.querySelector('.music-list'); const b = document.querySelector('.music-playlist'); const w = (e) => !!(e && e.getBoundingClientRect().width > 0); return w(a) || w(b); })()",
    { timeout: 5000 },
  );
  if (await isVisible(page, ".music-list")) {
    await click(page, ".music-list__btn");
    await page.waitForFunction(
      "(() => { const e = document.querySelector('.music-playlist'); return !!(e && e.getBoundingClientRect().width > 0); })()",
      { timeout: 5000 },
    );
  }

  await check("音乐库全屏 sheet 打开后，窗口 chrome 仍然可点", async () => {
    const zSheet = await zIndex(page, ".music-playlist");
    const zChrome = await zIndex(page, ".window-controls__btn--close");
    assert(zChrome > zSheet, `chrome=${zChrome} 应 > sheet=${zSheet}`);
    const hit = await page.evaluate(() => {
      const btn = document.querySelector(".window-controls__btn--close");
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return el ? { cls: el.className || "", inChrome: !!el.closest(".window-controls") } : null;
    });
    assert(hit && hit.inChrome, `窗口关闭键被遮挡：${JSON.stringify(hit)}`);
    return `chrome ${zChrome} > sheet ${zSheet}`;
  });

  await check("全屏 sheet 的滚动容器确实有细滚动条（不是 0）", async () => {
    const width = await page.evaluate(() => {
      const el = document.querySelector(".music-playlist__items");
      return el ? el.offsetWidth - el.clientWidth : -1;
    });
    assert(width >= 4 && width <= 12, `.music-playlist__items 滚动条 ${width}px`);
    return `${width}px`;
  });

  await check("当前页面所有真正溢出的滚动容器都有滚动条槽（防漏网）", async () => {
    const bad = await page.evaluate(() =>
      [...document.querySelectorAll("*")]
        .filter((el) => {
          const st = getComputedStyle(el);
          const scrollable = st.overflowY === "auto" || st.overflowY === "scroll";
          if (!scrollable) return false;
          if (el.scrollHeight <= el.clientHeight + 1) return false;
          const gutter = el.offsetWidth - el.clientWidth;
          return gutter < 4;
        })
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className || "").slice(0, 80),
          gutter: el.offsetWidth - el.clientWidth,
        })),
    );
    assert(bad.length === 0, `这些滚动容器没有滚动条：${JSON.stringify(bad)}`);
    return "0 个漏网";
  });

  await check("右键菜单内 pointerdown 不关闭整个音乐库（回归 #3）", async () => {
    await page.evaluate(() => {
      const row = document.querySelector(".music-playlist__item");
      if (!row) throw new Error("没有歌曲行");
      const r = row.getBoundingClientRect();
      row.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: r.left + 20,
          clientY: r.top + 20,
        }),
      );
    });
    await page.waitForFunction("document.querySelector('.music-playlist__ctxmenu')");
    await page.evaluate(() => {
      const btn = document.querySelector(".music-playlist__ctxmenu button");
      if (!btn) throw new Error("右键菜单没有按钮");
      btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    assert(await isVisible(page, ".music-playlist"), "菜单内 pointerdown 后音乐库被关闭");
    return "菜单内按下保持面板";
  });

  await check("✕ 可以直接关闭音乐库（区别于 ← 收回紧凑列表）", async () => {
    await click(page, ".music-playlist__close");
    await page.waitForFunction(
      "!document.querySelector('.music-playlist') || getComputedStyle(document.querySelector('.music-playlist')).display === 'none'",
      { timeout: 3000 },
    );
    const visible = await isVisible(page, ".music-playlist");
    assert(!visible, "点 ✕ 后面板仍然可见");
    return "已关闭";
  });

  await check("Modal 层级高于窗口 chrome（设置面板）", async () => {
    await click(page, '[title="设置"]');
    await page.waitForFunction("document.querySelector('.settings-overlay')");
    const zModal = await zIndex(page, ".settings-overlay");
    const zChrome = await zIndex(page, ".window-controls__btn--close");
    assert(zModal > zChrome, `modal=${zModal} 应 > chrome=${zChrome}`);
    await click(page, ".settings-panel__close");
    return `modal ${zModal} > chrome ${zChrome}`;
  });

  await check("全局没有反向 z-index 的 magic number（静态检查在 ui:check）", async () => {
    const z = await page.evaluate(() =>
      [...document.querySelectorAll("*")]
        .map((el) => Number(getComputedStyle(el).zIndex))
        .filter((n) => Number.isFinite(n) && n >= 90000),
    );
    assert(z.length === 0, `发现 >=90000 的临时 z-index：${z.join(",")}`);
    return "无 9999x 临时层级";
  });

  const failed = checks.filter((c) => !c.ok);
  console.log("");
  console.log(`▸ 共 ${checks.length} 项，通过 ${checks.length - failed.length}，失败 ${failed.length}`);
  if (failed.length) {
    const file = "temp-debug/ui-test-failure.png";
    try {
      await page.screenshot({ path: file, fullPage: false });
      console.error(`  失败截图：${file}`);
    } catch { /* ignore */ }
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(`\n✗ UI 回归启动失败：${e.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await browser?.close(); } catch { /* ignore */ }
    try { server?.stop(); } catch { /* ignore */ }
  });
