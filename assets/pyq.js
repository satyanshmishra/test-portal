/* =====================================================================
   IIT JEE PYQs PRACTICE
   Folder "IIT JEE PYQs Practice" → JEE Main / JEE Advanced → All PYQs / Most Repeated.
   The question bank is static JSON in pyq/<exam>/:
     index.json            units, sub-topics, most-repeated concepts, counts
     NN_<unit>.json        the questions of one unit (loaded only when needed)
   Left menu: topics → sub-topics (multi-select), years, question type, my status, search.
   Questions open practice-sheet style: tap an option → green / red, try again, view solution.
   Progress is kept on this device per student (like Practice Sheets).
   ===================================================================== */
const PYQ_EXAMS = [
  { id: 'main', title: 'JEE Main',     icon: '📗', desc: 'AIEEE + JEE Main previous year questions' },
  { id: 'adv',  title: 'JEE Advanced', icon: '📕', desc: 'IIT-JEE + JEE Advanced previous year questions' }
];
const PYQ_TYPES = { mcq: 'Single Correct', multi: 'One or More Correct', num: 'Numerical Value', match: 'Match the Following', tf: 'True / False', fill: 'Fill in the Blank', sub: 'Subjective' };
const PYQ_TYPE_ORDER = ['mcq', 'multi', 'num', 'match', 'tf', 'fill', 'sub'];
const PYQ_SELF = { fill: 1, match: 1, sub: 1 };          // no auto-check: the answer is shown and the student marks it
const pyqOptType = t => t === 'mcq' || t === 'tf';        // one tap answers
const PYQ_MODES = { all: { title: 'All PYQs', icon: '🗂️' }, mrq: { title: 'Most Repeated', icon: '🔥' } };
const PYQ_IDX = {};            // exam → index.json (null = not available)
const PYQ_UNITS = {};          // exam:unitId → unit file
let PQ = null;                 // the open PYQ screen: {exam, mode, idx, f (filters), list}

const pyqShowSrc = () => CFG.PYQ_SHOW_SOURCE !== false;
const pyqKey = () => 'stp_pyq_' + ((USER && USER.id) || 'x');
let PYQ_PROG = null, PYQ_PROG_K = '';
function pyqProg(){ if(!PYQ_PROG || PYQ_PROG_K !== pyqKey()){ PYQ_PROG_K = pyqKey(); PYQ_PROG = LS.get(PYQ_PROG_K, {}) || {}; } return PYQ_PROG; }
function pyqSaveProg(){ LS.set(pyqKey(), PYQ_PROG || {}); LS.set(pyqKey() + '_dirty', true); pyqSyncSoon(); }

/* ---------- progress saved in the student's account (backend/pyq_progress.sql) ----------
   Loaded once per login when the PYQ page opens; every change is sent a few seconds later.
   Changes made on this device that have not reached the server yet win over the server copy. */
const PYQ_SYNC = { k: '', t: 0, off: false, busy: false, again: false, tok: '' };
function pyqMerge(srv, loc){
  const out = Object.assign({}, srv);
  Object.keys(loc).forEach(k => {
    if(k.charAt(0) === '_' && loc[k] && typeof loc[k] === 'object') out[k] = Object.assign({}, srv[k] || {}, loc[k]);
    else out[k] = loc[k];
  });
  return out;
}
async function pyqSyncLoad(){
  if(PYQ_SYNC.off || !SB || !USER || !USER.id || PYQ_SYNC.k === pyqKey()) return;
  try{
    const r = await Promise.race([SB.rpc('pyq_prog_get'), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))]);
    if(r.error){ if(/Could not find the function|does not exist/i.test(r.error.message || '')) PYQ_SYNC.off = true; return; }
    const srv = (r.data && typeof r.data === 'object') ? r.data : {}, loc = pyqProg();
    const dirty = !!LS.get(pyqKey() + '_dirty', false);
    PYQ_PROG = dirty ? pyqMerge(srv, loc) : (Object.keys(srv).length ? srv : loc);
    PYQ_PROG_K = pyqKey(); LS.set(pyqKey(), PYQ_PROG);
    PYQ_SYNC.k = pyqKey();
    if(dirty || (!Object.keys(srv).length && Object.keys(loc).length)) pyqSyncPush();
  }catch(e){ /* offline: keep working on this device, try again next time */ }
}
function pyqSyncSoon(){ if(PYQ_SYNC.off || !SB) return; clearTimeout(PYQ_SYNC.t); PYQ_SYNC.t = setTimeout(pyqSyncPush, 3000); }
async function pyqSyncPush(){
  if(PYQ_SYNC.off || !SB || !USER || PYQ_SYNC.k !== pyqKey()) return;      // never overwrite the account before it was loaded
  if(PYQ_SYNC.busy){ PYQ_SYNC.again = true; return; }
  PYQ_SYNC.busy = true;
  try{
    const r = await SB.rpc('pyq_prog_put', { p_data: PYQ_PROG || {} });
    if(r.error){ if(/Could not find the function|does not exist/i.test(r.error.message || '')) PYQ_SYNC.off = true; }
    else LS.set(pyqKey() + '_dirty', false);
  }catch(e){}
  PYQ_SYNC.busy = false;
  if(PYQ_SYNC.again){ PYQ_SYNC.again = false; pyqSyncSoon(); }
}
/* leaving the page (phone home button, closing the tab): send what is pending right away */
document.addEventListener('visibilitychange', async () => {
  if(document.visibilityState !== 'hidden' || PYQ_SYNC.off || !SB || PYQ_SYNC.k !== pyqKey() || !LS.get(pyqKey() + '_dirty', false)) return;
  clearTimeout(PYQ_SYNC.t);
  try{
    const tok = PYQ_SYNC.tok || ((await SB.auth.getSession()).data.session || {}).access_token;
    const body = JSON.stringify({ p_data: PYQ_PROG || {} });
    if(!tok || body.length > 60000) return;                 // keep-alive requests are limited to 64 KB; the next visit sends it instead
    fetch(CFG.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/pyq_prog_put', { method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', apikey: CFG.SUPABASE_KEY, Authorization: 'Bearer ' + tok },
      body }).then(r => { if(r.ok) LS.set(pyqKey() + '_dirty', false); }).catch(() => {});
  }catch(e){}
});
/* the student's own 1–3 star rating of a question (kept with the progress, key _star) */
const pyqStar = id => ((pyqProg()._star || {})[id]) || 0;
const STAR_TXT = { 1: '★ 1 star', 2: '★★ 2 stars', 3: '★★★ 3 stars' };
function starOk(f, id){ const S = f.stars || []; if(!S.length) return true; const r = pyqStar(id); return S.indexOf(r ? String(r) : '0') >= 0; }

async function pyqIndex(exam){
  if(exam in PYQ_IDX) return PYQ_IDX[exam];
  try{
    const r = await fetch('pyq/' + exam + '/index.json?t=' + Math.floor(Date.now() / 600000), { cache: 'no-cache' });
    PYQ_IDX[exam] = r.ok ? await r.json() : null;
  }catch(e){ PYQ_IDX[exam] = null; }
  return PYQ_IDX[exam];
}
async function pyqLoadUnits(exam, ids){
  const idx = PYQ_IDX[exam];
  const need = ids.filter(id => !PYQ_UNITS[exam + ':' + id]);
  if(!need.length) return;
  await Promise.all(need.map(async id => {
    const u = idx.units.find(x => x.id === id);
    const r = await fetch('pyq/' + exam + '/' + u.file + '?v=' + encodeURIComponent(idx.version || ''));
    if(!r.ok) throw new Error('load ' + u.file);
    const d = await r.json();
    d.questions.forEach((q, k) => { q._u = id; q._k = k; });
    PYQ_UNITS[exam + ':' + id] = d;
  }));
}
const pyqSolvedOf = idx => { const P = pyqProg(); let n = 0; for(const k in P) if(P[k].ok && k.indexOf(idx.prefix || '') === 0) n++; return n; };

