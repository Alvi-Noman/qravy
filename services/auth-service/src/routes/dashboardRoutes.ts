import { Router, Request, Response } from 'express';
import { requireOnboardedUser } from '../middleware/requireOnboardedUser.js';
import { client } from '../db.js';
import { ObjectId } from 'mongodb';
import { z } from 'zod';

const router: Router = Router();

// GET: Fetch menu items for the logged-in user's restaurant
router.get('/dashboard', requireOnboardedUser, async (req: Request, res: Response) => {
  const db = client.db('authDB');
  const restaurantId = req.restaurantId;
  if (!restaurantId) {
    return res.status(400).json({ message: 'No restaurant linked to user.' });
  }
  const menuItems = await db
    .collection('menuitems')
    .find({ restaurant: new ObjectId(restaurantId) })
    .toArray();
  res.json({ menu: menuItems });
});

// POST: Add a new menu item for the logged-in user's restaurant
const menuItemSchema = z.object({
  name: z.string().min(1, "Name is required"),
  price: z.number().min(0, "Price must be positive"),
});

router.post('/dashboard/menu', requireOnboardedUser, async (req: Request, res: Response) => {
  const db = client.db('authDB');
  const restaurantId = req.restaurantId;
  const parsed = menuItemSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Validation failed', errors: parsed.error.issues });
  }
  const { name, price } = parsed.data;
  const result = await db.collection('menuitems').insertOne({
    name,
    price,
    restaurant: new ObjectId(restaurantId),
  });
  res.status(201).json({ _id: result.insertedId, name, price, restaurant: restaurantId });
});

export default router;