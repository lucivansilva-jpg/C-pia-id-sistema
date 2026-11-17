import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const clientCode = fs.readFileSync(new URL('../web/firebase-client.js', import.meta.url), 'utf8');
const apiCode = fs.readFileSync(new URL('../web/system/firebase-api.js', import.meta.url), 'utf8');

class FakeTimestamp {
  constructor(ms) {
    this._ms = ms;
  }
  toDate() {
    return new Date(this._ms);
  }
  toMillis() {
    return this._ms;
  }
  static now() {
    return new FakeTimestamp(clockMs);
  }
  static fromDate(d) {
    return new FakeTimestamp(d.getTime());
  }
}

let beforeTransactionHook=null;
const SERVER_TS = Symbol('serverTimestamp');
let clockMs = Date.parse('2026-11-16T12:00:00.000Z');
const tickClock = () => {
  clockMs += 10;
  return new FakeTimestamp(clockMs);
};

function cloneValue(val) {
  if (val === SERVER_TS) return val;
  if (val instanceof FakeTimestamp) return new FakeTimestamp(val._ms);
  if (Array.isArray(val)) return val.map(cloneValue);
  if (val && typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) out[k] = cloneValue(v);
    return out;
  }
  return val;
}

function resolveTimestamps(val, nowTs) {
  if (val === SERVER_TS) return nowTs;
  if (val instanceof FakeTimestamp) return new FakeTimestamp(val._ms);
  if (Array.isArray(val)) return val.map((x) => resolveTimestamps(x, nowTs));
  if (val && typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) out[k] = resolveTimestamps(v, nowTs);
    }
    return out;
  }
  return val;
}

function getField(obj, field) {
  if (!obj) return undefined;
  return field.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}

function cmpValues(a, b) {
  const va = a instanceof FakeTimestamp ? a.toMillis() : a;
  const vb = b instanceof FakeTimestamp ? b.toMillis() : b;
  if (va === vb) return 0;
  if (va == null) return -1;
  if (vb == null) return 1;
  return va < vb ? -1 : 1;
}

function createDocSnap(path, data) {
  return {
    id: path.split('/').pop(),
    ref: { path, id: path.split('/').pop() },
    exists: () => data !== undefined,
    data: () => (data === undefined ? undefined : cloneValue(data))
  };
}

// Stateful Firestore Simulator with Read-Before-Write enforcement, OCC retries, and RBAC checks
const store = new Map();
const versions = new Map();
let readCount = 0;

function readRaw(path) {
  const rec = store.get(path);
  return rec === undefined ? undefined : cloneValue(rec);
}

function permError(msg = 'Missing or insufficient permissions.') {
  const err = new Error(
    String(msg).includes('Missing or insufficient permissions')
      ? msg
      : `Missing or insufficient permissions: ${msg}`
  );
  err.code = 'permission-denied';
  return err;
}

function currentActor() {
  const acct = globalThis.ERP_ACCOUNT;
  return {
    platform: !!acct?.platform,
    businessId: acct?.business?.id || null,
    user: acct?.user || null,
    hasPerm(p) {
      return globalThis.IDFirebase.hasPermission(acct?.user, p);
    }
  };
}

function isRetailBiz(businessId) {
  return store.get(`businesses/${businessId}/settings/main`)?.businessKind === 'retail';
}

function parseBizPath(path) {
  const parts = path.split('/');
  if (parts[0] !== 'businesses' || !parts[1]) return null;
  return {
    businessId: parts[1],
    sub: parts[2] || null,
    docId: parts[3] || null,
    rest: parts.slice(4)
  };
}

function checkRuleRead(path, docData) {
  if (path === 'test/connection') return;
  const p = parseBizPath(path);
  if (!p) return;
  const actor = currentActor();
  if (!actor.user || actor.businessId !== p.businessId) throw permError(`Cross-tenant read denied: ${path}`);
  if (p.sub === 'tables' && isRetailBiz(p.businessId)) {
    throw permError('Retail mode forbids reading tables');
  }
  if (p.sub === 'products' && p.rest[0] === 'private' && p.rest[1] === 'cost') {
    if (!actor.hasPerm('products.costs')) throw permError(`Private cost read denied for ${actor.user.role}`);
  }
  if (p.sub === 'orders' && docData) {
    if (!actor.hasPerm('orders.shared') && !(actor.hasPerm('orders.read') && docData.actorId === actor.user.id)) {
      throw permError(`Order read denied for ${actor.user.id} on actorId=${docData.actorId}`);
    }
  }
  if (p.sub === 'cashSessions' && !actor.hasPerm('cash.access')) {
    throw permError('Cash session read denied');
  }
}

