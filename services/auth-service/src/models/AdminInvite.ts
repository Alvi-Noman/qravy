import { ObjectId } from 'mongodb';

export type AdminInvite = {
  _id?: ObjectId;
  tenantId: ObjectId;
  email: string;                 
  tokenHash: string;             // sha256(inviteToken)
  expiresAt: Date;
  status: 'pending' | 'accepted' | 'revoked';
  createdAt: Date;
  updatedAt: Date;
};
