/**
 * 零依赖 Chrome DevTools Protocol (CDP) 客户端（UI 取证工具内核）
 *
 * 为什么不用 Playwright/Puppeteer：
 *   - 仓库里没有这两个包，装了要下 ~150MB 浏览器 + 污染 package.json；
 *   - 本机已有 Chrome/Edge，Node 24 自带 fetch 与全局 WebSocket，够用。
 *
 * 用法：
 *   const browser = await Browser.launch();
 *   const page = await browser.newPage({ viewport: { width: 520, height: 560 } });
 *   await page.goto("http://127.0.0.1:18421/");
 *   await page.screenshot({ path: "out.png" });
 *   await browser.close();
 *
 * 注意：Chrome 用 stdio:'ignore' 启动（不需要它的 stdout，也避免管道相关的沙箱限制）。
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { findBrowser } from "./browsers.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 常用按键的 Windows 虚拟键码（Input.dispatchKeyEvent 需要） */
const KEYCODES = {
  Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46,
  ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
  Home: 36, End: 35, PageUp: 33, PageDown: 34,
  " ": 32, Space: 32,
};

/** 等待条件成立 */
async function until(fn, { timeout = 15000, interval = 50, what = "条件" } = {}) {
  const deadline = Date.now() + timeout;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) { lastErr = e; }
    await sleep(interval);
  }
  throw new Error(`等待超时（${timeout}ms）：${what}${lastErr ? `；最后一次错误：${lastErr.message}` : ""}`);
}

/* ──────────────────────────── CDP 传输层 ──────────────────────────── */

class Connection {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.eventHandlers = new Map(); // method -> Set<fn>
    this.closed = false;

    ws.addEventListener("message", (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }

      if (msg.id != null) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${msg.error.message}${msg.error.data ? ` — ${msg.error.data}` : ""}`));
        else p.resolve(msg.result);
        return;
      }

      if (msg.method) {
        const set = this.eventHandlers.get(msg.method);
        if (set) for (const fn of set) { try { fn(msg.params, msg.sessionId); } catch (e) { console.error(e); } }
      }
    });

    ws.addEventListener("close", () => {
      this.closed = true;
      for (const [, p] of this.pending) p.reject(new Error("CDP 连接已关闭"));
      this.pending.clear();
    });
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const t = setTimeout(() => reject(new Error(`连接 CDP 超时：${url}`)), 15000);
      ws.addEventListener("open", () => { clearTimeout(t); resolve(new Connection(ws)); });
      ws.addEventListener("error", () => { clearTimeout(t); reject(new Error(`连接 CDP 失败：${url}`)); });
    });
  }

  /** 发送一条 CDP 命令 */
  send(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(new Error("CDP 连接已关闭"));
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 命令超时：${method}`));
        }
      }, 60000);
    });
  }

  on(method, fn) {
    if (!this.eventHandlers.has(method)) this.eventHandlers.set(method, new Set());
    this.eventHandlers.get(method).add(fn);
    return () => this.eventHandlers.get(method)?.delete(fn);
  }

  /** 等待一次事件（可带谓词） */
  once(method, predicate, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const off = this.on(method, (params, sid) => {
        if (predicate && !predicate(params, sid)) return;
        off();
        clearTimeout(t);
        resolve(params);
      });
      const t = setTimeout(() => { off(); reject(new Error(`等待事件超时：${method}`)); }, timeout);
    });
  }

  close() { try { this.ws.close(); } catch { /* ignore */ } this.closed = true; }
}

/* ──────────────────────────── 页面 ──────────────────────────── */

export class Page {
  /** @param {Browser} browser @param {string} sessionId */
  constructor(browser, sessionId, opts = {}) {
    this.browser = browser;
    this.sessionId = sessionId;
    this.conn = browser.conn;
    this.closed = false;
    /** true = 附着在**已存在**的页面上（如真实 Tauri 的 WebView2）→ 关连接但不关目标 */
    this.attached = opts.attached === true;
  }

