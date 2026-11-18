(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((value || 0) / 100);

  let products = [];
  let settings = null;
  let businessId = null;
  let businessCode = '';
  let category = '';
  let cart = [];
  let prefilledTable = null;
  let activeTrackerToken = '';
  let activeTrackerData = null;
  let lastSubmitAt = 0;
  let submitting = false;

  let stopProducts = null;
  let stopSettings = null;
  let stopTracker = null;
  let generation = 0;

  const STATUS_LABELS = {
    awaiting_confirmation: 'Aguardando confirmação da loja',
    confirmed: 'Pedido confirmado',
    preparing: 'Em preparo',
    ready_for_pickup: 'Pronto para retirada',
    out_for_delivery: 'Saiu para entrega',
    delivered: 'Entregue',
    rejected: 'Pedido recusado',
    cancelled: 'Pedido cancelado'
  };

  const PAYMENT_INTENT_LABELS = {
    cash: 'Dinheiro',
    pix: 'Pix (conferido no atendimento)',
    card_on_delivery: 'Cartão na entrega / retirada',
    pay_at_counter: 'Pagar no balcão / caixa'
  };

  function randomToken(len = 36) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
    const bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
  }

  function makePublicCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    let suffix = '';
    for (let i = 0; i < 4; i++) suffix += chars[bytes[i] % chars.length];
    return 'PD-' + suffix;
  }

  function isOrderingEnabled() {
    return !!(settings && settings.active && settings.businessKind !== 'retail' && settings.onlineOrdersEnabled === true);
  }

  function trackerStorageKey() {
    return 'id_sistema.tracker.' + (businessCode || businessId || 'default');
  }

  function setTrackerToken(token) {
    activeTrackerToken = token || '';
    try {
      if (activeTrackerToken) localStorage.setItem(trackerStorageKey(), activeTrackerToken);
      else localStorage.removeItem(trackerStorageKey());
    } catch {
      // ignore storage errors
    }
    const url = new URL(location.href);
    if (activeTrackerToken) url.searchParams.set('acompanhar', activeTrackerToken);
    else url.searchParams.delete('acompanhar');
    history.replaceState(null, '', url.toString());
  }

  function cartSubtotal() {
    return cart.reduce((s, item) => s + item.unit_price_cents * item.quantity, 0);
  }

  function cartCount() {
    return cart.reduce((s, item) => s + item.quantity, 0);
  }

  function updateCartBar() {
    const bar = $('cartBar');
    if (!bar) return;
    const ordering = isOrderingEnabled();
    const count = cartCount();
    bar.hidden = !ordering || count === 0;
    if (!bar.hidden) {
      $('cartCountLabel').textContent = count === 1 ? '1 item no pedido' : `${count} itens no pedido`;
      $('cartTotalLabel').textContent = money(cartSubtotal());
    }
  }

  function drawTrackerBanner() {
    const banner = $('trackerBanner');
    const btn = $('openTrackerBtn');
    if (!banner) return;
    if (!activeTrackerData) {
      banner.hidden = true;
      if (btn) btn.hidden = !activeTrackerToken;
      return;
    }
    const t = activeTrackerData;
    const label = STATUS_LABELS[t.status] || t.status;
    const isStopped = t.status === 'rejected' || t.status === 'cancelled';
    const steps =
      t.mode === 'delivery'
        ? [
            ['awaiting_confirmation', 'Recebido'],
            ['confirmed', 'Confirmado'],
            ['preparing', 'Preparo'],
            ['out_for_delivery', 'Em entrega'],
            ['delivered', 'Entregue']
          ]
        : t.mode === 'pickup'
        ? [
            ['awaiting_confirmation', 'Recebido'],
            ['confirmed', 'Confirmado'],
            ['preparing', 'Preparo'],
            ['ready_for_pickup', 'Pronto p/ retirada'],
            ['delivered', 'Retirado']
          ]
        : [
            ['awaiting_confirmation', 'Recebido'],
            ['confirmed', 'Confirmado'],
            ['preparing', 'Preparo'],
            ['delivered', 'Servido']
          ];
    const orderIdx = steps.findIndex(([k]) => k === t.status);

    banner.hidden = false;
    if (btn) btn.hidden = true;
    banner.innerHTML = `
      <div class="tracker-head">
        <div>
          <span class="pill">PEDIDO ${esc(t.publicCode)}</span>
          <h2 style="margin:8px 0 4px">${esc(label)}</h2>
          <p class="sub">${
            t.mode === 'delivery'
              ? `Delivery · ${esc(t.areaName || 'Área informada')}`
              : t.mode === 'pickup'
              ? 'Retirada no estabelecimento'
              : `Na mesa ${t.tableNumber || ''}`
          }${t.estimatedMinutes ? ` · Previsão: ~${t.estimatedMinutes} min` : ''}</p>
        </div>
        <button type="button" class="btn" id="clearTrackerBtn">Fechar acompanhamento</button>
      </div>
      ${
        isStopped
          ? `<div class="alert-box"><strong>${esc(label)}:</strong> ${esc(t.statusReason || 'Entre em contato com o estabelecimento.')}</div>`
          : `<div class="tracker-steps">${steps
              .map(([k, text], idx) => `<span class="tracker-step ${orderIdx >= idx ? 'done' : ''}">${esc(text)}</span>`)
              .join('')}</div>`
      }
      ${t.mode === 'pickup' && t.pickupMessage ? `<div class="info-box"><strong>Retirada:</strong> ${esc(t.pickupMessage)}</div>` : ''}
      <p class="sub">${t.itemCount} item(ns) · Subtotal ${money(t.subtotalCents)}${
      t.deliveryFeeCents ? ` · Entrega ${money(t.deliveryFeeCents)}` : ''
    } · <strong>Total ${money(t.totalCents)}</strong> · ${esc(PAYMENT_INTENT_LABELS[t.paymentIntent] || t.paymentIntent)}</p>
    `;
    const clearBtn = $('clearTrackerBtn');
    if (clearBtn) {
      clearBtn.onclick = () => {
        stopTracker?.();
        stopTracker = null;
        activeTrackerData = null;
        setTrackerToken('');
        drawTrackerBanner();
      };
    }
  }

  function subscribeTracker(fb, bizId, token, g) {
    stopTracker?.();
    stopTracker = null;
    if (!token || !/^[a-zA-Z0-9_-]{32,80}$/.test(token)) {
      activeTrackerData = null;
      drawTrackerBanner();
      return;
    }
    const { doc, onSnapshot } = fb.sdk;
    stopTracker = onSnapshot(
      doc(fb.db, 'businesses', bizId, 'publicOrderTrackers', token),
      (snap) => {
        if (g !== generation) return;
        if (!snap.exists()) {
          activeTrackerData = null;
          drawTrackerBanner();
          return;
        }
        activeTrackerData = snap.data();
        drawTrackerBanner();
      },
      () => {
        if (g !== generation) return;
        activeTrackerData = null;
        drawTrackerBanner();
      }
    );
  }

  function draw() {
    const search = $('search').value.trim().toLocaleLowerCase('pt-BR');
    const ordering = isOrderingEnabled();
    const list = products.filter(
      (p) =>
        (!category || p.category === category) &&
        (!search || (p.name + ' ' + (p.description || '')).toLocaleLowerCase('pt-BR').includes(search))
    );
    $('products').innerHTML =
      list
        .map(
          (p) => `
      <article class="productcard ${p.available ? '' : 'unavailable'}">
        <div class="photo">${p.imageDataUrl ? `<img src="${esc(p.imageDataUrl)}" alt="${esc(p.name)}" loading="lazy">` : '◇'}</div>
        <div class="productbody">
          <small>${esc(p.category)}</small>
          <h3>${esc(p.name)}</h3>
          <p>${esc(p.description)}</p>
          ${(p.options || []).map((o) => `<p>${esc(o.label)}: ${(o.values || []).map(esc).join(' / ')}</p>`).join('')}
          ${
            (p.addons || []).length
              ? `<details><summary>Adicionais</summary>${p.addons.map((a) => `<p>${esc(a.name)} · + ${money(a.price_cents)}</p>`).join('')}</details>`
              : ''
          }
          <div class="productbottom"><strong>${money(p.priceCents)}</strong><span>${p.available ? '' : 'Esgotado'}</span></div>
          ${ordering && p.available ? `<button type="button" class="btn primary add-btn" data-add-product="${esc(p.id)}">＋ Adicionar</button>` : ''}
        </div>
      </article>`
        )
        .join('') || '<p>Nenhum produto encontrado neste filtro.</p>';
    updateCartBar();
  }

  function categories() {
    const names = [...new Set(products.map((p) => p.category).filter(Boolean))];
    if (category && !names.includes(category)) category = '';
    $('categories').replaceChildren();
    for (const name of ['', ...names]) {
      const button = document.createElement('button');
      button.className = 'btn';
      button.textContent = name || 'Todos';
      button.setAttribute('aria-pressed', String(category === name));
      button.onclick = () => {
        category = name;
        categories();
        draw();
      };
      $('categories').append(button);
    }
  }

  function openProductModal(productId) {
    if (!isOrderingEnabled()) return;
    const p = products.find((item) => item.id === productId);
    if (!p || !p.available) return;

    const dialog = $('menuDialog');
    const groups = p.options || [];
    const addons = p.addons || [];
    const addonQtys = new Map();
    let qty = 1;

    function unitPrice() {
      let total = p.priceCents;
      for (const a of addons) {
        total += (a.price_cents || 0) * (addonQtys.get(a.name) || 0);
      }
      return total;
    }

    function updateSummary() {
      const el = dialog.querySelector('#modalProductTotal');
      if (el) el.textContent = money(unitPrice() * qty);
    }

    dialog.innerHTML = `
      <form id="productPickForm">
        <div class="dialoghead">
          <h2>${esc(p.name)}</h2>
          <button type="button" class="close" data-close-dialog aria-label="Fechar">×</button>
        </div>
        ${p.description ? `<p class="sub">${esc(p.description)}</p>` : ''}
        <p><strong>Preço base: ${money(p.priceCents)}</strong></p>
        ${groups
          .map(
            (g, idx) => `
          <label>${esc(g.label)}${g.required ? ' *' : ''}
            <select name="opt_${idx}" ${g.required ? 'required' : ''}>
              <option value="">${g.required ? 'Selecione…' : 'Sem preferência'}</option>
              ${(g.values || []).map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}
            </select>
          </label>`
          )
          .join('')}
        ${
          addons.length
            ? `<h3 style="margin-top:16px">Adicionais</h3>
            <div>${addons
              .map(
                (a, idx) => `
              <div class="addon-row">
                <span>${esc(a.name)} · + ${money(a.price_cents)}</span>
                <div class="addon-qty">
                  <button type="button" data-addon-step="-1" data-addon-idx="${idx}">−</button>
                  <span id="addonQty_${idx}">0</span>
                  <button type="button" data-addon-step="1" data-addon-idx="${idx}">＋</button>
                </div>
              </div>`
              )
              .join('')}</div>`
            : ''
        }
        <label>Observação do item (opcional)
          <textarea name="note" rows="2" maxlength="200" placeholder="Ex.: sem cebola, ponto da carne…"></textarea>
        </label>
        <div class="addon-row" style="margin-top:12px">
          <span>Quantidade</span>
          <div class="addon-qty">
            <button type="button" id="itemQtyMinus">−</button>
            <strong id="itemQtyVal">1</strong>
            <button type="button" id="itemQtyPlus">＋</button>
          </div>
        </div>
        <p class="formerror" id="modalProdErr" role="alert"></p>
        <div class="dialogactions" style="margin-top:14px">
          <button type="button" class="btn" data-close-dialog>Cancelar</button>
          <button type="submit" class="btn primary">Adicionar · <span id="modalProductTotal">${money(p.priceCents)}</span></button>
        </div>
      </form>
    `;

    dialog.querySelectorAll('[data-close-dialog]').forEach((b) => {
      b.onclick = () => dialog.close();
    });
    dialog.querySelector('#itemQtyMinus').onclick = () => {
      if (qty > 1) {
        qty--;
        dialog.querySelector('#itemQtyVal').textContent = String(qty);
        updateSummary();
      }
    };
    dialog.querySelector('#itemQtyPlus').onclick = () => {
      if (qty < 99) {
        qty++;
        dialog.querySelector('#itemQtyVal').textContent = String(qty);
        updateSummary();
      }
    };
    dialog.querySelectorAll('[data-addon-step]').forEach((btn) => {
      btn.onclick = () => {
        const a = addons[Number(btn.dataset.addonIdx)];
        if (!a) return;
        const cur = addonQtys.get(a.name) || 0;
        const next = Math.max(0, Math.min(10, cur + Number(btn.dataset.addonStep)));
        addonQtys.set(a.name, next);
        dialog.querySelector(`#addonQty_${btn.dataset.addonIdx}`).textContent = String(next);
        updateSummary();
      };
    });

    dialog.querySelector('#productPickForm').onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const selections = {};
      for (let idx = 0; idx < groups.length; idx++) {
        const g = groups[idx];
        const val = String(fd.get(`opt_${idx}`) || '').trim();
        if (g.required && !val) {
          dialog.querySelector('#modalProdErr').textContent = `Selecione uma opção para ${g.label}.`;
          return;
        }
        if (val) selections[g.label] = val;
      }
      const chosenAddons = addons
        .map((a) => ({ name: a.name, price_cents: a.price_cents, quantity: addonQtys.get(a.name) || 0 }))
        .filter((a) => a.quantity > 0);
      const note = String(fd.get('note') || '').trim().slice(0, 200);
      const unit = unitPrice();
      const summaryParts = Object.entries(selections).map(([k, v]) => `${k}: ${v}`);
      const fullNote = [summaryParts.join('; '), note].filter(Boolean).join('; ');

      const sig = JSON.stringify({ id: p.id, selections, addons: chosenAddons, note });
      const existing = cart.find((c) => c._sig === sig);
      if (existing) {
        existing.quantity = Math.min(999, existing.quantity + qty);
      } else {
        cart.push({
          _sig: sig,
          product_id: p.id,
          name: p.name,
          quantity: qty,
          base_unit_price_cents: p.priceCents,
          unit_price_cents: unit,
          selections,
          addons: chosenAddons,
          note,
          display_note: fullNote
        });
      }
      updateCartBar();
      dialog.close();
    };
    dialog.showModal();
  }

  function openCheckoutDialog() {
    if (!isOrderingEnabled()) return;
    const dialog = $('menuDialog');
    const pickupOk = settings.pickupEnabled === true;
    const deliveryAreas = Array.isArray(settings.deliveryAreas)
      ? settings.deliveryAreas.filter((a) => a.active !== false)
      : [];
    const deliveryOk = settings.deliveryEnabled === true;

    let selectedMode = prefilledTable ? 'table' : deliveryOk ? 'delivery' : pickupOk ? 'pickup' : 'table';
    let selectedAreaId = deliveryAreas[0]?.id || 'unlisted';

    function renderCheckoutBody() {
      const subtotal = cartSubtotal();
      const chosenArea = selectedMode === 'delivery' ? deliveryAreas.find((a) => a.id === selectedAreaId) || null : null;
      const areaUnlisted = selectedMode === 'delivery' && (!chosenArea || selectedAreaId === 'unlisted');
      const deliveryFee = chosenArea ? chosenArea.feeCents || 0 : 0;
      const minRequired =
        selectedMode === 'delivery' && chosenArea
          ? Math.max(settings.deliveryMinOrderCents || 0, chosenArea.minOrderCents || 0)
          : 0;
      const belowMinimum = selectedMode === 'delivery' && chosenArea && subtotal < minRequired;
      const eta =
        selectedMode === 'delivery'
          ? chosenArea?.estimatedMinutes ?? settings.deliveryDefaultMinutes ?? 45
          : selectedMode === 'pickup'
          ? 20
          : null;
      const total = subtotal + deliveryFee;

      const payOptions = [
        ['cash', 'Dinheiro'],
        ['pix', 'Pix (conferido no atendimento)'],
        ['card_on_delivery', selectedMode === 'delivery' ? 'Cartão na entrega' : 'Cartão na loja'],
        ...(selectedMode !== 'delivery' ? [['pay_at_counter', 'Pagar no balcão / caixa']] : [])
      ];

      dialog.innerHTML = `
        <form id="checkoutForm">
          <div class="dialoghead">
            <h2>Finalizar solicitação</h2>
            <button type="button" class="close" data-close-checkout aria-label="Fechar">×</button>
          </div>
          <p class="sub">Seu pedido será recebido pela loja para confirmação. Não há pagamento automático neste site.</p>

          <h3 style="margin-top:14px">Itens selecionados</h3>
          <div>
            ${
              cart.length
                ? cart
                    .map(
                      (item, idx) => `
                  <div class="cart-item-row">
                    <div>
                      <strong>${item.quantity}× ${esc(item.name)}</strong>
                      ${item.display_note ? `<small class="block">${esc(item.display_note)}</small>` : ''}
                      ${
                        item.addons?.length
                          ? `<small class="block">Adicionais: ${item.addons.map((a) => `${esc(a.name)} ×${a.quantity}`).join(', ')}</small>`
                          : ''
                      }
                    </div>
                    <div style="text-align:right">
                      <strong>${money(item.unit_price_cents * item.quantity)}</strong>
                      <div>
                        <button type="button" class="textbtn" data-cart-step="-1" data-cart-idx="${idx}">−</button>
                        <button type="button" class="textbtn" data-cart-step="1" data-cart-idx="${idx}" style="margin-left:8px">＋</button>
                      </div>
                    </div>
                  </div>`
                    )
                    .join('')
                : '<p class="sub">Seu carrinho está vazio.</p>'
            }
          </div>

          ${
            cart.length
              ? `
            <h3 style="margin-top:16px">Como deseja receber?</h3>
            <div class="mode-grid">
              <button type="button" class="mode-option ${selectedMode === 'table' ? 'selected' : ''}" data-pick-mode="table">
                <strong>Na mesa / local</strong><br><span class="sub">Consumo no salão</span>
              </button>
              ${
                pickupOk
                  ? `<button type="button" class="mode-option ${selectedMode === 'pickup' ? 'selected' : ''}" data-pick-mode="pickup">
                      <strong>Retirada na loja</strong><br><span class="sub">Sem taxa de entrega</span>
                    </button>`
                  : ''
              }
              ${
                deliveryOk
                  ? `<button type="button" class="mode-option ${selectedMode === 'delivery' ? 'selected' : ''}" data-pick-mode="delivery">
                      <strong>Delivery próprio</strong><br><span class="sub">Entrega no endereço</span>
                    </button>`
                  : ''
              }
            </div>

            ${
              selectedMode === 'table'
                ? `<label>Número da mesa *
                    <input name="tableNumber" type="number" min="1" max="9999" required value="${prefilledTable || ''}" placeholder="Ex.: 5">
                  </label>`
                : ''
            }

            ${
              selectedMode === 'pickup' && settings.pickupMessage
                ? `<div class="info-box"><strong>Instruções para retirada:</strong> ${esc(settings.pickupMessage)}</div>`
                : ''
            }

            ${
              selectedMode === 'delivery'
                ? `
                <label>Área / bairro de entrega *
                  <select id="deliveryAreaSelect" name="areaId">
                    ${deliveryAreas
                      .map(
                        (a) =>
                          `<option value="${esc(a.id)}" ${selectedAreaId === a.id ? 'selected' : ''}>${esc(a.name)} · Taxa ${money(a.feeCents)}${
                            a.estimatedMinutes ? ` · ~${a.estimatedMinutes} min` : ''
                          }</option>`
                      )
                      .join('')}
                    <option value="unlisted" ${areaUnlisted ? 'selected' : ''}>Outro bairro / área não listada</option>
                  </select>
                </label>
                ${
                  areaUnlisted
                    ? '<div class="alert-box" role="alert"><strong>Não atendemos esta área no momento.</strong> Escolha uma das áreas atendidas acima ou opte por retirada/consumo no local.</div>'
                    : ''
                }
                ${
                  belowMinimum
                    ? `<div class="alert-box" role="alert">Pedido mínimo para esta área: <strong>${money(minRequired)}</strong>. Adicione mais ${money(
                        minRequired - subtotal
                      )} em produtos.</div>`
                    : ''
                }
                <div class="formrow">
                  <label>Rua / Avenida *<input name="street" required minlength="2" maxlength="160" placeholder="Ex.: Rua das Flores"></label>
                  <label style="max-width:130px">Número *<input name="streetNumber" required maxlength="30" placeholder="Ex.: 120"></label>
                </div>
                <div class="formrow">
                  <label>Complemento<input name="complement" maxlength="120" placeholder="Apto, bloco…"></label>
                  <label>Ponto de referência<input name="reference" maxlength="160" placeholder="Ex.: perto da praça"></label>
                </div>
                `
                : ''
            }

            <div class="formrow">
              <label>Seu nome *<input name="customerName" required minlength="2" maxlength="100" placeholder="Como podemos te chamar?"></label>
              <label>Telefone / WhatsApp *<input name="customerPhone" required minlength="8" maxlength="30" placeholder="(00) 90000-0000"></label>
            </div>

            <label>Forma de pagamento pretendida (conferida pela loja)
              <select id="paymentIntentSelect" name="paymentIntent">
                ${payOptions.map(([v, lbl]) => `<option value="${v}">${lbl}</option>`).join('')}
              </select>
            </label>
            <label id="changeForLabel">Troco para quanto? (R$ — opcional)
              <input name="changeFor" inputmode="decimal" placeholder="Ex.: 50,00">
            </label>
            <label>Observação geral (opcional)
              <input name="notes" maxlength="300" placeholder="Algum recado adicional para a loja?">
            </label>

            <label class="hp-field" aria-hidden="true">Site da empresa
              <input name="company_website" tabindex="-1" autocomplete="off">
            </label>

            <div style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px">
              <div class="totalrow"><span>Subtotal</span><strong>${money(subtotal)}</strong></div>
              ${selectedMode === 'delivery' ? `<div class="totalrow"><span>Taxa de entrega</span><strong>${money(deliveryFee)}</strong></div>` : ''}
              <div class="totalrow grand"><span>Total previsto</span><strong>${money(total)}</strong></div>
              ${eta ? `<p class="sub">Previsão estimada após confirmação: ~${eta} min.</p>` : ''}
            </div>
            <p class="formerror" id="checkoutError" role="alert"></p>
            <div class="dialogactions">
              <button type="button" class="btn" data-close-checkout>Voltar</button>
              <button type="submit" class="btn primary" id="submitOrderBtn" ${
                areaUnlisted || belowMinimum || submitting ? 'disabled' : ''
              }>Enviar pedido para confirmação</button>
            </div>
          `
              : '<div class="dialogactions"><button type="button" class="btn" data-close-checkout>Fechar</button></div>'
          }
        </form>
      `;

      dialog.querySelectorAll('[data-close-checkout]').forEach((b) => {
        b.onclick = () => dialog.close();
      });
      dialog.querySelectorAll('[data-cart-step]').forEach((btn) => {
        btn.onclick = () => {
          const idx = Number(btn.dataset.cartIdx);
          if (!cart[idx]) return;
          cart[idx].quantity += Number(btn.dataset.cartStep);
          cart = cart.filter((item) => item.quantity > 0);
          updateCartBar();
          renderCheckoutBody();
        };
      });
      dialog.querySelectorAll('[data-pick-mode]').forEach((btn) => {
        btn.onclick = () => {
          selectedMode = btn.dataset.pickMode;
          renderCheckoutBody();
        };
      });
      const areaSel = dialog.querySelector('#deliveryAreaSelect');
      if (areaSel) {
        areaSel.onchange = () => {
          selectedAreaId = areaSel.value;
          renderCheckoutBody();
        };
      }
      const paySel = dialog.querySelector('#paymentIntentSelect');
      const changeLbl = dialog.querySelector('#changeForLabel');
      if (paySel && changeLbl) {
        const syncChange = () => {
          changeLbl.hidden = paySel.value !== 'cash';
        };
        paySel.onchange = syncChange;
        syncChange();
      }

      const form = dialog.querySelector('#checkoutForm');
      if (form) {
        form.onsubmit = async (e) => {
          e.preventDefault();
          if (submitting) return;
          const errEl = dialog.querySelector('#checkoutError');
          errEl.textContent = '';

          const fd = new FormData(form);
          if (String(fd.get('company_website') || '').trim()) {
            dialog.close();
            return;
          }
          if (Date.now() - lastSubmitAt < 15000) {
            errEl.textContent = 'Aguarde alguns segundos antes de enviar outro pedido.';
            return;
          }

          const customerName = String(fd.get('customerName') || '').trim().slice(0, 100);
          const customerPhone = String(fd.get('customerPhone') || '').trim().slice(0, 30);
          if (customerName.length < 2) {
            errEl.textContent = 'Informe seu nome completo ou como prefere ser chamado.';
            return;
          }
          if (customerPhone.replace(/\D/g, '').length < 8) {
            errEl.textContent = 'Informe um telefone válido com DDD para contato.';
            return;
          }

          let tableNumber = null;
          let deliveryAddress = null;
          let deliveryAreaId = null;
          let deliveryAreaName = null;
          let deliveryFeeCents = 0;
          let etaVal = null;

          if (selectedMode === 'table') {
            tableNumber = Number(fd.get('tableNumber'));
            if (!Number.isInteger(tableNumber) || tableNumber < 1 || tableNumber > 9999) {
              errEl.textContent = 'Informe o número da mesa corretamente.';
              return;
            }
          } else if (selectedMode === 'delivery') {
            if (!chosenArea || areaUnlisted) {
              errEl.textContent = 'Não atendemos esta área no momento.';
              return;
            }
            if (subtotal < minRequired) {
              errEl.textContent = `Pedido abaixo do mínimo para esta área (${money(minRequired)}).`;
              return;
            }
            const street = String(fd.get('street') || '').trim().slice(0, 160);
            const numStr = String(fd.get('streetNumber') || '').trim().slice(0, 30);
            const complement = String(fd.get('complement') || '').trim().slice(0, 120);
            const reference = String(fd.get('reference') || '').trim().slice(0, 160);
            if (street.length < 2 || !numStr) {
              errEl.textContent = 'Informe rua e número para a entrega.';
              return;
            }
            deliveryAreaId = chosenArea.id;
            deliveryAreaName = chosenArea.name;
            deliveryFeeCents = chosenArea.feeCents || 0;
            etaVal = chosenArea.estimatedMinutes ?? settings.deliveryDefaultMinutes ?? 45;
            deliveryAddress = {
              areaId: deliveryAreaId,
              areaName: deliveryAreaName,
              street,
              number: numStr,
              complement,
              reference
            };
          } else if (selectedMode === 'pickup') {
            etaVal = 20;
          }

          const paymentIntent = String(fd.get('paymentIntent') || 'cash');
          let changeForCents = null;
          if (paymentIntent === 'cash') {
            const rawChange = String(fd.get('changeFor') || '').trim();
            if (rawChange) {
              if (!/^\d+(?:[.,]\d{1,2})?$/.test(rawChange)) {
                errEl.textContent = 'Informe o valor do troco no formato 0,00.';
                return;
              }
              const [a, b = ''] = rawChange.replace(',', '.').split('.');
              changeForCents = Number(a) * 100 + Number(b.padEnd(2, '0'));
            }
          }

          const notes = String(fd.get('notes') || '').trim().slice(0, 300);
          const fb = window.IDFirebase;
          const { doc, writeBatch, serverTimestamp } = fb.sdk;

          const requestId = 'req_' + randomToken(28);
          const trackingToken = randomToken(40);
          const publicCode = makePublicCode();
          const nowIsoStr = new Date().toISOString();
          const orderItems = cart.map((c) => ({
            product_id: c.product_id,
            name: c.name,
            quantity: c.quantity,
            base_unit_price_cents: c.base_unit_price_cents,
            unit_price_cents: c.unit_price_cents,
            selections: c.selections || {},
            addons: (c.addons || []).map((a) => ({ name: a.name, price_cents: a.price_cents, quantity: a.quantity })),
            note: c.note || ''
          }));
          const itemCount = orderItems.reduce((s, i) => s + i.quantity, 0);
          const history = [{ status: 'awaiting_confirmation', at: nowIsoStr, actorName: 'Cliente' }];

          const submitBtn = dialog.querySelector('#submitOrderBtn');
          submitting = true;
          if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Enviando…';
          }
          try {
            const batch = writeBatch(fb.db);
            batch.set(doc(fb.db, 'businesses', businessId, 'onlineOrders', requestId), {
              id: requestId,
              requestKey: requestId,
              trackingToken,
              publicCode,
              source: 'public_menu',
              mode: selectedMode,
              tableNumber,
              status: 'awaiting_confirmation',
              statusReason: null,
              customerName,
              customerPhone,
              notes,
              items: orderItems,
              subtotalCents: subtotal,
              deliveryAreaId,
              deliveryAreaName,
              deliveryFeeCents,
              deliveryAddress,
              estimatedMinutes: etaVal,
              paymentIntent,
              changeForCents,
              totalCents: subtotal + deliveryFeeCents,
              paidCents: 0,
              paymentStatus: 'unpaid',
              convertedOrderId: null,
              convertedOrderNumber: null,
              confirmedBy: null,
              confirmedAt: null,
              statusHistory: history,
              version: 1,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            });
            batch.set(doc(fb.db, 'businesses', businessId, 'publicOrderTrackers', trackingToken), {
              trackingToken,
              requestId,
              publicCode,
              mode: selectedMode,
              tableNumber,
              areaName: deliveryAreaName,
              estimatedMinutes: etaVal,
              paymentIntent,
              subtotalCents: subtotal,
              deliveryFeeCents,
              totalCents: subtotal + deliveryFeeCents,
              status: 'awaiting_confirmation',
              statusReason: null,
              pickupMessage: selectedMode === 'pickup' ? String(settings.pickupMessage || '').slice(0, 300) || null : null,
              itemCount,
              statusHistory: history,
              version: 1,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            });
            await batch.commit();
            lastSubmitAt = Date.now();
            cart = [];
            updateCartBar();
            setTrackerToken(trackingToken);
            subscribeTracker(fb, businessId, trackingToken, generation);
            dialog.close();
          } catch (err) {
            console.warn('Falha ao enviar pedido:', err?.code || err?.message);
            errEl.textContent = 'Não foi possível enviar o pedido agora. Confira os campos e tente novamente.';
          } finally {
            submitting = false;
            if (submitBtn) {
              submitBtn.disabled = false;
              submitBtn.textContent = 'Enviar pedido para confirmação';
            }
          }
        };
      }
    }

    renderCheckoutBody();
    dialog.showModal();
  }

  function stop() {
    generation++;
    stopProducts?.();
    stopSettings?.();
    stopTracker?.();
    stopProducts = null;
    stopSettings = null;
    stopTracker = null;
  }

  function failed(error) {
    $('error').textContent = 'Não foi possível atualizar o catálogo. Verifique sua conexão e tente novamente.';
    console.warn('Catálogo público:', error?.code || 'indisponível');
  }

  async function start() {
    if (document.hidden) return;
    stop();
    const g = generation;
    try {
      const fb = window.IDFirebase;
      if (!fb) throw Error('indisponível');
      const params = new URLSearchParams(location.search);
      const code = params.get('empresa');
      if (!code?.trim()) throw Error('Informe o código do estabelecimento.');
      businessCode = code.trim();
      const rawMesa = Number(params.get('mesa'));
      prefilledTable = Number.isInteger(rawMesa) && rawMesa >= 1 && rawMesa <= 9999 ? rawMesa : null;
      const badge = $('tableBadge');
      if (badge) {
        badge.hidden = !prefilledTable;
        if (prefilledTable) badge.textContent = `Mesa ${prefilledTable} selecionada pelo QR Code`;
      }

      const access = await fb.resolveBusinessAccess(code);
      if (g !== generation) return;
      if (!access?.active) throw Error('Estabelecimento não encontrado ou desativado.');
      const { doc, collection, query, where, onSnapshot } = fb.sdk;
      businessId = access.businessId;

      const urlTracker = params.get('acompanhar');
      let storedTracker = '';
      try {
        storedTracker = localStorage.getItem(trackerStorageKey()) || '';
      } catch {
        // ignore storage errors
      }
      activeTrackerToken = (urlTracker || storedTracker || '').trim();
      if (activeTrackerToken) {
        subscribeTracker(fb, businessId, activeTrackerToken, g);
      }

      stopSettings = onSnapshot(
        doc(fb.db, 'businesses', businessId, 'publicSettings', 'menu'),
        (snap) => {
          if (g !== generation) return;
          if (!snap.exists() || !snap.data().active) {
            settings = null;
            products = [];
            draw();
            $('error').textContent = 'Catálogo indisponível no momento.';
            stopProducts?.();
            stopProducts = null;
            return;
          }
          const b = snap.data();
          settings = b;
          $('name').textContent = b.name;
          document.title = b.name + (b.businessKind === 'retail' ? ' · Catálogo' : ' · Cardápio');
          $('info').textContent = [b.address, b.phone].filter(Boolean).join(' · ');
          const sub = $('subtitle');
          if (sub) {
            if (b.businessKind === 'retail') sub.textContent = 'Consulte os produtos e fale com um vendedor.';
            else if (b.onlineOrdersEnabled) sub.textContent = 'Escolha seus itens e envie o pedido para confirmação da loja.';
            else sub.textContent = 'Consulte os produtos e faça seu pedido com o atendente.';
          }
          $('logo').hidden = !b.logoDataUrl;
          if (b.logoDataUrl) $('logo').src = b.logoDataUrl;
          if (/^#[a-f0-9]{6}$/i.test(b.themeColor || '')) {
            document.documentElement.style.setProperty('--green', b.themeColor);
          }
          $('error').textContent = '';
          draw();
          if (!stopProducts) {
            stopProducts = onSnapshot(
              query(collection(fb.db, 'businesses', businessId, 'publicProducts'), where('visible', '==', true)),
              (snapshot) => {
                if (g !== generation) return;
                products = snapshot.docs
                  .map((d) => d.data())
                  .sort(
                    (a, b) =>
                      String(a.category || '').localeCompare(String(b.category || ''), 'pt-BR') ||
                      a.name.localeCompare(b.name, 'pt-BR')
                  );
                $('error').textContent = '';
                categories();
                draw();
              },
              failed
            );
          }
        },
        failed
      );
    } catch (error) {
      $('error').textContent = error.message?.startsWith('{') ? 'Não foi possível abrir o catálogo.' : error.message;
    }
  }

  $('search').oninput = draw;
  $('openCartBtn').onclick = openCheckoutDialog;
  $('openTrackerBtn').onclick = () => {
    if (activeTrackerToken && businessId && window.IDFirebase) {
      subscribeTracker(window.IDFirebase, businessId, activeTrackerToken, generation);
    }
  };
  document.addEventListener('click', (e) => {
    const addBtn = e.target.closest('[data-add-product]');
    if (addBtn) openProductModal(addBtn.dataset.addProduct);
  });
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  window.addEventListener('storage', (ev) => {
    if (ev.key === trackerStorageKey() && window.IDFirebase && businessId) {
      activeTrackerToken = String(ev.newValue || '').trim();
      subscribeTracker(window.IDFirebase, businessId, activeTrackerToken, generation);
    }
  });
  window.addEventListener('pagehide', stop);
  start();
})();
