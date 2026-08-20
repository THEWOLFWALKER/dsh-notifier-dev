# Technical Debt And Bug-Elimination Plan

This is the active work queue for the next maintenance cycle. It deliberately excludes new user-facing capabilities. The goal is to make the existing 0.8.5 behavior more trustworthy, observable, testable, and easier to release.

Status at `2026-08-20` (Trae1, second relay): P0-1 documentation truth audit is in final validation after the A1/A2 security changes and package allowlist correction; P0-3 host-qualified baseline is recorded (902-test contract; Linux host passes all, Windows host lacks only the four BurntToast desktop tests). P0-2 registry acceptance remains pending npm authentication/publication and profile access. P1-1 Telegram card-path protocol guards landed on `codex/tech-debt-protocol-guards` (4096 UTF-16 code-unit text clamp + parse_mode/callback-shape regression tests) and are merged into `main`; its remaining real-device confirmation and long-connection items stay open. P1-2 error-visibility audit landed on `codex/tech-debt-error-visibility`: 356 catch blocks classified, three silent failure paths fixed (approval routing exception warn, store boot-corruption forensic copy + warn with 8MB cap and empty-file exemption, keywords regex fallback reporting), test contract 897 -> 902. P1-3/P1-4 and P2 items remain open.

## Operating Rule

Every item follows the same loop: write a short plan, reproduce or measure the problem, implement the smallest fix, perform adversarial review against failure and compatibility paths, revise, run focused tests plus the full suite, and record the result here or in the relevant memory file. Do not close an item because a mock test is green when the risk is provider or host behavior.

## Priority Queue

### P0: Truth And Release Hygiene

- **P0-1 Documentation truth audit [done]**: reconcile `HANDOFF.md`, README test wording, package file counts, branch/commit references, and registry status with the current tree. Stale facts are an operational defect because they send the next maintainer down the wrong path.
- **P0-2 0.8.5 artifact acceptance**: inspect `npm pack --dry-run --json`, then install the registry artifact in a disposable DSH profile and verify version, startup assembly, one outbound test, and one inbound command. Do not treat a `file:` install as acceptance.
- **P0-3 Host-qualified test baseline [recorded]**: keep the 902-test contract explicit. On the Windows host, 898 pass and four desktop tests require BurntToast/PowerShell capability; the 2026-08-20 Linux relay hosts passed all (897 after P1-1, 902 after P1-2). Validate the desktop adapter on a capable host rather than weakening its behavior.

### P1: High-Value Bug And Regression Coverage

- **P1-1 Provider protocol blind spots [partially done 2026-08-20]**: Telegram card-path text is now clamped to the 4096 UTF-16 code-unit limit with protocol-shape regression tests (approval/question/action cards, parse_mode guard) on `codex/tech-debt-protocol-guards`. Still open: one real-device confirmation of the clamp boundary, payload-limit evidence for other providers (feishu/qq/wxpusher/dingtalk JSON cards stay unclamped until evidence), legacy markdown escaping coverage beyond the parse_mode guard, callback body limits (A5 overlap — coordinate with the security plan), and long-lived connection behavior. Mock fetch alone remains insufficient for these paths.
- **P1-2 Error-visibility audit [done 2026-08-20 on `codex/tech-debt-error-visibility`]**: all 356 catch blocks in `src/` were classified (141 logged-visible, 139 deliberately silent with comments, 7 frontend UI, 61 uncommented-silent individually verified). Three real silent-failure gaps fixed: approval routing exceptions now warn while keeping the fail-safe broadcast fallback; `store.mjs` boot corruption now preserves a forensic copy (`.corrupt.<ts>`, copy-not-rename, 8MB cap, empty-file exempt) and warns instead of silently wiping bindings/pending approvals; `keywords.regex` invalid-pattern fallbacks are now reported via `createKeywordFilter().regexFallbacks` and warned by the event listener. Verified non-issues left untouched: `_shared.mjs` rethrow-with-classification, `ledger.mjs` documented best-effort silence, fail-closed token verification. Remaining open: none for this item; real-device confirmation of listener reconnection visibility belongs to P1-1's long-connection item.
- **P1-3 Cross-process state stress**: exercise concurrent route/member/credential writes, lock recovery, mtime convergence, corrupt-file backup, and stale `file:`/copied-install behavior on a disposable profile.
- **P1-4 Existing UI workflow audit**: test the current admin and sub-agent-console-facing flows for loading, empty, error, disabled, narrow viewport, and destructive-action confirmation states. Reuse the DSH visual system; this is maintenance of existing UX, not a redesign.

### P2: Bounded Structural Debt

- **P2-1 Callback reference capacity**: measure whether the 256-entry FIFO can evict in-flight action/question references under realistic concurrency. Change the bound only if evidence shows user-visible loss, and add a bounded-memory test first.
- **P2-2 Legacy configuration migration**: assess when the deprecated YAML `allowUsers` import path can be removed or further isolated. Do not remove compatibility until migration behavior and upgrade impact are documented.
- **P2-3 Optional SDK lifecycle matrix**: verify supported Feishu/QQ/QR dependency shapes, missing-package diagnostics, reconnect/dispose behavior, and version drift in a small compatibility matrix.

## Explicitly Deferred

- No new channels, tools, approval modes, question modes, or dashboard features during this cycle.
- No speculative abstraction or framework migration.
- No visual restyling of DSH; only consistency, accessibility, and defect correction are in scope.

## Exit Criteria

- No stale release/version/test claims remain in maintained handoff or operational docs.
- Every P0 item has evidence attached to a commit or registry/profile check.
- P1 items have focused regression coverage or a documented external-validation procedure.
- `npm test`, release guard, channel-matrix check, syntax checks, and `git diff --check` pass; known host capability gaps are explicitly recorded.
