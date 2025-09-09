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
#   --file, --path    Specify custom log file path (bypasses smart detection)
#   --help, -h        Show this help message

set -euo pipefail

# Default options
LOG_TYPE="server"
FOLLOW_MODE=false
ALL_MODE=false
COMPACT_MODE=false
HELP_MODE=false
MAX_LINES=50
CUSTOM_FILE_PATH=""

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
    --file PATH, --path PATH  Specify custom log file path (bypasses smart detection)
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

    # Use custom log file path
    ./scripts/show-logs.sh --file /path/to/custom.log
    ./scripts/show-logs.sh --path ~/my-logs/server.log --follow

    # NPM integration
    npm run logs
    npm run logs:server
    npm run logs:audit
    npm run logs:tail         # Follow server logs
    npm run logs:tail:server  # Follow server logs
    npm run logs:tail:audit   # Follow audit logs

FEATURES:
    🎯 Smart path detection (development vs production)
    📁 Custom file path support (--file or --path)
    📄 Clean JSON log formatting with proper indentation
    🎨 Color-coded log levels and timestamps
    📊 Intelligent message content display
    ⚡ Real-time log following
    🔍 Automatic log file discovery

SMART PATH DETECTION:
    Development:  ./logs/server.log
                  ./logs/security-audit.log
    Production:   ~/.local/state/warp-sql-server-mcp/server.log
                  ~/.local/state/warp-sql-server-mcp/security-audit.log
                  (Windows: %LOCALAPPDATA%/warp-sql-server-mcp/server.log)

EOF
}

# Function to determine if we're in development environment (matches Logger class logic)
is_development_environment() {
    # Method 1: Check if we're in project directory (has package.json with correct name)
    if [[ -f "package.json" ]]; then
        if command -v jq >/dev/null 2>&1; then
            local pkg_name
            pkg_name=$(jq -r '.name' package.json 2>/dev/null || echo "")
            if [[ "$pkg_name" == "warp-sql-server-mcp" ]]; then
                return 0
            fi
        else
            # Fallback without jq
            if grep -q '"name".*"warp-sql-server-mcp"' package.json 2>/dev/null; then
                return 0
            fi
        fi
    fi

    # Method 2: Check NODE_ENV
    if [[ "${NODE_ENV:-}" == "development" || "${NODE_ENV:-}" == "test" ]]; then
        return 0
    fi

    # Method 3: Check if we're in typical development locations
    local cwd
    cwd=$(pwd)
    if [[ "$cwd" == *"/src/"* || "$cwd" == *"/dev/"* || "$cwd" == *"/repos/"* || "$cwd" == *"/projects/"* ]]; then
        return 0
    fi

    # Method 4: Check if we're running from npm/node_modules (production install)
    if [[ "$cwd" == *"node_modules"* ]]; then
        return 1
    fi

    # Default to production for safety
    return 1
}

# Function to detect the correct log file path (matches Logger class smart defaults)
get_log_path() {
    local log_type="$1"
    
    if is_development_environment; then
        # Development: Use project directory logs (matches Logger class)
        case "$log_type" in
            "server")
                echo "./logs/server.log"
                ;;
            "audit")
                echo "./logs/security-audit.log"
                ;;
            *)
                echo "❌ Invalid log type: $log_type" >&2
                exit 1
                ;;
        esac
    else
        # Production: Use user state directory (matches Logger class)
        if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
            # Windows
            local app_data="${LOCALAPPDATA:-$HOME/AppData/Local}"
            case "$log_type" in
                "server")
                    echo "$app_data/warp-sql-server-mcp/server.log"
                    ;;
                "audit")
                    echo "$app_data/warp-sql-server-mcp/security-audit.log"
                    ;;
                *)
                    echo "❌ Invalid log type: $log_type" >&2
                    exit 1
                    ;;
            esac
        else
            # Unix/Linux/macOS
            local state_dir="$HOME/.local/state/warp-sql-server-mcp"
            case "$log_type" in
                "server")
                    echo "$state_dir/server.log"
                    ;;
                "audit")
                    echo "$state_dir/security-audit.log"
                    ;;
                *)
                    echo "❌ Invalid log type: $log_type" >&2
                    exit 1
                    ;;
            esac
        fi
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

# Fallback JSON parsing without jq (basic extraction)
extract_json_field() {
    local json="$1"
    local field="$2"
    
    # Use sed to extract field values (basic approach)
    # This handles simple cases like "field": "value" or "field": value
    echo "$json" | sed -n 's/.*"'"$field"'"\s*:\s*"\([^"]*\)".*/\1/p' | head -n1 | sed 's/\\"/"/g'
}

# Fallback function to check if line is valid JSON
is_valid_json_fallback() {
    local line="$1"
    # Basic check: starts with { and ends with }
    [[ "$line" =~ ^[[:space:]]*\{.*\}[[:space:]]*$ ]]
}

