#!/usr/bin/env node

/**
 * Platform Detection Script for SQL Server Docker Testing
 *
 * Automatically detects the host architecture and generates the optimal
 * Docker Compose configuration for SQL Server containers.
 *
 * Architecture Support:
 * - ARM64 (Apple Silicon): Uses Azure SQL Edge (native ARM64)
 * - AMD64 (Intel/AMD): Uses SQL Server 2022 (native AMD64)
 * - ARM64 with Rosetta fallback: Uses SQL Server 2022 with platform override
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration templates
const CONFIG_TEMPLATES = {
  sqlserver_amd64: {
    image: 'mcr.microsoft.com/mssql/server:2022-latest',
    platform: null, // Native AMD64
    environment: {
      MSSQL_PID: 'Developer',
      MSSQL_AGENT_ENABLED: 'true',
      MSSQL_COLLATION: 'SQL_Latin1_General_CP1_CI_AS'
    },
    healthcheck: {
      test: [
        'CMD-SHELL',
        '/opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P WarpMCP123! -C -Q "SELECT 1" || exit 1'
      ]
    }
  },
  sqlserver_arm64_rosetta: {
    image: 'mcr.microsoft.com/mssql/server:2022-latest',
    platform: 'linux/amd64', // Force AMD64 on ARM64 with Rosetta
    environment: {
      MSSQL_PID: 'Developer',
      MSSQL_AGENT_ENABLED: 'true',
      MSSQL_COLLATION: 'SQL_Latin1_General_CP1_CI_AS',
      // Critical for Apple Silicon stability
      MSSQL_TCP_PORT: '1433',
      MSSQL_ENABLE_HADR: '0',
      MSSQL_MEMORY_LIMIT_MB: '2048'
    },
    healthcheck: {
      test: [
        'CMD-SHELL',
        '/opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "WarpMCP123!" -C -Q "SELECT 1" -t 10 || exit 1'
      ],
      interval: '15s',
      timeout: '10s',
      retries: 8,
      start_period: '45s'
    },
    // Apple Silicon specific enhancements
    deploy: {
      resources: {
        limits: {
          memory: '2.5G'
        },
        reservations: {
          memory: '1G'
        }
      }
    },
    init: true,
    cap_add: ['SYS_PTRACE'],
    security_opt: ['seccomp:unconfined'],
    tmpfs: ['/tmp:noexec,nosuid,size=100m']
  },
  azure_sql_edge_arm64: {
    image: 'mcr.microsoft.com/azure-sql-edge:latest',
    platform: null, // Native ARM64
    environment: {
      MSSQL_PID: 'Developer',
      MSSQL_AGENT_ENABLED: 'false', // SQL Edge doesn't support SQL Agent
      MSSQL_COLLATION: 'SQL_Latin1_General_CP1_CI_AS',
      // Optimizations for ARM64
      MSSQL_TCP_PORT: '1433',
      MSSQL_ENABLE_HADR: '0'
    },
    healthcheck: {
      test: [
        'CMD-SHELL',
        '/opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "WarpMCP123!" -C -Q "SELECT 1" -t 10 || exit 1'
      ],
      interval: '12s',
      timeout: '8s',
      retries: 6,
      start_period: '35s'
    }
  }
};

/**
 * Detect the host architecture
 */
function detectArchitecture() {
  try {
    const arch = process.arch;
    const platform = process.platform;

    const isQuiet = process.env.TESTING_MODE === 'true';
    if (!isQuiet) {
      console.log(`🔍 Detected platform: ${platform}, architecture: ${arch}`);
    }

    return {
      arch,
      platform,
      isAppleSilicon: platform === 'darwin' && arch === 'arm64',
      isIntelMac: platform === 'darwin' && arch === 'x64',
      isLinuxARM64: platform === 'linux' && arch === 'arm64',
      isLinuxAMD64: platform === 'linux' && arch === 'x64'
    };
  } catch {
    // Platform detection failed
    console.error('🚨 Platform detection failed, using default settings');
    return {
      arch: 'unknown',
      platform: 'unknown',
      isAppleSilicon: false,
      isIntelMac: false,
      isLinuxARM64: false,
      isLinuxAMD64: false
    };
  }
}

/**
 * Check if Docker supports multiarch/Rosetta 2
 */
