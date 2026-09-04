import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ShieldCheck, KeyRound, UserPlus } from 'lucide-react';
import logoPath from '@assets/Logo_Redeemer_1787578091618.jpeg';

type ViewState = 'signin' | 'register' | 'setup' | 'forgot' | 'verify' | 'reset';

export interface SignInProps {
  login: (email: string, password: string) => Promise<string>;
  register: (input: z.infer<typeof registerSchema>) => Promise<string>;
  requestPasswordReset: (email: string) => Promise<string>;
  requestEmailVerification: (email: string) => Promise<string>;
  verifyEmail: (token: string) => Promise<string>;
  resetPassword: (token: string, password: string) => Promise<string>;
  provisionInitialAdmin: (input: z.infer<typeof setupSchema>) => Promise<string>;
}

const signinSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

const passwordSchema = z.string().min(12, 'Password must be at least 12 characters').regex(/[a-z]/, 'Add a lowercase letter').regex(/[A-Z]/, 'Add an uppercase letter').regex(/\d/, 'Add a number');

const registerSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName: z.string().trim().min(1, 'Last name is required').max(100),
  email: z.string().email('Please enter a valid email address'),
  password: passwordSchema,
  passwordConfirmation: z.string().min(1, 'Confirm your password'),
}).refine((values) => values.password === values.passwordConfirmation, {
  path: ['passwordConfirmation'],
  message: 'Passwords must match',
});

const setupSchema = registerSchema.and(z.object({
  setupCode: z.string().min(16, 'Enter the complete setup code').max(200),
}));

const forgotSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
});

const codeSchema = z.object({
  token: z.string().min(32, 'Enter the complete one-time code'),
});

const resetSchema = codeSchema.extend({
  password: passwordSchema,
});

