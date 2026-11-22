# Y Social · v0.1.0

Préversion technique pour RL Career Hub 0.2.0-beta.31 sous Windows x64.

## Nouveauté

Quand Y est ouvert, une publication de test épinglée apparaît en tête du fil. Elle est ajoutée à l'affichage uniquement et ne modifie pas la sauvegarde.

## Installation et lancement

1. Ferme le Hub et, pour le test compatible, le lanceur FilstaNet.
2. Place le lanceur choisi dans un dossier dédié.
3. Pour le mode autonome, lance **Y-Autonome.exe**. Il recherche le Hub dans son emplacement d'installation standard. Pour un autre emplacement, crée un fichier Y-config.json à côté du lanceur avec la propriété hubExe contenant le chemin de l'exécutable.
4. Pour le mode compatible, place **Y-FilstaNet.exe** à côté de Y-config.json. Renseigne hubExe et filstaExe. Voir le fichier d'exemple.
5. Ouvre Y et cherche « Publication de test épinglée ». Change d'onglet et reviens dans le fil pour vérifier qu'elle revient sans doublon. En mode compatible, vérifie également le classement Tier B.

Pour garder la console de diagnostic ouverte, lance l'exécutable depuis PowerShell. Il accepte aussi le chemin d'un fichier de configuration comme premier argument.

## Chargement

Le mode autonome lance une instance du Hub avec l'inspecteur Node sur 127.0.0.1. Le mode compatible lance FilstaNet avec un port local transmis via BTIER_PORT. Il prépare le chargement de Y pendant que l'inspecteur est disponible. Le Hub attend ensuite que FilstaNet pose son marqueur window.__btierUI dans le rendu, y compris si FilstaNet a déjà fermé l'inspecteur. Le lanceur contrôle le chemin de l'exécutable et un identifiant de lancement hérité avant de charger le script dans la fenêtre Electron du Hub via BrowserWindow.webContents.executeJavaScript. Aucun fichier du Hub n'est remplacé.

Ferme le Hub pour retirer la publication et mettre fin à sa session d'inspection. Relance ensuite le Hub normalement pour jouer sans Y.

## Limites connues

- Le signal window.__btierUI et la fermeture de l'inspecteur ont été vérifiés dans le code embarqué du Modifier installé. Un lanceur FilstaNet qui ne transmet pas l'environnement au Hub entraîne un refus de chargement.
- Une navigation complète ou un rechargement de la fenêtre retire la publication de test. Les changements d'onglet au sein de la fenêtre sont pris en charge par l'observateur du fil.
- Cette préversion teste le lancement et l'affichage. Elle ne change pas les publications du moteur de simulation.
- La compatibilité est limitée à la version 0.2.0-beta.31 du Hub.

## Compilation et test local

Exécute node build.cjs avec Node.js 26 x64 pour produire les deux exécutables dans bin. Lance ensuite node test.cjs pour tester les exécutables contre un Hub et un lanceur FilstaNet simulés. Le test utilise l'inspecteur Node sur la boucle locale.

## Correctif de cette version

Le mode compatible prépare le chargement avant que FilstaNet ferme l'inspecteur. Le test simulé vérifie que Y attend ensuite la confirmation du rendu FilstaNet.

## Vérifications avant publication

Les deux exécutables ont passé le test simulé. Sur l'installation locale 0.2.0-beta.31, le Hub a confirmé le chargement de Y en mode autonome et après le signal Tier B en mode FilstaNet. La vérification visuelle du fil et du classement en jeu reste à faire.
