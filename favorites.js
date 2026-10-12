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

  function drawShared() {
    const list = $('overview-favorites');
    if (list) {
      const recent = sharing.slice(0, 8);
      list.innerHTML = recent.length ? recent.map(row => `
        <article class="portal-item">
          <span class="portal-org">${escapeHTML(row.orgao)}</span>
          <h3>${escapeHTML(row.titulo)}</h3>
          <div class="portal-item-bottom">
            <span>Acompanhamento coletivo</span>
            <a href="${escapeHTML(row.url)}" target="_blank" rel="noopener noreferrer">Fonte oficial ↗</a>
          </div>
        </article>`).join('') : '<div class="portal-empty">Ainda não existem editais cadastrados coletivamente. Use ☆ em um edital para começar.</div>';
    }
    if ($('shared-fav-count')) $('shared-fav-count').textContent = sharing.length.toLocaleString('pt-BR');
    if ($('portal-shared-total')) $('portal-shared-total').textContent = String(sharing.length) + ' edital(is) acompanhados';
    if ($('portal-shared-status')) $('portal-shared-status').textContent = 'Sincronizado com a seleção pública do laboratório';
  }

  async function refreshShared() {
    try {
      sharing = await request('/editais_favoritos?select=url,titulo,orgao,criado_em&ativo=eq.true&order=criado_em.desc&limit=500');
      drawShared();
    } catch (err) {
      if ($('portal-shared-status')) $('portal-shared-status').textContent = 'Não foi possível consultar os favoritos online';
      if ($('overview-favorites')) $('overview-favorites').innerHTML = '<div class="portal-empty">Favoritos online indisponíveis. Confira a conexão com o Supabase.</div>';
      console.warn('Observatório: leitura dos favoritos indisponível:', err.message);
    }
  }

  async function register(title, url) {
    if (!validURL(url)) {
      notify('Esta fonte precisa ter um endereço oficial Finep ou FAPEPI para receber acompanhamento.', 'warn');
      return false;
    }
    try {
      const id = await request('/rpc/favoritar_edital', {
        method: 'POST',
        body: JSON.stringify({p_url: url, p_titulo: String(title || 'Edital acompanhado').slice(0, 180)})
      });
      if (!Number.isInteger(id) && typeof id !== 'number') throw new Error('Resposta inesperada');
      notify('★ Edital incluído no monitoramento coletivo. Alterações relevantes serão avaliadas para alerta por e-mail.');
      await refreshShared();
      return true;
    } catch (err) {
      notify('Favorito salvo neste navegador, mas não sincronizado com o laboratório. ' + err.message, 'warn');
      return false;
    }
  }

  window.registrarAcompanhamento = register;
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
    const button = e.target.closest('[data-portal-fav]');
    if (!button) return;
    const item = radar[Number(button.dataset.portalFav)];
    if (!item) return;
    button.disabled = true;
    const ok = await register(item.title, item.url);
    button.disabled = false;
    button.textContent = ok ? '★ Acompanhado' : '☆ Acompanhar';
    if (ok) {
      const saved = new Set(JSON.parse(localStorage.getItem('observatorio_mon_favs') || '[]'));
      saved.add(item.url);
      localStorage.setItem('observatorio_mon_favs', JSON.stringify([...saved]));
      window.dispatchEvent(new Event('observatorio-favorites-changed'));
    }
  });

  // Compatibilidade com antigos favoritos locais, criados antes da integração.
  async function migrateLocalFavorites() {
    try {
      const ids = JSON.parse(localStorage.getItem('observatorio_favs') || '[]');
      const urls = JSON.parse(localStorage.getItem('observatorio_mon_favs') || '[]');
      const local = [
        ...ids.map(id => (window.observatorioCalls || []).find(x => x.id === id))
          .filter(Boolean).map(x => ({title:x.name, url:x.source})),
        ...urls.map(url => ({title: (sharing.find(x => x.url === url)?.titulo || 
                    (radar.find(x => x.url === url)?.title) || 'Edital favoritado'), url}))
      ];
      for (const item of local.slice(0, 20)) {
        if (!validURL(item.url) || sharing.some(x => x.url === item.url)) continue;
        try {
          await request('/rpc/favoritar_edital', {
            method: 'POST',
            body: JSON.stringify({p_url:item.url, p_titulo:String(item.title).slice(0, 180)})
          });
        } catch (_) {}
      }
      if (local.length) await refreshShared();
    } catch (_) {}
  }

  async function start() {
    await Promise.all([refreshShared(), loadRadar()]);
    await migrateLocalFavorites();
  }
  start();
})();
