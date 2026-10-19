# `music-player/` —— 内置音乐资源

> **范围**：只讲本目录的音乐资源。
> 播放/下载代码在 [`../src-tauri/src/modules/audio_player.rs`](../src-tauri/src/modules/audio_player.rs)
> 与 [`../src-tauri/src/modules/downloader.rs`](../src-tauri/src/modules/downloader.rs)。

## 1. 目录

| 路径 | 内容 |
|---|---|
| `music/` | 仓库跟踪的 **3 首内置主题曲** + `tags.json` |
| `generated-music/` | 由 `scripts/generate-music.mjs` 生成的曲目 + `tags.json` |

`music/` 目录整体被 `.gitignore` 忽略，只白名单放行 3 首内置曲和 `tags.json`；
本机开发时目录里可能还有未跟踪的歌曲，**不要 `git add -A` 把它们带进去**。

## 2. 构建时怎么进应用

```bash
node scripts/copy-resources.mjs
```

`npm run build` / `npm run tauri:build` 会自动执行它，把资源复制到
`src-tauri/resources/`（该目录不入库）。PWA 的音乐清单由
`npm run pwa:manifest` 单独生成。

## 3. 已知坑：dev 启动会改写 `music/tags.json`

dev 模式启动应用后，运行时可能把已跟踪的 `tags.json` 从 v1 迁移成 v2
（`_customTags` + 字符串值 → `{name,color}` 对象）。后果是 `git status`
总多一个改动，`git add -A` 会顺手提交。

仓库已带 git 钩子拦截；克隆后执行一次：

```bash
git config core.hooksPath scripts/git-hooks
```

需要有意提交迁移时，在提交信息里写「tags.json」/「音乐库迁移」，或
`SKIP_TAGS_GUARD=1 git commit ...`。

根治办法（尚未实施）：让应用把运行时音乐元数据写到 app data 目录，
而不是仓库里的 `music-player/music/`。
