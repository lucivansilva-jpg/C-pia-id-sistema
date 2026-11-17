import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const blueprint = JSON.parse(fs.readFileSync(new URL('./firebase-blueprint.json', import.meta.url), 'utf8'));
const rules = fs.readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');

console.log('=== [1/2] Static Security Rules & Blueprint Verification (NOT Emulator) ===');

for (const collectionPath of Object.keys(blueprint.firestore)) {
  const leaf = collectionPath.split('/').slice(-2, -1)[0];
  assert.ok(
    rules.includes(`/${leaf}/{`),
    `Missing match block in firestore.rules for blueprint path: ${collectionPath}`
  );
}

assert.ok(rules.includes("rules_version = '2';"), 'Must use rules_version = 2');
assert.ok(rules.includes('match /{document=**} {\n      allow read, write: if false;\n    }'), 'Must have default-deny global safety net');
assert.ok(rules.includes("request.auth.token.get('email_verified', false) == true\n        && request.auth.token.get('email', '') == 'lucivan.silva@gmail.com'"), 'Platform admin must require verified email');
assert.ok(rules.includes('isValidId('), 'Must enforce isValidId on document IDs');
assert.ok(rules.includes('function isOptionalId(val)') && rules.includes('function isValidOptionalId(val)'), 'Must define both isOptionalId and isValidOptionalId');
assert.ok(rules.includes('affectedKeys().hasOnly('), 'Must enforce affectedKeys allowlist on updates');
assert.ok(rules.includes('incoming().createdAt == request.time'), 'Must enforce server timestamp on create');
assert.ok(rules.includes('incoming().updatedAt == request.time'), 'Must enforce server timestamp on update');
assert.ok(rules.includes('hasTenantPerm(businessId, ') && rules.includes("match /private/{docId}"), 'Must isolate private/cost with hasTenantPerm');
assert.ok(rules.includes('data.quantityMilli != 0'), 'Must reject zero-quantity inventory movements');
assert.ok(rules.includes('function hasAtomicSaleLedger('), 'Must enforce atomic sale ledger entry via getAfter when marking order paid');
assert.ok(rules.includes('function checkSaleOrderAfter('), 'Must enforce atomic order binding on sale ledger creation');
assert.ok(rules.includes("'lastLedgerId'"), 'Must include lastLedgerId in order validation');

const productValidSection = rules.slice(rules.indexOf('function isValidProduct('), rules.indexOf('function isValidPrivateCost('));
assert.ok(!productValidSection.includes("'costCents'"), 'isValidProduct must NOT allow costCents on main product document');
assert.ok(rules.includes('function isRetail(businessId)') && rules.includes("get(settingsPath(businessId)).data.get('businessKind', 'food')"), 'Must evaluate businessKind from settings/main with legacy food fallback');
assert.ok(rules.includes('!isRetail(businessId)') && rules.includes("lockId.matches('^table_[0-9]+$')"), 'Must enforce !isRetail on tables, orders, recipes, and table locks');
assert.ok(rules.includes("incoming().businessKind == existing().businessKind"), 'Must prevent non-platform users from changing businessKind');
assert.ok(rules.includes("!isRetail(businessId) || incoming().role != 'waiter'"), 'Must forbid creating waiter members in retail establishments');

const dirtyDozenChecks = [
  ['1. Unverified admin email spoof', "request.auth.token.get('email_verified', false) == true"],
  ['2. Self-privilege escalation on member doc', "!incoming().diff(existing()).affectedKeys().hasOnly(['role'"],
  ['3. Ghost field injection via strict keys().hasOnly', 'data.keys().hasOnly('],
  ['4. Cross-tenant isolation via master gate', 'isBusinessMember(businessId)'],
  ['5. Waiter cannot open cashSession or close orders', "hasTenantPerm(businessId, 'cash.open')"],
  ['6. Waiter cannot read customer PII or inventory costs', 'match /customers/{customerId}'],
  ['7. Terminal state locking on closed orders & sessions', "previous.state == 'open'"],
  ['8. Client-forged timestamp blocked', 'incoming().createdAt == request.time'],
  ['9. Denial-of-wallet ID & media size bounds', 'isNonEmptyString(data.dataUrl, 10, 450000)'],
  ['10. Cashier blocked from financial accounts & settings', 'match /accounts/{accountId}'],
  ['11. Public scraping of businessAccess list blocked', 'match /businessAccess/{identifier} {\n      allow get: if isValidId(identifier);\n      allow list: if false;'],
  ['12. Audit log & ledger delete forbidden', 'match /auditLogs/{auditId}']
];

