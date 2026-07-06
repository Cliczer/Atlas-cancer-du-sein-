/*
 * Atlas Pronostics — app.js
 * Version Bibliothèque Multi-arbres
 */

(function () {
  'use strict';

  var tree       = null;
  var etudes     = [];
  var current    = null;
  var history    = [];
  var maxDepth   = 1;
  var dicoIdx = null;             // index du dictionnaire (résolveur de valeurs)
  var dernieresEtudesRetenues = [];
  var dernierProfil = null;       // profil courant (pour re-render au changement de filtre)
  var filtreMesure = null;        // famille de mesure filtrée (null = toutes)
  var dictionnaire = null;        // vocabulaire typé v2 (moteur d'appariement)
  var preludeConfig = null;       // prélude clinique (src/data/prelude.json)
  var avertissementsSchema = [];
  var avertissements = [];        

  function $(id) { return document.getElementById(id); }

  function normaliser(v) {
    if (v === null || v === undefined) return '';
    return String(v).toLowerCase().trim();
  }

  // Avertit si un tag d'arbre référence un critère/valeur hors dictionnaire
  // (vocabulaire.json). Source de vérité unique : plus de schema_criteres.json.
  function validerTag(critere, valeur) {
    var e = dicoIdx && dicoIdx[critere];
    if (!e) {
      avertissements.push('Question reliée à un critère inconnu du dictionnaire : « ' + critere +
        ' ». Corrigez le critère dans l\'éditeur d\'arbres, ou ajoutez-le à vocabulaire.json.');
      return;
    }
    if (e.type !== 'categoriel') return;
    if (valeur != null && String(valeur).trim() !== '' && !e.resolve[normaliser(valeur)]) {
      avertissements.push('Réponse « ' + valeur + ' » non reconnue pour le critère « ' + critere + ' » (hors dictionnaire).');
    }
  }

  function construireProfil() {
    var profil = {};
    avertissements = []; 
    history.forEach(function(h) {
      if (h.skip) return; 
      var node  = h.node || {};
      var label = h.label || '';
      var rep   = node.reponses ? node.reponses[label] : undefined;
      if (rep && typeof rep === 'object') {
        Object.keys(rep).forEach(function(crit) {
          if (String(rep[crit]).trim() !== '') {
            profil[crit] = rep[crit];
            validerTag(crit, rep[crit]);
          }
        });
      } else if (node.critere) {
        var valeur = (rep !== undefined) ? rep : label;
        profil[node.critere] = valeur;
        validerTag(node.critere, valeur);
      }
      // Le profil n'est constitué que de tags canoniques (reponses[label] ou
      // node.critere). L'ancien repli « profil[titreQuestion] = label » a été
      // retiré : il polluait le profil de clés non canoniques et rendait le
      // matching imprévisible. Toute question qui doit peser sur le matching
      // porte désormais un tag explicite (reponses/critere) dans son protocole.
    });
    return profil;
  }

  function renderAvertissements() {
    var box = $('validation-banner');
    if (!box) return;
    var tous = avertissementsSchema.concat(avertissements);
    if (!tous.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.style.cssText = 'display:block;background:#fef3c7;border:1px solid #f59e0b;border-radius:12px;padding:14px 18px;margin-bottom:24px;color:#78350f;font-size:13px;line-height:1.5;';
    box.innerHTML = '<strong>⚠️ Avertissements de cohérence des données</strong><ul style="margin:8px 0 0;padding-left:20px;">' +
      tous.map(function(m){ return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>';
  }

  // Moteur v2 : appariement déterministe du profil aux contraintes typées de l'étude.
  function apparierEtude(etude, profilPatient) {
    if (!window.AtlasContrat || !dictionnaire) return { eligible: false, concordance: null, satisfaites: [], violees: [], indeterminees: [], indisponible: true };
    return window.AtlasContrat.apparier(profilPatient, etude, dictionnaire);
  }

  // Libellé lisible d'un critère (depuis le dictionnaire), repli sur l'id.
  function labelCritere(id) {
    var c = dictionnaire && dictionnaire.criteres && dictionnaire.criteres[id];
    return (c && c.label) || id;
  }

  function depth(node, d) {
    if (!node || node.type === 'resultat') return d;
    if ((node.type === 'etape' || node.type === 'numerique') && node.suite) return depth(node.suite, d+1);
    if (!node.choix) return d;
    var keys = Object.keys(node.choix), max = d;
    for (var i = 0; i < keys.length; i++) {
      var sub = depth(node.choix[keys[i]], d+1);
      if (sub > max) max = sub;
    }
    return max;
  }

  // Prélude clinique : construit depuis src/data/prelude.json (data-driven).
  // Repli minimal intégré si le fichier n'a pas pu être chargé.
  var PRELUDE_DEFAUT = { questions: [
    { type: 'question', titre: 'Statut ganglionnaire (N)', critere: 'N', options: [ { choix: 'N0', reponse: 'N0' }, { choix: 'N+', reponse: 'N+' } ] },
    { type: 'numerique', titre: 'Âge de la patiente (années)', critere: 'Age' }
  ] };

  function questionPrelude(q, suivant) {
    if (q.type === 'numerique') return { type: 'numerique', titre: q.titre, critere: q.critere, suite: suivant };
    var choix = {}, reponses = {};
    (q.options || []).forEach(function(o){ choix[o.choix] = suivant; if (o.reponse != null) reponses[o.choix] = o.reponse; });
    return { type: 'question', titre: q.titre, critere: q.critere, choix: choix, reponses: reponses };
  }

  function construirePrelude(suite) {
    var qs = (preludeConfig && Array.isArray(preludeConfig.questions) && preludeConfig.questions.length)
      ? preludeConfig.questions : PRELUDE_DEFAUT.questions;
    var courant = suite;
    for (var i = qs.length - 1; i >= 0; i--) courant = questionPrelude(qs[i], courant);
    return courant;
  }

  function chargerListeProtocoles() {
    var v = '?_v=' + Date.now();
    return fetch('./src/data/protocoles/index.json' + v).then(function(r) {
      if (!r.ok) throw new Error('./src/data/protocoles/index.json HTTP ' + r.status);
      return r.json();
    }).then(function(reg) {
      var select = $('protocol-select');
      var liste = (reg && reg.protocoles) || [];
      if (select) {
        liste.forEach(function(p, i) {
          var opt = document.createElement('option');
          opt.value = './src/data/protocoles/' + p.fichier;
          opt.textContent = (i + 1) + '. ' + p.nom;
          select.appendChild(opt);
        });
      }
      console.log('[Atlas] ✅ Registre des protocoles chargé :', liste.length);
    }).catch(function(err) {
      console.error('[Atlas] Impossible de charger protocoles/index.json :', err.message);
    });
  }

  function chargerLitterature() {
    var v = '?_v=' + Date.now();
    return fetch('./src/data/base_etudes.json' + v).then(function(r) {
      if (!r.ok) throw new Error('base_etudes.json HTTP ' + r.status);
      return r.json();
    }).then(function(base) {
      if (Array.isArray(base)) {
        etudes = base;
      } else if (base && base.etudes) {
        etudes = base.etudes || [];
      }
      if (window.AtlasContrat) {
        var res = window.AtlasContrat.validerBase({ etudes: etudes });
        if (res.erreurs.length) {
          avertissementsSchema.push('La base d\'études contient ' + res.erreurs.length +
            ' erreur(s) de format — certaines études peuvent ne pas s\'afficher correctement.');
          res.erreurs.forEach(function(m){ console.error('[Atlas] base_etudes :', m); });
        }
      }
      console.log('[Atlas] ✅ Littérature chargée. Études disponibles :', etudes.length);
    }).catch(function(err) {
      avertissementsSchema.push('La base d\'études (base_etudes.json) n\'a pas pu être chargée (' +
        err.message + '). Aucune donnée de littérature ne sera affichée.');
      console.warn('[Atlas] Littérature non disponible ou erreur :', err.message);
    });
  }

  function chargerDictionnaire() {
    var v = '?_v=' + Date.now();
    return fetch('./src/data/vocabulaire.json' + v).then(function(r) {
      if (!r.ok) throw new Error('vocabulaire.json HTTP ' + r.status);
      return r.json();
    }).then(function(d) {
      dictionnaire = d;
      dicoIdx = window.AtlasContrat ? window.AtlasContrat.indexerDictionnaire(d) : null;
      if (d && d.mode_demo === false) {
        var bn = $('demo-banner'); if (bn) bn.style.display = 'none';
      }
      console.log('[Atlas] ✅ Dictionnaire typé chargé (critères : ' + Object.keys((d && d.criteres) || {}).length + ').');
    }).catch(function(err) {
      dictionnaire = null; dicoIdx = null;
      avertissementsSchema.push('Le dictionnaire de critères (vocabulaire.json) n\'a pas pu être chargé (' +
        err.message + '). L\'appariement des études au profil est indisponible.');
      console.warn('[Atlas] vocabulaire.json indisponible :', err.message);
    });
  }

  function chargerPrelude() {
    var v = '?_v=' + Date.now();
    return fetch('./src/data/prelude.json' + v).then(function(r) {
      if (!r.ok) throw new Error('prelude.json HTTP ' + r.status);
      return r.json();
    }).then(function(p) {
      preludeConfig = p;
      console.log('[Atlas] ✅ Prélude clinique chargé (' + ((p && p.questions) || []).length + ' questions).');
    }).catch(function(err) {
      preludeConfig = null;
      console.warn('[Atlas] prelude.json indisponible — prélude de secours utilisé :', err.message);
    });
  }

  function renderHomeBanner() {
    var box = $('home-banner');
    if (!box) return;
    if (!avertissementsSchema.length) { box.style.display = 'none'; return; }
    box.style.cssText = 'display:block;background:#7f1d1d;border:1px solid #fecaca;border-radius:12px;padding:14px 18px;margin-bottom:20px;color:#fff;font-size:13px;line-height:1.5;text-align:left;';
    box.innerHTML = '<strong>⚠️ Problème de données détecté</strong><ul style="margin:8px 0 0;padding-left:20px;">' +
      avertissementsSchema.map(function(m){ return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>';
  }

  function load() {
    Promise.all([chargerDictionnaire(), chargerPrelude(), chargerListeProtocoles(), chargerLitterature()]).then(function() {
      var bh = $('btn-start-hero');
      if (bh) { bh.disabled = false; bh.textContent = 'Commencer l\'évaluation →'; }
      renderHomeBanner();
    });
  }

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
      var arbreProtocole = data.tree || data;
      // Prélude clinique (T/N/M/RE/RP/Âge) ajouté par défaut. Un protocole peut
      // le désactiver (prelude_clinique:false) quand il est hors sujet (ex.
      // « Diagnostic et biopsie », où l'on ne connaît pas encore ces stades).
      var avecPrelude = !(data && data.prelude_clinique === false);
      tree = avecPrelude ? construirePrelude(arbreProtocole) : arbreProtocole;
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
    // Les nœuds « étape » sont transparents : render() les traverse et
    // re-descend aussitôt. Revenir « sur » une étape rebondirait donc vers
    // l'avant → on saute les étapes pour retomber sur la vraie question
    // précédente (celle que la patiente a réellement vue).
    var cible = null;
    while (history.length) {
      var h = history[history.length - 1];
      if (h.node && h.node.type !== 'etape') { cible = history.pop(); break; }
      history.pop();
    }
    if (!cible) return;
    current = cible.node;
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

    if (node.type === 'numerique') { renderNumerique(node, container); return; }

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

    ajouterBoutonPasser(node, container);
  }

  function cibleSkip(node) {
    if (node.type === 'numerique') return node.suite || null;
    var choix = node.choix || {};
    var cibles = Object.keys(choix).map(function(k){ return choix[k]; });
    if (!cibles.length) return null;
    return cibles.every(function(c){ return c === cibles[0]; }) ? cibles[0] : null;
  }

  function passerQuestion(node) {
    var next = cibleSkip(node);
    if (!next) return;
    history.push({node: node, label: 'Non renseigné', skip: true});
    current = next;
    render(current);
  }

  function ajouterBoutonPasser(node, container) {
    if (!cibleSkip(node)) return;
    var wrap = document.createElement('div');
    wrap.style.cssText = 'margin-top:14px;';
    var b = document.createElement('button');
    b.className = 'choice-btn';
    b.style.cssText = 'background:#f1f3f5;border-color:#e5e7eb;color:#636e72;font-weight:600;';
    b.textContent = 'Je ne sais pas — passer';
    b.addEventListener('click', function(){ passerQuestion(node); });
    var note = document.createElement('div');
    note.style.cssText = 'font-size:12px;color:#9aa1a8;margin-top:6px;font-style:italic;';
    note.textContent = 'Ce critère ne sera pas pris en compte : la correspondance avec les études sera moins précise.';
    wrap.appendChild(b); wrap.appendChild(note);
    container.appendChild(wrap);
  }

  function renderNumerique(node, container) {
    var wrap  = document.createElement('div');
    wrap.className = 'numeric-input-wrap';

    var input = document.createElement('input');
    input.type = 'number';
    input.min  = '0';
    input.max  = '120';
    input.step = '1';
    input.placeholder = 'Âge en années';
    input.className   = 'numeric-input';

    var btn = document.createElement('button');
    btn.className   = 'choice-btn';
    btn.textContent = 'Valider →';

    function valider() {
      var v = parseFloat(String(input.value).trim().replace(',', '.'));
      if (isNaN(v) || v < 0 || v > 120) {
        input.style.borderColor = '#e74c3c';
        input.focus();
        return;
      }
      history.push({node: node, label: String(v)});
      current = node.suite;
      render(current);
    }

    btn.addEventListener('click', valider);
    input.addEventListener('keydown', function(e) { if (e.key === 'Enter') valider(); });
    input.addEventListener('input', function() { input.style.borderColor = ''; });

    wrap.appendChild(input);
    wrap.appendChild(btn);
    container.appendChild(wrap);
    ajouterBoutonPasser(node, container);
    input.focus();
  }

  function renderResults(node) {
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
    sourceDiv.innerHTML = '<span class="recommendation-label">✅ Recommandation</span><span class="recommendation-text">' + esc(node.titre || 'Orientation thérapeutique validée') + '</span>';
    grid.appendChild(sourceDiv);

    show('screen-results');

    try {
      var profil = construireProfil();
      renderEtudes(profil);
      renderAvertissements();
    } catch(err) {
      console.error('[Atlas] Erreur analyse littérature :', err);
    }
  }

  function renderEtudes(profil) {
    var section = $('etudes-section'); if (!section) return;
    dernierProfil = profil;
    section.innerHTML = '';
    if (!etudes || !etudes.length) return;

    var apparies = etudes.map(function(e) {
      return { etude: e, m: apparierEtude(e, profil) };
    });

    // Retenues = la patiente relève des critères d'inclusion (aucune contrainte
    // violée) et au moins une contrainte concorde. Rangées par importance
    // curateur, puis niveau de preuve, puis nombre de critères concordants.
    var retenues = apparies
      .filter(function(x) { return x.m.eligible && x.m.satisfaites.length > 0; })
      .sort(function(a,b) {
        var ia = Number(a.etude.importance) || 0, ib = Number(b.etude.importance) || 0;
        var na = parseFloat(a.etude.niveau_preuve) || 99, nb = parseFloat(b.etude.niveau_preuve) || 99;
        return (ib - ia) || (na - nb) || (b.m.satisfaites.length - a.m.satisfaites.length);
      });
    // Quand un filtre de mesure est actif, on n'affiche que les études qui ont
    // effectivement cette mesure (les autres n'apporteraient rien).
    var affichees = retenues.filter(function(item){
      if (!filtreMesure) return true;
      return comparaisonsEtude(item.etude).some(function(c){ return familleDe(c) === filtreMesure; });
    });
    dernieresEtudesRetenues = affichees.map(function(r){ return r.etude; });

    // Écartées = la patiente est hors des critères d'inclusion (au moins une
    // contrainte violée). Comptées et explicitées, jamais masquées en silence.
    var ecartees = apparies.filter(function(x){ return !x.m.eligible && x.m.violees.length > 0; });

    var h3 = document.createElement('h3');
    h3.textContent = 'Études dont la patiente relève (critères d\'inclusion satisfaits)';
    h3.style.cssText = 'font-size:18px;font-weight:700;margin:32px 0 16px;color:var(--text);';
    section.appendChild(h3);

    if (retenues.length === 0) {
      var vide = document.createElement('div');
      vide.style.cssText = 'font-size:14px;color:var(--muted);padding:16px 20px;background:var(--white);border:1px solid var(--border);border-radius:var(--radius);';
      vide.textContent = 'Aucune étude de la base ne correspond aux critères d\'inclusion de ce profil.';
      section.appendChild(vide);
    } else {
      var btnVP = document.createElement('button');
      btnVP.className = 'btn btn-primary';
      btnVP.textContent = '👩‍⚕️ Vue patiente (chiffres simplifiés)';
      btnVP.style.cssText = 'color:#fff;margin-bottom:18px;';
      btnVP.addEventListener('click', ouvrirVuePatiente);
      section.appendChild(btnVP);

      // Filtre par mesure : familles distinctes présentes dans les études retenues.
      var familles = [];
      retenues.forEach(function(item){ comparaisonsEtude(item.etude).forEach(function(c){ var f = familleDe(c); if (f && familles.indexOf(f) === -1) familles.push(f); }); });
      if (filtreMesure && familles.indexOf(filtreMesure) === -1) filtreMesure = null;
      if (familles.length > 1) {
        var barre = document.createElement('div');
        barre.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:16px;';
        barre.innerHTML = '<span style="font-size:12px;color:#636e72;font-weight:600;margin-right:4px;">Filtrer les résultats :</span>';
        var faireChip = function(nom, val){
          var b = document.createElement('button');
          b.className = 'filtre-chip' + (filtreMesure === val ? ' actif' : '');
          b.textContent = nom;
          b.addEventListener('click', function(){ filtreMesure = val; renderEtudes(dernierProfil); });
          barre.appendChild(b);
        };
        faireChip('Toutes', null);
        familles.forEach(function(f){ faireChip(f, f); });
        section.appendChild(barre);
      }

      affichees.forEach(function(item) {
        section.appendChild(creerCarteEtude(item.etude, item.m));
      });
      configurerRepliables(section);
    }

    if (ecartees.length) {
      var note = document.createElement('div');
      note.style.cssText = 'font-size:13px;color:#636e72;margin-top:14px;';
      note.innerHTML = '<em>' + ecartees.length + ' étude(s) écartée(s)</em> : la patiente est hors de leurs critères d\'inclusion. ' +
        '<button class="btn btn-ghost" id="btn-ecartees" style="padding:4px 10px;font-size:12px;">Voir pourquoi ↓</button>' +
        '<div id="liste-ecartees" style="display:none;margin-top:8px;"></div>';
      section.appendChild(note);
      var liste = note.querySelector('#liste-ecartees');
      liste.innerHTML = ecartees.map(function(x){
        var raisons = x.m.violees.map(function(cr){ return labelCritere(cr); }).join(', ');
        return '<div style="padding:6px 0;border-top:1px solid #eee;"><b>' + esc(titreEtude(x.etude)) + '</b> — hors critère : ' + esc(raisons) + '</div>';
      }).join('');
      note.querySelector('#btn-ecartees').addEventListener('click', function(){
        var v = liste.style.display === 'none';
        liste.style.display = v ? 'block' : 'none';
        this.textContent = v ? 'Masquer ↑' : 'Voir pourquoi ↓';
      });
    }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c];
    });
  }

  function badgeEligibilite(m) {
    if (m.indisponible) return { texte: 'Appariement indisponible', cls: 'badge-neutre' };
    var s = m.satisfaites.length, ind = m.indeterminees.length;
    var t = '✅ ' + s + ' critère' + (s > 1 ? 's' : '') + ' d\'inclusion vérifié' + (s > 1 ? 's' : '');
    if (ind) t += ' · ' + ind + ' à préciser';
    return { texte: t, cls: 'badge-ok' };
  }

  function chips(noms, cls) {
    return noms.map(function(n) {
      return '<span class="critere-chip ' + cls + '">' + esc(n) + '</span>';
    }).join('');
  }

  function titreEtude(etude) {
    return (etude.titre && etude.titre.trim()) || etude.reference || '(étude sans titre)';
  }
  function auteursEtude(etude) {
    return (etude.auteurs && etude.auteurs.trim()) || '';
  }

  function comparaisonsEtude(etude) {
    if (!Array.isArray(etude.comparaisons)) return [];
    return etude.comparaisons.map(function(c) {
      var bras = Array.isArray(c.bras) ? c.bras.map(function(b){ return { label: b.label || '', valeur: b.valeur }; }) : [];
      return { mesure: c.mesure || '', unite: c.unite || '', sens: c.sens || '', bras: bras };
    });
  }
  
  var PALETTE_BARS = ['#2563eb','#16a34a','#9333ea','#0891b2','#f59e0b','#e11d48','#0d9488'];

  // Décompose une mesure en { famille, temps }. Utilise les champs explicites
  // famille/temps s'ils existent, sinon les DÉDUIT du libellé ("Survie globale
  // à 5 ans" → famille "Survie globale", temps 5). Permet le graphe temporel et
  // le filtre sans re-saisir les données existantes.
  function analyserMesure(c) {
    var fam = c.famille, t = (c.temps != null ? Number(c.temps) : null);
    if (t == null) { var mt = String(c.mesure || '').match(/(\d+(?:[.,]\d+)?)\s*ans?/i); if (mt) t = parseFloat(mt[1].replace(',', '.')); }
    if (!fam) {
      fam = String(c.mesure || '')
        .replace(/\s*à\s+\d+(?:[.,]\d+)?\s*ans?/gi, '')   // "… à 5 ans"
        .replace(/\s*\d+(?:[.,]\d+)?\s*ans?/gi, '')         // "… 5 ans"
        .replace(/\s+/g, ' ').trim() || String(c.mesure || 'Mesure');
    }
    return { famille: fam, temps: t };
  }
  function familleDe(c) { return analyserMesure(c).famille; }

  function renduBarresMesure(c) {
    function pct(v){ return Math.max(0, Math.min(100, Number(v) || 0)); }
    var estPct = !c.unite || c.unite === '%';
    var vals = (c.bras || []).map(function(b){ return Number(b.valeur) || 0; });
    var maxV = Math.max.apply(null, vals.concat([0]));
    var barres = (c.bras || []).map(function(b, i){
      var raw = Number(b.valeur) || 0;
      var largeur = estPct ? pct(raw) : (maxV > 0 ? Math.round(raw / maxV * 100) : 0);
      var affich = estPct ? (pct(raw) + '%') : (raw + (c.unite ? (' ' + esc(c.unite)) : ''));
      return '<div class="barre-header" style="margin-top:' + (i ? 8 : 0) + 'px; margin-bottom:4px;"><span>' + esc(b.label || ('Bras ' + (i+1))) + '</span><span>' + affich + '</span></div>' +
        '<div class="barre-track"><div class="barre-fill" style="width:' + largeur + '%; background:' + PALETTE_BARS[i % PALETTE_BARS.length] + ';"></div></div>';
    }).join('');
    return (c.mesure ? '<div style="font-size:11px; font-weight:700; color:#374151; margin:14px 0 6px;">' + esc(c.mesure) + '</div>' : '') + barres;
  }

  // Mini-graphe d'évolution (points connectés) pour une famille de mesures à
  // plusieurs temps (ex. Survie globale à 5 et 10 ans), une courbe par bras.
  function renduGrapheTemps(famille, mesures) {
    var series = {}, temps = [], ordreBras = [];
    mesures.forEach(function(mm){
      var t = mm._temps; if (t == null) return;
      if (temps.indexOf(t) === -1) temps.push(t);
      (mm.bras || []).forEach(function(b){
        var lab = b.label || '?', v = Number(b.valeur); if (isNaN(v)) return;
        if (!series[lab]) { series[lab] = []; ordreBras.push(lab); }
        series[lab].push({ t: t, v: v });
      });
    });
    temps.sort(function(a,b){ return a-b; });
    if (ordreBras.length === 0 || temps.length < 2) return null;
    var W = 260, H = 150, padL = 16, padR = 10, padT = 12, padB = 22, maxV = 100;
    var tmin = temps[0], tmax = temps[temps.length-1];
    function X(t){ return padL + (tmax===tmin ? 0 : (t-tmin)/(tmax-tmin)) * (W-padL-padR); }
    function Y(v){ return padT + (1 - Math.max(0,Math.min(maxV,v))/maxV) * (H-padT-padB); }
    var svg = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" style="overflow:visible;">';
    [0,50,100].forEach(function(g){ var y = Y(g); svg += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W-padR) + '" y2="' + y + '" stroke="#eef2f7"/><text x="0" y="' + (y+3) + '" font-size="8" fill="#9aa1a8">' + g + '</text>'; });
    temps.forEach(function(t){ svg += '<text x="' + X(t) + '" y="' + (H-6) + '" font-size="9" fill="#636e72" text-anchor="middle">' + t + ' ans</text>'; });
    ordreBras.forEach(function(lab, i){
      var col = PALETTE_BARS[i % PALETTE_BARS.length];
      var pts = series[lab].slice().sort(function(a,b){ return a.t-b.t; });
      svg += '<polyline points="' + pts.map(function(p){ return X(p.t)+','+Y(p.v); }).join(' ') + '" fill="none" stroke="' + col + '" stroke-width="2"/>';
      pts.forEach(function(p){ svg += '<circle cx="' + X(p.t) + '" cy="' + Y(p.v) + '" r="3" fill="' + col + '"/><text x="' + X(p.t) + '" y="' + (Y(p.v)-6) + '" font-size="9" fill="' + col + '" text-anchor="middle" font-weight="700">' + Math.round(p.v) + '</text>'; });
    });
    svg += '</svg>';
    var leg = ordreBras.map(function(lab, i){ return '<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;margin-right:8px;"><span style="width:9px;height:9px;border-radius:2px;background:' + PALETTE_BARS[i % PALETTE_BARS.length] + ';display:inline-block;"></span>' + esc(lab) + '</span>'; }).join('');
    return '<div style="font-size:11px;font-weight:700;color:#374151;margin:14px 0 4px;">' + esc(famille) + ' — évolution</div>' + svg + '<div style="margin-top:4px;line-height:1.6;">' + leg + '</div>';
  }

  // Rend les résultats chiffrés d'une étude : filtre par famille, regroupe, et
  // affiche un graphe temporel si une famille a ≥2 temps (sinon des barres).
  function renduResultats(comps) {
    comps = comps.filter(function(c){ return !filtreMesure || familleDe(c) === filtreMesure; });
    if (!comps.length) return '<div style="font-size:12px; color:#9aa1a8;">Aucun résultat pour ce filtre.</div>';
    var groupes = {}, ordre = [];
    comps.forEach(function(c){ var a = analyserMesure(c); c._temps = a.temps; if (!groupes[a.famille]) { groupes[a.famille] = []; ordre.push(a.famille); } groupes[a.famille].push(c); });
    return ordre.map(function(fam){
      var ms = groupes[fam];
      var tousPct = ms.every(function(c){ return !c.unite || c.unite === '%'; });
      var tempsDist = {}; ms.forEach(function(c){ if (c._temps != null) tempsDist[c._temps] = 1; });
      if (tousPct && Object.keys(tempsDist).length >= 2) { var g = renduGrapheTemps(fam, ms); if (g) return g; }
      return ms.map(renduBarresMesure).join('');
    }).join('');
  }

  function creerCarteEtude(etude, m) {
    var card = document.createElement('div');
    card.style.cssText = 'background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,0.02);';
    var comps = comparaisonsEtude(etude);
    var barsHtml = comps.length ? renduResultats(comps)
      : '<div style="font-size:12px; color:#9aa1a8;">Résultats chiffrés non renseignés.</div>';
    var corr = badgeEligibilite(m);
    var satLabels = m.satisfaites.map(labelCritere);
    var indLabels = m.indeterminees.map(function(cr){ return labelCritere(cr) + ' (non renseigné)'; });
    var auteurs = auteursEtude(etude);

    card.innerHTML =
      '<div class="etude-flex" style="display:flex; justify-content:space-between; align-items:flex-start; gap:40px;">' +
        '<div style="flex:1;">' +
          '<div class="repliable"><h4 class="repliable-txt" data-lignes="2" style="margin:0 0 4px 0; font-size:15px; color:#1a1a1a; font-weight:700;">' + esc(titreEtude(etude)) + '</h4><button class="repliable-btn" type="button">déplier ▾</button></div>' +
          (auteurs ? '<div class="repliable" style="margin-bottom:10px;"><div class="repliable-txt" data-lignes="1" style="font-size:12px; color:#9aa1a8;">' + esc(auteurs) + '</div><button class="repliable-btn" type="button">déplier ▾</button></div>' : '<div style="margin-bottom:10px;"></div>') +
          (etude.niveau_preuve || etude.objectif ?
            '<div style="font-size:12px; color:#636e72; margin-bottom:10px;">' +
              (etude.niveau_preuve ? '<span style="font-weight:700;">Niveau de preuve ' + esc(etude.niveau_preuve) + '</span>' : '') +
              (etude.niveau_preuve && etude.objectif ? ' — ' : '') +
              (etude.objectif ? esc(etude.objectif) : '') +
            '</div>' : '') +
          '<span class="badge-correspondance ' + corr.cls + '">' + corr.texte + '</span>' +
          '<button class="btn btn-ghost btn-toggle" style="padding: 6px 12px; font-size: 12px; margin: 10px 0 0; display:block;">Voir le détail des critères ↓</button>' +
          '<div class="zone-details" style="display:none; padding-top: 10px;">' +
            (satLabels.length > 0 ? '<div style="margin-bottom:8px;">' + chips(satLabels, 'chip-ok') + '</div>' : '') +
            (indLabels.length > 0 ? '<div style="margin-bottom:8px;">' + chips(indLabels, 'chip-neutre') + '</div>' : '') +
            (etude.lien ? '<a href="'+esc(etude.lien)+'" target="_blank" style="font-size:13px; color:var(--orange); text-decoration:none; font-weight:600;">Ouvrir l\'article PubMed →</a>' : '') +
          '</div>' +
        '</div>' +
        '<div class="etude-bars" style="width: 260px; flex-shrink:0;">' +
          '<div style="font-size: 11px; font-weight: 700; color: #636e72; text-transform: uppercase; margin-bottom: 10px;">📊 Résultats chiffrés</div>' +
          barsHtml +
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

  function iconeFemme(couleur) {
    // Silhouette féminine reconnaissable (tête + robe évasée + jambes).
    return '<svg width="12" height="19" viewBox="0 0 20 32" fill="' + couleur + '" style="margin:1.5px;flex-shrink:0;" aria-hidden="true">' +
      '<circle cx="10" cy="5" r="4.3"/>' +
      '<path d="M10 10c-2.4 0-3.6 1.4-4.3 3.6L3 21h3l.8-2.4V30h2.3v-7.5h1.8V30h2.3V18.6L14 21h3l-2.7-7.4C13.6 11.4 12.4 10 10 10z"/>' +
      '</svg>';
  }
  // Replie/déplie les blocs de texte longs (titre, auteurs). Masque le bouton
  // quand le texte tient déjà sur les lignes autorisées (pas de débordement).
  function configurerRepliables(root) {
    root.querySelectorAll('.repliable').forEach(function(r) {
      var txt = r.querySelector('.repliable-txt'), btn = r.querySelector('.repliable-btn');
      if (!txt || !btn) return;
      if (txt.scrollHeight <= txt.clientHeight + 2) { btn.style.display = 'none'; return; }
      btn.addEventListener('click', function() {
        var ouvert = r.classList.toggle('ouvert');
        btn.textContent = ouvert ? 'replier ▴' : 'déplier ▾';
      });
    });
  }
  function pictoGrille(valeur, couleur) {
    var n = Math.max(0, Math.min(100, Math.round(Number(valeur) || 0)));
    var femmes = '';
    for (var i = 0; i < 100; i++) {
      femmes += iconeFemme(i < n ? couleur : '#dbe0e6');
    }
    return '<div style="display:flex;flex-wrap:wrap;width:160px;flex-shrink:0;">' + femmes + '</div>';
  }


  function phraseResume(c) {
    var bras = (c.bras || []).map(function(b){ return { label: b.label || '', v: Number(b.valeur) }; })
                             .filter(function(b){ return !isNaN(b.v); });
    if (!bras.length) return '';
    var unite = (!c.unite || c.unite === '%') ? ' sur 100' : (' ' + esc(c.unite));
    if (bras.length === 1) return 'Environ <b>' + Math.round(bras[0].v) + unite + '</b> avec « ' + esc(bras[0].label) + ' ».';
    // Ordre d'énoncé selon le sens clinique : on cite d'abord le bras le plus
    // favorable. Sans sens renseigné, on n'exprime aucun jugement (ordre par
    // valeur décroissante, purement factuel).
    var tri = bras.slice().sort(function(a,b){ return c.sens === 'bas' ? a.v - b.v : b.v - a.v; });
    var prem = tri[0], dern = tri[tri.length - 1];
    return 'Environ <b>' + Math.round(prem.v) + unite + '</b> avec « ' + esc(prem.label) +
           ' », contre <b>' + Math.round(dern.v) + unite + '</b> avec « ' + esc(dern.label) + ' ».';
  }

  function ouvrirVuePatiente() {
    var ov = $('vue-patiente');
    if (!ov) { ov = document.createElement('div'); ov.id = 'vue-patiente'; document.body.appendChild(ov); }
    ov.style.cssText = 'position:fixed;inset:0;z-index:200;background:#fff;overflow:auto;padding:32px 20px;';
    var h = '<div style="max-width:840px;margin:0 auto;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:16px;">' +
        '<h2 style="font-size:26px;font-weight:800;margin:0;">Ce que disent les études</h2>' +
        '<button onclick="fermerVuePatiente()" style="font-size:16px;padding:10px 18px;border-radius:10px;border:none;background:#111;color:#fff;cursor:pointer;flex-shrink:0;">✕ Fermer</button>' +
      '</div>' +
      '<p style="color:#636e72;font-size:14px;margin:0 0 24px;">Chiffres issus de la littérature, à discuter avec votre médecin. Ils décrivent des groupes de patientes, pas une certitude individuelle.</p>';
    if (!dernieresEtudesRetenues.length) h += '<p>Aucune étude correspondante pour ce parcours.</p>';
    dernieresEtudesRetenues.slice(0, 8).forEach(function(etude) {
      var comps = comparaisonsEtude(etude).filter(function(c){ return !filtreMesure || familleDe(c) === filtreMesure; });
      h += '<div style="border:1px solid #e5e7eb;border-radius:16px;padding:24px;margin-bottom:20px;">';
      h += '<h3 style="font-size:18px;font-weight:800;margin:0 0 4px;">' + esc(titreEtude(etude)) + '</h3>';
      if (etude.niveau_preuve) h += '<div style="color:#636e72;font-size:13px;margin-bottom:14px;">Niveau de preuve ' + esc(etude.niveau_preuve) + '</div>';
      if (!comps.length) h += '<p style="color:#9aa1a8;">Pas de résultat chiffré renseigné pour cette étude.</p>';
      comps.forEach(function(c) {
        var estPct = !c.unite || c.unite === '%';
        h += '<div style="margin:18px 0;">';
        if (c.mesure) h += '<div style="font-weight:700;font-size:16px;margin-bottom:12px;">' + esc(c.mesure) + '</div>';
        if (estPct) {
          (c.bras || []).forEach(function(b, i) {
            var col = PALETTE_BARS[i % PALETTE_BARS.length];
            h += '<div style="display:flex;gap:16px;align-items:center;margin-bottom:14px;">' +
              pictoGrille(b.valeur, col) +
              '<div><div style="font-size:24px;font-weight:800;color:' + col + ';">' + Math.round(Number(b.valeur) || 0) + ' sur 100</div>' +
              '<div style="font-size:15px;color:#374151;">' + esc(b.label || ('Bras ' + (i + 1))) + '</div></div>' +
            '</div>';
          });
        } else {
          var maxV = Math.max.apply(null, (c.bras || []).map(function(b){ return Number(b.valeur) || 0; }).concat([0]));
          (c.bras || []).forEach(function(b, i) {
            var col = PALETTE_BARS[i % PALETTE_BARS.length];
            var w = maxV > 0 ? Math.round((Number(b.valeur) || 0) / maxV * 100) : 0;
            h += '<div style="margin-bottom:10px;"><div style="display:flex;justify-content:space-between;font-size:15px;"><span>' + esc(b.label || ('Bras ' + (i + 1))) + '</span><span style="font-weight:800;">' + (Number(b.valeur) || 0) + ' ' + esc(c.unite || '') + '</span></div>' +
              '<div style="height:14px;background:#eef2f7;border-radius:7px;overflow:hidden;"><div style="height:100%;width:' + w + '%;background:' + col + ';"></div></div></div>';
          });
        }
        var ph = phraseResume(c);
        if (ph) h += '<div style="font-size:15px;color:#1f2937;background:#f8fafc;border-radius:10px;padding:12px 16px;margin-top:6px;">' + ph + '</div>';
        h += '</div>';
      });
      if (etude.lien) h += '<a href="' + esc(etude.lien) + '" target="_blank" style="font-size:13px;color:#e67e22;font-weight:600;">Ouvrir l\'article →</a>';
      h += '</div>';
    });
    h += '</div>';
    ov.innerHTML = h;
    ov.style.display = 'block';
    window.scrollTo(0, 0);
  }
  function fermerVuePatiente() { var ov = $('vue-patiente'); if (ov) ov.style.display = 'none'; }

  window.ouvrirVuePatiente = ouvrirVuePatiente;
  window.fermerVuePatiente = fermerVuePatiente;
  window.demarrer         = demarrer;
  window.reculer          = reculer;
  window.recommencer      = recommencer;
  window.accueil          = recommencer;
  window.apparierEtude = apparierEtude;

  load();
}());
