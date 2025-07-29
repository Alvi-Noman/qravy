import { ObjectId } from 'mongodb';

     interface User {
       _id?: ObjectId;
       email: string;
       password: string;
       name: string;
     }

     export default User;