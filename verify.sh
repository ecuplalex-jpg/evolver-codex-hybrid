#!/usr/bin/env bash
set -euo pipefail

PACKAGE_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/evolver-codex-hybrid-verify.XXXXXX")"

cleanup() {
  if [ -n "${TEMP_DIR:-}" ] && [ -d "$TEMP_DIR" ]; then
    rm -rf -- "$TEMP_DIR"
  fi
}
trap cleanup EXIT

fail() {
  echo "VERIFY FAIL: $1" >&2
  exit 1
}

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    fail "no SHA-256 command found"
  fi
}

EXPECTED_FILES=(
  ".github/workflows/ci.yml"
  ".gitignore"
  "INSTALL.md"
  "LICENSE"
  "README.md"
  "docs/evolver-codex-hybrid.md"
  "install.sh"
  "scripts/evolver_codex_bridge.js"
  "scripts/index_codex_sessions.js"
  "scripts/record_execution_feedback.js"
  "skills/evolver-codex-hybrid/SKILL.md"
  "verify.sh"
)

for relative_path in "${EXPECTED_FILES[@]}"; do
  target="$PACKAGE_DIR/$relative_path"
  [ -f "$target" ] || fail "missing expected file: $relative_path"
  [ ! -L "$target" ] || fail "expected file is a symbolic link: $relative_path"
done

printf '%s\n' "${EXPECTED_FILES[@]}" | LC_ALL=C sort > "$TEMP_DIR/expected-files.txt"
(
  cd "$PACKAGE_DIR"
  find . -type f \
    -not -path './.git/*' \
    -not -path './.agent-work/*' \
    -print | sed 's#^\./##' | LC_ALL=C sort
) > "$TEMP_DIR/actual-files.txt"
comm -3 "$TEMP_DIR/expected-files.txt" "$TEMP_DIR/actual-files.txt" > "$TEMP_DIR/tree-diff.txt"
if [ -s "$TEMP_DIR/tree-diff.txt" ]; then
  sed -n '1,80p' "$TEMP_DIR/tree-diff.txt" >&2
  fail "public tree differs from the file allowlist"
fi

(
  cd "$PACKAGE_DIR"
  find . -type l \
    -not -path './.git/*' \
    -not -path './.agent-work/*' \
    -print
) > "$TEMP_DIR/public-symlinks.txt"
if [ -s "$TEMP_DIR/public-symlinks.txt" ]; then
  sed -n '1,80p' "$TEMP_DIR/public-symlinks.txt" >&2
  fail "public tree contains a symbolic link"
fi

bash -n "$PACKAGE_DIR/install.sh"
bash -n "$PACKAGE_DIR/verify.sh"
node --check "$PACKAGE_DIR/scripts/evolver_codex_bridge.js"
node --check "$PACKAGE_DIR/scripts/index_codex_sessions.js"
node --check "$PACKAGE_DIR/scripts/record_execution_feedback.js"

SKILL_FILE="$PACKAGE_DIR/skills/evolver-codex-hybrid/SKILL.md"
[ "$(sed -n '1p' "$SKILL_FILE")" = "---" ] || fail "SKILL.md frontmatter is missing"
grep -q '^name: evolver-codex-hybrid$' "$SKILL_FILE" || fail "SKILL.md name is invalid"
grep -q '^description:' "$SKILL_FILE" || fail "SKILL.md description is missing"

PRIVACY_PATTERN='maji1|/Users/[A-Za-z0-9._-]+/|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|wxid_[A-Za-z0-9_]+'
SCAN_FILES=(
  "$PACKAGE_DIR/README.md"
  "$PACKAGE_DIR/INSTALL.md"
  "$PACKAGE_DIR/docs/evolver-codex-hybrid.md"
  "$PACKAGE_DIR/install.sh"
  "$PACKAGE_DIR/skills/evolver-codex-hybrid/SKILL.md"
  "$PACKAGE_DIR/scripts/evolver_codex_bridge.js"
  "$PACKAGE_DIR/scripts/index_codex_sessions.js"
  "$PACKAGE_DIR/scripts/record_execution_feedback.js"
)
if grep -nE "$PRIVACY_PATTERN" "${SCAN_FILES[@]}" > "$TEMP_DIR/privacy-hits.txt"; then
  sed -n '1,80p' "$TEMP_DIR/privacy-hits.txt" >&2
  fail "possible private path, identifier, or credential found"
fi

FRESH_TARGET="$TEMP_DIR/fresh-target"
mkdir -p "$FRESH_TARGET"
bash "$PACKAGE_DIR/install.sh" "$FRESH_TARGET" > "$TEMP_DIR/install-fresh.log"

