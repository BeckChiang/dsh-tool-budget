// 路由准入测试：/tool-budget/* 挂在 webServer.register 上，那条通道不做 DSH 的
// Host / Origin 检查，所以 handler 入口要自己过一遍 ctx.connection.requestRejection。
// 这里用假 ctx 挂起插件，直接调用注册出来的 handler，验证：
//   1) requestRejection 返回 403/401 时，不会再往下处理业务（直接回同一个状态码）；
//   2) 放行时照常走原逻辑（缺 session 仍是 400）；
//   3) 五个路由都挂上了闸门，且把 req.headers 原样交出去。
//
// 运行：node test/test-routes.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { apply, ROUTE, USAGE_ROUTE, COST_ROUTE, LEARNING_ROUTE, PREFERENCES_ROUTE } from '../index.js'

const routes = new Map()
const seen = []
let rejection

const connection = {
  requestRejection(request) {
    seen.push(request)
    return rejection
  },
}

const ctx = {
  logger: { warn() {} },
  get: (name) => (name === 'connection' ? connection : undefined),
  on: () => () => {},
  inject: (names, callback) => {
    if (!names.includes('webServer')) return
    callback({
      effect: (fn) => {
        fn()
        return () => {}
      },
      webServer: {
        register: (route) => {
          routes.set(route.path, route.handler)
          return () => {}
        },
      },
    })
  },
  tools: { register: () => () => {}, definitions: () => [], view: () => ({}) },
  agents: { list: () => [], currentInitiator: () => undefined },
}

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-routes-'))
apply(ctx, { stateDir })

function call(handler, { method = 'GET', url, headers = { host: '127.0.0.1:52973' } } = {}) {
  const chunks = []
  const res = {
    status: 0,
    headers: null,
    writeHead(status, extra) {
      this.status = status
      this.headers = extra ?? {}
    },
    end(body) {
      chunks.push(body ?? '')
    },
    body() {
      return chunks.join('')
    },
  }
  handler({ method, url, headers }, res)
  return res
}

// 1. 五个路由都注册了
for (const route of [ROUTE, USAGE_ROUTE, COST_ROUTE, LEARNING_ROUTE, PREFERENCES_ROUTE]) {
  assert.ok(routes.has(route), `${route} 应该被注册`)
}

// 2. 被拒时直接回状态码，不碰业务
for (const [route, method] of [
  [ROUTE, 'GET'],
  [USAGE_ROUTE, 'GET'],
  [COST_ROUTE, 'POST'],
  [LEARNING_ROUTE, 'POST'],
  [PREFERENCES_ROUTE, 'POST'],
]) {
  for (const status of [401, 403]) {
    rejection = status
    const res = call(routes.get(route), { method, url: `${route}?session=abc`, headers: { host: 'evil.example', origin: 'https://evil.example' } })
    assert.equal(res.status, status, `${route} 被拒时应回 ${status}`)
    assert.deepEqual(JSON.parse(res.body()), { ok: false, error: '这个请求没有通过 DSH 的访问检查（Host / Origin 与浏览器凭据不符）' })
  }
}

// 3. 请求头原样交给 Connection 判断
assert.ok(seen.length === 10, `每次都该走一次 requestRejection，实际 ${seen.length}`)
assert.equal(seen[0].headers.host, 'evil.example')
assert.equal(seen[0].headers.origin, 'https://evil.example')

// 4. 放行后照常走原逻辑（缺 session 仍是 400，不是 401/403）
rejection = undefined
const allowed = call(routes.get(ROUTE), { method: 'GET', url: ROUTE })
assert.equal(allowed.status, 400, '放行时缺 session 应回 400')
assert.match(allowed.body(), /session/)

// 5. 拿不到 connection 服务时按失败关闭处理（503），不把路由重开成裸接口
const plainRoutes = new Map()
const plainCtx = {
  ...ctx,
  get: () => undefined,
  inject: (names, callback) => {
    if (!names.includes('webServer')) return
    callback({
      effect: (fn) => {
        fn()
        return () => {}
      },
      webServer: {
        register: (route) => {
          plainRoutes.set(route.path, route.handler)
          return () => {}
        },
      },
    })
  },
}
const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-routes-plain-'))
apply(plainCtx, { stateDir: plainDir })
const withoutConnection = call(plainRoutes.get(ROUTE), { method: 'GET', url: ROUTE })
assert.equal(withoutConnection.status, 503, '拿不到 connection 时应失败关闭')

// 6. requestRejection 自己抛错也按失败关闭处理
const throwingCtx = {
  ...ctx,
  get: () => ({
    requestRejection() {
      throw new Error('boom')
    },
  }),
  inject: (names, callback) => {
    if (!names.includes('webServer')) return
    callback({
      effect: (fn) => {
        fn()
        return () => {}
      },
      webServer: {
        register: (route) => {
          plainRoutes.set(route.path, route.handler)
          return () => {}
        },
      },
    })
  },
}
const throwDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-routes-throw-'))
apply(throwingCtx, { stateDir: throwDir })
const thrown = call(plainRoutes.get(ROUTE), { method: 'GET', url: ROUTE })
assert.equal(thrown.status, 503, 'requestRejection 抛错时应失败关闭')

for (const dir of [stateDir, plainDir, throwDir]) fs.rmSync(dir, { recursive: true, force: true })
console.log('test-routes: ok')
