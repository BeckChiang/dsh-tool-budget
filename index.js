// dsh-tool-budget — 会话级工具预算（Host 半侧）
//
// 在 dsh-tool-switch 0.3.0（MIT，suqing114）的调用次数统计之上，把「逐个勾选
// 107 个工具」换成三层结构：
//
//   方案 profile ── 场景包 pack ── 分组 / 插件 / 单个工具
//
// 级别三档：
//   normal  正常：留在工具清单里，可以调用
//   warn    降权：仍在清单里（模型看得见），但 guard 会拒绝调用并说明原因
//   hidden  隐藏：从清单、PTC 绑定与执行集合里一起移除（restrict）
//
// 两条硬规则：
//   - CORE_ALWAYS（tool_budget / present / ask_user_question）永远 normal；
//   - PROTECTED（read/write/edit/ops_bash…）允许关，但必须显式 confirm。
//
// 频率只进 UI，不进提示词：调用次数不参与工具描述，避免破坏前缀缓存。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { UsageIndex, decodeLog } from './lib/usage.js'
import { BudgetStore, resolveLevels, planHash, protectionOf, profileFromSession, diffLevels, normalizePacks, CORE_ALWAYS, PROTECTED, LEVELS, MODES } from './lib/profiles.js'
import { pluginOf, pluginLabel } from './lib/classify.js'
import { estimate, normalizeSettings, toolChars, DEFAULT_SETTINGS } from './lib/cost.js'
import { Learner, sessionAdjustments } from './lib/learning.js'
import { makeT, normalizeLocale, setLocale } from './lib/i18n.js'

export const name = 'dsh-tool-budget'

/** Cordis：这两个服务不存在时插件不激活。 */
export const inject = ['tools', 'agents']

/** 浏览器半侧使用的路由（同源，精确匹配）。 */
export const ROUTE = '/tool-budget/state'
export const USAGE_ROUTE = '/tool-budget/usage'
export const COST_ROUTE = '/tool-budget/cost'
export const LEARNING_ROUTE = '/tool-budget/learning'
export const PREFERENCES_ROUTE = '/tool-budget/preferences'

const MAX_BODY_BYTES = 128 * 1024
const MAX_NAME_LENGTH = 200
const TOOL_NAME = 'tool_budget'

// ---------------------------------------------------------------------------
// 功能分组：视图里「按功能组」的那一维。
// ---------------------------------------------------------------------------

const CORE_GROUPS = [
  {
    id: 'session',
    label: '会话与计划',
    order: 0,
    test: (name) =>
      /^(todo_write|create_goal|get_goal|update_goal|ask_user_question|present|skill|exit_plan_mode)$/.test(name) ||
      /^schedule_/.test(name),
  },
  { id: 'shell', label: '终端与执行', order: 1, test: (name) => /^(pwsh|bash|run_code|shell|terminal|exec)$/.test(name) || /^job_/.test(name) },
  {
    id: 'fs',
    label: '文件与检索',
    order: 2,
    test: (name) =>
      /^(read|write|edit|glob|grep|read_image|read_animation)$/.test(name) ||
      /^(ls|list_dir|list_files|move|copy|remove|mkdir)/.test(name) ||
      name === 'load_workspace_dependencies',
  },
  { id: 'web', label: '网络检索', order: 3, test: (name) => /^(web_search|web_fetch|free_search_test|platform_search|video_search|advanced_search|multi_search|research|cache_search|domain_search|weather)$/.test(name) },
  {
    id: 'agent',
    label: '子代理与编排',
    order: 4,
    test: (name) =>
      /^(subagent|subagent_fork|send_message|list_agents|interrupt_agent|wait_agent|workflow)$/.test(name) || /^list_subagent_/.test(name),
  },
  { id: 'office', label: '文档与演示', order: 5, test: (name) => /^(office_|ppt)/.test(name) },
  { id: 'media', label: '图像与音视频', order: 6, test: (name) => /^(comfyui_|image_generate|generate_image|generate_images|edit_image|canvas_state|view_canvas|find_inspiration)$/.test(name) },
  {
    id: 'mcp-resource',
    label: 'MCP 资源',
    order: 7,
    test: (name) => /^(list_mcp_resource|list_mcp_resources|list_mcp_resource_templates|read_mcp_resource)$/.test(name),
  },
  { id: 'social', label: '社交与发布', order: 8, test: (name) => /^x_(post|delete|search|timeline|thread|status|probe)$/.test(name) },
  {
    id: 'toolchain',
    label: '工具链与维护',
    order: 9,
    test: (name) => /^(purge_|install_local_workbench|plugin_manager|working_directory|gain_qq_tools|ops_|mnemon_|unlag_|create_worktree)/.test(name),
  },
]

const MCP_PATTERN = /^mcp__([A-Za-z0-9_.-]+)__/

/** 把工具名归到一个功能分组。 */
function groupOf(name) {
  const mcp = MCP_PATTERN.exec(name)
  if (mcp !== null) {
    const server = mcp[1]
    return { id: `mcp:${server}`, label: `${server} · MCP`, order: 100, tool: name.slice(mcp[0].length) }
  }
  for (const group of CORE_GROUPS) {
    if (group.test(name)) return { id: group.id, label: group.label, order: group.order, tool: name }
  }
  const underscore = name.indexOf('_')
  if (underscore > 0) {
    const prefix = name.slice(0, underscore)
    return { id: `x:${prefix}`, label: prefix, order: 800, tool: name }
  }
  return { id: 'other', label: '其他', order: 900, tool: name }
}

function sessionIdOf(agent) {
  const sessionId = agent?.session?.id ?? agent?.id
  return typeof sessionId === 'string' ? sessionId : undefined
}

// ---------------------------------------------------------------------------
// 插件入口
// ---------------------------------------------------------------------------

