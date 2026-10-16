"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-this-password";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ forms: [], responses: [] }, null, 2));
}

function readDb() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    if (!Array.isArray(parsed.forms) || !Array.isArray(parsed.responses)) throw new Error("Invalid database shape");
    return parsed;
  } catch (err) {
    throw new Error("Database file is invalid. Back up data/db.json and restore a valid copy. " + err.message);
  }
}

function writeDb(db) {
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DB_FILE);
}

function send(res, status, payload, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" });
  res.end(text);
}

function parseCookies(header = "") {
  const result = {};
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=");
    if (idx > 0) result[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  }
  return result;
}

function getSession(req) {
  const sid = parseCookies(req.headers.cookie).sid;
  const session = sid && sessions.get(sid);
  if (!session || session.expires < Date.now()) {
    if (sid) sessions.delete(sid);
    return null;
  }
  session.expires = Date.now() + SESSION_TTL_MS;
  return session;
}

function requireAdmin(req, res) {
  if (!getSession(req)) {
    send(res, 401, { error: "관리자 로그인이 필요합니다." });
    return false;
  }
  return true;
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (Buffer.byteLength(data) > limit) {
        reject(new Error("요청 본문이 너무 큽니다."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); }
      catch { reject(new Error("JSON 형식이 올바르지 않습니다.")); }
    });
    req.on("error", reject);
  });
}

function cleanString(value, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeQuestions(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 100).map((q, i) => {
    const type = ["text", "textarea", "radio", "checkbox", "select", "rating"].includes(q.type) ? q.type : "text";
    const options = Array.isArray(q.options) ? q.options.map(v => cleanString(v, 200)).filter(Boolean).slice(0, 50) : [];
    return {
      id: cleanString(q.id, 80) || crypto.randomUUID(),
      title: cleanString(q.title, 300) || `질문 ${i + 1}`,
      type,
      required: Boolean(q.required),
      options: ["radio", "checkbox", "select"].includes(type) ? options : []
    };
  });
}

function validateAnswers(form, answers) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return "응답 데이터 형식이 올바르지 않습니다.";
  for (const q of form.questions) {
    const value = answers[q.id];
    const empty = value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
    if (q.required && empty) return `필수 질문에 응답해 주세요: ${q.title}`;
    if (empty) continue;
    if (["radio", "select"].includes(q.type) && !q.options.includes(String(value))) return `선택지가 올바르지 않습니다: ${q.title}`;
    if (q.type === "checkbox" && (!Array.isArray(value) || value.some(v => !q.options.includes(String(v))))) return `선택지가 올바르지 않습니다: ${q.title}`;
    if (["text", "textarea", "rating"].includes(q.type) && typeof value !== "string" && typeof value !== "number") return `응답 형식이 올바르지 않습니다: ${q.title}`;
    if (typeof value === "string" && value.length > 5000) return "응답은 질문당 5,000자 이하여야 합니다.";
  }
  return null;
}

// Changes whenever answers would map differently (question ids, types, options), so an offline answer QR
// made from an older version of the survey is rejected instead of being stored against the wrong questions.
function questionKey(form) {
  return crypto.createHash("sha256").update(JSON.stringify(form.questions.map(q => [q.id, q.type, q.options]))).digest("base64url").slice(0, 8);
}

function publicForm(form) {
  return { id: form.id, slug: form.slug, title: form.title, description: form.description, questions: form.questions, questionKey: questionKey(form), status: form.status, createdAt: form.createdAt, updatedAt: form.updatedAt };
}

// Offline answer QR payload: base64url JSON { s: slug, k: questionKey, n: nonce, a: [answer per question] }.
// Choice answers are option indexes; they are mapped back to option text here.
function offlineAnswers(form, a) {
  const answers = {};
  for (const [i, q] of form.questions.entries()) {
    const v = a[i];
    const empty = v === null || v === undefined;
    if (q.type === "checkbox") {
      if (!empty && (!Array.isArray(v) || v.some(x => !Number.isInteger(x) || !q.options[x]))) return null;
      answers[q.id] = empty ? [] : v.map(x => q.options[x]);
    } else if (["radio", "select"].includes(q.type)) {
      if (!empty && (!Number.isInteger(v) || !q.options[v])) return null;
      answers[q.id] = empty ? "" : q.options[v];
    } else if (q.type === "rating") {
      if (!empty && ![1, 2, 3, 4, 5].includes(v)) return null;
      answers[q.id] = empty ? "" : String(v);
    } else {
      if (!empty && typeof v !== "string") return null;
      answers[q.id] = empty ? "" : v;
    }
  }
  return answers;
}

function lanAddress() {
  const virtual = /vEthernet|VirtualBox|VMware|WSL|Hyper-V|Loopback|docker|Tailscale|ZeroTier/i;
  const found = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === "IPv4" && !a.internal && !a.address.startsWith("169.254.")) found.push({ name, address: a.address });
    }
  }
  return (found.find(a => !virtual.test(a.name)) || found[0])?.address || null;
}

