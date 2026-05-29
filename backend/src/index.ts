import cors from 'cors';
import express from 'express';
import { readEnv } from './env.js';
import { createRoutes } from './routes.js';

const env = readEnv();
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(createRoutes(env));

app.use((_request, response) => {
  response.status(404).json({
    error: 'not_found',
  });
});

app.listen(env.port, () => {
  console.log(`Cadencia backend escuchando en http://localhost:${env.port}`);
});
