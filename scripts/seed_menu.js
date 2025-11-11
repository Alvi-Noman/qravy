// scripts/seed_menu.js
// Run from mongosh (already connected to your Atlas cluster):
// load("E:/React Projects/qravy/scripts/seed_menu.js")

// ====== Tenant/User (yours) ======
const TENANT_ID = ObjectId("68f06e0c34826cc951621144");
const USER_ID   = ObjectId("68f0068bb0d470d481869bb8");

// ====== DB / Collections ======
const DB_NAME = "authDB";
const CATEGORIES = "categories";
const MENU_ITEMS = "menuItems";
const dbx = db.getSiblingDB(DB_NAME);

// Wipe previous seed for this tenant?
const WIPE_BEFORE_SEED = true;

const now = new Date();

// ---- Category names (8) ----
const categoryNames = [
  "Burgers",
  "Pizzas",
  "Pastas",
  "Sandwiches",
  "Salads",
  "Appetizers",
  "Drinks",
  "Desserts"
];

// ---- Realistic menu plan (not evenly distributed; totals 60) ----
// Burgers: 8
// Pizzas: 10
// Pastas: 6
// Sandwiches: 7
// Salads: 5
// Appetizers: 9
// Drinks: 10
// Desserts: 5

// ============ ITEM LISTS ============
// Only name & base price here; variations, tags, media are added below per category.

const BURGERS = [
  { name: "Classic Beef Burger", price: 180 },
  { name: "Cheese Burst Burger", price: 200 },
  { name: "Smoky BBQ Burger", price: 220 },
  { name: "Spicy Jalapeño Burger", price: 210 },
  { name: "Crispy Chicken Burger", price: 190 },
  { name: "Double Patty Monster", price: 280 },
  { name: "Mushroom Swiss Burger", price: 230 },
  { name: "Veggie Deluxe Burger", price: 170 },
];

const PIZZAS = [
  { name: "Margherita Pizza", price: 350 },
  { name: "Pepperoni Pizza", price: 420 },
  { name: "BBQ Chicken Pizza", price: 450 },
  { name: "Tandoori Chicken Pizza", price: 460 },
  { name: "Four Cheese Pizza", price: 480 },
  { name: "Veggie Supreme Pizza", price: 380 },
  { name: "Beef Lover’s Pizza", price: 470 },
  { name: "Hawaiian Pizza", price: 420 },
  { name: "Chicken Fajita Pizza", price: 440 },
  { name: "Spicy Sausage Pizza", price: 460 },
];

const PASTAS = [
  { name: "Spaghetti Aglio e Olio", price: 280 },
  { name: "Fettuccine Alfredo", price: 330 },
  { name: "Penne Arrabbiata", price: 300 },
  { name: "Spaghetti Bolognese", price: 360 },
  { name: "Chicken Pesto Pasta", price: 370 },
  { name: "Creamy Mushroom Pasta", price: 340 },
];

const SANDWICHES = [
  { name: "Club Sandwich", price: 240 },
  { name: "Grilled Chicken Sandwich", price: 250 },
  { name: "Tuna Melt Sandwich", price: 260 },
  { name: "Philly Steak Sandwich", price: 320 },
  { name: "Veggie Hummus Sandwich", price: 210 },
  { name: "Egg Mayo Sandwich", price: 190 },
  { name: "BBQ Pulled Chicken Sandwich", price: 300 },
];

const SALADS = [
  { name: "Caesar Salad", price: 240 },
  { name: "Greek Salad", price: 230 },
  { name: "Chicken Garden Salad", price: 280 },
  { name: "Quinoa Power Salad", price: 300 },
  { name: "Fresh Fruit Salad", price: 220 },
];

const APPETIZERS = [
  { name: "French Fries", price: 120 },
  { name: "Cheesy Fries", price: 160 },
  { name: "Chicken Wings (6 pcs)", price: 260 },
  { name: "Crispy Calamari", price: 320 },
  { name: "Garlic Bread", price: 140 },
  { name: "Mozzarella Sticks", price: 220 },
  { name: "Nachos Supreme", price: 280 },
  { name: "Dynamite Shrimp", price: 360 },
  { name: "Onion Rings", price: 150 },
];

const DRINKS = [
  { name: "Coke", price: 60 },
  { name: "Sprite", price: 60 },
  { name: "Fanta", price: 60 },
  { name: "Iced Lemon Tea", price: 100 },
  { name: "Mint Lemonade", price: 120 },
  { name: "Mango Smoothie", price: 180 },
  { name: "Strawberry Milkshake", price: 200 },
  { name: "Chocolate Milkshake", price: 200 },
  { name: "Cold Coffee", price: 160 },
  { name: "Bottled Water", price: 30 },
];

const DESSERTS = [
  { name: "Chocolate Lava Cake", price: 220 },
  { name: "New York Cheesecake", price: 260 },
  { name: "Brownie with Ice Cream", price: 240 },
  { name: "Tiramisu Cup", price: 250 },
  { name: "Caramel Pudding", price: 180 },
];

// ============ HELPERS ============

const TAGS_POOL = ["spicy", "mild", "veg", "halal", "gluten-free", "cheesy", "best-seller", "new", "kids", "keto", "low-cal", "signature"];

