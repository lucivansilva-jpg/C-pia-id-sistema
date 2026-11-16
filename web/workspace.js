async function supportApi(path, options = {}) {
  const {
    auth,
    db,
    OperationType,
    handleFirestoreError,
    tsToIso,
    isPlatformToken,
    sdk: {
      doc,
      collection,
      collectionGroup,
      getDoc,
      getDocs,
      query,
      where,
      orderBy,
      limit,
      writeBatch,
      serverTimestamp
    }
  } = window.IDFirebase;

  if (!auth.currentUser) throw new Error('Entre novamente para continuar.');
  const method = (options.method || 'GET').toUpperCase();
  const body = options.body
    ? typeof options.body === 'string'
      ? JSON.parse(options.body)
      : options.body
    : {};

  if (
    path === '/business-access' ||
    (/^\/platform\/businesses\/[^/]+$/.test(path) && ['GET', 'PUT', 'DELETE'].includes(method))
  ) {
    return await window.LOGIN_API(path, options);
  }

  if (!isPlatformToken(auth.currentUser)) {
    throw new Error('Acesso restrito ao administrador da plataforma.');
  }

  if (path === '/platform/workspace' && method === 'GET') {
    const [bizSnap, ticketsSnap] = await Promise.all([
      getDocs(collection(db, 'businesses')),
      getDocs(query(collectionGroup(db, 'tickets'), limit(500)))
    ]).catch((err) => handleFirestoreError(err, OperationType.LIST, 'businesses'));

    const allTickets = ticketsSnap.docs.map((d) => d.data());
    const openByBiz = new Map();
    const unreadByBiz = new Map();
    for (const t of allTickets) {
      if (t.status !== 'resolved') {
        openByBiz.set(t.businessId, (openByBiz.get(t.businessId) || 0) + 1);
      }
      const lastCust = tsToIso(t.lastCustomerAt);
      const seenSupp = tsToIso(t.supportSeenAt);
      if (lastCust && (!seenSupp || new Date(lastCust) > new Date(seenSupp))) {
        unreadByBiz.set(t.businessId, (unreadByBiz.get(t.businessId) || 0) + 1);
      }
    }

    const nowMs = Date.now();
    const rawBusinesses = bizSnap.docs
      .map((d) => d.data())
      .filter((b) => !b.deleted)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'));

    const settingsSnaps = await Promise.all(
      rawBusinesses.map((b) => getDoc(doc(db, 'businesses', b.id, 'settings', 'main')).catch(() => null))
    );
    const kindByBiz = new Map();
    rawBusinesses.forEach((b, idx) => {
      const raw = settingsSnaps[idx]?.exists() ? settingsSnaps[idx].data()?.businessKind : null;
      kindByBiz.set(b.id, raw === 'food' || raw === 'retail' ? raw : null);
    });

    const businesses = rawBusinesses.map((b) => {
      const lastSeenIso = tsToIso(b.lastSeenAt);
      const isOnline = lastSeenIso ? nowMs - Date.parse(lastSeenIso) < 120000 : false;
      const businessKind = kindByBiz.get(b.id) || null;
      return {
        id: b.id,
        name: b.name,
        code: b.code,
        access_alias: b.accessAlias || null,
        business_kind: businessKind,
        kind_pending: !businessKind,
        active: !!b.active,
        last_seen_at: lastSeenIso,
        online_users: isOnline ? 1 : 0,
        open_tickets: openByBiz.get(b.id) || 0,
        unread_tickets: unreadByBiz.get(b.id) || 0
      };
    });

    return {
      server_time: new Date().toISOString(),
      businesses,
      email: {
        explanation:
          'Notificações por e-mail estão reservadas para a última etapa; os chamados aparecem em tempo real neste painel.',
        pending: 0
      }
    };
  }

  if (path.startsWith('/platform/tickets') && !/^\/platform\/tickets\/[^/]+$/.test(path) && method === 'GET') {
    const status = new URL(path, location.origin).searchParams.get('status') || 'all';
    const snap = await getDocs(query(collectionGroup(db, 'tickets'), limit(200))).catch((err) =>
      handleFirestoreError(err, OperationType.LIST, 'tickets')
    );
    const tickets = snap.docs
      .map((d) => {
        const t = d.data();
        return {
          id: t.id,
          business_id: t.businessId,
          number: t.number,
          requester_name: t.requesterName,
          subject: t.subject,
          category: t.category,
          priority: t.priority,
          status: t.status,
          version: t.version || 1,
          last_customer_at: tsToIso(t.lastCustomerAt),
          last_support_at: tsToIso(t.lastSupportAt),
          customer_seen_at: tsToIso(t.customerSeenAt),
          support_seen_at: tsToIso(t.supportSeenAt),
          created_at: tsToIso(t.createdAt),
          updated_at: tsToIso(t.updatedAt)
        };
      })
      .filter((t) => status === 'all' || t.status === status)
      .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
    return { tickets };
  }

  const ticketMatch = path.match(/^\/platform\/tickets\/([^/]+)$/);
  if (ticketMatch) {
    const ticketId = ticketMatch[1];
    const groupSnap = await getDocs(
      query(collectionGroup(db, 'tickets'), where('id', '==', ticketId), limit(1))
    ).catch((err) => handleFirestoreError(err, OperationType.LIST, 'tickets/' + ticketId));
    if (groupSnap.empty) throw new Error('Chamado não encontrado.');
    const ticketDoc = groupSnap.docs[0];
    const t = ticketDoc.data();
    const businessId = t.businessId;
    const ticketRef = doc(db, 'businesses', businessId, 'tickets', ticketId);

    if (method === 'GET') {
      await updateDoc(ticketRef, {
        supportSeenAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }).catch(() => {});

      const msgSnap = await getDocs(
        query(collection(db, 'businesses', businessId, 'tickets', ticketId, 'messages'), orderBy('createdAt', 'asc'), limit(200))
      ).catch((err) =>
        handleFirestoreError(err, OperationType.LIST, `businesses/${businessId}/tickets/${ticketId}/messages`)
      );
      return {
        ticket: {
          id: t.id,
          business_id: t.businessId,
          number: t.number,
          requester_name: t.requesterName,
          subject: t.subject,
          category: t.category,
          priority: t.priority,
          status: t.status,
          version: t.version || 1,
          created_at: tsToIso(t.createdAt),
          updated_at: tsToIso(t.updatedAt)
        },
        messages: msgSnap.docs.map((m) => {
          const x = m.data();
          return {
            id: x.id,
            side: x.side,
            actor_name: x.actorName,
            body: x.body,
            created_at: tsToIso(x.createdAt)
          };
        }),
        truncated: msgSnap.size >= 200
      };
    }

    if (method === 'POST') {
      if (body.version && t.version !== body.version) {
        throw new Error('O chamado foi atualizado em outra aba. Recarregue antes de salvar.');
      }
      const nextStatus = ['open', 'in_progress', 'waiting_customer', 'resolved'].includes(body.status)
        ? body.status
        : t.status;
      const msgText = String(body.message || '').trim().slice(0, 4000);
      if (!msgText && nextStatus === t.status) {
        throw new Error('Escreva uma resposta ou altere a situação do chamado.');
      }
      const batch = writeBatch(db);
      const updatePayload = {
        status: nextStatus,
        supportSeenAt: serverTimestamp(),
        version: (t.version || 1) + 1,
        updatedAt: serverTimestamp()
      };
      if (msgText) {
        updatePayload.lastSupportAt = serverTimestamp();
        const msgId = crypto.randomUUID();
        batch.set(doc(db, 'businesses', businessId, 'tickets', ticketId, 'messages', msgId), {
          id: msgId,
          requestKey: String(body.request_key || crypto.randomUUID()),
          side: 'platform',
          actorUid: auth.currentUser.uid,
          actorName: auth.currentUser.displayName || 'Suporte ID Sistema',
          body: msgText,
          createdAt: serverTimestamp()
        });
      }
      batch.update(ticketRef, updatePayload);
      await batch.commit().catch((err) => handleFirestoreError(err, OperationType.WRITE, ticketRef.path));
      return { ok: true };
    }
  }

  return await window.LOGIN_API(path, options);
}

