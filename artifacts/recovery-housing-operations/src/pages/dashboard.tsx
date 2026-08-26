import { ArrowUpRight, BedDouble, CircleDollarSign, ClipboardList, CreditCard, UsersRound } from 'lucide-react';
import { Link } from 'wouter';
import { useGetDashboard, useListActivity, useListResidents, getGetDashboardQueryKey, getListActivityQueryKey, getListResidentsQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/app-shell';
import { QueryState, Skeleton, StatusBadge } from '@/components/ui-primitives';

const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
const date = (value: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(value));

export default function Dashboard() {
  const dashboard = useGetDashboard();
  const activity = useListActivity();
  const residents = useListResidents({ status: 'all' });
  const queryClient = useQueryClient();
  const d = dashboard.data;
  const recentResidents = (residents.data ?? []).filter((resident) => resident.status !== 'exited').slice(0, 4);
  const counts = d?.statusCounts ?? {};
  return <AppShell><div className="animate-enter">
    <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
      <div><div className="section-kicker">Tuesday · October 15, 2024</div><h1 data-testid="text-page-title" className="display-serif mt-2 text-4xl leading-none tracking-tight text-[hsl(var(--foreground))] sm:text-5xl">Good morning, Alex.</h1><p className="mt-3 max-w-lg text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">A clear view of the house, the people in it, and the next right thing.</p></div>
      <Link href="/residents" data-testid="link-view-residents" className="flex w-fit items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-2.5 text-xs font-extrabold transition-colors hover:bg-[hsl(var(--secondary))]">Open resident directory <ArrowUpRight size={15} /></Link>
    </div>
    <QueryState loading={dashboard.isLoading} error={dashboard.isError} retry={() => queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() })}>
      {d && <div className="mt-9 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={<UsersRound size={18} />} label="Active residents" value={d.activeResidents} note={`${counts.pending ?? 0} preparing to move in`} tone="magenta" />
        <Metric icon={<BedDouble size={18} />} label="Beds available" value={d.bedsAvailable} note={`${Math.round(d.occupancyRate)}% occupancy`} tone="sand" />
        <Metric icon={<ClipboardList size={18} />} label="Payments due" value={d.paymentsDue} note="Across current residents" tone="blush" />
        <Metric icon={<CircleDollarSign size={18} />} label="Collected this month" value={money(d.paymentsCollected)} note="On-time and recorded" tone="navy" />
      </div>}
    </QueryState>
    <div className="mt-7 grid gap-6 xl:grid-cols-[1.15fr_.85fr]">
      <section className="paper-card animate-enter-delay overflow-hidden">
        <div className="flex items-start justify-between border-b border-[hsl(var(--border))] px-6 py-5"><div><div className="section-kicker">Resident needs</div><h2 className="display-serif mt-1 text-2xl">Who needs a closer look</h2></div><Link href="/residents" data-testid="link-needs-directory" className="text-xs font-extrabold text-[hsl(var(--primary))] hover:underline">View all</Link></div>
        <QueryState loading={residents.isLoading} error={residents.isError} retry={() => queryClient.invalidateQueries({ queryKey: getListResidentsQueryKey() })}>
          {recentResidents.length ? <div className="divide-y divide-[hsl(var(--border))]">{recentResidents.map((resident, index) => <Link href={`/residents/${resident.id}`} data-testid={`card-resident-need-${resident.id}`} key={resident.id} className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-[hsl(var(--secondary)/.45)]"><div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-extrabold ${index % 2 ? 'bg-[hsl(var(--accent))] text-[hsl(var(--primary))]' : 'bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]'}`}>{resident.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}</div><div className="min-w-0 flex-1"><div className="truncate text-sm font-extrabold">{resident.name}</div><div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{resident.status === 'pending' ? 'Move-in preparation' : resident.notes || `Next payment ${date(resident.nextPaymentDate)}`}</div></div><StatusBadge status={resident.status} /><ArrowUpRight size={15} className="text-[hsl(var(--muted-foreground))]" /></Link>)}</div> : <div className="px-6 py-14"><div className="text-center text-sm text-[hsl(var(--muted-foreground))]">No resident follow-ups right now.</div></div>}
        </QueryState>
      </section>
      <section className="paper-card animate-enter-delay-2 overflow-hidden">
        <div className="border-b border-[hsl(var(--border))] px-6 py-5"><div className="section-kicker">House log</div><h2 className="display-serif mt-1 text-2xl">Recent activity</h2></div>
        <QueryState loading={activity.isLoading} error={activity.isError} retry={() => queryClient.invalidateQueries({ queryKey: getListActivityQueryKey() })}>
          {activity.data?.length ? <div className="divide-y divide-[hsl(var(--border))]">{activity.data.slice(0, 6).map((item) => <div data-testid={`activity-${item.id}`} key={item.id} className="flex gap-3 px-6 py-4"><div className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${item.type === 'payment' ? 'bg-[hsl(161_40%_88%)] text-[hsl(var(--primary))]' : item.type === 'resident' ? 'bg-[hsl(38_66%_88%)] text-[hsl(31_70%_34%)]' : 'bg-[hsl(14_72%_88%)] text-[hsl(14_58%_35%)]'}`}>{item.type === 'payment' ? <CreditCard size={14} /> : item.type === 'resident' ? <UsersRound size={14} /> : <ClipboardList size={14} />}</div><div className="min-w-0"><div className="text-xs font-extrabold">{item.title}</div><div className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">{item.detail}</div><div className="mono mt-2 text-[10px] text-[hsl(var(--muted-foreground)/.72)]">{date(item.timestamp)}</div></div></div>)}</div> : <div className="px-6 py-14 text-center text-sm text-[hsl(var(--muted-foreground))]">The house log is quiet.</div>}
        </QueryState>
      </section>
    </div>
  </div></AppShell>;
}

function Metric({ icon, label, value, note, tone }: { icon: React.ReactNode; label: string; value: string | number; note: string; tone: string }) {
  const tones: Record<string, string> = { magenta: 'bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]', sand: 'bg-[hsl(38_66%_88%)] text-[hsl(31_70%_34%)]', blush: 'bg-[hsl(var(--accent))] text-[hsl(var(--primary))]', navy: 'bg-[hsl(219_48%_88%)] text-[hsl(219_64%_24%)]' };
  return <div data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`} className="paper-card p-5 transition-transform hover:-translate-y-0.5"><div className="flex items-start justify-between"><div className="section-kicker max-w-[130px] leading-relaxed">{label}</div><div className={`flex h-9 w-9 items-center justify-center rounded-xl ${tones[tone]}`}>{icon}</div></div><div className="mt-4 text-3xl font-extrabold tracking-tight">{value}</div><div className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">{note}</div></div>;
}