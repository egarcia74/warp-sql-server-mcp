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
    "Automatic Environment Configuration Detection"
)

search_patterns=(
    "Enhanced Data Visualization"
    "Query Builder"
    "Advanced Data Export"
    "Real-time Data Monitoring"
    "Database Comparison"
    "Query Optimization"
    "Natural Language"
    "Environment Configuration Detection|Automatic Environment Configuration"
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

# Iterate and update the Issue line under each feature heading using awk (portable, newline-safe)
for i in "${!feature_names[@]}"; do
    feature="${feature_names[$i]}"
    issue_num="${issue_numbers[$i]}"
    if [[ -n "$issue_num" ]]; then
        awk -v feature="$feature" -v issue="$issue_num" '
            BEGIN { in_section=0; updated=0 }
            {
                if ($0 ~ /^### /) {
                    # entering any new section resets flag
                    in_section=0
                }
                if ($0 ~ "^### " feature "$") {
                    in_section=1
                    print $0
                    next
                }
                if (in_section == 1 && $0 ~ /^- \*\*Issue\*\*:/) {
                    print "- **Issue**: [#" issue "](https://github.com/egarcia74/warp-sql-server-mcp/issues/" issue ")"
                    in_section=2; updated=1
                    next
                }
                print $0
            }
            END {
                # If needed, could handle insertion when no Issue line present
            }
        ' PRODUCT-BACKLOG.md > PRODUCT-BACKLOG.md.tmp && mv PRODUCT-BACKLOG.md.tmp PRODUCT-BACKLOG.md
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
