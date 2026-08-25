// v0.8 远程提问桥测试（questions/router.mjs，规划书《选项卡通知》M1）。
// 核心断言（用户拍板的两个行为）：
//  - 选项卡为主：卡片送达的渠道不再收编号文案；编号只发卡片未送达的渠道（P4）
//  - 发错可再答：越界编号 / 单选回多项 → 回执提示 + 选项重发，问题保持待决
// 附加红线：超时永不代答（answered=false）、token 伪造拒绝、首达采纳、参数校验、限流。

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createQuestionBridge, validateAskArgs, registerAskUserTool } from '../src/questions/router.mjs'
import { createInboundBus } from '../src/inbound/bus.mjs'
import { createTokenVault } from '../src/inbound/tokens.mjs'
import { createStore } from '../src/inbound/store.mjs'
import { createIdentity } from '../src/inbound/identity.mjs'

function tempPath() {
  return join(mkdtempSync(join(tmpdir(), 'dsh-notifier-aq-')), 'state.json')
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 组装提问桥测试台。
 * @param {object} [options]
 * @param {Array<{channel: string, card: boolean|null, targets?: object[]}>} [options.inbounds]
 *   card: true = 卡片成功（记录 payload）；false = 无卡片能力（sendQuestionCard 恒 null）
 * @param {string[]} [options.channelTypes] - notifier.channels（编号兜底的广播池）
 * @param {object} [options.identity] - 身份注册表（CRACK-004 hint 兜底归属闸；缺省不传）
 * @param {object} [options.logger] - 宿主 logger 桩（捕获 warn 断言）
 */
function makeRig({ inbounds = [{ channel: 'telegram', card: true }], channelTypes = ['telegram'], identity = null, logger = null, escalation = { enabled: false }, notifyOutcome = null } = {}) {
  const store = createStore(tempPath())
  const vault = createTokenVault({ secret: 'test-secret' })
  const bus = createInboundBus({ allowUsers: ['42', '100'], store, vault })
  const broadcasts = [] // { msg, opts } —— 编号兜底/提醒广播
  const notifier = {
    channels: channelTypes,
    notifyAll: async (msg, opts) => {
      broadcasts.push({ msg, opts })
      if (notifyOutcome !== null) return typeof notifyOutcome === 'function' ? notifyOutcome(msg, opts) : notifyOutcome
      return { ok: true, delivered: Array.isArray(opts?.channelTypes) ? [...opts.channelTypes] : [], skipped: [], failed: [] }
    },
  }
  const instances = []
  for (const spec of inbounds) {
    const cards = []
    const texts = []
    const edits = []
    instances.push({
      cards,
      texts,
      edits,
      raw: {
        channel: spec.channel,
        notifyTargets: () => (spec.targets ?? [{ chatId: '100', userId: '100' }]),
        async sendQuestionCard(payload) {
          if (spec.card !== true) return null
          cards.push(payload)
          return { messageId: cards.length }
        },
        async editResolved(target, text) { edits.push({ target, text }) },
        async sendText(chatId, text) { texts.push({ chatId, text }); return spec.sendTextResult !== false },
      },
    })
  }
  const bridge = createQuestionBridge({
    bus,
    vault,
    store,
    notifier,
    ...(identity !== null ? { identity } : {}),
    ...(logger !== null ? { logger } : {}),
    interactive: () => instances.map((item) => item.raw),
    config: { timeoutMs: 800, escalation },
  })
  bridge.attach() // 挂编号回复处理器（生产装配序：审批之后）
  return { store, vault, bus, broadcasts, instances, bridge }
}

const SINGLE = { question: '选一个部署环境', options: [{ label: '测试环境' }, { label: '预发环境' }, { label: '生产环境' }] }
const MULTI = { question: '勾选要通知的人', options: [{ label: '张三' }, { label: '李四' }, { label: '王五' }], multiSelect: true }

test('升级提醒逐目标发送：同一渠道的无关 chat 不会收到提醒', async () => {
  const rig = makeRig({
    inbounds: [{ channel: 'qq', card: true, targets: [{ chatId: 'qq-target', userId: 'u1' }] }],
    channelTypes: ['qq-bot'],
    escalation: { enabled: true, stages: [{ afterMs: 15, note: '提醒' }] },
  })
  const other = makeRig({
    inbounds: [{ channel: 'qq', card: true, targets: [{ chatId: 'qq-other', userId: 'u2' }] }],
    channelTypes: ['qq-bot'],
    escalation: { enabled: true, stages: [{ afterMs: 15, note: '提醒' }] },
  })
  const pending = rig.bridge.askQuestions({ questions: [SINGLE] })
  const otherPending = other.bridge.askQuestions({ questions: [SINGLE] })
  await sleep(120)
  assert.equal(rig.broadcasts.length, 1, '只保留初始编号兜底广播，不广播升级提醒')
  assert.equal(other.broadcasts.length, 1, '第二实例也只保留初始编号兜底广播')
  assert.match(rig.instances[0].texts[0].text, /仍在等待作答/)
  assert.equal(other.instances[0].texts[0].text.includes('仍在等待作答'), true)
  assert.equal(rig.instances[0].texts[0].chatId, 'qq-target')
  assert.equal(other.instances[0].texts[0].chatId, 'qq-other')
  assert.equal(rig.instances[0].texts.some((entry) => entry.chatId === 'qq-other'), false)
  assert.equal(other.instances[0].texts.some((entry) => entry.chatId === 'qq-target'), false)
  const qKey = rig.store.keys('aq:')[0]
  const row = rig.store.get(qKey)
  assert.equal(row.status, 'pending')
  rig.bridge.dispose()
  other.bridge.dispose()
  await pending
  await otherPending
})

// ---------------------------------------------------------------- P4 选项卡为主

test('P4 卡片为主：卡片送达的渠道不再收编号文案（零广播）', async () => {
  const rig = makeRig({ channelTypes: ['telegram'] }) // 广播池只有卡片渠道
  const pending = rig.bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  assert.equal(rig.instances[0].cards.length, 1, '卡片已送达')
  assert.equal(rig.broadcasts.length, 0, '卡片已到手，不得再广播编号文案')
  const payload = rig.instances[0].cards[0]
  rig.bridge.decide({ qKey: payload.qKey, optIdx: '1', token: payload.token, via: 'telegram', userId: '100' })
  const result = await pending
  assert.deepEqual(result.results[0].answers, ['预发环境'])
  rig.bridge.dispose()
})

test('P4 编号兜底只发卡片未送达的渠道（分流 channelTypes）', async () => {
  const rig = makeRig({ channelTypes: ['telegram', 'wxpusher', 'webhook'] })
  const pending = rig.bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  // telegram 卡片已送达 → 编号文案只补发给 wxpusher / webhook
  assert.equal(rig.broadcasts.length, 1)
  assert.deepEqual(rig.broadcasts[0].opts, { channelTypes: ['wxpusher', 'webhook'] })
  assert.match(rig.broadcasts[0].msg.content, /回复编号/, '编号话术在场')
  assert.equal(rig.broadcasts[0].msg.level, 'timeSensitive')
  const payload = rig.instances[0].cards[0]
  rig.bridge.decide({ qKey: payload.qKey, optIdx: '0', token: payload.token, via: 'telegram', userId: '100' })
  await pending
  rig.bridge.dispose()
})

test('P4 全渠道无卡片：编号文案广播全部渠道，白名单用户回编号可作答', async () => {
  const identity = createIdentity({ store: createStore(tempPath()) })
  identity.addBinding({ channel: 'qq', userId: '42' }) // 首条绑定 = owner（CRACK-004 hint 兜底需 owner）
  // chat 级证据闸（2026-08-25）：回编号者须是该通道的送达目标。生产装配中 notifyTargets
  // 由绑定表解析（owner 42 必在列）；rig 默认目标 100 与绑定表脱钩，不再人为制造
  // 「目标 100 收话术、owner 42 凭渠道级证据作答」的旧残差形态。chatId 需过 qq 形状
  // 守卫（8-64 字符）——否则 kept 为空，per-target 证据无从登记。
  const rig = makeRig({
    inbounds: [{ channel: 'qq', card: false, targets: [{ chatId: 'qqowner042', userId: '42' }] }],
    channelTypes: ['qq', 'wxpusher'],
    identity,
  })
  const pending = rig.bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  assert.equal(rig.instances[0].cards.length, 0, 'qq 无卡片能力')
  assert.equal(rig.broadcasts.length, 1)
  assert.deepEqual(rig.broadcasts[0].opts, { channelTypes: ['qq', 'wxpusher'] })
  assert.match(rig.broadcasts[0].msg.content, /1\. 测试环境[\s\S]*3\. 生产环境/, '选项列表随编号文案下发')
  // qq 用户 42（白名单）回复 2 → 裁决为「预发环境」
  assert.deepEqual(
    rig.bus.accept({ channel: 'qq', userId: '42', chatId: 'qqowner042', messageId: 'msg:q:1', text: '2' }),
    { ok: true },
  )
  const result = await pending
  assert.equal(result.answered, true)
  assert.deepEqual(result.results[0].answers, ['预发环境'])
  assert.match(result.results[0].via, /qq:reply/)
  rig.bridge.dispose()
})

test('P4 卡片投递失败（异常）也走编号兜底：normalizeInbound 吞异常归 null', async () => {
  const store = createStore(tempPath())
  const vault = createTokenVault({ secret: 's' })
  const bus = createInboundBus({ allowUsers: ['42'], store, vault })
  const identity = createIdentity({ store: createStore(tempPath()) })
  identity.addBinding({ channel: 'feishu', userId: '42' }) // 首条绑定 = owner（CRACK-004 hint 兜底需 owner）
  const broadcasts = []
  const notifier = {
    channels: ['feishu'],
    notifyAll: async (msg, opts) => { broadcasts.push({ msg, opts }); return { ok: true, delivered: ['feishu'], skipped: [], failed: [] } },
  }
  const raw = {
    channel: 'feishu',
    // chat 级证据闸：作答人 owner 42 即 feishu 绑定目标（与生产绑定表一致）。chatId 需过
    // feishu 形状守卫（oc_/ou_/on_ 前缀）——原 '100' 会被守卫拦下，卡片根本不会尝试。
    notifyTargets: () => [{ chatId: 'oc_100', userId: '42' }],
    sendQuestionCard: async () => { throw new Error('feishu down') },
    editResolved: async () => {},
    sendText: async () => true,
  }
  const bridge = createQuestionBridge({ bus, vault, store, notifier, identity, interactive: () => [raw], config: { escalation: { enabled: false } } })
  bridge.attach()
  const pending = bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  assert.equal(broadcasts.length, 1, '卡片炸了 → feishu 落回编号文案')
  assert.deepEqual(broadcasts[0].opts, { channelTypes: ['feishu'] })
  bus.accept({ channel: 'feishu', userId: '42', chatId: 'oc_100', messageId: 'm1', text: '3' })
  const result = await pending
  assert.deepEqual(result.results[0].answers, ['生产环境'])
  bridge.dispose()
})

// ---------------------------------------------------------------- 发错可再答（用户诉求）

test('发错编号（越界）：回执提示 + 选项重发，问题保持待决，随后正确作答成功', async () => {
  const identity = createIdentity({ store: createStore(tempPath()) })
  identity.addBinding({ channel: 'qq', userId: '42' }) // 首条绑定 = owner（CRACK-004 hint 兜底需 owner）
  const rig = makeRig({ inbounds: [{ channel: 'qq', card: false, targets: [{ chatId: 'qqowner042', userId: '42' }] }], channelTypes: ['qq'], identity })
  const pending = rig.bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  const qq = rig.instances[0]
  // 9 越界（只有 3 个选项）
  assert.deepEqual(
    rig.bus.accept({ channel: 'qq', userId: '42', chatId: 'qqowner042', messageId: 'msg:q:1', text: '9' }),
    { ok: true },
  )
  await sleep(10)
  assert.equal(qq.texts.length, 1, '发错了要说话：回执已发')
  assert.match(qq.texts[0].text, /编号需在 1-3 之间/, '提示错在哪')
  assert.match(qq.texts[0].text, /1\. 测试环境[\s\S]*3\. 生产环境/, '选项已重发一遍')
  // 问题未被作废：仍是 pending
  const rows = rig.store.keys('aq:').map((key) => rig.store.get(key))
  assert.equal(rows.filter((row) => row.status === 'pending').length, 1, '发错不作废')
  // 直接再发一次正确编号即可作答
  rig.bus.accept({ channel: 'qq', userId: '42', chatId: 'qqowner042', messageId: 'msg:q:2', text: '1' })
  const result = await pending
  assert.equal(result.answered, true)
  assert.deepEqual(result.results[0].answers, ['测试环境'])
  assert.equal(qq.texts.length, 2)
  assert.match(qq.texts[1].text, /已作答：测试环境/)
  rig.bridge.dispose()
})

test('单选回多项（1,2）：提示本题单选 + 选项重发，保持待决，改回单编号成功', async () => {
  const identity = createIdentity({ store: createStore(tempPath()) })
  identity.addBinding({ channel: 'qq', userId: '42' }) // 首条绑定 = owner（CRACK-004 hint 兜底需 owner）
  const rig = makeRig({ inbounds: [{ channel: 'qq', card: false, targets: [{ chatId: 'qqowner042', userId: '42' }] }], channelTypes: ['qq'], identity })
  const pending = rig.bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  const qq = rig.instances[0]
  rig.bus.accept({ channel: 'qq', userId: '42', chatId: 'qqowner042', messageId: 'msg:q:1', text: '1,2' })
  await sleep(10)
  assert.equal(qq.texts.length, 1)
  assert.match(qq.texts[0].text, /本题是单选，请只回复一个编号/)
  assert.match(qq.texts[0].text, /1\. 测试环境/, '选项重发在场')
  const rows = rig.store.keys('aq:').map((key) => rig.store.get(key))
  assert.equal(rows.filter((row) => row.status === 'pending').length, 1, '问题保持待决')
  rig.bus.accept({ channel: 'qq', userId: '42', chatId: 'qqowner042', messageId: 'msg:q:2', text: '2' })
  const result = await pending
  assert.deepEqual(result.results[0].answers, ['预发环境'])
  rig.bridge.dispose()
})

test('多选作答：中文逗号 1，3 也认，去重后两项落账', async () => {
  const identity = createIdentity({ store: createStore(tempPath()) })
  identity.addBinding({ channel: 'qq', userId: '100' }) // 首条绑定 = owner（CRACK-004 hint 兜底需 owner）
  // chatId 需过 qq 形状守卫（8-64 字符），owner 100 才能登记 per-target 证据
  const rig = makeRig({ inbounds: [{ channel: 'qq', card: false, targets: [{ chatId: 'qqowner100', userId: '100' }] }], channelTypes: ['qq'], identity })
  const pending = rig.bridge.askQuestions({ questions: [MULTI] })
  await sleep(30)
  rig.bus.accept({ channel: 'qq', userId: '100', chatId: 'qqowner100', messageId: 'msg:q:1', text: '1，3' })
  const result = await pending
  assert.equal(result.answered, true)
  assert.deepEqual(result.results[0].answers, ['张三', '王五'])
  rig.bridge.dispose()
})

test('裸编号消费语义：有效作答被消费（不进对话路由），无待决时裸编号不拦', async () => {
  const identity = createIdentity({ store: createStore(tempPath()) })
  identity.addBinding({ channel: 'qq', userId: '42' }) // 首条绑定 = owner（CRACK-004 hint 兜底需 owner）
  const rig = makeRig({ inbounds: [{ channel: 'qq', card: false, targets: [{ chatId: 'qqowner042', userId: '42' }] }], channelTypes: ['qq'], identity })
  const seen = []
  rig.bus.onMessage((envelope) => { seen.push(envelope.text); return false })
  const pending = rig.bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  rig.bus.accept({ channel: 'qq', userId: '42', chatId: 'qqowner042', messageId: 'msg:q:1', text: '1' })
  await pending
  // 提问处理器返回 true 已消费 → 后注册的观察者看不到（注册序：提问先于观察者）
  assert.equal(seen.length, 0, '作答消息被提问处理器消费')
  // 无待决提问时裸编号放行（交回对话路由语义由后置观察者见证）
  rig.bus.accept({ channel: 'qq', userId: '42', chatId: 'qqowner042', messageId: 'msg:q:2', text: '2' })
  assert.deepEqual(seen, ['2'], '无待决时裸编号不拦')
  rig.bridge.dispose()
})

// ---------------------------------------------------------------- SEC-2 裸回复竞态收紧（latestPendingFor any→hint）

test('SEC-2 关闭跨渠道抢答：feishu 卡片送达 u1，qq u2 未收到话术回裸 1 → 不消费不裁决，超时未答', async () => {
  const rig = makeRig({
    inbounds: [{ channel: 'feishu', card: true, targets: [{ chatId: 'oc_100', userId: 'ou_100' }] }],
    channelTypes: ['feishu'], // 广播池只有 feishu（已送卡）→ hintChannels=[]
  })
  const seen = []
  rig.bus.onMessage((envelope) => { seen.push(envelope.text); return false })
  const pending = rig.bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  assert.equal(rig.instances[0].cards.length, 1, 'feishu 卡片已送达')
  // qq 白名单成员 u2=42 回裸 1：qq 既未送卡也未广播编号话术 → 越权面关闭
  rig.bus.accept({ channel: 'qq', userId: '42', chatId: '42', messageId: 'm1', text: '1' })
  assert.deepEqual(seen, ['1'], '跨渠道裸编号不被消费，落回对话路由')
  const row = rig.store.get(rig.store.keys('aq:')[0])
  assert.equal(row.status, 'pending', '越权作答不落终态')
  const result = await pending
  assert.equal(result.answered, false, '超时未作答（不代答）')
  assert.equal(result.results[0].answered, false)
  rig.bridge.dispose()
})

test('SEC-2 正控：qq 收到编号话术（hintChannels 含 qq）后 qq u2 回 1 → 命中作答', async () => {
  const identity = createIdentity({ store: createStore(tempPath()) })
  identity.addBinding({ channel: 'qq', userId: '42' }) // 首条绑定 = owner（CRACK-004 hint 兜底需 owner）
  const rig = makeRig({
    inbounds: [
      { channel: 'feishu', card: true, targets: [{ chatId: 'oc_100', userId: 'ou_100' }] },
      // chat 级证据闸（2026-08-25）：qq 编号回复可送达的前提是 qq 入站适配器在场；
      // 出站广播覆盖 qq 时，per-target 证据从该通道绑定目标（owner 42）推导。
      // chatId 需过 qq 形状守卫（8-64 字符）。
      { channel: 'qq', card: false, targets: [{ chatId: 'qqowner042', userId: '42' }] },
    ],
    channelTypes: ['feishu', 'qq'], // feishu 送卡，qq 未送卡 → hintChannels=['qq']
    identity,
  })
  const pending = rig.bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  assert.equal(rig.instances[0].cards.length, 1, 'feishu 卡片已送达')
  assert.deepEqual(rig.broadcasts[0].opts, { channelTypes: ['qq'] }, '编号话术只发 qq')
  // qq u2=42 回 1 → hint 命中
  rig.bus.accept({ channel: 'qq', userId: '42', chatId: 'qqowner042', messageId: 'm1', text: '1' })
  const result = await pending
  assert.equal(result.answered, true)
  assert.deepEqual(result.results[0].answers, ['测试环境'])
  assert.match(result.results[0].via, /qq:reply/)
  rig.bridge.dispose()
})

test('SEC-2 多 pending 定向隔离：telegram 回复只命中 telegram 定向的问题，feishu 问题不受影响', async () => {
  const store = createStore(tempPath())
  const vault = createTokenVault({ secret: 's' })
  const bus = createInboundBus({ allowUsers: ['42', '100'], store, vault })
  const broadcasts = []
  const notifier = { channels: ['feishu'], notifyAll: async (msg, opts) => { broadcasts.push({ msg, opts }); return { ok: true, delivered: ['feishu'], skipped: [], failed: [] } } }
  const feishu = {
    channel: 'feishu',
    notifyTargets: () => [{ chatId: '100', userId: '100' }],
    async sendQuestionCard(p) { return { messageId: 1 } },
    async editResolved() {},
    async sendText() { return true },
  }
  const telegram = {
    channel: 'telegram',
    notifyTargets: () => [{ chatId: '100', userId: '100' }],
    async sendQuestionCard(p) { return { messageId: 1 } },
    async editResolved() {},
    async sendText() { return true },
  }
  const bridge = createQuestionBridge({ bus, vault, store, notifier, interactive: () => [feishu, telegram], config: { timeoutMs: 800, escalation: { enabled: false } } })
  bridge.attach()
  // 问题 A：只推 feishu（channelTypes=['feishu']）→ hintChannels=[]
  const pendingA = bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  // 问题 B：只推 telegram（channelTypes=['telegram']）→ hintChannels=[]
  notifier.channels = ['telegram']
  const pendingB = bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  // telegram 白名单成员回 1 → 只命中 B（telegram 定向），A 不受影响
  bus.accept({ channel: 'telegram', userId: '100', chatId: '100', messageId: 'm1', text: '1' })
  const resultB = await pendingB
  assert.equal(resultB.answered, true)
  assert.deepEqual(resultB.results[0].answers, ['测试环境'])
  const aRows = store.keys('aq:').map((k) => store.get(k))
  assert.equal(aRows.filter((r) => r.status === 'pending').length, 1, 'A 未被 telegram 命中，仍 pending')
  const resultA = await pendingA
  assert.equal(resultA.answered, false, 'A 超时未作答')
  bridge.dispose()
})

test('SEC-2 旧行无 hintChannels + 无 pushedTo → 编号作答拒绝（fail-closed 从严）', async () => {
  const rig = makeRig({ inbounds: [{ channel: 'qq', card: false }], channelTypes: ['qq'] })
  // 手工塞一条旧版在途 aq 行：无 hintChannels、无 pushedTo
  const oldKey = 'aq:oldrow'
  rig.store.set(oldKey, { question: '旧问题', options: ['甲', '乙'], multiSelect: false, status: 'pending', pushedTo: [], createdAt: Date.now() })
  const seen = []
  rig.bus.onMessage((envelope) => { seen.push(envelope.text); return false })
  // 任一渠道回 1 → 不消费（落回对话路由），不裁决
  rig.bus.accept({ channel: 'qq', userId: '42', chatId: '42', messageId: 'm1', text: '1' })
  assert.deepEqual(seen, ['1'], '旧行无 hintChannels → 编号不被消费，落回对话路由')
  assert.equal(rig.store.get(oldKey).status, 'pending', '旧行不被裁决，仍 pending')
  rig.bridge.dispose()
})

test('SEC-2 hint 与 exact 优先级稳定：exact 行优先于 hint 行', async () => {
  const rig = makeRig({ inbounds: [{ channel: 'telegram', card: true }], channelTypes: ['telegram'] })
  // 行 X：telegram:u1 推送过（exact）+ hintChannels 含 telegram（hint 也成立）
  const xKey = 'aq:x'
  rig.store.set(xKey, { question: 'X', options: ['甲', '乙'], multiSelect: false, status: 'pending', pushedTo: [{ channel: 'telegram', chatId: '100', userId: '100', messageId: 1, kind: 'aq' }], hintChannels: ['telegram'], createdAt: Date.now() })
  // 行 Y：仅 hintTargets 含 telegram:100（无推送；chat 级证据下 hint 仍可命中）
  const yKey = 'aq:y'
  rig.store.set(yKey, { question: 'Y', options: ['甲', '乙'], multiSelect: false, status: 'pending', pushedTo: [], hintChannels: ['telegram'], hintTargets: [{ channel: 'telegram', chatId: '100', userId: '100' }], createdAt: Date.now() + 1 })
  // 为两端注册 waiter（生产路径由 askQuestions/bus.wait 注册；手工种行需等价注册才能 settle）
  rig.bus.wait(xKey, 800, {})
  rig.bus.wait(yKey, 800, {})
  // telegram u1 回 1 → 命中 X（exact 优先于 hint），Y 不受影响
  rig.bus.accept({ channel: 'telegram', userId: '100', chatId: '100', messageId: 'm1', text: '1' })
  assert.equal(rig.store.get(xKey).status, 'resolved', 'exact 行被命中')
  assert.equal(rig.store.get(xKey).decision, 'answered')
  assert.equal(rig.store.get(yKey).status, 'pending', 'hint 行不被 exact 抢走')
  rig.bridge.dispose()
})

// ---------------------------------------------------------------- issue #11 出站/入站异名 + 纯入站通道编号作答

test('issue #11 QQ：qq-bot 出站 ↔ qq 入站异名 → hintChannels 含 qq，qq 编号回复命中且不双发', async () => {
  // 出站只有 qq-bot（文本）→ 编号话术经出站 qq-bot 送达；入站 qq 无卡片能力。
  // 修复前 hintChannels=['qq-bot']，qq 入站回复编号命中不了 → timeout + 对话污染。
  const identity = createIdentity({ store: createStore(tempPath()) })
  identity.addBinding({ channel: 'qq', userId: '42' }) // 首条绑定 = owner（CRACK-004 hint 兜底需 owner）
  const rig = makeRig({ inbounds: [{ channel: 'qq', card: false, targets: [{ chatId: 'qquser42', userId: '42' }] }], channelTypes: ['qq-bot'], identity })
  const seen = []
  rig.bus.onMessage((envelope) => { seen.push(envelope.text); return false })
  const pending = rig.bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  assert.equal(rig.instances[0].cards.length, 0, 'qq 无卡片能力')
  assert.equal(rig.broadcasts.length, 1, '编号话术经出站 qq-bot 广播')
  assert.deepEqual(rig.broadcasts[0].opts, { channelTypes: ['qq-bot'] })
  const row = rig.store.get(rig.store.keys('aq:')[0])
  assert.deepEqual([...row.hintChannels].sort(), ['qq', 'qq-bot'], 'hintChannels 同时含出站 qq-bot 与入站 qq')
  assert.equal(rig.instances[0].texts.length, 0, '编号话术已由出站 qq-bot 送达，不入站 sendText 双发')
  // qq 用户 42 回复编号 → hint 命中（异名通道回复生效）
  rig.bus.accept({ channel: 'qq', userId: '42', chatId: 'qquser42', messageId: 'm1', text: '1' })
  const result = await pending
  assert.equal(result.answered, true)
  assert.deepEqual(result.results[0].answers, ['测试环境'])
  assert.match(result.results[0].via, /qq:reply/)
  assert.equal(seen.length, 0, '编号作答被消费，不进对话路由（防污染）')
  rig.bridge.dispose()
})

test('issue #11 微信 iLink 纯入站：hintChannels 含 wechat 且编号话术经 sendText 送达，wechat 回复命中', async () => {
  // wechat iLink 是 inbound-only（无对应出站 type、无 sendQuestionCard）。
  // 修复前编号话术永不送达、hintChannels 永不含 wechat → 编号作答完全失效。
  const identity = createIdentity({ store: createStore(tempPath()) })
  identity.addBinding({ channel: 'wechat', userId: '42' }) // 首条绑定 = owner（CRACK-004 hint 兜底需 owner）
  const rig = makeRig({ inbounds: [{ channel: 'wechat', card: false, targets: [{ chatId: 'wxuser42', userId: '42' }] }], channelTypes: ['telegram'], identity })
  const pending = rig.bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  assert.equal(rig.instances[0].cards.length, 0, 'wechat 无卡片能力')
  assert.deepEqual(rig.broadcasts[0].opts, { channelTypes: ['telegram'] }, '出站广播照常只发 telegram')
  const row = rig.store.get(rig.store.keys('aq:')[0])
  assert.deepEqual([...row.hintChannels].sort(), ['telegram', 'wechat'], 'hintChannels 含纯入站 wechat')
  assert.equal(rig.instances[0].texts.length, 1, '纯入站通道经 sendText 收到编号话术')
  assert.match(rig.instances[0].texts[0].text, /回复编号/, '编号话术在场')
  // wechat 用户回 1 → hint 命中
  rig.bus.accept({ channel: 'wechat', userId: '42', chatId: 'wxuser42', messageId: 'm1', text: '1' })
  const result = await pending
  assert.equal(result.answered, true)
  assert.deepEqual(result.results[0].answers, ['测试环境'])
  assert.match(result.results[0].via, /wechat:reply/)
  rig.bridge.dispose()
})

test('SEC-2 发送失败不登记 hint 证据：纯入站渠道未收到话术时裸编号不命中', async () => {
  const identity = createIdentity({ store: createStore(tempPath()) })
  identity.addBinding({ channel: 'wechat', userId: '42' })
  const rig = makeRig({
    inbounds: [{ channel: 'wechat', card: false, sendTextResult: false, targets: [{ chatId: 'wxuser42', userId: '42' }] }],
    channelTypes: ['telegram'],
    identity,
  })
  const pending = rig.bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  const row = rig.store.get(rig.store.keys('aq:')[0])
  assert.deepEqual(row.hintChannels, ['telegram'], 'sendText 失败时不登记 wechat hint')
  rig.bus.accept({ channel: 'wechat', userId: '42', chatId: 'wxuser42', messageId: 'm-fail', text: '1' })
  const result = await pending
  assert.equal(result.answered, false, '未收到题目时裸编号不能作答')
  rig.bridge.dispose()
})

test('SEC-2 出站广播无实际 delivered 不登记 hint 证据', async () => {
  const identity = createIdentity({ store: createStore(tempPath()) })
  identity.addBinding({ channel: 'telegram', userId: '42' })
  const rig = makeRig({
    inbounds: [],
    channelTypes: ['telegram'],
    identity,
    notifyOutcome: { ok: true, delivered: [], skipped: ['(no-targets)'], failed: [] },
  })
  const pending = rig.bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  const row = rig.store.get(rig.store.keys('aq:')[0])
  assert.deepEqual(row.hintChannels, [], '空目标/静音广播不留下编号证据')
  rig.bus.accept({ channel: 'telegram', userId: '42', chatId: 'tg-42', messageId: 'm-no-delivery', text: '1' })
  const result = await pending
  assert.equal(result.answered, false, '未实际送达时裸编号不能作答')
  rig.bridge.dispose()
})

test('issue #11 fail-closed：未绑定目标用户的入站通道不补入 hintChannels，裸编号仍拒绝', async () => {
  // qq 目标用户 42（绑定）；feishu 无绑定目标（notifyTargets 空）→ feishu 不进 hintChannels。
  const rig = makeRig({
    inbounds: [
      { channel: 'qq', card: false, targets: [{ chatId: 'qquser42', userId: '42' }] },
      { channel: 'feishu', card: false, targets: [] },
    ],
    channelTypes: ['qq-bot'],
  })
  const seen = []
  rig.bus.onMessage((envelope) => { seen.push(envelope.text); return false })
  const pending = rig.bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  const row = rig.store.get(rig.store.keys('aq:')[0])
  assert.deepEqual([...row.hintChannels].sort(), ['qq', 'qq-bot'], 'feishu 无绑定目标不入 hintChannels')
  // feishu 白名单用户 100 回 1 → 不命中（feishu 未收到话术），落回对话路由
  rig.bus.accept({ channel: 'feishu', userId: '100', chatId: 'oc_100', messageId: 'm1', text: '1' })
  assert.deepEqual(seen, ['1'], '无关通道裸编号不被消费')
  assert.equal(row.status, 'pending', '无关通道作答不落终态')
  rig.bridge.dispose()
})

// ---------------------------------------------------------------- CRACK-004 归属闸（hint 兜底仅 owner；exact/onChannel 当事人级）

test('CRACK-004 归属闸：hint 命中但代答者是 member → 拒（消费 + 回执「无权」+ warn，问题保持待决）', async () => {
  // feishu 卡片送达本人；qq 无卡片 → hintChannels=['qq']。qq 渠道 owner=100、member=42。
  const warns = []
  const identity = createIdentity({ store: createStore(tempPath()) })
  identity.addBinding({ channel: 'qq', userId: '100' }) // 首条绑定 = owner
  identity.addBinding({ channel: 'qq', userId: '42' }) // 第二条 = member
  const rig = makeRig({
    inbounds: [
      { channel: 'feishu', card: true, targets: [{ chatId: 'oc_100', userId: 'ou_100' }] },
      // chat 级证据闸：member 42 是 qq 绑定目标（hintTargets 含其会话）→ 三元组命中后
      // 走 CRACK-004 owner 闸（member 拒）。chatId 需过 qq 形状守卫（8-64 字符）。
      { channel: 'qq', card: false, targets: [{ chatId: 'qqmember042', userId: '42' }] }, // 回执走此实例
    ],
    channelTypes: ['feishu', 'qq'],
    identity,
    logger: { warn: (...args) => warns.push(args.join(' ')) },
  })
  const seen = []
  rig.bus.onMessage((envelope) => { seen.push(envelope.text); return false })
  const pending = rig.bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  assert.equal(rig.instances[0].cards.length, 1, 'feishu 卡片已送达')
  // qq member 42 回裸 1：hint 兜底命中，但非 owner → 归属闸拒绝
  assert.deepEqual(
    rig.bus.accept({ channel: 'qq', userId: '42', chatId: 'qqmember042', messageId: 'm1', text: '1' }),
    { ok: true },
  )
  assert.deepEqual(seen, [], '拒绝也要消费裸编号，不进对话路由')
  assert.equal(rig.instances[1].texts.length, 1, '回执送达拒绝者')
  assert.match(rig.instances[1].texts[0].text, /无权/)
  assert.equal(warns.some((w) => /越权拒绝.*evidence=hint/.test(w)), true, '拒绝必须留痕且带归属证词（静默即事故）')
  const row = rig.store.get(rig.store.keys('aq:')[0])
  assert.equal(row.status, 'pending', 'member 代答不落终态')
  const result = await pending
  assert.equal(result.answered, false, '问题未被 member 代答（超时交还桌面）')
  rig.bridge.dispose()
})

test('CRACK-004 放行矩阵：hint + owner → 正常作答（兜底链不断）', async () => {
  const identity = createIdentity({ store: createStore(tempPath()) })
  identity.addBinding({ channel: 'qq', userId: '42' }) // 首条绑定 = owner
  const rig = makeRig({
    inbounds: [
      { channel: 'feishu', card: true, targets: [{ chatId: 'oc_100', userId: 'ou_100' }] },
      { channel: 'qq', card: false, targets: [{ chatId: 'qqowner042', userId: '42' }] }, // owner 42 是绑定目标
    ],
    channelTypes: ['feishu', 'qq'], // feishu 送卡，qq 未送卡 → hintChannels=['qq']
    identity,
  })
  const pending = rig.bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  assert.deepEqual(
    rig.bus.accept({ channel: 'qq', userId: '42', chatId: 'qqowner042', messageId: 'm1', text: '1' }),
    { ok: true },
  )
  const result = await pending
  assert.equal(result.answered, true)
  assert.deepEqual(result.results[0].answers, ['测试环境'])
  assert.match(result.results[0].via, /qq:reply/)
  rig.bridge.dispose()
})

test('CRACK-004 放行矩阵：exact/onChannel 本人作答不查 identity（防过度收紧——未绑定用户本人仍可答）', async () => {
  // 卡片送达 qq 用户 100 本人（pushedTo 含 userId 100），hintChannels=[]。
  // identity 在场但不含 100（只有 qq:42 owner）→ 用户 100 本人回编号必须照常放行：
  // exact/onChannel 是当事人级证词，归属闸不得要求身份绑定或 owner 角色。
  const identity = createIdentity({ store: createStore(tempPath()) })
  identity.addBinding({ channel: 'qq', userId: '42' }) // 表里只有别人；100 完全未绑定
  const rig = makeRig({
    inbounds: [{ channel: 'qq', card: true, targets: [{ chatId: 'qquser100', userId: '100' }] }],
    channelTypes: ['qq'],
    identity,
  })
  const pending = rig.bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  assert.equal(rig.instances[0].cards.length, 1, 'qq 卡片已送达')
  assert.deepEqual(
    rig.bus.accept({ channel: 'qq', userId: '100', chatId: 'qquser100', messageId: 'm1', text: '1' }),
    { ok: true },
  )
  const result = await pending
  assert.equal(result.answered, true, '卡片收件人本人作答不被归属闸误伤')
  assert.deepEqual(result.results[0].answers, ['测试环境'])
  rig.bridge.dispose()
})

test('CRACK-004 fail-closed：identity 缺失时 hint 兜底一律拒（消费 + 回执「无权」+ warn）', async () => {
  const warns = []
  const rig = makeRig({
    inbounds: [
      { channel: 'feishu', card: true, targets: [{ chatId: 'oc_100', userId: 'ou_100' }] },
      { channel: 'qq', card: false, targets: [{ chatId: 'qqowner042', userId: '42' }] }, // 42 有证据才触达 owner 闸
    ],
    channelTypes: ['feishu', 'qq'], // hintChannels=['qq']
    logger: { warn: (...args) => warns.push(args.join(' ')) },
  }) // 不传 identity → 生产装配缺失时编号兜底必须 fail-closed
  const seen = []
  rig.bus.onMessage((envelope) => { seen.push(envelope.text); return false })
  const pending = rig.bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  assert.deepEqual(
    rig.bus.accept({ channel: 'qq', userId: '42', chatId: 'qqowner042', messageId: 'm1', text: '1' }),
    { ok: true },
  )
  assert.deepEqual(seen, [], 'fail-closed 也消费裸编号')
  assert.equal(rig.instances[1].texts.length, 1)
  assert.match(rig.instances[1].texts[0].text, /无权/)
  assert.equal(warns.some((w) => /越权拒绝.*evidence=hint/.test(w)), true)
  const result = await pending
  assert.equal(result.answered, false, 'identity 缺失 → hint 一律拒，超时交还桌面')
  rig.bridge.dispose()
})

// ---------------------------------------------------------------- P1 残差钉（2026-08-25）：渠道级编号证据的 chat 歧义
// risks.md P1 残差：hintChannels 与 latestPendingFor 都是渠道/用户级，信封里明明带 chatId
// 却不参与匹配。以下三例钉住**当前**行为（不是理想行为）——防止未来无意漂移，并为
// Control Core 落地 per-target hint 证据 / (channel,userId,chatId) 闸门时提供必须翻转的
// 断言基线（翻转时同步更新本节注释与 risks.md）。

test('P1 翻转：exact 证据 chat 级收紧——卡片送达 chat A，本人从 chat B 回裸编号被拒', async () => {
  // 原残差钉：exact 命中不校验 chatId。按钮路径有 SEC-1/AUTH-1 来源会话校验（card 到
  // chat A、chat B 的点击被拒）；现在编号路径同口径——chat B 的裸编号被消费并回执
  // 「请到原会话操作」，问题保持待决，原会话（chat A）仍可正常作答。
  const rig = makeRig({
    inbounds: [{ channel: 'qq', card: true, targets: [{ chatId: 'qqcard1000', userId: '100' }] }],
    channelTypes: ['qq'],
  }) // 有意不传 identity：exact 是当事人级证词，不查 owner（与 CRACK-004 放行矩阵一致）
  const seen = []
  rig.bus.onMessage((envelope) => { seen.push(envelope.text); return false })
  const pending = rig.bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  assert.equal(rig.instances[0].cards.length, 1, '卡片已送达 chat A')
  const row = rig.store.get(rig.store.keys('aq:')[0])
  assert.equal(row.pushedTo[0].chatId, 'qqcard1000', '卡片送达记录指向 chat A')
  assert.deepEqual(row.hintChannels, [], '卡片送达 → qq 不广播编号话术')
  // 本人（userId 100）从同渠道另一 chat 回裸 1：无三元组命中 → chatMismatch → 消费 + 回执
  assert.deepEqual(
    rig.bus.accept({ channel: 'qq', userId: '100', chatId: 'qqother999', messageId: 'm1', text: '1' }),
    { ok: true },
  )
  assert.deepEqual(seen, [], '跨会话裸编号被消费，不进对话路由')
  assert.equal(rig.instances[0].texts.length, 1, '回执已发往错误会话')
  assert.equal(rig.instances[0].texts[0].chatId, 'qqother999')
  assert.match(rig.instances[0].texts[0].text, /请到原会话操作/)
  assert.equal(rig.store.get(rig.store.keys('aq:')[0]).status, 'pending', '跨会话作答不落终态')
  // 拒绝不作废：原会话（chat A）本人作答仍正常
  rig.bus.accept({ channel: 'qq', userId: '100', chatId: 'qqcard1000', messageId: 'm2', text: '1' })
  const result = await pending
  assert.equal(result.answered, true, '原残差钉已翻转：跨会话拒绝，原会话正常作答')
  assert.deepEqual(result.results[0].answers, ['测试环境'])
  assert.match(result.results[0].via, /qq:reply/)
  rig.bridge.dispose()
})

test('P1 翻转：hint 证据 per-target 收紧——话术只送 chat A，owner 从 chat B 回裸编号被拒', async () => {
  // 原残差钉：hint 证据渠道级。现在 hintTargets per-target 记账，只有话术实际送达的
  // 会话才有证据；owner 从同渠道另一 chat 回裸编号 → chatMismatch → 消费 + 回执，
  // 不代答。hintChannels 降为渠道级 observability 快照（断言不变）。
  const identity = createIdentity({ store: createStore(tempPath()) })
  identity.addBinding({ channel: 'wechat', userId: '42' }) // 首条绑定 = owner（CRACK-004 hint 兜底需 owner）
  const rig = makeRig({
    inbounds: [{ channel: 'wechat', card: false, targets: [{ chatId: 'wxhint0042', userId: '42' }] }],
    channelTypes: ['telegram'], // telegram 无入站实例 → 出站广播只留 telegram hint 证据
    identity,
  })
  const seen = []
  rig.bus.onMessage((envelope) => { seen.push(envelope.text); return false })
  const pending = rig.bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  const row = rig.store.get(rig.store.keys('aq:')[0])
  assert.deepEqual(row.hintTargets, [{ channel: 'wechat', chatId: 'wxhint0042', userId: '42' }], 'per-target 证据只记话术实际送达的目标')
  assert.deepEqual([...row.hintChannels].sort(), ['telegram', 'wechat'], '渠道级快照不变（wechat 经 sendText 送达、telegram 经出站广播）')
  assert.equal(rig.instances[0].texts.length, 1)
  assert.equal(rig.instances[0].texts[0].chatId, 'wxhint0042', '话术实际只送到了 chat A')
  // owner 从同渠道另一 chat 回裸 1 —— hintTargets 不含 chat B → chatMismatch → 消费 + 回执
  assert.deepEqual(
    rig.bus.accept({ channel: 'wechat', userId: '42', chatId: 'wxother0042', messageId: 'm1', text: '1' }),
    { ok: true },
  )
  assert.deepEqual(seen, [], '跨会话裸编号被消费，不进对话路由')
  assert.equal(rig.instances[0].texts.length, 2, '回执已发往错误会话')
  assert.equal(rig.instances[0].texts[1].chatId, 'wxother0042')
  assert.match(rig.instances[0].texts[1].text, /请到原会话操作/)
  assert.equal(rig.store.get(rig.store.keys('aq:')[0]).status, 'pending', '跨会话作答不落终态')
  const result = await pending
  assert.equal(result.answered, false, '原残差钉已翻转：owner 跨会话裸编号不再作答')
  assert.equal(result.results[0].answered, false)
  rig.bridge.dispose()
})

test('P1 翻转：部分送达 per-target 收紧——话术只送达 chat A，chat B 未收到话术的 owner 裸编号不命中', async () => {
  // 原残差钉：hintedChannels 登记条件是 outcomes.some(Boolean)——同渠道多目标只要一个
  // sendText 成功，整个渠道获得 hint 证据，未收到话术的目标（chat B 的 owner 100）与
  // 收到的目标共享同一渠道级证据。现在 hintTargets 逐目标记账：只有 sendText 确认送达
  // 的目标留下编号证据；未收到话术的目标无任何证据 → 裸编号不消费（fail-closed，落回
  // 对话路由），问题超时交还桌面。per-target 送达桩需绕开 rig 的通道级开关，故本例手搭。
  const store = createStore(tempPath())
  const vault = createTokenVault({ secret: 's' })
  const bus = createInboundBus({ allowUsers: ['42', '100'], store, vault })
  const identity = createIdentity({ store: createStore(tempPath()) })
  identity.addBinding({ channel: 'qq', userId: '100' }) // 首条绑定 = owner（chat B 收件人，话术未送达）
  identity.addBinding({ channel: 'qq', userId: '42' }) // member（chat A 收件人，话术已送达）
  const texts = []
  const raw = {
    channel: 'qq',
    notifyTargets: () => [
      { chatId: 'qqsink0042', userId: '42' }, // chat A：话术送达
      { chatId: 'qqmiss0100', userId: '100' }, // chat B：话术投递失败
    ],
    async sendQuestionCard() { return null }, // 无卡片能力 → 全走编号兜底
    async editResolved() {},
    async sendText(chatId, text) { texts.push({ chatId, text }); return chatId === 'qqsink0042' },
  }
  const notifier = { channels: [], notifyAll: async () => ({ ok: true, delivered: [], skipped: [], failed: [] }) }
  const bridge = createQuestionBridge({ bus, vault, store, notifier, identity, interactive: () => [raw], config: { timeoutMs: 800, escalation: { enabled: false } } })
  bridge.attach()
  const seen = []
  bus.onMessage((envelope) => { seen.push(envelope.text); return false })
  const pending = bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  const row = store.get(store.keys('aq:')[0])
  assert.deepEqual(row.hintTargets, [{ channel: 'qq', chatId: 'qqsink0042', userId: '42' }], '部分送达只登记实际送达的目标（chat B 不留证据）')
  assert.deepEqual(row.hintChannels, ['qq'], '渠道级快照仍含 qq（observability 口径不变）')
  assert.deepEqual(texts.map((entry) => entry.chatId).sort(), ['qqmiss0100', 'qqsink0042'], '两目标的 sendText 都尝试过（A 成功 B 失败）')
  // chat B 的 owner 100（sendText 失败、从未见过话术）回裸 1 —— 无 per-target 证据 →
  // 不消费不裁决，落回对话路由（与 issue #11 fail-closed 同口径）
  bus.accept({ channel: 'qq', userId: '100', chatId: 'qqmiss0100', messageId: 'm1', text: '1' })
  assert.deepEqual(seen, ['1'], '未收到话术的目标裸编号不被消费，落回对话路由')
  assert.equal(texts.length, 2, '无回执——系统视角下该用户与本题无关（从未送达）')
  assert.equal(store.get(store.keys('aq:')[0]).status, 'pending', 'fail-closed 不落终态')
  const result = await pending
  assert.equal(result.answered, false, '原残差钉已翻转：未收到话术的目标不再凭渠道级证据作答')
  assert.equal(result.results[0].answered, false)
  bridge.dispose()
})

// ---------------------------------------------------------------- chat 级证据闸门回归（P1 残差修复新增，2026-08-25）

test('chat 级闸门回归：多 pending 跨 chat 隔离——chat A 的裸编号只裁决送达 chat A 的问题', async () => {
  // 同 (channel,userId) 两问待决：X 话术送达 chat A（1001），Y 话术送达 chat B（2002）。
  // chat A 回裸 1 → X 三元组命中（hint，owner 放行），Y 仅构成 chatMismatch 候选——
  // 按 exact ?? hint ?? chatMismatch 优先级 X 胜出；Y 不受影响保持待决。
  const identity = createIdentity({ store: createStore(tempPath()) })
  identity.addBinding({ channel: 'telegram', userId: '100' }) // 首条绑定 = owner（hint 放行）
  const rig = makeRig({ inbounds: [{ channel: 'telegram', card: true }], channelTypes: ['telegram'], identity })
  const xKey = 'aq:chatx'
  const yKey = 'aq:chaty'
  rig.store.set(xKey, { question: 'X', options: ['甲', '乙'], multiSelect: false, status: 'pending', pushedTo: [], hintChannels: ['telegram'], hintTargets: [{ channel: 'telegram', chatId: '1001', userId: '100' }], createdAt: Date.now() })
  rig.store.set(yKey, { question: 'Y', options: ['甲', '乙'], multiSelect: false, status: 'pending', pushedTo: [], hintChannels: ['telegram'], hintTargets: [{ channel: 'telegram', chatId: '2002', userId: '100' }], createdAt: Date.now() + 1 })
  // 为两端注册 waiter（生产路径由 askQuestions/bus.wait 注册；手工种行需等价注册才能 settle）
  rig.bus.wait(xKey, 800, {})
  rig.bus.wait(yKey, 800, {})
  rig.bus.accept({ channel: 'telegram', userId: '100', chatId: '1001', messageId: 'm1', text: '1' })
  assert.equal(rig.store.get(xKey).status, 'resolved', 'chat A 的裸编号裁决送达 chat A 的问题')
  assert.equal(rig.store.get(xKey).decision, 'answered')
  assert.equal(rig.store.get(yKey).status, 'pending', '送达 chat B 的问题不受 chat A 作答影响')
  assert.equal(rig.instances[0].texts.length, 1, '回执只发往 chat A')
  assert.match(rig.instances[0].texts[0].text, /已作答/)
  rig.bridge.dispose()
})

test('chat 级闸门回归：旧行只有 hintChannels 无 hintTargets → 裸编号 fail-closed 不消费', async () => {
  // 升级迁移面：修复前落账的在途行只有渠道级 hintChannels。chat 级闸门下旧行无
  // per-target 证据 → fail-closed：裸编号不消费不裁决，问题等超时交还桌面（从严
  // 方向安全——宁可旧行丢兜底，不保留渠道级歧义面）。
  const rig = makeRig({ inbounds: [{ channel: 'telegram', card: true }], channelTypes: ['telegram'] })
  const oldKey = 'aq:legacy'
  rig.store.set(oldKey, { question: '旧', options: ['甲', '乙'], multiSelect: false, status: 'pending', pushedTo: [], hintChannels: ['telegram'], createdAt: Date.now() })
  rig.bus.wait(oldKey, 800, {})
  const seen = []
  rig.bus.onMessage((envelope) => { seen.push(envelope.text); return false })
  rig.bus.accept({ channel: 'telegram', userId: '100', chatId: '100', messageId: 'm1', text: '1' })
  assert.deepEqual(seen, ['1'], '旧行无 hintTargets → 裸编号不消费，落回对话路由')
  assert.equal(rig.store.get(oldKey).status, 'pending', '旧行不被裁决，仍 pending')
  rig.bridge.dispose()
})

test('chat 级闸门回归：信封缺 chatId（畸形）→ chatMismatch 消费 + 回执，绝不代答', async () => {
  // 畸形信封（chatId 缺失）：sameChat 恒 false → 无三元组命中。该用户确有待决证据
  // → chatMismatch → 消费裸编号 + 回执「请到原会话操作」，问题保持待决——宁可误拦
  // 一条畸形消息，绝不凭无会话证词代答（与按钮路径 SEC-1 同口径）。
  const rig = makeRig({ inbounds: [{ channel: 'telegram', card: true }], channelTypes: ['telegram'] })
  const key = 'aq:nochat'
  rig.store.set(key, { question: 'Q', options: ['甲', '乙'], multiSelect: false, status: 'pending', pushedTo: [], hintChannels: ['telegram'], hintTargets: [{ channel: 'telegram', chatId: '100', userId: '100' }], createdAt: Date.now() })
  rig.bus.wait(key, 800, {})
  const seen = []
  rig.bus.onMessage((envelope) => { seen.push(envelope.text); return false })
  rig.bus.accept({ channel: 'telegram', userId: '100', messageId: 'm1', text: '1' }) // 无 chatId
  assert.deepEqual(seen, [], '畸形信封裸编号被消费，不进对话路由')
  assert.equal(rig.instances[0].texts.length, 1, '回执已发（sendText 尽力而为）')
  assert.match(rig.instances[0].texts[0].text, /请到原会话操作/)
  assert.equal(rig.store.get(key).status, 'pending', '无会话证词不代答')
  rig.bridge.dispose()
})

test('chat 级闸门回归：persistHints 增量落账——A 送达即写盘，B 挂起期间 store 已含 A 证据', async () => {
  // 对抗审查 P1-1/G3（2026-08-25）：persistHints 的价值是崩溃窗口——多目标并行
  // 发送时最慢目标不应拉长「话术已送达但证据未落账」的窗口。该测试是唯一能区分
  // 「增量 vs 聚合」的观察点：目标 A 立即 resolve、目标 B 挂起期间断言 store 行
  // 已含 A 的 hintTargets（若只有末尾整体落账，此时 store 行不含任何 hintTargets）。
  // 删掉 persistHints() 两处调用后此测试必红——证明增量落账真生效。
  const store = createStore(tempPath())
  const vault = createTokenVault({ secret: 's' })
  const bus = createInboundBus({ allowUsers: ['42', '100'], store, vault })
  const identity = createIdentity({ store: createStore(tempPath()) })
  identity.addBinding({ channel: 'qq', userId: '100' })
  identity.addBinding({ channel: 'qq', userId: '42' })
  let resolveB = null
  let midwaySnapshot = null
  const raw = {
    channel: 'qq',
    notifyTargets: () => [
      { chatId: 'qqsink0042', userId: '42' }, // A：立即送达
      { chatId: 'qqpend100', userId: '100' }, // B：挂起
    ],
    async sendQuestionCard() { return null },
    async editResolved() {},
    async sendText(chatId, text) {
      if (chatId === 'qqsink0042') return true // A 立即成功
      // B：用 macrotask delay 确保 A 的 microtask 链（.then → map 回调 await →
      // hintTargets.push → persistHints）完整执行后再检查 store。
      await new Promise((r) => setTimeout(r, 5))
      const row = store.get(store.keys('aq:')[0])
      midwaySnapshot = row?.hintTargets ?? null
      return new Promise((resolve) => { resolveB = () => resolve(false) })
    },
  }
  const notifier = { channels: [], notifyAll: async () => ({ ok: true, delivered: [], skipped: [], failed: [] }) }
  const bridge = createQuestionBridge({ bus, vault, store, notifier, identity, interactive: () => [raw], config: { timeoutMs: 800, escalation: { enabled: false } } })
  bridge.attach()
  const pending = bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  // B 挂起期间（A 已 resolve + persistHints 已写盘），store 行应已含 A 的证据
  assert.deepEqual(midwaySnapshot, [{ channel: 'qq', chatId: 'qqsink0042', userId: '42' }], '增量落账：A 送达即写盘，不等 B 聚合')
  // B 最终 resolve false → 不登记证据；最终行仍只含 A
  if (resolveB) resolveB()
  const result = await pending
  const finalRow = store.get(store.keys('aq:')[0])
  assert.deepEqual(finalRow.hintTargets, [{ channel: 'qq', chatId: 'qqsink0042', userId: '42' }], '最终只含 A 的证据（B 失败不留痕迹）')
  assert.equal(result.answered, false)
  bridge.dispose()
})

test('chat 级闸门回归：升级提醒走 sendText 直发，不登记 hint 证据（hintTargets 不变性）', async () => {
  // 对抗审查 G2（2026-08-25）：升级提醒经 inbound.sendText 直发，不经 hint 管道。
  // 若未来把提醒改走「sendText + 登记证据」公共 helper，会凭空给 chat 发编号证据
  // （全网无红）。本测试钉住不变性：提醒触发后 hintTargets 必须与提醒前一致。
  const identity = createIdentity({ store: createStore(tempPath()) })
  identity.addBinding({ channel: 'qq', userId: '42' })
  const rig = makeRig({
    inbounds: [{ channel: 'qq', card: false, targets: [{ chatId: 'qqowner042', userId: '42' }] }],
    channelTypes: ['qq-bot'],
    identity,
    escalation: { enabled: true, stages: [{ afterMs: 15, note: '提醒' }] },
  })
  const pending = rig.bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  // 话术已送达（sendText 成功）→ hintTargets 含该目标
  const key = rig.store.keys('aq:')[0]
  const hintTargetsBefore = [...(rig.store.get(key)?.hintTargets ?? [])]
  assert.deepEqual(hintTargetsBefore, [{ channel: 'qq', chatId: 'qqowner042', userId: '42' }], '话术送达登记证据')
  // 等升级提醒触发
  await sleep(120)
  // 提醒文案已到达（texts 第二条 = 提醒）
  const escalationTexts = rig.instances[0].texts.filter((t) => /仍在等待作答/.test(t.text))
  assert.ok(escalationTexts.length >= 1, '升级提醒文案已送达')
  // 不变性：提醒触发后 hintTargets 不变
  const hintTargetsAfter = [...(rig.store.get(key)?.hintTargets ?? [])]
  assert.deepEqual(hintTargetsAfter, hintTargetsBefore, '提醒不登记 hint 证据')
  rig.bridge.dispose()
  await pending
})

test('chat 级闸门回归：僵尸 pending 行（无存活 waiter）不参与匹配，消息落回对话路由', async () => {
  // 对抗审查 P1-2（2026-08-25）：进程崩溃/重启/写盘失败会留下 status=pending 但
  // waiter 已死的僵尸行。存活判定以 bus.hasWaiter 为单一事实源——僵尸行不得消费
  // 后续编号回复，也不得产出「已被作答」误导回执（与审批链 C2/P1-5 同族模式）。
  const rig = makeRig({ inbounds: [{ channel: 'telegram', card: true }], channelTypes: ['telegram'] })
  rig.store.set('aq:zombie:1', {
    question: '僵尸', options: ['甲', '乙'], multiSelect: false, status: 'pending',
    // exact 级证据俱全——若不过滤僵尸行，这条裸 1 会被它吞掉并产出假回执
    pushedTo: [{ channel: 'telegram', chatId: '100', userId: '100', messageId: 1, kind: 'aq' }],
    hintChannels: ['telegram'], createdAt: Date.now(),
  })
  const seen = []
  rig.bus.onMessage((envelope) => { seen.push(envelope.text); return false })
  rig.bus.accept({ channel: 'telegram', userId: '100', chatId: '100', messageId: 'mz:1', text: '1' })
  assert.deepEqual(seen, ['1'], '僵尸行不得消费编号回复')
  assert.equal(rig.instances[0].texts.length, 0, '僵尸行不得产出回执（未作答却称已作答）')
  assert.equal(rig.store.get('aq:zombie:1').status, 'pending', '僵尸行不被裁决')
  rig.bridge.dispose()
})

test('chat 级闸门回归：时间戳更新的僵尸行不遮蔽真实待决提问', async () => {
  // 崩溃残留的僵尸行 createdAt 可能晚于真实待决提问（崩溃前最后一条）。latestPendingFor
  // 取「最新」候选时必须先过存活闸：僵尸行再新也不参与，编号回复命中真实提问。
  const rig = makeRig({ inbounds: [{ channel: 'telegram', card: true }], channelTypes: ['telegram'] })
  const pending = rig.bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  rig.store.set('aq:zombie:2', {
    question: '僵尸', options: ['甲', '乙'], multiSelect: false, status: 'pending',
    pushedTo: [{ channel: 'telegram', chatId: '100', userId: '100', messageId: 9, kind: 'aq' }],
    hintChannels: ['telegram'], createdAt: Date.now() + 10_000, // 比活行新
  })
  const seen = []
  rig.bus.onMessage((envelope) => { seen.push(envelope.text); return false })
  rig.bus.accept({ channel: 'telegram', userId: '100', chatId: '100', messageId: 'mz:2', text: '2' })
  assert.equal(seen.length, 0, '编号回复被真实待决提问消费，不落回对话路由')
  assert.equal(rig.store.get('aq:zombie:2').status, 'pending', '僵尸行保持原状')
  const result = await pending
  assert.equal(result.answered, true, '真实待决提问被裁决')
  assert.deepEqual(result.results[0].answers, ['预发环境'])
  rig.bridge.dispose()
})

// ---------------------------------------------------------------- 按钮路径与红线

test('按钮作答：token 裁决 → 卡片终态编辑（已作答文案）+ 账本落定', async () => {
  const rig = makeRig()
  const pending = rig.bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  const tg = rig.instances[0]
  const payload = tg.cards[0]
  const verdict = rig.bridge.decide({ qKey: payload.qKey, optIdx: '2', token: payload.token, via: 'telegram', userId: '100' })
  assert.equal(verdict.ok, true)
  assert.deepEqual(verdict.answers, ['生产环境'])
  const result = await pending
  assert.deepEqual(result.results[0].answers, ['生产环境'])
  assert.equal(tg.edits.length, 1)
  assert.match(tg.edits[0].text, /已作答：生产环境/)
  const row = rig.store.get(payload.qKey)
  assert.equal(row.status, 'resolved')
  assert.equal(row.decision, 'answered')
  rig.bridge.dispose()
})

test('按钮作答：转发点击 chat 不一致 → 拒绝并保留待决，原会话仍可正常作答', async () => {
  const rig = makeRig()
  const pending = rig.bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  const tg = rig.instances[0]
  const payload = tg.cards[0]
  const wrong = rig.bridge.decide({ qKey: payload.qKey, optIdx: '0', token: payload.token, via: 'telegram', userId: '100', chatId: '999' })
  assert.equal(wrong.ok, false)
  assert.match(wrong.message, /请到原会话操作/)
  const row = rig.store.get(payload.qKey)
  assert.equal(row.status, 'pending')
  const right = rig.bridge.decide({ qKey: payload.qKey, optIdx: '0', token: payload.token, via: 'telegram', userId: '100', chatId: '100' })
  assert.equal(right.ok, true)
  const result = await pending
  assert.equal(result.answered, true)
  assert.deepEqual(result.results[0].answers, ['测试环境'])
  rig.bridge.dispose()
})

// v0.8.3 SEC-1：来源校验把通道一并纳入——chatId 相同但通道不同视为不同来源（拒绝）。
test('按钮作答：chatId 相同但跨通道（via 非原通道）→ 拒绝，不改判原卡', async () => {
  const rig = makeRig()
  const pending = rig.bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  const payload = rig.instances[0].cards[0]
  // 卡片实际送达 telegram chat 100；伪造来自 qq 的同 chatId 100 → 拒绝
  const crossChannel = rig.bridge.decide({ qKey: payload.qKey, optIdx: '0', token: payload.token, via: 'qq:button', userId: 'u2', chatId: '100' })
  assert.equal(crossChannel.ok, false)
  assert.match(crossChannel.message, /请到原会话操作/)
  assert.equal(rig.store.get(payload.qKey).status, 'pending', '跨通道点击不落终态')
  // 原通道 telegram 同 chatId → 通过
  const right = rig.bridge.decide({ qKey: payload.qKey, optIdx: '0', token: payload.token, via: 'telegram', userId: '100', chatId: '100' })
  assert.equal(right.ok, true)
  const result = await pending
  assert.deepEqual(result.results[0].answers, ['测试环境'])
  rig.bridge.dispose()
})

test('AUTH-1 总线层来源校验：card 到 chat A，chat B 的 bus.decide 被拒且不核销，原会话仍可答', async () => {
  const rig = makeRig()
  const pending = rig.bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  const tg = rig.instances[0]
  const payload = tg.cards[0]
  // 转发到非目标 chat 999 → 总线明确拒绝 source-chat-mismatch（AUTH-1：allowChats 已注册）
  const forwarded = rig.bus.decide({
    approvalKey: payload.qKey,
    decision: 'allowed-once',
    token: payload.token,
    via: 'telegram:button',
    userId: '100',
    chatId: '999',
  })
  assert.deepEqual(forwarded, { ok: false, reason: 'source-chat-mismatch' })
  assert.equal(rig.store.get(payload.qKey).status, 'pending', '转发裁决不落终态/不核销 wait')
  // 原会话 chat 100 仍可答（走 questions.decide 真实按钮路径）
  const right = rig.bridge.decide({ qKey: payload.qKey, optIdx: '0', token: payload.token, via: 'telegram', userId: '100', chatId: '100' })
  assert.equal(right.ok, true)
  const result = await pending
  assert.equal(result.answered, true)
  assert.deepEqual(result.results[0].answers, ['测试环境'])
  rig.bridge.dispose()
})

// v0.8.4 AUTH-1：空目标（无任何可送卡会话）→ allowChats 为空 Map，不放行任意 chat。
test('AUTH-1 空目标：无推卡会话时任意 chatId 的 bus.decide 均被拒（不放行 wildcard）', async () => {
  const rig = makeRig({ inbounds: [{ channel: 'telegram', card: true, targets: [] }], channelTypes: ['telegram'] })
  const pending = rig.bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  const keys = rig.store.keys('aq:')
  assert.equal(keys.length, 1, '在途问题存在')
  const qKey = keys[0]
  // 无任何可送卡会话 → bus.wait 用空 allowChats 注册。用合法 token 走按钮裁决，任意 chatId
  // 都会命中空 Map → source-chat-mismatch（不放行 wildcard），且不核销 wait。
  const token = rig.vault.mint(qKey)
  const verdict = rig.bus.decide({
    approvalKey: qKey,
    decision: 'allowed-once',
    token,
    via: 'telegram:button',
    userId: '100',
    chatId: '100',
  })
  assert.deepEqual(verdict, { ok: false, reason: 'source-chat-mismatch' })
  assert.equal(rig.store.get(qKey).status, 'pending', '空目标下载决不落终态')
  const result = await pending // 超时收场（不代答）
  assert.equal(result.answered, false)
  rig.bridge.dispose()
})

// v0.8.4 SEC-5/6：同渠道非提问者回裸编号被拒（onChannel 收紧 → 不命中、不消费、不落终态）。
test('SEC-5/6 同渠道非提问者：回裸编号被拒（不消费不裁决，问题保持待决）', async () => {
  // 卡片送达 qq 用户 100（提示该用户可答）；channelTypes=['qq'] 且卡已送达 → hintChannels=[]，
  // 不存在 hint 兜底。同渠道另一绑定用户 42 回裸 1：SEC-5/6 下不命中（不同 userId）、不消费。
  const rig = makeRig({ inbounds: [{ channel: 'qq', card: true, targets: [{ chatId: 'qquser100', userId: '100' }] }], channelTypes: ['qq'] })
  const pending = rig.bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  assert.equal(rig.instances[0].cards.length, 1, 'qq 卡片已送达')
  const seen = []
  rig.bus.onMessage((envelope) => { seen.push(envelope.text); return false })
  rig.bus.accept({ channel: 'qq', userId: '42', chatId: '42', messageId: 'm1', text: '1' })
  assert.deepEqual(seen, ['1'], '非提问者裸编号不被消费，落回对话路由')
  const rows = rig.store.keys('aq:').map((key) => rig.store.get(key))
  assert.equal(rows.filter((row) => row.status === 'pending').length, 1, '非提问者作答不落终态')
  const result = await pending
  assert.equal(result.answered, false, '问题未被他人代答')
  rig.bridge.dispose()
})

// v0.8.4 SEC-5/6 正控：正确用户正确渠道回编号仍可作答（收紧不误伤合法用户）。
test('SEC-5/6 正控：卡片送达的用户本人（正确渠道）回裸编号可正常作答', async () => {
  // 卡片送达 qq 用户 100（pushedTo 含 userId 100），hintChannels=[]。用户本人回 1 → exact 命中。
  const rig = makeRig({ inbounds: [{ channel: 'qq', card: true, targets: [{ chatId: 'qquser100', userId: '100' }] }], channelTypes: ['qq'] })
  const pending = rig.bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  assert.equal(rig.instances[0].cards.length, 1, 'qq 卡片已送达')
  rig.bus.accept({ channel: 'qq', userId: '100', chatId: 'qquser100', messageId: 'm1', text: '1' })
  const result = await pending
  assert.equal(result.answered, true)
  assert.deepEqual(result.results[0].answers, ['测试环境'])
  assert.match(result.results[0].via, /qq:reply/)
  rig.bridge.dispose()
})

test('首达采纳：作答后同 token 再点按钮被拒（问题已回答）', async () => {
  const rig = makeRig()
  const pending = rig.bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  const payload = rig.instances[0].cards[0]
  assert.equal(rig.bridge.decide({ qKey: payload.qKey, optIdx: '0', token: payload.token }).ok, true)
  const again = rig.bridge.decide({ qKey: payload.qKey, optIdx: '1', token: payload.token })
  assert.equal(again.ok, false)
  assert.match(again.message, /已回答或已过期/)
  await pending
  rig.bridge.dispose()
})

test('伪造 token 被拒，问题继续等到超时（不代答）', async () => {
  const rig = makeRig()
  const pending = rig.bridge.askQuestions({ questions: [SINGLE] })
  await sleep(30)
  const payload = rig.instances[0].cards[0]
  const forged = rig.vault.mint('aq:other:9')
  const bad = rig.bridge.decide({ qKey: payload.qKey, optIdx: '0', token: 'garbage.sig' })
  assert.equal(bad.ok, false)
  const mismatch = rig.bridge.decide({ qKey: payload.qKey, optIdx: '0', token: forged })
  assert.equal(mismatch.ok, false)
  const result = await pending // 超时收场（800ms 配置）
  assert.equal(result.ok, true)
  assert.equal(result.answered, false)
  assert.equal(result.results[0].answered, false)
  assert.equal(result.results[0].answers, undefined, '超时绝不编造答案')
  const row = rig.store.get(payload.qKey)
  assert.equal(row.decision, 'timeout')
  assert.equal(rig.instances[0].edits.length, 1)
  assert.match(rig.instances[0].edits[0].text, /超时未作答/)
  rig.bridge.dispose()
})

test('多问逐问推送逐问独立作答：全答 answered=true，一问超时 answered=false', async () => {
  const identity = createIdentity({ store: createStore(tempPath()) })
  identity.addBinding({ channel: 'qq', userId: '42' }) // 首条绑定 = owner（CRACK-004 hint 兜底需 owner）
  const rig = makeRig({ inbounds: [{ channel: 'qq', card: false, targets: [{ chatId: 'qqowner042', userId: '42' }] }], channelTypes: ['qq'], identity })
  const pending = rig.bridge.askQuestions({
    questions: [SINGLE, MULTI],
    timeoutMs: 500,
  })
  await sleep(30)
  rig.bus.accept({ channel: 'qq', userId: '42', chatId: 'qqowner042', messageId: 'msg:q:1', text: '1' })
  // 第二问不答 → 超时
  const result = await pending
  assert.equal(result.ok, true)
  assert.equal(result.answered, false)
  assert.equal(result.results[0].answered, true)
  assert.equal(result.results[1].answered, false)
  rig.bridge.dispose()
})

// ---------------------------------------------------------------- validateAskArgs

test('validateAskArgs：questions 边界（0/5 个、选项 1/6 项、label 空/超长）全拒', () => {
  const base = { question: 'q', options: [{ label: 'a' }, { label: 'b' }] }
  assert.equal(validateAskArgs({ questions: [] }).ok, false)
  assert.match(validateAskArgs({ questions: [] }).reason, /1 到 4/)
  assert.equal(validateAskArgs({ questions: Array.from({ length: 5 }, () => base) }).ok, false)
  assert.equal(validateAskArgs({ questions: [{ question: '', options: base.options }] }).ok, false)
  assert.equal(validateAskArgs({ questions: [{ question: 'q', options: [{ label: 'a' }] }] }).ok, false)
  assert.equal(validateAskArgs({
    questions: [{ question: 'q', options: Array.from({ length: 6 }, (_, i) => ({ label: `o${i}` })) }],
  }).ok, false)
  assert.equal(validateAskArgs({
    questions: [{ question: 'q', options: [{ label: '' }, { label: 'b' }] }],
  }).ok, false)
  assert.equal(validateAskArgs({
    questions: [{ question: 'q', options: [{ label: 'x'.repeat(61) }, { label: 'b' }] }],
  }).ok, false)
  const ok = validateAskArgs({ questions: [base] })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.questions, [{ question: 'q', options: [{ label: 'a' }, { label: 'b' }], multiSelect: false }])
})

