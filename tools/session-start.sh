#!/bin/sh
# Claude Code の SessionStart の hook（.claude/settings.json）から呼ぶ。リモートを取り寄せ、手元の main と
# いまのブランチが origin/main より遅れていれば、その数をエージェントに知らせる（出力がそのまま文脈に入る）。
# 遅れがなければ何も出さない。取り寄せに失敗しても止めない（hook の timeout で切る）。
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/..}" 2>/dev/null || exit 0
git fetch -q origin 2>/dev/null || { echo "（git fetch に失敗した。origin/main は古いかもしれない）"; exit 0; }
behind() { git rev-list --count "$1..origin/main" 2>/dev/null || echo 0; }
main_behind=$(behind main)
[ "$main_behind" -gt 0 ] && echo "手元の main は origin/main より ${main_behind} コミット遅れている。作業の前に git pull --ff-only する。"
cur=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
if [ -n "$cur" ] && [ "$cur" != main ] && [ "$cur" != HEAD ]; then
  cur_behind=$(behind "$cur")
  [ "$cur_behind" -gt 0 ] && echo "いまのブランチ ${cur} は origin/main より ${cur_behind} コミット遅れている。"
fi
exit 0
