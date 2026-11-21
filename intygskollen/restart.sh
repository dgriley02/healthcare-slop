#!/bin/sh
# Restart only the Node server (the process LISTENING on the port), never the tunnel connected to it.
cd "$(dirname "$0")"
kill $(lsof -ti tcp:${PORT:-3000} -sTCP:LISTEN) 2>/dev/null; sleep 0.5
nohup node server.mjs > server.log 2>&1 &
