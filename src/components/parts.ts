// 通用组件：字幕框、对话气泡、手绘箭头、图标、胶带标签、像素字标、时钟、彩纸。
import { C, el, sk, setT, setO, text, rrectPath, circlePath, EN_CONDENSE, type Sketch, type TextOpts } from "../engine/draw";
import { prog, ease, popScale, lerp, rng, W, H, FMT } from "../engine/core";

// ---------- 双语字幕 ----------
export interface SubLine {
  t: number;
  zh: string;
  en: string;
}

/** 底部居中双语字幕：宽度随文字，句间硬切；第一句 3 帧淡入 */
export class Subtitles {
  private items: { g: SVGGElement; t: number }[] = [];
  constructor(parent: Element, lines: SubLine[], private endT: number) {
    lines.forEach((l, i) => {
      const g = el("g", {}, parent);
      // 字幕框：横屏在底部 919，竖屏在 H-240；过宽时整体缩小
      // 竖屏：字幕下移到口播小窗下方，以画面中轴居中；两侧各留 150 避开右侧按钮栏（最宽 780）
      const cx = W / 2, top = FMT === "3x4" ? 1160 : 919;
      const zh = text(g, cx, top + 61, l.zh, { size: 44, font: "zh", weight: 1.3, anchor: "middle" });
      const en = text(g, cx, top + 105, l.en, { size: 31, font: "en", color: "#5d5850", anchor: "middle", weight: 0.5 });
      const w0 = Math.max(zh.getComputedTextLength(), en.getComputedTextLength() * EN_CONDENSE) + 92;
      const k = Math.min(1, (FMT === "3x4" ? 780 : W - 60) / w0);
      if (k < 1) g.setAttribute("transform", `translate(${cx},${top + 62}) scale(${k}) translate(${-cx},${-(top + 62)})`);
      const w = w0;
      const x = cx - w / 2;
      const box = el("g", {}, g);
      g.insertBefore(box, zh);
      el("path", { d: rrectPath(x + 5, top + 6, w, 124, 16), fill: C.ink }, box);
      el("path", { d: rrectPath(x, top, w, 124, 16), fill: C.card }, box);
      sk.rrect(box, x, top, w, 124, 16, 900 + i, { strokeWidth: 3.6, roughness: 0.5, bowing: 0.3 }).stroke(1);
      this.items.push({ g, t: l.t });
    });
  }
  update(t: number) {
    this.items.forEach((it, i) => {
      const next = i + 1 < this.items.length ? this.items[i + 1].t : this.endT;
      const on = t >= it.t && t < next;
      const fade = i === 0 ? prog(t, it.t, 0.1) : 1;
      setO(it.g, on ? fade : 0);
    });
  }
}

// ---------- 对话气泡 ----------
export function bubble(parent: Element, x: number, y: number, w: number, h: number, tail: [number, number, number, number], zh: string, en: string, seed: number) {
  const g = el("g", {}, parent);
  const [tx0, tx1, tipX, tipY] = tail;
  const d =
    `M${x + 22},${y} L${x + w - 22},${y} Q${x + w},${y} ${x + w},${y + 22} L${x + w},${y + h - 22} Q${x + w},${y + h} ${x + w - 22},${y + h} ` +
    `L${tx1},${y + h} L${tipX},${tipY} L${tx0},${y + h} L${x + 22},${y + h} Q${x},${y + h} ${x},${y + h - 22} L${x},${y + 22} Q${x},${y} ${x + 22},${y} Z`;
  el("path", { d, fill: C.card }, g);
  const s = sk.path(g, d, seed, { strokeWidth: 4.2, roughness: 0.9 });
  s.stroke(1);
  const zhT = text(g, x + w / 2, y + h * 0.5 + 6, zh, { size: 46, font: "zh", weight: 1.2, anchor: "middle" });
  const enT = text(g, x + w / 2, y + h * 0.5 + 50, en, { size: 32, font: "en", color: C.grayText, anchor: "middle", weight: 0.5 });
  return { g, sketch: s, zh: zhT, en: enT };
}

