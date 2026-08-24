import { ArrowUpRight, BedDouble, CheckCircle2, CircleDollarSign, ClipboardList, CreditCard, UsersRound } from "lucide-react";
import { Metric, Shell, Status, Toast, money, initials, pagePath, payments, residents } from "./_shared";
import { useState } from "react";

export default function Dashboard() {
  const [toast, setToast] = useState("");
  const dismissToast = () => setToast("");
  const activeResidents = residents.filter((resident) => resident.status === "active").length;
  return <Shell active="Overview"><div className="rh-page-head">
    <div><div className="rh-kicker">Tuesday · October 15, 2024</div><h1>Good morning, Alex.</h1><p>A clear view of the house, the people in it, and the next right thing.</p></div>
    <a className="rh-button secondary" href={pagePath("Residents")}>Open resident directory <ArrowUpRight size={15} /></a>
  </div>
  <div className="rh-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginTop: 36 }}>
    <Metric icon={UsersRound} label="Active residents" value={activeResidents} note="1 preparing to move in" tone="mint" />
    <Metric icon={BedDouble} label="Beds available" value="5" note="38% occupancy" tone="sand" />
    <Metric icon={ClipboardList} label="Payments due" value="2" note="Across current residents" tone="blush" />
    <Metric icon={CircleDollarSign} label="Collected this month" value={money(600)} note="On-time and recorded" tone="blue" />
  </div>
  <div className="rh-grid" style={{ gridTemplateColumns: "1.16fr .84fr", marginTop: 18 }}>
    <section className="rh-card" style={{ overflow: "hidden" }}><header className="rh-card-header"><div className="rh-kicker">Resident needs</div><h2>Who needs a closer look</h2></header>
      {residents.map((resident, index) => <a className="rh-row" href={`${pagePath("ResidentDetail")}?resident=${resident.id}`} key={resident.id}><span className={`rh-initials ${index % 2 ? "alt" : ""}`}>{initials(resident.name)}</span><span className="rh-row-content"><strong>{resident.name}</strong><small>{resident.notes}</small></span><Status value={resident.status} /><ArrowUpRight className="rh-muted" size={15} /></a>)}
    </section>
    <section className="rh-card" style={{ overflow: "hidden" }}><header className="rh-card-header"><div className="rh-kicker">House log</div><h2>Recent activity</h2></header>
      {payments.slice(0, 3).map((payment) => <div className="rh-row" key={payment.id}><span className="rh-initials" style={{ background: "#e3ebf2" }}><CreditCard size={16} /></span><span className="rh-row-content"><strong>{payment.status === "paid" ? "Payment recorded" : "Payment follow-up"}</strong><small>{payment.resident} · {money(payment.amount)}</small></span><Status value={payment.status} /></div>)}
      <div style={{ padding: "17px 23px", background: "#fbf7f8" }}><CheckCircle2 size={15} style={{ verticalAlign: "middle", marginRight: 7, color: "#a2185b" }} /><span className="rh-muted" style={{ fontSize: 11 }}>Morning check-in is ready for the team.</span></div>
    </section>
  </div>
  <section className="rh-card" style={{ marginTop: 18, padding: "17px 22px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, background: "#142b55", color: "#fff" }}>
    <div><div className="rh-kicker" style={{ color: "#e8c5d4" }}>Two homes · one steady rhythm</div><strong style={{ display: "block", marginTop: 5, fontFamily: "Fraunces, Georgia, serif", fontSize: 21, fontWeight: 500 }}>Small follow-ups become lasting stability.</strong></div>
    <button className="rh-button" onClick={() => setToast("House log marked ready for review.")} style={{ background: "#fff", color: "#142b55", flex: "none" }}>Review house log <ArrowUpRight size={14} /></button>
  </section>
  {toast && <Toast message={toast} onDone={dismissToast} />}
  </Shell>;
}