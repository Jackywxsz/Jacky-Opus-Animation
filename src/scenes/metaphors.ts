// 竖屏比喻动画：场景物件和主演自带绝对时间驱动，不复用卡片模板的站位/彩纸。
import { el, sk as defaultSketch, createSketch, text, setT, setO, rrectPath, C, type Sketch } from '../engine/draw';
import { ease, prog, lerp, popScale, keyframes } from '../engine/core';
import { LEAD } from '../engine/sync';
import { Yazai } from '../components/yazai';

export interface MetaphorContext {
  brollMode: boolean; g: SVGGElement; S: number; S1: number; si: number; sc: any;
  from: (kind: string, label: string, cue: { cue: string; text?: string }, lead?: number) => number;
  add: (item: { g: SVGGElement; t0: number; mode: 'now'; end: number; em: false; update: (t: number) => void }) => unknown;
}
const BLUE = '#0138C4';
const PAPER = '#fffdf7';
const GRAY = '#c5c2ba';
const HEIGHT_SCALE = 0.99; // traced silhouette 490px → 485px / 1440 ≈ 33.7%

function cue(c: MetaphorContext, data: any, label: string, kind = 'object', lead = LEAD.pop) {
  if (!data || typeof data.cue !== 'string' || !data.cue.trim()) throw new Error(`${c.sc.template} ${label} 缺少 cue`);
  return c.from(kind, label, data, lead);
}
const cleanSketch = createSketch({ roughness: .25, bowing: .15, fillStyle: 'solid' });
function layer(p: Element, name: string) { return el('g', { 'data-object': name }, p); }
function label(p: Element, str: string, w: number, h: number, size: number, blue = false, sk = defaultSketch) {
  const g = layer(p, str), d = rrectPath(-w / 2, -h / 2, w, h, 15);
  el('path', { d, fill: '#302e28', opacity: .14, transform: 'translate(6,8)' }, g);
  el('path', { d, fill: blue ? BLUE : PAPER, stroke: 'white', 'stroke-width': 9, 'stroke-linejoin': 'round' }, g);
  sk.path(g, d, 8101 + str.length, { stroke: blue ? BLUE : C.ink, strokeWidth: 2.5, roughness: 1.25 }).all(1);
  const tt = text(g, 0, size * .34, str, { size, color: blue ? 'white' : C.ink, anchor: 'middle', weight: 1 });
  if (tt.getComputedTextLength() > w - 24) throw new Error(`${str} 标签过长`);
  return g;
}
function pop(g: Element, t: number, on: number, x: number, y: number, rotation = 0, duration = .38) {
  const s = popScale(t, on, duration, 1.12);
  setO(g, t > on ? 1 : 0); setT(g, x, y, Math.max(.001, s), rotation);
}
function draw(lines: Sketch[], t: number, on: number, duration = .4) { lines.forEach(l => l.all(prog(t, on, duration))); }
function actor(p: Element, seed: number, clean: boolean) {
  const y = new Yazai(p, seed, { articulatedArms: true, clean });
  y.root.setAttribute('data-metaphor-actor', '1');
  y.build(2, 0); // 第一帧完整出现，不重放角色组装
  return y;
}
function face(y: Yazai, f: 'excited' | 'surprise' | 'awkward' | null, t: number, on: number) {
  y.setFace(f, f ? prog(t, on, .12) : 0, true, t);
  y.root.setAttribute('data-face', f ?? 'none');
}
function documentCard(p: Element, str: string, seed: number, sk = defaultSketch) {
  const g = layer(p, str), d = rrectPath(-130, -105, 260, 210, 16);
  el('path', { d, fill: '#302e28', opacity: .13, transform: 'translate(8,9)' }, g);
  el('path', { d, fill: PAPER, stroke: 'white', 'stroke-width': 10 }, g);
  sk.path(g, d, seed, { fill: '#e5e1d8', fillStyle: 'hachure', hachureGap: 17, fillWeight: 1.3, strokeWidth: 3.5 }).all(1);
  el('rect', { x: -111, y: -68, width: 222, height: 126, fill: PAPER }, g);
  text(g, 0, -7, str, { size: 46, anchor: 'middle', weight: 1.4 });
  for (let i = 0; i < 2; i++) sk.line(g, [[-82, 37 + i * 23], [65 - i * 28, 37 + i * 23]], seed + i + 1, { stroke: '#98948c', strokeWidth: 3 }).all(1);
  return g;
}

