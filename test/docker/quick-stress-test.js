#!/usr/bin/env node

/**
 * Quick Platform Detection Stress Test
 *
 * A developer-friendly stress test that focuses on the most critical
 * scenarios developers will encounter. Runs fast and provides clear
 * feedback on platform detection reliability.
 *
 * Use this for:
 * - Daily development validation
 * - Pre-commit testing
 * - Quick confidence checks
 *
 * For comprehensive testing, use: npm run docker:stress-test
 */

import {
  detectArchitecture,
  checkDockerCapabilities,
  chooseBestConfiguration
} from './detect-platform.js';
import { execFileSync } from 'node:child_process';

console.log('⚡ Quick Platform Detection Stress Test');
console.log('========================================\n');

let passed = 0;
let total = 0;

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runCommand(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    ...options
  });
}

function ensureDockerComposeConfig() {
  runCommand(npmCommand, ['run', 'docker:ensure-config'], {
    env: { ...process.env, TESTING_MODE: 'true' }
  });
}

function test(name, testFn) {
  total++;
  try {
    const start = Date.now();
    const result = testFn();
    const duration = Date.now() - start;

    if (result) {
      console.log(`✅ ${name} (${duration}ms)`);
      passed++;
    } else {
      console.log(`❌ ${name} - Test failed`);
    }
  } catch (error) {
    console.log(`❌ ${name} - ${error.message}`);
  }
}

// Test 1: Basic detection works
test('Architecture Detection', () => {
  const info = detectArchitecture();
  return Boolean(info?.arch && info?.platform);
});

// Test 2: Docker capabilities detection
test('Docker Capabilities', () => {
  const info = checkDockerCapabilities();
  return typeof info.hasDocker === 'boolean';
});

// Test 3: Configuration selection works
test('Configuration Selection', () => {
  const hostInfo = detectArchitecture();
  const dockerInfo = checkDockerCapabilities();
  const config = chooseBestConfiguration(hostInfo, dockerInfo);
  return config.config.image;
});

// Test 4: Docker is available (developer environment check)
test('Docker Environment', () => {
  try {
    runCommand('docker', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
});

// Test 5: Detection consistency (run multiple times)
test('Detection Consistency', () => {
  const results = [];
  for (let i = 0; i < 5; i++) {
    const info = detectArchitecture();
    results.push(`${info.platform}-${info.arch}`);
  }
  return results.every(r => r === results[0]);
});

// Test 6: File generation works
test('File Generation', () => {
  try {
    runCommand(npmCommand, ['run', 'docker:detect'], {
      stdio: 'ignore',
      env: { ...process.env, TESTING_MODE: 'true' }
    });
    return true;
  } catch {
    return false;
  }
});

// Test 7: Generated Docker Compose is valid
test('Docker Compose Validation', () => {
  try {
    ensureDockerComposeConfig();
    runCommand('docker-compose', ['-f', 'test/docker/docker-compose.yml', 'config'], {
      stdio: 'ignore'
    });
    return true;
  } catch {
    return false;
  }
});

// Test 8: Container can start (quick test)
test('Container Startup Test', () => {
  try {
    ensureDockerComposeConfig();

    // Start container
    runCommand('docker-compose', ['-f', 'test/docker/docker-compose.yml', 'up', '-d'], {
      stdio: 'ignore'
    });

    // Check if it's running
    const output = runCommand('docker', [
      'ps',
      '--filter',
      'name=warp-mcp-sqlserver',
      '--format',
      '{{.Names}}'
    ]);
    const isRunning = output.includes('warp-mcp-sqlserver');

    // Clean up immediately
    try {
      runCommand('docker-compose', ['-f', 'test/docker/docker-compose.yml', 'down'], {
        stdio: 'ignore'
      });
    } catch {
      // Ignore cleanup errors
    }

    return isRunning;
  } catch {
    return false;
  }
});

// Results
console.log('\n📊 Results');
console.log('===========');
console.log(`✅ Passed: ${passed}/${total}`);
console.log(`❌ Failed: ${total - passed}/${total}`);

const successRate = Math.round((passed / total) * 100);
console.log(`📈 Success Rate: ${successRate}%\n`);

if (successRate >= 90) {
  console.log('🎉 EXCELLENT - Platform detection is working perfectly!');
} else if (successRate >= 75) {
  console.log('✅ GOOD - Platform detection is working well with minor issues.');
} else if (successRate >= 50) {
  console.log('⚠️  WARNING - Platform detection has some issues that need attention.');
} else {
  console.log('❌ CRITICAL - Platform detection has major issues. Check your environment.');
}

// Developer recommendations
console.log('\n💡 Developer Tips:');

const hostInfo = detectArchitecture();
const dockerInfo = checkDockerCapabilities();

if (hostInfo.isAppleSilicon) {
  console.log('🍎 Apple Silicon detected:');
  if (dockerInfo.supportsAMD64) {
    console.log('  ✅ Rosetta 2 emulation is working - optimal configuration selected');
  } else {
    console.log('  ⚠️  AMD64 emulation may have issues - consider Docker settings');
  }
}

if (!dockerInfo.hasDocker) {
  console.log('🐳 Docker not available:');
  console.log('  📥 Install Docker Desktop: https://docs.docker.com/get-docker/');
}

console.log('  🧪 Run full stress test: npm run docker:stress-test');
console.log('  📖 View configuration: cat test/docker/.platform-config.json');

process.exit(total - passed); // Exit with number of failures
