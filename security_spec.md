# Security Specification & Payload-First TDD (`ID Sistema`)

## 1. Data Invariants

1. **Platform Admin Exclusivity**: Only an authenticated Google user with `request.auth.token.email_verified == true && request.auth.token.email == 'lucivan.silva@gmail.com'` (or an active verified entry in `/platformAdmins/{uid}`) can create establishments (`/businesses`, `/businessAccess`), view cross-tenant workspace data, open `/supportSessions`, or reply on the `platform` side of support tickets.
2. **Strict Tenant Isolation (Zero-Trust)**: Every tenant document lives strictly under `/businesses/{businessId}/...`. Access requires `isBusinessMember(businessId)` (verified via `/businesses/{businessId}/members/{request.auth.uid}` with `active == true`), except sanitized public catalog reads (`/publicSettings/menu`, `/publicProducts`) and audited Platform Admin support.
3. **Anti-Spoofing Email Rule**: Because staff log in with deterministic synthetic emails (`<username>.<code>@idsistema.invalid`, `email_verified == false`), `isPlatformAdmin()` MUST strictly enforce `request.auth.token.email_verified == true`. No business-level rule relies on unverified email strings; member lookup always resolves strictly by `request.auth.uid`.
4. **Role & Privilege Separation**:
   - **Self-Update Guard**: A non-admin member updating `/businesses/{businessId}/members/{uid}` can ONLY update `mustChangePassword: false` (+ `updatedAt`) or `lastSeenAt` (+ `updatedAt`) on their own document. A user can NEVER alter their own `role`, `permissions`, `active`, `isOwner`, or `businessId`.
   - **Waiter Restriction**: `waiter` CANNOT read or write `cashSessions`, `ledger`, `accounts`, `suppliers`, `purchases`, `returns`, `inventoryItems` (which hold unit costs), or `customers` (which hold PII), and CANNOT close orders (`state: 'closed'`), apply discounts, or alter `totalCents` downward on existing orders without adding items.
   - **Cashier Restriction**: `cashier` CANNOT modify `settings`, `profiles`, `members`, `accounts`, `suppliers`, `purchases`, or `inventoryItems`.
   - **PII & Cost Isolation**: Public menu (`/publicSettings`, `/publicProducts`) excludes CNPJ, legalName, staff names, customer PII, and `costCents`. Waiters cannot access `/customers` or `/inventoryItems` unit costs.
5. **Immutable & Terminal State Locking**:
   - `auditLogs` and `inventoryMoves` and `returns` are append-only (`update, delete` denied).
   - `orders` with `state in ['closed', 'cancelled']` cannot be reopened or modified (except authorized cashier/admin version bump when recording a linked `saleReturn` on a closed order).
   - `cashSessions` with `state == 'closed'` and `accounts` with `state == 'settled'` and `purchases` with `state == 'received'` are terminal and cannot be modified.
   - Immutable fields (`id`, `createdAt`, `actorId`, `ownerId`, `businessId`, `requestKey`) cannot be changed after creation.
6. **Temporal & Volumetric Integrity**:
   - `createdAt` must equal `request.time` on creation; `updatedAt` must equal `request.time` on writes.
   - Strict `keys().hasAll(...) && keys().hasOnly(...)` on `create`, strict `affectedKeys().hasOnly(...)` on every named update branch, `isValidId()` on document IDs, and bounded `.size()` on every string, list, and media asset (`dataUrl <= 450000` bytes).
7. **Zero-Cost List Query Safety**: `allow list` rules NEVER use `get()` or `exists()` per scanned document; public menu list enforces `resource.data.visible == true`, `drafts` list enforces `resource.data.ownerId == request.auth.uid`, and tenant subcollections authorize via `businessId` path scoping or non-DB token checks.

---

## 2. The "Dirty Dozen" Attack Payloads (All Must Return `PERMISSION_DENIED`)

