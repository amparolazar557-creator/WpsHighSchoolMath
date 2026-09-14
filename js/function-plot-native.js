(function (root, factory) {
  var api = factory(root);
  root.MathFunctionPlot = api;
  if (typeof globalThis !== "undefined") {
    globalThis.MathFunctionPlot = api;
  }
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  function notify(message) {
    if (typeof alert === "function") {
      alert(message);
    }
  }

  function ask(message, defaultValue) {
    var result;
    try {
      if (typeof InputBox === "function") {
        result = InputBox(message, "高中数学工具", defaultValue);
        return result === false || result === undefined || result === null || result === "" ? null : String(result);
      }
    } catch (_) {}
    try {
      if (root.Application && typeof root.Application.InputBox === "function") {
        result = root.Application.InputBox(message, "高中数学工具", defaultValue);
        return result === false || result === undefined || result === null || result === "" ? null : String(result);
      }
    } catch (_) {}
    var error = new Error("当前 WPS 版本不支持自定义输入窗口。");
    error.code = "HSM_INPUT_UNAVAILABLE";
    throw error;
  }

  function parseExpressions(value) {
    return String(value || "")
      .split(/[;；\r\n]+/)
      .map(function (item) { return item.trim(); })
      .filter(function (item) { return item.length > 0; });
  }

  function parseRange(value, label) {
    var parts = String(value || "").replace(/，/g, ",").split(",");
    if (parts.length !== 2) {
      throw new Error(label + "范围请按“最小值,最大值”输入。");
    }
    var minimum = Number(parts[0]);
    var maximum = Number(parts[1]);
    if (!isFinite(minimum) || !isFinite(maximum) || minimum >= maximum) {
      throw new Error(label + "范围无效。");
    }
    return { minimum: minimum, maximum: maximum };
  }

  function collectPlotInput(existingConfig) {
    var defaults = existingConfig || {
      expressions: ["x^2"],
      bounds: { xMin: -10, xMax: 10, yMin: -10, yMax: 10 }
    };
    var expressionText = ask(
      "请输入函数表达式。多个函数用分号分隔。\n示例：x^2；sin(x)",
      (defaults.expressions || ["x^2"]).join("；")
    );
    if (expressionText === null) {
      return null;
    }
    var expressions = parseExpressions(expressionText);
    if (!expressions.length) {
      throw new Error("请至少输入一个函数表达式。");
    }

    var xText = ask(
      "请输入横坐标范围（最小值,最大值）：",
      String(defaults.bounds.xMin) + "," + String(defaults.bounds.xMax)
    );
    if (xText === null) {
      return null;
    }
    var yText = ask(
      "请输入纵坐标范围（最小值,最大值）：",
      String(defaults.bounds.yMin) + "," + String(defaults.bounds.yMax)
    );
    if (yText === null) {
      return null;
    }
    var xRange = parseRange(xText, "横坐标");
    var yRange = parseRange(yText, "纵坐标");

    return {
      expressions: expressions,
      bounds: {
        xMin: xRange.minimum,
        xMax: xRange.maximum,
        yMin: yRange.minimum,
        yMax: yRange.maximum
      },
      options: {
        showTickLabels: true,
        showGrid: true,
        showBorder: true,
        showLegend: true
      }
    };
  }

  function askConfirmation(app, message) {
    try {
      if (app && typeof app.confirm === "function") {
        return Boolean(app.confirm(message));
      }
    } catch (_) {}
    try {
      if (typeof confirm === "function") {
        return Boolean(confirm(message));
      }
    } catch (_) {}
    return null;
  }

  function collectQuickPlotInput(app) {
    var proceed = askConfirmation(
      app,
      "当前 WPS 版本不支持自定义输入框，将改用离线快捷绘图。\n\n" +
      "点击“确定”继续选择常用函数，点击“取消”退出。"
    );
    if (proceed === null) {
      throw new Error("当前 WPS 版本不支持函数选择窗口。");
    }
    if (!proceed) {
      return null;
    }

    var algebra = askConfirmation(
      app,
      "请选择函数类别：\n\n确定 = 代数函数\n取消 = 三角函数"
    );
    var firstChoice = askConfirmation(
      app,
      algebra ?
        "请选择代数函数：\n\n确定 = y=x^2\n取消 = y=1/x" :
        "请选择三角函数：\n\n确定 = y=sin(x)\n取消 = y=cos(x)"
    );
    var expression = algebra ?
      (firstChoice ? "x^2" : "1/x") :
      (firstChoice ? "sin(x)" : "cos(x)");
    var trigonometric = expression === "sin(x)" || expression === "cos(x)";

    return {
      expressions: [expression],
      bounds: trigonometric ?
        { xMin: -6.5, xMax: 6.5, yMin: -1.5, yMax: 1.5 } :
        { xMin: -10, xMax: 10, yMin: -10, yMax: 10 },
      options: {
        showTickLabels: true,
        showGrid: true,
        showBorder: true,
        showLegend: true
      }
    };
  }

  function tempFilePath(app) {
    if (!app || !app.FileSystem || !app.Env || !app.Env.GetTempPath) {
      throw new Error("当前 WPS 版本缺少生成函数图像所需的本地文件接口。");
    }
    var directory = String(app.Env.GetTempPath());
    var separator = directory.charAt(directory.length - 1) === "\\" ? "" : "\\";
    return directory + separator + "math-function-plot-" + Date.now() + "-" +
      Math.floor(Math.random() * 1000000) + ".svg";
  }

  function writePlotFile(app, path, plot) {
    var result = app.FileSystem.WriteFile(path, plot.svg);
    if (result === false) {
      throw new Error("无法写入临时函数图像文件。");
    }
  }

  function insertIntoWriter(app, path, plot) {
    var doc = app && app.ActiveDocument;
    var selection = app && app.Selection;
    if (!doc || !selection || !doc.InlineShapes) {
      throw new Error("请先打开一个 WPS 文字文档。");
    }
    var range = selection.Range;
    if (range && range.Start !== range.End) {
      if (typeof doc.Range !== "function") { throw new Error("请将光标放到空白位置后插入新图。"); }
      range = doc.Range(Number(range.Start), Number(range.Start));
    }
    var shape = doc.InlineShapes.AddPicture(path, false, true, range);
    try { shape.AlternativeText = "函数图像：" + plot.expressions.join("；"); } catch (_) {}
    try { shape.Title = plot.expressions.join("；"); } catch (_) {}
    try {
      shape.LockAspectRatio = -1;
      shape.Width = 420;
      if (!Number(shape.Height) || Number(shape.Height) < 10) {
        shape.Height = Math.round(420 * plot.height / plot.width);
      }
    } catch (_) {}
    try {
      selection.SetRange(shape.Range.End, shape.Range.End);
    } catch (_) {}
    return "函数图像已插入到 WPS 文字。";
  }

  function activePresentation(app) {
    try {
      if (root.WpsPptApi) {
        return root.WpsPptApi.getActivePresentation(app);
      }
    } catch (_) {}
    try { return app.ActivePresentation; } catch (_) { return null; }
  }

  function activeSlide(app, presentation) {
    try {
      if (root.WpsPptApi) {
        return root.WpsPptApi.getActiveSlide(app);
      }
    } catch (_) {}
    try { return app.ActiveWindow.View.Slide; } catch (_) {}
    try { return app.ActiveWindow.Selection.SlideRange.Item(1); } catch (_) {}
    try { return presentation.Slides.Item(1); } catch (_) { return null; }
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

  function insertIntoPresentation(app, path, plot) {
    var presentation = activePresentation(app);
    var slide = activeSlide(app, presentation);
    if (!presentation || !slide || !slide.Shapes) {
      throw new Error("请先打开一个 WPS 演示文稿并选中幻灯片。");
    }
    var size = presentationSize(presentation);
    var width = Math.min(460, size.width - 80);
    var height = Math.round(width * plot.height / plot.width);
    if (height > size.height - 80) {
      height = size.height - 80;
      width = Math.round(height * plot.width / plot.height);
    }
    var left = Math.max(20, (size.width - width) / 2);
    var top = Math.max(20, (size.height - height) / 2);
    var shape = slide.Shapes.AddPicture(path, false, true, left, top, width, height);
    try { shape.AlternativeText = "函数图像：" + plot.expressions.join("；"); } catch (_) {}
    try { shape.Name = "高中数学函数图像"; } catch (_) {}
    try { shape.Select(); } catch (_) {}
    return "函数图像已插入到当前幻灯片。";
  }

  function open(app, target, forceQuick) {
    var path = "";
    try {
      if (!root.FunctionPlotter) {
        throw new Error("函数图像组件未加载，请关闭 WPS 后重新打开。");
      }
       var input;
       var existingConfig = null;
       try {
         if (root.MathFunctionDocument) {
           existingConfig = root.MathFunctionDocument.getSelectedPlotConfig(app);
         }
       } catch (_) {}
       if (existingConfig && (existingConfig.curves || existingConfig.points || existingConfig.options.monochrome || existingConfig.parameters || existingConfig.guides || existingConfig.analysis)) {
         throw new Error("所选图像含新版绘图设置，请使用完整函数编辑器修改。旧图已保留。");
       }
       if (forceQuick) {
         input = collectQuickPlotInput(app);
       } else {
         try {
           input = collectPlotInput(existingConfig);
         } catch (inputError) {
           if (!inputError || inputError.code !== "HSM_INPUT_UNAVAILABLE") {
             throw inputError;
           }
           input = collectQuickPlotInput(app);
         }
       }
      if (!input) {
        return false;
      }
      var plot = root.FunctionPlotter.generatePlotSvg(input.expressions, input.bounds, input.options);
      path = tempFilePath(app);
      writePlotFile(app, path, plot);
       var message;
       if (root.MathFunctionDocument) {
         message = root.MathFunctionDocument.insertOrUpdate(app, path, plot, input).message;
       } else {
         message = target === "presentation" ?
           insertIntoPresentation(app, path, plot) :
           insertIntoWriter(app, path, plot);
       }
      notify(message);
      return true;
    } catch (error) {
      notify("无法插入函数图像：" + (error && error.message ? error.message : String(error)));
      return false;
    } finally {
      if (path && app && app.FileSystem && app.FileSystem.Remove) {
        try { app.FileSystem.Remove(path); } catch (_) {}
      }
    }
  }

  return {
    openWriter: function (app) { return open(app, "writer"); },
    openPresentation: function (app) { return open(app, "presentation"); },
    openQuickWriter: function (app) { return open(app, "writer", true); },
    openQuickPresentation: function (app) { return open(app, "presentation", true); },
    _private: {
      parseExpressions: parseExpressions,
      parseRange: parseRange,
      collectQuickPlotInput: collectQuickPlotInput
    }
  };
});
