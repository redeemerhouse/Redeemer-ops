import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, max } from "drizzle-orm";
import {
  assessmentSubmissionsTable,
  assessmentTemplatesTable,
  auditEventsTable,
  db,
  residentsTable,
  type AssessmentTemplate,
} from "@workspace/db";
import {
  CreateResidentAssessmentBody,
  CreateResidentAssessmentResponse,
  CreateAssessmentRevisionBody,
  CreateAssessmentRevisionResponse,
  GetAssessmentTemplateParams,
  GetAssessmentTemplateResponse,
  PublishAssessmentTemplateParams,
  PublishAssessmentTemplateResponse,
  RetireAssessmentTemplateParams,
  RetireAssessmentTemplateResponse,
  GetAssessmentParams,
  GetAssessmentResponse,
  ListAssessmentTemplatesResponse,
  ListResidentAssessmentsParams,
  ListResidentAssessmentsResponse,
  SubmitAssessmentBody,
  SubmitAssessmentParams,
  SubmitAssessmentResponse,
  UpdateAssessmentDraftBody,
  UpdateAssessmentDraftParams,
  UpdateAssessmentDraftResponse,
} from "@workspace/api-zod";
import { canAccessResident, getPrincipal, isAdministrator, requirePermission, type Principal } from "../middlewares/auth";
import { problem } from "../middlewares/errors";

const router: IRouter = Router();

type FormField = {
  id: string;
  label: string;
  type: string;
  required: boolean;
  sensitive: boolean;
  helpText?: string | null;
  options?: string[];
  itemFields?: FormField[];
};
type FormSection = { id: string; title: string; instructions?: string | null; fields: FormField[] };
type FormSchema = FormSection[];

const actor = (req: Request): string => {
  const value = req.res?.locals.actorId;
  const principal = req.res?.locals.principal as Principal | undefined;
  if (typeof value === "string" && /^[a-zA-Z0-9._:@-]{1,128}$/.test(value)) return value;
  return principal?.sub && /^[a-zA-Z0-9._:@-]{1,128}$/.test(principal.sub) ? principal.sub : "unattributed";
};

const audit = async (req: Request, action: string, entityId?: number, metadata?: Record<string, string | number | boolean | null>) => {
  const retentionUntil = new Date();
  retentionUntil.setUTCFullYear(retentionUntil.getUTCFullYear() + 7);
  await db.insert(auditEventsTable).values({
    action,
    entityType: "assessment",
    entityId,
    actor: actor(req),
    metadata: {
      correlationId: req.res?.locals.correlationId ?? "unknown",
      retentionUntil: retentionUntil.toISOString(),
      ...metadata,
    },
  });
};

const schemaFor = (template: AssessmentTemplate): FormSchema =>
  Array.isArray(template.schema) ? template.schema as FormSchema : [];

const asTemplate = (template: AssessmentTemplate) => ({
  id: template.id,
  slug: template.slug,
  title: template.title,
  description: template.description,
  category: template.category,
  audience: template.audience,
  sensitivity: template.sensitivity,
  version: template.version,
  status: template.status,
  sections: schemaFor(template),
});

const templateForSubmission = (submission: typeof assessmentSubmissionsTable.$inferSelect, current: AssessmentTemplate) => {
  const snapshot = submission.templateSnapshot;
  if (submission.status === "submitted" && snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
    const saved = snapshot as Record<string, unknown>;
    if (
      typeof saved.id === "number" &&
      typeof saved.slug === "string" &&
      typeof saved.title === "string" &&
      typeof saved.description === "string" &&
      Array.isArray(saved.sections)
    ) {
      return saved;
    }
  }
  return asTemplate(current);
};

const asSummary = (submission: typeof assessmentSubmissionsTable.$inferSelect, template: AssessmentTemplate) => ({
  id: submission.id,
  residentId: submission.residentId!,
  templateId: submission.templateId,
  title: template.title,
  category: template.category,
  status: submission.status,
  version: templateForSubmission(submission, template).version,
  assignedBy: submission.assignedBy,
  assignedAt: submission.assignedAt,
  createdAt: submission.createdAt,
  updatedAt: submission.updatedAt,
  submittedBy: submission.submittedBy,
  submittedAt: submission.submittedAt,
});

