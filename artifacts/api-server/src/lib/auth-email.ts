import { ReplitConnectors } from "@replit/connectors-sdk";
import { unavailable } from "./serviceFailures";

const connectors = new ReplitConnectors();
const from = process.env.AUTH_EMAIL_FROM ?? "Redeemer House <onboarding@resend.dev>";
const EMAIL_TIMEOUT_MS = 10_000;

async function withEmailTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(unavailable("email", "Transactional email is temporarily unavailable.")), EMAIL_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function sendAccountEmail(to: string, subject: string, text: string): Promise<void> {
  try {
    const response = await withEmailTimeout(
      connectors.proxy("resend", "/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject, text }),
      }),
    );
    if (!response.ok) {
      throw unavailable("email", "Transactional email is temporarily unavailable.");
    }
  } catch (error) {
    if (error instanceof Error && error.name === "ServiceFailure") throw error;
    throw unavailable("email", "Transactional email is temporarily unavailable.");
  }
}

export function sendVerificationEmail(email: string, token: string): Promise<void> {
  return sendAccountEmail(
    email,
    "Verify your Redeemer House ONEsource email",
    [
      "A Redeemer House ONEsource account request was submitted for this email address.",
      "",
      "Enter this one-time verification code in ONEsource:",
      token,
      "",
      "This code expires in 24 hours. It can be used once and is not a password.",
      "If you did not request this account, you can ignore this message.",
    ].join("\n"),
  );
}

export function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  return sendAccountEmail(
    email,
    "Reset your Redeemer House ONEsource password",
    [
      "A password reset was requested for your Redeemer House ONEsource account.",
      "",
      "Enter this one-time recovery code in ONEsource:",
      token,
      "",
      "This code expires in one hour. It can be used once.",
      "If you did not request a reset, you can ignore this message and your password will not change.",
    ].join("\n"),
  );
}