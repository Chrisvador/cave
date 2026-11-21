// Analyse d'une photo de bouteille : couleur du vin et informations de l'étiquette.
// Utilise Claude si le secret ANTHROPIC_API_KEY est défini ; sinon répond { ia: false }
// et l'app se rabat sur l'analyse des couleurs faite dans le navigateur.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const PROMPT = `Tu regardes la photo d'une bouteille de vin (ou de son étiquette).
Réponds UNIQUEMENT par un objet JSON, sans texte autour, avec ces clés :
{"couleur": "rouge" | "blanc" | "rose" | "effervescent" | "liquoreux",
 "confiance": nombre entre 0 et 1 pour la couleur,
 "domaine": producteur ou château, ou null,
 "nom": nom de la cuvée, ou null,
 "millesime": année (nombre) ou null,
 "appellation": appellation (AOC/AOP/IGP…) ou null,
 "region": région viticole ou null,
 "pays": pays ou null,
 "cepages": cépages s'ils sont indiqués ou évidents (ex. Riesling d'Alsace), ou null}
Pour la couleur, appuie-toi sur l'étiquette (mentions, appellation, cépage) et sur la teinte visible du vin.
Champagne, crémant, mousseux, pét-nat → "effervescent". Sauternes, vendanges tardives, SGN, moelleux → "liquoreux".
N'invente rien qui ne soit pas lisible ou déductible avec certitude : mets null.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ ia: false });
  let body: { image?: string; ping?: boolean; accords?: Accords; facture?: string; plats?: Vin; repas?: Repas } = {};
  try { body = await req.json(); } catch { return json({ error: "Requête invalide" }, 400); }
  if (body.ping) {
    // Vérifie la clé, le crédit et le modèle avec un tout petit appel
    const t = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: Deno.env.get("ANTHROPIC_MODEL") || "claude-haiku-5-5", max_tokens: 5, messages: [{ role: "user", content: "OK" }] }),
    });
    const detail = t.ok ? "" : (await t.text()).slice(0, 300);
    console.log("ping", t.status, detail);
    return json({ ia: true, ok: t.ok, status: t.status, detail });
  }
  if (body.accords) return accords(key, body.accords);
  if (body.facture) return facture(key, body.facture);
  if (body.plats) return plats(key, body.plats);
  if (body.repas) return repas(key, body.repas);
  let image = body.image || "";
  image = image.replace(/^data:image\/\w+;base64,/, "");
  if (!image || image.length > 5_000_000) return json({ error: "Image manquante ou trop lourde" }, 400);
  const str = { type: ["string", "null"] };
  const tool = {
    name: "fiche_vin",
    description: "Enregistre les informations lues sur la bouteille.",
    input_schema: {
      type: "object",
      properties: {
        couleur: { type: "string", enum: ["rouge", "blanc", "rose", "effervescent", "liquoreux"] },
        confiance: { type: "number" },
        domaine: str, nom: str, millesime: { type: ["integer", "null"] }, appellation: str, region: str, pays: str, cepages: str,
        cadre: {
          type: ["object", "null"],
          description: "Rectangle entourant l'étiquette principale (face avant) de la bouteille, en fractions de la largeur et de la hauteur de l'image (0 = bord gauche/haut, 1 = bord droit/bas). Si aucune étiquette n'est visible, la bouteille entière.",
          properties: { x: { type: "number" }, y: { type: "number" }, largeur: { type: "number" }, hauteur: { type: "number" } },
          required: ["x", "y", "largeur", "hauteur"],
        },
      },
      required: ["couleur"],
    },
  };
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("ANTHROPIC_MODEL") || "claude-haiku-5-5",
      max_tokens: 600,
      tools: [tool],
      tool_choice: { type: "tool", name: "fiche_vin" },
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
        { type: "text", text: PROMPT + "\nRemplis l'outil fiche_vin." },
      ] }],
    }),
  });
  if (!r.ok) { const t = (await r.text()).slice(0, 300); console.log("analyse", r.status, t); return json({ ia: true, error: `Analyse indisponible (${r.status})` }, 200); }
  const d = await r.json();
  const use = (d.content || []).find((c: { type: string }) => c.type === "tool_use");
  if (use && use.input) { console.log("analyse ok", JSON.stringify(use.input).slice(0, 300)); return json({ ia: true, ...use.input }); }
  const txt = (d.content || []).map((c: { text?: string }) => c.text || "").join("");
  console.log("analyse sans outil", d.stop_reason, txt.slice(0, 300));
  const m = txt.match(/\{[\s\S]*\}/);
  if (m) { try { return json({ ia: true, ...JSON.parse(m[0]) }); } catch { /* */ } }
  return json({ ia: true, error: "Réponse illisible" });
});

