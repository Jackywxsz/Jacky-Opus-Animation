// 分镜运行器：storyboard.json（行 + 场景模板）+ 配音逐字时间 → 时间轴。
// agent 只填模板名、文字、关键词（cue）；坐标、时刻、动效都在这里决定。
// 同一场景里的 cue 按书写顺序在口播里依次向后查找；画面与词一起出现（提前量见 src/engine/sync.ts）。
import { Timeline, prog, ease, popScale, emScale, keyframes, lerp, rng, FMT } from "../engine/core";
import type { Stage } from "../engine/stage";
import { C, el, sk, setT, setO, text, typeText, rrectPath, circlePath, type Sketch } from "../engine/draw";
import { icon } from "../components/icons";
import { Yazai, type Face } from "../components/yazai";
import { Subtitles, mark, PixelWord, Confetti, Arrow } from "../components/parts";
import { LEAD } from "../engine/sync";
import { trap, clones } from "./metaphors";
import timing from "../../ref/timing-0-16.json";

type Cued = { text: string; cue: string; em?: boolean; peak?: number };
export interface Storyboard {
  mode?: "broll"; // 显式帧区间、允许空档；默认整片路径保持不变
  lines: { zh: string; en: string }[];
  scenes: any[];
  boil?: boolean; // 线条抖动（参考片质感）。默认关闭：观众反馈满屏抖动干扰阅读
}
export interface VoiceClock {
  end: number;
  lines: { start: number; end: number }[];
  chars: { c: string; t: number }[];
}
export interface Ev {
  kind: string;
  label: string;
  cue: string;
  voice: number;
  t: number;
}

const norm = (s: string) => [...s].filter((c) => /[\p{L}\p{N}]/u.test(c)).join("").toLowerCase();
const fr = (t: number) => Math.round(t * 30) / 30;

const PALETTE: Record<number, [string, string]> = {
  // STOP 序号 → [标签色, 浅底色]
  1: [C.yellow, "#ffe89a"],
  2: [C.mint, "#b6ecd6"],
  3: [C.pink, "#ffc2cf"],
  4: ["#a996f2", "#ddd3ff"],
  5: [C.blue, "#c6dafc"],
};

// 芽仔站位。corner=演示场景缩在右下角（完全静止、面罩纯黑）；stage=纯文字场景在右下原地放大；front=走到台前
const SPOT_H = {
  hero: { x: 700, y: 830, s: 0.96 },
  headline: { x: 1500, y: 840, s: 0.9 },
  corner: { x: 1790, y: 900, s: 0.42 }, // 右下专属区：内容区不越过 x≈1680
  stage: { x: 1770, y: 880, s: 0.62 },
  front: { x: 1640, y: 820, s: 0.68 },
  end: { x: 1493, y: 790, s: 0.715 },
};
// 竖屏 3:4：停靠在口播小窗与右侧点赞栏之间（字幕上方）；大芽仔在底部中间
const SPOT_V: typeof SPOT_H = {
  hero: { x: 640, y: 1150, s: 0.55 },
  headline: { x: 640, y: 1150, s: 0.55 },
  corner: { x: 850, y: 1150, s: 0.42 },
  stage: { x: 845, y: 1150, s: 0.55 },
  front: { x: 640, y: 1150, s: 0.55 },
  end: { x: 640, y: 1150, s: 0.55 },
};
// 平台安全区与固定占位（竖屏 3:4）：右侧点赞/收藏/头像栏（3:4 视频在抖音里上下居中，按钮栏约从画面 y≈800 起）、底部标题区、口播小窗、字幕带
export const V_SAFE = { right: 930, rightFromY: 800, bottom: 1300, pip: { x: 40, y: 880, w: 360, h: 270 }, subTop: 1158 };
type SpotKey = keyof typeof SPOT_H;
// 芽仔只用这几个一眼能看懂的表情（其余表情小尺寸下读不出来）
export const YAZAI_FACES: Face[] = ["surprise", "happy", "doubt", "idea", "loading"];

interface Item {
  g: SVGGElement;
  t0: number;
  mode: "pop" | "fade" | "draw" | "slam" | "now";
  cx?: number;
  cy?: number;
  sks?: Sketch[];
  dur?: number;
  rot?: number;
  kind?: string;
  em?: boolean; // 重点字：只放大元素里最大的那行字（emScale）
  update?: (t: number) => void; // 模板局部动效，仍由绝对时间驱动
  end?: number; // 局部动效的结束时刻（update 驱动的动画需要写，供 QA 判断静止窗口）
  peak?: number; // 单个文本最多 1.12；空间不足降倍率或改为底色高亮
  emNode?: SVGTextElement;
  highlight?: SVGRectElement;
}

