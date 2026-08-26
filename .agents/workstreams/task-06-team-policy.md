# Workstream: task-06-team-policy

- Agent identity: `claude_fable_5 | claude-code | Windows 11 desktop`
- Agent: `claude_fable_5`
- Branch: `codex/stage3-team-policy`
- Status: complete (code/contract-tested; no real-device validation)
- Start/end: `2026-08-26 -> 2026-08-26`
- Scope: provider-neutral 团队模式批准权限契约 —— 在 `session-arbiter.mjs` 加有界可选 `approvalMembers` 归一与一个纯决策 helper，并仅接进 Control Core 的 `canAcceptCommand()`；回调所用策略为与待决行/事件关联的归一化快照。不改任何 IM transport、原生卡片、Web/admin UI、release 版本，不做真机验证。

## Plan
1. `src/control/session-arbiter.mjs`：`approvalMembers` 归一 —— trim、缺字段丢弃、去重精确三元组、上限 64、拒绝 wildcard/global/空/任意嵌套对象/无界数组；未知策略字段忽略。新增导出纯 helper `canSettleApproval(policy,event)`（ownerOnly→仅 owner；team+非空列表→owner 或列表内精确 (channel,accountId,userId)；personal 或 team 无列表→返回 true 交回精确来源绑定）。把两人绑定从单循环拆成「sessionId/chatId 恒精确」+「channel/accountId/userId 按 approve/question 走 membership 或精确绑定」，规则同时作用于 approval 与 question-answer，不授予 steer/ordinary-message。
2. `src/control/entry.mjs`（最小调用点）：把 arbiter 的 `onSettle(event, policy)` 的归一化策略快照透传给结算回调（第 4 参），保证回调只消费与该 pending 行/事件关联的规范化策略。
3. `test/session-arbiter.test.mjs`：纯策略测试（归一/去重/上限/wildcard 丢弃、member 精确三元组、错误 channel/account/user、owner 覆盖、ownerOnly 两种命令都拒、steer 不因 membership 解锁、stale/expired/revoke/callback-throw fail-closed）。
4. `test/control-entry.integration.test.mjs`：团队成员经共享 Core 只允许已列/owner；非成员/错误 account fail-closed 零结算；错误 chat/group fail-closed 零结算；回调收到归一化策略快照。
5. CHANGELOG Unreleased、HANDOFF 顶部快照、docs/memory/risks.md、workstream 记录。

## Owned files
- `.agents/workstreams/task-06-team-policy.md`
- `src/control/session-arbiter.mjs`
- `src/control/entry.mjs`（仅 onSettle 透传归一化策略）
- `test/session-arbiter.test.mjs`
- `test/control-entry.integration.test.mjs`
- `HANDOFF.md`, `CHANGELOG.md`, `docs/memory/risks.md`, `docs/agent-taskpacks/06-team-policy-contract.md`

## Do not touch
- `src/inbound/`, `src/channels/`, `src/admin/`, `src/approval/`, `src/questions/`, `package.json`, 公共镜像；其它 workstream 文件；`approval.parallel`；不 bump 版本。

## Validation
`node --test test/session-arbiter.test.mjs test/control-entry.integration.test.mjs`; `npm test`; `node scripts/verify-release.mjs`; `node scripts/gen-channel-matrix.mjs --check`; `node --check src/control/session-arbiter.mjs`; `node --check src/control/entry.mjs`; `git diff --check`

## Adversarial review
- membership 是否会弱化来源绑定 → sessionId/chatId 恒精确绑定保留；channel/accountId 空即拒（source_mismatch_channel）。
- ownership 是否可能被列表绕过 → ownerOnly 优先于 team 列表；team 列表含 owner 分支。
- membership 是否误授予 steer/ordinary → 仅 approval/question-answer 分支启用 membership，其余命令走精确绑定。
- 归一清洗是否吞掉安全意图 → wildcard/*/global/空/嵌套一律丢弃，列表冻结。
- 回调是否误用非归一化策略 → onSettle 透传 arbiter 的归一化 mergedPolicy 快照。
- 回调抛异常/结算失败 → arbiter catch 返回 desktop_fallback，settled 撤销。

## Handoff（2026-08-26）
范围：团队模式批准权限契约（`approvalMembers` + `canSettleApproval`），仅 code/contract-tested，未做真实 host/device 验证；未 bump 版本、未推公共 origin。运行时代码提交为 `36aca9f`（实现+测试+CHANGELOG+risks+taskpack，7 文件，+204/-7）；本 workstream 与 HANDOFF.md 的洗牌同步为本批后续 docs 提交。

变更：`src/control/session-arbiter.mjs` 增 `approvalMembers`（归一：trim/去重/上限 64/wildcard·global·空·嵌套·无界一律丢弃），导出纯 `canSettleApproval(policy,event)` 并接入 `canAcceptCommand`，同作用于 approval/question-answer；`approvalOwnerOnly` 保持 owner-only；team+列表需精确三元组否则仅 owner；personal/team 无列表沿用精确绑定；sessionId/chatId 恒精确；steer/ordinary-message 不受 membership 授予。`src/control/entry.mjs` 把归一化策略快照透传给结算回调（onSettle(event,policy) 第 4 参），回调不再触碰非归一化策略，stale/scope 不匹配在 onSettle 前被拒。

验证：focused `node --test test/session-arbiter.test.mjs test/control-entry.integration.test.mjs` = 17 pass；`npm test` = **1200（1199 pass + 1 skip）**；`node scripts/verify-release.mjs` OK（发布契约 909 不变）；`node scripts/gen-channel-matrix.mjs --check` OK；`node --check` 两个改动 src OK；`git diff --check` 干净。

风险：仅 mock/契约验证，无真实 provider 回调在团队作用域实测；把 `approvalMembers`/`owner` 经 session registry 与 loopback admin API 持久化被推迟到下一节审查（taskpack 已标注）。

## 对抗评审修复（2026-08-26，`6211d1e`）

外部对抗评审发现 `canSettleApproval` 对 owner 只比 `userId`，可从错误 channel/account 以 owner id 结算；`approvalOwnerOnly` 与 team owner 豁免两条路径皆有此漏洞。修复：owner 判定额外要求事件 `(channel, accountId)` 与归一化策略 channel/accountId 精确匹配；列表内非 owner 成员仍仅按其归一化精确三元组授权；`sessionId`/`chatId` 恒精确；exported `canSettleApproval` 与 `canAcceptCommand`/Control Core 同规则；ownership/membership 永不授予 steer/ordinary-message。新增对抗测试（错误 owner channel/account）于 `test/session-arbiter.test.mjs`。验证仍 1200（1199 pass + 1 skip）。本 workstream 状态保持 complete。