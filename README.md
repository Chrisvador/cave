# Ma cave

Application web installable (iPhone, iPad, ordinateur) pour la cave à vin du foyer : bouteilles avec photo, couleur reconnue automatiquement à partir de la photo, provenance (« de qui »), commentaires, notes, fenêtre de garde, bouteilles bues et historique.

Données et photos dans Supabase (projet `mes-chats`, tables `cave_vins` et `cave_mouvements`, stockage privé `cave`). Le foyer est le même que celui de l'app Mes chats : mêmes comptes, même partage.

Analyse des photos :
- dans le navigateur, estimation de la couleur d'après les teintes de la bouteille ;
- si le secret `ANTHROPIC_API_KEY` est défini dans Supabase, la fonction `analyse-vin` (dossier `supabase/functions`) lit aussi l'étiquette (domaine, cuvée, appellation, millésime, région, cépages).
