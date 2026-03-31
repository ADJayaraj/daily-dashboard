// ─── Project colour palette ───────────────────────────────────────────────────
const PROJ_COLORS=['#f0c040','#4af0a0','#60a0f0','#c060ff','#ff8060','#f06060','#40d0f0','#a0f060'];

// ─── Category meta ────────────────────────────────────────────────────────────
const CAT_META={
  deep:   {label:'Deep Work',  emoji:'🔥',cls:'cat-deep',   badge:'badge-deep'   },
  meeting:{label:'Meeting',    emoji:'📞',cls:'cat-meeting',badge:'badge-meeting'},
  review: {label:'Code Review',emoji:'🔍',cls:'cat-review', badge:'badge-review' },
  admin:  {label:'Admin',      emoji:'📬',cls:'cat-admin',  badge:'badge-admin'  },
  help:   {label:'Help',       emoji:'🤝',cls:'cat-help',   badge:'badge-help'   },
  break:  {label:'Break',      emoji:'☕',cls:'cat-break',  badge:'badge-break'  },
};

// ─── State ────────────────────────────────────────────────────────────────────
const TASK_STATUS_META={
  ready:{label:'Ready', className:'hist-task-pending'},
  in_progress:{label:'In Progress', className:'yellow'},
  done:{label:'Done', className:'hist-task-done'},
  carried_over:{label:'Carried Over', className:'blue'},
};

let dayStartHour=10, dayEndHour=18, clockMode='current';
let projectsPanelOpen=true;

let projects=[]; // {id, name, desc, members, allocHrs, color}

function createTaskId(){
  return 't'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
}

function inferTaskStatus(o={}){
  if(o.status && TASK_STATUS_META[o.status]) return o.status;
  if(o.done) return 'done';
  if(o.running) return 'in_progress';
  if(o.carriedOverFrom) return 'carried_over';
  return 'ready';
}

function normalizeTaskRecord(o={}){
  const totalSeconds = Math.max(0,(parseInt(o.time,10)||0) * 60);
  const createdAt = o.createdAt || o.doneAt || o.startedAt || Date.now();
  const done = !!o.done || o.status==='done';
  const running = !!o.running && !done;
  return {
    ...o,
    id: o.id || createTaskId(),
    time: parseInt(o.time,10)||0,
    remaining: typeof o.remaining === 'number' ? o.remaining : totalSeconds,
    running,
    done,
    notesHTML: o.notesHTML || '',
    subtasks: Array.isArray(o.subtasks) ? o.subtasks : [],
    projectId: o.projectId || null,
    scheduledTime: o.scheduledTime || null,
    createdAt,
    startedAt: o.startedAt || null,
    doneAt: done ? (o.doneAt || Date.now()) : (o.doneAt || null),
    carriedOverFrom: o.carriedOverFrom || null,
    status: inferTaskStatus({...o, done, running}),
  };
}

function getTaskStatus(task){
  return inferTaskStatus(task||{});
}

function makeTask(o){
  const task = normalizeTaskRecord(o);
  return {...task,interval:null,notesOpen:false,subtasksOpen:false};
}

let tasks=[];

// ─── Over-allocation tracking ─────────────────────────────────────────────────
// fired notifications set so we don't spam
const overAllocNotified=new Set();

function checkOverAllocation(){
  projects.forEach(p=>{
    const allocMin=p.allocHrs*60;
    const elapsedMin=tasks
      .filter(t=>t.projectId===p.id)
      .reduce((a,t)=>a+(t.time*60-t.remaining),0)/60;
    const plannedMin=tasks
      .filter(t=>t.projectId===p.id)
      .reduce((a,t)=>a+t.time,0);
    // warn when elapsed time first crosses allocation
    if(elapsedMin>allocMin && !overAllocNotified.has(p.id)){
      overAllocNotified.add(p.id);
      notifyWarn(`⚠️ Over-allocation: "${p.name}" — ${Math.round(elapsedMin)}min elapsed vs ${p.allocHrs*60}min allocated`);
    }
    // also warn if planned time alone exceeds allocation (static check on render)
    const warnKey=p.id+'-planned';
    if(plannedMin>allocMin && !overAllocNotified.has(warnKey)){
      overAllocNotified.add(warnKey);
      notifyWarn(`📋 "${p.name}" has ${plannedMin}min planned but only ${p.allocHrs*60}min allocated`);
    }
  });
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
let sidebarCollapsed = false;
function toggleSidebar(){
  sidebarCollapsed = !sidebarCollapsed;
  document.getElementById('sidebar').classList.toggle('collapsed', sidebarCollapsed);
}

// ─── Projects Modal ───────────────────────────────────────────────────────────
function openProjectsModal(){
  renderProjects();
  document.getElementById('projectsModal').classList.add('open');
}
function closeProjectsModal(){
  document.getElementById('projectsModal').classList.remove('open');
}

// ─── Logistics Modal ──────────────────────────────────────────────────────────
function openLogisticsModal(){
  renderLogistics();
  document.getElementById('logisticsModal').classList.add('open');
}
function closeLogisticsModal(){
  document.getElementById('logisticsModal').classList.remove('open');
}

// ─── Projects ─────────────────────────────────────────────────────────────────
function toggleProjectsPanel(){} // compat no-op

function addProject(){
  const name   =document.getElementById('newProjName').value.trim();
  const desc   =document.getElementById('newProjDesc').value.trim();
  const members=document.getElementById('newProjMembers').value.trim();
  const alloc  =parseFloat(document.getElementById('newProjAlloc').value)||0;
  if(!name){notify('⚠️ Project name required');return;}
  const id='p'+Date.now();
  const color=PROJ_COLORS[projects.length%PROJ_COLORS.length];
  projects.push({id,name,desc,members,allocHrs:alloc,color});
  ['newProjName','newProjDesc','newProjMembers','newProjAlloc'].forEach(id=>document.getElementById(id).value='');
  renderProjects();
  rebuildProjectSelect();
  notify(`📁 Project "${name}" added`);
}

function deleteProject(id){
  projects=projects.filter(p=>p.id!==id);
  tasks.forEach(t=>{if(t.projectId===id)t.projectId=null;});
  overAllocNotified.delete(id);
  overAllocNotified.delete(id+'-planned');
  renderProjects();
  rebuildProjectSelect();
  render();
}

function renderProjects(){
  const grid=document.getElementById('pmProjectGrid');
  if(!grid) return;
  // Update all count badges
  const cnt=`${projects.length} project${projects.length!==1?'s':''}`;
  const sbCount=document.getElementById('sbProjectsCount');
  const pmCount=document.getElementById('pmProjectsCount');
  if(sbCount) sbCount.textContent=projects.length;
  if(pmCount) pmCount.textContent=cnt;
  if(projects.length===0){grid.innerHTML='';return;}
  grid.innerHTML=projects.map(p=>{
    const allocMin=p.allocHrs*60;
    const plannedMin=tasks.filter(t=>t.projectId===p.id).reduce((a,t)=>a+t.time,0);
    const elapsedMin=tasks.filter(t=>t.projectId===p.id).reduce((a,t)=>a+(t.time*60-t.remaining),0)/60;
    const fillPct=allocMin>0?Math.min(100,Math.round((plannedMin/allocMin)*100)):0;
    const elPct  =allocMin>0?Math.min(100,Math.round((elapsedMin/allocMin)*100)):0;
    const overPlanned=allocMin>0&&plannedMin>allocMin;
    const fillColor=overPlanned?'var(--accent3)':p.color;
    return `
    <div class="project-card" style="border-left-color:${p.color}">
      <div class="project-card-top">
        <div class="project-card-name" style="color:${p.color}">${esc(p.name)}</div>
        <button class="project-del-btn" onclick="deleteProject('${p.id}')">✕</button>
      </div>
      ${p.desc?`<div class="project-card-desc">${esc(p.desc)}</div>`:''}
      ${p.members?`<div class="project-members">👥 ${esc(p.members)}</div>`:''}
      ${allocMin>0?`
      <div class="project-alloc-bar-wrap">
        <div class="project-alloc-label">
          <span class="pal-left">Planned ${plannedMin}min / ${allocMin}min alloc</span>
          <span class="pal-right" style="color:${overPlanned?'var(--accent3)':p.color}">${fillPct}%${overPlanned?' ⚠️':''}</span>
        </div>
        <div class="project-alloc-track">
          <div class="project-alloc-fill" style="width:${fillPct}%;background:${fillColor}"></div>
        </div>
      </div>
      <div style="font-size:.68rem;font-family:'JetBrains Mono',monospace;color:var(--muted)">Elapsed: ${Math.round(elapsedMin)}min (${elPct}%)</div>
      `:`<div style="font-size:.68rem;color:var(--muted);font-family:'JetBrains Mono',monospace">No daily allocation set</div>`}
    </div>`;
  }).join('');
}

function rebuildProjectSelect(){
  const sel=document.getElementById('newTaskProject');
  const cur=sel.value;
  sel.innerHTML='<option value="">— No project —</option>';
  projects.forEach(p=>{
    sel.innerHTML+=`<option value="${p.id}">${p.name}</option>`;
  });
  if(cur) sel.value=cur;
}

// ─── Hours selects ────────────────────────────────────────────────────────────
function buildHourSelects(){
  ['startHour','endHour'].forEach((id,idx)=>{
    const sel=document.getElementById(id),def=idx===0?dayStartHour:dayEndHour;
    sel.innerHTML='';
    for(let h=0;h<24;h++) sel.innerHTML+=`<option value="${h}"${h===def?' selected':''}>${String(h).padStart(2,'0')}:00</option>`;
  });
}
function onHoursChange(){
  dayStartHour=parseInt(document.getElementById('startHour').value);
  dayEndHour  =parseInt(document.getElementById('endHour').value);
  const hrs=Math.max(0,dayEndHour-dayStartHour);
  document.getElementById('headerSubtitle').textContent=`${String(dayStartHour).padStart(2,'0')}:00 → ${String(dayEndHour).padStart(2,'0')}:00 · ${hrs}-hour focus plan`;
  if(clockMode==='until') document.getElementById('clockModeLabel').textContent=`TIME UNTIL ${String(dayEndHour).padStart(2,'0')}:00 · click to toggle`;
  buildTimeSlots();
  renderTimeline();
}

// ─── Clock ────────────────────────────────────────────────────────────────────
function toggleClockMode(){
  clockMode=clockMode==='current'?'until':'current';
  const el=document.getElementById('liveClock'),lb=document.getElementById('clockModeLabel');
  if(clockMode==='until'){el.classList.add('mode-until');lb.textContent=`TIME UNTIL ${String(dayEndHour).padStart(2,'0')}:00 · click to toggle`;}
  else{el.classList.remove('mode-until');lb.textContent='CURRENT TIME · click to toggle';}
}
function updateClock(){
  const now=new Date(),el=document.getElementById('liveClock');
  if(clockMode==='until'){
    const end=new Date(now);end.setHours(dayEndHour,0,0,0);
    const diff=Math.max(0,end-now);
    el.textContent=`${String(Math.floor(diff/3600000)).padStart(2,'0')}:${String(Math.floor((diff%3600000)/60000)).padStart(2,'0')}:${String(Math.floor((diff%60000)/1000)).padStart(2,'0')}`;
  }else{
    el.textContent=now.toLocaleTimeString('en-US',{hour12:false});
  }
  document.getElementById('liveDate').textContent=now.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});
  const start=new Date(now);start.setHours(dayStartHour,0,0,0);
  const end2=new Date(now);end2.setHours(dayEndHour,0,0,0);
  const tot=end2-start;
  if(tot>0){
    const pct=Math.round((Math.min(Math.max(now-start,0),tot)/tot)*100);
    document.getElementById('dayProgressBar').style.width=pct+'%';
    document.getElementById('dayProgressPct').textContent=pct+'%';
  }
}
setInterval(updateClock,1000);updateClock();

// ─── Stats ────────────────────────────────────────────────────────────────────
function updateStats(){
  const total=tasks.length;
  const done=tasks.filter(t=>t.done).length;
  const timeLeft=formatHM(tasks.filter(t=>!t.done).reduce((a,t)=>a+t.remaining,0));
  const focus=tasks.filter(t=>t.cat==='deep').reduce((a,t)=>a+t.time,0)+'m';
  const setText=(id,val)=>{const el=document.getElementById(id); if(el) el.textContent=val;};
  setText('statTotal', total);
  setText('statDone', done);
  setText('statTimeLeft', timeLeft);
  setText('statFocus', focus);
  setText('sideStatTotal', total);
  setText('sideStatDone', done);
  setText('sideStatTimeLeft', timeLeft);
  setText('sideStatFocus', focus);
}
function formatHM(sec){const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60);return h>0?`${h}h ${m}m`:`${m}m`;}

// ─── Active banner ────────────────────────────────────────────────────────────
function updateActiveBanner(){
  const r=tasks.find(t=>t.running),b=document.getElementById('activeBanner');
  if(r){
    b.classList.add('visible');
    let label=CAT_META[r.cat].emoji+' '+r.name;
    const proj=r.projectId?projects.find(p=>p.id===r.projectId):null;
    if(proj) label+=` · <span style="color:${proj.color}">${esc(proj.name)}</span>`;
    document.getElementById('activeBannerName').innerHTML=label;
    document.getElementById('activeBannerTimer').textContent=format(r.remaining);
  } else b.classList.remove('visible');
}