export function buildStoryboard(stage: Stage, sb: Storyboard, v: VoiceClock, base = "") {
  const tl = new Timeline();
  const brollMode = sb.mode === "broll";
  const allowedFaces: Face[] = brollMode ? [...YAZAI_FACES, "excited", "awkward"] : YAZAI_FACES;
  tl.duration = v.end;
  const SPOT = FMT === "3x4" ? SPOT_V : SPOT_H;
  const events: Ev[] = [];
  const flat = v.chars.map((c) => brollMode ? norm(c.c) : c.c).join("");
  const lineOff: number[] = [];
  let o = 0;
  for (const l of sb.lines) {
    lineOff.push(o);
    o += [...norm(l.zh)].length;
  }
  const lineOfPos = (p: number) => {
    let i = 0;
    while (i + 1 < lineOff.length && lineOff[i + 1] <= p) i++;
    return i;
  };
  const find = (key: string, from: number) => {
    const k = norm(key);
    const p = flat.indexOf(k, from);
    if (p < 0) throw new Error(`口播里找不到关键词「${key}」（从第 ${lineOfPos(from) + 1} 行起）`);
    return { pos: p, t: v.chars[p].t };
  };
  const ev = (kind: string, label: string, cue: string, voice: number, lead: number) => {
    const t = fr(voice - lead);
    events.push({ kind, label, cue, voice: +voice.toFixed(3), t: +t.toFixed(3) });
    return t;
  };

  const ink = stage.ink;
  if (sb.boil === true) throw new Error("boil 已停用：画面使用稳定字形，请删除 boil 或设为 false");
  ink.removeAttribute("filter"); // 画面完全静止，只有重点字做一次强调
  const scenes = [...sb.scenes].sort((a, b) => a.line - b.line);
  scenes.forEach((sc, i) => {
    if (!Number.isInteger(sc.line) || sc.line < 0 || sc.line >= sb.lines.length || (i && sc.line === scenes[i - 1].line)) throw new Error("场景 line 必须是有效且不重复的零基行号");
  });
  if (brollMode) {
    if (!scenes.length) throw new Error("B-roll 至少需要一个场景");
    scenes.forEach((sc, i) => {
      if (!Number.isInteger(sc.startFrame) || !Number.isInteger(sc.endFrame) || sc.startFrame < 0 || sc.endFrame <= sc.startFrame || sc.endFrame > Math.ceil(v.end * 30)) throw new Error("B-roll 场景需要有效 startFrame / endFrame（30fps，右端不含）");
      if (i && sc.startFrame < scenes[i - 1].endFrame) throw new Error("B-roll 场景帧区间不能重叠或倒序");
    });
  }
  // 步骤条的格数 = 全片最大的步骤号（几步就画几格，不再用“+”代替第 5 步）
  const STEPS = Math.max(1, ...scenes.filter((s) => s.template === "chapter").map((s) => Number(s.stop) || 1));
  const stopCol = (n: number) => PALETTE[((Math.max(1, n) - 1) % 5) + 1];
  const lineStart = (i: number) => (i === 0 ? 0 : fr(v.lines[i].start - LEAD.transition));
  const built: { g: SVGGElement; flat: SVGGElement; items: Item[]; t0: number; t1: number; spot: SpotKey; header?: number }[] = [];
  let wordmark: { word: PixelWord; curve: [number, number][]; cx: number } | null = null;
  const cheers: number[] = [];
  let marqFrom = Infinity; // 结尾面罩亮起“Jacky / 无限生长”
  // 芽仔时间表：plan=站位（on=在台上，否则停靠角落），faces=表情（只在台上出现）
  // pos：模板指定的具体站点（如流程链节点上方），优先于 spot；hop：一格一格跳过去
  type Pos = { x: number; y: number; s: number };
  type Road = { points: [number, number][]; from: number; to: number; duration: number };
  type Way = { t: number; pos: Pos; hop?: number; road?: Road };
  const pointOnRoad = (points: [number, number][], u: number) => {
    const a = 1 - u, [p0, p1, p2, p3] = points;
    return { x: a*a*a*p0[0] + 3*a*a*u*p1[0] + 3*a*u*u*p2[0] + u*u*u*p3[0], y: a*a*a*p0[1] + 3*a*a*u*p1[1] + 3*a*u*u*p2[1] + u*u*u*p3[1] };
  };
  const plan: { t: number; spot: SpotKey; walk: boolean; on: boolean; pos?: Pos; hop?: number; road?: Road; si?: number }[] = [];
  type Action = "retreat" | "approach" | "celebrate" | "observe" | "push";
  const faces: { face: Face; on: number; off: number; talk?: boolean; action?: Action }[] = [];

  const buildScenes = () => {
    scenes.forEach((sc, si) => {
      const g = el("g", { "data-scene": sc.line, "data-template": sc.template }, ink);
      const flat = el("g", {}, stage.flat); // 照片卡放这里：不加抖线滤镜，截图保持清晰
      const items: Item[] = [];
      let cursor = lineOff[sc.line];
      const endPos = lineOff[scenes[si + 1]?.line] ?? v.chars.length;
      // cue 只在本场口播范围内查找，越过下一场直接报错
      const findInScene = (cue: string, start = lineOff[sc.line]) => {
        if (!cue || !norm(cue)) throw new Error(`第 ${sc.line + 1} 行：缺少有效 cue`);
        const f = find(cue, start);
        if (f.pos + norm(cue).length > endPos || (brollMode && (f.t < sc.startFrame / 30 || v.chars[f.pos + norm(cue).length - 1].t >= sc.endFrame / 30))) throw new Error(`第 ${sc.line + 1} 行：cue「${cue}」越过本场景口播范围`);
        return f;
      };
      const S0 = brollMode ? sc.startFrame / 30 : si === 0 ? 0 : lineStart(sc.line);
      // 依次向后找 cue；返回启动时刻
      let lastKind = "";
      let lastEm = false; // 分镜里给元素写 "em": true → 该元素出现时放大强调
      let lastPeak: number | undefined;
      const at = (kind: string, label: string, c: Cued | { cue: string }, lead = LEAD.pop) => {
        // B-roll 的各元素独立按原声 cue 定位，允许模板绘制顺序不同于发声顺序。
        const f = findInScene(c.cue, brollMode ? lineOff[sc.line] : cursor);
        cursor = f.pos;
        lastKind = kind;
        lastEm = !!(c as Cued).em;
        lastPeak = (c as Cued).peak;
        return Math.max(S0 + 0.05, ev(kind, label, c.cue, f.t, lead));
      };
      if (sc.mood || sc.moods) throw new Error("mood / moods 已停用：芽仔的出场和表情写在场景的 yazai 字段里");
      // 不受顺序约束：从本场景第一行起找（截图、标签这类可能早于正文出现的元素用）
      const from = (kind: string, label: string, c: Cued, lead = LEAD.pop) => ((lastKind = kind), (lastEm = !!c.em), (lastPeak = c.peak), Math.max(S0 + 0.05, ev(kind, label, c.cue, findInScene(c.cue).t, lead)));
      const add = (it: Item) => {
        it.g.setAttribute("data-item", "1");
        it.g.setAttribute("data-on", String(it.t0));
        it.kind ??= lastKind;
        it.em ??= lastEm; // 不自动强调，只有分镜写了 em 才强调
        it.peak ??= lastPeak;
        // 强调只作用在关键词文本；容器、序号、单位和说明保持原位。
        if (it.em) {
          const texts = it.g.tagName === "text" ? [it.g as unknown as SVGTextElement] : [...it.g.querySelectorAll<SVGTextElement>("text")];
          it.emNode = texts.sort((a, b) => Number(b.getAttribute("font-size")) - Number(a.getAttribute("font-size")))[0];
          if (!it.emNode) throw new Error(`强调对象「${it.kind}」需要文本`);
          if (items.some((other) => other.em)) throw new Error(`第 ${sc.line + 1} 行：每场只能指定一个 em 重点`);
          it.emNode.setAttribute("data-em", "1");
        }
        // 普通卡片与印章只淡入，不整组弹跳；burst 爆点保留砸下动效。
        if (it.mode === "pop" || (it.mode === "slam" && it.kind !== "burst")) {
          it.mode = "fade";
          if (it.rot) setT(it.g, 0, 0, 1, it.rot, it.cx, it.cy);
        }
        it.g.setAttribute("data-kind", it.kind ?? "");
        it.g.setAttribute("data-start", String(it.t0));
        it.g.setAttribute("data-end", String(it.end ?? it.t0 + (it.em ? 0.6 : it.mode === "draw" ? it.dur ?? 0.2 : it.mode === "slam" ? 0.18 : 0.15)));
        lastKind = "";
        lastEm = false;
        lastPeak = undefined;
        items.push(it);
        return it;
      };
      const yzWay: Way[] = []; // 模板让芽仔参与画面时写入的站点；hop=跳过去的时长
      const S1 = brollMode ? sc.endFrame / 30 : scenes[si + 1] ? lineStart(scenes[si + 1].line) : v.end; // 本场大致结束时刻
      const ctx: Ctx = { brollMode, g, flat, add, at, from, S: S0, S1, sc, si, yzWay };
      validateSemantic(sc);
      const spot = ((FMT === "3x4" ? vtemplates : templates)[sc.template] ?? fail(sc.template))(ctx);
      // 不留白：没有“一开场就在”的元素时，旧画面保留到新场景第一个元素出现前 0.15s
      const timed = items.filter((it) => it.mode !== "now").map((it) => it.t0);
      const hasNow = items.some((it) => it.mode === "now") || sc.template === "chapter";
      const S = brollMode ? S0 : si === 0 ? 0 : hasNow || !timed.length ? S0 : Math.max(S0, fr(Math.min(...timed) - 0.15));
      ctx.S = S;
      g.setAttribute("data-start", String(S));
      const prevHeader = built[si - 1]?.header;
      const header = sc.template === "chapter" ? (FMT === "3x4" ? chapterHeaderV : chapterHeader)(ctx, prevHeader === sc.stop) : undefined;
      constrainEmphasis(g, items);
      if (si > 0) events.push({ kind: "transition", label: `换场 → ${sc.template}`, cue: "行首", voice: v.lines[sc.line].start, t: S });
      built.push({ g, flat, items, t0: S, t1: brollMode ? S1 : Infinity, spot, header });

      // ---- 芽仔：开场/主角/结尾模板用模板站位；其余场景有截图演示就缩在右下角，只有文字就在右下原地放大 ----
      const y = sc.yazai ?? {};
      const base: SpotKey = spot !== "corner" ? spot : flat.childNodes.length ? "corner" : "stage";
      plan.push({ t: S, spot: base, walk: false, on: base !== "corner" });
      // 模板站点按时间顺序接在默认站位之后（plan 必须按时间递增）
      for (const w of [...yzWay].sort((a, b) => a.t - b.t)) plan.push({ t: Math.max(S, w.t), spot: base, walk: !!w.road, on: true, pos: w.pos, hop: w.hop, road: w.road, si });
      // 可选：说到 cue 时换到 at 站位（walk=走过去）
      let onT = S;
      if (y.at) {
        if (!(y.at in SPOT)) throw new Error(`芽仔站位「${y.at}」不存在，可选：${Object.keys(SPOT).join(" / ")}`);
        if (y.cue) onT = Math.max(S, ev("yazai", y.walk ? "芽仔走上前" : "芽仔换位", y.cue, findInScene(y.cue).t, y.walk ? LEAD.transition : LEAD.pop));
        plan.push({ t: onT, spot: y.at, walk: !!y.walk, on: true });
      }
      if (y.face) {
        if (!allowedFaces.includes(y.face)) throw new Error(`芽仔表情「${y.face}」不可用，只能用：${allowedFaces.join(" / ")}`);
        const cue = y.faceCue;
        if (!cue) throw new Error(`第 ${sc.line + 1} 行起的场景：芽仔表情需要 faceCue（表情对应的口播词）`);
        const on = ev("face", `表情：${y.face}`, cue, findInScene(cue).t, LEAD.face);
        if (y.at && on < onT - 0.05) throw new Error(`表情「${cue}」早于芽仔换位，调整 yazai.cue`);
        if (y.action && !["retreat", "approach", "celebrate", "observe", "push"].includes(y.action)) throw new Error(`芽仔动作「${y.action}」不可用`);
        if (y.action === "approach" && !y.walk) throw new Error("approach 需要 walk: true 与对应站位 cue");
        if (y.walk && y.action && y.action !== "approach") throw new Error("同一重点只能有一个芽仔动作");
        faces.push({ face: y.face, on, off: brollMode ? Math.min(S1 - 0.25, on + (y.hold ?? 1.5)) : on + (y.hold ?? 1.5), action: y.action });
      }
    });
    if (!brollMode) built.forEach((b, i) => (b.t1 = built[i + 1]?.t0 ?? Infinity));
    // 模板站点不能越过本场：换场后芽仔回到下一场的默认站位
    for (let i = plan.length - 1; i >= 0; i--) if (plan[i].si !== undefined && plan[i].t >= built[plan[i].si!].t1 - 0.05) plan.splice(i, 1);
  };

  function fail(name: string): never {
    throw new Error(`没有模板「${name}」`);
  }

  // ---------- 模板 ----------
  type Ctx = { brollMode: boolean; g: SVGGElement; flat: SVGGElement; add: (i: Item) => Item; at: (k: string, l: string, c: any, lead?: number) => number; from: (k: string, l: string, c: any, lead?: number) => number; S: number; S1: number; sc: any; si: number; yzWay: Way[] };

  // 纯口播模板：同一时间逻辑、两套画幅坐标，所有可见内容都登记到 add。
  function spokenTemplates(vertical: boolean): Record<string, (c: Ctx) => SpotKey> {
    const cx = vertical ? 540 : 900;
    const title = ({ g, add, sc }: Ctx, y: number) => {
      if (!sc.title) return;
      const tg = el("g", {}, g);
      text(tg, cx, y, sc.title, { size: vertical ? 64 : 76, anchor: "middle", weight: 2 });
      add({ g: tg, t0: 0, mode: "now", em: false });
    };
    // 按实际字体宽度断行，不靠字符数猜宽度；超出三行直接报错，避免静默截字。
    const wrap = (g: SVGGElement, str: string, size: number, width: number) => {
      const probe = text(g, 0, 0, "", { size });
      const rows: string[] = [];
      let row = "";
      for (const ch of [...str]) {
        probe.textContent = row + ch;
        if (ch === "\n" || (row && probe.getComputedTextLength() > width)) {
          // 行尾 4 个字以内有标点，就在标点后断，避免把一个词拆到两行
          const cut = Math.max(...["，", "。", "、", "；", "：", "！", "？"].map((p) => row.lastIndexOf(p)));
          const k = ch !== "\n" && cut >= 0 && row.length - 1 - cut <= 4 ? cut + 1 : row.length;
          rows.push(row.slice(0, k));
          row = row.slice(k) + (ch === "\n" ? "" : ch);
        } else row += ch;
      }
      if (row) rows.push(row);
      probe.remove();
      if (rows.length > 3) throw new Error("quote 金句超过三行，请缩短 text");
      return rows;
    };
    return {
      split(c) {
        const { g, add, at, sc, si } = c;
        const parts = sc.parts as { pct: number; label: string; sub?: string; cue: string; em?: boolean }[];
        if (parts.length < 2 || parts.length > 3 || parts.some((p) => !Number.isFinite(p.pct) || p.pct <= 0) || Math.abs(parts.reduce((n, p) => n + p.pct, 0) - 100) > 0.001) throw new Error("split 需要 2–3 段正数百分比，合计 100");
        const w = vertical ? 900 : 1400, h = vertical ? 120 : 140, y = vertical ? 360 : 420;
        const left = cx - w / 2;
        title(c, y - 100);
        let x = left;
        parts.forEach((p, i) => {
          const pw = w * p.pct / 100, mid = x + pw / 2, t0 = at("card", `占比 ${p.pct}% ${p.label}`, p);
          const seg = el("g", {}, g);
          const id = `split-${vertical ? "v" : "h"}-${si}-${i}`;
          const clip = el("rect", { x, y: y - 6, width: 0, height: h + 12 }, el("clipPath", { id }, el("defs", {}, seg)));
          const fill = el("g", { "clip-path": `url(#${id})` }, seg);
          sk.rrect(fill, x, y, pw, h, 2, 810 + i, { fill: stopCol(i + 1)[0], fillStyle: "hachure", fillWeight: 8, hachureGap: 10, strokeWidth: 3.6 }).all(1);
          add({ g: seg, t0, mode: "now", em: false, end: t0 + 0.35, update: (t) => clip.setAttribute("width", String((pw + 5) * prog(t, t0, 0.35))) });
          const num = el("g", {}, g);
          const nt = text(num, mid, y + h * 0.72, `${p.pct}%`, { size: vertical ? 72 : 88, font: "en", weight: 2, anchor: "middle" });
          if (nt.getComputedTextLength() > pw - 16) throw new Error("split 数字段太窄，请增大占比或减少段数");
          add({ g: num, t0, mode: "pop", cx: mid, cy: y + h / 2, em: !!p.em });
          // 小比例段的说明向内收，连线仍准确指向比例段中点。
          const labelX = Math.max(left + 145, Math.min(left + w - 145, mid));
          const lg = el("g", {}, g);
          sk.line(lg, [[mid, y + h + 8], [mid, y + h + 32], [labelX, y + h + 52]], 820 + i, { strokeWidth: 2.2 }).all(1);
          text(lg, labelX, y + h + 104, p.label, { size: vertical ? 42 : 52, weight: 1, anchor: "middle" });
          if (p.sub) text(lg, labelX, y + h + 155, p.sub, { size: vertical ? 30 : 36, color: C.gray, anchor: "middle" });
          add({ g: lg, t0, mode: "fade", em: false });
          x += pw;
        });
        return "corner";
      },
      // 金句：贴纸气泡（深色错位投影 + 连体尾巴指向芽仔），黄色大引号，逐字打出，每行打完扫一道荧光笔
      quote({ g, add, at, sc }) {
        const size = vertical ? 70 : 80, lh = size * 1.32;
        const w = vertical ? 900 : 1150, x = cx - w / 2;
        const f = find(sc.cue, lineOff[sc.line]);
        const on = f.t, off = Math.max(on + 0.1, v.lines[lineOfPos(f.pos)].end);
        const t0 = at("chip", `金句 ${sc.text}`, sc, 0.1);
        const tg = el("g", {}, g);
        const rows = wrap(tg, sc.text, size, w - 170);
        const padT = 118, padB = sc.by ? 112 : 72;
        const h = padT + (rows.length - 1) * lh + padB;
        const bottom = vertical ? 675 : 640, y = bottom - h, r = 34;
        // 尾巴从底边靠右处伸出，指向右下角的芽仔
        const tx0 = x + w - 270, tx1 = x + w - 170, tipX = vertical ? x + w - 80 : x + w + 50, tipY = bottom + (vertical ? 110 : 115); // 竖屏连投影都收在 y<800（右侧按钮栏以上）
        const d = `M${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${bottom - r} Q${x + w},${bottom} ${x + w - r},${bottom} ` +
          `L${tx1},${bottom} L${tipX},${tipY} L${tx0},${bottom} L${x + r},${bottom} Q${x},${bottom} ${x},${bottom - r} L${x},${y + r} Q${x},${y} ${x + r},${y} Z`;
        const bg = el("g", {}, g);
        g.insertBefore(bg, tg);
        el("path", { d, fill: C.ink, transform: "translate(9,11)" }, bg);
        el("path", { d, fill: C.card }, bg);
        sk.path(bg, d, 840, { strokeWidth: 4.4, roughness: 0.7 }).all(1);
        // 引号徽章：黄色圆压在框左上角
        el("circle", { cx: x + 46, cy: y + 4, r: 46, fill: C.yellow }, bg);
        sk.circle(bg, x + 46, y + 4, 92, 843, { strokeWidth: 3.6 }).all(1);
        text(bg, x + 46, y + 88, "“", { size: 130, font: "en", weight: 2, anchor: "middle" });
        add({ g: bg, t0, mode: "pop", cx: x + w / 2, cy: y + h / 2, em: false });
        const chars: SVGTSpanElement[] = [];
        const rowEnd: number[] = [];
        rows.forEach((row, i) => {
          const ry = y + padT + i * lh;
          const typed = typeText(tg, cx, ry, row, { size, anchor: "middle", weight: 1.7 });
          chars.push(...typed.chars);
          rowEnd.push(chars.length);
          const rw = (typed.chars[0]?.parentNode as SVGTextElement).getComputedTextLength();
          const hl = sk.line(g, [[cx - rw / 2 - 6, ry + 14], [cx + rw / 2 + 8, ry + 8]], 842 + i, { stroke: C.yellow, strokeWidth: size * 0.3, roughness: 0.6 });
          g.insertBefore(hl.g, tg);
          add({ g: hl.g, t0: on + ((off - on) * rowEnd[i]) / [...sc.text].filter((ch: string) => ch !== "\n").length, mode: "draw", sks: [hl], dur: 0.25, em: false });
        });
        add({ g: tg, t0: on, mode: "now", em: false, end: off, update: (t) => chars.forEach((ch, i) => setO(ch, t >= on + ((off - on) * i) / chars.length ? 1 : 0)) });
        if (sc.by) {
          const by = el("g", {}, g);
          text(by, x + w - 56, bottom - 40, `— ${sc.by}`, { size: vertical ? 40 : 46, font: "en", anchor: "end", color: "#5d5850" });
          add({ g: by, t0: off, mode: "fade", em: false });
        }
        faces.push({ face: "loading", on, off, talk: true });
        return "corner";
      },
      // 爆点：不规则手绘星形贴纸（长短不一的尖角、斜线填色、错位投影、略微倾斜），四周画出冲击线
      burst({ g, add, at, sc, si }) {
        const cy = vertical ? 420 : 440, r = vertical ? 250 : 270;
        const R = rng(860 + si), n = 14, pts: string[] = [];
        for (let i = 0; i < n * 2; i++) {
          const a = (i * Math.PI) / n - Math.PI / 2 + (R() - 0.5) * 0.09;
          const rr = i % 2 ? r * (0.7 + R() * 0.06) : r * (0.9 + R() * 0.16);
          pts.push(`${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)}`);
        }
        const d = `M${pts.join(" L")} Z`;
        const t0 = at("burst", `爆点 ${sc.text}`, sc);
        const bg = el("g", {}, g);
        el("path", { d, fill: C.ink, transform: "translate(10,12)" }, bg);
        el("path", { d, fill: "#ffe89a" }, bg);
        sk.path(bg, d, 861, { fill: C.yellow, fillStyle: "hachure", hachureGap: 9, fillWeight: 3.2, strokeWidth: 4.2, roughness: 1.1 }).all(1);
        // 先缩小字号放进一行（最多缩到 70%），仍放不下才换行
        const size0 = vertical ? 92 : 108, maxW = r * 1.45;
        const probe = text(bg, 0, 0, sc.text, { size: size0, weight: 3.2 });
        const size = Math.max(size0 * 0.7, Math.min(size0, (size0 * maxW) / probe.getComputedTextLength()));
        probe.remove();
        const rows = wrap(bg, sc.text, size, maxW);
        rows.forEach((row, i) => text(bg, cx, cy + size * 0.36 + (i - (rows.length - 1) / 2) * size * 1.15, row, { size, weight: 3.2, anchor: "middle" }));
        add({ g: bg, t0, mode: "slam", cx, cy, rot: -6, em: !!sc.em });
        // 冲击线：沿外圈放射，避开正下方（副标题）
        const lines: Sketch[] = [];
        const lg = el("g", {}, g);
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2 - Math.PI / 2 + 0.13;
          if (Math.abs(a - Math.PI / 2) < 0.5) continue;
          lines.push(sk.line(lg, [[cx + Math.cos(a) * r * 1.12, cy + Math.sin(a) * r * 1.12], [cx + Math.cos(a) * r * 1.32, cy + Math.sin(a) * r * 1.32]], 870 + k, { strokeWidth: 5, roughness: 0.6 }));
        }
        add({ g: lg, t0: t0 + 0.12, mode: "draw", sks: lines, dur: 0.18, em: false });
        cheers.push(t0);
        if (sc.sub) {
          const outer = el("g", {}, g);
          const cg = chip(outer, 0, 0, sc.sub, "#ffe89a", vertical ? 40 : 46);
          outer.setAttribute("transform", `translate(${cx - cg.w / 2},${cy + r + 40})`);
          add({ g: cg.g, t0: t0 + 0.4, mode: "pop", cx: cg.w / 2, cy: 31, em: false });
        }
        return "corner";
      },
      road(c) {
        const { g, add, at, sc, yzWay, S, S1, si } = c;
        const stops = sc.stops as { text: string; cue: string; em?: boolean }[];
        if (!stops || stops.length < 3 || stops.length > 6) throw new Error("road 需要 3–6 个站点");
        title(c, vertical ? 135 : 200);
        // 横屏终点内收，给站牌文字和角色身体留出 x≤1680 的余量。
        const points: [number, number][] = vertical ? [[120,760],[360,760],[700,300],[960,300]] : [[150,760],[580,760],[1180,380],[1600,380]];
        const d = `M${points[0]} C${points[1]} ${points[2]} ${points[3]}`;
        const rg = el("g", { "data-road": "1", "data-curve": JSON.stringify(points) }, g);
        // 同一曲线的上下边沿，中间虚线；只豁免道路自身，站牌和字仍检查。
        for (const offset of [-17,17]) {
          const edge = el("g", { transform: `translate(0,${offset})` }, rg);
          sk.path(edge, d, 930 + offset, { strokeWidth: 4.6, roughness: 0.6 }).all(1);
        }
        const dash = sk.path(rg, d, 932, { strokeWidth: 2.4, stroke: C.gray, roughness: 0.6 }).all(1);
        dash.strokes.forEach((p) => p.setAttribute("stroke-dasharray", "0.018 0.013"));
        add({ g: rg, t0: S, mode: "now", em: false });
        // 按弧长近似等距分站，再保存曲线参数供运行时插值。
        const samples = Array.from({ length: 201 }, (_, i) => pointOnRoad(points, i / 200));
        const lengths = [0];
        samples.slice(1).forEach((p, i) => lengths.push(lengths[i] + Math.hypot(p.x-samples[i].x,p.y-samples[i].y)));
        const params = stops.map((_, i) => {
          const target = lengths[200] * i / (stops.length-1);
          const j = Math.max(1, lengths.findIndex((n) => n >= target));
          return ((j-1) + (target-lengths[j-1]) / (lengths[j]-lengths[j-1])) / 200;
        });
        const times = stops.map((s, i) => at("chip", `路标 ${i+1} ${s.text}`, s));
        const positions = params.map((u) => ({ ...pointOnRoad(points,u), s: 0.32 }));
        yzWay.push({ t: S, pos: positions[0] });
        // 共用总览 cue 时分段走完；不同 cue 时尽量在口播时刻抵达。
        const gap = Math.min(0.65, (S1 - 0.35 - times[0]) / (stops.length-1));
        if (gap < 0.25) throw new Error("road 场景太短，请为每站至少预留 0.25 秒");
        let arrived = times[0];
        stops.forEach((stop, i) => {
          const {x,y} = positions[i];
          const sg = el("g", { "data-stop": i+1 }, g);
          const markerY = y + 48;
          sk.circle(sg, x, markerY, 52, 950+i, { fill: stopCol(i+1)[0], fillStyle: "solid", strokeWidth: 3.4 }).all(1);
          text(sg,x,markerY+12,String(i+1),{size:34,font:"en",anchor:"middle",weight:1});
          add({ g: sg, t0: times[i], mode: "pop", cx:x, cy:markerY, em:!!stop.em });
          const lg = el("g", {}, g), lx = vertical ? Math.max(150,Math.min(910,x)) : Math.max(180,Math.min(1535,x));
          text(lg,lx,y+104,stop.text,{size:vertical?32:40,anchor:"middle",weight:1});
          add({ g:lg,t0:times[i],mode:"fade",em:false });
          if (i) {
            const arrival = Math.max(times[i], arrived + gap);
            const duration = Math.min(gap, arrival-arrived);
            if (arrival >= S1 - 0.05) throw new Error(`road 站点「${stop.text}」越过本场，请使用本场 cue`);
            yzWay.push({ t: arrival-duration, pos: positions[i], road:{ points, from:params[i-1],to:params[i],duration } });
            events.push({kind:"yazai",label:`路线站点 ${i+1} ${stop.text}`,cue:stop.cue,voice:arrival,t:arrival});
            arrived=arrival;
          }
        });
        g.setAttribute("data-road-scene", String(si));
        return "corner";
      },
      versus(c) {
        const { g, add, from, sc, yzWay, S, S1 } = c;
        const sides = [sc.left,sc.right];
        if (sides.filter((s) => s?.yazai).length > 1) throw new Error("versus 只有一位芽仔，最多一侧写 yazai: true");
        sides.forEach((side,i) => {
          if (!side?.title || (!side.icon && !side.yazai)) throw new Error("versus 每侧需要 title，以及 icon 或 yazai: true");
          if ((side.points?.length ?? 0) > 2) throw new Error("versus 两画幅每侧最多 2 个要点");
          const x = vertical ? 540 : i ? 1270 : 490, y = vertical ? i ? 630 : 200 : 390;
          if (side.yazai) yzWay.push({t:S,pos:{x,y:y+80,s:0.45}});
          else {
            const ig = el("g", {}, g);
            icon(ig,side.icon,x,y,vertical?140:180,970+i*20);
            add({g:ig,t0:S,mode:"now",em:false});
          }
          const tg = el("g", {}, g);
          text(tg,x,y+(vertical?135:165),side.title,{size:vertical?48:64,anchor:"middle",weight:1.8});
          add({g:tg,t0:S,mode:"now",em:false});
          const list = (side.points ?? []) as {text:string;cue:string;em?:boolean}[];
          // 竖屏一行排最多两枚 chip，给中央 VS 和演员头部留足空隙。
          const chips = list.map((p) => ({p,cg:chip(g,0,0,p.text,stopCol(i+1)[1],vertical?32:40)}));
          const total = chips.reduce((sum,{cg})=>sum+cg.w,0) + 20*Math.max(0,chips.length-1);
          if (total > (vertical?880:660)) throw new Error("versus 要点太长，请缩短每侧文字");
          let left = x-total/2;
          chips.forEach(({p,cg})=>{
            const t0=from("chip",`对照 ${side.title} ${p.text}`,p);
            if(t0>=S1) throw new Error(`versus 要点「${p.text}」的 cue 不在本场`);
            const outer=el("g",{transform:`translate(${left},${y+(vertical?170:205)})`},g);outer.appendChild(cg.g);
            add({g:cg.g,t0,mode:"pop",cx:cg.w/2,cy:25,em:!!p.em});left+=cg.w+20;
          });
        });
        const vs=el("g",{},g);
        text(vs,vertical?230:880,vertical?485:485,"VS",{size:vertical?64:100,font:"en",anchor:"middle",weight:2.4,color:C.red});
        add({g:vs,t0:S,mode:"now",em:false});
        return "corner";
      },
      triad(c) {
        const {g,add,at,sc}=c;
        const nodes=sc.nodes as {icon:string;text:string;sub?:string;cue:string;em?:boolean}[];
        if(!nodes || nodes.length!==3) throw new Error("triad 必须恰好 3 个节点");
        const points: [number,number][] = vertical?[[540,160],[230,595],[850,595]]:[[900,230],[350,650],[1450,650]];
        const times=nodes.map((n)=>at("chip",`协作 ${n.text}`,n));
        nodes.forEach((n,i)=>{
          const [x,y]=points[i],ng=el("g",{},g);
          icon(ng,n.icon,x,y,vertical?100:120,1010+i*20);
          text(ng,x,y+(vertical?100:110),n.text,{size:vertical?48:56,anchor:"middle",weight:1.8});
          if(n.sub)text(ng,x,y+(vertical?143:158),n.sub,{size:vertical?30:36,anchor:"middle",color:C.gray});
          add({g:ng,t0:times[i],mode:"pop",cx:x,cy:y,em:!!n.em});
        });
        // 双向箭头走节点间留白，上方节点的标签也算入避让距离。
        for(const [a,b] of [[0,1],[0,2],[1,2]]) {
          const [ax,ay]=points[a],[bx,by]=points[b];
          const d=Math.hypot(bx-ax,by-ay),ux=(bx-ax)/d,uy=(by-ay)/d;
          const insetA=a===0?(vertical?185:210):120,insetB=vertical?95:130;
          const p0:[number,number]=[ax+ux*insetA,ay+uy*insetA],p1:[number,number]=[bx-ux*insetB,by-uy*insetB];
          const arrow=new Arrow(g,[p0,p1],1080+a*10+b,false),reverse=new Arrow(g,[p1,p0],1090+a*10+b,false);
          const t0=Math.max(times[a],times[b])-(LEAD.draw-LEAD.pop);
          add({g:arrow.g,t0,mode:"draw",sks:[arrow.shaft,arrow.head],dur:LEAD.draw,em:false});
          add({g:reverse.head.g,t0,mode:"draw",sks:[reverse.head],dur:LEAD.draw,em:false});
          reverse.shaft.g.remove();
        }
        const cy=vertical?455:490, outer=el("g",{},g);
        const center=chip(outer,0,0,sc.center, "#ffe89a",vertical?36:44);
        if(center.w>(vertical?740:930))throw new Error("triad center 太长，请缩短共同目标");
        outer.setAttribute("transform",`translate(${cx-center.w/2},${cy-30})`);
        add({g:center.g,t0:Math.max(...times)+0.3,mode:"pop",cx:center.w/2,cy:30,em:!!sc.em});
        return "corner";
      },
      // 流程链：节点依次点亮；芽仔站在当前节点上，说到下一步就一格一格跳过去
      flow(c) {
        const { g, add, at, sc, yzWay, S1 } = c;
        const steps = sc.steps as { text: string; cue: string; icon?: string; em?: boolean }[];
        if (steps.length < 3 || steps.length > 5) throw new Error("flow 需要 3–5 个节点");
        title(c, vertical ? 130 : 210);
        const points = steps.map((_, i): [number, number] => vertical
          ? (steps.length === 3 ? [230 + i * 310, 470] : i < 3 ? [230 + i * 310, 370] : [850 - (i - 3) * 310, 680])
          : [260 + (i * 1280) / (steps.length - 1), 520]);
        const times = steps.map((step, i) => at("chip", `步骤 ${i + 1} ${step.text}`, step));
        // 芽仔站位：第一格淡入，之后每格跳过去。节点同时出现时也依次跳：
        // 每格间隔 0.55s，本场剩余时间不够就压缩（最短 0.3s），跳跃时长跟着缩短
        const ys = vertical ? 0.28 : 0.34;
        const gap = Math.max(0.3, Math.min(0.55, (S1 - 0.4 - times[0]) / (steps.length - 1)));
        let hopT = -Infinity;
        steps.forEach((_, i) => {
          const tt = Math.max(times[i] + (i ? 0.05 : 0), hopT + gap);
          hopT = tt;
          yzWay.push({ t: tt, pos: { x: points[i][0], y: points[i][1] - 64, s: ys }, hop: i ? Math.min(0.45, gap - 0.05) : undefined });
        });
        steps.forEach((step, i) => {
          const [x, y] = points[i], t0 = times[i];
          if (i) {
            const [ax, ay] = points[i - 1], d = Math.hypot(x - ax, y - ay), ux = (x - ax) / d, uy = (y - ay) / d;
            const arrow = new Arrow(g, [[ax + ux * (vertical && uy ? 155 : 82), ay + uy * (vertical && uy ? 155 : 82)], [x - ux * 82, y - uy * 82]], 880 + i, false);
            add({ g: arrow.g, t0: t0 - (LEAD.draw - LEAD.pop), mode: "draw", sks: [arrow.shaft, arrow.head], dur: LEAD.draw, em: false });
          }
          const ng = el("g", {}, g);
          sk.circle(ng, x, y, 120, 890 + i, { fill: C.card, fillStyle: "solid", strokeWidth: 3.8 }).all(1);
          const hi = sk.circle(ng, x, y, 120, 895 + i, { fill: stopCol(i + 1)[0], fillStyle: "solid", strokeWidth: 3.8 }); hi.all(1);
          if (step.icon) icon(ng, step.icon, x, y, 66, 910 + i * 10);
          else text(ng, x, y + 22, String(i + 1), { size: 64, font: "en", weight: 2, anchor: "middle" });
          const tick = check(ng, x + 22, y - 66);
          text(ng, x, y + 110, step.text, { size: vertical ? 38 : 44, weight: 1, anchor: "middle" });
          add({ g: ng, t0, mode: "pop", cx: x, cy: y, em: !!step.em, update: (t) => {
            const passed = i < times.length - 1 && times[i + 1] > t0 && t >= times[i + 1];
            setO(hi.g, passed ? 0 : 1); setO(tick, passed ? 1 : 0);
          } });
        });
        return "corner";
      },
    };
  }

  function constrainEmphasis(g: SVGGElement, items: Item[]) {
    const box = (node: SVGGraphicsElement) => {
      const b = node.getBBox(), m = node.getCTM()!;
      const points = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].map(([x, y]) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }));
      return { x: Math.min(...points.map((p) => p.x)), y: Math.min(...points.map((p) => p.y)), r: Math.max(...points.map((p) => p.x)), b: Math.max(...points.map((p) => p.y)) };
    };
    const texts = [...g.querySelectorAll<SVGTextElement>("text")];
    for (const it of items.filter((it) => it.emNode)) {
      const node = it.emNode!, own = box(node);
      const cx = (own.x + own.r) / 2, cy = (own.y + own.b) / 2;
      const others = texts.filter((n) => n !== node).map(box);
      const expand = (k: number) => ({ x: cx + (own.x - cx) * k, y: cy + (own.y - cy) * k, r: cx + (own.r - cx) * k, b: cy + (own.b - cy) * k });
      const intersects = (a: ReturnType<typeof box>, b: ReturnType<typeof box>, gap = 6) => a.x < b.r + gap && a.r > b.x - gap && a.y < b.b + gap && a.b > b.y - gap;
      const safe = (k: number) => {
        const q = expand(k), FW = FMT === "3x4" ? 1080 : 1920, FH = FMT === "3x4" ? 1440 : 1080;
        if (q.x < 20 || q.r > FW - 20 || q.y < 20 || q.b > FH - 20 || others.some((b) => intersects(q, b))) return false;
        if (FMT === "3x4" && (q.b > V_SAFE.subTop || (q.r > V_SAFE.right && q.b > V_SAFE.rightFromY) || intersects(q, { x: 40, y: 880, r: 400, b: 1150 }, 0))) return false;
        if (FMT !== "3x4" && q.r > 1680) return false; // 横屏 x>1680 是芽仔专属区
        return true;
      };
      let peak = Math.max(1, Math.min(1.12, it.peak ?? 1.1));
      while (peak > 1 && !safe(peak)) peak = Math.max(1, +(peak - 0.01).toFixed(2));
      it.peak = peak;
      node.setAttribute("data-peak", String(peak));
      if (peak < 1.02) {
        it.peak = 1;
        const b = node.getBBox();
        const hl = el("rect", { x: b.x - 5, y: b.y + b.height * 0.52, width: b.width + 10, height: b.height * 0.48 + 5, rx: 5, fill: C.yellow, opacity: 0, "data-em-highlight": "1" });
        node.parentNode!.insertBefore(hl, node);
        it.highlight = hl;
        node.setAttribute("data-peak", "1");
      }
    }
  }

  function validateSemantic(sc: any) {
    const validCue = (v: any) => {
      if (!v || typeof v.cue !== "string" || !norm(v.cue)) throw new Error(`${sc.template} 元素缺少有效 cue`);
    };
    const labelled = (v: any) => {
      validCue(v);
      if (typeof v.text !== "string" || !v.text.trim()) throw new Error(`${sc.template} 元素需要非空 text`);
    };
    if (sc.template === "diagram") {
      if (!Array.isArray(sc.nodes) || sc.nodes.length < 2 || sc.nodes.length > 4) throw new Error("diagram 需要 2–4 个节点");
      if (!["chain", "loop"].includes(sc.variant)) throw new Error("diagram.variant 只能是 chain 或 loop");
      sc.nodes.forEach(labelled);
    }
    if (sc.template === "roles") {
      if (!Array.isArray(sc.roles) || sc.roles.length < 2 || sc.roles.length > 3) throw new Error("roles 需要 2–3 个角色");
      sc.roles.forEach(labelled);
      if (sc.result) labelled(sc.result);
      if (sc.relation && !["conflict", "cooperate"].includes(sc.relation)) throw new Error("roles.relation 只能是 conflict 或 cooperate");
    }
    if (sc.template === "allocation") {
      if (!Array.isArray(sc.parts) || sc.parts.length !== 2 || sc.parts.some((p: any) => !Number.isFinite(p.value) || p.value <= 0) || Math.abs(sc.parts.reduce((n: number, p: any) => n + p.value, 0) - 100) > 0.001) throw new Error("allocation 需要两个正数百分比，合计 100");
      sc.parts.forEach(labelled);
    }
    if (["diagram", "roles", "allocation"].includes(sc.template) && sc.title) labelled(sc.title);
  }

  function semanticGroup(g: SVGGElement) {
    return el("g", FMT === "3x4" ? {} : { transform: "translate(360,-30)" }, g);
  }
  function checkedText(g: Element, x: number, y: number, str: string, size: number, width: number, color = C.ink) {
    const tt = text(g, x, y, str, { size, font: "zh", weight: size / 32, color, anchor: "middle" });
    if (tt.getComputedTextLength() > width) throw new Error(`标签「${str}」过长：需要缩短文字（可用 ${width}px）`);
    return tt;
  }
  function semanticTitle(c: Ctx, g: SVGGElement) {
    if (!c.sc.title) return;
    const tg = el("g", {}, g);
    checkedText(tg, 540, 150, c.sc.title.text, 60, 940);
    c.add({ g: tg, t0: c.from("title", c.sc.title.text, c.sc.title), mode: "fade" });
  }
  function symbol(g: Element, x: number, y: number, icon: string, col: string, seed: number) {
    const rg = el("g", {}, g);
    const line = (p: [number, number][], s: number) => sk.line(rg, p.map(([a, b]) => [x + a, y + b] as [number, number]), seed + s, { strokeWidth: 4 }).all(1);
    const disk = () => sk.circle(rg, x, y, 110, seed, { fill: col, fillStyle: "solid", strokeWidth: 3.5 }).all(1);
    switch (icon) {
      case "paper":
        for (let i = 2; i >= 0; i--) { el("path", { d: rrectPath(x - 44 + i * 10, y - 57 - i * 6, 90, 110, 6), fill: i ? col : C.card }, rg); sk.rrect(rg, x - 44 + i * 10, y - 57 - i * 6, 90, 110, 6, seed + i, { strokeWidth: 3.5 }).all(1); }
        for (let i = 0; i < 3; i++) line([[-25, -22 + i * 22], [26, -22 + i * 22]], 4 + i);
        break;
      case "person":
        sk.circle(rg, x, y - 28, 46, seed, { fill: col, fillStyle: "solid", strokeWidth: 4 }).all(1);
        sk.path(rg, `M${x - 47},${y + 47} Q${x - 44},${y} ${x},${y} Q${x + 44},${y} ${x + 47},${y + 47}`, seed + 1, { strokeWidth: 4, fill: col, fillStyle: "solid" }).all(1);
        break;
      case "clock": disk(); sk.circle(rg, x, y, 76, seed + 1, { strokeWidth: 3 }).all(1); line([[0, -28], [0, 0], [23, 13]], 2); break;
      case "target": disk(); for (let i = 0; i < 2; i++) sk.circle(rg, x, y, 74 - i * 36, seed + i + 1, { strokeWidth: 3 }).all(1); line([[5, -5], [53, -50]], 3); break;
      case "shield": sk.path(rg, `M${x},${y - 55} L${x + 48},${y - 30} Q${x + 44},${y + 35} ${x},${y + 58} Q${x - 44},${y + 35} ${x - 48},${y - 30} Z`, seed, { fill: col, fillStyle: "solid", strokeWidth: 4 }).all(1); line([[-20, 0], [-4, 16], [25, -20]], 1); break;
      case "window": sk.rrect(rg, x - 53, y - 50, 106, 100, 3, seed, { fill: col, fillStyle: "solid", strokeWidth: 4 }).all(1); line([[-53, 0], [53, 0]], 1); line([[0, -50], [0, 50]], 2); break;
      case "light": disk(); sk.circle(rg, x, y - 12, 52, seed + 1, { strokeWidth: 3.5 }).all(1); line([[-15, 19], [-15, 33], [15, 33], [15, 19]], 2); line([[-14, 45], [14, 45]], 3); for (let i = 0; i < 3; i++) { const a = (i - 1) * 0.8 - Math.PI / 2; line([[Math.cos(a) * 42, Math.sin(a) * 42 - 12], [Math.cos(a) * 61, Math.sin(a) * 61 - 12]], 4 + i); } break;
      case "flywheel": disk(); sk.circle(rg, x, y, 80, seed + 1, { strokeWidth: 4 }).all(1); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; line([[0, 0], [Math.cos(a) * 36, Math.sin(a) * 36]], i + 2); } break;
      case "gift": sk.rrect(rg, x - 48, y - 29, 96, 78, 4, seed, { fill: col, fillStyle: "solid", strokeWidth: 4 }).all(1); line([[-54, -27], [54, -27]], 1); line([[0, -27], [0, 49]], 2); sk.path(rg, `M${x},${y - 28} C${x - 80},${y - 20} ${x - 25},${y - 88} ${x},${y - 28} C${x + 80},${y - 20} ${x + 25},${y - 88} ${x},${y - 28}`, seed + 3, { strokeWidth: 4 }).all(1); break;
      case "tool": disk(); line([[-27, 27], [27, -27]], 1); line([[13, -38], [27, -27], [38, -13]], 2); break;
      default: throw new Error(`不支持的图元「${icon}」`);
    }
    return rg;
  }
  function connector(g: Element, a: [number, number], b: [number, number], seed: number, col = C.ink) {
    const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy), ux = dx / d, uy = dy / d;
    const start: [number, number] = [a[0] + ux * 84, a[1] + uy * 84], end: [number, number] = [b[0] - ux * 88, b[1] - uy * 88];
    const cg = el("g", {}, g);
    const tail = sk.line(cg, [start, end], seed, { strokeWidth: 4, stroke: col });
    const head = sk.line(cg, [[end[0] - ux * 18 - uy * 12, end[1] - uy * 18 + ux * 12], end, [end[0] - ux * 18 + uy * 12, end[1] - uy * 18 - ux * 12]], seed + 1, { strokeWidth: 4, stroke: col });
    return { g: cg, sks: [tail, head] };
  }
  function diagram(c: Ctx): SpotKey {
    const { sc, add, from, si } = c, g = semanticGroup(c.g);
    semanticTitle(c, g);
    const n = sc.nodes.length, loop = sc.variant === "loop";
    const positions: [number, number][] = loop
      ? n === 4 ? [[540, 285], [825, 495], [540, 730], [255, 495]] : ([[540, 285], [820, 630], [260, 630]] as [number, number][]).slice(0, n)
      : n === 2 ? [[270, 425], [810, 425]] : n === 3 ? [[240, 285], [540, 460], [780, 635]] : [[230, 320], [810, 320], [230, 650], [810, 650]];
    const times = sc.nodes.map((node: any) => from("node", node.text, node));
    // 连线先放在后方，节点出现时连接关系只画一次。
    for (let i = 1; i < n + (loop ? 1 : 0); i++) {
      const j = i % n, ar = connector(g, positions[i - 1], positions[j], 900 + si * 20 + i * 2, loop ? C.green : C.ink);
      add({ g: ar.g, t0: times[j === 0 ? n - 1 : j], mode: "draw", sks: ar.sks, dur: 0.28, em: false });
    }
    sc.nodes.forEach((node: any, i: number) => {
      const [x, y] = positions[i], ng = el("g", {}, g);
      symbol(ng, x, y, node.icon ?? "paper", stopCol(i + 1)[1], 1200 + si * 30 + i * 8);
      const tg = el("g", {}, ng);
      checkedText(tg, x, y + 115, node.text, n === 2 ? 56 : 44, n === 2 ? 420 : 270, node.color ?? C.ink);
      if (node.sub) checkedText(ng, x, y + 182, node.sub, 30, n === 2 ? 420 : 270, C.gray);
      add({ g: ng, t0: times[i], mode: "fade", kind: "node", em: !!node.em, peak: node.peak });
    });
    return "corner";
  }
  function roles(c: Ctx): SpotKey {
    const { sc, add, from, si } = c, g = semanticGroup(c.g), n = sc.roles.length;
    semanticTitle(c, g);
    const xs = n === 2 ? [280, 800] : [230, 540, 850];
    const times = sc.roles.map((role: any) => role.now ? c.S + 0.05 : from("role", role.text, role));
    sc.roles.forEach((role: any, i: number) => {
      const rg = el("g", {}, g), x = xs[i];
      symbol(rg, x, 320, role.icon ?? "person", stopCol(i + 1)[1], 1700 + si * 30 + i * 8);
      checkedText(rg, x, 420, role.text, n === 2 ? 54 : 44, n === 2 ? 450 : 280);
      if (role.sub) checkedText(rg, x, 478, role.sub, n === 2 ? 38 : 32, n === 2 ? 450 : 280, C.gray);
      add({ g: rg, t0: times[i], mode: "fade", kind: "role", em: !!role.em, peak: role.peak });
    });
    if (sc.result) {
      const atResult = from("result", sc.result.text, sc.result);
      const wire = el("g", {}, g), lines: Sketch[] = [];
      for (let i = 0; i < n; i++) lines.push(sk.line(wire, [[xs[i], 520], [xs[i], 570], [540, 600]], 1800 + si * 10 + i, { strokeWidth: 3.5, stroke: sc.relation === "conflict" ? C.red : C.green }));
      add({ g: wire, t0: atResult, mode: "draw", sks: lines, dur: 0.3, em: false });
      const rg = el("g", {}, g);
      checkedText(rg, 540, 720, sc.result.text, 74, 940, sc.relation === "conflict" ? C.red : C.ink);
      if (sc.result.sub) checkedText(rg, 540, 795, sc.result.sub, 36, 850, C.gray);
      add({ g: rg, t0: atResult, mode: "fade", kind: "result", em: !!sc.result.em, peak: sc.result.peak });
    } else if (sc.relation === "conflict") {
      const clash = el("g", {}, g);
      const ar = sk.line(clash, [[355, 560], [470, 560], [495, 538], [520, 582], [545, 538], [570, 560], [725, 560]], 1850 + si, { stroke: C.red, strokeWidth: 5 });
      add({ g: clash, t0: Math.max(...times), mode: "draw", sks: [ar], dur: 0.25, em: false });
    }
    return "corner";
  }
  function allocation(c: Ctx): SpotKey {
    const { sc, add, from, si } = c, g = semanticGroup(c.g);
    semanticTitle(c, g);
    const x = 100, y = 330, w = 880, h = 300;
    let offset = 0;
    sc.parts.forEach((part: any, i: number) => {
      const pg = el("g", { "data-allocation": part.value }, g), pw = w * part.value / 100;
      el("rect", { x: x + offset, y, width: pw, height: h, fill: stopCol(i + 1)[1], "data-share": part.value }, pg);
      const size = Math.min(140, pw * 0.55);
      text(pg, x + offset + pw / 2, y + 190, `${part.value}%`, { size, font: "en", weight: 2.6, anchor: "middle" });
      const ly = 723 + i * 77;
      el("rect", { x: 120, y: ly - 32, width: 34, height: 34, fill: stopCol(i + 1)[1] }, pg);
      checkedText(pg, 520, ly, `${part.value}% ${part.text}`, 40, 720);
      const t0 = from("allocation", part.text, part);
      add({ g: pg, t0, mode: "fade", kind: "allocation", em: !!part.em, peak: part.peak });
      offset += pw;
    });
    const outline = sk.rrect(g, x, y, w, h, 0, 2000 + si, { strokeWidth: 4 });
    add({ g: outline.g, t0: c.S + 0.05, mode: "draw", sks: [outline], dur: 0.2, em: false });
    const divider = sk.line(g, [[x + w * sc.parts[0].value / 100, y], [x + w * sc.parts[0].value / 100, y + h]], 2001 + si, { strokeWidth: 3.5 });
    add({ g: divider.g, t0: c.S + 0.05, mode: "draw", sks: [divider], dur: 0.2, em: false });
    return "corner";
  }

  const templates: Record<string, (c: Ctx) => SpotKey> = {
    ...spokenTemplates(false),
    hero({ g, add, at, sc }) {
      if (sc.mark) add({ g: mark(g, 880, 380, sc.mark.text, { size: 150, font: "en", color: C.red, weight: 3 }), t0: at("mark", `记号 ${sc.mark.text}`, sc.mark), mode: "pop", cx: 930, cy: 330, rot: 12 });
      if (sc.title) {
        const tg = el("g", {}, g);
        const tt = text(tg, 1060, 470, sc.title.text, { size: 200, font: "en", weight: 3.2 });
        // 长英文标题缩小字号，右端不越过 x=1860
        if (tt.getComputedTextLength() > 800) tt.setAttribute("font-size", String(Math.floor((200 * 800) / tt.getComputedTextLength())));
        const w = tt.getComputedTextLength();
        const hl = sk.line(tg, [[1050, 492], [1060 + w, 486]], 11, { stroke: C.yellow, strokeWidth: 26, roughness: 0.6 });
        tg.insertBefore(hl.g, tt);
        const t0 = at("title", `标题 ${sc.title.text}`, sc.title);
        add({ g: tg, t0, mode: "pop", cx: 1060 + w / 2, cy: 400, em: !!sc.title.em });
        add({ g: hl.g, t0: t0 + 0.15, mode: "draw", sks: [hl], dur: 0.25 });
      }
      (sc.chips ?? []).forEach((c: Cued, i: number) => {
        const cg = chip(g, 1066, 560 + i * 92, c.text, i === 0 ? "#ffe89a" : "#b6ecd6");
        add({ g: cg.g, t0: at("chip", `标签 ${c.text}`, c), mode: "pop", cx: 1066 + cg.w / 2, cy: 560 + i * 92 + 34 });
      });
      return "hero";
    },

    // 结果式大标题：开场即出（不等口播），竖屏预览里也能一眼看清；芽仔大尺寸站右侧
    headline({ g, add, from, sc, S }) {
      let y = sc.top ?? 330;
      (sc.lines as { text: string; size: number; font?: "zh" | "en"; hl?: string; color?: string }[]).forEach((l, i) => {
        const tg = el("g", {}, g);
        const tt = text(tg, 120, y, l.text, { size: l.size, font: l.font ?? "zh", weight: l.size / 38, color: l.color });
        const w = tt.getComputedTextLength();
        const t0 = S + 0.05 + i * 0.14;
        if (l.hl) {
          const hl = sk.line(tg, [[110, y + 14], [130 + w, y + 6]], 610 + i, { stroke: l.hl, strokeWidth: l.size * 0.3, roughness: 0.6 });
          tg.insertBefore(hl.g, tt);
          add({ g: hl.g, t0: t0 + 0.2, mode: "draw", sks: [hl], dur: 0.25, kind: "" });
        }
        add({ g: tg, t0, mode: "pop", cx: 120 + w / 2, cy: y - l.size * 0.35, kind: "" });
        y += l.size * 1.3;
      });
      if (sc.chip) {
        const cg = chip(g, 124, y - 40, sc.chip.text, "#ffe89a", 46);
        add({ g: cg.g, t0: from("chip", `标签 ${sc.chip.text}`, sc.chip), mode: "pop", cx: 124 + cg.w / 2, cy: y - 4, kind: "" });
      }
      return "headline";
    },

    // 效果展示：成品截图做成照片卡，2×2 或 3×2，按 cue 逐张弹出
    showcase({ g, flat, add, at, from, sc }) {
      const shots = sc.shots as { src: string; cue: string }[];
      const L4 = [[600, 350, -5], [1290, 340, 4], [620, 660, 3], [1300, 670, -3]];
      const L6 = [[380, 350, -4], [900, 340, 3], [1420, 355, -2], [390, 665, 3], [905, 670, -3], [1420, 665, 4]];
      const L = shots.length > 4 ? L6 : L4;
      const w = shots.length > 4 ? 470 : 560;
      shots.forEach((sh, i) => {
        const [cx, cy, rot] = L[i];
        add({ g: photo(flat, cx, cy, w, base + sh.src, rot, 300 + i), t0: at("shot", `截图 ${sh.src.split("/").pop()}`, sh), mode: "pop", cx, cy });
      });
      if (sc.label) {
        const outer = el("g", {}, g);
        const cg = chip(outer, 0, 0, sc.label.text, "#ffe89a", 44);
        outer.setAttribute("transform", `translate(${960 - cg.w / 2},${sc.labelY ?? 34})`);
        add({ g: cg.g, t0: from("chip", `标签 ${sc.label.text}`, sc.label), mode: "pop", cx: cg.w / 2, cy: 34 });
      }
      if (sc.mark) add({ g: mark(g, 1600, 700, sc.mark.text, { size: 110, font: "en", color: C.red, weight: 3 }), t0: from("mark", `记号 ${sc.mark.text}`, sc.mark), mode: "pop", cx: 1640, cy: 660, rot: 12 });
      return "corner";
    },

    prompt({ g, add, at, from, sc }) {
      if (sc.doc) {
        const dg = el("g", {}, g);
        const d = "M170,300 L420,300 L470,350 L470,690 L170,690 Z";
        el("path", { d, fill: C.card }, dg);
        sk.path(dg, d, 31, { strokeWidth: 4.2 }).all(1);
        sk.line(dg, [[420, 300], [420, 350], [470, 350]], 32, { strokeWidth: 3.4 }).all(1);
        for (let k = 0; k < 5; k++) sk.line(dg, [[205, 470 + k * 42], [430 - (k % 2) * 60, 470 + k * 42]], 40 + k, { strokeWidth: 3, stroke: C.gray }).all(1);
        text(dg, 320, 420, sc.doc.title, { size: 64, font: "zh", weight: 2, anchor: "middle" });
        text(dg, 320, 752, sc.doc.sub, { size: 36, font: "zh", color: C.gray, anchor: "middle" });
        add({ g: dg, t0: at("doc", `文档 ${sc.doc.title}`, sc.doc), mode: "pop", cx: 320, cy: 500 });
      }
      const bx = 620, by = 290, bw = 960, bh = 480;
      const bg = el("g", {}, g);
      const bd = `M${bx + 26},${by} L${bx + bw - 26},${by} Q${bx + bw},${by} ${bx + bw},${by + 26} L${bx + bw},${by + bh - 26} Q${bx + bw},${by + bh} ${bx + bw - 26},${by + bh} L${bx + 26},${by + bh} Q${bx},${by + bh} ${bx},${by + bh - 26} L${bx},${by + 250} L${bx - 90},${by + 300} L${bx},${by + 190} L${bx},${by + 26} Q${bx},${by} ${bx + 26},${by} Z`;
      el("path", { d: bd, fill: C.card }, bg);
      sk.path(bg, bd, 51, { strokeWidth: 4.4, roughness: 0.8 }).all(1);
      const labelT = sc.label ? at("bubble", `气泡 ${sc.label.text}`, sc.label) : Infinity;
      const firstT = sc.bullets?.length ? Math.max(0, fr(find(sc.bullets[0].cue, lineOff[sc.line]).t - LEAD.pop)) : Infinity;
      // 标签很早时 min 仍会留空框；有要点就限为最多提前 0.1 秒，满足空白 ≤0.3 秒。
      const frameT = Number.isFinite(firstT) ? Math.max(Math.min(labelT, firstT) - 0.1, firstT - 0.1) : Number.isFinite(labelT) ? labelT : 0;
      const bubbleEvent = [...events].reverse().find((e) => e.kind === "bubble" && e.cue === sc.label?.cue);
      if (bubbleEvent) bubbleEvent.t = fr(frameT);
      add({ g: bg, t0: frameT, mode: "pop", cx: bx + bw / 2, cy: by + bh / 2 });
      if (sc.label) {
        const lg = chip(g, bx + 30, by - 40, sc.label.text, "#ffe89a");
        add({ g: lg.g, t0: frameT, mode: "pop", cx: bx + 30 + lg.w / 2, cy: by - 6 });
      }
      (sc.bullets ?? []).forEach((b: Cued, i: number) => {
        const rg = el("g", {}, g);
        const y = by + 120 + i * 96;
        sk.circle(rg, bx + 80, y - 16, 56, 60 + i, { fill: PALETTE[(i % 5) + 1][1], fillStyle: "solid", strokeWidth: 3.4 }).all(1);
        text(rg, bx + 80, y - 2, String(i + 1), { size: 40, font: "en", weight: 1.4, anchor: "middle" });
        text(rg, bx + 130, y, b.text, { size: 50, font: "zh", weight: 1.6 });
        add({ g: rg, t0: at("bullet", `要点 ${b.text}`, b), mode: "pop", cx: bx + 80, cy: y - 16 });
      });
      return "corner";
    },

    stats({ g, add, at, sc }) {
      const n = sc.cards.length;
      const w = n === 3 ? 400 : 470;
      const gap = 70;
      const x0 = 960 - (n * w + (n - 1) * gap) / 2;
      sc.cards.forEach((c: any, i: number) => {
        const x = x0 + i * (w + gap);
        const cg = statCard(g, x, 330, w, 340, c.num, c.unit, c.label, PALETTE[i + 1][0], 70 + i * 5);
        add({ g: cg, t0: at("card", `数字 ${c.num}${c.unit}`, c), mode: "pop", cx: x + w / 2, cy: 500, em: !!c.em });
      });
      if (sc.stamp) add({ g: stamp(g, 1500, 300, sc.stamp.text, C.green), t0: at("stamp", `印章 ${sc.stamp.text}`, sc.stamp), mode: "slam", cx: 1500, cy: 300, rot: -12 });
      return "corner";
    },

    chapter({ g, flat, add, at, from, sc }) {
      const [col, light] = stopCol(sc.stop);
      const top = 330;
      const shots = (sc.shots ?? []) as { src: string; cue: string }[];
      const hasShot = shots.length > 0;
      if (sc.pages?.shots) {
        // 真实页面叠在一起，逐页打勾
        const ps = sc.pages.shots as string[];
        const t0 = at("page", `页面 ${sc.pages.count}`, sc.pages);
        ps.forEach((src, k) => {
          const cx = 380 + k * 34, cy = 520 + k * 34, rot = [-5, 2, 6][k % 3];
          add({ g: photo(flat, cx, cy, 480, base + src, rot, 320 + k), t0: t0 + k * 0.12, mode: "pop", cx, cy });
        });
        const lg = el("g", {}, g);
        text(lg, 430, 850, sc.pages.count, { size: 60, font: "zh", weight: 2.2, anchor: "middle" });
        add({ g: lg, t0: t0 + 0.2, mode: "pop", cx: 430, cy: 830 });
        for (let k = 0; k < 4; k++) add({ g: check(g, 680, 370 + k * 95), t0: t0 + 0.4 + k * 0.28, mode: "pop", cx: 700, cy: 390 + k * 95 });
      } else if (sc.pages) {
        const pg = el("g", {}, g);
        for (let k = 2; k >= 0; k--) {
          const x = 190 + k * 26, y = 300 + k * 22;
          el("path", { d: rrectPath(x, y, 330, 420, 10), fill: C.card }, pg);
          sk.rrect(pg, x, y, 330, 420, 10, 90 + k, { strokeWidth: 3.8 }).all(1);
        }
        for (let k = 0; k < 6; k++) sk.line(pg, [[290, 420 + k * 50], [520 - (k % 3) * 40, 420 + k * 50]], 95 + k, { strokeWidth: 3, stroke: C.gray }).all(1);
        text(pg, 395, 800, sc.pages.count, { size: 64, font: "zh", weight: 2.2, anchor: "middle" });
        const t0 = at("page", `页面 ${sc.pages.count}`, sc.pages);
        add({ g: pg, t0, mode: "pop", cx: 395, cy: 530 });
        for (let k = 0; k < 4; k++) add({ g: check(g, 560 - 10, 360 + k * 95), t0: t0 + 0.3 + k * 0.28, mode: "pop", cx: 560, cy: 370 + k * 95 });
      }
      if (sc.search) {
        const x = hasShot ? 150 : sc.pages ? 700 : 300, w = hasShot ? 660 : 1000;
        const sgp = el("g", {}, g);
        el("path", { d: rrectPath(x, top, w, 96, 48), fill: "#fff" }, sgp);
        sk.rrect(sgp, x, top, w, 96, 48, 110, { strokeWidth: 4.4 }).all(1);
        sk.circle(sgp, x + 58, top + 44, 36, 111, { strokeWidth: 4 }).all(1);
        sk.line(sgp, [[x + 72, top + 58], [x + 90, top + 76]], 112, { strokeWidth: 5 }).all(1);
        text(sgp, x + 110, top + 64, sc.search.query, { size: 50, font: "zh", weight: 1.4 });
        add({ g: sgp, t0: at("search", `搜索 ${sc.search.query}`, sc.search), mode: "pop", cx: x + w / 2, cy: top + 48 });
      }
      if (sc.cards && hasShot) {
        // 有截图时卡片竖排在左侧
        sc.cards.forEach((c: any, i: number) => {
          const y = top + 10 + i * 150;
          const cg = el("g", {}, g);
          el("path", { d: rrectPath(150, y, 600, 124, 16), fill: light }, cg);
          sk.rrect(cg, 150, y, 600, 124, 16, 125 + i, { strokeWidth: 4 }).all(1);
          text(cg, 190, y + 78, c.title, { size: 54, font: "zh", weight: 2.2 });
          text(cg, 720, y + 76, c.sub, { size: 34, font: "zh", color: "#5d5850", anchor: "end" });
          add({ g: cg, t0: at("card", `卡片 ${c.title}`, c), mode: "pop", cx: 450, cy: y + 62 });
        });
      } else if (sc.cards) {
        const n = sc.cards.length;
        const w = n === 3 ? 400 : 470, gap = n === 3 ? 60 : 160;
        const x0 = 880 - (n * w + (n - 1) * gap) / 2;
        sc.cards.forEach((c: any, i: number) => {
          const x = x0 + i * (w + gap);
          const cg = infoCard(g, x, top + 20, w, 300, c.title, c.sub, light, 120 + i * 4);
          const t0 = at("card", `卡片 ${c.title}`, c);
          add({ g: cg, t0, mode: "pop", cx: x + w / 2, cy: top + 170 });
          if (n === 2 && i === 1) {
            const ar = sk.line(g, [[x - gap + 20, top + 170], [x - 24, top + 170]], 130, { strokeWidth: 4 });
            const hd = sk.line(g, [[x - 44, top + 154], [x - 24, top + 170], [x - 44, top + 186]], 131, { strokeWidth: 4, roughness: 0.4 });
            add({ g: ar.g, t0: t0 - 0.1, mode: "draw", sks: [ar], dur: 0.1 });
            add({ g: hd.g, t0: t0, mode: "draw", sks: [hd], dur: 0.06 });
          }
        });
      }
      if (sc.chips) {
        let x = 150, y = sc.search ? top + 150 : top;
        sc.chips.forEach((c: Cued, i: number) => {
          const cg = chip(g, x, y, c.text, light, 46);
          if (x + cg.w > (hasShot ? 880 : 1500)) {
            x = 150;
            y += 100;
            setT(cg.g, 0, 0, 1);
            cg.g.remove();
            const c2 = chip(g, x, y, c.text, light, 46);
            add({ g: c2.g, t0: at("chip", `标签 ${c.text}`, c), mode: "pop", cx: x + c2.w / 2, cy: y + 36 });
            x += c2.w + 26;
            return;
          }
          add({ g: cg.g, t0: at("chip", `标签 ${c.text}`, c), mode: "pop", cx: x + cg.w / 2, cy: y + 36 });
          x += cg.w + 26;
          void i;
        });
      }
      if (sc.issues) {
        sc.issues.forEach((c: Cued, i: number) => {
          const cg = chip(g, 760, 360 + i * 110, "⚠ " + c.text, "#ffc2cf", 46);
          add({ g: cg.g, t0: at("issue", `问题 ${c.text}`, c), mode: "pop", cx: 760 + cg.w / 2, cy: 396 + i * 110 });
        });
      }
      if (sc.stat) {
        const x = sc.chips || hasShot ? 150 : 560, y = sc.chips ? (hasShot ? 760 : 700) : 690;
        const sg = el("g", {}, g);
        const nt = text(sg, x, y, sc.stat.num, { size: 190, font: "en", weight: 3.4, color: col === C.yellow ? C.ink : C.ink });
        const w = nt.getComputedTextLength();
        text(sg, x + w + 24, y - 10, sc.stat.unit, { size: 64, font: "zh", weight: 2 });
        const ul = sk.line(sg, [[x - 6, y + 22], [x + w + 30 + 64 * [...sc.stat.unit].length, y + 16]], 140, { stroke: col, strokeWidth: 16, roughness: 0.6 });
        sg.insertBefore(ul.g, nt);
        const t0 = at("stat", `数字 ${sc.stat.num}${sc.stat.unit}`, sc.stat);
        add({ g: sg, t0, mode: "pop", cx: x + w / 2, cy: y - 70 });
        add({ g: ul.g, t0: t0 + 0.15, mode: "draw", sks: [ul], dur: 0.25 });
      }
      if (sc.stamp) add({ g: stamp(g, 1180, 690, sc.stamp.text, C.green), t0: at("stamp", `印章 ${sc.stamp.text}`, sc.stamp), mode: "slam", cx: 1180, cy: 690, rot: -10 });
      // 右侧截图：第二张叠在第一张上
      shots.forEach((sh, i) => {
        const cx = 1245 + i * 50, cy = 560 + i * 60, rot = i % 2 ? 4 : -3;
        add({ g: photo(flat, cx, cy, 680, base + sh.src, rot, 340 + i), t0: from("shot", `截图 ${sh.src.split("/").pop()}`, sh), mode: "pop", cx, cy });
      });
      return "corner";
    },

    compare({ g, add, at, sc }) {
      const L = sc.left, R = sc.right;
      text(g, 230, 360, L.title, { size: 64, font: "zh", weight: 2.2 });
      add({ g: g.lastChild as SVGGElement, t0: 0, mode: "now" });
      const divider = sk.line(g, [[960, 300], [960, 840]], 150, { strokeWidth: 3, stroke: C.gray, strokeLineDash: [14, 12] } as any);
      add({ g: divider.g, t0: 0, mode: "now" });
      (L.steps ?? []).forEach((c: Cued, i: number) => {
        const x = 230 + (i % 2) * 300, y = 420 + Math.floor(i / 2) * 100;
        const cg = chip(g, x, y, c.text, "#ffe89a", 44);
        add({ g: cg.g, t0: at("chip", `步骤 ${c.text}`, c), mode: "pop", cx: x + cg.w / 2, cy: y + 34 });
      });
      const lr = el("g", {}, g);
      text(lr, 230, 760, L.result.text, { size: 120, font: "zh", weight: 3.2, color: C.red });
      add({ g: lr, t0: at("stat", `结果 ${L.result.text}`, L.result), mode: "pop", cx: 400, cy: 710 });
      const rt = el("g", {}, g);
      text(rt, 1080, 360, R.title, { size: 84, font: "en", weight: 2.6 });
      add({ g: rt, t0: 0, mode: "now" });
      // 右侧结果：超宽时缩小字号，不越过 x=1640（右下角留给芽仔）；缩放中心取文字实际中心
      const rr = el("g", {}, g), rin = el("g", {}, rr); // 缩小写在内层，外层留给弹出动画
      const rtx = text(rin, 1080, 760, R.result.text, { size: 140, font: "en", weight: 3.4, color: C.green });
      const rw = rtx.getComputedTextLength(), rk = Math.min(1, 500 / rw);
      if (rk < 1) rin.setAttribute("transform", `translate(1080,760) scale(${rk.toFixed(3)}) translate(-1080,-760)`);
      add({ g: rr, t0: at("stat", `结果 ${R.result.text}`, R.result) + 0.35, mode: "pop", cx: 1080 + (rw * rk) / 2, cy: 760 - 50 * rk });
      return "corner";
    },

    verdict({ g, add, at, sc }) {
      const og = el("g", {}, g);
      const ot = text(og, 960, 400, sc.old.text, { size: 72, font: "zh", weight: 1.6, color: C.gray, anchor: "middle" });
      const ow = ot.getComputedTextLength();
      add({ g: og, t0: at("chip", `旧说法 ${sc.old.text}`, sc.old), mode: "pop", cx: 960, cy: 375 });
      const st = sk.line(g, [[960 - ow / 2 - 20, 382], [960 + ow / 2 + 20, 368]], 160, { stroke: C.red, strokeWidth: 9, roughness: 0.5 });
      add({ g: st.g, t0: at("strike", "划掉旧说法", { cue: sc.old.strike }), mode: "draw", sks: [st], dur: 0.12 });
      const ng = el("g", {}, g);
      const nt = text(ng, 960, 600, sc.new.text, { size: 110, font: "zh", weight: 3.4, anchor: "middle" });
      const nw = nt.getComputedTextLength();
      const hl = sk.line(ng, [[960 - nw / 2, 620], [960 + nw / 2, 614]], 161, { stroke: C.yellow, strokeWidth: 30, roughness: 0.6 });
      ng.insertBefore(hl.g, nt);
      const t0 = at("title", `新说法 ${sc.new.text}`, sc.new);
      add({ g: ng, t0, mode: "pop", cx: 960, cy: 560, em: !!sc.new.em });
      add({ g: hl.g, t0: t0 + 0.15, mode: "draw", sks: [hl], dur: 0.25 });
      if (sc.stamp) add({ g: stamp(g, 1330, 740, sc.stamp.text, C.green), t0: at("stamp", `印章 ${sc.stamp.text}`, sc.stamp), mode: "slam", cx: 1330, cy: 740, rot: -9 });
      if (sc.chip) {
        const cg = chip(g, 330, 740, "💬 " + sc.chip.text, "#ddd3ff", 42);
        add({ g: cg.g, t0: at("chip", `标签 ${sc.chip.text}`, sc.chip), mode: "pop", cx: 330 + cg.w / 2, cy: 774 });
      }
      return "corner";
    },

    ending({ g, add, at, sc }) {
      const word = new PixelWord(g, sc.word ?? "JACKY", 378, 368, 30, 700);
      const f = at("blocks", "像素字标", { cue: "jacky" });
      const c0 = timing.transition.blocksCurve[0][0];
      wordmark = { word, curve: timing.transition.blocksCurve.map(([t, p]) => [t - c0 + f, p] as [number, number]), cx: 378 + word.width / 2 };
      add({ g: word.g, t0: 0, mode: "now" });
      if (sc.tagline) {
        const tg = el("g", {}, g);
        text(tg, 390, 660, sc.tagline.text, { size: 72, font: "zh", weight: 2.4 });
        const t0 = at("title", `标语 ${sc.tagline.text}`, sc.tagline);
        add({ g: tg, t0, mode: "pop", cx: 700, cy: 630, kind: "" });
        cheers.push(t0);
        marqFrom = t0 + 0.9;
      }
      return "end";
    },
  };


  // ================= 竖屏 3:4 模板（偏口播）：截图放大在中部，正文收进下方信息区，芽仔在右下 =================
  // 竖屏分区：演示区 y≤860（y>560 时 x≤900，避开右侧点赞栏）；左下口播小窗；字幕在 y≈1160
  // 竖屏以 x=540 为中轴左右对称：演示区 x 60–1020；y≥800 进入抖音右侧按钮栏高度，信息行收在 x≤930
  const VM = { mediaTop: 270, infoTop: 752, infoRight: 930 };
  const VCX = 540, VL = 60, VR = 1020;
  const vchipAt = (parent: Element, cx: number, y: number, str: string, fill: string, size: number) => {
    const outer = el("g", {}, parent);
    const cg = chip(outer, 0, 0, str, fill, size);
    outer.setAttribute("transform", `translate(${cx - cg.w / 2},${y})`);
    return { g: cg.g, w: cg.w };
  };
  const vtemplates: Record<string, (c: Ctx) => SpotKey> = {
    ...spokenTemplates(true),
    headline({ g, add, from, sc, S }) {
      let y = 300;
      (sc.lines as { text: string; size: number; font?: "zh" | "en"; hl?: string; color?: string }[]).forEach((l, i) => {
        const size = Math.round(l.size * 0.78);
        const tg = el("g", {}, g);
        const tt = text(tg, VCX, y, l.text, { size, font: l.font ?? "zh", weight: size / 38, color: l.color, anchor: "middle" });
        const w = tt.getComputedTextLength();
        const t0 = S + 0.05 + i * 0.14;
        if (l.hl) {
          const hl = sk.line(tg, [[VCX - w / 2 - 8, y + 12], [VCX + w / 2 + 10, y + 5]], 610 + i, { stroke: l.hl, strokeWidth: size * 0.3, roughness: 0.6 });
          tg.insertBefore(hl.g, tt);
          add({ g: hl.g, t0: t0 + 0.2, mode: "draw", sks: [hl], dur: 0.25, kind: "" });
        }
        add({ g: tg, t0, mode: "pop", cx: VCX, cy: y - size * 0.35, kind: "" });
        y += size * 1.65;
      });
      if (sc.chip) {
        const cg = vchipAt(g, VCX, y - 34, sc.chip.text, "#ffe89a", 40);
        add({ g: cg.g, t0: from("chip", `标签 ${sc.chip.text}`, sc.chip), mode: "pop", cx: cg.w / 2, cy: 31, kind: "" });
      }
      return "headline";
    },

    hero({ g, add, at, sc }) {
      if (sc.title) {
        const tg = el("g", {}, g);
        const tt = text(tg, VCX, 340, sc.title.text, { size: 150, font: "en", weight: 3.2, anchor: "middle" });
        const w = tt.getComputedTextLength();
        const hl = sk.line(tg, [[VCX - w / 2 - 10, 360], [VCX + w / 2 + 10, 354]], 11, { stroke: C.yellow, strokeWidth: 24, roughness: 0.6 });
        tg.insertBefore(hl.g, tt);
        const t0 = at("title", `标题 ${sc.title.text}`, sc.title);
        add({ g: tg, t0, mode: "pop", cx: VCX, cy: 290, kind: "", em: !!sc.title.em });
        add({ g: hl.g, t0: t0 + 0.15, mode: "draw", sks: [hl], dur: 0.25, kind: "" });
      }
      (sc.chips ?? []).forEach((c: Cued, i: number) => {
        const cg = vchipAt(g, VCX, 420 + i * 86, c.text, i === 0 ? "#ffe89a" : "#b6ecd6", 40);
        add({ g: cg.g, t0: at("chip", `标签 ${c.text}`, c), mode: "pop", cx: cg.w / 2, cy: 31, kind: "" });
      });
      return "hero";
    },

    prompt({ g, add, at, from, sc }) {
      if (sc.doc) {
        const dg = el("g", {}, g);
        el("path", { d: rrectPath(VL, 70, VR - VL, 130, 18), fill: C.card }, dg);
        sk.rrect(dg, VL, 70, VR - VL, 130, 18, 31, { strokeWidth: 4 }).all(1);
        const pd = "M112,92 L160,92 L180,112 L180,178 L112,178 Z";
        sk.path(dg, pd, 32, { strokeWidth: 3.4 }).all(1);
        for (let k = 0; k < 3; k++) sk.line(dg, [[124, 128 + k * 16], [168, 128 + k * 16]], 40 + k, { strokeWidth: 2.4, stroke: C.gray }).all(1);
        const tt = text(dg, 210, 155, sc.doc.title, { size: 58, font: "zh", weight: 2 });
        text(dg, 230 + tt.getComputedTextLength(), 152, sc.doc.sub, { size: 34, font: "zh", color: C.gray });
        add({ g: dg, t0: at("doc", `文档 ${sc.doc.title}`, sc.doc), mode: "pop", cx: VCX, cy: 135 });
      }
      const bx = VL, by = 290, bw = VR - VL, bh = 500;
      const bg = el("g", {}, g);
      const bd = `M${bx + 26},${by} L${bx + 90},${by} L${bx + 70},${by - 70} L${bx + 170},${by} L${bx + bw - 26},${by} Q${bx + bw},${by} ${bx + bw},${by + 26} L${bx + bw},${by + bh - 26} Q${bx + bw},${by + bh} ${bx + bw - 26},${by + bh} L${bx + 26},${by + bh} Q${bx},${by + bh} ${bx},${by + bh - 26} L${bx},${by + 26} Q${bx},${by} ${bx + 26},${by} Z`;
      el("path", { d: bd, fill: C.card }, bg);
      sk.path(bg, bd, 51, { strokeWidth: 4.2, roughness: 0.8 }).all(1);
      const labelT = sc.label ? at("bubble", `气泡 ${sc.label.text}`, sc.label) : Infinity;
      const firstT = sc.bullets?.length ? Math.max(0, fr(find(sc.bullets[0].cue, lineOff[sc.line]).t - LEAD.pop)) : Infinity;
      // 标签很早时 min 仍会留空框；有要点就限为最多提前 0.1 秒，满足空白 ≤0.3 秒。
      const frameT = Number.isFinite(firstT) ? Math.max(Math.min(labelT, firstT) - 0.1, firstT - 0.1) : Number.isFinite(labelT) ? labelT : 0;
      const bubbleEvent = [...events].reverse().find((e) => e.kind === "bubble" && e.cue === sc.label?.cue);
      if (bubbleEvent) bubbleEvent.t = fr(frameT);
      add({ g: bg, t0: frameT, mode: "pop", cx: VCX, cy: by + bh / 2 });
      if (sc.label) {
        const lg = chip(g, bx + 200, by - 30, sc.label.text, "#ffe89a", 38);
        add({ g: lg.g, t0: frameT, mode: "pop", cx: bx + 200 + lg.w / 2, cy: by });
      }
      (sc.bullets ?? []).forEach((b: Cued, i: number) => {
        const rg = el("g", {}, g);
        const y = by + 110 + i * 112;
        sk.circle(rg, bx + 70, y - 16, 54, 60 + i, { fill: PALETTE[(i % 5) + 1][1], fillStyle: "solid", strokeWidth: 3.2 }).all(1);
        text(rg, bx + 70, y - 3, String(i + 1), { size: 38, font: "en", weight: 1.4, anchor: "middle" });
        text(rg, bx + 120, y, b.text, { size: 50, font: "zh", weight: 1.6 });
        add({ g: rg, t0: at("bullet", `要点 ${b.text}`, b), mode: "pop", cx: bx + 70, cy: y - 16 });
      });
      return "corner";
    },

    stats({ g, add, at, sc }) {
      if (sc.variant === "production") {
        sc.cards.forEach((card: any, i: number) => {
          const x = i === 0 ? 300 : 780, rg = el("g", {}, g);
          symbol(rg, x, 340, i === 0 ? "paper" : "clock", stopCol(i + 1)[1], 2200 + i * 10);
          text(rg, x, 545, card.num, { size: 140, font: "en", weight: 3, anchor: "middle", color: i === 0 ? C.ink : C.green });
          checkedText(rg, x, 640, card.label, 44, 410);
          add({ g: rg, t0: at("stat", card.label, card), mode: "fade", em: !!card.em });
        });
        return "corner";
      }
      sc.cards.forEach((c: any, i: number) => {
        const y = 260 + i * 280;
        const cg = statCard(g, 90, y, 900, 250, c.num, c.unit, c.label, PALETTE[i + 1][0], 70 + i * 5);
        add({ g: cg, t0: at("card", `数字 ${c.num}${c.unit}`, c), mode: "pop", cx: VCX, cy: y + 125, em: !!c.em });
      });
      if (sc.stamp) add({ g: stamp(g, 880, 270, sc.stamp.text, C.green), t0: at("stamp", `印章 ${sc.stamp.text}`, sc.stamp), mode: "slam", cx: 880, cy: 270, rot: -12 });
      return "corner";
    },

    chapter({ g, flat, add, at, from, sc }) {
      const [col, light] = stopCol(sc.stop);
      const shots = (sc.shots ?? []) as { src: string; cue: string }[];
      const hasMedia = shots.length > 0 || !!sc.pages?.shots;
      const R = hasMedia ? VM.infoRight : VR;
      let y = hasMedia ? VM.infoTop : 290;
      let flowX = 60; // 信息行横向续排（有截图时信息只剩一两行）
      if (sc.pages?.shots) {
        const t0 = at("page", `页面 ${sc.pages.count}`, sc.pages);
        (sc.pages.shots as string[]).forEach((src, k) => {
          const cx = 500 + k * 22, cy = 480 + k * 22;
          add({ g: photo(flat, cx, cy, 700, base + src, [-3, 1.5, 4][k % 3], 320 + k), t0: t0 + k * 0.12, mode: "pop", cx, cy });
        });
        for (let k = 0; k < 4; k++) add({ g: check(g, 896, 320 + k * 95), t0: t0 + 0.4 + k * 0.28, mode: "pop", cx: 916, cy: 340 + k * 95 });
        const lg = el("g", {}, g);
        text(lg, 60, y + 44, sc.pages.count, { size: 46, font: "zh", weight: 2 });
        add({ g: lg, t0: t0 + 0.2, mode: "pop", cx: 110, cy: y + 30 });
        flowX = 190;
      }
      if (sc.search) {
        const w = hasMedia ? 520 : R - 60;
        const sgp = el("g", {}, g);
        el("path", { d: rrectPath(60, y, w, 86, 43), fill: "#fff" }, sgp);
        sk.rrect(sgp, 60, y, w, 86, 43, 110, { strokeWidth: 4.2 }).all(1);
        sk.circle(sgp, 112, y + 40, 32, 111, { strokeWidth: 3.8 }).all(1);
        sk.line(sgp, [[124, y + 52], [140, y + 68]], 112, { strokeWidth: 4.6 }).all(1);
        text(sgp, 158, y + 58, sc.search.query, { size: 44, font: "zh", weight: 1.3 });
        add({ g: sgp, t0: at("search", `搜索 ${sc.search.query}`, sc.search), mode: "pop", cx: 60 + w / 2, cy: y + 43 });
        if (hasMedia) flowX = 60 + w + 20;
        else y += 116;
      }
      if (sc.cards && hasMedia) {
        // 有截图：卡片横排成一行小卡
        const n = sc.cards.length, gap = 14, cw = (R - 60 - gap * (n - 1)) / n;
        sc.cards.forEach((c: any, i: number) => {
          const x0 = 60 + i * (cw + gap);
          const cg = el("g", {}, g);
          el("path", { d: rrectPath(x0, y, cw, 96, 14), fill: light }, cg);
          sk.rrect(cg, x0, y, cw, 96, 14, 125 + i, { strokeWidth: 3.6 }).all(1);
          text(cg, x0 + 20, y + 44, c.title, { size: 34, font: "zh", weight: 1.6 });
          text(cg, x0 + 20, y + 80, c.sub, { size: 24, font: "zh", color: "#5d5850" });
          add({ g: cg, t0: at("card", `卡片 ${c.title}`, c), mode: "pop", cx: x0 + cw / 2, cy: y + 48 });
        });
        y += 110;
      } else if (sc.cards) {
        const compact = false;
        const h = compact ? 78 : 170, gap = compact ? 10 : 26;
        sc.cards.forEach((c: any, i: number) => {
          const cy0 = y + i * (h + gap);
          const cg = el("g", {}, g);
          el("path", { d: rrectPath(60, cy0, R - 60, h, 16), fill: light }, cg);
          sk.rrect(cg, 60, cy0, R - 60, h, 16, 125 + i, { strokeWidth: 4 }).all(1);
          text(cg, 96, cy0 + h / 2 + (compact ? 14 : 22), c.title, { size: compact ? 40 : 64, font: "zh", weight: 2 });
          text(cg, R - 30, cy0 + h / 2 + (compact ? 10 : 14), c.sub, { size: compact ? 26 : 36, font: "zh", color: "#5d5850", anchor: "end" });
          add({ g: cg, t0: at("card", `卡片 ${c.title}`, c), mode: "pop", cx: (60 + R) / 2, cy: cy0 + h / 2 });
        });
        y += sc.cards.length * (h + gap) + 10;
      }
      const wrapChips = (list: Cued[], fill: string, prefix = "", kind = "chip") => {
        let x = flowX;
        const size = hasMedia ? 30 : list.length > 6 ? 34 : 38;
        const rowH = size * 1.55 + 14;
        list.forEach((c) => {
          let cg = chip(g, x, y, prefix + c.text, fill, size);
          if (x + cg.w > R) {
            cg.g.remove();
            x = 60;
            y += rowH;
            cg = chip(g, x, y, prefix + c.text, fill, size);
          }
          add({ g: cg.g, t0: at(kind, `${kind === "issue" ? "问题" : "标签"} ${c.text}`, c), mode: "pop", cx: x + cg.w / 2, cy: y + size * 0.78 });
          x += cg.w + 18;
        });
        y += rowH + 6;
      };
      if (sc.chips) wrapChips(sc.chips, light);
      if (sc.issues) wrapChips(sc.issues, "#ffc2cf", "⚠ ", "issue");
      if (sc.stat) {
        // 有截图时做成贴纸压在截图左下角，免得信息区溢出到字幕
        const sg = el("g", {}, g);
        const bx0 = hasMedia ? 80 : 60, by0 = hasMedia ? 590 : y;
        const nt = text(sg, bx0 + 28, by0 + 104, sc.stat.num, { size: 110, font: "en", weight: 3.2 });
        const nw = nt.getComputedTextLength();
        const ut = text(sg, bx0 + 40 + nw, by0 + 96, sc.stat.unit, { size: 46, font: "zh", weight: 1.8 });
        const bw = nw + ut.getComputedTextLength() + 76;
        const card = el("g", {}, sg);
        sg.insertBefore(card, nt);
        el("path", { d: rrectPath(bx0, by0, bw, 136, 18), fill: "#fffdf8" }, card);
        sk.rrect(card, bx0, by0, bw, 136, 18, 140, { stroke: C.ink, strokeWidth: 4, fill: col, fillStyle: "hachure", hachureGap: 12, fillWeight: 2 }).all(1);
        el("path", { d: rrectPath(bx0 + 12, by0 + 12, bw - 24, 112, 12), fill: "#fffdf8" }, card);
        add({ g: sg, t0: at("stat", `数字 ${sc.stat.num}${sc.stat.unit}`, sc.stat), mode: "pop", cx: bx0 + bw / 2, cy: by0 + 68 });
        if (!hasMedia) y += 160;
      }
      if (sc.stamp) {
        const sx = hasMedia ? 700 : 760, sy = hasMedia ? 650 : y + 80;
        add({ g: stamp(g, sx, sy, sc.stamp.text, C.green), t0: at("stamp", `印章 ${sc.stamp.text}`, sc.stamp), mode: "slam", cx: sx, cy: sy, rot: -10 });
      }
      shots.forEach((sh, i) => {
        const cx = 540 + i * 16, cy = 500 + i * 22, rot = i % 2 ? 2.5 : -1.5;
        add({ g: photo(flat, cx, cy, 800, base + sh.src, rot, 340 + i), t0: from("shot", `截图 ${sh.src.split("/").pop()}`, sh), mode: "pop", cx, cy });
      });
      return "corner";
    },

    showcase({ g, flat, add, at, from, sc }) {
      const shots = sc.shots as { src: string; cue: string }[];
      const six = shots.length > 4;
      const w = six ? 340 : 400;
      const xs = [300, 780];
      const ys = six ? [312, 500, 688] : [400, 670]; // 以 540 为中轴；最下排底边 ≈796，右下角不进按钮栏（y≥800）
      shots.forEach((sh, i) => {
        const cx = xs[i % 2], cy = ys[Math.floor(i / 2)], rot = [-3, 2.5, 2, -2.5, -2, 3][i % 6];
        add({ g: photo(flat, cx, cy, w, base + sh.src, rot, 300 + i), t0: at("shot", `截图 ${sh.src.split("/").pop()}`, sh), mode: "pop", cx, cy });
      });
      if (sc.label) {
        const cg = vchipAt(g, VCX, 150, sc.label.text, "#ffe89a", 40);
        add({ g: cg.g, t0: from("chip", `标签 ${sc.label.text}`, sc.label), mode: "pop", cx: cg.w / 2, cy: 31 });
      }
      return "corner";
    },

    compare({ g, add, at, sc }) {
      const L = sc.left, Rt = sc.right;
      // 左侧标签每行两个；两行时整块上移 50、分隔线以下顺延 35，结果不压第二排标签
      const steps = (L.steps ?? []) as Cued[];
      const two = steps.length > 2, up = two ? -50 : 0, dn = two ? 35 : 0;
      add({ g: text(el("g", {}, g), VCX, 250 + up, L.title, { size: 54, font: "zh", weight: 2, anchor: "middle" }).parentNode as SVGGElement, t0: 0, mode: "now" });
      for (let r = 0; r * 2 < steps.length; r++) {
        const row = steps.slice(r * 2, r * 2 + 2).map((c) => ({ c, cg: chip(g, 0, 0, c.text, "#ffe89a", 40) }));
        const total = row.reduce((a2, x) => a2 + x.cg.w, 0) + 24 * (row.length - 1);
        let x = VCX - total / 2;
        const y = 305 + up + r * 80;
        for (const { c, cg } of row) {
          cg.g.setAttribute("transform", `translate(${x},${y})`);
          const wrap = el("g", {}, g);
          wrap.appendChild(cg.g);
          add({ g: wrap, t0: at("chip", `步骤 ${c.text}`, c), mode: "pop", cx: x + cg.w / 2, cy: y + 31 });
          x += cg.w + 24;
        }
      }
      const lr = el("g", {}, g);
      text(lr, VCX, 485 + dn, L.result.text, { size: 100, font: "zh", weight: 3.2, color: C.red, anchor: "middle" });
      add({ g: lr, t0: at("stat", `结果 ${L.result.text}`, L.result), mode: "pop", cx: VCX, cy: 450 + dn });
      const dv = sk.line(g, [[VL, 555 + dn], [VR, 555 + dn]], 150, { strokeWidth: 3, stroke: C.gray });
      add({ g: dv.g, t0: 0, mode: "now" });
      add({ g: text(el("g", {}, g), VCX, 645 + dn, Rt.title, { size: 54, font: "en", weight: 2.4, anchor: "middle" }).parentNode as SVGGElement, t0: 0, mode: "now" });
      const rr = el("g", {}, g);
      text(rr, VCX, 800 + dn * 0.6, Rt.result.text, { size: 100, font: "en", weight: 3.4, color: C.green, anchor: "middle" });
      add({ g: rr, t0: at("stat", `结果 ${Rt.result.text}`, Rt.result) + 0.35, mode: "pop", cx: VCX, cy: 765 + dn * 0.6 });
      return "corner";
    },

    verdict({ g, add, at, sc }) {
      const og = el("g", {}, g);
      const ot = text(og, VCX, 340, sc.old.text, { size: 62, font: "zh", weight: 1.4, color: C.gray, anchor: "middle" });
      const ow = ot.getComputedTextLength();
      add({ g: og, t0: at("chip", `旧说法 ${sc.old.text}`, sc.old), mode: "pop", cx: VCX, cy: 318 });
      const st = sk.line(g, [[VCX - ow / 2 - 16, 324], [VCX + ow / 2 + 16, 312]], 160, { stroke: C.red, strokeWidth: 8, roughness: 0.5 });
      add({ g: st.g, t0: at("strike", "划掉旧说法", { cue: sc.old.strike }), mode: "draw", sks: [st], dur: 0.12 });
      const ng = el("g", {}, g);
      const nt = text(ng, VCX, 510, sc.new.text, { size: 92, font: "zh", weight: 3.2, anchor: "middle" });
      const nw = nt.getComputedTextLength();
      const hl = sk.line(ng, [[VCX - nw / 2, 528], [VCX + nw / 2, 522]], 161, { stroke: C.yellow, strokeWidth: 26, roughness: 0.6 });
      ng.insertBefore(hl.g, nt);
      const t0 = at("title", `新说法 ${sc.new.text}`, sc.new);
      add({ g: ng, t0, mode: "pop", cx: VCX, cy: 475, em: !!sc.new.em });
      add({ g: hl.g, t0: t0 + 0.15, mode: "draw", sks: [hl], dur: 0.25 });
      if (sc.stamp) add({ g: stamp(g, VCX, 660, sc.stamp.text, C.green), t0: at("stamp", `印章 ${sc.stamp.text}`, sc.stamp), mode: "slam", cx: VCX, cy: 660, rot: -8 });
      if (sc.chip) {
        const cg = vchipAt(g, VCX, 750, "💬 " + sc.chip.text, "#ddd3ff", 36);
        add({ g: cg.g, t0: at("chip", `标签 ${sc.chip.text}`, sc.chip), mode: "pop", cx: cg.w / 2, cy: 27 });
      }
      return "corner";
    },

    ending({ g, add, at, sc }) {
      const cell = 24;
      const word = new PixelWord(g, sc.word ?? "JACKY", VCX - (19 * cell) / 2, 300, cell, 700);
      const f = at("blocks", "像素字标", { cue: "jacky" });
      const c0 = timing.transition.blocksCurve[0][0];
      wordmark = { word, curve: timing.transition.blocksCurve.map(([t, p]) => [t - c0 + f, p] as [number, number]), cx: VCX };
      add({ g: word.g, t0: 0, mode: "now" });
      if (sc.tagline) {
        const tg = el("g", {}, g);
        text(tg, VCX, 560, sc.tagline.text, { size: 60, font: "zh", weight: 2.2, anchor: "middle" });
        const t0 = at("title", `标语 ${sc.tagline.text}`, sc.tagline);
        add({ g: tg, t0, mode: "pop", cx: VCX, cy: 540, kind: "" });
        cheers.push(t0);
        marqFrom = t0 + 0.9;
      }
      return "end";
    },
  };

  // 竖屏章节头：STOP 标签 + 标题 + 下划线 + 进度点（紧凑）
  function chapterHeaderV(c: Ctx, keep: boolean) {
    const { g, add, S, sc } = c;
    const [col] = stopCol(sc.stop);
    const h0 = keep ? S - 1 : S + 0.05;
    const pill = el("g", {}, g);
    el("path", { d: rrectPath(60, 50, 200, 50, 25), fill: col }, pill);
    sk.rrect(pill, 60, 50, 200, 50, 25, 170 + sc.stop, { strokeWidth: 3.2 }).all(1);
    text(pill, 160, 86, `STOP ${String(sc.stop).padStart(2, "0")}`, { size: 34, font: "en", weight: 1, anchor: "middle" });
    add({ g: pill, t0: h0, mode: "pop", cx: 160, cy: 75 });
    const tg = el("g", {}, g);
    const tt = text(tg, 64, 172, sc.title, { size: 66, font: "zh", weight: 2.2 });
    const w = tt.getComputedTextLength();
    const ul = sk.line(tg, [[60, 186], [76 + w, 181]], 180 + sc.stop, { stroke: col, strokeWidth: 16, roughness: 0.6 });
    tg.insertBefore(ul.g, tt);
    add({ g: tg, t0: h0 + 0.05, mode: "fade" });
    add({ g: ul.g, t0: h0 + 0.2, mode: "draw", sks: [ul], dur: 0.3 });
    const sub = text(el("g", {}, g), 66, 228, sc.sub ?? "", { size: 30, font: "zh", color: C.gray });
    add({ g: sub.parentNode as SVGGElement, t0: h0 + 0.3, mode: "fade" });
    const dots = el("g", {}, g);
    for (let k = 1; k <= STEPS; k++) {
      const x = 998 - (STEPS - k) * 58; // 右对齐到 x≈1020
      if (k > 1) sk.line(dots, [[x - 36, 75], [x - 22, 75]], 190 + k, { strokeWidth: 2.6 }).all(1);
      if (k === sc.stop) el("path", { d: circlePath(x, 75, 22), fill: col }, dots);
      sk.circle(dots, x, 75, 44, 195 + k, { strokeWidth: 3 }).all(1);
      text(dots, x, 85, String(k), { size: 28, font: "en", weight: 1, anchor: "middle" });
    }
    add({ g: dots, t0: h0, mode: "fade" });
    return sc.stop as number;
  }

  Object.assign(templates, { diagram, roles, allocation });
  Object.assign(vtemplates, { diagram, roles, allocation, trap, clones });
  buildScenes();

  // ---------- 章节头：STOP 标签 + 手写标题 + 荧光下划线 + 进度点 ----------
  function chapterHeader(c: Ctx, keep: boolean) {
    const { g, add, S, sc } = c;
    const [col] = stopCol(sc.stop);
    const h0 = keep ? S - 1 : S + 0.05;
    const pill = el("g", {}, g);
    el("path", { d: rrectPath(80, 56, 230, 56, 28), fill: col }, pill);
    sk.rrect(pill, 80, 56, 230, 56, 28, 170 + sc.stop, { strokeWidth: 3.4 }).all(1);
    text(pill, 195, 96, `STOP ${String(sc.stop).padStart(2, "0")}`, { size: 38, font: "en", weight: 1, anchor: "middle" });
    add({ g: pill, t0: h0, mode: "pop", cx: 195, cy: 84 });
    const tg = el("g", {}, g);
    const tt = text(tg, 84, 206, sc.title, { size: 80, font: "zh", weight: 2.6 });
    const w = tt.getComputedTextLength();
    const ul = sk.line(tg, [[80, 222], [96 + w, 216]], 180 + sc.stop, { stroke: col, strokeWidth: 18, roughness: 0.6 });
    tg.insertBefore(ul.g, tt);
    add({ g: tg, t0: h0 + 0.05, mode: "fade" });
    add({ g: ul.g, t0: h0 + 0.2, mode: "draw", sks: [ul], dur: 0.3 });
    const sub = text(el("g", {}, g), 86, 276, sc.sub ?? "", { size: 36, font: "zh", color: C.gray });
    add({ g: sub.parentNode as SVGGElement, t0: h0 + 0.3, mode: "fade" });
    const dots = el("g", {}, g);
    for (let k = 1; k <= STEPS; k++) {
      const x = 1800 - (STEPS - k) * 90; // 右对齐到 x≈1830
      if (k > 1) sk.line(dots, [[x - 60, 84], [x - 30, 84]], 190 + k, { strokeWidth: 3 }).all(1);
      if (k === sc.stop) el("path", { d: circlePath(x, 84, 30), fill: col }, dots);
      sk.circle(dots, x, 84, 60, 195 + k, { strokeWidth: 3.4 }).all(1);
      text(dots, x, 97, String(k), { size: 36, font: "en", weight: 1, anchor: "middle" });
    }
    add({ g: dots, t0: h0, mode: "fade" });
    return sc.stop as number;
  }

  // ---------- 芽仔、字幕、情绪 ----------
  const yz = new Yazai(stage.top, 100, { clean: brollMode });
  const confetti = cheers.map((t0, i) => ({ t0, fx: FMT === "3x4" ? new Confetti(ink, 640, 960, 46, 77 + i) : new Confetti(ink, 1493, 560, 46, 77 + i) }));
  // 竖屏口播小窗：?pip=none 不画；video 只画外框（视频在出片时由 ffmpeg 嵌入）；默认画占位
  if (FMT === "3x4") {
    const mode = new URLSearchParams(location.search).get("pip") ?? "placeholder";
    if (mode !== "none") {
      const { x, y, w, h } = V_SAFE.pip;
      const pg = el("g", {}, stage.hud);
      el("rect", { x: x + 5, y: y + 6, width: w, height: h, rx: 18, fill: C.ink }, pg);
      if (mode === "placeholder") {
        el("rect", { x, y, width: w, height: h, rx: 18, fill: "#2b2a28" }, pg);
        const cam = el("g", { transform: `translate(${x + w / 2},${y + h / 2 - 18})` }, pg);
        el("rect", { x: -34, y: -22, width: 50, height: 44, rx: 8, fill: "none", stroke: "#cfc6b6", "stroke-width": 4 }, cam);
        el("path", { d: "M18,-10 L38,-22 L38,22 L18,10 Z", fill: "none", stroke: "#cfc6b6", "stroke-width": 4, "stroke-linejoin": "round" }, cam);
        text(pg, x + w / 2, y + h / 2 + 50, "口播小窗", { size: 30, font: "zh", color: "#cfc6b6", anchor: "middle" });
      } else el("rect", { x, y, width: w, height: h, rx: 18, fill: "#000" }, pg);
      el("rect", { x, y, width: w, height: h, rx: 18, fill: "none", stroke: C.ink, "stroke-width": 4 }, pg);
    }
  }
  const captions = new URLSearchParams(location.search).get("caption") !== "none";
  const subs = captions ? new Subtitles(stage.hud, sb.lines.map((l, i) => ({ t: fr(v.lines[i].start - LEAD.subtitle), zh: l.zh, en: l.en })), v.end + 1) : null;
  if (captions) for (const [i, l] of sb.lines.entries()) events.push({ kind: "sub", label: `字幕 ${i + 1}`, cue: l.zh.slice(0, 6), voice: v.lines[i].start, t: fr(v.lines[i].start - LEAD.subtitle) });

  tl.add((t) => {
    built.forEach((b) => {
      const vis = t >= b.t0 && t < b.t1 + (brollMode ? 0 : 0.2);
      if (!vis) {
        setO(b.g, 0);
        setO(b.flat, 0);
        return;
      }
      setO(b.g, 1 - prog(t, b.t1, 0.166));
      setO(b.flat, 1 - prog(t, b.t1, 0.166));
      for (const it of b.items) {
        it.update?.(t);
        if (it.mode === "now") continue;
        if (it.mode === "fade") setO(it.g, prog(t, it.t0, 0.15));
        else if (it.mode === "draw") {
          const p = prog(t, it.t0, it.dur ?? 0.2);
          it.sks!.forEach((s) => s.all(p));
          setO(it.g, p > 0 ? 1 : 0);
        } else if (it.mode === "slam") {
          const p = prog(t, it.t0, 0.18);
          setO(it.g, p > 0 ? Math.min(1, p * 3) : 0);
          setT(it.g, 0, 0, lerp(1.9, 1, ease.outCubic(p)), it.rot ?? 0, it.cx, it.cy);
        } else {
          const s = popScale(t, it.t0);
          setO(it.g, s > 0 ? 1 : 0);
          setT(it.g, 0, 0, Math.max(s, 0.001), it.rot ?? 0, it.cx, it.cy);
        }
        if (it.emNode) {
          const b = it.emNode.getBBox();
          setT(it.emNode, 0, 0, emScale(t, it.t0, it.peak), 0, b.x + b.width / 2, b.y + b.height / 2);
          if (it.highlight) it.highlight.setAttribute("opacity", String(0.8 * keyframes(t, [[it.t0, 0], [it.t0 + 0.18, 1], [it.t0 + 0.36, 1], [it.t0 + 0.6, 0]])));
        }
      }
    });
    if (wordmark) wordmark.word.build(t, wordmark.curve);

    // 芽仔：按时间表换位。近处原地“站起/坐回”（0.3s），远处淡出再淡入，写了 walk 的走过去（小碎步）
    yz.build(t, 0);
    let k = 0;
    for (let i = 0; i < plan.length; i++) if (plan[i].t <= t) k = i;
    const P1 = plan[k], P0 = plan[Math.max(0, k - 1)];
    const A = P0.pos ?? SPOT[P0.spot], B = P1.pos ?? SPOT[P1.spot];
    let px = B.x, py = B.y, ps = B.s, op = 1, bob = 0, lean = 0;
    if (k > 0 && A !== B) {
      const dist = Math.hypot(B.x - A.x, B.y - A.y);
      if (P1.road) {
        // 道路上的碎步沿同一条三次贝塞尔走，不在站点之间拉直线。
        const p = prog(t, P1.t, P1.road.duration), e = ease.inOutQuad(p);
        const pos = pointOnRoad(P1.road.points, lerp(P1.road.from, P1.road.to, e));
        [px, py, ps] = [pos.x, pos.y, B.s];
        const steps = Math.max(2, Math.round(P1.road.duration * 3.5));
        bob = p < 1 ? -Math.abs(Math.sin(Math.PI * steps * p)) * 14 : 0;
        lean = p < 1 ? 2.5 * Math.sin(Math.PI * steps * p) : 0;
      } else if (P1.hop) {
        // 一格一格往前跳：抛物线，落地停住
        const p = prog(t, P1.t, P1.hop), e = ease.inOutQuad(p);
        [px, py, ps] = [lerp(A.x, B.x, e), lerp(A.y, B.y, e), lerp(A.s, B.s, e)];
        bob = p < 1 ? -Math.sin(Math.PI * p) * 130 : 0;
      } else if (P1.walk) {
        const d = Math.min(1.2, Math.max(0.6, dist / 700));
        const p = prog(t, P1.t, d), e = ease.inOutQuad(p);
        const steps = Math.max(2, Math.round(d * 3.5));
        [px, py, ps] = [lerp(A.x, B.x, e), lerp(A.y, B.y, e), lerp(A.s, B.s, e)];
        bob = p < 1 ? -Math.abs(Math.sin(Math.PI * steps * p)) * 14 : 0;
        lean = p < 1 ? 2.5 * Math.sin(Math.PI * steps * p) : 0;
      } else if (dist < 260) {
        const e = ease.inOutCubic(prog(t, P1.t, 0.3));
        [px, py, ps] = [lerp(A.x, B.x, e), lerp(A.y, B.y, e), lerp(A.s, B.s, e)];
      } else if (t < P1.t + 0.12) {
        [px, py, ps, op] = [A.x, A.y, A.s, 1 - prog(t, P1.t, 0.12)];
      } else op = prog(t, P1.t + 0.12, 0.18);
    }
    // 每个关键时刻只做一个动作；平时角色与文字都静止。说话点阵（talk）不带动作。
    const active = (f: typeof faces[number]) => t >= f.on && t < f.off + 0.25;
    const m = faces.find((f) => !f.talk && active(f)) ?? faces.find(active);
    const act = m && !m.talk ? keyframes(t, [[m.on, 0], [m.on + 0.22, 1], [m.on + 0.42, 1], [m.on + 0.85, 0]]) : 0;
    let headRot = 0, hop = 0;
    if (m?.action === "retreat") { px += 24 * act; ps *= 1 - 0.05 * act; }
    if (m?.action === "celebrate") hop = -16 * act;
    if (m?.action === "observe") headRot = -5 * act;
    if (m?.action === "push") lean += -5 * act;
    const jump = cheers.reduce((sum, cheer) => sum + keyframes(t, [[cheer, 0], [cheer + 0.17, -30], [cheer + 0.47, 0]], ease.inOutQuad), 0);
    const inScene = !brollMode || built.some((b) => t >= b.t0 && t < b.t1);
    const localActor = built.some((b) => t >= b.t0 && t < b.t1 && b.g.hasAttribute("data-local-yazai"));
    setO(yz.root, inScene && !localActor ? op : 0);
    yz.pose({ x: px, y: py + (bob + hop + jump) * Math.max(0.5, ps), scale: ps, rot: lean, headRot, sprout: 0 });
    // 面罩：表情；结尾亮起“Jacky / 无限生长”；其余时间纯黑
    yz.setFace(m ? m.face : null, m ? (t < m.off ? prog(t, m.on, 0.15) : 1 - prog(t, m.off, 0.2)) : 0, !m || t < m.off, t);
    yz.setMarquee(t >= marqFrom && !m ? prog(t, marqFrom, 0.25) : 0, t, marqFrom);
    confetti.forEach(({ t0, fx }) => { fx.update(t, t0); setO(fx.g, inScene && t >= t0 && t < t0 + 3 ? 1 : 0); });
    subs?.update(t);
  });

  // 可放成品展示的留白：相邻两个画面事件间隔 ≥ 3s
  const vis = events.filter((e) => e.kind !== "sub" && e.kind !== "face").map((e) => e.t).sort((a, b) => a - b);
  const broll: [number, number][] = [];
  for (let i = 1; i < vis.length; i++) if (vis[i] - vis[i - 1] >= 3) broll.push([+(vis[i - 1] + 0.8).toFixed(1), +(vis[i] - 0.3).toFixed(1)]);
  if (vis.length && v.end - vis[vis.length - 1] >= 3) broll.push([+(vis[vis.length - 1] + 0.8).toFixed(1), +(v.end - 0.3).toFixed(1)]);

  // 芽仔统计（给 pnpm qa 做抢戏检查）：在台时长、走动次数、表情时刻与当时大小
  let onTime = 0;
  plan.forEach((p, i) => p.on && (onTime += Math.min(v.end, plan[i + 1]?.t ?? v.end) - p.t));
  const spotAt = (t: number) => { const p = [...plan].reverse().find((q) => q.t <= t); return p?.pos ?? SPOT[p?.spot ?? "corner"]; };
  const yazai = { duration: v.end, onTime: +onTime.toFixed(2), walks: plan.filter((p) => p.walk && !p.road).length, roadWalks: plan.filter((p) => p.road).length, routes: plan.filter((p) => p.road).map((p) => ({ t: p.t, ...p.road! })), faces: faces.map((f) => ({ face: f.face, t: f.on, off: f.off, talk: !!f.talk, scale: spotAt(f.on + 0.3).s, action: f.action })), allowed: allowedFaces };

  return { tl, events, broll, yazai };
}