1. **Unverified Admin Email Spoof (`isPlatformAdmin` bypass)**:
   - Actor: Auth token with `{ email: "lucivan.silva@gmail.com", email_verified: false }`.
   - Target: `POST /businesses/biz_evil`
   - Expected: `PERMISSION_DENIED`.
2. **Self-Privilege Escalation on Member Doc**:
   - Actor: `waiter` (`uid: "u_waiter"`) in `biz_1`.
   - Target: `PATCH /businesses/biz_1/members/u_waiter` with `{ role: "admin", permissions: { "cash.access": true }, updatedAt: serverTimestamp() }`
   - Expected: `PERMISSION_DENIED`.
3. **Shadow / Ghost Field Injection on Order Creation**:
   - Actor: `waiter` in `biz_1`.
   - Target: `POST /businesses/biz_1/orders/ord_1` with valid required fields plus `"isAdminBypass": true`.
   - Expected: `PERMISSION_DENIED`.
4. **Cross-Tenant Read/Write Hop**:
   - Actor: `admin` of `biz_1` (`uid: "u_owner1"`).
   - Target: `GET /businesses/biz_2/orders/ord_99` or `POST /businesses/biz_2/products/prod_x`.
   - Expected: `PERMISSION_DENIED`.
5. **Waiter Trying to Close/Pay an Order or Open Cash Register**:
   - Actor: `waiter` in `biz_1`.
   - Target: `POST /businesses/biz_1/cashSessions/cs_1` OR `PATCH /businesses/biz_1/orders/ord_1` setting `{ state: "closed", closedAt: serverTimestamp() }`.
   - Expected: `PERMISSION_DENIED`.
6. **Waiter Reading Customer PII or Inventory Unit Costs**:
   - Actor: `waiter` in `biz_1`.
   - Target: `GET /businesses/biz_1/customers/cust_1` OR `GET /businesses/biz_1/inventoryItems/inv_1`.
   - Expected: `PERMISSION_DENIED`.
7. **Terminal State Mutation (Reopening a Closed Order / Settled Account)**:
   - Actor: `cashier` or `admin` in `biz_1`.
   - Target: `PATCH /businesses/biz_1/orders/ord_closed` with `{ state: "open" }` OR `PATCH /businesses/biz_1/cashSessions/cs_closed` with `{ state: "open" }`.
   - Expected: `PERMISSION_DENIED`.
8. **Client-Forged Timestamp**:
   - Actor: `admin` in `biz_1`.
   - Target: `POST /businesses/biz_1/products/prod_backdated` with `createdAt: "2020-01-01T00:00:00Z"` instead of `request.time`.
   - Expected: `PERMISSION_DENIED`.
9. **Denial-of-Wallet Document ID Poisoning / Oversized Media**:
   - Actor: `admin` in `biz_1`.
   - Target: `POST /businesses/biz_1/products/${"a".repeat(200)}` OR `POST /businesses/biz_1/media/m1` with `dataUrl` > 450,000 chars.
   - Expected: `PERMISSION_DENIED`.
10. **Cashier Escalating to Platform or Financial Management (`accounts` / `settings`)**:
    - Actor: `cashier` in `biz_1`.
    - Target: `POST /businesses/biz_1/accounts/acc_1` OR `PUT /businesses/biz_1/settings/main`.
    - Expected: `PERMISSION_DENIED`.
11. **Public Unauthenticated Scraping of `businessAccess` List or Internal Products**:
    - Actor: Unauthenticated client (`request.auth == null`).
    - Target: `LIST /businessAccess` OR `GET /businesses/biz_1/products/prod_1`.
    - Expected: `PERMISSION_DENIED`.
12. **Audit Log / Ledger Tampering or Deletion**:
    - Actor: `admin` in `biz_1`.
    - Target: `DELETE /businesses/biz_1/auditLogs/aud_1` OR `DELETE /businesses/biz_1/ledger/led_1`.
    - Expected: `PERMISSION_DENIED`.
