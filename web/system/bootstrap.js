(() => {
  const fb = window.IDFirebase;
  if (!fb) {
    location.replace('/login/');
    return;
  }

  window.ERP_AUTH = fb;
  const nativeFetch = window.fetch.bind(window);

  const readyPromise = (async () => {
    const user = await new Promise((resolve) => {
      const unsub = fb.sdk.onAuthStateChanged(fb.auth, (u) => {
        unsub();
        resolve(u);
      });
    });

    if (!user) {
      location.replace('/login/');
      return null;
    }

    const support = sessionStorage.getItem('support_session') || null;
    try {
      const me = await fb.fetchCurrentAccount(support);
      if (!me || !me.business || me.must_change_password) {
        location.replace('/login/');
        return null;
      }
      window.ERP_ACCOUNT = me;
      document.title = me.business.name + ' · Gestão';
      window.dispatchEvent(new Event('erp-account-ready'));
      return me;
    } catch {
      location.replace('/login/');
      return null;
    }
  })();

  const authFetch = async function (input, options = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin || !(/^\/api\//.test(url.pathname) || /^\/media\//.test(url.pathname))) {
      return nativeFetch(input, options);
    }
    const me = await readyPromise;
    if (!me) {
      location.replace('/login/');
      throw new Error('Entre para continuar.');
    }
    const response = await window.IDFirebaseApi.fetch(input, options);
    if (response.status === 401 || response.status === 428) {
      location.replace('/login/');
      throw new Error('Entre novamente para continuar.');
    }
    return response;
  };

  try {
    Object.defineProperty(window, 'fetch', { value: authFetch, writable: true, configurable: true });
  } catch {
    try {
      window.fetch = authFetch;
    } catch {}
  }
})();