cmp "$PACKAGE_DIR/skills/evolver-codex-hybrid/SKILL.md" "$FRESH_TARGET/.agents/skills/evolver-codex-hybrid/SKILL.md"
cmp "$PACKAGE_DIR/scripts/evolver_codex_bridge.js" "$FRESH_TARGET/scripts/evolver_codex_bridge.js"
cmp "$PACKAGE_DIR/scripts/index_codex_sessions.js" "$FRESH_TARGET/scripts/index_codex_sessions.js"
cmp "$PACKAGE_DIR/scripts/record_execution_feedback.js" "$FRESH_TARGET/scripts/record_execution_feedback.js"
[ "$(sed -n '1p' "$FRESH_TARGET/evolver-hybrid/.gitignore")" = "*" ] || fail "runtime .gitignore does not fail private"
[ "$(sed -n '2p' "$FRESH_TARGET/evolver-hybrid/.gitignore")" = "!.gitignore" ] || fail "runtime .gitignore does not preserve itself"
if command -v git >/dev/null 2>&1; then
  git -C "$FRESH_TARGET" init -q
  git -C "$FRESH_TARGET" check-ignore -q evolver-hybrid/memory/stable-rules.md || fail "runtime state is not ignored by Git"
  if git -C "$FRESH_TARGET" check-ignore -q evolver-hybrid/.gitignore; then
    fail "runtime .gitignore hides itself from Git"
  fi
fi

STABLE_RULES="$FRESH_TARGET/evolver-hybrid/memory/stable-rules.md"
STABLE_BEFORE="$(sha256_file "$STABLE_RULES")"
(
  cd "$FRESH_TARGET"
  node scripts/evolver_codex_bridge.js --run-maintenance safe --format json
) > "$TEMP_DIR/maintenance-safe.log"
[ "$STABLE_BEFORE" = "$(sha256_file "$STABLE_RULES")" ] || fail "safe maintenance changed stable rules"
grep -Eq '"target"[[:space:]]*:[[:space:]]*"safe"' "$TEMP_DIR/maintenance-safe.log" || fail "explicit safe maintenance did not report target=safe"
if grep -q 'candidate-promotion' "$TEMP_DIR/maintenance-safe.log"; then
  fail "explicit safe maintenance ran candidate promotion"
fi

(
  cd "$FRESH_TARGET"
  node scripts/evolver_codex_bridge.js --run-maintenance --format json
) > "$TEMP_DIR/maintenance-implicit-safe.log"
[ "$STABLE_BEFORE" = "$(sha256_file "$STABLE_RULES")" ] || fail "implicit safe maintenance changed stable rules"
grep -Eq '"target"[[:space:]]*:[[:space:]]*"safe"' "$TEMP_DIR/maintenance-implicit-safe.log" || fail "implicit maintenance did not default to safe"
if grep -q 'candidate-promotion' "$TEMP_DIR/maintenance-implicit-safe.log"; then
  fail "implicit safe maintenance ran candidate promotion"
fi

if (
  cd "$FRESH_TARGET"
  node scripts/evolver_codex_bridge.js --promote-rule "unreviewed rule"
) > "$TEMP_DIR/direct-promotion.log" 2>&1; then
  fail "free-text direct promotion unexpectedly succeeded"
fi

printf '%s\n' '{"recent_change_learning_queue":[{"id":"portable-fixture","updated_at":"2026-01-01T00:00:00Z","first_user_message":"workspace-specific candidate","path":"fixture/session.jsonl","task_families":["generic"]}]}' \
  > "$FRESH_TARGET/evolver-hybrid/artifacts/codex-history-review.json"
(
  cd "$FRESH_TARGET"
  node scripts/evolver_codex_bridge.js --build-candidate-promotion --format json
) > "$TEMP_DIR/portable-classifier.log"
node -e '
  const fs = require("fs");
  const rules = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const result = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const ignored = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
  if (!Array.isArray(rules.rules) || rules.rules.length !== 0) process.exit(1);
  if (result.classifications.length !== 1 || result.classifications[0].status !== "review-first") process.exit(1);
  if (!Array.isArray(ignored.entries) || ignored.entries.length !== 0) process.exit(1);
' \
  "$FRESH_TARGET/evolver-hybrid/memory/codex-candidate-promotion-rules.json" \
  "$FRESH_TARGET/evolver-hybrid/artifacts/codex-candidate-classification.json" \
  "$FRESH_TARGET/evolver-hybrid/memory/codex-candidate-ignore.json" \
  || fail "portable classifier did not stay empty and review-first"

