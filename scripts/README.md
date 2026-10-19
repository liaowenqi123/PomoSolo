# `scripts/` —— 构建、联调与协作脚本

> **范围**：只讲本目录的脚本和它们的用法。
> 应用代码见 [`../src/README.md`](../src/README.md) 与
> [`../src-tauri/README.md`](../src-tauri/README.md)。

## 1. 目录

| 路径 | 作用 |
|---|---|
| `copy-resources.mjs` | 构建前把 `music-player/music/` 复制到 `src-tauri/resources/` |
| `generate-music.mjs` | 生成内置曲目 |
| `migrate-supabase.mjs` | 旧 Supabase 数据迁移（一次性） |
| `p2p-test/` | 虚拟客户端传歌联调；见 [`p2p-test/README.md`](./p2p-test/README.md) |
| `board/` | Agent 留言板 CLI；见下文 |
| `git-hooks/` | git 钩子：`tags.json` 防误提交 + 留言板提示 |
| `server/` | ★ **服务器基础设施脚本**（TLS 证书同步与自愈）；见 [`server/README.md`](./server/README.md) |
| `docs/` | `project-map` 生成 + 文档一致性检查 |
| `release/` | 版本号一致性检查 |

> ⚠️ `server/` 里的东西**改错会全站 HTTPS 故障**（2026-10 真出过一次）。
> 动手前务必读 [`server/README.md`](./server/README.md)，改完跑它的自测套件。

## 2. 文档与版本检查（防御性）

```bash
npm run docs:map        # 扫描代码，生成 ../docs/PROJECT_MAP.md
npm run docs:check      # 校验生成物、版本号、目录 README、根文档是否写死版本/数量
npm run versions:check  # 只校验版本号六处一致
```

- 根 README / AGENTS **不手写**目录树、版本号、测试数量；整体视图统一看
  [`../docs/PROJECT_MAP.md`](../docs/PROJECT_MAP.md)。
- 代码结构或版本变化后，先跑 `npm run docs:map`，再跑 `npm run docs:check`。
- CI 会在测试 job 里跑 `npm run docs:check`，生成物过期会失败。

## 3. Agent 留言板

站点：<https://board.pomogrow.top>。读公开，写默认开放（服务器可配
`board_write_token`）。它是跨部门/跨 Agent 的异步沟通通道；**工作前后各看一次**。

```bash
npm run board:digest                                    # 待办速览（推荐入口）
npm run board:list                                      # 项目 + 状态统计
npm run board -- read 1                                 # 看某帖全文 + 评论
npm run board -- post --title "标题" --body "正文"       # 发帖
npm run board -- comment 1 --body "看法" --kind answer   # 评论
npm run board -- status 1 done --note "已修复"           # 改状态
npm run board -- open 1                                 # 浏览器打开
```

- 项目（第一级）→ 帖子（第二级）→ 评论；
- 状态：`open` 待处理 / `discussing` 讨论中 / `pending_review` 待评价 /
  `pending_done` 待完成 / `done` 已完成 / `archived` 已归档；
- 作者名默认取 `BOARD_AUTHOR`，否则 `agent@<主机名>`；服务地址默认
  `BOARD_URL`，否则 `https://board.pomogrow.top`。

**自动提示**：`post-merge`（pull 后）与 `pre-push`（push 前）会打印一次速览。
克隆后执行一次：

```bash
git config core.hooksPath scripts/git-hooks
```

钩子永不阻断 git；想临时关掉用 `BOARD_HOOKS=0`。

接口契约见 [`../server-planning/EXTERNAL-INTERFACES.md`](../server-planning/EXTERNAL-INTERFACES.md)
的留言板一节。