function checkDockerCapabilities() {
  try {
    // Check if Docker is running
    execSync('docker info', { stdio: 'ignore' });

    // Check available platforms
    const dockerInfo = execSync('docker system info --format "{{.Architecture}}"', {
      encoding: 'utf8'
    }).trim();

    // Check if we can run AMD64 images (Rosetta 2 support)
    try {
      execSync('docker run --rm --platform linux/amd64 hello-world', { stdio: 'ignore' });
      return { hasDocker: true, supportsAMD64: true, nativeArch: dockerInfo };
    } catch {
      return { hasDocker: true, supportsAMD64: false, nativeArch: dockerInfo };
    }
  } catch {
    return { hasDocker: false, supportsAMD64: false, nativeArch: null };
  }
}

/**
 * Choose the best configuration based on capabilities
 */
function chooseBestConfiguration(hostInfo, dockerInfo) {
  const isQuiet = process.env.TESTING_MODE === 'true';

  if (!isQuiet) {
    console.log('\n🤔 Analyzing best configuration...');
  }

  // Intel/AMD64 systems - use native SQL Server
  if (hostInfo.arch === 'x64') {
    if (!isQuiet) {
      console.log('✅ Intel/AMD64 detected - using native SQL Server 2022');
    }
    return {
      config: CONFIG_TEMPLATES.sqlserver_amd64,
      reason: 'Native AMD64 architecture - optimal performance',
      performance: 'Excellent (native)',
      compatibility: 'Full SQL Server feature set'
    };
  }

  // ARM64 systems
  if (hostInfo.arch === 'arm64') {
    if (!dockerInfo.hasDocker) {
      throw new Error('Docker is not available or not running');
    }

    // Check if we can run AMD64 with good performance (Rosetta 2)
    if (dockerInfo.supportsAMD64 && hostInfo.isAppleSilicon) {
      if (!isQuiet) {
        console.log('✅ Apple Silicon with Rosetta 2 - using SQL Server 2022 (emulated)');
      }
      return {
        config: CONFIG_TEMPLATES.sqlserver_arm64_rosetta,
        reason: 'Apple Silicon with Rosetta 2 emulation - full SQL Server compatibility',
        performance: 'Very Good (emulated via Rosetta 2)',
        compatibility: 'Full SQL Server feature set'
      };
    }

    // Fallback to Azure SQL Edge for native ARM64
    if (!isQuiet) {
      console.log('✅ ARM64 detected - using Azure SQL Edge (native)');
    }
    return {
      config: CONFIG_TEMPLATES.azure_sql_edge_arm64,
      reason: 'Native ARM64 architecture - best performance for ARM64',
      performance: 'Excellent (native ARM64)',
      compatibility: 'SQL Server core features (no SQL Agent)'
    };
  }

  // Fallback
  if (!isQuiet) {
    console.log('⚠️  Unknown architecture - using SQL Server with platform override');
  }
  return {
    config: CONFIG_TEMPLATES.sqlserver_arm64_rosetta,
    reason: 'Unknown architecture - using emulation as fallback',
    performance: 'Unknown (emulated)',
    compatibility: 'Full SQL Server feature set'
  };
}

/**
 * Generate Docker Compose YAML
 */
function generateDockerCompose(selectedConfig) {
  const baseCompose = {
    services: {
      sqlserver: {
        image: selectedConfig.config.image,
        ...(selectedConfig.config.platform && { platform: selectedConfig.config.platform }),
        container_name: 'warp-mcp-sqlserver',
        hostname: 'warp-mcp-sqlserver',
        environment: {
          ACCEPT_EULA: 'Y',
          SA_PASSWORD: 'WarpMCP123!',
          ...selectedConfig.config.environment
        },
        ports: ['1433:1433'],
        volumes: [
          './init-db.sql:/docker-entrypoint-initdb.d/init-db.sql:ro',
          'sqlserver_data:/var/opt/mssql'
        ],
        healthcheck: {
          test: selectedConfig.config.healthcheck.test,
          interval: selectedConfig.config.healthcheck.interval || '10s',
          timeout: selectedConfig.config.healthcheck.timeout || '5s',
          retries: selectedConfig.config.healthcheck.retries || 5,
          start_period: selectedConfig.config.healthcheck.start_period || '30s'
        },
        restart: 'unless-stopped',
        networks: ['warp-mcp-network'],
        // Add Apple Silicon specific configurations if present
        ...(selectedConfig.config.deploy && { deploy: selectedConfig.config.deploy }),
        ...(selectedConfig.config.init && { init: selectedConfig.config.init }),
        ...(selectedConfig.config.cap_add && { cap_add: selectedConfig.config.cap_add }),
        ...(selectedConfig.config.security_opt && {
          security_opt: selectedConfig.config.security_opt
        }),
        ...(selectedConfig.config.tmpfs && { tmpfs: selectedConfig.config.tmpfs })
      }
    },
    volumes: {
      sqlserver_data: {
        driver: 'local'
      }
    },
    networks: {
      'warp-mcp-network': {
        driver: 'bridge'
      }
    }
  };

  return baseCompose;
}

