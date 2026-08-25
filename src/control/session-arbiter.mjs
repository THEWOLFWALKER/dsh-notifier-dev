// Provider-neutral session policy and command precedence.
// Transport adapters provide normalized events; this module never knows their payloads.

const MODES = new Set(['personal', 'team'])
const COMMANDS = ['stop', 'question-answer', 'approval', 'steer', 'ordinary-message']
const RANK = new Map(COMMANDS.map((command, index) => [command, index]))

const text = (value) => typeof value === 'string' && value.trim() !== '' ? value.trim() : null

export function normalizeSessionPolicy(input = {}, now = Date.now()) {
  const mode = MODES.has(input.mode) ? input.mode : 'personal'
  const capabilities = {
    observe: input.capabilities?.observe !== false,
    approve: input.capabilities?.approve !== false,
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

export function canAcceptCommand(policy, event, now = Date.now()) {
  if (policy === null || typeof policy !== 'object' || event === null || typeof event !== 'object') return { ok: false, reason: 'malformed' }
  if (isPolicyExpired(policy, now)) return { ok: false, reason: policy.revoked ? 'revoked' : 'expired' }
  if (bound(event.policyVersion) !== policy.policyVersion) return { ok: false, reason: 'stale_policy' }
  for (const key of ['sessionId', 'channel', 'accountId', 'userId', 'chatId']) {
    if (bound(event[key]) === null || bound(policy[key]) === null) return { ok: false, reason: `source_mismatch_${key}` }
    if (bound(policy[key]) !== event[key]) return { ok: false, reason: `source_mismatch_${key}` }
  }
  if (!COMMANDS.includes(event.command)) return { ok: false, reason: 'unknown_command' }
  const caps = policy.capabilities ?? {}
  if (event.chatType === 'group' && caps.groupChatControl !== true) return { ok: false, reason: 'group_chat_disabled' }
  if (event.command === 'approval' && caps.approve !== true) return { ok: false, reason: 'approval_disabled' }
  if (event.command === 'question-answer' && caps.approve !== true) return { ok: false, reason: 'approval_disabled' }
  if ((event.command === 'steer' || event.command === 'ordinary-message') && caps.converse !== true) return { ok: false, reason: 'conversation_disabled' }
  if (event.command === 'approval' && policy.approvalOwnerOnly === true && event.userId !== policy.owner) return { ok: false, reason: 'owner_only' }
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
