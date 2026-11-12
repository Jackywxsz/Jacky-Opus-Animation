# 配乐 + 音效 + 混音：音效按画面事件表触发，和画面同一套时间点。
# 用法：pnpm audio [项目名]   → projects/<项目>/out/{mix,stem_voice,stem_music,stem_sfx}.wav
# 配乐：项目里有 assets/music.mp3 就用它（保持用户调好的音量，循环交叉淡化、结尾淡出）；没有才用程序合成的原创编曲。
# 电平分层（抖音/小红书常用）：人声峰值 -1dBFS（-6~0 区间）；音效峰值 -12dBFS（夹在中间）；配乐保持原电平（用户已调到 -16~-22dB）。
import json, os, sys, wave
import numpy as np

SR = 48000
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
project = sys.argv[1] if len(sys.argv) > 1 else "demo"
PDIR = os.path.join(ROOT, "projects", project)
# 画面事件表由 pnpm render 从场景导出（事件时刻 = 关键词开口 − 提前量），音效跟着事件走
EV = json.load(open(os.path.join(PDIR, "out", "events.json"), encoding="utf-8"))
END = EV["duration"]
BUILD0 = 0.267  # 芽仔开始组装（与场景一致）
N = int(END * SR)
rng = np.random.default_rng(7)


def hz(note):
    names = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
    n = names[note[0]] + (1 if "#" in note else 0)
    octave = int(note[-1])
    return 440.0 * 2 ** ((n + 12 * (octave + 1) - 69) / 12)


def add(buf, sig, t, gain=1.0):
    i = int(t * SR)
    if i >= len(buf):
        return
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[: j - i] * gain


def env(n, a=0.004, d=0.3):
    t = np.arange(n) / SR
    return np.minimum(1, t / a) * np.exp(-t / d)


def pluck(f, dur=1.2, bright=0.5):
    # Karplus-Strong 拨弦
    n = int(dur * SR)
    p = max(2, int(SR / f))
    buf = rng.uniform(-1, 1, p)
    out = np.zeros(n)
    for i in range(n):
        out[i] = buf[i % p]
        buf[i % p] = 0.996 * (bright * buf[i % p] + (1 - bright) * buf[(i + 1) % p])
    return out * env(n, 0.002, 0.9)


def mallet(f, dur=1.0, partials=((1, 1), (4.0, 0.25), (10.0, 0.06)), decay=0.35):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = sum(a * np.sin(2 * np.pi * f * k * t) * np.exp(-t * k / (decay * 6)) for k, a in partials)
    return s * env(n, 0.002, decay)


def bell(f, dur=1.6):
    return mallet(f, dur, ((1, 1), (2.76, 0.45), (5.4, 0.25), (8.9, 0.1)), 0.6)


def noise_burst(dur, lo, hi, decay):
    n = int(dur * SR)
    x = rng.normal(0, 1, n)
    X = np.fft.rfft(x)
    fr = np.fft.rfftfreq(n, 1 / SR)
    X[(fr < lo) | (fr > hi)] = 0
    return np.fft.irfft(X, n) * env(n, 0.002, decay)


def blip(f0=900, f1=1500, dur=0.09):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = np.linspace(f0, f1, n)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.002, dur / 3)


def whoosh(dur=0.45):
    n = int(dur * SR)
    x = rng.normal(0, 1, n)
    out = np.zeros(n)
    # 随时间上扫的简单一阶带通
    lo = 0.0
    for i in range(n):
        a = 0.02 + 0.25 * (i / n)
        lo += a * (x[i] - lo)
        out[i] = lo
    w = np.sin(np.pi * np.arange(n) / n) ** 2
    return out * w


def norm(x, peak):
    m = np.max(np.abs(x)) or 1
    return x / m * peak


