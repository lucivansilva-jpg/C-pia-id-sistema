const fb = window.IDFirebase;
const {
  auth,
  db,
  OperationType,
  handleFirestoreError,
  tsToIso,
  normalizeBusinessIdentifier,
  staffAuthEmail,
  friendlyAuthError,
  provisionAuthAccount,
  isPlatformToken,
  resolveBusinessAccess,
  fetchCurrentAccount,
  PERMISSION_INFO,
  PERMISSIONS,
  ROLE_BASE,
  DEFAULT_PROFILES,
  effectivePermissions,
  permissionOverrides,
  sdk: {
    GoogleAuthProvider,
    signInWithPopup,
    signInWithEmailAndPassword,
    updatePassword,
    signOut,
    onAuthStateChanged,
    doc,
    collection,
    collectionGroup,
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

const $ = (s) => document.querySelector(s);
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));

let current = null;
let people = [];
let catalog = [];
let editing = null;
let supportId = sessionStorage.getItem('support_session') || null;
let businessList = [];
let supportBusiness = null;

function formatUiError(err) {
  const msg = err?.message || 'Não foi possível concluir.';
  if (msg.startsWith('{') && msg.includes('"operationType"')) {
    try {
      const parsed = JSON.parse(msg);
      if (String(parsed.error || '').includes('Quota exceeded')) {
        return 'Cota gratuita diária do banco atingida. Aguarde a renovação diária ou consulte o painel do Firebase.';
      }
      if (String(parsed.error || '').includes('Missing or insufficient permissions')) {
        return 'Permissão insuficiente no Firebase para esta operação.';
      }
      return parsed.error || 'Erro ao acessar o banco.';
    } catch {
      return msg;
    }
  }
  return msg;
}

function message(s) {
  $('#message').textContent = s;
}

function generateBusinessCode() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let suffix = '';
  for (const b of bytes) suffix += chars[b % chars.length];
  return 'loja-' + suffix;
}

function parseBody(options) {
  if (!options?.body) return {};
  return typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
}

