import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createReservation } from "@/lib/reservationService";

const reserveSchema = z.object({
  productId: z.string(),
  warehouseId: z.string(),
  units: z.number().int().positive("Units must be at least 1"),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const validation = reserveSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: validation.error.format() },
        { status: 400 }
      );
    }

    const { productId, warehouseId, units } = validation.data;
    const idempotencyKey = req.headers.get("idempotency-key") || req.headers.get("Idempotency-Key") || undefined;

    const { reservation, idempotentReplay } = await createReservation(
      productId,
      warehouseId,
      units,
      idempotencyKey
    );

    const headers = new Headers();
    if (idempotentReplay) {
      headers.set("X-Cache-Lookup", "HIT");
      headers.set("Idempotent-Replay", "true");
    }

    return NextResponse.json(reservation, {
      status: 201,
      headers,
    });
  } catch (error: any) {
    if (error.message === "INSUFFICIENT_STOCK") {
      return NextResponse.json(
        { error: "Insufficient stock available for the requested quantity" },
        { status: 409 }
      );
    }
    if (error.message === "STOCK_NOT_FOUND") {
      return NextResponse.json(
        { error: "No inventory record found for the requested product and warehouse combo" },
        { status: 404 }
      );
    }

    console.error("❌ POST /api/reservations error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
