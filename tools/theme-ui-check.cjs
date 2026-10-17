// Mock all requests: check appearance without touching accounts or study data.
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/home/mgacai/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const root = path.resolve(__dirname, '../static');
const pages = {'/':'index', '/study':'study', '/review':'review', '/listen':'listen', '/write':'write', '/speak':'speak', '/coach':'coach', '/homework':'study', '/home':'landing', '/privacy':'privacy', '/for-institutions':'for-institutions'};
(async () => {
 const browser = await chromium.launch({executablePath:'/usr/bin/google-chrome-stable', headless:true, args:['--no-sandbox']});
 let checks = 0;
 try {
  for (const width of [1440, 390]) for (const lang of ['zh', 'en']) {
   const ctx = await browser.newContext({viewport:{width,height:1000}, colorScheme:'dark', reducedMotion:'reduce'});
   await ctx.addInitScript(lang => { localStorage.setItem('frenchStudio.uiLang',lang); },lang);
   await ctx.route('**/*',async route => {
    const u = new URL(route.request().url()), p = u.pathname;
    if (u.origin !== 'http://localhost:8000') return route.abort();
    if (pages[p]) return process.env.UI_LIVE ? route.continue() : route.fulfill({contentType:'text/html', body:fs.readFileSync(path.join(root,pages[p]+'.html'),'utf8').replace('__PERSONAL_PRACTICE__',fs.readFileSync(path.join(root,'personal-practice.html'),'utf8')).replaceAll('__ASSET_VERSION__','test')});
    if (p.startsWith('/static/')) return process.env.UI_LIVE ? route.continue() : route.fulfill({contentType:p.endsWith('.css')?'text/css':'application/javascript',body:fs.readFileSync(path.join(root,path.basename(p)),'utf8')});
    return route.fulfill({status:401,json:{detail:'Mock unauthenticated'}});
   });
   const page = await ctx.newPage(), errors = [];
   page.on('pageerror', e => errors.push(e.message));
   for (const route of Object.keys(pages)) {
    await page.goto('http://localhost:8000'+route);
    await page.locator('#theme-select').waitFor({state:'attached'});
    if (await page.locator('.preferences-menu').count()) await page.locator('.preferences-menu > summary').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark',route+' follows system');
    for (const theme of ['light','dark']) {
     await page.locator('#theme-select').selectOption(theme);
     const state = await page.evaluate(() => {
      const style=getComputedStyle(document.documentElement), rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number);
      const lum=c=>c.map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0);
      const color = token => {const e=document.createElement('span');e.style.color=`var(${token})`;document.body.append(e);const c=rgb(getComputedStyle(e).color);e.remove();return lum(c);};
      const pairs=[['--ink','--surface'],['--muted','--surface-muted'],['--muted','--page'],['--primary','--primary-soft'],['--primary-contrast','--primary'],['--primary-contrast','--primary-hover'],['--danger','--danger-soft'],['--success','--surface-subtle']];
      return {width:innerWidth,scroll:document.documentElement.scrollWidth,theme:document.documentElement.dataset.theme, scheme:style.colorScheme,ratios:pairs.map(([a,b])=>{const x=color(a),y=color(b);return [a,b,(Math.max(x,y)+.05)/(Math.min(x,y)+.05)];})};
     });
     assert.equal(state.theme,theme); assert.equal(state.scheme,theme);
     assert(state.scroll<=state.width+1,`${route} ${width} ${lang} overflow ${state.scroll}`);
     for (const [a,b,ratio] of state.ratios) assert(ratio>=4.5,`${theme} ${a}/${b}: ${ratio}`);
     assert(await page.locator('#theme-select').isVisible());
     checks++;
    }
   }
   // Explicit choice survives reload and system changes; system mode follows live changes.
   await page.reload(); assert.equal(await page.locator('#theme-select').inputValue(),'dark');
   await page.emulateMedia({colorScheme:'light'}); assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
   await page.locator('#theme-select').selectOption('system');
   await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
   await page.emulateMedia({colorScheme:'dark'});
   await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
   const second = await ctx.newPage(); await second.goto('http://localhost:8000/review');
   await second.locator('.preferences-menu > summary').click();
   await second.locator('#theme-select').selectOption('light');
   await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
   await second.locator('#theme-select').selectOption('dark');
   await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
   // Storage failures still permit immediate local switching.
   await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new Error('blocked');};});
   await page.locator('#theme-select').selectOption('light');
   assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
   assert.deepEqual(errors,[]);
   await ctx.close();
  }
  console.log(`PASS ${checks} theme/page checks + persistence, system changes, tab sync and blocked storage.`);
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
