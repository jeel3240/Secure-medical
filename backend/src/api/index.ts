import '../config';
import express from 'express';

const app = express();
const port = process.env.PORT || 3000;

app.get('/', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(port, () => {
  console.log(`api listening on port ${port}`);
});
