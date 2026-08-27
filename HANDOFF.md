# dsh-notifier 交接文档（HANDOFF）

> 2026-08-27 final maintenance (Luna): public facade A3/A4 hardening is landed (frozen consumer surface, private idempotent teardown, finite instance-shared budgets and safe source labels); callback-reference capacity now rejects new refs instead of evicting live buttons, and inbound reject throttling is isolated by `(channel,userId)`. Package root is narrowed to `{ name, inject, apply }`, with constructors available only via explicit `dsh-notifier/internal`. Focused coverage is contract/mock only; no real-device, tenant, or OS-isolation evidence.

> 写给下一个 agent。本文档是完整的工作上下文快照：设计理念、军规约定、架构地图、
> 版本脉络、审查记录、已知坑、待办清单。读完这一份即可无缝接手。
> 当前快照：2026-08-27，协议预审落地后的渠道适配安全收尾。按 `docs/protocol-preflight/` 事实边界（不改协议猜测）完成代码层修复并同步测试契约：wxpusher 入站注入本地 accountId（修复 WxPusher 审批/提问编号回复自来源绑定硬化后全部失效）；移除 conversation 路由与 Control Core `pendingMeta` 的「channel 当 accountId」兜底（缺账号一律 `missing_accountId` fail-closed），并让 `actions.dispatch` 把传输层本地 accountId 原样转发进 Control Core；**telegram/飞书直接按钮回调把提供方真实 eventId 传入 Control Core**（此前 `ap:`/`aq:` 直接回调缺 eventId，被 `missing_eventId` 拒绝——按钮在 Control Core 接线下全部失效）；questions 缺 chatId 分支补 accountId 消费、编号作答成功回执答案从已结算账本行回读。测试契约对齐生产恒接线：approval/questions/phase-2 rig 补 Control Core、`contract.spec` 跳过协议形状 fixture。当前开发线 `npm test` = **1346**（1345 pass + 1 skip）；已发布 v0.8.6 契约仍为 909，当前线未发布、无真机验证。
> 上一快照位：2026-08-27，阶段 1-6 硬化测试完成：(1) 持久化 session overlay→Control Core 端到端集成测试（admin→registry→Control Core、重启持久化、fail-closed、恶意覆盖层、approvalOwnerOnly/approvalMembers 正反例、steer/ordinary-message 不授予）；(2) PR #12 硬化（decisionPromise rejection、并发 qKeys 隔离、parallel 默认关闭、按钮降级、重放拒绝）；(3) 跨进程 session 状态写入（独立 registry 读写、墓碑持久化、store 失败返回 false、outbound/control 不互盖）；(4) 渠道能力矩阵与 fail-closed（QQ group/unknown、WeChat declared、Feishu/Telegram facade、UTF-16 边界、跨渠道精确来源绑定）；(5) 个人 UX 与 admin API（引导态、UI 状态、settleQuestion fail-closed、凭证脱敏、source/unknown 字段拒绝）；(6) 安全/结构（覆盖层边界、通配拒绝、来源字段剥离、审计轮转、密钥泄漏防护、通道隔离）。该快照声称的 `npm test` = 1329 已过时：当时 approval/questions 实际存在 7 个预存测试失败（Control Core 强制接线后 rig 未同步），由本次收尾修复并追加 A3/A4/A5/A6。
> 上一快照位：开发线 HEAD 为 `69ad33f`（Stage 4 会话策略控制覆盖层持久化原始实现，见下方快照段）。当前开发线 `npm test` = 1223（1222 pass + 1 skip）；已发布 v0.8.6 仍为 909，当前线未发布。
> 本文上一快照位 v0.8.2（2026-08-18）；v0.8.3/v0.8.4 为安全修复版，0.8.4 的 CHANGELOG 条目由接手 agent 于 2026-08-19 回补（发版时遗漏）。
> 2026-08-23 接力合入公共镜像 v0.8.5 发布内容（issue #11 ask_user 编号回复修复 + PR #9 飞书扫码 SDK 适配），见「当前接力交代」。
> 上一稳定发布位 v0.8.6 = `bf03a1c`（npm `dsh-notifier@0.8.6`，公共镜像 `db42908` 已清理 node_modules/package-lock）。
> 快照刷新：2026-08-26，Task 04 首次配置 UX 已完成：本地管理台首屏显示四态进度，个人模式默认隐藏绑定/会话高级导航，通道空状态改为字段配置指引，测试成功/失败显示下一步与重试文案；仍保持 loopback/Bearer/零依赖边界。Control Core 已接入宿主事件与 inbound 回调，来源绑定按 `(channel,userId,chatId)` 隔离；能力矩阵/fallback 与 runtime assembly 已对齐。Web/admin 已具备阶段 2A 本地管理台的远程提问裁决入口（choose/reject，见下方快照）；desktop 端仍无 settlement 入口。`notifyAll().delivered` 仍只有渠道级证据，不能推导具体 chat 送达；未获逐目标 `sendText` 确认的编号兜底保持 fail-closed。Issue #16/#14 只能标记代码/契约完成，待真实设备/宿主验证。公共仓库不动。
> 批次 4（2026-08-26）微信 iLink provider slice 已接入 `src/channels/wechat-ilink/`：单账号 QR-first、bounded long-poll、账号命名空间 cursor/context、整批交付后推进游标、断线重连/stop、明确 QR 过期状态、文本/编号 fallback、连接状态和结构化图片 envelope。旧 `src/inbound/wechat-ilink.mjs` 保留兼容入口；图片收发仅有可选 media bridge，能力状态为 `declared`，没有真实协议/设备验证，不得标记正式支持。新 focused tests 位于 `test/channels/wechat-ilink.test.mjs`。
> 批次 5（2026-08-26）飞书与 Telegram provider facade 已建立在 `src/channels/feishu/`、`src/channels/telegram/`：回调归一化强制 user/chat 来源字段，能力证据分别记录为 contract-tested/declared；既有 inbound transport 保持兼容，控制权限仍由 provider-neutral Control Core/session arbiter 负责。文件发送只通过显式 adapter seam，未做真实平台/设备验证，不能标记 `real-device-verified`。focused tests 位于 `test/channels/feishu.test.mjs`、`test/channels/telegram.test.mjs`。
> 路线图阶段 2A（2026-08-26）：本地管理台远程提问裁决入口已建立于「问题桥 facade + Control Core」之上。`GET /api/questions` 仅返回脱敏只读快照（不可逆 12 位 sha256 ref、掩码 agent/chat/user、选项文本、时间），零 token/凭证/完整标识/答案隐私；`POST /api/questions/:ref/settle`（choose/reject）一律经 Control Core 的 `question-answer` spec 走既有授权与单次结算（首达采纳）语义，本端点不复制 ledger 结算、不留直通后门，Control Core 未接线时 fail-closed `not_available`。竞态双端互斥、驳回复用 `aq-skip` 交还桌面、选项封闭集 fail-closed。前端 `ui.mjs` 面板纯字符串逐字段 `esc()` 转义，token 绝不进 DOM。focused tests：`test/admin-questions.test.mjs`、`test/questions-admin-settlement.test.mjs`、`test/admin-ui-behavior.test.mjs`。真实宿主/设备验证不做，标记 code/contract-tested，Issue #16 不关闭。
> 团队模式批准权限契约（2026-08-26，`36aca9f`）：`src/control/session-arbiter.mjs` 对有界可选 `approvalMembers` 归一（trim/去重精确三元组/上限 64/wildcard·global·空·嵌套·无界一律拒绝），新增导出纯 `canSettleApproval(policy,event)` 并仅接入 `canAcceptCommand`/Control Core，同作用于 `approval` 与 `question-answer`，绝不授予 `steer`/`ordinary-message`。`approvalOwnerOnly=true` 仍只允许 `policy.owner`；`mode='team'` 且非空列表要求事件的精确 `(channel,accountId,userId)` 三元组在列表内、否则仅 owner；personal / team 无列表沿用既有精确来源绑定；`sessionId`/`chatId` 在所有命令下恒精确。`src/control/entry.mjs` 把归一化策略快照透传给结算回调（`onSettle(event,policy)`），回调不触碰非归一化策略，stale/scope 不匹配在 onSettle 前被拒。未改任何 IM transport、原生卡片、Web/admin UI、审批/提问核心或 release 版本；个人默认与 `conversation` 仍各自 opt-in。focused tests：`test/session-arbiter.test.mjs`、`test/control-entry.integration.test.mjs`。契约测试通过（`npm test` = 1200），无真机/provider 验证；把 `approvalMembers`/`owner` 经 session registry 与 loopback admin API 持久化推迟到下一节审查。
> 团队策略对抗评审修复（2026-08-26，`6211d1e`）：评审发现 `canSettleApproval` 对 owner 只比 `userId`，可从错误 channel/account 以 owner id 结算。修复后 `approvalOwnerOnly` 与 team owner 豁免都额外要求事件 `(channel, accountId)` 与归一化策略的 channel/accountId 精确匹配，owner 授权变为精确来源；列表内非 owner 成员仍仅按其归一化精确三元组授权；`sessionId`/`chatId` 恒精确；exported `canSettleApproval` 与 `canAcceptCommand`/Control Core 同规则；ownership/membership 永不授予 steer/ordinary-message。新增对抗测试（错误 owner channel/account），`npm test` 仍 = 1200（1199 pass + 1 skip），未 push、未改版本。
> 团队策略来源绑定修复 round 3（2026-08-26，`befd15a`）：独立对抗评审再次命中 `src/control/entry.mjs` 的 `createControlEntry`——合并 rowMeta 后又用**传入事件**覆盖策略 channel/accountId/userId/sessionId/chatId，导致待决行省略 `accountId`（或 channel）、或策略点名 owner 却无已绑定会话来源时，owner-only / team owner 事件可从错误 account/channel 以 owner id 结算（事件铸造了 arbiter 授权对照的策略来源）。修复把授权来源绑定改为真实原始来源（rowMeta → 待决行顶层 → basePolicy）：`channel`/`accountId`/`chatId`/`sessionId`/`userId` 任一层已声明则事件必须精确一致，否则 `source_mismatch_*` 拒绝；`owner` 只取自原始策略/pending（永不取自事件）；owner/team-member 结算生效但真实会话来源不存在时 fail-closed（`source_mismatch_channel`）。legacy 非授权路径（action `stop`、conversation steer）源元数据真实缺失时保留 adapter-envelope 绑定；`sessionId`/`chatId` 恒精确；ownership/membership 永不授予 steer/ordinary-message。独立复现错误 account owner（待决行缺 accountId）、QQ private chatType 错误 account/channel、全程无来源 owner-only 三类；新增回归测试于 `test/session-arbiter.test.mjs` 与 `test/control-entry.integration.test.mjs`。验证 `npm test` = **1204（1203 pass + 1 skip）**；release guard（0.8.6/909）、channel matrix、`node --check`、`git diff --check` 全绿；未 push、未改版本。
> Stage 4 会话控制覆盖层持久化——对抗评审修复（2026-08-26，`5c6b4fc`）：评审命中三个 P1/P2 缺陷并全修。(1) **分写 `route:sessions` 的 lifecycle 抹写/跨会话 clobber（P1-1）**：registry 整缓存 persist 原本把内存 `route:sessions` 原样覆写，而 router `setSessionControl` 直写同一键——lifecycle 写会抹掉刚 admin 设的 `.control`，也可删掉 registry 陈旧缓存从未含有的跨会话记录。`persist()` 改为**记录级再读合并**：以盘上当前表为基底（store 读收敛=含 router/admin 直写），删回收墓碑，再逐记录并入盘上记录——router 独占的 `.control` 子键原样保留、router 才建档的会话不再被丢；损坏/越界/来源字段 `.control` 在每次 lifecycle 写时经 `normalizeControlOverlay` 归一丢弃（P2 的 canonicalize）。跨组件回归（同一 store 上真实 router+真实 registry）：`setSessionControl` 后 `.touch`/`.ensureSession` 不再抹 control、router 才建档的会话存活、重启新 registry 读到持久化 control、被回收的过期 disposed 会话从盘上删净（墓碑压过 fresh base）。(2) **持久化写失败被静默吞并（P1-2）**：`store.save()/set()` 把磁盘失败吞掉且无动作信号，`router.safeSet` 视非抛为成功，`PATCH control` 于是返回 200 而重启即丢。`store.save()/set()` 现返回 durable 布尔（仅 resilient rename 完成后 true；磁盘抛错与损坏转存中止路径 false），`router.safeSet` 把显式 `false` 当失败、legacy `undefined` 仍视为成功（向后兼容），admin 对非 true 报 500。新增 `test/store.test.mjs` 用真实 `createStore` 落盘失败路径（父路径为常规文件）断言 `set` 返回 `false`（可写路径 `true`）；新增真实 createStore+真实 router 的 admin 测试断言 `patchSessionControl` 抛 `ApiError(500)`。(3) **copy-on-read（P2）**：registry 公共记录返回改深拷贝 `control`/`outbound`/`inbound` 子键，改动返回值的 `approvalMembers` 不再污染内部态。两个既有 registry 测试从 mock store 的引用别名（本修复后不再存在的假象）纠正到与真实 `createStore` 一致的值语义。验证：focused 181 全绿；`npm test` = **1230（1229 pass + 1 skip）**；release guard（0.8.6/909）、channel matrix、`node --check`、`git diff --check` 全绿；未 push、未改版本。真机/宿主验证缺口不变：没人经 admin HTTP 改过真实会话覆盖层、没宿主对持久化覆盖层重启、真实 provider 回调没跑在覆盖层策略上。已知残差（记录未扩展）：router 读写仍是 fresh-then-whole 整表、outbound 双写路径 clobber 为既有、不属本阶段范围。
> 团队策略控制覆盖层持久化 Stage 4（2026-08-26，`69ad33f`）：已评审的 `owner`/`approvalOwnerOnly`/`approvalMembers` 以有界覆盖层持久化到 `route:sessions[<id>].control`，经 session registry + loopback admin API 寻址。单一纯 `normalizeControlOverlay`（`src/control/session-arbiter.mjs`）是可写覆盖层的唯一规范（只收 mode/owner/approvalOwnerOnly/approvalMembers 四字段，读时丢弃 channel/accountId/userId/chatId/sessionId/policyVersion/expiresAt/revoked），registry/router/admin 三条写路径共享它，形状/上限/拒收永不分叉；session registry `getControl/setControl/clearControl`（copy-on-read、write 前归一、损坏子键按缺失、保留无关键、落盘失败降级内存）、router `setSessionControl`（字段级 diff、null=删键、返回 boolean）、admin 专属 `PATCH /api/sessions/:id/control`（未知/来源/保留键 422、形状/越界/通配 422、null-clear、从未建档 404、存储失败 500）+ `GET /api/sessions` 脱敏 control 摘要（mode/approvalOwnerOnly/ownerConfigured/approvalMembersCount，绝无原始标识符）。**持久化/API-only 切片**：覆盖层**尚未**接入 `createControlEntry` 授权——不存在干净的单边界 Control Core 策略查找钩子，接线需侵入式重构刚评审的 source-binding 热路径（回归风险于 round 2/3/4 对抗修复），故按本切片 mandate 保持不接线、精确 next hook 记录在 workstream（可选的 `policyForSession` 解析器在既有授权检查前并入 basePolicy；覆盖层不带来源字段，已评审 source-binding 逻辑仍权威）。个人默认 safe（覆盖层只四字段、永不翻转 converse/groupChatControl）。验证 `npm test` = **1223（1222 pass + 1 skip）**；release guard（0.8.6/909）、channel matrix、`node --check` ×5、`git diff --check` 全绿；未 push、未改版本。无真机/宿主验证：没有 operator 经 admin HTTP 改过真实会话覆盖层、没有宿主对持久化覆盖层重启、没有真实 provider 回调跑在覆盖层策略上——contract-tested，不标 `real-device-verified`。
> 团队策略来源绑定修复 round 4（2026-08-26，`6d87a56`）：外部独立对抗评审又命中两个剩余缝隙——`sourceOf` 以 rowMeta 优先使陈旧/被篡改的 `pending.control`/`pending.controlMeta` 可覆盖冲突的规范 basePolicy channel/account，且授权命令仍存在事件回退。修复把 `createControlEntry` 里每个现存来源权威（`basePolicy`、每个 `pending.control`/`pending.controlMeta`、待决行顶层）都当作一致性约束：对 `approval`/`question-answer` 只要这几层之间或与其事件出现任何不一致就 `source_mismatch_*` fail-closed；除非适配器 `spec.authorize` 证明精确 `pushedTo` 目标，授权命令绑定真实原始来源，永不回退事件值。非授权 `stop`/`steer`/`ordinary-message` 保留显式 legacy envelope 绑定（`pendingMeta` 确定性 sessionId/key、事件 channel/account/user/chat），源元数据真实缺失的 legacy action/conversation 行仍可结算；`approval`/`question-answer` 永不使用事件回退。新增回归测试（嵌套 controlMeta 覆盖被绑定 base 策略 feishu/evil 对 telegram/a1 被拒、多来源联合不一致、对齐来源接受、question-answer 同规则、Telegram/Feishu action 回调仍经共享 entry 结算）。验证 `npm test` = **1205（1204 pass + 1 skip）**；release guard（0.8.6/909）、channel matrix、`node --check`、`git diff --check` 全绿；未 push、未改版本。把 `approvalMembers`/`owner` 经 session registry 与 loopback admin API 持久化在下一节（Stage 4，`69ad33f`）完成。
> 当前 PR #12 模块化重写：QQ 官方机器人已接入显式 `INTERACTION_CREATE` 审批/提问按钮负载，统一走 Control Core；旧客户端自动文本降级，群聊目标禁止可操作按钮以避免成员间泄漏。`approval.parallel` 仅显式 opt-in，默认关闭，等待 Promise reject 按超时 fail-closed。真实 QQ 协议/设备验证仍未完成，能力只能标记 contract-tested/declared。

