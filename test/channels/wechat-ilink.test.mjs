// 批次 4：微信 iLink provider slice（协议归一 + 账号命名空间 + 失败隔离）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  WECHAT_ILINK_CAPABILITIES,
  normalizeQrStatus,
  normalizeUpdateBatch,
  normalizeInboundMessage,
  boundedCursor,
  createWechatIlinkInbound,
} from '../../src/channels/wechat-ilink/index.mjs'

function storeOf(seed = {}) {
  const map = new Map(Object.entries(seed))
  return {
    get: (key, fallback) => map.has(key) ? map.get(key) : fallback,
    set: (key, value) => map.set(key, value),
    delete: (key) => map.delete(key),
    keys: (prefix = '') => [...map.keys()].filter((key) => key.startsWith(prefix)),
    map,
  }
}

const config = { accountId: 'ACC_A', token: 'TOKEN_A', baseUrl: 'https://ilink.test', notifyUsers: [] }

test('iLink capability evidence stays contract-tested/declared; never real-device-verified', () => {
  assert.equal(WECHAT_ILINK_CAPABILITIES.qrLogin, 'contract-tested')
  assert.equal(WECHAT_ILINK_CAPABILITIES.imageReceive, 'contract-tested')
  assert.equal(WECHAT_ILINK_CAPABILITIES.imageSend, 'declared')
  assert.equal(WECHAT_ILINK_CAPABILITIES.realDeviceVerified, false)
})

test('QR expiry is explicit and actionable; unknown status fails closed', () => {
  assert.deepEqual(normalizeQrStatus({ status: 'expired' }), {
    state: 'expired', message: '微信二维码已过期，请重新扫码',
  })
  assert.equal(normalizeQrStatus({ status: 'future-provider-state' }).state, 'error')
  assert.match(normalizeQrStatus({ status: 'future-provider-state' }).message, /重新扫码/)
})

test('cursor is bounded and malformed cursor does not replace a usable cursor', () => {
  assert.equal(boundedCursor('ok'), 'ok')
  assert.equal(boundedCursor('x'.repeat(4097)), '')
  const batch = normalizeUpdateBatch({ ret: 0, get_updates_buf: 'x'.repeat(4097), msgs: [] }, { accountId: 'ACC_A' })
  assert.equal(batch.ok, true)
  assert.equal(batch.cursor, '')
  assert.equal(batch.cursorRejected, true)
})

test('unknown fields never enter the control envelope; known text/image are isolated', () => {
  const text = normalizeInboundMessage({
    from_user_id: 'USER_A', message_id: 'M1', context_token: 'CTX1',
    injected_control: { approve: true },
    item_list: [{ type: 1, text_item: { text: 'hello' } }, { type: 999, payload: { approve: true } }],
  }, { accountId: 'ACC_A' })
  assert.equal(text.text, 'hello')
  assert.equal(text.injected_control, undefined)
  assert.equal(text.payload, undefined)

  const image = normalizeInboundMessage({
    from_user_id: 'USER_A', message_id: 'M2',
    item_list: [{ type: 2, image_item: { media_id: 'media-1' } }],
  }, { accountId: 'ACC_A' })
  assert.equal(image.kind, 'image')
  assert.equal(image.text, '[图片消息]')
  assert.equal(image.image.mediaId, 'media-1')
  assert.equal(normalizeInboundMessage({
    from_user_id: 'USER_A', message_id: 'M3', item_list: [{ type: 2, image_item: {} }],
  }, { accountId: 'ACC_A' }), null, '无 URL 或 mediaId 的图片不能进入 Control Core')
})

test('new provider state is account-scoped and image download failure cannot block text', async () => {
  const store = storeOf()
  const accepted = []
  let downloadCall = null
  const bus = {
    accept: (envelope) => { accepted.push(envelope); return { ok: true } },
  }
  let updateOnce = true
  const fetchImpl = async (url, init = {}) => {
    if (String(url).includes('getupdates')) {
      if (updateOnce) {
        updateOnce = false
        return new Response(JSON.stringify({ ret: 0, get_updates_buf: 'CURSOR_A', msgs: [{
          from_user_id: 'USER_A', message_id: 'M3', context_token: 'CTX_A',
          item_list: [{ type: 1, text_item: { text: '控制命令' } }, { type: 2, image_item: { media_id: 'media-2' } }],
        }] }), { status: 200 })
      }
      return new Promise((resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    }
    if (init.signal) return new Response(JSON.stringify({ ret: 0 }), { status: 200 })
    return new Response(JSON.stringify({ ret: 0 }), { status: 200 })
  }
  const inbound = createWechatIlinkInbound({
    config, store, bus, fetchImpl, sleep: async () => {},
    mediaAdapter: {
      downloadInboundImage: async (...args) => {
        downloadCall = args
        throw new Error('download unavailable')
      },
    },
  })
  inbound.start()
  await new Promise((resolve) => setTimeout(resolve, 10))
  await inbound.stop()
  assert.equal(store.get('wechat:ACC_A:sync_buf'), 'CURSOR_A')
  assert.equal(store.get('wechat:ACC_A:ctx:USER_A'), 'CTX_A')
  assert.equal(accepted.length, 1)
  assert.equal(accepted[0].text, '控制命令')
  assert.equal(accepted[0].image.mediaId, 'media-2')
  assert.equal(accepted[0].contextToken, undefined, 'context_token 只留在 transport state，不得进入 Control Core')
  assert.equal(downloadCall[0].text, '控制命令', '混合文本图片也在控制路径后才尽力下载')
  assert.equal(downloadCall[1].maxBytes, 5 * 1024 * 1024)
  assert.equal(downloadCall[1].timeoutMs, 10000)
  assert.ok(downloadCall[1].signal instanceof AbortSignal)
  assert.equal(inbound.status().accountId, 'ACC_A')
})
