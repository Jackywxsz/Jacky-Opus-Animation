# 对照验收：左右并排视频 + 事件时间误差表（同一检测方法分别测原片和成片）。
# 用法：python3 scripts/compare.py <参考片.mp4> [项目名]
#   → projects/<项目>/out/compare.mp4、timing-report.md
# 检测方法：每个事件一个区域，以窗口起点帧为底，统计与底图差异 > 40 的像素数（墨迹量，不受 8Hz 抖线影响）；
#   “起”= 首次超过最终量的 8%，“完成”= 首次达到 90%。精度 1 帧 = 33ms。
import os, sys, subprocess, glob
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ref = sys.argv[1]
project = sys.argv[2] if len(sys.argv) > 2 else "demo"
OUT = os.path.join(ROOT, "projects", project, "out")
FPS = 30
END = 18.0  # 对照时长；成片更短时取成片时长（见下）

EVENTS = [  # 名称, 区域(全分辨率 x0,y0,x1,y1), 时间窗(秒)
    ("芽仔组装", (780, 300, 1140, 800), (0.0, 2.0)),
    ("字幕①出现", (400, 900, 1520, 1060), (1.8, 3.0)),
    ("问号 ? 弹出", (1100, 140, 1250, 330), (2.0, 3.3)),
    ("气泡弹出", (200, 200, 660, 480), (3.2, 4.2)),
    ("红线划掉 + 不止!", (470, 170, 690, 262), (6.1, 7.0)),
    ("能力① 箭头+图标", (1230, 220, 1600, 340), (6.1, 7.0)),
    ("能力② 箭头+图标", (1380, 480, 1700, 600), (6.9, 7.8)),
    ("能力③ 箭头+图标", (1230, 740, 1600, 870), (7.6, 8.6)),
    ("?! 弹出", (760, 180, 900, 320), (9.0, 9.8)),
    ("胶带标签 2026", (220, 195, 490, 335), (11.3, 12.0)),
    ("像素字标拼出", (370, 360, 960, 530), (11.2, 12.4), "dark"),  # 只计新出现的深色块，芽仔离开不算
    ("× AI 写出", (985, 350, 1250, 500), (12.5, 13.3)),
    ("大标题逐字", (390, 610, 900, 730), (14.5, 15.8)),
    ("时钟 let's go!", (1540, 150, 1720, 390), (15.4, 16.2)),
]
SUB_SWITCH = (400, 930, 1520, 1050)


def frames_of(video, cache):
    if not os.path.isdir(cache) or len(glob.glob(os.path.join(cache, "*.png"))) < END * FPS - 2:
        os.makedirs(cache, exist_ok=True)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-t", str(END), "-i", video, "-vf", "scale=960:540", os.path.join(cache, "%04d.png")], check=True)
    return sorted(glob.glob(os.path.join(cache, "*.png")))


def load(files):
    return [np.asarray(Image.open(f).convert("RGB"), dtype=np.int16) for f in files]


