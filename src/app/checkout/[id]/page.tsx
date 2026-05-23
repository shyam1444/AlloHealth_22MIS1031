"use client";

import { use, useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import confetti from "canvas-confetti";
import {
  Clock,
  MapPin,
  Package,
  ShoppingCart,
  CreditCard,
  Trash2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  ArrowLeft,
  RefreshCw,
  Receipt,
  Truck,
  ShieldCheck,
  Award,
  ChevronRight,
} from "lucide-react";

interface ReservationDetails {
  id: string;
  productId: string;
  warehouseId: string;
  units: number;
  status: "PENDING" | "CONFIRMED" | "RELEASED";
  createdAt: string;
  expiresAt: string;
  idempotencyKey: string | null;
  product: {
    id: string;
    sku: string;
    name: string;
    description: string | null;
    price: number;
  };
  warehouse: {
    id: string;
    name: string;
    location: string;
  };
  isExpired: boolean;
}

interface CheckoutPageProps {
  params: Promise<{ id: string }>;
}

export default function CheckoutPage({ params }: CheckoutPageProps) {
  const router = useRouter();
  const { id } = use(params);

  const [reservation, setReservation] = useState<ReservationDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Expiry Countdown State (Seconds remaining)
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [percentLeft, setPercentLeft] = useState<number>(100);

  // Button load states
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmIdempotencyKey, setConfirmIdempotencyKey] = useState("");

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch reservation details
  const fetchReservation = async () => {
    try {
      const res = await fetch(`/api/reservations/${id}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to load reservation");
        setLoading(false);
        return;
      }

      setReservation(data);
      setLoading(false);

      // Initialize idempotency key for confirmation
      setConfirmIdempotencyKey(`idem-confirm-${data.id}-${Date.now()}`);

      // If active and pending, start the countdown clock
      if (data.status === "PENDING") {
        const expiresTime = new Date(data.expiresAt).getTime();
        const now = Date.now();
        const diffSeconds = Math.max(0, Math.floor((expiresTime - now) / 1000));
        setTimeLeft(diffSeconds);

        // Standard hold is 10 minutes (600 seconds)
        const totalDuration = Math.max(600, Math.floor((expiresTime - new Date(data.createdAt).getTime()) / 1000));
        setPercentLeft((diffSeconds / totalDuration) * 100);
      }
    } catch (e) {
      setError("Network error loading checkout details");
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReservation();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [id]);

  // Handle ticking countdown clock
  useEffect(() => {
    if (reservation?.status !== "PENDING" || timeLeft <= 0) {
      if (timeLeft <= 0 && reservation?.status === "PENDING") {
        // Expiry reached! Update local status and sync database
        setReservation((prev) => prev ? { ...prev, status: "RELEASED", isExpired: true } : null);
        // Force database cleanup
        fetch(`/api/reservations/${id}/confirm`, { method: "POST" }).catch(() => {});
      }
      return;
    }

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        const nextTime = prev - 1;
        if (reservation) {
          const expiresTime = new Date(reservation.expiresAt).getTime();
          const totalDuration = Math.max(600, Math.floor((expiresTime - new Date(reservation.createdAt).getTime()) / 1000));
          setPercentLeft((nextTime / totalDuration) * 100);
        }
        return nextTime;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [timeLeft, reservation]);

  const handleConfirm = async () => {
    if (!reservation) return;
    setActionLoading(true);
    setActionError(null);

    try {
      const res = await fetch(`/api/reservations/${id}/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": confirmIdempotencyKey,
        },
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 410) {
          // Explicit 410 Gone / Expired
          setReservation((prev) => prev ? { ...prev, status: "RELEASED", isExpired: true } : null);
          setActionError("⚠️ Expiry Collision! This reservation has expired and the stock has already been released.");
        } else {
          setActionError(data.error || "Failed to confirm purchase");
        }
        return;
      }

      // Success! Update local reservation state
      setReservation(data);

      // Clean hold session from localStorage
      localStorage.removeItem(`allo_reservation_${id}`);

      // Fire premium confetti explosion!
      fireConfettiCelebration();
    } catch (e) {
      setActionError("Network error. Please check your connection and try again.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRelease = async () => {
    if (!reservation) return;
    setActionLoading(true);
    setActionError(null);

    try {
      const res = await fetch(`/api/reservations/${id}/release`, {
        method: "POST",
      });

      const data = await res.json();

      if (!res.ok) {
        setActionError(data.error || "Failed to cancel reservation");
        return;
      }

      // Success! Update local reservation state
      setReservation(data);

      // Clean hold session from localStorage
      localStorage.removeItem(`allo_reservation_${id}`);

      // Redirect back to catalog
      router.push("/");
    } catch (e) {
      setActionError("Network error. Please try again.");
    } finally {
      setActionLoading(false);
    }
  };

  const fireConfettiCelebration = () => {
    const duration = 3 * 1000;
    const end = Date.now() + duration;

    const frame = () => {
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: ["#6366f1", "#a855f7", "#10b981"],
      });
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: ["#6366f1", "#a855f7", "#10b981"],
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    };
    frame();
  };

  // Formatting helpers
  const formatPrice = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const getTimerStrokeColor = () => {
    if (timeLeft <= 60) return "stroke-rose-500"; // Less than 1 minute
    if (timeLeft <= 180) return "stroke-amber-500"; // Less than 3 minutes
    return "stroke-emerald-400";
  };

  const getTimerTextColor = () => {
    if (timeLeft <= 60) return "text-rose-400";
    if (timeLeft <= 180) return "text-amber-400";
    return "text-emerald-400";
  };

  // 1. Loading State
  if (loading) {
    return (
      <div className="min-h-screen bg-[#07070a] text-slate-100 flex flex-col items-center justify-center p-6">
        <div className="relative w-12 h-12 mb-4">
          <div className="absolute top-0 left-0 w-full h-full border-4 border-indigo-500/20 rounded-full" />
          <div className="absolute top-0 left-0 w-full h-full border-4 border-t-indigo-500 rounded-full animate-spin" />
        </div>
        <p className="text-xs font-semibold text-slate-400 animate-pulse uppercase tracking-wider">
          Retrieving reservation hold details...
        </p>
      </div>
    );
  }

  // 2. Error State (Not Found)
  if (error || !reservation) {
    return (
      <div className="min-h-screen bg-[#07070a] text-slate-100 flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-2xl text-center">
          <div className="w-16 h-16 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6 text-rose-400">
            <XCircle className="w-8 h-8" />
          </div>
          <h2 className="font-extrabold text-2xl mb-2 text-slate-100">Hold Session Missing</h2>
          <p className="text-sm text-slate-400 mb-6 leading-relaxed">
            {error || "We couldn't find an active reservation for this ID. It may have expired and been cleaned up by our database workers."}
          </p>
          <button
            onClick={() => router.push("/")}
            className="w-full bg-indigo-600 hover:bg-indigo-500 active:scale-95 transition text-white font-bold py-3 rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-indigo-600/10"
          >
            <ArrowLeft className="w-4 h-4" /> Return to Catalog
          </button>
        </div>
      </div>
    );
  }

  const isConfirmed = reservation.status === "CONFIRMED";
  const isReleased = reservation.status === "RELEASED" || reservation.isExpired;

  // 3. Main Page Render
  return (
    <div className="min-h-screen bg-[#07070a] text-slate-100 font-sans selection:bg-indigo-500/30 py-12 px-4 sm:px-6 lg:px-8">
      {/* Decorative Gradients */}
      <div className="absolute top-0 left-0 w-full h-[500px] bg-gradient-to-b from-indigo-900/10 via-purple-900/5 to-transparent pointer-events-none -z-10" />
      <div className="absolute top-1/3 left-10 w-[250px] h-[250px] bg-indigo-500/5 blur-[100px] rounded-full pointer-events-none -z-10" />

      <div className="max-w-xl mx-auto">
        {/* Back Link */}
        <button
          onClick={() => router.push("/")}
          className="flex items-center gap-2 text-slate-400 hover:text-slate-200 text-xs font-semibold mb-6 transition"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Products Catalog
        </button>

        {/* Dynamic State Cards Container */}
        <AnimatePresence mode="wait">
          {/* STATE A: ACTIVE RESERVATION HOLD (PENDING) */}
          {!isConfirmed && !isReleased && (
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              key="pending-hold"
              className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6 md:p-8 shadow-2xl backdrop-blur-md"
            >
              {/* Circular SVG Timer Header */}
              <div className="flex flex-col items-center justify-center border-b border-slate-800/60 pb-6 mb-6">
                <div className="relative w-32 h-32 flex items-center justify-center">
                  {/* SVG Circle Track */}
                  <svg className="w-full h-full transform -rotate-90">
                    <circle
                      cx="64"
                      cy="64"
                      r="54"
                      className="stroke-slate-800 fill-none"
                      strokeWidth="6"
                    />
                    <motion.circle
                      cx="64"
                      cy="64"
                      r="54"
                      className={`fill-none transition-all duration-1000 ${getTimerStrokeColor()}`}
                      strokeWidth="6"
                      strokeDasharray={2 * Math.PI * 54}
                      strokeDashoffset={2 * Math.PI * 54 * (1 - percentLeft / 100)}
                      strokeLinecap="round"
                    />
                  </svg>
                  {/* Text Countdown in Center */}
                  <div className="absolute text-center">
                    <span className={`block font-mono text-2xl font-black ${getTimerTextColor()}`}>
                      {formatTime(timeLeft)}
                    </span>
                    <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">
                      Hold Time
                    </span>
                  </div>
                </div>
                <h2 className="mt-4 font-extrabold text-xl text-slate-100 text-center">
                  Stock Reserved & Secured!
                </h2>
                <p className="mt-1.5 text-xs text-slate-400 text-center max-w-sm">
                  These units are temporarily locked for your order. Complete checkout before the countdown expires.
                </p>
              </div>

              {/* Order Specifications */}
              <div className="space-y-4 mb-6">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400 uppercase tracking-wider">
                  <Receipt className="w-3.5 h-3.5" /> Order Hold Specs
                </div>

                <div className="bg-slate-950/40 border border-slate-850 p-4 rounded-xl space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <Package className="w-4 h-4 text-indigo-400 mt-0.5" />
                      <div>
                        <p className="text-xs font-bold text-slate-200">
                          {reservation.product.name}
                        </p>
                        <p className="text-[10px] text-slate-500 font-mono uppercase">
                          SKU: {reservation.product.sku}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs font-extrabold text-slate-300">
                      x{reservation.units}
                    </span>
                  </div>

                  <div className="flex items-center gap-2.5 pt-2 border-t border-slate-900">
                    <MapPin className="w-4 h-4 text-slate-500" />
                    <div>
                      <p className="text-[11px] text-slate-400">Warehouse Location</p>
                      <p className="text-xs font-bold text-slate-300">
                        {reservation.warehouse.name}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Subtotal Total Summary */}
                <div className="flex justify-between items-center bg-indigo-950/20 border border-indigo-950/40 p-4 rounded-xl">
                  <span className="text-xs text-indigo-300 font-medium">Grand Total Price:</span>
                  <span className="text-xl font-black text-emerald-400">
                    {formatPrice(reservation.product.price * reservation.units)}
                  </span>
                </div>
              </div>

              {/* API Alert Trigger Panel */}
              <AnimatePresence>
                {actionError && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mb-5 p-3.5 bg-rose-950/40 border border-rose-900/30 text-rose-300 rounded-xl text-xs flex gap-2.5 items-start"
                  >
                    <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                    <div>{actionError}</div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Action Buttons */}
              <div className="space-y-3">
                <button
                  onClick={handleConfirm}
                  disabled={actionLoading}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] transition disabled:opacity-50 text-white font-bold py-3.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-emerald-600/10"
                >
                  {actionLoading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Simulating checkout authentication...
                    </>
                  ) : (
                    <>
                      <CreditCard className="w-4 h-4" />
                      Confirm Purchase & Pay
                    </>
                  )}
                </button>

                <button
                  onClick={handleRelease}
                  disabled={actionLoading}
                  className="w-full bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 text-rose-400/90 font-bold py-3.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 transition duration-200 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                  Cancel Hold (Release Stock Immediately)
                </button>
              </div>
            </motion.div>
          )}

          {/* STATE B: ORDER SUCCESSFULLY COMPLETED (CONFIRMED RECEIPT) */}
          {isConfirmed && (
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              key="confirmed-success"
              className="bg-slate-900/40 border border-emerald-500/20 rounded-2xl p-6 md:p-8 shadow-2xl backdrop-blur-md overflow-hidden relative"
            >
              {/* Top Highlight Banner */}
              <div className="absolute top-0 left-0 w-full h-1.5 bg-emerald-500" />

              <div className="text-center pb-6 border-b border-slate-850 mb-6">
                <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/25 rounded-2xl flex items-center justify-center mx-auto mb-4 text-emerald-400">
                  <CheckCircle className="w-9 h-9" />
                </div>
                <h2 className="font-extrabold text-2xl text-slate-100">Checkout Complete!</h2>
                <p className="mt-1.5 text-xs text-emerald-400 font-semibold flex items-center justify-center gap-1">
                  <ShieldCheck className="w-4 h-4" /> Stock Permanently Decremented
                </p>
                <span className="mt-2 inline-block font-mono text-[9px] bg-slate-950/60 px-3 py-1 rounded text-slate-500 border border-slate-900 select-all">
                  TXN ID: {reservation.id}
                </span>
              </div>

              {/* Receipt Table */}
              <div className="space-y-4 mb-8">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Award className="w-3.5 h-3.5" /> Order Inventory Receipt
                </h3>

                <div className="bg-slate-950/40 border border-slate-850 p-4 rounded-xl space-y-3.5">
                  <div className="flex justify-between items-start gap-4">
                    <div>
                      <span className="text-[9px] font-bold text-slate-500 block">ITEM</span>
                      <span className="text-xs font-bold text-slate-200">{reservation.product.name}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-[9px] font-bold text-slate-500 block">QTY</span>
                      <span className="text-xs font-bold text-slate-200">x{reservation.units}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-3 border-t border-slate-900 text-xs">
                    <div>
                      <span className="text-[9px] font-bold text-slate-500 block">FULFILMENT SITE</span>
                      <span className="font-semibold text-slate-300">{reservation.warehouse.name}</span>
                    </div>
                    <div>
                      <span className="text-[9px] font-bold text-slate-500 block">LOCATION</span>
                      <span className="font-semibold text-slate-300">{reservation.warehouse.location}</span>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between items-center bg-slate-950/30 border border-slate-850 p-4 rounded-xl">
                  <span className="text-xs text-slate-400">Total Price Paid:</span>
                  <span className="text-lg font-black text-emerald-400">
                    {formatPrice(reservation.product.price * reservation.units)}
                  </span>
                </div>
              </div>

              {/* Back to Home CTA */}
              <button
                onClick={() => router.push("/")}
                className="w-full bg-indigo-600 hover:bg-indigo-500 active:scale-95 transition text-white font-bold py-3.5 rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-indigo-600/10"
              >
                Return to Shop Catalog <ChevronRight className="w-4.5 h-4.5" />
              </button>
            </motion.div>
          )}

          {/* STATE C: HOLD EXPIRED OR RELEASED (410 GONE) */}
          {isReleased && (
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              key="expired-released"
              className="bg-slate-900/40 border border-rose-500/20 rounded-2xl p-6 md:p-8 shadow-2xl backdrop-blur-md overflow-hidden relative"
            >
              {/* Top Highlight Banner */}
              <div className="absolute top-0 left-0 w-full h-1.5 bg-rose-500" />

              <div className="text-center pb-6 mb-6">
                <div className="w-16 h-16 bg-rose-500/10 border border-rose-500/25 rounded-2xl flex items-center justify-center mx-auto mb-4 text-rose-400">
                  <AlertTriangle className="w-9 h-9" />
                </div>
                <h2 className="font-extrabold text-2xl text-slate-100">
                  {reservation.isExpired ? "Reservation Expired" : "Reservation Cancelled"}
                </h2>
                <p className="mt-2 text-xs text-rose-400 font-semibold px-2 py-1 rounded bg-rose-950/20 border border-rose-900/30 inline-block">
                  Status Code: 410 Gone / Released
                </p>
                <p className="mt-4 text-xs text-slate-400 leading-relaxed max-w-sm mx-auto">
                  {reservation.isExpired
                    ? "The 10-minute hold window for these units has elapsed. To ensure fair stock access for other shoppers, the inventory was automatically released back to the warehouse available pool."
                    : "This hold was successfully cancelled early. The units have been returned to the warehouse stock pools."}
                </p>
              </div>

              {/* Back to Home CTA */}
              <button
                onClick={() => router.push("/")}
                className="w-full bg-indigo-600 hover:bg-indigo-500 active:scale-95 transition text-white font-bold py-3.5 rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-indigo-600/10"
              >
                <ArrowLeft className="w-4 h-4" /> Return to Catalog & Try Again
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
