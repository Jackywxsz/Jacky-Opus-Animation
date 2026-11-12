# 从芽仔定妆图描出矢量：部件外形（按线稿切分的色块）+ 线稿本身，按头/手臂/身体/嫩芽分组。
# 用法：python3 scripts/trace_yazai.py [定妆图.png]  → src/components/yazai-traced.json
# 坐标：定妆图 (x, y) → 局部 ((x-627)/2, (y-1110)/2)，原点在靴底中点，与动画骨骼一致。
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if len(sys.argv) != 2:
    raise SystemExit("Usage: python3 scripts/trace_yazai.py <authorized-anchor-image.png>")
SRC = sys.argv[1]
OUT = os.path.join(ROOT, "src", "components", "yazai-traced.json")

# 全分辨率切分（线稿更实，泛洪不漏）；局部坐标 = 像素 / 2
im = Image.open(SRC).convert("RGB")
a = np.asarray(im).astype(int)
Hh, Ww = a.shape[:2]
r, g, b = a[..., 0], a[..., 1], a[..., 2]
lum = ndi.gaussian_filter(0.3 * r + 0.59 * g + 0.11 * b, 0.9)  # 轻微柔化，线稿边缘不起毛
toL = lambda x, y: ((x - 627) / 2, (y - 1110) / 2)

sat = a.max(2) - a.min(2)
dark = (lum < 120) & (sat < 70)  # 黑线：又暗又不带颜色（红臂带、蓝红按钮不算）
# 背景：从边缘泛洪（线稿稍加粗防漏）
barrier = ndi.binary_dilation(lum < 170, iterations=2)
lab, _ = ndi.label(~barrier)
edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])))
bg = np.isin(lab, [e for e in edge if e != 0])
bg = ndi.binary_dilation(bg, iterations=2) & ~(lum < 120)
char = ndi.binary_fill_holes(~bg)
inner = ndi.binary_erosion(char, iterations=3)  # 最外圈线稿以内

# 面罩：最大的暗色块
dl, dn = ndi.label(dark & char)
sizes = ndi.sum(np.ones_like(dl), dl, range(1, dn + 1))
visor_id = int(np.argmax(sizes)) + 1
visor = dl == visor_id
visor = ndi.binary_fill_holes(visor)

# 线稿（面罩以外的暗像素），加粗 1px 更像手绘墨线
lines = dark & ~visor & char
lines = ndi.binary_dilation(lines, iterations=2) & char & ~visor

# 色块：角色内非线稿区域，按 4 连通切分
light = char & ~ndi.binary_dilation(dark, iterations=2) & ~visor
pl, pn = ndi.label(light)
parts = []
for i in range(1, pn + 1):
    m = pl == i
    n = int(m.sum())
    if n < 100:
        continue
    ys, xs = np.nonzero(m)
    mr, mg, mb = r[m].mean(), g[m].mean(), b[m].mean()
    if mg > 150 and mr < 200 and mb < 110:
        cls, fill = "green", "leaf"
    elif mr > 170 and mg < 90:
        cls, fill = "red", "#e03a3e"
    elif mb > 120 and mr < 80:
        cls, fill = "blue", "#2f6fe0"
    elif abs(mr - mb) < 45 and mr < 212 and mr > 140:
        cls, fill = "gray", "#bdb7ad"
    else:
        cls, fill = "white", "white"
    cx, cy = toL(xs.mean(), ys.mean())
    parts.append({"i": i, "cls": cls, "fill": fill, "cx": round(cx, 1), "cy": round(cy, 1), "n": n, "x0": toL(xs.min(), 0)[0], "x1": toL(xs.max(), 0)[0], "y0": toL(0, ys.min())[1], "y1": toL(0, ys.max())[1]})

# 分组：头（颈线以上）、嫩芽、左右手臂、身体
NECK = -214
for p in parts:
    if p["cls"] == "green" or p["y1"] < -405:
        p["group"] = "sprout"
    elif p["cy"] < NECK:
        p["group"] = "head"
    elif abs(p["cx"]) > 82 and p["cy"] < -60:
        p["group"] = "armL" if p["cx"] < 0 else "armR"
    else:
        p["group"] = "body"

# 线稿按“离哪个色块最近”分组
gid = {"body": 1, "head": 2, "armL": 3, "armR": 4, "sprout": 5}
gmap = np.zeros(pl.shape, np.uint8)
for p in parts:
    gmap[pl == p["i"]] = gid[p["group"]]
gmap[visor] = gid["head"]
_, idx = ndi.distance_transform_edt(gmap == 0, return_indices=True)
nearest = gmap[idx[0], idx[1]]


