/* Central pública de notificações: dados confirmados, sem credenciais privadas. */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  let monitor = null;
  let mail = null;
  let hasError = false;
  const date = value => {
    if (!value) return 'Sem registro';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? 'Data indisponível' :
      new Intl.DateTimeFormat('pt-BR',{
        timeZone:'America/Sao_Paulo',
        day:'2-digit',month:'2-digit',year:'numeric',
        hour:'2-digit',minute:'2-digit'
      }).format(d);
  };
  const isFresh = (value, hours=36) => {
    const time = new Date(value || '').getTime();
    return Number.isFinite(time) && Date.now() >= time && Date.now()-time < hours*3600000;
  };
  const set = (id, value) => { if ($(id)) $(id).textContent = value; };
  const registered = () => window.getSharedFavorites?.() || [];

  function render() {
    const favorites = registered();
    const events = Array.isArray(monitor?.events) ? monitor.events : [];
    const monitored = new Set(favorites.map(e => e.url));
    const matching = events.filter(e => {
      const url = e.url || '';
      return monitored.has(url) || favorites.some(f =>
        (url.startsWith(f.url + '/') || e.title?.includes(f.titulo)) && f.titulo?.length > 12);
    });
    set('notify-watched-count',String(favorites.length));
    set('notify-last-scan',date(monitor?.generated_at));
    set('notify-event-count',String(matching.length));
    set('notify-last-mail','Último envio registrado: '+date(mail?.last_sent_at));

    const fresh = isFresh(mail?.checked_at);
    let state = 'Sem confirmação de envio';
    let explanation = '';
    if (!fresh || mail?.status === 'aguardando_sincronizacao') {
      explanation = 'Não há um relatório recente de envio publicado no site. Um teste de Gmail isolado não comprova que os alertas automáticos estejam funcionando.';
    } else if (mail.status === 'sem_novidades') {
      state = 'Ativo · sem novidades';
      explanation = 'Na última verificação registrada não havia alertas novos para enviar. Um e-mail só é gerado quando aparece uma alteração relevante.';
    } else if (mail.status === 'enviado') {
      state = 'Envio SMTP registrado';
      explanation = 'A última execução registrou o envio de '+String(mail.sent_this_run || 0)+' aviso(s) ao servidor de e-mail. A entrega à caixa de entrada não é comprovada por este painel.';
    } else if (mail.status === 'falha') {
      state = 'Falha no envio';
      explanation = 'O envio SMTP falhou na última execução registrada. É preciso conferir o monitoramento privado.';
    } else if (mail.status === 'desativado') {
      state = 'Envio não configurado';
      explanation = 'A última execução publicada não encontrou configuração de envio por e-mail. Se ela foi atualizada depois, precisamos de uma nova coleta e sincronização.';
    }

    set('notify-mail-status',state);
    const freshScan = isFresh(monitor?.generated_at);
    const scanNote = monitor?.generated_at ?
      'Última coleta publicada: '+date(monitor.generated_at)+'. '+
      (freshScan ? 'O resultado é recente.' : 'Os dados estão antigos e podem não refletir as mudanças atuais.') :
      'A coleta ainda não tem data confirmada.';
    const changeNote = matching.length ?
      ' Foram registradas '+matching.length+' possível(is) mudança(s) em editais favoritados. Confira os detalhes abaixo.' :
      ' Não há novas alterações registradas para os favoritos nos dados publicados.';
    set('notify-explanation',explanation);
    set('notify-detail',scanNote+changeNote+
      ' Atualizar esta página não executa uma nova varredura nos sites oficiais.'+
      (hasError?' A consulta de dados apresentou falha; tente novamente.':''));

    if ($('notify-mail-status')) {
      $('notify-mail-status').dataset.state =
        fresh && mail?.status==='falha' ? 'bad' :
        fresh && mail?.status==='enviado' ? 'ok' :
        fresh && mail?.status==='sem_novidades' ? 'ok' : 'warn';
    }
  }

  async function fetchJSON(path) {
    const response = await fetch(path + '?v=' + Date.now(),{cache:'no-store'});
    if (!response.ok) throw new Error('Erro HTTP '+response.status);
    return response.json();
  }
  async function refresh() {
    const button = $('notify-refresh');
    if(button){button.disabled=true;button.textContent='Consultando...';}
    const results = await Promise.allSettled([
      fetchJSON('./data/monitor.json'),
      fetchJSON('./data/email_status.json')
    ]);
    hasError = results.some(x => x.status==='rejected');
    if (results[0].status==='fulfilled') monitor=results[0].value;
    if (results[1].status==='fulfilled') mail=results[1].value;
    render();
    if(button){button.disabled=false;button.textContent='↻ Atualizar informações';}
  }

  window.atualizarCentralAlertas = refresh;
  window.addEventListener('observatorio-shared-changed',render);
  $('notify-refresh')?.addEventListener('click',async()=>{
    await Promise.all([
      window.atualizarFavoritosColetivos?.() || Promise.resolve(),
      refresh()
    ]);
  });
  refresh();
})();
