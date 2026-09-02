import { AlertCircle, CheckCircle2, ClipboardCheck, Download, FileSpreadsheet, FileText, Home, Plus, RefreshCw, ShieldCheck, Upload, UsersRound } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/app-shell';
import { EmptyState, Field, Modal, QueryState, SelectField, SubmitButton, useDisclosure } from '@/components/ui-primitives';
import { confirmResidentImport, downloadResidentTemplate, exportReport, get, getReportPreview, previewResidentImport, reportFilename, reportTypes, safeClientError, type ReportFormat, type ReportType } from '@/lib/api';
import { useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { isAdministratorRole, isStaffRole, useAuth } from '@/lib/auth';

const date = (value?: string) => value ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(value)) : 'Not scheduled';

export default function Operations() {
  const { user } = useAuth();
  const isAdministrator = isAdministratorRole(user?.role ?? 'resident');
  const canViewReports = isStaffRole(user?.role ?? 'resident');
  const canImportResidents = isStaffRole(user?.role ?? 'resident');
  const client = useQueryClient();
  const [section, setSection] = useState<'applications' | 'houses' | 'daily' | 'documents' | 'reports' | 'import'>('applications');
  const applications = useQuery({ queryKey: ['/applications'], queryFn: () => get('/applications'), enabled: section === 'applications' });
  const houses = useQuery({ queryKey: ['/houses'], queryFn: () => get('/houses'), enabled: section === 'houses' || section === 'reports' });
  const daily = useQuery({ queryKey: ['/operations'], queryFn: () => get('/operations'), enabled: section === 'daily' });
  const reports = useQuery({ queryKey: ['/reports/summary'], queryFn: () => get('/reports/summary'), enabled: section === 'reports' && canViewReports });
  const documents = useQuery({ queryKey: ['/documents'], queryFn: () => get('/documents?role=staff'), enabled: section === 'documents' });
  const active = section === 'applications' ? applications : section === 'houses' ? houses : section === 'daily' ? daily : section === 'documents' ? documents : section === 'reports' ? reports : undefined;
  const modal = useDisclosure();
  return <AppShell><div className="animate-enter">
    <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><div className="section-kicker">ONEsource workspace</div><h1 data-testid="text-page-title" className="display-serif mt-2 text-4xl tracking-tight sm:text-5xl">Operations</h1><p className="mt-3 max-w-xl text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">One dependable place for intake, placement, daily care, and accountability across all four houses.</p></div><button onClick={() => client.invalidateQueries()} className="flex w-fit items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-2.5 text-xs font-extrabold"><RefreshCw size={15} /> Refresh workspace</button></div>
    <div className="mt-8 grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">{[
      ['applications', 'Applications', ClipboardCheck], ['houses', 'Houses & beds', Home], ['daily', 'Daily operations', ShieldCheck], ['documents', 'Documents', FileText], ['import', 'Import clients', FileSpreadsheet], ['reports', 'Reports', FileText],
    ].map(([value, label, Icon]) => <button key={String(value)} onClick={() => setSection(value as typeof section)} className={`flex items-center gap-3 rounded-2xl border p-4 text-left transition-colors ${section === value ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/.08)]' : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:bg-[hsl(var(--secondary))]'}`}><Icon size={18} /><span className="text-xs font-extrabold">{String(label)}</span></button>)}</div>
    <QueryState loading={active?.isLoading} error={active?.isError} retry={() => active?.refetch()}><div className="paper-card mt-6 overflow-hidden">
      {section === 'applications' && <Applications data={applications.data ?? []} onNew={modal.toggle} />}
      {section === 'houses' && <Houses data={houses.data ?? []} />}
      {section === 'daily' && <Daily data={daily.data ?? []} />}
      {section === 'documents' && <Documents data={documents.data ?? []} onSaved={() => client.invalidateQueries({ queryKey: ['/documents'] })} />}
      {section === 'import' && <ResidentImport canImportResidents={canImportResidents} />}
      {section === 'reports' && <Reports data={reports.data} houses={houses.data ?? []} canViewReports={canViewReports} isAdministrator={isAdministrator} />}
    </div></QueryState>
    {modal.open && <ApplicationModal onClose={modal.close} onSaved={() => { modal.close(); client.invalidateQueries({ queryKey: ['/applications'] }); }} />}
  </div></AppShell>;
}

