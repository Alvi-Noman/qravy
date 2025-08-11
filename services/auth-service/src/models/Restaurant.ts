import { ObjectId } from 'mongodb';

export interface Restaurant {
  _id?: ObjectId;
  name: string;
  location: string;
  owner: ObjectId; // User._id
}

export default Restaurant;