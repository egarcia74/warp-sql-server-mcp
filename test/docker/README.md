# Docker Testing Setup

## Overview

This directory provides **automated Docker-based testing** for the SQL Server MCP server. It offers
a complete containerized SQL Server environment that can be spun up and torn down automatically,
making testing faster and more consistent.

## 🐳 **Docker vs Manual Testing Comparison**

| Aspect                    | 🐳 **Docker Setup**            | 🔧 **Manual Setup**             |
| ------------------------- | ------------------------------ | ------------------------------- |
| **Setup Time**            | 2-3 minutes                    | 30+ minutes                     |
| **Prerequisites**         | Docker + Docker Compose        | SQL Server installation         |
| **Consistency**           | Identical for all developers   | Varies by environment           |
| **Isolation**             | Complete isolation             | Uses system SQL Server          |
| **Cleanup**               | Automatic                      | Manual database cleanup         |
| **SQL Server Version**    | SQL Server 2022 (latest)       | Whatever you have installed     |
| **Configuration**         | Standardized                   | Varies by installation          |
| **Cross-platform**        | Works on macOS/Linux/Windows   | Platform-specific setup         |
| **Production Similarity** | Development/testing focused    | Can mirror production exactly   |
| **Multiple Environments** | Limited to containerized setup | Test against different versions |
| **Enterprise Features**   | Basic SQL Server features      | Full enterprise capabilities    |

## 🧠 **Intelligent Platform Detection**

> **NEW**: Automatic architecture detection for optimal performance!

The MCP server now includes **intelligent platform detection** that automatically configures the best SQL Server container for your hardware:

- **🍎 Apple Silicon (ARM64)**: SQL Server 2022 with Rosetta 2 emulation (full compatibility)
- **💻 Intel/AMD64**: Native SQL Server 2022 (optimal performance)
- **🔄 ARM64 Fallback**: Azure SQL Edge (native ARM64 with core features)

```bash
# View detected configuration
npm run docker:detect

# Configuration is automatically applied during:
npm run docker:start  # Auto-detects and uses optimal setup
```

**📖 [Complete Platform Detection Guide](PLATFORM-DETECTION.md)**

## 🚀 **Quick Start (Recommended for Development)**

### Prerequisites

```bash
# Check if Docker and Docker Compose are installed
docker --version
docker-compose --version

# If not installed, install Docker Desktop:
# https://docs.docker.com/get-docker/
```

### Option 1: Full Automated Testing

```bash
# Run all tests with automatic container management
npm run test:integration

# This will:
# 1. Start SQL Server container
# 2. Wait for database initialization
# 3. Run all integration tests (manual, protocol, performance)
# 4. Stop and cleanup container
```

### Option 2: Manual Container Management

```bash
# Start container (one-time setup)
npm run docker:start

# Run individual test components (requires running container)
npm run test:integration:manual      # All security phases (20+10+10 tests)
npm run test:integration:protocol    # MCP protocol tests
npm run test:integration:performance # Performance tests

# Stop container when done
npm run docker:stop
```

## 📋 **Available Docker Commands**

### Container Management

```bash
npm run docker:start     # Start SQL Server container and wait for ready
npm run docker:stop      # Stop and remove container
npm run docker:restart   # Restart container
npm run docker:clean     # Stop container and remove all data volumes
npm run docker:status    # Check container status
```

### Testing Commands

```bash
npm run test:integration                # All integration tests with Docker lifecycle
npm run test:integration:manual        # Manual security phases (requires running container)
npm run test:integration:protocol      # MCP protocol testing (requires running container)
npm run test:integration:performance   # Performance testing (requires running container)
```

### Debugging Commands

```bash
npm run docker:logs     # View container logs
npm run docker:shell    # Get shell access to container
npm run docker:sql      # Connect to SQL Server CLI
npm run docker:wait     # Test database readiness
```

## 🗄️ **Database Schema**

The Docker container automatically creates:

### Databases

- **`WarpMcpTest`**: Main test database with full Northwind-style schema
- **`Phase1ReadOnly`**: Read-only test data for Phase 1 testing
- **`Phase2DML`**: Test data for DML operations testing
- **`Phase3DDL`**: Empty database for DDL operations testing

### Sample Data

- **8 Categories** (Beverages, Condiments, Dairy, etc.)
- **5 Suppliers** (Various international suppliers)
- **12 Products** (Chai, Chang, Aniseed Syrup, etc.)
- **5 Customers** (Sample customer data)
- **5 Orders** with order details
- **Foreign key relationships** between all tables
- **Indexes** for performance testing
- **Views** for complex query testing
- **Stored procedures** for procedure testing

## 🔧 **Configuration**

### Environment Variables

Docker testing uses `test/docker/.env.docker`:

```bash
# Database connection (container defaults)
SQL_SERVER_HOST=localhost
SQL_SERVER_PORT=1433
SQL_SERVER_USER=sa
SQL_SERVER_PASSWORD=WarpMCP123!

# SSL disabled for container testing
SQL_SERVER_ENCRYPT=false
SQL_SERVER_TRUST_CERT=true

# Security settings are NOT set in Docker environment
# They are controlled by individual test files:
# - Phase 1: Read-only mode
# - Phase 2: DML operations enabled
# - Phase 3: Full development mode
```

### Container Configuration

- **Image**: `mcr.microsoft.com/mssql/server:2022-latest@sha256:d1d2fa72786dd255f25ef85a4862510db1d4f9aa844519db565136311c0d7c7f`
  - Note: Using a pinned digest ensures reproducible builds and satisfies supply‑chain checks.
