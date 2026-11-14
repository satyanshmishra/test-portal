/**
 * Satyansh's Test Papers — backend (Google Apps Script)   v2 (accounts + folders)
 * ==============================================================================
 * Paste this whole file into: Google Sheet → Extensions → Apps Script → Code.gs
 * (replace everything that is there now).
 *
 * Then: Deploy → Manage deployments → ✏️ Edit → Version: "New version" → Deploy.
 * (Use "Manage deployments", NOT "New deployment", so the Web App URL stays the same.)
 * Google will ask for permission again because this version contacts Supabase
 * to check student logins. Click Allow.
 *
 * Script properties (Project Settings → Script properties):
 *   ADMIN_PASSWORD = <your admin password>   (already set)
 *
 * Students now log in with the same email + password account as the doubt portal
 * (Supabase). Every student request carries the login token, and this script asks
 * Supabase whether that token is real before giving a paper or saving a result.
 *
 * Sheets (created / extended automatically):
 *   Papers   – one row per paper (+ new "Category" column = folder)
 *   Results  – one row per submitted test (+ new "Email" and "User ID" columns)
 *   Logins   – one row per student login (+ new "Email" column)
 */

var TZ = 'Asia/Kolkata';
var FOLDER_NAME = 'Satyansh Test Papers – Paper Files';

/* Supabase project shared with the doubt portal. The publishable key is public. */
var SUPABASE_URL = 'https://axznixboebvixkigojvj.supabase.co';
var SUPABASE_KEY = 'sb_publishable_g3vreHGOHm7lu4b91Qtahw_4uH-loXh';

/* Folder ids used in the Papers sheet "Category" column */
var CATEGORIES = ['topic', 'full', 'main3h'];

var PAPER_COLS = ['Paper ID', 'Paper Name', 'Exam', 'Subject', 'Duration (min)', 'Questions',
                  'Max Marks', 'Active', 'Order', 'Created', 'Updated', 'File ID', 'Category'];
var RESULT_COLS = ['Timestamp', 'Name', 'Phone', 'Paper ID', 'Paper Name', 'Score', 'Max Marks',
                   'Percentage', 'Correct', 'Incorrect', 'Unattempted', 'Accuracy %',
                   'Time Taken (min)', 'Auto Submitted', 'Strong Topics', 'Weak Topics',
                   'Question-wise Responses', 'Status', 'Attempt Data', 'Email', 'User ID'];
var LOGIN_COLS = ['Timestamp', 'Name', 'Phone', 'Email'];

/* column indexes (0-based) used below */
var R_PHONE = 2, R_PAPER = 3, R_STATUS = 17, R_DATA = 18, R_EMAIL = 19, R_UID = 20;
var P_CAT = 12;

/* ------------------------------------------------------------------ */
/*  HTTP entry points                                                  */
/* ------------------------------------------------------------------ */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'ping') return out_({ ok: true, time: now_() });
  return out_({ ok: true, service: "Satyansh's Test Papers API", version: 2 });
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return out_({ ok: false, error: 'Invalid request' }); }
  try {
    if (body.action === 'admin') return out_(admin_(body));
    var u = auth_(body.token);            // every student action needs a valid login
    switch (body.action) {
      case 'me':       return out_(me_(u, body));
      case 'papers':   return out_({ ok: true, papers: listPapers_(false) });
      case 'paper':    return out_({ ok: true, paper: getPaper_(body.id, false) });
      case 'attempts': return out_({ ok: true, attempts: attemptsFor_(u) });
      case 'attempt':  return out_({ ok: true, attempt: attemptDetail_(u, body.paperId) });
      case 'submit':   return out_(submit_(u, body));
      default:         return out_({ ok: false, error: 'Unknown action' });
    }
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------------ */
/*  Login check (Supabase)                                             */
/* ------------------------------------------------------------------ */
function auth_(token) {
  token = String(token || '');
  if (token.length < 20) throw new Error('AUTH: Please log in again.');
  var cache = CacheService.getScriptCache();
  var key = 'tok_' + Utilities.base64EncodeWebSafe(
      Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)).slice(0, 40);
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  var res = UrlFetchApp.fetch(SUPABASE_URL + '/auth/v1/user', {
    method: 'get', muteHttpExceptions: true,
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + token }
  });
  if (res.getResponseCode() !== 200) throw new Error('AUTH: Your login has expired. Please log in again.');
  var s = JSON.parse(res.getContentText());
  if (!s || !s.id || !s.email) throw new Error('AUTH: Please log in again.');
  if (!s.email_confirmed_at && !s.confirmed_at) throw new Error('AUTH: Please confirm your email first.');
  var m = s.user_metadata || {};
  var u = { id: String(s.id), email: String(s.email).toLowerCase(),
            name: String(m.full_name || m.name || '').trim().slice(0, 80),
            phone: cleanPhone_(m.phone) };
  cache.put(key, JSON.stringify(u), 300);   // 5 minutes
  return u;
}

