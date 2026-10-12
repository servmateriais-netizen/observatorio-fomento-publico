// Consulta simples para validar a API e reduzir risco de pausa por inatividade.
// Não contorna os limites do plano gratuito nem garante disponibilidade.
const fs = require('node:fs');
const vm = require('node:vm');
const sandbox = {window: {}};
vm.runInNewContext(fs.readFileSync('./supabase-config.js', 'utf8'), sandbox);
const config = sandbox.window.OBSERVATORIO_SUPABASE;
if (!config?.url || !config?.publishableKey) throw new Error('Configuração pública ausente');
const u = config.url.replace(/\/$/, '') + '/rest/v1/editais_favoritos?select=id&limit=1';
(async () => {
  const res = await fetch(u, {
    headers: {'apikey': config.publishableKey, 'Accept': 'application/json'},
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new Error('Supabase HTTP ' + res.status + ': ' + body);
  }
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('Resultado Supabase inválido');
  console.log('Supabase acessível: consulta realizada com sucesso.');
})().catch(e => {console.error(e.message); process.exitCode = 1;});
