import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Db, Collection } from 'mongodb';
import { config } from 'dotenv';
import { client } from '../server.js';
config();

let db: Db | null = null;

async function getUsersCollection(): Promise<Collection> {
  if (!db) {
    db = client.db('authDB');
  }
  if (!db) throw new Error('Database not initialized');
  return db.collection('users');
}

export const signup = async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const collection = await getUsersCollection();

    const existingUser = await collection.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = { email, password: hashedPassword, name };
    const result = await collection.insertOne(newUser);

    const token = jwt.sign(
      { id: result.insertedId.toString(), email },
      process.env.JWT_SECRET!,
      { expiresIn: '1h' }
    );
    res.status(201).json({ token, user: { id: result.insertedId.toString(), email, name } });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error instanceof Error ? error.message : error });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const collection = await getUsersCollection();

    const user = await collection.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user._id!.toString(), email },
      process.env.JWT_SECRET!,
      { expiresIn: '1h' }
    );
    res.status(200).json({ token, user: { id: user._id!.toString(), email, name: user.name } });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error instanceof Error ? error.message : error });
  }
};