const ticketLabels = {
  open: 'Aberto',
  in_progress: 'Em andamento',
  waiting_customer: 'Aguardando cliente',
  resolved: 'Resolvido'
};
const categoryLabels = {
  error: 'Erro no sistema',
  question: 'Dúvida',
  suggestion: 'Sugestão',
  complaint: 'Reclamação'
};
let workspace = null;
let workspaceTickets = [];
let activeTicket = null;
let workspaceBusy = false;
let ticketKey = crypto.randomUUID();

const supportDate = (v) =>
  v ? new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'Nenhuma atividade registrada';

function companyName(id) {
  return businessList.find((b) => b.id === id)?.name || 'Estabelecimento';
}

function presenceOf(b) {
  if (!b.active) return { key: 'inactive', label: 'Desativada' };
  if (Number(b.online_users) > 0) return { key: 'online', label: 'Online · ' + b.online_users + ' usuário(s)' };
  if (b.last_seen_at && new Date(workspace.server_time) - new Date(b.last_seen_at) < 600000) {
    return { key: 'recent', label: 'Atividade recente' };
  }
  return { key: 'quiet', label: 'Sem atividade recente' };
}

function drawWorkspace() {
  if (!workspace) return;
  const active = businessList.filter((b) => b.active).length;
  const online = businessList.filter((b) => presenceOf(b).key === 'online').length;
  const open = businessList.reduce((n, b) => n + Number(b.open_tickets), 0);
  const unread = businessList.reduce((n, b) => n + Number(b.unread_tickets), 0);
  $('#supportStats').innerHTML = [
    ['Lojas ativas', active],
    ['Lojas online', online],
    ['Chamados pendentes', open],
    ['Chamados não lidos', unread]
  ]
    .map(([label, value]) => `<article><small>${label}</small><strong>${value}</strong></article>`)
    .join('');
  $('#workspaceUpdated').textContent =
    'Painel atualizado em ' + supportDate(workspace.server_time) + ' · Firebase conectado.';
  $('#supportEmailStatus').textContent =
    workspace.email.explanation +
    (workspace.email.pending
      ? ' Há ' + workspace.email.pending + ' aviso(s) registrado(s) para configuração posterior.'
      : '');
  drawBusinesses();
  drawTickets();
}

