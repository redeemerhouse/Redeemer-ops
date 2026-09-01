import { Router, type IRouter } from "express";
import * as XLSX from "xlsx";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  housesTable,
  residentsTable,
  residentImportBatchesTable,
  residentImportRowsTable,
  auditEventsTable,
} from "@workspace/db";
import {
  authorize,
  getPrincipal,
  hasHouseScope,
  type Principal,
} from "../middlewares/auth";
import { problem } from "../middlewares/errors";

const router: IRouter = Router();

const columns = [
  "name",
  "email",
  "phone",
  "home",
  "moveInDate",
  "status",
  "balance",
  "nextPaymentDate",
  "familyStatus",
  "lifecycleState",
  "notes",
] as const;
type ImportColumn = typeof columns[number];
type SourceRow = Record<string, string>;
type NormalizedRow = {
  name: string;
  email: string;
  phone: string;
  home: string;
  moveInDate: string;
  status: "active" | "pending" | "exited";
  balance: string;
  nextPaymentDate: string;
  familyStatus: "individual" | "family";
  lifecycleState: string;
  notes: string | null;
};

const requiredColumns: ImportColumn[] = ["name", "email", "phone", "home", "moveInDate", "status"];
const identityRule = "Existing matches use normalized email. Matching rows are skipped and never overwrite protected fields.";
const MAX_IMPORT_BYTES = 700_000;

const trim = (value: unknown): string => String(value ?? "").trim();
const normalized = (value: string): string => value.trim().toLocaleLowerCase();
const isCalendarDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
};
const isMoney = (value: string): boolean => /^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(value);
const formulaLike = (value: string): boolean => /^[=+@-]/.test(value);

function parseCsv(text: string): { rows?: SourceRow[]; error?: string } {
  const source = text.replace(/^\uFEFF/, "");
  const parsed: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (character === '"') {
      if (quoted && next === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim() !== "")) parsed.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) return { error: "The CSV contains an unclosed quoted cell." };
  if (cell || row.length) {
    row.push(cell);
    if (row.some((value) => value.trim() !== "")) parsed.push(row);
  }
  if (parsed[0]?.length === 1 && parsed[0][0].trim().startsWith("#")) parsed.shift();
  if (!parsed.length) return { error: "The file is empty. Add one client per row below the header." };
  return rowsFromMatrix(parsed);
}

function rowsFromMatrix(matrix: unknown[][]): { rows?: SourceRow[]; error?: string } {
  const headerValues = matrix[0].map(trim);
  const headerKeys = headerValues.map((header) => columns.find((column) => column.toLowerCase() === header.toLowerCase()) ?? header.toLowerCase()) as string[];
  const supported = new Set(columns);
  const unknown = headerKeys.filter((header) => !supported.has(header as ImportColumn));
  const duplicates = headerKeys.filter((header, index) => header && headerKeys.indexOf(header) !== index);
  const missing = requiredColumns.filter((column) => !headerKeys.includes(column));
  if (unknown.length) return { error: `Unsupported column(s): ${[...new Set(unknown)].join(", ")}. Remove sensitive or unrelated fields; supported columns are ${columns.join(", ")}.` };
  if (duplicates.length) return { error: `Duplicate column(s): ${[...new Set(duplicates)].join(", ")}. Keep one column per supported field.` };
  if (missing.length) return { error: `Missing required column(s): ${missing.join(", ")}.` };
  const rows: SourceRow[] = [];
  for (const values of matrix.slice(1)) {
    const sourceRow: SourceRow = {};
    headerKeys.forEach((key, index) => {
      if (supported.has(key as ImportColumn)) sourceRow[key] = trim(values[index]);
    });
    if (Object.values(sourceRow).some((value) => formulaLike(value))) {
      sourceRow.__formula = "A formula-like value was rejected. Enter a plain value, not a spreadsheet formula.";
    }
    rows.push(sourceRow);
  }
  return { rows };
}