// ─── Render tasks ─────────────────────────────────────────────────────────────
function render(){
  const grid=document.getElementById('taskGrid');
  grid.innerHTML='';
  tasks.forEach((task,i)=>{
    const meta=CAT_META[task.cat]||CAT_META.admin;
    const total=task.time*60,fillPct=Math.round(((total-task.remaining)/total)*100);
    const stCount=task.subtasks.length,stDone=task.subtasks.filter(s=>s.done).length;
    const stLabel=stCount>0?` (${stDone}/${stCount})`:'';
    const notesDot=task.notesHTML?' ●':'';
    const proj=task.projectId?projects.find(p=>p.id===task.projectId):null;

    const stHTML=task.subtasks.map((st,si)=>`
      <li class="subtask-item">
        <input type="checkbox" class="subtask-cb" ${st.done?'checked':''} onchange="toggleSubtask(${i},${si})">
        <span class="subtask-label${st.done?' checked':''}" onclick="toggleSubtask(${i},${si})">${esc(st.text)}</span>
        <button class="subtask-del" onclick="deleteSubtask(${i},${si})">✕</button>
      </li>`).join('');

    const projTagHTML=proj
      ?`<div><span class="proj-tag" style="color:${proj.color};border-color:${proj.color};background:${proj.color}18">📁 ${esc(proj.name)}</span></div>`
      :'';

    const schedOptions=buildSchedOptions(task.scheduledTime);
    const card=document.createElement('div');
    card.className=`task-card ${meta.cls}${task.running?' running':''}${task.done?' is-done':''}`;
    card.id=`card-${i}`;
    card.innerHTML=`
      <div class="task-top">
        <div class="task-name">${esc(task.name)}</div>
        <span class="cat-badge ${meta.badge}">${meta.label}</span>
      </div>
      ${projTagHTML}
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <select style="font-size:.7rem;padding:3px 6px;border-radius:6px;background:var(--bg);border:1px solid var(--border);color:${task.scheduledTime?'var(--accent)':'var(--muted)'};font-family:'JetBrains Mono',monospace;" onchange="setTaskSchedule(${i},this.value)" title="Schedule on timeline">${schedOptions}</select>
        ${task.scheduledTime?`<span style="font-size:.65rem;font-family:'JetBrains Mono',monospace;color:var(--accent);">⏱ ${task.scheduledTime}</span>`:''}
      </div>
      <div class="task-time-display" id="timer-${i}">${format(task.remaining)}</div>
      <div class="task-progress-track"><div class="task-progress-fill" id="prog-${i}" style="width:${fillPct}%"></div></div>
      <div class="task-actions">
        <button class="btn btn-start" onclick="startTask(${i})">▶ Start</button>
        <button class="btn btn-pause" onclick="pauseTask(${i})">⏸ Pause</button>
        <button class="btn btn-reset" onclick="resetTask(${i})">↺</button>
        <button class="btn btn-done"  onclick="markDone(${i})">✓ Done</button>
        <button class="btn btn-del"   onclick="deleteTask(${i})">✕</button>
        <button class="btn" style="background:var(--surface2);border:1px solid var(--border);color:var(--muted);" onclick="openFocus(${i})" title="Fullscreen focus">⛶</button>
      </div>
      <div class="expand-row">
        <button class="expand-btn${task.notesOpen?' active':''}" id="notesBtn-${i}" onclick="toggleNotes(${i})">📝 Notes${notesDot}</button>
        <button class="expand-btn${task.subtasksOpen?' active':''}" id="stBtn-${i}" onclick="toggleSubtasks(${i})">☑ Subtasks${stLabel}</button>
      </div>
      <div class="notes-panel${task.notesOpen?' open':''}" id="notes-${i}">
        <div class="notes-hint">Type · or ⌘V/Ctrl+V to paste a screenshot</div>
        <div class="notes-editor" id="notesEditor-${i}" contenteditable="true"
          data-placeholder="Add notes, blockers, links…"
          oninput="saveNotesHTML(${i})"
          onpaste="handleNotesPaste(event,${i})"></div>
      </div>
      <div class="subtasks-panel${task.subtasksOpen?' open':''}" id="subtasks-${i}">
        <ul class="subtask-list">${stHTML}</ul>
        <div class="subtask-add-row">
          <input id="stinput-${i}" placeholder="Add subtask…" onkeydown="if(event.key==='Enter') addSubtask(${i})">
          <button onclick="addSubtask(${i})">+ Add</button>
        </div>
      </div>`;
    grid.appendChild(card);
    if(task.notesHTML){const ed=card.querySelector(`#notesEditor-${i}`);if(ed)ed.innerHTML=task.notesHTML;}
  });
  updateStats();
  updateActiveBanner();
  renderProjects();
  checkOverAllocation();
  renderTimeline();
}

function buildSchedOptions(current){
  let html='<option value="">⏰ Unscheduled</option>';
  for(let h=dayStartHour;h<dayEndHour;h++){
    for(let m=0;m<60;m+=5){
      const val=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      html+=`<option value="${val}"${current===val?' selected':''}>${val}</option>`;
    }
  }
  return html;
}

function setTaskSchedule(i,val){
  tasks[i].scheduledTime=val||null;
  renderTimeline();
  scheduleSave();
}

// ─── Notes ────────────────────────────────────────────────────────────────────
function toggleNotes(i){
  tasks[i].notesOpen=!tasks[i].notesOpen;
  document.getElementById(`notes-${i}`)?.classList.toggle('open',tasks[i].notesOpen);
  document.getElementById(`notesBtn-${i}`)?.classList.toggle('active',tasks[i].notesOpen);
}
function saveNotesHTML(i){
  const ed=document.getElementById(`notesEditor-${i}`);if(!ed)return;
  tasks[i].notesHTML=ed.innerHTML;
  const btn=document.getElementById(`notesBtn-${i}`);
  if(btn)btn.textContent='📝 Notes'+(tasks[i].notesHTML&&tasks[i].notesHTML!=='<br>'?' ●':'');
}
function handleNotesPaste(e,i){
  const items=e.clipboardData?.items;if(!items)return;
  for(const item of items){
    if(item.type.startsWith('image/')){
      e.preventDefault();
      const reader=new FileReader();
      reader.onload=ev=>{
        const img=document.createElement('img');img.src=ev.target.result;img.style.maxWidth='100%';
        const ed=document.getElementById(`notesEditor-${i}`);
        if(ed){
          const sel=window.getSelection();
          if(sel&&sel.rangeCount&&ed.contains(sel.getRangeAt(0).commonAncestorContainer)){
            const r=sel.getRangeAt(0);r.deleteContents();r.insertNode(img);r.collapse(false);
          }else ed.appendChild(img);
          saveNotesHTML(i);notify('🖼 Image pasted into notes');
        }
      };
      reader.readAsDataURL(item.getAsFile());return;
    }
  }
  setTimeout(()=>saveNotesHTML(i),0);
}

// ─── Subtasks ─────────────────────────────────────────────────────────────────
function toggleSubtasks(i){
  tasks[i].subtasksOpen=!tasks[i].subtasksOpen;
  document.getElementById(`subtasks-${i}`)?.classList.toggle('open',tasks[i].subtasksOpen);
  document.getElementById(`stBtn-${i}`)?.classList.toggle('active',tasks[i].subtasksOpen);
}
function addSubtask(i){
  const inp=document.getElementById(`stinput-${i}`),txt=inp?inp.value.trim():'';
  if(!txt)return;
  tasks[i].subtasks.push({text:txt,done:false});inp.value='';
  const ul=document.querySelector(`#subtasks-${i} .subtask-list`);
  if(ul)ul.innerHTML=tasks[i].subtasks.map((st,si)=>`
    <li class="subtask-item">
      <input type="checkbox" class="subtask-cb" ${st.done?'checked':''} onchange="toggleSubtask(${i},${si})">
      <span class="subtask-label${st.done?' checked':''}" onclick="toggleSubtask(${i},${si})">${esc(st.text)}</span>
      <button class="subtask-del" onclick="deleteSubtask(${i},${si})">✕</button>
    </li>`).join('');
  const stBtn=document.getElementById(`stBtn-${i}`);
  if(stBtn){const sc=tasks[i].subtasks.length,sd=tasks[i].subtasks.filter(s=>s.done).length;stBtn.textContent=`☑ Subtasks (${sd}/${sc})`;}
}
function toggleSubtask(i,si){tasks[i].subtasks[si].done=!tasks[i].subtasks[si].done;render();}
function deleteSubtask(i,si){tasks[i].subtasks.splice(si,1);render();}

// ─── Timer ────────────────────────────────────────────────────────────────────
function startTask(i){
  const t=tasks[i];if(t.running||t.done)return;
  tasks.forEach((_,oi)=>{if(oi!==i&&tasks[oi].running)pauseTask(oi);});
  if(!t.startedAt) t.startedAt=Date.now();
  t.running=true;
  t.status='in_progress';
  document.getElementById(`card-${i}`)?.classList.add('running');
  t.interval=setInterval(()=>{
    if(t.remaining>0){
      t.remaining--;
      const te=document.getElementById(`timer-${i}`),pe=document.getElementById(`prog-${i}`);
      if(te)te.textContent=format(t.remaining);
      if(pe)pe.style.width=Math.round(((t.time*60-t.remaining)/(t.time*60))*100)+'%';
      updateActiveBanner();updateStats();
      checkOverAllocation();
      renderProjects(); // keep project bar live
      if(document.getElementById('fsOverlay').classList.contains('open') && fsTaskIndex===i) renderFsOverlay();
    }else{clearInterval(t.interval);t.running=false;t.done=true;notify(`✅ "${t.name}" complete!`);render();}
  },1000);
  updateActiveBanner();
  scheduleSave();
}
function pauseTask(i){tasks[i].running=false;clearInterval(tasks[i].interval);if(!tasks[i].done)tasks[i].status='ready';document.getElementById(`card-${i}`)?.classList.remove('running');updateActiveBanner();scheduleSave();}
function resetTask(i){pauseTask(i);tasks[i].remaining=tasks[i].time*60;tasks[i].done=false;tasks[i].doneAt=null;tasks[i].status='ready';render();}
function markDone(i) {pauseTask(i);tasks[i].done=true;tasks[i].doneAt=Date.now();render();notify(`✅ "${tasks[i].name}" marked done!`);}
function deleteTask(i){pauseTask(i);tasks.splice(i,1);render();}

// ─── Add task ─────────────────────────────────────────────────────────────────
function addTask(){
  const name=document.getElementById('newTaskName').value.trim();
  const time=parseInt(document.getElementById('newTaskTime').value);
  const cat =document.getElementById('newTaskCat').value;
  const pid =document.getElementById('newTaskProject').value||null;
  const sched=document.getElementById('newTaskScheduled')?.value||null;
  if(!name||!time||time<1){notify('⚠️ Enter a task name and duration');return;}
  tasks.push(makeTask({name,time,cat,projectId:pid,scheduledTime:sched||null}));
  document.getElementById('newTaskName').value='';
  document.getElementById('newTaskTime').value='';
  render();
  renderTimeline();
  checkOverAllocation();
  saveState();
  notify(`➕ "${name}" added`);
}
document.getElementById('newTaskName').addEventListener('keydown',e=>{if(e.key==='Enter')addTask();});

// ─── Summary modal ────────────────────────────────────────────────────────────
function openSummaryModal(){document.getElementById('summaryModal').classList.add('open');buildSummary();}
function closeSummaryModal(){document.getElementById('summaryModal').classList.remove('open');}
document.getElementById('summaryModal').addEventListener('click',function(e){if(e.target===this)closeSummaryModal();});

