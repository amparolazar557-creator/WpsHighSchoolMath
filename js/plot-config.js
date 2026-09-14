(function (root, factory) {
  var api = factory();
  root.MathPlotConfig = api;
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  var MAX_CURVES = 12;
  var COLORS = ["#2563eb", "#dc2626", "#059669", "#7c3aed", "#d97706", "#0891b2"];
  var LINE_STYLES = ["solid", "dashed", "dotted", "dashdot"];
  var DEFAULT_CONFIG = {
    expressions: ["x^2"],
    bounds: { xMin: -10, xMax: 10, yMin: -10, yMax: 10 },
    options: { showTickLabels: true, showGrid: true, showBorder: true, showLegend: true }
  };

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function number(value, label, optional) {
    if (value === null || value === undefined || String(value).trim() === "") {
      if (optional) { return null; }
      throw new Error(label + "不能为空。");
    }
    var result = Number(value);
    if (!isFinite(result) || Math.abs(result) > 1e9) {
      throw new Error(label + "请输入绝对值不超过十亿的有限数值。");
    }
    return result;
  }

  function normalizeBounds(input) {
    var source = input || {};
    var result = {
      xMin: number(source.xMin, "横坐标最小值"),
      xMax: number(source.xMax, "横坐标最大值"),
      yMin: number(source.yMin, "纵坐标最小值"),
      yMax: number(source.yMax, "纵坐标最大值")
    };
    if (result.xMax - result.xMin < 1e-8) {
      throw new Error("横坐标范围无效：最大值须大于最小值，间距至少为 0.00000001。");
    }
    if (result.yMax - result.yMin < 1e-8) {
      throw new Error("纵坐标范围无效：最大值须大于最小值，间距至少为 0.00000001。");
    }
    return result;
  }

  function normalizeCurve(input, index) {
    var source = input || {};
    var domain = source.domain || {};
    var minimum = number(domain.min, "定义域左端", true);
    var maximum = number(domain.max, "定义域右端", true);
    if (minimum !== null && maximum !== null && minimum >= maximum) {
      throw new Error("定义域右端必须大于左端。");
    }
    var color = source.color || COLORS[index % COLORS.length];
    if (!/^#[0-9a-f]{6}$/i.test(color)) { throw new Error("曲线颜色无效。"); }
    var style = source.lineStyle || "solid";
    if (LINE_STYLES.indexOf(style) < 0) { throw new Error("曲线线型无效。"); }
    return {
      color: color.toLowerCase(),
      lineStyle: style,
      visible: source.visible !== false,
      domain: {
        min: minimum, max: maximum,
        minClosed: domain.minClosed !== false, maxClosed: domain.maxClosed !== false
      }
    };
  }

  function normalizePoints(input) {
    if (!Array.isArray(input) || input.length > 30) {
      throw new Error("坐标点最多支持 30 个。");
    }
    return input.map(function (point, index) {
      if (!point || typeof point !== "object") { throw new Error("第 " + (index + 1) + " 个坐标点无效。"); }
      var label = String(point.label || "").trim();
      if (label.length > 30) { throw new Error("坐标点名称最多 30 个字符。"); }
      return { label: label, x: number(point.x, "点的横坐标"), y: number(point.y, "点的纵坐标") };
    });
  }

  function normalizeParameters(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) { throw new Error("参数设置无效。"); }
    if (Object.keys(input).some(function (name) { return ["a", "b", "c"].indexOf(name) < 0; })) {
      throw new Error("只支持 a、b、c 三个参数。");
    }
    var result = {};
    ["a", "b", "c"].forEach(function (name) {
      var source = input[name] === undefined ? { value: name === "a" ? 1 : 0, min: -5, max: 5, step: 0.1 } : input[name];
      if (!source || typeof source !== "object" || Array.isArray(source)) { throw new Error("参数 " + name + " 设置无效。"); }
      var parameter = {};
      ["value", "min", "max", "step"].forEach(function (key) {
        if (typeof source[key] !== "string" && typeof source[key] !== "number") { throw new Error("参数 " + name + " 请输入完整数值。"); }
        parameter[key] = number(source[key], "参数 " + name);
      });
      var span = parameter.max - parameter.min;
      if (span < 1e-8) { throw new Error("参数 " + name + " 的最大值须大于最小值，间距至少为 0.00000001。"); }
      if (parameter.step <= 0 || parameter.step > span || span / parameter.step > 1000000) {
        throw new Error("参数 " + name + " 的步长须大于 0、不超过范围，且滑动不超过一百万步。");
      }
      if (parameter.value < parameter.min || parameter.value > parameter.max) {
        throw new Error("参数 " + name + " 的当前值须在滑块范围内。");
      }
      result[name] = parameter;
    });
    return result;
  }

  function normalizeGuides(input) {
    if (!Array.isArray(input) || input.length > 20) { throw new Error("辅助线最多支持 20 条。"); }
    return input.map(function (guide, index) {
      if (!guide || ["x", "y"].indexOf(guide.axis) < 0) { throw new Error("第 " + (index + 1) + " 条辅助线须为 x= 或 y=。"); }
      var expression = String(guide.expression === undefined ? "" : guide.expression).trim();
      if (!expression || expression.length > 100) { throw new Error("辅助线等号后请输入 1—100 个字符的数值或参数表达式。"); }
      return { axis: guide.axis, expression: expression };
    });
  }

  // Keep legacy configs minimal; optional fields are added only when supplied.
  function normalizeConfig(input) {
    var source = input || {};
    if (!Array.isArray(source.expressions)) { throw new Error("请至少输入一个函数表达式。"); }
    if (source.expressions.length > MAX_CURVES) { throw new Error("最多支持 " + MAX_CURVES + " 条曲线，请删除多余行。"); }
    if (source.curves !== undefined && (!Array.isArray(source.curves) || source.curves.length !== source.expressions.length)) {
      throw new Error("曲线设置与表达式数量不一致。");
    }
    var expressions = [];
    var curves = [];
    var indexMap = {};
    source.expressions.forEach(function (entry, index) {
      var expression = String(entry === null || entry === undefined ? "" : entry).trim();
      if (!expression) { return; }
      indexMap[index] = expressions.length;
      try {
        if (expression.length > 1000) { throw new Error("表达式过长，请缩短到 1000 个字符以内。"); }
        curves.push(normalizeCurve(source.curves && source.curves[index], index));
      } catch (error) {
        error.message = "第 " + (index + 1) + " 条函数：" + error.message;
        error.curveIndex = index;
        throw error;
      }
      expressions.push(expression);
    });
    if (!expressions.length) { throw new Error("请至少输入一个函数表达式。"); }
    var options = source.options || {};
    var result = {
      expressions: expressions,
      bounds: normalizeBounds(source.bounds),
      options: {
        showTickLabels: options.showTickLabels !== false,
        showGrid: options.showGrid !== false,
        showBorder: options.showBorder !== false,
        showLegend: options.showLegend !== false
      }
    };
    if (source.curves !== undefined) { result.curves = curves; }
    if (source.points !== undefined) { result.points = normalizePoints(source.points); }
    if (options.monochrome !== undefined) { result.options.monochrome = options.monochrome === true; }
    if (source.parameters !== undefined) { result.parameters = normalizeParameters(source.parameters); }
    if (source.guides !== undefined) { result.guides = normalizeGuides(source.guides); }
    if (source.analysis !== undefined) {
      var analysis = source.analysis;
      if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) { throw new Error("交点与切线设置无效。"); }
      var normalizedAnalysis = {};
      function reference(value) {
        if (typeof value !== "number" || value % 1 !== 0 || !Object.prototype.hasOwnProperty.call(indexMap, value)) {
          throw new Error("分析对象不存在或表达式为空，请重新选择曲线。");
        }
        var index = indexMap[value];
        if (!curves[index].visible) { throw new Error("分析对象未显示，请先显示相应曲线。"); }
        return index;
      }
      if (analysis.intersection) {
        var search = analysis.intersection;
        var first = reference(search.first);
        var second = search.second === "axis" ? "axis" : reference(search.second);
        if (first === second) { throw new Error("请为交点选择两条不同曲线。"); }
        var min = number(search.min, "交点搜索左端", true);
        var max = number(search.max, "交点搜索右端", true);
        if ((max === null ? result.bounds.xMax : max) - (min === null ? result.bounds.xMin : min) < 1e-8) {
          throw new Error("交点搜索右端须大于左端，留空端点使用当前横坐标范围。");
        }
        normalizedAnalysis.intersection = { first: first, second: second, min: min, max: max };
      }
      if (analysis.tangent) {
        var tangent = analysis.tangent;
        var x = String(tangent.x === undefined ? "" : tangent.x).trim();
        if (!x || x.length > 100) { throw new Error("切点横坐标请输入 1—100 个字符的数值或参数表达式。"); }
        normalizedAnalysis.tangent = { curve: reference(tangent.curve), x: x };
      }
      if (Object.keys(normalizedAnalysis).length) { result.analysis = normalizedAnalysis; }
    }
    return result;
  }

  return {
    MAX_CURVES: MAX_CURVES,
    COLORS: COLORS.slice(),
    LINE_STYLES: LINE_STYLES.slice(),
    normalizeCurve: normalizeCurve,
    normalizeBounds: normalizeBounds,
    normalizeParameters: normalizeParameters,
    normalizeConfig: normalizeConfig,
    getDefaultConfig: function () { return clone(DEFAULT_CONFIG); }
  };
});
