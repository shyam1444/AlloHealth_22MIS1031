import { prisma } from "./db";

/**
 * Finds all active PENDING reservations that have passed their expiresAt time,
 * releases their held stock (decrements Stock.reserved) and updates status to RELEASED.
 * Safe to call before checking stock levels or creating new reservations.
 */
export async function cleanupExpiredReservations() {
  const now = new Date();

  // Find all PENDING reservations that have expired
  const expiredReservations = await prisma.reservation.findMany({
    where: {
      status: "PENDING",
      expiresAt: { lt: now },
    },
  });

  if (expiredReservations.length === 0) {
    return 0;
  }

  console.log(`🧹 Found ${expiredReservations.length} expired reservations to clean up.`);

  let count = 0;
  for (const res of expiredReservations) {
    try {
      await prisma.$transaction(async (tx) => {
        // Lock and verify reservation is still PENDING inside the transaction
        const lockedRes = await tx.$queryRaw<any[]>`
          SELECT * FROM "Reservation"
          WHERE "id" = ${res.id} AND "status" = 'PENDING'
          FOR UPDATE
        `;

        if (lockedRes.length > 0) {
          // Update status to RELEASED
          await tx.reservation.update({
            where: { id: res.id },
            data: { status: "RELEASED" },
          });

          // Return the stock to the available pool
          await tx.stock.update({
            where: {
              productId_warehouseId: {
                productId: res.productId,
                warehouseId: res.warehouseId,
              },
            },
            data: {
              reserved: { decrement: res.units },
            },
          });
          count++;
          console.log(`🔓 Released expired reservation ${res.id} (${res.units} units)`);
        }
      });
    } catch (err) {
      console.error(`❌ Failed to release expired reservation ${res.id}:`, err);
    }
  }

  return count;
}

/**
 * Creates a PENDING reservation for stock units.
 * Guarantees correctness under concurrency via pessimistic row locking (FOR UPDATE) in Postgres.
 */
export async function createReservation(
  productId: string,
  warehouseId: string,
  units: number,
  idempotencyKey?: string
) {
  // 1. Check idempotency cache first
  if (idempotencyKey) {
    const existing = await prisma.reservation.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      console.log(`✨ Idempotency HIT for reservation: ${idempotencyKey}`);
      return { reservation: existing, idempotentReplay: true };
    }
  }

  // 2. Perform lazy cleanup to release any expired holds before evaluating stock
  await cleanupExpiredReservations();

  // 3. Execute reservation within an interactive database transaction
  const reservation = await prisma.$transaction(async (tx) => {
    // Lock the Stock row for (productId, warehouseId) to block concurrent writes
    const stocks = await tx.$queryRaw<any[]>`
      SELECT * FROM "Stock"
      WHERE "productId" = ${productId} AND "warehouseId" = ${warehouseId}
      FOR UPDATE
    `;

    if (stocks.length === 0) {
      throw new Error("STOCK_NOT_FOUND");
    }

    const stock = stocks[0];
    const available = stock.total - stock.reserved;

    if (available < units) {
      throw new Error("INSUFFICIENT_STOCK");
    }

    // Double check idempotency inside transaction for strict race safety
    if (idempotencyKey) {
      const existing = await tx.reservation.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        return existing;
      }
    }

    // Determine expiry duration (defaults to 10 mins)
    const expiryMinutes = parseInt(process.env.RESERVATION_EXPIRY_MINUTES || "10", 10);
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    // Create the Reservation row
    const res = await tx.reservation.create({
      data: {
        productId,
        warehouseId,
        units,
        status: "PENDING",
        expiresAt,
        idempotencyKey: idempotencyKey || null,
      },
    });

    // Increment reserved stock level
    await tx.stock.update({
      where: {
        productId_warehouseId: { productId, warehouseId },
      },
      data: {
        reserved: { increment: units },
      },
    });

    return res;
  });

  return { reservation, idempotentReplay: false };
}

/**
 * Confirms a PENDING reservation (payment succeeded).
 * Converts the held units into a permanent stock reduction.
 */
export async function confirmReservation(reservationId: string) {
  return await prisma.$transaction(async (tx) => {
    // Lock the reservation row
    const reservations = await tx.$queryRaw<any[]>`
      SELECT * FROM "Reservation"
      WHERE "id" = ${reservationId}
      FOR UPDATE
    `;

    if (reservations.length === 0) {
      throw new Error("RESERVATION_NOT_FOUND");
    }

    const res = reservations[0];

    if (res.status === "CONFIRMED") {
      return await tx.reservation.findUnique({
        where: { id: reservationId },
        include: {
          product: true,
          warehouse: true,
        },
      });
    }

    if (res.status === "RELEASED") {
      throw new Error("RESERVATION_ALREADY_RELEASED");
    }

    // Verify expiration status
    const now = new Date();
    if (now > new Date(res.expiresAt)) {
      // Mark as RELEASED and return units to available stock immediately
      await tx.reservation.update({
        where: { id: reservationId },
        data: { status: "RELEASED" },
      });

      await tx.stock.update({
        where: {
          productId_warehouseId: {
            productId: res.productId,
            warehouseId: res.warehouseId,
          },
        },
        data: {
          reserved: { decrement: res.units },
        },
      });

      throw new Error("RESERVATION_EXPIRED"); // Translates to 410 Gone
    }

    // Set reservation to CONFIRMED
    const updatedRes = await tx.reservation.update({
      where: { id: reservationId },
      data: { status: "CONFIRMED" },
      include: {
        product: true,
        warehouse: true,
      },
    });

    // Permanently decrement stock
    await tx.stock.update({
      where: {
        productId_warehouseId: {
          productId: res.productId,
          warehouseId: res.warehouseId,
        },
      },
      data: {
        total: { decrement: res.units },
        reserved: { decrement: res.units },
      },
    });

    return updatedRes;
  });
}

/**
 * Releases a PENDING reservation early (user cancelled or payment failed).
 */
export async function releaseReservation(reservationId: string) {
  return await prisma.$transaction(async (tx) => {
    // Lock the reservation row
    const reservations = await tx.$queryRaw<any[]>`
      SELECT * FROM "Reservation"
      WHERE "id" = ${reservationId}
      FOR UPDATE
    `;

    if (reservations.length === 0) {
      throw new Error("RESERVATION_NOT_FOUND");
    }

    const res = reservations[0];

    if (res.status === "RELEASED") {
      return await tx.reservation.findUnique({
        where: { id: reservationId },
        include: {
          product: true,
          warehouse: true,
        },
      });
    }

    if (res.status === "CONFIRMED") {
      throw new Error("RESERVATION_ALREADY_CONFIRMED");
    }

    // Set reservation to RELEASED
    const updatedRes = await tx.reservation.update({
      where: { id: reservationId },
      data: { status: "RELEASED" },
      include: {
        product: true,
        warehouse: true,
      },
    });

    // Release stock hold back to available pool
    await tx.stock.update({
      where: {
        productId_warehouseId: {
          productId: res.productId,
          warehouseId: res.warehouseId,
        },
      },
      data: {
        reserved: { decrement: res.units },
      },
    });

    return updatedRes;
  });
}
