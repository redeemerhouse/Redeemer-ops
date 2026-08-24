import { ArrowUpRight, CreditCard, Plus, Search, WalletCards } from "lucide-react";
import { RecordPaymentModal, Shell, Status, Toast, money, pagePath, payments } from "./_shared";
import { useMemo, useState } from "react";

export default function Payments() {
  const [records] = useState(payments);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [showRecord, setShowRecord] = useState(false);
  const [toast, setToast] = useState("");
  const sum = (state: string) => records.filter((payment) => payment.status === state).reduce((total, payment) => total + payment.amount, 0);
  const filtered = useMemo(() => records.filter((payment) => (!search || payment.resident.toLowerCase().includes(search.toLowerCase())) && (filter === "all" || payment.status === filter)), [records, search, filter]);
  return <Shell active="Payments"><div className="rh-page-head"><div><div className="rh-kicker">Money & accountability</div><h1>Payments</h1><p>A simple pulse on what’s settled and what needs a conversation.</p></div><button className="rh-button" onClick={() => setShowRecord(true)}><Plus size={16} /> Record payment</button></div>
    <div className="rh-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginTop: 32 }}>{(["paid", "due", "overdue"] as const).map((state) => <div className="rh-card" key={state} style={{ padding: 20, borderLeft: `4px solid ${state === "paid" ? "#28615a" : state === "due" ? "#c18c42" : "#a2185b"}` }}><div style={{ display: "flex", justifyContent: "space-between" }}><span><div className="rh-kicker">{state}</div><strong style={{ display: "block", marginTop: 10, fontSize: 27, letterSpacing: "-.04em" }}>{money(sum(state))}</strong></span><CreditCard className="rh-muted" size={18} /></div></div>)}</div>
    <div className="rh-card rh-tools" style={{ marginTop: 18 }}><label className="rh-search-wrap"><Search size={17} /><input className="rh-field" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a resident" aria-label="Search payment records" /></label><select className="rh-field" style={{ width: 155 }} value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter payments"><option value="all">All payments</option><option value="paid">Paid</option><option value="due">Due</option><option value="overdue">Overdue</option></select></div>
    <div className="rh-card rh-table" style={{ marginTop: 18 }}><div className="rh-table-head"><span>Resident</span><span>Due date</span><span>Amount</span><span>Status</span><span></span></div>{filtered.length ? filtered.map((payment) => <div className="rh-table-row" key={payment.id}><span><a href={`${pagePath("ResidentDetail")}?resident=${payment.residentId}`} style={{ display: "flex", alignItems: "center", gap: 12 }}><span className="rh-initials" style={{ background: "#e3ebf2" }}><WalletCards size={16} /></span><span><strong style={{ display: "block", fontSize: 13 }}>{payment.resident}</strong><small className="rh-muted" style={{ display: "block", marginTop: 4, fontSize: 11 }}>{payment.method}</small></span></a></span><span className="rh-muted">{payment.date}</span><span><strong>{money(payment.amount)}</strong></span><span><Status value={payment.status} /></span><a href={`${pagePath("ResidentDetail")}?resident=${payment.residentId}`} className="rh-link" aria-label={`Open ${payment.resident} profile`}><ArrowUpRight size={15} /></a></div>) : <div className="rh-empty"><strong>No payments found</strong>Try a different resident or status filter.</div>}</div>
    <div style={{ marginTop: 13, color: "var(--rh-muted)", fontSize: 11 }}>Showing {filtered.length} of {records.length} payment records</div>
    {showRecord && <RecordPaymentModal onClose={() => setShowRecord(false)} onSaved={() => { setShowRecord(false); setToast("Payment recorded. The ledger is ready for the next check-in."); }} />}
    {toast && <Toast message={toast} onDone={() => setToast("")} />}
  </Shell>;
}