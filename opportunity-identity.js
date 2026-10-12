/* Identidade estável da oportunidade: programa + edição + modalidade.
 * O URL indica a fonte oficial, mas não define sozinho o favorito.
 * Disponível no navegador e em testes Node, sem dependências.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ObservatorioIdentity = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const normalize = value => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
  const roman = {i:1,ii:2,iii:3,iv:4,v:5,vi:6,vii:7,viii:8,ix:9,x:10};
  function editionNumber(raw) {
    const value = normalize(raw);
    return /^[1-9]\d{0,2}$/.test(value) ? Number(value) : (roman[value] || null);
  }
  function slug(value) {
    return normalize(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0,60);
  }
  function safeDecoded(url) {
    try { return decodeURIComponent(url); } catch (_) { return String(url || ''); }
  }

  function extractEdition(title, url) {
    // Os programas podem aparecer com números arábicos ou romanos:
    // "Centelha 4", "Tecnova IV", "programa-centelha-4-piaui".
    const text = normalize(String(title || '') + ' ' + safeDecoded(url));
    const named = text.match(/(?:^|[^a-z0-9])(centelha|tecnova)[\s\-_/.:]*(?:n[º°.]?\s*)?([1-9]\d{0,2}|viii|vii|vi|iv|iii|ii|ix|v|i|x)(?=$|[^a-z0-9])/i);
    if (named) {
      const edition = editionNumber(named[2]);
      if (edition) return {program: slug(named[1]), edition};
    }
    // Programa "Nome", 4ª edição (para novos programas além dos dois acima).
    const generic = text.match(/\bprograma\s+([a-z][a-z0-9 -]{2,42}?)\s*(?:[,:\-]\s*|\s+)([1-9]\d{0,2})\s*(?:a|o|ª|º)?\s*edicao\b/);
    if (generic) {
      const program = slug(generic[1]), edition = editionNumber(generic[2]);
      if (program && edition) return {program, edition};
    }
    return null;
  }

  function keyForSource(url, title) {
    if (typeof url !== 'string' || !url.startsWith('https://')) return null;
    const version = extractEdition(title,url);
    return version
      ? 'source:' + url + '|program:' + version.program + '|edition:' + version.edition
      : 'source:' + url;
  }

  function matchCatalog(catalog, url, title) {
    const matches=(catalog || []).filter(item => item.source === url);
    const detected = extractEdition(title,url);
    if (!detected) return matches;
    return matches.filter(item => {
      const known=extractEdition(item.name, item.source);
      // A mesma página pode passar a anunciar uma edição nova;
      // nesse caso não reaproveitar o favorito antigo.
      return !known || (known.program === detected.program && known.edition === detected.edition);
    });
  }

  function catalogKey(id) {
    const normalized=String(id || '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9_-]{1,90}$/.test(normalized)) return null;
    return 'catalog:'+normalized;
  }
  return {normalize, extractEdition, keyForSource, matchCatalog, catalogKey};
});
