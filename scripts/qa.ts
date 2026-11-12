// 画面验收：① 抢戏检查（芽仔在台时长、表情次数与间隔、走动次数、表情可读大小）；
// ② 在每个画面事件的起点/峰值/回落及每个元素动画起止时刻，检查芽仔遮挡、同场文字互挡与出界、竖屏安全区；
// ③ 每场无事件窗口截两帧比对，确认正文像素静止；④ 另存走动连续帧、表情定格供人工逐帧看。
// 用法：pnpm qa --p <项目> [--fmt 3x4] [--query pip=none]
//   → out/qa/overlap(-3x4).md、out/qa/qa(-3x4).json、[v_]walk_*.png、[v_]face_*.png；不通过时退出码 1
import { createServer } from "vite";
import { chromium } from "playwright-core";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const P = args[args.indexOf("--p") + 1] ?? "demo";
const FMT = args.includes("--fmt") ? args[args.indexOf("--fmt") + 1] : "16x9";
const QUERY = args.includes("--query") ? `&${args[args.indexOf("--query") + 1]}` : "";
const SIZE = FMT === "3x4" ? { width: 1080, height: 1440 } : { width: 1920, height: 1080 };
const OUT = join(ROOT, "projects", P, "out");
const SUFFIX = FMT === "3x4" ? "-3x4" : "";
mkdirSync(join(OUT, "qa"), { recursive: true });

