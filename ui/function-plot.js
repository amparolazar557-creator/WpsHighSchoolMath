var currentPlot = null;
var currentConfig = null;
var editingSelectedPlot = false;
var renderedEditingMode = null;
var selectionMonitorId = null;
var previewTimer = null;
var plotLibrary = null;
var nextCurveId = 0;

var PRESETS = {
  quadratic: { expression: "x^2" },
  absolute: { expression: "abs(x)" },
  reciprocal: { expression: "1/x" },
  sine: { expression: "sin(x)" },
  cosine: { expression: "cos(x)" },
  exponential: { expression: "2^x" },
  logarithm: { expression: "log(x)" },
  parameters: { expression: "ax^2+bx+c" }
};

function node(id) {
  return document.getElementById(id);
}

function elements(selector) {
  var list = document.querySelectorAll(selector);
  var result = [];
  for (var index = 0; index < list.length; index += 1) {
    result.push(list[index]);
  }
  return result;
}

function setStatus(message, isError) {
  node("status").textContent = message;
  node("status").className = isError ? "status error" : "status";
}

function setEditingMode(isEditing) {
  editingSelectedPlot = Boolean(isEditing);
  if (renderedEditingMode === editingSelectedPlot) {
    return;
  }
  renderedEditingMode = editingSelectedPlot;
  node("editModeBadge").textContent = editingSelectedPlot ? "编辑所选图像" : "新建图像";
  node("editModeBadge").className = editingSelectedPlot ? "mode-badge editing" : "mode-badge";
  node("insertButton").textContent = editingSelectedPlot ? "更新所选图像" : "插入新图像";
}

function expressionInputs() {
  return elements(".expression-input");
}

function refreshRemoveButtons() {
  var rows = elements(".expression-row");
  rows.forEach(function (row, index) {
    var input = row.querySelector(".expression-input");
    var remove = row.querySelector(".remove-expression");
    input.setAttribute("aria-label", "函数表达式 " + (index + 1));
    remove.setAttribute("aria-label", "删除函数表达式 " + (index + 1));
    remove.disabled = rows.length === 1;
    [".curve-min", ".curve-max", ".curve-color", ".curve-style", ".curve-min-closed", ".curve-max-closed", ".curve-visible"].forEach(function (selector) {
      var control = row.querySelector(selector);
      if (control) {
        control.setAttribute("aria-label", "第 " + (index + 1) + " 条函数 " + control.getAttribute("data-label"));
      }
    });
  });
  if (node("addExpressionButton")) {
    node("addExpressionButton").disabled = rows.length >= 12;
  }
  if (window.MathPlotAnalysisPanel) { window.MathPlotAnalysisPanel.refresh(rows); }
}

