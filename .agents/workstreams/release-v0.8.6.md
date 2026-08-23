# Workstream: release-v0.8.6

- Agent identity: `ox-alpha / span/ox-alpha / Linux sandbox x64 (root, Node v22.23.2, kernel 6.8.0-136-generic)`
- Branch: `codex/release-v0.8.6`
- Status: `active` (release candidate prepared, awaiting user confirmation before merge + npm publish)
- Scope: Resolve public/private version split, audit mirror issues/PRs, run neat-freak, and prepare a release-ready `v0.8.6` that supersedes the public mirror's npm `v0.8.5`.

## Audit findings

1. **Mirror divergence**: private main is ahead in docs/infrastructure/P1 work; public mirror only has issue #11 + PR #9 as new content since its prior release.
2. **Fix parity**: issue #11 and PR #9 were already cherry-picked into private main (`4a1b8f7`, `5e42768`). No additional source changes from the mirror need porting.
3. **Open issues on mirror**: #1/#2/#4/#6/#11 are already fixed in private main; #3/#5/#7/#10/#12 are feature/support/marketing items and are out of scope for the current maintenance cycle.
4. **Neat-freak**: counts/version consistent at 909; stale remote branches deleted; package.json/admin UI/CHANGELOG need version bump for new release.

## Release-prep commits

- `196e14e` — `chore(release): prepare v0.8.6`:
  - `package.json` version `0.8.6`
  - `src/admin/ui.mjs` HTML version `v0.8.6`
  - `CHANGELOG.md` cut `[Unreleased]` → `[0.8.6] - 2026-08-23` + new empty `[Unreleased]`
  - `HANDOFF.md` + `docs/memory/project-state.md` updated to rc state

## Validation

- `npm test`: **909/909 pass**, 0 fail (66.9s)
- `node scripts/verify-release.mjs`: `release guard ok: dsh-notifier v0.8.6, documented tests=909`
- `node scripts/gen-channel-matrix.mjs --check`: OK, 27 channels
- `node --check` on `src/index.mjs`, `src/admin/ui.mjs`, `src/admin/server.mjs`: OK
- `git diff --check`: OK
- `npm pack --dry-run --json`: 144 files, 528314 bytes; all required docs in package.

## Next step

Await explicit user confirmation, then:
1. no-ff merge `codex/release-v0.8.6` → `main`
2. authenticate npm and run disposable-profile acceptance (optional but recommended)
3. `npm publish` to override/supersede public mirror `v0.8.5`
4. Tag `v0.8.6` on the merge commit
5. Retire this workstream to `done`