async function firestoreRequest(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const body = parseBody(options);

  if (path === '/me' && method === 'GET') {
    return await fetchCurrentAccount(supportId);
  }

  if (!auth.currentUser) {
    throw new Error('Entre para continuar.');
  }

  if (path === '/password' && method === 'POST') {
    const newPassword = String(body.password || '');
    if (newPassword.length < 8 || newPassword.length > 128) {
      throw new Error('A nova senha deve ter entre 8 e 128 caracteres.');
    }
    try {
      await updatePassword(auth.currentUser, newPassword);
    } catch (err) {
      throw new Error(friendlyAuthError(err));
    }
    if (current?.business?.id) {
      const memberPath = `businesses/${current.business.id}/members/${auth.currentUser.uid}`;
      await updateDoc(doc(db, 'businesses', current.business.id, 'members', auth.currentUser.uid), {
        mustChangePassword: false,
        updatedAt: serverTimestamp()
      }).catch((err) => handleFirestoreError(err, OperationType.UPDATE, memberPath));
    }
    return { ok: true };
  }

  if (path === '/members' && method === 'GET') {
    if (!current?.business?.id) throw new Error('Estabelecimento não identificado.');
    const businessId = current.business.id;
    const membersPath = `businesses/${businessId}/members`;
    const snap = await getDocs(collection(db, 'businesses', businessId, 'members')).catch((err) =>
      handleFirestoreError(err, OperationType.LIST, membersPath)
    );
    const members = snap.docs
      .map((d) => d.data())
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'))
      .map((m) => ({
        user_id: m.uid,
        display_name: m.name,
        username: m.username,
        role: m.role,
        permissions: m.permissions || {},
        active: !!m.active,
        version: m.version || 1,
        is_owner: !!m.isOwner
      }));
    return { members };
  }

  if (path === '/members' && method === 'POST') {
    if (!current?.business?.id) throw new Error('Estabelecimento não identificado.');
    if (current.support && !current.support.write_enabled) {
      throw new Error('Habilite alterações no atendimento antes de cadastrar.');
    }
    const businessId = current.business.id;
    const businessCode = current.business.code;
    const name = String(body.name || '').trim().slice(0, 100);
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const role = body.role;
    const isRetail = current.business?.business_kind === 'retail';
    if (!name || !/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username) || !Object.hasOwn(ROLE_BASE, role)) {
      throw new Error('Informe nome, usuário válido e perfil.');
    }
    if (isRetail && role === 'waiter') {
      throw new Error('O perfil Garçom não está disponível na modalidade Varejo.');
    }
    if (password.length < 8 || password.length > 128) {
      throw new Error('A senha temporária deve ter de 8 a 128 caracteres.');
    }
    const existingSnap = await getDocs(
      query(collection(db, 'businesses', businessId, 'members'), where('username', '==', username), limit(1))
    ).catch((err) => handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/members`));
    if (!existingSnap.empty) {
      throw new Error('Este nome de usuário já está em uso neste estabelecimento.');
    }
    const perms = permissionOverrides(body.permissions || {}, role);
    const email = staffAuthEmail(username, businessCode);
    await fb.checkMemberCapacity(businessId);
    const newUid = await provisionAuthAccount(email, password);

    const auditId = crypto.randomUUID();
    const cleanBatch = fb.memberBatch(businessId, newUid, {email,password});
    cleanBatch.set(doc(db, 'userBusinesses', newUid), {
      uid: newUid,
      businessId,
      username,
      role,
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    cleanBatch.set(doc(db, 'businesses', businessId, 'members', newUid), {
      uid: newUid,
      businessId,
      name,
      username,
      role,
      permissions: perms,
      active: true,
      mustChangePassword: true,
      isOwner: false,
      version: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    cleanBatch.set(doc(db, 'businesses', businessId, 'auditLogs', auditId), {
      id: auditId,
      actorId: auth.currentUser.uid,
      action: 'member.create',
      entityId: newUid,
      details: { username, role },
      createdAt: serverTimestamp()
    });
    await cleanBatch.commit().catch((err) =>
      handleFirestoreError(err, OperationType.WRITE, `businesses/${businessId}/members/${newUid}`)
    );
    return { ok: true, id: newUid };
  }

  const memberMatch = path.match(/^\/members\/([^/]+)$/);
  if (memberMatch && method === 'PATCH') {
    if (!current?.business?.id) throw new Error('Estabelecimento não identificado.');
    if (current.support && !current.support.write_enabled) {
      throw new Error('Habilite alterações no atendimento antes de editar.');
    }
    const businessId = current.business.id;
    const uid = memberMatch[1];
    const memberRef = doc(db, 'businesses', businessId, 'members', uid);
    const snap = await getDoc(memberRef).catch((err) =>
      handleFirestoreError(err, OperationType.GET, memberRef.path)
    );
    if (!snap.exists()) throw new Error('Funcionário não encontrado.');
    const old = snap.data();
    if (old.isOwner && uid !== auth.currentUser.uid && !current.platform) {
      throw new Error('O acesso do proprietário principal não pode ser alterado aqui.');
    }
    if (body.version && old.version !== body.version) {
      throw new Error('O cadastro foi alterado. Atualize a página antes de salvar.');
    }
    const name = String(body.name || '').trim().slice(0, 100);
    const role = body.role;
    const active = typeof body.active === 'boolean' ? body.active : old.active;
    const isRetail = current.business?.business_kind === 'retail';
    if (!name || !Object.hasOwn(ROLE_BASE, role)) {
      throw new Error('Informe nome e perfil válidos.');
    }
    if (isRetail && role === 'waiter' && !(old.role === 'waiter' && active === false)) {
      throw new Error('O perfil Garçom não está disponível na modalidade Varejo.');
    }
    const perms = permissionOverrides(body.permissions || {}, role);
    const auditId = crypto.randomUUID();
    const batch = fb.memberBatch(businessId, uid);
    batch.update(memberRef, {
      name,
      role,
      permissions: perms,
      active,
      version: (old.version || 1) + 1,
      updatedAt: serverTimestamp()
    });
    batch.update(doc(db, 'userBusinesses', uid), {
      role,
      active,
      updatedAt: serverTimestamp()
    });
    batch.set(doc(db, 'businesses', businessId, 'auditLogs', auditId), {
      id: auditId,
      actorId: auth.currentUser.uid,
      action: 'member.update',
      entityId: uid,
      details: { role, active },
      createdAt: serverTimestamp()
    });
    await batch.commit().catch((err) => handleFirestoreError(err, OperationType.UPDATE, memberRef.path));
    return { ok: true };
  }

  const contractMatch=path.match(/^\/platform\/businesses\/([^/]+)\/contract$/);
  if(contractMatch && method==='PUT'){
    if(!current?.platform || !isPlatformToken(auth.currentUser))throw Error('Somente o administrador da plataforma pode alterar o contrato.');
    const id=contractMatch[1], sr=doc(db,'businesses',id,'settings','main');
    const kind=String(body.business_kind||'');
    if(!['food','retail'].includes(kind))throw Error('Modalidade inválida.');
    const mods=IDContract.normalize(body.modules,kind), userLimit=IDContract.limit(body.user_limit);
    // Existing tenants need an explicit isolated migration, never an automatic production scan/write.
    const existingContract=await getDoc(sr);
    const previousModules=IDContract.modules(existingContract.data()||{});
    const reducing=Object.keys(mods).some(k=>previousModules[k]&&!mods[k]) || existingContract.data()?.businessKind!==kind;
    if(reducing){
      const [sessions,orders,members,products,accounts]=await Promise.all(['cashSessions','orders','members','products','accounts'].map(c=>getDocs(collection(db,'businesses',id,c))));
      if(sessions.docs.some(d=>d.data().state==='open'))throw Error('Feche o caixa antes de reduzir módulos ou mudar a modalidade.');
      if(orders.docs.some(d=>d.data().state==='open'||d.data().fulfillment==='pending'))throw Error('Conclua as comandas e entregas pendentes antes de reduzir módulos.');
      if(!mods.tables&&members.docs.some(d=>d.data().active&&d.data().role==='waiter'))throw Error('Altere o perfil ou desative os garçons antes de retirar Mesas e atendimento.');
      if(!mods.inventory&&products.docs.some(d=>d.data().active&&d.data().stockMode!=='none'))throw Error('Desative o controle de estoque dos produtos antes de retirar Estoque e compras.');
      if(!mods.finance&&accounts.docs.some(d=>d.data().state==='pending'))throw Error('Resolva as contas financeiras pendentes antes de retirar o Financeiro.');
    }
    const auditId=crypto.randomUUID();
    await runTransaction(db,async tx=>{
      const snap=await tx.get(sr);if(!snap.exists())throw Error('Configure o estabelecimento antes do contrato.');
      const previous=snap.data();
      if(previous.activeUserCount==null)throw Error('Cadastro legado: execute primeiro a migração explícita de contagem em ambiente isolado. Nenhum acesso foi alterado.');
      if(userLimit<previous.activeUserCount)throw Error('Desative usuários antes de reduzir o limite. Ativos: '+previous.activeUserCount);
      if(previous.businessKind!==existingContract.data().businessKind || JSON.stringify(previous.modules)!==JSON.stringify(existingContract.data().modules))throw Error('O contrato foi alterado. Atualize a tela antes de salvar.');
      tx.update(sr,{modules:mods,userLimit,businessKind:kind,updatedAt:serverTimestamp()});
      tx.set(doc(db,'businesses',id,'auditLogs',auditId),{id:auditId,actorId:auth.currentUser.uid,action:'business.contract.update',entityId:id,details:{previous:{modules:previous.modules??null,userLimit:previous.userLimit??null},modules:mods,userLimit},createdAt:serverTimestamp()});
    });return {ok:true};
  }

  if (path === '/business-access' || /^\/platform\/businesses\/[^/]+$/.test(path)) {
    const isPlatformBizRoute = /^\/platform\/businesses\/[^/]+$/.test(path);
    const id = path === '/business-access' ? current?.business?.id : path.split('/').pop();
    if (!id) throw new Error('Estabelecimento não encontrado.');
    const bizRef = doc(db, 'businesses', id);
    const settingsRef = doc(db, 'businesses', id, 'settings', 'main');

    if (method === 'GET') {
      const [bizSnap, membersSnap, productsSnap, ordersSnap, settingsSnap] = await Promise.all([
        getDoc(bizRef),
        current.platform ? getDocs(collection(db, 'businesses', id, 'members')) : Promise.resolve({ size: 0 }),
        current.platform ? getDocs(collection(db, 'businesses', id, 'products')) : Promise.resolve({ size: 0 }),
        current.platform ? getDocs(collection(db, 'businesses', id, 'orders')) : Promise.resolve({ size: 0 }),
        current.platform && isPlatformBizRoute ? getDoc(settingsRef).catch(() => null) : Promise.resolve(null)
      ]).catch((err) => handleFirestoreError(err, OperationType.GET, bizRef.path));
      if (!bizSnap.exists() || bizSnap.data().deleted) {
        throw new Error('Estabelecimento não encontrado.');
      }
      const b = bizSnap.data();
      const rawKind = settingsSnap?.exists() ? settingsSnap.data()?.businessKind : null;
      const businessKind = rawKind === 'food' || rawKind === 'retail' ? rawKind : null;
      const movementsCount = ordersSnap.size || 0;
      const canDelete = (productsSnap.size || 0) === 0 && movementsCount === 0;
      return {
        business: {
          id: b.id,
          name: b.name,
          code: b.code,
          access_alias: b.accessAlias || '',
          active: !!b.active,
          business_kind: businessKind,
          kind_pending: current.platform && isPlatformBizRoute ? !businessKind : false,
          modules: settingsSnap?.data()?.modules ?? null,
          user_limit: settingsSnap?.data()?.userLimit ?? null,
          active_user_count: membersSnap.docs?.filter(d=>d.data().active).length || 0,
          contract_ready: settingsSnap?.data()?.activeUserCount != null,
          users: membersSnap.size || 0,
          products: productsSnap.size || 0,
          movements: movementsCount,
          can_delete: canDelete
        }
      };
    }

    if (method === 'PUT') {
      if (path === '/business-access' && ['business_kind','modules','user_limit','userLimit','activeUserCount'].some(k=>Object.hasOwn(body,k))) {
        throw new Error('Somente o administrador da plataforma pode definir a modalidade do sistema.');
      }
      const bizSnap = await getDoc(bizRef).catch((err) =>
        handleFirestoreError(err, OperationType.GET, bizRef.path)
      );
      if (!bizSnap.exists() || bizSnap.data().deleted) throw new Error('Estabelecimento não encontrado.');
      const old = bizSnap.data();
      const name = String(body.name || '').trim().slice(0, 100);
      if (!name) throw new Error('Informe o nome da empresa.');
      const rawAlias = String(body.access_alias || '').trim();
      const newAlias = rawAlias ? normalizeBusinessIdentifier(rawAlias) : '';
      if (rawAlias && (!newAlias || newAlias.length < 3)) {
        throw new Error('Identificação inválida. Use letras, números, hífen ou CNPJ válido.');
      }
      let nextKind = null;
      let currentSettingsSnap = null;
      if (isPlatformBizRoute && current.platform && body.business_kind !== undefined) {
        nextKind = String(body.business_kind || '').trim();
        if (!['food', 'retail'].includes(nextKind)) {
          throw new Error('Selecione a modalidade do sistema (Alimentação ou Varejo).');
        }
        currentSettingsSnap = await getDoc(settingsRef).catch(() => null);
      }
      if(nextKind && currentSettingsSnap?.data()?.modules && currentSettingsSnap.data().businessKind!==nextKind)throw Error('Altere a modalidade pelo contrato, após conferir dependências.');
      const nextActive = current.platform && typeof body.active === 'boolean' ? body.active : old.active;

      if (newAlias && newAlias !== old.code) {
        const existingAlias = await getDoc(doc(db, 'businessAccess', newAlias)).catch((err) =>
          handleFirestoreError(err, OperationType.GET, 'businessAccess/' + newAlias)
        );
        if (existingAlias.exists() && existingAlias.data().businessId !== id) {
          throw new Error('Esta identificação já está em uso por outro estabelecimento.');
        }
      }

      const batch = writeBatch(db);
      const bizUpdate = {
        name,
        accessAlias: newAlias || null,
        updatedAt: serverTimestamp()
      };
      if (current.platform) {
        bizUpdate.active = nextActive;
      }
      batch.update(bizRef, bizUpdate);

      if (nextKind) {
        const prevSettings = currentSettingsSnap?.exists() ? currentSettingsSnap.data() : null;
        if (prevSettings) {
          batch.set(settingsRef, {
            ...prevSettings,
            name: prevSettings.name || name,
            mode: prevSettings.mode === 'complete' ? 'complete' : 'essential',
            paper: prevSettings.paper === 58 ? 58 : 80,
            blindClose: !!prevSettings.blindClose,
            businessKind: nextKind,
            updatedAt: serverTimestamp()
          });
        } else {
          batch.set(settingsRef, {
            name,
            mode: 'essential',
            paper: 80,
            businessKind: nextKind,
            legalName: '',
            cnpj: '',
            address: '',
            phone: '',
            receiptMessage: 'Obrigado pela preferência! Volte sempre.',
            blindClose: false,
            logoKey: null,
            themeColor: '#6a330d',
            updatedAt: serverTimestamp()
          });
        }
      }

      if (old.accessAlias && old.accessAlias !== newAlias && old.accessAlias !== old.code) {
        batch.delete(doc(db, 'businessAccess', old.accessAlias));
      }
      if (newAlias && newAlias !== old.code) {
        batch.set(doc(db, 'businessAccess', newAlias), {
          identifier: newAlias,
          businessId: id,
          code: old.code,
          kind: /^\d{14}$/.test(newAlias) ? 'cnpj' : 'alias',
          active: nextActive,
          updatedAt: serverTimestamp()
        });
      }
      if (current.platform) {
        batch.update(doc(db, 'businessAccess', old.code), {
          active: nextActive,
          code: old.code,
          kind: 'code',
          updatedAt: serverTimestamp()
        });
      }
      const auditId = crypto.randomUUID();
      batch.set(doc(db, 'businesses', id, 'auditLogs', auditId), {
        id: auditId,
        actorId: auth.currentUser.uid,
        action: 'business.access.update',
        entityId: id,
        details: {
          name,
          accessAlias: newAlias || null,
          active: nextActive,
          ...(nextKind ? { businessKind: nextKind } : {})
        },
        createdAt: serverTimestamp()
      });
      await batch.commit().catch((err) => handleFirestoreError(err, OperationType.UPDATE, bizRef.path));
      return { ok: true };
    }

    if (method === 'DELETE' && current.platform) {
      const bizSnap = await getDoc(bizRef).catch((err) =>
        handleFirestoreError(err, OperationType.GET, bizRef.path)
      );
      if (!bizSnap.exists()) throw new Error('Estabelecimento não encontrado.');
      const old = bizSnap.data();
      if (body.confirmation !== old.name || body.confirmed !== true) {
        throw new Error('Confirme o nome exato do estabelecimento para remover.');
      }
      const batch = writeBatch(db);
      batch.update(bizRef, { active: false, deleted: true, updatedAt: serverTimestamp() });
      batch.update(doc(db, 'businessAccess', old.code), {
        active: false,
        code: old.code,
        kind: 'code',
        updatedAt: serverTimestamp()
      });
      if (old.accessAlias && old.accessAlias !== old.code) {
        batch.delete(doc(db, 'businessAccess', old.accessAlias));
      }
      const auditId = crypto.randomUUID();
      batch.set(doc(db, 'businesses', id, 'auditLogs', auditId), {
        id: auditId,
        actorId: auth.currentUser.uid,
        action: 'business.soft_delete',
        entityId: id,
        details: { reason: 'Removido como cadastro de teste no painel.' },
        createdAt: serverTimestamp()
      });
      await batch.commit().catch((err) => handleFirestoreError(err, OperationType.UPDATE, bizRef.path));
      return { ok: true };
    }
  }

  if (path === '/platform/businesses' && method === 'POST') {
    if (!isPlatformToken(auth.currentUser)) {
      throw new Error('Somente o administrador da plataforma pode cadastrar estabelecimentos.');
    }
    const name = String(body.name || '').trim().slice(0, 100);
    const businessKind = String(body.business_kind || '').trim();
    const contractModules = IDContract.normalize(body.modules, businessKind);
    const userLimit = IDContract.limit(body.user_limit);
    const ownerName = String(body.owner_name || '').trim().slice(0, 100);
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!['food', 'retail'].includes(businessKind)) {
      throw new Error('Selecione a modalidade do sistema (Alimentação ou Varejo).');
    }
    if (!name || !ownerName || !/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username)) {
      throw new Error('Confira nome do estabelecimento, proprietário e usuário.');
    }
    if (password.length < 8 || password.length > 128) {
      throw new Error('A senha temporária deve ter entre 8 e 128 caracteres.');
    }

    const businessId = crypto.randomUUID();
    let businessCode = generateBusinessCode();
    const existingCode = await getDoc(doc(db, 'businessAccess', businessCode)).catch(() => null);
    if (existingCode?.exists()) {
      businessCode = generateBusinessCode();
    }

    const ownerUid = await provisionAuthAccount(staffAuthEmail(username, businessCode), password);
    const batch = writeBatch(db);

    batch.set(doc(db, 'businesses', businessId), {
      id: businessId,
      name,
      code: businessCode,
      accessAlias: null,
      active: true,
      deleted: false,
      ownerUid,
      ownerName,
      openTicketCount: 0,
      unreadTicketCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    batch.set(doc(db, 'businessAccess', businessCode), {
      identifier: businessCode,
      businessId,
      code: businessCode,
      kind: 'code',
      active: true,
      updatedAt: serverTimestamp()
    });

    batch.set(doc(db, 'userBusinesses', ownerUid), {
      uid: ownerUid,
      businessId,
      username,
      role: 'admin',
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    batch.set(doc(db, 'businesses', businessId, 'members', ownerUid), {
      uid: ownerUid,
      businessId,
      name: ownerName,
      username,
      role: 'admin',
      permissions: {},
      active: true,
      mustChangePassword: true,
      isOwner: true,
      version: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    const seedRoles = businessKind === 'retail' ? ['admin', 'cashier'] : ['admin', 'cashier', 'waiter'];
    for (const role of seedRoles) {
      batch.set(doc(db, 'businesses', businessId, 'profiles', role), {
        role,
        name: DEFAULT_PROFILES[role],
        permissions: {},
        version: 1,
        updatedBy: auth.currentUser.uid,
        updatedAt: serverTimestamp()
      });
    }

    batch.set(doc(db, 'businesses', businessId, 'settings', 'main'), {
      name,
      mode: 'essential',
      paper: 80,
      businessKind,
      modules:contractModules,
      userLimit,
      activeUserCount:1,
      legalName: '',
      cnpj: '',
      address: '',
      phone: '',
      receiptMessage: 'Obrigado pela preferência! Volte sempre.',
      blindClose: false,
      logoKey: null,
      themeColor: '#6a330d',
      updatedAt: serverTimestamp()
    });

    batch.set(doc(db, 'businesses', businessId, 'publicSettings', 'menu'), {
      name,
      address: '',
      phone: '',
      logoDataUrl: null,
      themeColor: '#6a330d',
      active: true,
      updatedAt: serverTimestamp()
    });

    for (const counterName of ['orders', 'products', 'tickets']) {
      batch.set(doc(db, 'businesses', businessId, 'counters', counterName), {
        value: 0,
        updatedAt: serverTimestamp()
      });
    }

    const auditId = crypto.randomUUID();
    batch.set(doc(db, 'businesses', businessId, 'auditLogs', auditId), {
      id: auditId,
      actorId: auth.currentUser.uid,
      action: 'business.create',
      entityId: businessId,
      details: { code: businessCode, ownerUsername: username, businessKind, modules:contractModules, userLimit },
      createdAt: serverTimestamp()
    });

    await batch.commit().catch((err) =>
      handleFirestoreError(err, OperationType.WRITE, 'businesses/' + businessId)
    );

    return {
      ok: true,
      business: { id: businessId, name, code: businessCode, business_kind: businessKind }
    };
  }

  if (path === '/platform/support' && method === 'POST') {
    if (!isPlatformToken(auth.currentUser)) {
      throw new Error('Somente o administrador da plataforma pode abrir atendimentos.');
    }
    const businessId = String(body.business_id || '');
    const purpose = String(body.purpose || '').trim().slice(0, 500);
    if (!businessId || purpose.length < 5) {
      throw new Error('Informe o motivo do atendimento (mínimo 5 caracteres).');
    }
    const sessionId = crypto.randomUUID();
    const expiresAt = Timestamp.fromDate(new Date(Date.now() + 4 * 60 * 60 * 1000));
    const auditId = crypto.randomUUID();
    const batch = writeBatch(db);
    batch.set(doc(db, 'supportSessions', sessionId), {
      id: sessionId,
      businessId,
      supportUid: auth.currentUser.uid,
      purpose,
      customerRequested: !!body.customer_requested,
      writeEnabled: false,
      active: true,
      expiresAt,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    batch.set(doc(db, 'businesses', businessId, 'auditLogs', auditId), {
      id: auditId,
      actorId: auth.currentUser.uid,
      action: 'support.session.open',
      entityId: sessionId,
      details: { purpose, customer_requested: !!body.customer_requested },
      createdAt: serverTimestamp()
    });
    await batch.commit().catch((err) =>
      handleFirestoreError(err, OperationType.WRITE, 'supportSessions/' + sessionId)
    );
    return {
      ok: true,
      session: {
        id: sessionId,
        business_id: businessId,
        purpose,
        write_enabled: false,
        expires_at: expiresAt.toDate().toISOString()
      }
    };
  }

  const supportPatch = path.match(/^\/platform\/support\/([^/]+)$/);
  if (supportPatch && method === 'PATCH') {
    if (!isPlatformToken(auth.currentUser)) throw new Error('Acesso restrito ao suporte.');
    const sessionId = supportPatch[1];
    const ref = doc(db, 'supportSessions', sessionId);
    const snap = await getDoc(ref).catch((err) => handleFirestoreError(err, OperationType.GET, ref.path));
    if (!snap.exists()) return { ok: true };
    const s = snap.data();
    const batch = writeBatch(db);
    if (body.close) {
      batch.update(ref, {
        active: false,
        closedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      const auditId = crypto.randomUUID();
      batch.set(doc(db, 'businesses', s.businessId, 'auditLogs', auditId), {
        id: auditId,
        actorId: auth.currentUser.uid,
        action: 'support.session.close',
        entityId: sessionId,
        details: {},
        createdAt: serverTimestamp()
      });
    } else if (body.write_enabled === true) {
      const reason = String(body.reason || '').trim().slice(0, 500);
      if (reason.length < 3) throw new Error('Informe o motivo para habilitar alterações.');
      batch.update(ref, {
        writeEnabled: true,
        writeReason: reason,
        updatedAt: serverTimestamp()
      });
      const auditId = crypto.randomUUID();
      batch.set(doc(db, 'businesses', s.businessId, 'auditLogs', auditId), {
        id: auditId,
        actorId: auth.currentUser.uid,
        action: 'support.write.enable',
        entityId: sessionId,
        details: { reason },
        createdAt: serverTimestamp()
      });
    }
    await batch.commit().catch((err) => handleFirestoreError(err, OperationType.UPDATE, ref.path));
    return { ok: true };
  }

  const auditMatch = path.match(/^\/platform\/audit\/([^/]+)$/);
  if (auditMatch && method === 'GET') {
    if (!isPlatformToken(auth.currentUser)) throw new Error('Acesso restrito ao suporte.');
    const businessId = auditMatch[1];
    const snap = await getDocs(
      query(collection(db, 'businesses', businessId, 'auditLogs'), orderBy('createdAt', 'desc'), limit(100))
    ).catch((err) => handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/auditLogs`));
    return {
      events: snap.docs.map((d) => {
        const x = d.data();
        return {
          id: x.id,
          actor_id: x.actorId,
          action: x.action,
          entity_id: x.entityId,
          details: x.details || {},
          created_at: tsToIso(x.createdAt)
        };
      })
    };
  }

  throw new Error('Operação não reconhecida.');
}

