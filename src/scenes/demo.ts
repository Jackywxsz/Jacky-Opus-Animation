// Demo：版式、运动曲线沿用参考片实测（ref/timing-0-16.json），出现时刻改由配音逐字时间驱动（src/engine/sync.ts）。
import timing from "../../ref/timing-0-16.json";
import { Timeline, prog, ease, popScale, keyframes, lerp } from "../engine/core";
import type { Stage } from "../engine/stage";
import { C, el, setT, setO, text, typeText } from "../engine/draw";
import { Yazai, type Face } from "../components/yazai";
import { Subtitles, bubble, Arrow, clapper, mic, plane, iconLabel, mark, tape, PixelWord, clock, Confetti } from "../components/parts";
import { Cues, LEAD, type Voice } from "../engine/sync";

const R = timing; // 参考片的运动参数（时长、曲线形状），不再用它的绝对时刻

export const narration = [
  { zh: "先考你一个问题：", en: "Pop quiz:" },
  { zh: "如果AI不只会帮你写稿子，", en: "what if AI did more than write your drafts," },
  { zh: "还能自己剪片、自己配音、自己发布，", en: "and could edit, voice, and publish on its own —" },
  { zh: "那会是什么体验？", en: "what would that feel like?" },
  { zh: "2026年，Jacky把这件事做成了。", en: "In 2026, Jacky made it real." },
  { zh: "接下来几分钟，带你看完Jacky的AI创作工具箱！", en: "Here's Jacky's whole AI creator toolkit, in just a few minutes!" },
];