test('validateAskArgs：timeoutMs 钳制到 30s-30min，缺省 300s；context 截 300', () => {
  const questions = [{ question: 'q', options: [{ label: 'a' }, { label: 'b' }] }]
  assert.equal(validateAskArgs({ questions, timeoutMs: 1000 }).timeoutMs, 30_000)
  assert.equal(validateAskArgs({ questions, timeoutMs: 99_999_999 }).timeoutMs, 1_800_000)
  assert.equal(validateAskArgs({ questions }).timeoutMs, 300_000)
  assert.equal(validateAskArgs({ questions, timeoutMs: 'abc' }).timeoutMs, 300_000)
  const withContext = validateAskArgs({ questions, context: 'x'.repeat(500) })
  assert.equal(withContext.context.length, 300)
})

// ---------------------------------------------------------------- registerAskUserTool

function makeToolCtx() {
  const defs = []
  return {
    defs,
    ctx: { tools: { register: (def) => { defs.push(def); return () => {} } } },
  }
}

test('registerAskUserTool：宿主无 tools 服务返回 null（静默跳过不崩）', () => {
  assert.equal(registerAskUserTool({}, {}), null)
  assert.equal(registerAskUserTool({ tools: {} }, {}), null)
})

test('registerAskUserTool：参数校验失败返回明确原因，不触达桥', async () => {
  const forbidden = { askQuestions: () => { throw new Error('不应触达桥') } }
  const { ctx, defs } = makeToolCtx()
  const dispose = registerAskUserTool(ctx, forbidden, { rateLimitPerMinute: 6 })
  assert.equal(defs.length, 1)
    const result = await defs[0].execute({ questions: [] }, { agent: { id: 'agent-1' } })
  assert.equal(result.ok, false)
  assert.match(result.reason, /1 到 4/)
  assert.equal(result.answered, false)
  assert.ok(dispose !== null)
  dispose()
})

