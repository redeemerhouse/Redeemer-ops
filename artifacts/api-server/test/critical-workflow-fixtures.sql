\set ON_ERROR_STOP on

INSERT INTO houses (name, address, manager_name, family_capacity)
VALUES
  ('North Test House', '100 Synthetic Way', 'Synthetic Manager', 8),
  ('South Test House', '200 Synthetic Way', 'Synthetic Manager', 8);

INSERT INTO residents (
  name, email, phone, home, move_in_date, status, balance, next_payment_date, notes, lifecycle_state
)
VALUES
  ('Synthetic North Resident', 'north-resident@critical.invalid', '555-0111', 'North Test House', '2026-07-01', 'active', 200.00, '2026-08-01', 'Synthetic fixture only', 'resident'),
  ('Synthetic South Resident', 'south-resident@critical.invalid', '555-0222', 'South Test House', '2026-07-01', 'active', 100.00, '2026-08-01', 'Synthetic fixture only', 'resident');

INSERT INTO assessment_templates (
  slug, title, description, category, audience, sensitivity, version, status, schema
)
VALUES (
  'critical-recovery-capital',
  'Recovery Capital Check-In',
  'Synthetic active template for isolated workflow tests.',
  'resident',
  'resident',
  'sensitive',
  1,
  'active',
  '[{"id":"capital","title":"Recovery capital","instructions":null,"fields":[{"id":"recoveryStrength","label":"Recovery strength","type":"short_text","required":true,"sensitive":true,"helpText":null}]}]'::jsonb
);