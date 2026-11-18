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
function pyqSaveProg(){ LS.set(pyqKey(), PYQ_PROG || {}); }

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
const PF_DEF = () => ({ units: [], subs: [], years: [], types: [], status: [], q: '', sort: 'new', per: 20, page: 0 });
const pfKey = (exam, mode) => 'stp_pyq_f_' + exam + '_' + mode;

async function openPyq(exam, mode){
  busy(true, 'Loading PYQs…');
  try{
    const idx = await pyqIndex(exam);
    if(!idx) throw new Error('no index');
    const f = Object.assign(PF_DEF(), mode === 'mrq' ? { sort: 'book' } : {}, LS.get(pfKey(exam, mode), {}) || {});
    f.units = f.units.filter(id => idx.units.some(u => u.id === id));
    PQ = { exam, mode, idx, f, list: [] };
    await pyqLoadUnits(exam, pyqNeededUnits());
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
    <div class="ph-chips">${chips || '<span class="ph-none">All topics · all years · all types</span>'}${chips ? '<button type="button" class="linkbtn" data-rm="all">Clear all</button>' : ''}</div>`;
}
$('pyqHead').addEventListener('change', e => {
  if(!PQ) return;
  if(e.target.id === 'pfSort'){ PQ.f.sort = e.target.value; if(PQ.f.sort === 'shuffle') PQ.f.seed = 1 + Math.floor(Math.random() * 2e9); applyPyq(); }
  if(e.target.id === 'pfPer'){ PQ.f.per = Number(e.target.value); applyPyq(); }
});
$('pyqHead').addEventListener('click', e => {
  const b = e.target.closest('[data-rm]'); if(!b || !PQ) return;
  const f = PQ.f, k = b.dataset.rm;
  if(k === 'all'){ PQ.f = Object.assign(PF_DEF(), { sort: f.sort, per: f.per }); renderPyqSide(); applyPyq(); return; }
  if(k.startsWith('unit:')) f.units = f.units.filter(x => x !== k.slice(5));
  else if(k.startsWith('sub:')) f.subs = f.subs.filter(x => x !== k.slice(4));
  else if(k === 'years') f.years = [];
  else if(k.startsWith('type:')) f.types = f.types.filter(x => x !== k.slice(5));
  else if(k.startsWith('st:')) f.status = f.status.filter(x => x !== k.slice(3));
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
        ${pyqShowSrc() && srcText(q) ? `<span class="pill src">${esc(srcText(q))}</span>` : ''}<span class="sq-badge"></span></div>
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
              : q.type === 'multi' ? q.ans.map(k => '(' + LET[Number(k)] + ')').join(', ') : q.type === 'tf' ? (q.ans ? 'False' : 'True') : String(q.ans))}</b></p>`}
        <p class="pq-src">${esc([srcText(q), U.title, sub ? sub.title : ''].filter(Boolean).join(' · '))}</p>
      </div></div></div>
    </article>`;
  });
  $('pyqList').innerHTML = html;
  page.forEach(q => paintPq(q));
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
  el.classList.toggle('is-ok', ok); el.classList.toggle('is-bad', bad);
  if(pyqOptType(q.type) || q.type === 'multi'){
    const multi = q.type === 'multi', sel = (PQ.sel || {})[q.id] || [];
    el.querySelectorAll('.opt').forEach(b => {
      const k = +b.dataset.k, mine = !!r && (multi ? (r.a || []).indexOf(k) >= 0 : Number(r.a) === k);
      b.classList.toggle('correct', ok && mine); b.classList.toggle('wrong', bad && mine);
      b.classList.toggle('dim', !!r && !mine); b.disabled = !!r;
      b.classList.toggle('sel', multi && !r && sel.indexOf(k) >= 0);
    });
    if(multi){ const mc = el.querySelector('.sq-multi'); mc.hidden = !!r; }
  } else if(PYQ_SELF[q.type]){
    const shown = !!(PQ.shown || {})[q.id];
    el.querySelector('.sq-show').hidden = !!r || shown;
    el.querySelector('.sq-selfq').hidden = !!r || !shown;
  } else {
    const inp = el.querySelector('.sq-in'), cb = el.querySelector('.sq-check');
    inp.value = r ? r.a : ''; inp.disabled = !!r; cb.disabled = !!r;
    inp.classList.toggle('ok', ok); inp.classList.toggle('bad', bad);
  }
  const t = r ? (r.t || 1) : 0;
  el.querySelector('.sq-fb').innerHTML = ok ? `<span class="fb-ok">🎉 Correct! ${t > 1 ? 'You got it on try ' + t + '.' : 'Well done.'}</span>`
    : bad ? (PYQ_SELF[q.type] ? '<span class="fb-bad">Marked for revision. Tap <b>Try Again</b> when you are ready.</span>' : '<span class="fb-bad">✘ Not correct. Tap <b>Try Again</b>, or open the solution.</span>') : '';
  el.querySelector('.sq-badge').innerHTML = ok ? '<span class="sb-ok">✓ Solved</span>' : bad ? '<span class="sb-bad">✗ Try again</span>' : '';
  el.querySelector('.sq-retry').hidden = !bad;
  el.querySelector('.sq-reset').hidden = !ok;
}
function answerPq(q, a, x, y){
  const P = pyqProg(); if(P[q.id]) return;
  let ok;
  if(q.bonus) ok = true;
  else if(PYQ_SELF[q.type]) ok = a === 'ok';
  else if(q.type === 'multi') ok = a.length === q.ans.length && a.every((k, i) => k === q.ans[i]);
  else if(pyqOptType(q.type)) ok = Number(a) === Number(q.ans) || (q.alt || []).indexOf(Number(a)) >= 0;
  else ok = Math.abs(parseFloat(a) - Number(q.ans)) <= (q.tol != null ? Number(q.tol) : 0.001) + 1e-9;
  const tries = ((PYQ_PROG._t || {})[q.id] || 0) + 1;
  PYQ_PROG._t = PYQ_PROG._t || {}; PYQ_PROG._t[q.id] = tries;
  P[q.id] = { a, ok, t: tries };
  pyqSaveProg(); paintPq(q); renderPyqHead();
  const el = $('pq_' + q.id);
  if(ok) burst(x, y, false);
  else { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
}
$('pyqList').addEventListener('click', e => {
  if(!PQ) return;
  const card = e.target.closest('.pq'); if(!card) return;
  const q = pqById(card.dataset.id); if(!q) return;
  const opt = e.target.closest('.opt');
  if(opt && !opt.disabled){
    if(q.type === 'multi'){
      PQ.sel = PQ.sel || {}; const S = PQ.sel[q.id] = PQ.sel[q.id] || [], k = +opt.dataset.k, i = S.indexOf(k);
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
  if(e.target.closest('.sq-retry') || e.target.closest('.sq-reset')){ delete pyqProg()[q.id]; if(PQ.sel) delete PQ.sel[q.id]; if(PQ.shown) delete PQ.shown[q.id]; pyqSaveProg(); paintPq(q); renderPyqHead(); return; }
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
