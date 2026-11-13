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

import fs from 'node:fs'
import path from 'node:path'

export const LEVELS = ['normal', 'warn', 'hidden']
export const MODES = ['auto', 'ask', 'pin']

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

export const BUILTIN_PACKS = [
  { id: 'everything', groups: ['*'], plugins: [] },
  { id: 'core', groups: ['session', 'toolchain'], plugins: [] },
  { id: 'code', groups: ['session', 'shell', 'fs', 'toolchain', 'web'], plugins: [] },
  { id: 'research', groups: ['session', 'web', 'toolchain', 'mcp-resource'], plugins: [] },
  { id: 'media', groups: ['session', 'media'], plugins: [] },
  { id: 'office', groups: ['session', 'office', 'fs'], plugins: [] },
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
    const mode = this.session(sessionId).mode ?? this.preferences().mode
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
 * 建议集：只做建议，永不自动生效。
 * - 30 天一次都没调用过的组 → 建议休眠（不含核心/受保护工具所在的组）
 * - 明明在 30 天里被用过、却因为当前包被挡掉的组 → 建议恢复
 */
export function suggestions({ catalog, usage, levels }) {
  const groups = new Map()
  for (const tool of catalog) {
    const group = groups.get(tool.group) ?? { group: tool.group, tools: [], calls: 0, protectedCount: 0, hidden: 0 }
    group.tools.push(tool.name)
    const entry = usage?.[tool.name]
    group.calls += Number(entry?.d30 ?? 0) || 0
    if (PROTECTED.has(tool.name) || CORE_ALWAYS.has(tool.name)) group.protectedCount += 1
    if (levels.get(tool.name) === 'hidden') group.hidden += 1
    groups.set(tool.group, group)
  }
  const sleep = []
  const wake = []
  for (const group of groups.values()) {
    if (group.protectedCount > 0) continue
    if (group.calls === 0 && group.hidden === 0) {
      sleep.push({ group: group.group, kind: 'sleep', calls: 0, tools: group.tools.length, names: group.tools })
    }
    if (group.calls > 0 && group.hidden === group.tools.length) {
      wake.push({ group: group.group, kind: 'wake', calls: group.calls, tools: group.tools.length, names: group.tools })
    }
  }
  sleep.sort((a, b) => b.tools - a.tools)
  wake.sort((a, b) => b.calls - a.calls)
  return { sleep: sleep.slice(0, 8), wake: wake.slice(0, 8) }
}

/** 核心 / 受保护判定，供 HTTP 层给出确认提示。 */
export function protectionOf(name) {
  if (CORE_ALWAYS.has(name)) return 'core'
  if (PROTECTED.has(name)) return 'protected'
  return null
}
