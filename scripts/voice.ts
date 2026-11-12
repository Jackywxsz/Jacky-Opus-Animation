// 配音：火山引擎豆包语音合成（V3 单向流式，逐字时间戳），按时间点放置到时间轴上。
// 用法：pnpm voice <项目名> [--force]
//       pnpm voice <项目名> --external <words.json>（只导入绝对时间，不读取凭据、不请求 TTS）
//   读 projects/<项目名>/voice.json：
//     { "sentences": [ { "text": "…", "at": 2.3, "anchors": { "配音": 7.15 } } ], "maxTempo": 1.35, "end": 18 }
//   每句整句合成（语气自然），再在锚点词处切开，让锚点词在指定时刻开口；某段放不下时轻微提速（≤ maxTempo）。
//   没写 at 的句子紧跟上一句（间隔 gap，默认 0.25s）；写了 align 时让该词在 at 时刻开口。
//   输出 voice/narration.wav + voice/words.json（逐字绝对时间）。
// 凭据仅来自当前工程 .env.local 或调用者设置的环境变量。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

const ENDPOINT = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
const root = path.resolve(import.meta.dirname, "..");

// 外部真人时钟必须在凭据读取、缓存和任何 TTS 请求之前返回。
const externalArgs = process.argv.slice(2);
if (externalArgs.includes("--external")) {
  const i = externalArgs.indexOf("--external");
  const input = externalArgs[i + 1];
  const projectName = externalArgs.find((a, j) => !a.startsWith("--") && j !== i + 1);
  if (!input || input.startsWith("--") || !projectName) throw new Error("用法：pnpm voice <项目名> --external <words.json>");
  const projectDir = path.join(root, "projects", projectName);
  const sb = JSON.parse(fs.readFileSync(path.join(projectDir, "storyboard.json"), "utf8")) as { lines: { zh: string }[] };
  const external = JSON.parse(fs.readFileSync(path.resolve(input), "utf8")) as {
    end: number; chars: { c: string; t: number }[];
    words: { w: string; s: number; e: number }[]; sentences: unknown[];
  };
  const normalize = (s: string) => [...s].filter((c) => /[\p{L}\p{N}]/u.test(c)).join("").toLowerCase();
  if (!Number.isFinite(external.end) || external.end <= 0 || !Array.isArray(external.chars) || !external.chars.length || !Array.isArray(external.words) || !external.words.length || !Array.isArray(external.sentences)) throw new Error("外部时间需要有效 end / chars / words / sentences");
  external.chars.forEach((c, j) => {
    if (typeof c.c !== "string" || [...c.c].length !== 1 || !normalize(c.c) || !Number.isFinite(c.t) || c.t < 0 || c.t > external.end || (j && c.t < external.chars[j - 1].t)) throw new Error(`外部 chars[${j}] 非法或时间倒序`);
  });
  external.words.forEach((w, j) => {
    if (typeof w.w !== "string" || !Number.isFinite(w.s) || !Number.isFinite(w.e) || w.s < 0 || w.e < w.s || w.e > external.end || (j && w.s < external.words[j - 1].s)) throw new Error(`外部 words[${j}] 非法或时间倒序`);
  });
  if (!Array.isArray(sb.lines) || !sb.lines.length || sb.lines.some((l) => typeof l.zh !== "string" || !normalize(l.zh))) throw new Error("分镜 lines 需要非空 zh");
  const want = sb.lines.map((l) => normalize(l.zh)).join("");
  const got = external.chars.map((c) => c.c).join("");
  // 禁止重新插值或偷偷重配：完整逐字内容必须与分镜 lines 一致。
  if (want !== normalize(got)) throw new Error("分镜 lines 与外部 chars 不一致；请保留完整校对稿，只调整分行，不重配或插值");
  let offset = 0;
  const lines = sb.lines.map((l) => {
    const length = [...normalize(l.zh)].length;
    const span = { start: external.chars[offset].t, end: external.chars[offset + length - 1].t };
    offset += length;
    return span;
  });
  const output = path.join(projectDir, "voice", "words.json");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ ...external, lines }, null, 1));
  console.log(`✓ 外部时间已导入：${output}（${lines.length} 行；保留绝对时间；未调用 TTS、未生成音频）`);
  process.exit(0);
}

for (const file of [path.join(root, ".env.local")]) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const args = process.argv.slice(2);
const force = args.includes("--force");
const project = args.find((a) => !a.startsWith("--"));
const fail = (msg: string): never => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
if (!project) fail("用法：pnpm voice <项目名> [--force]");

