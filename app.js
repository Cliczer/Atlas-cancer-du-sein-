/*
 * Atlas Pronostics — app.js
 * Vanilla JS pur, aucune dépendance.
 *
 * CONTRAT avec index.html (IDs immuables) :
 *   Écrans    : #screen-home  #screen-quiz  #screen-results
 *   Accueil   : #btn-start  #btn-start-hero
 *   Quiz      : #quiz-question  #quiz-choices  #quiz-step-label
 *               #quiz-pct-label  #quiz-progress-bar  #btn-back
 *   Résultats : #results-path  #results-grid  #etudes-section
 */

(function () {
  'use strict';

  /* ════════════════════════════════════════════════════════════
     ÉTAT GLOBAL
  ════════════════════════════════════════════════════════════ */
  var tree      = null;
  var etudes    = [];
  var current   = null;
  var history   = [];
  var maxDepth  = 1;

  function $(id) { return document.getElementById(id); }

  /* ════════════════════════════════════════════════════════════
     1. TABLE DE CORRESPONDANCE (arbre → études)
     Traduit les valeurs de l'arbre vers leurs équivalents
     dans la base d'études. Le -1 / NC restent des jokers.
  ════════════════════════════════════════════════════════════ */
  var MAPPING = {
    /* HER2 */
    'HER2+':       ['Positif','HER2+','positif','her2+','1'],
    'HER2-':       ['Négatif','HER2-','négatif','her2-','0','Negatif'],
    /* RE / RP */
    'RE+':         ['Positif','RE+','positif','élevés','eleves'],
    'RE-':         ['Négatif','RE-','négatif','negatif','0'],
    'élevés':      ['Positif','positif','élevés','eleves','RE+','RP+'],
    'RP-':         ['Négatif','RP-','négatif','0'],
    /* T */
    'T1a':         ['T1','T1a','T1, T2','T1, T2, T3','T1, T2, T3, T4','T2, T1'],
    'T1b':         ['T1','T1b','T1, T2','T1, T2, T3','T1, T2, T3, T4','T2, T1'],
    'T1c':         ['T1','T1c','T1, T2','T1, T2, T3','T1, T2, T3, T4'],
    'T2':          ['T2','T1, T2','T2, T3','T1, T2, T3','T2, T3, T4','T0, T1, T4, T2, T3'],
    'T3':          ['T3','T2, T3','T1, T2, T3','T2, T3, T4'],
    'T4':          ['T4','T4d','T1, T2, T3, T4','T2, T3, T4','T4a, T3, T4b, T4c, T1, T2'],
    'T4d':         ['T4','T4d','T1, T2, T3, T4','T2, T3, T4'],
    'Tis':         ['Tis','in situ','CCIS'],
    /* N */
    'N0':          ['N0','pN0','N0, N1','pN0, pN+'],
    'N+':          ['N+','pN+','pN1','pN1-3','N1','N2','N0, N1','N2, N3, N0, N1','pN0, pN+'],
    'pN0':         ['pN0','N0','N0, N1'],
    'pN1':         ['pN1','pN1-3','N+','pN+','N1'],
    /* Carcinome */
    'Infiltrant':  ['Infiltrant','Infilitrant','invasif','invasive'],
    'Infilitrant': ['Infiltrant','Infilitrant','invasif','invasive'],
    'in situ':     ['in situ','Tis','CCIS','carcinome in situ'],
    /* Ménopause */
    '0':           ['0','pré-ménopausée','pre-menopausee','non ménopausée','0.0'],
    '1':           ['1','ménopausée','menopausee','post-ménopausée','1.0'],
    /* Traitements (correspondances souples) */
    'Radiothérapie':   ['Radiothérapie','RT','radiotherapie','radiation'],
    'Chimiothérapie':  ['Chimiothérapie','CT','CTadj','chimiotherapie','chemotherapy'],
    'Hormonothérapie': ['Hormonothérapie','Hormonotherapie','Tamoxifène','tamoxifene','hormone'],
    'Chirurgie':       ['Chirurgie','chirurgie_mammaire','MT','MP','TSSM','mastectomie'],
    'Trastuzumab':     ['Trastuzumab','trastuzumab','Herceptin','anti-HER2','immunotherapie'],
    'RCP':             ['RCP','rcp','concertation'],
  };

  /* ════════════════════════════════════════════════════════════
     2. HELPERS DE MATCHING
  ════════════════════════════════════════════════════════════ */

  function normaliser(v) {
    if (v === null || v === undefined) return '';
    return String(v).toLowerCase().trim();
  }

  /** Valeurs joker : l'étude ne filtre pas sur ce critère */
  function estJoker(v) {
    var n = normaliser(v);
    return (n === 'nc' || n === '-1' || n === '-1.0' ||
            n === 'nan' || n === '' || n === 'n/a' || n === 'nr');
  }

  /** Compare deux valeurs catégorielles via le mapping. Retourne 0 ou 1. */
  function matchCategoriel(vP, vE) {
    var nP = normaliser(vP);
    var nE = normaliser(vE);

    if (nP === nE) return 1;

    /* Équivalents du côté patient */
    if (MAPPING[vP]) {
      var eqP = MAPPING[vP].map(normaliser);
      if (eqP.indexOf(nE) !== -1) return 1;
    }

    /* Équivalents du côté étude */
    if (MAPPING[vE]) {
      var eqE = MAPPING[vE].map(normaliser);
      if (eqE.indexOf(nP) !== -1) return 1;
    }

    /* L'étude liste plusieurs valeurs séparées par virgule : "T1, T2, T3" */
    if (nE.indexOf(',') !== -1) {
      var parties = nE.split(',').map(function(p) { return p.trim(); });
      var eqPat   = MAPPING[vP] ? MAPPING[vP].map(normaliser) : [];
      for (var i = 0; i < parties.length; i++) {
        if (parties[i] === nP) return 1;
        if (eqPat.indexOf(parties[i]) !== -1) return 1;
      }
    }

    return 0;
  }

  /** Compare des valeurs numériques ou plages. Retourne 1, 0.5 ou 0. */
  function matchNumerique(vP, vE) {
    var nP = normaliser(vP);
    var nE = normaliser(vE);

    if (nP === nE) return 1;

    var numP = parseFloat(nP.replace(/[^0-9.-]/g, ''));
    var numE = parseFloat(nE.replace(/[^0-9.-]/g, ''));

    if (!isNaN(numP) && !isNaN(numE)) {
      if (numP === numE) return 1;
      if (Math.abs(numP - numE) / Math.max(Math.abs(numE), 1) <= 0.2) return 0.5;
    }
    return 0;
  }

  /* ════════════════════════════════════════════════════════════
     3. PROFIL PATIENT depuis l'historique de navigation
  ════════════════════════════════════════════════════════════ */

  function construireProfil() {
    var profil = {};
    history.forEach(function(h) {
      var question = (h.node && h.node.titre) ? h.node.titre : '';
      var reponse  = h.label || '';
      if (question && reponse) profil[question] = reponse;
    });
    console.log('[Atlas] 👤 Profil patient :', profil);
    return profil;
  }

  function extraireTraitementsRecommandes(donnees) {
    var traitements = [];
    Object.keys(donnees || {}).forEach(function(k) {
      var v = String(donnees[k] || '').trim();
      if (v === '1' || v === '1.0') {
        traitements.push(k.replace(/^OUT_/i, ''));
      }
    });
    console.log('[Atlas] 💊 Traitements recommandés :', traitements);
    return traitements;
  }

  /* ════════════════════════════════════════════════════════════
     4. CALCULER SCORE ÉTUDE
     ─────────────────────────────────────────────────────────
     Règles :
       • Joker (NC / -1 / nan / '') → +1 automatique
       • Critère absent du profil patient → ignoré (pas de pénalité)
       • match parfait → +1
       • match partiel → +0.5
       • pas de match → +0
       • Score final = (points / critères évalués) × 100
  ════════════════════════════════════════════════════════════ */

  function calculerScoreEtude(etude, profilPatient, mapping, traitementsRecommandes) {
    var nomEtude = [
      etude.auteur || '',
      etude.annee  || '',
      '—',
      etude.objectif || etude.titre || 'sans titre'
    ].join(' ');

    console.group('[Atlas] 🔬 ' + nomEtude);

    /* ── ÉTAPE 1 : Filtre traitement (assoupli) ── */
    var traitementsEtude = etude.traitements_evalues;

    if (!traitementsEtude || !Array.isArray(traitementsEtude) || traitementsEtude.length === 0) {
      console.warn('  ⚠️  traitements_evalues absent ou vide → filtre ignoré');
    } else {
      var traitementMatch = false;

      traitementsRecommandes.forEach(function(tR) {
        var eqR = MAPPING[tR] ? MAPPING[tR].map(normaliser) : [];
        eqR.push(normaliser(tR));

        traitementsEtude.forEach(function(tE) {
          var nTE = normaliser(tE);
          if (eqR.indexOf(nTE) !== -1) { traitementMatch = true; }
          if (MAPPING[tE]) {
            var eqE = MAPPING[tE].map(normaliser);
            if (eqE.indexOf(normaliser(tR)) !== -1) { traitementMatch = true; }
          }
        });
      });

      if (!traitementMatch) {
        console.log('  ❌ Traitement non pertinent → 0');
        console.log('     Recommandés :', traitementsRecommandes, '| Étude :', traitementsEtude);
        console.groupEnd();
        return 0;
      }
      console.log('  ✅ Filtre traitement : OK');
    }

    /* ── ÉTAPE 2 : Scoring critère par critère ── */
    var criteresEtude   = etude.criteres || {};
    var scorePoints     = 0;
    var criteresEvalues = 0;
    var NUMERIQUES      = ['Ki67 (%)', 'ki67', 'Age', 'age', 'Marges (mm)', 'marges'];

    Object.keys(criteresEtude).forEach(function(nomCritere) {
      var vE = criteresEtude[nomCritere];

      /* Joker → match automatique */
      if (estJoker(vE)) {
        scorePoints     += 1;
        criteresEvalues += 1;
        console.log('  🃏 [' + nomCritere + '] Joker (' + vE + ') → +1');
        return;
      }

      /* Critère absent du profil patient → ignoré */
      var vP = profilPatient[nomCritere];
      if (vP === undefined || vP === null || String(vP).trim() === '') {
        console.log('  ⏭️  [' + nomCritere + '] Absent du profil → ignoré');
        return;
      }

      criteresEvalues += 1;

      var score = (NUMERIQUES.indexOf(nomCritere) !== -1)
        ? matchNumerique(vP, vE)
        : matchCategoriel(vP, vE);

      scorePoints += score;

      if (score === 1) {
        console.log('  ✅ [' + nomCritere + '] "' + vP + '" vs "' + vE + '" → +1');
      } else if (score === 0.5) {
        console.log('  🟡 [' + nomCritere + '] "' + vP + '" vs "' + vE + '" → +0.5');
      } else {
        console.log('  ❌ [' + nomCritere + '] "' + vP + '" vs "' + vE + '" → +0');
      }
    });

    /* ── ÉTAPE 3 : Score final ── */
    var scoreFinal = (criteresEvalues === 0)
      ? 50  // aucun critère évaluable → score neutre
      : Math.round((scorePoints / criteresEvalues) * 100);

    console.log('  📊 ' + scorePoints + ' pts / ' + criteresEvalues + ' critères = ' + scoreFinal + '%');
    console.groupEnd();

    return scoreFinal;
  }

  /* ════════════════════════════════════════════════════════════
     5. CHARGEMENT DES JSON (en parallèle)
  ════════════════════════════════════════════════════════════ */

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
      fetch('arbre_dynamique.json' + v)
        .then(function(r) {
          if (!r.ok) throw new Error('arbre_dynamique.json HTTP ' + r.status);
          return r.json();
        }),
      fetch('base_etudes.json' + v)
        .then(function(r) {
          if (!r.ok) throw new Error('base_etudes.json HTTP ' + r.status);
          return r.json();
        })
        .catch(function(err) {
          console.warn('[Atlas] base_etudes.json non disponible :', err.message);
          return [];
        })
    ]).then(function(results) {
      tree     = results[0];
      etudes   = results[1] || [];
      maxDepth = depth(tree, 0) || 1;

      console.log('[Atlas] ✅ Arbre chargé. Profondeur max :', maxDepth);
      console.log('[Atlas] ✅ Études chargées :', etudes.length);

      var bs = $('btn-start');
      var bh = $('btn-start-hero');
      if (bs) { bs.disabled = false; bs.textContent = 'Commencer →'; }
      if (bh) { bh.disabled = false; bh.textContent = 'Commencer l\'évaluation →'; }
    }).catch(function(err) {
      console.error('[Atlas] ❌ Chargement :', err);
      alert('Impossible de charger les données.\nDétail : ' + err.message);
    });
  }

  /* ════════════════════════════════════════════════════════════
     6. NAVIGATION
  ════════════════════════════════════════════════════════════ */

  function show(id) {
    ['screen-home', 'screen-quiz', 'screen-results'].forEach(function(sid) {
      var el = $(sid);
      if (!el) return;
      el.classList.toggle('active', sid === id);
    });
    window.scrollTo(0, 0);
  }

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

  function reculer() {
    if (history.length === 0) return;
    var prev = history.pop();
    current  = prev.node;
    render(current);
  }

  function recommencer() {
    history = [];
    current = null;
    $('quiz-choices').innerHTML = '';
    $('results-grid').innerHTML = '';
    $('results-path').innerHTML = '';
    var s = $('etudes-section');
    if (s) s.innerHTML = '';
    show('screen-home');
  }

  /* ════════════════════════════════════════════════════════════
     7. AFFICHER UN NŒUD
  ════════════════════════════════════════════════════════════ */

  function render(node) {
    if (node.type === 'resultat') {
      renderResults(node.donnees);
      return;
    }

    $('quiz-question').textContent = node.titre || '(Question sans titre)';

    var step  = history.length + 1;
    var total = maxDepth || step;
    var pct   = Math.round(Math.max(0, (step - 1) / total) * 100);

    $('quiz-step-label').textContent   = 'Étape ' + step + ' / ' + total;
    $('quiz-pct-label').textContent    = pct + ' %';
    $('quiz-progress-bar').style.width = pct + '%';
    $('btn-back').style.display        = history.length > 0 ? 'inline-flex' : 'none';

    var container = $('quiz-choices');
    container.innerHTML = '';

    var keys = Object.keys(node.choix || {});
    if (keys.length === 0) {
      container.innerHTML = '<p style="color:#636e72;font-style:italic;">Aucune option disponible.</p>';
      return;
    }

    keys.forEach(function(label) {
      var next = node.choix[label];
      var btn  = document.createElement('button');
      btn.className = 'choice-btn';

      var txt = document.createElement('span');
      txt.textContent = label;
      btn.appendChild(txt);

      var arr = document.createElement('span');
      arr.className   = 'arrow';
      arr.textContent = '→';
      arr.setAttribute('aria-hidden', 'true');
      btn.appendChild(arr);

      btn.addEventListener('click', (function(l, n) {
        return function() {
          history.push({ node: current, label: l });
          current = n;
          render(current);
        };
      }(label, next)));

      container.appendChild(btn);
    });
  }

  /* ════════════════════════════════════════════════════════════
     8. AFFICHER LES RÉSULTATS
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
    $('quiz-progress-bar').style.width = '100%';
    $('quiz-pct-label').textContent    = '100 %';
    $('quiz-step-label').textContent   = 'Terminé';

    /* Parcours clinique */
    var pathEl = $('results-path');
    pathEl.innerHTML = '';
    if (history.length === 0) {
      pathEl.textContent = 'Résultat direct';
    } else {
      history.forEach(function(h, i) {
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

    /* Grille SENORIF */
    var grid = $('results-grid');
    grid.innerHTML = '';

    var entries = Object.keys(donnees || {}).map(function(k) {
      return { name: k.replace(/^OUT_/i, ''), val: donnees[k], cls: cls(donnees[k]) };
    });
    var order = { rec: 0, nrec: 1, ns: 2 };
    entries.sort(function(a, b) { return order[a.cls] - order[b.cls]; });

    if (entries.length === 0) {
      grid.innerHTML = '<p style="color:#636e72;">Aucune donnée de traitement disponible.</p>';
    } else {
      entries.forEach(function(e) {
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

    /* Études */
    var profil               = construireProfil();
    var traitementsRecommandes = extraireTraitementsRecommandes(donnees);
    renderEtudes(profil, traitementsRecommandes);

    show('screen-results');
  }

  /* ════════════════════════════════════════════════════════════
     9. AFFICHER LES ÉTUDES PERTINENTES
  ════════════════════════════════════════════════════════════ */

  var SEUIL_SCORE = 40;

  function renderEtudes(profil, traitementsRecommandes) {
    var section = $('etudes-section');
    if (!section) return;

    section.innerHTML = '';

    if (!etudes || etudes.length === 0) {
      section.innerHTML = '<p style="color:#636e72;font-size:13px;margin-top:24px;">Aucune base d\'études disponible.</p>';
      return;
    }

    console.group('[Atlas] 📚 Matching — ' + etudes.length + ' études');

    var scored = etudes.map(function(etude) {
      return {
        etude: etude,
        score: calculerScoreEtude(etude, profil, MAPPING, traitementsRecommandes)
      };
    });

    console.groupEnd();

    var retenues = scored
      .filter(function(e) { return e.score >= SEUIL_SCORE; })
      .sort(function(a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return (parseInt(a.etude.niveau_preuve) || 99) - (parseInt(b.etude.niveau_preuve) || 99);
      });

    console.log('[Atlas] 📊 Retenues :', retenues.length + ' / ' + etudes.length + ' (seuil ' + SEUIL_SCORE + '%)');

    if (retenues.length === 0) {
      section.innerHTML =
        '<div style="margin-top:32px;padding:20px;background:#f8f9fa;border-radius:12px;text-align:center;">' +
        '<p style="color:#636e72;font-size:13px;">Aucune étude correspondant à ce profil (seuil : ' + SEUIL_SCORE + '%).</p>' +
        '</div>';
      return;
    }

    var titre = document.createElement('h3');
    titre.textContent = 'Données issues de la littérature';
    titre.style.cssText = 'font-size:18px;font-weight:700;margin:32px 0 8px;';
    section.appendChild(titre);

    var sous = document.createElement('p');
    sous.textContent = retenues.length + ' étude(s) — classées par pertinence';
    sous.style.cssText = 'font-size:13px;color:#636e72;margin-bottom:16px;';
    section.appendChild(sous);

    retenues.forEach(function(item) {
      section.appendChild(creerCarteEtude(item.etude, item.score));
    });
  }

  /* ════════════════════════════════════════════════════════════
     10. CARTE D'UNE ÉTUDE
  ════════════════════════════════════════════════════════════ */

  function scoreCouleur(score) {
    if (score >= 80) return '#16a34a';
    if (score >= 60) return '#d97706';
    return '#6b7280';
  }

  function creerTag(texte, bg, couleur) {
    return '<span style="display:inline-block;padding:2px 10px;border-radius:99px;' +
           'font-size:11px;font-weight:500;background:' + bg + ';color:' + couleur + ';">' +
           texte + '</span>';
  }

  function creerCarteEtude(etude, score) {
    var card = document.createElement('div');
    card.style.cssText =
      'background:#fff;border:1px solid #e5e7eb;' +
      'border-left:4px solid ' + scoreCouleur(score) + ';' +
      'border-radius:12px;padding:18px 20px;margin-bottom:12px;' +
      'cursor:pointer;transition:box-shadow .15s;';

    card.onmouseenter = function() { this.style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)'; };
    card.onmouseleave = function() { this.style.boxShadow = 'none'; };

    var traitement = (etude.traitements_evalues && etude.traitements_evalues.length)
      ? creerTag(etude.traitements_evalues[0], '#fce7f3', '#9d174d')
      : '';

    card.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">' +
        '<div style="flex:1;">' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">' +
            creerTag('Niveau ' + (etude.niveau_preuve || '?'), '#dbeafe', '#1e40af') +
            traitement +
          '</div>' +
          '<p style="font-size:13px;font-weight:500;line-height:1.5;color:#2d3436;">' +
            (etude.auteur || '') + (etude.annee ? ' · ' + etude.annee : '') +
            (etude.objectif ? ' — ' + etude.objectif : (etude.titre ? ' — ' + etude.titre : '')) +
          '</p>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex-shrink:0;">' +
          '<div style="width:44px;height:44px;border-radius:50%;border:2px solid ' + scoreCouleur(score) + ';' +
               'display:flex;align-items:center;justify-content:center;">' +
            '<span style="font-size:12px;font-weight:600;color:' + scoreCouleur(score) + ';">' + score + '%</span>' +
          '</div>' +
          '<span style="font-size:10px;color:#636e72;">match</span>' +
        '</div>' +
      '</div>' +
      '<div class="etude-detail" style="display:none;margin-top:14px;padding-top:14px;border-top:1px solid #e5e7eb;">' +
        (etude.conclusion_medecin || etude.conclusion
          ? '<p style="font-size:13px;line-height:1.6;color:#2d3436;margin-bottom:10px;">' +
            (etude.conclusion_medecin || etude.conclusion) + '</p>'
          : '') +
        (etude.lien
          ? '<a href="' + etude.lien + '" target="_blank" style="font-size:12px;color:#2563eb;">' +
            'Voir l\'article complet →</a>'
          : '') +
      '</div>';

    /* Toggle détail au clic */
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
  window.calculerScoreEtude = calculerScoreEtude; // testable depuis la console

  load();

}());
