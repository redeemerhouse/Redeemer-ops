import { Bell, Building2, CalendarDays, CircleDollarSign, ClipboardList, CreditCard, LayoutDashboard, Mail, Pencil, Phone, Plus, Search, UsersRound, WalletCards, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import "./_group.css";

export const residents = [
  { id: 1, name: "Jordan Lee", email: "jordan.lee@email.com", phone: "(555) 014-2388", home: "Northside House", moveIn: "Oct 03, 2024", status: "active", balance: 420, notes: "Checking in with mentor weekly." },
  { id: 2, name: "Marcus Williams", email: "marcus.w@email.com", phone: "(555) 014-8821", home: "Northside House", moveIn: "Sep 18, 2024", status: "active", balance: 0, notes: "Next payment due October 20." },
  { id: 3, name: "Tanya Brooks", email: "tanya.b@email.com", phone: "(555) 014-4410", home: "Eastlake House", moveIn: "Oct 12, 2024", status: "pending", balance: 0, notes: "Move-in preparation" },
  { id: 4, name: "Devon Carter", email: "devon.c@email.com", phone: "(555) 014-1974", home: "Northside House", moveIn: "Aug 02, 2024", status: "active", balance: 180, notes: "Payment plan in place." },
];
export const payments = [
  { id: 1, residentId: 1, resident: "Jordan Lee", date: "Oct 15, 2024", amount: 420, status: "due", method: "Payment not recorded" },
  { id: 2, residentId: 2, resident: "Marcus Williams", date: "Oct 20, 2024", amount: 600, status: "paid", method: "Bank transfer" },
  { id: 3, residentId: 4, resident: "Devon Carter", date: "Oct 05, 2024", amount: 480, status: "overdue", method: "Payment plan" },
  { id: 4, residentId: 3, resident: "Tanya Brooks", date: "Oct 25, 2024", amount: 550, status: "due", method: "Payment not recorded" },
];
export const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
export const initials = (name: string) => name.split(" ").map((part) => part[0]).join("");
export const pagePath = (page: "Dashboard" | "Residents" | "Payments" | "ResidentDetail") => `/__mockup/preview/redeemer-branded/${page}`;

export function Status({ value }: { value: string }) {
  return <span className={`rh-status ${value}`}>{value}</span>;
}

export function Metric({ icon: Icon, label, value, note, tone }: { icon: LucideIcon; label: string; value: string | number; note: string; tone: "mint" | "sand" | "blush" | "blue" }) {
  const tones = { mint: "#e4efec", sand: "#f4e6ca", blush: "#f6e6ed", blue: "#e3ebf2" };
  return <div className="rh-card rh-metric"><div className="rh-metric-top"><span className="rh-kicker">{label}</span><span className="rh-metric-icon" style={{ background: tones[tone] }}><Icon size={17} /></span></div><strong>{value}</strong><small>{note}</small></div>;
}

export function Shell({ active, children }: { active: string; children: ReactNode }) {
  const nav: [string, string, LucideIcon][] = [["Overview", pagePath("Dashboard"), LayoutDashboard], ["Residents", pagePath("Residents"), UsersRound], ["Payments", pagePath("Payments"), CreditCard]];
  return <div className="rh-app"><div className="rh-shell"><aside className="rh-sidebar">
    <a className="rh-brand" href={pagePath("Dashboard")} aria-label="Redeemer House overview"><img src="/__mockup/images/redeemer-house-logo.jpeg" alt="Redeemer House" /><span className="rh-brand-copy"><strong>Redeemer House</strong><small>Staff workspace</small></span></a>
    <div className="rh-kicker">Workspace</div>
    <nav aria-label="Main navigation">{nav.map(([label, href, Icon]) => <a className={`rh-nav ${active === label ? "active" : ""}`} href={href} key={label}><Icon size={17} />{label}</a>)}</nav>
    <div className="rh-side-bottom"><div className="rh-health"><strong>System healthy</strong><p>Resident and payment records are up to date.</p></div><div className="rh-user"><span className="rh-avatar">AM</span><span><strong>Alex Morgan</strong><small>House coordinator</small></span></div></div>
  </aside><main className="rh-main"><header className="rh-topbar"><div className="rh-topbar-left"><span>Tuesday, October 15, 2024</span><b>/</b> Morning check-in</div><div className="rh-topbar-right"><Bell size={17} /><span>Redeemer House · Northside</span><span className="rh-avatar">AM</span></div></header><div className="rh-content">{children}</div></main></div></div>;
}

export function Info({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return <div className="rh-info"><Icon className="rh-info-icon" size={16} /><span><small className="rh-kicker">{label}</small><strong>{value}</strong></span></div>;
}

export function Modal({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: ReactNode }) {
  return <div className="rh-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="rh-modal" role="dialog" aria-modal="true" aria-labelledby="rh-modal-title"><button className="rh-button ghost" aria-label="Close dialog" onClick={onClose} style={{ float: "right" }}><X size={16} /></button><h2 id="rh-modal-title">{title}</h2><p>{description}</p>{children}</section></div>;
}

export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => { const timeout = window.setTimeout(onDone, 2800); return () => window.clearTimeout(timeout); }, [message, onDone]);
  return <div className="rh-toast" role="status">{message}</div>;
}

export function RecordPaymentModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [resident, setResident] = useState(residents[0].name);
  const [amount, setAmount] = useState("420");
  const submit = (event: FormEvent) => { event.preventDefault(); onSaved(); };
  return <Modal title="Record a payment" description="Keep the ledger current so the next conversation starts with clear information." onClose={onClose}><form className="rh-form-grid" onSubmit={submit}><label>Resident<select className="rh-field" value={resident} onChange={(event) => setResident(event.target.value)}>{residents.map((item) => <option key={item.id}>{item.name}</option>)}</select></label><label>Amount<input className="rh-field" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label>Method<select className="rh-field" defaultValue="Bank transfer"><option>Bank transfer</option><option>Cash</option><option>Money order</option></select></label><div className="rh-form-actions"><button type="button" className="rh-button secondary" onClick={onClose}>Cancel</button><button type="submit" className="rh-button"><Plus size={15} /> Save payment</button></div></form></Modal>;
}

export const IconSet = { Bell, CalendarDays, CircleDollarSign, ClipboardList, CreditCard, Mail, Pencil, Phone, Search, UsersRound, WalletCards, Building2 };