#!/bin/bash

# Docker Test Runner with Clean Flag Support
# Usage: ./scripts/docker-test-runner.sh [phase] [--clean]
# Examples:
#   ./scripts/docker-test-runner.sh phase1
#   ./scripts/docker-test-runner.sh phase1 --clean  
#   ./scripts/docker-test-runner.sh all --clean

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Parse arguments
PHASE=""
CLEAN_FLAG=false

for arg in "$@"; do
    case $arg in
        --clean)
            CLEAN_FLAG=true
            shift
            ;;
        phase1|phase2|phase3|protocol|all)
            PHASE="$arg"
            shift
            ;;
        *)
            print_error "Unknown argument: $arg"
            echo "Usage: $0 [phase1|phase2|phase3|protocol|all] [--clean]"
            exit 1
            ;;
    esac
done

# Default to phase1 if no phase specified
if [ -z "$PHASE" ]; then
    PHASE="phase1"
    print_info "No phase specified, defaulting to phase1"
fi

# Show configuration
echo ""
print_info "Docker Test Runner Configuration:"
echo "  Phase: $PHASE"
echo "  Clean slate: $CLEAN_FLAG"
echo ""

# Handle clean flag
if [ "$CLEAN_FLAG" = true ]; then
    print_warning "Clean slate requested - this will remove all existing Docker data"
    npm run docker:clean
    print_success "Docker environment cleaned"
fi

# Start Docker if not already running or if we just cleaned
if [ "$CLEAN_FLAG" = true ] || ! docker ps --filter "name=warp-mcp-sqlserver" --filter "status=running" | grep -q warp-mcp-sqlserver; then
    print_info "Starting Docker SQL Server container..."
    npm run docker:start
    print_success "Docker container started and ready"
fi

# Set testing mode
export MCP_TESTING_MODE=docker

# Run the specified test phase
case $PHASE in
    phase1)
        echo ""
        print_info "🔒 Running Phase 1: Read-Only Security Testing"
        node test/integration/manual/phase1-readonly-security.test.js
        ;;
    phase2)
        echo ""
        print_info "⚠️  Running Phase 2: DML Operations Testing"
        node test/integration/manual/phase2-dml-operations.test.js
        ;;
    phase3)
        echo ""
        print_info "🛠️  Running Phase 3: DDL Operations Testing"
        node test/integration/manual/phase3-ddl-operations.test.js
        ;;
    protocol)
        echo ""
        print_info "📡 Running MCP Protocol Smoke Test"
        node test/protocol/mcp-client-smoke-test.js
        ;;
    all)
        echo ""
        print_info "🚀 Running All Test Phases"
        
        print_info "🔒 Phase 1: Read-Only Security Testing"
        node test/integration/manual/phase1-readonly-security.test.js
        
        echo ""
        print_info "⚠️  Phase 2: DML Operations Testing"
        node test/integration/manual/phase2-dml-operations.test.js
        
        echo ""
        print_info "🛠️  Phase 3: DDL Operations Testing"
        node test/integration/manual/phase3-ddl-operations.test.js
        
        echo ""
        print_info "📡 MCP Protocol Smoke Test"
        node test/protocol/mcp-client-smoke-test.js
        ;;
esac

# Optionally stop container if we started it with clean flag
if [ "$CLEAN_FLAG" = true ]; then
    echo ""
    print_warning "Clean run completed. Container will remain running for future tests."
    print_info "Use 'npm run docker:stop' to stop the container when finished."
fi

print_success "Docker test run completed successfully!"
