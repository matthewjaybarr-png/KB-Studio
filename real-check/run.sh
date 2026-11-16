#!/bin/bash
# run.sh <binary> <script.js> <outdir> [seconds]: run a scenario in the real app on a hidden monitor
S=${KB_CHECK_HOME:-$HOME/.cache/kb-real-check}; mkdir -p $S/home
hyprctl monitors -j | grep -q SHOOTTEST || hyprctl output create headless SHOOTTEST >/dev/null
ws=$(hyprctl monitors -j | python3 -c "import json,sys;print(next(m['activeWorkspace']['name'] for m in json.load(sys.stdin) if m['name']=='SHOOTTEST'))")
mkdir -p "$3"; rm -f "$3"/*
(HOME=$S/home XDG_CONFIG_HOME=$S/home/.config XDG_DATA_HOME=$S/home/.local/share KB_STUDIO_TEST="$2" KB_STUDIO_TEST_OUT="$3" setsid "$1" >"$3/app.log" 2>&1 & echo $! > "$3/pid")
sleep 0.3; pid=$(cat "$3/pid")
for i in $(seq 40); do sleep 0.25; a=$(hyprctl clients -j | python3 -c "import json,sys;print(next((c['address'] for c in json.load(sys.stdin) if c['pid']==$pid),''))"); [ -n "$a" ] && break; done
[ -z "$a" ] && { echo "no window"; kill $pid; exit 1; }
hyprctl dispatch "hl.dsp.window.move({ workspace = \"$ws\", follow = false, window = \"address:$a\" })" >/dev/null
for i in $(seq ${4:-90}); do sleep 1; ls "$3"/*.json >/dev/null 2>&1 && break; done
sleep 1; grim -o SHOOTTEST -s 0.6 "$3/screen.png" 2>/dev/null
kill $pid; sleep 0.5
