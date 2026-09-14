const assert = require("assert");
const configApi = require("../js/plot-config.js");
const plotter = require("../js/plotter.js");
const analysisApi = require("../js/plot-analysis.js");
const documents = require("../js/function-plot-document.js");
const library = require("../js/plot-library.js");
const bounds = { xMin: -5, xMax: 5, yMin: -5, yMax: 8 };
const domain = configApi.normalizeCurve({}, 0);
function curve(expression, override) {
  return { evaluate: plotter.compileExpression(expression), index: 0, curve: override ? configApi.normalizeCurve(override, 0) : domain };
}
function roots(a, b, min = -5, max = 5, firstDomain, secondDomain) {
  return analysisApi.findIntersections(curve(a, firstDomain), curve(b, secondDomain), min, max);
}
function near(actual, expected, tolerance = 1e-6) {
  assert(Math.abs(actual - expected) <= tolerance, actual + " is not near " + expected);
}
let result = roots("x^2", "1");
assert.equal(result.points.length, 2);
near(result.points[0].x, -1);
near(result.points[1].x, 1);
result = roots("sin(x)", "0", -7, 7);
assert.equal(result.points.length, 5);
result.points.forEach((point, index) => near(point.x, (index - 2) * Math.PI));
for (let i = 1; i <= 16; i += 1) {
  const left = -4.7 + i * 0.1;
  const right = 0.1 + i * 0.2;
  const polynomial = "(x-(" + left + "))*(x-(" + right + "))";
  const found = roots(polynomial, "0");
  assert.equal(found.points.length, 2);
  near(found.points[0].x, left);
  near(found.points[1].x, right);
}
result = roots("(x-0.123)^2", "0");
assert.equal(result.points.length, 1, "isolated same-sign tangent intersection");
near(result.points[0].x, 0.123);
for (const expression of ["1/(x-0.123)", "(x-0.123)^2+1e-12", "1e-12", "exp(x)"]) {
  assert.equal(roots(expression, "0").points.length, 0, expression + " must not produce fake zeroes");
}
assert.equal(roots("sign(x-0.123)", "0").points.length, 0);
assert.equal(roots("1e-12*sign(x-0.123)", "0").points.length, 0, "tiny jumps are still discontinuous");
assert.equal(roots("1e-30*sign(x)", "0").points.length, 0, "exact isolated value at a tiny jump is not continuous");
result = roots("tan(x)", "0", -5, 5);
assert.equal(result.points.length, 3, "tan poles are not roots");
[-Math.PI, 0, Math.PI].forEach((value, index) => near(result.points[index].x, value));
assert(roots("x", "x").message.includes("重合"));
assert.equal(roots("x", "x").points.length, 0);
assert.equal(roots("floor(x)", "0").points.length, 0, "zero interval is not isolated points");
result = roots("sin(50*x)", "0");
assert.equal(result.points.length, 20);
assert(result.truncated);
assert.throws(() => roots("2+sin(1000*x)", "0"), /过于密集/);
assert.equal(roots("x", "0", -5, 5, { domain: { min: 0, minClosed: false } }).points.length, 0);
assert.equal(roots("x", "0", -5, 5, { domain: { min: 0, minClosed: true } }).points.length, 1);
result = roots("x", "0", -5, 5, { domain: { max: 0 } }, { domain: { min: 0 } });
assert.equal(result.points.length, 1, "closed domains can intersect at a single common endpoint");
assert(roots("x", "0", -5, 5, { domain: { max: -1 } }, { domain: { min: 1 } }).message.includes("共同定义域"));
const derivativeCases = [["x^2", 2, 4], ["sin(x)", 0, 1], ["cos(x)", 0, 0], ["ln(x)", 1, 1],
  ["exp(x)", 0, 1], ["2x+3", -2, 2], ["3", 2, 0], ["abs(x)", -1, -1], ["x^3", 0, 0]];
