# 🧪 Platform Detection Stress Testing Guide

This guide provides comprehensive stress testing for the intelligent platform detection system to ensure it works reliably for developers across different environments and scenarios.

## 🎯 Testing Overview

We provide **two levels of stress testing**:

1. **🚀 Quick Stress Test** - Fast, developer-friendly validation (30 seconds)
2. **🔬 Comprehensive Stress Test** - Full validation suite (5-10 minutes)

## 🚀 Quick Stress Test (Recommended for Daily Development)

### Usage

```bash
npm run docker:stress-test:quick
```

### What it Tests

- ✅ Architecture detection accuracy
- ✅ Docker capability detection
- ✅ Configuration selection logic
- ✅ Docker environment availability
- ✅ Detection consistency across multiple runs
- ✅ File generation and validation
- ✅ Docker Compose syntax validation
- ✅ Container startup/shutdown cycle

### Expected Results

- **🎉 Excellent (90-100%)**: Platform detection working perfectly
- **✅ Good (75-89%)**: Working well with minor issues
- **⚠️ Warning (50-74%)**: Some issues need attention
- **❌ Critical (<50%)**: Major issues requiring fixes

### Example Output

```text
⚡ Quick Platform Detection Stress Test
========================================

✅ Architecture Detection (0ms)
✅ Docker Capabilities (779ms)
✅ Configuration Selection (421ms)
✅ Docker Environment (17ms)
✅ Detection Consistency (0ms)
✅ File Generation (572ms)
✅ Docker Compose Validation (61ms)
✅ Container Startup Test (10726ms)

📊 Results
===========
✅ Passed: 8/8
❌ Failed: 0/8
📈 Success Rate: 100%

🎉 EXCELLENT - Platform detection is working perfectly!

💡 Developer Tips:
🍎 Apple Silicon detected:
  ✅ Rosetta 2 emulation is working - optimal configuration selected
  🧪 Run full stress test: npm run docker:stress-test
  📖 View configuration: cat test/docker/.platform-config.json
```

## 🔬 Comprehensive Stress Test

### Comprehensive Usage

```bash
npm run docker:stress-test
```

### Comprehensive Test Coverage

#### 1. Detection Logic Validation

- Architecture detection accuracy
- Docker capabilities detection
- Configuration selection logic
- Detection consistency across multiple runs

#### 2. Docker Capability Testing

- Docker daemon availability
- Platform support verification (Buildx)
- AMD64 emulation testing
- Docker Compose availability

#### 3. Configuration Generation Testing

- YAML generation accuracy
- File writing and reading operations
- Rapid generation stress testing (10 iterations)

#### 4. Docker Container Lifecycle Testing

- Container startup with generated config
- Container health check validation
- Platform warning verification (no warnings should appear)
- Container shutdown testing

#### 5. Edge Case Handling

- Simulated Docker unavailability
- Unknown architecture fallback handling
- File system permissions testing

#### 6. Performance & Reliability Testing

- Detection speed benchmarking (50 iterations)
- Memory usage stability testing
- Concurrent detection testing (10 parallel requests)

### Comprehensive Test Results

The comprehensive test provides detailed insights into:

- Individual test results with timing
- Performance metrics and bottlenecks
- Failed test details with error messages
- Memory usage patterns
- Concurrent operation stability

## 🎯 When to Use Each Test

### Use Quick Stress Test For

- **Daily development validation**
- **Pre-commit testing**
- **Quick confidence checks**
- **CI/CD integration**
- **New environment setup validation**

### Use Comprehensive Stress Test For

- **Pre-release validation**
- **New feature development**
- **Performance regression testing**
- **Cross-platform validation**
- **Deep troubleshooting**

## 🏗️ Developer Workflow Integration

### Daily Development

```bash
# Before starting work
npm run docker:stress-test:quick

# After platform detection changes
npm run docker:stress-test:quick
```

### Pre-Release Validation

```bash
# Full validation before release
npm run docker:stress-test

# Validate on different architectures if possible
# - Intel Mac developer machine
# - Apple Silicon Mac
# - Linux CI/CD environment
```

### Troubleshooting

```bash
# If quick test fails, run comprehensive test for details
npm run docker:stress-test:quick
npm run docker:stress-test  # If issues detected

# Check generated configuration
cat test/docker/.platform-config.json

# Verify Docker environment
docker --version
docker system info
```

## 📊 Architecture-Specific Results

### Apple Silicon (ARM64) Expected Results

```text
🔍 Detected platform: darwin, architecture: arm64
✅ Docker capabilities: AMD64 support via Rosetta 2
✅ Selected: SQL Server 2022 with linux/amd64 platform override
✅ Performance: Very Good (emulated via Rosetta 2)
✅ No platform mismatch warnings in container logs
```

### Intel Mac (AMD64) Expected Results

