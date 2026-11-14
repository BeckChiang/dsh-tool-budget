// 纯函数测试：方案解析、建议集、成本公式、学习聚类、字典完整性。
// 不碰 Host 运行时，用 node test/test-model.mjs 跑。

import assert from 'node:assert/strict'

import { MODES, BudgetStore, resolveLevels, planHash, protectionOf, togglePack, normalizePacks, profileFromSession, BUILTIN_PACKS, CORE_ALWAYS , diffLevels } from '../lib/profiles.js'
import { sessionAdjustments, Learner } from '../lib/learning.js'
import { estimate, normalizeSettings, DEFAULT_SETTINGS, toolChars } from '../lib/cost.js'
import { clusterPacks } from '../lib/learning.js'
import { pluginOf, pluginLabel } from '../lib/classify.js'
import { KEYS, dictOf, makeT, normalizeLocale } from '../lib/i18n.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const catalog = [
  { name: 'read', group: 'fs', plugin: 'core' },
  { name: 'write', group: 'fs', plugin: 'core' },
  { name: 'pwsh', group: 'shell', plugin: 'core' },
  { name: 'web_search', group: 'web', plugin: 'dsh-free-search' },
  { name: 'ops_bash', group: 'toolchain', plugin: 'dsh-ops' },
  { name: 'present', group: 'session', plugin: 'dsh-image-gen' },
  { name: 'tool_budget', group: 'toolchain', plugin: 'dsh-tool-budget' },
  { name: 'mcp__rea__search', group: 'mcp:rea', plugin: 'mcp:rea' },
]

const packs = BUILTIN_PACKS.map((pack) => ({ ...pack, kind: 'builtin' }))

// 1. 默认状态：everything 包 → 全部 normal，核心工具不可被视为隐藏
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-model-'))
  const store = new BudgetStore({ dir })
  const session = store.session('s1')
  const { levels } = resolveLevels({ session, catalog, packs })
  for (const tool of catalog) assert.equal(levels.get(tool.name), 'normal', `${tool.name} 应为 normal`)
  assert.equal(protectionOf('tool_budget'), 'core')
  assert.equal(protectionOf('ops_bash'), 'protected')
  assert.equal(protectionOf('web_search'), null)
  fs.rmSync(dir, { recursive: true, force: true })
}

// 2. 切到 code 包：media/web 之外的工具被隐藏，但核心与显式覆盖优先
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-model-'))
  const store = new BudgetStore({ dir })
  store.patchSession('s1', { profileId: 'code', packs: ['code'] })
  const session = store.session('s1')
  const { levels } = resolveLevels({ session, catalog, packs })
  assert.equal(levels.get('mcp__rea__search'), 'hidden')
  assert.equal(levels.get('pwsh'), 'normal')
  // 组级覆盖
  store.patchSession('s1', { groupLevels: { fs: 'warn' } })
  const warn = resolveLevels({ session: store.session('s1'), catalog, packs })
  assert.equal(warn.levels.get('read'), 'warn')
  // 单个工具覆盖优先于组
  store.patchSession('s1', { levels: { read: 'hidden' } })
  const single = resolveLevels({ session: store.session('s1'), catalog, packs })
  assert.equal(single.levels.get('read'), 'hidden')
  // 但核心工具仍然被拉回 normal
  store.patchSession('s1', { levels: { present: 'hidden' } })
  const core = resolveLevels({ session: store.session('s1'), catalog, packs })
  assert.equal(core.levels.get('present'), 'normal')
  fs.rmSync(dir, { recursive: true, force: true })
}

// 3. 本轮学习（被拦下的恢复 / 没调用的休眠）+ 方案查重
{
  const levels = new Map(catalog.map((tool) => [tool.name, tool.group === 'web' ? 'hidden' : 'normal']))
  const groups = [
    { id: 'web', label: '网络检索', tools: ['web_search'] },
    { id: 'fs', label: '文件与检索', tools: ['read'] },
  ]
  const result = sessionAdjustments({ groups, calls: { web_search: 0, read: 3 }, blocked: { web_search: 2 }, levels, turns: 5, thresholdTurns: 3 })
  assert.ok(result.items.some((item) => item.kind === 'restore' && item.group === 'web'), '被拦下的组应建议恢复')
  assert.ok(!result.items.some((item) => item.group === 'fs'), '有调用的组不该建议休眠')
  const early = sessionAdjustments({ groups, calls: {}, blocked: {}, levels, turns: 2, thresholdTurns: 3 })
  assert.equal(early.ready, false, '不到轮次阈值不给建议')
  assert.equal(planHash(new Map([['a', 'normal'], ['b', 'hidden']])), 'b=hidden')
  assert.equal(planHash({ a: 'warn', b: 'normal' }), 'a=warn')
}