function printSummaryPdf(){
  buildSummary();

  const styleTag = document.querySelector('style');
  const printWindow = window.open('', '_blank', 'width=960,height=1200');
  if(!printWindow){
    notify('⚠️ Could not open print preview');
    return;
  }

  const summaryMeta = document.getElementById('summaryMeta').outerHTML;
  const summarySections = document.getElementById('summarySections').outerHTML;

  printWindow.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Day Summary PDF</title>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Syne:wght@400;700;800&display=swap" rel="stylesheet">
  <style>${styleTag ? styleTag.textContent : ''}</style>
  <style>
    :root{
      --bg:#f6f1e6;
      --surface:#fffdfa;
      --surface2:#f1e9dc;
      --border:#d8cdbd;
      --accent:#c69214;
      --accent2:#2f8f68;
      --accent3:#c65b52;
      --accent4:#3f78c9;
      --text:#2b241b;
      --muted:#766b5f;
    }
    body{
      background:var(--bg);
      color:var(--text);
      padding:24px;
    }
    body::before{
      display:none;
    }
    .summary-print-shell{
      max-width:820px;
      margin:0 auto;
    }
    .summary-print-shell .modal{
      margin:0;
      max-width:none;
      width:100%;
      padding:36px;
    }
    .summary-print-shell .modal-close,
    .summary-print-shell .modal-actions{
      display:none !important;
    }
    @media print{
      body{
        padding:0;
      }
      .summary-print-shell{
        max-width:none;
      }
      .summary-print-shell .modal{
        border:none;
        border-radius:0;
        box-shadow:none;
        padding:0;
      }
      @page{
        size:A4;
        margin:15mm;
      }
    }
  </style>
</head>
<body>
  <div class="summary-print-shell">
    <div class="modal">
      <div class="modal-header"><h2>✦ Day <span>Summary</span></h2></div>
      ${summaryMeta}
      ${summarySections}
    </div>
  </div>
  <script>
    window.addEventListener('load', function(){
      setTimeout(function(){
        window.focus();
        window.print();
      }, 150);
    });
    window.addEventListener('afterprint', function(){
      window.close();
    });
  <\/script>
</body>
</html>`);
  printWindow.document.close();
}

function buildSummary(){
  const now=new Date();
  document.getElementById('summaryMeta').textContent=
    now.toLocaleString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'})+
    ` · ${String(dayStartHour).padStart(2,'0')}:00–${String(dayEndHour).padStart(2,'0')}:00`;

  const done   =tasks.filter(t=>t.done);
  const pending=tasks.filter(t=>!t.done);

  // 1 ── Accomplished
  const doneHTML=done.length===0
    ?'<p class="sum-empty">No tasks completed yet.</p>'
    :'<ul class="sum-list">'+done.map(t=>{
        const proj=t.projectId?projects.find(p=>p.id===t.projectId):null;
        const stC=t.subtasks.length,stD=t.subtasks.filter(s=>s.done).length;
        const stPart=stC>0?`<div class="sum-sub">Subtasks ${stD}/${stC} done</div>`:'';
        const nTxt=stripHTML(t.notesHTML).trim();
        const nPart=nTxt?`<div class="sum-sub">Notes: ${nTxt.slice(0,80)}${nTxt.length>80?'…':''}</div>`:'';
        const pPart=proj?`<div class="sum-sub" style="color:${proj.color}">📁 ${esc(proj.name)}</div>`:'';
        return `<li><span class="sum-icon">✅</span><div class="sum-text"><strong>${esc(t.name)}</strong> <span style="color:var(--muted);font-size:.74rem;">(${t.time}min · ${CAT_META[t.cat].label})</span>${pPart}${stPart}${nPart}</div></li>`;
      }).join('')+'</ul>';

  // 2 ── Not done
  const pendingHTML=pending.length===0
    ?'<p class="sum-empty">Everything completed — great day! 🎉</p>'
    :'<ul class="sum-list">'+pending.map(t=>{
        const proj=t.projectId?projects.find(p=>p.id===t.projectId):null;
        const elapsed=t.time*60-t.remaining,pct=Math.round((elapsed/(t.time*60))*100);
        const prog=elapsed>0?`<div class="sum-sub">${pct}% elapsed (${Math.round(elapsed/60)}/${t.time}min)</div>`:'<div class="sum-sub">Not started</div>';
        const pPart=proj?`<div class="sum-sub" style="color:${proj.color}">📁 ${esc(proj.name)}</div>`:'';
        return `<li><span class="sum-icon">⏳</span><div class="sum-text"><strong>${esc(t.name)}</strong> <span style="color:var(--muted);font-size:.74rem;">(${t.time}min · ${CAT_META[t.cat].label})</span>${pPart}${prog}</div></li>`;
      }).join('')+'</ul>';

  // 3 ── Action items
  const ai=[];
  pending.filter(t=>t.cat!=='break').forEach(t=>{
    const proj=t.projectId?projects.find(p=>p.id===t.projectId):null;
    ai.push({icon:'↪',text:`Carry over: <strong>${esc(t.name)}</strong>${proj?` <span style="color:${proj.color}">[${esc(proj.name)}]</span>`:''}`,sub:`${t.time}min of ${CAT_META[t.cat].label} pending`});
  });
  tasks.forEach(t=>t.subtasks.filter(s=>!s.done).forEach(s=>{
    ai.push({icon:'☐',text:`Subtask from <strong>${esc(t.name)}</strong>: ${esc(s.text)}`,sub:null});
  }));
  const keywords=['blocked','TODO','todo','fix','bug','follow up','follow-up','need to','waiting','pending','review','check'];
  tasks.forEach(t=>{
    const txt=stripHTML(t.notesHTML).trim();if(!txt)return;
    txt.split(/[.\n!?]+/).map(s=>s.trim()).filter(s=>s.length>4).forEach(s=>{
      if(keywords.some(k=>s.toLowerCase().includes(k)))
        ai.push({icon:'📌',text:`From notes on <strong>${esc(t.name)}</strong>: ${esc(s.slice(0,90))}${s.length>90?'…':''}`,sub:null});
    });
  });
  // Over-allocation warnings in summary
  projects.forEach(p=>{
    const allocMin=p.allocHrs*60;if(!allocMin)return;
    const plannedMin=tasks.filter(t=>t.projectId===p.id).reduce((a,t)=>a+t.time,0);
    const elapsedMin=tasks.filter(t=>t.projectId===p.id).reduce((a,t)=>a+(t.time*60-t.remaining),0)/60;
    if(plannedMin>allocMin) ai.push({icon:'⚠️',text:`<span style="color:var(--accent3)"><strong>${esc(p.name)}</strong> over-allocated</span>`,sub:`Planned ${plannedMin}min vs ${allocMin}min daily allocation`});
    if(elapsedMin>allocMin) ai.push({icon:'🔴',text:`<span style="color:var(--accent3)"><strong>${esc(p.name)}</strong> elapsed time exceeded allocation</span>`,sub:`${Math.round(elapsedMin)}min elapsed vs ${allocMin}min allocated`});
  });
  const actionsHTML=ai.length===0
    ?'<p class="sum-empty">No open action items detected.</p>'
    :'<ul class="sum-list">'+ai.map(a=>`<li><span class="sum-icon">${a.icon}</span><div class="sum-text">${a.text}${a.sub?`<div class="sum-sub">${a.sub}</div>`:''}</div></li>`).join('')+'</ul>';

  // 4 ── Projects summary
  let projectsHTML='<p class="sum-empty">No projects created yet.</p>';
  if(projects.length>0){
    projectsHTML=projects.map(p=>{
      const allocMin=p.allocHrs*60;
      const projTasks=tasks.filter(t=>t.projectId===p.id);
      const plannedMin=projTasks.reduce((a,t)=>a+t.time,0);
      const elapsedMin=projTasks.reduce((a,t)=>a+(t.time*60-t.remaining),0)/60;
      const doneTasks=projTasks.filter(t=>t.done).length;
      const pendTasks=projTasks.filter(t=>!t.done).length;
      let status='nodata',statusTxt='No allocation';
      if(allocMin>0){
        if(elapsedMin>allocMin){status='over';statusTxt='Over allocated';}
        else if(plannedMin>allocMin){status='over';statusTxt='Over planned';}
        else if(plannedMin<allocMin*0.5){status='under';statusTxt='Under-utilised';}
        else{status='ok';statusTxt='On track';}
      }
      const planPct=allocMin>0?Math.min(100,Math.round((plannedMin/allocMin)*100)):0;
      const elPct  =allocMin>0?Math.min(100,Math.round((elapsedMin/allocMin)*100)):0;
      const barColor=status==='over'?'var(--accent3)':status==='under'?'var(--accent4)':p.color;
      return `
      <div class="proj-sum-card" style="border-left-color:${p.color}">
        <div class="proj-sum-top">
          <span class="proj-sum-name" style="color:${p.color}">📁 ${esc(p.name)}</span>
          <span class="proj-status-badge status-${status}">${statusTxt}</span>
        </div>
        ${p.desc?`<div style="font-size:.78rem;color:var(--muted);margin-bottom:6px;">${esc(p.desc)}</div>`:''}
        ${p.members?`<div class="proj-sum-members">👥 ${esc(p.members)}</div>`:''}
        ${allocMin>0?`
        <div class="proj-sum-bar-wrap">
          <div class="proj-sum-bar-label"><span>Planned ${plannedMin}m / ${allocMin}m alloc (${planPct}%)</span></div>
          <div class="proj-sum-bar-track"><div class="proj-sum-bar-fill" style="width:${planPct}%;background:${barColor}"></div></div>
        </div>
        <div class="proj-sum-bar-wrap">
          <div class="proj-sum-bar-label"><span>Elapsed ${Math.round(elapsedMin)}m / ${allocMin}m (${elPct}%)</span></div>
          <div class="proj-sum-bar-track"><div class="proj-sum-bar-fill" style="width:${elPct}%;background:${elPct>100?'var(--accent3)':p.color};opacity:.7"></div></div>
        </div>`:''}
        <div class="proj-sum-tasks">Tasks: ${doneTasks} done · ${pendTasks} pending · ${projTasks.length} total</div>
      </div>`;
    }).join('');
  }

  // 5 ── Prediction
  const completionRate=tasks.length>0?Math.round((done.length/tasks.length)*100):0;
  const focusDone=done.filter(t=>t.cat==='deep').reduce((a,t)=>a+t.time,0);
  const focusTotal=tasks.filter(t=>t.cat==='deep').reduce((a,t)=>a+t.time,0);
  const pendingMin=pending.filter(t=>t.cat!=='break').reduce((a,t)=>a+t.time,0);
  const meetingMin=tasks.filter(t=>t.cat==='meeting').reduce((a,t)=>a+t.time,0);
  const helpMin=tasks.filter(t=>t.cat==='help').reduce((a,t)=>a+t.time,0);
  const lines=[];
  if(completionRate===100)lines.push(`<p>💪 You completed <strong>all ${tasks.length} tasks</strong> — perfect execution. Push harder tomorrow.</p>`);
  else if(completionRate>=70)lines.push(`<p>📈 Solid day: <strong>${done.length}/${tasks.length} tasks</strong> (${completionRate}%). The ${pending.filter(t=>t.cat!=='break').length} remaining items are ready for tomorrow's first block.</p>`);
  else if(completionRate>=40)lines.push(`<p>⚡ Moderate progress: <strong>${done.length}/${tasks.length} tasks</strong> (${completionRate}%). Front-load carryovers before new work arrives tomorrow.</p>`);
  else lines.push(`<p>🔄 <strong>${done.length}/${tasks.length} tasks</strong> done (${completionRate}%). Tighten tomorrow\'s scope — defer anything that isn\'t critical.</p>`);
  if(focusTotal>0){
    if(focusDone===focusTotal)lines.push(`<p>🔥 All <strong>${focusTotal}min</strong> of deep focus used. Keep the same schedule tomorrow.</p>`);
    else if(focusDone>0)lines.push(`<p>🧠 <strong>${focusDone}/${focusTotal}min</strong> deep work done. Block off the remaining ${focusTotal-focusDone}min tomorrow and close all distractions.</p>`);
    else lines.push(`<p>⚠️ Deep coding blocks weren\'t started. Protect tomorrow\'s first focus window — before any messages.</p>`);
  }
  if(pendingMin>0)lines.push(`<p>📋 <strong>${pendingMin}min</strong> of work carries over. Schedule it before new requests.</p>`);
  if(meetingMin>=90)lines.push(`<p>📞 <strong>${meetingMin}min</strong> in meetings today. Consider async check-ins to recover focus time tomorrow.</p>`);
  if(helpMin>=60)lines.push(`<p>🤝 <strong>${helpMin}min</strong> helping colleagues. Batch help into a fixed window tomorrow (e.g., 12:45–13:15).</p>`);
  const closes=['Ship something you\'re proud of.','Progress compounds — keep the streak.','Tomorrow is a clean slate.','Rest well, come back sharp.'];
  lines.push(`<p style="color:var(--accent);font-weight:700;">${closes[Math.floor(Math.random()*closes.length)]}</p>`);

  document.getElementById('summarySections').innerHTML=`
    <div class="sum-section"><div class="sum-section-title s-done">✅ Accomplished Today</div>${doneHTML}</div>
    <div class="sum-section"><div class="sum-section-title s-pending">⏳ Not Completed</div>${pendingHTML}</div>
    <div class="sum-section"><div class="sum-section-title s-actions">📌 Probable Action Items</div>${actionsHTML}</div>
    <div class="sum-section"><div class="sum-section-title s-projects">📁 Project Breakdown</div>${projectsHTML}</div>
    <div class="sum-section"><div class="sum-section-title s-predict">🔮 Prediction for Tomorrow</div><div class="sum-predict-body">${lines.join('')}</div></div>
  `;
}

function copySummary(){
  const done=tasks.filter(t=>t.done),pending=tasks.filter(t=>!t.done),now=new Date();
  let txt=`DAY SUMMARY — ${now.toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}\n`;
  txt+=`Work: ${String(dayStartHour).padStart(2,'0')}:00–${String(dayEndHour).padStart(2,'0')}:00\n\n`;
  txt+=`✅ ACCOMPLISHED (${done.length})\n`;
  done.forEach(t=>{const p=t.projectId?projects.find(x=>x.id===t.projectId):null;txt+=`  • ${t.name} (${t.time}min)${p?' ['+p.name+']':''}\n`;});
  txt+=`\n⏳ NOT COMPLETED\n`;
  pending.filter(t=>t.cat!=='break').forEach(t=>{const p=t.projectId?projects.find(x=>x.id===t.projectId):null;txt+=`  • ${t.name} (${t.time}min)${p?' ['+p.name+']':''}\n`;});
  txt+=`\n📁 PROJECTS\n`;
  if(projects.length===0)txt+='  (none)\n';
  projects.forEach(p=>{
    const allocMin=p.allocHrs*60;
    const planned=tasks.filter(t=>t.projectId===p.id).reduce((a,t)=>a+t.time,0);
    const elapsed=tasks.filter(t=>t.projectId===p.id).reduce((a,t)=>a+(t.time*60-t.remaining),0)/60;
    txt+=`  • ${p.name}: planned ${planned}min / elapsed ${Math.round(elapsed)}min / alloc ${allocMin}min\n`;
  });
  txt+=`\n📌 ACTION ITEMS\n`;
  const ai=[];
  pending.filter(t=>t.cat!=='break').forEach(t=>ai.push(`  ↪ ${t.name}`));
  tasks.forEach(t=>t.subtasks.filter(s=>!s.done).forEach(s=>ai.push(`  ☐ ${t.name}: ${s.text}`)));
  if(ai.length===0)ai.push('  (none)');
  txt+=ai.join('\n')+'\n';
  navigator.clipboard.writeText(txt).then(()=>notify('⎘ Copied!')).catch(()=>notify('⚠️ Could not copy'));
}

