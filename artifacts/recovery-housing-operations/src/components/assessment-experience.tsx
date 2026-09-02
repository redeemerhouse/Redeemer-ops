import { ArrowLeft, Check, ChevronRight, ClipboardCheck, FileText, LockKeyhole, Plus, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAssessmentQueryKey,
  getListAssessmentTemplatesQueryKey,
  getListResidentAssessmentsQueryKey,
  useCreateResidentAssessment,
  useGetAssessment,
  useListAssessmentTemplates,
  useListResidentAssessments,
  useSubmitAssessment,
  useUpdateAssessmentDraft,
  type AssessmentField,
  type AssessmentSummary,
  type AssessmentTemplate,
} from '@workspace/api-client-react';
import { useAuth, type SessionRole } from '@/lib/auth';
import { AppShell } from '@/components/app-shell';
import { Modal, EmptyState, PageControls, QueryState, StatusBadge } from '@/components/ui-primitives';

type Answers = Record<string, unknown>;
type Row = Record<string, unknown>;

const dateLabel = (value?: string | null) => {
  if (!value) return 'Not recorded';
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? 'Not recorded'
    : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
};

const fieldIsAnswered = (field: AssessmentField, value: unknown) => {
  if (Array.isArray(value)) return value.length > 0;
  if (field.type === 'yes_no') return value === 'yes' || value === 'no';
  return value !== undefined && value !== null && String(value).trim().length > 0;
};

const answerForField = (field: AssessmentField, answers: Answers) => {
  const value = answers[field.id];
  if (value !== undefined) return value;
  if (field.type === 'checklist' || field.type === 'repeating_group') return [];
  return field.type === 'yes_no' ? false : '';
};

const activeTemplatesForRole = (templates: AssessmentTemplate[] | undefined, role: SessionRole) =>
  (templates ?? []).filter((template) =>
    template.status === 'active' &&
    (role === 'resident'
      ? template.category === 'resident' && template.audience === 'resident'
      : true));

