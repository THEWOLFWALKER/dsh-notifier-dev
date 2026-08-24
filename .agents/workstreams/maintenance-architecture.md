# Workstream: maintenance-architecture

- Agent identity: `claude-code | ark-code-latest | Windows 11 (win32, Node v22)`
- Agent: `maintenance-arch`
- Branch: `codex/maintenance-architecture`
- Status: `active`
- Start/end: `2026-08-24 -> active`
- Scope: 七批维护计划——①管理台初始化/token 流程 ②QQ 心跳 ACK 重连 ③index.mjs 装配拆分 ④Interaction Core 统一交互状态 ⑤入站内容模型 ⑥PR #12 移植评估 ⑦验证与文档同步。只做代码维护与自动化测试，不真机、不发版、不推公共镜像。管理台仅绑 127.0.0.1、审批/动作/提问 fail-closed、不泄 token、不引运行时依赖。
- Plan:
  1. 基线平台稳定性（batch-0）：修 Windows 主机 8 个平台性测试失败（测试维护，不动生产）
  2. 第一批：admin token 单飞（去并发重复弹窗）+ token 持久化 + 401 单次重登录 + 应用层/装配层测试 + 启动日志明确 URL/端口/token 获取方式
  3. 第二批：qq-gw 连续丢 ACK 计数重连（默认 2 次）+ stop() 清理定时器 + 模拟 WS 测试
  4. 第三批：index.mjs 分阶段拆分装配职责（先移代码不改变行为，每阶段补 apply() 装配测试）
  5. 第四批：Interaction Core（pending/resolved/expired/terminated、token 单次消费、来源校验、超时、首达、dispose；保留 state key 与对外接口；先 actions 再 approval 再 questions；不加 approval.parallel）
  6. 第五批：入站 text/image/file 统一消息结构（文字兼容；仅 QQ 单聊图片解析接口+fixture；无协议证据不启用解析）
  7. 第六批：PR #12 重移植（QQ 按钮审批 + QQ 提问卡片；复用统一交互状态；先查桌面/远程同时裁决路径；approval.parallel 默认关闭最后处理）
  8. 第七批：全量验证 + 文档一致性（CHANGELOG/HANDOFF/README 双语/guide/risks 版本与测试数对齐）+ neat-freak 收尾
- Owned files: `src/admin/ui.mjs` `src/admin/api.mjs` `src/inbound/qq-gw.mjs` `src/index.mjs` `src/actions.mjs` `src/approval/router.mjs` `src/questions/router.mjs` `src/inbound/_contract.mjs` `src/interaction/ledger.mjs` `src/inbound/message.mjs` + 对应测试与文档
- Do not touch: 其他 workstream 保留的 `.agents/workstreams/*` 现有文件；公共镜像 `THEWOLFWALKER/dsh-notifier`。
- Validation: `npm test`（node --test test/*.test.mjs test/*.spec.mjs）= **1060 契约**（批 5 后；1059 pass + 1 win32 skip，基线 1012 → 1024 → 1027 → 1046 → 1052 → 1060）；`node scripts/verify-release.mjs`；`node scripts/gen-channel-matrix.mjs --check`；`node --check src/index.mjs`（每批至少这四项）
- Adversarial review: 每批独立复核——token 单飞/401 门、重连定时器泄漏、装配拆分行为等价、交互状态机并发/首达/超时/dispose、内容模型兼容性、PR #12 越权/重复点击路径。
- Handoff: 见 commit 记录与批次汇报；每批先测后汇报再继续；遇安全边界/状态格式/公共 API/真机门问题先停下汇报。
- Commit record:
  - 批 1（管理台 init/token 流程，契约 1024）：`777455b`
  - 批 2（QQ 心跳 ACK 连丢计数重连 + stop 清理，契约 1027）：`777455b` 后序（CHANGELOG 条目 MNT-2）
  - 批 3 阶段 1（出站 overlay → `src/assembly/outbound.mjs`，契约 1034）：`f307950`
  - 批 3 阶段 2（admin token 决策 → `src/assembly/admin-token.mjs`，契约 1038）：`9fd6341`
  - 批 3 阶段 3（六通道入站启用信号 → `src/assembly/inbound-signals.mjs`，契约 1046）：`deda003`
  - 批 4 阶段 1（Interaction Core 统一状态账本 `src/interaction/ledger.mjs` + 6 单测 + actions 迁移，契约 1052）：`cc130e8`
  - 批 4 阶段 2（approval 账本迁移，latestPendingFor 留链内）：`1a4a2a3`
  - 批 4 阶段 3（questions 账本迁移 + CHANGELOG MNT-4）：`6f323a0`
- 批 5（入站 text/image/file 统一消息结构 + QQ 单聊图片解析接口/fixture，契约 1060）：`<待提交>`
- 批 3 有意不抽：身份/配对/迁移/引导/逐通道装载/admin 装配块（耦合面宽，漂移风险 > 精简收益；留待更深的批次）。
- 批 4 有意不抽：各链 `latestPendingFor` 归属/兜底启发式（approval exact/onChannel/intended + liveWaiters；questions exact/onChannel/hint + hintChannels）——匹配语义差异过大，抽进核心会引入行为漂移；核心只留六个原子账本操作。未加 approval.parallel（非目标）。
- 批 5 纪律：`parseQQImageMessage` 与 fixture 只测**不接线**——QQ 官方机器人 C2C 媒体事件真实字段形状无真机证据，qq-gw 及所有适配器均不 import；真机确认 `d.extra` 段形状后翻转启用并落 CHANGELOG 说明依据。