# Allo Multi-Warehouse Inventory & Stock Reservation System

An end-to-end, high-performance, and race-condition-free inventory allocation and checkout-reservation platform built using **Next.js (App Router)**, **Prisma**, **TypeScript**, **PostgreSQL**, and **Framer Motion**.

---

## 🚀 Architectural Design & Concurrency Strategy

When checkout is initiated, brands face a classic race condition: payment flows (3DS redirect, UPI confirmation, card processing) can take minutes. If we decrement stock at payment time, we risk overselling; if we decrement at add-to-cart time, inventory looks artificially depleted due to high cart abandonment rates.

This system resolves the problem using **temporary reservation holds (10-minute holds)**.

### 🛡️ Concurrency Control via Pessimistic Row-Level Locking
To prevent double-selling a physical unit when multiple concurrent checkout requests hit the last unit of stock in a millisecond, the reservation system employs **PostgreSQL Row-Level Locks (`SELECT ... FOR UPDATE`)** inside interactive database transactions.

```mermaid
sequenceDiagram
    autonumber
    actor Customer_A as Shopper A (Request 1)
    actor Customer_B as Shopper B (Request 2)
    participant Database as Postgres (Stock Table)
    
    Customer_A->>Database: BEGIN Transaction & SELECT FOR UPDATE (SKU-001, SF)
    Note over Database: Row lock acquired on (SKU-001, SF) by Shopper A
    Customer_B->>Database: BEGIN Transaction & SELECT FOR UPDATE (SKU-001, SF)
    Note over Database: Shopper B transaction BLOCKED, waiting for lock...
    
    Customer_A->>Database: Compute available stock (total - reserved >= units) -> OK
    Customer_A->>Database: Create Reservation (PENDING)
    Customer_A->>Database: Update Stock (increment reserved by units)
    Customer_A->>Database: COMMIT Transaction (Lock Released)
    
    Note over Database: Shopper B transaction wakes up & resumes
    Customer_B->>Database: Compute available stock (total - reserved >= units) -> EXHAUSTED (0 units left)
    Customer_B->>Database: ROLLBACK Transaction
    Customer_B->>Customer_B: Return 409 Conflict (Stock Exhausted)
```

1. **Transaction Isolation**: During a reservation request, the system issues a raw SQL query `SELECT * FROM "Stock" WHERE "productId" = $1 AND "warehouseId" = $2 FOR UPDATE`.
2. **Blocking Writes**: This blocks any concurrent transaction trying to read the same row `FOR UPDATE` or write to it.
3. **Double Selling Prevented**: The second transaction blocks and waits until the first commits, at which point it reads the updated reserved count and correctly fails with a `409 Conflict`.

---

## ⚡ Idempotency Protocol

To prevent double-selling or duplicate charges on network retries, both **Reserve** and **Confirm** endpoints support an `Idempotency-Key` header:

1. **Reserve (`POST /api/reservations`)**: 
   When a request is received, the server checks the `idempotencyKey` against existing reservations. If a reservation is found, the server returns the cached reservation details immediately with an `X-Cache-Lookup: HIT` header without re-allocating stock.
2. **Confirm (`POST /api/reservations/:id/confirm`)**: 
   If a client retries a confirm request (e.g. on UPI redirect callbacks), and the reservation is already marked as `CONFIRMED`, the server replays a successful confirmation receipt without double-decrementing physical inventory.

---

## ⏰ Dynamic Reservation Expiry

The system employs a **dual-layer expiration cleanup strategy** to ensure expired holds return to available stock:

1. **Lazy Expiration on Read (Primary)**:
   Whenever a product listing (`GET /api/products`) or new reservation is requested, a background service runs to find all pending reservations where `expiresAt < now`. These are atomic transactions that update reservation statuses to `RELEASED` and decrement `Stock.reserved`. This guarantees that customers always see 100% accurate, real-time stock numbers on the page without depending on a cron runner.
2. **Periodic Cleanup Worker (`/api/cleanup`)**:
   A dedicated dynamic endpoint that can be called periodically (e.g. every minute) by a **Vercel Cron** or background schedule worker to clean up lingering expired holds in production.

---

## 📊 Database Models

