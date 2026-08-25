// dsh-notifier questions/router.mjs
// v0.8 远程提问桥（issue #3/#5，规划书《选项卡通知》M1）：
// agent 调用 ask_user 工具 → 问题与选项推到手机（飞书选项卡片 / Telegram 按钮 /
// 无按钮通道编号回复）→ 用户作答 → 答案作为工具结果回传给 agent。
//
// 设计原则（规划书 P1–P7，全部复用审批桥接栈既有设施）：
//  - P1 双端并存首达采纳：bus.settle 天然键值泛化，谁先答谁赢，后到者 already-resolved
//  - P2 超时永不代答：超时 answered=false，静默交还桌面，绝不编造默认答案
//  - P3 选项集封闭：只接受提问时声明过的选项（下标越界/伪造负载一律拒绝）
//  - P4 卡片为主、编号兜底：选项卡片是主交互；编号文案只发卡片未送达的渠道
//    （无按钮通道 / 卡片投递失败 / 多选暂无卡片形态）。发错编号不作废问题：
//    回执提示 + 重发选项，保持待决可再答
//  - P5 裁决后终态化：作答/超时后卡片 patch 终态（去按钮、显结果）
//  - P7 回调载荷永不携带选项文本：aq:<qKey>:<optIdx>:<token>（下标引用）
//
// 账本：store 键空间 'aq:'（与审批 'ap:' 隔离），行 = {
//   question, options: [label], multiSelect, status: 'pending'|'resolved',
//   pushedTo: [{channel, chatId, userId, messageId, kind:'aq'}], createdAt,
//   hintTargets?: [{channel, chatId, userId}]（2026-08-25 chat 级闸门：编号话术实际
//     送达的 (channel,chatId,userId) 三元组，latestPendingFor 的 hint/chatMismatch
//     据此裁决；缺省/旧行 = 无 chat 级证据，fail-closed 从严）,
//   hintChannels?: string[]（渠道级 observability 快照，不再参与匹配——仅记账/排障用）,
//   decision?: 'answered'|'timeout'|'error', answers?: [label]（重复点击回显用）
// }
// 军规：任何异常只丢当次提问（工具返回明确失败对象），绝不弄崩宿主。

import { randomBytes } from 'node:crypto'
import { normalizeInbound } from '../inbound/_contract.mjs'
import { guardTargets } from '../inbound/target-guard.mjs'
import { createEscalationChain } from '../approval/escalation.mjs'
import { createInteractionLedger } from '../interaction/ledger.mjs'
import { createRateLimiter, compileParameters } from '../tool-register.mjs'
// 维护批 6 前置：跨渠道能力矩阵作为单一事实来源
import { isCoveredByOutbound } from '../inbound/capability-matrix.mjs'

const KEY_PREFIX = 'aq:'

// 升级链默认节奏（与审批一致：30s / 60s 各再提醒一轮）
const DEFAULT_ESCALATION_STAGES = [
  { afterMs: 30_000, level: 'timeSensitive', note: '提问仍在等待作答' },
  { afterMs: 60_000, level: 'timeSensitive', note: '提问仍在等待作答（第 2 次提醒）' },
]

/** 组装编号回复文案（P4：按钮渠道也保留——卡片发送失败时文字路径仍在）。 */
function numberedHint(options, multiSelect) {
  const lines = options.map((label, idx) => `${idx + 1}. ${label}`)
  const how = multiSelect ? '回复编号（多选逗号分隔，如 1,3）' : '回复编号'
  return `${lines.join('\n')}\n（${how}）`
}

/**
 * 创建远程提问桥。
 * @param {object} deps
 * @param {ReturnType<typeof import('../inbound/bus.mjs').createInboundBus>} deps.bus
 * @param {ReturnType<typeof import('../inbound/tokens.mjs').createTokenVault>} deps.vault
 * @param {import('../inbound/store.mjs').store} deps.store
 * @param {object} deps.notifier - createNotifier 实例（广播编号文案用）
 * @param {() => object[]} deps.interactive - 交互通道实例列表（惰性 getter，装配期后解引用）
 * @param {object} [deps.identity] - 身份注册表（CRACK-004：hint 兜底编号回复仅该渠道绑定的
 *   owner 可代答；缺失/异常 fail-closed。exact/onChannel 属当事人级命中，不查 identity）
 * @param {object} [deps.logger]
 * @param {{ timeoutMs?: number, escalation?: { enabled?: boolean, stages?: object[] } }} [deps.config]
 */
