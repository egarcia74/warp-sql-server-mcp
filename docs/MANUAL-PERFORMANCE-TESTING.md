# Manual Performance Testing

This document describes how to use the manual performance testing feature to validate the MCP server's performance, monitoring, and connection pool behavior.

## Overview

The performance test (`npm run test:integration:performance`) provides comprehensive validation of:

- **Performance Monitoring System**: Validates our improved 95% threshold and monitoring accuracy
- **Connection Pool Health**: Tests pool behavior and health scoring
- **Database Operations**: Validates SQL Server connectivity and query performance
- **Concurrent Handling**: Tests concurrent execution (10 simultaneous requests)
- **System Resilience**: Measures response times, error rates, and overall stability
- **Persistent MCP Process**: Uses single long-running process for faster, more reliable testing

## Running the Test

```bash
npm run test:integration:performance
```

## Test Components

### 1. Basic Server Connectivity

- **Purpose**: Validates basic MCP server startup and connectivity
- **Test**: Sends `get_performance_stats` request
- **Critical**: Yes (stops execution if failed)
- **Expected**: < 1000ms response time

### 2. Performance Monitoring Baseline

- **Purpose**: Captures initial state for comparison
- **Test**: Gets baseline performance metrics
- **Output**: Shows current query count and monitoring status
- **Expected**: Monitoring enabled, clean baseline

### 3. Connection Pool Health Check

- **Purpose**: Tests our improved 95% threshold behavior
- **Validation**:
  - ✅ No capacity warnings below 95% utilization
  - ✅ Proper warnings at 95%+ utilization
  - ✅ Correct health scoring
- **Expected**: Healthy status, 100/100 score, no false positives

### 4. Basic Database Operation

- **Purpose**: Tests simple SQL query execution
- **Test**: `SELECT @@VERSION` query
- **Expected**: <500ms response time, successful execution

### 5. Database Listing Operation

- **Purpose**: Tests more complex database operations
- **Test**: List all user databases
- **Expected**: <200ms response time, proper database enumeration

### 6. Sequential Query Performance

- **Purpose**: Tests query consistency and connection reuse
- **Test**: 5 sequential queries with timing analysis
- **Expected**: Consistent response times (50-100ms), 100% success rate

### 7. Concurrent Query Execution

- **Purpose**: Stress tests simultaneous request handling
- **Test**: 10 concurrent queries executed simultaneously
- **Expected**: All queries succeed, escalating response times, no memory leaks

### 8. Performance Monitoring After Load

- **Purpose**: Validates monitoring system tracks all test activity
- **Output**: Final performance metrics, query counts, monitoring status
- **Expected**: Proper tracking of all test queries and operations

## Interpreting Results

### Success Criteria

- **🌟 EXCELLENT**: 95%+ success rate, <2000ms avg response time
- **✅ GOOD**: 90%+ success rate, <3000ms avg response time
- **⚠️ WARNING**: 80%+ success rate, <5000ms avg response time
- **❌ CRITICAL**: Below warning thresholds

### Key Metrics

- **Response Time**: Average, min, max, and percentiles (90th, 95th)
- **Success Rate**: Percentage of successful requests
- **Error Analysis**: Categorized error types (timeout, spawn, other)
- **Concurrency Performance**: Simultaneous request handling

### Performance Monitoring Validation

The test specifically validates:

- ✅ **95% Threshold**: No false positives below 95% pool utilization
- ✅ **Connection Health**: Accurate pool status and scoring
- ✅ **Monitoring Accuracy**: Proper query tracking and metrics
- ✅ **Startup Behavior**: Clean initialization without warnings

## Common Issues and Solutions

### SQL Query Timeouts

**Symptoms**: Database operations timing out
**Causes**:

- SQL Server not running
- Connection string issues
- Network connectivity problems
- Authentication failures

**Solutions**:

- Verify SQL Server is running and accessible
- Check connection configuration in `.env` file
- Test basic SQL Server connectivity outside MCP
- Review authentication credentials

### Performance Monitoring Issues

**Symptoms**: Monitoring tools not working
**Causes**:

- Performance monitoring disabled
- Configuration errors
- Module loading issues

**Solutions**:

- Verify `ENABLE_PERFORMANCE_MONITORING=true`
- Check performance monitor initialization
- Review module imports and dependencies

### Connection Pool Warnings

**Symptoms**: Unexpected capacity warnings
**Expected Behavior**:

- No warnings below 95% utilization
- Warnings appear at 95%+ utilization
- Clean startup (no warnings with 0 connections)

**If Issues**:

- Check performance monitor threshold logic
- Verify pool statistics accuracy
- Review health assessment calculations

## Using for Development

### Regular Testing

Run the manual performance test:

- After performance improvements
- Before production deployments
- When investigating performance issues
- To validate configuration changes

### Performance Tuning

Use the test results to:

- Identify bottlenecks
- Measure improvement effectiveness
- Validate threshold adjustments
- Monitor system stability

### Continuous Monitoring

The test provides valuable baseline metrics:

- Response time trends
- Error rate patterns
- Connection pool behavior
- Performance monitoring accuracy

## Integration with CI/CD

While this is a "manual" test, it can be integrated into automated workflows:

```bash
# Example CI script
npm run test:integration:performance > performance-test-results.txt
```

The test provides structured output that can be parsed for automated analysis and alerting.

## Troubleshooting

### Test Fails Immediately

- Check MCP server startup
- Verify Node.js and dependencies
- Review configuration files

### High Error Rates

- Check SQL Server connectivity
- Review timeout settings
- Validate connection pool configuration

### Performance Degradation

- Compare with baseline results
- Check system resources
- Review recent configuration changes

## Contributing

When modifying the manual performance test:

1. **Maintain backwards compatibility** with existing metrics
2. **Add new validations** for new features
3. **Update documentation** for new test components
4. **Preserve structured output** for automated parsing

The test is located at `test/manual/improved-performance-test.js` and can be enhanced to cover additional scenarios as the system evolves.