derivativeCases.forEach(([expression, x, slope]) => {
  const tangent = analysisApi.tangentAt(curve(expression), x);
  near(tangent.slope, slope, 1e-5);
  near(tangent.y, plotter.evaluateExpression(expression, x));
});
for (const [expression, x] of [["abs(x)", 0], ["1e-12*abs(x)", 0], ["1e-12*floor(x)", 0], ["1/x", 0], ["sqrt(x)", 0], ["floor(x)", 0], ["sign(x)", 0], ["tan(x)", Math.PI / 2]]) {
  assert.throws(() => analysisApi.tangentAt(curve(expression), x), /有限|可靠|切点/);
}
assert.throws(() => analysisApi.tangentAt(curve("x^2", { domain: { min: 0 } }), 0), /内部/);

const config = { expressions: ["ax^2", "1"], bounds, parameters: configApi.normalizeParameters({}),
  analysis: { intersection: { first: 0, second: 1 }, tangent: { curve: 0, x: "a" } } };
const graph = plotter.generateConfigSvg(config);
assert.equal(graph.analysis.points.length, 2);
near(graph.analysis.tangent.slope, 2, 1e-5);
assert(graph.svg.includes('data-tangent="true"'));
assert.equal((graph.svg.match(/data-analysis-point="intersection"/g) || []).length, 2);
assert(graph.svg.includes('data-analysis-point="tangent"'));
assert(graph.svg.includes('data-tangent-label="true"'));
const offscreen = plotter.generateConfigSvg({ ...config, bounds: { ...bounds, yMax: 0.5 } });
assert.equal(offscreen.analysis.points.length, 2);
assert.equal((offscreen.svg.match(/data-analysis-point="intersection"/g) || []).length, 0, "offscreen intersections remain in results only");
const changed = JSON.parse(JSON.stringify(config));
changed.parameters.a.value = 2;
const changedGraph = plotter.generateConfigSvg(changed);
near(changedGraph.analysis.points[0].x, -Math.sqrt(0.5));
near(changedGraph.analysis.tangent.x, 2);
near(changedGraph.analysis.tangent.slope, 8, 1e-4);
assert.notEqual(graph.svg, changedGraph.svg);
const hidden = { ...config, curves: [{ visible: false }, {}] };
assert.throws(() => plotter.generateConfigSvg(hidden), /未显示/);
assert.throws(() => configApi.normalizeConfig({ ...config, analysis: { tangent: { curve: 4, x: "1" } } }), /不存在/);
assert.throws(() => configApi.normalizeConfig({ ...config, analysis: { intersection: { first: 0, second: 0 } } }), /不同/);
assert.throws(() => configApi.normalizeConfig({ ...config, analysis: { intersection: { first: 0, second: 1, min: 5, max: 4 } } }), /右端/);
assert.throws(() => plotter.generateConfigSvg({ ...config, analysis: { tangent: { curve: 0, x: "x+1" } } }), /不能含/);
const aligned = configApi.normalizeConfig({ expressions: ["", "x", "1"], bounds,
  analysis: { intersection: { first: 1, second: 2 }, tangent: { curve: 1, x: "0" } } });
assert.equal(aligned.analysis.intersection.first, 0);
assert.equal(aligned.analysis.intersection.second, 1);
assert.equal(aligned.analysis.tangent.curve, 0);
const serialized = documents.serializeMetadata(config);
assert(serialized.includes("HSM_FUNCTION_PLOT_V4:"));
assert.deepEqual(documents.parseMetadata(serialized), configApi.normalizeConfig(config));
assert(!configApi.normalizeConfig({ ...config, analysis: {} }).analysis);
const data = new Map();
const store = library.create({ getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) });
store.save("交点与切线", config);
const backup = store.exportText();
assert.equal(JSON.parse(backup).version, 2);
assert.equal(store.importText(backup), 0);
assert.deepEqual(store.list()[0].config, configApi.normalizeConfig(config));
const legacyStore = library.create({ getItem: () => null, setItem() {} });
assert.equal(JSON.parse(legacyStore.exportText()).version, 1);
console.log("intersection, tangent, discontinuities, domains, parameters and V4/V2 persistence tests passed");
