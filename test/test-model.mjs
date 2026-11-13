// 纯函数测试：方案解析、建议集、成本公式、学习聚类、字典完整性。
// 不碰 Host 运行时，用 node test/test-model.mjs 跑。

import assert from 'node:assert/strict'

import { BudgetStore, resolveLevels, suggestions, protectionOf, BUILTIN_PACKS, CORE_ALWAYS } from '../lib/profiles.js'
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

// 3. 建议集：从没被用过的组建议休眠，被挡住却有用的组建议恢复，受保护组不动
{
  const levels = new Map(catalog.map((tool) => [tool.name, tool.group === 'web' ? 'hidden' : 'normal']))
  const usage = {
    read: { d30: 3 },
    pwsh: { d30: 5 },
    web_search: { d30: 9 },
    ops_bash: { d30: 1 },
  }
  const result = suggestions({ catalog, usage, levels })
  const sleepGroups = result.sleep.map((item) => item.group)
  assert.ok(!sleepGroups.includes('fs'), 'fs 有调用，不该建议休眠')
  assert.ok(!sleepGroups.includes('toolchain'), 'toolchain 含受保护工具，不该建议休眠')
  assert.ok(result.wake.some((item) => item.group === 'web'), 'web 被隐藏但有用，应建议恢复')
}

// 4. 成本公式：省 / 重付 / 回本
{
  const result = estimate({ hiddenChars: 3600, contextTokens: 100000, toolBlockTokens: 12000, avgTurnTokens: 8000, settings: DEFAULT_SETTINGS })
  assert.equal(result.savedTokens, 1000)
  assert.equal(result.repayTokens, 88000)
  assert.equal(result.breakevenTurns, 88)
  assert.equal(result.overThreshold, true, '88000 > 8000*2')
  const settings = normalizeSettings({ charsPerToken: 0, missFactor: 3, thresholdMultiplier: 0 })
  assert.equal(settings.charsPerToken, 1, '越界参数应被夹回区间')
  assert.equal(settings.missFactor, 1)
  assert.equal(settings.thresholdMultiplier, 1)
  assert.ok(toolChars({ name: 'ab', description: 'cd', parameters: {} }) > 0)
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
  const packs = clusterPacks([...samples, { groups: new Set(['office']) }])
  assert.equal(packs.length, 2, '两个习惯应各成一包，单例不成包')
  const codePack = packs.find((pack) => pack.groups.includes('fs'))
  assert.ok(codePack !== undefined)
  assert.equal(codePack.kind, 'learned')
  assert.ok(codePack.source.sessions >= 4)
  assert.ok(codePack.source.confidence >= 0.6)
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
