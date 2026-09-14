(function (root) {
  function node(id) { return document.getElementById(id); }
  function refresh(rows) {
    ["intersectionFirst", "intersectionSecond", "tangentCurve"].forEach(function (id) {
      var control = node(id);
      if (!control) { return; }
      var desired = control.value;
      var initialized = control.getAttribute("data-initialized");
      control.innerHTML = "";
      function option(value, label) {
        var entry = document.createElement("option");
        entry.value = value;
        entry.textContent = label;
        control.appendChild(entry);
      }
      option("", "请选择函数");
      if (id === "intersectionSecond") { option("axis", "x 轴（y=0）"); }
      rows.forEach(function (row, index) {
        var expression = row.querySelector(".expression-input").value.trim();
        option(row.getAttribute("data-curve-id"), "第 " + (index + 1) + " 条：" + (expression || "尚未输入"));
      });
      if (!initialized) {
        desired = id === "intersectionSecond" ? "axis" : rows.length ? rows[0].getAttribute("data-curve-id") : "";
      }
      control.value = desired;
      control.setAttribute("data-initialized", "true");
    });
  }
  function read(rows) {
    function index(id) {
      var value = node(id).value;
      var found = -1;
      rows.forEach(function (row, i) { if (row.getAttribute("data-curve-id") === value) { found = i; } });
      if (found < 0) { throw new Error("分析对象已删除或表达式为空，请在“交点与切线”中重新选择曲线。"); }
      return found;
    }
    var result = {};
    if (node("enableIntersections").checked) {
      ["intersectionMin", "intersectionMax"].forEach(function (id) {
        if (node(id).validity.badInput) { throw new Error("交点搜索端点请输入完整数值，或留空使用当前范围。"); }
      });
      result.intersection = {
        first: index("intersectionFirst"),
        second: node("intersectionSecond").value === "axis" ? "axis" : index("intersectionSecond"),
        min: node("intersectionMin").value,
        max: node("intersectionMax").value
      };
    }
    if (node("enableTangent").checked) { result.tangent = { curve: index("tangentCurve"), x: node("tangentX").value }; }
    return result;
  }
  function apply(config, rows) {
    var analysis = config.analysis || {};
    var search = analysis.intersection;
    var tangent = analysis.tangent;
    function id(index) { return rows[index] ? rows[index].getAttribute("data-curve-id") : ""; }
    node("enableIntersections").checked = Boolean(search);
    node("intersectionFirst").value = id(search ? search.first : 0);
    node("intersectionSecond").value = search && search.second !== "axis" ? id(search.second) : "axis";
    node("intersectionMin").value = search && search.min !== null ? search.min : "";
    node("intersectionMax").value = search && search.max !== null ? search.max : "";
    node("enableTangent").checked = Boolean(tangent);
    node("tangentCurve").value = id(tangent ? tangent.curve : 0);
    node("tangentX").value = tangent ? tangent.x : "1";
    node("analysisSettings").open = Boolean(search || tangent);
  }
  function showResults(analysis, config) {
    var container = node("analysisResults");
    container.textContent = "";
    if (!config || !config.analysis) { return; }
    function line(text) {
      var entry = document.createElement("p");
      entry.textContent = text;
      container.appendChild(entry);
    }
    function value(number) { return String(Number(number.toPrecision(8))); }
    function coordinate(point) { return "(" + value(point.x) + ", " + value(point.y) + ")"; }
    function outside(point) {
      var bounds = config.bounds;
      return point.x < bounds.xMin || point.x > bounds.xMax || point.y < bounds.yMin || point.y > bounds.yMax;
    }
    if (config.analysis.intersection) {
      if (!analysis.points.length) { line("本次数值搜索未找到可标注的交点。"); }
      analysis.points.forEach(function (point, index) {
        line("P" + (index + 1) + " ≈ " + coordinate(point) + (outside(point) ? "（当前画面之外）" : ""));
      });
    }
    if (analysis.tangent) {
      var tangent = analysis.tangent;
      line("切点 T ≈ " + coordinate(tangent) + (outside(tangent) ? "（当前画面之外）" : ""));
      line("切线斜率 ≈ " + value(tangent.slope));
      line("切线：y ≈ " + value(tangent.y) + " + " + value(tangent.slope) + " × (x − (" + value(tangent.x) + "))");
    }
    analysis.messages.forEach(line);
  }
  function initialize(render) {
    ["enableIntersections", "enableTangent", "intersectionFirst", "intersectionSecond", "intersectionMin", "intersectionMax", "tangentCurve", "tangentX"].forEach(function (id) {
      node(id).addEventListener("change", render);
    });
    node("analyzeButton").addEventListener("click", render);
  }
  root.MathPlotAnalysisPanel = { refresh: refresh, read: read, apply: apply, showResults: showResults, initialize: initialize };
})(window);
