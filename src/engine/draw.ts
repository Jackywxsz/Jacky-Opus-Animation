// 手绘图元：rough.js 生成路径（固定 seed，可复现），支持"描线画出"和"排线逐条画出"。
import rough from "roughjs";
import type { Options } from "roughjs/bin/core";

export const NS = "http://www.w3.org/2000/svg";

// 参考片取色
export const C = {
  ink: "#1f1e1c",
  paper: "#f7f1e8",
  card: "#faf5ed",
  gray: "#8f897f",
  grayText: "#aaa59b",
  red: "#e5566b",
  pink: "#f58ba2",
  blush: "#fe89a1",
  yellow: "#ffd240",
  mint: "#3cc99a",
  green: "#26b06a",
  blue: "#5f93ea",
  sprout: "#8fd14f",
  sproutDark: "#5fa530",
};

// 中文 Xiaolai；英文与中文里夹的字母统一 Patrick Hand（与 Excalidraw 风格的 jacky-sketch-broll 拉开差异）
export const FONT = {
  zh: '"Xiaolai", "Patrick Hand", sans-serif',
  en: '"Patrick Hand", "Xiaolai", sans-serif',
};

const gen = rough.generator();

export function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  parent?: Element,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(e);
  return e;
}

export const INK: Options = {
  stroke: C.ink,
  strokeWidth: 4.5,
  roughness: 1.1,
  bowing: 0.7,
  disableMultiStroke: true,
  disableMultiStrokeFill: true,
  hachureGap: 12,
  fillWeight: 3.2,
  hachureAngle: -52,
  preserveVertices: false,
};

/** 一个手绘图形：outline 描线、fill 排线/实心，各自独立控制进度 */
export class Sketch {
  g: SVGGElement;
  strokes: SVGPathElement[] = [];
  hatches: SVGPathElement[] = [];
  solids: SVGPathElement[] = [];

  constructor(parent: Element, drawable: ReturnType<typeof gen.path>, extra: { lineCap?: string } = {}) {
    this.g = el("g", {}, parent);
    const fillStyle = drawable.options.fillStyle;
    const paths = gen.toPaths(drawable);
    // rough 的顺序：填充在前、描边在后
    for (const p of paths) {
      const node = el("path", { d: p.d }, this.g);
      if (p.fill && p.fill !== "none") {
        node.setAttribute("fill", p.fill);
        node.setAttribute("stroke", "none");
        this.solids.push(node);
      } else {
        node.setAttribute("fill", "none");
        node.setAttribute("stroke", p.stroke);
        node.setAttribute("stroke-width", String(p.strokeWidth));
        node.setAttribute("stroke-linecap", extra.lineCap ?? "round");
        node.setAttribute("stroke-linejoin", "round");
        node.setAttribute("pathLength", "1");
        node.setAttribute("stroke-dasharray", "1 1");
        const isFill = p.stroke === drawable.options.fill && fillStyle !== "solid";
        (isFill ? this.hatches : this.strokes).push(node);
      }
    }
  }

  /** 描线进度 0..1 */
  stroke(p: number) {
    for (const s of this.strokes) dash(s, p);
    return this;
  }
  /** 排线逐条画出 0..1；实心填充按透明度 */
  fill(p: number) {
    for (const s of this.hatches) dash(s, p);
    for (const s of this.solids) s.setAttribute("opacity", String(p));
    return this;
  }
  all(p: number) {
    return this.stroke(p).fill(p);
  }
}

function dash(node: SVGPathElement, p: number) {
  if (p <= 0.001) {
    node.setAttribute("visibility", "hidden");
    return;
  }
  node.setAttribute("visibility", "visible");
  node.setAttribute("stroke-dashoffset", String(1 - Math.min(1, p)));
}

// ---------- 路径工具 ----------

export function rrectPath(x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  return `M${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} L${x + r},${y + h} Q${x},${y + h} ${x},${y + h - r} L${x},${y + r} Q${x},${y} ${x + r},${y} Z`;
}

export function circlePath(cx: number, cy: number, r: number) {
  return `M${cx - r},${cy} A${r},${r} 0 1,0 ${cx + r},${cy} A${r},${r} 0 1,0 ${cx - r},${cy} Z`;
}