test('registerAskUserTool：完整注册形状 + 渲染 + 端到端作答', async () => {
  const rig = makeRig()
  const { ctx, defs } = makeToolCtx()
  const dispose = registerAskUserTool(ctx, rig.bridge, { rateLimitPerMinute: 6 })
  assert.equal(defs.length, 1)
  const def = defs[0]
  assert.equal(def.name, 'ask_user')
  assert.deepEqual(def.parameters.required, ['questions'])
  const first = def.execute({ questions: [{ question: '选一个', options: [{ label: '甲' }, { label: '乙' }] }] }, { agent: { id: 'agent-1' } })
  await sleep(30)
  const payload = rig.instances[0].cards[0]
  rig.bridge.decide({ qKey: payload.qKey, optIdx: '1', token: payload.token, via: 'telegram', userId: '100' })
  const firstResult = await first
  assert.equal(firstResult.ok, true)
  assert.equal(firstResult.answered, true)
  assert.match(def.output.render({}, firstResult)[0].text, /用户已作答/)
  const invalid = await def.execute({ questions: [] })
  assert.equal(invalid.ok, false)
  assert.match(invalid.reason, /1 到 4/)
  assert.match(def.output.render({}, invalid)[0].text, /提问未发出/)
  const timeoutShape = { ok: true, answered: false, results: [{ question: 'q', answered: false }] }
  assert.match(def.output.render({}, timeoutShape)[0].text, /未在时限内完成全部作答/)
  dispose()
  rig.bridge.dispose()
})

