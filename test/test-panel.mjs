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
          calls: { session: 0, d30: 0, all: 0 },
        },
      ],
    },
  ],
  plugins: [{ id: 'core', label: 'core', kind: 'core', tools: 1, counts: { normal: 1, warn: 0, hidden: 0 } }],
  profiles: [{ id: 'full', kind: 'builtin', name: '全开', active: true }],
  packs: [{ id: 'everything', kind: 'builtin', name: '全开', groups: ['*'], plugins: [], active: true, chosen: true }],
  plans: [
    { id: 'everything', kind: 'pack', groups: ['*'], plugins: [], active: true, chosen: true, impact: { kept: 3, off: 0 }, keptLabels: [] },
    { id: 'core', kind: 'profile', packs: ['everything'], active: false, impact: { kept: 3, off: 0 }, keptLabels: [] },
  ],
  sessionState: { profileId: 'full', packs: ['everything'] },
  levels: { read: 'normal', ops_bash: 'hidden', never_used: 'hidden' },
  suggestions: { sleep: [{ group: 'web', kind: 'sleep', label: '网页', tools: 2, calls: 0 }], wake: [] },
  usageReady: true,
  learning: { status: 'idle', packs: [] },
  cost: {
    savedTokens: 120,
    repayTokens: 340,
    breakevenTurns: 2,
    overheadTokens: 20,
    netPerTurnTokens: 100,
    thresholdTokens: 900,
    overThreshold: false,
    settings: { charsPerToken: 3.6, missFactor: 1, thresholdMultiplier: 2, priceInput: 2 },
  },
}

let current = base
const posts = []
dom.window.fetch = async (url, init = {}) => {
  const target = String(url)
  if ((init.method ?? 'GET').toUpperCase() === 'POST') {
    posts.push({ url: target, body: JSON.parse(init.body ?? '{}') })
    if (target.startsWith('/tool-budget/preferences') && posts.at(-1).body.locale !== undefined) {
      const locale = posts.at(-1).body.locale
      current = { ...current, locale, preferences: { ...current.preferences, locale } }
    }
    return { ok: true, status: 200, json: async () => current }
  }
  if (target.startsWith('/tool-budget/usage')) return { ok: true, status: 200, json: async () => ({ ok: true, tools: {}, usage: {} }) }
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
assert.ok(text().includes('未用 2'), '工具栏应显示未用数量 2')

// 分区顺序：成本 → 建议 → 模式 → 方案
const orderedText = text().replace(/\s+/g, '')
const positionOf = (needle) => orderedText.indexOf(needle)
assert.ok(positionOf('成本估算') >= 0 && positionOf('成本估算') < positionOf('建议'), '成本应排在建议之前')
assert.ok(positionOf('建议') < positionOf('模式auto'), '建议应排在模式之前')
assert.ok(positionOf('模式auto') < positionOf('方案'), '模式应排在方案之前')
assert.ok(orderedText.includes('+100token/轮'), `成本应显示净省数字，实际：${orderedText.slice(0, 80)}`)
assert.ok(orderedText.includes('模式常驻20'), '成本应显示模式常驻开销')

// 模式：名字加粗 + 每个模式一行说明
const modeLabels = [...dom.window.document.querySelectorAll('[role="dialog"] span')].filter((node) => ['auto', 'ask', 'pin'].includes(node.textContent) && node.style.fontWeight === '700')
assert.ok(modeLabels.length >= 3, '三个模式的名字都该加粗')
assert.ok(orderedText.includes('工具关多了它会把需要的组再打开'), '模式说明应逐条显示')
assert.ok(orderedText.includes('近30天一次都没调用'), '建议应说明理由')

// 建议逐条给按钮
const suggestionRow = [...dom.window.document.querySelectorAll('[role="dialog"] div')].find((node) => node.textContent.includes('网页') && node.textContent.includes('休眠'))
assert.ok(suggestionRow !== undefined, '建议应逐条列出组名并给操作按钮')

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
assert.ok(/保留\s*\d+\s*·\s*关闭\s*\d+/.test(text()), `场景包应显示保留/关闭的数量，实际：${text().slice(0, 200)}`)

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
