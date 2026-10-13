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

  /** In the branch's links: <restaurant>.qravy.com/<slug> (utils/branches). Set once, never changed. */
  slug?: string;
  /** The branch's dine-in tables and each one's secret QR key (utils/tableKeys) */
  tables?: string[];
  tableKeys?: Record<string, string>;

  /** Branch opening hours; missing = same as the restaurant */
  openingHours?: Array<{ days: number[]; start: string; end: string }>;

  createdAt: Date;
  updatedAt: Date;
}