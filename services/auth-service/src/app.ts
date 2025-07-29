import express, { Application } from 'express';
import cors from 'cors';
import authRoutes from './routes/authRoutes.js';

const app: Application = express();

app.use(cors({
  origin: 'http://localhost:5173',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use('/api/auth', authRoutes);

export default app;