async function api(path, options = {}) {
  try {
    return await firestoreRequest(path, options);
  } catch (err) {
    throw new Error(formatUiError(err));
  }
}

window.LOGIN_API = api;

function tab(platform) {
  $('#platformPanel').hidden = !platform;
  $('#staffPanel').hidden = platform;
  $('#platformTab').classList.toggle('selected', platform);
  $('#staffTab').classList.toggle('selected', !platform);
  message('');
}

$('#platformTab').onclick = () => tab(true);
$('#staffTab').onclick = () => tab(false);

const urlCode = new URLSearchParams(location.search).get('empresa');
if (urlCode) $('#staffPanel').elements.code.value = urlCode;

$('#platformPanel').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  const button = f.querySelector('button');
  button.disabled = true;
  message('');
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const cred = await signInWithPopup(auth, provider);
    if (!isPlatformToken(cred.user)) {
      await signOut(auth);
      throw new Error(
        `Esta conta Google (${cred.user?.email || 'desconhecida'}) não está autorizada como administrador da plataforma.`
      );
    }
    supportId = null;
    sessionStorage.removeItem('support_session');
    await load();
  } catch (err) {
    message(friendlyAuthError(err));
  } finally {
    button.disabled = false;
  }
};

async function load() {
  const user = auth.currentUser;
  $('#entry').hidden = !!user;
  $('#account').hidden = true;
  $('#platformSection').hidden = true;
  $('#passwordSection').hidden = true;
  if (!user) return;

  current = await api('/me');
  if (!current) {
    $('#entry').hidden = false;
    return;
  }
  if (current.platform && !current.business) {
    $('#platformSection').hidden = false;
    $('#platformName').textContent = current.user.name + ' · ' + (current.user.email || '');
    await loadBusinesses();
    return;
  }
  if (current.must_change_password) {
    $('#passwordSection').hidden = false;
    return;
  }

  $('#account').hidden = false;
  $('#supportBanner').hidden = !current.support;
  if (current.support) {
    supportId = current.support.id;
    const until = new Date(current.support.expires_at).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit'
    });
    $('#supportInfo').textContent =
      current.business.name +
      ' · ' +
      (current.support.write_enabled ? 'Alterações habilitadas' : 'Somente consulta') +
      ' · Até ' +
      until +
      ' · ' +
      current.support.purpose;
    $('#enableSupportWrite').hidden = current.support.write_enabled;
  }

  $('#businessName').textContent = current.business.name;
  $('#businessCode').textContent = current.business.code;
  $('#userName').textContent =
    current.user.name +
    ' · ' +
    ({ admin: 'Administrador', cashier: 'Caixa / responsável', waiter: 'Garçom' }[current.user.role] || '');

  const link = new URL('/login/', location.origin);
  link.searchParams.set('empresa', current.business.access_alias || current.business.code);
  $('#staffLink').href = link.href;
  $('#staffLink').textContent = link.href;

  const isAdmin = current.user.permissions.includes('employees.manage');
  $('#adminSection').hidden = !isAdmin;
  $('#staffSection').hidden = isAdmin;
  if (isAdmin) {
    await team();
  } else {
    location.replace('/system/');
    return;
  }
  $('#newMember').disabled = !!current.support && !current.support.write_enabled;
  window.dispatchEvent(new Event('account-ready'));
}

