import '../config';
import express from 'express';
import { webhooksRouter } from './webhooks';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/webhooks', webhooksRouter);

app.listen(port, () => {
  console.log(`api listening on port ${port}`);
});
