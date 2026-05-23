import dotenv from "dotenv";
dotenv.config();
import { prisma } from "../src/lib/db";

async function main() {
  console.log("🌱 Starting seed database...");

  // 1. Clean existing database records
  console.log("🧹 Cleaning existing data...");
  await prisma.reservation.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.product.deleteMany();
  await prisma.warehouse.deleteMany();

  // 2. Create Warehouses
  console.log("🏢 Creating warehouses...");
  const whSF = await prisma.warehouse.create({
    data: {
      name: "San Francisco Fulfilment Hub",
      location: "San Francisco, CA, USA",
    },
  });

  const whNY = await prisma.warehouse.create({
    data: {
      name: "New York Logistics Center",
      location: "Brooklyn, NY, USA",
    },
  });

  const whBLR = await prisma.warehouse.create({
    data: {
      name: "Bengaluru Distribution Hub",
      location: "Bengaluru, Karnataka, India",
    },
  });

  console.log(`Created warehouses: ${whSF.name}, ${whNY.name}, ${whBLR.name}`);

  // 3. Create Products
  console.log("📦 Creating products...");
  const productsData = [
    {
      sku: "ALLO-CHAIR-001",
      name: "AeroPosture Ergonomic Office Chair",
      description: "Premium mesh office chair with responsive lumbar support, 4D armrests, and dynamic tilt lock for long coding sessions.",
      price: 34999, // $349.99
      imageUrl: "https://images.unsplash.com/photo-1505797149-43b0069ec26b?w=600&auto=format&fit=crop&q=60",
    },
    {
      sku: "ALLO-KEYBD-002",
      name: "ClickFlow Mechanical Keyboard",
      description: "Hot-swappable 75% layout keyboard with linear silent switches, aluminum frame, and customizable RGB backlighting.",
      price: 12999, // $129.99
      imageUrl: "https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=600&auto=format&fit=crop&q=60",
    },
    {
      sku: "ALLO-MONTR-003",
      name: "HorizonWide 34\" Curved Monitor",
      description: "UltraWide WQHD IPS display featuring a 144Hz refresh rate, 1ms response time, and 99% sRGB color accuracy.",
      price: 49999, // $499.99
      imageUrl: "https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=600&auto=format&fit=crop&q=60",
    },
    {
      sku: "ALLO-PHONE-004",
      name: "AcousticShield Noise Cancelling Headphones",
      description: "Wireless over-ear headphones featuring hybrid active noise cancellation, high-res audio drivers, and a 40-hour battery life.",
      price: 24999, // $249.99
      imageUrl: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&auto=format&fit=crop&q=60",
    },
    {
      sku: "ALLO-DESK-005",
      name: "ApexRise Electric Standing Desk",
      description: "Heavy-duty dual-motor height adjustable desk with bamboo top, 4 memory presets, and anti-collision technology.",
      price: 59999, // $599.99
      imageUrl: "https://images.unsplash.com/photo-1595515106969-1ce29566ff1c?w=600&auto=format&fit=crop&q=60",
    },
  ];

  const products = [];
  for (const item of productsData) {
    const prod = await prisma.product.create({ data: item });
    products.push(prod);
  }
  console.log(`Created ${products.length} products.`);

  // 4. Create Stock entries (inventories per product per warehouse)
  console.log("📊 Seeding stock levels...");
  const stocks = [
    // Product 1: Chair (Total: 40 SF, 15 NY, 5 BLR)
    { productId: products[0].id, warehouseId: whSF.id, total: 40, reserved: 0 },
    { productId: products[0].id, warehouseId: whNY.id, total: 15, reserved: 0 },
    { productId: products[0].id, warehouseId: whBLR.id, total: 5, reserved: 0 },

    // Product 2: Keyboard (Total: 8 SF, 0 NY, 12 BLR) - NY out of stock, SF low stock
    { productId: products[1].id, warehouseId: whSF.id, total: 8, reserved: 0 },
    { productId: products[1].id, warehouseId: whNY.id, total: 0, reserved: 0 },
    { productId: products[1].id, warehouseId: whBLR.id, total: 12, reserved: 0 },

    // Product 3: Curved Monitor (Total: 1 SF, 10 NY, 20 BLR) - SF ultra-low stock for concurrency tests
    { productId: products[2].id, warehouseId: whSF.id, total: 1, reserved: 0 },
    { productId: products[2].id, warehouseId: whNY.id, total: 10, reserved: 0 },
    { productId: products[2].id, warehouseId: whBLR.id, total: 20, reserved: 0 },

    // Product 4: Headphones (Total: 50 SF, 50 NY, 50 BLR) - Abundant stock
    { productId: products[3].id, warehouseId: whSF.id, total: 50, reserved: 0 },
    { productId: products[3].id, warehouseId: whNY.id, total: 50, reserved: 0 },
    { productId: products[3].id, warehouseId: whBLR.id, total: 50, reserved: 0 },

    // Product 5: Standing Desk (Total: 0 SF, 3 NY, 0 BLR) - SF and BLR out of stock, NY very low stock
    { productId: products[4].id, warehouseId: whSF.id, total: 0, reserved: 0 },
    { productId: products[4].id, warehouseId: whNY.id, total: 3, reserved: 0 },
    { productId: products[4].id, warehouseId: whBLR.id, total: 0, reserved: 0 },
  ];

  for (const item of stocks) {
    await prisma.stock.create({ data: item });
  }

  console.log("✅ Database successfully seeded!");
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed with error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
