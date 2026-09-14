const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const projectRoot = path.join(__dirname, "..");
const plotter = require(path.join(projectRoot, "js", "plotter.js"));

function readProjectFile(filePath) {
  return fs.readFileSync(path.join(projectRoot, filePath), "utf8");
}

function createContext(hasDocument = true, options = {}) {
  const calls = [];
  const documentRanges = [];
  const pageSetup = {
    TextColumns: {
      SetCount(count) {
        pageSetup.columnCount = count;
        calls.push(["SetCount", count]);
      }
    }
  };
  const headerPageSetup = {
    TextColumns: {
      SetCount(count) {
        headerPageSetup.columnCount = count;
        calls.push(["HeaderSetCount", count]);
      }
    }
  };
  const pageNumbers = {
    Count: 0,
    Add() {
      calls.push(["PageNumbers.Add"]);
      this.Count += 1;
    },
    Item() {
      if (this.Count > 0) {
        return {};
      }
      throw new Error("page number item is not available");
    }
  };
  const storage = Object.assign({}, options.storage || {});
  const panes = {};
  const headerSection = { PageSetup: headerPageSetup };
  const bodySection = {
    PageSetup: pageSetup,
    Footers: {
      Item() {
        return { PageNumbers: pageNumbers };
      }
    }
  };
  const selection = {
    Start: 0,
    End: 0,
    Text: "",
    ParagraphFormat: { Alignment: -1, LineSpacing: 12, LineSpacingRule: 0 },
    Font: {
      Name: "宋体",
      NameAscii: "Times New Roman",
      NameOther: "Times New Roman",
      NameFarEast: "宋体",
      NameBi: "Times New Roman",
      Underline: 0,
      EmphasisMark: 0,
      Hidden: 0
    },
    Tables: {
      Count: 1,
      Item() {
        return {
          ConvertToText(separator) {
            calls.push(["ConvertToText", separator]);
          }
        };
      }
    },
    Sections: {
      Item() {
        return bodySection;
      }
    },
    TypeText(text) {
      calls.push(["TypeText", text]);
      this.Start += text.length;
      this.End = this.Start;
    },
    SetRange(start, end) {
      calls.push(["SetRange", start, end]);
      this.Start = start;
      this.End = end;
    }
  };
  Object.defineProperty(selection, "Range", {
    get() {
      return { Start: selection.Start, End: selection.End };
    }
  });
  const bookmarks = {};
  const documentSections = {
    Count: 1,
    Add(range, startType) {
      calls.push(["Sections.Add", range.Start, range.End, startType]);
      this.Count = 2;
      return bodySection;
    },
    Item(index) {
      return index === 1 ? headerSection : bodySection;
    }
  };
  const doc = {
    Sections: documentSections,
    Bookmarks: {
      Add(name, range) {
        calls.push(["Bookmarks.Add", name, range.Start, range.End]);
        bookmarks[name] = { Range: range };
        return bookmarks[name];
      },
      Exists(name) {
        return !!bookmarks[name];
      },
      Item(name) {
        return bookmarks[name];
      }
    },
    Range(start, end) {
      const range = {
        Start: start,
        End: end,
        Font: {},
        ParagraphFormat: { Alignment: -1 },
        Sections: {
          Item() {
            return headerSection;
          }
        }
      };
      documentRanges.push(range);
      return range;
    }
  };
  const app = {
    ActiveDocument: hasDocument ? doc : null,
    Selection: selection,
    PluginStorage: {
      getItem(key) {
        return storage[key] || "";
      },
      setItem(key, value) {
        storage[key] = value;
      }
    },
    CreateTaskPane(url) {
      calls.push(["CreateTaskPane", url]);
      const pane = { ID: "plot-pane", Visible: false };
      panes[pane.ID] = pane;
      return pane;
    },
    GetTaskPane(id) {
      return panes[id];
    },
    OAAssist: {
      ShellExecute(executable, parameters) {
        calls.push(["ShellExecute", executable, parameters]);
        return true;
      }
    }
  };
  const context = {
    window: {
      Application: app,
      setTimeout(callback, delay) {
        if (delay === 350) {
          callback();
        }
      }
    },
    document: { location: { toString: () => options.documentUrl || "http://127.0.0.1:3890/index.html" } },
    alert(message) {
      calls.push(["alert", message]);
    },
    console
  };
  vm.createContext(context);
  vm.runInContext(readProjectFile("js/symbols.js"), context);
  vm.runInContext(readProjectFile("js/taskpane.js"), context);
  vm.runInContext(readProjectFile("js/license.js"), context);
  vm.runInContext(readProjectFile("js/ribbon.js"), context);
  return {
    context,
    calls,
    selection,
    pageSetup,
    headerPageSetup,
    pageNumbers,
    documentRanges,
    documentSections
  };
}

