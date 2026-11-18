/* =====================================================================
   GROUP STUDY  (screen #group, database: backend/group_study.sql)
   • Any student hosts a group → gets a 6-digit code → friends join with it.
   • The host picks a Practice Sheet, a Test Paper or a PYQ set, the timer and
     when answers are shown, then starts. Everyone gets the same sheet.
   • Microphone must stay ON (only checked, never recorded or sent anywhere).
   • Leaving the screen costs a life: another tab, another app, minimising the browser,
     locking the phone or closing/reloading the page. 3 lives, then the sheet is submitted.
   • Bottom-right status box: each member's "N answered", lives, mic, finished.
   • After the session: everyone's marks and a question-by-question summary
     (who got it right / wrong and how long each person took).
   ===================================================================== */
const GS_LIVES = 3;
const GS_PER_OPTS = [60, 90, 120, 150, 180, 240];
let GS = null;               // {id, st (server state), Q (questions), me (my local progress), poll, ...}
let GS_OFF = 0;              // server clock offset
const gsNow = () => Date.now() + GS_OFF;
const gsMeKey = id => 'stp_gs_me_' + ((USER && USER.id) || 'x') + '_' + id;

async function gsRpc(name, args){
  if(!SB) throw new Error('The server is not connected.');
  let last;
  for(let t = 0; t < 3; t++){
    try{
      const { data, error } = await SB.rpc(name, args || {});
      if(error){
        const m = String(error.message || 'Request failed');
        if(/Could not find the function|does not exist/i.test(m)) throw Object.assign(new Error('Group Study is not set up in the database yet (run backend/group_study.sql in Supabase).'), { fatal: true });
        throw Object.assign(new Error(m), { fatal: true });
      }
      return data;
    }catch(e){ last = e; if(e.fatal) throw e; await new Promise(r => setTimeout(r, 400 * (t + 1))); }
  }
  throw new Error('Network problem: ' + (last && last.message || 'please check your internet'));
}

/* ---------------- microphone (checked only — nothing is recorded or sent) ---------------- */
const GSM = { stream: null, track: null, an: null, buf: null, lvl: 0, ignoreBlurUntil: 0 };
async function gsMicStart(){
  if(GSM.track && GSM.track.readyState === 'live' && GSM.track.enabled) return true;
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ toast('This browser cannot use the microphone. Please open the site in Chrome or Safari.', 6000); return false; }
  GSM.ignoreBlurUntil = Date.now() + 15000;                 // the permission prompt itself takes focus
  try{
    const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    GSM.stream = s; GSM.track = s.getAudioTracks()[0];
    try{
      const AC = window.AudioContext || window.webkitAudioContext, ac = GSM.ac || (GSM.ac = new AC());
      if(ac.state === 'suspended') ac.resume();
      const src = ac.createMediaStreamSource(s), an = ac.createAnalyser(); an.fftSize = 512;
      src.connect(an); GSM.an = an; GSM.buf = new Uint8Array(an.fftSize);
    }catch(e){ GSM.an = null; }
    GSM.track.addEventListener('ended', gsMicChanged); GSM.track.addEventListener('mute', gsMicChanged); GSM.track.addEventListener('unmute', gsMicChanged);
    GSM.ignoreBlurUntil = Date.now() + 1500;
    gsMicChanged();
    return true;
  }catch(e){
    GSM.ignoreBlurUntil = Date.now() + 1500;
    toast('Microphone permission is needed for Group Study. Allow the microphone for this site in your browser settings and try again.', 7000);
    return false;
  }
}
function gsMic(){ const t = GSM.track; return !t || t.readyState !== 'live' || !t.enabled ? 'off' : (t.muted ? 'muted' : 'on'); }
function gsMicLevel(){
  if(!GSM.an || gsMic() !== 'on') return 0;
  GSM.an.getByteTimeDomainData(GSM.buf); let m = 0;
  for(let i = 0; i < GSM.buf.length; i++) m = Math.max(m, Math.abs(GSM.buf[i] - 128));
  return Math.min(1, m / 50);
}
function gsMicStop(){ try{ if(GSM.stream) GSM.stream.getTracks().forEach(t => t.stop()); }catch(e){} GSM.stream = GSM.track = GSM.an = null; }
function gsMicChanged(){ if(GS){ gsPaintMicGuard(); gsPush(); } }
const micIcon = m => m === 'on' ? '<span class="gm-mic on" title="Mic on">🎤</span>' : `<span class="gm-mic off" title="Mic ${m === 'muted' ? 'muted' : 'off'}">🔇</span>`;

/* ---------------- entry & home ---------------- */
async function openGroupStudy(){
  show('group'); gsStopPoll(); GS = null; $('gsStat').hidden = true;
  const saved = LS.get('stp_gs', null);
  $('gsMain').innerHTML = `
    <div class="page-head"><h1>👥 Group Study</h1><p>Solve the same sheet together with your friends. One person hosts, the others join with the code.</p></div>
    <div id="gsResume"></div>
    <div class="gs-home">
      <div class="card gs-card">
        <h2>🔑 Join a group</h2>
        <p class="gs-sub">Ask the host for the 6-digit code.</p>
        <input id="gsCode" class="gs-codein" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="••••••" aria-label="Group code">
        <button type="button" class="btn green gs-wide" id="gsJoinBtn">Join →</button>
      </div>
      <div class="card gs-card">
        <h2>➕ Host a new group</h2>
        <p class="gs-sub">Choose the sheet, set the timer and share the code with your friends.</p>
        <ul class="gs-rules"><li>🎤 Microphone must stay on for everyone</li><li>❤️ ${GS_LIVES} lives — leaving the screen (tab, app, minimise) costs one</li><li>📊 Everyone sees everyone's result at the end</li></ul>
        <button type="button" class="btn gs-wide" id="gsNewBtn">Create Group</button>
      </div>
    </div>
    <h3 class="gs-h3">Your past group sessions</h3>
    <div id="gsPast" class="gs-past"><div class="gs-sub">Loading…</div></div>`;
  if(saved && saved.id){
    gsRpc('gs_state', { p_group: saved.id }).then(st => {
      if(st && st.status !== 'ended') $('gsResume').innerHTML = `<div class="card gs-resume"><span>You are in <b>${esc(st.title)}</b> (code ${esc(st.code)}) — ${st.status === 'lobby' ? 'waiting to start' : 'in progress'}.</span><button type="button" class="btn green small" data-gsopen="${esc(st.id)}">Rejoin →</button></div>`;
      else LS.del('stp_gs');
    }).catch(() => {});
  }
  gsRpc('gs_my_groups').then(list => {
    const el = $('gsPast'); if(!el) return;
    el.innerHTML = (list || []).length ? list.map(g => `<button type="button" class="card gs-pastc" data-gsopen="${esc(g.id)}">
        <b>${esc(g.title)}</b><span>${new Date(g.at).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · ${g.n} questions · ${g.members} people · host ${esc(g.host_name)}</span>
        <i>${g.status === 'ended' ? 'View results →' : 'Open →'}</i></button>`).join('')
      : '<div class="gs-sub">No group sessions yet.</div>';
  }).catch(e => { const el = $('gsPast'); if(el) el.innerHTML = `<div class="gs-sub">${esc(e.message)}</div>`; });
}

