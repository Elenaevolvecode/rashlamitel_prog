/* РАСХЛАМИТЕЛЬ ПК — v6 — real functions, programs sub-screens */
const isElectron = !!window.rashlamitel;
const api = window.rashlamitel || null;

const state = {
  navStack:[],currentScreen:'screen-onboarding1',cleanCount:0,trashGB:0,
  scanResults:null,cleaningInProgress:false,
  autostartData:null,programsData:null,
};

function formatBytes(b){if(!b)return'0 Б';if(b>=1073741824)return(b/1073741824).toFixed(1)+' ГБ';if(b>=1048576)return Math.round(b/1048576)+' МБ';if(b>=1024)return Math.round(b/1024)+' КБ';return b+' Б'}
function bytesToGB(b){return(b/1073741824).toFixed(1)}

// ===== NAV =====
function showScreen(id){
  if(state.currentScreen&&state.currentScreen!==id)state.navStack.push(state.currentScreen);
  document.querySelectorAll('.screen').forEach(s=>s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
  state.currentScreen=id;
}
function goBack(){
  if(state.navStack.length){
    const p=state.navStack.pop();
    document.querySelectorAll('.screen').forEach(s=>s.classList.add('hidden'));
    document.getElementById(p).classList.remove('hidden');
    state.currentScreen=p;
  } else showScreen('screen-main');
}
function switchTab(btn){
  const id=btn.dataset.tab;
  document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll(`.nav-tab[data-tab="${id}"]`).forEach(t=>t.classList.add('active'));
  state.navStack=[];state.currentScreen=id;
  document.querySelectorAll('.screen').forEach(s=>s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
  if(id==='screen-autostart'&&!state.autostartData)loadAutostart();
  else if(id==='screen-autostart')renderAutostart();
  if(id==='screen-programs'&&!state.programsData)loadPrograms();
  else if(id==='screen-programs')renderProgramsMenu();
}
async function completeOnboarding(){state.navStack=[];showScreen('screen-main');await scanTrash();}

// ===== MAIN =====
async function scanTrash(){
  document.getElementById('main-mascot-text').textContent='Сканирую компьютер… Понадобится от 20 сек до нескольких минут. Ожидайте.';
  document.getElementById('scan-details').classList.add('hidden');
  if(isElectron){state.scanResults=await api.scan();state.trashGB=parseFloat(bytesToGB(state.scanResults.total));}
  else{state.trashGB=3.7;state.scanResults={internet:{size:1.8*1073741824},programs:{size:0.9*1073741824},recycle:{size:0.6*1073741824},downloads:{size:0.3*1073741824},other:{size:0.1*1073741824},total:3.7*1073741824};await new Promise(r=>setTimeout(r,500));}
  // Show scan details
  if(state.scanResults){
    document.getElementById('scan-d-internet').textContent=formatBytes(state.scanResults.internet.size);
    document.getElementById('scan-d-programs').textContent=formatBytes(state.scanResults.programs.size);
    document.getElementById('scan-d-recycle').textContent=formatBytes(state.scanResults.recycle.size);
    document.getElementById('scan-d-downloads').textContent=formatBytes(state.scanResults.downloads.size);
    document.getElementById('scan-d-other').textContent=formatBytes(state.scanResults.other.size);
    document.getElementById('scan-details').classList.remove('hidden');
  }
  updateMainScreen();
}
function updateMainScreen(){
  const f=document.getElementById('trash-bar-fill'),a=document.getElementById('trash-amount'),t=document.getElementById('main-mascot-text');
  if(state.trashGB>3){t.textContent=`Накопилось ${state.trashGB} ГБ мусора — пора почистить!`;f.style.width=Math.min(state.trashGB/5*100,100)+'%';f.style.background='linear-gradient(90deg,var(--accent-amber),#e05a15)';}
  else if(state.trashGB>0.5){t.textContent='Есть что почистить!';f.style.width=Math.max(state.trashGB/5*100,15)+'%';f.style.background='linear-gradient(90deg,var(--accent-amber),#e05a15)';}
  else if(state.trashGB>0){t.textContent='Немного мусора — но можно почистить';f.style.width='12%';f.style.background='#1D8A40';}
  else{t.textContent='Компьютер чистый — всё в порядке!';f.style.width='5%';f.style.background='#1D8A40';}
  a.textContent=state.trashGB+' ГБ';
}

// ===== CLEANING =====
async function startCleaning(){
  if(state.cleaningInProgress)return;state.cleaningInProgress=true;state.navStack=[];showScreen('screen-cleaning');
  document.getElementById('progress-fill').style.width='0%';document.getElementById('cleaning-freed').textContent='Освобождено: 0.0 ГБ';document.getElementById('cleaning-percent').textContent='0%';
  document.querySelectorAll('.step-item').forEach((el,i)=>{el.classList.remove('active','done');el.querySelector('.step-check').textContent=i===0?'●':'○';});
  if(isElectron){api.onCleanProgress(updateCleanUI);api.onCleanDone(r=>{state.cleaningInProgress=false;state.cleanCount++;state.trashGB=0;showRes(r);});await api.clean();}
  else runDemo();
}
function updateCleanUI(d){
  const tot=state.scanResults?state.scanResults.total:3.7*1073741824;const pct=Math.min(Math.round(d.freed/tot*100),100);
  document.getElementById('cleaning-step-text').textContent=d.text;document.getElementById('cleaning-step-sub').textContent=d.sub;
  document.getElementById('progress-fill').style.width=pct+'%';document.getElementById('cleaning-freed').textContent='Освобождено: '+bytesToGB(d.freed)+' ГБ';document.getElementById('cleaning-percent').textContent=pct+'%';
  document.querySelectorAll('.step-item').forEach((el,i)=>{el.classList.remove('active','done');if(i<d.step){el.classList.add('done');el.querySelector('.step-check').textContent='✓';}else if(i===d.step){el.classList.add(d.done?'done':'active');el.querySelector('.step-check').textContent=d.done?'✓':'●';}else el.querySelector('.step-check').textContent='○';});
}
function runDemo(){
  const ss=[{t:'Убираю мусор из интернета…',s:'Chrome, Яндекс Браузер, Edge, Firefox',f:1.8},{t:'Удаляю остатки от программ…',s:'Временные файлы Windows',f:.9},{t:'Очищаю корзину…',s:'847 файлов',f:.6},{t:'Проверяю скачанные файлы…',s:'Старые установщики',f:.3},{t:'Почти готово!',s:'Файлы отчётов и логов',f:.1}];
  let i=0,freed=0;const tot=ss.reduce((s,d)=>s+d.f,0);
  function nx(){if(i>=ss.length){state.cleaningInProgress=false;state.cleanCount++;state.trashGB=0;showRes({totalFreed:tot*1073741824,internet:1.8*1073741824,programs:.9*1073741824,recycle:.6*1073741824,downloads:.3*1073741824,other:.1*1073741824});return;}
  const d=ss[i];freed+=d.f;const p=Math.round(freed/tot*100);
  document.getElementById('cleaning-step-text').textContent=d.t;document.getElementById('cleaning-step-sub').textContent=d.s;
  document.getElementById('progress-fill').style.width=p+'%';document.getElementById('cleaning-freed').textContent='Освобождено: '+freed.toFixed(1)+' ГБ';document.getElementById('cleaning-percent').textContent=p+'%';
  document.querySelectorAll('.step-item').forEach((el,j)=>{el.classList.remove('active','done');if(j<i){el.classList.add('done');el.querySelector('.step-check').textContent='✓';}else if(j===i){el.classList.add('active');el.querySelector('.step-check').textContent='●';}else el.querySelector('.step-check').textContent='○';});
  i++;setTimeout(nx,1500+Math.random()*1000);}setTimeout(nx,800);
}
function showRes(r){
  document.getElementById('result-gb').textContent=bytesToGB(r.totalFreed);
  document.getElementById('res-internet').textContent=formatBytes(r.internet);document.getElementById('res-programs').textContent=formatBytes(r.programs);
  document.getElementById('res-trash').textContent=formatBytes(r.recycle);document.getElementById('res-downloads').textContent=formatBytes(r.downloads);
  document.getElementById('res-other').textContent=formatBytes(r.other);state.navStack=[];showScreen('screen-result');
}
function finishCleaning(){state.navStack=[];showScreen('screen-main');updateMainScreen();}

// ===== AUTOSTART (real StartupApproved) =====
async function loadAutostart(){
  document.getElementById('autostart-list').innerHTML='<p style="text-align:center;color:var(--text-secondary);padding:16px">Загрузка...</p>';
  if(isElectron){state.autostartData=await api.getAutostart();}
  else{state.autostartData=[
    {id:'win_def',name:'Windows Security',category:'green',label:'Нужна',icon:'🛡',registryName:'SecurityHealth',location:'HKLM',enabled:true},
    {id:'chrome',name:'Google Chrome',category:'yellow',label:'Можно откл.',icon:'🌐',registryName:'GoogleChrome',location:'HKCU',enabled:true},
    {id:'telegram',name:'Telegram',category:'yellow',label:'Можно откл.',icon:'💬',registryName:'Telegram',location:'HKCU',enabled:true},
    {id:'utorrent',name:'uTorrent',category:'red',label:'Лучше откл.',icon:'⚠',registryName:'uTorrent',location:'HKCU',enabled:true},
  ];}
  renderAutostart();
}

function renderAutostart(){
  const list=document.getElementById('autostart-list');const d=state.autostartData;if(!d)return;
  const canOff=d.filter(p=>p.category!=='green').length;
  document.getElementById('autostart-subtitle').textContent=`${d.length} программ запускаются при включении и расходуют память. ${canOff} из них можно отключить — компьютер станет работать быстрее`;
  list.innerHTML=d.map(p=>{
    const checked=p.enabled?'checked':'';
    return `<div class="autostart-card"><div class="autostart-card-left"><span class="autostart-icon">${p.icon}</span><div><span class="autostart-name">${p.name}</span><span class="autostart-label ${p.category}">${p.label}</span></div></div><label class="toggle"><input type="checkbox" ${checked} data-id="${p.id}" data-regname="${p.registryName||''}" data-location="${p.location||''}" onchange="toggleAutostart(this)"><span class="toggle-slider"></span></label></div>`;
  }).join('');
}

async function toggleAutostart(input){
  const id=input.dataset.id,prog=state.autostartData.find(p=>p.id===id);
  if(!prog)return;
  if(prog.category==='green'&&!input.checked){input.checked=true;showToast(`${prog.name} нужна для работы компьютера`);return;}

  if(isElectron){
    const ok=input.checked
      ? await api.enableAutostart(input.dataset.regname,input.dataset.location)
      : await api.disableAutostart(input.dataset.regname,input.dataset.location);
    if(!ok){input.checked=!input.checked;showToast('Не удалось изменить — попробуйте запустить от имени администратора');return;}
    prog.enabled=input.checked;
  } else { prog.enabled=input.checked; }
  showToast(input.checked?`${prog.name} включена`:`${prog.name} отключена`);
}

async function disableAllUnnecessary(){
  for(const input of document.querySelectorAll('.autostart-card .toggle input')){
    const id=input.dataset.id,prog=state.autostartData.find(p=>p.id===id);
    if(prog&&prog.category==='red'&&input.checked){
      input.checked=false;prog.enabled=false;
      if(isElectron)await api.disableAutostart(input.dataset.regname,input.dataset.location);
    }
  }
  showToast('Готово! При следующем включении компьютер запустится быстрее');
}

// ===== PROGRAMS (sub-screens) =====
async function loadPrograms(){
  document.getElementById('programs-subtitle').textContent='Загрузка…';
  if(isElectron){state.programsData=await api.getPrograms();}
  else{state.programsData=[
    {name:'uTorrent Web',size:'28 МБ',sizeBytes:29360128,category:'junk',reason:'Показывает рекламу',uninstallString:'',quietUninstall:''},
    {name:'Adobe Photoshop',size:'2.7 ГБ',sizeBytes:2900000000,category:'other',reason:''},
    {name:'Microsoft Office',size:'2.1 ГБ',sizeBytes:2254857830,category:'system',reason:''},
    {name:'Windows SDK',size:'2.3 ГБ',sizeBytes:2469606195,category:'system',reason:''},
  ];}
  renderProgramsMenu();
}

function renderProgramsMenu(){
  const d=state.programsData;if(!d)return;
  const junk=d.filter(p=>p.category==='junk');
  const other=d.filter(p=>p.category==='other'||p.category==='used');
  const sys=d.filter(p=>p.category==='system');

  // Update counts and subtitle
  document.getElementById('programs-subtitle').textContent=
    `На компьютере ${d.length} программ.${junk.length?' Есть '+junk.length+', которые лучше удалить.':' Мусорных не найдено.'}`;

  const junkMenu=document.getElementById('prog-menu-junk');
  if(junk.length){junkMenu.style.display='';document.getElementById('prog-count-junk').textContent=junk.length;}
  else junkMenu.style.display='none';

  document.getElementById('prog-count-other').textContent=other.length;
  document.getElementById('prog-count-system').textContent=sys.length;
}

function showProgScreen(type){
  const d=state.programsData;if(!d)return;
  if(type==='junk'){
    const items=d.filter(p=>p.category==='junk');
    document.getElementById('prog-list-junk').innerHTML=items.map(p=>
      `<div class="program-card" data-name="${p.name}" style="border-left:3px solid var(--danger)"><div class="program-info"><span class="program-name">${p.name}</span><span class="program-size">${p.size}</span>${p.reason?`<span class="program-reason">${p.reason}</span>`:''}</div><button class="btn-remove" onclick="doUninstall('${esc(p.name)}','${p.size}','${esc(p.uninstallString||'')}','${esc(p.quietUninstall||'')}')">Удалить</button></div>`
    ).join('')||'<p style="text-align:center;color:var(--text-secondary);padding:20px">Мусорных программ не найдено</p>';
    showScreen('screen-prog-junk');
  } else if(type==='other'){
    const items=d.filter(p=>p.category==='other'||p.category==='used');
    document.getElementById('prog-list-other').innerHTML=items.map(p=>
      `<div class="program-card"><div class="program-info"><span class="program-name">${p.name}</span><span class="program-size">${p.size}</span></div></div>`
    ).join('');
    showScreen('screen-prog-other');
  } else if(type==='other-delete'){
    const items=d.filter(p=>p.category==='other'||p.category==='used');
    document.getElementById('prog-list-other-delete').innerHTML=items.map(p=>
      `<div class="program-card" data-name="${p.name}"><div class="program-info"><span class="program-name">${p.name}</span><span class="program-size">${p.size}</span></div><button class="btn-remove" onclick="doUninstall('${esc(p.name)}','${p.size}','${esc(p.uninstallString||'')}','${esc(p.quietUninstall||'')}')">Удалить</button></div>`
    ).join('');
    showScreen('screen-prog-other-delete');
  } else if(type==='system'){
    const items=d.filter(p=>p.category==='system');
    document.getElementById('prog-list-system').innerHTML=items.map(p=>
      `<div class="program-card"><div class="program-info"><span class="program-name">${p.name}</span><span class="program-size">${p.size}</span></div><span class="btn-system">🔒</span></div>`
    ).join('');
    showScreen('screen-prog-system');
  }
}

function esc(s){return s.replace(/'/g,"\\'").replace(/"/g,'&quot;')}

function doUninstall(name,size,uninstStr,quietStr){
  document.getElementById('delete-dialog-title').textContent='Удалить '+name+'?';
  document.getElementById('delete-dialog-text').textContent='Это освободит '+size+' на диске. Будет запущен стандартный деинсталлятор программы.';
  document.getElementById('delete-dialog-overlay').classList.remove('hidden');
  document.getElementById('delete-confirm-btn').onclick=async()=>{
    closeDeleteDialog();
    if(isElectron&&(uninstStr||quietStr)){
      showToast('Запускаем удаление '+name+'…');
      const ok=await api.uninstallProgram(uninstStr,quietStr);
      if(ok){
        showToast(name+' удалена');
        state.programsData=null;// force reload
        await loadPrograms();
        showProgScreen('junk');
      } else showToast('Не удалось запустить деинсталлятор');
    } else {
      // Demo
      const c=document.querySelector(`.program-card[data-name="${name}"]`);
      if(c){c.style.transition='opacity .3s';c.style.opacity='0';setTimeout(()=>c.remove(),300);}
      showToast(name+' удалена');
    }
  };
}
function closeDeleteDialog(){document.getElementById('delete-dialog-overlay').classList.add('hidden')}

// ===== OTHER =====
function showDonate(){document.getElementById('donate-overlay').classList.remove('hidden');document.getElementById('screen-donate').classList.remove('hidden')}
function closeDonate(){document.getElementById('donate-overlay').classList.add('hidden');document.getElementById('screen-donate').classList.add('hidden')}
function handleDonate(){closeDonate();showToast('Спасибо! 💚')}
function closeBrowserAndClean(){document.getElementById('browser-dialog-overlay').classList.add('hidden')}
function skipBrowser(){document.getElementById('browser-dialog-overlay').classList.add('hidden')}
function showToast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.remove('hidden');clearTimeout(window._tt);window._tt=setTimeout(()=>t.classList.add('hidden'),3500)}

function renderQR(){const q=document.getElementById('qr-code');const s=160,c=21,cs=s/c;let svg=`<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" xmlns="http://www.w3.org/2000/svg">`;for(let y=0;y<c;y++)for(let x=0;x<c;x++){let f=false;if((x<7&&y<7)||(x>=c-7&&y<7)||(x<7&&y>=c-7)){const dx=x<7?x:x>=c-7?x-(c-7):x,dy=y<7?y:y-(c-7);f=dx===0||dx===6||dy===0||dy===6||(dx>=2&&dx<=4&&dy>=2&&dy<=4);}else f=Math.random()>.55;if(f)svg+=`<rect x="${x*cs}" y="${y*cs}" width="${cs+.5}" height="${cs+.5}" fill="#1E1B16" rx="1"/>`;}svg+='</svg>';q.innerHTML=svg;}

function init(){console.log(isElectron?'🔧 ELECTRON — реальная работа':'🖥 BROWSER — демо');renderQR();showScreen('screen-onboarding1');}
document.addEventListener('DOMContentLoaded',init);
