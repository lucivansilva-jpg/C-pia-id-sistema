const helpState = {
  tickets: [],
  selected: null,
  detail: null,
  busy: false,
  loading: false,
  replyKey: crypto.randomUUID(),
  sequence: 0
};
const helpStatuses = {
  open: 'Aberto',
  in_progress: 'Em andamento',
  waiting_customer: 'Aguardando sua resposta',
  resolved: 'Resolvido'
};
const helpCategories = {
  error: 'Erro no sistema',
  question: 'Dúvida',
  suggestion: 'Sugestão',
  complaint: 'Reclamação'
};

menus.push(['ajuda', 'Ajuda e suporte']);
icons.ajuda = icons.equipe;
menuPermission.ajuda = 'profile.read';
nav.insertAdjacentHTML('beforeend', `<a href="#ajuda" data-route="ajuda">${svg('ajuda')}Ajuda e suporte</a>`);

async function helpApi(path, options = {}) {
  const fb = window.IDFirebase;
  const account = window.ERP_ACCOUNT;
  if (!fb || !fb.auth.currentUser || !account?.business?.id) {
    throw new Error('Entre novamente para continuar.');
  }
  const {
    db,
    auth,
    tsToIso,
    OperationType,
    handleFirestoreError,
    sdk: {
      doc,
      collection,
      getDoc,
      getDocs,
      updateDoc,
      query,
      where,
      limit,
      runTransaction,
      writeBatch,
      serverTimestamp
    }
  } = fb;
  const businessId = account.business.id;
  const user = account.user;
  const method = (options.method || 'GET').toUpperCase();
  const body = options.body ? (typeof options.body === 'string' ? JSON.parse(options.body) : options.body) : {};

  if (path === '/presence' && method === 'POST') {
    const batch = writeBatch(db);
    batch.update(doc(db, 'businesses', businessId), {
      lastSeenAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    batch.update(doc(db, 'businesses', businessId, 'members', auth.currentUser.uid), {
      lastSeenAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    await batch.commit().catch(() => {});
    return { ok: true };
  }

  if (path === '/tickets' && method === 'GET') {
    const snap = await getDocs(collection(db, 'businesses', businessId, 'tickets')).catch((err) =>
      handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/tickets`)
    );
    const tickets = snap.docs
      .map((d) => {
        const t = d.data();
        return {
          id: t.id,
          number: t.number,
          subject: t.subject,
          category: t.category,
          priority: t.priority,
          status: t.status,
          requester_name: t.requesterName,
          last_support_at: tsToIso(t.lastSupportAt),
          customer_seen_at: tsToIso(t.customerSeenAt),
          updated_at: tsToIso(t.updatedAt)
        };
      })
      .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0))
      .slice(0, 200);
    return { tickets };
  }

  if (path === '/tickets' && method === 'POST') {
    const reqKey = String(body.request_key || '').trim();
    const subject = String(body.subject || '').trim().slice(0, 120);
    const category = body.category;
    const priority = body.priority;
    const message = String(body.message || '').trim().slice(0, 4000);
    if (!reqKey || subject.length < 3 || !helpCategories[category] || !['normal', 'urgent'].includes(priority) || !message) {
      throw new Error('Confira assunto, tipo, prioridade e descrição.');
    }

    const dup = await getDocs(
      query(collection(db, 'businesses', businessId, 'tickets'), where('requestKey', '==', reqKey), limit(1))
    ).catch(() => ({ empty: true, docs: [] }));
    if (!dup.empty) {
      const existing = dup.docs[0].data();
      return { ok: true, ticket: { id: existing.id, number: existing.number } };
    }

    const ticketId = crypto.randomUUID();
    const msgId = crypto.randomUUID();
    let ticketNumber = 1;
    await runTransaction(db, async (tx) => {
      const cntRef = doc(db, 'businesses', businessId, 'counters', 'tickets');
      const bizRef = doc(db, 'businesses', businessId);
      const [cntSnap, bizSnap] = await Promise.all([tx.get(cntRef), tx.get(bizRef)]);
      ticketNumber = (cntSnap.exists() ? cntSnap.data().value || 0 : 0) + 1;
      tx.set(cntRef, { value: ticketNumber, updatedAt: serverTimestamp() });
      tx.set(doc(db, 'businesses', businessId, 'tickets', ticketId), {
        id: ticketId,
        businessId,
        number: ticketNumber,
        requestKey: reqKey,
        requesterUid: auth.currentUser.uid,
        requesterName: user.name || 'Estabelecimento',
        subject,
        category,
        priority,
        status: 'open',
        version: 1,
        lastCustomerAt: serverTimestamp(),
        customerSeenAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      tx.set(doc(db, 'businesses', businessId, 'tickets', ticketId, 'messages', msgId), {
        id: msgId,
        requestKey: reqKey + '-msg',
        side: 'customer',
        actorUid: auth.currentUser.uid,
        actorName: user.name || 'Estabelecimento',
        body: message,
        createdAt: serverTimestamp()
      });
      if (bizSnap.exists()) {
        const b = bizSnap.data();
        tx.update(bizRef, {
          openTicketCount: (b.openTicketCount || 0) + 1,
          unreadTicketCount: (b.unreadTicketCount || 0) + 1,
          updatedAt: serverTimestamp()
        });
      }
    }).catch((err) => handleFirestoreError(err, OperationType.WRITE, `businesses/${businessId}/tickets/${ticketId}`));

    return { ok: true, ticket: { id: ticketId, number: ticketNumber } };
  }

  const tMatch = path.match(/^\/tickets\/([^/]+)$/);
  if (tMatch && method === 'GET') {
    const ticketId = tMatch[1];
    const tRef = doc(db, 'businesses', businessId, 'tickets', ticketId);
    const [tSnap, msgSnap] = await Promise.all([
      getDoc(tRef),
      getDocs(collection(db, 'businesses', businessId, 'tickets', ticketId, 'messages'))
    ]).catch((err) => handleFirestoreError(err, OperationType.GET, tRef.path));
    if (!tSnap.exists()) throw new Error('Chamado não encontrado.');
    const t = tSnap.data();
    await updateDoc(tRef, {
      customerSeenAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }).catch(() => {});
    const messages = msgSnap.docs
      .map((d) => {
        const m = d.data();
        return {
          id: m.id,
          side: m.side,
          actor_name: m.actorName,
          body: m.body,
          created_at: tsToIso(m.createdAt)
        };
      })
      .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
    const truncated = messages.length > 200;
    return {
      ticket: {
        id: t.id,
        number: t.number,
        subject: t.subject,
        category: t.category,
        priority: t.priority,
        status: t.status,
        requester_name: t.requesterName
      },
      messages: truncated ? messages.slice(-200) : messages,
      truncated
    };
  }

  if (tMatch && method === 'POST') {
    const ticketId = tMatch[1];
    const reqKey = String(body.request_key || '').trim();
    const message = String(body.message || '').trim().slice(0, 4000);
    if (!reqKey || !message) throw new Error('Escreva sua mensagem.');

    const dup = await getDocs(
      query(collection(db, 'businesses', businessId, 'tickets', ticketId, 'messages'), where('requestKey', '==', reqKey), limit(1))
    ).catch(() => ({ empty: true, docs: [] }));
    if (!dup.empty) return { ok: true };

    const tRef = doc(db, 'businesses', businessId, 'tickets', ticketId);
    const msgId = crypto.randomUUID();
    await runTransaction(db, async (tx) => {
      const [tSnap, bizSnap] = await Promise.all([tx.get(tRef), tx.get(doc(db, 'businesses', businessId))]);
      if (!tSnap.exists()) throw new Error('Chamado não encontrado.');
      const t = tSnap.data();
      const nextStatus = t.status === 'waiting_customer' || t.status === 'resolved' ? 'open' : t.status;
      tx.set(doc(db, 'businesses', businessId, 'tickets', ticketId, 'messages', msgId), {
        id: msgId,
        requestKey: reqKey,
        side: 'customer',
        actorUid: auth.currentUser.uid,
        actorName: user.name || 'Estabelecimento',
        body: message,
        createdAt: serverTimestamp()
      });
      tx.update(tRef, {
        status: nextStatus,
        lastCustomerAt: serverTimestamp(),
        customerSeenAt: serverTimestamp(),
        version: (t.version || 1) + 1,
        updatedAt: serverTimestamp()
      });
      if (bizSnap.exists()) {
        const b = bizSnap.data();
        const extraOpen = t.status === 'resolved' ? 1 : 0;
        tx.update(doc(db, 'businesses', businessId), {
          openTicketCount: (b.openTicketCount || 0) + extraOpen,
          unreadTicketCount: (b.unreadTicketCount || 0) + 1,
          updatedAt: serverTimestamp()
        });
      }
    }).catch((err) => handleFirestoreError(err, OperationType.WRITE, tRef.path));
    return { ok: true };
  }

  throw new Error('Operação de suporte não suportada.');
}

function drawHelp() {
  if (current !== 'ajuda') return;
  if (window.ERP_ACCOUNT?.support) {
    main.innerHTML =
      heading('Ajuda e suporte', 'Use sua área de suporte para responder aos clientes.') +
      '<a class="btn primary" href="/login/">Voltar à área de suporte</a>';
    return;
  }
  const d = helpState.detail;
  main.innerHTML =
    heading(
      'Ajuda e suporte',
      'Registre um problema, reclamação, dúvida ou sugestão e acompanhe a resposta.',
      `<button class="btn" data-help-refresh>Atualizar</button><button class="btn primary" data-help-new>Novo chamado / reclamação</button>`
    ) +
    `<div class="help-grid"><section class="panel settingsbody"><h2>Chamados</h2>${
      helpState.tickets.length
        ? helpState.tickets
            .map(
              (t) =>
                `<button class="help-ticket ${helpState.selected === t.id ? 'selected' : ''}" data-help-open="${t.id}"><strong>#${t.number} · ${escapeHTML(
                  t.subject
                )}</strong><small>${helpStatuses[t.status]} · ${helpCategories[t.category]}${
                  t.priority === 'urgent' ? ' · Urgente' : ''
                }</small>${
                  t.last_support_at && (!t.customer_seen_at || new Date(t.last_support_at) > new Date(t.customer_seen_at))
                    ? '<small class="help-unread">Nova resposta do suporte</small>'
                    : ''
                }<small>${formatDate(t.updated_at)}</small></button>`
            )
            .join('')
        : '<p>Nenhum chamado registrado.</p>'
    }${
      helpState.tickets.length === 200 ? '<p class="sub">Exibindo os 200 chamados mais recentes.</p>' : ''
    }</section><section class="panel settingsbody">${
      d
        ? `<h2>#${d.ticket.number} · ${escapeHTML(d.ticket.subject)}</h2><p>${
            helpStatuses[d.ticket.status]
          } · Aberto por ${escapeHTML(d.ticket.requester_name)}</p><div class="help-messages">${d.messages
            .map(
              (m) =>
                `<article class="help-message ${m.side}"><small>${escapeHTML(m.actor_name)} · ${
                  m.side === 'platform' ? 'Suporte' : 'Estabelecimento'
                } · ${formatDate(m.created_at)}</small><p>${escapeHTML(m.body)}</p></article>`
            )
            .join('')}</div>${
            d.truncated ? '<p>Mostrando as últimas 200 mensagens. O histórico anterior está preservado.</p>' : ''
          }<form id="helpReply"><label>Acrescentar informações<textarea name="message" required maxlength="4000" rows="4" placeholder="Descreva o que aconteceu. Não envie senhas."></textarea></label>${
            d.ticket.status === 'resolved' ? '<p class="sub">Uma nova mensagem reabre o chamado.</p>' : ''
          }<button class="btn primary" type="submit" ${
            helpState.busy ? 'disabled' : ''
          }>Enviar mensagem</button><p class="formerror" role="alert"></p></form>`
        : empty('✉', 'Selecione um chamado', 'Suas mensagens e as respostas do suporte ficam registradas aqui.')
    }</section></div>`;
}

async function refreshHelp() {
  if (helpState.loading || window.ERP_ACCOUNT?.support) return;
  helpState.loading = true;
  try {
    const data = await helpApi('/tickets');
    helpState.tickets = data.tickets;
    if (current === 'ajuda') drawHelp();
  } finally {
    helpState.loading = false;
  }
}

async function openHelp(id) {
  const sequence = ++helpState.sequence;
  const data = await helpApi('/tickets/' + id);
  if (sequence !== helpState.sequence || current !== 'ajuda') return;
  helpState.selected = id;
  helpState.detail = data;
  helpState.replyKey = crypto.randomUUID();
  await refreshHelp();
  drawHelp();
}

function newHelp() {
  const key = crypto.randomUUID();
  const retail = (live.settings?.business_kind || window.ERP_ACCOUNT?.business?.business_kind) === 'retail';
  openForm(
    'Novo chamado / reclamação',
    `<p class="sub">Explique o problema e o que estava fazendo. Não informe senhas ou dados de cartão.</p><label>Assunto<input name="subject" required minlength="3" maxlength="120" placeholder="${retail ? 'Ex.: dúvida ao finalizar uma venda' : 'Ex.: dificuldade para finalizar uma comanda'}"></label><div class="formrow"><label>Tipo<select name="category">${Object.entries(
      helpCategories
    )
      .map(([v, l]) => `<option value="${v}">${l}</option>`)
      .join('')}</select></label><label>Prioridade<select name="priority"><option value="normal">Normal</option><option value="urgent">Urgente · impede o atendimento</option></select></label></div><label>O que aconteceu?<textarea name="message" required maxlength="4000" rows="6"></textarea></label>`,
    async (f) => {
      const r = await helpApi('/tickets', {
        method: 'POST',
        body: JSON.stringify({
          request_key: key,
          subject: f.get('subject'),
          category: f.get('category'),
          priority: f.get('priority'),
          message: f.get('message')
        })
      });
      await openHelp(r.ticket.id);
    },
    {
      reload: false,
      submitLabel: 'Enviar chamado',
      message: 'Chamado enviado. Acompanhe a resposta em Ajuda e suporte.'
    }
  );
}

const supportRender = render;
render = function () {
  supportRender();
  if (current === 'ajuda') {
    drawHelp();
    if (live.ready) refreshHelp().catch((e) => toast(e.message));
  }
};

document.addEventListener('click', async (e) => {
  const open = e.target.closest('[data-help-open]');
  try {
    if (open) await openHelp(open.dataset.helpOpen);
    if (e.target.closest('[data-help-new]')) newHelp();
    if (e.target.closest('[data-help-refresh]')) {
      if (helpState.selected) await openHelp(helpState.selected);
      else await refreshHelp();
    }
  } catch (err) {
    toast(err.message);
  }
});

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'helpReply') return;
  e.preventDefault();
  if (helpState.busy || !helpState.selected) return;
  helpState.busy = true;
  const f = e.target;
  const button = f.querySelector('button');
  button.disabled = true;
  try {
    await helpApi('/tickets/' + helpState.selected, {
      method: 'POST',
      body: JSON.stringify({ request_key: helpState.replyKey, message: f.elements.message.value })
    });
    helpState.replyKey = crypto.randomUUID();
    await openHelp(helpState.selected);
    toast('Mensagem enviada ao suporte.');
  } catch (err) {
    f.querySelector('.formerror').textContent = err.message;
  } finally {
    helpState.busy = false;
    button.disabled = false;
  }
});

let lastPresence = 0;
async function presence() {
  if (
    document.hidden ||
    !live.ready ||
    !window.ERP_ACCOUNT?.business ||
    window.ERP_ACCOUNT.support ||
    Date.now() - lastPresence < 30000
  ) {
    return;
  }
  lastPresence = Date.now();
  try {
    await helpApi('/presence', { method: 'POST', body: JSON.stringify({ route: current }) });
  } catch {
    lastPresence = 0;
  }
}

window.addEventListener('erp-account-ready', presence);
window.addEventListener('hashchange', presence);
document.addEventListener('visibilitychange', presence);
setInterval(presence, 45000);
presence();
setTimeout(presence, 2000);
setInterval(() => {
  if (
    current === 'ajuda' &&
    !document.hidden &&
    !helpState.busy &&
    !document.querySelector('#dialog').open &&
    !document.querySelector('#helpReply textarea')?.value
  ) {
    if (helpState.selected) openHelp(helpState.selected).catch(() => {});
    else refreshHelp().catch(() => {});
  }
}, 30000);
render();