```
 +------------------+           +------------------+           +----------------------+
 |     Product      |           |    Warehouse     |           |        Stock         |
 +------------------+           +------------------+           +----------------------+
 | id: String (PK)  |<----+     | id: String (PK)  |<----+     | productId: String(PK)|--+
 | sku: String (UQ) |     |     | name: String     |     |     | warehouseId:Str (PK) |--|--> Product
 | name: String     |     |     | location: String |     |     | total: Int           |  +--> Warehouse
 | price: Int       |     |     +------------------+     |     | reserved: Int        |
 +------------------+     |                              |     +----------------------+
          |               |                              |
          |               |     +------------------+     |
          +--------------|---->|   Reservation    |<----+
                          |     +------------------+
                          |     | id: String (PK)  |
                          +-----| productId: String|
                                | warehouseId: Str |
                                | units: Int       |
                                | status: Enum     |
                                | expiresAt: Date  |
                                | idempotencyKey:S |
                                +------------------+
```

---

## 🛠️ Running the App Locally

### Prerequisites
- **Node.js** (v18+)
- **Docker** and **Docker Compose**

### 1. Spin up Local Database & Redis
Start the PostgreSQL and Redis development containers using our pre-configured Docker Compose file:
```bash
docker compose up -d
```
*Note: Postgres is mapped to port `5435` locally to prevent collisions with any native PostgreSQL running on your machine.*

### 2. Configure Environment
Create a `.env` file in the root directory (already populated with local Docker configurations by default):
```env
DATABASE_URL="postgresql://postgres:postgrespassword@localhost:5435/allo_db?schema=public"
REDIS_URL="redis://localhost:6379"
RESERVATION_EXPIRY_MINUTES=10
```

### 3. Install Dependencies & Build Client
```bash
npm install
npx prisma generate
```

### 4. Run Migrations & Database Seed
Run the Prisma migrations to create the tables, and seed the database with mock products, warehouses, and starting stock levels:
```bash
npx prisma migrate dev --name init
npx tsx prisma/seed.ts
```

### 5. Launch the Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the premium dashboard.

---

## 🧪 Concurrency Lock Validation Test

We have provided a automated concurrency test script `scripts/test-concurrency.ts` that resets the stock of our curved monitor in the SF warehouse to exactly **1 unit**, and fires **10 concurrent reservation promises** simultaneously to check for race conditions.

To execute the concurrency test:
```bash
npx tsx scripts/test-concurrency.ts
```

### Expected Output:
```text
🧪 Starting Concurrency Lock Validation Test...
🔄 Resetting target stock to exactly 1 physical unit...
⚡ Firing 10 concurrent reservation requests for the last physical unit...

📊 CONCURRENCY TRANSACTION REPORT:
----------------------------------------------------------------------
[Request #01] ✅ SUCCESS - Hold Established (ID: cmpi9d9y40000moffq4qseqa9)
[Request #02] ❌ FAILED  - Error Code: INSUFFICIENT_STOCK
[Request #03] ❌ FAILED  - Error Code: INSUFFICIENT_STOCK
[Request #04] ❌ FAILED  - Error Code: INSUFFICIENT_STOCK
[Request #05] ❌ FAILED  - Error Code: INSUFFICIENT_STOCK
[Request #06] ❌ FAILED  - Error Code: INSUFFICIENT_STOCK
[Request #07] ❌ FAILED  - Error Code: INSUFFICIENT_STOCK
[Request #08] ❌ FAILED  - Error Code: INSUFFICIENT_STOCK
[Request #09] ❌ FAILED  - Error Code: INSUFFICIENT_STOCK
[Request #10] ❌ FAILED  - Error Code: INSUFFICIENT_STOCK
----------------------------------------------------------------------

📈 TESTING SYSTEM ASSERTIONS:
- Success count: 1 (Expected: 1)
- Failure count: 9 (Expected: 9)
- Stock remaining total: 1 (Expected: 1)
- Stock reserved: 1 (Expected: 1)

🎉 CONCURRENCY LOCK TEST PASSED SUCCESSFULLY!
PostgreSQL row-level locks verified to be 100% race-condition-free.
```

---

## 🔮 Trade-offs & Production Scaling

If this system were scaled to support tens of thousands of requests per second, a few architectural adjustments would be made:

1. **Database Connection Pooling**: PostgreSQL row-level locks keep transactions open during evaluation. Under extreme traffic, we would add **PgBouncer** or use a serverless connection pool (like Neon Connection Pooling) to handle the surge in active database connections.
2. **Distributed Locks via Redis (Redlock)**: While PostgreSQL row-level locks are 100% reliable and transactional, they bind database resources. For massive global scale, we could offload the lock acquisition to a Redis-based distributed locking mechanism (`ioredis`/Upstash) before committing the transaction to the database, reducing Postgres load.
3. **Queueing (Message Broker)**: For high-demand flash sales (e.g. ticket launches), we would place checkout requests into a high-throughput message queue (e.g. BullMQ on Redis or RabbitMQ) and process them sequentially via worker groups. This turns sharp spike traffic into a steady stream, preventing database saturation.
