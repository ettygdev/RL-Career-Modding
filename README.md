# RL Career Modding

RL Career Modding est un lanceur complémentaire pour **RL Career Hub sur Windows x64**. Sa première version publique sous ce nom enrichit **Y**, le réseau social de la carrière, et relie les échanges privés à la vie de l’équipe.

**Version v0.3.12.** Le Hub pris en charge est **0.2.0-beta.33**. Le démarrage avec le Modifier de FilstaNet a été vérifié avec **FilstaNet 0.7.0**. [Télécharger la version Windows](https://github.com/ettygdev/RL-Career-Modding/releases/tag/v0.3.12)

## Installation rapide

1. Ferme RL Career Hub et le Modifier s’ils sont ouverts.
2. Télécharge et décompresse **RL-Career-Modding-v0.3.12-win-x64.zip**.
3. Copie **RL-Career-Modding.exe** dans le dossier qui contient **RL Career Hub.exe**. Le dossier d’installation par défaut est `%LOCALAPPDATA%\Programs\RL Career Hub`.
4. Ouvre **RL-Career-Modding.exe**. Le badge **RL Career Modding** apparaît en haut à droite du menu principal et se masque lorsqu’une carrière est chargée.

Garde le dossier décompressé si tu veux activer les effets en match ou les retirer plus tard. L’exécutable seul suffit pour les fonctions de Y et le lancement du Hub.

## Avec ou sans le Modifier de FilstaNet

| Installation | Comportement |
| --- | --- |
| Sans le Modifier | Le lanceur ouvre le Hub et charge le module Y. |
| Avec le Modifier à côté du Hub | Le lanceur ouvre le Modifier et attend sa confirmation. Le badge RL Career Modding reste visible au menu. Les fonctions de Y ajoutées par RL Career Modding et leurs effets en match sont désactivés. |

Si FilstaNet met du temps à se lancer, ferme les instances du Hub et du Modifier, puis réessaie avec RL-Career-Modding.exe.

## Fonctionnalités de Y

- **Fil et profils.** Mentions cliquables, republications dans un onglet de profil, commentaires repliables et réponses imbriquées jusqu’à trois niveaux.
- **Messages privés.** Écris librement ou utilise les boutons de ton. Les personnages peuvent répondre selon le contenu, leur relation avec toi et leur profil. Les coéquipiers répondent toujours, avec un ton qui peut varier selon leur moral.
- **Confiance et moral.** Les jauges restent visibles dans la conversation. Les encouragements, excuses et conflits peuvent modifier la confiance et le moral sans attendre le jour suivant. Après plusieurs provocations, le destinataire peut réagir publiquement sans citer tes DM.
- **Récapitulatif de série.** Y résume le résultat et les faits marquants. Avec le module de match installé, il peut citer des buts, des arrêts et des flip resets probables.
- **Effets en match.** Avec ce même module, la confiance basse peut peser sur la coordination du trio. La fatigue augmente au fil des manches et diminue avec le repos. La pression augmente avec les enjeux et peut retomber pendant le jeu.

## Activation des effets en match

Cette étape concerne le **mode autonome**. Elle active les actions détaillées dans les posts et les effets de confiance, de pression et de fatigue pendant les matchs joués.

1. Ferme le Hub et Rocket League.
2. Dans le dossier décompressé, ouvre PowerShell.
3. Exécute ces commandes. Si ton Hub se trouve ailleurs, remplace la valeur de `$hub` par son chemin.

```powershell
$hub = Join-Path $env:LOCALAPPDATA 'Programs\RL Career Hub'
& (Join-Path $hub 'resources\python\python.exe') .\install-coordination.py $hub
```

Le script sauvegarde le fichier d’origine dans `backup`, puis installe le raccord dans le Hub. Garde ce dossier avec le script pour la restauration. Relance ensuite **RL-Career-Modding.exe**.

## Mise à jour et désinstallation

- **Mettre à jour le lanceur.** Ferme le Hub et remplace l’exécutable par celui de cette version. Si tu utilisais `Y-Social.exe` ou les anciens lanceurs Y, utilise désormais `RL-Career-Modding.exe`.
- **Mettre à jour le module de match.** Si tu as installé le raccord d’une version précédente, restaure d’abord le fichier d’origine depuis le dossier de cette version, puis installe le raccord de la nouvelle version.
- **Retirer le module de match.** Ferme le Hub et Rocket League. Dans le dossier qui contient le script et sa sauvegarde `backup`, relance la commande d’installation en ajoutant `--restore`.
- **Jouer sans le mod.** Ouvre directement le Hub ou le Modifier. Pour supprimer le lanceur, retire `RL-Career-Modding.exe` du dossier du Hub. Les éléments déjà inscrits dans une sauvegarde restent dans celle-ci.

## Dépannage

| Symptôme | Vérification |
| --- | --- |
| Le lanceur ne trouve pas le Hub | Place l’exécutable dans le même dossier que `RL Career Hub.exe`. |
| Le badge disparaît après le chargement de la carrière | C’est son comportement normal. Il réapparaît au menu hors carrière. |
| Le badge est visible, mais les fonctions Y du mod sont absentes | Si FilstaNet est chargé, Y est désactivé pour cette session. |
| Le bilan affiche le score, sans action détaillée | Vérifie que le raccord de match est installé. Si aucune donnée exploitable ne remonte, le post utilise le score et les statistiques disponibles. |
| Le script de match signale une version inattendue | Vérifie la version du Hub. Si tu as un ancien raccord, restaure-le avec l’installateur de sa version avant de réessayer. |

Les erreurs de lancement sont consignées dans `%TEMP%\RL-Career-Modding.log`. Pour signaler un problème, indique la version du Hub, la présence ou non du Modifier et les étapes pour reproduire le problème. [Signaler un problème](https://github.com/ettygdev/RL-Career-Modding/issues)

## Crédits

**RL Career Modding** est maintenu par [ettygdev](https://github.com/ettygdev). Le Modifier est un projet distinct de **FilstaNet**. **RL Career Hub** et **Rocket League** appartiennent à leurs équipes et titulaires respectifs.