// ---------- 手绘箭头 ----------
export class Arrow {
  g: SVGGElement;
  shaft: Sketch;
  head: Sketch;
  constructor(parent: Element, pts: [number, number][], seed: number, curve = true) {
    this.g = el("g", {}, parent);
    this.shaft = curve ? sk.curve(this.g, pts, seed, { strokeWidth: 3.6, roughness: 0.8 }) : sk.line(this.g, pts, seed, { strokeWidth: 3.6, roughness: 0.8 });
    const [ax, ay] = pts[pts.length - 2];
    const [bx, by] = pts[pts.length - 1];
    const a = Math.atan2(by - ay, bx - ax);
    const L = 20;
    const wing = (da: number): [number, number] => [bx - L * Math.cos(a + da), by - L * Math.sin(a + da)];
    this.head = sk.line(this.g, [wing(0.5), [bx, by], wing(-0.5)], seed + 1, { strokeWidth: 3.6, roughness: 0.4 });
  }
  /** 箭杆描出，最后 25% 时画箭头 */
  draw(p: number) {
    this.shaft.stroke(Math.min(1, p / 0.8));
    this.head.stroke(prog(p, 0.8, 0.2));
  }
}

// ---------- 图标 ----------
/** 场记板（剪片）：左上角 (x, y)，约 130×92 */
export function clapper(parent: Element, x: number, y: number, seed: number) {
  const g = el("g", {}, parent);
  el("path", { d: rrectPath(x + 8, y + 30, 116, 62, 5), fill: C.card }, g);
  sk.rrect(g, x + 8, y + 30, 116, 62, 5, seed, { fill: C.blue, fillStyle: "hachure", hachureGap: 9, fillWeight: 2.4, strokeWidth: 4.2 }).all(1);
  const top = el("g", { transform: `rotate(-12 ${x + 8} ${y + 28})` }, g);
  el("path", { d: rrectPath(x + 8, y + 10, 116, 18, 2), fill: C.card }, top);
  for (let i = 0; i < 4; i++) {
    const sx = x + 16 + i * 29;
    sk.path(top, `M${sx},${y + 10} L${sx + 14},${y + 10} L${sx + 4},${y + 28} L${sx - 10},${y + 28} Z`, seed + 2 + i, { fill: C.ink, fillStyle: "solid", strokeWidth: 1.5, roughness: 0.3 }).all(1);
  }
  sk.rrect(top, x + 8, y + 10, 116, 18, 2, seed + 1, { strokeWidth: 4 }).all(1);
  return g;
}

/** 麦克风（配音）：中心 (cx, cy) */
export function mic(parent: Element, cx: number, cy: number, seed: number) {
  const g = el("g", {}, parent);
  sk.rrect(g, cx - 24, cy - 56, 48, 72, 24, seed, { fill: C.yellow, fillStyle: "solid", strokeWidth: 4.4 }).all(1);
  sk.line(g, [[cx - 12, cy - 30], [cx + 12, cy - 30]], seed + 1, { strokeWidth: 3, roughness: 0.3 }).all(1);
  sk.line(g, [[cx - 12, cy - 16], [cx + 12, cy - 16]], seed + 2, { strokeWidth: 3, roughness: 0.3 }).all(1);
  sk.path(g, `M${cx - 38},${cy - 8} C${cx - 38},${cy + 38} ${cx + 38},${cy + 38} ${cx + 38},${cy - 8}`, seed + 3, { strokeWidth: 4.2 }).all(1);
  sk.line(g, [[cx, cy + 28], [cx, cy + 50]], seed + 4, { strokeWidth: 4.2 }).all(1);
  sk.line(g, [[cx - 24, cy + 51], [cx + 24, cy + 51]], seed + 5, { strokeWidth: 4.2 }).all(1);
  return g;
}