// ─── Fullscreen focus mode ────────────────────────────────────────────────────
let fsTaskIndex = null;
let fsDrawerOpen = false;

function openFocus(i) {
  fsTaskIndex = i;
  // Start the task if not already running
  if (!tasks[i].running && !tasks[i].done) startTask(i);
  renderFsOverlay();
  document.getElementById('fsOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function exitFocus() {
  document.getElementById('fsOverlay').classList.remove('open');
  document.getElementById('fsOverlay').classList.remove('drawer-open');
  document.body.style.overflow = '';
  fsDrawerOpen = false;
  fsTaskIndex = null;
}

function renderFsOverlay() {
  if (fsTaskIndex === null) return;
  const t = tasks[fsTaskIndex];
  const meta = CAT_META[t.cat] || CAT_META.admin;
  const proj = t.projectId ? projects.find(p => p.id === t.projectId) : null;
  const totalSec = t.time * 60;
  const elapsed = totalSec - t.remaining;
  const pct = Math.round((elapsed / totalSec) * 100);

  // Badge
  const badge = document.getElementById('fsCatBadge');
  badge.textContent = meta.label;
  badge.className = 'fs-cat-badge ' + meta.badge;

  // Name
  document.getElementById('fsTaskName').textContent = t.name;

  // Project tag
  const ptEl = document.getElementById('fsProjTag');
  ptEl.textContent = proj ? '📁 ' + proj.name : '';
  ptEl.style.color = proj ? proj.color : '';

  // Timer
  const timerEl = document.getElementById('fsTimer');
  timerEl.textContent = format(t.remaining);
  timerEl.classList.toggle('paused', !t.running);

  // Progress
  document.getElementById('fsProgressFill').style.width = pct + '%';
  document.getElementById('fsProgressLabel').textContent = pct + '% complete · ' + format(t.remaining) + ' remaining';

  // Pause button label
  document.getElementById('fsPauseBtn').textContent = t.running ? '⏸ Pause' : '▶ Resume';

  // Subtasks
  const stEl = document.getElementById('fsSubtasks');
  if (t.subtasks.length > 0) {
    stEl.innerHTML = t.subtasks.map((st, si) => `
      <div class="fs-subtask-row">
        <input type="checkbox" ${st.done ? 'checked' : ''} onchange="fstoggleST(${fsTaskIndex},${si})">
        <span class="${st.done ? 'done' : ''}" onclick="fstoggleST(${fsTaskIndex},${si})">${esc(st.text)}</span>
      </div>`).join('');
    stEl.style.display = 'flex';
  } else {
    stEl.style.display = 'none';
  }

  // Notes drawer toggle appearance
  const ntBtn = document.getElementById('fsNotesToggle');
  ntBtn.textContent = '📝 Notes' + (t.notesHTML ? ' ●' : '');
  ntBtn.classList.toggle('has-notes', !!t.notesHTML);

  // Sync drawer editor with task notes (only on first open)
  const editor = document.getElementById('fsDrawerEditor');
  if (editor && editor.dataset.syncedFor !== String(fsTaskIndex)) {
    editor.innerHTML = t.notesHTML || '';
    editor.dataset.syncedFor = String(fsTaskIndex);
  }
}

function fstoggleST(i, si) {
  tasks[i].subtasks[si].done = !tasks[i].subtasks[si].done;
  renderFsOverlay();
  // also update card subtask list if visible
  const ul = document.querySelector(`#subtasks-${i} .subtask-list`);
  if (ul) {
    ul.innerHTML = tasks[i].subtasks.map((st, sj) => `
      <li class="subtask-item">
        <input type="checkbox" class="subtask-cb" ${st.done ? 'checked' : ''} onchange="toggleSubtask(${i},${sj})">
        <span class="subtask-label${st.done ? ' checked' : ''}" onclick="toggleSubtask(${i},${sj})">${esc(st.text)}</span>
        <button class="subtask-del" onclick="deleteSubtask(${i},${sj})">✕</button>
      </li>`).join('');
    const stBtn = document.getElementById(`stBtn-${i}`);
    if (stBtn) { const sc = tasks[i].subtasks.length, sd = tasks[i].subtasks.filter(s => s.done).length; stBtn.textContent = `☑ Subtasks (${sd}/${sc})`; }
  }
}

function fsPauseResume() {
  if (fsTaskIndex === null) return;
  const t = tasks[fsTaskIndex];
  if (t.running) pauseTask(fsTaskIndex);
  else startTask(fsTaskIndex);
  renderFsOverlay();
}

function fsDone() {
  if (fsTaskIndex === null) return;
  markDone(fsTaskIndex);
  exitFocus();
}

function toggleFsDrawer() {
  fsDrawerOpen = !fsDrawerOpen;
  document.getElementById('fsOverlay').classList.toggle('drawer-open', fsDrawerOpen);
  const btn = document.getElementById('fsNotesToggle');
  btn.textContent = (tasks[fsTaskIndex]?.notesHTML ? '📝 Notes ●' : '📝 Notes') + (fsDrawerOpen ? ' ✕' : '');
}

function fsSaveNotes() {
  if (fsTaskIndex === null) return;
  const ed = document.getElementById('fsDrawerEditor');
  if (!ed) return;
  tasks[fsTaskIndex].notesHTML = ed.innerHTML;
  // sync back to main card editor if open
  const mainEd = document.getElementById(`notesEditor-${fsTaskIndex}`);
  if (mainEd) mainEd.innerHTML = ed.innerHTML;
  saveNotesHTML(fsTaskIndex);
  // update toggle button dot
  const btn = document.getElementById('fsNotesToggle');
  if (btn) { btn.textContent = (ed.innerHTML ? '📝 Notes ●' : '📝 Notes') + (fsDrawerOpen ? ' ✕' : ''); btn.classList.toggle('has-notes', !!ed.innerHTML); }
}

function fsPasteHandler(e) {
  const items = e.clipboardData?.items; if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const reader = new FileReader();
      reader.onload = ev => {
        const img = document.createElement('img'); img.src = ev.target.result; img.style.maxWidth = '100%';
        const ed = document.getElementById('fsDrawerEditor');
        if (ed) {
          const sel = window.getSelection();
          if (sel && sel.rangeCount && ed.contains(sel.getRangeAt(0).commonAncestorContainer)) {
            const r = sel.getRangeAt(0); r.deleteContents(); r.insertNode(img); r.collapse(false);
          } else ed.appendChild(img);
          fsSaveNotes(); notify('🖼 Image pasted into notes');
        }
      };
      reader.readAsDataURL(item.getAsFile()); return;
    }
  }
  setTimeout(fsSaveNotes, 0);
}