function checkRuleWrite(path, incoming, existing, isCreate) {
  if (path.startsWith('userBusinesses/')) {
    const actor = currentActor();
    const targetBiz = existing?.businessId || incoming?.businessId;
    if (isRetailBiz(targetBiz) && incoming?.role === 'waiter' && !(existing?.role === 'waiter' && incoming?.active === false)) {
      throw permError('Retail mode forbids waiter userBusinesses');
    }
    return;
  }
  const p = parseBizPath(path);
  if (!p) return;
  const actor = currentActor();
  if (!actor.user || actor.businessId !== p.businessId) throw permError(`Cross-tenant write denied: ${path}`);
  const retail = isRetailBiz(p.businessId);

  if (p.sub === 'settings' && p.docId === 'main' && incoming && !actor.platform) {
    const prevKind = existing?.businessKind ?? null;
    if (isCreate && incoming.businessKind !== 'food') throw permError('Tenant cannot choose retail businessKind on create');
    if (!isCreate && ((prevKind != null && incoming.businessKind !== prevKind) || (prevKind == null && incoming.businessKind !== 'food'))) {
      throw permError('Tenant cannot alter businessKind');
    }
  }
  if (p.sub === 'tables' && retail) throw permError('Retail mode forbids tables');
  if (p.sub === 'locks' && /^table_\d+$/.test(p.docId || '') && retail && incoming?.active === true) {
    throw permError('Retail mode forbids table locks');
  }
  if (p.sub === 'recipes' && retail) {
    const validUnitLink = incoming && Array.isArray(incoming.items) && incoming.items.length === 1 && incoming.items[0]?.quantityMilli === 1000;
    if (incoming !== null && !validUnitLink) throw permError('Retail mode forbids multi-ingredient recipes');
  }
  if (p.sub === 'profiles' && p.docId === 'waiter' && retail && !actor.platform) {
    throw permError('Retail mode forbids waiter profile writes');
  }
  if (p.sub === 'members' && retail && incoming?.role === 'waiter' && !(existing?.role === 'waiter' && incoming?.active === false)) {
    throw permError('Retail mode forbids waiter members');
  }

  if (p.sub === 'products' && p.rest.length === 0) {
    if (!actor.hasPerm('products.manage')) throw permError('Product manage denied');
    if (retail && incoming?.stockMode === 'recipe' && existing?.stockMode !== 'recipe') {
      throw permError('Retail mode forbids recipe stockMode');
    }
    if (incoming && Object.hasOwn(incoming, 'costCents')) {
      throw permError('Schema violation: costCents forbidden on main product doc');
    }
    if (Array.isArray(incoming?.addons) && incoming.addons.some((a) => Object.hasOwn(a, 'cost_cents'))) {
      throw permError('Schema violation: addon cost_cents forbidden on main product doc');
    }
  }
  if (p.sub === 'products' && p.rest[0] === 'private' && p.rest[1] === 'cost') {
    if (!actor.hasPerm('products.costs')) throw permError('Private cost write denied');
  }
  if (p.sub === 'cashSessions') {
    if (isCreate && !actor.hasPerm('cash.open')) throw permError('cash.open denied');
    if (isCreate) {
      const lock = store.get(`businesses/${p.businessId}/locks/activeCashSession`);
      if (lock && lock.active === true) throw permError('activeCashSession lock already active');
    }
    if (!isCreate && incoming?.cashBalanceCents != null && incoming.cashBalanceCents < 0) {
      throw permError('cashBalanceCents cannot be negative');
    }
  }
  if (p.sub === 'inventoryStock') {
    if (incoming.balanceMilli < 0) throw permError('inventoryStock balanceMilli cannot be negative');
    if (!isCreate && !actor.hasPerm('reports.view') && !actor.hasPerm('payments.refund')) {
      if (!(actor.hasPerm('orders.create') || actor.hasPerm('orders.update') || actor.hasPerm('payments.receive'))) {
        throw permError('inventoryStock update denied');
      }
      if (incoming.balanceMilli > (existing?.balanceMilli ?? 0)) {
        throw permError('Non-manager cannot increase inventoryStock');
      }
    }
  }
  if (p.sub === 'inventoryMoves' && incoming.quantityMilli === 0) {
    throw permError('inventoryMoves quantityMilli cannot be zero');
  }
  if (p.sub === 'idempotency' && !isCreate) {
    throw permError('idempotency is create-only');
  }
  if (p.sub === 'orders' && incoming) {
    if (retail && isCreate && (incoming.state !== 'closed' || incoming.tableNumber != null)) {
      throw permError('Retail mode forbids open/table orders');
    }
    if (retail && !isCreate && existing && Array.isArray(incoming.items) && JSON.stringify(incoming.items) !== JSON.stringify(existing.items)) {
      throw permError('Retail mode forbids order item edits');
    }
    if ((incoming.paidCents ?? 0) > incoming.totalCents) {
      throw permError('paidCents cannot exceed totalCents');
    }
  }
}

function checkAtomicTransactionInvariants(staged) {
  const actor = currentActor();
  for (const s of staged) {
    const p = parseBizPath(s.path);
    if (!p || !s.next) continue;
    const prev = readRaw(s.path);
    if (p.sub === 'orders' && p.rest.length === 0) {
      const prevPaid = prev?.paidCents ?? 0;
      const nextPaid = s.next.paidCents ?? 0;
      const delta = nextPaid - prevPaid;
      if (delta > 0) {
        const lid = s.next.lastLedgerId;
        if (!lid) throw permError('Order marked paid without lastLedgerId');
        const ledPath = `businesses/${p.businessId}/ledger/${lid}`;
        if (store.has(ledPath)) throw permError('lastLedgerId must reference a brand-new ledger document');
        const ledStaged = staged.find((x) => x.path === ledPath)?.next;
        if (
          !ledStaged ||
          ledStaged.kind !== 'sale' ||
          ledStaged.orderId !== p.docId ||
          ledStaged.actorId !== actor.user.id ||
          ledStaged.amountCents <= 0 ||
          (!s.next.exchangeFromOrderId && ledStaged.amountCents !== delta)
        ) {
          throw permError('Order marked paid without matching atomic sale ledger entry');
        }
        const csPath = `businesses/${p.businessId}/cashSessions/${ledStaged.sessionId}`;
        const csPrev = readRaw(csPath);
        const csStaged = staged.find((x) => x.path === csPath)?.next;
        if (!csPrev || csPrev.state !== 'open' || !csStaged || csStaged.version !== (csPrev.version || 1) + 1) {
          throw permError('Order payment ledger missing open cashSession atomic update');
        }
      }
    }
  }
}

const fakeDb = { __fake: true };
const fakeAuth = { currentUser: null };

function buildRef(base, ...segments) {
  const path = typeof base === 'string' ? [base, ...segments].join('/') : [base.path, ...segments].join('/');
  return { path, id: path.split('/').pop(), __isRef: true };
}