```text
🔍 Detected platform: darwin, architecture: x64
✅ Docker capabilities: Native AMD64 support
✅ Selected: SQL Server 2022 native (no platform override)
✅ Performance: Excellent (native)
✅ No platform warnings
```

### Linux (Various) Expected Results

```text
🔍 Detected platform: linux, architecture: [x64|arm64]
✅ Docker capabilities: Platform-appropriate support
✅ Selected: Optimal configuration for detected architecture
✅ Performance: Architecture-dependent
```

## 🚨 Common Issues and Solutions

### Docker Not Available

```text
❌ Docker Environment - Docker daemon not available

Solutions:
📥 Install Docker Desktop: https://docs.docker.com/get-docker/
🔄 Start Docker Desktop application
🔧 Verify with: docker --version
```

### Platform Detection Inconsistent

```text
❌ Detection Consistency - Inconsistent detection results

Solutions:
🔄 Restart Docker Desktop
🧹 Clear Docker cache: docker system prune
🔧 Check system resources (CPU/Memory pressure)
```

### Container Startup Failures

```text
❌ Container Startup Test - Container not running

Solutions:
🔍 Check port availability: lsof -i :14330
🧹 Clean Docker state: npm run docker:clean
📋 Verify Docker Compose: docker-compose -f test/docker/docker-compose.yml config
```

### AMD64 Emulation Issues

```text
⚠️  AMD64 Emulation - AMD64 emulation may have issues

Solutions (Apple Silicon):
🔧 Update Docker Desktop to latest version
⚙️  Enable "Use Rosetta for x86/amd64 emulation" in Docker settings
🔄 Restart Docker Desktop
```

## 📈 Performance Benchmarks

### Expected Performance Characteristics

#### Quick Stress Test

- **Total Duration**: 15-45 seconds
- **Architecture Detection**: <1ms
- **Docker Capabilities**: 100-1000ms (first run), <100ms (subsequent)
- **Container Startup**: 5-15 seconds
- **Memory Usage**: <50MB additional

#### Comprehensive Stress Test

- **Total Duration**: 5-10 minutes
- **Detection Performance**: <1000ms average for 50 iterations
- **Memory Stability**: <10MB increase over 100 iterations
- **Concurrent Operations**: >90% success rate with 10 parallel requests

### Performance Red Flags

- Detection taking >5 seconds consistently
- Memory usage increasing >50MB during testing
- Container startup taking >30 seconds
- Success rates <75% in stress testing

## 🔧 Advanced Testing Scenarios

### Testing Different Configurations

```bash
# Force different configurations for testing
export FORCE_SQL_IMAGE="mcr.microsoft.com/azure-sql-edge:latest"
npm run docker:stress-test:quick

# Skip detection for testing existing config
export SKIP_PLATFORM_DETECTION=true
npm run docker:start
```

### Testing Edge Cases

```bash
# Test with limited resources
docker run --memory=500m --cpus=0.5 mcr.microsoft.com/mssql/server:2022-latest@sha256:d1d2fa72786dd255f25ef85a4862510db1d4f9aa844519db565136311c0d7c7f

# Test with different Docker Compose versions
docker-compose version
docker compose version
```

### Multi-Platform Testing

If you have access to different architectures:

1. **Intel Mac**: Test native AMD64 performance
2. **Apple Silicon**: Test Rosetta 2 emulation
3. **Linux x86_64**: Test production-like environment
4. **Linux ARM64**: Test native ARM64 with SQL Edge fallback

## 📋 Test Results Analysis

### Interpreting Results

- **100% Pass Rate**: Excellent, ready for production
- **90-99% Pass Rate**: Very good, minor optimizations possible
- **75-89% Pass Rate**: Good, some environment-specific issues
- **<75% Pass Rate**: Investigate environment setup

### Result Files

The comprehensive stress test generates detailed results:

```bash
# View detailed results
cat test/docker/.stress-test-results.json

# Key metrics to monitor
- summary.successRate
- environment.platform/arch
- performance insights
- failed test details
```

## 🎉 Success Criteria

Your platform detection is working correctly when:

✅ **Quick stress test passes with >90% success rate**  
✅ **No platform mismatch warnings in Docker logs**  
✅ **Consistent detection across multiple runs**  
✅ **Container starts and stops cleanly**  
✅ **Generated Docker Compose is syntactically valid**  
✅ **Performance is within expected benchmarks**  
✅ **Memory usage remains stable**

## 🔗 Related Documentation

- **[Platform Detection Guide](PLATFORM-DETECTION.md)** - How the detection system works
- **[Docker Testing Setup](README.md)** - Complete Docker testing guide
- **[Manual Integration Tests](../integration/manual/README.md)** - Database testing procedures

---

> **💡 Pro Tip**: Run the quick stress test whenever you switch machines, update Docker, or make changes to the
> platform detection system. It's designed to catch issues early and provide confidence in your development environment.
