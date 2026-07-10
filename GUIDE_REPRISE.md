# Guide de reprise — Atlas des facteurs pronostiques en cancer du sein

> Document de reprise technique. À lire en premier par toute personne qui reprend,
> maintient ou fait évoluer le projet. Rédigé pour l'Institut Curie.
> Dernière mise à jour : juillet 2026.

---

## 1. En une page (l'essentiel)

**Ce que fait le projet.** Un site statique qui réunit **trois outils** autour du
cancer du sein :

1. **L'Atlas** (`index.html`) — application clinique. La patiente répond à un
   questionnaire (arbre de décision) ; l'app en déduit un profil, puis affiche
   les **études** pertinentes (celles dont la patiente relève des critères
   d'inclusion) avec leurs résultats chiffrés (graphes, barres, filtres).
2. **L'éditeur d'arbres** (`editeur-arbres.html`) — construit/modifie les arbres
   de décision (les « protocoles ») sans écrire de code.
3. **L'éditeur de base** (`editeur-base.html`) — construit/modifie la base
   d'études (critères d'inclusion, résultats chiffrés).

Les deux éditeurs **publient directement** sur le dépôt GitHub via l'API (un
jeton personnel stocké dans le navigateur), et le site se redéploie tout seul.

**Stack.** Pas de framework, pas d'étape de build. **JavaScript vanilla** + HTML
+ CSS, servis tels quels. Déployé sur **GitHub Pages**, destiné à finir sur
l'**intranet Curie**. On ouvre les fichiers `.html` directement (via un petit
serveur local ou GitHub Pages).

**Le cœur du système.** Un **contrat de données partagé** (`src/js/contrat.js`)
+ un **dictionnaire typé de critères** (`src/data/vocabulaire.json`). C'est ce
qui relie les arbres aux études de façon fiable. Tout passe par là. **Si vous ne
lisez qu'un fichier, lisez `contrat.js`.**

**Garde-fou.** Une CI GitHub (`.github/workflows/valider.yml`) refuse toute
donnée incohérente avant qu'elle n'atteigne l'application clinique.

---

## 2. Arborescence du dépôt

```
Atlas-cancer-du-sein-/
├── index.html                 # L'Atlas (application clinique)
├── editeur-arbres.html        # Éditeur d'arbres de décision (autonome, 1 fichier)
├── editeur-base.html          # Éditeur de la base d'études (autonome, 1 fichier)
├── GUIDE_REPRISE.md           # CE document
│
├── src/
│   ├── css/
│   │   └── styles.css         # Styles de l'Atlas
│   ├── js/
│   │   ├── contrat.js         # ★ CONTRAT PARTAGÉ — le cœur (voir §5)
│   │   ├── app.js             # Logique de l'Atlas (quiz + affichage études)
│   │   └── publier.js         # Publication GitHub (API Contents) — utilisé par les 2 éditeurs
│   └── data/
│       ├── vocabulaire.json   # ★ DICTIONNAIRE TYPÉ des critères (source de vérité du matching)
│       ├── base_etudes.json   # La base d'études (données affichées par l'Atlas)
│       ├── prelude.json       # Questions cliniques communes ajoutées en tête d'arbre
│       └── protocoles/
│           ├── index.json     # Registre des arbres disponibles {id, nom, fichier}
│           ├── situ_infiltrant.json
│           ├── traitement_neoadjuvant.json
│           ├── chirurgie_axillaire.json
│           ├── radiotherapie_avance.json
│           └── diagnostique_et_biopsie.json
│
├── scripts/                   # Outils Node/Python (hors navigateur — dev & CI)
│   ├── valider.mjs            # Validation stricte du contrat (lancée par la CI)
│   ├── test-serialisation.mjs # Tests round-trip arbre ⇄ graphe
│   ├── test-appariement.mjs   # Tests du moteur d'appariement typé
│   ├── test-validation.mjs    # Tests du validateur strict
│   ├── migrer-eligibilite.mjs # Dérive les `contraintes` typées depuis les `criteres` texte
│   └── etl-these.py           # Import d'un Excel de thèse → base_etudes.json (voir §11)
│
└── .github/workflows/
    └── valider.yml            # CI : validation + 3 suites de tests à chaque push sur main
```

