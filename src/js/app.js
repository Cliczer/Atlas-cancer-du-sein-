/*
 * Atlas Pronostics — app.js
 * Vanilla JS - Refactorisation Senior Dev
 */
(function () {
  'use strict';

  var tree = null;
  var etudes = [];
  var keyMapping = {};
  var current = null;
  var history = [];
  var maxDepth = 1;

  // Raccourci DOM
  function $(id) { return document.getElementById(id); }

  // 1. Initialisation des écouteurs d'événements (Le JS gère les clics, pas le HTML)
  document.addEventListener('DOMContentLoaded', function() {
    $('btn-start-hero').addEventListener('click', demarrer);
    $('btn-back').addEventListener('click', reculer);
    $('btn-print').addEventListener('click', function() { window.print(); });
    $('btn-restart').addEventListener('click', recommencer);
    
    var homeLinks = document.querySelectorAll('.nav-home');
    homeLinks.forEach(function(link) {
        link.addEventListener('click', function(e) { e.preventDefault(); recommencer(); });
    });

    loadBaseEtudes();
  });

  // Affichage des erreurs proprement sans bloquer l'écran
  function showError(msg) {
      var toast = $('error-toast');
      toast.textContent = msg;
      toast.style.display = 'block';
      setTimeout(function() { toast.style.display = 'none'; }, 5000);
  }

  /* --- TABLE DE CORRESPONDANCE --- */
  var MAPPING = {
    'HER2+': ['Positif','HER2+','positif','1'], 'HER2-': ['Négatif','HER2-','négatif','0','Negatif'],
    'RE+': ['Positif','RE+','positif','élevés','eleves'], 'RE-': ['Négatif','RE-','négatif','0'],
    'élevés': ['Positif','positif','élevés','RE+','RP+'], 'RP-': ['Négatif','RP-','négatif','0'],
    'T1a': ['T1','T1a','T1, T2','T1, T2, T3','T1, T2, T3, T4','T4a, T3, T4b, T4c, T1, T2'],
    'T1b': ['T1','T1b','T1, T2','T1, T2, T3','T1, T2, T3, T4','T4a, T3, T4b, T4c, T1, T2'],
    'T1c': ['T1','T1c','T1, T2','T1, T2, T3','T1, T2, T3, T4'],
    'T2': ['T2','T1, T2','T2, T3','T1, T2, T3','T4a, T3, T4b, T4c, T1, T2'],
    'T3': ['T3','T2, T3','T1, T2, T3','T2, T3, T4'],
    'T4': ['T4','T4d','T1, T2, T3, T4','T4a, T3, T4b, T4c, T1, T2'], 'T4d': ['T4','T4d','T1, T2, T3, T4','T4a, T3, T4b, T4c, T1, T2'],
    'Tis': ['Tis','in situ','CCIS'], 'N0': ['N0','pN0','N0, N1','N2, N3, N0, N1'],
    'N+': ['N+','pN+','pN1','pN1-3','N1','N2','N0, N1','N2, N3, N0, N1'],
    'Infiltrant': ['Infiltrant','Infilitrant','invasif'], 'in situ': ['in situ','Tis','CCIS'],
    '0': ['0','pré-ménopausée','non ménopausée','0.0'], '1': ['1','ménopausée','post-ménopausée','1.0']
  };

  function normaliser(v) { return v == null ? '' : String(v).toLowerCase().trim(); }
  function estJoker(v) { var n = normaliser(v); return n === 'nc' || n === '-1' || n === '-1.0' || n === 'nan' || n === '' || n === 'n/a' || n === 'nr'; }

  function valeurPatient(profil, nomCritere) {
    if (profil[nomCritere] !== undefined) return profil[nomCritere];
    var alts = keyMapping[nomCritere];
    if (alts) { for (var i = 0; i < alts.length; i++) { if (profil[alts[i]] !== undefined) return profil[alts[i]]; } }
    var nC = normaliser(nomCritere), cles = Object.keys(profil);
    for (var j = 0; j < cles.length; j++) { if (normaliser(cles[j]) === nC) return profil[cles[j]]; }
    return undefined;
  }

  function matchCategoriel(vP, vE) {
    var nP = normaliser(vP), nE = normaliser(vE);
    if (nP === nE) return 1;
    if (MAPPING[vP] && MAPPING[vP].map(normaliser).indexOf(nE) !== -1) return 1;
    if (MAPPING[vE] && MAPPING[vE].map(normaliser).indexOf(nP) !== -1) return 1;
    if (nE.indexOf(',') !== -1) {
      var parties = nE.split(',').map(function(p){ return p.trim(); }), eqP = MAPPING[vP] ? MAPPING[vP].map(normaliser) : [];
      for (var i = 0; i < parties.length; i++) { if (parties[i] === nP || eqP.indexOf(parties[i]) !== -1) return 1; }
    }
    return 0;
  }

  function matchNumerique(vP, vE) {
    var nP = normaliser(vP), nE = normaliser(vE);
    if (nP === nE) return 1;
    var numP = parseFloat(nP.replace(/[^0-9.-]/g,'')), numE = parseFloat(nE.replace(/[^0-9.-]/g,''));
    if (!isNaN(numP) && !isNaN(numE)) { if (numP === numE) return 1; if (Math.abs(numP-numE)/Math.max(Math.abs(numE),1) <= 0.2) return 0.5; }
    return 0;
  }

  function construireProfil() {
    var profil = {};
    history.forEach(function(h) { var q = (h.node && h.node.titre) ? h.node.titre : ''; var r = h.label || ''; if (q && r) profil[q] = r; });
    return profil;
  }

  function extraireTraitementsRecommandes(donnees) {
    var t = [];
    Object.keys(donnees || {}).forEach(function(k) { var v = String(donnees[k]||'').trim(); if (v === '1' || v === '1.0') t.push(k.replace(/^OUT_/i,'')); });
    return t;
  }

  function calculerScoreEtude(etude, profilPatient, traitementsRecommandes) {
    var NUMERIQUES = ['Ki67 (%)','ki67','Age','age','Marges (mm)','Marges et autres paramètres'];
    var criteres = etude.criteres || {}, pts = 0, evalues = 0, colonnesGagnantes = [], colonnesBloquantes = []; 
    Object.keys(criteres).forEach(function(nom) {
        var vE = criteres[nom];
        if (estJoker(vE)) { pts++; evalues++; colonnesGagnantes.push(nom); return; }
        var vP = valeurPatient(profilPatient, nom);
        if (vP === undefined || String(vP).trim() === '') return; 
        evalues++;
        var s = NUMERIQUES.indexOf(nom) !== -1 ? matchNumerique(vP, vE) : matchCategoriel(vP, vE);
        pts += s;
        if (s > 0) colonnesGagnantes.push(nom); else colonnesBloquantes.push(nom); 
    });
    return { valeur: evalues === 0 ? 50 : Math.round((pts/evalues)*100), colonnes: colonnesGagnantes, mismatches: colonnesBloquantes };
  }

  function depth(node, d) {
    if (!node || node.type === 'resultat' || (!node.choix && !node.suite)) return d;
    if (node.type === 'etape' && node.suite) return depth(node.suite, d+1);
    var keys = Object.keys(node.choix || {}), max = d;
    for (var i = 0; i < keys.length; i++) { var sub = depth(node.choix[keys[i]], d+1); if (sub > max) max = sub; }
    return max;
  }

  /* --- CHARGEMENT DES FICHIERS --- */
  function loadBaseEtudes() {
    var v = '?_v=' + Date.now();
    fetch('src/data/base_etudes.json' + v).then(function(r) {
      if (!r.ok) throw new Error('Erreur HTTP ' + r.status);
      return r.json();
    }).then(function(base) {
      etudes = Array.isArray(base) ? base : (base.etudes || []);
      keyMapping = base.mapping || {};
      $('btn-start-hero').disabled = false;
      $('btn-start-hero').textContent = 'Commencer l\'évaluation →';
    }).catch(function(err) {
      showError("Base d'études non trouvée. Navigation en mode arbre pur.");
      $('btn-start-hero').disabled = false;
      $('btn-start-hero').textContent = 'Commencer sans littérature →';
    });
  }

  function demarrer() {
    var selectMenu = $('protocol-select');
    var filename = selectMenu ? selectMenu.value : null;
    if (!filename) { showError('Veuillez sélectionner un protocole.'); return; }

    $('btn-start-hero').disabled = true;
    $('btn-start-hero').textContent = 'Chargement de l\'arbre...';

    var v = '?_v=' + Date.now();
    fetch(filename + v).then(function(r) {
      if (!r.ok) throw new Error('Fichier ' + filename + ' introuvable.');
      return r.json();
    }).then(function(data) {
      tree = data.tree || data;
      maxDepth = depth(tree, 0) || 1;
      $('btn-start-hero').disabled = false;
      $('btn-start-hero').textContent = 'Commencer l\'évaluation →';
      history = []; current = tree;
      show('screen-quiz');
      render(current);
    }).catch(function(err) {
      showError("Erreur lors du chargement de l'arbre : " + err.message);
      $('btn-start-hero').disabled = false;
      $('btn-start-hero').textContent = 'Commencer l\'évaluation →';
    });
  }

  /* --- NAVIGATION & AFFICHAGE --- */
  function show(id) {
    ['screen-home','screen-quiz','screen-results'].forEach(function(sid) {
      var el = $(sid); if (el) el.classList.toggle('active', sid === id);
    });
    window.scrollTo(0,0);
  }

  function reculer() { if (!history.length) return; current = history.pop().node; render(current); }

  function recommencer() {
    history = []; current = null;
    ['quiz-choices','results-grid','results-path','etudes-section'].forEach(function(id) { var el = $(id); if (el) el.innerHTML = ''; });
    show('screen-home');
  }

  function render(node) {
    if (!node) return;
    if (node.type === 'resultat') { renderResults(node); return; }

    $('quiz-question').textContent = node.titre || '(Étape clinique)';
    var step = history.length + 1, total = maxDepth || step, pct = Math.round(Math.max(0, (step-1)/total) * 100);
    $('quiz-step-label').textContent = 'Étape ' + step; $('quiz-pct-label').textContent = pct + ' %';
    $('quiz-progress-bar').style.width = pct + '%';
    $('btn-back').style.display = history.length > 0 ? 'inline-flex' : 'none';

    var container = $('quiz-choices');
    container.innerHTML = '';

    if (node.type === 'etape' && node.suite && !node.choix) {
      var btn = document.createElement('button'); btn.className = 'choice-btn';
      btn.innerHTML = '<span>Continuer vers l\'étape suivante</span><span class="arrow">→</span>';
      btn.addEventListener('click', function() { history.push({node: current, label: 'Continuer'}); current = node.suite; render(current); });
      container.appendChild(btn); return;
    }

    var keys = Object.keys(node.choix || {});
    if (!keys.length) { container.innerHTML = '<p style="color:#636e72;">Aucun choix disponible.</p>'; return; }

    keys.forEach(function(label) {
      var next = node.choix[label];
      var btn = document.createElement('button'); btn.className = 'choice-btn';
      var txt = document.createElement('span'); txt.textContent = label;
      var arr = document.createElement('span'); arr.className = 'arrow'; arr.innerHTML = '→';
      btn.appendChild(txt); btn.appendChild(arr);
      btn.addEventListener('click', function() { history.push({node: current, label: label}); current = next; render(current); });
      container.appendChild(btn);
    });
  }

  function renderResults(node) {
    var donnees = node.donnees || {};
    $('quiz-progress-bar').style.width = '100%'; $('quiz-pct-label').textContent = '100 %'; $('quiz-step-label').textContent = 'Terminé';

    var pathEl = $('results-path'); pathEl.innerHTML = '';
    if (!history.length) { pathEl.textContent = 'Résultat direct'; } else {
      history.forEach(function(h,i) {
        if (i > 0) { var sep = document.createElement('span'); sep.className = 'path-sep'; sep.textContent = '›'; pathEl.appendChild(sep); }
        var s = document.createElement('span'); s.className = 'path-step'; s.textContent = h.label; pathEl.appendChild(s);
      });
    }

    var grid = $('results-grid'); grid.innerHTML = '';
    if (node.titre) {
        var resTitle = document.createElement('div'); resTitle.style.cssText = 'grid-column: 1 / -1; margin-bottom: 16px; font-size: 16px; font-weight: 700; color: #1a1a2e;';
        resTitle.textContent = '🎯 Décision : ' + node.titre; grid.appendChild(resTitle);
    }

    var entries = Object.keys(donnees).map(function(k) {
      var val = String(donnees[k]||'').trim(), cls = (val==='1'||val==='1.0') ? 'rec' : (val==='0'||val==='0.0') ? 'nrec' : 'ns';
      return { name: k.replace(/^OUT_/i,''), val: val, cls: cls };
    });
    entries.sort(function(a,b) { return ({rec:0,nrec:1,ns:2}[a.cls]) - ({rec:0,nrec:1,ns:2}[b.cls]); });

    entries.forEach(function(e) {
      var card = document.createElement('div'); card.className = 'result-card ' + e.cls;
      var h4 = document.createElement('h4'); h4.textContent = e.name;
      var b = document.createElement('span'); b.className = 'badge ' + e.cls;
      b.textContent = (e.cls === 'rec') ? '✓ Recommandé' : (e.cls === 'nrec') ? '✗ Non recommandé' : 'Non spécifié';
      card.appendChild(h4); card.appendChild(b); grid.appendChild(card);
    });

    show('screen-results');
    renderEtudes(construireProfil(), extraireTraitementsRecommandes(donnees));
  }

  function renderEtudes(profil, traitementsRecommandes) {
    var section = $('etudes-section'); if (!section || !etudes.length) return; section.innerHTML = '';
    var scored = etudes.map(function(e) { var res = calculerScoreEtude(e, profil, traitementsRecommandes); return { etude: e, score: res.valeur, colonnes: res.colonnes, mismatches: res.mismatches }; });
    var retenues = scored.filter(function(e) { return e.score >= 40; }).sort(function(a,b) { return b.score - a.score; });
    if (!retenues.length) return;

    var h3 = document.createElement('h3'); h3.textContent = 'Données issues de la littérature';
    h3.style.cssText = 'font-size:18px;font-weight:700;margin:32px 0 8px;'; section.appendChild(h3);

    retenues.forEach(function(item) {
        var template = $('tpl-etude');
        var clone = template.content.cloneNode(true);
        
        clone.querySelector('.etude-titre').textContent = item.etude.reference || item.etude.titre;
        clone.querySelector('.etude-score').innerHTML = item.colonnes.length + item.mismatches.length === 0 ? '' : "<strong>Calcul du match :</strong> " + item.colonnes.length + " critère(s) validé(s) sur " + (item.colonnes.length + item.mismatches.length);
        
        if (item.colonnes.length > 0) clone.querySelector('.etude-match').textContent = '✅ Match : ' + item.colonnes.join(', ');
        if (item.mismatches.length > 0) clone.querySelector('.etude-mismatch').textContent = '❌ Non-match : ' + item.mismatches.join(', ');
        
        if (item.etude.lien) { var a = clone.querySelector('.etude-lien'); a.href = item.etude.lien; a.style.display = 'inline-block'; }
        
        var comp = item.etude.comparaison || { avec: {valeur: 0}, sans: {valeur: 0} };
        clone.querySelector('.val-avec').textContent = (comp.avec.valeur || 0) + '%';
        clone.querySelector('.fill-avec').style.width = (comp.avec.valeur || 0) + '%';
        clone.querySelector('.val-sans').textContent = (comp.sans.valeur || 0) + '%';
        clone.querySelector('.fill-sans').style.width = (comp.sans.valeur || 0) + '%';

        var btnToggle = clone.querySelector('.btn-toggle'), zoneDetails = clone.querySelector('.zone-details');
        btnToggle.addEventListener('click', function() {
            var isHidden = zoneDetails.style.display === 'none';
            zoneDetails.style.display = isHidden ? 'block' : 'none';
            btnToggle.textContent = isHidden ? 'Cacher les détails ↑' : 'Voir les détails ↓';
            btnToggle.style.background = isHidden ? '#f8f9fa' : 'transparent';
        });

        section.appendChild(clone);
    });
  }

}());
