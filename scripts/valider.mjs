import fs from 'fs';
import path from 'path';

const dirProtocoles = 'src/data/protocoles';
let hasError = false;

console.log("=== Début de la validation des données SENORIF ===");

// 1. Validation de la base des études cliniques
try {
    JSON.parse(fs.readFileSync('src/data/base_etudes.json', 'utf8'));
    console.log("✅ base_etudes.json est un JSON valide.");
} catch (e) {
    console.error("❌ Erreur de syntaxe dans base_etudes.json :", e.message);
    hasError = true;
}

// 2. Validation des 5 fichiers de protocoles
try {
    const files = fs.readdirSync(dirProtocoles).filter(f => f.endsWith('.json'));
    
    if (files.length === 0) {
        console.warn("⚠️ Aucun fichier JSON trouvé dans le dossier protocoles.");
    }

    for (const file of files) {
        try {
            JSON.parse(fs.readFileSync(path.join(dirProtocoles, file), 'utf8'));
            console.log(`✅ Protocole ${file} est un JSON valide.`);
        } catch (e) {
            console.error(`❌ Erreur de syntaxe dans le protocole ${file} :`, e.message);
            hasError = true;
        }
    }
} catch (e) {
    console.error("❌ Impossible d'accéder au dossier des protocoles :", e.message);
    hasError = true;
}

// 3. Résultat pour GitHub Actions
if (hasError) {
    console.error("\nÉchec de la validation. Le déploiement est bloqué. Veuillez corriger les erreurs ci-dessus.");
    process.exit(1);
} else {
    console.log("\n🚀 Tous les fichiers JSON sont valides ! Le déploiement peut continuer.");
}
