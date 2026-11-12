// 舞台：暖纸底 + 82px 淡网格 + 暗角；ink 层带 8Hz 抖线滤镜，字幕层不抖。
import { W, H, boilIndex } from "./core";
import { el, setT } from "./draw";

export interface Stage {
  svg: SVGSVGElement;
  camera: SVGGElement; // 镜头（平移/缩放）
  flat: SVGGElement; // 不抖动的内容（截图照片卡），在 ink 下面
  ink: SVGGElement; // 画面内容（8Hz 抖线）
  top: SVGGElement; // 芽仔：不抖动、线条干净，在最上层
  hud: SVGGElement; // 字幕、角标（不随镜头、不抖）
  setBoil(t: number): void;
  setCamera(x: number, y: number, s: number): void;
}

export const GRID = { step: 82, ox: 49, oy: 46 };

export function createStage(host: HTMLElement): Stage {
  const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, xmlns: "http://www.w3.org/2000/svg" });
  host.appendChild(svg);
  const defs = el("defs", {}, svg);

  // 抖线：4 组噪声，按 8Hz 轮换
  for (let i = 0; i < 4; i++) {
    const f = el("filter", { id: `boil${i}`, filterUnits: "userSpaceOnUse", x: -200, y: -200, width: W + 400, height: H + 400 }, defs);
    el("feTurbulence", { type: "fractalNoise", baseFrequency: "0.022", numOctaves: 2, seed: 11 + i * 7, result: "n" }, f);
    el("feDisplacementMap", { in: "SourceGraphic", in2: "n", scale: 3.2, xChannelSelector: "R", yChannelSelector: "G" }, f);
  }

  // 网格
  const pat = el("pattern", { id: "grid", patternUnits: "userSpaceOnUse", width: GRID.step, height: GRID.step, x: GRID.ox, y: GRID.oy }, defs);
  el("path", { d: `M0,0 L${GRID.step},0 M0,0 L0,${GRID.step}`, stroke: "rgba(128,100,72,0.085)", "stroke-width": 2, fill: "none" }, pat);

  // 暗角
  const vg = el("radialGradient", { id: "vignette", cx: W / 2, cy: H / 2, r: 1120, gradientUnits: "userSpaceOnUse", gradientTransform: `translate(${W / 2},${H / 2}) scale(1,0.78) translate(${-W / 2},${-H / 2})` }, defs);
  el("stop", { offset: "0", "stop-color": "#6b5438", "stop-opacity": 0 }, vg);
  el("stop", { offset: "0.52", "stop-color": "#6b5438", "stop-opacity": 0.012 }, vg);
  el("stop", { offset: "0.8", "stop-color": "#6b5438", "stop-opacity": 0.06 }, vg);
  el("stop", { offset: "1", "stop-color": "#6b5438", "stop-opacity": 0.13 }, vg);

  el("rect", { width: W, height: H, fill: "#f7f1e8" }, svg);
  el("rect", { width: W, height: H, fill: "url(#grid)" }, svg);

  const camera = el("g", {}, svg);
  const flat = el("g", {}, camera);
  const ink = el("g", { filter: "url(#boil0)" }, camera);
  const top = el("g", {}, camera);
  const hud = el("g", {}, svg);
  el("rect", { width: W, height: H, fill: "url(#vignette)", "pointer-events": "none" }, svg);

  let lastBoil = -1;
  return {
    svg,
    camera,
    flat,
    ink,
    top,
    hud,
    setBoil(t) {
      const b = boilIndex(t);
      if (b !== lastBoil) {
        ink.setAttribute("filter", `url(#boil${b})`);
        lastBoil = b;
      }
    },
    setCamera(x, y, s) {
      setT(camera, x, y, s, 0, W / 2, H / 2);
    },
  };
}
