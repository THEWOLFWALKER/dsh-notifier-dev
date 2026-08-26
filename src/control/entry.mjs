// Provider-neutral control ingress.
// Adapters hand this module a small callback envelope; this module is the only
// runtime path that may turn it into a control settlement:
// canonicalize -> normalize -> paired/source/policy check -> settle.

import { normalizeControlEvent, makeReceipt } from './contract.mjs'
import { createSessionArbiter, normalizeSessionPolicy } from './session-arbiter.mjs'

const text = (value) => typeof value === 'string' && value.trim() !== '' ? value.trim() : null
const COMMANDS = new Set(['stop', 'question-answer', 'approval', 'steer', 'ordinary-message'])
const DEFAULT_TTL_MS = 10 * 60 * 1000

function eventIdOf(input, command, key, now) {
  const explicit = text(input.eventId)
  if (explicit !== null) return explicit
  return [command, key, input.channel, input.userId, input.chatId, now].map((part) => String(part ?? '')).join(':')
}

function pendingMeta(input, pending, policy, now) {
  const row = pending !== null && typeof pending === 'object' ? pending : {}
  const meta = row.control ?? row.controlMeta ?? {}
  const command = input.command
  const key = text(input.key) ?? text(input.actionKey) ?? text(input.qKey) ?? text(input.approvalKey) ?? 'control'
  const createdAt = Number.isFinite(Number(meta.createdAt)) ? Number(meta.createdAt)
    : (Number.isFinite(Number(row.createdAt)) ? Number(row.createdAt) : now - 1)
  const expiresAt = Number.isFinite(Number(meta.expiresAt)) ? Number(meta.expiresAt)
    : (Number.isFinite(Number(row.expiresAt)) ? Number(row.expiresAt) : createdAt + DEFAULT_TTL_MS)
  const channel = text(input.channel) ?? text(meta.channel) ?? 'unknown'
  const chatId = text(input.chatId) ?? text(meta.chatId)
  const userId = text(input.userId) ?? text(meta.userId)
  const sessionId = text(input.sessionId) ?? text(meta.sessionId) ?? text(row.sessionId) ?? text(row.agentId) ?? key
  const accountId = text(input.accountId) ?? text(meta.accountId) ?? text(row.accountId) ?? channel
  const policyVersion = text(input.policyVersion) ?? text(meta.policyVersion) ?? text(row.policyVersion) ?? text(policy.policyVersion) ?? '1'
  return {
    eventId: eventIdOf(input, command, key, now),
    sessionId,
    source: text(input.source) ?? 'mobile',
    channel,
    accountId,
    userId,
    chatId,
    policyVersion,
    command,
    chatType: text(input.chatType) ?? text(meta.chatType) ?? text(row.chatType) ?? undefined,
    createdAt,
    expiresAt,
  }
}

function paired(identity, event) {
  if (identity === null || identity === undefined) return true
  try {
    return identity.list(event.channel).some((entry) => String(entry.userId) === String(event.userId))
  } catch {
    return false
  }
}

/**
 * Create the single control ingress used by all interactive paths.
 * `register()` is deliberately small so legacy routers can retain their
 * existing ledgers and handlers while routing the final decision through here.
 */
