import { Archive, ArrowDownToLine, ArrowRight, BriefcaseBusiness, Check, ChevronDown, ClipboardCheck, Clock3, FileArchive, FilePlus2, FileText, Filter, FolderLock, FolderOpen, Landmark, LockKeyhole, MoreHorizontal, Search, ShieldCheck, UploadCloud, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Modal, Shell, Status, Toast } from "./_shared";

type Visibility = "Private" | "Shared";
type DocumentCategory = "Applications" | "Resident records" | "Referrals & waivers" | "Organization" | "Financials" | "Forms & resources";
type DocumentRecord = {
  id: number;
  name: string;
  category: DocumentCategory;
  owner: string;
  date: string;
  status: "Current" | "Needs review" | "Pending signature" | "Ready to file";
  type: "PDF" | "DOCX" | "XLSX" | "JPG";
  visibility: Visibility;
  detail: string;
};

const documentsSeed: DocumentRecord[] = [
  { id: 1, name: "Mia Hernandez · admission packet", category: "Applications", owner: "Alex Morgan", date: "Oct 15, 2024", status: "Ready to file", type: "PDF", visibility: "Private", detail: "Prospective client · 8 files · received Oct 14" },
  { id: 2, name: "Jordan Lee · recovery plan & releases", category: "Resident records", owner: "Maya Patel", date: "Oct 14, 2024", status: "Current", type: "PDF", visibility: "Private", detail: "Northside House · resident profile" },
  { id: 3, name: "Bexar County referral waiver · 2024", category: "Referrals & waivers", owner: "Maya Patel", date: "Oct 11, 2024", status: "Pending signature", type: "PDF", visibility: "Private", detail: "Jordan Lee · Bexar County supervision" },
  { id: 4, name: "Specialty Court release of information", category: "Referrals & waivers", owner: "Alex Morgan", date: "Oct 08, 2024", status: "Current", type: "PDF", visibility: "Private", detail: "Reusable referral language · staff only" },
  { id: 5, name: "501(c)(3) determination letter", category: "Organization", owner: "Erin Cole", date: "Sep 30, 2024", status: "Current", type: "PDF", visibility: "Shared", detail: "Donation and grant documentation · organization" },
  { id: 6, name: "September 2024 operating statement", category: "Financials", owner: "Erin Cole", date: "Oct 07, 2024", status: "Needs review", type: "XLSX", visibility: "Shared", detail: "Current financials · internal leadership access" },
  { id: 7, name: "Monthly donor acknowledgement letter", category: "Forms & resources", owner: "Erin Cole", date: "Sep 26, 2024", status: "Current", type: "DOCX", visibility: "Shared", detail: "Reusable template · development team" },
  { id: 8, name: "House incident report form", category: "Forms & resources", owner: "Alex Morgan", date: "Sep 18, 2024", status: "Current", type: "DOCX", visibility: "Shared", detail: "Operational resource · all staff" },
  { id: 9, name: "Tanya Brooks · ID and insurance card", category: "Resident records", owner: "Alex Morgan", date: "Oct 12, 2024", status: "Current", type: "JPG", visibility: "Private", detail: "Eastlake House · resident profile" },
];

const categories: { name: DocumentCategory; count: number; icon: typeof FileText; tone: string; note: string }[] = [
  { name: "Applications", count: 6, icon: ClipboardCheck, tone: "#f6e6ed", note: "Prospective clients" },
  { name: "Resident records", count: 24, icon: FolderLock, tone: "#e4efec", note: "Private profiles" },
  { name: "Referrals & waivers", count: 11, icon: ShieldCheck, tone: "#e3ebf2", note: "Court and county" },
  { name: "Organization", count: 18, icon: Landmark, tone: "#f4e6ca", note: "Shared admin files" },
  { name: "Financials", count: 8, icon: BriefcaseBusiness, tone: "#eee6dd", note: "Current reporting" },
  { name: "Forms & resources", count: 31, icon: FileArchive, tone: "#f6e6ed", note: "Reusable templates" },
];