def measure(imgs, roi, win, mode=""):
    x0, y0, x1, y1 = [v // 2 for v in roi]
    a, b = int(win[0] * FPS), min(len(imgs) - 1, int(win[1] * FPS))
    base = imgs[a][y0:y1, x0:x1]

    def amount(im):
        m = np.abs(im - base).max(2) > 40
        if mode == "dark":
            m &= im.max(2) < 90
        return int(m.sum())

    amt = [amount(imgs[i][y0:y1, x0:x1]) for i in range(a, b + 1)]
    final = max(amt[-3:]) or 1
    on = next((a + k for k, v in enumerate(amt) if v > 0.08 * final), None)
    done = next((a + k for k, v in enumerate(amt) if v >= 0.9 * final), None)
    return on, done


def switches(imgs):
    x0, y0, x1, y1 = [v // 2 for v in SUB_SWITCH]
    out = []
    for i in range(1, len(imgs)):
        d = (np.abs(imgs[i][y0:y1, x0:x1] - imgs[i - 1][y0:y1, x0:x1]).max(2) > 60).sum()
        if d > 1500 and (not out or i - out[-1] > 10):
            out.append(i)
    return out


TIMING = "--timing" in sys.argv  # 只有“参考片时钟”的版本才需要逐事件对表
ours_dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", os.path.join(OUT, "demo.mp4")], capture_output=True, text=True).stdout)
END = min(END, ours_dur)
if not TIMING:
    subprocess.run([
        "ffmpeg", "-v", "error", "-y", "-t", str(END), "-i", ref, "-i", os.path.join(OUT, "demo.mp4"),
        "-filter_complex",
        "[0:v]scale=960:540,drawtext=text='参考片（原配音）':fontfile='/System/Library/Fonts/Hiragino Sans GB.ttc':x=20:y=16:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.5[a];"
        "[1:v]scale=960:540,drawtext=text='Demo（芽仔 · Jacky）':fontfile='/System/Library/Fonts/Hiragino Sans GB.ttc':x=20:y=16:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.5[b];"
        "[a][b]hstack=inputs=2,pad=1920:1080:0:270:color=black[v]",
        "-map", "[v]", "-map", "1:a", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
        os.path.join(OUT, "compare.mp4"),
    ], check=True)
    print("✓", os.path.join(OUT, "compare.mp4"), "（风格对照；时间已改为按本片配音驱动，不再逐帧对表）")
    sys.exit(0)

ref_imgs = load(frames_of(ref, "/tmp/ref/cmp_ref"))
ours_video = os.path.join(OUT, "demo.mp4")
import shutil
shutil.rmtree(os.path.join(OUT, "cmp_ours"), ignore_errors=True)  # 成片每次重抽，参考片可缓存
our_imgs = load(frames_of(ours_video, os.path.join(OUT, "cmp_ours")))

fmt = lambda f: "—" if f is None else f"{f / FPS:.3f}s (f{f})"
dl = lambda a, b: "—" if a is None or b is None else f"{(b - a) * 1000 / FPS:+.0f}ms"
rows = ["| 事件 | 原片 起 | Demo 起 | Δ起 | 原片 完成 | Demo 完成 | Δ完成 |", "|---|---|---|---|---|---|---|"]
worst = 0
for name, roi, win, *mode in EVENTS:
    r_on, r_done = measure(ref_imgs, roi, win, *mode)
    o_on, o_done = measure(our_imgs, roi, win, *mode)
    for a, b in ((r_on, o_on), (r_done, o_done)):
        if a is not None and b is not None:
            worst = max(worst, abs(b - a))
    rows.append(f"| {name} | {fmt(r_on)} | {fmt(o_on)} | {dl(r_on, o_on)} | {fmt(r_done)} | {fmt(o_done)} | {dl(r_done, o_done)} |")
rs, os_ = switches(ref_imgs), switches(our_imgs)
pairs = [(r, min(os_, key=lambda o: abs(o - r))) for r in rs if os_ and min(abs(o - r) for o in os_) <= 15]
rows.append("")
rows.append("| 字幕切换 | 原片 | Demo | Δ |")
rows.append("|---|---|---|---|")
for k, (r, o) in enumerate(pairs):
    rows.append(f"| 第 {k + 2} 句 | {r / FPS:.3f}s (f{r}) | {o / FPS:.3f}s (f{o}) | {(o - r) * 1000 / FPS:+.0f}ms |")
    worst = max(worst, abs(o - r))
report = "# Demo 时间对照（30fps，1 帧 = 33ms）\n\n" + "\n".join(rows) + f"\n\n最大偏差：{worst} 帧（{worst * 1000 / FPS:.0f}ms）\n"
open(os.path.join(OUT, "timing-report.md"), "w", encoding="utf-8").write(report)
print(report)

# 左右并排：左原片、右 Demo，音频用 Demo
subprocess.run([
    "ffmpeg", "-v", "error", "-y", "-t", str(END), "-i", ref, "-i", ours_video,
    "-filter_complex",
    "[0:v]scale=960:540,drawtext=text='参考片':fontfile='/System/Library/Fonts/Hiragino Sans GB.ttc':x=20:y=16:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.5[a];"
    "[1:v]scale=960:540,drawtext=text='Demo（芽仔 · Jacky）':fontfile='/System/Library/Fonts/Hiragino Sans GB.ttc':x=20:y=16:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.5[b];"
    "[a][b]hstack=inputs=2,pad=1920:1080:0:270:color=black[v]",
    "-map", "[v]", "-map", "1:a", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
    os.path.join(OUT, "compare.mp4"),
], check=True)
print("✓", os.path.join(OUT, "compare.mp4"))
