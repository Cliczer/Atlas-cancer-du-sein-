/*
 * publier.js — Publication directe des données du site via l'API GitHub.
 *
 * Permet aux éditeurs (arbres / base d'études) d'écrire un fichier directement
 * dans le dépôt Atlas, sans passer par un téléchargement + commit manuel.
 * Le médecin fournit UNE FOIS un jeton GitHub à portée limitée (fine-grained,
 * "Contents: Read and write" sur ce seul dépôt). Le jeton est stocké uniquement
 * dans le navigateur (localStorage) — jamais envoyé ailleurs qu'à api.github.com.
 *
 * Après publication, la CI valide le JSON et GitHub Pages redéploie (~1 min).
 */
(function () {
  'use strict';

  var OWNER = 'Cliczer';
  var REPO = 'Atlas-cancer-du-sein-';
  var BRANCH = 'main';
  var TOKEN_KEY = 'atlas_github_token';

  function getToken() { return (localStorage.getItem(TOKEN_KEY) || '').trim(); }
  function setToken(t) { localStorage.setItem(TOKEN_KEY, (t || '').trim()); }
  function effacerToken() { localStorage.removeItem(TOKEN_KEY); }

  function demanderToken() {
    var t = prompt(
      'Collez votre jeton GitHub pour publier directement sur le site.\n\n' +
      'Comment l\'obtenir (une seule fois) :\n' +
      'GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token,\n' +
      'dépôt "' + OWNER + '/' + REPO + '", permission "Contents: Read and write".\n\n' +
      'Le jeton est enregistré UNIQUEMENT dans ce navigateur.'
    );
    if (t && t.trim()) { setToken(t.trim()); return getToken(); }
    return '';
  }

  // Base64 compatible UTF-8 (accents, œ, etc.).
  function b64(str) { return btoa(unescape(encodeURIComponent(str))); }

  function api(method, path, body) {
    return fetch('https://api.github.com/repos/' + OWNER + '/' + REPO + '/' + path, {
      method: method,
      headers: {
        'Authorization': 'Bearer ' + getToken(),
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: body ? JSON.stringify(body) : undefined
    });
  }

  // Récupère le SHA du fichier existant (nécessaire pour le mettre à jour), ou null s'il est nouveau.
  function getSha(filePath) {
    return api('GET', 'contents/' + filePath + '?ref=' + BRANCH).then(function (res) {
      if (res.status === 200) return res.json().then(function (j) { return j.sha; });
      if (res.status === 404) return null;
      if (res.status === 401 || res.status === 403) { effacerToken(); throw new Error('Jeton refusé (HTTP ' + res.status + ').'); }
      throw new Error('Lecture de ' + filePath + ' impossible (HTTP ' + res.status + ').');
    });
  }

  // Publie (crée ou met à jour) un fichier. Renvoie une promesse.
  function publier(filePath, contentString, message) {
    if (!getToken() && !demanderToken()) return Promise.reject(new Error('Publication annulée : aucun jeton fourni.'));
    return getSha(filePath).then(function (sha) {
      var body = { message: message || ('Mise à jour de ' + filePath), content: b64(contentString), branch: BRANCH };
      if (sha) body.sha = sha;
      return api('PUT', 'contents/' + filePath, body);
    }).then(function (res) {
      if (res.status === 401 || res.status === 403) {
        effacerToken();
        throw new Error('Jeton refusé (HTTP ' + res.status + '). Vérifiez la permission "Contents: write" sur le dépôt, puis réessayez.');
      }
      if (res.status !== 200 && res.status !== 201) {
        return res.text().then(function (t) { throw new Error('Publication échouée (HTTP ' + res.status + ') ' + t.slice(0, 200)); });
      }
      return true;
    });
  }

  window.AtlasPublish = {
    publier: publier,
    getToken: getToken,
    demanderToken: demanderToken,
    effacerToken: effacerToken,
    infosDepot: { owner: OWNER, repo: REPO, branch: BRANCH }
  };
})();
