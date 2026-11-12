# Jacky Opus Animation · 芽仔手绘讲解动画

把中文口播稿组织为分镜，用芽仔、手绘图式、逐字时间轴生成 3:4 或 16:9 视频。仓库包含动画引擎、渲染和 QA 脚本、Skill 文档以及离线演示入口。

这是从本地工程整理的独立公开快照，包含稳定文字、关键词单次强调和 diagram / roles / allocation 等模板。内容项目、原始音视频、配音缓存、凭据、历史开发记录与 Git 历史均不在此仓库。

## 快速试用（无 API 调用）

需要 Node.js 22.12+（或满足 Vite engines 的更新版本）、pnpm、Python 3、FFmpeg/ffprobe、Google Chrome。新克隆安装依赖：

```sh
pnpm install --frozen-lockfile
python3 -m pip install -r requirements.txt
pnpm -s typecheck
python3 scripts/demo_setup.py
pnpm dev
```

打开 `http://localhost:5188/?p=demo&pip=none`。内置 Demo 使用固定 16:9 构图，不适用于竖版；3:4 请使用下文的分镜模板工程。演示使用合成的逐字时间，仅用于检查动画，无人声、无需密钥。项目文件写入被 Git 忽略的 `projects/demo/`，已有示例不会被覆盖。

导出三秒无声测试片或抽帧：

```sh
pnpm render --p demo --from 0 --to 3 --no-audio
pnpm render --p demo --stills 1.6,7.9,12.6
```

输出在 `projects/demo/out/`。首次运行 Chrome 可能需要本机权限；不要把类型检查通过当作视觉验收。已有环境不要为了出片清空或重装依赖。

## 自定义内容

按 [Skill](skill/SKILL.md) 和 [分镜字段](skill/references/storyboard.md) 编写 `projects/<name>/storyboard.json`，准备相应 `voice/words.json` 与授权素材，再运行：

```sh
pnpm qa --p <name> --fmt 3x4
pnpm render --p <name> --fmt 3x4 --query pip=none
```

真实口播必须使用真实逐字时间，不能用演示合成时间替代。`pnpm voice <name>` 会调用收费 TTS，只有获得稿件及费用授权后才运行。凭据仅从当前工程 `.env.local` 或环境变量读取：`VOLC_TTS_API_KEY`，或 `VOLC_TTS_APP_ID` 与 `VOLC_TTS_ACCESS_KEY`；声音通过 `VOLC_TTS_SPEAKER` 配置。不要提交这些值。

图形模板涵盖 headline、quote、flow、road、versus、triad、diagram、roles、allocation 等；部分横版图式沿用竖版整体平移结构，不保证所有内容在两种画幅下都自动适配。`qa-phase1.ts` / `qa-phase2.ts` 是专项回归工具，需要显式传入包含相应模板的本地项目，不适用于六句离线 Demo。

## Skill 使用

让 Agent 读取本仓库 `skill/SKILL.md`，把 `<repository-root>` 理解为实际克隆目录。Skill 所需工程、脚本和引用文档均在本仓库内；不要只复制单独的 SKILL.md 并期待其独立运行。

## 目录

- `src/`：SVG 绘图、角色、模板和时间轴。
- `scripts/`：渲染、音频、QA、字体与轮廓辅助工具。
- `skill/`：Agent 使用说明。
- `public/fonts/`：随附字体与第三方许可证。
- `ref/timing-0-16.json`：演示动作参数，不包含参考视频。
- `projects/`：运行时内容工作区，不进入版本控制。

`fonts.py` 和 `trace_yazai.py` 是维护辅助工具，分别要求显式提供字体来源目录和有权使用的定妆图；正常出片无需运行。字体生成脚本依赖特定 Excalidraw 资源结构。

## 权利与素材

公开可见不等于授予本工程或芽仔 IP 的开源使用许可；本次未添加项目级许可证。使用、修改、再分发或商业使用前，请向权利人取得相应许可。第三方字体遵循各自目录中的 OFL，依赖包遵循其自身许可证。请仅使用有权使用的图像、声音、音乐和人物素材。

仅处理可信的本地分镜与素材；开发服务器用于本机预览，不要公开暴露到互联网。

可选截图文字识别/打码工具 `scripts/mask_deck.py` 依赖 macOS Vision；使用前安装 `python3 -m pip install pyobjc-framework-Vision pyobjc-framework-Cocoa`。非 macOS 不支持该辅助工具。

历史对照工具 `scripts/compare.py` 使用 macOS 系统字体；在其他系统使用前需调整字体来源，不属于默认预览/渲染链路。
