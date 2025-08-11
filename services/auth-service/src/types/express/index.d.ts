import { ObjectId } from 'mongodb';

declare global {
  namespace Express {
    interface Request {
      restaurantId?: ObjectId | string;
      user?: any;
    }
  }
}