#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
手动歌曲下载工具
通过命令行调用，支持 B 站搜索 + DeepSeek AI 判断纯音乐 + you-get 下载
"""

import os
import sys

# 强制 stdout/stderr 使用 UTF-8（解决 Windows 控制台编码问题）
if sys.stdout.encoding != 'utf-8':
    sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1)
if sys.stderr.encoding != 'utf-8':
    sys.stderr = open(sys.stderr.fileno(), mode='w', encoding='utf-8', buffering=1)

import argparse
import requests
import json
import subprocess
import re
import glob
import shutil
import urllib.parse
import zipfile
import io
from datetime import datetime
from typing import List, Dict, Optional
from bs4 import BeautifulSoup
from openai import OpenAI


class ManualSongDownloader:
    """手动歌曲下载器 - 支持 DeepSeek API"""

    def __init__(self, deepseek_api_key: str):
        """
        Args:
            deepseek_api_key: DeepSeek API Key
        """
        self.deepseek_api_key = deepseek_api_key
        
        # OpenAI 客户端（指向 DeepSeek）
        self.client = OpenAI(
            api_key=deepseek_api_key,
            base_url="https://api.deepseek.com"
        )
        
        # 获取脚本/exe所在目录（兼容 PyInstaller 打包）
        self.script_dir = self._get_script_dir()
        
        # 音乐目录在脚本目录下
        self.music_dir = os.path.join(self.script_dir, "music")
        self.cookie_file = os.path.join(self.script_dir, "bilibili_cookies.txt")
        
        # 查找工具路径（优先同目录，fallback 到系统 PATH）
        self.ffmpeg_path = self._find_tool("ffmpeg")
        self.youget_path = self._find_tool("you-get")
        
        # 加载 Cookie
        self.cookie_str = ""
        if os.path.exists(self.cookie_file):
            try:
                cookies = []
                with open(self.cookie_file, 'r', encoding='utf-8') as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith('#'):
                            continue
                        parts = line.split('\t')
                        if len(parts) >= 7:
                            name, value = parts[5], parts[6]
                            cookies.append(f"{name}={value}")
                self.cookie_str = '; '.join(cookies)
            except Exception as e:
                print(f"⚠️ 读取 Cookie 失败：{e}")

    def _get_script_dir(self) -> str:
        """获取脚本/exe所在目录（兼容 PyInstaller 打包）"""
        # PyInstaller 打包后，sys.frozen 为 True
        if getattr(sys, 'frozen', False):
            # exe 模式：exe 所在目录
            return os.path.dirname(sys.executable)
        else:
            # 脚本模式：脚本所在目录
            return os.path.dirname(os.path.abspath(__file__))

    def _find_tool(self, tool_name: str) -> Optional[str]:
        """查找工具路径，优先同目录下的 exe，fallback 到系统 PATH
        
        Args:
            tool_name: 工具名称（如 "ffmpeg", "you-get"）
            
        Returns:
            工具完整路径，或 None
        """
        # 优先查找同目录下的 exe
        local_exe = os.path.join(self.script_dir, f"{tool_name}.exe")
        if os.path.exists(local_exe):
            return local_exe
        
        # 同目录下的 bat/cmd（you-get 可能是 bat 包装）
        for ext in ['.bat', '.cmd']:
            local_script = os.path.join(self.script_dir, f"{tool_name}{ext}")
            if os.path.exists(local_script):
                return local_script
        
        # Fallback 到系统 PATH
        system_path = shutil.which(tool_name)
        
        # 如果是 ffmpeg 且找不到，尝试自动下载
        if tool_name == "ffmpeg" and not system_path:
            print("\n📥 未找到 ffmpeg，正在自动下载...")
            downloaded = self._download_ffmpeg()
            if downloaded:
                return os.path.join(self.script_dir, "ffmpeg.exe")
        
        return system_path

    def _download_ffmpeg(self) -> bool:
        """自动下载 ffmpeg essentials 版本
        
        Returns:
            下载成功返回 True，失败返回 False
        """
        try:
            # ffmpeg essentials 版本下载地址（约 70MB）
            ffmpeg_url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
            
            print("   正在下载 ffmpeg essentials...")
            print(f"   地址：{ffmpeg_url}")
            
            # 下载 zip 文件
            response = requests.get(ffmpeg_url, timeout=300, stream=True)
            total_size = int(response.headers.get('content-length', 0))
            downloaded = 0
            
            zip_data = io.BytesIO()
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    zip_data.write(chunk)
                    downloaded += len(chunk)
                    if total_size:
                        percent = (downloaded / total_size) * 100
                        print(f"\r   下载进度：{percent:.1f}%", end="", flush=True)
            
            print("\n   解压中...")
            zip_data.seek(0)
            
            with zipfile.ZipFile(zip_data, 'r') as zf:
                # 查找 ffmpeg.exe
                for name in zf.namelist():
                    if name.endswith('ffmpeg.exe'):
                        # 提取到脚本目录
                        zf.extract(name, self.script_dir)
                        extracted_path = os.path.join(self.script_dir, name)
                        target_path = os.path.join(self.script_dir, "ffmpeg.exe")
                        
                        # 移动到根目录
                        if extracted_path != target_path:
                            shutil.move(extracted_path, target_path)
                            # 清理空目录
                            try:
                                os.removedirs(os.path.dirname(extracted_path))
                            except:
                                pass
                        
                        print("   ✅ ffmpeg 下载完成！")
                        return True
            
            print("   ❌ 解压失败：未找到 ffmpeg.exe")
            return False
            
        except Exception as e:
            print(f"   ❌ 下载失败：{type(e).__name__}: {e}")
            return False

    def is_song_exists(self, song_title: str) -> Optional[str]:
        """检查歌曲是否已存在于 music 文件夹
        
        Args:
            song_title: 歌曲名称（如 "告白气球"）
            
        Returns:
            如果存在，返回文件路径；否则返回 None
        """
        if not os.path.exists(self.music_dir):
            return None
        
        # 获取所有 mp3 文件
        mp3_files = glob.glob(os.path.join(self.music_dir, "*.mp3"))
        
        # 用歌名去匹配文件名（忽略大小写）
        song_title_lower = song_title.lower()
        for mp3_file in mp3_files:
            filename = os.path.basename(mp3_file)
            filename_no_ext = os.path.splitext(filename)[0]
            # 如果文件名包含歌名，认为已存在
            if song_title_lower in filename_no_ext.lower():
                return mp3_file
        
        return None

    def search_bilibili_videos(self, keyword: str, max_results: int = 10) -> List[Dict]:
        """在 B 站搜索视频（API + 网页爬取 fallback）"""
        print(f"\n🔍 正在 B 站搜索：{keyword}...")
        
        # 方案1：先尝试 API
        videos = self._search_bilibili_api(keyword, max_results)
        if videos:
            return videos
        
        # 方案2：API 失败，尝试网页爬取
        print("   API 失败，尝试网页搜索...")
        return self._search_bilibili_web(keyword, max_results)

    def _search_bilibili_api(self, keyword: str, max_results: int) -> List[Dict]:
        """API 搜索方案"""
        try:
            base_url = "https://api.bilibili.com/x/web-interface/search/type"
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://www.bilibili.com/',
            }
            if self.cookie_str:
                headers['Cookie'] = self.cookie_str

            params = {
                'search_type': 'video',
                'keyword': keyword,
                'page': 1,
                'pagesize': max_results
            }

            resp = requests.get(base_url, headers=headers, params=params, timeout=10)
            
            # 检查响应是否为空
            text = resp.text.strip()
            if not text:
                print("   API 返回空响应")
                return []
            
            data = resp.json()

            if data.get('code') != 0:
                print(f"   API 错误：{data.get('message', '未知错误')}")
                return []

            videos = []
            for item in data.get('data', {}).get('result', [])[:max_results]:
                bvid = item.get('bvid', '')
                aid = item.get('aid', '')
                if not bvid and not aid:
                    continue

                videos.append({
                    'title': item.get('title', ''),
                    'url': f"https://www.bilibili.com/video/{bvid}" if bvid else f"https://www.bilibili.com/video/av{aid}",
                    'bvid': bvid,
                    'aid': aid,
                    'author': item.get('owner', {}).get('name', '') if isinstance(item.get('owner'), dict) else '',
                })

            print(f"✅ API 找到 {len(videos)} 个视频")
            return videos

        except json.JSONDecodeError as e:
            print(f"   API JSON 解析失败：{e}")
            return []
        except Exception as e:
            print(f"   API 搜索失败：{type(e).__name__}: {e}")
            return []

    def _search_bilibili_web(self, keyword: str, max_results: int) -> List[Dict]:
        """网页爬取方案"""
        try:
            search_url = f"https://search.bilibili.com/all?keyword={urllib.parse.quote(keyword)}"
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9',
            }

            resp = requests.get(search_url, headers=headers, timeout=15)
            resp.encoding = 'utf-8'

            soup = BeautifulSoup(resp.text, 'html.parser')
            videos = []

            # 查找视频卡片
            for card in soup.select('.bili-video-card')[:max_results]:
                try:
                    link = card.select_one('a[href*="/video/"]')
                    if not link:
                        continue

                    href = link.get('href', '')
                    # 提取 bvid
                    bvid_match = re.search(r'(BV[a-zA-Z0-9]+|av\d+)', href)
                    if not bvid_match:
                        continue

                    bvid_or_aid = bvid_match.group(1)
                    title_elem = card.select_one('.bili-video-card__info--tit')
                    title = title_elem.get_text(strip=True) if title_elem else '未知标题'

                    videos.append({
                        'title': title,
                        'url': f"https://www.bilibili.com/video/{bvid_or_aid}",
                        'bvid': bvid_or_aid if bvid_or_aid.startswith('BV') else '',
                        'aid': bvid_or_aid[2:] if bvid_or_aid.startswith('av') else '',
                        'author': '',
                    })
                except Exception:
                    continue

            print(f"✅ 网页爬取找到 {len(videos)} 个视频")
            return videos

        except Exception as e:
            print(f"❌ 网页爬取失败：{e}")
            return []

    def _clean_title(self, video_title: str) -> str:
        """清理标题中的 HTML 标签和多余字符"""
        # 移除 HTML 标签
        clean = re.sub(r'<em[^>]*>', '', video_title)
        clean = re.sub(r'</em>', '', clean)
        clean = re.sub(r'<[^>]+>', '', clean)
        # 合并多个空格为一个
        clean = re.sub(r'\s+', ' ', clean)
        # 移除首尾空格
        return clean.strip()

    def select_best_video_with_deepseek(self, videos: List[Dict]) -> Optional[Dict]:
        """使用 DeepSeek 从多个视频中选出最像纯音乐的一个
        
        Args:
            videos: 视频列表，每个包含 title, url, bvid 等
            
        Returns:
            选中的视频 Dict，或 None（没有符合条件的）
        """
        if not videos:
            return None
        
        # 只取前6个
        videos = videos[:6]
        
        # 清洗所有标题
        cleaned_titles = []
        for i, video in enumerate(videos, 1):
            clean_title = self._clean_title(video['title'])
            cleaned_titles.append(f"{i}. {clean_title}")
        
        titles_text = "\n".join(cleaned_titles)
        
        system_prompt = """你是纯音乐视频判断器。我会给你6个B站视频标题，你需要选出最像是纯音乐/原版音乐的视频编号。

