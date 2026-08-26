// Provider facade for Feishu/Lark.
// Transport and rendering stay here; approval/session semantics remain in Control Core.

import { createFeishuInbound as createLegacyInbound, resolveFeishuInboundConfig } from '../../inbound/feishu-bot.mjs'

export const FEISHU_CAPABILITIES = Object.freeze({
  websocket: 'contract-tested',
  richCards: 'contract-tested',
  cardUpdate: 'contract-tested',
  buttonCallbacks: 'contract-tested',
  fileSend: 'declared',
  sourceChatBinding: 'contract-tested',
  groupVisibility: 'contract-tested',
  realDeviceVerified: false,
})

/** Normalize only the transport metadata needed by the shared Control Core. */
export function normalizeFeishuCallback(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null
  const value = input.action?.value
  const action = typeof value?.act === 'string' ? value.act : ''
  const chatId = String(input.context?.open_chat_id ?? input.open_chat_id ?? input.chat_id ?? '').trim()
  const userId = String(input.operator?.open_id ?? input.sender?.sender_id?.open_id ?? '').trim()
  if (action === '' || chatId === '' || userId === '') return null
  return Object.freeze({ channel: 'feishu', accountId: String(input.accountId ?? ''), userId, chatId, action })
}

export function createFeishuTransport(options = {}) {
  const legacy = createLegacyInbound(options)
  const accountId = String(options.config?.accountId ?? options.config?.appId ?? 'default').trim()
  const fileAdapter = options.fileAdapter
  return {
    ...legacy,
    channel: 'feishu',
    accountId,
    capabilities: Object.freeze({ ...FEISHU_CAPABILITIES, ...(legacy.capabilities ?? {}) }),
    status() {
      return { state: legacy.clientState?.() ?? 'unknown', accountId, websocket: true }
    },
    async sendFile(target, file) {
      if (typeof fileAdapter?.sendFile !== 'function') return false
      try {
        const result = await fileAdapter.sendFile({ channel: 'feishu', accountId, chatId: String(target?.chatId ?? target ?? ''), file })
        return result === true || result?.ok === true
      } catch { return false }
    },
    normalizeCallback(input) {
      const callback = normalizeFeishuCallback(input)
      return callback === null ? null : Object.freeze({ ...callback, accountId })
    },
  }
}

export const createFeishuInbound = createFeishuTransport
export { resolveFeishuInboundConfig }
export const capabilityEvidence = FEISHU_CAPABILITIES