const sdk = {
  FIREBASE_CONFIG: { projectId: 'test', firestoreDatabaseId: '(default)' },
  initializeApp: () => ({}),
  deleteApp: async () => {},
  getAuth: () => fakeAuth,
  GoogleAuthProvider: class {},
  signInWithPopup: async () => {},
  signInWithEmailAndPassword: async () => {},
  createUserWithEmailAndPassword: async () => ({ user: { uid: 'new_uid' } }),
  updatePassword: async () => {},
  signOut: async () => {},
  onAuthStateChanged: () => () => {},
  getFirestore: () => fakeDb,
  doc: (_dbOrPath, ...segs) => buildRef(...segs),
  collection: (_dbOrPath, ...segs) => buildRef(...segs),
  collectionGroup: (_db, name) => ({ __collectionGroup: name }),
  where: (field, op, value) => ({ __type: 'where', field, op, value }),
  orderBy: (field, dir = 'asc') => ({ __type: 'orderBy', field, dir }),
  limit: (n) => ({ __type: 'limit', n }),
  query: (colRef, ...constraints) => ({ __type: 'query', colRef, constraints }),
  serverTimestamp: () => SERVER_TS,
  Timestamp: FakeTimestamp,
  documentId: () => '__name__',
  async getDoc(ref) {
    readCount += 1;
    const raw = readRaw(ref.path);
    checkRuleRead(ref.path, raw);
    return createDocSnap(ref.path, raw);
  },
  async getDocFromServer(ref) {
    return sdk.getDoc(ref);
  },
  async getDocs(qOrCol) {
    const colPath = qOrCol.__type === 'query' ? qOrCol.colRef.path : qOrCol.path;
    const constraints = qOrCol.__type === 'query' ? qOrCol.constraints : [];
    const prefix = colPath + '/';
    let rows = [];
    for (const [k, v] of store.entries()) {
      if (!k.startsWith(prefix)) continue;
      const tail = k.slice(prefix.length);
      if (tail.includes('/')) continue;
      rows.push({ path: k, data: cloneValue(v) });
    }
    for (const c of constraints) {
      if (c.__type === 'where') {
        rows = rows.filter((r) => {
          const val = c.field === '__name__' ? r.path.split('/').pop() : getField(r.data, c.field);
          const cmp = cmpValues(val, c.value);
          if (c.op === '==') return cmp === 0;
          if (c.op === '!=') return cmp !== 0;
          if (c.op === '<') return cmp < 0;
          if (c.op === '<=') return cmp <= 0;
          if (c.op === '>') return cmp > 0;
          if (c.op === '>=') return cmp >= 0;
          if (c.op === 'in') return Array.isArray(c.value) && c.value.some((x) => cmpValues(val, x) === 0);
          return true;
        });
      }
    }
    for (const r of rows) checkRuleRead(r.path, r.data);
    for (const c of constraints) {
      if (c.__type === 'orderBy') {
        rows.sort((a, b) => {
          const d = cmpValues(getField(a.data, c.field), getField(b.data, c.field));
          return c.dir === 'desc' ? -d : d;
        });
      }
    }
    for (const c of constraints) {
      if (c.__type === 'limit') rows = rows.slice(0, c.n);
    }
    readCount += rows.length;
    const docs = rows.map((r) => createDocSnap(r.path, r.data));
    return {
      empty: docs.length === 0,
      size: docs.length,
      docs,
      forEach: (fn) => docs.forEach(fn)
    };
  },
  async setDoc(ref, data) {
    const now = tickClock();
    const existing = readRaw(ref.path);
    const resolved = resolveTimestamps(data, now);
    checkRuleWrite(ref.path, resolved, existing, existing === undefined);
    checkAtomicTransactionInvariants([{ path: ref.path, next: resolved }]);
    store.set(ref.path, resolved);
    versions.set(ref.path, (versions.get(ref.path) || 0) + 1);
  },
  async updateDoc(ref, patch) {
    const now = tickClock();
    const existing = readRaw(ref.path);
    if (!existing) throw new Error(`Document missing for update: ${ref.path}`);
    const merged = { ...existing, ...resolveTimestamps(patch, now) };
    checkRuleWrite(ref.path, merged, existing, false);
    checkAtomicTransactionInvariants([{ path: ref.path, next: merged }]);
    store.set(ref.path, merged);
    versions.set(ref.path, (versions.get(ref.path) || 0) + 1);
  },
  async deleteDoc(ref) {
    const existing = readRaw(ref.path);
    checkRuleWrite(ref.path, null, existing, false);
    store.delete(ref.path);
    versions.set(ref.path, (versions.get(ref.path) || 0) + 1);
  },
  writeBatch() {
    const ops = [];
    return {
      set: (ref, data) => ops.push({ op: 'set', ref, data }),
      update: (ref, data) => ops.push({ op: 'update', ref, data }),
      delete: (ref) => ops.push({ op: 'delete', ref }),
      async commit() {
        for (const item of ops) {
          if (item.op === 'set') await sdk.setDoc(item.ref, item.data);
          else if (item.op === 'update') await sdk.updateDoc(item.ref, item.data);
          else await sdk.deleteDoc(item.ref);
        }
      }
    };
  },
  async runTransaction(_db, fn) {
    if(beforeTransactionHook){const hook=beforeTransactionHook;beforeTransactionHook=null;hook();}
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const readVersions = new Map();
      const writes = [];
      let hasWritten = false;
      const tx = {
        async get(ref) {
          if (hasWritten) {
            throw new Error(`Firestore transactions require all reads to be executed before all writes (failed on ${ref.path})`);
          }
          if (!readVersions.has(ref.path)) {
            readVersions.set(ref.path, versions.get(ref.path) || 0);
          }
          return sdk.getDoc(ref);
        },
        set(ref, data) {
          hasWritten = true;
          writes.push({ op: 'set', ref, data: cloneValue(data) });
        },
        update(ref, data) {
          hasWritten = true;
          writes.push({ op: 'update', ref, data: cloneValue(data) });
        },
        delete(ref) {
          hasWritten = true;
          writes.push({ op: 'delete', ref });
        }
      };

      const result = await fn(tx);

      // Optimistic Concurrency Control check at commit
      let conflict = false;
      for (const [path, snapVer] of readVersions.entries()) {
        if ((versions.get(path) || 0) !== snapVer) {
          conflict = true;
          break;
        }
      }
      if (conflict) {
        await new Promise((r) => setTimeout(r, 1));
        continue;
      }

      const now = tickClock();
      const staged = [];
      for (const w of writes) {
        const cur = staged.findLast((s) => s.path === w.ref.path)?.next ?? readRaw(w.ref.path);
        if (w.op === 'delete') {
          checkRuleWrite(w.ref.path, null, cur, false);
          staged.push({ path: w.ref.path, next: undefined });
        } else if (w.op === 'update') {
          if (!cur) throw new Error(`Missing doc for tx.update: ${w.ref.path}`);
          const next = { ...cur, ...resolveTimestamps(w.data, now) };
          checkRuleWrite(w.ref.path, next, cur, false);
          staged.push({ path: w.ref.path, next });
        } else {
          const next = resolveTimestamps(w.data, now);
          checkRuleWrite(w.ref.path, next, cur, cur === undefined);
          staged.push({ path: w.ref.path, next });
        }
      }
      checkAtomicTransactionInvariants(staged);
      for (const s of staged) {
        if (s.next === undefined) store.delete(s.path);
        else store.set(s.path, s.next);
        versions.set(s.path, (versions.get(s.path) || 0) + 1);
      }
      return result;
    }
    throw new Error('Transaction aborted after max OCC retries.');
  }
};

globalThis.window = globalThis;
globalThis.location = new URL('https://localhost:3000/system/');
globalThis.IDFirebaseSDK = sdk;

vm.runInThisContext(clientCode, { filename: 'web/firebase-client.js' });
vm.runInThisContext(apiCode, { filename: 'web/system/firebase-api.js' });

const api = globalThis.IDFirebaseApi;
const { effectivePermissions } = globalThis.IDFirebase;

function makeAccount(businessId, uid, name, role, overrides = {}, profilePerms = {}) {
  const perms = effectivePermissions({
    role,
    active: true,
    profile_permissions: profilePerms,
    permissions: overrides
  });
  return {
    platform: false,
    owner: role === 'admin',
    must_change_password: false,
    support: null,
    business: { id: businessId, name: `Loja ${businessId}`, code: businessId, active: true },
    user: {
      id: uid,
      name,
      username: uid,
      role,
      permissions: perms,
      raw_permissions: overrides,
      profile_permissions: profilePerms
    }
  };
}

function asAccount(account) {
  globalThis.ERP_ACCOUNT = account;
  fakeAuth.currentUser = account ? { uid: account.user.id, email: `${account.user.id}@test.local`, emailVerified: true } : null;
}

async function req(method, path, body) {
  const res = await api.fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, data: await res.json() };
}

