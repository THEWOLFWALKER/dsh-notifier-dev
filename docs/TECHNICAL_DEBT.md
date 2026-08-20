# Technical Debt And Bug-Elimination Plan

This is the active work queue for the next maintenance cycle. It deliberately excludes new user-facing capabilities. The goal is to make the existing 0.8.5 behavior more trustworthy, observable, testable, and easier to release.

Status at `2026-08-20` (Trae1): P0-1 documentation truth audit is in final validation after the A1/A2 security changes and package allowlist correction; P0-3 host-qualified baseline is recorded (897-test contract; Linux host passes all, Windows host lacks only the four BurntToast desktop tests). P0-2 registry acceptance remains pending npm authentication/publication and profile access. P1-1 Telegram card-path protocol guards landed on `codex/tech-debt-protocol-guards` (4096 UTF-16 code-unit text clamp + parse_mode/callback-shape regression tests); its remaining real-device confirmation and long-connection items stay open. P1-2/P1-3/P1-4 and P2 items remain open.

## Operating Rule

Every item follows the same loop: write a short plan, reproduce or measure the problem, implement the smallest fix, perform adversarial review against failure and compatibility paths, revise, run focused tests plus the full suite, and record the result here or in the relevant memory file. Do not close an item because a mock test is green when the risk is provider or host behavior.

## Priority Queue

### P0: Truth And Release Hygiene

- **P0-1 Documentation truth audit [done]**: reconcile `HANDOFF.md`, README test wording, package file counts, branch/commit references, and registry status with the current tree. Stale facts are an operational defect because they send the next maintainer down the wrong path.
- **P0-2 0.8.5 artifact acceptance**: inspect `npm pack --dry-run --json`, then install the registry artifact in a disposable DSH profile and verify version, startup assembly, one outbound test, and one inbound command. Do not treat a `file:` install as acceptance.
- **P0-3 Host-qualified test baseline [recorded]**: keep the 897-test contract explicit. On the Windows host, 893 pass and four desktop tests require BurntToast/PowerShell capability; the 2026-08-20 Linux relay host passed all 897. Validate the desktop adapter on a capable host rather than weakening its behavior.

### P1: High-Value Bug And Regression Coverage

- **P1-1 Provider protocol blind spots [partially done 2026-08-20]**: Telegram card-path text is now clamped to the 4096 UTF-16 code-unit limit with protocol-shape regression tests (approval/question/action cards, parse_mode guard) on `codex/tech-debt-protocol-guards`. Still open: one real-device confirmation of the clamp boundary, payload-limit evidence for other providers (feishu/qq/wxpusher/dingtalk JSON cards stay unclamped until evidence), legacy markdown escaping coverage beyond the parse_mode guard, callback body limits (A5 overlap — coordinate with the security plan), and long-lived connection behavior. Mock fetch alone remains insufficient for these paths.
- **P1-2 Error visibility audit**: trace every defensive catch around inbound SDKs, WebSocket lifecycle, callback handling, and admin operations. Confirm that failures remain isolated without becoming silent; add diagnostics or regression tests where the current log contract is ambiguous.
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
