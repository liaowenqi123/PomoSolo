# PWA 部署与对接要求（给服务器部门）

> 部门：PWA部门 —— 2026-08
> 关联文档：`EXTERNAL-INTERFACES.md`（接口协议总表）、`nginx.conf`（现有反代配置）

## 1. 背景

PomoSolo 推出 **桌面优先的 PWA 版**，代码在 `src/pwa/`（与桌面端同仓库、同源复用 `src/` 下的组件/store/API），
部署在子域 **`start.pomogrow.top`**。本文件列出服务器部门需要做的事项与优先级。

> 后端权威域名已由主部门迁移为 **`https://api.pomogrow.top`**（HTTPS/443 已生效，见 EXTERNAL-INTERFACES.md），
> 旧 IP `http://115.159.49.112` 仅迁移期兼容。

## 2. 现状（PWA 端已完成）

- PWA 构建产物：`npm run pwa:build` → 输出到仓库根 **`pwa-dist/`**（当前约若干 MB，含 3 首内置主题曲）。
- 内置离线能力：3 首番茄钟主题曲随构建发布（`/tracks/`），**离线可播**。
- 其余 38 首曲库歌曲：来源标记为 `library`，播放时请求 **`/music/<URL编码的歌名>`**（同源）。
- 登录/自习室/同步听歌/云同步：走既有 `/api/v1/*` REST + `/ws` WebSocket，**协议与桌面端完全一致**（见 EXTERNAL-INTERFACES.md），PWA 端已实现，只等域名/HTTPS 就绪即可用。
- **WS 协议跟随安全上下文**：PWA 端已修复"HTTPS 页面发起 ws:// 被浏览器拒绝"问题（v0.1.1，
  与主部门 v4.7.12 修 Rust 侧 TLS 同源）——页面为 HTTPS 或后端为 https 时自动走 **wss://**。
- 音乐清单：`pwa-dist/music-manifest.json`（构建时由脚本从 `music-player/music/` 生成）。

## 3. 需要服务器部门做的事（按优先级）

### P0 · 域名 + HTTPS + 静态托管（启动 PWA 的前提）

1. 为 **`start.pomogrow.top`** 配置 DNS（CNAME/A 记录 → `115.159.49.112`）与 Nginx vhost。
2. **必须启用 HTTPS**（Let's Encrypt 等）：Service Worker / PWA 安装 / `crypto` 能力强制要求安全上下文，
   否则"添加到主屏幕"与离线能力不可用。
3. 将 **`pwa-dist/`** 目录作为该站点根目录托管（`index.html` 在根）。
   - 部署流程（供参考）：在服务器拉取仓库后执行 `npm ci && npm run pwa:build`，
     然后把 `pwa-dist/*` 拷到 vhost 根（或直接 `root` 指向仓库 `pwa-dist/`）。
   - ⚠️ 内置 mp3 在 `pwa-dist/tracks/` 下，需随站点一起发布。
4. 建议 vhost 示例：

```nginx
server {
    listen 80;
    server_name start.pomogrow.top;
    # HTTP 跳 HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name start.pomogrow.top;

    ssl_certificate     /etc/letsencrypt/live/start.pomogrow.top/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/start.pomogrow.top/privkey.pem;

    # PWA 静态资源（构建产物根目录）
    root /home/ubuntu/PomoSolo/pwa-dist;
    index index.html;

    # SPA 回退
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 曲库歌曲（PWA library 歌曲的播放地址：/music/<编码歌名>）
    location /music/ {
        alias /home/ubuntu/PomoSolo/music-player/music/;
        add_header Cache-Control "public, max-age=86400";
    }

    # 复用既有 API / WS / 健康检查反代
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    location /ws {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
    location = /health {
        proxy_pass http://127.0.0.1:3000;
    }
}
```

### P1 · 托管曲库到 `/music/`（解锁 38 首曲库歌）

- 将 `music-player/music/*.mp3` 托管到 **`start.pomogrow.top/music/`**（与上例 alias 到仓库该目录即可）。
- PWA 播放 library 歌曲的 URL 模板：`${origin}/music/${encodeURIComponent(歌名)}`。
  - 例：`https://start.pomogrow.top/music/渡口%20-%20蔡琴.mp3`
