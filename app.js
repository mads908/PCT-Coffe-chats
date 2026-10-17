import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase-config.js";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
let people = [], marks = [], logins = [], user = null, myId = null, isAdmin = false, busy = false, channel = null;
const opened = new Set(); // pledges whose history is expanded on the board, kept across re-renders

const PER_DEMERIT = 3, DROP_AT = 3;

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function say(text, kind) { const m = $("msg"); m.textContent = text; m.className = "notice" + (kind ? " " + kind : ""); }

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
// Switch the page to signed out first, then drop the saved session on this device without waiting on the server.
$("signout").onclick = () => { handleSession(null); sb.auth.signOut({ scope: "local" }); };

sb.auth.onAuthStateChange((event, session) => { setTimeout(() => handleSession(session), 0); });

async function handleSession(session) {
  const u = session && session.user ? session.user : null;
  if ((u && user && u.id === user.id) || (!u && !user)) return;
  if (channel) { sb.removeChannel(channel); channel = null; }
  user = u; people = []; marks = []; logins = []; myId = null; isAdmin = false; opened.clear();
  $("app").hidden = !u; $("gate").hidden = !!u; $("userbox").hidden = !u;
  if (!u) { setStep("email", "Enter your Babson email to sign in."); return; }
  $("who").textContent = u.email;
  const [m, me] = await Promise.all([sb.from("marshalls").select("email").eq("email", u.email.toLowerCase()), sb.rpc("my_person")]);
  isAdmin = !!(m.data && m.data.length);
  myId = me.data || null; // the people row this login belongs to, set by the Marshalls in the members table
  await load();
  channel = sb.channel("pct")
    .on("postgres_changes", { event: "*", schema: "public", table: "marks" }, load)
    .on("postgres_changes", { event: "*", schema: "public", table: "people" }, load)
    .subscribe();
}

document.addEventListener("visibilitychange", () => { if (!document.hidden && user) load(); });

async function load() {
  // The database only returns the marks this person may see: everything for brothers, their own for pledges.
  const [p, m, l] = await Promise.all([
    sb.from("people").select("id,name,role"),
    sb.from("marks").select("id,pledge,kind,reason,given_by,created_at").order("created_at", { ascending: false }),
    isAdmin ? sb.from("members").select("email,person_id").order("email") : { data: [] },
  ]);
  if (p.error || m.error || l.error) { say("Couldn't load the list. Try signing out and back in.", "err"); return; }
  people = p.data; marks = m.data; logins = l.data;
  render();
}

// ---------- data helpers ----------
const byName = (x, y) => x.name.localeCompare(y.name);
const pledges = () => people.filter((p) => p.role === "pledge").sort(byName);
const nameOf = (id) => { const p = people.find((x) => x.id === id); return p ? p.name : "a Marshall"; };

// Every 3rd warning becomes a demerit; the leftover warnings count toward the next one.
function standing(pid) {
  const list = marks.filter((m) => m.pledge === pid);
  const w = list.filter((m) => m.kind === "warning").length;
  return { list, warnings: w % PER_DEMERIT, demerits: list.length - w + Math.floor(w / PER_DEMERIT) };
}
function status(s) {
  const plural = (n, word) => n + " " + word + (n === 1 ? "" : "s");
  if (s.demerits >= DROP_AT) return ["Discussion of drop", "bad"];
  if (s.demerits) return [plural(s.demerits, "demerit"), "mid"];
  if (s.warnings) return [plural(s.warnings, "warning"), "mid"];
  return ["Good standing", "ok"];
}

// ---------- rendering ----------
function tile(value, label, tone) { const d = el("div", "tile" + (tone ? " " + tone : "")); d.appendChild(el("span", null, label)); d.appendChild(el("b", null, value)); return d; }

function dots(n, of, kind, label, big) {
  const row = el("span", "pips" + (big ? " lg" : ""));
  row.setAttribute("role", "img"); row.setAttribute("aria-label", label + ": " + n + " of " + of);
  for (let i = 0; i < of; i++) row.appendChild(el("i", i < Math.min(n, of) ? "on " + kind : null));
  return row;
}
function pips(n, of, kind, label) {
  const s = el("span", "meter " + kind);
  s.appendChild(el("small", null, label));
  s.appendChild(dots(n, of, kind, label)); return s;
}