// 关掉热更新和文件监听：检查过程会往工程里写截图，监听到变化会刷新页面，导致偶发卡住（与 render.ts 一致）
const server = await createServer({ root: ROOT, server: { port: 5191, hmr: false, watch: null }, logLevel: "error" });
await server.listen();
const port = (server.httpServer!.address() as { port: number }).port;
const b = await chromium.launch({ channel: "chrome" });
const page = await b.newPage({ viewport: SIZE });
await page.addInitScript("window.__name = (target) => target");
const pageErrors: string[] = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
// 浏览器自动请求的 favicon.ico 404 与画面无关，不计入
page.on("console", (m) => m.type() === "error" && !m.location()?.url?.endsWith("/favicon.ico") && pageErrors.push(`${m.text()}${m.location()?.url ? ` ${m.location().url}` : ""}`));
await page.goto(`http://localhost:${port}/?render&p=${P}&fmt=${FMT}${QUERY}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 }).catch((e) => {
  throw new Error(`页面 60 秒内没有就绪${pageErrors.length ? "，页面报错：\n" + pageErrors.join("\n") : "（页面没有报错）"}\n${e.message}`);
});
const ev = (await page.evaluate(() => window.__events)) as { kind: string; label: string; t: number }[]; // 直接取当前代码算出的事件，不依赖上次出片

// ---- 抢戏检查：芽仔是点睛，不是全程解说 ----
const yz = (await page.evaluate(() => window.__yazai)) as { duration: number; onTime: number; walks: number; roadWalks?: number; routes?: { t: number; duration: number }[]; faces: { face: string; t: number; scale: number; talk?: boolean; action?: string }[]; allowed: string[] };
yz.faces = yz.faces.filter((f) => !f.talk);
const storyboard = JSON.parse(readFileSync(join(ROOT, "projects", P, "storyboard.json"), "utf8"));
const sceneList = [...storyboard.scenes].sort((a, b) => a.line - b.line);
const counts = new Map<string, number>();
sceneList.forEach((s) => counts.set(s.template, (counts.get(s.template) ?? 0) + 1));
for (const [name, n] of counts) if (n / sceneList.length > 0.35) console.log(`⚠ 版式多样性：${name} ${n}/${sceneList.length} 场（${(100 * n / sceneList.length).toFixed(1)}%）超过 35%`);
sceneList.forEach((s, i) => {
  if (i >= 2 && s.template === sceneList[i - 1].template && s.template === sceneList[i - 2].template && (i === 2 || s.template !== sceneList[i - 3].template)) console.log(`⚠ 版式多样性：第 ${sceneList[i - 2].line} 行起连续至少 3 场使用 ${s.template}`);
});
const LIMIT = { faces: 6, gap: 10, walks: 2, visorPx: 80 };
const fails: string[] = [];
const ratio = yz.onTime / yz.duration;
if (yz.faces.length > LIMIT.faces) fails.push(`表情 ${yz.faces.length} 次 > ${LIMIT.faces} 次`);
yz.faces.forEach((f, i) => {
  if (i && f.t - yz.faces[i - 1].t < LIMIT.gap) fails.push(`表情间隔 ${(f.t - yz.faces[i - 1].t).toFixed(1)}s < ${LIMIT.gap}s（${f.t.toFixed(1)}s ${f.face}）`);
  if (!yz.allowed.includes(f.face)) fails.push(`表情 ${f.face} 不在可用集合`);
  if (213 * f.scale < LIMIT.visorPx) fails.push(`${f.t.toFixed(1)}s 面罩只有 ${Math.round(213 * f.scale)}px 宽，表情看不清`);
});
if (yz.walks > LIMIT.walks) fails.push(`走动 ${yz.walks} 次 > ${LIMIT.walks} 次`);
const budget = [
  `放大站位 ${yz.onTime.toFixed(1)}s / ${yz.duration.toFixed(1)}s（${(ratio * 100).toFixed(0)}%，纯文字场景放大、演示场景缩在右下角）`,
  `走动 ${yz.walks} 次（上限 ${LIMIT.walks}，road 沿路走动 ${yz.roadWalks ?? 0} 段不计入）`,
  `表情 ${yz.faces.length} 次（上限 ${LIMIT.faces}，间隔 ≥${LIMIT.gap}s）：${yz.faces.map((f) => `${f.t.toFixed(1)}s ${f.face}${f.action ? `+${f.action}` : ""}`).join("、")}`,
];
console.log(budget.join("\n"));
console.log(fails.length ? `✗ 抢戏检查不通过：${fails.join("；")}` : "✓ 抢戏检查通过");

// 采样时刻：事件起点与强调峰值/回落（0/0.18/0.36/0.5/0.6s）、每个元素动画起止；路线额外看起点、中点、终点。
const timings = (await page.evaluate(() => [...document.querySelectorAll("[data-item]")].map((e) => ({ start: Number(e.getAttribute("data-start")), end: Number(e.getAttribute("data-end")) })))) as { start: number; end: number }[];
const probe = [...new Set([
  ...ev.filter((e) => e.kind !== "sub").flatMap((e) => [0, 0.18, 0.36, 0.5, 0.6].map((d) => +(e.t + d).toFixed(3))),
  ...timings.flatMap((t) => [t.start, t.end]),
  ...(yz.routes ?? []).flatMap((r) => [0, 0.25, 0.5, 0.75, 1].map((p) => +(r.t + r.duration * p).toFixed(3))),
])].filter((t) => t >= 0 && t < yz.duration).sort((a, b) => a - b);
const rows: string[] = [];
for (const t of probe) {
  const hits = await page.evaluate((tt) => {
    window.__seek(tt);
    type R = { x: number; y: number; r: number; b: number };
    // 正在淡出的上一场不参与检查：换场 0.17s 交叉淡化时的重叠是有意的
    const fading = (e: Element) => Number(getComputedStyle(e.closest("[data-scene]") ?? document.body).opacity) < 0.99;
    const visible = (e: Element) => (e as SVGGElement).checkVisibility({ opacityProperty: true, visibilityProperty: true } as any) && Number(getComputedStyle(e).opacity) >= 0.15 && !fading(e);
    const rect = (e: Element): R => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom }; };
    // 文字按笔画范围算：基线上 0.88 字号到基线下 0.15 字号；字体框比字形高，用它会把正常行距误判为互挡
    const inkRect = (e: SVGTextElement): R => {
      const r = e.getBoundingClientRect(), m = e.getScreenCTM();
      if (!m || !e.getNumberOfChars()) return { x: r.x, y: r.y, r: r.right, b: r.bottom };
      const p = e.getStartPositionOfChar(0), fs = parseFloat(getComputedStyle(e).fontSize) * Math.hypot(m.c, m.d);
      const base = m.b * p.x + m.d * p.y + m.f;
      return { x: r.x, y: base - 0.88 * fs, r: r.right, b: base + 0.15 * fs };
    };
    const area = (a: R, b: R) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.y, b.y));
    const out: string[] = [];
    // 同一场景内的独立文字不能互挡或出界；换场淡出时的重叠是有意的，不跨场比较。
    for (const sc of [...document.querySelectorAll("[data-scene]")].filter(visible)) {
      const texts = [...sc.querySelectorAll("text")].filter(visible).map((e) => ({ r: inkRect(e), s: e.textContent ?? "" })).filter((x) => x.s.trim() && x.r.r > x.r.x);
      for (let i = 0; i < texts.length; i++) {
        const a = texts[i];
        if (a.r.x < 18 || a.r.r > innerWidth - 18 || a.r.y < 0 || a.r.b > innerHeight) out.push(`文字出界「${a.s}」`);
        for (let j = i + 1; j < texts.length; j++) if (area(a.r, texts[j].r) > 30) out.push(`文字互挡「${a.s} / ${texts[j].s}」`);
      }
    }
    // 芽仔本体按轮廓收缩后检查遮挡
    const yn = document.querySelector('[id^="yazai"]') as SVGGElement;
    const yr = rect(yn), w = yr.r - yr.x, h = yr.b - yr.y;
    const Y: R = { x: yr.x + w * 0.12, y: yr.y + h * 0.05, r: yr.r - w * 0.12, b: yr.b - h * 0.05 };
    const items = [...document.querySelectorAll("[data-item]")].filter((e) => !e.hasAttribute("data-road") && visible(e)).map((e) => ({ r: rect(e), s: e.textContent?.slice(0, 24) || e.getAttribute("data-kind") || "图形" }));
    for (const a of items) { const o = area(Y, a.r); if (o > 900) out.push(`芽仔压住「${a.s}」（${Math.round(o)}px²）`); }
    // 竖屏平台安全区：芽仔与画面内容都不能进入右侧点赞栏（x>930,y>800）、口播小窗、字幕带（y>1158）
    if (innerHeight === 1440) {
      const zones = [{ n: "右侧点赞栏", x: 930, y: 800, r: 1080, b: 1440 }, { n: "口播小窗", x: 40, y: 880, r: 400, b: 1150 }, { n: "字幕带", x: 0, y: 1158, r: 1080, b: 1440 }];
      for (const a of [...items, { r: Y, s: "芽仔" }]) for (const z of zones) { const o = area(a.r, z); if (o > 900) out.push(`${a.s}进入${z.n}（${Math.round(o)}px²）`); }
    }
    return [...new Set(out)];
  }, t);
  if (hits.length) rows.push(`- ${t.toFixed(2)}s：${hits.join("；")}`);
}

// 静止检查：每场找一个没有动画的窗口，只截正文区（排除字幕和芽仔角落），相隔 0.4s 两帧应像素一致。
const transitions = ev.filter((e) => e.kind === "transition").map((e) => e.t), bounds = [0, ...transitions, yz.duration];
const busy = [...timings, ...(yz.routes ?? []).map((r) => ({ start: r.t, end: r.t + r.duration }))];
const stability: { scene: number; t: number; same: boolean; maxPixelDelta: number; changed: number }[] = [];
for (let i = 0; i < bounds.length - 1; i++) {
  const start = bounds[i], end = bounds[i + 1];
  let candidate: number | undefined;
  for (let t = start + 1; t + 0.4 < end - 0.25; t += 0.25) {
    if (busy.some((a) => a.start < t + 0.4 && a.end > t)) continue;
    // 结尾像素字逐块拼出、爆点和结尾标语的彩纸飘落，各约 3s
    if (ev.some((e) => (e.kind === "blocks" || e.kind === "burst" || e.label.startsWith("标语")) && e.t > t - 3 && e.t < t + 0.4)) continue;
    candidate = t;
    break;
  }
  if (candidate === undefined) continue;
  const clip = FMT === "3x4" ? { x: 20, y: 20, width: 1040, height: 850 } : { x: 20, y: 20, width: 1660, height: 780 };
  const fa = join(OUT, "qa", `stable${SUFFIX}_${i}_a.png`), fb = join(OUT, "qa", `stable${SUFFIX}_${i}_b.png`);
  // 只比正文：flow / road / versus 里芽仔会进入正文区，截图时先隐藏
  const shot = async (tt: number, path: string) => {
    await page.evaluate((x) => { window.__seek(x); (document.querySelector('[id^="yazai"]') as SVGGElement).style.display = "none"; }, tt);
    writeFileSync(path, await page.screenshot({ clip }));
    await page.evaluate(() => { (document.querySelector('[id^="yazai"]') as SVGGElement).style.display = ""; });
  };
  await shot(candidate, fa);
  await shot(candidate + 0.4, fb);
  const [maxPixelDelta, changed] = execFileSync("python3", ["-c", 'from PIL import Image; import numpy as np,sys; a=np.asarray(Image.open(sys.argv[1]).convert("RGB"),dtype=int); b=np.asarray(Image.open(sys.argv[2]).convert("RGB"),dtype=int); d=np.abs(a-b).max(axis=2); print(int(d.max()), int((d>10).sum()))', fa, fb], { encoding: "utf8" }).trim().split(" ").map(Number);
  // Chromium 重绘有零星单像素取整差；字形位移、元素晃动会让成片像素同时变化。
  stability.push({ scene: i, t: +candidate.toFixed(2), same: changed <= 20, maxPixelDelta, changed });
}
const unstable = stability.filter((s) => !s.same);
if (unstable.length) fails.push(`无事件正文像素不稳定：${unstable.map((s) => `${s.t}s（${s.changed} 个像素变化）`).join("、")}`);
console.log(`静止正文 ${stability.length - unstable.length}/${stability.length} 场一致`);

const status = fails.length || rows.length || pageErrors.length ? "failed" : "passed";
writeFileSync(join(OUT, "qa", `qa${SUFFIX}.json`), JSON.stringify({ status, samples: probe.length, faces: yz.faces, walks: yz.walks, failures: fails, errors: pageErrors, overlaps: rows, stability }, null, 2));
writeFileSync(
  join(OUT, "qa", `overlap${SUFFIX}.md`),
  `# 芽仔抢戏检查\n\n${budget.map((b) => `- ${b}`).join("\n")}\n\n${fails.length ? fails.map((f) => `- ✗ ${f}`).join("\n") : "通过。"}\n\n# 遮挡、互挡与安全区检查（${probe.length} 个时刻）\n\n${rows.length ? rows.join("\n") : "未发现问题。"}\n\n# 静止检查\n\n${stability.length - unstable.length}/${stability.length} 场正文像素一致。\n`,
);
console.log(rows.length ? rows.slice(0, 30).join("\n") + (rows.length > 30 ? `\n…共 ${rows.length} 个时刻有问题，见 overlap${SUFFIX}.md` : "") : `✓ ${probe.length} 个时刻未发现遮挡、互挡或越界`);
if (pageErrors.length) console.log(`✗ 页面报错：${pageErrors.join("；")}`);

