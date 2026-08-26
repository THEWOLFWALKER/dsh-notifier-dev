// Provider-neutral session policy and command precedence.
// Transport adapters provide normalized events; this module never knows their payloads.

const MODES = new Set(['personal', 'team'])
const COMMANDS = ['stop', 'question-answer', 'approval', 'steer', 'ordinary-message']
const RANK = new Map(COMMANDS.map((command, index) => [command, index]))

const text = (value) => typeof value === 'string' && value.trim() !== '' ? value.trim() : null

// Bounded optional team-approval member list: never wildcard/global/empty,
// never an unbounded array, never arbitrary nested shapes.
const MAX_APPROVAL_MEMBERS = 64
const GLOBAL_IDS = new Set(['*', 'all', 'everyone', 'anyone'])
const looksGlobal = (value) => value.includes('*') || GLOBAL_IDS.has(String(value).toLowerCase())

function normalizeApprovalMembers(input) {
  if (!Array.isArray(input)) return Object.freeze([])
  const seen = new Set()
  const members = []
  for (const raw of input) {
    if (members.length >= MAX_APPROVAL_MEMBERS) break
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
    const channel = text(raw.channel)
    const accountId = text(raw.accountId)
    const userId = text(raw.userId)
    if (channel === null || accountId === null || userId === null) continue
    if (looksGlobal(channel) || looksGlobal(accountId) || looksGlobal(userId)) continue
    const key = `${channel}\u0000${accountId}\u0000${userId}`
    if (seen.has(key)) continue
    seen.add(key)
    members.push(Object.freeze({ channel, accountId, userId }))
  }
  return Object.freeze(members)
}

export function normalizeSessionPolicy(input = {}, now = Date.now()) {
  const mode = MODES.has(input.mode) ? input.mode : 'personal'
  const capabilities = {
    observe: input.capabilities?.observe !== false,
    approve: input.capabilities?.approve !== false,
    stop: input.capabilities?.stop !== false,
    converse: input.capabilities?.converse === true,
    groupChatControl: input.capabilities?.groupChatControl === true,
  }
  if (mode === 'personal') capabilities.groupChatControl = false
  const policyVersion = text(input.policyVersion) ?? '1'
  const expiresAt = input.expiresAt === undefined || input.expiresAt === null ? null : Number(input.expiresAt)
  return Object.freeze({
    mode,
    capabilities: Object.freeze(capabilities),
    policyVersion,
    owner: text(input.owner),
    sessionId: text(input.sessionId),
    channel: text(input.channel),
    accountId: text(input.accountId),
    userId: text(input.userId),
    chatId: text(input.chatId),
    approvalOwnerOnly: input.approvalOwnerOnly === true,
    approvalMembers: normalizeApprovalMembers(input.approvalMembers),
    revoked: input.revoked === true,
    revokedAt: Number.isFinite(Number(input.revokedAt)) ? Number(input.revokedAt) : null,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
    createdAt: Number.isFinite(Number(input.createdAt)) ? Number(input.createdAt) : now,
  })
}

export function isPolicyExpired(policy, now = Date.now()) {
  return policy?.revoked === true || (Number.isFinite(policy?.expiresAt) && policy.expiresAt <= now)
}

export function revokePolicy(policy, reason = 'revoked', now = Date.now()) {
  const current = normalizeSessionPolicy(policy, now)
  return Object.freeze({ ...current, revoked: true, revokedAt: now, revokeReason: text(reason) ?? 'revoked' })
}

function bound(value) {
  return text(value)
}

/** Classify provider-neutral chat scope, keeping QQ legacy compatibility narrow. */
export function chatScopeOf(event) {
  const type = String(event?.chatType ?? '').trim().toLowerCase()
  if (String(event?.channel ?? '').trim().toLowerCase() === 'qq') {
    if (type === 'group' || type === 'supergroup' || type === '2' || type === 'chat') return 'group'
    if (type === 'private' || type === 'p2p' || type === '1') return 'private'
    // Pre-chatType C2C envelopes are safe to retain only when the provider
    // shape itself proves a one-to-one user/chat binding. A group_openid
    // cannot pass this compatibility path because it differs from userId.
    if (type === '' && bound(event?.chatId) !== null && bound(event?.userId) !== null && bound(event.chatId) === bound(event.userId)) return 'private'
    return 'unknown'
  }
  if (type === 'group' || type === 'supergroup' || type === '2' || type === 'chat') return 'group'
  return 'private'
}

function isGroupChat(event) {
  if (chatScopeOf(event) === 'group') return true
  const chatId = String(event?.chatId ?? '')
  // Provider-neutral shape guards: these are only a deny-side hint. A provider
  // with an unknown shape remains subject to its explicit chatType metadata.
  return chatId.startsWith('oc_') || chatId.startsWith('group_') || chatId.startsWith('grp_')
}

/**
 * Decide whether a normalized event may settle approval/question-answer under the
 * policy object (which must already be a normalized snapshot). Pure; exported for
 * tests. Returns true when no explicit member/owner restriction applies — the caller
 * still enforces the exact per-person source binding for personal / team-without-list.
 */
export function canSettleApproval(policy, event) {
  if (policy == null || event == null) return false
  if (policy.approvalOwnerOnly === true) {
    return policy.owner != null && String(event.userId) === String(policy.owner)
  }
  const members = Array.isArray(policy.approvalMembers) ? policy.approvalMembers : []
  if (policy.mode === 'team' && members.length > 0) {
    if (policy.owner != null && String(event.userId) === String(policy.owner)) return true
    return members.some((m) => m.channel === event.channel && m.accountId === event.accountId && m.userId === event.userId)
  }
  return true
}

