export function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day;
}

export type DocumentFileMetadata = {
  objectPath?: unknown;
  fileName?: unknown;
  contentType?: unknown;
  fileSize?: unknown;
};

export function hasCompleteFileMetadata(document: DocumentFileMetadata): boolean {
  return typeof document.objectPath === "string" &&
    document.objectPath.startsWith("/objects/") &&
    document.objectPath.length > "/objects/".length &&
    typeof document.fileName === "string" &&
    document.fileName.trim().length > 0 &&
    typeof document.contentType === "string" &&
    document.contentType.trim().length > 0 &&
    Number.isInteger(document.fileSize) &&
    Number(document.fileSize) > 0;
}

export function isValidDocumentVisibility(visibility: unknown): visibility is "staff" | "resident" {
  return visibility === "staff" || visibility === "resident";
}

export function isValidMoney(value: unknown): boolean {
  if (typeof value !== "string" && typeof value !== "number") return false;
  const text = String(value);
  return /^\d{1,8}(\.\d{1,2})?$/.test(text) && Number(text) >= 0 && Number(text) <= 99_999_999.99;
}