function seedTenant(businessId, businessKind = 'food') {
  const ts = tickClock();
  store.set(`businesses/${businessId}`, {
    id: businessId,
    name: `Loja ${businessId}`,
    code: businessId,
    active: true,
    deleted: false,
    ownerUid: `admin_${businessId}`,
    ownerName: 'Admin',
    createdAt: ts,
    updatedAt: ts
  });
  const settingsDoc = {
    name: `Loja ${businessId}`,
    mode: 'complete',
    paper: 80,
    blindClose: false,
    updatedAt: ts
  };
  if (businessKind) settingsDoc.businessKind = businessKind;
  store.set(`businesses/${businessId}/settings/main`, settingsDoc);
  const roles = businessKind === 'retail'
    ? [['admin', 'Administrador'], ['cashier', 'Caixa']]
    : [['admin', 'Administrador'], ['cashier', 'Caixa'], ['waiter', 'Garçom']];
  for (const [role, name] of roles) {
    store.set(`businesses/${businessId}/profiles/${role}`, {
      role,
      name,
      permissions: {},
      version: 1,
      updatedAt: ts
    });
  }
}

seedTenant('biz_a', 'food');
seedTenant('biz_b', 'food');
seedTenant('biz_retail', 'retail');
seedTenant('biz_legacy', null);

const adminA = makeAccount('biz_a', 'admin_a', 'Admin A', 'admin');
const adminB = makeAccount('biz_b', 'admin_b', 'Admin B', 'admin');
const waiter1 = makeAccount('biz_a', 'waiter_1', 'Garçom 1', 'waiter');
const waiter2 = makeAccount('biz_a', 'waiter_2', 'Garçom 2', 'waiter');
const cashierNoCost = makeAccount('biz_a', 'cashier_1', 'Caixa 1', 'cashier');
const cashierNoManage = makeAccount('biz_a', 'cashier_2', 'Caixa Sem Prod', 'cashier', { 'products.manage': false });

console.log('=== Functional Tests against web/system/firebase-api.js ===');

// 1. Direct-cost product create + private/cost isolation + unit-stock read-before-write
{
  asAccount(adminA);
  const direct = await req('POST', '/api/products', {
    request_key: 'prod_direct_req_001',
    name: 'Suco Natural',
    price_cents: 900,
    cost_cents: 320,
    cost_mode: 'direct',
    stock_mode: 'none',
    sale_unit: 'un',
    active: true,
    available: true,
    visible: true,
    addons: [{ name: 'Hortelã', price_cents: 150, cost_cents: 45 }]
  });
  assert.equal(direct.status, 201, JSON.stringify(direct.data));
  const rawProd = store.get(`businesses/biz_a/products/${direct.data.id}`);
  assert.ok(rawProd, 'Main product doc must exist');
  assert.equal(Object.hasOwn(rawProd, 'costCents'), false, 'costCents MUST NOT exist on main product document');
  assert.equal(Object.hasOwn(rawProd.addons[0], 'cost_cents'), false, 'addon cost_cents MUST NOT exist on main product document');
  const privCost = store.get(`businesses/biz_a/products/${direct.data.id}/private/cost`);
  assert.equal(privCost.costCents, 320);
  assert.equal(privCost.addonCosts['Hortelã'], 45);

  // Admin reads product with direct cost from private/cost
  const adminList = await req('GET', '/api/products');
  assert.equal(adminList.status, 200);
  const foundAdmin = adminList.data.products.find((p) => p.id === direct.data.id);
  assert.equal(foundAdmin.cost_cents, 320);
  assert.equal(foundAdmin.addons[0].cost_cents, 45);

  // Unit-stock product creation tests prepareCounter + invRef + stockRef read-before-write
  const unitProd = await req('POST', '/api/products', {
    request_key: 'prod_unit_req_0001',
    name: 'Água 500ml',
    price_cents: 500,
    cost_cents: 120,
    cost_mode: 'direct',
    stock_mode: 'unit',
    sale_unit: 'un',
    active: true,
    available: true,
    visible: true,
    initial_stock: 2
  });
  assert.equal(unitProd.status, 201, JSON.stringify(unitProd.data));
  const rawUnit = store.get(`businesses/biz_a/products/${unitProd.data.id}`);
  assert.equal(rawUnit.stockMode, 'unit');
  assert.equal(store.get(`businesses/biz_a/inventoryStock/${rawUnit.finishedInventoryId}`).balanceMilli, 2000);

  // Waiter & Cashier without products.costs see redacted catalog & zero private/cost reads
  asAccount(waiter1);
  const waiterList = await req('GET', '/api/products');
  assert.equal(waiterList.status, 200, JSON.stringify(waiterList.data));
  const foundWaiter = waiterList.data.products.find((p) => p.id === direct.data.id);
  assert.equal(foundWaiter.cost_cents, undefined);
  assert.equal(foundWaiter.addons[0].cost_cents, undefined);

  // Cashier with products.manage & NO products.costs updates price without wiping private/cost
  asAccount(cashierNoCost);
  const updPrice = await req('PUT', `/api/products/${direct.data.id}`, {
    name: 'Suco Natural',
    price_cents: 950,
    cost_mode: 'direct',
    stock_mode: 'none',
    sale_unit: 'un',
    active: true,
    available: true,
    visible: true,
    version: 1,
    addons: [{ name: 'Hortelã', price_cents: 150 }]
  });
  assert.equal(updPrice.status, 200, JSON.stringify(updPrice.data));
  assert.equal(store.get(`businesses/biz_a/products/${direct.data.id}/private/cost`).costCents, 320);

  // Cashier WITHOUT products.manage is blocked from price update
  asAccount(cashierNoManage);
  const deniedPrice = await req('PUT', `/api/products/${direct.data.id}`, {
    name: 'Suco Barato',
    price_cents: 100,
    cost_mode: 'direct',
    stock_mode: 'none',
    sale_unit: 'un',
    active: true,
    available: true,
    visible: true,
    version: 2
  });
  assert.equal(deniedPrice.status, 403);
  console.log('PASS [1] Product create/update, read-before-write, cost isolation & permission enforcement');
}

// 2. Cross-tenant isolation check
{
  asAccount(adminB);
  await assert.rejects(
    () => sdk.getDoc(sdk.doc(fakeDb, 'businesses', 'biz_a', 'settings', 'main')),
    /Cross-tenant read denied/
  );
  console.log('PASS [2] Cross-tenant Firestore read isolation');
}

