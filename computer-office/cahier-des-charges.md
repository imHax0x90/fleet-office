# Cahier des charges — AgentHub 3D

## Orchestrateur visuel d'agents Claude Code

### Vision

Créer une interface web immersive représentant une entreprise virtuelle où chaque personnage correspond à une instance réelle de Claude Code.

L'utilisateur doit pouvoir :

* Visualiser ses agents sous forme de personnages dans un espace 3D.
* Interagir avec eux via une interface chat.
* Leur attribuer des missions.
* Les faire collaborer.
* Les faire monter en compétences de manière autonome.
* Superviser l'ensemble comme un CTO dirigeant une équipe d'ingénieurs IA.

L'objectif n'est pas un simple dashboard.

L'objectif est un **Operating System visuel pour équipes IA autonomes**.

---

# Principes non négociables

## 1. Chaque personnage = un vrai agent

Interdiction de créer des personnages décoratifs.

Chaque personnage doit correspondre à :

* un processus Claude Code actif
* un workspace dédié
* un historique propre
* un contexte propre
* une mémoire propre

Le personnage est l'avatar d'un agent réel.

---

## 2. Interface temps réel

Tous les échanges doivent être visibles en direct.

Lorsqu'un agent :

* réfléchit
* modifie un fichier
* lance une commande
* fait un git commit
* appelle un MCP

l'interface doit se mettre à jour instantanément.

---

## 3. Contrôle humain permanent

Aucune action critique sans validation.

Exemples :

* merge vers main
* suppression massive
* accès production
* déploiement

=> demande de validation.

---

## 4. Agents persistants

Un agent survit :

* au redémarrage navigateur
* au redémarrage serveur
* aux sessions utilisateur

Le système doit restaurer :

* position
* contexte
* missions
* historique

---

# Architecture globale

```text
Frontend 3D
    ↓
Orchestrateur
    ↓
Agent Manager
    ↓
Claude Code Runtime
    ↓
Workspace Filesystem
```

---

# Zones de l'environnement

## Open Space

Zone de production.

Chaque bureau représente :

* un agent
* une mission
* un repository

Etat visuel :

### Vert

Travaille normalement

### Orange

Attente d'information

### Bleu

Révision / analyse

### Rouge

Erreur

### Violet

Collaboration

---

## Coworking

Zone d'échange.

Quand plusieurs agents doivent collaborer :

```text
Agent Backend
      ↕
Agent DevOps
      ↕
Agent Frontend
```

Les avatars se déplacent vers cette zone.

L'utilisateur visualise :

* qui parle
* qui demande quoi
* qui répond

---

## Salle de sport

Zone d'amélioration continue.

Concept :

Lorsqu'un agent est inactif :

* recherche des Claude Skills
* recherche des patterns
* lit documentation
* améliore son métier

Exemples :

### Agent Frontend

Recherche :

* React patterns
* NextJS optimizations
* UX patterns

### Agent Pentest

Recherche :

* nouvelles techniques
* nouvelles CVE
* nouveaux workflows

### Agent DevOps

Recherche :

* Terraform
* Kubernetes
* GitOps

Le résultat est intégré à sa mémoire métier.

---

# Gestion des agents

## Création

Bouton :

```text
+ Ajouter un agent
```

Formulaire :

```text
Nom
Métier
Workspace
Repo Git
Description
Modèle
```

Exemple :

```text
Nom :
Alex

Métier :
Backend Senior

Workspace :
/projects/api

Repo :
github.com/company/api
```

---

## Profils d'agents

### Backend

Compétences :

* Python
* Go
* Rust
* Node

---

### Frontend

Compétences :

* React
* Vue
* NextJS

---

### DevOps

Compétences :

* Docker
* Kubernetes
* AWS

---

### Pentester

Compétences :

* Web
* Réseau
* Reverse
* Cloud

---

### Architecte

Compétences :

* conception
* audit
* supervision

---

# Interface Agent

Clique sur un personnage.

Ouverture :

```text
┌─────────────────────────┐
│ Alex                    │
├─────────────────────────┤
│ Chat live Claude Code   │
│                         │
│ > analyse repo          │
│ > crée API              │
│ > corrige bug           │
│                         │
└─────────────────────────┘
```

Le comportement doit être identique à Claude Code.

---

# Terminal Live

L'utilisateur doit voir :

```bash
$ npm run build

✓ build success

$ git status

modified: app.ts
```

En streaming.

---

# Collaboration multi-agents

Fonction majeure.

Exemple :

```text
Créer un SaaS complet
```

Le manager découpe automatiquement :

### Agent 1

Architecture

### Agent 2

Backend

### Agent 3

Frontend

### Agent 4

DevOps

### Agent 5

QA

Puis synchronisation.

---

# Système de messages

Les agents peuvent :

## Demander

```text
J'ai besoin d'une API.
```

## Répondre

```text
API prête.
```

## Escalader

```text
Décision architecture requise.
```

---

# Gestion des connaissances

Chaque agent possède :

```text
Mémoire courte
Mémoire projet
Mémoire métier
```

---

## Mémoire métier

Persistante.

Exemple :

```text
Frontend Agent

+ learnt :
Server Components
Tanstack Query
Motion Design
```

---

# Intégration Claude Skills

Module dédié.

Les agents doivent pouvoir :

* découvrir des skills
* installer des skills
* évaluer des skills
* proposer des skills

---

## Workflow

```text
Gym
 ↓
Recherche
 ↓
Validation
 ↓
Installation
 ↓
Test
 ↓
Ajout aux compétences
```

---

# Gestion Git

Chaque agent peut :

* commit
* branch
* rebase
* merge request

Mais :

## Non négociable

Jamais de merge automatique sur main.

---

# Dashboard CTO

Vue globale.

Affiche :

```text
Nombre d'agents

Coût estimé

Temps passé

Etat des missions

Bugs

Blocages

Activité Git

Activité Claude
```

---

# Système économique

Chaque agent expose :

```text
Tokens utilisés
Coût session
Coût journalier
Coût mensuel
ROI
```

---

# Stack technique recommandée

## Frontend

* Next.js
* React
* Three.js
* React Three Fiber
* Zustand
* Tailwind

---

## Temps réel

* WebSockets
* Socket.IO

---

## Backend

* FastAPI

ou

* NestJS

---

## Persistence

* PostgreSQL

---

## Mémoire

* PostgreSQL
* pgvector

---

## Queue

* Redis
* BullMQ

---

## Observabilité

* OpenTelemetry
* Grafana
* Prometheus

---

# Roadmap MVP

## Phase 1

* Monde 3D
* Création agents
* Chat agent
* Connexion Claude Code

## Phase 2

* Collaboration agents
* Workspaces
* Git

## Phase 3

* Mémoire persistante
* Dashboard CTO

## Phase 4

* Gym autonome
* Claude Skills
* Auto-amélioration

## Phase 5

* Organisation hiérarchique
* Managers IA
* Équipes IA complètes

---

# Critères de réussite

À terme, l'utilisateur doit avoir l'impression de superviser une startup entière composée d'agents Claude Code autonomes, visibles physiquement dans un espace 3D, capables de coder, collaborer, apprendre et exécuter des missions réelles sur des repositories distincts, tout en restant pilotables en temps réel depuis une interface unique.