Chaque éditeur est un **fichier HTML autonome** (styles + script inline) qui
charge seulement `contrat.js` et `publier.js`. C'est volontaire : simple à
déplacer, à ouvrir, à comprendre.

---

## 3. Architecture & principes

- **Site 100 % statique.** Aucun serveur applicatif, aucune base de données, aucun
  build. Les « données » sont des fichiers JSON versionnés dans le dépôt.
- **Trois consommateurs, une source de vérité.** L'Atlas et les deux éditeurs
  lisent tous le **même** `vocabulaire.json` et le **même** `contrat.js`. On ne
  duplique jamais la logique de matching.
- **Édition sans code.** Le personnel médical modifie arbres et études via les
  éditeurs, qui écrivent le JSON directement sur GitHub. Le déploiement est
  automatique (GitHub Pages).
- **Sécurité = responsabilité de Curie (intranet).** Le jeton GitHub est un PAT
  *fine-grained* (permission `Contents: Read and write`), stocké **uniquement**
  dans le `localStorage` du navigateur, envoyé **uniquement** à `api.github.com`.
  On n'ajoute pas de couche d'authentification maison : le site vit derrière
  l'intranet.
- **Ne jamais casser l'appli clinique.** Toute donnée passe la CI. Le dictionnaire
  porte un `mode_demo` qui affiche une bannière « données de test non validées »
  tant que les données n'ont pas été validées cliniquement.

### Comment lancer en local

Il faut servir les fichiers en HTTP (les `fetch` de JSON ne marchent pas en
`file://`). Par exemple :

```bash
cd Atlas-cancer-du-sein-
python3 -m http.server 8000
# puis ouvrir http://localhost:8000/index.html
#            http://localhost:8000/editeur-arbres.html
#            http://localhost:8000/editeur-base.html
```

### Comment déployer

`git push` sur `main` → GitHub Pages redéploie (~1 min). Les éditeurs poussent
sur `main` par eux-mêmes via l'API GitHub. Aucune autre étape.

---

## 4. Les données (formats)

### 4.1 `vocabulaire.json` — le dictionnaire typé ★

Source de vérité **unique** du lien arbre ↔ études. Chaque critère est une
**variable typée**. Extrait :

```jsonc
{
  "version": 2,
  "mode_demo": true,          // true = bannière "données de test" sur l'Atlas
  "roles": { ... },
  "criteres": {
    "T": {
      "label": "Taille tumorale (T)",
      "role": "eligibilite",   // eligibilite = décrit la patiente ; intervention = décrit le traitement étudié
      "type": "categoriel",    // categoriel | numerique | oui_non
      "valeurs": [
        { "id": "T1a", "libelle": "T1a", "alias": ["pT1a", "cT1a"] },
        ...
      ],
      "groupes": { "T1": ["T1a","T1b","T1c"], "T4": ["T4a","T4b","T4c","T4d"] }
    },
    "Age": { "label": "Âge", "role": "eligibilite", "type": "numerique", "unite": "ans" },
    "Hormonotherapie": { "role": "intervention", "type": "oui_non", ... }
  }
}
```

Notions clés :
- **`id` stable** : identifiant technique d'une valeur (ne change jamais).
- **`libelle`** : ce qu'on affiche.
- **`alias`** : orthographes équivalentes de la même valeur (`T1a`, `pT1a`, `cT1a`).
  Permet d'accepter des saisies variées sans casser le matching.
- **`groupes`** : valeurs générales. Une étude peut contraindre au niveau du
  **groupe** (« T1 »), une patiente être décrite au niveau **atomique** (« T1b »).
- **`role`** :
  - `eligibilite` → décrit **qui** est incluse (comparé au profil patiente).
  - `intervention` → décrit **ce que** l'étude a évalué (chirurgie, RT, chimio).
    **N'entre pas** dans le calcul d'éligibilité (voir §6).

