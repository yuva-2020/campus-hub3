/*
 * app.js - controller: connects UI events to the adaptive models in models.js.
 * All learned data is stored locally in the browser (localStorage). Nothing is sent anywhere.
 */
(function () {
  'use strict';

  var M = window.AdaptiveModels;
  var STORAGE_KEY = 'campusHubState.v1';

  var SECTIONS = [
    { name: 'Dashboard',   text: 'An overview of your week: upcoming deadlines, new grades and unread messages.' },
    { name: 'Courses',     text: 'All your enrolled courses, syllabi and lecture materials.' },
    { name: 'Assignments', text: 'Open assignments, due dates and submission status.' },
    { name: 'Grades',      text: 'Your marks for each assignment and your running course averages.' },
    { name: 'Messages',    text: 'Messages from instructors and classmates.' },
    { name: 'Calendar',    text: 'Classes, exams and deadlines in one calendar.' },
    { name: 'Library',     text: 'Search books, journals and reserved study rooms.' },
    { name: 'Settings',    text: 'Profile, notifications and accessibility preferences.' }
  ];
  var ITEMS = SECTIONS.map(function (s) { return s.name; });
  var SIM_PATTERN = ['Assignments', 'Grades', 'Messages'];

  /* ---------------- state ---------------- */
  var predictor, bandit, themeLearner;
  var settings = { adaptive: true, density: 'auto', theme: null, active: 'Dashboard' };
  var lastSuggestions = '';
  var lastAppliedDensity = '';
  var lastActionTime = Date.now(); // time the pointer entered a menu / last click (for click speed)

  function $(id) { return document.getElementById(id); }

  function freshModels() {
    predictor = new M.NextActionPredictor(ITEMS);
    bandit = new M.DensityBandit(['compact', 'comfortable', 'spacious']);
    bandit.start();
    themeLearner = new M.ThemeLearner();
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        predictor: predictor.toJSON(),
        bandit: bandit.toJSON(),
        theme: themeLearner.toJSON(),
        settings: settings
      }));
    } catch (e) { /* storage unavailable - the app still works, it just will not remember */ }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      var s = JSON.parse(raw);
      predictor = M.NextActionPredictor.fromJSON(s.predictor);
      bandit = M.DensityBandit.fromJSON(s.bandit);
      themeLearner = M.ThemeLearner.fromJSON(s.theme);
      settings = Object.assign(settings, s.settings);
      if (bandit.current === null) bandit.start();
      return true;
    } catch (e) { return false; }
  }

  /* ---------------- helpers ---------------- */
  function announce(msg) {
    var el = $('announcer');
    el.textContent = '';
    setTimeout(function () { el.textContent = msg; }, 30);
  }

  function currentTheme() {
    if (!settings.adaptive && settings.theme) return settings.theme;
    return themeLearner.themeFor(new Date().getHours());
  }

  function currentDensity() {
    if (settings.density !== 'auto') return settings.density;
    if (!settings.adaptive) return 'comfortable';
    return bandit.current || 'comfortable';
  }

  /* ---------------- rendering ---------------- */
  function makeButton(name, rank) {
    var li = document.createElement('li');
    var b = document.createElement('button');
    b.type = 'button';
    b.dataset.item = name;
    if (rank) {
      var r = document.createElement('span');
      r.className = 'rank';
      r.textContent = '#' + rank;
      b.appendChild(r);
    }
    b.appendChild(document.createTextNode(name));
    if (name === settings.active) b.setAttribute('aria-current', 'page');
    li.appendChild(b);
    return li;
  }

  function renderMenus() {
    var main = $('mainMenu');
    main.innerHTML = '';
    // The full menu is never reordered: unpredictable menus confuse users.
    ITEMS.forEach(function (n) { main.appendChild(makeButton(n)); });

    var block = $('suggestedBlock');
    var sug = $('suggestedMenu');
    sug.innerHTML = '';
    if (!settings.adaptive) {
      block.hidden = true;
      return;
    }
    block.hidden = false;
    var top = predictor.suggest(3);
    top.forEach(function (n, i) { sug.appendChild(makeButton(n, i + 1)); });

    var key = top.join(',');
    if (key !== lastSuggestions) {
      if (lastSuggestions !== '') announce('Suggested for you updated: ' + top.join(', ') + '.');
      lastSuggestions = key;
    }
  }

  function renderMain() {
    var s = SECTIONS.filter(function (x) { return x.name === settings.active; })[0] || SECTIONS[0];
    $('sectionTitle').textContent = s.name;
    $('sectionText').textContent = s.text;
  }

  function renderPrediction() {
    var rows = predictor.predict();
    var box = $('predictionList');
    box.innerHTML = '';
    rows.forEach(function (r, i) {
      var row = document.createElement('div');
      row.className = 'row' + (i < 3 ? ' top' : '');
      row.innerHTML = '<span class="name"></span><div class="bar"><span></span></div><span class="pct"></span>';
      row.querySelector('.name').textContent = r.item;
      row.querySelector('.bar > span').style.width = Math.round(r.probability * 100 * 2.5) + '%';
      row.querySelector('.pct').textContent = (r.probability * 100).toFixed(1) + '%';
      box.appendChild(row);
    });
  }

  function renderBandit() {
    var html = '<table><thead><tr><th>Density</th><th>Pulls</th><th>Avg reward</th></tr></thead><tbody>';
    bandit.arms.forEach(function (a) {
      var s = bandit.stats[a];
      html += '<tr' + (a === bandit.current ? ' class="current"' : '') + '><td>' + a + (a === bandit.current ? ' (active)' : '') +
        '</td><td>' + s.n + '</td><td>' + (s.n ? s.value.toFixed(2) : '-') + '</td></tr>';
    });
    html += '</tbody></table>';
    html += '<p class="kv">Epsilon (exploration): ' + bandit.epsilon.toFixed(3) +
      ' &middot; Clicks in this pull: ' + bandit.clicksInPull + '/' + bandit.pullLength +
      ' &middot; Best so far: ' + bandit.bestArm() + '</p>';
    if (settings.density !== 'auto') {
      html += '<p class="kv">Density is set manually to "' + settings.density + '". Choose Auto (AI) to let the bandit decide.</p>';
    }
    $('banditInfo').innerHTML = html;
  }

  function renderThemeInfo() {
    var h = new Date().getHours();
    var v = themeLearner.votes;
    var html = '<table><thead><tr><th>Period</th><th>Light votes</th><th>Dark votes</th></tr></thead><tbody>' +
      '<tr><td>Day (6am-7pm)</td><td>' + v.day.light + '</td><td>' + v.day.dark + '</td></tr>' +
      '<tr><td>Night (7pm-6am)</td><td>' + v.night.light + '</td><td>' + v.night.dark + '</td></tr></tbody></table>';
    html += '<p class="kv">' + themeLearner.explain(h) + ' Current theme: ' + currentTheme() + '.</p>';
    $('themeInfo').innerHTML = html;
  }

  function applyTheme() {
    var t = currentTheme();
    document.documentElement.setAttribute('data-theme', t);
    $('themeLabel').textContent = t;
  }

  function applyDensity() {
    var d = currentDensity();
    document.documentElement.setAttribute('data-density', d);
    if (lastAppliedDensity && d !== lastAppliedDensity && settings.adaptive && settings.density === 'auto') {
      announce('Layout density changed to ' + d + '.');
    }
    lastAppliedDensity = d;
  }

  function renderControls() {
    $('adaptiveToggle').checked = settings.adaptive;
    $('densitySelect').value = settings.density;
  }

  function render() {
    applyTheme();
    applyDensity();
    renderControls();
    renderMenus();
    renderMain();
    renderPrediction();
    renderBandit();
    renderThemeInfo();
  }

  /* ---------------- events ---------------- */
  function selectSection(name) {
    settings.active = name;
    predictor.record(name);
  }

  function handleMenuClick(e) {
    var zone = e.target.closest('[data-zone]');
    if (!zone) return;
    var now = Date.now();
    var ms = Math.min(5000, now - lastActionTime);
    lastActionTime = now;

    var btn = e.target.closest('[data-item]');
    var hit = !!btn;

    if (hit && settings.adaptive) {
      selectSection(btn.dataset.item);
    } else if (hit) {
      settings.active = btn.dataset.item; // adaptation paused: do not learn
    }

    // Density bandit learns from accurate / missed clicks (only when it is in control).
    if (settings.adaptive && settings.density === 'auto') {
      bandit.recordClick(hit, ms);
    }

    var focusName = hit ? btn.dataset.item : null;
    save();
    render();
    if (focusName) {
      // keep keyboard focus on the same item after re-rendering
      var again = document.querySelector('#' + (zone.id) + ' [data-item="' + focusName + '"]');
      if (again) again.focus();
    }
  }

  function toggleTheme() {
    var now = currentTheme();
    var next = now === 'dark' ? 'light' : 'dark';
    if (settings.adaptive) {
      themeLearner.recordOverride(next, new Date().getHours()); // a manual toggle is a vote
    } else {
      settings.theme = next;
    }
    save();
    render();
  }

  function simulate() {
    // Creates a user with a stable habit: Assignments -> Grades -> Messages, repeated.
    var n = 40;
    var env = { // simulated user: bigger targets -> fewer mis-clicks and quicker clicks
      compact: { miss: 0.25, ms: 1200 },
      comfortable: { miss: 0.10, ms: 900 },
      spacious: { miss: 0.04, ms: 700 }
    };
    var t = Date.now() - n * 60000;
    for (var i = 0; i < n; i++) {
      predictor.record(SIM_PATTERN[i % SIM_PATTERN.length], t);
      t += 60000;
      var arm = bandit.current;
      var hit = Math.random() >= env[arm].miss;
      bandit.recordClick(hit, env[arm].ms);
    }
    settings.adaptive = true;
    save();
    render();
    announce('Simulation finished. Suggested for you now shows ' + predictor.suggest(3).join(', ') + '.');
  }

  function resetAll() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    freshModels();
    settings = { adaptive: true, density: 'auto', theme: null, active: 'Dashboard' };
    lastSuggestions = '';
    lastAppliedDensity = '';
    save();
    render();
    announce('Learning has been reset.');
  }

  function init() {
    if (!load()) freshModels();

    document.querySelectorAll('[data-zone]').forEach(function (z) {
      z.addEventListener('click', handleMenuClick);
      z.addEventListener('pointerenter', function () { lastActionTime = Date.now(); });
    });
    $('themeBtn').addEventListener('click', toggleTheme);
    $('simulateBtn').addEventListener('click', simulate);
    $('resetBtn').addEventListener('click', resetAll);
    $('adaptiveToggle').addEventListener('change', function (e) {
      settings.adaptive = e.target.checked;
      if (!settings.adaptive) settings.theme = currentTheme();
      lastSuggestions = '';
      save();
      render();
    });
    $('densitySelect').addEventListener('change', function (e) {
      settings.density = e.target.value;
      save();
      render();
    });

    // Re-check the theme once a minute so it follows the time of day.
    setInterval(function () { applyTheme(); renderThemeInfo(); }, 60000);

    render();
  }

  init();
})();