function addExpressionRow(value, focusInput, curveConfig) {
  if (elements(".expression-row").length >= 12) {
    setStatus("最多支持 12 条曲线，请先删除多余行。", true);
    return null;
  }
  var curve = window.MathPlotConfig.normalizeCurve(curveConfig, elements(".expression-row").length);
  var row = document.createElement("div");
  row.className = "expression-row";
  row.setAttribute("data-curve-id", "curve-" + (++nextCurveId));
  var main = document.createElement("div");
  main.className = "expression-main";

  var prefix = document.createElement("span");
  prefix.className = "expression-prefix";
  prefix.textContent = "y =";

  var input = document.createElement("input");
  input.type = "text";
  input.className = "expression-input";
  input.value = value || "";
  input.placeholder = "例如：x^2 或 sin(x)";
  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter" || event.keyCode === 13) {
      event.preventDefault();
      addExpressionRow("", true);
    }
  });
  input.addEventListener("input", function () {
    if (window.MathPlotAnalysisPanel) { window.MathPlotAnalysisPanel.refresh(elements(".expression-row")); }
    schedulePreview();
  });

  var remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove-expression";
  remove.title = "删除这一行";
  remove.textContent = "×";
  remove.addEventListener("click", function () {
    if (row.parentNode) {
      row.parentNode.removeChild(row);
    }
    refreshRemoveButtons();
    renderPreview();
  });

  main.appendChild(prefix);
  main.appendChild(input);
  main.appendChild(remove);
  row.appendChild(main);
  var details = document.createElement("details");
  details.className = "curve-settings";
  details.open = curve.domain.min !== null || curve.domain.max !== null || curve.lineStyle !== "solid";
  details.innerHTML = '<summary>定义域与样式</summary><div class="curve-grid">' +
    '<label>左端 x<input class="curve-min" data-label="定义域左端" type="number" step="any" placeholder="不限制"></label>' +
    '<label>右端 x<input class="curve-max" data-label="定义域右端" type="number" step="any" placeholder="不限制"></label>' +
    '<label>左端点<select class="curve-min-closed" data-label="左端点"><option value="closed">实心（包含）</option><option value="open">空心（不包含）</option></select></label>' +
    '<label>右端点<select class="curve-max-closed" data-label="右端点"><option value="closed">实心（包含）</option><option value="open">空心（不包含）</option></select></label>' +
    '<label>颜色<input class="curve-color" data-label="颜色" type="color"></label>' +
    '<label>线型<select class="curve-style" data-label="线型"><option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option><option value="dashdot">点划线</option></select></label>' +
    '<label class="curve-visible-label"><input class="curve-visible" data-label="显示曲线" type="checkbox">显示这条曲线</label>' +
    '</div><p class="field-help">两端留空表示不限制；区间只影响本行函数。</p>';
  details.querySelector(".curve-min").value = curve.domain.min === null ? "" : curve.domain.min;
  details.querySelector(".curve-max").value = curve.domain.max === null ? "" : curve.domain.max;
  details.querySelector(".curve-min-closed").value = curve.domain.minClosed ? "closed" : "open";
  details.querySelector(".curve-max-closed").value = curve.domain.maxClosed ? "closed" : "open";
  details.querySelector(".curve-color").value = curve.color;
  details.querySelector(".curve-style").value = curve.lineStyle;
  details.querySelector(".curve-visible").checked = curve.visible;
  details.addEventListener("change", renderPreview);
  row.appendChild(details);
  node("expressionRows").appendChild(row);
  refreshRemoveButtons();
  if (focusInput) {
    input.focus();
  }
  return input;
}

function resetExpressionRows(values, curves) {
  var expressions = Array.isArray(values) ? values : [values || ""];
  node("expressionRows").innerHTML = "";
  expressions.forEach(function (value, index) { addExpressionRow(value, false, curves && curves[index]); });
  if (!expressions.length) {
    addExpressionRow("", false);
  }
}

function activeExpressionRows() {
  return elements(".expression-row").filter(function (row) {
    return row.querySelector(".expression-input").value.trim();
  });
}

function readPoints() {
  var text = node("pointAnnotations").value.trim();
  if (!text) { return []; }
  return text.replace(/，/g, ",").split(/[\r\n;；]+/).filter(function (line) { return line.trim(); }).map(function (line, index) {
    var values = line.split(",");
    if (values.length !== 3) { throw new Error("第 " + (index + 1) + " 个坐标点请按“名称,横坐标,纵坐标”输入。"); }
    return { label: values[0].trim(), x: values[1].trim(), y: values[2].trim() };
  });
}

function readDomainValue(row, selector) {
  var control = row.querySelector(selector);
  if (control.validity && control.validity.badInput) { throw new Error("定义域请输入完整数值，或留空表示不限制。"); }
  return control.value;
}

function readParameters() {
  var result = {};
  ["a", "b", "c"].forEach(function (name) {
    var parameter = {};
    ["value", "min", "max", "step"].forEach(function (key) {
      parameter[key] = node("parameter-" + name + "-" + key).value;
    });
    result[name] = parameter;
  });
  return result;
}

