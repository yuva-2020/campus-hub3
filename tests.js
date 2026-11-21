/*
 * tests.js - checks the properties of the three models.
 *   Node:    node tests.js
 *   Browser: open tests.html
 */
(function () {
  'use strict';

  var M = (typeof module === 'object' && module.exports)
    ? require('./models.js')
    : window.AdaptiveModels;

  var ITEMS = ['Dashboard', 'Courses', 'Assignments', 'Grades', 'Messages', 'Calendar', 'Library', 'Settings'];
  var DAY = 86400000;
  var results = [];

  function test(name, fn) {
    try { fn(); results.push({ name: name, ok: true }); }
    catch (e) { results.push({ name: name, ok: false, msg: e.message }); }
  }
  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

  // Small seeded random generator so the bandit test is repeatable.
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  test('Predictor: probabilities sum to 1', function () {
    var p = new M.NextActionPredictor(ITEMS);
    var now = Date.now();
    ['Assignments', 'Grades', 'Messages', 'Assignments', 'Library'].forEach(function (i, k) {
      p.record(i, now + k * 1000);
    });
    var sum = p.predict(now + 10000).reduce(function (s, r) { return s + r.probability; }, 0);
    assert(Math.abs(sum - 1) < 1e-9, 'sum was ' + sum);
    var empty = new M.NextActionPredictor(ITEMS);
    var sum2 = empty.predict().reduce(function (s, r) { return s + r.probability; }, 0);
    assert(Math.abs(sum2 - 1) < 1e-9, 'empty sum was ' + sum2);
  });

  test('Predictor: common items rank higher', function () {
    var p = new M.NextActionPredictor(ITEMS);
    var now = Date.now();
    for (var k = 0; k < 6; k++) p.record('Library', now + k * 1000);
    p.record('Courses', now + 7000);
    p.record('Settings', now + 8000);
    var rec = p.recencyDistribution(now + 9000);
    assert(rec.Library > rec.Courses && rec.Library > rec.Settings, 'Library should have the highest weight');
  });

  test('Predictor: Markov component learns patterns', function () {
    var p = new M.NextActionPredictor(ITEMS);
    var now = Date.now();
    var pattern = ['Assignments', 'Grades', 'Messages'];
    for (var k = 0; k < 30; k++) p.record(pattern[k % 3], now + k * 1000); // ends on Messages
    var m = p.markovDistribution(); // P(next | Messages)
    var best = ITEMS.reduce(function (b, i) { return m[i] > m[b] ? i : b; }, ITEMS[0]);
    assert(best === 'Assignments', 'after Messages expected Assignments, got ' + best);
  });

  test('Predictor: recent actions have more influence than old ones', function () {
    var p = new M.NextActionPredictor(ITEMS);
    var now = Date.now();
    for (var k = 0; k < 5; k++) p.record('Calendar', now - 10 * DAY + k * 1000); // 5 old clicks
    p.record('Library', now); // 1 recent click
    var rec = p.recencyDistribution(now);
    assert(rec.Library > rec.Calendar, 'recent Library should outweigh 5 old Calendar clicks');
  });

  test('Bandit: converges to the best arm in a simulated reward test', function () {
    var env = mulberry32(42);
    var bandit = new M.DensityBandit(['compact', 'comfortable', 'spacious'], { rng: mulberry32(7) });
    var model = { // simulated user: bigger targets -> fewer mis-clicks, faster clicks
      compact: { miss: 0.25, ms: 1200 },
      comfortable: { miss: 0.10, ms: 900 },
      spacious: { miss: 0.04, ms: 700 }
    };
    var pulls = { compact: 0, comfortable: 0, spacious: 0 };
    bandit.start();
    for (var click = 0; click < 3000; click++) {
      var arm = bandit.current;
      var hit = env() >= model[arm].miss;
      var res = bandit.recordClick(hit, model[arm].ms);
      if (res.finishedPull) pulls[res.finishedPull.arm] += 1;
    }
    assert(bandit.bestArm() === 'spacious', 'best arm was ' + bandit.bestArm());
    assert(pulls.spacious > pulls.compact && pulls.spacious > pulls.comfortable, 'spacious should be pulled most: ' + JSON.stringify(pulls));
    assert(bandit.epsilon >= 0.05 && bandit.epsilon <= 0.15, 'epsilon out of range: ' + bandit.epsilon);
  });

  test('Bandit: mis-click reward is negative, accurate click is positive', function () {
    assert(M.DensityBandit.clickReward(false, 500) < 0, 'miss should be negative');
    assert(M.DensityBandit.clickReward(true, 500) > 1, 'fast hit should be above 1');
    assert(M.DensityBandit.clickReward(true, 500) > M.DensityBandit.clickReward(true, 2500), 'faster should score higher');
  });

  test('Theme learner: default by time of day, then follows overrides', function () {
    var t = new M.ThemeLearner();
    assert(t.themeFor(22) === 'dark', '10 pm should default to dark');
    assert(t.themeFor(3) === 'dark', '3 am should default to dark');
    assert(t.themeFor(10) === 'light', '10 am should default to light');
    t.recordOverride('light', 22);
    t.recordOverride('light', 21);
    assert(t.themeFor(22) === 'light', 'night should now follow the user (light)');
    assert(t.themeFor(10) === 'light', 'day should be unaffected');
    t.recordOverride('dark', 12);
    assert(t.themeFor(13) === 'dark', 'day should follow a dark override');
  });

  test('State survives serialisation (save and load)', function () {
    var p = new M.NextActionPredictor(ITEMS);
    var b = new M.DensityBandit();
    var t = new M.ThemeLearner();
    var now = Date.now();
    ['Assignments', 'Grades', 'Messages', 'Assignments'].forEach(function (i, k) { p.record(i, now + k); });
    b.start();
    for (var k = 0; k < 25; k++) b.recordClick(k % 5 !== 0, 800);
    t.recordOverride('light', 23);

    var p2 = M.NextActionPredictor.fromJSON(JSON.parse(JSON.stringify(p)));
    var b2 = M.DensityBandit.fromJSON(JSON.parse(JSON.stringify(b)));
    var t2 = M.ThemeLearner.fromJSON(JSON.parse(JSON.stringify(t)));

    assert(JSON.stringify(p2.predict(now + 10)) === JSON.stringify(p.predict(now + 10)), 'predictor changed');
    assert(JSON.stringify(b2.toJSON()) === JSON.stringify(b.toJSON()), 'bandit changed');
    assert(t2.themeFor(23) === t.themeFor(23), 'theme learner changed');
  });

  /* ---- report ---- */
  var passed = results.filter(function (r) { return r.ok; }).length;

  if (typeof document !== 'undefined') {
    var ul = document.getElementById('results');
    results.forEach(function (r) {
      var li = document.createElement('li');
      li.className = r.ok ? 'pass' : 'fail';
      li.textContent = (r.ok ? 'PASS  ' : 'FAIL  ') + r.name + (r.ok ? '' : ' - ' + r.msg);
      ul.appendChild(li);
    });
    document.getElementById('summary').textContent = passed + ' of ' + results.length + ' tests passed';
  } else {
    results.forEach(function (r) {
      console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.name + (r.ok ? '' : ' - ' + r.msg));
    });
    console.log('\n' + passed + ' of ' + results.length + ' tests passed');
    if (passed !== results.length) process.exit(1);
  }
})();