const dir = path.join(root, "projects", project!);
type Cfg = {
  sentences: { text: string; at?: number; align?: string; anchors?: Record<string, number> }[];
  maxTempo?: number;
  gap?: number;
  end?: number;
  tail?: number; // 最后一句说完后留的画面时长
};
// 两种输入：voice.json（逐句手排，Demo 用）；或 storyboard.json（分镜表的 lines 拼成口播，按 。！？ 切句）
const sbPath = path.join(dir, "storyboard.json");
const storyboard = fs.existsSync(path.join(dir, "voice.json")) ? null : (JSON.parse(fs.readFileSync(sbPath, "utf8")) as { voice?: { start?: number; gap?: number; tail?: number }; lines: { zh: string }[] });
const cfg: Cfg = storyboard
  ? {
      gap: storyboard.voice?.gap ?? 0.28,
      tail: storyboard.voice?.tail ?? 2,
      sentences: storyboard.lines
        .map((l) => l.zh)
        .join("")
        .split(/(?<=[。！？])/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((text, i) => (i === 0 ? { text, at: storyboard.voice?.start ?? 0.8 } : { text })),
    }
  : JSON.parse(fs.readFileSync(path.join(dir, "voice.json"), "utf8"));

const speaker = process.env.VOLC_TTS_SPEAKER;
const resource = process.env.VOLC_TTS_RESOURCE_ID ?? "seed-tts-2.0";
const speed = Number(process.env.VOLC_TTS_SPEED ?? 1);
const speechRate = Math.max(-50, Math.min(100, Math.round((speed - 1) * 100)));
const style = process.env.VOLC_TTS_STYLE ?? "";
const v2 = /-2\.0/.test(resource);
const headers: Record<string, string> = { "Content-Type": "application/json", "X-Api-Resource-Id": resource };
if (process.env.VOLC_TTS_API_KEY) headers["X-Api-Key"] = process.env.VOLC_TTS_API_KEY;
else if (process.env.VOLC_TTS_APP_ID && process.env.VOLC_TTS_ACCESS_KEY) {
  headers["X-Api-App-Id"] = process.env.VOLC_TTS_APP_ID;
  headers["X-Api-Access-Key"] = process.env.VOLC_TTS_ACCESS_KEY;
} else fail("没有找到火山引擎凭证（VOLC_TTS_API_KEY）");
if (!speaker) fail("没有指定音色 VOLC_TTS_SPEAKER");

interface Word { w: string; s: number; e: number }
const norm = (s: string) => [...s].filter((c) => /[\p{L}\p{N}]/u.test(c)).join("").toLowerCase();
const probe = (f: string) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim());

async function volc(text: string, sectionId: string): Promise<{ audio: Buffer; words: Word[] }> {
  const additions: Record<string, unknown> = {};
  if (v2) additions.section_id = sectionId;
  if (style && v2) additions.context_texts = [style];
  const body = {
    user: { uid: "jacky-doodle-explainer" },
    req_params: {
      text,
      speaker,
      audio_params: { format: "mp3", sample_rate: 24000, speech_rate: speechRate, enable_timestamp: true, enable_subtitle: true },
      additions: JSON.stringify(additions),
    },
  };
  const res = await fetch(ENDPOINT, { method: "POST", headers, body: JSON.stringify(body) });
  const logid = res.headers.get("x-tt-logid") ?? "";
  const raw = await res.text();
  if (!res.ok) fail(`HTTP ${res.status}：${raw.slice(0, 300)}（logid ${logid}）`);
  const audio: Buffer[] = [];
  const words: Word[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let msg: any;
    try {
      msg = JSON.parse(line.replace(/^data:\s*/, ""));
    } catch {
      continue;
    }
    if (msg.code && msg.code !== 20000000) fail(`火山引擎返回 ${msg.code}：${msg.message}（logid ${logid}）`);
    if (typeof msg.data === "string" && msg.data) audio.push(Buffer.from(msg.data, "base64"));
    for (const w of msg.sentence?.words ?? []) words.push({ w: w.word, s: w.startTime, e: w.endTime });
  }
  if (!audio.length) fail(`没有收到音频（logid ${logid}）`);
  return { audio: Buffer.concat(audio), words };
}

const cacheDir = path.join(dir, "voice", ".cache");
fs.mkdirSync(cacheDir, { recursive: true });

async function synth(text: string, sectionId: string) {
  const key = createHash("sha256").update(JSON.stringify({ v: 1, text, speaker, resource, speechRate, style })).digest("hex").slice(0, 24);
  const mp3 = path.join(cacheDir, `${key}.mp3`);
  const meta = path.join(cacheDir, `${key}.json`);
  if (!force && fs.existsSync(mp3) && fs.existsSync(meta)) return { file: mp3, words: JSON.parse(fs.readFileSync(meta, "utf8")) as Word[], cached: true };
  const need = norm(text).length;
  for (let tries = 1; ; tries++) {
    const r = await volc(text, sectionId);
    const got = r.words.reduce((n, w) => n + norm(w.w).length, 0);
    if (!r.words.length || got >= need * 0.85 || tries >= 3) {
      fs.writeFileSync(mp3, r.audio);
      fs.writeFileSync(meta, JSON.stringify(r.words));
      return { file: mp3, words: r.words, cached: false };
    }
    console.warn(`  … 只返回 ${got}/${need} 字，重配第 ${tries + 1} 次`);
  }
}