## 方向决策（2026-08-25，规划态）

阶段 2A 已完成代码/契约实现；下一阶段继续按个人模式优先的跨 IM 移动控制面推进。默认 `observe + approve`，`converse` 单独开启；微信 iLink 首版只做单账号 QR-first 个人路径，内部保持 account 边界但不暴露多账号配置。控制台继续作为 DSH 内嵌本地 Web 入口，复杂团队 ACL 渐进披露。详细计划、渠道分层、SDK 许可证门槛与剩余实现阶段见 `docs/architecture-roadmap.md`；真实设备验证仍是独立发布门。

## 当前接力交代（2026-08-23，第二轮：镜像接力合入）

- 当前 canonical 开发仓库：私有 `THEWOLFWALKER/dsh-notifier-dev`；公共 `THEWOLFWALKER/dsh-notifier` 只做发布/公开源码镜像。分支拓扑：私有 `main` 已含 P1-1/P1-2/P1-3、镜像接力与 v0.8.6 发布；下一位 agent 从 `main` 拉新分支。

- 本轮 agent：`ox-alpha / span/ox-alpha / Linux sandbox (root, Node v22.23.2)`，两轮接力：
  ①P1-3 跨进程状态压力审查（merge `52c467a`，契约 902→906）；
  ②公共镜像 v0.8.5 发布内容接力合入——issue #11 ask_user 编号回复修复（镜像 `74e5d54` cherry-pick 为 `4a1b8f7`）与 PR #9 飞书扫码 SDK 适配（镜像 `cbaab26` cherry-pick 为 `5e42768`），契约 906→909，merge `d35f5e6`；分支已合并退役。
