#!/bin/bash

# Create GitHub Issues from Product Backlog
# This script creates GitHub issues for remaining items in the product backlog
# It checks for existing issues to avoid duplicates

set -e

echo "🚀 Creating Remaining GitHub Issues from Product Backlog..."

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

# Function to check if issue already exists
check_issue_exists() {
    local title="$1"
    # Remove square brackets and get base title
    local base_title=$(echo "$title" | sed 's/\[Feature\]: //')
    # Search for either the full title or just the base title
    gh issue list --search "in:title $base_title" --json title --jq '.[] | .title' | grep -q "$base_title"
}

echo "📋 Checking existing backlog issues..."
existing_count=$(gh issue list --label backlog --json title --jq '. | length')
echo "Found $existing_count existing backlog issues"

# Function to create issue if it doesn't exist
create_issue_if_new() {
    local title="$1"
    local body="$2"
    local labels="$3"

if ! check_issue_exists "$title"; then
        echo "Creating issue: $title"
        echo "$body" | gh issue create --title "$title" --body-file - --label "$labels"
    else
        echo "✓ Issue already exists: $title"
    fi
}

# Create High Priority Issues
echo "📋 Creating HIGH PRIORITY issues..."

# Feature #1: Enhanced Data Visualization Support
create_issue_if_new "[Feature]: Enhanced Data Visualization Support - Charts and Graphs" "$(cat <<-EOF
## 📋 Feature Overview

**Backlog Priority**: HIGH
**Business Value**: ⭐⭐⭐⭐⭐ (5/5 stars)
**Implementation Complexity**: 🔧🔧 (2/5 wrenches)
**Phase**: Phase 2 (3-6 months)

## 🎨 Description

Add tools for generating charts, graphs, and data visualizations directly from query results:
- Bar, line, and pie charts
- Multi-chart dashboards
- Export to common formats (PNG, SVG, PDF)
- Interactive visualizations

## 📏 Acceptance Criteria

- [ ] Add generate_chart MCP tool (bar, line, pie)
- [ ] Add create_dashboard MCP tool for multi-chart views
- [ ] Support export to PNG, SVG, PDF formats
- [ ] Integrate with existing query and filtering system
- [ ] Maintain security model and read-only compliance
- [ ] Handle large datasets efficiently

## 🔧 Technical Considerations

Use established charting libraries, integrate with streaming data handler, maintain security boundaries.

**Reference**: Product Backlog item #1
EOF
)" "enhancement,backlog,high-priority,phase-2"

# Feature #4: Real-time Data Monitoring
create_issue_if_new "[Feature]: Real-time Data Monitoring and Alerting System" "$(cat <<-EOF
## 📋 Feature Overview

**Backlog Priority**: HIGH
**Business Value**: ⭐⭐⭐⭐ (4/5 stars)
**Implementation Complexity**: 🔧🔧🔧🔧 (4/5 wrenches)
**Phase**: Phase 3 (6-12 months)

## 🎨 Description

Live data monitoring and alerting capabilities:
- Monitor table changes with triggers
- Create alerts for data threshold breaches
- Real-time dashboards for key metrics
- Notification system integration

## 📏 Acceptance Criteria

- [ ] Add monitor_table_changes MCP tool
- [ ] Add create_alert tool for threshold monitoring
- [ ] Real-time dashboard capabilities
- [ ] Integration with notification systems
- [ ] Performance monitoring for large datasets
- [ ] Configurable alert thresholds

## 🔧 Technical Considerations

Complex feature requiring database triggers, real-time processing, notification systems.

**Reference**: Product Backlog item #4
EOF
)" "enhancement,backlog,high-priority,phase-3"

echo "📊 Creating MEDIUM PRIORITY issues..."

# Feature #5: Database Comparison & Synchronization
create_issue_if_new "[Feature]: Database Comparison & Schema Synchronization" "$(cat <<-EOF
## 📋 Feature Overview

**Backlog Priority**: MEDIUM
**Business Value**: ⭐⭐⭐⭐ (4/5 stars)
**Implementation Complexity**: 🔧🔧🔧🔧 (4/5 wrenches)
**Phase**: Phase 3 (6-12 months)

