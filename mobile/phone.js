/* Feature-phone simulator. Talks to the real Harmony server's /api/dev endpoints:
   USSD sessions, two-way SMS, voice IVR calls (with speech), M-Pesa / Airtel PIN prompts
   and guide call-backs. Only active when the server runs with DEV_TOOLS. */
(function () {
  'use strict';

  var App = window.HarmonyApp;
  var $ = function (id) { return document.getElementById(id); };
  var mount = $('phoneMount');
  // Demo lines across Africa (international format so they work whatever the home country is).
  var LINES = [
    { id: 'ke-saf', label: '🇰🇪 Safaricom', number: '+254712345678' },
    { id: 'ke-air', label: '🇰🇪 Airtel', number: '+254733123456' },
    { id: 'ug-mtn', label: '🇺🇬 MTN', number: '+256772123456' },
    { id: 'gh-mtn', label: '🇬🇭 MTN', number: '+233241234567' },
    { id: 'ci-orange', label: '🇨🇮 Orange', number: '+2250701234567' },
    { id: 'bj', label: '🇧🇯 Benin', number: '+2290197123456' }
  ];
  var LINE_KEY = 'harmony-sim-line';

  var cfg = null;
  var line = LINES[0].number;
  var screen = 'home';
  var state = {};
  var inbox = [];
  var seenSms = {};
  var handledCalls = {};
  var dismissedPrompts = {};
  var prompts = [];
  var pollTimer = null;
  var clockTimer = null;
  var sound = true;
  var el = {};

  function api(method, path, body) { return App.api(method, path, body); }
  function pretty(n) { return App.pretty('+' + App.normalize(n)); }
  function network() {
    var l = App.lookup('+' + line);
    if (!l) return 'No network';
    return (l.network ? l.network.name : l.country.name) + ' ' + l.country.code;
  }
  function sessionKey(k) { return 'harmony-sim:' + App.normalize(line) + ':' + k; }
  function loadSet(k) { try { return JSON.parse(sessionStorage.getItem(sessionKey(k)) || '{}'); } catch (e) { return {}; } }
  function saveSet(k, v) { try { sessionStorage.setItem(sessionKey(k), JSON.stringify(v)); } catch (e) {} }

  // ── Sound: key clicks, SMS tone, ringtone, speech ──
  var audio = null;
  function tone(freq, ms, when) {
    if (!sound) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      var o = audio.createOscillator();
      var g = audio.createGain();
      o.type = 'square';
      o.frequency.value = freq;
      g.gain.value = 0.04;
      o.connect(g);
      g.connect(audio.destination);
      var t = audio.currentTime + (when || 0);
      o.start(t);
      o.stop(t + ms / 1000);
    } catch (e) {}
  }
  function smsTone() { tone(1318, 90); tone(1568, 90, 0.12); tone(2093, 140, 0.24); }
  var ringTimer = null;
  function ring(on) {
    clearInterval(ringTimer);
    if (!on) return;
    var burst = function () { tone(988, 120); tone(784, 120, 0.15); tone(988, 120, 0.3); tone(784, 120, 0.45); };
    burst();
    ringTimer = setInterval(burst, 1800);
  }
  function speak(text) {
    if (!sound || !('speechSynthesis' in window)) return;
    var u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02;
    u.lang = 'en-GB';
    window.speechSynthesis.speak(u);
  }
  function hush() { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); }
  function buzz() {
    el.phone.classList.remove('buzz');
    void el.phone.offsetWidth;
    el.phone.classList.add('buzz');
    if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
  }

  // ── Build the handset ──
  function build() {
    mount.innerHTML =
      '<div class="phone" id="simPhone" tabindex="0" aria-label="Simulated feature phone. Use the keypad or your keyboard.">' +
        '<div class="phone-speaker"></div><div class="phone-brand">HARMONY</div>' +
        '<div class="lcd" id="lcd" aria-live="polite">' +
          '<div class="lcd-status"><span id="lcdNet"></span><span class="bars" aria-hidden="true"><i style="height:3px"></i><i style="height:5px"></i><i style="height:7px"></i><i style="height:10px"></i></span><span id="lcdTime"></span></div>' +
          '<div class="lcd-main" id="lcdMain"></div>' +
          '<div class="lcd-soft"><span id="softL"></span><span id="softR"></span></div>' +
        '</div>' +
        '<div class="keys top">' +
          '<button class="key soft" data-k="softL" aria-label="Left soft key">&#9644;</button>' +
          '<button class="key nav" data-k="up" aria-label="Up">&#9650;</button>' +
          '<button class="key soft" data-k="softR" aria-label="Right soft key">&#9644;</button>' +
          '<button class="key call" data-k="call" aria-label="Call / send"><svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1z"/></svg></button>' +
          '<button class="key nav" data-k="down" aria-label="Down">&#9660;</button>' +
          '<button class="key end" data-k="end" aria-label="End / back"><svg width="18" height="18" viewBox="0 0 24 24" fill="#fff" style="transform:rotate(135deg)"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1z"/></svg></button>' +
        '</div>' +
        '<div class="keys">' +
          key('1', '.,?') + key('2', 'ABC') + key('3', 'DEF') +
          key('4', 'GHI') + key('5', 'JKL') + key('6', 'MNO') +
          key('7', 'PQRS') + key('8', 'TUV') + key('9', 'WXYZ') +
          key('*', '+') + key('0', '_') + key('#', '&#8679;') +
        '</div>' +
      '</div>' +
      '<div class="sim-actions">' +
        '<button class="btn ghost small" type="button" id="simUssd">Dial USSD</button>' +
        '<button class="btn ghost small" type="button" id="simCall">Call Harmony</button>' +
        '<button class="btn ghost small" type="button" id="simSms">Text HELP</button>' +
        '<button class="btn ghost small" type="button" id="simSound" aria-pressed="true">Sound on</button>' +
      '</div>' +
      '<p class="phone-foot">Click the phone and type on your keyboard too. Enter = call/send, Esc = end.</p>';

    el.phone = $('simPhone');
    el.main = $('lcdMain');
    el.softL = $('softL');
    el.softR = $('softR');
    el.net = $('lcdNet');
    el.time = $('lcdTime');

    el.phone.addEventListener('click', function (e) {
      var k = e.target.closest('[data-k]');
      if (k) {
        k.classList.add('pressed');
        setTimeout(function () { k.classList.remove('pressed'); }, 90);
        press(k.dataset.k);
      }
    });
    el.phone.addEventListener('keydown', function (e) {
      if (e.target.classList && e.target.classList.contains('lcd-input')) {
        if (e.key === 'Enter') { e.preventDefault(); press(screen === 'dial' ? 'call' : 'softL'); }
        if (e.key === 'Escape') { e.preventDefault(); press('end'); }
        return;
      }
      var map = { Enter: 'call', Escape: 'end', ArrowUp: 'up', ArrowDown: 'down', Backspace: 'softR' };
      if (map[e.key]) { e.preventDefault(); press(map[e.key]); return; }
      if (/^[0-9*#]$/.test(e.key)) { e.preventDefault(); press(e.key); }
    });
    $('simUssd').addEventListener('click', function () { if (cfg) startUssd(); });
    $('simCall').addEventListener('click', function () { startCall(null); });
    $('simSms').addEventListener('click', function () { sendSms('HELP'); });
    $('simSound').addEventListener('click', function () {
      sound = !sound;
      this.textContent = sound ? 'Sound on' : 'Sound off';
      this.setAttribute('aria-pressed', sound ? 'true' : 'false');
      if (!sound) { hush(); ring(false); }
    });
    tickClock();
    clockTimer = setInterval(tickClock, 20000);
  }
  function key(d, sub) { return '<button class="key" data-k="' + d + '">' + d + '<small>' + sub + '</small></button>'; }

  function tickClock() {
    var d = new Date();
    el.time.textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    el.net.textContent = network();
    if (screen === 'home') render();
  }

  function renderLines() {
    var wrap = $('simLines');
    wrap.innerHTML = '';
    LINES.forEach(function (l) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'sim-line';
      b.setAttribute('aria-pressed', App.normalize(l.number) === App.normalize(line) ? 'true' : 'false');
      b.textContent = l.label;
      b.title = pretty(l.number);
      b.addEventListener('click', function () { setLine(l.number); });
      wrap.appendChild(b);
    });
    var custom = document.createElement('button');
    custom.type = 'button';
    custom.className = 'sim-line';
    var isCustom = !LINES.some(function (l) { return App.normalize(l.number) === App.normalize(line); });
    custom.setAttribute('aria-pressed', isCustom ? 'true' : 'false');
    custom.textContent = isCustom ? 'Other · ' + pretty(line) : 'Other number';
    custom.addEventListener('click', function () {
      var n = window.prompt('Number to simulate, with country code (e.g. +256 772 000 111):', '');
      if (n && App.normalize(n)) setLine(n);
    });
    wrap.appendChild(custom);
  }

  function setLine(n) {
    line = App.normalize(n);
    try { localStorage.setItem(LINE_KEY, line); } catch (e) {}
    seenSms = loadSet('seen');
    handledCalls = loadSet('calls');
    inbox = [];
    prompts = [];
    hangup(true);
    if (el.net) el.net.textContent = network();
    go('home');
    renderLines();
    document.dispatchEvent(new CustomEvent('harmony:simline', { detail: { phone: line, pretty: pretty(line) } }));
    refresh();
  }

  // ── Screens ──
  function go(next, patch) {
    screen = next;
    state = patch || {};
    render();
  }

  function soft(l, r) { el.softL.textContent = l || ''; el.softR.textContent = r || ''; }

  function text(t) {
    el.main.innerHTML = '';
    var div = document.createElement('div');
    div.textContent = t;
    el.main.appendChild(div);
    return div;
  }

  function inputLine(opts) {
    var input = document.createElement('input');
    input.className = 'lcd-input';
    input.type = opts.password ? 'password' : 'text';
    input.inputMode = opts.numeric ? 'numeric' : 'text';
    input.autocomplete = 'off';
    input.maxLength = opts.max || 160;
    input.placeholder = opts.placeholder || '';
    input.setAttribute('aria-label', opts.label || 'Phone input');
    input.value = opts.value || '';
    el.main.appendChild(input);
    setTimeout(function () { if (document.activeElement !== input && isVisible()) input.focus({ preventScroll: true }); }, 30);
    return input;
  }

  function isVisible() { return el.phone && el.phone.offsetParent !== null; }

  function render() {
    if (!el.main) return;
    var lcd = $('lcd');
    lcd.classList.toggle('dark', screen === 'call' || screen === 'ringing');
    var unread = inbox.filter(function (m) { return !m.read; }).length;

    switch (screen) {
      case 'home': {
        var d = new Date();
        el.main.innerHTML = '<div class="lcd-big"></div><div class="lcd-center"></div><div class="lcd-center" style="margin-top:14px;font-size:11.5px"></div>';
        el.main.children[0].textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        el.main.children[1].textContent = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
        el.main.children[2].textContent = unread ? unread + ' new message' + (unread > 1 ? 's' : '') : 'Dial ' + ((cfg && cfg.ussdCode) || '*384*2026#');
        soft('Menu', unread ? 'Inbox(' + unread + ')' : 'Inbox');
        break;
      }
      case 'menu': {
        var items = ['Messages', 'Write message', 'Harmony USSD', 'Call Harmony'];
        el.main.innerHTML = '<ul class="lcd-inbox"></ul>';
        items.forEach(function (label, i) {
          var li = document.createElement('li');
          li.textContent = (i + 1) + ' ' + label;
          if (i === (state.sel || 0)) li.className = 'sel';
          li.addEventListener('click', function () { state.sel = i; press('softL'); });
          el.main.firstChild.appendChild(li);
        });
        soft('Select', 'Back');
        break;
      }
      case 'dial':
        el.main.innerHTML = '<div class="lcd-big" style="font-size:20px;word-break:break-all"></div>';
        el.main.firstChild.textContent = state.buffer || '';
        soft('Call', 'Clear');
        break;
      case 'ussd': {
        if (state.loading) { text('\n\nUSSD code running...'); soft('', 'Cancel'); break; }
        text(state.body || '');
        if (state.open) {
          state.input = inputLine({ numeric: !state.freeText, label: 'USSD reply', placeholder: state.freeText ? 'type here' : '' });
          soft('Send', 'Cancel');
        } else {
          soft('OK', '');
        }
        break;
      }
      case 'inbox': {
        if (!inbox.length) { text('\nNo messages yet.\n\nText HELP to ' + ((cfg && cfg.smsShortcode) || '22384') + '.'); soft('Write', 'Back'); break; }
        el.main.innerHTML = '<ul class="lcd-inbox"></ul>';
        inbox.forEach(function (m, i) {
          var li = document.createElement('li');
          li.textContent = m.body;
          li.className = (i === (state.sel || 0) ? 'sel ' : '') + (m.read ? '' : 'unread');
          li.addEventListener('click', function () { state.sel = i; press('softL'); });
          el.main.firstChild.appendChild(li);
        });
        var selEl = el.main.querySelector('.sel');
        if (selEl) selEl.scrollIntoView({ block: 'nearest' });
        soft('Read', 'Back');
        break;
      }
      case 'read': {
        var msg = inbox[state.index];
        text('From: HARMONY\n' + new Date(msg.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + '\n\n' + msg.body);
        soft('Reply', 'Back');
        break;
      }
      case 'compose':
        text('To: ' + ((cfg && cfg.smsShortcode) || '22384'));
        state.input = inputLine({ label: 'Message text', placeholder: 'LESSON, QUIZ, ASK ...', value: state.draft || '', max: 300 });
        soft('Send', 'Back');
        break;
      case 'sent':
        text('\n\nMessage sent');
        soft('', '');
        break;
      case 'stk': {
        var p = state.prompt;
        var brand = (p.walletLabel || 'Mobile money').toUpperCase();
        text(brand + '\nPay ' + p.amountLabel + ' to HARMONY COAST?\nEnter ' + (p.walletLabel || 'mobile money') + ' PIN:');
        state.input = inputLine({ password: true, numeric: true, max: 4, label: 'PIN', placeholder: '****' });
        soft('OK', 'Cancel');
        break;
      }
      case 'stk-done':
        text('\n' + state.message);
        soft('OK', '');
        break;
      case 'ringing':
        el.main.innerHTML = '<div class="lcd-center" style="margin-top:22px">Incoming call</div><div class="lcd-big">HARMONY</div><div class="lcd-center">Guide call-back</div>';
        soft('Answer', 'Reject');
        break;
      case 'call': {
        var secs = Math.floor((Date.now() - (state.started || Date.now())) / 1000);
        var head = 'HARMONY  ' + Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0') + '\n';
        text(head + '\n' + (state.caption || 'Connecting...'));
        if (state.await === 'record') {
          state.input = inputLine({ label: 'Your spoken question', placeholder: 'say (type) your question', max: 200 });
          soft('Done #', 'End');
        } else if (state.await === 'digits') {
          var entered = document.createElement('div');
          entered.style.marginTop = '6px';
          entered.style.fontWeight = '700';
          entered.textContent = state.digits ? 'Keys: ' + state.digits : '';
          el.main.appendChild(entered);
          soft('', 'End');
        } else {
          soft('', 'End');
        }
        el.main.scrollTop = el.main.scrollHeight;
        break;
      }
      case 'message':
        text('\n' + state.message);
        soft('OK', '');
        break;
    }
  }

  // ── Keys ──
  function press(k) {
    if (/^[0-9*#]$/.test(k)) tone(k === '#' ? 1477 : 1209 - Number(k === '*' ? 0 : k) * 12, 70);
    switch (screen) {
      case 'home':
        if (/^[0-9*#]$/.test(k)) return go('dial', { buffer: k });
        if (k === 'softL') return go('menu', { sel: 0 });
        if (k === 'softR' || k === 'down') return go('inbox', { sel: 0 });
        if (k === 'call') return startUssd();
        return;
      case 'menu': {
        var sel = state.sel || 0;
        if (k === 'up') { state.sel = (sel + 3) % 4; return render(); }
        if (k === 'down') { state.sel = (sel + 1) % 4; return render(); }
        if (/^[1-4]$/.test(k)) { state.sel = Number(k) - 1; sel = state.sel; k = 'softL'; }
        if (k === 'softL' || k === 'call') {
          if (sel === 0) return go('inbox', { sel: 0 });
          if (sel === 1) return go('compose', {});
          if (sel === 2) return startUssd();
          return startCall(null);
        }
        if (k === 'softR' || k === 'end') return go('home');
        return;
      }
      case 'dial':
        if (/^[0-9*#]$/.test(k)) { state.buffer = (state.buffer || '') + k; return render(); }
        if (k === 'softR') { state.buffer = (state.buffer || '').slice(0, -1); return state.buffer ? render() : go('home'); }
        if (k === 'end') return go('home');
        if (k === 'call' || k === 'softL') return dial(state.buffer || '');
        return;
      case 'ussd':
        if (state.loading) { if (k === 'end' || k === 'softR') go('home'); return; }
        if (!state.open) { if (k === 'softL' || k === 'end' || k === 'call') go('home'); return; }
        if (/^[0-9*#]$/.test(k) && state.input) { state.input.value += k; return; }
        if (k === 'softL' || k === 'call') return ussdReply(state.input ? state.input.value : '');
        if (k === 'softR' || k === 'end') return go('home');
        return;
      case 'inbox': {
        var n = inbox.length;
        if (k === 'up' && n) { state.sel = ((state.sel || 0) + n - 1) % n; return render(); }
        if (k === 'down' && n) { state.sel = ((state.sel || 0) + 1) % n; return render(); }
        if (k === 'softL' || k === 'call') {
          if (!n) return go('compose', {});
          var idx = state.sel || 0;
          inbox[idx].read = true;
          return go('read', { index: idx });
        }
        if (k === 'softR' || k === 'end') return go('home');
        return;
      }
      case 'read':
        if (k === 'softL') return go('compose', {});
        if (k === 'up') { el.main.scrollTop -= 40; return; }
        if (k === 'down') { el.main.scrollTop += 40; return; }
        if (k === 'softR' || k === 'end') return go('inbox', { sel: state.index });
        return;
      case 'compose':
        if (/^[0-9*#]$/.test(k) && state.input) { state.input.value += k; return; }
        if (k === 'softL' || k === 'call') return sendSms(state.input ? state.input.value : '');
        if (k === 'softR' || k === 'end') return go('inbox', { sel: 0 });
        return;
      case 'stk':
        if (/^[0-9]$/.test(k) && state.input && state.input.value.length < 4) { state.input.value += k; return; }
        if (k === 'softL' || k === 'call') return answerPrompt('pin', state.input ? state.input.value : '');
        if (k === 'softR' || k === 'end') return answerPrompt('cancel');
        return;
      case 'stk-done':
      case 'message':
        if (k === 'softL' || k === 'end' || k === 'call') go('home');
        return;
      case 'ringing':
        if (k === 'call' || k === 'softL') { ring(false); return startCall(state.tag); }
        if (k === 'end' || k === 'softR') { ring(false); return go('home'); }
        return;
      case 'call':
        if (k === 'end' || k === 'softR') return hangup();
        if (state.await === 'record') {
          if (k === 'softL' || k === '#' || k === 'call') return voiceStep(state.next, { transcript: state.input ? state.input.value : '' });
          return;
        }
        if (state.await === 'digits' && /^[0-9*#]$/.test(k)) {
          if (k === state.finishOnKey) return voiceStep(state.next, { digits: state.digits || '' });
          state.digits = (state.digits || '') + k;
          hush();
          if (state.numDigits && state.digits.length >= state.numDigits) return voiceStep(state.next, { digits: state.digits });
          return render();
        }
        return;
    }
  }

  // ── USSD ──
  function dial(buffer) {
    if (/^\*[\d*]+#$/.test(buffer)) return startUssd(buffer);
    var digits = buffer.replace(/\D/g, '');
    var voice = cfg && cfg.voiceNumber ? cfg.voiceNumber.replace(/\D/g, '') : '';
    if (digits && (digits === String((cfg && cfg.smsShortcode) || '') || (voice && voice.slice(-9) === digits.slice(-9)))) return startCall(null);
    go('message', { message: 'This simulator can call Harmony (' + ((cfg && cfg.smsShortcode) || '22384') + ') or dial ' + ((cfg && cfg.ussdCode) || '*384*2026#') + '.' });
  }

  function startUssd() {
    go('ussd', { loading: true, history: [], session: 'sim-' + Date.now().toString(36) });
    ussdSend();
  }

  async function ussdSend() {
    var s = state;
    try {
      var res = await fetch(String(window.GOO_API || '').replace(/\/$/, '') + '/api/dev/ussd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: line, text: s.history.join('*'), sessionId: s.session })
      });
      var reply = await res.text();
      if (screen !== 'ussd' || state !== s) return;
      var open = reply.indexOf('CON ') === 0;
      s.loading = false;
      s.open = open;
      s.body = reply.replace(/^(CON|END) /, '');
      s.freeText = open && /type|question/i.test(s.body);
      render();
      refresh();
    } catch (e) {
      go('message', { message: 'Connection problem or invalid MMI code.' });
    }
  }

  function ussdReply(value) {
    var v = String(value || '').trim();
    if (!v) return;
    state.history.push(v.replace(/\*/g, ' '));
    state.loading = true;
    render();
    ussdSend();
  }

  // ── SMS ──
  async function sendSms(body) {
    var t = String(body || '').trim();
    if (!t) return;
    go('sent');
    try {
      await api('POST', '/api/dev/sms', { phone: line, text: t });
    } catch (e) {
      return go('message', { message: 'Message failed: ' + e.message });
    }
    setTimeout(function () { if (screen === 'sent') go('inbox', { sel: 0 }); refresh(); }, 700);
  }

  // ── PIN prompts ──
  async function answerPrompt(action, pin) {
    var p = state.prompt;
    if (action === 'pin' && !/^\d{4}$/.test(pin || '')) { if (state.input) { state.input.value = ''; state.input.placeholder = '4 digits'; } return; }
    dismissedPrompts[p.ref] = true;
    try {
      var res = await api('POST', '/api/dev/prompts/' + encodeURIComponent(p.ref), { provider: p.provider, action: action, pin: pin });
      var o = res.outcome;
      go('stk-done', { message: o.status === 'paid' ? 'Request accepted.\nYou will receive a confirmation SMS.' : o.status === 'cancelled' ? 'Request cancelled.' : 'Failed: ' + (o.reason || 'wrong PIN') });
    } catch (e) {
      go('stk-done', { message: 'Request failed.\n' + e.message });
    }
    setTimeout(refresh, 400);
  }

  // ── Voice ──
  function startCall(tag) {
    hush();
    go('call', { started: Date.now(), tag: tag, session: 'simcall-' + Date.now().toString(36), caption: 'Calling Harmony...' });
    state.timer = setInterval(function () { if (screen === 'call' && state.await !== 'record') render(); }, 1000);
    voiceStep('/voice', {});
  }

  function stepFrom(url) {
    var m = /\/voice(\/[a-z]+)?$/.exec(String(url || ''));
    return m ? '/voice' + (m[1] || '') : null;
  }

  async function voiceStep(step, extra) {
    if (screen !== 'call') return;
    var s = state;
    s.await = null;
    s.digits = '';
    s.caption = '...';
    render();
    var body = { phone: line, sessionId: s.session, clientRequestId: s.tag || undefined };
    for (var k in extra) body[k] = extra[k];
    var xml = '';
    try {
      var res = await fetch(String(window.GOO_API || '').replace(/\/$/, '') + '/api/dev' + step, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      xml = await res.text();
    } catch (e) {
      s.caption = 'Call failed.';
      render();
      return;
    }
    if (screen !== 'call' || state !== s) return;
    playXml(xml);
  }

  function playXml(xml) {
    var doc = new DOMParser().parseFromString(xml, 'application/xml');
    var root = doc.documentElement;
    var said = [];
    var next = null;
    [].slice.call(root.children).forEach(function (node) {
      if (node.nodeName === 'Say') said.push(node.textContent);
      if (node.nodeName === 'GetDigits' || node.nodeName === 'Record') {
        [].slice.call(node.getElementsByTagName('Say')).forEach(function (sn) { said.push(sn.textContent); });
        next = {
          kind: node.nodeName === 'Record' ? 'record' : 'digits',
          step: stepFrom(node.getAttribute('callbackUrl')),
          numDigits: Number(node.getAttribute('numDigits') || 0),
          finishOnKey: node.getAttribute('finishOnKey') || '#'
        };
      }
      if (node.nodeName === 'Dial') next = { kind: 'dial' };
    });
    var caption = said.join('\n\n');
    state.caption = caption;
    hush();
    said.forEach(speak);
    if (next && next.kind === 'dial') {
      state.caption = caption + '\n\n[ringing a guide...]';
      render();
      setTimeout(function () {
        if (screen === 'call') { state.caption = 'Connected to a Harmony guide.\n(In real life you now talk to a person.)'; render(); }
      }, 3500);
      return;
    }
    if (next) {
      state.await = next.kind;
      state.next = next.step;
      state.numDigits = next.numDigits;
      state.finishOnKey = next.finishOnKey;
      render();
      return;
    }
    render();
    var wait = Math.min(9000, 1200 + caption.length * 55);
    var s = state;
    setTimeout(function () { if (screen === 'call' && state === s) hangup(); }, sound ? wait : 1800);
    setTimeout(refresh, 1500);
  }

  function hangup(silent) {
    hush();
    ring(false);
    if (state && state.timer) clearInterval(state.timer);
    if (silent) return;
    go('message', { message: 'Call ended' });
    setTimeout(function () { if (screen === 'message') go('home'); }, 1400);
    setTimeout(refresh, 800);
  }

  // ── Polling the server for SMS, prompts and calls ──
  async function refresh() {
    if (!cfg || !cfg.simulator) return;
    var data;
    try {
      data = await api('GET', '/api/dev/phone/' + encodeURIComponent(line));
    } catch (e) {
      return;
    }
    var fresh = 0;
    var byId = {};
    inbox.forEach(function (m) { byId[m.id] = m; });
    var list = [];
    data.outbox.forEach(function (m) {
      if (m.kind === 'sms') {
        var known = byId[m.id];
        var read = known ? known.read : !!seenSms[m.id];
        if (!known && !seenSms[m.id]) fresh += 1;
        seenSms[m.id] = seenSms[m.id] || 1;
        list.push({ id: m.id, body: m.body, at: m.at, read: read });
      }
    });
    list.reverse();
    inbox = list;
    saveSet('seen', seenSms);

    prompts = data.prompts || [];
    var idle = ['home', 'menu', 'inbox', 'read', 'dial', 'message', 'stk-done', 'sent'].indexOf(screen) >= 0;
    var openPrompt = prompts.find(function (p) { return !dismissedPrompts[p.ref]; });
    var call = data.outbox.find(function (m) { return m.kind === 'call' && !handledCalls[m.id]; });

    if (openPrompt && screen !== 'stk' && screen !== 'call') {
      buzz();
      smsTone();
      go('stk', { prompt: openPrompt });
      badge(true);
    } else if (call && idle) {
      handledCalls[call.id] = 1;
      saveSet('calls', handledCalls);
      buzz();
      ring(true);
      go('ringing', { tag: call.body });
      badge(true);
    } else if (fresh) {
      buzz();
      smsTone();
      badge(true);
      if (screen === 'home' || screen === 'inbox') render();
    } else if (screen === 'home') {
      render();
    }
  }

  function badge(on) {
    var b = $('phoneBadge');
    if (!b) return;
    var viewing = document.getElementById('panel-phone').classList.contains('active') || window.matchMedia('(min-width:1024px)').matches;
    if (on && !viewing) {
      var count = b.classList.contains('hidden') ? 1 : Math.min(9, Number(b.textContent || 0) + 1);
      b.textContent = String(count);
      b.classList.remove('hidden');
    }
    if (!on) { b.classList.add('hidden'); b.textContent = '0'; }
  }

  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(function () { if (!document.hidden) refresh(); }, 2000);
  }

  // ── Boot ──
  function disabled(c) {
    $('simSub').textContent = 'The live service is running, so the simulator is switched off.';
    mount.innerHTML = '<div class="sim-off">On any phone: dial <b></b>, text <b>HELP</b> to <b></b>' + (c && c.voiceNumber ? ', or call <b></b>' : '') + '.</div>';
    var b = mount.querySelectorAll('b');
    b[0].textContent = (c && c.ussdCode) || '*384*2026#';
    b[2].textContent = (c && c.smsShortcode) || '22384';
    if (b[3]) b[3].textContent = c.voiceNumber;
    $('simLines').innerHTML = '';
  }

  document.addEventListener('harmony:config', function (e) {
    cfg = e.detail;
    if (!cfg.simulator) return disabled(cfg);
    build();
    var saved = '';
    try { saved = localStorage.getItem(LINE_KEY) || ''; } catch (err) {}
    setLine(saved && App.normalize(saved) ? saved : LINES[0].number);
    startPolling();
  });

  window.HarmonySim = {
    phone: function () { return line; },
    refresh: refresh,
    seen: function () { badge(false); },
    focus: function () { if (el.phone) el.phone.focus({ preventScroll: true }); },
    prefill: function (code) {
      if (!el.phone || screen !== 'home') return;
      go('dial', { buffer: code });
    }
  };
})();