### 4.2 `base_etudes.json` — la base d'études

```jsonc
{
  "etudes": [
    {
      "titre": "…",              // affiché en gras dans l'Atlas
      "auteurs": "…",            // affiché en plus petit (repliable)
      "reference": "…",          // citation brute (repli si titre vide)
      "objectif": "…",
      "niveau_preuve": "2",      // "1", "2", "III"… (jeton court)
      "type_etude": "…",
      "lien": "https://…",       // article (PubMed/DOI)
      "criteres": {              // critères en TEXTE (hérité, lisible) — voir contraintes ci-dessous
        "T": "T1, T2, T3", "N": "N0, N1", "M": "M0"
      },
      "contraintes": [           // ★ critères d'inclusion TYPÉS — c'est ce que le moteur utilise
        { "critere": "T", "op": "dans", "valeurs": ["T1a","T1b","T2"] },
        { "critere": "Age", "op": ">=", "valeur": 50 },
        { "critere": "Age", "op": "entre", "min": 40, "max": 70 },
        { "critere": "Hormonotherapie", "op": "est", "valeur": true }
      ],
      "comparaisons": [          // résultats chiffrés affichés
        {
          "mesure": "Survie globale à 10 ans",
          "unite": "",           // "" ou "%" = pourcentage ; sinon échelle relative
          "temps": 10,           // années (pour le graphe d'évolution) ; auto-déduit du libellé si absent
          "famille": "Survie globale", // regroupe les temps d'un même indicateur ; auto-déduit si absent
          "bras": [
            { "label": "avec RT", "valeur": 54 },
            { "label": "sans RT", "valeur": 47 }
          ]
        }
      ],
      "importance": 0,           // classement curateur (tri/mise en avant)
      "date_revue": "", "revu_par": "" // suivi des vérifications médicales
    }
  ]
}
```

**Deux représentations des critères d'inclusion, à ne pas confondre :**
- `criteres` (texte libre) : hérité, **lisible**, encore présent pour référence.
- `contraintes` (typé) : **ce que le moteur d'appariement lit réellement**.
  Généré/édité via l'éditeur de base (constructeur de critères) ou le script
  `migrer-eligibilite.mjs`.

**Différence `famille` vs `mesure` (important, source d'un bug corrigé).**
- `mesure` = libellé complet, avec le temps ET le sous-groupe éventuel
  (« Mortalité par cancer du sein à 20 ans — pN0 »).
- `famille` = nom de base **propre**, sans temps ni sous-groupe
  (« Mortalité par cancer du sein »). Sert aux **puces de filtre** dans l'Atlas.
- Le **graphe d'évolution** regroupe, lui, sur le libellé sans le temps **mais
  avec** le sous-groupe, pour ne pas fusionner des courbes de populations
  différentes (pN0 vs pN1-3). Voir `analyserMesure()` dans `app.js`.

### 4.3 `protocoles/*.json` — les arbres de décision

Format « arbre » imbriqué (le format d'**exécution** lu par l'Atlas) :

```jsonc
{
  "metadata": { "titre": "…", "date_maj": "2026-06-29" },
  "tree": {
    "type": "question",              // question | etape | resultat | numerique
    "titre": "Stade clinique ?",
    "critere": "N",                  // critère renseigné par cette question (facultatif)
    "choix": {                       // une branche par réponse
      "cN0": { "type": "etape", "titre": "…", "suite": { … } },
      "cN1": { "type": "resultat", "titre": "Curage axillaire", "donnees": { … } }
    }
  }
}
```

Types de nœuds :
- **`question`** : plusieurs réponses → plusieurs branches (`choix`).
- **`etape`** : soit une **suite unique** (`suite`, traversée avec un bouton
  « Continuer »), soit une **division** en branches nommées (`choix`, se comporte
  alors comme une question — voir §8).
- **`numerique`** : saisie d'un nombre (ex. l'âge), puis `suite`.
- **`resultat`** : feuille = recommandation finale.

