import { db, housesTable, residentsTable, paymentsTable, operationsTable, auditEventsTable } from "@workspace/db";
import { count } from "drizzle-orm";

export async function seedPilotData(): Promise<void> {
  const [{ value }] = await db.select({ value: count() }).from(housesTable);
  if (Number(value) > 0) return;
  const houses = await db.insert(housesTable).values([
    { name: "Northside House", address: "118 North Main Street", managerName: "Jordan Ellis", familyCapacity: 10 },
    { name: "Eastside House", address: "402 East Avenue", managerName: "Maya Brooks", familyCapacity: 8 },
    { name: "Southside House", address: "916 South Flores", managerName: "Chris Warren", familyCapacity: 8 },
    { name: "Westside House", address: "75 West Summit", managerName: "Sam Rivera", familyCapacity: 6 },
  ]).returning();
  const residents = await db.insert(residentsTable).values([
    { name: "Marcus Johnson", email: "marcus@example.com", phone: "(210) 555-0142", home: houses[0].name, moveInDate: "2024-09-08", nextPaymentDate: "2024-10-20", status: "active", balance: "0", notes: "Weekly check-in completed." },
    { name: "Elena Rodriguez", email: "elena@example.com", phone: "(210) 555-0188", home: houses[1].name, moveInDate: "2024-10-01", nextPaymentDate: "2024-10-20", status: "active", balance: "175", notes: "Follow up on employment milestone." },
    { name: "David Chen", email: "david@example.com", phone: "(210) 555-0116", home: houses[0].name, moveInDate: "2024-10-10", nextPaymentDate: "2024-10-20", status: "pending", balance: "0", notes: "Move-in preparation." },
  ]).returning();
  await db.insert(paymentsTable).values([
    { residentId: residents[0].id, amount: "175", dueDate: "2024-10-13", paidDate: "2024-10-12", status: "paid", method: "CashApp" },
    { residentId: residents[1].id, amount: "175", dueDate: "2024-10-13", status: "overdue", method: "External payment pending" },
    { residentId: residents[0].id, amount: "175", dueDate: "2024-10-20", status: "due", method: null },
  ]);
  await db.insert(operationsTable).values([
    { type: "ua", title: "Randomized UA window", scheduledDate: "2024-10-15", status: "open" },
    { type: "meeting", title: "House meeting · Northside", scheduledDate: "2024-10-15", status: "open" },
    { type: "milestone", title: "Review Elena's employment milestone", residentId: residents[1].id, scheduledDate: "2024-10-16", status: "open" },
  ]);
  await db.insert(auditEventsTable).values({ action: "Pilot data initialized", entityType: "system", actor: "system", metadata: { houses: 4, residents: 3 } });
}