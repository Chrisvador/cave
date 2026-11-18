/* Ma cave — bouteilles, photos, provenance, dégustations.
   Données dans Supabase (projet mes-chats, tables cave_*), partagées par foyer comme l'app Mes chats. */
(() => {
'use strict';
const SB_URL = 'https://bqnfsvvaajgrurfozfkv.supabase.co';
const SB_KEY = 'sb_publishable_oepIKCobZddYfW4d2kKMvg_ZFFCX0bo';
const sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cave-auth' } });
const BUCKET = 'cave';

/* ---------- utilitaires ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lsg = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const lss = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
const today = () => new Date().toLocaleDateString('sv-SE');
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MOIS_L = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const fmtDate = d => { if (!d) return '—'; const [y, m, j] = d.split('-').map(Number); return `${j} ${MOIS[m - 1]} ${y}`; };
const plur = (n, s, p) => `${n} ${Math.abs(n) > 1 ? (p || s + 's') : s}`;
const btl = n => plur(n, 'bouteille');
const eur = n => n == null ? '' : Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const val = id => { const v = $(id).value.trim(); return v === '' ? null : v; };
const num = id => { const v = val(id); return v == null ? null : Number(v.replace(',', '.')); };

const COULEURS = { rouge: 'Rouge', blanc: 'Blanc', rose: 'Rosé', effervescent: 'Effervescent', liquoreux: 'Liquoreux' };
const CONTENANCES = ['37,5 cl', '50 cl', '75 cl', '150 cl', '300 cl'];
const ANNEE = new Date().getFullYear();

const I_BOTTLE = '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M10 2h4v5c0 1 2 2 2 5v9a1 1 0 01-1 1H9a1 1 0 01-1-1v-9c0-3 2-4 2-5z"/><path d="M8 14h8"/></svg>';
const I_EDIT = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>';
const I_DEL = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>';
const I_CLOSE = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const I_BACK = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M15 5l-7 7 7 7"/></svg>';
const I_GLASS = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M7 3h10l-1 7a4 4 0 01-8 0z"/><path d="M12 14v6M8 21h8"/></svg>';
const I_PLUS = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>';
const I_CAM = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';

/* ---------- état ---------- */
let me = null, foyer = null, membres = [];
let V = [], M = [], CV = [], AC = [];   // vins, mouvements, cavistes, achats (à racheter)
let view = 'cave', filtre = lsg('cv-filtre', 'tous'), tri = lsg('cv-tri', 'nom'), recherche = '', voirVides = false, openId = null;
const CACHE = 'cv-cache';

let toastT;
function toast(msg, ms = 2800) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms); }
const fail = e => { console.warn(e); toast((e && e.message) || 'Erreur'); };

/* ---------- photos : URLs signées ---------- */
let urls = lsg('cv-urls', {});
const URL_TTL = 7 * 24 * 3600;
async function signAll(paths) {
  const now = Date.now(), need = [...new Set(paths)].filter(p => p && !(urls[p] && urls[p].e > now + 24 * 3600e3));
  for (let i = 0; i < need.length; i += 100) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(need.slice(i, i + 100), URL_TTL);
    if (error) { console.warn(error); continue; }
    data.forEach(d => { if (d.signedUrl) urls[d.path] = { u: d.signedUrl, e: now + (URL_TTL - 3600) * 1e3 }; });
  }
  for (const k in urls) if (urls[k].e < now) delete urls[k];
  lss('cv-urls', urls);
}
const url = p => (p && urls[p] ? urls[p].u : '');
const thumb = p => p ? p.replace(/\.jpg$/, '_t.jpg') : '';

/* ---------- calculs ---------- */
const titre = v => v.nom || v.domaine || v.appellation || 'Vin sans nom';
const sousTitre = v => [v.nom ? v.domaine : null, v.appellation, v.millesime].filter(Boolean).join(' · ');
const membre = uid => (membres.find(m => m.user_id === uid) || {}).prenom || '';
function garde(v) {
  if (!v.garde_debut && !v.garde_fin) return null;
  if (v.garde_fin && ANNEE > v.garde_fin) return { c: 'red', t: 'À boire vite' };
  if (v.garde_debut && ANNEE < v.garde_debut) return { c: 'amber', t: `À attendre (${v.garde_debut})` };
  if (v.garde_fin && ANNEE === v.garde_fin) return { c: 'amber', t: `Dernière année` };
  return { c: 'ok', t: 'Prêt à boire' };
}
const stars = n => n ? `<span class="stars" aria-label="${n} sur 5">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>` : '';

/* ---------- données ---------- */
function saveCache() { lss(CACHE, { uid: me && me.id, foyer, membres, V, M, CV, AC }); }
async function load() {
  const r = await Promise.all([
    sb.from('cave_vins').select('*').order('nom'),
    sb.from('cave_mouvements').select('*').order('date', { ascending: false }).order('created_at', { ascending: false }).limit(1000),
    sb.from('foyer_membres').select('*'),
    sb.from('cave_cavistes').select('*').order('nom'),
    sb.from('cave_achats').select('*').order('created_at', { ascending: false }).limit(500)]);
  const err = r.find(x => x.error);
  if (err) { console.warn(err.error); if (!V.length) toast('Chargement impossible : ' + err.error.message); return; }
  [V, M, membres, CV, AC] = r.map(x => x.data);
  saveCache();
  await signAll(V.map(v => thumb(v.photo)));
  render();
  if (openId && sheetKind === 'vin') renderVin(true);
}

/* ---------- rendu ---------- */
function setView(v) {
  view = v;
  document.querySelectorAll('.nav button').forEach(b => b.setAttribute('aria-current', b.dataset.v === v ? 'page' : 'false'));
  $('vCave').hidden = v !== 'cave'; $('vHist').hidden = v !== 'hist'; $('vAcc').hidden = v !== 'acc'; $('vGest').hidden = v !== 'gest';
  $('title').textContent = { cave: 'Ma cave', hist: 'Dégustations', acc: 'Accords', gest: 'Gestion' }[v];
  $('addBtn').hidden = v === 'acc' || v === 'gest';
  render(); window.scrollTo(0, 0);
}
function render() {
  if (!foyer) return;
  $('sub').textContent = foyer.nom;
  const nr = AC.filter(a => !a.fait).length; $('dotGest').hidden = !nr; $('dotGest').textContent = nr;
  if (view === 'cave') renderCave(); else if (view === 'hist') renderHist(); else if (view === 'acc') renderAcc(); else renderGest();
}