- **Port**: `1433` (mapped to host)
- **Memory**: 2GB allocated
- **Storage**: Persistent volume for data
- **Network**: Isolated Docker network

### Password Standardization

**All environments now use the same password: `WarpMCP123!`**

- **Docker Container**: Hardcoded in `docker-compose.yml`
- **Docker Tests**: Configured in `test/docker/.env.docker`
- **Local Development**: Configured in `.env` and `.env.demo`
- **Template**: Example shown in `.env.example`

This ensures consistency across all testing and development environments.

## 🧪 **Testing Phases**

### Phase 1: Read-Only Security (20 tests)

```bash
# Run all phases including Phase 1 via:
npm run test:integration:manual
```

**Tests:**

- Database connectivity
- Read-only mode enforcement
- SELECT query functionality
- Security boundary validation
- Error handling for blocked operations

### Phase 2: DML Operations (10 tests)

```bash
# Run all phases including Phase 2 via:
npm run test:integration:manual
```

**Tests:**

- INSERT operations
- UPDATE operations
- DELETE operations
- Data persistence validation
- Transaction handling

### Phase 3: DDL Operations (10 tests)

```bash
# Run all phases including Phase 3 via:
npm run test:integration:manual
```

**Tests:**

- CREATE TABLE operations
- ALTER TABLE operations
- DROP TABLE operations
- Index management
- Schema modifications

## 🔍 **Troubleshooting**

### Container Won't Start

```bash
# Check Docker daemon
docker info

# Check port availability
netstat -an | grep 1433
lsof -i :1433

# Check container logs
npm run docker:logs

# Clean up conflicting containers
npm run docker:clean
docker ps -a
```

### Database Connection Issues

```bash
# Test database readiness
npm run docker:wait

# Check SQL Server logs
npm run docker:logs

# Connect manually to debug
npm run docker:sql
```

### Common Issues

#### Port 1433 Already in Use

```bash
# Find what's using the port
lsof -i :1433

# Either stop the conflicting service or change port in docker-compose.yml
```

#### Container Startup Timeout

```bash
# SQL Server can take 1-2 minutes to fully initialize
# Wait longer or check logs for errors
npm run docker:logs

# Restart if needed
npm run docker:restart
```

#### Permission Denied

```bash
# Ensure Docker has proper permissions
sudo docker ps

# Or add your user to docker group (Linux/macOS)
sudo usermod -aG docker $USER
```

## 🏭 **When to Use Manual Setup Instead**

Use **manual setup** (`npm run test:integration:manual`) when you need:

### Production Validation

- Testing against actual production SQL Server versions
- Validating SSL/TLS certificate configurations
- Testing Windows Authentication (NTLM)
- Complex network configurations
- Enterprise security features

### Version Testing

- Testing against SQL Server 2016, 2017, 2019
- Testing against different collations
- Testing against clustered instances
- Testing against AlwaysOn configurations

### Performance Validation

- Large database testing (>1GB)
- Complex query performance testing
- Real-world performance benchmarks
- Memory pressure testing

### Advanced Features

- Full-text search testing
- Analysis Services integration
- Reporting Services features
- Advanced security features

## 📊 **Performance Characteristics**

### Docker Setup Performance

- **Container startup**: 60-90 seconds
- **Database initialization**: 30-45 seconds
- **Test execution**: Same as manual
- **Container shutdown**: 5-10 seconds
- **Total test time**: ~5-8 minutes

### Resource Usage

- **Memory**: ~2GB for SQL Server container
- **Disk**: ~500MB for container image + data
- **CPU**: Moderate during startup, low during testing

## 🔄 **Integration with CI/CD**

While these tests are currently **excluded from CI/CD** (by design), the Docker setup makes it possible to add them in the future:

```yaml
# Example GitHub Actions integration (future consideration)
- name: Start SQL Server
  run: npm run docker:start

- name: Run Integration Tests
  run: npm run test:integration

- name: Stop SQL Server
  run: npm run docker:stop
```

## 🎯 **Best Practices**

### Development Workflow

1. **Start with Docker** for day-to-day development testing
2. **Use manual setup** for pre-release validation
3. **Clean up regularly** with `npm run docker:clean`
4. **Check logs** if tests fail unexpectedly

### Debugging Workflow

1. **Check container status**: `npm run docker:status`
2. **View logs**: `npm run docker:logs`
3. **Test connectivity**: `npm run docker:wait`
4. **Manual SQL access**: `npm run docker:sql`

### Performance Considerations

- **Container startup** is the slowest part (~2 minutes)
- **Keep container running** during active development
- **Use `docker:restart`** instead of stop/start when possible
- **Clean volumes occasionally** to prevent disk buildup

## 📝 **Files in this Directory**

- **`docker-compose.yml`**: Container orchestration configuration
- **`init-db.sql`**: Database initialization script with sample data
- **`.env.docker`**: Docker-specific environment variables
- **`wait-for-db.js`**: Database readiness verification script
- **`README.md`**: This documentation file

## 🤝 **Contributing**

When modifying the Docker setup:

1. **Test changes locally** with `npm run docker:clean && npm run docker:start`
2. **Verify all test phases** work correctly
3. **Update documentation** if changing configuration
4. **Consider backward compatibility** with existing workflows

---

## 🎉 **Summary**

The Docker testing setup provides:

- ✅ **Fast, consistent testing environment**
- ✅ **Zero configuration for new contributors**
- ✅ **Complete isolation and cleanup**
- ✅ **Standardized SQL Server 2022 environment**
- ✅ **Automated database initialization**
- ✅ **Comprehensive debugging tools**

**Use Docker for development, manual setup for production validation!**
