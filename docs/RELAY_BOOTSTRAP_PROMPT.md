# 全新环境接力开发提示词

下面这段就是你在 Claude Code、Codex、Trae、Cursor 或其他开发工具的全新环境中发出的第一条消息：

```text
你是 dsh-notifier 项目的接力开发 agent。当前是一个全新的开发环境，请严格执行下面的接管流程，不要跳过检查，也不要先写代码。

先不要写代码。先确认当前目录是正确仓库，然后执行：

1. git status --short --branch
2. git log --oneline -5
3. git fetch --prune
4. git pull --ff-only

本项目规则：

- 私有仓库 dsh-notifier-dev 是唯一开发协作真相。
- 公共仓库 THEWOLFWALKER/dsh-notifier 只用于发布/公开源码，不作为日常开发工作区。
- 先读 AGENTS.md、docs/KNOWLEDGE_BASE.md、docs/memory/README.md、docs/memory/、相关 .agents/workstreams/ 和 HANDOFF.md。
- 运行行为以 src/ 和 test/ 为准；package.json 是版本真相；聊天记录不是项目状态。
- 每个任务先写计划，再实现，再做对抗性 review，再修订，再跑聚焦测试和完整验证。
- 每个任务先创建或接管一个 .agents/workstreams/<topic>.md，并记录 agent 身份、工具/模型、机器/环境、范围、文件、验证、review、风险、下一步和状态。
- 不直接在 main/master 上开发；使用 codex/<topic> 分支。
- 不要使用 stash、压缩包或编辑器本地历史作为跨机器同步方式。

完成任务或暂时离开本机前：

1. 更新 workstream 状态和详细交接说明，必须包含你的身份、模型/工具、机器、文件、测试、review、风险、下一步和最后 commit SHA。
2. 运行必要测试；发布相关改动还要运行 npm test、node scripts/verify-release.mjs、node scripts/gen-channel-matrix.mjs --check、node --check src/index.mjs、git diff --check。
3. 更新 HANDOFF.md 的当前交接快照，给下一个 agent 一个明确交代；不要追加聊天流水账。
4. 提交一个逻辑清晰的 commit；未完成可提交 wip: commit。
5. git push，并确认 git status --short --branch 干净。
6. 读取并执行 .agents/skills/neat-freak/SKILL.md，检查文档、记忆、workstream、版本和链接是否同步。

HANDOFF.md 每次 agent 完成接力都要更新当前快照；小修改也要留下交代，但应整理替换快照，不要堆叠历史流水账。

最终回复只报告：完成内容、最后 commit SHA、测试结果、已知失败、下一步和是否已 push。
```
