import { UserCog, Check, Edit2, ShieldAlert, KeyRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListAdminAccountsQueryKey,
  useRevokeAdminAccountSessions,
  useListAdminAccounts,
  useUpdateAdminAccount,
  type AdminAccount,
  type AccountRole,
  type AccountStatus
} from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { isAdministratorRole, useAuth } from '@/lib/auth';
import { EmptyState, Modal, QueryState, StatusBadge, SubmitButton } from '@/components/ui-primitives';

export default function AccountManagement() {
  const { user } = useAuth();
  const isAdministrator = isAdministratorRole(user?.role ?? 'resident');
  
  const queryClient = useQueryClient();
  const accountsQuery = useListAdminAccounts();
  const [selectedAccount, setSelectedAccount] = useState<AdminAccount | null>(null);
  const [notice, setNotice] = useState('');

  const refresh = () => queryClient.invalidateQueries({ queryKey: getListAdminAccountsQueryKey() });

  if (!isAdministrator) {
    return (
      <AppShell>
        <div className="paper-card mx-auto max-w-2xl p-8">
          <div className="section-kicker">Account Management</div>
          <h1 className="display-serif mt-2 text-3xl">Administrator access required</h1>
          <p className="mt-3 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
            Only authorized administrators can manage roles and permissions.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="animate-enter">
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <div className="section-kicker">Security and Identity</div>
            <h1 className="display-serif mt-1 text-4xl tracking-tight">Account management</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
              Review and change account access roles, statuses, assigned properties, and resident profiles. 
              Verified accounts start as pending until approved.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.65)] px-4 py-3 text-xs text-[hsl(var(--muted-foreground))]">
            <UserCog size={16} className="text-[hsl(var(--primary))]" />
             <span>Changes take effect immediately</span>
          </div>
        </div>

        {notice && (
          <div data-testid="status-account-management" className="mt-6 flex items-center gap-2 rounded-2xl border border-[hsl(169_38%_68%)] bg-[hsl(169_32%_87%/.62)] px-4 py-3 text-sm font-bold text-[hsl(169_42%_27%)]">
            <Check size={16} /> {notice}
          </div>
        )}

        <div className="mt-8">
          <QueryState loading={accountsQuery.isLoading} error={accountsQuery.isError} errorDetail="Accounts could not be loaded." retry={refresh}>
            {accountsQuery.data?.accounts.length ? (
              <div className="paper-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.3)]">
                      <tr>
                        <th className="px-6 py-4 font-semibold text-[hsl(var(--muted-foreground))]">Account</th>
                        <th className="px-6 py-4 font-semibold text-[hsl(var(--muted-foreground))]">Role</th>
                        <th className="px-6 py-4 font-semibold text-[hsl(var(--muted-foreground))]">Status</th>
                        <th className="px-6 py-4 font-semibold text-[hsl(var(--muted-foreground))]">Scope</th>
                        <th className="px-6 py-4 font-semibold text-[hsl(var(--muted-foreground))]">Last login</th>
                        <th className="px-6 py-4 text-right font-semibold text-[hsl(var(--muted-foreground))]">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[hsl(var(--border))]">
                      {accountsQuery.data.accounts.map((account) => {
                        const isSelf = Number(user?.id) === account.id;
                        const canEdit = !isSelf && (user?.role === 'owner_admin' || account.role !== 'owner_admin');
                        return (
                        <tr key={account.id} className="transition-colors hover:bg-[hsl(var(--secondary)/.15)]" data-testid={`row-account-${account.id}`}>
                          <td className="px-6 py-4">
                            <div data-testid={`text-account-name-${account.id}`} className="font-extrabold">{account.firstName} {account.lastName}</div>
                            <div data-testid={`text-account-email-${account.id}`} className="text-xs text-[hsl(var(--muted-foreground))]">{account.email}</div>
                            <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                              {account.emailVerified ? 'Email verified' : 'Email not verified'} · Created {new Date(account.createdAt).toLocaleDateString()}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                             <span data-testid={`text-account-role-${account.id}`} className="capitalize">{account.role?.replaceAll('_', ' ') ?? 'Unassigned'}</span>
                          </td>
                          <td className="px-6 py-4">
                             <span data-testid={`status-account-${account.id}`}><StatusBadge status={account.status} /></span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="text-xs">
                              {account.houses.length > 0 ? (
                                <span>{account.houses.length} {account.houses.length === 1 ? 'house' : 'houses'}</span>
                              ) : (
                                <span className="text-[hsl(var(--muted-foreground))]">Global / None</span>
                              )}
                              {account.residentId && (
                                <div className="mt-0.5 font-semibold text-[hsl(var(--primary))]">Resident Profile</div>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-xs text-[hsl(var(--muted-foreground))]">
                            {account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleDateString() : 'Never'}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button
                              type="button"
                              onClick={() => { setNotice(''); setSelectedAccount(account); }}
                               disabled={!canEdit}
                              data-testid={`button-edit-account-${account.id}`}
                               title={isSelf ? 'You cannot change your own access.' : !canEdit ? 'Only an owner administrator can manage this account.' : undefined}
                               className="inline-flex items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-[11px] font-extrabold transition-colors hover:bg-[hsl(var(--secondary))] disabled:cursor-not-allowed disabled:opacity-45"
                            >
                              <Edit2 size={13} />
                              Edit access
                            </button>
                          </td>
                        </tr>
                      )})}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <EmptyState title="No accounts found" detail="No accounts are available for administration." />
            )}
          </QueryState>
        </div>
      </div>

      {selectedAccount !== null && accountsQuery.data && (
        <EditAccountModal
          account={selectedAccount}
          houses={accountsQuery.data.houses}
          residents={accountsQuery.data.residents}
           actorRole={user?.role ?? 'program_director'}
          onClose={() => setSelectedAccount(null)}
          onSuccess={(msg) => {
            setSelectedAccount(null);
            refresh();
            setNotice(msg);
          }}
        />
      )}
    </AppShell>
  );
}

function EditAccountModal({
  account,
  houses,
  residents,
  actorRole,
  onClose,
  onSuccess
}: {
  account: AdminAccount;
  houses: { id: number; name: string }[];
  residents: { id: number; name: string; home: string }[];
  actorRole: AccountRole;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const [role, setRole] = useState<AccountRole | ''>(account.role ?? '');
  const [status, setStatus] = useState<AccountStatus>(account.status);
  const [houseIds, setHouseIds] = useState<Set<number>>(new Set(account.houses.map((h) => h.id)));
  const [residentId, setResidentId] = useState<number | ''>(account.residentId ?? '');
  
  const updateMutation = useUpdateAdminAccount();
  const revokeMutation = useRevokeAdminAccountSessions();

  const toggleHouse = (id: number) => {
    const next = new Set(houseIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setHouseIds(next);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!window.confirm(`Apply these access changes for ${account.firstName || account.email}? Active sessions will be revoked immediately.`)) return;
    const selectedResident = residents.find((resident) => resident.id === Number(residentId));
    const residentHouse = selectedResident ? houses.find((house) => house.name === selectedResident.home) : undefined;
    const scopedHouseIds = role === 'resident'
      ? residentHouse ? [residentHouse.id] : []
      : role === 'house_manager' ? Array.from(houseIds) : [];
    updateMutation.mutate(
      {
        id: account.id,
        data: {
          role: role === '' ? null : role,
          status,
          houseIds: scopedHouseIds,
          residentId: role === 'resident' && residentId !== '' ? Number(residentId) : null,
        }
      },
      {
        onSuccess: () => {
          onSuccess(`${account.firstName}'s access has been updated.`);
        }
      }
    );
  };

  return (
    <Modal title="Edit account access" eyebrow={account.email} onClose={onClose}>
      <form onSubmit={submit} className="space-y-6">
        
        {updateMutation.isError && (
          <div data-testid="status-edit-account-error" className="rounded-xl border border-[hsl(7_58%_75%)] bg-[hsl(9_63%_90%/.55)] px-4 py-3 text-sm font-semibold text-[hsl(var(--destructive))]">
            Unable to update account access. Please try again.
          </div>
        )}

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">Account Role</span>
             <select data-testid="select-role" disabled={status === 'pending'} value={status === 'pending' ? '' : role} onChange={(e) => {
               const nextRole = e.target.value as AccountRole | '';
               setRole(nextRole);
               if (nextRole !== 'house_manager') setHouseIds(new Set());
               if (nextRole !== 'resident') setResidentId('');
             }} className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))] disabled:opacity-55">
              <option value="">None</option>
               {actorRole === 'owner_admin' && <option value="owner_admin">Owner Admin</option>}
              <option value="program_director">Program Director</option>
              <option value="house_manager">House Manager</option>
              <option value="resident">Resident</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">Account Status</span>
             <select data-testid="select-status" value={status} onChange={(e) => {
               const nextStatus = e.target.value as AccountStatus;
               setStatus(nextStatus);
               if (nextStatus === 'pending') {
                 setRole('');
                 setResidentId('');
                 setHouseIds(new Set());
               }
             }} className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))]">
              <option value="pending">Pending</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
        </div>

         {role === 'house_manager' && status !== 'pending' && <div className="space-y-3">
          <span className="block text-[11px] font-extrabold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">Property Scope</span>
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.3)] p-1">
            <div className="max-h-40 overflow-y-auto p-2 space-y-1">
              {houses.length > 0 ? houses.map(house => (
                <label key={house.id} className="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-[hsl(var(--secondary))] transition-colors">
                  <input
                    type="checkbox"
                    data-testid={`checkbox-house-${house.id}`}
                    checked={houseIds.has(house.id)}
                    onChange={() => toggleHouse(house.id)}
                    className="h-4 w-4 rounded border-[hsl(var(--input))] text-[hsl(var(--primary))] focus:ring-[hsl(var(--primary))]"
                  />
                  <span className="text-sm font-semibold">{house.name}</span>
                </label>
              )) : (
                <div className="p-2 text-xs text-[hsl(var(--muted-foreground))]">No houses available.</div>
              )}
            </div>
          </div>
          <p className="text-[11px] text-[hsl(var(--muted-foreground))]">Select the properties this account is permitted to manage.</p>
         </div>}

         {role === 'resident' && status !== 'pending' && (
          <label className="block">
             <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">Linked Resident Profile</span>
            <select data-testid="select-resident" value={residentId} onChange={(e) => setResidentId(e.target.value === '' ? '' : Number(e.target.value))} className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))]">
              <option value="">-- No resident linked --</option>
              {residents.map(r => (
                <option key={r.id} value={r.id}>{r.name} ({r.home})</option>
              ))}
            </select>
          </label>
        )}

        <div className="flex items-center gap-2 rounded-xl bg-[hsl(var(--destructive)/.1)] px-4 py-3 text-xs text-[hsl(var(--destructive))]">
          <ShieldAlert size={16} className="shrink-0" />
          <span>Revoking access will immediately disable active sessions for this account.</span>
        </div>

         <div className="flex flex-wrap justify-end gap-3 border-t border-[hsl(var(--border))] pt-5">
           <button
             type="button"
             data-testid="button-revoke-account-sessions"
             disabled={revokeMutation.isPending}
             onClick={() => {
               if (!window.confirm(`Revoke every active session for ${account.firstName || account.email}?`)) return;
               revokeMutation.mutate({ id: account.id }, {
                 onSuccess: () => onSuccess(`${account.firstName || account.email}'s sessions were revoked.`),
               });
             }}
             className="mr-auto inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-4 py-2.5 text-xs font-extrabold hover:bg-[hsl(var(--secondary))] disabled:opacity-55"
           >
             <KeyRound size={14} /> Revoke sessions
           </button>
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-xs font-extrabold text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] transition-colors">
            Cancel
          </button>
          <SubmitButton pending={updateMutation.isPending}>Save changes</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}