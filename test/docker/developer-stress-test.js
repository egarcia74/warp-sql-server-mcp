#!/usr/bin/env node

/**
 * Developer-Friendly Platform Detection Stress Test
 *
 * Clear, focused testing with meaningful feedback for developers.
 * Shows exactly what's being tested and why it matters.
 */

import {
  detectArchitecture,
  checkDockerCapabilities,
  chooseBestConfiguration
} from './detect-platform.js';
import { execSync } from 'child_process';
import fs from 'fs';

console.log('🧪 Platform Detection Developer Test\n');

let totalTests = 0;
let passedTests = 0;
let currentStep = 0;

// Test steps with clear descriptions
const testSteps = [
  'Hardware Detection',
  'Docker Environment',
  'Platform Capabilities',
  'Configuration Generation',
  'Container Validation'
];

function showProgress(step, total = testSteps.length) {
  const percentage = Math.round((step / total) * 100);
  const filled = Math.floor(percentage / 5);
  const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
  console.log(`\n[${bar}] ${percentage}% - Testing: ${testSteps[step - 1]}`);
}

function test(name, description, testFn, { silent = false, required = true } = {}) {
  totalTests++;

  if (!silent) {
    process.stdout.write(`  ${name}... `);
  }

  try {
    const start = Date.now();
    const result = testFn();
    const duration = Date.now() - start;

    if (result) {
      passedTests++;
      if (!silent) {
        console.log(`✅ ${duration > 100 ? `(${duration}ms)` : ''}`);
      }
      return true;
    } else {
      if (!silent) {
        console.log('❌ FAILED');
        if (description) {
          console.log(`     ${description}`);
        }
      }
      return false;
    }
  } catch (error) {
    if (!silent) {
      console.log(`❌ ERROR: ${error.message}`);
      if (required) {
        console.log('     This is a critical failure that may prevent Docker testing');
      }
    }
    return false;
  }
}

// Step 1: Hardware Detection
showProgress(++currentStep);

const hostInfo = detectArchitecture();
console.log(`  Detected: ${hostInfo.platform}/${hostInfo.arch}`);

if (hostInfo.isAppleSilicon) {
  console.log('  Architecture: Apple Silicon (ARM64) - will use Rosetta 2 emulation');
} else if (hostInfo.isIntelMac) {
  console.log('  Architecture: Intel Mac (AMD64) - native performance');
} else {
  console.log(`  Architecture: ${hostInfo.arch} - will select optimal configuration`);
}

test(
  'Hardware detection works',
  'Platform detection must work for configuration selection',
  () => hostInfo && hostInfo.arch && hostInfo.platform
);

test(
  'Architecture classification',
  'Must correctly identify architecture type',
  () =>
    hostInfo.isAppleSilicon || hostInfo.isIntelMac || hostInfo.isLinuxARM64 || hostInfo.isLinuxAMD64
);

// Step 2: Docker Environment
showProgress(++currentStep);

let dockerAvailable = false;
test('Docker daemon running', 'Docker must be available for container testing', () => {
  try {
    execSync('docker version', { stdio: 'ignore' });
    dockerAvailable = true;
    return true;
  } catch {
    console.log('     Install Docker Desktop: https://docs.docker.com/get-docker/');
    return false;
  }
});

