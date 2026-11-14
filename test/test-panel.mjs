// 面板级测试：用 jsdom + 真 React 挂载「工具预算」按钮，验证打开面板不崩、
// 三档按钮、未用筛选、中英切换与关闭后按钮仍在（上一版就是这里抛 ReferenceError 把 dock 带崩的）。
//
// 依赖两个只用于测试的包（不进插件依赖）：
//   C:\Users\recko\DSH\tmp\react-test 里 react@18 + react-dom@18 + jsdom
// 运行：node test/test-panel.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const deps = process.env.DSH_APP === undefined
  ? path.resolve(here, '../../../tmp/react-test/package.json')
  : process.env.DSH_APP
const requireDep = createRequire(deps)
const { JSDOM } = requireDep('jsdom')

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:50544/',
  pretendToBeVisual: true,
})

// bundle 里既读 window 也读全局 document/navigator
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Element = dom.window.Element
globalThis.Node = dom.window.Node
globalThis.MouseEvent = dom.window.MouseEvent
globalThis.getComputedStyle = dom.window.getComputedStyle
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0)
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })

const react = requireDep('react')
const reactDomClient = requireDep('react-dom/client')
const h = react.createElement

// —— 假数据：两组三工具，read 用过、ops_bash 隐藏、never_used 从未使用
const base = {
  ok: true,
  session: 'session-test',
  live: true,
  mode: 'ask',
  locale: 'zh-CN',
  preferences: { locale: 'zh-CN', mode: 'ask', view: 'group', metric: 'session', sortByFreq: false },
  counts: { total: 3, enabled: 2, hidden: 1, warned: 0, core: 1, locked: 0 },
  groups: [
    {
      id: 'fs',
      label: '文件与检索',
      order: 1,
      counts: { normal: 1, warn: 0, hidden: 1 },
      calls: { session: 2, d30: 4, all: 9 },
      tools: [
        {
          name: 'read',
          label: 'read',
          level: 'normal',
          plugin: 'core',
          pluginLabel: 'core',
          pluginKind: 'core',
          locked: false,
          protection: 'protected',
          description: '读文本文件',
          signature: '(file_path)',
          detail: '读文本文件，返回带行号的内容。',
          calls: { session: 2, d30: 4, all: 9 },
        },
        {
          name: 'ops_bash',
          label: 'ops_bash',
          level: 'hidden',
          plugin: 'dsh-ops',
          pluginLabel: 'dsh-ops',
          pluginKind: 'plugin',
          locked: false,
          protection: null,
          description: '执行命令',
          signature: '(command)',
          detail: '执行 bash 命令。',
          calls: { session: 0, d30: 1, all: 1 },
        },
      ],
    },
    {
      id: 'other',
      label: '其他',
      order: 9,
      counts: { normal: 0, warn: 0, hidden: 1 },
      calls: { session: 0, d30: 0, all: 0 },
      tools: [
        {
          name: 'never_used',
          label: 'never_used',
          level: 'hidden',
          plugin: 'dsh-ops',
          pluginLabel: 'dsh-ops',
          pluginKind: 'plugin',
          locked: false,
          protection: null,
          description: '从未被调用',
          signature: '()',
          detail: '从未被调用。',
          calls: null,
        },
      ],
    },
  ],
  plugins: [{ id: 'core', label: 'core', kind: 'core', tools: 1, counts: { normal: 1, warn: 0, hidden: 0 } }],
  profiles: [{ id: 'full', kind: 'builtin', name: '全开', active: true }],
  packs: [
    { id: 'everything', kind: 'builtin', name: '全开', groups: ['*'], plugins: [], active: true, chosen: true },
    { id: 'research', kind: 'builtin', name: '查资料', groups: ['web'], plugins: [], active: false, chosen: false },
  ],
  plans: [
    { id: 'everything', key: 'pack:everything', origin: 'preset', source: 'builtin', deletable: false, kind: 'pack', groups: ['*'], plugins: [], active: false, chosen: false, impact: { kept: 3, off: 0 }, keptLabels: [], diff: { hide: 0, show: 1, hideLabels: [], showLabels: ['终端与执行'], same: false } },
    { id: 'mine', key: 'pack:mine', origin: 'saved', source: 'saved', deletable: true, kind: 'manual', name: '我的方案', groups: ['fs'], plugins: [], active: false, chosen: false, impact: { kept: 2, off: 1 }, keptLabels: ['文件'], diff: { hide: 0, show: 0, hideLabels: [], showLabels: [], same: true } },
    { id: 'code', key: 'profile:code', origin: 'preset', source: 'builtin', deletable: false, kind: 'profile', builtin: true, packs: ['code'], groups: ['fs'], plugins: [], active: false, impact: { kept: 2, off: 1 }, keptLabels: ['文件'], diff: { hide: 1, show: 0, hideLabels: ['文件'], showLabels: [], same: false } },
    { id: 'code', key: 'pack:code', origin: 'preset', source: 'builtin', deletable: false, kind: 'pack', groups: ['fs'], plugins: [], chosen: false, impact: { kept: 2, off: 1 }, keptLabels: ['文件'], diff: { hide: 1, show: 0, hideLabels: ['文件'], showLabels: [], same: false } },
    { id: 'research', key: 'pack:research', origin: 'preset', source: 'builtin', deletable: false, kind: 'pack', groups: ['web'], plugins: [], chosen: false, impact: { kept: 1, off: 2 }, keptLabels: ['网页'], diff: { hide: 1, show: 0, hideLabels: ['网页'], showLabels: [], same: false } },
    { id: 'learned-1', key: 'learned:learned-1', origin: 'learned', source: 'learned', candidate: true, deletable: true, kind: 'manual', name: '文件、命令', groups: ['fs'], plugins: [], annotate: '来自 6 个会话的常用组合，采用后才能勾选', active: false, chosen: false, impact: { kept: 2, off: 1 }, keptLabels: ['文件'], diff: { hide: 1, show: 0, hideLabels: ['文件'], showLabels: [], same: false } },
  ],
  sessionState: { profileId: 'full', packs: ['everything'], planId: 'pack:mine' },
  levels: { read: 'normal', ops_bash: 'hidden', never_used: 'hidden' },
  sessionLearning: {
    ready: true,
    turns: 5,
    items: [
      { kind: 'sleep', group: 'web', label: '网页', tools: 2, tokens: 40 },
      { kind: 'restore', group: 'shell', label: '终端与执行', tools: 1, tokens: 60 },
    ],
  },
  learnTurns: 3,
  dirty: { active: true, key: 'pack:mine', count: 2, hide: 1, show: 1, names: ['网页', '终端与执行'], mutable: true },
  mode: 'ask',
  modeActive: true,
  usageReady: true,
  learning: { status: 'ready', finishedAt: '2026-11-13T15:00:00.000Z', packs: [{ id: 'learned-a', name: '文件、命令', source: { sessions: 6, confidence: 0.9 } }] },
  cost: {
    savedTokens: 120,
    repayTokens: 340,
    breakevenTurns: 2,
    overheadTokens: 20,
    netPerTurnTokens: 100,
    projectedTurnTokens: 1380,
    thresholdTokens: 900,
    overThreshold: false,
    hiddenChars: 432,
    contextTokens: 9000,
    toolBlockTokens: 800,
    avgTurnTokens: 1500,
    settings: { charsPerToken: 3.6, missFactor: 1, thresholdMultiplier: 2, priceInput: 2 },
  },
}