type O = Partial<Options>;
const opt = (seed: number, o: O = {}): Options => ({ ...INK, seed, ...o });

export function createSketch(style: O = {}) {
  const options = (seed: number, o: O) => ({ ...opt(seed, o), ...style });
  return {
    path: (parent: Element, d: string, seed: number, o: O = {}) => new Sketch(parent, gen.path(d, options(seed, o))),
    rrect: (parent: Element, x: number, y: number, w: number, h: number, r: number, seed: number, o: O = {}) =>
      new Sketch(parent, gen.path(rrectPath(x, y, w, h, r), options(seed, o))),
    circle: (parent: Element, cx: number, cy: number, d: number, seed: number, o: O = {}) =>
      new Sketch(parent, gen.circle(cx, cy, d, options(seed, o))),
    ellipse: (parent: Element, cx: number, cy: number, w: number, h: number, seed: number, o: O = {}) =>
      new Sketch(parent, gen.ellipse(cx, cy, w, h, options(seed, o))),
    line: (parent: Element, pts: [number, number][], seed: number, o: O = {}) =>
      new Sketch(parent, gen.linearPath(pts, options(seed, o))),
    curve: (parent: Element, pts: [number, number][], seed: number, o: O = {}) =>
      new Sketch(parent, gen.curve(pts, options(seed, o))),
  };

}
export const sk = createSketch();

// ---------- 文字 ----------

export interface TextOpts {
  size: number;
  font?: "zh" | "en";
  color?: string;
  weight?: number; // 描边加粗（px）
  anchor?: "start" | "middle" | "end";
  italic?: boolean;
  letterSpacing?: number;
  condense?: number; // 横向压缩（英文默认 0.88，贴近参考片的窄马克笔字形）
}

export const EN_CONDENSE = 1; // Patrick Hand 本身是窄体，不再压缩

export function text(parent: Element, x: number, y: number, str: string, o: TextOpts) {
  const color = o.color ?? C.ink;
  const t = el(
    "text",
    {
      x,
      y,
      "font-family": FONT[o.font ?? "zh"],
      "font-size": o.size,
      fill: color,
      "text-anchor": o.anchor ?? "start",
      "dominant-baseline": "alphabetic",
    },
    parent,
  );
  if (o.weight) {
    t.setAttribute("stroke", color);
    t.setAttribute("stroke-width", String(o.weight));
    t.setAttribute("stroke-linejoin", "round");
    t.setAttribute("paint-order", "stroke");
  }
  if (o.letterSpacing) t.setAttribute("letter-spacing", String(o.letterSpacing));
  const cx = o.condense ?? (o.font === "en" ? EN_CONDENSE : 1);
  const tf: string[] = [];
  if (cx !== 1) tf.push(`translate(${x},${y}) scale(${cx},1) translate(${-x},${-y})`);
  if (o.italic) tf.push(`skewX(-12) translate(${(y * Math.tan((12 * Math.PI) / 180)).toFixed(2)},0)`);
  if (tf.length) t.setAttribute("transform", tf.join(" "));
  t.textContent = str;
  return t;
}

/** 逐字出现的文字：每个字一个 tspan */
export function typeText(parent: Element, x: number, y: number, str: string, o: TextOpts) {
  const t = text(parent, x, y, "", o);
  const chars = [...str].map((ch) => {
    const s = el("tspan", {}, t);
    s.textContent = ch;
    return s;
  });
  return { node: t, chars };
}

// ---------- 变换 ----------

export function setT(node: Element, tx: number, ty: number, s = 1, rot = 0, ox = 0, oy = 0) {
  // 以 (ox, oy) 为原点缩放/旋转，再平移
  node.setAttribute(
    "transform",
    `translate(${(tx + ox).toFixed(2)},${(ty + oy).toFixed(2)}) rotate(${rot.toFixed(3)}) scale(${s.toFixed(4)}) translate(${-ox},${-oy})`,
  );
}

export function setO(node: Element, o: number) {
  node.setAttribute("opacity", o <= 0.001 ? "0" : o >= 0.999 ? "1" : o.toFixed(3));
  node.setAttribute("visibility", o <= 0.001 ? "hidden" : "visible");
}
