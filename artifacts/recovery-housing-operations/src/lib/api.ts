export type ReportType = 'occupancy' | 'roster' | 'payments' | 'revenue' | 'compliance' | 'referral' | 'audit';
export type ReportFormat = 'csv' | 'pdf';
export type UserRole = 'admin' | 'staff' | 'house_manager' | 'resident';

export const reportTypes: { value: ReportType; label: string }[] = [
  { value: 'occupancy', label: 'Occupancy' },
  { value: 'roster', label: 'Resident roster' },
  { value: 'payments', label: 'Payments' },
  { value: 'revenue', label: 'Revenue' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'referral', label: 'Referrals' },
  { value: 'audit', label: 'Audit history' },
];

const configuredRole = import.meta.env.VITE_USER_ROLE?.toLowerCase();
// The current artifact has no authentication session yet, so its existing demo
// workspace represents an administrator. A staff build can explicitly opt out.
export const currentUserRole: UserRole = configuredRole === 'resident' || configuredRole === 'house_manager' || configuredRole === 'staff' ? configuredRole : 'admin';
export const isAdministrator = currentUserRole === 'admin';
export const canViewReports = isAdministrator || currentUserRole === 'staff' || currentUserRole === 'house_manager';
export const canImportResidents = isAdministrator || currentUserRole === 'staff' || currentUserRole === 'house_manager';

export const get = async (path: string) => {
  const response = await fetch(`/api${path}`);
  if (!response.ok) throw new Error('Unable to load operations data');
  return response.json();
};

export async function exportReport(reportType: ReportType, format: ReportFormat, filters: { house?: string; from?: string; to?: string } = {}): Promise<Response> {
  const headers: HeadersInit = {};
  if (isAdministrator) headers['X-User-Role'] = 'admin';
  const query = new URLSearchParams({ format, ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) });
  return fetch(`/api/reports/${reportType}/export?${query.toString()}`, { headers });
}

export async function getReportPreview(reportType: ReportType, filters: { house?: string; from?: string; to?: string } = {}) {
  const query = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, value]) => value)));
  const response = await fetch(`/api/reports/${reportType}${query.toString() ? `?${query}` : ''}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Unable to load this report');
  return response.json() as Promise<{ rows: Record<string, unknown>[]; generatedAt: string; filters: typeof filters }>;
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary);
}

export async function previewResidentImport(file: File) {
  const contentBase64 = base64FromBytes(new Uint8Array(await file.arrayBuffer()));
  const response = await fetch('/api/residents/import/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name, contentBase64 }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Unable to preview this import');
  return body as {
    batchId: number;
    sourceFilename: string;
    identityRule: string;
    columns: string[];
    rows: { rowNumber: number; normalizedData: Record<string, unknown>; sourceData: Record<string, string>; errors: string[]; valid: boolean }[];
    summary: { total: number; valid: number; failed: number };
  };
}

export async function confirmResidentImport(batchId: number, approvedRowNumbers: number[]) {
  const response = await fetch(`/api/residents/import/${batchId}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approvedRowNumbers }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Unable to confirm this import');
  return body as { batchId: number; status: string; imported: number; skipped: number; importedResidentIds: number[] };
}

export function downloadResidentTemplate(format: 'csv' | 'xlsx') {
  const link = document.createElement('a');
  link.href = `/api/residents/import/template?format=${format}`;
  link.download = `resident-import-template.${format}`;
  link.click();
}

export function reportFilename(response: Response, fallback: string): string {
  const disposition = response.headers.get('Content-Disposition');
  if (!disposition) return fallback;

  const encodedFilename = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  if (encodedFilename) {
    try {
      return decodeURIComponent(encodedFilename.trim().replace(/^["']|["']$/g, ''));
    } catch {
      return encodedFilename.trim().replace(/^["']|["']$/g, '');
    }
  }

  const filename = disposition.match(/filename\s*=\s*("?)([^";]+)\1/i)?.[2];
  return filename?.trim() || fallback;
}