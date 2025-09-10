import { ObjectId } from 'mongodb';

export type MembershipRole = 'owner' | 'admin' | 'editor' | 'viewer';
export type MembershipStatus = 'active' | 'invited';

export interface MembershipDoc {
  _id?: ObjectId;
  tenantId: ObjectId;
  userId: ObjectId;
  role: MembershipRole;
  status: MembershipStatus;
  createdAt: Date;
  updatedAt: Date;
}