/* ------------------------------------------------------------------ */
/*  Sheet helpers                                                      */
/* ------------------------------------------------------------------ */
var CHECKED_ = {};
function sheet_(name, cols) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#e8eff9');
    sh.setFrozenRows(1);
    CHECKED_[name] = true;
  }
  if (!CHECKED_[name]) {                 // add any new header columns to an old sheet
    var have = sh.getLastColumn();
    if (have < cols.length) {
      sh.getRange(1, have + 1, 1, cols.length - have).setValues([cols.slice(have)])
        .setFontWeight('bold').setBackground('#e8eff9');
    }
    CHECKED_[name] = true;
  }
  return sh;
}
function rows_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
}
function now_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }
function cleanPhone_(p) {
  p = String(p || '').replace(/[^\d]/g, '');
  if (p.length === 12 && p.indexOf('91') === 0) p = p.slice(2);
  if (p.length === 11 && p.charAt(0) === '0') p = p.slice(1);
  return p;
}
function folder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var f = DriveApp.createFolder(FOLDER_NAME);
  props.setProperty('FOLDER_ID', f.getId());
  return f;
}
function cleanCat_(c, durationMin) {
  c = String(c || '').trim().toLowerCase();
  if (CATEGORIES.indexOf(c) >= 0) return c;
  return Number(durationMin) >= 180 ? 'main3h' : 'topic';   // sensible default for old papers
}

/* ------------------------------------------------------------------ */
/*  Papers                                                             */
/* ------------------------------------------------------------------ */
function paperRowObj_(r) {
  return { id: String(r[0]), name: r[1], exam: r[2], subject: r[3], durationMin: Number(r[4]),
           questions: Number(r[5]), maxMarks: Number(r[6]),
           active: r[7] === true || String(r[7]).toUpperCase() === 'TRUE' || String(r[7]).toLowerCase() === 'yes',
           order: Number(r[8]) || 0, created: String(r[9]), updated: String(r[10]), fileId: String(r[11]),
           category: cleanCat_(r[P_CAT], r[4]) };
}
function listPapers_(includeHidden) {
  var list = rows_(sheet_('Papers', PAPER_COLS)).filter(function (r) { return r[0] !== ''; }).map(paperRowObj_);
  if (!includeHidden) list = list.filter(function (p) { return p.active; });
  list.sort(function (a, b) { return (a.order - b.order) || String(a.created).localeCompare(String(b.created)); });
  return list.map(function (p) { var o = {}; for (var k in p) if (k !== 'fileId') o[k] = p[k]; return o; });
}
function findPaperRow_(id) {
  var sh = sheet_('Papers', PAPER_COLS), data = rows_(sh);
  for (var i = 0; i < data.length; i++) if (String(data[i][0]) === String(id)) return { sh: sh, row: i + 2, obj: paperRowObj_(data[i]) };
  return null;
}
function getPaper_(id, allowHidden) {
  var f = findPaperRow_(id);
  if (!f || (!f.obj.active && !allowHidden)) throw new Error('Paper not found');
  var cache = CacheService.getScriptCache(), key = 'paper_' + id + '_' + f.obj.updated.replace(/\D/g, '');
  var txt = cache.get(key);
  if (!txt) {
    txt = DriveApp.getFileById(f.obj.fileId).getBlob().getDataAsString('UTF-8');
    if (txt.length < 90000) cache.put(key, txt, 21600);
  }
  var paper = JSON.parse(txt);
  paper.id = f.obj.id;
  paper.settings = paper.settings || {};
  paper.settings.category = f.obj.category;
  return paper;
}
function maxMarks_(paper) {
  var m = {};
  (paper.sections || []).forEach(function (s) { m[s.id] = Number(s.correct); });
  return paper.questions.reduce(function (t, q) { return t + (m[q.section] || 0); }, 0);
}

