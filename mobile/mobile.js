/* Harmony Mobile: tabs, lessons, the ask guide, the human call-back and mobile money / card checkout. */
(function () {
  'use strict';

  var API = String(window.GOO_API || '').replace(/\/$/, '');
  var $ = function (id) { return document.getElementById(id); };
  var config = null;
  var PHONE_KEY = 'harmony-phone';

  // ── HTTP ──
  async function api(method, path, body) {
    var res = await fetch(API + path, {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    var data = {};
    try { data = await res.json(); } catch (e) { data = {}; }
    if (!res.ok) {
      var err = new Error(data.error || 'Something went wrong. Please try again.');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function store(key, value) {
    try { if (value === undefined) return localStorage.getItem(key) || ''; localStorage.setItem(key, value); } catch (e) {}
    return '';
  }

  function money(n, currency) { return currency + ' ' + Math.round(n).toLocaleString('en-US'); }
  function usd(n) { return '$' + Math.round(n).toLocaleString('en-US'); }

  // ── Phone numbers for every supported country (mirrors server/src/lib/phone.ts) ──
  var COUNTRIES = [];
  var COUNTRY_KEY = 'harmony-country';

  function countryBy(code) {
    for (var i = 0; i < COUNTRIES.length; i++) if (COUNTRIES[i].code === code) return COUNTRIES[i];
    return null;
  }
  function homeCode() { return store(COUNTRY_KEY) || (config && config.defaultCountry) || 'KE'; }
  function countryOfDigits(d) {
    var list = COUNTRIES.slice().sort(function (a, b) { return b.dial.length - a.dial.length; });
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (d.indexOf(c.dial) !== 0 || c.nsn.indexOf(d.length - c.dial.length) < 0) continue;
      var nsn = d.slice(c.dial.length);
      if (!c.mobileStarts || c.mobileStarts.some(function (p) { return nsn.indexOf(p) === 0; })) return c;
    }
    return null;
  }
  /** E.164 digits without the plus, or '' when the number is not valid for a supported country. */
  function normalize(raw, code) {
    var text = String(raw || '').trim();
    var intl = text.charAt(0) === '+' || text.indexOf('00') === 0;
    var d = text.replace(/\D/g, '');
    if (text.indexOf('00') === 0) d = d.slice(2);
    if (!d || !COUNTRIES.length) return '';
    if (intl) return countryOfDigits(d) ? d : '';
    var home = countryBy(code || homeCode());
    if (home) {
      var local = home.trunk0 && d.charAt(0) === '0' ? d.slice(1) : d;
      if (home.nsn.indexOf(local.length) >= 0 && !(home.trunk0 && local.charAt(0) === '0') && countryOfDigits(home.dial + local) === home) return home.dial + local;
    }
    return countryOfDigits(d) ? d : '';
  }
  /** { country, network } for a number, network null when the prefix is not known. */
  function lookup(raw, code) {
    var n = normalize(raw, code);
    var c = n ? countryOfDigits(n) : null;
    if (!c) return null;
    var nsn = n.slice(c.dial.length);
    var best = null;
    c.networks.forEach(function (net) {
      net.prefixes.forEach(function (p) {
        if (nsn.indexOf(p) === 0 && (!best || p.length > best.len)) best = { net: net, len: p.length };
      });
    });
    return { digits: n, country: c, network: best ? best.net : null };
  }
  function networkOf(raw, code) {
    var l = lookup(raw, code);
    return l ? (l.network ? l.network.id : 'unknown') : '';
  }
  function pretty(raw, code) {
    var l = lookup(raw, code);
    if (!l) return String(raw || '');
    var nsn = l.digits.slice(l.country.dial.length);
    if (l.country.code === homeCode() && l.country.trunk0) {
      var local = '0' + nsn;
      return local.slice(0, 4) + ' ' + local.slice(4, 7) + ' ' + local.slice(7);
    }
    var grouped = nsn.length <= 8 ? nsn.replace(/(\d{2})(?=\d)/g, '$1 ') : nsn.slice(0, 3) + ' ' + nsn.slice(3, 6) + ' ' + nsn.slice(6);
    return '+' + l.country.dial + ' ' + grouped;
  }
  function example(c) {
    var nsnLen = c.nsn[c.nsn.length - 1];
    var first = c.networks.length && c.networks[0].prefixes.length ? c.networks[0].prefixes[0] : '';
    var digits = (first + '1234567890').slice(0, nsnLen);
    var local = (c.trunk0 ? '0' : '') + digits;
    return local.replace(/^(\d{4})(\d{3})(\d+)$/, '$1 $2 $3');
  }

  // Every phone field gets a country picker; the chosen country reads local numbers.
  var phoneFields = [];
  function intl(input) {
    var n = normalize(input.value, input.dataset.cc);
    return n ? '+' + n : '';
  }
  function enhancePhone(input) {
    var wrap = input.closest('.input-wrap');
    if (!wrap || wrap.querySelector('.cc') || !COUNTRIES.length) return;
    var label = document.createElement('label');
    label.className = 'cc';
    label.innerHTML = '<span class="cc-face" aria-hidden="true"></span><select aria-label="Country"></select>';
    var sel = label.querySelector('select');
    COUNTRIES.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.code;
      o.textContent = c.flag + ' ' + c.name + ' (+' + c.dial + ')';
      sel.appendChild(o);
    });
    wrap.classList.add('has-cc');
    wrap.insertBefore(label, input);
    function setCountry(code, fromTyping) {
      var c = countryBy(code) || countryBy(homeCode());
      sel.value = c.code;
      input.dataset.cc = c.code;
      label.querySelector('.cc-face').textContent = c.flag + ' +' + c.dial;
      input.placeholder = example(c);
      if (!fromTyping) input.dispatchEvent(new CustomEvent('cc-change'));
    }
    sel.addEventListener('change', function () {
      store(COUNTRY_KEY, sel.value);
      phoneFields.forEach(function (f) { if (f !== input && !f.value) f.setCountry(sel.value); });
      setCountry(sel.value);
      input.dispatchEvent(new Event('input'));
      input.focus();
    });
    input.addEventListener('input', function () {
      // Typing +256... switches the picker to Uganda.
      if (/^\s*(\+|00)/.test(input.value)) {
        var l = lookup(input.value);
        if (l && l.country.code !== input.dataset.cc) setCountry(l.country.code, true), input.dispatchEvent(new CustomEvent('cc-change'));
      }
    });
    input.setCountry = setCountry;
    phoneFields.push(input);
    setCountry(input.dataset.cc || homeCode(), true);
  }

  function bindPhone(input, onNetwork) {
    var badge = document.querySelector('[data-net-for="' + input.id + '"]');
    function update() {
      var l = lookup(input.value, input.dataset.cc);
      if (badge) {
        var cls = l ? (l.network ? l.network.id : 'unknown') : '';
        badge.className = 'net-badge' + (l ? ' show ' + cls : '');
        badge.querySelector('b').textContent = l ? (l.network ? l.network.name : l.country.name) : '';
      }
      if (l) store(PHONE_KEY, '+' + l.digits);
      if (onNetwork) onNetwork(l);
    }
    input.addEventListener('input', update);
    input.addEventListener('cc-change', update);
    if (!input.value) input.value = store(PHONE_KEY);
    input.refreshPhone = update;
    update();
    return update;
  }

  function busy(btn, on) {
    btn.classList.toggle('loading', on);
    btn.disabled = on;
    btn.setAttribute('aria-busy', on ? 'true' : 'false');
  }
  function showError(el, msg) {
    el.textContent = msg || '';
    el.classList.toggle('show', !!msg);
  }

  // ── Tabs + hash routing ──
  var tabs = [].slice.call(document.querySelectorAll('.tab'));
  var desktop = window.matchMedia('(min-width:1024px)');

  function select(name, opts) {
    if (name === 'phone' && desktop.matches) {
      document.querySelector('.rail').scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (window.HarmonySim) window.HarmonySim.focus();
      return;
    }
    tabs.forEach(function (t) {
      var on = t.dataset.tab === name;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      $('panel-' + t.dataset.tab).classList.toggle('active', on);
    });
    if (!opts || !opts.silent) history.replaceState(null, '', '#' + name);
    if (name === 'phone' && window.HarmonySim) window.HarmonySim.seen();
    // Gifts also arrive by USSD, SMS and voice, so refresh the total whenever it comes into view.
    if (name === 'support' && config) loadLedger();
    if (!opts || !opts.keepScroll) {
      var top = document.querySelector('.tabbar').getBoundingClientRect().top + window.scrollY - 70;
      if (window.scrollY > top) window.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' });
    }
  }
  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { select(t.dataset.tab); });
    t.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var visible = tabs.filter(function (x) { return x.offsetParent !== null; });
      var idx = visible.indexOf(t) + (e.key === 'ArrowRight' ? 1 : -1);
      var next = visible[(idx + visible.length) % visible.length];
      next.focus();
      select(next.dataset.tab);
    });
  });
  function fromHash() {
    var h = location.hash.replace('#', '');
    if (['learn', 'ask', 'support', 'phone'].indexOf(h) >= 0) select(h, { silent: true, keepScroll: true });
  }
  window.addEventListener('hashchange', fromHash);
  window.HarmonyTabs = { select: select };

  // Move the simulator between the desktop rail and the Phone tab.
  function placeSimulator() {
    var sim = $('simulator');
    var slot = desktop.matches ? $('phoneSlotDesktop') : $('phoneSlotMobile');
    if (sim.parentNode !== slot) slot.appendChild(sim);
  }
  desktop.addEventListener('change', placeSimulator);
  placeSimulator();

  // Copy USSD / SMS codes.
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var value = btn.dataset.copy === 'ussd' ? $('ussdCode').textContent : $('smsCode').textContent;
      var label = btn.querySelector('span');
      var original = label.textContent;
      function done() { label.textContent = 'Copied'; setTimeout(function () { label.textContent = original; }, 1400); }
      if (navigator.clipboard) navigator.clipboard.writeText(value).then(done, function () {});
      if (window.HarmonySim && btn.dataset.copy === 'ussd') window.HarmonySim.prefill(value);
    });
  });

  // ── Config ──
  async function loadConfig() {
    try {
      config = await api('GET', '/api/mobile/config');
    } catch (e) {
      $('modeText').textContent = 'Offline';
      $('modePill').classList.add('practice');
      $('modePill').title = 'Cannot reach the Harmony server at ' + API;
      renderLessons([]);
      return;
    }
    document.querySelectorAll('[data-ussd-code]').forEach(function (el) { el.textContent = config.ussdCode; });
    document.querySelectorAll('[data-sms-code]').forEach(function (el) { el.textContent = config.smsShortcode; });
    $('ussdCode').textContent = config.ussdCode;
    $('smsCode').textContent = config.smsShortcode;
    if (config.voiceNumber) {
      $('voiceNumber').textContent = config.voiceNumber;
      $('voiceLink').href = 'tel:' + config.voiceNumber;
    }

    var m = config.modes;
    var rails = [m.sms, m.mpesa, m.airtel, m.pawapay];
    var practice = rails.indexOf('mock') >= 0;
    var sandbox = rails.indexOf('sandbox') >= 0;
    $('modeText').textContent = practice ? 'Practice mode' : sandbox ? 'Sandbox' : 'Live';
    $('modePill').classList.toggle('practice', practice || sandbox);
    $('modePill').title = 'SMS: ' + m.sms + ' · Voice: ' + m.voice + ' · M-Pesa: ' + m.mpesa + ' · Airtel: ' + m.airtel +
      ' · pawaPay (20 countries): ' + m.pawapay + ' · Card: ' + (m.stripe ? 'on' : 'off');

    COUNTRIES = config.countries || [];
    ['joinPhone', 'askPhone', 'humanPhone', 'payPhone'].forEach(function (id) {
      var el = $(id);
      enhancePhone(el);
      if (el.value && !normalize(el.value, el.dataset.cc)) {
        var l = lookup(el.value);
        if (l) el.setCountry(l.country.code, true);
      }
      if (el.refreshPhone) el.refreshPhone();
    });
    $('countryCount').textContent = String(COUNTRIES.length);

    renderLessons(config.lessons || []);
    setupSupport();
    loadLedger();
    document.dispatchEvent(new CustomEvent('harmony:config', { detail: config }));
  }

  // ── Learn ──
  function renderLessons(list) {
    var wrap = $('lessons');
    wrap.innerHTML = '';
    $('lessonCount').textContent = list.length ? list.length + ' tips' : '';
    list.forEach(function (l, i) {
      var card = document.createElement('article');
      card.className = 'lesson';
      card.innerHTML = '<div class="num"></div><h3></h3><p></p>';
      card.querySelector('.num').textContent = 'TIP ' + String(i + 1).padStart(2, '0');
      card.querySelector('h3').textContent = l.title;
      card.querySelector('p').textContent = l.summary;
      wrap.appendChild(card);
    });
  }

  bindPhone($('joinPhone'));
  $('joinForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var btn = $('joinBtn');
    showError($('joinErr'), '');
    if (!intl($('joinPhone'))) {
      showError($('joinErr'), 'Enter a valid mobile number for the country you picked.');
      $('joinPhone').focus();
      return;
    }
    busy(btn, true);
    try {
      var res = await api('POST', '/api/students/join', {
        phone: intl($('joinPhone')),
        name: $('joinName').value.trim() || undefined,
        school: $('joinSchool').value.trim() || undefined
      });
      var name = $('joinName').value.trim();
      $('joinOkTitle').textContent = name ? 'Karibu, ' + name + '!' : "You're in!";
      $('joinOkText').textContent = res.smsMode === 'mock'
        ? 'Practice mode: your first tip, "' + res.firstLesson + '", just arrived on the simulator phone.'
        : 'Your first tip, "' + res.firstLesson + '", is on its way to ' + res.phone + '.';
      $('joinForm').classList.add('hidden');
      $('joinOk').classList.add('show');
      if (window.HarmonySim) window.HarmonySim.refresh();
    } catch (err) {
      showError($('joinErr'), err.message);
    } finally {
      busy(btn, false);
    }
  });
  $('joinAgain').addEventListener('click', function () {
    $('joinOk').classList.remove('show');
    $('joinForm').classList.remove('hidden');
    $('joinPhone').value = '';
    $('joinPhone').focus();
  });

  // ── Ask ──
  var thread = $('thread');
  var askInput = $('askInput');
  var askSend = $('askSend');
  bindPhone($('askPhone'));

  $('smsToggle').addEventListener('change', function () {
    $('askPhoneField').classList.toggle('hidden', !this.checked);
    if (this.checked) $('askPhone').focus();
  });
  askInput.addEventListener('input', function () { askSend.disabled = askInput.value.trim().length < 2; });

  function bubble(kind, text) {
    var el = document.createElement('div');
    el.className = 'bubble ' + kind;
    if (text != null) el.textContent = text;
    thread.appendChild(el);
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return el;
  }

  async function ask(question) {
    question = question.trim();
    if (question.length < 2) return;
    $('suggestions').classList.add('hidden');
    bubble('me', question);
    askInput.value = '';
    askSend.disabled = true;
    var wait = bubble('bot');
    wait.innerHTML = '<span class="typing" aria-label="Thinking"><i></i><i></i><i></i></span>';
    var wantSms = $('smsToggle').checked && intl($('askPhone'));
    try {
      var res = await api('POST', '/api/agent/ask', { question: question, phone: wantSms || undefined, sms: !!wantSms });
      wait.textContent = res.text;
      var meta = document.createElement('div');
      meta.className = 'meta';
      var via = { aqua: 'Research library', lessons: 'Reviewed health tip', none: 'No answer yet' }[res.via] || res.via;
      addTag(meta, via);
      if (res.source && res.via === 'aqua') addTag(meta, res.source);
      if (res.smsSent) addTag(meta, 'Sent by SMS');
      wait.appendChild(meta);
      if (res.via === 'none') {
        var link = document.createElement('button');
        link.className = 'chip';
        link.type = 'button';
        link.style.marginTop = '10px';
        link.textContent = 'Ask a health guide instead';
        link.addEventListener('click', function () { openHuman(question); });
        wait.appendChild(link);
      }
    } catch (err) {
      wait.textContent = err.message;
    }
    wait.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function addTag(meta, text) {
    var t = document.createElement('span');
    t.className = 'tag';
    t.textContent = text;
    meta.appendChild(t);
  }
  $('askForm').addEventListener('submit', function (e) { e.preventDefault(); ask(askInput.value); });
  $('suggestions').addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (chip) ask(chip.textContent);
  });

  // ── Sheets ──
  var lastFocus = null;
  function openSheet(id) {
    lastFocus = document.activeElement;
    var sheet = $(id);
    sheet.classList.add('open');
    document.body.style.overflow = 'hidden';
    var first = sheet.querySelector('input, button:not([data-close])');
    if (first) setTimeout(function () { first.focus(); }, 60);
  }
  function closeSheet(id) {
    $(id).classList.remove('open');
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    if (id === 'paySheet') stopPolling();
  }
  document.querySelectorAll('.sheet').forEach(function (sheet) {
    sheet.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) closeSheet(sheet.id); });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.sheet.open').forEach(function (s) { closeSheet(s.id); });
  });

  // ── Talk to a person ──
  bindPhone($('humanPhone'));
  function openHuman(question) {
    $('humanForm').classList.remove('hidden');
    $('humanOk').classList.remove('show');
    showError($('humanErr'), '');
    if (question) $('humanQuestion').value = question;
    openSheet('humanSheet');
  }
  $('openHuman').addEventListener('click', function () { openHuman(''); });
  $('humanForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    showError($('humanErr'), '');
    if (!intl($('humanPhone'))) {
      showError($('humanErr'), 'Enter a valid mobile number for the country you picked.');
      return;
    }
    var btn = $('humanBtn');
    busy(btn, true);
    try {
      var res = await api('POST', '/api/agent/callback', { phone: intl($('humanPhone')), question: $('humanQuestion').value.trim() || undefined });
      $('humanOkTitle').textContent = res.calling ? 'A health guide will call you' : 'A health guide has your question';
      $('humanOkText').textContent = (res.calling
        ? 'Keep your phone nearby. The call is free. '
        : 'They will reply by SMS shortly. ') + 'Your ticket number is ' + res.ticket + '.';
      $('humanForm').classList.add('hidden');
      $('humanOk').classList.add('show');
      if (window.HarmonySim) window.HarmonySim.refresh();
    } catch (err) {
      showError($('humanErr'), err.message);
    } finally {
      busy(btn, false);
    }
  });

  // ── Support: country, wallet, amount, pay ──
  var method = null;
  var amount = 0;
  var other = false;
  var payCountry = null;
  var WALLET_COLORS = { mpesa: '#2fb964', airtel: '#ee3a3f', mtn: '#ffcb05', orange: '#ff7900', moov: '#0066b3', free: '#d7141a',
    tigo: '#00377b', halopesa: '#f58220', telecel: '#e60000', airteltigo: '#1b3f94', zamtel: '#009a44', tnm: '#00a3e0', emola: '#e2001a' };

  function walletsOf(c) { return c ? c.wallets : []; }
  function walletBy(id) {
    var w = walletsOf(payCountry).filter(function (x) { return x.id === id; });
    return w[0] || null;
  }
  function methodLabel() { return method === 'card' ? 'Card' : (walletBy(method) || {}).label || 'Mobile money'; }
  function currency() { return method === 'card' ? 'USD' : (payCountry ? payCountry.currency : 'KES'); }

  function setupSupport() {
    var input = $('payPhone');
    var l = lookup(input.value, input.dataset.cc);
    setPayCountry(l ? l.country : countryBy(input.dataset.cc || homeCode()), l && l.network ? l.network.id : null);
  }

  function setPayCountry(c, networkId) {
    if (!c) return;
    var changed = !payCountry || payCountry.code !== c.code;
    payCountry = c;
    if (changed) {
      var byNet = networkId && walletsOf(c).filter(function (w) { return w.network === networkId && w.available; })[0];
      var first = walletsOf(c).filter(function (w) { return w.available; })[0];
      method = byNet ? byNet.id : first ? first.id : (config && config.available.card ? 'card' : null);
      amount = c.amounts[1] || c.amounts[0];
      other = false;
    }
    renderMethods();
    applyMethod();
  }

  function renderMethods() {
    var wrap = $('methods');
    wrap.innerHTML = '';
    var list = walletsOf(payCountry).map(function (w) {
      return { id: w.id, label: w.label, sub: (payCountry.networks.filter(function (n) { return n.id === w.network; })[0] || {}).name || payCountry.name, available: w.available };
    });
    list.push({ id: 'card', label: 'Card', sub: 'Visa · Mastercard', available: !!(config && config.available.card) });
    list.forEach(function (m) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'method';
      b.setAttribute('role', 'radio');
      b.dataset.method = m.id;
      b.setAttribute('aria-checked', m.id === method ? 'true' : 'false');
      b.disabled = !m.available;
      var logo = document.createElement('span');
      logo.className = 'logo';
      if (m.id === 'card') {
        logo.style.background = 'var(--card)';
        logo.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>';
      } else {
        logo.style.background = WALLET_COLORS[m.id] || 'var(--teal)';
        logo.style.color = m.id === 'mtn' ? '#1b1b1b' : '#fff';
        logo.textContent = m.label.charAt(0);
      }
      var name = document.createElement('b');
      name.textContent = m.label;
      var sub = document.createElement('small');
      sub.textContent = m.sub;
      b.appendChild(logo);
      b.appendChild(name);
      b.appendChild(sub);
      if (!m.available) {
        var soon = document.createElement('span');
        soon.className = 'soon';
        soon.textContent = 'Soon';
        b.appendChild(soon);
      }
      b.addEventListener('click', function () {
        if (b.disabled) return;
        var wasCard = method === 'card';
        method = m.id;
        if ((m.id === 'card') !== wasCard) {
          amount = m.id === 'card' ? 10 : (payCountry.amounts[1] || payCountry.amounts[0]);
          other = false;
        }
        renderMethods();
        applyMethod();
      });
      wrap.appendChild(b);
    });
  }

  function applyMethod() {
    var card = method === 'card';
    $('payPhoneField').classList.toggle('hidden', card);
    $('payEmailField').classList.toggle('hidden', !card);
    $('payPhoneLabel').textContent = card ? 'Phone' : methodLabel() + ' number';
    var tone = card ? 'card' : method === 'mpesa' ? 'mpesa' : method === 'airtel' ? 'airtel' : '';
    $('payBtn').className = 'btn block ' + tone;
    $('payBtn').disabled = !method;
    $('secureText').textContent = card
      ? 'Card details are entered on Stripe\'s secure page. We never see them.'
      : 'You approve with your PIN on your own phone. We never see it.';
    renderAmounts();
    showError($('payErr'), '');
  }

  function renderAmounts() {
    var card = method === 'card';
    var list = card ? ((config && config.amounts.usd) || [5, 10, 25, 50, 100]) : (payCountry ? payCountry.amounts : []);
    var wrap = $('amounts');
    wrap.innerHTML = '';
    list.forEach(function (v) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'amount';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', !other && v === amount ? 'true' : 'false');
      if (!card) {
        var cur = document.createElement('small');
        cur.textContent = currency();
        b.appendChild(cur);
      }
      b.appendChild(document.createTextNode(card ? usd(v) : v.toLocaleString('en-US')));
      b.addEventListener('click', function () { amount = v; other = false; renderAmounts(); });
      wrap.appendChild(b);
    });
    var o = document.createElement('button');
    o.type = 'button';
    o.className = 'amount other';
    o.setAttribute('role', 'radio');
    o.setAttribute('aria-checked', other ? 'true' : 'false');
    o.textContent = 'Other';
    o.addEventListener('click', function () { other = true; renderAmounts(); $('otherAmount').focus(); });
    wrap.appendChild(o);
    $('otherField').classList.toggle('hidden', !other);
    var min = card ? 1 : (payCountry ? payCountry.min : 1);
    $('otherHint').textContent = card ? 'in US dollars' : 'in ' + currency() + ', min ' + money(min, currency());
    $('otherAmount').min = String(min);
    updateTotal();
  }

  function currentAmount() {
    return other ? Math.floor(Number($('otherAmount').value) || 0) : amount;
  }
  function updateTotal() {
    var a = currentAmount();
    var card = method === 'card';
    $('payTotal').textContent = card ? usd(a) : money(a, currency());
    $('payBtnText').textContent = !method ? 'Not available here yet' : card ? 'Pay ' + usd(a) + ' by card' : 'Send ' + methodLabel() + ' prompt';
  }
  $('otherAmount').addEventListener('input', updateTotal);

  bindPhone($('payPhone'), function (l) {
    if (!COUNTRIES.length) return;
    var input = $('payPhone');
    var c = l ? l.country : countryBy(input.dataset.cc);
    if (!c) return;
    if (!payCountry || payCountry.code !== c.code) return setPayCountry(c, l && l.network ? l.network.id : null);
    // A Safaricom number means M-Pesa, an MTN number means MTN MoMo, and so on.
    if (method !== 'card' && l && l.network) {
      var own = walletsOf(c).filter(function (w) { return w.network === l.network.id && w.available; })[0];
      if (own && own.id !== method) { method = own.id; renderMethods(); applyMethod(); }
    }
  });

  $('payForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    showError($('payErr'), '');
    var a = currentAmount();
    var btn = $('payBtn');
    if (!method) return;

    if (method === 'card') {
      var email = $('payEmail').value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError($('payErr'), 'Enter your email for the receipt.');
      if (a < 1) return showError($('payErr'), 'Choose an amount.');
      busy(btn, true);
      try {
        var session = await api('POST', '/api/checkout', { email: email, amount: a * 100, currency: 'usd' });
        location.href = session.url;
      } catch (err) {
        showError($('payErr'), err.status === 503 ? 'Card payments are not switched on yet. Please use mobile money.' : err.message);
        busy(btn, false);
      }
      return;
    }

    var phone = intl($('payPhone'));
    if (!phone) return showError($('payErr'), 'Enter your ' + methodLabel() + ' number for ' + payCountry.name + ', e.g. ' + example(payCountry) + '.');
    if (!(a >= payCountry.min && a <= payCountry.max)) {
      return showError($('payErr'), 'Choose an amount between ' + money(payCountry.min, currency()) + ' and ' + money(payCountry.max, currency()) + '.');
    }

    busy(btn, true);
    try {
      var res = await api('POST', '/api/pay/mobile', { phone: phone, amount: a, wallet: method });
      openPayment(res.payment);
    } catch (err) {
      showError($('payErr'), err.message);
    } finally {
      busy(btn, false);
    }
  });

  // ── Payment status sheet ──
  var poll = null;
  var tick = null;
  var current = null;

  function stopPolling() {
    clearTimeout(poll);
    clearInterval(tick);
    poll = null;
    tick = null;
  }

  function openPayment(payment) {
    current = payment;
    renderStk(payment, 90);
    openSheet('paySheet');
    var started = Date.now();
    var left = 90;
    stopPolling();
    tick = setInterval(function () {
      left = Math.max(0, 90 - Math.round((Date.now() - started) / 1000));
      var el = $('stkCountdown');
      if (el) el.textContent = left > 0 ? 'Waiting for your PIN · ' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0') : 'Still checking…';
    }, 1000);
    var check = async function () {
      try {
        var res = await api('GET', '/api/pay/mobile/' + encodeURIComponent(payment.id));
        current = res.payment;
        if (res.payment.status !== 'pending') {
          stopPolling();
          renderStk(res.payment);
          if (res.payment.status === 'paid') loadLedger();
          return;
        }
      } catch (e) { /* keep polling through blips */ }
      if (Date.now() - started < 200000) poll = setTimeout(check, 2500);
    };
    poll = setTimeout(check, 2000);
  }

  function renderStk(p) {
    var stk = $('stk');
    stk.className = 'stk ' + p.provider;
    var practice = p.mode === 'mock';
    var html = '';
    if (p.status === 'pending') {
      html =
        '<div class="stk-visual" aria-hidden="true"><span class="ring"></span><span class="ring"></span><span class="ring"></span>' +
        '<span class="handset"><b>****</b></span></div>' +
        '<h3 id="stkTitle">Check your phone</h3>' +
        '<p>Enter your <b></b> PIN on <b></b> to give <b></b>.</p>' +
        '<div class="steps"><div class="step done"><i>&#10003;</i>Prompt sent</div><div class="step now"><i>2</i>Enter PIN</div><div class="step"><i>3</i>Confirmed</div></div>' +
        '<div class="countdown" id="stkCountdown">Waiting for your PIN · 1:30</div>';
      if (practice) {
        html += '<div class="practice-hint"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>' +
          '<div>Practice mode: no real money moves. Enter any 4-digit PIN on the simulator phone, or wait a few seconds.' +
          '<div style="margin-top:10px"><button class="btn small ghost" type="button" id="openSimPin">Open the phone</button></div></div></div>';
      }
      stk.innerHTML = html;
      var bs = stk.querySelectorAll('p b');
      bs[0].textContent = p.providerLabel;
      bs[1].textContent = p.phone;
      bs[2].textContent = p.amountLabel;
      var open = $('openSimPin');
      if (open) open.addEventListener('click', function () { closeSheet('paySheet'); select('phone'); if (window.HarmonySim) window.HarmonySim.refresh(); keepWatching(p); });
      return;
    }
    if (p.status === 'paid') {
      stk.innerHTML =
        '<div class="result-ico ok"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>' +
        '<h3 id="stkTitle">Thank you! Payment confirmed</h3><p>Your support trains community health guides and keeps water safe. A receipt is on its way by SMS.</p>' +
        '<div class="receipt"><div><span>Amount</span><b></b></div><div><span>Method</span><b></b></div><div><span>Receipt</span><b></b></div><div><span>Phone</span><b></b></div></div>' +
        '<button class="btn block" type="button" data-close style="margin-top:14px">Done</button>';
      var r = stk.querySelectorAll('.receipt b');
      r[0].textContent = p.amountLabel;
      r[1].textContent = p.providerLabel + (practice ? ' (practice)' : '');
      r[2].textContent = p.receipt || 'Pending';
      r[3].textContent = p.phone;
      return;
    }
    var titles = { cancelled: 'Payment cancelled', timeout: 'No response from the phone', failed: 'Payment didn\'t go through' };
    stk.innerHTML =
      '<div class="result-ico bad"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M7 7l10 10M17 7 7 17"/></svg></div>' +
      '<h3 id="stkTitle"></h3><p></p>' +
      '<div class="row" style="margin-top:18px"><button class="btn ghost" type="button" data-close>Close</button><button class="btn" type="button" id="stkRetry">Try again</button></div>';
    stk.querySelector('h3').textContent = titles[p.status] || 'Payment not completed';
    var why = p.failureReason || '';
    stk.querySelector('p').textContent = /charged/i.test(why) ? why : (why ? why + '. ' : '') + 'Nothing was charged.';
    $('stkRetry').addEventListener('click', function () { closeSheet('paySheet'); $('payBtn').click(); });
  }

  // If the student hops to the simulator to enter the PIN, reopen the sheet when it settles.
  function keepWatching(p) {
    var until = Date.now() + 180000;
    var check = async function () {
      try {
        var res = await api('GET', '/api/pay/mobile/' + encodeURIComponent(p.id));
        if (res.payment.status !== 'pending') {
          loadLedger();
          renderStk(res.payment);
          openSheet('paySheet');
          return;
        }
      } catch (e) {}
      if (Date.now() < until) setTimeout(check, 2500);
    };
    setTimeout(check, 2500);
  }

  // ── Ledger ──
  async function loadLedger() {
    try {
      var ledger = await api('GET', '/api/mobile/ledger');
      var goal = (config && config.goalGifts) || 500;
      var labels = ledger.byCurrency.slice(0, 3).map(function (x) { return x.label; });
      $('raised').textContent = labels.length ? labels.join(' · ') : 'Be the first';
      $('raisedSuffix').textContent = labels.length ? ' raised by phone' : ' to give by phone';
      var countries = ledger.countries.length;
      $('supporters').textContent = ledger.gifts
        ? ledger.gifts + (ledger.gifts === 1 ? ' gift' : ' gifts') + ' from ' + countries + (countries === 1 ? ' country' : ' countries') + ' · goal ' + goal
        : 'Goal: ' + goal + ' gifts';
      var pct = Math.min(100, Math.round((ledger.gifts / goal) * 100));
      $('meterFill').style.width = Math.max(pct, ledger.gifts ? 2 : 0) + '%';
      $('meter').setAttribute('aria-valuenow', String(pct));
    } catch (e) {}
  }

  // Practice mode: pre-fill forms with the simulated line so demos flow.
  document.addEventListener('harmony:simline', function (e) {
    ['payPhone', 'joinPhone', 'humanPhone', 'askPhone'].forEach(function (id) {
      var el = $(id);
      if (el && !el.dataset.touched) {
        el.value = '+' + e.detail.phone;
        var l = lookup(el.value);
        if (l && el.setCountry) el.setCountry(l.country.code, true);
        el.value = pretty(el.value, l ? l.country.code : undefined);
        if (l && l.country.code !== homeCode()) el.value = '+' + e.detail.phone;
        el.dispatchEvent(new Event('input'));
        el.dispatchEvent(new CustomEvent('cc-change'));
      }
    });
  });
  ['payPhone', 'joinPhone', 'humanPhone', 'askPhone'].forEach(function (id) {
    $(id).addEventListener('keydown', function () { $(id).dataset.touched = '1'; });
  });

  window.HarmonyApp = {
    api: api, normalize: normalize, networkOf: networkOf, lookup: lookup, pretty: pretty,
    config: function () { return config; }, loadLedger: loadLedger
  };

  fromHash();
  loadConfig();
})();