function drawBusinesses() {
  const search = $('#businessSearch').value.trim().toLowerCase();
  const filter = $('#presenceFilter').value;
  const rows = businessList.filter((b) => {
    const p = presenceOf(b);
    return (
      (!search || (b.name + ' ' + b.code + ' ' + (b.access_alias || '')).toLowerCase().includes(search)) &&
      (filter === 'all' || p.key === filter)
    );
  });
  $('#businesses').innerHTML = rows.length
    ? rows
        .map((b) => {
          const p = presenceOf(b);
          const kindLabel =
            b.business_kind === 'retail'
              ? 'Varejo'
              : b.business_kind === 'food'
                ? 'Alimentação'
                : 'Modalidade pendente';
          return `<div class="member-row"><div><strong>${esc(b.name)}</strong><small>Código ${esc(
            b.code
          )} · Modalidade: ${kindLabel} · <span class="presence ${p.key}">${p.label}</span></small><small>Última atividade: ${esc(
            supportDate(b.last_seen_at)
          )}</small><small>${b.open_tickets} chamado(s) pendente(s)${
            Number(b.unread_tickets) ? ' · ' + b.unread_tickets + ' não lido(s)' : ''
          }</small></div><div class="row"><button class="primary" data-workspace-open="${b.id}" ${
            b.active ? '' : 'disabled'
          }>Abrir sistema do cliente</button><button data-workspace-audit="${
            b.id
          }">Histórico</button></div></div>`;
        })
        .join('')
    : '<p>Nenhuma loja neste filtro.</p>';
}

function drawTickets() {
  const status = $('#ticketStatusFilter').value;
  const rows = workspaceTickets.filter((t) => status === 'all' || t.status === status);
  $('#platformTickets').innerHTML = rows.length
    ? rows
        .map(
          (t) =>
            `<button class="ticket-row" data-ticket-open="${t.id}"><span><strong>#${t.number} · ${esc(
              t.subject
            )}</strong><small>${esc(companyName(t.business_id))} · ${esc(t.requester_name)} · ${
              categoryLabels[t.category]
            }${t.priority === 'urgent' ? ' · URGENTE' : ''}</small><small>Atualizado: ${supportDate(
              t.updated_at
            )}</small></span><span><b class="status-tag">${ticketLabels[t.status]}</b>${
              !t.support_seen_at || (t.last_customer_at && new Date(t.last_customer_at) > new Date(t.support_seen_at))
                ? '<small class="unread">Nova mensagem</small>'
                : ''
            }</span></button>`
        )
        .join('')
    : '<p>Nenhum chamado neste filtro.</p>';
  if (workspaceTickets.length === 200) {
    $('#platformTickets').insertAdjacentHTML(
      'beforeend',
      '<p class="small">Exibindo os 200 chamados mais recentes. Selecione uma situação para consultar os demais.</p>'
    );
  }
}

loadBusinesses = async function () {
  if (workspaceBusy) return;
  workspaceBusy = true;
  try {
    const [overview, tickets] = await Promise.all([
      supportApi('/platform/workspace'),
      supportApi('/platform/tickets?status=' + $('#ticketStatusFilter').value)
    ]);
    workspace = overview;
    businessList = overview.businesses;
    workspaceTickets = tickets.tickets;
    drawWorkspace();
  } finally {
    workspaceBusy = false;
  }
};