# Function to format and display a JSON log entry
format_log_entry() {
    local json_line="$1"
    
    # Parse JSON fields using jq if available, otherwise use fallback
    local timestamp level message service
    
    if [[ "$HAS_JQ" == true ]]; then
        timestamp=$(echo "$json_line" | jq -r '.timestamp // empty')
        level=$(echo "$json_line" | jq -r '.level // empty')
        message=$(echo "$json_line" | jq -r '.message // empty')
        service=$(echo "$json_line" | jq -r '.service // empty')
    else
        timestamp=$(extract_json_field "$json_line" "timestamp")
        level=$(extract_json_field "$json_line" "level")
        message=$(extract_json_field "$json_line" "message")
        service=$(extract_json_field "$json_line" "service")
    fi
    
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
        local configuration
        if [[ "$HAS_JQ" == true ]]; then
            configuration=$(echo "$json_line" | jq -r '.configuration // empty')
        else
            configuration=$(extract_json_field "$json_line" "configuration")
        fi
        
        if [[ -n "$configuration" ]]; then
            echo -e "${CYAN}Configuration Details:${NC}"
            indent_text "$configuration"
            has_additional=true
        fi
        
        # Check for summary data (but skip if configuration is already shown to avoid redundancy)
        local summary
        if [[ "$HAS_JQ" == true ]]; then
            summary=$(echo "$json_line" | jq -r '.summary // empty')
        else
            summary=$(extract_json_field "$json_line" "summary")
        fi
        if [[ -n "$summary" && "$summary" != "null" && -z "$configuration" ]]; then
            echo -e "${CYAN}Summary:${NC}"
            echo "$json_line" | jq -r '.summary' | jq . | indent_text
            has_additional=true
        fi
        
        # Check for error details
        local error_info
        if [[ "$HAS_JQ" == true ]]; then
            error_info=$(echo "$json_line" | jq -r '.error // empty')
        else
            error_info=$(extract_json_field "$json_line" "error")
        fi
        
        if [[ -n "$error_info" && "$error_info" != "null" ]]; then
            echo -e "${RED}Error Details:${NC}"
            if [[ "$HAS_JQ" == true ]]; then
                echo "$json_line" | jq -r '.error' | jq . | indent_text
            else
                indent_text "$error_info"
            fi
            has_additional=true
        fi
        
        # Check for other interesting fields (excluding standard ones)
        local other_fields
        if [[ "$HAS_JQ" == true ]]; then
            other_fields=$(echo "$json_line" | jq -r '. | del(.timestamp, .level, .message, .service, .configuration, .summary, .error) | to_entries | map(select(.value != null and .value != "")) | from_entries')
            if [[ "$other_fields" != "{}" && "$other_fields" != "null" ]]; then
                echo -e "${PURPLE}Additional Data:${NC}"
                echo "$other_fields" | jq . | indent_text
                has_additional=true
            fi
        else
            # For fallback mode, we'll skip complex field processing since we don't have jq
            # This is acceptable as it's a fallback mode for basic functionality
            :
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
        local is_json=false
        if [[ "$HAS_JQ" == true ]]; then
            if echo "$line" | jq . >/dev/null 2>&1; then
                is_json=true
            fi
        else
            if is_valid_json_fallback "$line"; then
                is_json=true
            fi
        fi
        
        if [[ "$is_json" == true ]]; then
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
        --file|--path)
            if [[ -n "${2:-}" ]]; then
                CUSTOM_FILE_PATH="$2"
                shift 2
            else
                echo "❌ Error: --file/--path requires a file path argument"
                exit 1
            fi
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

# Check for jq availability
HAS_JQ=false
if command -v jq >/dev/null 2>&1; then
    HAS_JQ=true
else
    echo "⚠️  Warning: jq not found, using fallback JSON parsing (limited functionality)"
    echo "💡 For better formatting: brew install jq (macOS) or sudo apt install jq (Linux)"
fi

# Get the log file path
if [[ -n "$CUSTOM_FILE_PATH" ]]; then
    LOG_FILE="$CUSTOM_FILE_PATH"
    echo -e "${CYAN}📁 Using custom file path: $LOG_FILE${NC}"
else
    LOG_FILE=$(get_log_path "$LOG_TYPE")
fi

# Check if log file exists
if [[ ! -f "$LOG_FILE" ]]; then
    if [[ -n "$CUSTOM_FILE_PATH" ]]; then
        echo "❌ Custom log file not found: $LOG_FILE"
        echo "💡 Verify the file path and ensure the file exists"
    else
        echo "❌ No log file found for type: $LOG_TYPE"
        echo ""
        echo "🔍 Expected path: $LOG_FILE"
        echo "🌍 Environment: $(is_development_environment && echo "Development" || echo "Production")"
        echo ""
        echo "📁 All possible paths for $LOG_TYPE logs:"
        case "$LOG_TYPE" in
            "server")
                echo "   Development: ./logs/server.log"
                echo "   Production:  ~/.local/state/warp-sql-server-mcp/server.log"
                if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
                    echo "   Windows:     %LOCALAPPDATA%/warp-sql-server-mcp/server.log"
                fi
                ;;
            "audit")
                echo "   Development: ./logs/security-audit.log"
                echo "   Production:  ~/.local/state/warp-sql-server-mcp/security-audit.log"
                if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
                    echo "   Windows:     %LOCALAPPDATA%/warp-sql-server-mcp/security-audit.log"
                fi
                ;;
        esac
        echo ""
        echo "💡 Make sure the MCP server is running and has been active to generate logs"
        echo "💡 Check that logging is enabled in your MCP server configuration"
        echo "💡 Or use --file to specify a custom log file path"
    fi
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
if [[ -n "$CUSTOM_FILE_PATH" ]]; then
    log_source="(Custom Path)"
elif [[ "$LOG_FILE" =~ \./logs/.* ]]; then
    log_source="(Development)"
elif [[ "$LOG_FILE" =~ .*\.local/state/warp-sql-server-mcp.* ]] || [[ "$LOG_FILE" =~ .*/warp-sql-server-mcp/warp-sql-server-mcp.*\.log$ ]]; then
    log_source="(Production)"
else
    log_source="(Auto-detected)"
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
    total_lines=$(wc -l < "$LOG_FILE")
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
