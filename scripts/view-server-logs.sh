#!/bin/bash

# View only server messages from MCP logs (filters out MCP protocol noise)
# Usage: ./scripts/view-server-logs.sh

LOG_FILE="$HOME/Library/Application Support/dev.warp.Warp-Stable/mcp/4TWzM7mOVXXOyIpZpvksyN.log"

if [[ ! -f "$LOG_FILE" ]]; then
    echo "❌ Log file not found: $LOG_FILE"
    echo "💡 Check your Warp MCP configuration for the correct log path"
    exit 1
fi

echo "📋 Viewing SERVER messages from MCP logs..."
echo "📁 Log file: $LOG_FILE"
echo "🔍 Filtering: Only server stderr messages"
echo ""

grep "stderr:" "$LOG_FILE" | while IFS= read -r line; do
    # Skip blank lines (shouldn't be any in grep results, but for consistency)
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    # Extract timestamp and the actual message
    timestamp=$(echo "$line" | grep -o '^[^|]*|[^|]*|')
    message=$(echo "$line" | sed 's/^.*stderr: //')
    echo "${timestamp} [server] $message"
done
