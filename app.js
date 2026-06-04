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
    // ... [Ton code de filtre traitement reste identique] ...

    var criteres = etude.criteres || {};
    var colonnesGagnantes = [];
    var colonnesBloquantes = []; // NOUVEAU : On stocke les mismatches

    Object.keys(criteres).forEach(function(nom) {
        var vE = criteres[nom];
        if (estJoker(vE)) {
            colonnesGagnantes.push(nom);
            return;
        }

        var vP = valeurPatient(profilPatient, nom);
        if (vP === undefined || String(vP).trim() === '') return;

        var s = NUMERIQUES.indexOf(nom) !== -1 ? matchNumerique(vP, vE) : matchCategoriel(vP, vE);
        
        if (s > 0) {
            colonnesGagnantes.push(nom);
        } else {
            // NOUVEAU : Si ça ne matche pas, on enregistre le nom du critère
            colonnesBloquantes.push(nom);
        }
    });

    return { 
        valeur: final, 
        colonnes: colonnesGagnantes, 
        mismatches: colonnesBloquantes // On renvoie la liste des erreurs
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
     ÉTUDES
  ════════════════════════════════════════════════════════════ */

  var SEUIL_SCORE = 40;

  function renderEtudes(profil, traitementsRecommandes) {
    var section = $('etudes-section');
    if (!section) return;
    section.innerHTML = '';

    if (!etudes || !etudes.length) {
      section.innerHTML =
        '<p style="color:#636e72;font-size:13px;margin-top:24px;">Aucune base d\'études disponible.</p>';
      return;
    }

    var scored = etudes.map(function(e) {
      var resultat = calculerScoreEtude(e, profil, traitementsRecommandes);
      return { 
          etude: e, 
          score: resultat.valeur,
          colonnes: resultat.colonnes,
          mismatches: resultat.mismatches // Ajout ici
      };
    });

    var retenues = scored
      .filter(function(e) { return e.score >= SEUIL_SCORE; })
      .sort(function(a,b) {
        if (b.score !== a.score) return b.score - a.score;
        return (parseInt(a.etude.niveau_preuve)||99) - (parseInt(b.etude.niveau_preuve)||99);
      });

    console.log('[Atlas] 📊 Études retenues :', retenues.length + '/' + etudes.length);

    if (!retenues.length) {
      section.innerHTML =
        '<div style="margin-top:32px;padding:20px;background:#f8f9fa;border-radius:12px;text-align:center;">' +
        '<p style="color:#636e72;font-size:13px;">Aucune étude correspondant à ce profil (seuil : '+SEUIL_SCORE+'%).</p></div>';
      return;
    }

    var h3 = document.createElement('h3');
    h3.textContent = 'Données issues de la littérature';
    h3.style.cssText = 'font-size:18px;font-weight:700;margin:32px 0 8px;';
    section.appendChild(h3);

    var p = document.createElement('p');
    p.textContent = retenues.length + ' étude(s) — classées par pertinence';
    p.style.cssText = 'font-size:13px;color:#636e72;margin-bottom:16px;';
    section.appendChild(p);

    retenues.forEach(function(item) { 
        section.appendChild(creerCarteEtude(item.etude, item.score, item.colonnes)); 
    });
  }

  /* ════════════════════════════════════════════════════════════
     CARTE ÉTUDE
  ════════════════════════════════════════════════════════════ */

  function scoreCouleur(s) { return s>=80?'#16a34a':s>=60?'#d97706':'#6b7280'; }

  function creerTag(t, bg, c) {
    return '<span style="display:inline-block;padding:2px 10px;border-radius:99px;' +
           'font-size:11px;font-weight:500;background:'+bg+';color:'+c+';">'+t+'</span>';
  }

  function creerCarteEtude(etude, score, colonnes) {
    var card = document.createElement('div');
    card.style.cssText =
      'background:#fff;border:1px solid #e5e7eb;border-left:4px solid '+scoreCouleur(score)+';' +
      'border-radius:12px;padding:18px 20px;margin-bottom:12px;cursor:pointer;transition:box-shadow .15s;';
    card.onmouseenter = function() { this.style.boxShadow='0 4px 16px rgba(0,0,0,0.1)'; };
    card.onmouseleave = function() { this.style.boxShadow='none'; };

    var ttt = (etude.traitements_evalues && etude.traitements_evalues.length)
      ? creerTag(etude.traitements_evalues[0],'#fce7f3','#9d174d') : '';
    var ref = (etude.reference||etude.auteur||'').substring(0,60);
    
    // Formatage du texte des colonnes gagnantes
    var textColonnes = colonnes && colonnes.length > 0 ? colonnes.join(', ') : 'Aucun critère spécifique';

  card.innerHTML += 
    '<div class="etude-detail" style="display:none;margin-top:14px;padding-top:14px;border-top:1px solid #e5e7eb;">' +
      (colonnes.length > 0 ? '<p style="color:var(--green)">✅ Match : ' + colonnes.join(', ') + '</p>' : '') +
      (colonnesBloquantes.length > 0 ? '<p style="color:#dc2626">❌ Non-match : ' + colonnesBloquantes.join(', ') + '</p>' : '') +
      (etude.lien ? '<br><a href="'+etude.lien+'" target="_blank">Voir l\'article →</a>' : '') +
    '</div>';
    var ouvert = false;
    card.addEventListener('click', function() {
      ouvert = !ouvert;
      card.querySelector('.etude-detail').style.display = ouvert ? 'block' : 'none';
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
