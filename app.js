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
let V = [], M = [];   // vins, mouvements
let view = lsg('cv-view', 'cave'), filtre = lsg('cv-filtre', 'tous'), tri = lsg('cv-tri', 'nom'), recherche = '', voirVides = false, openId = null;
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
function saveCache() { lss(CACHE, { uid: me && me.id, foyer, membres, V, M }); }
async function load() {
  const r = await Promise.all([
    sb.from('cave_vins').select('*').order('nom'),
    sb.from('cave_mouvements').select('*').order('date', { ascending: false }).order('created_at', { ascending: false }).limit(1000),
    sb.from('foyer_membres').select('*')]);
  const err = r.find(x => x.error);
  if (err) { console.warn(err.error); if (!V.length) toast('Chargement impossible : ' + err.error.message); return; }
  [V, M, membres] = r.map(x => x.data);
  saveCache();
  await signAll(V.map(v => thumb(v.photo)));
  render();
  if (openId && sheetKind === 'vin') renderVin(true);
}

/* ---------- rendu ---------- */
function setView(v) {
  view = v; lss('cv-view', v);
  document.querySelectorAll('.nav button').forEach(b => b.setAttribute('aria-current', b.dataset.v === v ? 'page' : 'false'));
  $('vCave').hidden = v !== 'cave'; $('vHist').hidden = v !== 'hist';
  $('title').textContent = v === 'cave' ? 'Ma cave' : 'Dégustations';
  render(); window.scrollTo(0, 0);
}
function render() {
  if (!foyer) return;
  $('sub').textContent = foyer.nom;
  if (view === 'cave') renderCave(); else renderHist();
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
  if ($('vPh')) $('vPh').onclick = () => openViewer(v);
  $('sheet').querySelectorAll('[data-delm]').forEach(b => b.onclick = () => delMouv(M.find(m => m.id === b.dataset.delm)));
}

