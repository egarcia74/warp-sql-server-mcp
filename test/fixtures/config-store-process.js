import { readConfigSnapshot, saveConfigSnapshot } from '../../lib/config/config-store.js';
const snapshot = await readConfigSnapshot(process.argv[2]);
process.send('ready');
process.once('message', async values => {
  try {
    const r = await saveConfigSnapshot(snapshot, values);
    process.send({ committed: r.committed });
  } catch (e) {
    process.send({ code: e.code });
  }
  process.disconnect();
});