/** First frame is already a visible compressed pose; settle on frame 12. */
function life(t: number, start: number) {
  const age = Math.max(0, t - start), p = prog(t, start, .4);
  const enter = .68 + .32 * ease.outBack(p, 1.4);
  const breath = Math.sin(age * Math.PI * 2 / 1.2);
  return { scale: .98 * enter, stretchX: 1 - .008 * breath + .12 * (1 - p), stretchY: 1 + .025 * breath - .22 * (1 - p),
    lift: -16 * Math.sin(Math.PI * p) };
}
function arrival(g: Element, t: number, start: number, delay: number, duration: number, x: number, y: number) {
  const p = prog(t, start + delay, duration), scale = .7 + .3 * ease.outBack(p, 1.2);
  setT(g, 0, 0, scale, 0, x, y); setO(g, .18 + .82 * p);
}

export function trap(c: MetaphorContext) {
  const sk = c.brollMode ? cleanSketch : defaultSketch;
  if (!Array.isArray(c.sc.outputs) || c.sc.outputs.length !== 2) throw new Error('trap 需要两个 outputs');
  const magic = cue(c, c.sc.magic, '芽仔举手与魔法短线', 'face', LEAD.face);
  const noteOn = cue(c, c.sc.note, '抛出模糊指令');
  const first = cue(c, c.sc.outputs[0], '文章从盒子弹出');
  const second = cue(c, c.sc.outputs[1], '方案从盒子弹出');
  const crackOn = cue(c, c.sc.crack, '地面裂缝', 'draw', LEAD.draw);
  const pitOn = cue(c, c.sc.pit, '效率陷阱坑口');
  const fallOn = cue(c, c.sc.fall, '芽仔惊讶落入陷阱', 'face', LEAD.face);
  const root = layer(c.g, 'trap-world'); c.g.setAttribute('data-local-yazai', '1');
  // 地面从首帧即存在，裂口和地面纹理使用同一平面。
  const floor = layer(root, 'ground');
  sk.line(floor, [[90, 1160], [210, 1158], [530, 1163], [970, 1160]], 8401, { stroke: '#888379', strokeWidth: 3 }).all(1);
  for (let i = 0; i < 7; i++) sk.line(floor, [[110 + i * 120, 1215 + i % 2 * 20], [152 + i * 120, 1210 + i % 2 * 20]], 8402 + i, { stroke: '#bab4a8', strokeWidth: 2.5 }).all(1);

  const machine = layer(root, 'ai-machine');
  const chassis = layer(machine, 'machine-body');
  el('path', { d: rrectPath(598, 535, 352, 440, 37), fill: '#37352e', opacity: .1, transform: 'translate(9,12)' }, chassis);
  sk.rrect(chassis, 598, 535, 352, 440, 37, 8500, { fill: '#d8d5cc', fillStyle: 'hachure', hachureGap: 12, fillWeight: 3, strokeWidth: 5 }).all(1);
  sk.rrect(chassis, 629, 579, 290, 234, 24, 8501, { fill: PAPER, fillStyle: 'solid', strokeWidth: 4 }).all(1);
  text(chassis, 774, 735, 'AI', { size: 142, font: 'en', anchor: 'middle', weight: 2.5 });
  sk.rrect(chassis, 668, 854, 210, 38, 10, 8502, { fill: '#4d4a43', fillStyle: 'solid', strokeWidth: 3 }).all(1);
  const scan = c.brollMode ? el('rect', { x: 650, y: 599, width: 244, height: 5, rx: 2.5, fill: '#908d83', opacity: .32 }, chassis) : null;
  const light = el('circle', { cx: 643, cy: 938, r: 9, fill: '#dfb943' }, chassis);
  for (let i = 0; i < 3; i++) sk.line(chassis, [[846 + i * 22, 922], [846 + i * 22, 947]], 8503 + i, { stroke: '#79756c', strokeWidth: 3 }).all(1);
  sk.line(machine, [[676, 979], [676, 1115], [863, 1115], [863, 979]], 8507, { strokeWidth: 4 }).all(1);

  const cardA = documentCard(root, c.sc.outputs[0].text, 8600, sk);
  const cardB = documentCard(root, c.sc.outputs[1].text, 8610, sk);
  const note = layer(root, 'flying-note');
  const nd = 'M-112,-61 L-58,-74 L-11,-63 L42,-75 L115,-59 L105,-8 L116,61 L59,73 L4,61 L-54,76 L-116,58 L-108,5 Z';
  el('path', { d: nd, fill: '#3c3930', opacity: .12, transform: 'translate(6,8)' }, note);
  el('path', { d: nd, fill: PAPER, stroke: 'white', 'stroke-width': 8 }, note);
  sk.path(note, nd, 8650, { fill: '#e9e2d5', fillStyle: 'hachure', hachureGap: 16, fillWeight: 1.5, strokeWidth: 3 }).all(1);
  text(note, 0, -8, c.sc.note.title, { size: 42, anchor: 'middle', weight: 1 });
  text(note, 0, 38, c.sc.note.sub, { size: 29, anchor: 'middle', color: '#6d6961' });
  const flight = sk.curve(root, [[446, 864], [498, 644], [644, 652], [770, 870]], 8651, { stroke: '#9b968b', strokeWidth: 2.5 });

  const cracksG = layer(root, 'cracks');
  const cracks = [sk.line(cracksG, [[128, 1160], [193, 1148], [235, 1173], [290, 1152], [338, 1170], [406, 1146], [478, 1163]], 8700, { strokeWidth: 5 }),
    sk.line(cracksG, [[232, 1171], [220, 1204], [255, 1217]], 8701, { strokeWidth: 4 }),
    sk.line(cracksG, [[400, 1148], [430, 1124], [417, 1106]], 8702, { strokeWidth: 4 })];
  const pit = layer(root, 'pit');
  // 淡纸排线覆在深色孔洞上。坑口和贴纸共用唯一品牌焦点色。
  const hole = sk.ellipse(pit, 297, 1160, 463, 126, 8710, { fill: '#302f2b', fillStyle: 'solid', stroke: BLUE, strokeWidth: 8 });
  const shadow = sk.ellipse(pit, 297, 1160, 426, 100, 8711, { fill: '#77746a', fillStyle: 'hachure', hachureGap: 9, fillWeight: 2, stroke: '#39372e', strokeWidth: 1 });

  const clipId = `trap-actor-${c.si}`;
  const clip = el('rect', { x: 0, y: 0, width: 1080, height: 1440 }, el('clipPath', { id: clipId, clipPathUnits: 'userSpaceOnUse' }, el('defs', {}, root)));
  const actorLayer = el('g', { 'clip-path': `url(#${clipId})` }, root);
  const yazai = actor(actorLayer, 5100 + c.si, c.brollMode);
  const sparks = layer(root, 'magic');
  const rays: Sketch[] = [];
  for (let i = 0; i < 4; i++) {
    const a = -2.7 + i * .78, x = c.brollMode ? 490 : 446, y = 852;
    rays.push(sk.line(sparks, [[x + Math.cos(a) * 36, y + Math.sin(a) * 36], [x + Math.cos(a) * 68, y + Math.sin(a) * 68]], 8750 + i, { strokeWidth: 4 }));
  }
  for (const [i, x, y] of [[0, 466, 773], [1, 533, 831]]) {
    const star = `M${x},${y-9} L${x+3},${y-2} L${x+10},${y} L${x+3},${y+3} L${x},${y+10} L${x-3},${y+3} L${x-10},${y} L${x-3},${y-2} Z`;
    rays.push(sk.path(sparks, star, 8760 + i, { fill: '#d8bb69', fillStyle: 'solid', strokeWidth: 2 }));
  }
  const pitFront = sk.curve(root, [[69,1164],[151,1207],[298,1225],[440,1207],[523,1163]], 8770, { stroke: BLUE, strokeWidth: 7 });
  const pitLabel = label(root, c.sc.pit.text, 350, 108, 64, true, sk);

  const emitCard = (g: Element, t: number, on: number, x: number, y: number, tilt: number) => {
    const p = prog(t, on, .4), e = ease.outCubic(p), k = popScale(t, on, .4, 1.1);
    const wobble = t >= crackOn ? Math.sin((t - crackOn) * 15) * 2.2 * Math.min(1, (t - crackOn) / .25) : 0;
    setO(g, t > on ? 1 : 0);
    setT(g, lerp(774, x, e), lerp(725, y, e) - 65 * Math.sin(Math.PI * p), Math.max(.001, k), tilt + wobble);
  };
  c.add({ g: root, t0: c.S, end: c.S1, mode: 'now', em: false, update(t) {
    if (c.brollMode) {
      arrival(machine, t, c.S, 2/30, .5, 774, 1115);
      if (scan) scan.setAttribute('y', String(605 + 174 * (.5 - .5 * Math.cos((t - c.S) * Math.PI * 2 / 1.6))));
    }
    const breath = .006 * Math.sin((t - c.S) * 2.4);
    const receipt = prog(t, noteOn + .36, .24), shake = Math.sin(receipt * Math.PI * 5) * 8 * (1 - receipt);
    setT(chassis, shake, 0, 1 + breath, 0, 774, 955); setO(light, .65 + .3 * Math.sin((t - c.S) * 2.4));
    const raise = ease.outCubic(prog(t, magic, .3)) * (1 - ease.inOutCubic(prog(t, noteOn + .12, .38)));
    const drop = ease.inOutCubic(prog(t, fallOn, .30));
    const alive = life(t, c.S);
    // cue 间的视线引导：先看 AI 接纸，再看上方输出，最后转回脚下裂缝。
    const gaze = keyframes(t, [[c.S, 0], [magic, 4], [noteOn + .3, 5], [first + .25, -3], [second, 3], [crackOn + .25, 1], [pitOn, -4]]);
    yazai.pose({ x: 294, y: 1140 + 250 * drop - 8 * Math.sin(Math.PI * prog(t, magic, .48)) + (c.brollMode ? alive.lift : 0), scale: c.brollMode ? alive.scale : HEIGHT_SCALE,
      stretchX: c.brollMode ? alive.stretchX : 1, stretchY: c.brollMode ? alive.stretchY : 1,
      armR: -108 * raise, headRot: drop ? 0 : c.brollMode ? gaze - 2 * raise : -2 * raise });
    clip.setAttribute('height', t >= pitOn ? '1167' : '1440');
    const f = t >= fallOn ? 'surprise' : t >= magic && t < crackOn ? 'excited' : null;
    face(yazai, f, t, f === 'surprise' ? fallOn : magic);
    if (c.brollMode) yazai.blink(t, c.S);
    yazai.root.setAttribute('data-drop', drop.toFixed(4));
    draw(rays, t, magic, .35); setO(sparks, 1 - prog(t, noteOn, .25));
    const p = prog(t, noteOn, .4), x = lerp(446, 774, p), y = lerp(864, 872, p) - 225 * Math.sin(Math.PI * p);
    setO(note, t >= noteOn && p < 1 ? 1 : 0); setT(note, x, y, lerp(1, .18, prog(p, .7, .3)), -15 + 39 * p);
    flight.all(prog(t, noteOn, .4)); setO(flight.g, t >= noteOn && t < noteOn + .5 ? .7 * (1 - prog(t, noteOn + .35, .15)) : 0);
    emitCard(cardA, t, first, 589, 331, -6); emitCard(cardB, t, second, 814, 433, 7);
    draw(cracks, t, crackOn, .4); setO(cracksG, 1 - prog(t, pitOn, .2));
    const opening = ease.outCubic(prog(t, pitOn, .35));
    setO(pit, t > pitOn ? 1 : 0); pit.setAttribute('transform', `translate(297 1160) scale(1 ${Math.max(.001, opening)}) translate(-297 -1160)`);
    hole.all(prog(t, pitOn, .35)); shadow.all(prog(t, pitOn, .35)); pitFront.all(prog(t, pitOn, .35));
    pop(pitLabel, t, pitOn, 751, 1104, -4);
  }});
  return 'corner' as const;
}

