const assert = require("assert");
const configApi = require("../js/plot-config.js");
const plotter = require("../js/plotter.js");
const documents = require("../js/function-plot-document.js");
const bounds = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 };
const options = { showLegend: false };
const normalize = input => configApi.normalizeConfig(Object.assign({ expressions: ["x"], bounds }, input));

assert.deepStrictEqual(normalize({}).expressions, ["x"]);
assert.throws(() => normalize({ expressions: Array(13).fill("x") }), /最多支持/);
assert.throws(() => normalize({ curves: [] }), /数量不一致/);
assert.throws(() => normalize({ curves: [{ domain: { min: 2, max: 1 } }] }), /第 1 条函数.*定义域/);
assert.throws(() => normalize({ curves: [{ color: '#fff" onload="bad' }] }), /颜色无效/);
assert.throws(() => normalize({ bounds: { ...bounds, xMin: "" } }), /不能为空/);
assert.throws(() => normalize({ bounds: { ...bounds, xMin: 1e20 } }), /十亿/);
assert.throws(() => normalize({ bounds: { ...bounds, xMin: 0, xMax: 1e-15 } }), /范围无效/);
assert.throws(() => normalize({ points: [{ label: "A", x: "", y: 2 }] }), /不能为空/);
assert.throws(() => plotter.generatePlotSvg(["x", "unknown(x)"], bounds), /第 2 条函数/);
assert.throws(() => plotter.compileExpression("constructor(x)"), /不支持/);
assert.throws(() => plotter.generatePlotSvg(["sin(1000000*x)"], bounds), /变化过于密集/);

const curves = [
  { color: "#dc2626", lineStyle: "dashed", domain: { max: 0, maxClosed: false } },
  { color: "#059669", lineStyle: "dotted", domain: { min: 0, minClosed: true } }
];
const config = normalize({
  expressions: ["x^2", "x+1"],
  curves, points: [{ label: "A", x: 0, y: 1 }],
  options: { monochrome: true }
});
const encoded = documents.serializeMetadata(config);
assert(encoded.includes("HSM_FUNCTION_PLOT_V2:"));
assert.deepStrictEqual(documents.parseMetadata(encoded), config, "V2 must round-trip every curve and point");
const old = { expressions: ["x"], bounds, options: { showTickLabels: true, showGrid: true, showBorder: true, showLegend: true } };
const oldMetadata = "函数图像：x\nHSM_FUNCTION_PLOT_V1:" + encodeURIComponent(JSON.stringify(old));
assert.deepStrictEqual(documents.parseMetadata(oldMetadata), old, "V1 remains readable without silent new fields");
assert.equal(documents.parseMetadata("HSM_FUNCTION_PLOT_V2:%invalid"), null);

const plot = plotter.generatePlotSvg(config.expressions, bounds, options, curves, config.points);
assert(plot.svg.includes('data-endpoint="open"'));
assert(plot.svg.includes('data-endpoint="closed"'));
assert(plot.svg.includes('stroke="#dc2626" stroke-dasharray="9 5"'));
assert(plot.svg.includes('stroke="#059669" stroke-dasharray="2 5"'));
assert(plot.svg.includes('data-point="true"'));
const paths = svg => Array.from(svg.matchAll(/<path data-curve="(\d+)" d="([^"]+)"/g), match => ({
  index: Number(match[1]),
  points: Array.from(match[2].matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g), value => [Number(value[1]), Number(value[2])])
}));
const px = x => 62 + (x + 10) / 20 * (720 - 62 - 24);
for (const segment of paths(plot.svg)) {
  assert(segment.points.every(point => segment.index === 0 ? point[0] <= px(0) + 0.01 : point[0] >= px(0) - 0.01));
}
const mono = plotter.generatePlotSvg(config.expressions, bounds, { monochrome: true }, curves);
assert(mono.svg.includes('stroke="#111111"'));
assert(mono.svg.includes('stroke-dasharray="9 5"'));
assert(!mono.svg.includes("#dc2626") && !mono.svg.includes("#059669"));
assert(mono.svg.includes("x∈"), "legend includes the curve domain");
const hidden = plotter.generatePlotSvg(["unknown(x)", "x"], bounds, options, [{ visible: false }, {}]);
assert(paths(hidden.svg).every(segment => segment.index === 1));
assert.throws(() => plotter.generatePlotSvg(["x"], bounds, {}, [{ visible: false }]), /至少显示/);
const escaped = plotter.generatePlotSvg(["x"], bounds, options, undefined, [{ label: "<script>&", x: 0, y: 0 }]);
assert(escaped.svg.includes("&lt;script&gt;&amp;"));
assert(!escaped.svg.includes("<script>"));