// 3. Waiter order creation & order authorship isolation
let sharedOrderId;
{
  asAccount(adminA);
  const tbl = await req('POST', '/api/tables', { number: 7, seats: 4 });
  assert.equal(tbl.status, 201, JSON.stringify(tbl.data));

  asAccount(waiter1);
  const prodWater = [...store.entries()].find(([k, v]) => k.startsWith('businesses/biz_a/products/') && v.name === 'Água 500ml')[1];
  const ord = await req('POST', '/api/orders', {
    request_key: 'ord_waiter_req_001',
    table_number: 7,
    items: [{ product_id: prodWater.id, quantity: 1 }]
  });
  assert.equal(ord.status, 201, JSON.stringify(ord.data));
  sharedOrderId = ord.data.id;
  assert.equal(store.get(`businesses/biz_a/locks/table_7`).active, true);

  // waiter2 cannot read waiter1's order when orders.shared is off
  asAccount(waiter2);
  const deniedOrd = await req('GET', `/api/orders/${sharedOrderId}`);
  assert.equal(deniedOrd.status, 403);
  const listW2 = await req('GET', '/api/orders');
  assert.equal(listW2.status, 200);
  assert.equal(listW2.data.orders.length, 0);

  // waiter1 can read own order
  asAccount(waiter1);
  const ownOrd = await req('GET', `/api/orders/${sharedOrderId}`);
  assert.equal(ownOrd.status, 200);
  console.log('PASS [3] Waiter order authorship & scoped listing without admin escalation');
}

// 4. Simultaneous cash/open race condition
let activeSessionId;
{
  asAccount(cashierNoCost);
  const [r1, r2] = await Promise.all([
    req('POST', '/api/cash/open', { request_key: 'cash_open_race_001', opening_cents: 10000 }),
    req('POST', '/api/cash/open', { request_key: 'cash_open_race_002', opening_cents: 10000 })
  ]);
  const statuses = [r1.status, r2.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [201, 409], JSON.stringify([r1, r2]));
  activeSessionId = r1.status === 201 ? r1.data.id : r2.data.id;
  assert.equal(store.get('businesses/biz_a/locks/activeCashSession').active, true);
  console.log('PASS [4] Simultaneous cash/open atomic lock allows only 1 session');
}

// 5. Simultaneous partial payments + full settlement + table lock release
{
  asAccount(cashierNoCost);
  // Order #1 is table 7, total 500 cents (1 Agua 500ml)
  const [p1, p2] = await Promise.all([
    req('POST', `/api/orders/${sharedOrderId}/payment`, {
      request_key: 'pay_race_key_0001',
      session_id: activeSessionId,
      method: 'cash',
      amount_cents: 300,
      tendered_cents: 300
    }),
    req('POST', `/api/orders/${sharedOrderId}/payment`, {
      request_key: 'pay_race_key_0002',
      session_id: activeSessionId,
      method: 'cash',
      amount_cents: 300,
      tendered_cents: 300
    })
  ]);
  const payStatuses = [p1.status, p2.status].sort((a, b) => a - b);
  assert.deepEqual(payStatuses, [201, 409], JSON.stringify([p1, p2]));
  assert.equal(store.get(`businesses/biz_a/orders/${sharedOrderId}`).paidCents, 300);

  // Complete remaining 200 cents with finish_if_paid
  const p3 = await req('POST', `/api/orders/${sharedOrderId}/payment`, {
    request_key: 'pay_finish_key_003',
    session_id: activeSessionId,
    method: 'pix',
    amount_cents: 200,
    finish_if_paid: true
  });
  assert.equal(p3.status, 201, JSON.stringify(p3.data));
  assert.equal(p3.data.closed, true);
  assert.equal(store.get(`businesses/biz_a/orders/${sharedOrderId}`).state, 'closed');

  const deliv = await req('POST', `/api/orders/${sharedOrderId}/delivery`);
  assert.equal(deliv.status, 200, JSON.stringify(deliv.data));
  assert.equal(store.get('businesses/biz_a/locks/table_7').active, false);
  console.log('PASS [5] Simultaneous payments prevent overpayment, settle atomically & release table lock');
}

// 6. Idempotency replay & payload mismatch + insufficient stock rollback + direct sale
let directOrderId;
{
  asAccount(cashierNoCost);
  const prodWater = [...store.entries()].find(([k, v]) => k.startsWith('businesses/biz_a/products/') && v.name === 'Água 500ml')[1];
  // Balance left for Água 500ml is 1 unit (1000 milli). Selling qty 2 MUST rollback!
  const overSell = await req('POST', '/api/sales/direct', {
    request_key: 'direct_oversell_01',
    session_id: activeSessionId,
    method: 'cash',
    expected_total_cents: 1000,
    tendered_cents: 1000,
    items: [{ product_id: prodWater.id, quantity: 2 }]
  });
  assert.equal(overSell.status, 409, JSON.stringify(overSell.data));
  assert.equal(store.get(`businesses/biz_a/inventoryStock/${prodWater.finishedInventoryId}`).balanceMilli, 1000);

  // Valid sale of qty 1 -> balance becomes 0
  const saleOk = await req('POST', '/api/sales/direct', {
    request_key: 'direct_valid_key01',
    session_id: activeSessionId,
    method: 'cash',
    expected_total_cents: 500,
    tendered_cents: 500,
    items: [{ product_id: prodWater.id, quantity: 1 }]
  });
  assert.equal(saleOk.status, 201, JSON.stringify(saleOk.data));
  directOrderId = saleOk.data.id;
  assert.equal(store.get(`businesses/biz_a/inventoryStock/${prodWater.finishedInventoryId}`).balanceMilli, 0);

  // Replay same request_key & same payload -> no extra deduction or cash charge
  const replay = await req('POST', '/api/sales/direct', {
    request_key: 'direct_valid_key01',
    session_id: activeSessionId,
    method: 'cash',
    expected_total_cents: 500,
    tendered_cents: 500,
    items: [{ product_id: prodWater.id, quantity: 1 }]
  });
  assert.equal(replay.status, 200, JSON.stringify(replay.data));
  assert.equal(replay.data.id, directOrderId);

  // Same request_key & DIFFERENT payload -> 409 conflict
  const conflict = await req('POST', '/api/sales/direct', {
    request_key: 'direct_valid_key01',
    session_id: activeSessionId,
    method: 'pix',
    expected_total_cents: 500,
    items: [{ product_id: prodWater.id, quantity: 1 }]
  });
  assert.equal(conflict.status, 409, JSON.stringify(conflict.data));
  console.log('PASS [6] Insufficient stock atomic rollback + request_key idempotency replay & conflict');
}

