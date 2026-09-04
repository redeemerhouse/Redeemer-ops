import { AlertTriangle, ArrowUpRight, BedDouble, CalendarRange, CheckCircle2, CircleCheck, CircleDollarSign, ClipboardList, CreditCard, Plus, TrendingUp, TriangleAlert, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'wouter';
import { 
  useGetDashboard, 
  useListActivity, 
  useListResidents, 
  useListHouses, 
  useCreateExpense, 
  useCreateIncome, 
  useCreateMeetingAttendance, 
  getGetDashboardQueryKey, 
  getListActivityQueryKey, 
  getListResidentsQueryKey 
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/app-shell';
import { QueryState, StatusBadge, useDisclosure, Modal, Field, SelectField, SubmitButton } from '@/components/ui-primitives';
const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
const date = (value: string | Date | null | undefined, fallback = 'Date unavailable') => {
  if (!value) return fallback;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(parsed);
};

const weekRange = (startsOn: string, endsOn: string) => {
  const lastDay = new Date(`${endsOn}T00:00:00Z`);
  if (Number.isNaN(lastDay.getTime())) return date(startsOn);
  lastDay.setUTCDate(lastDay.getUTCDate() - 1);
  return `${date(startsOn)} – ${date(lastDay)}`;
};
const calendarDate = (value: string | null | undefined) => {
  if (!value) return 'Date unavailable';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(parsed);
};

export default function Dashboard() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  
  const dashboard = useGetDashboard({ month }, { query: { queryKey: getGetDashboardQueryKey({ month }), retry: false } });
  const activity = useListActivity();
  const residents = useListResidents({ status: 'all' });
  const queryClient = useQueryClient();
  
  const incomeModal = useDisclosure();
  const expenseModal = useDisclosure();
  const meetingModal = useDisclosure();

  const d = dashboard.data;
  const dashboardError = dashboard.error as { status?: number } | null;
  const dashboardErrorDetail = dashboardError?.status === 401
    ? 'Your signed-in session is missing or expired. Sign in again to load live resident and financial metrics.'
    : dashboardError?.status === 403
      ? 'Your role is not permitted to view this dashboard.'
      : undefined;
  const recentResidents = (residents.data ?? []).filter((resident) => resident.status !== 'exited').slice(0, 4);

  const todayFormatted = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date());

  return (
    <AppShell>
      <div className="animate-enter">
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <div className="section-kicker">{todayFormatted}</div>
            <h1 data-testid="text-page-title" className="display-serif mt-2 text-4xl leading-none tracking-tight text-[hsl(var(--foreground))] sm:text-5xl">Good morning, Alex.</h1>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">A clear view of the house, the people in it, and the next right thing.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input 
              type="month" 
              value={month}
              onChange={e => setMonth(e.target.value)}
              className="h-10 w-44 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm font-extrabold text-[hsl(var(--foreground))] outline-none focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--ring)/.15)]"
              data-testid="input-month-selector"
              aria-label="Select month"
            />
            <Link href="/residents" data-testid="link-view-residents" className="flex h-10 w-fit items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 text-xs font-extrabold transition-colors hover:bg-[hsl(var(--secondary))]">
              Open resident directory <ArrowUpRight size={15} />
            </Link>
          </div>
        </div>

        <QueryState loading={dashboard.isLoading} error={dashboard.isError} errorDetail={dashboardErrorDetail} retry={() => queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey({ month }) })}>
          {d && (
            <>
              <div className="mt-9 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Metric icon={<BedDouble size={18} />} label="Occupancy" value={`${Math.round(d.capacity.occupancyRate)}%`} note={`${d.capacity.occupiedBeds} of ${d.capacity.totalBeds} beds filled`} tone="sand" />
                <Metric icon={<CircleDollarSign size={18} />} label="Income Received" value={money(d.income.totalReceived)} note={`${money(d.income.rentCollected)} rent · ${money(d.income.otherIncome)} other`} tone="navy" />
                <Metric icon={<CreditCard size={18} />} label="Expenses Logged" value={money(d.expenses.total)} note="Total for this month" tone="magenta" />
                <Metric icon={<UsersRound size={18} />} label="Meeting Attendance" value={d.meetings.attendanceRate !== null ? `${Math.round(d.meetings.attendanceRate)}%` : 'No data'} note={d.meetings.meetingsLogged ? `${d.meetings.womenAttended} women across ${d.meetings.meetingsLogged} meetings` : 'No meetings logged'} tone="blush" />
              </div>

              <div className="mt-6 grid gap-6 lg:grid-cols-[1.05fr_.95fr]">
                <section data-testid="card-weekly-attendance" className="paper-card animate-enter-delay overflow-hidden">
                  <div className="border-b border-[hsl(var(--border))] px-6 py-5">
                    <div className="section-kicker">Current week · {weekRange(d.week.startsOn, d.week.endsOn)}</div>
                    <h2 className="display-serif mt-1 text-2xl">Meetings attended this week</h2>
                    <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Attendance is kept separate from the selected month.</p>
                  </div>
                  {d.weeklyMeetings.meetingsLogged ? (
                    <div className="flex items-end justify-between gap-4 px-6 py-6">
                      <div>
                        <div data-testid="text-weekly-attendance" className="text-4xl font-extrabold tracking-tight">{d.weeklyMeetings.womenAttended}</div>
                        <div className="mt-1 text-sm font-bold">women attended</div>
                        <div className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">{d.weeklyMeetings.meetingsLogged} meeting{d.weeklyMeetings.meetingsLogged === 1 ? '' : 's'} logged · {d.weeklyMeetings.womenEligible} eligible check-ins</div>
                      </div>
                      <div className="rounded-2xl bg-[hsl(var(--accent))] px-4 py-3 text-right">
                        <div className="section-kicker">Weekly rate</div>
                        <div data-testid="text-weekly-attendance-rate" className="mt-1 text-2xl font-extrabold">{d.weeklyMeetings.attendanceRate === null ? 'No data' : `${Math.round(d.weeklyMeetings.attendanceRate)}%`}</div>
                      </div>
                    </div>
                  ) : (
                    <div data-testid="weekly-attendance-empty" role="status" className="px-6 py-8">
                      <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.45)] px-5 py-5">
                        <div className="text-sm font-extrabold">No meetings logged this week.</div>
                        <p className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">Weekly attendance is not recorded as zero until a meeting is logged.</p>
                      </div>
                    </div>
                  )}
                </section>

                <section data-testid="card-data-quality" className="paper-card animate-enter-delay overflow-hidden">
                  <div className="border-b border-[hsl(var(--border))] px-6 py-5">
                    <div className="section-kicker">Before you act</div>
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="display-serif mt-1 text-2xl">Data quality</h2>
                      <span data-testid="data-quality-overall" className={`mt-1 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[.08em] ${d.dataQuality.overall === 'pass' ? 'bg-[hsl(161_40%_88%)] text-[hsl(169_42%_27%)]' : d.dataQuality.overall === 'warning' ? 'bg-[hsl(38_66%_88%)] text-[hsl(31_70%_34%)]' : 'bg-[hsl(9_63%_90%)] text-[hsl(7_58%_42%)]'}`}>{d.dataQuality.overall === 'pass' ? 'All clear' : d.dataQuality.overall === 'warning' ? 'Review' : 'Action needed'}</span>
                    </div>
                    <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Checks explain when a value may need review.</p>
                  </div>
                  <div data-testid="data-quality-checks" role={d.dataQuality.overall === 'error' ? 'alert' : 'status'} className="divide-y divide-[hsl(var(--border))]">
                    {d.dataQuality.checks.map((check) => (
                      <div data-testid={`data-quality-${check.name.toLowerCase().replaceAll(' ', '-')}`} key={check.name} className="flex gap-3 px-6 py-4">
                        {check.status === 'pass' ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[hsl(169_42%_27%)]" /> : <AlertTriangle size={18} className={`mt-0.5 shrink-0 ${check.status === 'error' ? 'text-[hsl(var(--destructive))]' : 'text-[hsl(31_70%_34%)]'}`} />}
                        <div>
                          <div className="text-xs font-extrabold">{check.name}</div>
                          <div className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">{check.message}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              <div className="mt-7 grid gap-6 xl:grid-cols-[1.15fr_.85fr]">
                <div className="space-y-6">
                  <section className="paper-card animate-enter-delay overflow-hidden" data-testid="panel-weekly-attendance">
                    <div className="flex flex-col gap-2 border-b border-[hsl(var(--border))] px-6 py-5 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <div className="section-kicker">Monthly trend</div>
                        <h2 className="display-serif mt-1 text-2xl">Weekly attendance</h2>
                      </div>
                      <div className="text-xs text-[hsl(var(--muted-foreground))]">Attended ÷ eligible women</div>
                    </div>
                    {d.weeklyAttendance.some((week) => week.meetingsLogged > 0) ? (
                      <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
                        {d.weeklyAttendance.map((week, index) => (
                          <div key={week.weekStart} data-testid={`weekly-attendance-${index + 1}`} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.3)] p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2 text-xs font-extrabold">
                                <CalendarRange size={15} className="text-[hsl(var(--primary))]" />
                                Week {index + 1}
                              </div>
                              <span className="text-[10px] font-bold text-[hsl(var(--muted-foreground))]">{calendarDate(week.weekStart)}–{calendarDate(week.weekEnd)}</span>
                            </div>
                            <div className="mt-5 flex items-end justify-between gap-3">
                              <div className="text-2xl font-extrabold">{week.attendanceRate !== null ? `${Math.round(week.attendanceRate)}%` : 'No data'}</div>
                              <div className="text-right text-[10px] leading-relaxed text-[hsl(var(--muted-foreground))]">
                                {week.meetingsLogged} {week.meetingsLogged === 1 ? 'meeting' : 'meetings'}<br />
                                {week.womenAttended} of {week.womenEligible}
                              </div>
                            </div>
                            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[hsl(var(--border))]" aria-label={`Week ${index + 1} attendance rate`}>
                              <div className="h-full rounded-full bg-[hsl(var(--primary))]" style={{ width: `${Math.min(week.attendanceRate ?? 0, 100)}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="px-6 py-12 text-center">
                        <CalendarRange size={24} className="mx-auto text-[hsl(var(--muted-foreground))]" />
                        <div className="mt-3 text-sm font-extrabold">No weekly attendance yet</div>
                        <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">Log a meeting with attended and eligible counts to start the weekly trend for this month.</p>
                      </div>
                    )}
                  </section>

                  <section className="paper-card animate-enter-delay overflow-hidden">
                    <div className="border-b border-[hsl(var(--border))] px-6 py-5">
                      <div className="section-kicker">Authorized staff</div>
                      <h2 className="display-serif mt-1 text-2xl">Record Operations</h2>
                      <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Income and expense records require administrator access.</p>
                    </div>
                    <div className="grid gap-3 p-6 sm:grid-cols-3">
                      <button data-testid="btn-record-income" onClick={incomeModal.toggle} className="flex flex-col items-center justify-center gap-3 rounded-xl border border-[hsl(var(--border))] p-4 text-sm font-extrabold transition-colors hover:border-[hsl(var(--primary)/.3)] hover:bg-[hsl(var(--secondary))]">
                        <CircleDollarSign size={24} className="text-[hsl(var(--primary))]" /> Record Income
                      </button>
                      <button data-testid="btn-record-expense" onClick={expenseModal.toggle} className="flex flex-col items-center justify-center gap-3 rounded-xl border border-[hsl(var(--border))] p-4 text-sm font-extrabold transition-colors hover:border-[hsl(var(--primary)/.3)] hover:bg-[hsl(var(--secondary))]">
                        <CreditCard size={24} className="text-[hsl(var(--primary))]" /> Record Expense
                      </button>
                      <button data-testid="btn-record-meeting" onClick={meetingModal.toggle} className="flex flex-col items-center justify-center gap-3 rounded-xl border border-[hsl(var(--border))] p-4 text-sm font-extrabold transition-colors hover:border-[hsl(var(--primary)/.3)] hover:bg-[hsl(var(--secondary))]">
                        <UsersRound size={24} className="text-[hsl(var(--primary))]" /> Log Meeting
                      </button>
                    </div>
                  </section>

                  <div className="grid gap-6 sm:grid-cols-2">
                    <section className="paper-card animate-enter-delay overflow-hidden">
                      <div className="border-b border-[hsl(var(--border))] px-5 py-4">
                        <h3 className="text-sm font-extrabold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Expenses by Category</h3>
                      </div>
                      <div className="p-5">
                        {d.expenses.categories.length ? (
                          <div className="space-y-3">
                            {d.expenses.categories.map(c => (
                              <div key={c.category} className="flex items-center justify-between text-sm">
                                <span className="font-medium capitalize">{c.category.replace('_', ' ')}</span>
                                <span className="font-extrabold">{money(c.amount)}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="py-4 text-center text-sm text-[hsl(var(--muted-foreground))]">No expenses recorded for this month.</div>
                        )}
                      </div>
                    </section>

                    <section className="paper-card animate-enter-delay overflow-hidden">
                      <div className="border-b border-[hsl(var(--border))] px-5 py-4">
                        <h3 className="text-sm font-extrabold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Program Progress</h3>
                      </div>
                      <div className="space-y-4 p-5">
                        <div className="flex items-start gap-4">
                           <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]"><Plus size={18} /></div>
                           <div>
                             <div className="text-xl font-extrabold">{d.progress.newMoveIns}</div>
                             <div className="text-xs text-[hsl(var(--muted-foreground))]">New move-ins this month</div>
                           </div>
                        </div>
                        <div className="flex items-start gap-4">
                           <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(161_40%_88%)] text-[hsl(169_42%_27%)]"><TrendingUp size={18} /></div>
                           <div>
                             <div className="text-xl font-extrabold">{d.progress.completedOperations}</div>
                             <div className="text-xs text-[hsl(var(--muted-foreground))]">Completed operations</div>
                           </div>
                        </div>
                         <div className="border-t border-[hsl(var(--border))] pt-4 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
                           {d.meetings.meetingsLogged
                             ? `${d.meetings.meetingsLogged} meetings logged · ${d.meetings.womenAttended} of ${d.meetings.womenEligible} possible women check-ins attended.`
                             : 'No program meetings have been logged for this month yet.'}
                         </div>
                      </div>
                    </section>
                  </div>

                  <section className="paper-card animate-enter-delay overflow-hidden">
                    <div className="flex items-start justify-between border-b border-[hsl(var(--border))] px-6 py-5">
                      <div>
                        <div className="section-kicker">Resident needs</div>
                        <h2 className="display-serif mt-1 text-2xl">Who needs a closer look</h2>
                      </div>
                      <Link href="/residents" data-testid="link-needs-directory" className="text-xs font-extrabold text-[hsl(var(--primary))] hover:underline">View all</Link>
                    </div>
                    <QueryState loading={residents.isLoading} error={residents.isError} retry={() => queryClient.invalidateQueries({ queryKey: getListResidentsQueryKey() })}>
                      {recentResidents.length ? (
                        <div className="divide-y divide-[hsl(var(--border))]">
                          {recentResidents.map((resident, index) => (
                            <Link href={`/residents/${resident.id}`} data-testid={`card-resident-need-${resident.id}`} key={resident.id} className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-[hsl(var(--secondary)/.45)]">
                              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-extrabold ${index % 2 ? 'bg-[hsl(var(--accent))] text-[hsl(var(--primary))]' : 'bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]'}`}>
                                {resident.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-extrabold">{resident.name}</div>
                                <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{resident.status === 'pending' ? 'Move-in preparation' : resident.notes || (resident.nextPaymentDate ? `Next payment ${date(resident.nextPaymentDate)}` : 'No payment scheduled')}</div>
                              </div>
                              <StatusBadge status={resident.status} />
                              <ArrowUpRight size={15} className="text-[hsl(var(--muted-foreground))]" />
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <div className="px-6 py-14">
                          <div className="text-center text-sm text-[hsl(var(--muted-foreground))]">No resident follow-ups right now.</div>
                        </div>
                      )}
                    </QueryState>
                  </section>
                </div>

                <div className="space-y-6">
                  <section className="paper-card animate-enter-delay-2 overflow-hidden" data-testid="panel-data-quality">
                    <div className="flex items-start justify-between gap-4 border-b border-[hsl(var(--border))] px-6 py-5">
                      <div>
                        <div className="section-kicker">Data quality</div>
                        <h2 className="display-serif mt-1 text-2xl">Records to review</h2>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-[10px] font-extrabold uppercase tracking-wide ${d.dataQuality.issueCount ? 'bg-[hsl(38_66%_88%)] text-[hsl(31_70%_34%)]' : 'bg-[hsl(161_40%_88%)] text-[hsl(169_42%_27%)]'}`}>
                        {d.dataQuality.issueCount ? `${d.dataQuality.issueCount} to review` : 'All clear'}
                      </span>
                    </div>
                    <div className="divide-y divide-[hsl(var(--border))]">
                      {d.dataQuality.checks.map((check) => (
                        <div key={check.key} data-testid={`data-quality-${check.key}`} className="flex gap-3 px-6 py-4">
                          <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${check.severity === 'clear' ? 'bg-[hsl(161_40%_88%)] text-[hsl(169_42%_27%)]' : 'bg-[hsl(38_66%_88%)] text-[hsl(31_70%_34%)]'}`}>
                            {check.severity === 'clear' ? <CircleCheck size={16} /> : <TriangleAlert size={16} />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs font-extrabold">{check.label}</div>
                              <div className="text-xs font-extrabold">{check.issueCount ? check.issueCount : 'Clear'}</div>
                            </div>
                            <p className="mt-1 text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">{check.description}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="paper-card animate-enter-delay-2 overflow-hidden">
                    <div className="border-b border-[hsl(var(--border))] px-6 py-5">
                      <div className="section-kicker">House log</div>
                      <h2 className="display-serif mt-1 text-2xl">Recent activity</h2>
                    </div>
                    <QueryState loading={activity.isLoading} error={activity.isError} retry={() => queryClient.invalidateQueries({ queryKey: getListActivityQueryKey() })}>
                      {activity.data?.length ? (
                        <div className="divide-y divide-[hsl(var(--border))]">
                          {activity.data.slice(0, 8).map((item) => (
                            <div data-testid={`activity-${item.id}`} key={item.id} className="flex gap-3 px-6 py-4">
                              <div className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${item.type === 'payment' ? 'bg-[hsl(161_40%_88%)] text-[hsl(var(--primary))]' : item.type === 'resident' ? 'bg-[hsl(38_66%_88%)] text-[hsl(31_70%_34%)]' : 'bg-[hsl(14_72%_88%)] text-[hsl(14_58%_35%)]'}`}>
                                {item.type === 'payment' ? <CreditCard size={14} /> : item.type === 'resident' ? <UsersRound size={14} /> : <ClipboardList size={14} />}
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-extrabold">{item.title}</div>
                                <div className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">{item.detail}</div>
                                <div className="mono mt-2 text-[10px] text-[hsl(var(--muted-foreground)/.72)]">{date(item.timestamp)}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="px-6 py-14 text-center text-sm text-[hsl(var(--muted-foreground))]">The house log is quiet.</div>
                      )}
                    </QueryState>
                  </section>
                </div>
              </div>
            </>
          )}
        </QueryState>
      </div>

      {incomeModal.open && <IncomeModal onClose={incomeModal.close} />}
      {expenseModal.open && <ExpenseModal onClose={expenseModal.close} />}
      {meetingModal.open && <MeetingModal onClose={meetingModal.close} />}
    </AppShell>
  );
}

function Metric({ icon, label, value, note, tone }: { icon: React.ReactNode; label: string; value: string | number; note: string; tone: string }) {
  const tones: Record<string, string> = { magenta: 'bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]', sand: 'bg-[hsl(38_66%_88%)] text-[hsl(31_70%_34%)]', blush: 'bg-[hsl(var(--accent))] text-[hsl(var(--primary))]', navy: 'bg-[hsl(219_48%_88%)] text-[hsl(219_64%_24%)]' };
  return (
    <div data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`} className="paper-card p-5 transition-transform hover:-translate-y-0.5">
      <div className="flex items-start justify-between">
        <div className="section-kicker max-w-[130px] leading-relaxed">{label}</div>
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${tones[tone]}`}>{icon}</div>
      </div>
      <div className="mt-4 text-3xl font-extrabold tracking-tight">{value}</div>
      <div className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">{note}</div>
    </div>
  );
}

function IncomeModal({ onClose }: { onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const [receivedDate, setReceivedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState('program_fee');
  const [houseId, setHouseId] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createIncome = useCreateIncome();
  const houses = useListHouses();
  const queryClient = useQueryClient();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    createIncome.mutate({
      data: {
        amount,
        receivedDate,
        category: category as any,
        ...(houseId ? { houseId: Number(houseId) } : {}),
        ...(description.trim() ? { description: description.trim() } : {})
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListActivityQueryKey() });
        onClose();
      },
      onError: (err: any) => {
        setError(err?.message || 'Permission denied or error saving income. Please contact your administrator.');
      }
    });
  };

  const houseOptions = [{ value: '', label: 'General / No specific house' }, ...(houses.data?.map(h => ({ value: h.id.toString(), label: h.name })) || [])];

  return (
    <Modal title="Record Income" eyebrow="Admin Action" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && <div className="rounded-lg bg-[hsl(var(--destructive)/.1)] p-4 text-sm font-bold text-[hsl(var(--destructive))]" data-testid="error-message">{error}</div>}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Amount ($)" name="amount" type="number" min="0.01" step="0.01" required value={amount} onChange={setAmount} placeholder="0.00" />
          <Field label="Date" name="receivedDate" type="date" required value={receivedDate} onChange={setReceivedDate} />
        </div>
        <SelectField label="Category" name="category" value={category} onChange={setCategory} options={[
          { value: 'program_fee', label: 'Program Fee' },
          { value: 'admission_fee', label: 'Admission Fee' },
          { value: 'grant', label: 'Grant' },
          { value: 'other', label: 'Other' }
        ]} />
        <SelectField label="House (Optional)" name="houseId" value={houseId} onChange={setHouseId} options={houseOptions} />
        <Field label="Description (Optional)" name="description" value={description} onChange={setDescription} />
        <div className="pt-2">
          <SubmitButton pending={createIncome.isPending}>Save Income</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}

function ExpenseModal({ onClose }: { onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState('housing');
  const [houseId, setHouseId] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createExpense = useCreateExpense();
  const houses = useListHouses();
  const queryClient = useQueryClient();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    createExpense.mutate({
      data: {
        amount,
        expenseDate,
        category: category as any,
        ...(houseId ? { houseId: Number(houseId) } : {}),
        ...(description.trim() ? { description: description.trim() } : {})
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListActivityQueryKey() });
        onClose();
      },
      onError: (err: any) => {
        setError(err?.message || 'Permission denied or error saving expense. Please contact your administrator.');
      }
    });
  };

  const houseOptions = [{ value: '', label: 'General / No specific house' }, ...(houses.data?.map(h => ({ value: h.id.toString(), label: h.name })) || [])];

  return (
    <Modal title="Record Expense" eyebrow="Admin Action" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && <div className="rounded-lg bg-[hsl(var(--destructive)/.1)] p-4 text-sm font-bold text-[hsl(var(--destructive))]" data-testid="error-message">{error}</div>}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Amount ($)" name="amount" type="number" min="0.01" step="0.01" required value={amount} onChange={setAmount} placeholder="0.00" />
          <Field label="Date" name="expenseDate" type="date" required value={expenseDate} onChange={setExpenseDate} />
        </div>
        <SelectField label="Category" name="category" value={category} onChange={setCategory} options={[
          { value: 'housing', label: 'Housing' },
          { value: 'utilities', label: 'Utilities' },
          { value: 'food', label: 'Food' },
          { value: 'transportation', label: 'Transportation' },
          { value: 'programming', label: 'Programming' },
          { value: 'payroll', label: 'Payroll' },
          { value: 'other', label: 'Other' }
        ]} />
        <SelectField label="House (Optional)" name="houseId" value={houseId} onChange={setHouseId} options={houseOptions} />
        <Field label="Description (Optional)" name="description" value={description} onChange={setDescription} />
        <div className="pt-2">
          <SubmitButton pending={createExpense.isPending}>Save Expense</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}

function MeetingModal({ onClose }: { onClose: () => void }) {
  const [meetingType, setMeetingType] = useState('recovery_meeting');
  const [meetingDate, setMeetingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [houseId, setHouseId] = useState('');
  const [womenAttended, setWomenAttended] = useState('');
  const [womenEligible, setWomenEligible] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMeeting = useCreateMeetingAttendance();
  const houses = useListHouses();
  const queryClient = useQueryClient();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    createMeeting.mutate({
      data: {
        meetingType: meetingType as any,
        meetingDate,
        ...(houseId ? { houseId: Number(houseId) } : {}),
        womenAttended: Number(womenAttended),
        womenEligible: Number(womenEligible),
        ...(notes.trim() ? { notes: notes.trim() } : {})
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListActivityQueryKey() });
        onClose();
      },
      onError: (err: any) => {
        setError(err?.message || 'Permission denied or error saving meeting. Please contact your administrator.');
      }
    });
  };

  const houseOptions = [{ value: '', label: 'General / No specific house' }, ...(houses.data?.map(h => ({ value: h.id.toString(), label: h.name })) || [])];

  return (
    <Modal title="Log Meeting" eyebrow="Staff Action" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && <div className="rounded-lg bg-[hsl(var(--destructive)/.1)] p-4 text-sm font-bold text-[hsl(var(--destructive))]" data-testid="error-message">{error}</div>}
        <div className="grid grid-cols-2 gap-4">
          <SelectField label="Type" name="meetingType" value={meetingType} onChange={setMeetingType} options={[
            { value: 'recovery_meeting', label: 'Recovery Meeting' },
            { value: 'house_meeting', label: 'House Meeting' },
            { value: 'life_skills', label: 'Life Skills' },
            { value: 'case_management', label: 'Case Management' },
            { value: 'other', label: 'Other' }
          ]} />
          <Field label="Date" name="meetingDate" type="date" required value={meetingDate} onChange={setMeetingDate} />
        </div>
        <SelectField label="House (Optional)" name="houseId" value={houseId} onChange={setHouseId} options={houseOptions} />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Women Attended" name="womenAttended" type="number" min="0" required value={womenAttended} onChange={setWomenAttended} />
          <Field label="Women Eligible" name="womenEligible" type="number" min="0" required value={womenEligible} onChange={setWomenEligible} />
        </div>
        <Field label="Notes (Optional)" name="notes" value={notes} onChange={setNotes} />
        <div className="pt-2">
          <SubmitButton pending={createMeeting.isPending}>Save Meeting</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}
