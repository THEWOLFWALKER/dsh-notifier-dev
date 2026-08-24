// dsh-notifier test/admin-ui-behavior.test.mjs
// 管理台前端鉴权行为对抗性测试（mnt 批 1）。
// 目标缺陷（mnt-1）：
//   ① 缺 token 首访 loadAll 并行 5 个 api() → 各自弹一次 window.prompt → 5 个叠加窗；
//   ② prompt 输入的 token 从不持久化 → 刷新必重输；
//   ③ 并发 401 各递归重询 → 风暴刷窗、错 token 可能死循环。
// 验证：单飞询问门（并发共享一次弹窗）、成功后才持久化（刷新不重输）、401 单次重登录
// （一次询问恰好重试一次，成功后重新武装，迟到旧世代 401 判过期不再弹窗）。
// 手段：node:vm 把 ADMIN_UI_HTML 内联 <script>（剥掉末尾 init() 自启）跑在注入
// DOM/localStorage/fetch/prompt 假体的沙箱里——真执行源码里的同一份逻辑，无复制粘贴。
// 内联代码运行时只依赖浏览器混合全局；沙箱预置 host 全局副本 + window/document/fetch/prompt 假体。

import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { ADMIN_UI_HTML } from '../src/admin/ui.mjs'

/** 提取内联 <script> 正文（取最后一个 script 块，防止未来加外部 script 干扰）。 */
function extractScript(html) {
  const start = html.lastIndexOf('<script>') + '<script>'.length
  const end = html.indexOf('</script>', start)
  return html.slice(start, end)
}

function makeElement(sel) {
  const listeners = {}
  return {
    sel,
    textContent: '',
    className: '',
    innerHTML: '',
    value: '',
    checked: false,
    style: {},
    addEventListener(evt, fn) { listeners[evt] = fn },
    removeEventListener(evt) { delete listeners[evt] },
    dispatch(evt) { const fn = listeners[evt]; if (fn) fn({ target: this, preventDefault() {} }) },
  }
}

async function settle() { for (let i = 0; i < 60; i += 1) await Promise.resolve() }

function resp(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body }
}

/** 可手动控制 resolve 顺序的 fetch：把每个待决请求排进 pending 队列。 */
function queueableFetch() {
  const pending = []
  return {
    pending,
    impl: async (url, init) => new Promise((resolve) => {
      pending.push({ resolve, url, auth: init.headers.Authorization })
    }),
  }
}

/**
 * 启动 UI 沙箱。返回活动句柄：
 *  - 脚本导出函数（api/acquireToken/reloginGate/adoptToken/setToken/getToken/…）
 *  - els（selector → 假元素，可查 textContent / dispatch click）
 *  - store（localStorage 假体）
 *  - setFetch / setPrompt（可换桩，闭包内最新生效）
 */
function boot() {
  const els = new Map()
  const document = {
    hidden: false,
    querySelector: (sel) => {
      if (!els.has(sel)) els.set(sel, makeElement(sel))
      return els.get(sel)
    },
    querySelectorAll: () => [],
    createElement: () => makeElement('div'),
  }
  const data = new Map()
  const store = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    has: (k) => data.has(k),
  }
  const promptTaps = []
  const timeoutTaps = []
  let fetchImpl = async () => resp(200, {})
  let promptImpl = () => ''
  const sandbox = { window: {}, document, localStorage: store }
  sandbox.window.localStorage = store
  sandbox.window.prompt = (...args) => { promptTaps.push(args); return promptImpl(...args) }
  sandbox.fetch = async (...args) => fetchImpl(...args)
  sandbox.prompt = (...args) => { promptTaps.push(args); return promptImpl(...args) }
  sandbox.setTimeout = (fn, ms) => { timeoutTaps.push({ fn, ms }); return timeoutTaps.length }
  sandbox.clearTimeout = () => {}

  const wrapped = `(() => {
${extractScript(ADMIN_UI_HTML).replace(/\ninit\(\)\s*$/, '\n')}
;return { api, acquireToken, reloginGate, adoptToken, setToken, getToken, renderTokenState,
  handleStream401, startNotifyStream, loadAll, init,
  _authGen: function () { return authGen }, _autoReloginUsed: function () { return autoReloginUsed } }
})()`
  const context = vm.createContext(sandbox)
  const exports_ = vm.runInContext(wrapped, context, { filename: 'admin-ui-inline.mjs' })
  return {
    ...exports_,
    els,
    store,
    prompts: () => promptTaps.slice(),
    timeouts: () => timeoutTaps.slice(),
    setFetch: (f) => { fetchImpl = f },
    setPrompt: (p) => { promptImpl = p },
  }
}

