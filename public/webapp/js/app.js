/* ── Telegram WebApp Init ─────────────────────────────────────────────────── */
const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }
if (tg?.colorScheme === "light") document.body.classList.add("tg-light");

const API_BASE_URL = window.location.origin;

/* ── Jobs ─────────────────────────────────────────────────────────────────── */
let JOBS = [];
let CATEGORIES = ["All"];

async function loadJobs() {
  // API first — live data from Supabase. Static JSON is last-resort fallback only.
  const sources = [
    `${API_BASE_URL}/api/jobs`,
    `${API_BASE_URL}/webapp/jobs.json`,
  ];
  for (const url of sources) {
    try {
      const res = await fetch(`${url}?t=${Date.now()}`);
      if (!res.ok) continue;
      const text = await res.text();
      const data = JSON.parse(text.replace(/^\uFEFF/, ""));
      if (Array.isArray(data) && data.length) { JOBS = data; break; }
    } catch (e) { console.warn("Jobs source failed:", url, e); }
  }
  JOBS.forEach(j => { j.category = j.category || "General"; });
  CATEGORIES = ["All", ...new Set(JOBS.map(j => j.category).filter(Boolean))];
}

/* ── Form Steps ───────────────────────────────────────────────────────────── */
const STEPS = [
  {
    title: "Personal Info", desc: "Tell us a bit about yourself.",
    fields: [
      { id:"full_name",  label:"Full Name",      type:"text",   placeholder:"Abebe Kebede",        required:true },
      { id:"phone",      label:"Phone Number",   type:"tel",    placeholder:"+251 911 000000",      required:true },
      { id:"email",      label:"Email Address",  type:"email",  placeholder:"abebe@email.com",      required:true },
      { id:"age",        label:"Age",            type:"number", placeholder:"25",                   required:true, min:16, max:70 },
    ],
  },
  {
    title: "Background", desc: "Select your qualifications.",
    fields: [
      { id:"gender", label:"Gender", type:"options", required:true,
        options:[{value:"Male",icon:"👨",label:"Male"},{value:"Female",icon:"👩",label:"Female"}] },
      { id:"education", label:"Education Level", type:"options", required:true,
        options:[
          {value:"PhD / Masters",     icon:"🎓",label:"PhD / Masters"},
          {value:"Bachelor's Degree", icon:"🎓",label:"Bachelor's"},
          {value:"Diploma / TVET",    icon:"📜",label:"Diploma"},
          {value:"High School",       icon:"📚",label:"High School"},
        ]},
      { id:"experience", label:"Years of Experience", type:"options", required:true,
        options:[
          {value:"No Experience",    icon:"🆕",label:"No Experience"},
          {value:"Less than 1 year", icon:"⏱",label:"< 1 Year"},
          {value:"1 – 3 years",      icon:"📅",label:"1–3 Years"},
          {value:"3 – 5 years",      icon:"📅",label:"3–5 Years"},
          {value:"5+ years",         icon:"🏆",label:"5+ Years"},
        ]},
    ],
  },
  {
    title:"Cover Letter", desc:"Write a short bio about yourself and why you're the right fit.",
    fields:[{ id:"cover_letter", label:"Cover Letter / Bio", type:"textarea", required:true,
      placeholder:"I have 2 years of HR experience and I'm passionate about connecting people with the right opportunities…" }],
  },
  { title:"Portfolio Links", desc:"Add LinkedIn, GitHub, or portfolio links. Press Add after each.", type:"portfolio" },
  {
    title:"Attach CV", desc:"Upload your CV now — it gets sent directly to our team.",
    type:"file_upload",
  },
  { title:"Review & Submit", desc:"Confirm your details before submitting.", type:"review" },
];

/* ── State ────────────────────────────────────────────────────────────────── */
const state = {
  activePage:"home", activeCategory:"All", searchQuery:"",
  currentJob:null, formData:{}, portfolioLinks:[], step:0,
  uploadFiles:[],
};