function FileType({ type }: { type: DocumentRecord["type"] }) {
  const tone = type === "PDF" ? "#a2185b" : type === "XLSX" ? "#226052" : "#274a74";
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: tone, fontSize: 10, fontWeight: 800 }}><FileText size={14} />{type}</span>;
}

function VisibilityCue({ visibility }: { visibility: Visibility }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: visibility === "Private" ? "#7d1046" : "#226052", fontSize: 10, fontWeight: 700 }}><span style={{ display: "grid", placeItems: "center", width: 22, height: 22, borderRadius: 7, background: visibility === "Private" ? "#f6e6ed" : "#e4efec" }}>{visibility === "Private" ? <LockKeyhole size={12} /> : <UsersRound size={12} />}</span>{visibility}</span>;
}

function DocumentRow({ document, onOpen, onDownload }: { document: DocumentRecord; onOpen: () => void; onDownload: () => void }) {
  return <div className="rh-table-row" style={{ gridTemplateColumns: "minmax(270px, 1.65fr) minmax(135px, .9fr) minmax(126px, .9fr) minmax(130px, .8fr) auto" }}>
    <span style={{ minWidth: 0 }}><button onClick={onOpen} style={{ display: "block", padding: 0, border: 0, color: "var(--rh-ink)", background: "transparent", textAlign: "left", fontSize: 13, fontWeight: 700 }}><span style={{ display: "flex", alignItems: "center", gap: 9 }}><span style={{ display: "grid", placeItems: "center", flex: "none", width: 31, height: 34, borderRadius: 8, background: "#fbf0f4", color: "#a2185b" }}><FileText size={16} /></span><span style={{ minWidth: 0 }}><strong style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{document.name}</strong><span style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 4 }}><small style={{ color: "var(--rh-muted)", fontSize: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{document.detail}</small><FileType type={document.type} /></span></span></span></button></span>
    <span><VisibilityCue visibility={document.visibility} /></span>
    <span style={{ color: "var(--rh-muted)", fontSize: 11 }}>{document.owner}<br /><span style={{ fontSize: 10 }}>{document.date}</span></span>
    <span><Status value={document.status} /></span>
    <span style={{ display: "flex", justifyContent: "flex-end", gap: 3 }}><button className="rh-button ghost" onClick={onDownload} aria-label={`Download ${document.name}`}><ArrowDownToLine size={15} /></button><button className="rh-button ghost" onClick={onOpen} aria-label={`Open ${document.name}`}><MoreHorizontal size={16} /></button></span>
  </div>;
}

function UploadModal({ onClose, onAdd }: { onClose: () => void; onAdd: (document: DocumentRecord) => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<DocumentCategory>("Forms & resources");
  const [visibility, setVisibility] = useState<Visibility>("Shared");
  const [type, setType] = useState<DocumentRecord["type"]>("PDF");
  const [fileName, setFileName] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    onAdd({ id: Date.now(), name: name.trim(), category, visibility, type, owner: "Alex Morgan", date: "Oct 15, 2024", status: "Current", detail: visibility === "Private" ? "Staff-only document · newly added" : "Organization resource · newly added" });
  };
  return <Modal title="Add a document" description="Keep the access level visible from the start. Private files stay attached to a resident or application; shared files are available to staff with the right role." onClose={onClose}>
    <form className="rh-form-grid" onSubmit={submit}>
      <label>Document name<input className="rh-field" autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. October house meeting notes" required /></label>
      <label>Collection<select className="rh-field" value={category} onChange={(event) => setCategory(event.target.value as DocumentCategory)}>{categories.map((item) => <option key={item.name}>{item.name}</option>)}</select></label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}><label>File type<select className="rh-field" value={type} onChange={(event) => setType(event.target.value as DocumentRecord["type"])}><option>PDF</option><option>DOCX</option><option>XLSX</option><option>JPG</option></select></label><label>Access<select className="rh-field" value={visibility} onChange={(event) => setVisibility(event.target.value as Visibility)}><option>Shared</option><option>Private</option></select></label></div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 13, border: "1px dashed #d7cfc8", borderRadius: 10, background: "#fbf9f6", color: "var(--rh-muted)", fontSize: 11 }}><UploadCloud size={17} color="#a2185b" /><span><strong style={{ display: "block", color: "var(--rh-ink)", fontSize: 12 }}>{fileName || "Choose a file"}</strong>{fileName ? "Ready to attach to this record" : "PDF, DOCX, XLSX, or JPG · up to 25 MB"}</span><label className="rh-button secondary" style={{ marginLeft: "auto", minHeight: 32, fontSize: 11 }}>Browse<input type="file" accept=".pdf,.docx,.xlsx,.jpg,.jpeg" onChange={(event) => setFileName(event.target.files?.[0]?.name ?? "")} style={{ position: "absolute", width: 1, height: 1, opacity: 0 }} /></label></div>
      <div className="rh-form-actions"><button type="button" className="rh-button secondary" onClick={onClose}>Cancel</button><button type="submit" className="rh-button"><FilePlus2 size={15} /> Add document</button></div>
    </form>
  </Modal>;
}

