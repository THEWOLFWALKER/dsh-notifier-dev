# Project state

Snapshot date: 2026-09-05. Current development branch: `codex/fix-outbound-delivery` (R1–R5 fix trains complete; v0.9.5 closed with 1531 tests). The 80-item 2026-08 review list is reconciled: 70 items fixed across R1–R5, G-19 evidence-logged (no code change), and 9 registered non-fix items (G-35/36/37 structural debt; S-01/03/08/09/10/15 — see `docs/TECHNICAL_DEBT.md` / `docs/memory/risks.md`). Last released npm artifact is `0.9.0`; the v0.9.5 dev line is not yet published. Test-count baselines in release guards are updated at train close, not per-commit.

- Current development validation: `npm test` = **1531** total, **1531 pass** (2026-09-05, R5 close).
- Historical npm `0.8.6` artifact carried contract count **909**; the published `0.9.0` artifact used **1352**; the v0.9.5 dev line is **1531**.
- Canonical engineering repository is private `dsh-notifier-dev`; the public GitHub repository is a release/source mirror (`main` now carries v0.9.5) and is not a development relay.
- Runtime is Node.js ESM, Node `>=22`, no production dependencies, no build step. There are 27 outbound adapters and six inbound control channels.
- Inbound identity is composite and source-bound: `(channel,userId)` plus exact `accountId`/`chatId` when present. Unknown or missing source authority fails closed; channel names are never used as account IDs.
- The loopback Web/admin console is the only control console (`127.0.0.1` + Bearer). It supports personal-mode setup, pairing, channel test sends, masked question listing, and Control-Core choose/reject settlement. YAML remains an advanced/automation entry.
- Desktop `ask_user` has no safe host interface. Desktop fallback is the fail-closed outcome for timeout/error; do not claim desktop settlement or dual-end parity.
- Control Core, session arbiter, bounded approval members, session control overlay persistence, provider facades, callback capacity, and public notifier facade limits are code/contract-tested.
- Public discovery metadata is aligned with v0.9.5; Awesome DSH refresh is tracked by PR #3490, and dshfind consumes the repository metadata on its scheduled sync.
- QQ C2C buttons, QQ GROUP text fallback, and QQ/WeChat iLink/DingTalk image envelopes are contract-tested only. Media/file support and provider-specific payload/reconnect behavior remain `declared` or unverified.
- `allowUsers` is retained as one-shot `inbound:migrated` compatibility import; optional Feishu/QQ SDK lifecycle seams are documented in [compatibility-matrix.md](../compatibility-matrix.md).

## Validation evidence

- `npm test`: 1531 total (1531 pass), 2026-09-05 (R5 close baseline).
- `node scripts/verify-release.mjs`: release guard compares package `0.9.5` with its documented 1531-test contract (badge / test text / homepage metadata / HANDOFF).
- `node scripts/gen-channel-matrix.mjs --check` and `node --check src/index.mjs`: required shape/syntax gates.

## Next release gate

Publish v0.9.5: run `npm pack --dry-run --json` and a registry-artifact disposable-profile smoke (registry install in a disposable profile, not a `file:` install). Validate startup, one outbound test, one inbound command, and the `ask_user` assembly boundary. Real-device, provider, and DSH-host validation remains an external gate; see [risks.md](risks.md).
