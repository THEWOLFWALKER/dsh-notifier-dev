# Project State

Snapshot date: 2026-08-20.

- Canonical development repository: private `https://github.com/THEWOLFWALKER/dsh-notifier-dev`.
- Public release/source mirror: `https://github.com/THEWOLFWALKER/dsh-notifier`.
- Latest relay commit: `b0e6fbe` (`docs: establish relay handoff and project skill`).
- Active branch: `codex/plugin-security-hardening`; it contains the source baseline plus A1/A2 notifier security hardening commits `bb03f8a` and `ce68543`.
- Canonical source commit: `3fc3f24` (`chore: import dsh-notifier v0.8.5 baseline`).
- Package version: `0.8.5`.
- Test baseline: `891` total tests. On `2026-08-20` Windows validation, `887` passed and `4` desktop adapter tests failed because the environment could not provide the BurntToast/PowerShell desktop notification capability; non-desktop coverage passed.
- Engineering archive: source authority. Attached npm archive: release artifact only.
- Artifact observation: the two archives share source/tests/package metadata; `CHANGELOG.md` is the only common-file difference.
- Workspace policy: no `node_modules/`, `package-lock.json`, credentials, state files, or generated logs in Git.
- Release status at this snapshot: npm registry has released through `0.8.4`; `0.8.5` is the locally validated candidate and has not been published. npm authentication and the disposable-profile acceptance gate remain required. The public mirror's `main` has unrelated history; no public mainline migration is performed by relay setup.
- Relay tooling: the canonical neat-freak skill is tracked at `.agents/skills/neat-freak/`; Claude/Codex/OpenCode project skill paths contain pointers to it. The current local branch tracks the private remote; `origin` remains the public release mirror.

## Validation Evidence

- `npm test`: `887 pass`, `4 fail`, `891 total`; failures are limited to `test/desktop.test.mjs` and are an environment capability gap, not a source assertion regression.
- `node scripts/verify-release.mjs`: passed after the package file allowlist, 891-test documentation correction, and private repository setup.

## Current Maintenance Direction

- No new user-facing features are planned for the current cycle. Work is limited to technical debt, bug elimination, protocol/host validation, and documentation truth.
- The ordered queue is `docs/TECHNICAL_DEBT.md`; P0 release truth and artifact acceptance precede P1 protocol/error/concurrency work.

## Next Gate

Next release gate: authenticate npm, re-run the full validation and `npm pack --dry-run --json`, perform disposable-profile registry validation, then publish only after an explicit release decision. The 2026-08-20 setup session intentionally did not publish npm.
