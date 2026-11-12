# 发布合规：把截图里的外平台名称 / 联系方式字样打马赛克。
# 来源两路：① 课件网页里的文字坐标（可选 mask-rects.json，CSS px，截图为 1.5 倍）；② macOS Vision 文字识别（所有截图都跑）。
# 用法：python3 scripts/mask_deck.py <截图目录>   → 原图不动，输出 <目录>/masked/NN.png 与 <目录>/sm/NN.jpg（片子用这份）
import json, os, sys
from PIL import Image
import Vision
from Foundation import NSURL

D = sys.argv[1]
KW = ["企业微信", "微信", "公众号", "小程序", "二维码", "扫码", "抖音", "视频号", "QQ", "钉钉", "飞书", "携程", "飞猪", "美团",
      "大众点评", "腾讯", "邮箱", "豆包", "DeepSeek", "Kimi", "ChatGPT", "Google", "SkillHub", "http", "www.", ".com"]
_rp = os.path.join(D, "mask-rects.json")  # 可选：网页课件截图时由页面导出的文字坐标；普通截图没有就只靠文字识别
rects = json.load(open(_rp)) if os.path.exists(_rp) else {}
os.makedirs(os.path.join(D, "masked"), exist_ok=True)
os.makedirs(os.path.join(D, "sm"), exist_ok=True)


def ocr(path):
    """返回 [(关键词, x, y, w, h)]（像素，左上原点）"""
    img = Image.open(path)
    W, H = img.size
    req = Vision.VNRecognizeTextRequest.alloc().init()
    req.setRecognitionLanguages_(["zh-Hans", "en-US"])
    req.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
    h = Vision.VNImageRequestHandler.alloc().initWithURL_options_(NSURL.fileURLWithPath_(path), {})
    h.performRequests_error_([req], None)
    out = []
    global seen_text
    seen_text += len(req.results() or [])
    for obs in req.results() or []:
        cand = obs.topCandidates_(1)[0]
        s = cand.string()
        for k in KW:
            i = s.lower().find(k.lower())
            while i >= 0:
                box, _ = cand.boundingBoxForRange_error_((i, len(k)), None)
                if box is not None:
                    bb = box.boundingBox()
                    x, y, w, hh = bb.origin.x * W, (1 - bb.origin.y - bb.size.height) * H, bb.size.width * W, bb.size.height * H
                    out.append((k, x, y, w, hh))
                i = s.lower().find(k.lower(), i + len(k))
    return out


def pixelate(img, x, y, w, h, block=14, pad=6):
    x0, y0 = max(0, int(x - pad)), max(0, int(y - pad))
    x1, y1 = min(img.width, int(x + w + pad)), min(img.height, int(y + h + pad))
    if x1 <= x0 or y1 <= y0:
        return
    region = img.crop((x0, y0, x1, y1))
    small = region.resize((max(1, (x1 - x0) // block), max(1, (y1 - y0) // block)), Image.BILINEAR)
    img.paste(small.resize(region.size, Image.NEAREST), (x0, y0))


report = []
seen_text = 0  # 文字识别返回的文本行总数：截图几乎都有字，全为 0 说明识别没跑起来（例如在 Codex 沙箱内）
for f in sorted(x for x in os.listdir(D) if x[:2].isdigit() and x.endswith(".png")):
    i = str(int(f[:2]))
    img = Image.open(os.path.join(D, f)).convert("RGB")
    hits = []
    for r in rects.get(i, []):
        pixelate(img, r["x"] * 1.5, r["y"] * 1.5, r["w"] * 1.5, r["h"] * 1.5, block=18 if r["k"].startswith("外平台") else 14)
        hits.append(r["k"])
    for k, x, y, w, h in ocr(os.path.join(D, f)):
        pixelate(img, x, y, w, h)
        hits.append(f"{k}(图内)")
    img.save(os.path.join(D, "masked", f))
    sm = img.copy()
    sm.thumbnail((1280, 720))
    sm.save(os.path.join(D, "sm", f[:-4] + ".jpg"), quality=86)
    if hits:
        report.append(f"第{i}页：{'、'.join(hits)}")
if not any(x[:2].isdigit() and x.endswith(".png") for x in os.listdir(D)):
    sys.exit(f"✗ {D} 里没有 01.png 这样命名的截图")
if seen_text == 0:
    sys.exit("✗ 文字识别一行字都没识别到，打码结果不可信：检查截图，或换到普通终端重跑")
open(os.path.join(D, "mask-report.md"), "w").write("# 截图打码记录\n\n" + ("\n".join(f"- {r}" for r in report) or "无") + "\n")
print("\n".join(report) or "未发现需要打码的字样")