let current = base
const posts = []
dom.window.fetch = async (url, init = {}) => {
  const target = String(url)
  if ((init.method ?? 'GET').toUpperCase() === 'POST' && target.startsWith('/tool-budget/cost')) {
    return { ok: true, json: async () => ({ ok: true, pending: true, savedTokens: 500, repayTokens: 900, netPerTurnTokens: 480 }) }
  }
  if ((init.method ?? 'GET').toUpperCase() === 'POST') {
    posts.push({ url: target, body: JSON.parse(init.body ?? '{}') })
    const body = posts.at(-1).body
    if (body.op === 'planSet') {
      const packs = (body.plans ?? []).filter((key) => String(key).startsWith('pack:')).map((key) => String(key).slice(5))
      current = { ...current, sessionState: { ...current.sessionState, packs } }
    }
    if (body.op === 'adopt') {
      current = { ...current, plans: current.plans.map((plan) => (plan.key === `learned:${body.packId}` ? { ...plan, candidate: false, origin: 'saved' } : plan)) }
    }
    if (body.op === 'rename') {
      current = { ...current, plans: current.plans.map((plan) => (plan.key === body.key ? { ...plan, name: body.name } : plan)) }
    }
    if (body.op === 'learnTurns') {
      current = { ...current, learnTurns: body.turns }
    }
    if (body.op === 'saveDirty') {
      current = { ...current, dirty: { ...current.dirty, active: false, count: 0 } }
    }
    if (['auto', 'ask', 'off'].includes(body.mode)) {
      current = {
        ...current,
        mode: body.mode,
        modeActive: body.mode !== 'off',
        cost: body.mode === 'off' ? { ...current.cost, savedTokens: 0, netPerTurnTokens: 0, overheadTokens: 0 } : current.cost,
      }
    }
    if (target.startsWith('/tool-budget/preferences') && posts.at(-1).body.locale !== undefined) {
      const locale = posts.at(-1).body.locale
      current = { ...current, locale, preferences: { ...current.preferences, locale } }
    }
    return { ok: true, status: 200, json: async () => current }
  }
  if (target.startsWith('/tool-budget/usage'))
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, usage: { never_used: { session: 0, d30: 0, all: 500, last: null } } }),
    }
  return { ok: true, status: 200, json: async () => current }
}
globalThis.fetch = dom.window.fetch