// ————————————————— ① 首访单飞询问 + 成功持久化 —————————————————

test('首访并发：5 个并行 api 只弹一次 prompt，成功响应后才落 localStorage', async () => {
  const rig = boot()
  let promptCount = 0
  rig.setPrompt(() => { promptCount += 1; return 'OKT0KEN' })
  rig.setFetch(async () => resp(200, { ok: true }))
  await Promise.all([rig.api('/api/a'), rig.api('/api/b'), rig.api('/api/c'), rig.api('/api/d'), rig.api('/api/e')])
  assert.equal(promptCount, 1, '并发首访共享同一单飞询问（原实现 5 个叠加窗）')
  assert.equal(rig.store.getItem('dsh-admin-token'), 'OKT0KEN', '成功后持久化（refresh 无需重输）')
  // 再发一次请求：token 已在本地 → 不再询问
  const before = promptCount
  await rig.api('/api/f')
  assert.equal(promptCount, before, '持久化后后续请求不重问')
})

test('首访 prompt 取消：绝不留任何 token，api 明确报错', async () => {
  const rig = boot()
  rig.setPrompt(() => '')
  await assert.rejects(rig.api('/api/x'), /未提供 token/)
  assert.equal(rig.store.has('dsh-admin-token'), false, '取消不写入')
})

test('首访 prompt 输入的 8 位码面绝不进 localStorage（除非请求成功）', async () => {
  // mnt-1 反例加固：prompt 返回值既不是 token 也未获成功响应时，不得被当成有效 token 采纳。
  const rig = boot()
  rig.setPrompt(() => '  W00D0N  ') // 带空白 → trim 后入库当候选
  rig.setFetch(async () => resp(401, { error: 'unauthorized' })) // 任何候选都被服务器拒
  await assert.rejects(rig.api('/api/x'))
  assert.equal(rig.store.getItem('dsh-admin-token'), null, '候选被拒后不得持久化')
})

// ————————————————— ② 401 单次重登录 —————————————————

test('并发 401：共享单飞重登录门——一次询问、各自用新 token 重试一次、成功后持久化', async () => {
  const rig = boot()
  rig.setToken('OLD')
  let promptCount = 0
  rig.setPrompt(() => { promptCount += 1; return 'NEWTKN' })
  const q = queueableFetch()
  rig.setFetch(q.impl)

  const pA = rig.api('/api/a')
  const pB = rig.api('/api/b')
  await settle()
  assert.equal(q.pending.filter((x) => x.auth === 'Bearer OLD').length, 2, '两请求都带旧 token 发出')
  // 两个 401 几乎同时到达
  q.pending.filter((x) => x.auth === 'Bearer OLD').forEach((x) => x.resolve(resp(401, { error: 'x' })))
  await settle()
  assert.equal(promptCount, 1, '两并发 401 共享一次询问（原实现会 2 连弹）')
  const retries = q.pending.filter((x) => x.auth === 'Bearer NEWTKN')
  assert.equal(retries.length, 2, '两条请求都用新 token 重试一次')
  retries.forEach((x) => x.resolve(resp(200, { ok: true })))
  await pA
  await pB
  assert.equal(rig.store.getItem('dsh-admin-token'), 'NEWTKN', '重登录成功后才持久化')
  assert.equal(rig._autoReloginUsed(), true, '成功响应重新武装自动重登录')
})

test('401 迟到旧世代：并发请求之一仍未落地时重登录已完成——迟到 401 过期，不再弹第二轮窗', async () => {
  const rig = boot()
  rig.setToken('OLD')
  let promptCount = 0
  rig.setPrompt(() => { promptCount += 1; return 'NEWTKN' })
  const q = queueableFetch()
  rig.setFetch(q.impl)

  const pA = rig.api('/api/a')
  const pB = rig.api('/api/b')
  await settle()
  const olds = q.pending.filter((x) => x.auth === 'Bearer OLD')
  assert.equal(olds.length, 2)
  // 只让第一个 401 触发重登录；第二个保持 in-flight（旧 token）
  olds[0].resolve(resp(401, { error: 'x' }))
  await settle()
  assert.equal(promptCount, 1, '第一个 401 触发单次询问')
  const retry = q.pending.find((x) => x.auth === 'Bearer NEWTKN')
  assert.ok(retry, '新 token 重试请求已发出')
  retry.resolve(resp(200, { ok: true }))
  await pA
  assert.equal(rig.store.getItem('dsh-admin-token'), 'NEWTKN')
  // 滞后到达的旧 token 401 → 世代已推进 → 判为过期请求，不重登录
  olds[1].resolve(resp(401, { error: 'x' }))
  await assert.rejects(pB, /已失效的 token/)
  assert.equal(promptCount, 1, '迟到旧世代 401 不再触发第二轮询问')
})

