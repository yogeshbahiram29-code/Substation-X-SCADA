import test from "node:test";
import assert from "node:assert/strict";
import { DOC_TYPES, ValidationError, buildUserMessage } from "../src/prompt.js";
import { textToDocx } from "../src/docx.js";

const TODAY = "12 November 2026";

test("a new draft carries the form, the profile and today's date", () => {
  const message = buildUserMessage(
    {
      form: { docType: "shutdown", recipient: "The SE, O&M Circle", points: "Feeder-4, Sunday 10:00 to 14:00", tone: "firm", language: "Marathi" },
      profile: { name: "A. B. Patil", designation: "Assistant Engineer" },
    },
    TODAY,
  );
  assert.match(message, /^Draft the following document\./);
  assert.ok(message.includes(`<document_type>${DOC_TYPES.shutdown.label}</document_type>`));
  assert.ok(message.includes("<today>12 November 2026</today>"));
  assert.ok(message.includes("<language>Marathi</language>"));
  assert.ok(message.includes("<tone>Firm and urgent"));
  assert.ok(message.includes("<sender>\nName: A. B. Patil\nDesignation: Assistant Engineer\n</sender>"));
  assert.ok(message.includes("<recipient>\nThe SE, O&M Circle\n</recipient>"));
  assert.ok(message.includes("<key_points>\nFeeder-4, Sunday 10:00 to 14:00\n</key_points>"));
  assert.ok(!message.includes("<subject>"), "empty fields are left out");
});

test("unknown options fall back to the defaults", () => {
  const message = buildUserMessage({ form: { docType: "nonsense", tone: "__proto__", length: "huge", points: "x" } }, TODAY);
  assert.ok(message.includes("<document_type>Official letter</document_type>"));
  assert.ok(message.includes("<tone>Formal and neutral"));
  assert.ok(message.includes("<length>Standard."));
  assert.ok(message.includes("<language>English</language>"));
});

test("a revision includes the current draft and the requested change", () => {
  const message = buildUserMessage(
    { form: { docType: "email", points: "send audit data" }, currentDraft: "Subject: Audit data\n\nDear Sir,", instruction: "Make it shorter" },
    TODAY,
  );
  assert.match(message, /^Revise the draft below\./);
  assert.ok(message.includes("<current_draft>\nSubject: Audit data\n\nDear Sir,\n</current_draft>"));
  assert.ok(message.includes("<revision_request>\nMake it shorter\n</revision_request>"));
});

test("requests that cannot be drafted are rejected with a readable message", () => {
  assert.throws(() => buildUserMessage({ form: { points: "   " } }), ValidationError);
  assert.throws(() => buildUserMessage({}), ValidationError);
  assert.throws(() => buildUserMessage({ form: { points: 42 } }), /Key points must be text/);
  assert.throws(() => buildUserMessage({ form: { points: "x" }, instruction: "shorter" }), /there must be a draft/);
  assert.throws(() => buildUserMessage({ form: { points: "a".repeat(20001) } }), /Key points is too long/);
});

test("background text alone is enough to draft from", () => {
  const message = buildUserMessage({ form: { docType: "reply", background: "Your office is requested to confirm the date." } }, TODAY);
  assert.ok(message.includes("<background_text>\nYour office is requested to confirm the date.\n</background_text>"));
});

test("Word export produces a .docx file", async () => {
  const buffer = await textToDocx("To,\nThe Executive Engineer\n\nविषय: परीक्षण");
  assert.equal(buffer.subarray(0, 2).toString(), "PK", "a .docx is a zip archive");
  assert.ok(buffer.length > 2000);
});
