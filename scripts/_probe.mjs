import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({viewport:{width:1440,height:900}})).newPage();
await p.goto('http://127.0.0.1:9180/docs.html#/self-host',{waitUntil:'networkidle'});
await p.waitForTimeout(800);
const r = await p.evaluate(()=>{
  const s=document.getElementById('sidebar'), sh=document.querySelector('.shell'), t=document.getElementById('toc'), d=document.querySelector('.doc');
  const cs=getComputedStyle(s);
  return {pos:cs.position, top:cs.top, h:cs.height, align:cs.alignSelf, ovf:cs.overflowY,
    shellH:sh.getBoundingClientRect().height, sideRect:s.getBoundingClientRect(),
    scrollH:s.scrollHeight, clientH:s.clientHeight,
    docRect:d.getBoundingClientRect(), tocRect:t.getBoundingClientRect(),
    shellRect:sh.getBoundingClientRect(),
    ancOverflow: (()=>{let e=s.parentElement,o=[];while(e&&e!==document.documentElement){const c=getComputedStyle(e);if(c.overflow!=='visible'||c.overflowX!=='visible'||c.overflowY!=='visible')o.push(e.className+':'+c.overflow+'/'+c.overflowX+'/'+c.overflowY);e=e.parentElement}return o})()};
});
console.log(JSON.stringify(r,null,1));
await p.evaluate(()=>window.scrollTo(0,1600)); await p.waitForTimeout(300);
console.log('after scroll', JSON.stringify(await p.evaluate(()=>{const s=document.getElementById('sidebar');return {rect:s.getBoundingClientRect(), scrollY:window.scrollY}})));
await b.close();
