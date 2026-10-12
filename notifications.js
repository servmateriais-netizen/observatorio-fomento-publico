/* Avisos do Observatório: histórico público, sino e leitura local, sem e-mail. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const STORAGE = 'observatorio_notifications_read_v1';
  const ALLOWED = new Set([
    'finep.gov.br', 'www.finep.gov.br', 'faleconosco.finep.gov.br',
    'fapepi.pi.gov.br', 'www.fapepi.pi.gov.br'
  ]);
  let events = [];
  let monitor = null;
  let checkedAt = null;
  let loadingError = false;
  let filter = 'all';
  const shown = new Set();

  function cleanURL(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && ALLOWED.has(url.hostname)
        ? url.href : '';
    } catch (_) { return ''; }
  }
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[c]);
  const date = value => {
    const time = new Date(value || '').getTime();
    return Number.isFinite(time) && time > 0
      ? new Intl.DateTimeFormat('pt-BR',{
          timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',
          year:'numeric',hour:'2-digit',minute:'2-digit'
        }).format(new Date(time)) : 'Sem registro';
  };

  function getSeen() {
    try {
      const list = JSON.parse(localStorage.getItem(STORAGE) || '[]');
      return new Set(Array.isArray(list) ? list.filter(x=>typeof x==='string') : []);
    } catch (_) { return new Set(); }
  }
  function setSeen(ids) {
    try { localStorage.setItem(STORAGE, JSON.stringify([...ids].slice(-500))); }
    catch (_) { /* Não impedir leitura com armazenamento bloqueado. */ }
  }
  const favourites = () => window.getSharedFavorites?.() || [];
  const editionOf = (title,url) => window.ObservatorioIdentity?.extractEdition(title,url);

  function relevant(event) {
    return favourites().some(fav => {
      const parent = event.parent_url || event.url;
      if (fav.url === parent || fav.url === event.url) return true;
      const e = event.program
        ? {program:event.program,edition:event.edition}
        : editionOf(event.title, event.url);
      const f = editionOf(fav.titulo, fav.url);
      return Boolean(e?.program && f?.program &&
        e.program === f.program &&
        ((event.kind || '').toLowerCase().includes('edição') ||
         e.edition === f.edition));
    });
  }
  function iconFor(event) {
    const kind = (event.kind || '').toLowerCase();
    return kind.includes('edição') ? '✳' :
           kind.includes('anexo') ? '▤' :
           kind.includes('nova chamada') ? '✦' : '↻';
  }
  function kindLabel(event) {
    const kind = String(event.kind || '').toLowerCase();
    if (kind.includes('edição')) return 'Nova edição';
    if (kind.includes('anexo')) return 'Anexo identificado';
    if (kind.includes('nova chamada')) return 'Nova chamada';
    return 'Possível alteração';
  }
  function normalize(records) {
    if (!Array.isArray(records)) return [];
    const unique = new Set();
    return records
      .filter(item => item && typeof item === 'object' && cleanURL(item.url))
      .map(item => ({
        ...item, id:String(item.id || item.key || ''),
        title:String(item.title || 'Publicação oficial').slice(0,180),
      }))
      .filter(item => {
        if (!/^[a-zA-Z0-9_-]{8,72}$/.test(item.id) || unique.has(item.id))
          return false;
        unique.add(item.id);
        return true;
      })
      .sort((a,b)=>(new Date(b.detected_at).getTime() || 0) -
                    (new Date(a.detected_at).getTime() || 0))
      .slice(0,120);
  }
  function unread() {
    const seen = getSeen();
    return events.filter(item => !seen.has(item.id));
  }
  function notifyMarkup(item) {
    const viewed = getSeen().has(item.id);
    const official = cleanURL(item.url);
    const isFav = relevant(item);
    return '<article class="site-notification '+(viewed?'is-read':'is-unread')+
      '" data-event-id="'+escapeHTML(item.id)+'">' +
      '<div class="site-notification-icon" aria-hidden="true">'+iconFor(item)+'</div>'+
      '<div class="site-notification-body">'+
      '<div class="site-notification-meta"><span>'+escapeHTML(kindLabel(item))+
      '</span>'+(isFav?'<span class="site-notification-relevant">★ Acompanhado</span>':'')+
      '<time>'+escapeHTML(date(item.detected_at))+'</time></div>'+
      '<strong>'+escapeHTML(item.title)+'</strong>'+
      '<p>Alteração identificada automaticamente. Confirme a informação no órgão responsável.</p>'+
      '<div class="site-notification-actions">'+
      '<a href="'+escapeHTML(official)+'" data-notification-visit="'+escapeHTML(item.id)+
      '" target="_blank" rel="noopener noreferrer">Consultar fonte oficial ↗</a>'+
      (!viewed?'<button type="button" data-notification-read="'+escapeHTML(item.id)+
      '">Marcar como lida</button>':'<span>Lida</span>')+
      '</div></div></article>';
  }

  function render() {
    const seen = getSeen();
    const newItems = unread();
    const favoriteEvents = events.filter(relevant);
    const badge = $('app-notify-count');
    if (badge) {
      const count = newItems.length;
      badge.textContent = count>99?'99+':String(count);
      badge.hidden = count===0;
    }
    const bell = $('app-notify-toggle');
    if (bell) bell.setAttribute('aria-label',
      newItems.length+' notificações não lidas. Abrir notificações.');
    const compact = $('app-notify-preview');
    if (compact) {
      compact.innerHTML = events.length
        ? events.slice(0,5).map(notifyMarkup).join('')
        : '<div class="portal-empty">Ainda não há novidades detectadas. Os próximos avisos aparecerão aqui após as coletas.</div>';
    }
    const all = $('notifications-feed');
    if (all) {
      const list = filter==='favorites' ? favoriteEvents : events;
      all.innerHTML = list.length ? list.map(notifyMarkup).join('')
        : '<div class="portal-empty">'+
          (filter==='favorites'
           ? 'Não há alterações registradas nos editais favoritos.'
           : 'Nenhuma alteração foi identificada nas coletas publicadas.')+
          '</div>';
    }
    if ($('app-notify-message'))
      $('app-notify-message').textContent =
        events.length ? newItems.length+' não lida(s) · '+events.length+' registro(s)' :
        'Sem novas notificações';
    if ($('notify-watched-count'))
      $('notify-watched-count').textContent=String(favourites().length);
    if ($('notify-last-scan'))
      $('notify-last-scan').textContent=date(monitor?.generated_at || checkedAt);
    if ($('notify-event-count'))
      $('notify-event-count').textContent=String(events.length);
    if ($('notify-unread-count'))
      $('notify-unread-count').textContent=String(newItems.length);
    if ($('notify-feed-status'))
      $('notify-feed-status').textContent='Avisos somente no site · e-mail desativado';
    if ($('notify-explanation'))
      $('notify-explanation').textContent=loadingError
        ? 'Não foi possível carregar a central agora. A última lista disponível permanece na tela.'
        : 'Acompanhamento automático dos editais. As novidades são exibidas aqui e no sino, sem envio de e-mails.';
    if ($('notify-detail'))
      $('notify-detail').textContent=
        'Última coleta publicada: '+date(monitor?.generated_at || checkedAt)+
        '. Os avisos indicam mudanças possíveis, não retificações confirmadas. '+
        'Atualizar esta tela consulta os dados publicados, mas não inicia uma nova varredura.';
    if ($('app-notify-checked'))
      $('app-notify-checked').textContent='Coleta: '+date(monitor?.generated_at || checkedAt);
    if ($('notify-mark-read')) $('notify-mark-read').disabled=newItems.length===0;
    if ($('app-notify-mark-read')) $('app-notify-mark-read').disabled=newItems.length===0;
    if (events.length && shown.size===0) {
      events.slice(0,5).forEach(x=>shown.add(x.id));
    }
  }
  function markRead(id) {
    const current = getSeen();
    current.add(id);
    setSeen(current);
    render();
  }
  function markAll() {
    setSeen(new Set([...getSeen(), ...events.map(x=>x.id)]));
    render();
  }
  async function fetchJSON(path) {
    const result = await fetch(path+'?v='+Date.now(),{cache:'no-store'});
    if (!result.ok) throw new Error('HTTP '+result.status);
    return result.json();
  }
  async function refresh() {
    const control = $('notify-refresh');
    if (control) {control.disabled=true;control.textContent='Consultando...';}
    const [feed,scanned] = await Promise.allSettled([
      fetchJSON('./data/notifications.json'),
      fetchJSON('./data/monitor.json')
    ]);
    loadingError = feed.status==='rejected';
    if (feed.status==='fulfilled') {
      events = normalize(feed.value.events);
      checkedAt=feed.value.generated_at;
    }
    if (scanned.status==='fulfilled') monitor=scanned.value;
    render();
    window.dispatchEvent(new Event('observatorio-notifications-updated'));
    if (control) {control.disabled=false;control.textContent='↻ Atualizar avisos';}
  }

  function setPanel(open) {
    const panel=$('app-notify-panel');
    const trigger=$('app-notify-toggle');
    if (!panel || !trigger) return;
    panel.hidden=!open;
    trigger.setAttribute('aria-expanded',String(open));
  }
  document.addEventListener('click', event => {
    const btn=event.target.closest('[data-notification-read]');
    if (btn) {
      markRead(btn.dataset.notificationRead);
      return;
    }
    const link=event.target.closest('[data-notification-visit]');
    if (link) markRead(link.dataset.notificationVisit);
    if (!event.target.closest('#app-notify-area')) setPanel(false);
  });
  document.addEventListener('keydown',e=>{
    if (e.key==='Escape') setPanel(false);
  });
  $('app-notify-toggle')?.addEventListener('click',()=>{
    const panel=$('app-notify-panel');
    setPanel(Boolean(panel?.hidden));
  });
  $('app-notify-mark-read')?.addEventListener('click',markAll);
  $('notify-mark-read')?.addEventListener('click',markAll);
  $('notify-refresh')?.addEventListener('click',async()=>{
    await Promise.all([window.atualizarFavoritosColetivos?.() || Promise.resolve(), refresh()]);
  });
  $('notify-filter')?.addEventListener('change',e=>{
    filter=e.target.value==='favorites'?'favorites':'all';
    render();
  });
  $('app-notify-all')?.addEventListener('click',()=>{
    setPanel(false);
    if (typeof window.jump==='function') window.jump('retifications');
    else location.hash='retifications';
  });
  window.atualizarCentralAlertas=refresh;
  window.addEventListener('observatorio-shared-changed',render);
  window.addEventListener('storage',event=>{
    if(event.key===STORAGE)render();
  });
  refresh();
  setInterval(refresh,90000);
})();
