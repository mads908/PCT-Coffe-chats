import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase-config.js";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
let people = [], chats = {}, user = null, myId = null, isAdmin = false, busy = false, channel = null;

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";
const short = (n) => { const p = n.trim().split(/\s+/); return p.length > 1 ? p[0] + " " + p[p.length - 1][0] + "." : p[0]; };
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function say(text, kind) { const m = $("msg"); m.textContent = text; m.className = "msg" + (kind ? " " + kind : ""); }

// ---------- auth ----------
// Only emails in the members/marshalls tables can get in; the database enforces that.
// The email step asks the server whether the email is new, so first-timers choose a password.
const MIN_PW = 8;
let step = "email";
function setStep(s, text) {
  step = s;
  $("pwfield").hidden = s === "email"; $("pw2field").hidden = s !== "create"; $("back").hidden = s === "email";
  $("email").readOnly = s !== "email";
  $("pwlabel").textContent = s === "create" ? "Choose a password (" + MIN_PW + "+ characters)" : "Password";
  $("password").autocomplete = s === "create" ? "new-password" : "current-password";
  $("authbtn").textContent = s === "email" ? "Continue" : s === "create" ? "Create account" : "Sign in";
  $("password").value = ""; $("password2").value = "";
  $("authmsg").textContent = text;
  if (s !== "email") $("password").focus();
}

$("authform").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const email = $("email").value.trim().toLowerCase(), password = $("password").value, m = $("authmsg");
  $("authbtn").disabled = true;
  try {
    if (step === "email") {
      const { data, error } = await sb.rpc("login_status", { p_email: email });
      if (error) m.textContent = "Couldn't check that email. Try again in a moment.";
      else if (data === "existing") setStep("signin", "Welcome back. Enter your password.");
      else if (data === "new") setStep("create", "First time here. Choose a password you'll use every time you sign in.");
      else m.textContent = "That email isn't on the list. Use your Babson email, or ask a Marshall to add you.";
    } else if (step === "signin") {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) m.textContent = "Wrong password. If you forgot it, ask a Marshall to reset your account.";
    } else if (password.length < MIN_PW) {
      m.textContent = "Use at least " + MIN_PW + " characters.";
    } else if (password !== $("password2").value) {
      m.textContent = "The two passwords don't match.";
    } else {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) m.textContent = /registered|exists/i.test(error.message) ? "This email already has an account. Go back and sign in." : "Couldn't create your account. Try again in a moment.";
      else if (!data.session) m.textContent = "Setup problem. Tell a Marshall that email confirmation is still turned on.";
    }
  } finally { $("authbtn").disabled = false; }
});
$("back").onclick = () => setStep("email", "Enter your Babson email to sign in.");
$("signout").onclick = () => sb.auth.signOut();

sb.auth.onAuthStateChange((event, session) => { setTimeout(() => handleSession(session), 0); });

async function handleSession(session) {
  const u = session && session.user ? session.user : null;
  if ((u && user && u.id === user.id) || (!u && !user)) return;
  if (channel) { sb.removeChannel(channel); channel = null; }
  user = u; people = []; chats = {}; myId = null; isAdmin = false;
  $("app").hidden = !u; $("gate").hidden = !!u; $("userbox").hidden = !u;
  if (!u) { setStep("email", "Enter your Babson email to sign in."); return; }
  $("who").textContent = u.email;
  const [m, me] = await Promise.all([sb.from("marshalls").select("email").eq("email", u.email.toLowerCase()), sb.rpc("my_person")]);
  isAdmin = !!(m.data && m.data.length);
  myId = me.data || null; // the people row this login belongs to, set by the Marshalls in the members table
  await load();
  channel = sb.channel("pct")
    .on("postgres_changes", { event: "*", schema: "public", table: "chats" }, load)
    .on("postgres_changes", { event: "*", schema: "public", table: "people" }, load)
    .subscribe();
}

document.addEventListener("visibilitychange", () => { if (!document.hidden && user) load(); });

async function load() {
  const [p, c] = await Promise.all([sb.from("people").select("id,name,role"), sb.from("chats").select("id")]);
  if (p.error || c.error) { say("Couldn't load the list. Try signing out and back in.", "err"); return; }
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
  const me = people.find((p) => p.id === myId);
  if (!me) { box.appendChild(el("p", "msg", "Your login isn't linked to a name yet. Ask a Marshall to set it up.")); return; }
  // Pledges meet everyone; brothers meet the pledges.
  const others = me.role === "pledge" ? L.cols.filter((b) => b.id !== me.id) : L.pledges;
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
  renderStats(L); renderGrid(L); renderAdmin(L); renderMine(L);
  const me = people.find((p) => p.id === myId);
  $("who").textContent = me ? me.name + " · " + user.email : user.email;
}

// ---------- actions ----------
async function setChat(p, b, on) {
  if (busy) return; busy = true;
  const name = b.name;
  if (p.role !== "pledge") [p, b] = [b, p]; // a brother logging a chat: the pledge goes first in the id
  try {
    if (on) {
      const { error } = await sb.from("chats").insert({ id: p.id + "__" + b.id, pledge: p.id, other: b.id, logged_by: user.email, ts: Date.now() });
      if (error && error.code !== "23505") throw error;
    } else {
      const { error } = await sb.from("chats").delete().in("id", [p.id + "__" + b.id, b.id + "__" + p.id]);
      if (error) throw error;
    }
    say(on ? "Logged: " + name + "." : "Removed " + name + ".", "ok");
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

$("addform").addEventListener("submit", addPledge);
