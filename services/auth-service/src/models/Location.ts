import { ObjectId } from 'mongodb';

export interface LocationDoc {
  _id?: ObjectId;
  tenantId: ObjectId;
  createdBy?: ObjectId;

  name: string;
  address?: string;
  zip?: string;
  country?: string;
  disabled?: boolean;

  /** Branch opening hours; missing = same as the restaurant */
  openingHours?: Array<{ days: number[]; start: string; end: string }>;

  createdAt: Date;
  updatedAt: Date;
}