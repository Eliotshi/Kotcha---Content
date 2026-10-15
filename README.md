# Kotcha Content

Dashboard interne Kotcha : veille des concurrents sur Instagram, TikTok et LinkedIn, analyse IA des posts (hook, format, structure, performance) et génération de scripts vidéo prêts à tourner.

## Fonctionnement

```
Vercel Cron (tous les 2 jours)
  └─ /api/cron/collect ─► Apify : 1 run par compte suivi (Instagram, TikTok, LinkedIn)
                              └─ webhook fin de run ─► /api/webhooks/apify
                                   ├─ upsert des posts + relevé des métriques (post_metrics)
                                   └─ file d'analyse ─► /api/jobs/process (se relance tant qu'il reste du travail)
                                        ├─ miniature copiée dans Supabase Storage
                                        ├─ vidéo → 5 images (ffmpeg) + audio
                                        ├─ transcription : sous-titres TikTok, sinon OpenAI (optionnel)
                                        └─ analyse Claude (format, hook, structure, texte à l'écran, script, idées)
Vercel Cron quotidien ─► /api/cron/process (rattrapage des posts en attente / en échec)
```

- **Score à âge égal** : un post est comparé à ce que les autres posts du même compte faisaient **au même âge** (vues, ou interactions pour LinkedIn), d'après l'historique des relevés. Un post de 1 h est donc noté sur son rythme de lancement, avec la mention « provisoire » avant 48 h et un niveau de fiabilité selon le nombre de posts comparables (≥ 3 requis). Méthode détaillée dans `src/lib/scoring.ts`, tests dans `tests/`.
- **Catégories à part** : posts épinglés, partenariats / sponsorisés et collabs sont affichés dans leurs propres onglets et exclus des références (leur portée ne dépend pas que du contenu).
- **Scripts** : à partir de 1 à 5 posts sources + un brief + la voix de marque (réglée dans Admin), Claude génère hooks, découpage plan par plan, interview éventuelle, liste de plans, légende. Les scripts suivent un Kanban Brouillon → Validé → Tourné → Publié.

## Garde-fous

- **Budgets** : plafonds mensuels Apify et IA (Admin). À 80 % une alerte est émise ; à 100 % collectes et analyses sont suspendues. Les coûts IA sont calculés à partir des tokens réellement consommés.
- **Limites d'usage** : collectes manuelles, générations de scripts et ré-analyses sont limitées par 24 h (réglable dans Admin).
- **Collecte TikTok économe** : la vidéo n'est téléchargée que pour les nouveaux posts (collecte « média » ciblée). Un lien vidéo Instagram expiré est rafraîchi une fois automatiquement.
- **Qualité des données** : chaque collecte est contrôlée (volume, champs vides, champs disparus). Problèmes, collectes en échec, comptes non collectés depuis 3 jours et file bloquée génèrent des alertes (bandeau dans la Veille, page Admin, et webhook Slack/Discord/Teams si `ALERT_WEBHOOK_URL` est défini).
- **Fiabilité de l'IA** : l'analyse indique ce qu'elle a réellement reçu (images de la vidéo ou miniature seule, transcription ou non) ; une analyse incomplète est marquée « partielle ». Les explications de performance sont présentées comme des hypothèses. Le format et le type de hook peuvent être corrigés à la main (la correction n'est pas écrasée par une ré-analyse). Les instructions cachées dans les contenus concurrents sont signalées.
- **RGPD** : pas de conservation des réponses brutes (commentaires, comptes tagués), purge automatique après la durée de conservation choisie. Voir `docs/RGPD.md`.

## Comptes et accès

- Connexion par **code à usage unique envoyé par email** (Supabase Auth). La session est stockée en cookies et se rafraîchit automatiquement : un appareil reste connecté sans re-saisir de code, jusqu'à 30 jours d'inactivité (`INACTIVITY_DAYS`).
- **Domaines autorisés** (Admin) : seules les adresses de ces domaines peuvent créer un compte. Le contrôle a lieu dans la base, il ne peut pas être contourné en appelant l'API directement.
- Chacun peut « Déconnecter tous mes appareils » ; un admin peut déconnecter les appareils d'un membre.
- Toute nouvelle personne arrive en **« en attente »** ; un administrateur valide (ou refuse) l'accès dans **Admin**.
- Les emails de la table `admin_bootstrap` sont validés **administrateurs** automatiquement à leur première connexion.
- Les règles d'accès sont appliquées en base (RLS) : un compte non validé ne lit aucune donnée ; les suppressions de concurrents et de comptes sont réservées aux admins ; un script ne peut être supprimé que par son auteur ou un admin ; les posts et analyses sont en lecture seule côté API.

