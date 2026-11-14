/**
 * 工具预算的持久化模型：方案（profile）→ 场景包（pack）→ 分组 / 插件 / 单个工具。
 *
 * 解析顺序（后者覆盖前者）：
 *   1. 包与 profile 决定「基础在不在场」
 *   2. groupLevels / pluginLevels 覆盖整组、整插件
 *   3. levels 覆盖单个工具
 *   4. 核心工具永远是 normal（需求 3：核心组件不允许关闭）
 *
 * 级别：normal（正常）/ warn（可见但拒绝调用）/ hidden（从清单消失）。
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const LEVELS = ['normal', 'warn', 'hidden']
export const MODES = ['auto', 'ask', 'off']

/** 任何情况下都不允许关：关掉它们等于把插件自己锁死。 */
export const CORE_ALWAYS = new Set(['tool_budget', 'present', 'ask_user_question'])

/** 允许关，但必须显式确认（建议集永远不会自动动它们）。 */
export const PROTECTED = new Set([
  'read',
  'write',
  'edit',
  'grep',
  'glob',
  'pwsh',
  'ops_bash',
  'ops_inspect_local_file',
  'ops_grep',
  'ops_glob',
  'working_directory',
  'tool_switch',
])

// 内置方案不收工具名，只写「覆盖规则」：组 id、插件 id、通配。
// 组与插件都来自当前实机的 catalog（装了什么插件、有哪些工具），
// 所以新装插件后这些方案会自动跟着变，不需要改代码。
//   - hideAll: 除了 CORE_ALWAYS 之外全关（只聊天）
//   - groups/plugins: 命中即保留
export const BUILTIN_PACKS = [
  { id: 'everything', groups: ['*'], plugins: [], auto: true },
  { id: 'core', groups: [], plugins: [], hideAll: true, auto: true },
  { id: 'code', groups: ['session', 'shell', 'fs', 'toolchain', 'web', 'agent'], plugins: ['dsh-ops', 'dsh-doctor', 'dsh-unblock'], auto: true },
  { id: 'research', groups: ['session', 'web', 'toolchain', 'mcp-resource', 'agent'], plugins: ['dsh-free-search', 'dsh-mnemon'], auto: true },
  { id: 'media', groups: ['session', 'media'], plugins: ['dsh-image-gen'], auto: true },
  { id: 'office', groups: ['session', 'office', 'fs'], plugins: [], auto: true },
]

export const BUILTIN_PROFILES = [
  { id: 'full', packs: ['everything'] },
  { id: 'code', packs: ['code'] },
  { id: 'research', packs: ['research'] },
  { id: 'media', packs: ['media'] },
  { id: 'minimal', packs: ['core'] },
]

const EMPTY = () => ({
  version: 2,
  preferences: { locale: 'zh-CN', mode: 'ask', view: 'group', metric: 'session', sortByFreq: false, cost: {} },
  packs: [],
  profiles: [],
  sessions: {},
})

let cache = null
let cachePath = null

function readFileOrEmpty(file) {
  try {
    const text = fs.readFileSync(file, 'utf8')
    const parsed = JSON.parse(text)
    if (parsed !== null && typeof parsed === 'object') return parsed
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn(`[tool-budget] 读取 ${file} 失败：${error?.message ?? error}`)
  }
  return null
}

function writeFileAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  fs.renameSync(temp, file)
}

/** 兼容 v1（只有 disabled 列表）把老状态迁过来。 */
function migrate(raw) {
  const state = EMPTY()
  if (raw === null) return state
  state.preferences = { ...state.preferences, ...(raw.preferences ?? {}) }
  if (state.preferences.mode === 'pin') state.preferences.mode = 'ask'
  state.packs = Array.isArray(raw.packs) ? raw.packs : []
  state.profiles = Array.isArray(raw.profiles) ? raw.profiles : []
  const sessions = raw.sessions !== null && typeof raw.sessions === 'object' ? raw.sessions : {}
  for (const [id, value] of Object.entries(sessions)) {
    if (value === null || typeof value !== 'object') continue
    const levels = value.levels !== null && typeof value.levels === 'object' ? { ...value.levels } : {}
    for (const name of value.disabled ?? []) levels[name] = 'hidden'
    state.sessions[id] = {
      profileId: typeof value.profileId === 'string' ? value.profileId : 'full',
      packs: Array.isArray(value.packs) ? [...value.packs] : [],
      levels,
      groupLevels: value.groupLevels !== null && typeof value.groupLevels === 'object' ? { ...value.groupLevels } : {},
      pluginLevels: value.pluginLevels !== null && typeof value.pluginLevels === 'object' ? { ...value.pluginLevels } : {},
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : nowIso(),
    }
  }
  return state
}

function nowIso() {
  return new Date().toISOString()
}

export function statePathOf(dir) {
  return path.join(dir, 'budget.json')
}