function renderParameterControls(parameters) {
  var container = node("parameterRows");
  container.innerHTML = "";
  var limitsDetails = document.createElement("details");
  limitsDetails.className = "curve-settings parameter-settings";
  limitsDetails.innerHTML = '<summary>调整范围与步长</summary>';
  container.appendChild(limitsDetails);
  ["a", "b", "c"].forEach(function (name) {
    var parameter = parameters[name];
    var row = document.createElement("div");
    row.className = "parameter-row";
    row.innerHTML = '<div class="parameter-main"><label for="parameter-' + name + '-value">' + name + '</label>' +
      '<input id="parameter-' + name + '-slider" type="range" aria-label="拖动参数 ' + name + '">' +
      '<input id="parameter-' + name + '-value" type="number" step="any" aria-label="参数 ' + name + ' 当前值"></div>';
    container.insertBefore(row, limitsDetails);
    var limitsRow = document.createElement("div");
    limitsRow.innerHTML = '<p class="field-help">参数 ' + name + '</p><div class="parameter-limits">' +
      '<label>最小<input id="parameter-' + name + '-min" type="number" step="any"></label>' +
      '<label>最大<input id="parameter-' + name + '-max" type="number" step="any"></label>' +
      '<label>步长<input id="parameter-' + name + '-step" type="number" step="any"></label></div>';
    limitsDetails.appendChild(limitsRow);
    var slider = node("parameter-" + name + "-slider");
    var valueInput = node("parameter-" + name + "-value");
    ["value", "min", "max", "step"].forEach(function (key) {
      var control = node("parameter-" + name + "-" + key);
      control.value = parameter[key];
      if (key !== "value") { control.setAttribute("aria-label", "参数 " + name + " " + { min: "最小值", max: "最大值", step: "步长" }[key]); }
      control.addEventListener("change", function () {
        try {
          var candidate = {};
          candidate[name] = readParameters()[name];
          var validated = window.MathPlotConfig.normalizeParameters(candidate);
          parameter = validated[name];
          syncSlider();
        } catch (_) {
          // Keep invalid input visible; shared validation reports the precise error.
          slider.disabled = true;
        }
        renderPreview();
      });
    });
    function syncSlider() {
      // Integer tick positions keep manual off-step values exact until the user drags.
      slider.min = 0;
      slider.max = Math.ceil((parameter.max - parameter.min) / parameter.step);
      slider.step = 1;
      slider.value = Math.round((parameter.value - parameter.min) / parameter.step);
      slider.disabled = false;
      slider.setAttribute("aria-valuetext", String(parameter.value));
    }
    syncSlider();
    slider.addEventListener("input", function () {
      var value = Math.min(parameter.max, parameter.min + Number(slider.value) * parameter.step);
      parameter.value = Math.max(parameter.min, Math.min(parameter.max, Number(value.toPrecision(15))));
      valueInput.value = parameter.value;
      slider.setAttribute("aria-valuetext", String(parameter.value));
      // Throttle while dragging so previews update even during a long gesture.
      if (previewTimer === null) {
        previewTimer = window.setTimeout(function () { previewTimer = null; renderPreview(); }, 60);
      }
    });
    slider.addEventListener("change", renderPreview);
  });
}

function readGuides() {
  return node("guideLines").value.split(/[\r\n;；]+/).filter(function (line) { return line.trim(); }).map(function (line, index) {
    var match = line.trim().match(/^([xy])\s*[=＝]\s*(.+)$/i);
    if (!match) { throw new Error("第 " + (index + 1) + " 条辅助线请按 x=位置 或 y=位置 输入。"); }
    return { axis: match[1].toLowerCase(), expression: match[2].trim() };
  });
}

function setLibraryStatus(message, isError) {
  node("libraryStatus").textContent = message;
  node("libraryStatus").className = isError ? "status error" : "field-help";
}

function refreshFavorites(selectedId) {
  var list = node("favoriteList");
  var desired = selectedId || list.value;
  var items = plotLibrary.list();
  list.innerHTML = "";
  if (!items.length) {
    var placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "暂无收藏";
    list.appendChild(placeholder);
  }
  items.forEach(function (item) {
    var option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name;
    list.appendChild(option);
  });
  if (items.some(function (item) { return item.id === desired; })) { list.value = desired; }
  node("loadFavoriteButton").disabled = !items.length;
  node("deleteFavoriteButton").disabled = !items.length;
  return items;
}

