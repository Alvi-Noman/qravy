import app from './app.js';
import { config } from 'dotenv';

config();

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`API Gateway running on port ${PORT}`);
}).on('error', (err) => {
  console.error('API Gateway failed to start:', err.message);
  process.exit(1);
});