- **镜像接力背景**：公共镜像 `THEWOLFWALKER/dsh-notifier` 的 main（`20bfff9`，2026-08-23）已发布 npm v0.8.5 并含 issue #11 修复（作者 @Lana0741 报告、维护者修复）与 PR #9（贡献者 @chenxiccc，已 merge）。私有 main 与公共镜像是两条无关历史，不能 git merge——按内容 cherry-pick 接力。私有侧 P1-1/P1-2/P1-3 三轮技术债成果**未在镜像中**，属私有线领先内容。
- 镜像卫生问题已清理（2026-08-23）：公共镜像 `main` 删除误提交的 `node_modules/`（947 文件）与 `package-lock.json`，tracked 文件从 1104 降至 156；`.gitignore` 已覆盖，不会再入。
- 镜像开放 issue 与私有 main 对照（本轮核验）：#1/#6 飞书 WSClient logger:null → 私有已修（v0.7.3 noop sdkWsLogger）；#2 `${ENV:NAME}` 入站解析 → 私有已修（v0.6.1 resolveEnvRefs）；#4 飞书三问 → 私有 v0.7.3 闭环；#8 加签 19021 → 私有已修（feishu.mjs #8 注释）；#11 → 本轮合入。剩余开放项 #3/#5/#7 属功能请求（当前周期不新增功能，挂起）；#4 若真机复现残留再开新 workstream。
- 项目本地 neat-freak canonical skill：`.agents/skills/neat-freak/SKILL.md`；`.claude/skills/`、`.codex/skills/`、`.opencode/skills/` 只有入口指针。
- **历史快照：`crack-fix-batchA-v0.8.7`（2026-08-23 起，快照刷新 2026-08-24 neat 轮）**：以下批次记录保留审计价值，但已被当前 2026-08-26 开发线 superseded；它们不是当前待办，也不代表当前工作区存在未提交改动。版本/计数说明仅适用于当时的 v0.8.6 / 909 快照，不代表当前开发线。
  - 已提交：批次 A（CRACK-001~004 越权裁决族 fail-closed，`013ec48`，契约 909→927 —— 该提交遗漏 CHANGELOG，本轮已回补）、批次 B-1（引导码 0600 文件交付 + 过期码泵码堵死 + 文案去 stderr，`8e6739c`，契约 927→940，workstream `.agents/workstreams/crack-fix-b1-bootstrap-code.md`）、批次 B-键族4（入站内存表/`wechat:ctx:` 收上界，`f3fce85`，契约 940→994）。
  - **工作区未提交**（按各轮任务约束）：批次 C1（TG/飞书来源比对 fail-closed，994→1001）、C2（审批桥 `liveWaiters` 僵尸行闸门，1001→1004）、C3（复合键冒号截断，1004→1007）、REVIEW-ABC 独立审查的 6 个 bug 修复（1007→**1012**）。改动落在 `src/actions.mjs`、`src/admin/api.mjs`、`src/approval/router.mjs`、`src/inbound/{telegram-bot,feishu-bot,identity,wxpusher-callback}.mjs` 与 8 份对应测试。
  - **审查结论**：批次 A+B+C 已过一轮非实现者独立 review（`.agents/workstreams/crack-fix-plan/REVIEW-ABC.md`），**发现 6 个 bug 全部修完、0 遗留** —— 含一个致命语法错（`identity.mjs` 多括号 → 插件 import 即崩，而交接摘要却声称全绿）、一个过度收紧引入的新缺陷（管理台清理入口被锁死）、三个恒绿摆设、一个装配缝（删掉 `index.mjs` 两处 `identity` 传参仍 1011 全绿）。全量 `node --test test/*.test.mjs test/*.spec.mjs` = **1012/1012**，连跑 3 轮一致。
  - **真机门（合 main / 发版前必过，宪法 #8）**：引导码文件交付端到端（起真引导实例 → `cat` 码文件 → 手机 `/pair`）、越权裁决回归（owner 代决 / 非 owner 被拒）、TG 卡片消息删除后回调的真实形状、飞书长连接负载 `context.open_chat_id` 恒带性（不恒带则 C1 会误拒真实点击 —— 主要回滚触发条件）、钉钉/QQ 超上限淘汰行为、微信真实 `context_token` 长度分布、C2 真实 kill -9 重启后僵尸行与新审批并存的裁决走向。清单基线见 `~/dsh-notifier-handoff/06-retest-checklist.md`。
  - 计划与残差：批次计划在 `.agents/workstreams/crack-fix-plan/`（`PLAN.md` 总表、`PLAN-B1.md`、`PLAN-B-k4-fin.md`、`REVIEW-ABC.md`、各轮 `SHORT-*.md`）；残差逐条登记在 `~/dsh-notifier-handoff/20-techdebt.md`。