/* ------------------------------------------------------------------ */
/*  Students                                                           */
/* ------------------------------------------------------------------ */
function me_(u, b) {
  if (b.log) sheet_('Logins', LOGIN_COLS).appendRow([now_(), u.name, u.phone ? "'" + u.phone : '', u.email]);
  return { ok: true, user: u, attempts: attemptsFor_(u) };
}

/* Is this Results row one of this student's attempts?
   New rows carry the Supabase user id. Old rows (before accounts) only have a phone,
   so they are linked through the phone number saved in the student's profile. */
function mine_(r, u) {
  var uid = String(r[R_UID] || '');
  if (uid) return uid === u.id;
  return !!u.phone && cleanPhone_(r[R_PHONE]) === u.phone;
}
function counted_(r) { return String(r[R_STATUS]).toLowerCase().indexOf('reopen') < 0; }

function attemptsFor_(u) {
  return rows_(sheet_('Results', RESULT_COLS))
    .filter(function (r) { return mine_(r, u) && counted_(r); })
    .map(function (r) { return { paperId: String(r[R_PAPER]), paperName: r[4], score: r[5], maxMarks: r[6], time: String(r[0]) }; });
}
function attemptDetail_(u, paperId) {
  var data = rows_(sheet_('Results', RESULT_COLS));
  for (var i = data.length - 1; i >= 0; i--) {
    var r = data[i];
    if (mine_(r, u) && String(r[R_PAPER]) === String(paperId) && counted_(r)) {
      var d = {}; try { d = JSON.parse(r[R_DATA] || '{}'); } catch (e) {}
      d.name = r[1]; d.timestamp = String(r[0]); d.score = r[5];
      return d;
    }
  }
  throw new Error('No attempt found');
}

/* Grade on the server too, so the sheet always has the true score */
function grade_(paper, ans) {
  var sec = {}; (paper.sections || []).forEach(function (s) { sec[s.id] = s; });
  var res = { score: 0, c: 0, w: 0, u: 0, marks: [] };
  paper.questions.forEach(function (q, i) {
    var a = ans[i], s = sec[q.section] || { correct: 4, wrong: -1 }, m = 0;
    if (a === null || a === undefined || a === '') { res.u++; }
    else {
      var ok = q.type === 'mcq' ? Number(a) === Number(q.ans)
             : Math.abs(parseFloat(a) - Number(q.ans)) <= (q.tol != null ? Number(q.tol) : 0.001) + 1e-9;
      if (ok) { res.c++; m = Number(s.correct); } else { res.w++; m = Number(s.wrong); }
    }
    res.marks.push(m); res.score += m;
  });
  return res;
}

