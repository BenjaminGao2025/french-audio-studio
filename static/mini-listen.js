(() => {
    'use strict';
    const token=localStorage.getItem('frenchStudio.userToken'); if(!token)return;
    const EN=window.FrenchI18n.lang()==='en';
    const t=(zh,en)=>EN?en:zh;
    const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const panel=document.createElement('section'); panel.id='mini-listening'; panel.className='listen-panel mini-listening';
    document.querySelector('.listen-main .page-intro').after(panel);
    const query=new URLSearchParams(location.search);
    let check=null, heard=false, sequence=0, playVersion=0, blobUrl=null;
    panel.innerHTML=`<h2>${t('A1 入门精听','A1 short listening')}</h2><p class="muted">${t('三个短句，一次只练一个场景。先听，再选意思；需要时看中文。','Three short sentences, one everyday situation. Listen, choose the meaning, reveal help when needed.')}</p>
        <div class="coach-fields"><label>${t('难度','Difficulty')}<select id="mini-level"><option value="starter">${t('A1 起步 · 慢速逐句','A1 starter · slow, one line at a time')}</option><option value="A1">${t('A1 巩固 · 连贯听','A1 practice · connected listening')}</option></select></label><label>${t('场景','Situation')}<select id="mini-theme">${[['cafe','买咖啡','Café'],['appointment','预约','Appointment'],['home','家','Home'],['shopping','购物','Shopping'],['invitation','邀请','Invitation'],['routine','日常生活','Daily routine']].map(([id,zh,en])=>`<option value="${id}">${t(zh,en)}</option>`).join('')}</select></label></div>
        <div class="mini-actions"><button id="mini-start" class="btn btn-primary">${t('开始短句练习','Start short practice')}</button><button id="mini-challenge" class="btn btn-secondary">${t('每周小挑战','Weekly check')}</button></div>
        <p id="mini-status" role="status" aria-live="polite"></p><div id="mini-work" hidden><h3 id="mini-title"></h3>
        <audio id="mini-audio" controls preload="none" data-coach="listening"></audio><div class="mini-actions"><button id="mini-play" class="btn btn-primary">${t('听一遍','Listen')}</button><button id="mini-easier" class="btn btn-secondary">${t('太难了 · 慢速逐句','Too hard · slow lines')}</button><button id="mini-hint" class="btn btn-secondary">${t('看原文和中文','Show text and meaning')}</button></div>
        <div id="mini-lines" class="mini-lines" hidden></div><form id="mini-answers"><div id="mini-questions"></div><button class="btn btn-primary" id="mini-submit" disabled>${t('检查答案','Check answers')}</button></form><p id="mini-result" role="status"></p><div id="mini-next" class="mini-actions"></div></div>`;
    const $=id=>document.getElementById(id);const audio=$('mini-audio');
    if(query.get('theme')&&[...$('mini-theme').options].some(o=>o.value===query.get('theme')))$('mini-theme').value=query.get('theme');
    async function api(path,body){const r=await fetch(path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body||{})});const d=await r.json();if(!r.ok)throw Error(typeof d.detail==='string'?d.detail:d.detail?.message||t('暂时无法完成，请重试','Please try again'));return d;}
    async function action(button,fn){button.disabled=true;$('mini-status').textContent='';try{await fn();}catch(e){$('mini-status').textContent=e.message;}finally{button.disabled=false;}}
    function stop(){playVersion++;audio.pause();audio.removeAttribute('src');audio.load();if(blobUrl){URL.revokeObjectURL(blobUrl);blobUrl=null;}}
    function resultView(result){
        $('mini-result').textContent=`${result.score} / ${result.total} · ${result.assisted?t('看提示后完成','Completed with help'):t('未查看文字提示','Without text hints')} · ${t('完成练习也有奖励，答错可以拆句再听。','Finishing earns practice credit; listen again to learn from errors.')}`;
        $('mini-submit').disabled=true;
        check.lesson.questions.forEach((q,i)=>{const field=$('mini-questions').children[i];const note=document.createElement('p');note.className='muted';note.textContent=t('答案：','Answer: ')+q.options[result.correct[i]];field.append(note);});
        $('mini-hint').disabled=false;
        const theme=check.challenge?'cafe':check.lesson.id;
        $('mini-next').innerHTML=`<a class="btn btn-secondary" href="/write?task=P0&theme=${encodeURIComponent(theme)}">${t('用这个句型写三句话','Write three sentences')}</a><a class="btn btn-secondary" href="/coach">${t('回到今日安排','Back to today')}</a>`;
        window.FrenchGame?.refresh();
    }
    async function start(challenge=false){
        stop();heard=false;$('mini-work').hidden=true;
        check=await api('/api/coach/listen',{level:$('mini-level').value,theme:$('mini-theme').value,challenge});
        $('mini-work').hidden=false;$('mini-title').textContent=check.lesson[EN?'title_en':'title_zh'];
        $('mini-lines').hidden=true;$('mini-lines').replaceChildren();$('mini-result').textContent='';$('mini-next').replaceChildren();
        $('mini-submit').disabled=true;$('mini-hint').disabled=challenge&&!check.result;
        $('mini-easier').disabled=challenge;
        $('mini-questions').innerHTML=check.lesson.questions.map((q,i)=>`<fieldset class="mini-question"><legend>${i+1}. ${esc(q[EN?'en':'zh'])}</legend>${q.options.map((option,j)=>`<label><input type="radio" name="q${i}" value="${j}" required>${esc(option)}</label>`).join('')}</fieldset>`).join('');
        if(check.result)resultView(check.result);
        if(challenge)$('mini-status').textContent=t('每周保留第一次答案；提交后才能查看原文。只是短练习，不是等级认证。','Your first answers are saved for this week. Text appears after submission. This is practice, not a level certificate.');
    }
    async function playLine(line,version){
        const r=await fetch(`/api/coach/listen/${check.id}/audio?line=${line}`,{headers:{Authorization:'Bearer '+token}});
        if(!r.ok)throw Error(t('音频暂时不可用，请重试','Audio unavailable; please retry'));
        const blob=await r.blob();if(version!==playVersion)return;
        if(blobUrl)URL.revokeObjectURL(blobUrl);blobUrl=URL.createObjectURL(blob);audio.src=blobUrl;audio.playbackRate=check.level==='starter'&&!check.challenge?0.75:1;
        await audio.play();
    }
    $('mini-play').onclick=()=>action($('mini-play'),async()=>{stop();sequence=0;const v=playVersion;await playLine(check.level==='starter'&&!check.challenge?0:-1,v);});
    audio.addEventListener('ended',()=>{
        const v=playVersion;
        if(check.level==='starter'&&!check.challenge&&sequence<2){sequence++;setTimeout(()=>{if(v===playVersion)playLine(sequence,v).catch(e=>$('mini-status').textContent=e.message);},1800);}
        else {heard=true;if(!check.result)$('mini-submit').disabled=false;}
    });
    audio.addEventListener('error',()=>{if(audio.getAttribute('src'))$('mini-status').textContent=t('播放失败，请点击“听一遍”重试。','Playback failed; click Listen to retry.');});
    $('mini-hint').onclick=()=>action($('mini-hint'),async()=>{
        const d=await api(`/api/coach/listen/${check.id}/hint`);check.assisted=true;$('mini-lines').hidden=false;
        $('mini-lines').innerHTML=d.lines.map(line=>`<p><span lang="fr">${esc(line[0])}</span><small>${esc(line[EN?2:1])}</small></p>`).join('');
    });
    $('mini-easier').onclick=()=>action($('mini-easier'),async()=>{check.level='starter';$('mini-level').value='starter';stop();sequence=0;await playLine(0,playVersion);$('mini-status').textContent=t('已放慢并逐句播放，每句后留出跟读时间。','Slower, one sentence at a time, with room to repeat.');});
    $('mini-start').onclick=()=>action($('mini-start'),()=>start());
    $('mini-challenge').onclick=()=>action($('mini-challenge'),()=>start(true));
    $('mini-answers').onsubmit=e=>{e.preventDefault();if(!heard||check.result)return;action($('mini-submit'),async()=>{const f=new FormData(e.target);const result=await api(`/api/coach/listen/${check.id}/answers`,{answers:check.lesson.questions.map((_,i)=>Number(f.get('q'+i)))});check.result=result;resultView(result);}).finally(()=>{$('mini-submit').disabled=!!check.result;});};
    window.addEventListener('pagehide',stop);
    if(query.get('challenge')==='1')action($('mini-challenge'),()=>start(true));
    else if(query.has('theme'))action($('mini-start'),()=>start());
})();
