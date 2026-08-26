import test from 'node:test'
import assert from 'node:assert/strict'
import { createControlEntry } from '../src/control/entry.mjs'
import { createActionDispatcher } from '../src/actions.mjs'
import { createTokenVault } from '../src/inbound/tokens.mjs'

const pending = (channel, chatId, extra = {}) => ({
  status: 'pending', sessionId: 'session-1', agentId: 'session-1', channel, chatId,
  userId: 'user-1', accountId: channel, policyVersion: '1', createdAt: 100,
  expiresAt: 1000, pushedTo: [{ channel, chatId, userId: 'user-1' }], ...extra,
})

function makeControl(rows, settled, options = {}) {
  const control = createControlEntry({ now: () => 150, ...options })
  control.register('approval', {
    getPending: (input) => rows.get(input.approvalKey),
    buildEvent: (input, row) => ({
      eventId: input.eventId,
      sessionId: row.sessionId,
      source: 'mobile',
      channel: row.channel,
      accountId: row.accountId,
      userId: row.userId,
      chatId: input.chatId,
      policyVersion: row.policyVersion,
      command: 'approval',
      chatType: input.chatType,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    }),
    settle: (input) => { settled.push({ channel: input.channel, key: input.approvalKey }); return true },
  })
  return control
}

test('Control Core runtime entry is shared by Telegram and Feishu callback envelopes', () => {
  const rows = new Map([
    ['ap:tg', pending('telegram', 'tg-chat')],
    ['ap:fs', pending('feishu', 'fs-chat')],
  ])
  const settled = []
  const control = makeControl(rows, settled)
  assert.equal(control.handle({ eventId: 'tg-1', command: 'approval', approvalKey: 'ap:tg', channel: 'telegram', chatId: 'tg-chat', userId: 'user-1' }).status, 'accepted')
  assert.equal(control.handle({ eventId: 'fs-1', command: 'approval', approvalKey: 'ap:fs', channel: 'feishu', chatId: 'fs-chat', userId: 'user-1' }).status, 'accepted')
  assert.deepEqual(settled, [{ channel: 'telegram', key: 'ap:tg' }, { channel: 'feishu', key: 'ap:fs' }])
})

test('Control Core rejects old/replayed callback, wrong chat, expired policy, and groups', () => {
  const rows = new Map([['ap:tg', pending('telegram', 'tg-chat')]])
  const settled = []
  const control = makeControl(rows, settled, { policy: { expiresAt: 500 } })
  const base = { eventId: 'same', command: 'approval', approvalKey: 'ap:tg', channel: 'telegram', chatId: 'tg-chat', userId: 'user-1' }
  assert.equal(control.handle(base).status, 'accepted')
  assert.equal(control.handle(base).status, 'already_handled')
  const wrongChat = makeControl(rows, settled)
  assert.equal(wrongChat.handle({ ...base, eventId: 'wrong-chat', chatId: 'other' }).status, 'rejected')
  const expired = makeControl(rows, settled, { policy: { expiresAt: 120 } })
  assert.equal(expired.handle({ ...base, eventId: 'expired' }).reason, 'expired')
  const group = makeControl(rows, settled)
  assert.equal(group.handle({ ...base, eventId: 'group', chatType: 'group' }).reason, 'group_chat_disabled')
})

test('personal default keeps converse disabled while private stop remains available', () => {
  const control = createControlEntry({ now: () => 150 })
  const pendingRow = pending('telegram', 'tg-chat')
  let calls = 0
  const ordinary = control.handle({
    eventId: 'ordinary', command: 'ordinary-message', channel: 'telegram', accountId: 'telegram',
    userId: 'user-1', chatId: 'tg-chat', sessionId: 'session-1', policyVersion: '1',
    pending: pendingRow, settle: () => { calls++; return true },
  })
  assert.equal(ordinary.reason, 'conversation_disabled')
  assert.equal(calls, 0)
  const stop = control.handle({
    eventId: 'stop', command: 'stop', channel: 'telegram', accountId: 'telegram',
    userId: 'user-1', chatId: 'tg-chat', sessionId: 'session-1', policyVersion: '1',
    pending: pendingRow, settle: () => { calls++; return true },
  })
  assert.equal(stop.status, 'accepted')
  assert.equal(calls, 1)
})

test('QQ group and unknown-source controls fail closed for every command, while legacy C2C remains private', () => {
  const control = createControlEntry({
    policy: { mode: 'team', capabilities: { converse: true, groupChatControl: true } },
    now: () => 150,
  })
  const pendingRow = pending('qq', 'g-open', { accountId: 'QQ_APP', userId: 'u1' })
  const calls = []
  const base = {
    channel: 'qq', accountId: 'QQ_APP', userId: 'u1', chatId: 'g-open', sessionId: 'session-1', policyVersion: '1',
    pending: pendingRow, settle: () => { calls.push('settled'); return true },
  }
  for (const command of ['stop', 'approval', 'question-answer', 'steer', 'ordinary-message']) {
    const result = control.handle({ ...base, command, eventId: `group-${command}`, chatType: 'group' })
    assert.equal(result.status, 'rejected')
    assert.equal(result.reason, 'group_chat_disabled')
  }
  const unknown = control.handle({ ...base, command: 'stop', eventId: 'unknown', chatType: undefined })
  assert.equal(unknown.status, 'rejected')
  assert.equal(unknown.reason, 'source_chat_type_unknown')
  assert.equal(calls.length, 0)

  const legacyC2c = control.handle({
    ...base, command: 'stop', eventId: 'legacy-c2c', userId: 'u1', chatId: 'u1', chatType: undefined,
    pending: pending('qq', 'u1', { accountId: 'QQ_APP', userId: 'u1' }),
  })
  assert.equal(legacyC2c.status, 'accepted')
  assert.equal(calls.length, 1)
})

