import { ArrowUpRight, BedDouble, BellRing, CheckCircle2, ChevronDown, CircleDollarSign, ClipboardList, CreditCard, Home, Plus, ShieldCheck, UsersRound } from "lucide-react";
import { Metric, Shell, Status, Toast, money, initials, pagePath, payments, residents } from "./_shared";
import { useState } from "react";

export default function Dashboard() {
  const [toast, setToast] = useState("");
  const [role, setRole] = useState<"owner" | "manager">("owner");
  const [scope, setScope] = useState("All homes");
  const [viewState, setViewState] = useState<"ready" | "quiet" | "loading">("ready");
  const dismissToast = () => setToast("");
  const isManager = role === "manager";
  const visibleResidents = isManager ? residents.filter((resident) => resident.home === "Northside House") : residents;
  const activeResidents = visibleResidents.filter((resident) => resident.status === "active").length;
  const scopedLabel = isManager ? "Northside House" : scope;
  const showAlerts = viewState === "ready";
  const showLoading = viewState === "loading";
  return <Shell active="Overview"><div className="rh-page-head">
    <div><div className="rh-kicker">Tuesday · October 15, 2024</div><h1>Good morning, Alex.</h1><p>A calm, shared view of homes, people, and the next right thing.</p></div>
    <div className="rh-head-actions"><a className="rh-button secondary" href={pagePath("Residents")}>Open resident directory <ArrowUpRight size={15} /></a></div>
  </div>

  <section className="rh-context-bar" aria-label="Dashboard review controls">
    <div className="rh-context-label"><ShieldCheck size={16} /><span><strong>{isManager ? "House manager view" : "Owner & program director view"}</strong><small>{isManager ? "Assigned-home access · private details stay protected" : "Organization-wide summary · homes remain clearly scoped"}</small></span></div>
    <div className="rh-context-controls">
      <label>Role<select className="rh-compact-field" value={role} onChange={(event) => setRole(event.target.value as "owner" | "manager")}><option value="owner">Owner / admin</option><option value="manager">House manager</option></select></label>
      <label>Scope<select className="rh-compact-field" value={scope} onChange={(event) => setScope(event.target.value)} disabled={isManager}><option>All homes</option><option>Northside House</option><option>Eastlake House</option></select></label>
    </div>
  </section>
  <div className="rh-review-states"><span>Review states</span>{(["ready", "quiet", "loading"] as const).map((state) => <button key={state} className={viewState === state ? "active" : ""} onClick={() => setViewState(state)}>{state === "ready" ? "Alerts present" : state === "quiet" ? "No alerts" : "Loading"}</button>)}</div>

  {showLoading ? <LoadingState /> : <><div className="rh-grid rh-metrics-grid">
    <Metric icon={UsersRound} label="Active residents" value={activeResidents} note={isManager ? "In your assigned home" : "Across 2 active homes"} tone="mint" />
    <Metric icon={BedDouble} label="Beds available" value={isManager ? "2" : "5"} note={isManager ? "Northside · 67% occupied" : "38% occupancy across homes"} tone="sand" />
    <Metric icon={ClipboardList} label="Payments needing attention" value={isManager ? "1" : "2"} note="Operational follow-up only" tone="blush" />
    <Metric icon={CircleDollarSign} label="Collected this month" value={money(isManager ? 420 : 600)} note="Recorded in the ledger" tone="blue" />
  </div>
  <div className="rh-dashboard-grid">
    <section className="rh-card rh-alert-card"><header className="rh-card-header rh-card-header-row"><div><div className="rh-kicker">Today’s attention</div><h2>{showAlerts ? "A short list for the team" : "Nothing needs attention"}</h2></div><BellRing size={19} className="rh-magenta" /></header>
      {showAlerts ? <div className="rh-attention-list"><Attention icon={CreditCard} title="Payment follow-up" detail="Jordan Lee · $420 due today" tone="magenta" /><Attention icon={ClipboardList} title="Move-in preparation" detail="Tanya Brooks · Eastlake House" tone="sand" /><Attention icon={CheckCircle2} title="Morning check-in" detail="Ready for review by the team" tone="mint" /></div> : <div className="rh-empty"><CheckCircle2 size={23} /><strong>All caught up for now</strong><span>New handoffs and payment follow-ups will appear here.</span></div>}
    </section>
    <section className="rh-card rh-occupancy"><header className="rh-card-header rh-card-header-row"><div><div className="rh-kicker">Home occupancy</div><h2>{scopedLabel}</h2></div><Home size={19} className="rh-navy" /></header><div className="rh-occupancy-body"><div className="rh-occupancy-number"><strong>{isManager ? "6 / 9" : "13 / 18"}</strong><span>beds occupied</span></div><div className="rh-progress"><span style={{ width: isManager ? "67%" : "72%" }} /></div><div className="rh-occupancy-meta"><span><i className="rh-dot occupied" />Occupied <b>{isManager ? 6 : 13}</b></span><span><i className="rh-dot available" />Available <b>{isManager ? 3 : 5}</b></span></div></div><div className="rh-home-row"><span className="rh-home-mark">N</span><span><strong>Northside House</strong><small>6 of 9 beds · 2 follow-ups</small></span><Status value="current" /></div>{!isManager && <div className="rh-home-row"><span className="rh-home-mark alt">E</span><span><strong>Eastlake House</strong><small>7 of 9 beds · 1 move-in</small></span><Status value="current" /></div>}</section>
  </div>
  <div className="rh-dashboard-grid rh-lower-grid">
    <section className="rh-card" style={{ overflow: "hidden" }}><header className="rh-card-header rh-card-header-row"><div><div className="rh-kicker">Resident activity</div><h2>Keep the next step visible</h2></div><a className="rh-link" href={pagePath("Residents")}>View all <ArrowUpRight size={13} /></a></header>
      {visibleResidents.slice(0, 3).map((resident, index) => <a className="rh-row" href={`${pagePath("ResidentDetail")}?resident=${resident.id}`} key={resident.id}><span className={`rh-initials ${index % 2 ? "alt" : ""}`}>{initials(resident.name)}</span><span className="rh-row-content"><strong>{resident.name}</strong><small>{resident.notes}</small></span><Status value={resident.status} /><ArrowUpRight className="rh-muted" size={15} /></a>)}
    </section>
    <section className="rh-card" style={{ overflow: "hidden" }}><header className="rh-card-header rh-card-header-row"><div><div className="rh-kicker">Payment attention</div><h2>Ledger pulse</h2></div><a className="rh-link" href={pagePath("Payments")}>Open ledger <ArrowUpRight size={13} /></a></header>{payments.filter((payment) => payment.status !== "paid").slice(0, 2).map((payment) => <div className="rh-row" key={payment.id}><span className="rh-initials" style={{ background: "#f6e6ed" }}><CreditCard size={16} /></span><span className="rh-row-content"><strong>{payment.resident}</strong><small>{payment.status === "overdue" ? "Past due" : "Due today"} · {money(payment.amount)}</small></span><Status value={payment.status} /></div>)}<div className="rh-card-foot"><CircleDollarSign size={15} /><span>Financial details are limited to authorized staff.</span></div></section>
  </div>
  <section className="rh-quick-actions"><div><div className="rh-kicker">Quick actions</div><strong>Keep operations moving</strong></div><div className="rh-action-buttons"><button className="rh-button" onClick={() => setToast("New resident flow opened for review.")}><Plus size={15} /> Add resident</button><button className="rh-button secondary" onClick={() => setToast("Payment entry flow opened for review.")}><CreditCard size={15} /> Record payment</button><button className="rh-button secondary" onClick={() => setToast("House log marked ready for review.")}><CheckCircle2 size={15} /> Review house log</button></div></section>
  </>}
  {toast && <Toast message={toast} onDone={dismissToast} />}
  </Shell>;
}

function Attention({ icon: Icon, title, detail, tone }: { icon: typeof CreditCard; title: string; detail: string; tone: string }) {
  return <div className="rh-attention"><span className={`rh-attention-icon ${tone}`}><Icon size={16} /></span><span><strong>{title}</strong><small>{detail}</small></span><ChevronDown size={15} className="rh-muted" /></div>;
}

function LoadingState() {
  return <div className="rh-loading-grid"><div className="rh-loading-hero"><div className="rh-skeleton wide" /><div className="rh-skeleton medium" /><div className="rh-skeleton short" /></div><div className="rh-grid rh-metrics-grid">{[1, 2, 3, 4].map((item) => <div className="rh-card rh-loading-card" key={item}><div className="rh-skeleton short" /><div className="rh-skeleton value" /><div className="rh-skeleton medium" /></div>)}</div><div className="rh-card rh-loading-panel"><div className="rh-skeleton medium" /><div className="rh-skeleton wide" /><div className="rh-skeleton wide" /></div></div>;
}