  send(method, params) { return this.conn.send(method, params, this.sessionId); }
  on(method, fn) {
    // 附着模式下 sessionId 为 undefined，事件也不带 sessionId → 直接透传
    if (this.attached) return this.conn.on(method, fn);
    return this.conn.on(method, (p, sid) => { if (sid === this.sessionId) fn(p, sid); });
  }

  /** 设置视口（含 DPI 缩放与移动端模拟） */
  async setViewport({ width, height, deviceScaleFactor = 1, mobile = false }) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width, height, deviceScaleFactor, mobile,
      screenWidth: width, screenHeight: height,
    });
    this.viewport = { width, height, deviceScaleFactor, mobile };
  }

  /** 冻结动画/过渡，让截图可复现（配合 prefers-reduced-motion） */
  async freezeAnimations() {
    await this.send("Emulation.setEmulatedMedia", {
      media: "screen",
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    const style = await this.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `
        (() => {
          const css = document.createElement('style');
          css.textContent = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important;}';
          document.addEventListener('DOMContentLoaded', () => document.head.appendChild(css));
          if (document.head) document.head.appendChild(css);
        })();
      `,
    });
    this._freezeScript = style.identifier;
  }

  /** 在页面导航前注入脚本（每次新文档都会执行） */
  async addInitScript(source) {
    const r = await this.send("Page.addScriptToEvaluateOnNewDocument", { source });
    return r.identifier;
  }

  /** 注入 CSS（当前文档） */
  async injectCss(css) {
    const escaped = JSON.stringify(css);
    await this.evaluate(`(() => {
      const el = document.createElement('style');
      el.setAttribute('data-ui-tool', '1');
      el.textContent = ${escaped};
      document.head.appendChild(el);
    })()`);
  }

  /**
   * 导航。
   * @param {string} url
   * @param {{ waitUntil?: "load"|"domcontentloaded"|"networkidle", timeout?: number }} [opts]
   */
  async goto(url, { waitUntil = "load", timeout = 30000, settle = 120 } = {}) {
    await this.send("Page.enable");
    await this.send("Runtime.enable");

    const loadEvent = this.conn.once("Page.loadEventFired", null, timeout).catch(() => null);
    const frameEvent = waitUntil === "domcontentloaded"
      ? this.conn.once("Page.domContentEventFired", null, timeout).catch(() => null)
      : null;

    const res = await this.send("Page.navigate", { url });
    if (res.errorText) throw new Error(`导航失败 ${url}：${res.errorText}`);

    if (frameEvent) await frameEvent;
    else await loadEvent;

    // 交换式染色可能还没完成；再等 readyState 与一个微小时隙
    await this.waitForFunction("document.readyState === 'complete'", { timeout }).catch(() => {});
    if (settle) await sleep(settle);
    return res;
  }

  /**
   * 在页面里求值。
   * 传函数则序列化后以参数调用；传字符串则直接当表达式。
   */
  async evaluate(fnOrExpr, ...args) {
    const expression = typeof fnOrExpr === "function"
      ? `(${fnOrExpr.toString()})(${args.map((a) => JSON.stringify(a)).join(",")})`
      : fnOrExpr;
    const r = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(`页面求值异常：${d.exception?.description ?? d.text}`);
    }
    return r.result?.value;
  }

  /** 轮询等待页面内条件成立 */
  async waitForFunction(fnOrExpr, { timeout = 15000, interval = 60 } = {}) {
    const expression = typeof fnOrExpr === "function" ? `(${fnOrExpr.toString()})()` : fnOrExpr;
    return until(async () => {
      const r = await this.send("Runtime.evaluate", {
        expression: `(() => { try { return !!(${expression}); } catch (e) { return false; } })()`,
        returnByValue: true,
      });
      return r.result?.value === true;
    }, { timeout, interval, what: `页面条件 ${String(expression).slice(0, 80)}` });
  }

  /**
   * 等 DOM 静止（无新增/删除节点、无属性变化持续 idleMs）。
   *
   * 为什么需要：本项目 App.vue 的加载遮罩是在 `onMounted` 完成后
   * **再 setTimeout 800ms** 才隐藏（见 src/App.vue 的 loading 逻辑），
   * 固定等待很容易抢在它前面截图 → 截到"正在启动…"的糊图。
   * 用"DOM 不再变化"作为就绪信号比固定 sleep 稳得多。
   *
   * @param {{ idleMs?: number, timeout?: number, ignore?: string }} [opts]
   *   ignore：CSS 选择器，命中的子树内的变化不计入（例如秒级跳动的时钟）
   */
  async waitForDomIdle({ idleMs = 350, timeout = 8000, ignore = null } = {}) {
    const verdict = await this.evaluate(
      `new Promise((resolve) => {
        const IDLE = ${idleMs}, TIMEOUT = ${timeout}, IGNORE = ${JSON.stringify(ignore)};
        let settled = false;
        let idleTimer = null, hardTimer = null, observer = null;
        const finish = (why) => {
          if (settled) return;
          settled = true;
          clearTimeout(idleTimer); clearTimeout(hardTimer);
          try { observer && observer.disconnect(); } catch (e) {}
          resolve(why);
        };
        const bump = () => {
          clearTimeout(idleTimer);
          idleTimer = setTimeout(() => finish('idle'), IDLE);
        };
        observer = new MutationObserver((records) => {
          if (IGNORE) {
            const ig = document.querySelector(IGNORE);
            if (ig && records.every((r) => ig.contains(r.target) || r.target === ig)) return;
          }
          bump();
        });
        observer.observe(document.documentElement, {
          subtree: true, childList: true, attributes: true, characterData: true,
        });
        hardTimer = setTimeout(() => finish('timeout'), TIMEOUT);
        bump();
      })`,
    );
    return verdict;
  }

  /** 等网络空闲（简易版：等资源计数归零或超时） */
  async waitForNetworkIdle({ idleMs = 500, timeout = 15000 } = {}) {
    let inflight = 0;
    let lastChange = Date.now();
    const offReq = this.on("Network.requestWillBeSent", () => { inflight++; lastChange = Date.now(); });
    const offDone = this.on("Network.loadingFinished", () => { inflight = Math.max(0, inflight - 1); lastChange = Date.now(); });
    const offFail = this.on("Network.loadingFailed", () => { inflight = Math.max(0, inflight - 1); lastChange = Date.now(); });
    await this.send("Network.enable");
    try {
      await until(() => inflight === 0 && Date.now() - lastChange >= idleMs, { timeout, interval: 100, what: "网络空闲" });
    } finally { offReq(); offDone(); offFail(); }
  }

  /* ─────────────── 真实输入（走输入管线，不是 el.click()） ───────────────
   *
   * 为什么不用 `el.click()`：那是**直接调用 DOM 事件**，绕过了命中测试，
   * 所以"元素被浮层盖住"、"z-index 错了"、"热区太小点不到"这类问题**测不出来**。
   * Input.dispatchMouseEvent 走浏览器真实输入管线 → 与用户点击同路径。
   */

  /** 在视口坐标处点击 */
  async clickAt(x, y, { button = "left", clickCount = 1, delay = 30 } = {}) {
    const base = { x: Math.round(x), y: Math.round(y), button, clickCount };
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...base, buttons: 0 });
    await sleep(delay);
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", ...base, buttons: 1 });
    await sleep(delay);
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base, buttons: 0 });
    return { x, y };
  }

  /** 取元素中心坐标（视口坐标） */
  async centerOf(selector, { scrollIntoView = true } = {}) {
    if (scrollIntoView) {
      await this.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el) el.scrollIntoView({ block: 'center', inline: 'center' });
      })()`);
      await sleep(80);
    }
    const info = await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
    })()`);
    return info;
  }

  /**
   * 用真实鼠标事件点击元素。
   * 返回点击后的**命中对象**（document.elementFromPoint 结果）——
   * 若命中的不是目标元素本身，说明被遮挡，会明确报出来（这正是要测的）。
   */
  async clickSelector(selector, { timeout = 5000, verify = true } = {}) {
    await this.waitForFunction(`document.querySelector(${JSON.stringify(selector)})`, { timeout });
    const info = await this.centerOf(selector);
    if (!info) throw new Error(`点击目标不存在：${selector}`);
    if (info.w === 0 || info.h === 0) throw new Error(`点击目标尺寸为 0，点不到：${selector}`);

    const hit = await this.evaluate(`(() => {
      const el = document.elementFromPoint(${info.cx}, ${info.cy});
      if (!el) return null;
      return { tag: el.tagName.toLowerCase(), cls: el.getAttribute('class') || '', text: (el.textContent || '').trim().slice(0, 30) };
    })()`);

    await this.clickAt(info.cx, info.cy);
    await sleep(120);

    let hitOk = null;
    if (verify) {
      hitOk = await this.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        const top = document.elementFromPoint(${info.cx}, ${info.cy});
        return !!(el && top && (top === el || el.contains(top) || top.contains(el)));
      })()`);
    }
    return { selector, x: info.cx, y: info.cy, hitBefore: hit, hitOk };
  }

  /** 输入文本（走真实输入） */
  async typeText(text) {
    await this.send("Input.insertText", { text });
  }

  /** 按键（如 Enter / Tab / Escape） */
  async pressKey(key, { code, keyCode, text } = {}) {
    const common = {
      key,
      code: code ?? key,
      windowsVirtualKeyCode: keyCode ?? KEYCODES[key] ?? 0,
      nativeVirtualKeyCode: keyCode ?? KEYCODES[key] ?? 0,
    };
    await this.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...common, text });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...common });
  }

  /** 取元素信息 */
  async elementInfo(selector) {
    return this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, scrollHeight: el.scrollHeight, scrollWidth: el.scrollWidth };
    })()`);
  }

  /**
   * 截图。
   * @param {{
   *   path?: string,
   *   format?: "png"|"jpeg"|"webp",
   *   quality?: number,
   *   fullPage?: boolean,
   *   selector?: string,
   *   padding?: number,
   * }} opts
   * @returns {Promise<Buffer>}
   */
  async screenshot(opts = {}) {
    const { path, format = "png", quality, fullPage = false, selector, padding = 0 } = opts;
    const saved = this.viewport;
    let clip;

    try {
      if (selector) {
        const info = await this.elementInfo(selector);
        if (!info) throw new Error(`截图目标元素不存在：${selector}`);
        // 元素可能在滚动区外 → 先滚到可见
        await this.evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center',inline:'center'})`);
        await sleep(120);
        const info2 = await this.elementInfo(selector);
        const scale = saved?.deviceScaleFactor ?? 1;
        clip = {
          x: Math.max(0, info2.x - padding),
          y: Math.max(0, info2.y - padding),
          width: Math.max(1, info2.width + padding * 2),
          height: Math.max(1, info2.height + padding * 2),
          scale,
        };
      } else if (fullPage) {
        const size = await this.evaluate(`(() => ({
          w: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0, window.innerWidth),
          h: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0, window.innerHeight),
        }))()`);
        const scale = saved?.deviceScaleFactor ?? 1;
        clip = { x: 0, y: 0, width: size.w, height: size.h, scale };
      }

      const params = { format, fromSurface: true, captureBeyondViewport: true };
      if (format !== "png" && quality != null) params.quality = quality;
      if (clip) params.clip = clip;

      const r = await this.send("Page.captureScreenshot", params);
      const buf = Buffer.from(r.data, "base64");
      if (path) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, buf);
      }
      return buf;
    } finally {
      void saved;
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.attached) {
      // 附着在别人的页面上（真实 Tauri 的 WebView2）→ 只断开自己的连接，**不要关掉人家的窗口**
      this.conn.close();
      return;
    }
    try { await this.conn.send("Target.closeTarget", { targetId: this.targetId }); } catch { /* ignore */ }
  }
}