const asDetail = (submission: typeof assessmentSubmissionsTable.$inferSelect, template: AssessmentTemplate) => ({
  id: submission.id,
  residentId: submission.residentId!,
  status: submission.status,
  answers: submission.answers as Record<string, unknown>,
  template: templateForSubmission(submission, template),
  assignedBy: submission.assignedBy,
  assignedAt: submission.assignedAt,
  createdAt: submission.createdAt,
  updatedAt: submission.updatedAt,
  submittedBy: submission.submittedBy,
  submittedAt: submission.submittedAt,
});

const getResident = async (id: number) => {
  const [resident] = await db.select({
    id: residentsTable.id,
    home: residentsTable.home,
  }).from(residentsTable).where(eq(residentsTable.id, id));
  return resident;
};

const getTemplate = async (id: number) => {
  const [template] = await db.select().from(assessmentTemplatesTable).where(eq(assessmentTemplatesTable.id, id));
  return template;
};

const canRead = (principal: Principal, resident: { id: number; home: string }, template: AssessmentTemplate) =>
  canAccessResident(principal, resident) && (principal.role !== "resident" || template.audience === "resident");

const canWrite = (principal: Principal, resident: { id: number; home: string }, template: AssessmentTemplate) =>
  canAccessResident(principal, resident, principal.role !== "resident") &&
  (principal.role !== "resident" || template.audience === "resident");

const missingRequired = (schema: FormSchema, answers: Record<string, unknown>): string[] => {
  const missing: string[] = [];
  const visit = (field: FormField, value: unknown, prefix = "") => {
    const label = prefix ? `${prefix}: ${field.label}` : field.label;
    const empty = value === undefined || value === null || value === "" ||
      (Array.isArray(value) && value.length === 0);
    if (field.required && empty) missing.push(label);
    if (field.type === "repeating_group" && Array.isArray(value)) {
      value.forEach((row, index) => {
        if (row && typeof row === "object") {
          for (const child of field.itemFields ?? []) visit(child, (row as Record<string, unknown>)[child.id], `${field.label} ${index + 1}`);
        }
      });
    }
  };
  for (const section of schema) {
    for (const field of section.fields) visit(field, answers[field.id]);
  }
  return missing;
};

const loadSubmission = async (id: number) => {
  const [row] = await db.select().from(assessmentSubmissionsTable).where(eq(assessmentSubmissionsTable.id, id));
  if (!row) return null;
  const template = await getTemplate(row.templateId);
  return template ? { row, template } : null;
};

router.get("/assessment-templates", async (req, res): Promise<void> => {
  const principal = getPrincipal(res);
  const rows = await db.select().from(assessmentTemplatesTable)
    .where(isAdministrator(principal) ? undefined : eq(assessmentTemplatesTable.status, "active"))
    .orderBy(asc(assessmentTemplatesTable.title), desc(assessmentTemplatesTable.version));
  const visible = rows.filter((template) => principal.role !== "resident" || template.audience === "resident");
  res.json(ListAssessmentTemplatesResponse.parse(visible.map(asTemplate)));
  await audit(req, "Assessment templates viewed", undefined, { count: visible.length });
});

router.get("/assessment-templates/:id", async (req, res): Promise<void> => {
  const parsed = GetAssessmentTemplateParams.safeParse(req.params);
  if (!parsed.success) { problem(req, res, 400); return; }
  const principal = getPrincipal(res);
  const template = await getTemplate(parsed.data.id);
  if (!template || (!isAdministrator(principal) && (template.status !== "active" || (principal.role === "resident" && template.audience !== "resident")))) {
    problem(req, res, 404);
    return;
  }
  res.json(GetAssessmentTemplateResponse.parse(asTemplate(template)));
  await audit(req, "Assessment template previewed", template.id, { templateId: template.id, version: template.version, status: template.status });
});

router.post("/assessment-templates/:id/revisions", requirePermission("assessment:manage"), async (req, res): Promise<void> => {
  const parsedParams = GetAssessmentTemplateParams.safeParse(req.params);
  const parsedBody = CreateAssessmentRevisionBody.strict().safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) { problem(req, res, 400); return; }
  const principal = getPrincipal(res);
  const source = await getTemplate(parsedParams.data.id);
  if (!source) { problem(req, res, 404); return; }
  const [{ highestVersion }] = await db.select({ highestVersion: max(assessmentTemplatesTable.version) })
    .from(assessmentTemplatesTable).where(eq(assessmentTemplatesTable.slug, source.slug));
  const version = Number(highestVersion ?? source.version) + 1;
  const now = new Date();
  const [created] = await db.insert(assessmentTemplatesTable).values({
    slug: source.slug,
    title: parsedBody.data.title,
    description: parsedBody.data.description,
    category: source.category,
    audience: source.audience,
    sensitivity: source.sensitivity,
    version,
    status: "draft",
    schema: parsedBody.data.schema,
    createdAt: now,
    updatedAt: now,
  }).returning();
  await audit(req, "Assessment revision created", created.id, {
    templateId: source.id,
    revisionId: created.id,
    version,
    basedOnVersion: source.version,
    status: "draft",
  });
  res.status(201).json(CreateAssessmentRevisionResponse.parse(asTemplate(created)));
});

