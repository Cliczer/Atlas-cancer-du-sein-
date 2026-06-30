/*
 * Atlas Pronostics — app.js
 * Version Bibliothèque Multi-arbres
 */

(function () {
  'use strict';

  var tree       = null;
  var etudes     = [];
  var keyMapping = {};
  var current    = null;
  var history    = [];
  var maxDepth   = 1;

  function $(id) { return document.getElementById(id); }

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
    // Mutation BRCA : seul critère d'étude dont le vocabulaire patient (réponses du quiz,
    // ex. "Mutation", "BRCA muté") peut être relié au vocabulaire des études ("BRCA1, BRCA2").
    // Les autres critères (T, N, M, RE, RP, HER2, Ki67, Marges, Grade, Emboles...) ne sont
    // demandés par aucune question du quiz sous une forme comparable : ils restent neutres.
    'Mutation':        ['BRCA1','BRCA2'],
    'BRCA muté':       ['BRCA1','BRCA2'],
  };

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

  // Critère d'étude (vE) au format : valeur exacte ("2"), plage ("10-50"),
  // ou comparaison ("<2", "<=2", ">2", ">=2"). Valeur patient (vP) toujours un nombre brut.
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

    var numE = parseFloat(nE.replace(/[^0-9.-]/g,''));
    if (!isNaN(numE)) {
      if (numP === numE) return 1;
      if (Math.abs(numP-numE)/Math.max(Math.abs(numE),1) <= 0.2) return 0.5;
    }
    return 0;
  }

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

  // Un critère "joker" (-1, nc, vide…) signifie que l'étude ne s'est pas prononcée
  // sur ce critère. Il est neutre : ni compté dans le score, ni affiché comme "concordant" —
  // sinon il dilue les vrais désaccords (ex. 1 vrai mismatch + 10 jokers ≈ 91%, alors que
  // sur les seuls critères réellement évalués, c'est 0%).
  function calculerScoreEtude(etude, profilPatient, traitementsRecommandes) {
    var NUMERIQUES = ['Ki67 (%)','ki67','Age','age','Marges (mm)','Marges et autres paramètres'];
    var criteres = etude.criteres || {};
    var pts = 0, evalues = 0;
    var colonnesGagnantes = [];
    var colonnesBloquantes = [];

    Object.keys(criteres).forEach(function(nom) {
        var vE = criteres[nom];
        if (estJoker(vE)) return; // critère non évalué par l'étude : ignoré, pas un "match"
        var vP = valeurPatient(profilPatient, nom);
        if (vP === undefined || String(vP).trim() === '') return;

        evalues++;
        var s = NUMERIQUES.indexOf(nom) !== -1 ? matchNumerique(vP, vE) : matchCategoriel(vP, vE);
        pts += s;
        if (s > 0) colonnesGagnantes.push(nom); else colonnesBloquantes.push(nom);
    });

    // Aucun critère comparable avec le profil patient : pas de score plausible,
    // l'étude ne doit pas être classée comme "match" (cf. renderEtudes).
    var final = evalues === 0 ? null : Math.round((pts/evalues)*100);
    return { valeur: final, total: evalues, colonnes: colonnesGagnantes, mismatches: colonnesBloquantes };
  }

  function depth(node, d) {
    if (!node || node.type === 'resultat' || !node.choix) return d;
    if (node.type === 'etape' && node.suite) return depth(node.suite, d+1);
    var keys = Object.keys(node.choix), max = d;
    for (var i = 0; i < keys.length; i++) {
      var sub = depth(node.choix[keys[i]], d+1);
      if (sub > max) max = sub;
    }
    return max;
  }

  // 1a. Chargement de la liste des protocoles (registre unique : protocoles/index.json)
  function chargerListeProtocoles() {
    var v = '?_v=' + Date.now();
    return fetch('protocoles/index.json' + v).then(function(r) {
      if (!r.ok) throw new Error('protocoles/index.json HTTP ' + r.status);
      return r.json();
    }).then(function(reg) {
      var select = $('protocol-select');
      var liste = (reg && reg.protocoles) || [];
      if (select) {
        liste.forEach(function(p, i) {
          var opt = document.createElement('option');
          opt.value = 'protocoles/' + p.fichier;
          opt.textContent = (i + 1) + '. ' + p.nom;
          select.appendChild(opt);
        });
      }
      console.log('[Atlas] ✅ Registre des protocoles chargé :', liste.length);
    }).catch(function(err) {
      console.error('[Atlas] Impossible de charger protocoles/index.json :', err.message);
    });
  }

  // 1b. Chargement de la base de littérature (base_etudes.json)
  function chargerLitterature() {
    var v = '?_v=' + Date.now();
    return fetch('base_etudes.json' + v).then(function(r) {
      if (!r.ok) throw new Error('base_etudes.json HTTP ' + r.status);
      return r.json();
    }).then(function(base) {
      if (Array.isArray(base)) {
        etudes     = base;
        keyMapping = {};
      } else if (base && base.etudes) {
        etudes     = base.etudes  || [];
        keyMapping = base.mapping || {};
      }
      console.log('[Atlas] ✅ Littérature chargée. Études disponibles :', etudes.length);
    }).catch(function(err) {
      console.warn('[Atlas] Littérature non disponible ou erreur :', err.message);
    });
  }

  // 2. Chargement initial : registre des protocoles + littérature, en parallèle
  function load() {
    Promise.all([chargerListeProtocoles(), chargerLitterature()]).then(function() {
      var bh = $('btn-start-hero');
      if (bh) { bh.disabled = false; bh.textContent = 'Commencer l\'évaluation →'; }
    });
  }

  // 3. Chargement asynchrone du protocole sélectionné au clic
  function demarrer() {
    var selector = $('protocol-select');
    var file = selector ? selector.value : '';
    if (!file) {
      alert('Veuillez sélectionner un protocole clinique avant de commencer.');
      return;
    }

    var bh = $('btn-start-hero');
    if (bh) bh.textContent = 'Chargement de l\'arbre…';

    var v = '?_v=' + Date.now();
    fetch(file + v).then(function(r) {
      if (!r.ok) throw new Error(file + ' HTTP ' + r.status);
      return r.json();
    }).then(function(data) {
      // Extrait le sous-arbre "tree" du nouveau format de fichier
      tree = data.tree || data;
      maxDepth = depth(tree, 1) || 1;
      
      if (bh) bh.textContent = 'Commencer l\'évaluation →';
      
      history = []; 
      current = tree;
      show('screen-quiz');
      render(current);
    }).catch(function(err) {
      console.error('[Atlas] Erreur de chargement du protocole :', err);
      alert('Impossible de charger le fichier de protocole : ' + file + '\nDétail : ' + err.message);
      if (bh) bh.textContent = 'Commencer l\'évaluation →';
    });
  }

  function show(id) {
    ['screen-home','screen-quiz','screen-results'].forEach(function(sid) {
      var el = $(sid); if (el) el.classList.toggle('active', sid === id);
    });
    window.scrollTo(0,0);
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

  function render(node) {
    if (!node) return;
    if (node.type === 'resultat') { renderResults(node); return; }

    // Traitement automatique des "étapes" (flux continus sans choix utilisateur)
    if (node.type === 'etape' && node.suite) {
      history.push({node: node, label: node.titre || 'Étape intermédiaire'});
      current = node.suite;
      render(current);
      return;
    }

    $('quiz-question').textContent = node.titre || 'Question';

    var step = history.length + 1, total = maxDepth || step;
    var pct  = Math.round(Math.max(0, (step-1)/total) * 100);

    $('quiz-step-label').textContent   = 'Étape ' + step;
    $('quiz-pct-label').textContent    = pct + ' %';
    $('quiz-progress-bar').style.width = pct + '%';
    $('btn-back').style.display        = history.length > 0 ? 'inline-flex' : 'none';

    var container = $('quiz-choices');
    container.innerHTML = '';
    
    var choices = node.choix || {};
    var keys = Object.keys(choices);
    if (!keys.length) {
      container.innerHTML = '<p style="color:#636e72;font-style:italic;">Aucun choix disponible.</p>';
      return;
    }

    keys.forEach(function(label) {
      var next = choices[label];
      var btn  = document.createElement('button');
      btn.className = 'choice-btn';
      var txt = document.createElement('span'); txt.textContent = label;
      var arr = document.createElement('span'); arr.className = 'arrow'; arr.textContent = '→';
      btn.appendChild(txt); btn.appendChild(arr);
      
      btn.addEventListener('click', function() {
        history.push({node: current, label: label});
        current = next;
        render(current);
      });
      container.appendChild(btn);
    });
  }

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
    var sourceSenorif = node.source_senorif || "Référentiel National (Validé SENORIF)";

    $('quiz-progress-bar').style.width = '100%';
    $('quiz-pct-label').textContent    = '100 %';
    $('quiz-step-label').textContent   = 'Terminé';

    var pathEl = $('results-path');
    pathEl.innerHTML = '';
    if (!history.length) {
      pathEl.textContent = 'Résultat direct';
    } else {
      history.forEach(function(h, i) {
        if (i > 0) {
          var sep = document.createElement('span'); sep.className = 'path-sep'; sep.textContent = '›';
          pathEl.appendChild(sep);
        }
        var s = document.createElement('span'); s.className = 'path-step'; s.textContent = h.label;
        pathEl.appendChild(s);
      });
    }

    var grid = $('results-grid');
    grid.innerHTML = '';

    var sourceDiv = document.createElement('div');
    sourceDiv.className = 'recommendation-box';
    sourceDiv.innerHTML = '<span class="recommendation-label">✅ Recommandation</span><span class="recommendation-text">' + (node.titre || 'Orientation thérapeutique validée') + '</span>';
    grid.appendChild(sourceDiv);

    var entries = Object.keys(donnees).map(function(k) {
      return {name: k.replace(/^OUT_/i,''), val: donnees[k], cls: cls(donnees[k])};
    });
    entries.sort(function(a,b) { return ({rec:0,nrec:1,ns:2}[a.cls]) - ({rec:0,nrec:1,ns:2}[b.cls]); });

    if (entries.length > 0) {
      entries.forEach(function(e) {
        var card = document.createElement('div'); card.className = 'result-card ' + e.cls;
        var h4 = document.createElement('h4'); h4.textContent = e.name;
        var b  = document.createElement('span'); b.className = 'badge ' + e.cls; b.textContent = badge(e.val);
        card.appendChild(h4); card.appendChild(b); grid.appendChild(card);
      });
    }

    show('screen-results');

    try {
      var profil = construireProfil();
      var traitements = extraireTraitementsRecommandes(donnees);
      renderEtudes(profil, traitements);
    } catch(err) {
      console.error('[Atlas] Erreur analyse littérature :', err);
    }
  }

  function renderEtudes(profil, traitementsRecommandes) {
    var section = $('etudes-section'); if (!section) return;
    section.innerHTML = '';
    if (!etudes || !etudes.length) return;

    var scored = etudes.map(function(e) {
      var res = calculerScoreEtude(e, profil, traitementsRecommandes);
      return { etude: e, score: res.valeur, total: res.total, colonnes: res.colonnes, mismatches: res.mismatches };
    });

    var retenues = scored
      .filter(function(e) { return e.colonnes.length > 0; })
      .sort(function(a,b) { return b.colonnes.length - a.colonnes.length; });

    var h3 = document.createElement('h3');
    h3.textContent = 'Données de la littérature scientifique correspondantes';
    h3.style.cssText = 'font-size:18px;font-weight:700;margin:32px 0 16px;color:var(--text);';
    section.appendChild(h3);

    if (retenues.length === 0) {
      var vide = document.createElement('div');
      vide.style.cssText = 'font-size:14px;color:var(--muted);padding:16px 20px;background:var(--white);border:1px solid var(--border);border-radius:var(--radius);';
      vide.textContent = 'Aucune étude de la littérature ne correspond à ce parcours.';
      section.appendChild(vide);
      return;
    }

    retenues.forEach(function(item) {
        section.appendChild(creerCarteEtude(item.etude, item.score, item.total, item.colonnes, item.mismatches));
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c];
    });
  }

  // Badge visible immédiatement (sans dépli) : combien de critères concordent réellement,
  // sur combien évalués par l'étude — pour ne plus avoir à déduire ça d'un pourcentage.
  function badgeCorrespondance(total, nbMatch, nbMismatch) {
    if (total === 0) {
      return { texte: 'Critères cliniques non renseignés', cls: 'badge-neutre' };
    }
    if (nbMismatch === 0) {
      return { texte: '✅ ' + nbMatch + '/' + total + ' critères concordants', cls: 'badge-ok' };
    }
    if (nbMatch === 0) {
      return { texte: '❌ 0/' + total + ' critère concordant', cls: 'badge-ko' };
    }
    return { texte: '⚠️ ' + nbMatch + '/' + total + ' critères concordants', cls: 'badge-mixte' };
  }

  function chips(noms, cls) {
    return noms.map(function(n) {
      return '<span class="critere-chip ' + cls + '">' + esc(n) + '</span>';
    }).join('');
  }

  // Titre/auteurs séparés si renseignés (champs dédiés) ; sinon on retombe sur la
  // référence brute complète (citation non encore découpée par un humain dans l'éditeur).
  function titreEtude(etude) {
    return (etude.titre && etude.titre.trim()) || etude.reference || '(étude sans titre)';
  }
  function auteursEtude(etude) {
    return (etude.auteurs && etude.auteurs.trim()) || '';
  }

  function creerCarteEtude(etude, score, total, colonnes, mismatches) {
    var card = document.createElement('div');
    card.style.cssText = 'background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,0.02);';
    var comp = etude.comparaison || { avec: {valeur: 0, unite: ''}, sans: {valeur: 0, unite: ''} };
    var corr = badgeCorrespondance(total, colonnes.length, mismatches.length);
    var auteurs = auteursEtude(etude);

    card.innerHTML =
      '<div class="etude-flex" style="display:flex; justify-content:space-between; align-items:flex-start; gap:40px;">' +
        '<div style="flex:1;">' +
          '<h4 style="margin:0 0 4px 0; font-size:15px; color:#1a1a1a; font-weight:700;">' + esc(titreEtude(etude)) + '</h4>' +
          (auteurs ? '<div style="font-size:12px; color:#9aa1a8; margin-bottom:10px;">' + esc(auteurs) + '</div>' : '<div style="margin-bottom:10px;"></div>') +
          (etude.niveau_preuve || etude.objectif ?
            '<div style="font-size:12px; color:#636e72; margin-bottom:10px;">' +
              (etude.niveau_preuve ? '<span style="font-weight:700;">Niveau de preuve ' + esc(etude.niveau_preuve) + '</span>' : '') +
              (etude.niveau_preuve && etude.objectif ? ' — ' : '') +
              (etude.objectif ? esc(etude.objectif) : '') +
            '</div>' : '') +
          '<span class="badge-correspondance ' + corr.cls + '">' + corr.texte + '</span>' +
          '<button class="btn btn-ghost btn-toggle" style="padding: 6px 12px; font-size: 12px; margin: 10px 0 0; display:block;">Voir le détail des critères ↓</button>' +
          '<div class="zone-details" style="display:none; padding-top: 10px;">' +
            (colonnes.length > 0 ? '<div style="margin-bottom:8px;">' + chips(colonnes, 'chip-ok') + '</div>' : '') +
            (mismatches.length > 0 ? '<div style="margin-bottom:8px;">' + chips(mismatches, 'chip-ko') + '</div>' : '') +
            (etude.lien ? '<a href="'+esc(etude.lien)+'" target="_blank" style="font-size:13px; color:var(--orange); text-decoration:none; font-weight:600;">Ouvrir l\'article PubMed →</a>' : '') +
          '</div>' +
        '</div>' +
        '<div class="etude-bars" style="width: 260px; flex-shrink:0;">' +
          '<div style="font-size: 11px; font-weight: 700; color: #636e72; text-transform: uppercase; margin-bottom: 10px;">📊 Résultats chiffrés</div>' +
          '<div class="barre-header" style="margin-bottom:4px;"><span>Standard' + (comp.avec.unite ? ' (' + esc(comp.avec.unite) + ')' : '') + '</span><span>' + (comp.avec.valeur || 0) + '%</span></div>' +
          '<div class="barre-track"><div class="barre-fill bonne" style="width:' + (comp.avec.valeur || 0) + '%;"></div></div>' +
          '<div class="barre-header" style="margin-top:14px; margin-bottom:4px;"><span>Contrôle' + (comp.sans.unite ? ' (' + esc(comp.sans.unite) + ')' : '') + '</span><span>' + (comp.sans.valeur || 0) + '%</span></div>' +
          '<div class="barre-track"><div class="barre-fill mauvaise" style="width:' + (comp.sans.valeur || 0) + '%;"></div></div>' +
        '</div>' +
      '</div>';

    var btnToggle = card.querySelector('.btn-toggle');
    var zoneDetails = card.querySelector('.zone-details');
    if (btnToggle && zoneDetails) {
      btnToggle.addEventListener('click', function() {
        if (zoneDetails.style.display === 'none') {
          zoneDetails.style.display = 'block'; btnToggle.textContent = 'Masquer le détail ↑';
        } else {
          zoneDetails.style.display = 'none'; btnToggle.textContent = 'Voir le détail des critères ↓';
        }
      });
    }
    return card;
  }

  window.demarrer         = demarrer;
  window.reculer          = reculer;
  window.recommencer      = recommencer;
  window.accueil          = recommencer;
  window.calculerScoreEtude = calculerScoreEtude;

  load();
}());