// 4. 成本公式：省 / 重付 / 回本
{
  const result = estimate({ hiddenChars: 3600, contextTokens: 100000, toolBlockTokens: 12000, avgTurnTokens: 8000, settings: DEFAULT_SETTINGS })
  assert.equal(result.savedTokens, 1000)
  assert.equal(result.netPerTurnTokens, 1000, '没有常驻开销时净省等于节省')
  assert.equal(result.repayTokens, 88000)
  assert.equal(result.breakevenTurns, 88)
  assert.equal(result.overThreshold, true, '88000 > 8000*2')
  const withOverhead = estimate({ hiddenChars: 3600, contextTokens: 100000, toolBlockTokens: 12000, avgTurnTokens: 8000, overheadTokens: 200, settings: DEFAULT_SETTINGS })
  assert.equal(withOverhead.overheadTokens, 200)
  assert.equal(withOverhead.netPerTurnTokens, 800, '模式常驻开销应从净省里扣掉')
  assert.equal(DEFAULT_SETTINGS.modeAutoOverhead, 200)
  assert.equal(withOverhead.projectedTurnTokens, 7200, '切换后每轮 = 现在 8000 − 省下 1000 + 常驻 200')
  assert.equal(result.projectedTurnTokens, 7000)
  // 场景包：全部保留是互斥的全开状态，选别的包就不再亮
  assert.deepEqual(togglePack(['everything'], 'core'), ['core'], '选核心包应摘掉全部保留')
  assert.deepEqual(togglePack(['core'], 'code'), ['core', 'code'], '多个包可以叠加')
  assert.deepEqual(togglePack(['core', 'code'], 'core'), ['code'], '再点一次取消该包')
  assert.deepEqual(togglePack(['core'], 'core'), ['everything'], '点掉最后一个包回到全部保留')
  assert.deepEqual(togglePack([], 'code'), ['code'])
  assert.deepEqual(togglePack(['core'], 'everything'), ['everything'], '点全部保留清空其它包')
  // 多选组合：union 语义
  const known = BUILTIN_PACKS.map((item) => item.id)
  assert.deepEqual(normalizePacks(['code', 'research'], known), ['code', 'research'], '多选应保留勾选顺序')
  assert.deepEqual(normalizePacks(['code', 'code'], known), ['code'], '重复勾选应去重')
  assert.deepEqual(normalizePacks(['code', 'nope'], known), ['code'], '未知包应被丢掉')
  assert.deepEqual(normalizePacks(['everything', 'code'], known), ['everything'], '全部保留与其它包互斥')
  assert.deepEqual(normalizePacks([], known), ['everything'], '一个都没选时回到全部保留')
  assert.deepEqual(normalizePacks(null, known), ['everything'], '空值也应回到全部保留')
  const settings = normalizeSettings({ charsPerToken: 0, missFactor: 3, thresholdMultiplier: 0 })
  assert.equal(settings.charsPerToken, 1, '越界参数应被夹回区间')
  assert.equal(settings.missFactor, 1)
  assert.equal(settings.thresholdMultiplier, 1)
  assert.ok(toolChars({ name: 'ab', description: 'cd', parameters: {} }) > 0)
}

// 4.5 方案：选包会清掉精细调整；存为方案要把精细调整一起存
{
  const catalog = [
    { name: 'read', group: 'fs', plugin: 'core' },
    { name: 'x_create', group: 'x:create', plugin: 'core' },
  ]
  const packs = [{ id: 'everything', groups: ['*'], plugins: [] }]
  const withOverride = { packs: ['everything'], groupLevels: { 'x:create': 'hidden' }, levels: {}, pluginLevels: {} }
  assert.equal(resolveLevels({ session: withOverride, catalog, packs }).levels.get('x_create'), 'hidden', '精细调整应覆盖包')
  const cleared = { packs: ['everything'], levels: {}, groupLevels: {}, pluginLevels: {} }
  assert.equal(resolveLevels({ session: cleared, catalog, packs }).levels.get('x_create'), 'normal', '选包清掉调整后应全开')
  const profile = profileFromSession(withOverride, { id: 'p1', name: '我的习惯' })
  assert.equal(profile.kind, 'manual')
  assert.equal(profile.groupLevels['x:create'], 'hidden', '存方案要把精细调整一起存')
  assert.deepEqual(profile.packs, ['everything'])
  const restored = resolveLevels({ session: { packs: profile.packs, levels: profile.levels, groupLevels: profile.groupLevels, pluginLevels: profile.pluginLevels }, catalog, packs })
  assert.equal(restored.levels.get('x_create'), 'hidden', '应用方案应带回精细调整')
}

