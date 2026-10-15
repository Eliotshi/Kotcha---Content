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

- **Score de surperformance** : vues du post ÷ médiane des 30 derniers posts du même compte (interactions pour LinkedIn, qui n'expose pas les vues). Calculé par la vue SQL `post_feed`.
- **Scripts** : à partir de 1 à 5 posts sources + un brief + la voix de marque (réglée dans Admin), Claude génère hooks, découpage plan par plan, interview éventuelle, liste de plans, légende. Les scripts suivent un Kanban Brouillon → Validé → Tourné → Publié.

## Comptes et accès

- Connexion par **code à usage unique envoyé par email** (Supabase Auth). La session est stockée en cookies et se rafraîchit automatiquement : un appareil reste connecté sans re-saisir de code.
- Toute nouvelle personne arrive en **« en attente »** ; un administrateur valide (ou refuse) l'accès dans **Admin**.
- Les emails de la table `admin_bootstrap` sont validés **administrateurs** automatiquement à leur première connexion.
- Les règles d'accès sont appliquées en base (RLS) : un compte non validé ne lit aucune donnée.

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
| `CRON_SECRET` / `JOBS_SECRET` | secrets aléatoires (`openssl rand -hex 32`) |
| `APIFY_TOKEN` | Apify → Settings → Integrations |
| `ANTHROPIC_API_KEY` | analyse et génération (modèle : `ANTHROPIC_MODEL`) |
| `OPENAI_API_KEY` | optionnel : transcription audio Instagram / LinkedIn |

### 3. Développement

```bash
npm install
npm run dev
```

Pour tester le webhook Apify en local, exposer le port avec un tunnel (ngrok, cloudflared) et mettre l'URL du tunnel dans `APP_URL`.

## Points à vérifier au premier run

- **Actors Apify** : `apify/instagram-scraper`, `clockworks/tiktok-scraper`, `harvestapi/linkedin-company-posts` (modifiables via `APIFY_*_ACTOR`). La normalisation (`src/lib/platforms.ts`) accepte plusieurs formats de sortie ; l'actor LinkedIn est le moins standard : vérifier la première collecte dans **Concurrents → Dernières collectes**.
- **Comptes suivis** : Runna (Instagram `runna`, TikTok `runna`, LinkedIn `company/runna`) est pré-rempli ; les comptes Campus Coach sont à ajouter dans **Concurrents**.
