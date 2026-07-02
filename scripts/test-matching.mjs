#!/usr/bin/env node
/*
 * Tests unitaires du moteur de correspondance (contrat.js / AtlasContrat).
 * Lancé en local et en CI. Sort en code 1 au premier échec.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { AtlasContrat: C } = require(join(ROOT, 'contrat.js'));
const schema = JSON.parse(readFileSync(join(ROOT, 'schema_criteres.json'), 'utf8'));
const MAP = schema.valeurs_synonymes, NUM = schema.criteres_numeriques, NEU = schema.valeurs_neutres;

let passed = 0, failed = 0;
function eq(nom, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) { passed++; }
  else { failed++; console.error(`❌ ${nom} : attendu ${JSON.stringify(want)}, obtenu ${JSON.stringify(got)}`); }
}

// ── estNeutre ──
eq('neutre -1', C.estNeutre('-1', schema), true);
eq('neutre nc', C.estNeutre('nc', schema), true);
eq('neutre vide', C.estNeutre('', schema), true);
eq('non neutre T2', C.estNeutre('T2', schema), false);

// ── matchCategoriel ──
eq('cat égalité', C.matchCategoriel('T2', 'T2', MAP), 1);
eq('cat synonyme HER2+/Positif', C.matchCategoriel('HER2+', 'Positif', MAP), 1);
eq('cat synonyme accents HER2-/Négatif', C.matchCategoriel('HER2-', 'Négatif', MAP), 1);
eq('cat liste N0 in "N0, N1"', C.matchCategoriel('N0', 'N0, N1', MAP), 1);
eq('cat liste pN0 in "N0, pN+"', C.matchCategoriel('N0', 'N0, pN+', MAP), 1);
eq('cat non-concordant N+/N0', C.matchCategoriel('N+', 'N0', MAP), 0);
eq('cat inconnu', C.matchCategoriel('XYZ', 'ABC', MAP), 0);

// ── matchNumerique ──
eq('num exact', C.matchNumerique('45', '45'), 1);
eq('num plage dedans', C.matchNumerique('45', '40-75'), 1);
eq('num plage dehors', C.matchNumerique('80', '40-75'), 0);
eq('num <=', C.matchNumerique('45', '<=50'), 1);
eq('num <= faux', C.matchNumerique('55', '<=50'), 0);
eq('num >', C.matchNumerique('60', '>50'), 1);
eq('num strict (pas de 0.5)', C.matchNumerique('45', '50'), 0);
eq('num vP non numérique', C.matchNumerique('abc', '40-75'), 0);

// ── valeurPatient ──
eq('vp direct', C.valeurPatient({ N: 'N0' }, 'N', {}), 'N0');
eq('vp via alias', C.valeurPatient({ 'Statut N': 'N0' }, 'N', { N: ['Statut N'] }), 'N0');
eq('vp clé normalisée', C.valeurPatient({ 'age': '45' }, 'Age', {}), '45');
eq('vp absent', C.valeurPatient({ HER2: 'HER2+' }, 'N', {}), undefined);

// ── calculerScore ──
const cfg = { mapping: MAP, numeriques: NUM, neutres: NEU, keyMapping: {} };
eq('score concordant',
  C.calculerScore({ criteres: { N: 'N0, N1', M: 'M0' } }, { N: 'N0', M: 'M0' }, cfg),
  { valeur: 100, total: 2, colonnes: ['N', 'M'], mismatches: [] });
eq('score neutre ignoré',
  C.calculerScore({ criteres: { N: 'N0', HER2: '-1' } }, { N: 'N0' }, cfg),
  { valeur: 100, total: 1, colonnes: ['N'], mismatches: [] });
eq('score sans critère comparable',
  C.calculerScore({ criteres: { Grade: '3' } }, { N: 'N0' }, cfg),
  { valeur: null, total: 0, colonnes: [], mismatches: [] });
eq('score mixte 1/2',
  C.calculerScore({ criteres: { N: 'N0', M: 'M0' } }, { N: 'N+', M: 'M0' }, cfg),
  { valeur: 50, total: 2, colonnes: ['M'], mismatches: ['N'] });
eq('score numérique Age dans plage',
  C.calculerScore({ criteres: { Age: '40-75' } }, { Age: '52' }, cfg),
  { valeur: 100, total: 1, colonnes: ['Age'], mismatches: [] });

console.log(`\n${passed} tests OK, ${failed} échec(s).`);
process.exit(failed ? 1 : 0);
