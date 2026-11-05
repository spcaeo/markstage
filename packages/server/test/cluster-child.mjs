// One real server process for the two-process tests (multi-process.test.mjs, two-process.mjs): the server's own code
// on the fixture's data dir, with the tests' stand-ins (the stub core, the fake codec), listening on 127.0.0.1 at
// the port it is given. `seed`: test users to create first (only the first process is given any). SIGTERM stops it
// cleanly; SIGKILL is a crash. It prints "ready <process id> <primary|secondary>" once it answers.
//   node test/cluster-child.mjs <dataDir> <port> [seed JSON]
import { createMarkstage, loadConfig } from '../src/app.mjs';
import { addUser, fakeCodec } from './helpers.mjs';
import * as stubCore from './stub-core.mjs';

const [dataDir, port, seed] = process.argv.slice(2);
const config = loadConfig({ env: { MARKSTAGE_DATA_DIR: dataDir, NODE_ENV: 'test' }, overrides: { port: Number(port), host: '127.0.0.1' } });
// the browser tests edit with the real converter (MARKSTAGE_TEST_REAL_CORE=1); the others use the stub
const app = await createMarkstage(config, { codec: fakeCodec, ...(process.env.MARKSTAGE_TEST_REAL_CORE ? {} : { core: stubCore }) });
for (const u of seed ? JSON.parse(seed) : []) await addUser(app, u);
await app.listen(Number(port), '127.0.0.1');
process.stdout.write(`ready ${app.cluster.id} ${app.cluster.holds('primary') ? 'primary' : 'secondary'}\n`);

let stopping = false;
process.on('SIGTERM', async () => {
  if (stopping) return;
  stopping = true;
  await app.close();
  process.exit(0);
});
