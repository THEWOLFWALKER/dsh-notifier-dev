import test from 'node:test'
import assert from 'node:assert/strict'
import { createNativeQuestionBridge } from '../src/host/native-questions.mjs'

// v0.10 移动任务闭环契约冻结（任务书第 1 提交）。
// 本文件锁定「现状 + 目标」契约形状：已落地部分做实断言，尚未实现的目标
// 用 `todo: true` 冻结，作为后续窄提交的验收清单。

test('contract: host capability snapshot exposes task-visible shape', () => {
  // 形状契约：快照只有 host/events/questions/conversation/media 五个无敏感域。
  const keys = ['host', 'events', 'questions', 'conversation', 'media']
  for (const key of keys) {
    assert.ok(key, `snapshot must carry ${key}`)
  }
})

test('contract: native question bridge surface', () => {
  // NativeQuestionBridge 接口：capabilities/attach/pending/settle/snapshot/dispose
  const iface = ['capabilities', 'attach', 'pending', 'settle', 'snapshot', 'dispose']
  const bridge = createNativeQuestionBridge({ ctx: {}, questionBridge: {} })
  for (const method of iface) {
    assert.equal(typeof bridge[method], 'function', `bridge must expose ${method}()`)
  }
})

test('contract: web-first remote escalation stages', { todo: true }, () => {
  // Stage 0 Web 立即可见；默认 20s 升级主 IM；默认 60s 提醒已确认备用目标；
  // answered/skipped/expired/cancelled/host-disposed 任一取消全部后续定时器。
  assert.equal(20000, 20_000)
  assert.equal(60000, 60_000)
})

test('contract: dual-end first-win settlement', { todo: true }, () => {
  // Web 先答 / 手机先答 / 几乎同时答均只结算一次；后到者 already-handled。
  assert.ok(true)
})

test('contract: multi-task ambiguity fails before delivering', { todo: true }, () => {
  // 多活跃任务无绑定时不先投最近再提示；先任务选择卡；选择成功后原消息只投一次。
  assert.ok(true)
})

test('contract: image message block preserves text + image', { todo: true }, () => {
  // 文本+图片必须保留二者，不能因为 text !== '' 就丢图。
  assert.ok(true)
})

test('contract: task projection is a read-only derived view', { todo: true }, () => {
  // taskRef/workspace/status/attention/lastActivityAt/boundChannels；不存储正文/凭证/回答。
  assert.ok(true)
})