/** 纸飞机（发布）：左上角 (x, y)，约 120×80 */
export function plane(parent: Element, x: number, y: number, seed: number) {
  const g = el("g", {}, parent);
  const d = `M${x},${y + 38} L${x + 120},${y} L${x + 74},${y + 80} L${x + 52},${y + 52} Z`;
  el("path", { d, fill: C.card }, g);
  sk.path(g, d, seed, { fill: C.pink, fillStyle: "hachure", hachureGap: 8, fillWeight: 2.2, strokeWidth: 4.2 }).all(1);
  sk.line(g, [[x + 120, y], [x + 52, y + 52], [x + 50, y + 76]], seed + 1, { strokeWidth: 3.6 }).all(1);
  return g;
}

/** 图标 + 中英标签：一起弹出 */
export function iconLabel(parent: Element, icon: (g: Element) => SVGGElement, lx: number, ly: number, zh: string, en: string) {
  const g = el("g", {}, parent);
  const ig = icon(g);
  const zhT = text(g, lx, ly, zh, { size: 56, font: "zh", weight: 1.6 });
  const enT = text(g, lx + 2, ly + 43, en, { size: 36, font: "en", color: C.gray, weight: 0.5 });
  return { g, icon: ig, zh: zhT, en: enT };
}

// ---------- 手写记号 ----------
export function mark(parent: Element, x: number, y: number, str: string, o: TextOpts) {
  const g = el("g", {}, parent);
  text(g, x, y, str, o);
  return g;
}

// ---------- 胶带标签 ----------
export function tape(parent: Element, x: number, y: number, w: number, h: number, label: string, seed: number) {
  const g = el("g", {}, parent);
  const r = rng(seed);
  const pts: string[] = [];
  // 上下边缘撕口
  for (let i = 0; i <= 12; i++) pts.push(`${x + (w * i) / 12},${y + (r() - 0.5) * 7}`);
  for (let i = 0; i <= 6; i++) pts.push(`${x + w + (r() - 0.5) * 8},${y + (h * i) / 6}`);
  for (let i = 12; i >= 0; i--) pts.push(`${x + (w * i) / 12},${y + h + (r() - 0.5) * 7}`);
  for (let i = 6; i >= 0; i--) pts.push(`${x + (r() - 0.5) * 8},${y + (h * i) / 6}`);
  el("path", { d: `M${pts.join(" L")} Z`, fill: C.yellow }, g);
  text(g, x + w / 2, y + h / 2 + 24, label, { size: 70, font: "en", weight: 2.6, anchor: "middle" });
  return g;
}

// ---------- 像素字标 ----------
const PIXEL: Record<string, string[]> = {
  J: ["###", "..#", "..#", "#.#", "###"],
  A: ["###", "#.#", "###", "#.#", "#.#"],
  C: ["###", "#..", "#..", "#..", "###"],
  K: ["#.#", "#.#", "##.", "#.#", "#.#"],
  Y: ["#.#", "#.#", "###", ".#.", ".#."],
};

