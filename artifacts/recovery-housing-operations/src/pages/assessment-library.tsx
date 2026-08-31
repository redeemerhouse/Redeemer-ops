import { Archive, Check, ClipboardList, Eye, GitBranch, Plus, Rocket, ShieldCheck } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAssessmentTemplateQueryKey,
  getListAssessmentTemplatesQueryKey,
  useCreateAssessmentRevision,
  useGetAssessmentTemplate,
  useListAssessmentTemplates,
  usePublishAssessmentTemplate,
  useRetireAssessmentTemplate,
  type AssessmentTemplate,
} from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { isAdministratorRole, useAuth } from '@/lib/auth';
import { EmptyState, Field, Modal, QueryState, StatusBadge, SubmitButton } from '@/components/ui-primitives';

export default function AssessmentLibrary() {
  const { user } = useAuth();
  const isAdministrator = isAdministratorRole(user?.role ?? 'resident');
  const templates = useListAssessmentTemplates();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sourceId, setSourceId] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const preview = useGetAssessmentTemplate(selectedId ?? 0, {
    query: {
      enabled: selectedId !== null,
      queryKey: getGetAssessmentTemplateQueryKey(selectedId ?? 0),
    },
  });
  const create = useCreateAssessmentRevision();
  const publish = usePublishAssessmentTemplate();
  const retire = useRetireAssessmentTemplate();

  const groups = useMemo(() => {
    const grouped = new Map<string, AssessmentTemplate[]>();
    for (const template of templates.data ?? []) {
      const versions = grouped.get(template.slug) ?? [];
      versions.push(template);
      grouped.set(template.slug, versions);
    }
    return [...grouped.entries()];
  }, [templates.data]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: getListAssessmentTemplatesQueryKey() });
  const actionError = create.error || publish.error || retire.error;

  if (!isAdministrator) {
    return <AppShell><div className="paper-card mx-auto max-w-2xl p-8"><div className="section-kicker">Assessment library</div><h1 className="display-serif mt-2 text-3xl">Administrator access required</h1><p className="mt-3 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">Only authorized administrators can create, publish, or retire assessment revisions.</p></div></AppShell>;
  }

  const openCreate = (source: AssessmentTemplate) => {
    setSourceId(source.id);
    setNotice('');
  };

  const closeCreate = () => {
    setSourceId(null);
    create.reset();
  };

  const onCreated = (revision: AssessmentTemplate) => {
    closeCreate();
    refresh();
    setNotice(`Version ${revision.version} is ready as a draft.`);
  };

  const changeStatus = (template: AssessmentTemplate, action: 'publish' | 'retire') => {
    if (action === 'retire' && !window.confirm(`Retire version ${template.version}? Existing completed assessments will remain readable.`)) return;
    setNotice('');
    const mutation = action === 'publish' ? publish : retire;
    mutation.mutate({ id: template.id }, {
      onSuccess: (updated) => {
        refresh();
        queryClient.invalidateQueries({ queryKey: getGetAssessmentTemplateQueryKey(updated.id) });
        setNotice(action === 'publish' ? `Version ${updated.version} is now available for new assessments.` : `Version ${updated.version} was retired.`);
      },
    });
  };

  return (
    <AppShell>
      <div className="animate-enter">
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <div className="section-kicker">Program configuration</div>
            <h1 className="display-serif mt-1 text-4xl tracking-tight">Assessment library</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">Improve resident forms with controlled revisions. Published versions are used for new records; completed responses keep the exact version they were submitted against.</p>
          </div>
          <div className="flex items-center gap-2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.65)] px-4 py-3 text-xs text-[hsl(var(--muted-foreground))]"><ShieldCheck size={16} className="text-[hsl(var(--primary))]" /><span>Admin changes are audited</span></div>
        </div>
        {notice && <div data-testid="status-assessment-library" className="mt-6 flex items-center gap-2 rounded-2xl border border-[hsl(169_38%_68%)] bg-[hsl(169_32%_87%/.62)] px-4 py-3 text-sm font-bold text-[hsl(169_42%_27%)]"><Check size={16} /> {notice}</div>}
        {actionError && <div data-testid="status-assessment-library-error" className="mt-6 rounded-2xl border border-[hsl(7_58%_75%)] bg-[hsl(9_63%_90%/.55)] px-4 py-3 text-sm font-semibold text-[hsl(var(--destructive))]">That library change could not be completed. Refresh and try again.</div>}
        <div className="mt-8">
          <QueryState loading={templates.isLoading} error={templates.isError} errorDetail="Assessment versions could not be loaded." retry={refresh}>
            {groups.length ? <div className="space-y-5">{groups.map(([slug, versions]) => {
              const active = versions.find((template) => template.status === 'active') ?? versions[0];
              return <section key={slug} className="paper-card overflow-hidden" data-testid={`assessment-template-group-${slug}`}>
                <div className="flex flex-col gap-4 border-b border-[hsl(var(--border))] px-6 py-5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(169_32%_87%)] text-[hsl(var(--primary))]"><ClipboardList size={18} /></div><div><div className="section-kicker">{active.category === 'resident' ? 'Resident form' : 'Staff form'}</div><h2 className="display-serif mt-1 text-2xl">{active.title}</h2><p className="mt-1 max-w-2xl text-sm text-[hsl(var(--muted-foreground))]">{active.description}</p></div></div>
                  <button data-testid={`button-create-revision-${active.id}`} type="button" onClick={() => openCreate(active)} className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-extrabold text-[hsl(var(--primary-foreground))]"><Plus size={15} /> New draft</button>
                </div>
                <div className="divide-y divide-[hsl(var(--border))]">{versions.map((template) => <div key={template.id} data-testid={`assessment-version-${template.id}`} className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center"><div className="flex min-w-0 flex-1 items-center gap-3"><GitBranch size={15} className="shrink-0 text-[hsl(var(--muted-foreground))]" /><div><div className="text-sm font-extrabold">Version {template.version}</div><div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{template.sections.length} sections · {template.sections.reduce((total, section) => total + section.fields.length, 0)} fields</div></div></div><StatusBadge status={template.status} /><div className="flex flex-wrap gap-2 sm:justify-end"><button data-testid={`button-preview-template-${template.id}`} type="button" onClick={() => setSelectedId(template.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-[11px] font-extrabold hover:bg-[hsl(var(--secondary))]"><Eye size={13} /> Preview</button>{template.status === 'draft' && <button data-testid={`button-publish-template-${template.id}`} type="button" disabled={publish.isPending} onClick={() => changeStatus(template, 'publish')} className="inline-flex items-center gap-1.5 rounded-lg bg-[hsl(var(--primary))] px-3 py-2 text-[11px] font-extrabold text-[hsl(var(--primary-foreground))] disabled:opacity-50"><Rocket size={13} /> Publish</button>}{template.status === 'active' && <button data-testid={`button-retire-template-${template.id}`} type="button" disabled={retire.isPending} onClick={() => changeStatus(template, 'retire')} className="inline-flex items-center gap-1.5 rounded-lg border border-[hsl(var(--destructive)/.35)] px-3 py-2 text-[11px] font-extrabold text-[hsl(var(--destructive))] disabled:opacity-50"><Archive size={13} /> Retire</button>}</div></div>)}</div>
              </section>;
            })}</div> : <EmptyState title="No assessment templates" detail="Seed or create an assessment template before managing revisions." />}
          </QueryState>
        </div>
      </div>
      {sourceId !== null && <RevisionModal source={templates.data?.find((template) => template.id === sourceId)} pending={create.isPending} error={create.isError} onClose={closeCreate} onSubmit={(data) => create.mutate({ id: sourceId, data }, { onSuccess: onCreated })} />}
      {selectedId !== null && <PreviewModal template={preview.data} loading={preview.isLoading} error={preview.isError} onClose={() => setSelectedId(null)} />}
    </AppShell>
  );
}