export function createQuestionBridge(deps) {
  const { bus, vault, store, notifier, identity } = deps
  const logger = deps.logger ?? null
  const config = deps.config ?? {}
  const defaultTimeoutMs = Math.max(1000, Number(config.timeoutMs) || 300000)
  const warn = (message) => {
    try { logger?.warn?.('[dsh-notifier/questions]', message) } catch { /* 日志失败绝不致命 */ }
  }

  const escalationCfg = (config.escalation !== null && typeof config.escalation === 'object') ? config.escalation : {}
  const escalationStages = Array.isArray(escalationCfg.stages) && escalationCfg.stages.length > 0
    ? escalationCfg.stages
    : DEFAULT_ESCALATION_STAGES
  const escalation = createEscalationChain({
    stages: escalationCfg.enabled === false ? [] : escalationStages,
    logger,
  })

  // Interaction Core：aq: 行统一状态机（pending→resolved，decision 终态裁决）。
  // latestPendingFor 归属/兜底启发式（exact/hint/chatMismatch）是提问特有语义，保留在
  // 链内——核心只提供原子账本操作（见 interaction/ledger.mjs）。
  const core = createInteractionLedger({ keyPrefix: KEY_PREFIX, store })
  /**
   * 最近一条待决提问（编号回复降级，2026-08-25 chat 级闸门）。匹配优先级：
   *   1) exact pushedTo 中有 (channel,userId,chatId) 三元组命中；
   *   2) hint hintTargets 中有三元组命中（编号话术实际送达的会话）；
   *   3) chatMismatch 同 (channel,userId) 有待决但 chatId 不命中任何证据
   *      （含信封缺 chatId 的畸形场景）——消费但不代答，回执「请到原会话操作」。
   *   无任何三元组证据（旧行只有 hintChannels、pushedTo/hintTargets 也不含该 user）
   *   → 不命中，fail-closed 从严（裸编号落回对话路由）。
   * 僵尸行过滤：行还在账本但 waiter 已死（进程崩溃/重启残留）不得消费编号回复——
   *   bus.hasWaiter 是单一事实源，链内不再维护 liveWaiters 并行集合。
   * CRACK-004：返回值带 evidence（exact|hint|chatMismatch）——handleNumberedReply
   * 的归属闸据此放行 exact（当事人级）、对 hint 要求 owner、对 chatMismatch 直接拒绝。
   */
  const latestPendingFor = (channel, userId, chatId) => {
    let exact = null
    let hint = null
    let chatMismatch = null
    // sameChat：三元组全中（信封缺 chatId 时 String(chatId)='undefined'，恒不中）。
    const sameChat = (target) => target.channel === channel
      && String(target.userId) === String(userId)
      && String(target.chatId) === String(chatId)
    // sameUser：同 (channel,userId)——有 per-target 证据但 chatId 不中即 chatMismatch。
    const sameUser = (target) => target.channel === channel
      && String(target.userId) === String(userId)
    for (const key of core.scanKeys()) {
      const row = core.get(key)
      // 僵尸行过滤：pending 但无存活 waiter 的行（崩溃残留）不参与匹配——
      // 行还在账本里、waiter 已死，不得再消费编号回复（单一事实源 = bus.hasWaiter）。
      if (!core.isPending(row) || !bus.hasWaiter(key)) continue
      const pushed = Array.isArray(row.pushedTo) ? row.pushedTo : []
      const targets = Array.isArray(row.hintTargets) ? row.hintTargets : []
      const exactHit = pushed.some(sameChat)
      const hintHit = targets.some(sameChat)
      const hasStake = pushed.some(sameUser) || targets.some(sameUser)
      if (exactHit) {
        if (exact === null || row.createdAt > exact.row.createdAt) exact = { key, row, evidence: 'exact' }
      }
      if (hintHit) {
        if (hint === null || row.createdAt > hint.row.createdAt) hint = { key, row, evidence: 'hint' }
      }
      // chatMismatch：同 (channel,userId) 有 per-target 证据但 chatId 不命中任何三元组
      // （含信封缺 chatId 的畸形场景——sameChat 恒 false）。无 per-target 证据的旧行
      // （pushedTo/hintTargets 都不含该 user）不构成 chatMismatch，fail-closed 跳过。
      if (!exactHit && !hintHit && hasStake) {
        if (chatMismatch === null || row.createdAt > chatMismatch.row.createdAt) chatMismatch = { key, row, evidence: 'chatMismatch' }
      }
    }
    return exact ?? hint ?? chatMismatch
  }
  // 核心账本 + 提问专用归属启发式合成同一 ledger 面（其余调用点零改动）。
  const ledger = { ...core, latestPendingFor }

  /** 交互通道列表（归一 + 防御；getter 失败按空处理）。 */
  function interactiveEntries() {
    try {
      const raw = typeof deps.interactive === 'function' ? deps.interactive() : []
      return (Array.isArray(raw) ? raw : [])
        .map((entry) => normalizeInbound(entry))
        .filter((entry) => entry !== null && entry.channel !== '')
    } catch {
      return []
    }
  }

  /** 推一个问题：选项卡片为主（单选按钮），编号文案只发卡片未送达的渠道（兜底）。 */
  async function pushQuestion(qKey, token, question, allowChats = null) {
    const title = `提问：${String(question.question).slice(0, 60)}`
    const context = String(question.context ?? '').trim()
    const content = [
      context !== '' ? context : 'agent 需要你做一个选择',
      question.multiSelect === true ? '（多选）' : '（单选）',
    ].join('\n')
    const options = question.options.map((option) => option.label)
    const isMulti = question.multiSelect === true
    const pushedTo = []
    const escalationTargets = []
    const escalationTargetKeys = new Set()
    const deliveredTypes = new Set() // 卡片已送达的通道类型：这些渠道不再重复教编号
    // issue #11：卡片未送达、但该问题目标用户已绑定此交互入站通道（kept 非空）的条目。
    // 这些通道的编号回复必须能命中（qq-bot 出站 ↔ qq 入站异名、wechat iLink 纯入站无出站都靠它）。
    const hintedInbound = []
    const persistPushed = () => {
      try {
        const row = ledger.get(qKey)
        if (row !== undefined) store.set(qKey, { ...row, pushedTo: [...pushedTo] })
      } catch { /* 增量落账失败不致命，末尾整体落账兜底 */ }
    }
    // 2026-08-25 chat 级闸门：hintTargets 记录编号话术实际送达的 (channel,chatId,userId)
    // 三元组，替代旧的渠道级 hintedChannels。增量落账（persistHints）确保多目标并行
    // 发送时，先送达的目标证据即时写盘——崩溃窗口不拉长「话术已送达但证据未落账」
    // 的暴露面（对抗审查 P1-1/G3）。末尾 askQuestions 整体落账兜底。
    const hintTargets = []
    const persistHints = () => {
      try {
        const row = ledger.get(qKey)
        if (row !== undefined) store.set(qKey, { ...row, hintTargets: [...hintTargets] })
      } catch { /* 增量落账失败不致命，末尾整体落账兜底 */ }
    }
    for (const inbound of interactiveEntries()) {
      const { kept } = guardTargets(inbound.channel, inbound.notifyTargets(), warn)
      for (const target of kept) {
        // 多选暂无卡片形态（飞书表单回调未实测，规划书风险项）：通道返回 null → 编号兜底
        const card = await inbound.sendQuestionCard({
          chatId: target.chatId,
          title,
          content,
          qKey,
          token,
          options,
          multiSelect: isMulti,
        })
        if (card !== null) {
          pushedTo.push({ channel: inbound.channel, chatId: target.chatId, userId: target.userId, messageId: card.messageId, kind: 'aq' })
          const targetKey = `${inbound.channel}\u0000${target.chatId}\u0000${target.userId}`
          if (!escalationTargetKeys.has(targetKey)) {
            escalationTargetKeys.add(targetKey)
            escalationTargets.push({ inbound, target })
          }
          if (allowChats !== null) {
            let chatSet = allowChats.get(inbound.channel)
            if (chatSet === undefined) {
              chatSet = new Set()
              allowChats.set(inbound.channel, chatSet)
            }
            chatSet.add(String(target.chatId))
          }
          deliveredTypes.add(inbound.channel)
          persistPushed()
        }
      }
      // issue #11：卡片未送达 + 目标用户已绑定 → 记录为待补编号话术的入站通道
      // （sendText 送达 + 通道名补进 hintChannels）。只记 kept 非空的绑定通道，
      // 未绑定用户的通道不进（SEC-2 fail-closed）。
      if (kept.length > 0 && !deliveredTypes.has(inbound.channel)) {
        hintedInbound.push({ channel: inbound.channel, targets: kept, inbound })
      }
    }
    // 编号文案只发卡片未送达的渠道（P4 文字路径兜底）：卡片已到手的用户不再收
    // 一条冗余的「回复编号」广播——选项卡是主交互，编号是无卡片/投递失败时的降级。
    const allTypes = Array.isArray(notifier?.channels) ? notifier.channels : []
    const textTypes = allTypes.filter((type) => !deliveredTypes.has(type))
    let deliveredTextTypes = []
    if (textTypes.length > 0) {
      const outcome = await notifier.notifyAll({
        title,
        content: `${content}\n\n${numberedHint(options, isMulti)}`,
        level: 'timeSensitive',
      }, { channelTypes: textTypes }).catch(() => null)
      // notifyAll 的 ok=true 也可能代表空目标/静音；只有返回 delivered 中的
      // 渠道才算真正留下编号兜底证据，失败或未知返回一律 fail-closed。
      if (outcome !== null && Array.isArray(outcome.delivered)) {
        const delivered = new Set(outcome.delivered.map((type) => String(type)))
        deliveredTextTypes = textTypes.filter((type) => delivered.has(String(type)))
      }
    }
    // issue #11：把「目标用户已绑定、卡片未送达」的交互入站通道补进编号话术覆盖范围。
    // 编号话术经入站 sendText 送达（纯入站通道如 wechat iLink 没有出站文本可走）；
    // 已由出站文本送达的通道（同名 type，或别名对如 qq-bot↔qq）只补通道名不重发，
    // 避免同号双发。只加目标用户已绑定的通道、话术确实送达才入 hintChannels——
    // 保持 SEC-2 fail-closed（没收到话术的渠道/用户裸编号仍拒绝）。
    const hintText = `${title}\n${content}\n\n${numberedHint(options, isMulti)}`
    for (const entry of hintedInbound) {
      const coveredByOutbound = isCoveredByOutbound(entry.channel, deliveredTextTypes)
      const hintSends = []
      for (const target of entry.targets) {
        const targetKey = `${entry.channel}\u0000${target.chatId}\u0000${target.userId}`
        if (!escalationTargetKeys.has(targetKey)) {
          escalationTargetKeys.add(targetKey)
          escalationTargets.push({ inbound: entry.inbound, target })
        }
        if (coveredByOutbound) {
          // 出站广播已覆盖该渠道（同名或别名对，如 qq-bot↔qq）——话术视同已送达该
          // 目标，记 per-target 证据但不重发（避免同号双发，issue #11）。
          hintTargets.push({ channel: entry.channel, chatId: String(target.chatId), userId: String(target.userId) })
        } else {
          // 纯入站通道（如 wechat iLink）或出站未覆盖：逐目标 sendText，成功才记证据
          // （SEC-2 fail-closed：没收到话术的人凭裸编号不得命中）。增量落账在每条
          // sendText resolve 后立即触发——先送达的目标证据即时写盘（persistHints）。
          hintSends.push({
            chatId: target.chatId,
            userId: target.userId,
            promise: entry.inbound.sendText(target.chatId, hintText).then((ok) => ok === true).catch(() => false),
          })
        }
      }
      if (coveredByOutbound) {
        if (hintTargets.length > 0) persistHints()
      } else {
        // 增量落账：每条 sendText 成功即 push hintTargets + persistHints——
        // 最慢目标不应拉长「话术已送达但证据未落账」的崩溃窗口。
        await Promise.all(hintSends.map(async (item) => {
          if (await item.promise) {
            hintTargets.push({ channel: entry.channel, chatId: String(item.chatId), userId: String(item.userId) })
            persistHints()
          }
        }))
      }
    }
    // hintChannels 降为渠道级 observability 快照：出站 deliveredTextTypes +
    // hintTargets 涉及的渠道去重。不再参与 latestPendingFor 匹配——chat 级证据
    // 以 hintTargets 三元组为准（渠道级 hintChannels 仅记账/排障用）。
    return {
      pushedTo,
      hintChannels: [...new Set([...deliveredTextTypes, ...hintTargets.map((t) => t.channel)])],
      hintTargets,
      escalationTargets,
    }
  }

  /** 把送达过的卡片全部改成终态（超时/已答；editTarget 按 pushedTo 行的 kind 选卡片形态）。 */
  async function markResolved(pushedTo, text) {
    const byChannel = new Map(interactiveEntries().map((entry) => [entry.channel, entry]))
    for (const target of pushedTo ?? []) {
      const inbound = byChannel.get(target.channel)
      if (inbound === undefined) continue
      await inbound.editTarget(target, text)
    }
  }

  /** 下标集校验与去重（P3 封闭集）：越界/重复归一/单选多项一律 null。返回去重后的下标数组。 */
  function resolveIdxs(row, optIdxes) {
    if (!Array.isArray(optIdxes) || optIdxes.length === 0) return null
    if (row.multiSelect !== true && optIdxes.length !== 1) return null
    const seen = new Set()
    const idxs = []
    for (const rawIdx of optIdxes) {
      const idx = Number(rawIdx)
      if (!Number.isInteger(idx) || idx < 0 || idx >= row.options.length) return null
      if (seen.has(idx)) continue // 容忍重复（卡片表单可能回带重复值），去重即可
      seen.add(idx)
      idxs.push(idx)
    }
    return idxs
  }

  /** 统一裁决入口（token 路径）。返回 { ok, message, answers? }。 */
  function decide({ qKey, optIdx, values, token, via = 'unknown', userId = '(unknown)', chatId = undefined }) {
    const row = ledger.get(qKey)
    if (row === undefined || row.status !== 'pending') {
      return { ok: false, message: '该提问已回答或已过期' }
    }
    const verdict = vault.verify(token)
    if (!verdict.ok) {
      return { ok: false, message: `作答被拒绝（${verdict.reason === 'expired' ? '已过期' : '校验失败'}）` }
    }
    if (verdict.key !== qKey) return { ok: false, message: '作答被拒绝（问题不匹配）' }
    if (chatId !== undefined && chatId !== null && String(chatId) !== '') {
      const pushedTo = Array.isArray(row.pushedTo) ? row.pushedTo : []
      // v0.8.3 SEC-1：来源会话校验把通道一并纳入——only 比对 chatId 不够，跨通道
      // 同 chatId（如不同渠道恰好同值）要视为不同来源，避免误命中。
      const clickVia = String(via ?? '').split(':')[0]
      if (!pushedTo.some((target) => String(target?.channel ?? '') === clickVia && String(target?.chatId ?? '') === String(chatId))) {
        return { ok: false, message: '请到原会话操作' }
      }
    }
    const optIdxes = optIdx === 'm' ? values : [optIdx]
    return settle(qKey, row, optIdxes, via, userId)
  }

  /** 可信裁决（编号回复：白名单已由 bus.accept 建立，跳 token，仍受首达采纳约束）。 */
  function decideTrusted({ qKey, optIdxes, via = 'unknown', userId = '(unknown)' }) {
    const row = ledger.get(qKey)
    if (row === undefined || row.status !== 'pending') {
      return { ok: false, message: '该提问已回答或已过期' }
    }
    return settle(qKey, row, optIdxes, via, userId)
  }

  function settle(qKey, row, optIdxes, via, userId) {
    const idxs = resolveIdxs(row, optIdxes)
    if (idxs === null) {
      return { ok: false, message: '无效选项（只接受提问时给出的编号）' }
    }
    const verdict = bus.settle(qKey, { kind: 'aq', idxs }, via, userId)
    if (!verdict.ok) return { ok: false, message: '该提问已被作答（首达采纳）' }
    const labels = idxs.map((idx) => row.options[idx])
    ledger.resolve(qKey, 'answered', { answers: labels, via: String(via), userId: String(userId) })
    warn(`${qKey} 作答：${labels.join('、')}（via ${via}）`)
    return { ok: true, message: `✅ 已作答：${labels.join('、')}`, answers: labels }
  }

  /**
   * 编号回复兜底（P4）：白名单用户回复 '2' / '1,3'（中英文逗号均可）作答最近一条待决提问。
   * 发错了不作废——无效编号：消费该消息（不进对话路由）+ 回执提示 + 把选项重发一遍，
   * 问题保持待决，用户直接再答即可；有效作答后回执确认。
   * 消费语义与审批一致：返回 true = bus 停止扇出（不进对话路由）。
   * 注意：审批的编号处理器先注册（'1'/'2' 且有待决审批时审批优先消费）。
   */
  function handleNumberedReply(envelope) {
    const text = String(envelope.text ?? '').trim()
    if (!/^\d{1,2}([,，]\d{1,2})*$/.test(text)) return false
    const nums = text.split(/[,，]/).map(Number)
    if (nums.length === 0) return false
    const pending = ledger.latestPendingFor(envelope.channel, envelope.userId, envelope.chatId)
    if (pending === null) return false
    const row = pending.row
    const max = row.options.length
    const sendFeedback = (message) => {
      const inbound = interactiveEntries().find((entry) => entry.channel === envelope.channel)
      if (inbound !== undefined) void inbound.sendText(envelope.chatId, message)
    }
    // chat 级闸门（2026-08-25）：chatMismatch = 同 (channel,userId) 有证据但 chatId
    // 不命中（含信封缺 chatId 的畸形场景）。消费但不代答，回执「请到原会话操作」，
    // 问题保持待决——原会话仍可正常作答（与按钮路径 SEC-1 来源会话校验同口径）。
    if (pending.evidence === 'chatMismatch') {
      warn(`提问编号跨会话拒绝 ${pending.key}（evidence=chatMismatch，来自 chat ${envelope.chatId ?? '(none)'}）`)
      sendFeedback('请到原会话操作')
      return true
    }
    // CRACK-004 归属闸：exact 已是当事人级命中（SEC-5/6 同 user+chat 校验），直接放行；
    // hint 属广播兜底——仅该渠道绑定的 owner 可代答。identity 缺失/异常一律 fail-closed。
    // 拒绝语义：消费裸编号（不进对话路由）+ 回执提示，问题保持待决，原提问者仍可作答。
    const allowed = pending.evidence === 'exact' || isAuthorizedDeciderQ(identity, envelope.channel, envelope.userId)
    if (!allowed) {
      warn(`提问编号越权拒绝 ${pending.key}（evidence=${pending.evidence}，user ${envelope.userId} 非 owner）`)
      sendFeedback('此提问不是你作答的（无权回答）')
      return true
    }
    const optIdxes = nums.map((num) => num - 1) // 展示 1 基 → 存储 0 基
    const outOfRange = optIdxes.some((idx) => idx < 0 || idx >= max)
    const wrongMultiplicity = row.multiSelect !== true && nums.length !== 1
    if (outOfRange || wrongMultiplicity) {
      const why = wrongMultiplicity
        ? '本题是单选，请只回复一个编号'
        : `编号需在 1-${max} 之间${row.multiSelect === true ? '，多选用逗号分隔（如 1,3）' : ''}`
      sendFeedback(`❓ ${why}\n${numberedHint(row.options, row.multiSelect === true)}`)
      return true // 发错了可以再发：问题保持待决，上面的选项已重发
    }
    const verdict = decideTrusted({
      qKey: pending.key,
      optIdxes,
      via: `${envelope.channel}:reply`,
      userId: envelope.userId,
    })
    if (verdict.ok === true) {
      sendFeedback(`✅ 已作答：${(verdict.answers ?? []).join('、')}`)
      return true
    }
    // 罕见竞态（作答瞬间恰好超时）：回执说明，同样消费避免把裸编号漏进对话路由
    sendFeedback(verdict.message ?? '该提问已回答或已过期')
    return true
  }

  /** CRACK-004：hint 编号兜底代答资格——仅该渠道绑定的 owner 可代答；identity 缺失/异常 fail-closed。 */
  function isAuthorizedDeciderQ(identity, channel, userId) {
    if (!identity) return false
    try { return identity.list(channel).some((r) => String(r.userId) === String(userId) && r.role === 'owner') } catch { return false }
  }

  let disposeMessage = null
  let disposed = false

  /**
   * 挂载编号回复处理器。必须在审批路由注册之后调用（bus.onMessage 插入序 =
   * 消费优先级：审批 '1'/'2' 先于提问编号，避免歧义时提问抢走审批回复）。
   */
  function attach() {
    if (disposeMessage !== null || disposed) return
    disposeMessage = bus.onMessage(handleNumberedReply)
  }

  /**
   * 执行一次远程提问（ask_user 工具核心；多问逐问推送、逐问独立作答）。
   * @param {{ questions: { question: string, options: { label: string }[], multiSelect?: boolean }[],
   *           timeoutMs?: number, context?: string }} payload
   * @returns {Promise<{ ok: boolean, answered: boolean, results: object[], reason?: string }>}
   */
  async function askQuestions(payload, execContext = {}) {
    const questions = Array.isArray(payload?.questions) ? payload.questions : []
    const timeoutMs = Math.max(1000, Number(payload?.timeoutMs) || defaultTimeoutMs)
    if (questions.length === 0) return { ok: false, answered: false, results: [], reason: 'questions 不能为空' }
    const results = []
    let allAnswered = true
    const agentId = execContext?.agent?.id ?? execContext?.agent?.session?.id ?? execContext?.session?.id ?? null
    for (const question of questions) {
      if (disposed) {
        results.push({ question: String(question?.question ?? ''), answered: false, reason: 'stopped' })
        allAnswered = false
        continue
      }
      const qKey = `${KEY_PREFIX}${randomBytes(4).toString('hex')}`
      let outcome = null
      try {
        const token = vault.mint(qKey)
        ledger.add(qKey, {
          question: String(question.question ?? ''),
          options: question.options.map((option) => String(option.label)),
          multiSelect: question.multiSelect === true,
          context: String(payload?.context ?? ''),
          agentId: agentId !== null && String(agentId) !== '' ? String(agentId) : null,
          pushedTo: [],
        })
        // waiter 预注册先于推卡（v0.6.3 审批时序同款：早到作答不被丢）。
        // AUTH-1：wait 登记允许会话范围（allowChats）；pushQuestion 每送达一张卡片即
        // 把它对应的 chatId 并入 allowChats（空目标 = 空 Map，不放行任意 chat）。
        const allowChats = new Map()
        const waitPromise = bus.wait(qKey, timeoutMs, {
          agentId: agentId !== null ? String(agentId) : '',
          onAbandon: () => { try { ledger.terminate(qKey) } catch { } },
          allowChats,
        })
        const { pushedTo, hintChannels, hintTargets, escalationTargets } = await pushQuestion(qKey, token, question, allowChats)
        const row = ledger.get(qKey)
        if (row !== undefined) store.set(qKey, { ...row, pushedTo, hintChannels, hintTargets })
        const startedAt = Date.now()
        escalation.start(qKey, (_key, stage) => {
          const text = `提问仍在等待作答：${String(question.question ?? '').slice(0, 40)}\n${stage.note ?? '仍在等待作答'}（已等待 ${Math.round((Date.now() - startedAt) / 1000)}s）。请点击选项卡片按钮作答；无卡片渠道可回复选项编号。`
          // 升级提醒必须逐目标发送。按 channelTypes 调 notifyAll 仍会覆盖同渠道的
          // 其他 chat/user；没有精确目标时 fail-closed，不向全局渠道广播。
          const sends = Array.isArray(escalationTargets) ? escalationTargets.map(async ({ inbound, target }) => {
            try { await inbound.sendText(target.chatId, text) } catch { /* 单目标失败不影响其他目标 */ }
          }) : []
          Promise.all(sends).catch(() => {})
        })
        outcome = await waitPromise
        escalation.stop(qKey)
        const rowAfterWait = ledger.get(qKey)
        if (rowAfterWait?.decision === 'terminated') {
          await markResolved(rowAfterWait?.pushedTo ?? pushedTo ?? [], '⏹ 已终止：agent 会话已结束，提问取消')
          results.push({ question: String(question.question ?? ''), answered: false, reason: 'terminated' })
          allAnswered = false
          continue
        }
      } catch (error) {
        warn(`提问推送/等待异常（交还桌面语义）: ${error instanceof Error ? error.message : String(error)}`)
        try { escalation.stop(qKey) } catch { /* 清理不致命 */ }
        try { bus.abandon(qKey) } catch { /* 清理不致命 */ }
        try { ledger.resolve(qKey, 'error') } catch { /* 账本失败不致命 */ }
        outcome = { __error: true }
      }
      if (outcome === null) {
        // P2 超时永不代答：唯一产物是 answered=false
        ledger.resolve(qKey, 'timeout')
        await markResolved(ledger.get(qKey)?.pushedTo ?? [], '⏱ 超时未作答：已交还桌面（按钮失效）')
        results.push({ question: String(question.question ?? ''), answered: false })
        allAnswered = false
        continue
      }
      if (outcome.__error === true) {
        results.push({ question: String(question.question ?? ''), answered: false, reason: 'error' })
        allAnswered = false
        continue
      }
      // outcome = bus.wait 的裁决信封 { decision: settle 载荷 {kind:'aq', idxs}, via, userId }
      const row = ledger.get(qKey)
      const idxs = Array.isArray(outcome?.decision?.idxs) ? outcome.decision.idxs : []
      const answers = idxs.map((idx) => row?.options?.[idx]).filter((label) => label !== undefined)
      await markResolved(row?.pushedTo ?? [], `✅ 已作答：${answers.join('、')}（来源 ${outcome?.via ?? 'unknown'}）`)
      results.push({ question: String(question.question ?? ''), answered: true, answers, via: outcome?.via })
    }
    return { ok: true, answered: allAnswered, results }
  }

  function dispose() {
    disposed = true
    try { disposeMessage?.() } catch { /* 反注册失败不致命 */ }
    disposeMessage = null
    escalation.dispose()
  }

  return { askQuestions, decide, decideTrusted, attach, dispose }
}

