(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const EN = window.FrenchI18n.lang() === 'en';
    const say = (zh,en) => EN ? en : zh;
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const form = $('coach-form');
    let data, step = 0, busy = false;
    const kinds = {listen:['听力','Listening'],write:['写作','Writing'],speak:['口语','Speaking'],read:['阅读','Reading']};
    $('coach-levels').innerHTML = Object.entries(kinds).map(([key,label])=>`<label>${say(...label)} · ${say('自评水平','self-assessment')}<select name="level_${key}">${['A0','A1','A2','B1','B2'].map(v=>`<option ${v==='A1'?'selected':''}>${v}</option>`).join('')}</select></label>`).join('');
    $('coach-days').innerHTML = ['一 / Mon','二 / Tue','三 / Wed','四 / Thu','五 / Fri','六 / Sat','日 / Sun'].map((x,i)=>`<label><input type="checkbox" name="day" value="${i}" checked>${x}</label>`).join('');
    // Show the chosen UI language for the static bilingual interview labels.
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;
    while((node=walker.nextNode())) {
        if(node.parentElement.closest('script,style'))continue;
        const parts=node.textContent.split(' / ');
        if(parts.length===2 && /[\u4e00-\u9fff]/.test(parts[0]))node.textContent=EN?parts[1]:parts[0];
    }
    form.elements.timezone.value = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Vancouver';
    async function api(path,body) {
        const r = await fetch(path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+localStorage.getItem('frenchStudio.userToken'),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
        const d=await r.json(); if(!r.ok) throw new Error(typeof d.detail==='string'?d.detail:d.detail?.message || say('请求失败，请稍后重试','Request failed; please try again'));
        return d;
    }
    function showStep(next) {
        step=next;
        form.querySelectorAll('[data-step]').forEach(el=>el.hidden=Number(el.dataset.step)!==step);
        $('coach-step').textContent=`${step+1} / 3`;
        $('coach-back').hidden=step===0; $('coach-next').hidden=step===2; $('coach-save').hidden=step!==2;
    }
    function validStep() {
        return [...form.querySelector(`[data-step="${step}"]`).querySelectorAll('input,select,textarea')].every(el=>el.reportValidity());
    }
    $('coach-back').onclick=()=>showStep(Math.max(0,step-1));
    $('coach-next').onclick=()=>{if(validStep())showStep(Math.min(2,step+1));};
    async function run(button, fn) {
        if(busy)return; busy=true; button.disabled=true;
        $('coach-status').textContent=say('正在处理，请稍候…','Working on your plan…');
        try {await fn();} catch(e){$('coach-status').textContent=e.message;}
        finally {busy=false;button.disabled=false;}
    }
    function render(next) {
        data=next;
        $('coach-onboarding').hidden=data.setup;
        $('coach-dashboard').hidden=!data.setup;
        if(!data.setup){showStep(0);return;}
        const c=data.capacity;
        $('coach-week').innerHTML=(data.schedule||[]).map(d=>`<p><strong>${esc(d.day)}</strong> · ${d.tasks.length?d.tasks.map(t=>`${esc(t.start)} ${esc(t[EN?'en':'zh'])} (${t.minutes} min)`).join(' · '):say('休息','Rest')}</p>`).join('');
        $('coach-today-context').textContent=`${data.day} · ${data.profile.timezone} · ${say('完成基础任务后，可以继续主课。','After your core tasks, continue your main course.')}`;
        $('coach-tasks').innerHTML=data.tasks.length?data.tasks.map(t=>`<div class="coach-task ${t.done?'is-done':''}"><time>${esc(t.start)}–${esc(t.end)}</time><div><strong class="coach-task-title">${esc(t[EN?'en':'zh'])}</strong><br><small>${t.minutes} ${say('分钟','min')} · ${t.verified?say('系统已记录完成','Recorded by the app'):t.self_reported?say('你已确认完成','Self-reported completion'):say('等待完成','To do')}</small></div><div class="coach-task-actions"><a class="btn ${t.done?'btn-secondary':'btn-primary'}" href="${esc(t.href)}">${say('开始','Start')}</a>${t.done?'':`<button class="btn btn-secondary" data-complete="${esc(t.kind)}">${say('已在线下完成','Done offline')}</button>`}</div></div>`).join(''):`<p>${say('今天是休息日。想练一点，也可以自由进入练习。','Rest day. You can still practise if you feel like it.')}</p>`;
        $('coach-metrics').innerHTML=[[c.days_left,say('天至目标日期','days to deadline')],[Math.round(c.weekly_minutes/6)/10,say('小时 / 周可用','available hours / week')],[data.progress.today_xp,say('今天的练习奖励 XP','practice XP today')]].map(([v,l])=>`<div><strong>${v}</strong><span>${l}</span></div>`).join('');
        $('coach-plan-source').textContent=data.plan.source==='llm'?say('AI 教练建议，时间表受可用时间限制','AI coaching; scheduling stays within your availability'):say('按时间预算生成的基础计划；AI 暂未参与','A baseline schedule based on availability; no AI advice yet');
        $('coach-plan').textContent=data.plan.summary;
        $('coach-caution').textContent=data.plan.caution;
        $('coach-milestones').innerHTML=data.plan.checkpoints.map(m=>`<li>${esc(m.date)} · ${esc(m.focus)}</li>`).join('')+`<li>${esc(c.exam_window)} · ${say('建议在此前后安排首考，考位和出分时间需另行确认','Suggested first-attempt window; confirm test availability and result timing')}</li>`;
        $('coach-questions').innerHTML=(data.plan.questions||[]).map(q=>`<p>${esc(q)}</p>`).join('');
        const w=data.weekly_report;
        $('coach-evidence').textContent=say(`最近 7 天：已生成安排 ${w.planned_days} 天，共 ${w.planned_tasks} 项；系统验证 ${w.verified_tasks} 项，另有 ${w.self_reports} 项手动确认。\n听力 ${w.weekly.listen} 次 · 写作 ${w.weekly.write} 次 · 成功订正 ${w.weekly.revision} 次 · 口语 ${w.weekly.speak} 次。`, `Last 7 days: ${w.planned_tasks} tasks scheduled across ${w.planned_days} days; ${w.verified_tasks} verified and ${w.self_reports} self-reported.\nListening ${w.weekly.listen} · Writing ${w.weekly.write} · Successful revisions ${w.weekly.revision} · Speaking ${w.weekly.speak}.`);
        if(data.progress.suggest_a1) $('coach-evidence').textContent += say('\n你在至少三个不同短练习中，不看文字答对了全部题目，可以试试 A1 连贯听。','\nYou answered three different short clips correctly without text hints. Try connected A1 listening.');
        $('coach-review-due').textContent=data.review_due?say('可以做一次复盘。之后每 7 天提醒一次。','Time for a reflection. We remind you every 7 days.'):say('本周已复盘，你也可以随时再检查。','You have reviewed recently; you can reflect again any time.');
        $('coach-last-review').textContent=data.last_review?`${data.last_review.date}\n${data.last_review.advice}`:'';
        $('coach-status').textContent=data.notice||'';
        window.dispatchEvent(new Event('coach-updated'));
    }
    form.addEventListener('submit',e=>{
        e.preventDefault();
        if(step<2){if(validStep())showStep(step+1);return;}
        if(!validStep())return;
        const f=new FormData(form); const p=Object.fromEntries(f);
        p.weekday_minutes=Number(p.weekday_minutes);p.weekend_minutes=Number(p.weekend_minutes);
        p.study_days=f.getAll('day').map(Number);p.reminder=f.has('reminder');p.levels={};
        Object.keys(kinds).forEach(k=>p.levels[k]=f.get('level_'+k));p.levels.review=p.levels.read;
        run($('coach-save'),async()=>{
            render(await api('/api/coach/profile',p));
            $('coach-status').textContent=say('时间表已保存，教练正在补充建议…','Schedule saved; the coach is adding advice…');
            render(await api('/api/coach/plan',{note:''}));
        });
    });
    $('coach-edit').onclick=()=>{
        for(const [key,value] of Object.entries(data.profile)) {
            const el=form.elements.namedItem(key);
            if(el && el.tagName){if(el.type==='checkbox')el.checked=value;else el.value=value;}
        }
        for(const k of Object.keys(kinds))form.elements['level_'+k].value=data.profile.levels[k]||'A1';
        form.querySelectorAll('[name=day]').forEach(el=>el.checked=data.profile.study_days.includes(Number(el.value)));
        $('coach-dashboard').hidden=true;$('coach-onboarding').hidden=false;showStep(0);
    };
    $('coach-replan').onclick=()=>run($('coach-replan'),async()=>render(await api('/api/coach/plan',{note:$('coach-reply').value})));
    $('coach-review').onclick=()=>run($('coach-review'),async()=>render(await api('/api/coach/review',{note:$('coach-reflection').value})));
    $('coach-tasks').onclick=e=>{const b=e.target.closest('[data-complete]');if(b)run(b,async()=>render(await api('/api/coach/complete',{kind:b.dataset.complete})));};
    window.FrenchI18n.apply({en:{pageTitle:'Learning coach · 1000H French',navAudio:'Audio studio',navStudy:'Study',navWrite:'Writing',navSpeak:'Speaking',navReview:'Review',navListen:'Listening'},zh:{pageTitle:'学习教练 · 1000H French'}});
    window.FrenchI18n.mountToggle($('lang-toggle'));
    if(!localStorage.getItem('frenchStudio.userToken'))$('coach-login').hidden=false;
    else api('/api/coach').then(render).catch(e=>{$('coach-status').textContent=e.message;});
})();
