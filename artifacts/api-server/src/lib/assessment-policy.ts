export type AssessmentField = {
  id: string;
  label: string;
  type: string;
  required: boolean;
  itemFields?: AssessmentField[];
};

export type AssessmentSection = { fields: AssessmentField[] };
export type AssessmentSchema = AssessmentSection[];

export function missingRequired(schema: AssessmentSchema, answers: Record<string, unknown>): string[] {
  const missing: string[] = [];
  const visit = (field: AssessmentField, value: unknown, prefix = "") => {
    const label = prefix ? `${prefix}: ${field.label}` : field.label;
    const empty = value === undefined || value === null || value === "" ||
      (Array.isArray(value) && value.length === 0);
    if (field.required && empty) missing.push(label);
    if (field.type === "repeating_group" && Array.isArray(value)) {
      value.forEach((row, index) => {
        if (row && typeof row === "object") {
          for (const child of field.itemFields ?? []) {
            visit(child, (row as Record<string, unknown>)[child.id], `${field.label} ${index + 1}`);
          }
        }
      });
    }
  };
  for (const section of schema) {
    for (const field of section.fields) visit(field, answers[field.id]);
  }
  return missing;
}