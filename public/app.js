// Browser side of the Office Draft Assistant.

const PROFILE_KEY = "oda.profile";
const PREFS_KEY = "oda.prefs";
const HISTORY_KEY = "oda.history";
const HISTORY_MAX = 30;
const BLANK_PATTERN = /\[[^[\]\n]{1,60}\]/g;

const $ = (id) => document.getElementById(id);

const form = $("draft-form");
const docTypeEl = $("docType");
const pointsEl = $("points");
const backgroundBox = $("background-box");
const draftEl = $("draft");
const statusEl = $("status");
const instructionEl = $("instruction");
const undoBtn = $("undo");
const stopBtn = $("stop");
const blanksEl = $("blanks");
const profileDialog = $("profile-dialog");
const historyDialog = $("history-dialog");

const FORM_FIELDS = ["docType", "recipient", "subject", "reference", "points", "background", "tone", "length", "language"];
const PREF_FIELDS = ["docType", "tone", "length", "language"];

let docTypes = [];
let busy = false;
let controller = null;
let previousDraft = null; // what the draft was before the last revision, for Undo
let currentId = null; // history entry the draft on screen belongs to
let saveTimer = null;

// ---------- Browser storage (may be unavailable in private windows) ----------

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full or blocked: the app still works, it just won't remember.
    }
  },
};

// ---------- Form ----------

function readForm() {
  const values = {};
  for (const name of FORM_FIELDS) values[name] = $(name).value.trim();
  return values;
}

function fillForm(values) {
  for (const name of FORM_FIELDS) {
    if (typeof values?.[name] === "string") $(name).value = values[name];
  }
  if (!docTypeEl.value && docTypes.length) docTypeEl.value = docTypes[0].id;
  onDocTypeChange();
}

function onDocTypeChange() {
  const type = docTypes.find((t) => t.id === docTypeEl.value);
  pointsEl.placeholder = type?.hint ?? "";
  if (docTypeEl.value === "reply") backgroundBox.open = true;
}

function savePrefs() {
  const prefs = {};
  for (const name of PREF_FIELDS) prefs[name] = $(name).value.trim();
  store.set(PREFS_KEY, prefs);
}

