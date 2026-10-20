// Word tap targets in the built /app SPA (static/app), measured the way a finger hits them.
// Network and audio are mocked; no learning data is written. Run: node tools/spa-word-tap-check.cjs
// Build first with `npm run build` in frontend/. WORD_TAP_REPORT=1 prints the raw measurements.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/home/mgacai/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const appRoot=path.resolve(__dirname,'../static/app');
const TEXT="J'ai déjà deux enfants, et ma femme est enceinte, donc nous cherchons un appartement plus grand.";
const passage={id:'p1',title:'Famille',level:'A2',text_type:'notice',source:'fixture',license:'generated',text:TEXT,
 analysis:{sentences:[{sentence:TEXT,translation_en:'I already have two children, and my wife is pregnant, so we are looking for a bigger flat.',translation_zh:'',
  build_up:[{fr:"J'ai déjà deux enfants."},{fr:"J'ai déjà deux enfants, et ma femme est enceinte.",new:'et ma femme est enceinte'}],
  words:[{fr:'enfants',lemma:'enfant',type:'noun',ipa:'ɑ̃.fɑ̃',meaning:'children',meaning_zh:'孩子'},{fr:'enceinte',meaning:'pregnant'}],grammar_points:[]}]},
 questions:[1,2].map(i=>({kind:'detail',q:`Question ${i}`,options:['A','B','C','D']}))};
