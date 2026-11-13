/**
 * 学习包：从本工作区的历史会话里学「常一起用」的组。
 *
 * 做法刻意保守：
 *   - 只读会话日志（tool/call 记录），不读消息内容，不联网；
 *   - 按会话的「组集合」做 Jaccard 聚类，一个簇至少 4 个会话才算样本；
 *   - 一个组要在一个簇里 60% 以上的会话出现，才会进这个包；
 *   - 产出只是**建议**（kind: 'learned'，status: 'ready'），要用户点「采用」才生效；
 *   - 学习包本身只读：用户要改就在面板里复制成 manual 包再改。
 */

import fs from 'node:fs'
import path from 'node:path'
import { defaultSessionsRoot, decodeLog } from './usage.js'

const VERSION = 2

function listSessionFiles(root) {
  const files = []
  let workspaces = []
  try {
    workspaces = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  } catch {
    return files
  }
  for (const workspace of workspaces) {
    const dir = path.join(root, workspace.name)
    let sessions = []
    try {
      sessions = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    } catch {
      continue
    }
    for (const session of sessions) {
      const file = path.join(dir, session.name, 'session.v4.jsonl.zstd')
      try {
        const stat = fs.statSync(file)
        if (stat.size > 0 && stat.size < 32 * 1024 * 1024) {
          files.push({ file, size: stat.size, mtime: stat.mtimeMs, workspace: workspace.name })
        }
      } catch {
        // 没有日志的会话目录直接跳过
      }
    }
  }
  files.sort((a, b) => b.mtime - a.mtime)
  return files
}

function jaccard(a, b) {
  let intersection = 0
  for (const item of a) if (b.has(item)) intersection += 1
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

export class Learner {
  constructor({ root = defaultSessionsRoot(), file, groupOf, labelOf = (id) => id }) {
    this.root = root
    this.file = file
    this.groupOf = groupOf
    this.labelOf = labelOf
    this.job = null
  }

  read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'))
    } catch {
      return { version: VERSION, status: 'idle', packs: [] }
    }
  }

  write(value) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  }

  /** 供面板展示的状态；学习中会带进度。 */
  status() {
    if (this.job !== null) return { ...this.job.status, running: true }
    const saved = this.read()
    if (saved.version !== VERSION) return { version: VERSION, status: 'idle', packs: [], stale: true }
    const packs = (saved.packs ?? []).filter((pack) => !String(pack.name ?? '').includes(' · '))
    return { ...saved, packs, running: false }
  }

  async scan({ cwd, limit = 180 } = {}) {
    if (this.job !== null) return this.job.promise
    const startedAt = new Date().toISOString()
    const before = this.read()
    const status = { version: VERSION, status: 'learning', startedAt, finishedAt: null, scanned: 0, matched: 0, cwd: cwd ?? null, packs: before.packs ?? [] }
    this.write(status)
    let resolveJob
    const promise = new Promise((resolve) => {
      resolveJob = resolve
    })
    this.job = { status, promise }

    const run = async () => {
      try {
        const files = listSessionFiles(this.root)
        const samples = []
        for (const entry of files.slice(0, limit)) {
          status.scanned += 1
          let text
          try {
            text = decodeLog(fs.readFileSync(entry.file))
          } catch {
            continue
          }
          let recordCwd = null
          const groups = new Set()
          for (const line of text.split('\n')) {
            if (!line.includes('"tool/call"')) {
              if (recordCwd === null && line.includes('"type":"session"')) {
                try {
                  recordCwd = JSON.parse(line).data?.cwd ?? null
                } catch {
                  recordCwd = null
                }
              }
              continue
            }
            try {
              const record = JSON.parse(line)
              if (record.type !== 'tool/call') continue
              const name = record.data?.name
              if (typeof name !== 'string') continue
              groups.add(this.groupOf(name))
            } catch {
              // 坏行跳过
            }
          }
          const target = typeof cwd === 'string' && cwd !== '' ? cwd : null
          if (target !== null && recordCwd !== null && path.resolve(recordCwd) !== path.resolve(target)) continue
          if (groups.size === 0) continue
          samples.push({ groups, at: entry.mtime })
          status.matched = samples.length
        }
        status.packs = clusterPacks(samples, this.labelOf)
        status.status = 'ready'
        status.finishedAt = new Date().toISOString()
        this.write(status)
      } catch (error) {
        status.status = 'failed'
        status.error = String(error?.message ?? error)
        status.finishedAt = new Date().toISOString()
        this.write(status)
      } finally {
        this.job = null
        resolveJob(this.read())
      }
    }

    void run()
    return promise
  }

  /** 删除学习产物（只删 learned 包，不动 manual/builtin）。 */
  clear() {
    const saved = this.read()
    const next = { ...saved, status: 'idle', packs: [], finishedAt: null, startedAt: null, scanned: 0, matched: 0 }
    this.write(next)
    return next
  }
}

/** 贪心聚类 + 覆盖率建档，导出给测试用。 */
export function clusterPacks(samples, labelOf = (id) => id) {
  const clusters = []
  for (const sample of samples) {
    let best = null
    let bestScore = 0
    for (const cluster of clusters) {
      const score = jaccard(sample.groups, cluster.groups)
      if (score > bestScore) {
        bestScore = score
        best = cluster
      }
    }
    if (best !== null && bestScore >= 0.5) {
      for (const group of sample.groups) best.counts[group] = (best.counts[group] ?? 0) + 1
      best.size += 1
      for (const group of sample.groups) best.groups.add(group)
    } else {
      const counts = {}
      for (const group of sample.groups) counts[group] = 1
      clusters.push({ size: 1, counts, groups: new Set(sample.groups) })
    }
  }
  const packs = []
  for (const cluster of clusters) {
    if (cluster.size < 4) continue
    const entries = Object.entries(cluster.counts)
      .map(([group, count]) => ({ group, coverage: count / cluster.size }))
      .filter((item) => item.coverage >= 0.6)
      .sort((a, b) => b.coverage - a.coverage)
      .slice(0, 6)
    if (entries.length < 2) continue
    const groups = entries.map((item) => item.group)
    const confidence = entries.reduce((sum, item) => sum + item.coverage, 0) / entries.length
    packs.push({
      id: `learned-${groups.join('-').replace(/[^a-z0-9-]+/gi, '_')}`,
      kind: 'learned',
      status: 'ready',
      groups,
      plugins: [],
      name: groups.map((group) => labelOf(group)).join('、'),
      groupLabels: groups.map((group) => labelOf(group)),
      source: { kind: 'sessions', sessions: cluster.size, confidence: Math.round(confidence * 100) / 100, coverage: entries },
    })
  }
  packs.sort((a, b) => (b.source?.sessions ?? 0) - (a.source?.sessions ?? 0))
  return packs.slice(0, 3)
}