## 🎨 Description

Compare schemas and data between environments:
- Schema comparison tools
- Data synchronization capabilities
- Migration script generation
- Environment diff reports

## 📏 Acceptance Criteria

- [ ] Add compare_schemas MCP tool
- [ ] Add sync_data tool for environment synchronization
- [ ] Migration script generation capabilities
- [ ] Comprehensive diff reporting
- [ ] Support for complex schema structures

**Reference**: Product Backlog item #5
EOF
)" "enhancement,backlog,medium-priority,phase-3"

# Feature #7: Query Optimization & Performance Tools
create_issue_if_new "[Feature]: Query Optimization & Performance Analysis Tools" "$(cat <<-EOF
## 📋 Feature Overview

**Backlog Priority**: MEDIUM
**Business Value**: ⭐⭐⭐⭐ (4/5 stars)
**Implementation Complexity**: 🔧🔧🔧 (3/5 wrenches)
**Phase**: Phase 2 (3-6 months)

## 🎨 Description

Advanced performance analysis and optimization:
- Index suggestions based on query patterns
- Performance trend analysis
- Automatic query optimization
- Query cost estimation

## 📏 Acceptance Criteria

- [ ] Add suggest_indexes MCP tool
- [ ] Add analyze_performance_trends tool
- [ ] Query rewriting and optimization suggestions
- [ ] Query cost estimation capabilities
- [ ] Historical performance tracking

**Reference**: Product Backlog item #7
EOF
)" "enhancement,backlog,medium-priority,phase-2"

echo "💡 Creating LOW PRIORITY issues..."

# Feature #12: Natural Language Query Interface
create_issue_if_new "[Feature]: Natural Language Query Interface - AI-Powered SQL Generation" "$(cat <<-EOF
## 📋 Feature Overview

**Backlog Priority**: LOW
**Business Value**: ⭐⭐⭐ (3/5 stars)
**Implementation Complexity**: 🔧🔧🔧🔧🔧 (5/5 wrenches)
**Phase**: Phase 4 (12+ months)
**Status**: 🤔 Research Required

## 🎨 Description

Convert natural language to SQL queries:
- Natural language to SQL conversion
- Query explanation in plain language
- Smart suggestions based on schema
- Interactive query refinement

## 📏 Acceptance Criteria

- [ ] Add ask_question MCP tool for natural language input
- [ ] SQL query generation from English descriptions
- [ ] Query explanation capabilities
- [ ] Schema-aware intelligent suggestions
- [ ] Query validation and correction

## 🔧 Technical Considerations

Requires AI/ML integration, complex natural language processing, extensive training data.

**Reference**: Product Backlog item #12
EOF
)" "enhancement,backlog,low-priority,phase-4"

# Create remaining missing features (if any)
echo "🔄 Creating any remaining missing backlog issues..."

# Check what's still missing and create those
remaining_features=(
    "Data Quality & Validation Framework"
    "API Integration & Webhooks" 
    "Advanced Caching System"
    "Multi-Database Support"
    "Machine Learning Integration"
    "Collaborative Features"
    "Mobile-Responsive Interface"
    "Enhanced Testing Framework"
    "Configuration Management Enhancement"
    "Advanced Security & Audit Features"
)

for feature in "${remaining_features[@]}"; do
    # Check if this feature already has an issue
    existing=$(gh issue list --label backlog --json title --jq ".[] | select(.title | test(\"$feature\"; \"i\")) | .title")
    if [[ -z "$existing" ]]; then
        echo "⚠️  Missing feature: $feature"
        echo "📏 Use the feature-request template to create this manually:"
        echo "   https://github.com/egarcia74/warp-sql-server-mcp/issues/new?template=feature-request.md"
    fi
done

echo ""
echo "✅ Backlog Issue Creation Complete!"
echo ""
echo "📋 Next Steps:"
echo "1. Run update-backlog-links.sh to link existing issues to backlog document"
echo "2. Set up GitHub Project Board to organize these issues"
echo "3. Create milestones for each phase"
echo "4. Use the feature-request.md template for new backlog items"
echo ""
echo "🔗 View all issues: gh issue list --label backlog"
