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

  // Uma única fonte de verdade: a identidade é a oportunidade, não a URL.
  const sharedKeys = () => new Set(sharing.map(row => row.chave));
  const catalogFor = url => (window.observatorioCalls || []).filter(c => c.source === url);
  const optionsFor = url => catalogFor(url).map(c => ({key:'catalog:'+c.id,title:c.name,type:c.type}));
  const keyFor = url => {
    const options = optionsFor(url);
    return options.length === 1 ? options[0].key
      : options.length === 0 ? 'source:'+url : null;
  };
  window.getSharedFavorites = () => sharing.slice();
  window.getCatalogAlternatives = optionsFor;
  window.isSharedFavorite = key => sharedKeys().has(key);
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
            <button type="button" data-shared-remove="${escapeHTML(row.chave)}" class="portal-remove">★ Desfavoritar</button>
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
      sharing = await request('/editais_favoritos?select=chave,url,titulo,orgao,criado_em&ativo=eq.true&order=criado_em.desc&limit=500');
      drawShared();
      return true;
    } catch (err) {
      if ($('portal-shared-status')) $('portal-shared-status').textContent = 'Falha na consulta ao Supabase';
      console.warn('Favoritos online indisponíveis:', err.message);
      return false;
    }
  }
  async function register(title, url, key = keyFor(url)) {
    if (!validURL(url)) {
      notify('Para acompanhar, o edital precisa ter um endereço Finep ou FAPEPI válido.', 'warn');
      return false;
    }
    if (!key) {
      notify('O Coopera Mais Brasil possui modalidades distintas. Escolha ICTs ou Empresas no catálogo.', 'warn');
      return false;
    }
    try {
      await request('/rpc/favoritar_oportunidade', {
        method:'POST',
        body:JSON.stringify({p_chave:key,p_url:url,p_titulo:String(title||'Edital acompanhado').slice(0,180)})
      });
      if (!await refreshShared()) throw new Error('Não foi possível confirmar a sincronização');
      notify('★ Oportunidade favoritada e incluída no acompanhamento automático do laboratório.');
      return true;
    } catch (err) {
      notify('Não foi possível favoritar no Supabase: '+err.message, 'warn');
      return false;
    }
  }
  async function unregister(key) {
    if (!key) return false;
    try {
      await request('/rpc/desfavoritar_oportunidade', {
        method:'POST',
        body:JSON.stringify({p_chave:key})
      });
      if (!await refreshShared()) throw new Error('Não foi possível confirmar a sincronização');
      notify('☆ Oportunidade removida dos favoritos coletivos.');
      return true;
    } catch (err) {
      notify('Não foi possível remover o favorito: '+err.message, 'warn');
      return false;
    }
  }
  async function toggle(title,url,key=keyFor(url)) {
    if (!key) {
      notify('Escolha a modalidade ICTs ou Empresas no catálogo para acompanhar separadamente.', 'warn');
      return false;
    }
    return sharedKeys().has(key) ? unregister(key) : register(title,url,key);
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
          <div class="portal-radar-actions"><a href="${escapeHTML(item.url)}" target="_blank" rel="noopener noreferrer">Ler fonte oficial ↗</a><div class="portal-radar-options">${(() => {
            const alternatives=optionsFor(item.url);
            return alternatives.length>1
              ? alternatives.map(option => `<button type="button" data-portal-fav="${index}" data-portal-key="${escapeHTML(option.key)}" aria-label="Favoritar modalidade ${option.type==='ict'?'ICTs':'Empresas'}">☆ ${option.type==='ict'?'ICTs':'Empresas'}</button>`).join('')
              : `<button type="button" data-portal-fav="${index}" data-portal-key="${escapeHTML(keyFor(item.url))}" aria-label="Favoritar edital">☆ Favoritar</button>`;
          })()}</div></div>
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
    const option=optionsFor(item.url).find(x=>x.key===button.dataset.portalKey);
    await toggle(option?.title || item.title,item.url,button.dataset.portalKey);
    button.disabled = false;
  });
  window.addEventListener('observatorio-shared-changed', () => {
    document.querySelectorAll('[data-portal-fav]').forEach(button => {
      const item = radar[Number(button.dataset.portalFav)];
      if (!item) return;
      const key=button.dataset.portalKey;
      const selected=sharedKeys().has(key);
      const option=optionsFor(item.url).find(x=>x.key===key);
      const suffix=option ? (option.type==='ict'?'ICTs':'Empresas') : 'Favoritar';
      button.textContent=selected ? '★ '+(option ? suffix : 'Desfavoritar') : '☆ '+suffix;
      button.setAttribute('aria-label',(selected?'Desfavoritar ':'Favoritar ')+(option?('modalidade '+suffix):'edital'));
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
