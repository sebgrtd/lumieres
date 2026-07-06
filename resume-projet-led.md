# Resume du projet LED - Ingenierie son et lumiere

Date de synthese : 6 juillet 2026
Perimetre : pages HTML sous https://learn.glassworks.tech/led/ ; les images, fichiers Excel et depots externes sont references mais non recopies.

## 1. Mission du projet

Le projet consiste a developper une ou plusieurs applications logicielles pour creer, configurer, router et jouer un spectacle son et lumiere synchronise avec une musique. Le systeme doit piloter des milliers de LED adressables individuellement et des appareils DMX, tout en restant configurable pour d'autres installations physiques.

Le contexte vient du Groupe LAPS, studio specialise dans les installations artistiques de lumiere et de son. Leur approche separe la creation artistique du routage materiel : l'outil de creation produit un etat logique de l'installation, puis un module de routage traduit cet etat vers les controleurs, univers DMX, canaux et appareils physiques.

Ce qu'il faut retenir : le livrable n'est pas seulement une animation. Il faut construire un outil ou une suite d'outils capable de produire une demonstration spectaculaire, mais aussi de prouver que l'architecture est flexible, performante, configurable et debuggable.

## 2. Architecture generale attendue

Pipeline conceptuel :

1. Outil de creation artistique : cree les animations et determine les couleurs / valeurs d'entites logiques.
2. Etat logique : liste d'entites, chacune avec une couleur ou une valeur RGBW a un instant donne.
3. Module de routage : transforme cet etat en donnees DMX, puis en paquets reseau ArtNet ou en autres protocoles.
4. Controleurs physiques : par exemple BC216, qui recoivent ArtNet en UDP et pilotent les bandes LED ou appareils DMX.
5. Installation reelle : mur LED, projecteurs statiques, lyres et autres appareils.

Dans une installation reelle, au moins un PC sur place execute le simulateur / outil de creation et l'application de routage. Les grosses installations peuvent utiliser plusieurs PC qui communiquent sur le reseau.

Decision d'architecture majeure : l'outil de creation ne doit pas connaitre les adresses IP, les sorties physiques ou les univers DMX. Il ne manipule que des entites. Le routeur, lui, ne doit pas connaitre la maniere dont l'animation a ete creee ; il recoit un state et l'achemine.

## 3. Materiel, DMX et ArtNet

Le controleur BC216 recoit des messages ArtNet via Ethernet/UDP et produit des signaux vers des bandes LED pixel. Chaque BC216 dispose de 16 sorties physiques. Chaque sortie peut adresser jusqu'a 1024 canaux.

Notions cles :

- Un canal DMX contient une valeur entre 0 et 255.
- Une LED RGB consomme 3 canaux : rouge, vert, bleu.
- Une LED RGBW consomme 4 canaux : rouge, vert, bleu, blanc.
- Un univers DMX512 contient 512 canaux, soit 170 LED RGB exploitables par univers (170 x 3 = 510).
- Une sortie BC216 utilisant 1024 canaux correspond donc a 2 univers DMX.
- ArtNet encapsule les donnees DMX512 dans des messages UDP envoyes sur le reseau IP.

Exemple mental important : pour adresser une LED precise, il faut connaitre le controleur cible, sa sortie, l'univers DMX correspondant, puis le canal dans le payload DMX. Ce calcul devient vite complexe, d'ou la necessite d'un module de routage configurable.

## 4. Creation artistique, Unity, Tan et eHub

Le cours presente Tan, une extension Unity employee par le Groupe LAPS. Unity est utile parce qu'il permet d'importer des modeles 3D, de naviguer dans une scene, d'etendre l'editeur, de produire du C#/.NET reseau et de creer des experiences interactives. La version indiquee pour le projet est Unity 6000.4, et le simulateur de test indique Unity 6000.4.8.

Concept d'abstraction : une entite, aussi appelee pixel, represente une source lumineuse RGB unique. Chaque entite possede un identifiant numerique unique et un etat RGB interne, noir par defaut.

