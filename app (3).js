/*
 * Atlas Pronostics — app.js
 * Vanilla JS pur, aucune dépendance.
 *
 * CONTRAT avec index.html (IDs immuables) :
 *   Écrans    : #screen-home  #screen-quiz  #screen-results
 *   Accueil   : #btn-start  #btn-start-hero
 *   Quiz      : #quiz-question  #quiz-choices  #quiz-step-label
 *               #quiz-pct-label  #quiz-progress-bar  #btn-back
 *   Résultats : #results-path  #results-grid
 */

(function () {
  'use strict';

  /* ─── État ───────────────────────────────────────────────── */
  var tree       = null;   // racine du JSON
  var current    = null;   // nœud en cours
  var history    = [];     // pile : [{node, label}, …]
  var maxDepth   = 1;      // pour la barre de progression

  /* ─── Raccourci ──────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }

  /* ════════════════════════════════════════════════════════════
     1. CHARGEMENT DU JSON
  ════════════════════════════════════════════════════════════ */

  /* Calcule la profondeur max de l'arbre (pour la progression). */
  function depth(node, d) {
    if (!node || node.type === 'resultat' || !node.choix) return d;
    var keys = Object.keys(node.choix);
    var max  = d;
    for (var i = 0; i < keys.length; i++) {
      var sub = depth(node.choix[keys[i]], d + 1);
      if (sub > max) max = sub;
    }
    return max;
  }

  function load() {
    /* ?_v= force le navigateur à ne pas utiliser le cache.
       Indispensable sur GitHub Pages où les fichiers statiques
       peuvent rester en cache plusieurs minutes après un push. */
    fetch('arbre_dynamique.json?_v=' + Date.now())
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        tree     = data;
        maxDepth = depth(tree, 0) || 1;

        /* Activer les deux boutons "Commencer" */
        var bs = $('btn-start');
        var bh = $('btn-start-hero');
        if (bs) { bs.disabled = false; bs.textContent = 'Commencer →'; }
        if (bh) { bh.disabled = false; bh.textContent = 'Commencer l\'évaluation →'; }
      })
      .catch(function (err) {
        console.error('[Atlas] Chargement JSON :', err);
        alert(
          'Impossible de charger arbre_dynamique.json.\n' +
          'Vérifiez que le fichier est à la racine du dépôt et que GitHub Pages a bien déployé.\n' +
          'Détail : ' + err.message
        );
      });
  }

  /* ════════════════════════════════════════════════════════════
     2. NAVIGATION ENTRE ÉCRANS
     Une seule règle CSS : .screen { display:none }
                           .screen.active { display:block }
  ════════════════════════════════════════════════════════════ */

  function show(id) {
    ['screen-home', 'screen-quiz', 'screen-results'].forEach(function (sid) {
      var el = $(sid);
      if (!el) return;
      el.classList.toggle('active', sid === id);
    });
    /* Scroll haut à chaque changement d'écran */
    window.scrollTo(0, 0);
  }

  /* ════════════════════════════════════════════════════════════
     3. DÉMARRER L'ÉVALUATION
     Appelé par les deux boutons de l'accueil.
  ════════════════════════════════════════════════════════════ */

  function demarrer() {
    if (!tree) {
      alert('Les données sont encore en cours de chargement. Réessayez dans un instant.');
      return;
    }
    history = [];
    current = tree;
    show('screen-quiz');
    render(current);
  }

  /* ════════════════════════════════════════════════════════════
     4. AFFICHER UN NŒUD
  ════════════════════════════════════════════════════════════ */

  function render(node) {
    /* Résultat terminal → page résultats */
    if (node.type === 'resultat') {
      renderResults(node.donnees);
      return;
    }

    /* ── Question ── */
    $('quiz-question').textContent = node.titre || '(Question sans titre)';

    /* ── Progression ── */
    var step  = history.length + 1;
    var total = maxDepth || step;
    var pct   = Math.round(Math.max(0, (step - 1) / total) * 100);

    $('quiz-step-label').textContent  = 'Étape ' + step + ' / ' + total;
    $('quiz-pct-label').textContent   = pct + ' %';
    $('quiz-progress-bar').style.width = pct + '%';

    /* ── Bouton Retour ── */
    $('btn-back').style.display = history.length > 0 ? 'inline-flex' : 'none';

    /* ── Choix ── */
    var container = $('quiz-choices');
    container.innerHTML = '';

    var keys = Object.keys(node.choix || {});
    if (keys.length === 0) {
      container.innerHTML = '<p style="color:#636e72;font-style:italic;">Aucune option disponible.</p>';
      return;
    }

    keys.forEach(function (label) {
      var next = node.choix[label];

      var btn = document.createElement('button');
      btn.className = 'choice-btn';

      /* Texte */
      var txt = document.createElement('span');
      txt.textContent = label;
      btn.appendChild(txt);

      /* Flèche décorative — span, jamais SVG libre pour éviter les bugs de taille */
      var arr = document.createElement('span');
      arr.className   = 'arrow';
      arr.textContent = '→';
      arr.setAttribute('aria-hidden', 'true');
      btn.appendChild(arr);

      /* Closure correcte avec IIFE pour capturer label et next */
      btn.addEventListener('click', (function (l, n) {
        return function () {
          history.push({ node: current, label: l });
          current = n;
          render(current);
        };
      }(label, next)));

      container.appendChild(btn);
    });
  }

  /* ════════════════════════════════════════════════════════════
     5. RECULER D'UNE ÉTAPE
  ════════════════════════════════════════════════════════════ */

  function reculer() {
    if (history.length === 0) return;
    var prev = history.pop();
    current  = prev.node;
    render(current);
  }

  /* ════════════════════════════════════════════════════════════
     6. AFFICHER LES RÉSULTATS
  ════════════════════════════════════════════════════════════ */

  function cls(val) {
    var v = String(val || '').trim();
    if (v === '1' || v === '1.0') return 'rec';
    if (v === '0' || v === '0.0') return 'nrec';
    return 'ns';
  }

  function badge(val) {
    var v = String(val || '').trim();
    if (v === '1' || v === '1.0') return '✓ Recommandé';
    if (v === '0' || v === '0.0') return '✗ Non recommandé';
    return 'Non spécifié';
  }

  function renderResults(donnees) {
    /* Barre de progression à 100 % */
    $('quiz-progress-bar').style.width = '100%';
    $('quiz-pct-label').textContent    = '100 %';
    $('quiz-step-label').textContent   = 'Terminé';

    /* ── Parcours clinique ── */
    var pathEl = $('results-path');
    pathEl.innerHTML = '';

    if (history.length === 0) {
      pathEl.textContent = 'Résultat direct';
    } else {
      history.forEach(function (h, i) {
        if (i > 0) {
          var sep = document.createElement('span');
          sep.className   = 'path-sep';
          sep.textContent = '›';
          pathEl.appendChild(sep);
        }
        var s = document.createElement('span');
        s.className   = 'path-step';
        s.textContent = h.label;
        pathEl.appendChild(s);
      });
    }

    /* ── Grille traitements ── */
    var grid = $('results-grid');
    grid.innerHTML = '';

    var entries = Object.keys(donnees || {}).map(function (k) {
      return { name: k.replace(/^OUT_/i, ''), val: donnees[k], cls: cls(donnees[k]) };
    });

    /* Tri : recommandé → non-recommandé → non-spécifié */
    var order = { rec: 0, nrec: 1, ns: 2 };
    entries.sort(function (a, b) { return order[a.cls] - order[b.cls]; });

    if (entries.length === 0) {
      grid.innerHTML = '<p style="color:#636e72;">Aucune donnée de traitement disponible.</p>';
    } else {
      entries.forEach(function (e) {
        var card = document.createElement('div');
        card.className = 'result-card ' + e.cls;

        var h4 = document.createElement('h4');
        h4.textContent = e.name;

        var b = document.createElement('span');
        b.className   = 'badge ' + e.cls;
        b.textContent = badge(e.val);

        card.appendChild(h4);
        card.appendChild(b);
        grid.appendChild(card);
      });
    }

    show('screen-results');
  }

  /* ════════════════════════════════════════════════════════════
     7. RECOMMENCER
  ════════════════════════════════════════════════════════════ */

  function recommencer() {
    history = [];
    current = null;
    $('quiz-choices').innerHTML  = '';
    $('results-grid').innerHTML  = '';
    $('results-path').innerHTML  = '';
    show('screen-home');
  }

  /* ════════════════════════════════════════════════════════════
     EXPOSITION GLOBALE
     Les onclick="..." dans le HTML ont besoin de ces fonctions
     dans window.
  ════════════════════════════════════════════════════════════ */
  window.demarrer    = demarrer;
  window.reculer     = reculer;
  window.recommencer = recommencer;

  /* ─── Lancement ─────────────────────────────────────────── */
  load();

}());