// 7. Drawer overdraft guard + simultaneous return race condition
{
  asAccount(cashierNoCost);
  // Current cashBalance = 10000 opening + 300 partial cash + 500 direct cash = 10800
  const overdraft = await req('POST', '/api/cash/movement', {
    request_key: 'cash_withdraw_over',
    session_id: activeSessionId,
    kind: 'withdrawal',
    amount_cents: 50000,
    description: 'Sangria excessiva'
  });
  assert.equal(overdraft.status, 409, JSON.stringify(overdraft.data));

  // Simultaneous return against directOrderId (500 cents, qty 1 Água 500ml)
  const ordSnap = store.get(`businesses/biz_a/orders/${directOrderId}`);
  const itemUid = ordSnap.items[0].id;
  const [ret1, ret2] = await Promise.all([
    req('POST', `/api/returns/${directOrderId}`, {
      request_key: 'return_race_key_01',
      session_id: activeSessionId,
      kind: 'return',
      reason: 'Produto avariado',
      confirmed: true,
      version: ordSnap.version,
      items: [{ item_id: itemUid, quantity: 1, restock: true }]
    }),
    req('POST', `/api/returns/${directOrderId}`, {
      request_key: 'return_race_key_02',
      session_id: activeSessionId,
      kind: 'return',
      reason: 'Produto avariado duplicado',
      confirmed: true,
      version: ordSnap.version,
      items: [{ item_id: itemUid, quantity: 1, restock: true }]
    })
  ]);
  const retStatuses = [ret1.status, ret2.status].sort((a, b) => a - b);
  assert.deepEqual(retStatuses, [201, 409], JSON.stringify([ret1, ret2]));
  assert.equal(store.get(`businesses/biz_a/orders/${directOrderId}`).refundCents, 500);
  console.log('PASS [7] Drawer overdraft guard + simultaneous return concurrency safety');
}

// 8. Closed cash session blocks cash-dependent operations
{
  asAccount(cashierNoCost);
  const closed = await req('POST', '/api/cash/close', {
    session_id: activeSessionId,
    counted_cents: 10300,
    counted_methods: { cash: 10300, pix: 200 }
  });
  assert.equal(closed.status, 200, JSON.stringify(closed.data));
  assert.equal(store.get('businesses/biz_a/locks/activeCashSession').active, false);

  const directAfterClose = await req('POST', '/api/sales/direct', {
    request_key: 'direct_after_close1',
    session_id: activeSessionId,
    method: 'cash',
    expected_total_cents: 950,
    tendered_cents: 950,
    items: [{ product_id: [...store.entries()].find(([k, v]) => k.startsWith('businesses/biz_a/products/') && v.name === 'Suco Natural')[1].id, quantity: 1 }]
  });
  assert.ok([400, 409].includes(directAfterClose.status));

  const moveAfterClose = await req('POST', '/api/cash/movement', {
    request_key: 'move_after_close_01',
    session_id: activeSessionId,
    kind: 'supply',
    amount_cents: 1000,
    description: 'Troco tardio'
  });
  assert.equal(moveAfterClose.status, 409);
  console.log('PASS [8] Closed cash session blocks sales & drawer movements');
}

// 9. Waiter RBAC denials + Exchange transaction (restock + replacement order + extra payment)
{
  asAccount(waiter1);
  const deniedPay = await req('POST', `/api/orders/${sharedOrderId}/payment`, {
    request_key: 'waiter_try_pay_001',
    session_id: activeSessionId,
    method: 'cash',
    amount_cents: 100,
    tendered_cents: 100
  });
  assert.equal(deniedPay.status, 403);
  const deniedCreateProd = await req('POST', '/api/products', {
    request_key: 'waiter_try_prod_01',
    name: 'Invasor',
    price_cents: 100,
    cost_mode: 'direct',
    stock_mode: 'none',
    sale_unit: 'un',
    active: true,
    available: true,
    visible: true
  });
  assert.equal(deniedCreateProd.status, 403);

  // Reopen cash session to verify exchange flow end-to-end
  asAccount(cashierNoCost);
  const reopen = await req('POST', '/api/cash/open', { request_key: 'cash_reopen_key_01', opening_cents: 5000 });
  assert.equal(reopen.status, 201);
  const exchSession = reopen.data.id;

  const prodSuco = [...store.entries()].find(([k, v]) => k.startsWith('businesses/biz_a/products/') && v.name === 'Suco Natural')[1];
  const sharedSnap = store.get(`businesses/biz_a/orders/${sharedOrderId}`);
  const exch = await req('POST', `/api/returns/${sharedOrderId}`, {
    request_key: 'exchange_race_key1',
    session_id: exchSession,
    kind: 'exchange',
    reason: 'Cliente preferiu Suco Natural',
    confirmed: true,
    version: sharedSnap.version,
    items: [{ item_id: sharedSnap.items[0].id, quantity: 1, restock: true }],
    replacements: [{ product_id: prodSuco.id, quantity: 1 }],
    expected_replacement_cents: 950,
    method: 'pix'
  });
  assert.equal(exch.status, 201, JSON.stringify(exch.data));
  assert.ok(exch.data.replacement_order_id);
  const replOrder = store.get(`businesses/biz_a/orders/${exch.data.replacement_order_id}`);
  assert.ok(/^[a-zA-Z0-9_-]{12,80}$/.test(replOrder.requestKey), `Invalid replacement requestKey: ${replOrder.requestKey}`);
  assert.equal(replOrder.state, 'closed');
  console.log('PASS [9] Waiter RBAC denials + Exchange transaction & replacement order');
}

// 10. Waiter adds items to own order + direct SDK attempt to mark order paid without ledger rejected
{
  asAccount(waiter1);
  const prodSuco = [...store.entries()].find(([k, v]) => k.startsWith('businesses/biz_a/products/') && v.name === 'Suco Natural')[1];
  const openW = await req('POST', '/api/orders', {
    request_key: 'waiter_add_items_ord1',
    items: [{ product_id: prodSuco.id, quantity: 1 }]
  });
  assert.equal(openW.status, 201, JSON.stringify(openW.data));
  const addItems = await req('POST', `/api/orders/${openW.data.id}/items`, {
    request_key: 'waiter_add_items_act1',
    version: 1,
    items: [{ product_id: prodSuco.id, quantity: 1 }]
  });
  assert.equal(addItems.status, 200, JSON.stringify(addItems.data));
  assert.equal(store.get(`businesses/biz_a/orders/${openW.data.id}`).totalCents, 1900);

  // Cashier trying to directly update order as paid WITHOUT atomic ledger write MUST fail
  asAccount(cashierNoCost);
  await assert.rejects(
    () =>
      sdk.updateDoc(sdk.doc(fakeDb, 'businesses', 'biz_a', 'orders', openW.data.id), {
        paidCents: 1900,
        state: 'closed',
        version: 3,
        closedAt: sdk.serverTimestamp(),
        updatedAt: sdk.serverTimestamp()
      }),
    /Missing or insufficient permissions/
  );
  console.log('PASS [10] Waiter adds items to own order & paid order without ledger is blocked');
}

