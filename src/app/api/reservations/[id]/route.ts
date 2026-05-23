import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json({ error: "Reservation ID is required" }, { status: 400 });
    }

    // Query the reservation and eager load the product and warehouse details
    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: {
        product: true,
        warehouse: true,
      },
    });

    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }

    // If reservation has expired and is still pending, check it
    const now = new Date();
    let isExpired = reservation.status === "PENDING" && now > new Date(reservation.expiresAt);

    return NextResponse.json({
      ...reservation,
      isExpired,
    });
  } catch (error: any) {
    console.error(`❌ GET /api/reservations/[id] error:`, error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
