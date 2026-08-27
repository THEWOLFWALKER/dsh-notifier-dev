# Taskpack 07 — 最终代码维护与发布前收尾（Luna）

## 目标

在不进行真机/真实租户验证、不操作公共发布仓库的前提下，把当前开发线收尾到“代码、测试、文档均可进入发布候选”的状态。只修复仓库内可以由源码和契约测试证明的问题；外部协议无法确认的能力继续保持 `declared`，不得猜字段或伪装成正式支持。

## 工作区与硬边界

- 工作区：`C:\Users\36229\Documents\ChatGPT\DSH Notifier`
- 开发真源：`https://github.com/THEWOLFWALKER/dsh-notifier-dev`
- 公共仓库 `https://github.com/THEWOLFWALKER/dsh-notifier`：禁止 push、merge、release。
- 先执行：`git status --short --branch`、`git log --oneline -12`。
- 必须阅读：`AGENTS.md`、`HANDOFF.md`、`docs/KNOWLEDGE_BASE.md`、`docs/TECHNICAL_DEBT.md`、`docs/security/PLUGIN_SECURITY_FIX_PLAN.md`、`docs/architecture.md`、`docs/OPERATIONS.md`、`docs/memory/README.md`、`docs/memory/project-state.md`、`docs/memory/risks.md`、`docs/protocol-preflight/README.md` 及四个渠道预审文档。
- 不得 `git reset --hard`、覆盖已有有效提交、删除未审查改动。
- 保持 Node 原生能力和零运行时依赖；不引入框架、SDK 或新的控制核心。
- 所有审批、提问、动作仍必须经过 Control Core；所有来源校验继续 fail-closed。
- 不进行真机、真实租户、真实 QQ/Telegram/飞书/iLink 网络验证；不得因其缺失阻塞代码工作。
- 每个逻辑主题单独提交；不要提交凭证、日志、状态文件、`node_modules/`、`package-lock.json` 或生成物。

## 当前已知基线

- 当前开发线最近已完成协议预审与 accountId/eventId 来源绑定修复。
- 当前测试基线以本次实际 `npm test` 输出为准，不得沿用旧报告数字。
- `docs/protocol-preflight/` 是协议事实边界；`documented`、`contract-tested`、`declared` 三种等级必须保持区分。
- 微信 iLink 图片/文件/卡片/撤回、飞书文件/签名加密细节、Telegram 文件等未有充分外部证据，继续 `declared`。

## 实施顺序

### 阶段 0：建立基线和工作流记录

1. 新建 `.agents/workstreams/final-code-maintenance-luna.md`，从 `.agents/workstreams/TEMPLATE.md` 填写身份、分支、范围、拥有文件、验证命令和交接方式。
2. 运行一次 `npm test`、`node scripts/verify-release.mjs`、`node scripts/gen-channel-matrix.mjs --check`、`node --check src/index.mjs`、`git diff --check`，记录真实结果。
3. 用 `rg` 搜索 HANDOFF、CHANGELOG、README、`docs/memory/` 中的测试总数、版本和“已完成/未完成”声明，建立修改前清单。

### 阶段 1：Session Control Overlay 接入真实授权路径（最高优先级）

目标：解决“管理台能保存权限，但实时审批不受其影响”的断链。

重点文件：

- `src/control/entry.mjs`
- `src/control/session-arbiter.mjs`
- `src/approval/router.mjs`
- `src/questions/router.mjs`
- `src/admin/api.mjs`
- 相关 `test/control-entry*.mjs`、`test/approval*.mjs`、`test/questions*.mjs`、session 测试

要求：

1. 为 `createControlEntry` 增加可选 `policyForSession(sessionId)`（同步或异步均可，但必须统一处理异常）。
2. 在 `handle()` 已解析真实 `sessionId` 后读取 overlay，再与基础策略合并；只能覆盖已批准的 `mode`、`owner`、`approvalOwnerOnly`、`approvalMembers` 字段。
3. 合并后必须继续执行现有 source-binding、一致性、token、过期和权限检查；不得创建第二套 arbiter。
4. overlay 不能提供或覆盖 `channel/accountId/userId/chatId/sessionId/policyVersion/expiresAt/revoked` 等来源字段。
5. resolver 缺失、返回非法数据或抛异常时必须 fail-closed，不得默认放行。
6. session 缺失或 overlay 缺失时保持现有个人模式默认策略。
7. approval、question、button、numbered reply、admin settle 的所有调用点必须传入同一 session 解析结果。
8. 增加 focused tests：overlay 生效、overlay 缺失、错误 session、resolver 异常、恶意来源字段、owner-only、成员审批、converse/group-control 不被意外打开、并发 pending 不串线。

完成标准：测试证明 overlay 实际改变授权结果，而不仅是持久化成功；任何绕过 Control Core 的路径都必须被拒绝。

### 阶段 2：管理台和个人用户体验收尾

重点文件：`src/admin/ui.mjs`、`src/admin/api.mjs`、`src/admin/server.mjs`、README/guide 相关文档及 admin 测试。

要求：

1. 审计 loading、empty、error、disabled、窄屏和危险操作确认状态。
2. 确保首次使用路径为：未配置 → 配对/登录 → 测试通知 → 正常运行。
3. 确保管理台入口能从启动输出、帮助或现有文档被发现，不要求用户先编辑 YAML。
4. 个人模式默认 `observe + approve`，`converse` 单独开启；不要暴露复杂团队 ACL 作为首次配置必填项。
5. `ask_user` 管理台结算必须经过 Control Core，并校验来源、token、权限、过期和重复提交。
6. UI/API 只返回脱敏摘要，不返回 owner、成员原始标识、token、secret 或 adapter 原文。
7. 复用现有 DSH 视觉和导航，不创建第二套控制台。
8. 增加 focused tests 覆盖所有状态和拒绝路径；不要为了测试重写 UI 架构。