/* ──────────────────────────── 浏览器 ──────────────────────────── */

export class Browser {
  constructor({ conn, proc, port, userDataDir, info, keepProfile }) {
    this.conn = conn;
    this.proc = proc;
    this.port = port;
    this.userDataDir = userDataDir;
    this.info = info;
    this.keepProfile = keepProfile;
    this.pages = new Set();
  }

  /**
   * 启动浏览器。
   * @param {{ headless?: boolean, browser?: object, executablePath?: string, args?: string[], keepProfile?: boolean }} [opts]
   */
  static async launch(opts = {}) {
    const headless = opts.headless !== false;
    const browser = opts.browser ?? (opts.executablePath
      ? { name: "custom", label: opts.executablePath, path: opts.executablePath }
      : findBrowser(opts.prefer ? { prefer: opts.prefer } : {}));

    const userDataDir = mkdtempSync(join(tmpdir(), "pomo-ui-cdp-"));
    const args = [
      ...(headless ? ["--headless=new"] : []),
      "--remote-debugging-port=0",
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-ipc-flooding-protection",
      "--disable-gpu",
      "--hide-scrollbars",
      "--mute-audio",
      "--force-color-profile=srgb",
      "--font-render-hinting=none",
      "--allow-file-access-from-files",
      "about:blank",
      ...(opts.args ?? []),
    ];

    const proc = spawn(browser.path, args, {
      stdio: "ignore",          // 不需要浏览器 stdout；也避开管道相关的沙箱限制
      windowsHide: true,
      detached: false,
    });
    let procExit = null;
    proc.on("exit", (code) => { procExit = code; });
    proc.on("error", (e) => { procExit = `spawn 失败：${e.message}`; });

    // ⚠️ Windows 上 Edge/Chrome 的**启动器进程会立刻 exit 0**（真正浏览器是它 spawn 的独立子进程）。
    // 因此**不能**用 proc 存活判断启动成败，只能靠 DevToolsActivePort + 端口可达。
    // 唯一性由 `--user-data-dir` 保证：每个实例有独立 profile/端口，不会委托到用户正在用的浏览器（已实测）。
    const portFile = join(userDataDir, "DevToolsActivePort");
    const port = await until(() => {
      if (!existsSync(portFile)) return null;
      const first = readFileSync(portFile, "utf8").split("\n")[0].trim();
      return first ? Number(first) : null;
    }, {
      timeout: 30000, interval: 100,
      what: `浏览器 DevTools 端口（${browser.path}${procExit != null ? `，启动器已退出 code=${procExit}` : ""}）`,
    });

    // 浏览器级 websocket
    const ver = await until(async () => {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      return res.ok ? res.json() : null;
    }, { timeout: 20000, interval: 150, what: "浏览器 /json/version" });

    const conn = await Connection.connect(ver.webSocketDebuggerUrl);

    const inst = new Browser({
      conn, proc, port, userDataDir,
      info: { ...browser, version: ver.Browser, protocolVersion: ver["Protocol-Version"] },
      keepProfile: opts.keepProfile === true,
    });
    return inst;
  }