export function canAcceptCommand(policy, event, now = Date.now()) {
  if (policy === null || typeof policy !== 'object' || event === null || typeof event !== 'object') return { ok: false, reason: 'malformed' }
  if (isPolicyExpired(policy, now)) return { ok: false, reason: policy.revoked ? 'revoked' : 'expired' }
  if (bound(event.policyVersion) !== policy.policyVersion) return { ok: false, reason: 'stale_policy' }
  // Conversation-level binding (session/chat) is always exact for every command.
  // Person binding is separated below so only explicit team approval membership can
  // relax the exact-user rule, and only for approve/question-answer.
  for (const key of ['sessionId', 'chatId']) {
    if (bound(event[key]) === null || bound(policy[key]) === null) return { ok: false, reason: `source_mismatch_${key}` }
    if (bound(policy[key]) !== event[key]) return { ok: false, reason: `source_mismatch_${key}` }
  }
  if (!COMMANDS.includes(event.command)) return { ok: false, reason: 'unknown_command' }
  const chatScope = chatScopeOf(event)
  if (String(event.channel ?? '').toLowerCase() === 'qq' && chatScope === 'unknown') {
    return { ok: false, reason: 'source_chat_type_unknown' }
  }
  const caps = policy.capabilities ?? {}
  // QQ group control is intentionally never enabled by policy. Group
  // notifications remain valid, while callbacks/text are receipt-only.
  if (String(event.channel ?? '').toLowerCase() === 'qq' && chatScope === 'group') {
    return { ok: false, reason: 'group_chat_disabled' }
  }
  if (isGroupChat(event) && caps.groupChatControl !== true) return { ok: false, reason: 'group_chat_disabled' }
  if (event.command === 'stop' && caps.stop !== true) return { ok: false, reason: 'stop_disabled' }
  if (event.command === 'approval' && caps.approve !== true) return { ok: false, reason: 'approval_disabled' }
  if (event.command === 'question-answer' && caps.approve !== true) return { ok: false, reason: 'approval_disabled' }
  if ((event.command === 'steer' || event.command === 'ordinary-message') && caps.converse !== true) return { ok: false, reason: 'conversation_disabled' }
  // Person binding. Approve/question-answer may authorize an explicit team member
  // (or the owner); every other command keeps the exact per-person source binding.
  const authorizing = event.command === 'approval' || event.command === 'question-answer'
  const members = Array.isArray(policy.approvalMembers) ? policy.approvalMembers : []
  const memberScope = authorizing && policy.mode === 'team' && members.length > 0
  if (authorizing && (policy.approvalOwnerOnly === true || memberScope)) {
    if (bound(event.channel) === null || bound(event.accountId) === null) return { ok: false, reason: 'source_mismatch_channel' }
    if (!canSettleApproval(policy, event)) {
      return { ok: false, reason: policy.approvalOwnerOnly === true ? 'owner_only' : 'member_not_allowed' }
    }
  } else {
    for (const key of ['channel', 'accountId', 'userId']) {
      if (bound(event[key]) === null || bound(policy[key]) === null) return { ok: false, reason: `source_mismatch_${key}` }
      if (bound(policy[key]) !== event[key]) return { ok: false, reason: `source_mismatch_${key}` }
    }
  }
  return { ok: true }
}

export function chooseCommand(candidates, context = {}) {
  if (!Array.isArray(candidates)) return { status: 'rejected', reason: 'malformed' }
  const clock = typeof context.now === 'function' ? context.now : Date.now
  const valid = candidates.filter((candidate) => canAcceptCommand(context.policy, candidate.event, clock()).ok)
  if (valid.length === 0) return { status: 'rejected', reason: 'no_valid_command' }
  valid.sort((a, b) => (RANK.get(a.event.command) ?? 99) - (RANK.get(b.event.command) ?? 99) || Number(a.event.createdAt) - Number(b.event.createdAt))
  const winner = valid[0]
  if (context.settled?.has?.(winner.event.eventId)) return { status: 'already_handled', event: winner.event }
  context.settled?.add?.(winner.event.eventId)
  return { status: 'accepted', event: winner.event, candidate: winner }
}

export function createSessionArbiter({ policy = {}, now = Date.now, onSettle = null, onAudit = null } = {}) {
  let current = normalizeSessionPolicy(policy, now())
  const settled = new Set()
  let disposed = false
  const audit = (entry) => {
    try { onAudit?.({ eventId: text(entry.event?.eventId), sessionId: text(entry.event?.sessionId), command: text(entry.event?.command), status: entry.status, reason: text(entry.reason), at: now() }) } catch { /* audit never changes control flow */ }
  }
  return {
    policy() { return current },
    revoke(reason) { current = revokePolicy(current, reason, now()); return current },
    dispose() { disposed = true; settled.clear() },
    handle(event) {
      if (disposed) return { status: 'desktop_fallback', reason: 'disposed' }
      const check = canAcceptCommand(current, event, now())
      if (!check.ok) { audit({ event, status: 'rejected', reason: check.reason }); return { status: 'rejected', reason: check.reason } }
      if (settled.has(event.eventId)) return { status: 'already_handled', event }
      settled.add(event.eventId)
      try {
        const result = onSettle?.(event, current)
        if (result === false) { settled.delete(event.eventId); audit({ event, status: 'desktop_fallback', reason: 'settlement_failed' }); return { status: 'desktop_fallback', reason: 'settlement_failed' } }
        audit({ event, status: 'accepted' })
        return { status: 'accepted', event }
      } catch {
        settled.delete(event.eventId)
        audit({ event, status: 'desktop_fallback', reason: 'settlement_failed' })
        return { status: 'desktop_fallback', reason: 'settlement_failed' }
      }
    },
  }
}