- 下一步：代码侧推进 provider-neutral 权限/并发/性能收尾及剩余渠道扩展；真机闭环清单见 `docs/memory/risks.md`（TG 护栏边界、长连接重连可见性、其他渠道 payload 证据、BurntToast 主机、npm 验收）。P1-4 admin UI 审计、安全计划 A3-A6、P2 结构性债务仍需独立安排。

---

## 0. 一句话

dsh-notifier 是 DSH（一个 agent 宿主，cordis 插件体系）的统一通知推送插件：
一个 `notify()` API 出多个渠道（telegram/feishu/qq/wxpusher/wechat/dingtalk/bark/...27 = 12 专属 adapter + 15 spec 渠道），
外加**远程审批**（agent 请求危险操作时推卡片到手机，点按钮/回复 1/2 远程裁决）、
**远程会话**（手机上回复消息 inject 进 agent 会话）、**远程提问**（v0.8 ask_user 选择题：选项卡+编号兜底，超时永不代答）、**移动指挥中心**（长任务心跳/疑似卡住提醒/停止任务按钮）、
**开放事件源**（其他插件经 notifier 服务推送 + 订阅 `dsh-notifier/sent` 事件）、
**身份体系**（配对码准入/复合键绑定/运行时成员管理，v0.7）、
**本机 Web 管理台**（凭证/路由/成员/扫码授权，移动端适配）。
零运行时依赖（只用 fetch + node:crypto + 原生 WebSocket）。

