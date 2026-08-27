# Technical debt and release gates

状态更新：2026-08-27。本轮代码维护已完成；剩余事项只是真机/宿主验证和发布门，不应被误读为待实现的新功能。当前 v0.9.0 源码线 `npm test` 为 `1352`（1351 pass + 1 skip）；公共 GitHub 源码镜像已同步，npm registry 发布仍待 2FA/认证完成。

## 已完成的维护范围

- 文档、版本和测试基线已对账；历史快照不再作为当前状态。
- Telegram 文本边界、回调容量、渠道 account/source 绑定、Control Core 结算、问题编号回复和 QQ/Feishu/WeChat iLink/DingTalk adapter seam 已有 focused contract coverage。
- 错误可见性、跨进程 state 写入、session control overlay 持久化、公共 notifier facade 预算/冻结和管理台个人模式 UX 已完成代码审查与回归测试。
- `allowUsers` 兼容迁移和 Feishu/QQ 可选 SDK 生命周期已完成兼容性评估，保留原入口；详情见 [compatibility-matrix.md](compatibility-matrix.md)。

## 剩余外部验证门

- 真机/协议：Telegram 4096 边界、Feishu WS、QQ gateway/按钮 ACK、DingTalk stream、WeChat iLink QR/长轮询、WxPusher 回调、图片/文件 payload 与各 provider 限制。
- 宿主/桌面：DSH 真实事件装配、真实浏览器管理台操作、重启读取持久化 overlay、Windows BurntToast/PowerShell toast。桌面 `ask_user` 没有安全宿主接口，不能宣称可用或双端共享。
- 发布：npm 认证/2FA、`npm pack --dry-run --json`、registry artifact disposable profile 安装、启动/出站/入站 smoke；源码镜像已推送，registry 发布仍需完成 npm 认证。

## 维护规则

新工作仍须遵循 plan → adversarial review → focused tests → full validation；mock 通过不等于 provider/宿主行为已验证。不得以扩大功能、猜测协议字段或放宽 fail-closed 边界来关闭上述门。

完整检查命令：

```text
npm test
node scripts/verify-release.mjs
node scripts/gen-channel-matrix.mjs --check
node --check src/index.mjs
git diff --check
```
