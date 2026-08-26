# Workstream: stage5-wechat-ilink-hardening

- Agent identity: Provider-slice hardener | Claude Code (claude-fable-5) | shared Windows workspace
- Agent: `stage5-wechat-ilink-slice`
- Branch: `codex/stage5-wechat-ilink-hardening`
- Status: done
- Start/end: `2026-08-26 -> 2026-08-26`
- Scope: Single-account QR-first WeChat iLink provider slice hardening — close the code-level contracts for QR grouping fail-closed, bounded cursor retention, at-least-once cursor advance, bounded reconnect, reconnect-duplicate non-re-execution, account-scoped transport state, session-expiry qr-required, image-failure isolation, unknown-field isolation, and imageSend declared.

## Plan (implemented)

1. Inventory Stage-4 provider slice + tests; confirmed 9 of the ten goals were already contract-satisfied by `src/channels/wechat-ilink/index.mjs` + `legacy-core.mjs` + `protocol.mjs`; the one real behavioral gap was at-least-once cursor advance.
2. Fixed the behavioral gap in `legacy-core.mjs` `pollLoop`: added `fullyConsumed` flag — cursor advances only after every message in the batch was handled without throwing. A per-message handler throw now keeps the last usable cursor (with a loud warn) so the provider re-replays the same batch on the next poll. Already-consumed commands are de-duplicated by the bus by messageId, so replay never double-executes. This makes the pre-existing comment `先处理整批，再推进游标` actually true.
3. Added focused adversarial tests (see below) in `test/channels/wechat-ilink.test.mjs` and `test/inbound.wechat.test.mjs`.
4. Ran focused tests, full `npm test`, `verify-release`, `channel-matrix --check`, `node --check src/index.mjs`, `git diff --check`.
5. Committed only the WeChat slice + its two test files + this workstream.

## Adversarial review output (contract-by-contract)

| Goal | Where locked | Evidence |
|---|---|---|
| QR states/expiry rescan | `normalizeQrStatus` (`protocol.mjs`) | QR status matrix test: wait/scaned/redirect/confirmed/expired normalized; unknown/null fails closed with rescan guidance; timeout→expired, success→confirmed aliases |
| Bounded cursor rejection | `boundedCursor` + `batch.cursorRejected` + poll keep-old | unit test + overlong/illegal-cursor poll test: 4097-byte cursor → rejected, next poll still sends `GOOD_CURSOR`; reject must warn |
| At-least-once cursor advance | `pollLoop fullyConsumed` (code change, this workstream) | at-least-once test: CTRL handler throw keeps old cursor (`sent[1] === ''`), re-poll executes CTRL exactly once, cursor then BUF_C → BUF_D; warn must fire |
| Bounded reconnect | backoff logic `failures >= 3` + `retry/backoffDelayMs` | backoff test: sleeps == [1000,1000,5000,1000,1000], every sleep ≤ 5000, resets after a backoff |
| Duplicate-safe control delivery | bus de-dups by messageId | inflow test: reconnect/cursor-recovery replay of same batch executes control once, cursor still advances; at-least-once test asserts OK delivered twice / executed once |
| Account-scoped ctx/cursor | `accountScoped` key prefix `wechat:<accountId>:` | account-scoping test: only `wechat:ACC_A:*` written, never global `wechat:sync_buf` / `wechat:ctx:*`; context_token never enters Control Core envelope |
| Session expiry qr-required | `sessionExpired()` + `status()` | session-expiry test: state `qr-required`, `qrRequired:true`, clears account-scoped cursor/ctx/account + `wechat:account` global credential |
| Image failure isolation | `downloadImageBestEffort` non-blocking | oversize test (text delivered despite over-limit image, warn), timeout test (text delivered before 1000ms download timeout fires, warn), account-scoping failure test |
| Unknown-field isolation | `normalizeInboundMessage` / `normalizeUpdateBatch` strip unknown fields, fail-closed | unknown-fields test: injected_control/payload/type-999 never in envelope; kind/text/image shape |
| imageSend declared | `WECHAT_ILINK_CAPABILITIES.imageSend='declared'` | capability-evidence test |

## Test-authoring notes (non-obvious)

- The poll-loop `fetchImpl` in these slice tests must **park on a never-resolving abort-sensitive promise** after the scripted updates are exhausted (mirroring the real 35s long poll). Returning an immediate empty `get_updates_buf` triggers an infinite microtask spin that starves Node's timer phase — the `setTimeout` in the test never fires and the run hangs. All three originally-spinning tests (at-least-once, overlong cursor, backoff) were corrected to park after their scripted polls.
- `imageDownloadTimeoutMs` is a **top-level option**, not a `config` sub-key (read by `clampInt(options.imageDownloadTimeoutMs, …)` in `legacy-core.mjs`). The timeout test originally put it inside `config`, so the default 10000ms applied and the 1200ms assertion never saw the timeout warning; also left a 10s timer pending which delayed process exit. Fixed to pass `imageDownloadTimeoutMs: 1000` at the top level.

## Validation

- `node --test test/channels/wechat-ilink.test.mjs test/inbound.wechat.test.mjs` → 49 pass / 0 fail
- `npm test` → 1246 tests, 1245 pass / 0 fail / 1 skip (win32) — refreshed from 1230 baseline
- `node scripts/verify-release.mjs` → ok (v0.8.6, documented tests=909)
- `node scripts/gen-channel-matrix.mjs --check` → OK (27 channels)
- `node --check src/index.mjs` → SYNTAX_OK
- `git diff --check` → OK

## Commit

- Owned files only: `src/channels/wechat-ilink/legacy-core.mjs`, `test/channels/wechat-ilink.test.mjs`, `test/inbound.wechat.test.mjs`, this workstream. No assembly/routing/admin/docs/CHANGELOG/package-version touched. No public push.