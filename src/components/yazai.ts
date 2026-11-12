// 芽仔矢量角色：外形与线稿直接由定妆图描出（scripts/trace_yazai.py → yazai-traced.json），100% 还原构图；
// 渲染时加铅笔明暗、落地阴影、8Hz 抖线，自下而上组装。面罩平时纯黑；情绪时像素表情逐行亮起；停在角落时跑马灯。
// 局部坐标：原点在两只靴底中点，向上为负。定妆图坐标 (x, y) → 局部 ((x-627)/2, (y-1110)/2)，总高约 480。
import { C, el, setT, setO } from "../engine/draw";
import traced from "./yazai-traced.json";
import { cleanPath } from "./clean-path";
import { prog, ease } from "../engine/core";

const WHITE = "#fffaf2";
const GRAYBAND = "#b9b6b0";
const LED = "#8ff5d6";
const LED_BLUSH = "#ff8fab";
const LED_BLUE = "#8cc8ff";

// 14×10 像素屏；e=眼 m=嘴 p=腮红 b=汗滴（蓝）d=加载点（依次亮）。只在情绪时刻显示。
export const FACES = {
  happy: [
    "..............",
    "..............",
    "...e......e...",
    "..e.e....e.e..",
    ".e...e..e...e.",
    "..............",
    ".pp.m....m.pp.",
    ".....mmmm.....",
    "..............",
    "..............",
  ],
  surprise: [
    "..............",
    "..eee....eee..",
    "..e.e....e.e..",
    "..e.e....e.e..",
    "..eee....eee..",
    "..............",
    "......mm......",
    "......mm......",
    "..............",
    "..............",
  ],
  excited: [
    "..............",
    "..e........e..",
    "...e......e...",
    "....e....e....",
    "...e......e...",
    "..e........e..",
    ".pp.mmmmmm.pp.",
    ".....mmmm.....",
    "..............",
    "..............",
  ],
  star: [
    "...e......e...",
    "..eee....eee..",
    ".eeeee..eeeee.",
    "..eee....eee..",
    "..e.e....e.e..",
    "..............",
    ".pp.m....m.pp.",
    ".....mmmm.....",
    "..............",
    "..............",
  ],
  awkward: [
    "...........b..",
    "..........bbb.",
    "..........bbb.",
    "..eee..eee....",
    "..............",
    "..............",
    "....m.mm.m....",
    ".....m..m.....",
    "..............",
    "..............",
  ],
  idea: [
    // 灯泡：想到了
    ".....eeee.....",
    ".e..e....e..e.",
    "...e......e...",
    "ee.e......e.ee",
    "...e......e...",
    ".e..e....e..e.",
    ".....e..e.....",
    ".....mmmm.....",
    ".....mmmm.....",
    "..............",
  ],
  loading: [
    "..............",
    "..............",
    "..............",
    "..............",
    "..dd..dd..dd..",
    "..dd..dd..dd..",
    "..............",
    "..............",
    "..............",
    "..............",
  ],
  tired: [
    "..........b...",
    ".........bbb..",
    "..........b...",
    "..eee....eee..",
    "...e......e...",
    "..............",
    ".....mmmm.....",
    "..............",
    "..............",
    "..............",
  ],
  doubt: [
    "...........ee.",
    "..........e..e",
    ".............e",
    "..eee.......e.",
    "......ee..e...",
    "...........e..",
    ".....mmm......",
    "...........e..",
    "..............",
    "..............",
  ],
  lookL: [
    "..............",
    "..............",
    ".ee....ee.....",
    ".ee....ee.....",
    ".ee....ee.....",
    "..............",
    "...mmmm.......",
    "..............",
    "..............",
    "..............",
  ],
  lookR: [
    "..............",
    "..............",
    ".....ee....ee.",
    ".....ee....ee.",
    ".....ee....ee.",
    "..............",
    ".......mmmm...",
    "..............",
    "..............",
    "..............",
  ],
  think: [
    "..............",
    "..............",
    "..............",
    "..eee....eee..",
    "..............",
    "..............",
    "......mmm.....",
    "..............",
    "..............",
    "..............",
  ],
} as const;
export type Face = keyof typeof FACES;