- 语言/运行时：Node.js ESM（.mjs），无 TypeScript，无构建步骤
- 代码量：src+test+scripts ≈ 36,000 行；50 个测试文件，1346 测试（1345 pass + 1 skip；已发布 v0.8.6 = 909）
- 文档：README.md / README.zh-CN.md / ADAPTER.md（渠道接入规范）/ PLUGINS.md（插件互操作）/ docs/v0.5-design.md / docs/v0.6-design.md / CHANGELOG.md（最详细的历史）

---

## 1. 当前状态（交接时刻）

| 项 | 状态 |
|---|---|
| 版本 | package.json = 0.8.6；CHANGELOG、admin UI、双语 README 和发布守卫已同步；npm 已发布 `dsh-notifier@0.8.6`；公共镜像 `main` 已清理 `node_modules/` 与 `package-lock.json` |
| git | 私有 canonical：`dsh-notifier-dev`；公共发布镜像：`THEWOLFWALKER/dsh-notifier`；当前开发线包含 `73154cd` 及后续文档同步提交（含 `c4fef26`，文档同步分支未发布） |
| 测试 | `npm test` 已发布 v0.8.6 契约 = **909 tests**；当前开发线 = **1346**（1345 pass + 1 skip；含协议适配安全收尾、阶段 1-6 硬化以及 A3/A4/A5/A6 维护） |
| 发布 | v0.8.6 已发布；下一位 agent 接手时无需再走发布 gate，除非版本再次 bump |
| 真机验证 | 当前分支未完成真实设备/宿主协议验证；QQ/微信 iLink/钉钉图片与 QQ 按钮仅有 contract-tested/declared 证据。历史 v0.6.1/v0.7 验证记录保留在下文 |

### 1.5 仓库文件地图（发布文件 vs 工程文件，0.8.6 立）

**规则一句话：README（双语）里链接到的文件必须随 npm 包分发；给装包用户的文档进 `files` 数组，给贡献者的留仓库。**
`npm pack --dry-run` 可随时验证（当前清单 = 144 个文件）；npm 自动包含 `README*`（含 zh-CN）、`LICENSE`、`package.json`。

**npm 发布包内**（package.json `files` + 自动包含）：

| 内容 | 文件 | 为什么随包 |
|---|---|---|
| 运行面 | `src/` · `cordis.patch.yml` | 插件本体 + 装配补丁 |
| 双语 README | `README.md` · `README.zh-CN.md`（自动） | npm 首页渲染 |
| 历史与法律 | `CHANGELOG.md` · `THIRD_PARTY_NOTICES.md` | README 底部链接到后者 |
| 用户文档 | `docs/guide.md` · `docs/upgrade-guide.md` · `docs/upgrade-guide.en.md` | README 双语均链接 guide；升级/回滚是装包用户高频需求 |
| 互操作契约 | `PLUGINS.md` | 其他插件作者消费 notifier 服务时的契约（README 链接） |
| CLI | `scripts/`（channel-login · test-channel · route · gen-channel-matrix 等） | guide.md 教用户直接 `node scripts/...` |
| 测试 | `test/` | 行为契约随包分发是项目惯例（已发布 v0.8.6 = 909 用例；开发线 HEAD 1346，装包即可 `npm test`） |

**仅工程仓库（不进 npm 包）**：

| 文件 | 性质 |
|---|---|
| `HANDOFF.md` | 本文档——agent 交接上下文 |
| `ADAPTER.md` | 渠道接入规范——给加渠道的贡献者 |
| `docs/v0.5-design.md` · `docs/v0.6-design.md` | 设计决策存档 |
| `docs/test-notes/`（TG-TEST · WECHAT-TEST） | 内部真机测试记录 |
| `docs/screenshots/`（612K） | README 截图；npm 页面相对路径图片本就不渲染，白占包体 |
| `.github/` · `.gitignore` · `package-lock.json`（untracked） | CI 与仓库卫生 |

> **node_modules 不入库**：v0.7.1 曾把 947 个文件的 node_modules 误提交进 git，当前基线已清理并保持零运行时依赖。新克隆无需 `npm install` 即可运行非可选依赖测试；要跑真机 inbound（飞书 WS / QQ connector 等）才需要安装对应 optionalDependencies。

