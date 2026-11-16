(() => {
  const sdk = window.IDFirebaseSDK;
  if (!sdk) throw new Error('Firebase SDK bundle não foi carregado.');

  const {
    FIREBASE_CONFIG,
    initializeApp,
    deleteApp,
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    updatePassword,
    signOut,
    onAuthStateChanged,
    getFirestore,
    doc,
    collection,
    collectionGroup,
    getDoc,
    getDocFromServer,
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
    Timestamp,
    documentId
  } = sdk;

  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (window.LOGIN_CONFIG?.developmentOnly && !localHost) {
    document.addEventListener('DOMContentLoaded', () => {
      const notice = document.createElement('p'); notice.setAttribute('role','alert');
      notice.textContent = 'Cópia de desenvolvimento isolada. Use a demonstração ou os emuladores locais; o login remoto está bloqueado.';
      document.body.prepend(notice);
    });
    throw new Error('Firebase remoto bloqueado nesta cópia de desenvolvimento.');
  }
  const emulatorMode = window.LOGIN_CONFIG?.developmentOnly === true;
  const runtimeConfig = emulatorMode ? {...FIREBASE_CONFIG, projectId:'demo-idsistema-test', apiKey:'demo-key', authDomain:'localhost', firestoreDatabaseId:'(default)'} : FIREBASE_CONFIG;
  const app = initializeApp(runtimeConfig);
  const auth = getAuth(app);
  const db = getFirestore(app, runtimeConfig.firestoreDatabaseId);

  if (emulatorMode) {
    sdk.connectAuthEmulator(auth, 'http://127.0.0.1:9099', {disableWarnings:true});
    sdk.connectFirestoreEmulator(db, '127.0.0.1', 8185);
  }

  const PLATFORM_ADMIN_EMAIL = (window.LOGIN_CONFIG?.platformAdminEmail || 'lucivan.silva@gmail.com').toLowerCase();

  const OperationType = Object.freeze({
    CREATE: 'create',
    UPDATE: 'update',
    DELETE: 'delete',
    LIST: 'list',
    GET: 'get',
    WRITE: 'write'
  });

  function handleFirestoreError(error, operationType, path) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    if (rawMessage.includes('Quota exceeded')) {
      console.error(
        `Firestore Quota exceeded. Project console: https://console.firebase.google.com/project/${FIREBASE_CONFIG.projectId}/firestore/databases/${FIREBASE_CONFIG.firestoreDatabaseId}/data?openUpgradeDialog=true`
      );
    }
    const errInfo = {
      error: rawMessage,
      authInfo: {
        userId: auth.currentUser?.uid || null,
        email: auth.currentUser?.email || null,
        emailVerified: auth.currentUser?.emailVerified ?? null,
        isAnonymous: auth.currentUser?.isAnonymous ?? null,
        tenantId: auth.currentUser?.tenantId || null,
        providerInfo:
          auth.currentUser?.providerData?.map((provider) => ({
            providerId: provider.providerId,
            email: provider.email
          })) || []
      },
      operationType,
      path
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));
    throw new Error(JSON.stringify(errInfo));
  }

  async function testConnection() {
    try {
      await getDocFromServer(doc(db, 'test', 'connection'));
    } catch (error) {
      if (error instanceof Error && error.message.includes('the client is offline')) {
        console.error('Please check your Firebase configuration.');
      }
    }
  }
  testConnection();

  function tsToIso(value) {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (typeof value?.toDate === 'function') return value.toDate().toISOString();
    if (value instanceof Date) return value.toISOString();
    return null;
  }

  function normalizeBusinessIdentifier(raw) {
    const clean = String(raw || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (!clean) return '';
    const digits = clean.replace(/\D/g, '');
    if (/^\d{14}$/.test(digits) && /^[\d.\-\/\s]+$/.test(clean)) {
      return digits;
    }
    return clean
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }

  function staffAuthEmail(username, businessCode) {
    const u = String(username || '').trim().toLowerCase();
    const c = String(businessCode || '').trim().toLowerCase();
    return `${u}.${c}@idsistema.invalid`;
  }

  function friendlyAuthError(err) {
    const code = err?.code || '';
    if (code === 'auth/operation-not-allowed') {
      return 'O provedor E-mail/Senha ainda não foi ativado no Firebase Authentication deste projeto. Peça ao administrador para ativar em Authentication → Sign-in method.';
    }
    if (
      code === 'auth/invalid-credential' ||
      code === 'auth/wrong-password' ||
      code === 'auth/user-not-found'
    ) {
      return 'Estabelecimento, usuário ou senha inválidos.';
    }
    if (code === 'auth/email-already-in-use') {
      return 'Este nome de usuário já está em uso neste estabelecimento.';
    }
    if (code === 'auth/weak-password') {
      return 'A senha precisa ter pelo menos 8 caracteres.';
    }
    if (code === 'auth/requires-recent-login') {
      return 'Entre novamente antes de alterar a senha.';
    }
    if (code === 'auth/popup-closed-by-user') {
      return 'A janela de login com Google foi fechada antes da conclusão.';
    }
    if (code === 'auth/popup-blocked') {
      return 'O navegador bloqueou a janela do Google. Permita pop-ups para continuar.';
    }
    if (code === 'auth/too-many-requests') {
      return 'Muitas tentativas seguidas. Aguarde alguns instantes antes de tentar novamente.';
    }
    return err?.message || 'Não foi possível autenticar.';
  }

  async function provisionAuthAccount(email, password) {
    const appName = 'provisioning-' + crypto.randomUUID();
    const secApp = initializeApp(runtimeConfig, appName);
    const secAuth = getAuth(secApp);
    if (emulatorMode) sdk.connectAuthEmulator(secAuth, 'http://127.0.0.1:9099', {disableWarnings:true});
    try {
      const cred = await createUserWithEmailAndPassword(secAuth, email, password);
      const uid = cred.user.uid;
      await signOut(secAuth);
      return uid;
    } catch (err) {
      throw new Error(friendlyAuthError(err));
    } finally {
      await deleteApp(secApp).catch(() => {});
    }
  }

  async function checkMemberCapacity(businessId){
    const snap=await getDoc(doc(db,'businesses',businessId,'settings','main'));
    const s=snap.exists()?snap.data():{};
    if(s.userLimit!=null && s.activeUserCount>=s.userLimit)throw Error('Limite de usuários ativos atingido. Solicite ampliação ao suporte.');
  }
  function memberBatch(businessId, uid, credential=null) {
    const writes=[]; const wrapper={};
    for (const op of ['set','update','delete']) wrapper[op]=(...args)=>{writes.push([op,args]);return wrapper;};
    wrapper.commit=()=>runTransaction(db, async tx=>{
      const sr=doc(db,'businesses',businessId,'settings','main');
      const mr=doc(db,'businesses',businessId,'members',uid);
      const [ss,ms]=await Promise.all([tx.get(sr),tx.get(mr)]);
      const settings=ss.exists()?ss.data():{};
      const mutation=writes.find(([,args])=>args[0].path===mr.path);
      if(!mutation)throw Error('Operação de funcionário ausente.');
      const before=ms.exists()?ms.data():null;
      const next={...(before||{}),...mutation[1][1]};
      if(before?.version && mutation[1][1].version!==before.version+1)throw Error('Cadastro alterado. Atualize antes de salvar.');
      const delta=Number(next.active===true)-Number(before?.active===true);
      if(next.active && next.role==='waiter' && !window.IDContract.modules(settings).tables)throw Error('Mesas e atendimento não estão contratados.');
      if(settings.userLimit!=null && delta!==0){
        const count=settings.activeUserCount+delta;
        if(!Number.isSafeInteger(count)||count<1||count>settings.userLimit)throw Error('Limite de usuários ativos atingido. Desative um usuário ou solicite ampliação ao suporte.');
        tx.update(sr,{activeUserCount:count,activeUserChangeUid:uid,updatedAt:serverTimestamp()});
      }
      for(const [op,args] of writes)tx[op](...args);
    }).catch(async error=>{
      // A failed reservation must not leave a usable orphan Auth account.
      if(credential){
        const check=await getDoc(doc(db,'businesses',businessId,'members',uid)).catch(()=>null);
        if(check && !check.exists()){
          const temp=initializeApp(runtimeConfig,'cleanup-'+crypto.randomUUID());
          const tempAuth=getAuth(temp);
          try{
            if(emulatorMode)sdk.connectAuthEmulator(tempAuth,'http://127.0.0.1:9099',{disableWarnings:true});
            const account=await signInWithEmailAndPassword(tempAuth,credential.email,credential.password);
            if(account.user.uid===uid)await sdk.deleteUser(account.user);
          }catch{console.warn('Falha ao remover conta sem vínculo; ela não tem acesso ao estabelecimento.');}
          finally{await deleteApp(temp).catch(()=>{});}
        }
      }
      throw error;
    });
    return wrapper;
  }

  const PERMISSION_INFO = Object.freeze({
    'profile.read': ['Acesso', 'Consultar a própria identificação'],
    'settings.read': ['Acesso', 'Consultar dados do estabelecimento'],
    'settings.manage': ['Administração', 'Alterar configurações do sistema'],
    'catalog.read': ['Produtos', 'Consultar produtos e preços'],
    'products.manage': ['Produtos', 'Cadastrar, editar e remover produtos'],
    'products.costs': ['Gestão', 'Consultar e alterar custos'],
    'tables.read': ['Atendimento', 'Consultar mesas'],
    'tables.manage': ['Atendimento', 'Cadastrar mesas'],
    'orders.read': ['Atendimento', 'Consultar as próprias comandas'],
    'orders.print': ['Atendimento', 'Imprimir comanda, conferência e cupom'],
    'orders.shared': ['Atendimento', 'Consultar e atender comandas de outros funcionários'],
    'orders.create': ['Atendimento', 'Lançar pedidos e produtos'],
    'orders.update': ['Atendimento', 'Acrescentar itens nas comandas permitidas'],
    'orders.deliver': ['Atendimento', 'Marcar produtos como entregues'],
    'orders.cancel': ['Atendimento', 'Cancelar comanda com motivo'],
    'drafts.manage': ['Atendimento', 'Guardar e retomar vendas ainda não lançadas'],
    'favorites.manage': ['Produtos', 'Organizar os próprios favoritos'],
    'cash.access': ['Caixa', 'Acessar o PDV e consultar o caixa'],
    'cash.open': ['Caixa', 'Abrir caixa'],
    'cash.close': ['Caixa', 'Fechar e conferir caixa'],
    'cash.movements': ['Caixa', 'Registrar suprimento e sangria'],
    'expenses.create': ['Caixa', 'Lançar despesa paga pela gaveta'],
    'payments.receive': ['Caixa', 'Receber, finalizar venda e colocar conta em espera'],
    'payments.refund': ['Caixa', 'Registrar estorno com motivo e confirmação'],
    'discounts.authorize': ['Caixa', 'Aplicar desconto com motivo'],
    'finance.view': ['Gestão', 'Consultar financeiro gerencial'],
    'finance.manage': ['Gestão', 'Gerenciar contas a pagar e receber'],
    'reports.view': ['Gestão', 'Acessar relatórios, estoque, compras e fornecedores'],
    'employees.manage': ['Administração', 'Administrar funcionários, perfis e permissões']
  });

  const PERMISSIONS = Object.freeze(Object.keys(PERMISSION_INFO));
  const ROLE_BASE = Object.freeze({
    waiter: [
      'profile.read',
      'settings.read',
      'catalog.read',
      'tables.read',
      'orders.read',
      'orders.create',
      'orders.update',
      'orders.deliver',
      'favorites.manage'
    ],
    cashier: [
      'profile.read',
      'settings.read',
      'catalog.read',
      'products.manage',
      'tables.read',
      'tables.manage',
      'orders.read',
      'orders.print',
      'orders.shared',
      'orders.create',
      'orders.update',
      'orders.deliver',
      'orders.cancel',
      'drafts.manage',
      'favorites.manage',
      'cash.access',
      'cash.open',
      'cash.close',
      'cash.movements',
      'payments.receive',
      'payments.refund',
      'discounts.authorize',
      'expenses.create'
    ],
    admin: PERMISSIONS
  });
  const ADMIN_ONLY = new Set([
    'settings.manage',
    'employees.manage',
    'finance.view',
    'finance.manage',
    'reports.view'
  ]);
  const DEFAULT_PROFILES = Object.freeze({
    admin: 'Administrador / proprietário',
    cashier: 'Caixa / responsável',
    waiter: 'Garçom'
  });

  function roleAllows(role, p) {
    if (!Object.hasOwn(ROLE_BASE, role) || !PERMISSIONS.includes(p)) return false;
    if (role === 'admin') return true;
    if (ADMIN_ONLY.has(p)) return false;
    if (
      role === 'waiter' &&
      (p.startsWith('cash.') ||
        p.startsWith('payments.') ||
        ['expenses.create', 'products.costs', 'orders.print', 'discounts.authorize'].includes(p))
    ) {
      return false;
    }
    return true;
  }

  function hasPermission(user, permission) {
    if(user?.contract_modules!=null && window.IDContract && !IDContract.allowed({modules:user.contract_modules,businessKind:user.business_kind},permission))return false;
    if (!user || user.active === false || user.active === 0 || !roleAllows(user.role, permission)) {
      return false;
    }
    if (user.role === 'admin') return true;
    let allowed = ROLE_BASE[user.role].includes(permission);
    const profile = user.profile_permissions;
    if (profile && Object.hasOwn(profile, permission)) allowed = profile[permission] === true;
    const rawExtra =
      user.raw_permissions && typeof user.raw_permissions === 'object' && !Array.isArray(user.raw_permissions)
        ? user.raw_permissions
        : null;
    if (rawExtra) {
      if (Object.hasOwn(rawExtra, permission)) allowed = rawExtra[permission] === true;
    } else {
      const extra = user.permissions;
      if (Array.isArray(extra)) {
        allowed = extra.includes(permission);
      } else if (extra && typeof extra === 'object' && Object.hasOwn(extra, permission)) {
        allowed = extra[permission] === true;
      }
    }
    if (!allowed) return false;
    const dependencies = {
      'cash.open': ['cash.access'],
      'cash.close': ['cash.access'],
      'cash.movements': ['cash.access'],
      'payments.receive': ['cash.access'],
      'payments.refund': ['cash.access'],
      'expenses.create': ['cash.access', 'cash.movements']
    };
    return !(dependencies[permission] || []).some((dep) => !hasPermission(user, dep));
  }

  function effectivePermissions(user) {
    return PERMISSIONS.filter((p) => hasPermission(user, p));
  }

  function permissionOverrides(value, role) {
    if (!Object.hasOwn(ROLE_BASE, role)) throw new Error('Perfil inválido.');
    const out = {};
    if (Array.isArray(value)) {
      for (const p of value) {
        if (!roleAllows(role, p)) throw new Error('Permissão incompatível com o perfil.');
        out[p] = true;
      }
    } else {
      if (!value || typeof value !== 'object') throw new Error('Permissões inválidas.');
      for (const [p, v] of Object.entries(value)) {
        if (
          !PERMISSIONS.includes(p) ||
          typeof v !== 'boolean' ||
          (v && !roleAllows(role, p)) ||
          (role === 'admin' && !v)
        ) {
          throw new Error('Permissão incompatível com o perfil.');
        }
        out[p] = v;
      }
    }
    return out;
  }

  function isPlatformToken(user) {
    return !!(
      user &&
      user.emailVerified === true &&
      String(user.email || '').toLowerCase() === PLATFORM_ADMIN_EMAIL
    );
  }

  async function ensurePlatformAdminDoc(fbUser) {
    if (!isPlatformToken(fbUser)) return false;
    const ref = doc(db, 'platformAdmins', fbUser.uid);
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, {
          uid: fbUser.uid,
          name: fbUser.displayName || 'Administrador da Plataforma',
          email: String(fbUser.email || '').toLowerCase(),
          active: true,
          createdAt: serverTimestamp()
        });
      }
      return true;
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'platformAdmins/' + fbUser.uid);
      return false;
    }
  }

  async function resolveBusinessAccess(input) {
    const id = normalizeBusinessIdentifier(input);
    if (!id) return null;
    const path = 'businessAccess/' + id;
    try {
      const snap = await getDoc(doc(db, 'businessAccess', id));
      if (!snap.exists()) return null;
      return snap.data();
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, path);
      return null;
    }
  }

  async function fetchCurrentAccount(supportSessionId) {
    const fbUser = auth.currentUser;
    if (!fbUser) return null;

    if (isPlatformToken(fbUser)) {
      await ensurePlatformAdminDoc(fbUser);
      if (supportSessionId) {
        let sessSnap;
        try {
          sessSnap = await getDoc(doc(db, 'supportSessions', supportSessionId));
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, 'supportSessions/' + supportSessionId);
        }
        if (sessSnap && sessSnap.exists()) {
          const s = sessSnap.data();
          const expMs = tsToIso(s.expiresAt) ? Date.parse(tsToIso(s.expiresAt)) : 0;
          if (s.active && s.supportUid === fbUser.uid && expMs > Date.now()) {
            const [bizSnap, settingsSnap] = await Promise.all([
              getDoc(doc(db, 'businesses', s.businessId)).catch((err) =>
                handleFirestoreError(err, OperationType.GET, 'businesses/' + s.businessId)
              ),
              getDoc(doc(db, 'businesses', s.businessId, 'settings', 'main')).catch(() => null)
            ]);
            if (bizSnap && bizSnap.exists()) {
              const b = bizSnap.data();
              const rawKind = settingsSnap?.exists() ? settingsSnap.data()?.businessKind : null;
              const validRawKind = rawKind === 'food' || rawKind === 'retail' ? rawKind : null;
              return {
                platform: true,
                owner: false,
                must_change_password: false,
                support: {
                  id: s.id,
                  business_id: s.businessId,
                  purpose: s.purpose,
                  write_enabled: !!s.writeEnabled,
                  expires_at: tsToIso(s.expiresAt)
                },
                business: {
                  id: b.id,
                  name: b.name,
                  code: b.code,
                  access_alias: b.accessAlias || null,
                  active: !!b.active,
                  business_kind: validRawKind || 'food',
                  modules: settingsSnap?.data()?.modules ?? null,
                  user_limit: settingsSnap?.data()?.userLimit ?? null,
                  active_user_count: settingsSnap?.data()?.activeUserCount ?? null,
                  raw_business_kind: validRawKind
                },
                user: {
                  id: fbUser.uid,
                  name: fbUser.displayName || 'Suporte da Plataforma',
                  email: fbUser.email,
                  role: 'admin',
                  permissions: PERMISSIONS.slice()
                }
              };
            }
          }
        }
      }
      return {
        platform: true,
        owner: false,
        must_change_password: false,
        business: null,
        support: null,
        user: {
          id: fbUser.uid,
          name: fbUser.displayName || 'Administrador da Plataforma',
          email: fbUser.email,
          role: 'admin',
          permissions: PERMISSIONS.slice()
        }
      };
    }

    let ubSnap;
    try {
      ubSnap = await getDoc(doc(db, 'userBusinesses', fbUser.uid));
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, 'userBusinesses/' + fbUser.uid);
    }
    if (!ubSnap || !ubSnap.exists()) {
      throw new Error('Usuário sem estabelecimento vinculado.');
    }
    const ub = ubSnap.data();
    const businessId = ub.businessId;

    let bizSnap;
    let memberSnap;
    let profilesSnap;
    let settingsSnap;
    try {
      [bizSnap, memberSnap, profilesSnap, settingsSnap] = await Promise.all([
        getDoc(doc(db, 'businesses', businessId)),
        getDoc(doc(db, 'businesses', businessId, 'members', fbUser.uid)),
        getDocs(collection(db, 'businesses', businessId, 'profiles')),
        getDoc(doc(db, 'businesses', businessId, 'settings', 'main')).catch(() => null)
      ]);
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, 'businesses/' + businessId);
    }

    if (!bizSnap.exists() || !bizSnap.data().active || bizSnap.data().deleted) {
      throw new Error('Este estabelecimento está desativado no momento.');
    }
    if (!memberSnap.exists() || !memberSnap.data().active) {
      throw new Error('Seu acesso está inativo neste estabelecimento.');
    }

    const biz = bizSnap.data();
    const member = memberSnap.data();
    const rawKind = settingsSnap?.exists() ? settingsSnap.data()?.businessKind : null;
    const validRawKind = rawKind === 'food' || rawKind === 'retail' ? rawKind : null;
    const profileMap = {};
    profilesSnap.forEach((d) => {
      profileMap[d.id] = d.data();
    });
    const roleProfile = profileMap[member.role] || { permissions: {} };
    const effective = effectivePermissions({
      role: member.role,
      active: member.active,
      profile_permissions: roleProfile.permissions || {},
      permissions: member.permissions || {}
    });

    return {
      platform: false,
      owner: !!member.isOwner,
      must_change_password: !!member.mustChangePassword,
      support: null,
      business: {
        id: biz.id,
        name: biz.name,
        code: biz.code,
        access_alias: biz.accessAlias || null,
        active: !!biz.active,
        business_kind: validRawKind || 'food',
        modules: settingsSnap?.data()?.modules ?? null,
                  user_limit: settingsSnap?.data()?.userLimit ?? null,
                  active_user_count: settingsSnap?.data()?.activeUserCount ?? null,
                  raw_business_kind: validRawKind
      },
      user: {
        id: fbUser.uid,
        name: member.name,
        username: member.username,
        role: member.role,
        contract_modules: settingsSnap?.data()?.modules??null,
        business_kind: validRawKind || 'food',
        permissions: effective.filter(p => !window.IDContract || window.IDContract.allowed(settingsSnap?.data() || {}, p)),
        raw_permissions: member.permissions || {},
        profile_permissions: roleProfile.permissions || {}
      }
    };
  }

  async function compressImageFile(file) {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!file || !allowed.includes(file.type)) {
      throw new Error('Use uma imagem JPG, PNG ou WebP.');
    }
    if (file.size > 2097152) {
      throw new Error('A foto deve ter até 2 MB.');
    }
    const blobUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Não foi possível ler a imagem selecionada.'));
        el.src = blobUrl;
      });
      const maxDim = 900;
      let width = img.naturalWidth || img.width || 1;
      let height = img.naturalHeight || img.height || 1;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      const outMime = file.type === 'image/png' ? 'image/webp' : file.type;
      let quality = 0.82;
      let dataUrl = canvas.toDataURL(outMime, quality);
      if (!dataUrl.startsWith('data:' + outMime)) {
        dataUrl = canvas.toDataURL('image/jpeg', quality);
      }
      while (dataUrl.length > 420000 && quality > 0.4) {
        quality -= 0.12;
        dataUrl = canvas.toDataURL('image/jpeg', quality);
      }
      if (dataUrl.length > 440000) {
        const shrink = document.createElement('canvas');
        shrink.width = Math.max(1, Math.round(width * 0.65));
        shrink.height = Math.max(1, Math.round(height * 0.65));
        shrink.getContext('2d').drawImage(img, 0, 0, shrink.width, shrink.height);
        dataUrl = shrink.toDataURL('image/jpeg', 0.65);
      }
      const finalMime = dataUrl.slice(5, dataUrl.indexOf(';'));
      const approxBytes = Math.min(350000, Math.ceil((dataUrl.length * 3) / 4));
      return { dataUrl, mime: finalMime, size: Math.max(1, approxBytes) };
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }

  window.IDFirebase = {
    app,
    auth,
    db,
    config: FIREBASE_CONFIG,
    PLATFORM_ADMIN_EMAIL,
    OperationType,
    handleFirestoreError,
    tsToIso,
    normalizeBusinessIdentifier,
    staffAuthEmail,
    friendlyAuthError,
    provisionAuthAccount,
    memberBatch,
    checkMemberCapacity,
    isPlatformToken,
    ensurePlatformAdminDoc,
    resolveBusinessAccess,
    fetchCurrentAccount,
    compressImageFile,
    PERMISSION_INFO,
    PERMISSIONS,
    ROLE_BASE,
    ADMIN_ONLY,
    DEFAULT_PROFILES,
    roleAllows,
    hasPermission,
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
      getDocFromServer,
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
      Timestamp,
      documentId
    }
  };
})();