// ---------- Accords mets-vins : propose des bouteilles de la cave pour un plat ----------
type Vin = { id: string; [k: string]: unknown };
type Accords = { plat: string; vins: Vin[]; annee?: number };
async function accords(key: string, a: Accords) {
  const plat = String(a.plat || "").slice(0, 6000).trim();
  const vins = Array.isArray(a.vins) ? a.vins.slice(0, 600) : [];
  if (!plat) return json({ error: "Décrivez le plat" }, 400);
  const tool = {
    name: "accords",
    description: "Propose les meilleurs accords pour le plat.",
    input_schema: {
      type: "object",
      properties: {
        plat: { type: "string", description: "Résumé du plat en quelques mots" },
        suggestions: {
          type: "array", maxItems: 5,
          items: { type: "object", properties: {
            id: { type: "string", description: "id exact d'un vin de la cave" },
            raison: { type: "string", description: "Pourquoi cet accord fonctionne, 1 à 2 phrases" },
            score: { type: "integer", minimum: 1, maximum: 5 },
          }, required: ["id", "raison", "score"] },
        },
        a_acheter: { type: ["string", "null"], description: "Si aucun vin de la cave ne convient très bien : le type de vin idéal à acheter, sinon null" },
        conseil: { type: ["string", "null"], description: "Conseil de service éventuel (température, carafe), court" },
      },
      required: ["plat", "suggestions"],
    },
  };
  const prompt = `Tu es sommelier. Voici un plat ou une recette :
"""${plat}"""

Voici les vins disponibles dans la cave (JSON, une ligne par référence, quantité > 0). Nous sommes en ${a.annee || new Date().getFullYear()} ; garde_debut/garde_fin indiquent la période idéale pour les boire.
${vins.map((v) => JSON.stringify(v)).join("\n") || "(cave vide)"}

Choisis jusqu'à 5 vins de CETTE cave qui s'accordent le mieux, du meilleur au moins bon, avec un score de 1 à 5. N'inclus que des accords réellement pertinents (score ≥ 3), utilise les id exacts.
À accord égal, privilégie les bouteilles à boire en priorité (garde qui se termine).
Si aucun vin de la cave n'atteint 4/5 (ou si la cave n'a rien qui convienne), indique dans a_acheter un ou deux vins précis à acheter : appellation, style, si possible un producteur réputé et une fourchette de prix (ex. « un Riesling sec d'Alsace, par ex. Trimbach, 15-20 € »).
Réponds en français, de façon concise, via l'outil accords.`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("ANTHROPIC_MODEL_ACCORDS") || Deno.env.get("ANTHROPIC_MODEL") || "claude-haiku-5-5",
      max_tokens: 1200,
      tools: [tool],
      tool_choice: { type: "tool", name: "accords" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!r.ok) { const t = (await r.text()).slice(0, 300); console.log("accords", r.status, t); return json({ error: `Service indisponible (${r.status})` }); }
  const d = await r.json();
  const use = (d.content || []).find((c: { type: string }) => c.type === "tool_use");
  if (!use || !use.input) { console.log("accords sans outil", d.stop_reason); return json({ error: "Réponse illisible" }); }
  const ids = new Set(vins.map((v) => v.id));
  const out = use.input as { suggestions?: { id: string }[] };
  out.suggestions = (out.suggestions || []).filter((s) => ids.has(s.id));
  console.log("accords ok", out.suggestions.length);
  return json(out);
}

