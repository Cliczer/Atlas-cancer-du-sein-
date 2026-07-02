#!/usr/bin/env node
/*
 * Compare l'ANCIEN moteur (calculerScore sur `criteres` texte + synonymes) et le
 * NOUVEAU (apparier sur `contraintes` typées + dictionnaire) sur des profils
 * patientes réalistes. But : prouver qu'on ne perd pas de match légitime et
 * montrer où le nouveau corrige l'ancien. Ne modifie rien.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { AtlasContrat: C } = require(join(ROOT, 'src', 'js', 'contrat.js'));
const schema = JSON.parse(readFileSync(join(ROOT, 'src/data/schema_criteres.json'), 'utf8'));
const dico   = JSON.parse(readFileSync(join(ROOT, 'src/data/vocabulaire.json'), 'utf8'));
const base   = JSON.parse(readFileSync(join(ROOT, 'src/data/base_etudes.json'), 'utf8'));

const optsAnc = { mapping: schema.valeurs_synonymes, numeriques: schema.criteres_numeriques, neutres: schema.valeurs_neutres, keyMapping: base.mapping || {} };

// Profils patientes réalistes (clés = critères d'éligibilité).
const profils = {
  'Précoce bas risque (T1a N0 RE+ Ki67 10)':      { T: 'T1a', N: 'N0', M: 'M0', RE: 'RE+', RP: 'RP+', HER2: 'HER2-', Age: '45', Ki67: '10' },
  'N+ luminal (T2 N1 RE+)':                        { T: 'T2', N: 'N1', M: 'M0', RE: 'RE+', HER2: 'HER2-', Age: '60' },
  'TNBC BRCA muté (T2 N0 Ki67 40)':                { T: 'T2', N: 'N0', M: 'M0', RE: 'RE-', RP: 'RP-', HER2: 'HER2-', Mutation: 'BRCA muté', Age: '38', Ki67: '40' },
  'Localement avancé (T4b N2)':                    { T: 'T4b', N: 'N2', M: 'M0', Age: '55' },
  'Ki67 élevé (T2 N0 Ki67 30)':                    { T: 'T2', N: 'N0', M: 'M0', Ki67: '30', Age: '50' },
  'Métastatique (M1 T3 N+)':                       { M: 'M1', T: 'T3', N: 'N+', Age: '70' }
};

const nomEtude = e => (e.titre || e.reference || '(sans nom)').slice(0, 46);
// Ancien : "affichée" si au moins un critère concorde. Nouveau : éligible ET au moins une contrainte satisfaite.
const ancienAffiche = e => { const r = C.calculerScore(e, PROFIL, optsAnc); return r.colonnes.length > 0; };
const nouveauAffiche = e => { const r = C.apparier(PROFIL, e, dico); return r.eligible && r.satisfaites.length > 0; };

let PROFIL;
let totAnc = 0, totNouv = 0, totCommun = 0;
Object.keys(profils).forEach(nom => {
  PROFIL = profils[nom];
  const anc = new Set(), nouv = new Set();
  base.etudes.forEach((e, i) => { if (ancienAffiche(e)) anc.add(i); if (nouveauAffiche(e)) nouv.add(i); });
  const communs = [...anc].filter(i => nouv.has(i));
  const ancSeul = [...anc].filter(i => !nouv.has(i));
  const nouvSeul = [...nouv].filter(i => !anc.has(i));
  totAnc += anc.size; totNouv += nouv.size; totCommun += communs.length;

  console.log('\n▓▓ ' + nom);
  console.log('   ancien: ' + anc.size + ' étude(s)   nouveau: ' + nouv.size + ' étude(s)   communes: ' + communs.length);
  if (ancSeul.length)  console.log('   ➖ ancien seul (' + ancSeul.length + ') : ' + ancSeul.map(i => nomEtude(base.etudes[i])).join(' | '));
  if (nouvSeul.length) console.log('   ➕ nouveau seul (' + nouvSeul.length + ') : ' + nouvSeul.map(i => nomEtude(base.etudes[i])).join(' | '));
});

console.log('\n===== TOTAUX =====');
console.log('affichages ancien: ' + totAnc + '   nouveau: ' + totNouv + '   en commun: ' + totCommun);
console.log('(➖ = potentiellement perdu par le nouveau — à inspecter ; ➕ = gagné/corrigé par le nouveau)\n');