router.post("/assessment-templates/:id/publish", requirePermission("assessment:manage"), async (req, res): Promise<void> => {
  const parsed = PublishAssessmentTemplateParams.safeParse(req.params);
  if (!parsed.success) { problem(req, res, 400); return; }
  const principal = getPrincipal(res);
  const template = await getTemplate(parsed.data.id);
  if (!template) { problem(req, res, 404); return; }
  if (template.status !== "draft") {
    res.status(400).json({ error: "Only draft assessment revisions can be published." });
    return;
  }
  const now = new Date();
  const activeVersions = await db.select({ id: assessmentTemplatesTable.id, version: assessmentTemplatesTable.version })
    .from(assessmentTemplatesTable)
    .where(and(eq(assessmentTemplatesTable.slug, template.slug), eq(assessmentTemplatesTable.status, "active")));
  const published = await db.transaction(async (tx) => {
    await tx.update(assessmentTemplatesTable).set({ status: "retired", updatedAt: now })
      .where(and(eq(assessmentTemplatesTable.slug, template.slug), eq(assessmentTemplatesTable.status, "active")));
    const [updated] = await tx.update(assessmentTemplatesTable)
      .set({ status: "active", updatedAt: now })
      .where(and(eq(assessmentTemplatesTable.id, template.id), eq(assessmentTemplatesTable.status, "draft")))
      .returning();
    return updated;
  });
  if (!published) { res.status(409).json({ error: "This assessment revision changed before it could be published." }); return; }
  await audit(req, "Assessment revision published", published.id, {
    templateId: published.id,
    version: published.version,
    status: "active",
  });
  for (const previous of activeVersions) {
    await audit(req, "Assessment revision retired", previous.id, {
      templateId: previous.id,
      version: previous.version,
      reason: "Replaced by published revision",
      replacedBy: published.id,
      status: "retired",
    });
  }
  res.json(PublishAssessmentTemplateResponse.parse(asTemplate(published)));
});

router.post("/assessment-templates/:id/retire", requirePermission("assessment:manage"), async (req, res): Promise<void> => {
  const parsed = RetireAssessmentTemplateParams.safeParse(req.params);
  if (!parsed.success) { problem(req, res, 400); return; }
  const principal = getPrincipal(res);
  const template = await getTemplate(parsed.data.id);
  if (!template) { problem(req, res, 404); return; }
  if (template.status === "retired") {
    res.status(400).json({ error: "This assessment revision is already retired." });
    return;
  }
  const [retired] = await db.update(assessmentTemplatesTable).set({ status: "retired", updatedAt: new Date() })
    .where(and(eq(assessmentTemplatesTable.id, template.id), eq(assessmentTemplatesTable.status, template.status)))
    .returning();
  if (!retired) { res.status(409).json({ error: "This assessment revision changed before it could be retired." }); return; }
  await audit(req, "Assessment revision retired", retired.id, {
    templateId: retired.id,
    version: retired.version,
    previousStatus: template.status,
    status: "retired",
  });
  res.json(RetireAssessmentTemplateResponse.parse(asTemplate(retired)));
});

router.get("/residents/:id/assessments", async (req, res): Promise<void> => {
  const parsed = ListResidentAssessmentsParams.safeParse(req.params);
  if (!parsed.success) { problem(req, res, 400); return; }
  const principal = getPrincipal(res);
  const resident = await getResident(parsed.data.id);
  if (!resident) { problem(req, res, 404); return; }
  const templates = await db.select().from(assessmentTemplatesTable);
  if (!canAccessResident(principal, resident)) { problem(req, res, 403); return; }
  const rows = await db.select().from(assessmentSubmissionsTable)
    .where(eq(assessmentSubmissionsTable.residentId, resident.id))
    .orderBy(asc(assessmentSubmissionsTable.createdAt));
  const byId = new Map(templates.map((template) => [template.id, template]));
  const visible = rows
    .map((row) => ({ row, template: byId.get(row.templateId) }))
    .filter((item): item is { row: typeof rows[number]; template: AssessmentTemplate } =>
      Boolean(item.template && canRead(principal, resident, item.template)))
    .map(({ row, template }) => asSummary(row, template));
  res.json(ListResidentAssessmentsResponse.parse(visible));
  await audit(req, "Resident assessments viewed", undefined, { residentId: resident.id, count: visible.length });
});