// ---------- 小组件 ----------
/** 照片卡：纸白边框 + 手绘描边 + 黄胶带 + 轻阴影，内容是成品截图 */
function photo(parent: Element, cx: number, cy: number, w: number, src: string, rot: number, seed: number) {
  const h = (w * 9) / 16, pad = 12;
  const g = el("g", {}, parent);
  const inner = el("g", { transform: `rotate(${rot} ${cx} ${cy})` }, g);
  const x = cx - w / 2, y = cy - h / 2;
  el("rect", { x: x - pad + 9, y: y - pad + 11, width: w + pad * 2, height: h + pad * 2, rx: 6, fill: "#3a3026", opacity: 0.14 }, inner);
  el("rect", { x: x - pad, y: y - pad, width: w + pad * 2, height: h + pad * 2, rx: 6, fill: "#fffdf8" }, inner);
  el("image", { href: src, x, y, width: w, height: h, preserveAspectRatio: "xMidYMid slice" }, inner);
  sk.rrect(inner, x - pad, y - pad, w + pad * 2, h + pad * 2, 6, seed, { strokeWidth: 3.6, roughness: 0.8 }).all(1);
  el("rect", { x: cx - 62, y: y - pad - 20, width: 124, height: 36, fill: C.yellow, opacity: 0.72, transform: `rotate(${(-rot * 0.6 - 3).toFixed(1)} ${cx} ${y - pad})` }, inner);
  return g;
}

