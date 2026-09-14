const assert = require("assert");
const library = require("../js/plot-library.js");
const configApi = require("../js/plot-config.js");
const config = {
  ...configApi.getDefaultConfig(), expressions: ["ax^2+bx+c"],
  parameters: configApi.normalizeParameters({}), guides: [{ axis: "x", expression: "a" }]
};
function storage() {
  const data = new Map();
  return { data, getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
}
const backend = storage();
const store = library.create(backend);
assert.deepEqual(store.list(), []);
const one = store.save("抛物线 <课堂>", config);
assert.deepEqual(library.create(backend).list()[0].config, configApi.normalizeConfig(config));
store.list()[0].config.parameters.a.value = 99;
assert.equal(store.list()[0].config.parameters.a.value, 1, "read results are isolated");
assert.throws(() => store.save(one.name, config), /同名/);
assert.throws(() => store.save("", config), /名称/);
assert.throws(() => store.save("bad", { ...config, expressions: ["unknown(x)"] }), /不支持/);
assert.throws(() => store.save("bad", { ...config, guides: [{ axis: "x", expression: "x" }] }), /辅助线/);
const text = store.exportText();
assert.equal(store.importText(text), 0);
const imported = JSON.parse(text);
imported.items[0].config.expressions = ["x^3"];
assert.equal(store.importText(JSON.stringify(imported)), 1);
assert.equal(store.list().length, 2);
assert.notEqual(store.list()[0].id, store.list()[1].id);
assert(store.list()[1].name.includes("导入"));
assert.equal(store.importText(JSON.stringify(imported)), 0, "repeated conflicting import is idempotent");
assert.equal(store.list()[0].name, one.name);
const before = backend.getItem(library.KEY);
imported.items.push({ id: "bad", name: "不可用", config: { ...config, guides: [{ axis: "x", expression: "1/0" }] } });
assert.throws(() => store.importText(JSON.stringify(imported)), /辅助线/);
assert.equal(backend.getItem(library.KEY), before, "failed import must be all-or-nothing");
for (const bad of ["oops", "x".repeat(2000001), '{"version":3}', JSON.stringify({ ...JSON.parse(text), version: 3 })]) {
  assert.throws(() => store.importText(bad));
  assert.equal(backend.getItem(library.KEY), before);
}
store.remove(one.id);
assert.equal(store.list().length, 1);
store.recoverPrevious();
assert.equal(store.list().length, 2, "delete can be undone");
assert.throws(() => store.remove("missing"), /不存在/);

// First save can also be undone.
const fresh = library.create(storage());
fresh.save("首次", config);
fresh.recoverPrevious();
assert.equal(fresh.list().length, 0);

// Storage refusal cannot report success or silently use another backend.
const full = storage();
const failing = library.create(full);
failing.save("已有", config);
const original = full.getItem(library.KEY);
full.setItem = () => { throw new Error("QuotaExceededError"); };
assert.throws(() => failing.save("新增", config), /未能确认保存/);
assert.equal(full.getItem(library.KEY), original);
assert.throws(() => library.create(null).list(), /无法保存/);
assert.throws(() => library.create({ getItem() { throw new Error("blocked"); }, setItem() {} }).list(), /无法读取/);

// Read-back mismatch is surfaced; an intact previous library remains recoverable.
const damaged = storage();
const recoverable = library.create(damaged);
recoverable.save("已有", config);
const setter = damaged.setItem;
damaged.setItem = (key, value) => setter(key, key === library.KEY ? "truncated" : value);
assert.throws(() => recoverable.save("第二", config), /未能确认保存/);
assert.throws(() => recoverable.list(), /无法读取/);
assert.throws(() => recoverable.save("不能覆盖损坏收藏", config), /无法读取/);
damaged.setItem = setter;
recoverable.recoverPrevious();
assert.equal(recoverable.list()[0].name, "已有");

// A second editor's changes between the initial read and commit are detected.
const concurrent = storage();
const concurrentStore = library.create(concurrent);
let reads = 0;
concurrent.getItem = key => {
  if (key === library.KEY && ++reads === 2) { return text; }
  return null;
};
assert.throws(() => concurrentStore.save("race", config), /另一个窗口/);
assert.equal(concurrent.data.size, 0);

const many = library.create(storage());
for (let index = 0; index < 50; index++) { many.save("课堂 " + index, config); }
assert.throws(() => many.save("第51", config), /50/);
assert.throws(() => many.importText(text), /50/);
assert.equal(many.list().length, 50);
const primary = storage();
const secondary = storage();
library.forWindow({ Application: { PluginStorage: primary }, localStorage: secondary }).save("WPS", config);
assert(primary.getItem(library.KEY));
assert(!secondary.getItem(library.KEY));
library.forWindow({ localStorage: secondary }).save("浏览器", config);
assert(secondary.getItem(library.KEY));
console.log("plot library persistence, merge, undo, limits, corruption and storage failures passed");