router.post("/residents/:id/assessments", async (req, res): Promise<void> => {
  const parsedParams = GetAssessmentParams.safeParse(req.params);
  const parsedBody = CreateResidentAssessmentBody.strict().safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) { problem(req, res, 400); return; }
  const principal = getPrincipal(res);
  const resident = await getResident(parsedParams.data.id);
  const template = await getTemplate(parsedBody.data.templateId);
  if (!resident || !template || template.status !== "active") { problem(req, res, 404); return; }
  if (!canWrite(principal, resident, template)) { problem(req, res, 403); return; }
  const now = new Date();
  const [created] = await db.insert(assessmentSubmissionsTable).values({
    templateId: template.id,
    residentId: resident.id,
    status: "draft",
    answers: {},
    assignedBy: principal.role === "resident" ? null : actor(req),
    assignedAt: principal.role === "resident" ? null : now,
    createdBy: actor(req),
  }).returning();
  const detail = asDetail(created, template);
  await audit(req, principal.role === "resident" ? "Assessment started" : "Assessment assigned", created.id, { residentId: resident.id, templateId: template.id, version: template.version });
  res.status(201).json(CreateResidentAssessmentResponse.parse(detail));
});

router.get("/assessments/:id", async (req, res): Promise<void> => {
  const parsed = GetAssessmentParams.safeParse(req.params);
  if (!parsed.success) { problem(req, res, 400); return; }
  const principal = getPrincipal(res);
  const loaded = await loadSubmission(parsed.data.id);
  if (!loaded) { problem(req, res, 404); return; }
  const resident = loaded.row.residentId ? await getResident(loaded.row.residentId) : null;
  if (!resident || !canRead(principal, resident, loaded.template)) { problem(req, res, 403); return; }
  const detail = asDetail(loaded.row, loaded.template);
  res.json(GetAssessmentResponse.parse(detail));
  await audit(req, "Assessment viewed", loaded.row.id, { residentId: resident.id, templateId: loaded.template.id });
});

const updateAnswers = async (req: Request, res: Response, submit: boolean): Promise<void> => {
  const parsedParams = (submit ? SubmitAssessmentParams : UpdateAssessmentDraftParams).safeParse(req.params);
  const parsedBody = (submit ? SubmitAssessmentBody : UpdateAssessmentDraftBody).strict().safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) { problem(req, res, 400); return; }
  const principal = getPrincipal(res);
  const loaded = await loadSubmission(parsedParams.data.id);
  if (!loaded) { problem(req, res, 404); return; }
  const resident = loaded.row.residentId ? await getResident(loaded.row.residentId) : null;
  if (!resident || !canWrite(principal, resident, loaded.template)) { problem(req, res, 403); return; }
  if (loaded.row.status !== "draft") { res.status(400).json({ error: "Submitted assessments cannot be edited." }); return; }
  const answers = parsedBody.data.answers as Record<string, unknown>;
  if (submit) {
    const missing = missingRequired(schemaFor(loaded.template), answers);
    if (missing.length) {
      res.status(400).json({ error: "Complete the required fields before submitting.", missing });
      return;
    }
  }
  const now = new Date();
  const [updated] = await db.update(assessmentSubmissionsTable).set({
    answers,
    status: submit ? "submitted" : "draft",
    ...(submit ? { templateSnapshot: asTemplate(loaded.template), submittedBy: actor(req), submittedAt: now } : {}),
    updatedAt: now,
  }).where(eq(assessmentSubmissionsTable.id, loaded.row.id)).returning();
  const detail = asDetail(updated, loaded.template);
  if (submit) {
    await audit(req, "Assessment submitted", updated.id, { residentId: resident.id, templateId: loaded.template.id, version: loaded.template.version });
    res.json(SubmitAssessmentResponse.parse(detail));
  } else {
    await audit(req, "Assessment draft saved", updated.id, { residentId: resident.id, templateId: loaded.template.id });
    res.json(UpdateAssessmentDraftResponse.parse(detail));
  }
};

router.patch("/assessments/:id", (req, res) => updateAnswers(req, res, false));
router.post("/assessments/:id/submit", (req, res) => updateAnswers(req, res, true));

export default router;