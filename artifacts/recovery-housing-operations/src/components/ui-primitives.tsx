import { AlertCircle, Check, ChevronDown, LoaderCircle, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';

export function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = { active: 'Active', pending: 'Pending', exited: 'Exited', paid: 'Paid', due: 'Due', overdue: 'Overdue' };
  return <span data-testid={`status-${status}`} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[.08em] ${status === 'active' || status === 'paid' ? 'bg-[hsl(161_40%_88%)] text-[hsl(169_42%_27%)]' : status === 'pending' || status === 'due' ? 'bg-[hsl(38_66%_88%)] text-[hsl(31_70%_34%)]' : 'bg-[hsl(9_63%_90%)] text-[hsl(7_58%_42%)]'}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{labels[status] ?? status}</span>;
}

export function Skeleton({ className = '' }: { className?: string }) { return <div className={`animate-pulse rounded-lg bg-[hsl(var(--muted))] ${className}`} />; }

export function QueryState({ loading, error, retry, children }: { loading?: boolean; error?: boolean; retry?: () => void; children: ReactNode }) {
  if (loading) return <div className="space-y-4 py-2"><Skeleton className="h-20 w-full" /><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /></div>;
  if (error) return <div data-testid="status-error" className="paper-card flex flex-col items-center justify-center gap-3 py-16 text-center"><AlertCircle className="text-[hsl(var(--destructive))]" size={28} /><p className="font-bold">We couldn't load this view.</p><p className="text-sm text-[hsl(var(--muted-foreground))]">Try again in a moment.</p>{retry && <button data-testid="button-retry" onClick={retry} className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-xs font-bold text-[hsl(var(--primary-foreground))]">Retry</button>}</div>;
  return <>{children}</>;
}

export function Modal({ title, eyebrow, onClose, children }: { title: string; eyebrow?: string; onClose: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-[hsl(219_64%_14%/.35)] p-0 backdrop-blur-sm sm:items-center sm:p-6"><div className="animate-enter w-full max-w-[540px] rounded-t-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-2xl sm:rounded-3xl"><div className="mb-6 flex items-start justify-between"><div>{eyebrow && <div className="section-kicker">{eyebrow}</div>}<h2 className="display-serif mt-1 text-3xl">{title}</h2></div><button data-testid="button-close-modal" onClick={onClose} className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]" aria-label="Close dialog"><X size={18} /></button></div>{children}</div></div>;
}

export function Field({ label, name, value, onChange, type = 'text', placeholder, required = false, min, step }: { label: string; name: string; value: string | number; onChange: (value: string) => void; type?: string; placeholder?: string; required?: boolean; min?: string; step?: string }) {
  return <label className="block" htmlFor={name}><span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">{label}{required && <span className="text-[hsl(var(--accent))]"> *</span>}</span><input id={name} data-testid={`input-${name}`} required={required} type={type} min={min} step={step} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-11 w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3 text-sm outline-none transition-shadow placeholder:text-[hsl(var(--muted-foreground)/.65)] focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--ring)/.15)]" /></label>;
}

export function SelectField({ label, name, value, onChange, options }: { label: string; name: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return <label className="block" htmlFor={name}><span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">{label}</span><span className="relative block"><select id={name} data-testid={`select-${name}`} value={value} onChange={(e) => onChange(e.target.value)} className="h-11 w-full appearance-none rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3 text-sm outline-none focus:border-[hsl(var(--primary))]">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={15} className="pointer-events-none absolute right-3 top-3.5 text-[hsl(var(--muted-foreground))]" /></span></label>;
}

export function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) { return <button data-testid="button-submit-form" type="submit" disabled={pending} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-5 text-sm font-extrabold text-[hsl(var(--primary-foreground))] transition-transform hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-60">{pending && <LoaderCircle size={16} className="animate-spin" />}{pending ? 'Saving…' : children}</button>; }

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) { return <div data-testid="empty-state" className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card)/.55)] px-6 py-16 text-center"><div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]"><Check size={20} /></div><h3 className="font-extrabold">{title}</h3><p className="mt-1 max-w-sm text-sm text-[hsl(var(--muted-foreground))]">{detail}</p>{action && <div className="mt-5">{action}</div>}</div>; }

export function useDisclosure(initial = false) { const [open, setOpen] = useState(initial); return { open, setOpen, close: () => setOpen(false), toggle: () => setOpen((value) => !value) }; }