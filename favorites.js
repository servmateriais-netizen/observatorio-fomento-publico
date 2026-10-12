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
  let discovered = [];

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
  const identity = window.ObservatorioIdentity;
  if (!identity) throw new Error('Módulo de identificação das oportunidades ausente');
  const sharedKeys = () => new Set(sharing.map(row => row.chave));
  const catalogFor = (url,title) => identity.matchCatalog(window.observatorioCalls||[],url,title);
  // Preservar IDs históricos já salvos. Edições futuras promovidas ao
  // catálogo continuam com a MESMA chave dinâmica que tinham no radar.
  const legacyIds = new Set(['proninc','coopict','coopemp','mineral','eureka',
                             'regional','circular','agro','centelha','tecnova']);
  const optionsFor = (url,title) => catalogFor(url,title)
    .map(c => ({
      key: legacyIds.has(c.id) || !identity.extractEdition(c.name,c.source)
        ? identity.catalogKey(c.id)
        : identity.keyForSource(c.source,c.name),
      title:c.name,type:c.type
    })).filter(x=>x.key);
  const keyFor = (url,title) => {
    const options = optionsFor(url,title);
    return options.length===1 ? options[0].key
      : options.length===0 ? identity.keyForSource(url,title) : null;
  };
  window.getSharedFavorites = () => sharing.slice();
  window.getCatalogAlternatives = optionsFor;
  window.getOpportunityKey = keyFor;
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
  async function register(title, url, key = keyFor(url,title)) {
    if (!validURL(url)) {
      notify('Para acompanhar, o edital precisa ter um endereço Finep ou FAPEPI válido.', 'warn');
      return false;
    }
    if (!key) {
      notify('Esta publicação reúne modalidades distintas. Escolha qual deseja acompanhar.', 'warn');
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
  async function toggle(title,url,key=keyFor(url,title)) {
    if (!key) {
      notify('Selecione a modalidade específica no catálogo para acompanhar separadamente.', 'warn');
      return false;
    }
    return sharedKeys().has(key) ? unregister(key) : register(title,url,key);
  }
  window.registrarAcompanhamento = register;
  window.removerAcompanhamento = unregister;
  window.alternarFavorito = toggle;
  window.atualizarFavoritosColetivos = refreshShared;

  function drawDiscovered() {
    const target=$('catalog-discovered');
    if (!target) return;
    if ($('discovered-count')) $('discovered-count').textContent =
      discovered.length+' publicação(ões) para consulta';
    target.innerHTML=discovered.length ? discovered.map((item,index)=>{
      const edition=identity.extractEdition(item.title,item.url);
      const key=keyFor(item.url,item.title);
      const selected=sharedKeys().has(key);
      const score=Number(item.relevance?.score||0);
      const themes=(item.relevance?.themes||[]).slice(0,3);
      return `<article class="portal-radar-card">
        <div class="portal-radar-top"><span class="portal-org">${escapeHTML(item.org)}</span><span class="portal-score">
          ${edition?'Programa '+escapeHTML(edition.program)+' · Edição '+edition.edition:'Publicação identificada'} · ${score}/100
        </span></div>
        <h3>${escapeHTML(item.title)}</h3>
        <p>${escapeHTML(themes.join(' · ')||'Aderência a verificar')}
          <span class="portal-legal" style="display:block;margin-top:7px">Prazo, modalidade e elegibilidade: consultar documento oficial.</span></p>
        <div class="portal-radar-actions">
          <a href="${escapeHTML(item.url)}" target="_blank" rel="noopener noreferrer">Fonte oficial ↗</a>
          <button type="button" data-discovered-fav="${index}" aria-label="${selected?'Desfavoritar':'Favoritar'} publicação">
            ${selected?'★ Desfavoritar':'☆ Favoritar'}
          </button>
        </div>
      </article>`;
    }).join('') : '<div class="portal-empty">Nenhuma publicação adicional na última coleta disponível.</div>';
  }
  window.addEventListener('observatorio-shared-changed',drawDiscovered);

  async function loadRadar() {
    const target = $('overview-radar');
    const events = $('overview-events');
    try {
      const response = await fetch('./data/monitor.json?_=' + Date.now(), {cache: 'no-store'});
      if (!response.ok) throw new Error('Dados indisponíveis');
      const monitor = await response.json();
      const items=(monitor.items||[]).filter(item=>validURL(item.url));
      radar=items.slice(0,6);
      // O catálogo de 10 referências continua intacto; novas edições entram
      // abaixo automaticamente, mesmo quando a aderência preliminar é baixa.
      discovered=items.filter(item=>optionsFor(item.url,item.title).length===0).slice(0,100);
      drawDiscovered();
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
            const alternatives=optionsFor(item.url,item.title);
            return alternatives.length>1
              ? alternatives.map(option => `<button type="button" data-portal-fav="${index}" data-portal-key="${escapeHTML(option.key)}" aria-label="Favoritar modalidade ${option.type==='ict'?'ICTs':'Empresas'}">☆ ${option.type==='ict'?'ICTs':'Empresas'}</button>`).join('')
              : `<button type="button" data-portal-fav="${index}" data-portal-key="${escapeHTML(keyFor(item.url,item.title))}" aria-label="Favoritar edital">☆ Favoritar</button>`;
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
    const discoveredButton=e.target.closest('[data-discovered-fav]');
    if (discoveredButton) {
      const item=discovered[Number(discoveredButton.dataset.discoveredFav)];
      if (!item) return;
      discoveredButton.disabled=true;
      await toggle(item.title,item.url,keyFor(item.url,item.title));
      discoveredButton.disabled=false;
      return;
    }
    const button = e.target.closest('[data-portal-fav]');
    if (!button) return;
    const item = radar[Number(button.dataset.portalFav)];
    if (!item) return;
    button.disabled = true;
    const option=optionsFor(item.url,item.title).find(x=>x.key===button.dataset.portalKey);
    await toggle(option?.title || item.title,item.url,button.dataset.portalKey);
    button.disabled = false;
  });
  window.addEventListener('observatorio-shared-changed', () => {
    document.querySelectorAll('[data-portal-fav]').forEach(button => {
      const item = radar[Number(button.dataset.portalFav)];
      if (!item) return;
      const key=button.dataset.portalKey;
      const selected=sharedKeys().has(key);
      const option=optionsFor(item.url,item.title).find(x=>x.key===key);
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