async function enterClient(id) {
  const b = businessList.find((x) => x.id === id);
  if (!b) return;
  const data = await api('/platform/support', {
    method: 'POST',
    body: JSON.stringify({ business_id: id, purpose: 'Atendimento pela área de suporte' })
  });
  supportId = data.session.id;
  sessionStorage.setItem('support_session', supportId);
  location.assign('/system/');
}

async function openTicket(id) {
  const data = await supportApi('/platform/tickets/' + id);
  activeTicket = data.ticket;
  ticketKey = crypto.randomUUID();
  $('#ticketTitle').textContent = 'Chamado #' + data.ticket.number + ' · ' + data.ticket.subject;
  $('#ticketContext').innerHTML = `<p><strong>${esc(
    companyName(data.ticket.business_id)
  )}</strong> · ${esc(data.ticket.requester_name)}<br>${categoryLabels[data.ticket.category]} · ${
    ticketLabels[data.ticket.status]
  } · ${supportDate(data.ticket.created_at)}</p><button class="primary" data-workspace-open="${
    data.ticket.business_id
  }">Abrir sistema desta loja</button>`;
  $('#ticketMessages').innerHTML =
    data.messages
      .map(
        (m) =>
          `<article class="ticket-message ${m.side}"><small>${esc(m.actor_name)} · ${
            m.side === 'platform' ? 'Suporte' : 'Cliente'
          } · ${supportDate(m.created_at)}</small><p>${esc(m.body)}</p></article>`
      )
      .join('') +
    (data.truncated ? '<p>Mostrando as últimas 200 mensagens. O histórico anterior está preservado.</p>' : '');
  $('#ticketReplyForm').reset();
  $('#ticketReplyForm').elements.status.value = data.ticket.status;
  $('#ticketReplyForm .dialog-error').textContent = '';
  if (!$('#ticketEditor').open) $('#ticketEditor').showModal();
  await loadBusinesses();
}

$('#ticketReplyForm').onsubmit = async (e) => {
  e.preventDefault();
  if (!activeTicket) return;
  const f = e.target;
  const button = f.querySelector('button');
  button.disabled = true;
  try {
    await supportApi('/platform/tickets/' + activeTicket.id, {
      method: 'POST',
      body: JSON.stringify({
        message: f.elements.message.value,
        status: f.elements.status.value,
        version: activeTicket.version,
        request_key: ticketKey
      })
    });
    await openTicket(activeTicket.id);
    message('Atendimento atualizado. A resposta está disponível no sistema do cliente.');
  } catch (err) {
    f.querySelector('.dialog-error').textContent = err.message;
  } finally {
    button.disabled = false;
  }
};

$('#businessSearch').oninput = drawBusinesses;
$('#presenceFilter').onchange = drawBusinesses;
$('#ticketStatusFilter').onchange = () => loadBusinesses().catch((e) => message(e.message));
$('#refreshWorkspace').onclick = () => loadBusinesses().catch((e) => message(e.message));

document.addEventListener('click', async (e) => {
  const enter = e.target.closest('[data-workspace-open]');
  const ticket = e.target.closest('[data-ticket-open]');
  const history = e.target.closest('[data-workspace-audit]');
  const button = enter || ticket || history;
  if (!button) return;
  button.disabled = true;
  try {
    if (enter) await enterClient(enter.dataset.workspaceOpen);
    if (ticket) await openTicket(ticket.dataset.ticketOpen);
    if (history) {
      const data = await api('/platform/audit/' + history.dataset.workspaceAudit);
      $('#auditList').innerHTML =
        data.events
          .map(
            (ev) =>
              `<div class="member-row"><div><strong>${esc(ev.action)}</strong><small>${supportDate(
                ev.created_at
              )}</small><p>${esc(ev.details?.purpose || ev.details?.reason || '')}</p></div></div>`
          )
          .join('') || '<p>Nenhum evento registrado.</p>';
      $('#auditEditor').showModal();
    }
  } catch (err) {
    message(err.message);
  } finally {
    button.disabled = false;
  }
});

setInterval(() => {
  if (
    current?.platform &&
    !current.business &&
    !document.hidden &&
    !document.querySelector('dialog[open]')
  ) {
    loadBusinesses().catch(() => {
      $('#workspaceUpdated').textContent =
        'Não foi possível atualizar. Os dados exibidos podem estar desatualizados.';
    });
  }
}, 30000);

if (current?.platform && !current.business) loadBusinesses().catch((e) => message(e.message));
$('#refreshTicket').onclick = () => {
  if (activeTicket) openTicket(activeTicket.id).catch((e) => message(e.message));
};