const reviewSteps = ["Basic information", "Recovery & referral history", "Recovery supports", "Health & wellness", "Life stability", "Reflection & agreement"];

function ReviewField({ label, children, wide = false, hint }: { label: string; children: ReactNode; wide?: boolean; hint?: string }) {
  return <label className={wide ? "rh-review-wide" : ""} style={{ display: "grid", gap: 6, color: "var(--rh-muted)", fontSize: 11, fontWeight: 700 }}>{label}{children}{hint && <small style={{ color: "var(--rh-muted)", fontSize: 10, fontWeight: 500, lineHeight: 1.4 }}>{hint}</small>}</label>;
}

function ReviewInput({ value, placeholder }: { value?: string; placeholder?: string }) {
  return <input className="rh-field" defaultValue={value} placeholder={placeholder} />;
}

function ReviewText({ value, placeholder }: { value?: string; placeholder?: string }) {
  return <textarea className="rh-field" defaultValue={value} placeholder={placeholder} style={{ minHeight: 104, paddingTop: 11, resize: "vertical", lineHeight: 1.5 }} />;
}

function ApplicationReview({ onClose, onAdmit, onSaveDraft, onClarify }: { onClose: () => void; onAdmit: () => void; onSaveDraft: () => void; onClarify: () => void }) {
  const [step, setStep] = useState(0);
  const [consent, setConsent] = useState(false);
  const [signature, setSignature] = useState("");
  const isLast = step === reviewSteps.length - 1;
  const canAdmit = isLast && consent && signature.trim().length > 1;
  const next = () => setStep((current) => Math.min(current + 1, reviewSteps.length - 1));
  const previous = () => setStep((current) => Math.max(current - 1, 0));
  const renderStep = () => {
    if (step === 0) return <ReviewPanel eyebrow="01 / Basic information" title="Tell us who is applying" description="Use the applicant's legal name for the resident record, then capture the name and contact details they want the community to use.">
      <div className="rh-review-form-grid">
        <ReviewField label="Legal name"><ReviewInput value="Mia Hernandez" /></ReviewField><ReviewField label="Preferred name"><ReviewInput value="Mia" /></ReviewField>
        <ReviewField label="Gender"><ReviewInput value="Prefer not to say" /></ReviewField><ReviewField label="Race"><ReviewInput value="Prefer not to say" /></ReviewField>
        <ReviewField label="Ethnicity"><ReviewInput value="Prefer not to say" /></ReviewField><ReviewField label="Phone"><ReviewInput value="(210) 555-0184" /></ReviewField>
        <ReviewField label="Address" wide><ReviewInput value="Address collected at intake" /></ReviewField>
        <ReviewField label="Email"><ReviewInput value="mia.hernandez@example.com" /></ReviewField><ReviewField label="Emergency contact"><ReviewInput value="To be confirmed with applicant" /></ReviewField>
      </div>
    </ReviewPanel>;
    if (step === 1) return <ReviewPanel eyebrow="02 / Recovery & referral history" title="Understand the path here" description="This context helps the admissions team prepare a supportive first conversation and verify the right referral paperwork.">
      <div className="rh-review-form-grid">
        <ReviewField label="Has the applicant been in treatment recently?"><select className="rh-field" defaultValue="Yes — details to confirm"><option>Yes — details to confirm</option><option>No</option><option>Prefer not to say</option></select></ReviewField>
        <ReviewField label="Treatment center or program"><ReviewInput value="Program name to confirm" /></ReviewField>
        <ReviewField label="Who referred the applicant?"><ReviewInput value="Bexar County community supervision" /></ReviewField>
        <ReviewField label="Referral contact"><ReviewInput value="Contact information to confirm" /></ReviewField>
        <ReviewField label="Has the applicant lived in sober living before?"><select className="rh-field" defaultValue="Yes — history to confirm"><option>Yes — history to confirm</option><option>No</option><option>Prefer not to say</option></select></ReviewField>
        <ReviewField label="Homes or programs"><ReviewInput value="Previous homes or programs to confirm" /></ReviewField>
        <ReviewField label="Referral notes" wide hint="Keep notes factual and relevant to admission planning."><ReviewText placeholder="Add context from the referral conversation…" /></ReviewField>
      </div>
    </ReviewPanel>;
    if (step === 2) return <ReviewPanel eyebrow="03 / Recovery supports" title="Map the supports already in place" description="A clear picture of current supports helps staff make a warm handoff instead of starting from zero.">
      <div className="rh-review-form-grid">
        <ReviewField label="Current sponsor"><ReviewInput value="Name to confirm with applicant" /></ReviewField>
        <ReviewField label="Drug of choice"><ReviewInput value="To be discussed privately with applicant" /></ReviewField>
        <ReviewField label="Anonymous or other support groups" wide><ReviewText value="Meeting names, frequency, and preferred support spaces to confirm." /></ReviewField>
        <ReviewField label="Support person notes" wide hint="This is part of the private application record."><ReviewText placeholder="What should the house team know for the first week?" /></ReviewField>
      </div>
    </ReviewPanel>;
    if (step === 3) return <ReviewPanel eyebrow="04 / Health & wellness" title="Handle wellness information with care" description="Only collect what is needed to support a safe stay. This section is restricted and should remain visible only to role-based staff with a care need.">
      <div style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: 13, marginBottom: 18, border: "1px solid #e5cad6", borderRadius: 11, background: "#fff7fa" }}><span style={{ display: "grid", placeItems: "center", flex: "none", width: 30, height: 30, borderRadius: 9, color: "#7d1046", background: "#f6e6ed" }}><LockKeyhole size={15} /></span><span style={{ color: "#7d1046", fontSize: 11, lineHeight: 1.5 }}><strong style={{ display: "block", marginBottom: 2 }}>Restricted · private health information</strong>Role-based staff access only. Do not add unnecessary diagnoses or medical detail to this application.</span></div>
      <div className="rh-review-form-grid">
        <ReviewField label="Mental or physical disabilities"><select className="rh-field" defaultValue="Not provided in demo record"><option>Not provided in demo record</option><option>Yes — details require private review</option><option>No</option><option>Prefer not to say</option></select></ReviewField>
        <ReviewField label="Details, if needed" hint="No medical details are shown in this demo."><ReviewInput placeholder="Restricted note — collect only what is necessary" /></ReviewField>
        <ReviewField label="Does the applicant take medication?"><select className="rh-field" defaultValue="Not answered"><option>Not answered</option><option>Yes — medication review required</option><option>No</option><option>Prefer not to say</option></select></ReviewField>
        <ReviewField label="Prescribed medications" hint="Keep medication details in the restricted resident record."><ReviewInput placeholder="No medical details shown in demo" /></ReviewField>
        <ReviewField label="Wellness accommodations or safety notes" wide><ReviewText placeholder="Restricted note — role-based staff only" /></ReviewField>
      </div>
    </ReviewPanel>;
    if (step === 4) return <ReviewPanel eyebrow="05 / Life stability" title="Plan for the next season" description="Employment and education context helps the team make practical plans with the resident once they move in.">
      <div className="rh-review-form-grid">
        <ReviewField label="Employment status"><select className="rh-field" defaultValue="Seeking employment"><option>Seeking employment</option><option>Employed</option><option>Part-time work</option><option>Not currently working</option><option>Prefer not to say</option></select></ReviewField>
        <ReviewField label="Employer details"><ReviewInput value="To be discussed after admission" /></ReviewField>
        <ReviewField label="Education completed"><ReviewInput value="High school or equivalent · confirm" /></ReviewField>
        <ReviewField label="Practical goals" wide><ReviewText placeholder="Transportation, work, education, or other stability goals…" /></ReviewField>
      </div>
    </ReviewPanel>;
    return <ReviewPanel eyebrow="06 / Spiritual reflection & agreement" title="Make room for reflection" description="These prompts are intentionally open. Preserve the applicant's words and use them to begin a respectful conversation in community.">
      <div className="rh-review-form-grid">
        <ReviewField label="What does surrender mean to you?" wide><ReviewText placeholder="Applicant's response…" /></ReviewField>
        <ReviewField label="What do you hope to gain by joining the community at Redeemer House?" wide><ReviewText placeholder="Applicant's response…" /></ReviewField>
      </div>
      <div style={{ marginTop: 20, paddingTop: 19, borderTop: "1px solid var(--rh-line)" }}><div className="rh-kicker">ONEsource statement</div><p style={{ margin: "9px 0 0", color: "var(--rh-ink)", fontSize: 12, lineHeight: 1.7 }}>ONEsource is a spiritual journey to find oneness with God in everyday living. We are not religious and do not intend to force religion on anyone. This is a free space to explore, ask questions, learn and grow in spiritual understanding of God as we understand him. Through this process we hope to grow and maintain a community with one another and God, seeking confident connection and trust with one another is vital to overcoming the secrets we have kept hidden and taking new steps to find who we are in God and who we were created to be.</p></div>
      <div style={{ marginTop: 17, padding: 14, borderRadius: 11, background: "#fbf7f8" }}><label style={{ display: "flex", alignItems: "flex-start", gap: 10, color: "var(--rh-ink)", fontSize: 11, lineHeight: 1.55 }}><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} style={{ width: 16, height: 16, marginTop: 1, accentColor: "#a2185b" }} /><span>By continuing, you agree that your electronic signature is the legally binding equivalent to your handwritten signature. Whenever you execute an electronic signature, it has the same validity and meaning as your handwritten signature. You will not, at any time in the future, repudiate the meaning of your electronic signature or claim that your electronic signature is not legally binding.</span></label><label style={{ display: "grid", gap: 6, marginTop: 15, color: "var(--rh-muted)", fontSize: 11, fontWeight: 700 }}>Electronic signature<input className="rh-field" value={signature} onChange={(event) => setSignature(event.target.value)} placeholder="Type full legal name" aria-required="true" /></label></div>
    </ReviewPanel>;
  };
  return <div className="rh-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="rh-review-shell" role="dialog" aria-modal="true" aria-labelledby="rh-review-title">
    <header className="rh-review-header"><div><div className="rh-kicker" style={{ color: "#a2185b" }}>Admissions review · private application</div><h2 id="rh-review-title">Mia Hernandez</h2><p>Northside House · received Oct 14, 2024 · owner Alex Morgan</p></div><button className="rh-button ghost" onClick={onClose} aria-label="Close application review">Close</button></header>
    <div className="rh-review-progress"><span>Step {step + 1} of {reviewSteps.length}</span><strong>{reviewSteps[step]}</strong><span style={{ marginLeft: "auto", color: "#226052" }}>{step + 1 === reviewSteps.length ? "Final review" : "Draft · autosaved"}</span></div>
    <div className="rh-review-layout"><aside className="rh-review-stepper" aria-label="Application sections"><div className="rh-kicker">Application sections</div><nav>{reviewSteps.map((label, index) => <button key={label} className={`rh-review-step ${step === index ? "active" : ""}`} onClick={() => setStep(index)}><span className="rh-review-number">{index < step ? <Check size={12} /> : String(index + 1).padStart(2, "0")}</span><span><strong>{label}</strong><small>{index < step ? "Reviewed" : index === step ? "In progress" : "Not started"}</small></span></button>)}</nav><div className="rh-review-destination"><div className="rh-kicker">After approval</div><strong>Client profile</strong><span>New resident record · Northside House</span></div></aside><div className="rh-review-body">{renderStep()}</div></div>
    <footer className="rh-review-footer"><div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--rh-muted)", fontSize: 11 }}><span style={{ display: "grid", placeItems: "center", width: 22, height: 22, borderRadius: "50%", color: "#226052", background: "#e4efec" }}><Check size={12} /></span>Private application · changes saved to review draft</div><div style={{ display: "flex", gap: 9, marginLeft: "auto" }}><button className="rh-button ghost" onClick={onSaveDraft}>Save draft</button><button className="rh-button secondary" onClick={onClarify}>Request clarification</button>{step > 0 && <button className="rh-button secondary" onClick={previous}>Back</button>}{!isLast ? <button className="rh-button" onClick={next}>Next section <ArrowRight size={14} /></button> : <button className="rh-button" disabled={!canAdmit} onClick={onAdmit} style={{ opacity: canAdmit ? 1 : .52, cursor: canAdmit ? "pointer" : "not-allowed" }}><Check size={15} /> Approve & admit</button>}</div></footer>
  </section></div>;
}

