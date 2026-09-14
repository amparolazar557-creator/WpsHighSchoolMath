(function (root, factory) {
  var api = factory();
  root.MathPlotAnalysis = api;
  if (typeof module === "object" && module.exports) { module.exports = api; }
})(typeof window !== "undefined" ? window : globalThis, function () {
  var EPS = 2.220446049250313e-16;
  var MAX_POINTS = 20;
  var SCAN_STEPS = 2048;

  function inside(domain, x) {
    return !(domain.min !== null && (x < domain.min || (x === domain.min && !domain.minClosed))) &&
      !(domain.max !== null && (x > domain.max || (x === domain.max && !domain.maxClosed)));
  }

  function sample(curve, x) {
    if (!inside(curve.curve.domain, x)) { return NaN; }
    var value = curve.evaluate(x);
    return isFinite(value) && Math.abs(value) <= 1e12 ? value : NaN;
  }

  function tangentAt(curve, x) {
    var domain = curve.curve.domain;
    if ((domain.min !== null && x <= domain.min) || (domain.max !== null && x >= domain.max)) {
      throw new Error("切点须在该曲线的定义域内部；本版不计算端点处的单侧切线。");
    }
    var y = sample(curve, x);
    if (!isFinite(y)) { throw new Error("切点处函数没有可用的有限值。"); }
    var h = Math.max(1, Math.abs(x)) * 0.001;
    if (domain.min !== null) { h = Math.min(h, (x - domain.min) / 4); }
    if (domain.max !== null) { h = Math.min(h, (domain.max - x) / 4); }
    var previous = null;
    var previousGap = null;
    var stable = 0;
    for (var iteration = 0; iteration < 18; iteration += 1) {
      if (x + h === x || x - h === x) { break; }
      var left = sample(curve, x - h);
      var right = sample(curve, x + h);
      if (!isFinite(left) || !isFinite(right)) { h /= 2; stable = 0; continue; }
      // Use actual representable distances, which need not equal h near large x.
      var dl = (y - left) / (x - (x - h));
      var dr = (right - y) / ((x + h) - x);
      var slope = (dl + dr) / 2;
      var scale = Math.max(1, Math.abs(slope));
      var roundoff = 16 * EPS * Math.max(Math.abs(y), Math.abs(left), Math.abs(right)) / h;
      var tolerance = 1e-5 * scale;
      var gap = Math.abs(dl - dr);
      var closesGap = gap <= 1e-7 * Math.max(Math.abs(dl), Math.abs(dr)) ||
        (previousGap !== null && gap <= 0.8 * previousGap);
      var agrees = gap <= tolerance && closesGap && previous !== null &&
        Math.abs(slope - previous) <= tolerance && roundoff < tolerance / 4;
      if (agrees && isFinite(slope) && Math.abs(slope) <= 1e10) { stable += 1; } else { stable = 0; }
      if (stable >= 2) { return { x: x, y: y, slope: slope, curve: curve.index }; }
      previous = slope;
      previousGap = gap;
      h /= 2;
    }
    throw new Error("此处无法可靠计算有限斜率切线，可能是尖点、间断点、竖直切线或数值精度不足，请调整切点。");
  }

  function findIntersections(first, second, minimum, maximum) {
    var points = [];
    var overlap = false;
    var truncated = false;
    var lo = minimum;
    var hi = maximum;
    [first, second].forEach(function (curve) {
      var domain = curve.curve.domain;
      if (domain.min !== null) { lo = Math.max(lo, domain.min); }
      if (domain.max !== null) { hi = Math.min(hi, domain.max); }
    });
    if (lo > hi) { return { points: [], message: "指定区间内没有共同定义域。", truncated: false }; }
    var spacing = (hi - lo) / SCAN_STEPS;
    var evaluations = 0;
    function at(x) {
      evaluations += 2;
      if (evaluations > 60000) { throw new Error("交点计算过于密集，请缩小搜索区间或简化表达式。"); }
      var a = sample(first, x);
      var b = sample(second, x);
      return { x: x, a: a, b: b, d: a - b };
    }
    function continuous(point) {
      var h = Math.max(spacing * 0.01, 64 * EPS * Math.max(1, Math.abs(point.x)));
      var sides = 0;
      for (var sign = -1; sign <= 1; sign += 2) {
        var farX = point.x + sign * h;
        if (farX < lo || farX > hi) { continue; }
        var far = at(farX);
        var near = at(point.x + sign * h / 2);
        if (!isFinite(far.d) || !isFinite(near.d)) { return false; }
        for (var keyIndex = 0; keyIndex < 2; keyIndex += 1) {
          var key = keyIndex === 0 ? "a" : "b";
          var coarse = Math.abs(far[key] - point[key]);
          var fine = Math.abs(near[key] - point[key]);
          var noise = 32 * EPS * Math.max(1e-300, Math.abs(point[key]), Math.abs(far[key]), Math.abs(near[key]));
          if (fine > 0.9 * coarse + noise) { return false; }
        }
        sides += 1;
      }
      return sides > 0 || lo === hi;
    }
    function add(point, bracketed) {
      if (!isFinite(point.d)) { return; }
      // A same-sign minimum needs a much stricter residual than a sign bracket.
      var tolerance = bracketed ? 1e-9 + 8 * EPS * Math.max(Math.abs(point.a), Math.abs(point.b)) :
        4 * EPS * Math.max(Math.abs(point.a), Math.abs(point.b));
      if (Math.abs(point.d) > tolerance || !continuous(point)) { return; }
      var separation = Math.max((hi - lo) * 1e-7, 128 * EPS * Math.max(1, Math.abs(point.x)));
      if (points.some(function (other) { return Math.abs(other.x - point.x) <= separation; })) { return; }
      if (points.length >= MAX_POINTS) { truncated = true; return; }
      points.push({ x: point.x, y: point.a / 2 + point.b / 2 });
    }
    function bisect(left, right) {
      var exact = null;
      for (var iteration = 0; iteration < 64; iteration += 1) {
        var middleX = left.x + (right.x - left.x) / 2;
        if (middleX === left.x || middleX === right.x) { break; }
        var middle = at(middleX);
        if (!isFinite(middle.d)) { return; }
        if (middle.d === 0) { exact = middle; break; }
        if ((left.d < 0) !== (middle.d < 0)) { right = middle; } else { left = middle; }
      }
      add(exact || (Math.abs(left.d) < Math.abs(right.d) ? left : right), true);
    }
    function minimumCandidate(left, right) {
      // Golden-section search locates sampled isolated minima, including common tangencies.
      var ratio = 0.6180339887498949;
      var a = left.x;
      var b = right.x;
      var c = at(b - ratio * (b - a));
      var d = at(a + ratio * (b - a));
      for (var iteration = 0; iteration < 72; iteration += 1) {
        if (!isFinite(c.d) || !isFinite(d.d)) { return; }
        if (a === b || c.x === d.x) { break; }
        if (Math.abs(c.d) < Math.abs(d.d)) {
          b = d.x; d = c; c = at(b - ratio * (b - a));
        } else {
          a = c.x; c = d; d = at(a + ratio * (b - a));
        }
      }
      add(Math.abs(c.d) < Math.abs(d.d) ? c : d, false);
    }
    if (lo === hi) { add(at(lo), false); }
    else {
      var samples = [];
      for (var i = 0; i <= SCAN_STEPS; i += 1) { samples.push(at(lo + (hi - lo) * i / SCAN_STEPS)); }
      for (i = 0; i < samples.length && !truncated; i += 1) {
        var current = samples[i];
        var left = samples[i - 1];
        var right = samples[i + 1];
        if (!isFinite(current.d)) { continue; }
        if (current.d === 0) {
          if ((left && left.d === 0) || (right && right.d === 0)) { overlap = true; }
          else { add(current, false); }
        }
        if (right && isFinite(right.d) && current.d !== 0 && right.d !== 0 && (current.d < 0) !== (right.d < 0)) {
          bisect(current, right);
        }
        if (left && right && isFinite(left.d) && isFinite(right.d) &&
            current.d !== 0 && Math.abs(current.d) < Math.abs(left.d) && Math.abs(current.d) < Math.abs(right.d) &&
            (left.d < 0) === (right.d < 0)) { minimumCandidate(left, right); }
      }
    }
    points.sort(function (a, b) { return a.x - b.x; });
    var message = overlap ? "部分区间重合或数值无法区分，未对这些区间逐点标注。" : "";
    if (truncated) { message += "交点较多，已显示前 20 个，请缩小搜索区间。"; }
    return { points: points, message: message, truncated: truncated };
  }

  function analyze(config, compiled, evaluateConstant) {
    var settings = config.analysis || {};
    var result = { points: [], tangent: null, messages: [] };
    function curve(index) {
      var selected = compiled.filter(function (entry) { return entry.index === index; })[0];
      if (!selected) { throw new Error("分析对象未显示，请先显示相应曲线。"); }
      return selected;
    }
    if (settings.intersection) {
      var search = settings.intersection;
      var second = search.second === "axis" ? {
        evaluate: function () { return 0; }, index: -1,
        curve: { domain: { min: null, max: null, minClosed: true, maxClosed: true } }
      } : curve(search.second);
      var intersections = findIntersections(curve(search.first), second,
        search.min === null ? config.bounds.xMin : search.min,
        search.max === null ? config.bounds.xMax : search.max);
      result.points = intersections.points;
      if (intersections.message) { result.messages.push(intersections.message); }
      result.messages.push("交点为数值近似；搜索可能遗漏相切或密集交点，可缩小区间复核。");
    }
    if (settings.tangent) {
      var x = evaluateConstant(settings.tangent.x);
      if (!isFinite(x) || Math.abs(x) > 1e9) { throw new Error("切点横坐标须为绝对值不超过十亿的有限数值。"); }
      result.tangent = tangentAt(curve(settings.tangent.curve), x);
    }
    return result;
  }

  return { analyze: analyze, tangentAt: tangentAt, findIntersections: findIntersections };
});