  /**
   * 连接到**已经在跑**的 CDP 端点（不自建浏览器、不杀进程）。
   *
   * 用途：真实 Tauri 桌面端的 WebView2 —— 用环境变量
   *   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
   * 启动应用后，就能像浏览器一样驱动**真实窗口**（真 Rust 后端 + 真数据），
   * 而且点的是真实输入管线。
   *
   * @param {{ port: number, host?: string, timeout?: number }} opts
   */
  static async connect({ port, host = "127.0.0.1", timeout = 20000 } = {}) {
    if (!port) throw new Error("Browser.connect 需要 port");
    const ver = await until(async () => {
      try {
        const res = await fetch(`http://${host}:${port}/json/version`);
        return res.ok ? res.json() : null;
      } catch { return null; }
    }, { timeout, interval: 200, what: `CDP 端点 http://${host}:${port}/json/version` });

    const conn = await Connection.connect(ver.webSocketDebuggerUrl);
    const inst = new Browser({
      conn, proc: null, port, userDataDir: null, keepProfile: true,
      info: {
        name: "attached",
        label: `已连接的实例 (${ver.Browser})`,
        version: ver.Browser,
        protocolVersion: ver["Protocol-Version"],
      },
    });
    inst.attached = true;
    inst.host = host;
    return inst;
  }

