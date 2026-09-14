(function (root, factory) {
  var configApi = typeof module === "object" && module.exports ? require("./plot-config.js") : root.MathPlotConfig;
  var plotter = typeof module === "object" && module.exports ? require("./plotter.js") : root.FunctionPlotter;
  var api = factory(configApi, plotter);
  root.MathPlotLibrary = api;
  if (typeof module === "object" && module.exports) { module.exports = api; }
})(typeof window !== "undefined" ? window : globalThis, function (configApi, plotter) {
  var KEY = "hsmath_plot_library_v1";
  var MAX_ITEMS = 50;
  var MAX_TEXT = 2000000;

  function normalizeName(value) {
    var name = String(value || "").trim();
    if (!name || name.length > 40) { throw new Error("收藏名称请输入 1—40 个字符。"); }
    return name;
  }

  function checkedConfig(value) {
    var config = configApi.normalizeConfig(value);
    if (config.curves && !config.curves.some(function (curve) { return curve.visible; })) {
      throw new Error("收藏方案至少需要显示一条曲线。");
    }
    var parameters = {};
    Object.keys(config.parameters || {}).forEach(function (name) { parameters[name] = config.parameters[name].value; });
    config.expressions.forEach(function (expression, index) {
      if (!config.curves || config.curves[index].visible) { plotter.compileExpression(expression, parameters); }
    });
    (config.guides || []).forEach(function (guide) {
      var evaluate = plotter.compileExpression(guide.expression, parameters);
      var value = evaluate(0);
      if (evaluate.usesX || !isFinite(value) || Math.abs(value) > 1e9) { throw new Error("辅助线位置无效。"); }
    });
    if (config.analysis && config.analysis.tangent) {
      var position = plotter.compileExpression(config.analysis.tangent.x, parameters);
      if (position.usesX || !isFinite(position(0)) || Math.abs(position(0)) > 1e9) { throw new Error("切点横坐标无效。"); }
    }
    return config;
  }

  function decode(text) {
    if (typeof text !== "string" || text.length > MAX_TEXT) { throw new Error("收藏备份过大，最多支持 2 百万个字符。"); }
    var data;
    try { data = JSON.parse(text); } catch (_) { throw new Error("收藏数据无法读取，请检查备份文字；原收藏未被覆盖。"); }
    if (!data || data.format !== "HSM_PLOT_LIBRARY" || [1, 2].indexOf(data.version) < 0 || !Array.isArray(data.items) || data.items.length > MAX_ITEMS) {
      throw new Error("收藏备份格式或版本不支持，最多支持 50 个方案。");
    }
    var ids = [];
    var names = [];
    return data.items.map(function (item) {
      if (!item || typeof item.id !== "string" || !/^[a-z0-9-]{1,80}$/i.test(item.id) || ids.indexOf(item.id) >= 0) {
        throw new Error("收藏标识无效或重复。");
      }
      var name = normalizeName(item.name);
      if (names.indexOf(name) >= 0) { throw new Error("收藏备份含重复名称。"); }
      ids.push(item.id);
      names.push(name);
      return { id: item.id, name: name, config: checkedConfig(item.config) };
    });
  }

  function encode(items) {
    var version = items.some(function (item) { return Boolean(item.config.analysis); }) ? 2 : 1;
    var text = JSON.stringify({ format: "HSM_PLOT_LIBRARY", version: version, items: items });
    if (text.length > MAX_TEXT) { throw new Error("收藏空间已满，请先导出备份并删除部分方案。"); }
    return text;
  }

  // Pin one backend: a failing write must not silently create a second library elsewhere.
  function create(storage) {
    function readRaw() {
      if (!storage || !storage.getItem || !storage.setItem) { throw new Error("当前环境无法保存收藏，请使用文档图像保留绘图设置。"); }
      try { return storage.getItem(KEY) || ""; }
      catch (_) { throw new Error("无法读取本机收藏，请重新打开编辑器后重试。"); }
    }
    function read() {
      var raw = readRaw();
      return { raw: raw, items: raw ? decode(raw) : [] };
    }
    function write(previous, items) {
      var next = encode(items);
      if (readRaw() !== previous.raw) { throw new Error("收藏已在另一个窗口更新，请刷新列表后重试。"); }
      try {
        if (previous.items) {
          var backup = encode(previous.items);
          storage.setItem(KEY + "_backup", backup);
          if (storage.getItem(KEY + "_backup") !== backup) { throw new Error("backup"); }
        }
        storage.setItem(KEY, next);
        if (storage.getItem(KEY) !== next) { throw new Error("verification"); }
      } catch (_) {
        throw new Error("收藏未能确认保存，请刷新列表检查；不要关闭尚未保存的绘图设置。");
      }
      return items;
    }
    function newId(items) {
      var id = "plot-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
      while (items.some(function (item) { return item.id === id; })) { id += "x"; }
      return id;
    }
    return {
      list: function () { return read().items; },
      save: function (name, config) {
        var previous = read();
        name = normalizeName(name);
        if (previous.items.some(function (item) { return item.name === name; })) {
          throw new Error("已有同名收藏，请换一个名称保存。");
        }
        if (previous.items.length >= MAX_ITEMS) { throw new Error("最多收藏 50 个方案，请先导出备份并删除部分方案。"); }
        var item = { id: newId(previous.items), name: name, config: checkedConfig(config) };
        write(previous, previous.items.concat([item]));
        return item;
      },
      remove: function (id) {
        var previous = read();
        if (!previous.items.some(function (item) { return item.id === id; })) { throw new Error("收藏已不存在，请刷新列表。"); }
        return write(previous, previous.items.filter(function (item) { return item.id !== id; }));
      },
      exportText: function () { return encode(read().items); },
      importText: function (text) {
        // Validate the entire input before any mutation.
        var imported = decode(text);
        var previous = read();
        var items = previous.items.slice();
        var added = 0;
        imported.forEach(function (item) {
          var name = item.name;
          var suffix = 1;
          var existing;
          while ((existing = items.filter(function (entry) { return entry.name === name; })[0])) {
            if (JSON.stringify(existing.config) === JSON.stringify(item.config)) { return; }
            suffix += 1;
            name = item.name.slice(0, 28) + "（导入 " + suffix + "）";
          }
          items.push({ id: newId(items), name: name, config: item.config });
          added += 1;
        });
        if (items.length > MAX_ITEMS) { throw new Error("合并后超过 50 个方案，请先整理收藏。"); }
        if (added) { write(previous, items); }
        return added;
      },
      recoverPrevious: function () {
        var raw = readRaw();
        var backup;
        try { backup = storage.getItem(KEY + "_backup"); } catch (_) { throw new Error("无法读取上次收藏备份。"); }
        if (!backup) { throw new Error("没有可恢复的上次收藏备份。"); }
        var items = decode(backup);
        var previous = { raw: raw };
        try { previous.items = raw ? decode(raw) : []; } catch (_) {}
        write(previous, items);
        return items;
      }
    };
  }

  function forWindow(window) {
    var storage = null;
    try { var app = window.Application || window.wps; storage = app && app.PluginStorage; } catch (_) {}
    if (!storage || !storage.getItem || !storage.setItem) {
      try { storage = window.localStorage; } catch (_) {}
    }
    return create(storage);
  }

  return { KEY: KEY, MAX_ITEMS: MAX_ITEMS, create: create, forWindow: forWindow };
});
