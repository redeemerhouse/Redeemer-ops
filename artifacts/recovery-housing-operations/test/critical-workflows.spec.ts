import { expect, test } from "@playwright/test";

const email = "critical-owner@redeemer.invalid";
const password = "CriticalPassword123";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByTestId("input-email").fill(email);
  await page.getByTestId("input-password").fill(password);
  await page.getByTestId("button-submit-signin").click();
  await expect(page.getByText("Your secure workspace is ready.", { exact: true })).toBeVisible();
  await page.goto("/residents");
  await expect(page.getByTestId("text-page-title")).toBeVisible();
}

test("public account creation collects identity without access controls", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByTestId("link-register").click();
  await expect(page.getByTestId("view-register")).toBeVisible();
  await page.getByTestId("input-register-first-name").fill("Public");
  await page.getByTestId("input-register-last-name").fill("Registrant");
  await page.getByTestId("input-register-email").fill(`public-${testInfo.project.name}-${Date.now()}@redeemer.invalid`);
  await page.getByTestId("input-register-password").fill(password);
  await page.getByTestId("input-register-password-confirmation").fill(password);
  await expect(page.locator('[name="role"], [name="status"], [name="propertyId"], [name="houseIds"]')).toHaveCount(0);
  await page.getByTestId("button-submit-register").click();
  await expect(page.getByText("Account created", { exact: true })).toBeVisible();
  await expect(page.getByTestId("view-verify")).toBeVisible();
});

test("pending users stay isolated until an administrator assigns access", async ({ page }, testInfo) => {
  const pendingEmail = `browser-pending-${testInfo.project.name}@redeemer.invalid`;
  await page.goto("/");
  await page.getByTestId("input-email").fill(pendingEmail);
  await page.getByTestId("input-password").fill(password);
  await page.getByTestId("button-submit-signin").click();
  await expect(page.getByText("Awaiting Approval", { exact: true })).toBeVisible();
  await page.goto("/residents");
  await expect(page.getByText("Awaiting Approval", { exact: true })).toBeVisible();
  await expect(page.getByTestId("link-brand")).toHaveCount(0);
  await expect(page.getByText("Synthetic North Resident")).toHaveCount(0);
  await page.getByTestId("button-logout-pending").click();

  await signIn(page);
  await page.goto("/account-management");
  const accountRow = page.locator("tr").filter({ hasText: pendingEmail });
  await expect(accountRow).toBeVisible();
  await accountRow.getByRole("button", { name: "Edit access" }).click();
  await page.getByTestId("select-status").selectOption("active");
  await page.getByTestId("select-role").selectOption("program_director");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("button-submit-form").click();
  await expect(page.getByTestId("status-account-management")).toContainText("access has been updated");
  if (testInfo.project.name.includes("mobile")) {
    await page.getByTestId("button-open-menu").click();
  }
  await page.getByTestId("button-logout").click();

  await page.getByTestId("input-email").fill(pendingEmail);
  await page.getByTestId("input-password").fill(password);
  await page.getByTestId("button-submit-signin").click();
  await expect(page.getByText("Your secure workspace is ready.", { exact: true })).toBeVisible();
  await expect(page.getByTestId("link-brand")).toBeVisible();
});

test("sign-in, resident create/load/edit, document API, payment, and assessment journey", async ({ page }, testInfo) => {
  await signIn(page);

  const unique = `${testInfo.project.name}-${Date.now()}`;
  const residentName = `Browser Resident ${unique}`;
  await page.getByTestId("button-add-resident").click();
  await page.getByTestId("input-resident-name").fill(residentName);
  await page.getByTestId("input-resident-email").fill(`${unique}@critical.invalid`);
  await page.getByTestId("input-resident-phone").fill("555-0333");
  await page.getByTestId("input-resident-home").fill("North Test House");
  await page.getByTestId("input-resident-move-in").fill("2026-08-10");
  await page.getByTestId("button-submit-form").click();
  await expect(page.getByText(residentName)).toBeVisible();

  await page.getByText(residentName).click();
  await expect(page.getByTestId("text-resident-name")).toHaveText(residentName);
  const residentId = Number(new URL(page.url()).pathname.split("/").pop());

  await page.getByTestId("button-edit-resident").click();
  await page.getByTestId("input-detail-phone").fill("555-0444");
  await page.getByTestId("select-detail-status").selectOption("active");
  await page.getByTestId("button-submit-form").click();
  await expect(page.getByText("555-0444")).toBeVisible();

  const document = await page.evaluate(async ({ unique, residentId }) => {
    const response = await fetch("/api/documents", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
      title: `Browser agreement ${unique}`,
      category: "agreement",
      residentId,
      visibility: "resident",
      objectPath: `/objects/browser-critical/${unique}`,
      fileName: "agreement.pdf",
      contentType: "application/pdf",
      fileSize: 1024,
      }),
    });
    return { status: response.status, body: await response.json() };
  }, { unique, residentId });
  expect(document.status).toBe(201);
  const history = await page.evaluate(async (documentId) => {
    const response = await fetch(`/api/documents/${documentId}/history`, { credentials: "include" });
    return { status: response.status, body: await response.json() };
  }, document.body.id);
  expect(history.status).toBe(200);
  expect(history.body.map((entry: { action: string }) => entry.action)).toContain("uploaded");

  await page.goto("/payments");
  await page.getByTestId("button-record-payment").click();
  await page.getByTestId("input-payment-resident-search").fill(residentName);
  await page.getByTestId("select-payment-resident").selectOption(String(residentId));
  await page.getByTestId("input-payment-amount").fill("35.00");
  await page.getByTestId("input-payment-due-date").fill("2026-08-10");
  await page.getByTestId("button-submit-form").click();
  await expect(page.getByText(residentName)).toBeVisible();

  await page.goto(`/residents/${residentId}`);
  await page.getByTestId("tab-resident-assessments").click();
  await page.getByTestId("button-start-assessment").click();
  const templateButton = page.locator('[data-testid^="button-template-"]').first();
  await expect(templateButton).toBeVisible();
  await templateButton.click();
  await page.getByTestId("button-confirm-start-assessment").click();
  await expect(page.getByTestId("button-submit-assessment")).toBeVisible();
  await page.getByTestId("button-submit-assessment").click();
  await expect(page.getByTestId("error-assessment-recoveryStrength")).toBeVisible();
  await page.getByTestId("input-assessment-recoveryStrength").fill("Stable housing and peer support");
  await page.getByTestId("button-submit-assessment").click();
  await expect(page.getByText("Submitted")).toBeVisible();
});

test("expired session and API network failure keep sensitive records hidden", async ({ page }) => {
  await signIn(page);
  await page.context().clearCookies();
  await page.route("**/api/auth/session", (route) => route.abort("failed"));
  await page.reload();
  await expect(page.getByText("We couldn’t verify access")).toBeVisible();
  await expect(page.getByText("Synthetic North Resident")).toHaveCount(0);
});