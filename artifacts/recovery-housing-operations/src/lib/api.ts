export type ReportType = 'occupancy' | 'roster' | 'payments' | 'revenue' | 'compliance' | 'referral' | 'audit';
export type ReportFormat = 'csv' | 'pdf';
export type UserRole = 'admin' | 'staff';

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
export const currentUserRole: UserRole = configuredRole === 'staff' ? 'staff' : 'admin';
export const isAdministrator = currentUserRole === 'admin';

export const get = async (path: string) => {
  const response = await fetch(`/api${path}`);
  if (!response.ok) throw new Error('Unable to load operations data');
  return response.json();
};

export async function exportReport(reportType: ReportType, format: ReportFormat): Promise<Response> {
  const headers: HeadersInit = {};
  if (isAdministrator) headers['X-User-Role'] = 'admin';

  return fetch(`/api/reports/${reportType}/export?format=${format}`, { headers });
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