import { SUPABASE_URL, SUPABASE_ANON_KEY, ALLOWED_DOMAIN } from "./supabase-config.js";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
let people = [], chats = {}, user = null, isAdmin = false, busy = false, channel = null;

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";
const short = (n) => { const p = n.trim().split(/\s+/); return p.length > 1 ? p[0] + " " + p[p.length - 1][0] + "." : p[0]; };
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function say(text, kind) { const m = $("msg"); m.textContent = text; m.className = "msg" + (kind ? " " + kind : ""); }
function remember(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; }

// ---------- auth ----------
let holdSession = false;
const pw = (pin) => "pct" + pin; // padded so it passes the 6 character minimum
function okEmail() {
  const e = $("email").value.trim().toLowerCase();
  if (!e.endsWith("@" + ALLOWED_DOMAIN)) { $("authmsg").textContent = "Use your @" + ALLOWED_DOMAIN + " email."; return null; }
  return e;
}

$("authform").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const email = okEmail(); if (!email) return;
  const pin = $("pin").value.trim();
  if (!/^\d{4}$/.test(pin)) { $("authmsg").textContent = "Enter your 4 digit code. First time here? Tap Create my code."; return; }
  $("signin").disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email, password: pw(pin) });
  $("signin").disabled = false;
  if (error) $("authmsg").textContent = "Wrong email or code. If you forgot your code, ask a Marshall to reset it.";
});

$("create").addEventListener("click", async () => {
  const email = okEmail(); if (!email) return;
  const pin = String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000));
  holdSession = true; $("create").disabled = true;
  const { data, error } = await sb.auth.signUp({ email, password: pw(pin) });
  $("create").disabled = false;
  if (error || !data.session) {
    holdSession = false;
    $("authmsg").textContent = error
      ? (/registered|exists/i.test(error.message) ? "This email already has a code. Enter it and tap Sign in. If you forgot it, ask a Marshall to reset it." : "Couldn't create a code. Try again in a moment.")
      : "Setup problem. Tell a Marshall that email confirmation is still turned on.";
    return;
  }
  $("loginbox").hidden = true; $("codebox").hidden = false; $("bigcode").textContent = pin;
});

$("gocont").addEventListener("click", async () => {
  holdSession = false;
  const { data } = await sb.auth.getSession();
  handleSession(data.session);
});
$("signout").onclick = () => sb.auth.signOut();

sb.auth.onAuthStateChange((event, session) => { setTimeout(() => handleSession(session), 0); });

async function handleSession(session) {
  if (holdSession) return;
  const u = session && session.user ? session.user : null;
  if (u && !(u.email || "").toLowerCase().endsWith("@" + ALLOWED_DOMAIN)) {
    await sb.auth.signOut(); $("authmsg").textContent = "Please use your @" + ALLOWED_DOMAIN + " email."; return;
  }
  if ((u && user && u.id === user.id) || (!u && !user)) return;
  if (channel) { sb.removeChannel(channel); channel = null; }
  user = u; people = []; chats = {}; isAdmin = false;
  $("app").hidden = !u; $("gate").hidden = !!u; $("userbox").hidden = !u;
  if (!u) { $("loginbox").hidden = false; $("codebox").hidden = true; $("pin").value = ""; return; }
  $("who").textContent = u.email;
  const m = await sb.from("marshalls").select("email").eq("email", u.email.toLowerCase());
  isAdmin = !!(m.data && m.data.length);
  await load();
  channel = sb.channel("pct")
    .on("postgres_changes", { event: "*", schema: "public", table: "chats" }, load)
    .on("postgres_changes", { event: "*", schema: "public", table: "people" }, load)
    .subscribe();
}

document.addEventListener("visibilitychange", () => { if (!document.hidden && user) load(); });

async function load() {
  const [p, c] = await Promise.all([sb.from("people").select("id,name,role"), sb.from("chats").select("id")]);
  if (p.error || c.error) { say("Couldn't load the list. Check that you're signed in with your school email.", "err"); return; }
  people = p.data; chats = {}; c.data.forEach((r) => { chats[r.id] = true; });
  render();
}