## Stack

Next.js 16 (App Router) · Supabase (Postgres, Auth, Storage) · Apify · Claude (Anthropic) · Vercel (hébergement + crons).

## Mise en route

### 1. Supabase (projet `kotcha-content`, déjà créé et migré)

Schéma : `supabase/migrations/`. Données de départ : `supabase/seed.sql`.

À faire dans le dashboard Supabase :

1. **Authentication → Email Templates → Magic Link** : remplacer le contenu par un email qui affiche le code, par exemple :
   ```html
   <h2>Ton code Kotcha Content</h2>
   <p>Saisis ce code pour te connecter : <strong style="font-size:24px;letter-spacing:4px">{{ .Token }}</strong></p>
   <p>Il expire dans 1 heure.</p>
   ```
   Faire de même pour **Confirm signup** (premier envoi à une nouvelle adresse).
2. **Authentication → SMTP Settings** : brancher un SMTP (Resend, Brevo…). Sans SMTP personnalisé, Supabase n'envoie les emails qu'aux membres de l'organisation Supabase, avec une limite très basse.
3. **Authentication → URL Configuration** : Site URL = l'URL de production Vercel.
4. **Project Settings → API Keys** : copier la clé **secret** dans `SUPABASE_SECRET_KEY`.

### 2. Variables d'environnement

Voir `.env.example`. En local : `cp .env.example .env.local` puis compléter. Sur Vercel : mêmes variables dans Project Settings → Environment Variables.

| Variable | Rôle |
| --- | --- |
| `SUPABASE_SECRET_KEY` | accès serveur (crons, webhooks, analyse) |
| `APP_URL` | URL publique de l'app (pour le webhook Apify) |
| `CRON_SECRET` / `JOBS_SECRET` / `APIFY_WEBHOOK_SECRET` | trois secrets aléatoires distincts (`openssl rand -hex 32`) |
| `ALERT_WEBHOOK_URL` | optionnel : webhook Slack / Discord / Teams pour les alertes |
| `APIFY_TOKEN` | Apify → Settings → Integrations |
| `ANTHROPIC_API_KEY` | analyse et génération (modèle : `ANTHROPIC_MODEL`) |
| `OPENAI_API_KEY` | optionnel : transcription audio Instagram / LinkedIn |

### 3. Développement

```bash
npm install
npm run dev
npm test        # tests du calcul de score
npm run typecheck
```

Pour tester le webhook Apify en local, exposer le port avec un tunnel (ngrok, cloudflared) et mettre l'URL du tunnel dans `APP_URL`.

## Hébergement recommandé pour l'usage en équipe

- **Supabase Pro** : sauvegardes quotidiennes, pas de mise en pause, expiration de session configurable.
- **Vercel Pro** : usage commercial autorisé. Laisser la protection d'accès sur les previews uniquement ; `APP_URL` doit pointer vers le domaine de production (webhooks Apify et enchaînement des analyses).
- Plafonds de dépenses à poser aussi chez les fournisseurs (Apify, Anthropic, OpenAI) en plus de ceux de l'application.

## Points à vérifier au premier run

- **Actors Apify** : `apify/instagram-scraper`, `clockworks/tiktok-scraper`, `harvestapi/linkedin-company-posts` (modifiables via `APIFY_*_ACTOR`). La normalisation (`src/lib/platforms.ts`) accepte plusieurs formats de sortie ; l'actor LinkedIn est le moins standard : vérifier la première collecte dans **Concurrents → Dernières collectes**.
- **Comptes suivis** : Runna (Instagram `runna`, TikTok `runna`, LinkedIn `company/runna`) est pré-rempli ; les comptes Campus Coach sont à ajouter dans **Concurrents**.
