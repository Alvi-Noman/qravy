// services/auth-service/scripts/seed-burger-house.mongosh.js
// Demo restaurant for local development: "Burger House" at /t/burger-house — owner, categories and a full menu
// (prices in BDT, sizes, add-ons, photos). Safe to re-run: it removes the previous Burger House demo first and
// touches nothing else.
//
//   docker cp services/auth-service/scripts/seed-burger-house.mongosh.js qravy-mongo-1:/tmp/seed.js
//   docker exec qravy-mongo-1 mongosh --quiet authDB /tmp/seed.js

const SUB = 'burger-house';
const OWNER_EMAIL = 'owner@burgerhouse.demo';
const now = new Date();
const img = (id) => `https://images.unsplash.com/photo-${id}?w=800&q=80&auto=format&fit=crop`;

/* ---------- clear the previous demo (only Burger House) ---------- */
const old = db.tenants.findOne({ subdomain: SUB });
if (old) {
  for (const c of ['menuItems', 'categories', 'locations', 'itemAvailability', 'categoryVisibility', 'memberships', 'orders']) {
    db[c].deleteMany({ tenantId: old._id });
  }
  db.tenants.deleteOne({ _id: old._id });
}
db.users.deleteMany({ email: OWNER_EMAIL });

/* ---------- owner + restaurant ---------- */
const ownerId = new ObjectId();
const tenantId = new ObjectId();

db.users.insertOne({
  _id: ownerId,
  email: OWNER_EMAIL,
  isVerified: true,
  isOnboarded: true,
  tenantId,
  createdAt: now,
  updatedAt: now,
});

db.tenants.insertOne({
  _id: tenantId,
  name: 'Burger House',
  subdomain: SUB,
  ownerId,
  onboardingCompleted: true,
  waiterLanguage: 'bn',
  timezone: 'Asia/Dhaka',
  openingHours: [], // always open (demo)
  menuNotes: ['All prices include VAT', 'All our meat is 100% halal'],
  waiterKnowledge: [
    'Wi-Fi: BurgerHouse_Guest, password burger2024',
    'We accept cash, bKash, Nagad and cards',
    'All meat is 100% halal',
    'Free parking in front of the restaurant',
    'Every burger can be made spicy on request',
  ],
  kitchen: { defaultPrepMinutes: 12, parallelOrders: 4 },
  tables: Array.from({ length: 12 }, (_, i) => String(i + 1)),
  ownerInfo: { fullName: 'Burger House Owner', phone: '+8801700000000' },
  restaurantInfo: {
    restaurantType: 'Fast food',
    country: 'Bangladesh',
    address: 'House 12, Road 11, Banani, Dhaka 1213',
    phone: '+8801700000000',
    locationMode: 'single',
    hasLocations: false,
    dineInEnabled: true,
    onlineSalesEnabled: true,
  },
  onboardingProgress: { hasCategory: true, hasMenuItem: true, hasLocations: false },
  subscriptionStatus: 'active',
  createdAt: now,
  updatedAt: now,
});

db.memberships.insertOne({
  tenantId,
  userId: ownerId,
  role: 'owner',
  status: 'active',
  createdAt: now,
  updatedAt: now,
});

/* ---------- categories ---------- */
const CATS = [
  { key: 'burgers', name: 'Burgers', description: 'Fresh beef patties, smashed on the grill' },
  { key: 'chicken', name: 'Chicken', description: 'Crispy, juicy, and made to order' },
  { key: 'sides', name: 'Sides', description: 'Perfect with any burger' },
  { key: 'drinks', name: 'Shakes & Drinks', description: '' },
  { key: 'desserts', name: 'Desserts', description: '' },
];
const catId = {};
CATS.forEach((c, i) => {
  catId[c.key] = new ObjectId();
  db.categories.insertOne({
    _id: catId[c.key],
    tenantId,
    createdBy: ownerId,
    scope: 'all',
    locationId: null,
    channelScope: 'all',
    name: c.name,
    description: c.description,
    sortOrder: i,
    createdAt: now,
    updatedAt: now,
  });
});

