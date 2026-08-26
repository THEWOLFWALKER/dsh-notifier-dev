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
  // the owner id from the wrong account is not the true source: fails closed, no settlement
  assert.equal(control.handle({ ...base, eventId: 'oa', accountId: 'other', userId: 'owner-1' }).status, 'rejected')
  assert.equal(settled.length, 2)
})

// The 2026 team-policy repaired source binding: even when a pending row omits
// account/channel metadata (legacy rows), an owner-only / team owner event must
// never manufacture the policy conversation source from the event envelope.
function runOwnerControl(policy, row, event, command = 'approval') {
  let settled = 0
  let seenPolicy = null
  const control = createControlEntry({ policy, now: () => 150 })
  const result = control.handle({
    command, pending: row, eventId: event.eventId, ...event,
    settle: (input, pendingRow, ev, policySnapshot) => { settled++; seenPolicy = policySnapshot; return true },
  })
  return { result, settled, seenPolicy }
}

test('owner source binding fails closed when pending omits accountId (wrong account can never manufacture the source)', () => {
  const policy = { mode: 'team', owner: 'owner-1', channel: 'telegram', accountId: 'tg-app', approvalOwnerOnly: true, capabilities: { approve: true } }
  // Legacy pending row carries no explicit accountId; the owner callback then claims a different account.
  const row = { sessionId: 'session-1', channel: 'telegram', chatId: 'tg-chat', userId: 'owner-1', createdAt: 100, expiresAt: 1000 }
  const hit = runOwnerControl(policy, row, { channel: 'telegram', accountId: 'other', userId: 'owner-1', chatId: 'tg-chat', sessionId: 'session-1', policyVersion: '1', chatType: 'private' })
  assert.equal(hit.result.status, 'rejected')
  assert.equal(hit.result.reason, 'source_mismatch_accountId')
  assert.equal(hit.settled, 0, 'a wrong-account owner callback must never settle')
  // correctness guard: the snapshot the arbiter would authorize against carries the true original account source
  const legit = runOwnerControl(policy, { ...row, accountId: 'tg-app' }, { channel: 'telegram', accountId: 'tg-app', userId: 'owner-1', chatId: 'tg-chat', sessionId: 'session-1', policyVersion: '1', chatType: 'private' })
  assert.equal(legit.result.status, 'accepted')
  assert.equal(legit.settled, 1)
  assert.equal(legit.seenPolicy.accountId, 'tg-app')
  assert.equal(legit.seenPolicy.owner, 'owner-1')
})

test('owner from wrong QQ channel (private chatType) fails closed when pending omits channel/accountId', () => {
  const policy = { mode: 'team', owner: 'u1', channel: 'qq', accountId: 'QQ_APP', approvalOwnerOnly: true, capabilities: { approve: true } }
  // Pending row omits both channel and accountId (only session/chat/user), so only the QQ-bot source id is authoritative.
  const row = { sessionId: 'session-1', chatId: 'u1', userId: 'u1', createdAt: 100, expiresAt: 1000 }
  const wrongSource = runOwnerControl(policy, row, { channel: 'qq', accountId: 'OTHER_APP', userId: 'u1', chatId: 'u1', sessionId: 'session-1', policyVersion: '1', chatType: 'private' })
  assert.equal(wrongSource.result.status, 'rejected')
  assert.equal(wrongSource.result.reason, 'source_mismatch_accountId')
  assert.equal(wrongSource.settled, 0)
  // the authoritative QQ-bot account still settles
  const correct = runOwnerControl(policy, row, { channel: 'qq', accountId: 'QQ_APP', userId: 'u1', chatId: 'u1', sessionId: 'session-1', policyVersion: '1', chatType: 'private' })
  assert.equal(correct.result.status, 'accepted')
  assert.equal(correct.settled, 1)
})

test('owner-only authorization fails closed when no source metadata exists at all (legacy with no bindable source)', () => {
  // No channel/accountId anywhere (neither policy nor pending row): owner-only cannot
  // prove the event is the true owner source, so it must deny rather than trust the event.
  const policy = { mode: 'team', owner: 'owner-1', approvalOwnerOnly: true, capabilities: { approve: true } }
  const row = { sessionId: 'session-1', chatId: 'tg-chat', userId: 'owner-1', createdAt: 100, expiresAt: 1000 }
  const hit = runOwnerControl(policy, row, { channel: 'telegram', accountId: 'tg-app', userId: 'owner-1', chatId: 'tg-chat', sessionId: 'session-1', policyVersion: '1', chatType: 'private' })
  assert.equal(hit.result.status, 'rejected')
  assert.equal(hit.result.reason, 'source_mismatch_channel')
  assert.equal(hit.settled, 0)
})

