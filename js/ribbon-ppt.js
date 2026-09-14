if (typeof SYMBOLS === "undefined") {
  throw new Error("js/symbols.js must be loaded before js/ribbon-ppt.js.");
}

if (typeof WpsPptApi === "undefined") {
  throw new Error("js/ppt-api.js must be loaded before js/ribbon-ppt.js.");
}

if (typeof MathLicense === "undefined") {
  throw new Error("js/license.js must be loaded before js/ribbon-ppt.js.");
}

var COMMANDS = {
  function_plot: function () { return showFunctionPlotPane(); },
  authorization_center: function () { return MathLicense.openAuthorizationCenter(getAuthorizationPaneOptions()); }
};

function OnAddinLoad(ribbonUI) {
  if (typeof window.Application.ribbonUI !== "object") {
    window.Application.ribbonUI = ribbonUI;
  }
  try {
    MathLicense.remindIfExpired(getAuthorizationPaneOptions());
  } catch (_) {}
  return true;
}

function OnAction(control) {
  var symbol = SYMBOLS[control.Id];
  if (symbol !== undefined) {
    if (!MathLicense.requirePaidFeature("PPT 数学符号", getAuthorizationPaneOptions())) {
      return false;
    }
    return insertMathSymbol(symbol);
  }

  var command = COMMANDS[control.Id];
  if (command) {
    if (control.Id === "authorization_center") {
      return command();
    }
    if (!MathLicense.requirePaidFeature("绘制函数", getAuthorizationPaneOptions())) {
      return false;
    }
    return command();
  }

  return true;
}

function getApplication() {
  return window.Application;
}

function getPluginBaseUrl() {
  var url = decodeURI(document.location.toString());
  return url.substring(0, url.lastIndexOf("/"));
}

function getAuthorizationPaneOptions() {
  return {
    app: getApplication(),
    pluginBaseUrl: getPluginBaseUrl(),
    role: "presentation"
  };
}

function showFunctionPlotPane() {
  var app = getApplication();
  function nativeFallback() {
    if (typeof MathFunctionPlot !== "undefined") {
      return MathFunctionPlot.openQuickPresentation ?
        MathFunctionPlot.openQuickPresentation(app) : MathFunctionPlot.openPresentation(app);
    }
    alert("当前 WPS 演示版本无法打开函数编辑器。");
    return false;
  }
  if (!app || typeof MathTaskPanes === "undefined" ||
      typeof MathTaskPanes.openPackaged !== "function") {
    return nativeFallback();
  }
  return MathTaskPanes.openPackaged({
    app: app,
    pluginBaseUrl: getPluginBaseUrl(),
    role: "presentation",
    name: "tool-center",
    view: "function-plot",
    width: 420,
    readyTimeout: 5000,
    legacyKeys: ["high_school_math_ppt_function_plot_pane", "hsmath_license_pane_id_v1"],
    onFailure: nativeFallback
  }) || nativeFallback();
}

function getActivePresentation() {
  return WpsPptApi.getActivePresentation(getApplication());
}

function getActiveSlide() {
  return WpsPptApi.getActiveSlide(getApplication());
}

function selectedTextRange() {
  var app = getApplication();
  try {
    var selection = app.ActiveWindow.Selection;
    if (selection && selection.TextRange) {
      return selection.TextRange;
    }
  } catch (_) {}
  try {
    var shape = app.ActiveWindow.Selection.ShapeRange.Item(1);
    if (shape && shape.TextFrame && shape.TextFrame.TextRange) {
      return shape.TextFrame.TextRange;
    }
  } catch (_) {}
  return null;
}

var PPT_FONT_PROPERTIES = ["Name", "NameAscii", "NameOther", "NameFarEast", "NameBi", "Size"];

function fontValues(font) {
  if (!font) {
    return null;
  }
  var values = {};
  PPT_FONT_PROPERTIES.forEach(function (property) {
    try {
      values[property] = font[property];
    } catch (_) {}
  });
  return values;
}

function restoreFontValues(font, values) {
  if (!font || !values) {
    return;
  }
  PPT_FONT_PROPERTIES.forEach(function (property) {
    if (!(property in values)) {
      return;
    }
    try {
      font[property] = values[property];
    } catch (_) {}
  });
}

function setPptTextFont(textRange, options) {
  if (!textRange || !textRange.Font) {
    return;
  }
  var font = textRange.Font;
  ["Name", "NameAscii", "NameOther", "NameFarEast", "NameBi"].forEach(function (property) {
    try {
      font[property] = "Cambria Math";
    } catch (_) {}
  });
  if (options && options.defaultSize) {
    try {
      if (!Number(font.Size)) {
        font.Size = options.defaultSize;
      }
    } catch (_) {}
  }
}

