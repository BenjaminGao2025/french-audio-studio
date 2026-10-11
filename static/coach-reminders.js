/* Opt-in, visible-page reminders only. No push/email and no claims of background delivery. */
(() => {
    if(!localStorage.getItem('frenchStudio.userToken'))return;
    let latest, fetching=false;
    const EN=window.FrenchI18n?.lang()==='en';
    async function refresh(){
        if(fetching)return;fetching=true;
        try{const r=await fetch('/api/coach',{headers:{Authorization:'Bearer '+localStorage.getItem('frenchStudio.userToken')}});if(r.ok)latest=await r.json();}catch(_){}finally{fetching=false;}
        remind();
    }
    function remind(){
        if(document.hidden||!latest?.setup||!latest.profile.reminder||document.querySelector('.coach-notice'))return;
        const parts=new Intl.DateTimeFormat('en-CA',{timeZone:latest.profile.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
        const hh=Number(parts.find(p=>p.type==='hour').value),mm=Number(parts.find(p=>p.type==='minute').value);
        const task=latest.tasks.find(t=>{const [h,m]=t.start.split(':').map(Number);const delta=hh*60+mm-h*60-m;return !t.done && delta>=0 && delta<60;});
        const key=task?`${latest.day}:${task.kind}`:latest.review_due?`review:${latest.day}`:null;
        if(!key||sessionStorage.getItem('coach-reminded:'+key))return;
        sessionStorage.setItem('coach-reminded:'+key,'1');
        const box=document.createElement('aside');box.className='coach-notice';box.setAttribute('role','status');
        const close=document.createElement('button');close.type='button';close.className='btn btn-secondary';close.textContent=EN?'Later':'稍后';close.onclick=()=>box.remove();
        const text=document.createElement('p');text.textContent=task?(EN?`Time for ${task.en.toLowerCase()} · ${task.minutes} min`:`到学习时间了：${task.zh} · ${task.minutes} 分钟`):(EN?'A weekly reflection is due.':'可以做一次每周复盘了。');
        const a=document.createElement('a');a.href=task?.href||'/coach';a.textContent=EN?'Open my plan':'查看安排';box.append(close,text,a);document.body.append(box);
    }
    setInterval(refresh,10*60*1000);setInterval(remind,60000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});window.addEventListener('coach-updated',refresh);refresh();
})();
