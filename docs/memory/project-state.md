# Project State

Snapshot date: 2026-08-20 (Trae1 relay).

- Canonical development repository: private `https://github.com/THEWOLFWALKER/dsh-notifier-dev`.
- Public release/source mirror: `https://github.com/THEWOLFWALKER/dsh-notifier`.
- Branch topology (post-merge 2026-08-20, second merge): private `main` has merged the relay-prompt doc commits (`e576088`/`8ce3329`/`70a3a33`), Trae1's P1-1 protocol guards (`478b87d`, test contract 897), and Trae1's P1-2 error visibility (`fa96463`, merge `1a720ab`, test contract 902). `codex/plugin-security-hardening`, `codex/tech-debt-protocol-guards`, and `codex/tech-debt-error-visibility` are fully contained in `main` and retired as active lines.
- Active line: `main` (all relay work merged); new relay topics branch from `main` as `codex/<topic>`.
- Security hardening commits `bb03f8a` and `ce68543` (A1/A2) are part of `main` history.
- Canonical source commit: `3fc3f24` (`chore: import dsh-notifier v0.8.5 baseline`).
- Package version: `0.8.5` (unchanged; P1-1 and P1-2 fixes are recorded under CHANGELOG `[Unreleased]`).
- Test baseline: `902` total tests after the P1-2 error-visibility fixes (+5 on top of the 897 P1-1 contract). On `2026-08-20` the Linux relay host passed all; the earlier Windows validation passed `898` with 4 desktop adapter failures from the missing BurntToast/PowerShell capability.
- Engineering archive: source authority. Attached npm archive: release artifact only.
- Artifact observation: the two archives share source/tests/package metadata; `CHANGELOG.md` is the only common-file difference.
- Workspace policy: no `node_modules/`, `package-lock.json`, credentials, state files, or generated logs in Git.
- Release status at this snapshot: npm registry has released through `0.8.4`; `0.8.5` is the locally validated candidate and has not been published. npm authentication and the disposable-profile acceptance gate remain required. The public mirror's `main` has unrelated history; no public mainline migration is performed by relay setup.
- Relay tooling: the canonical neat-freak skill is tracked at `.agents/skills/neat-freak/`; Claude/Codex/OpenCode project skill paths contain pointers to it. Relay agents clone from the private remote and push back to it.
- Relay prompt: `docs/RELAY_BOOTSTRAP_PROMPT.md` is the copy-paste first message for every new agent; it requires identity-bearing workstream, adversarial review, consolidated `HANDOFF.md`, private push, and a clean tree.

## Validation Evidence

- `npm test` (Linux relay host, 2026-08-20): `902 pass`, `0 fail` — includes the 6 P1-1 protocol-shape tests and the 5 P1-2 error-visibility tests; the post-merge `main` baseline also passed 897/897 before P1-2.
- `node scripts/verify-release.mjs`: passed with documented tests = `902`.
- `node scripts/gen-channel-matrix.mjs --check`, `node --check src/index.mjs`, `git diff --check`: passed.

## Current Maintenance Direction

- No new user-facing features are planned for the current cycle. Work is limited to technical debt, bug elimination, protocol/host validation, and documentation truth.
- The ordered queue is `docs/TECHNICAL_DEBT.md`; P1-1 (Telegram card guards) and P1-2 (error visibility) are done locally and merged into `main`. Open: P1-1 real-device confirmation and long-connection lifecycle, P1-3 state stress, P1-4 admin UI audit, P0-2 registry acceptance (needs npm auth), A3-A6 security plan.

## Next Gate

Next release gate: authenticate npm, re-run the full validation and `npm pack --dry-run --json`, perform disposable-profile registry validation, then publish only after an explicit release decision. The 2026-08-20 relay sessions intentionally did not publish npm.
