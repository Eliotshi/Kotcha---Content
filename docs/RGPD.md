# Registre de traitement — Kotcha Content

Fiche à intégrer au registre des traitements de Kotcha (article 30 RGPD). À relire et valider par le responsable de traitement.

| Rubrique | Contenu |
| --- | --- |
| **Finalité** | Veille concurrentielle sur les contenus publiés par des entreprises concurrentes (Runna, Campus Coach…) sur Instagram, TikTok et LinkedIn ; aide à la création de contenus Kotcha. |
| **Base légale** | Intérêt légitime (art. 6.1.f) : connaître les pratiques publiques du marché. Mise en balance : contenus publiés publiquement par des entreprises, aucune décision concernant des personnes. |
| **Personnes concernées** | (1) Membres de l'équipe Kotcha utilisant l'outil ; (2) personnes apparaissant ou s'exprimant dans les contenus publics des concurrents (salariés, intervenants, ambassadeurs). |
| **Données — utilisateurs** | Email, statut et rôle, date de dernière connexion, journal d'usage (actions coûteuses : générations, collectes). |
| **Données — contenus collectés** | Lien, légende, hashtags, date, métriques publiques (vues, likes, commentaires, partages), miniature, transcription de l'audio, texte à l'écran, analyse générée. **Non collecté** : commentaires des internautes, comptes tagués, données des abonnés. La réponse brute des scrapers n'est plus conservée (seule la liste de ses champs l'est, pour détecter les changements de format). |
| **Durée de conservation** | Contenus collectés : réglable dans Admin (12 mois par défaut), purge automatique quotidienne (posts, relevés, transcriptions, analyses, miniatures). Vidéos : jamais stockées (téléchargées en mémoire le temps de l'analyse). Comptes utilisateurs : jusqu'à suppression du compte. Alertes résolues : 6 mois. |
| **Destinataires / sous-traitants** | Supabase (hébergement base et fichiers, UE — Paris) ; Vercel (hébergement de l'application) ; Apify (collecte) ; Anthropic (analyse IA : légende, transcription, images extraites) ; OpenAI si activé (transcription audio). |
| **Transferts hors UE** | Vercel, Apify, Anthropic, OpenAI : traitements possibles aux États-Unis. Vérifier pour chacun le DPA signé et le mécanisme de transfert (clauses contractuelles types / Data Privacy Framework). Les API Anthropic et OpenAI n'utilisent pas les données des API pour l'entraînement par défaut : à confirmer dans les conditions en vigueur. |
| **Sécurité** | Accès sur validation par un administrateur, code à usage unique par email, domaine email restreint, expiration après inactivité, règles d'accès en base (RLS), secrets serveur uniquement, journal d'usage, plafonds de dépenses. |
| **Droits des personnes** | Demande d'effacement d'un contenu : supprimer le post (et sa miniature) depuis la base ; le contenu ne sera pas re-collecté s'il est retiré par son auteur. |

## Points d'attention

- **Conditions d'utilisation des plateformes** : Instagram, TikTok et LinkedIn interdisent la collecte automatisée dans leurs CGU. L'usage reste limité à des données publiques, en faible volume, pour une veille interne, sans republication. Risque contractuel à accepter en connaissance de cause.
- **Droit d'auteur** : les miniatures des concurrents sont conservées pour l'affichage interne uniquement. Les scripts générés s'inspirent des mécaniques, sans reprise de formulations : relire avant publication.
