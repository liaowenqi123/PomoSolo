# `server-planning/` —— 服务器接口文档

> **范围**：本目录只放服务器侧的接口约定、实现记录、部署要求与历史草案。
> **服务器运行代码不在本仓库**，维护在服务器上（见 `.local/SERVER.md`）。
>
> **当前线上实现**（以 [`API-implementation.md`](./API-implementation.md) 顶部为准）：
> Python 标准库 `ThreadingHTTPServer` + PostgreSQL；**无 Nginx、无 Redis**，
> 路由按 `Host` 头分发。

## 1. 先读哪篇

| 文档 | 状态 | 作用 |
|---|---|---|
| [`EXTERNAL-INTERFACES.md`](./EXTERNAL-INTERFACES.md) | 当前 | ★ **对外接口唯一权威索引**（REST / WebSocket / P2P / 更新源） |
| [`API-implementation.md`](./API-implementation.md) | 当前 | 接口实现记录 + **留言区**（跨部门沟通通道） |
| [`API-quickref.md`](./API-quickref.md) | 当前 | REST 速查 |
| [`PWA-requirements.md`](./PWA-requirements.md) | 草案/部分落地 | PWA 部署与对接要求；Nginx 段为历史参考，线上无 Nginx |
| [`ws_server.py`](./ws_server.py) | 参考实现 | 服务器 WebSocket 的参考代码 |
| [`nginx.conf`](./nginx.conf) | **历史参考** | 线上没有 Nginx；仅作旧部署背景 |
| [`notice.json`](./notice.json) | 当前 | 客户端公告 |
| [`MESSAGE-BOARD-ARCHIVE.md`](./MESSAGE-BOARD-ARCHIVE.md) | 历史 | 留言区归档，按需查阅 |
| [`archive/SERVER_REQUIREMENTS_DRAFT.md`](./archive/SERVER_REQUIREMENTS_DRAFT.md) | **历史草案** | 早期 Go/Node + Nginx + Redis 规划，**未采用** |

## 2. 线上实现 vs 历史草案

- **当前**：Python 标准库 HTTP 服务 + PostgreSQL；TLS/路由/静态文件都由
  `server.py`（服务器上）负责。接口清单以 `EXTERNAL-INTERFACES.md` 为准。
- **历史**：`archive/SERVER_REQUIREMENTS_DRAFT.md` 是迁移初期写的需求草案，
  技术栈写的是 Go/Node + Nginx + Redis，**没有落地**。不要拿它评估线上。
- `nginx.conf` 只是旧反向代理配置参考；线上没有 Nginx 进程。
  新增子域名靠 DNS 泛解析 + 服务端 `Host` 分发，不需要单独签证书。

## 3. 改接口的规则（强制）

1. 先改 [`EXTERNAL-INTERFACES.md`](./EXTERNAL-INTERFACES.md)（客户端唯一权威索引）；
2. 再在 [`API-implementation.md`](./API-implementation.md) 记录实现/留言；
3. 如果影响客户端或 PWA，在留言板 <https://board.pomogrow.top> 留一条；
4. 服务器代码改动必须留痕（文档或 `self` 仓 commit），否则客户端看不到变更。

## 4. 部署细节

SSH、部署目录、容器名、数据库连法、域名/证书链路属于**本机/服务器专属信息**，
放在 `.local/SERVER.md`（不入库）。本目录只保留可共享的接口与部署要求。

需要版本化的服务器基础设施脚本（证书同步/自愈、certbot hook）在
[`../scripts/server/README.md`](../scripts/server/README.md)。
