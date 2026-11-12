// 时间轴核心：画面只由时间 t（秒）决定，任意 seek 都得到同一帧。

export const FPS = 30;
// 画幅：16:9（1920×1080，偏教程）或 3:4（1080×1440，偏口播）。在搭舞台前调用 setFormat
export let W = 1920;
export let H = 1080;
export let FMT: "16x9" | "3x4" = "16x9";
export function setFormat(f: string | null) {
  if (f === "3x4") {
    FMT = "3x4";
    W = 1080;
    H = 1440;
  }
}

export type Updater = (t: number) => void;

export class Timeline {
  private updaters: Updater[] = [];
  duration = 0;
  add(fn: Updater) {
    this.updaters.push(fn);
  }
  seek(t: number) {
    for (const fn of this.updaters) fn(t);
  }
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
/** t 在 [t0, t0+dur] 内的线性进度 */
export const prog = (t: number, t0: number, dur: number) => (dur <= 0 ? (t >= t0 ? 1 : 0) : clamp01((t - t0) / dur));

export const ease = {
  linear: (p: number) => p,
  outQuad: (p: number) => 1 - (1 - p) * (1 - p),
  inOutQuad: (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2),
  outCubic: (p: number) => 1 - Math.pow(1 - p, 3),
  inOutCubic: (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  /** 参考片弹出曲线：约 60% 处冲到 ~1.12，再回落到 1 */
  outBack: (p: number, s = 1.9) => 1 + (s + 1) * Math.pow(p - 1, 3) + s * Math.pow(p - 1, 2),
};

/**
 * 弹出缩放（参考片逐帧实测）：前 58% 时长 outCubic 从 0 冲到 peak(1.12)，后 42% inOutQuad 回落到 1。
 * 标准时长 0.4s：7 帧冲顶、5 帧回落。
 */
export const popScale = (t: number, t0: number, dur = 0.4, peak = 1.12) => {
  if (t < t0) return 0;
  const p = prog(t, t0, dur);
  const r = 0.583;
  return p < r ? peak * ease.outCubic(p / r) : peak - (peak - 1) * ease.inOutQuad((p - r) / (1 - r));
};

/**
 * 单次关键词强调：从正常字号放到 1.10，0.6s 内回到原大小。
 * 字的出现另用淡入，强调不会把字从 0 缩放弹出来。
 */
export const emScale = (t: number, t0: number, peak = 1.1) => {
  const a = t - t0;
  peak = Math.max(1, Math.min(1.12, peak));
  if (a < 0) return 1;
  if (a < 0.18) return 1 + (peak - 1) * ease.outCubic(a / 0.18);
  if (a < 0.3) return peak;
  return peak - (peak - 1) * ease.inOutQuad(Math.min(1, (a - 0.3) / 0.3));
};

/** 分段关键帧插值：keys = [[t, v], ...]，段内用 easing */
export function keyframes(t: number, keys: [number, number][], fn: (p: number) => number = ease.inOutCubic) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    const [t0, v0] = keys[i - 1];
    if (t <= t1) return lerp(v0, v1, fn(prog(t, t0, t1 - t0)));
  }
  return keys[keys.length - 1][1];
}

/** 8Hz 抖线的帧号（参考片每 3–4 帧重绘一次） */
export const boilIndex = (t: number) => Math.floor(t * 8 + 1e-6) % 4;

/** 可复现的伪随机 */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}
