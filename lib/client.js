// dsh-tool-budget — 会话级工具预算（浏览器半侧）
//
// 手写的 DSH 客户端 bundle：用 window.__ModuleLoader__.load 注册一个 factory，
// factory 收到同步 require，返回 { apply, inject }。不需要构建步骤。
//
// 挂载点：`conversation.composer.dock`（输入框卡片正下方那一条），按钮长在
// 对话框下面，面板经 portal 挂到 document.body（docked composer 会裁剪 fixed
// overlay，所以必须 portal 出去）。
//
// 数据面：同源 fetch 到 Host 半侧注册的五条路由。

window.__ModuleLoader__.load({
  id: 'dsh-tool-budget',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { createPortal } = require('react-dom')
    const h = React.createElement

    const ROUTE = '/tool-budget/state'
    const USAGE_ROUTE = '/tool-budget/usage'
    const LEARNING_ROUTE = '/tool-budget/learning'
    const PREFERENCES_ROUTE = '/tool-budget/preferences'

    const COLOR = {
      text: 'var(--dsw-alias-label-primary, #e6e6e6)',
      secondary: 'var(--dsw-alias-label-secondary, #b4b4b4)',
      caption: 'var(--dsw-alias-label-caption, #8b8b8b)',
      border: 'var(--dsw-alias-border-l2, #3a3a3a)',
      panel: 'var(--dsw-specific-input-major, #1e1e1e)',
      hover: 'var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.06))',
      accent: 'var(--dsw-alias-state-business-primary, #4d6bfe)',
      warn: 'var(--dsw-alias-state-warning-primary, #d89614)',
      ok: 'var(--dsw-alias-state-success-primary, #3fa45b)',
      danger: 'var(--dsw-alias-state-error-primary, #e5534b)',
      radius: 'var(--dsw-radius-panel, 16px)',
    }

    // ---------------------------------------------------------------------
    // 文案（客户端自己一份；Host 侧工具描述/命令输出另有 lib/i18n.js）
    // ---------------------------------------------------------------------

    const DICT = {
      'zh-CN': {
        button: '工具预算',
        title: '工具预算',
        close: '关闭',
        mode: '模式',
        'mode.auto': 'auto',
        'mode.ask': 'ask',
        'mode.pin': 'pin',
        'mode.hint': 'auto：模型可自行恢复；ask：模型停下来告诉你缺什么；pin：硬关闭，只能你恢复',
        'mode.auto.hint': '工具关多了它会把需要的组再打开；最省心，但要多留一点常驻说明。',
        'mode.ask.hint': '模型停下来告诉你缺哪个能力，你点一下恢复；默认，常驻说明最小。',
        'mode.pin.hint': '硬关闭：模型看不到这些工具，也不会自己恢复；最省，但错了要你手动开。',
        plan: '方案',
        'plan.title': '方案',
        'plan.note': '方案与场景包是同一件事：点一下就把工具组调成它的样子，可多选组合；也能把当前状态存成自己的方案。',
        'plan.impact': '保留 {kept} · 关闭 {off}',
        'plan.keep': '保留组：{groups}',
        manual: '自定义',
        'suggest.item': '{tools} 个工具',
        'suggest.reason.sleep': '近 30 天一次都没调用',
        'suggest.reason.wake': '近 30 天调用了 {calls} 次，但现在被关着',
        'suggest.sleepOne': '休眠',
        'suggest.resume': '恢复',
        'cost.perTurn': 'token/轮',
        'cost.overhead': '模式常驻 {tokens}',
        profiles: '方案',
        'profile.full': '全开',
        'profile.code': '写代码',
        'profile.research': '查资料',
        'profile.media': '出图',
        'profile.minimal': '极简',
        saveProfile: '存为方案',
        profileName: '方案名',
        packs: '场景包',
        'pack.everything': '全部保留',
        'pack.core': '只留基础',
        'pack.code': '代码 + 文件',
        'pack.research': '查资料 + 网页',
        'pack.media': '图像 + 设计',
        'pack.office': '办公文档',
        learned: '学习',
        view: '视图',
        'view.group': '按功能组',
        'view.plugin': '按插件',
        metric: '口径',
        'metric.session': '本会话',
        'metric.d30': '30 天',
        'metric.all': '全局',
        unused: '未用',
        closed: '已关闭',
        sort: '频率排序',
        'sort.off': '按分组',
        'sort.on': '按频率',
        normal: '开',
        warn: '降',
        hidden: '关',
        'level.hint': '开＝正常；降＝可见但调用会被拒绝；关＝从清单消失',
        locked: '会话固定',
        protected: '受保护',
        core: '核心',
        'counts.available': '{enabled}/{total} 可用',
        'counts.open': '开 {n}',
        'counts.warn': '降 {n}',
        'counts.closed': '关 {n}',
        'filter.closed': '已关闭 {n}',
        'pack.impact': '保留 {kept} · 关闭 {off}',
        'pack.note': '场景包把不属于它的组整套收起，可在下面逐组微调。',
        'counts.hidden': '隐藏 {hidden}',
        'counts.warned': '降权 {warned}',
        'counts.unused': '{n} 未用',
        allOff: '全关',
        allOn: '全开',
        expand: '展开',
        collapse: '收起',
        'suggest.title': '建议',
        'suggest.sleep': '休眠 {n} 个没调用过的组',
        'suggest.wake': '恢复 {n} 个被挡住但有调用的组',
        'suggest.apply': '应用',
        'suggest.empty': '暂无建议',
        'cost.title': '成本估算',
        'cost.saved': '每轮省 {tokens} token',
        'cost.repay': '切换重付 {tokens} token',
        'cost.breakeven': '约 {turns} 轮回本',
        'cost.over': '重付超过阈值（{tokens} token），不建议在会话中段切换',
        'cost.hint': '按「隐藏工具字符 / 每 token 字符数」估算每轮节省；切换一次工具清单会让其后上下文重新计费一次。',
        'cost.params': '参数',
        'cost.save': '保存参数',
        'cost.chars': '每 token 字符',
        'cost.miss': '失效比例',
        'cost.threshold': '阈值倍数',
        'cost.price': '输入价/百万',
        learning: '学习',
        'learning.idle': '还没学过',
        'learning.learning': '学习中…',
        'learning.ready': '已完成：{sessions} 个会话，{packs} 个包',
        'learning.failed': '学习失败：{error}',
        'learning.start': '开始学习',
        'learning.clear': '清除',
        'learning.adopt': '采用',
        'learning.source': '来源：本工作区 {sessions} 个会话，置信度 {confidence}',
        'confirm.title': '这些工具受保护，确认关闭？',
        'confirm.yes': '确认',
        'confirm.no': '取消',
        loading: '加载中…',
        'error.prefix': '工具预算不可用：',
        'footer.hint': '改动下一条消息生效；每次切换会让提示词前缀失效一次。',
        'lang.switch': 'EN',
      },
      en: {
        button: 'Tool budget',
        title: 'Tool budget',
        close: 'Close',
        mode: 'Mode',
        'mode.auto': 'auto',
        'mode.ask': 'ask',
        'mode.pin': 'pin',
        'mode.hint': 'auto: the model may restore tools itself; ask: it stops and tells you what is missing; pin: hard off, only you can restore',
        'mode.auto.hint': 'It re-opens the groups it needs when tools are missing; easiest, at the cost of a larger standing note.',
        'mode.ask.hint': 'It stops and tells you which capability is missing; you restore it with one click. Default, smallest standing note.',
        'mode.pin.hint': 'Hard off: the model never sees these tools and will not restore them; cheapest, but you fix mistakes by hand.',
        plan: 'Plans',
        'plan.title': 'Plans',
        'plan.note': 'Plans and packs are the same thing: one click shapes the tool groups; combine several, or save the current state as your own plan.',
        'plan.impact': '{kept} kept · {off} off',
        'plan.keep': 'Kept groups: {groups}',
        manual: 'Custom',
        'suggest.item': '{tools} tools',
        'suggest.reason.sleep': 'not called once in the last 30 days',
        'suggest.reason.wake': 'called {calls} times in the last 30 days, but currently off',
        'suggest.sleepOne': 'Sleep',
        'suggest.resume': 'Restore',
        'cost.perTurn': 'tokens/turn',
        'cost.overhead': 'Mode overhead {tokens}',
        profiles: 'Profiles',
        'profile.full': 'Full',
        'profile.code': 'Coding',
        'profile.research': 'Research',
        'profile.media': 'Media',
        'profile.minimal': 'Minimal',
        saveProfile: 'Save profile',
        profileName: 'Profile name',
        packs: 'Packs',
        'pack.everything': 'Everything',
        'pack.core': 'Basics only',
        'pack.code': 'Code + files',
        'pack.research': 'Research + web',
        'pack.media': 'Images + design',
        'pack.office': 'Office docs',
        learned: 'learned',
        view: 'View',
        'view.group': 'By group',
        'view.plugin': 'By plugin',
        metric: 'Metric',
        'metric.session': 'Session',
        'metric.d30': '30 days',
        'metric.all': 'All',
        unused: 'Unused',
        closed: 'Closed',
        sort: 'Sort',
        'sort.off': 'By group',
        'sort.on': 'By calls',
        normal: 'On',
        warn: 'Warn',
        hidden: 'Off',
        'level.hint': 'On = normal; Warn = listed but refused; Off = removed from the list',
        locked: 'session-fixed',
        protected: 'protected',
        core: 'core',
        'counts.available': '{enabled}/{total} available',
        'counts.open': '{n} on',
        'counts.warn': '{n} warn',
        'counts.closed': '{n} off',
        'filter.closed': 'Closed {n}',
        'pack.impact': '{kept} kept · {off} off',
        'pack.note': 'A pack puts every group outside it to sleep; fine-tune below.',
        'counts.hidden': '{hidden} hidden',
        'counts.warned': '{warned} discouraged',
        'counts.unused': '{n} unused',
        allOff: 'All off',
        allOn: 'All on',
        expand: 'Expand',
        collapse: 'Collapse',
        'suggest.title': 'Suggestions',
        'suggest.sleep': 'Sleep {n} groups that were never called',
        'suggest.wake': 'Restore {n} hidden groups that were used',
        'suggest.apply': 'Apply',
        'suggest.empty': 'Nothing to suggest',
        'cost.title': 'Cost estimate',
        'cost.saved': 'Saves {tokens} tokens per turn',
        'cost.repay': 'Re-pay {tokens} tokens on switch',
        'cost.breakeven': 'Breaks even after ~{turns} turns',
        'cost.over': 'Re-payment exceeds the threshold ({tokens} tokens); avoid switching mid-session',
        'cost.hint': 'Saved = hidden tool characters / chars-per-token. One switch re-bills the context after the tool block once.',
        'cost.params': 'Parameters',
        'cost.save': 'Save',
        'cost.chars': 'Chars/token',
        'cost.miss': 'Miss factor',
        'cost.threshold': 'Threshold ×',
        'cost.price': 'Price/M',
        learning: 'Learning',
        'learning.idle': 'Not learned yet',
        'learning.learning': 'Learning…',
        'learning.ready': 'Done: {sessions} sessions, {packs} packs',
        'learning.failed': 'Failed: {error}',
        'learning.start': 'Start learning',
        'learning.clear': 'Clear',
        'learning.adopt': 'Adopt',
        'learning.source': 'From {sessions} sessions in this workspace, confidence {confidence}',
        'confirm.title': 'These tools are protected. Turn them off anyway?',
        'confirm.yes': 'Confirm',
        'confirm.no': 'Cancel',
        loading: 'Loading…',
        'error.prefix': 'Tool budget unavailable: ',
        'footer.hint': 'Changes apply to the next message; each switch invalidates the prompt prefix once.',
        'lang.switch': '中文',
      },
    }

    function translator(locale) {
      const table = DICT[locale] ?? DICT['zh-CN']
      return (key, params) => {
        const text = table[key] ?? DICT['zh-CN'][key] ?? key
        if (params === undefined) return text
        return text.replace(/\{(\w+)\}/g, (whole, name) => (params[name] === undefined ? whole : String(params[name])))
      }
    }

    // ---------------------------------------------------------------------
    // 网络
    // ---------------------------------------------------------------------

    async function requestJson(url, options) {
      const response = await fetch(url, { credentials: 'same-origin', headers: { accept: 'application/json' }, ...options })
      if (!response.ok) {
        let detail = ''
        try {
          const body = await response.json()
          detail = typeof body?.error === 'string' ? `：${body.error}` : ''
        } catch {
          detail = ''
        }
        throw new Error(`HTTP ${response.status}${detail}`)
      }
      return response.json()
    }

    function requestState(sessionId) {
      return requestJson(`${ROUTE}?session=${encodeURIComponent(sessionId)}&detail=1`)
    }

    function requestUsage(sessionId) {
      return requestJson(`${USAGE_ROUTE}?session=${encodeURIComponent(sessionId)}`)
    }

    function postState(sessionId, payload) {
      return requestJson(ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session: sessionId, ...payload }),
      })
    }

    function postJson(url, payload) {
      return requestJson(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      })
    }

    // ---------------------------------------------------------------------
    // 小工具
    // ---------------------------------------------------------------------

    function compactNumber(value) {
      const number = Number(value) || 0
      if (number < 1000) return String(number)
      if (number < 1000000) return `${Math.round(number / 100) / 10}k`
      return `${Math.round(number / 100000) / 10}M`
    }

    const METRICS = ['session', 'd30', 'all']

    function callsOf(tool, metric) {
      const calls = tool?.calls
      if (calls === null || calls === undefined) return null
      return Number(calls[metric] ?? 0) || 0
    }

    function Chip({ label, active, onClick, title, badge }) {
      return h(
        'button',
        {
          type: 'button',
          title,
          onClick,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 10px',
            borderRadius: 999,
            fontSize: 12,
            cursor: 'pointer',
            color: active ? '#fff' : COLOR.secondary,
            background: active ? COLOR.accent : 'transparent',
            border: `1px solid ${active ? COLOR.accent : COLOR.border}`,
            lineHeight: '18px',
          },
        },
        label,
        badge === undefined || badge === null ? null : h('span', { style: { opacity: 0.7, fontSize: 10 } }, badge),
      )
    }

    function LevelPicker({ tool, t, onLevel, busy }) {
      if (tool.locked) {
        return h('span', { style: { fontSize: 10, color: COLOR.caption } }, t('locked'))
      }
      const levels = ['normal', 'warn', 'hidden']
      return h(
        'span',
        { style: { display: 'inline-flex', gap: 2 } },
        levels.map((level) =>
          h(
            'button',
            {
              key: level,
              type: 'button',
              title: t('level.hint'),
              disabled: busy,
              onClick: (event) => {
                event.stopPropagation()
                onLevel(tool, level)
              },
              'data-level': level,
              'data-tool-level': tool.name,
              style: {
                padding: '1px 6px',
                fontSize: 11,
                borderRadius: 5,
                cursor: busy ? 'default' : 'pointer',
                border: `1px solid ${tool.level === level ? COLOR.accent : 'transparent'}`,
                background: tool.level === level ? 'rgba(77,107,254,.18)' : 'transparent',
                color: tool.level === level ? COLOR.text : COLOR.caption,
              },
            },
            t(level),
          ),
        ),
      )
    }

    function ToolRow({ tool, t, metric, openDetail, toggleDetail, onLevel, busy }) {
      const calls = callsOf(tool, metric)
      const expandable = typeof tool.detail === 'string' && tool.detail !== ''
      const expanded = openDetail[tool.name] === true
      return h(
        'div',
        {
          'data-tool': tool.name,
          style: {
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto',
            gap: 8,
            alignItems: 'center',
            padding: '5px 8px 5px 6px',
            borderRadius: 8,
            borderLeft: `3px solid ${tool.level === 'hidden' ? COLOR.danger : tool.level === 'warn' ? COLOR.warn : 'transparent'}`,
          },
          onMouseEnter: (event) => {
            event.currentTarget.style.background = COLOR.hover
          },
          onMouseLeave: (event) => {
            event.currentTarget.style.background = 'transparent'
          },
        },
        h(
          'div',
          { style: { minWidth: 0 } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 } },
            h('span', { style: { fontSize: 12.5, color: tool.level === 'hidden' ? COLOR.caption : COLOR.text, textDecoration: tool.level === 'hidden' ? 'line-through' : 'none' } }, tool.label || tool.name),
            tool.signature === '' ? null : h('span', { style: { fontSize: 10.5, color: COLOR.caption, fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, tool.signature),
            tool.protection === null || tool.protection === undefined
              ? null
              : h('span', { style: { fontSize: 9.5, padding: '0 4px', borderRadius: 4, border: `1px solid ${COLOR.border}`, color: COLOR.caption } }, t(tool.protection)),
            calls === null
              ? null
              : calls === 0
                ? h('span', { style: { fontSize: 10, color: COLOR.caption, border: `1px dashed ${COLOR.border}`, borderRadius: 4, padding: '0 4px' } }, t('unused'))
                : h('span', { title: `${t(`metric.${metric}`)} ${calls}`, style: { fontSize: 10, color: COLOR.secondary, background: COLOR.hover, borderRadius: 4, padding: '0 4px' } }, compactNumber(calls)),
          ),
          tool.description === '' ? null : h(
            'div',
            { style: { fontSize: 11, color: COLOR.caption, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            expandable
              ? h(
                  'span',
                  {
                    'data-detail': tool.name,
                    style: { cursor: 'pointer', textDecoration: 'underline dotted' },
                    onClick: (event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      toggleDetail(tool.name)
                    },
                  },
                  tool.description,
                )
              : tool.description,
          ),
          expandable && expanded
            ? h('div', { 'data-detail-body': tool.name, style: { marginTop: 4, padding: 8, borderRadius: 8, background: COLOR.panel, border: `1px solid ${COLOR.border}`, fontSize: 11, color: COLOR.secondary, whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto', lineHeight: 1.6 } }, tool.detail)
            : null,
        ),
        h(LevelPicker, { tool, t, onLevel, busy }),
      )
    }

    function packStats(state, pack) {
      if (state === null || pack === null || pack === undefined || !Array.isArray(pack.groups)) return null
      const groups = new Set(pack.groups)
      const plugins = new Set(pack.plugins ?? [])
      const keepAll = groups.has('*')
      let kept = 0
      let off = 0
      for (const group of state.groups ?? []) {
        for (const tool of group.tools) {
          if (keepAll || groups.has(group.id) || plugins.has(tool.plugin)) kept += 1
          else off += 1
        }
      }
      return { kept, off }
    }

    function groupBlocks(state, view, t) {
      if (state === null) return []
      if (view === 'plugin') {
        const map = new Map()
        for (const group of state.groups ?? []) {
          for (const tool of group.tools) {
            const plugin = tool.plugin ?? 'other'
            let bucket = map.get(plugin)
            if (bucket === undefined) {
              bucket = { id: plugin, label: tool.pluginLabel ?? plugin, order: 0, tools: [], counts: { normal: 0, warn: 0, hidden: 0 }, calls: 0 }
              map.set(plugin, bucket)
            }
            bucket.tools.push(tool)
            bucket.counts[tool.level] += 1
          }
        }
        return [...map.values()].sort((left, right) => right.tools.length - left.tools.length)
      }
      return state.groups ?? []
    }

    function TreeView({ state, view, t, metric, unusedOnly, closedOnly = false, sortByFreq, expanded, onToggleBlock, openDetail, toggleDetail, onLevel, onGroup, busy }) {
      if (state === null) return h('div', { style: { padding: 24, textAlign: 'center', color: COLOR.caption, fontSize: 12 } }, t('loading'))
      const blocks = groupBlocks(state, view, t)
      const rendered = []
      for (const block of blocks) {
        const key = `${view}:${block.id}`
        // 默认收起；未用筛选时强制展开，否则筛完只剩一排收起的组头
        const isExpanded = expanded[key] === true || unusedOnly || closedOnly
        let tools = block.tools.filter((tool) => {
          if (closedOnly) return tool.level !== 'normal'
          if (!unusedOnly) return true
          const calls = callsOf(tool, metric)
          return calls !== null && calls === 0
        })
        if ((unusedOnly || closedOnly) && tools.length === 0) continue
        tools = [...tools].sort(sortByFreq ? (left, right) => (callsOf(right, metric) ?? 0) - (callsOf(left, metric) ?? 0) : (left, right) => (left.label ?? left.name).localeCompare(right.label ?? right.name))
        const hidden = tools.filter((tool) => tool.level === 'hidden').length
        const warned = tools.filter((tool) => tool.level === 'warn').length
        rendered.push(
          h(
            'div',
            {
              key,
              'data-group': block.id,
              'data-collapsed': isExpanded ? 'false' : 'true',
              style: {
                marginBottom: 10,
                border: `1px solid ${COLOR.border}`,
                borderRadius: 10,
                overflow: 'hidden',
              },
            },
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 10px',
                  background: COLOR.hover,
                  borderBottom: isExpanded ? `1px solid ${COLOR.border}` : 'none',
                },
              },
              h(
                'button',
                {
                  type: 'button',
                  'data-collapse': block.id,
                  'aria-expanded': isExpanded ? 'true' : 'false',
                  title: isExpanded ? t('collapse') : t('expand'),
                  onClick: () => onToggleBlock(key),
                  style: collapseButtonStyle,
                },
                h('span', { style: { fontSize: 10, color: COLOR.caption, width: 8, flexShrink: 0 } }, isExpanded ? '▾' : '▸'),
                h('span', { style: { fontSize: 12.5, fontWeight: 600, color: COLOR.text, textAlign: 'left', letterSpacing: 0.2 } }, block.label ?? block.id),
              ),
              h(
                'span',
                { style: { display: 'inline-flex', gap: 4, alignItems: 'center' } },
                unusedOnly
                  ? h('span', { style: countPillStyle }, t('counts.unused', { n: tools.length }))
                  : h('span', { style: { ...countPillStyle, color: COLOR.ok } }, t('counts.open', { n: tools.length - hidden })),
                warned === 0 ? null : h('span', { style: { ...countPillStyle, color: COLOR.warn } }, t('counts.warn', { n: warned })),
                hidden === 0 ? null : h('span', { style: { ...countPillStyle, color: COLOR.danger } }, t('counts.closed', { n: hidden })),
              ),
              h('span', { style: { flex: 1 } }),
              h('button', { type: 'button', disabled: busy, onClick: () => onGroup(block, 'hidden'), style: miniButtonStyle }, t('allOff')),
              h('button', { type: 'button', disabled: busy, onClick: () => onGroup(block, 'normal'), style: miniButtonStyle }, t('allOn')),
            ),
            isExpanded ? h('div', { style: { padding: '2px 4px 6px' } }, tools.map((tool) => h(ToolRow, { key: tool.name, tool, t, metric, openDetail, toggleDetail, onLevel, busy }))) : null,
          ),
        )
      }
      if (rendered.length === 0) return h('div', { style: { padding: 24, textAlign: 'center', color: COLOR.caption, fontSize: 12 } }, t('suggest.empty'))
      return rendered
    }

    const collapseButtonStyle = {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: 0,
      border: 'none',
      background: 'transparent',
      color: 'inherit',
      font: 'inherit',
      cursor: 'pointer',
      textAlign: 'left',
      maxWidth: '62%',
    }

    const countPillStyle = {
      padding: '0 7px',
      fontSize: 10,
      lineHeight: '16px',
      borderRadius: 999,
      border: `1px solid ${COLOR.border}`,
      color: COLOR.caption,
      fontVariantNumeric: 'tabular-nums',
    }

    const miniButtonStyle = {
      padding: '1px 8px',
      fontSize: 11,
      borderRadius: 999,
      border: `1px solid ${COLOR.border}`,
      background: 'transparent',
      color: COLOR.secondary,
      cursor: 'pointer',
    }

    // ---------------------------------------------------------------------
    // 错误边界：面板里任何渲染异常都不能把 composer 的 dock 子树带崩
    // ---------------------------------------------------------------------

    class PanelBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      componentDidCatch(error) {
        console.error('[tool-budget] panel render failed', error)
      }

      render() {
        if (this.state.error !== null) {
          return h(
            'div',
            {
              style: {
                position: 'fixed',
                left: '50%',
                bottom: 120,
                transform: 'translateX(-50%)',
                zIndex: 2147483000,
                padding: 16,
                borderRadius: 12,
                background: COLOR.panel,
                border: `1px solid ${COLOR.border}`,
                color: COLOR.text,
                fontSize: 12,
              },
            },
            `工具预算面板渲染失败：${String(this.state.error?.message ?? this.state.error)}`,
            h('button', { type: 'button', onClick: this.props.onClose, style: { marginLeft: 12, ...miniButtonStyle } }, '关闭'),
          )
        }
        return this.props.children
      }
    }

    // ---------------------------------------------------------------------
    // 面板
    // ---------------------------------------------------------------------

    function Section({ title, extra, children }) {
      return h(
        'div',
        { style: { padding: '9px 10px', borderTop: `1px solid ${COLOR.border}`, background: 'transparent' } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 } },
          h('span', { style: { width: 3, height: 11, borderRadius: 2, background: COLOR.accent, flexShrink: 0 } }),
          h('span', { style: { fontSize: 11, fontWeight: 600, color: COLOR.secondary, letterSpacing: 0.6 } }, title),
          h('span', { style: { flex: 1 } }),
          extra ?? null,
        ),
        children,
      )
    }

    function ToolPanel({ sessionId, anchor, onClose }) {
      const [state, setState] = React.useState(null)
      const [phase, setPhase] = React.useState('loading')
      const [error, setError] = React.useState('')
      const [metric, setMetric] = React.useState('session')
      const [unusedOnly, setUnusedOnly] = React.useState(false)
      const [closedOnly, setClosedOnly] = React.useState(false)
      const [view, setView] = React.useState('group')
      const [openDetail, setOpenDetail] = React.useState({})
      const [expandedGroups, setExpandedGroups] = React.useState({})
      const [busy, setBusy] = React.useState(false)
      const [confirming, setConfirming] = React.useState(null)
      const [costOpen, setCostOpen] = React.useState(false)
      const [profileName, setProfileName] = React.useState('')

      const locale = state?.locale === 'en' ? 'en' : 'zh-CN'
      const t = React.useMemo(() => translator(locale), [locale])
      const usageReady = phase === 'ready' && state !== null

      const applyState = React.useCallback((next) => {
        if (next === null || next === undefined) return
        if (next.state !== undefined) {
          setState(next.state)
          setPhase('ready')
        } else if (next.ok === true) {
          setState(next)
          setPhase('ready')
        }
      }, [])

      React.useEffect(() => {
        let alive = true
        setPhase('loading')
        Promise.all([requestState(sessionId), requestUsage(sessionId).catch(() => null)])
          .then(([next, usage]) => {
            if (!alive) return
            setState(next)
            setPhase('ready')
            if (usage !== null) setState((current) => (current === null ? current : { ...current, usage }))
          })
          .catch((cause) => {
            if (!alive) return
            setError(String(cause?.message ?? cause))
            setPhase('error')
          })
        return () => {
          alive = false
        }
      }, [sessionId])

      const refresh = React.useCallback(async () => {
        try {
          const next = await requestState(sessionId)
          applyState(next)
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        }
      }, [sessionId, applyState])

      const mutate = React.useCallback(
        async (payload) => {
          setBusy(true)
          try {
            const next = await postState(sessionId, payload)
            applyState(next)
            setConfirming(null)
          } catch (cause) {
            setError(String(cause?.message ?? cause))
          } finally {
            setBusy(false)
          }
        },
        [sessionId, applyState],
      )

      const onLevel = React.useCallback(
        (tool, level) => {
          if (tool.level === level) return
          if (tool.protection === 'protected' && level !== 'normal') {
            setConfirming({ kind: 'level', tools: [tool], level })
            return
          }
          void mutate({ op: 'level', name: tool.name, level })
        },
        [mutate],
      )

      const onGroup = React.useCallback(
        (block, level) => {
          const protectedTools = block.tools.filter((tool) => tool.protection === 'protected' && tool.level !== level)
          if (protectedTools.length > 0 && level !== 'normal') {
            setConfirming({ kind: 'group', block, level, tools: protectedTools })
            return
          }
          const op = view === 'plugin' ? 'plugin' : 'group'
          void mutate({ op, [op]: block.id, level })
        },
        [mutate, view],
      )

      const setMode = React.useCallback(
        async (mode) => {
          try {
            await postJson(PREFERENCES_ROUTE, { mode })
            await refresh()
          } catch (cause) {
            setError(String(cause?.message ?? cause))
          }
        },
        [refresh],
      )

      const switchLocale = React.useCallback(async () => {
        try {
          await postJson(PREFERENCES_ROUTE, { locale: locale === 'en' ? 'zh-CN' : 'en' })
          await refresh()
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        }
      }, [locale, refresh])

      const startLearning = React.useCallback(async () => {
        try {
          const next = await postJson(LEARNING_ROUTE, { action: 'start', session: sessionId })
          setState((current) => (current === null ? current : { ...current, learning: next }))
          const timer = setInterval(async () => {
            try {
              const status = await requestJson(LEARNING_ROUTE)
              setState((current) => (current === null ? current : { ...current, learning: status }))
              if (status.running !== true) clearInterval(timer)
              if (status.status === 'ready') void refresh()
            } catch {
              clearInterval(timer)
            }
          }, 1200)
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        }
      }, [refresh, sessionId])

      const adoptLearned = React.useCallback(
        async (packId) => {
          try {
            const next = await postState(sessionId, { op: 'adoptLearned', packId })
            if (next.ok === false) throw new Error(next.error ?? 'adopt failed')
            const learned = next.pack
            if (learned !== undefined) await postState(sessionId, { op: 'pack', packId: learned.id }).then(applyState)
          } catch (cause) {
            setError(String(cause?.message ?? cause))
          }
        },
        [sessionId, applyState],
      )

      const saveProfile = React.useCallback(async () => {
        if (profileName.trim() === '') return
        await mutate({ op: 'saveProfile', name: profileName.trim() })
        setProfileName('')
      }, [mutate, profileName])

      const saveCost = React.useCallback(
        async (form) => {
          try {
            await postJson(PREFERENCES_ROUTE, { cost: form })
            await refresh()
          } catch (cause) {
            setError(String(cause?.message ?? cause))
          }
        },
        [refresh],
      )

      const counts = state?.counts ?? null
      const suggestionsList = state?.suggestions ?? { sleep: [], wake: [] }
      const cost = state?.cost ?? null
      const net = cost === null ? 0 : cost.netPerTurnTokens ?? cost.savedTokens ?? 0

      const position = positionOf(anchor)
      const panel = h(
        PanelBoundary,
        { onClose },
        h(
          'div',
          {
            role: 'dialog',
            'aria-label': t('title'),
            style: {
              position: 'fixed',
              left: position.left,
              bottom: position.bottom,
              width: 620,
              maxWidth: 'calc(100vw - 24px)',
              maxHeight: '76vh',
              display: 'flex',
              flexDirection: 'column',
              borderRadius: COLOR.radius,
              border: `1px solid ${COLOR.border}`,
              background: COLOR.panel,
              color: COLOR.text,
              boxShadow: '0 18px 48px rgba(0,0,0,.32)',
              zIndex: 2147483000,
              overflow: 'hidden',
            },
          },
          // 标题栏
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: `1px solid ${COLOR.border}` } },
            h('span', { style: { fontSize: 13, fontWeight: 600 } }, t('title')),
            counts === null
              ? null
              : h('span', { style: { display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 11 } },
                  h('span', { style: { color: COLOR.ok } }, t('counts.open', { n: counts.enabled })),
                  counts.warned === 0 ? null : h('span', { style: { color: COLOR.warn } }, t('counts.warn', { n: counts.warned })),
                  counts.hidden === 0 ? null : h('span', { style: { color: COLOR.danger } }, t('counts.closed', { n: counts.hidden })),
                ),
            h('span', { style: { flex: 1 } }),
            h('button', { type: 'button', onClick: switchLocale, title: 'language', style: miniButtonStyle }, t('lang.switch')),
            h('button', { type: 'button', onClick: onClose, title: t('close'), style: miniButtonStyle }, '✕'),
          ),
          // 成本估算（放最上面，先看数字）
          cost === null
            ? null
            : h(
                'div',
                { style: { margin: '10px 10px 0', padding: '10px 12px', border: `1px solid ${COLOR.border}`, borderRadius: 10, background: COLOR.hover } },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' } },
                  h('span', { style: { fontSize: 10.5, fontWeight: 600, letterSpacing: 0.6, color: COLOR.caption } }, t('cost.title')),
                  h('span', { style: { fontSize: 22, fontWeight: 700, lineHeight: 1.2, color: net >= 0 ? COLOR.ok : COLOR.danger } }, `${net >= 0 ? '+' : '−'}${compactNumber(Math.abs(net))}`),
                  h('span', { style: { fontSize: 11, color: COLOR.caption } }, t('cost.perTurn')),
                  h('span', { style: { flex: 1 } }),
                  h('button', { type: 'button', onClick: () => setCostOpen((open) => !open), style: miniButtonStyle }, t('cost.params')),
                ),
                h(
                  'div',
                  { style: { marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 11, color: COLOR.secondary } },
                  h('span', null, t('cost.saved', { tokens: compactNumber(cost.savedTokens) })),
                  h('span', null, t('cost.overhead', { tokens: compactNumber(cost.overheadTokens ?? 0) })),
                  h('span', null, t('cost.repay', { tokens: compactNumber(cost.repayTokens) })),
                  cost.breakevenTurns === null ? null : h('span', null, t('cost.breakeven', { turns: cost.breakevenTurns })),
                ),
                cost.overThreshold ? h('div', { style: { marginTop: 5, fontSize: 11, color: COLOR.warn } }, t('cost.over', { tokens: compactNumber(cost.thresholdTokens) })) : null,
                h('div', { style: { marginTop: 4, fontSize: 10.5, color: COLOR.caption } }, t('cost.hint')),
                costOpen ? h(CostForm, { t, cost: cost.settings ?? {}, onSave: (form) => void saveCost(form) }) : null,
              ),
          // 建议（逐条写清是哪一组、为什么）
          h(
            Section,
            { title: t('suggest.title') },
            suggestionsList.sleep.length === 0 && suggestionsList.wake.length === 0
              ? h('span', { style: { fontSize: 11, color: COLOR.caption } }, t('suggest.empty'))
              : h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                  [...suggestionsList.sleep, ...suggestionsList.wake].map((item) =>
                    h(
                      'div',
                      { key: `${item.kind}:${item.group}`, style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 } },
                      h('span', { style: { fontWeight: 600, minWidth: 66 } }, item.label ?? item.group),
                      h('span', { style: { color: COLOR.caption, flexShrink: 0 } }, t('suggest.item', { tools: item.tools ?? (item.names ?? []).length })),
                      h('span', { style: { color: COLOR.caption, flex: 1, lineHeight: 1.4 } }, item.kind === 'wake' ? t('suggest.reason.wake', { calls: item.calls ?? 0 }) : t('suggest.reason.sleep')),
                      h(
                        'button',
                        {
                          type: 'button',
                          style: miniButtonStyle,
                          onClick: () => void mutate({ op: 'group', group: item.group, level: item.kind === 'wake' ? 'normal' : 'hidden' }),
                        },
                        item.kind === 'wake' ? t('suggest.resume') : t('suggest.sleepOne'),
                      ),
                    ),
                  ),
                  h(
                    'div',
                    { style: { display: 'flex', gap: 6, marginTop: 2 } },
                    suggestionsList.sleep.length === 0
                      ? null
                      : h(
                          'button',
                          {
                            type: 'button',
                            style: miniButtonStyle,
                            onClick: async () => {
                              for (const item of suggestionsList.sleep) await mutate({ op: 'group', group: item.group, level: 'hidden' })
                            },
                          },
                          t('suggest.sleep', { n: suggestionsList.sleep.length }),
                        ),
                    suggestionsList.wake.length === 0
                      ? null
                      : h(
                          'button',
                          {
                            type: 'button',
                            style: miniButtonStyle,
                            onClick: async () => {
                              for (const item of suggestionsList.wake) await mutate({ op: 'group', group: item.group, level: 'normal' })
                            },
                          },
                          t('suggest.wake', { n: suggestionsList.wake.length }),
                        ),
                  ),
                ),
          ),
          // 模式（名字加粗，说明一行一条）
          h(
            Section,
            { title: t('mode') },
            h(
              'div',
              { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
              ['auto', 'ask', 'pin'].map((mode) =>
                h(Chip, {
                  key: mode,
                  label: h('span', { style: { fontWeight: 700 } }, t(`mode.${mode}`)),
                  active: state?.mode === mode,
                  onClick: () => void setMode(mode),
                }),
              ),
            ),
            h(
              'div',
              { style: { marginTop: 7, display: 'flex', flexDirection: 'column', gap: 3 } },
              ['auto', 'ask', 'pin'].map((mode) =>
                h(
                  'div',
                  { key: `hint:${mode}`, style: { display: 'flex', gap: 6, fontSize: 10.5, lineHeight: 1.5, color: state?.mode === mode ? COLOR.text : COLOR.caption } },
                  h('span', { style: { minWidth: 34, flexShrink: 0, fontWeight: 600 } }, t(`mode.${mode}`)),
                  h('span', null, t(`mode.${mode}.hint`)),
                ),
              ),
            ),
          ),
          // 方案（方案 + 场景包 + 学习包，一件事）
          h(
            Section,
            { title: t('plan.title') },
            h(
              'div',
              { style: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' } },
              (state?.plans ?? []).map((plan) => {
                const translated = plan.kind === 'profile' ? t(`profile.${plan.id}`) : t(`pack.${plan.id}`)
                const label = translated === (plan.kind === 'profile' ? `profile.${plan.id}` : `pack.${plan.id}`) ? (plan.name ?? plan.id) : translated
                const impact = plan.impact ?? { kept: 0, off: 0 }
                return h(Chip, {
                  key: `${plan.kind}:${plan.id}`,
                  label,
                  active: plan.kind === 'profile' ? plan.active === true : plan.chosen === true,
                  badge: plan.kind === 'learned' ? t('learned') : plan.kind === 'manual' ? t('manual') : null,
                  title: `${label} · ${t('plan.impact', impact)}${(plan.keptLabels ?? []).length === 0 ? '' : ` · ${t('plan.keep', { groups: plan.keptLabels.join('、') })}`}`,
                  onClick: () => void mutate(plan.kind === 'profile' ? { op: 'profile', profileId: plan.id } : { op: 'pack', packId: plan.id }),
                })
              }),
              h('input', {
                value: profileName,
                placeholder: t('profileName'),
                onChange: (event) => setProfileName(event.target.value),
                style: { width: 108, fontSize: 11, padding: '3px 6px', borderRadius: 6, border: `1px solid ${COLOR.border}`, background: 'transparent', color: COLOR.text },
              }),
              h('button', { type: 'button', onClick: () => void saveProfile(), style: miniButtonStyle }, t('saveProfile')),
            ),
            h(
              'div',
              { style: { marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2, fontSize: 10.5, color: COLOR.caption } },
              (() => {
                const chosen = (state?.plans ?? []).filter((plan) => plan.kind !== 'profile' && plan.chosen === true)
                const active = (state?.plans ?? []).filter((plan) => plan.kind === 'profile' && plan.active === true)
                const rows = chosen.length > 0 ? chosen : active
                return rows.length === 0
                  ? null
                  : rows.map((plan) => {
                      const translated = plan.kind === 'profile' ? t(`profile.${plan.id}`) : t(`pack.${plan.id}`)
                      const label = translated === (plan.kind === 'profile' ? `profile.${plan.id}` : `pack.${plan.id}`) ? (plan.name ?? plan.id) : translated
                      const impact = plan.impact ?? { kept: 0, off: 0 }
                      const groups = (plan.keptLabels ?? []).filter((item) => item !== '*').slice(0, 5).join('、')
                      return h(
                        'div',
                        { key: `impact:${plan.kind}:${plan.id}` },
                        `${label}：${t('plan.impact', impact)}${groups === '' ? '' : ` · ${t('plan.keep', { groups })}`}`,
                      )
                    })
              })(),
            ),
            h('div', { style: { marginTop: 6, fontSize: 10.5, lineHeight: 1.5, color: COLOR.caption } }, t('plan.note')),
            (state?.learning?.packs ?? []).length === 0
              ? null
              : h(
                  'div',
                  { style: { marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 } },
                  (state.learning.packs ?? []).map((pack) =>
                    h(
                      'div',
                      { key: pack.id, style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: COLOR.secondary } },
                      h('span', { style: { flex: 1 } }, `${pack.name} · ${t('learning.source', { sessions: pack.source?.sessions ?? 0, confidence: Math.round((pack.source?.confidence ?? 0) * 100) })}`),
                      (state.packs ?? []).some((item) => item.id === pack.id)
                        ? h('span', { style: { color: COLOR.caption } }, t('learned'))
                        : h('button', { type: 'button', onClick: () => void adoptLearned(pack.id), style: miniButtonStyle }, t('learning.adopt')),
                    ),
                  ),
                ),
          ),
          // 工具栏
          h(
            'div',
            { style: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', padding: '6px 12px', borderTop: `1px solid ${COLOR.border}` } },
            ['group', 'plugin'].map((item) => h(Chip, { key: item, label: t(`view.${item}`), active: view === item, onClick: () => setView(item) })),
            h('span', { style: { width: 1, height: 16, background: COLOR.border } }),
            METRICS.map((item) => h(Chip, { key: item, label: t(`metric.${item}`), active: metric === item, onClick: () => setMetric(item) })),
            h('span', { style: { width: 1, height: 16, background: COLOR.border } }),
            h(Chip, {
              label: `${t('unused')}${state === null ? '' : ` ${countUnused(state, metric)}`}`,
              active: unusedOnly,
              onClick: () => {
                setUnusedOnly((value) => !value)
                setClosedOnly(false)
              },
            }),
            h(Chip, {
              label: `${t('closed')}${state === null ? '' : ` ${(counts?.hidden ?? 0) + (counts?.warned ?? 0)}`}`,
              active: closedOnly,
              title: t('level.hint'),
              onClick: () => {
                setClosedOnly((value) => !value)
                setUnusedOnly(false)
              },
            }),
            h('span', { style: { flex: 1 } }),
            h('button', {
              type: 'button',
              disabled: busy || !usageReady,
              onClick: () => void mutate({ op: 'target', target: 'all', level: 'normal' }),
              style: miniButtonStyle,
            }, t('allOn')),
          ),
          // 树
          h(
            'div',
            { style: { flex: 1, overflow: 'auto', padding: '4px 6px 12px' } },
            phase === 'error'
              ? h('div', { style: { padding: 24, textAlign: 'center', color: COLOR.warn, fontSize: 12 } }, `${t('error.prefix')}${error}`)
              : h(TreeView, { state, view, t, metric, unusedOnly, closedOnly, sortByFreq: true, expanded: expandedGroups, onToggleBlock: (key) => setExpandedGroups((current) => ({ ...current, [key]: current[key] !== true })), openDetail: openDetail, toggleDetail: (name) => setOpenDetail((current) => ({ ...current, [name]: current[name] !== true })), onLevel, onGroup, busy: busy || !usageReady }),
          ),
          // 学习 + 页脚
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderTop: `1px solid ${COLOR.border}`, fontSize: 11, color: COLOR.caption } },
            h('span', null, `${t('learning')}：${learningText(state, t)}`),
            h('span', { style: { flex: 1 } }),
            h('button', { type: 'button', disabled: busy, onClick: () => void startLearning(), style: miniButtonStyle }, t('learning.start')),
            h('span', { style: { fontSize: 10.5 } }, t('footer.hint')),
          ),
          confirming === null
            ? null
            : h(
                'div',
                { style: { padding: '8px 12px', borderTop: `1px solid ${COLOR.warn}`, background: 'rgba(216,150,20,.12)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 8, color: COLOR.text } },
                h('span', { style: { flex: 1 } }, `${t('confirm.title')} ${confirming.tools.map((tool) => tool.name).join(', ')}`),
                h('button', {
                  type: 'button',
                  style: miniButtonStyle,
                  onClick: () => {
                    const { kind, tools, level, block } = confirming
                    setConfirming(null)
                    if (kind === 'level') void mutate({ op: 'level', name: tools[0].name, level, confirm: true })
                    else {
                      const op = view === 'plugin' ? 'plugin' : 'group'
                      void mutate({ op, [op]: block.id, level, confirm: true })
                    }
                  },
                }, t('confirm.yes')),
                h('button', { type: 'button', style: miniButtonStyle, onClick: () => setConfirming(null) }, t('confirm.no')),
              ),
        ),
      )
      return createPortal(panel, document.body)
    }

    function countUnused(state, metric) {
      let total = 0
      for (const group of state?.groups ?? []) {
        for (const tool of group.tools) {
          const calls = callsOf(tool, metric)
          if (calls !== null && calls === 0) total += 1
        }
      }
      return total
    }

    function learningText(state, t) {
      const learning = state?.learning ?? { status: 'idle' }
      if (learning.status === 'learning' || learning.running === true) return t('learning.learning')
      if (learning.status === 'ready') return t('learning.ready', { sessions: learning.matched ?? 0, packs: (learning.packs ?? []).length })
      if (learning.status === 'failed') return t('learning.failed', { error: learning.error ?? '' })
      return t('learning.idle')
    }

    function CostForm({ t, cost, onSave }) {
      const [form, setForm] = React.useState({
        charsPerToken: cost.charsPerToken ?? 3.6,
        missFactor: cost.missFactor ?? 1,
        thresholdMultiplier: cost.thresholdMultiplier ?? 2,
        priceInput: cost.priceInput ?? 2,
      })
      const field = (key, label, step) =>
        h(
          'label',
          { key, style: { display: 'flex', flexDirection: 'column', gap: 2, fontSize: 10.5, color: COLOR.caption } },
          label,
          h('input', {
            type: 'number',
            step,
            value: form[key],
            onChange: (event) => setForm((current) => ({ ...current, [key]: Number(event.target.value) })),
            style: { width: 76, fontSize: 11, padding: '2px 6px', borderRadius: 6, border: `1px solid ${COLOR.border}`, background: 'transparent', color: COLOR.text },
          }),
        )
      return h(
        'div',
        { style: { display: 'flex', gap: 10, alignItems: 'flex-end', marginTop: 6, flexWrap: 'wrap' } },
        field('charsPerToken', t('cost.chars'), 0.1),
        field('missFactor', t('cost.miss'), 0.1),
        field('thresholdMultiplier', t('cost.threshold'), 0.5),
        field('priceInput', t('cost.price'), 0.1),
        h('button', { type: 'button', onClick: () => onSave(form), style: miniButtonStyle }, t('cost.save')),
      )
    }

    function positionOf(anchor) {
      try {
        const rect = anchor?.getBoundingClientRect?.()
        if (rect !== undefined && rect !== null && rect.width > 0) {
          const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - 640))
          return { left, bottom: Math.min(Math.max(12, window.innerHeight - rect.bottom + 44), window.innerHeight - 120) }
        }
      } catch {
        /* 没有 anchor 就用默认位置 */
      }
      return { left: 12, bottom: 96 }
    }

    // ---------------------------------------------------------------------
    // dock 按钮
    // ---------------------------------------------------------------------

    function ToolSwitchButton({ sessionId }) {
      const [open, setOpen] = React.useState(false)
      const [summary, setSummary] = React.useState(null)
      const anchorRef = React.useRef(null)

      const refreshSummary = React.useCallback(async () => {
        try {
          const next = await requestState(sessionId)
          setSummary({ counts: next.counts, mode: next.mode, locale: next.locale })
        } catch {
          setSummary(null)
        }
      }, [sessionId])

      React.useEffect(() => {
        void refreshSummary()
      }, [refreshSummary])

      const t = translator(summary?.locale === 'en' ? 'en' : 'zh-CN')
      const counts = summary?.counts ?? null
      const hidden = counts?.hidden ?? 0

      return h(
        React.Fragment,
        null,
        h(
          'button',
          {
            type: 'button',
            ref: anchorRef,
            'aria-label': t('button'),
            'data-tool-budget-button': 'true',
            onClick: () => setOpen((value) => !value),
            title: t('button'),
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '3px 10px',
              margin: '2px 4px',
              borderRadius: 999,
              border: `1px solid ${COLOR.border}`,
              background: 'transparent',
              color: COLOR.secondary,
              fontSize: 11.5,
              cursor: 'pointer',
              lineHeight: '18px',
            },
          },
          `⚙ ${t('button')}`,
          hidden === 0
            ? null
            : h(
                'span',
                {
                  style: { minWidth: 16, height: 16, padding: '0 4px', borderRadius: 999, background: COLOR.accent, color: '#fff', fontSize: 10, lineHeight: '16px', textAlign: 'center', fontWeight: 600 },
                },
                String(hidden),
              ),
        ),
        open
          ? h(PanelBoundary, {
              onClose: () => {
                setOpen(false)
                void refreshSummary()
              },
            }, h(ToolPanel, {
              sessionId,
              anchor: anchorRef.current,
              onClose: () => {
                setOpen(false)
                void refreshSummary()
              },
            }))
          : null,
      )
    }

    // ---------------------------------------------------------------------
    // 插件主体
    // ---------------------------------------------------------------------

    const inject = ['slots']

    function apply(ctx) {
      ctx.slots.inject('conversation.composer.dock', () =>
        ctx.slots.register(
          {
            name: 'conversation.composer.dock',
            id: 'tool-budget',
            order: 40,
            inject: (sessionId) => ({ sessionId }),
          },
          ToolSwitchButton,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    // 仅离线测试用（Host 侧 bundle loader 只用 apply / inject）：
    exports.__internals = { ToolPanel, ToolSwitchButton, PanelBoundary, translator, countUnused }
    return module.exports
  },
})