function history(list) {
  if (!list.length) return el("p", "history none", "No warnings or demerits.");
  const ul = el("ul", "history");
  list.forEach((m) => {
    const li = el("li");
    li.appendChild(el("span", "badge " + (m.kind === "warning" ? "mid" : "bad"), m.kind === "warning" ? "Warning" : "Demerit"));
    li.appendChild(el("span", "reason", m.reason));
    const when = new Date(m.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    li.appendChild(el("span", "meta", "from " + nameOf(m.given_by) + " · " + when));
    if (isAdmin || (m.given_by && m.given_by === myId)) {
      const x = el("button", "link", "Remove"); x.type = "button";
      x.addEventListener("click", () => removeMark(m));
      li.appendChild(x);
    }
    ul.appendChild(li);
  });
  return ul;
}

function renderMine(me) {
  const box = $("minebody"); box.textContent = "";
  const s = standing(me.id), [text, kind] = status(s);
  const top = el("div", "standing-top");
  top.appendChild(el("p", "hint", "Every " + PER_DEMERIT + " warnings become a demerit."));
  top.appendChild(el("span", "badge " + kind, text));
  box.appendChild(top);
  const meters = el("div", "meters");
  [["Demerits", s.demerits, DROP_AT, "d"], ["Warnings toward next demerit", s.warnings, PER_DEMERIT, "w"]].forEach(([label, n, of, k]) => {
    const m = el("div", "meterbox");
    m.appendChild(el("span", null, label));
    m.appendChild(dots(n, of, k, label, true));
    m.appendChild(el("b", null, n + " of " + of));
    meters.appendChild(m);
  });
  box.appendChild(meters);
  box.appendChild(el("h3", "section-label", "History"));
  box.appendChild(history(s.list));
}

function renderStats(P) {
  const s = $("stats"), st = P.map((p) => standing(p.id)); s.textContent = "";
  const mid = st.filter((x) => x.demerits > 0 && x.demerits < DROP_AT).length, bad = st.filter((x) => x.demerits >= DROP_AT).length;
  s.appendChild(tile(String(P.length), "Pledges"));
  s.appendChild(tile(String(mid), "With demerits", mid ? "mid" : null));
  s.appendChild(tile(String(bad), "Discussion of drop", bad ? "bad" : null));
}

function renderBoard(P) {
  const b = $("board"); b.textContent = "";
  if (!P.length) { b.appendChild(el("div", "empty", "No pledges yet.")); return; }
  const head = el("div", "board-head");
  ["Pledge", "Warnings", "Demerits", "Status"].forEach((t) => head.appendChild(el("span", null, t)));
  b.appendChild(head);
  P.forEach((p) => {
    const s = standing(p.id), [text, kind] = status(s), d = el("details"), sm = el("summary");
    d.open = opened.has(p.id);
    d.addEventListener("toggle", () => { if (d.open) opened.add(p.id); else opened.delete(p.id); });
    sm.appendChild(el("span", "pname", p.name));
    sm.appendChild(pips(s.warnings, PER_DEMERIT, "w", "Warnings"));
    sm.appendChild(pips(s.demerits, DROP_AT, "d", "Demerits"));
    sm.appendChild(el("span", "badge " + kind, text));
    const body = el("div", "detail"); body.appendChild(history(s.list));
    d.appendChild(sm); d.appendChild(body); b.appendChild(d);
  });
}

function fillSelect(sel, items, placeholder) {
  const cur = sel.value; sel.textContent = "";
  const o = el("option", null, placeholder); o.value = ""; sel.appendChild(o);
  items.forEach((i) => { const op = el("option", null, i.name); op.value = i.id; sel.appendChild(op); });
  if (items.some((i) => i.id === cur)) sel.value = cur;
}

function listRow(title, detail, label, onRemove) {
  const li = el("li"), main = el("span", "main"), x = el("button", "link", "Remove");
  main.appendChild(el("b", null, title)); if (detail) main.appendChild(el("span", null, detail));
  x.type = "button"; x.setAttribute("aria-label", label);
  x.addEventListener("click", onRemove);
  li.appendChild(main); li.appendChild(x); return li;
}

function renderAdmin(P) {
  $("adminpanel").hidden = !isAdmin; $("givedemerit").hidden = !isAdmin;
  if (!isAdmin) return;
  const ch = $("chips"); ch.textContent = "";
  P.forEach((p) => ch.appendChild(listRow(p.name, null, "Remove " + p.name, () => removePledge(p))));
  $("pledgecount").textContent = P.length;
  fillSelect($("loginperson"), people.slice().sort(byName), "Who is this?");
  const lg = $("logins"); lg.textContent = "";
  const named = logins.map((l) => ({ l, name: l.person_id ? nameOf(l.person_id) : "Not linked" })).sort((a, b) => a.name.localeCompare(b.name));
  named.forEach(({ l, name }) => lg.appendChild(listRow(name, l.email, "Remove login " + l.email, () => removeLogin(l))));
  $("logincount").textContent = logins.length;
}

function render() {
  const P = pledges(), me = people.find((p) => p.id === myId);
  const isBrother = isAdmin || !!(me && me.role === "brother");
  const who = $("who"); who.textContent = "";
  if (me) who.appendChild(el("b", null, me.name));
  who.appendChild(document.createTextNode(user.email));
  $("mine").hidden = !(me && me.role === "pledge");
  $("brotherview").hidden = !isBrother;
  if (me && me.role === "pledge") renderMine(me);
  if (isBrother) { renderStats(P); renderBoard(P); fillSelect($("givepledge"), P, "Pick a pledge"); }
  renderAdmin(P);
  if (!me && !isAdmin) say("Your login isn't linked to a name yet. Ask a Marshall to set it up.", "err");
}

// ---------- actions ----------
async function give(kind) {
  const pid = $("givepledge").value, reason = $("reason").value.trim();
  if (!pid || !reason) { say("Pick a pledge and write a reason.", "err"); return; }
  if (busy) return; busy = true;
  const before = standing(pid).demerits, name = nameOf(pid);
  const { error } = await sb.from("marks").insert({ pledge: pid, kind, reason });
  if (error) say("Couldn't save that. Try again in a moment.", "err");
  else {
    $("reason").value = "";
    await load();
    const d = standing(pid).demerits;
    let text = (kind === "warning" ? "Warning" : "Demerit") + " given to " + name + ".";
    if (d > before) text += " " + name + " now has " + d + " of " + DROP_AT + " demerits" + (d >= DROP_AT ? ". Time for a discussion of drop." : ".");
    say(text, d >= DROP_AT ? "err" : "ok");
  }
  busy = false;
}

async function removeMark(m) {
  if (!confirm("Remove this " + m.kind + " for " + nameOf(m.pledge) + "?\n\n" + m.reason)) return;
  const { error } = await sb.from("marks").delete().eq("id", m.id);
  say(error ? "Couldn't remove that." : "Removed.", error ? "err" : "ok");
  await load();
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
  if (!confirm("Remove " + p.name + " and all their warnings and demerits?")) return;
  const { error } = await sb.from("people").delete().eq("id", p.id); // their marks go with them
  if (error) say("Couldn't remove that pledge.", "err");
  await load();
}

async function addLogin(e) {
  e.preventDefault();
  const email = $("loginemail").value.trim().toLowerCase(), person_id = $("loginperson").value || null;
  if (!email) return;
  const { error } = await sb.from("members").upsert({ email, person_id });
  if (error) { say("Couldn't add that login.", "err"); return; }
  $("loginemail").value = ""; say(email + " can now sign in.", "ok");
  await load();
}

async function removeLogin(l) {
  if (!confirm("Stop " + l.email + " from signing in?")) return;
  const { error } = await sb.from("members").delete().eq("email", l.email);
  if (error) say("Couldn't remove that login.", "err");
  await load();
}

$("giveform").addEventListener("submit", (e) => { e.preventDefault(); give("warning"); });
$("givedemerit").addEventListener("click", () => give("demerit"));
$("addform").addEventListener("submit", addPledge);
$("loginform").addEventListener("submit", addLogin);
