/* =====================================================================
   ACCOUNT STORAGE  (database: backend/user_data.sql)
   Everything a student does is kept in their account, so it is the same on
   every phone / laptop they log in on:
     PYQ progress & stars, Practice Sheet answers & timers, a test in progress,
     Group Study answers, and settings (dark mode, timer settings, PYQ filters).
   The browser's storage is only a fast copy. Every LS.set / LS.del of one of
   these keys marks it "to send"; changes go to the server a few seconds later
   (and right away when the page is hidden). At login the account copy is
   loaded first; only changes from this device that never reached the server
   win over it.
   Loaded in <head>; uses LS / SB / USER / CFG from the main script at run time.
   ===================================================================== */
(function () {
  var C = window.CLOUD = { on: false, off: false, dirty: {}, known: {}, ver: 0, timer: 0, busy: false, tok: '', loadedFor: '' };

  function uid() { return (typeof USER !== 'undefined' && USER && USER.id) || ''; }
  /* browser key → account key (null = stays on this device only) */
  function toCloud(k) {
    var u = uid(); if (!u || !k) return null;
    if (k === 'stp_pyq_' + u) return 'pyq';
    if (k.indexOf('stp_sheet_' + u + '_') === 0) return 'sheet:' + k.slice(('stp_sheet_' + u + '_').length);
    if (k.indexOf('stp_gs_me_' + u + '_') === 0) return 'gs:' + k.slice(('stp_gs_me_' + u + '_').length);
    if (k === 'stp_active') return 'active';
    if (k === 'stp_gs') return 'gs_cur';
    if (k === 'stp_theme' || k === 'stp_sheet_cfg' || k === 'stp_pyq_cfg' || k === 'stp_pyq_cfg_open') return 'pref:' + k.slice(4);
    if (k.indexOf('stp_pyq_f_') === 0) return 'pref:' + k.slice(4);
    return null;
  }
  function toLocal(ck) {
    var u = uid();
    if (ck === 'pyq') return 'stp_pyq_' + u;
    if (ck.indexOf('sheet:') === 0) return 'stp_sheet_' + u + '_' + ck.slice(6);
    if (ck.indexOf('gs:') === 0) return 'stp_gs_me_' + u + '_' + ck.slice(3);
    if (ck === 'active') return 'stp_active';
    if (ck === 'gs_cur') return 'stp_gs';
    if (ck.indexOf('pref:') === 0) return 'stp_' + ck.slice(5);
    return null;
  }
  var raw = {
    get: function (k) { var v; try { v = localStorage.getItem(k); } catch (e) { return undefined; } if (v == null) return undefined; try { return JSON.parse(v); } catch (e) { return v; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  var dirtyKey = function () { return 'stp_cloud_dirty_' + uid(); };
  var knownKey = function () { return 'stp_cloud_known_' + uid(); };   // items the account had at the last sync
  function saveDirty() { raw.set(dirtyKey(), C.dirty); }
  function saveKnown() { raw.set(knownKey(), C.known); }

  /* called by LS.set / LS.del */
  window.cloudTouch = function (k) {
    var ck = toCloud(k); if (!ck || C.off) return;
    if (ck === 'active') { var a = raw.get(k); if (a && a.uid && a.uid !== uid()) return; }   // another student's test on a shared device
    C.dirty[ck] = ++C.ver; saveDirty();
    if (C.on && !C.timer) C.timer = setTimeout(push, 4000);      // at most one send every few seconds
  };

  function rpc(name, args) {
    return Promise.race([SB.rpc(name, args || {}), new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, 12000); })]);
  }
  function missing(err) { return /Could not find the function|does not exist/i.test(String(err && err.message || '')); }

  /* at login: bring this account's data onto this device (before any screen is drawn) */
  window.cloudLoad = async function () {
    var u = uid();
    if (!u || C.off || typeof SB === 'undefined' || !SB) return;
    C.dirty = raw.get(dirtyKey()) || {};
    try {
      var r = await rpc('ud_get_all');
      if (r.error) { if (missing(r.error)) C.off = true; return; }
      var srv = r.data || {};
      Object.keys(srv).forEach(function (ck) {
        if (C.dirty[ck]) return;                                 // this device has newer, unsent changes
        var lk = toLocal(ck); if (!lk) return;
        if (ck === 'active' && srv[ck] && srv[ck].uid && srv[ck].uid !== u) return;
        raw.set(lk, srv[ck]);
      });
      var known = raw.get(knownKey()) || {}, gone = [];
      for (var i = 0; i < localStorage.length; i++) {
        var lk = localStorage.key(i), ck = toCloud(lk);
        if (!ck || ck in srv || C.dirty[ck]) continue;
        if (ck === 'active') { var a = raw.get(lk); if (!a || a.uid !== u) continue; }
        if (known[ck]) { gone.push(lk); continue; }                      // deleted on another device (e.g. the test was submitted there)
        if (ck.indexOf('pref:') === 0 || ck === 'gs_cur') continue;      // shared-device settings are sent only when this student changes them
        C.dirty[ck] = ++C.ver;                                           // saved here before the account storage existed: send it once
      }
      gone.forEach(raw.del);
      C.known = {}; Object.keys(srv).forEach(function (k) { C.known[k] = 1; });
      saveDirty(); saveKnown();
      C.on = true; C.loadedFor = u;
      try { C.tok = ((await SB.auth.getSession()).data.session || {}).access_token || ''; } catch (e) {}
      if (Object.keys(C.dirty).length) push();
      document.dispatchEvent(new Event('cloud:loaded'));
    } catch (e) { /* offline: work on this device and send later */ C.on = true; C.loadedFor = u; }
  };

  function payload(keys) {
    var p = {};
    keys.forEach(function (ck) { var v = raw.get(toLocal(ck)); p[ck] = v === undefined ? null : v; });
    return p;
  }
  async function push() {
    clearTimeout(C.timer); C.timer = 0;
    if (!C.on || C.off || !uid() || C.loadedFor !== uid()) return;
    var keys = Object.keys(C.dirty); if (!keys.length) return;
    if (C.busy) { C.timer = setTimeout(push, 3000); return; }
    C.busy = true;
    var sent = {}; keys.forEach(function (k) { sent[k] = C.dirty[k]; });
    try {
      var r = await rpc('ud_put', { p: payload(keys) });
      if (r.error) { if (missing(r.error)) C.off = true; }
      else { var pl = payload(keys); keys.forEach(function (k) { if (C.dirty[k] === sent[k]) delete C.dirty[k]; if (pl[k] === null) delete C.known[k]; else C.known[k] = 1; }); saveDirty(); saveKnown(); }
    } catch (e) {}
    C.busy = false;
    if (Object.keys(C.dirty).length && !C.timer) C.timer = setTimeout(push, 8000);   // retry / newer changes
  }
  window.cloudPush = push;

  /* leaving the page: send what is pending with a request the browser finishes on its own */
  function flushNow() {
    if (!C.on || C.off || !uid() || !Object.keys(C.dirty).length || !C.tok || typeof CFG === 'undefined' || !CFG.SUPABASE_URL) return;
    var keys = Object.keys(C.dirty), body = JSON.stringify({ p: payload(keys) });
    if (body.length > 60000) { push(); return; }          // keep-alive requests are limited to 64 KB
    var sent = {}; keys.forEach(function (k) { sent[k] = C.dirty[k]; });
    try {
      fetch(CFG.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/ud_put', { method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json', apikey: CFG.SUPABASE_KEY, Authorization: 'Bearer ' + C.tok }, body: body })
        .then(function (r) { if (r.ok) { keys.forEach(function (k) { if (C.dirty[k] === sent[k]) delete C.dirty[k]; if (raw.get(toLocal(k)) === undefined) delete C.known[k]; else C.known[k] = 1; }); saveDirty(); saveKnown(); } }).catch(function () {});
    } catch (e) {}
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushNow(); else if (C.on) refreshTok(); });
  window.addEventListener('pagehide', flushNow);
  async function refreshTok() { try { C.tok = ((await SB.auth.getSession()).data.session || {}).access_token || C.tok; } catch (e) {} }
  setInterval(function () { if (C.on) refreshTok(); }, 10 * 60 * 1000);

  /* logout: send what is left, then forget this student on the device */
  window.cloudLogout = async function () { try { await push(); } catch (e) {} C.on = false; C.loadedFor = ''; C.dirty = {}; C.known = {}; };
})();
