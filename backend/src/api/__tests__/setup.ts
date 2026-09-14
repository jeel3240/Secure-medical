import { closeServers } from './helpers';

afterEach(async () => {
  await closeServers();
});
