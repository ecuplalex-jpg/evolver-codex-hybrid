#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "" ]; then
  echo "Usage: bash install.sh /path/to/target-workspace" >&2
  exit 1
fi

PACKAGE_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="$(cd "$1" && pwd)"

SKILL_TARGET="$TARGET_DIR/.agents/skills/evolver-codex-hybrid"
SCRIPTS_TARGET="$TARGET_DIR/scripts"
BASE_DIR="$TARGET_DIR/evolver-hybrid"

fail_unsafe_path() {
  echo "Refusing unsafe installer path: $1" >&2
  exit 1
}

assert_managed_dir() {
  if [ -L "$1" ] || { [ -e "$1" ] && [ ! -d "$1" ]; }; then
    fail_unsafe_path "$1"
  fi
}

assert_managed_file() {
  if [ -L "$1" ] || { [ -e "$1" ] && [ ! -f "$1" ]; }; then
    fail_unsafe_path "$1"
  fi
}

for managed_dir in \
  "$TARGET_DIR/.agents" \
  "$TARGET_DIR/.agents/skills" \
  "$SKILL_TARGET" \
  "$SCRIPTS_TARGET" \
  "$BASE_DIR" \
  "$BASE_DIR/artifacts" \
  "$BASE_DIR/artifacts/gene-candidates" \
  "$BASE_DIR/artifacts/promotion-packets" \
  "$BASE_DIR/inbox" \
  "$BASE_DIR/memory" \
  "$BASE_DIR/memory/agent-genes" \
  "$BASE_DIR/raw"
do
  assert_managed_dir "$managed_dir"
done

mkdir -p \
  "$SKILL_TARGET" \
  "$SCRIPTS_TARGET" \
  "$BASE_DIR/artifacts/gene-candidates" \
  "$BASE_DIR/artifacts/promotion-packets" \
  "$BASE_DIR/inbox" \
  "$BASE_DIR/memory/agent-genes" \
  "$BASE_DIR/raw"

for managed_dir in \
  "$TARGET_DIR/.agents" \
  "$TARGET_DIR/.agents/skills" \
  "$SKILL_TARGET" \
  "$SCRIPTS_TARGET" \
  "$BASE_DIR" \
  "$BASE_DIR/artifacts" \
  "$BASE_DIR/artifacts/gene-candidates" \
  "$BASE_DIR/artifacts/promotion-packets" \
  "$BASE_DIR/inbox" \
  "$BASE_DIR/memory" \
  "$BASE_DIR/memory/agent-genes" \
  "$BASE_DIR/raw"
do
  assert_managed_dir "$managed_dir"
done

for managed_file in \
  "$SKILL_TARGET/SKILL.md" \
  "$SCRIPTS_TARGET/evolver_codex_bridge.js" \
  "$SCRIPTS_TARGET/index_codex_sessions.js" \
  "$SCRIPTS_TARGET/record_execution_feedback.js" \
  "$BASE_DIR/.gitignore" \
  "$BASE_DIR/memory/stable-rules.md" \
  "$BASE_DIR/memory/execution-feedback.ndjson" \
  "$BASE_DIR/memory/evolution-events.ndjson" \
  "$BASE_DIR/memory/task-session-index.ndjson" \
  "$BASE_DIR/memory/codex-session-index.ndjson" \
  "$BASE_DIR/artifacts/next-prompt.md" \
  "$BASE_DIR/artifacts/next-actions.json" \
  "$BASE_DIR/artifacts/delegate-suggestions.json" \
  "$BASE_DIR/artifacts/feedback-insights.md" \
  "$BASE_DIR/artifacts/debrief-reminder.md" \
  "$BASE_DIR/inbox/next-task.md" \
  "$BASE_DIR/raw/latest-evolver-output.txt"
do
  assert_managed_file "$managed_file"
done

cp "$PACKAGE_DIR/skills/evolver-codex-hybrid/SKILL.md" "$SKILL_TARGET/SKILL.md"
cp "$PACKAGE_DIR/scripts/evolver_codex_bridge.js" "$SCRIPTS_TARGET/evolver_codex_bridge.js"
cp "$PACKAGE_DIR/scripts/index_codex_sessions.js" "$SCRIPTS_TARGET/index_codex_sessions.js"
cp "$PACKAGE_DIR/scripts/record_execution_feedback.js" "$SCRIPTS_TARGET/record_execution_feedback.js"

if [ ! -e "$BASE_DIR/.gitignore" ]; then
  cat > "$BASE_DIR/.gitignore" <<'EOF'
*
!.gitignore
EOF
fi

if [ ! -e "$BASE_DIR/memory/stable-rules.md" ]; then
  cat > "$BASE_DIR/memory/stable-rules.md" <<'EOF'
# Stable Rules

Promote only lessons that survived at least one real task.

## Rules
EOF
fi

if [ ! -e "$BASE_DIR/artifacts/next-prompt.md" ]; then
  cat > "$BASE_DIR/artifacts/next-prompt.md" <<'EOF'
# Next Prompt

No active distilled prompt yet.

Run the bridge or maintenance workflow first.
EOF
fi

if [ ! -e "$BASE_DIR/artifacts/next-actions.json" ]; then
  cat > "$BASE_DIR/artifacts/next-actions.json" <<'EOF'
[]
EOF
fi

if [ ! -e "$BASE_DIR/artifacts/delegate-suggestions.json" ]; then
  cat > "$BASE_DIR/artifacts/delegate-suggestions.json" <<'EOF'
[]
EOF
fi

if [ ! -e "$BASE_DIR/artifacts/feedback-insights.md" ]; then
  cat > "$BASE_DIR/artifacts/feedback-insights.md" <<'EOF'
# Feedback Insights

No feedback insights generated yet.
EOF
fi

if [ ! -e "$BASE_DIR/artifacts/debrief-reminder.md" ]; then
  cat > "$BASE_DIR/artifacts/debrief-reminder.md" <<'EOF'
# Debrief Reminder

No debrief reminder generated yet.
EOF
fi

if [ ! -e "$BASE_DIR/inbox/next-task.md" ]; then
  cat > "$BASE_DIR/inbox/next-task.md" <<'EOF'
# Next Task

Review `../memory/stable-rules.md` first, then refresh bridge artifacts as needed.
EOF
fi

if [ ! -e "$BASE_DIR/raw/latest-evolver-output.txt" ]; then
  cat > "$BASE_DIR/raw/latest-evolver-output.txt" <<'EOF'
# Paste or write fresh Evolver-style output here before ingesting.
EOF
fi

for memory_log in \
  "$BASE_DIR/memory/execution-feedback.ndjson" \
  "$BASE_DIR/memory/evolution-events.ndjson" \
  "$BASE_DIR/memory/task-session-index.ndjson" \
  "$BASE_DIR/memory/codex-session-index.ndjson"
do
  if [ ! -e "$memory_log" ]; then
    : > "$memory_log"
  fi
done

echo "Installed evolver-codex-hybrid into: $TARGET_DIR"
echo "Skill: $SKILL_TARGET/SKILL.md"
echo "Bridge script: $SCRIPTS_TARGET/evolver_codex_bridge.js"
echo "Base dir: $BASE_DIR"