// 走动连续帧（每次走动 1.2s，每 3 帧一张）+ 每个表情出现后 0.5s 的定格（只截芽仔附近）
const V = FMT === "3x4" ? "v_" : "";
const crop = () =>
  page.evaluate(() => {
    const r = (document.querySelector('[id^="yazai"]') as SVGGElement).getBoundingClientRect();
    const W = innerWidth, H = innerHeight;
    const x = Math.max(0, r.x - 260), y = Math.max(0, r.y - 120);
    return { x, y, width: Math.min(W - x, r.width + 520), height: Math.min(H - y, r.height + 170) };
  });
for (const [j, w] of ev.filter((e) => e.kind === "yazai" && e.label.includes("走")).entries())
  for (let i = 0; i < 12; i++) {
    await page.evaluate((tt) => window.__seek(tt), w.t + i * 0.1);
    await page.screenshot({ path: join(OUT, "qa", `${V}walk${j}_${String(i).padStart(2, "0")}.png`), clip: await crop() });
  }
for (const f of yz.faces) {
  await page.evaluate((tt) => window.__seek(tt), f.t + 0.5);
  await page.screenshot({ path: join(OUT, "qa", `${V}face_${f.t.toFixed(1)}_${f.face}.png`), clip: await crop() });
}
await b.close();
await server.close();
console.log(status === "passed" ? "✓ QA 通过" : "✗ QA 不通过");
if (status !== "passed") process.exit(1);