$('#staffPanel').onsubmit = async (e) => {
  e.preventDefault();
  const form = e.target;
  const button = form.querySelector('button');
  button.disabled = true;
  message('');
  try {
    const identifier = form.elements.code.value;
    const username = form.elements.username.value.trim().toLowerCase();
    const password = form.elements.password.value;
    if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username)) {
      throw new Error('Estabelecimento, usuário ou senha inválidos.');
    }
    const access = await resolveBusinessAccess(identifier);
    if (!access || !access.active) {
      throw new Error('Estabelecimento não encontrado ou desativado.');
    }
    const email = staffAuthEmail(username, access.code);
    await signInWithEmailAndPassword(auth, email, password);
    supportId = null;
    sessionStorage.removeItem('support_session');
    await load();
  } catch (err) {
    message(friendlyAuthError(err));
  } finally {
    form.elements.password.value = '';
    button.disabled = false;
  }
};

$('#passwordForm').onsubmit = async (e) => {
  e.preventDefault();
  const form = e.target;
  const button = form.querySelector('button');
  if (form.elements.password.value !== form.elements.confirm.value) {
    message('As senhas precisam ser iguais.');
    return;
  }
  button.disabled = true;
  try {
    await api('/password', {
      method: 'POST',
      body: JSON.stringify({ password: form.elements.password.value })
    });
    form.reset();
    await load();
    message('Senha alterada.');
  } catch (err) {
    message(err.message);
  } finally {
    button.disabled = false;
  }
};

