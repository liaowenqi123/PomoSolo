/**
 * CDP 内核冒烟自测（不需要任何服务器）
 *   node tools/ui/lib/_selftest.mjs
 * 用 about:blank + 注入 HTML 验证：启动 → 建页 → 视口 → 求值 → 截图。
 */
import { Browser } from "./cdp.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "temp-debug", "ui-shots", "_selftest");
mkdirSync(OUT, { recursive: true });

const browser = await Browser.launch();
console.log(`浏览器：${browser.info.label}`);
console.log(`  版本：${browser.info.version}`);
console.log(`  端口：${browser.port}`);

const page = await browser.newPage({ viewport: { width: 400, height: 240, deviceScaleFactor: 2 } });
await page.goto("about:blank");
await page.evaluate(`(() => {
  document.body.style.cssText = 'margin:0;display:grid;place-items:center;height:100vh;background:#1f2233;color:#ffd54f;font:600 20px/1.5 system-ui,sans-serif';
  document.body.innerHTML = '<div>CDP 内核自测 <span style="color:#5AB48C">OK</span></div>';
})()`);

// 求值往返
const ok = await page.evaluate((a, b) => a + b, 21, 21);
console.log(`求值往返 21+21 = ${ok}`);

// 等条件
await page.waitForFunction("document.readyState === 'complete'");
console.log("waitForFunction OK");

// 截图（整页）
const buf = await page.screenshot({ path: join(OUT, "selftest.png") });
console.log(`截图字节：${buf.length}`);

// 元素截图
await page.screenshot({ path: join(OUT, "selftest-el.png"), selector: "body > div", padding: 12 });
console.log("元素截图 OK");

// 视口尺寸核对（deviceScaleFactor=2 → 800x480 像素）
const meta = await page.evaluate(() => ({
  inner: [window.innerWidth, window.innerHeight],
  dpr: window.devicePixelRatio,
}));
console.log(`视口：inner=${meta.inner.join("x")} dpr=${meta.dpr}`);
if (meta.inner[0] !== 400 || meta.dpr !== 2) throw new Error("视口/DPR 未按预期生效");

await browser.close();
console.log(`\n✅ CDP 内核自测通过。产物：${OUT}`);
