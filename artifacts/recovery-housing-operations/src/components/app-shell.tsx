import { Bell, CreditCard, LayoutDashboard, LogOut, Menu, UsersRound, X, ClipboardList, GitBranch } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { isAdministratorRole, useAuth } from '@/lib/auth';

const baseNavItems = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/residents', label: 'Residents', icon: UsersRound },
  { href: '/payments', label: 'Payments', icon: CreditCard },
  { href: '/operations', label: 'Operations', icon: ClipboardList },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const navItems = isAdministratorRole(user?.role ?? 'resident')
    ? [...baseNavItems, { href: '/assessment-library', label: 'Assessment library', icon: GitBranch }]
    : baseNavItems;
  const displayName = user?.email || String(user?.id || 'Verified user');
  const initials = displayName.slice(0, 2).toUpperCase();
  const roleLabel = user?.role.replaceAll('_', ' ') || 'verified account';
  return (
    <div className="app-shell flex min-h-[100dvh]">
      <aside className={`sidebar fixed inset-y-0 left-0 z-40 flex w-[250px] flex-col border-r border-sidebar-border px-4 py-5 transition-transform duration-300 lg:static lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between px-3">
          <Link href="/" data-testid="link-brand" className="flex items-center gap-3">
            <img src="/redeemer-house-logo.jpeg" alt="Redeemer House" className="h-12 w-12 rounded-xl bg-white object-contain p-0.5" />
            <span><span className="display-serif block text-[17px] font-semibold tracking-tight">Redeemer House</span><span className="mono mt-0.5 block text-[10px] uppercase tracking-[.18em] text-sidebar-foreground/55">Staff workspace</span></span>
          </Link>
          <button data-testid="button-close-menu" className="text-sidebar-foreground/60 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={19} /></button>
        </div>
        <div className="mt-10 px-3 section-kicker !text-sidebar-foreground/40">Workspace</div>
        <nav className="mt-3 space-y-1" aria-label="Primary navigation">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = href === '/' ? location === '/' : location.startsWith(href);
            return <Link key={href} href={href} data-testid={`link-nav-${label.toLowerCase()}`} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-[13px] font-semibold transition-colors ${active ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-lg shadow-black/10' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'}`} onClick={() => setMobileOpen(false)}><Icon size={18} strokeWidth={active ? 2.2 : 1.7} /><span>{label}</span>{active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-sidebar-primary-foreground/80" />}</Link>;
          })}
        </nav>
        <div className="mt-auto rounded-2xl border border-sidebar-border bg-sidebar-accent/50 p-4">
          <div className="flex items-center gap-2 text-[12px] font-bold"><span className="h-2 w-2 rounded-full bg-sidebar-primary" />System healthy</div>
          <p className="mt-2 text-[11px] leading-relaxed text-sidebar-foreground/55">All resident and payment records are up to date.</p>
        </div>
        <div className="mt-4 flex items-center gap-3 border-t border-sidebar-border px-3 pt-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[hsl(var(--accent))] text-xs font-extrabold text-[hsl(var(--primary))]">{initials}</div>
           <div className="min-w-0 flex-1"><div data-testid="text-signed-in-user" className="max-w-[135px] truncate text-xs font-bold">{displayName}</div><div className="text-[10px] capitalize text-sidebar-foreground/50">{roleLabel}</div></div>
           <button data-testid="button-logout" type="button" onClick={() => void logout()} className="rounded-lg p-2 text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground" aria-label="Sign out"><LogOut size={15} /></button>
        </div>
      </aside>
      {mobileOpen && <button data-testid="button-overlay-menu" className="fixed inset-0 z-30 bg-[hsl(219_64%_14%/.35)] lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu overlay" />}
      <main className="min-w-0 flex-1">
        <header className="flex h-[72px] items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--card)/.72)] px-5 backdrop-blur-md sm:px-8">
          <button data-testid="button-open-menu" className="text-[hsl(var(--muted-foreground))] lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={21} /></button>
          <div className="hidden text-[12px] font-semibold text-[hsl(var(--muted-foreground))] lg:block">Tuesday, October 15, 2024 <span className="mx-2 text-[hsl(var(--border))]">/</span> Morning check-in</div>
           <div className="relative ml-auto flex items-center gap-4"><button data-testid="button-notifications" aria-label="Notifications" onClick={() => setNotificationsOpen((value) => !value)} className="relative rounded-lg p-2 text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))]"><Bell size={18} /><span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" /></button>{notificationsOpen && <div data-testid="popover-notifications" className="absolute right-0 top-11 z-20 w-64 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-xl"><div className="text-xs font-extrabold">You’re all caught up</div><p className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">No new handoffs or payment alerts.</p></div>}<div className="hidden h-5 w-px bg-[hsl(var(--border))] sm:block" /><span className="hidden text-xs font-bold text-[hsl(var(--muted-foreground))] sm:block">Redeemer House · Northside</span></div>
        </header>
        <div className="mx-auto max-w-[1440px] px-5 py-8 sm:px-8 lg:px-10">{children}</div>
      </main>
    </div>
  );
}