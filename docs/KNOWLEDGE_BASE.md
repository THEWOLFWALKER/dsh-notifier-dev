# dsh-notifier Knowledge Base

This is the navigation page for humans and agents. It deliberately points to one authority per question instead of duplicating the whole handoff document.

## Current Baseline

- Canonical engineering baseline: private development line at `ce46edc` (QQ group/unknown-source control fail-closed, conversation `routeUnsafe` bypass blocked, and Web/admin `ask_user` settlement entry); package version `0.8.6` (published, current control-contract line unreleased).
- Canonical collaboration repository: private `dsh-notifier-dev` (GitHub owner `THEWOLFWALKER`). The public repository `https://github.com/THEWOLFWALKER/dsh-notifier` is the release/source mirror, not the day-to-day relay workspace.
- The public repository's `main` history is unrelated to the current hardening line; do not merge or force-push it implicitly. Public synchronization is a deliberate release operation.
- Public issue snapshot (2026-08-25): #16/#15/#14/#13/#10/#7/#6/#5/#4/#3/#2/#1 open; #11/#8 closed. PR #12 is open reference material only; PR #9 is merged in the public mirror. These statuses are not claims that the private tree fixes every open issue.
- Runtime: Node.js ESM, Node `>=22`, no build step, no production dependencies.
- Test baseline: `1194` total on the current development line (1193 pass + 1 skip). The published v0.8.6 release retains `909` as its documented test count until a release cycle updates version and count together.
- The attached npm archive is a release artifact. The engineering archive is the source authority.

## Read Order

1. `AGENTS.md` for hard boundaries and collaboration rules.
2. `docs/memory/README.md` for durable project facts and decision hygiene.
3. `README.zh-CN.md` or `README.md` for user-visible capabilities and configuration.
4. `docs/architecture.md` for the stable module/data-flow map.
5. `docs/architecture-roadmap.md` for the approved cross-IM control-plane direction (planning, not shipped behavior).
6. `docs/OPERATIONS.md` for start-up, state, admin, and release smoke checks.
7. `docs/TECHNICAL_DEBT.md` for the active no-new-features maintenance queue.
8. `HANDOFF.md` for detailed historical rationale, review findings, and known traps.
9. `docs/RELAY_BOOTSTRAP_PROMPT.md` for the copy-paste first message sent to a new relay agent.
10. `CHANGELOG.md` for chronological changes; it is not a substitute for current rules.
11. `docs/security/PLUGIN_ATTACK_REVIEW.md` and `docs/security/PLUGIN_SECURITY_FIX_PLAN.md` for the hostile-plugin threat model and staged remediation ownership.

## Audience Map

| Surface | Audience | Keep here |
|---|---|---|
| `AGENTS.md` | Coding agents | Boundaries, workflow, commands, ownership rules |
| `README*.md` | Users | Install, configure, use, and capability overview |
| `docs/architecture.md` | Maintainers | Stable components, flows, state keys, trust boundaries |
| `docs/OPERATIONS.md` | Operators | Verification, troubleshooting, rollback, real-device checks |
| `docs/VERSIONING.md` | Release owners | Canonical version fields, package comparison, release gate |
| `docs/memory/` | Future agents | Short durable facts, decisions, and recurring risks |
| `HANDOFF.md` | Detailed successor context | Historical rationale and full engineering snapshot |
| `docs/RELAY_BOOTSTRAP_PROMPT.md` | New relay agents | Direct first message for repository takeover and handoff |
| `.agents/workstreams/` | Parallel agents | Temporary scope reservations and handoff notes |

The product, UX, planning, review-loop, and DSH GUI consistency contract is maintained in `docs/architecture.md`. The approved future control-plane direction is in `docs/architecture-roadmap.md`; it must not be treated as shipped capability.

## Capability Summary

- Outbound: 27 adapters through `createNotifier()`; level routing is `timeSensitive`, `active`, or `passive`.
- Inbound: Telegram, Feishu, QQ Bot, WxPusher, WeChat iLink, and DingTalk.
- Provider boundaries: `src/channels/wechat-ilink/`, `src/channels/feishu/`, and `src/channels/telegram/`; each wraps the legacy transport while exposing account/source normalization and capability evidence. QQ, WeChat iLink, and DingTalk image paths are wired and contract-tested; file sending/receiving remains `declared` until protocol/device evidence.
- Trust stack: identity bindings, pairing codes, HMAC token vault, callback references, inbound bus deduplication, source-chat checks, and first-arrival settlement.
- Agent integration: `notify`, `notify_test`, optional `ask_user`, public `ctx.notifier` facade, and `dsh-notifier/sent` events.
- Operations: JSON state store with key-level merge, cross-process lock, convergence reads, JSONL ledger, local admin API/UI, SSE event stream, route CLI, and channel login/test CLIs.
- Security posture: installed DSH plugins share the host process and must currently be treated as trusted code; notifier-specific leakage, audit, identity, and resource-bound fixes are tracked separately from DSH host isolation requirements.
- Control status: QQ C2C native approval/question buttons and QQ GROUP text fallback are contract-tested only; GROUP, missing `chatType`, and unknown source metadata fail closed, and conversation `routeUnsafe` cannot bypass the gate. The loopback Web/admin now has a 阶段 2A `ask_user` settlement entry (masked snapshot + choose/reject through Control Core, Bearer-gated; desktop still has none), so dual-end sharing is not claimed. Real-device/provider and host-protocol validation remains pending.

## Authority Rules

- If docs and source disagree, inspect the source and tests, then update the stale document in the same change.
- For collaboration status and decisions, `.agents/` and `docs/memory/` are authoritative; chat is only a request channel. Runtime behavior is still authoritative only in `src/` and `test/`.
- For serial multi-tool development, commit/push at each machine handoff. Every agent writes a detailed identity-bearing workstream and refreshes the consolidated current handoff snapshot in `HANDOFF.md`; memory remains for durable repository facts and decisions.
- If the engineering archive and npm archive disagree, keep the engineering tree as truth and record the artifact mismatch in `docs/memory/project-state.md`.
- If two agents produce competing edits, preserve both diffs until the parent agent resolves them; never silently reset or checkout another agent's work.
