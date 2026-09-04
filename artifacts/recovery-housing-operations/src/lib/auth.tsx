import { useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  getSession,
  loginAccount,
  logoutAccount,
  registerAccount,
  setAuthTokenGetter,
  setUnauthorizedHandler,
  type AccountRole,
  type RegistrationInput,
  type Session,
  type SessionUser,
} from '@workspace/api-client-react';
import {
  createContext,
  useContext,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type SessionRole = AccountRole;
export type { SessionUser };

type AuthState = {
  status: 'checking' | 'authenticated' | 'unauthenticated' | 'error';
  user: SessionUser | null;
  expiresAt: string | null;
};

type AuthContextValue = AuthState & {
  login: (email: string, password: string) => Promise<string>;
  logout: () => Promise<void>;
  register: (input: RegistrationInput) => Promise<string>;
  requestPasswordReset: (email: string) => Promise<string>;
  requestEmailVerification: (email: string) => Promise<string>;
  verifyEmail: (token: string) => Promise<string>;
  resetPassword: (token: string, password: string) => Promise<string>;
  provisionInitialAdmin: (input: InitialAdminSetupInput) => Promise<string>;
};

export type InitialAdminSetupInput = RegistrationInput & { setupCode: string };

const AuthContext = createContext<AuthContextValue | null>(null);

// This is deliberately process memory only. The approved browser session is
// an HttpOnly cookie; this supports a short-lived bearer returned by a managed
// handoff without ever writing credentials to browser storage.
let inMemoryAccessToken: string | null = null;

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: 'checking', user: null, expiresAt: null });
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSession = useCallback((status: 'unauthenticated' | 'error' = 'unauthenticated') => {
    inMemoryAccessToken = null;
    queryClient.clear();
    if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    expiryTimerRef.current = null;
    setState({ status, user: null, expiresAt: null });
  }, [queryClient]);
  const verifySessionRef = useRef<(signal?: AbortSignal) => Promise<void>>(async () => undefined);

  const applySession = useCallback((session: Session) => {
    const expiresInMs = Date.parse(session.expiresAt) - Date.now();
    if (!Number.isFinite(expiresInMs) || expiresInMs <= 0) {
      clearSession();
      return;
    }
    if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    setState({ status: 'authenticated', user: session.user, expiresAt: session.expiresAt });
    // The server extends the idle expiry on every authenticated request. Recheck
    // at the last confirmed boundary instead of logging out an active session
    // using a stale timestamp from login or page bootstrap.
    expiryTimerRef.current = setTimeout(() => {
      void verifySessionRef.current();
    }, expiresInMs);
  }, [clearSession]);

  const verifySession = useCallback(async (signal?: AbortSignal) => {
    try {
      const session = await getSession({
        signal,
      });
      if (!signal?.aborted) applySession(session);
    } catch (error: unknown) {
      if (signal?.aborted) return;
      if (error instanceof ApiError && error.status === 401) {
        clearSession();
        return;
      }
      // Verification failures stay fail-closed: hide records and clear every
      // user-scoped cache entry until the session can be checked again.
      clearSession('error');
    }
  }, [applySession, clearSession]);

  useEffect(() => {
    const controller = new AbortController();
    verifySessionRef.current = verifySession;
    setAuthTokenGetter(() => inMemoryAccessToken);
    setUnauthorizedHandler(() => {
      // Clearing the whole query cache is intentional: query keys can contain
      // sensitive resident/payment data, so no user-scoped data survives expiry.
      clearSession();
    });

    void verifySession(controller.signal);

    return () => {
      controller.abort();
      if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
      setAuthTokenGetter(null);
      setUnauthorizedHandler(null);
    };
  }, [clearSession, verifySession]);

  const authRequest = useCallback(async (path: string, body?: Record<string, unknown>) => {
    const response = await fetch(`/api/auth${path}`, {
      method: body ? 'POST' : 'GET',
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => ({})) as { error?: string; message?: string; user?: SessionUser; expiresAt?: string };
    return { response, data };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const session = await loginAccount({ email, password });
      queryClient.clear();
      applySession({ authenticated: true, ...session });
      return session.user.accountStatus === 'pending'
        ? 'Your email is verified. Your account is awaiting administrator access.'
        : 'Your secure workspace is ready.';
    } catch (error) {
      throw new Error(error instanceof ApiError ? error.message : 'Unable to sign in with those credentials.');
    }
  }, [applySession, queryClient]);
  const logout = useCallback(async () => {
    await logoutAccount();
    clearSession();
  }, [clearSession]);
  const register = useCallback(async (input: RegistrationInput) => {
    try {
      const data = await registerAccount(input);
      return data.message;
    } catch (error) {
      throw new Error(error instanceof ApiError ? error.message : 'The account could not be created.');
    }
  }, []);
  const requestPasswordReset = useCallback(async (email: string) => {
    const { response, data } = await authRequest('/password-reset/request', { email });
    if (!response.ok) throw new Error('The recovery request could not be submitted.');
    return data.message || 'If an eligible account exists, password reset instructions will be sent.';
  }, [authRequest]);
  const requestEmailVerification = useCallback(async (email: string) => {
    const { response, data } = await authRequest('/verification/request', { email });
    if (!response.ok) throw new Error(data.error || 'The verification email could not be requested.');
    return data.message || 'If an eligible account exists, verification instructions will be sent.';
  }, [authRequest]);
  const verifyEmail = useCallback(async (token: string) => {
    const { response, data } = await authRequest('/verify-email', { token });
    if (!response.ok) throw new Error(data.error || 'The verification code is invalid or expired.');
    return data.message || 'Email verified. An administrator must approve the account before sign-in.';
  }, [authRequest]);
  const resetPassword = useCallback(async (token: string, password: string) => {
    const { response, data } = await authRequest('/password-reset/complete', { token, password });
    if (!response.ok) throw new Error(data.error || 'The recovery code is invalid or expired.');
    clearSession();
    return data.message || 'Password updated. Sign in again on every device.';
  }, [authRequest, clearSession]);
  const provisionInitialAdmin = useCallback(async (input: InitialAdminSetupInput) => {
    const { response, data } = await authRequest('/bootstrap', { ...input });
    if (!response.ok) throw new Error(data.error || 'Initial administrator setup could not be completed.');
    return data.message || 'Initial administrator created. Sign in to continue.';
  }, [authRequest]);

  const value = useMemo(() => ({ ...state, login, logout, register, requestPasswordReset, requestEmailVerification, verifyEmail, resetPassword, provisionInitialAdmin }), [login, logout, provisionInitialAdmin, register, requestEmailVerification, requestPasswordReset, resetPassword, state, verifyEmail]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
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

export function PendingSessionScreen({ user, logout }: { user: SessionUser; logout: () => Promise<void> }) {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))] p-6">
      <div className="paper-card w-full max-w-md p-8 text-center">
        <img src="/redeemer-house-logo.jpeg" alt="Redeemer House" className="mx-auto h-16 w-16 rounded-2xl bg-white object-contain p-1" />
        <div className="section-kicker mt-6">Redeemer House</div>
        <h1 className="display-serif mt-2 text-4xl">Awaiting Approval</h1>
        <p className="mt-4 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
          Your email <strong>{user.email}</strong> is verified. An administrator must approve your account and assign your role before you can access the workspace.
        </p>
        <button
          onClick={() => void logout()}
          data-testid="button-logout-pending"
          className="mt-7 inline-flex items-center justify-center rounded-xl bg-[hsl(var(--primary))] px-5 py-3 text-xs font-extrabold text-[hsl(var(--primary-foreground))]"
        >
          Sign out
        </button>
      </div>
    </main>
  );
}