/** 校验并归一 ask_user 工具参数；违规返回 { ok:false, reason }。 */
export function validateAskArgs(rawArgs, { minTimeoutMs = 30_000, maxTimeoutMs = 30 * 60_000, defaultTimeoutMs = 300_000 } = {}) {
  const args = rawArgs ?? {}
  const questionsRaw = Array.isArray(args.questions) ? args.questions : null
  if (questionsRaw === null || questionsRaw.length === 0 || questionsRaw.length > 4) {
    return { ok: false, reason: 'questions 必须是 1 到 4 个问题的数组' }
  }
  const questions = []
  for (const item of questionsRaw) {
    const question = String(item?.question ?? '').trim()
    if (question === '' || question.length > 600) {
      return { ok: false, reason: '每个问题的 question 必须是 1-600 字符' }
    }
    const optionsRaw = Array.isArray(item?.options) ? item.options : null
    if (optionsRaw === null || optionsRaw.length < 2 || optionsRaw.length > 5) {
      return { ok: false, reason: `问题「${question.slice(0, 20)}」的 options 必须是 2 到 5 项` }
    }
    const options = []
    for (const option of optionsRaw) {
      const label = String(option?.label ?? '').trim()
      if (label === '' || label.length > 60) {
        return { ok: false, reason: `问题「${question.slice(0, 20)}」的选项 label 必须是 1-60 字符` }
      }
      options.push({ label })
    }
    questions.push({ question, options, multiSelect: item?.multiSelect === true })
  }
  const timeoutRaw = Number(args.timeoutMs)
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0
    ? Math.min(maxTimeoutMs, Math.max(minTimeoutMs, Math.trunc(timeoutRaw)))
    : defaultTimeoutMs
  const context = String(args.context ?? '').slice(0, 300)
  return { ok: true, questions, timeoutMs, context }
}