export default function SignIn({
  login,
  register,
  requestPasswordReset,
  requestEmailVerification,
  verifyEmail,
  resetPassword,
  provisionInitialAdmin,
}: SignInProps) {
  const [view, setView] = useState<ViewState>('signin');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const signinForm = useForm<z.infer<typeof signinSchema>>({
    resolver: zodResolver(signinSchema),
    defaultValues: { email: '', password: '' },
  });

  const registerForm = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { firstName: '', lastName: '', email: '', password: '', passwordConfirmation: '' },
  });
  const setupForm = useForm<z.infer<typeof setupSchema>>({
    resolver: zodResolver(setupSchema),
    defaultValues: { firstName: '', lastName: '', email: '', password: '', passwordConfirmation: '', setupCode: '' },
  });

  const forgotForm = useForm<z.infer<typeof forgotSchema>>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: '' },
  });
  const verifyForm = useForm<z.infer<typeof codeSchema>>({ resolver: zodResolver(codeSchema), defaultValues: { token: '' } });
  const resendVerificationForm = useForm<z.infer<typeof forgotSchema>>({ resolver: zodResolver(forgotSchema), defaultValues: { email: '' } });
  const resetForm = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema), defaultValues: { token: '', password: '' } });

  const onSignIn = async (values: z.infer<typeof signinSchema>) => {
    setIsSubmitting(true);
    try {
      const msg = await login(values.email, values.password);
      toast({ title: 'Welcome', description: msg });
    } catch (err: any) {
      toast({
        title: 'Authentication failed',
        description: err.message || 'An error occurred during sign in.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const onRegister = async (values: z.infer<typeof registerSchema>) => {
    setIsSubmitting(true);
    try {
      const msg = await register(values);
      toast({ title: 'Account created', description: msg });
      setView('verify');
      registerForm.reset();
    } catch (err: any) {
      toast({
        title: 'Account creation failed',
        description: err.message || 'An error occurred.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };
  const onSetup = async (values: z.infer<typeof setupSchema>) => {
    setIsSubmitting(true);
    try {
      const msg = await provisionInitialAdmin(values);
      toast({ title: 'Administrator created', description: msg });
      setupForm.reset();
      setView('signin');
    } catch (err: unknown) {
      toast({ title: 'Administrator setup failed', description: err instanceof Error ? err.message : 'The setup could not be completed.', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const onForgot = async (values: z.infer<typeof forgotSchema>) => {
    setIsSubmitting(true);
    try {
      const msg = await requestPasswordReset(values.email);
      toast({ title: 'Recovery instructions requested', description: msg });
      setView('reset');
      forgotForm.reset();
    } catch (err: any) {
      toast({
        title: 'Recovery request failed',
        description: err.message || 'An error occurred.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const onVerify = async (values: z.infer<typeof codeSchema>) => {
    setIsSubmitting(true);
    try {
      const msg = await verifyEmail(values.token.trim());
      toast({ title: 'Email verified', description: msg });
      verifyForm.reset();
      setView('signin');
    } catch (err: unknown) {
      toast({ title: 'Verification failed', description: err instanceof Error ? err.message : 'The code is invalid or expired.', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };
  const onResendVerification = async (values: z.infer<typeof forgotSchema>) => {
    setIsSubmitting(true);
    try {
      const msg = await requestEmailVerification(values.email);
      toast({ title: 'Verification requested', description: msg });
      resendVerificationForm.reset();
    } catch (err: unknown) {
      toast({ title: 'Verification request failed', description: err instanceof Error ? err.message : 'The verification email could not be requested.', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const onReset = async (values: z.infer<typeof resetSchema>) => {
    setIsSubmitting(true);
    try {
      const msg = await resetPassword(values.token.trim(), values.password);
      toast({ title: 'Password updated', description: msg });
      resetForm.reset();
      setView('signin');
    } catch (err: unknown) {
      toast({ title: 'Recovery failed', description: err instanceof Error ? err.message : 'The code is invalid or expired.', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const containerVariants: Variants = {
    hidden: { opacity: 0, x: 20 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.4, ease: 'easeOut' } },
    exit: { opacity: 0, x: -20, transition: { duration: 0.3, ease: 'easeIn' } },
  };

  return (
    <div className="flex min-h-[100dvh] w-full bg-background" data-testid="signin-page">
      {/* Left side - Branded trustworthy space */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 bg-[hsl(var(--sidebar))] text-[hsl(var(--sidebar-foreground))] p-12 lg:p-20 relative overflow-hidden">
        {/* Subtle decorative background elements */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none opacity-20">
          <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-primary blur-[120px]" />
          <div className="absolute bottom-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-[hsl(var(--sidebar-accent))] blur-[100px]" />
        </div>

        <div className="relative z-10">
          <div className="flex items-center gap-3 text-primary-foreground mb-16">
            <ShieldCheck className="w-8 h-8 text-primary" data-testid="icon-shield" />
            <span className="font-semibold tracking-wide uppercase text-sm">ONEsource Secure Access</span>
          </div>

          <h1 className="display-serif text-5xl lg:text-6xl leading-[1.1] font-medium text-white max-w-xl">
            Supporting the journey of recovery.
          </h1>
          <p className="mt-8 text-lg text-sidebar-foreground/80 max-w-md leading-relaxed">
            Welcome to the Redeemer House ONEsource operations workspace. We handle sensitive records with the utmost care, ensuring privacy and dignity for our residents and staff.
          </p>
        </div>

        <div className="relative z-10 privacy-stripe p-6 rounded-xl border border-sidebar-border bg-sidebar-accent/30 backdrop-blur-sm max-w-md">
          <h3 className="font-medium text-white flex items-center gap-2 mb-2">
            <KeyRound className="w-4 h-4 text-primary" /> Privacy Assured
          </h3>
          <p className="text-sm text-sidebar-foreground/70 leading-relaxed">
            Your connection is secure. All operations and resident data accessed through this portal are strictly confidential and monitored for compliance.
          </p>
        </div>
      </div>

      {/* Right side - Interactive Form Space */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 lg:p-12 relative">
        <div className="w-full max-w-[420px] mx-auto">
          {/* Logo */}
          <div className="flex justify-center mb-10">
            <img 
              src={logoPath} 
              alt="Redeemer House Logo" 
              className="h-24 w-auto object-contain rounded-xl shadow-sm border border-border/50" 
              data-testid="img-logo"
            />
          </div>

          <div className="bg-card border border-card-border shadow-[0_8px_40px_hsl(219_64%_14%_/_0.06)] rounded-2xl p-8 relative overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              {view === 'signin' && (
                <motion.div
                  key="signin"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  data-testid="view-signin"
                >
                  <div className="mb-6">
                    <h2 className="text-2xl font-semibold text-foreground display-serif">Sign in</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      Enter your credentials to access the workspace.
                    </p>
                  </div>

                  <Form {...signinForm}>
                    <form onSubmit={signinForm.handleSubmit(onSignIn)} className="space-y-4">
                      <FormField
                        control={signinForm.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                              <Input 
                                placeholder="name@redeemerhouse.org" 
                                type="email" 
                                autoCapitalize="none"
                                autoComplete="email"
                                autoCorrect="off"
                                data-testid="input-email"
                                {...field} 
                              />
                            </FormControl>
                            <FormMessage data-testid="error-email" />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={signinForm.control}
                        name="password"
                        render={({ field }) => (
                          <FormItem>
                            <div className="flex items-center justify-between">
                              <FormLabel>Password</FormLabel>
                              <button
                                type="button"
                                onClick={() => setView('forgot')}
                                className="text-xs font-medium text-primary hover:underline"
                                data-testid="link-forgot"
                              >
                                Forgot password?
                              </button>
                            </div>
                            <FormControl>
                              <Input 
                                type="password" 
                                autoComplete="current-password"
                                data-testid="input-password"
                                {...field} 
                              />
                            </FormControl>
                            <FormMessage data-testid="error-password" />
                          </FormItem>
                        )}
                      />
                      <Button 
                        type="submit" 
                        className="w-full mt-2 h-11 text-base font-medium" 
                        disabled={isSubmitting}
                        data-testid="button-submit-signin"
                      >
                        {isSubmitting ? (
                          <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Authenticating...</>
                        ) : (
                          'Sign In'
                        )}
                      </Button>
                    </form>
                  </Form>

                  <div className="mt-8 pt-6 border-t border-border/60 text-center">
                    <p className="text-sm text-muted-foreground">
                      Need access to ONEsource?{' '}
                      <button
                        type="button"
                        onClick={() => setView('register')}
                        className="font-medium text-primary hover:underline inline-flex items-center gap-1"
                        data-testid="link-register"
                      >
                        <UserPlus className="w-3 h-3" /> Create Account
                      </button>
                    </p>
                    <button type="button" onClick={() => setView('verify')} className="mt-3 text-xs font-medium text-muted-foreground hover:text-primary" data-testid="link-enter-verification-code">Already have a verification code?</button>
                    <button type="button" onClick={() => setView('setup')} className="mt-3 block w-full text-xs font-medium text-muted-foreground hover:text-primary" data-testid="link-initial-admin-setup">Setting up the first administrator?</button>
                  </div>
                </motion.div>
              )}

              {view === 'setup' && (
                <motion.div key="setup" variants={containerVariants} initial="hidden" animate="visible" exit="exit" data-testid="view-initial-admin-setup">
                  <div className="mb-6">
                    <h2 className="text-2xl font-semibold text-foreground display-serif">Initial Administrator Setup</h2>
                    <p className="text-sm text-muted-foreground mt-1">Use the one-time setup code stored in Replit Secrets. If your first registration is stuck awaiting verification, enter that same email and password here to recover it as the owner administrator.</p>
                  </div>
                  <Form {...setupForm}>
                    <form onSubmit={setupForm.handleSubmit(onSetup)} className="space-y-4">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <FormField control={setupForm.control} name="firstName" render={({ field }) => <FormItem><FormLabel>First name</FormLabel><FormControl><Input autoComplete="given-name" data-testid="input-setup-first-name" {...field} /></FormControl><FormMessage /></FormItem>} />
                        <FormField control={setupForm.control} name="lastName" render={({ field }) => <FormItem><FormLabel>Last name</FormLabel><FormControl><Input autoComplete="family-name" data-testid="input-setup-last-name" {...field} /></FormControl><FormMessage /></FormItem>} />
                      </div>
                      <FormField control={setupForm.control} name="email" render={({ field }) => <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" autoComplete="email" data-testid="input-setup-email" {...field} /></FormControl><FormMessage /></FormItem>} />
                      <FormField control={setupForm.control} name="password" render={({ field }) => <FormItem><FormLabel>Password</FormLabel><FormControl><Input type="password" autoComplete="new-password" data-testid="input-setup-password" {...field} /></FormControl><FormMessage /></FormItem>} />
                      <FormField control={setupForm.control} name="passwordConfirmation" render={({ field }) => <FormItem><FormLabel>Confirm password</FormLabel><FormControl><Input type="password" autoComplete="new-password" data-testid="input-setup-password-confirmation" {...field} /></FormControl><FormMessage /></FormItem>} />
                      <FormField control={setupForm.control} name="setupCode" render={({ field }) => <FormItem><FormLabel>One-time setup code</FormLabel><FormControl><Input type="password" autoComplete="off" data-testid="input-setup-code" {...field} /></FormControl><FormMessage /></FormItem>} />
                      <Button type="submit" className="w-full h-11" disabled={isSubmitting} data-testid="button-submit-initial-admin">
                        {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating administrator...</> : 'Create Administrator'}
                      </Button>
                    </form>
                  </Form>
                  <button type="button" onClick={() => setView('signin')} className="mt-8 w-full text-sm font-medium text-muted-foreground hover:text-foreground" data-testid="link-setup-back">Back to sign in</button>
                </motion.div>
              )}

              {view === 'register' && (
                <motion.div
                  key="register"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  data-testid="view-register"
                >
                  <div className="mb-6">
                    <h2 className="text-2xl font-semibold text-foreground display-serif">Create Account</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      Create your secure account. An administrator will assign access after email verification.
                    </p>
                  </div>

                  <Form {...registerForm}>
                    <form onSubmit={registerForm.handleSubmit(onRegister)} className="space-y-4">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <FormField
                          control={registerForm.control}
                          name="firstName"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>First name</FormLabel>
                              <FormControl><Input autoComplete="given-name" data-testid="input-register-first-name" {...field} /></FormControl>
                              <FormMessage data-testid="error-register-first-name" />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={registerForm.control}
                          name="lastName"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Last name</FormLabel>
                              <FormControl><Input autoComplete="family-name" data-testid="input-register-last-name" {...field} /></FormControl>
                              <FormMessage data-testid="error-register-last-name" />
                            </FormItem>
                          )}
                        />
                      </div>
                      <FormField
                        control={registerForm.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                              <Input 
                                placeholder="name@redeemerhouse.org" 
                                type="email" 
                                autoCapitalize="none"
                                autoComplete="email"
                                data-testid="input-register-email"
                                {...field} 
                              />
                            </FormControl>
                            <FormMessage data-testid="error-register-email" />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={registerForm.control}
                        name="password"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Desired Password</FormLabel>
                            <FormControl>
                              <Input 
                                type="password" 
                                autoComplete="new-password"
                                data-testid="input-register-password"
                                {...field} 
                              />
                            </FormControl>
                            <FormMessage data-testid="error-register-password" />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={registerForm.control}
                        name="passwordConfirmation"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Confirm Password</FormLabel>
                            <FormControl>
                              <Input
                                type="password"
                                autoComplete="new-password"
                                data-testid="input-register-password-confirmation"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage data-testid="error-register-password-confirmation" />
                          </FormItem>
                        )}
                      />
                      <Button 
                        type="submit" 
                        className="w-full mt-2 h-11 text-base font-medium" 
                        disabled={isSubmitting}
                        data-testid="button-submit-register"
                      >
                        {isSubmitting ? (
                          <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating account...</>
                        ) : (
                          'Create Account'
                        )}
                      </Button>
                    </form>
                  </Form>

                  <div className="mt-8 text-center">
                    <button
                      type="button"
                      onClick={() => setView('signin')}
                      className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                      data-testid="link-back-to-signin"
                    >
                      &larr; Back to sign in
                    </button>
                  </div>
                </motion.div>
              )}

              {view === 'forgot' && (
                <motion.div
                  key="forgot"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  data-testid="view-forgot"
                >
                  <div className="mb-6">
                    <h2 className="text-2xl font-semibold text-foreground display-serif">Recover password</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                       Enter your email to receive secure recovery instructions.
                    </p>
                  </div>

                  <Form {...forgotForm}>
                    <form onSubmit={forgotForm.handleSubmit(onForgot)} className="space-y-4">
                      <FormField
                        control={forgotForm.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                              <Input 
                                placeholder="name@redeemerhouse.org" 
                                type="email" 
                                autoCapitalize="none"
                                autoComplete="email"
                                data-testid="input-forgot-email"
                                {...field} 
                              />
                            </FormControl>
                            <FormMessage data-testid="error-forgot-email" />
                          </FormItem>
                        )}
                      />
                      <Button 
                        type="submit" 
                        className="w-full mt-2 h-11 text-base font-medium" 
                        disabled={isSubmitting}
                        data-testid="button-submit-forgot"
                      >
                        {isSubmitting ? (
                          <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending...</>
                        ) : (
                           'Send Recovery Instructions'
                        )}
                      </Button>
                    </form>
                  </Form>

                  <div className="mt-8 text-center">
                    <button
                      type="button"
                      onClick={() => setView('signin')}
                      className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                      data-testid="link-back-to-signin"
                    >
                      &larr; Back to sign in
                    </button>
                  </div>
                </motion.div>
              )}
              {view === 'verify' && (
                <motion.div key="verify" variants={containerVariants} initial="hidden" animate="visible" exit="exit" data-testid="view-verify">
                  <div className="mb-6"><h2 className="display-serif text-2xl font-semibold">Verify email</h2><p className="mt-1 text-sm text-muted-foreground">Paste the one-time code from your verification email.</p></div>
                  <Form {...verifyForm}><form onSubmit={verifyForm.handleSubmit(onVerify)} className="space-y-4">
                    <FormField control={verifyForm.control} name="token" render={({ field }) => <FormItem><FormLabel>Verification code</FormLabel><FormControl><Input autoComplete="one-time-code" data-testid="input-verification-code" {...field} /></FormControl><FormMessage /></FormItem>} />
                    <Button type="submit" className="h-11 w-full" disabled={isSubmitting} data-testid="button-submit-verification">{isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Verifying...</> : 'Verify Email'}</Button>
                  </form></Form>
                  <div className="my-6 border-t border-border/60" />
                  <p className="mb-3 text-sm text-muted-foreground">Didn’t receive the email? Request a new one for the account you already created.</p>
                  <Form {...resendVerificationForm}><form onSubmit={resendVerificationForm.handleSubmit(onResendVerification)} className="space-y-3">
                    <FormField control={resendVerificationForm.control} name="email" render={({ field }) => <FormItem><FormLabel>Account email</FormLabel><FormControl><Input type="email" autoComplete="email" data-testid="input-resend-verification-email" {...field} /></FormControl><FormMessage /></FormItem>} />
                    <Button type="submit" variant="outline" className="h-11 w-full" disabled={isSubmitting} data-testid="button-resend-verification">{isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Requesting...</> : 'Resend Verification Email'}</Button>
                  </form></Form>
                  <button type="button" onClick={() => setView('signin')} className="mt-8 w-full text-sm font-medium text-muted-foreground hover:text-foreground" data-testid="link-verification-back">Back to sign in</button>
                </motion.div>
              )}
              {view === 'reset' && (
                <motion.div key="reset" variants={containerVariants} initial="hidden" animate="visible" exit="exit" data-testid="view-reset">
                  <div className="mb-6"><h2 className="display-serif text-2xl font-semibold">Choose a new password</h2><p className="mt-1 text-sm text-muted-foreground">Use the one-time code from your recovery email.</p></div>
                  <Form {...resetForm}><form onSubmit={resetForm.handleSubmit(onReset)} className="space-y-4">
                    <FormField control={resetForm.control} name="token" render={({ field }) => <FormItem><FormLabel>Recovery code</FormLabel><FormControl><Input autoComplete="one-time-code" data-testid="input-recovery-code" {...field} /></FormControl><FormMessage /></FormItem>} />
                    <FormField control={resetForm.control} name="password" render={({ field }) => <FormItem><FormLabel>New password</FormLabel><FormControl><Input type="password" autoComplete="new-password" data-testid="input-new-password" {...field} /></FormControl><FormMessage /></FormItem>} />
                    <Button type="submit" className="h-11 w-full" disabled={isSubmitting} data-testid="button-submit-reset">{isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Updating...</> : 'Update Password'}</Button>
                  </form></Form>
                  <button type="button" onClick={() => setView('signin')} className="mt-8 w-full text-sm font-medium text-muted-foreground hover:text-foreground" data-testid="link-reset-back">Back to sign in</button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="mt-8 text-center text-xs text-muted-foreground flex flex-col gap-1 items-center justify-center">
            <span data-testid="text-footer-security">Secured by ONEsource Identity</span>
            <span data-testid="text-footer-copyright">&copy; {new Date().getFullYear()} Redeemer House. All rights reserved.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