const $ = id => document.getElementById(id);
const pages = {
  home:$(    "pageHome"),    detail:$("pageDetail"), apply:$("pageApply"),
  success:$("pageSuccess"), upload:$("pageUpload"), about:$("pageAbout"),
  myapps:$( "pageMyApps"),
};

/* ── Boot ─────────────────────────────────────────────────────────────────── */
setTimeout(() => {
  $("splash").classList.add("fade-out");
  setTimeout(async () => {
    $("splash").remove();
    $("app").classList.remove("hidden");
    await loadJobs();
    init();
  }, 400);
}, 1600);

function init() {
  const h = new Date().getHours();
  const name = tg?.initDataUnsafe?.user?.first_name;
  $("heroGreeting").textContent = name
    ? `Hey ${name} 👋`
    : h < 12 ? "Good morning 👋" : h < 17 ? "Good afternoon 👋" : "Good evening 👋";

  $("statTotal").textContent  = JOBS.length;
  $("statFull").textContent   = JOBS.filter(j => j.type === "Full-time").length;
  $("statRemote").textContent = JOBS.filter(j => j.remote === true || (j.location||"").toLowerCase().includes("remote")).length;

  renderCategories(); renderDepartments(); renderJobs();
  bindNav(); bindSearch();

  $("positionOptions").innerHTML = JOBS.map(j => `<option value="${j.title}">`).join("");

  $("btnBack").addEventListener("click", goBack);
  $("btnBackHome").addEventListener("click", () => navigate("home"));
  $("heroBrowseBtn")?.addEventListener("click", () => $("jobList")?.scrollIntoView({behavior:"smooth"}));
  $("heroUploadBtn")?.addEventListener("click", () => navigate("upload"));
  $("cvBannerBtn")?.addEventListener("click", () => navigate("upload"));
  $("btnSubmitUpload")?.addEventListener("click", handleUploadSubmit);
  $("btnDoneUpload")?.addEventListener("click", () => navigate("home"));
  if (tg) { tg.BackButton.onClick(goBack); tg.enableClosingConfirmation(); }

  // CV file input on upload page
  $("uCvFile")?.addEventListener("change", e => {
    state.uploadFiles = Array.from(e.target.files || []);
    const preview = $("filePreview");
    if (!preview) return;
    preview.innerHTML = state.uploadFiles.length
      ? state.uploadFiles.map(f => `<div class="file-chip">📎 ${f.name}</div>`).join("")
      : "No file selected";
  });
}

/* ── Categories ───────────────────────────────────────────────────────────── */
function renderCategories() {
  $("categoryChips").innerHTML = CATEGORIES.map(c =>
    `<button class="chip${c===state.activeCategory?" active":""}" data-cat="${c}">${c}</button>`
  ).join("");
  $("categoryChips").querySelectorAll(".chip").forEach(btn =>
    btn.addEventListener("click", () => {
      state.activeCategory = btn.dataset.cat;
      $("categoryChips").querySelectorAll(".chip").forEach(c =>
        c.classList.toggle("active", c.dataset.cat===state.activeCategory));
      renderJobs();
    })
  );
}

function renderDepartments() {
  const depts = {};
  JOBS.forEach(j => {
    const d = j.department || j.category || "General";
    if (!depts[d]) depts[d] = {count:0, icon:j.icon||"💼", color:j.color||"#d97706"};
    depts[d].count++;
  });
  $("departmentCount").textContent = Object.keys(depts).length;
  $("departmentList").innerHTML = Object.entries(depts).map(([name, data]) => `
    <div class="department-card">
      <div class="department-icon" style="background:${data.color}22">${data.icon}</div>
      <div><strong>${name}</strong><p>${data.count} position${data.count!==1?"s":""}</p></div>
    </div>`).join("");
}

/* ── Job List ─────────────────────────────────────────────────────────────── */
function filtered() {
  const q = state.searchQuery.toLowerCase();
  return JOBS.filter(j =>
    (state.activeCategory==="All" || j.category===state.activeCategory) &&
    (!q || (j.title||"").toLowerCase().includes(q) || (j.location||"").toLowerCase().includes(q) || (j.category||"").toLowerCase().includes(q))
  );
}

