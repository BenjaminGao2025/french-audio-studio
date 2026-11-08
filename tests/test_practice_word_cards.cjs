// Real study + exercise renderers, with only network/audio replaced. Repeated target offsets,
// learner errors, native Meaning and slow etymology must behave across every practice surface.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const read = f => fs.readFileSync(path.join(__dirname, '../static', f), 'utf8');
const scripts = ['audio-controller.js','theme.js','study-init.js','i18n.js','game.js','playback.js','speech-eval.js','history.js','phrase-context.js','word-context.js','word-popover.js','read-selection.js','dictation.js','study.js'];
const sentence = 'La semaine commence, cette semaine est importante.';
const flush = async (ms=30) => new Promise(r => setTimeout(r,ms));
async function page() {
 const dom = new JSDOM(read('study.html').replace(/<script\b[^>]*\bsrc=[^>]*><\/script>/g,''), {runScripts:'outside-only',pretendToBeVisual:true,url:'http://localhost/study'});
 const w=dom.window;w.HTMLMediaElement.prototype.play=()=>Promise.resolve();w.HTMLMediaElement.prototype.pause=()=>{};w.localStorage.setItem('frenchStudio.uiLang','zh');w.localStorage.setItem('frenchStudio.userToken','test-token');
 w.HTMLElement.prototype.getBoundingClientRect=()=>({left:30,top:100,right:150,bottom:125,width:120,height:25});
 w.Range.prototype.getBoundingClientRect=w.HTMLElement.prototype.getBoundingClientRect;w.Range.prototype.getClientRects=function(){return [this.getBoundingClientRect()]};
 w.matchMedia=()=>({matches:false,addEventListener(){}});
 const calls=[];let finishEtymology;
 w.fetch=async(url,init={})=>{
  calls.push({url,body:init.body?JSON.parse(init.body):null});
  const reply=(data,ok=true)=>({ok,status:ok?200:503,json:async()=>data,text:async()=>''});
  if(url==='/api/auth/me')return reply({id:1,email:'test@example.com',is_valid:true});
  if(url==='/api/auth/session')return reply({authenticated:true});
  if(url.startsWith('/api/lookup'))return reply({token:new URL('http://x'+url).searchParams.get('word'),lemma:'semaine',pos:'n.f.',explanation_cn:'周；星期',explanation_en:'week'});
  if(url==='/api/word-context')return reply({context:{meaning_zh:'周',why_zh:`本句中的第 ${JSON.parse(init.body).occurrence+1} 个 semaine。`},state:'ready'});
  if(url==='/api/etymology')return new Promise(resolve=>{finishEtymology=()=>resolve(reply({text:'模拟词源：semaine'}))});
  return reply({},false);
 };
 for(const s of scripts)w.eval(read(s));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
 w.renderStudyDeck([{schemaVersion:2,sentence,translation_en:'The week begins; this week is important.',translation_zh:'这一周开始了，这一周很重要。',phrases:[],words:[],build_up:[{step:1,fr:'La semaine commence',en:'The week begins',new_tokens:['La','semaine','commence']},{step:2,fr:sentence,en:'The week begins; this week is important.',new_tokens:['cette','semaine','est','importante']}],grammar_points:[],pronunciation_tips:[]}]);
 return {w,doc:w.document,card:w.document.querySelector('.sentence-card'),calls,finish:()=>finishEtymology()};
}
function select(env,element){env.doc.activeElement?.blur();const r=env.doc.createRange();r.selectNodeContents(element);const s=env.w.getSelection();s.removeAllRanges();s.addRange(r);env.doc.dispatchEvent(new env.w.Event('selectionchange'));}
for(const mode of ['recall','dictation'])for(const scope of ['whole','steps'])test(`${mode}/${scope}: results, answer, offsets, Meaning and etymology`,async(t)=>{
 const e=await page();t.after(()=>e.w.close());const {w,doc,card,calls}=e;
 card.querySelector(`[data-tab="${mode}"]`).click();card.querySelector(`[data-scope="${scope}"]`).click();
 if(scope==='steps'){
  card.querySelector('.dictation-input').value='La semaine commence';card.querySelector('.dictation-check').click();await flush();card.querySelector('.dictation-next-step').click();
 }
 card.querySelector('.dictation-input').value='La semàine commence cette semaine semaine';card.querySelector('.dictation-check').click();await flush();
 assert.ok(card.querySelector('.dt-accent .dt-fix .interactive-word'));
 assert.ok(card.querySelector('.dt-missing .interactive-word'));
 assert.ok(card.querySelector('.dt-wrong .dt-fix .interactive-word'));
 const right=Array.from(card.querySelectorAll('.dictation-diff .interactive-word')).filter(x=>x.dataset.word==='semaine'&&!x.dataset.contextUnavailable).at(-1);
 right.click();await flush();assert.match(doc.querySelector('.popover-context-why').textContent,/第 2 个/,JSON.stringify({state:doc.querySelector('.popover-context').dataset.state,calls}));
 assert.equal(calls.filter(x=>x.url==='/api/word-context').at(-1).body.occurrence,1);
 doc.querySelector('.popover-close-btn').click();
 const wrong=card.querySelector('.dt-wrong .dt-yours .interactive-word');
 assert.equal(wrong.dataset.word,'semaine','learner error also occurs elsewhere in the correct sentence');wrong.click();await flush();assert.equal(doc.querySelector('.popover-context').dataset.state,'unavailable');
 doc.querySelector('.popover-close-btn').click();
 const answer=Array.from(card.querySelectorAll('.dictation-answer-text .interactive-word')).filter(x=>x.dataset.word==='semaine')[1];
 select(e,answer);await flush(800);
 assert.equal(doc.querySelector('.popover-context').dataset.state,'ready');assert.match(doc.querySelector('.popover-context-why').textContent,/第 2 个/);
 assert.equal(calls.filter(x=>x.url==='/api/word-context'&&x.body.word==='semaine').length,1,'same target shared across diff/answer selection');
 const pop=doc.querySelector('.floating-word-popover');const bar=doc.querySelector('.read-selection-bar');const before=calls.length;
 const button=pop.querySelector('.popover-etymology-button');button.innerHTML='<svg><path/></svg><span>词根词源</span>';
 const inside=button.querySelector('path');inside.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true,button:0}));inside.dispatchEvent(new w.MouseEvent('mouseup',{bubbles:true,button:0}));inside.dispatchEvent(new w.MouseEvent('click',{bubbles:true,button:0}));await flush(40);
 assert.equal(pop.hidden,false);assert.equal(bar.hidden,true);assert.equal(button.disabled,true);button.click();assert.equal(calls.length,before+1);
 e.finish();await flush();assert.match(pop.querySelector('.popover-etymology-text').textContent,/模拟词源/);button.click();await flush();assert.equal(calls.length,before+1,'cached etymology on repeated internal click');assert.equal(bar.hidden,true);
 // A truly new selection opens its own card directly, replacing the previous one.
 select(e,card.querySelector('.dictation-answer-text .interactive-word'));await flush(800);assert.equal(bar.hidden,true);assert.equal(pop.hidden,false);
 domClose(e);
});
function domClose(e){e.w.close()}

