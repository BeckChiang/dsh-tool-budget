// usage.js 的单元测试：多帧 zstd 日志的解码、计数、会话匹配与增量缓存。
// 不依赖 DSH 运行时，用 node test/test-usage.mjs 跑。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

import { splitFrames, decodeLog, countCalls, matchesSession, UsageIndex } from '../lib/usage.js'

function frame(records) {
  const text = records.map((record) => JSON.stringify(record)).join('\n')
  return zlib.zstdCompressSync(Buffer.from(`${text}\n`, 'utf8'))
}

function call(name, time, seq) {
  return { type: 'tool/call', seq, time, data: { turn: 1, step: 1, callId: `c${seq}`, name, arguments: '{}' } }
}

const day = (offset) => new Date(Date.UTC(2026, 0, 20 - offset, 12, 0, 0)).toISOString()

// 1. 多帧 zstd：按魔数切帧再拼起来
{
  const buffer = Buffer.concat([frame([{ type: 'session', seq: 1, data: { id: 'session-abc', cwd: 'C:/work' } }]), frame([call('pwsh', day(0), 2)])])
  const frames = splitFrames(buffer)
  assert.equal(frames.length, 2)
  const text = decodeLog(buffer)
  assert.ok(text.includes('"type":"tool/call"'))
  assert.ok(text.includes('session-abc'))
}

// 2. 计数：只认 tool/call，按天分桶，超过 31 天的窗口外丢弃
{
  const text = [
    JSON.stringify({ type: 'session', seq: 1, data: { id: 'session-abc' } }),
    JSON.stringify(call('pwsh', day(0), 2)),
    JSON.stringify(call('pwsh', day(1), 3)),
    JSON.stringify(call('read', day(2), 4)),
    JSON.stringify({ type: 'tool/result', seq: 5, data: { name: 'pwsh' } }),
    JSON.stringify({ type: 'tool/call', seq: 6, data: { name: 'pwsh' } }),
  ].join('\n')
  const result = countCalls(text, { now: Date.UTC(2026, 0, 20, 2) })
  assert.equal(result.calls, 4)
  assert.equal(result.tools.pwsh.n, 3)
  assert.equal(result.tools.read.n, 1)
  const days = Object.keys(result.tools.pwsh.days)
  assert.equal(days.length, 2, '没有 time 的调用不进日期桶')
}

// 3. 会话匹配：带前缀与裸 uuid 都认
{
  assert.equal(matchesSession('session-abc', 'abc'), true)
  assert.equal(matchesSession('session-abc', 'session-abc'), true)
  assert.equal(matchesSession('session-abc', 'other'), false)
  assert.equal(matchesSession('abc', 'session-abc'), true)
}

// 4. UsageIndex：三口径 + 增量缓存
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-usage-'))
  const cacheFile = path.join(root, 'cache.json')
  const makeSession = (id, records) => {
    const dir = path.join(root, 'ws', id)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'session.v4.jsonl.zstd'), Buffer.concat(records.map((record) => frame([record]))))
  }
  makeSession('session-abc', [
    { type: 'session', seq: 1, data: { id: 'session-abc', cwd: 'C:/work' } },
    call('pwsh', day(0), 2),
    call('pwsh', day(1), 3),
    call('present', day(1), 4),
  ])
  makeSession('session-other', [
    { type: 'session', seq: 1, data: { id: 'session-other', cwd: 'C:/work' } },
    call('pwsh', day(3), 2),
  ])

  const index = new UsageIndex({ root, cacheFile, now: () => Date.UTC(2026, 0, 20, 2) })
  const first = await index.scan('session-abc')
  assert.equal(first.meta.sessionMatched, true)
  assert.equal(first.meta.files, 2)
  assert.equal(first.usage.pwsh.session, 2)
  assert.equal(first.usage.pwsh.d30, 3)
  assert.equal(first.usage.pwsh.all, 3)
  assert.equal(first.usage.present.session, 1)

  // 追加一帧：只重解析有变化的文件
  const file = path.join(root, 'ws', 'session-abc', 'session.v4.jsonl.zstd')
  fs.appendFileSync(file, frame([call('pwsh', day(0), 5)]))
  const second = await index.scan('session-abc')
  assert.equal(second.usage.pwsh.session, 3)
  assert.equal(second.meta.parsedFiles, 1)

  // 缓存落盘后新实例直接命中
  const again = new UsageIndex({ root, cacheFile, now: () => Date.UTC(2026, 0, 20, 2) })
  const third = await again.scan('session-abc')
  assert.equal(third.usage.pwsh.session, 3)
  assert.equal(third.meta.parsedFiles, 0)
  fs.rmSync(root, { recursive: true, force: true })
}

console.log('test-usage: all assertions passed')