// Escape key exits focus mode or closes panel modals
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (document.getElementById('fsOverlay').classList.contains('open')) exitFocus();
    else if (document.getElementById('projectsModal').classList.contains('open')) closeProjectsModal();
    else if (document.getElementById('logisticsModal').classList.contains('open')) closeLogisticsModal();
    else if (document.getElementById('objectivesModal').classList.contains('open')) closeObjectivesModal();
    else if (document.getElementById('historyModal').classList.contains('open')) closeHistoryModal();
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function format(sec){return String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0');}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function stripHTML(html){const d=document.createElement('div');d.innerHTML=html;return d.textContent||d.innerText||'';}
let nt,ntEl=null;
function notify(msg){_notify(msg,false);}
function notifyWarn(msg){_notify(msg,true);}
function _notify(msg,warn){
  if(!ntEl)ntEl=document.getElementById('notif');
  ntEl.textContent=msg;
  ntEl.classList.toggle('warn',warn);
  ntEl.classList.add('show');
  clearTimeout(nt);
  nt=setTimeout(()=>ntEl.classList.remove('show'),warn?5000:3000);
}

// ─── Timeline ─────────────────────────────────────────────────────────────────
function buildTimeSlots(){
  const sel=document.getElementById('newTaskScheduled');
  if(!sel) return;
  const cur=sel.value;
  sel.innerHTML='<option value="">⏰ Unscheduled</option>';
  for(let h=dayStartHour;h<dayEndHour;h++){
    for(let m=0;m<60;m+=5){
      const val=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      sel.innerHTML+=`<option value="${val}">${val}</option>`;
    }
  }
  if(cur) sel.value=cur;
}

function renderTimeline(){
  const canvas=document.getElementById('timelineCanvas');
  const marks=document.getElementById('tlHourMarks');
  const track=document.getElementById('tlTrack');
  const nowLine=document.getElementById('tlNowLine');
  const unscheduled=document.getElementById('tlUnscheduled');
  const legend=document.getElementById('timelineLegend');
  if(!canvas||!track) return;

  const totalMin=(dayEndHour-dayStartHour)*60;
  if(totalMin<=0) return;

  // Size canvas to available width
  const W=canvas.parentElement.clientWidth||800;
  canvas.style.width=Math.max(600,W)+'px';
  const TW=Math.max(600,W);

  // Draw hour marks
  marks.innerHTML='';
  marks.style.position='relative';
  for(let h=dayStartHour;h<=dayEndHour;h++){
    const pct=((h-dayStartHour)*60/totalMin)*100;
    const mk=document.createElement('div');
    mk.className='tl-hour-mark';
    mk.style.left=pct+'%';
    mk.textContent=`${String(h).padStart(2,'0')}:00`;
    marks.appendChild(mk);
  }

  // Draw task blocks
  // Remove old blocks
  track.querySelectorAll('.tl-block').forEach(b=>b.remove());

  const scheduled=tasks.filter(t=>t.scheduledTime);
  scheduled.forEach((task,_)=>{
    const [sh,sm]=task.scheduledTime.split(':').map(Number);
    const startMin=(sh-dayStartHour)*60+sm;
    const endMin=startMin+task.time;
    if(startMin>=totalMin||endMin<=0) return;
    const left=Math.max(0,(startMin/totalMin)*100);
    const width=Math.min(100-left,((task.time)/totalMin)*100);
    const meta=CAT_META[task.cat]||CAT_META.admin;
    const proj=task.projectId?projects.find(p=>p.id===task.projectId):null;
    const color=proj?proj.color:catColor(task.cat);
    const block=document.createElement('div');
    block.className=`tl-block${task.running?' tl-running':''}${task.done?' tl-done':''}`;
    block.style.left=left+'%';
    block.style.width=Math.max(0.5,width)+'%';
    block.style.background=color;
    block.style.opacity=task.done?'0.4':'0.85';
    block.title=`${task.name} · ${task.scheduledTime} · ${task.time}min`;
    block.innerHTML=`<span class="tl-block-label">${meta.emoji} ${esc(task.name)}</span>`;
    const idx=tasks.indexOf(task);
    block.onclick=()=>{ const card=document.getElementById(`card-${idx}`); if(card) card.scrollIntoView({behavior:'smooth',block:'center'}); };
    track.appendChild(block);
  });

  // Now-line
  const now=new Date();
  const nowMin=(now.getHours()-dayStartHour)*60+now.getMinutes();
  if(nowMin>=0&&nowMin<=totalMin){
    nowLine.style.display='block';
    nowLine.style.left=(nowMin/totalMin)*100+'%';
  } else { nowLine.style.display='none'; }

  // Unscheduled chips
  const unsched=tasks.filter(t=>!t.scheduledTime&&!t.done);
  unscheduled.innerHTML='';
  if(unsched.length>0){
    const lbl=document.createElement('span');
    lbl.className='tl-unsched-label';
    lbl.textContent='Unscheduled:';
    unscheduled.appendChild(lbl);
    unsched.forEach(task=>{
      const chip=document.createElement('span');
      chip.className='tl-unsched-chip';
      chip.textContent=(CAT_META[task.cat]?.emoji||'')+ ' '+task.name+' ('+task.time+'m)';
      const idx=tasks.indexOf(task);
      chip.title='Click to scroll to task card';
      chip.onclick=()=>{ const card=document.getElementById(`card-${idx}`); if(card) card.scrollIntoView({behavior:'smooth',block:'center'}); };
      unscheduled.appendChild(chip);
    });
  }

  // Legend
  const usedCats=[...new Set(tasks.map(t=>t.cat))];
  legend.innerHTML=usedCats.map(c=>{
    const meta=CAT_META[c]||CAT_META.admin;
    return `<div class="tl-leg-item"><div class="tl-leg-dot" style="background:${catColor(c)}"></div><span>${meta.label}</span></div>`;
  }).join('');
}

function catColor(cat){
  const map={deep:'#f0c040',meeting:'#60a0f0',review:'#4af0a0',admin:'#c080ff',help:'#ff8060',break:'#6b7080'};
  return map[cat]||'#6b7080';
}

setInterval(renderTimeline, 30000); // refresh now-line every 30s

// ─── Objectives ───────────────────────────────────────────────────────────────
const OBJ_LEVELS=[
  {key:'year',  label:'Annual',    icon:'🌟', color:'#f0c040'},
  {key:'quarter',label:'Quarterly',icon:'📅', color:'#60a0f0'},
  {key:'month', label:'Monthly',   icon:'📆', color:'#4af0a0'},
  {key:'week',  label:'Weekly',    icon:'🗓', color:'#c080ff'},
];
let objectives={}; // {year:[], quarter:[], month:[], week:[]}
OBJ_LEVELS.forEach(l=>{ objectives[l.key]=[]; });

function openObjectivesModal(){
  renderObjectives();
  document.getElementById('objectivesModal').classList.add('open');
}
function closeObjectivesModal(){
  document.getElementById('objectivesModal').classList.remove('open');
}

function renderObjectives(){
  const tree=document.getElementById('objTree');
  let totalCount=0;
  OBJ_LEVELS.forEach(l=>totalCount+=objectives[l.key].length);
  const pmCount=document.getElementById('pmObjCount');
  const sbCount=document.getElementById('sbObjCount');
  const overviewTotal=document.getElementById('objOverviewTotal');
  if(pmCount) pmCount.textContent=totalCount+' objectives';
  if(sbCount) sbCount.textContent=totalCount;
  if(overviewTotal) overviewTotal.textContent=totalCount+' objective'+(totalCount===1?'':'s');
  renderObjectivesOverview();
  if(!tree) return;

  tree.innerHTML=OBJ_LEVELS.map(level=>{
    const items=objectives[level.key]||[];
    const bodyId=`objBody-${level.key}`;
    const open=document.getElementById(bodyId)?.classList.contains('open');
    return `
    <div class="obj-level">
      <div class="obj-level-header" onclick="toggleObjLevel('${level.key}')">
        <span class="obj-level-icon">${level.icon}</span>
        <span class="obj-level-label" style="color:${level.color}">${level.label} Objectives</span>
        <span class="obj-level-count">${items.length}</span>
        <span class="obj-level-chevron${open?' open':''}" id="objChev-${level.key}">▼</span>
      </div>
      <div class="obj-level-body${open?' open':''}" id="${bodyId}">
        ${items.length===0?'<div style="font-size:.82rem;color:var(--muted);font-style:italic;padding:4px 0 8px;">No objectives yet.</div>':''}
        ${items.map((obj,i)=>`
          <div class="obj-item" style="border-left-color:${level.color}">
            <div class="obj-item-top">
              <div class="obj-item-text">${esc(obj.text)}</div>
              <button class="obj-item-del" onclick="deleteObjective('${level.key}',${i})">✕</button>
            </div>
            ${obj.notes?`<div class="obj-item-notes">${esc(obj.notes)}</div>`:''}
            <div class="obj-progress-row">
              <div class="obj-progress-track"><div class="obj-progress-fill" style="width:${obj.progress||0}%;background:${level.color}"></div></div>
              <input class="obj-progress-input" type="number" min="0" max="100" value="${obj.progress||0}"
                onchange="setObjProgress('${level.key}',${i},this.value)" title="Progress %">
              <span class="obj-progress-pct">%</span>
            </div>
          </div>`).join('')}
        <div class="obj-add-row">
          <input class="obj-add-inp" id="objInp-${level.key}" placeholder="Add ${level.label.toLowerCase()} objective…" onkeydown="if(event.key==='Enter')addObjective('${level.key}')">
          <textarea class="obj-add-notes" id="objNotes-${level.key}" placeholder="Notes (optional)" rows="1"></textarea>
          <button class="btn btn-add btn-sm" onclick="addObjective('${level.key}')">+ Add</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderObjectivesOverview(){
  const grid=document.getElementById('objectivesOverviewGrid');
  if(!grid) return;

  grid.innerHTML=OBJ_LEVELS.map(level=>{
    const items=objectives[level.key]||[];
    const preview=items.slice(0,3);
    return `
    <div class="objective-glance-card" style="border-top-color:${level.color}">
      <div class="objective-glance-head">
        <div class="objective-glance-label" style="color:${level.color}">
          <span class="objective-glance-icon">${level.icon}</span>
          <span>${level.label}</span>
        </div>
        <span class="objective-glance-count">${items.length}</span>
      </div>
      <div class="objective-glance-list">
        ${preview.length ? preview.map(obj=>`
          <div class="objective-glance-item">
            <div class="objective-glance-text">${esc(obj.text)}</div>
            <div class="objective-glance-progress-row">
              <div class="objective-glance-progress-track">
                <div class="objective-glance-progress-fill" style="width:${obj.progress||0}%;background:${level.color}"></div>
              </div>
              <span class="objective-glance-progress-pct">${obj.progress||0}%</span>
            </div>
          </div>`).join('') : `<div class="objective-glance-empty">No objectives yet. Add one from the objectives panel to keep this horizon in view.</div>`}
      </div>
      ${items.length>3?`<div class="objective-glance-more">+${items.length-3} more in ${level.label.toLowerCase()}</div>`:'<div class="objective-glance-more"> </div>'}
    </div>`;
  }).join('');
}

function toggleObjLevel(key){
  const body=document.getElementById(`objBody-${key}`);
  const chev=document.getElementById(`objChev-${key}`);
  if(!body) return;
  body.classList.toggle('open');
  if(chev) chev.classList.toggle('open',body.classList.contains('open'));
}

function addObjective(key){
  const inp=document.getElementById(`objInp-${key}`);
  const notesEl=document.getElementById(`objNotes-${key}`);
  const text=inp?inp.value.trim():'';
  if(!text){notify('⚠️ Enter objective text');return;}
  if(!objectives[key]) objectives[key]=[];
  objectives[key].push({text, notes:notesEl?notesEl.value.trim():'', progress:0});
  if(inp) inp.value='';
  if(notesEl) notesEl.value='';
  renderObjectives();
  // Re-open the level that was just added to
  const body=document.getElementById(`objBody-${key}`);
  if(body&&!body.classList.contains('open')){
    body.classList.add('open');
    const chev=document.getElementById(`objChev-${key}`);
    if(chev) chev.classList.add('open');
  }
  scheduleSave();
  notify(`🎯 Objective added`);
}

function deleteObjective(key,i){
  objectives[key].splice(i,1);
  renderObjectives();
  scheduleSave();
}

function setObjProgress(key,i,val){
  objectives[key][i].progress=Math.min(100,Math.max(0,parseInt(val)||0));
  const fill=document.querySelector(`#objBody-${key} .obj-item:nth-child(${i+1}) .obj-progress-fill`);
  if(fill) fill.style.width=objectives[key][i].progress+'%';
  scheduleSave();
}

// ─── History ──────────────────────────────────────────────────────────────────
let taskHistory={};   // {dateString: {tasks:[], dayStartHour, dayEndHour, savedAt}}
let histFilter='week';
let histReportFilters={from:'',to:'',projectId:'all',status:'done'};

function openHistoryModal(){
  renderHistory();
  document.getElementById('historyModal').classList.add('open');
}
function closeHistoryModal(){
  document.getElementById('historyModal').classList.remove('open');
}

function setHistFilter(f,btn){
  histFilter=f;
  document.querySelectorAll('.hist-filter-btn').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  renderHistory();
}

function renderHistory(){
  const list=document.getElementById('historyList');
  const pmCount=document.getElementById('pmHistCount');
  const sbCount=document.getElementById('sbHistCount');
  if(!list) return;

  const allDates=Object.keys(taskHistory).sort((a,b)=>new Date(b)-new Date(a));
  const now=new Date();

  const filtered=allDates.filter(d=>{
    const date=new Date(d);
    if(histFilter==='week'){
      const weekAgo=new Date(now); weekAgo.setDate(weekAgo.getDate()-7);
      return date>=weekAgo;
    } else if(histFilter==='month'){
      return date.getMonth()===now.getMonth()&&date.getFullYear()===now.getFullYear();
    }
    return true;
  });

  if(pmCount) pmCount.textContent=allDates.length+' day'+(allDates.length!==1?'s':'');
  if(sbCount) sbCount.textContent=allDates.length;

  if(filtered.length===0){
    list.innerHTML='<div class="hist-empty">No history found for this period. Complete your first day to see it here.</div>';
    return;
  }

  // Group by week
  let html='';
  let lastWeek='';
  filtered.forEach(dateStr=>{
    const d=new Date(dateStr);
    const weekLabel=getWeekLabel(d);
    if(weekLabel!==lastWeek){
      html+=`<div class="hist-week-sep">📅 ${weekLabel}</div>`;
      lastWeek=weekLabel;
    }
    const entry=taskHistory[dateStr];
    const tks=entry.tasks||[];
    const done=tks.filter(t=>t.done).length;
    const total=tks.length;
    const pct=total>0?Math.round((done/total)*100):0;
    const dLabel=d.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});
    html+=`
    <div class="hist-day-group">
      <div class="hist-day-header" onclick="toggleHistDay('${dateStr}')">
        <div>
          <div class="hist-day-date">${dLabel}</div>
          <div class="hist-day-meta">${done}/${total} tasks · ${pct}% · ${String(entry.dayStartHour||10).padStart(2,'0')}:00–${String(entry.dayEndHour||18).padStart(2,'0')}:00</div>
        </div>
        <button class="hist-day-export" onclick="event.stopPropagation();exportDayMarkdown('${dateStr}')">⬇ Export .md</button>
      </div>
      <div class="hist-day-body" id="histDay-${dateStr.replace(/\s/g,'-')}">
        ${tks.length===0?'<div class="hist-empty">No tasks recorded.</div>':
          tks.map(t=>{
            const meta=CAT_META[t.cat]||CAT_META.admin;
            const proj=t.projectId?projects.find(p=>p.id===t.projectId):null;
            const doneAt=t.doneAt?` · done ${new Date(t.doneAt).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}` :'';
            return `<div class="hist-task-row">
              <div class="hist-task-dot" style="background:${catColor(t.cat)}"></div>
              <div class="hist-task-name">${esc(t.name)}</div>
              <div class="hist-task-meta">${t.time}min · ${meta.label}${proj?' · '+esc(proj.name):''}${doneAt}</div>
              <div class="${t.done?'hist-task-done':'hist-task-pending'}">${t.done?'✓':'⏳'}</div>
            </div>`;
          }).join('')}
      </div>
    </div>`;
  });
  list.innerHTML=html;
}

function toggleHistDay(dateStr){
  const id='histDay-'+dateStr.replace(/\s/g,'-');
  const el=document.getElementById(id);
  if(el) el.classList.toggle('open');
}

function getWeekLabel(date){
  const now=new Date();
  const startOfWeek=d=>{const s=new Date(d);s.setDate(s.getDate()-s.getDay());s.setHours(0,0,0,0);return s;};
  if(startOfWeek(date).getTime()===startOfWeek(now).getTime()) return 'This Week';
  const lastW=new Date(now); lastW.setDate(lastW.getDate()-7);
  if(startOfWeek(date).getTime()===startOfWeek(lastW).getTime()) return 'Last Week';
  return date.toLocaleDateString('en-US',{month:'long',year:'numeric'});
}

function exportDayMarkdown(dateStr){
  const entry=taskHistory[dateStr];
  if(!entry) return;
  const d=new Date(dateStr);
  const dLabel=d.toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const tks=entry.tasks||[];
  const done=tks.filter(t=>t.done);
  const pending=tks.filter(t=>!t.done);
  let md=`# Daily Log — ${dLabel}\n\n`;
  md+=`**Work hours:** ${String(entry.dayStartHour||10).padStart(2,'0')}:00 – ${String(entry.dayEndHour||18).padStart(2,'0')}:00\n`;
  md+=`**Completion:** ${done.length}/${tks.length} tasks\n\n`;
  md+=`## ✅ Completed\n`;
  if(done.length===0) md+=`_None_\n`;
  else done.forEach(t=>{
    const doneAt=t.doneAt?` (done ${new Date(t.doneAt).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})})` :'';
    md+=`- [x] **${t.name}** · ${t.time}min · ${CAT_META[t.cat]?.label||t.cat}${doneAt}\n`;
    if(t.notesHTML){const txt=stripHTML(t.notesHTML).trim();if(txt) md+=`  > ${txt}\n`;}
  });
  md+=`\n## ⏳ Not Completed\n`;
  if(pending.length===0) md+=`_None — perfect day!_\n`;
  else pending.forEach(t=>{ md+=`- [ ] **${t.name}** · ${t.time}min · ${CAT_META[t.cat]?.label||t.cat}\n`; });
  // Download
  const blob=new Blob([md],{type:'text/markdown'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`daily-log-${dateStr.replace(/,\s*/g,'-').replace(/\s/g,'-')}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
  notify('📥 Exported as Markdown');
}

// ─── Daily Logistics ──────────────────────────────────────────────────────────
function initHistoryProjectFilter(){
  const sel=document.getElementById('histProjectFilter');
  if(!sel) return;
  const current=histReportFilters.projectId||'all';
  sel.innerHTML=`<option value="all">All projects</option>`+projects.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  sel.value=projects.some(p=>p.id===current)?current:'all';
  histReportFilters.projectId=sel.value;
}

function setHistReportFilter(key,val){
  histReportFilters[key]=val;
  renderHistory();
}

function resetHistReportFilters(){
  histReportFilters={from:'',to:'',projectId:'all',status:'done'};
  const from=document.getElementById('histDateFrom');
  const to=document.getElementById('histDateTo');
  const project=document.getElementById('histProjectFilter');
  const status=document.getElementById('histStatusFilter');
  if(from) from.value='';
  if(to) to.value='';
  if(project) project.value='all';
  if(status) status.value='done';
  renderHistory();
}

function getHistoryTaskRecords(){
  return Object.keys(taskHistory).flatMap(dateStr=>{
    const entry=taskHistory[dateStr]||{};
    return (entry.tasks||[]).map((task,historyIndex)=>({
      ...normalizeTaskRecord(task),
      historyIndex,
      historyDate:dateStr,
      historyDateObj:new Date(dateStr),
      historyDayStartHour:entry.dayStartHour||10,
      historyDayEndHour:entry.dayEndHour||18,
    }));
  }).sort((a,b)=>{
    const dayDiff=b.historyDateObj-a.historyDateObj;
    if(dayDiff!==0) return dayDiff;
    return (b.doneAt||b.createdAt||0)-(a.doneAt||a.createdAt||0);
  });
}

function matchesHistQuickFilter(record, now){
  if(histFilter==='week'){
    const weekAgo=new Date(now); weekAgo.setDate(weekAgo.getDate()-7);
    return record.historyDateObj>=weekAgo;
  }
  if(histFilter==='month'){
    return record.historyDateObj.getMonth()===now.getMonth() && record.historyDateObj.getFullYear()===now.getFullYear();
  }
  return true;
}

function matchesHistDetailFilter(record){
  const projectMatch=histReportFilters.projectId==='all' || record.projectId===histReportFilters.projectId;
  const statusMatch=histReportFilters.status==='all' || getTaskStatus(record)===histReportFilters.status;
  const dayKey=record.historyDateObj.toISOString().slice(0,10);
  const fromMatch=!histReportFilters.from || dayKey>=histReportFilters.from;
  const toMatch=!histReportFilters.to || dayKey<=histReportFilters.to;
  return projectMatch && statusMatch && fromMatch && toMatch;
}

function exportFilteredHistoryCsv(){
  const records=getHistoryTaskRecords().filter(r=>matchesHistQuickFilter(r,new Date())&&matchesHistDetailFilter(r));
  if(records.length===0){notify('No matching tasks to export');return;}
  const rows=[['Date','Task','Project','Status','Category','Estimated Minutes','Elapsed Minutes','Created At','Started At','Done At']];
  records.forEach(r=>{
    const projectName=r.projectId?(projects.find(p=>p.id===r.projectId)?.name||''):'';
    const elapsed=Math.max(0,Math.round((r.time*60-r.remaining)/60));
    rows.push([
      new Date(r.historyDate).toLocaleDateString('en-CA'),
      r.name,
      projectName,
      TASK_STATUS_META[getTaskStatus(r)]?.label||getTaskStatus(r),
      CAT_META[r.cat]?.label||r.cat,
      String(r.time),
      String(elapsed),
      r.createdAt?new Date(r.createdAt).toISOString():'',
      r.startedAt?new Date(r.startedAt).toISOString():'',
      r.doneAt?new Date(r.doneAt).toISOString():'',
    ]);
  });
  const csv=rows.map(row=>row.map(val=>`"${String(val??'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='task-history-report.csv';
  a.click();
  URL.revokeObjectURL(a.href);
  notify('Exported filtered task report');
}

function addHistoryTaskToToday(dateStr, index){
  const entry=taskHistory[dateStr];
  const src=entry?.tasks?.[index];
  if(!src){notify('Could not find that history task');return;}
  const newTask=makeTask({
    name:src.name,
    time:src.time,
    cat:src.cat,
    projectId:src.projectId||null,
    scheduledTime:null,
    status:'ready',
    carriedOverFrom:dateStr
  });
  tasks.push(newTask);
  render();
  renderTimeline();
  checkOverAllocation();
  saveState();
  notify(`Added "${src.name}" to today's board`);
}

function openHistoryModal(){
  initHistoryProjectFilter();
  renderHistory();
  document.getElementById('historyModal').classList.add('open');
}

function setHistFilter(f,btn){
  histFilter=f;
  document.querySelectorAll('.hist-filter-btn').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  renderHistory();
}

function renderHistory(){
  const list=document.getElementById('historyList');
  const pmCount=document.getElementById('pmHistCount');
  const sbCount=document.getElementById('sbHistCount');
  const summary=document.getElementById('historyReportSummary');
  if(!list) return;

  const allDates=Object.keys(taskHistory).sort((a,b)=>new Date(b)-new Date(a));
  const allRecords=getHistoryTaskRecords();
  const now=new Date();
  const records=allRecords.filter(r=>matchesHistQuickFilter(r,now) && matchesHistDetailFilter(r));

  if(pmCount) pmCount.textContent=allDates.length+' day'+(allDates.length!==1?'s':'');
  if(sbCount) sbCount.textContent=allDates.length;
  if(summary){
    const doneCount=records.filter(r=>getTaskStatus(r)==='done').length;
    summary.textContent=`${records.length} matching task${records.length!==1?'s':''} | ${doneCount} done | Range ${histFilter}`;
  }

  if(records.length===0){
    list.innerHTML='<div class="hist-empty">No tasks match the current filters.</div>';
    return;
  }

  let html='';
  let lastWeek='';
  const grouped=new Map();
  records.forEach(r=>{
    if(!grouped.has(r.historyDate)) grouped.set(r.historyDate,[]);
    grouped.get(r.historyDate).push(r);
  });

  [...grouped.keys()].sort((a,b)=>new Date(b)-new Date(a)).forEach(dateStr=>{
    const dayRecords=grouped.get(dateStr)||[];
    const d=new Date(dateStr);
    const weekLabel=getWeekLabel(d);
    if(weekLabel!==lastWeek){
      html+=`<div class="hist-week-sep">${weekLabel}</div>`;
      lastWeek=weekLabel;
    }
    const done=dayRecords.filter(r=>getTaskStatus(r)==='done').length;
    const dLabel=d.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});
    const entry=taskHistory[dateStr]||{};
    html+=`
    <div class="hist-day-group">
      <div class="hist-day-header" onclick="toggleHistDay('${dateStr}')">
        <div>
          <div class="hist-day-date">${dLabel}</div>
          <div class="hist-day-meta">${dayRecords.length} matching task${dayRecords.length!==1?'s':''} | ${done} done | ${String(entry.dayStartHour||10).padStart(2,'0')}:00-${String(entry.dayEndHour||18).padStart(2,'0')}:00</div>
        </div>
        <button class="hist-day-export" onclick="event.stopPropagation();exportDayMarkdown('${dateStr}')">Export .md</button>
      </div>
      <div class="hist-day-body open" id="histDay-${dateStr.replace(/\s/g,'-')}">
        ${dayRecords.map(t=>{
          const projectName=t.projectId?(projects.find(p=>p.id===t.projectId)?.name||'Unknown project'):'No project';
          const elapsed=Math.max(0,Math.round((t.time*60-t.remaining)/60));
          const meta=CAT_META[t.cat]||CAT_META.admin;
          const status=getTaskStatus(t);
          const statusMeta=TASK_STATUS_META[status]||{label:status,className:'hist-task-pending'};
          const doneAt=t.doneAt?` | done ${new Date(t.doneAt).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}`:'';
          return `<div class="hist-task-row">
            <div class="hist-task-dot" style="background:${catColor(t.cat)}"></div>
            <div class="hist-task-name">${esc(t.name)}</div>
            <div class="hist-task-meta">${t.time}min est | ${elapsed}min elapsed | ${meta.label} | ${esc(projectName)}${doneAt}</div>
            <div class="hist-task-status ${statusMeta.className}">${statusMeta.label}</div>
            <button class="hist-task-action" onclick="addHistoryTaskToToday('${dateStr}',${t.historyIndex})">Add to Today</button>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  });
  list.innerHTML=html;
}

let logistics=[];
let logisticsPanelOpen=true;

function makeLogItem(o){
  return {id:'l'+Date.now()+Math.random(), icon:o.icon||'🗓', name:o.name, time:o.time, remaining:o.time*60, running:false, interval:null, done:false};
}

function toggleLogisticsPanel(){
  logisticsPanelOpen=!logisticsPanelOpen;
  document.getElementById('logisticsBody').classList.toggle('open',logisticsPanelOpen);
  document.getElementById('logisticsChevron').classList.toggle('open',logisticsPanelOpen);
}

function addLogisticsItem(){
  const icon=document.getElementById('newLogIcon').value.trim()||'🗓';
  const name=document.getElementById('newLogName').value.trim();
  const time=parseInt(document.getElementById('newLogTime').value);
  if(!name||!time||time<1){notify('⚠️ Enter a name and duration');return;}
  logistics.push(makeLogItem({icon,name,time}));
  document.getElementById('newLogIcon').value='';
  document.getElementById('newLogName').value='';
  document.getElementById('newLogTime').value='';
  renderLogistics();
  notify(`➕ Logistics item "${name}" added`);
}

function deleteLogItem(id){
  const item=logistics.find(l=>l.id===id);
  if(item&&item.running){clearInterval(item.interval);item.running=false;}
  logistics=logistics.filter(l=>l.id!==id);
  renderLogistics();
}

function startLogItem(id){
  const item=logistics.find(l=>l.id===id);
  if(!item||item.running||item.done)return;
  // pause any running task or other logistics
  tasks.forEach((_,oi)=>{if(tasks[oi].running)pauseTask(oi);});
  logistics.forEach(l=>{if(l.id!==id&&l.running){clearInterval(l.interval);l.running=false;}});
  item.running=true;
  renderLogistics();
  item.interval=setInterval(()=>{
    if(item.remaining>0){
      item.remaining--;
      const te=document.getElementById(`ltimer-${id}`);
      const pe=document.getElementById(`lprog-${id}`);
      const row=document.getElementById(`lrow-${id}`);
      if(te)te.textContent=format(item.remaining);
      if(pe)pe.style.width=Math.round(((item.time*60-item.remaining)/(item.time*60))*100)+'%';
      if(row)row.classList.add('running');
    }else{
      clearInterval(item.interval);item.running=false;item.done=true;
      notify(`✅ "${item.name}" done!`);renderLogistics();
    }
  },1000);
}

function pauseLogItem(id){
  const item=logistics.find(l=>l.id===id);
  if(!item)return;
  item.running=false;clearInterval(item.interval);
  document.getElementById(`lrow-${id}`)?.classList.remove('running');
  renderLogistics();
}

function resetLogItem(id){
  const item=logistics.find(l=>l.id===id);
  if(!item)return;
  pauseLogItem(id);item.remaining=item.time*60;item.done=false;
  renderLogistics();
}

function markLogDone(id){
  pauseLogItem(id);
  const item=logistics.find(l=>l.id===id);
  if(item)item.done=true;
  renderLogistics();
  notify(`✅ "${logistics.find(l=>l.id===id)?.name||''}" marked done!`);
}

function renderLogistics(){
  const grid=document.getElementById('pmLogisticsGrid');
  if(!grid) return;
  const cnt=`${logistics.length} item${logistics.length!==1?'s':''}`;
  const sbCount=document.getElementById('sbLogisticsCount');
  const pmCount=document.getElementById('pmLogisticsCount');
  if(sbCount) sbCount.textContent=logistics.length;
  if(pmCount) pmCount.textContent=cnt;  if(logistics.length===0){grid.innerHTML='<div style="font-size:.82rem;color:var(--muted);padding:4px 0 10px;">No logistics items yet — add breaks, lunch, standup, etc.</div>';return;}
  grid.innerHTML=logistics.map(item=>{
    const pct=Math.round(((item.time*60-item.remaining)/(item.time*60))*100);
    return `
    <div class="logistics-item${item.running?' running':''}${item.done?' is-done':''}" id="lrow-${item.id}">
      <div class="logistics-item-icon">${esc(item.icon)}</div>
      <div class="logistics-item-info">
        <div class="logistics-item-name${item.done?' done':''}">${esc(item.name)}</div>
        <div class="logistics-item-meta">${item.time}min · ${item.done?'done':item.running?'running':'pending'}</div>
      </div>
      <div class="logistics-item-prog"><div class="logistics-item-prog-fill" id="lprog-${item.id}" style="width:${pct}%"></div></div>
      <div class="logistics-item-timer" id="ltimer-${item.id}">${format(item.remaining)}</div>
      <div class="logistics-item-btns">
        ${!item.done&&!item.running?`<button class="btn btn-start" onclick="startLogItem('${item.id}')">▶</button>`:''}
        ${item.running?`<button class="btn btn-pause" onclick="pauseLogItem('${item.id}')">⏸</button>`:''}
        <button class="btn btn-reset" onclick="resetLogItem('${item.id}')">↺</button>
        <button class="btn btn-done"  onclick="markLogDone('${item.id}')">✓</button>
        <button class="btn btn-del"   onclick="deleteLogItem('${item.id}')">✕</button>
      </div>
    </div>`;
  }).join('');
}

// ─── Import tasks from file ────────────────────────────────────────────────────
function toggleFormatHint(){
  const hint=document.getElementById('formatHint');
  const btn =document.getElementById('formatToggleBtn');
  const open=hint.classList.toggle('open');
  btn.classList.toggle('open',open);
  btn.textContent=open?'✕ Format':'? Format';
}

function importTaskFile(event){
  const file=event.target.files[0];
  if(!file){return;}
  const reader=new FileReader();
  reader.onload=e=>{
    const text=e.target.result;
    const isCsv=file.name.toLowerCase().endsWith('.csv');
    const imported=isCsv?parseCSV(text):parseTXT(text);
    if(imported.length===0){notify('⚠️ No valid tasks found in file');return;}
    imported.forEach(t=>tasks.push(makeTask(t)));
    render();
    notify(`✅ Imported ${imported.length} task${imported.length!==1?'s':''} from ${file.name}`);
  };
  reader.readAsText(file);
  // reset so same file can be re-imported if needed
  event.target.value='';
}

const VALID_CATS=new Set(['deep','meeting','review','admin','help','break']);

function resolveProject(nameRaw){
  if(!nameRaw||!nameRaw.trim()) return null;
  const n=nameRaw.trim().toLowerCase();
  const found=projects.find(p=>p.name.toLowerCase()===n);
  return found?found.id:null;
}

function parseTXT(text){
  const results=[];
  text.split(/\r?\n/).forEach(line=>{
    line=line.trim();
    if(!line||line.startsWith('#')) return; // skip blanks and comment lines
    const parts=line.split('|').map(s=>s.trim());
    const name=parts[0];
    const time=parseInt(parts[1]);
    if(!name||!time||isNaN(time)||time<1) return;
    const cat=VALID_CATS.has((parts[2]||'').toLowerCase())?(parts[2]||'').toLowerCase():'admin';
    const projectId=resolveProject(parts[3]||'');
    results.push({name,time,cat,projectId});
  });
  return results;
}

function parseCSV(text){
  const lines=text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  if(lines.length===0) return [];
  // detect header row
  let start=0;
  const first=lines[0].toLowerCase();
  if(first.includes('name')||first.includes('task')||first.includes('minutes')) start=1;
  const results=[];
  for(let li=start;li<lines.length;li++){
    const cols=lines[li].split(',').map(s=>s.trim().replace(/^"|"$/g,''));
    const name=cols[0];
    const time=parseInt(cols[1]);
    if(!name||!time||isNaN(time)||time<1) continue;
    const cat=VALID_CATS.has((cols[2]||'').toLowerCase())?(cols[2]||'').toLowerCase():'admin';
    const projectId=resolveProject(cols[3]||'');
    results.push({name,time,cat,projectId});
  }
  return results;
}

// ─── Onboarding Wizard ────────────────────────────────────────────────────────
let wizStep = 1;
const WIZ_TOTAL = 3; // base; becomes 4 when carryover step is shown
let wizPendingTasks = [];
let wizTaskMode = 'upload'; // 'upload' | 'type' | 'manual'
let wizCarryoverDecided = false;
const WIZ_DRAFT_KEY = 'devdash_wizard_draft_v1';

function saveWizardDraft(clear=false) {
  try {
    if (clear) {
      localStorage.removeItem(WIZ_DRAFT_KEY);
      return;
    }
    const fileNameEl = document.getElementById('wizFileName');
    const typeArea = document.getElementById('wizTypeArea');
    localStorage.setItem(WIZ_DRAFT_KEY, JSON.stringify({
      dayStartHour,
      dayEndHour,
      wizTaskMode,
      wizPendingTasks,
      wizTypeRaw: typeArea ? typeArea.value : '',
      wizFileLabel: fileNameEl && fileNameEl.style.display !== 'none' ? fileNameEl.textContent : '',
      wizCarryoverIds: [...wizCarryoverIds],
    }));
  } catch(e) {
    console.warn('Could not save wizard draft:', e);
  }
}

function loadWizardDraft() {
  try {
    const raw = localStorage.getItem(WIZ_DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch(e) {
    return null;
  }
}

function applyWizardDraft(draft) {
  if (!draft || typeof draft !== 'object') return;

  if (typeof draft.dayStartHour === 'number') dayStartHour = draft.dayStartHour;
  if (typeof draft.dayEndHour === 'number') dayEndHour = draft.dayEndHour;
  if (typeof draft.wizTaskMode === 'string') wizTaskMode = draft.wizTaskMode;
  if (Array.isArray(draft.wizPendingTasks)) wizPendingTasks = draft.wizPendingTasks;
  if (Array.isArray(draft.wizCarryoverIds)) {
    wizCarryoverIds = new Set(draft.wizCarryoverIds);
    wizCarryoverDecided = true;
  }

  wizRenderTimeSelects();
  wizSetMode(wizTaskMode);

  const typeArea = document.getElementById('wizTypeArea');
  if (typeArea && typeof draft.wizTypeRaw === 'string') typeArea.value = draft.wizTypeRaw;

  const fileNameEl = document.getElementById('wizFileName');
  if (fileNameEl && draft.wizFileLabel) {
    fileNameEl.className = 'wiz-file-name';
    fileNameEl.textContent = draft.wizFileLabel;
    fileNameEl.style.display = '';
  }

  wizRenderTaskPreview();
}

function wizTotal() {
  return (window._isNewDay && window._savedTasks?.length > 0) ? 4 : 3;
}

// Step mapping when carryover is present: 1=Hours, 2=Carryover, 3=Tasks, 4=Confirm
// Step mapping when no carryover:          1=Hours, 2=Tasks, 3=Confirm
function wizGo(step) {
  wizStep = step;
  const total = wizTotal();
  const hasCarryover = window._isNewDay && window._savedTasks?.length > 0;
  // Physical slide order in DOM: 0=Hours, 1=Tasks, 2=Confirm, 3=Carryover
  let slideIndex;
  if (hasCarryover) {
    slideIndex = [0, 3, 1, 2][step - 1];
  } else {
    slideIndex = step - 1;
  }

  // Each slide is exactly 640px (max-width of card) — use vw-safe approach:
  // translateX moves by slideIndex × 100% of ONE slide width.
  // Since .wiz-steps is total slides × card-width wide, we translate by (slideIndex / totalSlides × 100%)
  const totalSlides = hasCarryover ? 4 : 3;
  const pct = (slideIndex / totalSlides) * 100;
  document.getElementById('wizSteps').style.transform = `translateX(-${pct}%)`;

  // Set wiz-steps total width so percentage translateX works correctly
  const stepsEl = document.getElementById('wizSteps');
  stepsEl.style.width = (totalSlides * 100) + '%';
  // Each step takes 1/totalSlides of the container
  document.querySelectorAll('.wiz-step').forEach(s => s.style.width = (100 / totalSlides) + '%');

  document.getElementById('wizProgressFill').style.width = (step / total * 100) + '%';
  document.getElementById('wizFooterLabel').textContent = `Step ${step} of ${total}`;
  document.getElementById('wizBackBtn').style.display  = step > 1 ? '' : 'none';
  document.getElementById('wizNextBtn').style.display  = step < total ? '' : 'none';
  document.getElementById('wizStartBtn').style.display = step === total ? '' : 'none';

  // Update step number labels
  const nums = document.querySelectorAll('.wiz-step-num');
  if (hasCarryover) {
    if (nums[0]) nums[0].textContent = 'Step 1 of 4';
    if (nums[1]) nums[1].textContent = 'Step 3 of 4';
    if (nums[2]) nums[2].textContent = 'Step 4 of 4';
    if (nums[3]) nums[3].textContent = 'Step 2 of 4';
  } else {
    if (nums[0]) nums[0].textContent = 'Step 1 of 3';
    if (nums[1]) nums[1].textContent = 'Step 2 of 3';
    if (nums[2]) nums[2].textContent = 'Step 3 of 3';
  }

  if (step === 1) wizRenderTimeSelects();
  if (hasCarryover && step === 2) wizRenderCarryover();
  if (step === total) wizRenderConfirm();
}

function wizNext() { if (wizStep < wizTotal()) wizGo(wizStep + 1); }
function wizBack() { if (wizStep > 1) wizGo(wizStep - 1); }

// ── Step 1: Time window ──
function wizRenderTimeSelects() {
  ['wizStartHour','wizEndHour'].forEach((id,idx)=>{
    const sel=document.getElementById(id), def=idx===0?dayStartHour:dayEndHour;
    sel.innerHTML='';
    for(let h=0;h<24;h++) sel.innerHTML+=`<option value="${h}"${h===def?' selected':''}>${String(h).padStart(2,'0')}:00</option>`;
    sel.onchange = wizUpdateDurLabel;
  });
  // Immediately sync so defaults are captured even if user never touches the dropdowns
  wizUpdateDurLabel();
}
function wizUpdateDurLabel() {
  const s = parseInt(document.getElementById('wizStartHour').value);
  const e = parseInt(document.getElementById('wizEndHour').value);
  if (!isNaN(s)) dayStartHour = s;
  if (!isNaN(e)) dayEndHour   = e;
  const h = Math.max(0, e - s);
  document.getElementById('wizDurLabel').textContent = h > 0 ? `${h}h work day` : '—';
  saveWizardDraft();
}

// ── Step 2: Task mode ──
function wizSetMode(mode) {
  wizTaskMode = mode;
  ['upload','type','manual'].forEach(m=>{
    const btnId = 'wizMode'+m.charAt(0).toUpperCase()+m.slice(1);
    const panId = btnId+'Panel';
    const btn = document.getElementById(btnId);
    const pan = document.getElementById(panId);
    if(btn) btn.classList.toggle('active', m===mode);
    if(pan) pan.style.display = m===mode ? (m==='manual' ? 'block' : 'flex') : 'none';
  });
  if(mode!=='type') wizRenderTaskPreview();
  saveWizardDraft();
}

function toggleWizFmt() {
  const b=document.getElementById('wizFmtBlock'),t=document.getElementById('wizFmtToggle');
  const open=b.classList.toggle('open');
  t.textContent=open?'✕ Hide format':'? File format';
}

// Upload mode
function wizHandleFile(e) {
  const file=e.target.files[0]; if(!file)return;
  const reader=new FileReader();
  reader.onload=ev=>{
    const text=ev.target.result;
    const isCsv=file.name.toLowerCase().endsWith('.csv');
    wizPendingTasks=isCsv?parseCSV(text):parseTXT(text);
    const fn=document.getElementById('wizFileName');
    fn.className='wiz-file-name';
    fn.textContent='📄 '+file.name+' — '+wizPendingTasks.length+' tasks parsed';
    fn.style.display='';
    wizRenderTaskPreview();
    saveWizardDraft();
  };
  reader.readAsText(file);
  e.target.value='';
}

// Drag & drop — deferred so DOM is ready
function initWizDragDrop(){
  const zone=document.getElementById('wizDropZone');
  if(!zone) return;
  zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('drag');});
  zone.addEventListener('dragleave',()=>zone.classList.remove('drag'));
  zone.addEventListener('drop',e=>{
    e.preventDefault();zone.classList.remove('drag');
    const file=e.dataTransfer.files[0]; if(!file)return;
    wizHandleFile({target:{files:[file],value:''}});
  });
}

// Type mode — parse on every keystroke
function wizParseTyped() {
  const raw=document.getElementById('wizTypeArea').value;
  wizPendingTasks=parseTXT(raw);
  wizRenderTaskPreview();
  saveWizardDraft();
}

// Shared task preview
function wizRenderTaskPreview() {
  const el=document.getElementById('wizTaskPreview');
  if(wizPendingTasks.length===0){el.style.display='none';saveWizardDraft();return;}
  el.style.display='flex';
  el.innerHTML=wizPendingTasks.map((t,i)=>{
    const proj=t.projectId?projects.find(p=>p.id===t.projectId):null;
    return `<div class="wiz-task-row">
      <span class="wtr-name">${esc(t.name)}</span>
      <span class="wtr-meta">${t.time}min · ${CAT_META[t.cat]?.label||t.cat}${proj?' · '+esc(proj.name):''}</span>
      <button class="wtr-del" onclick="wizRemoveTask(${i})">✕</button>
    </div>`;
  }).join('');
}
function wizRemoveTask(i){
  wizPendingTasks.splice(i,1);
  wizRenderTaskPreview();
  const fn=document.getElementById('wizFileName');
  if(fn && fn.style.display!=='none') fn.textContent=fn.textContent.replace(/\d+ tasks parsed/, wizPendingTasks.length+' tasks parsed');
  saveWizardDraft();
}

// ── Step 3: Confirm ──
// ── Carryover step ──
let wizCarryoverIds = new Set(); // IDs of yesterday's tasks user chose to carry over

function wizRenderCarryover() {
  const saved = window._savedTasks || [];
  const incomplete = saved.filter(t => !t.done && t.cat !== 'break');
  const done       = saved.filter(t => t.done);
  const el = document.getElementById('wizCarryoverList');
  if (!el) return;

  if (incomplete.length === 0) {
    el.innerHTML = '<div style="font-size:.85rem;color:var(--muted);font-style:italic;padding:6px 0;">All tasks from yesterday were completed 🎉</div>';
    return;
  }

  // Pre-select all incomplete only the first time if no prior choice was restored
  if (!wizCarryoverDecided && wizCarryoverIds.size === 0) {
    incomplete.forEach((_,i) => wizCarryoverIds.add(i));
  }

  el.innerHTML = incomplete.map((t, i) => {
    const proj = t.projectId ? projects.find(p => p.id === t.projectId) : null;
    const elapsed = t.time * 60 - (t.remaining ?? t.time * 60);
    const pct = Math.round((elapsed / (t.time * 60)) * 100);
    return `<label class="wiz-carryover-row" id="wcrow-${i}">
      <input type="checkbox" ${wizCarryoverIds.has(i)?'checked':''} onchange="wizToggleCarry(${i}, this.checked)" style="accent-color:var(--accent2);width:15px;height:15px;cursor:pointer;flex-shrink:0;">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:.88rem;">${esc(t.name)}</div>
        <div style="font-size:.72rem;color:var(--muted);font-family:'JetBrains Mono',monospace;">${t.time}min · ${CAT_META[t.cat]?.label||t.cat}${proj?' · <span style="color:'+proj.color+'">'+esc(proj.name)+'</span>':''}${pct>0?' · '+pct+'% done':''}</div>
      </div>
    </label>`;
  }).join('');

  if (done.length > 0) {
    el.innerHTML += `<div style="font-size:.72rem;color:var(--muted);font-family:'JetBrains Mono',monospace;padding-top:8px;border-top:1px solid var(--border);margin-top:8px;">✅ ${done.length} completed yesterday — not shown</div>`;
  }
}

function wizToggleCarry(i, checked) {
  wizCarryoverDecided = true;
  if (checked) wizCarryoverIds.add(i);
  else wizCarryoverIds.delete(i);
  saveWizardDraft();
}

function wizSelectAllCarry(select) {
  wizCarryoverDecided = true;
  const saved = window._savedTasks || [];
  const incomplete = saved.filter(t => !t.done && t.cat !== 'break');
  if (select) incomplete.forEach((_, i) => wizCarryoverIds.add(i));
  else wizCarryoverIds.clear();
  // re-render checkboxes
  incomplete.forEach((_, i) => {
    const row = document.getElementById(`wcrow-${i}`);
    if (row) { const cb = row.querySelector('input[type=checkbox]'); if (cb) cb.checked = select; }
  });
  saveWizardDraft();
}

function wizRenderConfirm() {
  // Read from wizard selects (populated in step 1)
  const sh = document.getElementById('wizStartHour');
  const eh = document.getElementById('wizEndHour');
  if (sh && sh.value !== '') dayStartHour = parseInt(sh.value);
  if (eh && eh.value !== '') dayEndHour   = parseInt(eh.value);
  // Don't call onHoursChange() here — dashboard selects aren't built yet.
  // Hours will be applied to the dashboard in bootDashboard via buildHourSelects.

  const hasCarryover = window._isNewDay && window._savedTasks?.length > 0;
  const incomplete = hasCarryover ? (window._savedTasks||[]).filter(t=>!t.done&&t.cat!=='break') : [];
  const carryCount = [...wizCarryoverIds].filter(i => i < incomplete.length).length;

  let tasksLine;
  if (wizTaskMode === 'manual') {
    tasksLine = carryCount > 0
      ? `${carryCount} carried over from yesterday · add more manually`
      : 'Starting with empty board — add tasks manually';
  } else if (wizPendingTasks.length > 0) {
    tasksLine = wizPendingTasks.length + ' new tasks' + (carryCount > 0 ? ` + ${carryCount} carried over` : '');
  } else {
    tasksLine = carryCount > 0
      ? `${carryCount} tasks carried over from yesterday`
      : 'No tasks loaded — board will be empty';
  }

  const rows = [
    {icon:'🕐', label:'Work hours', value:`${String(dayStartHour).padStart(2,'0')}:00 → ${String(dayEndHour).padStart(2,'0')}:00 (${Math.max(0,dayEndHour-dayStartHour)}h)`},
    {icon:'✅', label:'Tasks',      value: tasksLine},
    {icon:'📁', label:'Projects',   value: projects.length>0  ? projects.map(p=>p.name).join(', ')  : 'None — add from dashboard'},
    {icon:'🗓', label:'Logistics',  value: logistics.length>0 ? logistics.map(l=>l.icon+' '+l.name).join(' · ') : 'None — add from dashboard'},
  ];
  document.getElementById('wizSummaryBlock').innerHTML = rows.map(r=>`
    <div style="display:flex;gap:12px;align-items:flex-start;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:13px 16px;">
      <span style="font-size:1.1rem;flex-shrink:0">${r.icon}</span>
      <div>
        <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:1px;color:var(--muted);font-family:'JetBrains Mono',monospace;">${r.label}</div>
        <div style="font-size:.88rem;font-weight:700;margin-top:3px;">${r.value}</div>
      </div>
    </div>`).join('');
}

// ── Finish ──
function wizFinish() {
  tasks = [];
  const hasCarryover = window._isNewDay && window._savedTasks?.length > 0;

  // Add carried-over tasks first (reset their timers to full)
  if (hasCarryover) {
    const incomplete = (window._savedTasks||[]).filter(t=>!t.done&&t.cat!=='break');
    [...wizCarryoverIds].forEach(i => {
      if (i < incomplete.length) {
        const t = incomplete[i];
        tasks.push(makeTask({
          name:t.name,
          time:t.time,
          cat:t.cat,
          projectId:t.projectId||null,
          status:'carried_over',
          carriedOverFrom: window._savedTasksDate || null
        }));
      }
    });
  }

  // Add new tasks from file/type
  if (wizTaskMode !== 'manual' && wizPendingTasks.length > 0) {
    wizPendingTasks.forEach(t => tasks.push(makeTask(t)));
  }

  document.getElementById('wizBackdrop').classList.add('hidden');
  bootDashboard();
  saveWizardDraft(true);
  saveState();
}


// ─── Cal Newport Quotes ────────────────────────────────────────────────────────
const CAL_QUOTES = [
  { q: "Clarity about what matters provides clarity about what does not.", src: "Deep Work" },
  { q: "A deep life is a good life.", src: "Deep Work" },
  { q: "Efforts to deepen your focus will struggle if you don't simultaneously wean yourself from a dependence on distraction.", src: "Deep Work" },
  { q: "The ability to perform deep work is becoming increasingly rare at exactly the same time it is becoming increasingly valuable.", src: "Deep Work" },
  { q: "Who you are, what you think, feel, and do, what you love — is the sum of what you focus on.", src: "Deep Work" },
  { q: "Busyness as proxy for productivity: doing lots of stuff in a visible manner.", src: "Deep Work" },
  { q: "Finish your work, then be done with it.", src: "Deep Work" },
  { q: "The key to developing a deep work habit is to move beyond good intentions and add routines and rituals to your working life.", src: "Deep Work" },
  { q: "Human beings, it seems, are at their best when immersed deeply in something challenging.", src: "Deep Work" },
  { q: "Two goals: to protect your time and attention from the shallow, and to actively build your capacity for depth.", src: "Deep Work" },
  { q: "Do less. Do it better. Know why.", src: "Digital Minimalism" },
  { q: "Solitude requires you to move past reacting to information created by other people and focus instead on your own thoughts and experiences.", src: "Digital Minimalism" },
  { q: "Autonomy over your schedule is one of the most important factors in long-term career satisfaction.", src: "So Good They Can't Ignore You" },
  { q: "Stop focusing on these little details. Focus instead on becoming so good they can't ignore you.", src: "So Good They Can't Ignore You" },
  { q: "Working right trumps finding the right work.", src: "So Good They Can't Ignore You" },
  { q: "Passion is a side effect of mastery.", src: "So Good They Can't Ignore You" },
  { q: "Control over what you do and how you do it is one of the most powerful traits you can acquire.", src: "So Good They Can't Ignore You" },
  { q: "The most successful people in most fields share a commitment to completing a pre-planned schedule of work.", src: "Slow Productivity" },
  { q: "Do fewer things. Work at a natural pace. Obsess over quality.", src: "Slow Productivity" },
  { q: "Pseudo-productivity is the use of visible activity as a proxy for useful effort.", src: "Slow Productivity" },
];

function getDailyQuote() {
  // deterministic daily rotation based on date
  const today = new Date();
  const idx = (today.getFullYear() * 366 + today.getMonth() * 31 + today.getDate()) % CAL_QUOTES.length;
  return CAL_QUOTES[idx];
}

// ─── Persistence (localStorage) ───────────────────────────────────────────────
const STORE_KEY = 'devdash_v1';

function saveState() {
  try {
    const todayStr = new Date().toDateString();
    // Archive today's tasks into history before saving
    if(tasks.length>0){
      taskHistory[todayStr]={
        tasks: tasks.map(t=>({
          id: t.id,
          name:t.name,
          time:t.time,
          cat:t.cat,
          projectId:t.projectId,
          done:t.done,
          status:getTaskStatus(t),
          createdAt:t.createdAt||null,
          startedAt:t.startedAt||null,
          doneAt:t.doneAt||null,
          carriedOverFrom:t.carriedOverFrom||null,
          notesHTML:t.notesHTML,
          scheduledTime:t.scheduledTime||null
        })),
        dayStartHour, dayEndHour, savedAt: todayStr
      };
    }
    const data = {
      savedAt: todayStr,
      projects,
      logistics: logistics.map(l => ({ icon: l.icon, name: l.name, time: l.time })),
      dayStartHour,
      dayEndHour,
      objectives,
      taskHistory,
      tasks: tasks.map(t => ({
        id: t.id,
        name: t.name,
        time: t.time,
        cat: t.cat,
        projectId: t.projectId,
        done: t.done,
        status:getTaskStatus(t),
        createdAt:t.createdAt||null,
        startedAt:t.startedAt||null,
        doneAt: t.doneAt||null,
        carriedOverFrom:t.carriedOverFrom||null,
        notesHTML: t.notesHTML,
        subtasks: t.subtasks,
        remaining: t.remaining,
        scheduledTime: t.scheduledTime||null,
      })),
    };
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch(e) { console.warn('Could not save:', e); }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch(e) { return null; }
}

// Auto-save whenever something changes — debounced
let _saveTimer;
function scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveState, 800);
}

