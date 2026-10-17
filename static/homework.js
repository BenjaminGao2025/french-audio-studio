(() => {
    'use strict';
    const $=id=>document.getElementById(id),EN=window.FrenchI18n.lang()==='en';
    const t=(zh,en)=>EN?en:zh;
    const host=$('study-personal');if(!host)return;
    const token=localStorage.getItem('frenchStudio.userToken');
    const key='frenchStudio.homework.'+(token||'').slice(-20);
    const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    let entry=null,busy=false,recording=null,recordStream=null,recordStopTimer=null,practiceState=null;
    const pending={},localURLs={},model=$('homework-model');
    const walker=document.createTreeWalker(host,NodeFilter.SHOW_TEXT);let node;
    while((node=walker.nextNode())) {if(node.parentElement.closest('script,style'))continue;const p=node.textContent.split(' / ');if(p.length===2&&/[\u4e00-\u9fff]/.test(p[0]))node.textContent=EN?p[1]:p[0];}
    const status=msg=>$('homework-status').textContent=msg;
    async function api(path,body,raw=false){
        const r=await fetch(path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,...(raw?{'Content-Type':body.type}:{'Content-Type':'application/json'})},body:body===undefined?undefined:raw?body:JSON.stringify(body)});
        const d=await r.json();if(!r.ok)throw Error(typeof d.detail==='string'?d.detail:d.detail?.message||t('暂时失败，请重试','Please try again'));return d;
    }
    async function run(button,fn){if(busy)return;busy=true;button.disabled=true;status('');try{await fn();}catch(e){status(e.name==='NotAllowedError'?t('浏览器未允许麦克风。请在地址栏打开权限后重试，文本已保存。','Microphone access was denied. Allow it in the address bar and retry; your text is saved.'):e.message);}finally{busy=false;button.disabled=false;syncButtons();}}
    function syncButtons(){
        const firstSaved=!!entry?.recordings?.some(r=>r.kind==='first');
        $('record-first').disabled=!!recording&&recording.kind!=='first'||firstSaved;
        if(firstSaved)$('record-first').textContent=t('第一遍已存档','First recording archived');
        $('record-final').disabled=!!recording&&recording.kind!=='final';
        $('homework-practice').disabled=!!recording;
        $('homework-new').disabled=busy||!!recording||!!practiceState;
        $('homework-create').disabled=busy||!!entry;
    }
    // Audio elements cannot attach Authorization. Fetch privately, then use a blob.
    const mediaState=new Map();
    function resetPlayer(player){
        const old=mediaState.get(player);if(old?.url)URL.revokeObjectURL(old.url);
        mediaState.delete(player);player.pause();player.removeAttribute('src');player.load();
    }
    async function loadAudio(player,path,force=false){
        if(!path){resetPlayer(player);player.hidden=true;return;}
        const old=mediaState.get(player);if(!force&&old?.path===path)return;
        resetPlayer(player);const state={path,url:null};mediaState.set(player,state);
        player.hidden=true;
        if(player===model){$('homework-audio-status').textContent=t('范读加载中…','Loading model audio…');$('homework-audio-retry').hidden=true;}
        try{
            const response=await fetch(path,{headers:{Authorization:'Bearer '+token},cache:'no-store'});
            if(!response.ok)throw Error(response.status===401?t('登录已过期，请重新登录后加载音频。','Sign in again to load your audio.'):t('音频加载失败，请重试。','Audio could not load. Please retry.'));
            const blob=await response.blob();if(!blob.size)throw Error(t('音频文件为空，请重新准备范读。','Audio is empty. Prepare it again.'));
            if(mediaState.get(player)!==state)return;
            state.url=URL.createObjectURL(blob);player.src=state.url;player.hidden=false;player.load();
        }catch(e){
            if(mediaState.get(player)!==state)return;
            mediaState.delete(player);
            if(player===model){$('homework-audio-status').textContent=e.message;$('homework-audio-retry').hidden=false;$('homework-prepare').hidden=false;}
            else status(e.message);
        }
    }
    model.addEventListener('loadedmetadata',()=>{
        $('homework-prepare').hidden=true;$('homework-audio-retry').hidden=true;
        $('homework-audio-status').textContent=Number.isFinite(model.duration)?t(`范读已就绪 · ${Math.ceil(model.duration)} 秒`,`Audio ready · ${Math.ceil(model.duration)} seconds`):t('范读已就绪','Audio ready');
    });
    model.addEventListener('error',()=>{
        if(!model.getAttribute('src'))return;
        $('homework-audio-status').textContent=t('音频无法播放，请重新加载或准备范读。','Audio cannot play. Retry loading or prepare it again.');$('homework-audio-retry').hidden=false;$('homework-prepare').hidden=false;
    });
    let selectedPart=-1;
    function showPart(index){
        selectedPart=index;
        const part=entry?.parts?.[index];
        $('homework-french').textContent=part?part.french:entry?.french||'';
        $('homework-french').hidden=false;
        $('homework-part-source').textContent=part?part.source:'';
        $('homework-hide').textContent=t('隐藏法语文本','Hide the text');
        if($('homework-part-select'))$('homework-part-select').value=String(index);
        const url=entry?.reference_url;
        loadAudio(model,url?(part?url+'?part='+index:url):'');
    }
    $('homework-parts').onchange=e=>{if(e.target.id==='homework-part-select'&&!recording)showPart(Number(e.target.value));};
    $('homework-audio-retry').onclick=()=>{const url=entry?.reference_url;if(url)loadAudio(model,url+(selectedPart>=0?'?part='+selectedPart:''),true);};
    $('homework-study').onclick=()=>run($('homework-study'),async()=>{
        if(!entry?.french)throw Error(t('先准备法语文本。','Prepare your French text first.'));
        if(await window.StudyModes.select('text',{returnToPractice:true}))window.FrenchStudy.studyText($('homework-french').textContent);
    });
    $('homework-expand').onclick=()=>run($('homework-expand'),()=>prepare(true));
    $('homework-signin').onclick=()=>{location.href='/study?mode=personal&login=1&next='+encodeURIComponent('/study?mode=personal');};
    function render(next){
        const same=entry?.id===next.id;entry=next;localStorage.setItem(key+'.current',entry.id);
        if(!same)selectedPart=-1;
        $('homework-source').open=!entry.french;
        $('homework-create').hidden=!!entry;
        $('homework-entry').hidden=false;$('homework-native').value=entry.native_text;$('homework-native').readOnly=true;
        $('homework-meta').textContent=`${entry.day} · ${entry.complete?t('已存档','Archived'):t('练习中','In progress')}`;
        $('homework-prepare').hidden=!!entry.reference_url;
        $('homework-expand').hidden=!entry.can_expand;
        const parts=entry.parts||[];
        $('homework-parts').innerHTML=parts.length>1?`<label for="homework-part-select">${t('练习内容','Practice content')}</label><select id="homework-part-select"><option value="-1">${t('完整内容','Full text')}</option>${parts.map((_,i)=>`<option value="${i}">${t('第 '+(i+1)+' 段','Part '+(i+1))} / ${parts.length}</option>`).join('')}</select>`:'';
        showPart(selectedPart<parts.length?selectedPart:-1);
        $('homework-reflection').value=localStorage.getItem(key+'.reflection.'+entry.id)??entry.reflection;$('homework-recalled').checked=!!entry.recalled;
        $('homework-clock').textContent=t(`开口活动估算 ${Math.floor(entry.practice_seconds/60)} 分 ${entry.practice_seconds%60} 秒`,`Estimated speaking activity: ${Math.floor(entry.practice_seconds/60)}m ${entry.practice_seconds%60}s`);
        for(const kind of ['first','final']){
            const list=entry.recordings.filter(r=>r.kind===kind);const latest=kind==='first'?list[0]:list.at(-1);
            const player=$('audio-'+kind);player.hidden=!latest;
            if(latest && !pending[kind])loadAudio(player,latest.url);else if(!pending[kind])resetPlayer(player);
        }
        syncButtons();
    }
    async function history(){
        const d=await api('/api/homework');
        $('homework-history').innerHTML=d.entries.length?d.entries.map(e=>`<p><button class="btn btn-secondary" data-entry="${esc(e.id)}">${esc(e.day)} · ${e.complete?t('已交作业','Archived'):t('继续练习','Continue')} · ${esc(e.native_text.slice(0,35))}</button></p>`).join(''):`<p class="muted">${t('第一份作业完成后，就能在这里回看。','Your practice entries will appear here.')}</p>`;
        return d.entries;
    }
    async function prepare(expand=false){
        status(t('原文已保存。正在完整转成简单法语并准备范读…','Your ideas are saved. Preparing all your ideas in simple French and audio…'));
        try{render(await api(`/api/homework/${entry.id}/prepare`,{expand,repair_audio:!expand&&!!entry.french}));}
        catch(e){try{render(await api('/api/homework/'+entry.id));}catch(_){}throw e;}
        status(t('准备好了。可以分段练习，再把完整内容连起来说。','Ready. Practise each part, then connect the full text.'));await history();
    }
    $('homework-create').onclick=()=>run($('homework-create'),async()=>{
        const text=$('homework-native').value.trim();if(text.length<5)throw Error(t('先写一点自己想说的话。','Write a few words about your own ideas first.'));
        render(await api('/api/homework',{native_text:text}));await prepare();
    });
    $('homework-prepare').onclick=()=>run($('homework-prepare'),prepare);
    $('homework-native').addEventListener('input',()=>{if(!entry)localStorage.setItem(key+'.draft',$('homework-native').value);});
    $('homework-new').onclick=()=>{if(recording||practiceState)return;if(Object.keys(pending).length){status(t('请先保存当前录音，再新建作业。','Save your current recording before starting another entry.'));return;}entry=null;localStorage.removeItem(key+'.current');$('homework-entry').hidden=true;$('homework-source').open=true;$('homework-create').hidden=false;for(const player of [model,$('audio-first'),$('audio-final')])resetPlayer(player);$('homework-native').readOnly=false;$('homework-native').value='';localStorage.removeItem(key+'.draft');for(const k of ['first','final']){delete pending[k];$('save-'+k).hidden=true;}model.pause();status('');syncButtons();$('homework-native').focus();};
    $('homework-hide').onclick=()=>{const hidden=!$('homework-french').hidden;$('homework-french').hidden=hidden;$('homework-hide').textContent=hidden?t('显示法语文本','Show the French text'):t('隐藏法语文本','Hide the French text');};
    function releaseStream(stream){stream?.getTracks().forEach(track=>track.stop());}
    async function record(kind){
        if(recording){if(recording.kind===kind)recording.rec.stop();return;}
        if(!entry?.french)throw Error(t('先准备法语文本。','Prepare your French text first.'));
        await stopPractice();
        if(selectedPart>=0)showPart(-1);
        for(const player of [model,$('audio-first'),$('audio-final')])player.pause();
        if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw Error(t('这个浏览器不支持录音，请使用 Chrome 或 Safari。','Recording is unavailable; try Chrome or Safari.'));
        const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});recordStream=stream;
        const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(m=>MediaRecorder.isTypeSupported(m));
        let rec;try{rec=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);}catch(e){releaseStream(stream);throw e;}
        const id=entry.id,chunks=[];let bytes=0;
        rec.ondataavailable=e=>{if(e.data.size){chunks.push(e.data);bytes+=e.data.size;if(bytes>8*1024*1024&&rec.state==='recording')rec.stop();}};
        rec.onstop=()=>{
            clearTimeout(recordStopTimer);releaseStream(stream);recordStream=null;recording=null;
            const blob=new Blob(chunks,{type:rec.mimeType||'audio/webm'});pending[kind]={blob,id};
            if(localURLs[kind])URL.revokeObjectURL(localURLs[kind]);localURLs[kind]=URL.createObjectURL(blob);
            $('audio-'+kind).src=localURLs[kind];$('audio-'+kind).hidden=false;$('save-'+kind).hidden=false;
            $('record-'+kind).textContent=kind==='first'?t('重新录第一遍','Record first again'):t('重新录最后一遍','Record final again');
            status(t('录音还在本机，请点击“保存录音”完成存档。','This recording is local. Click Save recording to archive it.'));syncButtons();
        };
        rec.onerror=()=>{releaseStream(stream);recording=null;status(t('录音出错，请重试。','Recording failed; please try again.'));syncButtons();};
        recording={rec,kind};rec.start(1000);recordStopTimer=setTimeout(()=>{if(rec.state==='recording')rec.stop();},180000);
        $('record-'+kind).textContent=t('停止录音','Stop recording');status(t('正在录音，点击停止。','Recording; click Stop when finished.'));syncButtons();
    }
    for(const kind of ['first','final']){
        $('record-'+kind).onclick=()=>run($('record-'+kind),()=>record(kind));
        $('save-'+kind).onclick=()=>run($('save-'+kind),async()=>{
            const p=pending[kind];if(!p)return;
            const updated=await api(`/api/homework/${p.id}/recordings?kind=${kind}`,p.blob,true);
            delete pending[kind];$('save-'+kind).hidden=true;render(updated);status(t('录音已保存。','Recording saved.'));await history();window.FrenchGame?.refresh();
        });
    }
    async function flushPractice(state){
        if(state.sending||state.pending<1)return;
        state.sending=true;const seconds=Math.min(30,Math.floor(state.pending));const beat=state.retry||{beat_id:crypto.randomUUID(),seconds};
        try{await api(`/api/homework/${state.id}/practice`,beat);state.pending=Math.max(0,state.pending-beat.seconds);state.retry=null;}
        catch(e){state.retry=beat;status(t('计时保存暂时失败，稍后会重试。','Practice-time save failed; retrying shortly.'));}
        finally{state.sending=false;}
    }
    async function stopPractice(){
        const s=practiceState;if(!s)return;practiceState=null;clearInterval(s.tick);clearInterval(s.flush);releaseStream(s.stream);await s.context.close();await flushPractice(s);
        $('homework-practice').textContent=t('开始开口练习','Practise aloud');syncButtons();
        if(entry && s.id===entry.id){const reflection=$('homework-reflection').value,recalled=$('homework-recalled').checked;render(await api('/api/homework/'+entry.id));$('homework-reflection').value=reflection;$('homework-recalled').checked=recalled;}
    }
    $('homework-practice').onclick=()=>run($('homework-practice'),async()=>{
        if(practiceState){await stopPractice();return;}
        if(!entry?.french)throw Error(t('先准备法语文本。','Prepare your French text first.'));
        const context=new (window.AudioContext||window.webkitAudioContext)();await context.resume();
        let stream;try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});}catch(e){await context.close();throw e;}
        const source=context.createMediaStreamSource(stream),analyser=context.createAnalyser();source.connect(analyser);analyser.fftSize=1024;
        const values=new Uint8Array(analyser.fftSize);
        const s={id:entry.id,context,stream,pending:0,estimated:entry.practice_seconds,prior:performance.now(),lastVoice:-Infinity,sending:false};practiceState=s;
        s.tick=setInterval(()=>{
            const now=performance.now(),delta=Math.min(0.25,(now-s.prior)/1000);s.prior=now;
            analyser.getByteTimeDomainData(values);const rms=Math.sqrt(values.reduce((sum,v)=>sum+((v-128)/128)**2,0)/values.length);
            const playerActive=[...document.querySelectorAll('audio')].some(a=>!a.paused),visible=!document.hidden&&!host.hidden;
            if(visible&&!playerActive&&rms>0.025)s.lastVoice=now;
            if(visible&&!playerActive&&now-s.lastVoice<650){s.pending+=delta;s.estimated+=delta;}
            $('homework-clock').textContent=t(`开口活动估算 ${Math.floor(s.estimated/60)} 分 ${Math.floor(s.estimated%60)} 秒`,`Estimated activity: ${Math.floor(s.estimated/60)}m ${Math.floor(s.estimated%60)}s`);
        },100);
        s.flush=setInterval(()=>flushPractice(s),15000);
        $('homework-practice').textContent=t('结束开口练习','Stop speaking practice');status(t('练习计时已开始。播放范读后停下来，自己开口重复。','Practice tracking is on. Listen, pause, then repeat aloud.'));
    });
    $('homework-reflection').addEventListener('input',()=>{if(entry)localStorage.setItem(key+'.reflection.'+entry.id,$('homework-reflection').value);});
    window.addEventListener('beforeunload',e=>{if(recording||Object.keys(pending).length){e.preventDefault();e.returnValue='';}});
    $('homework-finish').onclick=()=>run($('homework-finish'),async()=>{
        if(recording||Object.keys(pending).length)throw Error(t('请先停止并保存录音。','Stop and save your recording first.'));
        await stopPractice();render(await api(`/api/homework/${entry.id}/finish`,{reflection:$('homework-reflection').value,recalled:$('homework-recalled').checked}));status(t('作业已存档，可以回听首尾录音；今日口语任务已完成。','Archived. Compare your recordings; today’s speaking task is complete.'));await history();window.FrenchGame?.refresh();
    });
    $('homework-download').onclick=()=>run($('homework-download'),async()=>{
        const r=await fetch(`/api/homework/${entry.id}/archive`,{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw Error(t('请先准备文本和范读。','Prepare the text and model audio first.'));
        const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download=entry.day+'-homework.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    $('homework-history').onclick=e=>{const b=e.target.closest('[data-entry]');if(b)run(b,async()=>{if(recording||Object.keys(pending).length)throw Error(t('先停止并保存录音。','Stop and save your recording first.'));await stopPractice();render(await api('/api/homework/'+b.dataset.entry));});};
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&practiceState)flushPractice(practiceState);});
    window.addEventListener('pagehide',()=>{for(const state of mediaState.values())if(state.url)URL.revokeObjectURL(state.url);clearTimeout(recordStopTimer);releaseStream(recordStream);if(practiceState){clearInterval(practiceState.tick);clearInterval(practiceState.flush);releaseStream(practiceState.stream);practiceState.context.close();}});
    window.PersonalPractice={async leave(){
        if(recording||Object.keys(pending).length){status(t('请先停止并保存录音，再切换学习方式。','Stop and save your recording before switching.'));return false;}
        await stopPractice();return true;
    }};
    let initialized=false;
    function initialize(){
        if(initialized||window.StudyModes?.current!=='personal')return;initialized=true;
        if(!token){$('homework-login').hidden=false;return;}
        $('homework-workspace').hidden=false;$('homework-native').value=localStorage.getItem(key+'.draft')||'';
        history().then(entries=>{const saved=localStorage.getItem(key+'.current');const chosen=entries.find(e=>e.id===saved)||entries[0];if(chosen)render(chosen);}).catch(e=>status(e.message));
    }
    document.addEventListener('study:modechange',initialize);initialize();
})();