/* ---------- boire / ajouter ---------- */
function mouvForm(v, sens) {
  const sortie = sens < 0;
  openSheet(sortie ? 'Boire une bouteille' : 'Ajouter des bouteilles', `
    <form class="f" id="mf">
      <p style="margin:0;font-weight:700">${esc(titre(v))}${v.millesime ? ' ' + v.millesime : ''} <span style="color:var(--muted);font-weight:400">· ${btl(v.quantite)} en cave</span></p>
      <div class="field"><span>Nombre</span><div class="step"><button type="button" id="mMoins" aria-label="Moins">−</button>
        <input id="mQ" type="number" inputmode="numeric" min="1" ${sortie ? `max="${v.quantite}"` : ''} value="1" class="field"><button type="button" id="mPlus" aria-label="Plus">+</button></div></div>
      <label class="field"><span>Date</span><input id="mD" type="date" value="${today()}" max="${today()}"></label>
      <label class="field"><span>${sortie ? 'Occasion, avec qui, impressions' : 'De qui / d\'où viennent-elles'}</span>
        <textarea id="mC" placeholder="${sortie ? 'Ex. Dîner avec les Muller, superbe avec le gibier' : 'Ex. Offert par Paul pour mes 56 ans'}"></textarea></label>
      ${sortie ? `<div class="field"><span>Note du vin</span><div class="ratepick" id="mN">${[1, 2, 3, 4, 5].map(i => `<button type="button" data-n="${i}" class="${i <= (v.note || 0) ? 'on' : ''}" aria-label="${i} sur 5">★</button>`).join('')}</div></div>` : ''}
      <p class="err" id="mErr"></p>
      <div class="foot"><button class="btn" type="button" id="mCancel">Annuler</button><button class="btn pri" type="submit">${sortie ? 'Enregistrer' : 'Ajouter'}</button></div>
    </form>`, { back: backToVin(v.id) });
  let note = v.note || 0;
  const q = $('mQ'), lim = n => Math.max(1, sortie ? Math.min(v.quantite, n) : n);
  $('mMoins').onclick = () => { q.value = lim((+q.value || 1) - 1); };
  $('mPlus').onclick = () => { q.value = lim((+q.value || 0) + 1); };
  $('mCancel').onclick = backToVin(v.id);
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
    V = V.map(x => x.id === v.id ? r.data : x); saveCache(); render(); openVin(v.id);
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
  if (iaDispo === false) return null;
  const b64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(blob); });
  const { data, error } = await sb.functions.invoke('analyse-vin', { body: { image: b64 } });
  if (error) { console.warn(error); return null; }
  if (data && data.ia === false) { iaDispo = false; lss('cv-ia', false); return null; }
  iaDispo = true; lss('cv-ia', true);
  return data && !data.error ? data : null;
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
          <div class="ana" id="fAna" aria-live="polite">${neuf ? 'La couleur et l\'étiquette sont analysées à partir de la photo.' : ''}</div>
        </div>
      </div>
      <div class="field"><span>Couleur</span><div class="colors" id="fCol">${Object.entries(COULEURS).map(([k, l]) => `<button type="button" data-c="${k}" aria-pressed="${v.couleur === k}"><i class="pastille p-${k}"></i>${l}</button>`).join('')}</div></div>
      <label class="field"><span>De qui l'avez-vous eu ?</span><input id="fProv" value="${esc(v.provenance ?? '')}" placeholder="Ex. Offert par Paul, acheté au domaine, salon des vins…" list="lProv" autocomplete="off"></label>
      ${inp('fDom', 'Domaine / château', v.domaine, 'autocomplete="off"')}
      ${inp('fNom', 'Cuvée', v.nom, 'autocomplete="off"')}
      <div class="row2">${inp('fApp', 'Appellation', v.appellation, 'autocomplete="off"')}${inp('fMil', 'Millésime', v.millesime, `inputmode="numeric" placeholder="${ANNEE - 3}"`)}</div>
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
  const setCol = (c, auto) => { couleur = c; if (!auto) colTouchee = true; $('fCol').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.c === c)); };
  $('fCol').querySelectorAll('button').forEach(b => b.onclick = () => setCol(b.dataset.c));
  $('fNote').querySelectorAll('button').forEach(b => b.onclick = () => { note = +b.dataset.n === note ? 0 : +b.dataset.n; $('fNote').querySelectorAll('button').forEach(x => x.classList.toggle('on', +x.dataset.n <= note)); });
  $('fCancel').onclick = neuf ? closeSheet : backToVin(v.id);
  if ($('fDel')) $('fDel').onclick = () => delVin(v);
  const fill = (id, x) => { if (x != null && x !== '' && !$(id).value.trim()) $(id).value = x; };
  const onFile = async f => {
    if (!f) return; file = f; const my = ++gen, ana = $('fAna');
    $('fPh').innerHTML = `<img src="${URL.createObjectURL(f)}" alt="">`;
    ana.className = 'ana'; ana.textContent = 'Analyse de la photo…';
    let loc = null; try { loc = await couleurLocale(f); } catch (e) { console.warn(e); }
    if (my !== gen) return;
    if (loc && !colTouchee) setCol(loc, true);
    ana.textContent = loc ? `Couleur estimée : ${COULEURS[loc]}. Lecture de l'étiquette…` : 'Lecture de l\'étiquette…';
    let ia = null; try { ia = await analyseIA(await toJpeg(f, 1100, .8)); } catch (e) { console.warn(e); }
    if (my !== gen) return;
    if (ia) {
      if (ia.couleur && COULEURS[ia.couleur] && !colTouchee) setCol(ia.couleur, true);
      fill('fDom', ia.domaine); fill('fNom', ia.nom); fill('fApp', ia.appellation); fill('fMil', ia.millesime);
      fill('fReg', ia.region); fill('fPays', ia.pays); fill('fCep', ia.cepages);
      ana.className = 'ana ok'; ana.textContent = `Étiquette lue : ${COULEURS[couleur]}. Vérifiez les champs remplis.`;
    } else {
      ana.className = loc ? 'ana ok' : 'ana';
      ana.textContent = loc ? `Couleur estimée d'après la photo : ${COULEURS[loc]}. Corrigez si besoin.` : 'Couleur non reconnue : choisissez-la ci-dessous.';
    }
  };
  $('fFile').onchange = e => onFile(e.target.files[0]);
  $('fFile2').onchange = e => onFile(e.target.files[0]);

  $('vf').onsubmit = async e => {
    e.preventDefault(); const err = $('fErr'), go = $('fGo'); err.textContent = '';
    const an = id => { const x = num(id); return x == null ? null : Math.round(x); };
    const row = {
      couleur, domaine: val('fDom'), nom: val('fNom'), appellation: val('fApp'), millesime: an('fMil'), region: val('fReg'), pays: val('fPays'),
      cepages: val('fCep'), provenance: val('fProv'), contenance: $('fCont').value, prix: num('fPrix'), garde_debut: an('fGd'), garde_fin: an('fGf'),
      emplacement: val('fEmp'), date_entree: $('fDate').value || null, note: note || null, commentaire: val('fCom'),
    };
    if (!row.domaine && !row.nom && !row.appellation && !file) { err.textContent = 'Indiquez au moins un domaine, une cuvée ou une appellation, ou ajoutez une photo.'; return; }
    for (const k of ['millesime', 'garde_debut', 'garde_fin']) if (row[k] != null && (isNaN(row[k]) || row[k] < 1800 || row[k] > 2200)) { err.textContent = 'Année invalide.'; return; }
    if (row.prix != null && isNaN(row.prix)) { err.textContent = 'Prix invalide.'; return; }
    go.disabled = true;
    try {
      const id = neuf ? uuid() : v.id;
      if (file) {
        go.textContent = 'Envoi de la photo…';
        const path = `${foyer.id}/${id}/${uuid()}.jpg`, st = sb.storage.from(BUCKET);
        let r = await st.upload(path, await toJpeg(file, 1600, .82), { contentType: 'image/jpeg' }); if (r.error) throw r.error;
        r = await st.upload(thumb(path), await toJpeg(file, 480, .78), { contentType: 'image/jpeg' }); if (r.error) throw r.error;
        if (v.photo) st.remove([v.photo, thumb(v.photo)]).catch(() => {});
        row.photo = path; await signAll([path, thumb(path)]);
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
async function toJpeg(src, max, q) {
  const bmp = await createImageBitmap(src);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height)), w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(bmp, 0, 0, w, h); bmp.close && bmp.close();
  return await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('Conversion impossible')), 'image/jpeg', q));
}
function openViewer(v) {
  const el = $('viewer'); el.innerHTML = `<img src="${esc(url(v.photo) || url(thumb(v.photo)))}" alt="${esc(titre(v))}"><div class="vbar"><button class="btn" id="vwClose">Fermer</button></div>`;
  el.hidden = false; $('vwClose').onclick = closeViewer; el.querySelector('img').onclick = closeViewer;
}
function closeViewer() { $('viewer').hidden = true; $('viewer').innerHTML = ''; }