function presentationSize(presentation) {
  try {
    return {
      width: Number(presentation.PageSetup.SlideWidth) || 720,
      height: Number(presentation.PageSetup.SlideHeight) || 540
    };
  } catch (_) {
    return { width: 720, height: 540 };
  }
}

function overlapsShape(left, top, width, height, shape) {
  try {
    var shapeLeft = Number(shape.Left);
    var shapeTop = Number(shape.Top);
    var shapeWidth = Number(shape.Width);
    var shapeHeight = Number(shape.Height);
    if (![shapeLeft, shapeTop, shapeWidth, shapeHeight].every(function (value) { return isFinite(value); })) {
      return false;
    }
    var margin = 12;
    return left < shapeLeft + shapeWidth + margin &&
      left + width + margin > shapeLeft &&
      top < shapeTop + shapeHeight + margin &&
      top + height + margin > shapeTop;
  } catch (_) {
    return false;
  }
}

function textboxPosition(slide, presentation, width, height) {
  if (WpsPptApi && WpsPptApi.findBestPlacement) {
    var sharedPlacement = WpsPptApi.findBestPlacement(slide, presentation, width, height, {
      margin: 24,
      padding: 12,
      scales: [1]
    });
    return { left: sharedPlacement.left, top: sharedPlacement.top };
  }
  var size = presentationSize(presentation);
  var centeredLeft = Math.max(24, Math.round((size.width - width) / 2));
  var candidates = [
    { left: centeredLeft, top: Math.max(24, Math.round(size.height - height - 48)) },
    { left: centeredLeft, top: Math.max(24, Math.round((size.height - height) / 2)) },
    { left: centeredLeft, top: 48 }
  ];
  var shapeCount = 0;
  try { shapeCount = Number(slide.Shapes.Count) || 0; } catch (_) { shapeCount = 0; }
  for (var candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    var candidate = candidates[candidateIndex];
    var overlaps = false;
    for (var shapeIndex = 1; shapeIndex <= shapeCount; shapeIndex += 1) {
      try {
        if (overlapsShape(candidate.left, candidate.top, width, height, slide.Shapes.Item(shapeIndex))) {
          overlaps = true;
          break;
        }
      } catch (_) {}
    }
    if (!overlaps) {
      return candidate;
    }
  }
  return candidates[0];
}

function insertMathSymbol(text) {
  var slide = getActiveSlide();
  if (!slide || !slide.Shapes) {
    alert("请先打开或新建一个 WPS 演示文稿。");
    return false;
  }

  try {
    var range = selectedTextRange();
    if (range && range.InsertAfter) {
      var originalFont = fontValues(range.Font);
      var insertedRange = range.InsertAfter(text);
      restoreFontValues(range.Font, originalFont);
      setPptTextFont(insertedRange);
      return true;
    }
    if (range) {
      var existingText = String(range.Text || "");
      var originalRangeFont = fontValues(range.Font);
      range.Text = existingText + text;
      restoreFontValues(range.Font, originalRangeFont);
      var insertedTextRange = null;
      try {
        if (range.Characters) {
          insertedTextRange = range.Characters(existingText.length + 1, text.length);
        }
      } catch (_) {
        insertedTextRange = null;
      }
      if (insertedTextRange) {
        setPptTextFont(insertedTextRange);
      } else if (typeof console !== "undefined" && console.warn) {
        console.warn("WPS Presentation did not expose the inserted character range; keeping the existing text font unchanged.");
      }
      return true;
    }

    var boxWidth = 260;
    var boxHeight = 42;
    var position = textboxPosition(slide, getActivePresentation(), boxWidth, boxHeight);
    var box = slide.Shapes.AddTextbox(1, position.left, position.top, boxWidth, boxHeight);
    box.TextFrame.TextRange.Text = text;
    setPptTextFont(box.TextFrame.TextRange, { defaultSize: 20 });
    try { box.Name = "高中数学符号"; } catch (_) {}
    try { box.AlternativeText = "数学符号：" + text; } catch (_) {}
    try { box.Select(); } catch (_) {}
    return true;
  } catch (error) {
    alert("插入数学符号失败：" + error.message);
    return false;
  }
}

function OnGetEnabled(control) {
  if (control && control.Id === "authorization_center") {
    return true;
  }
  return !!getActivePresentation();
}

function OnGetVisible(control) {
  return true;
}

function OnGetLabel(control) {
  return "";
}

function GetImage(control) {
  return "";
}

function OnAddinUnload() {
  return true;
}

function OnRibbonLoad() {
  return true;
}

function RefreshRibbon() {
  var app = getApplication();
  if (app && app.ribbonUI) {
    app.ribbonUI.Invalidate();
  }
}