{
  const { context, calls, selection, documentRanges } = createContext();
  context.OnAction({ Id: "sym_pi" });
  assert.deepStrictEqual(calls, [["TypeText", "π"], ["SetRange", 1, 1]]);
  assert.equal(documentRanges[0].Font.Name, "Cambria Math");
  assert.equal(documentRanges[0].Font.NameOther, "Cambria Math");
  assert.equal(selection.Font.Name, "宋体");
  assert.equal(selection.Font.NameAscii, "Times New Roman");
}

{
  const { context, calls } = createContext();
  context.OnAction({ Id: "sym_proper_subset" });
  context.OnAction({ Id: "sym_proper_superset" });
  assert.deepStrictEqual(calls, [
    ["TypeText", "⫋"],
    ["SetRange", 1, 1],
    ["TypeText", "⫌"],
    ["SetRange", 2, 2]
  ]);
}

{
  const { context, calls, pageSetup, headerPageSetup, documentRanges, documentSections } = createContext();
  context.OnAction({ Id: "exam_header" });
  assert(calls[0][1].includes("学校："));
  assert(calls[0][1].includes("考号："));
  assert(calls.some((call) => call[0] === "Bookmarks.Add" && call[1] === "HSMExamHeader"));
  assert(calls.some((call) => call[0] === "Sections.Add" && call[3] === 0));
  assert.equal(documentRanges[0].End, documentRanges[0].Start + context.EXAM_TEMPLATES.exam_header.length - 1);
  assert.equal(documentRanges[0].ParagraphFormat.Alignment, 4);
  assert.equal(documentSections.Count, 2);

  context.OnAction({ Id: "page_a4_two_column" });
  assert.equal(headerPageSetup.Orientation, 1);
  assert.equal(pageSetup.Orientation, 1);
  assert.equal(headerPageSetup.columnCount, 1);
  assert.equal(pageSetup.columnCount, 2);
}

{
  const { context, selection } = createContext();
  selection.Text = " A B\tC　D\r";
  context.OnAction({ Id: "remove_spaces" });
  assert.equal(selection.Text, "ABCD");
}

{
  const { context, selection, calls } = createContext();
  context.OnAction({ Id: "align_center" });
  context.OnAction({ Id: "line_spacing_more" });
  context.OnAction({ Id: "underline_add" });
  context.OnAction({ Id: "emphasis_add" });
  context.OnAction({ Id: "toggle_hidden" });
  context.OnAction({ Id: "table_to_text" });
  assert.equal(selection.ParagraphFormat.Alignment, 1);
  assert.equal(selection.ParagraphFormat.LineSpacingRule, 4);
  assert.equal(selection.ParagraphFormat.LineSpacing, 13);
  assert.equal(selection.Font.Underline, 1);
  assert.equal(selection.Font.EmphasisMark, 1);
  assert.equal(selection.Font.Hidden, 1);
  assert(calls.some((call) => call[0] === "ConvertToText" && call[1] === 1));
}

{
  const { context, pageSetup, calls, pageNumbers } = createContext();
  context.OnAction({ Id: "page_a4_two_column" });
  context.OnAction({ Id: "add_page_number" });
  assert.equal(pageSetup.PaperSize, 7);
  assert.equal(pageSetup.Orientation, 1);
  assert.equal(pageSetup.TopMargin, 42);
  assert(calls.some((call) => call[0] === "SetCount" && call[1] === 2));
  assert.equal(pageNumbers.Count, 1);
}

{
  const { context, calls, pageNumbers } = createContext();
  pageNumbers.Count = 1;
  context.OnAction({ Id: "add_page_number" });
  assert(!calls.some((call) => call[0] === "PageNumbers.Add"));
  assert.equal(pageNumbers.Count, 1);
}

{
  const { context, calls, pageNumbers } = createContext();
  pageNumbers.Count = 1;
  pageNumbers.Item = function () {
    throw new Error("stale page number item");
  };
  context.OnAction({ Id: "add_page_number" });
  assert(calls.some((call) => call[0] === "PageNumbers.Add"));
  assert.equal(pageNumbers.Count, 2);
}

