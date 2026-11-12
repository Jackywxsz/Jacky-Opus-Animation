// 第二期真实浏览器验收：图标转换/加载、双画幅抽帧、曲线位置、演员回位及逐帧安全区。
import { createServer } from "vite";
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
const args=process.argv.slice(2);
const project=args.includes("--p") ? args[args.indexOf("--p")+1] : undefined;
if (!project) throw new Error("Specify --p <project> containing phase-2 templates");
const root=resolve("."),out=join(root,"projects",project,"out"),dir=join(out,"phase2");
mkdirSync(dir,{recursive:true});mkdirSync(join(out,"stills"),{recursive:true});
const server=await createServer({root,server:{port:0,strictPort:false,hmr:false,watch:null},logLevel:"error"});
await server.listen();const port=(server.httpServer!.address() as {port:number}).port;
const browser=await chromium.launch({channel:"chrome"});
const checks:string[]=[],fails:string[]=[],records:any[]=[];
try {
  for(const fmt of ["3x4","16x9"]) {
    const page=await browser.newPage({viewport:fmt==="3x4"?{width:1080,height:1440}:{width:1920,height:1080}});
    // tsx 的具名函数辅助标记需要在 Playwright 序列化的闭包里可用，仅作用于测试页。
    await page.addInitScript("window.__name = (value) => value");
    console.log(`开始 ${fmt} 专项验收`);
    page.on("pageerror",e=>fails.push(e.message));
    await page.goto(`http://localhost:${port}/?render&p=${encodeURIComponent(project)}&fmt=${fmt}&pip=none`);
    await page.waitForFunction(()=>window.__ready===true,null,{timeout:60000});
    const data=await page.evaluate(()=>({yz:window.__yazai,events:window.__events,scenes:Array.from(document.querySelectorAll<SVGGElement>("[data-scene]")).map(g=>({line:Number(g.dataset.scene),template:g.dataset.template!,start:Number(g.dataset.start),times:Array.from(g.querySelectorAll<SVGGElement>("[data-item]")).map(n=>Number(n.dataset.on))}))})) as any;
    const shot=async(name:string,t:number)=>{
      await page.evaluate(t=>window.__seek(t),t);const file=`p2-${fmt}-${name}-${t.toFixed(3)}.png`;
      await page.locator("#stage").screenshot({path:join(out,"stills",file)});records.push({fmt,name,t,file});
    };
    for(const template of ["road","versus","triad","flow"]) {
      const index=data.scenes.findIndex((s:any)=>s.template===template),sc=data.scenes[index],end=data.scenes[index+1].start;
      const timed=sc.times.filter((t:number)=>t>sc.start);
      console.log(`${fmt} ${template} 抽帧与安全区`);
      const on=Math.min(...timed),done=Math.min(end-0.2,template==="road"?Math.max(...data.yz.routes.map((r:any)=>r.t+r.duration))+.15:Math.max(...timed)+0.67);
      await shot(`${template}-appearing`,on+0.12);await shot(`${template}-complete`,done);await shot(`${template}-middle`,(sc.start+end)/2);
      // 新模板每 0.1 秒扫一帧；不放宽安全区阈值，道路自身仍做边界检查。
      const problems=await page.evaluate(({start,end})=>{
        const out:string[]=[];const vis=(n:Element)=>(n as SVGGElement).checkVisibility({opacityProperty:true,visibilityProperty:true});
        const intersect=(a:DOMRect,b:{left:number;right:number;top:number;bottom:number})=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
        for(let t=start+0.4;t<end;t+=0.1) {
          window.__seek(t);
          const yz=document.querySelector<SVGGElement>('[id^="yazai"]')!;
          const symbols=Array.from(yz.querySelectorAll<SVGGElement>("[data-symbol]")).filter(n=>n.getAttribute("display")!=="none");
          symbols.forEach(n=>n.setAttribute("display","none"));const r=yz.getBoundingClientRect();symbols.forEach(n=>n.setAttribute("display","inline"));
          const y={left:r.x+r.width*.12,right:r.x+r.width*.88,top:r.y+r.height*.05,bottom:r.y+r.height*.95};
          const items=Array.from(document.querySelectorAll<SVGGElement>("[data-item]")).filter(vis);
          for(const n of items) {
            const b=n.getBoundingClientRect();
            // flow 父框包含尚未显示的勾选角标；只按实际可见轮廓检查，防止把留白当作遮挡。
            const shapes=n.closest('[data-template="flow"]')?Array.from(n.querySelectorAll<SVGGraphicsElement>("path,text,circle,rect")).filter(vis).map(p=>p.getBoundingClientRect()):[b];
            if(!n.hasAttribute("data-road")&&shapes.some(b=>intersect(b,y)>900))out.push(`${t.toFixed(2)}s 芽仔遮挡 ${n.textContent?.trim()||n.dataset.icon||"图形"} actor=${[r.x,r.y,r.width,r.height].map(Math.round)} item=${[b.x,b.y,b.width,b.height].map(Math.round)}`);
            const zones=innerHeight===1440?[{left:930,right:1080,top:800,bottom:1440},{left:40,right:400,top:880,bottom:1150},{left:0,right:1080,top:1158,bottom:1440}]:[{left:1680,right:1920,top:0,bottom:1080},{left:0,right:1920,top:905,bottom:1080}];
            if(zones.some(z=>intersect(b,z)>900))out.push(`${t.toFixed(2)}s 内容进入安全区 ${n.textContent?.trim()||"图形"}`);
            const minX=innerHeight===1440?60:0,maxX=innerHeight===1440?1020:1680;
            // 弹出/砸下的短暂外扩单独抽帧检查；静态边界不容许越界。
            if(t-Number(n.dataset.on)>0.7 && (b.left<minX-3||b.right>maxX+3||b.top<0))out.push(`${t.toFixed(2)}s 静态内容越界 ${Math.round(b.left)},${Math.round(b.right)}`);
          }
        }
        return [...new Set(out)];
      },{start:sc.start,end});
      if(problems.length)fails.push(`${fmt} ${template}: ${problems.slice(0,12).join("；")}（共 ${problems.length}）`);
      else checks.push(`${fmt} ${template} 每 0.1 秒内容/角色遮挡和安全区检查通过`);
    }
    // 图标必须已生成实际 path；flow 原有演员与跳跃机制保留。
    const icons=await page.evaluate(()=>Array.from(document.querySelectorAll("[data-icon]")).map(g=>({name:g.getAttribute("data-icon"),paths:g.querySelectorAll("path").length})));
    checks.push(`${fmt} 图标已绘制：${JSON.stringify(icons)}`);
    if(icons.length!==7||icons.some(i=>!i.paths))fails.push(`${fmt} 图标未完整预加载或 versus 错画了 robot`);
    const route=data.yz.routes as {t:number;duration:number;from:number;to:number;points:number[][]}[];
    if(route.length!==4||data.yz.walks!==1||data.yz.roadWalks!==4)fails.push(`${fmt} road 走动预算不正确`);
    for(const [i,r] of route.entries()) {
      const t=r.t+r.duration*.5,u=(r.from+r.to)/2,a=1-u,p=r.points;
      const expected={x:a*a*a*p[0][0]+3*a*a*u*p[1][0]+3*a*u*u*p[2][0]+u*u*u*p[3][0],y:a*a*a*p[0][1]+3*a*a*u*p[1][1]+3*a*u*u*p[2][1]+u*u*u*p[3][1]};
      const actual=await page.evaluate(t=>{window.__seek(t);const g=document.querySelector<SVGGElement>('[id^="yazai"]')!;const m=g.transform.baseVal.consolidate()!.matrix;return{x:m.e,y:m.f,s:Math.hypot(m.a,m.b)};},t);
      if(Math.abs(actual.x-expected.x)>.02||Math.abs(actual.y-expected.y)>9||Math.abs(actual.s-.32)>.001)fails.push(`${fmt} 第 ${i+1} 段未沿曲线 ${JSON.stringify({actual,expected})}`);
      await shot(`road-walk-${i+1}`,t);
    }
    checks.push(`${fmt} road 4 段曲线中点核对完成；普通走动 ${data.yz.walks} 次`);
    const ri=data.scenes.findIndex((s:any)=>s.template==="road"),next=data.scenes[ri+1].start;
    const reset=await page.evaluate(t=>{window.__seek(t);const m=document.querySelector<SVGGElement>('[id^="yazai"]')!.transform.baseVal.consolidate()!.matrix;return{x:m.e,s:Math.hypot(m.a,m.b)};},next+.5);
    if(Math.abs(reset.x-(fmt==="3x4"?845:1770))>1||Math.abs(reset.s-(fmt==="3x4"?.55:.62))>.001)fails.push(`${fmt} road 换场未回默认站位`);
    else checks.push(`${fmt} road 换场回默认站位通过`);
    // 动态导入的是本地被测模块；不添加依赖，也不改正式分镜来测错误分支。
    const conversion=await page.evaluate(async()=>{
      const path="/src/components/icons.ts";const m=await import(/* @vite-ignore */ path);
      const paths=m.svgPaths('<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 2L3 4"/><line x1="1" y1="2" x2="3" y2="4"/><circle cx="12" cy="12" r="3"/><rect x="1" y="2" width="8" height="6" rx="2" ry="1"/><polyline points="1,2 3,4 5,6"/><polygon points="1 2 3 4 5 6"/><path stroke="none" fill="none" d="M0 0h24v24H0z"/></svg>');
      let error="";try{await m.preloadIcons({icon:"nonexistent-phase2-icon"});}catch(e){error=(e as Error).message;}
      return{paths,error,names:[...m.collectIcons({steps:[{icon:"target"},{icon:"target"}],right:{icon:"robot"}})]};
    });
    if(conversion.paths.length!==6||conversion.paths.some((p:string)=>/NaN|undefined/.test(p))||conversion.error!=="图标「nonexistent-phase2-icon」不存在，到 https://tabler.io/icons 查英文名"||conversion.names.length!==2)fails.push(`${fmt} 图标转换或错误提示失败`);
    else checks.push(`${fmt} 六种 SVG 元素转换、去重、缺失图标报错通过`);
    const t=route[2].t+route[2].duration*.35;
    const get=()=>page.evaluate(t=>{window.__seek(t);return Array.from(document.querySelectorAll<SVGGraphicsElement>("#stage path,#stage text,#stage circle,#stage rect")).filter(n=>n.checkVisibility({opacityProperty:true,visibilityProperty:true})).map(n=>n.outerHTML+n.getScreenCTM()?.toString()).join("|");},t);
    const first=await get();await page.evaluate(()=>window.__seek(window.__duration-.1));const second=await get();
    if(first!==second)fails.push(`${fmt} 路线随机 seek 状态不一致`);else checks.push(`${fmt} 路线随机 seek 状态一致`);
    await page.close();
  }
}finally{await browser.close();await server.close();}
writeFileSync(join(dir,"visual-checks.json"),JSON.stringify({checks,fails,records},null,2));
console.log(checks.join("\n"));console.log(fails.length?fails.map(x=>`✗ ${x}`).join("\n"):`✓ 第二期专项验收通过，${records.length} 张帧`);
if(fails.length)process.exitCode=1;
