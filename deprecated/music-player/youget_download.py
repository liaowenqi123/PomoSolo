import os
import subprocess
import glob
import re
import shutil

def check_dependency(cmd, name):
    """检查依赖工具是否可用"""
    if shutil.which(cmd) is None:
        print(f"\n错误: 未找到 {name}!")
        print(f"请确保 {name} 已安装并添加到系统环境变量 PATH 中。")
        print(f"安装方法:")
        if cmd == "you-get":
            print("  pip install you-get")
        elif cmd == "ffmpeg":
            print("  Windows: 从 https://ffmpeg.org/download.html 下载并添加到 PATH")
        return False
    return True

def main():
    # 检查必要的依赖工具
    print("正在检查依赖工具...\n")
    
    if not check_dependency("you-get", "you-get"):
        input("按回车键退出...")
        return
    
    if not check_dependency("ffmpeg", "ffmpeg"):
        input("按回车键退出...")
        return
    
    print("依赖检查通过!\n")
    
    # 获取用户输入的网址
    url = input("请输入视频网址: ").strip()
    
    if not url:
        print("网址不能为空!")
        input("按回车键退出...")
        return
    
    # 获取当前脚本所在目录
    script_dir = os.path.dirname(os.path.abspath(__file__))
    output_dir = os.path.join(script_dir, "music")
    os.makedirs(output_dir, exist_ok=True)
    
    os.chdir(script_dir)
    
    # 先获取视频信息
    print(f"\n正在获取视频信息: {url}\n")
    
    result = subprocess.run(
        ["you-get", "-i", url],
        capture_output=True,
        text=True
    )
    
    info_text = result.stdout + result.stderr
    print(info_text)
    
    # 解析可用的格式选项
    # you-get 输出格式类似:
    #     - format:        mp4
    #       container:     mp4
    #       quality:       高清 1080P
    #       size:          123.4 MiB (129398765 bytes)
    #       # download-with: you-get --format=mp4 [URL]
    
    formats = []
    pattern = r'- format:\s*(\S+).*?quality:\s*([^\n]+).*?size:\s*([^\n]+)'
    matches = re.findall(pattern, info_text, re.DOTALL)
    
    for match in matches:
        format_id = match[0].strip()
        quality = match[1].strip()
        size = match[2].strip()
        formats.append({
            'format': format_id,
            'quality': quality,
            'size': size
        })
    
    if not formats:
        print("\n未找到可用的视频格式，将尝试默认下载...")
        format_choice = None
    else:
        # 显示可用格式，默认选择第一个
        print("\n可用的视频格式:")
        print("-" * 50)
        for i, fmt in enumerate(formats, 1):
            print(f"  [{i}] {fmt['format']} - {fmt['quality']} (大小: {fmt['size']})")
        print("-" * 50)
        
        #choice = input(f"\n请选择格式编号 [默认:1]: ").strip()
        choice = ""
        if choice == "":
            idx = 0
        else:
            try:
                idx = int(choice) - 1
                if idx < 0 or idx >= len(formats):
                    idx = 0
            except ValueError:
                idx = 0
        
        format_choice = formats[idx]['format']
        print(f"已选择: {format_choice} ({formats[idx]['quality']})")
    
    # 下载视频
    print(f"\n正在下载...\n")
    
    if format_choice:
        result = subprocess.run(["you-get", "--format", format_choice, url])
    else:
        result = subprocess.run(["you-get", url])
    
    if result.returncode != 0:
        print("\n下载失败!")
        input("按回车键退出...")
        return
    
    print("\n下载完成，正在处理文件...\n")
    
    # 查找下载的mp4文件
    mp4_files = glob.glob("*.mp4")
    
    if not mp4_files:
        print("未找到下载的mp4文件!")
        input("按回车键退出...")
        return
    
    if len(mp4_files) > 1:
        print("下载的mp4文件:")
        for i, f in enumerate(mp4_files, 1):
            size = os.path.getsize(f) / (1024 * 1024)
            print(f"  [{i}] {f} ({size:.2f} MB)")
        
        choice = input(f"\n请选择要转换的文件编号 [默认:1]: ").strip()
        if choice == "":
            idx = 0
        else:
            try:
                idx = int(choice) - 1
                if idx < 0 or idx >= len(mp4_files):
                    idx = 0
            except ValueError:
                idx = 0
        target_mp4 = mp4_files[idx]
    else:
        target_mp4 = mp4_files[0]
    
    # 获取文件名（不含扩展名）
    name = os.path.splitext(os.path.basename(target_mp4))[0]
    output_mp3 = os.path.join(output_dir, name + ".mp3")
    
    print(f"\n正在转换为MP3: {output_mp3}\n")
    
    # 使用ffmpeg转换为mp3
    convert_result = subprocess.run([
        "ffmpeg", "-y", "-i", target_mp4,
        "-vn", "-acodec", "libmp3lame", "-q:a", "2",
        output_mp3
    ])
    
    if convert_result.returncode != 0:
        print("\n转换失败!")
        input("按回车键退出...")
        return
    
    print(f"\n转换成功! 文件保存在: {output_mp3}")
    
    # 记录本次下载产生的文件（基于视频名）
    # you-get 下载的视频文件名通常与转换后的mp3文件名相同（扩展名不同）
    video_base_name = name  # 转换后mp3的文件名（不含扩展名）
    
    # 只删除本次下载产生的临时文件
    print("\n正在清理下载的临时文件...")
    
    # 删除本次下载的mp4文件
    for mp4 in mp4_files:
        mp4_base = os.path.splitext(mp4)[0]
        # 只删除与目标文件同名的mp4
        if mp4_base == video_base_name:
            try:
                os.remove(mp4)
                print(f"已删除: {mp4}")
            except Exception as e:
                print(f"删除失败 {mp4}: {e}")
    
    # 只删除与本次下载同名的其他临时文件
    temp_extensions = [".xml", ".json", ".cmt.json", ".danmaku.xml", ".srt", ".ass", ".flv"]
    for ext in temp_extensions:
        temp_file = video_base_name + ext
        if os.path.exists(temp_file):
            try:
                os.remove(temp_file)
                print(f"已删除: {temp_file}")
            except Exception as e:
                print(f"删除失败 {temp_file}: {e}")
    
    print("\n全部完成!")
    input("按回车键退出...")

if __name__ == "__main__":
    main()
