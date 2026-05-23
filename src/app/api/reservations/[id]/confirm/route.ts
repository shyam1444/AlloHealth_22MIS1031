import { NextRequest, NextResponse } from "next/server";
import { confirmReservation } from "@/lib/reservationService";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json({ error: "Reservation ID is required" }, { status: 400 });
    }

    const reservation = await confirmReservation(id);
    return NextResponse.json(reservation);
  } catch (error: any) {
    if (error.message === "RESERVATION_EXPIRED") {
      return NextResponse.json(
        { error: "This reservation has expired (10-minute hold exceeded) and the stock has been released." },
        { status: 410 } // 410 Gone
      );
    }
    if (error.message === "RESERVATION_ALREADY_RELEASED") {
      return NextResponse.json(
        { error: "This reservation has already been cancelled or released." },
        { status: 410 }
      );
    }
    if (error.message === "RESERVATION_NOT_FOUND") {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }

    console.error("❌ POST /api/reservations/[id]/confirm error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