/**
 * 注册 ask_user 工具（v0.8 远程提问）。
 * @param ctx - cordis 上下文（ctx.tools；宿主没有 tools 服务时静默跳过）
 * @param {ReturnType<typeof createQuestionBridge>} bridge
 * @param {{ rateLimitPerMinute?: number, defaultTimeoutMs?: number }} [options]
 */
export function registerAskUserTool(ctx, bridge, options = {}) {
  if (ctx?.tools?.register === undefined) {
    // 宿主没有 tools 服务时静默跳过工具注册，绝不弄崩启动（与 notify 工具同规矩）
    return null
  }
  const limiter = createRateLimiter({ limitPerMinute: options.rateLimitPerMinute ?? 6 })
  return ctx.tools.register({
    name: 'ask_user',
    description: '向用户提出选择题并等待作答（推送到用户手机：飞书选项卡片 / Telegram 按钮 / 其他渠道回复编号）。适合方案抉择、环境选择等需要用户拍板的分叉决策；用户装了 dsh-notifier 手机桥接时优先用本工具而不是 ask_user_question。超时不会代答——用户未作答时返回 answered=false，请改用桌面确认或调整方案继续。',
    parameters: compileParameters({
      questions: {
        type: 'array',
        required: true,
        description: '1-4 个问题，每项 { question: 问题正文, options: [{ label: 选项 }](2-5 项), multiSelect?: 是否多选（默认 false） }',
      },
      timeoutMs: { type: 'number', description: '作答时限毫秒（默认 300000，范围 30s-30min）；超时不代答' },
      context: { type: 'string', description: '为什么问（卡片引言，可选，300 字内）' },
    }),
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          answered: { type: 'boolean' },
          results: { type: 'array', items: { type: 'object' } },
        },
        additionalProperties: true,
      },
      render: (_args, value) => {
        if (value.rateLimited === true) {
          return [{ type: 'text', text: `已限流：ask_user 每分钟调用已达上限（${value.rateLimit ?? ''} 次/分钟）。请稍后再试，或改用一次提问合并多个问题。` }]
        }
        if (value.ok !== true) {
          return [{ type: 'text', text: `提问未发出：${value.reason ?? '参数无效'}。请检查 questions 结构（1-4 问，每问 2-5 个选项）。` }]
        }
        if (value.answered !== true) {
          const lines = (value.results ?? []).map((item, idx) =>
            `${idx + 1}. ${item.question} → ${item.answered === true ? `已答：${(item.answers ?? []).join('、')}` : '未作答'}`)
          return [{ type: 'text', text: `用户未在时限内完成全部作答（超时不代答）：\n${lines.join('\n')}\n请改用桌面确认、缩小问题范围，或基于默认方案继续并说明假设。` }]
        }
        const lines = (value.results ?? []).map((item, idx) =>
          `${idx + 1}. ${item.question} → ${(item.answers ?? []).join('、')}`)
        return [{ type: 'text', text: `用户已作答：\n${lines.join('\n')}` }]
      },
    },
    async execute(rawArgs, execContext) {
      if (!limiter.allow()) {
        return { ok: false, rateLimited: true, rateLimit: limiter.limit, answered: false, results: [] }
      }
      const validated = validateAskArgs(rawArgs, { defaultTimeoutMs: options.defaultTimeoutMs })
      if (!validated.ok) {
        return { ok: false, answered: false, results: [], reason: validated.reason }
      }
      try {
        return await bridge.askQuestions(validated, execContext)
      } catch (error) {
        return { ok: false, answered: false, results: [], reason: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}
