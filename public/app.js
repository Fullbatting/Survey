"use strict";

const app = document.getElementById("app");
const headerActions = document.getElementById("header-actions");
let currentForm = null;
let currentResults = null;
let currentQuestions = [];
let editingId = null;

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const fmtDate = (v) => v ? new Date(v).toLocaleString("ko-KR", { dateStyle:"medium", timeStyle:"short" }) : "-";
const statusLabel = (s) => ({ draft:"작성 중", published:"게시 중", closed:"종료" }[s] || s);
const getSlug = () => location.pathname.match(/^\/f\/([a-f0-9]+)$/)?.[1] || null;
const getResultsId = () => location.pathname.match(/^\/results\/([a-f0-9-]+)$/)?.[1] || null;
const getEditId = () => location.pathname.match(/^\/edit\/([a-f0-9-]+)$/)?.[1] || null;

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
function navigate(path) { history.pushState({}, "", path); render(); window.scrollTo(0,0); }
window.addEventListener("popstate", render);

async function render() {
  try {
    const slug = getSlug();
    if (slug) { setHeader(false); await renderPublic(slug); return; }
    const session = await api("/api/session");
    if (!session.authenticated) { setHeader(false); renderLogin(); return; }
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

async function renderDashboard() {
  const data = await api("/api/admin/forms");
  const forms = data.forms;
  const responses = forms.reduce((n,f)=>n+f.responseCount,0);
  app.innerHTML = `<div class="page-head"><div><h1>설문 대시보드</h1><p>설문을 만들고 링크를 공유해 응답을 수집하세요.</p></div><button class="btn" id="new-form">＋ 새 설문 만들기</button></div>
  <div class="stats-grid"><div class="stat-card"><span>전체 설문</span><strong>${forms.length}</strong></div><div class="stat-card"><span>게시 중인 설문</span><strong>${forms.filter(f=>f.status==="published").length}</strong></div><div class="stat-card"><span>누적 응답</span><strong>${responses}</strong></div></div>
  <div class="toolbar"><h2 style="margin:0">내 설문</h2><span class="muted small">${forms.length}개</span></div>
  <div class="form-list">${forms.length ? forms.map(f=>`<article class="form-item"><div class="form-icon">▤</div><div class="form-info"><strong>${esc(f.title)}</strong><p>${esc(f.description || "설명 없음")} · 질문 ${f.questions.length}개 · 응답 ${f.responseCount}건</p><span class="status ${esc(f.status)}">${statusLabel(f.status)}</span></div><div class="item-actions"><button class="btn secondary small-btn" data-edit="${f.id}">편집</button><button class="btn secondary small-btn" data-results="${f.id}">결과</button><button class="btn secondary small-btn" data-share="${f.slug}">링크</button><button class="btn danger small-btn" data-delete="${f.id}">삭제</button></div></article>`).join("") : `<div class="card empty"><div class="emoji">📝</div><strong>아직 만든 설문이 없습니다.</strong><p>첫 설문을 만들어 응답을 수집해 보세요.</p><button class="btn" id="empty-new">첫 설문 만들기</button></div>`}</div>`;
  document.getElementById("new-form")?.addEventListener("click", () => createForm());
  document.getElementById("empty-new")?.addEventListener("click", () => createForm());
  document.querySelectorAll("[data-edit]").forEach(el=>el.addEventListener("click",()=>navigate(`/edit/${el.dataset.edit}`)));
  document.querySelectorAll("[data-results]").forEach(el=>el.addEventListener("click",()=>navigate(`/results/${el.dataset.results}`)));
  document.querySelectorAll("[data-share]").forEach(el=>el.addEventListener("click",()=>showShare(el.dataset.share)));
  document.querySelectorAll("[data-delete]").forEach(el=>el.addEventListener("click",async()=>{
    if(!confirm("이 설문과 모든 응답을 삭제할까요? 이 작업은 되돌릴 수 없습니다.")) return;
    try { await api(`/api/admin/forms/${el.dataset.delete}`,{method:"DELETE"}); toast("설문을 삭제했습니다."); renderDashboard(); } catch(e){toast(e.message);}
  }));
}
async function createForm() {
  try {
    const data = await api("/api/admin/forms",{method:"POST",body:JSON.stringify({title:"새 설문",description:"",questions:[{id:crypto.randomUUID(),title:"이 설문에 대해 어떻게 생각하시나요?",type:"radio",required:true,options:["매우 만족","만족","보통","불만족"]}]})});
    navigate(`/edit/${data.form.id}`);
  } catch(e) { toast(e.message); }
}
async function showShare(slug) {
  const link = `${location.origin}/f/${slug}`;
  try { await navigator.clipboard.writeText(link); toast("공개 링크를 복사했습니다."); }
  catch { prompt("설문 공개 링크를 복사하세요:", link); }
}

function renderEditorSkeleton(form, locked) {
  app.innerHTML = `<div class="page-head"><div><h1>설문 편집</h1><p>질문을 구성하고 공개 상태를 관리하세요.</p></div><button class="btn secondary" id="back">← 대시보드</button></div>
  ${locked ? `<div class="notice">응답이 이미 접수된 설문은 질문 구성을 변경할 수 없습니다. 응답 해석이 달라지는 것을 방지하기 위한 MVP 제한입니다.</div>` : ""}
  <div class="two-col"><section class="card"><form id="form-editor"><div class="field"><label for="form-title">설문 제목</label><input class="input" id="form-title" maxlength="200" value="${esc(form.title)}" required></div><div class="field"><label for="form-description">설문 설명</label><textarea id="form-description" maxlength="2000">${esc(form.description || "")}</textarea></div><hr class="divider"><div class="toolbar"><h2 style="margin:0">질문 구성</h2><span class="muted small" id="question-count"></span></div><div id="questions"></div><div class="editor-actions"><button type="button" class="btn secondary" id="add-text">＋ 단답형</button><button type="button" class="btn secondary" id="add-long">＋ 장문형</button><button type="button" class="btn secondary" id="add-choice">＋ 객관식</button><button type="button" class="btn secondary" id="add-check">＋ 복수 선택</button><button type="button" class="btn secondary" id="add-rating">＋ 점수형</button></div><hr class="divider"><button class="btn" ${locked ? "disabled" : ""}>변경사항 저장</button></form></section>
  <aside class="card side-card"><h2>게시 설정</h2><p class="muted small">현재 상태</p><span class="status ${esc(form.status)}">${statusLabel(form.status)}</span><hr class="divider"><p class="muted small">공개 링크</p><div class="link-box">${location.origin}/f/${form.slug}</div><button class="btn secondary" style="width:100%" id="copy-link">링크 복사</button><hr class="divider"><button class="btn" style="width:100%" id="publish">${form.status==="published"?"게시 중":"게시하기"}</button><button class="btn secondary" style="width:100%;margin-top:8px" id="close-form">응답 종료</button><p class="muted small" style="line-height:1.6;margin:14px 0 0">게시하려면 질문이 하나 이상 있어야 합니다. 종료한 설문은 다시 게시할 수 있습니다.</p></aside></div>`;
  document.getElementById("back").addEventListener("click",()=>navigate("/"));
  document.getElementById("copy-link").addEventListener("click",()=>showShare(form.slug));
  document.getElementById("publish").addEventListener("click",()=>changeStatus(form.id,"published"));
  document.getElementById("close-form").addEventListener("click",()=>changeStatus(form.id,"closed"));
  renderQuestions(locked);
  document.getElementById("add-text").addEventListener("click",()=>addQuestion("text",locked));
  document.getElementById("add-long").addEventListener("click",()=>addQuestion("textarea",locked));
  document.getElementById("add-choice").addEventListener("click",()=>addQuestion("radio",locked));
  document.getElementById("add-check").addEventListener("click",()=>addQuestion("checkbox",locked));
  document.getElementById("add-rating").addEventListener("click",()=>addQuestion("rating",locked));
  document.getElementById("form-editor").addEventListener("submit",async e=>{
    e.preventDefault(); if(locked) return;
    try {
      const body={title:document.getElementById("form-title").value,description:document.getElementById("form-description").value,questions:collectQuestions()};
      await api(`/api/admin/forms/${form.id}`,{method:"PUT",body:JSON.stringify(body)});
      toast("설문을 저장했습니다."); renderEditor(form.id);
    } catch(err){toast(err.message);}
  });
}
async function renderEditor(id) {
  const data=await api("/api/admin/forms");
  const form=data.forms.find(f=>f.id===id);
  if(!form){app.innerHTML='<section class="card">설문을 찾을 수 없습니다.</section>';return;}
  currentForm=form; currentQuestions=JSON.parse(JSON.stringify(form.questions)); editingId=id;
  const locked=form.status==="published"&&form.responseCount>0;
  renderEditorSkeleton(form,locked);
}
function renderQuestions(locked=false) {
  const holder=document.getElementById("questions");
  document.getElementById("question-count").textContent=`${currentQuestions.length}개`;
  if(!currentQuestions.length){holder.innerHTML='<div class="empty">질문을 추가해 주세요.</div>';return;}
  holder.innerHTML=currentQuestions.map((q,i)=>`<div class="question-card" data-question="${esc(q.id)}"><div class="question-head"><strong>질문 ${i+1}</strong><button type="button" class="btn danger small-btn" data-remove="${esc(q.id)}" ${locked?"disabled":""}>삭제</button></div><div class="field"><label>질문 내용</label><input class="input q-title" value="${esc(q.title)}" maxlength="300" ${locked?"disabled":""}></div><div class="question-fields"><div class="field"><label>질문 유형</label><select class="q-type" ${locked?"disabled":""}><option value="text" ${q.type==="text"?"selected":""}>단답형</option><option value="textarea" ${q.type==="textarea"?"selected":""}>장문형</option><option value="radio" ${q.type==="radio"?"selected":""}>객관식 (하나 선택)</option><option value="checkbox" ${q.type==="checkbox"?"selected":""}>복수 선택</option><option value="select" ${q.type==="select"?"selected":""}>드롭다운</option><option value="rating" ${q.type==="rating"?"selected":""}>점수형 (1~5)</option></select></div><div class="field"><label>응답 설정</label><label class="inline-check"><input class="q-required" type="checkbox" ${q.required?"checked":""} ${locked?"disabled":""}> 필수 질문</label></div></div>${["radio","checkbox","select"].includes(q.type)?`<div class="field"><label>선택지 (한 줄에 하나씩)</label><textarea class="q-options" ${locked?"disabled":""}>${esc((q.options||[]).join("\n"))}</textarea></div>`:""}</div>`).join("");
  holder.querySelectorAll("[data-remove]").forEach(el=>el.addEventListener("click",()=>{currentQuestions=currentQuestions.filter(q=>q.id!==el.dataset.remove);renderQuestions(locked);}));
  holder.querySelectorAll(".q-type").forEach(el=>el.addEventListener("change",()=>{collectQuestions();renderQuestions(locked);}));
}
function collectQuestions() {
  const updated=[];
  document.querySelectorAll("[data-question]").forEach(card=>{
    const old=currentQuestions.find(q=>q.id===card.dataset.question)||{};
    updated.push({id:old.id||crypto.randomUUID(),title:card.querySelector(".q-title")?.value||"질문",type:card.querySelector(".q-type")?.value||old.type||"text",required:card.querySelector(".q-required")?.checked||false,options:card.querySelector(".q-options")?.value.split("\n").map(x=>x.trim()).filter(Boolean)||[]});
  });
  currentQuestions=updated; return updated;
}
function addQuestion(type,locked) {
  if(locked)return;
  collectQuestions();
  currentQuestions.push({id:crypto.randomUUID(),title:"새 질문",type,required:false,options:["선택지 1","선택지 2"]});
  renderQuestions(false);
}
async function changeStatus(id,status) {
  try { await api(`/api/admin/forms/${id}/status`,{method:"POST",body:JSON.stringify({status})}); toast(status==="published"?"설문을 게시했습니다.":"설문 응답을 종료했습니다."); renderEditor(id); }
  catch(e){toast(e.message);}
}

async function renderPublic(slug) {
  const {form}=await api(`/api/public/forms/${slug}`);
  currentForm=form;
  app.innerHTML=`<div class="public-wrap"><header class="public-head"><h1>${esc(form.title)}</h1><p>${esc(form.description||"아래 질문에 응답해 주세요.")}</p></header><form class="card" id="public-form"><div id="public-questions"></div><button class="btn" style="width:100%">응답 제출</button><p class="muted small" style="text-align:center;margin:14px 0 0">제출 후에는 응답을 수정할 수 없습니다.</p></form></div>`;
  document.getElementById("public-questions").innerHTML=form.questions.map((q,i)=>{
    let control="";
    if(q.type==="text") control=`<input class="input" name="${esc(q.id)}" maxlength="5000" ${q.required?"required":""}>`;
    else if(q.type==="textarea") control=`<textarea name="${esc(q.id)}" maxlength="5000" ${q.required?"required":""}></textarea>`;
    else if(q.type==="rating") control=`<div class="rating-row">${[1,2,3,4,5].map(n=>`<label><input type="radio" name="${esc(q.id)}" value="${n}" ${q.required&&n===1?"required":""}>${n}</label>`).join("")}</div>`;
    else if(q.type==="select") control=`<select name="${esc(q.id)}" ${q.required?"required":""}><option value="">선택해 주세요</option>${q.options.map(o=>`<option value="${esc(o)}">${esc(o)}</option>`).join("")}</select>`;
    else control=q.options.map((o,j)=>`<label class="choice"><input type="${q.type==="checkbox"?"checkbox":"radio"}" name="${esc(q.id)}" value="${esc(o)}" ${q.required&&q.type==="radio"&&j===0?"required":""}><span>${esc(o)}</span></label>`).join("");
    return `<div class="public-question"><label class="title">${i+1}. ${esc(q.title)}${q.required?'<span class="required">*</span>':""}</label>${control}</div>`;
  }).join("");
  document.getElementById("public-form").addEventListener("submit",async e=>{
    e.preventDefault(); const answers={}; const fd=new FormData(e.currentTarget);
    for(const q of form.questions){const values=fd.getAll(q.id);answers[q.id]=q.type==="checkbox"?values:(q.type==="rating"?(values[0]||""):values[0]||"");}
    const btn=e.currentTarget.querySelector("button[type=submit],button:not([type])"); btn.disabled=true;
    try { await api(`/api/public/forms/${slug}`,{method:"POST",body:JSON.stringify({answers})}); app.innerHTML=`<div class="public-wrap"><section class="card empty"><div class="emoji">✓</div><strong>응답이 제출되었습니다.</strong><p>참여해 주셔서 감사합니다.</p></section></div>`; }
    catch(err){toast(err.message);btn.disabled=false;}
  });
}

async function renderResults(id) {
  const data=await api(`/api/admin/forms/${id}/results`); currentResults=data;
  app.innerHTML=`<div class="page-head"><div><h1>응답 결과</h1><p>${esc(data.form.title)} · 총 ${data.total}건</p></div><div class="top-actions"><button class="btn secondary" id="edit-form">설문 편집</button><button class="btn secondary" id="back">대시보드</button><button class="btn" id="export-csv">CSV 내보내기</button></div></div>
  <div class="stats-grid"><div class="stat-card"><span>전체 응답</span><strong>${data.total}</strong></div><div class="stat-card"><span>질문 수</span><strong>${data.form.questions.length}</strong></div><div class="stat-card"><span>상태</span><strong style="font-size:19px">${statusLabel(data.form.status)}</strong></div></div>
  <section class="card" style="margin-bottom:20px"><h2>질문별 통계</h2>${data.stats.map((s,i)=>`<div class="result-row"><strong>${i+1}. ${esc(s.question.title)}</strong><p class="muted small">${s.question.type==="text"||s.question.type==="textarea"?"주관식 응답":`응답 분포 · ${Object.values(s.counts).reduce((a,b)=>a+b,0)}개 선택`}</p>${Object.keys(s.counts).length?Object.entries(s.counts).sort((a,b)=>b[1]-a[1]).map(([label,count])=>`<div class="bar-row"><span>${esc(label)}</span><div class="bar-track"><div class="bar-fill" style="width:${data.total?Math.min(100,count/data.total*100):0}%"></div></div><span>${count}</span></div>`).join(""):`<p class="muted small">집계할 응답이 없습니다.</p>`}</div>`).join("")}</section>
  <section class="card"><div class="toolbar"><h2 style="margin:0">개별 응답 원문</h2><span class="muted small">${data.responses.length}건</span></div>${data.responses.length?data.responses.map((r,i)=>`<details class="response-card"><summary>응답 ${data.responses.length-i} · ${fmtDate(r.submittedAt)}</summary><div class="answer-list">${data.form.questions.map(q=>`<div class="answer-item"><strong>${esc(q.title)}</strong><p>${esc(Array.isArray(r.answers[q.id])?r.answers[q.id].join(", "):(r.answers[q.id]??"미응답"))}</p></div>`).join("")}</div></details>`).join(""):`<div class="empty">아직 접수된 응답이 없습니다.</div>`}</section>`;
  document.getElementById("back").addEventListener("click",()=>navigate("/"));
  document.getElementById("edit-form").addEventListener("click",()=>navigate(`/edit/${id}`));
  document.getElementById("export-csv").addEventListener("click",()=>exportCsv(data));
}
function exportCsv(data) {
  const cols=["응답 ID","제출 시각",...data.form.questions.map(q=>q.title)];
  const rows=data.responses.map(r=>[r.id,r.submittedAt,...data.form.questions.map(q=>Array.isArray(r.answers[q.id])?r.answers[q.id].join(", "):(r.answers[q.id]??""))]);
  const csv=[cols,...rows].map(row=>row.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\r\n");
  const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`survey-results-${data.form.slug}.csv`;a.click();URL.revokeObjectURL(a.href);
}
render();
