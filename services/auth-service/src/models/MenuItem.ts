import { ObjectId } from 'mongodb';

export interface MenuItem {
  _id?: ObjectId;
  name: string;
  price: number;
  restaurant: ObjectId; // Restaurant._id
}

export default MenuItem;