test('action callbacks from Telegram and Feishu settle through the shared entry', () => {
  const rows = new Map()
  const store = {
    get: (key) => rows.get(key),
    set: (key, value) => { rows.set(key, value) },
  }
  const dispatcher = createActionDispatcher({
    store,
    vault: createTokenVault({ secret: 'control-entry-actions' }),
    control: createControlEntry(),
  })
  const calls = []
  dispatcher.register('turn/cancel', ({ via }) => {
    calls.push(via)
    return { ok: true, message: '✅ 已停止任务' }
  })
  const telegram = dispatcher.mintAction('turn/cancel', {}, { channel: 'telegram', chatId: 'tg-chat' })
  const feishu = dispatcher.mintAction('turn/cancel', {}, { channel: 'feishu', chatId: 'fs-chat' })
  assert.equal(dispatcher.dispatch({ actionKey: telegram.key, token: telegram.token, via: 'telegram:action', userId: 7, chatId:  'tg-chat' }).message, '✅ 已停止任务')
  assert.equal(dispatcher.dispatch({ actionKey: feishu.key, token: feishu.token, via: 'feishu:action', userId: 7, chatId: 'fs-chat' }).message, '✅ 已停止任务')
  assert.deepEqual(calls, ['telegram:action', 'feishu:action'])
})

function makeTeamControl(approvalMembers, owner, settled) {
  const control = createControlEntry({
    policy: { mode: 'team', owner, approvalMembers, capabilities: { approve: true } },
    now: () => 150,
  })
  control.register('approval', {
    getPending: (input) => ({
      status: 'pending', sessionId: 'session-1', agentId: 'session-1', channel: 'telegram', chatId: 'tg-chat',
      userId: input.userId, accountId: 'telegram', policyVersion: '1', createdAt: 100, expiresAt: 1000,
      pushedTo: [{ channel: 'telegram', chatId: 'tg-chat', userId: input.userId }],
    }),
    buildEvent: (input, row) => ({
      eventId: input.eventId, sessionId: row.sessionId, source: 'mobile', channel: row.channel,
      accountId: input.accountId, userId: input.userId, chatId: input.chatId ?? row.chatId, policyVersion: row.policyVersion,
      command: 'approval', chatType: input.chatType, createdAt: row.createdAt, expiresAt: row.expiresAt,
    }),
    settle: (input, pending, event, policy) => { settled.push({ userId: input.userId, policyOwner: policy.owner }); return true },
  })
  return control
}

test('team approvalMembers authorize only listed members and the owner through the shared Core entry', () => {
  const settled = []
  const control = makeTeamControl([{ channel: 'telegram', accountId: 'telegram', userId: 'member-2' }], 'owner-1', settled)
  const base = { command: 'approval', approvalKey: 'ap:team', channel: 'telegram', accountId: 'telegram', chatId: 'tg-chat', userId: 'member-2' }
  // listed member settles; the settle callback receives the normalized policy snapshot (owner is set)
  assert.equal(control.handle({ ...base, eventId: 'm' }).status, 'accepted')
  assert.equal(settled[0].userId, 'member-2')
  assert.equal(settled[0].policyOwner, 'owner-1')
  // owner settles even though not listed, and membership never gets orphaned from a duplicate id
  const ownerHandle = control.handle({ ...base, eventId: 'o', userId: 'owner-1' })
  assert.equal(ownerHandle.status, 'accepted')
  assert.equal(settled.length, 2)
  // non-member and wrong account are rejected with zero settlement (wrong account is
  // caught by the pending-row binding layer first; both fail closed)
  assert.equal(control.handle({ ...base, eventId: 'x', userId: 'intruder' }).reason, 'member_not_allowed')
  assert.equal(control.handle({ ...base, eventId: 'y', accountId: 'other' }).status, 'rejected')
  assert.equal(settled.length, 2)
})

test('team member authorization stays fail-closed on wrong chat and group chat, zero settlement', () => {
  const settled = []
  const control = makeTeamControl([{ channel: 'telegram', accountId: 'telegram', userId: 'member-2' }], 'owner-1', settled)
  const base = { command: 'approval', approvalKey: 'ap:team', channel: 'telegram', accountId: 'telegram', userId: 'member-2' }
  // conversation binding is exact even for approved team members
  assert.equal(control.handle({ ...base, eventId: 'wc', chatId: 'other' }).reason, 'source_mismatch_chatId')
  // QQ-style group control stays fail-closed
  assert.equal(control.handle({ ...base, eventId: 'gr', chatType: 'group' }).reason, 'group_chat_disabled')
  assert.equal(settled.length, 0)
})
