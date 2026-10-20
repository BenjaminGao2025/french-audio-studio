// Word tap targets on /study, measured the way a finger hits them (Chromium with touch emulation).
// Network and audio are mocked; no learning data is written. Run: node tools/word-tap-targets-check.cjs
// Set WORD_TAP_REPORT=1 to print the raw measurements (used for word-tap-report.md).
const fs=require('fs'),path=require('path'),strict=require('node:assert/strict');
// WORD_TAP_SOFT=1 lists every failing check instead of stopping at the first one
const failures=[];
const soft=fn=>(...args)=>{try{return fn(...args);}catch(e){failures.push(String(e.message).split('\n')[0]);}};
const attempt=async fn=>{try{await fn();}catch(e){if(!process.env.WORD_TAP_SOFT)throw e;failures.push(String(e.message).split('\n')[0]);}};
const assert=process.env.WORD_TAP_SOFT?Object.assign(soft(strict),{equal:soft(strict.equal),notEqual:soft(strict.notEqual),deepEqual:soft(strict.deepEqual)}):strict;
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/home/mgacai/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const root=path.resolve(__dirname,'../static');
const TEXT="J'ai déjà deux enfants, et ma femme est enceinte, donc nous cherchons un appartement plus grand.";
const sentence={sentence:TEXT,original:TEXT,translation_en:'I already have two children, and my wife is pregnant, so we are looking for a bigger flat.',translation_zh:'我已经有两个孩子了，我妻子怀孕了，所以我们在找更大的公寓。',words:[],alignment:[],grammar_points:[],pronunciation_tips:[],build_up:[{fr:"J'ai déjà deux enfants.",en:'I already have two children.'},{fr:"J'ai déjà deux enfants, et ma femme est enceinte.",en:'I already have two children, and my wife is pregnant.',new:'et ma femme est enceinte'}]};
const report={};
async function open(browser,{touch}){
 const ctx=await browser.newContext(touch?{viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce'}:{viewport:{width:1100,height:800},reducedMotion:'reduce'});
 await ctx.addInitScript(()=>{
  localStorage.setItem('frenchStudio.uiLang','en');localStorage.setItem('frenchStudio.userToken','touch-fixture');
  window.testPronunciations=[];window.testLookups=0;window.testAudioStates=new Map();
  speechSynthesis.speak=function(){};speechSynthesis.cancel=function(){};
  Object.defineProperty(HTMLMediaElement.prototype,'paused',{get(){return window.testAudioStates.get(this)!==true;}});
  HTMLMediaElement.prototype.pause=function(){window.testAudioStates.set(this,false);this.dispatchEvent(new Event('pause'));};
  HTMLMediaElement.prototype.play=function(){window.testAudioStates.set(this,true);const u=new URL(this.src,location.href);if(u.pathname==='/tts')window.testPronunciations.push(u.searchParams.get('text'));return Promise.resolve();};
 });
 await ctx.route('**/*',route=>{
  const u=new URL(route.request().url()),p=u.pathname;
  if(u.origin!=='http://localhost:8000')return route.abort();
  if(p==='/study')return route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(root,'study.html'),'utf8').replace('__PERSONAL_PRACTICE__',fs.readFileSync(path.join(root,'personal-practice.html'),'utf8')).replaceAll('__ASSET_VERSION__','tap-targets')});
  if(p.startsWith('/static/'))return route.fulfill({contentType:p.endsWith('.css')?'text/css':'application/javascript',body:fs.readFileSync(path.join(root,path.basename(p)),'utf8')});
  if(p==='/api/lookup')return route.fulfill({json:{token:u.searchParams.get('word'),explanation_en:'Test meaning.',explanation_cn:'测试释义'}});
  if(p==='/api/auth/me')return route.fulfill({json:{email:'touch@example.com',plan:'pro',days_left:30}});
  return route.fulfill({status:401,json:{detail:'Blocked by fixture'}});
 });
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:8000/study');
 await page.waitForFunction(()=>window.FrenchHistory&&window.FrenchHistory.onRestoreStudy);
 await page.evaluate(s=>window.FrenchHistory.onRestoreStudy({text:s.sentence,sentences:[s,{...s,sentence:'Bonjour.',original:'Bonjour.',build_up:[]}],sentenceCount:2}),sentence);
 const card=page.locator('.sentence-card').first();
 // Start from the collapsed row, as on a phone with several sentences
 if((await card.getAttribute('class')).includes('is-open'))await card.locator('.sentence-toggle').click();
 return {ctx,page,errors,card};
}
// Every word of a text line with its on-screen box, in reading order.
const wordBoxes=(page,lineSelector)=>page.evaluate(sel=>{const line=document.querySelector(sel);line.scrollIntoView({block:'center',behavior:'instant'});return [...line.querySelectorAll('.interactive-word')];},lineSelector).then(()=>page.evaluate(sel=>[...document.querySelector(sel).querySelectorAll('.interactive-word')].map(w=>{const r=w.getBoundingClientRect();return {word:w.dataset.word,left:r.left,right:r.right,top:r.top,bottom:r.bottom};}),lineSelector));
// What a tap at (x, y) would reach: the word whose hit area contains the point, else null.
const wordAt=(page,x,y)=>page.evaluate(([x,y])=>{const el=document.elementFromPoint(x,y);const w=el&&el.closest('.interactive-word');return w?w.dataset.word:null;},[x,y]);
async function geometry(page,lineSelector,coarse){
 const boxes=await wordBoxes(page,lineSelector);
 // Group words into visual lines
 const lines=[];for(const b of boxes){const line=lines.find(l=>Math.abs(l.mid-(b.top+b.bottom)/2)<6);if(line)line.words.push(b);else lines.push({mid:(b.top+b.bottom)/2,words:[b]});}
 const m={words:boxes.length,lines:lines.length,glyphHeight:Math.round(boxes[0].bottom-boxes[0].top),linePitch:lines.length>1?Math.round(lines[1].mid-lines[0].mid):null};
 // Horizontal: walk each line from its first to its last word; every point must belong to a word
 let dead=0,samples=0;
 for(const l of lines){const left=Math.min(...l.words.map(w=>w.left)),right=Math.max(...l.words.map(w=>w.right));
  for(let x=left+1;x<right-1;x+=1){samples++;if(!(await wordAt(page,x,l.mid)))dead++;}}
 m.deadHorizontalPx=dead;m.horizontalSamples=samples;
 // Vertical: how tall is the band that reaches each word (sampled through its centre)?
 const heights=[];
 for(const l of lines)for(const w of l.words){const x=(w.left+w.right)/2;let top=l.mid,bottom=l.mid;
  while(await wordAt(page,x,top-1)===w.word&&top>l.mid-60)top--;
  while(await wordAt(page,x,bottom+1)===w.word&&bottom<l.mid+60)bottom++;
  heights.push(bottom-top+1);}
 m.minTouchHeight=Math.min(...heights);m.maxTouchHeight=Math.max(...heights);
 return m;
}
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome-stable',headless:true,args:['--no-sandbox']});let checks=0;
 try{
  // ---------- phone (coarse pointer) ----------
  {
   const {ctx,page,errors,card}=await open(browser,{touch:true});
   assert(await page.evaluate(()=>matchMedia('(pointer: coarse)').matches),'Touch emulation must report a coarse pointer');
   const line='.sentence-french-text';
   const m=await geometry(page,line,true);report.phoneHeading=m;
   assert(m.lines>=2,`The sample sentence should wrap on a phone (${m.lines} line)`);
   assert.equal(m.deadHorizontalPx,0,`No dead gap between words: ${m.deadHorizontalPx}px of ${m.horizontalSamples} reach no word`);
   assert(m.minTouchHeight>=44,`Every word needs a touch band of at least 44px (smallest ${m.minTouchHeight}px)`);checks+=2;
   // Computed style of a word: selection stays possible, no double-tap zoom, visible feedback
   const css=await card.locator('.interactive-word').first().evaluate(w=>{const s=getComputedStyle(w);return {userSelect:s.userSelect||s.webkitUserSelect,touchAction:s.touchAction,tapHighlight:s.webkitTapHighlightColor};});
   report.wordStyle=css;
   assert.equal(css.userSelect,'text','Words stay selectable so a phrase can still be selected');
   assert.equal(css.touchAction,'manipulation','Words must not wait for or zoom on a double tap');
   assert.notEqual(css.tapHighlight,'rgba(0, 0, 0, 0)','A tap needs visible feedback');checks+=3;
   const boxes=await wordBoxes(page,line);
   const find=name=>boxes.find(b=>b.word===name);
   const popup=page.locator('.floating-word-popover');
   const opened=async()=>popup.evaluate(p=>!p.hidden&&getComputedStyle(p).display!=='none');
   const expectWord=(name,why)=>attempt(async()=>{await page.waitForFunction(()=>!document.querySelector('.floating-word-popover').hidden,null,{timeout:2500});assert.equal((await popup.locator('.popover-word').textContent()).trim(),name,why);});
   const cardOpen=async()=>(await card.getAttribute('class')).includes('is-open');
   const tapAt=async(x,y)=>{await page.keyboard.press('Escape');await page.touchscreen.tap(x,y);};
   // A tap in the gap between two words belongs to a word and never opens/closes the card
   const enfants=find('enfants'),et=find('et');
   await tapAt((enfants.right+et.left)/2,(enfants.top+enfants.bottom)/2);
   assert(await opened(),'A tap in the gap between words must open a word');
   assert.equal(await cardOpen(),false,'A tap in a gap must not open/close the sentence');checks+=2;
   // Chromium nudges touches to a nearby target by itself, so also click every gap exactly (no nudge)
   const lineOf=b=>Math.round((b.top+b.bottom)/2);
   let gaps=0;
   for(let i=0;i<boxes.length-1;i++){
    const a=boxes[i],b=boxes[i+1];if(lineOf(a)!==lineOf(b))continue;
    for(const x of [a.right+0.5,(a.right+b.left)/2,b.left-0.5]){
     await page.keyboard.press('Escape');
     await page.mouse.click(x,(a.top+a.bottom)/2);
     await attempt(async()=>{assert(await opened(),`A click in the gap after "${a.word}" (x=${x.toFixed(1)}) must open a word`);assert.equal(await cardOpen(),false,`A click in the gap after "${a.word}" must not toggle the sentence`);});
     gaps++;
    }
   }
   report.gapClicks=gaps;checks+=gaps;
   // Punctuation belongs to the word before it ("enfants,")
   await tapAt(enfants.right-2,(enfants.top+enfants.bottom)/2);
   await expectWord('enfants','The comma after a word is part of its tap target');checks++;
   // A tap well below the glyphs but inside the word's 44px band still hits it
   const enceinte=find('enceinte');
   await tapAt((enceinte.left+enceinte.right)/2,enceinte.bottom+8);
   await expectWord('enceinte','A tap just below a word must still hit it');
   assert.equal(await cardOpen(),false);checks++;
   await tapAt((enceinte.left+enceinte.right)/2,enceinte.top-8);
   await expectWord('enceinte','A tap just above a word must still hit it');checks++;
   // Exactly one pronunciation and at most one lookup per tap (no touch + click double fire)
   await page.keyboard.press('Escape');
   const before=await page.evaluate(()=>testPronunciations.length);
   await page.touchscreen.tap((enceinte.left+enceinte.right)/2,(enceinte.top+enceinte.bottom)/2);
   await page.waitForTimeout(450);
   assert.deepEqual(await page.evaluate(n=>testPronunciations.slice(n),before),['enceinte'],'One tap, one pronunciation');checks++;
   // An open card never covers a word of its own sentence: after opening one word on every line,
   // every other word must still be reachable
   const heads=await wordBoxes(page,line);
   const firstOfLine=heads.filter((b,i)=>i===0||Math.abs((b.top+b.bottom)/2-(heads[i-1].top+heads[i-1].bottom)/2)>6);
   for(const w of firstOfLine){
    await page.keyboard.press('Escape');
    await page.touchscreen.tap((w.left+w.right)/2,(w.top+w.bottom)/2);
    await expectWord(w.word.replace(/^J'ai$/,"J'ai"),`Opening "${w.word}"`);
    const covered=[];
    for(const o of await wordBoxes(page,line)){if(await wordAt(page,(o.left+o.right)/2,(o.top+o.bottom)/2)!==o.word)covered.push(o.word);}
    assert.deepEqual(covered,[],`The card opened from "${w.word}" must not cover other words of the sentence`);checks++;
   }
   // Far from any word (empty heading space) still opens/closes the card
   await page.keyboard.press('Escape');
   const last=boxes[boxes.length-1];
   await page.touchscreen.tap(Math.min(380,last.right+80),(last.top+last.bottom)/2);
   assert.equal(await cardOpen(),true,'Empty space in the heading still opens the sentence');
   await page.touchscreen.tap(Math.min(380,last.right+80),(last.top+last.bottom)/2);
   assert.equal(await cardOpen(),false,'…and closes it again');checks+=2;
   // Long press / selection: selecting a single word does not open the popover;
   // the read selection bar appears instead.
   await page.keyboard.press('Escape');
   await page.evaluate(()=>{const w=document.querySelector('.sentence-french-text [data-word="femme"]');const r=document.createRange();r.selectNodeContents(w.firstChild);const s=getSelection();s.removeAllRanges();s.addRange(r);});
   await page.waitForTimeout(400);
   assert.equal(await opened(),false,'Selecting one word leaves the popover closed');
   assert.equal(await page.locator('.read-selection-bar').isVisible(),true,'Selecting one word shows the read bar');checks+=2;
   // …and a multi-word selection shows the bar to read the snapped text or open the phrase meaning
   await page.keyboard.press('Escape');
   await page.evaluate(()=>{const p=document.querySelector('.sentence-french-text');const a=p.querySelector('[data-word="ma"]'),b=p.querySelector('[data-word="femme"]');const r=document.createRange();r.setStartBefore(a);r.setEndAfter(b);const s=getSelection();s.removeAllRanges();s.addRange(r);});
   await page.waitForTimeout(400);
   assert.equal(await opened(),false,'A selected phrase does not open popover automatically');
   assert.equal(await page.locator('.read-selection-bar').isVisible(),true,'Read selection bar is visible for phrase');
   const spokenBefore=await page.evaluate(()=>testPronunciations.length);
   await page.locator('.read-selection-bar .rs-read').click();
   await page.waitForTimeout(300);
   assert.deepEqual(await page.evaluate(n=>testPronunciations.slice(n),spokenBefore),['ma femme'],'Read selection speaks snapped text');
   await page.locator('.read-selection-bar .rs-meaning').click();
   await expectWord('ma femme','Meaning button on read bar opens the phrase popover');checks+=4;
   await page.keyboard.press('Escape');
   await page.evaluate(()=>getSelection().removeAllRanges());
   // Build-up steps use the same targets
   await card.locator('.sentence-toggle').tap();
   const step=await geometry(page,'.buildup-step-row:last-child .buildup-fr-text',true);report.phoneStep=step;
   assert.equal(step.deadHorizontalPx,0,`No dead gap between step words: ${step.deadHorizontalPx}px`);
   assert(step.minTouchHeight>=44,`Step words need a 44px band (smallest ${step.minTouchHeight}px)`);checks+=2;
   // Blind mode ("Test me"): a tap beside the hidden chunk must not read out a word that is still
   // hidden (without the blind-mode guard these points belong to its nearest word)
   await page.keyboard.press('Escape');
   await card.locator('.btn-feynman-toggle[data-mode="blind"]').tap();
   await page.evaluate(()=>document.querySelector('.buildup-step-row:last-child .buildup-fr-text').scrollIntoView({block:'center',behavior:'instant'}));
   const hidden=await page.locator('.buildup-step-row:last-child .buildup-new-token').first().boundingBox();
   const silentBefore=await page.evaluate(()=>testPronunciations.length);
   const midX=hidden.x+hidden.width/2,midY=hidden.y+hidden.height/2;
   for(const [x,y] of [[midX,hidden.y+hidden.height+8],[hidden.x+hidden.width+14,midY],[hidden.x+hidden.width+14,hidden.y+hidden.height-6]]){await page.mouse.click(x,y);}
   await page.waitForTimeout(300);
   assert.equal(await page.evaluate(()=>testPronunciations.length),silentBefore,'Blind mode stays silent for taps beside a hidden word');checks++;
   assert.deepEqual(errors,[]);
   await ctx.close();
  }
  // ---------- desktop (fine pointer) ----------
  {
   const {ctx,page,errors,card}=await open(browser,{touch:false});
   const m=await geometry(page,'.sentence-french-text',false);report.desktopHeading=m;
   assert.equal(m.deadHorizontalPx,0,`No dead gap between words on desktop: ${m.deadHorizontalPx}px`);checks++;
   const word=card.locator('.sentence-french-text [data-word="femme"]');
   const rest=await word.evaluate(w=>getComputedStyle(w).backgroundColor);
   await word.hover();
   await page.waitForTimeout(300);  // the highlight fades in
   const hover=await word.evaluate(w=>getComputedStyle(w).backgroundColor);
   assert.notEqual(hover,rest,'Hovering a word highlights it');checks++;
   // Click a gap between words: still the nearest word, not the sentence toggle
   const boxes=await wordBoxes(page,'.sentence-french-text');
   const a=boxes.find(b=>b.word==='deux'),b=boxes.find(b=>b.word==='enfants');
   await page.mouse.click((a.right+b.left)/2,(a.top+a.bottom)/2);
   await attempt(()=>page.waitForFunction(()=>!document.querySelector('.floating-word-popover').hidden,null,{timeout:2500}));
   assert.equal((await card.getAttribute('class')).includes('is-open'),false,'A click between words must not open the sentence');checks++;
   // A word's active highlight must not change its width (no reflow under the popover)
   const widthBefore=await page.evaluate(()=>document.querySelector('.sentence-french-text [data-word="femme"]').getBoundingClientRect().width);
   await word.click();
   const widthAfter=await page.evaluate(()=>document.querySelector('.sentence-french-text [data-word="femme"]').getBoundingClientRect().width);
   assert.equal(widthAfter,widthBefore,'Opening a word must not reflow the sentence');checks++;

   // Desktop drag selection: dragging across words does NOT open the single-word popover
   await page.keyboard.press('Escape');
   const deuxBox=await page.locator('.sentence-french-text [data-word="deux"]').boundingBox();
   const enfantsBox=await page.locator('.sentence-french-text [data-word="enfants"]').boundingBox();
   await page.mouse.move(deuxBox.x+2,deuxBox.y+deuxBox.height/2);
   await page.mouse.down();
   await page.mouse.move(enfantsBox.x+enfantsBox.width-2,enfantsBox.y+enfantsBox.height/2,{steps:5});
   await page.mouse.up();
   await page.waitForTimeout(300);
   const popHidden=await page.evaluate(()=>document.querySelector('.floating-word-popover').hidden);
   assert.equal(popHidden,true,'Mouse drag does not open single-word popover');
   assert.equal(await page.locator('.read-selection-bar').isVisible(),true,'Read bar appears after mouse drag selection');
   const desktopSpokenBefore=await page.evaluate(()=>testPronunciations.length);
   await page.locator('.read-selection-bar .rs-read').click();
   await page.waitForTimeout(300);
   assert.deepEqual(await page.evaluate(n=>testPronunciations.slice(n),desktopSpokenBefore),['deux enfants'],'Desktop read selection speaks exact text snapped to whole words');
   checks+=3;
   // While text is selected a click on the row does not toggle the sentence (as before), so the
   // selection is dropped first
   await page.keyboard.press('Escape');
   await page.evaluate(()=>getSelection().removeAllRanges());

   // Sentence controls: whole-sentence button has hit area >= 44px
   await card.locator('.sentence-toggle').click();
   const speakRoundBox=await card.locator('.btn-speak-round').boundingBox();
   assert(speakRoundBox.width>=44&&speakRoundBox.height>=44,`Sentence read button hit area >= 44px (${speakRoundBox.width}x${speakRoundBox.height})`);
   checks++;

   // Custom fallback range mode: tap Select toggle, then tap first word, then last word
   const rangeBtn=card.locator('.btn-range-select');
   assert.equal(await rangeBtn.isVisible(),true,'Range select button is visible when card is open');
   const rangeBtnBox=await rangeBtn.boundingBox();
   assert(rangeBtnBox.width>=44&&rangeBtnBox.height>=44,'Range select toggle hit area >= 44px');
   await rangeBtn.click();
   const lineClass=await card.locator('.sentence-french-text').getAttribute('class');
   assert(lineClass.includes('is-range-mode'),'Toggling select activates is-range-mode');
   const cardWords=await wordBoxes(page,'.sentence-french-text');
   const cDeux=cardWords.find(w=>w.word==='deux');
   const cEnfants=cardWords.find(w=>w.word==='enfants');
   await page.mouse.click((cDeux.left+cDeux.right)/2,(cDeux.top+cDeux.bottom)/2);
   await page.mouse.click((cEnfants.left+cEnfants.right)/2,(cEnfants.top+cEnfants.bottom)/2);
   await page.waitForTimeout(300);
   assert.equal(await page.locator('.read-selection-bar').isVisible(),true,'Range mode displays read bar after picking span');
   const rangeSpoken=await page.evaluate(()=>testPronunciations.length);
   await page.locator('.read-selection-bar .rs-read').click();
   await page.waitForTimeout(300);
   assert.deepEqual(await page.evaluate(n=>testPronunciations.slice(n),rangeSpoken),['deux enfants'],'Range mode reads selected span');
   await page.locator('.read-selection-bar .rs-done').click();
   assert.equal(await page.locator('.read-selection-bar').isHidden(),true,'Done button exits range mode');
   checks+=6;

   assert.deepEqual(errors,[]);
   await ctx.close();
  }
  if(process.env.WORD_TAP_REPORT)console.log(JSON.stringify(report,null,1));
  if(failures.length){console.log(`${failures.length} FAILED:\n- ${failures.join('\n- ')}`);process.exitCode=1;return;}
  console.log(`PASS ${checks} checks: tap targets, gaps, punctuation, selection/drag, range mode and desktop controls on /study.`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e.message||e);if(process.env.WORD_TAP_REPORT)console.log(JSON.stringify(report,null,1));process.exitCode=1;});
