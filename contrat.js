/*
 * contrat.js — Contrat de données partagé de l'écosystème Atlas cancer du sein.
 *
 * Source UNIQUE de la logique de validation, utilisée à la fois :
 *   - côté navigateur (application + éditeurs) via la globale window.AtlasContrat ;
 *   - côté Node (script de validation + CI GitHub) via module.exports.
 *
 * But : aucune donnée non conforme ne doit être servie en silence. Toute
 * incohérence (clé manquante, type invalide, tag de critère inconnu, valeur
 * hors vocabulaire, fichier de protocole cassé) est remontée sous forme de
 * message clair — bloquant en CI, visible dans l'UI.
 */
(function (root) {
  'use strict';

  var TYPES_NŒUDS = ['question', 'etape', 'resultat', 'numerique'];

  // Valeurs « neutres » : l'étude ne s'est pas prononcée sur ce critère.
  // Peut être surchargé par schema.valeurs_neutres.
  var NEUTRES_DEFAUT = ['nc', '-1', '-1.0', 'nan', '', 'n/a', 'nr'];

  function normaliser(v) {
    if (v === null || v === undefined) return '';
    return String(v).toLowerCase().trim();
  }

  function estNeutre(v, schema) {
    var liste = (schema && Array.isArray(schema.valeurs_neutres)) ? schema.valeurs_neutres : NEUTRES_DEFAUT;
    return liste.indexOf(normaliser(v)) !== -1;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c];
    });
  }

  function estObjet(x) { return x && typeof x === 'object' && !Array.isArray(x); }

  // ── Validation du schéma lui-même ────────────────────────────────────────
  function validerSchema(schema) {
    var err = [];
    if (!estObjet(schema)) return { ok: false, erreurs: ['schema_criteres.json : racine JSON invalide (objet attendu).'] };
    if (!estObjet(schema.criteres)) err.push('schema_criteres.json : clé "criteres" manquante ou invalide.');
    if (!estObjet(schema.valeurs_synonymes)) err.push('schema_criteres.json : clé "valeurs_synonymes" manquante ou invalide.');
    if (!Array.isArray(schema.criteres_numeriques)) err.push('schema_criteres.json : clé "criteres_numeriques" manquante ou invalide.');
    if (estObjet(schema.criteres)) {
      Object.keys(schema.criteres).forEach(function (id) {
        var def = schema.criteres[id];
        if (!estObjet(def)) { err.push('Critère "' + id + '" : définition invalide.'); return; }
        if (def.type !== 'categoriel' && def.type !== 'numerique')
          err.push('Critère "' + id + '" : "type" doit être "categoriel" ou "numerique".');
        if (def.type === 'categoriel' && !Array.isArray(def.valeurs))
          err.push('Critère "' + id + '" (catégoriel) : "valeurs" (liste) manquante.');
      });
    }
    return { ok: err.length === 0, erreurs: err };
  }

  // Un critère catégoriel connaît-il cette valeur ? (valeur canonique OU synonyme,
  // insensible à la casse et aux accents non gérés — comparaison brute normalisée).
  function valeurConnue(critereId, valeur, schema) {
    var def = schema.criteres && schema.criteres[critereId];
    if (!def || def.type === 'numerique') return true;
    var nv = normaliser(valeur);
    if (Array.isArray(def.valeurs) && def.valeurs.map(normaliser).indexOf(nv) !== -1) return true;
    // tolérance : la valeur est une clé/synonyme connu du dictionnaire global
    var syn = schema.valeurs_synonymes || {};
    if (Object.prototype.hasOwnProperty.call(syn, valeur)) return true;
    var cles = Object.keys(syn);
    for (var i = 0; i < cles.length; i++) {
      if (normaliser(cles[i]) === nv) return true;
      if (syn[cles[i]].map(normaliser).indexOf(nv) !== -1) return true;
    }
    return false;
  }

  // ── Validation de la base d'études ───────────────────────────────────────
  function validerBase(base, schema) {
    var err = [], avert = [];
    if (!estObjet(base)) return { ok: false, erreurs: ['base_etudes.json : racine JSON invalide (objet attendu).'], avertissements: [] };
    var etudes = base.etudes;
    if (!Array.isArray(etudes)) return { ok: false, erreurs: ['base_etudes.json : clé "etudes" (liste) manquante.'], avertissements: [] };

    etudes.forEach(function (e, i) {
      var nom = (e && (e.titre || e.reference)) || ('#' + (i + 1));
      if (!estObjet(e)) { err.push('Étude #' + (i + 1) + ' : objet attendu.'); return; }
      if (!(e.titre && String(e.titre).trim()) && !(e.reference && String(e.reference).trim() && e.reference !== '-1'))
        avert.push('Étude "' + nom + '" : ni titre ni référence renseignés.');
      // null est toléré partout (traité comme "absent" par l'app) → simple avertissement.
      if (e.criteres != null && !estObjet(e.criteres))
        err.push('Étude "' + nom + '" : "criteres" doit être un objet.');
      // Résultats chiffrés : nouveau format "comparaisons" (liste) ou ancien "comparaison" (objet).
      if (e.comparaisons != null && !Array.isArray(e.comparaisons))
        err.push('Étude "' + nom + '" : "comparaisons" doit être une liste.');
      if (e.comparaison != null && !estObjet(e.comparaison))
        err.push('Étude "' + nom + '" : "comparaison" doit être un objet.');
      var aDesComparaisons = (Array.isArray(e.comparaisons) && e.comparaisons.length) || estObjet(e.comparaison);
      if (!aDesComparaisons)
        avert.push('Étude "' + nom + '" : aucun résultat chiffré renseigné.');
      if (e.traitements_evalues != null && !Array.isArray(e.traitements_evalues))
        err.push('Étude "' + nom + '" : "traitements_evalues" doit être une liste.');
    });
    return { ok: err.length === 0, erreurs: err, avertissements: avert };
  }

  // ── Validation d'un arbre de protocole ───────────────────────────────────
  function validerProtocole(nomFichier, data, schema) {
    var err = [], avert = [];
    if (!estObjet(data)) return { ok: false, erreurs: [nomFichier + ' : racine JSON invalide.'], avertissements: [] };
    var tree = data.tree || data;
    if (!estObjet(tree)) { err.push(nomFichier + ' : arbre ("tree") absent ou invalide.'); return { ok: false, erreurs: err, avertissements: avert }; }

    var vus = 0, MAX = 100000;
    function visiter(node, chemin) {
      if (!estObjet(node) || ++vus > MAX) return;
      if (TYPES_NŒUDS.indexOf(node.type) === -1)
        err.push(nomFichier + ' @' + chemin + ' : type de nœud inconnu "' + node.type + '".');

      // Tag de critère canonique : doit exister dans le schéma.
      if (node.critere) {
        var def = schema && schema.criteres && schema.criteres[node.critere];
        if (!def) err.push(nomFichier + ' @' + chemin + ' : critère "' + node.critere + '" absent du schéma.');
        else if (estObjet(node.reponses)) {
          Object.keys(node.reponses).forEach(function (label) {
            var val = node.reponses[label];
            if (def.type !== 'numerique' && !valeurConnue(node.critere, val, schema))
              avert.push(nomFichier + ' @' + chemin + ' : réponse "' + val + '" hors vocabulaire du critère "' + node.critere + '".');
          });
        }
      } else if (estObjet(node.reponses)) {
        avert.push(nomFichier + ' @' + chemin + ' : "reponses" défini sans "critere" (ignoré au matching).');
      }

      if (node.type === 'resultat') {
        if (!node.titre || !String(node.titre).trim())
          avert.push(nomFichier + ' @' + chemin + ' : recommandation sans titre.');
        return;
      }
      if (node.suite) visiter(node.suite, chemin + '→suite');
      if (estObjet(node.choix)) {
        Object.keys(node.choix).forEach(function (lab) { visiter(node.choix[lab], chemin + '→' + lab); });
      } else if (node.type === 'question' && !node.suite) {
        avert.push(nomFichier + ' @' + chemin + ' : question sans réponses ("choix").');
      }
    }
    visiter(tree, tree.titre || 'racine');
    return { ok: err.length === 0, erreurs: err, avertissements: avert };
  }

  root.AtlasContrat = {
    normaliser: normaliser,
    estNeutre: estNeutre,
    esc: esc,
    valeurConnue: valeurConnue,
    validerSchema: validerSchema,
    validerBase: validerBase,
    validerProtocole: validerProtocole
  };
})(typeof module !== 'undefined' && module.exports ? module.exports : (typeof window !== 'undefined' ? window : this));
