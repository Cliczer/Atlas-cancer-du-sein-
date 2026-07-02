#!/usr/bin/env node
/*
 * Tests de sérialisation arbre ⇄ graphe (AtlasContrat.treeVersGraphe / grapheVersTree).
 * - Round-trip : chaque protocole réel doit revenir identique (structure essentielle).
 * - Robustesse : un graphe avec une boucle ne doit PAS planter.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { AtlasContrat: C } = require(join(ROOT, 'contrat.js'));

let passed = 0, failed = 0;
function ok(nom, cond) { if (cond) passed++; else { failed++; console.error('❌ ' + nom); } }

// Structure essentielle (ignore les champs vides ajoutés : donnees, infos_science, source_senorif).
function norm(t) {
  if (!t || typeof t !== 'object') return t;
  const o = { type: t.type, titre: t.titre || '' };
  if (t.choix) { o.choix = {}; Object.keys(t.choix).forEach(k => { o.choix[k] = norm(t.choix[k]); }); }
  if (t.suite) o.suite = norm(t.suite);
  if (t.reponses) o.reponses = t.reponses;
  if (t.critere) o.critere = t.critere;
  return o;
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// 1. Round-trip sur tous les protocoles réels
const dir = join(ROOT, 'protocoles');
readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'index.json').forEach(f => {
  const data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const tree = data.tree || data;
  const g = C.treeVersGraphe(tree);
  const back = C.grapheVersTree(g.nodes, g.edges);
  ok('round-trip ' + f, eq(norm(tree), norm(back)));
  // IDs de nœuds déterministes : deux passes donnent les mêmes IDs
  const g2 = C.treeVersGraphe(tree);
  ok('IDs déterministes ' + f, eq(g.nodes.map(n => n.id), g2.nodes.map(n => n.id)));
});

// 2. Boucle : ne doit pas planter (stack overflow) et doit couper la boucle
const nodes = [
  { id: 'n1', type: 'question', titre: 'A' },
  { id: 'n2', type: 'question', titre: 'B' }
];
const edges = [
  { id: 'e1', source: 'n1', target: 'n2', label: 'x', valeurs: {} },
  { id: 'e2', source: 'n2', target: 'n1', label: 'y', valeurs: {} } // boucle !
];
let crash = false, tree;
try { tree = C.grapheVersTree(nodes, edges); } catch (e) { crash = true; }
ok('boucle ne plante pas', !crash);
ok('boucle coupée', JSON.stringify(tree).includes('circulaire'));

console.log(`\n${passed} tests OK, ${failed} échec(s).`);
process.exit(failed ? 1 : 0);
