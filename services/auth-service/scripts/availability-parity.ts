// services/auth-service/scripts/availability-parity.ts
// "Can this dish be ordered now?" is decided twice: here (the menu page and checkout — routes/publicRoutes.ts
// publicMenuItems → utils/orderability.ts) and in the AI waiter (ai-waiter-service availability.py). When they
// disagree, the waiter says "available" while the menu says no (or the other way round). This check seeds a test
// restaurant with every kind of rule — service periods, a section's own hours, past midnight, a branch's own hours
// and section hours, branch-only sections, sold out, a dish's hours and dates, dine-in / online, hidden — and writes
// this side's answer for every dish, every 30 minutes over two days, per branch and channel.
//
//   MONGODB_URI=mongodb://localhost:27017 npx tsx scripts/availability-parity.ts seed   > ts.json
//   (ai-waiter-service) python scripts/availability_parity.py < ts.json                  → the differences
//   MONGODB_URI=mongodb://localhost:27017 npx tsx scripts/availability-parity.ts clean
import { ObjectId } from 'mongodb';
import { client } from '../src/db.js';
import { publicMenuItems } from '../src/routes/publicRoutes.js';

const SUB = 'parity-test';
const ALL = [0, 1, 2, 3, 4, 5, 6];
const w = (start: string, end: string, days = ALL) => [{ days, start, end }];
const stamp = { createdAt: new Date(), updatedAt: new Date() }; // (the collections require them)

async function clean() {
  const db = client.db('authDB');
  const t = await db.collection('tenants').findOne({ subdomain: SUB });
  if (!t) return;
  for (const c of ['menuItems', 'categories', 'locations', 'itemAvailability', 'categoryVisibility']) {
    await db.collection(c).deleteMany({ tenantId: t._id });
  }
  await db.collection('tenants').deleteOne({ _id: t._id });
}

async function seed() {
  await clean();
  const db = client.db('authDB');
  const T = new ObjectId();
  await db.collection('tenants').insertOne({
    _id: T, subdomain: SUB, name: 'Parity Test', timezone: 'Asia/Dhaka',
    openingHours: w('08:00', '23:30'),
    servicePeriods: [
      { id: 'breakfast', name: 'Breakfast', days: ALL, start: '07:00', end: '11:00' },
      { id: 'lunch', name: 'Lunch', days: ALL, start: '12:00', end: '15:00' },
      { id: 'evening', name: 'Evening', days: ALL, start: '17:00', end: '22:00' },
      { id: 'late', name: 'Late night', days: ALL, start: '22:00', end: '02:00' },
    ],
    ownerId: new ObjectId(), onboardingCompleted: true, ...stamp,
  });
  const L1 = new ObjectId(); // a branch with its own (shorter) hours, and its own lunch hours
  const L2 = new ObjectId(); // a branch with the restaurant's hours and its own section
  await db.collection('locations').insertMany([
    { _id: L1, tenantId: T, name: 'Dhanmondi', slug: 'dhanmondi', openingHours: w('10:00', '22:00'), ...stamp },
    { _id: L2, tenantId: T, name: 'Gulshan', slug: 'gulshan', ...stamp },
  ]);
  const cat = (name: string, extra: Record<string, unknown> = {}) => ({ _id: new ObjectId(), tenantId: T, name, ...stamp, ...extra });
  const C = {
    breakfast: cat('Breakfast', { servicePeriodIds: ['breakfast'] }),
    dinner: cat('Dinner', { availability: w('17:00', '22:00') }),
    allday: cat('All day'),
    lunch: cat('Lunch', { servicePeriodIds: ['lunch'], branchAvailability: [{ locationId: L1, availability: w('13:00', '16:00') }] }),
    late: cat('Late', { servicePeriodIds: ['late'] }),
    gulshanOnly: cat('Gulshan special', { scope: 'location', locationId: L2 }),
    weekend: cat('Weekend brunch', { availability: w('09:00', '13:00', [5, 6]) }),
  };
  await db.collection('categories').insertMany(Object.values(C));
  const item = (name: string, c: { _id: ObjectId }, extra: Record<string, unknown> = {}) => ({
    _id: new ObjectId(), tenantId: T, name, price: 100, categoryId: c._id, status: 'active', hidden: false,
    visibility: { dineIn: true, online: true }, ...stamp, ...extra,
  });
  const I = [
    item('Paratha', C.breakfast),
    item('Nehari', C.breakfast, { availability: w('07:00', '09:30') }), // its own hours inside the section's
    item('Kebab', C.dinner),
    item('Grill', C.dinner, { offline: true }), // switched off restaurant-wide
    item('Rice', C.allday),
    item('Coke', C.allday, { visibility: { dineIn: true, online: false } }), // dine-in only
    item('Tea', C.allday, { servicePeriodIds: ['breakfast', 'evening'] }), // a dish's own periods
    item('Thali', C.lunch),
    item('Biryani', C.lunch, { availableFrom: '2026-10-27' }), // from Tuesday
    item('Soup', C.late),
    item('Shawarma', C.gulshanOnly),
    item('Pancake', C.weekend),
    item('Status-hidden dish', C.allday, { status: 'hidden' }), // (the admin's "hide" status)
    item('Hidden dish', C.allday, { hidden: true }),
    item('Dhanmondi own', C.allday, { locationId: L1 }), // a branch's own dish
  ];
  await db.collection('menuItems').insertMany(I);
  const byName = (n: string) => I.find((x) => x.name === n)!._id;
  await db.collection('itemAvailability').insertMany([
    { tenantId: T, itemId: byName('Rice'), locationId: L1, channel: 'dine-in', available: false, ...stamp }, // sold out there
    { tenantId: T, itemId: byName('Kebab'), locationId: L2, channel: 'online', removed: true, ...stamp }, // off its online menu
  ]);
  await db.collection('categoryVisibility').insertMany([
    { tenantId: T, categoryId: C.dinner._id, locationId: L1, channel: 'online', visible: false, ...stamp },
  ]);

  // this side's answer: the menu page's / checkout's, for every dish at every time
  const tenant = (await db.collection('tenants').findOne({ _id: T })) as any;
  const out: any[] = [];
  const start = Date.UTC(2026, 9, 25, 18, 0); // Monday 26 Oct 2026, 00:00 in Dhaka (UTC+6)
  for (const [branch, locId] of [['dhanmondi', L1], ['gulshan', L2]] as const) {
    for (const channel of ['dine-in', 'online'] as const) {
      for (let k = 0; k < 96; k++) {
        const at = new Date(start + k * 30 * 60_000);
        const items = await publicMenuItems(tenant, locId, channel, at);
        const on = new Map(items.map((o) => [String(o.id), o]));
        for (const it of I) {
          const o = on.get(String(it._id));
          out.push({
            branch, channel, at: at.toISOString(), item: it.name, id: String(it._id),
            orderable: !!o && !o.hidden && o.orderable === true,
            why: o ? (o.hidden ? 'hidden' : o.unavailable?.reason ?? null) : 'not on the menu',
          });
        }
      }
    }
  }
  process.stdout.write(JSON.stringify({ subdomain: SUB, rows: out }));
}

const cmd = process.argv[2];
(cmd === 'clean' ? clean() : seed())
  .then(() => client.close())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
