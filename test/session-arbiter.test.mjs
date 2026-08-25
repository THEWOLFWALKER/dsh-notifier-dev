import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSessionPolicy, canAcceptCommand, revokePolicy, chooseCommand, createSessionArbiter } from '../src/control/session-arbiter.mjs'

const policy = (extra = {}) => normalizeSessionPolicy({ sessionId: 's1', channel: 'telegram', accountId: 'a1', userId: 'u1', chatId: 'c1', owner: 'u1', policyVersion: 'p1', ...extra }, 100)
const event = (extra = {}) => ({ eventId: 'e1', sessionId: 's1', channel: 'telegram', accountId: 'a1', userId: 'u1', chatId: 'c1', policyVersion: 'p1', command: 'stop', createdAt: 10, expiresAt: 200, ...extra })

test('personal defaults are safe and group/conversation are off', () => {
  const p = normalizeSessionPolicy({}, 100)
  assert.deepEqual(p.capabilities, { observe: true, approve: true, converse: false, groupChatControl: false })
  assert.equal(p.mode, 'personal')
  assert.equal(canAcceptCommand(p, event()).reason, 'stale_policy')
})

test('policy binding and capability gates are exact', () => {
  const p = policy()
  assert.equal(canAcceptCommand(p, event()).ok, true)
  assert.equal(canAcceptCommand(p, event({ chatId: '' })).reason, 'source_mismatch_chatId')
  assert.equal(canAcceptCommand(p, event({ command: 'steer' })).reason, 'conversation_disabled')
  assert.equal(canAcceptCommand(p, event({ chatType: 'group' })).reason, 'group_chat_disabled')
  assert.equal(canAcceptCommand(p, event({ policyVersion: 'old' })).reason, 'stale_policy')
  for (const key of ['sessionId', 'channel', 'accountId', 'userId', 'chatId']) {
    assert.match(canAcceptCommand(p, event({ [key]: 'wrong' })).reason, new RegExp(`source_mismatch_${key}`))
  }
})

test('team mode permits scoped conversation only when explicitly enabled', () => {
  const p = policy({ mode: 'team', capabilities: { converse: true }, chatId: 'c1' })
  assert.equal(canAcceptCommand(p, event({ command: 'steer' })).ok, true)
  assert.equal(canAcceptCommand(p, event({ command: 'ordinary-message' })).ok, true)
  assert.equal(canAcceptCommand(p, event({ command: 'steer', chatType: 'group' })).reason, 'group_chat_disabled')
})

test('owner-only approval and revoke fail closed', () => {
  const p = policy({ approvalOwnerOnly: true })
  assert.equal(canAcceptCommand(p, event({ command: 'approval', userId: 'u2' })).reason, 'source_mismatch_userId')
  assert.equal(canAcceptCommand(revokePolicy(p, 'manual', 120), event(), 120).reason, 'revoked')
})

test('precedence chooses stop, then question, then approval, steer, ordinary', () => {
  const p = policy({ capabilities: { converse: true, groupChatControl: false } })
  const candidates = ['ordinary-message', 'approval', 'question-answer', 'steer', 'stop'].map((command, i) => ({ event: event({ eventId: `e${i}`, command, createdAt: 10 + i }) }))
  assert.equal(chooseCommand(candidates, { policy: p }).event.command, 'stop')
})

test('arbiter settles once, retries failed settlement, revokes and disposes safely', () => {
  let calls = 0
  const arbiter = createSessionArbiter({ policy: policy(), now: () => 100, onSettle: () => { calls++; return calls > 1 } })
  assert.equal(arbiter.handle(event()).status, 'desktop_fallback')
  assert.equal(arbiter.handle(event({ eventId: 'e2' })).status, 'accepted')
  assert.equal(arbiter.handle(event({ eventId: 'e2' })).status, 'already_handled')
  assert.equal(arbiter.handle(event({ eventId: 'e6' })).status, 'accepted')
  arbiter.revoke('stop')
  assert.equal(arbiter.handle(event({ eventId: 'e4' })).status, 'rejected')
  arbiter.dispose()
  assert.equal(arbiter.handle(event({ eventId: 'e5' })).status, 'desktop_fallback')
})
