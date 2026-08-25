# Task 00: CC-1 Test Migration

## Goal

Make the question suite agree with the implemented fail-closed `(channel,userId,chatId)` rule. Do not change runtime semantics.

## Start

```powershell
git status --short --branch
git log --oneline -5
git switch -c codex/task-00-cc1-tests
```

If the worktree is dirty, do not reset it. Read the diff and continue only if every change is a question-test migration. Otherwise stop and report conflicting paths.

## Allowed files

- `test/questions.test.mjs`
- `HANDOFF.md`, `CHANGELOG.md`, `.agents/workstreams/task-00-cc1-tests.md` for factual status only.

## Forbidden files

Do not edit `src/questions/router.mjs`, `src/inbound/*`, adapters, package version, or PR #12 code. Never reintroduce `hintChannels` as authorization evidence.

## Mechanical procedure

1. Run `node --test --test-name-pattern="CC-1|issue #11|SEC-2|CRACK-004" test/questions.test.mjs`.
2. Replace assertions expecting `row.hintChannels` authorization with `row.hintTargets` entries containing exact `channel`, `chatId`, and `userId`.
3. For a positive hint test, configure an inbound target for the same bound user and make `sendText` return `true`. A `notifyAll` result such as `{delivered:['qq']}` is never sufficient evidence for a chat.
4. For a negative test, make `sendText` return `false`, omit the target, use the wrong chat, or use an old row without `hintTargets`; assert no settlement and `answered:false`.
5. For alias tests (`qq-bot` outbound and `qq` inbound), either prove exact inbound `sendText` delivery or assert fail-closed. Never assert that a channel alias alone authorizes a reply.
6. Use valid provider-shaped ids (`qq-` plus at least eight characters, `oc_...` for Feishu, `wx...` for WeChat) so target guards do not hide the behavior.
7. Run `node --test test/questions.test.mjs`. If a case waits for the default 300s timeout, stop and inspect its fixture; do not increase the timeout or weaken the router.
8. Run `npm test`, `node scripts/verify-release.mjs`, `node scripts/gen-channel-matrix.mjs --check`, and `node --check src/index.mjs`.

## Review checklist

- No test reads `hintChannels` as permission.
- Every successful numbered reply has exact chat evidence or explicitly authorized owner hint.
- Wrong chat is consumed with original-chat feedback and does not resolve.
- Missing chat id, stale row, failed send, and cross-channel reply fail closed.

## Commit and handoff

```powershell
git add test/questions.test.mjs HANDOFF.md CHANGELOG.md .agents/workstreams/task-00-cc1-tests.md
git commit -m "test: migrate question fixtures to exact chat evidence"
git push private HEAD
```

Update the workstream with files, focused/full test results, real-device gaps, and commit SHA. Stop after this pack.
