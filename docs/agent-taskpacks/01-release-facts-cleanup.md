# Task 01: Release and Review Facts Cleanup

## Goal

Create one accurate maintenance snapshot. Documentation only; no runtime behavior changes.

## Start

```powershell
git status --short --branch
git log --oneline -10
git switch -c codex/task-01-release-facts
```

Read `HANDOFF.md`, `CHANGELOG.md`, `docs/KNOWLEDGE_BASE.md`, `docs/memory/project-state.md`, `docs/memory/risks.md`, and `.agents/workstreams/pr12-review-batch6.md` before editing.

## Required facts

- PR #12 is reference material only; do not cherry-pick it.
- QQ native buttons, question cards, and `approval.parallel` wait for Tasks 02 and 03.
- CC-1 exact-chat question isolation is implemented; provider/device support is not claimed.
- Public `dsh-notifier` must not be pushed, merged, or released in this task.
- Private `dsh-notifier-dev` is the canonical relay.
- Group-chat control is disabled by default; sensitive approvals should use a private chat.

## Mechanical procedure

1. Query `gh issue list --repo THEWOLFWALKER/dsh-notifier --state all --limit 20` and `gh pr list --repo THEWOLFWALKER/dsh-notifier --state all --limit 20`. If network fails, record the raw error and do not invent status.
2. For the latest three issues and relevant PR, record number, title, state, and whether the private tree has a corresponding test/fix.
3. Remove stale statements saying channel-level `hintChannels` authorizes replies. Use exact `hintTargets` wording.
4. Reconcile version, release-test count, and planned-versus-shipped wording across `HANDOFF.md`, `CHANGELOG.md`, `docs/KNOWLEDGE_BASE.md`, and memory.
5. Rewrite existing snapshot sections in place; do not append chat transcripts.
6. Run `npm test` and `node scripts/verify-release.mjs`; never claim a gate passed if it did not.

## Forbidden

No source edits, version bump, public push, release tag, or cherry-pick.

## Commit and handoff

```powershell
git add HANDOFF.md CHANGELOG.md docs/KNOWLEDGE_BASE.md docs/memory .agents/workstreams/task-01-release-facts.md
git commit -m "docs: reconcile maintenance and PR review facts"
git push private HEAD
```

Stop and report any contradiction requiring a product decision instead of guessing.
