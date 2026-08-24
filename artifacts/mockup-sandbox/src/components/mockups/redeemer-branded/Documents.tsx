import { Archive, ArrowDownToLine, ArrowRight, BriefcaseBusiness, Check, ChevronDown, ClipboardCheck, Clock3, FileArchive, FileCheck2, FilePlus2, FileText, Filter, FolderLock, FolderOpen, Landmark, LockKeyhole, MoreHorizontal, Search, ShieldCheck, UploadCloud, UsersRound, X } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
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

function ApplicationReview({ onClose, onAdmit }: { onClose: () => void; onAdmit: () => void }) {
  return <Modal title="Review Mia's application" description="A final review before the application becomes part of the resident record. The packet remains private to the admissions team until admission is confirmed." onClose={onClose}>
    <div style={{ padding: 15, borderRadius: 12, background: "#fbf0f4", border: "1px solid #efd6e1" }}><div className="rh-kicker">Admission packet</div><strong style={{ display: "block", marginTop: 6, fontFamily: "Fraunces, Georgia, serif", fontSize: 22 }}>Mia Hernandez</strong><span style={{ display: "block", marginTop: 4, color: "var(--rh-muted)", fontSize: 12 }}>Northside House · received Oct 14, 2024</span></div>
    <div style={{ display: "grid", gap: 11, marginTop: 18 }}>{["Application and recovery goals", "Referral contact and Bexar County waiver", "ID, insurance card, and release forms"].map((item) => <div key={item} style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--rh-ink)", fontSize: 12 }}><span style={{ display: "grid", placeItems: "center", width: 23, height: 23, borderRadius: "50%", color: "#226052", background: "#e4efec" }}><Check size={13} /></span>{item}<span style={{ marginLeft: "auto", color: "var(--rh-muted)", fontSize: 10 }}>Verified</span></div>)}</div>
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 19, padding: 12, borderTop: "1px solid var(--rh-line)", color: "var(--rh-muted)", fontSize: 11, lineHeight: 1.5 }}><ArrowRight size={16} color="#a2185b" style={{ flex: "none", marginTop: 1 }} /><span>Admission will create a resident profile and copy the verified packet into <strong style={{ color: "var(--rh-ink)" }}>Resident records</strong>. The original application stays linked for audit history.</span></div>
    <div className="rh-form-actions"><button type="button" className="rh-button secondary" onClick={onClose}>Keep in review</button><button type="button" className="rh-button" onClick={onAdmit}><Check size={15} /> Move into resident profile</button></div>
  </Modal>;
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
  {showReview && <ApplicationReview onClose={() => setShowReview(false)} onAdmit={admitApplication} />}
  {toast && <Toast message={toast} onDone={() => setToast("")} />}
  </Shell>;
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return <div><div className="rh-kicker">{label}</div><strong style={{ display: "block", marginTop: 5, fontSize: 12, lineHeight: 1.45 }}>{value}</strong></div>;
}