// 11. Retail modality isolation, tenant modality lock, parked drafts -> direct sale & return, and legacy food fallback
{
  const retailAdmin = makeAccount('biz_retail', 'admin_retail', 'Dono Varejo', 'admin');
  const retailCashier = makeAccount('biz_retail', 'cashier_retail', 'Operador Varejo', 'cashier');
  const legacyAdmin = makeAccount('biz_legacy', 'admin_legacy', 'Dono Legado', 'admin');

  // Tenant admin cannot alter business_kind via API or direct Firestore update
  asAccount(retailAdmin);
  const putKind = await req('PUT', '/api/business-kind', { business_kind: 'food' });
  assert.equal(putKind.status, 403);
  await assert.rejects(
    () =>
      sdk.updateDoc(sdk.doc(fakeDb, 'businesses', 'biz_retail', 'settings', 'main'), {
        businessKind: 'food',
        updatedAt: sdk.serverTimestamp()
      }),
    /Missing or insufficient permissions/
  );

  // Profiles exclude waiter and table permissions in retail
  const profilesRes = await req('GET', '/api/profiles');
  assert.equal(profilesRes.status, 200);
  assert.deepEqual(
    profilesRes.data.profiles.map((p) => p.role),
    ['admin', 'cashier']
  );
  assert.equal(
    profilesRes.data.permission_catalog.some((p) => p.id.startsWith('tables.')),
    false
  );
  assert.equal((await req('PUT', '/api/profiles/waiter', { name: 'Garçom', version: 1, permissions: {} })).status, 409);

  // Cannot create waiter employee, tables, open orders, or recipes in retail
  const empWaiter = await req('POST', '/api/employees', {
    name: 'Atendente',
    username: 'atend.varejo',
    role: 'waiter',
    password: 'Password123!'
  });
  assert.equal(empWaiter.status, 400);
  assert.equal((await req('POST', '/api/tables', { number: 1 })).status, 409);
  const retailOpenSess = await req('POST', '/api/cash/open', { request_key: 'retail_open_0001', opening_cents: 2000 });
  assert.equal(retailOpenSess.status, 201);
  const retailProd = await req('POST', '/api/products', {
    request_key: 'retail_prod_req_01',
    name: 'Camiseta P',
    barcode: '7891000000011',
    price_cents: 4500,
    cost_cents: 2000,
    cost_mode: 'direct',
    stock_mode: 'unit',
    sale_unit: 'un',
    initial_stock: 5,
    active: true,
    available: true,
    visible: true
  });
  assert.equal(retailProd.status, 201, JSON.stringify(retailProd.data));
  assert.equal((await req('POST', '/api/orders', { request_key: 'retail_ord_forbid_1', items: [{ product_id: retailProd.data.id, quantity: 1 }] })).status, 409);
  assert.equal((await req('POST', `/api/erp/recipes/${retailProd.data.id}`, { items: [] })).status, 409);

  // Retail cashier uses parked draft + optional customer + direct sale + return
  asAccount(retailCashier);
  const cust = await req('POST', '/api/customers', { name: 'Maria Cliente', phone: '11999990000' });
  assert.equal(cust.status, 201);
  const draft = await req('POST', '/api/drafts', {
    request_key: 'retail_draft_req_01',
    title: 'Cliente Maria',
    items: [{ product_id: retailProd.data.id, quantity: 2 }]
  });
  assert.equal(draft.status, 201, JSON.stringify(draft.data));
  const draftLoaded = await req('GET', `/api/drafts/${draft.data.id}`);
  assert.equal(draftLoaded.status, 200);
  assert.equal(draftLoaded.data.draft.items.length, 1);

  const retailDirect = await req('POST', '/api/sales/direct', {
    request_key: 'retail_sale_req_001',
    session_id: retailOpenSess.data.id,
    draft_id: draft.data.id,
    customer_id: cust.data.id,
    method: 'pix',
    expected_total_cents: 9000,
    items: [{ product_id: retailProd.data.id, quantity: 2 }]
  });
  assert.equal(retailDirect.status, 201, JSON.stringify(retailDirect.data));
  assert.equal(store.get(`businesses/biz_retail/drafts/${draft.data.id}`).state, 'converted');
  const rawRetailProd = store.get(`businesses/biz_retail/products/${retailProd.data.id}`);
  assert.equal(store.get(`businesses/biz_retail/inventoryStock/${rawRetailProd.finishedInventoryId}`).balanceMilli, 3000);
  assert.equal(store.get(`businesses/biz_retail/cashSessions/${retailOpenSess.data.id}`).methodTotals.pix, 9000);

  const retailOrdSnap = store.get(`businesses/biz_retail/orders/${retailDirect.data.id}`);
  const retailRet = await req('POST', `/api/returns/${retailDirect.data.id}`, {
    request_key: 'retail_ret_req_001',
    session_id: retailOpenSess.data.id,
    kind: 'return',
    reason: 'Troca de tamanho',
    confirmed: true,
    version: retailOrdSnap.version,
    items: [{ item_id: retailOrdSnap.items[0].id, quantity: 1, restock: true }]
  });
  assert.equal(retailRet.status, 201, JSON.stringify(retailRet.data));
  assert.equal(store.get(`businesses/biz_retail/inventoryStock/${rawRetailProd.finishedInventoryId}`).balanceMilli, 4000);

  // Legacy business with missing businessKind preserves food behavior without modifying production settings
  asAccount(legacyAdmin);
  const legacyKind = await req('GET', '/api/business-kind');
  assert.equal(legacyKind.data.business_kind, 'food');
  const legacyTable = await req('POST', '/api/tables', { number: 3 });
  assert.equal(legacyTable.status, 201, JSON.stringify(legacyTable.data));
  console.log('PASS [11] Retail modality isolation, draft -> direct sale -> return, and legacy food preservation');
}