// —— 加载 bundle：它自己往 window.__ModuleLoader__ 上挂工厂
const clientPath = path.join(here, '../lib/client.js')
const code = fs.readFileSync(clientPath, 'utf8')
let factory = null
dom.window.__ModuleLoader__ = {
  load: (entry) => {
    factory = entry.factory
  },
}
const sandbox = vm.createContext(globalThis)
vm.runInContext(code, sandbox, { filename: clientPath })
assert.equal(typeof factory, 'function', 'bundle 应该注册一个 factory')

function requireFromBundle(id) {
  if (id === 'react') return react
  if (id === 'react-dom') return requireDep('react-dom')
  if (id === 'react-dom/client') return requireDep('react-dom/client')
  if (id === 'react/jsx-runtime') return requireDep('react/jsx-runtime')
  throw new Error(`unexpected require: ${id}`)
}
const exports = factory(requireFromBundle)
const { ToolSwitchButton } = exports.__internals

const flush = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms))

// —— 挂载
const container = dom.window.document.getElementById('root')
const root = reactDomClient.createRoot(container)
root.render(h(ToolSwitchButton, { sessionId: 'session-test' }))
await flush(80)

const button = dom.window.document.querySelector('[data-tool-budget-button]')
assert.ok(button !== null, '按钮应该渲染出来')

// 打开面板
button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await flush(80)
let dialog = dom.window.document.querySelector('[role="dialog"]')
assert.ok(dialog !== null, '点开后面板应该在')