function renderJobs() {
  const jobs = filtered();
  $("listingCount").textContent = jobs.length;
  const empty = $("emptyState"), list = $("jobList");
  if (!jobs.length) { list.innerHTML=""; empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");
  list.innerHTML = jobs.map((j,i) => `
    <div class="job-card" data-id="${j.id}" style="animation-delay:${i*.06}s">
      <div class="job-card-top">
        <div class="job-icon" style="background:${j.color?j.color+"22":"rgba(108,99,255,.13)"}">${j.icon||"💼"}</div>
        <div class="job-card-info"><h4>${j.title}</h4><p>📍 ${j.location} · ${j.type}</p></div>
      </div>
      <div class="job-card-tags">
        <span class="tag tag-type">${j.type}</span>
        <span class="tag tag-loc">${j.location}</span>
        ${j.category?`<span class="tag tag-cat">${j.category}</span>`:""}
      </div>
      <div class="job-card-footer">
        <span class="job-cat-label">${j.salary?"💰 "+j.salary:(j.description||"").slice(0,40)+"…"}</span>
        <button class="btn-apply-sm" data-id="${j.id}">Apply Now</button>
      </div>
    </div>`).join("");
  list.querySelectorAll(".job-card").forEach(c =>
    c.addEventListener("click", e => { if (!e.target.closest(".btn-apply-sm")) openDetail(c.dataset.id); }));
  list.querySelectorAll(".btn-apply-sm").forEach(b =>
    b.addEventListener("click", () => openApply(b.dataset.id)));
}

/* ── Detail ───────────────────────────────────────────────────────────────── */
function openDetail(id) {
  const j = JOBS.find(x => String(x.id)===String(id)); if (!j) return;
  state.currentJob = j;
  const reqs = Array.isArray(j.requirements)
    ? j.requirements.map(r=>`<li>${r}</li>`).join("")
    : `<li>${j.requirements}</li>`;
  $("jobDetailContent").innerHTML = `
    <div class="detail-hero">
      <div class="detail-icon" style="background:${j.color?j.color+"22":"rgba(108,99,255,.13)"}">${j.icon||"💼"}</div>
      <h2>${j.title}</h2><p>${j.location} · ${j.type}</p>
      <div class="detail-tags">
        <span class="tag tag-type">${j.type}</span>
        <span class="tag tag-loc">📍 ${j.location}</span>
        ${j.category?`<span class="tag tag-cat">${j.category}</span>`:""}
        ${j.salary?`<span class="tag" style="background:rgba(34,197,94,.12);color:#22C55E">💰 ${j.salary}</span>`:""}
        ${j.deadline?`<span class="tag" style="background:rgba(245,158,11,.12);color:#F59E0B">⏳ ${j.deadline}</span>`:""}
      </div>
    </div>
    <div class="detail-body">
      <div class="detail-section"><h3>About the Role</h3><p>${j.description}</p></div>
      <div class="detail-section"><h3>Requirements</h3><ul class="req-list">${reqs}</ul></div>
      <div class="detail-apply-bar">
        <button class="btn-primary full" id="detailApplyBtn">Apply for this Position →</button>
      </div>
    </div>`;
  $("detailApplyBtn").addEventListener("click", () => openApply(j.id));
  navigate("detail", j.title);
}

/* ── Apply Flow ───────────────────────────────────────────────────────────── */
function openApply(id) {
  const j = JOBS.find(x => String(x.id)===String(id)); if (!j) return;
  state.currentJob=j; state.formData={position:j.title};
  state.portfolioLinks=[]; state.uploadFiles=[]; state.step=0;
  renderStep(); navigate("apply", `Apply — ${j.title}`);
  pages.apply.scrollTop=0;
}

function renderStep() {
  const s = STEPS[state.step];
  const pct = ((state.step+1)/STEPS.length)*100;
  $("progressBar").style.width = pct+"%";
  $("stepLabel").textContent = `Step ${state.step+1} of ${STEPS.length}`;
  if (s.type==="portfolio")    { renderPortfolioStep(); return; }
  if (s.type==="file_upload")  { renderFileUploadStep(); return; }
  if (s.type==="review")       { renderReviewStep(); return; }

  $("formSteps").innerHTML = `
    <div class="form-step">
      <h3>${s.title}</h3><p class="step-desc">${s.desc}</p>
      ${s.fields.map(renderField).join("")}
    </div>
    <div class="form-nav">
      ${state.step>0?`<button class="btn-secondary" id="btnPrev">← Back</button>`:""}
      <button class="btn-primary${state.step>0?"":""}" id="btnNext" style="${state.step===0?"width:100%":""}">Continue →</button>
    </div>`;

  s.fields.forEach(f => {
    if (f.type==="options") {
      document.querySelectorAll(`.option-btn[data-field="${f.id}"]`).forEach(b =>
        b.classList.toggle("selected", b.dataset.value===state.formData[f.id]));
    } else {
      const el = $(`field_${f.id}`);
      if (el && state.formData[f.id]) el.value = state.formData[f.id];
    }
  });

  document.querySelectorAll(".option-btn").forEach(btn =>
    btn.addEventListener("click", () => {
      document.querySelectorAll(`.option-btn[data-field="${btn.dataset.field}"]`).forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      state.formData[btn.dataset.field] = btn.dataset.value;
    })
  );
  $("btnNext")?.addEventListener("click", handleNext);
  $("btnPrev")?.addEventListener("click", () => { state.step--; renderStep(); pages.apply.scrollTop=0; });
}

function renderField(f) {
  if (f.type==="options") return `<div class="field"><label>${f.label}</label>
    <div class="option-grid">${f.options.map(o=>`
      <button class="option-btn" data-field="${f.id}" data-value="${o.value}">
        <span class="opt-icon">${o.icon}</span>${o.label}
      </button>`).join("")}</div>
    <div class="err-msg" id="err_${f.id}"></div></div>`;
  if (f.type==="textarea") return `<div class="field"><label>${f.label}</label>
    <textarea id="field_${f.id}" placeholder="${f.placeholder}" rows="5"></textarea>
    <div class="err-msg" id="err_${f.id}"></div></div>`;
  return `<div class="field"><label>${f.label}</label>
    <input id="field_${f.id}" type="${f.type}" placeholder="${f.placeholder}"
      ${f.min!==undefined?`min="${f.min}"`:""}${f.max!==undefined?` max="${f.max}"`:""}/>
    <div class="err-msg" id="err_${f.id}"></div></div>`;
}

/* ── Portfolio Step ───────────────────────────────────────────────────────── */
function renderPortfolioStep() {
  const s = STEPS[state.step];
  $("formSteps").innerHTML = `
    <div class="form-step">
      <h3>${s.title}</h3><p class="step-desc">${s.desc}</p>
      <div class="field">
        <label>Add Link</label>
        <input id="portfolioInput" type="url" placeholder="https://linkedin.com/in/yourname"/>
        <div class="err-msg" id="err_portfolio"></div>
      </div>
      <button class="btn-secondary full" id="btnAddLink" style="margin-bottom:16px">➕ Add Link</button>
      <div id="linkList" style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px">
        ${state.portfolioLinks.map((l,i)=>`
          <div style="display:flex;align-items:center;gap:10px;background:var(--surface2);border:1.5px solid var(--border);border-radius:var(--radius-sm);padding:10px 12px">
            <span>🔗</span>
            <span style="flex:1;font-size:.82rem;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l}</span>
            <button onclick="removeLink(${i})" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:1rem">✕</button>
          </div>`).join("")}
      </div>
      ${state.portfolioLinks.length===0?`<p style="font-size:.8rem;color:var(--text3);text-align:center;padding:8px 0">No links yet — that's fine!</p>`:""}
    </div>
    <div class="form-nav">
      <button class="btn-secondary" id="btnPrev">← Back</button>
      <button class="btn-primary" id="btnNext">Continue →</button>
    </div>`;
  $("btnAddLink").addEventListener("click", () => {
    const inp = $("portfolioInput"), val = inp.value.trim(), err = $("err_portfolio");
    if (!val) { err.textContent="Please enter a link first"; return; }
    if (!/^https?:\/\//i.test(val)) { err.textContent="Must start with http:// or https://"; return; }
    err.textContent=""; state.portfolioLinks.push(val); inp.value="";
    showToast("✅ Link added!"); renderPortfolioStep();
  });
  $("portfolioInput").addEventListener("keydown", e => { if(e.key==="Enter") $("btnAddLink").click(); });
  $("btnNext").addEventListener("click", ()=>{ state.step++; renderStep(); pages.apply.scrollTop=0; });
  $("btnPrev").addEventListener("click", ()=>{ state.step--; renderStep(); pages.apply.scrollTop=0; });
}
window.removeLink = i => { state.portfolioLinks.splice(i,1); renderPortfolioStep(); };

/* ── File Upload Step ─────────────────────────────────────────────────────── */
function renderFileUploadStep() {
  $("formSteps").innerHTML = `
    <div class="form-step">
      <h3>Attach Your CV</h3>
      <p class="step-desc">Upload your CV or resume. PDF, Word, or image. Max 10MB.</p>
      <div class="field">
        <label>CV / Resume</label>
        <input type="file" id="applyFileInput" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" multiple/>
        <div id="applyFilePreview" class="file-preview" style="margin-top:10px">No file selected</div>
      </div>
      <p style="font-size:.78rem;color:var(--text3);text-align:center;margin-top:4px">
        You can also skip and send your CV directly in the bot chat after submitting.
      </p>
    </div>
    <div class="form-nav">
      <button class="btn-secondary" id="btnPrev">← Back</button>
      <button class="btn-primary" id="btnNext">Continue →</button>
    </div>`;
  $("applyFileInput").addEventListener("change", e => {
    state.uploadFiles = Array.from(e.target.files||[]);
    const preview = $("applyFilePreview");
    preview.innerHTML = state.uploadFiles.length
      ? state.uploadFiles.map(f=>`<div class="file-chip">📎 ${f.name}</div>`).join("")
      : "No file selected";
  });
  $("btnNext").addEventListener("click", ()=>{ state.step++; renderStep(); pages.apply.scrollTop=0; });
  $("btnPrev").addEventListener("click", ()=>{ state.step--; renderStep(); pages.apply.scrollTop=0; });
}

/* ── Review Step ──────────────────────────────────────────────────────────── */
function renderReviewStep() {
  const d = state.formData;
  $("formSteps").innerHTML = `
    <div class="form-step">
      <h3>Review Application</h3>
      <p class="step-desc">Confirm your details before submitting.</p>
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:16px">
        ${row("💼 Position",d.position)} ${row("👤 Name",d.full_name)}
        ${row("📱 Phone",d.phone)} ${row("📧 Email",d.email)}
        ${row("🎂 Age",d.age)} ${row("⚧ Gender",d.gender)}
        ${row("🎓 Education",d.education)} ${row("📊 Experience",d.experience)}
        ${row("🔗 Portfolio",state.portfolioLinks.length?state.portfolioLinks.length+" link(s)":"None")}
        ${row("📎 CV",state.uploadFiles.length?state.uploadFiles.map(f=>f.name).join(", "):"To send in bot chat")}
        <div style="padding:8px 0;border-top:1px solid var(--border);margin-top:4px">
          <p style="font-size:.75rem;color:var(--text3);margin-bottom:4px">✍️ COVER LETTER</p>
          <p style="font-size:.83rem;color:var(--text2);line-height:1.6">${d.cover_letter||"—"}</p>
        </div>
      </div>
    </div>
    <div class="form-nav">
      <button class="btn-secondary" id="btnPrev">← Back</button>
      <button class="btn-primary" id="btnNext">Submit Application 📎</button>
    </div>`;
  $("btnNext").addEventListener("click", submitForm);
  $("btnPrev").addEventListener("click", ()=>{ state.step--; renderStep(); pages.apply.scrollTop=0; });
}
function row(label,value) {
  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)">
    <span style="font-size:.78rem;color:var(--text3)">${label}</span>
    <span style="font-size:.85rem;font-weight:600;max-width:55%;text-align:right">${value||"—"}</span>
  </div>`;
}

/* ── Validation ───────────────────────────────────────────────────────────── */
function handleNext() {
  const s = STEPS[state.step]; let valid = true;
  s.fields.forEach(f => {
    const err = $(`err_${f.id}`); if (!f.required) return;
    if (f.type==="options") {
      if (!state.formData[f.id]) { if(err) err.textContent="Please select an option"; valid=false; }
      else if(err) err.textContent="";
      return;
    }
    const el = $(`field_${f.id}`), val = el?.value.trim()||"";
    if(err) err.textContent="";
    if (!val) { if(err) err.textContent="This field is required"; el?.classList.add("error"); valid=false; return; }
    el.classList.remove("error");
    if (f.type==="email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
      if(err) err.textContent="Please enter a valid email"; el.classList.add("error"); valid=false; return; }
    if (f.type==="number" && (isNaN(+val)||+val<f.min||+val>f.max)) {
      if(err) err.textContent=`Must be between ${f.min} and ${f.max}`; el.classList.add("error"); valid=false; return; }
    if (f.id==="phone" && val.replace(/\D/g,"").length<9) {
      if(err) err.textContent="Please enter a valid phone number"; el.classList.add("error"); valid=false; return; }
    if (f.id==="cover_letter" && val.length<20) {
      if(err) err.textContent="Please write at least a couple of sentences"; el.classList.add("error"); valid=false; return; }
    state.formData[f.id] = val;
  });
  if (!valid) return;
  state.step++; renderStep(); pages.apply.scrollTop=0;
}

/* ── Submit ───────────────────────────────────────────────────────────────── */
async function submitForm() {
  const btn = $("btnNext");
  btn.disabled=true; btn.textContent="Submitting…";

  const payload = {
    ...state.formData,
    portfolio_links: state.portfolioLinks,
    submitted_at: new Date().toISOString(),
  };

  // Always POST to /api/upload so submissions are saved to Supabase.
  // initData is sent as a header so telegram_id is linked to the record,
  // making submissions visible in "My Apps".
  try {
    const fileData = await Promise.all((state.uploadFiles||[]).map(f => new Promise((res,rej)=>{
      const r = new FileReader();
      r.onload = () => res({name:f.name, type:f.type, data:r.result.split(",")[1]});
      r.onerror = rej;
      r.readAsDataURL(f);
    })));
    const headers = {"Content-Type":"application/json"};
    if (tg && tg.initData) headers["X-Telegram-Init-Data"] = tg.initData;
    const res = await fetch(`${API_BASE_URL}/api/upload`, {
      method:"POST", headers,
      body: JSON.stringify({payload, files: fileData}),
    });
    if (!res.ok) {
      const err = await res.json().catch(()=>({}));
      throw new Error(err.error||"Server error");
    }
    if (tg) tg.disableClosingConfirmation();
    showSuccess();
  } catch(e) {
    showToast("❌ Submission failed: "+e.message, 4000);
    btn.disabled=false; btn.textContent="Submit Application 📎";
  }
}

function showSuccess() {
  const d = state.formData;
  $("successMsg").textContent = `Your application for ${d.position} has been submitted!${(state.uploadFiles||[]).length===0?" Please upload your CV in the bot chat.":""}`;
  $("successDetails").innerHTML = `
    <div class="success-row"><span class="s-label">Name</span><span class="s-val">${d.full_name||"—"}</span></div>
    <div class="success-row"><span class="s-label">Position</span><span class="s-val">${d.position}</span></div>
    <div class="success-row"><span class="s-label">Phone</span><span class="s-val">${d.phone||"—"}</span></div>
    <div class="success-row"><span class="s-label">CV</span><span class="s-val">${(state.uploadFiles||[]).length?"Uploaded ✅":"Send in bot chat 📎"}</span></div>`;
  navigate("success","Application Sent!");
  state.formData={}; state.portfolioLinks=[]; state.uploadFiles=[];
}

/* ── Navigation ───────────────────────────────────────────────────────────── */
function navigate(page, title="Nova HR SM") {
  Object.entries(pages).forEach(([k,el])=>el.classList.toggle("active",k===page));
  $("headerTitle").textContent=title;
  state.activePage=page;
  const showBack=!["home","about","myapps"].includes(page);
  $("btnBack").classList.toggle("hidden",!showBack);
  document.querySelectorAll(".nav-item").forEach(b =>
    b.classList.toggle("active",
      b.dataset.page===page||
      (["detail","apply","success"].includes(page)&&b.dataset.page==="home")
    )
  );
  if (tg) tg.BackButton[showBack?"show":"hide"]();
  if (page==="myapps") loadMyApplications();
}

function goBack() {
  if (state.activePage==="apply") {
    if (state.step>0) { state.step--; renderStep(); return; }
    navigate("home"); return;
  }
  if (["detail","success"].includes(state.activePage)) { navigate("home"); return; }
}

/* ── My Applications — live fetch from API ────────────────────────────────── */
async function loadMyApplications() {
  const list=$("myAppsList"), empty=$("myAppsEmpty");
  list.innerHTML=`<div style="text-align:center;padding:32px;color:var(--text3)">⏳ Loading…</div>`;
  empty.classList.add("hidden");

  if (!tg?.initData||!tg?.initDataUnsafe?.user?.id) {
    list.innerHTML="";
    empty.classList.remove("hidden");
    empty.innerHTML=`<div class="empty-icon">📲</div>
      <p>Open from Telegram</p>
      <span>Open this app via the bot chat to view your applications</span>`;
    return;
  }

  try {
    const res = await fetch(`${API_BASE_URL}/api/submissions`, {
      headers:{"X-Telegram-Init-Data": tg.initData},
    });
    if (!res.ok) throw new Error("Server error "+res.status);
    const subs = await res.json();

    if (!subs.length) {
      list.innerHTML="";
      empty.classList.remove("hidden");
      empty.innerHTML=`<div class="empty-icon">📁</div>
        <p>No applications yet</p>
        <span>Apply for a job or upload your CV to get started</span>`;
      return;
    }

    const icons={pending:"⏳",pending_cv:"📎",accepted:"✅",rejected:"❌"};
    const labels={pending:"Under Review",pending_cv:"Awaiting CV",accepted:"Accepted 🎉",rejected:"Not Selected"};
    const colors={
      pending:"rgba(245,158,11,.12);color:#f59e0b;border:1px solid rgba(245,158,11,.25)",
      pending_cv:"rgba(96,165,250,.12);color:#60a5fa;border:1px solid rgba(96,165,250,.25)",
      accepted:"rgba(34,197,94,.12);color:#22c55e;border:1px solid rgba(34,197,94,.25)",
      rejected:"rgba(239,68,68,.12);color:#ef4444;border:1px solid rgba(239,68,68,.25)",
    };

    list.innerHTML=subs.map(s=>`
      <div class="my-app-card">
        <div class="my-app-header">
          <h3>${escHtml(s.position||"N/A")}</h3>
          <span class="app-status" style="background:${colors[s.status]||colors.pending}">${icons[s.status]||"⏳"} ${labels[s.status]||s.status}</span>
        </div>
        <div class="my-app-details">
          <p><strong>Applied:</strong> ${s.timestamp?new Date(s.timestamp).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}):""}</p>
          ${s.interview?`<p style="color:var(--warning)"><strong>📅 Interview:</strong> ${escHtml(s.interview)}</p>`:""}
          <p><strong>CV:</strong> ${s.cv_path?"✅ Uploaded":"📎 Send in bot chat"}</p>
        </div>
        ${s.status==="pending_cv"?`
          <div style="background:rgba(96,165,250,.08);border:1px solid rgba(96,165,250,.2);border-radius:10px;padding:10px 12px;margin-top:4px;font-size:.8rem;color:#60a5fa">
            📎 Please send your CV in the Telegram bot chat
          </div>`:""}
        ${s.status==="accepted"?`
          <div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:10px;padding:10px 12px;margin-top:4px;font-size:.8rem;color:#22c55e">
            🎉 Congratulations! Our team will contact you soon.
          </div>`:""}
      </div>`).join("");
  } catch(e) {
    list.innerHTML="";
    empty.classList.remove("hidden");
    empty.innerHTML=`<div class="empty-icon">❌</div><p>Could not load applications</p><span>${e.message}</span>`;
  }
}

function escHtml(s) {
  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

/* ── Bottom Nav ───────────────────────────────────────────────────────────── */
function bindNav() {
  document.querySelectorAll(".nav-item").forEach(b =>
    b.addEventListener("click", ()=>navigate(b.dataset.page)));
}

/* ── Search ───────────────────────────────────────────────────────────────── */
function bindSearch() {
  const bar=$("searchBar");
  $("btnSearch").addEventListener("click",()=>{
    bar.classList.toggle("hidden");
    if (!bar.classList.contains("hidden")) $("searchInput").focus();
  });
  $("btnClearSearch").addEventListener("click",()=>{
    $("searchInput").value=""; state.searchQuery="";
    bar.classList.add("hidden"); renderJobs();
  });
  $("searchInput").addEventListener("input", e=>{ state.searchQuery=e.target.value; renderJobs(); });
}

/* ── Upload Page CV submit ────────────────────────────────────────────────── */
async function handleUploadSubmit() {
  const name=$("uName")?.value.trim(), phone=$("uPhone")?.value.trim(), email=$("uEmail")?.value.trim();
  let valid=true;
  $("uNameErr").textContent=""; $("uPhoneErr").textContent=""; $("uEmailErr").textContent="";
  if (!name||name.length<2)          { $("uNameErr").textContent="Please enter your full name"; valid=false; }
  if (!phone||phone.replace(/\D/g,"").length<9) { $("uPhoneErr").textContent="Please enter a valid phone number"; valid=false; }
  if (!email||!email.includes("@"))  { $("uEmailErr").textContent="Please enter a valid email"; valid=false; }
  if (!valid) return;

  const btn=$("btnSubmitUpload");
  btn.disabled=true; btn.textContent="Submitting…";

  const docs=[];
  if ($("docCV")?.checked)        docs.push("CV / Resume");
  if ($("docCover")?.checked)     docs.push("Cover Letter");
  if ($("docCert")?.checked)      docs.push("Certificates");
  if ($("docPortfolio")?.checked) docs.push("Portfolio");

  const payload={
    type:"cv_upload", full_name:name, phone, email,
    position:$("uPosition")?.value.trim()||"Open to opportunities",
    bio:$("uBio")?.value.trim()||"", documents:docs,
    submitted_at:new Date().toISOString(),
  };

  // Read any attached file
  const files=state.uploadFiles||[];
  const fileData=await Promise.all(files.map(f=>new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=()=>res({name:f.name,type:f.type,data:r.result.split(",")[1]});
    r.onerror=rej; r.readAsDataURL(f);
  })));

  // Always POST to API so files are stored in Supabase storage
  try {
    const headers={"Content-Type":"application/json"};
    if (tg&&tg.initData) headers["X-Telegram-Init-Data"]=tg.initData;
    await fetch(`${API_BASE_URL}/api/upload`,{
      method:"POST", headers, body:JSON.stringify({payload,files:fileData}),
    });
  } catch(e) { console.warn("Upload API error:", e); }

  btn.disabled=false; btn.textContent="Submit & Upload Documents →";
  $("uploadForm").classList.add("hidden");
  $("uploadInstructions").classList.remove("hidden");
  if (!$("docCover")?.checked) $("instrCover").classList.add("hidden");
  if (!$("docCert")?.checked)  $("instrCert").classList.add("hidden");
  if (!$("docPortfolio")?.checked) $("instrPortfolio").classList.add("hidden");
  showToast("✅ Profile submitted!");
}

/* ── Toast ────────────────────────────────────────────────────────────────── */
let toastTimer;
function showToast(msg, duration=2200) {
  const t=$("toast"); t.textContent=msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove("show"),duration);
}
