import { db, housesTable, residentsTable, paymentsTable, operationsTable, auditEventsTable, assessmentTemplatesTable } from "@workspace/db";
import { count, sql } from "drizzle-orm";

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
  if (process.env.NODE_ENV === "production" || process.env.ALLOW_PILOT_SEED !== "true") {
    throw new Error("Pilot seed is disabled. Set ALLOW_PILOT_SEED=true in a non-production environment to run it explicitly.");
  }
  await db.transaction(async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext('redeemer-house-pilot-seed'))`);
    const [houseCount, residentCount, paymentCount, operationCount] = await Promise.all([
      transaction.select({ value: count() }).from(housesTable),
      transaction.select({ value: count() }).from(residentsTable),
      transaction.select({ value: count() }).from(paymentsTable),
      transaction.select({ value: count() }).from(operationsTable),
    ]);
    if ([houseCount, residentCount, paymentCount, operationCount].some(([row]) => Number(row.value) > 0)) {
      throw new Error("Pilot seed refused because business data already exists.");
    }
    await ensureAssessmentTemplates(transaction);
    const houses = await transaction.insert(housesTable).values([
    { name: "Northside House", address: "118 North Main Street", managerName: "Jordan Ellis", familyCapacity: 10 },
    { name: "Eastside House", address: "402 East Avenue", managerName: "Maya Brooks", familyCapacity: 8 },
    { name: "Southside House", address: "916 South Flores", managerName: "Chris Warren", familyCapacity: 8 },
    { name: "Westside House", address: "75 West Summit", managerName: "Sam Rivera", familyCapacity: 6 },
  ]).returning();
    const residents = await transaction.insert(residentsTable).values([
    { name: "Marcus Johnson", email: "marcus@example.com", phone: "(210) 555-0142", home: houses[0].name, moveInDate: "2024-09-08", nextPaymentDate: "2024-10-20", status: "active", balance: "0", notes: "Weekly check-in completed." },
    { name: "Elena Rodriguez", email: "elena@example.com", phone: "(210) 555-0188", home: houses[1].name, moveInDate: "2024-10-01", nextPaymentDate: "2024-10-20", status: "active", balance: "175", notes: "Follow up on employment milestone." },
    { name: "David Chen", email: "david@example.com", phone: "(210) 555-0116", home: houses[0].name, moveInDate: "2024-10-10", nextPaymentDate: "2024-10-20", status: "pending", balance: "0", notes: "Move-in preparation." },
  ]).returning();
    await transaction.insert(paymentsTable).values([
    { residentId: residents[0].id, amount: "175", dueDate: "2024-10-13", paidDate: "2024-10-12", status: "paid", method: "CashApp" },
    { residentId: residents[1].id, amount: "175", dueDate: "2024-10-13", status: "overdue", method: "External payment pending" },
    { residentId: residents[0].id, amount: "175", dueDate: "2024-10-20", status: "due", method: null },
  ]);
    await transaction.insert(operationsTable).values([
    { type: "ua", title: "Randomized UA window", scheduledDate: "2024-10-15", status: "open" },
    { type: "meeting", title: "House meeting · Northside", scheduledDate: "2024-10-15", status: "open" },
    { type: "milestone", title: "Review Elena's employment milestone", residentId: residents[1].id, scheduledDate: "2024-10-16", status: "open" },
  ]);
    await transaction.insert(auditEventsTable).values({ action: "Pilot data initialized", entityType: "system", actor: "system", metadata: { houses: 4, residents: 3 } });
  });
}