// 面罩（来自描图）
const V = traced.visor;
const VX = (V.x0 + V.x1) / 2;
const VY = (V.y0 + V.y1) / 2;
const VRX = (V.x1 - V.x0) / 2;
const VRY = (V.y1 - V.y0) / 2;
const CELL = 11;
const GX = VX - 77;
const GY = VY - 57;

export interface YazaiPose {
  x: number; // 靴底中点（舞台坐标）
  y: number;
  scale: number;
  rot?: number;
  headRot?: number;
  armR?: number; // 右臂抬起角度（度，负=向上）
  armL?: number;
  sprout?: number;
  stretchX?: number;
  stretchY?: number;
}

type Group = "body" | "armL" | "armR" | "head" | "sprout";

export class Yazai {
  root: SVGGElement;
  private groups: Record<Group, SVGGElement>;
  private fills: { g: SVGGElement; cy: number }[] = [];
  private wipe: SVGRectElement;
  private faceG: SVGGElement;
  private pixels: Record<Face, SVGGElement> = {} as Record<Face, SVGGElement>;
  private pixelCells: Record<Face, { node: SVGRectElement; row: number; col: number; kind: string }[]> = {} as never;
  private visorFill: SVGPathElement;
  private ids: ReturnType<typeof makeDefs>;
  private shadow: SVGEllipseElement;
  private blinkCover?: SVGPathElement;
  private marq!: { g: SVGGElement; w: number }[];

