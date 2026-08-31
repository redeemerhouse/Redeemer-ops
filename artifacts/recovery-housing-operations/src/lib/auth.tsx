import { useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  customFetch,
  setAuthTokenGetter,
  setUnauthorizedHandler,
} from '@workspace/api-client-react';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type SessionRole = 'owner_admin' | 'program_director' | 'house_manager' | 'resident';

export type SessionUser = {
  id: string;
  role: SessionRole;
  organizationId: string;
  houseNames: string[];
  residentId?: number;
};

type SessionResponse = {
  authenticated: true;
  user: SessionUser;
  expiresAt: string;
};

type AuthState = {
  status: 'checking' | 'authenticated' | 'unauthenticated' | 'error';
  user: SessionUser | null;
  expiresAt: string | null;
};

const AuthContext = createContext<AuthState | null>(null);

// This is deliberately process memory only. The approved browser session is
// an HttpOnly cookie; this supports a short-lived bearer returned by a managed
// handoff without ever writing credentials to browser storage.
let inMemoryAccessToken: string | null = null;

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: 'checking', user: null, expiresAt: null });

  useEffect(() => {
    let mounted = true;
    let expiryTimer: ReturnType<typeof setTimeout> | null = null;
    const clearSession = () => {
      inMemoryAccessToken = null;
      queryClient.clear();
      if (mounted) setState({ status: 'unauthenticated', user: null, expiresAt: null });
    };
    setAuthTokenGetter(() => inMemoryAccessToken);
    setUnauthorizedHandler(() => {
      // Clearing the whole query cache is intentional: query keys can contain
      // sensitive resident/payment data, so no user-scoped data survives expiry.
      clearSession();
    });

    void customFetch<SessionResponse>('/api/auth/session', {
      credentials: 'include',
      responseType: 'json',
    })
      .then((session) => {
        if (!mounted) return;
        const expiresInMs = Date.parse(session.expiresAt) - Date.now();
        if (!Number.isFinite(expiresInMs) || expiresInMs <= 0) {
          clearSession();
          return;
        }
        setState({ status: 'authenticated', user: session.user, expiresAt: session.expiresAt });
        expiryTimer = setTimeout(clearSession, expiresInMs);
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        if (error instanceof ApiError && error.status === 401) {
          setState({ status: 'unauthenticated', user: null, expiresAt: null });
          return;
        }
        // A failed verification must never fall through to the protected
        // router. Keep records hidden and offer a retry-safe error state.
        setState({ status: 'error', user: null, expiresAt: null });
      });

    return () => {
      mounted = false;
      if (expiryTimer) clearTimeout(expiryTimer);
      setAuthTokenGetter(null);
      setUnauthorizedHandler(null);
    };
  }, [queryClient]);

  const value = useMemo(() => state, [state]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

export function isAdministratorRole(role: SessionRole): boolean {
  return role === 'owner_admin' || role === 'program_director';
}

export function isStaffRole(role: SessionRole): boolean {
  return isAdministratorRole(role) || role === 'house_manager';
}

export function AuthLoading() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))] p-6">
      <div className="paper-card w-full max-w-md p-8 text-center" role="status" aria-live="polite">
        <div className="section-kicker">Redeemer House</div>
        <h1 className="display-serif mt-2 text-3xl">Checking your session</h1>
        <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">Your workspace will appear after access is verified.</p>
        <div className="mx-auto mt-6 h-1.5 w-32 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
          <span className="block h-full w-1/2 animate-pulse rounded-full bg-[hsl(var(--primary))]" />
        </div>
      </div>
    </main>
  );
}

export function SignInScreen() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))] p-6">
      <div className="paper-card w-full max-w-md p-8 text-center">
        <img src="/redeemer-house-logo.jpeg" alt="Redeemer House" className="mx-auto h-16 w-16 rounded-2xl bg-white object-contain p-1" />
        <div className="section-kicker mt-6">Redeemer House</div>
        <h1 className="display-serif mt-2 text-4xl">Sign in to continue</h1>
        <p className="mt-4 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
          Your session is missing or has expired. Sign in through the approved secure account flow to access operations records.
        </p>
        <a
          href="/auth/sign-in"
          data-testid="link-sign-in"
          className="mt-7 inline-flex items-center justify-center rounded-xl bg-[hsl(var(--primary))] px-5 py-3 text-xs font-extrabold text-[hsl(var(--primary-foreground))]"
        >
          Continue to secure sign-in
        </a>
        <p className="mt-5 text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">
          Resident and payment information stays hidden until your access is verified.
        </p>
      </div>
    </main>
  );
}

export function SessionError({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))] p-6">
      <div className="paper-card w-full max-w-md p-8 text-center">
        <div className="section-kicker">Redeemer House</div>
        <h1 className="display-serif mt-2 text-3xl">We couldn’t verify access</h1>
        <p className="mt-3 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">No operational records were loaded. Try again, or return to secure sign-in.</p>
        <button onClick={onRetry} data-testid="button-retry-session" className="mt-6 rounded-xl bg-[hsl(var(--primary))] px-5 py-3 text-xs font-extrabold text-[hsl(var(--primary-foreground))]">Try again</button>
      </div>
    </main>
  );
}
