"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const vm = require("node:vm");
const jsQR = require("../public/vendor/jsQR.js");
const { sha256Hex } = require("../public/question-identity.js");

const root = path.join(__dirname, "..");
const work = path.join(root, `.test-work-${process.pid}`);
const password = "synthetic-test-password";
const legacyKey = form => crypto.createHash("sha256")
  .update(JSON.stringify(form.consent ? [form.questions.map(q => [q.id, q.type, q.options]), form.consent] : form.questions.map(q => [q.id, q.type, q.options])))
  .digest("base64url").slice(0, 8);

function browser(form, answers, oldKey = false) {
  let submit, captured;
  const app = { innerHTML: "" };
  const context = vm.createContext({
    TextEncoder, TextDecoder, Uint8Array, btoa, atob, crypto: crypto.webcrypto,
    document: { getElementById: id => id === "app" ? app : { addEventListener: (event, cb) => { if (event === "submit") submit = cb; } } },
    FormData: class { getAll(name) { return answers[name] || []; } },
    window: { scrollTo() {} }, alert: message => { throw new Error(message); }
  });
  for (const file of ["vendor/qrcode.js", "question-identity.js", "shared.js"]) {
    vm.runInContext(fs.readFileSync(path.join(root, "public", file), "utf8"), context);
  }
  context.form = { ...form, questionKey: oldKey ? legacyKey(form) : form.questionKey };
  const fragment = vm.runInContext("encodeOfflineSurvey(form)", context);
  context.location = { hash: `#${fragment}` };
  context.capture = value => { captured = value; return "<svg></svg>"; };
  vm.runInContext('qrSvg = capture', context);
  vm.runInContext(fs.readFileSync(path.join(root, "public/offline.js"), "utf8"), context);
  assert.ok(submit, "offline form rendered");
  submit({ preventDefault() {}, currentTarget: {} });
  assert.ok(captured, "offline answer QR rendered");

  // Render the actual QR matrix to pixels and decode it with the bundled scanner.
  context.payload = captured;
  const qr = vm.runInContext('makeQr(payload, "L")', context);
  const scale = 4, margin = 4, size = (qr.getModuleCount() + margin * 2) * scale;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < qr.getModuleCount(); y++) for (let x = 0; x < qr.getModuleCount(); x++) {
    if (!qr.isDark(y, x)) continue;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const i = (((y + margin) * scale + dy) * size + (x + margin) * scale + dx) * 4;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
    }
  }
  const decoded = jsQR(pixels, size, size);
  assert.equal(decoded?.data, captured);
  return captured;
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function startServer(port) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: work, env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), ADMIN_PASSWORD: password },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", data => { output += data; });
  child.stderr.on("data", data => { output += data; });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`server exited: ${output}`);
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return child; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  child.kill();
  throw new Error(`server did not start: ${output}`);
}

test("SHA-256 matches Node for Unicode and multiple blocks", () => {
  for (const text of ["", "abc", "한글 👋", "가".repeat(1000)]) {
    assert.equal(sha256Hex(text), crypto.createHash("sha256").update(text).digest("hex"));
  }
});