// ---------- Status and button states ----------

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`.trim();
}

function refresh() {
  const hasDraft = draftEl.value.trim().length > 0;
  const ready = hasDraft && !busy;
  for (const id of ["copy", "download", "print", "revise"]) $(id).disabled = !ready;
  instructionEl.disabled = !ready;
  for (const chip of document.querySelectorAll(".chip")) chip.disabled = !ready;
  $("generate").disabled = busy;
  draftEl.readOnly = busy;
  stopBtn.hidden = !busy;
  undoBtn.hidden = busy || previousDraft === null;
  refreshBlanks();
}

function findBlanks() {
  return [...draftEl.value.matchAll(BLANK_PATTERN)];
}

function refreshBlanks() {
  const blanks = busy ? [] : findBlanks();
  blanksEl.hidden = blanks.length === 0;
  if (!blanks.length) return;
  const names = [...new Set(blanks.map((m) => m[0]))];
  const shown = names.slice(0, 4).join(", ");
  const more = names.length > 4 ? ` and ${names.length - 4} more` : "";
  const count = blanks.length === 1 ? "1 detail" : `${blanks.length} details`;
  $("blanks-text").textContent = `${count} in [brackets] still to fill in: ${shown}${more}`;
}

function goToNextBlank() {
  const blanks = findBlanks();
  if (!blanks.length) return;
  const from = draftEl.selectionEnd ?? 0;
  const next = blanks.find((m) => m.index >= from) ?? blanks[0];
  const start = next.index;
  const end = start + next[0].length;
  // Collapsing the selection and refocusing makes the browser scroll the blank into view.
  draftEl.focus();
  draftEl.setSelectionRange(start, start);
  draftEl.blur();
  draftEl.focus();
  draftEl.setSelectionRange(start, end);
}

// ---------- Talking to the server ----------

/**
 * Sends the request and feeds text to onText as it arrives.
 * Resolves with the final event ({type: "done"} or {type: "error"}).
 */
async function streamDraft(payload, signal, onText) {
  let response;
  try {
    response = await fetch("api/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new Error("Could not reach the app. Check that it is still running, then try again.");
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `The app returned an error (${response.status}).`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (!line.startsWith("data: ")) continue;
      const event = JSON.parse(line.slice(6));
      if (event.type === "delta") onText(event.text);
      else return event;
    }
  }
  return { type: "error", message: "The connection dropped before the draft was finished. Please try again." };
}

async function run(instruction) {
  if (busy) return;
  const values = readForm();
  const isRevision = instruction !== undefined;

  if (!isRevision && !values.points && !values.background) {
    pointsEl.closest(".field").classList.add("invalid");
    setStatus("Type the key points first, then press Generate.", "error");
    pointsEl.focus();
    return;
  }

  flushPendingSave();
  const before = draftEl.value;
  const payload = { form: values, profile: store.get(PROFILE_KEY, {}) };
  if (isRevision) {
    payload.currentDraft = before;
    payload.instruction = instruction;
  } else {
    // The box is about to hold a different document, so cut its tie to the saved one.
    currentId = null;
    previousDraft = null;
  }

  busy = true;
  controller = new AbortController();
  draftEl.value = "";
  setStatus(isRevision ? "Revising the draft…" : "Writing your draft…", "busy");
  refresh();

  let result;
  try {
    result = await streamDraft(payload, controller.signal, (text) => {
      const atBottom = draftEl.scrollHeight - draftEl.scrollTop - draftEl.clientHeight < 40;
      draftEl.value += text;
      if (atBottom) draftEl.scrollTop = draftEl.scrollHeight;
    });
  } catch (err) {
    result = err.name === "AbortError" ? { type: "stopped" } : { type: "error", message: err.message };
  }

  busy = false;
  controller = null;
  const text = draftEl.value.trim();
  const succeeded = result.type === "done" && text.length > 0;

  if (succeeded) {
    draftEl.value = text;
    draftEl.scrollTop = 0; // finished: start reading from the top
    if (isRevision) {
      previousDraft = before;
      instructionEl.value = "";
    }
    saveToHistory(values);
    setStatus(
      result.truncated
        ? "The draft was cut off because it grew too long. Ask for a shorter version."
        : "Draft ready. Read it through and check the details before sending.",
      result.truncated ? "error" : "",
    );
  } else {
    // A half-finished revision is worth less than the complete draft it replaced.
    if (isRevision) draftEl.value = before;
    else draftEl.value = text;
    if (result.type === "stopped") setStatus("Stopped.");
    else setStatus(result.message || "No text came back. Please try again.", "error");
  }
  refresh();
}

// ---------- Recent drafts ----------

function titleFor(values, text) {
  if (values.subject) return values.subject;
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const subjectLine = lines.find((line) => /^(subject|sub|विषय)\s*[:\-–.]/i.test(line));
  const title = subjectLine ? subjectLine.replace(/^[^:\-–.]+[:\-–.]\s*/, "") : lines[0] || "Untitled draft";
  return title.slice(0, 90);
}

/**
 * Saves the draft on screen. Pass the form values when the draft was just
 * generated from them; leave them out for hand edits, which keep the details
 * the entry was first written from.
 */
function saveToHistory(values) {
  const text = draftEl.value.trim();
  if (!text) return;
  const history = store.get(HISTORY_KEY, []);
  let entry = history.find((e) => e.id === currentId);
  if (!entry) {
    currentId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    entry = { id: currentId };
    history.push(entry);
  }
  const details = values ?? entry.form ?? readForm();
  Object.assign(entry, {
    text,
    form: details,
    typeLabel: docTypes.find((t) => t.id === details.docType)?.label ?? "Document",
    title: titleFor(details, text),
    savedAt: Date.now(),
  });
  history.sort((a, b) => b.savedAt - a.savedAt);
  store.set(HISTORY_KEY, history.slice(0, HISTORY_MAX));
}

/** Writes any hand edit still waiting on the timer, before the box changes to something else. */
function flushPendingSave() {
  if (saveTimer === null) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  saveToHistory();
}

function renderHistory() {
  const history = store.get(HISTORY_KEY, []);
  const list = $("history-list");
  list.replaceChildren();
  $("history-empty").hidden = history.length > 0;
  $("clear-history").hidden = history.length === 0;

  for (const entry of history) {
    const when = new Date(entry.savedAt).toLocaleString("en-IN", {
      day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
    });
    const item = document.createElement("li");
    item.className = "history-item";

    const open = document.createElement("button");
    open.type = "button";
    open.className = "history-open";
    const title = document.createElement("strong");
    title.textContent = entry.title;
    const meta = document.createElement("span");
    meta.textContent = `${entry.typeLabel} · ${when}`;
    open.append(title, meta);
    open.addEventListener("click", () => {
      if (busy) return;
      flushPendingSave();
      fillForm(entry.form);
      draftEl.value = entry.text;
      currentId = entry.id;
      previousDraft = null;
      setStatus("Loaded from recent drafts.");
      refresh();
      historyDialog.close();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "history-delete";
    remove.textContent = "Delete";
    remove.setAttribute("aria-label", `Delete draft: ${entry.title}`);
    remove.addEventListener("click", () => {
      store.set(HISTORY_KEY, store.get(HISTORY_KEY, []).filter((e) => e.id !== entry.id));
      if (currentId === entry.id) currentId = null;
      renderHistory();
    });

    item.append(open, remove);
    list.append(item);
  }
}

// ---------- Copy, download, print ----------

async function copyDraft() {
  const text = draftEl.value;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // The clipboard API needs https or localhost; fall back for plain http on the office network.
    draftEl.focus();
    draftEl.select();
    document.execCommand("copy");
  }
  setStatus("Copied. Paste it into your email or Word document.");
}

function fileName() {
  const title = titleFor(readForm(), draftEl.value)
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  const date = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD
  return `${title || "draft"}-${date}.docx`;
}

async function downloadWord() {
  setStatus("Preparing the Word file…", "busy");
  try {
    const response = await fetch("api/export/docx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: draftEl.value }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "The Word file could not be created.");
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName();
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setStatus("Word file downloaded.");
  } catch (err) {
    setStatus(err instanceof TypeError ? "Could not reach the app. Check that it is still running." : err.message, "error");
  }
}

function printDraft() {
  $("print-area").textContent = draftEl.value;
  window.print();
}

// ---------- Dialogs ----------

function wireDialog(dialog) {
  for (const button of dialog.querySelectorAll("[data-close]")) {
    button.addEventListener("click", () => dialog.close());
  }
  // A click on the dimmed area outside the box closes it.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

function openProfile() {
  const profile = store.get(PROFILE_KEY, {});
  for (const field of $("profile-form").elements) {
    if (field.name) field.value = profile[field.name] ?? "";
  }
  profileDialog.showModal();
}

function saveProfile() {
  const profile = {};
  for (const field of $("profile-form").elements) {
    if (field.name) profile[field.name] = field.value.trim();
  }
  store.set(PROFILE_KEY, profile);
  setStatus("Office profile saved. It will be used in new drafts.");
}

// ---------- Start-up ----------

async function loadConfig() {
  try {
    const response = await fetch("api/config");
    const config = await response.json();
    docTypes = config.docTypes;
    $("key-banner").hidden = config.hasKey;
  } catch {
    setStatus("Could not reach the app. Check that it is still running, then reload this page.", "error");
    return;
  }
  for (const type of docTypes) docTypeEl.append(new Option(type.label, type.id));
  fillForm(store.get(PREFS_KEY, {}));
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  run();
});

pointsEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    run();
  }
});

pointsEl.addEventListener("input", () => pointsEl.closest(".field").classList.remove("invalid"));

docTypeEl.addEventListener("change", onDocTypeChange);
for (const name of PREF_FIELDS) $(name).addEventListener("change", savePrefs);

$("clear-form").addEventListener("click", () => {
  for (const name of ["recipient", "subject", "reference", "points", "background"]) $(name).value = "";
  pointsEl.closest(".field").classList.remove("invalid");
  pointsEl.focus();
});

$("revise-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const instruction = instructionEl.value.trim();
  if (instruction) run(instruction);
  else instructionEl.focus();
});

for (const chip of document.querySelectorAll(".chip")) {
  chip.addEventListener("click", () => run(chip.textContent.trim()));
}

stopBtn.addEventListener("click", () => controller?.abort());

undoBtn.addEventListener("click", () => {
  if (previousDraft === null) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  draftEl.value = previousDraft;
  previousDraft = null;
  saveToHistory();
  setStatus("Change undone.");
  refresh();
});

draftEl.addEventListener("input", () => {
  refresh();
  // Keep hand edits in Recent drafts without writing to storage on every keystroke.
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveToHistory();
  }, 800);
});

$("copy").addEventListener("click", copyDraft);
$("download").addEventListener("click", downloadWord);
$("print").addEventListener("click", printDraft);
$("next-blank").addEventListener("click", goToNextBlank);

wireDialog(profileDialog);
wireDialog(historyDialog);
$("open-profile").addEventListener("click", openProfile);
$("profile-form").addEventListener("submit", saveProfile);
$("open-history").addEventListener("click", () => {
  renderHistory();
  historyDialog.showModal();
});
$("clear-history").addEventListener("click", () => {
  if (!confirm("Delete all saved drafts from this browser?")) return;
  store.set(HISTORY_KEY, []);
  currentId = null;
  renderHistory();
});

refresh();
loadConfig();
