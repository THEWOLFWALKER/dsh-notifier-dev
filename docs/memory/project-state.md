# Project State

Snapshot date: 2026-08-20 (Trae1 relay).

- Canonical development repository: private `https://github.com/THEWOLFWALKER/dsh-notifier-dev`.
- Public release/source mirror: `https://github.com/THEWOLFWALKER/dsh-notifier`.
- Private `main` head at relay start: `14563f0` (`docs: index project relay skill`); `codex/plugin-security-hardening` sits at `70a3a33` (= main + three relay-prompt doc commits, not merged back). Trae1's P1-1 work is on `codex/tech-debt-protocol-guards` branched from main (commit recorded in that workstream).
- Active branch: `codex/plugin-security-hardening`; it contains the source baseline plus A1/A2 notifier security hardening commits `bb03f8a` and `ce68543`.
- Canonical source commit: `3fc3f24` (`chore: import dsh-notifier v0.8.5 baseline`).
- Package version: `0.8.5` (unchanged; P1-1 fix is recorded under CHANGELOG `[Unreleased]`).
- Test baseline: `897` total tests after the P1-1 protocol guards (+6). On `2026-08-20` the Linux relay host passed all `897`; the earlier Windows validation passed `893` with 4 desktop adapter failures from the missing BurntToast/PowerShell capability.
- Engineering archive: source authority. Attached npm archive: release artifact only.
- Artifact observation: the two archives share source/tests/package metadata; `CHANGELOG.md` is the only common-file difference.
- Workspace policy: no `node_modules/`, `package-lock.json`, credentials, state files, or generated logs in Git.
- Release status at this snapshot: npm registry has released through `0.8.4`; `0.8.5` is the locally validated candidate and has not been published. npm authentication and the disposable-profile acceptance gate remain required. The public mirror's `main` has unrelated history; no public mainline migration is performed by relay setup.
- Relay tooling: the canonical neat-freak skill is tracked at `.agents/skills/neat-freak/`; Claude/Codex/OpenCode project skill paths contain pointers to it. Relay agents clone from the private remote and push back to it.

## Validation Evidence

- `npm test` (Linux relay host, 2026-08-20): `897 pass`, `0 fail` — includes the 6 new P1-1 protocol-shape tests.
- `node scripts/verify-release.mjs`: passed with documented tests = `897`.
- `node scripts/gen-channel-matrix.mjs --check`, `node --check src/index.mjs`, `git diff --check`: passed.

## Current Maintenance Direction

- No new user-facing features are planned for the current cycle. Work is limited to technical debt, bug elimination, protocol/host validation, and documentation truth.
- The ordered queue is `docs/TECHNICAL_DEBT.md`; P1-1 Telegram card guards are landed, its real-device confirmation and the remaining P1/P0 items are open.

## Next Gate

Next release gate: authenticate npm, re-run the full validation and `npm pack --dry-run --json`, perform disposable-profile registry validation, then publish only after an explicit release decision. The 2026-08-20 relay sessions intentionally did not publish npm.