function RevisionModal({ source, pending, error, onClose, onSubmit }: { source?: AssessmentTemplate; pending: boolean; error: boolean; onClose: () => void; onSubmit: (data: { title: string; description: string; schema: AssessmentTemplate['sections'] }) => void }) {
  const [title, setTitle] = useState(source?.title ?? '');
  const [description, setDescription] = useState(source?.description ?? '');
  const [schemaText, setSchemaText] = useState(() => JSON.stringify(source?.sections ?? [], null, 2));
  const [schemaError, setSchemaError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      const schema = JSON.parse(schemaText);
      if (!Array.isArray(schema) || schema.length === 0) throw new Error('Add at least one section.');
      setSchemaError('');
      onSubmit({ title: title.trim(), description: description.trim(), schema });
    } catch (error) {
      setSchemaError(error instanceof Error ? error.message : 'The section JSON is invalid.');
    }
  };
  return <Modal title="Create a draft revision" eyebrow={`Based on version ${source?.version ?? '—'}`} onClose={onClose}><form onSubmit={submit} className="space-y-5"><Field label="Title" name="assessment-revision-title" value={title} onChange={setTitle} required /><Field label="Description" name="assessment-revision-description" value={description} onChange={setDescription} required /><label className="block"><span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">Sections and fields JSON <span className="text-[hsl(var(--accent))]">*</span></span><textarea data-testid="input-assessment-revision-schema" value={schemaText} onChange={(event) => setSchemaText(event.target.value)} rows={10} className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--card))] p-3 font-mono text-[11px] outline-none focus:border-[hsl(var(--primary))]" /></label>{schemaError && <p data-testid="status-assessment-revision-schema-error" className="text-xs font-semibold text-[hsl(var(--destructive))]">{schemaError}</p>}{error && <p data-testid="status-assessment-revision-error" className="text-xs font-semibold text-[hsl(var(--destructive))]">The draft could not be created. Check the fields and try again.</p>}<div className="flex justify-end gap-3 border-t border-[hsl(var(--border))] pt-5"><button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-xs font-extrabold text-[hsl(var(--muted-foreground))]">Cancel</button><SubmitButton pending={pending}>Save draft version</SubmitButton></div></form></Modal>;
}