for (const button of document.querySelectorAll('.logout')) {
  button.onclick = async () => {
    if (supportId) {
      try {
        await api('/platform/support/' + supportId, {
          method: 'PATCH',
          body: JSON.stringify({ close: true })
        });
      } catch {}
    }
    await signOut(auth);
    supportId = null;
    sessionStorage.removeItem('support_session');
    current = null;
    await load();
    message('Sessão encerrada.');
  };
}

async function team() {
  const data = await api('/members');
  people = data.members;
  $('#members').innerHTML = `<p class="small">Usuários ativos: ${people.filter(p=>p.active).length}${current.business.user_limit!=null?' / '+current.business.user_limit:' · contrato legado preservado'}. O proprietário ocupa uma vaga.</p>` + people
    .map(
      (p) =>
        `<div class="member-row"><div><strong>${esc(p.display_name)}</strong><small>${esc(
          p.username || 'Proprietário'
        )} · ${{ admin: 'Administrador', cashier: 'Caixa', waiter: 'Garçom' }[p.role]} · ${
          p.active ? 'Ativo' : 'Inativo'
        }</small></div>${
          p.user_id === current.user.id && current.owner
            ? '<small>Proprietário</small>'
            : `<button data-edit="${p.user_id}" ${
                current.support && !current.support.write_enabled ? 'disabled' : ''
              }>Editar acesso</button>`
        }</div>`
    )
    .join('');
  for (const b of document.querySelectorAll('[data-edit]')) {
    b.onclick = () => editor(b.dataset.edit);
  }
}

