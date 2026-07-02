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
  var criteresSchema = {};        // registre canonique {id: {label, type, valeurs}} (schema_criteres.json)
  var schemaBrut = {};            // schéma complet chargé, conservé pour la validation
  var dernieresEtudesRetenues = [];  // études affichées au dernier résultat (pour la vue patiente)
  var avertissementsSchema = [];  // problèmes de chargement du contrat (persistants)
  var avertissements = [];        // problèmes détectés sur le parcours courant (recalculés à chaque résultat)

  function $(id) { return document.getElementById(id); }

  // Configuration du moteur de correspondance.
  // Source de vérité : schema_criteres.json (chargé au démarrage, éditable hors code).
  // Les valeurs ci-dessous ne servent que de SECOURS si le fichier est introuvable
  // (ex. ouverture en file://), pour que l'app reste fonctionnelle hors ligne.
  var MAPPING_DEFAUT = {
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
    'T4a':         ['T4','T4a','T1, T2, T3, T4','T4a, T3, T4b, T4c, T1, T2'],
    'T4b':         ['T4','T4b','T1, T2, T3, T4','T4a, T3, T4b, T4c, T1, T2'],
    'T4c':         ['T4','T4c','T1, T2, T3, T4','T4a, T3, T4b, T4c, T1, T2'],
    'T4d':         ['T4','T4d','T1, T2, T3, T4','T4a, T3, T4b, T4c, T1, T2'],
    'Tis':         ['Tis','in situ','CCIS'],
    // N0/cN0/pN0 et N+/pN+/pN1-x : équivalence clinique/pathologique déjà admise par les
    // entrées existantes (N0 ⟷ pN0) — complétée ici pour couvrir aussi le préfixe "c" (clinique)
    // et les sous-catégories pN1-2/pN1-3/pN4+ effectivement présentes dans base_etudes.json.
    'N0':          ['N0','pN0','cN0','N0, N1','N2, N3, N0, N1'],
    'N+':          ['N+','pN+','pN1','pN1-2','pN1-3','pN4+','N1','N2','N0, N1','N2, N3, N0, N1'],
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
    // Mutation BRCA : reliée au vocabulaire des études ("BRCA1, BRCA2") via les questions
    // BRCA déjà présentes dans certains protocoles (néoadjuvant, rechute avancée).
    // T, N, M, RE, RP, Age sont désormais demandés par le prélude de profil clinique
    // (construirePrelude) commun à tous les protocoles. HER2, Ki67, Marges, Grade, Emboles...
    // restent neutres : aucune étude de la base ne les utilise, ou leur vocabulaire est
    // trop hétérogène pour un rapprochement fiable sans deviner une règle clinique.
    'Mutation':        ['BRCA1','BRCA2'],
    'BRCA muté':       ['BRCA1','BRCA2'],
  };

  var NUMERIQUES_DEFAUT = ['Ki67 (%)','ki67','Age','age','Marges (mm)','Marges et autres paramètres'];
  var NEUTRES_DEFAUT = ['nc','-1','-1.0','nan','','n/a','nr'];

  // Variables actives : initialisées au secours, remplacées par schema_criteres.json au chargement.
  var MAPPING    = MAPPING_DEFAUT;
  var NUMERIQUES = NUMERIQUES_DEFAUT;
  var NEUTRES    = NEUTRES_DEFAUT;

  function normaliser(v) {
    if (v === null || v === undefined) return '';
    return String(v).toLowerCase().trim();
  }

  // Le moteur de correspondance (matchCategoriel, matchNumerique, valeurPatient,
  // calculerScore) vit dans contrat.js (AtlasContrat), partagé avec les tests et la CI.

  // Valide un tag canonique (critère + valeur) posé dans l'éditeur d'arbres contre le schéma.
  // Tout vocabulaire inconnu est enregistré pour affichage : jamais ignoré en silence.
  function validerTag(critere, valeur) {
    var def = criteresSchema[critere];
    if (!def) {
      avertissements.push('Question reliée à un critère inconnu du schéma : « ' + critere +
        ' ». Corrigez le critère dans l\'éditeur d\'arbres, ou ajoutez-le à schema_criteres.json.');
      return;
    }
    if (def.type === 'numerique') return; // valeur numérique libre (nombre brut)
    if (Array.isArray(def.valeurs) && def.valeurs.length &&
        def.valeurs.map(normaliser).indexOf(normaliser(valeur)) === -1) {
      avertissements.push('Réponse « ' + valeur + ' » non prévue pour le critère « ' + critere +
        ' » (valeurs attendues : ' + def.valeurs.join(', ') + ').');
    }
  }

  function construireProfil() {
    var profil = {};
    avertissements = []; // recalculé pour ce parcours
    history.forEach(function(h) {
      if (h.skip) return; // question passée : aucun critère enregistré
      var node  = h.node || {};
      var label = h.label || '';
      var rep   = node.reponses ? node.reponses[label] : undefined;
      // Lien canonique multi-critères : une réponse peut renseigner plusieurs
      // critères à la fois — reponses[label] = { critere: valeur, ... }.
      if (rep && typeof rep === 'object') {
        Object.keys(rep).forEach(function(crit) {
          if (String(rep[crit]).trim() !== '') {
            profil[crit] = rep[crit];
            validerTag(crit, rep[crit]);
          }
        });
      } else if (node.critere) {
        // Lien canonique simple (ancien format : un seul critère par question).
        var valeur = (rep !== undefined) ? rep : label;
        profil[node.critere] = valeur;
        validerTag(node.critere, valeur);
      }
      // Lien hérité (titre de question → label) : conservé pour les arbres pas encore tagués.
      if (node.titre && label) profil[node.titre] = label;
    });
    console.log('[Atlas] 👤 Profil :', JSON.stringify(profil));
    return profil;
  }

  // Affiche (ou masque) la bannière de validation : contrat non chargé + vocabulaire inconnu.
  function renderAvertissements() {
    var box = $('validation-banner');
    if (!box) return;
    var tous = avertissementsSchema.concat(avertissements);
    if (!tous.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.style.cssText = 'display:block;background:#fef3c7;border:1px solid #f59e0b;border-radius:12px;padding:14px 18px;margin-bottom:24px;color:#78350f;font-size:13px;line-height:1.5;';
    box.innerHTML = '<strong>⚠️ Avertissements de cohérence des données</strong><ul style="margin:8px 0 0;padding-left:20px;">' +
      tous.map(function(m){ return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>';
  }

  // Délègue au moteur partagé (contrat.js). Les critères neutres sont ignorés
  // (ni score, ni concordance). Dégrade proprement si le module manque.
  function calculerScoreEtude(etude, profilPatient) {
    if (!window.AtlasContrat) return { valeur: null, total: 0, colonnes: [], mismatches: [] };
    return window.AtlasContrat.calculerScore(etude, profilPatient, {
      mapping: MAPPING, numeriques: NUMERIQUES, neutres: NEUTRES, keyMapping: keyMapping
    });
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

  // Profil clinique : prélude de questions de stadification/biomarqueurs (T, N, M, RE, RP, Age)
  // prépendu devant CHAQUE arbre de protocole, sans toucher à la logique clinique SENORIF elle-même.
  // Sert uniquement à peupler le profil patient pour le rapprochement bibliographique
  // (calculerScoreEtude / valeurPatient) avec des critères réellement comparables aux études.
  // Chaque question du prélude porte un tag canonique (critere + reponses) : le profil
  // patient est construit via le MÊME mécanisme que les tags des arbres (construireProfil),
  // pas par une correspondance de titres. C'est le mécanisme unique de rapprochement.
  function construirePrelude(suite) {
    var qAge = { type: 'numerique', titre: 'Âge de la patiente (années)', critere: 'Age', suite: suite };
    var qRP  = { type: 'question', titre: 'Statut RP (récepteurs de la progestérone)', critere: 'RP',
                 choix: { 'Positif': qAge, 'Négatif': qAge }, reponses: { 'Positif': 'RP+', 'Négatif': 'RP-' } };
    var qRE  = { type: 'question', titre: 'Statut RE (récepteurs des œstrogènes)', critere: 'RE',
                 choix: { 'Positif': qRP, 'Négatif': qRP }, reponses: { 'Positif': 'RE+', 'Négatif': 'RE-' } };
    var qM   = { type: 'question', titre: 'Statut métastatique (M)', critere: 'M',
                 choix: { 'M0': qRE, 'M1': qRE }, reponses: { 'M0': 'M0', 'M1': 'M1' } };
    var qN   = { type: 'question', titre: 'Statut ganglionnaire (N)', critere: 'N',
                 choix: { 'N0': qM, 'N+': qM }, reponses: { 'N0': 'N0', 'N+': 'N+' } };
    var qT   = {
      type: 'question', titre: 'Stade tumoral (T)', critere: 'T',
      choix: {
        'Tis':  qN, 'T1a': qN, 'T1b': qN, 'T1c': qN, 'T2': qN,
        'T3':   qN, 'T4a': qN, 'T4b': qN, 'T4c': qN, 'T4d': qN
      },
      reponses: {
        'Tis': 'Tis', 'T1a': 'T1a', 'T1b': 'T1b', 'T1c': 'T1c', 'T2': 'T2',
        'T3': 'T3', 'T4a': 'T4a', 'T4b': 'T4b', 'T4c': 'T4c', 'T4d': 'T4d'
      }
    };
    return qT;
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
      if (window.AtlasContrat) {
        var res = window.AtlasContrat.validerBase({ etudes: etudes }, schemaBrut);
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

  // 1c. Chargement du contrat de données partagé (schema_criteres.json) :
  // synonymes de valeurs (MAPPING) + liste des critères numériques (NUMERIQUES),
  // sortis du code pour être éditables sans toucher à l'application.
  function chargerSchema() {
    var v = '?_v=' + Date.now();
    return fetch('schema_criteres.json' + v).then(function(r) {
      if (!r.ok) throw new Error('schema_criteres.json HTTP ' + r.status);
      return r.json();
    }).then(function(schema) {
      if (schema && schema.valeurs_synonymes && typeof schema.valeurs_synonymes === 'object') {
        MAPPING = schema.valeurs_synonymes;
      }
      if (schema && Array.isArray(schema.criteres_numeriques)) {
        NUMERIQUES = schema.criteres_numeriques;
      }
      if (schema && schema.criteres && typeof schema.criteres === 'object') {
        criteresSchema = schema.criteres;
      }
      if (schema && Array.isArray(schema.valeurs_neutres)) {
        NEUTRES = schema.valeurs_neutres.map(normaliser);
      }
      schemaBrut = schema || {};
      // Bannière « démo » affichée par défaut ; masquée seulement si validé explicitement.
      if (schema && schema.mode_demo === false) {
        var bn = $('demo-banner'); if (bn) bn.style.display = 'none';
      }
      if (window.AtlasContrat) {
        var res = window.AtlasContrat.validerSchema(schema);
        if (!res.ok) {
          avertissementsSchema.push('Le contrat de données (schema_criteres.json) est mal formé : ' + res.erreurs[0]);
          res.erreurs.forEach(function(m){ console.error('[Atlas] schema :', m); });
        }
      }
      console.log('[Atlas] ✅ Schéma de critères chargé (critères canoniques : ' +
        Object.keys(criteresSchema).length + ', synonymes : ' +
        Object.keys(MAPPING).length + ', critères numériques : ' + NUMERIQUES.length + ').');
    }).catch(function(err) {
      avertissementsSchema.push('Le contrat de données (schema_criteres.json) n\'a pas pu être chargé (' +
        err.message + '). Le moteur de correspondance utilise sa configuration de secours intégrée.');
      console.warn('[Atlas] schema_criteres.json indisponible — configuration de secours intégrée utilisée :', err.message);
    });
  }

  // Bannière d'accueil : affiche visiblement tout problème de chargement/validation
  // des données (schéma ou base) au lieu de les taire dans la console.
  function renderHomeBanner() {
    var box = $('home-banner');
    if (!box) return;
    if (!avertissementsSchema.length) { box.style.display = 'none'; return; }
    box.style.cssText = 'display:block;background:#7f1d1d;border:1px solid #fecaca;border-radius:12px;padding:14px 18px;margin-bottom:20px;color:#fff;font-size:13px;line-height:1.5;text-align:left;';
    box.innerHTML = '<strong>⚠️ Problème de données détecté</strong><ul style="margin:8px 0 0;padding-left:20px;">' +
      avertissementsSchema.map(function(m){ return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>';
  }

  // 2. Chargement initial : schéma d'abord (utile aux deux autres), puis registre + littérature
  function load() {
    chargerSchema().then(function() {
      return Promise.all([chargerListeProtocoles(), chargerLitterature()]);
    }).then(function() {
      var bh = $('btn-start-hero');
      if (bh) { bh.disabled = false; bh.textContent = 'Commencer l\'évaluation →'; }
      renderHomeBanner();
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
      // Extrait le sous-arbre "tree" du nouveau format de fichier, puis le précède
      // du prélude de profil clinique (T, N, M, RE, RP, Age) — sans modifier l'arbre lui-même.
      var arbreProtocole = data.tree || data;
      tree = construirePrelude(arbreProtocole);
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

  // Cible d'un "passer" : possible uniquement si la question ne détermine pas le
  // chemin clinique (toutes les réponses mènent au même nœud suivant — cas des
  // questions de stadification/profil du prélude). Sinon, null (on ne peut pas
  // sauter une vraie décision thérapeutique).
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

  // Ajoute un bouton "Je ne sais pas — passer" quand la question peut être sautée.
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
    sourceDiv.innerHTML = '<span class="recommendation-label">✅ Recommandation</span><span class="recommendation-text">' + esc(node.titre || 'Orientation thérapeutique validée') + '</span>';
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
      renderEtudes(profil);
      renderAvertissements();
    } catch(err) {
      console.error('[Atlas] Erreur analyse littérature :', err);
    }
  }

  function renderEtudes(profil) {
    var section = $('etudes-section'); if (!section) return;
    section.innerHTML = '';
    if (!etudes || !etudes.length) return;

    var scored = etudes.map(function(e) {
      var res = calculerScoreEtude(e, profil);
      return { etude: e, score: res.valeur, total: res.total, colonnes: res.colonnes, mismatches: res.mismatches };
    });

    var retenues = scored
      .filter(function(e) { return e.colonnes.length > 0; })
      .sort(function(a,b) {
        var ia = Number(a.etude.importance) || 0, ib = Number(b.etude.importance) || 0;
        return (ib - ia) || (b.colonnes.length - a.colonnes.length); // importance d'abord, puis concordance
      });
    dernieresEtudesRetenues = retenues.map(function(r){ return r.etude; });

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

    var btnVP = document.createElement('button');
    btnVP.className = 'btn btn-primary';
    btnVP.textContent = '👩‍⚕️ Vue patiente (chiffres simplifiés)';
    btnVP.style.cssText = 'color:#fff;margin-bottom:18px;';
    btnVP.addEventListener('click', ouvrirVuePatiente);
    section.appendChild(btnVP);

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

  // Étoiles d'importance (classement du curateur, 0–5). Vide si non classée.
  function etoiles(n) {
    n = Math.max(0, Math.min(5, Number(n) || 0));
    if (!n) return '';
    return '<span title="Importance ' + n + '/5" style="color:#f59e0b;font-size:14px;letter-spacing:1px;">' +
      Array(n + 1).join('★') + '<span style="color:#d1d5db;">' + Array(6 - n).join('★') + '</span></span>';
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

  // Résultats chiffrés d'une étude : liste de mesures, chacune comparant un
  // nombre libre de BRAS { label (traitement), valeur }. Les traitements comparés
  // ne sont donc pas codés en dur. Rétro-compatible avec :
  //  - comparaisons:[{mesure, standard, controle}] (2 bras nommés Standard/Contrôle),
  //  - comparaison:{avec:{valeur,unite}, sans:{valeur,unite}} (ancien format unique).
  function brasDeComparaison(c) {
    if (Array.isArray(c.bras)) {
      return c.bras.map(function(b){ return { label: b.label || '', valeur: b.valeur }; });
    }
    var bras = [];
    if (c.standard !== undefined) bras.push({ label: 'Standard', valeur: c.standard });
    if (c.controle !== undefined) bras.push({ label: 'Contrôle', valeur: c.controle });
    return bras;
  }
  function comparaisonsEtude(etude) {
    if (Array.isArray(etude.comparaisons)) {
      return etude.comparaisons.map(function(c) {
        return { mesure: c.mesure || '', unite: c.unite || '', bras: brasDeComparaison(c) };
      });
    }
    var c = etude.comparaison;
    if (c && (c.avec || c.sans)) {
      var bras = [];
      if (c.avec) bras.push({ label: 'Standard', valeur: c.avec.valeur });
      if (c.sans) bras.push({ label: 'Contrôle', valeur: c.sans.valeur });
      return [{ mesure: (c.avec && c.avec.unite) || (c.sans && c.sans.unite) || '', unite: '', bras: bras }];
    }
    return [];
  }
  var PALETTE_BARS = ['#2563eb','#16a34a','#9333ea','#0891b2','#f59e0b','#e11d48','#0d9488'];

  function creerCarteEtude(etude, score, total, colonnes, mismatches) {
    var card = document.createElement('div');
    card.style.cssText = 'background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,0.02);';
    // Résultats chiffrés : liste modulable de mesures (ex. "OS à 5 ans", "OS à 10 ans"),
    // chacune avec sa barre Standard et Contrôle. On affiche tout ce qui est renseigné,
    // ou rien. Number()||0 borne l'affichage et neutralise toute injection (les valeurs
    // viennent d'un JSON éditable par un humain).
    function pct(v){ return Math.max(0, Math.min(100, Number(v) || 0)); }
    var comps = comparaisonsEtude(etude);
    var barsHtml = comps.length
      ? comps.map(function(c){
          // % → barre absolue (0-100). Autre unité (mois, points…) → barre relative au max.
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
        }).join('')
      : '<div style="font-size:12px; color:#9aa1a8;">Résultats chiffrés non renseignés.</div>';
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
          (etude.importance ? '<div style="margin-bottom:8px;">' + etoiles(etude.importance) + '</div>' : '') +
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

  // ─── Vue patiente : présentation simplifiée des résultats (pictogrammes "X sur 100") ───
  // Silhouette de femme (tête + robe) colorée : remplie = concernée, grise = non.
  function iconeFemme(couleur) {
    return '<svg width="13" height="18" viewBox="0 0 24 30" style="margin:1px;flex-shrink:0;" aria-hidden="true">' +
      '<circle cx="12" cy="5" r="4.2" fill="' + couleur + '"/>' +
      '<path d="M12 10 L18 27 H6 Z" fill="' + couleur + '"/></svg>';
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
    var tri = bras.slice().sort(function(a,b){ return b.v - a.v; });
    var best = tri[0], worst = tri[tri.length - 1];
    return 'Environ <b>' + Math.round(best.v) + unite + '</b> avec « ' + esc(best.label) +
           ' », contre <b>' + Math.round(worst.v) + unite + '</b> avec « ' + esc(worst.label) + ' ».';
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
      var comps = comparaisonsEtude(etude);
      h += '<div style="border:1px solid #e5e7eb;border-radius:16px;padding:24px;margin-bottom:20px;">';
      h += '<h3 style="font-size:18px;font-weight:800;margin:0 0 4px;">' + esc(titreEtude(etude)) + '</h3>';
      if (etude.importance) h += '<div style="margin-bottom:6px;">' + etoiles(etude.importance) + '</div>';
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
  window.calculerScoreEtude = calculerScoreEtude;

  load();
}());
