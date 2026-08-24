// dsh-notifier inbound/message.mjs
// 入站统一消息模型（维护批 5）：text / image / file 三类内容的归一结构。
//
// 设计原则：
//  - 文字兼容：既有适配器直接产出的 { text: string } 信封原样归一为
//    { kind: 'text', text }，bus.accept / conversation router 现有消费面零改动；
//  - 结构先行、证据后接：image/file 的归一/解析接口在这里定义并钉死测试，
//    但【无协议证据不接生产】——当前唯一实现者 parseQQImageMessage 只对
//    fixture 解析、不被任何适配器 import（真机确认字段形状后翻转启用）；
//  - 归一不丢信息：kind/text 之外保留 input.payload 原样，消费方按需自取；
//  - 军规：未知结构 fail-closed（返回 null），绝不把「非文本」伪装成 text
//    漏进会话路由——宁可消息不达，不作越权/错位处理。
//
// 目标统一形状（未来适配器/网关按此产出，详见 parseQQImageMessage 接口约定）：
//   { kind: 'text'|'image'|'file', text?, image?: { url, width?, height? },
//     file?: { name?, url?, size? }, payload? }

export const INBOUND_KINDS = Object.freeze({
  text: 'text',
  image: 'image',
  file: 'file',
})

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** url 精确必须是非空字符串（fail-closed：缺 URL 的附件段不构成有效媒体消息）。 */
const urlPresent = (value) => typeof value === 'string' && value.trim() !== ''

/**
 * 字符串化 extra（QQ 媒体事件负载）解析：JSON 字符串 → 数组。已解析的数组原样返回。
 * 解析失败/非数组返回 null。
 */
export function parseExtraSegments(extra) {
  if (Array.isArray(extra)) return extra
  if (typeof extra !== 'string' || extra === '') return null
  try {
    const parsed = JSON.parse(extra)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * 归一任意入站载荷为统一消息。
 * @param {object} input - 适配器原始信封或结构化消息
 *   - 文字兼容：{ text: '...' }（可带 channel/userId/chatId/messageId 等透传字段）
 *     → { kind:'text', text, ...透传 }
 *   - 结构化：{ kind:'image', image:{ url } } / { kind:'file', file:{ name?,url?,size? } }
 *     → 对应 kind（image/file 均要求附件对象含有效 url，否则 null）
 * @returns {null | { kind: string, text?: string, image?: object, file?: object, [k: string]: unknown }}
 */
export function normalizeInboundMessage(input) {
  if (!isPlainObject(input)) return null
  const passthrough = { ...input }
  // 文字兼容：既有信封以 text 为主道。非文本载荷若同时带 text 正文，按 text 归一
  // （附件路径待协议证据，绝不旁路）。
  if (typeof passthrough.text === 'string' && passthrough.text !== '') {
    delete passthrough.kind
    delete passthrough.image
    delete passthrough.file
    return { kind: INBOUND_KINDS.text, text: passthrough.text, ...passthrough }
  }
  if (passthrough.kind === INBOUND_KINDS.image && isPlainObject(passthrough.image) && urlPresent(passthrough.image.url)) {
    delete passthrough.text
    delete passthrough.kind
    return { kind: INBOUND_KINDS.image, image: passthrough.image, ...passthrough }
  }
  if (passthrough.kind === INBOUND_KINDS.file && isPlainObject(passthrough.file) && urlPresent(passthrough.file.url)) {
    delete passthrough.kind
    return { kind: INBOUND_KINDS.file, file: passthrough.file, ...passthrough }
  }
  return null
}

/**
 * QQ 单聊（C2C）图片消息解析接口。
 *
 * ⚠️ 协议证据状态：QQ 官方机器人 C2C 媒体事件的真实字段形状无真机样本核验，本接口
 *    按【文档描述的常见实现】解析，仅测试 fixture（test/fixtures/qq-c2c-image.json），
 *    **不接线**——qq-gw.mjs 及其余适配器均不 import 本函数。真机确认 extra 段形状后，
 *    在 qq-gw.handleDispatch 的 C2C 分支接入并落 CHANGELOG 说明启用依据。
 *
 * 解析判据（全部满足才判定为图片，否则 null，fail-closed）：
 *  - eventData.extra：JSON 字符串（或已解析数组），内含媒体段数组；
 *  - 某段的 type 为 'image' 或 1，且 image.url 为非空字符串。
 * @param {object} eventData - C2C_MESSAGE_CREATE 事件的 d 负载
 * @returns {null | { kind: 'image', image: { url: string, width?: number, height?: number } }}
 */
export function parseQQImageMessage(eventData) {
  if (!isPlainObject(eventData)) return null
  const segments = parseExtraSegments(eventData.extra)
  if (segments === null) return null
  for (const segment of segments) {
    if (!isPlainObject(segment)) continue
    const typeOk = segment.type === 'image' || segment.type === 1
    if (!typeOk || !isPlainObject(segment.image) || !urlPresent(segment.image.url)) continue
    const image = { url: segment.image.url }
    if (Number.isFinite(Number(segment.image.width))) image.width = Number(segment.image.width)
    if (Number.isFinite(Number(segment.image.height))) image.height = Number(segment.image.height)
    return { kind: INBOUND_KINDS.image, image }
  }
  return null
}