export function buildDemo(stage: Stage, voice: Voice): { tl: Timeline; cues: Cues } {
  const tl = new Timeline();
  const cue = new Cues(voice);
  tl.duration = voice.end;
  const ink = stage.ink;
  const S = (i: number) => cue.sentence(i);
  const W = (i: number, k: string, n = 0) => cue.word(i, k, n).s;

  // ---------- 时刻表（全部由口播推出）----------
  const build0 = R.build.start; // 芽仔在开口前组装完
  const subT = narration.map((_, i) => cue.at("sub", `字幕${i + 1}`, "句首", S(i).start, LEAD.subtitle));
  const qT = cue.at("q", "问号 ?", "问题", W(0, "问题"), LEAD.pop);
  const bubT = cue.at("bubble", "气泡「帮我写个稿？」", "帮你写", W(1, "帮"), LEAD.pop);
  const strikeT = cue.at("strike", "红线划掉 + 不止!", "还能", S(2).start, 0.12);
  const keys = ["剪片", "配音", "发布"];
  const itemT = keys.map((k, i) => ({
    arrow: cue.at("arrow", `箭头${i + 1}`, k, W(2, k), LEAD.draw),
    icon: cue.at("icon", `图标「${k}」`, k, W(2, k), LEAD.pop),
  }));
  const qxT = cue.at("surprise", "?! + 歪头", "什么", W(3, "什么"), LEAD.pop);
  const untiltT = S(3).end + 0.3;
  const clearT = cue.at("transition", "转场（清场 + 芽仔让位）", "句首", S(4).start, LEAD.transition);
  const tagT = cue.at("tag", "胶带「2026」", "2026", W(4, "2026"), LEAD.pop);
  const wordT = cue.at("blocks", "像素字标 JACKY", "Jacky", W(4, "Jacky"), LEAD.pop);
  const doneT = W(4, "做成");
  const xaiT = cue.at("xai", "× AI + 字标放大", "做成了", doneT, LEAD.pop);
  const pulses = [cue.at("pulse", "字标放大", "做成了", doneT, LEAD.emphasis), cue.at("pulse", "字标再放大", "Jacky", W(5, "Jacky"), LEAD.emphasis)];
  const clockT = cue.at("clock", "时钟 let's go!", "几分钟", W(5, "几分钟"), LEAD.pop);
  const titleChars = ["A", "I", "工", "具", "箱"];
  const charT = titleChars.map((c) => cue.at("char", `标题「${c}」`, c, c === "A" || c === "I" ? cue.char(5, c) : W(5, c), LEAD.type));
  const enT = charT[4] + 0.15;
  const burstT = cue.at("burst", "彩纸 + 跳起", "箱", W(5, "箱"), 0.03);
  const armT = burstT - 0.13;
  const waveT = voice.end - 0.9;
  // 像素表情：只在情绪句亮起
  const moods: { face: Face; on: number; off: number }[] = [
    { face: "surprise", on: cue.at("face", "表情：惊讶", "什么", W(3, "什么"), LEAD.face), off: S(3).end + 0.35 },
    { face: "happy", on: cue.at("face", "表情：开心", "做成了", doneT, LEAD.face), off: S(4).end + 0.3 },
    { face: "excited", on: cue.at("face", "表情：兴奋", "工具箱", W(5, "工具"), LEAD.face), off: voice.end + 1 },
  ];

  // ---------- 第一幕：芽仔 + 问题 ----------
  const intro = el("g", {}, ink);
  const q = mark(intro, 1172, 305, "?", { size: 200, font: "en", weight: 3.5, anchor: "middle" });
  const bub = bubble(intro, 232, 243, 371, 155, [492, 540, 572, 462], "帮我写个稿？", "just drafting", 301);
  const strikeG = el("g", {}, intro);
  const strike = el("path", { d: "M480,272 C540,262 610,252 675,242", stroke: C.red, "stroke-width": 10, "stroke-linecap": "round", fill: "none", pathLength: 1, "stroke-dasharray": "1 1" }, strikeG);
  const note = mark(intro, 515, 222, "不止!", { size: 48, font: "zh", color: C.red, weight: 1.4 });
  const arrows = [
    new Arrow(intro, [[1132, 432], [1178, 370], [1232, 287]], 401),
    new Arrow(intro, [[1134, 500], [1244, 518], [1352, 540]], 411, false),
    new Arrow(intro, [[1132, 566], [1192, 662], [1228, 800]], 421),
  ];
  const items = [
    iconLabel(intro, (g) => clapper(g, 1245, 232, 501), 1448, 285, "剪片", "Edit"),
    iconLabel(intro, (g) => mic(g, 1435, 540, 511), 1572, 545, "配音", "Voice"),
    iconLabel(intro, (g) => plane(g, 1252, 762, 521), 1448, 808, "发布", "Publish"),
  ];
  const itemCenters: [number, number][] = [[1310, 278], [1435, 542], [1312, 802]];
  const qx = mark(intro, 775, 300, "?!", { size: 150, font: "en", color: C.red, weight: 3.2 });

  // ---------- 第二幕：标题 ----------
  const title = el("g", {}, ink);
  const tag = tape(title, 232, 210, 236, 114, "2026", 601);
  const word = new PixelWord(title, "JACKY", 378, 368, 30, 700);
  const wordCx = 378 + word.width / 2;
  const xai = el("g", {}, title);
  mark(xai, 1010, 462, "×", { size: 74, font: "en", color: C.green, weight: 2.4, anchor: "middle" });
  text(xai, 1048, 478, "AI", { size: 156, font: "en", color: C.green, weight: 3.4, italic: true, condense: 1 });
  const big = typeText(title, 400, 712, "AI 工具箱", { size: 104, font: "zh", weight: 3.2 });
  const bigCharT = [charT[0], charT[1], charT[1], charT[2], charT[3], charT[4]]; // 空格跟随 I
  const bigEn = text(title, 428, 792, "the whole AI toolkit", { size: 58, font: "en", color: C.gray, weight: 0.8 });
  const clockG = el("g", {}, title);
  clock(clockG, 1625, 237, 801);
  mark(clockG, 1548, 366, "let's go!", { size: 46, font: "en", weight: 1.3 }).setAttribute("transform", "rotate(6 1610 350)");

  // 字标拼出：沿用参考片的墨迹增长曲线形状，平移到“Jacky”开口前
  const c0 = R.transition.blocksCurve[0][0];
  const blocksCurve = R.transition.blocksCurve.map(([t, f]) => [t - c0 + wordT, f] as [number, number]);

  const yz = new Yazai(stage.top, 100);
  const confetti = new Confetti(ink, 1493, 560, 46, 77);
  const subs = new Subtitles(stage.hud, narration.map((n, i) => ({ t: subT[i], ...n })), voice.end + 1);

  tl.add((t) => {
    stage.setBoil(t);
    stage.setCamera(t > clearT ? R.transition.drift * (t - clearT) : 0, 0, 1);

    // ----- 第一幕 -----
    setO(intro, 1 - prog(t, clearT, R.transition.clearDur));
    const qs = popScale(t, qT);
    setO(q, qs > 0 ? 1 - prog(t, bubT, R.qmark.outDur) : 0);
    setT(q, 0, 0, Math.max(qs, 0.001), qs > 0 ? 9 * Math.sin((t - qT) * 2 * Math.PI * 1.4) : 0, 1172, 240);

    const bs = popScale(t, bubT);
    setO(bub.g, bs > 0 ? lerp(1, 0.42, prog(t, strikeT + 0.13, R.strike.dimDur)) : 0);
    setT(bub.g, 0, 0, Math.max(bs, 0.001), 0, 418, 320);
    const sp = prog(t, strikeT, R.strike.drawDur);
    strike.setAttribute("stroke-dashoffset", String(1 - sp));
    setO(strikeG, sp > 0 ? 1 : 0);
    const np = prog(t, strikeT + 0.23, R.strike.noteDur);
    setO(note, np);
    setT(note, 0, 0, lerp(0.7, 1, ease.outBack(np)), -8, 560, 205);

    itemT.forEach((it, i) => {
      arrows[i].draw(prog(t, it.arrow, 0.1));
      const s = popScale(t, it.icon);
      setO(items[i].g, s > 0 ? 1 : 0);
      setT(items[i].icon, 0, 0, Math.max(s, 0.001), 0, ...itemCenters[i]);
      const lp = prog(t, it.icon, 0.13);
      setO(items[i].zh, lp);
      setO(items[i].en, lp);
    });

    const xs = popScale(t, qxT);
    setO(qx, xs > 0 ? 1 : 0);
    setT(qx, 0, 0, Math.max(xs, 0.001), 14 + 4 * Math.sin((t - qxT) * 2 * Math.PI * 1.1), 828, 250);

    // ----- 第二幕 -----
    word.build(t, blocksCurve);
    const pulse = Math.max(...pulses.map((p) => keyframes(t, [[p, 1], [p + 0.167, 1.075], [p + 0.433, 1]])));
    setT(word.g, 0, 0, pulse, 0, wordCx, 443);
    const ts = popScale(t, tagT, R.transition.tagDur);
    setO(tag, ts > 0 ? 1 : 0);
    setT(tag, 0, 0, Math.max(ts, 0.001), -4, 350, 267);
    const x2 = popScale(t, xaiT);
    setO(xai, x2 > 0 ? 1 : 0);
    setT(xai, 0, 0, Math.max(x2, 0.001), 0, 1100, 430);
    big.chars.forEach((c, i) => c.setAttribute("opacity", prog(t, bigCharT[i], 0.05).toFixed(2)));
    setO(bigEn, prog(t, enT, R.title.enDur));
    const cs = popScale(t, clockT);
    setO(clockG, cs > 0 ? 1 : 0);
    setT(clockG, 0, 0, Math.max(cs, 0.001), 0, 1620, 280);
    confetti.update(t, burstT);
    setO(confetti.g, t >= burstT ? 1 : 0);

    // ----- 芽仔 -----
    yz.build(t, build0);
    const idleX = 5 * Math.sin((2 * Math.PI * t) / 6.3 + 0.7) + 2 * Math.sin((2 * Math.PI * t) / 2.9);
    const bob = t > 1.5 ? 5 * Math.sin((2 * Math.PI * t) / 1.9) : 0;
    const float = t < 1.5 ? 0 : 22 * (1 - Math.cos((2 * Math.PI * (t - 1.5)) / 20));
    const qOut = bubT;
    const lean = keyframes(t, [[qT, 0], [qT + 0.4, -9], [qOut, -9], [qOut + 0.2, 0]]);
    const tilt = keyframes(t, [[qxT + 0.07, 0], [qxT + 0.17, 1], [untiltT, 1], [untiltT + 0.2, 0]]);
    const mv = ease.inOutCubic(prog(t, clearT, R.transition.moveDur));
    const jump = keyframes(t, [[burstT, 0], [burstT + 0.17, -44], [burstT + 0.47, 0]], ease.inOutQuad);
    const x = lerp(957 + idleX + lean + 11 * tilt, 1493 + idleX * 0.6, mv);
    const y = lerp(754 + float + bob, 790 + bob * 0.7 + jump, mv);
    const armUp = keyframes(t, [[armT, 0], [armT + 0.13, 1], [burstT + 0.9, 1], [burstT + 1.1, 0], [waveT, 0], [waveT + 0.15, 0.85]]);
    const wave = armUp > 0 ? 14 * Math.sin((t - armT) * 2 * Math.PI * 2.6) : 0;
    const shake = (at0: number, dur: number, amp: number, hz: number) => (t >= at0 && t < at0 + dur ? amp * Math.sin((t - at0) * 2 * Math.PI * hz) * (1 - (t - at0) / dur) : 0);
    yz.pose({
      x: x + shake(burstT, 0.9, 3, 9),
      y,
      scale: lerp(0.96, 0.715, mv),
      rot: 1.2 * Math.sin((2 * Math.PI * t) / 4.4),
      headRot: 11 * tilt,
      armR: -128 * armUp + wave,
      sprout: 4 * Math.sin((2 * Math.PI * t) / 1.7) + shake(qxT, 0.5, 14, 6) + shake(doneT - 0.1, 0.5, 10, 5),
    });
    const m = moods.find((mm) => t >= mm.on && t < mm.off + 0.12);
    yz.setFace(m ? m.face : null, m ? (t < m.off ? prog(t, m.on, 0.15) : 1 - prog(t, m.off, 0.12)) : 0, !m || t < m.off);

    subs.update(t);
  });

  return { tl, cues: cue };
}
