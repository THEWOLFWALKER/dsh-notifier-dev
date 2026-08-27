# Project State

Snapshot date: 2026-08-27 (current development line after protocol-adaptation security closure on `codex/stage5-wechat-ilink-hardening`).

Planning decision (2026-08-25): after the current maintenance batch, the product direction is a personal-mode-first cross-IM control plane. The approved staged architecture and channel plan live in `docs/architecture-roadmap.md`; this does not mean those features are implemented or released.

- Canonical development repository: private `https://github.com/THEWOLFWALKER/dsh-notifier-dev`.
- Public release/source mirror: `https://github.com/THEWOLFWALKER/dsh-notifier`.
- Branch topology (2026-08-27): current development line `codex/stage5-wechat-ilink-hardening` includes the protocol-preflight evidence (docs/protocol-preflight/) plus this session's code-layer adaptation: (1) WxPusher inbound now injects a local `accountId` (config.accountId / literal 'default'), fixing WxPusher approval/question numbered replies that were silently non-settling after source-binding hardening; (2) the channel-as-accountId fallbacks were removed from the conversation route and `pendingMeta`, and `actions.dispatch` now forwards the transport's local accountId into Control Core; (3) Telegram/Feishu direct button callbacks now pass the provider's real eventId into Control Core (missing_eventId was rejecting every wired button callback); (4) questions numbered-reply missing-chatId consumption now carries accountId, and answered feedback reads labels from the ledger row. Regression suites were re-synced to the always-wired Control Core contract.
- Current test baseline: **1352** total (1351 pass + 1 skip). The published v0.8.6 contract remains **909**; package/version stays `0.8.6`, and this development line is unreleased.
- Compatibility closure (2026-08-27): P2-2 `allowUsers` is retained as a one-shot, composite-key migration (`inbound:migrated`) and documented; P2-3 optional Feishu/QQ SDK seams and lifecycle behavior are contract-tested only in `docs/compatibility-matrix.md`. WxPusher omitted `accountId` remains a documented shared-`default` residual for multi-app deployments.
- QQ C2C single-chat native buttons and QQ GROUP text fallback are contract-tested. Missing `chatType` or unknown source metadata fail closed, and the conversation `routeUnsafe` bypass is blocked. QQ, WeChat iLink, and DingTalk image paths are wired and contract-tested; real provider/device and host protocol evidence is still absent. Web/admin now has a safe reusable `ask_user` settlement entry through Control Core; desktop still has none, so dual-end sharing is not claimed.
- Earlier snapshot (2026-08-23, ox-alpha relay, second round):
- Branch topology (post-merge 2026-08-23): private `main` = `52c467a`, the no-ff merge of `codex/p1-3-state-stress` (P1-3 crash-stale-lock recovery, contract 902 → 906). All prior relay lines (security-hardening, protocol-guards, error-visibility) and the P1-3 branch are contained in `main` and retired.
- Active line: `main` (all relay work merged); new relay topics branch from `main` as `codex/<topic>`.
- Security hardening commits `bb03f8a` and `ce68543` (A1/A2) are part of `main` history.
- Canonical source commit: `3fc3f24` (`chore: import dsh-notifier v0.8.5 baseline`).
- Historical release baseline: published v0.8.6 retained `909` tests (the earlier v0.8.5 relay added issue-#11 coverage; prior Windows 898/902-era desktop gap remains historical evidence only).
- Engineering archive: source authority. Attached npm archive: release artifact only.
- Workspace policy: no `node_modules/`, `package-lock.json`, credentials, state files, or generated logs in Git.
- Release status at this snapshot: private `main` has cut release candidate `v0.8.6` on branch `codex/release-v0.8.6`. It supersedes the public mirror's npm `v0.8.5` (issue #11 only) by also including PR #9 and the P1-1/P1-2/P1-3 private-line fixes. npm authentication, full validation, and `npm pack --dry-run` have been re-run; the candidate awaits explicit user confirmation before merging to `main` and `npm publish`. The public mirror's `main` has unrelated history; no public mainline migration is performed.
- Relay tooling: the canonical neat-freak skill is tracked at `.agents/skills/neat-freak/`; Claude/Codex/OpenCode project skill paths contain pointers to it. Relay agents clone from the private remote and push back to it.
- Relay prompt: `docs/RELAY_BOOTSTRAP_PROMPT.md` is the copy-paste first message for every new agent; it requires identity-bearing workstream, adversarial review, consolidated `HANDOFF.md`, private push, and a clean tree.
- Mirror-relay note (2026-08-23): the public mirror's `main` (`20bfff9`) published npm `v0.8.5` from `74e5d54` (issue #11 fix only) and later merged PR #9 (`cbaab26`) without releasing it. The two mains have unrelated history — sync by content cherry-pick only, never git merge, and never bring in the mirror's committed `node_modules/` / `package-lock.json`.

## Validation Evidence

- `npm test` (current development line, 2026-08-27): `1352 total` = `1351 pass + 1 skip`.
- `node scripts/verify-release.mjs`: passed with documented tests = `909`.
- `node scripts/verify-release.mjs`, `node scripts/gen-channel-matrix.mjs --check`, and `node --check src/index.mjs` remain release/shape checks against the published v0.8.6 count of 909; the development count must not alter `package.json`.

## Current Maintenance Direction

- The active coding cycle has completed the bounded team-mode approval-membership contract (`approvalMembers` + `canSettleApproval`) and the Web/admin `ask_user` settlement slice at code/contract level; the next implementation work remains the staged cross-IM control-plane roadmap, while real-device/protocol validation is tracked separately and must not block code progress.
- The ordered queue is `docs/TECHNICAL_DEBT.md`; P1-1 (Telegram card guards), P1-2 (error visibility), and P1-3 (state stress) are done and merged into `main`. Public facade A3/A4 budgets/freeze and package export narrowing are contract-tested on 2026-08-27; callback-reference capacity and per-(channel,userId) reply throttling are now fail-closed and bounded. Remaining gaps are real-device confirmation, long-connection lifecycle, and host-level plugin isolation; no OS boundary is implied.

## Next Gate

Next release gate: authenticate npm, re-run the full validation and `npm pack --dry-run --json`, perform disposable-profile registry validation, then publish only after an explicit release decision. The 2026-08-23 relay session intentionally did not publish npm.
