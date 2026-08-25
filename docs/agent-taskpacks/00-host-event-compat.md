# Task 00: Host Event Compatibility (Issue #16)

## Goal

Make host event delivery observable and compatible with the dsh web profile that reported zero `session/event` and `agent/created` events. Do not claim the issue fixed until a real host or protocol capture confirms delivery.

## Start

```powershell
git status --short --branch
git log --oneline -5
git switch -c codex/task-00-host-events
```

Read `src/index.mjs`, `src/event-listener.mjs`, `src/inbound/conversation.mjs`, `src/routing/session-registry.mjs`, `test/index.test.mjs`, `test/event-listener.test.mjs`, and the dsh host event API reference available in the repository. Do not infer a new event signature from the issue alone.

## Allowed files

- `src/index.mjs`, `src/event-listener.mjs`, and one small host-event adapter module if required;
- focused host/event tests and docs/workstream files;
- `CHANGELOG.md` only after behavior is verified.

## Mechanical procedure

1. Add a diagnostic counter for each subscription attempt and each received event type. Counters must be bounded and must not log message content, tokens, or credentials.
2. Capture the exact return/error from `ctx.on('session/event', ...)` and `ctx.on('agent/created', ...)`. A missing or throwing registration must be visible through the existing logger and must not prevent startup.
3. Normalize supported host callback shapes in one pure function: `(session,event)`, `{session,event}`, and the documented host shape only. Reject ambiguous payloads instead of guessing.
4. Register the documented event scope/timing. If more than one host version must be supported, use an explicit version/feature check or a narrow fallback registration with deduplication; never subscribe to every event blindly.
5. Preserve current listener semantics: `turn/end` filtering, debounce, grace, dedup, registry touch, and channel failure isolation.
6. Treat native `ask_user_question` as a separate host provider contract. Do not replace the Web provider with a mobile provider. The desktop UI must remain available; a future mobile mirror must be optional, first-valid-wins, and timeout/failure must return control to the desktop.
7. Add tests for registration success, registration throw, each accepted callback shape, malformed payload, duplicate delivery, zero-event diagnostics, and “remote `ask_user` does not silently claim native Web UI parity”.
8. Run `npm test`, `node scripts/verify-release.mjs`, `node scripts/gen-channel-matrix.mjs --check`, and `node --check src/index.mjs`.
9. Record the real-device/protocol validation gap in `docs/memory/risks.md` if no dsh host is available. Do not close Issue #16 or claim Issue #5 native parity from mocks.

## Forbidden

No channel adapter changes, no approval/question semantic changes, no public release, no fabricated host API compatibility.

## Commit and handoff

```powershell
git add src/index.mjs src/event-listener.mjs src/host-events.mjs test docs/memory/risks.md CHANGELOG.md .agents/workstreams/task-00-host-events.md
git commit -m "fix: make host event subscription compatible and observable"
git push private HEAD
```

Report the exact host event signature tested, test commands, and whether Issue #16 is fixed, partially fixed, or awaiting real validation.