function parseXlsx(buffer: Buffer): { rows?: SourceRow[]; error?: string } {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer", cellFormula: true, cellNF: false, cellStyles: false, bookVBA: false, WTF: false });
    if ((workbook as unknown as { vbaraw?: unknown }).vbaraw) return { error: "Macro-enabled workbooks are not supported. Save a clean .xlsx workbook without macros." };
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return { error: "The workbook has no worksheets." };
    const sheet = workbook.Sheets[sheetName] as Record<string, { f?: string; v?: unknown; t?: string }>;
    if (Object.values(sheet).some((cell) => cell && typeof cell === "object" && typeof cell.f === "string")) {
      return { error: "Formulas are not accepted. Replace formula cells with their displayed values and upload again." };
    }
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true }) as unknown[][];
    const headerKeys = (matrix[0] ?? []).map(trim).map((value) => value.toLowerCase());
    const dateIndexes = new Set(["moveindate", "nextpaymentdate"].map((name) => headerKeys.indexOf(name)).filter((index) => index >= 0));
    const normalizedMatrix = matrix.map((values, rowIndex) => values.map((value, columnIndex) => {
      if (rowIndex === 0 || !dateIndexes.has(columnIndex) || typeof value !== "number") return value;
      const dateCode = XLSX.SSF.parse_date_code(value);
      return dateCode ? `${String(dateCode.y).padStart(4, "0")}-${String(dateCode.m).padStart(2, "0")}-${String(dateCode.d).padStart(2, "0")}` : value;
    }));
    return rowsFromMatrix(normalizedMatrix);
  } catch {
    return { error: "The workbook could not be read. Upload a valid .xlsx or .xls file with one client per row." };
  }
}

function validateRows(sourceRows: SourceRow[], houses: { name: string }[], residents: { id: number; name: string; email: string; phone: string }[]) {
  const houseNames = new Set(houses.map((house) => normalized(house.name)));
  const existingEmails = new Map(residents.map((resident) => [normalized(resident.email), resident]));
  const existingNamePhones = new Map(residents.map((resident) => [`${normalized(resident.name)}|${normalized(resident.phone)}`, resident]));
  const seen = new Set<string>();
  return sourceRows.map((source, index) => {
    const errors: string[] = [];
    const value = (column: ImportColumn) => trim(source[column]);
    if (source.__formula) errors.push(source.__formula);
    for (const column of requiredColumns) if (!value(column)) errors.push(`${column} is required.`);
    if (value("email") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value("email"))) errors.push("email must be a valid email address.");
    if (value("moveInDate") && !isCalendarDate(value("moveInDate"))) errors.push("moveInDate must use YYYY-MM-DD and be a real calendar date.");
    if (value("nextPaymentDate") && !isCalendarDate(value("nextPaymentDate"))) errors.push("nextPaymentDate must use YYYY-MM-DD and be a real calendar date.");
    if (value("status") && !["active", "pending", "exited"].includes(value("status"))) errors.push("status must be active, pending, or exited.");
    if (value("balance") && !isMoney(value("balance"))) errors.push("balance must be a non-negative amount with up to two decimals.");
    if (value("familyStatus") && !["individual", "family"].includes(value("familyStatus"))) errors.push("familyStatus must be individual or family.");
    if (value("home") && !houseNames.has(normalized(value("home")))) errors.push(`Unknown house "${value("home")}". Choose a configured house.`);
    const emailKey = normalized(value("email"));
    const namePhoneKey = `${normalized(value("name"))}|${normalized(value("phone"))}`;
    const identityKey = emailKey || namePhoneKey;
    if (identityKey && seen.has(identityKey)) errors.push("Duplicate match: another row in this file has the same identity.");
    seen.add(identityKey);
    const existing = existingEmails.get(emailKey) ?? existingNamePhones.get(namePhoneKey);
    if (existing) errors.push(`Duplicate match: this row matches existing resident #${existing.id} (${existing.name}). Existing protected fields will not be replaced.`);
    const normalizedRow: NormalizedRow = {
      name: value("name"),
      email: value("email"),
      phone: value("phone"),
      home: houses.find((house) => normalized(house.name) === normalized(value("home")))?.name ?? value("home"),
      moveInDate: value("moveInDate"),
      status: value("status") as NormalizedRow["status"],
      balance: value("balance") || "0",
      nextPaymentDate: value("nextPaymentDate") || value("moveInDate"),
      familyStatus: (value("familyStatus") || "individual") as NormalizedRow["familyStatus"],
      lifecycleState: value("lifecycleState") || "applicant",
      notes: value("notes") || null,
    };
    return { rowNumber: index + 2, sourceData: source, normalizedData: normalizedRow, errors, valid: errors.length === 0 };
  });
}

function canUseImport(principal: Principal): boolean {
  return authorize(principal, "resident:import");
}