// Hook save into all mutating operations
const _origRender = render;
window.render = function() { _origRender(); scheduleSave(); };
const _origRenderLogistics = renderLogistics;
window.renderLogistics = function() { _origRenderLogistics(); scheduleSave(); };

// ─── Init ─────────────────────────────────────────────────────────────────────
function bootDashboard(){
  buildHourSelects();
  buildTimeSlots();
  // Apply the wizard-confirmed hours to the dashboard header
  const hrs = Math.max(0, dayEndHour - dayStartHour);
  document.getElementById('headerSubtitle').textContent =
    `${String(dayStartHour).padStart(2,'0')}:00 → ${String(dayEndHour).padStart(2,'0')}:00 · ${hrs}-hour focus plan`;
  renderProjects();
  renderLogistics();
  render();
  renderTimeline();
  renderObjectives();
}

// Show wizard after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Inject Cal Newport quote into wizard step 1
  const q = getDailyQuote();
  const quoteEl = document.getElementById('wizQuote');
  if (quoteEl) {
    quoteEl.innerHTML = `<span class="wiz-quote-mark">"</span>${q.q}<span class="wiz-quote-mark">"</span>
      <div class="wiz-quote-src">— Cal Newport, <em>${q.src}</em></div>`;
  }

  // Load persisted state
  const saved = loadState();
  let resumeTodayDashboard = false;
  if (saved) {
    if (Array.isArray(saved.projects))  projects      = saved.projects;
    if (Array.isArray(saved.logistics)) logistics     = saved.logistics.map(makeLogItem);
    if (typeof saved.dayStartHour === 'number') dayStartHour = saved.dayStartHour;
    if (typeof saved.dayEndHour   === 'number') dayEndHour   = saved.dayEndHour;
    if (saved.objectives && typeof saved.objectives === 'object') {
      OBJ_LEVELS.forEach(l=>{ if(Array.isArray(saved.objectives[l.key])) objectives[l.key]=saved.objectives[l.key]; });
    }
    if (saved.taskHistory && typeof saved.taskHistory === 'object') taskHistory = saved.taskHistory;

    // Check if saved tasks are from a previous day
    const todayStr = new Date().toDateString();
    const isNewDay = saved.savedAt !== todayStr;
    if (!isNewDay && typeof saved.dayStartHour === 'number' && typeof saved.dayEndHour === 'number') {
      resumeTodayDashboard = true;
    }
    if (Array.isArray(saved.tasks) && saved.tasks.length > 0) {
      if (isNewDay) {
        // Store for carryover wizard step
        window._savedTasks = saved.tasks;
        window._savedTasksDate = saved.savedAt || null;
        window._isNewDay   = true;
      } else {
        // Same day — restore tasks as-is
        tasks = saved.tasks.map(t => makeTask(t));
      }
    }
  }

  rebuildProjectSelect();
  initWizDragDrop();
  if (resumeTodayDashboard) {
    document.getElementById('wizBackdrop').classList.add('hidden');
    bootDashboard();
  } else {
    wizGo(1);
    const wizardDraft = loadWizardDraft();
    if (wizardDraft) applyWizardDraft(wizardDraft);
  }

  // Panel modal backdrop click-to-close
  document.getElementById('projectsModal').addEventListener('click',function(e){if(e.target===this)closeProjectsModal();});
  document.getElementById('logisticsModal').addEventListener('click',function(e){if(e.target===this)closeLogisticsModal();});
  document.getElementById('objectivesModal').addEventListener('click',function(e){if(e.target===this)closeObjectivesModal();});
  document.getElementById('historyModal').addEventListener('click',function(e){if(e.target===this)closeHistoryModal();});

  // Update sidebar history count on load
  const sbHist=document.getElementById('sbHistCount');
  if(sbHist) sbHist.textContent=Object.keys(taskHistory).length;
});