function initializeLibrary() {
  plotLibrary = window.MathPlotLibrary.forWindow(window);
  function action(id, callback) {
    node(id).addEventListener("click", function () {
      try { callback(); } catch (error) { setLibraryStatus(error.message || String(error), true); }
    });
  }
  action("saveFavoriteButton", function () {
    if (!renderPreview()) { setLibraryStatus("当前图像有输入错误，请修正后再收藏。", true); return; }
    var item = plotLibrary.save(node("favoriteName").value, currentConfig);
    refreshFavorites(item.id);
    setLibraryStatus("已收藏“" + item.name + "”。", false);
  });
  action("loadFavoriteButton", function () {
    var id = node("favoriteList").value;
    var item = plotLibrary.list().filter(function (entry) { return entry.id === id; })[0];
    if (!item) { throw new Error("请先选择一个收藏方案，或刷新列表。"); }
    if (!applyConfig(item.config, synchronizeSelectionMode())) { throw new Error("方案已载入，请检查绘图输入错误提示。"); }
    node("favoriteName").value = item.name;
    node("parameterSettings").open = true;
    setLibraryStatus("已载入“" + item.name + "”；文档中的图像需点击插入或更新后才会改变。", false);
  });
  action("deleteFavoriteButton", function () {
    plotLibrary.remove(node("favoriteList").value);
    refreshFavorites();
    setLibraryStatus("已删除收藏，可在“迁移备份与撤销”中恢复上次列表。", false);
  });
  action("refreshFavoritesButton", function () {
    var items = refreshFavorites();
    setLibraryStatus("已刷新，共 " + items.length + " 个方案。", false);
  });
  action("exportFavoritesButton", function () {
    node("favoriteBackup").value = plotLibrary.exportText();
    node("favoriteBackup").focus();
    node("favoriteBackup").select();
    setLibraryStatus("备份文字已生成并选中，请复制到文本文件保存。", false);
  });
  action("importFavoritesButton", function () {
    var added = plotLibrary.importText(node("favoriteBackup").value);
    refreshFavorites();
    setLibraryStatus("导入完成，新增 " + added + " 个方案；原收藏已保留。", false);
  });
  action("undoFavoritesButton", function () {
    plotLibrary.recoverPrevious();
    refreshFavorites();
    setLibraryStatus("已恢复上次收藏列表。", false);
  });
  try {
    refreshFavorites();
    setLibraryStatus("本机收藏，最多 50 个方案。", false);
  } catch (error) { setLibraryStatus(error.message, true); }
}

function readPlotInput() {
  var rows = activeExpressionRows();
  var input = {
    expressions: rows.map(function (row) { return row.querySelector(".expression-input").value; }),
    curves: rows.map(function (row, index) {
      var minimum;
      var maximum;
      try {
        minimum = readDomainValue(row, ".curve-min");
        maximum = readDomainValue(row, ".curve-max");
      } catch (error) {
        error.message = "第 " + (index + 1) + " 条函数：" + error.message;
        error.curveIndex = index;
        throw error;
      }
      return {
        color: row.querySelector(".curve-color").value,
        lineStyle: row.querySelector(".curve-style").value,
        visible: row.querySelector(".curve-visible").checked,
        domain: {
          min: minimum, max: maximum,
          minClosed: row.querySelector(".curve-min-closed").value === "closed",
          maxClosed: row.querySelector(".curve-max-closed").value === "closed"
        }
      };
    }),
    points: readPoints(),
    parameters: readParameters(),
    guides: readGuides(),
    analysis: window.MathPlotAnalysisPanel ? window.MathPlotAnalysisPanel.read(rows) : undefined,
    bounds: {
      xMin: node("xMin").value,
      xMax: node("xMax").value,
      yMin: node("yMin").value,
      yMax: node("yMax").value
    },
    options: {
      showTickLabels: node("showTickLabels").checked,
      showGrid: node("showGrid").checked,
      showBorder: node("showBorder").checked,
      showLegend: node("showLegend").checked,
      monochrome: node("monochrome").checked
    }
  };
  if (window.MathFunctionDocument) {
    return window.MathFunctionDocument.normalizeConfig(input);
  }
  return input;
}

function applyConfig(config, editing) {
  var normalized = window.MathFunctionDocument ?
    window.MathFunctionDocument.normalizeConfig(config) : config;
  resetExpressionRows(normalized.expressions, normalized.curves);
  node("xMin").value = normalized.bounds.xMin;
  node("xMax").value = normalized.bounds.xMax;
  node("yMin").value = normalized.bounds.yMin;
  node("yMax").value = normalized.bounds.yMax;
  node("showTickLabels").checked = normalized.options.showTickLabels !== false;
  node("showGrid").checked = normalized.options.showGrid !== false;
  node("showBorder").checked = normalized.options.showBorder !== false;
  node("showLegend").checked = normalized.options.showLegend !== false;
  node("monochrome").checked = normalized.options.monochrome === true;
  node("pointAnnotations").value = (normalized.points || []).map(function (point) {
    return [point.label, point.x, point.y].join(",");
  }).join("\n");
  renderParameterControls(normalized.parameters || window.MathPlotConfig.normalizeParameters({}));
  node("guideLines").value = (normalized.guides || []).map(function (guide) {
    return guide.axis + "=" + guide.expression;
  }).join("\n");
  if (window.MathPlotAnalysisPanel) { window.MathPlotAnalysisPanel.apply(normalized, activeExpressionRows()); }
  setEditingMode(editing);
  return renderPreview();
}