  constructor(parent: Element, seed = 100, private options: { articulatedArms?: boolean; clean?: boolean } = {}) {
    const svg = (parent as SVGElement).ownerSVGElement ?? (parent as SVGSVGElement);
    this.ids = makeDefs(svg, seed);
    ensureGlow(svg);
    this.root = el("g", { id: `yazai${seed}` }, parent);
    if (options.clean) this.root.setAttribute("data-clean-ip", "true");
    this.shadow = el("ellipse", { cx: 0, cy: 4, rx: 130, ry: 15, fill: "#3a3026", opacity: 0, filter: `url(#${this.ids.blur})` }, this.root);
    // 线稿自下而上擦出（组装感）
    const clip = el("clipPath", { id: `${this.ids.id}wipe` }, this.root);
    this.wipe = el("rect", { x: -260, y: 0, width: 520, height: 0 }, clip);
    const body = el("g", {}, this.root);
    const armL = el("g", {}, this.root);
    const armR = el("g", {}, this.root);
    const head = el("g", {}, this.root);
    const sprout = el("g", {}, head);
    this.groups = { body, armL, armR, head, sprout };
    const layer: Record<Group, { fill: SVGGElement; line: SVGGElement }> = {} as never;
    // 头部：嫩芽在头盔后面
    for (const k of ["body", "armL", "armR", "sprout", "head"] as Group[]) {
      const parentG = k === "sprout" ? sprout : this.groups[k];
      const fill = el("g", {}, parentG);
      layer[k] = { fill, line: undefined as never };
      if (k === "head") {
        // 头部顺序：头盔色块 → 面罩 → 线稿 → 像素屏
      }
    }
    const parts = [...traced.parts.entries()];
    // 连续躯干先画，胸前控制板及按钮仍在其上，避免原描图孔洞顺序造成遮挡。
    if (options.clean) parts.sort(([a], [b]) => a === 19 ? -1 : b === 19 ? 1 : a - b);
    for (const [partIndex, p] of parts) {
      // 原描图在鞋底、手套和叶片下沿保留了二次描线之间的细白碎片。头盔下沿两块细长区域则是参考图的阴影边界，并非结构。
      // 干净版使用相邻主轮廓，避免给这些碎片再描边形成双线/黑边。
      if (options.clean && [0, 1, 8, 10, 11, 24, 25, 29, 30].includes(partIndex)) continue;
      const g = el("g", {}, layer[p.group as Group].fill);
      // 躯干延伸到头盔后方：转头 ±5° 时也不会露出颈部缝隙或旧描图阴影边。
      const cleanD = options.clean && partIndex === 19
        ? "M-73,-239 Q0,-245 77,-239 L82,-133 Q2,-121 -77,-133 Z"
        : options.clean ? cleanPath(p.d) : p.d;
      const fill = p.fill === "white" ? WHITE : p.fill === "leaf" ? (options.clean ? "#8fd14f" : `url(#${this.ids.leaf})`) : p.fill;
      el("path", { d: cleanD, fill, "fill-rule": "evenodd", ...(options.clean ? { stroke: C.ink, "stroke-width": 2.6, "stroke-linecap": "round", "stroke-linejoin": "round", "data-clean-outline": "1" } : {}) }, g);
      if (p.fill === "white" && !options.clean) {
        el("path", { d: p.d, fill: `url(#${this.ids.shade})`, "fill-rule": "evenodd" }, g);
        el("path", { d: p.d, fill: `url(#${this.ids.hatch})`, mask: `url(#${this.ids.mask})`, "fill-rule": "evenodd" }, g);
      }
      this.fills.push({ g, cy: p.cy });
    }
    this.visorFill = el("path", { d: options.clean ? cleanPath(V.d) : V.d, fill: `url(#${this.ids.visor})`, "fill-rule": "evenodd" }, head);
    for (const k of ["body", "armL", "armR", "sprout", "head"] as Group[]) {
      const d = (traced.lines as Record<string, string>)[k];
      if (!d || options.clean) continue;
      const parentG = k === "sprout" ? sprout : this.groups[k];
      el("path", { d, fill: C.ink, "fill-rule": "evenodd", "clip-path": `url(#${this.ids.id}wipe)` }, parentG);
    }
    // 新比喻模板按需启用肩部接头；默认角色的路径和层级不变。
    if (options.articulatedArms && !options.clean) {
      for (const [key, x] of [["armL", -72], ["armR", 77]] as const) {
        const joint = el("ellipse", { cx: x, cy: -198, rx: 22, ry: 20, fill: WHITE, stroke: C.ink, "stroke-width": options.clean ? 2.6 : 2.2, "stroke-linecap": "round", "stroke-linejoin": "round" });
        this.root.insertBefore(joint, this.groups[key]);
      }
    }
    if (options.clean) {
      // 原 IP 是连续宇航服；手臂根部在躯干后，无可见圆形肩关节。
      this.root.insertBefore(armL, body);
      this.root.insertBefore(armR, body);
    }
    if (options.clean) this.blinkCover = el("path", { d: cleanPath(V.d), fill: "#0a0b0d", opacity: 0 }, head);
    // 像素屏（平时隐藏）
    this.faceG = el("g", { filter: "url(#ledGlow)" }, head);
    for (const f of Object.keys(FACES) as Face[]) {
      const g = el("g", {}, this.faceG);
      this.pixels[f] = g;
      this.pixelCells[f] = [];
      FACES[f].forEach((row, r) =>
        [...row].forEach((ch, c) => {
          if (ch === ".") return;
          const node = el("rect", { x: GX + c * CELL + 1, y: GY + r * CELL + 1, width: CELL - 2, height: CELL - 2, rx: 1.6, fill: ch === "p" ? LED_BLUSH : ch === "b" ? LED_BLUE : LED }, g);
          this.pixelCells[f].push({ node, row: r, col: c, kind: ch });
        }),
      );
    }
    // 跑马灯：“Jacky”与“无限 / 生长”分屏轮播，每屏完整显示
    const clipId = `${this.ids.id}visor`;
    el("path", { d: V.d }, el("clipPath", { id: clipId }, head));
    const mg = el("g", { "clip-path": `url(#${clipId})`, filter: "url(#ledGlow)" }, head);
    this.marq = [ledText(mg, ["Jacky"], 11, 5.9), ledText(mg, ["无限", "生长"], 12, 5.1)];
  }

