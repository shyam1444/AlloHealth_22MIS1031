import { NextRequest, NextResponse } from "next/server";
import { releaseReservation } from "@/lib/reservationService";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json({ error: "Reservation ID is required" }, { status: 400 });
    }

    const reservation = await releaseReservation(id);
    return NextResponse.json(reservation);
  } catch (error: any) {
    if (error.message === "RESERVATION_ALREADY_CONFIRMED") {
      return NextResponse.json(
        { error: "Cannot cancel a reservation that has already been confirmed and paid for" },
        { status: 400 }
      );
    }
    if (error.message === "RESERVATION_NOT_FOUND") {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }

    console.error("❌ POST /api/reservations/[id]/release error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
