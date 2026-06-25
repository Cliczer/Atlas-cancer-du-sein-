/*
 * Atlas Pronostics — app.js
 * Vanilla JS pur, aucune dépendance.
 */

(function () {
  'use strict';

  var tree       = null;
  var etudes     = [];
  var keyMapping = {};
  var current    = null;
  var history    = [];
  var maxDepth  = 1;

  function $(id) { return document.getElementById(id); }

  /* ════════════════════════════════════════════════════════════
     TABLE DE CORRESPONDANCE DES VALEURS
  ════════════════════════════════════════════════════════════ */
  var MAPPING = {
    'HER2+':       ['Positif','HER2+','positif','1'],
    'HER2-':       ['Négatif','HER2-','négatif','0','Negatif'],
    'RE+':         ['Positif','RE+','positif','élevés','eleves'],
    'RE-':         ['Négatif','RE-','négatif','0'],
    'élevés':      ['Positif','positif','élevés','RE+','RP+'],
    'RP-':         ['Négatif','RP-','négatif','0'],
    'T1a':         ['T1','T1a','T1, T2','T1, T2, T3','T1, T2, T3, T4','T4a, T3, T4b, T4c, T1, T2'],
    'T1b':         ['T1','T1b','T1, T2','T1, T2, T3','T1, T2, T3, T4','T4a, T3, T4b, T4c, T1, T2'],
    'T1c':         ['T1','T1c','T1, T2','T1, T2, T3','T1, T2, T3, T4'],
    'T2':          ['T2','T1, T2','T2, T3','T1, T2, T3','T4a, T3, T4b, T4c, T1, T2'],
    'T3':          ['T3','T2, T3','T1, T2, T3','T2, T3, T4'],
    'T4':          ['T4','T4d','T1, T2, T3, T4','T4a, T3, T4b, T4c, T1, T2'],
    'T4d':         ['T4','T4d','T1, T2, T3, T4','T4a, T3, T4b, T4c, T1, T2'],
    'Tis':         ['Tis','in situ','CCIS'],
    'N0':          ['N0','pN0','N0, N1','N2, N3, N0, N1'],
    'N+':          ['N+','pN+','pN1','pN1-3','N1','N2','N0, N1','N2, N3, N0, N1'],
    'Infiltrant':  ['Infiltrant','Infilitrant','invasif'],
    'Infilitrant': ['Infiltrant','Infilitrant','invasif'],
    'in situ':     ['in situ','Tis','CCIS'],
    '0':           ['0','pré-ménopausée','non ménopausée','0.0'],
    '1':           ['1','ménopausée','post-ménopausée','1.0'],
    'Radiothérapie':   ['Radiothérapie','RT','radiotherapie'],
    'Chimiothérapie':  ['Chimiothérapie','CT','CTadj','chimiotherapie'],
    'Hormonothérapie': ['Hormonothérapie','Tamoxifène','tamoxifene'],
    'Trastuzumab':     ['Trastuzumab','Herceptin','anti-HER2'],
    'RCP':             ['RCP','rcp'],
  };

  /* ════════════════════════════════════════════════════════════
     HELPERS
  ════════════════════════════════════════════════════════════ */

  function normaliser(v) {
    if (v === null || v === undefined) return '';
    return String(v).toLowerCase().trim();
  }

  function estJoker(v) {
    var n = normaliser(v);
    return n === 'nc' || n === '-1' || n === '-1.0' ||
           n === 'nan' || n === '' || n === 'n/a' || n === 'nr';
  }

  function valeurPatient(profil, nomCritere) {
    if (profil[nomCritere] !== undefined) return profil[nomCritere];
    var alts = keyMapping[nomCritere];
    if (alts) {
      for (var i = 0; i < alts.length; i++) {
        if (profil[alts[i]] !== undefined) return profil[alts[i]];
      }
    }
    var nC = normaliser(nomCritere);
    var cles = Object.keys(profil);
    for (var j = 0; j < cles.length; j++) {
      if (normaliser(cles[j]) === nC) return profil[cles[j]];
    }
    return undefined;
  }

  function matchCategoriel(vP, vE) {
    var nP = normaliser(vP);
    var nE = normaliser(vE);
    if (nP === nE) return 1;
    if (MAPPING[vP] && MAPPING[vP].map(normaliser).indexOf(nE) !== -1) return 1;
    if (MAPPING[vE] && MAPPING[vE].map(normaliser).indexOf(nP) !== -1) return 1;
    if (nE.indexOf(',') !== -1) {
      var parties = nE.split(',').map(function(p){ return p.trim(); });
      var eqP = MAPPING[vP] ? MAPPING[vP].map(normaliser) : [];
      for (var i = 0; i < parties.length; i++) {
        if (parties[i] === nP || eqP.indexOf(parties[i]) !== -1) return 1;
      }
    }
    return 0;
  }

  function matchNumerique(vP, vE) {
    var nP = normaliser(vP), nE = normaliser(vE);
    if (nP === nE) return 1;
    var numP = parseFloat(nP.replace(/[^0-9.-]/g,'')),
        numE = parseFloat(nE.replace(/[^0-9.-]/g,''));
    if (!isNaN(numP) && !isNaN(numE)) {
      if (numP === numE) return 1;
      if (Math.abs(numP-numE)/Math.max(Math.abs(numE),1) <= 0.2) return 0.5;
    }
    return 0;
  }

  /* ════════════════════════════════════════════════════════════
     PROFIL PATIENT
  ════════════════════════════════════════════════════════════ */

  function construireProfil() {
    var profil = {};
    history.forEach(function(h) {
      var q = (h.node && h.node.titre) ? h.node.titre : '';
      var r = h.label || '';
      if (q && r) profil[q] = r;
    });
    console.log('[Atlas] 👤 Profil :', JSON.stringify(profil));
    return profil;
  }

  function extraireTraitementsRecommandes(donnees) {
    var t = [];
    Object.keys(donnees || {}).forEach(function(k) {
      var v = String(donnees[k]||'').trim();
      if (v === '1' || v === '1.0') t.push(k.replace(/^OUT_/i,''));
    });
    console.log('[Atlas] 💊 Traitements recommandés :', t);
    return t;
  }

  /* ════════════════════════════════════════════════════════════
     CALCULER SCORE ÉTUDE
  ════════════════════════════════════════════════════════════ */

  function calculerScoreEtude(etude, profilPatient, traitementsRecommandes) {
    var NUMERIQUES = ['Ki67 (%)','ki67','Age','age','Marges (mm)','Marges et autres paramètres'];
    
    var criteres = etude.criteres || {};
    var pts = 0, evalues = 0;
    var colonnesGagnantes = [];
    var colonnesBloquantes = []; 

    Object.keys(criteres).forEach(function(nom) {
        var vE = criteres[nom];
        if (estJoker(vE)) { pts++; evalues++; colonnesGagnantes.push(nom); return; }

        var vP = valeurPatient(profilPatient, nom);
        
        if (vP === undefined || String(vP).trim() === '') {
            return; 
        }

        evalues++;
        var s = NUMERIQUES.indexOf(nom) !== -1 ? matchNumerique(vP, vE) : matchCategoriel(vP, vE);
        pts += s;
        
        if (s > 0) {
            colonnesGagnantes.push(nom);
        } else {
            colonnesBloquantes.push(nom); 
        }
    });

    var final = evalues === 0 ? 50 : Math.round((pts/evalues)*100);

    return { 
        valeur: final, 
        colonnes: colonnesGagnantes, 
        mismatches: colonnesBloquantes 
    };
  }

  /* ════════════════════════════════════════════════════════════
     CHARGEMENT JSON
  ════════════════════════════════════════════════════════════ */

  function depth(node, d) {
    if (!node || node.type === 'resultat' || !node.choix) return d;
    var keys = Object.keys(node.choix), max = d;
    for (var i = 0; i < keys.length; i++) {
      var sub = depth(node.choix[keys[i]], d+1);
      if (sub > max) max = sub;
    }
    return max;
  }

  function load() {
    var v = '?_v=' + Date.now();

    Promise.all([
      fetch('arbre_dynamique.json' + v).then(function(r) {
        if (!r.ok) throw new Error('arbre_dynamique.json HTTP ' + r.status);
        return r.json();
      }),
      fetch('base_etudes.json' + v).then(function(r) {
        if (!r.ok) throw new Error('base_etudes.json HTTP ' + r.status);
        return r.json();
      }).catch(function(err) {
        console.warn('[Atlas] base_etudes.json non disponible :', err.message);
        return null;
      })
    ]).then(function(results) {
      tree     = results[0];
      maxDepth = depth(tree, 0) || 1;

      var base = results[1];
      if (Array.isArray(base)) {
        etudes     = base;
        keyMapping = {};
      } else if (base && base.etudes) {
        etudes     = base.etudes  || [];
        keyMapping = base.mapping || {};
      } else {
        etudes     = [];
        keyMapping = {};
      }

      console.log('[Atlas] ✅ Arbre chargé, profondeur :', maxDepth);
      console.log('[Atlas] ✅ Études :', etudes.length, '| KeyMapping :', Object.keys(keyMapping).length, 'clés');

      var bs = $('btn-start'), bh = $('btn-start-hero');
      if (bs) { bs.disabled = false; bs.textContent = 'Commencer →'; }
      if (bh) { bh.disabled = false; bh.textContent = 'Commencer l\'évaluation →'; }
    }).catch(function(err) {
      console.error('[Atlas] ❌ Chargement :', err);
      alert('Impossible de charger les données.\nDétail : ' + err.message);
    });
  }

  /* ════════════════════════════════════════════════════════════
     NAVIGATION
  ════════════════════════════════════════════════════════════ */

  function show(id) {
    ['screen-home','screen-quiz','screen-results'].forEach(function(sid) {
      var el = $(sid);
      if (el) el.classList.toggle('active', sid === id);
    });
    window.scrollTo(0,0);
  }

  function demarrer() {
    if (!tree) { alert('Données en cours de chargement. Réessayez.'); return; }
    history = []; current = tree;
    show('screen-quiz');
    render(current);
  }

  function reculer() {
    if (!history.length) return;
    var prev = history.pop();
    current  = prev.node;
    render(current);
  }

  function recommencer() {
    history = []; current = null;
    ['quiz-choices','results-grid','results-path'].forEach(function(id) {
      var el = $(id); if (el) el.innerHTML = '';
    });
    var s = $('etudes-section'); if (s) s.innerHTML = '';
    show('screen-home');
  }

  /* ════════════════════════════════════════════════════════════
     AFFICHER UN NŒUD
  ════════════════════════════════════════════════════════════ */

  function render(node) {
    if (node.type === 'resultat') { renderResults(node); return; }

    $('quiz-question').textContent = node.titre || '(Question sans titre)';

    var step = history.length + 1, total = maxDepth || step;
    var pct  = Math.round(Math.max(0, (step-1)/total) * 100);

    $('quiz-step-label').textContent   = 'Étape ' + step + ' / ' + total;
    $('quiz-pct-label').textContent    = pct + ' %';
    $('quiz-progress-bar').style.width = pct + '%';
    $('btn-back').style.display        = history.length > 0 ? 'inline-flex' : 'none';

    var container = $('quiz-choices');
    container.innerHTML = '';
    var keys = Object.keys(node.choix || {});
    if (!keys.length) {
      container.innerHTML = '<p style="color:#636e72;font-style:italic;">Aucune option disponible.</p>';
      return;
    }

    keys.forEach(function(label) {
      var next = node.choix[label];
      var btn  = document.createElement('button');
      btn.className = 'choice-btn';
      var txt = document.createElement('span'); txt.textContent = label;
      var arr = document.createElement('span');
      arr.className = 'arrow'; arr.textContent = '→';
      arr.setAttribute('aria-hidden','true');
      btn.appendChild(txt); btn.appendChild(arr);
      btn.addEventListener('click', (function(l,n) {
        return function() { history.push({node:current,label:l}); current=n; render(current); };
      }(label, next)));
      container.appendChild(btn);
    });
  }

  /* ════════════════════════════════════════════════════════════
     RÉSULTATS
  ════════════════════════════════════════════════════════════ */

  function cls(val) {
    var v = String(val||'').trim();
    if (v==='1'||v==='1.0') return 'rec';
    if (v==='0'||v==='0.0') return 'nrec';
    return 'ns';
  }

  function badge(val) {
    var v = String(val||'').trim();
    if (v==='1'||v==='1.0') return '✓ Recommandé';
    if (v==='0'||v==='0.0') return '✗ Non recommandé';
    return 'Non spécifié';
  }

  function renderResults(node) {
    var donnees = node.donnees || {};
    var sourceSenorif = node.source_senorif || "Référentiel SENORIF (Arbre non précisé)";

    $('quiz-progress-bar').style.width = '100%';
    $('quiz-pct-label').textContent    = '100 %';
    $('quiz-step-label').textContent   = 'Terminé';

    /* Parcours */
    var pathEl = $('results-path');
    pathEl.innerHTML = '';
    if (!history.length) {
      pathEl.textContent = 'Résultat direct';
    } else {
      history.forEach(function(h,i) {
        if (i > 0) {
          var sep = document.createElement('span');
          sep.className = 'path-sep'; sep.textContent = '›';
          pathEl.appendChild(sep);
        }
        var s = document.createElement('span');
        s.className = 'path-step'; s.textContent = h.label;
        pathEl.appendChild(s);
      });
    }

    /* Grille SENORIF */
    var grid = $('results-grid');
    grid.innerHTML = '';

    var sourceDiv = document.createElement('div');
    sourceDiv.style.cssText = 'grid-column: 1 / -1; margin-bottom: 16px; font-size: 13px; color: #636e72; display: flex; align-items: center; gap: 8px;';
    sourceDiv.innerHTML = '<strong>📄 Source :</strong> ' + sourceSenorif;
    grid.appendChild(sourceDiv);

    var entries = Object.keys(donnees).map(function(k) {
      return {name: k.replace(/^OUT_/i,''), val: donnees[k], cls: cls(donnees[k])};
    });
    entries.sort(function(a,b) { return ({rec:0,nrec:1,ns:2}[a.cls]) - ({rec:0,nrec:1,ns:2}[b.cls]); });

    if (!entries.length) {
      grid.innerHTML += '<p style="color:#636e72;">Aucune donnée disponible.</p>';
    } else {
      entries.forEach(function(e) {
        var card = document.createElement('div');
        card.className = 'result-card ' + e.cls;
        var h4 = document.createElement('h4'); h4.textContent = e.name;
        var b  = document.createElement('span');
        b.className = 'badge ' + e.cls; b.textContent = badge(e.val);
        card.appendChild(h4); card.appendChild(b);
        grid.appendChild(card);
      });
    }

    show('screen-results');

    try {
      var profil = construireProfil();
      var traitements = extraireTraitementsRecommandes(donnees);
      renderEtudes(profil, traitements);
    } catch(err) {
      console.error('[Atlas] ❌ Erreur renderEtudes :', err);
    }
  }

  /* ════════════════════════════════════════════════════════════
     ÉTUDES
  ════════════════════════════════════════════════════════════ */

  var SEUIL_SCORE = 40;

  function renderEtudes(profil, traitementsRecommandes) {
    var section = $('etudes-section');
    if (!section) return;
    section.innerHTML = '';

    if (!etudes || !etudes.length) {
      section.innerHTML = '<p style="color:#636e72;font-size:13px;margin-top:24px;">Aucune étude disponible.</p>';
      return;
    }

    var scored = etudes.map(function(e) {
      var resultat = calculerScoreEtude(e, profil, traitementsRecommandes);
      return { 
          etude: e, 
          score: resultat.valeur,
          colonnes: resultat.colonnes,
          mismatches: resultat.mismatches
      };
    });

    var retenues = scored
      .filter(function(e) { return e.score >= SEUIL_SCORE; })
      .sort(function(a,b) { return b.score - a.score; });

    var h3 = document.createElement('h3');
    h3.textContent = 'Données issues de la littérature';
    h3.style.cssText = 'font-size:18px;font-weight:700;margin:32px 0 8px;';
    section.appendChild(h3);

    retenues.forEach(function(item) { 
        section.appendChild(creerCarteEtude(item.etude, item.score, item.colonnes, item.mismatches)); 
    });
  }

  /* ════════════════════════════════════════════════════════════
     HELPERS D'AFFICHAGE ET CARTE ÉTUDE
  ════════════════════════════════════════════════════════════ */
  
  function expliquerScore(colonnes, mismatches) {
    var totalCriteres = colonnes.length + mismatches.length;
    if (totalCriteres === 0) return "";
    
    return "<strong>Calcul du match :</strong> " + colonnes.length + " critère(s) validé(s) sur un total de " + totalCriteres + " analysés.";
  }

  function creerCarteEtude(etude, score, colonnes, mismatches) {
    var card = document.createElement('div');
    card.style.cssText = 'background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin-bottom:16px;';
    
    var comp = etude.comparaison || { avec: {valeur: 0}, sans: {valeur: 0} };
    var valAvec = comp.avec.valeur || 0;
    var valSans = comp.sans.valeur || 0;
    
    var wAvec = valAvec;
    var wSans = valSans;

    card.innerHTML =
      '<div class="etude-flex" style="display:flex; justify-content:space-between; align-items:flex-start; gap:40px;">' +
        
        // Bloc de gauche : Titre + Bouton + Détails cachés
        '<div style="flex:1;">' +
          '<h4 style="margin:0 0 12px 0; font-size:16px; color:#1a1a1a;">' + (etude.reference || etude.titre) + '</h4>' +
          
          '<button class="btn btn-ghost btn-toggle" style="padding: 6px 12px; font-size: 12px; margin-bottom: 12px;">Voir les détails ↓</button>' +
          
          '<div class="zone-details" style="display:none; padding-top: 8px;">' +
            '<div style="background: #f8f9fa; padding: 10px 14px; border-radius: 8px; font-size: 13px; color: #636e72; margin-bottom: 16px; display:inline-block;">' +
                 expliquerScore(colonnes, mismatches) +
            '</div>' +
            (colonnes.length > 0 ? '<div style="color:#16a34a; font-size:13.5px; margin-bottom:6px;">✅ Match : ' + colonnes.join(', ') + '</div>' : '') +
            (mismatches && mismatches.length > 0 ? '<div style="color:#dc2626; font-size:13.5px; margin-bottom:12px;">❌ Non-match : ' + mismatches.join(', ') + '</div>' : '') +
            (etude.lien ? '<a href="'+etude.lien+'" target="_blank" style="font-size:13.5px; color:#2563eb; text-decoration:none; font-weight:500;">Voir l\'article →</a>' : '') +
          '</div>' +
        '</div>' +
        
        // Bloc de droite : Barres de traitement (Modifié pour la survie et la radiothérapie)
        '<div class="etude-bars" style="width: 260px; flex-shrink:0;">' +
          '<div style="font-size: 11px; font-weight: 700; color: #636e72; text-transform: uppercase; margin-bottom: 10px; letter-spacing: 0.05em;">📊 Taux de survie à 5 ans / 10 ans</div>' +
          
          '<div class="barre-header" style="margin-bottom:4px;"><span>Avec Radiothérapie</span><span>' + valAvec + '%</span></div>' +
          '<div class="barre-track" style="background-color:#e5e7eb; height:8px;"><div class="barre-fill bonne" style="width:' + wAvec + '%;"></div></div>' +
                    
          '<div class="barre-header" style="margin-top:18px; margin-bottom:4px;"><span>Sans Radiothérapie</span><span>' + valSans + '%</span></div>' +
          '<div class="barre-track" style="background-color:#e5e7eb; height:8px;"><div class="barre-fill mauvaise" style="width:' + wSans + '%;"></div></div>' +
        '</div>' +
        
      '</div>';

    var btnToggle = card.querySelector('.btn-toggle');
    var zoneDetails = card.querySelector('.zone-details');

    if (btnToggle && zoneDetails) {
      btnToggle.addEventListener('click', function() {
        if (zoneDetails.style.display === 'none') {
          zoneDetails.style.display = 'block';
          btnToggle.textContent = 'Cacher les détails ↑';
          btnToggle.style.background = '#f8f9fa';
        } else {
          zoneDetails.style.display = 'none';
          btnToggle.textContent = 'Voir les détails ↓';
          btnToggle.style.background = 'transparent';
        }
      });
    }

    return card;
  }

  /* ════════════════════════════════════════════════════════════
     EXPOSITION GLOBALE
  ════════════════════════════════════════════════════════════ */
  window.demarrer         = demarrer;
  window.reculer          = reculer;
  window.recommencer      = recommencer;
  window.accueil          = recommencer;
  window.calculerScoreEtude = calculerScoreEtude;

  load();

}());
