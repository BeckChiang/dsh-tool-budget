/**
 * 成本估算：改一次工具清单，省多少、又要为失效的缓存重付多少。
 *
 * 模型提示词的顺序是 system → 工具清单 → 对话。工具清单一变，它之后的
 * 整段上下文都不再是「同一前缀」，下一次请求要按新 token 计费一次。
 * 所以收益按「每轮」累计，代价按「一次」发生：
 *
 *   savedTokens  = 被隐藏工具字符 / charsPerToken        （每轮省）
 *   repayTokens  = (当前上下文 − 工具块) × missFactor     （切一次付一次）
 *   breakeven    = repayTokens / savedTokens             （几轮之后回本）
 *
 * 数字是估算：字符/3.6 token 对中英文混排偏保守，供应商的缓存命中率、
 * 分段策略都会让实际值浮动。所以参数开放给用户改，面板里也写清算法。
 */

export const DEFAULT_SETTINGS = {
  charsPerToken: 3.6,
  missFactor: 1,
  thresholdMultiplier: 2,
  priceInput: 2,
  priceCache: 0.2,
  modeAutoOverhead: 200,
  modeQuietOverhead: 20,
  currency: '¥',
}

export const LIMITS = {
  charsPerToken: [1, 10],
  missFactor: [0, 1],
  thresholdMultiplier: [1, 10],
  priceInput: [0, 1000],
  priceCache: [0, 1000],
  modeAutoOverhead: [0, 5000],
  modeQuietOverhead: [0, 5000],
}

function number(value, fallback, range) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(range[1], Math.max(range[0], parsed))
}

export function normalizeSettings(input) {
  const source = input !== null && typeof input === 'object' ? input : {}
  return {
    charsPerToken: number(source.charsPerToken, DEFAULT_SETTINGS.charsPerToken, LIMITS.charsPerToken),
    missFactor: number(source.missFactor, DEFAULT_SETTINGS.missFactor, LIMITS.missFactor),
    thresholdMultiplier: number(source.thresholdMultiplier, DEFAULT_SETTINGS.thresholdMultiplier, LIMITS.thresholdMultiplier),
    priceInput: number(source.priceInput, DEFAULT_SETTINGS.priceInput, LIMITS.priceInput),
    priceCache: number(source.priceCache, DEFAULT_SETTINGS.priceCache, LIMITS.priceCache),
    modeAutoOverhead: number(source.modeAutoOverhead, DEFAULT_SETTINGS.modeAutoOverhead, LIMITS.modeAutoOverhead),
    modeQuietOverhead: number(source.modeQuietOverhead, DEFAULT_SETTINGS.modeQuietOverhead, LIMITS.modeQuietOverhead),
    currency: typeof source.currency === 'string' && source.currency !== '' ? source.currency : DEFAULT_SETTINGS.currency,
  }
}

/** 工具清单占多少字符：name + description + parameters 的 JSON。 */
export function toolChars(tool) {
  if (tool === null || tool === undefined) return 0
  const params = tool.parameters === undefined ? '' : JSON.stringify(tool.parameters)
  return String(tool.name ?? '').length + String(tool.description ?? '').length + params.length
}

export function sumChars(tools) {
  let total = 0
  for (const tool of tools ?? []) total += toolChars(tool)
  return total
}

/**
 * @param {object} input
 * @param {number} input.hiddenChars   将被隐藏的工具字符数
 * @param {number} input.contextTokens 当前会话上下文 token 数
 * @param {number} input.toolBlockTokens 工具清单本身占的 token 数
 * @param {number} input.avgTurnTokens 会话平均每轮输入 token（阈值基准）
 * @param {object} [input.settings]
 */
export function estimate(input) {
  const settings = normalizeSettings(input.settings)
  const hiddenChars = Math.max(0, Number(input.hiddenChars) || 0)
  const contextTokens = Math.max(0, Number(input.contextTokens) || 0)
  const toolBlockTokens = Math.max(0, Number(input.toolBlockTokens) || 0)
  const avgTurnTokens = Math.max(0, Number(input.avgTurnTokens) || 0)

  const savedTokens = hiddenChars / settings.charsPerToken
  const savedMoney = (savedTokens / 1e6) * settings.priceInput
  const repayTokens = Math.max(0, contextTokens - toolBlockTokens) * settings.missFactor
  const repayMoney = (repayTokens / 1e6) * settings.priceInput
  const breakevenTurns = savedTokens > 0 ? repayTokens / savedTokens : Number.POSITIVE_INFINITY
  const thresholdTokens = avgTurnTokens > 0 ? avgTurnTokens * settings.thresholdMultiplier : 0
  const overheadTokens = Math.max(0, Number(input.overheadTokens) || 0)

  return {
    hiddenChars,
    savedTokens: round(savedTokens),
    savedMoney: roundMoney(savedMoney),
    repayTokens: round(repayTokens),
    repayMoney: roundMoney(repayMoney),
    breakevenTurns: Number.isFinite(breakevenTurns) ? round(breakevenTurns) : null,
    thresholdTokens: round(thresholdTokens),
    overThreshold: thresholdTokens > 0 && repayTokens > thresholdTokens,
    overheadTokens: round(overheadTokens),
    netPerTurnTokens: round(savedTokens - overheadTokens),
    contextTokens: round(contextTokens),
    settings,
  }
}

/** 多轮之后的净收益（正数才算赚）。 */
export function netAfter(result, turns) {
  if (result === null || result === undefined) return 0
  const saved = (Number(result.savedMoney) || 0) * Math.max(0, Number(turns) || 0)
  return roundMoney(saved - (Number(result.repayMoney) || 0))
}

function round(value) {
  return Math.round(value * 10) / 10
}

function roundMoney(value) {
  return Math.round(value * 10000) / 10000
}