function pickTags(max = 3) {
  const n = Math.floor(Math.random() * (max + 1)); // 0..max
  const shuffled = TAGS_POOL.slice().sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function pickMediaMaybe(i) {
  // ~60% of items get a photo
  if (i % 5 === 0 || i % 6 === 0) return [];
  return [`https://picsum.photos/seed/qravy_${i}/640/480`];
}

function variationsFor(category /*, idx */) {
  switch (category) {
    case "Pizzas":
      return [
        { name: 'Small 8"',  price: 0 },
        { name: 'Medium 10"', price: 120 },
        { name: 'Large 12"',  price: 240 },
      ];
    case "Burgers":
      return [
        { name: "Single Patty",  price: 0 },
        { name: "Cheese Add-on", price: 30 },
        { name: "Double Patty",  price: 80 },
      ];
    case "Sandwiches":
      return [
        { name: "White Bread",  price: 0 },
        { name: "Brown Bread",  price: 10 },
        { name: "Extra Cheese", price: 20 },
      ];
    case "Drinks":
      return [
        { name: "Regular", price: 0 },
        { name: "Large",   price: 20 },
        { name: "No Ice",  price: 0 },
      ];
    case "Salads":
      return [
        { name: "No Dressing",    price: 0 },
        { name: "Light Dressing",  price: 0 },
        { name: "Extra Dressing",  price: 15 },
      ];
    case "Pastas":
      return [
        { name: "Regular",        price: 0 },
        { name: "Extra Parmesan", price: 30 },
      ];
    case "Appetizers":
      // sometimes no variations
      return [
        { name: "Extra Dip",      price: 20 },
        { name: "Double Portion", price: 70 },
      ];
    case "Desserts":
      return [
        { name: "Single",         price: 0 },
        { name: "Add Ice Cream",  price: 40 },
      ];
    default:
      return [];
  }
}

function descFor(name, category) {
  const base = `${name} — `;
  const tails = {
    Burgers: "juicy, freshly grilled, and packed with flavor.",
    Pizzas: "stone-baked with premium toppings and gooey cheese.",
    Pastas: "al dente pasta tossed in rich, house-made sauce.",
    Sandwiches: "toasted to perfection with fresh fillings.",
    Salads: "crisp greens and colorful veggies with zesty dressing.",
    Appetizers: "shareable bites to kickstart your meal.",
    Drinks: "refreshing and made to cool you down.",
    Desserts: "sweet finish to complete your meal."
  };
  return base + (tails[category] || "delicious and satisfying.");
}

// ============ EXECUTION ============

// 1) Wipe prior data for this tenant (optional)
if (WIPE_BEFORE_SEED) {
  dbx.getCollection(CATEGORIES).deleteMany({ tenantId: TENANT_ID });
  dbx.getCollection(MENU_ITEMS).deleteMany({ tenantId: TENANT_ID });
}

// 2) Insert 8 categories for this tenant (with scope + channelScope per your example)
const categories = categoryNames.map((name) => ({
  _id: new ObjectId(),
  tenantId: TENANT_ID,
  createdBy: USER_ID,
  updatedBy: USER_ID,
  name,
  createdAt: now,
  updatedAt: now,
  scope: "all",
  channelScope: "all",
  locationId: null,
  hidden: false,
  status: "active",
}));

dbx.getCollection(CATEGORIES).insertMany(categories);

// handy lookup
const catIdByName = Object.fromEntries(categories.map(c => [c.name, c._id]));

// 3) Build & insert 60 items (not equally distributed)
const bundle = [
  { cat: "Burgers",     list: BURGERS },
  { cat: "Pizzas",      list: PIZZAS },
  { cat: "Pastas",      list: PASTAS },
  { cat: "Sandwiches",  list: SANDWICHES },
  { cat: "Salads",      list: SALADS },
  { cat: "Appetizers",  list: APPETIZERS },
  { cat: "Drinks",      list: DRINKS },
  { cat: "Desserts",    list: DESSERTS },
];

const items = [];
let globalIdx = 0;

for (const { cat, list } of bundle) {
  const categoryId = catIdByName[cat];
  for (let i = 0; i < list.length; i++) {
    const { name, price } = list[i];

    items.push({
      tenantId: TENANT_ID,
      createdBy: USER_ID,
      updatedBy: USER_ID,

      name,
      categoryId,
      category: cat,

      description: descFor(name, cat),
      hidden: false,
      status: "active",
      price,

      tags: pickTags(3),
      media: pickMediaMaybe(globalIdx),
      variations: variationsFor(cat /*, i*/),

      // IMPORTANT: use channelScope per your collection's validation
      visibility: {},
      locationId: null,

      createdAt: now,
      updatedAt: now,
    });

    globalIdx++;
  }
}

// Safety check total
if (items.length !== 60) {
  print(`⚠️ Expected 60 items, got ${items.length}. Adjust lists if needed.`);
}

dbx.getCollection(MENU_ITEMS).insertMany(items);

// 4) Helpful indexes
dbx.getCollection(MENU_ITEMS).createIndex({ tenantId: 1, categoryId: 1 });
dbx.getCollection(MENU_ITEMS).createIndex({ tenantId: 1, name: "text" });

print(`✅ Seed complete for tenant ${TENANT_ID.str}: ${categories.length} categories, ${items.length} items`);
