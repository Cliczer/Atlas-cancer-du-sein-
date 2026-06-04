/*
 * Atlas Pronostics — app.js
 * Vanilla JS pur, aucune dépendance.
 */

(function () {
  'use strict';

  var tree      = null;
  var etudes    = [];
  var keyMapping = {};
  var current   = null;
  var history   = [];
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

  /* Résout la valeur patient en tenant compte du keyMapping */
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
    var nom = (etude.reference||etude.auteur||'').substring(0,40) + ' — ' + (etude.objectif||etude.titre||'');
    console.group('[Atlas] 🔬 ' + nom);

    // 1. Définition de la variable manquante ici pour être sûr qu'elle existe
    var NUMERIQUES = ['Ki67 (%)','ki67','Age','age','Marges (mm)','Marges et autres paramètres'];

    /* Filtre traitement */
    var tE = etude.traitements_evalues;
    if (tE && Array.isArray(tE) && tE.length > 0) {
        var match = false;
        traitementsRecommandes.forEach(function(tR) {
            var eqR = MAPPING[tR] ? MAPPING[tR].map(normaliser) : [];
            eqR.push(normaliser(tR));
            tE.forEach(function(t) {
                if (eqR.indexOf(normaliser(t)) !== -1) match = true;
            });
        });
        if (!match) {
            console.groupEnd();
            return { valeur: 0, colonnes: [], mismatches: [] };
        }
    }

    /* Scoring */
    var criteres = etude.criteres || {};
    var pts = 0, evalues = 0;
    var colonnesGagnantes = [];
    var colonnesBloquantes = [];

    Object.keys(criteres).forEach(function(nomCritere) {
        var vE = criteres[nomCritere];
        if (estJoker(vE)) {
            pts++; evalues++; colonnesGagnantes.push(nomCritere);
            return;
        }

        var vP = valeurPatient(profilPatient, nomCritere);
        if (vP === undefined || String(vP).trim() === '') return;

        evalues++;
        // Maintenant NUMERIQUES est bien connu ici
        var s = NUMERIQUES.indexOf(nomCritere) !== -1 ? matchNumerique(vP, vE) : matchCategoriel(vP, vE);
        pts += s;
        
        if (s > 0) colonnesGagnantes.push(nomCritere);
        else colonnesBloquantes.push(nomCritere);
    });

    var final = evalues === 0 ? 50 : Math.round((pts/evalues)*100);
    console.groupEnd();

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

      /* ── Lecture base_etudes.json ──
         Supporte :
           Format A : [ {etude}, ... ]
           Format B : { mapping: {...}, etudes: [...] }   ← ton format
      ────────────────────────────────── */
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
    if (node.type === 'resultat') { renderResults(node.donnees); return; }

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

  function renderResults(donnees) {
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
    var entries = Object.keys(donnees||{}).map(function(k) {
      return {name: k.replace(/^OUT_/i,''), val: donnees[k], cls: cls(donnees[k])};
    });
    entries.sort(function(a,b) { return ({rec:0,nrec:1,ns:2}[a.cls]) - ({rec:0,nrec:1,ns:2}[b.cls]); });

    if (!entries.length) {
      grid.innerHTML = '<p style="color:#636e72;">Aucune donnée disponible.</p>';
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

    /* ── IMPORTANT : show() AVANT renderEtudes()
       Si renderEtudes plante, les recommandations SENORIF
       sont déjà visibles — l'écran ne reste pas bloqué.
    ────────────────────────────────────────────── */
    show('screen-results');

    /* Études (dans un try/catch pour ne pas bloquer l'affichage) */
    try {
      var profil = construireProfil();
      var traitements = extraireTraitementsRecommandes(donnees);
      renderEtudes(profil, traitements);
    } catch(err) {
      console.error('[Atlas] ❌ Erreur renderEtudes :', err);
    }
  }

  /* ════════════════════════════════════════════════════════════
     ÉTUDES — CORRIGÉ
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
          mismatches: resultat.mismatches // On récupère bien les erreurs
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
     CARTE ÉTUDE — AVEC BARRES ET MATCHING
  ════════════════════════════════════════════════════════════ */

  function creerCarteEtude(etude, score, colonnes, mismatches) {
    var card = document.createElement('div');
    card.style.cssText = 'background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:18px 20px;margin-bottom:12px;cursor:pointer;';
    
    // Données comparaison
    var comp = etude.comparaison || { avec: {valeur: 0}, sans: {valeur: 0} };
    var max = Math.max(comp.avec.valeur, comp.sans.valeur) || 1;
    var wAvec = Math.round((comp.avec.valeur / max) * 100);
    var wSans = Math.round((comp.sans.valeur / max) * 100);

    card.innerHTML =
      '<div style="display:flex; justify-content:space-between; align-items:center;">' +
        '<div style="flex:1; padding-right:20px;">' +
          '<h4 style="margin-bottom:4px;">' + (etude.reference || etude.titre) + '</h4>' +
        '</div>' +
        '<div style="width: 180px;">' +
          '<div class="barre-header"><span class="barre-label">Avec</span><span class="barre-valeur">' + comp.avec.valeur + '%</span></div>' +
          '<div class="barre-track"><div class="barre-fill bonne" style="width:' + wAvec + '%"></div></div>' +
          '<div class="barre-header" style="margin-top:8px;"><span class="barre-label">Sans</span><span class="barre-valeur">' + comp.sans.valeur + '%</span></div>' +
          '<div class="barre-track"><div class="barre-fill mauvaise" style="width:' + wSans + '%"></div></div>' +
        '</div>' +
      '</div>' +
      '<div class="etude-detail" style="display:none; margin-top:15px; border-top:1px solid #eee; padding-top:10px;">' +
        (colonnes.length > 0 ? '<p style="color:var(--green); font-size:12px; margin-bottom:4px;">✅ Match : ' + colonnes.join(', ') + '</p>' : '') +
        (mismatches && mismatches.length > 0 ? '<p style="color:#dc2626; font-size:12px;">❌ Non-match : ' + mismatches.join(', ') + '</p>' : '') +
        (etude.lien ? '<a href="'+etude.lien+'" target="_blank" style="display:block; margin-top:8px; font-size:12px;">Voir l\'article →</a>' : '') +
      '</div>';

    card.addEventListener('click', function() {
      var detail = card.querySelector('.etude-detail');
      detail.style.display = (detail.style.display === 'none') ? 'block' : 'none';
    });
    return card;
  }
  /* ════════════════════════════════════════════════════════════
     EXPOSITION GLOBALE
  ════════════════════════════════════════════════════════════ */
  window.demarrer           = demarrer;
  window.reculer            = reculer;
  window.recommencer        = recommencer;
  window.accueil            = recommencer;
  window.calculerScoreEtude = calculerScoreEtude;

  load();

}());
