const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const projectRoot = path.join(__dirname, "..");
const panelSource = fs.readFileSync(path.join(projectRoot, "ui", "function-plot.js"), "utf8");

const nodes = {
  editModeBadge: { textContent: "", className: "" },
  insertButton: { textContent: "" }
};
let selectedPlot = { host: "presentation", config: { expressions: ["x^2"] } };
let intervalCallback = null;
let intervalDelay = null;
let stopped = null;

const document = {
  getElementById(id) {
    return nodes[id] || null;
  },
  querySelectorAll() {
    return [];
  }
};

const window = {
  Application: { ActivePresentation: {} },
  MathFunctionDocument: {
    getSelectedPlot() {
      return selectedPlot;
    }
  },
  MathFunctionPlotPanel: {},
  addEventListener() {},
  setInterval(callback, delay) {
    intervalCallback = callback;
    intervalDelay = delay;
    return 17;
  },
  clearInterval(id) { stopped = id; }
};

vm.runInNewContext(panelSource, {
  window,
  document,
  FunctionPlotter: {},
  Date,
  Math,
  console
});

assert.equal(typeof window.MathFunctionPlotPanel.synchronizeSelection, "function");
assert.equal(typeof window.MathFunctionPlotPanel.startSelectionMonitor, "function");

window.MathFunctionPlotPanel.startSelectionMonitor();
assert.equal(intervalDelay, 250);
assert.equal(typeof intervalCallback, "function");
assert.equal(window.MathFunctionPlotPanel.isEditingSelectedPlot(), true);
assert.equal(nodes.editModeBadge.textContent, "编辑所选图像");
assert.equal(nodes.editModeBadge.className, "mode-badge editing");
assert.equal(nodes.insertButton.textContent, "更新所选图像");

selectedPlot = null;
intervalCallback();
assert.equal(window.MathFunctionPlotPanel.isEditingSelectedPlot(), false);
assert.equal(nodes.editModeBadge.textContent, "新建图像");
assert.equal(nodes.editModeBadge.className, "mode-badge");
assert.equal(nodes.insertButton.textContent, "插入新图像");

selectedPlot = { host: "writer", config: { expressions: ["sin(x)"] } };
intervalCallback();
assert.equal(window.MathFunctionPlotPanel.isEditingSelectedPlot(), true);
assert.equal(nodes.insertButton.textContent, "更新所选图像");

window.MathFunctionPlotPanel.setVisible(false);
assert.equal(stopped, 17);
window.MathFunctionPlotPanel.setVisible(true);
assert.equal(window.MathFunctionPlotPanel.isEditingSelectedPlot(), true);

console.log("function plot selection-mode synchronization tests passed");
