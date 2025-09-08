# 🧠 Intelligent Platform Detection for SQL Server Docker Testing

The warp-sql-server-mcp project includes an **intelligent platform detection system** that automatically chooses the optimal
SQL Server container configuration based on your hardware architecture and Docker capabilities.

## 🎯 Overview

Instead of manually configuring Docker Compose files for different architectures, the system:

1. **Auto-detects** your hardware architecture (Intel/AMD64 vs Apple Silicon/ARM64)
2. **Tests Docker capabilities** (Rosetta 2 emulation support, multi-platform capabilities)
3. **Chooses the best configuration** for optimal performance and compatibility
4. **Generates optimized Docker Compose files** automatically

## 🔧 How It Works

### Automatic Detection Process

```bash
npm run docker:detect  # Runs automatically before docker:start
```

The detection script (`test/docker/detect-platform.js`):

1. **Platform Detection**: Identifies your OS and CPU architecture
2. **Docker Capability Testing**: Checks for multi-platform support and emulation
3. **Configuration Selection**: Chooses the optimal SQL Server container setup
4. **File Generation**: Creates optimized `docker-compose.yml` and `.platform-config.json`

### Architecture-Specific Configurations

#### 🍎 Apple Silicon (ARM64) - Recommended

```bash
# Detected: macOS + ARM64 + Rosetta 2 support
# Selected: SQL Server 2022 with linux/amd64 platform override
```

**Benefits**:

- ✅ **Full SQL Server compatibility** - Complete feature set including SQL Agent
- ✅ **Excellent performance** - Rosetta 2 provides near-native speed
- ✅ **Zero configuration** - Works out of the box
- ✅ **Production parity** - Same SQL Server version as production systems

#### 💻 Intel/AMD64 - Optimal

```bash
# Detected: macOS/Linux + x64
# Selected: SQL Server 2022 native
```

**Benefits**:

- ✅ **Native performance** - No emulation overhead
- ✅ **Full compatibility** - Complete SQL Server feature set
- ✅ **Best performance** - Maximum execution speed

#### 🔄 ARM64 Fallback - Alternative

```bash
# Detected: ARM64 + No AMD64 emulation
# Selected: Azure SQL Edge (native ARM64)
```

**Benefits**:

- ✅ **Native ARM64** - No emulation required
- ✅ **Good performance** - Optimal for ARM64 hardware
- ⚠️ **Limited features** - Core SQL Server functionality (no SQL Agent)

## 🚀 Usage

### Automatic Detection (Recommended)

```bash
npm run docker:start        # Automatically detects and starts optimized container
npm run test:manual:docker   # Run full test suite with optimized configuration
```

### Manual Detection

```bash
npm run docker:detect       # Generate configuration without starting container
```

### View Configuration

```bash
# Check detected configuration
cat test/docker/.platform-config.json

# View generated Docker Compose
cat test/docker/docker-compose.yml
```

## 📊 Performance Comparison

| Architecture       | Configuration        | Performance   | Features | Compatibility |
| ------------------ | -------------------- | ------------- | -------- | ------------- |
| **Intel/AMD64**    | Native SQL Server    | **Excellent** | Full     | 100%          |
| **Apple Silicon**  | SQL Server + Rosetta | **Very Good** | Full     | 100%          |
| **ARM64 Fallback** | Azure SQL Edge       | **Good**      | Core     | ~90%          |

## 🛠️ Generated Files

### `docker-compose.yml`

Optimized Docker Compose configuration with:

- Correct platform specification
- Environment variables optimized for detected architecture
- Health checks configured for the selected SQL Server variant
- Performance-tuned settings

### `.platform-config.json`

Configuration metadata including:

- Detected architecture and platform
- Selected configuration with rationale
- Performance and compatibility information
- Generation timestamp for troubleshooting

## 🔍 Troubleshooting

### Check Detection Results

```bash
npm run docker:detect
```

Expected output for Apple Silicon:

```text
🔍 Detected platform: darwin, architecture: arm64
📋 Docker capabilities: {"hasDocker": true, "supportsAMD64": true, "nativeArch": "aarch64"}
✅ Apple Silicon with Rosetta 2 - using SQL Server 2022 (emulated)
```

### Manual Override

If you need to override the detection (not recommended), you can:

1. **Generate base configuration**: `npm run docker:detect`
2. **Manually edit**: Modify `test/docker/docker-compose.yml`
3. **Start container**: `npm run docker:start` (skipping detection)

### Common Issues

#### Docker Not Running

```bash
# Error: Docker is not available or not running
# Solution: Start Docker Desktop and retry
```

#### Platform Mismatch Warnings

```bash
# Old warning (now resolved):
# "The requested image's platform (linux/amd64) does not match the detected host platform"
# Solution: The detection system now handles this automatically
```

## 🎯 Integration with Development Workflow

### Local Development

```bash
npm run docker:start          # Auto-detect and start optimized container
npm run docker:wait           # Wait for database initialization
npm run test:manual:docker     # Run complete test suite
npm run docker:stop           # Clean shutdown
```

### CI/CD Integration

The platform detection works seamlessly in CI environments:

- **GitHub Actions**: Detects runner architecture automatically
- **Local CI**: Adapts to different developer machines
- **Docker Environments**: Works inside Docker containers

### Testing Different Configurations

```bash
# Test on different architectures
npm run docker:detect          # See what would be selected
npm run test:manual:docker     # Validate with detected configuration

# Force different configurations (advanced)
# Edit docker-compose.yml manually if needed for testing
```

## 🧪 Advanced Configuration

### Environment Variables

The detection system respects these optional overrides:

```bash
# Force specific image (not recommended)
export FORCE_SQL_IMAGE="mcr.microsoft.com/azure-sql-edge:latest"

# Skip detection (use existing docker-compose.yml)
export SKIP_PLATFORM_DETECTION=true
```

### Custom Configurations

To add support for additional architectures:

1. Edit `test/docker/detect-platform.js`
2. Add new configuration templates to `CONFIG_TEMPLATES`
3. Update detection logic in `chooseBestConfiguration()`
4. Test with `npm run docker:detect`

## 📈 Performance Metrics

Typical performance characteristics:

### Container Startup Time

- **Native (Intel/AMD64)**: ~45-60 seconds
- **Emulated (Apple Silicon)**: ~60-90 seconds
- **ARM64 Native (SQL Edge)**: ~30-45 seconds

### Query Performance

- **Native**: 100% baseline
- **Rosetta 2 Emulated**: 85-95% of native
- **ARM64 Native**: 100% baseline (limited features)

### Test Suite Runtime

- **All configurations**: ~2-3 minutes for full test suite
- **Performance difference**: <10% between configurations

## 🎉 Benefits of Intelligent Detection

1. **Zero Configuration**: Works out of the box on any architecture
2. **Optimal Performance**: Always selects the best available option
3. **Full Compatibility**: Maintains SQL Server feature parity where possible
4. **Developer Experience**: Eliminates platform-specific setup issues
5. **Future-Proof**: Automatically adapts to new Docker/platform capabilities

## 🔗 Related Documentation

- **[Docker Testing Setup](README.md)** - Complete Docker testing guide
- **[Manual Integration Tests](../integration/manual/README.md)** - Testing procedures
- **[WARP.md](../../WARP.md)** - Complete project documentation

---

> **💡 Pro Tip**: Run `npm run docker:detect` whenever you switch between different machines or Docker configurations to ensure optimal setup.
