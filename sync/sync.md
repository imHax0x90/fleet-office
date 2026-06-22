---
description: Rapatrie dans cette session les échanges faits depuis un autre appareil (tel/iPad/web via Fleet Office)
argument-hint: "[sessionId optionnel]"
allowed-tools: Bash(~/.fleet/bin/fleet-sync.sh:*)
---
Voici les échanges traités sur CETTE session depuis un autre appareil (téléphone, iPad, console web) pendant que ce terminal était en pause :

!`~/.fleet/bin/fleet-sync.sh "$ARGUMENTS"`

Intègre ces échanges à ton contexte de travail courant (comme s'ils faisaient partie de notre conversation), puis résume brièvement où on en est et ce qu'il reste à faire. S'il n'y a rien à synchroniser, dis-le simplement en une ligne.
