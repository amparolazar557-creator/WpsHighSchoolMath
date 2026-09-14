(function (root, factory) {
  var configApi = typeof module === "object" && module.exports ? require("./plot-config.js") : root.MathPlotConfig;
  var api = factory(root, configApi);
  root.MathFunctionDocument = api;
  if (typeof globalThis !== "undefined") {
    globalThis.MathFunctionDocument = api;
  }
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function (root, configApi) {
  var METADATA_PREFIX = "HSM_FUNCTION_PLOT_V1:";
  var METADATA_PREFIX_V2 = "HSM_FUNCTION_PLOT_V2:";
  var METADATA_PREFIX_V3 = "HSM_FUNCTION_PLOT_V3:";
  var METADATA_PREFIX_V4 = "HSM_FUNCTION_PLOT_V4:";

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeConfig(input) {
    if (!configApi) { throw new Error("绘图配置组件未加载，请重新打开插件。"); }
    return configApi.normalizeConfig(input);
  }

  function humanLabel(config) {
    return "函数图像：" + config.expressions.join("；");
  }

  function serializeMetadata(input) {
    var config = normalizeConfig(input);
    var prefix = config.curves || config.points || config.options.monochrome ? METADATA_PREFIX_V2 : METADATA_PREFIX;
    if (config.parameters || config.guides) { prefix = METADATA_PREFIX_V3; }
    if (config.analysis) { prefix = METADATA_PREFIX_V4; }
    return humanLabel(config) + "\n" + prefix + encodeURIComponent(JSON.stringify(config));
  }

  function parseMetadata(value) {
    var text = String(value || "");
    var prefix = text.indexOf(METADATA_PREFIX_V2) >= 0 ? METADATA_PREFIX_V2 : METADATA_PREFIX;
    if (text.indexOf(METADATA_PREFIX_V3) >= 0) { prefix = METADATA_PREFIX_V3; }
    if (text.indexOf(METADATA_PREFIX_V4) >= 0) { prefix = METADATA_PREFIX_V4; }
    var prefixIndex = text.indexOf(prefix);
    if (prefixIndex < 0) {
      return null;
    }
    var encoded = text.substring(prefixIndex + prefix.length).split(/[\r\n]/)[0].trim();
    if (!encoded) {
      return null;
    }
    try {
      return normalizeConfig(JSON.parse(decodeURIComponent(encoded)));
    } catch (_) {
      return null;
    }
  }

  function shapeMetadata(shape) {
    try {
      return parseMetadata(shape.AlternativeText);
    } catch (_) {
      return null;
    }
  }

  function applyMetadata(shape, input) {
    var config = normalizeConfig(input);
    try {
      shape.AlternativeText = serializeMetadata(config);
      if (JSON.stringify(parseMetadata(shape.AlternativeText)) !== JSON.stringify(config)) {
        throw new Error("图像参数写入后不完整");
      }
    } catch (_) {
      throw new Error("无法保存函数图像的编辑参数，已取消替换。");
    }
    try { shape.Title = config.expressions.join("；"); } catch (_) {}
    return config;
  }

  function selectedWriterShape(app) {
    var selection = null;
    var doc = null;
    try { selection = app && app.Selection; } catch (_) { selection = null; }
    try { doc = app && app.ActiveDocument; } catch (_) { doc = null; }
    if (!selection || !doc) {
      return null;
    }

    var collections = [];
    try { if (selection.InlineShapes) { collections.push(selection.InlineShapes); } } catch (_) {}
    try { if (selection.Range && selection.Range.InlineShapes) { collections.push(selection.Range.InlineShapes); } } catch (_) {}
    for (var collectionIndex = 0; collectionIndex < collections.length; collectionIndex += 1) {
      try {
        if (Number(collections[collectionIndex].Count) === 1) {
          var selected = collections[collectionIndex].Item(1);
          var selectedConfig = shapeMetadata(selected);
          if (selectedConfig && exactWriterSelection(selection, selected)) {
            return { host: "writer", shape: selected, config: selectedConfig };
          }
        }
      } catch (_) {}
    }

    var start = null;
    var end = null;
    try {
      start = Number(selection.Range.Start);
      end = Number(selection.Range.End);
    } catch (_) {}
    if (start === null || !isFinite(start)) {
      return null;
    }
    try {
      var count = Number(doc.InlineShapes.Count) || 0;
      for (var index = 1; index <= count; index += 1) {
        var shape = doc.InlineShapes.Item(index);
        var shapeStart = Number(shape.Range.Start);
        var shapeEnd = Number(shape.Range.End);
        var touchesSelection = start === shapeStart && (start === end || end === shapeEnd);
        if (touchesSelection) {
          var config = shapeMetadata(shape);
          if (config) {
            return { host: "writer", shape: shape, config: config };
          }
        }
      }
    } catch (_) {}
    return null;
  }

  function exactWriterSelection(selection, shape) {
    try {
      var range = selection.Range;
      return Number(range.Start) === Number(shape.Range.Start) &&
        (Number(range.Start) === Number(range.End) || Number(range.End) === Number(shape.Range.End));
    } catch (_) { return false; }
  }

  function selectedPresentationShape(app) {
    try {
      var selection = app.ActiveWindow.Selection;
      var range = selection && selection.ShapeRange;
      if (!range || Number(range.Count) !== 1) {
        return null;
      }
      var shape = range.Item(1);
      var config = shapeMetadata(shape);
      return config ? { host: "presentation", shape: shape, config: config } : null;
    } catch (_) {
      return null;
    }
  }

  function getSelectedPlot(app) {
    var writer = selectedWriterShape(app);
    return writer || selectedPresentationShape(app);
  }

  function rangeStart(shape, fallback) {
    try {
      var start = Number(shape.Range.Start);
      return isFinite(start) ? start : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function shapeGeometry(shape) {
    var geometry = {};
    ["Left", "Top", "Width", "Height"].forEach(function (property) {
      try {
        var value = Number(shape[property]);
        if (isFinite(value) && value > (property === "Width" || property === "Height" ? 0 : -100000)) {
          geometry[property.toLowerCase()] = value;
        }
      } catch (_) {}
    });
    return geometry;
  }

  function insertIntoWriter(app, path, plot, config) {
    var doc = app && app.ActiveDocument;
    var selection = app && app.Selection;
    if (!doc || !selection || !doc.InlineShapes) {
      throw new Error("请先打开一个 WPS 文字文档。");
    }
    var selected = selectedWriterShape(app);
    var update = Boolean(selected);
    var preserved = selected ? shapeGeometry(selected.shape) : {};
    var insertionRange = selection.Range;
    var start = selected ? rangeStart(selected.shape, NaN) : Number(insertionRange.Start);
    if (!isFinite(start)) { throw new Error("无法确定插入位置，请重新选择光标位置。"); }
    // A collapsed range inserts beside the old content without deleting it.
    if (typeof doc.Range === "function") {
      insertionRange = doc.Range(start, start);
    } else if (selected || Number(insertionRange.Start) !== Number(insertionRange.End)) {
      throw new Error("当前 WPS 无法安全替换选区，请将光标放到空白位置后插入新图。");
    }

    var shape = doc.InlineShapes.AddPicture(path, false, true, insertionRange);
    finishReplacement(shape, selected && selected.shape, config);
    try {
      shape.LockAspectRatio = -1;
      shape.Width = preserved.width || 420;
      if (preserved.height) {
        shape.Height = preserved.height;
      } else if (!Number(shape.Height) || Number(shape.Height) < 10) {
        shape.Height = Math.round(Number(shape.Width) * plot.height / plot.width);
      }
    } catch (_) {}
    try { selection.SetRange(shape.Range.End, shape.Range.End); } catch (_) {}
    return {
      host: "writer",
      updated: update,
      shape: shape,
      message: update ? "所选函数图像已更新。" : "函数图像已插入到 WPS 文字。"
    };
  }

  function finishReplacement(shape, previous, config) {
    if (!shape) { throw new Error("WPS 未返回新图像，原内容已保留。"); }
    try {
      applyMetadata(shape, config);
    } catch (error) {
      try {
        shape.Delete();
      } catch (_) {
        throw new Error(error.message + " 原图未主动移除；临时新图清理失败，请检查并手动删除多余图像。");
      }
      throw error;
    }
    if (previous) {
      try {
        previous.Delete();
      } catch (_) {
        // Delete may throw after a partial host operation. Retain the verified new
        // picture so cleanup cannot remove the only remaining copy.
        throw new Error("新图已插入，但旧图移除结果无法确认。已保留新图，请检查并手动删除多余图像。");
      }
    }
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
    if (root.WpsPptApi && root.WpsPptApi.getPresentationSize) {
      return root.WpsPptApi.getPresentationSize(presentation);
    }
    try {
      return {
        width: Number(presentation.PageSetup.SlideWidth) || 720,
        height: Number(presentation.PageSetup.SlideHeight) || 540
      };
    } catch (_) {
      return { width: 720, height: 540 };
    }
  }

  function newPresentationGeometry(slide, presentation, plot) {
    var size = presentationSize(presentation);
    var width = Math.min(460, size.width - 48);
    var height = Math.round(width * plot.height / plot.width);
    if (height > size.height - 48) {
      height = size.height - 48;
      width = Math.round(height * plot.width / plot.height);
    }
    if (root.WpsPptApi && root.WpsPptApi.findBestPlacement) {
      return root.WpsPptApi.findBestPlacement(slide, presentation, width, height, {
        margin: 24,
        padding: 10
      });
    }
    return {
      left: Math.max(24, (size.width - width) / 2),
      top: Math.max(24, (size.height - height) / 2),
      width: width,
      height: height,
      overlapArea: 0,
      overlapCount: 0,
      scale: 1
    };
  }

  function insertIntoPresentation(app, path, plot, config) {
    var presentation = activePresentation(app);
    var slide = activeSlide(app, presentation);
    if (!presentation || !slide || !slide.Shapes) {
      throw new Error("请先打开一个 WPS 演示文稿并选中幻灯片。");
    }
    var selected = selectedPresentationShape(app);
    var update = Boolean(selected);
    var geometry = selected ? shapeGeometry(selected.shape) : newPresentationGeometry(slide, presentation, plot);
    var shape = slide.Shapes.AddPicture(
      path,
      false,
      true,
      geometry.left,
      geometry.top,
      geometry.width,
      geometry.height
    );
    finishReplacement(shape, selected && selected.shape, config);
    try { shape.Name = "高中数学函数图像"; } catch (_) {}
    try { shape.Select(); } catch (_) {}
    return {
      host: "presentation",
      updated: update,
      shape: shape,
      placement: geometry,
      message: update ? "所选函数图像已更新。" : "函数图像已插入到当前幻灯片。"
    };
  }

  function insertOrUpdate(app, path, plot, input) {
    var config = normalizeConfig(input);
    var writerDocument = null;
    try { writerDocument = app && app.ActiveDocument; } catch (_) {}
    if (writerDocument) { return insertIntoWriter(app, path, plot, config); }
    if (activePresentation(app)) {
      return insertIntoPresentation(app, path, plot, config);
    }
    throw new Error("当前不是可插入图像的 WPS 文字或演示窗口。");
  }

  return {
    METADATA_PREFIX: METADATA_PREFIX,
    METADATA_PREFIX_V2: METADATA_PREFIX_V2,
    METADATA_PREFIX_V3: METADATA_PREFIX_V3,
    METADATA_PREFIX_V4: METADATA_PREFIX_V4,
    getDefaultConfig: function () { return configApi.getDefaultConfig(); },
    normalizeConfig: normalizeConfig,
    serializeMetadata: serializeMetadata,
    parseMetadata: parseMetadata,
    applyMetadata: applyMetadata,
    getSelectedPlot: getSelectedPlot,
    getSelectedPlotConfig: function (app) {
      var selected = getSelectedPlot(app);
      return selected ? clone(selected.config) : null;
    },
    insertOrUpdate: insertOrUpdate,
    _private: {
      shapeMetadata: shapeMetadata,
      selectedWriterShape: selectedWriterShape,
      selectedPresentationShape: selectedPresentationShape,
      shapeGeometry: shapeGeometry,
      newPresentationGeometry: newPresentationGeometry,
      insertIntoWriter: insertIntoWriter,
      insertIntoPresentation: insertIntoPresentation
    }
  };
});
