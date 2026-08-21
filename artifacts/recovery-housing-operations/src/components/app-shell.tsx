import { Bell, Building2, CreditCard, LayoutDashboard, Menu, UsersRound, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';

const navItems = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/residents', label: 'Residents', icon: UsersRound },
  { href: '/payments', label: 'Payments', icon: CreditCard },
];

export function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  return (
    <div className="app-shell flex min-h-[100dvh]">
      <aside className={`sidebar fixed inset-y-0 left-0 z-40 flex w-[250px] flex-col border-r border-sidebar-border px-4 py-5 transition-transform duration-300 lg:static lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between px-3">
          <Link href="/" data-testid="link-brand" className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground"><Building2 size={20} strokeWidth={1.8} /></span>
            <span><span className="block text-[15px] font-extrabold tracking-tight">Harbor House</span><span className="mono mt-0.5 block text-[10px] uppercase tracking-[.18em] text-sidebar-foreground/55">Operations</span></span>
          </Link>
          <button data-testid="button-close-menu" className="text-sidebar-foreground/60 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={19} /></button>
        </div>
        <div className="mt-10 px-3 section-kicker !text-sidebar-foreground/40">Workspace</div>
        <nav className="mt-3 space-y-1" aria-label="Primary navigation">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = href === '/' ? location === '/' : location.startsWith(href);
            return <Link key={href} href={href} data-testid={`link-nav-${label.toLowerCase()}`} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-[13px] font-semibold transition-colors ${active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'}`} onClick={() => setMobileOpen(false)}><Icon size={18} strokeWidth={active ? 2.2 : 1.7} /><span>{label}</span>{active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-sidebar-primary" />}</Link>;
          })}
        </nav>
        <div className="mt-auto rounded-2xl border border-sidebar-border bg-sidebar-accent/50 p-4">
          <div className="flex items-center gap-2 text-[12px] font-bold"><span className="h-2 w-2 rounded-full bg-sidebar-primary" />System healthy</div>
          <p className="mt-2 text-[11px] leading-relaxed text-sidebar-foreground/55">All resident and payment records are up to date.</p>
        </div>
        <div className="mt-4 flex items-center gap-3 border-t border-sidebar-border px-3 pt-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[hsl(14_72%_63%)] text-xs font-extrabold text-[hsl(201_29%_19%)]">AM</div>
          <div><div className="text-xs font-bold">Alex Morgan</div><div className="text-[10px] text-sidebar-foreground/50">House coordinator</div></div>
        </div>
      </aside>
      {mobileOpen && <button data-testid="button-overlay-menu" className="fixed inset-0 z-30 bg-[hsl(201_29%_19%/.35)] lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu overlay" />}
      <main className="min-w-0 flex-1">
        <header className="flex h-[72px] items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(42_45%_99%/.72)] px-5 backdrop-blur-md sm:px-8">
          <button data-testid="button-open-menu" className="text-[hsl(var(--muted-foreground))] lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={21} /></button>
          <div className="hidden text-[12px] font-semibold text-[hsl(var(--muted-foreground))] lg:block">Tuesday, October 15, 2024 <span className="mx-2 text-[hsl(var(--border))]">/</span> Morning check-in</div>
          <div className="relative ml-auto flex items-center gap-4"><button data-testid="button-notifications" aria-label="Notifications" onClick={() => setNotificationsOpen((value) => !value)} className="relative rounded-lg p-2 text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))]"><Bell size={18} /><span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" /></button>{notificationsOpen && <div data-testid="popover-notifications" className="absolute right-0 top-11 z-20 w-64 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-xl"><div className="text-xs font-extrabold">You’re all caught up</div><p className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">No new handoffs or payment alerts.</p></div>}<div className="hidden h-5 w-px bg-[hsl(var(--border))] sm:block" /><span className="hidden text-xs font-bold text-[hsl(var(--muted-foreground))] sm:block">Harbor House · Northside</span></div>
        </header>
        <div className="mx-auto max-w-[1440px] px-5 py-8 sm:px-8 lg:px-10">{children}</div>
      </main>
    </div>
  );
}