/** 像素块字标：逐块弹出 */
export class PixelWord {
  g: SVGGElement;
  blocks: { g: SVGGElement; cx: number; cy: number; order: number }[] = [];
  width: number;
  constructor(parent: Element, word: string, x: number, y: number, cell: number, seed: number) {
    this.g = el("g", {}, parent);
    let col = 0;
    let s = seed;
    const list: { cx: number; cy: number; c: number; r: number }[] = [];
    for (const ch of word) {
      const rows = PIXEL[ch];
      rows.forEach((row, r) =>
        [...row].forEach((v, c) => {
          if (v === "#") list.push({ cx: x + (col + c) * cell + cell / 2, cy: y + r * cell + cell / 2, c: col + c, r });
        }),
      );
      col += rows[0].length + 1;
    }
    this.width = (col - 1) * cell;
    // 从左到右、每列自上而下
    list.sort((a, b) => a.c - b.c || a.r - b.r);
    list.forEach((b, i) => {
      const g = el("g", {}, this.g);
      const h = cell / 2 + 0.6;
      sk.rrect(g, b.cx - h, b.cy - h, h * 2, h * 2, 2, ++s, { fill: C.ink, fillStyle: "solid", strokeWidth: 2.2, roughness: 0.6 }).all(1);
      this.blocks.push({ g, cx: b.cx, cy: b.cy, order: i });
    });
  }
  /** 按进度曲线逐块弹出：第 k 块在曲线到达 (k+1)/n 时出现，每块 0.12s */
  build(t: number, curve: [number, number][]) {
    const n = this.blocks.length;
    const at = (f: number) => {
      for (let i = 1; i < curve.length; i++) {
        const [t0, f0] = curve[i - 1];
        const [t1, f1] = curve[i];
        if (f <= f1) return t0 + ((t1 - t0) * (f - f0)) / Math.max(1e-6, f1 - f0);
      }
      return curve[curve.length - 1][0];
    };
    for (const b of this.blocks) {
      const ts = Math.max(curve[0][0], at((b.order + 1) / n));
      const sc = popScale(t, ts, 0.12);
      setO(b.g, sc > 0 ? 1 : 0);
      setT(b.g, 0, 0, Math.max(0.001, sc), 0, b.cx, b.cy);
    }
  }
}

// ---------- 时钟 ----------
export function clock(parent: Element, cx: number, cy: number, seed: number) {
  const g = el("g", {}, parent);
  el("path", { d: circlePath(cx, cy, 70), fill: C.card }, g);
  const ring = el("g", {}, g);
  sk.path(ring, circlePath(cx, cy, 70) + circlePath(cx, cy, 58), seed, { fill: C.pink, fillStyle: "hachure", hachureGap: 7, fillWeight: 2, stroke: "none" }).all(1);
  sk.circle(g, cx, cy, 140, seed + 1, { strokeWidth: 4.4 }).all(1);
  sk.circle(g, cx, cy, 116, seed + 2, { strokeWidth: 3.2 }).all(1);
  sk.line(g, [[cx + 2, cy - 40], [cx, cy + 2], [cx + 30, cy + 10]], seed + 3, { strokeWidth: 4.4, roughness: 0.5 }).all(1);
  return g;
}

// ---------- 彩纸 ----------
export class Confetti {
  g: SVGGElement;
  bits: { node: SVGRectElement; vx: number; vy: number; vr: number; r0: number; delay: number }[] = [];
  constructor(parent: Element, private ox: number, private oy: number, n: number, seed: number) {
    this.g = el("g", {}, parent);
    const r = rng(seed);
    const colors = ["#f58ba2", "#ffd240", "#5f93ea", "#9b7cf0", "#ff9f43", "#3cc99a"];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (r() - 0.5) * Math.PI * 1.7;
      const sp = 380 + r() * 520;
      const node = el("rect", { x: -9, y: -5, width: 18, height: 10, rx: 1.5, fill: colors[i % colors.length], stroke: C.ink, "stroke-width": 1.2 }, this.g);
      this.bits.push({ node, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vr: (r() - 0.5) * 900, r0: r() * 360, delay: r() * 0.08 });
    }
  }
  update(t: number, t0: number) {
    for (const b of this.bits) {
      const dt = t - t0 - b.delay;
      if (dt <= 0) {
        setO(b.node, 0);
        continue;
      }
      const drag = 1 - Math.exp(-2.4 * dt);
      const x = this.ox + (b.vx / 2.4) * drag;
      const y = this.oy + (b.vy / 2.4) * drag + 260 * dt * dt;
      setT(b.node, x, y, lerp(0.4, 1, ease.outCubic(prog(dt, 0, 0.12))), b.r0 + b.vr * dt);
      setO(b.node, 1);
    }
  }
}
