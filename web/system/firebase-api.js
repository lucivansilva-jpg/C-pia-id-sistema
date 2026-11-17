(() => {
  const fb = window.IDFirebase;
  if (!fb) throw new Error('IDFirebase não carregado.');

  const {
    auth,
    db,
    OperationType,
    handleFirestoreError,
    tsToIso,
    provisionAuthAccount,
    staffAuthEmail,
    compressImageFile,
    PERMISSION_INFO,
    PERMISSIONS,
    ROLE_BASE,
    roleAllows,
    hasPermission,
    effectivePermissions,
    permissionOverrides,
    sdk: {
      doc,
      collection,
      getDoc,
      getDocs,
      setDoc,
      updateDoc,
      deleteDoc,
      query,
      where,
      orderBy,
      limit,
      writeBatch,
      runTransaction,
      serverTimestamp,
      Timestamp
    }
  } = fb;

  class HttpError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }
  const fail = (s, m) => {
    throw new HttpError(s, m);
  };
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  const clean = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const num = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
  const validKey = (k) => typeof k === 'string' && /^[a-zA-Z0-9_-]{12,80}$/.test(k);
  const nowIso = () => new Date().toISOString();
  const SALE_UNITS = ['un', 'pct', 'lata', 'garrafa', 'frasco', 'pote', 'par'];
  const METHODS = ['cash', 'pix', 'credit', 'debit', 'card', 'bank'];
  const REGISTER_METHODS = ['cash', 'pix', 'credit', 'debit', 'card'];
  const FINANCE_CATEGORIES = [
    'Mercadorias',
    'Pessoal',
    'Aluguel',
    'Energia',
    'Água',
    'Manutenção',
    'Taxas de cartão',
    'Outras despesas',
    'Receitas diversas',
    'Não classificado'
  ];

  const mediaCache = new Map();
  let mediaCacheBusinessId = null;
  let mediaCachePreloaded = false;

  function inferErrStatus(err) {
    if (err instanceof HttpError) return err.status;
    if(String(err?.message||'').includes('Limite de usuários ativos'))return 409;
    const msg = String(err?.message || '');
    if (
      err?.code === 'permission-denied' ||
      msg.includes('Missing or insufficient permissions') ||
      msg.includes('permission-denied')
    ) {
      return 403;
    }
    return 500;
  }

  function formatErrMessage(err) {
    if (err instanceof HttpError) return err.message;
    const msg = err?.message || 'Não foi possível concluir.';
    if (msg.startsWith('{') && msg.includes('"operationType"')) {
      try {
        const parsed = JSON.parse(msg);
        if (String(parsed.error || '').includes('Quota exceeded')) {
          return 'Cota diária gratuita do Firestore atingida. Tente novamente amanhã ou verifique o plano no Firebase Console.';
        }
        if (String(parsed.error || '').includes('Missing or insufficient permissions')) {
          return 'Seu usuário não tem permissão para esta operação no banco.';
        }
        return parsed.error || 'Erro ao acessar o banco.';
      } catch {
        return msg;
      }
    }
    if (msg.includes('Missing or insufficient permissions')) {
      return 'Seu usuário não tem permissão para esta operação no banco.';
    }
    return msg;
  }

  function assertPermission(user, permission) {
    if (!hasPermission(user, permission)) fail(403, 'Seu usuário não tem permissão para esta ação.');
  }

  function requireManager(user) {
    if (user.role !== 'admin') fail(403, 'Esta ação exige um administrador autenticado.');
  }

  function routePermission(method, path) {
    if (path.startsWith('/api/returns')) return 'payments.refund';
    if (path === '/api/business-kind') return method === 'GET' ? 'settings.read' : 'settings.manage';
    if (path === '/api/appearance') return method === 'PUT' ? 'settings.manage' : 'settings.read';
    if (path === '/api/media') return method === 'POST' ? 'products.manage' : 'catalog.read';
    if (path.startsWith('/api/customers')) return 'cash.access';
    if (/^\/api\/products\/[^/]+\/stock$/.test(path)) return 'reports.view';
    if (/^\/api\/orders\/[^/]+\/customer$/.test(path)) return 'payments.receive';
    if (path === '/api/profiles' || /^\/api\/profiles\/(admin|cashier|waiter)$/.test(path) || /^\/api\/employees\/[^/]+$/.test(path)) {
      return 'employees.manage';
    }
    if (/^\/api\/products\/[^/]+\/availability$/.test(path) && method==='PATCH') return 'products.manage';
    if (path === '/api/sales/direct' && method === 'POST') return 'payments.receive';
    if (path.startsWith('/api/erp/')) return 'reports.view';
    if (path === '/api/session' && method === 'GET') return 'profile.read';
    if (path === '/api/products') return method === 'GET' ? 'catalog.read' : method === 'POST' ? 'products.manage' : null;
    if (/^\/api\/products\/[^/]+$/.test(path) && ['PUT', 'DELETE'].includes(method)) return 'products.manage';
    if (path === '/api/catalog' && method === 'GET') return 'catalog.read';
    if (path === '/api/settings') return method === 'GET' ? 'settings.read' : method === 'PUT' ? 'settings.manage' : null;
    if (path === '/api/favorites' && method === 'PUT') return 'favorites.manage';
    if (path === '/api/tables') return method === 'GET' ? 'tables.read' : method === 'POST' ? 'tables.manage' : null;
    if (path === '/api/employees') return ['GET', 'POST'].includes(method) ? 'employees.manage' : null;
    if (path === '/api/drafts' || /^\/api\/drafts\/[^/]+$/.test(path)) {
      return ['GET', 'POST', 'DELETE'].includes(method) ? 'drafts.manage' : null;
    }
    if (path === '/api/orders') return method === 'GET' ? 'orders.read' : method === 'POST' ? 'orders.create' : null;
    const order = path.match(/^\/api\/orders\/[^/]+(?:\/(items|payment|finalize|delivery|cancel|discount|refund|hold|print|transfer|merge|split|kitchen-print))?$/);
    if (order) {
      if (method === 'GET' && order[1] === 'print') return 'orders.print';
      if (method === 'GET' && !order[1]) return 'orders.read';
      if (method !== 'POST') return null;
      return (
        {
          hold: 'payments.receive',
          items: 'orders.update',
          payment: 'payments.receive',
          finalize: 'payments.receive',
          delivery: 'orders.deliver',
          cancel: 'orders.cancel',
          discount: 'discounts.authorize',
          refund: 'payments.refund',
          transfer: 'payments.receive',
          merge: 'payments.receive',
          split: 'payments.receive',
          'kitchen-print': 'orders.print'
        }[order[1]] || null
      );
    }
    if (path === '/api/cash' && method === 'GET') return 'cash.access';
    if (path === '/api/cash/open' && method === 'POST') return 'cash.open';
    if (path === '/api/cash/close' && method === 'POST') return 'cash.close';
    if (path === '/api/cash/movement' && method === 'POST') return 'cash.movements';
    if (path === '/api/finance' && method === 'GET') return 'finance.view';
    if ((path === '/api/finance/accounts' || /^\/api\/finance\/accounts\/[^/]+\/settle$/.test(path)) && method === 'POST') {
      return 'finance.manage';
    }
    return null;
  }

  function authorizeRoute(user, method, path) {
    const permission = routePermission(method, path);
    if (!permission) {
      if (user.role !== 'admin') fail(403, 'Rota indisponível para este usuário.');
      return;
    }
    assertPermission(user, permission);
  }

  function redactPrivateFields(user, value) {
    if (hasPermission(user, 'products.costs')) return value;
    const privateFields = new Set([
      'cost_cents',
      'unit_cost_cents',
      'base_unit_cost_cents',
      'inventory_unit_cost_cents',
      'restored_cost_cents',
      'addons_json'
    ]);
    function visit(v) {
      if (Array.isArray(v)) return v.map(visit);
      if (v && typeof v === 'object') {
        return Object.fromEntries(
          Object.entries(v)
            .filter(([k]) => !privateFields.has(k))
            .map(([k, x]) => [k, visit(x)])
        );
      }
      return v;
    }
    return visit(value);
  }

  const productCode = (p) =>
    p.code == null ? 'P-' + String(p.id).replaceAll('-', '').slice(0, 12).toUpperCase() : String(p.code).padStart(6, '0');

  function ensureMediaCacheTenant(businessId) {
    if (mediaCacheBusinessId !== businessId) {
      mediaCache.clear();
      mediaCachePreloaded = false;
      mediaCacheBusinessId = businessId;
    }
  }

  async function resolveMediaUrl(businessId, key) {
    if (!key) return null;
    ensureMediaCacheTenant(businessId);
    if (mediaCache.has(key)) return mediaCache.get(key);
    const ref = doc(db, 'businesses', businessId, 'media', key);
    const snap = await getDoc(ref).catch((err) => handleFirestoreError(err, OperationType.GET, ref.path));
    if (snap && snap.exists()) {
      const url = snap.data().dataUrl || null;
      if (url) mediaCache.set(key, url);
      return url;
    }
    return null;
  }

  async function preloadMedia(businessId, force = false) {
    ensureMediaCacheTenant(businessId);
    if (mediaCachePreloaded && !force) return;
    const snap = await getDocs(collection(db, 'businesses', businessId, 'media')).catch((err) =>
      handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/media`)
    );
    snap.forEach((d) => {
      const m = d.data();
      if (m.key && m.dataUrl) mediaCache.set(m.key, m.dataUrl);
    });
    mediaCachePreloaded = true;
  }

  async function ensureMediaKeysLoaded(businessId, keys) {
    ensureMediaCacheTenant(businessId);
    const missing = [...new Set(keys.filter((k) => k && !mediaCache.has(k)))];
    if (!missing.length) return;
    if (!mediaCachePreloaded && missing.length > 6) {
      await preloadMedia(businessId);
      return;
    }
    await Promise.all(missing.map((k) => resolveMediaUrl(businessId, k)));
  }

  function canReadOrder(user, order) {
    if (!hasPermission(user, 'orders.read')) return false;
    if (hasPermission(user, 'orders.shared')) return true;
    if (order.actorId === user.id || order.actor_id === user.id) return true;
    return Array.isArray(order.items) && order.items.some((i) => i.actor_id === user.id);
  }

  function normalizeOptions(value) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 8) fail(400, 'Informe até oito grupos de opções.');
    const labels = new Set();
    return value.map((g) => {
      if (!g || typeof g !== 'object' || typeof g.label!=='string' || !clean(g.label, 60) || !Array.isArray(g.values) || g.values.length < 1 || g.values.length > 30) {
        fail(400, 'Grupo de opções inválido.');
      }
      const label = clean(g.label, 60);
      if (labels.has(label)) fail(400, 'Não repita o nome de um grupo.');
      labels.add(label);
      if(g.values.some(v=>typeof v!=='string'))fail(400,'As opções devem ser textos.');
      const values = [...new Set(g.values.map((v) => clean(v, 60)))];
      if (values.some((v) => !v)) fail(400, 'Opção vazia.');
      return { label, values, required: g.required !== false };
    });
  }

  function normalizeAddons(value) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 30) fail(400, 'Informe até 30 adicionais.');
    const seen = new Set();
    return value.map((a) => {
      if(!a||typeof a!=='object'||typeof a.name!=='string')fail(400,'Adicional inválido.');
      const name = clean(a.name, 60);
      if (!name || seen.has(name) || !num(a.price_cents, 0, 10000000) || !(a.cost_cents == null || num(a.cost_cents, 0, 10000000))) {
        fail(400, 'Confira nome, valor e custo dos adicionais.');
      }
      seen.add(name);
      return { name, price_cents: a.price_cents, cost_cents: a.cost_cents ?? null };
    });
  }

  function stripAddonCosts(addons) {
    return (addons || []).map((a) => ({ name: a.name, price_cents: a.price_cents }));
  }

  function addonCostMap(addons) {
    const out = Object.create(null);
    for (const a of addons || []) {
      out[a.name] = a.cost_cents ?? null;
    }
    return out;
  }

  function itemSelections(p, item) {
    const groups = p.options || [];
    const chosen = Object.create(null);
    for (const g of groups) {
      const v = item.selections?.[g.label];
      if ((v === undefined || v === '') && !g.required) continue;
      if (!g.values.includes(v)) fail(400, 'Escolha uma opção válida para ' + g.label + '.');
      chosen[g.label] = v;
    }
    const summary = Object.entries(chosen)
      .map(([k, v]) => k + ': ' + v)
      .join('; ');
    return { selections: chosen, note: [summary, clean(item.note, 200)].filter(Boolean).join('; ') };
  }

  function priceItem(p, item, user) {
    const choices = itemSelections(p, item);
    const available = p.addons || [];
    const selected = item.addons || [];
    if (!Array.isArray(selected) || selected.length > 30) fail(400, 'Adicionais inválidos.');
    const seen = new Set();
    const addons = [];
    let price = p.priceCents;
    let cost = p.effectiveCostCents ?? p.costCents ?? null;
    for (const a of selected) {
      const found = available.find((v) => v.name === a.name);
      if (!found || seen.has(a.name) || !num(a.quantity, 1, 10)) fail(400, 'Adicional indisponível ou quantidade inválida.');
      seen.add(a.name);
      price += found.price_cents * a.quantity;
      if (cost !== null && found.cost_cents !== null) cost += found.cost_cents * a.quantity;
      else cost = null;
      addons.push({ ...found, quantity: a.quantity });
    }
    if (price > 100000000) fail(400, 'Valor do item fora do limite.');
    return {
      id: crypto.randomUUID(),
      product_id: p.id,
      product_code: productCode(p),
      name: p.name,
      quantity: item.quantity,
      base_unit_price_cents: p.priceCents,
      unit_price_cents: price,
      unit_cost_cents: cost,
      sale_unit: p.saleUnit || 'un',
      packaging: p.packaging || '',
      barcode: p.barcode || null,
      inventory_unit_cost_cents: p.stockMode === 'unit' ? (p.effectiveCostCents ?? p.costCents ?? null) : null,
      stock_mode: p.trackStock ? p.stockMode || 'recipe' : 'none',
      finished_inventory_id: p.stockMode === 'unit' ? p.finishedInventoryId || null : null,
      addons,
      ...choices,
      actor_id: user.id,
      actor_name: user.name || 'Administrador'
    };
  }

  async function digestInput(value) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
    return Array.from(new Uint8Array(buf))
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('');
  }

  function settingsDto(s, biz) {
    if (!s) {
      return {
        id: 1,
        name: biz?.name || 'Seu estabelecimento',
        mode: 'essential',
        paper: 80,
        business_kind: 'food',
        legal_name: '',
        cnpj: '',
        address: '',
        phone: '',
        receipt_message: 'Obrigado pela preferência! Volte sempre.',
        blind_close: false,
        logo_key: null,
        logo_url: null,
        theme_color: '#6a330d'
      };
    }
    return {
      id: 1,
      name: s.name,
      mode: s.mode,
      paper: s.paper,
      business_kind: s.businessKind || 'food',
      modules:s.modules??null,
      user_limit:s.userLimit??null,
      active_user_count:s.activeUserCount??null,
      legal_name: s.legalName || '',
      cnpj: s.cnpj || '',
      address: s.address || '',
      phone: s.phone || '',
      receipt_message: s.receiptMessage || 'Obrigado pela preferência! Volte sempre.',
      blind_close: !!s.blindClose,
      logo_key: s.logoKey || null,
      logo_url: s.logoKey ? mediaCache.get(s.logoKey) || null : null,
      theme_color: s.themeColor || '#6a330d',
      updated_at: tsToIso(s.updatedAt)
    };
  }

  function productDto(p, extraCost = null, stockMeta = null) {
    const costCents = extraCost !== null ? extraCost : null;
    return {
      id: p.id,
      code: productCode(p),
      name: p.name,
      description: p.description || '',
      category: p.category || '',
      price_cents: p.priceCents,
      cost_cents: costCents,
      image_key: p.imageKey || null,
      image_url: p.imageKey ? mediaCache.get(p.imageKey) || null : null,
      active: !!p.active,
      available: !!p.available,
      visible: !!p.visible,
      options: p.options || [],
      addons: p.addons || [],
      quick_notes: p.quickNotes || [],
      barcode: p.barcode || null,
      sale_unit: p.saleUnit || 'un',
      packaging: p.packaging || '',
      stock_mode: p.stockMode || 'none',
      finished_inventory_id: p.finishedInventoryId || null,
      track_stock: !!p.trackStock,
      cost_mode: p.costMode || 'direct',
      stock_units: stockMeta ? stockMeta.stock_units : undefined,
      minimum_stock: stockMeta ? stockMeta.minimum_stock : undefined,
      version: p.version || 1,
      created_at: tsToIso(p.createdAt),
      updated_at: tsToIso(p.updatedAt)
    };
  }

  function orderDto(o, paidCents = null, refundCents = null) {
    const paid = paidCents !== null ? paidCents : o.paidCents ?? 0;
    const refund = refundCents !== null ? refundCents : o.refundCents ?? 0;
    return {
      id: o.id,
      number: o.number,
      request_key: o.requestKey,
      table_number: o.tableNumber ?? null,
      state: o.state,
      fulfillment: o.fulfillment,
      items: (o.items || []).map((i) => ({ ...i, product_code: i.product_code || productCode({ id: i.product_id, code: null }) })),
      total_cents: o.totalCents,
      discount_cents: o.discountCents || 0,
      subtotal_cents: o.totalCents + (o.discountCents || 0),
      discount_reason: o.discountReason || '',
      authorized_by: o.authorizedBy || null,
      actor_id: o.actorId,
      attendant_name: o.attendantName || 'Administrador',
      customer_id: o.customerId || null,
      customer_name: o.customerName || '',
      checkout_waiting: !!o.checkoutWaiting,
      checkout_held_at: tsToIso(o.checkoutHeldAt),
      checkout_held_by: o.checkoutHeldBy || null,
      exchange_from_order_id: o.exchangeFromOrderId || null,
      paid_cents: paid,
      refund_cents: refund,
      balance_due_cents: o.state === 'open' ? Math.max(0, o.totalCents - paid) : 0,
      version: o.version || 1,
      created_at: tsToIso(o.createdAt),
      updated_at: tsToIso(o.updatedAt),
      closed_at: tsToIso(o.closedAt)
    };
  }

  function ledgerDto(l) {
    return {
      id: l.id,
      request_key: l.requestKey,
      session_id: l.sessionId || null,
      order_id: l.orderId || null,
      account_id: l.accountId || null,
      reversal_of: l.reversalOf || null,
      kind: l.kind,
      method: l.method,
      amount_cents: l.amountCents,
      tendered_cents: l.tenderedCents ?? null,
      description: l.description,
      reason: l.reason || '',
      category: l.category || 'Não classificado',
      finance_account: l.financeAccount,
      actor_id: l.actorId,
      authorized_by: l.authorizedBy || null,
      reconciled_at: tsToIso(l.reconciledAt),
      external_reference: l.externalReference || null,
      reconciled_by: l.reconciledBy || null,
      created_at: tsToIso(l.createdAt)
    };
  }

  function cashSessionDto(s, cashLedger = null) {
    let balance = s.cashBalanceCents;
    if (typeof balance !== 'number' || Array.isArray(cashLedger)) {
      if (Array.isArray(cashLedger)) {
        const cashSum = cashLedger
          .filter((l) => l.sessionId === s.id && l.method === 'cash')
          .reduce((acc, l) => acc + l.amountCents, 0);
        balance = typeof s.cashBalanceCents === 'number' ? s.cashBalanceCents : s.openingCents + cashSum;
      } else {
        balance = s.openingCents;
      }
    }
    return {
      id: s.id,
      opening_cents: s.openingCents,
      counted_cents: s.countedCents ?? null,
      expected_cents: s.expectedCents ?? null,
      difference_cents: s.differenceCents ?? null,
      counted_methods_json: s.countedMethods ? JSON.stringify(s.countedMethods) : null,
      expected_methods_json: s.expectedMethods ? JSON.stringify(s.expectedMethods) : null,
      difference_methods_json: s.differenceMethods ? JSON.stringify(s.differenceMethods) : null,
      balance_cents: balance,
      state: s.state,
      actor_id: s.actorId,
      opened_at: tsToIso(s.openedAt),
      closed_at: tsToIso(s.closedAt)
    };
  }

  async function getSettings(businessId) {
    const ref = doc(db, 'businesses', businessId, 'settings', 'main');
    const snap = await getDoc(ref).catch((err) => handleFirestoreError(err, OperationType.GET, ref.path));
    return snap.exists() ? snap.data() : null;
  }

  async function getOpenCashSession(businessId) {
    const lockRef = doc(db, 'businesses', businessId, 'locks', 'activeCashSession');
    const lockSnap = await getDoc(lockRef).catch(() => null);
    if (lockSnap && lockSnap.exists()) {
      const ld = lockSnap.data();
      if (!ld.active || !ld.resourceId) return null;
      const csRef = doc(db, 'businesses', businessId, 'cashSessions', ld.resourceId);
      const csSnap = await getDoc(csRef).catch((err) => handleFirestoreError(err, OperationType.GET, csRef.path));
      if (csSnap.exists() && csSnap.data().state === 'open') return csSnap.data();
      return null;
    }
    const colRef = collection(db, 'businesses', businessId, 'cashSessions');
    const snap = await getDocs(query(colRef, where('state', '==', 'open'), limit(1))).catch((err) =>
      handleFirestoreError(err, OperationType.LIST, colRef.path)
    );
    return snap.empty ? null : snap.docs[0].data();
  }

  async function computeProductCosts(businessId, products, user) {
    const settings=await getSettings(businessId);
    const mods=window.IDContract?.modules(settings||{}) || {inventory:true,costs:true};
    const canSeeCosts = mods.costs && hasPermission(user, 'products.costs');
    const [stockSnap, recipeSnap] = await Promise.all([
      (mods.inventory ? getDocs(collection(db, 'businesses', businessId, 'inventoryStock')) : Promise.resolve({docs:[]})).catch((err) =>
        handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/inventoryStock`)
      ),
      ((mods.inventory||mods.costs) ? getDocs(collection(db, 'businesses', businessId, 'recipes')) : Promise.resolve({docs:[]})).catch((err) =>
        handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/recipes`)
      )
    ]);
    const stockMap = new Map();
    stockSnap.docs.forEach((d) => stockMap.set(d.id, d.data().balanceMilli || 0));

    const recipeMap = new Map();
    recipeSnap.docs.forEach((d) => recipeMap.set(d.id, d.data().items || []));

    const costMap = new Map();
    const invMap = new Map();

    if (canSeeCosts && products.length) {
      const neededItemIds = new Set();
      for (const p of products) {
        if (p.stockMode === 'unit' && p.finishedInventoryId) neededItemIds.add(p.finishedInventoryId);
        if (p.costMode === 'recipe') {
          for (const r of recipeMap.get(p.id) || []) {
            if (r.itemId) neededItemIds.add(r.itemId);
          }
        }
      }
      const [costSnaps, invSnaps] = await Promise.all([
        Promise.all(
          products.map((p) => {
            const cRef = doc(db, 'businesses', businessId, 'products', p.id, 'private', 'cost');
            return getDoc(cRef).catch((err) => handleFirestoreError(err, OperationType.GET, cRef.path));
          })
        ),
        Promise.all(
          [...neededItemIds].map((itemId) => {
            const iRef = doc(db, 'businesses', businessId, 'inventoryItems', itemId);
            return getDoc(iRef).catch((err) => handleFirestoreError(err, OperationType.GET, iRef.path));
          })
        )
      ]);
      costSnaps.forEach((snap, idx) => {
        if (snap && snap.exists()) {
          const d = snap.data();
          costMap.set(products[idx].id, {
            costCents: d.costCents ?? null,
            addonCosts: d.addonCosts || {}
          });
        }
      });
      invSnaps.forEach((snap) => {
        if (snap && snap.exists()) invMap.set(snap.id, snap.data());
      });
    }

    return products.map((p) => {
      const priv = costMap.get(p.id);
      const baseCost = canSeeCosts ? (priv?.costCents ?? p.costCents ?? null) : null;
      const addonsWithCosts = (p.addons || []).map((a) => ({
        ...a,
        cost_cents: canSeeCosts ? (priv?.addonCosts?.[a.name] ?? a.cost_cents ?? null) : null
      }));
      if (p.stockMode === 'unit' && p.finishedInventoryId) {
        const inv = invMap.get(p.finishedInventoryId);
        const bal = stockMap.get(p.finishedInventoryId) || 0;
        const costCents =
          canSeeCosts && inv && inv.unitCostMicro != null ? Math.round(inv.unitCostMicro / 1000000) : baseCost;
        return {
          ...p,
          addons: addonsWithCosts,
          effectiveCostCents: costCents,
          stockMeta: {
            stock_units: bal / 1000,
            minimum_stock: (inv?.minimumMilli || 0) / 1000
          }
        };
      }
      if (p.costMode === 'recipe' && canSeeCosts) {
        const items = recipeMap.get(p.id) || [];
        if (!items.length || items.some((r) => invMap.get(r.itemId)?.unitCostMicro == null)) {
          return { ...p, addons: addonsWithCosts, effectiveCostCents: null, stockMeta: null };
        }
        const sum = Math.round(
          items.reduce((t, r) => t + (r.quantityMilli * invMap.get(r.itemId).unitCostMicro) / 1e9, 0)
        );
        return { ...p, addons: addonsWithCosts, effectiveCostCents: sum, stockMeta: null };
      }
      return { ...p, addons: addonsWithCosts, effectiveCostCents: baseCost, stockMeta: null };
    });
  }

  async function loadProductsByIds(businessId, ids, user) {
    const unique = [...new Set(ids.filter(Boolean))];
    const snaps = await Promise.all(
      unique.map((id) => {
        const pRef = doc(db, 'businesses', businessId, 'products', id);
        return getDoc(pRef).catch((err) => handleFirestoreError(err, OperationType.GET, pRef.path));
      })
    );
    const raw = snaps.filter((s) => s && s.exists()).map((s) => s.data());
    const enriched = await computeProductCosts(businessId, raw, user);
    return new Map(enriched.map((p) => [p.id, p]));
  }

  async function prepareCounter(tx, businessId, counterName) {
    const ref = doc(db, 'businesses', businessId, 'counters', counterName);
    const snap = await tx.get(ref);
    const next = (snap.exists() ? snap.data().value || 0 : 0) + 1;
    return {
      value: next,
      apply: () => tx.set(ref, { value: next, updatedAt: serverTimestamp() })
    };
  }

  function idemDocId(scope, key) {
    return ('id_' + scope + '_' + String(key || '').replace(/[^a-zA-Z0-9_-]/g, '_')).slice(0, 128);
  }

  function cashLockDocRef(businessId) {
    return doc(db, 'businesses', businessId, 'locks', 'activeCashSession');
  }

  function tableLockDocRef(businessId, tableNumber) {
    return doc(db, 'businesses', businessId, 'locks', 'table_' + String(tableNumber));
  }

  function storedItemsTotal(items) {
    return (items || []).reduce((sum, item) => sum + item.quantity * item.unit_price_cents, 0);
  }

  function orderOperationRef(businessId, operationId) {
    return doc(db, 'businesses', businessId, 'orderOperations', operationId);
  }

  function orderOperationPayload(id, kind, sourceOrderId, targetOrderId, reason, user, details = {}) {
    return { id, kind, sourceOrderId, targetOrderId: targetOrderId || null, reason: clean(reason, 200), actorId: user.id, details, createdAt: serverTimestamp() };
  }

  function nextSessionTotals(csData, method, deltaCents, fallbackTotals = null) {
    const baseTotals =
      csData.methodTotals && typeof csData.methodTotals === 'object'
        ? { ...csData.methodTotals }
        : fallbackTotals
        ? { ...fallbackTotals }
        : { cash: csData.openingCents, pix: 0, credit: 0, debit: 0, card: 0 };
    const currentCash =
      typeof csData.cashBalanceCents === 'number'
        ? csData.cashBalanceCents
        : baseTotals.cash ?? csData.openingCents;
    const nextCash = method === 'cash' ? currentCash + deltaCents : currentCash;
    if (nextCash < 0) fail(409, 'Dinheiro da gaveta insuficiente para esta operação.');
    if (REGISTER_METHODS.includes(method)) {
      baseTotals[method] = (baseTotals[method] || 0) + deltaCents;
    }
    return { cashBalanceCents: nextCash, methodTotals: baseTotals };
  }

  async function prepareInventoryDeduction(tx, businessId, pricedItems, sourceId, user) {
    const uniqueIds=[...new Set(pricedItems.map(i=>i.product_id))];
    const freshProducts=await Promise.all(uniqueIds.map(id=>tx.get(doc(db,'businesses',businessId,'products',id))));
    const freshById=new Map(freshProducts.filter(d=>d.exists()).map(d=>[d.id,d.data()]));
    for(const line of pricedItems){
      const product=freshById.get(line.product_id);
      if(!product?.active||!product.available)fail(409,'Um produto ficou esgotado ou inativo. Atualize o catálogo e confira o pedido.');
      let repriced;
      try{repriced=priceItem(product,line,user);}catch{fail(409,'As opções ou os adicionais mudaram. Confira o produto antes de lançar.');}
      if(repriced.unit_price_cents!==line.unit_price_cents || repriced.name!==line.name
        || repriced.stock_mode!==line.stock_mode || repriced.finished_inventory_id!==line.finished_inventory_id)
        fail(409,'O cadastro do produto mudou durante o atendimento. Atualize e confira o pedido antes de lançar.');
    }

    const needs = new Map();
    const seenProducts = new Map();
    const toFetch = [];
    for (const line of pricedItems) {
      if (!line.stock_mode || line.stock_mode === 'none') continue;
      if (!seenProducts.has(line.product_id)) {
        seenProducts.set(line.product_id, line);
        toFetch.push(line.product_id);
      }
    }
    const recipeSnaps = await Promise.all(
      toFetch.map((pid) => tx.get(doc(db, 'businesses', businessId, 'recipes', pid)))
    );
    const recipeByPid = new Map();
    recipeSnaps.forEach((snap, idx) => {
      recipeByPid.set(toFetch[idx], snap.exists() ? snap.data().items || [] : []);
    });
    for (const line of pricedItems) {
      if (!line.stock_mode || line.stock_mode === 'none') continue;
      const items = recipeByPid.get(line.product_id) || [];
      if (!items.length) {
        if (line.stock_mode === 'unit' && line.finished_inventory_id) {
          needs.set(line.finished_inventory_id, (needs.get(line.finished_inventory_id) || 0) + 1000 * line.quantity);
        } else {
          fail(409, 'Produto com estoque ativado precisa de composição.');
        }
      } else {
        for (const r of items) {
          needs.set(r.itemId, (needs.get(r.itemId) || 0) + r.quantityMilli * line.quantity);
        }
      }
    }
    const entries = [...needs.entries()];
    const stockSnaps = await Promise.all(
      entries.map(([itemId, qty]) => {
        if (!num(qty, 1, 1e12)) fail(400, 'Quantidade de estoque fora do limite.');
        return tx.get(doc(db, 'businesses', businessId, 'inventoryStock', itemId));
      })
    );
    const stockReads = entries.map(([itemId, qty], idx) => {
      const sRef = doc(db, 'businesses', businessId, 'inventoryStock', itemId);
      const sSnap = stockSnaps[idx];
      return {
        itemId,
        qty,
        sRef,
        currentBal: sSnap.exists() ? sSnap.data().balanceMilli || 0 : 0,
        exists: sSnap.exists()
      };
    });
    return () => {
      for (const sr of stockReads) {
        if (!sr.exists || sr.currentBal < sr.qty) {
          fail(409, 'Saldo em estoque insuficiente para concluir esta venda.');
        }
        const delta = -sr.qty;
        tx.update(sr.sRef, {
          balanceMilli: sr.currentBal + delta,
          updatedAt: serverTimestamp()
        });
        const moveId = crypto.randomUUID();
        tx.set(doc(db, 'businesses', businessId, 'inventoryMoves', moveId), {
          id: moveId,
          requestKey: 'stock:' + sourceId + ':' + sr.itemId,
          itemId: sr.itemId,
          quantityMilli: delta,
          kind: 'sale',
          sourceId,
          reason: 'Baixa de estoque na venda',
          actorId: user.id,
          createdAt: serverTimestamp()
        });
      }
    };
  }

  async function orderLedgerSummary(businessId, orderId) {
    const snap = await getDocs(
      query(collection(db, 'businesses', businessId, 'ledger'), where('orderId', '==', orderId))
    ).catch((err) => handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/ledger`));
    const all = snap.docs
      .map((d) => d.data())
      .filter((l) => l.kind === 'sale' || l.kind === 'refund')
      .sort((a, b) => new Date(tsToIso(a.createdAt) || 0) - new Date(tsToIso(b.createdAt) || 0));
    const paid = all.reduce((s, l) => s + l.amountCents, 0);
    const refund = all.filter((l) => l.kind === 'refund').reduce((s, l) => s - l.amountCents, 0);
    return { payments: all, paid, refund };
  }

  async function detailedOrder(businessId, orderId, user = null, includeLedger = false) {
    const ref = doc(db, 'businesses', businessId, 'orders', orderId);
    const canReadLedger =
      user && (hasPermission(user, 'cash.access') || hasPermission(user, 'payments.receive') || hasPermission(user, 'payments.refund'));
    const oSnap = await getDoc(ref).catch((err) => handleFirestoreError(err, OperationType.GET, ref.path));
    if (!oSnap.exists()) fail(404, 'Comanda não encontrada.');
    const raw = oSnap.data();
    const needLedger = canReadLedger && (includeLedger || raw.paidCents === undefined);
    const sum = needLedger
      ? await orderLedgerSummary(businessId, orderId)
      : { payments: [], paid: raw.paidCents ?? 0, refund: raw.refundCents ?? 0 };
    return { dto: orderDto(raw, sum.paid, sum.refund), raw, payments: sum.payments };
  }

  function periodRange(params) {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const from = params.get('from') || today.slice(0, 7) + '-01';
    const to = params.get('to') || today;
    const valid = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
    if (!valid(from) || !valid(to) || from > to) fail(400, 'Período inválido.');
    const start = new Date(from + 'T00:00:00-03:00');
    const end = new Date(to + 'T00:00:00-03:00');
    end.setUTCDate(end.getUTCDate() + 1);
    if (end - start > 367 * 86400000) fail(400, 'Escolha até um ano por consulta.');
    return { from, to, start: start.toISOString(), end: end.toISOString() };
  }

  async function managementReport(businessId, range) {
    const reportSettings=await getSettings(businessId);
    const reportModules=window.IDContract?.modules(reportSettings||{}) || {costs:true,finance:true};
    const startTs = Timestamp.fromDate(new Date(range.start));
    const endTs = Timestamp.fromDate(new Date(range.end));
    const [ordersSnap, ledgerSnap, returnsSnap] = await Promise.all([
      getDocs(
        query(collection(db, 'businesses', businessId, 'orders'), where('closedAt', '>=', startTs), where('closedAt', '<', endTs), limit(5001))
      ),
      getDocs(
        query(collection(db, 'businesses', businessId, 'ledger'), where('createdAt', '>=', startTs), where('createdAt', '<', endTs), limit(15001))
      ),
      getDocs(
        query(collection(db, 'businesses', businessId, 'returns'), where('createdAt', '>=', startTs), where('createdAt', '<', endTs), limit(5001))
      )
    ]).catch((err) => handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/reports`));

    const raw = ordersSnap.docs
      .map((d) => d.data())
      .filter((o) => o.state === 'closed')
      .sort((a, b) => a.number - b.number);
    if (raw.length > 5000) fail(422, 'Reduza o período para até 5.000 vendas.');

    const movement = ledgerSnap.docs.map((d) => d.data());
    if (movement.length > 15000) fail(422, 'Reduza o período para até 15.000 movimentos.');

    const products = new Map();
    const staff = new Map();
    const daily = new Map();
    let revenue = 0;
    let costKnown = 0;
    let missingCost = 0;

    for (const o of raw) {
      const items = o.items || [];
      const gross = items.reduce((t, i) => t + i.quantity * i.unit_price_cents, 0);
      const net = o.totalCents;
      revenue += net;
      let assigned = 0;
      items.forEach((i, n) => {
        const value = n === items.length - 1 ? net - assigned : Math.round((net * (i.quantity * i.unit_price_cents)) / (gross || 1));
        assigned += value;
        const p = products.get(i.product_id) || {
          id: i.product_id,
          code: i.product_code || '',
          name: i.name,
          quantity: 0,
          revenue_cents: 0,
          cost_cents: 0,
          missing_cost_quantity: 0
        };
        p.quantity += i.quantity;
        p.revenue_cents += value;
        if (i.unit_cost_cents === null || i.unit_cost_cents === undefined) {
          p.missing_cost_quantity += i.quantity;
          missingCost += i.quantity;
        } else {
          p.cost_cents += i.quantity * i.unit_cost_cents;
          costKnown += i.quantity * i.unit_cost_cents;
        }
        products.set(i.product_id, p);

        const s = staff.get(i.actor_id) || {
          id: i.actor_id,
          name: i.actor_name || o.attendantName || 'Administrador',
          orders: new Set(),
          quantity: 0,
          revenue_cents: 0
        };
        s.orders.add(o.id);
        s.quantity += i.quantity;
        s.revenue_cents += value;
        staff.set(i.actor_id, s);
      });
      const day = new Date(tsToIso(o.closedAt) || tsToIso(o.createdAt)).toLocaleDateString('en-CA', {
        timeZone: 'America/Sao_Paulo'
      });
      daily.set(day, (daily.get(day) || 0) + net);
    }

    for (const m of movement.filter((x) => x.kind === 'refund')) {
      revenue += m.amountCents;
      const day = new Date(tsToIso(m.createdAt)).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      daily.set(day, (daily.get(day) || 0) + m.amountCents);
    }

    const expenses = movement.filter((m) => ['expense', 'payable', 'fee'].includes(m.kind) && m.category !== 'Mercadorias');
    const expenseTotal = -expenses.reduce((t, m) => t + m.amountCents, 0);
    const unclassified = expenses.filter((m) => m.category === 'Não classificado').length;

    const returns = returnsSnap.docs.map((d) => d.data());
    const restored = returns.reduce((n, x) => n + (x.restoredCostCents || 0), 0);
    const extraUnknown = returns
      .filter((x) => {
        const orig = tsToIso(x.originalClosedAt);
        return orig < range.start || orig >= range.end;
      })
      .reduce((n, x) => n + (x.unknownCostQuantity || 0), 0);

    costKnown -= restored;
    missingCost += extraUnknown;

    return {
      ...range,
      summary: {
        orders: raw.length,
        revenue_cents: revenue,
        ticket_cents: raw.length ? Math.round(revenue / raw.length) : 0,
        known_cost_cents: reportModules.costs ? costKnown : null,
        missing_cost_quantity: missingCost,
        operating_expenses_cents: reportModules.finance ? expenseTotal : null,
        unclassified_expenses: unclassified,
        estimated_result_cents: !reportModules.costs || !reportModules.finance || missingCost || unclassified ? null : revenue - costKnown - expenseTotal,
        discounts_cents: raw.reduce((t, o) => t + (o.discountCents || 0), 0),
        refunds_cents: -movement.filter((m) => m.kind === 'refund').reduce((t, m) => t + m.amountCents, 0),
        received_cents: movement.filter((m) => ['sale', 'refund'].includes(m.kind)).reduce((t, m) => t + m.amountCents, 0),
        returned_stock_cost_cents: reportModules.costs ? restored : null
      },
      products: [...products.values()].map(p=>reportModules.costs?p:{...p,cost_cents:null}).sort((a, b) => b.quantity - a.quantity),
      staff: [...staff.values()]
        .map((s) => ({ ...s, orders: s.orders.size, ticket_cents: Math.round(s.revenue_cents / s.orders.size) }))
        .sort((a, b) => b.revenue_cents - a.revenue_cents),
      daily: [...daily].sort().map(([date, revenue_cents]) => ({ date, revenue_cents })),
      note: 'Produtos e atendentes mostram vendas após descontos, antes de estornos. Os estornos reduzem o resultado e o movimento na data da devolução. Resultado estimado: usa custos registrados na venda e despesas pagas no período. Compras de mercadorias não são somadas novamente ao CMV. Não representa demonstração contábil por competência. Devoluções com retorno ao estoque revertem o custo histórico no período da devolução.'
    };
  }


  async function originalPaymentMethod(businessId, p, allOrderSales) {
    const seen = new Set();
    let row = p;
    for (let n = 0; n < 50; n++) {
      if (row.method !== 'exchange_credit') return row.method;
      if (!row.reversalOf || seen.has(row.id)) break;
      seen.add(row.id);
      const ref = doc(db, 'businesses', businessId, 'ledger', row.reversalOf);
      const snap = await getDoc(ref).catch(() => null);
      if (!snap || !snap.exists()) break;
      row = snap.data();
    }
    fail(409, 'Não foi possível identificar a forma original da compensação. Solicite suporte antes de estornar.');
  }

  async function returnDetail(businessId, user, orderId) {
    const { dto: order } = await detailedOrder(businessId, orderId, user, true);
    if (!canReadOrder(user, order)) fail(403, 'Venda fora do seu atendimento.');

    const [retSnap, ledgerSnap] = await Promise.all([
      getDocs(query(collection(db, 'businesses', businessId, 'returns'), where('orderId', '==', orderId))),
      getDocs(query(collection(db, 'businesses', businessId, 'ledger'), where('orderId', '==', orderId)))
    ]).catch((err) => handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/returns`));

    const returns = retSnap.docs.map((d) => d.data()).sort((a, b) => new Date(tsToIso(b.createdAt) || 0) - new Date(tsToIso(a.createdAt) || 0));
    const returnedMap = new Map();
    for (const r of returns) {
      for (const l of r.lines || []) {
        returnedMap.set(l.item_id, (returnedMap.get(l.item_id) || 0) + l.quantity);
      }
    }

    const gross = order.items.reduce((n, i) => n + i.quantity * i.unit_price_cents, 0);
    let assigned = 0;
    const lines = [];
    for (let n = 0; n < order.items.length; n++) {
      const i = order.items[n];
      const net = n === order.items.length - 1 ? order.total_cents - assigned : Math.round((order.total_cents * (i.quantity * i.unit_price_cents)) / (gross || 1));
      assigned += net;
      let inventoryId = null;
      if (i.stock_mode === 'unit' && i.finished_inventory_id) {
        inventoryId = i.finished_inventory_id;
      }
      const inventoryCost =
        i.inventory_unit_cost_cents !== undefined
          ? i.inventory_unit_cost_cents
          : i.unit_cost_cents == null || (i.addons || []).some((a) => a.cost_cents == null)
          ? null
          : i.unit_cost_cents - (i.addons || []).reduce((acc, a) => acc + a.cost_cents * a.quantity, 0);
      const prev = returnedMap.get(i.id) || 0;
      lines.push({
        ...i,
        inventory_unit_cost_cents: inventoryCost,
        net_cents: net,
        returned_quantity: prev,
        remaining_quantity: Math.max(0, i.quantity - prev),
        restock_allowed: !!inventoryId,
        inventory_id: inventoryId
      });
    }

    const orderLedger = ledgerSnap.docs.map((d) => d.data());
    const saleEntries = orderLedger
      .filter((l) => l.kind === 'sale')
      .sort((a, b) => new Date(tsToIso(a.createdAt) || 0) - new Date(tsToIso(b.createdAt) || 0));
    const refundEntries = orderLedger.filter((l) => l.kind === 'refund');
    const payments = [];
    for (const p of saleEntries) {
      const refundedForPayment = refundEntries.filter((r) => r.reversalOf === p.id).reduce((s, r) => s + r.amountCents, 0);
      payments.push({
        ...ledgerDto(p),
        available: p.amountCents + refundedForPayment,
        refund_method: await originalPaymentMethod(businessId, p, saleEntries)
      });
    }

    return {
      order,
      lines,
      payments,
      returns: returns.map((r) => ({
        id: r.id,
        kind: r.kind,
        amount_cents: r.amountCents,
        reason: r.reason,
        replacement_order_id: r.replacementOrderId || null,
        created_at: tsToIso(r.createdAt)
      }))
    };
  }

  async function handleApiRequest(url, options) {
    const account = window.ERP_ACCOUNT;
    if (!account || !account.business || !auth.currentUser) {
      fail(401, 'Entre para continuar.');
    }
    if (account.support && !account.support.write_enabled && (options.method || 'GET').toUpperCase() !== 'GET') {
      fail(403, 'Atendimento de suporte em modo somente consulta.');
    }
    const businessId = account.business.id;
    const businessCode = account.business.code;
    const user = account.user;
    const method = (options.method || 'GET').toUpperCase();
    const path = url.pathname;

    authorizeRoute(user, method, path);

    const currentSettings = await getSettings(businessId);
    const contractMods=window.IDContract?.modules(currentSettings||{}) || {tables:true,finance:true,inventory:true,costs:true};
    const requiredModule = /^\/api\/tables(?:\/|$)/.test(path)?'tables':/^\/api\/erp\/(accounts|finance|financial|reconcile|ledger)(?:\/|$)/.test(path)?'finance':/^\/api\/erp\/(inventory|stock|purchases|suppliers)(?:\/|$)/.test(path)?'inventory':/^\/api\/erp\/(recipes|costs)(?:\/|$)/.test(path)?'costs':null;
    if(/^\/api\/finance(?:\/|$)/.test(path)&&!contractMods.finance)fail(403,'Financeiro completo não contratado.');
    if(requiredModule&&!contractMods[requiredModule]){
      if(path==='/api/tables'&&method==='GET')return json({tables:[]});
      fail(403,'Este recurso não está contratado para o estabelecimento.');
    }
    const requiredPermission=routePermission(method,path);
    if(requiredPermission && window.IDContract && !IDContract.allowed(currentSettings||{},requiredPermission))fail(403,'Módulo não contratado.');
    const isRetail = currentSettings?.businessKind === 'retail';
    if (isRetail) {
      if (user.role === 'waiter') fail(403, 'O perfil garçom não é utilizado no varejo. Peça ao administrador para ajustar seu perfil.');
      if (path === '/api/tables' && method === 'GET') return json({ tables: [] });
      if ((path === '/api/tables' && method !== 'GET') || (path === '/api/orders' && method === 'POST')) {
        fail(409, 'No varejo, use venda direta ou venda em espera. Mesas e comandas estão desativadas.');
      }
      if (/^\/api\/orders\/[^/]+\/(items|hold)$/.test(path) && method === 'POST') {
        fail(409, 'No varejo, use venda direta ou venda em espera. Comandas estão desativadas.');
      }
      if (path === '/api/profiles/waiter') {
        fail(409, 'O perfil Garçom não está disponível na modalidade Varejo.');
      }
      if (path === '/api/erp/recipes' || /^\/api\/erp\/recipes\/[^/]+$/.test(path)) {
        fail(409, 'Fichas técnicas não estão disponíveis na modalidade Varejo.');
      }
    }

    // /api/session
    if (path === '/api/session' && method === 'GET') {
      return json({
        user: {
          id: user.id,
          name: user.name,
          email: user.email || null,
          username: user.username || null,
          role: user.role,
          permissions: user.permissions.filter(p=>!window.IDContract||IDContract.allowed(currentSettings||{},p))
        },
        database: true,
        storage: true,
        staff_login: true
      });
    }

    // /api/media upload
    if (path === '/api/media' && method === 'POST') {
      const rawBody = options.body;
      const mime = (options.headers && (options.headers['Content-Type'] || options.headers.get?.('Content-Type'))) || rawBody?.type || '';
      const blob = rawBody instanceof Blob && rawBody.type ? rawBody : new Blob([rawBody], { type: mime });
      const compressed = await compressImageFile(blob);
      const key = crypto.randomUUID();
      const mediaRef = doc(db, 'businesses', businessId, 'media', key);
      const auditId = crypto.randomUUID();
      const batch = writeBatch(db);
      batch.set(mediaRef, {
        key,
        mime: compressed.mime,
        size: compressed.size,
        dataUrl: compressed.dataUrl,
        createdBy: auth.currentUser.uid,
        createdAt: serverTimestamp()
      });
      batch.set(doc(db, 'businesses', businessId, 'auditLogs', auditId), {
        id: auditId,
        actorId: auth.currentUser.uid,
        action: 'media.upload',
        entityId: key,
        createdAt: serverTimestamp()
      });
      await batch.commit().catch((err) => handleFirestoreError(err, OperationType.WRITE, mediaRef.path));
      mediaCache.set(key, compressed.dataUrl);
      return json({ key, url: compressed.dataUrl }, 201);
    }

    const body =
      options.body && typeof options.body === 'string'
        ? JSON.parse(options.body)
        : options.body && typeof options.body === 'object' && !(options.body instanceof Blob)
        ? options.body
        : {};

    // /api/settings & /api/appearance & /api/business-kind
    if (path === '/api/settings') {
      if (method === 'GET') {
        await preloadMedia(businessId);
        return json(settingsDto(currentSettings, account.business));
      }
      if (method === 'PUT') {
        if(['modules','userLimit','user_limit','activeUserCount','businessKind','business_kind'].some(k=>Object.hasOwn(body,k)))fail(403,'Somente a plataforma pode alterar o contrato.');
        const name = clean(body.name, 80);
        const cnpj = clean(body.cnpj, 30).replace(/\D/g, '');
        if (cnpj && cnpj.length !== 14) fail(400, 'Informe o CNPJ com 14 dígitos.');
        if (!name) fail(400, 'Informe o nome do estabelecimento.');
        if (!['essential', 'complete'].includes(body.mode) || ![58, 80].includes(body.paper)) {
          fail(400, 'Configuração inválida.');
        }
        const batch = writeBatch(db);
        const nextLogo = currentSettings?.logoKey || null;
        const themeColor = currentSettings?.themeColor || '#6a330d';
        batch.set(doc(db, 'businesses', businessId, 'settings', 'main'), {
          ...currentSettings,
          name,
          mode: body.mode,
          paper: body.paper,
          businessKind: currentSettings?.businessKind === 'retail' ? 'retail' : 'food',
          legalName: clean(body.legal_name, 150),
          cnpj,
          address: clean(body.address, 300),
          phone: clean(body.phone, 30),
          receiptMessage: clean(body.receipt_message, 200) || 'Obrigado pela preferência! Volte sempre.',
          blindClose: !!body.blind_close,
          logoKey: nextLogo,
          themeColor,
          updatedAt: serverTimestamp()
        });
        batch.set(doc(db, 'businesses', businessId, 'publicSettings', 'menu'), {
          name,
          address: clean(body.address, 300),
          phone: clean(body.phone, 30),
          logoDataUrl: nextLogo ? await resolveMediaUrl(businessId, nextLogo) : null,
          themeColor,
          active: true,
          updatedAt: serverTimestamp()
        });
        const auditId = crypto.randomUUID();
        batch.set(doc(db, 'businesses', businessId, 'auditLogs', auditId), {
          id: auditId,
          actorId: auth.currentUser.uid,
          action: 'settings.update',
          entityId: '1',
          createdAt: serverTimestamp()
        });
        await batch.commit().catch((err) => handleFirestoreError(err, OperationType.WRITE, `businesses/${businessId}/settings/main`));
        return json({ ok: true });
      }
    }

    if (path === '/api/appearance' && method === 'PUT') {
      const logoKey = clean(body.logo_key, 128) || null;
      const themeColor = /^#[a-f0-9]{6}$/i.test(body.theme_color || '') ? body.theme_color : '#6a330d';
      const logoDataUrl = logoKey ? await resolveMediaUrl(businessId, logoKey) : null;
      if (logoKey && !logoDataUrl) fail(400, 'Logomarca não encontrada.');
      const batch = writeBatch(db);
      const base = currentSettings || {
        name: account.business.name,
        mode: 'essential',
        paper: 80,
        businessKind: 'food',
        legalName: '',
        cnpj: '',
        address: '',
        phone: '',
        receiptMessage: 'Obrigado pela preferência! Volte sempre.',
        blindClose: false
      };
      batch.set(doc(db, 'businesses', businessId, 'settings', 'main'), {
        ...base,
        logoKey,
        themeColor,
        updatedAt: serverTimestamp()
      });
      batch.set(doc(db, 'businesses', businessId, 'publicSettings', 'menu'), {
        name: base.name,
        address: base.address || '',
        phone: base.phone || '',
        logoDataUrl: logoDataUrl || null,
        themeColor,
        active: true,
        updatedAt: serverTimestamp()
      });
      await batch.commit().catch((err) => handleFirestoreError(err, OperationType.UPDATE, `businesses/${businessId}/settings/main`));
      return json({ ok: true });
    }

    if (path === '/api/business-kind') {
      if (method === 'GET') return json({ business_kind: isRetail ? 'retail' : 'food' });
      fail(403, 'A modalidade do sistema é definida exclusivamente pelo administrador da plataforma.');
    }

    // /api/profiles & /api/employees
    if (path === '/api/profiles' && method === 'GET') {
      const snap = await getDocs(collection(db, 'businesses', businessId, 'profiles')).catch((err) =>
        handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/profiles`)
      );
      const allowedRoles = isRetail || !contractMods.tables ? ['admin', 'cashier'] : ['admin', 'cashier', 'waiter'];
      const hiddenPerms = isRetail ? new Set(['tables.read', 'tables.manage']) : new Set();
      const profiles = allowedRoles.map((role) => {
        const found = snap.docs.find((d) => d.id === role)?.data();
        const p = found || { role, name: fb.DEFAULT_PROFILES[role], permissions: {}, version: 1 };
        return {
          ...p,
          permissions: p.permissions || {},
          effective_permissions: effectivePermissions({ role: p.role, profile_permissions: p.permissions || {} })
        };
      });
      return json({
        profiles,
        permission_catalog: PERMISSIONS.filter((id) => !hiddenPerms.has(id) && (!window.IDContract||IDContract.allowed(currentSettings||{},id))).map((id) => ({
          id,
          group: PERMISSION_INFO[id][0],
          label: PERMISSION_INFO[id][1],
          roles: allowedRoles.filter((r) => roleAllows(r, id))
        })),
        staff_login: true
      });
    }

    const profileMatch = path.match(/^\/api\/profiles\/(admin|cashier|waiter)$/);
    if (profileMatch && method === 'PUT') {
      const role = profileMatch[1];
      const name = clean(body.name, 100);
      if (!name || !num(body.version, 1, 1e9)) fail(400, 'Confira nome e versão do perfil.');
      const overrides = permissionOverrides(body.permissions, role);
      const pRef = doc(db, 'businesses', businessId, 'profiles', role);
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(pRef);
        const curVer = snap.exists() ? snap.data().version || 1 : 1;
        if (curVer !== body.version) fail(409, 'O perfil foi alterado. Atualize antes de salvar.');
        tx.set(pRef, {
          role,
          name,
          permissions: overrides,
          version: curVer + 1,
          updatedBy: auth.currentUser.uid,
          updatedAt: serverTimestamp()
        });
      }).catch((err) => {
        if (err instanceof HttpError) throw err;
        handleFirestoreError(err, OperationType.UPDATE, pRef.path);
      });
      return json({ ok: true });
    }

    if (path === '/api/employees' && method === 'GET') {
      const [profilesSnap, membersSnap] = await Promise.all([
        getDocs(collection(db, 'businesses', businessId, 'profiles')),
        getDocs(collection(db, 'businesses', businessId, 'members'))
      ]).catch((err) => handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/members`));
      const profileMap = new Map();
      profilesSnap.forEach((d) => profileMap.set(d.id, d.data()));
      const employees = membersSnap.docs
        .map((d) => d.data())
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'))
        .map((m) => {
          const prof = profileMap.get(m.role) || { name: fb.DEFAULT_PROFILES[m.role] || m.role, permissions: {} };
          const inherited = effectivePermissions({ role: m.role, profile_permissions: prof.permissions || {} });
          const eff = effectivePermissions({
            role: m.role,
            active: m.active,
            profile_permissions: prof.permissions || {},
            permissions: m.permissions || {}
          });
          return {
            id: m.uid,
            name: m.name,
            username: m.username,
            role: m.role,
            permissions: m.permissions || {},
            active: !!m.active,
            version: m.version || 1,
            login_ready: true,
            profile_name: prof.name || m.role,
            inherited_permissions: inherited,
            effective_permissions: eff
          };
        });
      return json({ employees });
    }

    const empMatch = path.match(/^\/api\/employees\/([^/]+)$/);
    if ((path === '/api/employees' && method === 'POST') || (empMatch && method === 'PUT')) {
      const creating = path === '/api/employees';
      const name = clean(body.name, 100);
      const username = clean(body.username, 40).toLowerCase();
      if (!name || !/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username) || !Object.hasOwn(ROLE_BASE, body.role)) {
        fail(400, 'Informe nome, usuário único e perfil válido.');
      }
      if (creating && isRetail && body.role === 'waiter') {
        fail(400, 'O perfil Garçom não está disponível na modalidade Varejo.');
      }
      const overrides = permissionOverrides(body.permissions ?? {}, body.role);
      if (creating) {
        const password = String(body.password || '');
        if (password.length < 8 || password.length > 128) fail(400, 'A senha temporária deve ter entre 8 e 128 caracteres.');
        const dupSnap = await getDocs(
          query(collection(db, 'businesses', businessId, 'members'), where('username', '==', username), limit(1))
        ).catch((err) => handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/members`));
        if (!dupSnap.empty) fail(409, 'Este nome de usuário já está em uso.');
        await fb.checkMemberCapacity(businessId);
        const newUid = await provisionAuthAccount(staffAuthEmail(username, businessCode), password);
        const batch = fb.memberBatch(businessId, creating ? newUid : uid, creating ? {email:staffAuthEmail(username,businessCode),password} : null);
        batch.set(doc(db, 'userBusinesses', newUid), {
          uid: newUid,
          businessId,
          username,
          role: body.role,
          active: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        batch.set(doc(db, 'businesses', businessId, 'members', newUid), {
          uid: newUid,
          businessId,
          name,
          username,
          role: body.role,
          permissions: overrides,
          active: true,
          mustChangePassword: true,
          isOwner: false,
          version: 1,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        const auditId = crypto.randomUUID();
        batch.set(doc(db, 'businesses', businessId, 'auditLogs', auditId), {
          id: auditId,
          actorId: auth.currentUser.uid,
          action: 'employee.create',
          entityId: newUid,
          createdAt: serverTimestamp()
        });
        await batch.commit().catch((err) => handleFirestoreError(err, OperationType.WRITE, `businesses/${businessId}/members/${newUid}`));
        return json({ ok: true, id: newUid, login_ready: true }, 201);
      } else {
        const uid = empMatch[1];
        if (!num(body.version, 1, 1e9) || typeof body.active !== 'boolean') fail(400, 'Confira versão e situação do funcionário.');
        const mRef = doc(db, 'businesses', businessId, 'members', uid);
        const snap = await getDoc(mRef).catch((err) => handleFirestoreError(err, OperationType.GET, mRef.path));
        if (!snap.exists()) fail(404, 'Funcionário não encontrado.');
        const old = snap.data();
        if (isRetail && body.role === 'waiter' && !(old.role === 'waiter' && body.active === false)) {
          fail(400, 'O perfil Garçom não está disponível na modalidade Varejo.');
        }
        if (old.version !== body.version) fail(409, 'O cadastro foi alterado. Atualize antes de salvar.');
        if (old.isOwner && uid !== auth.currentUser.uid) fail(403, 'Não é possível alterar o proprietário principal aqui.');
        const batch = fb.memberBatch(businessId, creating ? newUid : uid, creating ? {email:staffAuthEmail(username,businessCode),password} : null);
        batch.update(mRef, {
          name,
          role: body.role,
          permissions: overrides,
          active: body.active,
          version: old.version + 1,
          updatedAt: serverTimestamp()
        });
        batch.update(doc(db, 'userBusinesses', uid), {
          role: body.role,
          active: body.active,
          updatedAt: serverTimestamp()
        });
        const auditId = crypto.randomUUID();
        batch.set(doc(db, 'businesses', businessId, 'auditLogs', auditId), {
          id: auditId,
          actorId: auth.currentUser.uid,
          action: 'employee.permissions.update',
          entityId: uid,
          createdAt: serverTimestamp()
        });
        await batch.commit().catch((err) => handleFirestoreError(err, OperationType.UPDATE, mRef.path));
        return json({ ok: true, login_ready: true });
      }
    }

    // /api/products & /api/catalog
    if (path === '/api/products' && method === 'GET') {
      const [prodSnap, favSnap] = await Promise.all([
        getDocs(collection(db, 'businesses', businessId, 'products')),
        getDoc(doc(db, 'businesses', businessId, 'favorites', user.id)).catch(() => null)
      ]).catch((err) => handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/products`));
      const rawProducts = prodSnap.docs
        .map((d) => d.data())
        .sort((a, b) => (a.code ?? 1e9) - (b.code ?? 1e9) || String(a.name).localeCompare(String(b.name), 'pt-BR'));
      await ensureMediaKeysLoaded(
        businessId,
        rawProducts.map((p) => p.imageKey)
      );
      const enriched = await computeProductCosts(businessId, rawProducts, user);
      const favIds = favSnap && favSnap.exists() ? favSnap.data().productIds || [] : [];
      return json({
        products: enriched.map((p) => productDto(p, p.effectiveCostCents, p.stockMeta)),
        favorites: favIds
      });
    }

    if (path === '/api/catalog' && method === 'GET') {
      const snap = await getDocs(query(collection(db, 'businesses', businessId, 'products'), where('active', '==', true))).catch((err) =>
        handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/products`)
      );
      const visible = snap.docs.map((d) => d.data()).filter((p) => p.active && p.visible);
      await ensureMediaKeysLoaded(
        businessId,
        visible.map((p) => p.imageKey)
      );
      const rows = visible
        .sort((a, b) => String(a.category || '').localeCompare(String(b.category || '')) || String(a.name).localeCompare(String(b.name)))
        .map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description || '',
          category: p.category || '',
          price_cents: p.priceCents,
          available: !!p.available,
          image_url: p.imageKey ? mediaCache.get(p.imageKey) || null : null
        }));
      return json({ products: rows });
    }

    const availabilityMatch=path.match(/^\/api\/products\/([^/]+)\/availability$/);
    if(availabilityMatch && method==='PATCH'){
      if(typeof body.available!=='boolean'||!num(body.version,1,1e9))fail(400,'Confira a disponibilidade e a versão do produto.');
      const id=availabilityMatch[1],ref=doc(db,'businesses',businessId,'products',id);
      const publicRef=doc(db,'businesses',businessId,'publicProducts',id);
      const auditId=crypto.randomUUID();
      await runTransaction(db,async tx=>{
        const [snap,publicSnap]=await Promise.all([tx.get(ref),tx.get(publicRef)]);
        if(!snap.exists()||!snap.data().active)fail(404,'Produto ativo não encontrado.');
        const product=snap.data();
        if(product.version!==body.version)fail(409,'O produto foi alterado por outra pessoa. Atualize antes de salvar.');
        tx.update(ref,{available:body.available,version:product.version+1,updatedAt:serverTimestamp()});
        if(publicSnap.exists())tx.update(publicRef,{available:body.available,updatedAt:serverTimestamp()});
        else tx.set(publicRef,{id,name:product.name,description:product.description||'',category:product.category||'',priceCents:product.priceCents,available:body.available,visible:!!product.visible,options:product.options||[],addons:stripAddonCosts(product.addons),imageDataUrl:null,updatedAt:serverTimestamp()});
        tx.set(doc(db,'businesses',businessId,'auditLogs',auditId),{id:auditId,actorId:user.id,action:'product.availability',entityId:id,details:{available:body.available},createdAt:serverTimestamp()});
      });
      return json({ok:true,available:body.available});
    }

    if ((path === '/api/products' && method === 'POST') || (/^\/api\/products\/[^/]+$/.test(path) && method === 'PUT')) {
      const creating = path === '/api/products';
      const importKey = creating && typeof body.import_key === 'string' && body.import_key.trim() ? body.import_key.trim().slice(0, 120) : null;
      const importAuditId = importKey ? 'imp_' + (await digestInput(importKey)).slice(0, 40) : null;
      const importIdemRef = importAuditId ? doc(db, 'businesses', businessId, 'idempotency', importAuditId) : null;
      if (importIdemRef) {
        const prevImp = await getDoc(importIdemRef).catch(() => null);
        if (prevImp && prevImp.exists()) return json({ ok: true, id: prevImp.data().targetId, replayed: true });
      }
      const id = creating ? crypto.randomUUID() : path.split('/').pop();
      const prodRef = doc(db, 'businesses', businessId, 'products', id);
      const oldSnap = creating
        ? null
        : await getDoc(prodRef).catch((err) => handleFirestoreError(err, OperationType.GET, prodRef.path));
      const old = oldSnap?.exists() ? oldSnap.data() : null;
      if (!creating && !old) fail(404, 'Produto não encontrado.');
      if (!creating && !num(body.version, 1, 1e9)) fail(400, 'Versão inválida.');
      if (!creating && old.version !== body.version) fail(409, 'O produto mudou. Reabra o cadastro.');

      const name = clean(body.name, 100);
      const barcode = clean(body.barcode, 65) || null;
      const unit = body.sale_unit ?? old?.saleUnit ?? 'un';
      const mode = body.stock_mode ?? old?.stockMode ?? 'none';
      if (!name || !num(body.price_cents, 0, 100000000) || !SALE_UNITS.includes(unit) || !['none', 'unit', 'recipe'].includes(mode) || (barcode && !/^[A-Za-z0-9._/-]{1,64}$/.test(barcode))) {
        fail(400, 'Confira nome, preço, unidade e código de barras.');
      }
      if (isRetail && mode === 'recipe' && old?.stockMode !== 'recipe') {
        fail(400, 'Fichas técnicas não estão disponíveis na modalidade Varejo.');
      }
      if (barcode) {
        const dup = await getDocs(
          query(collection(db, 'businesses', businessId, 'products'), where('barcode', '==', barcode), limit(2))
        ).catch((err) => handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/products`));
        if (dup.docs.some((d) => d.id !== id)) fail(409, 'O código de barras já pertence a outro produto.');
      }

      if(mode!=='none'&&!contractMods.inventory)fail(403,'Controle de estoque não contratado.');
      if((body.cost_cents!=null||body.cost_mode==='recipe')&&!contractMods.costs)fail(403,'Custos e resultados não contratados.');
      const initial = body.initial_stock ?? 0;
      const minimum = body.minimum_stock ?? 0;
      if (!num(initial, 0, 1000000) || !num(minimum, 0, 1000000)) fail(400, 'Informe quantidades inteiras de unidades.');
      if (initial && (!creating || mode !== 'unit')) fail(400, 'Saldo inicial somente para novo produto por unidade.');
      if (initial) assertPermission(user, 'reports.view');

      if (['active', 'available', 'visible'].some((k) => typeof body[k] !== 'boolean')) fail(400, 'Opção inválida.');
      const imageKey = clean(body.image_key, 128) || null;
      if (imageKey && !(await resolveMediaUrl(businessId, imageKey))) fail(400, 'Foto não encontrada.');

      const publicImageDataUrl=imageKey ? await resolveMediaUrl(businessId,imageKey) : null;
      const costPermission = contractMods.costs && hasPermission(user, 'products.costs');
      if (costPermission && !(body.cost_cents === null || body.cost_cents === undefined || num(body.cost_cents, 0, 100000000))) {
        fail(400, 'Custo inválido.');
      }
      const costCents = costPermission ? (body.cost_cents ?? null) : null;
      const normalizedAddons = normalizeAddons(body.addons ?? old?.addons ?? []);
      const publicSafeAddons = stripAddonCosts(normalizedAddons);
      const privateAddonCosts = costPermission ? addonCostMap(normalizedAddons) : null;
      const options = normalizeOptions(body.options ?? old?.options ?? []);
      const quick = Array.isArray(body.quick_notes)
        ? body.quick_notes.slice(0, 20).map((n) => clean(n, 80)).filter(Boolean)
        : old?.quickNotes || [];

      let itemId = old?.finishedInventoryId || null;
      if (mode === 'unit' && !itemId) itemId = crypto.randomUUID();
      const changedMode = old && old.stockMode !== mode;
      const existingRecipeSnap = await getDoc(doc(db, 'businesses', businessId, 'recipes', id)).catch(() => null);
      const existingRecipe = existingRecipeSnap?.exists() ? existingRecipeSnap.data().items || [] : [];
      const trackStock = mode === 'unit' ? true : mode === 'recipe' && old?.stockMode !== 'unit' && existingRecipe.length > 0;
      const costMode = mode === 'unit' ? 'recipe' : old?.stockMode === 'unit' ? 'direct' : old?.costMode || 'direct';

      let savedProduct = null;
      let replayedId = null;
      await runTransaction(db, async (tx) => {
        // 1) ALL transaction reads MUST precede any transaction writes
        const idemSnap = importIdemRef ? await tx.get(importIdemRef) : null;
        const counterOp = creating ? await prepareCounter(tx, businessId, 'products') : null;
        const freshProdSnap = creating ? null : await tx.get(prodRef);

        const invRef = mode === 'unit' ? doc(db, 'businesses', businessId, 'inventoryItems', itemId) : null;
        const stockRef = mode === 'unit' ? doc(db, 'businesses', businessId, 'inventoryStock', itemId) : null;
        const [invSnap, stockSnap] =
          mode === 'unit' ? await Promise.all([tx.get(invRef), tx.get(stockRef)]) : [null, null];

        // 2) Validations after all reads
        if (idemSnap && idemSnap.exists()) {
          replayedId = idemSnap.data().targetId;
          return;
        }
        if (!creating && (!freshProdSnap.exists() || freshProdSnap.data().version !== body.version)) {
          fail(409, 'O produto mudou. Reabra o cadastro.');
        }

        const code = creating ? counterOp.value : freshProdSnap.data().code;

        // 3) ALL transaction writes
        if (counterOp) counterOp.apply();

        if (mode === 'unit') {
          const micro = costPermission
            ? costCents === null
              ? null
              : costCents * 1000000
            : invSnap.exists()
            ? invSnap.data().unitCostMicro ?? null
            : null;
          if (hasPermission(user, 'reports.view')) {
            tx.set(invRef, {
              id: itemId,
              name,
              unit: 'un',
              minimumMilli: minimum * 1000,
              unitCostMicro: micro,
              active: true,
              createdAt: invSnap.exists() ? invSnap.data().createdAt : serverTimestamp(),
              updatedAt: serverTimestamp()
            });
          } else if (invSnap.exists() && costPermission) {
            tx.update(invRef, {
              unitCostMicro: micro,
              updatedAt: serverTimestamp()
            });
          }
          if (!stockSnap.exists()) {
            tx.set(stockRef, {
              itemId,
              balanceMilli: initial * 1000,
              updatedAt: serverTimestamp()
            });
          }
          if (hasPermission(user, 'reports.view')) {
            tx.set(doc(db, 'businesses', businessId, 'recipes', id), {
              productId: id,
              items: [{ itemId, quantityMilli: 1000 }],
              updatedAt: serverTimestamp()
            });
          }
          if (initial > 0) {
            const moveId = crypto.randomUUID();
            tx.set(doc(db, 'businesses', businessId, 'inventoryMoves', moveId), {
              id: moveId,
              requestKey: 'opening:' + id,
              itemId,
              quantityMilli: initial * 1000,
              kind: 'entry',
              reason: 'Saldo inicial de mercadoria',
              actorId: auth.currentUser.uid,
              createdAt: serverTimestamp()
            });
          }
        } else if (changedMode && old.stockMode === 'unit' && hasPermission(user, 'reports.view')) {
          tx.delete(doc(db, 'businesses', businessId, 'recipes', id));
        }

        savedProduct = {
          id,
          code,
          name,
          description: clean(body.description, 500),
          category: clean(body.category, 60),
          priceCents: body.price_cents,
          imageKey,
          active: body.active,
          available: body.available,
          visible: body.visible,
          options,
          addons: publicSafeAddons,
          quickNotes: quick,
          barcode,
          saleUnit: unit,
          packaging: clean(body.packaging, 80),
          stockMode: mode,
          finishedInventoryId: itemId,
          trackStock,
          costMode,
          version: creating ? 1 : old.version + 1,
          createdAt: creating ? serverTimestamp() : old.createdAt,
          updatedAt: serverTimestamp()
        };
        tx.set(prodRef, savedProduct);
        const publicRef=doc(db,'businesses',businessId,'publicProducts',id);
        if(savedProduct.active && savedProduct.visible)tx.set(publicRef,{
          id,name:savedProduct.name,description:savedProduct.description||'',category:savedProduct.category||'',
          priceCents:savedProduct.priceCents,available:savedProduct.available,visible:true,
          options:savedProduct.options||[],addons:stripAddonCosts(savedProduct.addons),imageDataUrl:publicImageDataUrl,updatedAt:serverTimestamp()
        });
        else tx.delete(publicRef);
        if (costPermission) {
          tx.set(doc(db, 'businesses', businessId, 'products', id, 'private', 'cost'), {
            costCents,
            addonCosts: privateAddonCosts || {},
            updatedAt: serverTimestamp()
          });
        }
        if (importIdemRef) {
          tx.set(importIdemRef, {
            key: importAuditId,
            kind: 'product_import',
            fingerprint: importAuditId,
            targetId: id,
            actorId: auth.currentUser.uid,
            result: { ok: true, id },
            createdAt: serverTimestamp()
          });
        }
        const auditId = importAuditId || crypto.randomUUID();
        tx.set(doc(db, 'businesses', businessId, 'auditLogs', auditId), {
          id: auditId,
          actorId: auth.currentUser.uid,
          action: creating ? 'product.create' : 'product.update',
          entityId: id,
          ...(importKey ? { details: { importKey } } : {}),
          createdAt: serverTimestamp()
        });
      }).catch((err) => {
        if (err instanceof HttpError) throw err;
        handleFirestoreError(err, OperationType.WRITE, prodRef.path);
      });

      if (replayedId) return json({ ok: true, id: replayedId, replayed: true });
      return json({ ok: true, id }, creating ? 201 : 200);
    }

    if (/^\/api\/products\/[^/]+$/.test(path) && method === 'DELETE') {
      const id = path.split('/').pop();
      if (!num(body.version, 1, 1e9)) fail(400, 'Versão inválida.');
      const prodRef = doc(db, 'businesses', businessId, 'products', id);
      const snap = await getDoc(prodRef).catch((err) => handleFirestoreError(err, OperationType.GET, prodRef.path));
      if (!snap.exists() || snap.data().version !== body.version) fail(409, 'O produto mudou. Atualize antes de remover.');
      const old = snap.data();
      const batch = writeBatch(db);
      batch.update(prodRef, {
        active: false,
        available: false,
        visible: false,
        version: old.version + 1,
        updatedAt: serverTimestamp()
      });
      batch.delete(doc(db, 'businesses', businessId, 'publicProducts', id));
      const auditId = crypto.randomUUID();
      batch.set(doc(db, 'businesses', businessId, 'auditLogs', auditId), {
        id: auditId,
        actorId: auth.currentUser.uid,
        action: 'product.archive',
        entityId: id,
        createdAt: serverTimestamp()
      });
      await batch.commit().catch((err) => handleFirestoreError(err, OperationType.UPDATE, prodRef.path));
      return json({ ok: true, archived: true });
    }

    const stockMatch = path.match(/^\/api\/products\/([^/]+)\/stock$/);
    if (stockMatch && method === 'POST') {
      const prodSnap = await getDoc(doc(db, 'businesses', businessId, 'products', stockMatch[1])).catch((err) =>
        handleFirestoreError(err, OperationType.GET, `businesses/${businessId}/products/${stockMatch[1]}`)
      );
      const p = prodSnap.data();
      if (!p || p.stockMode !== 'unit' || !p.finishedInventoryId) fail(400, 'Produto sem estoque por unidade.');
      if (!num(body.quantity, 0, 1000000)) fail(400, 'Informe a quantidade inteira de unidades.');
      return await handleApiRequest(new URL('/api/erp/inventory/' + p.finishedInventoryId + '/movement', location.origin), {
        method: 'POST',
        body: JSON.stringify({
          request_key: body.request_key,
          kind: body.kind,
          quantity_milli: body.quantity * 1000,
          reason: body.reason
        })
      });
    }

    // /api/favorites
    if (path === '/api/favorites' && method === 'PUT') {
      if (typeof body.favorite !== 'boolean' || typeof body.product_id !== 'string') fail(400, 'Dados inválidos.');
      const favRef = doc(db, 'businesses', businessId, 'favorites', user.id);
      const snap = await getDoc(favRef).catch((err) => handleFirestoreError(err, OperationType.GET, favRef.path));
      const list = new Set(snap.exists() ? snap.data().productIds || [] : []);
      if (body.favorite) list.add(body.product_id);
      else list.delete(body.product_id);
      await setDoc(favRef, {
        uid: user.id,
        productIds: [...list],
        updatedAt: serverTimestamp()
      }).catch((err) => handleFirestoreError(err, OperationType.WRITE, favRef.path));
      return json({ ok: true });
    }

    // /api/tables
    if (path === '/api/tables') {
      if (method === 'GET') {
        const canShared = hasPermission(user, 'orders.shared');
        const ordCol = collection(db, 'businesses', businessId, 'orders');
        const locksCol = collection(db, 'businesses', businessId, 'locks');
        const [tblSnap, lockSnap, ownOrdSnap, sharedOpenSnap, sharedPendSnap] = await Promise.all([
          getDocs(collection(db, 'businesses', businessId, 'tables')),
          getDocs(query(locksCol, where('active', '==', true))),
          canShared ? Promise.resolve(null) : getDocs(query(ordCol, where('actorId', '==', user.id))),
          canShared ? getDocs(query(ordCol, where('state', '==', 'open'))) : Promise.resolve(null),
          canShared ? getDocs(query(ordCol, where('fulfillment', '==', 'pending'))) : Promise.resolve(null)
        ]).catch((err) => handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/tables`));

        const activeOrdByTable = new Map();
        const addActiveOrd = (o) => {
          if (o.tableNumber != null && (o.state === 'open' || (o.state !== 'cancelled' && o.fulfillment !== 'delivered'))) {
            activeOrdByTable.set(o.tableNumber, o);
          }
        };
        if (canShared) {
          sharedOpenSnap.forEach((d) => addActiveOrd(d.data()));
          sharedPendSnap.forEach((d) => addActiveOrd(d.data()));
        } else {
          ownOrdSnap.forEach((d) => addActiveOrd(d.data()));
        }

        const tableLockByNum = new Map();
        lockSnap.forEach((d) => {
          const l = d.data();
          if (l.kind === 'table' && l.active && /^table_\d+$/.test(l.id)) {
            tableLockByNum.set(Number(l.id.slice(6)), l);
          }
        });

        const tables = tblSnap.docs
          .map((d) => d.data())
          .sort((a, b) => a.number - b.number)
          .map((t) => {
            const rawOrder = activeOrdByTable.get(t.number);
            const lk = tableLockByNum.get(t.number);
            let order = null;
            if (rawOrder) {
              const dto = orderDto(rawOrder);
              order = canReadOrder(user, dto)
                ? dto
                : {
                    id: dto.id,
                    number: dto.number,
                    state: dto.state,
                    fulfillment: dto.fulfillment,
                    attendant_name: dto.attendant_name,
                    created_at: dto.created_at,
                    restricted: true
                  };
            } else if (lk) {
              order = {
                id: lk.resourceId || lk.id,
                number: lk.orderNumber || null,
                state: 'open',
                fulfillment: 'pending',
                attendant_name: lk.attendantName || 'Atendimento',
                created_at: tsToIso(lk.updatedAt),
                restricted: true
              };
            }
            return { id: t.id, number: t.number, seats: t.seats ?? null, active: !!t.active, order };
          });
        return json({ tables });
      }
      if (method === 'POST') {
        if (!num(body.number, 1, 9999) || !(body.seats == null || num(body.seats, 1, 100))) {
          fail(400, 'Confira o número e a capacidade da mesa.');
        }
        const dup = await getDocs(
          query(collection(db, 'businesses', businessId, 'tables'), where('number', '==', body.number), limit(1))
        ).catch((err) => handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/tables`));
        if (!dup.empty) fail(409, 'Esta mesa já está cadastrada.');
        const id = 'table_' + body.number;
        const tRef = doc(db, 'businesses', businessId, 'tables', id);
        await runTransaction(db, async (tx) => {
          const existing = await tx.get(tRef);
          if (existing.exists()) fail(409, 'Esta mesa já está cadastrada.');
          tx.set(tRef, {
            id,
            number: body.number,
            seats: body.seats ?? null,
            active: true,
            createdAt: serverTimestamp()
          });
          const auditId = crypto.randomUUID();
          tx.set(doc(db, 'businesses', businessId, 'auditLogs', auditId), {
            id: auditId,
            actorId: auth.currentUser.uid,
            action: 'table.create',
            entityId: id,
            createdAt: serverTimestamp()
          });
        }).catch((err) => {
          if (err instanceof HttpError) throw err;
          handleFirestoreError(err, OperationType.WRITE, tRef.path);
        });
        return json({ ok: true, id }, 201);
      }
    }

    // /api/customers
    const custHistory = path.match(/^\/api\/customers\/([^/]+)\/history$/);
    if (custHistory && method === 'GET') {
      const snap = await getDocs(
        query(collection(db, 'businesses', businessId, 'orders'), where('customerId', '==', custHistory[1]))
      ).catch((err) => handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/orders`));
      const orders = snap.docs
        .map((d) => d.data())
        .sort((a, b) => b.number - a.number)
        .slice(0, 100)
        .map((o) => ({
          id: o.id,
          number: o.number,
          state: o.state,
          total_cents: o.totalCents,
          created_at: tsToIso(o.createdAt),
          closed_at: tsToIso(o.closedAt),
          customer_name: o.customerName || ''
        }));
      return json({ orders });
    }

    if (path === '/api/customers' || /^\/api\/customers\/[^/]+$/.test(path)) {
      if (path === '/api/customers' && method === 'GET') {
        const snap = await getDocs(collection(db, 'businesses', businessId, 'customers')).catch((err) =>
          handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/customers`)
        );
        const customers = snap.docs
          .map((d) => {
            const c = d.data();
            return {
              id: c.id,
              name: c.name,
              phone: c.phone || '',
              email: c.email || '',
              document: c.document || '',
              notes: c.notes || '',
              active: !!c.active,
              version: c.version || 1,
              created_at: tsToIso(c.createdAt)
            };
          })
          .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'pt-BR'));
        return json({ customers });
      }
      assertPermission(user, 'payments.receive');
      const creating = path === '/api/customers';
      const id = creating ? crypto.randomUUID() : path.split('/').pop();
      const name = clean(body.name, 100);
      const docNum = clean(body.document, 30).replace(/\D/g, '');
      const email = clean(body.email, 120);
      if (
        !name ||
        (docNum && ![11, 14].includes(docNum.length)) ||
        (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ||
        (!creating && (!num(body.version, 1, 1e9) || typeof body.active !== 'boolean'))
      ) {
        fail(400, 'Confira nome, contato e CPF/CNPJ opcional.');
      }
      const cRef = doc(db, 'businesses', businessId, 'customers', id);
      if (creating) {
        await setDoc(cRef, {
          id,
          name,
          phone: clean(body.phone, 30),
          email,
          document: docNum,
          notes: clean(body.notes, 500),
          active: body.active !== false,
          version: 1,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }).catch((err) => handleFirestoreError(err, OperationType.WRITE, cRef.path));
        return json({ ok: true, id }, 201);
      } else {
        const snap = await getDoc(cRef).catch((err) => handleFirestoreError(err, OperationType.GET, cRef.path));
        if (!snap.exists() || snap.data().version !== body.version) fail(409, 'O cliente mudou. Atualize o cadastro.');
        await updateDoc(cRef, {
          name,
          phone: clean(body.phone, 30),
          email,
          document: docNum,
          notes: clean(body.notes, 500),
          active: body.active,
          version: snap.data().version + 1,
          updatedAt: serverTimestamp()
        }).catch((err) => handleFirestoreError(err, OperationType.UPDATE, cRef.path));
        return json({ ok: true, id });
      }
    }

    // /api/drafts
    if (path === '/api/drafts') {
      if (method === 'GET') {
        const snap = await getDocs(
          query(collection(db, 'businesses', businessId, 'drafts'), where('ownerId', '==', user.id), limit(100))
        ).catch((err) => handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/drafts`));
        const drafts = snap.docs
          .map((d) => d.data())
          .filter((d) => d.state === 'waiting')
          .sort((a, b) => new Date(tsToIso(b.updatedAt) || 0) - new Date(tsToIso(a.updatedAt) || 0))
          .map((d) => ({
            id: d.id,
            title: d.title,
            created_at: tsToIso(d.createdAt),
            updated_at: tsToIso(d.updatedAt),
            version: d.version || 1
          }));
        return json({ drafts });
      }
      if (method === 'POST') {
        if (!validKey(body.request_key) || !Array.isArray(body.items) || !body.items.length || body.items.length > 100) {
          fail(400, 'Confira os itens a guardar.');
        }
        const idemId = idemDocId('draft', body.request_key);
        const idemRef = doc(db, 'businesses', businessId, 'idempotency', idemId);
        const preIdem = await getDoc(idemRef).catch(() => null);
        if (preIdem && preIdem.exists()) return json({ ok: true, id: preIdem.data().targetId, replayed: true });

        const prodMap = await loadProductsByIds(
          businessId,
          body.items.map((i) => i.product_id),
          user
        );
        const items = [];
        for (const i of body.items) {
          if (!num(i.quantity, 1, 999)) fail(400, 'Quantidade inválida.');
          const p = prodMap.get(i.product_id);
          if (!p || !p.active || !p.available) fail(409, 'Um produto ficou indisponível.');
          priceItem(p, i, user);
          items.push({
            product_id: p.id,
            quantity: i.quantity,
            note: clean(i.note, 200),
            selections: i.selections || {},
            addons: i.addons || []
          });
        }
        if (body.draft_id && (typeof body.draft_id !== 'string' || !num(body.version, 1, 1e9))) {
          fail(400, 'Venda em espera inválida.');
        }
        const fingerprint = await digestInput({ draft_id: body.draft_id || null, title: clean(body.title, 80), items });
        const draftId = body.draft_id || crypto.randomUUID();
        const dRef = doc(db, 'businesses', businessId, 'drafts', draftId);
        let resultPayload = null;
        await runTransaction(db, async (tx) => {
          const idemSnap = await tx.get(idemRef);
          const existingDraft = body.draft_id ? await tx.get(dRef) : null;
          if (idemSnap.exists()) {
            const prior = idemSnap.data();
            if (prior.fingerprint && prior.fingerprint !== fingerprint) fail(409, 'Identificador já utilizado em outro rascunho.');
            resultPayload = prior.result || { ok: true, id: prior.targetId };
            return;
          }
          if (body.draft_id) {
            if (!existingDraft.exists() || existingDraft.data().state !== 'waiting' || existingDraft.data().version !== body.version) {
              fail(409, 'A venda em espera mudou em outra tela. Atualize.');
            }
            tx.update(dRef, {
              title: clean(body.title, 80) || 'Atendimento de balcão',
              items,
              version: existingDraft.data().version + 1,
              updatedAt: serverTimestamp()
            });
            resultPayload = { ok: true, id: draftId };
          } else {
            tx.set(dRef, {
              id: draftId,
              requestKey: body.request_key,
              ownerId: user.id,
              title: clean(body.title, 80) || 'Atendimento de balcão',
              items,
              state: 'waiting',
              version: 1,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            });
            resultPayload = { ok: true, id: draftId };
          }
          tx.set(idemRef, {
            key: idemId,
            kind: 'draft',
            fingerprint,
            targetId: draftId,
            actorId: user.id,
            result: resultPayload,
            createdAt: serverTimestamp()
          });
        }).catch((err) => {
          if (err instanceof HttpError) throw err;
          handleFirestoreError(err, OperationType.WRITE, dRef.path);
        });
        return json(resultPayload, body.draft_id ? 200 : 201);
      }
    }

    const draftMatch = path.match(/^\/api\/drafts\/([^/]+)$/);
    if (draftMatch) {
      const dRef = doc(db, 'businesses', businessId, 'drafts', draftMatch[1]);
      const snap = await getDoc(dRef).catch((err) => handleFirestoreError(err, OperationType.GET, dRef.path));
      if (!snap.exists() || snap.data().ownerId !== user.id || snap.data().state !== 'waiting') {
        fail(404, 'Venda em espera não encontrada ou já convertida.');
      }
      const d = snap.data();
      if (method === 'GET') {
        const prodMap = await loadProductsByIds(
          businessId,
          (d.items || []).map((x) => x.product_id),
          user
        );
        const items = [];
        for (const i of d.items || []) {
          const p = prodMap.get(i.product_id);
          if (!p || !p.active || !p.available) fail(409, 'Um produto ficou indisponível. A venda permanece guardada.');
          const priced = priceItem(p, i, user);
          items.push({
            ...i,
            name: p.name,
            unit_price_cents: priced.unit_price_cents,
            base_unit_price_cents: p.priceCents,
            addons: priced.addons,
            original_note: i.note
          });
        }
        return json({
          draft: {
            id: d.id,
            title: d.title,
            version: d.version || 1,
            items
          }
        });
      }
      if (method === 'DELETE') {
        await updateDoc(dRef, {
          state: 'discarded',
          version: (d.version || 1) + 1,
          updatedAt: serverTimestamp()
        }).catch((err) => handleFirestoreError(err, OperationType.UPDATE, dRef.path));
        return json({ ok: true });
      }
    }

    // /api/cash
    if (path === '/api/cash' && method === 'GET') {
      const [sessSnap, activeSess] = await Promise.all([
        getDocs(query(collection(db, 'businesses', businessId, 'cashSessions'), orderBy('openedAt', 'desc'), limit(50))),
        getOpenCashSession(businessId)
      ]).catch((err) => handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/cashSessions`));

      const blind = user.role !== 'admin' && !!currentSettings?.blindClose;
      const activeRaw = activeSess || sessSnap.docs.map((d) => d.data()).find((s) => s.state === 'open') || null;
      let activeLedgers = null;
      if (activeRaw && (!blind || typeof activeRaw.cashBalanceCents !== 'number')) {
        const ledSnap = await getDocs(
          query(collection(db, 'businesses', businessId, 'ledger'), where('sessionId', '==', activeRaw.id), limit(300))
        ).catch((err) => handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/ledger`));
        activeLedgers = ledSnap.docs.map((d) => d.data());
      }

      const active = activeRaw ? cashSessionDto(activeRaw, activeLedgers) : null;
      const history = sessSnap.docs
        .map((d) => d.data())
        .filter((s) => user.role === 'admin' || s.actorId === user.id)
        .slice(0, 30)
        .map((s) => cashSessionDto(s, s.id === activeRaw?.id ? activeLedgers : null));
      const movements =
        active && !blind && Array.isArray(activeLedgers)
          ? activeLedgers
              .slice()
              .sort((a, b) => new Date(tsToIso(b.createdAt) || 0) - new Date(tsToIso(a.createdAt) || 0))
              .slice(0, 150)
              .map(ledgerDto)
          : [];
      return json({
        session: active
          ? blind
            ? {
                ...active,
                balance_cents: null,
                expected_cents: null,
                expected_methods_json: null,
                difference_methods_json: null
              }
            : active
          : null,
        history,
        movements
      });
    }

    if (path === '/api/cash/open' && method === 'POST') {
      if (!validKey(body.request_key)) fail(400, 'Identificador da operação inválido.');
      if (!num(body.opening_cents, 0, 100000000)) fail(400, 'Informe um valor de abertura válido.');
      const idemId = idemDocId('cash_open', body.request_key);
      const idemRef = doc(db, 'businesses', businessId, 'idempotency', idemId);
      const csRef = doc(db, 'businesses', businessId, 'cashSessions', body.request_key);
      const lockRef = cashLockDocRef(businessId);
      const fingerprint = await digestInput({ opening_cents: body.opening_cents, request_key: body.request_key });
      let status = 201;
      let replayed = false;

      await runTransaction(db, async (tx) => {
        const [idemSnap, csSnap, lockSnap] = await Promise.all([tx.get(idemRef), tx.get(csRef), tx.get(lockRef)]);
        if (idemSnap.exists()) {
          if (idemSnap.data().fingerprint && idemSnap.data().fingerprint !== fingerprint) {
            fail(409, 'Identificador já usado em outra abertura de caixa.');
          }
          status = 200;
          replayed = true;
          return;
        }
        if (csSnap.exists()) {
          if (csSnap.data().openingCents !== body.opening_cents || csSnap.data().actorId !== user.id) {
            fail(409, 'Identificador de caixa já utilizado.');
          }
          status = 200;
          replayed = true;
          return;
        }
        if (lockSnap.exists() && lockSnap.data().active === true) {
          fail(409, 'Já existe um caixa aberto.');
        }

        const initialTotals = { cash: body.opening_cents, pix: 0, credit: 0, debit: 0, card: 0 };
        tx.set(csRef, {
          id: body.request_key,
          openingCents: body.opening_cents,
          cashBalanceCents: body.opening_cents,
          methodTotals: initialTotals,
          version: 1,
          state: 'open',
          actorId: user.id,
          openedAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        if (lockSnap.exists()) {
          tx.update(lockRef, {
            id: 'activeCashSession',
            kind: 'cash_session',
            resourceId: body.request_key,
            active: true,
            ownerId: user.id,
            version: (lockSnap.data().version || 1) + 1,
            updatedAt: serverTimestamp()
          });
        } else {
          tx.set(lockRef, {
            id: 'activeCashSession',
            kind: 'cash_session',
            resourceId: body.request_key,
            active: true,
            ownerId: user.id,
            version: 1,
            updatedAt: serverTimestamp()
          });
        }
        tx.set(idemRef, {
          key: idemId,
          kind: 'cash_open',
          fingerprint,
          targetId: body.request_key,
          actorId: user.id,
          result: { ok: true, id: body.request_key },
          createdAt: serverTimestamp()
        });
        const auditId = crypto.randomUUID();
        tx.set(doc(db, 'businesses', businessId, 'auditLogs', auditId), {
          id: auditId,
          actorId: auth.currentUser.uid,
          action: 'cash.open',
          entityId: body.request_key,
          createdAt: serverTimestamp()
        });
      }).catch((err) => {
        if (err instanceof HttpError) throw err;
        handleFirestoreError(err, OperationType.WRITE, csRef.path);
      });
      return json({ ok: true, id: body.request_key, ...(replayed ? { replayed: true } : {}) }, status);
    }

    if (path === '/api/cash/close' && method === 'POST') {
      const counts = body.counted_methods || { cash: body.counted_cents };
      if (
        !counts ||
        typeof counts !== 'object' ||
        Array.isArray(counts) ||
        !num(counts.cash, 0, 100000000) ||
        Object.entries(counts).some(([k, v]) => !REGISTER_METHODS.includes(k) || !num(v, 0, 100000000))
      ) {
        fail(400, 'Confira os valores contados por forma de pagamento.');
      }
      if (typeof body.session_id !== 'string') fail(400, 'Caixa inválido.');
      const csRef = doc(db, 'businesses', businessId, 'cashSessions', body.session_id);
      const lockRef = cashLockDocRef(businessId);
      const preCsSnap = await getDoc(csRef).catch((err) => handleFirestoreError(err, OperationType.GET, csRef.path));
      if (!preCsSnap.exists()) fail(404, 'Caixa não encontrado.');
      let legacyEntries = [];
      if (!preCsSnap.data().methodTotals) {
        const ledgerSnap = await getDocs(
          query(collection(db, 'businesses', businessId, 'ledger'), where('sessionId', '==', body.session_id))
        ).catch((err) => handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/ledger`));
        legacyEntries = ledgerSnap.docs.map((d) => d.data());
      }

      let closedSession = null;
      await runTransaction(db, async (tx) => {
        const [csSnap, lockSnap] = await Promise.all([tx.get(csRef), tx.get(lockRef)]);
        if (!csSnap.exists()) fail(404, 'Caixa não encontrado.');
        const old = csSnap.data();
        if (old.state === 'closed') {
          closedSession = cashSessionDto(old);
          return;
        }
        const expectedMethods = {};
        const differenceMethods = {};
        for (const m of REGISTER_METHODS) {
          const sum = old.methodTotals
            ? old.methodTotals[m] ?? (m === 'cash' ? old.openingCents : 0)
            : (m === 'cash' ? old.openingCents : 0) +
              legacyEntries.filter((l) => l.method === m).reduce((acc, l) => acc + l.amountCents, 0);
          expectedMethods[m] = sum;
          differenceMethods[m] = (counts[m] ?? 0) - expectedMethods[m];
        }
        const expectedCents = expectedMethods.cash;
        const differenceCents = counts.cash - expectedCents;
        const nextVersion = (old.version || 1) + 1;
        tx.update(csRef, {
          state: 'closed',
          countedCents: counts.cash,
          expectedCents,
          differenceCents,
          countedMethods: counts,
          expectedMethods,
          differenceMethods,
          version: nextVersion,
          closedAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        if (lockSnap.exists() && lockSnap.data().active === true && lockSnap.data().resourceId === old.id) {
          tx.update(lockRef, {
            active: false,
            version: (lockSnap.data().version || 1) + 1,
            updatedAt: serverTimestamp()
          });
        }
        const auditId = crypto.randomUUID();
        tx.set(doc(db, 'businesses', businessId, 'auditLogs', auditId), {
          id: auditId,
          actorId: auth.currentUser.uid,
          action: 'cash.close.methods',
          entityId: old.id,
          createdAt: serverTimestamp()
        });
        closedSession = cashSessionDto({
          ...old,
          state: 'closed',
          countedCents: counts.cash,
          expectedCents,
          differenceCents,
          countedMethods: counts,
          expectedMethods,
          differenceMethods,
          version: nextVersion
        });
      }).catch((err) => {
        if (err instanceof HttpError) throw err;
        handleFirestoreError(err, OperationType.UPDATE, csRef.path);
      });
      return json({ ok: true, session: closedSession });
    }

    if (path === '/api/cash/movement' && method === 'POST') {
      if (!validKey(body.request_key)) fail(400, 'Identificador da operação inválido.');
      if (!['supply', 'withdrawal', 'expense'].includes(body.kind) || !num(body.amount_cents, 1, 100000000) || !clean(body.description, 200)) {
        fail(400, 'Confira tipo, valor e descrição.');
      }
      if (typeof body.session_id !== 'string' || !body.session_id) fail(400, 'Sessão de caixa inválida.');
      if (body.kind === 'expense') assertPermission(user, 'expenses.create');

      const idemId = idemDocId('cash_mov', body.request_key);
      const idemRef = doc(db, 'businesses', businessId, 'idempotency', idemId);
      const csRef = doc(db, 'businesses', businessId, 'cashSessions', body.session_id);
      const lockRef = cashLockDocRef(businessId);
      const fingerprint = await digestInput({
        session_id: body.session_id,
        kind: body.kind,
        amount_cents: body.amount_cents,
        description: clean(body.description, 200)
      });

      const preCs = await getDoc(csRef).catch((err) => handleFirestoreError(err, OperationType.GET, csRef.path));
      let legacyTotals = null;
      if (preCs.exists() && typeof preCs.data().cashBalanceCents !== 'number') {
        const ledgerSnap = await getDocs(
          query(collection(db, 'businesses', businessId, 'ledger'), where('sessionId', '==', body.session_id))
        ).catch((err) => handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/ledger`));
        legacyTotals = { cash: preCs.data().openingCents, pix: 0, credit: 0, debit: 0, card: 0 };
        ledgerSnap.docs.forEach((d) => {
          const l = d.data();
          if (REGISTER_METHODS.includes(l.method)) legacyTotals[l.method] = (legacyTotals[l.method] || 0) + l.amountCents;
        });
      }

      const signed = body.kind === 'supply' ? body.amount_cents : -body.amount_cents;
      const moveId = crypto.randomUUID();
      let resultPayload = null;
      let status = 201;

      await runTransaction(db, async (tx) => {
        const [idemSnap, csSnap, lockSnap] = await Promise.all([tx.get(idemRef), tx.get(csRef), tx.get(lockRef)]);
        if (idemSnap.exists()) {
          const prior = idemSnap.data();
          if (prior.fingerprint && prior.fingerprint !== fingerprint) {
            fail(409, 'Identificador já utilizado em outro lançamento de caixa.');
          }
          resultPayload = prior.result || { ok: true, id: prior.targetId };
          status = 200;
          return;
        }
        if (
          !csSnap.exists() ||
          csSnap.data().state !== 'open' ||
          (lockSnap.exists() && (!lockSnap.data().active || lockSnap.data().resourceId !== body.session_id))
        ) {
          fail(409, 'O caixa mudou ou está fechado. Atualize a tela.');
        }
        const csData = csSnap.data();
        const totals = nextSessionTotals(csData, 'cash', signed, legacyTotals);

        tx.set(doc(db, 'businesses', businessId, 'ledger', moveId), {
          id: moveId,
          requestKey: body.request_key,
          sessionId: csData.id,
          kind: body.kind,
          method: 'cash',
          amountCents: signed,
          description: clean(body.description, 200),
          category: clean(body.category, 80) || 'Não classificado',
          financeAccount: 'drawer',
          actorId: user.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        tx.update(csRef, {
          ...totals,
          version: (csData.version || 1) + 1,
          updatedAt: serverTimestamp()
        });
        resultPayload = { ok: true, id: moveId };
        tx.set(idemRef, {
          key: idemId,
          kind: 'cash_movement',
          fingerprint,
          targetId: moveId,
          actorId: user.id,
          result: resultPayload,
          createdAt: serverTimestamp()
        });
        const auditId = crypto.randomUUID();
        tx.set(doc(db, 'businesses', businessId, 'auditLogs', auditId), {
          id: auditId,
          actorId: auth.currentUser.uid,
          action: 'cash.movement',
          entityId: moveId,
          createdAt: serverTimestamp()
        });
      }).catch((err) => {
        if (err instanceof HttpError) throw err;
        handleFirestoreError(err, OperationType.WRITE, `businesses/${businessId}/ledger/${moveId}`);
      });
      return json(resultPayload, status);
    }

    // /api/sales/direct
    if (path === '/api/sales/direct' && method === 'POST') {
      if (
        !validKey(body.request_key) ||
        !Array.isArray(body.items) ||
        !body.items.length ||
        body.items.length > 100 ||
        !['cash', 'pix', 'credit', 'debit'].includes(body.method) ||
        !num(body.expected_total_cents, 1, 100000000) ||
        typeof body.session_id !== 'string' ||
        body.table_number != null ||
        !(body.draft_id == null || typeof body.draft_id === 'string')
      ) {
        fail(400, 'Confira os produtos e a forma de pagamento da venda direta.');
      }
      const discount = body.discount_cents ?? 0;
      if (!num(discount, 0, 100000000)) fail(400, 'Desconto inválido.');
      if (discount) {
        assertPermission(user, 'discounts.authorize');
        if (clean(body.discount_reason, 200).length < 3) fail(400, 'Informe o motivo do desconto.');
      }

      const idemId = idemDocId('sale_direct', body.request_key);
      const idemRef = doc(db, 'businesses', businessId, 'idempotency', idemId);
      const fingerprint = await digestInput({
        items: body.items.map((i) => ({ product_id: i.product_id, quantity: i.quantity, options: i.selections || {}, addons: i.addons || [] })),
        method: body.method,
        expected_total_cents: body.expected_total_cents,
        discount_cents: discount
      });
      const preIdem = await getDoc(idemRef).catch(() => null);
      if (preIdem && preIdem.exists()) {
        const prior = preIdem.data();
        if (prior.fingerprint && prior.fingerprint !== fingerprint) fail(409, 'Identificador já utilizado em outra venda direta.');
        return json(prior.result || { ok: true, id: prior.targetId, closed: true });
      }

      let customer = null;
      if (body.customer_id) {
        assertPermission(user, 'cash.access');
        const cSnap = await getDoc(doc(db, 'businesses', businessId, 'customers', body.customer_id)).catch(() => null);
        if (!cSnap || !cSnap.exists() || !cSnap.data().active) fail(400, 'Cliente não encontrado ou inativo.');
        customer = cSnap.data();
      }

      const prodMap = await loadProductsByIds(
        businessId,
        body.items.map((i) => i.product_id),
        user
      );

      const pricedItems = [];
      let total = 0;
      for (const i of body.items) {
        if (typeof i.product_id !== 'string' || !num(i.quantity, 1, 999)) fail(400, 'Confira produto e quantidade.');
        const p = prodMap.get(i.product_id);
        if (!p || !p.active || !p.available) fail(409, 'Produto indisponível. Atualize o catálogo.');
        const line = priceItem(p, i, user);
        pricedItems.push(line);
        total += line.quantity * line.unit_price_cents;
      }
      if (discount >= total) fail(400, 'O desconto deve ser menor que o total da venda.');
      total -= discount;
      if (total !== body.expected_total_cents) fail(409, 'O preço mudou. Atualize os produtos e confira o total antes de receber.');
      const tender = body.method === 'cash' ? body.tendered_cents : total;
      if (!num(tender, total, 100000000)) fail(400, 'O dinheiro entregue é menor que o total da venda.');

      const csRef = doc(db, 'businesses', businessId, 'cashSessions', body.session_id);
      const lockRef = cashLockDocRef(businessId);
      const preCs = await getDoc(csRef).catch((err) => handleFirestoreError(err, OperationType.GET, csRef.path));
      let legacyTotals = null;
      if (preCs.exists() && typeof preCs.data().cashBalanceCents !== 'number') {
        const ledgerSnap = await getDocs(
          query(collection(db, 'businesses', businessId, 'ledger'), where('sessionId', '==', body.session_id))
        ).catch((err) => handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/ledger`));
        legacyTotals = { cash: preCs.data().openingCents, pix: 0, credit: 0, debit: 0, card: 0 };
        ledgerSnap.docs.forEach((d) => {
          const l = d.data();
          if (REGISTER_METHODS.includes(l.method)) legacyTotals[l.method] = (legacyTotals[l.method] || 0) + l.amountCents;
        });
      }

      const orderId = crypto.randomUUID();
      let resultPayload = null;
      let status = 201;
      await runTransaction(db, async (tx) => {
        // 1) ALL reads before ANY writes
        const [idemSnap, csSnap, lockSnap] = await Promise.all([tx.get(idemRef), tx.get(csRef), tx.get(lockRef)]);
        const draftRef = body.draft_id ? doc(db, 'businesses', businessId, 'drafts', body.draft_id) : null;
        const dSnap = draftRef ? await tx.get(draftRef) : null;
        const applyInventory = await prepareInventoryDeduction(tx, businessId, pricedItems, orderId, user);
        const counterOp = await prepareCounter(tx, businessId, 'orders');

        // 2) Validations
        if (idemSnap.exists()) {
          const prior = idemSnap.data();
          if (prior.fingerprint && prior.fingerprint !== fingerprint) {
            fail(409, 'Identificador já utilizado em outra venda direta.');
          }
          resultPayload = prior.result || { ok: true, id: prior.targetId, closed: true };
          status = 200;
          return;
        }
        if (
          !csSnap.exists() ||
          csSnap.data().state !== 'open' ||
          (lockSnap.exists() && (!lockSnap.data().active || lockSnap.data().resourceId !== body.session_id))
        ) {
          fail(409, 'Abra ou atualize o caixa antes de receber a venda direta.');
        }
        if (draftRef && (!dSnap.exists() || dSnap.data().ownerId !== user.id || dSnap.data().state !== 'waiting')) {
          fail(409, 'O caixa ou a venda em espera mudou. Atualize antes de receber.');
        }
        const csData = csSnap.data();
        const totals = nextSessionTotals(csData, body.method, total, legacyTotals);
        const orderNumber = counterOp.value;

        // 3) ALL writes
        counterOp.apply();
        const ledId = crypto.randomUUID();
        tx.set(doc(db, 'businesses', businessId, 'orders', orderId), {
          id: orderId,
          number: orderNumber,
          requestKey: body.request_key,
          tableNumber: null,
          state: 'closed',
          fulfillment: 'delivered',
          items: pricedItems,
          totalCents: total,
          discountCents: discount,
          discountReason: clean(body.discount_reason, 200),
          authorizedBy: discount ? user.id : null,
          actorId: user.id,
          attendantName: user.name || 'Administrador',
          customerId: customer?.id || null,
          customerName: customer?.name || '',
          checkoutWaiting: false,
          paidCents: total,
          lastLedgerId: ledId,
          refundCents: 0,
          version: 1,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          closedAt: serverTimestamp()
        });

        tx.set(doc(db, 'businesses', businessId, 'ledger', ledId), {
          id: ledId,
          requestKey: 'direct:' + body.request_key,
          sessionId: body.session_id,
          orderId,
          kind: 'sale',
          method: body.method,
          amountCents: total,
          tenderedCents: tender,
          refundedCents: 0,
          description: 'Venda direta no balcão',
          category: 'Não classificado',
          financeAccount: body.method === 'cash' ? 'drawer' : 'bank',
          actorId: user.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });

        tx.update(csRef, {
          ...totals,
          version: (csData.version || 1) + 1,
          updatedAt: serverTimestamp()
        });

        if (draftRef && dSnap) {
          tx.update(draftRef, {
            state: 'converted',
            convertedOrderId: orderId,
            version: (dSnap.data().version || 1) + 1,
            updatedAt: serverTimestamp()
          });
        }
        applyInventory();
        resultPayload = { ok: true, id: orderId, number: orderNumber, closed: true, change_cents: tender - total };
        tx.set(idemRef, {
          key: idemId,
          kind: 'sale_direct',
          fingerprint,
          targetId: orderId,
          actorId: user.id,
          result: resultPayload,
          createdAt: serverTimestamp()
        });
        const auditId = crypto.randomUUID();
        tx.set(doc(db, 'businesses', businessId, 'auditLogs', auditId), {
          id: auditId,
          actorId: auth.currentUser.uid,
          action: 'sale.direct',
          entityId: orderId,
          createdAt: serverTimestamp()
        });
      }).catch((err) => {
        if (err instanceof HttpError) throw err;
        handleFirestoreError(err, OperationType.WRITE, `businesses/${businessId}/orders/${orderId}`);
      });

      return json(resultPayload, status);
    }

    // /api/orders
    if (path === '/api/orders' && method === 'GET') {
      const scope = url.searchParams.get('scope');
      const all = scope === 'all';
      const ordCol = collection(db, 'businesses', businessId, 'orders');
      const canShared = hasPermission(user, 'orders.shared');
      let rawDocs = [];

      if (!canShared) {
        const ordSnap = await getDocs(
          query(ordCol, where('actorId', '==', user.id), limit(150))
        ).catch((err) => handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/orders`));
        rawDocs = ordSnap.docs.map((d) => d.data());
      } else if (scope === 'waiting') {
        const ordSnap = await getDocs(
          query(ordCol, where('state', '==', 'open'), limit(150))
        ).catch((err) => handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/orders`));
        rawDocs = ordSnap.docs.map((d) => d.data());
      } else if (all) {
        const ordSnap = await getDocs(
          query(ordCol, orderBy('number', 'desc'), limit(150))
        ).catch((err) => handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/orders`));
        rawDocs = ordSnap.docs.map((d) => d.data());
      } else {
        const [openSnap, pendSnap] = await Promise.all([
          getDocs(query(ordCol, where('state', '==', 'open'), limit(150))),
          getDocs(query(ordCol, where('fulfillment', '==', 'pending'), limit(150)))
        ]).catch((err) => handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/orders`));
        const byId = new Map();
        openSnap.docs.forEach((d) => byId.set(d.id, d.data()));
        pendSnap.docs.forEach((d) => byId.set(d.id, d.data()));
        rawDocs = [...byId.values()];
      }

      const filtered = rawDocs
        .filter((o) => {
          if (scope === 'waiting') return o.state === 'open' && o.checkoutWaiting;
          if (all) return true;
          return o.state === 'open' || (o.state !== 'cancelled' && o.fulfillment !== 'delivered');
        })
        .sort((a, b) => b.number - a.number)
        .slice(0, 150)
        .filter((o) => canReadOrder(user, o));

      // Backwards-compatible fallback ONLY for legacy orders missing paidCents
      const legacyMissing = hasPermission(user, 'cash.access')
        ? filtered.filter((o) => typeof o.paidCents !== 'number')
        : [];
      const legacyLedgerMap = new Map();
      if (legacyMissing.length) {
        await Promise.all(
          legacyMissing.slice(0, 20).map(async (o) => {
            legacyLedgerMap.set(o.id, await orderLedgerSummary(businessId, o.id));
          })
        );
      }

      const orders = filtered.map((o) => {
        const legacy = legacyLedgerMap.get(o.id);
        return legacy ? orderDto(o, legacy.paid, legacy.refund) : orderDto(o);
      });
      return json({ orders });
    }

    if (path === '/api/orders' && method === 'POST') {
      if (!validKey(body.request_key)) fail(400, 'Identificador da operação inválido.');
      if (body.draft_id != null && typeof body.draft_id !== 'string') fail(400, 'Venda em espera inválida.');
      const idemId = idemDocId('order_create', body.request_key);
      const idemRef = doc(db, 'businesses', businessId, 'idempotency', idemId);
      const preIdem = await getDoc(idemRef).catch(() => null);
      if (preIdem && preIdem.exists()) {
        return json(preIdem.data().result || { ok: true, id: preIdem.data().targetId, replayed: true });
      }

      if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) {
        fail(400, 'Adicione de 1 a 100 itens.');
      }
      if (body.table_number != null) {
        if (!num(body.table_number, 1, 9999)) fail(400, 'Mesa inválida.');
        const tblSnap = await getDocs(
          query(collection(db, 'businesses', businessId, 'tables'), where('number', '==', body.table_number), limit(1))
        ).catch((err) => handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/tables`));
        if (tblSnap.empty || !tblSnap.docs[0].data().active) fail(400, 'Mesa não cadastrada.');
      }

      let customer = null;
      if (body.customer_id) {
        assertPermission(user, 'cash.access');
        const cSnap = await getDoc(doc(db, 'businesses', businessId, 'customers', body.customer_id)).catch(() => null);
        if (!cSnap || !cSnap.exists() || !cSnap.data().active) fail(400, 'Cliente não encontrado ou inativo.');
        customer = cSnap.data();
      }

      const prodMap = await loadProductsByIds(
        businessId,
        body.items.map((i) => i.product_id),
        user
      );

      const pricedItems = [];
      let total = 0;
      for (const item of body.items) {
        if (!num(item.quantity, 1, 999) || typeof item.product_id !== 'string') fail(400, 'Quantidade inválida.');
        const p = prodMap.get(item.product_id);
        if (!p || !p.active || !p.available) fail(409, 'Um produto ficou indisponível. Atualize a seleção.');
        const priced = priceItem(p, item, user);
        pricedItems.push(priced);
        total += priced.unit_price_cents * item.quantity;
      }
      if (total > 100000000) fail(400, 'Total fora do limite.');

      const fingerprint = await digestInput({
        table_number: body.table_number ?? null,
        draft_id: body.draft_id || null,
        items: pricedItems.map((i) => ({ id: i.product_id, qty: i.quantity, unit: i.unit_price_cents }))
      });

      const orderId = crypto.randomUUID();
      const tableLockRef = body.table_number != null ? tableLockDocRef(businessId, body.table_number) : null;
      let resultPayload = null;
      let status = 201;

      await runTransaction(db, async (tx) => {
        // 1) ALL reads BEFORE ANY writes
        const idemSnap = await tx.get(idemRef);
        const tableLockSnap = tableLockRef ? await tx.get(tableLockRef) : null;
        const draftRef = body.draft_id ? doc(db, 'businesses', businessId, 'drafts', body.draft_id) : null;
        const dSnap = draftRef ? await tx.get(draftRef) : null;
        const applyInventory = await prepareInventoryDeduction(tx, businessId, pricedItems, orderId, user);
        const counterOp = await prepareCounter(tx, businessId, 'orders');

        // 2) Validations
        if (idemSnap.exists()) {
          const prior = idemSnap.data();
          if (prior.fingerprint && prior.fingerprint !== fingerprint) fail(409, 'Identificador já usado em outra comanda.');
          resultPayload = prior.result || { ok: true, id: prior.targetId };
          status = 200;
          return;
        }
        if (tableLockSnap && tableLockSnap.exists() && tableLockSnap.data().active === true) {
          fail(409, 'A mesa já possui comanda em atendimento. Abra a comanda existente.');
        }
        if (draftRef && (!dSnap.exists() || dSnap.data().ownerId !== user.id || dSnap.data().state !== 'waiting')) {
          fail(409, 'Esta venda em espera já foi convertida. Atualize a lista.');
        }
        const orderNumber = counterOp.value;

        // 3) ALL writes
        counterOp.apply();
        tx.set(doc(db, 'businesses', businessId, 'orders', orderId), {
          id: orderId,
          number: orderNumber,
          requestKey: body.request_key,
          tableNumber: body.table_number ?? null,
          state: 'open',
          fulfillment: 'pending',
          items: pricedItems,
          totalCents: total,
          discountCents: 0,
          paidCents: 0,
          refundCents: 0,
          actorId: user.id,
          attendantName: user.name || 'Administrador',
          customerId: customer?.id || null,
          customerName: customer?.name || '',
          checkoutWaiting: false,
          version: 1,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        if (tableLockRef) {
          const nextLockVer = tableLockSnap.exists() ? (tableLockSnap.data().version || 1) + 1 : 1;
          const lockPayload = {
            id: 'table_' + body.table_number,
            kind: 'table',
            resourceId: orderId,
            active: true,
            ownerId: user.id,
            orderNumber,
            attendantName: user.name || 'Administrador',
            version: nextLockVer,
            updatedAt: serverTimestamp()
          };
          if (tableLockSnap.exists()) tx.update(tableLockRef, lockPayload);
          else tx.set(tableLockRef, lockPayload);
        }
        if (draftRef && dSnap) {
          tx.update(draftRef, {
            state: 'converted',
            convertedOrderId: orderId,
            version: (dSnap.data().version || 1) + 1,
            updatedAt: serverTimestamp()
          });
        }
        applyInventory();
        resultPayload = { ok: true, id: orderId, number: orderNumber };
        tx.set(idemRef, {
          key: idemId,
          kind: 'order_create',
          fingerprint,
          targetId: orderId,
          actorId: user.id,
          result: resultPayload,
          createdAt: serverTimestamp()
        });
        const auditId = crypto.randomUUID();
        tx.set(doc(db, 'businesses', businessId, 'auditLogs', auditId), {
          id: auditId,
          actorId: auth.currentUser.uid,
          action: 'order.create',
          entityId: orderId,
          createdAt: serverTimestamp()
        });
      }).catch((err) => {
        if (err instanceof HttpError) throw err;
        handleFirestoreError(err, OperationType.WRITE, `businesses/${businessId}/orders/${orderId}`);
      });

      return json(resultPayload, status);
    }

    const orderMatch = path.match(/^\/api\/orders\/([^/]+)(?:\/(payment|finalize|delivery|cancel|items|hold|print|discount|refund|customer|transfer|merge|split|kitchen-print))?$/);
    if (orderMatch) {
      const id = orderMatch[1];
      const task = orderMatch[2];
      const ordRef = doc(db, 'businesses', businessId, 'orders', id);

      if (method === 'GET' && (!task || task === 'print')) {
        const { dto, payments } = await detailedOrder(businessId, id, user, true);
        if (user.role !== 'admin' && !hasPermission(user, 'orders.shared') && !canReadOrder(user, dto)) {
          fail(403, 'Esta comanda não pertence ao seu atendimento.');
        }
        if (hasPermission(user, 'orders.print')) {
          const printState = await getDoc(doc(db, 'businesses', businessId, 'orderPrintStates', id)).catch(() => null);
          const data = printState?.exists() ? printState.data() : null;
          dto.kitchen_printed_item_ids = data?.printedItemIds || [];
          dto.kitchen_print_version = data?.printVersion || 0;
        } else {
          dto.kitchen_printed_item_ids = [];
          dto.kitchen_print_version = 0;
        }
        return json({
          order: dto,
          payments: payments.map((p) => ({
            id: p.id,
            kind: p.kind,
            reversal_of: p.reversalOf || null,
            method: p.method,
            amount_cents: p.amountCents,
            tendered_cents: p.tenderedCents ?? null,
            created_at: tsToIso(p.createdAt)
          })),
          settings: settingsDto(currentSettings, account.business)
        });
      }

      if (method === 'POST') {
        const { dto: currentOrder, raw: rawOrder } = await detailedOrder(businessId, id, user, false);
        if (user.role !== 'admin' && !hasPermission(user, 'orders.shared') && !canReadOrder(user, currentOrder)) {
          fail(403, 'Esta comanda não pertence ao seu atendimento.');
        }
        const tableLockRef = rawOrder.tableNumber != null ? tableLockDocRef(businessId, rawOrder.tableNumber) : null;

        if (task === 'hold') {
          if (typeof body.waiting !== 'boolean') fail(400, 'Informe a situação de espera.');
          await runTransaction(db, async (tx) => {
            const snap = await tx.get(ordRef);
            if (!snap.exists()) fail(404, 'Comanda não encontrada.');
            const ord = snap.data();
            if (ord.state !== 'open') fail(409, 'A comanda já foi finalizada ou cancelada.');
            tx.update(ordRef, {
              checkoutWaiting: body.waiting,
              checkoutHeldAt: body.waiting ? serverTimestamp() : null,
              checkoutHeldBy: body.waiting ? user.id : null,
              version: (ord.version || 1) + 1,
              updatedAt: serverTimestamp()
            });
          }).catch((err) => {
            if (err instanceof HttpError) throw err;
            handleFirestoreError(err, OperationType.UPDATE, ordRef.path);
          });
          return json({ ok: true });
        }

        if (task === 'customer') {
          let customer = null;
          if (body.customer_id) {
            const cSnap = await getDoc(doc(db, 'businesses', businessId, 'customers', body.customer_id)).catch(() => null);
            if (!cSnap || !cSnap.exists() || !cSnap.data().active) fail(400, 'Cliente não encontrado.');
            customer = cSnap.data();
          }
          await runTransaction(db, async (tx) => {
            const snap = await tx.get(ordRef);
            if (!snap.exists()) fail(404, 'Comanda não encontrada.');
            const ord = snap.data();
            if (ord.state !== 'open' || ord.version !== body.version) {
              fail(409, 'A comanda mudou ou já foi finalizada. Atualize a tela.');
            }
            tx.update(ordRef, {
              customerId: customer?.id || null,
              customerName: customer?.name || '',
              version: (ord.version || 1) + 1,
              updatedAt: serverTimestamp()
            });
          }).catch((err) => {
            if (err instanceof HttpError) throw err;
            handleFirestoreError(err, OperationType.UPDATE, ordRef.path);
          });
          return json({ ok: true });
        }

        if (task === 'transfer') {
          if (!validKey(body.request_key) || !num(body.target_table_number, 1, 9999) || clean(body.reason, 200).length < 3 || !num(body.version, 1, 1000000000)) {
            fail(400, 'Informe a mesa de destino, o motivo e atualize a comanda.');
          }
          const tables = await getDocs(query(collection(db, 'businesses', businessId, 'tables'), where('number', '==', body.target_table_number), limit(1)));
          if (tables.empty || !tables.docs[0].data().active) fail(400, 'Mesa de destino não cadastrada ou inativa.');
          const targetLockRef = tableLockDocRef(businessId, body.target_table_number);
          const operationId = idemDocId('order_transfer', body.request_key);
          const operationRef = orderOperationRef(businessId, operationId);
          let resultPayload = null;
          await runTransaction(db, async (tx) => {
            const [operationSnap, orderSnap, sourceLockSnap, targetLockSnap] = await Promise.all([
              tx.get(operationRef), tx.get(ordRef), tableLockRef ? tx.get(tableLockRef) : Promise.resolve(null), tx.get(targetLockRef)
            ]);
            if (operationSnap.exists()) { resultPayload = operationSnap.data().result; return; }
            if (!orderSnap.exists()) fail(404, 'Comanda não encontrada.');
            const order = orderSnap.data();
            if (order.state !== 'open' || order.version !== body.version || (order.paidCents || 0) > 0) fail(409, 'A comanda mudou, foi recebida ou finalizada. Atualize.');
            if (order.tableNumber == null || order.tableNumber === body.target_table_number) fail(400, 'Escolha outra mesa para transferir.');
            if (targetLockSnap.exists() && targetLockSnap.data().active) fail(409, 'A mesa de destino já possui uma comanda.');
            if (!sourceLockSnap?.exists() || !sourceLockSnap.data().active || sourceLockSnap.data().resourceId !== id) fail(409, 'O vínculo da mesa de origem mudou. Atualize.');
            tx.update(ordRef, { tableNumber: body.target_table_number, authorizedBy: operationId, version: order.version + 1, updatedAt: serverTimestamp() });
            tx.update(tableLockRef, { active: false, version: (sourceLockSnap.data().version || 1) + 1, updatedAt: serverTimestamp() });
            const targetPayload = { id: 'table_' + body.target_table_number, kind: 'table', resourceId: id, active: true, ownerId: order.actorId, orderNumber: order.number, attendantName: order.attendantName, version: targetLockSnap.exists() ? (targetLockSnap.data().version || 1) + 1 : 1, updatedAt: serverTimestamp() };
            if (targetLockSnap.exists()) tx.update(targetLockRef, targetPayload); else tx.set(targetLockRef, targetPayload);
            resultPayload = { ok: true, order_id: id, from_table: order.tableNumber, to_table: body.target_table_number };
            tx.set(operationRef, { ...orderOperationPayload(operationId, 'transfer', id, id, body.reason, user, { fromTable: order.tableNumber, toTable: body.target_table_number }), result: resultPayload });
          }).catch((err) => { if (err instanceof HttpError) throw err; handleFirestoreError(err, OperationType.WRITE, ordRef.path); });
          return json(resultPayload);
        }

        if (task === 'merge') {
          if (!validKey(body.request_key) || typeof body.target_order_id !== 'string' || body.target_order_id === id || clean(body.reason, 200).length < 3 || !num(body.version, 1, 1000000000) || !num(body.target_version, 1, 1000000000)) {
            fail(400, 'Escolha outra comanda e informe o motivo da junção.');
          }
          const targetRef = doc(db, 'businesses', businessId, 'orders', body.target_order_id);
          const operationId = idemDocId('order_merge', body.request_key);
          const operationRef = orderOperationRef(businessId, operationId);
          let resultPayload = null;
          await runTransaction(db, async (tx) => {
            const [operationSnap, sourceSnap, targetSnap, sourceLockSnap] = await Promise.all([
              tx.get(operationRef), tx.get(ordRef), tx.get(targetRef), tableLockRef ? tx.get(tableLockRef) : Promise.resolve(null)
            ]);
            if (operationSnap.exists()) { resultPayload = operationSnap.data().result; return; }
            if (!sourceSnap.exists() || !targetSnap.exists()) fail(404, 'Comanda de origem ou destino não encontrada.');
            const source = sourceSnap.data(), target = targetSnap.data();
            if (source.state !== 'open' || target.state !== 'open' || source.version !== body.version || target.version !== body.target_version) fail(409, 'Uma das comandas mudou. Atualize antes de juntar.');
            if ((source.paidCents || 0) || (target.paidCents || 0) || (source.discountCents || 0) || (target.discountCents || 0)) fail(409, 'Somente comandas sem recebimentos e sem desconto podem ser juntadas.');
            if ((source.items || []).length + (target.items || []).length > 100) fail(400, 'A comanda resultante ultrapassaria 100 itens.');
            const combined = [...(target.items || []), ...(source.items || [])];
            const combinedTotal = storedItemsTotal(combined);
            if (combinedTotal !== source.totalCents + target.totalCents) fail(409, 'Os totais das comandas não conferem. Atualize e solicite suporte.');
            tx.update(targetRef, { items: combined, totalCents: combinedTotal, fulfillment: 'pending', authorizedBy: operationId, version: target.version + 1, updatedAt: serverTimestamp() });
            tx.update(ordRef, { items: [], totalCents: 0, state: 'cancelled', fulfillment: 'delivered', checkoutWaiting: false, authorizedBy: operationId, version: source.version + 1, updatedAt: serverTimestamp() });
            if (source.tableNumber != null) {
              if (!sourceLockSnap?.exists() || !sourceLockSnap.data().active || sourceLockSnap.data().resourceId !== id) fail(409, 'A mesa da comanda de origem mudou. Atualize.');
              tx.update(tableLockRef, { active: false, version: (sourceLockSnap.data().version || 1) + 1, updatedAt: serverTimestamp() });
            }
            resultPayload = { ok: true, source_order_id: id, target_order_id: target.id, target_number: target.number, total_cents: combinedTotal };
            tx.set(operationRef, { ...orderOperationPayload(operationId, 'merge', id, target.id, body.reason, user, { sourceTable: source.tableNumber, targetTable: target.tableNumber, sourceTotal: source.totalCents, targetTotalBefore: target.totalCents }), result: resultPayload });
          }).catch((err) => { if (err instanceof HttpError) throw err; handleFirestoreError(err, OperationType.WRITE, ordRef.path); });
          return json(resultPayload);
        }

        if (task === 'split') {
          if (!validKey(body.request_key) || !Array.isArray(body.items) || !body.items.length || body.items.length > 100 || clean(body.reason, 200).length < 3 || !num(body.version, 1, 1000000000) || !(body.target_table_number == null || num(body.target_table_number, 1, 9999))) {
            fail(400, 'Selecione os itens, confira a mesa e informe o motivo da separação.');
          }
          let targetTableRef = null;
          if (body.target_table_number != null) {
            const tables = await getDocs(query(collection(db, 'businesses', businessId, 'tables'), where('number', '==', body.target_table_number), limit(1)));
            if (tables.empty || !tables.docs[0].data().active) fail(400, 'Mesa de destino não cadastrada ou inativa.');
            targetTableRef = tableLockDocRef(businessId, body.target_table_number);
          }
          const operationId = idemDocId('order_split', body.request_key);
          const operationRef = orderOperationRef(businessId, operationId);
          const newOrderId = crypto.randomUUID();
          let resultPayload = null;
          await runTransaction(db, async (tx) => {
            const operationSnap = await tx.get(operationRef);
            const sourceSnap = await tx.get(ordRef);
            const targetLockSnap = targetTableRef ? await tx.get(targetTableRef) : null;
            const counterOp = await prepareCounter(tx, businessId, 'orders');
            if (operationSnap.exists()) { resultPayload = operationSnap.data().result; return; }
            if (!sourceSnap.exists()) fail(404, 'Comanda não encontrada.');
            const source = sourceSnap.data();
            if (source.state !== 'open' || source.version !== body.version) fail(409, 'A comanda mudou. Atualize antes de separar.');
            if ((source.paidCents || 0) || (source.discountCents || 0)) fail(409, 'Somente comandas sem recebimentos e sem desconto podem ser separadas.');
            if (targetLockSnap?.exists() && targetLockSnap.data().active) fail(409, 'A mesa de destino já possui uma comanda.');
            const requested = new Map();
            for (const selection of body.items) {
              if (typeof selection.item_id !== 'string' || !num(selection.quantity, 1, 999) || requested.has(selection.item_id)) fail(400, 'Seleção de itens inválida.');
              requested.set(selection.item_id, selection.quantity);
            }
            const remaining = [], moved = [];
            for (const item of source.items || []) {
              const quantity = requested.get(item.id) || 0;
              if (quantity > item.quantity) fail(409, 'A quantidade selecionada não está mais disponível.');
              if (quantity) moved.push({ ...item, id: crypto.randomUUID(), quantity });
              if (item.quantity > quantity) remaining.push({ ...item, quantity: item.quantity - quantity });
              requested.delete(item.id);
            }
            if (requested.size || !moved.length) fail(400, 'Um item selecionado não pertence mais à comanda.');
            if (!remaining.length) fail(400, 'Para mover a conta inteira, use transferência ou junção de comanda.');
            const remainingTotal = storedItemsTotal(remaining), movedTotal = storedItemsTotal(moved);
            if (remainingTotal + movedTotal !== source.totalCents) fail(409, 'A separação não preservou o total original. Atualize e solicite suporte.');
            const number = counterOp.value; counterOp.apply();
            tx.update(ordRef, { items: remaining, totalCents: remainingTotal, fulfillment: 'pending', authorizedBy: operationId, version: source.version + 1, updatedAt: serverTimestamp() });
            tx.set(doc(db, 'businesses', businessId, 'orders', newOrderId), { id: newOrderId, number, requestKey: body.request_key, tableNumber: body.target_table_number ?? null, state: 'open', fulfillment: 'pending', items: moved, totalCents: movedTotal, discountCents: 0, paidCents: 0, refundCents: 0, actorId: user.id, attendantName: user.name || 'Caixa', customerId: source.customerId || null, customerName: source.customerName || '', checkoutWaiting: false, authorizedBy: operationId, version: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
            if (targetTableRef) {
              const lock = { id: 'table_' + body.target_table_number, kind: 'table', resourceId: newOrderId, active: true, ownerId: user.id, orderNumber: number, attendantName: user.name || 'Caixa', version: targetLockSnap.exists() ? (targetLockSnap.data().version || 1) + 1 : 1, updatedAt: serverTimestamp() };
              if (targetLockSnap.exists()) tx.update(targetTableRef, lock); else tx.set(targetTableRef, lock);
            }
            resultPayload = { ok: true, source_order_id: id, new_order_id: newOrderId, new_number: number, source_total_cents: remainingTotal, new_total_cents: movedTotal };
            tx.set(operationRef, { ...orderOperationPayload(operationId, 'split', id, newOrderId, body.reason, user, { sourceTable: source.tableNumber, targetTable: body.target_table_number ?? null, moved: body.items }), result: resultPayload });
          }).catch((err) => { if (err instanceof HttpError) throw err; handleFirestoreError(err, OperationType.WRITE, ordRef.path); });
          return json(resultPayload, 201);
        }

        if (task === 'kitchen-print') {
          if (!validKey(body.request_key) || !num(body.version, 1, 1000000000)) fail(400, 'Atualize a comanda antes de gerar a impressão.');
          const operationId = idemDocId('kitchen_print', body.request_key);
          const operationRef = orderOperationRef(businessId, operationId);
          const printStateRef = doc(db, 'businesses', businessId, 'orderPrintStates', id);
          let printedOrder = null;
          let resultPayload = null;
          await runTransaction(db, async (tx) => {
            const [operationSnap, orderSnap, printStateSnap] = await Promise.all([tx.get(operationRef), tx.get(ordRef), tx.get(printStateRef)]);
            if (operationSnap.exists()) { resultPayload = operationSnap.data().result; return; }
            if (!orderSnap.exists()) fail(404, 'Comanda não encontrada.');
            const order = orderSnap.data();
            if (order.state === 'cancelled' || order.version !== body.version) fail(409, 'A comanda mudou. Atualize antes de imprimir.');
            const currentPrintState = printStateSnap.exists() ? printStateSnap.data() : null;
            const printed = new Set(currentPrintState?.printedItemIds || []);
            const pending = (order.items || []).filter((item) => !printed.has(item.id));
            if (!pending.length) fail(409, 'Não há itens novos. Use reimprimir pedido completo se necessário.');
            const nextIds = [...printed, ...pending.map((item) => item.id)];
            const printVersion = (currentPrintState?.printVersion || 0) + 1;
            const printState = { orderId: id, printedItemIds: nextIds, printVersion, lastOperationId: operationId, updatedAt: serverTimestamp() };
            if (printStateSnap.exists()) tx.update(printStateRef, printState); else tx.set(printStateRef, printState);
            resultPayload = { ok: true, item_ids: pending.map((item) => item.id), print_version: printVersion };
            tx.set(operationRef, { ...orderOperationPayload(operationId, 'kitchen_print', id, id, 'Impressão de cozinha', user, { itemIds: resultPayload.item_ids, printVersion }), result: resultPayload });
            printedOrder = { ...order, items: pending };
          }).catch((err) => { if (err instanceof HttpError) throw err; handleFirestoreError(err, OperationType.WRITE, ordRef.path); });
          if (!printedOrder) {
            const latest = await getDoc(ordRef); const all = latest.data();
            printedOrder = { ...all, items: (all.items || []).filter((item) => resultPayload.item_ids.includes(item.id)) };
          }
          return json({ order: orderDto(printedOrder), payments: [], settings: settingsDto(currentSettings, account.business), print_kind: resultPayload.print_version === 1 ? 'first' : 'complement', print_version: resultPayload.print_version });
        }

        if (task === 'payment') {
          if (!validKey(body.request_key)) fail(400, 'Identificador da operação inválido.');
          if (body.finish_if_paid !== undefined && typeof body.finish_if_paid !== 'boolean') fail(400, 'Finalização inválida.');
          if (!num(body.amount_cents, 1, 100000000) || !METHODS.includes(body.method) || body.method === 'bank') {
            fail(400, 'Confira valor e forma de pagamento.');
          }
          if (typeof body.session_id !== 'string' || !body.session_id) fail(400, 'Caixa inválido.');
          const tender = body.method === 'cash' ? body.tendered_cents : body.amount_cents;
          if (!num(tender, body.amount_cents, 100000000)) fail(400, 'Valor entregue menor que o pagamento.');

          const idemId = idemDocId('order_pay', body.request_key);
          const idemRef = doc(db, 'businesses', businessId, 'idempotency', idemId);
          const csRef = doc(db, 'businesses', businessId, 'cashSessions', body.session_id);
          const lockRef = cashLockDocRef(businessId);
          const fingerprint = await digestInput({
            order_id: id,
            amount_cents: body.amount_cents,
            method: body.method,
            session_id: body.session_id
          });

          const preCs = await getDoc(csRef).catch(() => null);
          let legacyTotals = null;
          if (preCs && preCs.exists() && typeof preCs.data().cashBalanceCents !== 'number') {
            const ledSnap = await getDocs(query(collection(db, 'businesses', businessId, 'ledger'), where('sessionId', '==', body.session_id)));
            legacyTotals = { cash: preCs.data().openingCents, pix: 0, credit: 0, debit: 0, card: 0 };
            ledSnap.docs.forEach((d) => {
              const l = d.data();
              if (REGISTER_METHODS.includes(l.method)) legacyTotals[l.method] = (legacyTotals[l.method] || 0) + l.amountCents;
            });
          }
          const legacyOrderPaid = typeof rawOrder.paidCents !== 'number' ? (await orderLedgerSummary(businessId, id)).paid : null;

          const ledId = crypto.randomUUID();
          let resultPayload = null;
          let status = 201;

          await runTransaction(db, async (tx) => {
            // 1) ALL reads before ANY writes
            const [idemSnap, ordSnap, csSnap, lockSnap, tableLockSnap] = await Promise.all([
              tx.get(idemRef),
              tx.get(ordRef),
              tx.get(csRef),
              tx.get(lockRef),
              tableLockRef ? tx.get(tableLockRef) : Promise.resolve(null)
            ]);

            // 2) Validations
            if (idemSnap.exists()) {
              const prior = idemSnap.data();
              if (prior.fingerprint && prior.fingerprint !== fingerprint) {
                fail(409, 'Identificador já utilizado em outro pagamento.');
              }
              const latestClosed = ordSnap.exists() ? ordSnap.data().state === 'closed' : !!prior.result?.closed;
              resultPayload = {
                ok: true,
                closed: latestClosed,
                change_cents: prior.result?.change_cents ?? (tender - body.amount_cents)
              };
              status = 200;
              return;
            }
            if (!ordSnap.exists()) fail(404, 'Comanda não encontrada.');
            const ord = ordSnap.data();
            if (!canReadOrder(user, ord)) fail(403, 'Esta comanda não pertence ao seu atendimento.');
            if (
              !csSnap.exists() ||
              csSnap.data().state !== 'open' ||
              (lockSnap.exists() && (!lockSnap.data().active || lockSnap.data().resourceId !== body.session_id))
            ) {
              fail(409, 'O caixa mudou ou está fechado. Atualize a tela.');
            }
            const currentPaid = typeof ord.paidCents === 'number' ? ord.paidCents : legacyOrderPaid || 0;
            if (ord.state !== 'open' || body.amount_cents > ord.totalCents - currentPaid) {
              fail(409, 'Pagamento não registrado: confira saldo da comanda e situação do caixa.');
            }

            const csData = csSnap.data();
            const totals = nextSessionTotals(csData, body.method, body.amount_cents, legacyTotals);
            const newPaid = currentPaid + body.amount_cents;
            const willClose = !!body.finish_if_paid && newPaid >= ord.totalCents;

            // 3) ALL writes
            tx.set(doc(db, 'businesses', businessId, 'ledger', ledId), {
              id: ledId,
              requestKey: body.request_key,
              sessionId: csData.id,
              orderId: id,
              kind: 'sale',
              method: body.method,
              amountCents: body.amount_cents,
              tenderedCents: tender,
              refundedCents: 0,
              description: 'Recebimento de venda',
              category: 'Não classificado',
              financeAccount: body.method === 'cash' ? 'drawer' : 'bank',
              actorId: user.id,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            });
            tx.update(csRef, {
              ...totals,
              version: (csData.version || 1) + 1,
              updatedAt: serverTimestamp()
            });
            tx.update(ordRef, {
              paidCents: newPaid,
              lastLedgerId: ledId,
              version: (ord.version || 1) + 1,
              ...(willClose
                ? {
                    state: 'closed',
                    checkoutWaiting: false,
                    checkoutHeldAt: null,
                    checkoutHeldBy: null,
                    closedAt: serverTimestamp()
                  }
                : {}),
              updatedAt: serverTimestamp()
            });
            if (
              willClose &&
              ord.fulfillment === 'delivered' &&
              tableLockSnap &&
              tableLockSnap.exists() &&
              tableLockSnap.data().active === true &&
              tableLockSnap.data().resourceId === id
            ) {
              tx.update(tableLockRef, {
                active: false,
                version: (tableLockSnap.data().version || 1) + 1,
                updatedAt: serverTimestamp()
              });
            }
            resultPayload = { ok: true, closed: willClose, change_cents: tender - body.amount_cents };
            tx.set(idemRef, {
              key: idemId,
              kind: 'order_payment',
              fingerprint,
              targetId: ledId,
              actorId: user.id,
              result: resultPayload,
              createdAt: serverTimestamp()
            });
            const auditId = crypto.randomUUID();
            tx.set(doc(db, 'businesses', businessId, 'auditLogs', auditId), {
              id: auditId,
              actorId: auth.currentUser.uid,
              action: willClose ? 'order.finalize' : 'order.payment',
              entityId: id,
              createdAt: serverTimestamp()
            });
          }).catch(async (err) => {
            if (err instanceof HttpError) throw err;
            // Rules can reject a stale concurrent commit before the SDK retries it.
            // Confirm the changed documents with authorized reads; never retry a charge blindly.
            if (err?.code === 'permission-denied' || err?.code === 'aborted') {
              const [committed, current] = await Promise.all([
                getDoc(idemRef).catch(() => null), getDoc(ordRef).catch(() => null)
              ]);
              if (committed?.exists() && committed.data().fingerprint === fingerprint) {
                resultPayload = committed.data().result || { ok: true, replayed: true };
                status = 200;
                return;
              }
              if (current?.exists() && (current.data().state !== 'open' || current.data().version !== rawOrder.version)) {
                fail(409, 'A comanda foi alterada por outro atendimento. Atualize e confira o recebimento antes de tentar novamente.');
              }
            }
            handleFirestoreError(err, OperationType.WRITE, `businesses/${businessId}/ledger/${ledId}`);
          });
          return json(resultPayload, status);
        }

        if (task === 'items') {
          if (!validKey(body.request_key)) fail(400, 'Identificador da operação inválido.');
          const idemId = idemDocId('order_items', body.request_key);
          const idemRef = doc(db, 'businesses', businessId, 'idempotency', idemId);
          const preIdem = await getDoc(idemRef).catch(() => null);
          if (preIdem && preIdem.exists()) return json({ ok: true, replayed: true });
          if (rawOrder.state !== 'open' || rawOrder.version !== body.version) fail(409, 'A comanda foi alterada. Atualize antes de lançar.');
          if (!Array.isArray(body.items) || !body.items.length || rawOrder.items.length + body.items.length > 100) {
            fail(400, 'Confira os itens da comanda.');
          }
          const prodMap = await loadProductsByIds(
            businessId,
            body.items.map((i) => i.product_id),
            user
          );
          const added = [];
          let addedTotal = 0;
          for (const i of body.items) {
            if (!num(i.quantity, 1, 999)) fail(400, 'Quantidade inválida.');
            const p = prodMap.get(i.product_id);
            if (!p || !p.active || !p.available) fail(409, 'Produto indisponível.');
            const priced = priceItem(p, i, user);
            added.push(priced);
            addedTotal += priced.unit_price_cents * i.quantity;
          }
          const fingerprint = await digestInput({
            order_id: id,
            version: body.version,
            items: added.map((x) => ({ id: x.product_id, qty: x.quantity, price: x.unit_price_cents }))
          });

          await runTransaction(db, async (tx) => {
            const [idemSnap, snap] = await Promise.all([tx.get(idemRef), tx.get(ordRef)]);
            const applyInv = await prepareInventoryDeduction(tx, businessId, added, body.request_key, user);
            if (idemSnap.exists()) {
              if (idemSnap.data().fingerprint && idemSnap.data().fingerprint !== fingerprint) {
                fail(409, 'Identificador já utilizado em outro lançamento de itens.');
              }
              return;
            }
            if (!snap.exists() || snap.data().state !== 'open' || snap.data().version !== body.version) {
              fail(409, 'A comanda foi alterada. Atualize e confira os itens.');
            }
            const nextTotal = snap.data().totalCents + addedTotal;
            if (nextTotal > 100000000) fail(400, 'Total fora do limite.');

            tx.update(ordRef, {
              items: [...snap.data().items, ...added],
              totalCents: nextTotal,
              fulfillment: 'pending',
              version: snap.data().version + 1,
              updatedAt: serverTimestamp()
            });
            applyInv();
            tx.set(idemRef, {
              key: idemId,
              kind: 'order_items',
              fingerprint,
              targetId: id,
              actorId: user.id,
              result: { ok: true },
              createdAt: serverTimestamp()
            });
            tx.set(doc(db, 'businesses', businessId, 'auditLogs', body.request_key), {
              id: body.request_key,
              actorId: auth.currentUser.uid,
              action: 'order.items',
              entityId: id,
              createdAt: serverTimestamp()
            });
          }).catch((err) => {
            if (err instanceof HttpError) throw err;
            handleFirestoreError(err, OperationType.UPDATE, ordRef.path);
          });
          return json({ ok: true });
        }

        if (task === 'discount') {
          if (!['amount', 'percent'].includes(body.type) || !num(body.value, 0, body.type === 'percent' ? 10000 : 100000000) || !clean(body.reason, 200)) {
            fail(400, 'Informe desconto e motivo.');
          }
          const legacyPaid = typeof rawOrder.paidCents !== 'number' ? (await orderLedgerSummary(businessId, id)).paid : null;
          let discountAmount = 0;
          await runTransaction(db, async (tx) => {
            const snap = await tx.get(ordRef);
            if (!snap.exists()) fail(404, 'Comanda não encontrada.');
            const ord = snap.data();
            if (ord.state !== 'open' || ord.version !== body.version) fail(409, 'A comanda mudou ou está finalizada.');
            const subtotal = ord.totalCents + (ord.discountCents || 0);
            const paid = typeof ord.paidCents === 'number' ? ord.paidCents : legacyPaid || 0;
            const amount = body.type === 'percent' ? Math.round((subtotal * body.value) / 10000) : body.value;
            if (amount > subtotal - paid) {
              fail(400, 'O desconto não pode reduzir o total abaixo do que já foi recebido.');
            }
            discountAmount = amount;
            tx.update(ordRef, {
              totalCents: subtotal - amount,
              discountCents: amount,
              discountReason: clean(body.reason, 200),
              authorizedBy: user.id,
              version: (ord.version || 1) + 1,
              updatedAt: serverTimestamp()
            });
            const auditId = crypto.randomUUID();
            tx.set(doc(db, 'businesses', businessId, 'auditLogs', auditId), {
              id: auditId,
              actorId: auth.currentUser.uid,
              action: 'order.discount.authorized',
              entityId: id,
              details: { before_cents: ord.discountCents || 0, after_cents: amount, reason: clean(body.reason, 200) },
              createdAt: serverTimestamp()
            });
          }).catch((err) => {
            if (err instanceof HttpError) throw err;
            handleFirestoreError(err, OperationType.UPDATE, ordRef.path);
          });
          return json({ ok: true, discount_cents: discountAmount });
        }

        if (task === 'finalize') {
          const legacyPaid = typeof rawOrder.paidCents !== 'number' ? (await orderLedgerSummary(businessId, id)).paid : null;
          await runTransaction(db, async (tx) => {
            const [snap, tableLockSnap] = await Promise.all([
              tx.get(ordRef),
              tableLockRef ? tx.get(tableLockRef) : Promise.resolve(null)
            ]);
            if (!snap.exists()) fail(404, 'Comanda não encontrada.');
            const ord = snap.data();
            if (ord.state === 'closed') return;
            const paid = typeof ord.paidCents === 'number' ? ord.paidCents : legacyPaid || 0;
            if (ord.state !== 'open' || paid < ord.totalCents) {
              fail(409, 'A comanda precisa estar quitada para finalizar.');
            }
            tx.update(ordRef, {
              state: 'closed',
              checkoutWaiting: false,
              checkoutHeldAt: null,
              checkoutHeldBy: null,
              version: (ord.version || 1) + 1,
              closedAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            });
            if (
              ord.fulfillment === 'delivered' &&
              tableLockSnap &&
              tableLockSnap.exists() &&
              tableLockSnap.data().active === true &&
              tableLockSnap.data().resourceId === id
            ) {
              tx.update(tableLockRef, {
                active: false,
                version: (tableLockSnap.data().version || 1) + 1,
                updatedAt: serverTimestamp()
              });
            }
          }).catch((err) => {
            if (err instanceof HttpError) throw err;
            handleFirestoreError(err, OperationType.UPDATE, ordRef.path);
          });
          return json({ ok: true });
        }

        if (task === 'delivery') {
          await runTransaction(db, async (tx) => {
            const [snap, tableLockSnap] = await Promise.all([
              tx.get(ordRef),
              tableLockRef ? tx.get(tableLockRef) : Promise.resolve(null)
            ]);
            if (!snap.exists()) fail(404, 'Comanda não encontrada.');
            const ord = snap.data();
            if (ord.state === 'cancelled') fail(409, 'Comanda cancelada.');
            if (ord.fulfillment !== 'delivered') {
              tx.update(ordRef, {
                fulfillment: 'delivered',
                version: (ord.version || 1) + 1,
                updatedAt: serverTimestamp()
              });
            }
            if (
              ord.state === 'closed' &&
              tableLockSnap &&
              tableLockSnap.exists() &&
              tableLockSnap.data().active === true &&
              tableLockSnap.data().resourceId === id
            ) {
              tx.update(tableLockRef, {
                active: false,
                version: (tableLockSnap.data().version || 1) + 1,
                updatedAt: serverTimestamp()
              });
            }
          }).catch((err) => {
            if (err instanceof HttpError) throw err;
            handleFirestoreError(err, OperationType.UPDATE, ordRef.path);
          });
          return json({ ok: true });
        }

        if (task === 'cancel') {
          if (!clean(body.reason, 200)) fail(400, 'Informe o motivo do cancelamento.');
          const legacyPaid = typeof rawOrder.paidCents !== 'number' ? (await orderLedgerSummary(businessId, id)).paid : null;
          await runTransaction(db, async (tx) => {
            const [snap, tableLockSnap] = await Promise.all([
              tx.get(ordRef),
              tableLockRef ? tx.get(tableLockRef) : Promise.resolve(null)
            ]);
            if (!snap.exists()) fail(404, 'Comanda não encontrada.');
            const ord = snap.data();
            if (ord.state === 'cancelled') return;
            const paid = typeof ord.paidCents === 'number' ? ord.paidCents : legacyPaid || 0;
            if (ord.state !== 'open' || paid !== 0) {
              fail(409, 'Somente comandas abertas e sem recebimentos podem ser canceladas nesta versão.');
            }
            tx.update(ordRef, {
              state: 'cancelled',
              fulfillment: 'delivered',
              authorizedBy: user.id,
              version: (ord.version || 1) + 1,
              updatedAt: serverTimestamp()
            });
            if (
              tableLockSnap &&
              tableLockSnap.exists() &&
              tableLockSnap.data().active === true &&
              tableLockSnap.data().resourceId === id
            ) {
              tx.update(tableLockRef, {
                active: false,
                version: (tableLockSnap.data().version || 1) + 1,
                updatedAt: serverTimestamp()
              });
            }
            const auditId = crypto.randomUUID();
            tx.set(doc(db, 'businesses', businessId, 'auditLogs', auditId), {
              id: auditId,
              actorId: auth.currentUser.uid,
              action: 'order.cancel: ' + clean(body.reason, 180),
              entityId: id,
              createdAt: serverTimestamp()
            });
          }).catch((err) => {
            if (err instanceof HttpError) throw err;
            handleFirestoreError(err, OperationType.UPDATE, ordRef.path);
          });
          return json({ ok: true });
        }

        if (task === 'refund') {
          if (!validKey(body.request_key) || !num(body.amount_cents, 1, 100000000) || !clean(body.reason, 200)) {
            fail(400, 'Informe pagamento, valor e motivo do estorno.');
          }
          if (typeof body.payment_id !== 'string' || !body.payment_id) fail(400, 'Pagamento inválido.');
          if (typeof body.session_id !== 'string' || !body.session_id) fail(400, 'Caixa inválido.');
          if (body.confirmed !== true) fail(400, 'Confirme que o valor foi devolvido ao cliente.');

          const idemId = idemDocId('order_refund', body.request_key);
          const idemRef = doc(db, 'businesses', businessId, 'idempotency', idemId);
          const origLedRef = doc(db, 'businesses', businessId, 'ledger', body.payment_id);
          const csRef = doc(db, 'businesses', businessId, 'cashSessions', body.session_id);
          const lockRef = cashLockDocRef(businessId);
          const fingerprint = await digestInput({
            order_id: id,
            payment_id: body.payment_id,
            amount_cents: body.amount_cents,
            session_id: body.session_id
          });

          // Legacy fallbacks strictly if pre-existing documents lack refundedCents / cashBalanceCents
          const [preOrigSnap, preCsSnap] = await Promise.all([getDoc(origLedRef), getDoc(csRef)]).catch(() => [null, null]);
          let legacyOrigRefunded = 0;
          if (preOrigSnap && preOrigSnap.exists() && typeof preOrigSnap.data().refundedCents !== 'number') {
            const ordLedSnap = await getDocs(query(collection(db, 'businesses', businessId, 'ledger'), where('orderId', '==', id)));
            legacyOrigRefunded = ordLedSnap.docs
              .map((d) => d.data())
              .filter((l) => l.kind === 'refund' && l.reversalOf === body.payment_id)
              .reduce((a, l) => a - l.amountCents, 0);
          }
          let legacyTotals = null;
          if (preCsSnap && preCsSnap.exists() && typeof preCsSnap.data().cashBalanceCents !== 'number') {
            const sessLedSnap = await getDocs(
              query(collection(db, 'businesses', businessId, 'ledger'), where('sessionId', '==', body.session_id))
            );
            legacyTotals = { cash: preCsSnap.data().openingCents, pix: 0, credit: 0, debit: 0, card: 0 };
            sessLedSnap.docs.forEach((d) => {
              const l = d.data();
              if (REGISTER_METHODS.includes(l.method)) legacyTotals[l.method] = (legacyTotals[l.method] || 0) + l.amountCents;
            });
          }

          const refId = crypto.randomUUID();
          let status = 201;

          await runTransaction(db, async (tx) => {
            const [idemSnap, ordSnap, origSnap, csSnap, lockSnap] = await Promise.all([
              tx.get(idemRef),
              tx.get(ordRef),
              tx.get(origLedRef),
              tx.get(csRef),
              tx.get(lockRef)
            ]);
            if (idemSnap.exists()) {
              const prior = idemSnap.data();
              if (prior.fingerprint && prior.fingerprint !== fingerprint) {
                fail(409, 'Identificador de operação já utilizado.');
              }
              status = 200;
              return;
            }
            if (!origSnap.exists() || origSnap.data().orderId !== id || origSnap.data().kind !== 'sale') {
              fail(404, 'Recebimento original não encontrado.');
            }
            if (
              !csSnap.exists() ||
              csSnap.data().state !== 'open' ||
              (lockSnap.exists() && (!lockSnap.data().active || lockSnap.data().resourceId !== body.session_id))
            ) {
              fail(409, 'Abra ou atualize o caixa antes de registrar o estorno.');
            }
            const original = origSnap.data();
            const alreadyRefunded =
              typeof original.refundedCents === 'number' ? original.refundedCents : legacyOrigRefunded;
            if (alreadyRefunded + body.amount_cents > original.amountCents) {
              fail(409, 'Estorno não registrado. Confira valor já devolvido.');
            }

            const csData = csSnap.data();
            const totals = nextSessionTotals(csData, original.method, -body.amount_cents, legacyTotals);

            tx.set(doc(db, 'businesses', businessId, 'ledger', refId), {
              id: refId,
              requestKey: body.request_key,
              sessionId: csData.id,
              orderId: id,
              reversalOf: original.id,
              kind: 'refund',
              method: original.method,
              amountCents: -body.amount_cents,
              description: 'Estorno de recebimento',
              reason: clean(body.reason, 200),
              category: 'Não classificado',
              financeAccount: original.method === 'cash' ? 'drawer' : 'bank',
              actorId: user.id,
              authorizedBy: user.id,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            });
            tx.update(origLedRef, {
              refundedCents: alreadyRefunded + body.amount_cents,
              updatedAt: serverTimestamp()
            });
            tx.update(csRef, {
              ...totals,
              version: (csData.version || 1) + 1,
              updatedAt: serverTimestamp()
            });
            if (ordSnap.exists() && ordSnap.data().state === 'closed') {
              const ord = ordSnap.data();
              tx.update(ordRef, {
                refundCents: (ord.refundCents || 0) + body.amount_cents,
                version: (ord.version || 1) + 1,
                updatedAt: serverTimestamp()
              });
            }
            tx.set(idemRef, {
              key: idemId,
              kind: 'order_refund',
              fingerprint,
              targetId: refId,
              actorId: user.id,
              result: { ok: true },
              createdAt: serverTimestamp()
            });
            const auditId = crypto.randomUUID();
            tx.set(doc(db, 'businesses', businessId, 'auditLogs', auditId), {
              id: auditId,
              actorId: auth.currentUser.uid,
              action: 'payment.refund.authorized',
              entityId: original.id,
              createdAt: serverTimestamp()
            });
          }).catch((err) => {
            if (err instanceof HttpError) throw err;
            handleFirestoreError(err, OperationType.WRITE, `businesses/${businessId}/ledger/${refId}`);
          });
          return json({ ok: true }, status);
        }
      }
    }

    // /api/returns
    if (path === '/api/returns' && method === 'GET') {
      const q = url.searchParams.get('number');
      if (q && !/^\d{1,12}$/.test(q)) fail(400, 'Número de venda inválido.');
      const ordCol = collection(db, 'businesses', businessId, 'orders');
      const ordSnap = await getDocs(
        q
          ? query(ordCol, where('number', '==', Number(q)), limit(10))
          : query(ordCol, orderBy('number', 'desc'), limit(100))
      ).catch((err) => handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/orders`));
      const rows = ordSnap.docs
        .map((d) => d.data())
        .filter((o) => o.state === 'closed' && (!q || o.number === Number(q)))
        .sort((a, b) => b.number - a.number)
        .slice(0, 100)
        .filter((o) => canReadOrder(user, o))
        .map((o) => ({
          id: o.id,
          number: o.number,
          total_cents: o.totalCents,
          created_at: tsToIso(o.createdAt),
          customer_name: o.customerName || ''
        }));
      return json({ orders: rows });
    }

    const retMatch = path.match(/^\/api\/returns\/([^/]+)$/);
    if (retMatch) {
      const orderId = retMatch[1];
      if (method === 'GET') return json(await returnDetail(businessId, user, orderId));
      if (method === 'POST') {
        if (
          !validKey(body.request_key) ||
          !['return', 'exchange'].includes(body.kind) ||
          !Array.isArray(body.items) ||
          !body.items.length ||
          body.items.length > 100 ||
          clean(body.reason, 200).length < 3 ||
          body.confirmed !== true
        ) {
          fail(400, 'Confira os itens e confirme a devolução ou troca.');
        }
        if (body.kind === 'exchange') {
          assertPermission(user, 'payments.receive');
          assertPermission(user, 'orders.create');
        }
        if (typeof body.session_id !== 'string' || !body.session_id) fail(400, 'Caixa inválido.');

        const fingerprint = await digestInput(body);
        const idemId = idemDocId('sale_return', body.request_key);
        const idemRef = doc(db, 'businesses', businessId, 'idempotency', idemId);
        const preIdem = await getDoc(idemRef).catch(() => null);
        if (preIdem && preIdem.exists()) {
          const prior = preIdem.data();
          if (prior.fingerprint !== fingerprint || prior.actorId !== user.id || prior.result?.order_id !== orderId) {
            fail(409, 'Identificador já usado em outra devolução.');
          }
          return json({
            ok: true,
            id: prior.targetId,
            replacement_order_id: prior.result?.replacement_order_id || null,
            replayed: true
          });
        }

        const detail = await returnDetail(businessId, user, orderId);
        const o = detail.order;
        if (o.state !== 'closed' || o.version !== body.version) fail(409, 'A venda mudou ou não está finalizada. Atualize a tela.');

        let amount = 0;
        let restored = 0;
        let unknown = 0;
        const selected = [];
        const seen = new Set();
        for (const selection of body.items) {
          const line = detail.lines.find((l) => l.id === selection.item_id);
          if (!line || seen.has(line.id) || !num(selection.quantity, 1, line.remaining_quantity) || typeof selection.restock !== 'boolean') {
            fail(400, 'Confira as quantidades disponíveis para devolução.');
          }
          seen.add(line.id);
          if (selection.restock && !line.restock_allowed) {
            fail(400, 'Somente mercadoria com estoque por unidade pode retornar automaticamente.');
          }
          const value =
            Math.floor((line.net_cents * (line.returned_quantity + selection.quantity)) / line.quantity) -
            Math.floor((line.net_cents * line.returned_quantity) / line.quantity);
          amount += value;
          if (selection.restock) {
            if (line.inventory_unit_cost_cents == null) unknown += selection.quantity;
            else restored += line.inventory_unit_cost_cents * selection.quantity;
          }
          selected.push({ ...line, return_quantity: selection.quantity, refund_cents: value, restock: selection.restock });
        }

        const payments = detail.payments;
        if (payments.reduce((n, p) => n + Math.max(0, p.available), 0) < amount) {
          fail(409, 'Parte do valor já foi estornada. Confira o histórico antes de devolver novamente.');
        }

        const replacements = [];
        let newTotal = 0;
        if (body.kind === 'exchange') {
          if (!Array.isArray(body.replacements) || !body.replacements.length || body.replacements.length > 100) {
            fail(400, 'Escolha os produtos da troca.');
          }
          const prodMap = await loadProductsByIds(
            businessId,
            body.replacements.map((item) => item.product_id),
            user
          );
          for (const item of body.replacements) {
            if (!num(item.quantity, 1, 999)) fail(400, 'Quantidade inválida na troca.');
            const p = prodMap.get(item.product_id);
            if (!p || !p.active || !p.available) fail(409, 'Produto da troca indisponível.');
            const line = priceItem(p, item, user);
            replacements.push(line);
            newTotal += line.quantity * line.unit_price_cents;
          }
          if (!num(newTotal, 1, 100000000) || newTotal !== body.expected_replacement_cents) {
            fail(409, 'O preço da troca mudou. Atualize e confira novamente.');
          }
        }

        const credit = Math.min(amount, newTotal);
        const extra = Math.max(0, newTotal - amount);
        const difference = Math.max(0, amount - newTotal);
        const newId = body.kind === 'exchange' ? crypto.randomUUID() : null;
        const returnId = crypto.randomUUID();
        if (extra && !['cash', 'pix', 'credit', 'debit'].includes(body.method)) {
          fail(400, 'Selecione a forma de receber a diferença.');
        }
        const tender = extra ? (body.method === 'cash' ? body.tendered_cents : extra) : 0;
        if (extra && !num(tender, extra, 100000000)) fail(400, 'Dinheiro insuficiente para a diferença.');

        const creditAllocations = [];
        const refundWrites = [];
        const allocatedPerPayment = new Map();
        let internalLeft = credit;
        let cashOut = 0;
        let unallocated = amount;
        for (const p of payments) {
          const chunk = Math.min(unallocated, Math.max(0, p.available));
          if (!chunk) continue;
          unallocated -= chunk;
          allocatedPerPayment.set(p.id, { total: chunk, initialAvail: p.available });
          const internal = Math.min(internalLeft, chunk);
          internalLeft -= internal;
          const external = chunk - internal;
          if (internal) creditAllocations.push({ payment_id: p.id, value: internal });
          for (const [val, m, acct] of [
            [internal, 'exchange_credit', 'internal'],
            [external, p.refund_method, p.refund_method === 'cash' ? 'drawer' : 'bank']
          ]) {
            if (!val) continue;
            if (m === 'cash') cashOut += val;
            refundWrites.push({ val, method: m, acct, reversalOf: p.id });
          }
        }

        const csRef = doc(db, 'businesses', businessId, 'cashSessions', body.session_id);
        const lockRef = cashLockDocRef(businessId);
        const preCs = await getDoc(csRef).catch(() => null);
        let legacyTotals = null;
        if (preCs && preCs.exists() && typeof preCs.data().cashBalanceCents !== 'number') {
          const sessLedSnap = await getDocs(
            query(collection(db, 'businesses', businessId, 'ledger'), where('sessionId', '==', body.session_id))
          );
          legacyTotals = { cash: preCs.data().openingCents, pix: 0, credit: 0, debit: 0, card: 0 };
          sessLedSnap.docs.forEach((d) => {
            const l = d.data();
            if (REGISTER_METHODS.includes(l.method)) legacyTotals[l.method] = (legacyTotals[l.method] || 0) + l.amountCents;
          });
        }

        let responsePayload = null;
        let status = 201;

        await runTransaction(db, async (tx) => {
          // 1) ALL reads strictly before ANY writes
          const ordRef = doc(db, 'businesses', businessId, 'orders', orderId);
          const restockTargets = selected.filter((line) => line.restock && line.inventory_id);
          const paymentIds = [...allocatedPerPayment.keys()];

          const [idemSnap, freshOrd, csSnap, lockSnap, ...paymentSnaps] = await Promise.all([
            tx.get(idemRef),
            tx.get(ordRef),
            tx.get(csRef),
            tx.get(lockRef),
            ...paymentIds.map((pid) => tx.get(doc(db, 'businesses', businessId, 'ledger', pid)))
          ]);
          const restockSnaps = await Promise.all(
            restockTargets.map(async (line) => {
              const sRef = doc(db, 'businesses', businessId, 'inventoryStock', line.inventory_id);
              const iRef = doc(db, 'businesses', businessId, 'inventoryItems', line.inventory_id);
              const [sSnap, iSnap] = await Promise.all([tx.get(sRef), tx.get(iRef)]);
              return { line, sRef, iRef, sData: sSnap.exists() ? sSnap.data() : null, iData: iSnap.exists() ? iSnap.data() : null };
            })
          );
          const applyInvReplace = newId ? await prepareInventoryDeduction(tx, businessId, replacements, newId, user) : null;
          const counterOp = newId ? await prepareCounter(tx, businessId, 'orders') : null;

          // 2) Validations after all reads
          if (idemSnap.exists()) {
            const prior = idemSnap.data();
            if (prior.fingerprint !== fingerprint || prior.actorId !== user.id || prior.result?.order_id !== orderId) {
              fail(409, 'Identificador já usado em outra devolução.');
            }
            responsePayload = {
              ok: true,
              id: prior.targetId,
              replacement_order_id: prior.result?.replacement_order_id || null,
              replayed: true
            };
            status = 200;
            return;
          }
          if (!freshOrd.exists() || freshOrd.data().state !== 'closed' || freshOrd.data().version !== body.version) {
            fail(409, 'A venda mudou. Atualize antes de registrar.');
          }
          if (
            !csSnap.exists() ||
            csSnap.data().state !== 'open' ||
            (lockSnap.exists() && (!lockSnap.data().active || lockSnap.data().resourceId !== body.session_id))
          ) {
            fail(409, 'Abra ou atualize o caixa para registrar.');
          }

          const saleLedgerUpdates = [];
          paymentIds.forEach((pid, idx) => {
            const snap = paymentSnaps[idx];
            if (!snap.exists()) fail(409, 'Recebimento original não localizado.');
            const ledData = snap.data();
            const alloc = allocatedPerPayment.get(pid);
            const alreadyRefunded =
              typeof ledData.refundedCents === 'number'
                ? ledData.refundedCents
                : Math.max(0, ledData.amountCents - alloc.initialAvail);
            if (alreadyRefunded + alloc.total > ledData.amountCents) {
              fail(409, 'Parte do valor já foi estornada. Confira o histórico antes de devolver novamente.');
            }
            saleLedgerUpdates.push({
              ref: doc(db, 'businesses', businessId, 'ledger', pid),
              nextRefunded: alreadyRefunded + alloc.total
            });
          });

          const csData = csSnap.data();
          let workingCs = { ...csData };
          let workingTotals = legacyTotals ? { ...legacyTotals } : null;
          for (const w of refundWrites) {
            if (REGISTER_METHODS.includes(w.method)) {
              const t = nextSessionTotals(workingCs, w.method, -w.val, workingTotals);
              workingCs.cashBalanceCents = t.cashBalanceCents;
              workingCs.methodTotals = t.methodTotals;
              workingTotals = null;
            }
          }
          if (extra && REGISTER_METHODS.includes(body.method)) {
            const t = nextSessionTotals(workingCs, body.method, extra, workingTotals);
            workingCs.cashBalanceCents = t.cashBalanceCents;
            workingCs.methodTotals = t.methodTotals;
          }

          // 3) ALL writes strictly after all reads and checks
          if (counterOp) counterOp.apply();

          tx.set(doc(db, 'businesses', businessId, 'returns', returnId), {
            id: returnId,
            requestKey: body.request_key,
            fingerprint,
            orderId,
            kind: body.kind,
            items: selected.map((l) => ({ item_id: l.id, name: l.name, quantity: l.return_quantity, restock: l.restock })),
            lines: selected.map((l) => ({
              item_id: l.id,
              product_id: l.product_id,
              quantity: l.return_quantity,
              refund_cents: l.refund_cents,
              restocked: l.restock,
              unit_cost_cents: l.inventory_unit_cost_cents ?? null,
              inventory_id: l.inventory_id || null
            })),
            amountCents: amount,
            restoredCostCents: restored,
            unknownCostQuantity: unknown,
            originalClosedAt: freshOrd.data().closedAt || freshOrd.data().createdAt,
            replacementOrderId: newId,
            actorId: user.id,
            reason: clean(body.reason, 200),
            createdAt: serverTimestamp()
          });

          refundWrites.forEach((w, idx) => {
            const lid = crypto.randomUUID();
            tx.set(doc(db, 'businesses', businessId, 'ledger', lid), {
              id: lid,
              requestKey: 'return:' + returnId + ':' + idx,
              sessionId: csData.id,
              orderId,
              reversalOf: w.reversalOf,
              kind: 'refund',
              method: w.method,
              amountCents: -w.val,
              description: body.kind === 'exchange' ? 'Troca de mercadorias' : 'Devolução de mercadorias',
              reason: clean(body.reason, 200),
              category: 'Não classificado',
              financeAccount: w.acct,
              actorId: user.id,
              authorizedBy: user.id,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            });
          });

          for (const lu of saleLedgerUpdates) {
            tx.update(lu.ref, {
              refundedCents: lu.nextRefunded,
              updatedAt: serverTimestamp()
            });
          }

          for (const ru of restockSnaps) {
            const qtyMilli = ru.line.return_quantity * 1000;
            const prevBal = ru.sData?.balanceMilli || 0;
            if (ru.sData) {
              tx.update(ru.sRef, { balanceMilli: prevBal + qtyMilli, updatedAt: serverTimestamp() });
            }
            if (ru.iData) {
              const c = ru.line.inventory_unit_cost_cents ?? null;
              const prevMicro = ru.iData.unitCostMicro;
              const nextMicro =
                c === null || (prevMicro == null && prevBal > 0)
                  ? null
                  : Math.round((Number(prevMicro || 0) * prevBal + c * 1000000 * qtyMilli) / (prevBal + qtyMilli));
              tx.update(ru.iRef, { unitCostMicro: nextMicro, updatedAt: serverTimestamp() });
            }
            const mid = crypto.randomUUID();
            tx.set(doc(db, 'businesses', businessId, 'inventoryMoves', mid), {
              id: mid,
              requestKey: 'return-stock:' + returnId + ':' + ru.line.id,
              itemId: ru.line.inventory_id,
              quantityMilli: qtyMilli,
              kind: 'return',
              sourceId: returnId,
              reason: clean(body.reason, 200),
              actorId: user.id,
              createdAt: serverTimestamp()
            });
          }

          if (newId) {
            const creditLedgerIds = creditAllocations.map(() => crypto.randomUUID());
            const extraLedgerId = extra ? crypto.randomUUID() : null;
            const firstSaleLedgerId = creditLedgerIds[0] || extraLedgerId || null;
            tx.set(doc(db, 'businesses', businessId, 'orders', newId), {
              id: newId,
              number: counterOp.value,
              requestKey: 'exchange_' + returnId,
              tableNumber: null,
              state: 'closed',
              fulfillment: 'delivered',
              items: replacements,
              totalCents: newTotal,
              discountCents: 0,
              paidCents: newTotal,
              ...(firstSaleLedgerId ? { lastLedgerId: firstSaleLedgerId } : {}),
              refundCents: 0,
              actorId: user.id,
              attendantName: user.name || 'Caixa',
              customerId: o.customer_id || null,
              customerName: o.customer_name || '',
              checkoutWaiting: false,
              exchangeFromOrderId: orderId,
              version: 1,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              closedAt: serverTimestamp()
            });
            creditAllocations.forEach((alloc, idx) => {
              const lid = creditLedgerIds[idx];
              tx.set(doc(db, 'businesses', businessId, 'ledger', lid), {
                id: lid,
                requestKey: 'exchange-credit:' + returnId + ':' + alloc.payment_id,
                sessionId: csData.id,
                orderId: newId,
                reversalOf: alloc.payment_id,
                kind: 'sale',
                method: 'exchange_credit',
                amountCents: alloc.value,
                refundedCents: 0,
                description: 'Compensação de troca',
                category: 'Não classificado',
                financeAccount: 'internal',
                actorId: user.id,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
              });
            });
            if (extra && extraLedgerId) {
              const lid = extraLedgerId;
              tx.set(doc(db, 'businesses', businessId, 'ledger', lid), {
                id: lid,
                requestKey: 'exchange-payment:' + returnId,
                sessionId: csData.id,
                orderId: newId,
                kind: 'sale',
                method: body.method,
                amountCents: extra,
                tenderedCents: tender,
                refundedCents: 0,
                description: 'Diferença de troca',
                category: 'Não classificado',
                financeAccount: body.method === 'cash' ? 'drawer' : 'bank',
                actorId: user.id,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
              });
            }
            if (applyInvReplace) applyInvReplace();
          }

          tx.update(csRef, {
            cashBalanceCents: workingCs.cashBalanceCents ?? csData.openingCents,
            methodTotals: workingCs.methodTotals || { cash: csData.openingCents, pix: 0, credit: 0, debit: 0, card: 0 },
            version: (csData.version || 1) + 1,
            updatedAt: serverTimestamp()
          });
          tx.update(ordRef, {
            refundCents: (freshOrd.data().refundCents || 0) + amount,
            version: (freshOrd.data().version || 1) + 1,
            updatedAt: serverTimestamp()
          });
          responsePayload = {
            ok: true,
            id: returnId,
            order_id: orderId,
            replacement_order_id: newId,
            refund_cents: amount,
            external_refund_cents: difference,
            received_difference_cents: extra,
            change_cents: extra && body.method === 'cash' ? tender - extra : 0
          };
          tx.set(idemRef, {
            key: idemId,
            kind: 'sale_return',
            fingerprint,
            targetId: returnId,
            actorId: user.id,
            result: responsePayload,
            createdAt: serverTimestamp()
          });
          const auditId = crypto.randomUUID();
          tx.set(doc(db, 'businesses', businessId, 'auditLogs', auditId), {
            id: auditId,
            actorId: auth.currentUser.uid,
            action: 'sale.return',
            entityId: orderId,
            createdAt: serverTimestamp()
          });
        }).catch((err) => {
          if (err instanceof HttpError) throw err;
          handleFirestoreError(err, OperationType.WRITE, `businesses/${businessId}/returns/${returnId}`);
        });

        return json(responsePayload, status);
      }
    }

    // /api/finance
    if (path === '/api/finance' && method === 'GET') {
      const [accSnap, ledSnap, ordSnap] = await Promise.all([
        getDocs(query(collection(db, 'businesses', businessId, 'accounts'), orderBy('dueDate'), limit(300))),
        getDocs(query(collection(db, 'businesses', businessId, 'ledger'), orderBy('createdAt', 'desc'), limit(500))),
        getDocs(query(collection(db, 'businesses', businessId, 'orders'), where('state', '==', 'open'), limit(500)))
      ]).catch((err) => handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/accounts`));

      const accounts = accSnap.docs
        .map((d) => {
          const a = d.data();
          return {
            ...a,
            due_date: a.dueDate,
            amount_cents: a.amountCents,
            created_at: tsToIso(a.createdAt),
            settled_at: tsToIso(a.settledAt)
          };
        })
        .sort((a, b) => a.due_date.localeCompare(b.due_date))
        .slice(0, 300);

      const led = ledSnap.docs
        .map((d) => d.data())
        .sort((a, b) => new Date(tsToIso(b.createdAt) || 0) - new Date(tsToIso(a.createdAt) || 0));

      const salesCents = led.filter((l) => ['sale', 'refund'].includes(l.kind)).reduce((s, l) => s + l.amountCents, 0);
      const expensesCents = led.filter((l) => ['expense', 'payable'].includes(l.kind)).reduce((s, l) => s - l.amountCents, 0);
      const payableCents = accounts.filter((a) => a.state === 'pending' && a.kind === 'payable').reduce((s, a) => s + a.amount_cents, 0);
      const receivableCents = accounts.filter((a) => a.state === 'pending' && a.kind === 'receivable').reduce((s, a) => s + a.amount_cents, 0);

      const paidByOrder = new Map();
      led.filter((l) => l.orderId && ['sale', 'refund'].includes(l.kind)).forEach((l) => {
        paidByOrder.set(l.orderId, (paidByOrder.get(l.orderId) || 0) + l.amountCents);
      });
      const openOrdersDue = ordSnap.docs
        .map((d) => d.data())
        .filter((o) => o.state === 'open')
        .reduce((s, o) => s + Math.max(0, o.totalCents - (typeof o.paidCents === 'number' ? o.paidCents : paidByOrder.get(o.id) || 0)), 0);

      return json({
        accounts,
        ledger: led.slice(0, 300).map(ledgerDto),
        summary: { sales_cents: salesCents, expenses_cents: expensesCents },
        pending: { payable_cents: payableCents, receivable_cents: receivableCents },
        open_orders_due: { amount_cents: openOrdersDue }
      });
    }

    if (path === '/api/finance/accounts' && method === 'POST') {
      if (!validKey(body.request_key)) fail(400, 'Identificador da operação inválido.');
      if (
        !['payable', 'receivable'].includes(body.kind) ||
        !num(body.amount_cents, 1, 100000000) ||
        !clean(body.title, 200) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(body.due_date || '') ||
        Number.isNaN(Date.parse(body.due_date))
      ) {
        fail(400, 'Confira descrição, tipo, valor e vencimento.');
      }
      const idemId = idemDocId('fin_account', body.request_key);
      const idemRef = doc(db, 'businesses', businessId, 'idempotency', idemId);
      const fingerprint = await digestInput({
        kind: body.kind,
        title: clean(body.title, 200),
        amount_cents: body.amount_cents,
        due_date: body.due_date
      });
      const accId = crypto.randomUUID();
      let resultId = accId;
      let status = 201;
      await runTransaction(db, async (tx) => {
        const idemSnap = await tx.get(idemRef);
        if (idemSnap.exists()) {
          const prior = idemSnap.data();
          if (prior.fingerprint && prior.fingerprint !== fingerprint) fail(409, 'Identificador já usado em outro lançamento.');
          resultId = prior.targetId;
          status = 200;
          return;
        }
        tx.set(doc(db, 'businesses', businessId, 'accounts', accId), {
          id: accId,
          requestKey: body.request_key,
          kind: body.kind,
          title: clean(body.title, 200),
          amountCents: body.amount_cents,
          dueDate: body.due_date,
          state: 'pending',
          category: clean(body.category, 80) || 'Não classificado',
          recurrence: ['monthly', 'weekly'].includes(body.recurrence) ? body.recurrence : null,
          actorId: user.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        tx.set(idemRef, {
          key: idemId,
          kind: 'fin_account',
          fingerprint,
          targetId: accId,
          actorId: user.id,
          result: { ok: true, id: accId },
          createdAt: serverTimestamp()
        });
      }).catch((err) => {
        if (err instanceof HttpError) throw err;
        handleFirestoreError(err, OperationType.WRITE, `businesses/${businessId}/accounts/${accId}`);
      });
      return json({ ok: true, id: resultId }, status);
    }

    const settleMatch = path.match(/^\/api\/finance\/accounts\/([^/]+)\/settle$/);
    if (settleMatch && method === 'POST') {
      if (!validKey(body.request_key) || !METHODS.includes(body.method)) fail(400, 'Forma de pagamento inválida.');
      const accountId = settleMatch[1];
      const aRef = doc(db, 'businesses', businessId, 'accounts', accountId);
      const idemId = idemDocId('fin_settle', body.request_key);
      const idemRef = doc(db, 'businesses', businessId, 'idempotency', idemId);
      const isCash = body.method === 'cash';
      if (isCash && (typeof body.session_id !== 'string' || !body.session_id)) {
        fail(409, 'Abra ou atualize o caixa para movimentar dinheiro da gaveta.');
      }
      const csRef = isCash ? doc(db, 'businesses', businessId, 'cashSessions', body.session_id) : null;
      const lockRef = isCash ? cashLockDocRef(businessId) : null;
      const fingerprint = await digestInput({ account_id: accountId, method: body.method, session_id: body.session_id || null });

      let legacyTotals = null;
      if (csRef) {
        const preCs = await getDoc(csRef).catch(() => null);
        if (preCs && preCs.exists() && typeof preCs.data().cashBalanceCents !== 'number') {
          const sessLed = await getDocs(query(collection(db, 'businesses', businessId, 'ledger'), where('sessionId', '==', body.session_id)));
          legacyTotals = { cash: preCs.data().openingCents, pix: 0, credit: 0, debit: 0, card: 0 };
          sessLed.docs.forEach((d) => {
            const l = d.data();
            if (REGISTER_METHODS.includes(l.method)) legacyTotals[l.method] = (legacyTotals[l.method] || 0) + l.amountCents;
          });
        }
      }

      const lid = crypto.randomUUID();
      await runTransaction(db, async (tx) => {
        const [idemSnap, aSnap, csSnap, lockSnap] = await Promise.all([
          tx.get(idemRef),
          tx.get(aRef),
          csRef ? tx.get(csRef) : Promise.resolve(null),
          lockRef ? tx.get(lockRef) : Promise.resolve(null)
        ]);
        if (idemSnap.exists()) {
          if (idemSnap.data().fingerprint && idemSnap.data().fingerprint !== fingerprint) {
            fail(409, 'Identificador já usado em outra baixa.');
          }
          return;
        }
        if (!aSnap.exists()) fail(404, 'Conta não encontrada.');
        const a = aSnap.data();
        if (a.state === 'settled') return;
        const amount = a.kind === 'payable' ? -a.amountCents : a.amountCents;

        let totals = null;
        let csData = null;
        if (isCash) {
          if (
            !csSnap ||
            !csSnap.exists() ||
            csSnap.data().state !== 'open' ||
            (lockSnap && lockSnap.exists() && (!lockSnap.data().active || lockSnap.data().resourceId !== body.session_id))
          ) {
            fail(409, 'Abra ou atualize o caixa para movimentar dinheiro da gaveta.');
          }
          csData = csSnap.data();
          totals = nextSessionTotals(csData, 'cash', amount, legacyTotals);
        }

        tx.set(doc(db, 'businesses', businessId, 'ledger', lid), {
          id: lid,
          requestKey: body.request_key,
          sessionId: csData?.id || null,
          accountId: a.id,
          kind: a.kind,
          method: body.method,
          amountCents: amount,
          description: a.title,
          category: a.category || 'Não classificado',
          financeAccount: isCash ? 'drawer' : 'bank',
          actorId: user.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        tx.update(aRef, {
          state: 'settled',
          settledAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        if (isCash && csRef && totals) {
          tx.update(csRef, {
            ...totals,
            version: (csData.version || 1) + 1,
            updatedAt: serverTimestamp()
          });
        }
        if (['weekly', 'monthly'].includes(a.recurrence)) {
          const [year, month, day] = a.dueDate.split('-').map(Number);
          const nextDate =
            a.recurrence === 'weekly'
              ? new Date(Date.UTC(year, month - 1, day + 7))
              : new Date(Date.UTC(year, month, Math.min(day, new Date(Date.UTC(year, month + 1, 0)).getUTCDate())));
          const nextId = crypto.randomUUID();
          tx.set(doc(db, 'businesses', businessId, 'accounts', nextId), {
            id: nextId,
            requestKey: 'recurring:' + a.id,
            kind: a.kind,
            title: a.title,
            amountCents: a.amountCents,
            dueDate: nextDate.toISOString().slice(0, 10),
            state: 'pending',
            category: a.category || 'Não classificado',
            recurrence: a.recurrence,
            recurrenceParentId: a.id,
            actorId: user.id,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        }
        tx.set(idemRef, {
          key: idemId,
          kind: 'fin_settle',
          fingerprint,
          targetId: lid,
          actorId: user.id,
          result: { ok: true },
          createdAt: serverTimestamp()
        });
      }).catch((err) => {
        if (err instanceof HttpError) throw err;
        handleFirestoreError(err, OperationType.WRITE, aRef.path);
      });
      return json({ ok: true });
    }

    // /api/erp/*
    if (path.startsWith('/api/erp/')) {
      requireManager(user);

      if (path === '/api/erp/reports' && method === 'GET') {
        return json(await managementReport(businessId, periodRange(url.searchParams)));
      }
      if (path === '/api/erp/dashboard' && method === 'GET') {
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
        return json(await managementReport(businessId, periodRange(new URLSearchParams({ from: today, to: today }))));
      }

      if (path === '/api/erp/suppliers') {
        if (method === 'GET') {
          const snap = await getDocs(collection(db, 'businesses', businessId, 'suppliers')).catch((err) =>
            handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/suppliers`)
          );
          const suppliers = snap.docs
            .map((d) => d.data())
            .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'pt-BR'));
          return json({ suppliers });
        }
        if (method === 'POST') {
          const name = clean(body.name, 100);
          if (!name) fail(400, 'Informe o nome do fornecedor.');
          const id = crypto.randomUUID();
          await setDoc(doc(db, 'businesses', businessId, 'suppliers', id), {
            id,
            name,
            phone: clean(body.phone, 30),
            document: clean(body.document, 30),
            notes: clean(body.notes, 500),
            active: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          }).catch((err) => handleFirestoreError(err, OperationType.WRITE, `businesses/${businessId}/suppliers/${id}`));
          return json({ ok: true, id }, 201);
        }
      }

      const supMatch = path.match(/^\/api\/erp\/suppliers\/([^/]+)$/);
      if (supMatch && method === 'PUT') {
        const name = clean(body.name, 100);
        if (!name || typeof body.active !== 'boolean') fail(400, 'Fornecedor inválido.');
        const sRef = doc(db, 'businesses', businessId, 'suppliers', supMatch[1]);
        const snap = await getDoc(sRef).catch((err) => handleFirestoreError(err, OperationType.GET, sRef.path));
        if (!snap.exists()) fail(404, 'Fornecedor não encontrado.');
        await updateDoc(sRef, {
          name,
          phone: clean(body.phone, 30),
          document: clean(body.document, 30),
          notes: clean(body.notes, 500),
          active: body.active,
          updatedAt: serverTimestamp()
        }).catch((err) => handleFirestoreError(err, OperationType.UPDATE, sRef.path));
        return json({ ok: true });
      }

      if (path === '/api/erp/inventory') {
        if (method === 'GET') {
          const [invSnap, stockSnap, movesSnap] = await Promise.all([
            getDocs(collection(db, 'businesses', businessId, 'inventoryItems')),
            getDocs(collection(db, 'businesses', businessId, 'inventoryStock')),
            getDocs(query(collection(db, 'businesses', businessId, 'inventoryMoves'), orderBy('createdAt', 'desc'), limit(300)))
          ]).catch((err) => handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/inventoryItems`));
          const stockMap = new Map(stockSnap.docs.map((d) => [d.id, d.data().balanceMilli || 0]));
          const invMap = new Map(invSnap.docs.map((d) => [d.id, d.data()]));
          const items = invSnap.docs
            .map((d) => {
              const it = d.data();
              return {
                id: it.id,
                name: it.name,
                unit: it.unit,
                minimum_milli: it.minimumMilli,
                unit_cost_micro: it.unitCostMicro ?? null,
                active: !!it.active,
                stock_milli: stockMap.get(it.id) || 0,
                created_at: tsToIso(it.createdAt)
              };
            })
            .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'pt-BR'));
          const movements = movesSnap.docs.map((d) => {
            const m = d.data();
            const inv = invMap.get(m.itemId);
            return {
              id: m.id,
              item_id: m.itemId,
              name: inv?.name || 'Item',
              unit: inv?.unit || 'un',
              quantity_milli: m.quantityMilli,
              kind: m.kind,
              reason: m.reason,
              created_at: tsToIso(m.createdAt)
            };
          });
          return json({ items, movements });
        }
        if (method === 'POST') {
          const name = clean(body.name, 100);
          if (
            !name ||
            !['g', 'ml', 'un'].includes(body.unit) ||
            !num(body.minimum_milli, 0, 1e12) ||
            !(body.unit_cost_micro === null || num(body.unit_cost_micro, 0, 1e12))
          ) {
            fail(400, 'Confira nome, unidade, custo e estoque mínimo.');
          }
          const id = crypto.randomUUID();
          const batch = writeBatch(db);
          batch.set(doc(db, 'businesses', businessId, 'inventoryItems', id), {
            id,
            name,
            unit: body.unit,
            minimumMilli: body.minimum_milli,
            unitCostMicro: body.unit_cost_micro,
            active: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
          batch.set(doc(db, 'businesses', businessId, 'inventoryStock', id), {
            itemId: id,
            balanceMilli: 0,
            updatedAt: serverTimestamp()
          });
          await batch.commit().catch((err) => handleFirestoreError(err, OperationType.WRITE, `businesses/${businessId}/inventoryItems/${id}`));
          return json({ ok: true, id }, 201);
        }
      }

      const invEditMatch = path.match(/^\/api\/erp\/inventory\/([^/]+)$/);
      if (invEditMatch && method === 'PUT') {
        const name = clean(body.name, 100);
        if (!name || !num(body.minimum_milli, 0, 1e12) || !(body.unit_cost_micro === null || num(body.unit_cost_micro, 0, 1e12))) {
          fail(400, 'Confira nome, custo e estoque mínimo.');
        }
        const iRef = doc(db, 'businesses', businessId, 'inventoryItems', invEditMatch[1]);
        const snap = await getDoc(iRef).catch((err) => handleFirestoreError(err, OperationType.GET, iRef.path));
        if (!snap.exists()) fail(404, 'Insumo não encontrado.');
        await updateDoc(iRef, {
          name,
          minimumMilli: body.minimum_milli,
          unitCostMicro: body.unit_cost_micro,
          updatedAt: serverTimestamp()
        }).catch((err) => handleFirestoreError(err, OperationType.UPDATE, iRef.path));
        return json({ ok: true });
      }

      const invMoveMatch = path.match(/^\/api\/erp\/inventory\/([^/]+)\/movement$/);
      if (invMoveMatch && method === 'POST') {
        if (
          !validKey(body.request_key) ||
          !['entry', 'loss', 'count'].includes(body.kind) ||
          !num(body.quantity_milli, 0, 1e12) ||
          !clean(body.reason, 200)
        ) {
          fail(400, 'Confira quantidade e motivo.');
        }
        const itemId = invMoveMatch[1];
        const idemId = idemDocId('inv_mov', body.request_key);
        const idemRef = doc(db, 'businesses', businessId, 'idempotency', idemId);
        const iRef = doc(db, 'businesses', businessId, 'inventoryItems', itemId);
        const sRef = doc(db, 'businesses', businessId, 'inventoryStock', itemId);
        const fingerprint = await digestInput({ item_id: itemId, kind: body.kind, quantity_milli: body.quantity_milli });
        const moveId = crypto.randomUUID();
        let responsePayload = null;
        let status = 201;

        await runTransaction(db, async (tx) => {
          const [idemSnap, iSnap, sSnap] = await Promise.all([tx.get(idemRef), tx.get(iRef), tx.get(sRef)]);
          if (idemSnap.exists()) {
            const prior = idemSnap.data();
            if (prior.fingerprint && prior.fingerprint !== fingerprint) fail(409, 'Identificador já usado em outro movimento.');
            responsePayload = prior.result || { ok: true, id: prior.targetId };
            status = 200;
            return;
          }
          if (!iSnap.exists()) fail(404, 'Insumo não encontrado.');
          const currentBal = sSnap.exists() ? sSnap.data().balanceMilli || 0 : 0;
          const qty =
            body.kind === 'loss' ? -body.quantity_milli : body.kind === 'count' ? body.quantity_milli - currentBal : body.quantity_milli;
          if (!qty) {
            responsePayload = { ok: true, unchanged: true };
            status = 200;
            return;
          }
          if (currentBal + qty < 0) fail(409, 'Saldo em estoque insuficiente para esta perda/saída.');

          tx.set(sRef, { itemId, balanceMilli: currentBal + qty, updatedAt: serverTimestamp() });
          tx.set(doc(db, 'businesses', businessId, 'inventoryMoves', moveId), {
            id: moveId,
            requestKey: body.request_key,
            itemId,
            quantityMilli: qty,
            kind: body.kind,
            reason: clean(body.reason, 200),
            actorId: user.id,
            createdAt: serverTimestamp()
          });
          responsePayload = { ok: true, id: moveId };
          tx.set(idemRef, {
            key: idemId,
            kind: 'inv_movement',
            fingerprint,
            targetId: moveId,
            actorId: user.id,
            result: responsePayload,
            createdAt: serverTimestamp()
          });
        }).catch((err) => {
          if (err instanceof HttpError) throw err;
          handleFirestoreError(err, OperationType.WRITE, `businesses/${businessId}/inventoryMoves/${moveId}`);
        });
        return json(responsePayload, status);
      }

      const recipeMatch = path.match(/^\/api\/erp\/recipes\/([^/]+)$/);
      if (recipeMatch) {
        const prodId = recipeMatch[1];
        const pRef = doc(db, 'businesses', businessId, 'products', prodId);
        const pSnap = await getDoc(pRef).catch((err) => handleFirestoreError(err, OperationType.GET, pRef.path));
        if (!pSnap.exists()) fail(404, 'Produto não encontrado.');
        const p = pSnap.data();
        if (p.stockMode === 'unit') fail(409, 'Produto pronto usa estoque por unidade. Use Estoque de produtos.');
        if (method === 'GET') {
          const [recSnap, invSnap] = await Promise.all([
            getDoc(doc(db, 'businesses', businessId, 'recipes', prodId)),
            getDocs(collection(db, 'businesses', businessId, 'inventoryItems'))
          ]);
          const invMap = new Map(invSnap.docs.map((d) => [d.id, d.data()]));
          const items = (recSnap.exists() ? recSnap.data().items || [] : []).map((r) => {
            const inv = invMap.get(r.itemId);
            return {
              item_id: r.itemId,
              quantity_milli: r.quantityMilli,
              name: inv?.name || 'Insumo',
              unit: inv?.unit || 'un',
              unit_cost_micro: inv?.unitCostMicro ?? null
            };
          });
          const [enriched] = await computeProductCosts(businessId, [p], user);
          return json({ product: productDto(enriched, enriched.effectiveCostCents), items });
        }
        if (method === 'PUT') {
          if (
            !['direct', 'recipe'].includes(body.mode) ||
            typeof body.track_stock !== 'boolean' ||
            !Array.isArray(body.items) ||
            body.items.length > 100 ||
            ((body.track_stock || body.mode === 'recipe') && !body.items.length)
          ) {
            fail(400, 'Informe a composição para ativar custo detalhado ou estoque.');
          }
          const seen = new Set();
          const normalizedItems = [];
          for (const i of body.items) {
            if (seen.has(i.item_id) || !num(i.quantity_milli, 1, 1e9)) fail(400, 'Insumo ou quantidade inválida.');
            const inv = await getDoc(doc(db, 'businesses', businessId, 'inventoryItems', i.item_id));
            if (!inv.exists() || !inv.data().active) fail(400, 'Insumo inválido.');
            seen.add(i.item_id);
            normalizedItems.push({ itemId: i.item_id, quantityMilli: i.quantity_milli });
          }
          const batch = writeBatch(db);
          batch.set(doc(db, 'businesses', businessId, 'recipes', prodId), {
            productId: prodId,
            items: normalizedItems,
            updatedAt: serverTimestamp()
          });
          batch.update(pRef, {
            costMode: body.mode,
            trackStock: body.track_stock,
            stockMode: body.track_stock ? 'recipe' : 'none',
            version: (p.version || 1) + 1,
            updatedAt: serverTimestamp()
          });
          await batch.commit().catch((err) => handleFirestoreError(err, OperationType.WRITE, pRef.path));
          return json({ ok: true });
        }
      }

      if (path === '/api/erp/purchases') {
        if (method === 'GET') {
          const snap = await getDocs(collection(db, 'businesses', businessId, 'purchases')).catch((err) =>
            handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/purchases`)
          );
          const purchases = snap.docs
            .map((d) => {
              const p = d.data();
              return {
                id: p.id,
                supplier_id: p.supplierId || null,
                supplier_name: p.supplierName || '',
                items: p.items || [],
                total_cents: p.totalCents,
                due_date: p.dueDate,
                state: p.state,
                created_at: tsToIso(p.createdAt),
                received_at: tsToIso(p.receivedAt)
              };
            })
            .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
            .slice(0, 300);
          return json({ purchases });
        }
        if (method === 'POST') {
          if (
            !validKey(body.request_key) ||
            !Array.isArray(body.items) ||
            !body.items.length ||
            body.items.length > 100 ||
            !/^\d{4}-\d{2}-\d{2}$/.test(body.due_date || '')
          ) {
            fail(400, 'Confira itens e vencimento.');
          }
          const dup = await getDocs(
            query(collection(db, 'businesses', businessId, 'purchases'), where('requestKey', '==', body.request_key), limit(1))
          );
          if (!dup.empty) return json({ ok: true, id: dup.docs[0].id });
          let supplierName = '';
          if (body.supplier_id) {
            const sSnap = await getDoc(doc(db, 'businesses', businessId, 'suppliers', body.supplier_id));
            if (!sSnap.exists()) fail(400, 'Fornecedor inválido.');
            supplierName = sSnap.data().name;
          }
          let total = 0;
          const items = [];
          const seen = new Set();
          for (const i of body.items) {
            if (!num(i.quantity_milli, 1, 1e12) || !num(i.total_cents, 0, 1e8) || seen.has(i.item_id)) {
              fail(400, 'Confira quantidade, valor e itens repetidos.');
            }
            const invSnap = await getDoc(doc(db, 'businesses', businessId, 'inventoryItems', i.item_id));
            if (!invSnap.exists() || !invSnap.data().active) fail(400, 'Insumo inválido.');
            seen.add(i.item_id);
            items.push({ ...i, name: invSnap.data().name, unit: invSnap.data().unit });
            total += i.total_cents;
          }
          if (total > 1e8) fail(400, 'Total fora do limite.');
          const id = crypto.randomUUID();
          await setDoc(doc(db, 'businesses', businessId, 'purchases', id), {
            id,
            requestKey: body.request_key,
            supplierId: body.supplier_id || null,
            supplierName,
            items,
            totalCents: total,
            dueDate: body.due_date,
            state: 'draft',
            actorId: user.id,
            createdAt: serverTimestamp()
          }).catch((err) => handleFirestoreError(err, OperationType.WRITE, `businesses/${businessId}/purchases/${id}`));
          return json({ ok: true, id }, 201);
        }
      }

      const receiveMatch = path.match(/^\/api\/erp\/purchases\/([^/]+)\/receive$/);
      if (receiveMatch && method === 'POST') {
        const pRef = doc(db, 'businesses', businessId, 'purchases', receiveMatch[1]);
        await runTransaction(db, async (tx) => {
          const pSnap = await tx.get(pRef);
          if (!pSnap.exists()) fail(404, 'Compra não encontrada.');
          const p = pSnap.data();
          if (p.state === 'received') return;
          const itemReads = [];
          for (const i of p.items || []) {
            const iRef = doc(db, 'businesses', businessId, 'inventoryItems', i.item_id);
            const sRef = doc(db, 'businesses', businessId, 'inventoryStock', i.item_id);
            const [iSnap, sSnap] = await Promise.all([tx.get(iRef), tx.get(sRef)]);
            itemReads.push({ i, iRef, sRef, iData: iSnap.data(), sData: sSnap.exists() ? sSnap.data() : null });
          }

          tx.update(pRef, { state: 'received', receivedAt: serverTimestamp() });
          for (const r of itemReads) {
            const prevBal = r.sData?.balanceMilli || 0;
            const prevMicro = r.iData?.unitCostMicro;
            const nextMicro =
              prevMicro == null && prevBal > 0
                ? null
                : Math.round((Number(prevMicro || 0) * prevBal + r.i.total_cents * 1e9) / (prevBal + r.i.quantity_milli));
            tx.update(r.iRef, { unitCostMicro: nextMicro, updatedAt: serverTimestamp() });
            tx.set(r.sRef, { itemId: r.i.item_id, balanceMilli: prevBal + r.i.quantity_milli, updatedAt: serverTimestamp() });
            const mid = crypto.randomUUID();
            tx.set(doc(db, 'businesses', businessId, 'inventoryMoves', mid), {
              id: mid,
              requestKey: 'purchase:' + p.id + ':' + r.i.item_id,
              itemId: r.i.item_id,
              quantityMilli: r.i.quantity_milli,
              kind: 'purchase',
              sourceId: p.id,
              reason: 'Recebimento de compra',
              actorId: user.id,
              createdAt: serverTimestamp()
            });
          }
          if (p.totalCents > 0 && contractMods.finance) {
            const aid = crypto.randomUUID();
            tx.set(doc(db, 'businesses', businessId, 'accounts', aid), {
              id: aid,
              requestKey: 'purchase:' + p.id,
              kind: 'payable',
              title: 'Compra de mercadorias ' + p.id.slice(0, 8),
              amountCents: p.totalCents,
              dueDate: p.dueDate,
              state: 'pending',
              category: 'Mercadorias',
              actorId: user.id,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            });
          }
        }).catch((err) => {
          if (err instanceof HttpError) throw err;
          handleFirestoreError(err, OperationType.WRITE, pRef.path);
        });
        return json({ ok: true });
      }

      if (path === '/api/erp/reconcile' && method === 'POST') {
        if (!clean(body.reference, 120) || typeof body.id !== 'string') fail(400, 'Informe a referência do extrato.');
        const lRef = doc(db, 'businesses', businessId, 'ledger', body.id);
        await updateDoc(lRef, {
          reconciledAt: serverTimestamp(),
          externalReference: clean(body.reference, 120),
          reconciledBy: user.id,
          updatedAt: serverTimestamp()
        }).catch((err) => handleFirestoreError(err, OperationType.UPDATE, lRef.path));
        return json({ ok: true });
      }

      if (path === '/api/erp/financial' && method === 'GET') {
        const finRes = await handleApiRequest(new URL('/api/finance', location.origin), { method: 'GET' });
        const fin = await finRes.json();
        return json({
          accounts: fin.accounts,
          ledger: fin.ledger,
          settings: settingsDto(currentSettings, account.business),
          categories: FINANCE_CATEGORIES
        });
      }

      const classifyMatch = path.match(/^\/api\/erp\/ledger\/([^/]+)$/);
      if (classifyMatch && method === 'PUT') {
        if (!clean(body.category, 80)) fail(400, 'Informe a categoria.');
        const lRef = doc(db, 'businesses', businessId, 'ledger', classifyMatch[1]);
        await updateDoc(lRef, {
          category: clean(body.category, 80),
          updatedAt: serverTimestamp()
        }).catch((err) => handleFirestoreError(err, OperationType.UPDATE, lRef.path));
        return json({ ok: true });
      }
    }

    fail(404, 'Operação não disponível.');
  }

  window.IDFirebaseApi = {
    async fetch(input, options = {}) {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      try {
        const response = await handleApiRequest(url, options);
        const user = window.ERP_ACCOUNT?.user;
        if (user && response.headers.get('Content-Type')?.includes('application/json') && !hasPermission(user, 'products.costs')) {
          const payload = await response.json();
          return json(redactPrivateFields(user, payload), response.status);
        }
        return response;
      } catch (err) {
        if (err instanceof HttpError) {
          return json({ error: err.message }, err.status);
        }
        return json({ error: formatErrMessage(err) }, inferErrStatus(err));
      }
    }
  };
})();
