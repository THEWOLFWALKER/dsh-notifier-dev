# Agent Taskpacks

These taskpacks are execution instructions, not shipped features. Runtime source and tests remain authoritative. Execute one pack per branch and stop at its boundary.

## Order

1. `00-cc1-test-migration.md` — finish exact-chat question test migration.
2. `01-release-facts-cleanup.md` — reconcile issues, PR references, changelog and handoff facts.
3. `02-control-contract.md` — add the control-plane contract and compatibility facade only.

Do not start later packs until the previous one passes the full validation gate. Do not cherry-pick PR #12. QQ buttons, question cards, and `approval.parallel` are deferred until the control contract and session arbiter are complete.
