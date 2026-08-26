# Task 05: WeChat iLink Single-Account QR-First

## Goal

Make the existing WeChat iLink adapter usable from the first-run console as a single personal account, while preserving fail-closed transport behavior. iLink is undocumented and changeable; do not claim official support or real-device validation from mocks.

## Start

```powershell
git status --short --branch
git log --oneline -5
git switch -c codex/task-05-wechat-ilink
```

Read `src/inbound/wechat-ilink.mjs`, `src/inbound/capability-matrix.mjs`, `src/inbound/pairing.mjs`, `src/admin/api.mjs`, `src/admin/ui.mjs`, `docs/test-notes/WECHAT-TEST.md`, and `docs/memory/risks.md`.

## Allowed files

- `src/inbound/wechat-ilink.mjs` and one small protocol helper under `src/inbound/` if needed;
- existing QR/login admin wiring only where required to close the first-run path;
- focused WeChat/admin tests, capability metadata, docs, workstream, HANDOFF, CHANGELOG.

Do not add a second WeChat SDK, do not add a runtime dependency, do not implement multi-account UI, and do not modify Feishu/Telegram/QQ adapters.

## Fixed product scope

- One paired personal account in the first release.
- Internal state keys remain account-scoped so future accounts cannot cross-contaminate credentials, cursors, context tokens, or identity.
- QR pairing is the primary path; manual YAML/CLI login is an advanced fallback.
- `observe` and `approve` are available after pairing; conversation remains opt-in and group-chat control stays disabled.
- Provider capability must be reported as `declared`, `contract-tested`, or `real-device-verified`; mocks never set the last state.

## Mechanical procedure

1. Inventory the current iLink request shapes, store keys, breaker, cursor, context-token cache, login/expiry transitions, and admin scan endpoint in the workstream.
2. Separate pure protocol normalization from transport: QR response, update batch/cursor, inbound text/media envelope, send result, and session-expired result.
3. Enforce bounded long-polling: one in-flight poll, provider timeout, reconnect backoff, stop/dispose cancellation, and no tight retry loop.
4. Persist the cursor atomically through the existing store. Missing/corrupt/rewound cursor must fail closed against replay and recover by the documented safe reset path.
5. On session expiry, clear only the iLink account/cursor/context state that is invalid, mark the channel disconnected, and expose a re-scan action. Do not delete unrelated channels or identity rows.
6. Keep context tokens bounded and validated; invalid/oversized/control-character tokens are rejected and the message still follows the no-token send fallback.
7. Preserve text and numbered control fallback. Image/media support may be represented as an explicit unsupported capability unless the existing parser has real protocol evidence; do not silently drop an inbound image.
8. Add tests for QR success/expiry/retry, duplicate polling, cursor persistence/recovery, session expiry, reconnect/backoff/dispose, malformed payloads, context-token bounds, send retry without token, single-account isolation, and adapter failure isolation.
9. Add an admin test proving the QR-first path exposes actionable status and retry without showing secrets.
10. Run focused tests plus:

```powershell
npm test
node scripts/verify-release.mjs
node scripts/gen-channel-matrix.mjs --check
node --check src/index.mjs
```

## Review gates

- No wildcard identity or account matching.
- No credential/token in logs, DOM, receipts, or API responses.
- No startup failure when iLink is unavailable.
- No cursor advancement before a batch is durably accepted.
- No unbounded polling, timers, maps, or retries.
- Capability metadata does not claim real-device support.
- Public repository is not pushed.

## Commit and handoff

```powershell
git add src/inbound/wechat-ilink.mjs src/inbound test docs/test-notes/WECHAT-TEST.md docs/memory/risks.md HANDOFF.md CHANGELOG.md .agents/workstreams/task-05-wechat-ilink.md
git commit -m "feat: harden single-account WeChat iLink control path"
git push private HEAD
```

Stop after this pack. Feishu/Telegram and PR #12 rewrites are separate batches.
