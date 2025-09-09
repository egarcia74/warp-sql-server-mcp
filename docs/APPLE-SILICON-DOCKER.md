# Apple Silicon Docker SQL Server Troubleshooting Guide

This guide helps resolve common SQL Server Docker issues on Apple Silicon (M1/M2) Macs.

## Quick Fix Commands

```bash
# 1. Run troubleshooting diagnostics
npm run docker:troubleshoot

# 2. Clean restart (recommended first step)
npm run docker:clean && npm run test:integration

# 3. Check platform optimization
npm run docker:detect

# 4. Monitor startup logs
npm run docker:logs
```

## Common Issues and Solutions

### 1. Container Exits Immediately

**Error**: `"/opt/mssql/bin/permissions_check.sh: line 158: /var/opt/mssql/data/master.mdf: No such file or directory"`

**Cause**: Rosetta 2 emulation issues or corrupted container state.

**Solutions**:

```bash
# A. Clean restart (removes all data)
npm run docker:clean
npm run docker:start:init

# B. Check Rosetta 2 in Docker Desktop
# Go to Docker Desktop → Settings → Features in development → Use Rosetta for x86/amd64 emulation

# C. Regenerate platform config
npm run docker:detect
npm run docker:start:init
```

### 2. Connection Refused (ECONNREFUSED)

**Error**: `connect ECONNREFUSED 127.0.0.1:1433`

**Cause**: Container startup takes longer on Apple Silicon due to emulation.

**Solutions**:

```bash
# A. Wait longer for startup
npm run docker:wait

# B. Check container status
npm run docker:status

# C. View startup logs
npm run docker:logs

# D. Use extended timeout test
npm run docker:test:clean
```

### 3. Binary Not Found

**Error**: `"/opt/mssql/bin/sqlservr: No such file or directory"`

**Cause**: Architecture mismatch or incomplete Rosetta 2 setup.

**Solutions**:

```bash
# A. Verify Rosetta 2 emulation
docker run --rm --platform linux/amd64 hello-world

# B. Clean Docker system
npm run docker:clean
docker system prune -f

# C. Restart Docker Desktop completely
# Quit Docker Desktop → Restart → Run commands again
```

### 4. Memory/Performance Issues

**Symptoms**: Slow startup, random crashes, timeout errors.

**Solutions**:

```bash
# A. Increase Docker memory allocation
# Docker Desktop → Settings → Resources → Memory → Set to 6GB+

# B. The platform detection automatically configures:
# - Memory limits (2.5GB container limit)
# - Extended timeouts (45s start period)
# - Proper security settings for emulation
```

## Platform Detection Features

Your test suite automatically:

1. **Detects Apple Silicon** and configures optimal settings
2. **Tests Rosetta 2 support** and chooses best image
3. **Sets extended timeouts** for emulation delays
4. **Configures memory limits** for stability
5. **Enables security options** needed for SQL Server emulation

## Architecture Selection Logic

```text
Apple Silicon M1/M2 → Rosetta 2 Available?
├── Yes → SQL Server 2022 (emulated, full features)
└── No  → Azure SQL Edge (native ARM64, limited features)

Intel/AMD64 → SQL Server 2022 (native, optimal performance)
```

## Monitoring Commands

```bash
# Container status
npm run docker:status

# Live logs
npm run docker:logs

# Connection test
npm run docker:test-connection

# Full diagnostics
npm run docker:troubleshoot

# Database shell access
npm run docker:sql
```

## Docker Desktop Settings for Apple Silicon

1. **Enable Rosetta 2**: Settings → Features in development → "Use Rosetta for x86/amd64 emulation"
2. **Increase Memory**: Settings → Resources → Memory → 6GB minimum
3. **Enable VirtioFS**: Settings → General → "Enable VirtioFS accelerated directory sharing"

## Performance Expectations

| Configuration             | Startup Time | Performance | Compatibility      |
| ------------------------- | ------------ | ----------- | ------------------ |
| Apple Silicon + Rosetta 2 | 30-45s       | Very Good   | Full SQL Server    |
| Apple Silicon + SQL Edge  | 15-25s       | Excellent   | Core features only |
| Intel/AMD64               | 10-20s       | Excellent   | Full SQL Server    |

## Advanced Troubleshooting

### Force Azure SQL Edge (if Rosetta 2 issues persist)

Edit `test/docker/detect-platform.js` and modify the chooseBestConfiguration function to prefer Azure SQL Edge:

```javascript
// Around line 110, change the condition to force SQL Edge
if (hostInfo.arch === 'arm64') {
  // Force SQL Edge instead of Rosetta 2
  return {
    config: CONFIG_TEMPLATES.azure_sql_edge_arm64,
    reason: 'Forced Azure SQL Edge for ARM64 compatibility',
    performance: 'Excellent (native ARM64)',
    compatibility: 'SQL Server core features (no SQL Agent)'
  };
}
```

### Manual Docker Compose Override

If you need to manually override the generated configuration:

```bash
# Backup auto-generated config
cp test/docker/docker-compose.yml test/docker/docker-compose.yml.backup

# Make manual edits
# The platform detection will regenerate on next docker:detect run
```

## Getting Help

1. **Run diagnostics first**: `npm run docker:troubleshoot`
2. **Check recent logs**: `npm run docker:logs`
3. **Try clean restart**: `npm run docker:test:clean`
4. **Verify Docker settings**: Ensure Rosetta 2 is enabled

This troubleshooting system is designed to automatically handle Apple Silicon complexities while providing fallback options and clear diagnostics.