function PreviewModal({ template, loading, error, onClose }: { template?: AssessmentTemplate; loading: boolean; error: boolean; onClose: () => void }) {
  return <Modal title={template ? `${template.title} · v${template.version}` : 'Preview assessment'} eyebrow={template ? `${template.status} version · ${template.category}` : 'Loading'} onClose={onClose}><QueryState loading={loading} error={error} errorDetail="This version could not be previewed."><div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">{template?.sections.map((section, index) => <div key={section.id} className="rounded-2xl border border-[hsl(var(--border))] p-4"><div className="section-kicker">Section {index + 1}</div><h3 className="display-serif mt-1 text-xl">{section.title}</h3>{section.instructions && <p className="mt-2 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">{section.instructions}</p>}<div className="mt-4 space-y-2">{section.fields.map((field) => <div key={field.id} className="flex items-center justify-between gap-3 rounded-xl bg-[hsl(var(--secondary)/.55)] px-3 py-2.5 text-xs"><span className="font-bold">{field.label}</span><span className="mono text-[10px] uppercase text-[hsl(var(--muted-foreground))]">{field.type}{field.required ? ' · required' : ''}</span></div>)}</div></div>)}</div><div className="mt-5 flex items-center gap-2 border-t border-[hsl(var(--border))] pt-4 text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]"><ShieldCheck size={14} className="shrink-0 text-[hsl(var(--primary))]" /> Preview is read-only. Version history and lifecycle actions are retained in the audit trail.</div></QueryState></Modal>;
}