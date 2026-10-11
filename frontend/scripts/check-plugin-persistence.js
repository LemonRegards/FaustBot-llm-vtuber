#!/usr/bin/env node
/**
 * 配置中心「统一保存」能力检查（window.pluginUI.registerPersistence）。
 *
 * 从 frontend/config-window.js 里**抽取真实代码块**（不需要 DOM / 浏览器）执行：
 *   - pluginUI 对象块（registerPersistence / setDirty / clearDirty / dropPersistenceExcept …）
 *   - refreshPluginDirtyUI()
 *   - runPluginPersistence()（保存/应用/重新加载的实际分发）
 * 然后断言：注册去重、dirty 记账、离开页面自动注销、失败收集、阶段过滤。
 *
 * 用法: node scripts/check-plugin-persistence.js
 * （随 npm run check-js 之外的独立脚本，见 package.json 的 check-persistence）
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = path.resolve(__dirname, '..', 'config-window.js');
const src = fs.readFileSync(SRC, 'utf8');

function slice(from, to) {
  const start = src.indexOf(from);
  if (start < 0) throw new Error(`config-window.js 里找不到起点: ${from}`);
  const end = src.indexOf(to, start);
  if (end < 0) throw new Error(`config-window.js 里找不到终点: ${to}`);
  return src.slice(start, end);
}

const pluginUiBlock = slice('if (!window.pluginUI) {', '// ── 插件持久化钩子的分发');
const refreshBlock = slice('function refreshPluginDirtyUI() {', '/// 依次执行插件注册的');
const dispatchBlock = slice('async function runPluginPersistence(phase) {', 'function pluginFailuresText');

let badgeRefreshes = 0;
const loggedErrors = [];
const sandbox = {
  window: {},
  document: { createElement: () => ({ style: {}, setAttribute() {}, addEventListener() {} }) },
  MODULES: [],
  renderNav() {},
  refreshDirtyUI() { badgeRefreshes += 1; },   // 配置中心右上角 dirty 徽标
  URLSearchParams,
  // 分发器会用 console.error 记录失败插件；测试里收集起来，别把预期失败刷到终端
  console: { log: console.log, warn: console.warn, error: (...args) => loggedErrors.push(args) },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext([pluginUiBlock, refreshBlock, dispatchBlock].join('\n'), sandbox);

const api = sandbox.window.pluginUI;
const runPluginPersistence = sandbox.runPluginPersistence;
assert.ok(api && typeof api.registerPersistence === 'function', 'pluginUI.registerPersistence 应存在');
assert.ok(typeof runPluginPersistence === 'function', 'runPluginPersistence 应存在');

let passed = 0;
// vm 里返回的数组/对象属于另一个 realm，先转成本 realm 的普通值再比较
const plain = (value) => JSON.parse(JSON.stringify(value));
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  OK  ${name}`);
}
async function checkAsync(name, fn) {
  await fn();
  passed += 1;
  console.log(`  OK  ${name}`);
}

(async () => {
  console.log('检查配置中心统一保存（pluginUI.registerPersistence）...\n');

  check('重复注册同一 plugin+module 应替换而不是追加', () => {
    api.registerPersistence({ plugin: 'dup', save: async () => {} });
    api.registerPersistence({ plugin: 'dup', module: 'dup', save: async () => {} });
    assert.strictEqual(api._persist.filter((x) => x.plugin === 'dup').length, 1);
    assert.strictEqual(api._persist[0]._key, 'dup::dup');
  });

  check('缺少 plugin 应直接抛错（不静默注册）', () => {
    assert.throws(() => api.registerPersistence({ save() {} }), /缺少 plugin/);
  });

  check('setDirty 记账并触发 dirty 徽标刷新', () => {
    const before = badgeRefreshes;
    const handle = api.registerPersistence({ plugin: 'dirty-a', save: async () => {} });
    assert.strictEqual(api.dirtyCount(), 0);
    handle.setDirty(true);
    assert.strictEqual(api.dirtyCount(), 1);
    assert.strictEqual(api.isPluginDirty('dirty-a'), true);
    handle.setDirty(false);
    assert.strictEqual(api.dirtyCount(), 0);
    assert.ok(badgeRefreshes > before);
  });

  check('离开页面（dropPersistenceExcept）注销钩子并清掉 dirty', () => {
    const handle = api.registerPersistence({ plugin: 'page-a', module: 'page-a', save: async () => {} });
    handle.setDirty(true);
    assert.strictEqual(api.dirtyCount(), 1);
    api.dropPersistenceExcept('other-page');
    assert.strictEqual(api._persist.some((x) => x.module === 'page-a'), false);
    assert.strictEqual(api.dirtyCount(), 0);
  });

  check('同一插件还有其它页面注册时，注销一个页面不误清 dirty', () => {
    const first = api.registerPersistence({ plugin: 'multi', module: 'm1', save: async () => {} });
    api.registerPersistence({ plugin: 'multi', module: 'm2', save: async () => {} });
    first.setDirty(true);
    api.dropPersistenceExcept('m1');
    assert.strictEqual(api._persist.filter((x) => x.plugin === 'multi').length, 1);
    assert.strictEqual(api.dirtyCount(), 1);
    api.resetPersistence();
    assert.strictEqual(api.dirtyCount(), 0);
  });

  check('clearDirty 只清保存成功的插件，失败的保持 dirty 以便重试', () => {
    api.registerPersistence({ plugin: 'ok-plugin', save: async () => {} }).setDirty(true);
    api.registerPersistence({ plugin: 'bad-plugin', save: async () => {} }).setDirty(true);
    api.clearDirty(['bad-plugin']);
    assert.strictEqual(api.isPluginDirty('bad-plugin'), true);
    assert.strictEqual(api.isPluginDirty('ok-plugin'), false);
    assert.strictEqual(api.dirtyCount(), 1);
    api.resetPersistence();
  });

  await checkAsync('分发只触发注册了该阶段的插件，并把 dirty 透传', async () => {
    const seen = [];
    api.resetPersistence();
    api.registerPersistence({ plugin: 's1', save: async (ctx) => { seen.push([ctx.plugin, ctx.phase, ctx.dirty]); } });
    api.registerPersistence({ plugin: 's2', apply: async (ctx) => { seen.push([ctx.plugin, ctx.phase]); } });
    api.registerPersistence({ plugin: 's3' });   // 未注册任何阶段
    api._persistDirty.add('s1');

    assert.deepStrictEqual(plain(await runPluginPersistence('save')), []);
    assert.deepStrictEqual(seen, [['s1', 'save', true]]);

    seen.length = 0;
    assert.deepStrictEqual(plain(await runPluginPersistence('apply')), []);
    assert.deepStrictEqual(seen, [['s2', 'apply']]);

    seen.length = 0;
    assert.deepStrictEqual(plain(await runPluginPersistence('reload')), []);
    assert.deepStrictEqual(seen, [], '没人注册 reload 时不应触发任何插件');
  });

  await checkAsync('处理器抛错按插件收集为失败，不吞掉也不影响其它插件', async () => {
    api.resetPersistence();
    const seen = [];
    api.registerPersistence({ plugin: 'good', save: async () => { seen.push('good'); } });
    api.registerPersistence({ plugin: 'broken', save: async () => { throw new Error('boom'); } });
    const failures = await runPluginPersistence('save');
    assert.deepStrictEqual(seen, ['good']);
    assert.deepStrictEqual(plain(failures), [{ plugin: 'broken', error: 'boom' }]);
    assert.ok(loggedErrors.length > 0, '失败插件应被记录（console.error），不是静默吞掉');
    api.resetPersistence();
  });

  console.log(`\n${passed} 项检查全部通过 ✓`);
})().catch((err) => {
  console.error(`\nFAIL  ${err && err.message ? err.message : err}`);
  process.exit(1);
});
