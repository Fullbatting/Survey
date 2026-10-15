"use strict";

const app = document.getElementById("app");
const headerActions = document.getElementById("header-actions");
let share = { baseUrl: location.origin, localOnly: false };
let editor = null;
let results = null;

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const fmtDate = (v) => v ? new Date(v).toLocaleString("ko-KR", { dateStyle:"medium", timeStyle:"short" }) : "-";
const fmtShort = (v) => v ? new Date(v).toLocaleString("ko-KR", { month:"long", day:"numeric", hour:"2-digit", minute:"2-digit", hour12:false }) : "-";
const fmtDay = (v) => new Date(v).toLocaleDateString("ko-KR", { month:"long", day:"numeric" });
const statusLabel = (s) => ({ draft:"작성 중", published:"게시 중", closed:"종료" }[s] || s);
const statusChip = (s) => `<span class="status ${esc(s)}">${statusLabel(s)}</span>`;
const getSlug = () => location.pathname.match(/^\/f\/([a-f0-9]+)$/)?.[1] || null;
const getResultsId = () => location.pathname.match(/^\/results\/([a-f0-9-]+)$/)?.[1] || null;
const getEditId = () => location.pathname.match(/^\/edit\/([a-f0-9-]+)$/)?.[1] || null;
// crypto.randomUUID needs a secure context; LAN access over http is not one.
const uid = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
const clone = (v) => JSON.parse(JSON.stringify(v));
const isEmpty = (v) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
const answerText = (v) => Array.isArray(v) ? v.join(", ") : String(v ?? "");
const formLink = (slug) => `${share.baseUrl}/f/${slug}`;
const TYPE_LABELS = { text:"단답형", textarea:"장문형", radio:"객관식", checkbox:"복수 선택", select:"드롭다운", rating:"점수형" };
const TYPE_OPTIONS = { text:"단답형", textarea:"장문형", radio:"객관식 (하나 선택)", checkbox:"복수 선택", select:"드롭다운", rating:"점수형 (1~5)" };
const CHOICE_TYPES = ["radio", "checkbox", "select"];
const PAGE_SIZE = 10;

