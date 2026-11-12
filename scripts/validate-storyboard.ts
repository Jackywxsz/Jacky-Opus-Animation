// 分镜校验回归：用一份含 diagram / allocation 的分镜做反例变异，确认引擎给出明确报错；再确认其他项目的分镜仍能构建。
// 用法：pnpm validate --p <含 diagram 和 allocation 的项目> [--compat 项目A,项目B]
//   → projects/<p>/out/qa/validation.json；有任一项不符合预期时退出码 1
import { createServer } from "vite";
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2), arg = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const P = arg("--p");
if (!P) throw new Error("用法：pnpm validate --p <项目> [--compat 项目A,项目B]");
const compat = (arg("--compat") ?? "").split(",").filter(Boolean);
const load = (p: string, f: string) => JSON.parse(readFileSync(join(root, "projects", p, f), "utf8"));
const base = load(P, "storyboard.json"), voice = load(P, "voice/words.json");
const scene = (s: any, t: string) => {
  const sc = s.scenes.find((x: any) => x.template === t);
  if (!sc) throw new Error(`项目 ${P} 没有 ${t} 场景，无法做反例校验`);
  return sc;
};

const tests: { name: string; sb: any; v: any; expected: string }[] = [];
const bad = (name: string, expected: string, mutate: (s: any) => void) => {
  const s = structuredClone(base);
  mutate(s);
  tests.push({ name, sb: s, v: voice, expected });
};
bad("节点不足", "2–4", (s) => (scene(s, "diagram").nodes.length = 1));
bad("缺少cue", "cue", (s) => delete scene(s, "diagram").nodes[0].cue);
bad("越场cue", "越过", (s) => (scene(s, "diagram").nodes[0].cue = base.lines[base.lines.length - 1].zh.slice(0, 4)));
bad("比例错误", "合计 100", (s) => (scene(s, "allocation").parts[0].value = 60));
bad("标签过长", "过长", (s) => (scene(s, "diagram").nodes[0].text = "很长的标题".repeat(12)));
bad("多个重点", "每场只能", (s) => { const n = scene(s, "diagram").nodes; n[0].em = true; n[1].em = true; });
bad("禁止全局抖动", "boil", (s) => (s.boil = true));
bad("动作缺走位", "approach", (s) => { const sc = s.scenes.find((x: any) => x.yazai?.face); sc.yazai = { face: sc.yazai.face, faceCue: sc.yazai.faceCue, action: "approach" }; });
tests.push({ name: `${P} 原分镜`, sb: base, v: voice, expected: "" });
for (const p of compat) tests.push({ name: `${p} 原分镜`, sb: load(p, "storyboard.json"), v: load(p, "voice/words.json"), expected: "" });

const server = await createServer({ root, server: { port: 5193, hmr: false, watch: null }, logLevel: "error" });
await server.listen();
const port = (server.httpServer!.address() as { port: number }).port;
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1080, height: 1440 } });
await page.addInitScript("window.__name = (target) => target");
const results: { name: string; pass: boolean; error: string }[] = [];
try {
  await page.goto(`http://localhost:${port}/?render&p=${P}&fmt=3x4&pip=none`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  for (const test of tests) {
    const error = await page.evaluate(async ({ sb, v }) => {
      const sceneModule = "/src/scenes/storyboard.ts", stageModule = "/src/engine/stage.ts", iconModule = "/src/components/icons.ts";
      const { buildStoryboard } = await import(sceneModule), { createStage } = await import(stageModule), { preloadIcons } = await import(iconModule);
      const host = document.createElement("div");
      document.body.appendChild(host);
      try {
        await preloadIcons(sb);
        buildStoryboard(createStage(host), sb, v);
        return "";
      } catch (e) {
        return String((e as Error).message);
      } finally {
        host.remove();
      }
    }, { sb: test.sb, v: test.v });
    results.push({ name: test.name, pass: test.expected ? error.includes(test.expected) : error === "", error });
  }
  mkdirSync(join(root, "projects", P, "out", "qa"), { recursive: true });
  writeFileSync(join(root, "projects", P, "out", "qa", "validation.json"), JSON.stringify(results, null, 2));
  for (const r of results) console.log(`${r.pass ? "✓" : "✗"} ${r.name}${r.error ? `：${r.error}` : ""}`);
  if (results.some((r) => !r.pass)) process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
