# Task 04: First-Run Console UX

## Goal

Reduce first-run friction in the existing local admin console. A new personal user must discover the console, pair one channel, send a test notification, and understand failure state without editing YAML.

## Start

```powershell
git status --short --branch
git log --oneline -5
git switch -c codex/task-04-admin-ux
```

Read `src/admin/ui.mjs`, `src/admin/server.mjs`, `src/admin/api.mjs`, `src/config.mjs`, `src/control/session-arbiter.mjs`, `docs/OPERATIONS.md`, and the existing admin tests before editing.

## Allowed files

- `src/admin/ui.mjs` and the smallest required admin API/server wiring;
- focused admin UI/API tests;
- `README.md`, `README.zh-CN.md`, `docs/guide.md`, `docs/OPERATIONS.md`, `HANDOFF.md`, `CHANGELOG.md`, and this workstream.

Do not create a second console, change the bind address from `127.0.0.1`, expose credentials, alter channel transport code, or add runtime dependencies.

## Required first-run flow

1. The startup log must print a clear local URL and the console must contain a visible “管理台/Console” entry hint. Do not require users to know port `8104` in advance; use the actual bound port.
2. The first screen must show a short state machine: `未配置 → 已配对 → 测试通知 → 正常运行`.
3. Personal mode is selected by default. Hide team ACL/session controls until advanced mode is explicitly opened.
4. Pairing controls must support the existing QR/pair-code APIs. Every async state needs loading, success, failure, retry, and expired-code states.
5. Channel configuration must be field-driven from the existing API metadata. YAML is an advanced escape hatch, never the primary instruction.
6. A “发送测试通知” action must report per-channel result, failure reason, and next action. A failed channel must not hide successes from other channels.
7. Token errors must not loop silently. Show one clear re-entry path; never display the token or hash.
8. Keep existing visual language and responsive behavior from `src/admin/ui.mjs`; use familiar icons/tooltips for actions and avoid nested cards.

## Mechanical procedure

1. Inventory current UI routes, API calls, and empty/error states. Write the mapping in the workstream before editing.
2. Implement the smallest view-state model needed for the first-run flow. Do not duplicate server state or invent a second persistence layer.
3. Add/adjust API tests for URL/port discovery, overview empty state, pairing status, channel test result, token failure, and retry.
4. Add string-level UI tests for the entry hint, first-run steps, personal-mode default, YAML advanced label, and failure/retry messages.
5. Verify desktop and narrow viewport layout with the existing local test tooling. No real device is required in this pack, but record that gap.
6. Run `npm test`, `node scripts/verify-release.mjs`, `node scripts/gen-channel-matrix.mjs --check`, and `node --check src/index.mjs`.

## Review gates

- Admin remains loopback-only and bearer-protected for API calls.
- No secrets in DOM, logs, audit, or error responses.
- Empty state is actionable, not an explanatory dead end.
- One failed channel does not block other channels.
- Existing admin API contracts and redaction tests remain green.

## Commit and handoff

```powershell
git add src/admin test README.md README.zh-CN.md docs/guide.md docs/OPERATIONS.md HANDOFF.md CHANGELOG.md .agents/workstreams/task-04-admin-ux.md
git commit -m "feat: streamline first-run admin console onboarding"
git push private HEAD
```

Stop after this pack. Do not start WeChat iLink or native button work in the same branch.