/* ---------- shared add-ons ---------- */
const burgerExtras = {
  id: 'extras',
  name: 'Extra toppings',
  min: 0,
  max: 4,
  options: [
    { id: 'cheese', name: 'Extra cheese', price: 40 },
    { id: 'bacon', name: 'Beef bacon', price: 80 },
    { id: 'egg', name: 'Fried egg', price: 30 },
    { id: 'jalapeno', name: 'Jalapeños', price: 20 },
  ],
};
const makeItAMeal = {
  id: 'meal',
  name: 'Make it a meal',
  min: 0,
  max: 1,
  options: [{ id: 'meal', name: 'Fries + soft drink', price: 150 }],
};
const spiceLevel = {
  id: 'spice',
  name: 'Spice level',
  min: 1,
  max: 1,
  options: [
    { id: 'regular', name: 'Regular', price: 0 },
    { id: 'spicy', name: 'Spicy', price: 0 },
    { id: 'extra-hot', name: 'Extra hot', price: 0 },
  ],
};
const dips = {
  id: 'dips',
  name: 'Dips',
  min: 0,
  max: 2,
  options: [
    { id: 'garlic', name: 'Garlic mayo', price: 30 },
    { id: 'bbq', name: 'BBQ sauce', price: 30 },
    { id: 'cheese', name: 'Cheese sauce', price: 40 },
  ],
};

