import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { cleanupExpiredReservations } from "@/lib/reservationService";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // 1. Perform lazy cleanup to keep stocks accurate on read
    await cleanupExpiredReservations();

    // 2. Query products with stock records and warehouse metadata
    const products = await prisma.product.findMany({
      include: {
        stocks: {
          include: {
            warehouse: true,
          },
        },
      },
      orderBy: {
        name: "asc",
      },
    });

    return NextResponse.json(products);
  } catch (error) {
    console.error("❌ GET /api/products error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
