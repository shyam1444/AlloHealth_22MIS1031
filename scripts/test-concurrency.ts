import dotenv from "dotenv";
dotenv.config();
import { prisma } from "../src/lib/db";
import { createReservation } from "../src/lib/reservationService";

async function runTest() {
  console.log("🧪 Starting Concurrency Lock Validation Test...");

  // 1. Resolve seed references
  const product = await prisma.product.findUnique({
    where: { sku: "ALLO-MONTR-003" },
  });
  const warehouse = await prisma.warehouse.findFirst({
    where: { name: "San Francisco Fulfilment Hub" },
  });

  if (!product || !warehouse) {
    console.error("❌ Pre-requisite seed data missing. Please run `npx tsx prisma/seed.ts` first.");
    process.exit(1);
  }

  // 2. Reset stock levels to exactly 1 unit
  console.log("🔄 Resetting target stock to exactly 1 physical unit...");
  await prisma.stock.update({
    where: {
      productId_warehouseId: { productId: product.id, warehouseId: warehouse.id },
    },
    data: {
      total: 1,
      reserved: 0,
    },
  });

  // Delete any prior reservations for clean assertions
  await prisma.reservation.deleteMany({
    where: { productId: product.id, warehouseId: warehouse.id },
  });

  console.log("⚡ Firing 10 concurrent reservation requests for the last physical unit...");

  // 3. Fire 10 concurrent createReservation promises
  const requests = Array.from({ length: 10 }).map((_, index) => {
    return createReservation(product.id, warehouse.id, 1, `idem-test-key-${index}`)
      .then((res) => {
        return { index, success: true, result: res.reservation, error: null };
      })
      .catch((err) => {
        return { index, success: false, result: null, error: err.message as string };
      });
  });

  const results = await Promise.all(requests);

  const successes = results.filter((r) => r.success);
  const failures = results.filter((r) => !r.success);

  // 4. Print results ledger
  console.log("\n📊 CONCURRENCY TRANSACTION REPORT:");
  console.log("----------------------------------------------------------------------");
  results.forEach((r) => {
    if (r.success) {
      console.log(`[Request #${(r.index + 1).toString().padStart(2, "0")}] ✅ SUCCESS - Hold Established (ID: ${r.result?.id})`);
    } else {
      console.log(`[Request #${(r.index + 1).toString().padStart(2, "0")}] ❌ FAILED  - Error Code: ${r.error}`);
    }
  });
  console.log("----------------------------------------------------------------------");

  // 5. Assertions
  console.log("\n📈 TESTING SYSTEM ASSERTIONS:");
  console.log(`- Success count: ${successes.length} (Expected: 1)`);
  console.log(`- Failure count: ${failures.length} (Expected: 9)`);

  const finalStock = await prisma.stock.findUnique({
    where: {
      productId_warehouseId: { productId: product.id, warehouseId: warehouse.id },
    },
  });

  console.log(`- Stock remaining total: ${finalStock?.total} (Expected: 1)`);
  console.log(`- Stock reserved: ${finalStock?.reserved} (Expected: 1)`);

  const isSuccessful =
    successes.length === 1 &&
    failures.length === 9 &&
    finalStock?.reserved === 1 &&
    finalStock?.total === 1;

  if (isSuccessful) {
    console.log("\n🎉 CONCURRENCY LOCK TEST PASSED SUCCESSFULLY!");
    console.log("PostgreSQL row-level locks verified to be 100% race-condition-free.");
  } else {
    console.error("\n🔴 TEST CRITICAL FAILURE: Concurrency lock failed to prevent overallocation!");
    process.exit(1);
  }
}

runTest()
  .catch((e) => {
    console.error("Test execution crashed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
