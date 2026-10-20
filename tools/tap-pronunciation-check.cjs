// Touch + keyboard checks. All network and audio are mocked; no learning data is written.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/home/mgacai/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const root=path.resolve(__dirname,'../static');
const sentence={sentence:"Je viens de Pékin, en Chine, mais j'étais étudiant.",original:"Je viens de Pékin, en Chine, mais j'étais étudiant.",translation_en:'I come from Beijing, in China, but I was a student.',translation_zh:'我来自中国北京，之前是一名学生。',words:[],alignment:[],grammar_points:[],pronunciation_tips:[],build_up:[{fr:'Je viens de Pékin.',en:'I come from Beijing.'},{fr:'Je viens de Pékin, en Chine.',en:'I come from Beijing, in China.',new:'en Chine'},{fr:"Je viens de Pékin, en Chine, mais j'étais étudiant.",en:'I come from Beijing, in China, but I was a student.',new:"mais j'étais étudiant"}]};
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome-stable',headless:true,args:['--no-sandbox']});let checks=0;
 try{
 for(const lang of ['zh','en'])for(const theme of ['light','dark']){
  const ctx=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce'});
  await ctx.addInitScript(({lang,theme})=>{
   localStorage.setItem('frenchStudio.uiLang',lang);localStorage.setItem('frenchStudio.theme',theme);localStorage.setItem('frenchStudio.userToken','touch-fixture');
   window.testPronunciations=[];
   window.testAudioStates=new Map();
   window.testSpoken=null;
   speechSynthesis.speak=function(utterance){window.testSpoken=utterance.text;window.testUtterance=utterance;};
   speechSynthesis.cancel=function(){window.testSpoken=null;};
   Object.defineProperty(HTMLMediaElement.prototype,'paused',{get(){return window.testAudioStates.get(this)!==true;}});
   HTMLMediaElement.prototype.pause=function(){window.testAudioStates.set(this,false);this.dispatchEvent(new Event('pause'));};
   HTMLMediaElement.prototype.play=function(){window.testAudioStates.set(this,true);const u=new URL(this.src,location.href);if(u.pathname==='/tts')window.testPronunciations.push(u.searchParams.get('text'));return Promise.resolve();};
  },{lang,theme});
  await ctx.route('**/*',route=>{
   const u=new URL(route.request().url()),p=u.pathname;
   if(u.origin!=='http://localhost:8000')return route.abort();
   if(p==='/study')return process.env.UI_LIVE?route.continue():route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(root,'study.html'),'utf8').replace('__PERSONAL_PRACTICE__',fs.readFileSync(path.join(root,'personal-practice.html'),'utf8')).replaceAll('__ASSET_VERSION__','touch-test')});
   if(p.startsWith('/static/'))return process.env.UI_LIVE?route.continue():route.fulfill({contentType:p.endsWith('.css')?'text/css':'application/javascript',body:fs.readFileSync(path.join(root,path.basename(p)),'utf8')});
   if(p==='/api/lookup')return route.fulfill({json:{token:u.searchParams.get('word'),explanation_en:'Test meaning.',explanation_cn:'测试释义'}});
   if(p==='/api/auth/me')return route.fulfill({json:{email:'touch@example.com',plan:'pro',days_left:30}});
   return route.fulfill({status:401,json:{detail:'Blocked by touch fixture'}});
  });
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:8000/study');
  await page.waitForFunction(()=>window.FrenchHistory&&window.FrenchHistory.onRestoreStudy);
  await page.evaluate(s=>window.FrenchHistory.onRestoreStudy({text:s.sentence,sentences:[s,{...s,sentence:"Bonjour.",original:"Bonjour.",build_up:[]}],sentenceCount:2}),sentence);
  const card=page.locator('.sentence-card').first();
  await card.locator('.btn-speak-round').evaluate(button=>button.click());
  await page.evaluate(()=>{window.externalRecording=new Audio('/my-recording');return externalRecording.play();});
  assert(await card.locator('.btn-speak-round').isEnabled(),'External recording must reset sentence UI');
  assert.equal(await page.evaluate(()=>[...testAudioStates.values()].filter(Boolean).length+(testSpoken?1:0)),1);
  await page.evaluate(()=>FrenchPlayback.setRepeat(true));
  await card.locator('.btn-speak-round').evaluate(button=>button.click());
  await page.waitForTimeout(100);
  const loopBefore=await page.evaluate(()=>{
   const n=testPronunciations.length;
   if(testSpoken){testSpoken=null;testUtterance.onend(new Event('end'));}
   else {const a=[...testAudioStates].find(([,playing])=>playing)[0];testAudioStates.set(a,false);a.dispatchEvent(new Event('ended'));}
   return n;
  });
  await page.waitForFunction(n=>testPronunciations.length>n,loopBefore);
  assert(await card.locator('.btn-speak-round').isDisabled(),'Repeat must stay active across clips');
  await page.evaluate(()=>{FrenchPlayback.stop();FrenchPlayback.setRepeat(false);});
  if((await card.getAttribute('class')).includes('is-open'))await card.locator('.sentence-toggle').tap();
  async function say(locator,word,keyboard=false){
   await page.keyboard.press('Escape');
   await card.locator('.btn-speak-round').evaluate(button=>button.click());
   assert(await card.locator('.btn-speak-round').isDisabled());
   const before=await page.evaluate(()=>testPronunciations.length);
   if(keyboard){await locator.focus();await page.keyboard.press('Enter');}else await locator.tap();
   await page.waitForFunction(n=>testPronunciations.length>n,before);
   assert.deepEqual(await page.evaluate(n=>testPronunciations.slice(n),before),[word]);assert(await card.locator('.btn-speak-round').isEnabled(),'Sentence play button must reset after a word interrupts it');
   assert.equal(await page.evaluate(()=>[...testAudioStates.values()].filter(Boolean).length+(testSpoken?1:0)),1,'Only the requested word may remain playing');
   await page.keyboard.press('Escape');checks++;
  }
  await say(card.locator('.sentence-french-text .interactive-word[data-word="Pékin"]'),'Pékin');
  assert(!(await card.getAttribute('class')).includes('is-open'),'Word tap must not expand/collapse the card');
  await card.locator('.sentence-toggle').tap();
  await say(card.locator('.buildup-step-row').nth(0).locator('[data-word="Pékin"]'),'Pékin');
  await say(card.locator('.buildup-step-row').nth(1).locator('[data-word="viens"]'),'viens');
  await say(card.locator('.buildup-step-row').nth(1).locator('[data-word="Chine"]'),'Chine');
  await say(card.locator('.buildup-step-row').nth(2).locator('[data-word="j\'étais"]'),"j'étais");
  await say(card.locator('.buildup-step-row').nth(0).locator('[data-word="viens"]'),'viens',true);
  const before=await page.evaluate(()=>testPronunciations.length);
  await card.locator('.buildup-step-row').first().locator('.buildup-en-text').tap();
  await card.locator('.card-tab-btn[data-tab="explain"]').tap();
  assert.equal(await page.evaluate(()=>testPronunciations.length),before,'English translation/UI stays silent');
  await card.locator('.card-tab-btn[data-tab="buildup"]').tap();
  await card.locator('.btn-feynman-toggle[data-mode="blind"]').tap();
  const hidden=card.locator('.buildup-step-row').nth(1).locator('[data-word="Chine"]');
  await hidden.tap();assert(await hidden.evaluate(el=>el.closest('.buildup-new-token').classList.contains('revealed')));
  assert.equal(await page.evaluate(()=>testPronunciations.length),before,'Blind-mode reveal must stay silent');
  await hidden.focus();await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>testPronunciations.length),before,'Keyboard reveal must stay silent');checks+=3;
  // Re-query a base-form word inside the same popup, bypassing a sentence phrase match.
  await page.evaluate(()=>{
   window.activeTokensMap.set('viens',{token:'viens de',lemma:'venir de',pos:'v. loc.',explanation_en:'Phrase meaning',explanation_cn:'短语释义'});
   window.activeTokensMap.set('venir',{token:'viens de',lemma:'venir de',explanation_en:'WRONG phrase redirection',explanation_cn:'错误的短语跳转'});
  });
  await card.locator('.sentence-french-text [data-word="viens"]').tap();
  const popup=page.locator('.floating-word-popover');
  assert.match(await popup.locator('.popover-lemma').textContent(),/venir de/);
  assert.equal(await popup.locator('[data-lemma-word]').count(),2);
  const previous=await popup.locator('.popover-word').textContent();
  const priorAudio=await page.evaluate(()=>testPronunciations.length);
  await popup.locator('[data-lemma-word="venir"]').tap();
  assert.equal(await popup.locator('.popover-word').textContent(),'venir');
  assert.match(await popup.locator('.popover-cn-text').textContent(),lang==='en'?/to come/:/来/);
  assert.deepEqual(await page.evaluate(n=>testPronunciations.slice(n),priorAudio),['venir']);
  assert.equal(await page.locator('.floating-word-popover:visible').count(),1);
  await popup.locator('.popover-back').tap();
  assert.equal(await popup.locator('.popover-word').textContent(),previous);
  assert(await popup.locator('.popover-back').isHidden());
  await popup.locator('[data-lemma-word="venir"]').focus();await page.keyboard.press('Enter');
  assert.equal(await popup.locator('.popover-word').textContent(),'venir');
  await popup.locator('.popover-back').tap();
  await popup.locator('[data-lemma-word="de"]').tap();
  assert.equal(await popup.locator('.popover-word').textContent(),'de');
  await page.keyboard.press('Escape');
  await card.locator('.sentence-french-text [data-word="Pékin"]').tap();
  assert(await popup.locator('.popover-back').isHidden(),'Fresh page lookup resets popup history');checks+=7;
  // Every phrase title supports nested lookup, even without a separate base-form row.
  await page.keyboard.press('Escape');
  await page.evaluate(s=>window.FrenchHistory.onRestoreStudy({text:s.sentence,sentences:[{...s,sentence:'En fait, je vais prendre soin de toi.',words:[{fr:'en fait',lemma:'en fait',type:'fixed phrase',meaning:'in fact, actually. “fait” is part of “en fait”.',meaning_zh:'实际上。「fait」是「en fait」的一部分。'},{fr:'prendre soin',meaning:'to take care',meaning_zh:'照顾'}]}],sentenceCount:1}),sentence);
  await card.locator('.sentence-french-text [data-word="En"]').tap();
  assert.equal(await popup.locator('.popover-word [data-lookup-word]').count(),2);
  assert(await popup.locator('.popover-lemma').isHidden());
  const phraseAudio=await page.evaluate(()=>testPronunciations.length);
  await popup.locator('.popover-word [data-lookup-word="fait"]').tap();
  assert.equal(await popup.locator('.popover-word').textContent(),'fait');
  assert.match(await popup.locator('.popover-cn-text').textContent(),lang==='en'?/fact/:/事实/);
  assert.deepEqual(await page.evaluate(n=>testPronunciations.slice(n),phraseAudio),['fait']);
  await popup.locator('.popover-lemma [data-lookup-word="faire"]').tap();
  assert.equal(await popup.locator('.popover-word').textContent(),'faire');
  await popup.locator('.popover-back').tap();
  assert.equal(await popup.locator('.popover-word').textContent(),'fait');
  await popup.locator('.popover-back').tap();
  assert.equal(await popup.locator('.popover-word').textContent(),'en fait');
  await popup.locator('.popover-cn-text [data-lookup-word="fait"]').first().tap();
  assert.equal(await popup.locator('.popover-word').textContent(),'fait');
  await popup.locator('.popover-back').tap();
  await popup.locator('.popover-word [data-lookup-word="en"]').focus();await page.keyboard.press('Enter');
  assert.equal(await popup.locator('.popover-word').textContent(),'en');
  await popup.locator('.popover-back').tap();
  assert(await popup.locator('.popover-back').isHidden());
  // A word outside the built-in dictionary uses the server, and can still go back.
  await page.keyboard.press('Escape');
  await card.locator('.sentence-french-text [data-word="prendre"]').tap();
  await popup.locator('.popover-word [data-lookup-word="soin"]').tap();
  await page.waitForFunction(()=>document.querySelector('.popover-cn-text').textContent.match(/Test meaning|测试释义/));
  assert.equal(await popup.locator('.popover-word').textContent(),'soin');
  await popup.locator('.popover-back').tap();
  assert.equal(await popup.locator('.popover-word').textContent(),'prendre soin');checks+=12;
  assert.deepEqual(errors,[]);
  await page.screenshot({path:`/tmp/touch-pronunciation-${lang}-${theme}.png`,fullPage:true});
  await ctx.close();
 }
 console.log(`PASS ${checks} checks: phone taps, keyboard, English silence, blind-mode reveal and nested base-form lookup/back navigation.`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