function permissionsHtml(role, values = {}) {
  return catalog
    .filter(p=>!window.IDContract||IDContract.allowed({modules:current?.business?.modules,businessKind:current?.business?.business_kind},p.id))
    .map((p) => {
      if (!p.roles.includes(role) || role === 'admin') {
        return `<div class="permissions-row"><span>${esc(p.label)}</span><small>${
          role === 'admin' ? 'Permitido' : 'Indisponível neste perfil'
        }</small></div>`;
      }
      return `<label class="permissions-row"><span>${esc(
        p.label
      )}</span><select name="perm:${p.id}"><option value="" ${
        !Object.hasOwn(values, p.id) ? 'selected' : ''
      }>Seguir perfil</option><option value="true" ${
        values[p.id] === true ? 'selected' : ''
      }>Permitir</option><option value="false" ${
        values[p.id] === false ? 'selected' : ''
      }>Bloquear</option></select></label>`;
    })
    .join('');
}

function editor(id = null) {
  editing = people.find((p) => p.user_id === id) || null;
  const form = $('#memberForm');
  const isRetail = current?.business?.business_kind === 'retail' || (current?.business?.modules && !current.business.modules.tables);
  form.reset();
  form.elements.name.value = editing?.display_name || '';
  form.elements.username.value = editing?.username || '';
  form.elements.username.disabled = !!editing;
  const waiterOption = form.elements.role.querySelector('option[value="waiter"]');
  if (waiterOption) {
    const hideWaiter = isRetail && editing?.role !== 'waiter';
    waiterOption.hidden = hideWaiter;
    waiterOption.disabled = hideWaiter;
  }
  form.elements.role.value = editing?.role || (isRetail ? 'cashier' : 'waiter');
  form.elements.active.checked = editing?.active ?? true;
  $('#passwordLabel').hidden = !!editing;
  form.elements.password.required = !editing;
  $('#activeLabel').hidden = !editing;
  $('#formTitle').textContent = editing ? 'Editar acesso' : 'Cadastrar funcionário';
  $('#permissions').innerHTML = permissionsHtml(form.elements.role.value, editing?.permissions || {});
  $('#formError').textContent = '';
  $('#editor').showModal();
}