async function gsJoin(){
  const code = ($('gsCode').value || '').replace(/\D/g, '');
  if(code.length !== 6){ toast('Type the 6-digit code.'); $('gsCode').focus(); return; }
  if(!await gsMicStart()) return;
  busy(true, 'Joining…');
  try{ const r = await gsRpc('gs_join', { p_code: code }); busy(false); await gsEnter(r.id); }
  catch(e){ busy(false); toast(e.message, 5000); }
}

/* ---------------- create ---------------- */
let GSC = null;             // create-form state
async function gsCreateForm(){
  GSC = { kind: 'sheet', exam: 'main', units: [], years: 'all', mrq: false, count: 20, reveal: 'end', per: 0 };
  const sheets = PAPERS.filter(p => paperVisible(p) && p.category === 'sheet');
  const tests = PAPERS.filter(p => paperVisible(p) && ['topic', 'full', 'main3h'].indexOf(p.category || 'topic') >= 0);
  const opt = p => `<option value="${esc(p.id)}">${esc(showName(p.name))}${p.questions ? ' — ' + p.questions + ' Qs' : ''}</option>`;
  $('gsMain').innerHTML = `
    <div class="page-head"><h1>➕ New Group</h1><p>Everyone in the group will get exactly this sheet.</p></div>
    <div class="card gs-form">
      <label class="gs-f"><span>Group name</span><input id="gcTitle" maxlength="60" placeholder="e.g. Complex Numbers revision"></label>
      <div class="gs-f"><span>What will you solve?</span>
        <div class="gs-seg" id="gcKind">
          <button type="button" data-k="sheet" class="on">📝 Practice Sheet</button>
          <button type="button" data-k="paper">📘 Test Paper</button>
          <button type="button" data-k="pyq">🎯 PYQ set</button>
        </div></div>
      <div id="gcSheet" class="gs-f"><span>Practice Sheet</span><select id="gcSheetSel">${sheets.map(opt).join('') || '<option value="">No practice sheets yet</option>'}</select></div>
      <div id="gcPaper" class="gs-f" hidden><span>Test Paper</span><select id="gcPaperSel">${tests.map(opt).join('') || '<option value="">No papers</option>'}</select>
        <small class="gs-note">Solving a test paper here does not use up anyone's real attempt of it.</small></div>
      <div id="gcPyq" hidden>
        <div class="gs-row">
          <label class="gs-f"><span>Exam</span><select id="gcExam">${PYQ_EXAMS.map(x => `<option value="${x.id}">${esc(x.title)}</option>`).join('')}</select></label>
          <label class="gs-f"><span>Years</span><select id="gcYears"><option value="all">All years</option><option value="5">Last 5 years</option><option value="10">Last 10 years</option><option value="2019">2019 onwards (online era)</option></select></label>
          <label class="gs-f"><span>Questions</span><select id="gcCount">${[10, 15, 20, 25, 30].map(n => `<option${n === 20 ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
        </div>
        <label class="gs-chk"><input type="checkbox" id="gcMrq"> Only “Most Repeated” questions</label>
        <div class="gs-f"><span>Topics <small>(none ticked = all topics)</small></span><div class="gs-units" id="gcUnits"><div class="gs-sub">Loading topics…</div></div></div>
      </div>
      <div class="gs-row">
        <label class="gs-f"><span>Show answers</span><select id="gcReveal">
          <option value="end">At the end, in the group result</option>
          <option value="now">Immediately after each question</option></select></label>
        <label class="gs-f"><span>Time limit</span><select id="gcPer">
          <option value="0">No limit (each person's time is still recorded)</option>
          ${GS_PER_OPTS.map(s => `<option value="${s}">${perTxt(s)} per question</option>`).join('')}</select></label>
      </div>
      <p class="gs-note" id="gcInfo"></p>
      <div class="gs-actions"><button type="button" class="btn light" id="gcCancel">← Back</button><button type="button" class="btn green" id="gcCreate">🎤 Allow mic &amp; Create</button></div>
    </div>`;
  gsPaintPyqUnits();
}
async function gsPaintPyqUnits(){
  const el = $('gcUnits'); if(!el) return;
  const idx = await pyqIndex(GSC.exam);
  if(!idx){ el.innerHTML = '<div class="gs-sub">Could not load the PYQ topics.</div>'; return; }
  el.innerHTML = idx.units.map(u => `<label class="gs-chk"><input type="checkbox" data-u="${esc(u.id)}"${GSC.units.indexOf(u.id) >= 0 ? ' checked' : ''}> ${esc(u.title)} <i>${GSC.mrq ? u.nMrq || 0 : u.n}</i></label>`).join('');
}
function gsYearsOk(yr, last){
  const y = Number(yr);
  if(GSC.years === 'all') return true;
  if(GSC.years === '2019') return y >= 2019;
  return y > last - Number(GSC.years);              // last 5 years = the 5 newest years in the bank
}
async function gsCreate(){
  const kind = GSC.kind, per = Number($('gcPer').value) || 0, reveal = $('gcReveal').value;
  let title = $('gcTitle').value.trim(), source, n;
  busy(true, 'Preparing the sheet…');
  try{
    if(kind === 'pyq'){
      const exam = $('gcExam').value, idx = await pyqIndex(exam);
      if(!idx) throw new Error('Could not load the PYQs.');
      const units = GSC.units.length ? GSC.units : idx.units.map(u => u.id);
      await pyqLoadUnits(exam, units);
      let pool = [];
      units.forEach(u => (PYQ_UNITS[exam + ':' + u].questions || []).forEach(q => {
        if(['mcq', 'num', 'multi', 'tf'].indexOf(q.type) < 0) return;      // only questions that can be checked automatically
        if(GSC.mrq && !q.mrq) return;
        if(!gsYearsOk(q.yr, Math.max.apply(null, idx.years || [2026]))) return;
        pool.push([u, q.id]);
      }));
      if(!pool.length) throw new Error('No PYQs match these choices.');
      for(let i = pool.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      pool = pool.slice(0, Number($('gcCount').value) || 20);
      source = { kind: 'pyq', exam, qs: pool }; n = pool.length;
      if(!title){ const t = GSC.units.length === 1 ? idx.units.find(u => u.id === GSC.units[0]).title : (GSC.units.length ? GSC.units.length + ' topics' : 'Mixed topics'); title = (PYQ_EXAMS.find(x => x.id === exam) || {}).title + ' PYQs · ' + t; }
    } else {
      const id = $(kind === 'sheet' ? 'gcSheetSel' : 'gcPaperSel').value;
      if(!id) throw new Error('Choose a ' + (kind === 'sheet' ? 'practice sheet' : 'paper') + '.');
      const paper = await fetchPaper(id);
      n = (paper.questions || []).length; if(!n) throw new Error('This paper has no questions.');
      const nm = (PAPERS.find(p => p.id === id) || {}).name || (paper.settings || {}).paperName || 'Sheet';
      source = { kind: 'paper', id, name: nm };
      if(!title) title = showName(nm);
    }
    busy(false);
    if(!await gsMicStart()) return;
    busy(true, 'Creating the group…');
    const r = await gsRpc('gs_create', { p_title: title, p_source: source, p_settings: { reveal, per, limitSec: per ? per * n : 0, lives: GS_LIVES }, p_n: n });
    busy(false); await gsEnter(r.id);
  }catch(e){ busy(false); if(e.auth) return authFail(e); toast(e.message || 'Could not create the group.', 5000); }
}

/* ---------------- loading a group ---------------- */
async function gsEnter(id){
  busy(true, 'Opening the group…');
  try{
    const st = await gsRpc('gs_state', { p_group: id });
    GS_OFF = new Date(st.now).getTime() - Date.now();
    const Q = await gsLoadQs(st.source);
    if(Q.length !== st.n) throw new Error('The sheet of this group could not be loaded completely.');
    const me = Object.assign({ ans: {}, t: {}, tabs: 0, log: [], done: false, why: null, total: 0 }, LS.get(gsMeKey(id), {}) || {});
    const mine = (st.members || []).find(m => m.me);
    if(mine && mine.data && mine.data.ans && !Object.keys(me.ans).length){ me.ans = mine.data.ans; me.t = mine.data.t || {}; }
    if(mine){ me.tabs = Math.max(me.tabs, mine.tabs || 0); if(mine.done){ me.done = true; me.why = me.why || mine.why; } }
    GS = { id, st, Q, me, v: -1, view: '', sel: {}, cur: -1, lastT: 0, lastPush: 0, pushT: 0, armT: 0, endTap: 0, subTap: 0 };
    gsToken();
    // page closed / reloaded mid-session: counts as leaving, unless that leaving was already counted as it closed
    const reopened = st.status === 'running' && !me.done && me.inRun && !(me.lastSw && me.closedAt && me.closedAt - me.lastSw < 1500);
    LS.set('stp_gs', { id });
    busy(false); show('group'); gsRender(); gsStartPoll();
    if(reopened && GS.view === 'run'){ GS_LAST_SW = 0; GSM.ignoreBlurUntil = 0; gsTabSwitch('reopen'); } else gsPush(true);
  }catch(e){ busy(false); if(e.auth) return authFail(e); toast(e.message || 'Could not open the group.', 5000); }
}
async function gsLoadQs(src){
  if(src.kind === 'paper'){
    const p = await fetchPaper(src.id), sec = {};
    (p.sections || []).forEach(s => sec[s.id] = s);
    return (p.questions || []).map(q => {
      const s = sec[q.section];
      return { type: q.type === 'num' ? 'num' : 'mcq', q: q.q, opts: q.opts || [], ans: q.ans, alt: q.alt, tol: q.tol, sol: q.sol, bonus: q.bonus,
               pos: s ? Number(s.correct) : 4, neg: s ? Number(s.wrong) : (q.type === 'num' ? 0 : -1) };
    });
  }
  const idx = await pyqIndex(src.exam); if(!idx) throw new Error('Could not load the PYQs.');
  await pyqLoadUnits(src.exam, [...new Set(src.qs.map(x => x[0]))]);
  return src.qs.map(([u, id]) => {
    const U = PYQ_UNITS[src.exam + ':' + u], q = U && U.questions.find(x => x.id === id);
    if(!q) return null;
    return { type: q.type, q: q.q, opts: q.opts || [], ans: q.ans, alt: q.alt, tol: q.tol, sol: q.sol, bonus: q.bonus, src: srcText(q),
             pos: 4, neg: q.type === 'mcq' || q.type === 'tf' ? -1 : q.type === 'multi' ? -2 : 0 };
  }).filter(Boolean);
}
function gsCheck(q, a){
  if(a === null || a === undefined || a === '' || (Array.isArray(a) && !a.length)) return null;
  if(q.bonus) return true;
  if(q.type === 'multi'){ const A = (Array.isArray(a) ? a : []).map(Number).sort(), K = (q.ans || []).map(Number).sort(); return A.length === K.length && A.every((k, i) => k === K[i]); }
  if(q.type === 'num') return [q.ans].concat(q.alt || []).some(v => Math.abs(parseFloat(a) - Number(v)) <= (q.tol != null ? Number(q.tol) : 0.001) + 1e-9);
  return Number(a) === Number(q.ans) || (q.alt || []).map(Number).indexOf(Number(a)) >= 0;
}
const gsAnsText = q => q.bonus ? 'Bonus' : q.type === 'multi' ? (q.ans || []).map(k => '(' + LET[Number(k)] + ')').join(', ')
  : q.type === 'tf' ? (Number(q.ans) ? 'False' : 'True') : q.type === 'mcq' ? [q.ans].concat(q.alt || []).map(k => '(' + LET[Number(k)] + ')').join(' or ')
  : [q.ans].concat(q.alt || []).join(' or ');
const gsAText = (q, a) => a === null || a === undefined || a === '' ? '—' : q.type === 'multi' ? (a || []).map(k => LET[Number(k)]).join(',') : q.type === 'tf' ? (Number(a) ? 'F' : 'T') : q.type === 'mcq' ? LET[Number(a)] : String(a);

/* ---------------- sync ---------------- */
function gsSaveMe(){ if(GS) LS.set(gsMeKey(GS.id), GS.me); }
function gsAnsweredN(){ return Object.keys(GS.me.ans).filter(k => GS.me.ans[k] && GS.me.ans[k].a !== undefined && GS.me.ans[k].a !== null && GS.me.ans[k].a !== '').length; }
function gsPush(now){
  if(!GS) return;
  clearTimeout(GS.pushT);
  const go = async () => {
    if(!GS) return;
    GS.lastPush = Date.now();
    const me = GS.me;
    try{
      await gsRpc('gs_update', { p_group: GS.id, p: { answered: gsAnsweredN(), tabs: me.tabs, mic: gsMic(), cur: GS.cur >= 0 ? GS.cur : null,
        total_ms: Math.round(me.total), data: { ans: me.ans, t: me.t, log: me.log.slice(-30) }, done: !!me.done, why: me.why } });
    }catch(e){}
  };
  if(now) return go(); GS.pushT = setTimeout(go, Date.now() - GS.lastPush > 1500 ? 50 : 1500);
}
function gsStartPoll(){ gsStopPoll(); GS.poll = setInterval(gsPoll, 2000); }
function gsStopPoll(){ if(GS && GS.poll) clearInterval(GS.poll); }
async function gsPoll(){
  if(!GS || !$('group').classList.contains('active')) return;
  try{
    const st = await gsRpc('gs_state', { p_group: GS.id });
    if(!GS || st.id !== GS.id) return;
    if(Math.random() < 0.1) gsToken();
    GS_OFF = new Date(st.now).getTime() - Date.now();
    const was = GS.st.status; GS.st = st;
    const mine = (st.members || []).find(m => m.me);
    if(st.status === 'ended' && !GS.me.done){ GS.me.done = true; GS.me.why = (mine && mine.why) || 'host'; gsSaveMe(); }
    const sig = st.status + '|' + (st.members || []).map(m => m.uid + m.mic + m.away + m.done).join(',');
    if(was !== st.status || GS.view === 'results' || (GS.view === 'lobby' && sig !== GS.sig)) { GS.sig = sig; gsRender(); } else gsPaintStat();
  }catch(e){ if(/not in this group/i.test(e.message)){ gsStopPoll(); LS.del('stp_gs'); toast('You are no longer in this group.'); openGroupStudy(); } }
}
/* heartbeat: progress every 6 s while running */
setInterval(() => { if(GS && GS.st.status !== 'ended' && !GS.me.done && Date.now() - GS.lastPush > 6000) gsPush(true); }, 3000);

/* ---------------- views ---------------- */
function gsRender(){
  if(!GS) return;
  const s = GS.st.status;
  if(s === 'lobby') return gsLobby();
  if(s === 'ended' || GS.me.done) return gsResults();
  return gsRun();
}
function gsLobby(){
  GS.view = 'lobby';
  const st = GS.st, ms = st.members || [], micOk = gsMic() === 'on';
  const noMic = ms.filter(m => m.mic !== 'on' && !m.me).map(m => m.name);
  const lim = st.settings.limitSec ? `${fmt(st.settings.limitSec * 1000)} (${perTxt(st.settings.per)} per question)` : 'No limit';
  $('gsStat').hidden = true;
  $('gsMain').innerHTML = `
    <div class="card gs-lobby">
      <span class="paper-tag">GROUP STUDY · ${st.is_host ? 'YOU ARE THE HOST' : 'HOST: ' + esc(st.host_name).toUpperCase()}</span>
      <h1>${esc(st.title)}</h1>
      <div class="gs-codebox"><small>Group code</small><b>${esc(st.code)}</b><button type="button" class="btn small light" id="gsCopy">📋 Copy</button></div>
      <div class="gs-facts"><div><b>${st.n}</b><span>Questions</span></div><div><b>${lim}</b><span>Time</span></div><div><b>${st.settings.reveal === 'now' ? 'Immediately' : 'At the end'}</b><span>Answers shown</span></div><div><b>${GS_LIVES} ❤️</b><span>Lives</span></div></div>
      <div class="gs-microw ${micOk ? 'ok' : 'bad'}">${micOk ? '🎤 Your microphone is on <span class="gs-meter"><i id="gsMeter"></i></span>' : '🔇 Your microphone is off'}
        ${micOk ? '' : '<button type="button" class="btn small green" data-gsmic="1">Turn on mic</button>'}</div>
      <h3>In the group (${ms.length})</h3>
      <div class="gs-mlist">${ms.map(m => `<div class="gs-m${m.away ? ' away' : ''}"><span class="gs-av">${esc((m.name || '?')[0].toUpperCase())}</span><b>${esc(m.name)}${m.me ? ' (you)' : ''}</b>${m.host ? '<i class="gs-host">host</i>' : ''}${micIcon(m.me ? gsMic() : m.mic)}</div>`).join('')}</div>
      <p class="gs-note">Rules: keep your microphone on, stay on this screen — switching tab or app, minimising the browser, locking the phone or closing the page each costs a life; after ${GS_LIVES} your sheet is submitted, and finish before the time ends. The microphone is only checked — your voice is not recorded or sent.</p>
      <div class="gs-actions">
        <button type="button" class="btn light" id="gsLeave">${st.is_host ? 'Close group' : 'Leave group'}</button>
        ${st.is_host ? `<button type="button" class="btn green" id="gsStart"${micOk && !noMic.length && ms.length > 1 ? '' : ' disabled'}>▶ Start for everyone</button>` : '<span class="gs-wait">⏳ Waiting for the host to start…</span>'}
      </div>
      ${st.is_host && (noMic.length || ms.length < 2) ? `<p class="gs-note warn">${ms.length < 2 ? 'Share the code — nobody has joined yet. ' : ''}${noMic.length ? 'Mic off: <b>' + noMic.map(esc).join(', ') + '</b>. ' : ''}<button type="button" class="linkbtn" id="gsStartAny">Start anyway</button></p>` : ''}
    </div>`;
}

function gsQHTML(q, i){
  const opts = () => '<div class="opts' + (q.type === 'tf' ? ' tf' : '') + '">' + (q.opts || []).map((o, k) => `<button type="button" class="opt" data-k="${k}"><span class="ol">${q.type === 'tf' ? (k ? 'F' : 'T') : LET[k]}</span><span class="ot">${o}</span></button>`).join('') + '</div>';
  const now = GS.st.settings.reveal === 'now';
  const body = q.type === 'mcq' || q.type === 'tf' ? opts()
    : q.type === 'multi' ? opts() + `<div class="sq-multi"><button type="button" class="btn gs-msave">${now ? 'Check Answer' : 'Save Answer'}</button><span class="sq-hint">Select every correct option.</span></div>`
    : `<div class="sq-num"><input class="sq-in" type="text" inputmode="decimal" autocomplete="off" maxlength="14" placeholder="Type your answer" aria-label="Answer"><button type="button" class="btn sq-check">${now ? 'Check' : 'Save'}</button></div>`;
  const typ = { mcq: 'Single Correct', tf: 'True / False', multi: 'One or More Correct', num: 'Numerical Value' }[q.type] || '';
  return `<article class="card sq gsq" id="gq${i}" data-i="${i}">
    <div class="sq-head"><span class="sq-no">Q${i + 1}</span><span class="pill">${typ}</span><span class="sq-time" hidden></span><span class="sq-badge"></span></div>
    <div class="q-text">${q.q}</div>
    ${body}
    <div class="sq-fb" aria-live="polite"></div>
    ${now ? `<div class="sq-actions"><span class="grow"></span><button type="button" class="btn ghost small sq-solbtn" hidden aria-expanded="false">📘 View Solution</button></div>
    <div class="sq-sol"><div class="sq-sol-in"><div class="sq-sol-box"><h4>Solution</h4><div class="st">${q.sol || '<i>Solution not provided.</i>'}</div><p class="sq-ansline">Answer: <b>${esc(gsAnsText(q))}</b></p></div></div></div>` : ''}
  </article>`;
}
function gsRun(){
  GS.view = 'run';
  document.documentElement.style.setProperty('--gsTop', document.querySelector('#group .topbar').offsetHeight + 'px');
  const st = GS.st;
  $('gsMain').innerHTML = `
    <div class="card gs-runhead">
      <div class="gs-rh-l"><span class="paper-tag">GROUP STUDY · CODE ${esc(st.code)}</span><h1>${esc(st.title)}</h1>
        <div class="gs-rh-meta">${st.n} questions · answers ${st.settings.reveal === 'now' ? 'shown immediately' : 'shown at the end'}</div></div>
      <div class="gs-rh-r">
        <div class="gs-clock"><small id="gsClkL">Time</small><b id="gsClk">—</b></div>
        <div class="gs-lives" id="gsLives"></div>
        <div class="gs-micchip" title="Your microphone">🎤 <span class="gs-meter"><i id="gsMeMeter"></i></span></div>
      </div>
    </div>
    <div id="gsQs">${GS.Q.map(gsQHTML).join('')}</div>
    <div class="card gs-endcard">
      <p id="gsEndTxt"></p>
      <div class="gs-actions"><button type="button" class="btn green" id="gsSubmit">✓ Submit my sheet</button>
      ${st.is_host ? '<button type="button" class="btn red" id="gsEndAll">⏹ End for everyone</button>' : ''}</div>
    </div>
    <div class="gs-guard" id="gsGuard" hidden></div>
    <div class="gs-count" id="gsCount" hidden></div>`;
  GS.Q.forEach((q, i) => gsPaintQ(i));
  GS.me.inRun = true; gsSaveMe();
  typeset($('gsQs'));
  window.scrollTo(0, 0);
  $('gsStat').hidden = false;
  const minPref = LS.get('stp_gs_min', null);
  $('gsStat').classList.toggle('min', minPref === null ? innerWidth < 700 : !!minPref);
  gsPaintStat(); gsPaintMicGuard(); gsTickUI();
}
function gsPaintQ(i){
  const el = $('gq' + i); if(!el) return;
  const q = GS.Q[i], r = GS.me.ans[i], a = r ? r.a : null, has = a !== null && a !== undefined && a !== '';
  const now = GS.st.settings.reveal === 'now', locked = now && has, ok = locked ? gsCheck(q, a) : null;
  el.classList.toggle('is-ok', ok === true); el.classList.toggle('is-bad', ok === false); el.classList.toggle('is-sv', has && !now);
  if(q.type === 'num'){
    const inp = el.querySelector('.sq-in'), cb = el.querySelector('.sq-check');
    if(has) inp.value = a;
    inp.disabled = locked; cb.disabled = locked;
    inp.classList.toggle('ok', ok === true); inp.classList.toggle('bad', ok === false); inp.classList.toggle('sv', has && !now);
  } else {
    const sel = q.type === 'multi' ? (GS.sel[i] || (Array.isArray(a) ? a : [])) : null;
    el.querySelectorAll('.opt').forEach(b => {
      const k = +b.dataset.k, mine = has && (q.type === 'multi' ? a.indexOf(k) >= 0 : Number(a) === k);
      b.classList.toggle('correct', locked && mine && ok); b.classList.toggle('wrong', locked && mine && !ok);
      b.classList.toggle('dim', locked && !mine); b.disabled = locked;
      b.classList.toggle('sel', !locked && (q.type === 'multi' ? sel.indexOf(k) >= 0 : mine));
    });
    const ms = el.querySelector('.sq-multi'); if(ms) ms.hidden = locked;
  }
  el.querySelector('.sq-fb').innerHTML = locked ? (ok ? '<span class="fb-ok">🎉 Correct!</span>' : `<span class="fb-bad">✘ Not correct. Answer: <b>${esc(gsAnsText(q))}</b></span>`)
    : has ? '<span class="fb-sv">✓ Answer saved — you can change it until you submit.</span>' : '';
  el.querySelector('.sq-badge').innerHTML = locked ? (ok ? '<span class="sb-ok">✓ Correct</span>' : '<span class="sb-bad">✗ Wrong</span>') : has ? '<span class="sb-sv">● Answered</span>' : '';
  const sb = el.querySelector('.sq-solbtn'); if(sb) sb.hidden = !locked;
  gsPaintQTime(i);
}
function gsPaintQTime(i){
  const el = $('gq' + i); if(!el) return;
  const tm = el.querySelector('.sq-time'), ms = GS.me.t[i] || 0, per = GS.st.settings.per;
  if(!ms && GS.cur !== i){ tm.hidden = true; return; }
  tm.hidden = false;
  const r = GS.me.ans[i], running = GS.cur === i && !(r && r.a !== null && r.a !== '');
  tm.className = 'sq-time' + (per && ms > per * 1000 ? ' over' : '') + (running ? ' live' : '');
  tm.textContent = '⏱ ' + fmt(ms) + (per ? ' / ' + fmt(per * 1000) : '');
}
function gsPaintStat(){
  if(!GS || GS.view !== 'run') return;
  const ms = GS.st.members || [], n = GS.st.n;
  $('gsStatList').innerHTML = ms.map(m => {
    const tabs = m.me ? GS.me.tabs : (m.tabs || 0), ans = m.me ? gsAnsweredN() : (m.answered || 0), mic = m.me ? gsMic() : m.mic;
    const lives = Math.max(0, GS_LIVES - tabs);
    const why = { submit: 'submitted', lives: 'out of lives', time: 'time up', host: 'stopped' }[m.why] || 'finished';
    return `<div class="gst-m${m.me ? ' me' : ''}${m.away && !m.me ? ' away' : ''}">
      <div class="gst-top"><span class="gs-av">${esc((m.name || '?')[0].toUpperCase())}</span><b>${esc(m.name)}${m.me ? ' (you)' : ''}</b>${micIcon(mic)}</div>
      <div class="gst-bar"><i style="width:${n ? ans / n * 100 : 0}%"></i></div>
      <div class="gst-txt"><span><b>${ans}</b>/${n} answered</span><span class="gst-lv" title="Left the screen ${tabs} time${tabs === 1 ? '' : 's'}">${'❤️'.repeat(lives)}${'🤍'.repeat(GS_LIVES - lives)}</span></div>
      ${tabs ? `<div class="gst-warn">⚠️ Left the screen ${tabs}×</div>` : ''}
      ${m.done ? `<div class="gst-done">✓ ${why}</div>` : (m.away && !m.me ? '<div class="gst-away">● not responding</div>' : '')}
    </div>`;
  }).join('');
  const done = ms.filter(m => m.done).length;
  $('gsStatHd').textContent = `👥 Group · ${ms.length}`;
  $('gsPill').innerHTML = `<span>👥 ${ms.length} · you <b>${gsAnsweredN()}/${n}</b>${done ? ' · ' + done + ' done' : ''}</span><span class="ss-ex">▢</span>`;
}
function gsPaintLives(){
  const el = $('gsLives'); if(!el) return;
  const l = Math.max(0, GS_LIVES - GS.me.tabs);
  el.innerHTML = `<span>${'❤️'.repeat(l)}${'🤍'.repeat(GS_LIVES - l)}</span><small>${l} li${l === 1 ? 'fe' : 'ves'} left</small>`;
}
function gsPaintMicGuard(){
  if(!GS || GS.view !== 'run') return;
  const g = $('gsGuard'); if(!g) return;
  const m = gsMic();
  if(m === 'on' || GS.me.done){ g.hidden = true; return; }
  g.hidden = false;
  g.innerHTML = `<div class="card gs-guardc"><div class="gs-big">🔇</div><h2>Your microphone is ${m === 'muted' ? 'muted' : 'off'}</h2>
    <p>The microphone must stay on during Group Study. It is only checked — nothing is recorded or sent.</p>
    <button type="button" class="btn green" data-gsmic="1">🎤 Turn microphone on</button>
    <p class="gs-note">If nothing happens, allow the microphone for this site in the browser settings (🔒 next to the address).</p></div>`;
}

/* the question whose box is at about 40% of the screen is the one being solved */
function gsActiveQ(){
  const y = innerHeight * 0.42; let best = -1, bd = 1e9;
  for(let i = 0; i < GS.Q.length; i++){
    const el = $('gq' + i); if(!el) continue;
    const r = el.getBoundingClientRect();
    if(r.top <= y && r.bottom >= y) return i;
    const d = Math.min(Math.abs(r.top - y), Math.abs(r.bottom - y)); if(d < bd){ bd = d; best = i; }
  }
  return bd < 200 ? best : -1;
}
function gsTickUI(){
  if(!GS || GS.view !== 'run') return;
  const st = GS.st, now = gsNow(), start = new Date(st.started_at).getTime();
  const cnt = $('gsCount');
  if(now < start){ cnt.hidden = false; cnt.innerHTML = `<div><small>Starting in</small><b>${Math.ceil((start - now) / 1000)}</b></div>`; }
  else cnt.hidden = true;
  let lbl = 'Time taken', clk = fmt(Math.max(0, now - start)), cls = '';
  if(st.ends_at){
    const rem = new Date(st.ends_at).getTime() - now;
    lbl = 'Time left'; clk = fmt(Math.max(0, rem)); cls = rem < 60000 ? 'warn' : '';
    if(rem <= 0 && !GS.me.done){ gsSubmit('time'); return; }
  }
  $('gsClkL').textContent = lbl; const c = $('gsClk'); c.textContent = clk; c.className = cls;
  gsPaintLives();
  const ans = gsAnsweredN(), n = GS.Q.length;
  $('gsEndTxt').innerHTML = `You have answered <b>${ans}</b> of <b>${n}</b> questions.${n - ans ? ' ' + (n - ans) + ' not answered yet.' : ' 🎉 All done!'}`;
  const mtr = $('gsMeMeter'); if(mtr) mtr.style.width = Math.round(gsMicLevel() * 100) + '%';
}
setInterval(() => {
  if(!GS) return;
  if(GS.view === 'lobby'){ const m = $('gsMeter'); if(m) m.style.width = Math.round(gsMicLevel() * 100) + '%'; return; }
  if(GS.view !== 'run' || !$('group').classList.contains('active')){ GS.lastT = 0; return; }
  const t = performance.now(), dt = GS.lastT ? Math.min(2000, t - GS.lastT) : 0; GS.lastT = t;
  const started = gsNow() >= new Date(GS.st.started_at).getTime();
  const prev = GS.cur; GS.cur = started ? gsActiveQ() : -1;
  if(prev !== GS.cur && prev >= 0) gsPaintQTime(prev);
  if(started && !GS.me.done && document.visibilityState === 'visible' && gsMic() === 'on'){
    GS.me.total += dt;
    const r = GS.me.ans[GS.cur];
    if(GS.cur >= 0 && !(r && r.a !== null && r.a !== '')){ GS.me.t[GS.cur] = (GS.me.t[GS.cur] || 0) + dt; gsPaintQTime(GS.cur); }
    if(Math.random() < 0.1) gsSaveMe();
  }
  if(gsMic() !== 'on' && $('gsGuard') && $('gsGuard').hidden) { gsPaintMicGuard(); gsPush(); }
  gsTickUI();
}, 250);

/* ---------------- answering ---------------- */
function gsAnswer(i, a, x, y){
  if(!GS || GS.me.done || gsNow() < new Date(GS.st.started_at).getTime()) return;
  const q = GS.Q[i], now = GS.st.settings.reveal === 'now', r = GS.me.ans[i];
  if(now && r && r.a !== null && r.a !== '') return;
  GS.me.ans[i] = { a, ms: Math.round(GS.me.t[i] || 0) };
  delete GS.sel[i];
  gsSaveMe(); gsPaintQ(i); gsPaintStat(); gsPush();
  if(now){
    const ok = gsCheck(q, a), el = $('gq' + i);
    if(ok) burst(x, y, false); else { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
  }
}
function gsSubmit(why){
  if(!GS || GS.me.done) return;
  GS.me.done = true; GS.me.why = why;
  gsSaveMe(); gsPush(true);
  toast(why === 'lives' ? '❌ No lives left — your sheet has been submitted.' : why === 'time' ? "⏰ Time's up — your sheet has been submitted." : '✓ Your sheet has been submitted.', 5000);
  gsResults();
}

/* ---------------- leaving the screen ---------------- */
/* the page may be frozen right after it is hidden (phone home button, minimised browser),
   so the update goes out as a keep-alive request that the browser finishes on its own */
function gsBeacon(){
  if(!GS) return;
  const me = GS.me, body = JSON.stringify({ p_group: GS.id, p: { answered: gsAnsweredN(), tabs: me.tabs, mic: gsMic(), cur: GS.cur >= 0 ? GS.cur : null,
    total_ms: Math.round(me.total), data: { ans: me.ans, t: me.t, log: me.log.slice(-30) }, done: !!me.done, why: me.why } });
  GS.lastPush = Date.now();
  if(!GS.tok || !CFG.SUPABASE_URL){ gsPush(true); return; }
  try{
    fetch(CFG.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/gs_update', { method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', apikey: CFG.SUPABASE_KEY, Authorization: 'Bearer ' + GS.tok }, body }).catch(() => gsPush(true));
  }catch(e){ gsPush(true); }
}
async function gsToken(){ try{ const s = (await SB.auth.getSession()).data.session; if(GS && s) GS.tok = s.access_token; }catch(e){} }
let GS_LAST_SW = 0;
function gsTabSwitch(kind){
  if(!GS || GS.view !== 'run' || GS.me.done) return;
  if(gsNow() < new Date(GS.st.started_at).getTime()) return;
  const t = Date.now();
  if(t < GSM.ignoreBlurUntil || t - GS_LAST_SW < 2500) return;       // one switch is often both blur + hidden
  GS_LAST_SW = t; GS.me.lastSw = t;
  GS.me.tabs++; GS.me.log.push({ at: new Date(gsNow()).toISOString(), k: kind, q: GS.cur });
  gsSaveMe(); gsBeacon(); gsPaintStat(); gsPaintLives();
  const left = GS_LIVES - GS.me.tabs;
  if(left <= 0){ gsSubmit('lives'); return; }
  setTimeout(() => toast(`⚠️ You left the screen! ${left} li${left === 1 ? 'fe' : 'ves'} left. Everyone in the group can see it.`, 6000), 300);
}
// hidden: another tab, another app, home button, minimised browser, locked screen
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'hidden') gsTabSwitch('hidden'); else if(GS && GS.view === 'run'){ gsPaintMicGuard(); gsPush(true); } });
// blur while still visible: another window or app in front (PC), split screen (tablet)
window.addEventListener('blur', () => { setTimeout(() => { if(document.visibilityState === 'visible' && !document.hasFocus()) gsTabSwitch('blur'); }, 400); });
window.addEventListener('pagehide', () => { if(GS && GS.view === 'run') { GS.me.closedAt = Date.now(); gsSaveMe(); gsBeacon(); } });

/* ---------------- results ---------------- */
function gsMemberAns(m){
  if(m.me) return GS.me.ans;
  return (m.data && m.data.ans) || {};
}
function gsResults(){
  GS.view = 'results'; $('gsStat').hidden = true;
  const st = GS.st, Q = GS.Q, ended = st.status === 'ended';
  const ms = (st.members || []).map(m => {
    const A = gsMemberAns(m); let c = 0, w = 0, score = 0, time = 0;
    Q.forEach((q, i) => {
      const r = A[i], ok = r ? gsCheck(q, r.a) : null;
      if(ok === true){ c++; score += q.pos; } else if(ok === false){ w++; score += q.neg; }
      time += r && r.ms ? r.ms : 0;
    });
    const tot = m.me ? GS.me.total : (m.total_ms || 0);
    return { m, A, c, w, u: Q.length - c - w, score, tot, tabs: m.me ? GS.me.tabs : m.tabs };
  });
  const rank = ms.slice().sort((a, b) => b.score - a.score || b.c - a.c || a.tot - b.tot);
  const maxS = Q.reduce((t, q) => t + q.pos, 0);
  const why = w => ({ submit: 'Submitted', lives: '❤️ Out of lives', time: '⏰ Time up', host: 'Ended by host' }[w] || '—');
  const waiting = (st.members || []).filter(m => !m.done).map(m => m.name);
  let h = `<div class="card gs-reshead"><span class="paper-tag">GROUP STUDY · CODE ${esc(st.code)}</span><h1>${esc(st.title)}</h1>
      <p>${ended ? '🏁 Session over' : '⏳ You have submitted. Waiting for: <b>' + waiting.map(esc).join(', ') + '</b> — results update automatically.'}</p>
      ${!ended && st.is_host ? '<button type="button" class="btn red small" id="gsEndAll">⏹ End for everyone now</button>' : ''}</div>`;
  if(!ended){
    const me = ms.find(x => x.m.me);
    h += `<div class="card gs-mine"><h3>Your sheet</h3><div class="gs-facts"><div><b>${me.c}</b><span>Correct</span></div><div><b>${me.w}</b><span>Wrong</span></div><div><b>${me.u}</b><span>Not attempted</span></div><div><b>${me.score}/${maxS}</b><span>Marks</span></div></div>
      <p class="gs-note">Everyone's marks and the question-by-question summary appear here when the session ends.</p></div>`;
    $('gsMain').innerHTML = h; return;
  }
  h += `<div class="card gs-board"><h2>🏆 Marks</h2><div class="tbl-wrap"><table class="tbl gs-tbl"><thead><tr><th>#</th><th>Name</th><th>Marks</th><th>✓ Correct</th><th>✗ Wrong</th><th>Not attempted</th><th>Time</th><th>Left screen</th><th>Finished</th></tr></thead><tbody>
    ${rank.map((x, k) => `<tr class="${x.m.me ? 'me' : ''}"><td>${['🥇', '🥈', '🥉'][k] || k + 1}</td><td><b>${esc(x.m.name)}</b>${x.m.me ? ' (you)' : ''}</td><td><b>${x.score}</b>/${maxS}</td><td class="g">${x.c}</td><td class="r">${x.w}</td><td>${x.u}</td><td>${fmt(x.tot)}</td><td>${x.tabs ? '⚠️ ' + x.tabs : '0'}</td><td>${why(x.m.why)}</td></tr>`).join('')}
    </tbody></table></div><p class="gs-note">Marks: +${Q[0] ? Q[0].pos : 4} for a correct answer${Q.some(q => q.neg) ? ', negative marks as in the exam for a wrong one' : ''}, 0 if not attempted.</p></div>`;
  h += `<h2 class="gs-h2">📋 Question by question</h2><div class="gs-qsum">`;
  Q.forEach((q, i) => {
    const rows = rank.map(x => { const r = x.A[i], ok = r ? gsCheck(q, r.a) : null; return { x, r, ok }; });
    const nc = rows.filter(y => y.ok === true).length, times = rows.filter(y => y.r && y.r.ms).map(y => y.r.ms);
    const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;
    h += `<div class="card gs-qs" id="gsr${i}">
      <div class="gs-qs-h"><b>Q${i + 1}</b><span class="gs-qs-c ${nc === rows.length ? 'all' : nc ? '' : 'none'}">${nc}/${rows.length} correct</span>${avg ? `<span class="gs-qs-t">avg ⏱ ${fmt(avg)}</span>` : ''}
        <button type="button" class="btn ghost small" data-gsq="${i}">📘 Question &amp; solution</button></div>
      <div class="gs-chips">${rows.map(y => `<span class="gs-chip ${y.ok === true ? 'ok' : y.ok === false ? 'bad' : 'na'}"><b>${esc(y.x.m.name)}</b> ${y.ok === true ? '✓' : y.ok === false ? '✗ ' + esc(gsAText(q, y.r.a)) : '—'}${y.r && y.r.ms ? ' · ' + fmt(y.r.ms) : ''}</span>`).join('')}</div>
      <div class="gs-qbody" hidden><div class="q-text">${q.q}</div>
        ${(q.opts || []).length ? '<ol class="gs-opts" type="A">' + q.opts.map(o => `<li>${o}</li>`).join('') + '</ol>' : ''}
        <div class="sq-sol-box"><h4>Solution</h4><div class="st">${q.sol || '<i>Solution not provided.</i>'}</div><p class="sq-ansline">Answer: <b>${esc(gsAnsText(q))}</b></p>${q.src ? `<p class="pq-src">${esc(q.src)}</p>` : ''}</div></div>
    </div>`;
  });
  h += `</div><div class="gs-actions center"><button type="button" class="btn" data-gsback="1">← Group Study home</button></div>`;
  $('gsMain').innerHTML = h;
  LS.del('stp_gs');
}

/* ---------------- events ---------------- */
$('group').addEventListener('click', async e => {
  const t = e.target;
  if(t.closest('#gsBack') || t.closest('[data-gsback]')){
    if(GS && GS.view === 'run' && !GS.me.done){ toast('Submit your sheet first (or keep solving) — the session is running.'); return; }
    gsStopPoll(); GS = null; $('gsStat').hidden = true;
    if(t.closest('[data-gsback]')) return openGroupStudy();
    go({ level: 'home' }); return;
  }
  if(t.closest('#gsJoinBtn')) return gsJoin();
  if(t.closest('#gsNewBtn')) return gsCreateForm();
  if(t.closest('#gcCancel')) return openGroupStudy();
  if(t.closest('#gcCreate')) return gsCreate();
  const op = t.closest('[data-gsopen]'); if(op) return gsEnter(op.dataset.gsopen);
  const kb = t.closest('#gcKind button');
  if(kb){ GSC.kind = kb.dataset.k; $('gcKind').querySelectorAll('button').forEach(b => b.classList.toggle('on', b === kb));
    $('gcSheet').hidden = GSC.kind !== 'sheet'; $('gcPaper').hidden = GSC.kind !== 'paper'; $('gcPyq').hidden = GSC.kind !== 'pyq'; return; }
  if(t.closest('[data-gsmic]')){ if(await gsMicStart()){ if(GS && GS.view === 'lobby') gsLobby(); gsPaintMicGuard(); gsPush(true); toast('🎤 Microphone is on.'); } return; }
  if(t.closest('#gsCopy')){ try{ await navigator.clipboard.writeText(GS.st.code); toast('Code copied: ' + GS.st.code); }catch(err){ toast('Code: ' + GS.st.code); } return; }
  if(t.closest('#gsLeave')){ if(!confirm(GS.st.is_host ? 'Close this group for everyone?' : 'Leave this group?')) return;
    try{ await gsRpc('gs_leave', { p_group: GS.id }); }catch(err){} LS.del('stp_gs'); gsStopPoll(); GS = null; return openGroupStudy(); }
  if(t.closest('#gsStart') || t.closest('#gsStartAny')){
    if(gsMic() !== 'on' && !await gsMicStart()) return;
    try{ await gsRpc('gs_start', { p_group: GS.id }); await gsPoll(); }catch(err){ toast(err.message, 5000); } return; }
  if(t.closest('#gsSubmit')){
    const b = t.closest('#gsSubmit');
    if(Date.now() - GS.subTap > 4000){ GS.subTap = Date.now(); b.textContent = 'Tap again to submit'; setTimeout(() => { if(b.isConnected) b.textContent = '✓ Submit my sheet'; }, 4000); return; }
    return gsSubmit('submit'); }
  if(t.closest('#gsEndAll')){
    const b = t.closest('#gsEndAll');
    if(Date.now() - GS.endTap > 4000){ GS.endTap = Date.now(); b.textContent = 'Tap again to end for everyone'; setTimeout(() => { if(b.isConnected) b.textContent = '⏹ End for everyone'; }, 4000); return; }
    if(!GS.me.done){ GS.me.done = true; GS.me.why = 'host'; gsSaveMe(); await gsPush(true); }
    try{ await gsRpc('gs_end', { p_group: GS.id }); await gsPoll(); gsRender(); }catch(err){ toast(err.message, 5000); } return; }
  if(t.closest('#gsMin')){ $('gsStat').classList.add('min'); LS.set('stp_gs_min', true); return; }
  if(t.closest('#gsPill')){ $('gsStat').classList.remove('min'); LS.set('stp_gs_min', false); return; }
  const qb = t.closest('[data-gsq]');
  if(qb){ const body = qb.closest('.gs-qs').querySelector('.gs-qbody'); body.hidden = !body.hidden; if(!body.hidden) typeset(body); return; }
  /* answering */
  const card = t.closest('.gsq'); if(!card || !GS) return;
  const i = +card.dataset.i, q = GS.Q[i];
  const opt = t.closest('.opt');
  if(opt && !opt.disabled){
    const k = +opt.dataset.k;
    if(q.type === 'multi'){
      const cur = GS.sel[i] || (GS.me.ans[i] && Array.isArray(GS.me.ans[i].a) ? GS.me.ans[i].a.slice() : []), j = cur.indexOf(k);
      if(j >= 0) cur.splice(j, 1); else cur.push(k);
      GS.sel[i] = cur; opt.classList.toggle('sel', j < 0); card.querySelector('.sq-fb').innerHTML = ''; return;
    }
    const r = opt.getBoundingClientRect(); return gsAnswer(i, k, e.clientX || r.left + 24, e.clientY || r.top + r.height / 2);
  }
  if(t.closest('.gs-msave')){
    const S = (GS.sel[i] || []).slice().sort((a, b) => a - b);
    if(!S.length){ card.querySelector('.sq-fb').innerHTML = '<span class="fb-bad">Select at least one option first.</span>'; return; }
    const r = t.closest('.gs-msave').getBoundingClientRect(); return gsAnswer(i, S, r.left + r.width / 2, r.top + r.height / 2);
  }
  if(t.closest('.sq-check')) return gsCheckNum(i, card);
  const sb = t.closest('.sq-solbtn');
  if(sb){ const open = !card.classList.contains('sol-open'); card.classList.toggle('sol-open', open); sb.innerHTML = open ? '📕 Hide Solution' : '📘 View Solution'; if(open) typeset(card.querySelector('.sq-sol')); }
});
function gsCheckNum(i, card){
  const inp = card.querySelector('.sq-in'), v = inp.value.trim();
  if(!/^-?\d+(\.\d+)?$/.test(v) && !/^-?\.\d+$/.test(v)){ card.querySelector('.sq-fb').innerHTML = '<span class="fb-bad">Please type a number (e.g. 12, -3 or 2.5).</span>'; inp.focus(); return; }
  const r = card.querySelector('.sq-check').getBoundingClientRect(); gsAnswer(i, v, r.left + r.width / 2, r.top + r.height / 2);
}
$('group').addEventListener('keydown', e => {
  if(e.key === 'Enter' && e.target.id === 'gsCode'){ e.preventDefault(); gsJoin(); }
  if(e.key === 'Enter' && e.target.classList.contains('sq-in')){ e.preventDefault(); const c = e.target.closest('.gsq'); if(c) gsCheckNum(+c.dataset.i, c); }
});
$('group').addEventListener('change', e => {
  if(!GSC) return;
  const t = e.target;
  if(t.id === 'gcExam'){ GSC.exam = t.value; GSC.units = []; gsPaintPyqUnits(); }
  else if(t.id === 'gcMrq'){ GSC.mrq = t.checked; gsPaintPyqUnits(); }
  else if(t.id === 'gcYears') GSC.years = t.value;
  else if(t.dataset.u){ const i = GSC.units.indexOf(t.dataset.u); if(t.checked && i < 0) GSC.units.push(t.dataset.u); if(!t.checked && i >= 0) GSC.units.splice(i, 1); }
});
$('group').addEventListener('input', e => { if(e.target.id === 'gsCode') e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); });
const gsOpenBtn = $('gsOpen'); if(gsOpenBtn) gsOpenBtn.addEventListener('click', openGroupStudy);
