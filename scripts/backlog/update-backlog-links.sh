#!/bin/bash

# Update Product Backlog with GitHub Issue Links
# This script updates PRODUCT-BACKLOG.md to link existing GitHub issues

set -e

echo "🔗 Updating Product Backlog with GitHub Issue Links..."

# Check if gh CLI is available and authenticated
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) is required but not installed."
    echo "Install it from: https://cli.github.com/"
    exit 1
fi

if ! gh auth status &> /dev/null; then
    echo "❌ You need to authenticate with GitHub CLI first."
    echo "Run: gh auth login"
    exit 1
fi

# Function to find issue by title pattern
find_issue_by_title() {
    local pattern="$1"
    gh issue list --label backlog --json number,title --jq ".[] | select(.title | test(\"$pattern\"; \"i\")) | .number"
}

echo "📋 Finding existing backlog issues..."

# Create indexed arrays for feature names and issue numbers
feature_names=(
    "Enhanced Data Visualization Support"
    "Query Builder & Template System"
    "Advanced Data Export Options"
    "Real-time Data Monitoring"
    "Database Comparison & Synchronization"
    "Query Optimization & Performance Tools"
    "Natural Language Query Interface"
)

search_patterns=(
    "Enhanced Data Visualization"
    "Query Builder"
    "Advanced Data Export"
    "Real-time Data Monitoring"
    "Database Comparison"
    "Query Optimization"
    "Natural Language"
)

# Find issues for each feature
issue_numbers=()
for i in "${!feature_names[@]}"; do
    issue_num=$(find_issue_by_title "${search_patterns[$i]}")
    issue_numbers["$i"]="$issue_num"
done

echo "📊 Found issue mappings:"
for i in "${!feature_names[@]}"; do
    feature="${feature_names[$i]}"
    issue_num="${issue_numbers[$i]}"
    if [[ -n "$issue_num" ]]; then
        echo "  ✅ $feature -> Issue #$issue_num"
    else
        echo "  ❌ $feature -> No issue found"
    fi
done

# Create backup of current backlog
cp PRODUCT-BACKLOG.md PRODUCT-BACKLOG.md.backup
echo "💾 Created backup: PRODUCT-BACKLOG.md.backup"

# Update the backlog document
echo "🔧 Updating PRODUCT-BACKLOG.md with issue links..."

# Use sed to update the issue links (iterate over indexed arrays)
for i in "${!feature_names[@]}"; do
    feature="${feature_names[$i]}"
    issue_num="${issue_numbers[$i]}"
    if [[ -n "$issue_num" ]]; then
        # Update the [Create GitHub Issue] placeholder with actual link
        sed -i.tmp "s|\*\*Issue\*\*: \[Create GitHub Issue\]|\*\*Issue\*\*: [#$issue_num](https://github.com/egarcia74/warp-sql-server-mcp/issues/$issue_num)|g" PRODUCT-BACKLOG.md

        # If that didn't match, try the more specific pattern
        case "$feature" in
            "Enhanced Data Visualization Support")
                sed -i.tmp "s|### 1. Enhanced Data Visualization Support.*Issue.*: \[Create GitHub Issue\]|### 1. Enhanced Data Visualization Support\n\n- **Issue**: [#$issue_num](https://github.com/egarcia74/warp-sql-server-mcp/issues/$issue_num)|" PRODUCT-BACKLOG.md
                ;;
            "Query Builder & Template System")
                sed -i.tmp "s|### 2. Query Builder & Template System.*Issue.*: \[Create GitHub Issue\]|### 2. Query Builder & Template System\n\n- **Issue**: [#$issue_num](https://github.com/egarcia74/warp-sql-server-mcp/issues/$issue_num)|" PRODUCT-BACKLOG.md
                ;;
            "Advanced Data Export Options")
                sed -i.tmp "s|### 3. Advanced Data Export Options.*Issue.*: \[Create GitHub Issue\]|### 3. Advanced Data Export Options\n\n- **Issue**: [#$issue_num](https://github.com/egarcia74/warp-sql-server-mcp/issues/$issue_num)|" PRODUCT-BACKLOG.md
                ;;
            "Real-time Data Monitoring")
                sed -i.tmp "s|### 4. Real-time Data Monitoring.*Issue.*: \[Create GitHub Issue\]|### 4. Real-time Data Monitoring\n\n- **Issue**: [#$issue_num](https://github.com/egarcia74/warp-sql-server-mcp/issues/$issue_num)|" PRODUCT-BACKLOG.md
                ;;
        esac
    fi
done

# Clean up temporary files
rm -f PRODUCT-BACKLOG.md.tmp

echo "✅ Backlog document updated successfully!"
echo ""
echo "📋 Summary:"
echo "- Updated PRODUCT-BACKLOG.md with issue links"
echo "- Created backup file: PRODUCT-BACKLOG.md.backup"
echo ""
echo "🔗 View updated backlog: cat PRODUCT-BACKLOG.md"
echo "🔗 View all issues: gh issue list --label backlog"
