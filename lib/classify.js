/**
 * 工具 → 插件 / 来源分类。
 *
 * 框架的 ToolDefinition 只有 name/description/parameters，没有 provenance
 * 字段，所以只能按命名约定推断：MCP 前缀最可靠，其次是各插件的命名前缀，
 * 最后落到「核心（框架自带）」或「其他」。
 */

const FREE_SEARCH = new Set([
  'free_search_test',
  'platform_search',
  'video_search',
  'advanced_search',
  'multi_search',
  'research',
  'cache_search',
  'domain_search',
  'weather',
])

const IMAGE = new Set([
  'generate_image',
  'generate_images',
  'edit_image',
  'canvas_state',
  'view_canvas',
  'find_inspiration',
  'present',
])

const CORE = new Set([
  'read',
  'write',
  'edit',
  'grep',
  'glob',
  'pwsh',
  'working_directory',
  'create_worktree',
  'job_list',
  'job_output',
  'job_kill',
  'spawn_teammate',
  'list_agents',
  'wait_agent',
  'send_message',
  'interrupt_agent',
  'ask_user_question',
  'todo_write',
  'create_goal',
  'get_goal',
  'update_goal',
  'schedule_create',
  'schedule_edit',
  'schedule_list',
  'schedule_view',
])

const RULES = [
  { id: 'dsh-ops', test: (name) => name.startsWith('ops_') },
  { id: 'dsh-doctor', test: (name) => name.startsWith('dsh_doctor') },
  { id: 'dsh-unlag', test: (name) => name.startsWith('unlag_') },
  { id: 'dsh-mnemon', test: (name) => name.startsWith('mnemon_') },
  { id: 'dsh-free-search', test: (name) => FREE_SEARCH.has(name) },
  { id: 'dsh-image-gen', test: (name) => IMAGE.has(name) },
  { id: 'dsh-tool-budget', test: (name) => name === 'tool_budget' || name === 'tool_switch' },
]

const MCP_PATTERN = /^mcp__([A-Za-z0-9_.-]+)__/

/**
 * @param {string} name
 * @returns {{ id: string, kind: 'core'|'plugin'|'mcp'|'other' }}
 */
export function pluginOf(name) {
  const tool = String(name ?? '')
  const mcp = MCP_PATTERN.exec(tool)
  if (mcp !== null) return { id: `mcp:${mcp[1]}`, kind: 'mcp' }
  for (const rule of RULES) {
    if (rule.test(tool)) return { id: rule.id, kind: 'plugin' }
  }
  if (CORE.has(tool)) return { id: 'core', kind: 'core' }
  const prefix = /^([A-Za-z][A-Za-z0-9]*)_/.exec(tool)?.[1]
  if (prefix !== undefined) return { id: `x:${prefix}`, kind: 'other' }
  return { id: 'other', kind: 'other' }
}

/** 面板里插件视图的显示名：MCP 服务器加后缀，其余就是包名。 */
export function pluginLabel(id) {
  if (id.startsWith('mcp:')) return `${id.slice(4)} · MCP`
  if (id === 'core') return 'core · 框架'
  if (id === 'other') return '其他'
  return id
}
