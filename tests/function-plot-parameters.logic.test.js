const assert = require("assert");
const configApi = require("../js/plot-config.js");
const plotter = require("../js/plotter.js");
const documentApi = require("../js/function-plot-document.js");
const bounds = { xMin: -5, xMax: 5, yMin: -5, yMax: 5 };
const parameters = configApi.normalizeParameters({});
const config = {
  expressions: ["ax^2+bx+c"], bounds,
  parameters: { ...parameters, a: { value: 2, min: -5, max: 5, step: 0.3 } },
  guides: [{ axis: "x", expression: "-b/(2*a)" }, { axis: "y", expression: "c" }]
};
assert.equal(plotter.evaluateExpression("ax²+bx+c", 3, { a: 2, b: -3, c: 1 }), 10);
assert.equal(plotter.evaluateExpression("abcx+2a(x+1)", 2, { a: 2, b: 3, c: 4 }), 60);
assert.equal(plotter.evaluateExpression("1e3*x", 2), 2000);
assert.equal(plotter.evaluateExpression("a*sin(b*x)+c", 0, { a: 2, b: 3, c: 4 }), 4);
assert.equal(plotter.evaluateExpression("A*X+B", 2, { a: 2, b: 3 }), 7);
assert.throws(() => plotter.compileExpression("ax^2"), /参数 a/);
assert.throws(() => plotter.compileExpression("asinx"), /不支持/);
assert.throws(() => plotter.compileExpression("constructor(x)", { a: 2 }), /不支持/);
assert.throws(() => plotter.compileExpression("a", { a: "2" }), /参数/);
const captured = { a: 2 };
const fn = plotter.compileExpression("ax", captured);
captured.a = 8;
assert.equal(fn(3), 6, "each render must capture its parameter values");
assert.deepEqual(fn.usedParameters, ["a"]);
assert.equal(fn.usesX, true);
for (const patch of [
  { min: 5, max: 5 }, { step: 0 }, { step: -1 }, { step: 11 }, { step: 1e-9 },
  { value: 6 }, { value: "" }, { value: Infinity }, { value: false }, { value: [] }
]) {
  assert.throws(() => configApi.normalizeParameters({ a: { ...parameters.a, ...patch } }), /参数/);
}
assert.throws(() => configApi.normalizeParameters({ d: parameters.a }), /a、b、c/);
assert.throws(() => configApi.normalizeParameters([]), /参数/);
assert.equal(configApi.normalizeParameters({ a: { ...parameters.a, value: 0.123456789 } }).a.value, 0.123456789);

const normalized = configApi.normalizeConfig(config);
const metadata = documentApi.serializeMetadata(config);
assert(metadata.includes(documentApi.METADATA_PREFIX_V3));
assert.deepEqual(documentApi.parseMetadata(metadata), normalized);
const legacy = { expressions: ["x"], bounds };
assert(documentApi.serializeMetadata(legacy).includes(documentApi.METADATA_PREFIX));
assert(documentApi.serializeMetadata({ ...legacy, points: [] }).includes(documentApi.METADATA_PREFIX_V2));
assert(!documentApi.parseMetadata(documentApi.serializeMetadata(legacy)).parameters);
assert.equal(documentApi.parseMetadata("HSM_FUNCTION_PLOT_V3:%not-json"), null);
const invalidV3 = "HSM_FUNCTION_PLOT_V3:" + encodeURIComponent(JSON.stringify({ ...config, parameters: { a: { value: 2 } } }));
assert.equal(documentApi.parseMetadata(invalidV3), null);

const parametric = plotter.generateConfigSvg({ ...config, guides: [], options: { showLegend: false } });
const numeric = plotter.generatePlotSvg(["2*x^2"], bounds, { showLegend: false });
const paths = svg => [...svg.matchAll(/<path data-curve="\d+" d="([^"]+)"/g)].map(match => match[1]);
assert.deepEqual(paths(parametric.svg), paths(numeric.svg), "parameter rendering equals fixed numerical formula");
const graph = plotter.generateConfigSvg(config);
assert(graph.svg.includes('data-parameters="true"'));
assert(graph.svg.includes("a=2，b=0，c=0"));
assert.equal((graph.svg.match(/<line data-guide=/g) || []).length, 2);
const outside = plotter.generateConfigSvg({ ...config, guides: [{ axis: "x", expression: "10" }] });
assert(!outside.svg.includes("<line data-guide="));
const vertical = plotter.generateConfigSvg({ ...config, guides: [{ axis: "x", expression: "2" }] });
const coords = vertical.svg.match(/<line data-guide="0" x1="([^"]+)" y1="[^"]+" x2="([^"]+)"/);
assert.equal(Number(coords[1]), 505.8);
assert.equal(coords[1], coords[2], "vertical guide has constant x");
assert(plotter.generateConfigSvg({ ...config, guides: [{ axis: "x", expression: "1/3" }] }).svg.includes("≈0.33333333"));
const mono = plotter.generateConfigSvg({ ...config, options: { monochrome: true } });
assert(!mono.svg.includes("#475569"));
for (const guide of [
  { axis: "x", expression: "x+1" }, { axis: "y", expression: "1/0" },
  { axis: "x", expression: "sqrt(-1)" }, { axis: "y", expression: "<script>" },
  { axis: "z", expression: "1" }, { axis: "x", expression: "" }
]) {
  assert.throws(() => plotter.generateConfigSvg({ ...config, guides: [guide] }), /辅助线/);
}
assert.throws(() => plotter.generateConfigSvg({ ...config, guides: Array(21).fill({ axis: "x", expression: "0" }) }), /20/);
const zeroA = { ...config.parameters, a: { ...parameters.a, value: 0 } };
assert.throws(() => plotter.generateConfigSvg({ ...config, parameters: zeroA }), /第 1 条辅助线/);
console.log("parameter plotting, slider validation, guide bounds and V1/V2/V3 metadata passed");
