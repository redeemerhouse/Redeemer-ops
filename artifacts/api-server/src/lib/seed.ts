import {
  applicationsTable,
  assessmentSubmissionsTable,
  assessmentTemplatesTable,
  authAccountHousesTable,
  authAccountsTable,
  authActionTokensTable,
  authSessionsTable,
  auditEventsTable,
  db,
  deletionQuarantinesTable,
  documentHistoryTable,
  documentsTable,
  expensesTable,
  housesTable,
  incomeRecordsTable,
  legalHoldsTable,
  meetingAttendanceTable,
  operationsTable,
  paymentsTable,
  residentImportBatchesTable,
  residentImportRowsTable,
  residentsTable,
} from "@workspace/db";
import { count, sql } from "drizzle-orm";
import { assertEnvironmentContract } from "./environment";

const assessmentTemplateSeeds = [
  {
    slug: "recovery-wellness-assessment",
    title: "Recovery Wellness Assessment",
    description: "A private check-in to help the care team understand how recovery is progressing and where support is needed.",
    category: "resident",
    audience: "resident",
    sensitivity: "sensitive",
    version: 1,
    schema: [
      { id: "wellness", title: "Wellness check-in", instructions: "Answer honestly. Your responses are shared only with authorized recovery staff.", fields: [
        { id: "checkInDate", label: "Check-in date", type: "date", required: true, sensitive: false },
        { id: "overallWellness", label: "How are you feeling overall today?", type: "select", required: true, sensitive: true, options: ["Great", "Good", "Okay", "Struggling", "In crisis"] },
        { id: "wellnessNotes", label: "Tell us more about how you are doing", type: "long_text", required: false, sensitive: true, helpText: "Share what feels important, including wins or concerns." },
        { id: "needsSupport", label: "Would you like someone from the team to follow up?", type: "yes_no", required: true, sensitive: true },
        { id: "supportAreas", label: "What would be helpful right now?", type: "checklist", required: false, sensitive: true, options: ["A conversation", "Recovery meeting support", "Treatment coordination", "Medication support", "Employment or education support", "Something else"] },
      ] },
      { id: "safety", title: "Safety and support", instructions: "This section helps us respond to immediate needs.", fields: [
        { id: "safeToday", label: "Do you feel safe where you are today?", type: "yes_no", required: true, sensitive: true },
        { id: "safetyPlan", label: "What helps you stay connected to your recovery?", type: "long_text", required: true, sensitive: true },
        { id: "acknowledgment", label: "I have answered these questions truthfully.", type: "acknowledgment", required: true, sensitive: false, helpText: "Type your full name to acknowledge." },
      ] },
    ],
  },
  {
    slug: "weekly-accountability",
    title: "Weekly Accountability",
    description: "A short weekly reflection on commitments, meetings, and the next step in your recovery.",
    category: "resident",
    audience: "resident",
    sensitivity: "sensitive",
    version: 1,
    schema: [
      { id: "week", title: "This week", instructions: "Reflect on the past seven days.", fields: [
        { id: "weekEnding", label: "Week ending", type: "date", required: true, sensitive: false },
        { id: "meetings", label: "Which supports did you use this week?", type: "checklist", required: true, sensitive: true, options: ["House meeting", "Recovery meeting", "Counseling or treatment", "Sponsor or mentor", "Peer support"] },
        { id: "commitments", label: "What commitments did you complete?", type: "long_text", required: true, sensitive: true },
        { id: "challenges", label: "What was challenging?", type: "long_text", required: false, sensitive: true },
        { id: "nextStep", label: "What is your next step?", type: "short_text", required: true, sensitive: true },
      ] },
      { id: "review", title: "Team review", instructions: "Your house team can use this to plan a helpful follow-up.", fields: [
        { id: "followUp", label: "Would you like a check-in this week?", type: "yes_no", required: true, sensitive: true },
        { id: "signature", label: "Resident acknowledgment", type: "acknowledgment", required: true, sensitive: false, helpText: "Type your full name." },
      ] },
    ],
  },
  {
    slug: "application",
    title: "Application",
    description: "The Redeemer House application for prospective residents, including household, referral, and recovery information.",
    category: "resident",
    audience: "resident",
    sensitivity: "sensitive",
    version: 1,
    schema: [
      { id: "about", title: "About you", instructions: "Please provide current information so our team can prepare for your application.", fields: [
        { id: "preferredName", label: "Preferred name", type: "short_text", required: true, sensitive: false },
        { id: "dateOfBirth", label: "Date of birth", type: "date", required: true, sensitive: true },
        { id: "phone", label: "Phone number", type: "short_text", required: true, sensitive: true },
        { id: "email", label: "Email address", type: "short_text", required: true, sensitive: true },
        { id: "familyMembers", label: "Household members", type: "repeating_group", required: false, sensitive: true, itemFields: [
          { id: "name", label: "Name", type: "short_text", required: true, sensitive: true },
          { id: "relationship", label: "Relationship", type: "short_text", required: true, sensitive: true },
        ] },
      ] },
      { id: "recovery", title: "Recovery history", instructions: "These questions help us understand the support that will serve you best.", fields: [
        { id: "referralSource", label: "How did you hear about Redeemer House?", type: "select", required: true, sensitive: false, options: ["Recovery program", "Friend or family", "Website or social media", "Community partner", "Other"] },
        { id: "treatmentHistory", label: "Tell us about your treatment or recovery history.", type: "long_text", required: true, sensitive: true },
        { id: "currentSupport", label: "What support are you currently connected to?", type: "long_text", required: false, sensitive: true },
        { id: "applicationAgreement", label: "I understand that submitting this application does not guarantee placement.", type: "acknowledgment", required: true, sensitive: false, helpText: "Type your full name." },
      ] },
    ],
  },
  {
    slug: "child-safety-training",
    title: "Redeemer House Childcare Volunteers Child Safety Training Pamphlet",
    description: "Staff and volunteer training acknowledgment for safe childcare practices.",
    category: "staff_volunteer",
    audience: "staff",
    sensitivity: "restricted",
    version: 1,
    schema: [
      { id: "training", title: "Child safety training", instructions: "Review the training materials before completing this record. This restricted record is visible only to authorized staff.", fields: [
        { id: "trainingDate", label: "Training date", type: "date", required: true, sensitive: true },
        { id: "topicsReviewed", label: "Topics reviewed", type: "checklist", required: true, sensitive: true, options: ["Supervision and ratios", "Boundaries and appropriate contact", "Recognizing and reporting concerns", "Emergency procedures", "Check-in and check-out"] },
        { id: "questions", label: "Questions or follow-up needed", type: "long_text", required: false, sensitive: true },
        { id: "trainingAcknowledgment", label: "I completed and understood this child safety training.", type: "acknowledgment", required: true, sensitive: true, helpText: "Type your full name." },
      ] },
    ],
  },
  {
    slug: "volunteer-application-agreement",
    title: "Redeemer House Volunteer Application & Agreement",
    description: "Volunteer application and service agreement for the Redeemer House team.",
    category: "staff_volunteer",
    audience: "staff",
    sensitivity: "restricted",
    version: 1,
    schema: [
      { id: "volunteer", title: "Volunteer application", instructions: "This restricted form is for staff and approved volunteers.", fields: [
        { id: "fullName", label: "Full name", type: "short_text", required: true, sensitive: true },
        { id: "availability", label: "Preferred service times", type: "checklist", required: true, sensitive: false, options: ["Weekday mornings", "Weekday evenings", "Saturday", "Sunday"] },
        { id: "interests", label: "How would you like to serve?", type: "checklist", required: true, sensitive: false, options: ["Childcare", "House support", "Mentoring", "Events", "Administrative support", "Other"] },
        { id: "experience", label: "Relevant experience", type: "long_text", required: false, sensitive: true },
        { id: "agreement", label: "I agree to follow Redeemer House policies and protect resident privacy.", type: "acknowledgment", required: true, sensitive: true, helpText: "Type your full name." },
      ] },
    ],
  },
] as const;

