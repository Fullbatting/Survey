"use strict";

// Helpers shared by the admin app (app.js) and the offline survey page (offline.js).
// The offline page must make no server requests, so nothing here touches the network.

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const CHOICE_TYPES = ["radio", "checkbox", "select"];

const toB64url = (str) => btoa(Array.from(new TextEncoder().encode(str), b => String.fromCharCode(b)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)));

function makeQr(text, level = "M") {
  const qr = qrcode(0, level);
  qr.addData(text);
  qr.make();
  return qr;
}

// Without `size` the SVG scales to its container.
function qrSvg(text, { size, label = "공개 링크 QR 코드", level = "M", margin = 2, color = "#101a32" } = {}) {
  const qr = makeQr(text, level), n = qr.getModuleCount(), box = n + margin * 2;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  const dims = size ? ` width="${size}" height="${size}"` : "";
  return `<svg role="img" aria-label="${esc(label)}"${dims} viewBox="${-margin} ${-margin} ${box} ${box}" shape-rendering="crispEdges"><rect x="${-margin}" y="${-margin}" width="${box}" height="${box}" fill="#fff"/><path fill="${color}" d="${d}"/></svg>`;
}

// Offline survey link: the survey travels in the URL fragment (never sent to a server),
// as base64url JSON with short keys to keep the printed QR small.
function encodeOfflineSurvey(form) {
  return toB64url(JSON.stringify({ s:form.slug, k:form.questionKey, t:form.title, d:form.description || "", q:form.questions.map(q => ({ t:q.title, y:q.type, r:q.required ? 1 : 0, o:CHOICE_TYPES.includes(q.type) ? q.options : undefined })) }));
}
function decodeOfflineSurvey(fragment) {
  const s = JSON.parse(fromB64url(fragment));
  if (!s || !Array.isArray(s.q)) throw new Error("invalid survey");
  return { slug:s.s, key:s.k, title:s.t, description:s.d, questions:s.q.map(q => ({ title:q.t, type:q.y, required:Boolean(q.r), options:q.o || [] })) };
}

// Respondent-facing question fields. `name`/`value` let the offline page post option indexes instead of option text.
function questionFieldsHtml(questions, { name = (q) => q.id, value = (o) => o, maxText = 5000, showLimit = false } = {}) {
  return questions.map((q, i) => {
    const field = esc(name(q, i)), req = q.required ? "required" : "";
    let control;
    if (q.type === "text") control = `<input class="input" name="${field}" maxlength="${maxText}" ${req}>`;
    else if (q.type === "textarea") control = `<textarea name="${field}" maxlength="${maxText}" ${req}></textarea>${showLimit ? `<p class="muted small">${maxText}자까지 입력할 수 있습니다.</p>` : ""}`;
    else if (q.type === "rating") control = `<div class="rating-row">${[1, 2, 3, 4, 5].map(v => `<label><input type="radio" name="${field}" value="${v}" ${q.required && v === 1 ? "required" : ""}>${v}</label>`).join("")}</div>`;
    else if (q.type === "select") control = `<select name="${field}" ${req}><option value="">선택해 주세요</option>${q.options.map((o, j) => `<option value="${esc(value(o, j))}">${esc(o)}</option>`).join("")}</select>`;
    else control = q.options.map((o, j) => `<label class="choice"><input type="${q.type === "checkbox" ? "checkbox" : "radio"}" name="${field}" value="${esc(value(o, j))}" ${q.required && q.type === "radio" && j === 0 ? "required" : ""}><span>${esc(o)}</span></label>`).join("");
    return `<div class="public-question"><label class="title">${i + 1}. ${esc(q.title)}${q.required ? '<span class="required">*</span>' : ""}</label>${control}</div>`;
  }).join("");
}
