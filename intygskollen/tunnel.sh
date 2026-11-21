#!/bin/sh
# Keeps a Cloudflare quick tunnel to the local server alive. Uses http2 (TCP), which survives flaky venue wifi
# better than QUIC/UDP. Quick tunnels get a new random URL on every start: the current one is in tunnel-url.txt.
cd "$(dirname "$0")"
while true; do
  ~/.local/bin/cloudflared tunnel --no-autoupdate --protocol http2 --url http://localhost:${PORT:-3000} 2>&1 | while read -r line; do
    echo "$line" >> tunnel.log
    url=$(echo "$line" | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com')
    [ -n "$url" ] && echo "$url" > tunnel-url.txt && echo "TUNNEL $url"
  done
  echo "tunnel exited, restarting in 3 s" >> tunnel.log; sleep 3
done
