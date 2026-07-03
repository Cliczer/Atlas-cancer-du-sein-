#!/usr/bin/env node
/*
 * Tests du moteur v2 déterministe (AtlasContrat.apparier) sur le dictionnaire
 * typé. Couvre les cas qui cassaient l'ancien moteur (Ki67 numérique, casse/
 * alias), plus ensembles, groupes, intervalles, oui/non, indéterminé.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { AtlasContrat: C } = require(join(ROOT, 'src', 'js', 'contrat.js'));
const dico = JSON.parse(readFileSync(join(ROOT, 'src/data/vocabulaire.json'), 'utf8'));

let ok = 0, ko = 0;
function t(nom, cond) { if (cond) ok++; else { ko++; console.error('❌ ' + nom); } }
const app = (profil, contraintes) => C.apparier(profil, { contraintes }, dico);

// 1. Ensemble catégoriel
t('T dans {T1a,T2} : patiente T1a → satisfaite',
  app({ T: 'T1a' }, [{ critere: 'T', op: 'dans', valeurs: ['T1a', 'T2'] }]).satisfaites.length === 1);
t('T dans {T1a,T2} : patiente T3 → violée (non éligible)',
  app({ T: 'T3' }, [{ critere: 'T', op: 'dans', valeurs: ['T1a', 'T2'] }]).eligible === false);

// 2. Groupe étendu (T1 = T1a/T1b/T1c)
t('T dans {T1} (groupe) : patiente T1b → satisfaite',
  app({ T: 'T1b' }, [{ critere: 'T', op: 'dans', valeurs: ['T1'] }]).satisfaites.length === 1);
t('N+ (groupe) : patiente N1 → satisfaite',
  app({ N: 'N1' }, [{ critere: 'N', op: 'dans', valeurs: ['N+'] }]).eligible === true);

// 2b. Sémantique ensembliste prudente : valeur patiente = GROUPE
t('patiente N+ (groupe) vs étude {N1 seul} → INDÉTERMINÉ (pas de faux positif)',
  app({ N: 'N+' }, [{ critere: 'N', op: 'dans', valeurs: ['N1'] }]).indeterminees.length === 1);
t('patiente N+ (groupe) vs étude {N1 seul} → NON satisfaite',
  app({ N: 'N+' }, [{ critere: 'N', op: 'dans', valeurs: ['N1'] }]).satisfaites.length === 0);
t('patiente N+ (groupe) vs étude {N+} (couvre tout) → satisfaite',
  app({ N: 'N+' }, [{ critere: 'N', op: 'dans', valeurs: ['N+'] }]).satisfaites.length === 1);
t('patiente N+ (groupe) vs étude {N0 seul} → violée',
  app({ N: 'N+' }, [{ critere: 'N', op: 'dans', valeurs: ['N0'] }]).violees.length === 1);

// 2c. Critère d'INTERVENTION : ignoré pour l'éligibilité (pas dans le profil)
var ri = app({ T: 'T2' }, [{ critere: 'Chirurgie_axillaire', op: 'dans', valeurs: ['CA'] }]);
t('contrainte intervention → ni satisfaite, ni violée, ni indéterminée',
  ri.satisfaites.length === 0 && ri.violees.length === 0 && ri.indeterminees.length === 0);

// 3. Alias + casse (le bug de l'ancien moteur)
t('RE dans {RE+} : patiente "positif" (alias, minuscule) → satisfaite',
  app({ RE: 'positif' }, [{ critere: 'RE', op: 'dans', valeurs: ['RE+'] }]).satisfaites.length === 1);
t('Mutation dans {BRCA_mute} : patiente "BRCA1" → satisfaite',
  app({ Mutation: 'BRCA1' }, [{ critere: 'Mutation', op: 'dans', valeurs: ['BRCA_mute'] }]).eligible === true);

// 4. Intervalle numérique — Ki67 (cassé avant : traité en texte)
t('Ki67 >= 20 : patiente 30 → satisfaite',
  app({ Ki67: '30' }, [{ critere: 'Ki67', op: '>=', valeur: 20 }]).satisfaites.length === 1);
t('Ki67 >= 20 : patiente 10 → violée',
  app({ Ki67: 10 }, [{ critere: 'Ki67', op: '>=', valeur: 20 }]).eligible === false);
t('Age entre 40-75 : patiente 50 → satisfaite',
  app({ Age: 50 }, [{ critere: 'Age', op: 'entre', min: 40, max: 75 }]).satisfaites.length === 1);
t('Age entre 40-75 : patiente 80 → violée',
  app({ Age: 80 }, [{ critere: 'Age', op: 'entre', min: 40, max: 75 }]).eligible === false);

// 5. Oui/Non (intervention) : ignoré pour l'éligibilité, même si le profil le porte
t('Chimio_neoadjuvante (intervention) → ignorée, jamais satisfaite',
  app({ Chimio_neoadjuvante: 'Oui' }, [{ critere: 'Chimio_neoadjuvante', op: 'est', valeur: true }]).satisfaites.length === 0);

// 6. Indéterminé (critère non renseigné par la patiente) : ne bloque pas, remonté
var r = app({ T: 'T2' }, [{ critere: 'N', op: 'dans', valeurs: ['N0'] }]);
t('N non renseigné → indéterminé (pas violé)', r.indeterminees.length === 1 && r.violees.length === 0);
t('N non renseigné → reste éligible', r.eligible === true);

// 7. Concordance = satisfaites / (satisfaites + violées), indéterminés exclus
var r2 = app({ T: 'T2', M: 'M0' }, [
  { critere: 'T', op: 'dans', valeurs: ['T2'] },
  { critere: 'M', op: 'dans', valeurs: ['M1'] },
  { critere: 'N', op: 'dans', valeurs: ['N0'] }
]);
t('concordance 1 sat / 1 vio (N indéterminé exclu) = 50', r2.concordance === 50);

console.log(`\n${ok} tests OK, ${ko} échec(s).`);
process.exit(ko ? 1 : 0);