export function builtinSnapshot(catalog, store) {
  const names = catalog.map((tool) => tool.name)
  const signature = catalogSignature(names)
  const prev = store.builtins()
  const impacts = {}
  for (const pack of BUILTIN_PACKS) {
    const resolved = resolveLevels({ session: { profileId: 'full', packs: [pack.id], levels: {}, groupLevels: {}, pluginLevels: {} }, catalog, packs: store.packs() })
    let kept = 0
    for (const tool of catalog) if (resolved.levels.get(tool.name) !== 'hidden') kept += 1
    impacts[pack.id] = { kept, off: catalog.length - kept }
  }
  const changed = prev === null || prev.signature !== signature
  const added = prev === null ? [] : names.filter((name) => !(prev.names ?? []).includes(name))
  const removed = prev === null ? [] : (prev.names ?? []).filter((name) => !names.includes(name))
  const deltas = {}
  if (prev?.impacts) for (const id of Object.keys(impacts)) if (prev.impacts[id]) deltas[id] = impacts[id].kept - prev.impacts[id].kept
  return { signature, prevAt: prev?.at ?? null, changed, added, removed, deltas, impacts, snapshot: { signature, names, impacts }, total: catalog.length }
}

export function catalogSignature(names) {
  return crypto.createHash('sha1').update([...names].sort().join('\n')).digest('hex').slice(0, 12)
}

export class BudgetStore {
  constructor({ dir }) {
    this.dir = dir
    this.file = statePathOf(dir)
    if (cachePath !== this.file) {
      cache = null
      cachePath = this.file
    }
  }

  get() {
    if (cache === null) cache = migrate(readFileOrEmpty(this.file))
    return cache
  }

  save() {
    writeFileAtomic(this.file, this.get())
  }

  builtins() {
    return this.get().builtins ?? null
  }

  setBuiltins(snapshot) {
    const state = this.get()
    state.builtins = snapshot
    this.save()
    return snapshot
  }

  preferences() {
    return this.get().preferences
  }

  setPreferences(patch) {
    const state = this.get()
    state.preferences = { ...state.preferences, ...patch }
    this.save()
    return state.preferences
  }

  packs() {
    const state = this.get()
    const builtin = BUILTIN_PACKS.map((pack) => ({ ...pack, kind: 'builtin' }))
    return [...builtin, ...state.packs]
  }

  pack(id) {
    return this.packs().find((pack) => pack.id === id) ?? null
  }

  addPack(pack) {
    const state = this.get()
    const next = { ...pack }
    state.packs = [...state.packs.filter((item) => item.id !== next.id), next]
    this.save()
    return next
  }

  removePack(id) {
    const state = this.get()
    const before = state.packs.length
    state.packs = state.packs.filter((pack) => pack.id !== id || pack.kind === 'builtin')
    this.save()
    return state.packs.length !== before
  }

  profiles() {
    const state = this.get()
    const builtin = BUILTIN_PROFILES.map((profile) => ({ ...profile, kind: 'builtin' }))
    return [...builtin, ...state.profiles]
  }

  profile(id) {
    return this.profiles().find((profile) => profile.id === id) ?? null
  }

  addProfile(profile) {
    const state = this.get()
    const next = { ...profile }
    state.profiles = [...state.profiles.filter((item) => item.id !== next.id), next]
    this.save()
    return next
  }

  removeProfile(id) {
    const state = this.get()
    const before = state.profiles.length
    state.profiles = state.profiles.filter((profile) => profile.id !== id)
    this.save()
    return state.profiles.length !== before
  }

  session(sessionId) {
    const state = this.get()
    const existing = state.sessions[sessionId]
    if (existing !== undefined) return existing
    const created = {
      profileId: 'full',
      packs: [],
      levels: {},
      groupLevels: {},
      pluginLevels: {},
      updatedAt: nowIso(),
    }
    state.sessions[sessionId] = created
    return created
  }

  patchSession(sessionId, patch) {
    const state = this.get()
    const session = this.session(sessionId)
    state.sessions[sessionId] = { ...session, ...patch, updatedAt: nowIso() }
    this.save()
    return state.sessions[sessionId]
  }

  modeOf(sessionId) {
    const raw = this.session(sessionId).mode ?? this.preferences().mode
    const mode = raw === 'pin' ? 'ask' : raw
    return MODES.includes(mode) ? mode : 'ask'
  }
}

function matches(pattern, id) {
  if (pattern === '*') return true
  if (pattern === id) return true
  if (pattern.endsWith(':*')) return id.startsWith(pattern.slice(0, -1))
  return false
}

/** 某个包里是否包含这个工具（分组或插件任一命中）。 */
function packCovers(pack, tool) {
  if (pack.hideAll === true) return false
  const groups = pack.groups ?? []
  for (const group of groups) {
    if (matches(group, tool.group)) return true
  }
  for (const plugin of pack.plugins ?? []) {
    if (plugin === tool.plugin) return true
  }
  return false
}

