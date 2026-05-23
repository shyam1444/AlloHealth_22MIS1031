import { NextResponse } from "next/server";
import { cleanupExpiredReservations } from "@/lib/reservationService";

export const dynamic = "force-dynamic";

async function handleCleanup() {
  try {
    const releasedCount = await cleanupExpiredReservations();
    return NextResponse.json({
      success: true,
      message: `Successfully released ${releasedCount} expired reservations back to available stock.`,
      releasedCount,
    });
  } catch (error: any) {
    console.error("❌ /api/cleanup error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function GET() {
  return handleCleanup();
}

export async function POST() {
  return handleCleanup();
}
