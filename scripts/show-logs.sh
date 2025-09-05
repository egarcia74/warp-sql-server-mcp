#!/bin/bash

# Smart Log Viewer for Warp SQL Server MCP
# Automatically detects development vs production log paths and formats JSON logs
#
# Usage:
#   ./scripts/show-logs.sh [TYPE] [OPTIONS]
#   npm run logs [-- OPTIONS]
#   npm run logs:server [-- OPTIONS]
#   npm run logs:audit [-- OPTIONS]
#   npm run logs:tail          # Follow server logs
#   npm run logs:tail:server   # Follow server logs  
#   npm run logs:tail:audit    # Follow audit logs
#
# Types:
#   (none)    Show server logs (default)
#   server    Show server logs (same as default)
#   audit     Show security audit logs
#
# Options:
#   --follow, -f      Follow logs in real-time (like tail -f)
#   --all             Show all log entries (default shows last 50)
#   --compact, -c     Show compact format without JSON details
#   --help, -h        Show this help message

set -euo pipefail

# Default options
LOG_TYPE="server"
FOLLOW_MODE=false
ALL_MODE=false
COMPACT_MODE=false
HELP_MODE=false
MAX_LINES=50

# Color codes
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[0;33m'
readonly BLUE='\033[0;34m'
readonly PURPLE='\033[0;35m'
readonly CYAN='\033[0;36m'
readonly WHITE='\033[1;37m'
readonly GRAY='\033[0;90m'
readonly NC='\033[0m' # No Color

# Function to show help
show_help() {
    cat << 'EOF'
🔍 Smart Log Viewer for Warp SQL Server MCP

Automatically detects and displays MCP server logs from development or production paths
with intelligent JSON formatting and clean, readable output.

USAGE:
    ./scripts/show-logs.sh [TYPE] [OPTIONS]
    npm run logs [-- OPTIONS]
    npm run logs:server [-- OPTIONS]
    npm run logs:audit [-- OPTIONS]
    npm run logs:tail          # Follow server logs
    npm run logs:tail:server   # Follow server logs  
    npm run logs:tail:audit    # Follow audit logs

TYPES:
    (none)                    Show server logs (default)
    server                    Show server logs 
    audit                     Show security audit logs

OPTIONS:
    --follow, -f              Follow logs in real-time (like tail -f)
    --all                     Show all log entries (default shows last 50)
    --compact, -c             Show compact format without JSON details
    --help, -h                Show this help message

EXAMPLES:
    # Show recent server logs
    ./scripts/show-logs.sh
    ./scripts/show-logs.sh server

    # Show security audit logs
    ./scripts/show-logs.sh audit

    # Follow server logs in real-time
    ./scripts/show-logs.sh server --follow
    ./scripts/show-logs.sh --follow

    # Show all server logs in compact format
    ./scripts/show-logs.sh server --all --compact

    # NPM integration
    npm run logs
    npm run logs:server
    npm run logs:audit
    npm run logs:tail         # Follow server logs
    npm run logs:tail:server  # Follow server logs
    npm run logs:tail:audit   # Follow audit logs

FEATURES:
    🎯 Smart path detection (development vs production)
    📄 Clean JSON log formatting with proper indentation
    🎨 Color-coded log levels and timestamps
    📊 Intelligent message content display
    ⚡ Real-time log following
    🔍 Automatic log file discovery

SMART PATH DETECTION:
    Development:  ./logs/warp-sql-server-mcp.log
                  ./logs/warp-sql-server-mcp-security.log
    Production:   ~/.local/state/warp-sql-server-mcp/warp-sql-server-mcp.log
                  ~/.local/state/warp-sql-server-mcp/warp-sql-server-mcp-security.log

EOF
}

# Function to detect the correct log file path
get_log_path() {
    local log_type="$1"
    local dev_dir="./logs"
    local prod_dir="${XDG_STATE_HOME:-$HOME/.local/state}/warp-sql-server-mcp"
    
    case "$log_type" in
        "server")
            local dev_file="$dev_dir/warp-sql-server-mcp.log"
            local prod_file="$prod_dir/warp-sql-server-mcp.log"
            ;;
        "audit")
            local dev_file="$dev_dir/warp-sql-server-mcp-security.log"
            local prod_file="$prod_dir/warp-sql-server-mcp-security.log"
            ;;
        *)
            echo "❌ Invalid log type: $log_type"
            exit 1
            ;;
    esac
    
    # Check development path first
    if [[ -f "$dev_file" ]]; then
        echo "$dev_file"
    elif [[ -f "$prod_file" ]]; then
        echo "$prod_file"
    else
        echo ""
    fi
}

