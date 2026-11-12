// 音画同步：画面由配音的逐字时间驱动，动画按"提前量"启动，让动作最用力的那一下落在词刚出口时。
//
// 依据（参考片 0–18s，人声包络 + whisper 逐字时间实测）：
//   "?" 弹出 vs "问"：同时；字幕② vs "如果"：早 0.05s；字幕③ vs "还能"：早 0.2s；字幕⑤ vs "2026"：早 0.04s；
//   字标放大 / "× AI" vs "OKX"：同时；时钟 vs "几分钟"：同时。
//   反例：三个能力图标按固定 0.75s 节奏排，比"干活/收钱/付账"早 0.67→1.03s，越排越超前——不照抄。
// 广电标准 ITU-R BT.1359：画面先于声音 ≤~125ms 不易察觉，声音先于画面 >45ms 就会被察觉。
// 用户要求"口播和动画信息一起出现"：画面与词同时冒出（只提前 1–2 帧抵消弹出起步），不再明显抢先。
export const LEAD = {
  subtitle: 0.05, // 字幕：句子开口时切换
  pop: 0.06, // 弹出（图标、标签、问号）：开口那一刻已冲出一半
  draw: 0.16, // 箭头描线：0.1s 画完，紧接着图标与词同时弹出
  type: 0.05, // 逐字出现：与读到的字同时
  emphasis: 0.1, // 放大/强调：峰值略晚于开口，落在词里
  transition: 0.2, // 转场清场：新一句开口前
  face: 0.06, // 像素表情亮起：与情绪词同时
};

export interface Word {
  w: string;
  s: number;
  e: number;
}
export interface Sentence {
  text: string;
  start: number;
  end: number;
  from: number;
  to: number;
}
export interface Voice {
  end: number;
  words: Word[];
  sentences: Sentence[];
}

const norm = (s: string) => [...s].filter((c) => /[\p{L}\p{N}]/u.test(c)).join("");

/** 口播时钟：按句、按关键词取开口时刻；找不到关键词直接报错（分镜写错了要早发现） */
export class Cues {
  events: { kind: string; label: string; cue: string; voice: number; t: number }[] = [];
  constructor(public v: Voice) {}

  sentence(i: number) {
    const s = this.v.sentences[i];
    if (!s) throw new Error(`没有第 ${i + 1} 句`);
    return s;
  }

  /** 第 i 句里关键词的开口时刻；nth 为第几次出现 */
  word(i: number, key: string, nth = 0): Word {
    const s = this.sentence(i);
    const ws = this.v.words.slice(s.from, s.to);
    const k = norm(key);
    const flat = ws.map((w) => norm(w.w)).join("");
    let idx = -1;
    for (let n = 0; n <= nth; n++) idx = flat.indexOf(k, idx + 1);
    if (idx < 0) throw new Error(`第 ${i + 1} 句「${s.text}」里找不到「${key}」`);
    let pos = 0;
    for (const w of ws) {
      const len = norm(w.w).length;
      if (pos + len > idx) return w;
      pos += len;
    }
    throw new Error(`定位失败：${key}`);
  }

  /** 逐字时刻：多字词（如 "AI"、"Jacky"）内部按字均分 */
  char(i: number, key: string, nth = 0) {
    const w = this.word(i, key, nth);
    const chars = [...norm(w.w)];
    const k = [...norm(key)];
    const off = chars.join("").indexOf(k.join(""));
    return w.s + ((w.e - w.s) * Math.max(0, off)) / Math.max(1, chars.length);
  }

  /** 记录一个画面事件并返回启动时刻（对齐帧边界）；kind 决定音效，label 进同步报告 */
  at(kind: string, label: string, cue: string, voice: number, lead: number) {
    const t = Math.round((voice - lead) * 30) / 30;
    this.events.push({ kind, label, cue, voice: +voice.toFixed(3), t: +t.toFixed(3) });
    return t;
  }
}
