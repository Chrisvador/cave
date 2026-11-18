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
  let body: { image?: string; ping?: boolean; accords?: Accords } = {};
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
Si aucun vin ne fait un très bon accord, indique dans a_acheter le style de vin idéal (ex. « un Riesling sec d'Alsace »).
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