Tan peut modifier l'etat des entites via des clips de timeline, des illuminateurs Unity, des projecteurs ou d'autres outils. L'etat global peut se representer comme une liste d'entites et de couleurs, par exemple : entite 5 en rouge, entite 6 en jaune, etc.

Protocole eHub :

- eHub est un protocole UDP personnalise qui transmet l'etat de l'installation.
- Message update : envoye a haute frequence, environ 40 fois par seconde. Il contient les donnees RGBW brutes de toutes les LED, compressees avec GZip. Le payload non compresse contient des sextuors : id d'entite sur 2 octets, puis R, G, B, W sur 1 octet chacun.
- Message config : envoye moins souvent, environ une fois par seconde. Il decrit comment les plages d'entites sont rangees dans les messages update. Cela economise de la bande passante quand les identifiants d'entites ne sont pas strictement contigus.
- Pour les grandes installations, plusieurs messages UDP peuvent etre necessaires a cause de la taille maximale d'un paquet UDP.

L'interoperabilite avec eHub est optionnelle mais valorisee : recevoir des messages eHub et les router correctement rapporte des points bonus.

## 5. Routage attendu

Le routeur doit faire le lien entre l'etat logique issu de l'outil de creation et les controleurs physiques. Sa fonction principale est d'assigner les entites a un controleur, une sortie, un univers et une LED ou un canal DMX.

Le cours presente Emitter Hub comme reference conceptuelle. Son flux type :

1. Unity to Emitters : ecoute les messages UDP eHub config/update et produit un tableau d'entites avec leurs couleurs.
2. Emitter Group : selectionne une plage d'entites a router.
3. Emitter Group to DMX : convertit les couleurs d'entites en canaux DMX, avec offset et selection de composantes RGBW.
4. DMX to ArtNet : encapsule le DMX dans des paquets ArtNet avec IP cible et univers cible.

Le routage doit etre performant : memoire limitee, peu de CPU, nombre minimal de paquets ArtNet, adaptation a de grandes installations, et idealement execution sur un thread separe de l'interface utilisateur.

Les criteres visibles de succes sont la synchronisation parfaite avec la musique, l'absence de latence, de tearing, d'artefacts, de pixels manquants, de couleurs incorrectes et de mauvais mapping.

## 6. Cas de test : mur LED

Le mur fourni par le Groupe LAPS est un cadre de 2 m x 2 m avec 128 x 128 LED visibles, soit 16 384 LED visibles. En realite, il contient davantage de LED car certaines sont cachees et servent a la fixation.

Structure physique :

- 64 bandes LED.
- Chaque bande contient 259 LED.
- Dans chaque colonne : une LED cachee a la base, 128 LED visibles vers le haut, une LED cachee en haut, 128 LED visibles vers le bas, puis une LED cachee a la base.
- Chaque bande depasse 170 LED, donc elle utilise 2 univers DMX.
- L'ensemble du mur utilise 128 univers.
- Attention : dans ArtNet, les univers commencent a 0.

Mapping principal indique :

- Entites 100-4858 : univers 0 a 31, controleur 192.168.1.45.
- Entites 5100-9858 : univers 32 a 63, controleur 192.168.1.46.
- Entites 10100-14858 : univers 64 a 95, controleur 192.168.1.47.
- Entites 15100-19858 : univers 96 a 127, controleur 192.168.1.48.

Reseau de l'installation : SSID GLASS_RESEAUX, mot de passe networks.

Le tableau complet de mapping est fourni dans un fichier Excel externe reference par le cours. Un projet Unity de simulation est aussi reference sur le GitLab Glassworks.

## 7. Autres appareils DMX

Le spectacle comprend aussi des appareils DMX en plus du mur LED.

Projecteur statique :

- Connecte au quatrieme controleur : 192.168.1.48.
- Univers 33.
- Canaux 1 a 4 : rouge, vert, bleu, blanc.

Projecteurs dynamiques / lyres :

