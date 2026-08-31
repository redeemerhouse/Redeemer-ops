import { authenticatedFetch, customFetch } from '@workspace/api-client-react';

export type ReportType = 'occupancy' | 'roster' | 'payments' | 'revenue' | 'compliance' | 'referral' | 'audit';
export type ReportFormat = 'csv' | 'pdf';

export const reportTypes: { value: ReportType; label: string }[] = [
  { value: 'occupancy', label: 'Occupancy' },
  { value: 'roster', label: 'Resident roster' },
  { value: 'payments', label: 'Payments' },
  { value: 'revenue', label: 'Revenue' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'referral', label: 'Referrals' },
  { value: 'audit', label: 'Audit history' },
];

export const get = async <T = any>(path: string): Promise<T> => {
  return customFetch<T>(`/api${path}`, { responseType: 'json' });
};

export async function exportReport(reportType: ReportType, format: ReportFormat, filters: { house?: string; from?: string; to?: string } = {}): Promise<Response> {
  const query = new URLSearchParams({ format, ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) });
  return authenticatedFetch(`/api/reports/${reportType}/export?${query.toString()}`);
}

export async function getReportPreview(reportType: ReportType, filters: { house?: string; from?: string; to?: string } = {}) {
  const query = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, value]) => value)));
  try {
    return await customFetch<{ rows: Record<string, unknown>[]; generatedAt: string; filters: typeof filters }>(
      `/api/reports/${reportType}${query.toString() ? `?${query}` : ''}`,
      { responseType: 'json' },
    );
  } catch (error) {
    if (error instanceof Error && 'status' in error && error.status === 404) return null;
    throw error;
  }
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary);
}

export async function previewResidentImport(file: File) {
  const contentBase64 = base64FromBytes(new Uint8Array(await file.arrayBuffer()));
  return customFetch<ResidentImportPreview>('/api/residents/import/preview', {
    method: 'POST',
    body: JSON.stringify({ filename: file.name, contentBase64 }),
    responseType: 'json',
  });
}

export async function confirmResidentImport(batchId: number, approvedRowNumbers: number[]) {
  return customFetch<{
    batchId: number; status: string; imported: number; skipped: number; importedResidentIds: number[];
  }>(`/api/residents/import/${batchId}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ approvedRowNumbers }),
    responseType: 'json',
  });
}

export async function downloadResidentTemplate(format: 'csv' | 'xlsx') {
  const response = await authenticatedFetch(`/api/residents/import/template?format=${format}`);
  if (!response.ok) throw new Error('Unable to download this template');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `resident-import-template.${format}`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export type ResidentImportPreview = {
    batchId: number;
    sourceFilename: string;
    identityRule: string;
    columns: string[];
    rows: { rowNumber: number; normalizedData: Record<string, unknown>; sourceData: Record<string, string>; errors: string[]; valid: boolean }[];
    summary: { total: number; valid: number; failed: number };
};

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