const icon = (body, w = 2) => `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICON = {
  plus: icon('<path d="M12 5v14M5 12h14"/>', 2.4),
  copy: icon('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>'),
  download: icon('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', 2.2),
  up: icon('<path d="M12 19V5M6 11l6-6 6 6"/>', 2.2),
  down: icon('<path d="M12 5v14M6 13l6 6 6-6"/>', 2.2),
  trash: icon('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  close: icon('<path d="M6 6l12 12M18 6L6 18"/>', 2.2),
  back: icon('<path d="M15 5l-7 7 7 7"/>', 2.2),
  next: icon('<path d="M9 5l7 7-7 7"/>', 2.2),
  link: icon('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  wifi: icon('<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0"/><circle cx="12" cy="19.5" r="1"/>'),
  search: icon('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>', 2.2),
  check: icon('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 2.6),
  info: icon('<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/>'),
  qr: icon('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v7h-7"/>')
};

async function api(url, options = {}) {
  const res = await fetch(url, { credentials:"same-origin", ...options, headers:{ "Content-Type":"application/json", ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}
function toast(message) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div"); el.className = "toast"; el.textContent = message;
  document.body.appendChild(el); setTimeout(() => el.remove(), 2600);
}
function setHeader(loggedIn) {
  headerActions.innerHTML = loggedIn ? `<div class="top-actions"><button class="btn secondary small-btn" id="home-btn">대시보드</button><button class="btn dark small-btn" id="logout-btn">로그아웃</button></div>` : "";
  document.getElementById("home-btn")?.addEventListener("click", () => navigate("/"));
  document.getElementById("logout-btn")?.addEventListener("click", async () => { await api("/api/logout",{method:"POST",body:"{}"}); navigate("/"); });
}
function navigate(path) {
  if (editor?.dirty && getEditId() && !confirm("저장하지 않은 변경사항이 있습니다. 이동할까요?")) return;
  history.pushState({}, "", path); render(); window.scrollTo(0,0);
}
window.addEventListener("popstate", render);
function bindBackLink() {
  app.querySelector("[data-nav]")?.addEventListener("click", e => { e.preventDefault(); navigate("/"); });
}

async function render() {
  closeModal();
  try {
    const slug = getSlug();
    if (slug) { setHeader(false); await renderPublic(slug); return; }
    const session = await api("/api/session");
    if (!session.authenticated) { setHeader(false); renderLogin(); return; }
    share = session.share || share;
    setHeader(true);
    const resultsId = getResultsId();
    if (resultsId) { await renderResults(resultsId); return; }
    const editId = getEditId();
    if (editId) { await renderEditor(editId); return; }
    await renderDashboard();
  } catch (err) {
    app.innerHTML = `<section class="card"><div class="error">${esc(err.message)}</div><button class="btn" id="retry">다시 시도</button></section>`;
    document.getElementById("retry")?.addEventListener("click", render);
  }
}

function renderLogin(error = "") {
  app.innerHTML = `<div class="login-wrap"><section class="card"><div class="brand-mark" style="margin-bottom:20px">S</div><h1>관리자 로그인</h1><p class="subhead">설문을 만들고 응답 결과를 관리하세요. 초기 계정은 실행 환경 설정에 따라 달라집니다.</p>${error ? `<div class="error">${esc(error)}</div>` : ""}<form id="login-form"><div class="field"><label for="username">아이디</label><input class="input" id="username" name="username" value="admin" autocomplete="username" required></div><div class="field"><label for="password">비밀번호</label><input class="input" id="password" name="password" type="password" autocomplete="current-password" required></div><button class="btn" style="width:100%">로그인</button></form><p class="muted small" style="margin:18px 0 0">처음 실행 시 README의 관리자 비밀번호 설정 안내를 확인하세요.</p></section></div>`;
  document.getElementById("login-form").addEventListener("submit", async e => {
    e.preventDefault(); const fd = new FormData(e.currentTarget);
    try { await api("/api/login",{method:"POST",body:JSON.stringify({username:fd.get("username"),password:fd.get("password")})}); navigate("/"); }
    catch (err) { renderLogin(err.message); }
  });
}

// ---------- QR / share ----------
function makeQr(text) { const qr = qrcode(0, "M"); qr.addData(text); qr.make(); return qr; }
function qrSvg(text, size, label = "공개 링크 QR 코드") {
  const qr = makeQr(text), n = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return `<svg role="img" aria-label="${esc(label)}" width="${size}" height="${size}" viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path fill="#101a32" d="${d}"/></svg>`;
}
function downloadQr(form) {
  const qr = makeQr(formLink(form.slug)), n = qr.getModuleCount(), cell = 10, margin = cell * 4;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = n * cell + margin * 2;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = "#000";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(margin + c * cell, margin + r * cell, cell, cell);
  const a = document.createElement("a"); a.href = canvas.toDataURL("image/png"); a.download = `survey-qr-${form.slug}.png`; a.click();
}
async function copyLink(slug) {
  const link = formLink(slug);
  try { await navigator.clipboard.writeText(link); toast("공개 링크를 복사했습니다."); }
  catch { prompt("설문 공개 링크를 복사하세요:", link); }
}
const LOCAL_ONLY_TEXT = "이 PC에서만 열리는 주소입니다. 휴대폰 등 다른 기기에서 열려면 runserver.bat의 HOST를 0.0.0.0으로 바꾼 뒤 다시 실행하세요.";
function shareBanner() {
  if (share.localOnly) return `<div class="share-banner warn">${ICON.info}<span>${LOCAL_ONLY_TEXT}</span></div>`;
  return `<div class="share-banner">${ICON.wifi}<span><strong>공유 주소</strong> ${esc(share.baseUrl)}</span><span class="muted">같은 Wi-Fi의 휴대폰·PC에서 링크와 QR로 접속할 수 있습니다.</span></div>`;
}
function shareBody(form) {
  const link = formLink(form.slug);
  const status = form.status === "draft" ? `<div class="notice">${ICON.info}<span>아직 <strong>작성 중</strong> 상태입니다. 질문을 구성하고 게시하면 이 링크·QR로 응답을 받을 수 있습니다.</span></div>`
    : form.status === "closed" ? `<div class="notice">${ICON.info}<span>응답이 종료된 설문입니다. 다시 게시하면 응답을 받을 수 있습니다.</span></div>` : "";
  return `<div class="share-body"><figure class="qr-box">${qrSvg(link, 188, `${form.title} 공개 링크 QR 코드`)}</figure><div class="share-side"><span class="label">공개 링크</span><div class="link-box">${esc(link)}</div><div class="btn-pair"><button type="button" class="btn secondary" data-act="copy">${ICON.copy}링크 복사</button><button type="button" class="btn secondary" data-act="qr">${ICON.download}QR 이미지 저장</button></div>${status}${share.localOnly ? `<div class="notice">${ICON.info}<span>${LOCAL_ONLY_TEXT}</span></div>` : ""}</div></div>`;
}
function bindShare(root, form) {
  root.querySelector('[data-act="copy"]').addEventListener("click", () => copyLink(form.slug));
  root.querySelector('[data-act="qr"]').addEventListener("click", () => downloadQr(form));
}

// ---------- modal ----------
function openModal(html, wide = false) {
  closeModal();
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `<section class="modal${wide ? " wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="modal-title">${html}</section>`;
  backdrop.addEventListener("click", e => { if (e.target === backdrop || e.target.closest("[data-close]")) closeModal(); });
  backdrop.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
  document.body.appendChild(backdrop);
  (backdrop.querySelector("input") || backdrop.querySelector("button"))?.focus();
  return backdrop;
}
function closeModal() { document.querySelector(".modal-backdrop")?.remove(); }
const modalHead = (title) => `<div class="modal-head"><h2 id="modal-title">${title}</h2><button type="button" class="icon-btn" data-close aria-label="닫기">${ICON.close}</button></div>`;

function openShareModal(form) {
  const m = openModal(modalHead(esc(form.title)) + shareBody(form), true);
  bindShare(m, form);
}
function openCreateModal() {
  const m = openModal(`<form id="create-form">${modalHead("새 설문 만들기")}
  <div class="field"><label for="c-title">설문 제목 <span class="required">*</span></label><input class="input" id="c-title" name="title" maxlength="200" placeholder="예: 고객 만족도 조사" required></div>
  <div class="field"><label for="c-desc">설명 <span class="muted">(선택)</span></label><textarea id="c-desc" name="description" maxlength="2000" placeholder="응답자에게 보여줄 안내 문구"></textarea></div>
  <fieldset class="choice-cards"><legend>시작 방식</legend><div class="choice-grid"><label class="choice-card"><input type="radio" name="start" value="blank" checked><span><strong>빈 설문</strong><small>질문 없이 시작</small></span></label><label class="choice-card"><input type="radio" name="start" value="sample"><span><strong>예시 질문 포함</strong><small>만족도 객관식 1개로 시작</small></span></label></div></fieldset>
  <div class="info-box">${ICON.qr}<span>만들면 이 설문 전용 <strong>공개 링크</strong>와 <strong>QR 코드</strong>가 한 쌍으로 바로 발급됩니다.</span></div>
  <div class="modal-actions"><button type="button" class="btn secondary" data-close>취소</button><button type="submit" class="btn">설문 만들기</button></div></form>`);
  m.querySelector("#create-form").addEventListener("submit", async e => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget), btn = e.currentTarget.querySelector('[type="submit"]');
    const questions = fd.get("start") === "sample" ? [{ id:uid(), title:"서비스에 얼마나 만족하시나요?", type:"radio", required:true, options:["매우 만족","만족","보통","불만족"] }] : [];
    btn.disabled = true;
    try {
      const data = await api("/api/admin/forms", { method:"POST", body:JSON.stringify({ title:fd.get("title"), description:fd.get("description"), questions }) });
      await renderDashboard();
      openCreatedModal(data.form);
    } catch (err) { toast(err.message); btn.disabled = false; }
  });
}
function openCreatedModal(form) {
  const m = openModal(`<div class="modal-head"><div class="done-title"><span class="done-icon">${ICON.check}</span><h2 id="modal-title">설문이 만들어졌습니다</h2></div></div>
  <p class="modal-sub">${esc(form.title)} · 전용 링크와 QR 코드가 발급되었습니다.</p>${shareBody(form)}
  <div class="modal-actions bordered"><button type="button" class="btn secondary" data-close>대시보드로</button><button type="button" class="btn" data-act="edit">질문 편집하기</button></div>`, true);
  bindShare(m, form);
  m.querySelector('[data-act="edit"]').addEventListener("click", () => navigate(`/edit/${form.id}`));
}

// ---------- dashboard ----------
function formCard(f) {
  const published = f.status === "published";
  const linkEnd = published ? `<button type="button" class="btn outline tiny" data-copy="${esc(f.slug)}">링크 복사</button>`
    : `<span class="link-note${f.status === "draft" ? " warn" : ""}">${f.status === "draft" ? "게시 후 응답 가능" : "응답 종료됨"}</span>`;
  return `<article class="form-item">
  <button type="button" class="qr-thumb${published ? "" : " dim"}" data-qr="${f.id}" aria-label="${esc(f.title)} QR 코드 크게 보기">${qrSvg(formLink(f.slug), 64)}</button>
  <div class="form-info"><div class="title-row"><strong>${esc(f.title)}</strong>${statusChip(f.status)}</div><p>질문 ${f.questions.length}개 · 응답 ${f.responseCount}건 · ${fmtDay(f.updatedAt)} 수정</p>
  <div class="link-row${published ? "" : " dashed"}">${ICON.link}<span class="link-text">${esc(formLink(f.slug))}</span>${linkEnd}</div></div>
  <div class="item-actions"><button class="btn${f.status === "draft" ? "" : " secondary"}" data-edit="${f.id}">편집</button><button class="btn${f.status === "draft" ? " secondary" : ""}" data-results="${f.id}">결과 보기</button><button class="btn danger" data-delete="${f.id}">삭제</button></div>
  </article>`;
}
async function renderDashboard() {
  const { forms } = await api("/api/admin/forms");
  const responses = forms.reduce((n,f)=>n+f.responseCount,0);
  app.innerHTML = `<div class="page-head"><div><h1>설문 대시보드</h1><p>설문을 만들면 전용 공개 링크와 QR 코드가 함께 발급됩니다.</p></div><button class="btn" id="new-form">${ICON.plus}새 설문 만들기</button></div>
  ${shareBanner()}
  <div class="stats-grid"><div class="stat-card"><span>전체 설문</span><strong>${forms.length}</strong></div><div class="stat-card"><span>게시 중</span><strong>${forms.filter(f=>f.status==="published").length}</strong></div><div class="stat-card"><span>누적 응답</span><strong>${responses}</strong></div></div>
  <div class="toolbar"><h2>내 설문</h2><span class="muted small">${forms.length}개</span></div>
  <div class="form-list">${forms.length ? forms.map(formCard).join("") : `<div class="card empty"><strong>아직 만든 설문이 없습니다.</strong><p>첫 설문을 만들어 응답을 수집해 보세요.</p><button class="btn" id="empty-new">첫 설문 만들기</button></div>`}</div>`;
  const byId = Object.fromEntries(forms.map(f => [f.id, f]));
  document.getElementById("new-form").addEventListener("click", openCreateModal);
  document.getElementById("empty-new")?.addEventListener("click", openCreateModal);
  app.querySelectorAll("[data-qr]").forEach(el=>el.addEventListener("click",()=>openShareModal(byId[el.dataset.qr])));
  app.querySelectorAll("[data-copy]").forEach(el=>el.addEventListener("click",()=>copyLink(el.dataset.copy)));
  app.querySelectorAll("[data-edit]").forEach(el=>el.addEventListener("click",()=>navigate(`/edit/${el.dataset.edit}`)));
  app.querySelectorAll("[data-results]").forEach(el=>el.addEventListener("click",()=>navigate(`/results/${el.dataset.results}`)));
  app.querySelectorAll("[data-delete]").forEach(el=>el.addEventListener("click",async()=>{
    if(!confirm("이 설문과 모든 응답을 삭제할까요? 이 작업은 되돌릴 수 없습니다.")) return;
    try { await api(`/api/admin/forms/${el.dataset.delete}`,{method:"DELETE"}); toast("설문을 삭제했습니다."); renderDashboard(); } catch(e){toast(e.message);}
  }));
}

// ---------- editor ----------
async function renderEditor(id) {
  const { forms } = await api("/api/admin/forms");
  const form = forms.find(f => f.id === id);
  if (!form) { app.innerHTML = '<section class="card">설문을 찾을 수 없습니다.</section>'; return; }
  editor = { form, title:form.title, description:form.description || "", questions:clone(form.questions), openId:form.questions[0]?.id || null, dirty:false, tab:"edit" };
  drawEditor();
}
function drawEditor() {
  const { form } = editor;
  const locked = form.responseCount > 0;
  const link = formLink(form.slug);
  const shareNote = share.localOnly ? LOCAL_ONLY_TEXT : `공유 주소 ${esc(new URL(share.baseUrl).host)} 기준입니다. 같은 Wi-Fi에서만 열립니다.`;
  const publishLabel = form.status === "closed" ? "저장하고 다시 게시하기" : "저장하고 게시하기";
  app.innerHTML = `<a href="/" class="back-link" data-nav>${ICON.back}대시보드</a>
  <div class="page-head"><div class="title-row"><h1>${esc(form.title)}</h1>${statusChip(form.status)}<span class="dirty${editor.dirty ? "" : " hidden"}" id="dirty">저장되지 않은 변경사항</span></div><div class="top-actions"><button class="btn secondary" id="preview-btn">미리보기</button><button class="btn" id="save-btn">저장</button></div></div>
  <div class="tabs" role="tablist"><button role="tab" data-tab="edit" aria-selected="${editor.tab === "edit"}">질문 편집</button><button role="tab" data-tab="preview" aria-selected="${editor.tab === "preview"}">응답자 화면 미리보기</button></div>
  <div class="split"><div class="split-main" id="editor-main"></div>
  <aside class="split-side">
  <section class="card"><h2>공유</h2><figure class="qr-box center">${qrSvg(link, 154)}</figure><div class="link-box">${esc(link)}</div><div class="btn-pair"><button type="button" class="btn secondary" data-act="copy">링크 복사</button><button type="button" class="btn secondary" data-act="qr">QR 저장</button></div><p class="muted small note">${shareNote}</p></section>
  <section class="card"><h2>게시 상태</h2><div class="status-line"><span class="muted small">현재</span>${statusChip(form.status)}</div>
  ${form.status === "published" ? `<p class="muted small note-top">게시 중입니다. 링크·QR로 응답을 받고 있습니다.</p><button class="btn secondary wide" id="close-form">응답 종료</button>` : `<button class="btn wide" id="publish">${publishLabel}</button><button class="btn secondary wide" disabled>응답 종료</button>`}
  <div class="notice">${locked ? `응답 ${form.responseCount}건이 접수되어 질문 구성이 잠겼습니다. 제목·설명은 수정할 수 있습니다.` : "응답이 1건이라도 접수되면 질문 구성이 잠깁니다. 제목·설명은 계속 수정할 수 있습니다."}</div></section>
  </aside></div>`;
  bindBackLink();
  bindShare(app.querySelector(".split-side"), form);
  document.getElementById("preview-btn").addEventListener("click", () => setEditorTab("preview"));
  app.querySelectorAll("[data-tab]").forEach(el => el.addEventListener("click", () => setEditorTab(el.dataset.tab)));
  document.getElementById("save-btn").addEventListener("click", async () => { if (await saveEditor()) { toast("설문을 저장했습니다."); drawEditor(); } });
  document.getElementById("publish")?.addEventListener("click", () => changeStatus("published"));
  document.getElementById("close-form")?.addEventListener("click", () => changeStatus("closed"));
  const main = document.getElementById("editor-main");
  main.addEventListener("input", onEditorInput);
  main.addEventListener("click", onEditorClick);
  drawEditorMain();
}
function setEditorTab(tab) {
  editor.tab = tab;
  app.querySelectorAll("[data-tab]").forEach(el => el.setAttribute("aria-selected", String(el.dataset.tab === tab)));
  drawEditorMain();
}
function drawEditorMain() {
  const main = document.getElementById("editor-main");
  if (editor.tab === "preview") {
    main.innerHTML = `<div class="preview-frame"><header class="public-head"><h1>${esc(editor.title)}</h1><p>${esc(editor.description || "아래 질문에 응답해 주세요.")}</p></header><form class="card" id="preview-form">${editor.questions.length ? publicQuestionsHtml(editor.questions) : '<div class="empty">질문을 추가해 주세요.</div>'}<button class="btn wide" type="submit" disabled>응답 제출</button><p class="muted small center">미리보기에서는 응답을 제출할 수 없습니다.</p></form></div>`;
    document.getElementById("preview-form").addEventListener("submit", e => e.preventDefault());
    return;
  }
  const locked = editor.form.responseCount > 0;
  main.innerHTML = `<section class="card"><div class="field"><label for="form-title">설문 제목</label><input class="input" id="form-title" maxlength="200" value="${esc(editor.title)}"></div><div class="field"><label for="form-description">설명</label><textarea id="form-description" maxlength="2000">${esc(editor.description)}</textarea></div></section>
  <div class="toolbar"><h2>질문 구성</h2><span class="muted small" id="question-count"></span></div>
  <div class="question-list" id="questions"></div>
  ${locked ? "" : `<section class="add-box"><span class="label">질문 추가</span><div class="add-grid">${Object.entries(TYPE_LABELS).map(([t, l]) => `<button type="button" class="btn secondary" data-add="${t}">${l}</button>`).join("")}</div></section>`}`;
  drawQuestions();
}
function drawQuestions() {
  const holder = document.getElementById("questions");
  if (!holder) return;
  const locked = editor.form.responseCount > 0;
  document.getElementById("question-count").textContent = `${editor.questions.length}개`;
  holder.innerHTML = editor.questions.length ? editor.questions.map((q, i) => questionHtml(q, i, locked)).join("") : '<div class="card empty">아래에서 질문을 추가해 주세요.</div>';
}
function questionHtml(q, i, locked) {
  const req = q.required ? "필수" : "선택";
  if (q.id !== editor.openId) {
    const meta = CHOICE_TYPES.includes(q.type) ? `선택지 ${q.options.length}개 · ${req}` : q.type === "rating" ? `1~5점 · ${req}` : req;
    return `<button type="button" class="q-compact" data-open="${esc(q.id)}"><strong>질문 ${i + 1}</strong><span class="type-badge">${TYPE_LABELS[q.type]}</span><span class="q-compact-title">${esc(q.title)}</span><span class="muted small">${meta}</span></button>`;
  }
  const dis = locked ? "disabled" : "";
  const last = editor.questions.length - 1;
  const options = CHOICE_TYPES.includes(q.type) ? `<div class="option-list"><span class="label">선택지</span>${q.options.map((o, j) => `<div class="option-row"><span class="option-dot${q.type === "checkbox" ? " square" : ""}"></span><input class="input" aria-label="선택지 ${j + 1}" data-option="${j}" value="${esc(o)}" maxlength="200" ${dis}><button type="button" class="icon-btn ghost" data-remove-option="${j}" aria-label="선택지 ${j + 1} 삭제" ${dis}>${ICON.close}</button></div>`).join("")}${locked ? "" : `<button type="button" class="btn dashed" data-add-option>${ICON.plus}선택지 추가</button>`}</div>`
    : q.type === "rating" ? '<p class="muted small">응답자는 1~5점 중 하나를 선택합니다.</p>' : "";
  return `<article class="question-card open" data-question="${esc(q.id)}">
  <div class="question-head"><div class="q-label"><strong>질문 ${i + 1}</strong><span class="type-badge">${TYPE_LABELS[q.type]}</span></div>
  <div class="icon-actions"><button type="button" class="icon-btn" data-move="-1" aria-label="위로 이동" ${locked || i === 0 ? "disabled" : ""}>${ICON.up}</button><button type="button" class="icon-btn" data-move="1" aria-label="아래로 이동" ${locked || i === last ? "disabled" : ""}>${ICON.down}</button><button type="button" class="icon-btn" data-dup aria-label="질문 복제" ${dis}>${ICON.copy}</button><button type="button" class="icon-btn danger" data-remove aria-label="질문 삭제" ${dis}>${ICON.trash}</button></div></div>
  <div class="field"><label for="q-title-${esc(q.id)}">질문 내용</label><input class="input" id="q-title-${esc(q.id)}" data-field="title" value="${esc(q.title)}" maxlength="300" ${dis}></div>
  <div class="q-row"><div class="field"><label for="q-type-${esc(q.id)}">질문 유형</label><select id="q-type-${esc(q.id)}" data-field="type" ${dis}>${Object.entries(TYPE_OPTIONS).map(([t, l]) => `<option value="${t}" ${q.type === t ? "selected" : ""}>${l}</option>`).join("")}</select></div><label class="check-pill"><input type="checkbox" data-field="required" ${q.required ? "checked" : ""} ${dis}>필수 질문</label></div>
  ${options}</article>`;
}
function questionOf(el) {
  const id = el.closest("[data-question]")?.dataset.question;
  return editor.questions.find(q => q.id === id);
}
function markDirty() {
  editor.dirty = true;
  document.getElementById("dirty")?.classList.remove("hidden");
}
function onEditorInput(e) {
  const t = e.target;
  if (t.id === "form-title") editor.title = t.value;
  else if (t.id === "form-description") editor.description = t.value;
  else {
    const q = questionOf(t);
    if (!q) return;
    const field = t.dataset.field;
    if (field === "title") q.title = t.value;
    else if (field === "required") q.required = t.checked;
    else if (field === "type") {
      q.type = t.value;
      if (CHOICE_TYPES.includes(q.type) && !q.options.length) q.options = ["선택지 1", "선택지 2"];
      drawQuestions();
    }
    else if (t.dataset.option !== undefined) q.options[Number(t.dataset.option)] = t.value;
    else return;
  }
  markDirty();
}
function onEditorClick(e) {
  const b = e.target.closest("button");
  if (!b || b.disabled) return;
  const list = editor.questions;
  if (b.dataset.open) { editor.openId = b.dataset.open; drawQuestions(); return; }
  if (b.dataset.add) {
    const type = b.dataset.add;
    const q = { id:uid(), title:"새 질문", type, required:false, options:CHOICE_TYPES.includes(type) ? ["선택지 1", "선택지 2"] : [] };
    list.push(q); editor.openId = q.id; markDirty(); drawQuestions();
    document.getElementById(`q-title-${q.id}`)?.focus();
    return;
  }
  const q = questionOf(b);
  if (!q) return;
  const i = list.indexOf(q);
  if (b.dataset.move) { const j = i + Number(b.dataset.move); [list[i], list[j]] = [list[j], list[i]]; }
  else if (b.dataset.dup !== undefined) { const copy = { ...clone(q), id:uid() }; list.splice(i + 1, 0, copy); editor.openId = copy.id; }
  else if (b.dataset.remove !== undefined) { list.splice(i, 1); editor.openId = list[Math.min(i, list.length - 1)]?.id || null; }
  else if (b.dataset.removeOption !== undefined) q.options.splice(Number(b.dataset.removeOption), 1);
  else if (b.dataset.addOption !== undefined) q.options.push(`선택지 ${q.options.length + 1}`);
  else return;
  markDirty(); drawQuestions();
}
async function saveEditor() {
  if (!editor.title.trim()) { toast("설문 제목을 입력해 주세요."); return false; }
  try {
    const data = await api(`/api/admin/forms/${editor.form.id}`, { method:"PUT", body:JSON.stringify({ title:editor.title, description:editor.description, questions:editor.questions }) });
    Object.assign(editor.form, data.form);
    editor.title = data.form.title; editor.description = data.form.description; editor.questions = clone(data.form.questions);
    if (!editor.questions.some(q => q.id === editor.openId)) editor.openId = editor.questions[0]?.id || null;
    editor.dirty = false;
    return true;
  } catch (err) { toast(err.message); return false; }
}
async function changeStatus(status) {
  if (status === "published" && editor.dirty && !(await saveEditor())) return;
  try {
    const data = await api(`/api/admin/forms/${editor.form.id}/status`, { method:"POST", body:JSON.stringify({ status }) });
    editor.form.status = data.form.status;
    toast(status === "published" ? "설문을 게시했습니다." : "설문 응답을 종료했습니다.");
  } catch (e) { toast(e.message); }
  drawEditor();
}

// ---------- public ----------
function publicQuestionsHtml(questions) {
  return questions.map((q,i)=>{
    let control="";
    if(q.type==="text") control=`<input class="input" name="${esc(q.id)}" maxlength="5000" ${q.required?"required":""}>`;
    else if(q.type==="textarea") control=`<textarea name="${esc(q.id)}" maxlength="5000" ${q.required?"required":""}></textarea>`;
    else if(q.type==="rating") control=`<div class="rating-row">${[1,2,3,4,5].map(n=>`<label><input type="radio" name="${esc(q.id)}" value="${n}" ${q.required&&n===1?"required":""}>${n}</label>`).join("")}</div>`;
    else if(q.type==="select") control=`<select name="${esc(q.id)}" ${q.required?"required":""}><option value="">선택해 주세요</option>${q.options.map(o=>`<option value="${esc(o)}">${esc(o)}</option>`).join("")}</select>`;
    else control=q.options.map((o,j)=>`<label class="choice"><input type="${q.type==="checkbox"?"checkbox":"radio"}" name="${esc(q.id)}" value="${esc(o)}" ${q.required&&q.type==="radio"&&j===0?"required":""}><span>${esc(o)}</span></label>`).join("");
    return `<div class="public-question"><label class="title">${i+1}. ${esc(q.title)}${q.required?'<span class="required">*</span>':""}</label>${control}</div>`;
  }).join("");
}
async function renderPublic(slug) {
  const {form}=await api(`/api/public/forms/${slug}`);
  app.innerHTML=`<div class="public-wrap"><header class="public-head"><h1>${esc(form.title)}</h1><p>${esc(form.description||"아래 질문에 응답해 주세요.")}</p></header><form class="card" id="public-form"><div id="public-questions"></div><button class="btn" style="width:100%">응답 제출</button><p class="muted small" style="text-align:center;margin:14px 0 0">제출 후에는 응답을 수정할 수 없습니다.</p></form></div>`;
  document.getElementById("public-questions").innerHTML=publicQuestionsHtml(form.questions);
  document.getElementById("public-form").addEventListener("submit",async e=>{
    e.preventDefault(); const answers={}; const fd=new FormData(e.currentTarget);
    for(const q of form.questions){const values=fd.getAll(q.id);answers[q.id]=q.type==="checkbox"?values:(q.type==="rating"?(values[0]||""):values[0]||"");}
    const btn=e.currentTarget.querySelector("button[type=submit],button:not([type])"); btn.disabled=true;
    try { await api(`/api/public/forms/${slug}`,{method:"POST",body:JSON.stringify({answers})}); app.innerHTML=`<div class="public-wrap"><section class="card empty"><div class="emoji">✓</div><strong>응답이 제출되었습니다.</strong><p>참여해 주셔서 감사합니다.</p></section></div>`; }
    catch(err){toast(err.message);btn.disabled=false;}
  });
}

// ---------- results ----------
async function renderResults(id) {
  const data = await api(`/api/admin/forms/${id}/results`);
  const total = data.responses.length;
  results = { data, numbered:data.responses.map((r, i) => ({ ...r, no:total - i })), tab:"summary", query:"", page:0, selectedId:null };
  drawResults();
}
function drawResults() {
  const { data } = results, f = data.form;
  app.innerHTML = `<a href="/" class="back-link" data-nav>${ICON.back}대시보드</a>
  <div class="page-head"><div class="title-row"><h1>${esc(f.title)}</h1>${statusChip(f.status)}</div><div class="top-actions"><button class="btn secondary" id="edit-form">설문 편집</button><button class="btn" id="export-csv">${ICON.download}CSV 내보내기</button></div></div>
  <div class="tabs" role="tablist"><button role="tab" data-tab="summary" aria-selected="${results.tab === "summary"}">요약</button><button role="tab" data-tab="responses" aria-selected="${results.tab === "responses"}">개별 응답 <span class="tab-count">${data.total}</span></button></div>
  <div id="results-body"></div>`;
  bindBackLink();
  document.getElementById("edit-form").addEventListener("click", () => navigate(`/edit/${f.id}`));
  document.getElementById("export-csv").addEventListener("click", () => exportCsv(data));
  app.querySelectorAll("[data-tab]").forEach(el => el.addEventListener("click", () => setResultsTab(el.dataset.tab)));
  drawResultsBody();
}
function setResultsTab(tab) {
  results.tab = tab;
  app.querySelectorAll("[data-tab]").forEach(el => el.setAttribute("aria-selected", String(el.dataset.tab === tab)));
  drawResultsBody();
}
function drawResultsBody() {
  const body = document.getElementById("results-body");
  const f = results.data.form;
  if (results.tab === "summary") {
    const latest = results.numbered[0];
    body.innerHTML = `<div class="kpi-row"><div class="stat-card"><span>전체 응답</span><strong>${results.data.total}</strong></div><div class="stat-card"><span>최근 응답</span><strong class="stat-sm">${latest ? esc(fmtShort(latest.submittedAt)) : "-"}</strong></div><div class="stat-card"><span>질문 수</span><strong>${f.questions.length}</strong></div><div class="stat-card share-kpi">${qrSvg(formLink(f.slug), 56)}<div><span>공유</span><button type="button" class="btn outline tiny" id="show-share">링크·QR 보기</button></div></div></div>
    <div class="stat-list">${f.questions.map(statHtml).join("") || '<div class="card empty">질문이 없습니다.</div>'}</div>`;
    // Inline style attributes are blocked by the CSP, so bar widths are set through the CSSOM.
    body.querySelectorAll("[data-pct]").forEach(el => { el.style.width = `${el.dataset.pct}%`; });
    document.getElementById("show-share").addEventListener("click", () => openShareModal(f));
    body.querySelectorAll("[data-show-all]").forEach(el => el.addEventListener("click", () => setResultsTab("responses")));
    return;
  }
  if (!results.numbered.length) { body.innerHTML = '<section class="card empty">아직 접수된 응답이 없습니다.</section>'; return; }
  body.innerHTML = `<div class="split"><section class="card split-list"><label for="r-search" class="label">응답 내용 검색</label><div class="search-box">${ICON.search}<input id="r-search" placeholder="예: 배송" value="${esc(results.query)}"></div><div id="resp-items"></div></section><section class="card split-main" id="resp-detail"></section></div>`;
  document.getElementById("r-search").addEventListener("input", e => { results.query = e.target.value; results.page = 0; results.selectedId = null; drawResponseList(); });
  document.getElementById("resp-items").addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    if (b.dataset.select) results.selectedId = b.dataset.select;
    else if (b.dataset.page) { results.page += Number(b.dataset.page); results.selectedId = filteredResponses()[results.page * PAGE_SIZE].id; }
    drawResponseList();
  });
  document.getElementById("resp-detail").addEventListener("click", e => {
    const b = e.target.closest("[data-step]");
    if (!b || b.disabled) return;
    const list = filteredResponses();
    const j = list.findIndex(r => r.id === results.selectedId) + Number(b.dataset.step);
    results.selectedId = list[j].id; results.page = Math.floor(j / PAGE_SIZE);
    drawResponseList();
  });
  drawResponseList();
}
function statHtml(q, i) {
  const answered = results.numbered.filter(r => !isEmpty(r.answers[q.id]));
  const n = answered.length;
  const head = (extra = "") => `<h2>${i + 1}. ${esc(q.title)}</h2><p class="muted small">${TYPE_LABELS[q.type]} · ${n}명 응답${extra}</p>`;
  if (!n) return `<section class="card">${head()}<p class="muted small">아직 응답이 없습니다.</p></section>`;
  if (q.type === "text" || q.type === "textarea") {
    return `<section class="card">${head(n > 3 ? " · 최근 3건" : "")}<ul class="text-answers">${answered.slice(0, 3).map(r => `<li><p>${esc(answerText(r.answers[q.id]))}</p><span class="muted small">응답 ${r.no} · ${esc(fmtShort(r.submittedAt))}</span></li>`).join("")}</ul>${n > 3 ? `<button type="button" class="link-btn" data-show-all>전체 ${n}건 보기${ICON.next}</button>` : ""}</section>`;
  }
  const count = (v) => answered.filter(r => Array.isArray(r.answers[q.id]) ? r.answers[q.id].map(String).includes(v) : String(r.answers[q.id]) === v).length;
  const rows = (pairs) => `<div class="bars">${pairs.map(([label, value]) => {
    const c = count(value), pct = Math.round(c / n * 100);
    return `<div class="bar-row${c ? "" : " zero"}"><span>${esc(label)}</span><div class="bar-track"><div class="bar-fill" data-pct="${pct}"></div></div><span class="bar-value"><strong>${c}</strong> ${pct}%</span></div>`;
  }).join("")}</div>`;
  if (q.type === "rating") {
    const avg = answered.reduce((s, r) => s + Number(r.answers[q.id]), 0) / n;
    return `<section class="card">${head()}<div class="rating-stat"><div class="avg"><span class="muted small">평균</span><strong>${avg.toFixed(1)}</strong><span class="muted small">/ 5점</span></div>${rows([5,4,3,2,1].map(v => [`${v}점`, String(v)]))}</div></section>`;
  }
  return `<section class="card">${head(q.type === "checkbox" ? " · 비율은 응답자 수 기준" : "")}${rows(q.options.map(o => [o, o]))}</section>`;
}
function filteredResponses() {
  const query = results.query.trim().toLowerCase();
  if (!query) return results.numbered;
  return results.numbered.filter(r => Object.values(r.answers).some(v => answerText(v).toLowerCase().includes(query)));
}
function answerHtml(q, v) {
  if (isEmpty(v)) return '<span class="muted">미응답</span>';
  if (q.type === "checkbox") return v.map(x => `<span class="chip">${esc(x)}</span>`).join("");
  if (q.type === "rating") return `<strong>${esc(v)}</strong> <span class="muted">/ 5점</span>`;
  if (q.type === "textarea") return `<div class="answer-text">${esc(v)}</div>`;
  return esc(answerText(v));
}
function drawResponseList() {
  const list = filteredResponses();
  const items = document.getElementById("resp-items"), detail = document.getElementById("resp-detail");
  if (!list.length) { items.innerHTML = '<p class="muted small">검색 결과가 없습니다.</p>'; detail.innerHTML = '<div class="empty">표시할 응답이 없습니다.</div>'; return; }
  let idx = list.findIndex(r => r.id === results.selectedId);
  if (idx < 0) { idx = 0; results.selectedId = list[0].id; results.page = 0; }
  const pages = Math.ceil(list.length / PAGE_SIZE), start = results.page * PAGE_SIZE, slice = list.slice(start, start + PAGE_SIZE);
  const questions = results.data.form.questions;
  const summary = (r) => questions.map(q => r.answers[q.id]).filter(v => !isEmpty(v)).slice(0, 3).map(answerText).join(" · ");
  items.innerHTML = `<ul class="resp-items">${slice.map(r => `<li><button type="button" class="resp-item" data-select="${r.id}" ${r.id === results.selectedId ? 'aria-current="true"' : ""}><strong>응답 ${r.no}</strong> <span class="muted small">· ${esc(fmtShort(r.submittedAt))}</span><span class="resp-summary">${esc(summary(r))}</span></button></li>`).join("")}</ul>
  <div class="pager"><span class="muted small">${start + 1}–${start + slice.length} / ${list.length}건</span><div class="pager-btns"><button type="button" class="icon-btn" data-page="-1" aria-label="이전 페이지" ${results.page === 0 ? "disabled" : ""}>${ICON.back}</button><button type="button" class="icon-btn" data-page="1" aria-label="다음 페이지" ${results.page >= pages - 1 ? "disabled" : ""}>${ICON.next}</button></div></div>`;
  const r = list[idx];
  detail.innerHTML = `<div class="detail-head"><div><h2>응답 ${r.no}</h2><span class="muted small">${esc(fmtDate(r.submittedAt))} 제출</span></div><div class="pager-btns"><button type="button" class="btn secondary" data-step="-1" ${idx === 0 ? "disabled" : ""}>${ICON.back}이전</button><button type="button" class="btn secondary" data-step="1" ${idx === list.length - 1 ? "disabled" : ""}>다음${ICON.next}</button></div></div>
  <dl class="answer-dl">${questions.map((q, i) => `<div><dt>${i + 1}. ${esc(q.title)}</dt><dd>${answerHtml(q, r.answers[q.id])}</dd></div>`).join("")}</dl>`;
}
function exportCsv(data) {
  const cols=["응답 ID","제출 시각",...data.form.questions.map(q=>q.title)];
  const rows=data.responses.map(r=>[r.id,r.submittedAt,...data.form.questions.map(q=>answerText(r.answers[q.id]))]);
  // Prefix values Excel would run as formulas (CSV injection).
  const cell=v=>{ let s=String(v??""); if(/^[=+\-@\t\r]/.test(s)) s="'"+s; return `"${s.replace(/"/g,'""')}"`; };
  const csv=[cols,...rows].map(row=>row.map(cell).join(",")).join("\r\n");
  const blob=new Blob(["﻿"+csv],{type:"text/csv;charset=utf-8"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`survey-results-${data.form.slug}.csv`;a.click();URL.revokeObjectURL(a.href);
}
render();
