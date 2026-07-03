#!/usr/bin/env node
/*
 * Validation du contrat de données de l'écosystème Atlas.
 * Lancé en local (`node scripts/valider.mjs`) et en CI (GitHub Actions).
 * Sort en code 1 dès qu'une ERREUR est trouvée → un JSON cassé ne peut pas
 * atteindre la branche principale ni l'application clinique.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'src', 'data'); // données déplacées sous src/data/
const { AtlasContrat } = require(join(ROOT, 'src', 'js', 'contrat.js'));

function lire(p) {
  try { return JSON.parse(readFileSync(join(DATA, p), 'utf8')); }
  catch (e) { return { __erreurLecture: `${p} : JSON illisible — ${e.message}` }; }
}

let erreurs = [], avert = [];
function collecter(res) { if (res.erreurs) erreurs.push(...res.erreurs); if (res.avertissements) avert.push(...res.avertissements); }

// 1. Dictionnaire typé (vocabulaire.json) — la seule source de vocabulaire
const dico = lire('vocabulaire.json');
if (dico.__erreurLecture) erreurs.push(dico.__erreurLecture);

// 2. Base d'études (structure + contraintes typées contre le dictionnaire)
const base = lire('base_etudes.json');
if (base.__erreurLecture) erreurs.push(base.__erreurLecture);
else {
  collecter(AtlasContrat.validerBase(base));
  if (!dico.__erreurLecture) (base.etudes || []).forEach((e, i) => {
    const nom = (e && (e.titre || e.reference)) || ('#' + (i + 1));
    collecter(AtlasContrat.validerContraintesEtude(nom, e, dico));
  });
}

// 3. Registre + protocoles
const registre = lire('protocoles/index.json');
if (registre.__erreurLecture) {
  erreurs.push(registre.__erreurLecture);
} else {
  const listes = (registre.protocoles || []);
  listes.forEach((p) => {
    if (!p.fichier) { erreurs.push(`protocoles/index.json : entrée sans "fichier".`); return; }
    const chemin = `protocoles/${p.fichier}`;
    if (!existsSync(join(DATA, chemin))) { erreurs.push(`protocoles/index.json référence "${p.fichier}" mais le fichier est absent.`); return; }
    const data = lire(chemin);
    if (data.__erreurLecture) erreurs.push(data.__erreurLecture);
    else {
      collecter(AtlasContrat.validerProtocole(p.fichier, data));
      if (!dico.__erreurLecture) collecter(AtlasContrat.validerTagsProtocole(p.fichier, data, dico));
    }
  });
  // Protocoles présents mais non listés dans le registre
  const listés = new Set(listes.map((p) => p.fichier));
  readdirSync(join(DATA, 'protocoles')).filter((f) => f.endsWith('.json') && f !== 'index.json').forEach((f) => {
    if (!listés.has(f)) avert.push(`protocoles/${f} présent mais absent de index.json (invisible dans l'app).`);
  });
}

// Rapport
if (avert.length) { console.log('⚠️  Avertissements :'); avert.forEach((m) => console.log('   - ' + m)); }
if (erreurs.length) {
  console.error('\n❌ Contrat de données INVALIDE :');
  erreurs.forEach((m) => console.error('   - ' + m));
  process.exit(1);
}
console.log(`\n✅ Contrat de données valide (${(base.etudes || []).length} études, ${(registre.protocoles || []).length} protocoles, ${avert.length} avertissement(s)).`);