export function clones(c: MetaphorContext) {
  const sk = c.brollMode ? cleanSketch : defaultSketch;
  const people = cue(c, c.sc.buttons, '四个按钮依次按下');
  const generate = cue(c, c.sc.boxes, '六个相同塑料盒');
  const plastic = cue(c, c.sc.product, '塑料产物标签');
  const same = cue(c, c.sc.same, '同质化与等号');
  const awkward = cue(c, c.sc.same, '芽仔尴尬观察', 'face', LEAD.face);
  const discard = cue(c, c.sc.trash, '盒子滑入垃圾桶');
  const root = layer(c.g, 'clones-world'); c.g.setAttribute('data-local-yazai', '1');
  // 开场已有按钮、传送带、桶的淡轮廓和完整芽仔。
  const conveyor = layer(root, 'conveyor');
  sk.rrect(conveyor, 373, 921, 546, 111, 39, 9000, { fill: '#dedad1', fillStyle: 'hachure', hachureGap: 14, strokeWidth: 4.5 }).all(1);
  sk.rrect(conveyor, 392, 940, 508, 72, 29, 9001, { fill: PAPER, fillStyle: 'solid', strokeWidth: 3 }).all(1);
const rollers: SVGGElement[] = [];
  for (let i = 0; i < 9; i++) {
    const wheel = layer(conveyor, `roller-${i}`), x = 418 + i * 56;
    sk.circle(wheel, x, 976, 36, 9010 + i, { fill: '#cac6bc', fillStyle: 'hachure', hachureGap: 8, strokeWidth: 2.5 }).all(1);
    if (c.brollMode) sk.line(wheel, [[x - 12, 976], [x + 12, 976]], 9250 + i, { stroke: '#807d75', strokeWidth: 2.5 }).all(1);
    rollers.push(wheel);
  }
  sk.line(conveyor, [[418, 1036], [418, 1105], [474, 1105]], 9020, { strokeWidth: 4 }).all(1);
  sk.line(conveyor, [[762, 1036], [762, 1105], [706, 1105]], 9021, { strokeWidth: 4 }).all(1);
  const belts = Array.from({ length: 12 }, (_, i) => sk.line(conveyor, [[410 + i * 40, 921], [425 + i * 40, 921]], 9030 + i, { strokeWidth: 3 }));

  const links: Sketch[] = [];
  const buttons = Array.from({ length: 4 }, (_, i) => {
    const x = 437 + i * 139, g = layer(root, `button-${i}`);
    sk.rrect(g, -55, -38, 110, 94, 15, 9050 + i, { fill: '#d7d4cd', fillStyle: 'hachure', hachureGap: 11, strokeWidth: 3.5 }).all(1);
    const cap = layer(g, 'button-cap');
    sk.ellipse(cap, 0, -7, 76, 40, 9060 + i, { fill: '#e8e5dd', fillStyle: 'solid', strokeWidth: 3 }).all(1);
    const lit = sk.ellipse(cap, 0, -7, 61, 27, 9070 + i, { fill: '#debf69', fillStyle: 'hachure', hachureGap: 5, strokeWidth: 0 });
    setT(g, x, 498, 1, i % 2 ? 2 : -2);
    links.push(sk.curve(root, [[x, 558], [x, 609], [650, 630], [650, 752]], 9080 + i, { stroke: '#a49f94', strokeWidth: 2.5 }));
    return { g, cap, lit };
  });
  // 输入管和吐出口，让“按钮→传送带”的因果可见。
  sk.path(root, 'M605,755 L695,755 L713,887 L587,887 Z', 9090, { fill: '#ddd8cd', fillStyle: 'hachure', hachureGap: 12, strokeWidth: 4 }).all(1);
  sk.rrect(root, 594, 859, 112, 30, 8, 9091, { fill: '#49463f', fillStyle: 'solid', strokeWidth: 3 }).all(1);

  const boxRow = layer(root, 'six-identical-boxes');
  const boxes = Array.from({ length: 6 }, (_, i) => {
    const g = layer(boxRow, `clone-${i}`);
    // 故意复用同一个 seed、颜色、标签与尺寸，六个盒子完全相同。
    el('path', { d: rrectPath(-35, -42, 70, 84, 10), fill: '#dedbd4' }, g);
    sk.rrect(g, -35, -42, 70, 84, 10, 9100, { fill: GRAY, fillStyle: 'hachure', hachureGap: 8, fillWeight: 2.3, strokeWidth: 3 }).all(1);
    sk.line(g, [[-31, -18], [30, -18]], 9101, { strokeWidth: 2 }).all(1);
    el('rect', { x: -27, y: -8, width: 54, height: 35, rx: 5, fill: PAPER, stroke: 'white', 'stroke-width': 2 }, g);
    text(g, 0, 18, 'AI', { size: 28, font: 'en', anchor: 'middle', weight: .7 });
    return g;
  });
  const equals = Array.from({ length: 5 }, (_, i) => {
    const x = 473 + i * 90;
    return [sk.line(root, [[x-8, 829], [x+8, 829]], 9140 + i * 2, { strokeWidth: 3.5 }), sk.line(root, [[x-8, 840], [x+8, 840]], 9141 + i * 2, { strokeWidth: 3.5 })];
  });
  const product = label(root, c.sc.product.text, 248, 67, 39, false, sk);
  const sameness = label(root, c.sc.same.text, 367, 121, 79, true, sk);

  const bin = layer(root, 'trash-bin');
  const binFill = el('path', { d: 'M786,1080 L918,1080 L902,1230 Q850,1250 803,1230 Z', fill: PAPER }, bin);
  const binBody = sk.path(bin, 'M786,1080 L918,1080 L902,1230 Q850,1250 803,1230 Z', 9180, { fill: '#d2cdc1', fillStyle: 'hachure', hachureGap: 12, strokeWidth: 5 });
  const binLines = [binBody];
  for (let i = 0; i < 3; i++) binLines.push(sk.line(bin, [[817+i*31,1105],[824+i*26,1209]],9181+i,{strokeWidth:3}));
  const lid = layer(bin, 'bin-lid');
  const lidInk = sk.path(lid, 'M773,1074 L930,1074 L919,1056 L786,1056 Z M829,1054 L829,1038 L876,1038 L876,1054', 9185, { fill: '#c6c1b7', fillStyle: 'solid', strokeWidth: 4 });
  const y = actor(root, 5200 + c.si, c.brollMode);

  c.add({ g: root, t0: c.S, end: c.S1, mode: 'now', em: false, update(t) {
    const alive = life(t, c.S);
    if (c.brollMode) {
      arrival(conveyor, t, c.S, 3/30, .5, 646, 1105);
      arrival(bin, t, c.S, 6/30, 14/30, 850, 1240);
      rollers.forEach((r, i) => setT(r, 0, 0, 1, (t - c.S) * 150, 418 + i * 56, 976));
    }
    buttons.forEach((b, i) => {
      const on = people + i * .1, press = Math.sin(Math.PI * prog(t, on, .25));
      if (c.brollMode) {
        const p = prog(t, c.S + (2 + i * 2)/30, 10/30);
        setT(b.g, 437 + i * 139, 498 + 16 * (1 - p), .7 + .3 * ease.outBack(p, 1.2), i % 2 ? 2 : -2);
        setO(b.g, .2 + .8 * p);
      }
      setT(b.cap, 0, 9 * press); b.lit.all(prog(t, on, .1));
    });
    draw(links, t, people, .4);
    const moving = c.brollMode || t >= generate && t < discard + .35;
    belts.forEach((l, i) => { l.all(1); setT(l.g, moving ? ((t - (c.brollMode ? c.S : generate)) * 65) % 32 : 0, 0); });
    const sweep = ease.inOutCubic(prog(t, discard, .35));
    boxes.forEach((b, i) => {
      const on = generate + i * .08, p = prog(t, on, .32), e = ease.outCubic(p);
      const x = lerp(650, 428 + i * 90, e), yy = lerp(878, 835, e) - 72 * Math.sin(Math.PI * p);
      setO(b, t > on && sweep < 1 ? 1 : 0);
      setT(b, lerp(x, 852, sweep), lerp(yy, 1110, sweep), Math.max(.001, popScale(t, on, .32, 1.12) * (1 - .7 * sweep)), -8 * sweep);
      b.setAttribute('data-discard-progress', sweep.toFixed(4));
    });
    equals.forEach(ls => { draw(ls, t, same, .3); ls.forEach(l => setO(l.g, 1 - prog(t, discard, .12))); });
    pop(product, t, plastic, 646, 690, -3);
    pop(sameness, t, same, 632, 291, -4);
    // 淡线从首帧可见；垃圾 cue 处描成实线，盖子先打开再落下回弹。
    setO(binFill, .2 + .8 * prog(t, discard, .3));
    binLines.forEach(l => { l.all(1); setO(l.g, .2 + .8 * prog(t, discard, .3)); });
    lidInk.all(1); setO(lid, .2 + .8 * prog(t, discard, .3));
    const a = t < discard ? 0 : t < discard + .12 ? -48 * ease.outCubic(prog(t, discard, .12)) : -48 * (1 - ease.inOutCubic(prog(t, discard + .12, .2)));
    const bounce = t >= discard + .32 ? -10 * Math.sin(Math.PI * prog(t, discard + .32, .16)) : 0;
    setT(lid, 0, 0, 1, a + bounce, 785, 1065);
    const watch = prog(t, awkward, .25);
    const scan = t >= generate && t < awkward ? 3 * Math.sin((t - generate) * 3.2) : 0;
    y.pose({ x: 218, y: 1210 + (c.brollMode ? alive.lift : 0), scale: c.brollMode ? alive.scale : HEIGHT_SCALE,
      stretchX: c.brollMode ? alive.stretchX : 1, stretchY: c.brollMode ? alive.stretchY : 1,
      headRot: -5 * watch + scan + (c.brollMode ? lerp(4, -3, ease.inOutCubic(prog(t, people + .35, Math.max(.3, generate - people - .35)))) * (1 - watch) : 0), armR: -12 * watch });
    face(y, t >= awkward ? 'awkward' : null, t, awkward);
    if (c.brollMode) y.blink(t, c.S);
  }});
  return 'corner' as const;
}