{
  const { context, calls } = createContext(true, { documentUrl: "file:///C:/plugin/index.html" });
  context.MathTaskPanes.openPackaged = function (options) {
    calls.push(["openPackaged", options]);
    return true;
  };
  context.OnAction({ Id: "function_plot" });
  const localEditorCall = calls.find((call) => call[0] === "openPackaged");
  assert(localEditorCall);
  assert.equal(localEditorCall[1].role, "writer");
  assert.equal(localEditorCall[1].name, "tool-center");
  assert.equal(localEditorCall[1].view, "function-plot");
  assert.equal(localEditorCall[1].pluginBaseUrl, "file:///C:/plugin");
  assert.equal(localEditorCall[1].readyTimeout, 5000);
  assert(!readProjectFile("js/ribbon.js").includes("38927"));
  assert(!readProjectFile("js/ribbon-ppt.js").includes("38928"));
  assert(!readProjectFile("js/taskpane.js").includes("requireReadySignal"));
}

{
  const { context, calls } = createContext();
  context.OnAction({ Id: "unknown_button" });
  assert.deepStrictEqual(calls, []);
}

{
  const { context, calls } = createContext(true, {
    storage: {
      hsmath_machine_id_v1: "HSMABC1234567",
      hsmath_trial_started_v1: "2026-01-01"
    }
  });
  context.OnAction({ Id: "exam_header" });
  assert(calls.some((call) => call[0] === "TypeText"));
  assert(!calls.some((call) => call[0] === "CreateTaskPane" && call[1].includes("/ui/license.html")));
}

{
  const { context, calls } = createContext(true, {
    storage: {
      hsmath_machine_id_v1: "HSMABC1234567",
      hsmath_trial_started_v1: "2026-01-01"
    }
  });
  context.MathTaskPanes.openPackaged = function (options) {
    calls.push(["openPackaged", options]);
    return true;
  };
  context.OnAction({ Id: "sym_pi" });
  const open = calls.find((call) => call[0] === "openPackaged");
  assert(open);
  assert.equal(open[1].role, "writer");
  assert.equal(open[1].name, "tool-center");
  assert.equal(open[1].view, "license");
  assert(!calls.some((call) => call[0] === "alert"));
  assert(!calls.some((call) => call[0] === "TypeText"));
}

{
  const { context, calls } = createContext(true, {
    storage: {
      hsmath_machine_id_v1: "HSMABC1234567",
      hsmath_trial_started_v1: "2026-01-01"
    }
  });
  context.MathTaskPanes.openPackaged = function (options) {
    calls.push(["openPackaged", options]);
    return true;
  };
  context.OnAction({ Id: "function_plot" });
  const open = calls.find((call) => call[0] === "openPackaged");
  assert(open);
  assert.equal(open[1].name, "tool-center");
  assert.equal(open[1].view, "license");
  assert(!calls.some((call) => call[0] === "alert"));
  assert(!calls.some((call) => call[0] === "CreateTaskPane" && call[1].includes("hsmMode=function-plot")));
}

{
  const { context, calls } = createContext(true, {
    storage: {
      hsmath_machine_id_v1: "HSMABC1234567",
      hsmath_trial_started_v1: "2026-01-01"
    }
  });
  context.MathTaskPanes.openPackaged = function (options) {
    calls.push(["openPackaged", options]);
    return true;
  };
  context.OnAction({ Id: "authorization_center" });
  const open = calls.find((call) => call[0] === "openPackaged");
  assert(open);
  assert.equal(open[1].role, "writer");
  assert.equal(open[1].name, "tool-center");
  assert.equal(open[1].view, "license");
  assert(!calls.some((call) => call[0] === "alert"));
}

{
  const { context, calls } = createContext(false);
  context.OnAction({ Id: "sym_angle" });
  assert(calls.some((call) => call[0] === "alert"));
  assert.equal(context.OnGetEnabled({ Id: "authorization_center" }), true);
  assert.equal(context.OnGetEnabled({ Id: "sym_angle" }), false);
}