function chip(parent: Element, x: number, y: number, str: string, fill: string, size = 40) {
  const g = el("g", {}, parent);
  const tt = text(g, x + 28, y + size * 1.05, str, { size, font: "zh", weight: 1.2 });
  const w = tt.getComputedTextLength() + 56;
  const h = size * 1.55;
  const bg = el("g", {}, g);
  g.insertBefore(bg, tt);
  el("path", { d: rrectPath(x, y, w, h, h / 2), fill }, bg);
  sk.rrect(bg, x, y, w, h, h / 2, Math.round(x + y), { strokeWidth: 3.4, roughness: 0.7 }).all(1);
  return { g, w };
}

function statCard(parent: Element, x: number, y: number, w: number, h: number, num: string, unit: string, label: string, col: string, seed: number) {
  const g = el("g", {}, parent);
  el("path", { d: rrectPath(x, y, w, h, 18), fill: C.card }, g);
  sk.rrect(g, x, y, w, h, 18, seed, { fill: col, fillStyle: "hachure", hachureGap: 11, fillWeight: 2.6, strokeWidth: 4.4 }).all(1);
  el("path", { d: rrectPath(x + 22, y + 22, w - 44, h - 44, 12), fill: C.card }, g);
  sk.rrect(g, x + 22, y + 22, w - 44, h - 44, 12, seed + 1, { strokeWidth: 3.4 }).all(1);
  // 数字 + 单位整体居中，超宽时一起缩小
  const ng = el("g", {}, g);
  const nt = text(ng, 0, 0, num, { size: 150, font: "en", weight: 3.2 });
  const nw = nt.getComputedTextLength();
  const ut = text(ng, nw + 12, 0, unit, { size: 46, font: unit.match(/^[\x00-\x7f]+$/) ? "en" : "zh", weight: 1.6 });
  const total = nw + 12 + ut.getComputedTextLength();
  const k = Math.min(1, (w - 90) / total);
  ng.setAttribute("transform", `translate(${x + w / 2 - (total * k) / 2},${y + h * 0.56}) scale(${k})`); // 按卡片高度比例定位，横竖屏通用
  text(g, x + w / 2, y + h * 0.8, label, { size: 40, font: "zh", color: C.gray, anchor: "middle" });
  return g;
}

