# Task 02: Control Contract Compatibility Facade

## Goal

Define a small, tested event/receipt contract for desktop and mobile control. Do not add an IM adapter, UI, QQ button, question card, or parallel approval mode.

## Start

```powershell
git status --short --branch
git log --oneline -5
git switch -c codex/task-02-control-contract
```

Read `docs/architecture.md`, `docs/architecture-roadmap.md`, `src/interaction/ledger.mjs`, `src/inbound/bus.mjs`, `src/approval/router.mjs`, and their focused tests.

## Contract

Every event contains non-empty normalized `eventId`, `sessionId`, `source`, `channel`, `accountId`, `userId`, `chatId`, `policyVersion`, `command`, `createdAt`, and `expiresAt`.

Allowed commands: `stop`, `question-answer`, `approval`, `steer`, `ordinary-message`.

Allowed receipts: `accepted`, `rejected`, `expired`, `already_handled`, `transport_failed`, `desktop_fallback`.

## Mechanical procedure

1. Add one cohesive module under `src/control/` and one focused test file. Reuse existing ledger and bus; do not duplicate settlement logic.
   Implementation note: the facade may be callback-based (`getPending`, `settle`, `onAudit`) so this pack remains transport-agnostic; do not import provider adapters or mutate existing ledger keys.
2. Implement pure `normalizeControlEvent(input, now)`. Reject missing fields, unknown commands, invalid timestamps, expired events, and non-string identifiers. An absent chat id is never a wildcard.
3. Implement pure `makeReceipt(status, event, reason)`. Never include token, secret, authorization header, or full message content.
4. Implement a compatibility facade that accepts the normalized event and delegates to existing bus/ledger contracts without changing unrelated store keys.
5. Enforce source binding: channel, account, user, chat, session, and policy version must match the pending record. Mismatch returns `rejected`.
6. Enforce expiry before state mutation. Duplicate event ids return `already_handled` and never call the setter twice.
7. Enforce first-valid-wins. Later valid events after settlement return `already_handled`.
8. Catch store, ledger, and handler exceptions and return `desktop_fallback`; exceptions never approve.
9. Add tests for malformed, duplicate, replay, out-of-order, expired, wrong source/chat, stale policy, first-valid-wins, restart, store failure, and thrown handler.
10. Run focused tests, then `npm test`, `node scripts/verify-release.mjs`, `node scripts/gen-channel-matrix.mjs --check`, and `node --check src/index.mjs`.

## Non-goals

No `approval.parallel`, precedence arbiter, provider payload, WebSocket/HTTP work, or real-device claim.

## Review checklist

- No wildcard chat matching or global user matching.
- Receipt is deterministic and secret-free.
- Existing question/approval behavior is unchanged outside the facade.
- Every rejection path is tested and fail closed.

## Commit and handoff

```powershell
git add src/control test/control docs/architecture-roadmap.md .agents/workstreams/task-02-control-contract.md
git commit -m "feat: add normalized control event compatibility contract"
git push private HEAD
```

Stop before implementing session policy, arbitration, or channel-specific UI.
