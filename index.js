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
import { BudgetStore, resolveLevels, suggestions, protectionOf, CORE_ALWAYS, PROTECTED, LEVELS, MODES } from './lib/profiles.js'
import { pluginOf, pluginLabel } from './lib/classify.js'
import { estimate, normalizeSettings, toolChars } from './lib/cost.js'
import { Learner } from './lib/learning.js'
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
  const learner = new Learner({ file: path.join(stateDir, 'learning.json'), groupOf: (toolName) => groupOf(toolName).id })
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
    const { levels } = levelsOf(sessionId, catalog)
    const restrictable = restrictableOf(agent)
    const allow = []
    const discouraged = new Set()
    for (const name of restrictable) {
      const level = levels.get(name) ?? 'normal'
      if (level === 'hidden') continue
      allow.push(name)
      if (level === 'warn') discouraged.add(name)
    }
    const signature = `${allow.slice().sort().join('\u0000')}|warn:${[...discouraged].sort().join(',')}`
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
    const result = estimate({
      hiddenChars,
      contextTokens: context.contextTokens,
      toolBlockTokens: Math.round(toolBlockChars / settings.charsPerToken),
      avgTurnTokens: context.avgTurnTokens,
      settings,
    })
    return { ...result, estimated: context.estimated, contextTokens: context.contextTokens, avgTurnTokens: context.avgTurnTokens }
  }

  // --- 面板状态 -----------------------------------------------------------

  function buildState(sessionId, options) {
    const detail = options?.detail === true
    const catalog = catalogOf(sessionId)
    const session = sessionOf(sessionId)
    const packs = store.packs()
    const { levels, activePacks } = levelsOf(sessionId, catalog)
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

    const mode = store.modeOf(sessionId)
    return {
      ok: true,
      session: sessionId,
      live: live.has(sessionId),
      mode,
      locale: store.preferences().locale,
      preferences: store.preferences(),
      counts: { total: catalog.tools.length, enabled, hidden, warned, core, locked },
      groups: orderedGroups,
      plugins: orderedPlugins,
      profiles: store.profiles().map((profile) => ({ ...profile, active: profile.id === (session.profileId ?? 'full') })),
      packs: packs.map((pack) => ({ ...pack, active: activePacks.includes(pack.id), chosen: (session.packs ?? []).includes(pack.id) })),
      sessionState: { profileId: session.profileId ?? 'full', packs: session.packs ?? [], groupLevels: session.groupLevels ?? {}, pluginLevels: session.pluginLevels ?? {} },
      levels: Object.fromEntries(levels),
      suggestions: suggestions({ catalog: catalog.tools, usage: usage?.usage, levels }),
      usageReady: usage !== null,
      learning: learner.status(),
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
    syncSession(sessionId)
    return { ok: true, changed: accepted.length, blocked }
  }

  // --- 变更操作 -----------------------------------------------------------

  function applyOp(sessionId, body) {
    const op = typeof body.op === 'string' ? body.op : 'level'
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
      syncSession(sessionId)
      return { ok: true }
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
      store.patchSession(sessionId, { profileId: profile.id, packs: [...(profile.packs ?? [])] })
      syncSession(sessionId)
      return { ok: true, profile: profile.id }
    }
    if (op === 'pack') {
      const pack = store.pack(String(body.packId ?? ''))
      if (pack === null) return { ok: false, error: t('err.noMatch', { needle: String(body.packId ?? '') }) }
      const session = sessionOf(sessionId)
      const chosen = new Set(session.packs ?? [])
      if (chosen.has(pack.id)) chosen.delete(pack.id)
      else chosen.add(pack.id)
      store.patchSession(sessionId, { packs: [...chosen] })
      syncSession(sessionId)
      return { ok: true, packs: [...chosen] }
    }
    if (op === 'saveProfile') {
      const id = typeof body.id === 'string' && body.id !== '' ? body.id : `manual-${Date.now()}`
      const profile = { id, kind: 'manual', packs: [...(sessionOf(sessionId).packs ?? [])] }
      if (typeof body.name === 'string' && body.name !== '') profile.name = body.name
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
    if (op === 'mode') {
      const mode = MODES.includes(body.mode) ? body.mode : null
      if (mode === null) return { ok: false, error: t('err.action', { action: String(body.mode ?? '') }) }
      // 模式影响工具描述（模型看到的那段话），是全局偏好，不是单会话状态。
      store.setPreferences({ mode })
      registerTool()
      return { ok: true, mode }
    }
    if (op === 'reset') {
      store.patchSession(sessionId, { levels: {}, groupLevels: {}, pluginLevels: {}, packs: ['everything'], profileId: 'full' })
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
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      methodNotAllowed(res, 'GET, HEAD')
      return
    }
    const url = new URL(req.url ?? COST_ROUTE, 'http://localhost')
    const sessionId = canonicalSession(url.searchParams.get('session') ?? '')
    if (sessionId.length === 0) {
      send(res, 400, { ok: false, error: t('err.missingSession') })
      return
    }
    const catalog = catalogOf(sessionId)
    const { levels } = levelsOf(sessionId, catalog)
    send(res, 200, { ok: true, ...costFor(sessionId, catalog, levels) })
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
        void learner.scan({ cwd: process.cwd() })
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