function ReviewPanel({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: ReactNode }) {
  return <section className="rh-review-panel"><div className="rh-kicker" style={{ color: "#a2185b" }}>{eyebrow}</div><h3>{title}</h3><p className="rh-review-description">{description}</p>{children}</section>;
}

export default function Documents() {
  const [documents, setDocuments] = useState(documentsSeed);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"All files" | Visibility | DocumentCategory>("All files");
  const [showUpload, setShowUpload] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [selected, setSelected] = useState<DocumentRecord | null>(null);
  const [toast, setToast] = useState("");
  const visibleDocuments = useMemo(() => documents.filter((document) => {
    const matchesQuery = `${document.name} ${document.detail} ${document.owner}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === "All files" || document.visibility === filter || document.category === filter;
    return matchesQuery && matchesFilter;
  }), [documents, filter, query]);
  const addDocument = (document: DocumentRecord) => { setDocuments((current) => [document, ...current]); setShowUpload(false); setToast(`${document.name} added to ${document.category}.`); };
  const openDocument = (document: DocumentRecord) => setSelected(document);
  const downloadDocument = (document: DocumentRecord) => setToast(`${document.name} is ready to download.`);
  const admitApplication = () => { setShowReview(false); setDocuments((current) => current.map((item) => item.id === 1 ? { ...item, status: "Current", category: "Resident records", detail: "Mia Hernandez · new resident profile · linked from application" } : item)); setToast("Mia Hernandez moved into the resident profile."); };
  return <Shell active="Documents"><div className="rh-page-head">
    <div><div className="rh-kicker">Staff workspace · shared recordkeeping</div><h1>Documents</h1><p>One careful place for applications, resident records, and the resources that keep the house moving.</p></div>
    <button className="rh-button" onClick={() => setShowUpload(true)}><FilePlus2 size={16} /> Add document</button>
  </div>

  <div className="rh-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginTop: 32 }}>
    <div className="rh-card rh-metric"><div className="rh-metric-top"><span className="rh-kicker">In library</span><span className="rh-metric-icon" style={{ background: "#e3ebf2" }}><FolderOpen size={17} /></span></div><strong>{documents.length + 75}</strong><small>Across six collections</small></div>
    <div className="rh-card rh-metric"><div className="rh-metric-top"><span className="rh-kicker">Needs attention</span><span className="rh-metric-icon" style={{ background: "#f6e6ed" }}><Clock3 size={17} /></span></div><strong>3</strong><small>Review or signature needed</small></div>
    <div className="rh-card rh-metric"><div className="rh-metric-top"><span className="rh-kicker">Private files</span><span className="rh-metric-icon" style={{ background: "#f4e6ca" }}><LockKeyhole size={17} /></span></div><strong>41</strong><small>Resident and application records</small></div>
    <div className="rh-card rh-metric"><div className="rh-metric-top"><span className="rh-kicker">Shared resources</span><span className="rh-metric-icon" style={{ background: "#e4efec" }}><UsersRound size={17} /></span></div><strong>57</strong><small>Role-based staff access</small></div>
  </div>

  <section className="rh-card" style={{ marginTop: 18, overflow: "hidden", borderColor: "#d9b8c7", background: "#fffafc" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 15, padding: "17px 22px", borderBottom: "1px solid #efdce5" }}><span style={{ display: "grid", placeItems: "center", flex: "none", width: 39, height: 39, borderRadius: 12, color: "#a2185b", background: "#f6e6ed" }}><ClipboardCheck size={19} /></span><div style={{ minWidth: 0, flex: 1 }}><div className="rh-kicker" style={{ color: "#a2185b" }}>Admissions handoff · 1 ready</div><strong style={{ display: "block", marginTop: 4, fontFamily: "Fraunces, Georgia, serif", fontSize: 21 }}>Mia Hernandez's application is ready to become a resident record.</strong><span style={{ display: "block", marginTop: 4, color: "var(--rh-muted)", fontSize: 11 }}>All required documents verified · Northside House · reviewed by Alex Morgan today</span></div><Status value="Ready to file" /><button className="rh-button" onClick={() => setShowReview(true)} style={{ flex: "none" }}>Review & admit <ArrowRight size={14} /></button></div>
  </section>

  <div className="rh-grid" style={{ gridTemplateColumns: "minmax(0, 1.55fr) minmax(270px, .45fr)", marginTop: 18, alignItems: "start" }}>
    <section className="rh-card rh-table" aria-label="Document library">
      <div className="rh-card-header" style={{ paddingBottom: 16 }}><div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 16 }}><div><div className="rh-kicker">Document library</div><h2>Everything in one place</h2></div><button className="rh-button ghost" onClick={() => { setQuery(""); setFilter("All files"); }}>Clear view</button></div>
        <div className="rh-tools" style={{ padding: "18px 0 0" }}><div className="rh-search-wrap"><Search size={16} /><input className="rh-field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search names, owners, or document details" aria-label="Search documents" /></div><div style={{ position: "relative", minWidth: 174 }}><Filter size={14} style={{ position: "absolute", left: 12, top: 14, zIndex: 1, color: "var(--rh-muted)" }} /><select className="rh-field" style={{ paddingLeft: 34, appearance: "none" }} value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} aria-label="Filter documents"><option>All files</option><option>Private</option><option>Shared</option>{categories.map((item) => <option key={item.name}>{item.name}</option>)}</select><ChevronDown size={14} style={{ position: "absolute", right: 12, top: 14, color: "var(--rh-muted)", pointerEvents: "none" }} /></div></div>
      </div>
      <div className="rh-table-head" style={{ gridTemplateColumns: "minmax(270px, 1.65fr) minmax(135px, .9fr) minmax(126px, .9fr) minmax(130px, .8fr) auto" }}><span>Document</span><span>Access</span><span>Owner / updated</span><span>Status</span><span /></div>
      {visibleDocuments.length ? visibleDocuments.map((document) => <DocumentRow key={document.id} document={document} onOpen={() => openDocument(document)} onDownload={() => downloadDocument(document)} />) : <div className="rh-empty"><Archive size={25} style={{ marginBottom: 9, color: "#a2185b" }} /><strong>No documents match that view</strong><span>Try a different name, collection, or access filter.</span></div>}
    </section>

    <aside style={{ display: "grid", gap: 16 }}>
      <section className="rh-card" style={{ overflow: "hidden" }}><header className="rh-card-header"><div className="rh-kicker">Collections</div><h2>Find by purpose</h2></header>{categories.map(({ name, count, icon: Icon, tone, note }) => <button key={name} onClick={() => setFilter(name)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "12px 17px", border: 0, borderBottom: "1px solid var(--rh-line)", color: "var(--rh-ink)", background: filter === name ? "#fff8fb" : "transparent", textAlign: "left" }}><span style={{ display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: 9, background: tone, color: "#142b55" }}><Icon size={15} /></span><span style={{ flex: 1 }}><strong style={{ display: "block", fontSize: 11 }}>{name}</strong><small style={{ display: "block", marginTop: 3, color: "var(--rh-muted)", fontSize: 10 }}>{note}</small></span><span style={{ color: "var(--rh-muted)", fontSize: 11 }}>{count}</span><ArrowRight size={13} color="var(--rh-muted)" /></button>)}</section>
      <section className="rh-card" style={{ padding: 20, background: "#142b55", color: "#fff", borderColor: "#142b55" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}><div className="rh-kicker" style={{ color: "#e8c5d4" }}>Access map</div><ShieldCheck size={18} color="#e8c5d4" /></div><h2 style={{ margin: "8px 0 9px", fontFamily: "Fraunces, Georgia, serif", fontSize: 24, fontWeight: 500 }}>Private by default.</h2><p style={{ margin: 0, color: "rgba(255,255,255,.64)", fontSize: 11, lineHeight: 1.6 }}>Resident and application files are limited to the staff who support that person. Organization resources are shared internally by role; nothing here is public.</p><div style={{ display: "grid", gap: 10, marginTop: 17, paddingTop: 15, borderTop: "1px solid rgba(255,255,255,.14)" }}><div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11 }}><LockKeyhole size={14} color="#e8c5d4" /> Private resident records</div><div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11 }}><UsersRound size={14} color="#c8e1d7" /> Shared organization resources</div></div></section>
    </aside>
  </div>

  {selected && <Modal title={selected.name} description={selected.detail} onClose={() => setSelected(null)}><div style={{ display: "grid", gap: 12 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 12, borderBottom: "1px solid var(--rh-line)" }}><FileType type={selected.type} /><Status value={selected.status} /></div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}><InfoCell label="Collection" value={selected.category} /><InfoCell label="Owner" value={selected.owner} /><InfoCell label="Last updated" value={selected.date} /><InfoCell label="Access" value={selected.visibility === "Private" ? "Private · staff only" : "Shared · role-based"} /></div></div><div className="rh-form-actions"><button className="rh-button secondary" onClick={() => setSelected(null)}>Close</button><button className="rh-button" onClick={() => { downloadDocument(selected); setSelected(null); }}><ArrowDownToLine size={15} /> Download file</button></div></Modal>}
  {showUpload && <UploadModal onClose={() => setShowUpload(false)} onAdd={addDocument} />}
  {showReview && <ApplicationReview onClose={() => setShowReview(false)} onAdmit={admitApplication} onSaveDraft={() => setToast("Application review saved as a draft.")} onClarify={() => setToast("Clarification request queued for Mia Hernandez.")} />}
  {toast && <Toast message={toast} onDone={() => setToast("")} />}
  </Shell>;
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return <div><div className="rh-kicker">{label}</div><strong style={{ display: "block", marginTop: 5, fontSize: 12, lineHeight: 1.45 }}>{value}</strong></div>;
}