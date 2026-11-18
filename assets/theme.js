/* Dark mode: <html data-theme="dark">, remembered on this device (localStorage "stp_theme").
   Loaded in <head> so the page never flashes white. Adds a 🌙/☀️ button to every top bar
   and a floating one on screens without a top bar (login). */
(function () {
  var KEY = 'stp_theme', root = document.documentElement;
  function get() { try { var v = localStorage.getItem(KEY); try { return JSON.parse(v); } catch (e) { return v; } } catch (e) { return null; } }
  function set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} if (window.cloudTouch) cloudTouch(KEY); }
  function apply(t) {
    root.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'dark' ? '#131a28' : '#1f4e8c');
    var bs = document.querySelectorAll('.theme-btn');
    for (var i = 0; i < bs.length; i++) {
      bs[i].textContent = t === 'dark' ? '☀️' : '🌙';
      bs[i].title = t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
      bs[i].setAttribute('aria-label', bs[i].title);
    }
  }
  var saved = get();
  apply(saved === 'dark' ? 'dark' : 'light');

  function toggle() {
    var t = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    set(t); apply(t);
  }
  window.toggleTheme = toggle;
  document.addEventListener('cloud:loaded', function () { apply(get() === 'dark' ? 'dark' : 'light'); });   // the account's choice

  function mk(cls) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'theme-btn ' + cls;
    b.addEventListener('click', toggle);
    return b;
  }
  function addButtons() {
    var bars = document.querySelectorAll('.topbar-in');
    for (var i = 0; i < bars.length; i++) {
      if (bars[i].querySelector('.theme-btn')) continue;
      var tb = bars[i].querySelector('.timer-box');
      if (tb) { tb.insertAdjacentElement('afterend', mk('in-bar')); continue; }   // exam: right next to the clock
      bars[i].appendChild(mk('in-bar'));        // last item of the bar; on phones it sits at the top-right, level with the heading
    }
    if (!document.querySelector('.theme-btn.floating')) document.body.appendChild(mk('floating'));
    apply(root.getAttribute('data-theme'));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addButtons);
  else addButtons();
})();