router.get("/residents/import/template", async (req, res): Promise<void> => {
  const principal = getPrincipal(res);
  if (!canUseImport(principal)) { problem(req, res, 403); return; }
  const format = req.query.format === "xlsx" ? "xlsx" : req.query.format === "csv" ? "csv" : null;
  if (!format) { problem(req, res, 400); return; }
  const header = columns.join(",");
  const example = "Example Resident,example@example.com,(555) 555-0100,Northside House,2026-01-15,active,175.00,2026-01-22,individual,applicant,Optional staff note";
  const instructions = "Required: name,email,phone,home,moveInDate,status. Optional: balance,nextPaymentDate,familyStatus,lifecycleState,notes. Dates: YYYY-MM-DD. Status: active|pending|exited. Money: non-negative, up to 2 decimals. Identity matching: normalized email, or name + phone.";
  if (format === "csv") {
    res.setHeader("Content-Disposition", 'attachment; filename="resident-import-template.csv"');
    res.type("text/csv").send(`# ${instructions}\r\n${header}\r\n${example}\r\n`);
    return;
  }
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([Array.from(columns), example.split(",")]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Residents");
  const output = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Disposition", 'attachment; filename="resident-import-template.xlsx"');
  res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(output);
});

router.post("/residents/import/preview", async (req, res): Promise<void> => {
  const principal = getPrincipal(res);
  if (!canUseImport(principal)) { problem(req, res, 403); return; }
  const filename = trim(req.body?.filename);
  const encoded = trim(req.body?.contentBase64);
  if (!filename || !encoded || encoded.length > MAX_IMPORT_BYTES * 2 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) { res.status(400).json({ error: "Provide a filename and an upload smaller than 700 KB.", correlationId: res.locals.correlationId }); return; }
  const extension = filename.toLowerCase().split(".").pop();
  if (!["csv", "xlsx", "xls"].includes(extension ?? "") || extension === "xlsm" || extension === "xlsb") { res.status(400).json({ error: "Only .csv, .xlsx, and .xls files are supported. Macro-enabled files and arbitrary columns are rejected.", correlationId: res.locals.correlationId }); return; }
  let buffer: Buffer;
  try { buffer = Buffer.from(encoded, "base64"); } catch { res.status(400).json({ error: "The upload encoding is invalid.", correlationId: res.locals.correlationId }); return; }
  if (!buffer.length || buffer.length > MAX_IMPORT_BYTES) { res.status(400).json({ error: "Provide a non-empty upload smaller than 700 KB.", correlationId: res.locals.correlationId }); return; }
  const parsed = extension === "csv" ? parseCsv(buffer.toString("utf8")) : parseXlsx(buffer);
  if (!parsed.rows) { res.status(400).json({ error: parsed.error ?? "The file could not be parsed.", correlationId: res.locals.correlationId }); return; }
  const [houses, residents] = await Promise.all([
    db.select({ name: housesTable.name }).from(housesTable),
    db.select({ id: residentsTable.id, name: residentsTable.name, email: residentsTable.email, phone: residentsTable.phone }).from(residentsTable),
  ]);
  const rows = validateRows(parsed.rows, houses, residents);

  const batch = await db.transaction(async (tx) => {
    const [created] = await tx.insert(residentImportBatchesTable).values({ sourceFilename: filename.slice(0, 255), actor: res.locals.actorId ?? principal.sub, totalRows: rows.length, validRows: rows.filter((row) => row.valid).length }).returning();
    await tx.insert(residentImportRowsTable).values(rows.map((row) => ({ batchId: created.id, rowNumber: row.rowNumber, sourceData: row.sourceData, normalizedData: row.normalizedData, outcome: row.valid ? "ready" : "failed", errors: row.errors })));
    await tx.insert(auditEventsTable).values({ action: "Resident import previewed", entityType: "resident_import", entityId: created.id, actor: res.locals.actorId ?? principal.sub, metadata: { sourceFilename: created.sourceFilename, totalRows: rows.length, validRows: rows.filter((row) => row.valid).length, failedRows: rows.filter((row) => !row.valid).length, identityRule } });
    return created;
  });
  res.status(201).json({
    batchId: batch.id,
    sourceFilename: batch.sourceFilename,
    identityRule,
    columns,
    rows: rows.map(({ rowNumber, sourceData, normalizedData, errors, valid }) => ({ rowNumber, sourceData, normalizedData, errors, valid })),
    summary: { total: rows.length, valid: rows.filter((row) => row.valid).length, failed: rows.filter((row) => !row.valid).length },
  });
});

router.post("/residents/import/:batchId/confirm", async (req, res): Promise<void> => {
  const principal = getPrincipal(res);
  if (!canUseImport(principal)) { problem(req, res, 403); return; }
  const batchId = Number(req.params.batchId);

  const requestedRowNumbers = Array.isArray(req.body?.approvedRowNumbers) ? req.body.approvedRowNumbers : [];
  const approvedRowNumbers = requestedRowNumbers.filter((value: unknown): value is number => Number.isInteger(value) && Number(value) > 0);
  if (!Number.isInteger(batchId) || batchId <= 0 || !approvedRowNumbers.length || approvedRowNumbers.length !== requestedRowNumbers.length || new Set(approvedRowNumbers).size !== approvedRowNumbers.length) {
    res.status(400).json({ error: "Explicitly approve distinct valid row numbers before importing.", correlationId: res.locals.correlationId }); return;
  }
  const result = await db.transaction(async (tx) => {
    const [batch] = await tx.select().from(residentImportBatchesTable).where(eq(residentImportBatchesTable.id, batchId)).for("update");
    if (!batch) {
      const notFound = new Error("Resident import batch was not found.") as Error & { status: number };
      notFound.status = 404;
      throw notFound;
    }
    if (batch.status !== "preview") {
      const conflict = new Error("Resident import batch was already confirmed.") as Error & { status: number };
      conflict.status = 409;
      throw conflict;
    }
    if (principal.role === "house_manager" && batch.actor !== principal.sub) {
      const notFound = new Error("Resident import batch was not found.") as Error & { status: number };
      notFound.status = 404;
      throw notFound;
    }
    const rows = await tx.select().from(residentImportRowsTable).where(and(eq(residentImportRowsTable.batchId, batchId), inArray(residentImportRowsTable.rowNumber, approvedRowNumbers)));
    if (rows.length !== approvedRowNumbers.length || rows.some((row) => row.outcome !== "ready" || !row.normalizedData)) {
      const invalid = new Error("Only rows that passed preview validation can be approved.") as Error & { status: number };
      invalid.status = 400;
      throw invalid;
    }
    if (principal.role === "house_manager" && rows.some((row) => !hasHouseScope(principal, (row.normalizedData as NormalizedRow).home))) {
      const forbidden = new Error("Approved rows are outside the assigned house scope.") as Error & { status: number };
      forbidden.status = 403;
      throw forbidden;
    }
    const identities = [...new Set(rows.map((row) => normalized((row.normalizedData as NormalizedRow).email)))].sort();
    for (const identity of identities) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${identity}, 0))`);
    }
    const imported: number[] = [];
    for (const row of rows) {
      const data = row.normalizedData as NormalizedRow;
      const [existing] = await tx
        .select({ id: residentsTable.id })
        .from(residentsTable)
        .where(sql`lower(trim(${residentsTable.email})) = ${normalized(data.email)}`)
        .limit(1);
      if (existing) {
        await tx.update(residentImportRowsTable).set({ outcome: "skipped" }).where(eq(residentImportRowsTable.id, row.id));
        continue;
      }
      const [created] = await tx.insert(residentsTable).values({ ...data, balance: data.balance, nextPaymentDate: data.nextPaymentDate }).returning({ id: residentsTable.id });
      await tx.update(residentImportRowsTable).set({ outcome: "imported", residentId: created.id }).where(eq(residentImportRowsTable.id, row.id));
      imported.push(created.id);
    }
    await tx.update(residentImportRowsTable).set({ outcome: "skipped" }).where(and(eq(residentImportRowsTable.batchId, batchId), eq(residentImportRowsTable.outcome, "ready")));
    const [confirmed] = await tx.update(residentImportBatchesTable).set({ status: "confirmed", importedRows: imported.length, failedRows: batch.totalRows - imported.length, confirmedAt: new Date() }).where(and(eq(residentImportBatchesTable.id, batchId), eq(residentImportBatchesTable.status, "preview"))).returning();
    if (!confirmed) {
      const conflict = new Error("Resident import batch was confirmed concurrently.") as Error & { status: number };
      conflict.status = 409;
      throw conflict;
    }
    await tx.insert(auditEventsTable).values({ action: "Resident import confirmed", entityType: "resident_import", entityId: batchId, actor: res.locals.actorId ?? principal.sub, metadata: { importedRows: imported.length, skippedRows: batch.totalRows - imported.length } });
    return { imported, totalRows: batch.totalRows };
  });
  res.json({ batchId, status: "confirmed", importedResidentIds: result.imported, imported: result.imported.length, skipped: result.totalRows - result.imported.length });
});

export default router;