/** 真实发声范围：10ms 窗口 RMS 超过 -40dB 的首尾（秒） */
function speechBounds(file: string): [number, number] {
  const raw = execFileSync("ffmpeg", ["-loglevel", "error", "-i", file, "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], { maxBuffer: 1 << 28 });
  const pcm = new Int16Array(raw.buffer, raw.byteOffset, raw.length >> 1);
  const win = 160;
  let first = -1, last = -1;
  for (let i = 0; i + win <= pcm.length; i += win) {
    let e = 0;
    for (let j = i; j < i + win; j++) e += (pcm[j] / 32768) ** 2;
    const db = 10 * Math.log10(e / win + 1e-12);
    if (db > -40) {
      if (first < 0) first = i;
      last = i + win;
    }
  }
  return first < 0 ? [0, pcm.length / 16000] : [first / 16000, last / 16000];
}

/** 找锚点词在逐字时间里的开口时刻（秒，句内） */
function findWord(words: Word[], key: string): number | undefined {
  const k = norm(key);
  const flat = words.map((w) => norm(w.w)).join("");
  const idx = flat.indexOf(k);
  if (idx < 0) return undefined;
  let n = 0;
  for (const w of words) {
    const len = norm(w.w).length;
    if (n + len > idx) return w.s;
    n += len;
  }
}

const sectionId = randomUUID();
const maxTempo = cfg.maxTempo ?? 1.35;
const gap = cfg.gap ?? 0.25;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "doodle-voice-"));
const pieces: { file: string; from: number; to: number; at: number; tempo: number }[] = [];
const allWords: Word[] = [];
const sentences: { text: string; start: number; end: number; from: number; to: number }[] = [];
let cursor = 0;

for (const [i, s] of cfg.sentences.entries()) {
  const { file, words, cached } = await synth(s.text, sectionId);
  const dur = probe(file);
  // 首尾按真实发声裁剪（火山逐字时间戳在句首句尾常偏 0.1–0.4s，按它裁会吞字）
  const [on, off] = speechBounds(file);
  const lead = Math.max(0, Math.min(on - 0.06, words[0]?.s ?? on));
  const tail = Math.min(dur, Math.max(off + 0.18, (words.at(-1)?.e ?? 0) + 0.12));
  // align：让这个词（而不是句首）在 at 时刻开口
  const alignSrc = s.align ? findWord(words, s.align) : undefined;
  if (s.align && alignSrc === undefined) console.warn(`  ⚠ 第 ${i + 1} 句找不到对齐词「${s.align}」`);
  const start = s.at !== undefined ? s.at - (alignSrc !== undefined ? alignSrc - lead : 0) : cursor + gap;
  // 切点：句首 + 各锚点词
  const cuts: { src: number; at: number }[] = [{ src: lead, at: start }];
  for (const [key, at] of Object.entries(s.anchors ?? {})) {
    const src = findWord(words, key);
    if (src === undefined) {
      console.warn(`  ⚠ 第 ${i + 1} 句找不到锚点「${key}」`);
      continue;
    }
    cuts.push({ src: Math.max(lead, src - 0.03), at: at - 0.03 });
  }
  cuts.sort((a, b) => a.src - b.src);
  const w0 = allWords.length;
  const nx = cfg.sentences[i + 1];
  const next = nx?.at !== undefined && !nx.align ? nx.at : undefined;
  cuts.forEach((c, k) => {
    const to = k + 1 < cuts.length ? cuts[k + 1].src : tail;
    const len = to - c.src;
    const room = (k + 1 < cuts.length ? cuts[k + 1].at : next ?? Infinity) - c.at - 0.02;
    const tempo = Math.min(maxTempo, Math.max(1, len / room));
    if (len / tempo > room + 0.01) console.warn(`  ⚠ 第 ${i + 1} 句第 ${k + 1} 段放不下：需 ${len.toFixed(2)}s，只有 ${room.toFixed(2)}s`);
    pieces.push({ file, from: c.src, to, at: c.at, tempo });
    for (const w of words) if (w.s >= c.src - 1e-3 && w.s < to - 1e-3) allWords.push({ w: w.w, s: +(c.at + (w.s - c.src) / tempo).toFixed(3), e: +(c.at + (w.e - c.src) / tempo).toFixed(3) });
    cursor = c.at + len / tempo;
  });
  sentences.push({ text: s.text, start: allWords[w0]?.s ?? start, end: allWords.at(-1)?.e ?? cursor, from: w0, to: allWords.length });
  console.log(`  ${cached ? "缓存" : "合成"} ${i + 1}/${cfg.sentences.length}：${s.text}（${(tail - lead).toFixed(2)}s，开口 ${start.toFixed(2)}s）`);
}