function renderPreview() {
  if (previewTimer !== null && window.clearTimeout) { window.clearTimeout(previewTimer); previewTimer = null; }
  elements(".expression-row").forEach(function (row) {
    row.className = "expression-row";
    row.querySelector(".expression-input").removeAttribute("aria-invalid");
  });
  try {
    currentConfig = readPlotInput();
    currentPlot = FunctionPlotter.generateConfigSvg(currentConfig);
    node("preview").innerHTML = currentPlot.svg;
    if (window.MathPlotAnalysisPanel) { window.MathPlotAnalysisPanel.showResults(currentPlot.analysis, currentConfig); }
    setStatus("预览已更新，可" + (editingSelectedPlot ? "更新所选图像。" : "插入到 WPS。"), false);
    return true;
  } catch (error) {
    currentPlot = null;
    currentConfig = null;
    node("preview").innerHTML = "";
    if (window.MathPlotAnalysisPanel) { window.MathPlotAnalysisPanel.showResults(null, null); }
    var message = error.message || String(error);
    if (typeof error.curveIndex === "number") {
      var row = activeExpressionRows()[error.curveIndex];
      if (row) {
        var displayedIndex = elements(".expression-row").indexOf(row);
        message = message.replace(/^第 \d+ 条函数：/, "第 " + (displayedIndex + 1) + " 条函数：");
        row.className = "expression-row invalid";
        row.querySelector(".expression-input").setAttribute("aria-invalid", "true");
      }
    }
    setStatus(message, true);
    return false;
  }
}

function schedulePreview() {
  if (previewTimer !== null) { window.clearTimeout(previewTimer); }
  previewTimer = window.setTimeout(function () { previewTimer = null; renderPreview(); }, 300);
}

function getApplication() {
  return window.Application || window.wps || null;
}

function synchronizeSelectionMode() {
  var selected = null;
  try {
    var app = getApplication();
    if (app && window.MathFunctionDocument) {
      selected = window.MathFunctionDocument.getSelectedPlot(app);
    }
  } catch (_) {
    selected = null;
  }
  setEditingMode(Boolean(selected));
  return Boolean(selected);
}

function startSelectionMonitor() {
  synchronizeSelectionMode();
  if (selectionMonitorId !== null || typeof window.setInterval !== "function") {
    return selectionMonitorId;
  }
  selectionMonitorId = window.setInterval(synchronizeSelectionMode, 250);
  return selectionMonitorId;
}

function stopSelectionMonitor() {
  if (selectionMonitorId !== null && window.clearInterval) {
    window.clearInterval(selectionMonitorId);
    selectionMonitorId = null;
  }
  if (previewTimer !== null && window.clearTimeout) { window.clearTimeout(previewTimer); previewTimer = null; }
}

function tempFilePath(app) {
  if (!app.FileSystem || !app.Env) {
    throw new Error("当前 WPS 版本缺少插入函数图像所需的文件接口。");
  }
  var tempDirectory = String(app.Env.GetTempPath());
  var separator = tempDirectory.charAt(tempDirectory.length - 1) === "\\" ? "" : "\\";
  var unique = Date.now() + "-" + Math.floor(Math.random() * 1000000);
  return tempDirectory + separator + "math-function-plot-" + unique + ".svg";
}

function writePlotFile(app, path) {
  if (!app.FileSystem.WriteFile(path, currentPlot.svg)) {
    throw new Error("无法写入临时图像文件");
  }
}

function loadSelectedPlot(showMissingMessage) {
  var app = getApplication();
  if (!app || !window.MathFunctionDocument) {
    if (showMissingMessage) {
      setStatus("当前 WPS 版本无法读取所选函数图像。", true);
    }
    return false;
  }
  try {
    var selected = window.MathFunctionDocument.getSelectedPlot(app);
    if (!selected) {
      setEditingMode(false);
      if (showMissingMessage) {
        setStatus("请先在文档或幻灯片中选中由本插件生成的函数图像。", true);
      }
      return false;
    }
    if (!applyConfig(selected.config, true)) { return false; }
    setStatus("已载入所选函数图像，可修改后点击“更新所选图像”。", false);
    return true;
  } catch (error) {
    setStatus("无法读取所选函数图像：" + error.message, true);
    return false;
  }
}

