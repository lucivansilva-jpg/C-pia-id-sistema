(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v / 100);
  let products = [];
  let category = '';

  function draw() {
    const q = $('search').value.trim().toLowerCase();
    $('products').innerHTML =
      products
        .filter(
          (p) => (!category || p.category === category) && (!q || (p.name + ' ' + p.description).toLowerCase().includes(q))
        )
        .map(
          (p) =>
            `<article class="productcard ${p.available ? '' : 'unavailable'}"><div class="photo">${
              p.image_url ? `<img src="${esc(p.image_url)}" alt="${esc(p.name)}" loading="lazy">` : '◇'
            }</div><div class="productbody"><small>${esc(p.category)}</small><h3>${esc(p.name)}</h3><p>${esc(
              p.description
            )}</p>${(p.options || [])
              .map((o) => `<p>${esc(o.label)}: ${(o.values || []).map(esc).join(' / ')}</p>`)
              .join('')}<div class="productbottom"><strong>${money(p.price_cents)}</strong><span>${
              p.available ? '' : 'Indisponível'
            }</span></div></div></article>`
        )
        .join('') || '<p>Nenhum produto disponível neste filtro.</p>';
  }

  $('search').oninput = draw;

  async function load() {
    try {
      const fb = window.IDFirebase;
      if (!fb) throw new Error('Sistema indisponível.');
      const code = new URLSearchParams(location.search).get('empresa');
      if (!code || !code.trim()) throw new Error('Informe o código da empresa.');

      const access = await fb.resolveBusinessAccess(code);
      if (!access || !access.active) {
        throw new Error('Cardápio não encontrado ou desativado.');
      }

      const {
        db,
        OperationType,
        handleFirestoreError,
        sdk: { doc, collection, getDoc, getDocs, query, where }
      } = fb;

      const businessId = access.businessId;
      const settingsPath = `businesses/${businessId}/publicSettings/menu`;
      const prodPath = `businesses/${businessId}/publicProducts`;

      const [setSnap, prodSnap] = await Promise.all([
        getDoc(doc(db, 'businesses', businessId, 'publicSettings', 'menu')).catch((err) =>
          handleFirestoreError(err, OperationType.GET, settingsPath)
        ),
        getDocs(query(collection(db, 'businesses', businessId, 'publicProducts'), where('visible', '==', true))).catch((err) =>
          handleFirestoreError(err, OperationType.LIST, prodPath)
        )
      ]);

      if (!setSnap.exists() || !setSnap.data().active) {
        throw new Error('Cardápio indisponível no momento.');
      }
      const b = setSnap.data();

      products = prodSnap.docs
        .map((d) => {
          const p = d.data();
          return {
            id: p.id,
            name: p.name,
            description: p.description || '',
            category: p.category || '',
            price_cents: p.priceCents,
            available: !!p.available,
            options: p.options || [],
            image_url: p.imageDataUrl || null
          };
        })
        .sort(
          (a, b2) =>
            String(a.category || '').localeCompare(String(b2.category || ''), 'pt-BR') ||
            String(a.name || '').localeCompare(String(b2.name || ''), 'pt-BR')
        );

      $('error').textContent = '';
      $('name').textContent = b.name;
      document.title = b.name + ' · Cardápio';
      $('info').textContent = [b.address, b.phone].filter(Boolean).join(' · ');
      if (b.logoDataUrl) {
        $('logo').src = b.logoDataUrl;
        $('logo').hidden = false;
      } else {
        $('logo').hidden = true;
      }
      if (/^#[a-f0-9]{6}$/i.test(b.themeColor || '')) {
        document.documentElement.style.setProperty('--green', b.themeColor);
      }

      $('categories').replaceChildren();
      for (const c of ['', ...new Set(products.map((p) => p.category).filter(Boolean))]) {
        const button = document.createElement('button');
        button.className = 'btn';
        button.textContent = c || 'Todos';
        button.onclick = () => {
          category = c;
          draw();
        };
        $('categories').append(button);
      }
      draw();
    } catch (e) {
      let msg = e?.message || 'Não foi possível abrir o cardápio.';
      if (msg.startsWith('{') && msg.includes('"operationType"')) {
        try {
          msg = JSON.parse(msg).error || 'Erro ao carregar o cardápio.';
        } catch {}
      }
      $('error').textContent = msg;
      $('info').textContent = 'Não foi possível abrir o cardápio.';
    }
  }

  load();
  setInterval(() => {
    if (!document.hidden) load();
  }, 30000);
})();