function shareInfo() {
  const host = ["0.0.0.0", "::"].includes(HOST) ? lanAddress() : HOST;
  const localOnly = !host || ["127.0.0.1", "localhost", "::1"].includes(host);
  return { baseUrl: `http://${localOnly ? "127.0.0.1" : host}:${PORT}`, localOnly };
}

function serveStatic(req, res, pathname) {
  const mapped = pathname === "/" || /^\/(f|edit|results)\/[a-f0-9-]+$/.test(pathname) ? "/index.html" : pathname;
  const file = path.resolve(PUBLIC_DIR, "." + decodeURIComponent(mapped));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendText(res, 403, "Forbidden");
  fs.readFile(file, (err, data) => {
    if (err) return sendText(res, 404, "Not found");
    const ext = path.extname(file).toLowerCase();
    const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };
    res.writeHead(200, {
      "Content-Type": types[ext] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'",
      "Referrer-Policy": "same-origin"
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const p = url.pathname;
  const method = req.method || "GET";

  try {
    if (method === "POST" && p === "/api/login") {
      const body = await readBody(req, 10000);
      const userOk = cleanString(body.username, 100) === ADMIN_USER;
      const pass = typeof body.password === "string" ? body.password : "";
      const passOk = crypto.timingSafeEqual(
        Buffer.from(crypto.createHash("sha256").update(pass).digest("hex")),
        Buffer.from(crypto.createHash("sha256").update(ADMIN_PASSWORD).digest("hex"))
      );
      if (!userOk || !passOk) return send(res, 401, { error: "아이디 또는 비밀번호가 올바르지 않습니다." });
      const sid = crypto.randomBytes(32).toString("hex");
      sessions.set(sid, { user: ADMIN_USER, expires: Date.now() + SESSION_TTL_MS });
      return send(res, 200, { ok: true, username: ADMIN_USER }, { "Set-Cookie": `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800` });
    }

    if (method === "POST" && p === "/api/logout") {
      const sid = parseCookies(req.headers.cookie).sid;
      if (sid) sessions.delete(sid);
      return send(res, 200, { ok: true }, { "Set-Cookie": "sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });
    }

    if (method === "GET" && p === "/api/session") {
      const session = getSession(req);
      return send(res, 200, { authenticated: Boolean(session), username: session?.user || null, share: session ? shareInfo() : null });
    }

    if (p.startsWith("/api/admin/") && !requireAdmin(req, res)) return;

    if (method === "POST" && p === "/api/admin/offline-responses") {
      const body = await readBody(req, 20000);
      let data;
      try { data = JSON.parse(Buffer.from(cleanString(body.payload, 12000), "base64url").toString("utf8")); } catch { data = null; }
      if (!data || typeof data !== "object" || !Array.isArray(data.a) || !cleanString(data.n, 40)) return send(res, 400, { error: "응답 QR을 읽을 수 없습니다." });
      const db = readDb();
      const form = db.forms.find(f => f.slug === data.s);
      if (!form) return send(res, 404, { error: "설문을 찾을 수 없습니다." });
      if (form.status !== "published") return send(res, 410, { error: "현재 응답을 받지 않는 설문입니다." });
      if (data.k !== questionKey(form) || data.a.length !== form.questions.length) return send(res, 409, { error: "설문 문항이 바뀌어 이 응답 QR은 저장할 수 없습니다. 새 오프라인 QR을 비치해 주세요." });
      const nonce = cleanString(data.n, 40);
      if (db.responses.some(r => r.formId === form.id && r.offlineNonce === nonce)) return send(res, 409, { error: "이미 저장된 응답입니다." });
      const answers = offlineAnswers(form, data.a);
      const error = answers ? validateAnswers(form, answers) : "응답 QR의 답변 형식이 올바르지 않습니다.";
      if (error) return send(res, 400, { error });
      db.responses.unshift({ id: crypto.randomUUID(), formId: form.id, submittedAt: new Date().toISOString(), answers, source: "qr", offlineNonce: nonce });
      writeDb(db);
      return send(res, 201, { ok: true, formId: form.id, formTitle: form.title, total: db.responses.filter(r => r.formId === form.id).length });
    }

    if (method === "GET" && p === "/api/admin/forms") {
      const db = readDb();
      return send(res, 200, { forms: db.forms.map(f => ({ ...publicForm(f), responseCount: db.responses.filter(r => r.formId === f.id).length })) });
    }

    if (method === "POST" && p === "/api/admin/forms") {
      const body = await readBody(req);
      const title = cleanString(body.title, 200);
      if (!title) return send(res, 400, { error: "설문 제목을 입력해 주세요." });
      const db = readDb();
      const slug = crypto.randomBytes(8).toString("hex");
      const now = new Date().toISOString();
      const form = { id: crypto.randomUUID(), slug, title, description: cleanString(body.description, 2000), questions: normalizeQuestions(body.questions), status: "draft", createdAt: now, updatedAt: now };
      db.forms.unshift(form);
      writeDb(db);
      return send(res, 201, { form: publicForm(form) });
    }

    const editMatch = p.match(/^\/api\/admin\/forms\/([a-f0-9-]+)$/);
    if (editMatch && method === "PUT") {
      const body = await readBody(req);
      const db = readDb();
      const form = db.forms.find(f => f.id === editMatch[1]);
      if (!form) return send(res, 404, { error: "설문을 찾을 수 없습니다." });
      const locked = db.responses.some(r => r.formId === form.id);
      if (locked) {
        // MVP: changing questions after responses would complicate interpretation. Allow title/description but freeze questions.
        form.title = cleanString(body.title, 200) || form.title;
        form.description = cleanString(body.description, 2000);
      } else {
        form.title = cleanString(body.title, 200) || form.title;
        form.description = cleanString(body.description, 2000);
        form.questions = normalizeQuestions(body.questions);
      }
      form.updatedAt = new Date().toISOString();
      writeDb(db);
      return send(res, 200, { form: publicForm(form), questionsLocked: locked });
    }

    const statusMatch = p.match(/^\/api\/admin\/forms\/([a-f0-9-]+)\/status$/);
    if (statusMatch && method === "POST") {
      const body = await readBody(req, 10000);
      if (!["draft", "published", "closed"].includes(body.status)) return send(res, 400, { error: "상태 값이 올바르지 않습니다." });
      const db = readDb();
      const form = db.forms.find(f => f.id === statusMatch[1]);
      if (!form) return send(res, 404, { error: "설문을 찾을 수 없습니다." });
      if (body.status === "published" && form.questions.length === 0) return send(res, 400, { error: "게시하려면 질문을 하나 이상 추가해야 합니다." });
      form.status = body.status;
      form.updatedAt = new Date().toISOString();
      writeDb(db);
      return send(res, 200, { form: publicForm(form) });
    }

    const resultsMatch = p.match(/^\/api\/admin\/forms\/([a-f0-9-]+)\/results$/);
    if (resultsMatch && method === "GET") {
      const db = readDb();
      const form = db.forms.find(f => f.id === resultsMatch[1]);
      if (!form) return send(res, 404, { error: "설문을 찾을 수 없습니다." });
      const responses = db.responses.filter(r => r.formId === form.id);
      const stats = form.questions.map(q => {
        const counts = {};
        for (const r of responses) {
          const v = r.answers[q.id];
          if (Array.isArray(v)) v.forEach(x => counts[x] = (counts[x] || 0) + 1);
          else if (v !== undefined && v !== "") counts[String(v)] = (counts[String(v)] || 0) + 1;
        }
        return { question: q, counts };
      });
      return send(res, 200, { form: publicForm(form), total: responses.length, responses, stats });
    }

    const deleteMatch = p.match(/^\/api\/admin\/forms\/([a-f0-9-]+)$/);
    if (deleteMatch && method === "DELETE") {
      const db = readDb();
      db.forms = db.forms.filter(f => f.id !== deleteMatch[1]);
      db.responses = db.responses.filter(r => r.formId !== deleteMatch[1]);
      writeDb(db);
      return send(res, 200, { ok: true });
    }

    const publicMatch = p.match(/^\/api\/public\/forms\/([a-f0-9]+)$/);
    if (publicMatch && method === "GET") {
      const db = readDb();
      const form = db.forms.find(f => f.slug === publicMatch[1]);
      if (!form) return send(res, 404, { error: "설문을 찾을 수 없습니다." });
      if (form.status !== "published") return send(res, 410, { error: "현재 응답을 받지 않는 설문입니다." });
      return send(res, 200, { form: publicForm(form) });
    }

    if (publicMatch && method === "POST") {
      const body = await readBody(req, 1024 * 1024);
      const db = readDb();
      const form = db.forms.find(f => f.slug === publicMatch[1]);
      if (!form) return send(res, 404, { error: "설문을 찾을 수 없습니다." });
      if (form.status !== "published") return send(res, 410, { error: "현재 응답을 받지 않는 설문입니다." });
      const error = validateAnswers(form, body.answers);
      if (error) return send(res, 400, { error });
      const response = { id: crypto.randomUUID(), formId: form.id, submittedAt: new Date().toISOString(), answers: body.answers };
      db.responses.unshift(response);
      writeDb(db);
      return send(res, 201, { ok: true, message: "응답이 제출되었습니다." });
    }

    if (method === "GET" && p === "/api/health") return send(res, 200, { ok: true });

    if (p.startsWith("/api/")) return send(res, 404, { error: "API 경로를 찾을 수 없습니다." });
    return serveStatic(req, res, p);
  } catch (err) {
    const status = /JSON|본문이 너무 큽니다/.test(err.message) ? 400 : 500;
    return send(res, status, { error: status === 500 ? "서버 내부 오류가 발생했습니다." : err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Survey MVP running at http://${HOST}:${PORT}`);
  const share = shareInfo();
  console.log(share.localOnly ? "Survey links work on this PC only. Set HOST=0.0.0.0 to share on your network." : `Survey links use ${share.baseUrl}`);
  console.log(`Admin username: ${ADMIN_USER}`);
  if (ADMIN_PASSWORD === "change-this-password") {
    console.warn("WARNING: Set ADMIN_PASSWORD before using this app beyond local testing.");
  }
});
