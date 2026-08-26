# Task 06: Team Permission Contract Integration

## Goal

Complete the provider-neutral team-mode permission contract on top of the existing
`src/control/session-arbiter.mjs` and `src/control/entry.mjs`. This slice must make
formal member approval scope explicit and bounded without changing any IM transport,
native card, Web/admin UI, or release version.

This is code/contract work only. Do not perform real-device validation and do not
claim `officially-supported` or `real-device-verified`.

## Current invariants to preserve

- Personal mode is the default: `observe=true`, `approve=true`, `stop=true`,
  `converse=false`, `groupChatControl=false`.
- Conversation remains separately opt-in; it must never be enabled by team mode alone.
- QQ group/unknown chat controls remain fail-closed.
- Every accepted control event keeps exact `(channel, accountId, userId, chatId,
  sessionId, policyVersion)` binding and a non-empty `eventId`.
- Timeout, expiry, stale policy, revoked policy, malformed scope, wrong source,
  duplicate event, or callback exception must not settle anything or fall through.
- `approval.parallel` is untouched and remains disabled by default.

## Design to implement

1. Extend the pure normalized session policy with a bounded optional
   `approvalMembers` list. Each entry is an object:

   ```js
   { channel: string, accountId: string, userId: string }
   ```

   Normalize by trimming strings, rejecting missing fields, dropping malformed
   entries, de-duplicating exact triples, and capping the list at 64 entries. Do not
   accept wildcard, empty, global user IDs, arbitrary nested objects, or unbounded
   arrays. Unknown policy fields remain ignored.

2. Add one pure helper (exported for tests) that decides whether a normalized event
   is allowed to approve/question-answer under the policy:

   - `approvalOwnerOnly=true`: only `policy.owner` may settle.
   - In `mode='team'` with a non-empty `approvalMembers`, the event's exact
     `(channel, accountId, userId)` triple must be listed, unless it is the owner.
   - In personal mode, or team mode with no explicit list, retain existing exact
     source behavior; do not accidentally make personal users configure ACLs.
   - Apply the rule to both `approval` and `question-answer`; it must not grant
     `steer`/`ordinary-message`.

3. Wire this helper into `canAcceptCommand()` / the existing Control Core path only.
   Do not add a second authorization path in an adapter. Keep `paired(identity,event)`
   as a separate admission check and keep group-chat checks unchanged.

4. Ensure all policy data used by a callback is the normalized snapshot associated
   with that pending row/event. A stale `policyVersion` or mismatched scope must be
   rejected before invoking `onSettle`.

## Allowed files

- `src/control/session-arbiter.mjs`
- `src/control/entry.mjs` only if a minimal call-site adjustment is strictly needed
- `test/session-arbiter.test.mjs`
- `test/control-entry.integration.test.mjs` only for integration coverage
- this taskpack, `HANDOFF.md`, `CHANGELOG.md`, `docs/memory/risks.md`

Do not touch `src/inbound/`, `src/channels/`, `src/admin/`, `src/approval/`,
`src/questions/`, `package.json`, or public-release metadata.

## Required tests

- personal defaults still pass without `approvalMembers`;
- team member exact triple accepted;
- wrong channel, account, or user rejected;
- owner accepted even when listed members omit the owner;
- owner-only rejects a listed member for both `approval` and `question-answer`;
- malformed/wildcard/over-cap member lists normalize safely and never throw;
- `converse` remains disabled unless explicitly true;
- stale policy, expiry, revoke, duplicate event, group chat, and callback throw remain
  fail-closed with zero callback/ledger mutation;
- existing full suite remains green.

## Validation and handoff

Run focused tests first, then:

```powershell
npm test
node scripts/verify-release.mjs
node scripts/gen-channel-matrix.mjs --check
node --check src/control/session-arbiter.mjs
node --check src/control/entry.mjs
git diff --check
```

Record the exact commit, test totals, and real-device gap in the task workstream and
`HANDOFF.md`. Commit one logical concern only. Push only to the private `private`
remote when connectivity works; never push `origin`.

Stop after this task. The next slice may persist policy/owner management through the
existing session registry and loopback admin API only after this contract is reviewed.