$('#newMember').onclick = () => editor();
$('#closeEditor').onclick = () => $('#editor').close();
$('#memberForm').elements.role.onchange = (e) => {
  $('#permissions').innerHTML = permissionsHtml(e.target.value, {});
};
$('#memberForm').onsubmit = async (e) => {
  e.preventDefault();
  const form = e.target;
  const button = form.querySelector('[type=submit]');
  button.disabled = true;
  $('#formError').textContent = '';
  try {
    const f = new FormData(form);
    const permissions = {};
    for (const p of catalog) {
      const v = f.get('perm:' + p.id);
      if (v === 'true' || v === 'false') permissions[p.id] = v === 'true';
    }
    const data = {
      name: f.get('name'),
      username: editing ? editing.username : f.get('username'),
      role: f.get('role'),
      permissions,
      active: f.has('active'),
      version: editing?.version
    };
    if (!editing) data.password = f.get('password');
    await api(editing ? '/members/' + editing.user_id : '/members', {
      method: editing ? 'PATCH' : 'POST',
      body: JSON.stringify(data)
    });
    form.elements.password.value = '';
    $('#editor').close();
    await team();
    message('Cadastro salvo.');
  } catch (err) {
    $('#formError').textContent = err.message;
  } finally {
    button.disabled = false;
  }
};

