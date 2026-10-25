PACK PIXEL ART — VILLAGE D'AGENTS
=================================

Contenu généré par le script Python inclus (Pillow).

principaux/
  pierre_rochard/, peter/, gold/, red/, cynthia/
pnj/
  scientifique/, ingenieur/, analyste/, operateur/, securite/, livreur/, etudiant/, medecin/

Chaque personnage possède :
  droite/{statique,marche,course}.png
  gauche/{statique,marche,course}.png
  haut/{statique,marche,course}.png
  bas/{statique,marche,course}.png

Les sprites sont des PNG RGBA transparents 64x64, assemblés à partir de formes pixel-art.
Ils sont des interprétations originales stylisées inspirées par des archétypes/personnages connus,
pas des reproductions officielles. Les animations sont des poses de base générées procéduralement ;
à vérifier/retoucher avant production.

tilesets/ : tuiles 16x16 (herbe, pavés, eau, chemin)
batiments/ : laboratoire, centre d'opérations, atelier, quartier général (PNG transparents)
decor/ : arbre, banc, lampadaire
village_apercu.png : aperçu de scène 512x320
generer_pack.py : script pour régénérer le contenu avec Python + Pillow

Pour régénérer :
  python3 -m pip install pillow
  python3 generer_pack.py

Les éléments sont destinés au prototypage. Vérifier les licences et remplacer les assets inspirés de franchises
par des créations originales/licenciées avant toute distribution commerciale.
