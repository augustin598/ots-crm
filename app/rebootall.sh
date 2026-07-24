#!/bin/bash
export PATH="$HOME/.bun/bin:$PATH"
cd "$(dirname "$0")" || exit 1

echo "Killing ALL dev servers..."

# Porturi Vite: 5173 + auto-increment (5174, 5175...) + 4173 (vite preview)
for port in 5173 5174 5175 5176 5177 5178 4173; do
  pids=$(lsof -ti :$port 2>/dev/null)
  if [ -n "$pids" ]; then
    echo "  port $port -> kill $pids"
    echo "$pids" | xargs kill -9 2>/dev/null
  fi
done

# Procese de dev ramase in background fara port (crash, zombie, worktree-uri)
pkill -9 -f "vite dev" 2>/dev/null && echo "  killed stray 'vite dev' processes"
pkill -9 -f "vite/bin/vite" 2>/dev/null && echo "  killed stray vite processes"
pkill -9 -f "bun run dev" 2>/dev/null && echo "  killed stray 'bun run dev' processes"

sleep 1
echo "Starting dev server..."
NODE_TLS_REJECT_UNAUTHORIZED=0 bun run dev --force