test('default no-context consumer displays dictionary then honest context fallback',async()=>{
 const dom=new JSDOM('<body><span id="anchor">semaine</span></body>',{runScripts:'outside-only',pretendToBeVisual:true,url:'http://localhost'});const w=dom.window;w.eval(read('i18n.js'));w.eval(read('speech-eval.js'));w.eval(read('word-popover.js'));const el=w.document.querySelector('#anchor');el.getBoundingClientRect=()=>({left:30,right:120,top:80,bottom:100,width:90,height:20});
 const p=w.FrenchWordPopover.create({speak(){},localLookup:()=>({token:'semaine',lemma:'semaine',pos:'n.f.',explanation_cn:'周',explanation_en:'week'})});await p.show('semaine',el);
 const dict=p.element.querySelector('.popover-dict'),ctx=p.element.querySelector('.popover-context');assert.equal(ctx.hidden,false);assert.equal(ctx.dataset.state,'unavailable');assert.ok(dict.compareDocumentPosition(ctx)&w.Node.DOCUMENT_POSITION_FOLLOWING);w.close();
});

test('a late dictionary answer cannot reset pending etymology for the same card',async(t)=>{
 const dom=new JSDOM('<body><span lang="fr" id="anchor">semaine</span></body>',{runScripts:'outside-only',pretendToBeVisual:true,url:'http://localhost'});const w=dom.window;t.after(()=>w.close());
 for(const f of ['i18n.js','speech-eval.js','word-popover.js'])w.eval(read(f));
 const el=w.document.querySelector('#anchor');el.getBoundingClientRect=()=>({left:30,right:120,top:80,bottom:100,width:90,height:20});
 let dictionary,etymology;
 w.fetch=(url)=>new Promise(resolve=>{if(url.startsWith('/api/lookup'))dictionary=resolve;else etymology=resolve});
 const p=w.FrenchWordPopover.create({speak(){}});const shown=p.show('semaine',el);
 p.element.querySelector('.popover-etymology-button').click();
 dictionary({ok:true,json:async()=>({token:'semaine',lemma:'semaine',pos:'n.f.',explanation_cn:'周'})});await shown;
 assert.equal(p.element.querySelector('.popover-etymology-button').disabled,true);
 etymology({ok:true,json:async()=>({text:'mock semaine origin'})});await flush();
 assert.match(p.element.querySelector('.popover-etymology-text').textContent,/mock semaine origin/);
});

test('revealed French keeps markup and punctuation as escaped text',async(t)=>{
 const e=await page();t.after(()=>e.w.close());const expected='La semaine <img src=x onerror="bad()"> commence & continue.';
 const controller=e.w.FrenchDictation.create({getToken:()=>'',lang:'zh'});controller.open(e.card,{sentence:expected,translationEn:'A test'},'write');
 e.card.querySelector('.dictation-reveal').click();const answer=e.card.querySelector('.dictation-answer-text');
 assert.equal(answer.textContent,expected);assert.equal(answer.querySelector('img,script'),null);assert.ok(answer.innerHTML.includes('&lt;'));
 await flush(100);
});