/* ---------- export ---------- */
function exportCsv() {
  const cols = [['Couleur', v => COULEURS[v.couleur]], ['Domaine', 'domaine'], ['Cuvée', 'nom'], ['Appellation', 'appellation'], ['Millésime', 'millesime'], ['Région', 'region'], ['Pays', 'pays'],
    ['Cépages', 'cepages'], ['Bouteilles', 'quantite'], ['Contenance', 'contenance'], ['De qui', 'provenance'], ['Emplacement', 'emplacement'], ['Prix', v => v.prix != null ? String(v.prix).replace('.', ',') : ''],
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
  const { data } = await sb.functions.invoke('analyse-vin', { body: {} }).catch(() => ({}));
  const ok = data && data.ia !== false; iaDispo = ok ? true : false; lss('cv-ia', iaDispo);
  if ($('sIa')) $('sIa').textContent = ok
    ? 'Active : la photo de l\'étiquette remplit la couleur, le domaine, l\'appellation, le millésime et la région.'
    : 'Seule la couleur est estimée d\'après la teinte de la photo. Pour lire aussi les étiquettes, il faut ajouter une clé API Claude dans Supabase (secret ANTHROPIC_API_KEY).';
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
  if (c && c.uid === me.id && c.foyer) { ({ foyer, membres = [], V = [], M = [] } = c); showApp(); }
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
