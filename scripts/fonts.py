# 从本机 Excalidraw 包复制手写字体（OFL）并生成带 unicode-range 的 fonts.css。
# 用法：pnpm fonts [Excalidraw dist/prod 目录]
import re, glob, os, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if len(sys.argv) != 2:
    raise SystemExit("Usage: python3 scripts/fonts.py <excalidraw-dist-prod>")
SRC = sys.argv[1]
OUT = os.path.join(ROOT, "public", "fonts")

js = "".join(open(f, encoding="utf-8").read() for f in glob.glob(os.path.join(SRC, "*.js")))
files = {v: (fam, name) for v, fam, name in re.findall(r'var (\w+)="\./fonts/(Xiaolai|Excalifont)/([^"]+)"', js)}
pairs = re.findall(r'uri:(\w+),descriptors:\{unicodeRange:"([^"]+)"', js)

css, n = [], 0
for var, rng in pairs:
    if var not in files:
        continue
    fam, name = files[var]
    os.makedirs(os.path.join(OUT, fam), exist_ok=True)
    shutil.copyfile(os.path.join(SRC, "fonts", fam, name), os.path.join(OUT, fam, name))
    css.append(f'@font-face{{font-family:"{fam}";src:url("./{fam}/{name}") format("woff2");'
               f'unicode-range:{rng};font-display:block;}}')
    n += 1

# 英文：Patrick Hand（Google Fonts，OFL，已随工程放在 public/fonts/PatrickHand/）
css.append('@font-face{font-family:"Patrick Hand";src:url("./PatrickHand/PatrickHand-Regular.ttf") format("truetype");font-display:block;}')
open(os.path.join(OUT, "fonts.css"), "w", encoding="utf-8").write("\n".join(css) + "\n")
print(f"fonts.css: {n} faces → {OUT}")
