(function (root, factory) {
  var configApi = typeof module === "object" && module.exports ? require("./plot-config.js") : root.MathPlotConfig;
  var analysisApi = typeof module === "object" && module.exports ? require("./plot-analysis.js") : root.MathPlotAnalysis;
  var api = factory(configApi, analysisApi);
  root.FunctionPlotter = api;
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function (configApi, analysisApi) {
  var FUNCTIONS = {
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    cot: function (value) { return 1 / Math.tan(value); },
    sec: function (value) { return 1 / Math.cos(value); },
    csc: function (value) { return 1 / Math.sin(value); },
    asin: Math.asin,
    acos: Math.acos,
    atan: Math.atan,
    sqrt: Math.sqrt,
    abs: Math.abs,
    ln: Math.log,
    log: function (value) { return Math.log(value) / Math.LN10; },
    lg: function (value) { return FUNCTIONS.log(value); },
    exp: Math.exp,
    floor: Math.floor,
    ceil: Math.ceil,
    sign: function (value) { return value === 0 ? 0 : (value > 0 ? 1 : -1); }
  };

  var DASHES = { solid: "", dashed: "9 5", dotted: "2 5", dashdot: "9 4 2 4" };

  function normalizeExpression(expression) {
    return String(expression || "")
      .trim()
      .replace(/^[yf]\s*(?:\(\s*x\s*\))?\s*=/i, "")
      .replace(/[−–—]/g, "-")
      .replace(/[×·]/g, "*")
      .replace(/÷/g, "/")
      .replace(/π/g, "pi")
      .replace(/√\s*\(/g, "sqrt(")
      .replace(/√\s*([A-Za-z]+|(?:\d+(?:\.\d*)?|\.\d+))/g, "sqrt($1)")
      .replace(/([A-Za-z0-9.)])²/g, "$1^2")
      .replace(/([A-Za-z0-9.)])³/g, "$1^3");
  }

  function rawTokens(expression) {
    var input = normalizeExpression(expression);
    var tokens = [];
    var index = 0;

    while (index < input.length) {
      var rest = input.slice(index);
      var whitespace = rest.match(/^\s+/);
      if (whitespace) {
        index += whitespace[0].length;
        continue;
      }

      var number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
      if (number) {
        tokens.push({ type: "number", value: Number(number[0]) });
        index += number[0].length;
        continue;
      }

      var identifier = rest.match(/^[A-Za-z]+/);
      if (identifier) {
        var name = identifier[0].toLowerCase();
        // Split only adjacent single-letter variables, leaving function names intact.
        var names = /^[abcx]+$/.test(name) ? name.split("") : [name];
        names.forEach(function (part) { tokens.push({ type: "identifier", value: part }); });
        index += identifier[0].length;
        continue;
      }

      var character = input[index];
      if ("+-*/^(),".indexOf(character) >= 0) {
        tokens.push({ type: character, value: character });
        index += 1;
        continue;
      }

      throw new Error("无法识别字符：" + character);
    }

    return addImplicitMultiplication(tokens);
  }

  function endsValue(token) {
    return token && (
      token.type === "number" ||
      token.type === "identifier" ||
      token.type === ")"
    );
  }

  function startsValue(token) {
    return token && (
      token.type === "number" ||
      token.type === "identifier" ||
      token.type === "("
    );
  }

  function addImplicitMultiplication(tokens) {
    var result = [];
    for (var index = 0; index < tokens.length; index += 1) {
      var current = tokens[index];
      var previous = result[result.length - 1];
      var isFunctionCall = previous &&
        previous.type === "identifier" &&
        FUNCTIONS[previous.value] &&
        current.type === "(";
      if (endsValue(previous) && startsValue(current) && !isFunctionCall) {
        result.push({ type: "*", value: "*" });
      }
      result.push(current);
    }
    return result;
  }

  function compileExpression(expression, parameters) {
    if (String(expression || "").length > 1000) { throw new Error("表达式过长，请缩短到 1000 个字符以内。"); }
    var tokens = rawTokens(expression);
    var position = 0;
    var usedParameters = [];
    var usesX = false;

    function peek(type) {
      return tokens[position] && tokens[position].type === type;
    }

    function take(type) {
      if (!peek(type)) {
        throw new Error("表达式格式错误，缺少 " + type);
      }
      return tokens[position++];
    }

    function combine(operator, left, right) {
      if (operator === "+") {
        return function (x) { return left(x) + right(x); };
      }
      if (operator === "-") {
        return function (x) { return left(x) - right(x); };
      }
      if (operator === "*") {
        return function (x) { return left(x) * right(x); };
      }
      return function (x) { return left(x) / right(x); };
    }

    function parseExpression() {
      var left = parseTerm();
      while (peek("+") || peek("-")) {
        var operator = tokens[position++].type;
        var right = parseTerm();
        left = combine(operator, left, right);
      }
      return left;
    }

    function parseTerm() {
      var left = parseUnary();
      while (peek("*") || peek("/")) {
        var operator = tokens[position++].type;
        var right = parseUnary();
        left = combine(operator, left, right);
      }
      return left;
    }

    function parseUnary() {
      if (peek("+")) {
        position += 1;
        return parseUnary();
      }
      if (peek("-")) {
        position += 1;
        var value = parseUnary();
        return function (x) { return -value(x); };
      }
      return parsePower();
    }

    function parsePower() {
      var base = parsePrimary();
      if (peek("^")) {
        position += 1;
        var exponent = parseUnary();
        return function (x) { return Math.pow(base(x), exponent(x)); };
      }
      return base;
    }

    function parsePrimary() {
      if (peek("number")) {
        var number = tokens[position++].value;
        return function () { return number; };
      }

      if (peek("identifier")) {
        var name = tokens[position++].value;
        if (name === "x") {
          usesX = true;
          return function (x) { return x; };
        }
        if (["a", "b", "c"].indexOf(name) >= 0) {
          if (!parameters || !Object.prototype.hasOwnProperty.call(parameters, name) ||
              typeof parameters[name] !== "number" || !isFinite(parameters[name]) || Math.abs(parameters[name]) > 1e9) {
            throw new Error("请展开“参数滑块”设置参数 " + name + " 的数值。");
          }
          var parameterValue = parameters[name];
          if (usedParameters.indexOf(name) < 0) { usedParameters.push(name); }
          return function () { return parameterValue; };
        }
        if (name === "pi") {
          return function () { return Math.PI; };
        }
        if (name === "e") {
          return function () { return Math.E; };
        }
        if (!Object.prototype.hasOwnProperty.call(FUNCTIONS, name)) {
          throw new Error("不支持的函数或变量：" + name);
        }
        take("(");
        var argument = parseExpression();
        take(")");
        return function (x) { return FUNCTIONS[name](argument(x)); };
      }

      if (peek("(")) {
        position += 1;
        var value = parseExpression();
        take(")");
        return value;
      }

      throw new Error("表达式格式错误");
    }

    if (!tokens.length) {
      throw new Error("请输入函数表达式");
    }
    var evaluator = parseExpression();
    if (position !== tokens.length) {
      throw new Error("表达式末尾存在无法解析的内容");
    }
    evaluator.usedParameters = usedParameters.sort();
    evaluator.usesX = usesX;
    return evaluator;
  }

  function evaluateExpression(expression, x, parameters) {
    return compileExpression(expression, parameters)(x);
  }

  function escapeXml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function niceStep(range) {
    var rough = Math.abs(range) / 10;
    var power = Math.pow(10, Math.floor(Math.log(rough) / Math.LN10));
    var normalized = rough / power;
    var factor = normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10;
    return factor * power;
  }

  function formatNumber(value) {
    if (Math.abs(value) < 1e-10) {
      return "0";
    }
    if (Math.abs(value) >= 10000 || Math.abs(value) < 0.001) {
      return value.toExponential(1);
    }
    return String(Number(value.toFixed(4)));
  }

  function generatePlotSvg(expressions, bounds, options, curves, points) {
    return generateConfigSvg({ expressions: expressions, bounds: bounds, options: options, curves: curves, points: points });
  }

  function generateConfigSvg(input) {
    if (!configApi) { throw new Error("绘图配置组件未加载，请重新打开插件。"); }
    var config = configApi.normalizeConfig(input);
    var parameters = {};
    Object.keys(config.parameters || {}).forEach(function (name) { parameters[name] = config.parameters[name].value; });
    var usedParameters = [];
    function rememberParameters(evaluate) {
      evaluate.usedParameters.forEach(function (name) { if (usedParameters.indexOf(name) < 0) { usedParameters.push(name); } });
    }
    var formulas = config.expressions.map(normalizeExpression);
    var compiled = [];
    formulas.forEach(function (formula, index) {
      var curve = configApi.normalizeCurve(config.curves && config.curves[index], index);
      if (!curve.visible) { return; }
      try {
        var evaluate = compileExpression(formula, parameters);
        rememberParameters(evaluate);
        compiled.push({ label: formula, evaluate: evaluate, curve: curve, index: index });
      } catch (error) {
        error.message = "第 " + (index + 1) + " 条函数：" + error.message;
        error.curveIndex = index;
        throw error;
      }
    });
    if (!compiled.length) { throw new Error("请至少显示一条曲线。"); }
    var guides = (config.guides || []).map(function (guide, index) {
      try {
        var evaluate = compileExpression(guide.expression, parameters);
        if (evaluate.usesX) { throw new Error("等号右边不能含 x，请使用数值或 a、b、c 参数。"); }
        var value = evaluate(0);
        if (!isFinite(value) || Math.abs(value) > 1e9) { throw new Error("位置须为绝对值不超过十亿的有限数值。"); }
        rememberParameters(evaluate);
        return { axis: guide.axis, value: value, expression: guide.expression };
      } catch (error) {
        error.message = "第 " + (index + 1) + " 条辅助线：" + error.message;
        throw error;
      }
    });
    var limits = config.bounds;
    var analysis = { points: [], tangent: null, messages: [] };
    if (config.analysis) {
      if (!analysisApi) { throw new Error("交点与切线组件未加载，请重新打开编辑器。"); }
      analysis = analysisApi.analyze(config, compiled, function (expression) {
        var evaluate = compileExpression(expression, parameters);
        if (evaluate.usesX) { throw new Error("切点位置不能含变量 x，请使用数值或 a、b、c 参数。"); }
        rememberParameters(evaluate);
        return evaluate(0);
      });
    }
    var settings = input.options || {};
    var showTickLabels = settings.showTickLabels !== false;
    var showGrid = settings.showGrid !== false;
    var showBorder = settings.showBorder !== false;
    var showLegend = settings.showLegend !== false;
    var width = Number(settings.width) || 720;
    var height = Number(settings.height) || 460;
    if (!isFinite(width) || !isFinite(height) || width < 240 || width > 2400 || height < 200 || height > 2400) {
      throw new Error("图像尺寸须在宽 240—2400、高 200—2400 范围内。");
    }
    var margin = {
      left: showTickLabels ? 62 : 30,
      right: 24,
      top: 16,
      bottom: showTickLabels ? 48 : 24
    };
    var legendItemWidth = Math.max(130, Math.min(width - margin.left - margin.right, 260));
    var availableLegendWidth = width - margin.left - margin.right;
    var legendItemsPerRow = showLegend ?
      Math.max(1, Math.floor(availableLegendWidth / legendItemWidth)) :
      0;
    var legendRows = showLegend ? Math.ceil(compiled.length / legendItemsPerRow) : 0;
    if (showLegend) {
      margin.top = 18 + legendRows * 20;
      if (usedParameters.length) { margin.top += 20; }
      if (analysis.tangent) { margin.top += 20; }
    }
    height = Math.max(height, margin.top + margin.bottom + 120);
    var plotWidth = width - margin.left - margin.right;
    var plotHeight = height - margin.top - margin.bottom;
    var xScale = plotWidth / (limits.xMax - limits.xMin);
    var yScale = plotHeight / (limits.yMax - limits.yMin);
    var clipId = "plotArea";

    function px(x) {
      return margin.left + (x - limits.xMin) * xScale;
    }

    function py(y) {
      return margin.top + (limits.yMax - y) * yScale;
    }

    function curveStyle(formula) {
      var lineStyle = settings.monochrome ?
        configApi.LINE_STYLES[formula.index % configApi.LINE_STYLES.length] : formula.curve.lineStyle;
      return 'stroke="' + (settings.monochrome ? "#111111" : formula.curve.color) + '"' +
        (DASHES[lineStyle] ? ' stroke-dasharray="' + DASHES[lineStyle] + '"' : "");
    }

    function legendLabel(formula) {
      var domain = formula.curve.domain;
      var label = "y=" + formula.label;
      if (domain.min !== null || domain.max !== null) {
        label += "，x∈" + (domain.min !== null && domain.minClosed ? "[" : "(") +
          (domain.min === null ? "−∞" : domain.min) + ", " +
          (domain.max === null ? "+∞" : domain.max) + (domain.max !== null && domain.maxClosed ? "]" : ")");
      }
      return label;
    }

    var body = [];
    body.push('<rect x="0" y="0" width="' + width + '" height="' + height + '" fill="#fff"/>');
    body.push('<defs><clipPath id="' + clipId + '"><rect x="' + margin.left + '" y="' + margin.top + '" width="' + plotWidth + '" height="' + plotHeight + '"/></clipPath></defs>');
    body.push('<rect x="' + margin.left + '" y="' + margin.top + '" width="' + plotWidth + '" height="' + plotHeight + '" fill="#fff"' + (showBorder ? ' stroke="#94a3b8" stroke-width="1"' : "") + "/>");

    var xStep = niceStep(limits.xMax - limits.xMin);
    var yStep = niceStep(limits.yMax - limits.yMin);
    var firstX = Math.ceil(limits.xMin / xStep) * xStep;
    var firstY = Math.ceil(limits.yMin / yStep) * yStep;
    var value;

    for (var tick = 0; tick < 100; tick += 1) {
      value = firstX + tick * xStep;
      if (value > limits.xMax + xStep * 0.01) { break; }
      var xPosition = px(value);
      if (showGrid) {
        body.push('<line x1="' + xPosition + '" y1="' + margin.top + '" x2="' + xPosition + '" y2="' + (margin.top + plotHeight) + '" stroke="#e2e8f0" stroke-width="1"/>');
      }
      if (showTickLabels) {
        body.push('<text x="' + xPosition + '" y="' + (height - 24) + '" text-anchor="middle" font-size="12" fill="#475569">' + formatNumber(value) + '</text>');
      }
    }
    for (tick = 0; tick < 100; tick += 1) {
      value = firstY + tick * yStep;
      if (value > limits.yMax + yStep * 0.01) { break; }
      var yPosition = py(value);
      if (showGrid) {
        body.push('<line x1="' + margin.left + '" y1="' + yPosition + '" x2="' + (margin.left + plotWidth) + '" y2="' + yPosition + '" stroke="#e2e8f0" stroke-width="1"/>');
      }
      if (showTickLabels) {
        body.push('<text x="' + (margin.left - 10) + '" y="' + (yPosition + 4) + '" text-anchor="end" font-size="12" fill="#475569">' + formatNumber(value) + '</text>');
      }
    }

    if (limits.yMin <= 0 && limits.yMax >= 0) {
      body.push('<line x1="' + margin.left + '" y1="' + py(0) + '" x2="' + (margin.left + plotWidth) + '" y2="' + py(0) + '" stroke="#334155" stroke-width="1.4"/>');
    }
    if (limits.xMin <= 0 && limits.xMax >= 0) {
      body.push('<line x1="' + px(0) + '" y1="' + margin.top + '" x2="' + px(0) + '" y2="' + (margin.top + plotHeight) + '" stroke="#334155" stroke-width="1.4"/>');
    }

    body.push('<g clip-path="url(#' + clipId + ')">');
    if (analysis.tangent) {
      var tangent = analysis.tangent;
      var edges = [];
      function edge(x, y) {
        if (isFinite(x) && isFinite(y) && x >= limits.xMin && x <= limits.xMax && y >= limits.yMin && y <= limits.yMax) {
          if (!edges.some(function (point) { return point.x === x && point.y === y; })) { edges.push({ x: x, y: y }); }
        }
      }
      edge(limits.xMin, tangent.y + tangent.slope * (limits.xMin - tangent.x));
      edge(limits.xMax, tangent.y + tangent.slope * (limits.xMax - tangent.x));
      if (tangent.slope !== 0) {
        edge(tangent.x + (limits.yMin - tangent.y) / tangent.slope, limits.yMin);
        edge(tangent.x + (limits.yMax - tangent.y) / tangent.slope, limits.yMax);
      }
      if (edges.length >= 2) {
        body.push('<line data-tangent="true" x1="' + px(edges[0].x) + '" y1="' + py(edges[0].y) +
          '" x2="' + px(edges[1].x) + '" y2="' + py(edges[1].y) + '" stroke="#111111" stroke-width="1.8" stroke-dasharray="10 4 2 4"/>');
      }
    }
    guides.forEach(function (guide, index) {
      var vertical = guide.axis === "x";
      if (guide.value < (vertical ? limits.xMin : limits.yMin) || guide.value > (vertical ? limits.xMax : limits.yMax)) { return; }
      var x1 = vertical ? px(guide.value) : margin.left;
      var y1 = vertical ? margin.top : py(guide.value);
      var x2 = vertical ? x1 : margin.left + plotWidth;
      var y2 = vertical ? margin.top + plotHeight : y1;
      var label = guide.axis + "=" + guide.expression;
      if (guide.expression !== String(guide.value)) {
        var roundedValue = Number(guide.value.toPrecision(8));
        label += " (" + (roundedValue !== guide.value ? "≈" : "") + roundedValue + ")";
      }
      body.push('<line data-guide="' + index + '" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 +
        '" stroke="#475569" stroke-width="1.3" stroke-dasharray="6 4"/>');
      var labelX = vertical ? Math.min(x1 + 5, margin.left + plotWidth - 5) : margin.left + plotWidth - 5;
      var anchor = !vertical || x1 > margin.left + plotWidth / 2 ? "end" : "start";
      body.push('<text data-guide-label="' + index + '" x="' + labelX + '" y="' + (vertical ? margin.top + 15 : Math.max(margin.top + 15, y1 - 5)) +
        '" text-anchor="' + anchor + '" font-size="12" fill="#475569"><title>' + escapeXml(label) + '</title>' +
        escapeXml(label.length > 26 ? label.slice(0, 25) + "…" : label) + '</text>');
    });
    var endpoints = [];
    compiled.forEach(function (formula) {
      var segments = [];
      var current = [];
      var previous = null;
      var domain = formula.curve.domain;
      var startX = Math.max(limits.xMin, domain.min === null ? limits.xMin : domain.min);
      var endX = Math.min(limits.xMax, domain.max === null ? limits.xMax : domain.max);
      if (startX >= endX) { return; }
      var samples = Math.min(8000, Math.max(1000, Math.ceil(plotWidth * 2)));
      var evaluations = 0;
      function sample(x) {
        evaluations += 1;
        if (evaluations > 50000) {
          var complexityError = new Error("第 " + (formula.index + 1) + " 条函数：变化过于密集，请缩小坐标范围或简化表达式。");
          complexityError.curveIndex = formula.index;
          throw complexityError;
        }
        var y;
        try { y = formula.evaluate(x); } catch (_) { y = NaN; }
        var screenY = py(y);
        return { x: x, y: y, screenY: screenY, valid: isFinite(screenY) && Math.abs(y) < 1e12 &&
          screenY > margin.top - plotHeight * 4 && screenY < margin.top + plotHeight * 5 };
      }
      function flush() {
        if (current.length > 1) { segments.push(current.join(" ")); }
        current = [];
      }
      // Subdivide curved intervals; break unresolved jumps instead of drawing across poles.
      function appendInterval(left, right, depth) {
        var middle = sample(left.x + (right.x - left.x) / 2);
        var bend = Math.abs(middle.screenY - (left.screenY + right.screenY) / 2);
        var jump = Math.abs(right.screenY - left.screenY);
        var needsSplit = !left.valid || !right.valid || !middle.valid || bend > 0.7 || jump > plotHeight / 2;
        if (needsSplit && depth < 8 && (left.valid || right.valid || middle.valid)) {
          appendInterval(left, middle, depth + 1);
          appendInterval(middle, right, depth + 1);
          return;
        }
        if (!left.valid || !right.valid || !middle.valid || bend > 4 || jump > plotHeight / 2) {
          flush();
          return;
        }
        if (!current.length) { current.push("M" + px(left.x).toFixed(2) + " " + left.screenY.toFixed(2)); }
        current.push("L" + px(right.x).toFixed(2) + " " + right.screenY.toFixed(2));
      }
      for (var index = 0; index <= samples; index += 1) {
        var next = sample(startX + (endX - startX) * index / samples);
        if (previous) { appendInterval(previous, next, 0); }
        previous = next;
      }
      flush();
      segments.forEach(function (path) {
        body.push('<path data-curve="' + formula.index + '" d="' + path + '" fill="none" ' + curveStyle(formula) + ' stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>');
      });
      ["min", "max"].forEach(function (side) {
        var x = domain[side];
        if (x === null || x < limits.xMin || x > limits.xMax) { return; }
        var point = sample(x);
        if (!point.valid || point.y < limits.yMin || point.y > limits.yMax) { return; }
        endpoints.push({ x: x, y: point.y, closed: domain[side + "Closed"], color: settings.monochrome ? "#111111" : formula.curve.color });
      });
    });
    endpoints.sort(function (a, b) { return Number(a.closed) - Number(b.closed); }).forEach(function (point) {
      body.push('<circle data-endpoint="' + (point.closed ? "closed" : "open") + '" cx="' + px(point.x) + '" cy="' + py(point.y) +
        '" r="4" fill="' + (point.closed ? point.color : "#ffffff") + '" stroke="' + point.color + '" stroke-width="1.8"/>');
    });
    function pointLabel(name, point) {
      return name + "≈(" + Number(point.x.toPrecision(5)) + ", " + Number(point.y.toPrecision(5)) + ")";
    }
    var analysisPoints = analysis.points.map(function (point, index) {
      return { x: point.x, y: point.y, label: pointLabel("P" + (index + 1), point), kind: "intersection" };
    });
    if (analysis.tangent) {
      analysisPoints.push({ x: analysis.tangent.x, y: analysis.tangent.y, label: pointLabel("T", analysis.tangent), kind: "tangent" });
    }
    (config.points || []).concat(analysisPoints).forEach(function (point) {
      if (point.x < limits.xMin || point.x > limits.xMax || point.y < limits.yMin || point.y > limits.yMax) { return; }
      var anchor = point.x > (limits.xMin + limits.xMax) / 2 ? "end" : "start";
      var offset = anchor === "end" ? -8 : 8;
      body.push('<circle data-point="true"' + (point.kind ? ' data-analysis-point="' + point.kind + '"' : "") + ' cx="' + px(point.x) + '" cy="' + py(point.y) + '" r="3.5" fill="#111111"/>');
      body.push('<text x="' + (px(point.x) + offset) + '" y="' + Math.max(margin.top + 14, py(point.y) - 8) +
        '" text-anchor="' + anchor + '" font-size="13" fill="#111111">' + escapeXml(point.label || ("(" + point.x + ", " + point.y + ")")) + '</text>');
    });
    body.push("</g>");

    if (showLegend) {
      if (analysis.tangent) {
        var tangentLabel = "切线：y ≈ " + Number(analysis.tangent.y.toPrecision(8)) + " + " +
          Number(analysis.tangent.slope.toPrecision(8)) + "·(x − (" + Number(analysis.tangent.x.toPrecision(8)) + "))";
        var labelLimit = Math.floor(availableLegendWidth / 7);
        body.push('<text data-tangent-label="true" x="' + margin.left + '" y="' + (margin.top - 8) +
          '" font-size="12" fill="#111111"><title>' + escapeXml(tangentLabel) + '</title>' +
          escapeXml(tangentLabel.length > labelLimit ? tangentLabel.slice(0, labelLimit - 1) + "…" : tangentLabel) + '</text>');
      }
      if (usedParameters.length) {
        var parameterLabel = usedParameters.sort().map(function (name) { return name + "=" + parameters[name]; }).join("，");
        body.push('<text data-parameters="true" x="' + margin.left + '" y="' + (18 + legendRows * 20) +
          '" font-size="12" fill="#475569">' + escapeXml(parameterLabel) + '</text>');
      }
      compiled.forEach(function (formula, index) {
        var legendColumn = index % legendItemsPerRow;
        var legendRow = Math.floor(index / legendItemsPerRow);
        var legendX = margin.left + legendColumn * legendItemWidth;
        var legendY = 18 + legendRow * 20;
        var fullLabel = legendLabel(formula);
        var maxCharacters = Math.max(10, Math.floor((legendItemWidth - 38) / 7));
        var label = fullLabel.length > maxCharacters ? fullLabel.substring(0, maxCharacters - 1) + "…" : fullLabel;
        body.push('<line x1="' + legendX + '" y1="' + legendY + '" x2="' + (legendX + 20) + '" y2="' + legendY + '" ' + curveStyle(formula) + ' stroke-width="2.2"/>');
        body.push('<text x="' + (legendX + 26) + '" y="' + (legendY + 4) + '" font-size="13" fill="#1e293b"><title>' + escapeXml(fullLabel) + '</title>' + escapeXml(label) + '</text>');
      });
    }
    if (limits.yMin <= 0 && limits.yMax >= 0) {
      body.push('<text x="' + (margin.left + plotWidth + 8) + '" y="' + Math.max(margin.top + 14, py(0) - 6) + '" font-size="14" fill="#334155">x</text>');
    }
    if (limits.xMin <= 0 && limits.xMax >= 0) {
      body.push('<text x="' + Math.min(margin.left + plotWidth - 10, px(0) + 7) + '" y="' + (margin.top + 14) + '" font-size="14" fill="#334155">y</text>');
    }
    var svgBody = body.join("");
    if (settings.monochrome) {
      svgBody = svgBody.replace(/#e2e8f0/g, "#dddddd").replace(/#94a3b8/g, "#999999")
        .replace(/#475569|#334155|#1e293b/g, "#333333");
    }

    return {
      width: width,
      height: height,
      expressions: formulas,
      bounds: limits,
      analysis: analysis,
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="函数图像">' + svgBody + "</svg>"
    };
  }

  return {
    normalizeExpression: normalizeExpression,
    compileExpression: compileExpression,
    evaluateExpression: evaluateExpression,
    generatePlotSvg: generatePlotSvg,
    generateConfigSvg: generateConfigSvg
  };
});
