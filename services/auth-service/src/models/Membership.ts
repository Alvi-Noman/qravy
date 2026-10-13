import { ObjectId } from 'mongodb';

export type MembershipRole = 'owner' | 'admin' | 'editor' | 'viewer';
export type MembershipStatus = 'active' | 'invited';

export interface MembershipDoc {
  _id?: ObjectId;
  tenantId: ObjectId;
  userId?: ObjectId | null; 
  email: string;            
  role: MembershipRole;
  status: MembershipStatus;
  /** Staff limited to one branch (Settings → Team, "<branch> only"): they see and run that branch only */
  locationId?: ObjectId | null;
  inviteTokenHash?: string; 
  inviteExpiresAt?: Date;  
  createdAt: Date;
  updatedAt: Date;
}