HELP_OUTPUT="$(cd "$FRESH_TARGET" && node scripts/evolver_codex_bridge.js --help)"
printf '%s\n' "$HELP_OUTPUT" | grep -q -- '--build-promotion-packet' || fail "promotion packet CLI is missing"
printf '%s\n' "$HELP_OUTPUT" | grep -q -- '--apply-approved-packet' || fail "approved packet CLI is missing"
printf '%s\n' "$HELP_OUTPUT" | grep -q -- '--run-maintenance' || fail "maintenance CLI is missing"

STATE_FILES=(
  "evolver-hybrid/.gitignore"
  "evolver-hybrid/memory/stable-rules.md"
  "evolver-hybrid/memory/execution-feedback.ndjson"
  "evolver-hybrid/memory/evolution-events.ndjson"
  "evolver-hybrid/memory/task-session-index.ndjson"
  "evolver-hybrid/memory/codex-session-index.ndjson"
  "evolver-hybrid/artifacts/next-prompt.md"
  "evolver-hybrid/artifacts/next-actions.json"
  "evolver-hybrid/artifacts/delegate-suggestions.json"
  "evolver-hybrid/artifacts/feedback-insights.md"
  "evolver-hybrid/artifacts/debrief-reminder.md"
  "evolver-hybrid/inbox/next-task.md"
  "evolver-hybrid/raw/latest-evolver-output.txt"
)

: > "$TEMP_DIR/state-before.txt"
for relative_path in "${STATE_FILES[@]}"; do
  printf 'sentinel:%s\n' "$relative_path" > "$FRESH_TARGET/$relative_path"
  printf '%s  %s\n' "$(sha256_file "$FRESH_TARGET/$relative_path")" "$relative_path" >> "$TEMP_DIR/state-before.txt"
done

bash "$PACKAGE_DIR/install.sh" "$FRESH_TARGET" > "$TEMP_DIR/install-repeat.log"
: > "$TEMP_DIR/state-after.txt"
for relative_path in "${STATE_FILES[@]}"; do
  printf '%s  %s\n' "$(sha256_file "$FRESH_TARGET/$relative_path")" "$relative_path" >> "$TEMP_DIR/state-after.txt"
done
cmp "$TEMP_DIR/state-before.txt" "$TEMP_DIR/state-after.txt" || fail "reinstall changed preserved state"

UNSAFE_DIR_TARGET="$TEMP_DIR/unsafe-dir-target"
UNSAFE_DIR_OUTSIDE="$TEMP_DIR/unsafe-dir-outside"
mkdir -p "$UNSAFE_DIR_TARGET" "$UNSAFE_DIR_OUTSIDE"
ln -s "$UNSAFE_DIR_OUTSIDE" "$UNSAFE_DIR_TARGET/.agents"
if bash "$PACKAGE_DIR/install.sh" "$UNSAFE_DIR_TARGET" > "$TEMP_DIR/unsafe-dir.log" 2>&1; then
  fail "installer followed a managed directory symlink"
fi
[ -z "$(find "$UNSAFE_DIR_OUTSIDE" -mindepth 1 -print -quit)" ] || fail "directory symlink probe wrote outside the target"

UNSAFE_FILE_TARGET="$TEMP_DIR/unsafe-file-target"
UNSAFE_FILE_OUTSIDE="$TEMP_DIR/unsafe-file-outside.txt"
mkdir -p "$UNSAFE_FILE_TARGET/evolver-hybrid/memory"
printf 'outside-sentinel\n' > "$UNSAFE_FILE_OUTSIDE"
ln -s "$UNSAFE_FILE_OUTSIDE" "$UNSAFE_FILE_TARGET/evolver-hybrid/memory/stable-rules.md"
if bash "$PACKAGE_DIR/install.sh" "$UNSAFE_FILE_TARGET" > "$TEMP_DIR/unsafe-file.log" 2>&1; then
  fail "installer followed a managed file symlink"
fi
[ "$(sed -n '1p' "$UNSAFE_FILE_OUTSIDE")" = "outside-sentinel" ] || fail "file symlink probe changed the outside file"

echo "VERIFY PASS"
echo "- public file allowlist: ${#EXPECTED_FILES[@]} files"
echo "- shell and Node syntax: pass"
echo "- skill metadata and privacy scan: pass"
echo "- fresh install and safe maintenance: pass"
echo "- installed runtime Git-ignore protection: pass"
echo "- 13-file reinstall no-clobber replay: pass"
echo "- directory and file symlink probes: pass"
echo "- free-text promotion rejection: pass"
echo "- portable empty-default classifier replay: pass"
