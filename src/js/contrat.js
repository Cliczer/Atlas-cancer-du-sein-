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

      // Tags de critères : reponses[label] = { critere: valeur, ... } (multi-critères),
      // ou ancien format critere + reponses[label] = "valeur".
      function verifierCritereValeur(crit, val) {
        var def = schema && schema.criteres && schema.criteres[crit];
        if (!def) { err.push(nomFichier + ' @' + chemin + ' : critère "' + crit + '" absent du schéma.'); return; }
        if (def.type !== 'numerique' && val != null && String(val).trim() !== '' && !valeurConnue(crit, val, schema))
          avert.push(nomFichier + ' @' + chemin + ' : réponse "' + val + '" hors vocabulaire du critère "' + crit + '".');
      }
      if (estObjet(node.reponses)) {
        Object.keys(node.reponses).forEach(function (label) {
          var rep = node.reponses[label];
          if (estObjet(rep)) Object.keys(rep).forEach(function (crit) { verifierCritereValeur(crit, rep[crit]); });
          else if (node.critere) verifierCritereValeur(node.critere, rep);
        });
      } else if (node.critere && !(schema && schema.criteres && schema.criteres[node.critere])) {
        err.push(nomFichier + ' @' + chemin + ' : critère "' + node.critere + '" absent du schéma.');
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

  // ── Moteur de correspondance (matching) — logique PURE, testable ──
  // Un critère patient (vP) vs un critère d'étude (vE). Catégoriel : égalité
  // normalisée, synonymes (mapping) dans les deux sens, ou appartenance à une
  // liste "a, b, c". Renvoie 1 (concorde) ou 0.
  function matchCategoriel(vP, vE, mapping) {
    mapping = mapping || {};
    var nP = normaliser(vP), nE = normaliser(vE);
    if (nP === nE) return 1;
    if (mapping[vP] && mapping[vP].map(normaliser).indexOf(nE) !== -1) return 1;
    if (mapping[vE] && mapping[vE].map(normaliser).indexOf(nP) !== -1) return 1;
    if (nE.indexOf(',') !== -1) {
      var parties = nE.split(',').map(function(p){ return p.trim(); });
      var eqP = mapping[vP] ? mapping[vP].map(normaliser) : [];
      for (var i = 0; i < parties.length; i++) {
        if (parties[i] === nP || eqP.indexOf(parties[i]) !== -1) return 1;
      }
    }
    return 0;
  }

  // Critère d'étude au format valeur exacte, plage "10-50" ou comparaison
  // "<2","<=2",">2",">=2". Concordance stricte, pas de "match partiel".
  function matchNumerique(vP, vE) {
    var nP = normaliser(vP), nE = normaliser(vE);
    if (nP === nE) return 1;
    var numP = parseFloat(nP.replace(',', '.'));
    if (isNaN(numP)) return 0;
    var plage = nE.match(/^(-?\d+(?:[.,]\d+)?)\s*-\s*(-?\d+(?:[.,]\d+)?)$/);
    if (plage) {
      var lo = parseFloat(plage[1].replace(',', '.')), hi = parseFloat(plage[2].replace(',', '.'));
      return (numP >= lo && numP <= hi) ? 1 : 0;
    }
    var cmp = nE.match(/^(<=|>=|<|>)\s*(-?\d+(?:[.,]\d+)?)$/);
    if (cmp) {
      var seuil = parseFloat(cmp[2].replace(',', '.'));
      switch (cmp[1]) {
        case '<':  return numP <  seuil ? 1 : 0;
        case '<=': return numP <= seuil ? 1 : 0;
        case '>':  return numP >  seuil ? 1 : 0;
        case '>=': return numP >= seuil ? 1 : 0;
      }
    }
    var numE = parseFloat(nE.replace(/[^0-9.-]/g, ''));
    if (!isNaN(numE) && numP === numE) return 1;
    return 0;
  }

  // Valeur du patient pour un critère : accès direct, via alias (keyMapping),
  // sinon comparaison de clés normalisées.
  function valeurPatient(profil, nomCritere, keyMapping) {
    keyMapping = keyMapping || {};
    if (profil[nomCritere] !== undefined) return profil[nomCritere];
    var alts = keyMapping[nomCritere];
    if (alts) {
      for (var i = 0; i < alts.length; i++) {
        if (profil[alts[i]] !== undefined) return profil[alts[i]];
      }
    }
    var nC = normaliser(nomCritere), cles = Object.keys(profil);
    for (var j = 0; j < cles.length; j++) {
      if (normaliser(cles[j]) === nC) return profil[cles[j]];
    }
    return undefined;
  }

  // Score d'une étude vs un profil patient. cfg = {mapping, numeriques, neutres, keyMapping}.
  // Les critères neutres (l'étude ne s'est pas prononcée) sont ignorés (ni score, ni concordance).
  function calculerScore(etude, profil, cfg) {
    cfg = cfg || {};
    var mapping = cfg.mapping || {}, numeriques = cfg.numeriques || [], keyMapping = cfg.keyMapping || {};
    var schemaN = { valeurs_neutres: cfg.neutres };
    var criteres = etude.criteres || {};
    var pts = 0, evalues = 0, colonnes = [], mismatches = [];
    Object.keys(criteres).forEach(function(nom) {
      var vE = criteres[nom];
      if (estNeutre(vE, schemaN)) return;
      var vP = valeurPatient(profil, nom, keyMapping);
      if (vP === undefined || String(vP).trim() === '') return;
      evalues++;
      var s = numeriques.indexOf(nom) !== -1 ? matchNumerique(vP, vE) : matchCategoriel(vP, vE, mapping);
      pts += s;
      if (s > 0) colonnes.push(nom); else mismatches.push(nom);
    });
    return { valeur: evalues === 0 ? null : Math.round((pts / evalues) * 100), total: evalues, colonnes: colonnes, mismatches: mismatches };
  }

  // ── Sérialisation arbre ⇄ graphe (éditeur d'arbres) — PURE, testable ──
  // Liste des valeurs/libellés portés par une branche. On privilégie la liste
  // explicite `valeursListe` (fidèle : un libellé peut contenir des virgules,
  // ex. « cT1N0, RH+, Ménopause »). Sinon repli legacy : découpage du label par
  // virgule (anciens graphes sans valeursListe).
  function edgeValeursListe(e) {
    if (e && Array.isArray(e.valeursListe)) return e.valeursListe.filter(Boolean);
    return String((e && e.label) || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean);
  }
  function edgeADesValeurs(e) { return !!(e && e.valeurs && Object.keys(e.valeurs).length); }

  // Arbre JSON → {nodes, edges}. IDs de nœuds déterministes (n1, n2… en DFS).
  function treeVersGraphe(tree) {
    var nodes = [], edges = [], count = { n: 1, e: 1 };
    function titreResultat(t) {
      var k = Object.keys(t.donnees || {});
      return k.length ? k.map(function(x){ return x.replace(/^OUT_/i, ''); }).join(', ') : 'Recommandation';
    }
    function deriveValeurs(reponses, label, parentCritere) {
      var r = reponses ? reponses[label] : undefined;
      if (r && typeof r === 'object') return Object.assign({}, r);
      if (typeof r === 'string' && r !== '' && parentCritere) { var o = {}; o[parentCritere] = r; return o; }
      return {};
    }
    function walk(t, parent, label, parentReponses, parentCritere) {
      if (!t) return null;
      var id = 'n' + (count.n++);
      nodes.push({
        id: id, type: t.type || 'question',
        titre: t.titre || (t.type === 'resultat' ? titreResultat(t) : ''),
        donnees: t.donnees || {}, infos_science: t.infos_science || {},
        source_senorif: t.source_senorif || (t.infos_science && t.infos_science.source) || '', x: 0, y: 0
      });
      if (parent) edges.push({ id: 'e' + (count.e++), source: parent, target: id, label: label || '', valeursListe: label ? [label] : [], valeurs: deriveValeurs(parentReponses, label, parentCritere) });
      if (t.type === 'etape') {
        if (t.suite) walk(t.suite, id, '', t.reponses, t.critere);
        if (t.choix) Object.keys(t.choix).forEach(function(lab){ walk(t.choix[lab], id, lab, t.reponses, t.critere); });
      } else if (t.type !== 'resultat' && t.choix) {
        Object.keys(t.choix).forEach(function(lab){ walk(t.choix[lab], id, lab, t.reponses, t.critere); });
      }
      return id;
    }
    walk(tree, null, '');
    return { nodes: nodes, edges: edges };
  }

  // {nodes, edges} → arbre JSON. Garde anti-boucle (un nœud sérialisé une seule fois).
  function grapheVersTree(nodes, edges) {
    var parId = {}; nodes.forEach(function(n){ parId[n.id] = n; });
    var targets = {}; edges.forEach(function(e){ targets[e.target] = true; });
    var root = nodes.filter(function(n){ return !targets[n.id]; })[0] || nodes[0];
    var construits = {};
    function build(n) {
      if (!n) return {};
      if (construits[n.id]) return { type: 'resultat', titre: '(référence circulaire ignorée)' };
      construits[n.id] = true;
      if (n.type === 'resultat') return { type: 'resultat', titre: n.titre || '', donnees: n.donnees || {}, infos_science: n.infos_science || {}, source_senorif: n.source_senorif || '' };
      var out = edges.filter(function(e){ return e.source === n.id; });
      if (n.type === 'etape' && out.length === 1 && edgeValeursListe(out[0]).length === 0) {
        return { type: 'etape', titre: n.titre || 'Étape sans titre', suite: build(parId[out[0].target]), infos_science: n.infos_science || {}, source_senorif: n.source_senorif || '' };
      }
      var choix = {}, reponses = {};
      out.forEach(function(e, index) {
        var child = parId[e.target]; if (!child) return;
        var sub = build(child);
        var vals = edgeValeursListe(e);
        if (!vals.length) vals = [(n.type === 'etape' ? 'Branche ' : 'Réponse ') + (index + 1)];
        vals.forEach(function(v){ choix[v] = sub; if (edgeADesValeurs(e)) reponses[v] = e.valeurs; });
      });
      var res = { type: n.type || 'question', titre: n.titre || (n.type === 'etape' ? 'Étape sans titre' : 'Question sans titre'), choix: choix, infos_science: n.infos_science || {}, source_senorif: n.source_senorif || '' };
      if (Object.keys(reponses).length) res.reponses = reponses;
      return res;
    }
    return build(root);
  }

  root.AtlasContrat = {
    normaliser: normaliser,
    estNeutre: estNeutre,
    treeVersGraphe: treeVersGraphe,
    grapheVersTree: grapheVersTree,
    esc: esc,
    valeurConnue: valeurConnue,
    validerSchema: validerSchema,
    validerBase: validerBase,
    validerProtocole: validerProtocole,
    matchCategoriel: matchCategoriel,
    matchNumerique: matchNumerique,
    valeurPatient: valeurPatient,
    calculerScore: calculerScore
  };
})(typeof module !== 'undefined' && module.exports ? module.exports : (typeof window !== 'undefined' ? window : this));