- 在 `music/` 托管前，PWA 中 library 歌曲会提示播放失败（内置 3 首不受影响），属于预期降级。

### P2 · CORS（开发期联调）

- 开发模式 PWA 运行在 `http://127.0.0.1:5199`，默认指向 **`https://api.pomogrow.top`** 联调
  （可用 `VITE_API_ORIGIN` 覆盖），需允许该来源访问 `/api/*`、`/ws`、`/music/*`：

```nginx
location / {
    if ($http_origin ~* ^https?://(127\.0\.0\.1|localhost)(:\d+)?$) {
        add_header Access-Control-Allow-Origin $http_origin always;
        add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Authorization, Content-Type" always;
        add_header Access-Control-Allow-Credentials true always;
    }
    if ($request_method = OPTIONS) { return 204; }
    ...
}
```

- ⚠️ WebSocket 的跨域握手也需放行（浏览器对 WS 发送 Origin 头，服务端不校验 Origin 即可，
  如需校验请把 `http://127.0.0.1:5199` 加入白名单）。
- > 生产（同源部署）**不需要** CORS；开发联调才需要。

### P3 · 将来：B站歌曲下载代理接口（排队，v1 不做）

- 需求背景：桌面端支持从 B站 下载歌曲到本地音乐库；PWA 无文件系统，用户期望"通过相同办法下载歌曲，
  下载到 PWA 缓存"。
- 请服务器部门在合适时机提供 **代理下载接口**，例如：
  - `POST /api/v1/music/download`，body `{ title, artist }`
  - 服务端下载 → 转码 MP3 → 返回可直接 fetch/缓存的文件（或返回临时 URL）
  - PWA 端拿到后将字节写入 Cache Storage + IndexedDB，实现"下载到 PWA 缓存"。
- **v1 明确不做**，仅在本文档登记排队，避免阻塞 PWA 上线。

## 4. PWA 调用的接口清单（与桌面端一致，均已完成）

| 类别 | 入口 | 说明 |
|---|---|---|
| REST | `/api/v1/auth/*` | 注册/登录/刷新/登出/会话 |
| REST | `/api/v1/settings` | 云端设置同步 |
| REST | `/api/v1/pomodoro/records/batch` | 番茄钟记录上传 |
| REST | `/api/v1/rooms*` | 自习室列表/详情/更新/删除/排行 |
| WS | `wss://<host>/ws?token=<access_token>` | 房间/同步听歌/P2P 信令（协议同桌面端；HTTPS 下必须 wss，PWA 已自动处理） |
| 静态 | `/music/*` | 曲库（P1） |
| 静态 | `/tracks/*` | 内置主题曲（随 PWA 发布） |
| 静态 | `/music-manifest.json` | 音乐清单（随 PWA 发布） |
| 静态 | `/health` | 健康检查 |

## 5. 验收标准

1. `https://start.pomogrow.top/` 可打开 PWA，可"添加到主屏幕"，离线（断网）仍能打开外壳并播放 3 首内置曲。
2. `/music/渡口 - 蔡琴.mp3` 可直链播放。
3. 登录 / 自习室 / 同步听歌 / 云同步在该域名下与桌面端行为一致。
4. 开发模式下 `127.0.0.1:5199` 能跨域联调（P2）。

## 6. 版本与产物

- 构建：`npm run pwa:build`（先 `pwa:manifest` 生成清单 → `vue-tsc` 类型检查 → `vite build`）。
- 产物目录：**`pwa-dist/`（已在 .gitignore，不入库）**——建议**服务器自行构建**：
  服务器拉取仓库后 `npm ci && npm run pwa:build`，再把 `pwa-dist/` 拷到 vhost 根（或 nginx `root` 直接指向 `pwa-dist/`）。
- 构建产物清单：`index.html`、`assets/*`、`sw.js`、`workbox-*.js`、`manifest.webmanifest`、`music-manifest.json`、`icons/`、`tracks/`（3 首内置曲）。
- ⚠️ 若服务器上 `npm ci` 拉不到依赖（离线内网），可改由 PWA 部门在本地构建后把 `pwa-dist/` 压缩包交付（不走 git）。
