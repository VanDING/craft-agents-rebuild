import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const out=process.argv[3] ?? '.cache/ui-refinement';
const url=process.argv[2] ?? 'http://127.0.0.1:5189/playground.html';
await mkdir(out,{recursive:true});
const themeModule='/@fs/'+process.cwd().replaceAll('\\','/')+'/packages/shared/src/config/theme.ts';
const b=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
const results=[];
try {
 const p=await b.newPage({viewport:{width:1500,height:2200}});
 await p.addInitScript(()=>{localStorage.setItem('playground-selected-component','control-system');localStorage.setItem('playground-preview-size',JSON.stringify({width:800,height:1950}));localStorage.setItem('playground-variants-sidebar-open','false')});
 await p.goto(url,{waitUntil:'domcontentloaded',timeout:120000});
 const sample=p.getByTestId('control-system'); await sample.waitFor({timeout:120000});
 for(const dark of [false,true]) {
  await p.evaluate(d=>document.documentElement.classList.toggle('dark',d),dark);
  await sample.screenshot({path:`${out}/settings-${dark?'dark':'light'}.png`});
 }
 await p.evaluate(()=>document.documentElement.classList.remove('dark'));
 for(const depth of ['flat','glass','raised','neon']) {
  const stats=await p.evaluate(async ({depth,themeModule})=>{
   const {themeToCSS}=await import(themeModule);
   document.documentElement.style.cssText=themeToCSS({depth,radius:depth==='flat'?'0.25rem':'1rem',density:depth==='flat'?'compact':'cozy'});
   const el=document.querySelector('[data-testid="control-system"] input');
   return {depth,computed:getComputedStyle(document.documentElement).getPropertyValue('--theme-depth'),radius:getComputedStyle(el).borderRadius,invalid:document.querySelector('input[aria-invalid="true"]').getAttribute('aria-describedby')};
  },{depth,themeModule});
  assert.equal(stats.computed.trim(),depth);assert(stats.invalid);results.push(stats);
  await sample.screenshot({path:`${out}/theme-${depth}.png`});
 }
 await p.evaluate(()=>document.documentElement.style.cssText='');
 for(const width of [420,390]) {
  await sample.evaluate((el,w)=>{el.style.width=`${w}px`;el.parentElement.parentElement.style.width=`${w}px`},width);
  const metrics=await sample.evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,rows:[...el.querySelectorAll('.craft-settings-card .craft-settings-row:not(:has([data-slot="switch"]))')].map(e=>({direction:getComputedStyle(e).flexDirection,align:getComputedStyle(e).alignItems,controlWidth:e.querySelector('[data-layout="settings-control"]').getBoundingClientRect().width,available:e.clientWidth-parseFloat(getComputedStyle(e).paddingLeft)-parseFloat(getComputedStyle(e).paddingRight)}) )}));
  assert(metrics.scroll<=metrics.width,JSON.stringify(metrics));assert(metrics.rows.every(x=>x.direction==='column'&&x.align==='stretch'&&Math.abs(x.controlWidth-x.available)<1));results.push({width,...metrics});
  await sample.screenshot({path:`${out}/settings-${width}.png`});
 }
 await p.evaluate(()=>document.documentElement.style.fontSize='20px');
 assert(await sample.evaluate(el=>el.scrollWidth<=el.clientWidth),'125% text sizing overflow');results.push({textScale:'125%',overflow:false});
 await p.evaluate(()=>document.documentElement.style.cssText='');
 await p.getByTitle('Show variants',{exact:true}).click();
 for(const count of [100,1000]) {
  await p.getByRole('button',{name:`${count} rows`,exact:true}).click();
  const list=p.getByTestId('control-list');await list.waitFor();assert.equal(await list.locator('.entity-row-btn').count(),count);
  const frames=await list.evaluate(async el=>{const times=[];let prev=performance.now();for(let i=0;i<60;i++){await new Promise(requestAnimationFrame);const now=performance.now();times.push(now-prev);prev=now;el.scrollTop=el.scrollHeight*i/60}return times});
  results.push({count,scrollFramesMs:frames});
 }
 await writeFile(`${out}/theme-layout-list.json`,JSON.stringify(results,null,2));console.log('PASS theme, narrow layout, text scale, 100/1000 row scroll');
} finally {await b.close()}
