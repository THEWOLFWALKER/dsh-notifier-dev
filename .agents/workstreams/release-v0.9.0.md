# Workstream: release-v0.9.0

- Agent identity: `root | Codex primary`
- Branch: `codex/stage5-wechat-ilink-hardening`
- Status: in_progress
- Scope: Promote the reviewed development line to the v0.9.0 release candidate, relay it to the private development repository, and prepare a filtered public mirror without publishing external comments or npm artifacts without explicit review.
- Changes: package/UI version 0.9.0; release test contract 1352 (1351 pass + 1 skip); bilingual README, CHANGELOG, HANDOFF, KNOWLEDGE_BASE, and project-state synchronized.
- Public mirror allowlist: runtime `src/`, tests `test/`, tooling `scripts/`, `.github/`, user/release docs and root package metadata only. Never copy `.agents/`, `.codex/`, `.claude/`, `.opencode/`, credentials, state, logs, `node_modules/`, or `package-lock.json`.
- Validation already observed: `npm test` 1352 total / 1351 pass / 1 skip; release guard, channel matrix check, syntax check, diff check, and npm pack dry-run pass.
- Private relay: pushed successfully on 2026-08-27; `private/main` and `private/codex/stage5-wechat-ilink-hardening` now point to `ae382a6`.
- Public staging: local branch `codex/public-v0.9.0-mirror` at `1415d7d` is based on `origin/main`, contains the v0.9.0 allowlisted source/test/docs mirror, and has no forbidden internal files. It is not pushed yet.
- External actions pending review: public mirror push, GitHub Issue/PR replies or closures, Awesome DSH fork PR, and dshfind correction request.