function renderCave() {
  const el = $('vCave');
  const pleins = V.filter(v => v.quantite > 0);
  const total = pleins.reduce((s, v) => s + v.quantite, 0);
  const parC = Object.keys(COULEURS).map(k => [k, pleins.filter(v => v.couleur === k).reduce((s, v) => s + v.quantite, 0)]).filter(x => x[1]);
  const q = norm(recherche);
  let list = V.filter(v => (voirVides ? v.quantite === 0 : v.quantite > 0) && (filtre === 'tous' || v.couleur === filtre));
  if (q) list = list.filter(v => norm([v.nom, v.domaine, v.appellation, v.region, v.pays, v.cepages, v.millesime, v.provenance, v.emplacement, v.commentaire].join(' ')).includes(q));
  const cmp = {
    nom: (a, b) => titre(a).localeCompare(titre(b), 'fr'),
    millesime: (a, b) => (a.millesime || 9999) - (b.millesime || 9999) || titre(a).localeCompare(titre(b), 'fr'),
    recent: (a, b) => (b.date_entree || '').localeCompare(a.date_entree || '') || b.created_at.localeCompare(a.created_at),
    garde: (a, b) => (a.garde_fin || 9999) - (b.garde_fin || 9999),
    region: (a, b) => (a.region || 'zz').localeCompare(b.region || 'zz', 'fr') || titre(a).localeCompare(titre(b), 'fr'),
  }[tri];
  list.sort(cmp);
  const nVides = V.filter(v => v.quantite === 0).length;
  el.innerHTML = `
    <div class="sum" role="group" aria-label="Filtrer par couleur">
      <button class="chip" data-f="tous" aria-pressed="${filtre === 'tous'}"><b>${total}</b> ${total > 1 ? 'bouteilles' : 'bouteille'}</button>
      ${parC.map(([k, n]) => `<button class="chip" data-f="${k}" aria-pressed="${filtre === k}"><i class="pastille p-${k}"></i>${COULEURS[k]} <b>${n}</b></button>`).join('')}
    </div>
    <div class="tools">
      <input class="search" id="q" type="search" placeholder="Rechercher : domaine, appellation, de qui…" value="${esc(recherche)}" aria-label="Rechercher">
      <select id="tri" aria-label="Trier">
        ${[['nom', 'Nom'], ['millesime', 'Millésime'], ['recent', 'Entrées récentes'], ['garde', 'À boire en premier'], ['region', 'Région']].map(([k, l]) => `<option value="${k}"${tri === k ? ' selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    ${list.length ? `<div class="grid">${list.map(card).join('')}</div>`
      : `<div class="empty">${V.length ? 'Aucune bouteille ne correspond.' : 'Votre cave est vide.<br>Touchez « Bouteille » et prenez l\'étiquette en photo : la couleur est reconnue automatiquement.'}</div>`}
    ${nVides || voirVides ? `<p style="text-align:center;margin-top:18px"><button class="linkbtn" id="vides">${voirVides ? '← Retour à la cave' : `Voir les vins terminés (${nVides})`}</button></p>` : ''}`;
  el.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { filtre = b.dataset.f === filtre ? 'tous' : b.dataset.f; lss('cv-filtre', filtre); renderCave(); });
  el.querySelectorAll('[data-id]').forEach(b => b.onclick = () => openVin(b.dataset.id));
  const qi = $('q'); qi.oninput = () => { recherche = qi.value; const pos = qi.selectionStart; renderCave(); const n = $('q'); n.focus(); n.setSelectionRange(pos, pos); };
  $('tri').onchange = () => { tri = $('tri').value; lss('cv-tri', tri); renderCave(); };
  if ($('vides')) $('vides').onclick = () => { voirVides = !voirVides; renderCave(); };
}
function card(v) {
  const u = url(thumb(v.photo)), g = garde(v);
  return `<button class="card${v.quantite ? '' : ' vide'}" data-id="${v.id}" style="--cc:var(--c-${v.couleur})">
    <div class="ph">${u ? `<img src="${esc(u)}" alt="" loading="lazy">` : I_BOTTLE}</div>
    <div class="bd">
      <span class="qte" aria-label="${btl(v.quantite)}">${v.quantite}</span>
      <h3>${esc(titre(v))}</h3>
      <div class="meta">${esc(sousTitre(v)) || '&nbsp;'}</div>
      <div class="tags"><span class="tag"><i class="pastille p-${v.couleur}"></i>${COULEURS[v.couleur]}</span>${g ? `<span class="tag ${g.c}">${g.t}</span>` : ''}${v.note ? `<span class="tag">${stars(v.note)}</span>` : ''}</div>
      ${v.provenance ? `<div class="de"><i>De :</i> ${esc(v.provenance)}</div>` : ''}
    </div></button>`;
}

function renderHist() {
  const el = $('vHist');
  if (!M.length) { el.innerHTML = '<div class="empty">Aucun mouvement pour l\'instant.<br>Les bouteilles bues et ajoutées apparaîtront ici.</div>'; return; }
  const vin = id => V.find(v => v.id === id);
  const sorties = M.filter(m => m.quantite < 0), ans = sorties.filter(m => m.date.startsWith(String(ANNEE))).reduce((s, m) => s - m.quantite, 0);
  const sum = `<div class="sum"><span class="chip" style="cursor:default"><b>${ans}</b> ${ans > 1 ? 'bouteilles bues' : 'bouteille bue'} en ${ANNEE}</span></div>`;
  let html = '', mois = '';
  for (const m of M) {
    const k = m.date.slice(0, 7);
    if (k !== mois) { mois = k; const [y, mm] = k.split('-').map(Number); html += `<h2 class="group">${MOIS_L[mm - 1]} ${y}</h2>`; }
    const v = vin(m.vin_id); if (!v) continue;
    const qui = membre(m.created_by);
    html += `<div class="item" data-id="${v.id}"><span class="n ${m.quantite < 0 ? 'out' : 'in'}">${m.quantite > 0 ? '+' : '−'}${Math.abs(m.quantite)}</span>
      <div><div class="t">${esc(titre(v))}${v.millesime ? ' ' + v.millesime : ''}</div>
      <div class="s">${m.commentaire ? esc(m.commentaire) : (m.quantite < 0 ? 'Bue' : 'Entrée en cave')}${qui ? ' · ' + esc(qui) : ''}</div></div>
      <span class="d">${fmtDate(m.date)}</span></div>`;
  }
  el.innerHTML = sum + `<div class="list">${html}</div>`;
  el.querySelectorAll('[data-id]').forEach(b => b.onclick = () => openVin(b.dataset.id));
}

/* ---------- panneau générique ---------- */
let sheetKind = null;
function openSheet(title, body, { back = null, actions = '', kind = 'form' } = {}) {
  const s = $('sheet'); sheetKind = kind;
  s.innerHTML = `<div class="panel" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="panel-head">
    ${back ? `<button class="iconbtn" id="shBack" aria-label="Retour">${I_BACK}</button>` : ''}<h2>${esc(title)}</h2>${actions}
    <button class="iconbtn" id="shClose" aria-label="Fermer">${I_CLOSE}</button></div><div class="panel-body">${body}</div></div>`;
  s.hidden = false; document.body.style.overflow = 'hidden';
  $('shClose').onclick = closeSheet;
  if (back) $('shBack').onclick = back;
  s.onclick = e => { if (e.target === s) closeSheet(); };
}
function closeSheet() { sheetKind = null; $('sheet').hidden = true; $('sheet').innerHTML = ''; document.body.style.overflow = ''; openId = null; if (/^#vin\//.test(location.hash)) history.replaceState(null, '', location.pathname); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('viewer').hidden) closeViewer(); else if (!$('sheet').hidden) closeSheet(); } });
const backToVin = id => () => openVin(id);

/* ---------- fiche vin ---------- */
function openVin(id) {
  openId = id; history.replaceState(null, '', '#vin/' + id); renderVin();
  const v = V.find(x => x.id === id); if (v && v.photo) signAll([v.photo, thumb(v.photo)]).then(() => { if (openId === id && sheetKind === 'vin') renderVin(true); });
}
function renderVin(keepScroll) {
  const v = V.find(x => x.id === openId); if (!v) return closeSheet();
  const sc = keepScroll && $('sheet').querySelector('.panel') ? $('sheet').querySelector('.panel').scrollTop : 0;
  const u = url(v.photo) || url(thumb(v.photo)), g = garde(v), mv = M.filter(m => m.vin_id === v.id);
  const facts = [
    ['Couleur', `<i class="pastille p-${v.couleur}" style="display:inline-block;vertical-align:-1px"></i> ${COULEURS[v.couleur]}`],
    ['Millésime', v.millesime], ['Appellation', esc(v.appellation)], ['Région', esc([v.region, v.pays].filter(Boolean).join(', '))],
    ['Cépages', esc(v.cepages)], ['Contenance', esc(v.contenance)], ['Emplacement', esc(v.emplacement)],
    ['À boire', v.garde_debut || v.garde_fin ? `${v.garde_debut || '…'} – ${v.garde_fin || '…'}` : null],
    ['Prix', v.prix != null ? eur(v.prix) : null], ['Entrée', v.date_entree ? fmtDate(v.date_entree) : null],
    ['Caviste', esc(cavNom(v.caviste_id))],
  ].filter(f => f[1]);
  openSheet(titre(v), `
    <div class="hero">
      <div class="ph">${u ? `<img src="${esc(u)}" alt="Photo de la bouteille" id="vPh">` : I_BOTTLE}</div>
      <div>
        <h3>${esc(titre(v))}${v.millesime ? ' ' + v.millesime : ''}</h3>
        ${v.nom && v.domaine ? `<div class="dom">${esc(v.domaine)}</div>` : ''}
        <div class="tags" style="margin-top:8px">${g ? `<span class="tag ${g.c}">${g.t}</span>` : ''}${v.note ? `<span class="tag">${stars(v.note)}</span>` : ''}</div>
        <div class="big-q"><b>${v.quantite}</b><span>${v.quantite > 1 ? 'bouteilles<br>en cave' : 'bouteille<br>en cave'}</span></div>
      </div>
    </div>
    <div class="acts">
      <button class="btn pri" id="vBoire"${v.quantite ? '' : ' disabled'}>${I_GLASS}Boire une bouteille</button>
      <button class="btn" id="vAjout">${I_PLUS}Ajouter</button>
      <button class="btn" id="vPlats">Idées de plats</button>
      <button class="btn" id="vRach">${aRacheter(v.id) ? `✓ À racheter (${aRacheter(v.id).quantite})` : 'À racheter'}</button>
    </div>
    ${v.provenance ? `<div class="notes de"><b>De qui</b>${esc(v.provenance)}</div>` : ''}
    <div class="facts">${facts.map(([k, x]) => `<div class="fact"><span>${k}</span><strong>${x}</strong></div>`).join('')}</div>
    ${v.commentaire ? `<div class="notes"><b>Commentaire</b>${esc(v.commentaire)}</div>` : ''}
    <h4>Historique</h4>
    ${mv.length ? `<ul class="hist">${mv.map(m => `<li><span class="d">${fmtDate(m.date)}</span><span class="q">${m.quantite > 0 ? '+' : '−'}${Math.abs(m.quantite)}</span>
      <span class="x">${esc(m.commentaire || (m.quantite < 0 ? 'Bue' : 'Entrée'))}${membre(m.created_by) ? ' · ' + esc(membre(m.created_by)) : ''}</span>
      <button class="iconbtn" data-delm="${m.id}" aria-label="Supprimer ce mouvement">${I_DEL}</button></li>`).join('')}</ul>` : '<p class="status" style="color:var(--muted)">Aucun mouvement.</p>'}
  `, { kind: 'vin', actions: `<button class="iconbtn" id="vEdit" aria-label="Modifier">${I_EDIT}</button>` });
  if (sc) $('sheet').querySelector('.panel').scrollTop = sc;
  $('vEdit').onclick = () => vinForm(v);
  $('vBoire').onclick = () => mouvForm(v, -1);
  $('vAjout').onclick = () => mouvForm(v, 1);
  $('vPlats').onclick = () => { closeSheet(); accMode = 'vin'; accVin = { id: v.id }; setView('acc'); lancerPlats(); };
  $('vRach').onclick = () => rachatForm(v, backToVin(v.id));
  if ($('vPh')) $('vPh').onclick = () => openViewer(v);
  $('sheet').querySelectorAll('[data-delm]').forEach(b => b.onclick = () => delMouv(M.find(m => m.id === b.dataset.delm)));
}

/* ---------- accords mets-vins ---------- */
let acc = null, accBusy = false;
const EXEMPLES = ['Choucroute de poisson', 'Côte de bœuf au barbecue', 'Plateau de fromages', 'Poulet aux morilles', 'Sushis', 'Tarte aux pommes'];
let accMode = 'plat', accVin = null, platsBusy = false;
function renderAcc() {
  const el = $('vAcc'), stock = V.filter(v => v.quantite > 0);
  const seg = `<div class="seg" role="group" aria-label="Sens de l'accord" style="margin-bottom:12px">
    <button type="button" data-am="plat" aria-pressed="${accMode === 'plat'}">Un plat → des vins</button>
    <button type="button" data-am="vin" aria-pressed="${accMode === 'vin'}">Un vin → des plats</button></div>`;
  if (accMode === 'vin') { renderPlats(el, seg, stock); return; }
  const sug = acc && acc.res ? (acc.res.suggestions || []).map(s => ({ ...s, v: V.find(x => x.id === s.id) })).filter(s => s.v && s.v.quantite > 0) : [];
  el.innerHTML = seg + `
    <form class="acc-form" id="accF">
      <label class="field"><span>Le plat ou la recette</span>
        <span class="acc-in"><textarea id="accT" placeholder="Décrivez le plat, ou collez la recette entière : ingrédients, sauce, cuisson…">${esc(acc ? acc.plat : '')}</textarea>
        <button type="button" class="iconbtn acc-x" id="accX" aria-label="Effacer"${acc && acc.plat ? '' : ' hidden'}>${I_CLOSE}</button></span></label>
      <div class="acc-ex">${EXEMPLES.map(x => `<button type="button" data-ex="${esc(x)}">${esc(x)}</button>`).join('')}</div>
      <div class="foot"><span class="status" style="flex:1;color:var(--muted);font-size:14px">${stock.length ? `Choix parmi ${plur(stock.length, 'référence')} de la cave` : 'Votre cave est vide : seuls des conseils d\'achat seront proposés.'}</span>
        <button class="btn pri" type="submit" id="accGo"${accBusy ? ' disabled' : ''}>${I_GLASS}${accBusy ? 'Réflexion…' : 'Proposer des vins'}</button></div>
    </form>
    <div class="acc-res" id="accR">${accBusy ? '<div class="wait">Le sommelier parcourt la cave…</div>' : acc && acc.err ? `<p class="err">${esc(acc.err)}</p>` : acc && acc.res ? `
      ${sug.map(s => sugCard(s)).join('')}
      ${!sug.length ? '<div class="empty">Aucune bouteille de la cave ne s\'accorde vraiment avec ce plat.</div>' : ''}
      ${acc.res.a_acheter ? `<div class="note-acc"><b>Idéal à acheter :</b> ${esc(acc.res.a_acheter)}</div>` : ''}
      ${acc.res.conseil ? `<div class="note-acc"><b>Service :</b> ${esc(acc.res.conseil)}</div>` : ''}` : ''}</div>`;
  el.querySelectorAll('[data-am]').forEach(b => b.onclick = () => { accMode = b.dataset.am; renderAcc(); });
  el.querySelectorAll('[data-ex]').forEach(b => b.onclick = () => { $('accT').value = b.dataset.ex; $('accX').hidden = false; $('accT').focus(); });
  $('accT').oninput = () => { $('accX').hidden = !$('accT').value; };
  $('accX').onclick = () => { if (accBusy) return; acc = null; renderAcc(); $('accT').focus(); };
  el.querySelectorAll('[data-voir]').forEach(b => b.onclick = () => openVin(b.dataset.voir));
  el.querySelectorAll('[data-boire]').forEach(b => b.onclick = () => {
    const v = V.find(x => x.id === b.dataset.boire), plat = (acc.res && acc.res.plat) || acc.plat;
    mouvForm(v, -1, `Avec : ${plat.split('\n')[0].slice(0, 120)}`, closeSheet);
  });
  $('accF').onsubmit = async e => {
    e.preventDefault(); const plat = $('accT').value.trim();
    if (!plat) { $('accT').focus(); return; }
    accBusy = true; acc = { plat }; renderAcc();
    const vins = stock.map(v => {
      const o = { id: v.id, couleur: v.couleur, domaine: v.domaine, cuvee: v.nom, appellation: v.appellation, region: v.region, pays: v.pays,
        millesime: v.millesime, cepages: v.cepages, bouteilles: v.quantite, garde_debut: v.garde_debut, garde_fin: v.garde_fin, note: v.note, commentaire: v.commentaire };
      for (const k in o) if (o[k] == null || o[k] === '') delete o[k];
      return o;
    });
    try {
      const { data, error } = await sb.functions.invoke('analyse-vin', { body: { accords: { plat, vins, annee: ANNEE } } });
      if (error) throw error;
      if (data && data.ia === false) throw new Error('La clé API Claude n\'est pas configurée (voir Réglages).');
      if (!data || data.error) throw new Error((data && data.error) || 'Réponse vide');
      acc = { plat, res: data };
    } catch (e2) { acc = { plat, err: 'Impossible de proposer des vins : ' + (e2.message || e2) }; }
    accBusy = false; if (view === 'acc') renderAcc();
  };
}
function sugCard(s) {
  const v = s.v, u = url(thumb(v.photo)), g = garde(v);
  return `<div class="sug" style="--cc:var(--c-${v.couleur})">
    <div class="ph">${u ? `<img src="${esc(u)}" alt="" loading="lazy">` : I_BOTTLE}</div>
    <div class="bd">
      <h3>${esc(titre(v))}${v.millesime ? ' ' + v.millesime : ''}</h3>
      <div class="meta">${esc([v.nom ? v.domaine : null, v.appellation].filter(Boolean).join(' · ')) || COULEURS[v.couleur]} · ${btl(v.quantite)}</div>
      <div class="tags">${'<span class="tag">' + stars(Math.max(1, Math.min(5, s.score || 3))) + '</span>'}${g ? `<span class="tag ${g.c}">${g.t}</span>` : ''}</div>
      <p>${esc(s.raison)}</p>
      <div class="acts"><button class="btn pri" data-boire="${v.id}">${I_GLASS}Boire celle-ci</button><button class="btn" data-voir="${v.id}">Voir la fiche</button></div>
    </div></div>`;
}

/* ---------- accord inversé : des plats pour un vin ---------- */
function renderPlats(el, seg, stock) {
  const opts = stock.slice().sort((a, b) => titre(a).localeCompare(titre(b), 'fr'));
  const sel = accVin && accVin.id;
  el.innerHTML = seg + `
    <form class="acc-form" id="plF">
      <label class="field"><span>Le vin</span><select id="plV"><option value="">Choisir une bouteille de la cave…</option>
        ${opts.map(v => `<option value="${v.id}"${v.id === sel ? ' selected' : ''}>${esc(titre(v))}${v.millesime ? ' ' + v.millesime : ''}${v.nom && v.domaine ? ' — ' + esc(v.domaine) : ''}</option>`).join('')}</select></label>
      <div class="foot"><span class="status" style="flex:1"></span>
        ${accVin ? `<button class="btn" type="button" id="plX">${I_CLOSE}Effacer</button>` : ''}
        <button class="btn pri" type="submit"${platsBusy ? ' disabled' : ''}>${I_GLASS}${platsBusy ? 'Réflexion…' : 'Proposer des plats'}</button></div>
    </form>
    <div class="acc-res">${platsBusy ? '<div class="wait">Le chef réfléchit…</div>' : accVin && accVin.err ? `<p class="err">${esc(accVin.err)}</p>` : accVin && accVin.res ? `
      ${(accVin.res.plats || []).map(p => `<div class="plat"><h3>${esc(p.nom)}${p.difficulte ? ` <span class="tag">${esc(p.difficulte)}</span>` : ''}</h3>
        <p>${esc(p.description)}</p><p class="why">${esc(p.raison)}</p></div>`).join('')}
      ${accVin.res.fromage ? `<div class="note-acc"><b>Fromage :</b> ${esc(accVin.res.fromage)}</div>` : ''}
      ${accVin.res.conseil ? `<div class="note-acc"><b>Service :</b> ${esc(accVin.res.conseil)}</div>` : ''}` : ''}</div>`;
  el.querySelectorAll('[data-am]').forEach(b => b.onclick = () => { accMode = b.dataset.am; renderAcc(); });
  $('plV').onchange = () => { accVin = $('plV').value ? { id: $('plV').value } : null; renderAcc(); };
  if ($('plX')) $('plX').onclick = () => { if (!platsBusy) { accVin = null; renderAcc(); } };
  $('plF').onsubmit = e => { e.preventDefault(); if (!$('plV').value) { $('plV').focus(); return; } accVin = { id: $('plV').value }; lancerPlats(); };
}
async function lancerPlats() {
  const v = accVin && V.find(x => x.id === accVin.id); if (!v || platsBusy) return;
  platsBusy = true; renderAcc();
  const o = { couleur: COULEURS[v.couleur], domaine: v.domaine, cuvee: v.nom, appellation: v.appellation, region: v.region, pays: v.pays, millesime: v.millesime, cepages: v.cepages, commentaire: v.commentaire };
  for (const k in o) if (o[k] == null || o[k] === '') delete o[k];
  try {
    const { data, error } = await sb.functions.invoke('analyse-vin', { body: { plats: o } });
    if (error) throw error;
    if (data && data.ia === false) throw new Error('La clé API Claude n\'est pas configurée (voir Réglages).');
    if (!data || data.error) throw new Error((data && data.error) || 'Réponse vide');
    accVin = { id: v.id, res: data };
  } catch (e) { accVin = { id: v.id, err: 'Impossible de proposer des plats : ' + (e.message || e) }; }
  platsBusy = false; if (view === 'acc') renderAcc();
}

/* ---------- cavistes ---------- */
const cavNom = id => (CV.find(c => c.id === id) || {}).nom || '';
const aRacheter = vinId => AC.find(a => !a.fait && a.vin_id === vinId);
const cavOptions = sel => `<option value="">— Aucun —</option>${CV.map(c => `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>${esc(c.nom)}</option>`).join('')}<option value="__new">＋ Nouveau caviste…</option>`;
async function creerCaviste(nom) {
  nom = String(nom || '').trim(); if (!nom) return null;
  const ex = CV.find(c => norm(c.nom) === norm(nom)); if (ex) return ex;
  const r = await sb.from('cave_cavistes').insert({ foyer_id: foyer.id, nom }).select().single();
  if (r.error) { fail(r.error); return null; }
  CV.push(r.data); CV.sort((a, b) => a.nom.localeCompare(b.nom, 'fr')); saveCache(); return r.data;
}
function bindCavSelect(sel) {
  let prev = sel.value;
  sel.onchange = async () => {
    if (sel.value !== '__new') { prev = sel.value; return; }
    const c = await creerCaviste(prompt('Nom du caviste'));
    const keep = c ? c.id : prev;
    sel.innerHTML = cavOptions(keep); prev = keep;
    document.querySelectorAll('select[data-cav]').forEach(s => { if (s !== sel) { const v = s.value; s.innerHTML = cavOptions(v); } });
  };
}

/* ---------- à racheter ---------- */
function rachatForm(v, back, finStock) {
  const ex = aRacheter(v.id);
  openSheet(finStock ? 'C\'était la dernière !' : 'À racheter', `
    <form class="f" id="rf">
      <p style="margin:0">${finStock ? 'Voulez-vous racheter ' : ''}<b>${esc(titre(v))}${v.millesime ? ' ' + v.millesime : ''}</b>${finStock ? ' ?' : ''}${v.nom && v.domaine ? `<br><span style="color:var(--muted)">${esc(v.domaine)}</span>` : ''}</p>
      <div class="row2">
        <label class="field"><span>Bouteilles</span><input id="rQ" type="number" inputmode="numeric" min="1" value="${ex ? ex.quantite : 6}"></label>
        <label class="field"><span>Chez</span><select id="rC" data-cav>${cavOptions(ex ? ex.caviste_id : v.caviste_id)}</select></label>
      </div>
      <label class="field"><span>Note</span><input id="rN" value="${esc(ex ? ex.note : '')}" placeholder="Ex. millésime suivant, carton de 6…"></label>
      <p class="err" id="rErr"></p>
      <div class="foot">${ex ? `<button class="btn danger" type="button" id="rDel">${I_DEL}Retirer</button><span class="spacer"></span>` : ''}
        <button class="btn" type="button" id="rNo">${finStock ? 'Non merci' : 'Annuler'}</button>
        <button class="btn pri" type="submit">${ex ? 'Enregistrer' : 'Ajouter à la liste'}</button></div>
    </form>`, { back });
  bindCavSelect($('rC'));
  $('rNo').onclick = () => { if (finStock) toast('Santé ! C\'était la dernière.'); back(); };
  if ($('rDel')) $('rDel').onclick = async () => { const { error } = await sb.from('cave_achats').delete().eq('id', ex.id); if (error) return fail(error); AC = AC.filter(a => a.id !== ex.id); saveCache(); render(); back(); };
  $('rf').onsubmit = async e => {
    e.preventDefault();
    const row = { quantite: Math.max(1, parseInt($('rQ').value, 10) || 1), caviste_id: $('rC').value || null, note: val('rN'),
      libelle: `${titre(v)}${v.millesime ? ' ' + v.millesime : ''}${v.nom && v.domaine ? ' — ' + v.domaine : ''}` };
    const r = ex ? await sb.from('cave_achats').update(row).eq('id', ex.id).select().single()
      : await sb.from('cave_achats').insert({ ...row, foyer_id: foyer.id, vin_id: v.id }).select().single();
    if (r.error) { $('rErr').textContent = r.error.message; return; }
    AC = ex ? AC.map(a => a.id === ex.id ? r.data : a) : [r.data, ...AC];
    if (row.caviste_id && !v.caviste_id) { const u = await sb.from('cave_vins').update({ caviste_id: row.caviste_id }).eq('id', v.id).select().single(); if (!u.error) V = V.map(x => x.id === v.id ? u.data : x); }
    saveCache(); render(); back(); toast(`Ajouté à la liste${row.caviste_id ? ' de ' + cavNom(row.caviste_id) : ''}`);
  };
}
async function recu(a) {
  const v = V.find(x => x.id === a.vin_id);
  const s = prompt(`Bouteilles reçues : ${a.libelle}`, a.quantite); if (s == null) return;
  const n = Math.max(0, parseInt(s, 10) || 0);
  if (v && n) {
    const ins = await sb.from('cave_mouvements').insert({ foyer_id: foyer.id, vin_id: v.id, date: today(), quantite: n, commentaire: a.caviste_id ? `Racheté chez ${cavNom(a.caviste_id)}` : 'Racheté' }).select().single();
    if (ins.error) return fail(ins.error);
    const r = await sb.from('cave_vins').update({ quantite: v.quantite + n, ...(a.caviste_id ? { caviste_id: a.caviste_id } : {}) }).eq('id', v.id).select().single();
    if (r.error) return fail(r.error);
    M.unshift(ins.data); V = V.map(x => x.id === v.id ? r.data : x);
  }
  const r = await sb.from('cave_achats').update({ fait: true, fait_le: today() }).eq('id', a.id).select().single(); if (r.error) return fail(r.error);
  AC = AC.map(x => x.id === a.id ? r.data : x); saveCache(); render();
  toast(v && n ? `${btl(n)} remise${n > 1 ? 's' : ''} en cave` : 'Achat marqué comme reçu');
}
function listeTexte(c, items) {
  return `Bonjour,\n\nJe souhaiterais commander :\n${items.map(a => `- ${a.quantite} × ${a.libelle}${a.note ? ' (' + a.note + ')' : ''}`).join('\n')}\n\nMerci,\n${(membres.find(m => m.user_id === me.id) || {}).prenom || ''}`;
}

/* ---------- onglet Gestion ---------- */
let gestTab = 'racheter';
function renderGest() {
  const el = $('vGest');
  el.innerHTML = `
    <div class="gest-top">
      <div class="seg" role="group" aria-label="Rubrique">
        ${[['racheter', 'À racheter'], ['cavistes', 'Cavistes'], ['stats', 'Statistiques']].map(([k, l]) => `<button type="button" data-gt="${k}" aria-pressed="${gestTab === k}">${l}</button>`).join('')}
      </div>
      <button class="btn pri" id="gScan">${I_CAM}Scanner une facture</button>
    </div>
    <div id="gBody"></div>`;
  el.querySelectorAll('[data-gt]').forEach(b => b.onclick = () => { gestTab = b.dataset.gt; renderGest(); });
  $('gScan').onclick = () => factureForm();
  const body = $('gBody');
  if (gestTab === 'racheter') gestRacheter(body); else if (gestTab === 'cavistes') gestCavistes(body); else gestStats(body);
}
function gestRacheter(body) {
  const items = AC.filter(a => !a.fait);
  if (!items.length) { body.innerHTML = '<div class="empty">Rien à racheter.<br>Quand vous buvez la dernière bouteille d\'un vin, l\'app propose de l\'ajouter ici, sur la liste de son caviste.</div>'; return; }
  const groupes = [...new Set(items.map(a => a.caviste_id || ''))].sort((a, b) => (cavNom(a) || '~').localeCompare(cavNom(b) || '~', 'fr'));
  body.innerHTML = groupes.map(cid => {
    const its = items.filter(a => (a.caviste_id || '') === cid), c = CV.find(x => x.id === cid), tot = its.reduce((s, a) => s + a.quantite, 0);
    return `<section class="grp"><div class="grp-h"><h3>${esc(c ? c.nom : 'Sans caviste')}</h3><span class="meta">${btl(tot)}</span>
        ${c ? `<button class="btn" data-share="${cid}">${c.email ? 'Envoyer la liste' : 'Partager la liste'}</button>` : ''}</div>
      <div class="list">${its.map(a => { const v = V.find(x => x.id === a.vin_id);
        return `<div class="item ach"><span class="n in">${a.quantite}×</span>
          <div${v ? ` data-vin="${v.id}" style="cursor:pointer"` : ''}><div class="t">${esc(a.libelle)}</div>${a.note ? `<div class="s">${esc(a.note)}</div>` : ''}</div>
          <div class="ach-b"><button class="btn" data-recu="${a.id}">Reçu</button><button class="iconbtn" data-edit-a="${a.id}" aria-label="Modifier">${I_EDIT}</button></div></div>`; }).join('')}</div></section>`;
  }).join('');
  body.querySelectorAll('[data-vin]').forEach(b => b.onclick = () => openVin(b.dataset.vin));
  body.querySelectorAll('[data-recu]').forEach(b => b.onclick = () => recu(AC.find(a => a.id === b.dataset.recu)));
  body.querySelectorAll('[data-edit-a]').forEach(b => b.onclick = () => {
    const a = AC.find(x => x.id === b.dataset.editA), v = V.find(x => x.id === a.vin_id);
    if (v) rachatForm(v, closeSheet); else if (confirm(`Le vin n'existe plus dans la cave. Retirer « ${a.libelle} » de la liste ?`)) sb.from('cave_achats').delete().eq('id', a.id).then(({ error }) => { if (error) return fail(error); AC = AC.filter(x => x.id !== a.id); saveCache(); render(); });
  });
  body.querySelectorAll('[data-share]').forEach(b => b.onclick = async () => {
    const c = CV.find(x => x.id === b.dataset.share), its = items.filter(a => a.caviste_id === c.id), txt = listeTexte(c, its), sujet = 'Commande de vins';
    if (c.email) { location.href = `mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(txt)}`; return; }
    try { if (navigator.share) await navigator.share({ title: sujet, text: txt }); else { await navigator.clipboard.writeText(txt); toast('Liste copiée'); } } catch {}
  });
}
function gestCavistes(body) {
  body.innerHTML = `<div class="foot" style="justify-content:flex-start;margin:0 0 12px"><button class="btn" id="cAdd">${I_PLUS}Nouveau caviste</button></div>
    ${CV.length ? `<div class="list">${CV.map(c => { const nv = V.filter(v => v.caviste_id === c.id), nb = nv.reduce((s, v) => s + v.quantite, 0), na = AC.filter(a => !a.fait && a.caviste_id === c.id).length;
      return `<div class="item" data-cav-id="${c.id}"><span class="n in" style="font-size:22px">🍷</span>
        <div><div class="t">${esc(c.nom)}</div><div class="s">${plur(nv.length, 'référence')} · ${btl(nb)} en cave${na ? ` · ${na} à racheter` : ''}${c.telephone ? ' · ' + esc(c.telephone) : ''}</div></div>
        <span class="iconbtn">${I_EDIT}</span></div>`; }).join('')}</div>` : '<div class="empty">Aucun caviste pour l\'instant.</div>'}`;
  $('cAdd').onclick = () => cavisteForm(null);
  body.querySelectorAll('[data-cav-id]').forEach(b => b.onclick = () => cavisteForm(CV.find(c => c.id === b.dataset.cavId)));
}
function cavisteForm(c) {
  const neuf = !c; c = c || {};
  openSheet(neuf ? 'Nouveau caviste' : c.nom, `
    <form class="f" id="cf">
      <label class="field"><span>Nom</span><input id="cNom" value="${esc(c.nom)}" required placeholder="Ex. Les Domaines qui Montent"></label>
      <div class="row2"><label class="field"><span>E-mail</span><input id="cMail" type="email" value="${esc(c.email)}" placeholder="Pour envoyer la liste"></label>
        <label class="field"><span>Téléphone</span><input id="cTel" type="tel" value="${esc(c.telephone)}"></label></div>
      <label class="field"><span>Notes</span><textarea id="cNotes" placeholder="Adresse, horaires, contact…">${esc(c.notes)}</textarea></label>
      <p class="err" id="cErr"></p>
      <div class="foot">${neuf ? '' : `<button class="btn danger" type="button" id="cDel">${I_DEL}Supprimer</button><span class="spacer"></span>`}
        <button class="btn" type="button" id="cNo">Annuler</button><button class="btn pri" type="submit">Enregistrer</button></div>
    </form>`);
  $('cNo').onclick = closeSheet;
  if ($('cDel')) $('cDel').onclick = async () => {
    if (!confirm(`Supprimer le caviste « ${c.nom} » ? Les vins et la liste d'achats sont conservés, sans caviste.`)) return;
    const { error } = await sb.from('cave_cavistes').delete().eq('id', c.id); if (error) return fail(error);
    CV = CV.filter(x => x.id !== c.id); V = V.map(v => v.caviste_id === c.id ? { ...v, caviste_id: null } : v); AC = AC.map(a => a.caviste_id === c.id ? { ...a, caviste_id: null } : a);
    saveCache(); closeSheet(); render();
  };
  $('cf').onsubmit = async e => {
    e.preventDefault(); const row = { nom: val('cNom'), email: val('cMail'), telephone: val('cTel'), notes: val('cNotes') };
    if (!row.nom) return;
    const r = neuf ? await sb.from('cave_cavistes').insert({ ...row, foyer_id: foyer.id }).select().single() : await sb.from('cave_cavistes').update(row).eq('id', c.id).select().single();
    if (r.error) { $('cErr').textContent = r.error.message; return; }
    CV = neuf ? [...CV, r.data] : CV.map(x => x.id === c.id ? r.data : x); CV.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    saveCache(); closeSheet(); render();
  };
}
function barres(rows, fmt = n => n) {
  const max = Math.max(1, ...rows.map(r => r[1]));
  return `<div class="bars">${rows.map(([l, n, cls]) => `<div class="bar"><span class="bl">${l}</span><span class="bt"><i class="${cls || ''}" style="width:${Math.max(2, n / max * 100)}%"></i></span><b>${fmt(n)}</b></div>`).join('')}</div>`;
}
function gestStats(body) {
  const pleins = V.filter(v => v.quantite > 0), tot = pleins.reduce((s, v) => s + v.quantite, 0);
  const avecPrix = pleins.filter(v => v.prix != null), valeur = avecPrix.reduce((s, v) => s + v.prix * v.quantite, 0), nbPrix = avecPrix.reduce((s, v) => s + v.quantite, 0);
  const somme = (list, key) => { const m = new Map(); list.forEach(v => { const k = key(v) || 'Non renseigné'; m.set(k, (m.get(k) || 0) + v.quantite); }); return [...m].sort((a, b) => b[1] - a[1]); };
  const g = { vite: 0, pret: 0, attendre: 0 }; pleins.forEach(v => { const x = garde(v); if (!x) return; g[x.c === 'red' ? 'vite' : x.c === 'ok' ? 'pret' : 'attendre'] += v.quantite; });
  const now = new Date(), mois = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); mois.push([`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, MOIS[d.getMonth()]]); }
  const bues = mois.map(([k, l]) => [l, M.filter(m => m.quantite < 0 && m.date.startsWith(k)).reduce((s, m) => s - m.quantite, 0)]);
  const maxB = Math.max(1, ...bues.map(b => b[1])), totBues = bues.reduce((s, b) => s + b[1], 0);
  body.innerHTML = `
    <div class="kpis">
      <div class="fact"><span>Bouteilles</span><strong>${tot}</strong></div>
      <div class="fact"><span>Références</span><strong>${pleins.length}</strong></div>
      <div class="fact"><span>Valeur d'achat</span><strong>${valeur ? eur(valeur) : '—'}</strong>${nbPrix < tot && valeur ? `<small>pour ${nbPrix} bouteilles avec prix</small>` : ''}</div>
      <div class="fact"><span>Bues sur 12 mois</span><strong>${totBues}</strong></div>
    </div>
    <div class="box"><h3>Par couleur</h3>${barres(somme(pleins, v => v.couleur).map(([k, n]) => [COULEURS[k] || k, n, 'p-' + k]))}</div>
    <div class="box"><h3>Bouteilles bues par mois</h3><div class="cols">${bues.map(([l, n]) => `<div class="col"><b>${n || ''}</b><i style="height:${n / maxB * 100}%"></i><span>${l}</span></div>`).join('')}</div></div>
    ${g.vite + g.pret + g.attendre ? `<div class="box"><h3>Garde</h3>${barres([['À boire vite', g.vite, 'p-rouge'], ['Prêt à boire', g.pret, 'ok'], ['À attendre', g.attendre, 'amber']].filter(r => r[1]))}</div>` : ''}
    <div class="box"><h3>Par région</h3>${barres(somme(pleins, v => v.region).slice(0, 10).map(([k, n]) => [esc(k), n]))}</div>
    ${CV.length ? `<div class="box"><h3>Par caviste</h3>${barres(somme(pleins, v => cavNom(v.caviste_id)).slice(0, 10).map(([k, n]) => [esc(k), n]))}</div>` : ''}
    <div class="box"><h3>Par millésime</h3>${barres(somme(pleins, v => v.millesime && String(v.millesime)).sort((a, b) => String(b[0]).localeCompare(String(a[0]))).slice(0, 12).map(([k, n]) => [esc(k), n]))}</div>`;
}

/* ---------- scan de facture ---------- */
const cleVin = (d, n, m) => [norm(d).replace(/^(domaine|chateau|maison)\s+/, ''), norm(n), m || ''].join('|');
function factureForm() {
  openSheet('Scanner une facture', `
    <div class="f">
      <p style="margin:0;color:var(--muted)">Prenez la facture ou le ticket en photo, bien à plat et lisible. Les vins seront relevés et vous pourrez vérifier avant de les ajouter à la cave.</p>
      <div class="foot" style="justify-content:flex-start">
        <label class="btn pri">${I_CAM}<span>Photographier</span><input id="fxFile" type="file" accept="image/*" capture="environment" hidden></label>
        <label class="btn"><span>Choisir une image</span><input id="fxFile2" type="file" accept="image/*" hidden></label>
      </div>
      <div class="ana" id="fxSt" aria-live="polite"></div>
      <div id="fxRes"></div>
    </div>`, { kind: 'facture' });
  const go = async f => {
    if (!f) return; const st = $('fxSt'); st.className = 'ana'; st.textContent = 'Lecture de la facture… (10 à 30 secondes)'; $('fxRes').innerHTML = '';
    try {
      const b64 = await new Promise(async (res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(await toJpeg(f, 2000, .85)); });
      const { data, error } = await sb.functions.invoke('analyse-vin', { body: { facture: b64 } });
      if (error) throw error;
      if (data && data.ia === false) throw new Error('La clé API Claude n\'est pas configurée (voir Réglages).');
      if (!data || data.error) throw new Error((data && data.error) || 'Réponse vide');
      if (sheetKind !== 'facture') return;
      if (!(data.lignes || []).length) { st.textContent = 'Aucun vin trouvé sur cette facture. Essayez une photo plus nette.'; return; }
      st.className = 'ana ok'; st.textContent = `${plur(data.lignes.length, 'ligne')} de vin trouvée${data.lignes.length > 1 ? 's' : ''}. Vérifiez puis ajoutez.`;
      factureRevue(data);
    } catch (e) { st.className = 'ana'; st.textContent = 'Lecture impossible : ' + (e.message || e); }
  };
  $('fxFile').onchange = e => go(e.target.files[0]);
  $('fxFile2').onchange = e => go(e.target.files[0]);
}
function factureRevue(data) {
  const cavEx = data.caviste ? CV.find(c => norm(c.nom) === norm(data.caviste) || norm(c.nom).includes(norm(data.caviste)) || norm(data.caviste).includes(norm(c.nom))) : null;
  const L = data.lignes.map(l => {
    const ex = V.find(v => cleVin(v.domaine, v.nom, v.millesime) === cleVin(l.domaine, l.nom, l.millesime));
    return { ...l, ok: true, ex };
  });
  const titreL = l => [l.domaine, l.nom, l.appellation].filter(Boolean).join(' · ') || 'Vin';
  $('fxRes').innerHTML = `
    <div class="row2">
      <label class="field"><span>Caviste</span><select id="fxCav" data-cav>${cavEx ? cavOptions(cavEx.id) : `${data.caviste ? `<option value="__nouveau" selected>＋ ${esc(data.caviste)} (nouveau)</option>` : ''}${cavOptions('')}`}</select></label>
      <label class="field"><span>Date d'achat</span><input id="fxDate" type="date" value="${esc(/^\d{4}-\d{2}-\d{2}$/.test(data.date || '') ? data.date : today())}"></label>
    </div>
    <div class="fx-l">${L.map((l, i) => `<div class="fx-row" data-i="${i}">
      <label class="fx-ck"><input type="checkbox" data-ok checked></label>
      <div class="fx-main">
        <div class="t"><i class="pastille p-${l.couleur}" style="display:inline-block;vertical-align:-1px"></i> ${esc(titreL(l))}${l.millesime ? ' ' + l.millesime : ''}</div>
        <div class="s">${l.ex ? `Ajoute au vin existant « ${esc(titre(l.ex))} »` : 'Nouveau vin'}${l.contenance && l.contenance !== '75 cl' ? ' · ' + esc(l.contenance) : ''}</div>
        <div class="fx-in"><label>Bt <input type="number" inputmode="numeric" min="1" data-q value="${Math.max(1, l.quantite || 1)}"></label>
          <label>€/bt <input inputmode="decimal" data-p value="${l.prix_unitaire != null ? String(l.prix_unitaire).replace('.', ',') : ''}"></label>
          <select data-c>${Object.entries(COULEURS).map(([k, n]) => `<option value="${k}"${k === l.couleur ? ' selected' : ''}>${n}</option>`).join('')}</select></div>
      </div></div>`).join('')}</div>
    <p class="err" id="fxErr"></p>
    <div class="foot"><button class="btn" type="button" id="fxNo">Annuler</button><button class="btn pri" type="button" id="fxGo">Ajouter à la cave</button></div>`;
  const sel = $('fxCav'); bindCavSelect(sel);
  $('fxNo').onclick = closeSheet;
  $('fxGo').onclick = async () => {
    const goBtn = $('fxGo'); goBtn.disabled = true; goBtn.textContent = 'Ajout…';
    try {
      let cid = sel.value || null;
      if (cid === '__nouveau') { const c = await creerCaviste(data.caviste); cid = c ? c.id : null; }
      const cnom = cavNom(cid), date = $('fxDate').value || today(); let nb = 0;
      for (const row of $('fxRes').querySelectorAll('.fx-row')) {
        if (!row.querySelector('[data-ok]').checked) continue;
        const l = L[+row.dataset.i], q = Math.max(1, parseInt(row.querySelector('[data-q]').value, 10) || 1);
        const pv = row.querySelector('[data-p]').value.trim().replace(',', '.'), prix = pv === '' || isNaN(+pv) ? null : +pv, couleur = row.querySelector('[data-c]').value;
        let vin;
        if (l.ex) {
          const cur = V.find(v => v.id === l.ex.id);
          const r = await sb.from('cave_vins').update({ quantite: cur.quantite + q, ...(cid ? { caviste_id: cid } : {}), ...(prix != null ? { prix } : {}) }).eq('id', cur.id).select().single(); if (r.error) throw r.error;
          vin = r.data; V = V.map(v => v.id === vin.id ? vin : v);
        } else {
          const r = await sb.from('cave_vins').insert({ foyer_id: foyer.id, couleur, domaine: l.domaine || null, nom: l.nom || null, appellation: l.appellation || null, region: l.region || null,
            millesime: l.millesime || null, contenance: l.contenance || '75 cl', quantite: q, prix, caviste_id: cid, provenance: cnom ? `Acheté chez ${cnom}` : null, date_entree: date }).select().single();
          if (r.error) throw r.error; vin = r.data; V.push(vin);
        }
        const m = await sb.from('cave_mouvements').insert({ foyer_id: foyer.id, vin_id: vin.id, date, quantite: q, commentaire: cnom ? `Acheté chez ${cnom}` : 'Achat (facture)' }).select().single();
        if (!m.error) M.unshift(m.data);
        const a = aRacheter(vin.id); if (a) { const u = await sb.from('cave_achats').update({ fait: true, fait_le: date }).eq('id', a.id).select().single(); if (!u.error) AC = AC.map(x => x.id === a.id ? u.data : x); }
        nb += q;
      }
      M.sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
      saveCache(); closeSheet(); render(); toast(`${btl(nb)} ajoutée${nb > 1 ? 's' : ''} à la cave`);
    } catch (e) { $('fxErr').textContent = e.message || String(e); goBtn.disabled = false; goBtn.textContent = 'Ajouter à la cave'; }
  };
}

/* ---------- boire / ajouter ---------- */
function mouvForm(v, sens, prefill = '', back = null) {
  const sortie = sens < 0;
  openSheet(sortie ? 'Boire une bouteille' : 'Ajouter des bouteilles', `
    <form class="f" id="mf">
      <p style="margin:0;font-weight:700">${esc(titre(v))}${v.millesime ? ' ' + v.millesime : ''} <span style="color:var(--muted);font-weight:400">· ${btl(v.quantite)} en cave</span></p>
      <div class="field"><span>Nombre</span><div class="step"><button type="button" id="mMoins" aria-label="Moins">−</button>
        <input id="mQ" type="number" inputmode="numeric" min="1" ${sortie ? `max="${v.quantite}"` : ''} value="1" class="field"><button type="button" id="mPlus" aria-label="Plus">+</button></div></div>
      <label class="field"><span>Date</span><input id="mD" type="date" value="${today()}" max="${today()}"></label>
      <label class="field"><span>${sortie ? 'Occasion, avec qui, impressions' : 'De qui / d\'où viennent-elles'}</span>
        <textarea id="mC" placeholder="${sortie ? 'Ex. Dîner avec les Muller, superbe avec le gibier' : 'Ex. Offert par Paul pour mes 56 ans'}">${esc(prefill)}</textarea></label>
      ${sortie ? `<div class="field"><span>Note du vin</span><div class="ratepick" id="mN">${[1, 2, 3, 4, 5].map(i => `<button type="button" data-n="${i}" class="${i <= (v.note || 0) ? 'on' : ''}" aria-label="${i} sur 5">★</button>`).join('')}</div></div>` : ''}
      <p class="err" id="mErr"></p>
      <div class="foot"><button class="btn" type="button" id="mCancel">Annuler</button><button class="btn pri" type="submit">${sortie ? 'Enregistrer' : 'Ajouter'}</button></div>
    </form>`, { back: back || backToVin(v.id) });
  let note = v.note || 0;
  const q = $('mQ'), lim = n => Math.max(1, sortie ? Math.min(v.quantite, n) : n);
  $('mMoins').onclick = () => { q.value = lim((+q.value || 1) - 1); };
  $('mPlus').onclick = () => { q.value = lim((+q.value || 0) + 1); };
  $('mCancel').onclick = back || backToVin(v.id);
  if ($('mN')) $('mN').querySelectorAll('button').forEach(b => b.onclick = () => { note = +b.dataset.n === note ? 0 : +b.dataset.n; $('mN').querySelectorAll('button').forEach(x => x.classList.toggle('on', +x.dataset.n <= note)); });
  $('mf').onsubmit = async e => {
    e.preventDefault();
    const n = lim(parseInt(q.value, 10) || 1), d = $('mD').value || today(), c = val('mC');
    const ins = await sb.from('cave_mouvements').insert({ foyer_id: foyer.id, vin_id: v.id, date: d, quantite: n * sens, commentaire: c }).select().single();
    if (ins.error) { $('mErr').textContent = ins.error.message; return; }
    const upd = { quantite: Math.max(0, v.quantite + n * sens) };
    if (sortie && note !== (v.note || 0)) upd.note = note || null;
    const r = await sb.from('cave_vins').update(upd).eq('id', v.id).select().single();
    if (r.error) { $('mErr').textContent = r.error.message; return; }
    M.unshift(ins.data); M.sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
    V = V.map(x => x.id === v.id ? r.data : x); saveCache(); render();
    if (sortie && r.data.quantite === 0 && !aRacheter(v.id)) { rachatForm(r.data, back || backToVin(v.id), true); return; }
    if (back) closeSheet(); else openVin(v.id);
    toast(sortie ? (r.data.quantite ? `Santé ! Il en reste ${r.data.quantite}.` : 'Santé ! C\'était la dernière.') : `${btl(n)} ajoutée${n > 1 ? 's' : ''}`);
  };
}
async function delMouv(m) {
  if (!m || !confirm('Supprimer ce mouvement ? Le stock sera corrigé en conséquence.')) return;
  const v = V.find(x => x.id === m.vin_id);
  const { error } = await sb.from('cave_mouvements').delete().eq('id', m.id); if (error) return fail(error);
  const r = await sb.from('cave_vins').update({ quantite: Math.max(0, v.quantite - m.quantite) }).eq('id', v.id).select().single(); if (r.error) return fail(r.error);
  M = M.filter(x => x.id !== m.id); V = V.map(x => x.id === v.id ? r.data : x); saveCache(); render(); renderVin(true);
}

/* ---------- analyse de la photo ---------- */
// 1) Dans le navigateur : estimation de la couleur d'après les teintes de la bouteille (immédiat, hors ligne).
async function couleurLocale(file) {
  const bmp = await createImageBitmap(file);
  const S = 120, k = S / Math.max(bmp.width, bmp.height), w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(bmp, 0, 0, w, h); bmp.close && bmp.close();
  const px = x.getImageData(Math.floor(w * .2), Math.floor(h * .08), Math.max(1, Math.floor(w * .6)), Math.max(1, Math.floor(h * .87))).data;
  const s = { rouge: 0, blanc: 0, rose: 0 }; let n = 0;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    n++;
    if (mx > .93 && d < .08) continue;                       // fond blanc / reflets
    const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    let hue = 0;
    if (d) { hue = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hue *= 60; if (hue < 0) hue += 360; }
    const rougeH = hue >= 320 || hue < 25, jauneH = hue >= 35 && hue < 70, vertH = hue >= 70 && hue < 170;
    if (l < .2) {                                            // verre sombre
      if (sat > .2 && vertH) s.blanc += .6;                  // flûte d'Alsace, bourgogne vert
      else if (rougeH || sat < .15) s.rouge += 1;
    } else if (sat > .25 && l < .88) {
      if (jauneH) s.blanc += 1.4;                            // vin jaune / or
      else if (rougeH && l >= .5) s.rose += 1.8;             // saumon / rose
      else if (rougeH) s.rouge += 1.4;                       // grenat, rubis
    }
  }
  const best = Object.entries(s).sort((a, b) => b[1] - a[1])[0];
  if (!n || best[1] < n * .03) return null;
  return best[0];
}
// 2) Sur le serveur : lecture de l'étiquette par IA (si une clé est configurée).
let iaDispo = lsg('cv-ia', null);
async function analyseIA(blob) {
  const b64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(blob); });
  const { data, error } = await sb.functions.invoke('analyse-vin', { body: { image: b64 } });
  if (error) { console.warn(error); return null; }
  if (data && data.ia === false) { iaDispo = false; lss('cv-ia', false); return null; }
  iaDispo = true; lss('cv-ia', true);
  if (data && data.error) throw new Error(data.error);
  return data || null;
}

/* ---------- formulaire vin ---------- */
function vinForm(v) {
  const neuf = !v; v = v || { couleur: 'rouge', quantite: 1, contenance: '75 cl', date_entree: today() };
  const inp = (id, label, value, attrs = '') => `<label class="field"><span>${label}</span><input id="${id}" value="${esc(value ?? '')}" ${attrs}></label>`;
  openSheet(neuf ? 'Nouvelle bouteille' : 'Modifier', `
    <form class="f" id="vf">
      <div class="photo-pick">
        <div class="ph" id="fPh">${v.photo && url(thumb(v.photo)) ? `<img src="${esc(url(thumb(v.photo)))}" alt="">` : I_BOTTLE}</div>
        <div class="pb">
          <label class="btn pri">${I_CAM}<span>${v.photo ? 'Changer la photo' : 'Photographier'}</span><input id="fFile" type="file" accept="image/*" capture="environment" hidden></label>
          <label class="btn"><span>Choisir dans les photos</span><input id="fFile2" type="file" accept="image/*" hidden></label>
          ${!neuf && v.photo ? '<button class="btn" type="button" id="fRelire">Relire et recadrer</button>' : ''}
          <div class="seg" id="fCropSeg" role="group" aria-label="Photo" hidden><button type="button" data-k="1" aria-pressed="true">Recadrée</button><button type="button" data-k="0" aria-pressed="false">Originale</button></div>
          <div class="ana" id="fAna" aria-live="polite">${neuf ? 'La couleur et l\'étiquette sont analysées à partir de la photo.' : ''}</div>
        </div>
      </div>
      <div class="field"><span>Couleur</span><div class="colors" id="fCol">${Object.entries(COULEURS).map(([k, l]) => `<button type="button" data-c="${k}" aria-pressed="${v.couleur === k}"><i class="pastille p-${k}"></i>${l}</button>`).join('')}</div></div>
      <label class="field"><span>Caviste</span><select id="fCav">${cavOptions(v.caviste_id)}</select></label>
      <label class="field"><span>De qui l'avez-vous eu ?</span><input id="fProv" value="${esc(v.provenance ?? '')}" placeholder="Ex. Offert par Paul, acheté au domaine, salon des vins…" list="lProv" autocomplete="off"></label>
      ${inp('fDom', 'Domaine / château', v.domaine, 'autocomplete="off"')}
      ${inp('fNom', 'Cuvée', v.nom, 'autocomplete="off"')}
      <div class="row2">${inp('fApp', 'Appellation', v.appellation, 'autocomplete="off"')}${inp('fMil', 'Millésime', v.millesime, `inputmode="numeric" placeholder="année"`)}</div>
      <div class="row2">${inp('fReg', 'Région', v.region, 'list="lReg" autocomplete="off"')}${inp('fPays', 'Pays', v.pays, 'autocomplete="off"')}</div>
      ${inp('fCep', 'Cépages', v.cepages, 'autocomplete="off"')}
      <div class="row3">
        ${neuf ? `<label class="field"><span>Bouteilles</span><input id="fQ" type="number" inputmode="numeric" min="1" value="${v.quantite}"></label>` : ''}
        <label class="field"><span>Contenance</span><select id="fCont">${CONTENANCES.map(c => `<option${c === v.contenance ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
        ${inp('fPrix', 'Prix unitaire (€)', v.prix, 'inputmode="decimal"')}
      </div>
      <div class="row3">
        ${inp('fGd', 'À boire à partir de', v.garde_debut, 'inputmode="numeric" placeholder="année"')}
        ${inp('fGf', 'À boire avant', v.garde_fin, 'inputmode="numeric" placeholder="année"')}
        ${inp('fEmp', 'Emplacement', v.emplacement, 'list="lEmp" placeholder="Casier, étagère…" autocomplete="off"')}
      </div>
      <label class="field"><span>Date d'entrée</span><input id="fDate" type="date" value="${esc(v.date_entree || '')}"></label>
      <div class="field"><span>Note</span><div class="ratepick" id="fNote">${[1, 2, 3, 4, 5].map(i => `<button type="button" data-n="${i}" class="${i <= (v.note || 0) ? 'on' : ''}" aria-label="${i} sur 5">★</button>`).join('')}</div></div>
      <label class="field"><span>Commentaire</span><textarea id="fCom" placeholder="Accords, dégustation, souvenirs…">${esc(v.commentaire)}</textarea></label>
      <datalist id="lReg">${['Alsace', 'Bordeaux', 'Bourgogne', 'Beaujolais', 'Champagne', 'Jura', 'Savoie', 'Loire', 'Rhône', 'Languedoc', 'Roussillon', 'Provence', 'Sud-Ouest', 'Corse'].map(r => `<option value="${r}">`).join('')}</datalist>
      <datalist id="lProv">${[...new Set(V.map(x => x.provenance).filter(Boolean))].map(r => `<option value="${esc(r)}">`).join('')}</datalist>
      <datalist id="lEmp">${[...new Set(V.map(x => x.emplacement).filter(Boolean))].map(r => `<option value="${esc(r)}">`).join('')}</datalist>
      <p class="err" id="fErr"></p>
      <div class="foot">${neuf ? '' : `<button class="btn danger" type="button" id="fDel">${I_DEL}Supprimer</button><span class="spacer"></span>`}
        <button class="btn" type="button" id="fCancel">Annuler</button><button class="btn pri" type="submit" id="fGo">Enregistrer</button></div>
    </form>`, { back: neuf ? null : backToVin(v.id) });

  let couleur = v.couleur, colTouchee = !neuf, note = v.note || 0, file = null, gen = 0;
  let source = null, crop = null, useCrop = true, cropChange = false;   // source : photo d'origine ; crop : version recadrée
  const showPh = b => { $('fPh').innerHTML = `<img src="${URL.createObjectURL(b)}" alt="">`; };
  const paintSeg = () => { const g = $('fCropSeg'); g.hidden = !crop; g.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', (b.dataset.k === '1') === useCrop)); };
  $('fCropSeg').querySelectorAll('button').forEach(b => b.onclick = () => { useCrop = b.dataset.k === '1'; paintSeg(); showPh(useCrop ? crop : source); });
  const setCol = (c, auto) => { couleur = c; if (!auto) colTouchee = true; $('fCol').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.c === c)); };
  $('fCol').querySelectorAll('button').forEach(b => b.onclick = () => setCol(b.dataset.c));
  bindCavSelect($('fCav'));
  $('fNote').querySelectorAll('button').forEach(b => b.onclick = () => { note = +b.dataset.n === note ? 0 : +b.dataset.n; $('fNote').querySelectorAll('button').forEach(x => x.classList.toggle('on', +x.dataset.n <= note)); });
  $('fCancel').onclick = neuf ? closeSheet : backToVin(v.id);
  if ($('fDel')) $('fDel').onclick = () => delVin(v);
  const fill = (id, x) => { if (x != null && x !== '' && !$(id).value.trim()) $(id).value = x; };
  const onFile = async (f, garder) => {
    if (!f) return; const my = ++gen, ana = $('fAna');
    source = f; crop = null; cropChange = false; paintSeg();
    if (!garder) { file = f; showPh(f); } else colTouchee = false;
    ana.className = 'ana'; ana.textContent = 'Analyse de la photo…';
    let loc = null; try { loc = await couleurLocale(f); } catch (e) { console.warn(e); }
    if (my !== gen) return;
    if (loc && !colTouchee) setCol(loc, true);
    ana.textContent = loc ? `Couleur estimée : ${COULEURS[loc]}. Lecture de l'étiquette…` : 'Lecture de l\'étiquette…';
    let ia = null, iaErr = ''; try { ia = await analyseIA(await toJpeg(f, 1100, .8)); } catch (e) { console.warn(e); iaErr = e.message || ''; }
    if (my !== gen) return;
    if (ia) {
      if (ia.couleur && COULEURS[ia.couleur] && !colTouchee) setCol(ia.couleur, true);
      fill('fDom', ia.domaine); fill('fNom', ia.nom); fill('fApp', ia.appellation); fill('fMil', ia.millesime);
      fill('fReg', ia.region); fill('fPays', ia.pays); fill('fCep', ia.cepages);
      ana.className = 'ana ok'; ana.textContent = `Étiquette lue : ${COULEURS[couleur]}. Vérifiez les champs remplis.`;
      if (ia.cadre) { try { const c = await recadrer(f, ia.cadre); if (my === gen && c) { crop = c; useCrop = true; cropChange = true; paintSeg(); showPh(c); ana.textContent += ' Photo recadrée sur l\'étiquette.'; } } catch (e) { console.warn(e); } }
    } else {
      ana.className = loc ? 'ana ok' : 'ana';
      ana.textContent = loc ? `Couleur estimée d'après la photo : ${COULEURS[loc]}. Corrigez si besoin.` : 'Couleur non reconnue : choisissez-la ci-dessous.';
      if (iaErr) ana.textContent += ` (Étiquette non lue : ${iaErr}.)`;
    }
  };
  $('fFile').onchange = e => onFile(e.target.files[0]);
  $('fFile2').onchange = e => onFile(e.target.files[0]);
  if ($('fRelire')) $('fRelire').onclick = async () => {
    $('fAna').className = 'ana'; $('fAna').textContent = 'Chargement de la photo…';
    try { const { data, error } = await sb.storage.from(BUCKET).download(v.photo_orig || v.photo); if (error || !data) throw new Error('Photo introuvable'); await onFile(data, true); }
    catch (e) { $('fAna').textContent = e.message || 'Photo introuvable'; }
  };

  $('vf').onsubmit = async e => {
    e.preventDefault(); const err = $('fErr'), go = $('fGo'); err.textContent = '';
    const an = id => { const x = num(id); return x == null ? null : Math.round(x); };
    const row = {
      couleur, domaine: val('fDom'), nom: val('fNom'), appellation: val('fApp'), millesime: an('fMil'), region: val('fReg'), pays: val('fPays'),
      cepages: val('fCep'), provenance: val('fProv'), contenance: $('fCont').value, prix: num('fPrix'), garde_debut: an('fGd'), garde_fin: an('fGf'),
      emplacement: val('fEmp'), date_entree: $('fDate').value || null, note: note || null, commentaire: val('fCom'),
      caviste_id: $('fCav').value && $('fCav').value !== '__new' ? $('fCav').value : null,
    };
    if (!row.domaine && !row.nom && !row.appellation && !file) { err.textContent = 'Indiquez au moins un domaine, une cuvée ou une appellation, ou ajoutez une photo.'; return; }
    for (const k of ['millesime', 'garde_debut', 'garde_fin']) if (row[k] != null && (isNaN(row[k]) || row[k] < 1800 || row[k] > 2200)) { err.textContent = 'Année invalide.'; return; }
    if (row.prix != null && isNaN(row.prix)) { err.textContent = 'Prix invalide.'; return; }
    go.disabled = true;
    try {
      const id = neuf ? uuid() : v.id;
      if (file || (cropChange && source)) {
        go.textContent = 'Envoi de la photo…';
        const st = sb.storage.from(BUCKET), np = () => `${foyer.id}/${id}/${uuid()}.jpg`;
        const up = async (blob, withThumb) => { const p = np();
          let r = await st.upload(p, blob === crop ? blob : await toJpeg(blob, 1600, .82), { contentType: 'image/jpeg' }); if (r.error) throw r.error;
          if (withThumb) { r = await st.upload(thumb(p), await toJpeg(blob, 480, .8), { contentType: 'image/jpeg' }); if (r.error) throw r.error; }
          return p; };
        const old = [v.photo, v.photo_orig].filter(Boolean);
        let orig = file ? null : (v.photo_orig || v.photo), main;
        if (file) orig = await up(file, !(useCrop && crop));
        if (useCrop && crop) main = await up(crop, true);
        else { main = orig; if (!file) { const r = await st.upload(thumb(orig), await toJpeg(source, 480, .8), { contentType: 'image/jpeg', upsert: true }); if (r.error) throw r.error; } }
        row.photo = main; row.photo_orig = main === orig ? null : orig;
        const garde = new Set([row.photo, row.photo_orig]);
        const del = old.filter(p => !garde.has(p)); if (del.length) st.remove(del.flatMap(p => [p, thumb(p)])).catch(() => {});
        await signAll([main, thumb(main)]);
      }
      if (neuf) {
        const q = Math.max(1, parseInt($('fQ').value, 10) || 1);
        const r = await sb.from('cave_vins').insert({ ...row, id, foyer_id: foyer.id, quantite: q }).select().single(); if (r.error) throw r.error;
        const m = await sb.from('cave_mouvements').insert({ foyer_id: foyer.id, vin_id: id, date: row.date_entree || today(), quantite: q, commentaire: row.provenance }).select().single();
        V.push(r.data); if (!m.error) M.unshift(m.data);
        toast(`${btl(q)} ajoutée${q > 1 ? 's' : ''} à la cave`);
      } else {
        const r = await sb.from('cave_vins').update(row).eq('id', v.id).select().single(); if (r.error) throw r.error;
        V = V.map(x => x.id === v.id ? r.data : x); toast('Enregistré');
      }
      saveCache(); render(); openVin(id);
    } catch (e2) { err.textContent = e2.message || String(e2); go.disabled = false; go.textContent = 'Enregistrer'; }
  };
}
async function delVin(v) {
  if (!confirm(`Supprimer « ${titre(v)} » et tout son historique ?`)) return;
  const { error } = await sb.from('cave_vins').delete().eq('id', v.id); if (error) return fail(error);
  if (v.photo) sb.storage.from(BUCKET).remove([v.photo, thumb(v.photo)]).catch(() => {});
  V = V.filter(x => x.id !== v.id); M = M.filter(m => m.vin_id !== v.id); saveCache(); closeSheet(); render(); toast('Vin supprimé');
}

/* ---------- photos ---------- */
// Recadre sur l'étiquette (cadre en fractions 0-1), format 3:4, et corrige légèrement la lumière.
async function recadrer(blob, c) {
  const x = +c.x, y = +c.y, w = +c.largeur, h = +c.hauteur;
  if (![x, y, w, h].every(n => isFinite(n)) || w <= .02 || h <= .02 || w * h > .8) return null;
  const bmp = await createImageBitmap(blob), W = bmp.width, H = bmp.height;
  let cx = (x + w / 2) * W, cy = (y + h / 2) * H, bw = w * W * 1.18, bh = h * H * 1.14;
  if (bw / bh > .75) bh = bw / .75; else bw = bh * .75;                  // format portrait 3:4
  const k = Math.min(1, W / bw, H / bh); bw *= k; bh *= k;
  let sx = Math.min(Math.max(0, cx - bw / 2), W - bw), sy = Math.min(Math.max(0, cy - bh / 2), H - bh);
  if (bw * bh > .85 * W * H) { bmp.close && bmp.close(); return null; }  // presque toute l'image : inutile
  const out = Math.min(1600, Math.round(bh)), ow = Math.round(out * .75);
  const cv = document.createElement('canvas'); cv.width = ow; cv.height = out;
  const g = cv.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, sx, sy, bw, bh, 0, 0, ow, out); bmp.close && bmp.close();
  // niveaux automatiques : étire entre les 1 % les plus sombres et les 1 % les plus clairs
  const im = g.getImageData(0, 0, ow, out), d = im.data, hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) hist[(d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8]++;
  const n = d.length / 4; let lo = 0, hi = 255, acc = 0;
  for (; lo < 255; lo++) { acc += hist[lo]; if (acc > n * .01) break; }
  acc = 0; for (; hi > 0; hi--) { acc += hist[hi]; if (acc > n * .01) break; }
  if (hi - lo > 40 && (lo > 4 || hi < 251)) {
    const f = Math.min(1.3, 255 / (hi - lo)), mid = (lo + hi) / 2, lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) lut[i] = 127.5 + (i - mid) * f;   // contraste modéré, centré
    for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
    g.putImageData(im, 0, 0);
  }
  return await new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('Conversion impossible')), 'image/jpeg', .86));
}
async function toJpeg(src, max, q) {
  const bmp = await createImageBitmap(src);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height)), w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(bmp, 0, 0, w, h); bmp.close && bmp.close();
  return await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('Conversion impossible')), 'image/jpeg', q));
}
async function openViewer(v, orig) {
  const p = orig && v.photo_orig ? v.photo_orig : v.photo; if (orig) await signAll([p]);
  const el = $('viewer'); el.innerHTML = `<img src="${esc(url(p) || url(thumb(p)))}" alt="${esc(titre(v))}"><div class="vbar">${v.photo_orig ? `<button class="btn" id="vwAlt">${orig ? 'Photo recadrée' : 'Photo d\'origine'}</button>` : ''}<button class="btn" id="vwClose">Fermer</button></div>`;
  el.hidden = false; $('vwClose').onclick = closeViewer; el.querySelector('img').onclick = closeViewer;
  if ($('vwAlt')) $('vwAlt').onclick = () => openViewer(v, !orig);
}
function closeViewer() { $('viewer').hidden = true; $('viewer').innerHTML = ''; }