### 阶段 3：插件安全 A3/A4

重点文件：`src/public.mjs`、`src/notify.mjs`、`src/index.mjs` 及 public/notify 测试。

#### A3：实例级资源控制

- 将 `sourceName` 当作不可信显示标签：trim、长度限制、控制字符处理；不能把它当身份认证。
- 在 facade 实例级增加调用次数、字节数、并发发送数、排队数的有界预算。
- 预算必须在分发/分配前检查；超限只拒绝当前调用，不影响其他渠道。
- 通过第二个 facade 或轮换 sourceName 不得绕过全局实例限制。

#### A4：冻结和收窄 facade

- 公共 facade 返回冻结对象，只暴露稳定的消费者操作。
- 不暴露 `dispose`、内部 store、凭证、可变实现对象或内部构造器。
- 保持现有 `push()` 返回值兼容；内部审计仍只走统一 onSend 链。
- 增加 `Object.isFrozen`、严格模式变更失败、dispose 幂等和跨实例隔离测试。

### 阶段 4：入站资源边界、callback 容量和异步安全（A5/P2-1）

重点文件：`src/inbound/`、`src/approval/`、`src/questions/`、callback reference/token/store 相关模块。

要求：

1. 对 envelope、字段、成员列表、callback data、审计记录设置已有风格的明确上限。
2. HTTP 请求、long polling、重连和等待动作必须有超时/有限退避；禁止无限热循环。
3. 去重缓存、callback reference、pending 表和队列必须有界。
4. callback reference 容量满时拒绝新引用，不能驱逐仍可能在使用的 live 引用；补充容量满测试。
5. callback freshness/nonce 在协议允许时校验；协议不确定时保持 fail-closed，不猜字段。
6. 回复限流按 `(channel,userId)` 隔离，不得用全局 userId。
7. 所有 race、promise、listener、重连异常必须被吸收并可观测；不能让未处理 rejection 退出宿主。
8. 渠道发送失败、图片/文件失败、删除失败不得阻断文本 fallback 或其他渠道。

### 阶段 5：插件导出面 A6

重点文件：包根入口、exports 相关源码和 contract/export 测试。

要求：

1. 盘点普通消费者可以访问的 exports。
2. 根入口只保留稳定插件契约；内部构造器、凭证处理器、store 只通过明确的内部测试/构建路径可见。
3. 不把此项描述成操作系统级隔离；同进程恶意插件风险继续记录为宿主边界。
4. 增加 package export smoke test 和 public API snapshot；同步 `PLUGINS.md`、CHANGELOG 和 risks。

### 阶段 6：兼容性和遗留配置

#### P2-2：旧 YAML `allowUsers`

- 先查调用方、README、迁移路径和现有测试。
- 不在没有迁移证据时删除兼容逻辑。
- 如不能安全删除，则进一步隔离并补迁移文档/警告测试；保持个人用户可用。

#### P2-3：可选 SDK 生命周期矩阵

- 仅做本地 seam/contract 测试：缺包提示、版本形状、reconnect、dispose、重复初始化、失败隔离。
- 不安装或依赖新的生产 SDK。
- 输出一个简洁矩阵文档，明确 `contract-tested` 与 `declared`，不声称真实平台支持。

#### WxPusher 多账号

- 检查 `src/inbound/wxpusher-callback.mjs` 及配置解析。
- 保持显式 `config.accountId` 优先；评估未配置时 `default` 的兼容行为。
- 只有能保持旧配置兼容且不扩大来源歧义时才改；否则记录为受控残留，不强行破坏用户配置。
- 增加两个账号、相同 userId、错误 accountId 的来源绑定测试。

### 阶段 7：发布包和文档收尾（不做真实设备）

1. 运行 `npm pack --dry-run --json`，确认包内包含运行所需源码、测试和文档且无凭证/状态文件。
2. 如本机没有 npm registry 权限，不要伪造“发布包已验收”；只记录 dry-run 结果和阻塞原因。
3. 更新 `CHANGELOG.md`、`HANDOFF.md`、`docs/memory/project-state.md`、`docs/memory/risks.md`、`docs/KNOWLEDGE_BASE.md` 和当前 workstream，只写本次实际事实。
4. 测试数量、版本、分支、commit 必须唯一且以最终命令结果为准；历史发布版 `0.8.6/909` 与当前未发布开发线分开写。
5. 所有未有真实协议证据的能力继续写 `declared` 或 `contract-tested`，不写 `real-device-verified`。

## 最终验证门

必须运行并记录：

```text
npm test
node scripts/verify-release.mjs
node scripts/gen-channel-matrix.mjs --check
node --check src/index.mjs
git diff --check
git status --short --branch
git log --oneline -12
```

同时运行所有本次改动涉及的 focused tests。任何失败必须修复或在 workstream 中明确记录，不得用旧报告结果替代。

## 交付与返工标准

- 逻辑改动按主题提交，工作树最终干净。
- workstream 标记 `done`，包含实际修改文件、测试、review、commit hash、残留风险和下一步。
- 最终报告必须区分：已实现、仅 contract-tested、仍 declared、外部/真机未做。
- 如果只增加测试而对应源码缺陷仍存在，视为未完成。
- 如果发现破坏性重构、猜协议字段、绕过 Control Core、放宽来源校验、伪造发布/真机证据，立即停止该子项并返工。