export function createControlEntry({ policy = {}, identity = null, now = Date.now, logger = null, onAudit = null } = {}) {
  const basePolicy = normalizeSessionPolicy(policy, now())
  const handlers = new Map()
  const handled = new Set()
  let disposed = false
  const warn = (message) => {
    try { logger?.warn?.('[dsh-notifier/control]', message) } catch { /* diagnostics never alter control flow */ }
  }
  const audit = (entry) => {
    try { onAudit?.(entry) } catch { /* audit is strictly out of band */ }
  }

  const register = (command, spec) => {
    if (!COMMANDS.has(command) || spec === null || typeof spec !== 'object') return false
    if (typeof spec.getPending !== 'function' || typeof spec.settle !== 'function') return false
    handlers.set(command, spec)
    return true
  }

  const handle = (input = {}) => {
    if (disposed) return makeReceipt('desktop_fallback', input, 'disposed')
    const command = text(input.command)
    if (!COMMANDS.has(command)) return makeReceipt('rejected', input, 'unknown_command')
    const spec = handlers.get(command)
    const directSettle = typeof input.settle === 'function' ? input.settle : null
    const directPending = input.pending
    let pending = directPending
    try {
      if (pending === undefined) pending = spec?.getPending(input)
    } catch (error) {
      audit({ status: 'lookup_failed', command, error })
      return makeReceipt('desktop_fallback', input, 'lookup_failed')
    }
    if (pending === null || pending === undefined || typeof pending !== 'object') {
      return makeReceipt('rejected', input, 'not_pending')
    }
    let candidate
    try {
      candidate = typeof spec?.buildEvent === 'function'
        ? spec.buildEvent(input, pending, basePolicy, now())
        : pendingMeta(input, pending, basePolicy, now())
    } catch (error) {
      audit({ status: 'normalize_failed', command, error })
      return makeReceipt('rejected', input, 'malformed')
    }
    const normalized = normalizeControlEvent(candidate, now())
    if (!normalized.ok) return makeReceipt(normalized.reason === 'expired' ? 'expired' : 'rejected', candidate, normalized.reason)
    const event = normalized.event
    if (handled.has(event.eventId)) return makeReceipt('already_handled', event, 'duplicate_event')
    if (!paired(identity, event)) return makeReceipt('rejected', event, 'not_paired')
    try {
      // Pending rows are the source-of-truth binding. A callback may not
      // rewrite its chat/channel/user in the adapter envelope to manufacture
      // a fresh policy that matches the wrong conversation.
      for (const key of ['channel', 'accountId', 'chatId']) {
        if (text(pending[key]) !== null && pending[key] !== event[key]) {
          return makeReceipt('rejected', event, `source_mismatch_${key}`)
        }
      }
      if (text(pending.userId) !== null && pending.userId !== event.userId && input.trusted !== true) {
        return makeReceipt('rejected', event, 'source_mismatch_userId')
      }
      if (typeof spec?.authorize === 'function' && spec.authorize(input, pending, event) !== true) {
        return makeReceipt('rejected', event, 'source_policy_rejected')
      }
      const rowMeta = pending.control ?? pending.controlMeta ?? {}
      const mergedPolicy = normalizeSessionPolicy({
        ...basePolicy,
        ...rowMeta,
        mode: rowMeta.mode ?? basePolicy.mode,
        capabilities: { ...basePolicy.capabilities, ...(rowMeta.capabilities ?? {}) },
        sessionId: event.sessionId,
        channel: event.channel,
        accountId: event.accountId,
        userId: event.userId,
        chatId: event.chatId,
        policyVersion: event.policyVersion,
        expiresAt: Math.min(
          basePolicy.expiresAt !== null && Number.isFinite(Number(basePolicy.expiresAt)) ? Number(basePolicy.expiresAt) : Infinity,
          event.expiresAt !== null && Number.isFinite(Number(event.expiresAt)) ? Number(event.expiresAt) : Infinity,
        ),
        owner: rowMeta.owner ?? basePolicy.owner ?? event.userId,
      }, now())
      const arbiter = createSessionArbiter({
        policy: mergedPolicy,
        now,
        onAudit: (entry) => audit(entry),
        onSettle: () => (directSettle ?? spec?.settle)(input, pending, event),
      })
      const verdict = arbiter.handle(event)
      if (verdict.status === 'accepted') {
        handled.add(event.eventId)
        return makeReceipt('accepted', event)
      }
      if (verdict.status === 'already_handled') return makeReceipt('already_handled', event, 'duplicate_event')
      return makeReceipt(verdict.status === 'desktop_fallback' ? 'desktop_fallback' : 'rejected', event, verdict.reason)
    } catch (error) {
      warn(`control settle 异常: ${error instanceof Error ? error.message : String(error)}`)
      audit({ status: 'settlement_failed', event, error })
      return makeReceipt('desktop_fallback', event, 'settlement_failed')
    }
  }

  return {
    register,
    handle,
    dispose() { disposed = true; handlers.clear(); handled.clear() },
    commands: Object.freeze([...COMMANDS]),
  }
}

export { pendingMeta }
