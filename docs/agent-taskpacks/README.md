# Agent Taskpacks

These taskpacks are execution instructions, not shipped features. Runtime source and tests remain authoritative. Execute one pack per branch and stop at its boundary.

## Order

0. `00-host-event-compat.md` — diagnose and fix host event subscription compatibility (Issue #16).
1. `00-cc1-test-migration.md` — finish exact-chat question test migration.
2. `01-release-facts-cleanup.md` — reconcile issues, PR references, changelog and handoff facts.
3. `02-control-contract.md` — add the control-plane contract and compatibility facade only.
4. `03-session-arbiter.md` — add session policy and command precedence without provider code.
5. `04-admin-ux.md` — make first-run pairing and console entry understandable without YAML.
6. `05-wechat-ilink.md` — harden the single-account QR-first WeChat control path.

Do not start later packs until the previous one passes the full validation gate. Do not cherry-pick PR #12. QQ buttons, question cards, and `approval.parallel` are deferred until the control contract and session arbiter are complete.
