"use strict";

// Offline survey page. The survey arrives in the URL fragment, which browsers never send to a server,
// and the answers leave the phone only as a QR code on screen that the clinic PC's camera reads.
// The page makes no network requests, so it can also be hosted as a plain static file.
const app = document.getElementById("app");
const MAX_TEXT = 200;
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const fromB64url = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)));
const toB64url = (str) => btoa(Array.from(new TextEncoder().encode(str), b => String.fromCharCode(b)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const nonce = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, "0")).join("");

function qrSvg(text) {
  const qr = qrcode(0, "L"); qr.addData(text); qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return `<svg role="img" aria-label="응답 QR 코드" viewBox="-4 -4 ${n + 8} ${n + 8}" shape-rendering="crispEdges"><rect x="-4" y="-4" width="${n + 8}" height="${n + 8}" fill="#fff"/><path fill="#000" d="${d}"/></svg>`;
}

function questionHtml(q, i) {
  const name = `q${i}`, req = q.r ? "required" : "", options = q.o || [];
  let control;
  if (q.y === "text") control = `<input class="input" name="${name}" maxlength="${MAX_TEXT}" ${req}>`;
  else if (q.y === "textarea") control = `<textarea name="${name}" maxlength="${MAX_TEXT}" ${req}></textarea><p class="muted small">${MAX_TEXT}자까지 입력할 수 있습니다.</p>`;
  else if (q.y === "rating") control = `<div class="rating-row">${[1,2,3,4,5].map(n => `<label><input type="radio" name="${name}" value="${n}" ${q.r && n === 1 ? "required" : ""}>${n}</label>`).join("")}</div>`;
  else if (q.y === "select") control = `<select name="${name}" ${req}><option value="">선택해 주세요</option>${options.map((o, j) => `<option value="${j}">${esc(o)}</option>`).join("")}</select>`;
  else control = options.map((o, j) => `<label class="choice"><input type="${q.y === "checkbox" ? "checkbox" : "radio"}" name="${name}" value="${j}" ${q.r && q.y === "radio" && j === 0 ? "required" : ""}><span>${esc(o)}</span></label>`).join("");
  return `<div class="public-question"><label class="title">${i + 1}. ${esc(q.t)}${q.r ? '<span class="required">*</span>' : ""}</label>${control}</div>`;
}

function renderForm(survey) {
  app.innerHTML = `<div class="public-wrap"><header class="public-head"><h1>${esc(survey.t)}</h1><p>${esc(survey.d || "아래 질문에 응답해 주세요.")}</p></header>
  <form class="card" id="offline-form">${survey.q.map(questionHtml).join("")}<button class="btn wide">응답 완료</button><p class="muted small center">응답은 이 휴대폰에서 인터넷이나 서버로 전송되지 않습니다.</p></form></div>`;
  document.getElementById("offline-form").addEventListener("submit", e => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const missing = survey.q.find((q, i) => q.r && q.y === "checkbox" && !fd.getAll(`q${i}`).length);
    if (missing) { alert(`필수 질문에 응답해 주세요: ${missing.t}`); return; }
    // Choice answers are sent as option indexes to keep the answer QR small.
    const a = survey.q.map((q, i) => {
      const values = fd.getAll(`q${i}`);
      if (q.y === "checkbox") return values.length ? values.map(Number) : null;
      const v = String(values[0] ?? "").trim();
      if (!v) return null;
      return ["radio", "select", "rating"].includes(q.y) ? Number(v) : v;
    });
    renderAnswerQr(survey, toB64url(JSON.stringify({ s:survey.s, k:survey.k, n:nonce(), a })));
  });
}

function renderAnswerQr(survey, payload) {
  let svg;
  try { svg = qrSvg(payload); }
  catch { alert("응답이 너무 길어 QR로 만들 수 없습니다. 주관식 답변을 줄여 주세요."); return; }
  app.innerHTML = `<div class="public-wrap"><section class="card answer-card"><h1>응답 QR</h1><p>접수처에서 이 화면을 카메라에 보여주세요.</p><div class="answer-qr">${svg}</div><p class="muted small">화면을 닫으면 응답이 사라집니다. 접수처에서 저장을 확인한 뒤 닫아 주세요.</p><button type="button" class="btn secondary wide" id="restart">처음부터 다시 작성</button></section></div>`;
  document.getElementById("restart").addEventListener("click", () => renderForm(survey));
  window.scrollTo(0, 0);
}

try {
  const survey = JSON.parse(fromB64url(location.hash.slice(1)));
  if (!survey || !Array.isArray(survey.q)) throw new Error("invalid survey");
  renderForm(survey);
} catch {
  app.innerHTML = '<div class="public-wrap"><section class="card empty"><strong>설문 정보를 읽을 수 없습니다.</strong><p>진료실에 비치된 QR 코드를 다시 스캔해 주세요.</p></section></div>';
}