let loadBusinesses = async () => {};

(async () => {
  try {
    catalog = await fetch('/permissions.json').then((r) => r.json());
  } catch {
    catalog = PERMISSIONS.map((id) => ({
      id,
      label: PERMISSION_INFO[id][1],
      roles: ['admin', 'cashier', 'waiter'].filter((r) => fb.roleAllows(r, id))
    }));
  }
  await new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, () => {
      unsub();
      resolve();
    });
  });
  try {
    await load();
  } catch (err) {
    if (supportId) {
      supportId = null;
      sessionStorage.removeItem('support_session');
      try {
        await load();
        return;
      } catch {}
    }
    await signOut(auth).catch(() => {});
    $('#entry').hidden = false;
    message(formatUiError(err));
  }
})();

$('#createBusiness').onclick = () => {
  $('#businessForm').reset();
  $('#platformEditor .dialog-error').textContent = '';
  $('#businessForm [data-contract]')?.remove();
  $('#businessForm').elements.business_kind.closest('label').insertAdjacentHTML('afterend',IDContract.fields({modules:{},businessKind:'food',userLimit:1},1));
  $('#businessForm').elements.business_kind.onchange=()=>IDContract.updateKind($('#businessForm'));
  $('#platformEditor').showModal();
};

$('#businessForm').onsubmit = async (e) => {
  e.preventDefault();
  const form = e.target;
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const f = new FormData(form);
    const data = await api('/platform/businesses', {
      method: 'POST',
      body: JSON.stringify({...Object.fromEntries(f),...IDContract.read(form)})
    });
    form.elements.password.value = '';
    $('#platformEditor').close();
    await loadBusinesses();
    message(
      'Cliente cadastrado. Código de acesso: ' +
        data.business.code +
        '. Entregue o usuário e a senha temporária ao proprietário por um meio privado.'
    );
  } catch (err) {
    $('#platformEditor .dialog-error').textContent = err.message;
  } finally {
    button.disabled = false;
  }
};

$('#supportForm').onsubmit = async (e) => {
  e.preventDefault();
  const form = e.target;
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const f = new FormData(form);
    const data = await api('/platform/support', {
      method: 'POST',
      body: JSON.stringify({
        business_id: supportBusiness,
        purpose: f.get('purpose'),
        customer_requested: f.has('customer_requested')
      })
    });
    supportId = data.session.id;
    sessionStorage.setItem('support_session', supportId);
    $('#supportEditor').close();
    await load();
    message('Atendimento aberto.');
  } catch (err) {
    $('#supportEditor .dialog-error').textContent = err.message;
  } finally {
    button.disabled = false;
  }
};

$('#enableSupportWrite').onclick = () => {
  const reason = prompt('Informe o motivo para habilitar alterações neste atendimento:');
  if (!reason) return;
  api('/platform/support/' + supportId, {
    method: 'PATCH',
    body: JSON.stringify({ write_enabled: true, reason })
  })
    .then(load)
    .catch((err) => message(err.message));
};

$('#endSupport').onclick = async () => {
  try {
    await api('/platform/support/' + supportId, {
      method: 'PATCH',
      body: JSON.stringify({ close: true })
    });
    supportId = null;
    sessionStorage.removeItem('support_session');
    await load();
    message('Atendimento encerrado.');
  } catch (err) {
    message(err.message);
  }
};

for (const b of document.querySelectorAll('[data-close-dialog]')) {
  b.onclick = () => b.closest('dialog').close();
}

const openDemoBtn = document.querySelector('#openDemoChoice');
const demoDialogEl = document.querySelector('#demoChoiceDialog');
const closeDemoBtn = document.querySelector('#closeDemoChoice');
if (openDemoBtn && demoDialogEl) {
  openDemoBtn.onclick = () => demoDialogEl.showModal();
  if (closeDemoBtn) closeDemoBtn.onclick = () => demoDialogEl.close();
  demoDialogEl.onclick = e => { if (e.target === demoDialogEl) demoDialogEl.close(); };
}
if (location.hash === '#demo' && demoDialogEl) {
  demoDialogEl.showModal();
}