- 4 appareils connectes au controleur 192.168.1.48.
- Univers 33.
- Chaque lyre utilise 13 canaux pour couleur, rotation et effets.
- Plages : projecteur 1 canaux 10-22, projecteur 2 canaux 30-42, projecteur 3 canaux 50-62, projecteur 4 canaux 70-82.
- Les appareils DMX peuvent etre branches en serie, ce qui permet de partager le meme univers.

Implication pour notre logiciel : il ne suffit pas de gerer un ecran 2D. Le systeme doit pouvoir piloter aussi des appareils multi-canaux dont les controles ne sont pas seulement RGB.

## 8. Contraintes de projet

Organisation : groupes de 4 personnes maximum.

Langage : libre. Unity peut etre utilise comme outil de demo et comme emetteur eHub, mais il n'est pas obligatoire.

Restrictions : les solutions d'eclairage tierces open source ou professionnelles ne sont pas acceptees. Le logiciel de creation doit etre developpe par l'equipe. L'IA peut aider comme reference, mais le travail doit rester maitrise par l'equipe.

Planning :

- 6 juillet 2026 : kickoff.
- 7 et 9 juillet : cours en debut de seance puis travail.
- 8, 21 et 22 juillet : TP.
- 10 et 20 juillet : points de progres, evaluation continue.
- 13-17 juillet : semaine entreprise, acces libre possible a l'installation.
- 23 juillet : repetition generale et evaluation interne/officielle.
- 24 juillet : spectacle general l'apres-midi.

Livrables :

- Lien vers le depot Git.
- Artefact reproductible : executable et fichiers de configuration permettant de rejouer le spectacle, idealement compile pour Win64 et macOS Apple Silicon.
- Photos et videos de la production.

## 9. Exigences et notation

P1 - Configuration : permettre de configurer l'installation physique. Cela inclut controleurs, adresses IP, univers, bandes LED, nombre de LED, appareils supplementaires, sauvegarde et rechargement de configurations. Evaluation : exhaustivite 7, fonctionnement 7, sauvegarde/chargement 2.

P2 - Routage : router un state vers les controleurs, univers et canaux appropries. Il faut allumer au moins une LED via ArtNet/DMX, couvrir le mapping complet, etre performant et piloter les spots lyre. Evaluation : LED via ArtNet/DMX 5, exhaustivite 25, performance 5, lyres 7.

P3 - Outil de creation de spectacle : fournir un outil permettant de creer un spectacle lumineux synchronise sur musique. Il peut utiliser images, video, keyframes, motion design ou autres techniques, mais doit aussi permettre de piloter les appareils non 2D et de creer/debugger rapidement des animations sans logiciel tiers. Evaluation : facilite d'utilisation et outils 10, UI/ergonomie 6, performance 5, sauvegarde/chargement 4.

P4 - Architecture flexible : separer creation et routage, rendre le code explicable et la solution adaptable a plusieurs configurations. Evaluation : explication de l'architecture 5, demonstration de configurations differentes 2.

P5 - Preuve / demo : presenter un spectacle synchronise, impressionnant et divertissant, montrant les meilleures fonctionnalites. Il doit montrer le controle de plusieurs appareils, un gros volume de donnees, une frequence d'images elevee et l'absence d'artefacts. Evaluation : exhaustivite 6, creativite 6, demo d'au moins 30 secondes 2.

P6 - Interactivite, optionnel : ajouter une interaction en temps reel via clavier, manette, camera ou autre, integree a la demo. Bonus : jusqu'a +10.

P7 - Interoperabilite, optionnel : recevoir eHub depuis le simulateur Unity et router correctement vers l'installation physique avec des performances acceptables. Bonus : jusqu'a +10.

P8 - Debogage : fournir des fakers, generateurs de signaux, moniteurs et visualisations pour trouver les problemes au niveau configuration physique, routage ou creation. Exemple : grille 2D d'un univers DMX en temps reel avant encapsulation ArtNet, ou ecoute/visualisation des paquets ArtNet recus. Bonus : jusqu'a +10, avec demonstration requise.

Les modules optionnels ne rapportent des points que si les modules obligatoires sont reussis.

## 10. Ce qu'il faut construire concretement