test("offline QR compatibility, changed content, persistence and existing responses", async t => {
  fs.mkdirSync(work);
  let child;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) { child.kill(); await new Promise(resolve => child.once("exit", resolve)); }
    fs.rmSync(work, { recursive: true, force: true });
  });
  fs.copyFileSync(path.join(root, "server.js"), path.join(work, "server.js"));
  fs.cpSync(path.join(root, "public"), path.join(work, "public"), { recursive: true });
  fs.mkdirSync(path.join(work, "data"));
  const oldForm = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", slug: "aaaaaaaaaaaaaaaa", title: "기존 설문",
    description: "합성 설명", consent: "", status: "published", createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    questions: [{ id: "first", title: "기존 질문", type: "text", required: false, options: [] }]
  };
  const oldResponse = { id: "old-response", formId: oldForm.id, submittedAt: "2020-01-01T00:00:00.000Z", answers: { first: "합성 응답" }, source: "qr", offlineNonce: "old-nonce" };
  fs.writeFileSync(path.join(work, "data/db.json"), JSON.stringify({ forms: [oldForm], responses: [oldResponse] }));
  const port = await unusedPort();
  child = await startServer(port);
  const base = `http://127.0.0.1:${port}`;
  let cookie = "";
  async function api(url, method = "GET", data) {
    const res = await fetch(base + url, {
      method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data ? { "Content-Type": "application/json" } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {})
    });
    if (res.headers.get("set-cookie")) cookie = res.headers.get("set-cookie").split(";")[0];
    return { status: res.status, body: await res.json() };
  }
  assert.equal((await api("/api/login", "POST", { username: "admin", password })).status, 200);
  const scan = payload => api("/api/admin/offline-responses", "POST", { payload });
  const encode = obj => Buffer.from(JSON.stringify(obj)).toString("base64url");
  let old = (await api(`/api/public/forms/${oldForm.slug}`)).body.form;
  const oldAnswer = browser(old, { q0: ["새 합성 응답"] }, true);
  const staleBeforeUpgrade = structuredClone(old);
  staleBeforeUpgrade.questions[0].title = "업그레이드 전에 바뀐 질문";
  assert.equal(legacyKey(staleBeforeUpgrade), legacyKey(old));
  assert.equal((await scan(browser(staleBeforeUpgrade, { q0: ["합성"] }, true))).status, 409);
  assert.equal((await scan(oldAnswer)).status, 201);
  assert.equal((await scan(oldAnswer)).status, 409);
  const unproven = { s: old.slug, k: legacyKey(old), n: "unproven", a: ["합성"] };
  assert.equal((await scan(encode(unproven))).status, 409);
  let results = (await api(`/api/admin/forms/${old.id}/results`)).body;
  assert.deepEqual(results.responses.find(r => r.id === oldResponse.id), oldResponse);
  assert.equal(results.total, 2);
  const locked = await api(`/api/admin/forms/${old.id}`, "PUT", { ...old, questions: [{ ...old.questions[0], title: "잠금 변경" }] });
  assert.equal(locked.body.questionsLocked, true);
  assert.equal(locked.body.form.questions[0].title, old.questions[0].title);
  child.kill();
  await new Promise(resolve => child.once("exit", resolve));
  child = await startServer(port);
  cookie = "";
  await api("/api/login", "POST", { username: "admin", password });
  results = (await api(`/api/admin/forms/${old.id}/results`)).body;
  assert.equal(results.total, 2);
  assert.deepEqual(results.responses.find(r => r.id === oldResponse.id), oldResponse);
  assert.equal((await scan(oldAnswer)).status, 409);

  const initial = {
    title: "합성 설문", description: "합성 설명", consent: "합성 동의",
    questions: [
      { id: "q1", title: "질문 하나", type: "radio", required: false, options: ["예", "아니요"] },
      { id: "q2", title: "질문 둘", type: "text", required: false, options: [] }
    ]
  };
  let unchanged = (await api("/api/admin/forms", "POST", initial)).body.form;
  await api(`/api/admin/forms/${unchanged.id}/status`, "POST", { status: "published" });
  const unchangedQr = browser(unchanged, { q0: ["1"], q1: ["합성 답변"] });
  const unchangedLegacyQr = browser(unchanged, { q0: ["1"], q1: ["합성 답변"] }, true);
  const saved = await api(`/api/admin/forms/${unchanged.id}`, "PUT", unchanged);
  assert.equal(saved.body.form.questionKey, unchanged.questionKey);
  const withoutConsent = JSON.parse(Buffer.from(unchangedQr, "base64url").toString("utf8"));
  delete withoutConsent.c;
  assert.equal((await scan(encode(withoutConsent))).status, 400);
  assert.equal((await scan(unchangedQr)).status, 201);
  assert.equal((await scan(unchangedLegacyQr)).status, 201);
  const unchangedResults = (await api(`/api/admin/forms/${unchanged.id}/results`)).body;
  assert.deepEqual(unchangedResults.responses.map(r => r.answers), [
    { q1: "아니요", q2: "합성 답변" }, { q1: "아니요", q2: "합성 답변" }
  ]);
  assert.ok(unchangedResults.responses.every(r => r.consented === true));
  assert.equal((await api(`/api/public/forms/${unchanged.slug}`, "POST", { consent: true, answers: { q1: "예", q2: "온라인" } })).status, 201);

  const allTypes = {
    title: "유형 검사", description: "", consent: "",
    questions: [
      { id: "text", title: "단답", type: "text", required: true, options: [] },
      { id: "long", title: "장문", type: "textarea", required: false, options: [] },
      { id: "radio", title: "단일", type: "radio", required: true, options: ["가", "나"] },
      { id: "check", title: "복수", type: "checkbox", required: true, options: ["가", "나"] },
      { id: "select", title: "선택", type: "select", required: false, options: ["가", "나"] },
      { id: "rating", title: "점수", type: "rating", required: true, options: [] }
    ]
  };
  let types = (await api("/api/admin/forms", "POST", allTypes)).body.form;
  await api(`/api/admin/forms/${types.id}/status`, "POST", { status: "published" });
  const typesQr = browser(types, { q0: ["단답"], q1: ["장문"], q2: ["1"], q3: ["0", "1"], q4: ["0"], q5: ["5"] });
  const invalid = JSON.parse(Buffer.from(typesQr, "base64url").toString("utf8"));
  invalid.a[2] = 9;
  assert.equal((await scan(encode(invalid))).status, 400);
  await api(`/api/admin/forms/${types.id}/status`, "POST", { status: "closed" });
  assert.equal((await scan(typesQr)).status, 410);
  await api(`/api/admin/forms/${types.id}/status`, "POST", { status: "published" });
  assert.equal((await scan(typesQr)).status, 201);
  assert.deepEqual((await api(`/api/admin/forms/${types.id}/results`)).body.responses[0].answers, {
    text: "단답", long: "장문", radio: "나", check: ["가", "나"], select: "가", rating: "5"
  });
  assert.equal((await api(`/api/admin/forms/${types.id}/responses/delete`, "POST", { all: true })).body.deleted, 1);
  const editedTypes = structuredClone(types);
  editedTypes.questions[0].title = "수정된 단답";
  types = (await api(`/api/admin/forms/${types.id}`, "PUT", editedTypes)).body.form;
  assert.equal(types.questions[0].title, "수정된 단답");
  assert.equal((await scan(typesQr)).status, 409);

  const changes = {
    "question title": f => { f.questions[0].title = "새 질문"; },
    "required": f => { f.questions[0].required = true; },
    "type": f => { f.questions[0].type = "select"; },
    "options": f => { f.questions[0].options.reverse(); },
    "question id": f => { f.questions[0].id = "new-id"; },
    "order": f => { f.questions.reverse(); },
    "addition": f => { f.questions.push({ id: "q3", title: "추가", type: "text", required: false, options: [] }); },
    "deletion": f => { f.questions.pop(); },
    "consent": f => { f.consent = "변경 동의"; },
    "form title": f => { f.title = "변경 설문"; },
    "description": f => { f.description = "변경 설명"; }
  };
  for (const [label, change] of Object.entries(changes)) {
    const created = await api("/api/admin/forms", "POST", initial);
    assert.equal(created.status, 201, label);
    let form = created.body.form;
    await api(`/api/admin/forms/${form.id}/status`, "POST", { status: "published" });
    const currentQr = browser(form, { q0: ["0"], q1: ["합성"] });
    const legacyQr = browser(form, { q0: ["0"], q1: ["합성"] }, true);
    const updated = structuredClone(form);
    change(updated);
    form = (await api(`/api/admin/forms/${form.id}`, "PUT", updated)).body.form;
    assert.equal((await scan(currentQr)).status, 409, `${label} current`);
    assert.equal((await scan(legacyQr)).status, 409, `${label} legacy`);
    assert.equal((await api(`/api/admin/forms/${form.id}/results`)).body.total, 0, label);
    const newAnswers = Object.fromEntries(form.questions.map((q, i) => [`q${i}`, q.type === "radio" || q.type === "select" ? ["0"] : ["합성"]]));
    assert.equal((await scan(browser(form, newAnswers))).status, 201, `${label} new QR`);
  }
});
