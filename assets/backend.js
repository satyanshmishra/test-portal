/* =====================================================================
   TEST PORTAL DATA LAYER
   config.js → BACKEND: "supabase"  papers + results in Supabase (backend/test_papers.sql)
               BACKEND: "sheets"    the old Google Sheet / Apps Script (API_URL)
   Both answer in the old Apps Script shape ({ok:true, ...}), so the pages
   work the same with either. Login errors carry e.auth = true.
   ===================================================================== */
(function () {
  var CFG = window.APP_CONFIG || {};
  var ON = String(CFG.BACKEND || 'sheets').toLowerCase() === 'supabase';

  function wait(ms) { return new Promise(function (_, rej) { setTimeout(function () { rej(new Error('The server is taking too long. Please check your internet and try again.')); }, ms); }); }

  async function call(SB, fn, args, ms) {
    if (!SB) throw new Error('Login service is not available');
    var r = await Promise.race([SB.rpc(fn, args || {}), wait(ms || 30000)]);
    if (r.error) {
      var m = String(r.error.message || 'Request failed');
      if (/^AUTH:/.test(m) || /JWT|jwt expired|not authenticated/i.test(m)) {
        var e = new Error(m.replace(/^AUTH:\s*/, '') || 'Please log in again.'); e.auth = true; throw e;
      }
      if (/Could not find the function/i.test(m)) m = 'The database is not set up yet (run backend/test_papers.sql in Supabase).';
      throw new Error(m);
    }
    return r.data;
  }

  /* student pages: api('me' | 'papers' | 'paper' | 'attempts' | 'attempt' | 'submit') */
  async function student(action, extra, SB) {
    extra = extra || {};
    switch (action) {
      case 'me':       return await call(SB, 'tp_me', { p_log: !!extra.log });
      case 'papers':   return { ok: true, papers: await call(SB, 'tp_papers_list') };
      case 'paper':    return { ok: true, paper: await call(SB, 'tp_paper', { p_id: String(extra.id) }) };
      case 'attempts': return { ok: true, attempts: await call(SB, 'tp_my_attempts') };
      case 'attempt':  return { ok: true, attempt: await call(SB, 'tp_my_attempt', { p_paper: String(extra.paperId) }) };
      case 'submit': {
        var p = {}; for (var k in extra) if (k !== 'action' && k !== 'localScore' && k !== 'localMax') p[k] = extra[k];
        return await call(SB, 'tp_submit', { p: p }, 45000);
      }
      default: throw new Error('Unknown action');
    }
  }

  /* teacher pages: admin(op, extra) — same operations as the old Apps Script admin */
  async function admin(op, extra, SB) {
    extra = extra || {};
    switch (op) {
      case 'login': {
        var a = await call(SB, 'live_is_admin');
        if (!a) throw new Error('This account is not the teacher account.');
        return { ok: true };
      }
      case 'papers':      return { ok: true, papers: await call(SB, 'tp_admin_papers') };
      case 'getPaper':    return { ok: true, paper: await call(SB, 'tp_admin_get', { p_id: String(extra.id) }) };
      case 'savePaper':   return await call(SB, 'tp_admin_save', { p_paper: extra.paper, p_id: extra.id || null }, 60000);
      case 'setActive':   return await call(SB, 'tp_admin_set', { p_id: String(extra.id), p_patch: { active: !!extra.active } });
      case 'setOrder':    return await call(SB, 'tp_admin_set', { p_id: String(extra.id), p_patch: { order: Number(extra.order) || 0 } });
      case 'setCategory': return await call(SB, 'tp_admin_set', { p_id: String(extra.id), p_patch: { category: String(extra.category) } });
      case 'deletePaper': return await call(SB, 'tp_admin_delete', { p_id: String(extra.id) });
      case 'results':     return await call(SB, 'tp_admin_results', { p_limit: Number(extra.limit) || 1000 });
      case 'reopen':      return await call(SB, 'tp_admin_reopen', { p_paper: String(extra.paperId), p_user: extra.userId || '',
                                                                     p_phone: extra.phone || '', p_email: extra.email || '' });
      default: throw new Error('Unknown admin operation');
    }
  }

  window.TP = { on: ON, student: student, admin: admin };
})();