Les **arêtes** peuvent porter des `reponses` (tags de critères) qui alimentent le
profil de la patiente. Le registre `protocoles/index.json` liste les arbres :
`{ "protocoles": [ { "id", "nom", "fichier" }, … ] }`.

### 4.4 `prelude.json` — questions cliniques communes

Séquence de questions (T, N, M, RE, RP, Âge) ajoutée **en tête** des arbres où la
case « Prélude clinique » est cochée. Data-driven : modifiable sans toucher au
code. Chaque réponse pose un **tag canonique** (`critere` + `reponse`) qui
alimente le matching.

---

## 5. Le contrat partagé — `src/js/contrat.js` ★

Module **UMD** : fonctionne dans le navigateur (`window.AtlasContrat`) **et** en
Node (`module.exports`, utilisé par les scripts et la CI). C'est le seul endroit
où vit la logique commune. API publique :

| Fonction | Rôle |
|---|---|
| `indexerDictionnaire(dico)` | Pré-indexe `vocabulaire.json` (alias→id, groupes) pour un matching rapide. À appeler une fois au chargement. |
| `apparier(profil, etude, dico, keyMapping)` | **Le moteur.** Dit si une patiente relève d'une étude (voir §6). |
| `valeurPatient(...)` / `valeurPatientEstNeutre` | Résolution/normalisation d'une valeur de profil. |
| `validerBase(base)` | Valide `base_etudes.json` (structure + cohérence dictionnaire). |
| `validerProtocole(nom, data)` | Valide la structure d'un arbre. |
| `validerContraintesEtude(etude, dico)` | Valide les `contraintes` typées d'une étude. |
| `treeVersGraphe(tree)` | Arbre imbriqué → `{nodes, edges}` (pour l'éditeur). |
| `grapheVersTree(nodes, edges)` | `{nodes, edges}` → arbre imbriqué (pour l'export). |
| `normaliser` / `estNeutre` / `esc` | Utilitaires (texte, neutralité, échappement HTML). |

**Règle d'or : toute évolution du matching ou du format se fait ICI**, jamais
dupliquée dans `app.js` ou les éditeurs. Les scripts de test (`test-*.mjs`)
verrouillent le comportement.

---

## 6. Le moteur d'appariement (`apparier`) — sémantique

Objectif : décider si une patiente **relève des critères d'inclusion** d'une
étude, de façon **déterministe** (pas de comparaison de texte libre).

Pour chaque `contrainte` de l'étude :
- **`categoriel` (`op: "dans"`)** = test d'appartenance à un ensemble. On compare
  l'ensemble des valeurs possibles de la patiente (`P`) à l'ensemble autorisé par
  l'étude (`ens`). **Sémantique de sous-ensemble** :
  - toutes les valeurs de `P` sont autorisées → **satisfaite** ;
  - aucune n'est autorisée → **violée** ;
  - certaines seulement → **indéterminée** (on ne conclut pas à tort).
  Exemple concret corrigé : une patiente « N+ » (= {N1,N2,N3}) **ne satisfait pas**
  une étude limitée à N1 → indéterminée, pas un faux positif.
- **`numerique`** (`>=`, `<=`, `>`, `<`, `=`, `entre`) = test d'intervalle.
- **`oui_non`** (`op: "est"`) = égalité booléenne.

**Les contraintes de rôle `intervention` sont ignorées pour l'éligibilité** :
elles décrivent ce que l'étude a évalué (traitement), pas qui est incluse.

Résultat : `{ satisfaites, violees, indeterminees }`. L'étude est **retenue** si
aucune contrainte déterminée n'est violée. L'Atlas affiche les études retenues,
et liste à part les études écartées avec la raison.

---

## 7. Sérialisation arbre ⇄ graphe

L'Atlas exécute des arbres **imbriqués** (`tree`). L'éditeur manipule un
**graphe** (`nodes` + `edges`) plus pratique à dessiner. `contrat.js` convertit
dans les deux sens :

- `treeVersGraphe` : à l'ouverture d'un protocole dans l'éditeur.
- `grapheVersTree` : à l'export/publication.

Fidélité : les libellés de branche sont stockés dans `valeursListe` (liste
explicite) pour survivre aux virgules (« cT1N0, RH+, Ménopause » = un seul
libellé, pas trois). Garde anti-boucle : un nœud n'est sérialisé qu'une fois.
`test-serialisation.mjs` vérifie le round-trip sur tous les protocoles réels.

---

## 8. Règle « étape » (piège classique)

Une **étape** a deux comportements selon son nombre de branches sortantes :

- **1 branche sans nom** → « suite unique ». Dans l'Atlas, elle s'affiche avec son
  texte + un bouton **« Continuer »** (elle n'est plus traversée en silence :
  tous les textes d'étape sont vus). Dans l'éditeur : flèche **↓**.
- **≥ 2 branches** → elle se comporte **exactement comme une question** : chaque
  branche doit être **nommée** (dans l'éditeur, elles s'affichent « à nommer »,
  pas « ↓ »), et à l'export elles deviennent les clés de `choix`.

Le retour arrière du quiz (`reculer` dans `app.js`) dépile simplement le dernier
écran réellement affiché.

---

## 9. Publication GitHub — `src/js/publier.js`

Les éditeurs écrivent directement sur le dépôt via l'**API GitHub Contents**.

- Constantes en haut du fichier : `OWNER`, `REPO`, `BRANCH` (= `main`),
  `TOKEN_KEY` (`atlas_github_token` dans le `localStorage`).
- `AtlasPublish.publier(cheminFichier, contenu, message)` : `GET` du `sha`
  courant puis `PUT` (crée ou met à jour).
- `AtlasPublish.supprimer(cheminFichier, message)` : `DELETE`.
- `demanderToken()` : invite à coller le jeton (au premier usage).

**Jeton attendu** : PAT *fine-grained* GitHub, permission **`Contents: Read and
write`** sur le dépôt Atlas. Créé dans GitHub → Settings → Developer settings →
Fine-grained tokens. Il reste dans le navigateur (jamais commité, jamais envoyé
ailleurs). Un `HTTP 403` = jeton absent/expiré, mauvaise permission, ou
protection de branche.

---

## 10. Validation & CI

`.github/workflows/valider.yml` se déclenche à chaque push/PR touchant les
données, `contrat.js` ou `scripts/`, et lance :

1. `node scripts/valider.mjs` — validation stricte du contrat (structure +
   cohérence avec le dictionnaire) ;
2. `node scripts/test-serialisation.mjs` — round-trip arbre ⇄ graphe ;
3. `node scripts/test-appariement.mjs` — moteur d'appariement typé ;
4. `node scripts/test-validation.mjs` — validateur strict.

Une donnée invalide **ne passe pas** et n'atteint donc pas l'application clinique.

> Détail de maintenance : le `paths:` du workflow référence encore
> `src/data/schema_criteres.json`, un fichier supprimé lors du passage au
> dictionnaire typé. C'est inoffensif (le filtre ne correspond simplement jamais),
> mais on peut retirer cette ligne au prochain nettoyage.

Pour tout lancer en local avant de pousser :

```bash
node scripts/valider.mjs && \
node scripts/test-serialisation.mjs && \
node scripts/test-appariement.mjs && \
node scripts/test-validation.mjs
```

---

## 11. Scripts

- **`valider.mjs`** — validation du contrat (aussi lancée par la CI).
- **`test-serialisation.mjs` / `test-appariement.mjs` / `test-validation.mjs`** —
  suites de tests (verrouillent le comportement de `contrat.js`).
- **`migrer-eligibilite.mjs`** — dérive les `contraintes` typées à partir des
  `criteres` en texte. `--apply` écrit dans `base_etudes.json`.
- **`etl-these.py`** — importe un **tableau Excel de thèse** (feuille « Données »,
  en-têtes sur 2 lignes) → `base_etudes.json`. Étiquette les bras par
  différentiel d'intervention (chirurgie/RT/chimio…), déduit temps + famille,
  nettoie titres et niveaux de preuve.

  ```bash
  # Pipeline complet d'import d'un nouvel Excel :
  python3 scripts/etl-these.py chemin/vers/these.xlsx src/data/base_etudes.json
  node scripts/migrer-eligibilite.mjs --apply   # dérive les contraintes typées
  node scripts/valider.mjs                       # vérifie avant de pousser
  ```

---

## 12. Recettes (workflows courants)

**Ajouter / modifier une étude** → éditeur de base : charger la version en ligne,
éditer, « ✓ Valider les modifications », puis « Publier sur le site ».

**Ajouter un arbre** → éditeur d'arbres : « + Nouvel arbre », construire, donner
un nom de fichier, « Publier sur le site » (le registre `index.json` est mis à
jour automatiquement).

**Importer un Excel d'études** → voir le pipeline `etl-these.py` (§11), puis
publier `base_etudes.json` (ou le déposer via l'éditeur de base).

**Passer les données en « validé cliniquement »** → mettre `mode_demo` à `false`
dans `vocabulaire.json` (retire la bannière « données de test »).

**Modifier les questions communes du prélude** → `src/data/prelude.json`.

---

## 13. Décisions de conception (le « pourquoi »)

- **Dictionnaire typé plutôt que comparaison de texte.** Le matching arbre↔études
  devait être robuste et extensible, pas une adaptation fragile à une base
  donnée. D'où les `id` stables, alias et groupes.
- **Sémantique de sous-ensemble** dans `apparier` : on préfère « indéterminé » à
  un faux positif clinique.
- **Pas de build.** Réduire la surface de maintenance et faciliter le déploiement
  sur intranet. Le prix : du JS vanilla un peu verbeux, assumé.
- **Édition par les cliniciens.** Les éditeurs publient sur GitHub pour éviter tout
  cycle « exporter → envoyer → un dev commite ».
- **`famille` explicite** pour que le filtre de l'Atlas reste propre tout en
  gardant des graphes d'évolution corrects par sous-groupe.

---

## 14. Points d'attention / dette connue

- Quelques études importées ont des libellés de bras « Bras N » : lignes
  réellement **identiques dans la source** (mêmes interventions), pas un bug.
  Renommables dans l'éditeur de base.
- Ligne `schema_criteres.json` obsolète dans le `paths:` de la CI (§10).
- Le champ `criteres` (texte) coexiste avec `contraintes` (typé) : seul
  `contraintes` compte pour le moteur. À terme, on pourrait retirer `criteres`.
- `base_etudes.json` contient des **données de thèse / de test** tant que
  `mode_demo` est `true`. Ne pas confondre avec des données cliniques validées.

---

## 15. Glossaire

| Terme | Sens |
|---|---|
| **Protocole / arbre** | Un arbre de décision clinique (`protocoles/*.json`). |
| **Prélude** | Questions communes (T, N, M, RE, RP, Âge) ajoutées en tête d'arbre. |
| **Critère d'éligibilité** | Décrit la patiente (stade, biologie). Entre dans le matching. |
| **Intervention** | Décrit le traitement évalué par une étude. Hors matching d'éligibilité. |
| **Contrainte** | Critère d'inclusion **typé** d'une étude (ce que lit le moteur). |
| **Bras** | Un groupe de traitement comparé dans une mesure (ex. « avec RT »). |
| **Mesure / famille / temps** | Résultat chiffré / son indicateur de base / son horizon en années. |
| **Appariement (matching)** | Décider si une patiente relève d'une étude. |
| **RT** = radiothérapie · **CNA** = chimio néoadjuvante · **GS** = ganglion sentinelle · **CA** = curage axillaire | (abréviations cliniques fréquentes) |

---

*Fin du guide. Pour toute logique de matching ou de format : commencer par
`src/js/contrat.js` et les tests `scripts/test-*.mjs`.*
