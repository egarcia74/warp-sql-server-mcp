#!/bin/bash

# WARP SQL Server MCP - Test Process Cleanup Script
# Safely terminates leftover Node.js test processes to prevent memory leaks

echo "🧹 WARP Test Process Cleanup"
echo "=================================="

# Find and display Vitest processes
echo "📊 Scanning for leftover Vitest processes..."
VITEST_PROCESSES=$(ps aux | grep -E "node.*vitest" | grep -v grep || true)

if [ -z "$VITEST_PROCESSES" ]; then
    echo "✅ No leftover Vitest processes found"
else
    echo "⚠️  Found leftover Vitest processes:"
    echo "$VITEST_PROCESSES"
    echo ""
    
    # Extract PIDs
    PIDS=$(echo "$VITEST_PROCESSES" | awk '{print $2}' | tr '\n' ' ')
    
    echo "🔄 Terminating processes: $PIDS"
    kill $PIDS 2>/dev/null || true
    
    sleep 2
    
    # Force kill if still running
    REMAINING=$(ps aux | grep -E "node.*vitest" | grep -v grep || true)
    if [ ! -z "$REMAINING" ]; then
        echo "💥 Force killing stubborn processes..."
        FORCE_PIDS=$(echo "$REMAINING" | awk '{print $2}' | tr '\n' ' ')
        kill -9 $FORCE_PIDS 2>/dev/null || true
    fi
    
    echo "✅ Cleanup complete"
fi

# Show current system load
echo ""
echo "📈 Current System Status:"
top -l 1 | head -5

echo ""
echo "🎯 Cleanup complete! Memory freed and CPU load reduced."
