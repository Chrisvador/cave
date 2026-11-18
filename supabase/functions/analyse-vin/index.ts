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
  let body: { image?: string; ping?: boolean } = {};
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