# ---------------- 配乐 ----------------
music = np.zeros(N)
beat = 60 / 108  # 0.556s
start = 2.2
# 开场：上行木琴琶音，跟芽仔从脚到头组装
for t, n in [(0.08, "C5"), (0.45, "E5"), (0.8, "G5"), (1.15, "C6"), (1.55, "E6"), (1.95, "G6")]:
    add(music, mallet(hz(n), 1.2), t, 0.55)
# 和弦走向（原创编配，常用 I–vi–IV–V）
prog = [("C4", "E4", "G4"), ("A3", "C4", "E4"), ("F3", "A3", "C4"), ("G3", "B3", "D4")]
bass = ["C3", "A2", "F2", "G2"]
bar = beat * 4
t = start
k = 0
while t < END:
    chord = prog[k % 4]
    # 尤克里里：每拍一扫，弱拍更轻
    for b in range(4):
        tb = t + b * beat
        if tb >= END:
            break
        g = 0.34 if b in (0, 2) else 0.2
        for j, n in enumerate(chord):
            add(music, pluck(hz(n) * 2, 0.9, 0.55), tb + j * 0.012, g)
    add(music, mallet(hz(bass[k % 4]), 1.6, ((1, 1), (2, 0.2)), 0.5), t, 0.55)
    # 轻打击：每两拍一记 + 沙锤八分
    for b in (1, 3):
        add(music, noise_burst(0.12, 1500, 7000, 0.035), t + b * beat, 0.35)
    for e in range(8):
        add(music, noise_burst(0.05, 5000, 12000, 0.012), t + e * beat / 2, 0.12)
    # 小木琴点缀（每两小节一句）
    if k % 2 == 1:
        for j, n in enumerate([chord[2], chord[1], chord[0]]):
            add(music, mallet(hz(n) * 2, 0.8), t + 2 * beat + j * beat / 2, 0.16)
    t += bar
    k += 1
