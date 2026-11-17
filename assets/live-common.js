/* Shared helpers for the Live Quiz pages (live.html for students, live-host.html for the host). */
(function () {
  const CFG = window.APP_CONFIG || {};
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  let SB = null;
  try { if (window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_KEY) SB = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY); } catch (e) {}

  /* call a database function; throws a readable Error */
  async function rpc(name, args, tries = 2) {
    if (!SB) throw new Error('The quiz server is not connected.');
    let last;
    for (let t = 0; t <= tries; t++) {
      try {
        const { data, error } = await SB.rpc(name, args || {});
        if (error) {
          const m = String(error.message || 'Request failed');
          if (/Could not find the function|does not exist/i.test(m)) throw Object.assign(new Error('The live quiz is not set up in the database yet (run backend/live_quiz.sql).'), { fatal: true });
          throw Object.assign(new Error(m), { fatal: true });
        }
        return data;
      } catch (e) {
        last = e; if (e.fatal) throw e;
        await new Promise(r => setTimeout(r, 400 * (t + 1)));
      }
    }
    throw new Error('Network problem: ' + (last && last.message || 'please check your internet'));
  }

  /* server clock: serverNow() is the database time, so every phone counts down together */
  let OFFSET = 0;
  async function syncClock() {
    try {
      const t0 = Date.now(); const s = await rpc('live_now', {}, 1); const t1 = Date.now();
      OFFSET = new Date(s).getTime() - (t0 + t1) / 2;
    } catch (e) {}
  }
  const serverNow = () => Date.now() + OFFSET;
  const setOffsetFrom = iso => { if (iso) OFFSET = new Date(iso).getTime() - Date.now(); };

  function typeset(el, tries = 0) {
    if (!el) return;
    if (window.MathJax && MathJax.startup && MathJax.startup.promise && MathJax.typesetPromise) {
      MathJax.startup.promise = MathJax.startup.promise
        .then(() => { if (MathJax.typesetClear) MathJax.typesetClear([el]); return MathJax.typesetPromise([el]); })
        .catch(() => {});
    } else if (tries < 40) setTimeout(() => typeset(el, tries + 1), 150);
  }

  /* ---------- sounds (no files needed) ---------- */
  let AC = null, SOUND = LS.get('live_sound', true);
  function beep(freq = 660, ms = 120, type = 'sine', vol = 0.18, when = 0) {
    if (!SOUND) return;
    try {
      AC = AC || new (window.AudioContext || window.webkitAudioContext)();
      if (AC.state === 'suspended') AC.resume();
      const o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime + when;
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
      o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t + ms / 1000 + 0.05);
    } catch (e) {}
  }
  const SFX = {
    tick:  () => beep(880, 70, 'square', 0.06),
    go:    () => { beep(523, 120, 'triangle'); beep(784, 220, 'triangle', 0.2, 0.12); },
    count: () => beep(440, 140, 'triangle', 0.15),
    ding:  () => { beep(988, 160, 'sine', 0.2); beep(1319, 260, 'sine', 0.18, 0.12); },
    wrong: () => { beep(220, 220, 'sawtooth', 0.08); },
    join:  () => beep(1200, 60, 'sine', 0.08),
    fanfare: () => [523, 659, 784, 1047].forEach((f, i) => beep(f, 260, 'triangle', 0.18, i * 0.16))
  };
  function setSound(on) { SOUND = !!on; LS.set('live_sound', SOUND); }

  /* ---------- confetti ---------- */
  function confetti(ms = 3500) {
    const c = document.createElement('canvas');
    c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999';
    document.body.appendChild(c);
    const x = c.getContext('2d'), W = c.width = innerWidth, H = c.height = innerHeight;
    const cols = ['#ff4d6d', '#3d8bff', '#ffb020', '#22c55e', '#35e0ff', '#ffd54a', '#b388ff'];
    const P = Array.from({ length: 180 }, () => ({ x: Math.random() * W, y: -20 - Math.random() * H * 0.6, r: 4 + Math.random() * 6,
      vx: -2 + Math.random() * 4, vy: 2 + Math.random() * 4, a: Math.random() * 6, va: -0.2 + Math.random() * 0.4, c: cols[Math.random() * cols.length | 0] }));
    const t0 = performance.now();
    (function f(t) {
      x.clearRect(0, 0, W, H);
      P.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += 0.04; p.a += p.va;
        x.save(); x.translate(p.x, p.y); x.rotate(p.a); x.fillStyle = p.c; x.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); x.restore(); });
      if (t - t0 < ms) requestAnimationFrame(f); else c.remove();
    })(t0);
  }

  const OPT = [
    { l: 'A', c: 'var(--oA)' }, { l: 'B', c: 'var(--oB)' }, { l: 'C', c: 'var(--oC)' },
    { l: 'D', c: 'var(--oD)' }, { l: 'E', c: 'var(--oE)' }, { l: 'F', c: 'var(--oF)' }
  ];
  const nf = n => Number(n || 0).toLocaleString('en-IN');
  const ord = n => { n = Number(n); const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

  window.LIVE = { CFG, $, esc, LS, SB, rpc, syncClock, serverNow, setOffsetFrom, typeset, beep, SFX, setSound,
                  get sound() { return SOUND; }, confetti, OPT, nf, ord };
})();