function submit_(u, b) {
  var name = u.name || String(b.name || '').trim().slice(0, 80);
  var paper = getPaper_(b.paperId, true);
  var ans = (b.ans || []).slice(0, paper.questions.length);
  while (ans.length < paper.questions.length) ans.push(null);
  var g = grade_(paper, ans), max = maxMarks_(paper);
  var letters = 'ABCDEFGH';
  var qwise = paper.questions.map(function (q, i) {
    var a = ans[i];
    var shown = (a === null || a === undefined || a === '') ? '-' : (q.type === 'mcq' ? letters.charAt(Number(a)) : String(a));
    return 'Q' + (i + 1) + ':' + shown + (g.marks[i] > 0 ? '✓' : (shown === '-' ? '' : '✗'));
  }).join(' ');
  var attData = JSON.stringify({ ans: ans, mark: b.mark || [], time: b.time || [], auto: !!b.auto,
                                 taken: Number(b.taken) || 0, submitAt: b.submitAt || 0, start: b.start || 0 });

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    // idempotent: the same submission sent twice (network retry) is stored once
    var sh = sheet_('Results', RESULT_COLS), data = rows_(sh);
    for (var i = data.length - 1; i >= 0 && i >= data.length - 300; i--) {
      if (String(data[i][R_UID]) === u.id && String(data[i][R_PAPER]) === String(b.paperId)) {
        try { if (b.submitAt && JSON.parse(data[i][R_DATA] || '{}').submitAt === b.submitAt) return { ok: true, duplicate: true, score: g.score, maxMarks: max }; } catch (e) {}
      }
    }
    var already = attemptsFor_(u).some(function (a) { return a.paperId === String(b.paperId); });
    var att = g.c + g.w;
    sh.appendRow([now_(), name, u.phone ? "'" + u.phone : '', String(b.paperId), paper.settings && paper.settings.paperName || b.paperName || '',
                  g.score, max, max ? Math.round(g.score / max * 1000) / 10 : 0, g.c, g.w, g.u,
                  att ? Math.round(g.c / att * 100) : 0, Math.round((Number(b.taken) || 0) / 600) / 100,
                  b.auto ? 'Yes' : 'No', String(b.strong || ''), String(b.weak || ''), qwise,
                  already ? 'Extra attempt' : '', attData, u.email, u.id]);
  } finally { lock.releaseLock(); }
  return { ok: true, score: g.score, maxMarks: max };
}

/* ------------------------------------------------------------------ */
/*  Admin                                                              */
/* ------------------------------------------------------------------ */
function admin_(b) {
  var pass = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!pass) return { ok: false, error: 'ADMIN_PASSWORD is not set in Script properties' };
  if (String(b.password) !== pass) { Utilities.sleep(800); return { ok: false, error: 'Wrong password' }; }

  switch (b.op) {
    case 'login':
      return { ok: true, sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl() };
    case 'papers':
      return { ok: true, papers: listPapers_(true) };
    case 'getPaper':
      return { ok: true, paper: getPaper_(b.id, true) };
    case 'savePaper':
      return savePaper_(b.paper, b.id);
    case 'setActive': {
      var f = findPaperRow_(b.id); if (!f) return { ok: false, error: 'Paper not found' };
      f.sh.getRange(f.row, 8).setValue(!!b.active); return { ok: true };
    }
    case 'setOrder': {
      var g = findPaperRow_(b.id); if (!g) return { ok: false, error: 'Paper not found' };
      g.sh.getRange(g.row, 9).setValue(Number(b.order) || 0); return { ok: true };
    }
    case 'setCategory': {
      var c = findPaperRow_(b.id); if (!c) return { ok: false, error: 'Paper not found' };
      if (CATEGORIES.indexOf(String(b.category)) < 0) return { ok: false, error: 'Unknown folder' };
      c.sh.getRange(c.row, P_CAT + 1).setValue(String(b.category)); return { ok: true };
    }
    case 'deletePaper': {
      var d = findPaperRow_(b.id); if (!d) return { ok: false, error: 'Paper not found' };
      try { DriveApp.getFileById(d.obj.fileId).setTrashed(true); } catch (e) {}
      d.sh.deleteRow(d.row); return { ok: true };
    }
    case 'results': {
      var data = rows_(sheet_('Results', RESULT_COLS));
      var list = data.map(function (r, i) {
        return { row: i + 2, time: String(r[0]), name: r[1], phone: cleanPhone_(r[R_PHONE]), paperId: String(r[R_PAPER]),
                 paperName: r[4], score: r[5], maxMarks: r[6], pct: r[7], correct: r[8], wrong: r[9],
                 skipped: r[10], minutes: r[12], auto: r[13], status: r[R_STATUS],
                 email: String(r[R_EMAIL] || ''), userId: String(r[R_UID] || '') };
      }).reverse();
      return { ok: true, results: list.slice(0, Number(b.limit) || 500), total: list.length };
    }
    case 'reopen': {
      var sh = sheet_('Results', RESULT_COLS), rows = rows_(sh), n = 0;
      var who = { id: String(b.userId || ''), phone: cleanPhone_(b.phone) };
      rows.forEach(function (r, i) {
        if (String(r[R_PAPER]) !== String(b.paperId) || !counted_(r)) return;
        var uid = String(r[R_UID] || '');
        var match = who.id ? (uid === who.id || (!uid && !!who.phone && cleanPhone_(r[R_PHONE]) === who.phone))
                           : (!!who.phone && cleanPhone_(r[R_PHONE]) === who.phone);
        if (match) { sh.getRange(i + 2, R_STATUS + 1).setValue('Reopened ' + now_()); n++; }
      });
      return { ok: true, reopened: n };
    }
    default:
      return { ok: false, error: 'Unknown admin operation' };
  }
}