> 新增文档时先问「给谁看」：装包用户 → `docs/` + `files` 数组 + README 链接；贡献者/内部 → 仓库即可，但要登记进本表。

---

## 2. 设计理念（不可违背的红线）

这些是项目的宪法。任何改动先对照这一节，历次 review 的第一检查项就是它们：

### 2.1 安全红线（审批链）

1. **静默永不批准**：超时/无响应/解析失败/任何异常 → `return next()` 交还桌面决定。
   宁可用户重新点一次，绝不替用户批准。所有 fail 路径的语义都是「回落桌面」。
2. **一次点击只授权一次操作**：token 单次核销（vault verify 即失效）+ 审批账本状态机
   （首达采纳，二次裁决返回 `already-resolved`）。双保险。
3. **A listener never throws**：所有事件处理器/消息处理器/装配段全 try/catch 包裹。
   插件绝不能弄崩宿主。装配段还要**逐通道隔离**（一条通道炸了 warn 并跳过，其余照常——v0.6.1 真机事故的教训）。
4. **白名单默认全拒**：`allowUsers` 为空 → 任何入站消息都被拒绝。授权显式、非隐式。
5. **token 时效**：10min TTL，HMAC 签名；`tokenSecret` 默认进程随机（重启后旧卡全废）。

### 2.2 工程军规（写代码时的约定）

1. **零运行时依赖**：只用 fetch / node:crypto / 原生 WebSocket / node:*。optionalDependencies 仅 @larksuiteoapi/node-sdk（飞书 WS，懒加载，没装给中文指引后静默降级）。
2. **错误双写 stderr**：宿主 logger 在 web profile 下不落 stdout，告警必须同时 `console.error`（v0.6.1 真机事故：出站正常+inbound 全死+零可见，排查数轮）。见 `bus.mjs` 的 `warn()`。
3. **fail 的方向**：读失败 → 回退默认/内存态；写失败 → 保留 dirty 下次再试 + warn 一次（不刷屏）；**损坏的 state 文件绝不覆写**（v0.6.4：save 撞上解析失败 = 中止，只有启动 load 才 fail-open 到空——无记忆好过误清空）。
4. **状态文件权限 0600**：state.json / 账本 / 审计都含凭证或上下文（共享主机不可他账号可读）。
5. **每个「审查发现」的修复都要写进 CHANGELOG 并注明审查编号**（如 R2-P1-2），修复处代码注释同样标注。这是项目的可追溯性文化。
6. **测试是行为契约**：行为变更必须同步改测试并在 CHANGELOG 说明为什么改（例：v0.6.4 损坏文件测试从「fail-open 覆写」改成「写入中止保护现场」）。
7. **注释风格**：中文，先说「为什么」再说「是什么」，版本号+审查编号标注来源。文件头是模块职责总述。照着现有文件写就对了。

### 2.3 并发模型（v0.6.3/v0.6.4 的核心主题）

`state.json` 被**多进程**同写：运行中宿主 + CLI（route/channel-login/wechat-login）。三层防御：

1. **键级合并**（v0.6.3）：每个 store 实例只落自己动过的键（dirty set），写时重读磁盘合并——不互相抹键。
2. **跨进程写锁**（v0.6.4）：`save()` 全程持 `<file>.lock`（`openSync 'wx'` 抢占；mtime>10s 视为陈锁可清；有界自旋 60×4ms；超时强写降级+warn）。堵 last-writer-wins 整文件丢写。
3. **读收敛**（v0.6.4）：`get()/keys()` 节流 stat（≥500ms 一次），mtime 变了就重载合并（dirty 键内存优先）——CLI 写 route:* 对运行中宿主秒级可见。

---

## 3. 架构地图

```
src/
├── index.mjs            # 装配总入口（apply）：装配顺序是刻意的，见注释
├── assembly/            # v0.8.7（维护批 3）抽出的纯「决策」装配段
│   ├── outbound.mjs     # 出站凭证 state overlay + testRawConfigOf（composeOutboundChannels/accountOf）
│   ├── admin-token.mjs  # admin token 三路决策 + verifyToken（resolveAdminToken）
│   └── inbound-signals.mjs # 六通道入站 resolve/启用信号（resolveInboundSignals）
├── config.mjs           # 配置解析与默认值
├── notify.mjs           # 出站核心：notify()/notifyAll()，分段、限流、重试
├── routing.mjs          # level → 渠道语义矩阵（active/passive/timeSensitive）
├── rules.mjs            # 通知规则（事件 → 是否/如何通知）
├── ledger.mjs           # 通知账本（append-only + prune）
├── event-listener.mjs   # 宿主事件 → 通知（含 turn 心跳/卡住检测）
├── health.mjs           # 渠道健康/熔断
├── actions.mjs          # v0.5 动作分发器（ac: 回调 → turn/cancel 等，白名单动作面）
├── public.mjs           # v0.6 开放服务面（其他插件 push + dsh-notifier/sent 事件）
├── tool-register.mjs    # notify 工具注册给 agent
├── adapters/            # 出站渠道（_engine 共享引擎；spec-channels.mjs 一个文件吃 15 个 JSON 规范渠道）
├── inbound/             # 入站（双向通道核心）
│   ├── bus.mjs          # 入站总线：白名单+去重+审批 waiter+消息扇出（消费语义：true=停止扇出）
│   ├── store.mjs        # state.json 持久化（§2.3 并发三层防御都在这）
│   ├── tokens.mjs       # token vault（mint/verify，HMAC）
│   ├── callback-refs.mjs# v0.6.2 短引用注册表（TG callback_data 64B 限制）
│   ├── identity.mjs     # v0.7 身份绑定层（复合键绑定表/角色/待确认/迁移）
│   ├── pairing.mjs      # v0.7 配对码状态机（六态/SHA-256/暴力锁出/bootstrap）
│   ├── commands.mjs     # v0.7 注册命令（/help /whoami /pair /unpair）
│   ├── target-guard.mjs # v0.7 目标解析三级优先 + 渠道形状守卫
│   ├── conversation.mjs # 远程会话（入站消息 → agent 会话 inject）
│   ├── telegram-bot.mjs / feishu-bot.mjs / qq-gw.mjs / wechat-ilink.mjs /
│   │   dingtalk-stream.mjs / wxpusher-callback.mjs   # 各通道长连接/轮询实现
│   └── _contract.mjs    # 渠道统一契约（normalizeInbound：新旧形状归一）
├── approval/
│   ├── router.mjs       # 审批瀑布流处理器（§2.1 红线的主要承载者）
│   └── escalation.mjs   # 30s/60s 升级提醒链
├── questions/
│   └── router.mjs       # v0.8 远程提问 ask_user（选项卡+编号兜底；复用审批桥接栈：
│                        #   HMAC 一次性 token / 白名单 / 首达采纳 / 催办升级链 / aq: 账本前缀）
├── routing/             # v0.3.2 路由引擎（与 routing.mjs 互补不冲突）
│   ├── agent-router.mjs # agent/会话 ↔ 渠道 双向解析链（route:agents/sessions）
│   └── session-registry.mjs # agent 生命周期 → route:sessions 台账
├── admin/               # v0.3.3 Web 管理台（server/api/ui/scan/events，SSE）
├── status/turn-tracker.mjs # 任务状态跟踪（心跳源）
└── client/desktop-sound.mjs # 桌面端提示音
```

