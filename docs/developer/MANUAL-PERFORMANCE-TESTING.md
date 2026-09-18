# Manual Performance Testing

> **Audience**: Contributors validating performance and connection-pool behaviour by hand

This document describes how to exercise the MCP server's performance, monitoring, and
connection-pool paths by hand and interpret the measurements it prints.

## Overview

The performance test (`npm run test:integration:performance`) exercises:

- **Performance Monitoring Tools**: Calls the statistics and connection-health tools
- **Database Operations**: Checks that representative SQL Server operations succeed
- **Concurrent Handling**: Requires 10 simultaneous requests to complete successfully
- **Measurements**: Records outcomes for executed top-level scenarios and timings for successful
  ones; the sequential and concurrent scenarios also print each successful query's timing
- **Persistent MCP Process**: Uses single long-running process for faster, more reliable testing

> **What the command enforces:** the server must start, every MCP tool call must succeed, and all
> sequential and concurrent queries must succeed. A failed request makes the command exit non-zero.
> A fully successful run counts eight top-level scenarios, not every underlying MCP call. A failed
> run counts the scenarios executed before completion or a critical abort. Response-time statistics
> include successful scenarios only, with one average for each successful query batch. Monitoring
> and health payloads are requested but are neither displayed nor validated.

## Running the Test

```bash
npm run test:integration:performance
```

## Test Components

### 1. Basic Server Connectivity

- **Purpose**: Validates basic MCP server startup and connectivity
- **Test**: Sends `get_performance_stats` request
- **Critical**: A thrown exception stops execution immediately; an MCP error response is counted
  and makes the command exit non-zero after the remaining tests
- **Pass condition**: The MCP request succeeds
- **Observed**: Response time

### 2. Performance Monitoring Baseline

- **Purpose**: Requests the initial monitoring state
- **Test**: Gets baseline performance metrics
- **Pass condition**: The MCP request succeeds
- **Not inspected here**: The returned monitoring payload

### 3. Connection Pool Health Check

- **Purpose**: Exercises the `get_connection_health` tool
- **Pass condition**: The MCP request succeeds
- **Not inspected here**: Pool status, utilization, issues, health score, and warning boundaries

### 4. Basic Database Operation

- **Purpose**: Tests simple SQL query execution
- **Test**: `SELECT @@VERSION` query
- **Pass condition**: The query succeeds
- **Observed**: Response time

### 5. Database Listing Operation

- **Purpose**: Tests more complex database operations
- **Test**: List all user databases
- **Pass condition**: The tool call succeeds
- **Observed**: Response time; the returned database list is not validated by this runner

### 6. Sequential Query Performance

- **Purpose**: Tests query consistency and connection reuse
- **Test**: 5 sequential queries with timing analysis
- **Pass condition**: All five queries succeed
- **Observed**: Individual successful-query times; failed queries are logged without a timing. The
  successful-query average contributes one value when the scenario succeeds

### 7. Concurrent Query Execution

- **Purpose**: Stress tests simultaneous request handling
- **Test**: 10 concurrent queries executed simultaneously
- **Pass condition**: All 10 queries succeed
- **Observed**: Individual successful-query times; failed queries are logged without a timing. The
  successful-query average contributes one value when the scenario succeeds; memory use is not
  measured

### 8. Performance Monitoring After Load

- **Purpose**: Requests monitoring data after the generated load
- **Pass condition**: The MCP request succeeds
- **Not inspected here**: Final metrics and query counts; the payload is not compared with the
  baseline

## Interpreting Results

### Enforced Success Criteria

- The persistent MCP server starts.
- Every tool call returns successfully.
- All five sequential and all 10 concurrent queries succeed.
- No request times out or returns an MCP error.

The runner does not assign performance grades or fail on latency, utilization, or health-score
thresholds. Compare its scenario aggregates and per-query timings with a baseline from the same
environment when investigating a regression; workstation and CI timings are not interchangeable.
Inspect monitoring or health values by calling the corresponding MCP tool directly.

### Key Metrics

When at least one scenario succeeds, the summary includes:

- **Scenario Time**: Minimum, average, median, 95th percentile, 99th percentile, and maximum across
  successful top-level scenarios; a fully successful run has eight values, including one average
  from each query batch
- **Scenario Outcome**: Total, successful, and failed executed scenarios plus the failure percentage
- **Error Analysis**: Counts identical exception messages that reach `runTest`; errors caught inside
  the sequential and concurrent helpers and MCP error responses affect a scenario's outcome but are
  not included in this list
- **Concurrency Performance**: Simultaneous request handling

### Measurements That Are Informational

When at least one scenario succeeds, the summary reports these values without asserting numeric
limits:

- Scenario-time minimum, average, median, 95th percentile, 99th percentile, and maximum
- Total, successful, and failed executed-scenario counts and the derived error rate
- Repeated exception-message counts when an exception reaches `runTest`

If no scenario succeeds, the summary stops after reporting that there are no successful requests to
analyze.

The 95% pool-capacity rule and health-score calculation are asserted separately in
`test/unit/performance-monitor.test.js`. This manual runner exercises the monitoring and health tool
calls but discards their payloads after checking whether each call succeeded.

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
**Product behavior**:

- No warnings below 95% utilization
- Warnings appear at 95%+ utilization
- Clean startup (no warnings with 0 connections)

The unit suite checks these rules. This manual runner only checks whether the health-tool call
succeeds; call `get_connection_health` directly to inspect live values during diagnosis.

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

The test's console summary provides measurements that can be saved as an environment-specific
baseline:

- Top-level scenario timing trends
- Error rate patterns
- Sequential and concurrent query timing and success

Use the monitoring and health tools directly when a baseline also needs connection-pool or query
metrics; this runner does not print those payloads.

## Integration with CI/CD

While this is a "manual" test, it can be integrated into automated workflows:

```bash
# Example CI script
npm run test:integration:performance > performance-test-results.txt
```

The command's exit status can gate scenario success. Its console report is human-readable output,
not a stable machine-readable metrics contract; automation that needs threshold enforcement should
add explicit assertions rather than parse the prose report.

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

1. **Maintain backwards compatibility** with existing measurements where practical
2. **Add explicit assertions and focused unit tests** before documenting a value as enforced
3. **Update documentation** for new test components
4. **Keep pass/fail output distinct** from informational measurements

The test is located at `test/manual/improved-performance-test.js` and can be enhanced to cover additional scenarios as the system evolves.