if (dockerAvailable) {
  test('Docker Compose available', 'Required for container orchestration', () => {
    try {
      execSync('docker-compose --version', { stdio: 'ignore' });
      return true;
    } catch {
      try {
        execSync('docker compose version', { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    }
  });
}

// Step 3: Platform Capabilities
showProgress(++currentStep);

const dockerInfo = checkDockerCapabilities();
console.log(`  Docker Status: ${dockerInfo.hasDocker ? 'Available' : 'Not Available'}`);

if (dockerInfo.hasDocker) {
  console.log(`  Multi-platform: ${dockerInfo.supportsAMD64 ? 'Supported' : 'Limited'}`);

  test(
    'Multi-platform support',
    'Needed for cross-architecture containers',
    () => dockerInfo.supportsAMD64,
    { required: false }
  );

  if (hostInfo.isAppleSilicon) {
    test('Rosetta 2 emulation', 'Apple Silicon running AMD64 containers via Rosetta 2', () => {
      try {
        // Quick test of AMD64 emulation (should be fast since we tested this earlier)
        execSync('timeout 10 docker run --rm --platform linux/amd64 hello-world', {
          stdio: 'ignore'
        });
        return true;
      } catch {
        console.log('     Enable "Use Rosetta for x86/amd64 emulation" in Docker settings');
        return false;
      }
    });
  }
}

// Step 4: Configuration Generation
showProgress(++currentStep);

let selectedConfig = null;
test('Configuration selection', 'Must choose optimal SQL Server setup for your hardware', () => {
  try {
    // Temporarily suppress console.log during config selection
    const originalLog = console.log;
    console.log = () => {};

    selectedConfig = chooseBestConfiguration(hostInfo, dockerInfo);

    // Restore console.log
    console.log = originalLog;

    return selectedConfig.config.image;
  } catch (error) {
    console.log(`     Configuration error: ${error.message}`);
    return false;
  }
});

if (selectedConfig) {
  console.log(`  Selected: ${selectedConfig.config.image}`);
  console.log(`  Platform: ${selectedConfig.config.platform || 'native'}`);
  console.log(`  Reason: ${selectedConfig.reason}`);
  console.log(`  Expected Performance: ${selectedConfig.performance}`);
}

test('Config file generation', 'Must create Docker Compose and config files', () => {
  try {
    // Run detection to generate files (suppress output)
    const currentDir = process.cwd();
    execSync('npm run docker:detect', {
      stdio: 'ignore',
      cwd: currentDir,
      env: { ...process.env, TESTING_MODE: 'true' }
    });

    // Check if files exist
    const dockerComposePath = 'test/docker/docker-compose.yml';
    const configPath = 'test/docker/.platform-config.json';

    return fs.existsSync(dockerComposePath) && fs.existsSync(configPath);
  } catch (error) {
    console.log(`     Generation failed: ${error.message}`);
    return false;
  }
});

test('Docker Compose syntax', 'Generated configuration must be valid', () => {
  try {
    execSync('docker-compose -f test/docker/docker-compose.yml config', { stdio: 'ignore' });
    return true;
  } catch {
    console.log('     Invalid Docker Compose syntax in generated file');
    return false;
  }
});

// Step 5: Container Validation (only if Docker is available)
showProgress(++currentStep);

if (dockerAvailable && selectedConfig) {
  console.log('  Testing container lifecycle...');

  let containerStarted = false;

  test('Container startup', 'Must start SQL Server without platform warnings', () => {
    try {
      // Ensure clean state
      try {
        execSync('docker-compose -f test/docker/docker-compose.yml down -v', { stdio: 'ignore' });
      } catch {
        /* ignore */
      }

      // Start container
      execSync('docker-compose -f test/docker/docker-compose.yml up -d', { stdio: 'ignore' });

      // Quick check if running
      const output = execSync('docker ps --filter name=warp-mcp-sqlserver --format "{{.Names}}"', {
        encoding: 'utf8'
      });
      containerStarted = output.includes('warp-mcp-sqlserver');

      return containerStarted;
    } catch (error) {
      console.log(`     Startup failed: ${error.message}`);
      return false;
    }
  });

  if (containerStarted) {
    test(
      'No platform warnings',
      'Container should start without architecture mismatch warnings',
      () => {
        try {
          // Give container a moment to log startup messages
          setTimeout(() => {}, 2000);

          const logs = execSync('docker logs warp-mcp-sqlserver', {
            encoding: 'utf8',
            stderr: 'pipe'
          });
          const hasWarning = logs.includes('platform') && logs.includes('does not match');

          if (hasWarning) {
            console.log('     Platform mismatch warning detected in logs');
            return false;
          }

          return true;
        } catch (error) {
          console.log(`     Could not check container logs: ${error.message}`);
          return false;
        }
      },
      { required: false }
    );

    // Clean up
    test(
      'Container cleanup',
      'Must stop and remove container cleanly',
      () => {
        try {
          execSync('docker-compose -f test/docker/docker-compose.yml down', { stdio: 'ignore' });

          // Verify it's stopped
          const output = execSync('docker ps --filter name=warp-mcp-sqlserver', {
            encoding: 'utf8'
          });
          return !output.includes('warp-mcp-sqlserver') || output.split('\n').length <= 2;
        } catch (error) {
          console.log(`     Cleanup failed: ${error.message}`);
          return false;
        }
      },
      { required: false }
    );
  }
} else {
  console.log('  Skipping container tests (Docker not available or config failed)');
}

// Final Results
console.log('\n' + '='.repeat(50));
console.log('📊 Test Results');
console.log('='.repeat(50));

const successRate = Math.round((passedTests / totalTests) * 100);
console.log(`Passed: ${passedTests}/${totalTests} (${successRate}%)`);

if (successRate >= 90) {
  console.log('\n🎉 EXCELLENT - Your platform detection is working perfectly!');
  console.log('✅ Ready for development and testing');
} else if (successRate >= 75) {
  console.log('\n✅ GOOD - Platform detection is working with minor issues');
  console.log('⚠️  Some features may have reduced functionality');
} else if (successRate >= 50) {
  console.log('\n⚠️  WARNING - Several issues detected');
  console.log('🔧 Review the failed tests above and fix the underlying issues');
} else {
  console.log('\n❌ CRITICAL - Multiple failures detected');
  console.log('🚨 Platform detection needs significant fixes before use');
}

// Recommendations
console.log('\n💡 Next Steps:');

if (selectedConfig) {
  console.log('✅ Use: npm run docker:start (auto-detects and starts optimized container)');
  console.log('📋 Config: cat test/docker/.platform-config.json');
} else {
  console.log('🔧 Fix configuration issues first, then retry');
}

if (!dockerAvailable) {
  console.log('🐳 Install Docker Desktop for container testing');
}

if (successRate < 100) {
  console.log('🧪 Run full diagnostics: npm run docker:stress-test');
}

console.log('📖 Documentation: test/docker/PLATFORM-DETECTION.md');

// Exit with error count
process.exit(totalTests - passedTests);