music = norm(music, 0.5) * 0.3
USER_MUSIC = os.path.join(PDIR, "assets", "music.mp3")
if os.path.exists(USER_MUSIC):
    import subprocess as _sp
    raw = _sp.run(["ffmpeg", "-v", "error", "-i", USER_MUSIC, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True).stdout
    src = np.frombuffer(raw, dtype=np.float32).astype(float)
    xf = int(3.0 * SR)  # 循环接缝 3s 交叉淡化
    music = np.zeros(N)
    pos, first = 0, True
    while pos < N:
        seg = src.copy()
        if not first:
            seg[:xf] *= np.linspace(0, 1, xf)
            music[pos - xf : pos] *= np.linspace(1, 0, xf)
            pos -= xf
        n = min(len(seg), N - pos)
        music[pos : pos + n] += seg[:n]
        pos += n
        first = False
    music[: int(0.3 * SR)] *= np.linspace(0, 1, int(0.3 * SR))
# 结尾淡出
fade = int(2.0 * SR)
music[-fade:] *= np.linspace(1, 0, fade)

# ---------------- 音效 ----------------
sfx = np.zeros(N)
for dt in [0.0, 0.23, 0.33, 0.5, 0.73, 0.83]:  # 组装时的轻“嗒”
    add(sfx, noise_burst(0.04, 2000, 6000, 0.01), BUILD0 + dt, 0.25)
for e in EV["events"]:
    k, t = e["kind"], e["t"]
    if k == "q":
        add(sfx, blip(700, 1300), t, 0.45)
    elif k == "bubble":
        add(sfx, blip(600, 1100, 0.12), t, 0.5)
    elif k == "strike":
        add(sfx, noise_burst(0.12, 1800, 6000, 0.05), t, 0.55)  # 划线
    elif k == "icon":
        add(sfx, blip(900, 1600), t, 0.4)
    elif k == "surprise":
        add(sfx, blip(1200, 700, 0.14), t, 0.5)
    elif k == "transition":
        add(sfx, norm(whoosh(0.5), 1), t - 0.1, 0.35)
    elif k == "tag":
        add(sfx, blip(800, 1200), t, 0.35)
    elif k == "blocks":
        for j in range(10):  # 像素块逐个落下（前快后慢）
            add(sfx, noise_burst(0.03, 2500, 8000, 0.008), t + 0.7 * (j / 10) ** 1.6, 0.2)
    elif k == "xai":
        add(sfx, bell(hz("E6")), t, 0.45)  # 揭晓“叮”
        add(sfx, bell(hz("B6")) * 0.6, t + 0.06, 0.3)
    elif k == "char":
        add(sfx, noise_burst(0.035, 2500, 7000, 0.01), t, 0.25)
    elif k == "clock":
        add(sfx, blip(1000, 1700), t, 0.35)
    elif k in ("chip", "card", "stat", "doc", "bullet", "page", "search", "issue", "title", "mark", "header", "shot"):
        add(sfx, blip(820 + (sum(map(ord, e["label"])) % 5) * 90, 1400, 0.09), t, 0.3)
    elif k == "stamp":
        add(sfx, blip(420, 160, 0.16), t, 0.55)
        add(sfx, noise_burst(0.08, 200, 2500, 0.03), t, 0.35)
    elif k == "burst":
        add(sfx, noise_burst(0.35, 3000, 14000, 0.12), t, 0.4)  # 彩纸
        for j, n in enumerate(["G6", "C7", "E7"]):
            add(sfx, bell(hz(n), 0.8), t + j * 0.06, 0.18)
sfx = np.clip(sfx, -1, 1)


# ---------------- 混音 ----------------
def read_wav(path):
    with wave.open(path) as w:
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
        if w.getnchannels() == 2:
            x = x.reshape(-1, 2).mean(1)
        return x


def write_wav(path, x):
    x = np.clip(x, -1, 1)
    st = np.stack([x, x], 1)
    with wave.open(path, "w") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((st * 32767).astype(np.int16).tobytes())


voice = np.zeros(N)
vp = os.path.join(PDIR, "voice", "narration.wav")
if os.path.exists(vp):
    v = read_wav(vp)[:N]
    voice[: len(v)] = v
db = lambda x: 20 * np.log10(np.max(np.abs(x)) + 1e-12)
voice *= 10 ** (-1 / 20) / (np.max(np.abs(voice)) or 1)  # 人声峰值 -1dBFS
sfx *= 10 ** (-12 / 20) / (np.max(np.abs(sfx)) or 1)  # 音效峰值 -12dBFS
mix = voice + music + sfx
peak = np.max(np.abs(mix))
if peak > 0.97:  # 叠加偶发超过时整体轻压，不改变层级关系
    mix *= 0.97 / peak

out = os.path.join(PDIR, "out")
os.makedirs(out, exist_ok=True)
write_wav(os.path.join(out, "stem_voice.wav"), voice)
write_wav(os.path.join(out, "stem_music.wav"), music)
write_wav(os.path.join(out, "stem_sfx.wav"), sfx)
write_wav(os.path.join(out, "mix.wav"), mix)
# 说话时段配乐的实际峰值（人声 RMS 高于 -30dB 的 100ms 窗口）
w = int(0.1 * SR)
talk = [i for i in range(0, N - w, w) if 20 * np.log10(np.sqrt(np.mean(voice[i:i + w] ** 2)) + 1e-12) > -30]
m_talk = max((np.max(np.abs(music[i:i + w])) for i in talk), default=0)
print(f"✓ {os.path.relpath(out, ROOT)}/mix.wav（{END}s）配乐：{'用户提供' if os.path.exists(USER_MUSIC) else '程序合成'}")
print(f"  峰值 dBFS：人声 {db(voice):.1f}｜音效 {db(sfx):.1f}｜配乐 {db(music):.1f}（说话时 {20*np.log10(m_talk+1e-12):.1f}）｜总混 {db(mix):.1f}")