/**
 * Convert object to YAML string (improved implementation)
 */
function objectToYaml(obj, indent = 0) {
  const spaces = ' '.repeat(indent);
  let yaml = '';

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;

    yaml += `${spaces}${key}:`;

    if (Array.isArray(value)) {
      yaml += '\n';
      value.forEach(item => {
        if (typeof item === 'string') {
          // Handle special characters in strings
          const needsQuotes =
            item.includes('"') || item.includes("'") || item.includes('|') || item.includes('>');
          if (needsQuotes) {
            yaml += `${spaces}  - '${item.replace(/'/g, "''")}'\n`;
          } else {
            yaml += `${spaces}  - ${item}\n`;
          }
        } else {
          yaml += `${spaces}  - ${JSON.stringify(item)}\n`;
        }
      });
    } else if (typeof value === 'object') {
      yaml += '\n';
      yaml += objectToYaml(value, indent + 2);
    } else {
      // Improved value quoting logic
      let outputValue = value;
      if (typeof value === 'string') {
        // Always quote version numbers
        if (key === 'version') {
          outputValue = `"${value}"`;
        }
        // Quote strings with special characters
        else if (
          value.includes(':') ||
          value.includes('#') ||
          value.includes('"') ||
          value.includes("'")
        ) {
          outputValue = `"${value.replace(/"/g, '\\"')}"`;
        }
        // Quote boolean strings to prevent YAML interpretation
        else if (value === 'true' || value === 'false' || value === 'yes' || value === 'no') {
          outputValue = `"${value}"`;
        }
      }
      yaml += ` ${outputValue}\n`;
    }
  }

  return yaml;
}

/**
 * Write configuration files
 */
function writeConfiguration(selectedConfig, dockerCompose, outputDir) {
  const dockerComposePath = path.join(outputDir, 'docker-compose.yml');
  const configInfoPath = path.join(outputDir, '.platform-config.json');

  // Write Docker Compose file
  const yamlContent = objectToYaml(dockerCompose);
  fs.writeFileSync(dockerComposePath, yamlContent);

  // Write configuration info
  const configInfo = {
    generated: new Date().toISOString(),
    architecture: process.arch,
    platform: process.platform,
    selected: selectedConfig,
    dockerCompose: 'docker-compose.yml'
  };
  fs.writeFileSync(configInfoPath, JSON.stringify(configInfo, null, 2));

  return { dockerComposePath, configInfoPath };
}

/**
 * Main execution
 */
function main() {
  const isQuiet = process.env.TESTING_MODE === 'true';

  if (!isQuiet) {
    console.log('🚀 SQL Server Docker Platform Detection\n');
  }

  try {
    // Detect host capabilities
    const hostInfo = detectArchitecture();
    if (!hostInfo) {
      process.exit(1);
    }

    const dockerInfo = checkDockerCapabilities();
    if (!isQuiet) {
      console.log(`📋 Docker capabilities: ${JSON.stringify(dockerInfo, null, 2)}`);
    }

    // Choose best configuration
    const selectedConfig = chooseBestConfiguration(hostInfo, dockerInfo);

    // Generate Docker Compose
    const dockerCompose = generateDockerCompose(selectedConfig);

    // Write configuration
    const outputDir = __dirname;
    const { dockerComposePath, configInfoPath } = writeConfiguration(
      selectedConfig,
      dockerCompose,
      outputDir
    );

    // Display results
    if (!isQuiet) {
      console.log('\n✅ Configuration Generated Successfully!');
      console.log(`📁 Docker Compose: ${dockerComposePath}`);
      console.log(`📋 Config Info: ${configInfoPath}`);
      console.log('\n📊 Selected Configuration:');
      console.log(`   Image: ${selectedConfig.config.image}`);
      console.log(`   Platform: ${selectedConfig.config.platform || 'native'}`);
      console.log(`   Reason: ${selectedConfig.reason}`);
      console.log(`   Performance: ${selectedConfig.performance}`);
      console.log(`   Compatibility: ${selectedConfig.compatibility}`);

      console.log('\n🎯 Next Steps:');
      console.log('   npm run docker:start    # Start the optimized container');
      console.log('   npm run docker:wait     # Wait for database readiness');
      console.log('   npm run test:manual:docker  # Run tests');
    }
  } catch (error) {
    console.error('\n❌ Configuration failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly (ES module equivalent)
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export {
  detectArchitecture,
  checkDockerCapabilities,
  chooseBestConfiguration,
  generateDockerCompose,
  main
};