{
  const { context } = createContext();
  const ribbon = readProjectFile("ribbon.xml");
  assert.equal((ribbon.match(/<tab\b/g) || []).length, 1);
  assert(ribbon.includes('<tab id="mathTeacherTab" label="高中数学">'));
  assert(!ribbon.includes("mathTeacherToolsTab"));
  assert(ribbon.includes('<button id="sym_propto" label="∝"'));
  assert(!ribbon.includes("sym_infinity_relation"));
  assert.equal(context.SYMBOLS.sym_propto, "∝");
  const pptRibbon = readProjectFile("ppt/ribbon.xml");
  assert(pptRibbon.includes('<button id="sym_propto" label="∝"'));
  assert(!pptRibbon.includes("sym_infinity_relation"));
  const buttonIds = [...ribbon.matchAll(/<button id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(buttonIds).size, buttonIds.length);
  for (const id of buttonIds) {
    assert(id in context.SYMBOLS || id in context.COMMANDS, `missing command for ${id}`);
  }
}

{
  const css = readProjectFile("ui/function-plot.css");
  assert(css.includes("grid-template-columns: repeat(4, minmax(0, 1fr))"));
  assert(css.includes("@media (max-width: 260px)"));
  assert(!css.includes("min-width: 300px"));
}

assert.equal(plotter.evaluateExpression("x^2+2x+1", 3), 16);
assert.equal(plotter.evaluateExpression("2(x+1)", 4), 10);
assert.equal(plotter.evaluateExpression("x²+x³", 2), 12);
assert.equal(plotter.evaluateExpression("√x", 4), 2);
assert.equal(plotter.evaluateExpression("√16", 0), 4);
assert.ok(Math.abs(plotter.evaluateExpression("sin(pi/2)", 0) - 1) < 1e-10);
assert.ok(Math.abs(plotter.evaluateExpression("sec(0)", 0) - 1) < 1e-10);
assert.ok(Math.abs(plotter.evaluateExpression("csc(pi/2)", 0) - 1) < 1e-10);
assert.equal(plotter.evaluateExpression("lg(100)", 0), plotter.evaluateExpression("log(100)", 0));
assert.equal(plotter.evaluateExpression("abs(x)", -3), 3);
assert.throws(() => plotter.compileExpression("unknown(x)"), /不支持/);
const plot = plotter.generatePlotSvg(["x^2", "sin(x)", "1/x"], {
  xMin: -10,
  xMax: 10,
  yMin: -10,
  yMax: 10
});
assert(plot.svg.includes("<svg"));
assert(plot.svg.includes("<path"));
assert(plot.svg.includes("y=x^2"));
assert(!plot.svg.includes("NaN"));
assert(!plot.svg.includes("Infinity"));
const plainPlot = plotter.generatePlotSvg(["x^2"], {
  xMin: -10,
  xMax: 10,
  yMin: -10,
  yMax: 10
}, {
  showTickLabels: false,
  showGrid: false,
  showBorder: false,
  showLegend: false
});
assert(plainPlot.svg.includes('stroke="#334155"'), "axes should always be visible");
assert(!plainPlot.svg.includes('stroke="#e2e8f0"'));
assert(!plainPlot.svg.includes('stroke="#94a3b8"'));
assert(!plainPlot.svg.includes(">y=x^2</text>"));
assert(!plainPlot.svg.includes(">10</text>"));
const multiLegendPlot = plotter.generatePlotSvg(["x", "x+1", "x+2", "x+3", "x+4", "x+5"], {
  xMin: -10,
  xMax: 10,
  yMin: -10,
  yMax: 10
});
assert(multiLegendPlot.svg.includes('y="42"'), "legend should wrap onto a second row");
const densePlot = plotter.generatePlotSvg(["sin(100x)"], {
  xMin: -10,
  xMax: 10,
  yMin: -2,
  yMax: 2
});
assert((densePlot.svg.match(/[ML]/g) || []).length > 1000, "high-frequency plots should use more than 1000 samples");

const plotPaneHtml = readProjectFile("ui/function-plot.html");
const plotPaneEntry = readProjectFile("ui/function-plot-entry.js");
const plotPaneScript = readProjectFile("ui/function-plot.js");
const plotDocumentScript = readProjectFile("js/function-plot-document.js");
const paneElementIds = [...plotPaneScript.matchAll(/node\("([^"]+)"\)/g)].map((match) => match[1]);
for (const id of paneElementIds) {
  assert(plotPaneEntry.includes(`id="${id}"`), `function plot pane is missing ${id}`);
}
assert(plotDocumentScript.includes("InlineShapes.AddPicture"));
assert(plotDocumentScript.includes("Shapes.AddPicture"));
assert(plotPaneHtml.includes("../js/ppt-api.js"));
assert(plotPaneHtml.includes("../js/license.js"));
assert(plotPaneHtml.includes("../js/function-plot-document.js"));
const licenseHtml = readProjectFile("ui/license.html");
const licenseEntry = readProjectFile("ui/license-entry.js");
const licenseScript = readProjectFile("ui/license-ui.js");
const licenseCss = readProjectFile("ui/license.css");
assert(licenseHtml.includes("license-entry.js"));
assert(licenseEntry.includes('id="wechatQr"'));
assert(licenseEntry.includes("../assets/wechat-qr.jpg"));
assert(licenseEntry.includes('id="qqNumber"'));
assert(licenseEntry.includes('id="machineCode"'));
assert(licenseEntry.includes('id="statusBadge"'));
assert(licenseEntry.includes('id="expiryTime"'));
assert(licenseEntry.includes('id="remainingTime"'));
assert(licenseEntry.includes('id="activateButton"'));
assert(licenseEntry.includes('id="pasteActivationCode"'));
assert(licenseEntry.includes('id="copyQqNumber"'));
assert(licenseEntry.includes('class="license-disclosure activation-disclosure"'));
assert(licenseEntry.includes('class="license-disclosure contact-disclosure"'));
assert.equal((licenseEntry.match(/class="disclosure-arrow"/g) || []).length, 2);
assert.equal((licenseEntry.match(/class="disclosure-chevron"/g) || []).length, 2);
assert(licenseEntry.includes('月卡 / 季卡 / 年卡 / 永久版</small><span class="disclosure-arrow"'));
assert(licenseEntry.includes('微信 / QQ 联系方式</small><span class="disclosure-arrow"'));
assert(!/<details[^>]*\sopen(?:\s|=|>)/.test(licenseEntry));
assert(licenseScript.includes("MathLicense.getContact"));
assert(licenseScript.includes("licenseStatus.expiresText"));
assert(licenseScript.includes("licenseStatus.remainingText"));
assert(licenseScript.includes("navigator.clipboard.readText"));
assert(!/\balert\s*\(/.test(readProjectFile("js/license.js")));
assert(!/\bprompt\s*\(/.test(readProjectFile("js/license.js")));
assert(!readProjectFile("js/license.js").includes("InputBox"));
assert(licenseCss.includes(".wechat-qr"));
assert(licenseCss.includes("grid-template-columns: minmax(0, 1fr) auto 20px"));
assert(licenseCss.includes("align-self: center"));
assert(licenseCss.includes(".disclosure-chevron"));
assert(!licenseCss.includes(".activation-disclosure .disclosure-arrow"));
const toolCenterHtml = readProjectFile("ui/tool-center.html");
const toolCenterScript = readProjectFile("ui/tool-center.js");
assert(toolCenterHtml.includes('data-view="function-plot"'));
assert(toolCenterHtml.includes('data-view="license"'));
assert(toolCenterHtml.includes('id="functionPlotRoot"'));
assert(toolCenterHtml.includes('id="licenseRoot"'));
assert(!toolCenterHtml.includes("tool-center-brand"));
assert(!toolCenterHtml.includes("离线可用"));
assert(toolCenterScript.includes('signalReady(PANE_NAME)'));
assert(plotPaneScript.includes("Math.random()"));
assert(plotDocumentScript.includes("shape.Height"));
assert(!plotPaneHtml.includes("<textarea"));
assert(plotPaneEntry.includes('id="expressionRows"'));
assert(plotPaneEntry.includes('id="addExpressionButton"'));
assert(plotPaneEntry.includes('id="loadSelectionButton"'));
assert(plotPaneEntry.includes('data-preset="sine"'));
assert(plotPaneEntry.includes('data-preset="cosine"'));
assert(plotPaneEntry.includes('data-preset="exponential"'));
assert(plotPaneEntry.includes('data-preset="logarithm"'));
assert(!plotPaneEntry.includes('data-preset="trigonometric"'));
assert(plotPaneEntry.includes('<header class="editor-header">'));
assert(plotPaneEntry.includes('id="showTickLabels"'));
assert(plotPaneEntry.includes('id="showGrid"'));
assert(plotPaneEntry.includes('id="showBorder"'));
assert(plotPaneEntry.includes('id="showLegend"'));
assert(plotPaneEntry.includes('id="xMin" type="number" value="-10"'));
assert(plotPaneEntry.includes('id="xMax" type="number" value="10"'));
assert(plotPaneEntry.includes('id="yMin" type="number" value="-10"'));
assert(plotPaneEntry.includes('id="yMax" type="number" value="10"'));
assert(plotDocumentScript.includes("HSM_FUNCTION_PLOT_V1:"));
assert(plotPaneScript.includes("loadSelectedPlot"));
assert(plotPaneScript.includes("synchronizeSelectionMode"));
assert(plotPaneScript.includes("window.setInterval(synchronizeSelectionMode, 250)"));
assert(!plotPaneScript.includes("preset.bounds"));

console.log("ribbon symbol, exam template, formatting, and function plot tests passed");