// ---------- Appel Claude avec un outil imposé ----------
async function claudeOutil(key: string, content: unknown, tool: Record<string, unknown>, maxTokens: number, model?: string) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: model || Deno.env.get("ANTHROPIC_MODEL") || "claude-haiku-5-5",
      max_tokens: maxTokens, tools: [tool], tool_choice: { type: "tool", name: tool.name },
      messages: [{ role: "user", content }],
    }),
  });
  if (!r.ok) { const t = (await r.text()).slice(0, 300); console.log(tool.name, r.status, t); return { error: `Service indisponible (${r.status})` }; }
  const d = await r.json();
  const use = (d.content || []).find((c: { type: string }) => c.type === "tool_use");
  if (!use || !use.input) { console.log(tool.name, "sans outil", d.stop_reason); return { error: "Réponse illisible" }; }
  console.log(tool.name, "ok");
  return use.input;
}

// ---------- Scan de facture ----------
async function facture(key: string, image: string) {
  image = String(image || "").replace(/^data:image\/\w+;base64,/, "");
  if (!image || image.length > 6_000_000) return json({ error: "Image manquante ou trop lourde" }, 400);
  const str = { type: ["string", "null"] };
  const tool = {
    name: "facture",
    description: "Enregistre le contenu d'une facture ou d'un ticket de caviste.",
    input_schema: {
      type: "object",
      properties: {
        caviste: { type: ["string", "null"], description: "Nom du vendeur (caviste, domaine, magasin) en tête de facture" },
        date: { type: ["string", "null"], description: "Date de la facture au format AAAA-MM-JJ" },
        lignes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              domaine: str, nom: { ...str, description: "Cuvée" }, appellation: str, region: str,
              millesime: { type: ["integer", "null"] },
              couleur: { type: "string", enum: ["rouge", "blanc", "rose", "effervescent", "liquoreux"] },
              quantite: { type: "integer", description: "Nombre de bouteilles (convertir les cartons : 1 carton de 6 = 6)" },
              contenance: { type: "string", enum: ["37,5 cl", "50 cl", "75 cl", "150 cl", "300 cl"] },
              prix_unitaire: { type: ["number", "null"], description: "Prix TTC d'une bouteille en euros" },
            },
            required: ["couleur", "quantite"],
          },
        },
      },
      required: ["lignes"],
    },
  };
  const out = await claudeOutil(key, [
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
    { type: "text", text: `Voici la photo d'une facture ou d'un ticket d'achat de vins. Relève chaque ligne de vin (ignore les frais de port, remises, verres, accessoires et autres articles).
Pour chaque vin : domaine, cuvée, appellation, région, millésime, couleur (déduite de l'appellation, du cépage ou des mentions), nombre de bouteilles, contenance et prix TTC à la bouteille.
N'invente rien : mets null si une information n'est pas lisible. Remplis l'outil facture.` },
  ], tool, 3000, Deno.env.get("ANTHROPIC_MODEL_FACTURE"));
  return json(out);
}

// ---------- Accord inversé : plats pour un vin ----------
async function plats(key: string, vin: Vin) {
  const tool = {
    name: "plats",
    description: "Propose des plats qui s'accordent avec le vin.",
    input_schema: {
      type: "object",
      properties: {
        plats: {
          type: "array", minItems: 3, maxItems: 5,
          items: { type: "object", properties: {
            nom: { type: "string", description: "Nom du plat" },
            description: { type: "string", description: "Le plat en une phrase : ingrédients principaux et cuisson" },
            raison: { type: "string", description: "Pourquoi l'accord fonctionne, une phrase" },
            difficulte: { type: "string", enum: ["facile", "moyen", "élaboré"] },
          }, required: ["nom", "description", "raison"] },
        },
        fromage: { type: ["string", "null"], description: "Un ou deux fromages qui iraient bien, ou null" },
        conseil: { type: ["string", "null"], description: "Conseil de service court (température, carafe)" },
      },
      required: ["plats"],
    },
  };
  const out = await claudeOutil(key, `Tu es sommelier et cuisinier. Voici un vin de ma cave :
${JSON.stringify(vin)}
Propose 4 plats variés (du quotidien au plus festif) qui s'accordent vraiment bien avec ce vin, plutôt de saison (nous sommes en ${new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}).
Réponds en français, de façon concise, via l'outil plats.`, tool, 1500, Deno.env.get("ANTHROPIC_MODEL_ACCORDS"));
  return json(out);
}