function infoCard(parent: Element, x: number, y: number, w: number, h: number, title: string, sub: string, light: string, seed: number) {
  const g = el("g", {}, parent);
  el("path", { d: rrectPath(x, y, w, h, 18), fill: light }, g);
  sk.rrect(g, x, y, w, h, 18, seed, { strokeWidth: 4.4 }).all(1);
  text(g, x + w / 2, y + 140, title, { size: 70, font: "zh", weight: 2.6, anchor: "middle" });
  text(g, x + w / 2, y + 220, sub, { size: 40, font: "zh", color: "#5d5850", anchor: "middle" });
  return g;
}

function stamp(parent: Element, cx: number, cy: number, str: string, col: string) {
  const g = el("g", {}, parent);
  const tt = text(g, cx, cy + 22, str, { size: 64, font: "zh", color: col, weight: 2.4, anchor: "middle" });
  const w = tt.getComputedTextLength() + 70;
  sk.rrect(g, cx - w / 2, cy - 50, w, 100, 12, Math.round(cx), { stroke: col, strokeWidth: 6, roughness: 1.2 }).all(1);
  sk.rrect(g, cx - w / 2 + 10, cy - 40, w - 20, 80, 8, Math.round(cy), { stroke: col, strokeWidth: 3, roughness: 1.2 }).all(1);
  g.setAttribute("opacity", "0.92");
  return g;
}

function check(parent: Element, x: number, y: number) {
  const g = el("g", {}, parent);
  sk.circle(g, x + 20, y + 20, 48, Math.round(x + y), { fill: C.green, fillStyle: "solid", strokeWidth: 3.4 }).all(1);
  sk.line(g, [[x + 8, y + 20], [x + 17, y + 30], [x + 33, y + 10]], Math.round(x * y) % 997, { stroke: "#fff", strokeWidth: 5, roughness: 0.3 }).all(1);
  return g;
}