def march(mask):
    """marching squares：返回闭合折线（局部坐标）列表"""
    m = np.pad(mask.astype(np.uint8), 1)
    tl, tr, br, bl = m[:-1, :-1], m[:-1, 1:], m[1:, 1:], m[1:, :-1]
    code = tl * 8 + tr * 4 + br * 2 + bl
    E = {"t": (0.5, 0), "r": (1, 0.5), "b": (0.5, 1), "l": (0, 0.5)}
    T = {1: ["lb"], 2: ["br"], 3: ["lr"], 4: ["tr"], 5: ["lt", "br"], 6: ["tb"], 7: ["lt"], 8: ["tl"], 9: ["tb"], 10: ["tr", "lb"], 11: ["tr"], 12: ["lr"], 13: ["br"], 14: ["lb"]}
    adj = {}
    ys, xs = np.nonzero((code > 0) & (code < 15))
    for y, x in zip(ys, xs):
        for e in T[int(code[y, x])]:
            p = (x + E[e[0]][0] - 1, y + E[e[0]][1] - 1)
            q = (x + E[e[1]][0] - 1, y + E[e[1]][1] - 1)
            adj.setdefault(p, []).append(q)
            adj.setdefault(q, []).append(p)
    loops, seen = [], set()
    for start in adj:
        if start in seen:
            continue
        loop, prev, cur = [start], None, start
        seen.add(start)
        while True:
            nxt = [n for n in adj[cur] if n != prev and n not in seen]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            seen.add(cur)
            loop.append(cur)
        if len(loop) > 6:
            loops.append(loop)
    return loops


def rdp(pts, eps):
    pts = np.array(pts, float)
    if len(pts) < 3:
        return pts
    keep = np.zeros(len(pts), bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        s, e = stack.pop()
        if e <= s + 1:
            continue
        seg = pts[e] - pts[s]
        L = np.hypot(*seg) or 1e-9
        v = pts[s + 1:e] - pts[s]
        d = np.abs(seg[0] * v[:, 1] - seg[1] * v[:, 0]) / L
        k = int(np.argmax(d))
        if d[k] > eps:
            keep[s + 1 + k] = True
            stack += [(s, s + 1 + k), (s + 1 + k, e)]
    return pts[keep]


def chaikin(pts, n=2):
    """闭合折线平滑（切角法）"""
    for _ in range(n):
        p = np.asarray(pts)
        q = np.roll(p, -1, axis=0)
        pts = np.empty((len(p) * 2, 2))
        pts[0::2] = 0.75 * p + 0.25 * q
        pts[1::2] = 0.25 * p + 0.75 * q
    return pts


def to_path(mask, eps=0.7):
    out = []
    for loop in march(mask):
        # 闭合轮廓：从离起点最远处拆成两段分别简化（首尾重合时 RDP 会退化成 2 个点）
        arr = np.array(loop, float)
        k = int(np.argmax(np.hypot(*(arr - arr[0]).T)))
        pts = np.vstack([rdp(loop[: k + 1], eps)[:-1], rdp(loop[k:] + [loop[0]], eps)])
        if len(pts) < 4:
            continue
        pts = chaikin(pts[:-1], 2)
        pts = [toL(x, y) for x, y in pts]
        out.append("M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts) + " Z")
    return " ".join(out)


result = {"parts": [], "lines": {}, "visor": None}
for p in parts:
    m = ndi.binary_dilation(pl == p["i"], iterations=4) & inner  # 伸到线稿下面不留缝，但不越出最外圈轮廓
    d = to_path(m, 1.4)
    if d:
        result["parts"].append({k: p[k] for k in ("cls", "fill", "group", "cx", "cy", "x0", "x1", "y0", "y1")} | {"d": d})
for gname, gi in gid.items():
    d = to_path(lines & (nearest == gi), 0.9)
    if d:
        result["lines"][gname] = d
vy, vx = np.nonzero(visor)
result["visor"] = {"d": to_path(visor, 1.4), "x0": toL(vx.min(), 0)[0], "x1": toL(vx.max(), 0)[0], "y0": toL(0, vy.min())[1], "y1": toL(0, vy.max())[1]}
result["parts"].sort(key=lambda p: -p["cy"])  # 自下而上（组装顺序）
json.dump(result, open(OUT, "w"), ensure_ascii=False)
from collections import Counter
print(f"✓ {os.path.relpath(OUT, ROOT)}：{len(result['parts'])} 个色块 {dict(Counter(p['group'] for p in result['parts']))}，线稿分组 {list(result['lines'])}，面罩 {result['visor']['x0']:.0f}..{result['visor']['x1']:.0f} × {result['visor']['y0']:.0f}..{result['visor']['y1']:.0f}，文件 {os.path.getsize(OUT)//1024}KB")
