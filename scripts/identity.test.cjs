const assert = require('node:assert/strict');
const id = require('../opportunity-identity.js');

const centelhaUrl = 'https://www.fapepi.pi.gov.br/edital/programa-centelha-piaui/';
const tecnovaUrl = 'https://www.fapepi.pi.gov.br/edital/programa-tecnova-piaui/';
const coopUrl = 'https://faleconosco.finep.gov.br/web/guest/w/finep-coopera-mais-brasil';

assert.deepEqual(id.extractEdition('Programa Centelha 3 Piauí', centelhaUrl),
                 {program:'centelha',edition:3});
assert.deepEqual(id.extractEdition('Programa Centelha 4 Piauí', centelhaUrl),
                 {program:'centelha',edition:4});
assert.deepEqual(id.extractEdition('Tecnova IV Piauí', tecnovaUrl),
                 {program:'tecnova',edition:4});
assert.deepEqual(id.extractEdition('Programa Criar, 4ª edição', 'https://www.fapepi.pi.gov.br/editais/'),
                 {program:'criar',edition:4});

const centelha3 = id.keyForSource(centelhaUrl, 'Centelha 3');
const centelha4 = id.keyForSource(centelhaUrl, 'Centelha 4');
const tecnova3 = id.keyForSource(tecnovaUrl, 'Tecnova 3');
const tecnova4 = id.keyForSource(tecnovaUrl, 'Tecnova 4');
assert.notEqual(centelha3,centelha4,
                'Edições do Centelha não podem compartilhar favorito');
assert.notEqual(tecnova3,tecnova4,
                'Edições do Tecnova não podem compartilhar favorito');
assert.match(centelha4,/[|]program:centelha[|]edition:4$/);
assert.match(tecnova4,/[|]program:tecnova[|]edition:4$/);

const history=[
  {id:'centelha',name:'Centelha 3 Piauí',source:centelhaUrl},
  {id:'coopict',name:'Coopera Mais ICTs',source:coopUrl},
  {id:'coopemp',name:'Coopera Mais Empresas',source:coopUrl}
];
assert.equal(id.matchCatalog(history,centelhaUrl,'Centelha 4 Piauí').length,0,
             'Nova edição na mesma URL não deve virar favorito da edição 3');
assert.equal(id.matchCatalog(history,centelhaUrl,'Centelha 3 Piauí').length,1);
assert.equal(id.matchCatalog(history,coopUrl,'Coopera Mais Brasil').length,2,
             'Modalidades diferentes não devem ser colapsadas em uma');
assert.notEqual(id.catalogKey('coopict'),id.catalogKey('coopemp'));
assert.equal(id.keyForSource('https://www.fapepi.pi.gov.br/edital/abc','Edital sem edição'),
  'source:https://www.fapepi.pi.gov.br/edital/abc');
assert.equal(id.catalogKey('centelha-4-pi-2027'),'catalog:centelha-4-pi-2027');
console.log('Identidade das oportunidades: 12 verificações aprovadas.');
