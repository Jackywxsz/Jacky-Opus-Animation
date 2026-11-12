// 逐帧渲染：vite 起页面 → Playwright 按帧 seek 截图 → ffmpeg 合成（可混入音频）。
// 用法：
//   pnpm render --start-frame 132 --end-frame 357 --no-audio --query "caption=none&pip=none"（30fps，右端不含）
//   pnpm render --stills 1.6,7.9,12.6          定格图 → projects/demo/out/stills/
//   pnpm render [--from 0] [--to 18] [--workers 3] [--audio projects/demo/out/mix.wav] [--out projects/demo/out/demo.mp4]
import { createServer } from "vite";
import { chromium, type Page } from "playwright-core";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const FPS = 30;
const PROJECT = flag("p") ?? "demo";
const FMT = flag("fmt") ?? "16x9"; // 16x9 | 3x4
const SIZE = FMT === "3x4" ? { width: 1080, height: 1440 } : { width: 1920, height: 1080 };
const OUT_DIR = join(ROOT, "projects", PROJECT, "out");

async function openPage(url: string) {
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage({ viewport: SIZE, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url);
  try {
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  } catch {
    throw new Error(`页面没有就绪：\n${errors.join("\n") || "（无报错信息）"}`);
  }
  return { browser, page };
}

async function shot(page: Page, t: number, file: string) {
  await page.evaluate((tt) => window.__seek(tt), t);
  await page.locator("#stage").screenshot({ path: file, type: "png" });
}

async function main() {
  // 关掉热更新：渲染途中改代码不会刷新正在截图的页面
  const server = await createServer({ root: ROOT, server: { port: 5189, strictPort: false, hmr: false, watch: null }, logLevel: "error" });
  await server.listen();
  const port = server.config.server.port ?? 5189;
  const url = `http://localhost:${server.httpServer?.address() && typeof server.httpServer.address() === "object" ? (server.httpServer.address() as { port: number }).port : port}/?render&p=${encodeURIComponent(PROJECT)}&fmt=${FMT}${flag("pip") ? "&pip=video" : ""}${flag("query") ? "&" + flag("query") : ""}`;

  try {
    const stills = flag("stills");
    if (stills) {
      const dir = join(OUT_DIR, "stills");
      mkdirSync(dir, { recursive: true });
      const { browser, page } = await openPage(url);
      for (const s of stills.split(",")) {
        const t = Number(s);
        const file = join(dir, `${FMT === "3x4" ? "v_" : ""}${flag("query") ? flag("query")!.replace(/\W+/g, "_") + "_" : ""}t${t.toFixed(3)}.png`);
        await shot(page, t, file);
        console.log(file);
      }
      await browser.close();
      return;
    }

    const { page: probe, browser: pb } = await openPage(url);
    const duration = await probe.evaluate(() => window.__duration);
    const events = (await probe.evaluate(() => window.__events ?? [])) as { kind: string; label: string; cue: string; voice: number; t: number }[];
    const broll = (await probe.evaluate(() => window.__broll ?? [])) as [number, number][];
    await pb.close();
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, "events.json"), JSON.stringify({ duration, events }, null, 1));
    const rows = events
      .filter((e) => e.kind !== "sub" && (e.kind !== "char" || e.label.includes("A")))
      .sort((a, b) => a.t - b.t)
      .map((e) => `| ${e.label} | ${e.cue} | ${e.voice.toFixed(3)}s | ${e.t.toFixed(3)}s (f${Math.round(e.t * FPS)}) | ${Math.round((e.voice - e.t) * 1000)}ms |`);
    writeFileSync(
      join(OUT_DIR, "av-sync.md"),
      `# 音画同步表\n\n画面启动时刻 = 关键词开口 − 提前量（规则见 src/engine/sync.ts）。\n\n| 画面 | 关键词 | 开口 | 动画启动 | 提前 |\n|---|---|---|---|---|\n${rows.join("\n")}\n` +
        (broll.length ? `\n## 可放成品展示的留白（画面静止 ≥3s）\n\n${broll.map(([a, b]) => `- ${a.toFixed(1)}s – ${b.toFixed(1)}s（${(b - a).toFixed(1)}s）`).join("\n")}\n` : ""),
    );
    if (!args.includes("--no-audio")) {
      const a = spawnSync("python3", [join(ROOT, "scripts/audio.py"), PROJECT], { stdio: "inherit" });
      if (a.status !== 0) throw new Error("音轨生成失败");
    }
    const startFrame = flag("start-frame"), endFrame = flag("end-frame");
    if ((startFrame === undefined) !== (endFrame === undefined)) throw new Error("--start-frame 与 --end-frame 必须成对使用（右端不含）");
    if (startFrame !== undefined && (flag("from") !== undefined || flag("to") !== undefined)) throw new Error("帧区间不能与 --from / --to 混用");
    if (startFrame !== undefined && (![Number(startFrame), Number(endFrame)].every(Number.isInteger) || Number(startFrame) < 0 || Number(endFrame) <= Number(startFrame) || Number(endFrame) > Math.ceil(duration * FPS))) throw new Error("无效帧区间，需 0 ≤ start-frame < end-frame ≤ 总帧数");
    const from = startFrame === undefined ? Number(flag("from") ?? 0) : Number(startFrame) / FPS;
    const to = endFrame === undefined ? Number(flag("to") ?? duration) : Number(endFrame) / FPS;
    const workers = Number(flag("workers") ?? 3);
    const frames = startFrame === undefined ? Math.round((to - from) * FPS) : Number(endFrame) - Number(startFrame);
    const framesDir = join(OUT_DIR, "frames");
    rmSync(framesDir, { recursive: true, force: true });
    mkdirSync(framesDir, { recursive: true });

    const started = Date.now();
    let done = 0;
    await Promise.all(
      Array.from({ length: workers }, async (_, w) => {
        const { browser, page } = await openPage(url);
        for (let i = w; i < frames; i += workers) {
          await shot(page, startFrame === undefined ? from + i / FPS : (Number(startFrame) + i) / FPS, join(framesDir, `${String(i).padStart(5, "0")}.png`));
          if (++done % 60 === 0) process.stdout.write(`\r${done}/${frames} 帧`);
        }
        await browser.close();
      }),
    );
    console.log(`\r${frames}/${frames} 帧，用时 ${((Date.now() - started) / 1000).toFixed(1)}s`);

    const out = flag("out") ?? join(OUT_DIR, FMT === "3x4" ? "demo-3x4.mp4" : "demo.mp4");
    const audio = flag("audio") ?? join(OUT_DIR, "mix.wav");
    const useAudio = !args.includes("--no-audio") && existsSync(audio);
    const ff = [
      "-y", "-v", "error",
      "-framerate", String(FPS), "-i", join(framesDir, "%05d.png"),
      ...(useAudio ? ["-ss", String(from), "-i", audio] : []),
      "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p", "-r", String(FPS),
      ...(useAudio ? ["-c:a", "aac", "-b:a", "192k", "-shortest"] : []),
      out,
    ];
    const r = spawnSync("ffmpeg", ff, { stdio: "inherit" });
    if (r.status !== 0) throw new Error("ffmpeg 失败");
    // 竖屏口播小窗：把录好的读稿视频裁成圆角，嵌进左下角框里（x40 y880 360×270，内缩 5px）
    const pip = flag("pip");
    if (pip && FMT === "3x4") {
      const tmp = out.replace(/\.mp4$/, ".pip.mp4");
      const round = "geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(gt(abs(X-W/2),W/2-14)*gt(abs(Y-H/2),H/2-14),if(lte(hypot(abs(X-W/2)-(W/2-14),abs(Y-H/2)-(H/2-14)),14),255,0),255)'";
      const r2 = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", out, "-i", pip, "-filter_complex",
        `[1:v]scale=350:260:force_original_aspect_ratio=increase,crop=350:260,format=rgba,${round}[p];[0:v][p]overlay=45:885:shortest=1[v]`,
        "-map", "[v]", "-map", "0:a", "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p", "-c:a", "copy", tmp], { stdio: "inherit" });
      if (r2.status !== 0) throw new Error("口播小窗合成失败");
      spawnSync("mv", [tmp, out]);
      console.log(`口播小窗已嵌入：${pip}`);
    }
    console.log(`${out}${useAudio ? "（含音频）" : "（无音频）"}`);
  } finally {
    await server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
