import { lazy, Suspense, type ReactNode, useEffect, useState } from 'react';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import SignIn from '@/pages/sign-in';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';
import { AuthLoading, AuthProvider, SessionError, useAuth, PendingSessionScreen } from '@/lib/auth';

const Dashboard = lazy(() => import('@/pages/dashboard'));
const Residents = lazy(() => import('@/pages/residents'));
const Payments = lazy(() => import('@/pages/payments'));
const ResidentDetail = lazy(() => import('@/pages/resident-detail'));
const Operations = lazy(() => import('@/pages/operations'));
const Assessment = lazy(() => import('@/pages/assessment'));
const AssessmentLibrary = lazy(() => import('@/pages/assessment-library'));
const AccountManagement = lazy(() => import('@/pages/account-management'));
const NotFound = lazy(() => import('@/pages/not-found'));

const RECOVERY_EVENT = 'redeemer-house:request-failed';
const notifyRecoverableFailure = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(RECOVERY_EVENT));
};

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: notifyRecoverableFailure }),
  mutationCache: new MutationCache({ onError: notifyRecoverableFailure }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        if (failureCount >= 2) return false;
        if (!(error instanceof ApiError)) return true;
        return error.status === 408 || error.status === 429 || error.status >= 500;
      },
      retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 4_000),
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});

function GlobalRecoveryNotice() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = () => setVisible(true);
    window.addEventListener(RECOVERY_EVENT, show);
    return () => window.removeEventListener(RECOVERY_EVENT, show);
  }, []);
  if (!visible) return null;
  return (
    <div role="alert" className="fixed bottom-4 left-4 right-4 z-[100] mx-auto flex max-w-xl items-center justify-between gap-4 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-xl">
      <p className="text-sm font-bold">That request could not be completed. Your navigation is still available.</p>
      <div className="flex shrink-0 gap-2">
        <button type="button" onClick={() => window.location.reload()} className="rounded-xl bg-[hsl(var(--primary))] px-3 py-2 text-xs font-extrabold text-white">Retry page</button>
        <button type="button" onClick={() => setVisible(false)} className="rounded-xl px-3 py-2 text-xs font-extrabold">Dismiss</button>
      </div>
    </div>
  );
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Suspense fallback={<AuthLoading />}>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/residents" component={Residents} />
          <Route path="/residents/:id" component={ResidentDetail} />
          <Route path="/assessments/:id" component={Assessment} />
          <Route path="/assessment-library" component={AssessmentLibrary} />
          <Route path="/payments" component={Payments} />
          <Route path="/operations" component={Operations} />
          <Route path="/account-management" component={AccountManagement} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthenticatedApp />
      </AuthProvider>
    </QueryClientProvider>
  );
}

function AuthenticatedApp() {
  const { status, login, register, requestPasswordReset, verifyEmail, resetPassword, provisionInitialAdmin, user, logout } = useAuth();

  if (status === 'checking') return <AuthLoading />;
  if (status === 'unauthenticated') return <TooltipProvider><SignIn login={login} register={register} requestPasswordReset={requestPasswordReset} verifyEmail={verifyEmail} resetPassword={resetPassword} provisionInitialAdmin={provisionInitialAdmin} /><Toaster /></TooltipProvider>;
  if (status === 'error') return <SessionError onRetry={() => window.location.reload()} />;

  if (user?.accountStatus === 'pending') {
    return <PendingSessionScreen user={user} logout={logout} />;
  }

  return (
    <TooltipProvider>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <Router />
      </WouterRouter>
      <GlobalRecoveryNotice />
      <Toaster />
    </TooltipProvider>
  );
}

export default App;
