import { readFileSync } from 'node:fs';

const reportPath = process.argv[2] ?? 'coverage/lcov.info';

try {
  const report = readFileSync(reportPath, 'utf8');
  const completeRecords = report.split(/^end_of_record\r?$/m).slice(0, -1);
  const hasCoverage = completeRecords.some(
    record => /^SF:[^\r\n]+$/m.test(record) && /^DA:\d+,\d+(?:,[^\r\n]+)?$/m.test(record)
  );
  if (!hasCoverage) {
    throw new Error('no source-file coverage records');
  }
  console.log(`LCOV report verified: ${reportPath}`);
} catch (error) {
  console.error(`LCOV report missing or invalid at ${reportPath}: ${error.message}`);
  process.exitCode = 1;
}
