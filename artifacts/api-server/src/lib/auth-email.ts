import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();
const from = process.env.AUTH_EMAIL_FROM ?? "Redeemer House <onboarding@resend.dev>";

async function sendAccountEmail(to: string, subject: string, text: string): Promise<void> {
  const response = await connectors.proxy("resend", "/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, text }),
  });
  if (!response.ok) {
    throw new Error(`Transactional email delivery failed with status ${response.status}.`);
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