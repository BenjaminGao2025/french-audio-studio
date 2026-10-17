// Two ways to start one Study workspace; keep recordings and text on the same page.
(() => {
    'use strict';
    const text=document.getElementById('study-text-workspace'), personal=document.getElementById('study-personal');
    if(!text||!personal)return;
    let current=new URLSearchParams(location.search).get('mode')==='personal'?'personal':'text';
    function paint(){
        text.hidden=current!=='text';personal.hidden=current!=='personal';
        for(const mode of ['text','personal'])document.getElementById('study-mode-'+mode).setAttribute('aria-pressed',String(current===mode));
    }
    async function select(mode,{returnToPractice=false}={}){
        if(mode===current)return true;
        if(current==='personal'&&window.PersonalPractice&&!await window.PersonalPractice.leave())return false;
        for(const audio of document.querySelectorAll('audio'))audio.pause();
        current=mode;paint();
        const url=new URL(location.href);if(mode==='personal')url.searchParams.set('mode','personal');else url.searchParams.delete('mode');
        history.replaceState(null,'',url.pathname+url.search+url.hash);
        document.getElementById('study-back-personal').hidden=!returnToPractice;
        document.dispatchEvent(new CustomEvent('study:modechange',{detail:{mode}}));
        return true;
    }
    for(const mode of ['text','personal'])document.getElementById('study-mode-'+mode).onclick=()=>select(mode);
    document.getElementById('study-back-personal').onclick=()=>select('personal');
    window.StudyModes={select,get current(){return current;}};
    paint();
    window.addEventListener('popstate',()=>select(new URLSearchParams(location.search).get('mode')==='personal'?'personal':'text'));
})();