// ---------- data helpers ----------
function lists() {
  const cmp = (x, y) => x.name.localeCompare(y.name);
  const b = people.filter((p) => p.role === "brother").sort(cmp);
  const p = people.filter((p) => p.role === "pledge").sort(cmp);
  return { brothers: b, pledges: p, cols: b.concat(p) };
}
const done = (a, b) => !!(chats[a + "__" + b] || chats[b + "__" + a]);

// ---------- rendering ----------
function renderStats(L) {
  const s = $("stats"); s.textContent = "";
  const P = L.pledges.length; const total = L.brothers.length * P + P * (P - 1) / 2; let got = 0, complete = 0;
  L.pledges.forEach((p, i) => {
    const t = L.cols.filter((b) => b.id !== p.id);
    const c = t.filter((b) => done(p.id, b.id)).length;
    if (t.length && c === t.length) complete++;
    L.brothers.forEach((b) => { if (done(p.id, b.id)) got++; });
    L.pledges.forEach((q, j) => { if (j > i && done(p.id, q.id)) got++; });
  });
  [[got + " / " + total, "Chats logged"], [total ? Math.round(got / total * 100) + "%" : "0%", "Overall"], [complete + " / " + P, "Pledges finished"]]
    .forEach((x) => { const d = el("div", "stat"); d.appendChild(el("b", null, x[0])); d.appendChild(el("span", null, x[1])); s.appendChild(d); });
}

function fillSelect(sel, items, placeholder) {
  const cur = sel.value; sel.textContent = "";
  const o = el("option", null, placeholder); o.value = ""; sel.appendChild(o);
  items.forEach((i) => { const op = el("option", null, i.name); op.value = i.id; sel.appendChild(op); });
  if (items.some((i) => i.id === cur)) sel.value = cur;
}