async function ensureAssessmentTemplates(transaction: Parameters<Parameters<typeof db.transaction>[0]>[0]): Promise<void> {
  for (const template of assessmentTemplateSeeds) {
    await transaction.insert(assessmentTemplatesTable)
      .values(template)
      .onConflictDoNothing({
        target: [assessmentTemplatesTable.slug, assessmentTemplatesTable.version],
      });
  }
}

export async function seedPilotData(): Promise<void> {
  const contract = assertEnvironmentContract();
  if (
    contract.databaseTarget !== "disposable-test" ||
    (contract.appEnvironment !== "development" &&
      contract.appEnvironment !== "test") ||
    process.env.ALLOW_PILOT_SEED !== "true" ||
    process.env.PILOT_SEED_CONFIRMATION !==
      "synthetic-only-disposable-target"
  ) {
    throw new Error(
      "Pilot seed is disabled. It requires an explicitly confirmed disposable test target and synthetic-only confirmation.",
    );
  }
  await db.transaction(async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext('redeemer-house-pilot-seed'))`);
    const businessCounts = await Promise.all([
      transaction.select({ value: count() }).from(housesTable),
      transaction.select({ value: count() }).from(residentsTable),
      transaction.select({ value: count() }).from(paymentsTable),
      transaction.select({ value: count() }).from(operationsTable),
      transaction.select({ value: count() }).from(auditEventsTable),
      transaction.select({ value: count() }).from(assessmentTemplatesTable),
      transaction.select({ value: count() }).from(applicationsTable),
      transaction.select({ value: count() }).from(documentsTable),
      transaction.select({ value: count() }).from(documentHistoryTable),
      transaction.select({ value: count() }).from(residentImportBatchesTable),
      transaction.select({ value: count() }).from(residentImportRowsTable),
      transaction.select({ value: count() }).from(assessmentSubmissionsTable),
      transaction.select({ value: count() }).from(meetingAttendanceTable),
      transaction.select({ value: count() }).from(expensesTable),
      transaction.select({ value: count() }).from(incomeRecordsTable),
      transaction.select({ value: count() }).from(authAccountsTable),
      transaction.select({ value: count() }).from(authAccountHousesTable),
      transaction.select({ value: count() }).from(authSessionsTable),
      transaction.select({ value: count() }).from(authActionTokensTable),
      transaction.select({ value: count() }).from(deletionQuarantinesTable),
      transaction.select({ value: count() }).from(legalHoldsTable),
    ]);
    if (businessCounts.some(([row]) => Number(row.value) > 0)) {
      throw new Error(
        "Pilot seed refused because the disposable target is not empty.",
      );
    }
    await ensureAssessmentTemplates(transaction);
    const houses = await transaction.insert(housesTable).values([
    { name: "Synthetic Northside House", address: "Synthetic fixture address 1", managerName: "Synthetic Manager 1", familyCapacity: 10 },
    { name: "Synthetic Eastside House", address: "Synthetic fixture address 2", managerName: "Synthetic Manager 2", familyCapacity: 8 },
    { name: "Synthetic Southside House", address: "Synthetic fixture address 3", managerName: "Synthetic Manager 3", familyCapacity: 8 },
    { name: "Synthetic Westside House", address: "Synthetic fixture address 4", managerName: "Synthetic Manager 4", familyCapacity: 6 },
  ]).returning();
    const residents = await transaction.insert(residentsTable).values([
    { name: "Synthetic Resident One", email: "synthetic.resident.one@redeemer.invalid", phone: "555-0101", home: houses[0].name, moveInDate: "2024-09-08", nextPaymentDate: "2024-10-20", status: "active", balance: "0", notes: "Synthetic fixture only." },
    { name: "Synthetic Resident Two", email: "synthetic.resident.two@redeemer.invalid", phone: "555-0102", home: houses[1].name, moveInDate: "2024-10-01", nextPaymentDate: "2024-10-20", status: "active", balance: "175", notes: "Synthetic fixture only." },
    { name: "Synthetic Resident Three", email: "synthetic.resident.three@redeemer.invalid", phone: "555-0103", home: houses[0].name, moveInDate: "2024-10-10", nextPaymentDate: "2024-10-20", status: "pending", balance: "0", notes: "Synthetic fixture only." },
  ]).returning();
    await transaction.insert(paymentsTable).values([
    { residentId: residents[0].id, amount: "175", dueDate: "2024-10-13", paidDate: "2024-10-12", status: "paid", method: "CashApp" },
    { residentId: residents[1].id, amount: "175", dueDate: "2024-10-13", status: "overdue", method: "External payment pending" },
    { residentId: residents[0].id, amount: "175", dueDate: "2024-10-20", status: "due", method: null },
  ]);
    await transaction.insert(operationsTable).values([
    { type: "ua", title: "Randomized UA window", scheduledDate: "2024-10-15", status: "open" },
     { type: "meeting", title: "Synthetic house meeting", scheduledDate: "2024-10-15", status: "open" },
     { type: "milestone", title: "Review synthetic milestone", residentId: residents[1].id, scheduledDate: "2024-10-16", status: "open" },
  ]);
    await transaction.insert(auditEventsTable).values({ action: "Synthetic pilot data initialized", entityType: "system", actor: "system", metadata: { synthetic: true, houses: 4, residents: 3 } });
  });
}