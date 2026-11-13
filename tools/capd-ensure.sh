#!/bin/zsh
# Make sure exactly one capture daemon is running. Safe to call any time, from any agent.
# It never stops a healthy daemon. Only the lead stops it (touch tools/queue/STOP).
ROOT="${0:A:h:h}"
Q="$ROOT/tools/queue"
SCR="${CAPD_SCRATCH:-${TMPDIR:-/tmp}/crimson-loong-capd}"
mkdir -p "$Q" "$SCR"
alive() { [[ -f "$Q/capd.pid" ]] && kill -0 "$(cat "$Q/capd.pid")" 2>/dev/null }
if alive; then echo "capd running (pid $(cat "$Q/capd.pid"))"; exit 0; fi
if ! mkdir "$Q/.startlock" 2>/dev/null; then
  # someone else is starting it right now, or a stale lock is left over (older than 60 s)
  if [[ -n "$(find "$Q/.startlock" -maxdepth 0 -mmin +1 2>/dev/null)" ]]; then rmdir "$Q/.startlock" 2>/dev/null; mkdir "$Q/.startlock" 2>/dev/null || { echo "could not take the start lock"; exit 1; }
  else sleep 8; alive && { echo "capd running (started by someone else)"; exit 0; }; echo "another start is in progress; try again in a few seconds"; exit 1; fi
fi
rm -f "$Q/STOP"
for f in "$Q"/*.run.json(N); do mv "$f" "${f%.run.json}.job.json"; done      # a job that died with the old daemon runs again
(CAPD_PROF="$SCR/prof" nohup node "$ROOT/tools/capd.mjs" >> "$SCR/capd.log" 2>&1 &)
for i in {1..40}; do sleep 0.5; alive && break; done
rmdir "$Q/.startlock" 2>/dev/null
if alive; then echo "capd started (pid $(cat "$Q/capd.pid"))"; else echo "capd failed to start; see $SCR/capd.log"; tail -5 "$SCR/capd.log"; exit 1; fi