test('错 token：一次 401 至多自动重登录一次；失败后解除武装，不再自动弹窗循环', async () => {
  const rig = boot()
  rig.setToken('BAD')
  let promptCount = 0
  rig.setPrompt(() => { promptCount += 1; return 'ALSOBAD' })
  rig.setFetch(async () => resp(401, { error: 'x' }))

  await assert.rejects(rig.api('/api/x'), /自动重登录处理/)
  assert.equal(promptCount, 1, '一个 401 恰好一次自动重登录')
  assert.equal(rig._autoReloginUsed(), false, '失败后未重新武装')
  // 再次显式调用：无 stored token → prompt 一次；401 已解除武装 → 直接拒绝，不自动再试
  await assert.rejects(rig.api('/api/x'))
  assert.equal(promptCount, 2, '每次显式调用至多一次询问——无自动循环')
})

// ————————————————— ③ SSE 与手动换 token —————————————————

test('SSE：401 走共享重登录门，一次询问后重连，再 401 不再弹窗（提示手动更新）', async () => {
  const rig = boot()
  rig.setToken('OLD')
  let promptCount = 0
  rig.setPrompt(() => { promptCount += 1; return 'NEWTKN' })
  let eventFetches = 0
  rig.setFetch(async () => { eventFetches += 1; return resp(401, { error: 'x' }) })

  rig.startNotifyStream()
  await settle()
  assert.equal(promptCount, 1, 'SSE 401 与 api 共享单飞重登录门')
  assert.equal(eventFetches, 2, '旧 token 连接 + 新 token 重连各一次')
  assert.ok(rig.els.get('#nStream').textContent.includes('已自动重试一次'),
    '第二次 401 不再弹窗：' + rig.els.get('#nStream').textContent)
})

test('SSE 首访缺 token：与并发 api 共享单飞询问门（不叠窗），成功后持久化', async () => {
  const rig = boot()
  let promptCount = 0
  rig.setPrompt(() => { promptCount += 1; return 'NEW' })
  const auths = []
  rig.setFetch(async (url, init) => {
    auths.push(init.headers.Authorization)
    return { status: 200, ok: true, body: { getReader: () => ({ read: async () => ({ done: true }) }) }, json: async () => ({}) }
  })
  // 同时起步 loadAll（5 个 api）与 SSE——原实现路径上两者会叠加 6 次询问
  const load = rig.loadAll()
  rig.startNotifyStream()
  await load
  await settle()
  assert.equal(promptCount, 1, 'SSE + 并行 api 共享同一次询问')
  assert.equal(auths.length, 6, '5 个并行 api + 1 个 SSE 连接')
  assert.ok(auths.every((a) => a === 'Bearer NEW'), '所有请求都用询问得到的 token')
  assert.equal(rig.store.getItem('dsh-admin-token'), 'NEW', 'SSE 连接成功后持久化')
})

test('点击 token 状态：手动换 token 推进世代并持久化，旧请求迟到 401 不再自动弹窗', async () => {
  const rig = boot()
  rig.setToken('OLD')
  let promptCount = 0
  rig.setPrompt(() => { promptCount += 1; return 'MANUAL' })
  // init：SSE（/api/events 空流）+ 5 个并行 api 全部 200——不触发任何询问
  rig.setFetch(async (url) => (url === '/api/events'
    ? { status: 200, ok: true, body: { getReader: () => ({ read: async () => ({ done: true }) }) }, json: async () => ({}) }
    : resp(200, {})))
  rig.init() // 真页面底部自启（监听器 + SSE + loadAll）
  await settle()
  assert.equal(promptCount, 0, 'init 各请求全部成功，不因缺 token 弹窗')
  const n0 = rig._authGen()
  assert.ok(rig.els.get('#tokenState'), 'token 状态点击区已注册')
  rig.els.get('#tokenState').dispatch('click') // 手动更换
  await settle()
  assert.equal(promptCount, 1, '手动触发一次询问')
  assert.equal(rig.store.getItem('dsh-admin-token'), 'MANUAL', '手动换 token 立即持久化（原实现只改 state 不快照）')
  assert.equal(rig._authGen(), n0 + 1, '手动换 token 推进世代（旧请求迟到 401 判过期）')
})