// 5. 学习聚类：同一习惯的会话并簇，样本不足不产出
{
  const samples = []
  for (let index = 0; index < 5; index += 1) {
    samples.push({ groups: new Set(['fs', 'shell', 'web']) })
  }
  for (let index = 0; index < 5; index += 1) {
    samples.push({ groups: new Set(['media', 'session']) })
  }
  const labels = { fs: '文件', shell: '命令', web: '网页', media: '图像', session: '会话' }
  const packs = clusterPacks([...samples, { groups: new Set(['office']) }], (id) => labels[id] ?? id)
  assert.equal(packs.length, 2, '两个习惯应各成一包，单例不成包')
  const codePack = packs.find((pack) => pack.groups.includes('fs'))
  assert.ok(codePack !== undefined)
  assert.equal(codePack.kind, 'learned')
  assert.ok(codePack.source.sessions >= 4)
  assert.ok(codePack.source.confidence >= 0.6)
  assert.equal(codePack.name, '文件、命令、网页', '学习包名字要用组的中文名')
  assert.deepEqual(codePack.groupLabels, ['文件', '命令', '网页'])
}

// 6. 插件分类
{
  assert.equal(pluginOf('ops_bash').id, 'dsh-ops')
  assert.equal(pluginOf('mcp__rea__search').id, 'mcp:rea')
  assert.equal(pluginOf('read').id, 'core')
  assert.equal(pluginOf('generate_image').id, 'dsh-image-gen')
  assert.equal(pluginOf('weird_name').id, 'x:weird')
  assert.equal(pluginLabel('mcp:rea'), 'rea · MCP')
}

// 7. 字典：每个键两种语言都非空，且切换后文案真的变了
{
  assert.deepEqual(normalizeLocale('en-US'), 'en')
  assert.deepEqual(normalizeLocale('zh-TW'), 'zh-CN')
  for (const locale of ['zh-CN', 'en']) {
    const dict = dictOf(locale)
    for (const key of KEYS) {
      assert.equal(typeof dict[key], 'string', `${key} 在 ${locale} 下缺失`)
      assert.ok(dict[key].length > 0, `${key} 在 ${locale} 下为空`)
    }
  }
  assert.notEqual(makeT('en')('text.hidden'), makeT('zh-CN')('text.hidden'))
  assert.equal(makeT('en')('err.noMatch', { needle: 'x' }).includes('x'), true)
  assert.ok(CORE_ALWAYS.has('tool_budget'))
}

console.log('test-model: all assertions passed')

// 4.6 方案差异：与现在比，关掉几个、恢复几个
{
  const before = new Map([
    ['read', 'normal'],
    ['ops_bash', 'hidden'],
    ['never_used', 'normal'],
  ])
  const after = new Map([
    ['read', 'normal'],
    ['ops_bash', 'normal'],
    ['never_used', 'hidden'],
  ])
  const diff = diffLevels(before, after)
  assert.deepEqual(diff.hide, ['never_used'])
  assert.deepEqual(diff.show, ['ops_bash'])
  assert.equal(diff.same, false)
  assert.equal(diffLevels(before, before).same, true)
  assert.deepEqual(diffLevels(new Map(), new Map()), { hide: [], show: [], same: true })
  console.log('ok 4.6 plan diff')
}

// 4.7 三档模式：auto / ask / off（pin 已并入 ask）
{
  assert.deepEqual(MODES, ['auto', 'ask', 'off'])
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-modes-'))
  const store = new BudgetStore({ dir })
  assert.equal(store.modeOf('any'), 'ask', '默认是 ask')
  store.setPreferences({ mode: 'off' })
  assert.equal(store.modeOf('any'), 'off', '全局偏好可设为不使用')
  store.patchSession('s1', { mode: 'pin' })
  assert.equal(store.modeOf('s1'), 'ask', '旧的 pin 设置迁移到 ask')
  store.patchSession('s3', { mode: 'auto' })
  assert.equal(store.modeOf('s3'), 'auto', '会话可覆盖全局模式')
  assert.equal(store.modeOf('s2'), 'off', '其它会话仍用全局默认')
  console.log('ok 4.7 modes')
}

// 4.8 学习候选按工作区过滤
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-learn-'))
  const file = path.join(dir, 'learning.json')
  fs.writeFileSync(file, JSON.stringify({
    version: 2,
    status: 'ready',
    packs: [
      { id: 'a', name: 'A组', workspace: 'ws-a', groups: [], source: { sessions: 5, confidence: 0.9 } },
      { id: 'b', name: 'B组', workspace: 'ws-b', groups: [], source: { sessions: 4, confidence: 0.8 } },
      { id: 'c', name: '旧包', groups: [], source: { sessions: 3, confidence: 0.7 } },
    ],
  }))
  const learner = new Learner({ root: dir, file })
  const scoped = learner.status({ workspace: 'ws-a' })
  assert.deepEqual(scoped.packs.map((pack) => pack.id), ['a', 'c'], '只保留本工作区与无工作区标记的旧包')
  assert.equal(learner.status({ workspace: 'ws-b' }).packs.length, 2, '切到另一个工作区时换成那边的包')
  assert.equal(learner.status().packs.length, 3, '不传工作区时不过滤')
  fs.rmSync(dir, { recursive: true, force: true })
  console.log('ok 4.8 learning workspace scope')
}