/**
 * @param {object} input
 * @param {ReturnType<BudgetStore['session']>} input.session
 * @param {Array<{name: string, group: string, plugin: string}>} input.catalog
 * @param {Array<object>} input.packs
 */
export function resolveLevels({ session, catalog, packs }) {
  const chosen = new Set(session.packs ?? [])
  const active = packs.filter((pack) => chosen.has(pack.id))
  const usable = active.length > 0 ? active : packs.filter((pack) => pack.id === (BUILTIN_PACKS[0].id))
  const levels = new Map()
  const byGroup = new Map()
  for (const tool of catalog) {
    let level = 'normal'
    const covered = usable.some((pack) => packCovers(pack, tool))
    if (!covered) level = 'hidden'
    const groupLevel = session.groupLevels?.[tool.group]
    if (LEVELS.includes(groupLevel)) level = groupLevel
    const pluginLevel = session.pluginLevels?.[tool.plugin]
    if (LEVELS.includes(pluginLevel)) level = pluginLevel
    const toolLevel = session.levels?.[tool.name]
    if (LEVELS.includes(toolLevel)) level = toolLevel
    if (CORE_ALWAYS.has(tool.name)) level = 'normal'
    levels.set(tool.name, level)
    const bucket = byGroup.get(tool.group) ?? { normal: 0, warn: 0, hidden: 0 }
    bucket[level] += 1
    byGroup.set(tool.group, bucket)
  }
  return { levels, byGroup, activePacks: usable.map((pack) => pack.id) }
}

/** 把当前会话状态收成一份可复用的方案：包 + 三级精细调整。 */
export function profileFromSession(session, { id, name }) {
  const profile = {
    id,
    kind: 'manual',
    packs: [...(session.packs ?? [])],
    levels: { ...(session.levels ?? {}) },
    groupLevels: { ...(session.groupLevels ?? {}) },
    pluginLevels: { ...(session.pluginLevels ?? {}) },
  }
  if (typeof name === 'string' && name !== '') profile.name = name
  return profile
}

/**
 * 场景包多选：点一个加一个，但「全部保留」是互斥的全开状态。
 * 选别的包先摘掉它；把最后一个包也点掉，就回到「全部保留」。
 */
export function togglePack(chosen, id, keepAllId = BUILTIN_PACKS[0].id) {
  const next = new Set(chosen ?? [])
  if (id === keepAllId) return [keepAllId]
  next.delete(keepAllId)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  if (next.size === 0) next.add(keepAllId)
  return [...next]
}
/**
 * 多选组合的规范化：去重、丢掉不存在的 id、保持给定顺序。
 * 「全部保留」是互斥的全开状态——只要它和别的包同时出现，就只留它；
 * 一个都没选时同样回到「全部保留」，避免出现「什么都没选」的空状态。
 */
export function normalizePacks(list, knownIds, keepAllId = BUILTIN_PACKS[0].id) {
  const known = new Set(knownIds ?? [])
  const picked = []
  for (const id of list ?? []) {
    if (typeof id !== 'string' || id === '' || !known.has(id)) continue
    if (picked.includes(id)) continue
    picked.push(id)
  }
  if (picked.includes(keepAllId)) return [keepAllId]
  if (picked.length === 0) return [keepAllId]
  return picked
}
/** 核心 / 受保护判定，供 HTTP 层给出确认提示。 */
export function protectionOf(name) {
  if (CORE_ALWAYS.has(name)) return 'core'
  if (PROTECTED.has(name)) return 'protected'
  return null
}

/**
 * 两份 levels 映射的差异：哪些工具会从「可见」变成「隐藏」，哪些反过来。
 * 用来回答面板上那个问题——这个方案和现在到底有没有区别。
 */
export function diffLevels(before, after) {
  const hide = []
  const show = []
  const names = new Set([...before.keys(), ...after.keys()])
  for (const name of names) {
    const left = before.get(name) ?? 'normal'
    const right = after.get(name) ?? 'normal'
    if (left !== 'hidden' && right === 'hidden') hide.push(name)
    else if (left === 'hidden' && right !== 'hidden') show.push(name)
  }
  return { hide, show, same: hide.length === 0 && show.length === 0 }
}

/**
 * 方案指纹：把「工具 → 档位」映射规范化后比较，用来查重。
 * 只看非 normal 的项（normal 是默认值，不影响结果），键排序后拼接。
 */
export function planHash(levels) {
  const entries = levels instanceof Map ? [...levels.entries()] : Object.entries(levels ?? {})
  return entries
    .filter(([name, level]) => LEVELS.includes(level) && level !== 'normal' && typeof name === 'string')
    .map(([name, level]) => `${name}=${level}`)
    .sort()
    .join('|')
}