const text = () => dom.window.document.querySelector('[role="dialog"]')?.textContent ?? ''
assert.ok(text().includes('工具预算'), `面板标题应为中文，实际：${text().slice(0, 60)}`)
// 板块默认只展开成本
const sectionToggle = (id) => dom.window.document.querySelector(`[data-section-toggle="${id}"]`)
assert.ok(sectionToggle('cost') !== null, '成本板块应该有折叠按钮')
assert.equal(sectionToggle('cost').getAttribute('aria-expanded'), 'true', '默认展开成本板块')
for (const id of ['mode', 'plan', 'tools']) {
  assert.ok(sectionToggle(id) !== null, `${id} 板块应该有折叠按钮`)
  assert.equal(sectionToggle(id).getAttribute('aria-expanded'), 'false', `${id} 板块默认应收起`)
}

// 成本公式与参数含义
assert.ok(text().includes('省下的：'), '成本应解释节省怎么算')
assert.ok(text().includes('净省 ='), '成本应写出净省公式')
const paramsButton = [...dialog.querySelectorAll('button')].find((item) => item.textContent === '参数')
assert.ok(paramsButton !== undefined, '成本板块应有参数按钮')
paramsButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await flush(60)
assert.ok(text().includes('参数含义'), '参数区应有标题')
assert.equal(dom.window.document.querySelectorAll('[data-cost-param]').length, 5, '参数表只列五个可改参数（两个常驻开销固定）')
assert.equal(dom.window.document.querySelector('[data-cost-param="modeAutoOverhead"]'), null, '常驻开销不再出现在可改参数里')
// 标题栏与页脚常驻：面板滚动时不动
const head = dom.window.document.querySelector('[data-panel-header]')
const foot = dom.window.document.querySelector('[data-panel-footer]')
assert.ok(head !== null && foot !== null, '标题栏与页脚应有标记')
assert.equal(dom.window.getComputedStyle(head).position, 'sticky', '标题栏应 sticky 常驻')
assert.equal(dom.window.getComputedStyle(foot).position, 'sticky', '页脚应 sticky 常驻')
assert.equal(dom.window.getComputedStyle(foot).bottom, '0px', '页脚贴底')
assert.ok(text().includes('切换后每轮约 1.4k token（现在 1.5k）'), '应显示切换后的预计每轮消耗')
assert.ok(dom.window.document.querySelector('[data-cost-param="charsPerToken"]').textContent.includes('每 token 字符数'), '参数说明应解释 charsPerToken')

// 展开其余板块（后面的内容断言需要）
for (const id of ['mode', 'plan', 'tools']) {
  sectionToggle(id).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await flush(30)
}

// 口径切换必须真的改变计数：state 里 calls 为 null 的工具靠 usage 路由补上
const unusedLabel = () => {
  const chips = [...dom.window.document.querySelectorAll('[role="dialog"] button')]
  return (chips.find((item) => (item.textContent ?? '').startsWith('未用'))?.textContent ?? '').trim()
}
assert.equal(unusedLabel(), '未用 2', `本会话口径应有两个未用，实际：${unusedLabel()}`)
const pickMetric = async (label) => {
  const chip = [...dom.window.document.querySelectorAll('[role="dialog"] button')].find((item) => (item.textContent ?? '').trim() === label)
  assert.ok(chip !== undefined, `应能找到口径按钮 ${label}`)
  chip.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await flush(40)
}
await pickMetric('30 天')
assert.equal(unusedLabel(), '未用 1', `30 天口径应只剩一个未用，实际：${unusedLabel()}`)
await pickMetric('全局')
assert.equal(unusedLabel(), '未用 0', `全局口径应无未用，实际：${unusedLabel()}`)
await pickMetric('本会话')

assert.ok(text().includes('轮次阈值'), '学习区应给出轮次阈值输入')
assert.ok(text().includes('未用 2'), '工具栏应显示未用数量 2')

// 分区顺序：成本 → 方案（建议板块已删除）
const orderedText = text().replace(/\s+/g, '')
const positionOf = (needle) => orderedText.indexOf(needle)
assert.ok(positionOf('成本估算') >= 0 && positionOf('成本估算') < positionOf('勾选一个或多个方案'), '成本应排在方案之前')
assert.equal(dom.window.document.querySelector('[data-section-toggle="suggest"]'), null, '建议板块应已从面板删除')
assert.ok(orderedText.includes('+100token/轮'), `成本应显示净省数字，实际：${orderedText.slice(0, 80)}`)
assert.ok(orderedText.includes('模式常驻20'), '成本应显示模式常驻开销')

