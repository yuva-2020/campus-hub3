/*
 * models.js - Campus Hub adaptive models (no dependencies).
 *
 * Works in the browser (window.AdaptiveModels) and in Node (require('./models.js')).
 *
 *  1. NextActionPredictor - recency-weighted frequency + first-order Markov chain
 *  2. DensityBandit       - epsilon-greedy multi-armed bandit (reinforcement learning)
 *  3. ThemeLearner        - rule-based learner that follows the user's manual overrides
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AdaptiveModels = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY_MS = 24 * 60 * 60 * 1000;

  function clamp(x, lo, hi) {
    return Math.min(hi, Math.max(lo, x));
  }

  /* ------------------------------------------------------------------ */
  /* 1. Next-action predictor                                            */
  /* ------------------------------------------------------------------ */
  function NextActionPredictor(items, opts) {
    opts = opts || {};
    this.items = items.slice();
    this.alpha = opts.alpha !== undefined ? opts.alpha : 0.5; // blend weight
    this.decay = opts.decay !== undefined ? opts.decay : 0.5; // weight = decay ^ daysAgo
    this.maxHistory = opts.maxHistory || 500;
    this.history = []; // [{item, t}]
    this.transitions = {}; // prev -> { next: count }
  }

  NextActionPredictor.prototype.record = function (item, now) {
    if (this.items.indexOf(item) === -1) return;
    now = now === undefined ? Date.now() : now;
    var last = this.history.length ? this.history[this.history.length - 1].item : null;
    if (last !== null) {
      if (!this.transitions[last]) this.transitions[last] = {};
      this.transitions[last][item] = (this.transitions[last][item] || 0) + 1;
    }
    this.history.push({ item: item, t: now });
    if (this.history.length > this.maxHistory) this.history.shift();
  };

  // Component 1: recency-weighted frequency. Each past selection counts decay^(days ago).
  NextActionPredictor.prototype.recencyDistribution = function (now) {
    now = now === undefined ? Date.now() : now;
    var self = this;
    var w = {};
    this.items.forEach(function (i) { w[i] = 0; });
    this.history.forEach(function (h) {
      var days = Math.max(0, (now - h.t) / DAY_MS);
      w[h.item] += Math.pow(self.decay, days);
    });
    var total = this.items.reduce(function (s, i) { return s + w[i]; }, 0);
    var dist = {};
    this.items.forEach(function (i) {
      dist[i] = total > 0 ? w[i] / total : 1 / self.items.length;
    });
    return dist;
  };

  // Component 2: first-order Markov chain with Laplace (add-one) smoothing.
  // P(next | last) = (count(last->next) + 1) / (count(last->*) + N)
  NextActionPredictor.prototype.markovDistribution = function () {
    var N = this.items.length;
    var last = this.history.length ? this.history[this.history.length - 1].item : null;
    var counts = (last && this.transitions[last]) || {};
    var total = 0;
    this.items.forEach(function (i) { total += counts[i] || 0; });
    var dist = {};
    this.items.forEach(function (i) {
      dist[i] = ((counts[i] || 0) + 1) / (total + N);
    });
    return dist;
  };

  // Blend the two distributions: alpha * recency + (1 - alpha) * markov
  NextActionPredictor.prototype.predict = function (now) {
    var f = this.recencyDistribution(now);
    var m = this.markovDistribution();
    var a = this.alpha;
    var order = this.items;
    var rows = order.map(function (i, idx) {
      return {
        item: i,
        probability: a * f[i] + (1 - a) * m[i],
        recency: f[i],
        markov: m[i],
        idx: idx
      };
    });
    rows.sort(function (x, y) {
      return y.probability - x.probability || x.idx - y.idx;
    });
    return rows;
  };

  NextActionPredictor.prototype.suggest = function (k, now) {
    return this.predict(now).slice(0, k === undefined ? 3 : k).map(function (r) { return r.item; });
  };

  NextActionPredictor.prototype.toJSON = function () {
    return {
      items: this.items, alpha: this.alpha, decay: this.decay,
      history: this.history, transitions: this.transitions
    };
  };

  NextActionPredictor.fromJSON = function (o) {
    var p = new NextActionPredictor(o.items, { alpha: o.alpha, decay: o.decay });
    p.history = o.history || [];
    p.transitions = o.transitions || {};
    return p;
  };

  /* ------------------------------------------------------------------ */
  /* 2. Layout-density bandit (epsilon-greedy)                           */
  /* ------------------------------------------------------------------ */
  function DensityBandit(arms, opts) {
    opts = opts || {};
    this.arms = (arms || ['compact', 'comfortable', 'spacious']).slice();
    this.pullLength = opts.pullLength || 10; // clicks per pull
    this.epsilon = opts.epsilon !== undefined ? opts.epsilon : 0.15;
    this.minEpsilon = opts.minEpsilon !== undefined ? opts.minEpsilon : 0.05;
    this.epsilonDecay = opts.epsilonDecay !== undefined ? opts.epsilonDecay : 0.9; // per pull
    this.rng = opts.rng || Math.random;
    this.stats = {};
    var self = this;
    this.arms.forEach(function (a) { self.stats[a] = { n: 0, value: 0 }; });
    this.current = null;
    this.clicksInPull = 0;
    this.rewardSum = 0;
  }

  // Reward for a single click: accurate + fast is high, a mis-click is negative.
  DensityBandit.clickReward = function (hit, ms) {
    if (!hit) return -1;
    var speed = clamp(1 - (ms === undefined ? 1500 : ms) / 3000, 0, 1);
    return 1 + 0.5 * speed;
  };

  DensityBandit.prototype.selectArm = function () {
    var self = this;
    // Try every arm once before exploiting.
    for (var i = 0; i < this.arms.length; i++) {
      if (this.stats[this.arms[i]].n === 0) return this.arms[i];
    }
    if (this.rng() < this.epsilon) {
      return this.arms[Math.floor(this.rng() * this.arms.length) % this.arms.length]; // explore
    }
    return this.arms.reduce(function (best, a) { // exploit
      return self.stats[a].value > self.stats[best].value ? a : best;
    }, this.arms[0]);
  };

  DensityBandit.prototype.start = function () {
    this.current = this.selectArm();
    this.clicksInPull = 0;
    this.rewardSum = 0;
    return this.current;
  };

  // Record one click on the currently pulled arm. Returns info about the click.
  DensityBandit.prototype.recordClick = function (hit, ms) {
    if (this.current === null) this.start();
    var r = DensityBandit.clickReward(hit, ms);
    this.rewardSum += r;
    this.clicksInPull += 1;
    var finished = null;
    if (this.clicksInPull >= this.pullLength) {
      finished = this.finishPull();
    }
    return { reward: r, finishedPull: finished };
  };

  // End the pull: average reward -> incremental value update -> choose next arm.
  DensityBandit.prototype.finishPull = function () {
    var arm = this.current;
    var avg = this.rewardSum / Math.max(1, this.clicksInPull);
    var s = this.stats[arm];
    s.n += 1;
    s.value += (avg - s.value) / s.n; // incremental mean
    this.epsilon = Math.max(this.minEpsilon, this.epsilon * this.epsilonDecay);
    var result = { arm: arm, averageReward: avg };
    this.start();
    return result;
  };

  DensityBandit.prototype.bestArm = function () {
    var self = this;
    return this.arms.reduce(function (best, a) {
      return self.stats[a].value > self.stats[best].value ? a : best;
    }, this.arms[0]);
  };

  DensityBandit.prototype.toJSON = function () {
    return {
      arms: this.arms, pullLength: this.pullLength, epsilon: this.epsilon,
      minEpsilon: this.minEpsilon, epsilonDecay: this.epsilonDecay,
      stats: this.stats, current: this.current,
      clicksInPull: this.clicksInPull, rewardSum: this.rewardSum
    };
  };

  DensityBandit.fromJSON = function (o, rng) {
    var b = new DensityBandit(o.arms, {
      pullLength: o.pullLength, epsilon: o.epsilon, minEpsilon: o.minEpsilon,
      epsilonDecay: o.epsilonDecay, rng: rng
    });
    b.stats = o.stats;
    b.current = o.current;
    b.clicksInPull = o.clicksInPull;
    b.rewardSum = o.rewardSum;
    return b;
  };

  /* ------------------------------------------------------------------ */
  /* 3. Theme learner (rule-based, learns from manual overrides)         */
  /* ------------------------------------------------------------------ */
  function ThemeLearner(opts) {
    opts = opts || {};
    this.nightStart = opts.nightStart !== undefined ? opts.nightStart : 19; // 7 pm
    this.nightEnd = opts.nightEnd !== undefined ? opts.nightEnd : 6; // 6 am
    this.votes = {
      day: { light: 0, dark: 0 },
      night: { light: 0, dark: 0 }
    };
    this.lastVote = { day: null, night: null };
  }

  ThemeLearner.prototype.period = function (hour) {
    return (hour >= this.nightStart || hour < this.nightEnd) ? 'night' : 'day';
  };

  ThemeLearner.prototype.defaultTheme = function (hour) {
    return this.period(hour) === 'night' ? 'dark' : 'light';
  };

  // A manual theme toggle is a "vote" for that theme in the current time period.
  ThemeLearner.prototype.recordOverride = function (theme, hour) {
    var p = this.period(hour);
    this.votes[p][theme] += 1;
    this.lastVote[p] = theme;
  };

  ThemeLearner.prototype.themeFor = function (hour) {
    var p = this.period(hour);
    var v = this.votes[p];
    if (v.light + v.dark === 0) return this.defaultTheme(hour);
    if (v.light === v.dark) return this.lastVote[p];
    return v.light > v.dark ? 'light' : 'dark';
  };

  ThemeLearner.prototype.explain = function (hour) {
    var p = this.period(hour);
    var v = this.votes[p];
    if (v.light + v.dark === 0) {
      return 'Using the default for ' + p + ' time (' + this.defaultTheme(hour) + ').';
    }
    return 'Following your ' + (v.light + v.dark) + ' override(s) for ' + p + ' time.';
  };

  ThemeLearner.prototype.toJSON = function () {
    return {
      nightStart: this.nightStart, nightEnd: this.nightEnd,
      votes: this.votes, lastVote: this.lastVote
    };
  };

  ThemeLearner.fromJSON = function (o) {
    var t = new ThemeLearner({ nightStart: o.nightStart, nightEnd: o.nightEnd });
    t.votes = o.votes;
    t.lastVote = o.lastVote;
    return t;
  };

  return {
    NextActionPredictor: NextActionPredictor,
    DensityBandit: DensityBandit,
    ThemeLearner: ThemeLearner
  };
});
