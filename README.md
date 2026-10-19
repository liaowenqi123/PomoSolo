# 🍅 PomoSolo

Windows 桌面番茄钟。桌面端是 Tauri v2 + Vue 3 + 纯 Rust；PWA 在 `src/pwa/` 复用前端；
服务器运行代码与安卓端代码不在本仓库。

[![Release](https://img.shields.io/github/v/release/liaowenqi123/PomoSolo?label=release)](https://github.com/liaowenqi123/PomoSolo/releases/latest)
[Agent 入口](AGENTS.md) · [文档索引](docs/README.md) · [项目结构（自动生成）](docs/PROJECT_MAP.md)

## 快速开始

```bash
npm install
npm run tauri:dev      # 桌面端开发
npm test               # 前端测试
npm run tauri:build    # 构建安装包
```

环境要求、后端命令、构建产物位置见 [`src-tauri/README.md`](src-tauri/README.md)；
前端结构与 UI 约束见 [`src/README.md`](src/README.md)。

## 这个仓库里有什么

| 范围 | 入口 |
|---|---|
| 桌面端前端 | [`src/README.md`](src/README.md) |
| 桌面端后端 | [`src-tauri/README.md`](src-tauri/README.md) |
| PWA | [`src/pwa/README.md`](src/pwa/README.md) |
| 服务器接口文档（运行代码不在本仓库） | [`server-planning/README.md`](server-planning/README.md) |
| UI 取证工具 | [`tools/ui/README.md`](tools/ui/README.md) |
| 构建、联调、留言板脚本 | [`scripts/README.md`](scripts/README.md) |
| 架构、模块、历史文档 | [`docs/README.md`](docs/README.md) |
| 内置音乐资源 | [`music-player/README.md`](music-player/README.md) |
| 本机私密区契约 | [`.local/README.md`](.local/README.md) |
| 冻结的历史归档 | [`deprecated/README.md`](deprecated/README.md) |

> 本文件只做入口。**版本号、测试数量、目录结构、模块清单不在根 README 手写**——
> 运行 `npm run docs:map` 从代码生成 [`docs/PROJECT_MAP.md`](docs/PROJECT_MAP.md)；
> CI 用 `npm run docs:check` 阻止生成物过期。

## 发布

流程与红线见 [`TEAM_GUIDE.md`](TEAM_GUIDE.md) §16；版本一致性用
`npm run versions:check` 校验。

## 许可证

MIT License
