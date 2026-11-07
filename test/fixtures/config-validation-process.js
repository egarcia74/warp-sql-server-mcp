const good = {
  version: 1,
  status: 'success',
  category: 'ok',
  stage: 'finished',
  elapsedMs: 1,
  attempts: 1,
  cleanup: 'complete'
};
process.on('message', message => {
  if (message.type !== 'start') return;
  if (process.argv[2] === 'good') {
    process.stdout.write(process.env.SQL_SERVER_PASSWORD || '');
    process.stderr.write(process.env.SQL_SERVER_PASSWORD || '');
    process.send(good, () => process.disconnect());
  } else if (process.argv[2] === 'invalid') {
    process.send({ ...good, secret: process.env.SQL_SERVER_PASSWORD }, () => process.disconnect());
  } else if (process.argv[2] === 'crash') process.exit(1);
  else if (process.argv[2] === 'disconnect') {
    process.disconnect();
    setInterval(() => {}, 1000);
  } else {
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1000);
  }
});
