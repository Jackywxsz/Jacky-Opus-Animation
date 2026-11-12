// 入口：等字体就绪 → 搭舞台 → 暴露 __seek(t) 给逐帧渲染；预览模式带播放条和配音。
import { createStage } from "./engine/stage";
import { FPS, setFormat, W, H } from "./engine/core";
import { buildDemo, narration } from "./scenes/demo";
import { buildYazaiSheet } from "./scenes/yazai-sheet";
import { preloadIcons } from "./components/icons";
import { buildStoryboard } from "./scenes/storyboard";

declare global {
  interface Window {
    __seek: (t: number) => void;
    __ready: boolean;
    __duration: number;
    __events: unknown[];
    __broll: unknown[];
    __yazai: unknown;
    __size: { w: number; h: number };
  }
}

const params = new URLSearchParams(location.search);
const render = params.has("render");
if (render) document.body.classList.add("render");

async function loadFonts() {
  const sample = narration.map((n) => n.zh + n.en).join("") + "帮我写个稿？不止!剪片配音发布AI 工具箱2026JACKY×let's go!?!$ just drafting Edit Voice Publish the whole AI toolkit";
  await Promise.all([
    document.fonts.load('44px "Xiaolai"', sample),
    document.fonts.load('44px "Patrick Hand"', sample),
  ]);
  await document.fonts.ready;
}

async function main() {
  setFormat(params.get("fmt"));
  window.__size = { w: W, h: H };
  const project = params.get("p") ?? "demo";
  const sbRes = await fetch(`/projects/${project}/storyboard.json`);
  const sb = sbRes.ok && sbRes.headers.get("content-type")?.includes("json") ? await sbRes.json() : null;
  if (sb) {
    await preloadIcons(sb); // 模板同步画图，必须在 buildStoryboard 之前完成
    const all = JSON.stringify(sb);
    await Promise.all([document.fonts.load('44px "Xiaolai"', all), document.fonts.load('44px "Patrick Hand"', all)]);
  }
  await loadFonts();
  const host = document.getElementById("stage")!;
  host.style.width = `${W}px`;
  host.style.height = `${H}px`;
  const stage = createStage(host);
  // ?yazai：只画芽仔（造型核对用）；否则按配音逐字时间搭 Demo
  let tl;
  if (params.has("yazai")) tl = buildYazaiSheet(stage);
  else if (sb) {
    const voice = await fetch(`/projects/${project}/voice/words.json`).then((r) => r.json());
    const built = buildStoryboard(stage, sb, voice, `/projects/${project}/`);
    // 截图全部解码完再开始渲染，避免出现空相框
    await Promise.all([...stage.svg.querySelectorAll("image")].map((im) => ((im as any).decode ? (im as any).decode().catch(() => {}) : Promise.resolve())));
    tl = built.tl;
    window.__events = built.events;
    window.__broll = built.broll;
    window.__yazai = built.yazai;
  } else {
    const voice = await fetch(`/projects/${params.get("p") ?? "demo"}/voice/words.json`).then((r) => r.json());
    const built = buildDemo(stage, voice);
    tl = built.tl;
    window.__events = built.cues.events;
  }
  window.__seek = (t) => tl.seek(t);
  window.__duration = tl.duration;

  const t0 = Number(params.get("t") ?? 0);
  tl.seek(t0);
  window.__ready = true;
  if (render) return;

  // ---------- 预览 ----------
  const fit = () => {
    const s = Math.min(innerWidth / W, (innerHeight - 48) / H);
    host.style.transform = `scale(${s})`;
  };
  fit();
  addEventListener("resize", fit);

  const scrub = document.getElementById("scrub") as HTMLInputElement;
  const clock = document.getElementById("clock")!;
  const play = document.getElementById("play")!;
  scrub.max = String(tl.duration);
  const audio = new Audio(params.get("audio") ?? `/projects/${project}/out/mix.wav`);
  let playing = false;
  let start = 0;
  let cur = t0;

  const show = (t: number) => {
    cur = Math.min(t, tl.duration);
    tl.seek(cur);
    scrub.value = String(cur);
    clock.textContent = `${cur.toFixed(3)}s · f${Math.floor(cur * FPS + 1e-6)}`;
  };
  const loop = () => {
    if (!playing) return;
    const t = audio.readyState >= 2 && !audio.paused ? audio.currentTime : (performance.now() - start) / 1000;
    show(t);
    if (t >= tl.duration) {
      playing = false;
      play.textContent = "▶︎";
      audio.pause();
      return;
    }
    requestAnimationFrame(loop);
  };
  play.onclick = () => {
    playing = !playing;
    play.textContent = playing ? "❚❚" : "▶︎";
    if (playing) {
      if (cur >= tl.duration) cur = 0;
      start = performance.now() - cur * 1000;
      audio.currentTime = cur;
      audio.play().catch(() => {});
      loop();
    } else audio.pause();
  };
  scrub.oninput = () => {
    show(Number(scrub.value));
    start = performance.now() - cur * 1000;
    audio.currentTime = cur;
  };
  addEventListener("keydown", (e) => {
    if (e.key === " ") play.click();
    if (e.key === "ArrowRight") show(cur + 1 / FPS);
    if (e.key === "ArrowLeft") show(cur - 1 / FPS);
  });
  show(t0);
}

main();
