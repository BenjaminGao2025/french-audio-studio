// Signed-in navigation and progress checks; all business requests are mocked.
const fs=require('fs'), path=require('path'), assert=require('node:assert/strict');
const {chromium}=require('/home/mgacai/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const root=path.resolve(__dirname,'../static');
const pages={'/':'index','/study':'study','/review':'review','/coach':'coach','/write':'write','/speak':'speak','/listen':'listen'};
const state={level:36,xp:2210,next_level_xp:2220,progress:.9,hours_total:80,streak_days:1,today:{minutes:90,target:360,logs:[],combo:0},week:{number:2,minutes:180,target:2520,by_lane:{},lane_targets:{},skills:{},focus_skill:{skill:'EE',link:'/write'}}};
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome-stable',headless:true,args:['--no-sandbox']});let checks=0;
 try{
 for(const width of [1440,390])for(const lang of ['zh','en'])for(const theme of ['light','dark']){
  const ctx=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
  await ctx.addInitScript(({lang,theme})=>{localStorage.setItem('frenchStudio.uiLang',lang);localStorage.setItem('frenchStudio.theme',theme);localStorage.setItem('frenchStudio.userToken','header-fixture');}, {lang,theme});
  const writes=[];
  await ctx.route('**/*',route=>{
   const u=new URL(route.request().url()),p=u.pathname;
   if(u.origin!=='http://localhost:8000')return route.abort();
   if(p in pages)return process.env.UI_LIVE?route.continue():route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(root,pages[p]+'.html'),'utf8').replace('__PERSONAL_PRACTICE__',fs.readFileSync(path.join(root,'personal-practice.html'),'utf8')).replaceAll('__ASSET_VERSION__','header-test')});
   if(p.startsWith('/static/'))return process.env.UI_LIVE?route.continue():route.fulfill({contentType:p.endsWith('.css')?'text/css':'application/javascript',body:fs.readFileSync(path.join(root,path.basename(p)),'utf8')});
   if(['/api/write/tasks','/api/speak/tasks'].includes(p))return route.fulfill({json:{recommended_task:'T1',recommended_level:'A1',hours:0,tasks:{},subjects:{},attempts:[]}});
   if(['/api/write/attempts','/api/speak/attempts'].includes(p))return route.fulfill({json:{attempts:[]}});
   if(p==='/api/game/state')return route.fulfill({json:state});
   if(p==='/api/game/log'){writes.push(route.request().postDataJSON());return route.fulfill({json:state});}
   if(p==='/api/auth/me')return route.fulfill({json:{email:'header@example.com',plan:'pro',days_left:30}});
   return route.fulfill({status:401,json:{detail:'Mocked'}});
  });
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const url of Object.keys(pages)){
   await page.goto('http://localhost:8000'+url);
   await page.waitForFunction(()=>document.querySelector('.hud-level-n')?.textContent==='36');
   assert.equal(await page.locator('.nav-tabs > a').count(),3);
   assert.equal(await page.locator('.nav-tabs a[href="/review"]').count(),1);
   assert.equal(await page.locator('.nav-tabs > a:visible').count(),3);
   assert(await page.locator('.preferences-menu').isVisible());
   assert(await page.locator('#theme-select').isHidden());
   assert(await page.locator('.hud-week').isHidden());
   const practice=page.locator('.practice-menu');
   await practice.locator(':scope > summary').click();
   assert.equal(await practice.locator('a:visible').count(),4);
   if(['/','/write','/speak','/listen'].includes(url))assert(await practice.locator('a[aria-current="page"]').isVisible(),url+': '+await practice.innerHTML());
   await page.keyboard.press('Escape');assert.equal(await practice.getAttribute('open'),null);
   await page.locator('.preferences-menu > summary').click();
   await page.locator('#theme-select').selectOption(theme==='dark'?'light':'dark');
   assert.equal(await page.locator('html').getAttribute('data-theme'),theme==='dark'?'light':'dark');
   await page.locator('#theme-select').selectOption(theme);
   const sound=page.locator('.preferences-menu .hud-mute');
   const oldTitle=await sound.getAttribute('title');await sound.click();assert.notEqual(await sound.getAttribute('title'),oldTitle);
   const connection=page.locator('.preferences-menu .connection-settings');
   if(await connection.count()){await connection.locator('summary').click();assert(await connection.locator('select').isVisible());}
   const bounds=await page.locator('.preferences-menu .header-menu').boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width+1);
   await page.keyboard.press('Escape');
   await page.locator('.hud-hero').click();
   assert(await page.locator('.game-progress-summary .hud-week').isVisible());
   assert(await page.locator('.game-progress-summary .hud-xp-text').isVisible());
   assert(await page.locator('.game-progress-summary .hud-focus span').isVisible());
   assert(await page.locator('.game-custom').isVisible());
   await page.locator('.hud-hero').click();
   assert(await page.locator('.game-panel').isHidden());
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert(!overflow,url+' overflow');
   if(url==='/study'){
    await page.locator('#due-card-badge').evaluate(el=>{el.hidden=false;el.textContent='45';});
    await page.screenshot({path:`/tmp/header-${width}-${lang}-${theme}.png`,clip:{x:0,y:0,width,height:width===390?260:190}});
    await page.locator('.hud-hero').click();
    await page.locator('.game-custom [name="minutes"]').fill('10');
    await page.locator('.game-custom button').click();
    await page.waitForFunction(()=>document.querySelector('.hud-hero').getAttribute('aria-expanded')==='true');
    assert(writes.some(w=>w.minutes===10),'Manual time remains available');
   }
   assert.deepEqual(errors,[]);checks++;
  }
  await ctx.close();
 }
 console.log(`PASS ${checks} signed-in header flows: navigation, preferences, sounds, progress, manual logging and responsive layout.`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
