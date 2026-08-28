# Project state

Snapshot date: 2026-08-28. Current development branch: `codex/fix-outbound-delivery` (R4 train in progress; W10 committed `5a06dac`, W11 at 2/9 items). Last released version is `0.9.3`; the R4 train will close at `0.9.4`. Test-count baselines in release guards are updated at train close, not per-commit.

- Current development validation: `npm test` = **1493** total, **1493 pass** (2026-08-28, mid-R4).
- Historical npm `0.8.6` artifact carried contract count **909**; the published `0.9.0` artifact uses the current **1352** test count.
- Canonical engineering repository is private `dsh-notifier-dev`; the public GitHub repository is a release/source mirror and is not a development relay.
- Runtime is Node.js ESM, Node `>=22`, no production dependencies, no build step. There are 27 outbound adapters and six inbound control channels.
- Inbound identity is composite and source-bound: `(channel,userId)` plus exact `accountId`/`chatId` when present. Unknown or missing source authority fails closed; channel names are never used as account IDs.
- The loopback Web/admin console is the only control console (`127.0.0.1` + Bearer). It supports personal-mode setup, pairing, channel test sends, masked question listing, and Control-Core choose/reject settlement. YAML remains an advanced/automation entry.
- Desktop `ask_user` has no safe host interface. Desktop fallback is the fail-closed outcome for timeout/error; do not claim desktop settlement or dual-end parity.
- Control Core, session arbiter, bounded approval members, session control overlay persistence, provider facades, callback capacity, and public notifier facade limits are code/contract-tested.
- Public discovery metadata is aligned with v0.9.0; Awesome DSH refresh is tracked by PR #3490, and dshfind consumes the repository metadata on its scheduled sync.
- QQ C2C buttons, QQ GROUP text fallback, and QQ/WeChat iLink/DingTalk image envelopes are contract-tested only. Media/file support and provider-specific payload/reconnect behavior remain `declared` or unverified.
- `allowUsers` is retained as one-shot `inbound:migrated` compatibility import; optional Feishu/QQ SDK lifecycle seams are documented in [compatibility-matrix.md](../compatibility-matrix.md).

## Validation evidence

- `npm test`: 1352 total (1351 pass + 1 skip), 2026-08-27.
- `node scripts/verify-release.mjs`: release guard compares package `0.9.0` with its documented 1352-test contract.
- `node scripts/gen-channel-matrix.mjs --check` and `node --check src/index.mjs`: required shape/syntax gates.

## Next release gate

Run `npm pack --dry-run --json` and registry-artifact disposable-profile smoke against the published `0.9.0` artifact. Validate startup, one outbound test, one inbound command, and the `ask_user` assembly boundary. Real-device, provider, and DSH-host validation remains an external gate; see [risks.md](risks.md).
