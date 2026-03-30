#!/bin/bash
# Set up ccproxy on VPS
# Usage: ssh root@165.227.120.122 'bash -s' < setup-ccproxy-vps.sh
#
# After this script, SSH in and run:
#   ccproxy auth login claude
# It prints a URL — open it in your local browser to complete OAuth.

set -e

echo "=== Installing ccproxy ==="
apt-get update -qq && apt-get install -y -qq pipx python3-venv > /dev/null 2>&1
pipx ensurepath
export PATH="$PATH:/root/.local/bin"
pipx install ccproxy-api 2>/dev/null || pipx upgrade ccproxy-api

echo "=== Creating systemd service ==="
cat > /etc/systemd/system/ccproxy.service << 'EOF'
[Unit]
Description=ccproxy - Claude API proxy
After=network.target

[Service]
Type=simple
ExecStart=/root/.local/bin/ccproxy serve --port 8003 --host 127.0.0.1
Restart=always
RestartSec=5
Environment=HOME=/root
Environment=PATH=/root/.local/bin:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable ccproxy

echo ""
echo "=== Done! Next steps: ==="
echo "1. SSH into the VPS:  ssh root@165.227.120.122"
echo "2. Run:               ccproxy auth login claude"
echo "3. Open the URL it prints in your local browser"
echo "4. Complete the OAuth flow"
echo "5. Start the service: systemctl start ccproxy"
echo "6. Verify:            curl http://127.0.0.1:8003/health"
