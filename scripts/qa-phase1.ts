// 第一期模板回归：真实时钟抽帧、空框时长、表情时内容边界、无推镜头、随机 seek。
// 用法：pnpm exec tsx scripts/qa-phase1.ts [--p <project>] [--out projects/<project>/out/acceptance]
import { createServer } from "vite";
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
const args = process.argv.slice(2);
const arg = (name: string) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const projectName = arg("--p");
if (!projectName) throw new Error("Specify --p <project> containing phase-1 templates");
const root = resolve("."), out = resolve(root, arg("--out") ?? `projects/${projectName}/out`);
mkdirSync(join(out, "stills"), { recursive: true });
mkdirSync(join(out, "phase1"), { recursive: true });
const server = await createServer({ root, server: { port: 0, strictPort: false, hmr: false, watch: null }, logLevel: "error" });
await server.listen();
const port = (server.httpServer!.address() as { port: number }).port;
const browser = await chromium.launch({ channel: "chrome" });
const records: any[] = [], checks: string[] = [], failures: string[] = [];
try {
  for (const fmt of ["3x4", "16x9"]) {
    const page = await browser.newPage({ viewport: fmt === "3x4" ? { width: 1080, height: 1440 } : { width: 1920, height: 1080 } });
    page.on("pageerror", (e) => failures.push(e.message));
    const projectList: string[] = [projectName, ...(arg("--compat") ? [arg("--compat")!] : [])];
    for (const project of projectList) {
      await page.goto(`http://localhost:${port}/?render&p=${project}&fmt=${fmt}&pip=none`);
      await page.waitForFunction(() => window.__ready === true);
      const ev = await page.evaluate(() => window.__events) as any[];
      const yz = await page.evaluate(() => window.__yazai) as any;
      const scenes = await page.evaluate(() => Array.from(document.querySelectorAll<SVGGElement>("[data-scene]")).map((g) => ({ line: Number(g.dataset.scene), template: g.dataset.template!, start: Number(g.dataset.start), times: Array.from(g.querySelectorAll<SVGGElement>("[data-item]")).map((i) => Number(i.dataset.on)) })));
      const shot = async (name: string, t: number) => {
        await page.evaluate((t) => window.__seek(t), t);
        const file = `${fmt}-${project}-${name}-${t.toFixed(3)}.png`;
        await page.locator("#stage").screenshot({ path: join(out, "stills", file) });
        records.push({ fmt, project, name, t, file });
      };
      if (project === projectName) {
        for (const template of ["split", "quote", "burst", "flow"]) {
          // 二期把原第 76 行改为 road；按真实模板取场景，不能把 road 截图冒充 flow。
          const si = scenes.findIndex((s) => s.template === template), sc = scenes[si];
          if (!sc) throw new Error(`项目 ${project} 缺少 ${template} 模板，无法完成专项验收`);
          const on = Math.min(...sc.times.filter((t) => t > sc.start));
          const talk = yz.faces.find((f: any) => f.talk && f.t >= sc.start && f.t < scenes[si + 1].start);
          const done = talk ? talk.off + 0.2 : Math.max(...sc.times) + 0.67;
          await shot(`${template}-appearing`, on + 0.12);
          await shot(`${template}-complete`, done);
          await shot(`${template}-middle`, (sc.start + scenes[si + 1].start) / 2);
        }
        for (const line of [8, 36, 53]) {
          const sc = scenes.find((s) => s.line === line)!;
          const frame = sc.times[sc.line === 8 ? 1 : 0], label = sc.times[sc.line === 8 ? 2 : 1], first = sc.times[sc.line === 8 ? 3 : 2];
          const gap = first - frame;
          checks.push(`${fmt} prompt 第 ${line} 行：框到首条要点 ${gap.toFixed(3)}s，标签差 ${(label-frame).toFixed(3)}s`);
          if (gap > 0.3) failures.push(`${fmt} prompt ${line} 框内空白 ${gap.toFixed(3)}s > 0.3s`);
          await shot(`prompt-${line}-frame`, frame + 0.12);
          await shot(`prompt-${line}-first`, first + 0.4);
        }
      }
      for (const [i, f] of yz.faces.filter((f: any) => !f.talk).entries()) {
        const t = f.t + 0.5;
        await shot(`face-${i}-${f.face}`, t);
        const edges = await page.evaluate((t) => {
          window.__seek(t);
          return Array.from(document.querySelectorAll<SVGGElement>("[data-item]")).filter((n) => n.checkVisibility({ opacityProperty: true, visibilityProperty: true })).map((n) => {
            const r = n.getBoundingClientRect();
            return Math.max(0, -r.left, -r.top, r.right-innerWidth, r.bottom-innerHeight);
          });
        }, t);
        const crop = Math.max(0, ...edges);
        checks.push(`${fmt} ${project} ${f.face} ${t.toFixed(3)}s 表情时内容裁出 ${crop.toFixed(2)}px`);
        if (crop > 40) failures.push(`表情时内容裁出 ${crop}px > 40px`);
      }
      // 新规则要求正式表情和说话点阵都不触发符号或镜头。
      // SVG 没有 transform 属性时是单位矩阵，不应因属性为空误报。
      for (const f of yz.faces) {
        const state = await page.evaluate((t) => {
          window.__seek(t);
          const yz = document.querySelector<SVGGElement>('[id^="yazai"]')!;
          const camera = yz.parentElement!.parentElement! as unknown as SVGGElement;
          const m = camera.transform.baseVal.consolidate()?.matrix;
          return {
            symbols: Array.from(yz.querySelectorAll<SVGGElement>("[data-symbol]")).filter((n) => n.checkVisibility({ opacityProperty: true, visibilityProperty: true })).length,
            matrix: m ? [m.a, m.b, m.c, m.d, m.e, m.f] : [1, 0, 0, 1, 0, 0],
          };
        }, f.t + 0.1);
        if (state.symbols || state.matrix.some((v, i) => Math.abs(v - [1, 0, 0, 1, 0, 0][i]) > 1e-6)) failures.push(`${fmt} ${project} ${f.face} 触发了符号或镜头`);
      }
      const talk = yz.faces.find((f: any) => f.talk);
      if (talk) {
        const t = talk.t + 0.1;
        const isolated = await page.evaluate((t) => {
          window.__seek(t);
          const symbols = Array.from(document.querySelectorAll<SVGGElement>("[data-symbol]")).filter((n) => n.checkVisibility({ opacityProperty: true, visibilityProperty: true }));
          const camera = document.querySelector('[id^="yazai"]')!.parentElement!.parentElement!;
          const m = (camera as unknown as SVGGElement).transform.baseVal.consolidate()?.matrix;
          return { symbols: symbols.length, matrix: m ? [m.a, m.b, m.c, m.d, m.e, m.f] : [1, 0, 0, 1, 0, 0] };
        }, t);
        checks.push(`${fmt} talk 隔离：${JSON.stringify(isolated)}`);
        if (isolated.symbols || isolated.matrix.some((v, i) => Math.abs(v - [1, 0, 0, 1, 0, 0][i]) > 1e-6)) failures.push("talk 触发了符号或镜头");
      }
      // 同一时刻先直达、再跳到结尾后返回，可见输出必须一致（隐藏场景可保留局部属性）。
      const t = project === projectName ? 193.5 : 81.8;
      await page.evaluate((t) => window.__seek(t), t);
      const geometry = () => page.evaluate(() => JSON.stringify(Array.from(document.querySelectorAll<SVGGraphicsElement>("#stage path, #stage text, #stage rect, #stage circle, #stage image")).filter((n) => n.checkVisibility({ opacityProperty: true, visibilityProperty: true })).map((n) => ({ html: n.outerHTML, matrix: n.getScreenCTM()?.toString(), opacity: getComputedStyle(n).opacity }))));
      const state1 = await geometry();
      const first = await page.locator("#stage").screenshot();
      await page.evaluate(() => window.__seek(window.__duration - 0.1));
      await page.evaluate((t) => window.__seek(t), t);
      const state2 = await geometry();
      const second = await page.locator("#stage").screenshot();
      if (!first.equals(second)) {
        writeFileSync(join(out, `phase1/${fmt}-${project}-seek-before.png`), first);
        writeFileSync(join(out, `phase1/${fmt}-${project}-seek-after.png`), second);
        checks.push(`${fmt} ${project} 截图有光栅差异，另存前后图；以可见 SVG 属性和屏幕变换核验时间轴状态`);
        if (state1 !== state2) failures.push(`${fmt} ${project} 随机 seek 可见状态不一致`);
        else checks.push(`${fmt} ${project} 随机 seek 可见状态一致`);
      }
      else checks.push(`${fmt} ${project} 随机 seek 一致`);
    }
    await page.close();
  }
} finally {
  await browser.close(); await server.close();
}
writeFileSync(join(out, "phase1/visual-checks.json"), JSON.stringify({ checks, failures, records }, null, 2));
console.log(checks.join("\n"));
console.log(failures.length ? failures.map((f) => `✗ ${f}`).join("\n") : `✓ 第一期专项验收通过，${records.length} 张抽帧`);
if (failures.length) process.exitCode = 1;