  /** 列出该端点下的所有页面目标（附着模式下用来挑要驱动哪个窗口） */
  async listTargets() {
    const res = await fetch(`http://${this.host ?? "127.0.0.1"}:${this.port}/json/list`);
    const all = await res.json();
    return all.map((t) => ({ id: t.id, type: t.type, title: t.title, url: t.url, ws: t.webSocketDebuggerUrl }));
  }

  /**
   * 附着到**已存在**的页面（不新建、不关闭）。
   * @param {{ match?: (t: {title:string,url:string}) => boolean, index?: number }} [opts]
   */
  async attachToPage({ match, index = 0 } = {}) {
    const targets = await this.listTargets();
    const pages = targets.filter((t) => t.type === "page");
    if (!pages.length) {
      throw new Error(
        `CDP 端点里没有 page 目标。现有：${targets.map((t) => `${t.type}(${t.url || t.title})`).join(", ") || "（无）"}`,
      );
    }
    const picked = match ? pages.filter(match) : pages;
    const target = picked[index];
    if (!target) {
      throw new Error(
        `没有匹配的页面目标。现有页面：\n` + pages.map((p) => `  · ${p.title} — ${p.url}`).join("\n"),
      );
    }
    if (!target.ws) throw new Error(`目标 ${target.id} 没有 webSocketDebuggerUrl（无法附着）`);

    // 页面级连接：命令不带 sessionId，事件也不带 → Page 用 attached 模式
    const pageConn = await Connection.connect(target.ws);
    const page = new Page({ conn: pageConn }, undefined, { attached: true });
    page.targetId = target.id;
    page.targetInfo = { title: target.title, url: target.url };
    page.attached = true;
    page.ownConn = pageConn;

    await page.send("Page.enable");
    await page.send("Runtime.enable");
    return page;
  }

