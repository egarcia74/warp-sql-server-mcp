#!/bin/bash

# Pretty-print MCP logs with detailed JSON formatting
# Usage: 
#   ./scripts/pretty-logs-detailed.sh           # Live following with pretty JSON
#   ./scripts/pretty-logs-detailed.sh --compact # Live following with compact summaries
#   ./scripts/pretty-logs-detailed.sh --help    # Show usage

LOG_FILE="$HOME/Library/Application Support/dev.warp.Warp-Stable/mcp/4TWzM7mOVXXOyIpZpvksyN.log"

# Parse command line arguments
COMPACT_MODE=false
HELP_MODE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --compact)
            COMPACT_MODE=true
            shift
            ;;
        --help|-h)
            HELP_MODE=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

if [[ "$HELP_MODE" == true ]]; then
    echo "📋 Pretty-print MCP logs with detailed JSON formatting"
    echo ""
    echo "Usage:"
    echo "  $0                # Live following with pretty-printed JSON"
    echo "  $0 --compact     # Live following with compact summaries only"
    echo "  $0 --help        # Show this help message"
    echo ""
    echo "Features:"
    echo "  🎯 Real-time log following"
    echo "  📄 JSON pretty-printing with jq (if available)"
    echo "  🧹 Blank line filtering"
    echo "  📊 MCP protocol message summaries"
    echo "  🎨 Color-coded message types"
    exit 0
fi

if [[ ! -f "$LOG_FILE" ]]; then
    echo "❌ Log file not found: $LOG_FILE"
    echo "💡 Check your Warp MCP configuration for the correct log path"
    exit 1
fi

if [[ "$COMPACT_MODE" == true ]]; then
    echo "📋 Following MCP logs (COMPACT mode - summaries only)..."
else
    echo "📋 Following MCP logs (DETAILED mode - with pretty JSON)..."
fi
echo "📁 Log file: $LOG_FILE"
echo "🔄 Press Ctrl+C to stop"
echo ""

# Show last 1000 lines initially, then follow new ones
tail -n 1000 -f "$LOG_FILE" | while IFS= read -r line; do
    # Skip blank lines
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    
    # Handle MCP protocol messages
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
        
        # Pretty print the JSON if not in compact mode
        if [[ "$COMPACT_MODE" == false && -n "$json_part" ]]; then
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
            echo ""  # Add spacing after JSON
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
        if [[ "$COMPACT_MODE" == false ]]; then
            if command -v jq &> /dev/null; then
                echo "$prefix"
                echo "$json" | jq . 2>/dev/null || echo "$json"
                echo ""  # Add spacing after JSON
            else
                # Fallback: basic formatting without jq
                echo "$prefix"
                echo "$json" | python3 -m json.tool 2>/dev/null || echo "$json"
                echo ""  # Add spacing after JSON
            fi
        else
            # Compact mode - just show prefix
            echo "$prefix [JSON data]"
        fi
    else
        # Non-JSON lines, print as-is
        echo "$line"
    fi
done
