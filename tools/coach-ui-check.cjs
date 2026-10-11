const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/home/mgacai/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const root=path.resolve(__dirname,'../static');
const fixture=JSON.parse(fs.readFileSync(process.env.COACH_FIXTURE||'/tmp/tts-coach-fixture.json','utf8'));
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome-stable',headless:true,args:['--no-sandbox']});let n=0;
 try{
 for(const width of [1440,390])for(const lang of ['zh','en']){
  const ctx=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});let saved=false,submissions=[],hints=0;
  await ctx.addInitScript(lang=>{localStorage.setItem('frenchStudio.userToken','mock');localStorage.setItem('frenchStudio.uiLang',lang);},lang);
  await ctx.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url()),p=u.pathname;
   if(u.origin!=='http://localhost:8000')return route.abort();
   if(['/coach','/write','/listen'].includes(p))return route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(root,p.slice(1)+'.html'),'utf8').replaceAll('__ASSET_VERSION__','test')});
   if(p.startsWith('/static/')){const f=path.join(root,path.basename(p));return route.fulfill({contentType:p.endsWith('.css')?'text/css':'application/javascript',body:fs.readFileSync(f,'utf8')});}
   const json=d=>route.fulfill({json:d});
   if(p==='/api/coach')return json(saved?fixture.dashboard:{setup:false});
   if(p==='/api/coach/profile'){saved=true;return json(fixture.dashboard);}
   if(p==='/api/coach/plan')return json(fixture.dashboard);
   if(p==='/api/coach/review')return json({...fixture.dashboard,review_due:false,last_review:{date:'2026-10-11',advice:'Start with short sentences.'}});
   if(p==='/api/write/tasks')return json(fixture.writing);
   if(p==='/api/write/attempts'&&req.method()==='GET')return json({attempts:[]});
   if(p==='/api/write/attempts'&&req.method()==='POST'){submissions.push(req.postDataJSON());return json({id:'write1',status:'generating_1'});}
   if(p==='/api/write/attempts/write1')return json({id:'write1',status:'ready',feedback_1:{praise:'You wrote three sentences.',word_count:{actual:10,min:6,max:35,in_range:true},errors:[],checklist:[],register:{fits:true,choice:'tu'}}});
   if(p==='/api/episodes')return json({episodes:[],recommended_level:'A1',hours:0});
   if(p==='/api/coach/listen')return json(fixture.check);
   if(p.endsWith('/hint')){hints++;return json({lines:[['Bonjour. Je voudrais un café.','我想要一杯咖啡。','I would like a coffee.']]});}
   if(p.endsWith('/answers'))return json({score:3,total:3,correct:[0,1,2],assisted:true});
   if(p==='/api/auth/me')return json({email:'ui@example.com',plan:'pro',days_left:30});
   if(p==='/api/game/state')return route.fulfill({status:401,json:{}});
   // All other requests, including audio and model calls, stay blocked.
   return route.fulfill({status:403,json:{detail:'Blocked by UI fixture'}});
  });
  const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  async function check(label){await page.waitForTimeout(100);assert.deepEqual(errors,[],label);const dims=await page.evaluate(()=>[innerWidth,document.documentElement.scrollWidth]);if(dims[1]>dims[0]+1){console.log(await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).map(el=>({tag:el.tagName,cls:el.className,id:el.id,right:el.getBoundingClientRect().right})).slice(0,15)));await page.screenshot({path:'/tmp/coach-overflow.png',fullPage:true});}assert(dims[1]<=dims[0]+1,label+': overflow '+dims);n++;}
  await page.goto('http://localhost:8000/coach');await page.locator('#coach-onboarding').waitFor({state:'visible'});
  await page.locator('#coach-next').click();await page.locator('#coach-next').click();await page.locator('#coach-save').click();await page.locator('#coach-dashboard').waitFor({state:'visible'});await check('coach dashboard');assert(await page.locator('#coach-dashboard .editor-panel').evaluateAll(els=>els.every(el=>el.scrollHeight<=el.clientHeight+1)), 'coach panels must not clip content');
  assert(await page.locator('.coach-task').count()>0);await page.screenshot({path:`/tmp/coach-${width}-${lang}.png`,fullPage:true});
  await page.locator('#coach-review').click();await page.waitForFunction(()=>document.getElementById('coach-last-review').textContent.includes('Start'));await check('weekly review');
  await page.goto('http://localhost:8000/write');await page.waitForFunction(()=>document.getElementById('subject-title').textContent.length>0);
  assert.equal(await page.locator('#write-mode').inputValue(),'practice');assert.equal(await page.locator('#practice-stage').inputValue(),'P0');assert.equal(await page.locator('#btn-timer-toggle').isVisible(),false);
  await page.locator('#write-input').fill('Je voudrais un café. Sans sucre. Ça coûte trois euros.');await page.locator('#btn-submit-r1').click();await page.waitForFunction(()=>document.getElementById('r1-praise-text').textContent.includes('three'));
  assert.equal(submissions[0].task,'P0');assert.equal(submissions[0].level,'A1');await check('starter writing');
  await page.locator('#practice-stage').selectOption('P2');assert.match(await page.locator('#word-count-range').textContent(),/40–80/);
  await page.locator('#write-mode').selectOption('exam');assert.match(await page.locator('#word-count-range').textContent(),/60–120/);assert(await page.locator('#btn-timer-toggle').isVisible());await check('exam mode');
  await page.locator('#write-mode').selectOption('practice');await page.locator('#practice-stage').selectOption('P0');assert.match(await page.locator('#write-input').inputValue(),/café/);await check('draft retained');
  await page.screenshot({path:`/tmp/write-${width}-${lang}.png`,fullPage:true});
  await page.goto('http://localhost:8000/listen');await page.locator('#mini-start').click();await page.locator('#mini-work').waitFor({state:'visible'});assert(!(await page.locator('#mini-lines').isVisible()));await page.locator('#mini-hint').click();await page.locator('#mini-lines').waitFor({state:'visible'});assert.equal(hints,1);
  // Simulate finished playback after three lines; never call production speech.
  await page.locator('#mini-level').selectOption('A1');await page.locator('#mini-start').click();await page.waitForFunction(()=>!document.getElementById('mini-start').disabled);await page.locator('#mini-work').waitFor({state:'visible'});
  // The fixture level is starter. Its three ended events exhaust the sequence.
  await page.evaluate(()=>{const a=document.getElementById('mini-audio');for(let i=0;i<3;i++)a.dispatchEvent(new Event('ended'));});
  for(let i=0;i<3;i++)await page.locator(`input[name=q${i}][value="${[0,1,2][i]}"]`).check();
  await page.locator('#mini-submit').click();await page.waitForFunction(()=>document.getElementById('mini-result').textContent.includes('3 / 3'));await check('listening result');await page.screenshot({path:`/tmp/listen-${width}-${lang}.png`,fullPage:true});
  console.log(`${width}/${lang}: coach, review, writing stages, drafts and listening passed`);
  await ctx.close();
 }
 console.log(`PASS ${n} browser flow checks (desktop/mobile, Chinese/English; all external effects mocked).`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
