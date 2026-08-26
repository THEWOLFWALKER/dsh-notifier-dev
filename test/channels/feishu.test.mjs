import test from 'node:test'
import assert from 'node:assert/strict'
import { FEISHU_CAPABILITIES, normalizeFeishuCallback } from '../../src/channels/feishu/index.mjs'

test('feishu callback requires action, open_chat_id and operator user', () => {
  const normalized = normalizeFeishuCallback({ action: { value: { act: 'ap:allowed-once:k:t' } }, context: { open_chat_id: 'oc_1' }, operator: { open_id: 'ou_1' } })
  assert.deepEqual(normalized, { channel: 'feishu', accountId: '', userId: 'ou_1', chatId: 'oc_1', action: 'ap:allowed-once:k:t' })
  assert.equal(normalizeFeishuCallback({ action: { value: { act: 'x' } }, operator: { open_id: 'ou_1' } }), null)
})

test('feishu capabilities never claim device verification and file is declared', () => {
  assert.equal(FEISHU_CAPABILITIES.fileSend, 'declared')
  assert.equal(FEISHU_CAPABILITIES.realDeviceVerified, false)
})
