#!/usr/bin/env node
/*
 * MIGRATION (non destructive) : base d'études (criteres texte) → contraintes typées.
 *
 * Lit src/data/vocabulaire.json (dictionnaire v2) et src/data/base_etudes.json,
 * puis pour chaque étude propose une liste de contraintes typées :
 *   - catégoriel  → { critere, op:"dans", valeurs:[ids...] }
 *   - numérique   → { critere, op:"entre|<=|>=|=", ... }
 *   - oui/non     → { critere, op:"est", valeur:true|false, note?:"..." }
 *
 * NE MODIFIE PAS la base. Écrit une PROPOSITION dans scripts/out/ et imprime un
 * RAPPORT de tout ce qui ne se convertit pas proprement (rien deviné en silence).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const vocab = JSON.parse(readFileSync(join(ROOT, 'src/data/vocabulaire.json'), 'utf8'));
const base = JSON.parse(readFileSync(join(ROOT, 'src/data/base_etudes.json'), 'utf8'));

const NEUTRES = ['nc', '-1', '-1.0', 'nan', '', 'n/a', 'nr'];
const norm = s => String(s == null ? '' : s).toLowerCase().trim();
const estNeutre = v => NEUTRES.indexOf(norm(v)) !== -1;

// ── Table de résolution : par critère, token normalisé → ensemble d'ids atomiques ──
const CRIT = vocab.criteres;
const resolveur = {}; // critereId → Map(tokenNorm → Set(ids))
for (const [cid, def] of Object.entries(CRIT)) {
  if (def.type !== 'categoriel') continue;
  const table = new Map();
  const add = (tok, ids) => {
    const k = norm(tok); if (!k) return;
    if (!table.has(k)) table.set(k, new Set());
    ids.forEach(i => table.get(k).add(i));
  };
  (def.valeurs || []).forEach(v => {
    add(v.id, [v.id]);
    add(v.libelle, [v.id]);
    (v.alias || []).forEach(a => add(a, [v.id]));
  });
  Object.entries(def.groupes || {}).forEach(([g, ids]) => add(g, ids));
  // Tokens explicitement ignorés (annotations) : présents dans la table mais
  // sans id → ni résolus, ni signalés comme "non résolus".
  (def.ignorer || []).forEach(t => add(t, []));
  resolveur[cid] = table;
}

// clé ancienne base → clé vocabulaire v2
const REMAP = vocab.correspondance_anciennes_cles || {};
const cleV2 = k => REMAP[k] || k;
const IGNORER_CRIT = new Set(vocab.criteres_ignores || []);

// ── Rapport ──
const rapport = {
  criteres_inconnus: {},      // cle → [études]
  valeurs_non_resolues: {},   // "critere ▸ token" → [études]
  numeriques_non_parses: {},  // "critere ▸ valeur" → [études]
  ouinon_ambigus: {},         // "critere ▸ valeur" → [études]
  contraintes_non_discriminantes: {}, // critere → [études] (couvre toutes les valeurs → inutile)
  free_text_intervention: {}  // "critere ▸ valeur" → [études] (détail libre ignoré pour le match)
};
const note = (bucket, cle, etude) => { (rapport[bucket][cle] = rapport[bucket][cle] || []).push(etude); };

function parseNumerique(cid, brut) {
  const s = norm(brut);
  const nombre = x => parseFloat(String(x).replace(',', '.'));
  let m;
  // Intervalle "X-Y" (tolère un libellé/unité autour, ex. "Marge 10-20mm").
  if ((m = s.match(/(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)/)))
    return { critere: cid, op: 'entre', min: nombre(m[1]), max: nombre(m[2]) };
  // Comparateur "<=/>=/</>" n'importe où (ex. "Marge >10mm", "Ki67 >= 20 %").
  if ((m = s.match(/(<=|>=|<|>)\s*(\d+(?:[.,]\d+)?)/)))
    return { critere: cid, op: m[1], valeur: nombre(m[2]) };
  // Nombre seul.
  if ((m = s.match(/^(-?\d+(?:[.,]\d+)?)$/)))
    return { critere: cid, op: '=', valeur: nombre(m[1]) };
  return null;
}

const proposition = [];
base.etudes.forEach(e => {
  const nom = (e.titre || e.reference || '(sans nom)').slice(0, 60);
  const criteres = e.criteres || {};
  const contraintes = [];

  Object.keys(criteres).forEach(cleAncienne => {
    const brut = criteres[cleAncienne];
    if (estNeutre(brut)) return; // l'étude ne s'est pas prononcée
    if (IGNORER_CRIT.has(cleAncienne)) return; // annotation sans valeur de matching
    const cid = cleV2(cleAncienne);
    const def = CRIT[cid];
    if (!def) { note('criteres_inconnus', cleAncienne, nom); return; }

    if (def.type === 'numerique') {
      const c = parseNumerique(cid, brut);
      if (c) contraintes.push({ role: def.role, ...c });
      else note('numeriques_non_parses', cid + ' ▸ ' + brut, nom);
      return;
    }

    if (def.type === 'oui_non') {
      const s = norm(brut);
      const vrai = (def.vrai || []).map(norm), faux = (def.faux || []).map(norm);
      const ditOui = /(^|[,\s])oui/.test(s) || vrai.some(t => s.indexOf(t) !== -1);
      const ditNon = /(^|[,\s])non/.test(s) || faux.some(t => s.indexOf(t) !== -1);
      if (ditOui && ditNon) { note('contraintes_non_discriminantes', cid, nom); return; } // les deux bras → pas un critère d'inclusion
      if (!ditOui && !ditNon) { note('ouinon_ambigus', cid + ' ▸ ' + brut, nom); return; } // ni oui ni non reconnu
      if (/=/.test(brut) || brut.length > 12) note('free_text_intervention', cid + ' ▸ ' + brut, nom); // détail de protocole, ignoré au match
      contraintes.push({ role: def.role, critere: cid, op: 'est', valeur: ditOui });
      return;
    }

    // catégoriel : découpage par virgule, résolution token → ids
    const table = resolveur[cid];
    const tokens = String(brut).split(',').map(t => t.trim()).filter(Boolean);
    const ids = new Set();
    tokens.forEach(t => {
      const r = table.get(norm(t));
      if (r) r.forEach(i => ids.add(i));
      else note('valeurs_non_resolues', cid + ' ▸ ' + t, nom);
    });
    if (!ids.size) return;
    const total = (def.valeurs || []).length;
    if (ids.size >= total && total > 0) { note('contraintes_non_discriminantes', cid, nom); return; } // couvre tout → aucune sélection
    contraintes.push({ role: def.role, critere: cid, op: 'dans', valeurs: [...ids] });
  });

  proposition.push({ ref: nom, contraintes });
});

// ── Sorties ──
mkdirSync(join(ROOT, 'scripts/out'), { recursive: true });
writeFileSync(join(ROOT, 'scripts/out/eligibilite-proposee.json'), JSON.stringify(proposition, null, 2) + '\n');

// --apply : écrit les contraintes DANS la base (additif, garde criteres intact).
if (process.argv.includes('--apply')) {
  base.etudes.forEach((e, i) => {
    // On ne stocke pas 'role' (dérivable du dictionnaire) pour éviter toute dérive.
    e.contraintes = (proposition[i].contraintes || []).map(({ role, ...reste }) => reste);
  });
  writeFileSync(join(ROOT, 'src/data/base_etudes.json'), JSON.stringify(base, null, 4) + '\n');
  console.log('\n✍️  --apply : contraintes écrites dans src/data/base_etudes.json (criteres conservé).\n');
}

const nb = o => Object.keys(o).length;
const bloc = (titre, o) => {
  const cles = Object.keys(o);
  if (!cles.length) { console.log('  ✅ ' + titre + ' : rien.'); return; }
  console.log('  ⚠️  ' + titre + ' (' + cles.length + ') :');
  cles.sort().forEach(k => console.log('       • ' + k + '   [' + o[k].length + ' étude(s)]'));
};

console.log('\n===== MIGRATION VERS CONTRAINTES TYPÉES — RAPPORT =====');
console.log(base.etudes.length + ' études analysées. Proposition écrite : scripts/out/eligibilite-proposee.json\n');
const totalContraintes = proposition.reduce((n, p) => n + p.contraintes.length, 0);
const sansContrainte = proposition.filter(p => !p.contraintes.length).length;
console.log('Contraintes générées : ' + totalContraintes + ' sur ' + proposition.length + ' études (' + sansContrainte + ' étude(s) sans aucune contrainte).\n');

console.log('À TRANCHER (rien n\'a été deviné) :');
bloc('Critères inconnus du dictionnaire', rapport.criteres_inconnus);
bloc('Valeurs catégorielles non résolues', rapport.valeurs_non_resolues);
bloc('Valeurs numériques non parsées', rapport.numeriques_non_parses);
bloc('Oui/Non ambigus', rapport.ouinon_ambigus);
console.log('\nPOUR INFO :');
bloc('Contraintes non discriminantes (couvrent toutes les valeurs → ignorées)', rapport.contraintes_non_discriminantes);
bloc('Interventions avec détail libre (code gardé, détail ignoré au match)', rapport.free_text_intervention);
console.log('\n=======================================================\n');
