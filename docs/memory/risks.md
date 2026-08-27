# Recurring risks

- Mock/contract tests do not establish provider payload limits, callback shapes, callback byte limits, reconnect behavior, or optional SDK lifecycle behavior. Changes in those areas need protocol-level or real-device evidence.
- The 2026-08-27 development line has **1352** tests (1351 pass + 1 skip), but no real provider/device or DSH-host protocol run. Do not label any inbound provider `real-device-verified`.
- Real-device handoff remains: Telegram 4096 UTF-16 boundary; Feishu WS and QQ gateway/DingTalk stream reconnects; QQ callback ACK and keyboard limits; WeChat iLink QR/long-poll/context-token behavior; WxPusher callback shape; image/file payloads; and provider delivery limits.
- Windows desktop toast cannot run in headless CI; validate BurntToast/PowerShell locally when touching `desktop`. Desktop `ask_user` has no safe host interface, so desktop settlement and dual-end parity must not be advertised.
- The loopback admin server is bound to `127.0.0.1` and Bearer-gated. Its question list is masked and its choose/reject endpoint must always go through Control Core; no direct ledger or answer write is allowed.
- `notifyAll().delivered` is channel-level evidence only. Numbered question fallback needs target-level delivery evidence; wrong-chat and missing-chat replies are consumed fail-closed.
- WxPusher injects a local `accountId` from configuration, defaulting to literal `default`; multiple apps must configure distinct local IDs or they are indistinguishable within that channel namespace. Callback `data.appId` is never trusted as identity.
- State files contain bindings, pending work, and credentials. Keep them private, use store locking/merge setters, and do not edit a live state file manually. Bootstrap pairing codes are short-lived `0600` files; same-user/root access remains the host trust boundary.
- `wechat:ctx:` and inbound debounce/dedup tables are bounded caches. Eviction order and user-visible early flush behavior have only mock evidence and should be observed on real traffic before changing limits.
- Same-process DSH plugins are trusted code, not an OS isolation boundary. Facade freezing, budgets, audit metadata, and package export narrowing reduce supported-path misuse but cannot protect against a hostile plugin reading host memory or importing internal constructors.
- The package artifact and engineering archive can drift. Resolve any `CHANGELOG.md` or file-list mismatch before publishing; registry acceptance must use a registry install in a disposable profile, not a `file:` install.

Authoritative details: [project-state.md](project-state.md), [docs/protocol-preflight/](../protocol-preflight/), [docs/security/](../security/), and [docs/compatibility-matrix.md](../compatibility-matrix.md).