  /** 组装：t0 为开始时间（参考片 0.267s）。线稿自下而上擦出，色块在擦到时淡入，面罩 1.0s 起 */
  build(t: number, t0: number) {
    const at = (a: number, d: number) => prog(t, t0 + (a - 0.267), d);
    const p = ease.inOutQuad(at(0.267, 0.8)); // 0.267 → 1.067
    const top = -490 * p;
    this.wipe.setAttribute("y", top.toFixed(1));
    this.wipe.setAttribute("height", (-top + 10).toFixed(1));
    for (const f of this.fills) {
      const reach = Math.max(0, Math.min(1, (0 - f.cy) / 490)); // 该部件被擦到的进度点
      const tf = 0.267 + 0.8 * reach;
      setO(f.g, at(tf, 0.08));
    }
    setO(this.visorFill, at(1.0, 0.067));
    this.shadow.setAttribute("opacity", (0.16 * at(0.35, 0.15)).toFixed(3));
  }

  setFace(face: Face | null, level = 1, scanIn = true, t = 0) {
    for (const f of Object.keys(this.pixels) as Face[]) setO(this.pixels[f], f === face && level > 0 ? 1 : 0);
    if (!face) return;
    for (const c of this.pixelCells[face]) {
      let o = scanIn ? Math.max(0, Math.min(1, level * 11 - c.row)) : level;
      if (c.kind === "d") o *= Math.floor(c.col / 4) === Math.floor(t / 0.45) % 3 ? 1 : 0.25;
      if (c.kind === "b") o *= 0.55 + 0.45 * Math.cos(t * 5);
      c.node.setAttribute("opacity", o.toFixed(2));
    }
  }

  /** B-roll 眨屏：2.4 秒周期，只改变面罩与原有像素屏，不添加五官。 */
  blink(t: number, since: number) {
    if (!this.options.clean) return;
    const phase = Math.max(0, t - since) % 2.4;
    const pulse = phase > 2.1 ? Math.sin(Math.PI * prog(phase, 2.1, .22)) : 0;
    this.faceG.setAttribute("transform", `translate(0 ${VY}) scale(1 ${(1 - .94 * pulse).toFixed(4)}) translate(0 ${-VY})`);
    if (this.blinkCover) setO(this.blinkCover, .8 * pulse);
  }

  /** 跑马灯：每屏 1.8s（含 0.2s 逐行亮起），“Jacky” → “无限/生长” 循环 */
  setMarquee(level: number, t: number, since: number) {
    const k = level > 0 ? Math.floor(Math.max(0, t - since) / 1.8) % this.marq.length : -1;
    this.marq.forEach((m, i) => setO(m.g, i === k ? level * Math.min(1, ((t - since) % 1.8) / 0.2) : 0));
  }

  pose(p: YazaiPose) {
    setT(this.root, p.x, p.y, p.scale, p.rot ?? 0);
    if (this.options.clean) this.root.setAttribute("transform", this.root.getAttribute("transform") + ` scale(${p.stretchX ?? 1} ${p.stretchY ?? 1})`);
    setT(this.groups.head, 0, 0, 1, Math.max(-5, Math.min(5, p.headRot ?? 0)), 0, -214);
    // 只有新模板显式请求关节时才旋转手臂；默认路径保持原状。
    if (this.options.articulatedArms) {
      setT(this.groups.armR, 0, 0, 1, p.armR ?? 0, 77, -198);
      setT(this.groups.armL, 0, 0, 1, p.armL ?? 0, -72, -198);
    }
    setT(this.groups.sprout, 0, 0, 1, p.sprout ?? 0, 0, -412);
  }
}