for (const [label, marker] of dirtyDozenChecks) {
  if (label.startsWith('2.')) {
    assert.ok(
      rules.includes("affectedKeys().hasOnly(['mustChangePassword', 'updatedAt'])") &&
        rules.includes("affectedKeys().hasOnly(['lastSeenAt', 'updatedAt'])"),
      `Dirty Dozen failed: ${label}`
    );
  } else {
    assert.ok(rules.includes(marker), `Dirty Dozen failed: ${label}`);
  }
}

console.log(
  `STATIC_CHECKS_OK: ${Object.keys(blueprint.firestore).length} blueprint paths and 12/12 Dirty Dozen static guards verified.`
);

function parseEmulatorHost() {
  const raw = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  const [host, portStr] = raw.split(':');
  return { host: host || '127.0.0.1', port: Number(portStr || 8080) };
}

async function isEmulatorReachable(host, port) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 500);
    const resp = await fetch(`http://${host}:${port}/`, { signal: controller.signal });
    clearTimeout(timer);
    const txt = (await resp.text()).trim();
    return resp.ok && txt === 'Ok';
  } catch {
    return false;
  }
}

async function runEmulatorSuite() {
  console.log('\n=== [2/2] Firebase Emulator Runtime Verification (@firebase/rules-unit-testing) ===');
  const { host, port } = parseEmulatorHost();
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(host), 'Testes destrutivos exigem emulador local.');
  const reachable = await isEmulatorReachable(host, port);
  if (!reachable) {
    if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Firebase Emulator configurado, mas indisponível. Validação não executada.');
    console.log(
      `EMULATOR_SUITE_PENDING: Firestore Emulator não está ativo em ${host}:${port} . ` +
        'Nenhuma regra foi validada em runtime de emulador nesta execução.'
    );
    return;
  }

  const rulesUnit = await import('@firebase/rules-unit-testing');
  const firestoreSdk = await import('firebase/firestore');
  const { initializeTestEnvironment, assertFails, assertSucceeds } = rulesUnit;
  const { doc, getDoc, setDoc, updateDoc, writeBatch, serverTimestamp, Timestamp } = firestoreSdk;

  const testEnv = await initializeTestEnvironment({
    projectId: 'demo-idsistema-test',
    firestore: { host, port, rules }
  });

  try {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const ts = Timestamp.now();
      for (const [bid, kind] of [['biz_a', 'food'], ['biz_b', 'food'], ['biz_retail', 'retail']]) {
        await setDoc(doc(db, 'businesses', bid), {
          id: bid,
          name: `Empresa ${bid}`,
          code: bid.replace('_', ''),
          active: true,
          deleted: false,
          ownerUid: `owner_${bid}`,
          ownerName: 'Proprietário',
          createdAt: ts,
          updatedAt: ts
        });
        await setDoc(doc(db, 'businesses', bid, 'settings', 'main'), {
          name: `Empresa ${bid}`,
          mode: 'complete',
          paper: 80,
          businessKind: kind,
          blindClose: false,
          updatedAt: ts
        });
        if (kind !== 'retail') {
          await setDoc(doc(db, 'businesses', bid, 'profiles', 'waiter'), {
            role: 'waiter',
            name: 'Garçom',
            permissions: {},
            version: 1,
            updatedAt: ts
          });
        }
        await setDoc(doc(db, 'businesses', bid, 'profiles', 'cashier'), {
          role: 'cashier',
          name: 'Caixa',
          permissions: { 'products.manage': false },
          version: 1,
          updatedAt: ts
        });
      }
      await setDoc(doc(db, 'businesses', 'biz_retail', 'members', 'owner_biz_retail'), {
        uid: 'owner_biz_retail',
        businessId: 'biz_retail',
        name: 'Dono Varejo',
        username: 'donovarejo',
        role: 'admin',
        permissions: {},
        active: true,
        mustChangePassword: false,
        isOwner: true,
        version: 1,
        createdAt: ts,
        updatedAt: ts
      });
      await setDoc(doc(db, 'businesses', 'biz_retail', 'members', 'cashier_retail'), {
        uid: 'cashier_retail',
        businessId: 'biz_retail',
        name: 'Caixa Varejo',
        username: 'caixavarejo',
        role: 'cashier',
        permissions: {},
        active: true,
        mustChangePassword: false,
        isOwner: false,
        version: 1,
        createdAt: ts,
        updatedAt: ts
      });
      await setDoc(doc(db, 'businesses', 'biz_retail', 'cashSessions', 'sess_retail'), {
        id: 'sess_retail',
        openingCents: 1000,
        cashBalanceCents: 1000,
        methodTotals: { cash: 1000, pix: 0, credit: 0, debit: 0, card: 0 },
        version: 1,
        state: 'open',
        actorId: 'cashier_retail',
        openedAt: ts,
        updatedAt: ts
      });
      await setDoc(doc(db, 'businesses', 'biz_retail', 'locks', 'activeCashSession'), {
        id: 'activeCashSession',
        kind: 'cash_session',
        resourceId: 'sess_retail',
        active: true,
        ownerId: 'cashier_retail',
        version: 1,
        updatedAt: ts
      });

      await setDoc(doc(db, 'businesses', 'biz_a', 'members', 'waiter_1'), {
        uid: 'waiter_1',
        businessId: 'biz_a',
        name: 'Garçom 1',
        username: 'garcom1',
        role: 'waiter',
        permissions: {},
        active: true,
        mustChangePassword: false,
        isOwner: false,
        version: 1,
        createdAt: ts,
        updatedAt: ts
      });
      await setDoc(doc(db, 'businesses', 'biz_a', 'members', 'waiter_2'), {
        uid: 'waiter_2',
        businessId: 'biz_a',
        name: 'Garçom 2',
        username: 'garcom2',
        role: 'waiter',
        permissions: {},
        active: true,
        mustChangePassword: false,
        isOwner: false,
        version: 1,
        createdAt: ts,
        updatedAt: ts
      });
      await setDoc(doc(db, 'businesses', 'biz_a', 'members', 'cashier_noprod'), {
        uid: 'cashier_noprod',
        businessId: 'biz_a',
        name: 'Caixa Restrito',
        username: 'caixanoprod',
        role: 'cashier',
        permissions: {},
        active: true,
        mustChangePassword: false,
        isOwner: false,
        version: 1,
        createdAt: ts,
        updatedAt: ts
      });
      await setDoc(doc(db, 'businesses', 'biz_a', 'members', 'owner_biz_a'), {
        uid: 'owner_biz_a',
        businessId: 'biz_a',
        name: 'Dono A',
        username: 'donoa',
        role: 'admin',
        permissions: {},
        active: true,
        mustChangePassword: false,
        isOwner: true,
        version: 1,
        createdAt: ts,
        updatedAt: ts
      });
      await setDoc(doc(db, 'businesses', 'biz_b', 'members', 'owner_biz_b'), {
        uid: 'owner_biz_b',
        businessId: 'biz_b',
        name: 'Dono B',
        username: 'donob',
        role: 'admin',
        permissions: {},
        active: true,
        mustChangePassword: false,
        isOwner: true,
        version: 1,
        createdAt: ts,
        updatedAt: ts
      });
      await setDoc(doc(db, 'businesses', 'biz_a', 'tables', 'table_1'), { id: 'table_1', number: 1, active: true, createdAt: ts });
      await setDoc(doc(db, 'businesses', 'biz_a', 'products', 'prod_1'), {
        id: 'prod_1',
        code: 1,
        name: 'Café Espresso',
        priceCents: 600,
        active: true,
        available: true,
        visible: true,
        options: [],
        addons: [],
        quickNotes: [],
        saleUnit: 'un',
        stockMode: 'none',
        trackStock: false,
        costMode: 'direct',
        version: 1,
        createdAt: ts,
        updatedAt: ts
      });
      await setDoc(doc(db, 'businesses', 'biz_a', 'products', 'prod_1', 'private', 'cost'), {
        costCents: 180,
        addonCosts: {},
        updatedAt: ts
      });
      await setDoc(doc(db, 'businesses', 'biz_a', 'orders', 'ord_w2'), {
        id: 'ord_w2',
        number: 10,
        requestKey: 'req_waiter_order_2',
        state: 'open',
        fulfillment: 'pending',
        items: [],
        totalCents: 600,
        discountCents: 0,
        actorId: 'waiter_2',
        attendantName: 'Garçom 2',
        checkoutWaiting: false,
        paidCents: 0,
        refundCents: 0,
        version: 1,
        createdAt: ts,
        updatedAt: ts
      });
      await setDoc(doc(db, 'businesses', 'biz_a', 'cashSessions', 'sess_existing'), {
        id: 'sess_existing',
        openingCents: 1000,
        cashBalanceCents: 1000,
        methodTotals: { cash: 1000, pix: 0, credit: 0, debit: 0, card: 0 },
        version: 1,
        state: 'open',
        actorId: 'cashier_noprod',
        openedAt: ts,
        updatedAt: ts
      });
      await setDoc(doc(db, 'businesses', 'biz_a', 'locks', 'activeCashSession'), {
        id: 'activeCashSession',
        kind: 'cash_session',
        resourceId: 'sess_existing',
        active: true,
        ownerId: 'cashier_noprod',
        version: 1,
        updatedAt: ts
      });
    });

    const ownerA = testEnv.authenticatedContext('owner_biz_a').firestore();
    const ownerB = testEnv.authenticatedContext('owner_biz_b').firestore();
    const waiter1 = testEnv.authenticatedContext('waiter_1').firestore();
    const waiter2 = testEnv.authenticatedContext('waiter_2').firestore();
    const cashierNoProd = testEnv.authenticatedContext('cashier_noprod').firestore();

    // Fluxo 5: Cross-tenant isolation
    await assertFails(getDoc(doc(ownerB, 'businesses', 'biz_a', 'products', 'prod_1')));
    await assertFails(getDoc(doc(ownerB, 'businesses', 'biz_a', 'orders', 'ord_w2')));
    await assertFails(getDoc(doc(ownerB, 'businesses', 'biz_a', 'cashSessions', 'sess_existing')));

    // Fluxo 4: Private cost isolation & forbidden costCents on main product
    await assertSucceeds(getDoc(doc(waiter1, 'businesses', 'biz_a', 'products', 'prod_1')));
    await assertFails(getDoc(doc(waiter1, 'businesses', 'biz_a', 'products', 'prod_1', 'private', 'cost')));
    await assertFails(getDoc(doc(cashierNoProd, 'businesses', 'biz_a', 'products', 'prod_1', 'private', 'cost')));
    await assertSucceeds(getDoc(doc(ownerA, 'businesses', 'biz_a', 'products', 'prod_1', 'private', 'cost')));
    await assertFails(
      setDoc(doc(ownerA, 'businesses', 'biz_a', 'products', 'prod_2'), {
        id: 'prod_2',
        code: 2,
        name: 'Produto Inválido',
        priceCents: 500,
        costCents: 100,
        active: true,
        available: true,
        visible: true,
        options: [],
        addons: [],
        quickNotes: [],
        saleUnit: 'un',
        stockMode: 'none',
        trackStock: false,
        costMode: 'direct',
        version: 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
    );

    // Dynamic profile permission enforced on product price update
    await assertFails(
      updateDoc(doc(cashierNoProd, 'businesses', 'biz_a', 'products', 'prod_1'), {
        priceCents: 999,
        version: 2,
        updatedAt: serverTimestamp()
      })
    );
    await assertFails(
      updateDoc(doc(waiter1, 'businesses', 'biz_a', 'products', 'prod_1'), {
        priceCents: 100,
        version: 2,
        updatedAt: serverTimestamp()
      })
    );

    // Fluxo 1: Waiter creates, reads, and adds items to own order; blocked from costs, finance, and other waiters' orders
    await assertFails(getDoc(doc(waiter1, 'businesses', 'biz_a', 'orders', 'ord_w2')));
    await assertSucceeds(getDoc(doc(waiter2, 'businesses', 'biz_a', 'orders', 'ord_w2')));
    await assertFails(getDoc(doc(waiter1, 'businesses', 'biz_a', 'accounts', 'acc_1')));
    await assertFails(getDoc(doc(waiter1, 'businesses', 'biz_a', 'ledger', 'led_1')));
    console.log('CHECK: waiter creates own order');
    await assertSucceeds(
      setDoc(doc(waiter1, 'businesses', 'biz_a', 'orders', 'ord_w1'), {
        id: 'ord_w1',
        number: 11,
        requestKey: 'req_waiter_order_1',
        state: 'open',
        fulfillment: 'pending',
        items: [{ id: 'it_1', product_id: 'prod_1', quantity: 1, unit_price_cents: 600 }],
        totalCents: 600,
        discountCents: 0,
        actorId: 'waiter_1',
        attendantName: 'Garçom 1',
        checkoutWaiting: false,
        paidCents: 0,
        refundCents: 0,
        version: 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
    );
    console.log('CHECK: waiter adds items');
    await assertSucceeds(
      updateDoc(doc(waiter1, 'businesses', 'biz_a', 'orders', 'ord_w1'), {
        items: [{ id: 'it_1', product_id: 'prod_1', quantity: 2, unit_price_cents: 600 }],
        totalCents: 1200,
        fulfillment: 'pending',
        version: 2,
        updatedAt: serverTimestamp()
      })
    );
    await assertFails(
      setDoc(doc(waiter1, 'businesses', 'biz_a', 'cashSessions', 'sess_2'), {
        id: 'sess_2',
        openingCents: 0,
        cashBalanceCents: 0,
        methodTotals: {},
        version: 1,
        state: 'open',
        actorId: 'waiter_1',
        openedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
    );

    // Fluxo 2 & Regra crítica: marking order paid or closed WITHOUT atomic ledger + session update MUST FAIL
    await assertFails(
      updateDoc(doc(cashierNoProd, 'businesses', 'biz_a', 'orders', 'ord_w2'), {
        paidCents: 600,
        state: 'closed',
        checkoutWaiting: false,
        checkoutHeldAt: null,
        checkoutHeldBy: null,
        closedAt: serverTimestamp(),
        version: 2,
        updatedAt: serverTimestamp()
      })
    );
    await assertFails(
      setDoc(doc(cashierNoProd, 'businesses', 'biz_a', 'orders', 'ord_direct_noleg'), {
        id: 'ord_direct_noleg',
        number: 12,
        requestKey: 'req_direct_noled_1',
        state: 'closed',
        fulfillment: 'delivered',
        items: [],
        totalCents: 600,
        discountCents: 0,
        actorId: 'cashier_noprod',
        attendantName: 'Caixa',
        checkoutWaiting: false,
        paidCents: 600,
        refundCents: 0,
        version: 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        closedAt: serverTimestamp()
      })
    );

    // Fluxo 2: Atomic batch (order payment + sale ledger + cash session increment) MUST SUCCEED
    const payBatch = writeBatch(cashierNoProd);
    payBatch.set(doc(cashierNoProd, 'businesses', 'biz_a', 'ledger', 'led_w2_1'), {
      id: 'led_w2_1',
      requestKey: 'pay_w2_key_0001',
      sessionId: 'sess_existing',
      orderId: 'ord_w2',
      kind: 'sale',
      method: 'cash',
      amountCents: 600,
      tenderedCents: 600,
      refundedCents: 0,
      description: 'Recebimento de venda',
      category: 'Não classificado',
      financeAccount: 'drawer',
      actorId: 'cashier_noprod',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    payBatch.update(doc(cashierNoProd, 'businesses', 'biz_a', 'cashSessions', 'sess_existing'), {
      cashBalanceCents: 1600,
      methodTotals: { cash: 1600, pix: 0, credit: 0, debit: 0, card: 0 },
      version: 2,
      updatedAt: serverTimestamp()
    });
    payBatch.update(doc(cashierNoProd, 'businesses', 'biz_a', 'orders', 'ord_w2'), {
      paidCents: 600,
      lastLedgerId: 'led_w2_1',
      state: 'closed',
      checkoutWaiting: false,
      checkoutHeldAt: null,
      checkoutHeldBy: null,
      closedAt: serverTimestamp(),
      version: 2,
      updatedAt: serverTimestamp()
    });
    console.log('CHECK: atomic payment');
    await assertSucceeds(payBatch.commit());

    // Fluxo 3: Active cash session lock blocks duplicate session creation & idempotency is create-only
    await assertSucceeds(
      setDoc(doc(cashierNoProd, 'businesses', 'biz_a', 'idempotency', 'idem_pay_1'), {
        key: 'idem_pay_1',
        kind: 'order_payment',
        targetId: 'led_w2_1',
        actorId: 'cashier_noprod',
        createdAt: serverTimestamp()
      })
    );
    await assertFails(
      setDoc(doc(cashierNoProd, 'businesses', 'biz_a', 'idempotency', 'idem_pay_1'), {
        key: 'idem_pay_1',
        kind: 'order_payment',
        targetId: 'led_fake',
        actorId: 'cashier_noprod',
        createdAt: serverTimestamp()
      })
    );
    await assertFails(
      setDoc(doc(cashierNoProd, 'businesses', 'biz_a', 'cashSessions', 'sess_dup'), {
        id: 'sess_dup',
        openingCents: 1000,
        cashBalanceCents: 1000,
        methodTotals: {},
        version: 1,
        state: 'open',
        actorId: 'cashier_noprod',
        openedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
    );

    // Exercise the actual browser adapter with the official Firestore SDK and rules.
    function apiRuntime(db, uid, role) {
      // Preserve Firebase sentinels/references while normalizing VM plain objects.
      const plain = (v) => Array.isArray(v) ? Array.from(v, plain)
        : v && Object.getPrototypeOf(v)?.constructor?.name === 'Object'
          ? Object.fromEntries(Object.entries(v).map(([k, value]) => [k, plain(value)])) : v;
      const sdk = { ...firestoreSdk,
        setDoc: (ref, value, ...rest) => firestoreSdk.setDoc(ref, plain(value), ...rest),
        updateDoc: (ref, value) => firestoreSdk.updateDoc(ref, plain(value)),
        runTransaction: (database, fn) => firestoreSdk.runTransaction(database, (tx) => fn({
          get: (ref) => tx.get(ref),
          set: (ref, value) => tx.set(ref, plain(value)),
          update: (ref, value) => tx.update(ref, plain(value)),
          delete: (ref) => tx.delete(ref)
        })),
        writeBatch: (database) => {
          const batch = firestoreSdk.writeBatch(database);
          return { set: (ref, value) => batch.set(ref, plain(value)), update: (ref, value) => batch.update(ref, plain(value)),
            delete: (ref) => batch.delete(ref), commit: () => batch.commit() };
        }
      };
      const context = vm.createContext({ console, URL, Response, Request, Headers, crypto: globalThis.crypto,
        TextEncoder, TextDecoder, setTimeout, clearTimeout, fetch,
        location: new URL('https://localhost/system/'),
        IDFirebaseSDK: { ...sdk, FIREBASE_CONFIG: {}, initializeApp: () => ({}),
          getAuth: () => ({ currentUser: { uid, emailVerified: false } }), getFirestore: () => db }
      });
      context.window = context;
      vm.runInContext(fs.readFileSync(new URL('./web/firebase-client.js', import.meta.url), 'utf8'), context);
      vm.runInContext(fs.readFileSync(new URL('./web/system/firebase-api.js', import.meta.url), 'utf8'), context);
      const permissions = context.IDFirebase.effectivePermissions({ role, permissions: {}, profile_permissions: {} });
      context.ERP_ACCOUNT = { business: { id: 'biz_a', code: 'biza', name: 'Loja teste' },
        user: { id: uid, name: uid, role, permissions, raw_permissions: {}, profile_permissions: {} } };
      return async (method, path, body, accepted = [200, 201]) => {
        const res = await context.IDFirebaseApi.fetch(path, { method, body: body == null ? undefined : JSON.stringify(body) });
        const data = await res.json();
        assert.ok(accepted.includes(res.status), `${method} ${path}: ${res.status} ${JSON.stringify(data)}`);
        return { ...data, http_status: res.status };
      };
    }
    const adminApi = apiRuntime(ownerA, 'owner_biz_a', 'admin');
    const waiterApi = apiRuntime(waiter1, 'waiter_1', 'waiter');
    const cashierApi = apiRuntime(cashierNoProd, 'cashier_noprod', 'cashier');
    await adminApi('POST', '/api/tables', { number: 2 });
    await adminApi('POST', '/api/tables', { number: 3 });
    await adminApi('POST', '/api/tables', { number: 4 });
    console.log('CHECK: real API product creation with private cost');
    const newProduct = await adminApi('POST', '/api/products', {
      name: 'Produto emulado', price_cents: 600, cost_cents: 180, stock_mode: 'none', sale_unit: 'un',
      active: true, available: true, visible: true, addons: [], options: [], quick_notes: []
    });
    assert.equal((await getDoc(doc(ownerA, 'businesses', 'biz_a', 'products', newProduct.id, 'private', 'cost'))).data().costCents, 180);
    await assertFails(getDoc(doc(waiter1, 'businesses', 'biz_a', 'products', newProduct.id, 'private', 'cost')));
    console.log('CHECK: real API waiter order transaction');
    const created = await waiterApi('POST', '/api/orders', {
      request_key: 'emulator_api_order_0001', table_number: 1, items: [{ product_id: 'prod_1', quantity: 1 }]
    });
    console.log('CHECK: real API waiter adds items and delivers');
    await waiterApi('POST', `/api/orders/${created.id}/items`, { request_key: 'emulator_items_000001', version: 1, items: [{ product_id: 'prod_1', quantity: 1 }] });
    await waiterApi('POST', `/api/orders/${created.id}/delivery`, {});
    console.log('CHECK: real API cashier payment transaction');
    await cashierApi('POST', `/api/orders/${created.id}/payment`, {
      request_key: 'emulator_api_pay_00001', session_id: 'sess_existing',
      amount_cents: 1200, method: 'cash', tendered_cents: 1500, finish_if_paid: true
    });
    const paidOrder = await getDoc(doc(cashierNoProd, 'businesses', 'biz_a', 'orders', created.id));
    assert.equal(paidOrder.data().paidCents, 1200);
    assert.equal(paidOrder.data().state, 'closed');
    assert.equal((await getDoc(doc(cashierNoProd, 'businesses', 'biz_a', 'locks', 'table_1'))).data().active, false);
    // Repeating a payment must not add a second ledger entry or cash amount.
    await cashierApi('POST', `/api/orders/${created.id}/payment`, {
      request_key: 'emulator_api_pay_00001', session_id: 'sess_existing',
      amount_cents: 1200, method: 'cash', tendered_cents: 1500, finish_if_paid: true
    });
    assert.equal((await getDoc(doc(cashierNoProd, 'businesses', 'biz_a', 'cashSessions', 'sess_existing'))).data().cashBalanceCents, 2800);
    console.log('CHECK: real API direct sale');
    await cashierApi('POST', '/api/sales/direct', {
      request_key: 'emulator_direct_00001', session_id: 'sess_existing', method: 'pix',
      expected_total_cents: 600, items: [{ product_id: 'prod_1', quantity: 1 }]
    });
    console.log('CHECK: real API cash movement, close and open');
    await cashierApi('POST', '/api/cash/movement', {
      request_key: 'emulator_supply_00001', session_id: 'sess_existing', kind: 'supply', amount_cents: 100, description: 'Suprimento de teste'
    });
    await cashierApi('POST', '/api/cash/close', { session_id: 'sess_existing', counted_methods: { cash: 2900, pix: 600, credit: 0, debit: 0, card: 0 } });
    const reopened = await cashierApi('POST', '/api/cash/open', { request_key: 'emulator_open_0000001', opening_cents: 0 });
    console.log('CHECK: simultaneous payments through actual SDK transactions');
    const concurrentOrder = await waiterApi('POST', '/api/orders', {
      request_key: 'emulator_concurrent_ord', table_number: 1, items: [{ product_id: 'prod_1', quantity: 1 }]
    });
    const simultaneous = await Promise.all(['a', 'b'].map((suffix) => cashierApi('POST', `/api/orders/${concurrentOrder.id}/payment`, {
      request_key: `emulator_concurrent_pay_${suffix}`, session_id: reopened.id, amount_cents: 600,
      method: 'pix', finish_if_paid: true
    }, [201, 409])));
    console.log('CONCURRENT_STATUS', simultaneous.map((r) => r.http_status));
    assert.deepEqual(simultaneous.map((r) => r.http_status).sort(), [201, 409]);
    assert.equal((await getDoc(doc(cashierNoProd, 'businesses', 'biz_a', 'cashSessions', reopened.id))).data().methodTotals.pix, 600);
    console.log('CHECK: advanced command operations through actual SDK transactions');
    const commandA = await waiterApi('POST', '/api/orders', {
      request_key: 'emulator_command_order_a', table_number: 2, items: [{ product_id: 'prod_1', quantity: 2 }]
    });
    await cashierApi('POST', `/api/orders/${commandA.id}/kitchen-print`, { request_key: 'emulator_command_print1', version: 1 });
    await waiterApi('POST', `/api/orders/${commandA.id}/items`, { request_key: 'emulator_command_items1', version: 1, items: [{ product_id: 'prod_1', quantity: 1 }] });
    const complement = await cashierApi('POST', `/api/orders/${commandA.id}/kitchen-print`, { request_key: 'emulator_command_print2', version: 2 });
    assert.equal(complement.print_kind, 'complement');
    const beforePartialCancel = (await getDoc(doc(cashierNoProd, 'businesses', 'biz_a', 'orders', commandA.id))).data();
    const partialCancel = await cashierApi('POST', `/api/orders/${commandA.id}/partial-cancel`, {
      request_key: 'emulator_command_cancel1', reason: 'Cliente desistiu de um item', version: 2,
      items: [{ item_id: beforePartialCancel.items[0].id, quantity: 1 }]
    });
    assert.equal(partialCancel.kitchen_notice, true);
    await cashierApi('POST', `/api/orders/${commandA.id}/transfer`, {
      request_key: 'emulator_command_move01', target_table_number: 4, reason: 'Cliente mudou de mesa', version: 3
    });
    const commandARaw = (await getDoc(doc(cashierNoProd, 'businesses', 'biz_a', 'orders', commandA.id))).data();
    const split = await cashierApi('POST', `/api/orders/${commandA.id}/split`, {
      request_key: 'emulator_command_split1', target_table_number: 2, reason: 'Clientes pediram contas separadas', version: 4,
      items: [{ item_id: commandARaw.items[0].id, quantity: 1 }]
    });
    const commandB = await waiterApi('POST', '/api/orders', {
      request_key: 'emulator_command_order_b', table_number: 3, items: [{ product_id: 'prod_1', quantity: 1 }]
    });
    await cashierApi('POST', `/api/orders/${split.new_order_id}/merge`, {
      request_key: 'emulator_command_merge1', target_order_id: commandB.id, reason: 'Clientes decidiram pagar juntos', version: 1, target_version: 1
    });
    assert.equal((await getDoc(doc(cashierNoProd, 'businesses', 'biz_a', 'orders', split.new_order_id))).data().state, 'cancelled');
    console.log('API_EMULATOR_OK: actual adapter created and paid an order with idempotency and audit writes.');

    // Fluxo 6: Retail modality enforcement in Firestore Rules (platform-only businessKind, no tables/comandas/waiters/recipes)
    const ownerRetail = testEnv.authenticatedContext('owner_biz_retail').firestore();
    const cashierRetail = testEnv.authenticatedContext('cashier_retail').firestore();
    await assertFails(
      updateDoc(doc(ownerRetail, 'businesses', 'biz_retail', 'settings', 'main'), {
        businessKind: 'food',
        updatedAt: serverTimestamp()
      })
    );
    await assertFails(
      setDoc(doc(ownerRetail, 'businesses', 'biz_retail', 'tables', 'table_1'), {
        id: 'table_1', number: 1, active: true, createdAt: serverTimestamp()
      })
    );
    await assertFails(
      setDoc(doc(ownerRetail, 'businesses', 'biz_retail', 'members', 'waiter_r1'), {
        uid: 'waiter_r1', businessId: 'biz_retail', name: 'Garçom Varejo', username: 'garcomv',
        role: 'waiter', permissions: {}, active: true, mustChangePassword: false, isOwner: false,
        version: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      })
    );
    await assertFails(
      setDoc(doc(cashierRetail, 'businesses', 'biz_retail', 'orders', 'ord_retail_open'), {
        id: 'ord_retail_open', number: 1, requestKey: 'req_retail_open_1', state: 'open', fulfillment: 'pending',
        items: [], totalCents: 500, discountCents: 0, actorId: 'cashier_retail', attendantName: 'Caixa Varejo',
        checkoutWaiting: false, paidCents: 0, refundCents: 0, version: 1,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      })
    );
    const retailSaleBatch = writeBatch(cashierRetail);
    retailSaleBatch.set(doc(cashierRetail, 'businesses', 'biz_retail', 'ledger', 'led_retail_1'), {
      id: 'led_retail_1', requestKey: 'req_retail_sale_01', sessionId: 'sess_retail', orderId: 'ord_retail_direct',
      kind: 'sale', method: 'pix', amountCents: 500, tenderedCents: 500, refundedCents: 0,
      description: 'Venda direta varejo', category: 'Não classificado', financeAccount: 'bank',
      actorId: 'cashier_retail', createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    retailSaleBatch.update(doc(cashierRetail, 'businesses', 'biz_retail', 'cashSessions', 'sess_retail'), {
      cashBalanceCents: 1000, methodTotals: { cash: 1000, pix: 500, credit: 0, debit: 0, card: 0 },
      version: 2, updatedAt: serverTimestamp()
    });
    retailSaleBatch.set(doc(cashierRetail, 'businesses', 'biz_retail', 'orders', 'ord_retail_direct'), {
      id: 'ord_retail_direct', number: 1, requestKey: 'req_retail_sale_01', tableNumber: null,
      state: 'closed', fulfillment: 'delivered', items: [], totalCents: 500, discountCents: 0,
      actorId: 'cashier_retail', attendantName: 'Caixa Varejo', checkoutWaiting: false,
      paidCents: 500, lastLedgerId: 'led_retail_1', refundCents: 0, version: 1,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(), closedAt: serverTimestamp()
    });
    await assertSucceeds(retailSaleBatch.commit());

    console.log('EMULATOR_SUITE_OK: Todos os 6 fluxos (incluindo isolamento Varejo) passaram no Firebase Emulator.');
  } finally {
    await testEnv.cleanup();
  }
}

await runEmulatorSuite();
