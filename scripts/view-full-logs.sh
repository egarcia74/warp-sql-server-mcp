#!/bin/bash

# View ALL MCP logs with pretty-printing (no following)
# Usage: ./scripts/view-full-logs.sh

LOG_FILE="$HOME/Library/Application Support/dev.warp.Warp-Stable/mcp/4TWzM7mOVXXOyIpZpvksyN.log"

if [[ ! -f "$LOG_FILE" ]]; then
    echo "❌ Log file not found: $LOG_FILE"
    echo "💡 Check your Warp MCP configuration for the correct log path"
    exit 1
fi

echo "📋 Viewing ALL MCP logs with JSON pretty-printing..."
echo "📁 Log file: $LOG_FILE"
echo "📊 Total lines: $(wc -l < "$LOG_FILE")"
echo ""

cat "$LOG_FILE" | while IFS= read -r line; do
    # Skip blank lines
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    # Handle MCP protocol messages with JSON pretty-printing
    if [[ "$line" =~ "MCP CLI: Sending request:" ]] || [[ "$line" =~ "MCP CLI: Received response:" ]] || [[ "$line" =~ "MCP CLI: Sending notification:" ]]; then
        # Extract timestamp and message type
        timestamp=$(echo "$line" | cut -d' ' -f1-4)
        
        # Extract JSON from the message
        json_part=$(echo "$line" | grep -o '{.*}' | tail -1)
        
        # Determine message type and show summary
        if [[ "$line" =~ "tools/list" ]]; then
            echo "${timestamp} [info] 🔧 MCP: Requesting available tools"
        elif [[ "$line" =~ "notifications/initialized" ]]; then
            echo "${timestamp} [info] 🚀 MCP: Connection initialized"
        elif [[ "$line" =~ "tools/call" ]]; then
            echo "${timestamp} [info] ⚡ MCP: Tool execution request"
        elif [[ "$line" =~ "Sending request:" ]]; then
            echo "${timestamp} [info] 📤 MCP: Sending request"
        elif [[ "$line" =~ "Received response:" ]]; then
            echo "${timestamp} [info] 📥 MCP: Received response"
        elif [[ "$line" =~ "Sending notification:" ]]; then
            echo "${timestamp} [info] 📢 MCP: Sending notification"
        else
            echo "${timestamp} [info] 🔄 MCP: Protocol message"
        fi
        
        # Pretty print the JSON if found and jq is available
        if [[ -n "$json_part" ]]; then
            # Handle escaped JSON (unescape quotes)
            unescaped_json=$(echo "$json_part" | sed 's/\\"/"/g')
            
            if command -v jq &> /dev/null; then
                if ! echo "$unescaped_json" | jq . 2>/dev/null; then
                    # If unescaping didn't work, try original
                    if ! echo "$json_part" | jq . 2>/dev/null; then
                        echo "   ⚠️ JSON formatting skipped (escaped): notifications message"
                    fi
                fi
            else
                # Fallback: basic formatting without jq
                if ! echo "$unescaped_json" | python3 -m json.tool 2>/dev/null; then
                    if ! echo "$json_part" | python3 -m json.tool 2>/dev/null; then
                        echo "   ⚠️ JSON formatting skipped (escaped): notifications message"
                    fi
                fi
            fi
        fi
        continue
    fi
    
    # For your server messages (stderr), show them cleanly
    if [[ "$line" =~ "stderr:" ]]; then
        # Extract timestamp and the actual message
        timestamp=$(echo "$line" | grep -o '^[^|]*|[^|]*|')
        message=$(echo "$line" | sed 's/^.*stderr: //')
        echo "${timestamp} [server] $message"
        continue
    fi
    
    # Handle any remaining JSON (from tool responses)
    if [[ "$line" =~ \{.*\} ]]; then
        # Extract timestamp and prefix
        prefix=$(echo "$line" | sed -E 's/^([^{]*)\{.*$/\1/')
        json=$(echo "$line" | grep -o '{.*}')
        
        # Pretty print the JSON part
        if command -v jq &> /dev/null; then
            echo "$prefix"
            echo "$json" | jq . 2>/dev/null || echo "$json"
        else
            # Fallback: basic formatting without jq
            echo "$prefix"
            echo "$json" | python3 -m json.tool 2>/dev/null || echo "$json"
        fi
    else
        # Non-JSON lines, print as-is
        echo "$line"
    fi
done