/* ---------- folder cards (inside the normal folder screen) ---------- */
function pyqFolderCard(f){
  if(!PYQ_EXAMS.every(x => x.id in PYQ_IDX)){ Promise.all(PYQ_EXAMS.map(x => pyqIndex(x.id))).then(() => { if(VIEW.level === 'home' && $('papers').classList.contains('active')) renderPapers(); }); }
  const idxs = PYQ_EXAMS.map(x => PYQ_IDX[x.id]).filter(Boolean);
  const n = idxs.reduce((a, i) => a + i.total, 0);
  return folderCard(f.icon || '🎯', f.title, f.desc || '', n, idxs.reduce((a, i) => a + pyqSolvedOf(i), 0), { level: 'pyq' }, n ? '' : 'Open', 'question')
    .replace(/ empty-f/, '').replace(/(\d+) questions? · (\d+) done/, '$1 PYQs · $2 solved').replace(/(\d+) questions?</, '$1 PYQs<');
}
async function renderPyqFolders(){
  const grid = $('paperGrid'); grid.classList.add('folder-grid');
  const fTitle = (FOLDERS.find(x => x.pyq) || {}).title || 'IIT JEE PYQs Practice';
  if(!VIEW.exam){
    crumbs([{ label: 'All Folders', view: { level: 'home' } }, { label: fTitle }]);
    $('listTitle').textContent = fTitle;
    $('listSub').textContent = 'Practise previous year questions by year, topic and sub-topic.';
    await Promise.all(PYQ_EXAMS.map(x => pyqIndex(x.id)));
    if(VIEW.level !== 'pyq' || VIEW.exam) return;
    grid.innerHTML = PYQ_EXAMS.map(x => {
      const idx = PYQ_IDX[x.id];
      if(!idx) return folderCard(x.icon, x.title, x.desc, 0, 0, {}, 'Coming soon').replace(/ data-go='[^']*'/, ' disabled');
      return folderCard(x.icon, x.title, x.desc, idx.total, pyqSolvedOf(idx), { level: 'pyq', exam: x.id }, '', 'question')
        .replace(/(\d+) questions?/, '$1 PYQs').replace(/ · (\d+) done/, ' · $1 solved');
    }).join('');
    return;
  }
  const ex = PYQ_EXAMS.find(x => x.id === VIEW.exam) || PYQ_EXAMS[0];
  crumbs([{ label: 'All Folders', view: { level: 'home' } }, { label: fTitle, view: { level: 'pyq' } }, { label: ex.title }]);
  $('listTitle').textContent = ex.title + ' PYQs';
  const idx = await pyqIndex(ex.id);
  if(!idx){ $('listSub').textContent = ''; grid.innerHTML = '<div class="card empty" style="grid-column:1/-1">These PYQs are being added. Please check again soon.</div>'; return; }
  const yrs = idx.years || [];
  $('listSub').textContent = `${idx.total} questions · ${idx.units.length} topics` + (yrs.length ? ` · ${Math.min(...yrs)}–${Math.max(...yrs)}` : '');
  const nM = idx.units.reduce((a, u) => a + (u.nMrq || 0), 0);
  grid.innerHTML =
    folderCard(PYQ_MODES.all.icon, 'All PYQs', 'Choose topics, sub-topics, years and question type from the menu', idx.total, 0, {}, '', 'question').replace(/data-go=/, `data-pyq='${esc(JSON.stringify({ exam: ex.id, mode: 'all' }))}' data-x=`) +
    (nM ? folderCard(PYQ_MODES.mrq.icon, 'Most Repeated', 'Concepts asked again and again — grouped concept-wise', nM, 0, {}, '', 'question').replace(/data-go=/, `data-pyq='${esc(JSON.stringify({ exam: ex.id, mode: 'mrq' }))}' data-x=`)
        : folderCard(PYQ_MODES.mrq.icon, 'Most Repeated', 'Concepts asked again and again — grouped concept-wise', 0, 0, {}, 'Coming soon').replace(/ data-go='[^']*'/, ' disabled'));
}
$('papers').addEventListener('click', e => {
  const p = e.target.closest('[data-pyq]'); if(!p) return;
  e.stopPropagation(); const o = JSON.parse(p.dataset.pyq); openPyq(o.exam, o.mode);
}, true);

/* ---------- filters ---------- */
const PF_DEF = () => ({ units: [], subs: [], years: [], types: [], status: [], stars: [], q: '', sort: 'new', per: 20, page: 0 });
const pfKey = (exam, mode) => 'stp_pyq_f_' + exam + '_' + mode;

async function openPyq(exam, mode){
  busy(true, 'Loading PYQs…');
  try{
    const idx = await pyqIndex(exam);
    if(!idx) throw new Error('no index');
    const f = Object.assign(PF_DEF(), mode === 'mrq' ? { sort: 'book' } : {}, LS.get(pfKey(exam, mode), {}) || {});
    f.units = f.units.filter(id => idx.units.some(u => u.id === id));
    PQ = { exam, mode, idx, f, list: [] };
    await Promise.all([pyqLoadUnits(exam, pyqNeededUnits()), pyqSyncLoad()]);
    try{ PYQ_SYNC.tok = ((await SB.auth.getSession()).data.session || {}).access_token || ''; }catch(e){}
    $('pyqTopT').textContent = (PYQ_EXAMS.find(x => x.id === exam) || {}).title + ' · ' + PYQ_MODES[mode].title;
    renderPyqSide(); applyPyq(true);
    busy(false); show('pyq'); document.documentElement.style.setProperty('--pqTop', document.querySelector('#pyq .topbar').offsetHeight + 'px');
  }catch(err){ busy(false); toast('Could not load the PYQs. Please check your internet and try again.'); }
}
/* units that must be loaded: the chosen ones, or all when none is chosen */
function pyqNeededUnits(){
  const f = PQ.f, idx = PQ.idx;
  const chosen = new Set(f.units);
  f.subs.forEach(s => chosen.add(s.split('|')[0]));
  const ids = chosen.size ? [...chosen] : idx.units.map(u => u.id);
  return ids.filter(id => PQ.mode !== 'mrq' || (idx.units.find(u => u.id === id) || {}).nMrq);
}
const subList = u => PQ.mode === 'mrq' ? (u.mrq || []) : (u.subs || []);
const subOf = q => PQ.mode === 'mrq' ? q.mrq : q.sub;

function pyqFiltered(){
  const f = PQ.f, P = pyqProg();
  const units = pyqNeededUnits();
  const subsBy = {};
  f.subs.forEach(s => { const [u, id] = s.split('|'); (subsBy[u] = subsBy[u] || new Set()).add(id); });
  const yrs = new Set(f.years.map(Number)), types = new Set(f.types), st = new Set(f.status);
  const words = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let out = [];
  units.forEach(uid => {
    const U = PYQ_UNITS[PQ.exam + ':' + uid]; if(!U) return;
    const fullUnit = f.units.indexOf(uid) >= 0 || !f.units.length && !f.subs.length;
    U.questions.forEach(q => {
      if(PQ.mode === 'mrq' && !q.mrq) return;
      if(!fullUnit && !(subsBy[uid] && subsBy[uid].has(String(subOf(q))))) return;
      if(yrs.size && !yrs.has(Number(q.yr))) return;
      if(types.size && !types.has(q.type)) return;
      if(st.size){ const r = P[q.id]; const s = !r ? 'new' : (r.ok ? 'ok' : 'bad'); if(!st.has(s)) return; }
      if(!starOk(f, q.id)) return;
      if(words.length){ const t = (q.q + ' ' + (q.opts || []).join(' ')).toLowerCase(); if(!words.every(w => t.indexOf(w) >= 0)) return; }
      out.push(q);
    });
  });
  const uOrd = id => PQ.idx.units.findIndex(u => u.id === id);
  const dkey = q => (q.d || String(q.yr)) + '#' + (q.sh || 0);
  if(f.sort === 'new') out.sort((a, b) => dkey(b).localeCompare(dkey(a)) || uOrd(a._u) - uOrd(b._u) || a._k - b._k);
  else if(f.sort === 'old') out.sort((a, b) => dkey(a).localeCompare(dkey(b)) || uOrd(a._u) - uOrd(b._u) || a._k - b._k);
  else if(f.sort === 'shuffle'){
    let seed = f.seed || 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    out = out.map(q => [rnd(), q]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  } else {                       // book order: unit → sub-topic (or concept) → book number
    const so = {};
    PQ.idx.units.forEach(u => subList(u).forEach((s, k) => so[u.id + '|' + s.id] = k));
    out.sort((a, b) => uOrd(a._u) - uOrd(b._u) || (so[a._u + '|' + subOf(a)] ?? 999) - (so[b._u + '|' + subOf(b)] ?? 999)
      || (PQ.mode === 'mrq' ? dkey(b).localeCompare(dkey(a)) : 0) || a._k - b._k);
  }
  return out;
}
function savePf(){ const f = Object.assign({}, PQ.f); f.page = PQ.f.page; LS.set(pfKey(PQ.exam, PQ.mode), f); }
async function applyPyq(keepPage){
  if(!keepPage) PQ.f.page = 0;
  const need = pyqNeededUnits().filter(id => !PYQ_UNITS[PQ.exam + ':' + id]);
  if(need.length){
    $('pyqList').innerHTML = '<div class="card empty">Loading questions…</div>';
    try{ await pyqLoadUnits(PQ.exam, need); }catch(e){ toast('Could not load some topics. Please check your internet.'); }
  }
  PQ.list = pyqFiltered();
  const pages = Math.max(1, Math.ceil(PQ.list.length / PQ.f.per));
  if(PQ.f.page >= pages) PQ.f.page = pages - 1;
  savePf(); renderPyqHead(); renderPyqList(); paintSideCounts();
}

/* ---------- left menu ---------- */
const QUICK_YEARS = [
  { k: 'l3', t: 'Last 3 years', n: 3 }, { k: 'l5', t: 'Last 5 years', n: 5 },
  { k: 'on', t: '2019 onwards', from: 2019 }, { k: 'all', t: 'All years' }
];
function renderPyqSide(){
  const idx = PQ.idx, f = PQ.f, mrq = PQ.mode === 'mrq';
  const units = idx.units.filter(u => !mrq || u.nMrq);
  const yrs = (idx.years || []).slice().sort((a, b) => b - a);
  const nM = idx.units.reduce((a, u) => a + (u.nMrq || 0), 0);
  $('pyqSide').innerHTML = `
    <div class="ps-top"><b>Filters</b><button type="button" class="linkbtn" data-pf="resetAll">Reset all</button>
      <button type="button" class="ps-close" data-pf="close" aria-label="Close filters">✕</button></div>
    <div class="ps-mode">
      <button type="button" class="${mrq ? '' : 'on'}" data-pmode="all">🗂️ All PYQs</button>
      <button type="button" class="${mrq ? 'on' : ''}" data-pmode="mrq"${nM ? '' : ' disabled title="Coming soon"'}>🔥 Most Repeated</button>
    </div>
    <label class="ps-search"><span>🔎</span><input type="search" id="pfQ" placeholder="Search in questions" value="${esc(f.q)}" autocomplete="off"></label>
    <details class="ps-sec" open><summary>${mrq ? 'Topics & concepts' : 'Topics & sub-topics'} <span class="ps-hint" id="psTopicHint"></span></summary>
      <div class="ps-links"><button type="button" class="linkbtn" data-pf="unitsAll">All topics</button>
        <button type="button" class="linkbtn" data-pf="unitsOpen">Expand all</button><button type="button" class="linkbtn" data-pf="unitsClose">Collapse</button></div>
      <div class="ps-units">${units.map(u => `
        <div class="pu" data-u="${esc(u.id)}">
          <div class="pu-row">
            <label class="ck"><input type="checkbox" data-unit="${esc(u.id)}"><span>${esc(u.title)}</span></label>
            <span class="pc" data-cu="${esc(u.id)}"></span>
            ${subList(u).length ? `<button type="button" class="pu-tg" data-tg="${esc(u.id)}" aria-label="Show ${mrq ? 'concepts' : 'sub-topics'} of ${esc(u.title)}">▸</button>` : ''}
          </div>
          <div class="pu-subs" hidden>${subList(u).map(s => `
            <label class="ck sub"><input type="checkbox" data-sub="${esc(u.id + '|' + s.id)}"><span>${esc(s.title)}</span><span class="pc">${s.n || ''}</span></label>`).join('')}
          </div>
        </div>`).join('')}
      </div>
    </details>
    <details class="ps-sec" open><summary>Year <span class="ps-hint" id="psYearHint"></span></summary>
      <div class="ps-quick">${QUICK_YEARS.map(x => `<button type="button" class="qb" data-qy="${x.k}">${x.t}</button>`).join('')}</div>
      <div class="ps-years">${yrs.map(y => `<button type="button" class="yb" data-yr="${y}">${y}</button>`).join('')}</div>
    </details>
    <details class="ps-sec" open><summary>Question type</summary>
      ${PYQ_TYPE_ORDER.filter(t => (idx.types || { mcq: 1, num: 1 })[t]).map(t => `<label class="ck"><input type="checkbox" data-type="${t}"><span>${PYQ_TYPES[t]}</span><span class="pc">${(idx.types || {})[t] || ''}</span></label>`).join('')}
    </details>
    <details class="ps-sec" open><summary>My progress</summary>
      <label class="ck"><input type="checkbox" data-st="new"><span>Not attempted</span></label>
      <label class="ck"><input type="checkbox" data-st="bad"><span>Got wrong</span></label>
      <label class="ck"><input type="checkbox" data-st="ok"><span>Solved correctly</span></label>
    </details>
    <details class="ps-sec" open><summary>My stars ⭐</summary>
      ${[3, 2, 1].map(k => `<label class="ck"><input type="checkbox" data-sf="${k}"><span class="sf-st">${'★'.repeat(k)}<i>${'★'.repeat(3 - k)}</i></span><span>${k} star${k > 1 ? 's' : ''}</span><span class="pc" data-sfc="${k}"></span></label>`).join('')}
      <label class="ck"><input type="checkbox" data-sf="0"><span>No star yet</span></label>
      <p class="ps-tip">Tap ☆ on any question to give it 1, 2 or 3 stars and build your own set.</p>
    </details>
    <div class="ps-foot"><button type="button" class="btn green" data-pf="close">Show questions</button></div>`;
  paintSide();
}
function paintSide(){
  const f = PQ.f, side = $('pyqSide');
  const subsBy = {};
  f.subs.forEach(s => { const u = s.split('|')[0]; subsBy[u] = (subsBy[u] || 0) + 1; });
  side.querySelectorAll('[data-unit]').forEach(cb => {
    const id = cb.dataset.unit;
    cb.checked = f.units.indexOf(id) >= 0;
    cb.indeterminate = !cb.checked && !!subsBy[id];
  });
  side.querySelectorAll('[data-sub]').forEach(cb => {
    const u = cb.dataset.sub.split('|')[0];
    cb.checked = f.units.indexOf(u) >= 0 || f.subs.indexOf(cb.dataset.sub) >= 0;
  });
  side.querySelectorAll('[data-yr]').forEach(b => b.classList.toggle('on', f.years.indexOf(Number(b.dataset.yr)) >= 0));
  side.querySelectorAll('[data-type]').forEach(cb => cb.checked = f.types.indexOf(cb.dataset.type) >= 0);
  side.querySelectorAll('[data-st]').forEach(cb => cb.checked = f.status.indexOf(cb.dataset.st) >= 0);
  f.stars = f.stars || [];
  side.querySelectorAll('[data-sf]').forEach(cb => cb.checked = f.stars.indexOf(cb.dataset.sf) >= 0);
  pyqPaintStarCounts();
  const yrs = (PQ.idx.years || []).slice().sort((a, b) => b - a);
  side.querySelectorAll('[data-qy]').forEach(b => {
    const set = quickYears(b.dataset.qy, yrs);
    b.classList.toggle('on', set.length === f.years.length && set.every(y => f.years.indexOf(y) >= 0));
  });
  const nu = new Set(f.units.concat(f.subs.map(s => s.split('|')[0]))).size;
  $('psTopicHint').textContent = nu ? nu + ' chosen' : 'all';
  $('psYearHint').textContent = f.years.length ? f.years.length + ' chosen' : 'all';
}
function quickYears(k, yrs){
  const q = QUICK_YEARS.find(x => x.k === k);
  if(!q || k === 'all') return [];
  if(q.n) return yrs.slice(0, q.n);
  return yrs.filter(y => y >= q.from);
}
/* question counts next to every topic (with the other filters applied) */
function paintSideCounts(){
  const f = PQ.f, P = pyqProg();
  const yrs = new Set(f.years.map(Number)), types = new Set(f.types), st = new Set(f.status);
  $('pyqSide').querySelectorAll('[data-cu]').forEach(el => {
    const U = PYQ_UNITS[PQ.exam + ':' + el.dataset.cu];
    const meta = PQ.idx.units.find(u => u.id === el.dataset.cu) || {};
    if(!U){ el.textContent = PQ.mode === 'mrq' ? (meta.nMrq || '') : (meta.n || ''); return; }
    let n = 0;
    U.questions.forEach(q => {
      if(PQ.mode === 'mrq' && !q.mrq) return;
      if(yrs.size && !yrs.has(Number(q.yr))) return;
      if(types.size && !types.has(q.type)) return;
      if(st.size){ const r = P[q.id]; if(!st.has(!r ? 'new' : (r.ok ? 'ok' : 'bad'))) return; }
      if(!starOk(f, q.id)) return;
      n++;
    });
    el.textContent = n;
  });
}
const toggleIn = (arr, v) => { const i = arr.indexOf(v); if(i >= 0) arr.splice(i, 1); else arr.push(v); };
$('pyqSide').addEventListener('change', e => {
  if(!PQ) return;
  const t = e.target, f = PQ.f;
  if(t.dataset.unit){
    const id = t.dataset.unit;
    f.subs = f.subs.filter(s => s.split('|')[0] !== id);
    if(t.checked){ if(f.units.indexOf(id) < 0) f.units.push(id); } else f.units = f.units.filter(x => x !== id);
  } else if(t.dataset.sub){
    const key = t.dataset.sub, u = key.split('|')[0];
    const all = subList(PQ.idx.units.find(x => x.id === u)).map(s => u + '|' + s.id);
    if(f.units.indexOf(u) >= 0){ f.units = f.units.filter(x => x !== u); f.subs = f.subs.filter(s => s.split('|')[0] !== u).concat(all); }
    toggleIn(f.subs, key);
    const mine = f.subs.filter(s => s.split('|')[0] === u);
    if(mine.length === all.length){ f.subs = f.subs.filter(s => s.split('|')[0] !== u); f.units.push(u); }
  } else if(t.dataset.type) toggleIn(f.types, t.dataset.type);
  else if(t.dataset.st) toggleIn(f.status, t.dataset.st);
  else if(t.dataset.sf){ f.stars = f.stars || []; toggleIn(f.stars, t.dataset.sf); }
  else return;
  paintSide(); applyPyq();
});
let pfQT = 0;
$('pyqSide').addEventListener('input', e => {
  if(e.target.id !== 'pfQ' || !PQ) return;
  clearTimeout(pfQT); pfQT = setTimeout(() => { PQ.f.q = e.target.value; applyPyq(); }, 300);
});
$('pyqSide').addEventListener('click', e => {
  if(!PQ) return;
  const f = PQ.f, b = e.target.closest('button'); if(!b) return;
  const yrs = (PQ.idx.years || []).slice().sort((a, b) => b - a);
  if(b.dataset.pmode){ if(b.dataset.pmode !== PQ.mode) openPyq(PQ.exam, b.dataset.pmode); return; }
  if(b.dataset.tg){ const box = b.closest('.pu').querySelector('.pu-subs'); box.hidden = !box.hidden; b.classList.toggle('open', !box.hidden); return; }
  if(b.dataset.yr){ toggleIn(f.years, Number(b.dataset.yr)); }
  else if(b.dataset.qy){ f.years = quickYears(b.dataset.qy, yrs); }
  else if(b.dataset.pf === 'unitsAll'){ f.units = []; f.subs = []; }
  else if(b.dataset.pf === 'unitsOpen' || b.dataset.pf === 'unitsClose'){
    const open = b.dataset.pf === 'unitsOpen';
    $('pyqSide').querySelectorAll('.pu').forEach(p => { const s = p.querySelector('.pu-subs'), g = p.querySelector('.pu-tg'); if(g){ s.hidden = !open; g.classList.toggle('open', open); } });
    return;
  }
  else if(b.dataset.pf === 'resetAll'){ const keep = { sort: f.sort, per: f.per }; PQ.f = Object.assign(PF_DEF(), keep); renderPyqSide(); applyPyq(); return; }
  else if(b.dataset.pf === 'close'){ pyqDrawer(false); return; }
  else return;
  paintSide(); applyPyq();
});
function pyqDrawer(open){ $('pyqSide').classList.toggle('open', open); $('pyqScrim').classList.toggle('open', open); document.body.classList.toggle('noscroll', open); }
$('pyqFilterBtn').addEventListener('click', () => pyqDrawer(!$('pyqSide').classList.contains('open')));
$('pyqScrim').addEventListener('click', () => pyqDrawer(false));
$('pyqBack').addEventListener('click', () => { pyqDrawer(false); go({ level: 'pyq', exam: PQ ? PQ.exam : undefined }); });

/* ---------- head: counts, chosen filters, sort ---------- */
function chipsHTML(){
  const f = PQ.f, idx = PQ.idx, out = [];
  f.units.forEach(id => { const u = idx.units.find(x => x.id === id); if(u) out.push([`unit:${id}`, u.title]); });
  f.subs.forEach(k => {
    const [uid, sid] = k.split('|'); const u = idx.units.find(x => x.id === uid); if(!u) return;
    const s = subList(u).find(x => String(x.id) === sid); if(s) out.push([`sub:${k}`, s.title]);
  });
  if(f.years.length) out.push(['years', f.years.length <= 4 ? f.years.slice().sort().join(', ') : f.years.length + ' years']);
  f.types.forEach(t => out.push([`type:${t}`, PYQ_TYPES[t] || t]));
  f.status.forEach(s => out.push([`st:${s}`, { new: 'Not attempted', bad: 'Got wrong', ok: 'Solved' }[s]]));
  (f.stars || []).forEach(k => out.push([`sf:${k}`, STAR_TXT[k] || 'No star']));
  if(f.q.trim()) out.push(['q', '“' + f.q.trim() + '”']);
  return out.map(([k, t]) => `<button type="button" class="fchip" data-rm="${esc(k)}">${esc(t)} <span>✕</span></button>`).join('');
}
function renderPyqHead(){
  const f = PQ.f, L = PQ.list, P = pyqProg();
  const ok = L.filter(q => P[q.id] && P[q.id].ok).length, bad = L.filter(q => P[q.id] && !P[q.id].ok).length;
  const s = f.page * f.per, e = Math.min(L.length, s + f.per);
  const ex = PYQ_EXAMS.find(x => x.id === PQ.exam) || {};
  const chips = chipsHTML();
  $('pyqHead').innerHTML = `
    <div class="ph-row">
      <div><span class="paper-tag">${esc(ex.title || '')} · ${esc(PYQ_MODES[PQ.mode].title.toUpperCase())}</span>
        <h1>${L.length ? `${L.length} question${L.length > 1 ? 's' : ''}` : 'No questions match'}</h1>
        <div class="ph-sub">${L.length ? `Showing ${s + 1}–${e} · <b class="g">${ok} solved</b>${bad ? ` · <b class="r">${bad} wrong</b>` : ''} · ${L.length - ok - bad} not attempted` : 'Change the filters on the left to see questions.'}</div></div>
      <div class="ph-ctl">
        <label><span>Order</span><select id="pfSort">
          <option value="new"${f.sort === 'new' ? ' selected' : ''}>Newest first</option>
          <option value="old"${f.sort === 'old' ? ' selected' : ''}>Oldest first</option>
          <option value="book"${f.sort === 'book' ? ' selected' : ''}>${PQ.mode === 'mrq' ? 'Concept-wise' : 'Topic-wise'}</option>
          <option value="shuffle"${f.sort === 'shuffle' ? ' selected' : ''}>Shuffle</option></select></label>
        <label><span>Per page</span><select id="pfPer">${[10, 20, 30, 50].map(n => `<option${f.per === n ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
    </div>
    <div class="ph-chips">${chips || '<span class="ph-none">All topics · all years · all types</span>'}${chips ? '<button type="button" class="linkbtn" data-rm="all">Clear all</button>' : ''}</div>
    ${L.length ? ptCfgHTML() : ''}`;
  ptPaintFoot();
}
$('pyqHead').addEventListener('change', e => {
  if(!PQ) return;
  if(e.target.id === 'pfSort'){ PQ.f.sort = e.target.value; if(PQ.f.sort === 'shuffle') PQ.f.seed = 1 + Math.floor(Math.random() * 2e9); applyPyq(); }
  if(e.target.id === 'pfPer'){ PQ.f.per = Number(e.target.value); applyPyq(); }
  if(e.target.id === 'ptReveal') ptChange('reveal', e.target.value === 'end' ? 'end' : Number(e.target.value));
  if(e.target.id === 'ptTimer') ptChange('timer', e.target.value);
  if(e.target.id === 'ptPer') ptChange('per', Number(e.target.value));
});
$('pyqHead').addEventListener('click', e => {
  if(!PQ) return;
  if(e.target.closest('[data-ptrun]')){ ptSetRun(!PT.run); return; }
  if(e.target.closest('[data-ptreset]')){ ptResetPage(); return; }
  if(e.target.closest('.pt-cfg-tg')){ const c = $('ptCfg'); c.classList.toggle('open'); LS.set('stp_pyq_cfg_open', c.classList.contains('open')); return; }
  const b = e.target.closest('[data-rm]'); if(!b) return;
  const f = PQ.f, k = b.dataset.rm;
  if(k === 'all'){ PQ.f = Object.assign(PF_DEF(), { sort: f.sort, per: f.per }); renderPyqSide(); applyPyq(); return; }
  if(k.startsWith('unit:')) f.units = f.units.filter(x => x !== k.slice(5));
  else if(k.startsWith('sub:')) f.subs = f.subs.filter(x => x !== k.slice(4));
  else if(k === 'years') f.years = [];
  else if(k.startsWith('type:')) f.types = f.types.filter(x => x !== k.slice(5));
  else if(k.startsWith('st:')) f.status = f.status.filter(x => x !== k.slice(3));
  else if(k.startsWith('sf:')) f.stars = (f.stars || []).filter(x => x !== k.slice(3));
  else if(k === 'q'){ f.q = ''; const i = $('pfQ'); if(i) i.value = ''; }
  paintSide(); applyPyq();
});

/* ---------- question cards ---------- */
function srcText(q){ return q.src || (q.yr ? String(q.yr) : ''); }
function renderPyqList(){
  const f = PQ.f, L = PQ.list, s = f.page * f.per, page = L.slice(s, s + f.per);
  if(!L.length){ $('pyqList').innerHTML = '<div class="card empty">No question matches these filters.</div>'; $('pyqPager').innerHTML = ''; return; }
  let html = '', lastC = null;
  page.forEach((q, j) => {
    const U = PYQ_UNITS[PQ.exam + ':' + q._u] || {};
    if(PQ.mode === 'mrq' && f.sort === 'book'){
      const c = q._u + '|' + q.mrq;
      if(c !== lastC){
        const cm = ((PQ.idx.units.find(u => u.id === q._u) || {}).mrq || []).find(x => String(x.id) === String(q.mrq)) || {};
        html += `<div class="pq-concept"><span>${esc(U.title || '')}</span><b>${esc(cm.title || '')}</b>${cm.times ? `<i>asked ${cm.times} times</i>` : ''}</div>`;
        lastC = c;
      }
    }
    const sub = (U.subs || []).find(x => String(x.id) === String(q.sub));
    const optsHTML = () => '<div class="opts' + (q.type === 'tf' ? ' tf' : '') + '">' + (q.opts || []).map((o, k) => `<button type="button" class="opt" data-k="${k}"><span class="ol">${q.type === 'tf' ? (k ? 'F' : 'T') : LET[k]}</span><span class="ot">${o}</span></button>`).join('') + '</div>';
    const body = pyqOptType(q.type) ? optsHTML()
      : q.type === 'multi' ? optsHTML() + '<div class="sq-multi"><button type="button" class="btn sq-mcheck">Check Answer</button><span class="sq-hint">Select every correct option, then check.</span></div>'
      : PYQ_SELF[q.type] ? `<div class="sq-self"><button type="button" class="btn sq-show">👁 Show Answer</button>
           <span class="sq-selfq" hidden>Did you get it right? <button type="button" class="btn green small sq-self-ok">✓ Yes</button> <button type="button" class="btn light small sq-self-bad">✗ No</button></span></div>`
      : `<div class="sq-num"><input class="sq-in" type="text" inputmode="decimal" autocomplete="off" maxlength="14" placeholder="Type your answer" aria-label="Answer">
           <button type="button" class="btn sq-check">Check</button></div>`;
    html += `<article class="card sq pq" id="pq_${esc(q.id)}" data-id="${esc(q.id)}">
      <div class="sq-head"><span class="sq-no">Q${s + j + 1}</span><span class="pill">${PYQ_TYPES[q.type] || ''}</span>
        ${pyqShowSrc() && srcText(q) ? `<span class="pill src">${esc(srcText(q))}</span>` : ''}<span class="sq-time" hidden></span><span class="sq-badge"></span><span class="sq-star" role="group" aria-label="My stars">${[1, 2, 3].map(k => `<button type="button" data-star="${k}" aria-label="${k} star${k > 1 ? 's' : ''}">☆</button>`).join('')}</span></div>
      <div class="q-text">${q.q}</div>
      ${body}
      <div class="sq-fb" aria-live="polite"></div>
      <div class="sq-actions">
        <button type="button" class="btn light small sq-retry" hidden>↻ Try Again</button>
        <button type="button" class="btn light small sq-reset" hidden>↺ Reset</button>
        <span class="grow"></span>
        <button type="button" class="btn ghost small sq-solbtn" aria-expanded="false">📘 View Solution</button>
      </div>
      <div class="sq-sol"><div class="sq-sol-in"><div class="sq-sol-box">
        <h4>Solution</h4>
        <div class="st">${q.sol || '<i>Solution not provided.</i>'}</div>
        ${PYQ_SELF[q.type] ? (q.ans ? `<p class="sq-ansline">Answer: <b>${q.ans}</b></p>` : '')
          : `<p class="sq-ansline">Answer: <b>${esc(q.bonus ? 'Bonus' : q.type === 'mcq' ? [q.ans].concat(q.alt || []).map(k => '(' + LET[Number(k)] + ')').join(' or ')
              : q.type === 'multi' ? q.ans.map(k => '(' + LET[Number(k)] + ')').join(', ') : q.type === 'tf' ? (q.ans ? 'False' : 'True') : [q.ans].concat(q.alt || []).join(' or '))}</b></p>`}
        <p class="pq-src">${esc([srcText(q), U.title, sub ? sub.title : ''].filter(Boolean).join(' · '))}</p>
      </div></div></div>
    </article>`;
    const R = ptBlk(page.length);
    if(R && (j % R === R - 1 || j === page.length - 1)) html += `<div class="blk" id="ptb${Math.floor(j / R)}" data-ptb="${Math.floor(j / R)}"></div>`;
  });
  PT.rb = {};
  $('pyqList').innerHTML = html + '<div id="ptSum"></div>';
  ptAutoReveal(true);
  page.forEach(q => paintPq(q));
  ptPaintBlocks(); ptPaintSum();
  renderPager();
  typeset($('pyqList'));
}
function renderPager(){
  const f = PQ.f, pages = Math.ceil(PQ.list.length / f.per), p = f.page;
  if(pages <= 1){ $('pyqPager').innerHTML = ''; return; }
  const nums = new Set([0, pages - 1, p - 2, p - 1, p, p + 1, p + 2].filter(x => x >= 0 && x < pages));
  let last = -1, h = `<button type="button" class="btn light small" data-pg="${p - 1}"${p ? '' : ' disabled'}>← Prev</button>`;
  [...nums].sort((a, b) => a - b).forEach(n => { if(n - last > 1) h += '<span class="gap">…</span>'; h += `<button type="button" class="pg${n === p ? ' on' : ''}" data-pg="${n}">${n + 1}</button>`; last = n; });
  h += `<button type="button" class="btn small" data-pg="${p + 1}"${p < pages - 1 ? '' : ' disabled'}>Next →</button>`;
  $('pyqPager').innerHTML = h;
}
$('pyqPager').addEventListener('click', e => {
  const b = e.target.closest('[data-pg]'); if(!b || b.disabled || !PQ) return;
  PQ.f.page = Number(b.dataset.pg); savePf(); renderPyqHead(); renderPyqList();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
const pqById = id => PQ.list.find(q => q.id === id);
function paintPq(q){
  const el = $('pq_' + q.id); if(!el) return;
  const r = pyqProg()[q.id], ok = !!r && r.ok, bad = !!r && !r.ok;
  const pd = r ? null : ptPend(q.id), live = ptLive(q.id);
  el.classList.toggle('is-ok', ok); el.classList.toggle('is-bad', bad); el.classList.toggle('is-sv', !!pd);
  if(pyqOptType(q.type) || q.type === 'multi'){
    const multi = q.type === 'multi', sel = (PQ.sel || {})[q.id] || (pd && multi ? pd.a : []);
    el.querySelectorAll('.opt').forEach(b => {
      const k = +b.dataset.k, mine = !!r && (multi ? (r.a || []).indexOf(k) >= 0 : Number(r.a) === k);
      b.classList.toggle('correct', ok && mine); b.classList.toggle('wrong', bad && mine);
      b.classList.toggle('dim', !!r && !mine); b.disabled = !!r;
      b.classList.toggle('sel', multi ? (!r && sel.indexOf(k) >= 0) : (!!pd && Number(pd.a) === k));
    });
    if(multi){ const mc = el.querySelector('.sq-multi'); mc.hidden = !!r; mc.querySelector('.sq-mcheck').textContent = live ? 'Check Answer' : 'Save Answer'; }
  } else if(PYQ_SELF[q.type]){
    const shown = !!(PQ.shown || {})[q.id];
    el.querySelector('.sq-show').hidden = !!r || shown;
    el.querySelector('.sq-selfq').hidden = !!r || !shown;
  } else {
    const inp = el.querySelector('.sq-in'), cb = el.querySelector('.sq-check');
    inp.value = r ? r.a : (pd ? pd.a : '');
    inp.disabled = !!r; cb.disabled = !!r; cb.textContent = live ? 'Check' : 'Save';
    inp.classList.toggle('ok', ok); inp.classList.toggle('bad', bad); inp.classList.toggle('sv', !!pd);
  }
  const t = r ? (r.t || 1) : 0;
  el.querySelector('.sq-fb').innerHTML = ok ? `<span class="fb-ok">🎉 Correct! ${t > 1 ? 'You got it on try ' + t + '.' : 'Well done.'}</span>`
    : bad ? (PYQ_SELF[q.type] ? '<span class="fb-bad">Marked for revision. Tap <b>Try Again</b> when you are ready.</span>' : '<span class="fb-bad">✘ Not correct. Tap <b>Try Again</b>, or open the solution.</span>')
    : pd ? `<span class="fb-sv">✓ Answer saved — you will see if it is right ${ptWaitText(q.id)}. You can still change it.</span>` : '';
  el.querySelector('.sq-badge').innerHTML = ok ? '<span class="sb-ok">✓ Solved</span>' : bad ? '<span class="sb-bad">✗ Try again</span>' : pd ? '<span class="sb-sv">● Answered</span>' : '';
  el.querySelector('.sq-retry').hidden = !bad;
  el.querySelector('.sq-reset').hidden = !ok;
  const sb = el.querySelector('.sq-solbtn'), hideSol = !r && !live && !PYQ_SELF[q.type];
  sb.hidden = hideSol;                                   // no peeking before the answers are shown
  if(hideSol && el.classList.contains('sol-open')){ el.classList.remove('sol-open'); sb.innerHTML = '📘 View Solution'; }
  ptPaintQTime(q.id);
  pyqPaintStar(q.id);
}
function pyqPaintStar(id){
  const el = $('pq_' + id); if(!el) return;
  const r = pyqStar(id), box = el.querySelector('.sq-star'); if(!box) return;
  box.classList.toggle('has', !!r);
  box.querySelectorAll('[data-star]').forEach(b => { const on = +b.dataset.star <= r; b.textContent = on ? '★' : '☆'; b.classList.toggle('on', on); });
  box.title = r ? `${r} star${r > 1 ? 's' : ''} — tap the same star again to remove` : 'Give this question 1, 2 or 3 stars';
}
function pyqPaintStarCounts(){
  const S = pyqProg()._star || {}, ids = new Set();
  if(PQ) Object.keys(PYQ_UNITS).forEach(k => { if(k.indexOf(PQ.exam + ':') === 0) PYQ_UNITS[k].questions.forEach(q => ids.add(q.id)); });
  const c = { 1: 0, 2: 0, 3: 0 };
  Object.keys(S).forEach(id => { if(c[S[id]] !== undefined && (!ids.size || ids.has(id))) c[S[id]]++; });
  document.querySelectorAll('[data-sfc]').forEach(el => el.textContent = c[el.dataset.sfc] || '');
}
function answerPq(q, a, x, y){
  const P = pyqProg(); if(P[q.id]) return;
  if(ptOn() && !PT.run) ptSetRun(true);
  let ok;
  if(q.bonus) ok = true;
  else if(PYQ_SELF[q.type]) ok = a === 'ok';
  else if(q.type === 'multi') ok = a.length === q.ans.length && a.every((k, i) => k === q.ans[i]);
  else if(pyqOptType(q.type)) ok = Number(a) === Number(q.ans) || (q.alt || []).indexOf(Number(a)) >= 0;
  else ok = [q.ans].concat(q.alt || []).some(v => Math.abs(parseFloat(a) - Number(v)) <= (q.tol != null ? Number(q.tol) : 0.001) + 1e-9);
  if(!PYQ_SELF[q.type] && !ptLive(q.id)){              // answers hidden until the block is done
    const pend = P._pend = P._pend || {};
    pend[q.id] = { a, ok };
    if(PQ.sel) delete PQ.sel[q.id];
    pyqSaveProg(); paintPq(q); ptPaintBlocks(); ptPaintStatus();
    ptAutoReveal(false);
    return;
  }
  ptCommit(q, a, ok);
  paintPq(q); renderPyqHead(); ptPaintSum(); ptPaintStatus();
  const el = $('pq_' + q.id);
  if(ok) burst(x, y, false);
  else { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
}
$('pyqList').addEventListener('click', e => {
  if(!PQ) return;
  const stb = e.target.closest('[data-star]');
  if(stb){
    const id = stb.closest('.pq').dataset.id, k = +stb.dataset.star, P = pyqProg();
    P._star = P._star || {};
    if(P._star[id] === k) delete P._star[id]; else P._star[id] = k;
    pyqSaveProg(); pyqPaintStar(id); pyqPaintStarCounts();
    if(P._star[id]) toast(`${'★'.repeat(k)} Saved to your ${k}-star set`, 1800);
    return;
  }
  const rb = e.target.closest('[data-ptshow]');
  if(rb){ ptReveal(+rb.dataset.ptshow); return; }
  const jq = e.target.closest('[data-ptjump]');
  if(jq){ const el = $('pq_' + jq.dataset.ptjump); if(el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  const card = e.target.closest('.pq'); if(!card) return;
  const q = pqById(card.dataset.id); if(!q) return;
  const opt = e.target.closest('.opt');
  if(opt && !opt.disabled){
    if(q.type === 'multi'){
      PQ.sel = PQ.sel || {}; const S = PQ.sel[q.id] = PQ.sel[q.id] || (ptPend(q.id) ? ptPend(q.id).a.slice() : []), k = +opt.dataset.k, i = S.indexOf(k);
      if(i >= 0) S.splice(i, 1); else S.push(k);
      opt.classList.toggle('sel', i < 0); card.querySelector('.sq-fb').innerHTML = ''; return;
    }
    const r = opt.getBoundingClientRect(); answerPq(q, +opt.dataset.k, e.clientX || r.left + 24, e.clientY || r.top + r.height / 2); return;
  }
  const mc = e.target.closest('.sq-mcheck');
  if(mc){
    const S = ((PQ.sel || {})[q.id] || []).slice().sort((a, b) => a - b);
    if(!S.length){ card.querySelector('.sq-fb').innerHTML = '<span class="fb-bad">Select at least one option first.</span>'; return; }
    const r = mc.getBoundingClientRect(); answerPq(q, S, r.left + r.width / 2, r.top + r.height / 2); return;
  }
  if(e.target.closest('.sq-show')){
    PQ.shown = PQ.shown || {}; PQ.shown[q.id] = 1; card.classList.add('sol-open');
    const b = card.querySelector('.sq-solbtn'); b.setAttribute('aria-expanded', true); b.innerHTML = '📕 Hide Solution'; paintPq(q); return;
  }
  const so = e.target.closest('.sq-self-ok'), sx = e.target.closest('.sq-self-bad');
  if(so || sx){ const r = (so || sx).getBoundingClientRect(); answerPq(q, so ? 'ok' : 'no', r.left + r.width / 2, r.top + r.height / 2); return; }
  if(e.target.closest('.sq-check')) return checkPqNum(q, card);
  if(e.target.closest('.sq-retry') || e.target.closest('.sq-reset')){ delete pyqProg()[q.id]; if(PQ.sel) delete PQ.sel[q.id]; if(PQ.shown) delete PQ.shown[q.id]; pyqSaveProg(); paintPq(q); renderPyqHead(); ptPaintBlocks(); ptPaintSum(); ptPaintStatus(); return; }
  const sb = e.target.closest('.sq-solbtn');
  if(sb){ const open = !card.classList.contains('sol-open'); card.classList.toggle('sol-open', open); sb.setAttribute('aria-expanded', open); sb.innerHTML = open ? '📕 Hide Solution' : '📘 View Solution'; }
});
function checkPqNum(q, card){
  const inp = card.querySelector('.sq-in'), v = inp.value.trim();
  if(!/^-?\d+(\.\d+)?$/.test(v) && !/^-?\.\d+$/.test(v)){ card.querySelector('.sq-fb').innerHTML = '<span class="fb-bad">Please type a number (e.g. 12, -3 or 2.5).</span>'; inp.focus(); return; }
  const r = card.querySelector('.sq-check').getBoundingClientRect();
  answerPq(q, v, r.left + r.width / 2, r.top + r.height / 2);
}
$('pyqList').addEventListener('keydown', e => {
  if(e.key === 'Enter' && e.target.classList.contains('sq-in') && PQ){ e.preventDefault(); const c = e.target.closest('.pq'); const q = pqById(c.dataset.id); if(q) checkPqNum(q, c); }
});

/* =====================================================================
   PYQ TIMER + ANSWER REVEAL  (same idea as the Practice Sheets)
   Each page of PYQs works like one sheet. The student chooses:
     • when answers are shown: immediately, after every 5/10/… questions, or at the end of the page
     • a timer: off, stopwatch (records the time on every question) or a time limit per question
   Time on every question is kept on this device (progress key _ms), pending answers in _pend.
   A minimisable status panel (#pqStat) shows the clock and the counts for this page.
   ===================================================================== */
const PT_DEF = { reveal: 0, timer: 'off', per: 120 };
const PT = { cfg: Object.assign({}, PT_DEF, LS.get('stp_pyq_cfg', {}) || {}), run: false, lastT: 0, lastSave: 0, cur: null, rb: {}, timeUp: false };
const ptOn = () => PT.cfg.timer !== 'off';
const ptPage = () => { if(!PQ) return []; const f = PQ.f, s = f.page * f.per; return PQ.list.slice(s, s + f.per); };
const ptBlk = n => PT.cfg.reveal === 'end' ? n : (Number(PT.cfg.reveal) || 0);
const ptMs = id => ((pyqProg()._ms || {})[id]) || 0;
const ptPend = id => (pyqProg()._pend || {})[id] || null;
const ptPos = id => ptPage().findIndex(q => q.id === id);
const ptLimit = () => ptPage().length * PT.cfg.per * 1000;
const ptTotal = () => ptPage().reduce((a, q) => a + ptMs(q.id), 0);
function ptRange(b){ const n = ptPage().length, R = ptBlk(n); return [b * R, Math.min(n, b * R + R) - 1]; }
function ptLive(id){                                         // is this question checked the moment it is answered?
  const n = ptPage().length, R = ptBlk(n); if(!R) return true;
  const j = ptPos(id); if(j < 0) return true;
  return !!PT.rb[Math.floor(j / R)];
}
function ptWaitText(id){
  const R = ptBlk(ptPage().length), j = ptPos(id); if(!R || j < 0) return 'soon';
  if(PT.cfg.reveal === 'end') return 'at the end of this page';
  const [s, e] = ptRange(Math.floor(j / R)), o = PQ.f.page * PQ.f.per;
  return `after you answer Q${o + s + 1}–Q${o + e + 1}`;
}
function ptCommit(q, a, ok){
  const P = pyqProg();
  const tries = ((P._t || {})[q.id] || 0) + 1;
  P._t = P._t || {}; P._t[q.id] = tries;
  P[q.id] = { a, ok, t: tries };
  if(P._pend) delete P._pend[q.id];
  pyqSaveProg();
}
const ptDone = q => !!pyqProg()[q.id] || !!ptPend(q.id);
/* show a block's answers: every pending answer in it is checked */
function ptReveal(b, quiet){
  const page = ptPage(), [s, e] = ptRange(b); let ok = 0, n = 0;
  PT.rb[b] = true;
  for(let j = s; j <= e; j++){
    const q = page[j], pd = q && ptPend(q.id); if(!q) continue;
    if(pd){ ptCommit(q, pd.a, pd.ok); }
    const r = pyqProg()[q.id]; if(r){ n++; if(r.ok) ok++; }
    paintPq(q);
  }
  ptPaintBlocks(); renderPyqHead(); ptPaintSum(); ptPaintStatus();
  if(!quiet){
    const o = PQ.f.page * PQ.f.per, lbl = PT.cfg.reveal === 'end' ? 'This page' : `Q${o + s + 1}–Q${o + e + 1}`;
    toast(`${lbl}: ${ok}/${e - s + 1} correct${ok === e - s + 1 ? ' 🎉' : ''}`, 4500);
    if(ok) burst(innerWidth / 2, innerHeight * 0.45, ok === e - s + 1);
  }
}
/* blocks whose questions are all answered are shown */
function ptAutoReveal(quiet){
  const page = ptPage(), R = ptBlk(page.length); if(!R) return;
  for(let b = 0; b * R < page.length; b++){
    if(PT.rb[b]) continue;
    const [s, e] = ptRange(b); let full = true, anyPend = false;
    for(let j = s; j <= e; j++){ if(!ptDone(page[j])) { full = false; break; } if(ptPend(page[j].id)) anyPend = true; }
    if(full){ if(quiet || !anyPend) { PT.rb[b] = true; if(anyPend) ptReveal(b, true); } else setTimeout(() => ptReveal(b), 450); }
  }
}
function ptPaintBlocks(){
  const page = ptPage(), R = ptBlk(page.length); if(!R) return;
  const o = PQ.f.page * PQ.f.per;
  for(let b = 0; b * R < page.length; b++){
    const el = $('ptb' + b); if(!el) continue;
    const [s, e] = ptRange(b), n = e - s + 1; let ans = 0, ok = 0;
    for(let j = s; j <= e; j++){ const q = page[j]; if(ptDone(q)) ans++; const r = pyqProg()[q.id]; if(r && r.ok) ok++; }
    const lbl = PT.cfg.reveal === 'end' ? 'this page' : `Q${o + s + 1}–Q${o + e + 1}`;
    el.className = 'blk' + (PT.rb[b] ? ' done' : '');
    el.innerHTML = PT.rb[b]
      ? `<span>✓ Answers shown for ${lbl} · <b>${ok}/${n} correct</b>${n - ans ? ` · ${n - ans} not answered yet` : ''}</span>`
      : `<span>🔒 Answers for ${lbl} are hidden · <b>${ans}/${n} answered</b></span><button type="button" class="btn small" data-ptshow="${b}">🔓 Show answers now</button>`;
  }
}

/* ---------- settings ---------- */
function ptCfgHTML(){
  const c = PT.cfg, n = ptPage().length, steps = [];
  for(let k = 5; k < n; k += 5) steps.push(k);
  if(c.reveal !== 'end' && Number(c.reveal) && steps.indexOf(Number(c.reveal)) < 0) steps.push(Number(c.reveal));
  const open = LS.get('stp_pyq_cfg_open', true);
  const sum = [ptOn() ? (c.timer === 'watch' ? '⏱ Stopwatch' : '⏱ ' + perTxt(c.per) + ' per question') : 'No timer',
               !ptBlk(n) ? 'answers immediately' : c.reveal === 'end' ? 'answers at the end of the page' : 'answers after every ' + c.reveal].join(' · ');
  return `<div class="sh-cfg pt-cfg${open ? ' open' : ''}" id="ptCfg">
    <button type="button" class="pt-cfg-tg"><span class="cfg-h">⚙️ Timer &amp; answers <span>— ${esc(sum)}</span></span><i>▾</i></button>
    <div class="pt-cfg-in">
    <p class="pt-note">Every page works like one practice sheet of ${n} questions — change <b>Per page</b> above for a shorter or longer set.</p>
    <div class="cfg-grid">
      <label class="cfg-f"><span>Show answers</span>
        <select id="ptReveal">
          <option value="0"${!Number(c.reveal) && c.reveal !== 'end' ? ' selected' : ''}>Immediately after each question</option>
          ${steps.sort((a, b) => a - b).map(k => `<option value="${k}"${String(c.reveal) === String(k) ? ' selected' : ''}>After every ${k} questions</option>`).join('')}
          <option value="end"${c.reveal === 'end' ? ' selected' : ''}>At the end of this page</option>
        </select></label>
      <label class="cfg-f"><span>Timer</span>
        <select id="ptTimer">
          <option value="off"${c.timer === 'off' ? ' selected' : ''}>No timer</option>
          <option value="watch"${c.timer === 'watch' ? ' selected' : ''}>Stopwatch — record my time</option>
          <option value="target"${c.timer === 'target' ? ' selected' : ''}>Time limit per question</option>
        </select></label>
      <label class="cfg-f"${c.timer === 'target' ? '' : ' hidden'}><span>Time per question</span>
        <select id="ptPer">${PER_OPTS.map(s => `<option value="${s}"${Number(c.per) === s ? ' selected' : ''}>${perTxt(s)}</option>`).join('')}</select></label>
    </div>
    <div class="cfg-foot" id="ptFoot"></div>
    </div>
  </div>`;
}
function ptPaintFoot(){
  const el = $('ptFoot'); if(!el) return;
  if(!ptOn()){ el.innerHTML = ''; return; }
  const lim = PT.cfg.timer === 'target' ? ` · ${fmt(ptLimit())} for the ${ptPage().length} questions on this page` : '';
  el.innerHTML = `<span class="cfg-note">⏱ Timer ${PT.run ? 'running' : 'paused'}${lim}</span>
    <span class="pt-fbtns">${ptTotal() ? '<button type="button" class="btn small light" data-ptreset="1">↺ Reset page times</button>' : ''}
    <button type="button" class="btn small ${PT.run ? 'light' : 'green'}" data-ptrun="1">${PT.run ? '❚❚ Pause' : '▶ Start'}</button></span>`;
}
function ptChange(key, val){
  PT.cfg[key] = val; LS.set('stp_pyq_cfg', PT.cfg);
  if(key === 'reveal'){
    if(!ptBlk(ptPage().length)){                                   // immediately: check every saved answer now
      const P = pyqProg(), pend = P._pend || {};
      PQ.list.forEach(q => { if(pend[q.id]) ptCommit(q, pend[q.id].a, pend[q.id].ok); });
    }
    renderPyqHead(); renderPyqList();
    toast(!ptBlk(ptPage().length) ? 'Answers will now be shown immediately.' : (val === 'end' ? 'Answers will be shown at the end of the page.' : `Answers will be shown after every ${val} questions.`));
    return;
  }
  if(key === 'timer'){
    if(val === 'off') PT.run = false;
    else { PT.run = true; PT.lastT = performance.now(); toast('⏱ Timer started. Your time on each question is recorded.'); }
  }
  PT.timeUp = PT.cfg.timer === 'target' && ptTotal() >= ptLimit();
  renderPyqHead(); ptPage().forEach(q => ptPaintQTime(q.id)); ptPaintSum(); ptPaintStatus();
}
function ptSetRun(on){
  if(!ptOn()) return;
  PT.run = !!on; PT.lastT = performance.now(); pyqSaveProg(); ptPaintFoot(); ptPaintStatus();
  if(PT.cur) ptPaintQTime(PT.cur);
}
function ptResetPage(){
  if(!confirm('Reset the recorded times of the questions on this page?')) return;
  const ms = pyqProg()._ms || {}; ptPage().forEach(q => delete ms[q.id]);
  pyqSaveProg(); PT.timeUp = false; renderPyqHead(); ptPage().forEach(q => ptPaintQTime(q.id)); ptPaintSum(); ptPaintStatus();
}

/* ---------- clocks ---------- */
function ptPaintQTime(id){
  const el = $('pq_' + id); if(!el) return;
  const tm = el.querySelector('.sq-time'); if(!tm) return;
  const ms = ptMs(id);
  if(!ptOn() || (!ms && PT.cur !== id)){ tm.hidden = true; return; }
  tm.hidden = false;
  const over = PT.cfg.timer === 'target' && ms > PT.cfg.per * 1000;
  const q = pqById(id), running = PT.run && PT.cur === id && q && !ptDone(q);
  tm.className = 'sq-time' + (over ? ' over' : '') + (running ? ' live' : '');
  tm.textContent = '⏱ ' + fmt(ms) + (PT.cfg.timer === 'target' ? ' / ' + fmt(PT.cfg.per * 1000) : '');
}
function ptPaintSum(){
  const el = $('ptSum'); if(!el) return;
  const page = ptPage(), rec = page.map((q, j) => ({ q, j, ms: ptMs(q.id) })).filter(x => x.ms > 0);
  if(!ptOn() || !rec.length){ el.innerHTML = ''; return; }
  const P = pyqProg(), o = PQ.f.page * PQ.f.per, per = PT.cfg.per * 1000;
  const answered = page.filter(ptDone), tot = ptTotal();
  const avg = answered.length ? answered.reduce((a, q) => a + ptMs(q.id), 0) / answered.length : 0;
  const over = PT.cfg.timer === 'target' ? rec.filter(x => x.ms > per).length : 0;
  el.innerHTML = `<div class="card sheet-sum pt-sum">
    <div class="ss-big">⏱ Time on this page</div>
    <div class="ss-sum-time">
      <div><b>${fmt(tot)}</b><span>Total time</span></div>
      <div><b>${answered.length ? fmt(avg) : '—'}</b><span>Average per question</span></div>
      ${PT.cfg.timer === 'target' ? `<div><b class="${over ? 'r' : 'g'}">${over}</b><span>Over ${perTxt(PT.cfg.per)}</span></div>` : ''}
    </div>
    <div class="ss-qt">${rec.map(x => { const r = P[x.q.id]; return `<button type="button" data-ptjump="${esc(x.q.id)}" class="qt${PT.cfg.timer === 'target' && x.ms > per ? ' over' : ''}${r ? (r.ok ? ' ok' : ' bad') : ''}">Q${o + x.j + 1}<b>${fmt(x.ms)}</b></button>`; }).join('')}</div>
  </div>`;
}
function ptPaintStatus(){
  const box = $('pqStat'); if(!box || !PQ) return;
  const page = ptPage(), P = pyqProg(), n = page.length;
  const ans = page.filter(ptDone).length, ok = page.filter(q => P[q.id] && P[q.id].ok).length, bad = page.filter(q => P[q.id] && !P[q.id].ok).length;
  let clk = '—', lbl = 'Timer off', cls = '';
  if(ptOn()){
    const tot = ptTotal();
    if(PT.cfg.timer === 'target'){
      const rem = ptLimit() - tot;
      lbl = rem >= 0 ? 'Time left · this page' : 'Overtime'; clk = (rem < 0 ? '+' : '') + fmt(Math.abs(rem));
      cls = rem < 0 ? 'over' : (rem < 60000 ? 'warn' : '');
    } else { lbl = 'Time on this page'; clk = fmt(tot); }
    if(!PT.run) lbl += ' · paused';
  }
  $('ptClkLbl').textContent = lbl; $('ptClk').textContent = clk; $('ptClk').className = cls;
  const cj = PT.cur ? ptPos(PT.cur) : -1, o = PQ.f.page * PQ.f.per;
  $('ptNow').innerHTML = ptOn() && cj >= 0
    ? `On <b>Q${o + cj + 1}</b> · ${fmt(ptMs(PT.cur))}${PT.cfg.timer === 'target' ? ' / ' + fmt(PT.cfg.per * 1000) : ''}${ptDone(page[cj]) ? ' <i>(answered)</i>' : ''}`
    : (ptOn() ? 'Scroll to a question to start its clock' : 'Switch the timer on in <b>Timer &amp; answers</b>');
  $('ptAns').textContent = ans + '/' + n; $('ptOk').textContent = ok; $('ptBad').textContent = bad;
  const R = ptBlk(n);
  $('ptMode').textContent = 'Answers: ' + (!R ? 'immediately' : PT.cfg.reveal === 'end' ? 'at the end of the page' : 'after every ' + R);
  const run = $('ptRun'); run.hidden = !ptOn();
  run.textContent = PT.run ? '❚❚ Pause' : '▶ Start'; run.className = 'btn small ' + (PT.run ? 'light' : 'green');
  $('ptRv').hidden = !R || !page.some(q => ptPend(q.id));
  $('ptPill').innerHTML = `<span>${ptOn() ? '⏱ <b class="' + cls + '">' + clk + '</b> · ' : ''}${ok}/${n} ✓</span><span class="ss-ex">▢</span>`;
  if(PT.cur) ptPaintQTime(PT.cur);
}
function ptActive(){
  const y = innerHeight * 0.42; let best = null, bd = 1e9;
  for(const q of ptPage()){
    const el = $('pq_' + q.id); if(!el) continue;
    const r = el.getBoundingClientRect();
    if(r.top <= y && r.bottom >= y) return q.id;
    const d = Math.min(Math.abs(r.top - y), Math.abs(r.bottom - y));
    if(d < bd){ bd = d; best = q.id; }
  }
  return bd < 200 ? best : null;
}
setInterval(() => {
  if(!PQ || !$('pyq').classList.contains('active')){ PT.lastT = performance.now(); return; }
  const now = performance.now(), dt = PT.lastT ? Math.min(2000, now - PT.lastT) : 0; PT.lastT = now;
  const prev = PT.cur; PT.cur = ptOn() ? ptActive() : null;
  if(prev && prev !== PT.cur) ptPaintQTime(prev);
  if(ptOn() && PT.run && document.visibilityState === 'visible'){
    const q = PT.cur && pqById(PT.cur);
    if(q && !ptDone(q)){ const P = pyqProg(); P._ms = P._ms || {}; P._ms[q.id] = (P._ms[q.id] || 0) + dt; }
    if(PT.cfg.timer === 'target' && !PT.timeUp && ptTotal() >= ptLimit()){
      PT.timeUp = true; toast("⏰ Time's up for this page! You can keep going — extra time is shown as overtime.", 6000);
    }
    if(now - PT.lastSave > 5000){ PT.lastSave = now; pyqSaveProg(); }
  }
  ptPaintStatus();
}, 500);
document.addEventListener('visibilitychange', () => { PT.lastT = performance.now(); if(document.visibilityState === 'hidden' && PQ) pyqSaveProg(); });
(function ptInitPanel(){
  const box = $('pqStat'); if(!box) return;
  const minPref = LS.get('stp_pyq_min', null);
  box.classList.toggle('min', minPref === null ? true : !!minPref);
  box.addEventListener('click', e => {
    if(e.target.closest('#ptMin')){ box.classList.add('min'); LS.set('stp_pyq_min', true); return; }
    if(e.target.closest('#ptPill')){ box.classList.remove('min'); LS.set('stp_pyq_min', false); return; }
    if(e.target.closest('#ptRun')){ ptSetRun(!PT.run); return; }
    if(e.target.closest('#ptRv')){
      if(!confirm('Show the answers you have saved on this page now?')) return;
      const R = ptBlk(ptPage().length); for(let b = 0; b * R < ptPage().length; b++) if(!PT.rb[b]) ptReveal(b, true);
      toast('Answers shown.'); return;
    }
  });
})();
