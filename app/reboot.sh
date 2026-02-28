#!/bin/bash
echo "Killing dev server..."
lsof -ti :5173 | xargs kill -9 2>/dev/null
sleep 1
echo "Starting dev server..."
bun run dev
