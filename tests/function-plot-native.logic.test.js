const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const projectRoot = path.join(__dirname, "..");
const configSource = fs.readFileSync(path.join(projectRoot, "js", "plot-config.js"), "utf8");
const plotterSource = fs.readFileSync(path.join(projectRoot, "js", "plotter.js"), "utf8");
const nativeSource = fs.readFileSync(path.join(projectRoot, "js", "function-plot-native.js"), "utf8");

function createContext(app, answers) {
  const alerts = [];
  const prompts = answers.slice();
  const context = {
    window: { Application: app },
    alert(message) {
      alerts.push(message);
    },
    InputBox() {
      return prompts.shift();
    },
    prompt() {
      throw new Error("WPS InputBox should be preferred over browser prompt");
    },
    console
  };
  vm.createContext(context);
  vm.runInContext(configSource, context);
  vm.runInContext(plotterSource, context);
  vm.runInContext(nativeSource, context);
  return { context, alerts };
}

{
  const calls = [];
  const shape = { Range: { End: 7 }, Height: 0 };
  const app = {
    Env: { GetTempPath() { return "C:\\Temp"; } },
    FileSystem: {
      WriteFile(filePath, contents) {
        calls.push(["WriteFile", filePath, contents]);
        return true;
      },
      Remove(filePath) {
        calls.push(["Remove", filePath]);
      }
    },
    ActiveDocument: {
      InlineShapes: {
        AddPicture(filePath, linkToFile, saveWithDocument, range) {
          calls.push(["AddPicture", filePath, linkToFile, saveWithDocument, range.Start, range.End]);
          return shape;
        }
      }
    },
    Selection: {
      Range: { Start: 2, End: 2 },
      SetRange(start, end) {
        calls.push(["SetRange", start, end]);
      }
    }
  };
  const { context, alerts } = createContext(app, ["x^2；sin(x)", "-5,5", "-2,8"]);
  assert.equal(context.MathFunctionPlot.openWriter(app), true);
  assert(calls.some((call) => call[0] === "WriteFile" && call[2].includes("<svg")));
  assert(calls.some((call) => call[0] === "AddPicture"));
  assert(calls.some((call) => call[0] === "Remove"));
  assert.equal(shape.Width, 420);
  assert(shape.AlternativeText.includes("x^2"));
  assert(alerts.some((message) => message.includes("已插入到 WPS 文字")));
}

{
  const calls = [];
  const shape = {
    Select() {
      calls.push(["Select"]);
    }
  };
  const slide = {
    Shapes: {
      AddPicture(filePath, linkToFile, saveWithDocument, left, top, width, height) {
        calls.push(["AddPicture", filePath, linkToFile, saveWithDocument, left, top, width, height]);
        return shape;
      }
    }
  };
  const app = {
    Env: { GetTempPath() { return "C:\\Temp\\"; } },
    FileSystem: {
      WriteFile(filePath, contents) {
        calls.push(["WriteFile", filePath, contents]);
        return true;
      },
      Remove(filePath) {
        calls.push(["Remove", filePath]);
      }
    },
    ActivePresentation: {
      PageSetup: { SlideWidth: 720, SlideHeight: 540 },
      Slides: { Item() { return slide; } }
    },
    ActiveWindow: {
      View: { Slide: slide },
      Selection: { SlideRange: { Item() { return slide; } } }
    }
  };
  const { context, alerts } = createContext(app, ["abs(x)", "-10,10", "-10,10"]);
  assert.equal(context.MathFunctionPlot.openPresentation(app), true);
  const pictureCall = calls.find((call) => call[0] === "AddPicture");
  assert(pictureCall);
  assert.equal(pictureCall[6], 460);
  assert(calls.some((call) => call[0] === "Select"));
  assert.equal(shape.Name, "高中数学函数图像");
  assert(alerts.some((message) => message.includes("当前幻灯片")));
}

{
  const app = {};
  const { context, alerts } = createContext(app, [null]);
  assert.equal(context.MathFunctionPlot.openWriter(app), false);
  assert.deepStrictEqual(alerts, []);
  assert.deepStrictEqual(
    Array.from(context.MathFunctionPlot._private.parseExpressions("x^2； sin(x)\nabs(x)")),
    ["x^2", "sin(x)", "abs(x)"]
  );
  assert.throws(
    () => context.MathFunctionPlot._private.parseRange("10,-10", "横坐标"),
    /范围无效/
  );
}

{
  const calls = [];
  const confirmations = [true, true, false];
  const shape = { Range: { End: 3 }, Height: 20 };
  const app = {
    confirm() {
      return confirmations.shift();
    },
    Env: { GetTempPath() { return "C:\\Temp"; } },
    FileSystem: {
      WriteFile(filePath, contents) {
        calls.push(["WriteFile", filePath, contents]);
        return true;
      },
      Remove() {}
    },
    ActiveDocument: {
      InlineShapes: {
        AddPicture() {
          return shape;
        }
      }
    },
    Selection: {
      Range: { Start: 0, End: 0 },
      SetRange() {}
    }
  };
  const { context } = createContext(app, []);
  delete context.InputBox;
  assert.equal(context.MathFunctionPlot.openWriter(app), true);
  assert(calls.some((call) => call[0] === "WriteFile" && call[2].includes("1/x")));
  assert.equal(shape.AlternativeText, "函数图像：1/x");
  assert.deepStrictEqual(confirmations, []);
}

{
  const writerLoader = fs.readFileSync(path.join(projectRoot, "main.js"), "utf8");
  const pptLoader = fs.readFileSync(path.join(projectRoot, "ppt", "main.js"), "utf8");
  assert(writerLoader.indexOf("src='js/plotter.js'") < writerLoader.indexOf("src='js/function-plot-native.js'"));
  assert(writerLoader.indexOf("src='js/function-plot-document.js'") < writerLoader.indexOf("src='js/function-plot-native.js'"));
  assert(writerLoader.indexOf("src='js/function-plot-native.js'") < writerLoader.indexOf("src='js/ribbon.js'"));
  assert(pptLoader.indexOf("plotter.js") < pptLoader.indexOf("function-plot-native.js"));
  assert(pptLoader.indexOf("function-plot-document.js") < pptLoader.indexOf("function-plot-native.js"));
  assert(pptLoader.indexOf("function-plot-native.js") < pptLoader.indexOf("ribbon-ppt.js"));
}

{
  const { context, alerts } = createContext({}, []);
  context.window.MathFunctionDocument = {
    getSelectedPlotConfig() { return { curves: [{}], options: {} }; }
  };
  assert.equal(context.MathFunctionPlot.openQuickWriter({}), false);
  assert(alerts.some(message => message.includes("旧图已保留")));
}

for (const extra of [{ parameters: { a: { value: 1 } } }, { guides: [{ axis: "x", expression: "1" }] }, { analysis: { tangent: { curve: 0, x: "1" } } }]) {
  const { context, alerts } = createContext({}, []);
  context.window.MathFunctionDocument = {
    getSelectedPlotConfig() { return { ...extra, options: {} }; }
  };
  assert.equal(context.MathFunctionPlot.openQuickWriter({}), false);
  assert(alerts.some(message => message.includes("旧图已保留")));
}

console.log("native function plot tests passed");