  /** 新建页面 */
  async newPage({ viewport = { width: 1280, height: 800 }, freezeAnimations = true } = {}) {
    const { targetId } = await this.conn.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await this.conn.send("Target.attachToTarget", { targetId, flatten: true });
    const page = new Page(this, sessionId);
    page.targetId = targetId;
    this.pages.add(page);

    await page.send("Page.enable");
    await page.send("Runtime.enable");
    if (freezeAnimations) await page.freezeAnimations();
    await page.setViewport(viewport);
    return page;
  }

  async close() {
    for (const p of this.pages) { try { await p.close(); } catch { /* ignore */ } }
    this.pages.clear();

    // 附着模式：绝不动别人的进程/窗口，只断开连接
    if (this.attached) {
      this.conn.close();
      return;
    }

    // 优雅关闭：浏览器级 Browser.close（比 taskkill 干净，且不依赖那个已退出的启动器进程）
    try {
      await this.conn.send("Browser.close");
    } catch { /* ignore */ }
    this.conn.close();

    // 兜底：进程还在就强杀（用启动器 pid；子进程可能已随 Browser.close 退出）
    await sleep(400);
    if (this.proc && this.proc.exitCode == null) {
      try {
        if (process.platform === "win32" && this.proc.pid) {
          spawn("taskkill", ["/PID", String(this.proc.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        } else {
          this.proc.kill("SIGKILL");
        }
      } catch { /* ignore */ }
    }

    await sleep(300);
    if (!this.keepProfile) {
      try { rmSync(this.userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

export { until, sleep };
