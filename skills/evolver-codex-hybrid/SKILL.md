---
name: evolver-codex-hybrid
description: "Use this skill only when maintaining the local Evolver-to-Codex bridge itself: ingesting raw Evolver/OpenClaw-style output, translating `sessions_spawn(...)` into local artifacts, repairing bridge files, or promoting validated rules through the bridge command. Do not use this skill for generic retrospectives, \"下次怎么做得更好\", or broad agent evolution requests; those should be handled by `agent-evolution-protocol`."
---

# Evolver Codex Bridge Helper

This skill is not the main retrospective skill.

It is a narrow helper for bridge maintenance inside this workspace:

- Evolver or another external process produces fresh evolution signals.
- A local bridge turns those signals into Codex-friendly artifacts.
- The main retrospective / "next time do better" reasoning should be owned by `agent-evolution-protocol`.

## When this skill triggers

Assume this skill is relevant when the user asks to:

- ingest fresh Evolver or OpenClaw-style output into `evolver-hybrid/`
- repair the bridge script or bridge-generated files
- translate `sessions_spawn(...)` output into local artifacts
- promote a validated rule with the bridge command

If the user's ask is mainly retrospective, methodological, or framed as "这次怎么改下次更稳", defer to `agent-evolution-protocol` and use this skill only if bridge maintenance is also needed.

This helper may also be used when the user specifically wants to improve how the bridge retrieves local hybrid memory, query stable rules / feedback / task sessions / genes / delegate suggestions, or inspect why the bridge cannot find prior guidance.

## Files to read first

Start with these files in order:

1. `evolver-hybrid/memory/stable-rules.md`
2. `evolver-hybrid/artifacts/next-prompt.md`
3. `evolver-hybrid/artifacts/next-actions.json`
4. `evolver-hybrid/artifacts/delegate-suggestions.json`
5. `evolver-hybrid/memory/task-session-index.ndjson`

Read `evolver-hybrid/raw/latest-evolver-output.txt` only when the distilled artifacts are ambiguous or clearly incomplete.

## Workflow

1. Check whether the task is actually a retrospective request.
If yes, the main reasoning belongs to `agent-evolution-protocol`.

2. Read the stable rules first.
These are the only lessons that should shape behavior by default inside the bridge flow.

3. Read the latest bridge prompt.
Treat it as fresh but unverified guidance.

4. Query before you deep-read when the target is known.
Use:
`node scripts/evolver_codex_bridge.js --query "..." --task-context "..." --preset retrieval`
This is the preferred lightweight retrieval path for stable rules, feedback insights, task sessions, execution feedback, exported genes, and delegate suggestions.

When the task family is clear and `evolver-hybrid/memory/stable-rules-routing.md` already contains a mapping for it, add `--task-family <family>` so `stable-rules.md` is filtered before scoring. A fresh portable install has no user-specific routing map: check the returned routing warning and omit the filter until mappings are configured.

When you need tighter recall, add filters like:
`--preset retrieval --outcome success --used-input stable-rules --task-contains "..." --since-days 30`

When the task is specifically "which guidance is mature enough to become a stable rule?", prefer:
`node scripts/evolver_codex_bridge.js --query-for-promotion "..." --preset promotion-review`.
This helper surfaces evidence-backed candidates but does not auto-promote them.

When the task becomes "turn this proven guidance into a reviewable Gene draft", prefer:
`node scripts/evolver_codex_bridge.js --build-gene-candidate "..." --preset promotion-review`.
This writes a scaffold into `artifacts/gene-candidates/` for review; export remains explicit.

When the task becomes "prepare the actual promotion/export review packet", prefer:
`node scripts/evolver_codex_bridge.js --build-promotion-packet "..." --preset promotion-review`.
This bundles evidence, suggested rule source, linked Gene draft, and manual commands into `artifacts/promotion-packets/`.

When an already-exported Gene needs its validation commands refreshed to match the current bridge heuristics, prefer:
`node scripts/evolver_codex_bridge.js --refresh-gene evolver-hybrid/memory/agent-genes/gene_xxx.json`.
This updates the named Gene JSON in place and records a lightweight audit event.

When you want to explicitly rebuild file-based past-task recall from execution feedback, prefer:
`node scripts/evolver_codex_bridge.js --build-task-session-index --base-dir evolver-hybrid`.
This keeps a lightweight `memory/task-session-index.ndjson` and `memory/task-session-index.json` in sync without introducing a database or service.

When you want a narrow cron/manual upkeep entrypoint, prefer:
`node scripts/evolver_codex_bridge.js --run-maintenance safe --base-dir evolver-hybrid`.
This only refreshes file-based artifacts such as feedback insights, task/session index, and debrief reminders.

`all` is not a read-only heartbeat: it also runs `candidate-promotion`, so use it only during an explicitly reviewed promotion pass. When you only need to dismiss one handled/noise candidate, use:
`node scripts/evolver_codex_bridge.js --mark-candidate-handled "<session id or session path>" --handled-reason "<reason>" --base-dir evolver-hybrid`.
That path updates the candidate ignore registry without running candidate promotion or changing stable rules.

Useful preset meanings:
- `retrieval`: start-of-task memory lookup with sensible defaults
- `promotion-review`: recent evidence defaults for promotion / Gene review
- `post-task-debrief`: recent feedback-first query for task wrap-up

5. Translate host-only output into concrete Codex work.
`sessions_spawn(...)` is not executable in Codex. Convert it into one of:
- a direct file change
- a concrete terminal command
- an explicit local-worker / manual delegate suggestion
- a user-facing recommendation
- a stable rule candidate for later promotion

Prefer consuming `artifacts/delegate-suggestions.json` instead of rereading raw `sessions_spawn(...)` text when the bridge has already translated it.

6. Validate during real execution.
Do not promote a lesson just because Evolver suggested it. Prefer rules that survived at least one task.

7. Promote only durable lessons.
First generate a review-pending packet with `--build-promotion-packet`. A human must review the evidence, choose an allowed non-confidential `privacy_class`, set `status: approved`, and complete every `human_approval` field. Hash the final JSON bytes, then apply exactly that packet through:
`node scripts/evolver_codex_bridge.js --apply-approved-packet "<approved-packet.json>" --packet-sha256 "<sha256-of-final-file>"`

Free-text `--promote-rule` is disabled. Candidate classification, including legacy `promote-stable-rule` actions, is proposal-only and cannot mutate `stable-rules.md`.

## Decision rules

- Prefer `stable-rules.md` over fresh suggestions when they conflict.
- Prefer current repository reality over generic evolution advice.
- If a suggestion is too vague to act on, sharpen it into a checklist or ignore it.
- If a suggestion would require host-native automation that Codex lacks, replace it with the nearest explicit local action.
- If the suggestion smells like past-task recall, query `task-session-index.ndjson` before re-deriving the same checklist from raw feedback.
- Treat generated Gene validation commands as heuristics from the current bridge workspace, not as guaranteed universal checks.
- Use `refresh-gene` for existing Gene maintenance instead of hand-editing validation arrays.
- Use `run-maintenance` when you only need narrow upkeep, not a new automation framework.
- If the request becomes a broad retrospective, hand off the reasoning frame to `agent-evolution-protocol`.

## Output style

When using this skill in a real task:

- say which artifact you consumed if it matters
- separate validated rules from new suggestions
- call out any host limitation briefly instead of pretending the directive executed
- leave behind a clearer workspace state than you found