// A pole between sample points must never be joined by a visible segment.
for (const [expression, pole] of [["1/(x-0.12345)", 0.12345], ["tan(x)", Math.PI / 2]]) {
  const polePlot = plotter.generatePlotSvg([expression], bounds, options);
  assert(!/NaN|Infinity/.test(polePlot.svg));
  assert(paths(polePlot.svg).length > 1);
  for (const segment of paths(polePlot.svg)) {
    const xs = segment.points.map(point => point[0]);
    assert(!(Math.min(...xs) < px(pole) - 0.02 && Math.max(...xs) > px(pole) + 0.02), expression + " must break at its pole");
  }
}
assert(paths(plotter.generatePlotSvg(["x^2"], bounds, options).svg).length === 1, "continuous curve remains continuous");
const blankAligned = normalize({ expressions: ["", "x"], curves: [{ color: "#dc2626" }, { color: "#059669" }] });
assert.equal(blankAligned.curves[0].color, "#059669", "blank rows cannot shift another curve's styling");

function writerFixture(failure) {
  const calls = [];
  const previous = {
    Range: { Start: 8, End: 9 }, Width: 300, Height: 200,
    AlternativeText: documents.serializeMetadata(old),
    Delete() { calls.push("delete-old"); if (failure === "delete") { throw Error("locked"); } this.deleted = true; }
  };
  const created = {
    Range: { Start: 8, End: 9 }, Height: 200,
    Delete() { calls.push("delete-new"); this.deleted = true; }
  };
  if (failure === "metadata") {
    Object.defineProperty(created, "AlternativeText", { set() { throw Error("readonly"); } });
  }
  const selection = {
    Range: { Start: 8, End: 9 },
    InlineShapes: { Count: 1, Item() { return previous; } },
    SetRange() {}
  };
  const app = {
    Selection: selection,
    ActiveDocument: {
      Range(start, end) { calls.push(["range", start, end]); return { Start: start, End: end }; },
      InlineShapes: {
        Count: 1, Item() { return previous; },
        AddPicture(file, link, save, range) {
          calls.push("add");
          assert.equal(range.Start, range.End, "insertion must not replace the selected text implicitly");
          if (failure === "insert") { throw Error("disk failure"); }
          return created;
        }
      }
    }
  };
  return { app, calls, previous, created };
}
for (const failure of ["insert", "metadata"]) {
  const fixture = writerFixture(failure);
  assert.throws(() => documents.insertOrUpdate(fixture.app, "plot.svg", plot, config));
  assert(!fixture.previous.deleted, "old picture survives " + failure);
  if (failure === "metadata") { assert(fixture.created.deleted); }
}
{
  const fixture = writerFixture();
  const result = documents.insertOrUpdate(fixture.app, "plot.svg", plot, config);
  assert(result.updated);
  assert(fixture.calls.indexOf("add") < fixture.calls.indexOf("delete-old"));
  assert.equal(fixture.created.Width, 300);
}
{
  const fixture = writerFixture("delete");
  assert.throws(() => documents.insertOrUpdate(fixture.app, "plot.svg", plot, config), /已保留新图/);
  assert(!fixture.created.deleted, "uncertain host deletion must not trigger deletion of the verified new copy");
}
{
  const fixture = writerFixture();
  fixture.app.Selection.Range = { Start: 4, End: 12, Text: "保留正文与原图" };
  const result = documents.insertOrUpdate(fixture.app, "plot.svg", plot, config);
  assert.equal(result.updated, false, "a text range containing a plot is not a plot selection");
  assert.equal(fixture.app.Selection.Range.Text, "保留正文与原图");
  assert(!fixture.previous.deleted);
}
{
  let removed = false;
  const shape = { AlternativeText: documents.serializeMetadata(old), Delete() { removed = true; } };
  const slide = { Shapes: { AddPicture() { throw Error("insertion failed"); } } };
  const app = {
    ActivePresentation: {},
    ActiveWindow: { View: { Slide: slide }, Selection: { ShapeRange: { Count: 1, Item() { return shape; } } } }
  };
  assert.throws(() => documents.insertOrUpdate(app, "plot.svg", plot, config), /insertion failed/);
  assert(!removed, "PPT insertion failure preserves old picture");
}

{
  const v3 = { ...config, parameters: configApi.normalizeParameters({}), guides: [{ axis: "x", expression: "a" }] };
  const v4 = { ...v3, analysis: { tangent: { curve: 0, x: "1" } } };
  for (const stored of [v3, v4]) {
    for (const failure of [undefined, "insert", "metadata"]) {
      const fixture = writerFixture(failure);
      fixture.previous.AlternativeText = documents.serializeMetadata(stored);
      assert.deepEqual(documents.getSelectedPlot(fixture.app).config, configApi.normalizeConfig(stored));
      if (failure) {
        assert.throws(() => documents.insertOrUpdate(fixture.app, "plot.svg", plot, stored));
        assert(!fixture.previous.deleted);
      } else {
        const result = documents.insertOrUpdate(fixture.app, "plot.svg", plot, stored);
        assert(result.updated);
        assert.deepEqual(documents.parseMetadata(result.shape.AlternativeText), configApi.normalizeConfig(stored));
      }
    }
  }
}

console.log("enhanced plotting: domains, styles, points, discontinuities, metadata and safe replacement passed");
