/* Integração pública, sem credenciais privilegiadas. Favoritos são coletivos. */
(() => {
  'use strict';
  const config = window.OBSERVATORIO_SUPABASE || {};
  const root = (config.url || '').replace(/\/$/, '');
  const apikey = config.publishableKey || '';
  const API = root + '/rest/v1';
  const validDomains = new Set([
    'www.finep.gov.br', 'finep.gov.br', 'faleconosco.finep.gov.br',
    'www.fapepi.pi.gov.br', 'fapepi.pi.gov.br'
  ]);
  let sharing = [];
  let radar = [];

  const $ = id => document.getElementById(id);
  const escapeHTML = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);

  function validURL(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' && validDomains.has(parsed.hostname);
    } catch (_) { return false; }
  }

  function notify(message, kind = 'ok') {
    let el = $('portal-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'portal-toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.dataset.kind = kind;
    el.classList.add('visible');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => el.classList.remove('visible'), 4800);
  }

  async function request(path, init = {}) {
    if (!root || !apikey) throw new Error('Conexão pública indisponível');
    const response = await fetch(API + path, {
      ...init,
      headers: {
        'apikey': apikey,
        'Accept': 'application/json',
        ...(init.body ? {'Content-Type': 'application/json'} : {}),
        ...(init.headers || {})
      },
      cache: 'no-store'
    });
    if (!response.ok) {
      let details = '';
      try { details = (await response.json()).message || ''; } catch (_) {}
      throw new Error(details || 'HTTP ' + response.status);
    }
    return response.status === 204 ? null : response.json();
  }

  // Uma única fonte de verdade: todos os favoritos são coletivos e ficam no Supabase.
  const sharedURLs = () => new Set(sharing.map(row => row.url));
  window.getSharedFavorites = () => sharing.slice();
  window.isSharedFavorite = url => sharedURLs().has(url);
  function publishChange() {
    window.dispatchEvent(new Event('observatorio-shared-changed'));
  }
  function drawShared() {
    const list = $('overview-favorites');
    if (list) {
      list.innerHTML = sharing.length ? sharing.map(row => `
        <article class="portal-item">
          <span class="portal-org">${escapeHTML(row.orgao)}</span>
          <h3>${escapeHTML(row.titulo)}</h3>
          <div class="portal-item-bottom">
            <button type="button" data-shared-remove="${escapeHTML(row.url)}" class="portal-remove">★ Desfavoritar</button>
            <a href="${escapeHTML(row.url)}" target="_blank" rel="noopener noreferrer">Fonte oficial ↗</a>
          </div>
        </article>`).join('') : '<div class="portal-empty">Nenhum edital favoritado coletivamente. Marque ☆ em um edital.</div>';
    }
    if ($('shared-fav-count')) $('shared-fav-count').textContent = sharing.length.toLocaleString('pt-BR');
    if ($('portal-shared-total')) $('portal-shared-total').textContent = String(sharing.length) + ' edital(is) acompanhados';
    if ($('portal-shared-status')) $('portal-shared-status').textContent = 'Mesmos favoritos no catálogo, radar e acompanhamento';
    publishChange();
  }
  async function refreshShared() {
    try {
      sharing = await request('/editais_favoritos?select=url,titulo,orgao,criado_em&ativo=eq.true&order=criado_em.desc&limit=500');
      drawShared();
      return true;
    } catch (err) {
      if ($('portal-shared-status')) $('portal-shared-status').textContent = 'Falha na consulta ao Supabase';
      console.warn('Favoritos online indisponíveis:', err.message);
      return false;
    }
  }
  async function register(title, url) {
    if (!validURL(url)) {
      notify('Para acompanhar, o edital precisa ter um endereço Finep ou FAPEPI válido.', 'warn');
      return false;
    }
    try {
      await request('/rpc/favoritar_edital', {
        method: 'POST',
        body: JSON.stringify({p_url:url, p_titulo:String(title || 'Edital acompanhado').slice(0,180)})
      });
      const updated = await refreshShared();
      if (!updated) throw new Error('Não foi possível confirmar a sincronização');
      notify('★ Edital favoritado e incluído no acompanhamento automático do laboratório.');
      return true;
    } catch (err) {
      notify('Não foi possível favoritar no Supabase: ' + err.message, 'warn');
      return false;
    }
  }
  async function unregister(url) {
    if (!validURL(url)) return false;
    try {
      await request('/rpc/desfavoritar_edital', {method:'POST', body:JSON.stringify({p_url:url})});
      if (!await refreshShared()) throw new Error('Falha ao confirmar o banco');
      notify('☆ Edital removido dos favoritos coletivos.');
      return true;
    } catch (err) {
      notify('Não foi possível remover o favorito: ' + err.message, 'warn');
      return false;
    }
  }
  async function toggle(title,url) {
    return sharedURLs().has(url) ? unregister(url) : register(title,url);
  }
  window.registrarAcompanhamento = register;
  window.removerAcompanhamento = unregister;
  window.alternarFavorito = toggle;
  window.atualizarFavoritosColetivos = refreshShared;

  async function loadRadar() {
    const target = $('overview-radar');
    const events = $('overview-events');
    try {
      const response = await fetch('./data/monitor.json?_=' + Date.now(), {cache: 'no-store'});
      if (!response.ok) throw new Error('Dados indisponíveis');
      const monitor = await response.json();
      radar = (monitor.items || []).filter(item => validURL(item.url)).slice(0, 6);
      if ($('portal-updated')) {
        const at = monitor.generated_at ? new Date(monitor.generated_at) : null;
        $('portal-updated').textContent = at && !Number.isNaN(at.getTime())
          ? new Intl.DateTimeFormat('pt-BR', {timeZone:'America/Sao_Paulo', dateStyle:'short', timeStyle:'short'}).format(at) + ' (Brasília)'
          : 'Aguardando coleta';
      }
      if ($('portal-source-count')) $('portal-source-count').textContent = String(monitor.checked_pages || 0);
      if (target) target.innerHTML = radar.length ? radar.map((item, index) => {
        const score = Number(item.relevance?.score || 0);
        const level = score >= 65 ? 'Alta' : score >= 35 ? 'Média' : 'Baixa';
        return `<article class="portal-radar-card">
          <div class="portal-radar-top"><span class="portal-org">${escapeHTML(item.org)}</span><span class="portal-score">${escapeHTML(level)} aderência · ${score}/100</span></div>
          <h3>${escapeHTML(item.title)}</h3>
          <p>${escapeHTML((item.relevance?.themes || []).slice(0, 3).join(' · ') || 'Acompanhamento preliminar')}</p>
          <div class="portal-radar-actions"><a href="${escapeHTML(item.url)}" target="_blank" rel="noopener noreferrer">Ler fonte oficial ↗</a><button type="button" data-portal-fav="${index}" aria-label="Adicionar ao acompanhamento coletivo">☆ Acompanhar</button></div>
        </article>`;
      }).join('') : '<div class="portal-empty">Nenhum edital disponível na última coleta.</div>';
      const changes = (monitor.events || []).slice(0, 4);
      if (events) events.innerHTML = changes.length ? changes.map(e => `<div class="portal-event"><strong>${escapeHTML(e.title)}</strong><span>${escapeHTML(e.kind)} · confira a fonte oficial</span></div>`).join('')
        : '<div class="portal-empty">Nenhuma alteração recente identificada. O monitoramento continua ativo quando o coletor executa.</div>';
    } catch (error) {
      if (target) target.innerHTML = '<div class="portal-empty">Não foi possível carregar o radar agora.</div>';
      if (events) events.innerHTML = '<div class="portal-empty">Aguardando atualização das fontes.</div>';
    }
  }

  document.addEventListener('click', async e => {
    const remove = e.target.closest('[data-shared-remove]');
    if (remove) {
      remove.disabled = true;
      await unregister(remove.dataset.sharedRemove);
      remove.disabled = false;
      return;
    }
    const button = e.target.closest('[data-portal-fav]');
    if (!button) return;
    const item = radar[Number(button.dataset.portalFav)];
    if (!item) return;
    button.disabled = true;
    await toggle(item.title,item.url);
    button.disabled = false;
  });
  window.addEventListener('observatorio-shared-changed', () => {
    document.querySelectorAll('[data-portal-fav]').forEach(button => {
      const item = radar[Number(button.dataset.portalFav)];
      if (!item) return;
      const selected=sharedURLs().has(item.url);
      button.textContent=selected?'★ Desfavoritar':'☆ Favoritar';
      button.setAttribute('aria-label',selected?'Desfavoritar edital':'Favoritar edital');
    });
  });

  async function start() {
    await Promise.all([refreshShared(), loadRadar()]);
    publishChange();
  }
  start();
  // Atualiza a lista compartilhada em abas abertas a cada dois minutos.
  setInterval(refreshShared, 120000);
})();