function savePaper_(paper, id) {
  if (!paper || !paper.questions || !paper.questions.length) return { ok: false, error: 'Paper has no questions' };
  var st = paper.settings || {};
  if (!st.paperName) return { ok: false, error: 'Paper name is required' };
  var cat = cleanCat_(st.category, st.durationMin);
  st.category = cat; paper.settings = st;
  var txt = JSON.stringify(paper), stamp = now_(), max = maxMarks_(paper);
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    if (id) {
      var f = findPaperRow_(id); if (!f) return { ok: false, error: 'Paper not found' };
      DriveApp.getFileById(f.obj.fileId).setContent(txt);
      f.sh.getRange(f.row, 2, 1, 6).setValues([[st.paperName, st.exam || '', st.subject || '', Number(st.durationMin) || 60,
                                                 paper.questions.length, max]]);
      f.sh.getRange(f.row, 11).setValue(stamp);
      f.sh.getRange(f.row, P_CAT + 1).setValue(cat);
      return { ok: true, id: id };
    }
    var newId = 'P' + new Date().getTime().toString(36).toUpperCase();
    var file = folder_().createFile(newId + ' - ' + st.paperName + '.json', txt, MimeType.PLAIN_TEXT);
    var sh = sheet_('Papers', PAPER_COLS);
    var order = rows_(sh).length + 1;
    sh.appendRow([newId, st.paperName, st.exam || '', st.subject || '', Number(st.durationMin) || 60,
                  paper.questions.length, max, true, order, stamp, stamp, file.getId(), cat]);
    return { ok: true, id: newId };
  } finally { lock.releaseLock(); }
}

/* Run this once from the editor after pasting: it adds the new columns,
   fills the folder for old papers, and asks for the Supabase permission. */
function setup() {
  var ps = sheet_('Papers', PAPER_COLS); sheet_('Results', RESULT_COLS); sheet_('Logins', LOGIN_COLS); folder_();
  SpreadsheetApp.getActiveSpreadsheet().setSpreadsheetTimeZone(TZ);
  rows_(ps).forEach(function (r, i) {
    if (r[0] !== '' && CATEGORIES.indexOf(String(r[P_CAT])) < 0) ps.getRange(i + 2, P_CAT + 1).setValue(cleanCat_('', r[4]));
  });
  UrlFetchApp.fetch(SUPABASE_URL + '/auth/v1/health', { muteHttpExceptions: true, headers: { apikey: SUPABASE_KEY } });
}
