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
    const COST_ROUTE = '/tool-budget/cost'

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
        'mode.off': 'off',
        'mode.hint': 'auto：模型可自行恢复；ask：模型停下来告诉你缺什么；pin：硬关闭，只能你恢复',
        'mode.subtitle': '关掉不用的工具能省钱，代价是模型看不见它们',
        'mode.auto.hint': '工具关多了它会把需要的组再打开；最省心，但要多留一点常驻说明。',
        'mode.ask.hint': '模型停下来告诉你缺哪个能力，你点一下恢复；默认，常驻说明最小。',
        'mode.off.hint': '插件完全不生效：工具全部可用，提示词里不加任何说明，工具入口也不注册（0 token）。',
        'mode.off.banner': '当前是 off：插件不生效，改动也不会应用。已保存的方案与级别都还在。',
        'mode.off.resume': '切回 ask',
        'dirty.offHint': 'off 模式下改动不生效，先切回 ask',
        plan: '方案',
        'plan.title': '方案',
        'plan.note': '方案就是一组工具开关：勾选一个或多个，点右侧「应用这组」一次生效；也能把当前状态存成自己的方案。',
        'plan.impact': '保留 {kept} · 关闭 {off}',
        'plan.same': '与你现在完全一样',
        'plan.current': '正在用',
        'plan.inactive': '不生效',
        'plan.apply': '应用',
        'plan.more': '比现在多关 {n} 个',
        'plan.less': '比现在少关 {n} 个（相当于恢复）',
        'plan.both': '比现在多关 {hide} 个、少关 {show} 个',
        'plan.groups': '涉及：{groups}',
        'plan.compose': '它本身留 {kept} · 关 {off}',
        'plan.legend': '「比现在多关/少关」是相对你当前状态；「它本身」是这个方案自己的留/关数量。',
        'plan.group.preset': '预设方案',
        'plan.group.saved': '我保存的',
        'plan.group.learned': '学习候选',
        'plan.adopt': '采用',
        'plan.adopted': '已采用：{name}',
        'plan.rename': '改名',
        'dirty.count': '已改动 {n} 处，还没写回方案',
        'dirty.save': '保存改动',
        'dirty.discard': '放弃改动',
        'dirty.saveAs': '另存为新方案',
        'dirty.saveAsDefault': '会话方案',
        'dirty.saved': '已写回「{name}」',
        'dirty.savedAs': '已另存为「{name}」',
        'dirty.discarded': '已放弃改动',
        'learn.turns.label': '轮次阈值',
        'learn.turns': '对话满 {n} 轮后给出本轮调整项',
        'learn.turns.save': '保存',
        'learn.items.empty': '对话满 {n} 轮后，这里会列出可以关掉或恢复的分组',
        'learn.scope.session': '本会话相关',
        'learn.scope.global': '全局建议',
        'learn.global.empty': '近 30 天没有被拦下、也没有一直没用的组',
        'dirty.changed': '已改动 {n} 处，可在顶部保存',
        'dirty.preview': '预览：已改 {n} 处（off 模式下不会生效）',
        'dirty.previewHint': '切回 ask 才能保存',
        'dirty.none': '在工具列表里改一改，改动会先记在这里，再决定保存还是放弃',
        'learn.item.sleep': '近 30 天没调用',
        'learn.item.restore': '被拦下 {n} 次',
        'learn.itemMeta': '{tools} 个工具 · {reason}',
        'learn.reason.sleep.session': '本会话没有调用过',
        'learn.reason.restore.session': '本会话被拦下 {n} 次',
        'learn.reason.sleep.global': '近 30 天没调用',
        'learn.reason.restore.global': '近 30 天调用过、现在被关着',
        'learn.undo': '撤销',
        'learn.undone': '已撤销：{name}',
        'learn.undo.hint': '刚改了「{name}」，可以撤销',
        'learn.collapse': '收起',
        'learn.expand': '展开',
        'learn.sleep': '关掉',
        'learn.restore': '恢复',
        'learn.done': '已调整：{name}',
        'cost.switch.head': '应用后重付 {repay} token 一次',
        'plan.keep': '保留组：{groups}',
        'plan.picked': '已选 {n} 个：{names}',
        'plan.preview': '这组组合生效后：保留 {kept} 个工具 · 关闭 {off} 个',
        'plan.applyAll': '应用这组',
        'plan.pickedTag': '已选',
        'plan.pick': '选进组合',
        'plan.unpick': '移出组合',
        'plan.source.builtin': '内置',
        'plan.source.saved': '已保存',
        'plan.source.learned': '学习生成',
        'plan.delete': '删除',
        'suggest.note': '这些按钮只改单个组，属于精细调整；点「应用这组」会按方案重来，把它们清掉。',
        'suggest.done.sleep': '已休眠 {n} 组：{names}',
        'suggest.done.wake': '已恢复 {n} 组：{names}',
        'cost.switch': '应用这组要重付一次上下文：省下 {saved} · 重付 {repay} · 净 {net}',
        'cost.switch.once': '重付只发生在切换那一刻，之后每轮按净省算。',
        'cost.estimating': '正在估算切换成本…',
        'learning.lastRun': '上一轮学习：{time} · {names}',
        'learning.copy': '复制成可调整的方案',
        'learning.copied': '已复制「{name}」，可以在方案里继续调整。',
        manual: '自定义',
        'suggest.item': '{tools} 个工具',
        'suggest.reason.sleep': '近 30 天一次都没调用',
        'suggest.reason.wake': '近 30 天调用了 {calls} 次，但现在被关着',
        'suggest.sleepOne': '休眠',
        'suggest.resume': '恢复',
        'cost.perTurn': 'token/轮',
        'cost.overhead': '模式常驻 {tokens}',
        'cost.projected': '切换后每轮约 {next} token（现在 {now}）',
        'cost.idle': '还没隐藏任何工具，所以没有省下的；这 {n} token 是模式说明本身的固定开销。',
        profiles: '方案',
        'profile.full': '全开',
        'profile.code': '写代码',
        'profile.research': '查资料',
        'profile.media': '出图',
        'profile.minimal': '极简',
        saveProfile: '存为方案',
        profileName: '方案名',
        packs: '方案包',
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
        'pack.note': '每个包包含的组是固定的，应用后还能在工具列表里逐组微调。',
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
        'cost.priceCache': '缓存价/百万',
        'cost.autoOver': 'auto 常驻',
        'cost.quietOver': 'ask/pin 常驻',
        learning: '学习',
        'learning.idle': '还没学过',
        'learning.learning': '学习中…',
        'learning.ready': '已完成：{sessions} 个会话，{packs} 个包',
        'learning.failed': '学习失败：{error}',
        'learning.start': '开始学习',
        'learning.clear': '清除',
        'learning.adopt': '采用',
        'learning.source': '来源：本工作区 {sessions} 个会话，置信度 {confidence}',
        'section.cost': '成本估算',
        'section.suggest': '建议',
        'section.mode': '模式',
        'section.plan': '方案',
        'section.tools': '工具列表',
        'tools.subtitle': '共 {total} 个，开 {open}',
        'cost.perTurnShort': '{tokens} token/轮',
        'cost.f.saved': '省下的：隐藏工具共 {chars} 字符 ÷ 每 token {cpt} 字符 = {tokens} token（每轮都省）',
        'cost.f.overhead': '常驻开销：{mode} 模式每轮多说 {tokens} token（auto {auto} / ask·pin {quiet}，可在参数里改）',
        'cost.f.repay': '首轮重付：上下文 {context} − 工具块 {block}，按失配率 {miss} 折算 = {tokens} token',
        'cost.f.net': '净省 = 省下的 − 常驻开销（首轮再减一次重付）',
        'cost.f.threshold': '红色阈值：平均每轮 {turn} token × {mult} 倍，重付超过它就标红',
        'cost.p.title': '参数含义',
        'cost.p.charsPerToken': '每 token 字符数：中文约 1.5、英文约 4，混排默认 3.6，决定「工具字符 → token」的换算',
        'cost.p.missFactor': '失配率：切换后从工具块到上下文末尾都要重算；0 表示全部命中缓存，1 表示全价重付',
        'cost.p.thresholdMultiplier': '阈值倍数：重付超过「平均每轮 token × 该倍数」就标红，默认 2',
        'cost.p.priceInput': '未命中价：元 / 百万 token，只影响金额显示',
        'cost.p.priceCache': '缓存命中价：元 / 百万 token，只影响金额显示',
        'cost.p.modeAutoOverhead': 'auto 常驻：auto 模式每轮的固定提示开销，固定 200，不可改',
        'cost.p.modeQuietOverhead': 'ask/pin 常驻：这两种模式的固定提示开销，固定 20，不可改',
        'suggest.subtitle': '{n} 组近 30 天没调用，休眠后每轮约省 {tokens} token',
        'suggest.subtitle.none': '暂时没有可以休眠的分组',
        'plan.subtitle': '勾选一个或多个方案，再点「应用这组」',
        'learned.explain': '学习包来自本工作区历史会话：名字是被同时用到的组，置信度 = 这些组同时出现的会话比例',
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
        'mode.hint': 'auto: the model may restore tools itself; ask: it stops and tells you what is missing; pin: hard off, only you can restore',
        'mode.subtitle': 'Turning off unused tools saves tokens, at the cost of the model not seeing them',
        'mode.auto.hint': 'It re-opens the groups it needs when tools are missing; easiest, at the cost of a larger standing note.',
        'mode.ask.hint': 'It stops and tells you which capability is missing; you restore it with one click. Default, smallest standing note.',
        'mode.pin.hint': 'Hard off: the model never sees these tools and will not restore them; cheapest, but you fix mistakes by hand.',
        'mode.off.hint': 'The plugin does nothing at all: every tool is available, no standing note, and the tool entry is not even registered (0 tokens).',
        'mode.off.banner': 'Mode off: the plugin is inert, so edits do not apply. Saved plans and levels are kept.',
        'mode.off.resume': 'Switch to ask',
        'dirty.offHint': 'Edits do not apply in off mode — switch to ask first',
        plan: 'Plans',
        'plan.title': 'Plans',
        'plan.note': 'Plans and packs are the same thing: tick several to take their union, apply once; you can also save the current state as your own plan.',
        'plan.impact': '{kept} kept · {off} off',
        'plan.same': 'Exactly what you have now',
        'plan.current': 'In use',
        'plan.inactive': 'Inactive',
        'plan.apply': 'Apply',
        'plan.more': 'Closes {n} more than now',
        'plan.less': 'Closes {n} fewer than now (restores them)',
        'plan.both': 'Closes {hide} more, {show} fewer than now',
        'plan.groups': 'Touches: {groups}',
        'plan.compose': 'On its own: keeps {kept} · closes {off}',
        'plan.legend': '"More/fewer than now" compares with your current state; "on its own" is what the plan contains.',
        'plan.group.preset': 'Preset plans',
        'plan.group.saved': 'My plans',
        'plan.group.learned': 'Learned candidates',
        'plan.adopt': 'Adopt',
        'plan.adopted': 'Adopted: {name}',
        'plan.rename': 'Rename',
        'dirty.count': '{n} unsaved change(s), not written to the plan yet',
        'dirty.save': 'Save changes',
        'dirty.discard': 'Discard',
        'dirty.saveAs': 'Save as new plan',
        'dirty.saveAsDefault': 'Session plan',
        'dirty.saved': 'Saved to "{name}"',
        'dirty.savedAs': 'Saved as "{name}"',
        'dirty.discarded': 'Changes discarded',
        'learn.turns.label': 'Turn threshold',
        'learn.turns': 'Suggest adjustments after {n} turns',
        'learn.turns.save': 'Save',
        'learn.items.empty': 'After {n} turns, groups worth hiding or restoring show up here',
        'learn.scope.session': 'This session',
        'learn.scope.global': 'Across sessions',
        'learn.global.empty': 'No blocked or long-unused groups in the last 30 days',
        'dirty.changed': '{n} unsaved changes — save them at the top',
        'dirty.preview': 'Preview: {n} edits (inert while off)',
        'dirty.previewHint': 'Switch to ask to save',
        'dirty.none': 'Change something in the tool list; edits show up here until you save or discard',
        'learn.item.sleep': 'not called in 30 days',
        'learn.item.restore': 'blocked {n} times',
        'learn.itemMeta': '{tools} tools · {reason}',
        'learn.reason.sleep.session': 'not called in this session',
        'learn.reason.restore.session': 'blocked {n} times in this session',
        'learn.reason.sleep.global': 'not called in 30 days',
        'learn.reason.restore.global': 'used in 30 days but now off',
        'learn.undo': 'Undo',
        'learn.undone': 'Undone: {name}',
        'learn.undo.hint': 'Just changed “{name}” — you can undo',
        'learn.collapse': 'Collapse',
        'learn.expand': 'Expand',
        'learn.sleep': 'Hide',
        'learn.restore': 'Restore',
        'learn.done': 'Adjusted: {name}',
        'cost.switch.head': 'Applying repays {repay} tokens once',
        'plan.keep': 'Kept groups: {groups}',
        'plan.picked': '{n} picked: {names}',
        'plan.preview': 'This combination keeps {kept} tools and closes {off}',
        'plan.applyAll': 'Apply these',
        'plan.pickedTag': 'Picked',
        'plan.pick': 'Add to combination',
        'plan.unpick': 'Remove from combination',
        'plan.source.builtin': 'Built-in',
        'plan.source.saved': 'Saved',
        'plan.source.learned': 'Learned',
        'plan.delete': 'Delete',
        'suggest.note': 'These buttons change one group only (fine tuning). Applying a plan resets everything and clears them.',
        'suggest.done.sleep': 'Hid {n} groups: {names}',
        'suggest.done.wake': 'Restored {n} groups: {names}',
        'cost.switch': 'Applying this costs one context re-pay: saves {saved} · re-pays {repay} · net {net}',
        'cost.switch.once': 'The re-pay happens once, at the switch; later turns follow the net saving.',
        'cost.estimating': 'Estimating the switch cost…',
        'learning.lastRun': 'Last run: {time} · {names}',
        'learning.copy': 'Copy as an editable plan',
        'learning.copied': 'Copied "{name}" — adjust it in Plans.',
        manual: 'Custom',
        'suggest.item': '{tools} tools',
        'suggest.reason.sleep': 'not called once in the last 30 days',
        'suggest.reason.wake': 'called {calls} times in the last 30 days, but currently off',
        'suggest.sleepOne': 'Sleep',
        'suggest.resume': 'Restore',
        'cost.perTurn': 'tokens/turn',
        'cost.overhead': 'Mode overhead {tokens}',
        'cost.projected': 'About {next} tokens per turn after switching (now {now})',
        'cost.idle': 'Nothing is hidden yet, so there is nothing saved; the {n} tokens are the mode sentence itself.',
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
        'cost.priceCache': 'Cached/M',
        'cost.autoOver': 'auto overhead',
        'cost.quietOver': 'ask/pin overhead',
        learning: 'Learning',
        'learning.idle': 'Not learned yet',
        'learning.learning': 'Learning…',
        'learning.ready': 'Done: {sessions} sessions, {packs} packs',
        'learning.failed': 'Failed: {error}',
        'learning.start': 'Start learning',
        'learning.clear': 'Clear',
        'learning.adopt': 'Adopt',
        'learning.source': 'From {sessions} sessions in this workspace, confidence {confidence}',
        'section.cost': 'Cost',
        'section.suggest': 'Suggestions',
        'section.mode': 'Mode',
        'section.plan': 'Plans',
        'section.tools': 'Tools',
        'tools.subtitle': '{open} of {total} on',
        'cost.perTurnShort': '{tokens} tokens/turn',
        'cost.f.saved': 'Saved: {chars} hidden characters ÷ {cpt} chars/token = {tokens} tokens per turn',
        'cost.f.overhead': 'Standing cost: {mode} adds {tokens} tokens per turn (auto {auto} / ask·pin {quiet}, editable)',
        'cost.f.repay': 'First-turn repay: context {context} − tool block {block}, at miss factor {miss} = {tokens} tokens',
        'cost.f.net': 'Net = saved − standing cost (minus one repay on the first turn)',
        'cost.f.threshold': 'Red threshold: average turn {turn} × {mult}; repay above it turns red',
        'cost.p.title': 'What the parameters mean',
        'cost.p.charsPerToken': 'Characters per token: ~1.5 Chinese, ~4 English, 3.6 mixed; converts characters to tokens',
        'cost.p.missFactor': 'Miss factor: after a switch everything from the tool block to the end is recomputed; 0 = all cached, 1 = full price',
        'cost.p.thresholdMultiplier': 'Threshold multiplier: repay above average-turn tokens × this value is flagged red (default 2)',
        'cost.p.priceInput': 'Miss price: currency per million tokens, display only',
        'cost.p.priceCache': 'Cached price: currency per million tokens, display only',
        'cost.p.modeAutoOverhead': 'auto standing: fixed prompt cost of the auto mode, 200, not editable',
        'cost.p.modeQuietOverhead': 'ask/pin standing: fixed prompt cost of these modes, 20, not editable',
        'suggest.subtitle': '{n} groups unused for 30 days; sleeping them saves about {tokens} tokens per turn',
        'suggest.subtitle.none': 'Nothing to suggest right now',
        'plan.subtitle': 'Tick one or more plans, then apply the combination',
        'learned.explain': 'Learned plans come from past sessions here: the name lists groups used together, confidence is the share of sessions that did',
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

    // state 只带「扫描那刻的快照」，真正的调用次数由 /tool-budget/usage 异步补上；
    // 没合并时 30 天/全局口径永远是 0，筛选会显示成「全部未用」。
    function mergeUsage(state, usage) {
      const map = usage?.usage ?? null
      if (state === null || map === null) return state
      const groups = (state.groups ?? []).map((group) => {
        let total = 0
        const tools = (group.tools ?? []).map((tool) => {
          const calls = map[tool.name] ?? null
          if (calls === null) return tool
          const merged = { session: calls.session ?? 0, d30: calls.d30 ?? 0, all: calls.all ?? 0, last: calls.last ?? null }
          total += merged.d30
          return { ...tool, calls: merged }
        })
        return { ...group, tools, calls: total }
      })
      const byName = new Map()
      for (const group of groups) for (const tool of group.tools) byName.set(tool.name, tool.calls?.d30 ?? 0)
      const plugins = (state.plugins ?? []).map((plugin) => {
        const names = Array.isArray(plugin.tools) ? plugin.tools : []
        if (names.length === 0) return plugin
        return { ...plugin, calls: names.reduce((sum, name) => sum + (byName.get(name) ?? 0), 0) }
      })
      return { ...state, groups, plugins }
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
        const isExpanded = expanded[key] === true
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

    function Section({ id, title, subtitle, extra, open, onToggle, children }) {
      return h(
        'div',
        { 'data-section': id, style: { borderTop: `1px solid ${COLOR.border}`, background: 'transparent' } },
        h(
          'button',
          {
            type: 'button',
            'data-section-toggle': id,
            'aria-expanded': open ? 'true' : 'false',
            onClick: onToggle,
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '9px 10px',
              border: 'none',
              background: 'transparent',
              color: 'inherit',
              font: 'inherit',
              cursor: 'pointer',
              textAlign: 'left',
            },
          },
          h('span', { style: { width: 3, height: 11, borderRadius: 2, background: COLOR.accent, flexShrink: 0 } }),
          h('span', { style: { fontSize: 11, fontWeight: 600, color: COLOR.secondary, letterSpacing: 0.6 } }, title),
          subtitle === null || subtitle === undefined || subtitle === '' ? null : h('span', { style: { fontSize: 10.5, fontWeight: 400, color: COLOR.caption } }, subtitle),
          h('span', { style: { flex: 1 } }),
          extra ?? null,
          h('span', { style: { fontSize: 10, color: COLOR.caption } }, open ? '▾' : '▸'),
        ),
        open ? h('div', { style: { padding: '0 10px 10px' } }, children) : null,
      )
    }

    function ToolPanel({ sessionId, anchor, onClose }) {
      const [state, setState] = React.useState(null)
      const [phase, setPhase] = React.useState('loading')
      const [error, setError] = React.useState('')
      const [metric, setMetric] = React.useState('session')
      const [usage, setUsage] = React.useState(null)
      const [unusedOnly, setUnusedOnly] = React.useState(false)
      const [closedOnly, setClosedOnly] = React.useState(false)
      const [view, setView] = React.useState('group')
      const [openDetail, setOpenDetail] = React.useState({})
      const [expandedGroups, setExpandedGroups] = React.useState({})
      const [busy, setBusy] = React.useState(false)
      const [confirming, setConfirming] = React.useState(null)
      const [feedback, setFeedback] = React.useState(null)
      const feedbackTimer = React.useRef(null)
      const notify = React.useCallback((text) => {
        setFeedback(text)
        if (feedbackTimer.current !== null) clearTimeout(feedbackTimer.current)
        feedbackTimer.current = setTimeout(() => setFeedback(null), 4000)
      }, [])
      const [costOpen, setCostOpen] = React.useState(false)
      const [profileName, setProfileName] = React.useState('')
      const [sections, setSections] = React.useState({ cost: true })
      const [picked, setPicked] = React.useState([])

      const locale = state?.locale === 'en' ? 'en' : 'zh-CN'
      const t = React.useMemo(() => translator(locale), [locale])
      const usageReady = phase === 'ready' && state !== null
      const planKeyOf = (plan) => (typeof plan?.key === 'string' ? plan.key : `${plan.kind === 'profile' ? 'profile' : 'pack'}:${plan.id}`)
      const keepAllKey = React.useMemo(() => {
        const first = (state?.packs ?? [])[0]
        return first === undefined ? 'pack:everything' : `pack:${first.id}`
      }, [state])
      const currentPicks = React.useCallback(() => {
        return (state?.plans ?? [])
          .filter((plan) => (plan.kind === 'profile' ? plan.active === true : plan.chosen === true))
          .map(planKeyOf)
      }, [state])
      const currentKeys = currentPicks()
      const chosenKey = (currentKeys.length > 0 ? currentKeys : [keepAllKey]).join('|')
      // 只在「当前生效的方案」变化时重设勾选：面板任何一次刷新都会换掉 state 对象，
      // 若把 currentPicks 放进依赖里，用户勾到一半的选择会被悄悄清空。
      const picksRef = React.useRef(currentPicks)
      picksRef.current = currentPicks
      React.useEffect(() => {
        const keys = picksRef.current()
        setPicked(keys.length > 0 ? [...keys] : [keepAllKey])
      }, [chosenKey, keepAllKey])

      const planLabelOf = React.useCallback(
        (key) => {
          const plan = (state?.plans ?? []).find((item) => planKeyOf(item) === key)
          if (plan === undefined) return key
          const ns = plan.kind === 'profile' ? `profile.${plan.id}` : `pack.${plan.id}`
          const translated = t(ns)
          return translated === ns ? (plan.name ?? plan.id) : translated
        },
        [state, t],
      )
      const togglePick = React.useCallback(
        (key) => {
          setPicked((current) => {
            if (key === keepAllKey) return [keepAllKey]
            const next = current.filter((item) => item !== keepAllKey)
            if (next.includes(key)) {
              const rest = next.filter((item) => item !== key)
              return rest.length === 0 ? [keepAllKey] : rest
            }
            return [...next, key]
          })
        },
        [keepAllKey],
      )
      const pickedKey = picked.join(',')
      const pendingSwitch = pickedKey !== chosenKey
      const [previewCost, setPreviewCost] = React.useState(null)
      React.useEffect(() => {
        if (!state || picked.length === 0 || pickedKey === chosenKey) {
          setPreviewCost(null)
          return undefined
        }
        let cancelled = false
        postJson(COST_ROUTE, { session: state.session, plans: picked })
          .then((result) => {
            if (!cancelled) setPreviewCost(result !== null && result.ok !== false ? result : null)
          })
          .catch(() => {
            if (!cancelled) setPreviewCost(null)
          })
        return () => {
          cancelled = true
        }
      }, [pickedKey, chosenKey, state])
      const pickedPreview = React.useMemo(() => {
        const groups = state?.groups ?? []
        const plans = state?.plans ?? []
        const groupSet = new Set()
        const pluginSet = new Set()
        let keepAll = false
        for (const key of picked) {
          const plan = plans.find((item) => planKeyOf(item) === key)
          if (plan === undefined) continue
          for (const id of plan.groups ?? []) {
            if (id === '*') keepAll = true
            else groupSet.add(id)
          }
          for (const id of plan.plugins ?? []) pluginSet.add(id)
        }
        let keptTools = 0
        let offTools = 0
        for (const group of groups) {
          const tools = group.tools ?? []
          const kept = keepAll || groupSet.has(group.id) || tools.some((tool) => pluginSet.has(tool.plugin))
          if (kept) keptTools += tools.length
          else offTools += tools.length
        }
        return { keptTools, offTools, names: picked.map(planLabelOf) }
      }, [picked, state, planLabelOf])

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
            setUsage(usage ?? null)
            setPhase('ready')
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
            const changed = next?.dirty
            if (changed?.active === true && changed.count > 0) notify(t(changed.previewOnly === true ? 'dirty.preview' : 'dirty.changed', { n: changed.count }))
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

      // 删除自己存的方案；内置场景包不可删，学习包走 deletePack。
      const removePlan = React.useCallback(
        async (plan) => {
          if (plan.kind === 'profile') await mutate({ op: 'deleteProfile', id: plan.id })
          else await mutate({ op: 'deletePack', id: plan.id })
        },
        [mutate],
      )

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
      const shown = React.useMemo(() => mergeUsage(state, usage), [state, usage])      const learningItems = state?.sessionLearning?.items ?? []
      const dirty = state?.dirty ?? { active: false, count: 0 }
      // 全局建议：和本会话无关，只看近 30 天有没有被用到、现在有没有被关着。
      const globalItems = React.useMemo(() => {
        const groups = shown?.groups ?? []
        const items = []
        for (const group of groups) {
          const tools = group.tools ?? []
          if (tools.length === 0) continue
          const guarded = tools.some((tool) => tool.protection === 'core' || tool.protection === 'protected')
          if (guarded) continue
          let used30 = 0
          let hidden = 0
          for (const tool of tools) {
            used30 += callsOf(tool, 'd30') ?? 0
            if (tool.level === 'hidden') hidden += 1
          }
          if (used30 === 0 && hidden === 0) {
            items.push({ kind: 'sleep', group: group.id, label: group.label, tools: tools.length })
          } else if (used30 > 0 && hidden > 0) {
            items.push({ kind: 'restore', group: group.id, label: group.label, tools: hidden })
          }
        }
        return items.slice(0, 8)
      }, [shown])
      const cost = state?.cost ?? null
      const net = cost === null ? 0 : cost.netPerTurnTokens ?? cost.savedTokens ?? 0
      const toggleSection = (id) => setSections((current) => ({ ...current, [id]: current[id] !== true }))
      const expandMatching = (kind) => {
        if (state === null) return
        const next = { ...expandedGroups }
        for (const block of groupBlocks(shown, view, t)) {
          const hit = (block.tools ?? []).some((tool) => (kind === 'unused' ? callsOf(tool, metric) === 0 : tool.level !== 'normal'))
          if (hit) next[`${view}:${block.id}`] = true
        }
        setExpandedGroups(next)
      }


      const [planOpen, setPlanOpen] = React.useState({ preset: true, saved: true, learned: true })
      const [renaming, setRenaming] = React.useState(null)
      const [turnsDraft, setTurnsDraft] = React.useState(3)
      const [learnOpen, setLearnOpen] = React.useState({ session: true, global: true })
      const [undoable, setUndoable] = React.useState({})
      React.useEffect(() => {
        if (state !== null && state.learnTurns !== undefined) setTurnsDraft(state.learnTurns)
      }, [state?.learnTurns, state])
      const planGroups = React.useMemo(() => {
        const all = (state?.plans ?? []).filter((plan) => !(plan.kind === 'profile' && plan.builtin === true))
        return {
          preset: all.filter((plan) => plan.origin === 'preset'),
          saved: all.filter((plan) => plan.origin === 'saved'),
          learned: all.filter((plan) => plan.origin === 'learned' || plan.candidate === true),
        }
      }, [state])
      const adoptPlan = async (plan) => {
        const result = await mutate({ op: 'adopt', packId: plan.id })
        if (result?.ok === true) notify(t('plan.adopted', { name: result.name ?? plan.name ?? plan.id }))
      }
      const renamePlan = async (key, name) => {
        if (name.trim() === '') return
        await mutate({ op: 'rename', key, name: name.trim() })
        setRenaming(null)
      }
      const saveDirty = async () => {
        const result = await mutate({ op: 'saveDirty' })
        if (result?.needSaveAs === true) {
          const created = await mutate({ op: 'savePlan', fromSession: true, name: profileName || t('dirty.saveAsDefault') })
          if (created?.ok === true) notify(t('dirty.savedAs', { name: created.name }))
        } else if (result?.ok === true) {
          notify(t('dirty.saved', { name: result.name ?? '' }))
        }
      }
      const discardDirty = async () => {
        await mutate({ op: 'discardDirty' })
        notify(t('dirty.discarded'))
      }
      function learnRow(item, scope) {
        const reason = item.kind === 'restore'
          ? t(scope === 'session' ? 'learn.reason.restore.session' : 'learn.reason.restore.global', { n: item.calls ?? 0 })
          : t(scope === 'session' ? 'learn.reason.sleep.session' : 'learn.reason.sleep.global')
        const key = `${item.kind}:${item.group}`
        const undo = undoable[key]
        return h(
          'div',
          { key: `${scope}:${item.group}`, style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: COLOR.secondary } },
          h('span', { style: { fontWeight: 600 } }, item.label),
          h('span', { style: { flex: 1, fontSize: 10, color: COLOR.caption } }, t('learn.itemMeta', { tools: item.tools ?? 0, reason })),
          undo === undefined
            ? h(
                'button',
                {
                  type: 'button',
                  'data-learn-act': key,
                  onClick: async () => {
                    await mutate({ op: 'group', group: item.group, level: item.kind === 'restore' ? 'normal' : 'hidden' })
                    setUndoable((prev) => ({ ...prev, [key]: { group: item.group, label: item.label, kind: item.kind } }))
                    notify(t('learn.done', { name: item.label }))
                  },
                  style: miniButtonStyle,
                },
                item.kind === 'restore' ? t('learn.restore') : t('learn.sleep'),
              )
            : h(
                'button',
                {
                  type: 'button',
                  'data-learn-undo': key,
                  title: t('learn.undo'),
                  onClick: async () => {
                    await mutate({ op: 'group', group: item.group, level: item.kind === 'sleep' ? 'normal' : 'hidden' })
                    setUndoable((prev) => { const next = { ...prev }; delete next[key]; return next })
                    notify(t('learn.undone', { name: item.label }))
                  },
                  style: { ...miniButtonStyle, border: `1px solid ${COLOR.warn}`, color: COLOR.warn, fontWeight: 600 },
                },
                `↺ ${t('learn.undo')}`,
              ),
        )
      }
      function renderPlanRow(plan) {
          const translated = plan.kind === 'profile' ? t(`profile.${plan.id}`) : t(`pack.${plan.id}`)
          const label = translated === (plan.kind === 'profile' ? `profile.${plan.id}` : `pack.${plan.id}`) ? (plan.name ?? plan.id) : translated
          const impact = plan.impact ?? { kept: 0, off: 0 }
          const diff = plan.diff ?? { hide: 0, show: 0, hideLabels: [], showLabels: [], same: true }
          const current = plan.kind === 'profile' ? plan.active === true : plan.chosen === true
          const key = planKeyOf(plan)
          const isPicked = picked.includes(key)
          const candidate = plan.candidate === true
          const editing = renaming !== null && renaming.key === key
          const touched =
            diff.hide > 0 && diff.show > 0
              ? [...(diff.hideLabels ?? []), ...(diff.showLabels ?? [])]
              : diff.hide > 0
                ? diff.hideLabels ?? []
                : diff.showLabels ?? []
          const delta = diff.same
            ? t('plan.same')
            : diff.hide > 0 && diff.show > 0
              ? t('plan.both', { hide: diff.hide, show: diff.show })
              : diff.hide > 0
                ? t('plan.more', { n: diff.hide })
                : t('plan.less', { n: diff.show })
          const deltaColor = diff.same ? COLOR.caption : diff.hide > 0 ? COLOR.warn : COLOR.ok
          const badge = plan.source === 'learned' ? t('plan.source.learned') : plan.source === 'saved' ? t('plan.source.saved') : t('plan.source.builtin')
          return h(
            'div',
            {
              key: `${plan.kind}:${plan.id}`,
              'data-plan': `${plan.kind}:${plan.id}`,
              'data-plan-same': diff.same ? 'true' : 'false',
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '5px 7px',
                borderRadius: 8,
                border: `1px solid ${isPicked ? COLOR.accent : COLOR.border}`,
                background: isPicked ? COLOR.hover : 'transparent',
              },
            },
            h(
              'button',
              {
                type: 'button',
                'data-plan-pick': key,
                'data-plan-picked': isPicked ? 'true' : 'false',
                disabled: candidate || state?.modeActive === false,
                onClick: () => togglePick(key),
                title: isPicked ? t('plan.unpick') : t('plan.pick'),
                style: {
                  width: 16,
                  height: 16,
                  lineHeight: '14px',
                  padding: 0,
                  borderRadius: 4,
                  flexShrink: 0,
                  cursor: 'pointer',
                  fontSize: 11,
                  border: `1px solid ${isPicked ? COLOR.accent : COLOR.border}`,
                  background: isPicked ? COLOR.accent : 'transparent',
                  color: isPicked ? '#ffffff' : COLOR.caption,
                  opacity: candidate ? 0.3 : 1,
                },
              },
              isPicked ? '✓' : '',
            ),
            editing
              ? h('input', {
                  autoFocus: true,
                  value: renaming.name,
                  'data-plan-rename-input': key,
                  onChange: (event) => setRenaming({ key, name: event.target.value }),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') void renamePlan(key, renaming.name)
                    if (event.key === 'Escape') setRenaming(null)
                  },
                  style: { width: 110, fontSize: 11, padding: '2px 5px', borderRadius: 5, border: `1px solid ${COLOR.accent}`, background: 'transparent', color: COLOR.text },
                })
              : h(
                  'span',
                  { style: { minWidth: 78, fontSize: 11.5, fontWeight: 600, color: COLOR.text } },
                  label,
                  badge === '' ? null : h('span', { style: { marginLeft: 4, fontSize: 9.5, fontWeight: 400, color: COLOR.caption, border: `1px solid ${COLOR.border}`, borderRadius: 4, padding: '0 3px' } }, badge),
                ),
            h('span', { style: { fontSize: 10.5, color: deltaColor, whiteSpace: 'nowrap' } }, delta),
            h(
              'span',
              { style: { flex: 1, fontSize: 10, color: COLOR.caption, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
              touched.length === 0 ? '' : t('plan.groups', { groups: [...new Set(touched)].join('、') }),
            ),
            h('span', { title: t('plan.compose', impact), style: { fontSize: 10, color: COLOR.caption, whiteSpace: 'nowrap' } }, t('plan.compose', impact)),
            plan.origin === 'saved'
              ? h(
                  'button',
                  {
                    type: 'button',
                    'data-plan-rename': key,
                    title: t('plan.rename'),
                    onClick: () => setRenaming({ key, name: label }),
                    style: { ...miniButtonStyle, padding: '1px 5px', fontSize: 10, borderColor: COLOR.border },
                  },
                  t('plan.rename'),
                )
              : null,
            plan.deletable !== true
              ? null
              : h(
                  'button',
                  {
                    type: 'button',
                    'data-plan-delete': key,
                    title: t('plan.delete'),
                    onClick: () => void removePlan(plan),
                    style: { ...miniButtonStyle, padding: '1px 5px', fontSize: 10, color: COLOR.danger, borderColor: COLOR.border },
                  },
                  t('plan.delete'),
                ),
            candidate
              ? h(
                  'button',
                  {
                    type: 'button',
                    'data-plan-adopt': key,
                    title: t('plan.adopt'),
                    onClick: () => void adoptPlan(plan),
                    style: { ...miniButtonStyle, padding: '1px 6px', fontSize: 10, fontWeight: 600 },
                  },
                  t('plan.adopt'),
                )
              : h(
                  'span',
                  { 'data-plan-state': `${plan.kind}:${plan.id}`, style: { fontSize: 10.5, minWidth: 40, textAlign: 'right', color: isPicked ? COLOR.accent : COLOR.caption } },
                  isPicked ? (pendingSwitch ? t('plan.pickedTag') : t('plan.current')) : state?.modeActive === false ? t('plan.inactive') : '',
                ),
          )
      }
      function renderPlanGroup(group) {
        const rows = planGroups[group] ?? []
        if (rows.length === 0) return null
        const open = planOpen[group] === true
        return h(
          'div',
          { key: `pg:${group}`, 'data-plan-group': group, style: { marginBottom: 4 } },
          h(
            'button',
            {
              type: 'button',
              'data-plan-group-toggle': group,
              'aria-expanded': open ? 'true' : 'false',
              onClick: () => setPlanOpen((current) => ({ ...current, [group]: current[group] !== true })),
              style: { display: 'flex', width: '100%', alignItems: 'center', gap: 6, padding: '3px 4px', border: 'none', background: 'transparent', color: COLOR.secondary, fontSize: 10.5, cursor: 'pointer' },
            },
            `${open ? '▾' : '▸'} ${t(`plan.group.${group}`)} (${rows.length})`,
          ),
          open ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 3 } }, rows.map((plan) => renderPlanRow(plan))) : null,
        )
      }

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
              overflow: 'auto',
            },
          },
          // 标题栏
          h(
            'div',
            {
              'data-panel-header': 'true',
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                height: 40,
                boxSizing: 'border-box',
                padding: '0 12px',
                borderBottom: `1px solid ${COLOR.border}`,
                position: 'sticky',
                top: 0,
                zIndex: 4,
                background: COLOR.panel,
              },
            },
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
          // 常驻区：改动提示 + 成本估算，滚动时停在顶部
          h(
            'div',
            {
              'data-panel-pinned': 'true',
              style: { position: 'sticky', top: 40, zIndex: 2, background: COLOR.panel, paddingBottom: 2, borderBottom: `1px solid ${COLOR.border}` },
            },
            [
          state?.modeActive === false
            ? h(
                'div',
                {
                  key: 'off',
                  'data-mode-off': 'true',
                  style: {
                    margin: '8px 10px 0',
                    padding: '7px 9px',
                    borderRadius: 8,
                    border: `1px solid ${COLOR.warn}`,
                    background: COLOR.hover,
                    fontSize: 10.5,
                    lineHeight: 1.55,
                    color: COLOR.secondary,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  },
                },
                h('span', { style: { flex: 1 } }, t('mode.off.banner')),
                h(
                  'button',
                  {
                    type: 'button',
                    'data-mode-off-resume': 'true',
                    disabled: busy,
                    onClick: () => void mutate({ op: 'mode', mode: 'ask' }),
                    style: { ...miniButtonStyle, border: `1px solid ${COLOR.accent}` },
                  },
                  t('mode.off.resume'),
                ),
              )
            : null,
          // 写回条永远在最上面：改了什么、能不能保存，一眼看到
          h(
            'div',
            {
              key: 'dirty',
              'data-dirty': dirty.active === true && dirty.count > 0 ? 'true' : 'false',
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                margin: '8px 10px 0',
                padding: '6px 8px',
                borderRadius: 8,
                border: `1px solid ${dirty.active === true && dirty.count > 0 ? COLOR.warn : COLOR.border}`,
                background: dirty.active === true && dirty.count > 0 ? COLOR.hover : 'transparent',
                fontSize: 11,
                color: dirty.active === true && dirty.count > 0 ? COLOR.text : COLOR.caption,
              },
            },
            h('span', { style: { flex: 1 } }, dirty.active === true && dirty.count > 0 ? t('dirty.count', { n: dirty.count }) : state?.modeActive === false ? t('dirty.offHint') : t('dirty.none')),
            dirty.active === true && dirty.count > 0
              ? h('button',{ type: 'button', 'data-dirty-save': 'true', disabled: busy, onClick: () => void saveDirty(), style: { ...miniButtonStyle, borderColor: COLOR.accent, background: COLOR.accent, color: '#ffffff', fontWeight: 600 } }, dirty.mutable === true ? t('dirty.save') : t('dirty.saveAs'))
              : null,
            dirty.active === true && dirty.count > 0
              ? h('button', { type: 'button', 'data-dirty-discard': 'true', disabled: busy, onClick: () => void discardDirty(), style: miniButtonStyle }, t('dirty.discard'))
              : null,
          ),
          // 成本估算（默认展开，放最上面先看数字）
          h(
            Section,
            {
              key: 'cost',
              id: 'cost',
              title: t('section.cost'),
              subtitle: cost === null ? null : t('cost.perTurnShort', { tokens: `${net >= 0 ? '+' : '−'}${compactNumber(Math.abs(net))}` }),
              open: sections.cost === true,
              onToggle: () => toggleSection('cost'),
            },
            cost === null
              ? h('span', { style: { fontSize: 11, color: COLOR.caption } }, t('loading'))
              : h(
                  'div',
                  null,
                  h(
                    'div',
                    { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' } },
                    h('span', { style: { fontSize: 22, fontWeight: 700, lineHeight: 1.2, color: net >= 0 ? COLOR.ok : COLOR.danger } }, `${net >= 0 ? '+' : '−'}${compactNumber(Math.abs(net))}`),
                    h('span', { style: { fontSize: 11, color: COLOR.caption } }, t('cost.perTurn')),
                    pendingSwitch && (previewCost?.repayTokens ?? 0) > 0
                      ? h('span', { 'data-cost-switch': 'true', style: { fontSize: 11, color: COLOR.warn } }, t('cost.switch.head', { repay: compactNumber(previewCost.repayTokens) }))
                      : null,
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
                  cost.savedTokens === 0 && net < 0
                    ? h(
                        'div',
                        { 'data-cost-idle': 'true', style: { marginTop: 4, fontSize: 10.5, lineHeight: 1.5, color: COLOR.caption } },
                        t('cost.idle', { n: Math.abs(net) }),
                      )
                    : null,
                  cost.projectedTurnTokens === null || cost.projectedTurnTokens === undefined
                    ? null
                    : h(
                        'div',
                        { 'data-cost-projected': 'true', style: { marginTop: 4, fontSize: 11, color: COLOR.caption } },
                        t('cost.projected', { next: compactNumber(cost.projectedTurnTokens), now: compactNumber(cost.avgTurnTokens ?? 0) }),
                      ),
                  cost.overThreshold ? h('div', { style: { marginTop: 5, fontSize: 11, color: COLOR.warn } }, t('cost.over', { tokens: compactNumber(cost.thresholdTokens) })) : null,
                  costOpen ? h('div', { 'data-cost-formula': 'true', style: { marginTop: 7, display: 'flex', flexDirection: 'column', gap: 2, fontSize: 10.5, lineHeight: 1.5, color: COLOR.caption } },
                    h('div', null, t('cost.f.saved', { chars: compactNumber(cost.hiddenChars ?? 0), cpt: cost.settings?.charsPerToken ?? 3.6, tokens: compactNumber(cost.savedTokens) })),
                    h('div', null, t('cost.f.overhead', { mode: t(`mode.${state?.mode ?? 'ask'}`), tokens: compactNumber(cost.overheadTokens ?? 0), auto: cost.settings?.modeAutoOverhead ?? 200, quiet: cost.settings?.modeQuietOverhead ?? 20 })),
                    h('div', null, t('cost.f.repay', { context: compactNumber(cost.contextTokens ?? 0), block: compactNumber(cost.toolBlockTokens ?? 0), miss: cost.settings?.missFactor ?? 1, tokens: compactNumber(cost.repayTokens) })),
                    h('div', null, t('cost.f.net')),
                    h('div', null, t('cost.f.threshold', { turn: (cost.avgTurnTokens ?? 0) > 0 ? compactNumber(cost.avgTurnTokens) : '—', mult: cost.settings?.thresholdMultiplier ?? 2 })),
                  ) : null,
                  costOpen ? h(CostForm, { t, cost: cost.settings ?? {}, onSave: (form) => void saveCost(form) }) : null,
                ),
          ),
            ],
          ),
          // 模式（名字加粗，说明一行一条）
          h(
            Section,
            { id: 'mode', title: t('section.mode'), subtitle: t('mode.subtitle'), open: sections.mode === true, onToggle: () => toggleSection('mode') },
            h(
              'div',
              { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
              ['auto', 'ask', 'off'].map((mode) =>
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
              ['auto', 'ask', 'off'].map((mode) =>
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
            { id: 'plan', title: t('section.plan'), subtitle: t('plan.subtitle'), open: sections.plan === true, onToggle: () => toggleSection('plan') },
            h('div', { style: { marginBottom: 6, fontSize: 10, lineHeight: 1.5, color: COLOR.caption } }, t('plan.legend')),
            // 勾选与「应用这组」：改动最显眼的一处，按钮在可应用时变成实心
            h(
              'div',
              { 'data-plan-picked': 'true', style: { display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 6px', padding: '6px 8px', borderRadius: 8, border: `1px solid ${pendingSwitch ? COLOR.accent : COLOR.border}`, background: COLOR.hover } },
              h(
                'span',
                { style: { flex: 1, fontSize: 10.5, color: COLOR.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                t('plan.picked', { n: picked.length, names: pickedPreview.names.join(' + ') }),
              ),
              h(
                'button',
                {
                  type: 'button',
                  'data-plan-apply-all': 'true',
                  disabled: busy || !pendingSwitch || state?.modeActive === false,
                  onClick: () => void mutate({ op: 'planSet', plans: picked }),
                  style: {
                    ...miniButtonStyle,
                    fontWeight: 600,
                    borderColor: pendingSwitch ? COLOR.accent : COLOR.border,
                    background: pendingSwitch ? COLOR.accent : 'transparent',
                    color: pendingSwitch ? '#ffffff' : COLOR.caption,
                    opacity: pendingSwitch ? 1 : 0.6,
                  },
                },
                pendingSwitch ? t('plan.applyAll') : t('plan.current'),
              ),
            ),
            h('div', { 'data-plan-preview': 'true', style: { marginBottom: 4, fontSize: 10.5, color: COLOR.caption } }, t('plan.preview', { kept: pickedPreview.keptTools, off: pickedPreview.offTools })),
            h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
              ['preset', 'saved', 'learned'].map((group) => renderPlanGroup(group)),
            ),
            h(
              'div',
              { style: { display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 } },
              h('input', {
                value: profileName,
                placeholder: t('profileName'),
                onChange: (event) => setProfileName(event.target.value),
                style: { width: 108, fontSize: 11, padding: '3px 6px', borderRadius: 6, border: `1px solid ${COLOR.border}`, background: 'transparent', color: COLOR.text },
              }),
              h('button', { type: 'button', onClick: () => void saveProfile(), style: miniButtonStyle }, t('saveProfile')),
            ),
            h('div', { style: { marginTop: 6, fontSize: 10.5, lineHeight: 1.5, color: COLOR.caption } }, t('plan.note')),
            h(
              'div',
              { style: { marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: COLOR.caption } },
              h('span', null, t('learn.turns.label')),
              h('input', { type: 'number', min: 1, max: 20, value: turnsDraft, 'data-learn-turns': 'true', onChange: (event) => setTurnsDraft(event.target.value), style: { width: 46, fontSize: 11, padding: '2px 5px', borderRadius: 5, border: `1px solid ${COLOR.border}`, background: 'transparent', color: COLOR.text } }),
              h('button', { type: 'button', 'data-learn-turns-save': 'true', onClick: () => void mutate({ op: 'learnTurns', turns: Number(turnsDraft) }), style: miniButtonStyle }, t('learn.turns.save')),
              h('span', { style: { flex: 1 } }),
              h('span', null, t('learn.turns', { n: state?.learnTurns ?? 3 })),
            ),
            h(
              'button',
              {
                type: 'button',
                'data-learn-scope-toggle': 'session',
                'aria-expanded': learnOpen.session === true ? 'true' : 'false',
                onClick: () => setLearnOpen((prev) => ({ ...prev, session: prev.session !== true })),
                style: { marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 10.5, fontWeight: 700, color: COLOR.secondary, textAlign: 'left' },
              },
              h('span', null, learnOpen.session === true ? '▾' : '▸'),
              h('span', null, t('learn.scope.session')),
              h('span', { style: { fontWeight: 400, color: COLOR.caption } }, `${learningItems.length}`),
            ),
            learnOpen.session !== true
              ? null
              : learningItems.length === 0
                ? h('div', { style: { marginTop: 2, fontSize: 10.5, color: COLOR.caption } }, t('learn.items.empty', { n: state?.learnTurns ?? 3 }))
                : h(
                    'div',
                    { 'data-learn-items': 'true', style: { marginTop: 4, display: 'flex', flexDirection: 'column', gap: 3 } },
                    learningItems.map((item) => learnRow(item, 'session')),
                  ),
            h(
              'button',
              {
                type: 'button',
                'data-learn-scope-toggle': 'global',
                'aria-expanded': learnOpen.global === true ? 'true' : 'false',
                onClick: () => setLearnOpen((prev) => ({ ...prev, global: prev.global !== true })),
                style: { marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 10.5, fontWeight: 700, color: COLOR.secondary, textAlign: 'left' },
              },
              h('span', null, learnOpen.global === true ? '▾' : '▸'),
              h('span', null, t('learn.scope.global')),
              h('span', { style: { fontWeight: 400, color: COLOR.caption } }, `${globalItems.length}`),
            ),
            learnOpen.global !== true
              ? null
              : globalItems.length === 0
                ? h('div', { style: { marginTop: 2, fontSize: 10.5, color: COLOR.caption } }, t('learn.global.empty'))
                : h(
                    'div',
                    { 'data-learn-global': 'true', style: { marginTop: 4, display: 'flex', flexDirection: 'column', gap: 3 } },
                    globalItems.map((item) => learnRow(item, 'global')),
                  ),
            (state?.learning?.packs ?? []).length === 0
              ? null
              : h('div', { style: { marginTop: 2, fontSize: 10.5, lineHeight: 1.5, color: COLOR.caption } }, t('learned.explain')),
            state?.learning?.finishedAt === undefined || state?.learning?.finishedAt === null
              ? null
              : h(
                  'div',
                  { 'data-learning-last': 'true', style: { marginTop: 2, fontSize: 10.5, lineHeight: 1.5, color: COLOR.caption } },
                  t('learning.lastRun', {
                    time: String(state.learning.finishedAt).replace('T', ' ').slice(0, 16),
                    names: (state.learning.packs ?? []).map((pack) => pack.name).join('、') || '—',
                  }),
                ),
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
                      h(
                        'button',
                        {
                          type: 'button',
                          'data-learning-copy': pack.id,
                          title: t('learning.copy'),
                          onClick: async () => {
                            await mutate({ op: 'copyPack', packId: pack.id, name: `${pack.name} 副本` })
                            notify(t('learning.copied', { name: pack.name }))
                          },
                          style: miniButtonStyle,
                        },
                        t('learning.copy'),
                      ),
                      (state.packs ?? []).some((item) => item.id === pack.id)
                        ? h('span', { style: { color: COLOR.caption } }, t('learned'))
                        : h('button', { type: 'button', onClick: () => void adoptLearned(pack.id), style: miniButtonStyle }, t('learning.adopt')),
                    ),
                  ),
                ),
          ),
          // 工具列表（可折叠）
          h(
            Section,
            {
              id: 'tools',
              title: t('section.tools'),
              subtitle: counts === null ? null : t('tools.subtitle', { total: counts.total, open: counts.enabled }),
              open: sections.tools === true,
              onToggle: () => toggleSection('tools'),
            },
            h(
              React.Fragment,
              null,
          // 工具栏
          h(
            'div',
            { style: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 6 } },
            ['group', 'plugin'].map((item) => h(Chip, { key: item, label: t(`view.${item}`), active: view === item, onClick: () => setView(item) })),
            h('span', { style: { width: 1, height: 16, background: COLOR.border } }),
            METRICS.map((item) => h(Chip, { key: item, label: t(`metric.${item}`), active: metric === item, onClick: () => setMetric(item) })),
            h('span', { style: { width: 1, height: 16, background: COLOR.border } }),
            h(Chip, {
              label: `${t('unused')}${state === null ? '' : ` ${countUnused(shown, metric)}`}`,
              active: unusedOnly,
              onClick: () => {
                const next = unusedOnly !== true
                setUnusedOnly(next)
                setClosedOnly(false)
                if (next) expandMatching('unused')
              },
            }),
            h(Chip, {
              label: `${t('closed')}${state === null ? '' : ` ${(counts?.hidden ?? 0) + (counts?.warned ?? 0)}`}`,
              active: closedOnly,
              title: t('level.hint'),
              onClick: () => {
                const next = closedOnly !== true
                setClosedOnly(next)
                setUnusedOnly(false)
                if (next) expandMatching('closed')
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
            { style: { padding: '2px 0 8px' } },
            phase === 'error'
              ? h('div', { style: { padding: 24, textAlign: 'center', color: COLOR.warn, fontSize: 12 } }, `${t('error.prefix')}${error}`)
              : h(TreeView, { state: shown, view, t, metric, unusedOnly, closedOnly, sortByFreq: true, expanded: expandedGroups, onToggleBlock: (key) => setExpandedGroups((current) => ({ ...current, [key]: current[key] !== true })), openDetail: openDetail, toggleDetail: (name) => setOpenDetail((current) => ({ ...current, [name]: current[name] !== true })), onLevel, onGroup, busy: busy || !usageReady }),
          ),
            ),
          ),
          // 学习 + 页脚
          h(
            'div',
            {
              'data-panel-footer': 'true',
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                borderTop: `1px solid ${COLOR.border}`,
                fontSize: 11,
                color: COLOR.caption,
                position: 'sticky',
                bottom: 0,
                zIndex: 3,
                background: COLOR.panel,
              },
            },
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
        priceCache: cost.priceCache ?? 0.2,
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
            style: { width: 72, fontSize: 11, padding: '2px 6px', borderRadius: 6, border: `1px solid ${COLOR.border}`, background: 'transparent', color: COLOR.text },
          }),
        )
      const docs = ['charsPerToken', 'missFactor', 'thresholdMultiplier', 'priceInput', 'priceCache']
      return h(
        'div',
        null,
        h(
          'div',
          { style: { display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 6, flexWrap: 'wrap' } },
          field('charsPerToken', t('cost.chars'), 0.1),
          field('missFactor', t('cost.miss'), 0.1),
          field('thresholdMultiplier', t('cost.threshold'), 0.5),
          field('priceInput', t('cost.price'), 0.1),
          field('priceCache', t('cost.priceCache'), 0.1),
          h('button', { type: 'button', onClick: () => onSave(form), style: miniButtonStyle }, t('cost.save')),
        ),
        h(
          'div',
          { 'data-cost-docs': 'true', style: { marginTop: 8, paddingTop: 6, borderTop: `1px dashed ${COLOR.border}`, display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10.5, lineHeight: 1.5, color: COLOR.caption } },
          h('div', { style: { fontWeight: 600, color: COLOR.secondary } }, t('cost.p.title')),
          docs.map((key) => h('div', { key, 'data-cost-param': key }, t(`cost.p.${key}`))),
        ),
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