**装配顺序要点**（index.mjs，改动前先读注释）：notifier → publicFacade/服务注册 → sweep 定时器 → router/registry → event-listener（惰性 getter 拿 actions/interactive）→ 白名单块（vault→bus→actions→逐通道 inbound，每通道独立 try）→ 审批注册。dispose 链全程收集（disposers 数组，卸载逆序语义）。

---

## 4. 版本脉络（为什么会有这些版本）

| 版本 | 主题 | 一句话 |
|---|---|---|
| v0.5 | 动作闭环 | 「停止任务」按钮（ac: 动作）+ turn 追踪 + 心跳/卡住提醒 |
| v0.6.0 | 开放事件源 | notifier 服务注入 + `dsh-notifier/sent` 事件（其他插件可推送/订阅） |
| v0.6.1 | 真机事故#1 | inbound 装配可诊断性：错误双写 stderr + 逐通道装配隔离（web profile 下零可见的教训） |
| v0.6.2 | 真机事故#2 | TG `callback_data` 64B 硬限 → BUTTON_DATA_INVALID 400。短引用注册表（`r:<8字符>`，单次核销+TTL 15min+FIFO 256） |
| v0.6.3 | 首轮三路审查修复 | 11 项：审批 waiter 预注册竞态 / state 键级合并防互抹 / state 定期瘦身 / 空目标可见化 / 分段部分送达不整条重试 / 编号回复收紧到送达渠道 / 账本审计 0600 等 |
| v0.6.4 | 二轮审查修复 | 6 项：跨进程写锁 / 损坏中止 / 读收敛 / 编号回复 intended 兜底（堵「卡片发送失败但广播教回复 1」死路）/ pushedTo 增量落账 / counter 随机起点 + bus.dispose() + dedup 清扫线联动 |
| v0.6.5 | 三轮审查修复 | 20+ 项：ntfy 中文标题/chanify 路径两个 mock 盲区真机必炸 P1、onebot CQ 注入、锁 owner 校验、损坏自愈、putChannel 白名单、SSE 上限、审计轮转 |
| v0.7.0 | 身份体系 | 「谁是家里人」从 YAML 字符串升为运行时对象：配对码六态（SHA-256 落盘+暴力锁出）、复合键绑定（修跨渠道串扰）、引导态启动（空白名单不再死路）、拒绝回执、注册命令 /pair /unpair、管理台成员页、目标解析三级优先+形状守卫。11 项 UX 审查全闭环，733→797（R5 审查修复后） |
| v0.8.0 | 远程提问 | ask_user 工具（issue #3/#5 M1）：1-4 题 × 2-5 选项、选项卡为主编号兜底、超时永不代答；TG editResolved 契约签名错位修复（mock 盲区#4，真机抓出） |
| v0.8.2 | 装配回归修复 | 恢复 questions/router.mjs 装配（v0.7.3 回滚带出的回归，ask_user 曾短暂失联）+ 入站 ENV 解析统一 |
| v0.8.3 | 安全收紧 | 提问编号回复 any→hint（SEC-2）+ 审批已决竞态消费一致性（E-2） |
| v0.8.4 | 安全收敛 | 动作卡/提问来源会话校验（F-08/AUTH-1，转发拒绝）+ 提问 onChannel 收紧 + WxPusher 回调面加固（INJ-1）+ 孤儿 pending 清扫 |

详见 CHANGELOG.md——每条都写了根因和审查编号，是理解「这个项目怕什么」的最好材料。

---

## 5. 已知的坑与教训（下一个 agent 必读）

1. **mock 盲区是本项目最大的质量风险**。三次真机事故全是 mock 测不出的：
   - v0.6.1：mock fetch 不走 cordis 装配，装配段同步抛错被宿主吃掉零可见；
   - v0.6.2：mock fetch 不校验 TG callback_data 64B 长度；
   - v0.6.3 期间发现：mock 不解析 TG legacy markdown，未配对 `_*` 必 400，卡片静默降级纯文本。
   → 结论：**涉及真实 HTTP 形状/长度/解析语义的改动，单测过绿≠没问题，必须真机复验。**
2. **unref 教训（v0.6.4 当场翻车）**：给 `bus.wait` 的超时定时器加 `unref()` 后，
   所有「await 超时 resolve」的测试全炸（事件循环只剩 unref 定时器时直接退出）。
   生产语义也不对：在途审批不该因进程恰好空闲而蒸发。**停机清理由 dispose() 承担，定时器保持 ref。**
   已回退，教训留在 bus.mjs 注释里。
