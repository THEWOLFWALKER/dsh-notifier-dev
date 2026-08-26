import test from 'node:test'
import assert from 'node:assert/strict'
import { TELEGRAM_CAPABILITIES, normalizeTelegramCallback } from '../../src/channels/telegram/index.mjs'

test('telegram callback binds source chat and user', () => {
  const normalized = normalizeTelegramCallback({ data: 'r:abc', message: { chat: { id: 42 } }, from: { id: 7 } })
  assert.deepEqual(normalized, { channel: 'telegram', accountId: '', userId: '7', chatId: '42', action: 'r:abc' })
  assert.equal(normalizeTelegramCallback({ data: 'r:abc', from: { id: 7 } }), null)
})

test('telegram capabilities cover protocol fallbacks without claiming real-device support', () => {
  assert.equal(TELEGRAM_CAPABILITIES.textFallback, 'contract-tested')
  assert.equal(TELEGRAM_CAPABILITIES.fileSend, 'declared')
  assert.equal(TELEGRAM_CAPABILITIES.realDeviceVerified, false)
})
