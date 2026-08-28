// dsh-notifier adapter: webhook
// 通用自定义 webhook 兜底：POST JSON { title, content, timestamp, level?, group? }。
// 配置：url（必填）+ headers（可选，自定义鉴权头，整体视为 secret 不落日志）
//     + allowPrivateNetwork（可选，默认 false；内网/本机接收端需显式开启，见 _urlguard.mjs）。
// S-02（CWE-918）：url 是全项目用户自由度最大的出站目标（任意 scheme 之外的任意主机），
// 发送前强制走 SSRF 校验；重定向面由 _shared.mjs 的 redirect:'manual' 关闭。

import { postJson, str, num, NotifyError, ERROR_CODES } from './_shared.mjs'
import { assertPublicHttpUrl } from './_urlguard.mjs'

export const type = 'webhook'

/** 校验并归一化配置；缺失抛中文指引。 */
export function resolve(cfg = {}) {
  const url = str(cfg.url)
  if (url === '') {
    throw new NotifyError('webhook 未配置：url（接收 POST JSON 的 webhook 地址）未填写', ERROR_CODES.NOT_CONFIGURED)
  }
  const headers = cfg.headers !== null && typeof cfg.headers === 'object' && !Array.isArray(cfg.headers)
    ? cfg.headers
    : {}
  return {
    url,
    headers,
    // S-02 逃生口：内网自托管接收端显式声明（布尔，非字符串宽进）
    allowPrivateNetwork: cfg.allowPrivateNetwork === true,
    timeoutMs: num(cfg.timeoutMs, 10000, 1000, 60000),
  }
}

/** 发送 JSON；发送前过 SSRF 闸；非 2xx 抛带中文指引的错误。 */
export async function send(resolved, msg) {
  await assertPublicHttpUrl(resolved.url, { allowPrivate: resolved.allowPrivateNetwork === true, channel: 'webhook' })
  const body = {
    title: msg.title,
    content: msg.content,
    timestamp: new Date().toISOString(),
  }
  if (msg.level !== undefined) body.level = msg.level
  if (msg.group !== undefined) body.group = msg.group
  await postJson(resolved.url, body, { headers: resolved.headers, timeoutMs: resolved.timeoutMs, channel: 'webhook' })
}
