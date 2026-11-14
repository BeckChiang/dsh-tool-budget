/**
 * Host 侧文案字典。
 *
 * 客户端有框架的 locale 服务可用，Host 没有；工具描述、命令输出、HTTP 错误
 * 这些「模型/CLI 也会看到」的文本只能自己选语言。语言偏好存在
 * `preferences.json`，面板切换语言时通过 POST /tool-budget/locale 写回。
 */

export const LOCALES = ['zh-CN', 'en']

const DICT = {
  'tool.desc': {
    'zh-CN':
      '管理本会话的工具预算：按方案 / 分组开关工具，被隐藏的工具会从工具清单里消失，下一条消息生效；被降权的工具仍可见，但调用会被拒绝并说明原因。',
    en: 'Manage this session\'s tool budget: switch tools by scene pack or group. Hidden tools disappear from the tool list and take effect on the next message; discouraged tools stay visible but calls are refused with a reason.',
  },
  'tool.desc.ask': {
    'zh-CN':
      '管理本会话的工具预算。若你需要的能力不在当前工具清单里，先停下来用 list 查看，然后把「需要的分组 + 用途」告诉用户，由用户决定是否恢复；不要用别的工具勉强替代。',
    en: 'Manage this session\'s tool budget. If a capability you need is missing from the tool list, call list first, then stop and tell the user the group and purpose so they can decide; do not force a substitute tool.',
  },
  'tool.desc.pin': {
    'zh-CN': '管理本会话的工具预算（当前为 pin 模式：休眠即硬关闭，恢复只能由用户在面板或 /budget 命令完成）。',
    en: 'Manage this session\'s tool budget (pin mode: dormant means hard-off; only the user can restore it from the panel or /budget).',
  },
  'tool.action': {
    'zh-CN': 'list 查看；on 启用；off 关闭；warn 降权（可见但拒绝调用）；reset 全部启用；profile 切换方案；pack 切换方案包；cost 查看省/重付估算',
    en: 'list to inspect; on to enable; off to hide; warn to discourage (visible but refused); reset to enable all; profile to switch profiles; pack to switch scene packs; cost to estimate savings and repay',
  },
  'tool.target': {
    'zh-CN': '分组 id（shell / mcp:rea）、分组标签、方案包名、方案名、精确工具名、前缀（mcp__rea__）或 all；list/cost 可省略',
    en: 'group id (shell / mcp:rea), group label, pack name, profile name, exact tool name, prefix (mcp__rea__) or all; omit for list/cost',
  },
  'tool.usage': {
    'zh-CN': '用法：tool_budget action=list|on|off|warn|reset|profile|pack|cost target=<…>',
    en: 'Usage: tool_budget action=list|on|off|warn|reset|profile|pack|cost target=<…>',
  },
  'cmd.desc': {
    'zh-CN': '查看或调整本会话的工具预算（方案 / 方案包 / 分组）',
    en: 'Inspect or adjust this session\'s tool budget (profile / pack / group)',
  },
  'cmd.hint': {
    'zh-CN': '[list|on|off|warn] <分组|包|工具> | all on|all off | profile <名称> | reset',
    en: '[list|on|off|warn] <group|pack|tool> | all on|all off | profile <name> | reset',
  },
  'err.session': { 'zh-CN': '拿不到当前会话，无法调整工具预算', en: 'No session available, cannot adjust the tool budget' },
  'err.action': { 'zh-CN': '不认识的动作「{action}」', en: 'Unknown action "{action}"' },
  'err.target': { 'zh-CN': '缺少目标：要{verb}哪个分组、包或工具？', en: 'Missing target: which group, pack or tool should be {verb}?' },
  'err.off': { 'zh-CN': '当前是 off 模式：改动只做预览，切回 ask 才能保存或应用', en: 'Mode off: edits are preview-only; switch back to ask to save or apply' },
  'err.core': { 'zh-CN': '核心工具不允许关闭：{list}', en: 'Core tools cannot be turned off: {list}' },
  'err.noMatch': { 'zh-CN': '「{needle}」没有匹配到工具、分组或包', en: 'No tool, group or pack matches "{needle}"' },
  'err.body': { 'zh-CN': '请求体必须是 JSON 对象', en: 'Request body must be a JSON object' },
  'err.tooLarge': { 'zh-CN': '请求体过大', en: 'Request body too large' },
  'err.method': { 'zh-CN': '不支持的请求方法：{method}', en: 'Method not allowed: {method}' },
  'err.missingSession': { 'zh-CN': '缺少 ?session=<id>', en: 'Missing ?session=<id>' },
  'err.missingDisabled': { 'zh-CN': '缺少 disabled[]', en: 'Missing disabled[]' },
  'text.enabled': { 'zh-CN': '已启用', en: 'Enabled' },
  'text.hidden': { 'zh-CN': '已关闭', en: 'Hidden' },
  'text.warned': { 'zh-CN': '已降权', en: 'Discouraged' },
  'text.reset': { 'zh-CN': '已恢复全部启用', en: 'All tools enabled' },
  'text.applied': { 'zh-CN': '{verb}：{list} → 现在 {enabled}/{total} 可用（下一条消息生效）', en: '{verb}: {list} → {enabled}/{total} available now (effective on the next message)' },
  'summary.title': { 'zh-CN': '工具预算：{enabled}/{total} 可用', en: 'Tool budget: {enabled}/{total} available' },
  'label.allTools': { 'zh-CN': '全部可管理工具', en: 'All manageable tools' },
  'plan.candidateNote': { 'zh-CN': '来自 {sessions} 个历史会话的共现组合，采用后才成为普通方案', en: 'Clustered from {sessions} past sessions; adopt it to make it a normal plan' },
  'plan.savedName': { 'zh-CN': '组合方案（{n} 个）', en: 'Combined plan ({n})' },
  'warn.reason': {
    'zh-CN': '当前会话已把「{target}」设为降权：工具仍在清单里，但调用会被拒绝。如果确实需要，请把用途告诉用户，或自行用 tool_budget action=on target={target} 恢复。',
    en: 'This session discourages "{target}": the tool is still listed but calls are refused. If you really need it, tell the user the purpose, or restore it with tool_budget action=on target={target}.',
  },
}

let activeLocale = 'zh-CN'

export function normalizeLocale(value) {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw.startsWith('en')) return 'en'
  return 'zh-CN'
}

export function setLocale(value) {
  activeLocale = normalizeLocale(value)
  return activeLocale
}

export function getLocale() {
  return activeLocale
}

export function translate(key, params, locale = activeLocale) {
  const entry = DICT[key]
  if (entry === undefined) return key
  const text = entry[locale] ?? entry[activeLocale] ?? entry['zh-CN'] ?? key
  if (params === undefined) return text
  return text.replace(/\{(\w+)\}/g, (whole, name) => (params[name] === undefined ? whole : String(params[name])))
}

/** 绑定一个语言，返回 `t(key, params)`。 */
export function makeT(locale) {
  const fixed = normalizeLocale(locale)
  return (key, params) => translate(key, params, fixed)
}

export const KEYS = Object.keys(DICT)

/** 测试用：某语言下每个键都必须有非空值。 */
export function dictOf(locale) {
  const out = {}
  for (const key of KEYS) out[key] = DICT[key][normalizeLocale(locale)]
  return out
}
