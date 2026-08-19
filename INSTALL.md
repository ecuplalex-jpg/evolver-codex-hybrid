# Installation Guide

This package installs the `evolver-codex-hybrid` skill into another workspace.

## Quick install

From the package root, run:

```bash
bash install.sh /path/to/target-workspace
```

## What gets installed

The installer writes:

```text
<target-workspace>/
├── .agents/
│   └── skills/
│       └── evolver-codex-hybrid/
│           └── SKILL.md
├── scripts/
│   ├── evolver_codex_bridge.js
│   ├── index_codex_sessions.js
│   └── record_execution_feedback.js
└── evolver-hybrid/
    ├── .gitignore
    ├── artifacts/
    ├── inbox/
    ├── memory/
    └── raw/
```

Reinstall behavior is fail-closed for workspace state:

- package-owned skill and script files are refreshed so the CLI and operator contract stay in sync;
- the runtime `.gitignore` ignores everything below `evolver-hybrid/` by default so session summaries, rules, feedback, and raw input are not accidentally committed;
- existing `.gitignore`, memory, artifact, inbox, and raw-input files are preserved byte-for-byte; defaults are created only when a target is missing;
- managed directories and files must not be symbolic links or unexpected file types. The installer stops instead of following them outside the target workspace.

## Verify installation

Before installing, verify the package itself:

```bash
bash verify.sh
```

The verifier is self-contained and uses only Bash, Node.js, and standard Unix utilities. It checks the public file allowlist, privacy patterns, syntax, a fresh isolated install, safe maintenance, reinstall no-clobber behavior, symlink escapes, and direct-promotion rejection.

After installation, the target workspace should contain:

1. `.agents/skills/evolver-codex-hybrid/SKILL.md`
2. `scripts/evolver_codex_bridge.js`
3. `evolver-hybrid/memory/stable-rules.md`

Then test from the target workspace:

```bash
node scripts/evolver_codex_bridge.js --run-maintenance safe --format markdown
```

If the install is correct, the command should refresh local maintenance artifacts under `evolver-hybrid/artifacts/` without running candidate classification. Use `all` only during an explicitly reviewed promotion pass.

The public package intentionally starts with no candidate-classification rules. On the first candidate-classification run, the bridge creates `evolver-hybrid/memory/codex-candidate-promotion-rules.json` with an empty `rules` array. Until you add workspace-specific deterministic rules, candidates remain `review-first` and are not automatically skipped, handled, or proposed as stable rules.

## Suggested first use in Codex

Ask Codex something like:

```text
请检查这个工作区里的 evolver-hybrid 桥接配置，并说明下一步应该先读哪些本地产物。
```

If the skill is active, Codex should route into `evolver-codex-hybrid` and prioritize local bridge artifacts instead of giving a generic retrospective answer.

## Publish tip

If you put this package on GitHub, keep the repository root at this folder level so another Codex can clone it and immediately run:

```bash
bash install.sh /path/to/target-workspace
```

Do not publish the generated `evolver-hybrid/` runtime directory. It contains local state and is intentionally ignored by this repository.
