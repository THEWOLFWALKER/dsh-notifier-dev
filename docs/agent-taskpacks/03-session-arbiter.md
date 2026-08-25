# Task 03: Session Policy and Command Arbiter

## Goal

Build the provider-neutral session policy and command precedence layer on top of `src/control/contract.mjs`. This task does not implement buttons, IM adapters, native cards, or `approval.parallel`.

## Start

```powershell
git status --short --branch
git log --oneline -5
git switch -c codex/task-03-session-arbiter
```

Read `docs/architecture-roadmap.md`, `src/control/contract.mjs`, `src/interaction/ledger.mjs`, `src/inbound/identity.mjs`, and `src/inbound/store.mjs` before editing.

## Allowed files

- one cohesive module under `src/control/` (for example `session-arbiter.mjs`);
- one focused test file under `test/`;
- this task's workstream, `HANDOFF.md`, `CHANGELOG.md`, and `docs/memory/risks.md` for factual updates.

Do not modify channel adapters, `src/questions/router.mjs`, `src/approval/router.mjs`, admin UI, package version, or public-release metadata.

## Fixed policy

Personal mode is the default:

```text
observe = true
approve = true
converse = false
group-chat-control = false
```

Team mode may expose member ACL fields, but the implementation must keep them internal and bounded. Only the owner may change workspace/session/policy settings. Formal paired members may approve within their scope unless policy explicitly says owner-only. Conversation remains a separate opt-in capability.

## Fixed command precedence

```text
stop > current question-answer > current approval > steer > ordinary-message
```

The arbiter chooses at most one command for a session event. A rejected, expired, stale-policy, wrong-source, or already-handled command must not fall through into a lower-priority command from the same event.

## Mechanical procedure

1. Define pure policy normalization. Unknown mode/capability values fall back to personal safe defaults; missing `policyVersion` is invalid for a remote command.
2. Define `canAccept(policy, event)` using exact `(channel, accountId, userId, chatId, sessionId, policyVersion)` binding. Missing chat or wildcard values reject.
3. Define `revoke(policy, reason)` and `isExpired(policy, now)`. Revocation must make later remote commands return `rejected` or `expired` without mutating the ledger.
4. Define `chooseCommand(candidates, context)` using the fixed precedence. Candidates from desktop and mobile are compared by validity and creation time; first valid settlement wins, and later events receive `already_handled`.
5. Make dispose idempotent. After dispose, every command returns `desktop_fallback` and no callback is invoked.
6. Keep audit output bounded and secret-free: event id, session id, source, channel, status, reason, and timestamp only. Never record token or message content.
7. Add focused tests for personal defaults, team fields, owner-only mutation, scoped member approval, conversation/group defaults, desktop/mobile race, precedence, policy mismatch/revoke, wrong source, expiry, restart, duplicate settlement, dispose, and callback exceptions.
8. Run focused tests, then `npm test`, `node scripts/verify-release.mjs`, `node scripts/gen-channel-matrix.mjs --check`, and `node --check src/index.mjs`.

## Review gates

- No provider-specific imports or payloads.
- No global user-id or wildcard-chat matching.
- No silent approval on exception, timeout, stale policy, or missing metadata.
- One event settles once; precedence cannot be bypassed by registration order.
- Existing approval/questions/actions tests remain green.

## Commit and handoff

```powershell
git add src/control test HANDOFF.md CHANGELOG.md docs/memory/risks.md .agents/workstreams/task-03-session-arbiter.md
git commit -m "feat: add provider-neutral session command arbiter"
git push private HEAD
```

Stop after this pack. The next agent may begin admin UX only after this commit is independently reviewed.