// 混成一条：每段用 ffmpeg 裁切 + 提速后解码成采样点，按"开口时刻 × 采样率"精确写进缓冲区。
// 不用 adelay/amix 定位：adelay 只改时间戳，写 WAV 时开头空白会被丢掉，整条会整体提前（曾导致提前 2.000s）。
const SR = 48000;
const end = cfg.end ?? +(cursor + (cfg.tail ?? 1.6)).toFixed(3);
const mix = new Float32Array(Math.ceil(end * SR));
for (const p of pieces) {
  const tempo = p.tempo > 1.001 ? `,atempo=${p.tempo.toFixed(4)}` : "";
  const len = (p.to - p.from) / p.tempo;
  const raw = execFileSync("ffmpeg", [
    "-loglevel", "error", "-i", p.file,
    "-af", `atrim=start=${p.from.toFixed(3)}:end=${p.to.toFixed(3)},asetpts=PTS-STARTPTS${tempo},afade=t=in:d=0.01,afade=t=out:st=${(len - 0.03).toFixed(3)}:d=0.03`,
    "-ac", "1", "-ar", String(SR), "-f", "s16le", "-",
  ], { maxBuffer: 1 << 28 });
  const pcm = new Int16Array(raw.buffer, raw.byteOffset, raw.length >> 1);
  const at = Math.round(p.at * SR);
  for (let i = 0; i < pcm.length && at + i < mix.length; i++) mix[at + i] += pcm[i] / 32768;
}
const outDir = path.join(dir, "voice");
{
  // 16-bit 双声道 WAV
  const n = mix.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, mix[i])) * 32767;
    buf.writeInt16LE(v | 0, 44 + i * 4);
    buf.writeInt16LE(v | 0, 46 + i * 4);
  }
  fs.writeFileSync(path.join(outDir, "narration.wav"), buf);
}
// 分镜模式：把口播逐字（去标点）与 TTS 逐字做最长公共子序列对齐，得到每个字的开口时刻和每行起止
let chars: { c: string; t: number }[] | undefined;
let lineSpans: { start: number; end: number }[] | undefined;
if (storyboard) {
  const want = [...norm(storyboard.lines.map((l) => l.zh).join(""))];
  const got: { c: string; t: number; e: number }[] = [];
  for (const w of allWords) {
    const cs = [...norm(w.w)];
    cs.forEach((c, k) => got.push({ c, t: w.s + ((w.e - w.s) * k) / cs.length, e: w.s + ((w.e - w.s) * (k + 1)) / cs.length }));
  }
  const n = want.length, m = got.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = want[i] === got[j].c ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const t: (number | null)[] = new Array(n).fill(null);
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (want[i] === got[j].c) { t[i] = got[j].t; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  // 没对上的字（TTS 把数字/英文念成别的写法）按前后已知时刻插值
  for (let i = 0; i < n; i++) if (t[i] === null) {
    let a = i - 1; while (a >= 0 && t[a] === null) a--;
    let b = i + 1; while (b < n && t[b] === null) b++;
    const ta = a >= 0 ? (t[a] as number) : (t[b] as number) - 0.2, tb = b < n ? (t[b] as number) : ta + 0.2;
    t[i] = ta + ((tb - ta) * (i - a)) / (b - a);
  }
  const miss = t.length - dp[0][0];
  if (miss > 0) console.log(`  逐字对齐：${n - miss}/${n} 字精确对上，其余 ${miss} 字按前后插值`);
  chars = want.map((c, i) => ({ c, t: +(t[i] as number).toFixed(3) }));
  let off = 0;
  lineSpans = storyboard.lines.map((l) => {
    const len = [...norm(l.zh)].length;
    const span = { start: chars![off]?.t ?? 0, end: chars![Math.min(off + len, n) - 1]?.t ?? 0 };
    off += len;
    return span;
  });
}
fs.writeFileSync(path.join(outDir, "words.json"), JSON.stringify({ speaker, resource, speed, end, sentences, lines: lineSpans, chars, words: allWords }, null, 1));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`✓ ${path.relative(root, outDir)}/narration.wav（${end}s，${pieces.length} 段，${allWords.length} 个字带时间戳）`);
