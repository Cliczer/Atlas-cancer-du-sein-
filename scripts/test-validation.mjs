#!/usr/bin/env node
/*
 * Tests du validateur strict (AtlasContrat.validerContraintesEtude /
 * validerTagsProtocole) : il DOIT refuser toute référence hors dictionnaire,
 * et accepter les données conformes. C'est le filet qui empêche une donnée
 * non-matchable d'atteindre l'application.
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
const errC = c => C.validerContraintesEtude('T', { contraintes: [c] }, dico).erreurs.length;
const errT = tree => C.validerTagsProtocole('t.json', { tree }, dico).erreurs.length;

// Refus
t('valeur catégorielle inconnue → erreur', errC({ critere: 'T', op: 'dans', valeurs: ['T1a', 'T9z'] }) > 0);
t('critère inconnu → erreur',              errC({ critere: 'Zorglub', op: 'dans', valeurs: ['x'] }) > 0);
t('op numérique sur catégoriel → erreur',  errC({ critere: 'T', op: '>=', valeur: 2 }) > 0);
t('op "dans" sans valeurs → erreur',       errC({ critere: 'T', op: 'dans', valeurs: [] }) > 0);
t('oui/non sans booléen → erreur',         errC({ critere: 'Hormonotherapie', op: 'est', valeur: 'oui' }) > 0);
t('tag arbre : valeur inconnue → erreur',
  errT({ type: 'question', titre: 'Q', choix: { A: { type: 'resultat', titre: 'R' } }, reponses: { A: { HER2: 'bleu' } } }) > 0);

// Acceptation
t('contrainte catégorielle valide → 0 erreur', errC({ critere: 'T', op: 'dans', valeurs: ['T1a', 'T2'] }) === 0);
t('contrainte numérique valide → 0 erreur',    errC({ critere: 'Ki67', op: '>=', valeur: 20 }) === 0);
t('groupe valide (N+) → 0 erreur',             errC({ critere: 'N', op: 'dans', valeurs: ['N+'] }) === 0);
t('tag arbre valide → 0 erreur',
  errT({ type: 'question', titre: 'Q', choix: { A: { type: 'resultat', titre: 'R' } }, reponses: { A: { Mutation: 'BRCA muté' } } }) === 0);

console.log(`\n${ok} tests OK, ${ko} échec(s).`);
process.exit(ko ? 1 : 0);