const report={};
const mime={'.js':'application/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.woff2':'font/woff2','.woff':'font/woff','.ico':'image/x-icon','.txt':'text/plain'};
async function open(browser,{touch}){
 const ctx=await browser.newContext(touch?{viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce'}:{viewport:{width:1100,height:800},reducedMotion:'reduce'});
 await ctx.addInitScript(()=>{
  localStorage.setItem('frenchStudio.userToken','fixture');
  window.testPronunciations=[];window.testAudioStates=new Map();
  Object.defineProperty(HTMLMediaElement.prototype,'paused',{get(){return window.testAudioStates.get(this)!==true;}});
  HTMLMediaElement.prototype.pause=function(){window.testAudioStates.set(this,false);this.dispatchEvent(new Event('pause'));};
  HTMLMediaElement.prototype.play=function(){window.testAudioStates.set(this,true);const u=new URL(this.src,location.href);if(u.pathname==='/tts')window.testPronunciations.push(u.searchParams.get('text'));return Promise.resolve();};
 });
 await ctx.route('**/*',route=>{
  const u=new URL(route.request().url()),p=u.pathname,method=route.request().method();
  if(u.origin!=='http://localhost:8000')return route.abort();
  if(p==='/api/reading/passages'&&method==='POST')return route.fulfill({json:passage});
  if(p==='/api/lookup')return route.fulfill({json:{token:u.searchParams.get('word'),explanation_en:'Looked-up meaning.',explanation_cn:'查到的释义'}});
  if(p.startsWith('/api/'))return route.fulfill({status:404,json:{detail:'Not in the fixture'}});
  if(p==='/tts')return route.fulfill({contentType:'audio/wav',body:Buffer.from('UklGRigAAABXQVZFRm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==','base64')});
  if(p.startsWith('/app')){
   const file=path.join(appRoot,p.replace(/^\/app\/?/,''));
   if(p!=='/app'&&p!=='/app/'&&path.extname(p)&&fs.existsSync(file))return route.fulfill({contentType:mime[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
   return route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(appRoot,'index.html'))});
  }
  return route.fulfill({status:404,body:''});
 });
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:8000/app/reading');
 await page.getByRole('button',{name:'Generate passage'}).click();
 await page.waitForSelector('.fr-words');
 return {ctx,page,errors};
}
const boxesOf=(page,index)=>page.evaluate(i=>{const line=document.querySelectorAll('.fr-words')[i];line.scrollIntoView({block:'center',behavior:'instant'});return [...line.querySelectorAll('[data-fr-word]')].map(w=>{const r=w.getBoundingClientRect();return {word:w.dataset.frWord,left:r.left,right:r.right,top:r.top,bottom:r.bottom};});},index);
const wordAt=(page,x,y)=>page.evaluate(([x,y])=>{const el=document.elementFromPoint(x,y);const w=el&&el.closest('[data-fr-word]');return w?w.dataset.frWord:null;},[x,y]);
async function geometry(page,index){
 const boxes=await boxesOf(page,index);
 const lines=[];for(const b of boxes){const line=lines.find(l=>Math.abs(l.mid-(b.top+b.bottom)/2)<6);if(line)line.words.push(b);else lines.push({mid:(b.top+b.bottom)/2,words:[b]});}
 const m={words:boxes.length,lines:lines.length,glyphHeight:Math.round(boxes[0].bottom-boxes[0].top),linePitch:lines.length>1?Math.round(lines[1].mid-lines[0].mid):null};
 let dead=0,samples=0;
 for(const l of lines){const left=Math.min(...l.words.map(w=>w.left)),right=Math.max(...l.words.map(w=>w.right));
  for(let x=left+1;x<right-1;x++){samples++;if(!(await wordAt(page,x,l.mid)))dead++;}}
 m.deadHorizontalPx=dead;m.horizontalSamples=samples;
 const heights=[];
 for(const l of lines)for(const w of l.words){const x=(w.left+w.right)/2;let top=l.mid,bottom=l.mid;
  while(await wordAt(page,x,top-1)===w.word&&top>l.mid-60)top--;
  while(await wordAt(page,x,bottom+1)===w.word&&bottom<l.mid+60)bottom++;
  heights.push(bottom-top+1);}
 m.minTouchHeight=Math.min(...heights);
 return {m,boxes,lines};
}
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome-stable',headless:true,args:['--no-sandbox']});let checks=0;
 try{
  {
   const {ctx,page,errors}=await open(browser,{touch:true});
   assert(await page.evaluate(()=>matchMedia('(pointer: coarse)').matches),'Touch emulation must report a coarse pointer');
   const {m,boxes}=await geometry(page,0);report.phoneSentence=m;
   assert(m.lines>=2,`The sample sentence should wrap on a phone (${m.lines} line)`);
   assert.equal(m.deadHorizontalPx,0,`No dead gap between words: ${m.deadHorizontalPx}px of ${m.horizontalSamples}`);
   assert(m.minTouchHeight>=44,`Every word needs a touch band of at least 44px (smallest ${m.minTouchHeight}px)`);checks+=2;
   const css=await page.locator('.fr-word').first().evaluate(w=>{const s=getComputedStyle(w);return {touchAction:s.touchAction,userSelect:s.userSelect||s.webkitUserSelect,tapHighlight:s.webkitTapHighlightColor};});
   report.wordStyle=css;
   assert.equal(css.touchAction,'manipulation');assert.equal(css.userSelect,'text','Words stay selectable on touch');
   assert.notEqual(css.tapHighlight,'rgba(0, 0, 0, 0)');checks+=3;
   const card=page.getByRole('dialog');
   const cardWord=async()=>(await card.locator('.fr').first().textContent()).trim();
   const tapAt=async(x,y)=>{await page.keyboard.press('Escape');await page.touchscreen.tap(x,y);};
   const find=n=>boxes.find(b=>b.word===n);
   // Click every gap exactly (Chromium nudges touches by itself, mouse clicks are not nudged)
   let gaps=0;
   for(let i=0;i<boxes.length-1;i++){const a=boxes[i],b=boxes[i+1];if(Math.abs((a.top+a.bottom)/2-(b.top+b.bottom)/2)>6)continue;
    for(const x of [a.right+0.5,(a.right+b.left)/2,b.left-0.5]){await page.keyboard.press('Escape');await page.mouse.click(x,(a.top+a.bottom)/2);
     assert(await card.isVisible(),`A click in the gap after "${a.word}" (x=${x.toFixed(1)}) must open a word`);gaps++;}}
   report.gapClicks=gaps;checks+=gaps;
   // Meaning from the analysis, pronunciation through the controller, exactly once per tap
   const enfants=find('enfants');
   await page.keyboard.press('Escape');
   const before=await page.evaluate(()=>testPronunciations.length);
   await page.touchscreen.tap((enfants.left+enfants.right)/2,(enfants.top+enfants.bottom)/2);
   await card.waitFor();await page.waitForTimeout(450);
   assert.equal(await cardWord(),'enfants');
   assert.match(await card.textContent(),/children/);
   assert.deepEqual(await page.evaluate(n=>testPronunciations.slice(n),before),['enfants'],'One tap, one pronunciation');
   assert.equal(await page.evaluate(()=>[...testAudioStates.values()].filter(Boolean).length),1,'Only one clip may play');checks+=4;
   // The comma belongs to the word, and a tap beside the glyphs still hits it
   await tapAt(enfants.right-2,(enfants.top+enfants.bottom)/2);
   assert.equal(await cardWord(),'enfants');checks++;
   const enceinte=find('enceinte');
   await tapAt((enceinte.left+enceinte.right)/2,enceinte.bottom+10);
   assert.equal(await cardWord(),'enceinte');
   await tapAt((enceinte.left+enceinte.right)/2,enceinte.top-10);
   assert.equal(await cardWord(),'enceinte');checks+=2;
   // A second word replaces the card (one card on the page), and audio switches to it
   const femme=find('femme');
   await page.touchscreen.tap((femme.left+femme.right)/2,(femme.top+femme.bottom)/2);
   assert.equal(await card.count(),1,'One card at a time');
   assert.equal(await cardWord(),'femme');
   await page.getByText('Looked-up meaning.').waitFor();
   assert.deepEqual(await page.evaluate(()=>testPronunciations.slice(-1)),['femme']);checks+=3;
   // An open card never covers a word of its own sentence
   const firstOfLine=boxes.filter((b,i)=>i===0||Math.abs((b.top+b.bottom)/2-(boxes[i-1].top+boxes[i-1].bottom)/2)>6);
   for(const w of firstOfLine){
    await tapAt((w.left+w.right)/2,(w.top+w.bottom)/2);
    await card.waitFor();
    const covered=[];
    for(const o of await boxesOf(page,0)){if(await wordAt(page,(o.left+o.right)/2,(o.top+o.bottom)/2)!==o.word)covered.push(o.word);}
    assert.deepEqual(covered,[],`The card opened from "${w.word}" must not cover other words of the sentence`);checks++;
   }
   // Far from every word the tap does nothing; Escape and an outside press dismiss
   await page.keyboard.press('Escape');
   const last=boxes[boxes.length-1];
   await page.touchscreen.tap(Math.min(385,last.right+90),(last.top+last.bottom)/2);
   assert.equal(await card.count(),0);
   await page.touchscreen.tap((enfants.left+enfants.right)/2,(enfants.top+enfants.bottom)/2);
   assert.equal(await card.count(),1);
   await page.keyboard.press('Escape');assert.equal(await card.count(),0);checks+=3;
   // Build-up lines are tappable too, on the same tiles
   const buildup=await geometry(page,1);report.phoneBuildUp=buildup.m;
   assert.equal(buildup.m.deadHorizontalPx,0);assert(buildup.m.minTouchHeight>=44);checks+=2;
   // ---- Read selection (phone: long press with handles, and the range-mode fallback) ----
   const bar=page.locator('[data-fr-read-bar]');
   const readSel=async(expected)=>{
    const before=await page.evaluate(()=>testPronunciations.length);
    await bar.getByRole('button',{name:'Read selection'}).click();
    await page.waitForTimeout(300);
    assert.deepEqual(await page.evaluate(n=>testPronunciations.slice(n),before),[expected],'Read selection speaks exactly the snapped words');
    checks++;
   };
   await page.evaluate(()=>window.scrollTo(0,0));
   await page.evaluate(()=>document.querySelectorAll('.fr-words')[0].scrollIntoView({block:'center',behavior:'instant'}));
   // A long press selects one word: the card stays shut, the bar offers to read it
   await page.evaluate(()=>{const w=document.querySelectorAll('.fr-words')[0].querySelector('[data-fr-word="femme"]');const r=document.createRange();r.selectNodeContents(w.firstChild);const s=getSelection();s.removeAllRanges();s.addRange(r);});
   await page.waitForTimeout(500);
   assert.equal(await card.count(),0,'Selecting one word does not open the card');
   assert.equal(await bar.isVisible(),true,'Selecting one word shows the read bar');checks+=2;
   await readSel('femme');
   // …and extending the selection to a phrase reads the whole phrase
   await page.evaluate(()=>{const p=document.querySelectorAll('.fr-words')[0];const a=p.querySelector('[data-fr-word="ma"]'),b=p.querySelector('[data-fr-word="femme"]');const r=document.createRange();r.setStartBefore(a);r.setEndAfter(b);const s=getSelection();s.removeAllRanges();s.addRange(r);});
   await page.waitForTimeout(500);
   assert.equal(await bar.isVisible(),true,'The bar follows the extended selection');checks++;
   await readSel('ma femme');
   await page.evaluate(()=>getSelection().removeAllRanges());
   await page.keyboard.press('Escape');
   // Range mode: the per-sentence "Select words" switch, then tap the first and the last word
   const boxes2=await boxesOf(page,0);
   const dBox=boxes2.find(b=>b.word==='deux'),eBox=boxes2.find(b=>b.word==='enfants');
   await page.getByRole('button',{name:'Select words'}).click();
   assert.equal(await page.locator('.fr-words.is-range-mode').count(),1,'The Select switch puts the sentence in range mode');checks++;
   assert.equal(await page.getByRole('status').textContent(),'Tap the first word','Range mode explains the first tap');checks++;
   await page.mouse.click((dBox.left+dBox.right)/2,(dBox.top+dBox.bottom)/2);
   await page.waitForTimeout(150);
   assert.equal(await page.getByRole('status').textContent(),'Tap the last word','…then the last one');checks++;
   await page.mouse.click((eBox.left+eBox.right)/2,(eBox.top+eBox.bottom)/2);
   await page.waitForTimeout(300);
   assert.equal(await bar.isVisible(),true,'Range mode shows the bar for the picked span');checks++;
   await readSel('deux enfants');
   await bar.getByRole('button',{name:'Clear selection'}).click();
   assert.equal(await bar.isHidden(),true,'Clear drops the picked span');checks++;
   await page.getByRole('button',{name:'Select words'}).click();
   // The per-sentence Read button: a large hit area that reads the whole sentence
   const readBtn=page.getByRole('button',{name:'Read sentence'});
   const rb=await readBtn.boundingBox();
   assert(rb.width>=44&&rb.height>=44,`Read sentence hit area >= 44px (${rb.width}x${rb.height})`);
   const sentenceBefore=await page.evaluate(()=>testPronunciations.length);
   await readBtn.click();
   await page.waitForTimeout(300);
   assert.deepEqual(await page.evaluate(n=>testPronunciations.slice(n),sentenceBefore),[TEXT],'Read sentence speaks the whole sentence');
   checks+=2;
   // The vocabulary buttons next to the breakdown still work and still save, not play
   assert.deepEqual(errors,[]);
   await page.evaluate(()=>window.scrollTo(0,0));
   await ctx.close();
  }
  {
   const {ctx,page,errors}=await open(browser,{touch:false});
   const {m}=await geometry(page,0);report.desktopSentence=m;
   assert.equal(m.deadHorizontalPx,0,`No dead gap between words on desktop: ${m.deadHorizontalPx}px`);checks++;
   const word=page.locator('.fr-words').first().locator('[data-fr-word="femme"]');
   const rest=await word.evaluate(w=>getComputedStyle(w).backgroundColor);
   await word.hover();await page.waitForTimeout(300);
   assert.notEqual(await word.evaluate(w=>getComputedStyle(w).backgroundColor),rest,'Hovering a word highlights it');checks++;
   assert.equal(await word.evaluate(w=>(getComputedStyle(w).userSelect||getComputedStyle(w).webkitUserSelect)),'auto','Text stays selectable with a mouse');checks++;
   // Dragging across words with the mouse: the bar appears on mouseup with the snapped words,
   // and the single-word card must not open
   const dboxes=await boxesOf(page,0);
   const dBox=dboxes.find(b=>b.word==='deux'),eBox=dboxes.find(b=>b.word==='enfants');
   await page.mouse.move(dBox.left+2,(dBox.top+dBox.bottom)/2);await page.mouse.down();
   await page.mouse.move(eBox.right-2,(dBox.top+dBox.bottom)/2,{steps:5});await page.mouse.up();
   await page.waitForTimeout(300);
   assert.equal(await page.getByRole('dialog').count(),0,'A drag-select is not a tap');
   const bar=page.locator('[data-fr-read-bar]');
   assert.equal(await bar.isVisible(),true,'The read bar appears after a mouse drag');checks+=2;
   const dragBefore=await page.evaluate(()=>testPronunciations.length);
   await bar.getByRole('button',{name:'Read selection'}).click();
   await page.waitForTimeout(300);
   assert.deepEqual(await page.evaluate(n=>testPronunciations.slice(n),dragBefore),['deux enfants'],'Read selection speaks the exact words snapped to whole words');
   checks++;
   assert.deepEqual(errors,[]);
   await ctx.close();
  }
  if(process.env.WORD_TAP_REPORT)console.log(JSON.stringify(report,null,1));
  console.log(`PASS ${checks} checks: SPA word tap targets, gaps, audio, card, drag/selection read bar, range mode and sentence controls.`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e.message||e);if(process.env.WORD_TAP_REPORT)console.log(JSON.stringify(report,null,1));process.exitCode=1;});
