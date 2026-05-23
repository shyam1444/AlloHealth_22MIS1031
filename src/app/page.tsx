"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Package,
  MapPin,
  Clock,
  Layers,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  ShoppingCart,
  ChevronRight,
  ShieldCheck,
  AlertCircle,
  X,
} from "lucide-react";

interface Warehouse {
  id: string;
  name: string;
  location: string;
}

interface Stock {
  productId: string;
  warehouseId: string;
  total: number;
  reserved: number;
  warehouse: Warehouse;
}

interface Product {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  price: number;
  imageUrl: string | null;
  stocks: Stock[];
  createdAt: string;
  updatedAt: string;
}

interface ActiveHold {
  id: string;
  productName: string;
  units: number;
  expiresAt: string;
}

export default function Home() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedWarehouseFilter, setSelectedWarehouseFilter] = useState<string>("ALL");

  // Reservation Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [reserveWarehouseId, setReserveWarehouseId] = useState("");
  const [reserveUnits, setReserveUnits] = useState(1);
  const [reserveError, setReserveError] = useState<string | null>(null);
  const [reserveLoading, setReserveLoading] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");

  // Active holds in localstorage (to show return-to-checkout bar)
  const [activeHolds, setActiveHolds] = useState<ActiveHold[]>([]);

  const fetchCatalog = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const prodRes = await fetch("/api/products");
      const data = await prodRes.json();
      if (Array.isArray(data)) {
        setProducts(data);
      }

      const whRes = await fetch("/api/warehouses");
      const whData = await whRes.json();
      if (Array.isArray(whData)) {
        setWarehouses(whData);
      }
    } catch (e) {
      console.error("Error fetching catalog:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchCatalog();
    loadActiveHolds();
    // Periodically sync active holds to remove expired ones locally
    const interval = setInterval(() => {
      loadActiveHolds();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadActiveHolds = () => {
    try {
      const keys = Object.keys(localStorage);
      const holds: ActiveHold[] = [];
      const now = Date.now();

      for (const key of keys) {
        if (key.startsWith("allo_reservation_")) {
          const stored = localStorage.getItem(key);
          if (stored) {
            const data = JSON.parse(stored);
            if (new Date(data.expiresAt).getTime() > now && data.status === "PENDING") {
              holds.push({
                id: data.id,
                productName: data.productName,
                units: data.units,
                expiresAt: data.expiresAt,
              });
            } else if (new Date(data.expiresAt).getTime() <= now) {
              // Clean up expired ones from localStorage
              localStorage.removeItem(key);
            }
          }
        }
      }
      setActiveHolds(holds);
    } catch (e) {
      console.error("Error loading active holds:", e);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchCatalog(true);
  };

  const openReserveModal = (product: Product) => {
    // Generate an Idempotency-Key for this reservation attempt
    const newKey = `idem-reserve-${product.id}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    setIdempotencyKey(newKey);
    setSelectedProduct(product);

    // Pick first warehouse with available stock as default
    const availableStocks = product.stocks.filter((s) => s.total - s.reserved > 0);
    if (availableStocks.length > 0) {
      setReserveWarehouseId(availableStocks[0].warehouseId);
      setReserveUnits(1);
    } else {
      setReserveWarehouseId("");
      setReserveUnits(1);
    }

    setReserveError(null);
    setIsModalOpen(true);
  };

  const handleReserve = async () => {
    if (!selectedProduct || !reserveWarehouseId) return;

    setReserveLoading(true);
    setReserveError(null);

    try {
      const res = await fetch("/api/reservations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          productId: selectedProduct.id,
          warehouseId: reserveWarehouseId,
          units: reserveUnits,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        // Handle explicit 409 Conflict error
        if (res.status === 409) {
          setReserveError(
            "⚠️ Stock Race Condition! Another customer just completed a hold for these units. The available inventory has changed. Please refresh and try again."
          );
        } else {
          setReserveError(data.error || "Failed to create reservation");
        }
        return;
      }

      // Save reservation details to localStorage for return sessions
      localStorage.setItem(
        `allo_reservation_${data.id}`,
        JSON.stringify({
          id: data.id,
          productName: selectedProduct.name,
          units: data.units,
          expiresAt: data.expiresAt,
          status: "PENDING",
        })
      );

      setIsModalOpen(false);
      // Route directly to checkout
      router.push(`/checkout/${data.id}`);
    } catch (e) {
      setReserveError("Network error. Please check your connection and try again.");
    } finally {
      setReserveLoading(false);
    }
  };

  // Helper to format currency
  const formatPrice = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  };

  const getStockLevelConfig = (available: number, total: number) => {
    if (available <= 0) {
      return {
        label: "Out of Stock",
        textColor: "text-rose-400",
        bgColor: "bg-rose-950/40 border-rose-900/30",
        progressColor: "bg-rose-500",
        indicator: "rose",
      };
    }
    if (available <= 5) {
      return {
        label: `Low Stock (${available} left)`,
        textColor: "text-amber-400",
        bgColor: "bg-amber-950/40 border-amber-900/30",
        progressColor: "bg-amber-500",
        indicator: "amber",
      };
    }
    return {
      label: `Ample Stock (${available} available)`,
      textColor: "text-emerald-400",
      bgColor: "bg-emerald-950/40 border-emerald-900/30",
      progressColor: "bg-emerald-500",
      indicator: "emerald",
    };
  };

  return (
    <div className="min-h-screen bg-[#07070a] text-slate-100 font-sans selection:bg-indigo-500/30">
      {/* Decorative Gradients */}
      <div className="absolute top-0 left-0 w-full h-[500px] bg-gradient-to-b from-indigo-900/10 via-purple-900/5 to-transparent pointer-events-none -z-10" />
      <div className="absolute top-1/4 right-10 w-[300px] h-[300px] bg-indigo-500/5 blur-[120px] rounded-full pointer-events-none -z-10" />

      {/* Main Container */}
      <div className="max-w-6xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        
        {/* Header Section */}
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-slate-800/80 pb-8 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="bg-indigo-500/10 text-indigo-400 text-xs font-semibold px-2.5 py-1 rounded-full border border-indigo-500/25 tracking-wide uppercase">
                Enterprise Stock
              </span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-slate-50 via-slate-100 to-slate-400 bg-clip-text text-transparent sm:text-4xl">
              Allo Logistics <span className="text-indigo-400 font-medium font-serif italic">Hub</span>
            </h1>
            <p className="mt-2 text-sm text-slate-400 max-w-xl">
              Multi-warehouse inventory allocation platform. Instantly hold products at checkout with zero double-selling risk under concurrency.
            </p>
          </div>

          <div className="flex items-center gap-3 self-start md:self-center">
            <button
              onClick={handleRefresh}
              disabled={loading || refreshing}
              className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-slate-300 disabled:opacity-50 border border-slate-800 hover:border-slate-700 font-medium text-xs px-4 py-2.5 rounded-lg transition duration-200"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin text-indigo-400" : ""}`} />
              Sync Inventory
            </button>
          </div>
        </header>

        {/* Floating Active Holds Alert Bar */}
        <AnimatePresence>
          {activeHolds.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="mb-8 p-1.5 bg-gradient-to-r from-indigo-950/80 via-purple-950/80 to-slate-900/80 border border-indigo-800/40 rounded-xl shadow-2xl backdrop-blur-md"
            >
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-2">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg border border-indigo-500/20">
                    <Clock className="w-4 h-4 animate-pulse" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-indigo-300">Active Checkout Hold Session</p>
                    <p className="text-[11px] text-slate-400">
                      You have reserved <span className="text-slate-200 font-medium">{activeHolds[0].units} units</span> of{" "}
                      <span className="text-slate-200 font-medium">{activeHolds[0].productName}</span>.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => router.push(`/checkout/${activeHolds[0].id}`)}
                  className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-semibold text-xs px-4 py-2 rounded-lg shadow-lg shadow-indigo-600/20 transition-all duration-150 w-full sm:w-auto justify-center"
                >
                  Return to Checkout <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Warehouses Filters Grid */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">
            <Layers className="w-3.5 h-3.5" /> Filter Stock By Warehouse Location
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedWarehouseFilter("ALL")}
              className={`px-4 py-2 rounded-lg text-xs font-semibold border transition duration-200 ${
                selectedWarehouseFilter === "ALL"
                  ? "bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-600/15"
                  : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700"
              }`}
            >
              All Warehouses
            </button>
            {warehouses.map((wh) => (
              <button
                key={wh.id}
                onClick={() => setSelectedWarehouseFilter(wh.id)}
                className={`px-4 py-2 rounded-lg text-xs font-semibold border transition duration-200 ${
                  selectedWarehouseFilter === wh.id
                    ? "bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-600/15"
                    : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700"
                }`}
              >
                {wh.name.split(" ")[0]} ({wh.location.split(",")[0]})
              </button>
            ))}
          </div>
        </div>

        {/* Loading Spinner */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="relative w-12 h-12">
              <div className="absolute top-0 left-0 w-full h-full border-4 border-indigo-500/20 rounded-full" />
              <div className="absolute top-0 left-0 w-full h-full border-4 border-t-indigo-500 rounded-full animate-spin" />
            </div>
            <p className="mt-4 text-xs font-medium text-slate-400 animate-pulse">Syncing multi-warehouse ledger...</p>
          </div>
        ) : (
          /* Products Catalog Grid */
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {products.map((product) => {
              // Calculate aggregate available stocks based on filter
              const filteredStocks =
                selectedWarehouseFilter === "ALL"
                  ? product.stocks
                  : product.stocks.filter((s) => s.warehouseId === selectedWarehouseFilter);

              const totalAvailable = filteredStocks.reduce(
                (sum, s) => sum + Math.max(0, s.total - s.reserved),
                0
              );

              const hasStock = totalAvailable > 0;

              return (
                <motion.div
                  layout
                  key={product.id}
                  className="relative flex flex-col bg-slate-900/40 border border-slate-800/80 rounded-2xl p-5 hover:border-slate-700/60 shadow-xl transition-all duration-300 group overflow-hidden"
                >
                  {/* Glass Card Gradient Shine */}
                  <div className="absolute -top-10 -right-10 w-24 h-24 bg-gradient-to-br from-indigo-500/10 to-transparent blur-xl pointer-events-none rounded-full" />

                  {/* Product Title / Price Header */}
                  <div className="flex justify-between items-start gap-4 mb-3">
                    <div>
                      <h3 className="font-bold text-lg text-slate-100 group-hover:text-indigo-400 transition-colors duration-250">
                        {product.name}
                      </h3>
                      <span className="text-[10px] font-mono tracking-widest text-slate-500 uppercase">
                        SKU: {product.sku}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-indigo-400 font-extrabold text-lg">
                        {formatPrice(product.price)}
                      </span>
                    </div>
                  </div>

                  {/* Product Description */}
                  <p className="text-xs text-slate-400 leading-relaxed mb-5 min-h-[40px]">
                    {product.description || "No description provided."}
                  </p>

                  {/* Stock Levels Partition */}
                  <div className="space-y-3.5 mb-6 flex-1">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400">
                      <Package className="w-3.5 h-3.5" /> Stocks per Warehouse
                    </div>

                    <div className="space-y-2">
                      {product.stocks.map((stock) => {
                        const available = stock.total - stock.reserved;
                        const config = getStockLevelConfig(available, stock.total);
                        const isFilteredOut =
                          selectedWarehouseFilter !== "ALL" &&
                          stock.warehouseId !== selectedWarehouseFilter;

                        return (
                          <div
                            key={stock.warehouseId}
                            className={`flex flex-col p-2.5 rounded-lg border text-xs transition duration-200 ${
                              isFilteredOut
                                ? "opacity-30 border-slate-900 bg-slate-950/20"
                                : `${config.bgColor}`
                            }`}
                          >
                            <div className="flex justify-between items-center gap-3 mb-1">
                              <span className="font-semibold text-slate-300 flex items-center gap-1">
                                <MapPin className="w-3 h-3 text-slate-500" />
                                {stock.warehouse.name}
                              </span>
                              <span className={`font-bold tracking-wide ${config.textColor}`}>
                                {config.label}
                              </span>
                            </div>

                            {/* Progress stock bar */}
                            <div className="h-1 w-full bg-slate-950 rounded-full overflow-hidden mb-1">
                              <div
                                className={`h-full ${config.progressColor}`}
                                style={{
                                  width: `${
                                    stock.total > 0
                                      ? Math.min(100, (available / stock.total) * 100)
                                      : 0
                                  }%`,
                                }}
                              />
                            </div>

                            <div className="flex justify-between items-center text-[10px] text-slate-500">
                              <span>Physical total: {stock.total}</span>
                              <span>Hold holds: {stock.reserved} units</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* CTA Reserve Trigger */}
                  <button
                    onClick={() => openReserveModal(product)}
                    disabled={!hasStock}
                    className={`mt-auto w-full py-3 px-4 rounded-xl text-xs font-bold transition duration-200 flex items-center justify-center gap-2 cursor-pointer ${
                      hasStock
                        ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/10 active:scale-[0.98]"
                        : "bg-slate-900 border border-slate-800 text-slate-600 cursor-not-allowed"
                    }`}
                  >
                    <ShoppingCart className="w-4 h-4" />
                    {hasStock ? "Reserve & Proceed to Checkout" : "Out of Stock"}
                  </button>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Gorgeous Custom Modal for Allocation Selection */}
        <AnimatePresence>
          {isModalOpen && selectedProduct && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="relative bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full shadow-2xl p-6 overflow-hidden"
              >
                {/* Close Button */}
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="absolute top-4 right-4 p-1.5 bg-slate-950/40 text-slate-400 hover:text-slate-200 border border-slate-850 hover:border-slate-750 rounded-lg transition"
                >
                  <X className="w-4 h-4" />
                </button>

                <h3 className="font-extrabold text-xl text-slate-100 mb-2">
                  Stock Reservation Setup
                </h3>
                <p className="text-xs text-indigo-400 font-medium mb-5">
                  Hold window: 10 Minutes • Safe from double-selling
                </p>

                {/* Selected Item Summary */}
                <div className="bg-slate-950/40 p-4 border border-slate-850 rounded-xl mb-5 flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-lg flex items-center justify-center">
                    <Package className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-xs text-slate-200">{selectedProduct.name}</h4>
                    <span className="text-[10px] text-slate-500 font-mono">
                      Unit price: {formatPrice(selectedProduct.price)}
                    </span>
                  </div>
                </div>

                {/* Form fields */}
                <div className="space-y-4">
                  {/* Warehouse picker */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-2">
                      Select Warehouse Location
                    </label>
                    <select
                      value={reserveWarehouseId}
                      onChange={(e) => {
                        setReserveWarehouseId(e.target.value);
                        setReserveUnits(1);
                        setReserveError(null);
                      }}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl text-xs px-3 py-3 text-slate-200 focus:outline-none focus:border-indigo-500"
                    >
                      {selectedProduct.stocks
                        .filter((s) => s.total - s.reserved > 0)
                        .map((stock) => (
                          <option key={stock.warehouseId} value={stock.warehouseId}>
                            {stock.warehouse.name} ({stock.total - stock.reserved} available)
                          </option>
                        ))}
                    </select>
                  </div>

                  {/* Quantity slider */}
                  {reserveWarehouseId && (
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <label className="text-xs font-semibold text-slate-400">
                          Select Quantity (Units)
                        </label>
                        <span className="text-xs font-bold text-indigo-400">
                          {reserveUnits} Unit{reserveUnits > 1 ? "s" : ""}
                        </span>
                      </div>

                      {/* Numeric Incrementor */}
                      <div className="flex items-center gap-3 bg-slate-950 border border-slate-800 rounded-xl p-1.5 w-max">
                        <button
                          type="button"
                          onClick={() => setReserveUnits((u) => Math.max(1, u - 1))}
                          className="w-8 h-8 flex items-center justify-center bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-300 hover:text-slate-100 hover:bg-slate-800 font-bold"
                        >
                          -
                        </button>
                        <span className="w-8 text-center text-xs font-extrabold text-slate-200">
                          {reserveUnits}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const stockObj = selectedProduct.stocks.find(
                              (s) => s.warehouseId === reserveWarehouseId
                            );
                            const maxUnits = stockObj ? stockObj.total - stockObj.reserved : 1;
                            setReserveUnits((u) => Math.min(maxUnits, u + 1));
                          }}
                          className="w-8 h-8 flex items-center justify-center bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-300 hover:text-slate-100 hover:bg-slate-800 font-bold"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Error Panel */}
                  <AnimatePresence>
                    {reserveError && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="p-3 bg-rose-950/40 border border-rose-900/30 text-rose-300 rounded-xl text-xs flex gap-2.5 items-start"
                      >
                        <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                        <div>{reserveError}</div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Pricing Total Summary */}
                  {reserveWarehouseId && (
                    <div className="pt-2 border-t border-slate-800/80 flex justify-between items-center">
                      <span className="text-xs text-slate-400">Total Price:</span>
                      <span className="text-lg font-black text-emerald-400">
                        {formatPrice(selectedProduct.price * reserveUnits)}
                      </span>
                    </div>
                  )}

                  {/* Action reserve hold button */}
                  <button
                    onClick={handleReserve}
                    disabled={reserveLoading || !reserveWarehouseId}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98] transition disabled:opacity-50 text-white font-bold text-xs py-3 px-4 rounded-xl flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-indigo-600/15"
                  >
                    {reserveLoading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Locking stock allocation...
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4" />
                        Establish Reservation Hold
                      </>
                    )}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