function insertCurrentPlot() {
  if (window.MathLicense && !window.MathLicense.requirePaidFeature("插入函数图像")) {
    setStatus("试用已到期，请激活后继续插入函数图像。", true);
    return;
  }
  if (!window.MathFunctionDocument) {
    setStatus("函数图像文档组件未加载，请关闭 WPS 后重试。", true);
    return;
  }
  if (!renderPreview()) {
    return;
  }

  var app = getApplication();
  if (!app) {
    setStatus("当前未连接到 WPS。", true);
    return;
  }
  var path = "";
  try {
    path = tempFilePath(app);
    writePlotFile(app, path);
    var result = window.MathFunctionDocument.insertOrUpdate(app, path, currentPlot, currentConfig);
    var placementMessage = "";
    if (!result.updated && result.host === "presentation" && result.placement) {
      placementMessage = result.placement.overlapArea > 0 ?
        " 当前页没有完整空白区域，已采用最低重叠位置。" :
        " 已自动避开当前页已有内容。";
    }
    setEditingMode(result.updated || result.host === "presentation");
    setStatus(result.message + placementMessage, false);
  } catch (error) {
    setStatus("无法插入函数图像：" + error.message, true);
  } finally {
    if (path) {
      try { app.FileSystem.Remove(path); } catch (_) {}
    }
  }
}

function applyPreset(name) {
  if (name === "piecewise") {
    if (elements(".expression-row").length > 10) {
      setStatus("分段示例需要两行，请先删除多余函数。", true);
      return;
    }
    addExpressionRow("x^2", false, { domain: { max: 0, maxClosed: false } });
    addExpressionRow("x+1", false, { color: "#2563eb", domain: { min: 0, minClosed: true } });
    if (renderPreview()) {
      setStatus("已追加两段：x<0 时 y=x²；x≥0 时 y=x+1。可删除其他曲线后单独查看。", false);
    }
    return;
  }
  var preset = PRESETS[name];
  if (!preset) {
    return;
  }
  if (name === "parameters") { node("parameterSettings").open = true; }
  var emptyInput = expressionInputs().filter(function (input) {
    return !input.value.trim();
  })[0];
  if (emptyInput) {
    emptyInput.value = preset.expression;
  } else {
    if (!addExpressionRow(preset.expression, false)) { return; }
  }
  renderPreview();
}

window.addEventListener("DOMContentLoaded", function () {
  var defaultConfig = window.MathFunctionDocument ?
    window.MathFunctionDocument.getDefaultConfig() : {
      expressions: ["x^2"],
      bounds: { xMin: -10, xMax: 10, yMin: -10, yMax: 10 },
      options: { showTickLabels: true, showGrid: true, showBorder: true, showLegend: true }
    };
  applyConfig(defaultConfig, false);
  node("addExpressionButton").addEventListener("click", function () {
    addExpressionRow("", true);
  });
  node("loadSelectionButton").addEventListener("click", function () {
    loadSelectedPlot(true);
  });
  node("previewButton").addEventListener("click", renderPreview);
  node("insertButton").addEventListener("click", insertCurrentPlot);
  ["showTickLabels", "showGrid", "showBorder", "showLegend", "monochrome", "xMin", "xMax", "yMin", "yMax", "pointAnnotations", "guideLines"].forEach(function (id) {
    node(id).addEventListener("change", renderPreview);
  });
  initializeLibrary();
  if (window.MathPlotAnalysisPanel) { window.MathPlotAnalysisPanel.initialize(renderPreview); }
  elements("[data-preset]").forEach(function (button) {
    button.addEventListener("click", function () {
      applyPreset(button.getAttribute("data-preset"));
    });
  });

  if (!loadSelectedPlot(false)) {
    setStatus("可输入多条函数并设置坐标范围；选中旧图后可点“载入所选图像”重新编辑。", false);
  }
  startSelectionMonitor();
  if (window.MathTaskPanes && !window.HSM_TASK_PANE_NAME) {
    window.MathTaskPanes.signalReady("function-plot");
  }
});

window.addEventListener("unload", stopSelectionMonitor);
window.MathFunctionPlotPanel = window.MathFunctionPlotPanel || {};
window.MathFunctionPlotPanel.synchronizeSelection = synchronizeSelectionMode;
window.MathFunctionPlotPanel.startSelectionMonitor = startSelectionMonitor;
window.MathFunctionPlotPanel.setVisible = function (visible) {
  if (visible) {
    startSelectionMonitor();
    if (node("preview")) { renderPreview(); }
  } else { stopSelectionMonitor(); }
};
window.MathFunctionPlotPanel.isEditingSelectedPlot = function () {
  return editingSelectedPlot;
};
