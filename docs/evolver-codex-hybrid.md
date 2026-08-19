# Evolver + Codex Hybrid

This workspace now has a minimal hybrid loop for using Evolver-style outputs inside Codex without native OpenClaw host support.

Ownership boundary:

- `agent-evolution-protocol` is the main skill for复盘、沉淀经验、"下次怎么做更好"
- `evolver-codex-hybrid` is only a narrow bridge-maintenance helper and should not compete for generic retrospective prompts

## What it does

- lets Evolver keep producing fresh evolution guidance
- captures host-only `sessions_spawn(...)` directives without pretending Codex can execute them
- translates host-only delegation hints into explicit local delegate suggestions
- writes distilled artifacts that Codex can consume directly
- keeps durable lessons in a separate stable memory file
- keeps file-based past task/session recall under `memory/` without adding a database or service

## Layout

- `scripts/evolver_codex_bridge.js`
  The bridge. It ingests raw Evolver output, writes Codex-friendly artifacts, and now exposes a lightweight query path over hybrid memory.
- `evolver-hybrid/raw/latest-evolver-output.txt`
  The last raw Evolver output that was ingested.
- `evolver-hybrid/artifacts/next-prompt.md`
  The distilled prompt Codex should read first.
- `evolver-hybrid/artifacts/next-actions.json`
  Structured action candidates extracted from the latest run.
- `evolver-hybrid/memory/stable-rules.md`
  Only validated lessons belong here.
- `evolver-hybrid/memory/evolution-events.ndjson`
  Lightweight append-only audit trail.
- `evolver-hybrid/memory/task-session-index.ndjson`
  File-based past-task/session recall derived from execution feedback.
- `evolver-hybrid/artifacts/delegate-suggestions.json`
  Local translations of host-only `sessions_spawn(...)` directives into auditable delegate suggestions.
- `evolver-hybrid/artifacts/gene-candidates/`
  Review-only Gene scaffolds derived from feedback evidence before export.
- `evolver-hybrid/artifacts/promotion-packets/`
  Review packets that bundle stable-rule evidence, suggested rule source, linked Gene draft, and manual commands.
- `skills/evolver-codex-hybrid/SKILL.md`
  The local skill that consumes the artifacts.

The installer creates `evolver-hybrid/.gitignore` with a fail-private default that ignores the entire runtime tree. Session summaries, source paths, stable rules, feedback, raw input, and generated review artifacts should be treated as private local state unless the user explicitly reviews and versions selected files.

## Recommended loop

1. Run Evolver externally and save its output to a file.
2. Ingest that output:

```bash
node scripts/evolver_codex_bridge.js --input /path/to/evolver-output.txt
```

3. Use the distilled artifacts inside Codex:
- read `evolver-hybrid/artifacts/next-prompt.md`
- execute only what still makes sense in the current repository and task
- treat `sessions_spawn(...)` as a translation target, not an executable command

4. Query hybrid memory when the task has a clear target:

```bash
node scripts/evolver_codex_bridge.js \
  --query "bridge enhancements feedback" \
  --task-context "find reusable hybrid retrieval guidance for the current task" \
  --preset retrieval
```

This searches `stable-rules`, `feedback-insights`, `memory/task-session-index.ndjson`, `execution-feedback`, `memory/agent-genes/`, and delegate suggestions, then returns a task-usable summary.

You can tighten retrieval with lightweight filters:

```bash
node scripts/evolver_codex_bridge.js \
  --query "hybrid retrieval" \
  --preset retrieval \
  --outcome success \
  --used-input stable-rules \
  --task-contains "retrieval" \
  --since-days 30
```

And you can ask for evidence-backed promotion candidates without auto-promoting:

```bash
node scripts/evolver_codex_bridge.js \
  --query-for-promotion "hybrid" \
  --preset promotion-review \
  --since-days 30
```

If you want a reviewable Gene scaffold from the strongest candidate, write it to artifacts first:

```bash
node scripts/evolver_codex_bridge.js \
  --build-gene-candidate "hybrid" \
  --preset promotion-review \
  --since-days 30
```

If you want the full review packet for manual promotion and export:

```bash
node scripts/evolver_codex_bridge.js \
  --build-promotion-packet "hybrid" \
  --preset promotion-review \
  --since-days 30
```

Preset shortcuts:

- `retrieval`: start-of-task memory recall across stable rules, insights, task sessions, recent feedback, genes, and delegate suggestions
- `promotion-review`: recent evidence defaults for stable-rule / Gene review work
- `post-task-debrief`: recent feedback-first lookup when wrapping a task or preparing new execution feedback

If you want to explicitly rebuild file-based past-session recall:

```bash
node scripts/evolver_codex_bridge.js \
  --build-task-session-index \
  --base-dir evolver-hybrid
```

If you want a narrow cron/manual upkeep entrypoint without adding automation services:

```bash
node scripts/evolver_codex_bridge.js \
  --run-maintenance safe \
  --base-dir evolver-hybrid
```

The `safe` maintenance target is intentionally narrow. It refreshes:

- feedback insights
- the task/session index
- a debrief reminder artifact

`all` additionally runs proposal-only `candidate-promotion` and writes classification/ignore/event artifacts. Do not use `all` as an unattended or read-only heartbeat.

The public package intentionally ships with no candidate-classification rules. The first candidate-classification run creates `evolver-hybrid/memory/codex-candidate-promotion-rules.json` with an empty `rules` array. Until the user adds deterministic rules for the target workspace, unmatched candidates remain `review-first`; the bridge does not automatically skip them, add them to the handled registry, or propose an author-defined stable rule.

Gene drafts now keep the same explicit export boundary, but the validation commands inside each scaffold are generated from the current bridge workspace as heuristics instead of being left as a generic placeholder.

If an already-exported Gene falls behind the current validation heuristics, refresh it explicitly instead of hand-editing JSON:

```bash
node scripts/evolver_codex_bridge.js \
  --refresh-gene evolver-hybrid/memory/agent-genes/gene_xxx.json
```

5. Promote rules only after they survive real use. Generate a review packet first, then have the user review its evidence, set an allowed non-confidential `privacy_class`, change `status` to `approved`, and complete every `human_approval` field. Compute SHA-256 over the final JSON bytes and apply exactly that file:

```bash
node scripts/evolver_codex_bridge.js \
  --apply-approved-packet "evolver-hybrid/artifacts/promotion-packets/<approved-packet>.json" \
  --packet-sha256 "<sha256-of-final-file>"
```

The legacy free-text `--promote-rule` path is disabled. Candidate classification is proposal-only, including when an old configuration still says `promote-stable-rule`.

## Why this is the recommended shape

This keeps the strengths of both sides:

- Evolver remains the long-horizon signal generator.
- Codex remains the direct execution engine.
- `agent-evolution-protocol` remains the main reasoning layer for retrospective improvement.
- Stable rules stay intentionally smaller and higher trust than the raw evolution stream.

## Important limitation

This setup does not recreate OpenClaw's native host behavior. It gives you a practical adaptation that stays within the same boundary described by Hermes/OpenClaw-style READMEs: host-native session spawning and memory services stay host-specific, while this workspace only preserves, translates, and reuses those signals through local files.

- OpenClaw: `sessions_spawn(...)` can be auto-interpreted by the host.
- This workspace: `sessions_spawn(...)` is captured, preserved, and translated into explicit Codex-side work plus auditable delegate suggestions.