export function ResidentAssessments({ residentId }: { residentId: number }) {
  const { user } = useAuth();
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const assessments = useListResidentAssessments(residentId, { limit: 100, offset }, { request: { onResponse: (response) => setHasMore(response.headers.get('x-has-more') === 'true') } });
  const templates = useListAssessmentTemplates();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [chooserOpen, setChooserOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const create = useCreateResidentAssessment();
  const availableTemplates = activeTemplatesForRole(templates.data, user?.role ?? 'resident');

  const startAssessment = () => {
    if (!selectedTemplate) return;
    create.mutate({ id: residentId, data: { templateId: Number(selectedTemplate) } }, {
      onSuccess: (assessment) => {
        queryClient.invalidateQueries({ queryKey: getListResidentAssessmentsQueryKey(residentId) });
        queryClient.invalidateQueries({ queryKey: getListAssessmentTemplatesQueryKey() });
        setChooserOpen(false);
        setSelectedTemplate('');
        setLocation(`/assessments/${assessment.id}`);
      },
    });
  };

  return (
    <section className="paper-card mt-6 overflow-hidden" data-testid="section-resident-assessments">
      <div className="flex flex-col gap-4 border-b border-[hsl(var(--border))] px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(169_32%_87%)] text-[hsl(var(--primary))]">
            <ClipboardCheck size={19} />
          </div>
          <div>
            <div className="section-kicker">Resident record</div>
            <h2 className="display-serif mt-1 text-2xl">Assessments</h2>
            <p className="mt-1 max-w-lg text-sm text-[hsl(var(--muted-foreground))]">Keep important check-ins together, with privacy and progress visible at a glance.</p>
          </div>
        </div>
        <button
          data-testid="button-start-assessment"
          type="button"
          onClick={() => setChooserOpen(true)}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 text-xs font-extrabold text-[hsl(var(--primary-foreground))] transition-transform hover:-translate-y-0.5 sm:w-auto"
        >
          <Plus size={15} /> Start assessment
        </button>
      </div>
      <QueryState
        loading={assessments.isLoading}
        error={assessments.isError}
        errorDetail="Assessment records are private and could not be loaded right now."
        retry={() => queryClient.invalidateQueries({ queryKey: getListResidentAssessmentsQueryKey(residentId, { limit: 100, offset }) })}
      >
        {assessments.data?.length || offset > 0 ? (
          <div className="divide-y divide-[hsl(var(--border))]">
            {assessments.data?.map((assessment) => <AssessmentSummaryRow key={assessment.id} assessment={assessment} />)}
            {!assessments.data?.length && <div className="px-5 py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">No assessments on this page.</div>}
            <PageControls offset={offset} pageSize={100} hasMore={hasMore} onChange={setOffset} />
          </div>
        ) : (
          <div className="px-5 py-5 sm:px-6">
            <EmptyState
              title="No assessments yet"
              detail="Start a resident assessment when a new check-in or review is needed."
              action={<button data-testid="button-start-assessment-empty" type="button" onClick={() => setChooserOpen(true)} className="rounded-xl border border-[hsl(var(--primary)/.25)] bg-[hsl(var(--secondary))] px-4 py-2.5 text-xs font-extrabold text-[hsl(var(--primary))]">Choose a template</button>}
            />
          </div>
        )}
      </QueryState>
      {chooserOpen && (
        <Modal title="Choose an assessment" eyebrow="Start resident record" onClose={() => setChooserOpen(false)}>
          <div className="privacy-stripe mb-5 flex gap-3 rounded-r-xl px-4 py-3 text-xs leading-relaxed text-[hsl(var(--foreground))]">
            <ShieldCheck className="mt-0.5 shrink-0 text-[hsl(var(--primary))]" size={16} />
            <span>Only templates currently available to resident records are shown. Responses follow the sensitivity level on each template.</span>
          </div>
          <QueryState loading={templates.isLoading} error={templates.isError} errorDetail="Available templates could not be loaded." retry={() => queryClient.invalidateQueries({ queryKey: getListAssessmentTemplatesQueryKey() })}>
            {availableTemplates.length ? (
              <div className="max-h-[48vh] space-y-3 overflow-y-auto pr-1">
                {availableTemplates.map((template) => (
                  <button
                    key={template.id}
                    data-testid={`button-template-${template.id}`}
                    type="button"
                    onClick={() => setSelectedTemplate(String(template.id))}
                    className={`w-full rounded-2xl border p-4 text-left transition-colors ${selectedTemplate === String(template.id) ? 'border-[hsl(var(--primary))] bg-[hsl(169_32%_87%/.5)]' : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:border-[hsl(var(--primary)/.45)]'}`}
                  >
                    <span className="flex items-start gap-3">
                      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${selectedTemplate === String(template.id) ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'border-[hsl(var(--input))]'}`}>{selectedTemplate === String(template.id) && <Check size={13} />}</span>
                      <span className="min-w-0">
                        <span className="block text-sm font-extrabold">{template.title}</span>
                        <span className="mt-1 block text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">{template.description}</span>
                        <span className="mt-3 flex flex-wrap items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]"><span>{template.sections.length} sections</span><span className="text-[hsl(var(--border))]">/</span><span>{template.sensitivity} record</span></span>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState title="No templates available" detail="Ask an administrator to make a resident assessment template available." />
            )}
          </QueryState>
          <div className="mt-6 flex justify-end gap-3 border-t border-[hsl(var(--border))] pt-5">
            <button data-testid="button-cancel-start-assessment" type="button" onClick={() => setChooserOpen(false)} className="rounded-xl px-4 py-2.5 text-xs font-extrabold text-[hsl(var(--muted-foreground))]">Cancel</button>
            <button data-testid="button-confirm-start-assessment" type="button" disabled={!selectedTemplate || create.isPending} onClick={startAssessment} className="flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-extrabold text-[hsl(var(--primary-foreground))] disabled:cursor-not-allowed disabled:opacity-50">
              {create.isPending ? 'Starting…' : 'Start assessment'} <ChevronRight size={14} />
            </button>
          </div>
          {create.isError && <p data-testid="status-start-assessment-error" className="mt-3 text-right text-xs font-semibold text-[hsl(var(--destructive))]">We couldn't start this assessment. Try again.</p>}
        </Modal>
      )}
    </section>
  );
}

function AssessmentSummaryRow({ assessment }: { assessment: AssessmentSummary }) {
  return (
    <Link href={`/assessments/${assessment.id}`} data-testid={`link-assessment-${assessment.id}`} className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-[hsl(var(--secondary)/.5)] sm:px-6">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${assessment.status === 'submitted' ? 'bg-[hsl(169_32%_87%)] text-[hsl(var(--primary))]' : 'bg-[hsl(38_66%_88%)] text-[hsl(31_70%_34%)]'}`}>
        {assessment.status === 'submitted' ? <Check size={17} /> : <FileText size={17} />}
      </div>
      <div className="min-w-0 flex-1">
        <div data-testid={`text-assessment-title-${assessment.id}`} className="truncate text-sm font-extrabold">{assessment.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[hsl(var(--muted-foreground))]"><span>Updated {dateLabel(assessment.updatedAt)}</span><span className="text-[hsl(var(--border))]">/</span><span>Version {assessment.version}</span></div>
      </div>
      <StatusBadge status={assessment.status} />
      <ChevronRight className="shrink-0 text-[hsl(var(--muted-foreground)/.55)] transition-transform group-hover:translate-x-0.5" size={17} />
    </Link>
  );
}

export function AssessmentPage() {
  const params = useParams<{ id: string }>();
  const assessmentId = Number(params.id);
  const assessment = useGetAssessment(assessmentId, { query: { enabled: Number.isFinite(assessmentId), queryKey: getGetAssessmentQueryKey(assessmentId) } });
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [answers, setAnswers] = useState<Answers>({});
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [activeSection, setActiveSection] = useState(0);
  const initializedId = useRef<number | null>(null);
  const answersRef = useRef<Answers>({});
  const save = useUpdateAssessmentDraft();
  const submit = useSubmitAssessment();

  useEffect(() => {
    if (assessment.data && initializedId.current !== assessmentId) {
      initializedId.current = assessmentId;
      answersRef.current = assessment.data.answers ?? {};
      setAnswers(assessment.data.answers ?? {});
    }
  }, [assessment.data, assessmentId]);

  const detail = assessment.data;
  const requiredFields = useMemo(() => detail ? detail.template.sections.flatMap((section) => section.fields.filter((field) => field.required)) : [], [detail]);
  const completedRequired = requiredFields.filter((field) => detail && fieldIsAnswered(field, answers[field.id])).length;
  const progress = requiredFields.length ? Math.round((completedRequired / requiredFields.length) * 100) : 100;
  const readOnly = detail?.status === 'submitted';

  const setAnswer = (fieldId: string, value: unknown) => {
    setAnswers((current) => {
      const next = { ...current, [fieldId]: value };
      answersRef.current = next;
      return next;
    });
    setSaveState('idle');
    setValidationErrors((current) => current.filter((error) => !error.startsWith(`${fieldId}|`)));
  };

  const persist = (afterSave?: () => void) => {
    if (!detail || readOnly) return;
    setSaveState('idle');
    save.mutate({ id: detail.id, data: { answers: answersRef.current } }, {
      onSuccess: (updated) => {
        queryClient.setQueryData(getGetAssessmentQueryKey(detail.id), updated);
        queryClient.invalidateQueries({ queryKey: getListResidentAssessmentsQueryKey(detail.residentId) });
        setSaveState('saved');
        afterSave?.();
      },
      onError: () => setSaveState('error'),
    });
  };

  const validate = () => {
    if (!detail) return [];
    const errors: string[] = [];
    detail.template.sections.forEach((section) => {
      section.fields.forEach((field) => {
        const value = answersRef.current[field.id];
        if (field.required && !fieldIsAnswered(field, value)) errors.push(`${field.id}|${field.label} is required`);
        if (field.type === 'repeating_group' && Array.isArray(value)) {
          value.forEach((row, index) => {
            if (!row || typeof row !== 'object') return;
            (field.itemFields ?? []).forEach((item) => {
              if (item.required && !fieldIsAnswered(item, (row as Row)[item.id])) errors.push(`${field.id}|${field.label}, entry ${index + 1}: ${item.label} is required`);
            });
          });
        }
      });
    });
    setValidationErrors(errors);
    return errors;
  };

  const submitAssessment = (event: FormEvent) => {
    event.preventDefault();
    const errors = validate();
    if (errors.length || !detail || readOnly) return;
    submit.mutate({ id: detail.id, data: { answers: answersRef.current } }, {
      onSuccess: (updated) => {
        queryClient.setQueryData(getGetAssessmentQueryKey(detail.id), updated);
        queryClient.invalidateQueries({ queryKey: getListResidentAssessmentsQueryKey(detail.residentId) });
        setAnswers(updated.answers ?? {});
        answersRef.current = updated.answers ?? {};
      },
    });
  };

  if (!detail) {
    return (
      <AppAssessmentFrame>
        <QueryState loading={assessment.isLoading} error={assessment.isError || !Number.isFinite(assessmentId)} errorDetail="This assessment may have been removed, or your access may have changed." retry={() => queryClient.invalidateQueries({ queryKey: getGetAssessmentQueryKey(assessmentId) })}>
          <div />
        </QueryState>
      </AppAssessmentFrame>
    );
  }

  const firstValidationSection = validationErrors.length ? detail.template.sections.findIndex((section) => section.fields.some((field) => validationErrors.some((error) => error.startsWith(`${field.id}|`)))) : -1;

  return (
    <AppAssessmentFrame>
      <div className="animate-enter">
        <Link href={`/residents/${detail.residentId}`} data-testid="link-back-assessment-resident" className="mb-6 inline-flex items-center gap-2 text-xs font-extrabold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))]"><ArrowLeft size={15} /> Resident profile</Link>
        <div className="mb-6 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="section-kicker">Resident assessment</div>
            <div className="mt-2 flex flex-wrap items-center gap-3"><h1 data-testid="text-assessment-title" className="display-serif text-4xl tracking-tight">{detail.template.title}</h1><StatusBadge status={detail.status} /></div>
            <p data-testid="text-assessment-description" className="mt-2 max-w-2xl text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">{detail.template.description}</p>
          </div>
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.65)] px-4 py-3 lg:min-w-[210px]">
            <div className="flex items-center justify-between gap-4"><span className="section-kicker">Required progress</span><span data-testid="text-assessment-progress" className="mono text-xs font-medium text-[hsl(var(--primary))]">{completedRequired}/{requiredFields.length || 0}</span></div>
            <div className="assessment-progress mt-3 h-1.5 overflow-hidden rounded-full"><span style={{ width: `${progress}%` }} /></div>
            <div className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))]">{readOnly ? `Submitted ${dateLabel(detail.submittedAt)}` : saveState === 'saved' ? 'All changes saved' : 'Draft in progress'}</div>
          </div>
        </div>
        <div className="privacy-stripe mb-7 flex items-start gap-3 rounded-r-2xl px-4 py-3.5">
          <LockKeyhole className="mt-0.5 shrink-0 text-[hsl(var(--primary))]" size={16} />
          <div><div className="text-xs font-extrabold">Private resident record</div><p className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">{detail.template.sensitivity === 'restricted' ? 'Restricted responses should only be discussed with the care team members who need them.' : 'Share only with the people responsible for this resident’s care and house operations.'}</p></div>
        </div>
        {submit.isSuccess && <div data-testid="status-assessment-submitted" className="mb-5 flex items-center gap-3 rounded-2xl border border-[hsl(169_38%_68%)] bg-[hsl(169_32%_87%/.62)] px-4 py-3 text-sm font-bold text-[hsl(169_42%_27%)]"><Check size={17} /> Assessment submitted and locked for editing.</div>}
        {validationErrors.length > 0 && <div data-testid="status-assessment-validation" className="mb-5 rounded-2xl border border-[hsl(7_58%_75%)] bg-[hsl(9_63%_90%/.55)] px-4 py-3.5"><div className="text-sm font-extrabold text-[hsl(var(--destructive))]">A few required responses are missing</div><div className="mt-2 space-y-1 text-xs text-[hsl(var(--destructive))]">{validationErrors.slice(0, 3).map((error) => <div key={error}>{error.split('|')[1]}</div>)}{validationErrors.length > 3 && <div>And {validationErrors.length - 3} more. Review the highlighted fields below.</div>}</div></div>}
        {(save.isError || saveState === 'error') && <div data-testid="status-assessment-save-error" className="mb-5 rounded-2xl border border-[hsl(7_58%_75%)] bg-[hsl(9_63%_90%/.55)] px-4 py-3 text-xs font-semibold text-[hsl(var(--destructive))]">Your latest changes could not be saved. Keep this page open and try again.</div>}
        <div className="grid gap-7 lg:grid-cols-[210px_minmax(0,760px)] lg:items-start">
          <aside className="hidden lg:block lg:sticky lg:top-7">
            <div className="section-kicker mb-3">Sections</div>
            <nav className="space-y-1" aria-label="Assessment sections">
              {detail.template.sections.map((section, index) => <button key={section.id} data-testid={`button-section-${section.id}`} type="button" onClick={() => { setActiveSection(index); document.getElementById(`assessment-section-${section.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-bold transition-colors ${activeSection === index ? 'bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]' : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'}`}><span className="mono text-[10px] opacity-65">{String(index + 1).padStart(2, '0')}</span><span className="truncate">{section.title}</span></button>)}
            </nav>
            <div className="mt-6 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.52)] p-4 text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]"><div className="flex items-center gap-2 font-extrabold text-[hsl(var(--foreground))]"><Save size={13} /> Keyboard friendly</div><p className="mt-2">Press Ctrl+S or Command+S to save a draft at any time.</p></div>
          </aside>
          <form onSubmit={submitAssessment} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); persist(); } }} className="space-y-5">
            {detail.template.sections.map((section, index) => <AssessmentSection key={section.id} section={section} index={index} answers={answers} readOnly={Boolean(readOnly)} setAnswer={setAnswer} validationErrors={validationErrors} onVisible={() => setActiveSection(index)} />)}
            {firstValidationSection >= 0 && <button data-testid="button-jump-to-error" type="button" onClick={() => document.getElementById(`assessment-section-${detail.template.sections[firstValidationSection].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="text-xs font-extrabold text-[hsl(var(--primary))] underline underline-offset-4">Jump to first incomplete section</button>}
            <div className="flex flex-col-reverse gap-3 border-t border-[hsl(var(--border))] pt-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-[hsl(var(--muted-foreground))]">{readOnly ? 'This assessment is locked after submission.' : saveState === 'saved' ? 'Saved just now' : 'Your work stays a draft until submitted.'}</div>
              {!readOnly && <div className="flex flex-col gap-2 sm:flex-row"><button data-testid="button-save-assessment" type="button" disabled={save.isPending || submit.isPending} onClick={() => persist()} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 text-xs font-extrabold hover:bg-[hsl(var(--secondary))] disabled:cursor-wait disabled:opacity-60"><Save size={15} />{save.isPending ? 'Saving…' : 'Save draft'}</button><button data-testid="button-submit-assessment" type="submit" disabled={save.isPending || submit.isPending} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-5 text-xs font-extrabold text-[hsl(var(--primary-foreground))] hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-60">{submit.isPending ? 'Submitting…' : 'Submit assessment'} <ChevronRight size={15} /></button></div>}
            </div>
          </form>
        </div>
      </div>
    </AppAssessmentFrame>
  );
}

function AppAssessmentFrame({ children }: { children: ReactNode }) {
  return <AppShell><div className="assessment-surface min-h-[calc(100dvh-136px)] rounded-[1.35rem] px-4 py-6 sm:px-7 sm:py-8 lg:px-10">{children}</div></AppShell>;
}

function AssessmentSection({ section, index, answers, readOnly, setAnswer, validationErrors, onVisible }: { section: { id: string; title: string; instructions?: string | null; fields: AssessmentField[] }; index: number; answers: Answers; readOnly: boolean; setAnswer: (id: string, value: unknown) => void; validationErrors: string[]; onVisible: () => void }) {
  return (
    <section id={`assessment-section-${section.id}`} className="assessment-field paper-card overflow-hidden" data-testid={`assessment-section-${section.id}`}>
      <div className="border-b border-[hsl(var(--border))] px-5 py-5 sm:px-7">
        <div className="flex items-start gap-3"><span className="mono mt-1 text-xs font-medium text-[hsl(var(--primary))]">{String(index + 1).padStart(2, '0')}</span><div><h2 className="display-serif text-2xl">{section.title}</h2>{section.instructions && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">{section.instructions}</p>}</div></div>
      </div>
      <div className="space-y-6 px-5 py-6 sm:px-7">
        {section.fields.map((field) => <AssessmentFieldControl key={field.id} field={field} value={answerForField(field, answers)} readOnly={readOnly} setAnswer={setAnswer} hasError={validationErrors.some((error) => error.startsWith(`${field.id}|`))} />)}
      </div>
      <span className="sr-only" onFocus={onVisible}>Section {index + 1}</span>
    </section>
  );
}

function AssessmentFieldControl({ field, value, readOnly, setAnswer, hasError, testIdPrefix = '' }: { field: AssessmentField; value: unknown; readOnly: boolean; setAnswer: (id: string, value: unknown) => void; hasError: boolean; testIdPrefix?: string }) {
  const inputClass = `mt-2 w-full rounded-xl border bg-[hsl(42_37%_97%)] px-3 text-sm outline-none transition-shadow focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--ring)/.15)] disabled:cursor-default disabled:opacity-75 ${hasError ? 'border-[hsl(var(--destructive))]' : 'border-[hsl(var(--input))]'}`;
  const set = (next: unknown) => setAnswer(field.id, next);
  return (
    <div className={`rounded-2xl border p-4 sm:p-5 ${hasError ? 'border-[hsl(var(--destructive)/.55)] bg-[hsl(9_63%_90%/.16)]' : 'border-[hsl(var(--border)/.75)] bg-[hsl(var(--card)/.46)]'}`} data-testid={`field-${testIdPrefix}${field.id}`}>
      <div className="flex items-start justify-between gap-4">
        <div><label className="text-sm font-extrabold">{field.label}{field.required && <span className="ml-1 text-[hsl(var(--accent))]">*</span>}</label>{field.helpText && <p className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">{field.helpText}</p>}</div>
        {field.sensitive && <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-extrabold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]" title="Sensitive response"><LockKeyhole size={12} /> Sensitive</span>}
      </div>
      {field.type === 'short_text' && <input data-testid={`input-assessment-${testIdPrefix}${field.id}`} aria-label={field.label} className={`${inputClass} h-11`} value={String(value ?? '')} onChange={(event) => set(event.target.value)} disabled={readOnly} />}
      {field.type === 'long_text' && <textarea data-testid={`input-assessment-${testIdPrefix}${field.id}`} aria-label={field.label} className={`${inputClass} min-h-[108px] resize-y py-3 leading-relaxed`} value={String(value ?? '')} onChange={(event) => set(event.target.value)} disabled={readOnly} />}
      {field.type === 'date' && <input data-testid={`input-assessment-${testIdPrefix}${field.id}`} aria-label={field.label} type="date" className={`${inputClass} h-11`} value={String(value ?? '')} onChange={(event) => set(event.target.value)} disabled={readOnly} />}
      {field.type === 'select' && <select data-testid={`select-assessment-${testIdPrefix}${field.id}`} aria-label={field.label} className={`${inputClass} h-11`} value={String(value ?? '')} onChange={(event) => set(event.target.value)} disabled={readOnly}><option value="">Choose one</option>{(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}</select>}
      {field.type === 'yes_no' && <div className="mt-3 grid max-w-sm grid-cols-2 gap-2">{['yes', 'no'].map((option) => <button key={option} data-testid={`button-${testIdPrefix}${field.id}-${option}`} type="button" aria-pressed={value === option} disabled={readOnly} onClick={() => set(option)} className={`h-11 rounded-xl border text-xs font-extrabold capitalize transition-colors disabled:cursor-default ${value === option ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'border-[hsl(var(--input))] bg-[hsl(var(--card))] hover:border-[hsl(var(--primary)/.5)]'}`}>{option}</button>)}</div>}
      {field.type === 'checklist' && <div className="mt-3 space-y-2">{(field.options ?? []).map((option) => { const selected = Array.isArray(value) && value.includes(option); return <label key={option} className={`flex items-center gap-3 rounded-xl border px-3 py-3 text-sm ${selected ? 'border-[hsl(var(--primary)/.38)] bg-[hsl(169_32%_87%/.35)]' : 'border-[hsl(var(--border))] bg-[hsl(var(--card)/.5)]'}`}><input data-testid={`input-${testIdPrefix}${field.id}-${option.replace(/\s+/g, '-').toLowerCase()}`} type="checkbox" checked={selected} disabled={readOnly} onChange={() => set(Array.isArray(value) && value.includes(option) ? value.filter((item) => item !== option) : [...(Array.isArray(value) ? value : []), option])} className="h-4 w-4 accent-[hsl(var(--primary))]" /><span>{option}</span></label>; })}</div>}
      {field.type === 'acknowledgment' && <div className="mt-4"><input data-testid={`input-assessment-${testIdPrefix}${field.id}`} type="text" aria-label={`${field.label} typed acknowledgment`} className={`${inputClass} h-11`} placeholder="Type your full name" value={String(value ?? '')} onChange={(event) => set(event.target.value)} disabled={readOnly} /><p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">Typing your name confirms this acknowledgment.</p></div>}
      {field.type === 'repeating_group' && <RepeatingGroup field={field} value={value} readOnly={readOnly} set={set} />}
      {hasError && <p data-testid={`error-assessment-${field.id}`} className="mt-2 text-xs font-bold text-[hsl(var(--destructive))]">This response is required.</p>}
    </div>
  );
}

function RepeatingGroup({ field, value, readOnly, set }: { field: AssessmentField; value: unknown; readOnly: boolean; set: (value: unknown) => void }) {
  const rows = Array.isArray(value) ? value as Row[] : [];
  const itemFields = field.itemFields ?? [];
  const addRow = () => set([...rows, Object.fromEntries(itemFields.map((item) => [item.id, item.type === 'checklist' || item.type === 'repeating_group' ? [] : '']))]);
  const updateRow = (rowIndex: number, itemId: string, next: unknown) => set(rows.map((row, index) => index === rowIndex ? { ...row, [itemId]: next } : row));
  return <div className="mt-3 space-y-3">{rows.map((row, rowIndex) => <div key={rowIndex} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.62)] p-3"><div className="mb-3 flex items-center justify-between"><span className="mono text-[10px] uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">Entry {rowIndex + 1}</span>{!readOnly && <button data-testid={`button-remove-${field.id}-${rowIndex}`} type="button" onClick={() => set(rows.filter((_, index) => index !== rowIndex))} className="inline-flex items-center gap-1 text-[11px] font-bold text-[hsl(var(--destructive))]"><Trash2 size={13} /> Remove</button>}</div><div className="grid gap-4 sm:grid-cols-2">{itemFields.map((item) => <AssessmentFieldControl key={item.id} field={item} value={row[item.id]} readOnly={readOnly} setAnswer={(_, next) => updateRow(rowIndex, item.id, next)} hasError={false} testIdPrefix={`${field.id}-${rowIndex}-`} />)}</div></div>)}{!readOnly && <button data-testid={`button-add-${field.id}`} type="button" onClick={addRow} className="inline-flex items-center gap-2 rounded-xl border border-dashed border-[hsl(var(--primary)/.38)] px-3 py-2.5 text-xs font-extrabold text-[hsl(var(--primary))] hover:bg-[hsl(var(--secondary))]"><Plus size={14} /> Add entry</button>}{!rows.length && readOnly && <p className="text-xs text-[hsl(var(--muted-foreground))]">No entries recorded.</p>}</div>;
}