/** LED 点阵文字：把文字画到小画布取点阵，整屏居中放在面罩上（每行一段） */
function ledText(parent: Element, lines: string[], px: number, cell: number) {
  const g = el("g", {}, parent);
  const font = `600 ${px}px "PingFang SC", "Hiragino Sans GB", sans-serif`;
  const cv = document.createElement("canvas");
  const ctx = cv.getContext("2d")!;
  ctx.font = font;
  const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width))) + 2;
  const lh = px + 2;
  cv.width = w;
  cv.height = lh * lines.length;
  ctx.font = font;
  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  lines.forEach((l, i) => ctx.fillText(l, w / 2, i * lh + 1));
  const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const x0 = VX - (w * cell) / 2;
  const y0 = VY - (cv.height * cell) / 2;
  for (let y = 0; y < cv.height; y++)
    for (let x = 0; x < w; x++)
      if (data[(y * w + x) * 4 + 3] > 120) el("rect", { x: x0 + x * cell, y: y0 + y * cell, width: cell - 1.4, height: cell - 1.4, rx: 1, fill: LED }, g);
  setO(g, 0);
  return { g, w: w * cell };
}

let glowAdded = false;
function ensureGlow(svg: SVGSVGElement) {
  if (glowAdded) return;
  glowAdded = true;
  const defs = svg.querySelector("defs") ?? el("defs", {}, svg);
  const f = el("filter", { id: "ledGlow", x: "-20%", y: "-20%", width: "140%", height: "140%" }, defs);
  el("feGaussianBlur", { in: "SourceGraphic", stdDeviation: 2.6, result: "b" }, f);
  const m = el("feMerge", {}, f);
  el("feMergeNode", { in: "b" }, m);
  el("feMergeNode", { in: "SourceGraphic" }, m);
}

/** 芽仔的共享定义：铅笔明暗渐变、排线图案与遮罩、叶片渐变、面罩渐变、阴影模糊（按 seed 区分 id） */
function makeDefs(svg: SVGSVGElement, seed: number) {
  const defs = svg.querySelector("defs") ?? el("defs", {}, svg);
  const id = (k: string) => `yz${seed}${k}`;
  const lin = (name: string, x1: number, y1: number, x2: number, y2: number, stops: [number, string, number][]) => {
    const g = el("linearGradient", { id: id(name), x1, y1, x2, y2 }, defs);
    for (const [o, c, a] of stops) el("stop", { offset: o, "stop-color": c, "stop-opacity": a }, g);
  };
  lin("shade", 0.15, 0.1, 1, 0.95, [[0, "#ffffff", 0.5], [0.42, "#d9d0c2", 0], [1, "#7a6d5a", 0.5]]);
  lin("maskg", 0.2, 0.15, 1, 1, [[0, "#000", 1], [0.44, "#000", 1], [0.8, "#fff", 1]]);
  lin("leaf", 0.2, 0, 0.8, 1, [[0, "#b5e36a", 1], [1, "#6cae34", 1]]);
  const pat = el("pattern", { id: id("hatch"), patternUnits: "userSpaceOnUse", width: 6, height: 6, patternTransform: "rotate(38)" }, defs);
  el("line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: "#7a7060", "stroke-width": 1.3, opacity: 0.5 }, pat);
  const mask = el("mask", { id: id("mask"), maskContentUnits: "objectBoundingBox" }, defs);
  el("rect", { x: 0, y: 0, width: 1, height: 1, fill: `url(#${id("maskg")})` }, mask);
  const rg = el("radialGradient", { id: id("visor"), cx: 0.42, cy: 0.38, r: 0.75 }, defs);
  el("stop", { offset: 0, "stop-color": "#2b2d33" }, rg);
  el("stop", { offset: 0.6, "stop-color": "#15161a" }, rg);
  el("stop", { offset: 1, "stop-color": "#0a0b0d" }, rg);
  const blur = el("filter", { id: id("blur"), x: "-30%", y: "-200%", width: "160%", height: "500%" }, defs);
  el("feGaussianBlur", { stdDeviation: 7 }, blur);
  return { id: `yz${seed}`, seed, shade: id("shade"), hatch: id("hatch"), mask: id("mask"), leaf: id("leaf"), visor: id("visor"), blur: id("blur") };
}
