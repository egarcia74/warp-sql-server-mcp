#!/bin/bash

# Pretty-print MCP logs for easier debugging
# Usage: ./scripts/pretty-logs.sh

LOG_FILE="$HOME/Library/Application Support/dev.warp.Warp-Stable/mcp/4TWzM7mOVXXOyIpZpvksyN.log"

if [[ ! -f "$LOG_FILE" ]]; then
    echo "❌ Log file not found: $LOG_FILE"
    echo "💡 Check your Warp MCP configuration for the correct log path"
    exit 1
fi

echo "📋 Following MCP logs with JSON pretty-printing..."
echo "📁 Log file: $LOG_FILE"
echo "🔄 Press Ctrl+C to stop"
echo ""

# Show last 1000 lines initially, then follow new ones
tail -n 1000 -f "$LOG_FILE" | while IFS= read -r line; do
    # Skip blank lines
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    
    # Check if this is an MCP protocol message that we want to replace entirely
    if [[ "$line" =~ "MCP CLI: Sending request:" ]] || [[ "$line" =~ "MCP CLI: Received response:" ]] || [[ "$line" =~ "MCP CLI: Sending notification:" ]]; then
        # Extract timestamp and message type  
        timestamp=$(echo "$line" | cut -d' ' -f1-3)
        
        # Extract JSON from the message
        json_part=$(echo "$line" | grep -o '{.*}' | tail -1)
        
        # Show our clean summary instead of the ugly raw line
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
        
        # Pretty print the JSON if found
        if [[ -n "$json_part" ]]; then
            if command -v jq &> /dev/null; then
                if ! echo "$json_part" | jq . 2>/dev/null; then
                    echo "   ❌ JSON formatting failed: $json_part"
                fi
            else
                # Fallback: basic formatting without jq
                if ! echo "$json_part" | python3 -m json.tool 2>/dev/null; then
                    echo "   ❌ JSON formatting failed: $json_part"
                fi
            fi
        fi
        # Continue to skip processing this line further
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
        continue
    fi
    
    # For all other lines, just print them as-is
    echo "$line"
done