Minimum viable mais credible :

1. Un modele de configuration de l'installation : controleurs, IP, univers, sorties, bandes LED, entites, appareils DMX, plages de canaux.
2. Une sauvegarde et un chargement de configuration, dans un format stable et versionnable.
3. Un moteur d'etat : representation des entites LED et des appareils, avec valeurs RGBW ou canaux DMX.
4. Un module de mapping : convertir entite/appareil logique en univers et canaux DMX.
5. Un emetteur ArtNet/DMX UDP performant.
6. Un outil de creation : timeline, keyframes, patterns, import d'images/video ou autre approche, mais avec outils internes simples pour creer et tester rapidement.
7. Un player synchronise sur musique.
8. Un support explicite du mur LED complet et des appareils DMX de l'univers 33.
9. Des outils de debug : simulateur/faker, moniteurs de state, DMX, ArtNet, mapping et performance.
10. Un packaging reproductible avec configuration et demo.

Pour viser haut :

- Support eHub entrant depuis Unity/Tan.
- Mode interactif temps reel.
- Plusieurs configurations pretes a charger pour prouver la flexibilite.
- Monitoring de FPS, debit UDP, nombre de paquets, latence et dropped frames.
- Mode simulation local quand l'installation physique n'est pas accessible.

## 11. Plan d'execution conseille

Phase 1 - Fondations reseau et mapping : construire le modele de configuration, envoyer un paquet ArtNet valide, allumer une LED ou un petit groupe, puis valider le calcul univers/canal.

Phase 2 - Couverture installation : encoder le mapping du mur LED et des appareils DMX, charger le fichier de configuration, envoyer des patterns simples sur toute l'installation.

Phase 3 - Outil de creation : ajouter une timeline ou un systeme de scenes/effects, synchronise avec l'audio. Privilegier des outils rapides a manipuler : couleurs, gradients, balayages, pulses, formes, keyframes, presets.

Phase 4 - Performance : isoler le routage sur un thread ou une boucle temps reel, profiler CPU/memoire/debit, limiter les allocations, grouper les sorties par IP/univers et eviter les paquets inutiles.

Phase 5 - Debug et demo : construire les moniteurs, enregistrer/rejouer une sequence, produire une demo de 30 secondes minimum avec musique, mur LED complet, projecteur statique et lyres.

Phase 6 - Finition : packager, documenter l'architecture, preparer videos/photos et scenario de presentation.

## 12. Risques a surveiller

- Mapping faux : un decalage d'univers ou de canal produit rapidement des couleurs incoherentes.
- Performance reseau : 16k LED a frequence elevee peut saturer CPU, allocations ou UDP si le routage est naif.
- UI trop ambitieuse : mieux vaut un outil de creation simple, fiable et demonstrable qu'un grand editeur incomplet.
- Synchronisation audio : le player doit etre base sur un temps stable, pas sur des timers UI fluctuants.
- Acces concurrent au mur LED : plusieurs groupes peuvent envoyer des messages aux memes controleurs.
- Appareils DMX oublies : la notation exige de ne pas se limiter au mur 2D.
- Configuration non reproductible : sans fichiers de config et packaging clair, la demo sera difficile a rejouer.

## 13. Sources parcourues

- https://learn.glassworks.tech/led/
- https://learn.glassworks.tech/led/category/architecture/
- https://learn.glassworks.tech/led/arch/architecture/
- https://learn.glassworks.tech/led/arch/physical/
- https://learn.glassworks.tech/led/arch/conception/
- https://learn.glassworks.tech/led/arch/routage/
- https://learn.glassworks.tech/led/arch/ecran-led/
- https://learn.glassworks.tech/led/arch/other-devices/
- https://learn.glassworks.tech/led/category/projet/
- https://learn.glassworks.tech/led/project/objectives/
- https://learn.glassworks.tech/led/project/exigeances/

Liens externes references par le cours : fichier Excel de mapping complet, projet Unity de simulation, documentation Unity, pages BC216/DMX512/ArtNet. Ces liens ne sont pas recopies dans cette synthese.
