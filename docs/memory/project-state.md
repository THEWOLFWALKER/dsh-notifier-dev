# Project State

Snapshot date: 2026-08-25 (maintenance-architecture line, maintenance batch 6-C done).

Planning decision (2026-08-25): after the current maintenance batch, the product direction is a personal-mode-first cross-IM control plane. The approved staged architecture and channel plan live in `docs/architecture-roadmap.md`; this does not mean those features are implemented or released.

- Canonical development repository: private `https://github.com/THEWOLFWALKER/dsh-notifier-dev`.
- Public release/source mirror: `https://github.com/THEWOLFWALKER/dsh-notifier`.
- Branch topology (2026-08-25, re-verified against git): private `main` = `37f2ec7` — the v0.8.6 release (`bf03a1c`) plus the crack-fix v0.8.7 batches A/B/C (contract 1012); all relay lines (security-hardening, protocol-guards, error-visibility, P1-3, crack-fix) are contained in `main` and retired. Active line: `codex/maintenance-architecture` (unmerged, unreleased, `main` + 23 commits, fast-forward-mergeable) — maintenance batches 1..5 + 6-A/6-B/6-C complete, contract **1111** (1110 pass + 1 win32 skip) at HEAD `9ae636b` (docs closure `2a59ed5`). Batch 5 added `src/inbound/message.mjs` unified inbound text/image/file structure + `parseQQImageMessage` interface (NOT wired into qq-gw — no protocol evidence yet). Batch 6-A (Issue #10) reworked Dashboard onboarding; 6-B pinned QQ RESUME/ACK behavior; 6-C scoped question escalation reminders to exact inbound targets and rejected failed hint delivery. Plan/workstream in `.agents/workstreams/maintenance-architecture.md`. Residual-test batch `codex/hint-scope-regression` (2026-08-25) pinned the channel-level hint/evidence ambiguity with 3 regression tests (contract 1111 → 1114); behavior unchanged.
- Earlier snapshot (2026-08-23, ox-alpha relay, second round):
- Branch topology (post-merge 2026-08-23): private `main` = `52c467a`, the no-ff merge of `codex/p1-3-state-stress` (P1-3 crash-stale-lock recovery, contract 902 → 906). All prior relay lines (security-hardening, protocol-guards, error-visibility) and the P1-3 branch are contained in `main` and retired.
- Active line: `main` (all relay work merged); new relay topics branch from `main` as `codex/<topic>`.
- Security hardening commits `bb03f8a` and `ce68543` (A1/A2) are part of `main` history.
- Canonical source commit: `3fc3f24` (`chore: import dsh-notifier v0.8.5 baseline`).
- Test baseline: `909` total tests after relaying the public mirror's v0.8.5 content into the private line (+3 issue-#11 question-reply tests on top of the 906 contract; the P1-3 lock tests added +4 on top of 902). On `2026-08-23` the Linux relay host passed all `909`; the earlier Windows validation passed `898` (902-contract era) with 4 desktop adapter failures from the missing BurntToast/PowerShell capability.
- Engineering archive: source authority. Attached npm archive: release artifact only.
- Workspace policy: no `node_modules/`, `package-lock.json`, credentials, state files, or generated logs in Git.
- Release status at this snapshot: private `main` has cut release candidate `v0.8.6` on branch `codex/release-v0.8.6`. It supersedes the public mirror's npm `v0.8.5` (issue #11 only) by also including PR #9 and the P1-1/P1-2/P1-3 private-line fixes. npm authentication, full validation, and `npm pack --dry-run` have been re-run; the candidate awaits explicit user confirmation before merging to `main` and `npm publish`. The public mirror's `main` has unrelated history; no public mainline migration is performed.
- Relay tooling: the canonical neat-freak skill is tracked at `.agents/skills/neat-freak/`; Claude/Codex/OpenCode project skill paths contain pointers to it. Relay agents clone from the private remote and push back to it.
- Relay prompt: `docs/RELAY_BOOTSTRAP_PROMPT.md` is the copy-paste first message for every new agent; it requires identity-bearing workstream, adversarial review, consolidated `HANDOFF.md`, private push, and a clean tree.
- Mirror-relay note (2026-08-23): the public mirror's `main` (`20bfff9`) published npm `v0.8.5` from `74e5d54` (issue #11 fix only) and later merged PR #9 (`cbaab26`) without releasing it. The two mains have unrelated history — sync by content cherry-pick only, never git merge, and never bring in the mirror's committed `node_modules/` / `package-lock.json`.

## Validation Evidence

- `npm test` (Linux relay host, 2026-08-23): `909 pass`, `0 fail` — includes the 6 P1-1 protocol-shape tests, 5 P1-2 error-visibility tests, 4 P1-3 lock-recovery tests, and 3 issue-#11 question-reply tests.
- `node scripts/verify-release.mjs`: passed with documented tests = `909`.
- In-flight branch `codex/maintenance-architecture` (2026-08-25): `node --test test/*.test.mjs test/*.spec.mjs` reports **1111** tests (1110 pass + 1 win32 skip) at HEAD `9ae636b`. The documented release count stays at `909` until a version is cut on this line, so `verify-release.mjs` is checked against the released v0.8.6 contract, not the branch count. The crack-fix v0.8.7 line (batch A+B+C, contract 1012) is contained in `main` (`37f2ec7`) and in this branch's history.
- Residual-test branch `codex/hint-scope-regression` (2026-08-25, test-only): **1114** tests (Linux host: 1114 pass; win32: 1113 pass + 1 skip) — baseline 1111 + 3 channel-level hint/evidence ambiguity pins in `test/questions.test.mjs`. Zero production code changed.

## Current Maintenance Direction

- The active coding cycle remains maintenance-only: technical debt, bug elimination, protocol/host validation, and documentation truth. The control-plane roadmap is a separate future implementation plan and must not be silently mixed into this maintenance branch.
- The ordered queue is `docs/TECHNICAL_DEBT.md`; P1-1 (Telegram card guards), P1-2 (error visibility), and P1-3 (state stress) are done and merged into `main`. Open: P1-1 real-device confirmation and long-connection lifecycle, P1-4 admin UI audit, P0-2 registry acceptance (needs npm auth), A3-A6 security plan.

## Next Gate

Next release gate: authenticate npm, re-run the full validation and `npm pack --dry-run --json`, perform disposable-profile registry validation, then publish only after an explicit release decision. The 2026-08-23 relay session intentionally did not publish npm.
