import app from './app.js';
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';
config();

export const client = new MongoClient(process.env.MONGODB_URI!);

const PORT = process.env.PORT || 3001;

async function startServer() {
  try {
    await client.connect();
    app.listen(PORT, () => {
      // Server started
    });
  } catch (err) {
    process.exit(1);
  }
}

startServer();