test('owner authorization rejects conflicting base, pending, and nested control metadata sources', () => {
  const policy = { mode: 'team', owner: 'owner-1', channel: 'telegram', accountId: 'tg-app', approvalOwnerOnly: true, capabilities: { approve: true } }
  const baseRow = { sessionId: 'session-1', chatId: 'tg-chat', userId: 'owner-1', createdAt: 100, expiresAt: 1000 }
  const event = { channel: 'feishu', accountId: 'fs-app', userId: 'owner-1', chatId: 'tg-chat', sessionId: 'session-1', policyVersion: '1', chatType: 'private' }
  for (const row of [
    { ...baseRow, channel: 'feishu', accountId: 'fs-app' },
    { ...baseRow, control: { channel: 'feishu', accountId: 'fs-app' } },
    { ...baseRow, controlMeta: { channel: 'feishu', accountId: 'fs-app' } },
    { ...baseRow, control: { channel: 'telegram', accountId: 'tg-app' }, controlMeta: { channel: 'feishu', accountId: 'fs-app' } },
  ]) {
    const hit = runOwnerControl(policy, row, event)
    assert.equal(hit.result.status, 'rejected')
    assert.match(hit.result.reason, /^source_mismatch_(channel|accountId)$/)
    assert.equal(hit.settled, 0)
  }
  const aligned = runOwnerControl(policy, { ...baseRow, controlMeta: { channel: 'telegram', accountId: 'tg-app' } }, {
    ...event, channel: 'telegram', accountId: 'tg-app',
  })
  assert.equal(aligned.result.status, 'accepted')
  assert.equal(aligned.settled, 1)
  const question = runOwnerControl(policy, { ...baseRow, controlMeta: { channel: 'telegram', accountId: 'tg-app' } }, {
    ...event, eventId: 'question-answer', channel: 'feishu', accountId: 'fs-app',
  }, 'question-answer')
  assert.equal(question.result.status, 'rejected')
  assert.equal(question.result.reason, 'source_mismatch_channel')
  assert.equal(question.settled, 0)
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

function overlayPending(userId = 'member-1', extra = {}) {
  return {
    status: 'pending', sessionId: 'session-overlay', agentId: 'session-overlay',
    channel: 'telegram', accountId: 'tg-app', chatId: 'tg-chat', userId,
    policyVersion: '1', createdAt: 100, expiresAt: 1000, ...extra,
  }
}

function runOverlayApproval({ overlay, pendingRow = overlayPending(), policy = {}, input = {}, resolver = null } = {}) {
  const settled = []
  const options = { now: () => 150, policy: { capabilities: { approve: true }, ...policy } }
  if (resolver !== null) options.policyForSession = resolver
  else if (overlay !== undefined) options.sessionPolicy = () => overlay
  const control = createControlEntry(options)
  const result = control.handle({
    eventId: 'overlay-event', command: 'approval', approvalKey: 'overlay-key',
    channel: 'telegram', accountId: 'tg-app', chatId: 'tg-chat', userId: pendingRow.userId,
    sessionId: pendingRow.sessionId, policyVersion: '1', chatType: 'private',
    pending: pendingRow,
    ...input,
    settle: (inputEnvelope, row, event, normalizedPolicy) => { settled.push({ event, row, normalizedPolicy }); return true },
  })
  return { result, settled, control }
}

test('persisted session overlay authorizes a listed team member without replacing source binding', () => {
  const hit = runOverlayApproval({
    overlay: {
      mode: 'team', owner: 'owner-1',
      approvalMembers: [{ channel: 'telegram', accountId: 'tg-app', userId: 'member-1' }],
    },
  })
  assert.equal(hit.result.status, 'accepted')
  assert.equal(hit.settled[0].normalizedPolicy.owner, 'owner-1')
  assert.equal(hit.settled[0].normalizedPolicy.approvalMembers.length, 1)
})

test('session overlay team member cannot cross channel/account/chat/user bindings', () => {
  const overlay = {
    mode: 'team', owner: 'owner-1',
    approvalMembers: [{ channel: 'telegram', accountId: 'tg-app', userId: 'member-1' }],
  }
  for (const input of [
    { channel: 'feishu' },
    { accountId: 'other-app' },
    { chatId: 'other-chat' },
    { userId: 'intruder' },
  ]) {
    const pendingRow = overlayPending(input.userId ?? 'member-1')
    const hit = runOverlayApproval({ overlay, pendingRow, input })
    assert.equal(hit.result.status, 'rejected', JSON.stringify(input))
    assert.equal(hit.settled.length, 0, JSON.stringify(input))
  }
})

test('session overlay approvalOwnerOnly allows only the source-bound owner', () => {
  const overlay = { mode: 'team', owner: 'owner-1', approvalOwnerOnly: true }
  const member = runOverlayApproval({ overlay })
  assert.equal(member.result.reason, 'owner_only')
  const owner = runOverlayApproval({ overlay, pendingRow: overlayPending('owner-1'), input: { userId: 'owner-1' } })
  assert.equal(owner.result.status, 'accepted')
  const wrongChannelOwner = runOverlayApproval({
    overlay, pendingRow: overlayPending('owner-1'), input: { userId: 'owner-1', channel: 'feishu', accountId: 'fs-app' },
  })
  assert.equal(wrongChannelOwner.result.status, 'rejected')
  assert.equal(wrongChannelOwner.settled.length, 0)
})

test('session overlay keeps personal defaults and approvalMembers never widen conversation commands', () => {
  const personal = runOverlayApproval({ overlay: { mode: 'personal' } })
  assert.equal(personal.result.status, 'accepted', 'overlay must not change the personal approval default')

  const control = createControlEntry({
    now: () => 150,
    policy: { mode: 'personal', owner: 'owner-1', channel: 'telegram', accountId: 'tg-app', userId: 'owner-1', capabilities: { converse: true } },
    policyForSession: () => ({ mode: 'team', approvalMembers: [{ channel: 'telegram', accountId: 'tg-app', userId: 'member-1' }] }),
  })
  const pendingRow = overlayPending('owner-1')
  const result = control.handle({
    eventId: 'ordinary-overlay', command: 'ordinary-message', channel: 'telegram', accountId: 'tg-app',
    userId: 'member-1', chatId: 'tg-chat', sessionId: 'session-overlay', policyVersion: '1',
    pending: pendingRow, settle: () => true,
  })
  assert.equal(result.status, 'rejected')
  assert.equal(result.reason, 'source_mismatch_userId')
})

test('resolver throws, returns unknown/source/unnormalized fields, or is async: static base policy remains fail-closed', () => {
  const base = { mode: 'team', owner: 'owner-1', approvalOwnerOnly: true, channel: 'telegram', accountId: 'tg-app', capabilities: { approve: true } }
  for (const resolver of [
    () => { throw new Error('store unavailable') },
    () => ({ mode: 'team', approvalMembers: [{ channel: 'telegram', accountId: 'tg-app', userId: 'member-1' }], evil: true }),
    () => ({ channel: 'feishu', owner: 'owner-1' }),
    () => Promise.resolve({ mode: 'team', approvalMembers: [] }),
  ]) {
    const hit = runOverlayApproval({ policy: base, resolver, input: { trusted: true } })
    assert.equal(hit.result.status, 'rejected')
    assert.equal(hit.result.reason, 'owner_only')
    assert.equal(hit.settled.length, 0)
  }
})

test('resolver is keyed by the exact session id and is not consulted when normalization has no session id', () => {
  const seen = []
  const hit = runOverlayApproval({
    policy: { mode: 'team', owner: 'owner-1', approvalOwnerOnly: true, channel: 'telegram', accountId: 'tg-app', capabilities: { approve: true } },
    resolver: (sessionId) => { seen.push(sessionId); return sessionId === 'other-session' ? { mode: 'team', approvalMembers: [{ channel: 'telegram', accountId: 'tg-app', userId: 'member-1' }] } : null },
    input: { trusted: true },
  })
  assert.deepEqual(seen, ['session-overlay'])
  assert.equal(hit.result.reason, 'owner_only')

  let calls = 0
  const control = createControlEntry({ now: () => 150, policyForSession: () => { calls++; return { mode: 'team' } } })
  control.register('approval', {
    getPending: () => overlayPending('member-1'),
    buildEvent: () => ({ eventId: 'missing-session', source: 'mobile', channel: 'telegram', accountId: 'tg-app', userId: 'member-1', chatId: 'tg-chat', policyVersion: '1', command: 'approval', createdAt: 100, expiresAt: 1000 }),
    settle: () => true,
  })
  const result = control.handle({ eventId: 'missing-session', command: 'approval', approvalKey: 'overlay-key', channel: 'telegram', accountId: 'tg-app', userId: 'member-1', chatId: 'tg-chat' })
  assert.equal(result.reason, 'missing_sessionId')
  assert.equal(calls, 0)
})