3. **改函数签名必须全文搜调用点**：v0.6.4 开发中途 `pushApproval` 加了第 4 参 `channelTypes`
   但调用点没传，`undefined.includes` 抛错被 handler 的 try/catch 吞掉（"A listener never throws"
   的副作用：**吞错的保护壳会让断线静默化**）→ 整轮推卡夭折，22 测试红。安全壳下的调用链
   断线要靠测试兜底，这正是 718 测试存在的意义。
4. **counterStart 随机化**（v0.6.4）：审批 key `ap:<callId>:<n>` 的 n 起点生产随机
   （防重启后同 callId 撞 key + 旧 token 复现核销路径），**测试必须传 `counterStart: 0`**
   保住确定性断言（approval.test.mjs 的 rig 已加，新测试记得）。
5. **审批不受 quiet 影响**：静音审批 = 审批永远超时回落桌面，违背「沉默永不批准」的可预期性。
6. **审批是全局广播的**（除非 v0.3.2 分流命中）：编号回复匹配优先级 = 送达精确(user) > 送达同渠道 > intended 渠道 > 拒绝。跨渠道裸 1/2 一律拒绝（v0.6.3 收紧，v0.6.4 加 intended 兜底，演进逻辑见 router.mjs 注释）。

---

## 6. 审查记录（多轮 review 的组织方式）

用户的工作模式是「开发 → 打包发版 → 多轮 review → 修复 → 再发版」：

- **第一轮（v0.6.3 修复来源）**：三路并行审查（R1 出站核心 / R2 inbound+审批 / R3 装配+admin+v0.6），
  产出编号问题清单（R1-P2-1 这种格式 = 轮次-优先级-序号），11 项 P1/P2 全修。
- **第二轮（v0.6.4 修复来源）**：修复质量复核 + 并发/边界专项，6 项（R2-P1-2 跨进程锁、
  R2-P2-2 损坏中止、R2-P2-3 读收敛、R1-P2-1 intended 兜底、R1-P1-1 增量落账、R2-P2-4/5 counter+dispose）。
- **审查方法**（下一个 agent 可复用）：按模块分域并行开 2~3 个 review 子代理，
  每个只给一个域的文件清单+红线清单，要求产出「编号+优先级+根因+建议修法」，
  主 agent 汇总去重后逐项修复，每项修复跑全量回归。

---

## 7. 待办清单（当前维护周期：只清理技术债和 bug）

1. ~~发布 v0.6.4~~、~~第三轮 review（R4-1/R4-2/R4-3）~~、~~v0.6.5 发布~~：均已完成（见 CHANGELOG 0.6.5 条目）。
2. ~~v0.7 身份体系~~：已发版（`0221d1e`），真机测试通过（2026-08-17）。
3. ~~真机复验 v0.6.2~v0.7~~：**已通过（2026-08-17）**。重点场景备忘（若后续发现未覆盖再回补）——TG 审批按钮点击（callback ref 展开链）、
   CLI 改路由后宿主不重启秒级生效（读收敛）、两进程同时写 state.json（锁）、
   **新装机空 allowUsers 引导态**（stderr bootstrap 码 → IM 里 /pair → 成为 owner 全链路）、
   TG 绑定 id 在飞书发消息被拒并收到拒绝回执（复合键）。
4. ~~v0.8 文档同步~~：~~README 双语/HANDOFF 的 ask_user 覆盖~~ + ~~guide.md 远程提问章节~~ + ~~npm 发布包文档完整性~~——2026-08-19 全部补齐（提交 `f559658` + 0.8.5 交接打包批；发布包文件边界规则见 §1.5）。
5. **P0：完成 0.8.5 registry artifact 验收**：按 `docs/TECHNICAL_DEBT.md` 的 disposable-profile 流程验证安装、重启、版本、出站和入站。
6. **P1：补齐真实协议验证**（部分完成 2026-08-20：TG 卡片路径 4096 UTF-16 码元护栏 + parse_mode/callback_data 防回归测试已落地 `codex/tech-debt-protocol-guards`，见 CHANGELOG Unreleased）：余项为护栏边界真机复验、其他 provider payload limits 证据、回调体上限（与 A5 协调）、长连接生命周期；mock 通过不等于完成。
7. **P1：并发状态压力审查**（P1-2 错误可见性已完成 2026-08-20，契约 897→902；**P1-3 状态压力已完成 2026-08-23**：多进程实测并发写/锁/收敛/自愈/崩溃注入零丢失零撕裂，修复崩溃残锁 10s 降级写窗口——属主 pid 死亡探测 + 500ms 宽限，契约 902→906）：余下 P2-3 覆盖 SDK 重连/销毁生命周期；防御性 catch 已由 P1-2 全量分类完毕。
8. **P2：证据驱动处理结构性债务**：callback-refs 256 容量、YAML `allowUsers` 迁移尾巴、可选 SDK 版本矩阵。没有现场证据不改容量或移除兼容路径。

完整清单和完成标准见 `docs/TECHNICAL_DEBT.md`。

---

## 8. 快速上手

```bash
npm test                    # 当前开发线 1346（1345 pass + 1 skip）；已发布 v0.8.6 契约仍为 909
npm run lint 2>/dev/null || node --check src/index.mjs   # 无 lint 配置的话用 node --check
node scripts/route.mjs --help        # 路由 CLI
node scripts/channel-login.mjs --help
node scripts/test-channel.mjs        # 渠道连通测试
```

- 数据目录：`$DSH_HOME/dsh-notifier/state.json`（回退 `~/.dsh/dsh-notifier/`）
- 管理台：配置 admin.enabled 后本机 Web（见 README）
- 完整文档入口：README.zh-CN.md → docs/v0.5-design.md → docs/v0.6-design.md → CHANGELOG.md

---

## 9. 给下一个 agent 的话

这个项目的品味在于：**每一条红线都来自一次真实事故，每一条注释都解释为什么**。
接手后请保持三件事：改动前先读目标文件的文件头注释；修复必须带测试和 CHANGELOG 条目；
对「吞错的保护壳」保持警惕——它让断线静默，只有测试能兜住。

祝顺利。🐾