// 模式：名字加粗 + 每个模式一行说明
const modeLabels = [...dom.window.document.querySelectorAll('[role="dialog"] span')].filter((node) => ['auto', 'ask', 'off'].includes(node.textContent.trim()) && node.style.fontWeight === '700')
assert.ok(modeLabels.length >= 3, '三个模式的名字都该加粗（含 off）')
assert.equal([...dom.window.document.querySelectorAll('[role="dialog"] span')].filter((node) => node.textContent.trim() === 'pin').length, 0, 'pin 模式应已并入 ask')
assert.ok(orderedText.includes('工具关多了它会把需要的组再打开'), '模式说明应逐条显示')


// 本轮学习逐条给操作
const learnRows = [...dom.window.document.querySelectorAll('[data-learn-act]')]
assert.equal(learnRows.length, 2, `本轮学习应逐条列出，实际 ${learnRows.length}`)
assert.ok(text().includes('网页') && text().includes('终端与执行'), '学习条目应显示组名')

// 排序固定按频率：没有切换按钮
assert.equal([...dom.window.document.querySelectorAll('[role="dialog"] button')].filter((node) => node.textContent === '按分组' || node.textContent === '按频率').length, 0, '不应再有按分组/按频率切换')


// 默认全部折叠
const groupsAtStart = [...dom.window.document.querySelectorAll('[data-group]')]
assert.ok(groupsAtStart.length > 0, '应该渲染出分组')
assert.equal(dom.window.document.querySelectorAll('[data-tool]').length, 0, '默认应该收起所有分组，不渲染工具行')
assert.ok(
  groupsAtStart.every((node) => node.getAttribute('data-collapsed') === 'true'),
  '每个分组的 data-collapsed 都应为 true',
)
assert.ok(
  groupsAtStart.every((node) => node.querySelector('[data-collapse]').getAttribute('aria-expanded') === 'false'),
  '每个组头的 aria-expanded 都应为 false',
)