test('registerAskUserTool：限流——每分钟第二次调用直接拒，不触达桥', async () => {
  const forbidden = { askQuestions: () => { throw new Error('不应触达桥') } }
  const { ctx, defs } = makeToolCtx()
  const dispose = registerAskUserTool(ctx, forbidden, { rateLimitPerMinute: 1 })
  const def = defs[0]
  const questions = [{ question: 'q', options: [{ label: 'a' }, { label: 'b' }] }]
  const first = await def.execute({ questions, timeoutMs: 1 }) // 30s 钳制不影响：限流先判
  assert.notEqual(first.rateLimited, true, '第一次应放行')
  const limited = await def.execute({ questions })
  assert.equal(limited.rateLimited, true)
  assert.equal(limited.ok, false)
  assert.match(def.output.render({}, limited)[0].text, /已限流/)
  dispose()
})

test('B3 dispose 级联：ask_user 任务在 agent/disposed 后标记 terminated', async () => {
  const store = createStore(tempPath())
  const vault = createTokenVault({ secret: 'test-secret' })
  const bus = createInboundBus({ allowUsers: ['42', '100'], store, vault })
  const broadcasts = []
  const notifier = { channels: ['telegram'], notifyAll: async (msg, opts) => { broadcasts.push({ msg, opts }); return { ok: true, delivered: [], skipped: [], failed: [] } } }
  const instances = [{
    raw: {
      channel: 'telegram',
      notifyTargets: () => [{ chatId: '100', userId: '100' }],
      async sendQuestionCard(payload) { return { messageId: 1 } },
      async editResolved(target, text) { broadcasts.push({ target, text }) },
      async sendText() { return true },
    },
  }]
  const bridge = createQuestionBridge({
    bus,
    vault,
    store,
    notifier,
    interactive: () => instances.map((item) => item.raw),
    config: { timeoutMs: 800, escalation: { enabled: false } },
  })
  bridge.attach()
  const pending = bridge.askQuestions({ questions: [SINGLE] }, { agent: { id: 'agent-9' } })
  await sleep(30)
  assert.equal(bus.abandonByAgent('agent-9'), 1)
  const result = await pending
  assert.equal(result.answered, false)
  assert.equal(result.results[0].reason, 'terminated')
  assert.equal(store.keys('aq:').length, 1)
  assert.equal(store.get(store.keys('aq:')[0]).decision, 'terminated')
  bridge.dispose()
})