/* ---------- menu ---------- */
const ITEMS = [
  // Burgers
  { cat: 'burgers', name: 'Classic Smash Burger', price: 390, photo: '1568901346375-23c9450c58cd', prep: 10,
    description: 'Two smashed beef patties, cheddar, pickles, onion and our house sauce in a toasted brioche bun.',
    tags: ['beef', 'bestseller'], groups: [burgerExtras, makeItAMeal] },
  { cat: 'burgers', name: 'Triple Cheese Tower', price: 590, photo: '1572802419224-296b0aeee0d9', prep: 14, signature: true,
    description: 'Three beef patties, three slices of cheddar, caramelised onion and smoky mayo. Our signature.',
    tags: ['beef', 'signature'], groups: [burgerExtras, makeItAMeal] },
  { cat: 'burgers', name: 'Beef Bacon Stack', price: 520, photo: '1553979459-d2229ba7433b', prep: 13,
    description: 'Double beef patty, crispy beef bacon, American cheese and BBQ sauce.',
    tags: ['beef'], groups: [burgerExtras, makeItAMeal] },
  { cat: 'burgers', name: 'Mini Slider Trio', price: 450, photo: '1550547660-d9450f859349', prep: 12,
    description: 'Three mini beef sliders with cheese, lettuce and burger sauce — great for sharing.',
    tags: ['beef', 'sharing'], groups: [burgerExtras] },
  { cat: 'burgers', name: 'Burger & Fries Combo', price: 490, photo: '1594212699903-ec8a3eca50f5', prep: 12,
    description: 'Our classic beef burger with lettuce, tomato and onion, served with a portion of fries.',
    tags: ['beef', 'combo'], groups: [burgerExtras] },

  // Chicken
  { cat: 'chicken', name: 'Crispy Chicken Burger', price: 360, photo: '1606755962773-d324e0a13086', prep: 11,
    description: 'Crispy fried chicken thigh, spicy mayo, slaw and spring onion in a brioche bun.',
    tags: ['chicken'], groups: [spiceLevel, burgerExtras, makeItAMeal] },
  { cat: 'chicken', name: 'Hot Wings', price: 320, photo: '1567620832903-9fc6debc209f', prep: 12, signature: true,
    description: 'Glazed buffalo wings with a cool ranch dip.',
    tags: ['chicken', 'spicy'], groups: [spiceLevel],
    variations: [{ name: '6 pcs', price: 320 }, { name: '10 pcs', price: 490 }] },
  { cat: 'chicken', name: 'Fried Chicken', price: 280, photo: '1626082927389-6cd097cdc6ec', prep: 14,
    description: 'Southern-style crispy fried chicken, marinated overnight.',
    tags: ['chicken'], groups: [spiceLevel, dips],
    variations: [{ name: '2 pcs', price: 280 }, { name: '4 pcs', price: 520 }] },
  { cat: 'chicken', name: 'Chicken Tenders', price: 300, photo: '1562967914-608f82629710', prep: 10,
    description: 'Golden chicken tenders with garlic mayo.',
    tags: ['chicken', 'kids'], groups: [dips] },

  // Sides
  { cat: 'sides', name: 'Classic Fries', price: 150, photo: '1630384060421-cb20d0e0649d', prep: 6,
    description: 'Crispy salted fries.', tags: ['vegetarian'], groups: [dips],
    variations: [{ name: 'Regular', price: 150 }, { name: 'Large', price: 210 }] },
  { cat: 'sides', name: 'Peri Peri Fries', price: 190, photo: '1541592106381-b31e9677c0e5', prep: 6,
    description: 'Fries tossed in our spicy peri peri seasoning.', tags: ['vegetarian', 'spicy'], groups: [dips],
    variations: [{ name: 'Regular', price: 190 }, { name: 'Large', price: 250 }] },
  { cat: 'sides', name: 'Parmesan Garlic Fries', price: 240, photo: '1573080496219-bb080dd4f877', prep: 7,
    description: 'Fries with parmesan, garlic butter and parsley.', tags: ['vegetarian'], groups: [dips] },
  { cat: 'sides', name: 'Onion Rings', price: 200, photo: '1639024471283-03518883512d', prep: 7,
    description: 'Beer-battered onion rings (alcohol-free batter).', tags: ['vegetarian'], groups: [dips] },

  // Shakes & Drinks
  { cat: 'drinks', name: 'Oreo Milkshake', price: 260, photo: '1572490122747-3968b75cc699', prep: 4,
    description: 'Thick vanilla shake blended with Oreo cookies and topped with cream.', tags: ['vegetarian'],
    variations: [{ name: 'Regular', price: 260 }, { name: 'Large', price: 320 }] },
  { cat: 'drinks', name: 'Mint Lemonade', price: 160, photo: '1621263764928-df1444c5e859', prep: 3,
    description: 'Fresh lemon, mint and a little sugar, over ice.', tags: ['vegetarian'] },
  { cat: 'drinks', name: 'Coca-Cola', price: 80, photo: '1622483767028-3f66f32aef97', prep: 1,
    description: 'Chilled 250 ml can.', tags: ['vegetarian'] },

  // Desserts
  { cat: 'desserts', name: 'Chocolate Brownie', price: 220, photo: '1606313564200-e75d5e30476c', prep: 3,
    description: 'Warm fudgy brownie with chocolate sauce.', tags: ['vegetarian'] },
  { cat: 'desserts', name: 'Oreo Brownie Sundae', price: 280, photo: '1563805042-7684c019e1cb', prep: 4,
    description: 'Vanilla ice cream, brownie chunks, Oreo crumbs and hot fudge.', tags: ['vegetarian'] },
];

const sortInCat = {};
const docs = ITEMS.map((it) => {
  sortInCat[it.cat] = (sortInCat[it.cat] ?? -1) + 1;
  const doc = {
    tenantId,
    createdBy: ownerId,
    updatedBy: ownerId,
    scope: 'all',
    locationId: null,
    visibility: { dineIn: true, online: true },
    name: it.name,
    price: it.price,
    description: it.description,
    category: CATS.find((c) => c.key === it.cat).name,
    categoryId: catId[it.cat],
    media: [img(it.photo)],
    tags: it.tags,
    sortOrder: sortInCat[it.cat],
    prepMinutes: it.prep,
    prepSource: 'owner',
    hidden: false,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  if (it.signature) doc.signature = true;
  if (it.groups) doc.modifierGroups = it.groups;
  if (it.variations) doc.variations = it.variations;
  return doc;
});
db.menuItems.insertMany(docs);

print(`Burger House seeded: tenant ${tenantId}, ${CATS.length} categories, ${docs.length} menu items.`);
print(`Open http://localhost:3007/t/${SUB}`);