# Function to get log level color
get_level_color() {
    local level="$1"
    # Remove ANSI color codes from level
    level=$(echo "$level" | sed 's/\x1b\[[0-9;]*m//g')
    
    case "$level" in
        "error") echo "$RED" ;;
        "warn") echo "$YELLOW" ;;
        "info") echo "$GREEN" ;;
        "debug") echo "$BLUE" ;;
        *) echo "$WHITE" ;;
    esac
}

# Function to format timestamp
format_timestamp() {
    local timestamp="$1"
    # Convert ISO timestamp to readable format
    if command -v date >/dev/null 2>&1; then
        # Try to parse and reformat timestamp
        if [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS date command
            date -j -f "%Y-%m-%dT%H:%M:%S.%3NZ" "$timestamp" "+%m-%d %H:%M:%S" 2>/dev/null || echo "$timestamp"
        else
            # Linux date command
            date -d "$timestamp" "+%m-%d %H:%M:%S" 2>/dev/null || echo "$timestamp"
        fi
    else
        echo "$timestamp"
    fi
}

# Function to indent text
indent_text() {
    local indent="    "
    # Handle multi-line content by indenting each line from stdin or parameter
    if [[ $# -gt 0 ]]; then
        echo "$1" | sed "s/^/$indent/"
    else
        sed "s/^/$indent/"
    fi
}

# Function to format and display a JSON log entry
format_log_entry() {
    local json_line="$1"
    
    # Parse JSON fields
    local timestamp=$(echo "$json_line" | jq -r '.timestamp // empty')
    local level=$(echo "$json_line" | jq -r '.level // empty')
    local message=$(echo "$json_line" | jq -r '.message // empty')
    local service=$(echo "$json_line" | jq -r '.service // empty')
    
    # Skip empty or invalid entries
    [[ -z "$timestamp" && -z "$level" && -z "$message" ]] && return
    
    # Format timestamp
    local formatted_time=$(format_timestamp "$timestamp")
    local level_color=$(get_level_color "$level")
    
    # Clean level (remove ANSI codes)
    local clean_level=$(echo "$level" | sed 's/\x1b\[[0-9;]*m//g')
    
    # Display log header line
    echo -e "${GRAY}${formatted_time}${NC} ${level_color}[${clean_level}]${NC} ${WHITE}${message}${NC}"
    
    if [[ "$COMPACT_MODE" == false ]]; then
        # Show additional content if available
        local has_additional=false
        
        # Check for configuration content
        local configuration=$(echo "$json_line" | jq -r '.configuration // empty')
        if [[ -n "$configuration" ]]; then
            echo -e "${CYAN}Configuration Details:${NC}"
            indent_text "$configuration"
            has_additional=true
        fi
        
        # Check for summary data (but skip if configuration is already shown to avoid redundancy)
        local summary=$(echo "$json_line" | jq -r '.summary // empty')
        if [[ -n "$summary" && "$summary" != "null" && -z "$configuration" ]]; then
            echo -e "${CYAN}Summary:${NC}"
            echo "$json_line" | jq -r '.summary' | jq . | indent_text
            has_additional=true
        fi
        
        # Check for error details
        local error_info=$(echo "$json_line" | jq -r '.error // empty')
        if [[ -n "$error_info" && "$error_info" != "null" ]]; then
            echo -e "${RED}Error Details:${NC}"
            echo "$json_line" | jq -r '.error' | jq . | indent_text
            has_additional=true
        fi
        
        # Check for other interesting fields (excluding standard ones)
        local other_fields=$(echo "$json_line" | jq -r '. | del(.timestamp, .level, .message, .service, .configuration, .summary, .error) | to_entries | map(select(.value != null and .value != "")) | from_entries')
        if [[ "$other_fields" != "{}" && "$other_fields" != "null" ]]; then
            echo -e "${PURPLE}Additional Data:${NC}"
            echo "$other_fields" | jq . | indent_text
            has_additional=true
        fi
        
        # Add spacing after entries with additional content
        if [[ "$has_additional" == true ]]; then
            echo ""
        fi
    fi
}

# Function to process log stream
process_log_stream() {
    while IFS= read -r line; do
        # Skip blank lines
        [[ "$line" =~ ^[[:space:]]*$ ]] && continue
        
        # Try to parse as JSON
        if echo "$line" | jq . >/dev/null 2>&1; then
            format_log_entry "$line"
        else
            # Non-JSON line, display as-is with minimal formatting
            echo -e "${GRAY}$(date '+%m-%d %H:%M:%S')${NC} ${WHITE}[raw]${NC} $line"
        fi
    done
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        server)
            LOG_TYPE="server"
            shift
            ;;
        audit)
            LOG_TYPE="audit"
            shift
            ;;
        --follow|-f)
            FOLLOW_MODE=true
            shift
            ;;
        --all)
            ALL_MODE=true
            shift
            ;;
        --compact|-c)
            COMPACT_MODE=true
            shift
            ;;
        --help|-h)
            HELP_MODE=true
            shift
            ;;
        -*) 
            echo "❌ Unknown option: $1"
            echo "💡 Use --help for usage information"
            exit 1
            ;;
        *)
            echo "❌ Unknown argument: $1"
            echo "💡 Valid types: server, audit"
            echo "💡 Use --help for usage information"
            exit 1
            ;;
    esac