/* ---------- export ---------- */
function exportCsv() {
  const cols = [['Couleur', v => COULEURS[v.couleur]], ['Domaine', 'domaine'], ['Cuvée', 'nom'], ['Appellation', 'appellation'], ['Millésime', 'millesime'], ['Région', 'region'], ['Pays', 'pays'],
    ['Cépages', 'cepages'], ['Bouteilles', 'quantite'], ['Contenance', 'contenance'], ['De qui', 'provenance'], ['Caviste', v => cavNom(v.caviste_id)], ['Emplacement', 'emplacement'], ['Prix', v => v.prix != null ? String(v.prix).replace('.', ',') : ''],
    ['À boire de', 'garde_debut'], ['À boire avant', 'garde_fin'], ['Note', 'note'], ['Entrée', 'date_entree'], ['Commentaire', 'commentaire']];
  const cell = x => { const s = String(x ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = [cols.map(c => c[0]).join(';'), ...V.slice().sort((a, b) => titre(a).localeCompare(titre(b), 'fr')).map(v => cols.map(([, f]) => cell(typeof f === 'function' ? f(v) : v[f])).join(';'))];
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = `cave-${today()}.csv`; a.click();
}

/* ---------- réglages ---------- */
async function openSettings() {
  const moi = membres.find(m => m.user_id === me.id) || {};
  const total = V.reduce((s, v) => s + v.quantite, 0), valeur = V.reduce((s, v) => s + (v.prix || 0) * v.quantite, 0);
  openSheet('Réglages', `
    <div class="box"><h3>La cave</h3>
      <p>${btl(total)} · ${plur(V.filter(v => v.quantite).length, 'référence')}${valeur ? ` · valeur d'achat connue ${eur(valeur)}` : ''}</p>
      <div class="foot" style="justify-content:flex-start"><button class="btn" id="sCsv">Exporter en CSV (Excel)</button></div></div>
    <div class="box"><h3>Lecture des étiquettes</h3>
      <p id="sIa">Vérification…</p></div>
    <div class="box"><h3>Foyer : ${esc(foyer.nom)}</h3>
      <p>Membres : ${membres.map(m => esc(m.prenom || 'Sans prénom') + (m.user_id === me.id ? ' (vous)' : '')).join(', ')}</p>
      <p>Le foyer est le même que dans l'app Mes chats. Pour inviter quelqu'un : il crée son compte, choisit « Rejoindre avec un code » et saisit :</p>
      <div class="code">${esc(foyer.code)}</div>
      <div class="foot" style="justify-content:flex-start"><button class="btn" id="fShare">Partager l'invitation</button></div></div>
    <div class="box"><h3>Mon compte</h3>
      <label class="field"><span>Mon prénom</span><input id="mPrenom" value="${esc(moi.prenom)}"></label>
      <p style="margin-top:10px">${esc(me.email)}</p>
      <div class="foot" style="justify-content:flex-start"><button class="btn danger" id="logout">Se déconnecter</button></div></div>`);
  $('sCsv').onclick = exportCsv;
  $('mPrenom').onchange = async () => { const v = $('mPrenom').value.trim() || null; const { error } = await sb.from('foyer_membres').update({ prenom: v }).eq('foyer_id', foyer.id).eq('user_id', me.id); if (error) return fail(error); membres = membres.map(m => m.user_id === me.id ? { ...m, prenom: v } : m); saveCache(); };
  $('fShare').onclick = async () => {
    const txt = `Rejoins la cave « ${foyer.nom} » : ${location.origin + location.pathname}\nCrée ton compte (ou connecte-toi avec ton compte Mes chats) puis choisis « Rejoindre avec un code » : ${foyer.code}`;
    try { if (navigator.share) await navigator.share({ title: 'Ma cave', text: txt }); else { await navigator.clipboard.writeText(txt); toast('Invitation copiée'); } } catch {}
  };
  $('logout').onclick = async () => { await sb.auth.signOut(); localStorage.removeItem(CACHE); location.reload(); };
  const { data, error } = await sb.functions.invoke('analyse-vin', { body: { ping: true } }).catch(e => ({ error: e }));
  iaDispo = !!(data && data.ia && data.ok); lss('cv-ia', iaDispo);
  const msg = error ? 'Vérification impossible (pas de réseau ?).'
    : !data || data.ia === false ? 'Seule la couleur est estimée d\'après la teinte de la photo. Pour lire aussi les étiquettes, il faut ajouter une clé API Claude dans Supabase (secret ANTHROPIC_API_KEY).'
    : data.ok ? 'Active : la photo de l\'étiquette remplit la couleur, le domaine, l\'appellation, le millésime et la région.'
    : data.status === 401 ? 'Clé API refusée par Anthropic : vérifiez le secret ANTHROPIC_API_KEY dans Supabase.'
    : /credit|balance/i.test(data.detail || '') ? 'Clé valide mais crédit Anthropic insuffisant : ajoutez du crédit dans la console Anthropic (Billing).'
    : `Clé présente mais Anthropic répond une erreur ${data.status}.`;
  if ($('sIa')) $('sIa').textContent = msg;
}

/* ---------- liens profonds ---------- */
function route() { const m = location.hash.slice(1).match(/^vin\/(.+)$/); if (m && V.some(v => v.id === m[1]) && openId !== m[1]) openVin(m[1]); }
window.addEventListener('hashchange', route);

/* ---------- foyer ---------- */
let onbMode = 'creer';
document.querySelectorAll('#onbForm .seg button').forEach(b => b.onclick = () => {
  onbMode = b.dataset.o; document.querySelectorAll('#onbForm .seg button').forEach(x => x.setAttribute('aria-pressed', x === b));
  $('onbNomF').hidden = onbMode !== 'creer'; $('onbCodeF').hidden = onbMode === 'creer';
});
$('onbOut').onclick = async () => { await sb.auth.signOut(); location.reload(); };
$('onbForm').onsubmit = async e => {
  e.preventDefault(); $('onbErr').textContent = ''; $('onbGo').disabled = true;
  try {
    const prenom = $('onbPrenom').value.trim();
    const r = onbMode === 'creer' ? await sb.rpc('creer_foyer', { p_nom: $('onbNom').value.trim(), p_prenom: prenom })
      : await sb.rpc('rejoindre_foyer', { p_code: $('onbCode').value.trim(), p_prenom: prenom });
    if (r.error) throw r.error;
    await enter();
  } catch (err) { $('onbErr').textContent = /Code inconnu/.test(err.message) ? 'Code inconnu : vérifiez-le auprès du membre qui vous invite.' : err.message; }
  finally { $('onbGo').disabled = false; }
};
async function enter() {
  const { data, error } = await sb.from('foyers').select('*').limit(1);
  if (error) { if (foyer) return showApp(); toast('Pas de réseau'); return; }
  if (!data.length) { $('auth').hidden = true; $('app').hidden = true; $('nav').hidden = true; $('onb').hidden = false; return; }
  foyer = data[0]; showApp(); await load(); route();
}
function showApp() { $('auth').hidden = true; $('onb').hidden = true; $('app').hidden = false; $('nav').hidden = false; setView(view); }

/* ---------- connexion ---------- */
let mode = 'login';
function paintMode() {
  const L = { login: ['Ma cave', 'Se connecter', 'Créer un compte', true], signup: ['Créer un compte', 'Créer le compte', "J'ai déjà un compte", false],
    reset: ['Mot de passe oublié', 'Envoyer le lien', 'Retour', false], newpw: ['Nouveau mot de passe', 'Enregistrer', '', false] }[mode];
  $('authTitle').textContent = L[0]; $('authGo').textContent = L[1]; $('authAlt').textContent = L[2]; $('authAlt').hidden = !L[2];
  $('authForgot').hidden = !L[3]; $('authEmailF').hidden = mode === 'newpw'; $('authPwF').hidden = mode === 'reset';
  $('authPw').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
}
function showLogin(m) { $('app').hidden = true; $('nav').hidden = true; $('onb').hidden = true; $('auth').hidden = false; $('authErr').textContent = m || ''; paintMode(); }
$('authAlt').onclick = () => { mode = mode === 'login' ? 'signup' : 'login'; $('authErr').textContent = ''; paintMode(); };
$('authForgot').onclick = () => { mode = 'reset'; $('authErr').textContent = ''; paintMode(); };
$('authForm').onsubmit = async e => {
  e.preventDefault();
  const email = $('authEmail').value.trim().toLowerCase(), pw = $('authPw').value, err = $('authErr'), go = $('authGo');
  err.textContent = ''; go.disabled = true;
  try {
    const back = location.origin + location.pathname;
    if (mode === 'login') { const { data, error } = await sb.auth.signInWithPassword({ email, password: pw }); if (error) throw error; if (data.session) start(data.session); }
    else if (mode === 'signup') {
      if (pw.length < 8) throw new Error("Choisissez un mot de passe d'au moins 8 caractères.");
      const { data, error } = await sb.auth.signUp({ email, password: pw, options: { emailRedirectTo: back } }); if (error) throw error;
      if (data.session) start(data.session);
      else { mode = 'login'; paintMode(); err.textContent = 'Compte créé. Confirmez via le lien reçu par e-mail, puis connectez-vous.'; }
    } else if (mode === 'reset') {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: back }); if (error) throw error;
      mode = 'login'; paintMode(); err.textContent = 'E-mail envoyé. Suivez le lien pour choisir un nouveau mot de passe.';
    } else if (mode === 'newpw') {
      if (pw.length < 8) throw new Error('Au moins 8 caractères.');
      const { error } = await sb.auth.updateUser({ password: pw }); if (error) throw error;
      mode = 'login'; const { data } = await sb.auth.getSession(); if (data.session) start(data.session);
    }
  } catch (e2) {
    const m = e2 && e2.message || '';
    err.textContent = /invalid login/i.test(m) ? 'E-mail ou mot de passe incorrect.' : /not confirmed/i.test(m) ? 'Adresse pas encore confirmée : ouvrez le lien reçu par e-mail.'
      : /already registered/i.test(m) ? 'Ce compte existe déjà : connectez-vous.' : /rate limit/i.test(m) ? 'Trop de tentatives, réessayez dans quelques minutes.'
      : /fetch|network/i.test(m) ? 'Pas de réseau.' : (m || 'Erreur inattendue.');
  } finally { go.disabled = false; }
};
function start(session) {
  if (me && me.id === session.user.id) return;
  me = session.user;
  const c = lsg(CACHE, null);
  if (c && c.uid === me.id && c.foyer) { ({ foyer, membres = [], V = [], M = [], CV = [], AC = [] } = c); showApp(); }
  enter();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && me && foyer) load(); });
sb.auth.onAuthStateChange((ev, session) => {
  if (ev === 'PASSWORD_RECOVERY') { mode = 'newpw'; showLogin('Choisissez votre nouveau mot de passe.'); return; }
  if (ev === 'SIGNED_IN' && session) start(session);
});
sb.auth.getSession().then(({ data }) => { if (data.session) start(data.session); else if (mode !== 'newpw') showLogin(); });

/* ---------- navigation ---------- */
document.querySelectorAll('.nav button').forEach(b => b.onclick = () => setView(b.dataset.v));
$('acctBtn').onclick = openSettings;
$('addBtn').onclick = () => vinForm(null);
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
})();
