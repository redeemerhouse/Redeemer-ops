import { ArrowUpRight, Pencil, Plus, Search, SlidersHorizontal } from "lucide-react";
import { Modal, Shell, Status, Toast, initials, money, pagePath, residents } from "./_shared";
import { FormEvent, useMemo, useState } from "react";

export default function Residents() {
  const [records, setRecords] = useState(residents);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [toast, setToast] = useState("");
  const filtered = useMemo(() => records.filter((resident) => {
    const query = search.toLowerCase();
    return (!query || `${resident.name} ${resident.home} ${resident.email}`.toLowerCase().includes(query)) && (status === "all" || resident.status === status);
  }), [records, search, status]);
  const addResident = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") || "New resident");
    setRecords((current) => [...current, { id: Date.now(), name, email: String(data.get("email") || "email to confirm"), phone: "(555) 014-0000", home: "Northside House", moveIn: "Preparing", status: "pending", balance: 0, notes: "New intake — follow up with the team." }]);
    setShowAdd(false);
    setToast(`${name} added to the resident directory.`);
  };
  return <Shell active="Residents"><div className="rh-page-head"><div><div className="rh-kicker">People & placements</div><h1>Residents</h1><p>Keep every person’s next step visible.</p></div><button className="rh-button" onClick={() => setShowAdd(true)}><Plus size={16} /> Add resident</button></div>
    <div className="rh-card rh-tools" style={{ marginTop: 32 }}><label className="rh-search-wrap"><Search size={17} /><input className="rh-field" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, home, or email" aria-label="Search residents" /></label><label style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--rh-muted)", fontSize: 12, fontWeight: 700 }}><SlidersHorizontal size={15} /><select className="rh-field" style={{ width: 155 }} value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter residents by status"><option value="all">All statuses</option><option value="active">Active</option><option value="pending">Pending</option><option value="exited">Exited</option></select></label></div>
    <div className="rh-card rh-table" style={{ marginTop: 18 }}><div className="rh-table-head"><span>Resident</span><span>Home</span><span>Move-in</span><span>Balance</span><span>State</span></div>
      {filtered.length ? filtered.map((resident, index) => <div className="rh-table-row" key={resident.id}><span><a href={`${pagePath("ResidentDetail")}?resident=${resident.id}`} style={{ display: "flex", gap: 12, alignItems: "center" }}><span className={`rh-initials ${index % 2 ? "alt" : ""}`}>{initials(resident.name)}</span><span><strong style={{ display: "block", fontSize: 13 }}>{resident.name}</strong><small className="rh-muted" style={{ display: "block", marginTop: 4, fontSize: 11 }}>{resident.email}</small></span></a></span><span>{resident.home}</span><span className="rh-muted">{resident.moveIn}</span><span><strong>{money(resident.balance)}</strong></span><span><Status value={resident.status} /><a href={`${pagePath("ResidentDetail")}?resident=${resident.id}`} aria-label={`Edit ${resident.name}`} className="rh-link" style={{ marginLeft: 13 }}><Pencil size={14} /></a></span></div>) : <div className="rh-empty"><strong>No residents found</strong>Try a different name or clear the status filter.</div>}
    </div>
    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 13, color: "var(--rh-muted)", fontSize: 11 }}><span>Showing {filtered.length} of {records.length} residents</span><span>Click a record to see the full profile <ArrowUpRight size={12} style={{ verticalAlign: "middle" }} /></span></div>
    {showAdd && <Modal title="Add a resident" description="Start a clear, respectful record for a new member of the home." onClose={() => setShowAdd(false)}><form className="rh-form-grid" onSubmit={addResident}><label>Full name<input name="name" className="rh-field" placeholder="Resident name" required /></label><label>Email<input name="email" type="email" className="rh-field" placeholder="name@email.com" required /></label><label>Home<select className="rh-field" defaultValue="Northside House"><option>Northside House</option><option>Eastlake House</option></select></label><div className="rh-form-actions"><button type="button" className="rh-button secondary" onClick={() => setShowAdd(false)}>Cancel</button><button type="submit" className="rh-button"><Plus size={15} /> Add record</button></div></form></Modal>}
    {toast && <Toast message={toast} onDone={() => setToast("")} />}
  </Shell>;
}