done

# Show help if requested
if [[ "$HELP_MODE" == true ]]; then
    show_help
    exit 0
fi

# Check for required tools
if ! command -v jq >/dev/null 2>&1; then
    echo "❌ Error: jq is required but not installed"
    echo "💡 Install with: brew install jq (macOS) or sudo apt install jq (Linux)"
    exit 1
fi

# Get the log file path
LOG_FILE=$(get_log_path "$LOG_TYPE")

if [[ -z "$LOG_FILE" ]]; then
    echo "❌ No log file found for type: $LOG_TYPE"
    echo ""
    echo "🔍 Checked paths:"
    case "$LOG_TYPE" in
        "server")
            echo "   Development: ./logs/warp-sql-server-mcp.log"
            echo "   Production:  ~/.local/state/warp-sql-server-mcp/warp-sql-server-mcp.log"
            ;;
        "audit")
            echo "   Development: ./logs/warp-sql-server-mcp-security.log"
            echo "   Production:  ~/.local/state/warp-sql-server-mcp/warp-sql-server-mcp-security.log"
            ;;
    esac
    echo ""
    echo "💡 Make sure the MCP server is running and has been active to generate logs"
    exit 1
fi

# Check if log file exists and has content
if [[ ! -s "$LOG_FILE" ]]; then
    echo "⚠️  Log file exists but is empty: $LOG_FILE"
    echo "💡 Start the MCP server or perform some operations to generate logs"
    exit 0
fi

# Determine log file source for display
log_source=""
if [[ "$LOG_FILE" =~ \./logs/.* ]]; then
    log_source="(Development)"
elif [[ "$LOG_FILE" =~ .*\.local/state/warp-sql-server-mcp.* ]] || [[ "$LOG_FILE" =~ .*/warp-sql-server-mcp/warp-sql-server-mcp.*\.log$ ]]; then
    log_source="(Production)"
else
    log_source="(Custom Path)"
fi

# Display header
echo -e "${WHITE}🔍 Warp SQL Server MCP Logs${NC}"
echo -e "${GRAY}📁 Log file: $LOG_FILE ${CYAN}$log_source${NC}"
echo -e "${GRAY}📊 Type: $LOG_TYPE logs${NC}"

if [[ "$FOLLOW_MODE" == true ]]; then
    echo -e "${GRAY}🔄 Mode: Following (press Ctrl+C to stop)${NC}"
    if [[ "$COMPACT_MODE" == true ]]; then
        echo -e "${GRAY}📋 Format: Compact${NC}"
    else
        echo -e "${GRAY}📋 Format: Detailed${NC}"
    fi
    echo ""
    
    # Show last few lines first, then follow new entries only
    tail -n 5 "$LOG_FILE" | process_log_stream
    echo -e "${CYAN}--- Following new entries ---${NC}"
    # Use tail -f with -n 0 to only show new entries from now on
    tail -f -n 0 "$LOG_FILE" | process_log_stream
    
elif [[ "$ALL_MODE" == true ]]; then
    local total_lines=$(wc -l < "$LOG_FILE")
    echo -e "${GRAY}📏 Showing: All $total_lines entries${NC}"
    if [[ "$COMPACT_MODE" == true ]]; then
        echo -e "${GRAY}📋 Format: Compact${NC}"
    else
        echo -e "${GRAY}📋 Format: Detailed${NC}"
    fi
    echo ""
    
    cat "$LOG_FILE" | process_log_stream
    
else
    echo -e "${GRAY}📏 Showing: Last $MAX_LINES entries${NC}"
    if [[ "$COMPACT_MODE" == true ]]; then
        echo -e "${GRAY}📋 Format: Compact${NC}"
    else
        echo -e "${GRAY}📋 Format: Detailed${NC}"
    fi
    echo ""
    
    tail -n "$MAX_LINES" "$LOG_FILE" | process_log_stream
fi
