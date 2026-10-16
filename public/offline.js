"use strict";

// Offline survey page. The survey arrives in the URL fragment, which browsers never send to a server,
// and the answers leave the phone only as a QR code on screen that the clinic PC's camera reads.
// The page makes no network requests, so it can also be hosted as a plain static file.
const app = document.getElementById("app");
const MAX_TEXT = 200;
const nonce = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, "0")).join("");

function renderForm(survey) {
  // Choice answers are sent as option indexes to keep the answer QR small.
  const fields = questionFieldsHtml(survey.questions, { name:(q, i) => `q${i}`, value:(o, j) => j, maxText:MAX_TEXT, showLimit:true });
  app.innerHTML = `<div class="public-wrap"><header class="public-head"><h1>${esc(survey.title)}</h1><p>${esc(survey.description || "아래 질문에 응답해 주세요.")}</p></header>
  <form class="card" id="offline-form">${consentHtml(survey.consent)}${fields}<button class="btn wide">응답 완료</button><p class="muted small center form-note">응답은 이 휴대폰에서 인터넷이나 서버로 전송되지 않습니다.</p></form></div>`;
  document.getElementById("offline-form").addEventListener("submit", e => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const missing = survey.questions.find((q, i) => q.required && q.type === "checkbox" && !fd.getAll(`q${i}`).length);
    if (missing) { alert(`필수 질문에 응답해 주세요: ${missing.title}`); return; }
    const a = survey.questions.map((q, i) => {
      const values = fd.getAll(`q${i}`);
      if (q.type === "checkbox") return values.length ? values.map(Number) : null;
      const v = String(values[0] ?? "").trim();
      if (!v) return null;
      return ["radio", "select", "rating"].includes(q.type) ? Number(v) : v;
    });
    renderAnswerQr(survey, toB64url(JSON.stringify({ s:survey.slug, k:survey.key, n:nonce(), a, ...(survey.consent ? { c:1 } : {}) })));
  });
}

function renderAnswerQr(survey, payload) {
  let svg;
  try { svg = qrSvg(payload, { label:"응답 QR 코드", level:"L", margin:4, color:"#000" }); }
  catch { alert("응답이 너무 길어 QR로 만들 수 없습니다. 주관식 답변을 줄여 주세요."); return; }
  app.innerHTML = `<div class="public-wrap"><section class="card answer-card"><h1>응답 QR</h1><p>접수처에서 이 화면을 카메라에 보여주세요.</p><div class="answer-qr">${svg}</div><p class="muted small">화면을 닫으면 응답이 사라집니다. 접수처에서 저장을 확인한 뒤 닫아 주세요.</p><button type="button" class="btn secondary wide" id="restart">처음부터 다시 작성</button></section></div>`;
  document.getElementById("restart").addEventListener("click", () => renderForm(survey));
  window.scrollTo(0, 0);
}

try {
  renderForm(decodeOfflineSurvey(location.hash.slice(1)));
} catch {
  app.innerHTML = '<div class="public-wrap"><section class="card empty"><strong>설문 정보를 읽을 수 없습니다.</strong><p>진료실에 비치된 QR 코드를 다시 스캔해 주세요.</p></section></div>';
}
