"""Realistic menus of the kinds of restaurants found in Bangladesh — for the "what do you have?" menu glance.
Each: (restaurant kind, expected cuisine label(s) in Bangla, kinds a waiter would surely name, {category: [dishes]})."""

BD_MENUS = [
    ("Chinese-Thai (Dhaka style)", ["চাইনিজ"], ["স্যুপ", "ফ্রাইড রাইস", "চাওমিন"], {
        "Soup": ["Thai Soup", "Thai Clear Soup", "Corn Soup", "Hot & Sour Soup", "Wonton Soup", "Tom Yum Soup"],
        "Appetizer": ["Spring Roll", "Fried Wonton", "Chicken Fry", "Prawn Tempura", "French Fry"],
        "Rice": ["Egg Fried Rice", "Chicken Fried Rice", "Mixed Fried Rice", "Thai Fried Rice", "Vegetable Fried Rice"],
        "Noodles": ["Chicken Chowmein", "Mixed Chowmein", "Thai Chowmein", "Pad Thai"],
        "Chicken": ["Chicken Chili Onion", "Chicken Masala", "Chicken Cashew Nut", "Chicken Manchurian", "Sweet & Sour Chicken"],
        "Beef": ["Beef Chili Onion", "Beef Sizzling", "Beef Oyster Sauce", "Beef Chili Dry"],
        "Prawn": ["Prawn Masala", "Prawn Chili", "Prawn Tempura Sizzling"],
        "Vegetable": ["Mixed Vegetable", "Chinese Vegetable"],
        "Set Menu": ["Set Menu 1", "Set Menu 2", "Set Menu 3"],
    }),
    ("Kacchi / biryani house", ["বাংলা"], ["বিরিয়ানি"], {
        "Kacchi": ["Basmati Kacchi Biryani (Full)", "Basmati Kacchi Biryani (Half)", "Mutton Kacchi Biryani", "Chicken Biryani"],
        "Tehari & Polao": ["Beef Tehari", "Morog Polao", "Plain Polao"],
        "Sides": ["Chicken Roast", "Jali Kabab", "Egg Korma", "Firni", "Borhani", "Jorda"],
        "Drinks": ["Borhani", "Coke", "Mineral Water"],
    }),
    ("Bangla home-style (bhat-mach)", ["বাংলা"], ["ভর্তা", "মাছের আইটেম"], {
        "Rice": ["Plain Rice", "Khichuri", "Bhuna Khichuri"],
        "Bhorta": ["Aloo Bhorta", "Begun Bhorta", "Shutki Bhorta", "Dal Bhorta", "Tomato Bhorta"],
        "Fish": ["Ilish Bhaja", "Shorshe Ilish", "Rui Macher Kalia", "Chingri Malaikari", "Pabda Jhol"],
        "Meat": ["Beef Bhuna", "Chicken Curry", "Mutton Rezala", "Kala Bhuna", "Deshi Murgi Jhol"],
        "Dal & Vaji": ["Dal", "Mixed Sobji", "Lau Shak Bhaji", "Dim Bhuna"],
    }),
    ("Fast food (burger place)", ["ফাস্ট ফুড"], ["বার্গার"], {
        "Burgers": ["Classic Beef Burger", "Double Decker", "Chicken Cheese Burger", "Naga Burger", "Mushroom Swiss Burger"],
        "Fried Chicken": ["2 Pc Fried Chicken", "Chicken Wings (6 pc)", "Chicken Nuggets", "Crispy Chicken Strips"],
        "Sides": ["French Fries", "Potato Wedges", "Onion Rings", "Coleslaw"],
        "Drinks": ["Coke", "Sprite", "Chocolate Milkshake", "Oreo Shake"],
    }),
    ("Pizza place", ["ফাস্ট ফুড"], ["পিজ্জা"], {
        "Pizza": ["Margherita Pizza", "Pepperoni Pizza", "BBQ Chicken Pizza", "Beef Lover Pizza", "Naga Drums Pizza", "Mexican Pizza"],
        "Pasta": ["Chicken Alfredo Pasta", "Beef Lasagna", "Spaghetti Bolognese"],
        "Sides": ["Garlic Bread", "Chicken Wings", "French Fries"],
        "Drinks": ["Coke", "Lemonade"],
    }),
    ("Café / coffee shop", ["ক্যাফে"], ["কফি"], {
        "Hot Coffee": ["Espresso", "Americano", "Cappuccino", "Cafe Latte", "Mocha", "Flat White"],
        "Cold Coffee": ["Iced Latte", "Iced Americano", "Caramel Frappe", "Cold Coffee"],
        "Tea": ["Masala Tea", "Green Tea", "Lemon Tea"],
        "Bakery": ["Chocolate Croissant", "Blueberry Muffin", "Brownie", "Red Velvet Cake", "Cheese Cake"],
        "Bites": ["Club Sandwich", "Chicken Pasta", "French Fries"],
    }),
    ("Indian / tandoor", ["ইন্ডিয়ান"], ["কাবাব"], {
        "Tandoor": ["Chicken Tikka", "Tandoori Chicken", "Reshmi Kabab", "Seekh Kabab", "Paneer Tikka"],
        "Curry": ["Butter Chicken", "Chicken Tikka Masala", "Mutton Rogan Josh", "Paneer Butter Masala", "Dal Makhani"],
        "Breads": ["Butter Naan", "Garlic Naan", "Tandoori Roti", "Laccha Paratha"],
        "Rice": ["Chicken Biryani", "Jeera Rice", "Hyderabadi Mutton Biryani"],
    }),
    ("Kabab / grill house", ["কাবাব-গ্রিল"], ["কাবাব", "গ্রিল", "নান-পরোটা"], {
        "Kabab": ["Chicken Shashlik", "Beef Shik Kabab", "Chicken Reshmi Kabab", "Beef Boti Kabab", "Chicken Tikka Kabab", "Jali Kabab"],
        "Grill": ["Grill Chicken (Full)", "Grill Chicken (Half)", "BBQ Chicken", "Chicken Chaap"],
        "Bread": ["Naan", "Garlic Naan", "Paratha", "Luchi"],
        "Drinks": ["Lassi", "Borhani", "Coke"],
    }),
    ("Thai restaurant", ["থাই"], ["স্যুপ", "কারি"], {
        "Soup": ["Tom Yum Goong", "Tom Kha Gai", "Thai Clear Soup"],
        "Salad": ["Som Tam", "Glass Noodle Salad", "Thai Beef Salad"],
        "Mains": ["Green Curry Chicken", "Red Curry Beef", "Pad Kra Pao", "Massaman Curry", "Basil Chicken"],
        "Noodles & Rice": ["Pad Thai", "Pad See Ew", "Thai Fried Rice", "Pineapple Fried Rice"],
    }),
    ("Japanese / Korean", ["জাপানিজ", "কোরিয়ান"], ["সুশি", "রামেন"], {
        "Sushi": ["Salmon Nigiri", "California Roll", "Dragon Roll", "Tuna Maki"],
        "Ramen": ["Tonkotsu Ramen", "Spicy Miso Ramen", "Shoyu Ramen"],
        "Korean": ["Bibimbap", "Tteokbokki", "Korean Fried Chicken", "Kimchi Fried Rice", "Bulgogi"],
        "Sides": ["Gyoza", "Edamame", "Miso Soup"],
    }),
    ("Arabian / Turkish (mandi, shawarma)", ["অ্যারাবিয়ান"], ["মান্ডি", "শাওয়ারমা"], {
        "Mandi": ["Chicken Mandi", "Mutton Mandi", "Beef Mandi Platter", "Mixed Mandi Platter"],
        "Shawarma": ["Chicken Shawarma", "Beef Shawarma", "Shawarma Platter", "Mexican Shawarma"],
        "Grill": ["Shish Tawook", "Adana Kebab", "Mix Grill Platter"],
        "Sides & Sweets": ["Hummus", "Pita Bread", "Kunafa", "Baklava", "Garlic Sauce"],
    }),
    ("Street food (fuchka-chotpoti)", ["স্ট্রিট ফুড"], ["ফুচকা-চটপটি", "সিঙ্গারা-সমুচা"], {
        "Fuchka & Chotpoti": ["Fuchka", "Doi Fuchka", "Chotpoti", "Dahi Puri", "Pani Puri"],
        "Snacks": ["Singara", "Samosa", "Beguni", "Piyaju", "Aloor Chop", "Velpuri"],
        "Drinks": ["Lemon Juice", "Borhani", "Tea"],
    }),
    ("Sweet shop (mishti)", ["মিষ্টি"], ["মিষ্টি", "দই"], {
        "Sweets": ["Roshogolla", "Chomchom", "Kalojam", "Rasmalai", "Sandesh", "Kacha Golla", "Laddu", "Jilapi"],
        "Doi": ["Mishti Doi", "Tok Doi"],
        "Snacks": ["Singara", "Samosa", "Nimki"],
    }),
    ("Bakery & cake shop", ["বেকারি"], ["কেক-পেস্ট্রি"], {
        "Cakes": ["Black Forest Cake", "Chocolate Cake 1 lb", "Red Velvet Cake", "Vanilla Pastry", "Chocolate Pastry"],
        "Breads": ["Milk Bread", "Garlic Bread", "Bun", "Dry Cake"],
        "Savory": ["Chicken Patties", "Vegetable Roll", "Chicken Puff", "Pizza Slice"],
        "Cookies": ["Butter Cookies", "Chocolate Chip Cookies"],
    }),
    ("Breakfast / nashta", ["বাংলা"], ["নান-পরোটা", "ভাজি", "হালিম-নেহারি"], {
        "Nashta": ["Paratha", "Porota with Dal", "Luchi", "Dal Bhaji", "Sobji Bhaji", "Dim Bhaji", "Egg Omelette"],
        "Special": ["Beef Nehari", "Halim", "Khichuri", "Chicken Soup"],
        "Tea": ["Dudh Cha", "Lal Cha", "Coffee"],
    }),
    ("Seafood restaurant", ["সি-ফুড"], ["মাছ-চিংড়ি"], {
        "Fish": ["Grilled Red Snapper", "Coral Fish Fry", "Rupchanda Fry", "Pomfret Tandoori", "Lobster Thermidor"],
        "Prawn & Crab": ["Garlic Butter Prawn", "Chili Crab", "Tiger Prawn Grill", "Crab Masala"],
        "Squid": ["Fried Calamari", "Squid Chili"],
        "Rice": ["Seafood Fried Rice", "Plain Rice"],
    }),
    ("Juice & shake bar", ["জুস-শেক"], ["জুস", "শেক", "লাচ্ছি"], {
        "Fresh Juice": ["Orange Juice", "Mango Juice", "Watermelon Juice", "Pineapple Juice", "Mixed Fruit Juice"],
        "Shakes": ["Chocolate Shake", "Oreo Shake", "Strawberry Milkshake", "Banana Shake"],
        "Lassi": ["Sweet Lassi", "Mango Lassi", "Salted Lassi"],
    }),
    ("Multi-cuisine family restaurant", ["চাইনিজ"], ["ফ্রাইড রাইস", "বার্গার"], {
        "Chinese": ["Thai Soup", "Chicken Fried Rice", "Chicken Chowmein", "Chicken Chili Onion", "Beef Sizzling"],
        "Indian": ["Butter Chicken", "Chicken Tikka", "Butter Naan", "Chicken Biryani"],
        "Fast Food": ["Beef Burger", "Chicken Pizza", "French Fries", "Club Sandwich"],
        "Bangla": ["Beef Bhuna", "Morog Polao", "Plain Rice", "Dal"],
        "Dessert": ["Firni", "Ice Cream", "Brownie"],
    }),
]


def as_items(menu):
    return [{"name": n, "category": cat} for cat, dishes in menu.items() for n in dishes]