// ---------- Repas : un vin par moment du repas, choisi dans la cave ----------
type Repas = { nom?: string; plats: Record<string, string>; vins: Vin[]; annee?: number };
async function repas(key: string, r: Repas) {
  const moments = Object.entries(r.plats || {}).filter(([, t]) => String(t || "").trim()).map(([m, t]) => [m, String(t).slice(0, 1500)]);
  if (!moments.length) return json({ error: "Indiquez au moins un plat" }, 400);
  const vins = Array.isArray(r.vins) ? r.vins.slice(0, 600) : [];
  const tool = {
    name: "repas",
    description: "Propose les vins de la cave pour chaque moment du repas.",
    input_schema: {
      type: "object",
      properties: {
        propositions: {
          type: "array",
          items: { type: "object", properties: {
            moment: { type: "string", enum: ["aperitif", "entree", "plat", "fromage", "dessert"] },
            vins: { type: "array", maxItems: 3, items: { type: "object", properties: {
              id: { type: "string", description: "id exact d'un vin de la cave" },
              raison: { type: "string", description: "Pourquoi, en une phrase" },
              score: { type: "integer", minimum: 1, maximum: 5 },
            }, required: ["id", "raison", "score"] } },
            hors_cave: { type: "array", maxItems: 2, description: "Vins à acheter (hors cave), seulement si aucun vin de la cave n'atteint 4/5 pour ce moment ; sinon tableau vide",
              items: { type: "object", properties: {
                vin: { type: "string", description: "Vin précis à acheter : appellation, style, et si possible un producteur réputé et accessible (ex. « Riesling Grand Cru Schoenenbourg, domaine Dopff au Moulin »)" },
                raison: { type: "string", description: "Pourquoi, en une phrase" },
                prix: { type: ["string", "null"], description: "Fourchette de prix indicative en euros (ex. « 15-25 € »)" },
              }, required: ["vin", "raison"] } },
          }, required: ["moment", "vins"] },
        },
        conseil: { type: ["string", "null"], description: "Conseil général court sur l'enchaînement des vins ou le service" },
      },
      required: ["propositions"],
    },
  };
  const prompt = `Tu es sommelier. Je prépare un repas${r.nom ? ` (« ${r.nom} »)` : ""} avec ce menu :
${moments.map(([m, t]) => `- ${m} : ${t}`).join("\n")}

Vins disponibles dans ma cave (JSON ; "dispo" = bouteilles encore libres ; garde_debut/garde_fin = période idéale, nous sommes en ${r.annee || new Date().getFullYear()}) :
${vins.map((v) => JSON.stringify(v)).join("\n") || "(cave vide)"}

Ne propose des vins QUE pour les moments listés ci-dessus (n'en ajoute aucun autre, même si le repas en comporte sans doute). Pour chacun, propose 1 à 3 vins de CETTE cave, le meilleur en premier, avec un score de 1 à 5 (n'inclus que des accords pertinents, score ≥ 3).
Pense à la progression du repas (du plus léger au plus puissant, blancs avant rouges, effervescent bienvenu à l'apéritif) et évite de proposer le même vin à deux moments sauf si c'est vraiment le meilleur choix.
Ne propose pas un vin dont "dispo" vaut 0.
Si, pour un moment, aucun vin de la cave n'atteint 4/5 (ou s'il n'y en a aucun), propose aussi dans hors_cave 1 ou 2 vins précis à acheter, qui s'accorderaient vraiment bien.
Réponds en français, de façon concise, via l'outil repas.`;
  const out = await claudeOutil(key, prompt, tool, 2000, Deno.env.get("ANTHROPIC_MODEL_ACCORDS")) as { error?: string; propositions?: { moment?: string; vins?: { id: string }[] }[] };
  if (out.error) return json(out);
  const ids = new Set(vins.map((v) => v.id));
  const listes = new Set(moments.map(([m]) => m));
  out.propositions = (out.propositions || []).filter((p: { moment?: string }) => listes.has(String(p.moment)));
  out.propositions.forEach((p) => { p.vins = (p.vins || []).filter((v) => ids.has(v.id)); });
  return json(out);
}