function Header({ eyebrow, title, action }: { eyebrow: string; title: string; action?: React.ReactNode }) { return <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-6 py-5"><div><div className="section-kicker">{eyebrow}</div><h2 className="display-serif mt-1 text-2xl">{title}</h2></div>{action}</div>; }

function Documents({ data, onSaved }: { data: any[]; onSaved: () => void }) {
  const modal = useDisclosure();
  return <><Header eyebrow="Secure records" title="Documents" action={<button onClick={modal.toggle} className="flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-3 py-2 text-xs font-extrabold text-white"><Upload size={14} /> Upload document</button>} />
    {data.length ? <div className="divide-y divide-[hsl(var(--border))]">{data.map((doc) => <div key={doc.id} className="flex items-center gap-4 px-6 py-4"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]"><FileText size={17} /></div><div className="min-w-0 flex-1"><div className="truncate text-sm font-extrabold">{doc.title}</div><div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{doc.category} · {doc.fileName ?? 'Stored file'} · {doc.visibility === 'resident' ? 'Shared with resident' : 'Staff only'}</div></div><span className="rounded-full bg-[hsl(var(--secondary))] px-2.5 py-1 text-[10px] font-extrabold uppercase">{doc.status}</span></div>)}</div> : <div className="p-6"><EmptyState title="No documents yet" detail="Upload signed agreements, waivers, referrals, financials, and staff resources. Files are stored outside the database." /></div>}
    {modal.open && <DocumentModal onClose={modal.close} onSaved={() => { modal.close(); onSaved(); }} />}
  </>;
}
function Applications({ data, onNew }: { data: any[]; onNew: () => void }) { return <><Header eyebrow="Admission pipeline" title="Applications" action={<button onClick={onNew} className="flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-3 py-2.5 text-xs font-extrabold text-white"><Plus size={15} /> New application</button>} />{data.length ? <div className="divide-y divide-[hsl(var(--border))]">{data.map((a) => <div key={a.id} className="flex flex-wrap items-center gap-4 px-6 py-4"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]"><UsersRound size={16} /></div><div className="min-w-[180px] flex-1"><div className="text-sm font-extrabold">{a.applicantName}</div><div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{a.email} · {date(a.createdAt)}</div></div><span className="rounded-full bg-[hsl(38_66%_88%)] px-2.5 py-1 text-[10px] font-extrabold uppercase">{a.status}</span></div>)}</div> : <div className="p-6"><EmptyState title="No applications yet" detail="Start an intake record to track requirements, waivers, referrals, and approval history." action={<button onClick={onNew} className="rounded-xl bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-extrabold text-white">Start intake</button>} /></div>}</>; }
function Houses({ data }: { data: any[] }) { return <><Header eyebrow="Capacity & placement" title="Houses and beds" />{data.length ? <div className="grid gap-4 p-6 md:grid-cols-2">{data.map((h) => <div key={h.id} className="rounded-2xl border border-[hsl(var(--border))] p-5"><div className="flex items-start justify-between"><div><div className="text-sm font-extrabold">{h.name}</div><div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{h.address}</div></div><Home size={18} className="text-[hsl(var(--primary))]" /></div><div className="mt-6 flex items-end justify-between"><div><div className="section-kicker">Current residents</div><div className="mt-1 text-2xl font-extrabold">{h.occupancy}</div></div><div className="text-right"><div className="section-kicker">Family capacity</div><div className="mt-1 text-lg font-extrabold">{h.familyCapacity}</div></div></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><div className="h-full rounded-full bg-[hsl(var(--primary))]" style={{ width: `${Math.min((h.occupancy / Math.max(h.familyCapacity, 1)) * 100, 100)}%` }} /></div><div className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">Individual ${h.individualWeekly}/week · Family ${h.familyWeekly}/week</div></div>)}</div> : <div className="p-6"><EmptyState title="No houses configured" detail="Add the four Redeemer House locations to begin assigning capacity." /></div>}</>; }
function Daily({ data }: { data: any[] }) { return <><Header eyebrow="Today & recurring" title="Daily operations" />{data.length ? <div className="divide-y divide-[hsl(var(--border))]">{data.map((o) => <div key={o.id} className="flex items-center gap-4 px-6 py-4"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[hsl(38_66%_88%)]"><ClipboardCheck size={16} /></div><div className="flex-1"><div className="text-sm font-extrabold">{o.title}</div><div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{o.type} · {date(o.scheduledDate)}</div></div><span className="text-[10px] font-extrabold uppercase text-[hsl(var(--muted-foreground))]">{o.status}</span></div>)}</div> : <div className="p-6"><EmptyState title="The daily board is clear" detail="Randomized UAs, meetings, chores, milestones, incidents, and grievances will appear here." /></div>}</>; }
function Reports({ data, houses, canViewReports, isAdministrator }: { data?: any; houses: any[]; canViewReports: boolean; isAdministrator: boolean }) {
  const [reportType, setReportType] = useState<ReportType>('occupancy');
  const [format, setFormat] = useState<ReportFormat>('csv');
  const [house, setHouse] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [state, setState] = useState<{ type: 'empty' | 'error' | 'success'; message: string } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const filters = { house: house || undefined, from: from || undefined, to: to || undefined };
  const report = useQuery({
    queryKey: ['report-preview', reportType, house, from, to],
    queryFn: () => getReportPreview(reportType, filters),
    enabled: canViewReports,
  });
  const download = async () => {
    setState(null);
    setDownloading(true);
    try {
      const response = await exportReport(reportType, format, filters);
      if (response.status === 404) {
        const body = await response.json().catch(() => ({}));
        setState({ type: 'empty', message: body.error || 'There is no data available for this report yet.' });
        return;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Unable to export this report.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = reportFilename(response, `${reportType}-report.${format}`);
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setState({ type: 'success', message: `Exported ${reportType} report. The download was recorded with the actor and timestamp.` });
    } catch (error) {
      setState({ type: 'error', message: error instanceof Error ? error.message : 'Unable to export this report.' });
    } finally {
      setDownloading(false);
    }
  };
  if (!canViewReports) return <><Header eyebrow="Restricted module" title="Reports" /><div className="p-6"><EmptyState title="Reports are not available" detail="Residents do not have access to operational reports." /></div></>;
  const rows = report.data?.rows ?? [];
  const tableColumns = rows.length ? Object.keys(rows[0]) : [];
  return <><Header eyebrow="Administrator & house scope" title="Reporting center" />
    <div className="grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-4">{[['Active residents', data?.occupancy?.active ?? 0], ['Collected', `$${data?.payments?.collected ?? 0}`], ['Overdue payments', data?.payments?.overdue ?? 0], ['Audit events', data?.auditEvents ?? 0]].map(([label, value]) => <div key={String(label)} className="rounded-2xl bg-[hsl(var(--secondary)/.55)] p-4"><div className="section-kicker">{String(label)}</div><div className="mt-2 text-2xl font-extrabold">{String(value)}</div></div>)}</div>
    <div className="border-t border-[hsl(var(--border))] px-6 py-5">
      <div className="section-kicker">Approved downloads</div>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">Preview the report rows before exporting. Administrators can export organization-wide; house managers can view only their assigned houses.</p>
      {state && <div role={state.type === 'error' ? 'alert' : 'status'} className={`mt-4 flex items-start gap-2 rounded-xl px-4 py-3 text-xs font-bold ${state.type === 'error' ? 'bg-[hsl(4_70%_94%)] text-[hsl(4_60%_35%)]' : state.type === 'success' ? 'bg-[hsl(161_40%_88%)] text-[hsl(169_42%_27%)]' : 'bg-[hsl(var(--secondary))]'}`}><CheckCircle2 size={15} className="mt-0.5 shrink-0" />{state.message}</div>}
      <div className="mt-5 grid gap-3 rounded-2xl border border-[hsl(var(--border))] p-4 sm:grid-cols-2 lg:grid-cols-5">
        <SelectField label="Report" name="report-type" value={reportType} onChange={(value) => { setReportType(value as ReportType); setState(null); }} options={reportTypes} />
        <SelectField label="House" name="report-house" value={house} onChange={setHouse} options={[{ value: '', label: 'All permitted houses' }, ...houses.map((item) => ({ value: item.name, label: item.name }))]} />
        <Field label="From" name="report-from" value={from} onChange={setFrom} type="date" />
        <Field label="To" name="report-to" value={to} onChange={setTo} type="date" />
        <div className="flex items-end gap-2"><SelectField label="Format" name="report-format" value={format} onChange={(value) => setFormat(value as ReportFormat)} options={[{ value: 'csv', label: 'CSV' }, { value: 'pdf', label: 'PDF' }]} /><button data-testid="button-download-report" onClick={download} disabled={downloading || !isAdministrator} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 text-xs font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-60"><Download size={14} />{downloading ? 'Preparing…' : 'Export'}</button></div>
      </div>
      {!isAdministrator && <p className="mt-3 text-xs font-bold text-[hsl(var(--muted-foreground))]">House managers can review permitted rows here; export access is reserved for administrators.</p>}
      {report.isLoading && <div className="py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">Loading report rows…</div>}
      {!report.isLoading && !rows.length && <div className="mt-4"><EmptyState title="No matching data" detail="Try another report, house, or date range. Empty reports are kept clear rather than downloading a blank file." /></div>}
      {!!rows.length && <div className="mt-5 overflow-x-auto rounded-2xl border border-[hsl(var(--border))]"><table className="w-full min-w-[620px] text-left text-xs"><thead className="bg-[hsl(var(--secondary)/.6)]"><tr>{tableColumns.map((column) => <th key={column} className="px-4 py-3 font-extrabold uppercase tracking-[.08em]">{column}</th>)}</tr></thead><tbody className="divide-y divide-[hsl(var(--border))]">{rows.map((row: Record<string, unknown>, index: number) => <tr key={index} className="hover:bg-[hsl(var(--secondary)/.3)]">{tableColumns.map((column) => <td key={column} className="px-4 py-3 align-top">{String(row[column] ?? '—')}</td>)}</tr>)}</tbody></table></div>}
    </div>
  </>;
}

function ResidentImport({ canImportResidents }: { canImportResidents: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewResidentImport>> | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const chooseFile = (next: File | null) => { setFile(next); setPreview(null); setSelected([]); setMessage(null); };
  const previewFile = async () => {
    if (!file) return;
    setBusy(true); setMessage(null);
    try {
      const result = await previewResidentImport(file);
      setPreview(result);
      setSelected(result.rows.filter((row) => row.valid).map((row) => row.rowNumber));
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Unable to preview this file.' });
    } finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!preview || !selected.length) return;
    setBusy(true); setMessage(null);
    try {
      const result = await confirmResidentImport(preview.batchId, selected);
      setMessage({ type: 'success', text: `Import complete: ${result.imported} resident${result.imported === 1 ? '' : 's'} added. ${result.skipped} row${result.skipped === 1 ? '' : 's'} remain skipped or failed in the audit batch.` });
      setPreview({ ...preview, rows: preview.rows.map((row) => selected.includes(row.rowNumber) ? { ...row, valid: false, errors: ['Imported successfully.'] } : row), summary: { ...preview.summary, valid: preview.summary.valid - result.imported } });
      setSelected([]);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Unable to confirm this import.' });
    } finally { setBusy(false); }
  };
  if (!canImportResidents) return <><Header eyebrow="Restricted module" title="Import clients" /><div className="p-6"><EmptyState title="Client import is not available" detail="Only authorized staff can bring current clients into ONEsource." /></div></>;
  return <><Header eyebrow="Safe onboarding" title="Import current clients" />
    <div className="grid gap-6 p-6 lg:grid-cols-[1fr_1.2fr]">
      <div>
        <div className="section-kicker">Step 1 · Use the contract</div>
        <h3 className="display-serif mt-1 text-2xl">One client per row</h3>
        <p className="mt-2 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">Download a clean template, fill only supported fields, then upload CSV or Excel. Sensitive treatment, health, disability, medication, and spiritual fields are intentionally rejected.</p>
        <div className="mt-4 flex flex-wrap gap-2"><button onClick={() => downloadResidentTemplate('csv')} className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-xs font-extrabold"><Download size={14} /> CSV template</button><button onClick={() => downloadResidentTemplate('xlsx')} className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-xs font-extrabold"><FileSpreadsheet size={14} /> Excel template</button></div>
        <div className="mt-5 rounded-2xl bg-[hsl(var(--secondary)/.55)] p-4 text-xs leading-relaxed"><strong>Required:</strong> name, email, phone, home, moveInDate, status.<br /><strong>Optional:</strong> balance, nextPaymentDate, familyStatus, lifecycleState, notes.<br /><strong>Rules:</strong> dates use YYYY-MM-DD; status is active, pending, or exited; money is non-negative with up to two decimals. Existing matches use normalized email, then name + phone.</div>
        <div className="mt-5"><div className="section-kicker">Step 2 · Upload and preview</div><label className="mt-2 block"><span className="sr-only">Client import file</span><input data-testid="input-client-import" type="file" accept=".csv,.xlsx,.xls" onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--card))] p-2 text-sm" /></label><button onClick={previewFile} disabled={!file || busy} className="mt-3 flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-50"><Upload size={14} />{busy ? 'Checking file…' : 'Preview rows'}</button></div>
      </div>
      <div className="min-w-0">
        {message && <div role={message.type === 'error' ? 'alert' : 'status'} className={`mb-4 flex items-start gap-2 rounded-xl px-4 py-3 text-xs font-bold ${message.type === 'error' ? 'bg-[hsl(4_70%_94%)] text-[hsl(4_60%_35%)]' : 'bg-[hsl(161_40%_88%)] text-[hsl(169_42%_27%)]'}`}><CheckCircle2 size={15} className="mt-0.5 shrink-0" />{message.text}</div>}
        {!preview && <div className="flex min-h-[290px] flex-col items-center justify-center rounded-2xl border border-dashed border-[hsl(var(--border))] p-6 text-center"><FileSpreadsheet size={30} className="text-[hsl(var(--primary))]" /><div className="mt-3 text-sm font-extrabold">Preview before anything is saved</div><p className="mt-2 max-w-sm text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">Every row is checked for required fields, dates, money, house assignments, statuses, formulas, and duplicate matches.</p></div>}
        {preview && <div>
          <div className="flex flex-wrap items-end justify-between gap-3"><div><div className="section-kicker">Step 3 · Review and confirm</div><h3 className="display-serif mt-1 text-2xl">{preview.sourceFilename}</h3></div><div className="text-right text-xs"><strong>{preview.summary.valid}</strong> ready · <strong>{preview.summary.failed}</strong> need attention</div></div>
          <div className="mt-3 rounded-xl bg-[hsl(var(--secondary)/.55)] p-3 text-xs leading-relaxed"><strong>Identity policy:</strong> {preview.identityRule}</div>
          <div className="mt-4 max-h-[390px] overflow-auto rounded-2xl border border-[hsl(var(--border))]"><table className="w-full min-w-[620px] text-left text-xs"><thead className="sticky top-0 bg-[hsl(var(--secondary))]"><tr><th className="px-3 py-3">Include</th><th className="px-3 py-3">Row</th><th className="px-3 py-3">Resident</th><th className="px-3 py-3">House</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Review</th></tr></thead><tbody className="divide-y divide-[hsl(var(--border))]">{preview.rows.map((row) => <tr key={row.rowNumber} className={row.valid ? '' : 'bg-[hsl(4_70%_97%)]'}><td className="px-3 py-3">{row.valid ? <input aria-label={`Include row ${row.rowNumber}`} type="checkbox" checked={selected.includes(row.rowNumber)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, row.rowNumber] : current.filter((number) => number !== row.rowNumber))} /> : <AlertCircle size={15} className="text-[hsl(var(--destructive))]" />}</td><td className="px-3 py-3 font-mono">{row.rowNumber}</td><td className="px-3 py-3 font-bold">{String(row.normalizedData.name ?? row.sourceData.name ?? '—')}</td><td className="px-3 py-3">{String(row.normalizedData.home ?? row.sourceData.home ?? '—')}</td><td className="px-3 py-3">{String(row.normalizedData.status ?? row.sourceData.status ?? '—')}</td><td className="max-w-[230px] px-3 py-3 text-[hsl(var(--muted-foreground))]">{row.errors.length ? row.errors.join(' ') : 'Ready to import'}</td></tr>)}</tbody></table></div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="max-w-md text-xs text-[hsl(var(--muted-foreground))]">Only checked, valid rows are saved. Failed and skipped rows remain visible in this batch and can be corrected in a new upload.</p><button onClick={confirm} disabled={busy || !selected.length} className="rounded-xl bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'Importing…' : `Confirm import of ${selected.length} row${selected.length === 1 ? '' : 's'}`}</button></div>
        </div>}
      </div>
    </div>
  </>;
}

function ApplicationModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ applicantName: '', email: '', phone: '', status: 'submitted', signedAcknowledgment: false, source: 'direct' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await customFetch('/api/applications', { method: 'POST', body: JSON.stringify(form), responseType: 'json' });
      onSaved();
    } catch {
      setError('We couldn’t save this application. Please try again.');
    } finally {
      setSaving(false);
    }
  };
  return <Modal title="Start an application" eyebrow="New intake" onClose={onClose}><form onSubmit={submit} className="space-y-4"><Field label="Applicant name" name="application-name" value={form.applicantName} onChange={set('applicantName')} required placeholder="Full legal name" /><Field label="Email" name="application-email" value={form.email} onChange={set('email')} type="email" required placeholder="applicant@email.com" /><Field label="Phone" name="application-phone" value={form.phone} onChange={set('phone')} placeholder="(555) 000-0000" /><SelectField label="Source" name="application-source" value={form.source} onChange={set('source')} options={[{ value: 'direct', label: 'Direct inquiry' }, { value: 'referral', label: 'Referral partner' }, { value: 'one-step', label: 'One Step import' }]} /><label className="flex items-start gap-3 rounded-xl bg-[hsl(var(--secondary)/.5)] p-3 text-xs leading-relaxed"><input type="checkbox" checked={form.signedAcknowledgment} onChange={(e) => setForm((f) => ({ ...f, signedAcknowledgment: e.target.checked }))} required /> Applicant acknowledges the intake and consent statement.</label>{error && <div role="alert" className="rounded-xl bg-[hsl(4_70%_94%)] px-4 py-3 text-xs font-bold text-[hsl(4_60%_35%)]">{error}</div>}<div className="flex justify-end gap-3 border-t border-[hsl(var(--border))] pt-5"><button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-xs font-extrabold">Cancel</button><SubmitButton pending={saving}>Create application</SubmitButton></div></form></Modal>;
}

function DocumentModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({ title: '', category: 'agreement', residentId: '', visibility: 'staff' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (!file || !form.title) return; setSaving(true); setError('');
    try {
      const upload = await customFetch<{ uploadURL: string; objectPath: string }>('/api/storage/uploads/request-url', { method: 'POST', body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type || 'application/octet-stream' }), responseType: 'json' });
      const put = await fetch(upload.uploadURL, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file, signal: AbortSignal.timeout(30_000) });
      if (!put.ok) throw new Error('File upload failed');
      await customFetch('/api/documents', { method: 'POST', body: JSON.stringify({ title: form.title, category: form.category, residentId: form.residentId ? Number(form.residentId) : null, objectPath: upload.objectPath, fileName: file.name, contentType: file.type || 'application/octet-stream', fileSize: file.size, visibility: form.visibility }), responseType: 'json' });
      onSaved();
    } catch (failure) {
      setError(safeClientError(failure, 'The document could not be uploaded. Try again or contact an administrator.'));
    } finally { setSaving(false); }
  };
  return <Modal title="Upload document" eyebrow="Secure records" onClose={onClose}><form onSubmit={submit} className="space-y-4"><Field label="Document title" name="document-title" value={form.title} onChange={(v) => setForm((f) => ({ ...f, title: v }))} required placeholder="Signed recovery agreement" /><SelectField label="Category" name="document-category" value={form.category} onChange={(v) => setForm((f) => ({ ...f, category: v }))} options={[{ value: 'agreement', label: 'Agreement' }, { value: 'waiver', label: 'Waiver' }, { value: 'referral', label: 'Referral' }, { value: 'financial', label: 'Financial' }, { value: 'staff', label: 'Staff resource' }]} /><label className="block"><span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">File</span><input required type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="w-full rounded-xl border border-[hsl(var(--input))] p-2 text-sm" /></label><SelectField label="Sharing" name="document-visibility" value={form.visibility} onChange={(v) => setForm((f) => ({ ...f, visibility: v }))} options={[{ value: 'staff', label: 'Staff only' }, { value: 'resident', label: 'Share with resident' }]} /><Field label="Resident ID (required when shared)" name="document-resident" value={form.residentId} onChange={(v) => setForm((f) => ({ ...f, residentId: v }))} type="number" placeholder="e.g. 12" />{error && <div role="alert" data-testid="status-document-upload-error" className="rounded-xl bg-[hsl(4_70%_94%)] px-4 py-3 text-xs font-bold text-[hsl(4_60%_35%)]">{error}</div>}<div className="flex justify-end gap-3 border-t border-[hsl(var(--border))] pt-5"><button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-xs font-extrabold">Cancel</button><SubmitButton pending={saving}>Upload securely</SubmitButton></div></form></Modal>;
}
