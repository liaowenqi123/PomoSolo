# 手动歌曲下载工具

通过 B 站搜索 + DeepSeek AI 判断 + you-get 下载，自动获取歌曲的无损音质版本。

## EXE 版本使用（推荐）

### 文件结构

```
app/
├── manual_downloader.exe  # 主程序
├── you-get.exe           # 下载工具
├── ffmpeg.exe            # 音频转换（首次运行自动下载）
└── music/                # 下载的歌曲保存在这里
```

### 使用方法

```bash
# 进入 app 目录
cd app

# 运行下载
manual_downloader.exe -s "歌曲名 - 歌手" -k "你的DeepSeek API Key"

# 示例
manual_downloader.exe -s "告白气球 - 周杰伦" -k "sk-xxxxxxxx"
manual_downloader.exe -s "晴天" -k "sk-xxxxxxxx"
```

### 注意事项

1. **DeepSeek API Key** - 必需，从 [DeepSeek 官网](https://platform.deepseek.com/) 获取
2. **ffmpeg** - 首次运行时如未找到会自动下载（约 96MB）
3. **歌曲已存在** - 如果 music 目录已有同名歌曲会自动跳过

---

## Python 版本使用

### 依赖安装

```bash
pip install requests beautifulsoup4 openai you-get
```

### 运行方式

```bash
python manual_downloader.py -s "告白气球 - 周杰伦" -k "sk-xxxxxxxx"
```

---

## AI 判断逻辑

DeepSeek 会从搜索结果中选出最像纯音乐的视频：

**优先选择：**
- 标题包含"无损"、"Hi-Res"、"FLAC"、"纯享版"等
- "百万录音棚"系列

**自动排除：**
- 翻唱、cover、AI 翻唱
- 教程、乐器教学
- 变调、倍速版本

---

## 常见问题

| 问题 | 解决方案 |
|------|----------|
| 未找到 ffmpeg | 首次运行会自动下载，或手动放入 app 目录 |
| API 调用失败 | 检查 API Key 是否正确、是否有余额 |
| B 站搜索失败 | 检查网络连接，可能需要配置 Cookie |
| 歌曲已存在 | 检查 music 目录，同名歌曲会自动跳过 |

---

## Cookie 配置（可选）

部分视频需要登录才能下载，创建 `bilibili_cookies.txt` 文件（Netscape 格式）：

```
www.bilibili.com	TRUE	/	FALSE	0	SESSDATA	xxx
www.bilibili.com	TRUE	/	FALSE	0	bili_jct	xxx
```