// 逐个展开，后面的断言需要工具行
for (const node of groupsAtStart) node.querySelector('[data-collapse]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await flush(90)
assert.ok(dom.window.document.querySelectorAll('[data-tool]').length > 0, '展开后应出现工具行')

// 三档按钮：每行三个，locked 与否都渲染 data-level
const levels = dom.window.document.querySelectorAll('[data-level]')
assert.ok(levels.length >= 9, `三档按钮应至少 9 个，实际 ${levels.length}`)

// 未用筛选：只留 never_used
const chips = [...dom.window.document.querySelectorAll('[role="dialog"] button')]
const unusedChip = chips.find((item) => item.textContent.startsWith('未用'))
assert.ok(unusedChip !== undefined, '应该有「未用」筛选按钮')
unusedChip.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await flush(60)
assert.ok(dom.window.document.querySelector('[data-tool="never_used"]') !== null, '筛选后应保留未用工具')
const autoExpanded = [...dom.window.document.querySelectorAll('[data-group]')].find((node) => node.getAttribute('data-collapsed') === 'false')
assert.ok(autoExpanded !== undefined, '开启未用筛选时应自动展开命中的分组')
autoExpanded.querySelector('[data-collapse]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await flush(60)
assert.equal(
  dom.window.document.querySelector(`[data-group="${autoExpanded.getAttribute('data-group')}"]`).getAttribute('data-collapsed'),
  'true',
  '筛选状态下分组仍应能收起',
)
autoExpanded.querySelector('[data-collapse]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await flush(60)
assert.equal(dom.window.document.querySelector('[data-tool="read"]'), null, '筛选后不应显示用过的工具')

// 再点一次恢复
unusedChip.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await flush(60)
assert.ok(dom.window.document.querySelector('[data-tool="read"]') !== null, '取消筛选后应恢复显示')

// 「已关闭」筛选：只留 hidden / warn 的工具
const closedChip = [...dom.window.document.querySelectorAll('[role="dialog"] button')].find((item) => item.textContent.startsWith('已关闭'))
assert.ok(closedChip !== undefined, '应该有「已关闭」筛选按钮')
closedChip.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await flush(60)
assert.ok(dom.window.document.querySelector('[data-tool="ops_bash"]') !== null, '筛选后应保留被关闭的 ops_bash')
assert.equal(dom.window.document.querySelector('[data-tool="read"]'), null, '筛选后不应显示开启中的 read')
closedChip.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await flush(60)
assert.ok(dom.window.document.querySelector('[data-tool="read"]') !== null, '取消筛选后应恢复显示')

// 场景包：名字 + 影响面（保留 / 关闭）都要看得见
assert.ok(text().includes('全部保留'), '场景包应显示直观的名字')
assert.ok(!text().includes('写代码'), '内置方案与场景包重复时不应再显示第二份')
assert.ok(text().includes('代码 + 文件'), '场景包本身仍应显示')

// 方案多选：勾选进组合，顶部汇总，点「应用这组」一次生效
const samePlan = dom.window.document.querySelector('[data-plan="manual:mine"]')
assert.ok(samePlan !== null, '方案列表应逐行展示')
assert.equal(samePlan.getAttribute('data-plan-same'), 'true', '与当前一致时应标记 same')
assert.ok(samePlan.textContent.includes('与你现在完全一样'), '与现在一致的方案要说清楚')
assert.ok(dom.window.document.querySelector('[data-plan="pack:everything"] [data-plan-state]').textContent.includes('正在用'), '正在用的方案要有标记')
assert.ok(samePlan.textContent.includes('我的方案'), '自建方案应显示名字')

const restorePlan = dom.window.document.querySelector('[data-plan="pack:everything"]')
assert.equal(restorePlan.getAttribute('data-plan-same'), 'false', '还有工具关着时全部保留与当前不同')
assert.ok(restorePlan.textContent.includes('比现在少关 1 个'), `差异要写清少关几个，实际：${restorePlan.textContent}`)

const applyAll = dom.window.document.querySelector('[data-plan-apply-all]')
assert.ok(applyAll !== null, '应有一次性应用整组组合的按钮')
assert.equal(applyAll.disabled, true, '组合与当前选择一致时按钮应禁用')
assert.equal(dom.window.document.querySelector('[data-plan-apply]'), null, '逐行应用按钮应已被组合应用取代')

const pickCode = dom.window.document.querySelector('[data-plan-pick="pack:code"]')
assert.ok(pickCode !== null, '每个场景包都应可勾选')
assert.equal(pickCode.getAttribute('data-plan-picked'), 'false', '初始未勾选')
pickCode.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await flush(60)
assert.equal(dom.window.document.querySelector('[data-plan-pick="pack:code"]').getAttribute('data-plan-picked'), 'true', '点击后应勾选')
assert.ok(dom.window.document.querySelector('[data-plan-preview]').textContent.includes('保留'), '应给出组合生效后的工具数预览')
assert.equal(dom.window.document.querySelector('[data-plan-apply-all]').disabled, false, '组合变化后应可应用')
await flush(80)
const switchLine = dom.window.document.querySelector('[data-cost-switch]')
assert.ok(switchLine !== null, '勾选与当前不一致时要显示切换重付')
assert.ok(switchLine.textContent.includes('重付'), '切换成本要说明会重付一次')
assert.ok(dom.window.document.querySelector('[data-plan-delete="pack:mine"]') !== null, '自建方案应有删除按钮')
assert.equal(dom.window.document.querySelector('[data-plan-delete="pack:code"]'), null, '内置方案不应有删除按钮')
assert.ok(dom.window.document.querySelector('[data-dirty]') !== null, '改动未写回时要提示')
assert.ok(dom.window.document.querySelector('[data-dirty-save]') !== null, '应能保存改动')
for (const group of ['preset', 'saved', 'learned']) {
  assert.ok(dom.window.document.querySelector(`[data-plan-group="${group}"]`) !== null, `${group} 方案组应存在`)
  assert.equal(dom.window.document.querySelector(`[data-plan-group="${group}"] [data-plan-group-toggle]`).getAttribute('aria-expanded'), 'true', `${group} 组默认展开`)
}
const learnedPick = dom.window.document.querySelector('[data-plan-pick="learned:learned-1"]')
assert.ok(learnedPick !== null, '学习候选也要出现在列表里')
assert.equal(learnedPick.disabled, true, '学习候选必须「采用」后才能勾选')
assert.ok(dom.window.document.querySelector('[data-plan-adopt="learned:learned-1"]') !== null, '学习候选应有采用按钮')
dom.window.document.querySelector('[data-plan-adopt="learned:learned-1"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await flush(80)
const adoptPost = posts.filter((item) => item.body.op === 'adopt').at(-1)
assert.equal(adoptPost.body.packId, 'learned-1', '采用应提交学习包 id')
assert.equal(dom.window.document.querySelector('[data-plan-pick="learned:learned-1"]').disabled, false, '采用后应可勾选')
const renameButton = dom.window.document.querySelector('[data-plan-rename="pack:mine"]')
assert.ok(renameButton !== null, '用户保存的方案应能改名')
renameButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await flush(60)
const renameInput = dom.window.document.querySelector('[data-plan-rename-input="pack:mine"]')
assert.ok(renameInput !== null, '点改名应出现输入框')
const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
setValue.call(renameInput, '我的方案 B')
renameInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
await flush(40)
renameInput.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
await flush(80)
const renamePost = posts.filter((item) => item.body.op === 'rename').at(-1)
assert.equal(renamePost.body.key, 'pack:mine', '改名应提交方案键')
assert.equal(renamePost.body.name, '我的方案 B', '改名应提交新名字')
const learnAct = dom.window.document.querySelector('[data-learn-act="sleep:web"]')
assert.ok(learnAct !== null, '本轮学习应给出可执行的动作')
learnAct.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await flush(80)
const learnPost = posts.filter((item) => item.body.op === 'group' && item.body.group === 'web').at(-1)
assert.equal(learnPost.body.level, 'hidden', '点「关掉」应把该组设为 hidden')

dom.window.document.querySelector('[data-plan-pick="pack:research"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await flush(60)
dom.window.document.querySelector('[data-plan-apply-all]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await flush(80)
const applied = posts.filter((item) => item.url.startsWith('/tool-budget/state')).at(-1)
assert.equal(applied.body.op, 'planSet', '应用整组应发出 op=planSet')
assert.deepEqual([...applied.body.plans].sort(), ['pack:code', 'pack:research'], '应把勾选的多个方案键一起提交')

// 分组折叠：组头可收起 / 展开（功能组视图）
const readRow = dom.window.document.querySelector('[data-tool="read"]')
assert.ok(readRow !== null, '分组视图里应该有 read 行')
const groupId = readRow.closest('[data-group]').getAttribute('data-group')
const groupNode = () => dom.window.document.querySelector(`[data-group="${groupId}"]`)
const rowsBefore = groupNode().querySelectorAll('[data-tool]').length
assert.ok(rowsBefore > 0, '分组内应有工具行')
groupNode().querySelector('[data-collapse]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await flush(60)
assert.equal(groupNode().querySelectorAll('[data-tool]').length, 0, '收起后组内工具行应消失')
assert.equal(groupNode().getAttribute('data-collapsed'), 'true', '收起状态应写进 data-collapsed')
assert.equal(groupNode().querySelector('[data-collapse]').getAttribute('aria-expanded'), 'false', 'aria-expanded 应为 false')
groupNode().querySelector('[data-collapse]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await flush(60)
assert.equal(groupNode().querySelectorAll('[data-tool]').length, rowsBefore, '展开后工具行应恢复')
assert.equal(groupNode().getAttribute('data-collapsed'), 'false', '展开状态应写回')

// 插件视图同样可折叠
const pluginChip = [...dom.window.document.querySelectorAll('[role="dialog"] button')].find((item) => item.textContent === '按插件')
assert.ok(pluginChip !== undefined, '应该有「按插件」视图按钮')
pluginChip.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await flush(60)
const pluginGroups = [...dom.window.document.querySelectorAll('[data-group]')]
assert.ok(pluginGroups.length > 0, '插件视图应有分组')
assert.equal(dom.window.document.querySelectorAll('[data-tool]').length, 0, '插件视图默认也应全部收起')
const firstPluginGroupId = pluginGroups[0].getAttribute('data-group')
const firstPluginGroup = () => dom.window.document.querySelector(`[data-group="${firstPluginGroupId}"]`)
firstPluginGroup().querySelector('[data-collapse]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await flush(60)
const pluginRowsBefore = firstPluginGroup().querySelectorAll('[data-tool]').length
assert.ok(pluginRowsBefore > 0, '插件分组展开后应有工具行')
firstPluginGroup().querySelector('[data-collapse]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await flush(60)
assert.equal(firstPluginGroup().querySelectorAll('[data-tool]').length, 0, '插件分组收起后工具行应消失')
firstPluginGroup().querySelector('[data-collapse]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await flush(60)
assert.equal(firstPluginGroup().querySelectorAll('[data-tool]').length, pluginRowsBefore, '插件分组展开后工具行应恢复')

// 不使用：插件完全不生效，面板要说明清楚，成本归零
assert.ok(orderedText.includes('插件完全不生效'), '不使用的说明要写清「完全不生效」')
const offChip = [...dom.window.document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'off')
assert.ok(offChip !== undefined, '模式里应有「off」')
offChip.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await flush(80)
const modePost = posts.filter((item) => item.url.startsWith('/tool-budget/preferences') && item.body.mode !== undefined).at(-1)
assert.equal(modePost.body.mode, 'off', '点不使用应把模式切到 off')
assert.ok(dom.window.document.querySelector('[data-mode-off]') !== null, '不使用时应显示提示条')
assert.ok(text().includes('插件完全不生效'), '提示条要说明插件完全不生效')
assert.ok(dom.window.document.querySelector('[data-plan-apply-all]').disabled === true, '不使用时应禁用「应用这组」')
assert.ok(!text().includes('−20'), '不使用时常驻为 0，不应出现负的净省')
assert.ok(text().includes('近 30 天没调用'), '本轮学习条目应写明理由')

// 语言切换
const langButton = [...dom.window.document.querySelectorAll('[role="dialog"] button')].find((item) => item.getAttribute('title') === 'language')
assert.ok(langButton !== undefined, '应该有语言切换按钮')
langButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await flush(100)
assert.ok(posts.some((item) => item.url.includes('/tool-budget/preferences')), '切换语言应 POST preferences')
assert.ok(text().includes('Tool budget'), `切换后标题应为英文，实际：${text().slice(0, 80)}`)

// 关闭：面板消失、按钮还在（dock 未被卸载）
const closeButton = [...dom.window.document.querySelectorAll('[role="dialog"] button')].find((item) => item.textContent === '✕')
assert.ok(closeButton !== undefined, '应该有关闭按钮')
closeButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await flush(60)
assert.equal(dom.window.document.querySelector('[role="dialog"]'), null, '关闭后面板应消失')
assert.ok(dom.window.document.querySelector('[data-tool-budget-button]') !== null, '关闭后按钮必须还在')

console.log('test-panel: all assertions passed')
