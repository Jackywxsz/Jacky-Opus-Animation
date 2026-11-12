/// <reference types="vite/client" />
// Tabler outline → rough.js 手绘线。只预读本条分镜用到的图标，构建阶段同步绘制。
import { C, el, sk, circlePath, rrectPath } from "../engine/draw";

const loaders = import.meta.glob<string>("../../node_modules/@tabler/icons/icons/outline/*.svg", { query: "?raw", import: "default", eager: false });
const paths = new Map<string, string[]>();
const missing = (name: string) => new Error(`图标「${name}」不存在，到 https://tabler.io/icons 查英文名`);

/** 把六类 SVG 基本图形统一成 path；Tabler 的透明画布占位不参与描线。 */
export function svgPaths(source: string): string[] {
  const doc = new DOMParser().parseFromString(source, "image/svg+xml");
  if (doc.querySelector("parsererror")) throw new Error("图标 SVG 格式错误");
  return Array.from(doc.querySelectorAll("path,line,circle,rect,polyline,polygon")).flatMap((n) => {
    if (n.getAttribute("stroke") === "none" && (!n.getAttribute("fill") || n.getAttribute("fill") === "none")) return [];
    const num = (key: string, fallback = 0) => Number(n.getAttribute(key) ?? fallback);
    let d = "";
    switch (n.localName) {
      case "path": d = n.getAttribute("d") ?? ""; break;
      case "line": d = `M${num("x1")},${num("y1")} L${num("x2")},${num("y2")}`; break;
      case "circle": d = circlePath(num("cx"), num("cy"), num("r")); break;
      case "rect": {
        const x = num("x"), y = num("y"), w = num("width"), h = num("height");
        const rx = Math.min(w / 2, num("rx", num("ry"))), ry = Math.min(h / 2, num("ry", rx));
        d = rx && ry ? `M${x+rx},${y} H${x+w-rx} A${rx},${ry} 0 0 1 ${x+w},${y+ry} V${y+h-ry} A${rx},${ry} 0 0 1 ${x+w-rx},${y+h} H${x+rx} A${rx},${ry} 0 0 1 ${x},${y+h-ry} V${y+ry} A${rx},${ry} 0 0 1 ${x+rx},${y} Z` : rrectPath(x, y, w, h, 0);
        break;
      }
      case "polyline": case "polygon": {
        const pts = (n.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number);
        if (pts.length < 4 || pts.length % 2 || pts.some((p) => !Number.isFinite(p))) throw new Error("图标点列格式错误");
        d = pts.reduce((s, p, i) => i % 2 ? s + `${p} ` : s + `${i ? "L" : "M"}${p},`, "") + (n.localName === "polygon" ? "Z" : "");
        break;
      }
    }
    return d ? [d] : [];
  });
}

// diagram / roles 的 icon 是引擎自带的手绘图元（paper、person…），不是 Tabler 图标名
const OWN_SYMBOLS = new Set(["diagram", "roles"]);

export function collectIcons(value: unknown, names = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => collectIcons(v, names));
  else if (value && typeof value === "object" && OWN_SYMBOLS.has((value as { template?: string }).template ?? "")) return names;
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) {
    if (k === "icon" && typeof v === "string") names.add(v);
    else collectIcons(v, names);
  }
  return names;
}

export async function preloadIcons(storyboard: unknown) {
  await Promise.all([...collectIcons(storyboard)].map(async (name) => {
    if (paths.has(name)) return;
    const load = loaders[`../../node_modules/@tabler/icons/icons/outline/${name}.svg`];
    if (!load) throw missing(name);
    const data = svgPaths(await load());
    if (!data.length) throw new Error(`图标「${name}」没有可绘制的轮廓`);
    paths.set(name, data);
  }));
}

export function icon(parent: Element, name: string, cx: number, cy: number, size: number, seed: number, opts: { color?: string } = {}) {
  const data = paths.get(name);
  if (!data) {
    if (!loaders[`../../node_modules/@tabler/icons/icons/outline/${name}.svg`]) throw missing(name);
    throw new Error(`图标「${name}」未预加载，请在构建分镜之前 await preloadIcons`);
  }
  const g = el("g", { "data-icon": name, transform: `translate(${cx-size/2},${cy-size/2}) scale(${size/24})` }, parent);
  // 在 24×24 坐标里使用 1.6 线宽，外层一起缩放，最终线宽正好 size/24*1.6。
  // 不用 non-scaling-stroke：它会使 Sketch 的 pathLength 描线虚线在放大后断续。
  data.forEach((d, i) => sk.path(g, d, seed + i, { roughness: 0.6, strokeWidth: 1.6, stroke: opts.color ?? C.ink, fill: "none" }).all(1));
  return g;
}
