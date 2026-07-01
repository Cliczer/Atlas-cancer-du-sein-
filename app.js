/*
 * Atlas Pronostics — app.js (Version Optimisée pour ATLAS_COMPLET.xlsx)
 */

(function () {
  'use strict';

  var tree       = null;
  var baseEtudes = null;
  window.baseEtudes = null; // Permet l'accès depuis la console pour tes tests
  var current    = null;
  var history    = [];
  var maxDepth   = 1;

  function $(id) { return document.getElementById(id); }

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
    var v = '?_v=' + Date.now();
    Promise.all([
      fetch('arbre_dynamique.json' + v).then(function(r) {
          if (!r.ok) throw new Error('Arbre HTTP ' + r.status); return r.json();
      }),
      fetch('base_etudes.json' + v).then(function(r) {
          if (!r.ok) { console.warn('Base études introuvable.'); return null; }
          return r.json();
      }).catch(function() { return null; })
    ])
    .then(function (results) {
      tree       = results[0];
      baseEtudes = results[1];
      window.baseEtudes = results[1];
      maxDepth   = depth(tree, 0) || 1;
      var bs = $('btn-start'), bh = $('btn-start-hero');
      if (bs) { bs.disabled = false; bs.textContent = 'Commencer →'; }
      if (bh) { bh.disabled = false; bh.textContent = 'Commencer l\'évaluation →'; }
    })
    .catch(function (err) {
      console.error('[Atlas] Erreur fatale:', err);
    });
  }

  function show(id) {
    ['screen-home', 'screen-quiz', 'screen-results'].forEach(function (sid) {
      var el = $(sid);
      if (el) el.classList.toggle('active', sid === id);
    });
    window.scrollTo(0, 0);
  }

  function demarrer() {
    if (!tree) return alert('Chargement en cours...');
    history = [];
    current = tree;
    show('screen-quiz');
    render(current);
  }

  function humaniserLabel(val) {
    var v = String(val || '').trim();
    if (v === '1.0' || v === '1') return 'Oui / Positif';
    if (v === '0.0' || v === '0') return 'Non / Négatif';
    if (v === '-1.0' || v === '-1') return 'Non renseigné';
    return v;
  }

  function render(node) {
    if (node.type === 'resultat') {
      renderResults(node.donnees);
      return;
    }
    var questionTitre = node.titre || '(Question)';
    $('quiz-question').textContent = questionTitre;
    var step  = history.length + 1;
    var total = maxDepth || step;
    var pct   = Math.round(Math.max(0, (step - 1) / total) * 100);
    $('quiz-step-label').textContent   = 'Étape ' + step + ' / ' + total;
    $('quiz-pct-label').textContent    = pct + ' %';
    $('quiz-progress-bar').style.width = pct + '%';
    $('btn-back').style.display = history.length > 0 ? 'inline-flex' : 'none';

    var container = $('quiz-choices');
    container.innerHTML = '';
    var keys = Object.keys(node.choix || {});
    keys.forEach(function (label) {
      var next = node.choix[label];
      var btn = document.createElement('button');
      btn.className = 'choice-btn';
      var txt = document.createElement('span');
      txt.textContent = humaniserLabel(label); 
      btn.appendChild(txt);
      var arr = document.createElement('span');
      arr.className = 'arrow'; arr.textContent = '→';
      btn.appendChild(arr);
      btn.addEventListener('click', function () {
        history.push({ node: current, label: label, question: questionTitre });
        current = next;
        render(current);
      });
      container.appendChild(btn);
    });
  }

  function reculer() {
    if (history.length === 0) return;
    current = history.pop().node;
    render(current);
  }

  /* ─── MOTEUR DE MATCHING (CORRIGÉ) ─── */
  function matchNumerique(valeurPatient, critereEtude) {
    if (!critereEtude || critereEtude === "-1" || critereEtude === "nc" || critereEtude === "nan") return true;
    var val = parseFloat(valeurPatient);
    var crit = String(critereEtude).trim();
    if (crit.indexOf('-') > 0) {
      var parts = crit.split('-');
      return (val >= parseFloat(parts[0]) && val <= parseFloat(parts[1]));
    }
    if (crit.startsWith('<=')) return val <= parseFloat(crit.substring(2));
    if (crit.startsWith('>=')) return val >= parseFloat(crit.substring(2));
    if (crit.startsWith('<'))  return val < parseFloat(crit.substring(1));
    if (crit.startsWith('>'))  return val > parseFloat(crit.substring(1));
    return val === parseFloat(crit);
  }

  function calculerScoreEtude(etude, profilPatient, mapping, traitementsRecommandes) {
    // 1. Filtre Traitement
    var traitementsEtude = etude.traitements_evalues || [];
    var cleanRecs = traitementsRecommandes.map(r => r.toLowerCase().trim());
    var cleanEtude = traitementsEtude.map(t => t.toLowerCase().trim());
    var matchTraitement = (cleanRecs.length === 0) || cleanRecs.some(r => cleanEtude.includes(r));
    if (!matchTraitement) return 0;

    // 2. Filtre Clinique
    // mapping = {titre exact du nœud de l'arbre : nom du champ etude.criteres correspondant}
    var criteres = etude.criteres || {};
    var scorePoints = 0, criteresEvalues = 0;
    for (var questionArbre in profilPatient) {
      var reponsePatient = String(profilPatient[questionArbre]).toLowerCase().trim();
      if (reponsePatient === "-1" || reponsePatient === "non renseigné") continue;
      var colonneEtude = mapping[questionArbre];

      if (colonneEtude && criteres.hasOwnProperty(colonneEtude)) {
        criteresEvalues++;
        var vE = String(criteres[colonneEtude]).toLowerCase().trim();
        if (vE === "-1" || vE === "nan" || vE === "nc" || vE === "") { scorePoints++; }
        else if (colonneEtude.toLowerCase().includes("age") || colonneEtude.toLowerCase().includes("ki67")) {
          if (matchNumerique(reponsePatient, vE)) scorePoints++;
        } else {
          var p = reponsePatient.replace('.0', '');
          if (vE.includes(p) || ((p === "1" || p === "oui") && vE.includes("pos"))) { scorePoints++; }
        }
      }
    }
    return criteresEvalues > 0 ? Math.round((scorePoints / criteresEvalues) * 100) : 100;
  }

  function cls(val) {
    var v = String(val || '').trim();
    if (v === '1' || v === '1.0') return 'rec';
    if (v === '0' || v === '0.0') return 'nrec';
    if (v === '0.5') return 'alt';
    return 'ns';
  }

  function badge(val) {
    var v = String(val || '').trim();
    if (v === '1' || v === '1.0') return '✓ Recommandé';
    if (v === '0' || v === '0.0') return '✗ Non recommandé';
    if (v === '0.5') return '↹ Alternative (OU)';
    return 'Non spécifié';
  }

  function renderResults(donnees) {
    // 1. Mise à jour des barres de progression
    if ($('quiz-progress-bar')) $('quiz-progress-bar').style.width = '100%';
    if ($('quiz-pct-label')) $('quiz-pct-label').textContent = '100 %';
    if ($('quiz-step-label')) $('quiz-step-label').textContent = 'Terminé';

    // 2. Nettoyage et préparation de la grille
    var grid = $('results-grid');
    if (!grid) return;
    grid.innerHTML = '';
    
    var recsPourEtudes = [];

    // 3. Création des cartes de résultats
    Object.keys(donnees || {}).forEach(function (key) {
      var scoreBrut = String(donnees[key]);
      var typeCls = 'ns'; // Par défaut : non spécifié
      var labelBadge = 'Non spécifié';

      // Logique "cls" intégrée directement ici
      if (scoreBrut === '1' || scoreBrut === '1.0') {
        typeCls = 'rec';
        labelBadge = '✓ Recommandé';
        recsPourEtudes.push(key.replace(/^OUT_/i, '').trim());
      } else if (scoreBrut === '0' || scoreBrut === '0.0') {
        typeCls = 'nrec';
        labelBadge = '✗ Non recommandé';
      } else if (scoreBrut === '0.5') {
        typeCls = 'alt';
        labelBadge = '↹ Alternative (OU)';
        recsPourEtudes.push(key.replace(/^OUT_/i, '').trim());
      }

      var card = document.createElement('div');
      card.className = 'result-card ' + typeCls;
      card.innerHTML = `
        <h4>${key.replace(/^OUT_/i, '')}</h4>
        <span class="badge ${typeCls}">${labelBadge}</span>
      `;
      grid.appendChild(card);
    });

    // 4. Lancement du matching des études
    if (typeof renderEtudes === 'function') {
      renderEtudes(donnees); 
    }
    
    // 5. Affichage de l'écran
    show('screen-results');
  }

  function renderEtudes(donneesResultats) {
    var container = $('etudes-container'); if (!container || !baseEtudes) return;
    container.innerHTML = '';
    var profil = {}; history.forEach(h => { profil[h.question] = h.label; });
    var traitementsRec = [];
    Object.keys(donneesResultats).forEach(k => { if (["1", "1.0", "0.5"].includes(String(donneesResultats[k]))) traitementsRec.push(k.replace(/^OUT_/i, '').trim()); });

    var etudesPertinentes = baseEtudes.etudes.map(function(etude) {
      etude.scoreMatch = calculerScoreEtude(etude, profil, baseEtudes.mapping, traitementsRec);
      return etude;
    }).filter(e => e.scoreMatch >= 50).sort((a,b) => b.scoreMatch - a.scoreMatch);

    if (etudesPertinentes.length === 0) { container.innerHTML = '<p class="muted">Aucune étude correspondante.</p>'; return; }

    etudesPertinentes.forEach(function(etude) {
      var card = document.createElement('div'); card.className = 'etude-card';
      var outcomes = Object.keys(etude.outcomes || {}).map(k => `<div><strong>${k}:</strong> ${etude.outcomes[k]}</div>`).join('');
      var titre = etude.objectif !== '-1' ? etude.objectif : (etude.citation || 'Étude clinique');
      var citationLine = (etude.citation && etude.citation !== titre)
        ? `<div style="font-size:11px; color:#888; margin-bottom:6px;">${etude.citation}</div>` : '';
      var lien = (etude.reference && etude.reference !== '-1')
        ? `<a href="${etude.reference}" target="_blank" class="etude-link">Voir l'étude ↗</a>` : '';
      card.innerHTML = `
        <div class="etude-header"><span class="etude-score">${etude.scoreMatch}% Match</span><span class="etude-preuve">Niveau ${etude.niveau_preuve}</span></div>
        <h4 class="etude-title">${titre}</h4>
        ${citationLine}
        <div style="font-size:12px; margin-bottom:10px;"><strong>Testé:</strong> ${etude.traitements_evalues.join(', ')}</div>
        <div class="etude-stats">${outcomes || 'Pas de données chiffrées.'}</div>
        ${lien}`;
      container.appendChild(card);
    });
  }

  function recommencer() { history = []; current = null; show('screen-home'); }

  window.demarrer = demarrer; window.reculer = reculer; window.recommencer = recommencer; window.accueil = recommencer;
  load();
}());