function renderGrid(L) {
  const w = $("gridwrap"); w.textContent = "";
  if (!L.pledges.length || !L.brothers.length) {
    w.appendChild(el("div", "empty", "Nothing here yet. The Marshalls will add the list."));
    return;
  }
  const t = el("table"), thead = el("thead"), hr = el("tr");
  hr.appendChild(el("th", "name", "Pledge"));
  L.cols.forEach((b) => { const th = el("th", "col" + (b.role === "pledge" ? " pcol" : "")); th.title = b.name + (b.role === "pledge" ? " (pledge)" : ""); th.appendChild(el("span", "vert", short(b.name))); hr.appendChild(th); });
  thead.appendChild(hr); t.appendChild(thead);
  const tb = el("tbody");
  L.pledges.forEach((p) => {
    const tr = el("tr"), nm = el("td", "name"); let c = 0;
    const N = L.cols.length - 1;
    L.cols.forEach((b) => { if (b.id !== p.id && done(p.id, b.id)) c++; });
    nm.appendChild(el("span", "n", p.name));
    const pr = el("span", "p"), bar = el("span", "bar" + (c === N ? " full" : "")), fill = el("i");
    fill.style.width = (c / N * 100) + "%"; bar.appendChild(fill);
    pr.appendChild(bar); pr.appendChild(el("span", null, c + "/" + N)); nm.appendChild(pr);
    tr.appendChild(nm);
    L.cols.forEach((b) => {
      const td = el("td", "cell" + (b.role === "pledge" ? " pcol" : "")), on = done(p.id, b.id); let d;
      if (b.id === p.id) { td.appendChild(el("span", "self", "–")); tr.appendChild(td); return; }
      if (isAdmin) { d = el("button", "dot" + (on ? " on" : "")); d.type = "button"; d.addEventListener("click", () => setChat(p, b, !on)); }
      else d = el("i", "dot" + (on ? " on" : ""));
      d.setAttribute("aria-label", p.name + " and " + b.name + (on ? ": met" : ": not yet"));
      td.appendChild(d); tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  const tf = el("tfoot"), fr = el("tr"); fr.appendChild(el("th", "name", "Pledges met"));
  L.cols.forEach((b) => {
    const c = L.pledges.filter((p) => p.id !== b.id && done(p.id, b.id)).length;
    fr.appendChild(el("td", b.role === "pledge" ? "pcol" : null, String(c)));
  });
  tf.appendChild(fr); t.appendChild(tf); w.appendChild(t);
}

function renderMine(L) {
  const box = $("mine"); box.textContent = "";
  const pid = $("pledge").value, me = L.pledges.find((p) => p.id === pid);
  if (!me) { box.appendChild(el("p", "msg", L.pledges.length ? "Pick your name to see who you've met and who is left." : "The Marshalls will add the pledge class soon.")); return; }
  const others = L.cols.filter((b) => b.id !== me.id);
  const met = others.filter((b) => done(me.id, b.id));
  const left = others.filter((b) => !done(me.id, b.id));
  box.appendChild(el("p", "mine-sum", met.length + " of " + others.length + " met" + (left.length ? "" : ". All done!")));
  const group = (title, items, isMet) => {
    if (!items.length) return;
    box.appendChild(el("h3", "gh", title + " (" + items.length + ")"));
    const g = el("div", "tiles");
    items.forEach((b) => {
      const t = el("div", "tile" + (isMet ? " met" : ""));
      const btn = el("button", "tilebtn", b.name + (b.role === "pledge" ? " (pledge)" : "")); btn.type = "button";
      if (isMet) {
        btn.disabled = true;
        const u = el("button", "undo", "undo"); u.type = "button"; u.addEventListener("click", () => setChat(me, b, false));
        t.appendChild(btn); t.appendChild(u);
      } else { btn.addEventListener("click", () => setChat(me, b, true)); t.appendChild(btn); }
      g.appendChild(t);
    });
    box.appendChild(g);
  };
  group("Still to meet. Tap a name after you've had your chat", left, false);
  group("Met", met, true);
}

function renderAdmin(L) {
  $("adminpanel").hidden = !isAdmin; $("adminhint").hidden = !isAdmin;
  if (!isAdmin) return;
  const ch = $("chips"); ch.textContent = "";
  L.pledges.forEach((p) => {
    const c = el("span", "chip", p.name), x = el("button", null, "×");
    x.type = "button"; x.setAttribute("aria-label", "Remove " + p.name);
    x.addEventListener("click", () => removePledge(p));
    c.appendChild(x); ch.appendChild(c);
  });
}

function render() {
  const L = lists();
  renderStats(L); renderGrid(L); renderAdmin(L);
  fillSelect($("pledge"), L.pledges, L.pledges.length ? "Pick your name" : "No pledges yet");
  const saved = remember("pct-pledge");
  if (!$("pledge").value && saved && L.pledges.some((p) => p.id === saved)) $("pledge").value = saved;
  renderMine(L);
}

// ---------- actions ----------
async function setChat(p, b, on) {
  if (busy) return; busy = true;
  try {
    if (on) {
      const { error } = await sb.from("chats").insert({ id: p.id + "__" + b.id, pledge: p.id, other: b.id, logged_by: user.email, ts: Date.now() });
      if (error && error.code !== "23505") throw error;
    } else {
      const { error } = await sb.from("chats").delete().in("id", [p.id + "__" + b.id, b.id + "__" + p.id]);
      if (error) throw error;
    }
    say(on ? "Logged: " + b.name + "." : "Removed " + b.name + ".", "ok");
  } catch (e) { say("Couldn't save that. Try again in a moment.", "err"); }
  await load(); busy = false;
}

async function addPledge(e) {
  e.preventDefault();
  const inp = $("newpledge"), name = inp.value.trim(); if (!name) return;
  const id = "p-" + slug(name);
  if (people.some((x) => x.id === id)) { say("That pledge is already on the list.", "err"); return; }
  const { error } = await sb.from("people").insert({ id, name, role: "pledge" });
  if (error) { say("Couldn't add that pledge.", "err"); return; }
  inp.value = ""; await load();
}

async function removePledge(p) {
  const a = await sb.from("chats").delete().or("pledge.eq." + p.id + ",other.eq." + p.id);
  const b = await sb.from("people").delete().eq("id", p.id);
  if (a.error || b.error) say("Couldn't remove that pledge.", "err");
  await load();
}

$("pledge").addEventListener("change", () => { remember("pct-pledge", $("pledge").value); say(""); render(); });
$("addform").addEventListener("submit", addPledge);