export function apply(ctx, config) {
  const settings = config ?? {}
  const stateDir = settings.stateDir ? String(settings.stateDir) : path.join(os.homedir(), '.dsh-tool-budget')
  const store = new BudgetStore({ dir: stateDir })
  const usageIndex = new UsageIndex({ cacheFile: path.join(stateDir, 'usage-cache.json') })
  const learner = new Learner({
    file: path.join(stateDir, 'learning.json'),
    groupOf: (toolName) => groupOf(toolName).id,
    labelOf: (groupId) => CORE_GROUPS.find((item) => item.id === groupId)?.label ?? groupId,
  })
  setLocale(store.preferences().locale)

  const warn = (message, cause) => {
    try {
      ctx.logger?.warn?.(`[tool-budget] ${message}${cause === undefined ? '' : `: ${String(cause?.message ?? cause)}`}`)
    } catch {
      /* logger 不可用就算了 */
    }
  }

  const t = (key, params) => makeT(store.preferences().locale)(key, params)

  /** sessionId -> 活着的 agent */
  const live = new Map()
  // 本轮学习的数据：被降权拦下的调用次数，以及会话进行到第几轮。
  const blockedCounts = new Map()
  const turnsCache = new Map()
  /** sessionId -> { signature, dispose } */
  const installed = new Map()
  /** sessionId -> 最近一次 /usage 结果（给建议集与面板复用） */
  const usageCache = new Map()
  /** sessionId -> { size, mtime, contextTokens, avgTurnTokens } */
  const contextCache = new Map()

  /** 路由收到的是裸 uuid 或带 session- 前缀，统一成 live 里那把钥匙。 */
  function canonicalSession(sessionId) {
    const raw = String(sessionId ?? '')
    if (live.has(raw)) return raw
    const bare = raw.startsWith('session-') ? raw.slice('session-'.length) : raw
    for (const key of live.keys()) {
      const candidate = key.startsWith('session-') ? key.slice('session-'.length) : key
      if (candidate === bare) return key
    }
    return raw
  }

  function viewOf(agent) {
    try {
      return ctx.tools.view(agent)
    } catch (error) {
      warn('tools.view() failed', error)
      return undefined
    }
  }

  /** 该 agent 真正可以被 restrict 遮掉的名字（全局继承层的工具）。 */
  function restrictableOf(agent) {
    const view = viewOf(agent)
    const names = view?.restrictableNames
    return names instanceof Set ? names : new Set()
  }

  // --- 目录 ---------------------------------------------------------------

  /**
   * 读出本会话看得见的工具目录。全局视图用于拿到被本会话遮掉的名字，
   * agent 作用域视图用于拿到 preset 注册的 scoped 工具（ops_* 等）的描述。
   */
  function catalogOf(sessionId) {
    const agent = live.get(sessionId)
    const view = agent === undefined ? undefined : viewOf(agent)
    const definitions = new Map()

    const remember = (definition) => {
      if (typeof definition?.name !== 'string') return
      const existing = definitions.get(definition.name)
      const description = typeof definition.description === 'string' ? definition.description : ''
      if (existing === undefined) {
        definitions.set(definition.name, { name: definition.name, description, parameters: definition.parameters })
        return
      }
      if ((existing.description ?? '').length === 0 && description.length > 0) existing.description = description
      if (existing.parameters === undefined && definition.parameters !== undefined) existing.parameters = definition.parameters
    }

    let globalNames = []
    try {
      const global = ctx.tools.definitions()
      if (Array.isArray(global)) {
        globalNames = global.map((definition) => definition?.name).filter((entry) => typeof entry === 'string')
        for (const definition of global) remember(definition)
      }
    } catch (error) {
      warn('reading the tool catalog failed', error)
    }
    if (agent !== undefined) {
      try {
        const scoped = ctx.tools.definitions(agent)
        if (Array.isArray(scoped)) for (const definition of scoped) remember(definition)
      } catch (error) {
        warn('reading the scoped tool catalog failed', error)
      }
    }

    const knownNames = view?.knownNames instanceof Set ? [...view.knownNames] : globalNames
    const restrictable = restrictableOf(agent)
    const tools = []
    for (const toolName of [...knownNames].sort()) {
      const definition = definitions.get(toolName) ?? { name: toolName }
      const group = groupOf(toolName)
      const plugin = pluginOf(toolName)
      tools.push({
        name: toolName,
        label: group.tool,
        group: group.id,
        groupLabel: group.label,
        groupOrder: group.order,
        plugin: plugin.id,
        pluginLabel: pluginLabel(plugin.id),
        pluginKind: plugin.kind,
        description: descriptionOf(definition.description),
        signature: signatureOf(definition),
        detail: detailOf(definition.description),
        locked: !restrictable.has(toolName),
        protection: protectionOf(toolName),
        calls: 0,
      })
    }
    return { tools, knownNames }
  }

  function descriptionOf(raw) {
    const text = typeof raw === 'string' ? raw : ''
    const firstLine = text.split(/\r?\n/, 1)[0]?.trim() ?? ''
    if (firstLine.length === 0) return ''
    return firstLine.length > 160 ? `${firstLine.slice(0, 157)}…` : firstLine
  }

  function signatureOf(definition) {
    const schema = definition?.parameters ?? definition?.schema ?? definition?.inputSchema
    const properties = schema?.properties
    if (properties === null || typeof properties !== 'object') return ''
    const required = new Set(Array.isArray(schema?.required) ? schema.required : [])
    const keys = Object.keys(properties)
    if (keys.length === 0) return '()'
    const shown = keys.slice(0, 12).map((key) => (required.has(key) ? key : `${key}?`))
    if (keys.length > shown.length) shown.push('…')
    return `(${shown.join(', ')})`
  }

  function detailOf(raw) {
    const text = typeof raw === 'string' ? raw.trim() : ''
    if (text.length === 0) return ''
    return text.length > 1200 ? `${text.slice(0, 1197)}…` : text
  }

  // --- 解析与落装 ---------------------------------------------------------

  function sessionOf(sessionId) {
    return store.session(sessionId)
  }

  function levelsOf(sessionId, catalog) {
    return resolveLevels({ session: sessionOf(sessionId), catalog: catalog.tools, packs: store.packs() })
  }

  /**
   * 「不使用」模式：插件完全不介入。存储的方案与级别原样保留，
   * 但对外一律按 normal 处理——不遮罩、不降权、不省 token。
   */
  function effectiveLevels(sessionId, levels) {
    if (store.modeOf(sessionId) !== 'off') return levels
    return new Map([...levels.keys()].map((name) => [name, 'normal']))
  }

  /**
   * 重算并重装该会话的 restrict + guard。
   * 只有 allow 集合或降权集合变化才真的动注册表：每次重装都会让提示词前缀
   * 失效一次，抖动一次就是一次重付费。
   */
  function syncSession(sessionId) {
    const agent = live.get(sessionId)
    if (agent === undefined) {
      installed.delete(sessionId)
      return
    }
    const catalog = catalogOf(sessionId)
    const { levels: storedLevels } = levelsOf(sessionId, catalog)
    const levels = effectiveLevels(sessionId, storedLevels)
    const restrictable = restrictableOf(agent)
    const allow = []
    const discouraged = new Set()
    for (const name of restrictable) {
      const level = levels.get(name) ?? 'normal'
      if (level === 'hidden') continue
      allow.push(name)
      if (level === 'warn') discouraged.add(name)
    }
    const signature = `${allow.slice().sort().join('\u0000')}|warn:${[...discouraged].sort().join(',')}|mode:${store.modeOf(sessionId)}`
    const current = installed.get(sessionId)
    if (current !== undefined && current.signature === signature) return
    if (current !== undefined) {
      try {
        current.dispose()
      } catch (error) {
        warn(`lifting previous budget failed (${sessionId})`, error)
      }
      installed.delete(sessionId)
    }

    const disposers = []
    if (allow.length < restrictable.size) {
      try {
        disposers.push(agent.ctx.tools.restrict({ allow }))
      } catch (error) {
        warn(`restrict() failed (${sessionId})`, error)
      }
    }
    if (discouraged.size > 0) {
      try {
        disposers.push(
          agent.ctx.tools.guard((execution) => {
            const toolName = execution?.name
            if (typeof toolName !== 'string' || !discouraged.has(toolName)) return undefined
            const bucket = blockedCounts.get(sessionId) ?? new Map()
            bucket.set(toolName, (bucket.get(toolName) ?? 0) + 1)
            blockedCounts.set(sessionId, bucket)
            return t('warn.reason', { target: toolName })
          }),
        )
      } catch (error) {
        warn(`guard() failed (${sessionId})`, error)
      }
    }
    installed.set(sessionId, {
      signature,
      dispose: () => {
        for (const dispose of disposers) {
          try {
            dispose()
          } catch (error) {
            warn(`dispose failed (${sessionId})`, error)
          }
        }
      },
    })
  }

  function track(agent) {
    const sessionId = sessionIdOf(agent)
    if (sessionId === undefined) return
    live.set(sessionId, agent)
    syncSession(sessionId)
  }

  function forget(agent) {
    const sessionId = sessionIdOf(agent)
    if (sessionId === undefined) return
    live.delete(sessionId)
    const current = installed.get(sessionId)
    if (current !== undefined) {
      try {
        current.dispose()
      } catch (error) {
        warn(`dispose on agent dispose failed (${sessionId})`, error)
      }
      installed.delete(sessionId)
    }
  }

  // --- 生命周期接线 -------------------------------------------------------

  ctx.on('agent/created', (payload) => {
    const agent = payload?.agent ?? payload
    if (agent === undefined || agent === null) return
    try {
      track(agent)
    } catch (error) {
      warn('tracking a new agent failed', error)
    }
  })

  ctx.on('agent/disposed', (payload) => {
    const agent = payload?.agent ?? payload
    if (agent === undefined || agent === null) return
    try {
      forget(agent)
    } catch (error) {
      warn('forgetting a disposed agent failed', error)
    }
  })

  // 活会话的日志要等落盘才有 turn 记录；直接听 session/event 补上。
  const liveTurns = new Map()
  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'turn/start') return
    const id = String(session?.id ?? '')
    if (id === '') return
    liveTurns.set(id, (liveTurns.get(id) ?? 0) + 1)
  })

  let resyncTimer = null
  ctx.on('tools/change', () => {
    if (resyncTimer !== null) clearTimeout(resyncTimer)
    resyncTimer = setTimeout(() => {
      resyncTimer = null
      for (const sessionId of live.keys()) {
        try {
          syncSession(sessionId)
        } catch (error) {
          warn(`resync after tools/change failed (${sessionId})`, error)
        }
      }
    }, 250)
  })

  try {
    const existing = ctx.agents.list?.() ?? []
    for (const agent of existing) {
      try {
        track(agent)
      } catch (error) {
        warn('enumerating live agents failed', error)
      }
    }
  } catch (error) {
    warn('agents.list() failed', error)
  }

  // --- 上下文大小（成本估算用） -------------------------------------------

  function sessionLogOf(sessionId) {
    const root = path.join(os.homedir(), '.dsh', 'sessions')
    let workspaces = []
    try {
      workspaces = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    } catch {
      return undefined
    }
    const candidates = [sessionId, sessionId.startsWith('session-') ? sessionId : `session-${sessionId}`]
    for (const workspace of workspaces) {
      for (const candidate of candidates) {
        const file = path.join(root, workspace.name, candidate, 'session.v4.jsonl.zstd')
        try {
          const stat = fs.statSync(file)
          return { file, size: stat.size, mtime: stat.mtimeMs }
        } catch {
          // 换下一个候选
        }
      }
    }
    return undefined
  }

  /**
   * 当前上下文 token 数与平均每轮输入。优先用日志里 assistant 消息的 usage；
   * 没有 usage 时退回「字符数 / charsPerToken」的粗估，并标记 estimated。
   */
  function contextOf(sessionId) {
    const log = sessionLogOf(sessionId)
    if (log === undefined) return { contextTokens: 0, avgTurnTokens: 0, estimated: true }
    const cached = contextCache.get(sessionId)
    if (cached !== undefined && cached.size === log.size && cached.mtime === log.mtime) return cached
    let contextTokens = 0
    let avgTurnTokens = 0
    let estimated = true
    try {
      const text = decodeLog(fs.readFileSync(log.file))
      const turns = []
      for (const line of text.split('\n')) {
        if (!line.includes('"usage"')) continue
        try {
          const record = JSON.parse(line)
          const usage = record?.data?.usage ?? record?.usage
          if (usage === null || typeof usage !== 'object') continue
          const input = Number(usage.inputTokens ?? usage.input_tokens ?? usage.promptTokens ?? usage.prompt_tokens ?? 0)
          const cacheRead = Number(usage.cacheReadTokens ?? usage.cache_read_tokens ?? usage.cachedTokens ?? 0)
          const total = input + Math.max(0, cacheRead)
          if (Number.isFinite(total) && total > 0) {
            turns.push(total)
            estimated = false
          }
        } catch {
          // 坏行跳过
        }
      }
      if (turns.length > 0) {
        contextTokens = Math.max(...turns)
        avgTurnTokens = turns.reduce((sum, value) => sum + value, 0) / turns.length
      } else {
        contextTokens = text.length / 3.6
      }
    } catch (error) {
      warn(`reading the session log failed (${sessionId})`, error)
    }
    const value = { contextTokens: Math.round(contextTokens), avgTurnTokens: Math.round(avgTurnTokens), estimated }
    contextCache.set(sessionId, { ...value, size: log.size, mtime: log.mtime })
    return value
  }

  // 会话进行到第几轮：数日志里的 turn/start 记录（同一文件按 size+mtime 缓存）。
  // 会话日志所在的工作区目录名（~/.dsh/sessions/<workspace>/<session>/…），学习只在这个工作区里扫。
  function workspaceOf(sessionId) {
    const log = sessionLogOf(sessionId)
    if (log === undefined) return null
    return path.basename(path.dirname(path.dirname(log.file)))
  }

  const cwdCache = new Map()
  // 当前会话真实的工作区目录：Host 进程的 cwd 是 profile 目录，拿它学出来的包会指错地方。
  function cwdOf(sessionId) {
    const log = sessionLogOf(sessionId)
    if (log === undefined) return process.cwd()
    const cached = cwdCache.get(sessionId)
    if (cached !== undefined && cached.size === log.size && cached.mtime === log.mtime) return cached.cwd
    let cwd = process.cwd()
    try {
      const text = decodeLog(fs.readFileSync(log.file))
      const first = text.split('\n').find((line) => line.trim() !== '')
      if (first !== undefined) {
        const record = JSON.parse(first)
        if (typeof record?.data?.cwd === 'string' && record.data.cwd !== '') cwd = record.data.cwd
      }
    } catch {
      /* 读不出来就退回进程 cwd */
    }
    cwdCache.set(sessionId, { size: log.size, mtime: log.mtime, cwd })
    return cwd
  }

  function turnsOf(sessionId) {
    const log = sessionLogOf(sessionId)
    if (log === undefined) return 0
    const cached = turnsCache.get(sessionId)
    if (cached !== undefined && cached.size === log.size && cached.mtime === log.mtime) return cached.turns
    let turns = 0
    try {
      const text = decodeLog(fs.readFileSync(log.file))
      for (const line of text.split('\n')) {
        if (line.includes('"turn/start"')) turns += 1
      }
    } catch (error) {
      warn(`counting turns failed (${sessionId})`, error)
    }
    turnsCache.set(sessionId, { turns, size: log.size, mtime: log.mtime })
    return Math.max(turns, liveTurns.get(sessionId) ?? 0)
  }

  // --- 成本 ---------------------------------------------------------------

  function costFor(sessionId, catalog, levels) {
    let hiddenChars = 0
    let toolBlockChars = 0
    for (const tool of catalog.tools) {
      const chars = toolChars({ name: tool.name, description: tool.detail || tool.description, parameters: undefined })
      toolBlockChars += chars
      if (levels.get(tool.name) === 'hidden') hiddenChars += chars
    }
    const context = contextOf(sessionId)
    const settings = normalizeSettings(store.preferences().cost)
    const mode = store.modeOf(sessionId)
    // 常驻开销是三种模式的固有代价（ask/pin 的固定提示行、auto 的自愈说明），
    // 属于实现事实而非用户偏好，所以不开放修改。
    const overheadTokens = mode === 'off' ? 0 : mode === 'auto' ? DEFAULT_SETTINGS.modeAutoOverhead : DEFAULT_SETTINGS.modeQuietOverhead
    const result = estimate({
      hiddenChars,
      contextTokens: context.contextTokens,
      toolBlockTokens: Math.round(toolBlockChars / settings.charsPerToken),
      avgTurnTokens: context.avgTurnTokens,
      overheadTokens,
      settings,
    })
    return {
      ...result,
      settings: {
        ...result.settings,
        modeAutoOverhead: DEFAULT_SETTINGS.modeAutoOverhead,
        modeQuietOverhead: DEFAULT_SETTINGS.modeQuietOverhead,
      },
      mode,
      estimated: context.estimated,
      contextTokens: context.contextTokens,
      avgTurnTokens: context.avgTurnTokens,
    }
  }

  // 没显式选过包时等效于「全部保留」，所以那颗 chip 也要显示为选中。
  function chosenPackIds(session, packId) {
    const chosen = session.packs ?? []
    if (chosen.length === 0) return packId === store.packs()[0]?.id
    return chosen.includes(packId)
  }

  // --- 方案组合 -----------------------------------------------------------
  // 方案键：profile:<id>（保存的方案）或 pack:<id>（场景包 / 学习包 / 副本）。

  function planSessionOf(key) {
    const [kind, id] = String(key ?? '').split(':')
    if (kind === 'profile') {
      const profile = store.profiles().find((item) => item.id === id)
      if (profile === undefined) return null
      return {
        packs: [...(profile.packs ?? [])],
        levels: { ...(profile.levels ?? {}) },
        groupLevels: { ...(profile.groupLevels ?? {}) },
        pluginLevels: { ...(profile.pluginLevels ?? {}) },
      }
    }
    if (kind === 'pack') {
      const pack = store.pack(id)
      if (pack === null) return null
      return { packs: [pack.id], levels: {}, groupLevels: {}, pluginLevels: {} }
    }
    return null
  }

  // 勾选的若干方案合并成一个会话状态：包取并集，精细调整按勾选顺序叠加（后勾的覆盖先勾的）。
  function combinePlans(keys) {
    const packs = []
    const levels = {}
    const groupLevels = {}
    const pluginLevels = {}
    for (const key of keys) {
      const plan = planSessionOf(key)
      if (plan === null) continue
      for (const id of plan.packs) if (!packs.includes(id)) packs.push(id)
      Object.assign(levels, plan.levels)
      Object.assign(groupLevels, plan.groupLevels)
      Object.assign(pluginLevels, plan.pluginLevels)
    }
    const keepAll = store.packs()[0]?.id
    let normalized = packs.filter((id, index) => packs.indexOf(id) === index)
    if (keepAll !== undefined && normalized.includes(keepAll) && normalized.length > 1) {
      normalized = normalized.filter((id) => id !== keepAll)
    }
    normalized = normalizePacks(normalized, store.packs().map((item) => item.id))
    return { packs: normalized, levels, groupLevels, pluginLevels }
  }

  /**
   * 当前会话和它选中的方案差了多少：用于「已改动 N 处 · 保存 / 放弃」。
   * 只有保存过的方案可回写；预设包与预设方案只能另存为新方案。
   */
  function dirtyOf(sessionId, catalog, levels) {
    const session = sessionOf(sessionId)
    // 没有选方案时，基线就是「全部保留」：这时候的改动同样值得提示，保存只能另存为新方案。
    const key = typeof session.planId === 'string' && session.planId !== '' ? session.planId : 'pack:everything'
    const plan = planSessionOf(key)
    if (plan === null) return { active: false, count: 0 }
    const base = resolveLevels({ session: { ...plan, profileId: 'full' }, catalog: catalog.tools, packs: store.packs() }).levels
    const diff = diffLevels(effectiveLevels(sessionId, base), levels)
    const previewOnly = store.modeOf(sessionId) === 'off'
    const names = [...diff.hide, ...diff.show]
    const profile = key.startsWith('profile:') ? store.profile(key.slice('profile:'.length)) : null
    return {
      active: true,
      key,
      count: names.length,
      hide: diff.hide.length,
      show: diff.show.length,
      names: names.slice(0, 6),
      mutable: profile !== null && profile.kind !== 'builtin',
      previewOnly: previewOnly === true,
    }
  }

  // --- 面板状态 -----------------------------------------------------------

  function buildState(sessionId, options) {
    const detail = options?.detail === true
    const catalog = catalogOf(sessionId)
    const session = sessionOf(sessionId)
    const packs = store.packs()
    const { levels: storedLevels, activePacks } = levelsOf(sessionId, catalog)
    // off 模式只是停用：面板仍显示「如果切回 ask 会是什么样」，方便先调好再启用。
    const levels = store.modeOf(sessionId) === 'off' ? storedLevels : effectiveLevels(sessionId, storedLevels)
    const usage = usageCache.get(sessionId) ?? null
    const groups = new Map()
    const plugins = new Map()
    let enabled = 0
    let hidden = 0
    let warned = 0
    let core = 0
    let locked = 0

    for (const tool of catalog.tools) {
      const level = levels.get(tool.name) ?? 'normal'
      const calls = usage?.usage?.[tool.name] ?? null
      if (level === 'hidden') hidden += 1
      else enabled += 1
      if (level === 'warn') warned += 1
      if (tool.locked) locked += 1
      if (CORE_ALWAYS.has(tool.name)) core += 1
      let group = groups.get(tool.group)
      if (group === undefined) {
        group = { id: tool.group, label: tool.groupLabel, order: tool.groupOrder, tools: [], counts: { normal: 0, warn: 0, hidden: 0 }, calls: 0 }
        groups.set(tool.group, group)
      }
      const item = {
        name: tool.name,
        label: tool.label,
        level,
        plugin: tool.plugin,
        pluginLabel: tool.pluginLabel,
        locked: tool.locked,
        protection: tool.protection,
        description: tool.description,
        signature: tool.signature,
        detail: detail ? tool.detail : '',
        calls: calls === null ? null : { session: calls.session ?? 0, d30: calls.d30 ?? 0, all: calls.all ?? 0, last: calls.last ?? null },
      }
      group.tools.push(item)
      group.counts[level] += 1
      group.calls += calls === null ? 0 : calls.d30 ?? 0

      let plugin = plugins.get(tool.plugin)
      if (plugin === undefined) {
        plugin = { id: tool.plugin, label: tool.pluginLabel, kind: tool.pluginKind, tools: [], counts: { normal: 0, warn: 0, hidden: 0 }, calls: 0 }
        plugins.set(tool.plugin, plugin)
      }
      plugin.tools.push(item.name)
      plugin.counts[level] += 1
      plugin.calls += calls === null ? 0 : calls.d30 ?? 0
    }

    const orderedGroups = [...groups.values()].sort((left, right) => left.order - right.order || left.label.localeCompare(right.label))
    for (const group of orderedGroups) group.tools.sort((left, right) => left.label.localeCompare(right.label))
    const orderedPlugins = [...plugins.values()].sort((left, right) => right.tools.length - left.tools.length || left.label.localeCompare(right.label))

    const groupLabels = new Map(orderedGroups.map((group) => [group.id, group.label]))
    const expandPlan = (plan) => {
      const groupSet = new Set(plan.groups ?? [])
      const pluginSet = new Set(plan.plugins ?? [])
      for (const packId of plan.packs ?? []) {
        const pack = packs.find((item) => item.id === packId)
        if (pack === undefined) continue
        for (const group of pack.groups ?? []) groupSet.add(group)
        for (const plugin of pack.plugins ?? []) pluginSet.add(plugin)
      }
      return { groups: [...groupSet], plugins: [...pluginSet] }
    }
    const impactOf = (resolved) => {
      const groupSet = new Set(resolved.groups)
      const pluginSet = new Set(resolved.plugins)
      const keepAll = groupSet.has('*')
      let kept = 0
      let off = 0
      for (const tool of catalog.tools) {
        if (keepAll || groupSet.has(tool.group) || pluginSet.has(tool.plugin)) kept += 1
        else off += 1
      }
      return { kept, off }
    }
    const labelList = (resolved) => resolved.groups.filter((group) => group !== '*').map((group) => groupLabels.get(group) ?? group)
    const blocked = blockedCounts.get(sessionId) ?? new Map()
    const turns = turnsOf(sessionId)
    const charsByGroup = new Map()
    for (const tool of catalog.tools) {
      const chars = toolChars({ name: tool.name, description: tool.detail || tool.description })
      charsByGroup.set(tool.group, (charsByGroup.get(tool.group) ?? 0) + chars)
    }
    const tokenSettings = normalizeSettings(store.preferences().cost)
    const charsOfGroup = (groupId) => Math.round((charsByGroup.get(groupId) ?? 0) / tokenSettings.charsPerToken)
    // 每个方案套用之后会是什么样：用来回答「它和现在有没有区别、差在哪」。
    const groupOfName = new Map(catalog.tools.map((tool) => [tool.name, tool.groupLabel]))
    const labelsOf = (names) => {
      const seen = new Set()
      for (const name of names) seen.add(groupOfName.get(name) ?? name)
      return [...seen].slice(0, 4)
    }
    const diffOf = (planSession) => {
      const target = resolveLevels({ session: planSession, catalog: catalog.tools, packs }).levels
      const diff = diffLevels(levels, target)
      return { hide: diff.hide.length, show: diff.show.length, hideLabels: labelsOf(diff.hide), showLabels: labelsOf(diff.show), same: diff.same }
    }
    const basePlans = [
      ...store.profiles().map((profile) => {
        const resolved = expandPlan(profile)
        const planSession = {
          profileId: profile.id,
          packs: [...(profile.packs ?? [])],
          levels: { ...(profile.levels ?? {}) },
          groupLevels: { ...(profile.groupLevels ?? {}) },
          pluginLevels: { ...(profile.pluginLevels ?? {}) },
        }
        return {
          ...profile,
          key: `profile:${profile.id}`,
          kind: 'profile',
          builtin: profile.kind === 'builtin',
          source: profile.kind === 'builtin' ? 'builtin' : 'saved',
          origin: profile.kind === 'builtin' ? 'preset' : 'saved',
          candidate: false,
          deletable: profile.kind !== 'builtin',
          groups: resolved.groups,
          plugins: resolved.plugins,
          active: profile.id === (session.profileId ?? 'full'),
          impact: impactOf(resolved),
          keptLabels: labelList(resolved),
          diff: diffOf(planSession),
        }
      }),
      ...packs.map((pack) => {
        const resolved = expandPlan(pack)
        // 选包 = 按预设重来（清空精细调整），diff 必须按同样的语义算。
        const planSession = {
          profileId: 'full',
          packs: [pack.id],
          levels: {},
          groupLevels: {},
          pluginLevels: {},
        }
        return {
          ...pack,
          key: `pack:${pack.id}`,
          kind: pack.kind === 'learned' ? 'learned' : pack.kind === 'manual' ? 'manual' : 'pack',
          source: pack.kind === 'learned' ? 'learned' : pack.kind === 'manual' ? 'saved' : 'builtin',
          origin: pack.kind === 'builtin' || pack.kind === undefined ? 'preset' : 'saved',
          candidate: false,
          deletable: pack.kind !== 'builtin' && pack.kind !== undefined,
          groups: resolved.groups,
          plugins: resolved.plugins,
          active: activePacks.includes(pack.id),
          chosen: chosenPackIds(session, pack.id),
          impact: impactOf(resolved),
          keptLabels: labelList(resolved),
          diff: diffOf(planSession),
        }
      }),
    ]

    // 本轮学习的候选：由「被降权拦下过的工具」与「一次没调用过的组」推出来，
    // 只给建议，采用后才会变成普通方案，也才能被勾选。
    const sessionLearning = sessionAdjustments({
      groups: orderedGroups.map((group) => ({ id: group.id, label: group.label, tools: group.tools.map((tool) => tool.name) })),
      calls: Object.fromEntries(catalog.tools.map((tool) => [tool.name, usage?.usage?.[tool.name] ?? 0])),
      blocked: Object.fromEntries(blocked),
      levels,
      turns,
      thresholdTurns: Number(store.preferences().learnTurns ?? 3),
      protectedTools: PROTECTED,
      coreTools: CORE_ALWAYS,
    })
    const planItems = sessionLearning.items.map((item) => ({ ...item, tokens: charsOfGroup(item.group) }))
    const learned = (learner.status({ workspace: workspaceOf(sessionId) }).packs ?? []).filter((pack) => pack.adopted !== true)
    const learnedPlans = learned.map((pack) => {
      const groupSet = new Set(pack.groups ?? [])
      const targetLevels = new Map(
        catalog.tools.map((tool) => [tool.name, groupSet.has('*') || groupSet.has(tool.group) ? 'normal' : 'hidden']),
      )
      const diff = diffLevels(levels, targetLevels)
      const resolved = { groups: [...groupSet], plugins: [...(pack.plugins ?? [])] }
      return {
        ...pack,
        key: `learned:${pack.id}`,
        kind: 'learned',
        origin: 'learned',
        candidate: true,
        annotate: t('plan.candidateNote', { sessions: pack.source?.sessions ?? 0 }),
        active: false,
        chosen: false,
        deletable: false,
        groups: resolved.groups,
        plugins: resolved.plugins,
        impact: impactOf(resolved),
        keptLabels: labelList(resolved),
        diff: { hide: diff.hide.length, show: diff.show.length, hideLabels: labelsOf(diff.hide), showLabels: labelsOf(diff.show), same: diff.same },
      }
    })
    // 同一个方案键只留一条：学习候选重复、或某个包同时出现在两组里时不让面板出现双份。
    const seenKeys = new Set()
    const plans = [...basePlans, ...learnedPlans].filter((plan) => {
      const key = plan.key
      if (seenKeys.has(key)) return false
      seenKeys.add(key)
      return true
    })

    const mode = store.modeOf(sessionId)
    const builtins = builtinSnapshot(catalog.tools, store)
    if (builtins.changed) {
      store.setBuiltins({ ...builtins.snapshot, at: new Date().toISOString() })
    }
    return {
      ok: true,
      session: sessionId,
      live: live.has(sessionId),
      mode,
      modeActive: mode !== 'off',
      locale: store.preferences().locale,
      preferences: store.preferences(),
      counts: { total: catalog.tools.length, enabled, hidden, warned, core, locked },
      groups: orderedGroups,
      plugins: orderedPlugins,
      profiles: store.profiles().map((profile) => ({ ...profile, active: profile.id === (session.profileId ?? 'full') })),
      packs: packs.map((pack) => ({ ...pack, active: activePacks.includes(pack.id), chosen: chosenPackIds(session, pack.id) })),
      sessionState: { profileId: session.profileId ?? 'full', packs: session.packs ?? [], groupLevels: session.groupLevels ?? {}, pluginLevels: session.pluginLevels ?? {} },
      levels: Object.fromEntries(levels),
      plans,
      dirty: dirtyOf(sessionId, catalog, levels),
      sessionLearning: { ...sessionLearning, items: planItems },
      learnTurns: Number(store.preferences().learnTurns ?? 3),
      usageReady: usage !== null,
      learning: learner.status({ workspace: workspaceOf(sessionId) }),
      workspace: workspaceOf(sessionId),
      builtins: {
        total: builtins.total,
        changed: builtins.changed,
        at: builtins.changed ? new Date().toISOString() : builtins.prevAt,
        prevAt: builtins.prevAt,
        added: builtins.added.length,
        removed: builtins.removed.length,
        addedNames: builtins.added.slice(0, 5),
        removedNames: builtins.removed.slice(0, 5),
        deltas: builtins.deltas,
        impacts: builtins.impacts,
      },
      cost: costFor(sessionId, catalog, levels),
      updatedAt: new Date().toISOString(),
    }
  }

  // --- HTTP 基础设施 ------------------------------------------------------

  function send(res, status, payload) {
    const body = `${JSON.stringify(payload)}\n`
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    res.end(body)
  }

  async function readJsonBody(req) {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > MAX_BODY_BYTES) throw new Error(t('err.tooLarge'))
      chunks.push(chunk)
    }
    const text = Buffer.concat(chunks).toString('utf8').trim()
    if (text.length === 0) return {}
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object') throw new Error(t('err.body'))
    return parsed
  }

  function methodNotAllowed(res, allow) {
    res.writeHead(405, {
      allow,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(`${JSON.stringify({ ok: false, error: t('err.method', { method: 'unknown' }) })}\n`)
  }

  // --- 目标解析与变更 ----------------------------------------------------

  /**
   * 把 target 解析成工具名列表：支持 all、分组 id、分组标签、场景包名、
   * 方案名、精确工具名、前缀（mcp__rea__ / ops_）与通配（mcp__*）。
   */
  function resolveTargets(sessionId, target) {
    const needle = String(target ?? '').trim()
    if (needle.length === 0) return { names: [], error: t('err.target', { verb: 'on' }) }
    const catalog = catalogOf(sessionId)
    const all = catalog.tools.map((tool) => tool.name)
    if (needle === 'all' || needle === '*') return { names: all }
    if (needle.length > MAX_NAME_LENGTH) return { names: [], error: t('err.noMatch', { needle: needle.slice(0, 40) }) }

    const pack = store.packs().find((item) => item.id === needle || item.name === needle)
    if (pack !== undefined) {
      const covered = catalog.tools.filter((tool) => {
        for (const group of pack.groups ?? []) {
          if (group === '*' || group === tool.group) return true
          if (group.endsWith(':*') && tool.group.startsWith(group.slice(0, -1))) return true
        }
        return (pack.plugins ?? []).includes(tool.plugin)
      })
      return { names: covered.map((tool) => tool.name) }
    }

    const exact = all.filter((name) => name === needle)
    if (exact.length > 0) return { names: exact }
    const byGroup = catalog.tools.filter((tool) => tool.group === needle || tool.groupLabel === needle)
    if (byGroup.length > 0) return { names: byGroup.map((tool) => tool.name) }
    const byPlugin = catalog.tools.filter((tool) => tool.plugin === needle || tool.pluginLabel === needle)
    if (byPlugin.length > 0) return { names: byPlugin.map((tool) => tool.name) }
    if (needle.endsWith('*')) {
      const prefix = needle.slice(0, -1)
      const matched = all.filter((name) => name.startsWith(prefix))
      if (matched.length > 0) return { names: matched }
    }
    const startsWith = all.filter((name) => name.startsWith(needle))
    if (startsWith.length > 0) return { names: startsWith }
    return { names: [], error: t('err.noMatch', { needle }) }
  }

  // 方案被选中后，工具列表里的调整直接写回这个方案（用户决策：直接回写）。
  // 预设方案是只读的，回写只对「用户保存的方案」生效。
  function writeBackLevels(sessionId, mutate, enabled) {
    if (enabled !== true) return null
    const session = sessionOf(sessionId)
    const planId = session.planId
    if (typeof planId !== 'string' || !planId.startsWith('profile:')) return null
    const profile = store.profile(planId.slice('profile:'.length))
    if (profile === null || profile.kind === 'builtin') return null
    const draft = {
      levels: { ...(profile.levels ?? {}) },
      groupLevels: { ...(profile.groupLevels ?? {}) },
      pluginLevels: { ...(profile.pluginLevels ?? {}) },
    }
    mutate(draft)
    store.addProfile({ ...profile, ...draft })
    return profile.id
  }

  function setLevel(sessionId, names, level, options) {
    const confirm = options?.confirm === true
    const blocked = []
    const accepted = []
    for (const toolName of names) {
      const protection = protectionOf(toolName)
      if (CORE_ALWAYS.has(toolName)) {
        blocked.push({ name: toolName, protection: 'core' })
        continue
      }
      if (protection === 'protected' && level !== 'normal' && !confirm) {
        blocked.push({ name: toolName, protection: 'protected' })
        continue
      }
      accepted.push(toolName)
    }
    if (accepted.length === 0 && blocked.length > 0) {
      return { ok: false, needConfirm: true, blocked, error: t('err.core') }
    }
    const session = sessionOf(sessionId)
    const levels = { ...(session.levels ?? {}) }
    for (const toolName of accepted) {
      if (level === 'normal') delete levels[toolName]
      else levels[toolName] = level
    }
    store.patchSession(sessionId, { levels })
    const written = writeBackLevels(sessionId, (draft) => {
      for (const toolName of accepted) {
        if (level === 'normal') delete draft.levels[toolName]
        else draft.levels[toolName] = level
      }
    }, options?.writeBack)
    syncSession(sessionId)
    return { ok: true, changed: accepted.length, blocked, planId: written }
  }

  // --- 变更操作 -----------------------------------------------------------

  function applyOp(sessionId, body) {
    const op = typeof body.op === 'string' ? body.op : 'level'
    // off 模式只做预览：调级别可以，保存与应用一律等切回 ask。
    const needsLive = op === 'saveDirty' || op === 'savePlan' || op === 'profile' || op === 'pack' || op === 'packSet' || op === 'planSet' || op === 'adopt'
    if (needsLive && store.modeOf(sessionId) === 'off') return { ok: false, error: t('err.off') }
    if (op === 'level') {
      const name = typeof body.name === 'string' ? body.name : ''
      const level = LEVELS.includes(body.level) ? body.level : null
      if (name === '' || level === null) return { ok: false, error: t('err.target', { verb: 'on' }) }
      return setLevel(sessionId, [name], level, body)
    }
    if (op === 'group' || op === 'plugin') {
      const key = op === 'group' ? body.group : body.plugin
      const level = LEVELS.includes(body.level) ? body.level : null
      if (typeof key !== 'string' || level === null) return { ok: false, error: t('err.target', { verb: 'on' }) }
      const session = sessionOf(sessionId)
      const mapKey = op === 'group' ? 'groupLevels' : 'pluginLevels'
      const map = { ...(session[mapKey] ?? {}) }
      if (level === 'normal') delete map[key]
      else map[key] = level
      store.patchSession(sessionId, { [mapKey]: map })
      const written = writeBackLevels(sessionId, (draft) => {
        if (level === 'normal') delete draft[mapKey][key]
        else draft[mapKey][key] = level
      }, body.writeBack)
      syncSession(sessionId)
      return { ok: true, planId: written }
    }
    if (op === 'target') {
      const level = LEVELS.includes(body.level) ? body.level : 'hidden'
      const resolved = resolveTargets(sessionId, body.target)
      if (resolved.names.length === 0) return { ok: false, error: resolved.error ?? t('err.noMatch', { needle: String(body.target ?? '') }) }
      return setLevel(sessionId, resolved.names, level, body)
    }
    if (op === 'profile') {
      const profile = store.profile(String(body.profileId ?? ''))
      if (profile === null) return { ok: false, error: t('err.noMatch', { needle: String(body.profileId ?? '') }) }
      store.patchSession(sessionId, {
        profileId: profile.id,
        planId: `profile:${profile.id}`,
        packs: [...(profile.packs ?? [])],
        levels: { ...(profile.levels ?? {}) },
        groupLevels: { ...(profile.groupLevels ?? {}) },
        pluginLevels: { ...(profile.pluginLevels ?? {}) },
      })
      syncSession(sessionId)
      return { ok: true, profile: profile.id }
    }
    if (op === 'pack') {
      const pack = store.pack(String(body.packId ?? ''))
      if (pack === null) return { ok: false, error: t('err.noMatch', { needle: String(body.packId ?? '') }) }
      // 单选语义：点「应用」就是把这个方案设为当前，不切换、不清空别的包再拼组合。
      // 之前用 toggle，点一个已选中的包会把它取消，界面就会看起来「选的」和「生效的」不一致。
      const packs = [pack.id]
      // 选包就是「按这个预设重来」：之前逐个工具/分组/插件的精细调整一并清掉，
      // 否则会出现「选了全部保留但还有工具关着」。要保留调整就把它存成方案。
      store.patchSession(sessionId, { packs, profileId: 'full', planId: `pack:${pack.id}`, levels: {}, groupLevels: {}, pluginLevels: {} })
      syncSession(sessionId)
      return { ok: true, packs }
    }
    if (op === 'planSet') {
      // 多选组合：勾几个方案（场景包 / 学习包 / 保存的方案）就合并成一份，一次应用。
      const keys = (Array.isArray(body.plans) ? body.plans.filter((item) => typeof item === 'string') : []).filter(
        (key) => !key.startsWith('learned:'),
      )
      const combined = combinePlans(keys)
      store.patchSession(sessionId, { ...combined, profileId: 'full', planId: keys.length === 1 ? keys[0] : null })
      syncSession(sessionId)
      return { ok: true, packs: combined.packs, plans: keys }
    }
    if (op === 'packSet') {
      // 多选组合：一次写入一组包（并集生效），同样按「按预设重来」清掉精细调整。
      const packs = normalizePacks(Array.isArray(body.packs) ? body.packs : [], store.packs().map((item) => item.id))
      store.patchSession(sessionId, { packs, profileId: 'full', levels: {}, groupLevels: {}, pluginLevels: {} })
      syncSession(sessionId)
      return { ok: true, packs }
    }
    if (op === 'saveProfile') {
      const id = typeof body.id === 'string' && body.id !== '' ? body.id : `manual-${Date.now()}`
      const profile = profileFromSession(sessionOf(sessionId), { id, name: body.name })
      store.addProfile(profile)
      return { ok: true, profile }
    }
    if (op === 'deleteProfile') {
      return { ok: store.removeProfile(String(body.id ?? '')) }
    }
    if (op === 'copyPack') {
      const pack = store.pack(String(body.packId ?? ''))
      if (pack === null) return { ok: false, error: t('err.noMatch', { needle: String(body.packId ?? '') }) }
      const copy = {
        id: `manual-${Date.now()}`,
        kind: 'manual',
        name: typeof body.name === 'string' && body.name !== '' ? body.name : `${pack.name ?? pack.id} (copy)`,
        groups: [...(pack.groups ?? [])],
        plugins: [...(pack.plugins ?? [])],
        derivedFrom: pack.id,
      }
      store.addPack(copy)
      return { ok: true, pack: copy }
    }
    if (op === 'deletePack') {
      return { ok: store.removePack(String(body.id ?? '')) }
    }
    if (op === 'adoptLearned') {
      const learning = learner.status()
      const pack = (learning.packs ?? []).find((item) => item.id === body.packId)
      if (pack === undefined) return { ok: false, error: t('err.noMatch', { needle: String(body.packId ?? '') }) }
      store.addPack({ ...pack, kind: 'learned', status: 'ready' })
      return { ok: true, pack }
    }
    if (op === 'saveDirty') {
      const session = sessionOf(sessionId)
      const key = session.planId
      if (typeof key !== 'string' || !key.startsWith('profile:')) return { ok: false, needSaveAs: true }
      const profile = store.profile(key.slice('profile:'.length))
      if (profile === null || profile.kind === 'builtin') return { ok: false, needSaveAs: true }
      store.addProfile({
        ...profile,
        packs: [...(session.packs ?? [])],
        levels: { ...(session.levels ?? {}) },
        groupLevels: { ...(session.groupLevels ?? {}) },
        pluginLevels: { ...(session.pluginLevels ?? {}) },
      })
      return { ok: true, key, name: profile.name }
    }
    if (op === 'discardDirty') {
      const session = sessionOf(sessionId)
      const key = session.planId
      if (typeof key !== 'string' || key === '') {
        // 没有方案时，放弃改动就是回到「全部保留」。
        store.patchSession(sessionId, { packs: ['everything'], levels: {}, groupLevels: {}, pluginLevels: {}, profileId: 'full' })
        syncSession(sessionId)
        return { ok: true, key: 'pack:everything' }
      }
      const plan = planSessionOf(key)
      if (plan === null) return { ok: false, error: t('err.noMatch', { needle: String(key) }) }
      store.patchSession(sessionId, { ...plan, profileId: 'full', planId: key })
      syncSession(sessionId)
      return { ok: true, key }
    }
    if (op === 'rename') {
      const key = String(body.key ?? '')
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (name === '') return { ok: false, error: t('err.noMatch', { needle: key }) }
      if (key.startsWith('profile:')) {
        const profile = store.profile(key.slice('profile:'.length))
        if (profile === null) return { ok: false, error: t('err.noMatch', { needle: key }) }
        if (profile.kind === 'builtin') return { ok: false, error: t('err.core') }
        store.addProfile({ ...profile, name })
        return { ok: true, key, name }
      }
      if (key.startsWith('pack:')) {
        const pack = store.pack(key.slice('pack:'.length))
        if (pack === null) return { ok: false, error: t('err.noMatch', { needle: key }) }
        if (pack.kind === 'builtin' || pack.kind === undefined) return { ok: false, error: t('err.core') }
        store.addPack({ ...pack, name })
        return { ok: true, key, name }
      }
      return { ok: false, error: t('err.noMatch', { needle: key }) }
    }
    if (op === 'savePlan') {
      const keys = (Array.isArray(body.plans) ? body.plans.filter((item) => typeof item === 'string') : []).filter(
        (key) => !key.startsWith('learned:'),
      )
      const session = sessionOf(sessionId)
      const combined =
        keys.length === 0 && body.fromSession === true
          ? { packs: [...(session.packs ?? [])], levels: { ...(session.levels ?? {}) }, groupLevels: { ...(session.groupLevels ?? {}) }, pluginLevels: { ...(session.pluginLevels ?? {}) } }
          : combinePlans(keys)
      if (combined.packs.length === 0 && Object.keys(combined.levels).length === 0 && Object.keys(combined.groupLevels ?? {}).length === 0) {
        return { ok: false, error: t('err.target', { verb: 'save' }) }
      }
      const catalog = catalogOf(sessionId)
      const target = resolveLevels({ session: { ...sessionOf(sessionId), ...combined, profileId: 'full' }, catalog: catalog.tools, packs: store.packs() })
      const hash = planHash(target.levels)
      const duplicate = store.profiles().find((profile) => {
        if (profile.kind === 'builtin') return false
        return planHash(resolveLevels({ session: { ...profile, profileId: 'full' }, catalog: catalog.tools, packs: store.packs() }).levels) === hash
      })
      if (duplicate !== undefined && body.force !== true) {
        return { ok: false, needConfirm: true, duplicate: { key: `profile:${duplicate.id}`, name: duplicate.name } }
      }
      const id = `manual-${Date.now()}`
      const profile = { id, kind: 'manual', name: typeof body.name === 'string' && body.name.trim() !== '' ? body.name.trim() : t('plan.savedName', { n: keys.length }), packs: [...combined.packs], levels: { ...combined.levels }, groupLevels: { ...combined.groupLevels }, pluginLevels: { ...combined.pluginLevels } }
      store.addProfile(profile)
      store.patchSession(sessionId, { ...combined, planId: `profile:${id}`, profileId: id })
      syncSession(sessionId)
      return { ok: true, key: `profile:${id}`, name: profile.name }
    }
    if (op === 'adopt') {
      const learning = learner.status()
      const pack = (learning.packs ?? []).find((item) => item.id === body.packId)
      if (pack === undefined) return { ok: false, error: t('err.noMatch', { needle: String(body.packId ?? '') }) }
      const adopted = {
        id: `manual-${Date.now()}`,
        kind: 'manual',
        name: typeof body.name === 'string' && body.name.trim() !== '' ? body.name.trim() : pack.name ?? pack.id,
        groups: [...(pack.groups ?? [])],
        plugins: [...(pack.plugins ?? [])],
        derivedFrom: pack.id,
      }
      store.addPack(adopted)
      learner.markAdopted?.(pack.id)
      return { ok: true, key: `pack:${adopted.id}`, name: adopted.name }
    }
    if (op === 'refreshBuiltins') {
      const catalog = catalogOf(sessionId)
      const builtins = builtinSnapshot(catalog.tools, store)
      const at = new Date().toISOString()
      store.setBuiltins({ ...builtins.snapshot, at })
      return { ok: true, refreshed: true, at, changed: builtins.changed, added: builtins.added.length, removed: builtins.removed.length, deltas: builtins.deltas, impacts: builtins.impacts }
    }
    if (op === 'learnTurns') {
      const value = Number(body.turns)
      if (!Number.isFinite(value) || value < 1 || value > 20) return { ok: false, error: t('err.action', { action: String(body.turns ?? '') }) }
      store.setPreferences({ learnTurns: Math.round(value) })
      return { ok: true, learnTurns: Math.round(value) }
    }
    if (op === 'mode') {
      const mode = MODES.includes(body.mode) ? body.mode : null
      if (mode === null) return { ok: false, error: t('err.action', { action: String(body.mode ?? '') }) }
      // 模式影响工具描述（模型看到的那段话），是全局偏好，不是单会话状态。
      store.setPreferences({ mode })
      registerTool()
      return { ok: true, mode }
    }
    if (op === 'reset') {
      store.patchSession(sessionId, { levels: {}, groupLevels: {}, pluginLevels: {}, packs: ['everything'], profileId: 'full', planId: null })
      syncSession(sessionId)
      return { ok: true }
    }
    return { ok: false, error: t('err.action', { action: op }) }
  }

  // --- 路由处理器 ---------------------------------------------------------

  const stateHandler = async (req, res) => {
    let url
    try {
      url = new URL(req.url ?? ROUTE, 'http://localhost')
    } catch {
      send(res, 400, { ok: false, error: t('err.body') })
      return
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      const sessionId = canonicalSession(url.searchParams.get('session') ?? '')
      if (sessionId.length === 0) {
        send(res, 400, { ok: false, error: t('err.missingSession') })
        return
      }
      try {
        send(res, 200, buildState(sessionId, { detail: url.searchParams.get('detail') === '1' }))
      } catch (error) {
        warn('buildState failed', error)
        send(res, 500, { ok: false, error: String(error?.message ?? error) })
      }
      return
    }
    if (req.method !== 'POST') {
      methodNotAllowed(res, 'GET, HEAD, POST')
      return
    }
    try {
      const body = await readJsonBody(req)
      const sessionId = canonicalSession(typeof body.session === 'string' ? body.session : '')
      if (sessionId.length === 0) {
        send(res, 400, { ok: false, error: t('err.session') })
        return
      }
      const result = applyOp(sessionId, body)
      if (result.ok === false) {
        send(res, 400, result)
        return
      }
      send(res, 200, { ...result, ...buildState(sessionId), ok: true })
    } catch (error) {
      warn('state POST failed', error)
      send(res, 400, { ok: false, error: String(error?.message ?? error) })
    }
  }

  const usageHandler = async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      methodNotAllowed(res, 'GET, HEAD')
      return
    }
    const url = new URL(req.url ?? USAGE_ROUTE, 'http://localhost')
    const sessionId = canonicalSession(url.searchParams.get('session') ?? '')
    if (sessionId.length === 0) {
      send(res, 400, { ok: false, error: t('err.missingSession') })
      return
    }
    try {
      const result = await usageIndex.scan(sessionId)
      usageCache.set(sessionId, result)
      send(res, 200, result)
    } catch (error) {
      warn('usage scan failed', error)
      send(res, 500, { ok: false, error: String(error?.message ?? error) })
    }
  }

  const costHandler = async (req, res) => {
    const url = new URL(req.url ?? COST_ROUTE, 'http://localhost')
    // POST 用来预览「换上勾选的方案之后」的成本：仍然按当前模式的常驻开销算，
    // 但省下的 token 与首轮重付都按目标级别重算。
    if (req.method === 'POST') {
      let body
      try {
        body = await readJsonBody(req)
      } catch (error) {
        send(res, 400, { ok: false, error: String(error?.message ?? error) })
        return
      }
      const sessionId = canonicalSession(String(body.session ?? url.searchParams.get('session') ?? ''))
      if (sessionId.length === 0) {
        send(res, 400, { ok: false, error: t('err.missingSession') })
        return
      }
      const catalog = catalogOf(sessionId)
      const keys = Array.isArray(body.plans) ? body.plans.filter((item) => typeof item === 'string') : []
      const combined = combinePlans(keys)
      const target = resolveLevels({ session: { ...sessionOf(sessionId), ...combined }, catalog: catalog.tools, packs: store.packs() }).levels
      send(res, 200, { ok: true, pending: true, plans: keys, ...costFor(sessionId, catalog, effectiveLevels(sessionId, target)) })
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      methodNotAllowed(res, 'GET, HEAD, POST')
      return
    }
    const sessionId = canonicalSession(url.searchParams.get('session') ?? '')
    if (sessionId.length === 0) {
      send(res, 400, { ok: false, error: t('err.missingSession') })
      return
    }
    const catalog = catalogOf(sessionId)
    const { levels: storedLevels } = levelsOf(sessionId, catalog)
    send(res, 200, { ok: true, ...costFor(sessionId, catalog, effectiveLevels(sessionId, storedLevels)) })
  }

  const learningHandler = async (req, res) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      send(res, 200, { ok: true, ...learner.status() })
      return
    }
    if (req.method !== 'POST') {
      methodNotAllowed(res, 'GET, HEAD, POST')
      return
    }
    try {
      const body = await readJsonBody(req)
      const action = typeof body.action === 'string' ? body.action : 'start'
      if (action === 'start') {
        const target = canonicalSession(typeof body.session === 'string' ? body.session : '')
        void learner.scan({ cwd: cwdOf(target), workspace: workspaceOf(target), limit: 400 })
        send(res, 202, { ok: true, ...learner.status() })
        return
      }
      if (action === 'clear') {
        send(res, 200, { ok: true, ...learner.clear() })
        return
      }
      if (action === 'status') {
        send(res, 200, { ok: true, ...learner.status() })
        return
      }
      send(res, 400, { ok: false, error: t('err.action', { action }) })
    } catch (error) {
      warn('learning handler failed', error)
      send(res, 400, { ok: false, error: String(error?.message ?? error) })
    }
  }

  const preferencesHandler = async (req, res) => {
    if (req.method !== 'POST') {
      methodNotAllowed(res, 'POST')
      return
    }
    try {
      const body = await readJsonBody(req)
      const patch = {}
      if (body.locale !== undefined) patch.locale = normalizeLocale(body.locale)
      if (body.mode !== undefined && MODES.includes(body.mode)) patch.mode = body.mode
      if (body.view === 'group' || body.view === 'plugin') patch.view = body.view
      if (body.metric === 'session' || body.metric === 'd30' || body.metric === 'all') patch.metric = body.metric
      if (typeof body.sortByFreq === 'boolean') patch.sortByFreq = body.sortByFreq
      if (body.cost !== undefined) patch.cost = normalizeSettings(body.cost)
      const next = store.setPreferences(patch)
      if (patch.locale !== undefined) {
        setLocale(next.locale)
        registerTool()
      }
      send(res, 200, { ok: true, preferences: next })
    } catch (error) {
      warn('preferences handler failed', error)
      send(res, 400, { ok: false, error: String(error?.message ?? error) })
    }
  }

  // --- 工具与命令 ---------------------------------------------------------

  function toolDescription() {
    const mode = store.preferences().mode
    if (mode === 'pin') return t('tool.desc.pin')
    if (mode === 'ask') return t('tool.desc.ask')
    return t('tool.desc')
  }

  function definition() {
    return {
      name: TOOL_NAME,
      description: toolDescription(),
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'on', 'off', 'warn', 'reset', 'profile', 'pack', 'cost'],
            description: t('tool.action'),
          },
          target: { type: 'string', description: t('tool.target') },
        },
        required: ['action'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            summary: { type: 'string' },
            groups: { type: 'array', items: { type: 'object' } },
          },
        },
        render: (args, value) => {
          const summary = typeof value?.summary === 'string' ? value.summary : ''
          const lines = Array.isArray(value?.groups) ? value.groups : []
          const body = [summary, ...lines.map((line) => `- ${line}`)].filter((line) => typeof line === 'string' && line !== '').join('\n')
          return [{ type: 'text', text: body }]
        },
      },
      execute: async (args, exec) => runAction(exec.agent, args),
    }
  }

  let toolDispose = null
  function registerTool() {
    if (toolDispose !== null) {
      try {
        toolDispose()
      } catch (error) {
        warn('disposing the previous tool definition failed', error)
      }
      toolDispose = null
    }
    // 「不使用」：不注册工具入口，提示词里不留任何痕迹；面板与 /budget 仍可用。
    if (store.preferences().mode === 'off') return
    try {
      toolDispose = ctx.tools.register(definition())
    } catch (error) {
      warn('registering tool_budget failed', error)
    }
  }

  function agentOf(exec) {
    return exec?.agent ?? ctx.agents.currentInitiator?.()
  }

  function summaryOf(sessionId) {
    const state = buildState(sessionId)
    return {
      summary: `工具预算：${state.counts.enabled}/${state.counts.total} 可用（隐藏 ${state.counts.hidden}，降权 ${state.counts.warned}，方案 ${state.session.profileId}，模式 ${state.mode}）`,
      groups: state.groups.map((group) => {
        const hidden = group.counts.hidden
        return `${group.label}：${group.tools.length - hidden}/${group.tools.length} 可用${hidden > 0 ? `（隐藏 ${hidden}）` : ''}`
      }),
    }
  }

  async function runAction(agent, args) {
    const sessionId = sessionIdOf(agent)
    if (sessionId === undefined) return { ok: false, summary: t('err.session'), groups: [] }
    const action = typeof args?.action === 'string' ? args.action : 'list'
    const target = typeof args?.target === 'string' ? args.target : ''
    try {
      if (action === 'list') {
        const { summary, groups } = summaryOf(sessionId)
        return { ok: true, summary, groups }
      }
      if (action === 'cost') {
        const state = buildState(sessionId)
        return {
          ok: true,
          summary: `省 ${state.cost.savedTokens} token/轮，重付 ${state.cost.repayTokens} token，回本 ${state.cost.breakevenTurns ?? '∞'} 轮${state.cost.overThreshold ? '（超过阈值）' : ''}`,
          groups: [],
        }
      }
      if (action === 'profile') {
        const result = applyOp(sessionId, { op: 'profile', profileId: target })
        if (result.ok === false) return { ok: false, summary: result.error, groups: [] }
        const { summary, groups } = summaryOf(sessionId)
        return { ok: true, summary, groups }
      }
      if (action === 'pack') {
        const result = applyOp(sessionId, { op: 'pack', packId: target })
        if (result.ok === false) return { ok: false, summary: result.error, groups: [] }
        const { summary, groups } = summaryOf(sessionId)
        return { ok: true, summary, groups }
      }
      if (action === 'reset') {
        applyOp(sessionId, { op: 'reset' })
        const { summary, groups } = summaryOf(sessionId)
        return { ok: true, summary, groups }
      }
      const level = action === 'off' ? 'hidden' : action === 'warn' ? 'warn' : 'normal'
      const resolved = resolveTargets(sessionId, target === '' ? 'all' : target)
      if (resolved.names.length === 0) return { ok: false, summary: resolved.error ?? t('err.noMatch', { needle: target }), groups: [] }
      const result = setLevel(sessionId, resolved.names, level, {})
      if (result.ok === false) {
        const names = (result.blocked ?? []).map((item) => item.name).join(', ')
        return { ok: false, summary: `受保护的工具需要用户确认：${names}`, groups: [] }
      }
      const { summary, groups } = summaryOf(sessionId)
      return { ok: true, summary, groups }
    } catch (error) {
      warn('tool_budget action failed', error)
      return { ok: false, summary: String(error?.message ?? error), groups: [] }
    }
  }

  registerTool()

  ctx.inject(['commands'], (commandCtx) => {
    try {
      commandCtx.commands.register({
        name: 'budget',
        description: t('cmd.desc'),
        usage: t('cmd.hint'),
        execute: async (args, exec) => {
          const agent = agentOf(exec)
          const sessionId = sessionIdOf(agent)
          if (sessionId === undefined) return { text: t('err.session') }
          const text = String(args ?? '').trim()
          if (text === '' || text === 'list') {
            const { summary, groups } = summaryOf(sessionId)
            return { text: [summary, ...groups.map((line) => `- ${line}`)].join('\n') }
          }
          const [verb, ...rest] = text.split(/\s+/)
          const target = rest.join(' ')
          if (verb === 'reset') {
            applyOp(sessionId, { op: 'reset' })
            return { text: t('text.reset') }
          }
          if (verb === 'all') {
            const level = target === 'on' ? 'normal' : 'hidden'
            setLevel(sessionId, catalogOf(sessionId).tools.map((tool) => tool.name), level, {})
            return { text: `${level} 已应用` }
          }
          if (verb === 'on' || verb === 'off' || verb === 'warn') {
            const level = verb === 'on' ? 'normal' : verb === 'off' ? 'hidden' : 'warn'
            const resolved = resolveTargets(sessionId, target)
            if (resolved.names.length === 0) return { text: resolved.error ?? 'no match' }
            const result = setLevel(sessionId, resolved.names, level, {})
            if (result.ok === false) return { text: '受保护的工具需要用户在面板里确认' }
            return { text: `${verb} ${resolved.names.length} 个工具` }
          }
          return { text: t('cmd.hint') }
        },
      })
    } catch (error) {
      warn('registering the /budget command failed', error)
    }
  })

  ctx.inject(['webServer'], (webCtx) => {
    for (const [route, handler] of [
      [ROUTE, stateHandler],
      [USAGE_ROUTE, usageHandler],
      [COST_ROUTE, costHandler],
      [LEARNING_ROUTE, learningHandler],
      [PREFERENCES_ROUTE, preferencesHandler],
    ]) {
      try {
        webCtx.effect(() => webCtx.webServer.register({ kind: 'exact', path: route, handler }))
      } catch (error) {
        warn(`registering ${route} failed`, error)
      }
    }
  })
}
