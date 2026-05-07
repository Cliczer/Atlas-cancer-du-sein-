/*
 * Atlas Pronostics — app.js (Version Corrigée et Déboguée)
 */

(function () {
  'use strict';

  var tree       = null;
  var baseEtudes = null;
  window.baseEtudes = null;
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

    // Bouton "Je ne sais pas / Non renseigné"
    var separator = document.createElement('div');
    separator.className = 'skip-separator';
    container.appendChild(separator);

    var btnSkip = document.createElement('button');
    btnSkip.className = 'choice-btn skip-btn';
    var skipTxt = document.createElement('span');
    skipTxt.textContent = 'Je ne sais pas / Non renseigné';
    btnSkip.appendChild(skipTxt);
    var skipArr = document.createElement('span');
    skipArr.className = 'arrow'; skipArr.textContent = '?';
    btnSkip.appendChild(skipArr);
    btnSkip.addEventListener('click', (function(capturedNode, capturedTitre) {
      return function () {
        history.push({ node: capturedNode, label: '-1', question: capturedTitre, nonRenseigne: true });
        var allResults = collecterTousResultats(capturedNode);
        var donneesMerged = fusionnerResultats(allResults);
        renderResults(donneesMerged, true);
      };
    })(current, questionTitre));
    container.appendChild(btnSkip);
  }

  function reculer() {
    if (history.length === 0) return;
    current = history.pop().node;
    render(current);
  }

  /* ─── COLLECTE ET FUSION DES RÉSULTATS (pour "Je ne sais pas") ─── */
  function collecterTousResultats(node) {
    if (!node) return [];
    if (node.type === 'resultat') return [node.donnees];
    return Object.values(node.choix || {}).reduce(function(acc, child) {
      return acc.concat(collecterTousResultats(child));
    }, []);
  }

  function fusionnerResultats(listeResultats) {
    if (!listeResultats.length) return {};
    // Priorité : "1" (recommandé) > "0.5" (alternatif) > "-1" (NS) > "0" (non rec)
    var prio = {'1': 4, '1.0': 4, '0.5': 3, '-1': 2, '0': 1, '0.0': 1};
    var merged = {};
    listeResultats.forEach(function(res) {
      Object.keys(res || {}).forEach(function(key) {
        var v = String(res[key]);
        if (!merged.hasOwnProperty(key)) {
          merged[key] = v;
        } else {
          if ((prio[v] || 0) > (prio[merged[key]] || 0)) {
            merged[key] = v;
          }
        }
      });
    });
    return merged;
  }

  /* ─── MOTEUR DE MATCHING (CORRIGÉ ET DÉBOGUÉ) ─── */

  function trouverColonneCritere(questionTitre, mapping) {
    for (var key in mapping) {
      if (mapping[key] === questionTitre) return mapping[key];
    }
    if (mapping.hasOwnProperty(questionTitre)) return mapping[questionTitre];

    function normaliser(s) {
      return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
    }
    var qtNorm = normaliser(questionTitre);

    for (var k in mapping) {
      var kNorm = normaliser(k);
      var vNorm = normaliser(mapping[k]);
      if (qtNorm === kNorm || qtNorm === vNorm) return mapping[k];
      if (qtNorm.startsWith(kNorm) && kNorm.length >= 2) return mapping[k];
      if (kNorm.startsWith(qtNorm) && qtNorm.length >= 2) return mapping[k];
    }
    return null;
  }

  function matchNumerique(valeurPatient, critereEtude) {
    if (!critereEtude || critereEtude === '-1' || critereEtude === 'nc' || critereEtude === 'nan') return true;
    var val = parseFloat(valeurPatient);
    if (isNaN(val)) return false;
    var crit = String(critereEtude).trim();
    var rangeMatch = crit.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
    if (rangeMatch) return val >= parseFloat(rangeMatch[1]) && val <= parseFloat(rangeMatch[2]);
    if (crit.startsWith('<=')) return val <= parseFloat(crit.substring(2));
    if (crit.startsWith('>=')) return val >= parseFloat(crit.substring(2));
    if (crit.startsWith('<'))  return val < parseFloat(crit.substring(1));
    if (crit.startsWith('>'))  return val > parseFloat(crit.substring(1));
    return val === parseFloat(crit);
  }

  function estPositif(val) {
    var v = val.toLowerCase().trim();
    return v === '1' || v === 'oui' || v === 'positif' || v === 'pos' ||
           v.endsWith('+') || v.includes('positif');
  }

  function estNegatif(val) {
    var v = val.toLowerCase().trim();
    return v === '0' || v === 'non' || v === 'négatif' || v === 'negatif' || v === 'neg' ||
           (v.length > 1 && v.endsWith('-')) || v.includes('négatif') || v.includes('negatif');
  }

  function matchCategoriel(reponsePatient, critereEtude) {
    var p  = reponsePatient.toLowerCase().trim().replace(/\.0$/, '');
    var vE = critereEtude.toLowerCase().trim();
    if (vE.includes(p)) return true;
    if (estPositif(p) && (vE.includes('positif') || vE.includes('pos'))) return true;
    if (estNegatif(p) && (vE.includes('négatif') || vE.includes('negatif') || vE.includes('neg'))) return true;
    return false;
  }

  function calculerScoreEtude(etude, profilPatient, mapping, traitementsRecommandes) {
    console.log("==========================================");
    console.log("🔍 ÉVALUATION DE L'ÉTUDE :", etude.objectif || "Sans titre");

    // 1. Filtre Traitement (Assoupli)
    var traitementsEtude = etude.traitements_evalues || [];
    var cleanRecs  = traitementsRecommandes.map(function(r) { return r.toLowerCase().trim(); });
    var cleanEtude = traitementsEtude.map(function(t) { return t.toLowerCase().trim(); });

    // Vérifie si le traitement recommandé est inclus (même en partie) dans le traitement de l'étude
    var matchTraitement = (cleanRecs.length === 0) || cleanRecs.some(function(rec) {
      return cleanEtude.some(function(trEtude) {
        return trEtude.includes(rec) || rec.includes(trEtude); 
      });
    });

    console.log("-> Traitements de l'arbre :", cleanRecs);
    console.log("-> Traitements de l'étude :", cleanEtude);
    console.log("-> Match Traitement :", matchTraitement ? "✅ OUI" : "❌ NON");

    if (!matchTraitement) {
      console.log("❌ SCORE 0 : Le traitement de l'étude ne correspond pas aux recos de l'arbre.");
      return 0;
    }

    // 2. Filtre Clinique
    var criteres = etude.criteres || {};
    var scorePoints = 0, criteresEvalues = 0;

    for (var questionArbre in profilPatient) {
      var reponsePatient = String(profilPatient[questionArbre]).toLowerCase().trim();
      if (reponsePatient === '-1' || reponsePatient === 'non renseigné' || reponsePatient === 'non_renseigne') continue;

      var colonneCritere = trouverColonneCritere(questionArbre, mapping);
      if (!colonneCritere || !criteres.hasOwnProperty(colonneCritere)) {
        console.log("⚠️ Ignoré (Hors mapping) :", questionArbre);
        continue;
      }

      criteresEvalues++;
      var vE = String(criteres[colonneCritere]).toLowerCase().trim();

      console.log("Question : [" + questionArbre + "] | Patient : [" + reponsePatient + "] | Étude veut : [" + vE + "]");

      if (vE === '-1' || vE === 'nan' || vE === 'nc' || vE === '') {
        scorePoints++;
        console.log("   ✅ Match automatique (Joker NC)");
      } else if (colonneCritere.toLowerCase().includes('age') || colonneCritere.toLowerCase().includes('ki67')) {
        if (matchNumerique(reponsePatient, vE)) {
          scorePoints++;
          console.log("   ✅ Match Numérique");
        } else {
          console.log("   ❌ Échec Numérique");
        }
      } else {
        if (matchCategoriel(reponsePatient, vE)) {
          scorePoints++;
          console.log("   ✅ Match Catégoriel");
        } else {
          console.log("   ❌ Échec Catégoriel");
        }
      }
    }

    var scoreFinal = criteresEvalues > 0 ? Math.round((scorePoints / criteresEvalues) * 100) : 100;
    console.log("🎯 SCORE FINAL :", scoreFinal, "%");
    return scoreFinal;
  }

  function renderResults(donnees, donneesIncompletes) {
    if ($('quiz-progress-bar')) $('quiz-progress-bar').style.width = '100%';
    if ($('quiz-pct-label')) $('quiz-pct-label').textContent = '100 %';
    if ($('quiz-step-label')) $('quiz-step-label').textContent = 'Terminé';

    var pathEl = $('results-path');
    if (pathEl) {
      pathEl.innerHTML = '';
      history.forEach(function(h, i) {
        if (i > 0) {
          var sep = document.createElement('span');
          sep.className = 'path-sep'; sep.textContent = '›';
          pathEl.appendChild(sep);
        }
        var step = document.createElement('span');
        step.className = 'path-step' + (h.nonRenseigne ? ' path-step-nr' : '');
        step.textContent = h.question + ' : ' + (h.nonRenseigne ? '?' : humaniserLabel(h.label));
        pathEl.appendChild(step);
      });
    }

    var resultsBody = document.querySelector('#screen-results .results-body');
    var existingWarnNR = document.getElementById('warning-nr');
    if (existingWarnNR) existingWarnNR.remove();
    if (donneesIncompletes && resultsBody) {
      var warnNR = document.createElement('div');
      warnNR.id = 'warning-nr';
      warnNR.className = 'warning-box warning-nr';
      warnNR.style.marginBottom = '20px';
      warnNR.innerHTML = '<strong>⚠️ Données incomplètes :</strong> Une ou plusieurs questions n\'ont pas reçu de réponse. Les recommandations ci-dessous représentent l\'ensemble des cas possibles et ne sont pas spécifiques à cette patiente. Une évaluation en RCP est fortement conseillée.';
      var grid = $('results-grid');
      if (grid) resultsBody.insertBefore(warnNR, grid);
    }

    var grid = $('results-grid');
    if (!grid) return;
    grid.innerHTML = '';

    var recsPourEtudes = [];
    Object.keys(donnees || {}).forEach(function (key) {
      var scoreBrut = String(donnees[key]);
      var typeCls = 'ns';
      var labelBadge = 'Non spécifié';

      if (scoreBrut === '1' || scoreBrut === '1.0') {
        typeCls = 'rec'; labelBadge = '✓ Recommandé';
        recsPourEtudes.push(key.replace(/^OUT_/i, '').trim());
      } else if (scoreBrut === '0' || scoreBrut === '0.0') {
        typeCls = 'nrec'; labelBadge = '✗ Non recommandé';
      } else if (scoreBrut === '0.5') {
        typeCls = 'alt'; labelBadge = '↹ Alternative (OU)';
        recsPourEtudes.push(key.replace(/^OUT_/i, '').trim());
      }

      var card = document.createElement('div');
      card.className = 'result-card ' + typeCls;
      card.innerHTML = '<h4>' + key.replace(/^OUT_/i, '') + '</h4><span class="badge ' + typeCls + '">' + labelBadge + '</span>';
      grid.appendChild(card);
    });

    renderEtudes(donnees);
    show('screen-results');
  }

  function renderEtudes(donneesResultats) {
    var container = $('etudes-container');
    if (!container || !baseEtudes) return;
    container.innerHTML = '';

    var profil = {};
    history.forEach(function(h) { profil[h.question] = h.label; });

    var traitementsRec = [];
    Object.keys(donneesResultats).forEach(function(k) {
      if (['1', '1.0', '0.5'].includes(String(donneesResultats[k]))) {
        traitementsRec.push(k.replace(/^OUT_/i, '').trim());
      }
    });

    var outcomesLabels = (baseEtudes.etudes[0] && baseEtudes.etudes[0].outcomes) ? baseEtudes.etudes[0].outcomes : {};

    var etudesPertinentes = baseEtudes.etudes.slice(1).map(function(etude) {
      etude.scoreMatch = calculerScoreEtude(etude, profil, baseEtudes.mapping, traitementsRec);
      return etude;
    }).filter(function(e) { return e.scoreMatch >= 50; })
      .sort(function(a, b) { return b.scoreMatch - a.scoreMatch; });

    if (etudesPertinentes.length === 0) {
      container.innerHTML = '<p class="muted">Aucune étude correspondante trouvée pour ce profil.</p>';
      return;
    }

    etudesPertinentes.forEach(function(etude) {
      var card = document.createElement('div');
      card.className = 'etude-card';

      var outcomesHtml = Object.keys(etude.outcomes || {}).map(function(k) {
        var label = outcomesLabels[k] || k;
        return '<div><strong>' + label + ' :</strong> ' + etude.outcomes[k] + '</div>';
      }).join('');

      var criteresHtml = '';
      if (etude.criteres) {
        var criteresListe = Object.keys(etude.criteres).filter(function(k) {
          var v = String(etude.criteres[k]);
          return v !== '-1' && v !== 'nan' && v !== '';
        }).map(function(k) {
          return '<span class="critere-tag">' + k + ' : ' + etude.criteres[k] + '</span>';
        }).join('');
        if (criteresListe) {
          criteresHtml = '<div class="etude-criteres">' + criteresListe + '</div>';
        }
      }

      var niveauPreuve = etude.niveau_preuve !== '-1' ? 'Niveau ' + etude.niveau_preuve : 'Niveau NC';
      var titreEtude = (etude.objectif && etude.objectif !== '-1') ? etude.objectif : 'Étude clinique';
      var lienRef = (etude.reference && etude.reference !== '-1') ? etude.reference : null;

      card.innerHTML =
        '<div class="etude-header">' +
          '<span class="etude-score">' + etude.scoreMatch + '% Match</span>' +
          '<span class="etude-preuve">' + niveauPreuve + '</span>' +
        '</div>' +
        '<h4 class="etude-title">' + titreEtude + '</h4>' +
        '<div class="etude-traitements"><strong>Traitements évalués :</strong> ' + etude.traitements_evalues.join(', ') + '</div>' +
        criteresHtml +
        (outcomesHtml ? '<div class="etude-stats">' + outcomesHtml + '</div>' : '<p class="muted" style="font-size:13px;margin-bottom:12px;">Pas de données chiffrées disponibles.</p>') +
        (lienRef ? '<a href="' + lienRef + '" target="_blank" rel="noopener" class="etude-link">Voir la référence ↗</a>' : '');

      container.appendChild(card);
    });
  }

  function recommencer() { history = []; current = null; show('screen-home'); }

  window.demarrer    = demarrer;
  window.reculer     = reculer;
  window.recommencer = recommencer;
  window.accueil     = recommencer;
  load();
}());