// 12. Product configuration + availability + concurrent catalogue change cannot charge stale prices.
{
  seedTenant('biz_catalog','food');
  const manager=makeAccount('biz_catalog','catalog_admin','Administrador','admin');
  asAccount(manager);
  const created=await req('POST','/api/products',{name:'Tapioca configurável',price_cents:1000,cost_cents:null,stock_mode:'none',sale_unit:'un',active:true,available:true,visible:true,options:[{label:'Recheio',values:['Frango','Queijo'],required:true}],addons:[{name:'Queijo extra',price_cents:200,cost_cents:null}]});
  assert.equal(created.status,201,JSON.stringify(created.data));
  const id=created.data.id,productPath=`businesses/biz_catalog/products/${id}`,publicPath=`businesses/biz_catalog/publicProducts/${id}`;
  assert.equal(store.get(publicPath).addons[0].price_cents,200);
  assert.equal(store.get(publicPath).addons[0].cost_cents,undefined);
  const cashier=makeAccount('biz_catalog','catalog_cashier','Caixa','cashier',{'products.manage':false});
  asAccount(cashier);
  assert.equal((await req('PATCH',`/api/products/${id}/availability`,{available:false,version:1})).status,403);
  asAccount(manager);
  assert.equal((await req('PATCH',`/api/products/${id}/availability`,{available:false,version:1})).status,200);
  assert.equal(store.get(publicPath).available,false);
  assert.equal((await req('PATCH',`/api/products/${id}/availability`,{available:true,version:1})).status,409);
  assert.equal((await req('PATCH',`/api/products/${id}/availability`,{available:true,version:2})).status,200);
  const cash=await req('POST','/api/cash/open',{request_key:'catalog_open_0001',opening_cents:1000});
  const sale={request_key:'catalog_sale_0001',session_id:cash.data.id,method:'pix',expected_total_cents:1400,items:[{product_id:id,quantity:1,selections:{Recheio:'Frango'},addons:[{name:'Queijo extra',quantity:2}]}]};
  assert.equal((await req('POST','/api/sales/direct',{...sale,items:[{product_id:id,quantity:1}]})).status,400);
  const confirmed=await req('POST','/api/sales/direct',sale);
  assert.equal(confirmed.status,201,JSON.stringify(confirmed.data));
  const sold=store.get(`businesses/biz_catalog/orders/${confirmed.data.id}`);
  assert.equal(sold.totalCents,1400);assert.equal(sold.items[0].addons[0].quantity,2);
  beforeTransactionHook=()=>{const product=store.get(productPath);store.set(productPath,{...product,available:false,version:product.version+1});versions.set(productPath,(versions.get(productPath)||0)+1);};
  const blocked=await req('POST','/api/sales/direct',{...sale,request_key:'catalog_race_0001'});
  assert.equal(blocked.status,409,JSON.stringify(blocked.data));
  assert.equal(store.get(`businesses/biz_catalog/cashSessions/${cash.data.id}`).methodTotals.pix,1400);
  const product=store.get(productPath);store.set(productPath,{...product,available:true});
  beforeTransactionHook=()=>{const product=store.get(productPath);store.set(productPath,{...product,priceCents:1100,version:product.version+1});versions.set(productPath,(versions.get(productPath)||0)+1);};
  assert.equal((await req('POST','/api/sales/direct',{...sale,request_key:'catalog_race_0002'})).status,409);
  assert.equal(sold.totalCents,1400,'Histórico da venda não muda com edição do produto.');
  console.log('PASS [12] Opções obrigatórias, adicionais com quantidade, disponibilidade, projeção pública e corrida de preço/esgotamento');
}

// 13. Advanced command operations preserve totals, stock and audit history.
{
  seedTenant('biz_commands','food');
  const admin=makeAccount('biz_commands','commands_admin','Administrador','admin');
  asAccount(admin);
  for(const number of [1,2,3])assert.equal((await req('POST','/api/tables',{number})).status,201);
  const product=await req('POST','/api/products',{name:'Tapioca operacional',price_cents:1000,cost_cents:null,stock_mode:'none',sale_unit:'un',active:true,available:true,visible:true});
  const first=await req('POST','/api/orders',{request_key:'commands_order_0001',table_number:1,items:[{product_id:product.data.id,quantity:2}]});
  const second=await req('POST','/api/orders',{request_key:'commands_order_0002',table_number:2,items:[{product_id:product.data.id,quantity:1}]});
  let firstRaw=store.get(`businesses/biz_commands/orders/${first.data.id}`),secondRaw=store.get(`businesses/biz_commands/orders/${second.data.id}`);
  const printed=await req('POST',`/api/orders/${first.data.id}/kitchen-print`,{request_key:'commands_print_001',version:firstRaw.version});
  assert.equal(printed.status,200,JSON.stringify(printed.data));assert.equal(printed.data.order.items.length,1);assert.equal(printed.data.print_kind,'first');
  firstRaw=store.get(`businesses/biz_commands/orders/${first.data.id}`);
  assert.equal((await req('POST',`/api/orders/${first.data.id}/items`,{request_key:'commands_items_001',version:firstRaw.version,items:[{product_id:product.data.id,quantity:1}]})).status,200);
  firstRaw=store.get(`businesses/biz_commands/orders/${first.data.id}`);
  const complement=await req('POST',`/api/orders/${first.data.id}/kitchen-print`,{request_key:'commands_print_002',version:firstRaw.version});
  assert.equal(complement.status,200,JSON.stringify(complement.data));assert.equal(complement.data.order.items.length,1);assert.equal(complement.data.print_kind,'complement');

  const transferred=await req('POST',`/api/orders/${second.data.id}/transfer`,{request_key:'commands_transfer1',target_table_number:3,reason:'Cliente mudou de mesa',version:secondRaw.version});
  assert.equal(transferred.status,200,JSON.stringify(transferred.data));
  assert.equal(store.get('businesses/biz_commands/locks/table_2').active,false);assert.equal(store.get('businesses/biz_commands/locks/table_3').resourceId,second.data.id);

  firstRaw=store.get(`businesses/biz_commands/orders/${first.data.id}`);
  const originalTotal=firstRaw.totalCents;
  const split=await req('POST',`/api/orders/${first.data.id}/split`,{request_key:'commands_split_001',version:firstRaw.version,target_table_number:2,reason:'Clientes pediram contas separadas',items:[{item_id:firstRaw.items[0].id,quantity:1}]});
  assert.equal(split.status,201,JSON.stringify(split.data));
  firstRaw=store.get(`businesses/biz_commands/orders/${first.data.id}`);const splitRaw=store.get(`businesses/biz_commands/orders/${split.data.new_order_id}`);
  assert.equal(firstRaw.totalCents+splitRaw.totalCents,originalTotal);assert.equal(store.get('businesses/biz_commands/locks/table_2').resourceId,split.data.new_order_id);

  secondRaw=store.get(`businesses/biz_commands/orders/${second.data.id}`);
  const merged=await req('POST',`/api/orders/${split.data.new_order_id}/merge`,{request_key:'commands_merge_001',version:splitRaw.version,target_order_id:second.data.id,target_version:secondRaw.version,reason:'Clientes decidiram pagar juntos'});
  assert.equal(merged.status,200,JSON.stringify(merged.data));
  const mergedSource=store.get(`businesses/biz_commands/orders/${split.data.new_order_id}`),mergedTarget=store.get(`businesses/biz_commands/orders/${second.data.id}`);
  assert.equal(mergedSource.state,'cancelled');assert.equal(mergedSource.totalCents,0);assert.equal(mergedTarget.totalCents,2000);assert.equal(store.get('businesses/biz_commands/locks/table_2').active,false);
  assert.ok(store.get('businesses/biz_commands/orderOperations/id_order_merge_commands_merge_001'));

  const waiter=makeAccount('biz_commands','commands_waiter','Garçom','waiter');asAccount(waiter);
  assert.equal((await req('POST',`/api/orders/${first.data.id}/transfer`,{request_key:'commands_denied01',target_table_number:2,reason:'Tentativa sem permissão',version:firstRaw.version})).status,403);
  console.log('PASS [13] Transferência, complemento, separação e junção preservam total, estoque, bloqueios e permissões');
}

console.log(`ALL_FUNCTIONAL_TESTS_PASSED (simulated reads counted: ${readCount})`);