判断标准：
**优先选择**（是纯音乐/原版）：
- 标题包含"无损"、"Hi-Res"、"FLAC"、"24bit"、"[音乐]"、"纯享版"、"官方"等
- "百万录音棚"系列
- 只有音乐和画面，没有额外解说或人声干扰

**排除**（不是纯音乐或者出现修改或者出现重复循环）：
- 标题包含"AI翻唱"、"教程"、"钢琴教学"、"吉他教学"、"cover"、"翻唱"、"反应"、"解说"
- 有升key、降key、倍速修改（如"1.5倍速"、"+2key"）
- 有明显的人声互动或评论
- 单曲循环、单曲循环1h（可能循环多次）

**回复格式**：
- 只回复一个数字 1-6（最符合条件的视频编号）
- 如果没有一个是纯音乐，回复 None
- 不要有任何其他内容"""

        user_prompt = f"以下是6个视频标题，请选出最像纯音乐的一个：\n\n{titles_text}"

        print(f"\n🤖 DeepSeek 正在分析 {len(videos)} 个视频...")
        print("   视频列表：")
        for title in cleaned_titles:
            print(f"   {title}")

        try:
            response = self.client.chat.completions.create(
                model="deepseek-chat",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0
            )

            content = response.choices[0].message.content or ""
            content = content.strip()
            
            print(f"\n🤖 DeepSeek 选择：{content}")
            
            # 解析结果
            if content.lower() == 'none':
                print("   所有视频都不符合纯音乐条件")
                return None
            
            # 尝试解析数字
            match = re.search(r'\b([1-6])\b', content)
            if match:
                index = int(match.group(1)) - 1  # 转为0-based索引
                selected = videos[index]
                print(f"   ✅ 选中第 {index + 1} 个：{self._clean_title(selected['title'])}")
                return selected
            else:
                print(f"   ⚠️ 无法解析响应：{content}")
                return None

        except Exception as e:
            print(f"❌ DeepSeek API 调用失败：{type(e).__name__}: {e}")
            return None

    def download_video(self, bvid: str, video_url: str, song_name: str) -> Optional[str]:
        """下载视频并提取音频（带格式容错）"""
        full_url = f"https://www.bilibili.com/video/{bvid}" if not video_url.startswith('http') else video_url
        
        print(f"\n⬇️ 正在下载：{full_url}")
        
        output_dir = self.music_dir
        os.makedirs(output_dir, exist_ok=True)
        
        # 保存当前目录，然后切换到脚本目录
        original_dir = os.getcwd()
        os.chdir(self.script_dir)
        
        try:
            # 检查依赖
            if not self.youget_path:
                print("❌ 未找到 you-get，请将 you-get.exe 放在程序同目录")
                return None
            if not self.ffmpeg_path:
                print("❌ 未找到 ffmpeg，请将 ffmpeg.exe 放在程序同目录")
                return None
            
            cookie_args = ["--cookies", self.cookie_file] if os.path.exists(self.cookie_file) else []
            
            # 定义格式优先级
            preferred_formats = [
                'dash-flv480-HEVC', 'dash-flv480-AV1', 'dash-flv480-AVC',
                'dash-flv360-HEVC', 'dash-flv360-AV1', 'dash-flv360-AVC'
            ]
            
            # 尝试用多种格式下载
            target_video = self._try_download_with_formats(full_url, cookie_args, preferred_formats)
            
            if not target_video:
                print("❌ 所有格式下载失败")
                return None
            
            print(f"✅ 视频已下载：{os.path.basename(target_video)}")
            
            # 提取音频
            song_name_clean = re.sub(r'[<>:"/\\|?*]', '', song_name)
            output_mp3 = os.path.join(output_dir, f"{song_name_clean}.mp3")
            
            print(f"🎵 提取音频 -> {os.path.basename(output_mp3)}")
            ffmpeg_result = subprocess.run(
                [self.ffmpeg_path, "-y", "-i", target_video,
                 "-vn", "-acodec", "libmp3lame", "-q:a", "2", output_mp3],
                capture_output=True,
                timeout=300
            )
            
            if ffmpeg_result.returncode == 0:
                print(f"✅ 完成！音频已保存")
                
                # 清理视频文件
                try:
                    os.remove(target_video)
                    print(f"   已清理视频文件")
                    
                    # 清理临时文件
                    temp_exts = ['.xml', '.json', '.cmt.json', '.danmaku.xml', '.ass', '.srt']
                    for ext in temp_exts:
                        pattern = os.path.join(self.script_dir, f"*{ext}")
                        for temp_file in glob.glob(pattern):
                            if 'selected_songs' not in temp_file:
                                try:
                                    os.remove(temp_file)
                                except:
                                    pass
                except Exception as e:
                    print(f"   清理文件时出错：{e}")
                
                return output_mp3
            else:
                ffmpeg_err = ffmpeg_result.stderr.decode('utf-8', errors='replace') if ffmpeg_result.stderr else ''
                print(f"❌ ffmpeg 转换失败：{ffmpeg_err[-200:]}")
                return None
                
        except subprocess.TimeoutExpired:
            print("❌ 下载超时")
            return None
        except Exception as e:
            print(f"❌ 下载过程出错：{type(e).__name__}: {e}")
            return None
        finally:
            # 恢复原工作目录
            os.chdir(original_dir)

    def _try_download_with_formats(self, full_url: str, cookie_args: list, preferred_formats: list) -> Optional[str]:
        """尝试用多种格式下载，返回成功时的视频文件路径"""
        
        def safe_decode(b):
            if b is None:
                return ''
            for enc in ('utf-8', 'gbk', 'latin-1'):
                try:
                    return b.decode(enc)
                except Exception:
                    continue
            return b.decode('utf-8', errors='replace')
        
        # 先获取所有可用格式
        print("   获取视频格式信息...")
        try:
            info_result = subprocess.run(
                [self.youget_path, "-i"] + cookie_args + [full_url],
                capture_output=True,
                timeout=30
            )
            info_text = safe_decode(info_result.stdout) + safe_decode(info_result.stderr)
            
            # 提取格式名，并去除 ANSI 转义码
            all_formats = re.findall(r'- format:\s*(\S+)', info_text)
            all_formats = [re.sub(r'\x1b\[[0-9;]*m', '', fmt) for fmt in all_formats]
            print(f"   可用格式：{all_formats}")
        except Exception as e:
            print(f"   获取格式失败：{e}")
            all_formats = []
        
        # 按优先级尝试下载
        for fmt in preferred_formats:
            if fmt not in all_formats:
                continue
            
            print(f"   选择格式：{fmt}")
            print("   下载中...")
            
            try:
                dl_result = subprocess.run(
                    [self.youget_path, "--format", fmt] + cookie_args + [full_url],
                    capture_output=True,
                    timeout=300
                )
                
                if dl_result.returncode == 0:
                    # 在当前目录查找下载的视频文件
                    video_files = self._find_downloaded_video(os.getcwd())
                    if video_files:
                        target_video = max(video_files, key=os.path.getmtime)
                        print(f"   下载成功：{os.path.basename(target_video)}")
                        return target_video
            except Exception as e:
                print(f"   格式 {fmt} 下载失败：{e}")
        
        # 如果首选格式都失败，尝试第一个可用格式
        if all_formats:
            first_fmt = all_formats[0]
            print(f"   尝试备用格式：{first_fmt}")
            try:
                dl_result = subprocess.run(
                    [self.youget_path, "--format", first_fmt] + cookie_args + [full_url],
                    capture_output=True,
                    timeout=300
                )
                
                if dl_result.returncode == 0:
                    video_files = self._find_downloaded_video(os.getcwd())
                    if video_files:
                        target_video = max(video_files, key=os.path.getmtime)
                        print(f"   备用格式下载成功：{os.path.basename(target_video)}")
                        return target_video
            except Exception:
                pass
        
        # 最后尝试不指定格式
        print("   尝试默认下载...")
        try:
            dl_result = subprocess.run(
                [self.youget_path] + cookie_args + [full_url],
                capture_output=True,
                timeout=300
            )
            
            if dl_result.returncode == 0:
                video_files = self._find_downloaded_video(os.getcwd())
                if video_files:
                    target_video = max(video_files, key=os.path.getmtime)
                    print(f"   默认下载成功：{os.path.basename(target_video)}")
                    return target_video
        except Exception as e:
            print(f"   默认下载失败：{e}")
        
        return None

    def _find_downloaded_video(self, directory: str) -> List[str]:
        """在指定目录查找下载的视频文件"""
        video_files = []
        for ext in ['*.mp4', '*.flv', '*.mkv', '*.webm']:
            video_files.extend(glob.glob(os.path.join(directory, ext)))
        # 只返回直接在目录下的文件（排除子目录）
        return [f for f in video_files if os.path.dirname(f) == directory]


def main():
    parser = argparse.ArgumentParser(
        description="手动歌曲下载工具 - B 站搜索 + DeepSeek AI 判断纯音乐",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python manual_downloader.py --song "告白气球 周杰伦" --api-key "sk-xxx"
  python manual_downloader.py -s "稻香 - 周杰伦" -k "sk-xxx"

判断逻辑:
  1. 使用 B 站 API 搜索视频
  2. DeepSeek AI 判断是否为纯音乐版本
  3. 如果是，则下载并提取音频
  4. 保存到 music/ 目录并记录到音乐库
        """
    )
    
    parser.add_argument(
        "-s", "--song",
        required=True,
        help="歌曲名称（格式：歌名 - 歌手 或 歌名 歌手）"
    )
    
    parser.add_argument(
        "-k", "--api-key",
        required=True,
        help="DeepSeek API Key"
    )
    
    args = parser.parse_args()

    print("=" * 60)
    print("🎵 手动歌曲下载工具")
    print("=" * 60)
    print(f"歌曲：{args.song}")
    print(f"API: DeepSeek")
    print("=" * 60)

    # 初始化下载器
    downloader = ManualSongDownloader(args.api_key)

    # 解析歌曲信息（简单分割）
    if " - " in args.song:
        title, artist = args.song.split(" - ", 1)
    elif " " in args.song:
        parts = args.song.rsplit(" ", 1)
        title = parts[0]
        artist = parts[-1]
    else:
        title = args.song
        artist = ""  # 不指定歌手，搜索时只用歌曲名

    print(f"\n📝 解析结果:")
    print(f"   歌名：{title}")
    print(f"   歌手：{artist if artist else '(未指定)'}")

    # 检查歌曲是否已存在
    existing_file = downloader.is_song_exists(title)
    if existing_file:
        print(f"\n⚠️ 歌曲已存在：{os.path.basename(existing_file)}")
        print(f"   跳过下载")
        sys.exit(2)  # 退出码 2 表示歌曲已存在

    # B 站搜索（取前6个视频）
    keyword = f"{title} {artist}" if artist else title
    videos = downloader.search_bilibili_videos(keyword, max_results=6)

    if not videos:
        print("\n❌ 未找到相关视频")
        sys.exit(3)  # 退出码 3 表示未找到相关视频

    # AI 一次性判断选出最佳视频
    selected_video = downloader.select_best_video_with_deepseek(videos)

    if not selected_video:
        print("\n❌ 未找到符合条件的纯音乐视频")
        sys.exit(4)  # 退出码 4 表示未找到纯音乐视频

    # 下载
    mp3_path = downloader.download_video(
        selected_video['bvid'],
        selected_video['url'],
        args.song
    )

    if mp3_path:
        print(f"\n✅ 下载完成！文件路径：{mp3_path}")
        sys.exit(0)  # 退出码 0 表示下载成功
    else:
        print(f"\n❌ 下载失败")
        sys.exit(1)  # 退出码 1 表示下载失败


if __name__ == "__main__":
    main()
