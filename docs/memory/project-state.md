# Project State

Snapshot date: 2026-08-23 (ox-alpha relay, second round).

- Canonical development repository: private `https://github.com/THEWOLFWALKER/dsh-notifier-dev`.
- Public release/source mirror: `https://github.com/THEWOLFWALKER/dsh-notifier`.
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

## Current Maintenance Direction

- No new user-facing features are planned for the current cycle. Work is limited to technical debt, bug elimination, protocol/host validation, and documentation truth.
- The ordered queue is `docs/TECHNICAL_DEBT.md`; P1-1 (Telegram card guards), P1-2 (error visibility), and P1-3 (state stress) are done and merged into `main`. Open: P1-1 real-device confirmation and long-connection lifecycle, P1-4 admin UI audit, P0-2 registry acceptance (needs npm auth), A3-A6 security plan.

## Next Gate

Next release gate: authenticate npm, re-run the full validation and `npm pack --dry-run --json`, perform disposable-profile registry validation, then publish only after an explicit release decision. The 2026-08-23 relay session intentionally did not publish npm.
