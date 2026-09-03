const ignoredTables = new Set(["__drizzle_migrations"]);

type SnapshotColumn = {
  name: string;
  type: string;
  primaryKey?: boolean;
  notNull?: boolean;
  default?: string | number | boolean;
};

type SnapshotIndex = {
  name: string;
  columns: Array<{
    expression: string;
    isExpression: boolean;
    asc: boolean;
    nulls: string;
  }>;
  isUnique: boolean;
  method: string;
  where?: string;
  with?: Record<string, string>;
};

type SnapshotForeignKey = {
  name: string;
  tableFrom: string;
  tableTo: string;
  columnsFrom: string[];
  columnsTo: string[];
  onDelete: string;
  onUpdate: string;
};

type SnapshotPolicy = {
  name: string;
  as?: "PERMISSIVE" | "RESTRICTIVE";
  for?: "ALL" | "SELECT" | "INSERT" | "UPDATE" | "DELETE";
  to?: string[];
  using?: string;
  withCheck?: string;
};

type SnapshotTable = {
  name: string;
  schema?: string;
  columns: Record<string, SnapshotColumn>;
  indexes?: Record<string, SnapshotIndex>;
  foreignKeys?: Record<string, SnapshotForeignKey>;
  compositePrimaryKeys?: Record<string, { name: string; columns: string[] }>;
  uniqueConstraints?: Record<
    string,
    { name: string; nullsNotDistinct?: boolean; columns: string[] }
  >;
  checkConstraints?: Record<string, { name: string; value: string }>;
  policies?: Record<string, SnapshotPolicy>;
  isRLSEnabled?: boolean;
};

export type DrizzleSnapshot = {
  tables: Record<string, SnapshotTable>;
};

type LiveColumn = {
  name: string;
  type: string;
  primaryKey: boolean;
  notNull: boolean;
  defaultExpression: string | null;
};

type LiveIndex = {
  name: string;
  columns: Array<{
    expression: string;
    isExpression: boolean;
    asc: boolean;
    nulls: string;
  }>;
  isUnique: boolean;
  method: string;
  where: string | null;
  with: Record<string, string>;
};

type LiveForeignKey = {
  name: string;
  columnsFrom: string[];
  columnsTo: string[];
  tableTo: string;
  onDelete: string;
  onUpdate: string;
  validated: boolean;
  deferrable: boolean;
  initiallyDeferred: boolean;
};

type LiveTable = {
  columns: Record<string, LiveColumn>;
  indexes: Record<string, LiveIndex>;
  foreignKeys: Record<string, LiveForeignKey>;
  uniqueConstraints: Record<
    string,
    { name: string; columns: string[]; nullsNotDistinct: boolean }
  >;
  checkConstraints: Record<string, { name: string; definition: string }>;
  policies: Record<
    string,
    {
      name: string;
      as: string;
      for: string;
      to: string[];
      using: string | null;
      withCheck: string | null;
    }
  >;
  isRLSEnabled: boolean;
};

export type LiveSchema = {
  tables: Record<string, LiveTable>;
};

type Queryable = {
  query<T>(text: string): Promise<{ rows: T[] }>;
};

type TableRow = {
  schema_name: string;
  table_name: string;
  rls_enabled: boolean;
};

type ColumnRow = {
  schema_name: string;
  table_name: string;
  column_name: string;
  type_name: string;
  primary_key: boolean;
  not_null: boolean;
  column_default: string | null;
};

type IndexRow = {
  schema_name: string;
  table_name: string;
  index_name: string;
  is_unique: boolean;
  method: string;
  where_expression: string | null;
  index_columns: LiveIndex["columns"];
  options: string[] | string | null;
};

type ForeignKeyRow = {
  schema_name: string;
  table_name: string;
  constraint_name: string;
  columns_from: string[] | string;
  columns_to: string[] | string;
  referenced_schema: string;
  referenced_table: string;
  on_delete: string;
  on_update: string;
  validated: boolean;
  deferrable: boolean;
  initially_deferred: boolean;
};

type UniqueConstraintRow = {
  schema_name: string;
  table_name: string;
  constraint_name: string;
  columns: string[] | string;
  nulls_not_distinct: boolean;
};

type CheckConstraintRow = {
  schema_name: string;
  table_name: string;
  constraint_name: string;
  definition: string;
};

type PolicyRow = {
  schema_name: string;
  table_name: string;
  policy_name: string;
  policy_as: string;
  policy_for: string;
  policy_to: string[] | string;
  using_expression: string | null;
  with_check_expression: string | null;
};

const tableKey = (schemaName: string, tableName: string): string =>
  `${schemaName}.${tableName}`;

const isIgnoredTable = (schemaName: string, tableName: string): boolean =>
  ignoredTables.has(tableName);

const stripOuterParentheses = (value: string): string => {
  let normalized = value;
  while (normalized.startsWith("(") && normalized.endsWith(")")) {
    let depth = 0;
    let wrapsEntireValue = true;
    for (let index = 0; index < normalized.length; index += 1) {
      if (normalized[index] === "(") depth += 1;
      if (normalized[index] === ")") depth -= 1;
      if (depth === 0 && index < normalized.length - 1) {
        wrapsEntireValue = false;
        break;
      }
    }
    if (!wrapsEntireValue) break;
    normalized = normalized.slice(1, -1);
  }
  return normalized;
};

const normalizeSql = (value: string): string =>
  stripOuterParentheses(
    value
      .toLowerCase()
      .replaceAll('"', "")
      .replace(/\b[a-z_][a-z_0-9]*\./g, "")
      .replace(/\s+/g, "")
      .replace(/::[a-z_][a-z_0-9]*(\([^)]+\))?/g, "")
      .replace(/\binterval(?=')/g, ""),
  );

const normalizeDefault = (value: string | number | boolean): string =>
  normalizeSql(String(value));

export const normalizeCheck = (value: string): string => {
  let normalized = stripOuterParentheses(
    normalizeSql(
      value
        .replace(/\band\b/gi, "__logical_and__")
        .replace(/\bor\b/gi, "__logical_or__"),
    ).replace(/^check/, ""),
  ).replace(/([a-z_][a-z_0-9]*)in\(([^()]*)\)/g, "$1=any(array[$2])");

  let previous: string;
  do {
    previous = normalized;
    normalized = normalized.replace(/\(([^()]*)\)/g, (match, inner: string) =>
      inner.includes("__logical_") ? match : inner,
    );
  } while (normalized !== previous);

  return stripOuterParentheses(normalized)
    .replaceAll("__logical_and__", "and")
    .replaceAll("__logical_or__", "or");
};

const normalizeType = (value: string): string =>
  value.toLowerCase().replace(/\s+/g, "");

const parsePostgresTextArray = (value: string[] | string): string[] => {
  if (Array.isArray(value)) return value;
  if (value === "{}") return [];
  return value.slice(1, -1).split(",");
};

const parseIndexOptions = (
  value: string[] | string | null,
): Record<string, string> =>
  Object.fromEntries(
    (value === null ? [] : parsePostgresTextArray(value)).map((option) => {
      const separator = option.indexOf("=");
      return separator === -1
        ? [option, "true"]
        : [option.slice(0, separator), option.slice(separator + 1)];
    }),
  );

const normalizeIndexColumns = (
  columns: Array<{
    expression: string;
    isExpression: boolean;
    asc: boolean;
    nulls: string;
  }>,
): string =>
  JSON.stringify(
    columns.map((column) => ({
      expression: normalizeSql(column.expression),
      isExpression: column.isExpression,
      asc: column.asc,
      nulls: column.nulls,
    })),
  );

const expectedTableName = (
  snapshotKey: string,
  table: SnapshotTable,
): string => {
  if (snapshotKey.includes(".")) return snapshotKey;
  return tableKey(table.schema || "public", table.name);
};

export const inspectDatabaseSchema = async (
  database: Queryable,
): Promise<LiveSchema> => {
  const [
    tableResult,
    columnResult,
    indexResult,
    foreignKeyResult,
    uniqueConstraintResult,
    checkConstraintResult,
    policyResult,
  ] = await Promise.all([
    database.query<TableRow>(`
      SELECT
        n.nspname AS schema_name,
        c.relname AS table_name,
        c.relrowsecurity AS rls_enabled
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p', 'f')
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname NOT LIKE 'pg_%'
        AND NOT (n.nspname = 'public' AND c.relname = '__drizzle_migrations')
    `),
    database.query<ColumnRow>(`
      SELECT
        n.nspname AS schema_name,
        c.relname AS table_name,
        a.attname AS column_name,
        pg_catalog.format_type(a.atttypid, a.atttypmod) AS type_name,
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_constraint pk
          WHERE pk.conrelid = c.oid
            AND pk.contype = 'p'
            AND a.attnum = ANY(pk.conkey)
        ) AS primary_key,
        a.attnotnull AS not_null,
        pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS column_default
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_catalog.pg_attrdef d
        ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attnum > 0
        AND NOT a.attisdropped
        AND c.relkind IN ('r', 'p', 'f')
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname NOT LIKE 'pg_%'
        AND NOT (n.nspname = 'public' AND c.relname = '__drizzle_migrations')
      ORDER BY n.nspname, c.relname, a.attnum
    `),
    database.query<IndexRow>(`
      SELECT
        n.nspname AS schema_name,
        t.relname AS table_name,
        i.relname AS index_name,
        ix.indisunique AS is_unique,
        am.amname AS method,
        i.reloptions AS options,
        pg_catalog.pg_get_expr(ix.indpred, ix.indrelid) AS where_expression,
        json_agg(
          json_build_object(
            'expression',
            CASE
              WHEN ix.indkey[key.position] > 0 THEN attribute.attname
              ELSE pg_catalog.pg_get_indexdef(ix.indexrelid, key.position, true)
            END,
            'isExpression', ix.indkey[key.position] = 0,
            'asc', (ix.indoption[key.position] & 1) = 0,
            'nulls', CASE
              WHEN (ix.indoption[key.position] & 2) <> 0 THEN 'first'
              ELSE 'last'
            END
          )
          ORDER BY key.position
        ) AS index_columns
      FROM pg_catalog.pg_index ix
      JOIN pg_catalog.pg_class i ON i.oid = ix.indexrelid
      JOIN pg_catalog.pg_class t ON t.oid = ix.indrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_catalog.pg_am am ON am.oid = i.relam
      LEFT JOIN pg_catalog.pg_constraint constraint_index
        ON constraint_index.conindid = i.oid
      CROSS JOIN LATERAL generate_subscripts(ix.indkey, 1) key(position)
      LEFT JOIN pg_catalog.pg_attribute attribute
        ON attribute.attrelid = t.oid
        AND attribute.attnum = ix.indkey[key.position]
      WHERE i.relkind = 'i'
        AND NOT ix.indisprimary
        AND constraint_index.oid IS NULL
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname NOT LIKE 'pg_%'
        AND NOT (n.nspname = 'public' AND t.relname = '__drizzle_migrations')
      GROUP BY n.nspname, t.relname, i.relname, ix.indisunique,
        am.amname, i.reloptions, ix.indpred, ix.indrelid, ix.indexrelid
    `),
    database.query<ForeignKeyRow>(`
      SELECT
        n.nspname AS schema_name,
        source.relname AS table_name,
        constraint_row.conname AS constraint_name,
        ARRAY(
          SELECT source_attribute.attname
          FROM unnest(constraint_row.conkey) WITH ORDINALITY AS source_key(attnum, position)
          JOIN pg_catalog.pg_attribute source_attribute
            ON source_attribute.attrelid = source.oid
            AND source_attribute.attnum = source_key.attnum
          ORDER BY source_key.position
        ) AS columns_from,
        ARRAY(
          SELECT target_attribute.attname
          FROM unnest(constraint_row.confkey) WITH ORDINALITY AS target_key(attnum, position)
          JOIN pg_catalog.pg_attribute target_attribute
            ON target_attribute.attrelid = target.oid
            AND target_attribute.attnum = target_key.attnum
          ORDER BY target_key.position
        ) AS columns_to,
        target_namespace.nspname AS referenced_schema,
        target.relname AS referenced_table,
        CASE constraint_row.confdeltype
          WHEN 'a' THEN 'no action'
          WHEN 'r' THEN 'restrict'
          WHEN 'c' THEN 'cascade'
          WHEN 'n' THEN 'set null'
          WHEN 'd' THEN 'set default'
        END AS on_delete,
        CASE constraint_row.confupdtype
          WHEN 'a' THEN 'no action'
          WHEN 'r' THEN 'restrict'
          WHEN 'c' THEN 'cascade'
          WHEN 'n' THEN 'set null'
          WHEN 'd' THEN 'set default'
        END AS on_update,
        constraint_row.convalidated AS validated,
        constraint_row.condeferrable AS deferrable,
        constraint_row.condeferred AS initially_deferred
      FROM pg_catalog.pg_constraint constraint_row
      JOIN pg_catalog.pg_class source ON source.oid = constraint_row.conrelid
      JOIN pg_catalog.pg_class target ON target.oid = constraint_row.confrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = source.relnamespace
      JOIN pg_catalog.pg_namespace target_namespace
        ON target_namespace.oid = target.relnamespace
      WHERE constraint_row.contype = 'f'
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname NOT LIKE 'pg_%'
        AND NOT (n.nspname = 'public' AND source.relname = '__drizzle_migrations')
    `),
    database.query<UniqueConstraintRow>(`
      SELECT
        n.nspname AS schema_name,
        source.relname AS table_name,
        constraint_row.conname AS constraint_name,
        ARRAY(
          SELECT attribute.attname
          FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key(attnum, position)
          JOIN pg_catalog.pg_attribute attribute
            ON attribute.attrelid = source.oid
            AND attribute.attnum = key.attnum
          ORDER BY key.position
        ) AS columns
        , COALESCE(constraint_index.indnullsnotdistinct, false) AS nulls_not_distinct
      FROM pg_catalog.pg_constraint constraint_row
      JOIN pg_catalog.pg_class source ON source.oid = constraint_row.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = source.relnamespace
      LEFT JOIN pg_catalog.pg_index constraint_index
        ON constraint_index.indexrelid = constraint_row.conindid
      WHERE constraint_row.contype = 'u'
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname NOT LIKE 'pg_%'
        AND NOT (n.nspname = 'public' AND source.relname = '__drizzle_migrations')
    `),
    database.query<CheckConstraintRow>(`
      SELECT
        n.nspname AS schema_name,
        source.relname AS table_name,
        constraint_row.conname AS constraint_name,
        pg_catalog.pg_get_constraintdef(constraint_row.oid) AS definition
      FROM pg_catalog.pg_constraint constraint_row
      JOIN pg_catalog.pg_class source ON source.oid = constraint_row.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = source.relnamespace
      WHERE constraint_row.contype = 'c'
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname NOT LIKE 'pg_%'
        AND NOT (n.nspname = 'public' AND source.relname = '__drizzle_migrations')
    `),
    database.query<PolicyRow>(`
      SELECT
        n.nspname AS schema_name,
        source.relname AS table_name,
        policy.polname AS policy_name,
        CASE WHEN policy.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END AS policy_as,
        CASE policy.polcmd
          WHEN '*' THEN 'ALL'
          WHEN 'r' THEN 'SELECT'
          WHEN 'a' THEN 'INSERT'
          WHEN 'w' THEN 'UPDATE'
          WHEN 'd' THEN 'DELETE'
        END AS policy_for,
        ARRAY(
          SELECT CASE
            WHEN role_id = 0 THEN 'public'
            ELSE role.rolname
          END
          FROM unnest(policy.polroles) AS role_id
          LEFT JOIN pg_catalog.pg_roles role ON role.oid = role_id
          ORDER BY 1
        ) AS policy_to,
        pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) AS using_expression,
        pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid) AS with_check_expression
      FROM pg_catalog.pg_policy policy
      JOIN pg_catalog.pg_class source ON source.oid = policy.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = source.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname NOT LIKE 'pg_%'
        AND NOT (n.nspname = 'public' AND source.relname = '__drizzle_migrations')
    `),
  ]);

  const tables: Record<string, LiveTable> = {};
  for (const row of tableResult.rows) {
    if (!isIgnoredTable(row.schema_name, row.table_name)) {
      tables[tableKey(row.schema_name, row.table_name)] = {
        columns: {},
        indexes: {},
        foreignKeys: {},
        uniqueConstraints: {},
        checkConstraints: {},
        policies: {},
        isRLSEnabled: row.rls_enabled,
      };
    }
  }

  const getTable = (
    schemaName: string,
    tableName: string,
  ): LiveTable | undefined => tables[tableKey(schemaName, tableName)];

  for (const row of columnResult.rows) {
    const table = getTable(row.schema_name, row.table_name);
    if (!table) continue;
    table.columns[row.column_name] = {
      name: row.column_name,
      type:
        row.type_name === "integer" &&
        row.column_default?.startsWith("nextval(")
          ? "serial"
          : row.type_name,
      primaryKey: row.primary_key,
      notNull: row.not_null,
      defaultExpression: row.column_default,
    };
  }
  for (const row of indexResult.rows) {
    const table = getTable(row.schema_name, row.table_name);
    if (!table) continue;
    table.indexes[row.index_name] = {
      name: row.index_name,
      columns: row.index_columns,
      isUnique: row.is_unique,
      method: row.method,
      where: row.where_expression,
      with: parseIndexOptions(row.options),
    };
  }
  for (const row of foreignKeyResult.rows) {
    const table = getTable(row.schema_name, row.table_name);
    if (!table) continue;
    table.foreignKeys[row.constraint_name] = {
      name: row.constraint_name,
      columnsFrom: parsePostgresTextArray(row.columns_from),
      columnsTo: parsePostgresTextArray(row.columns_to),
      tableTo: tableKey(row.referenced_schema, row.referenced_table),
      onDelete: row.on_delete,
      onUpdate: row.on_update,
      validated: row.validated,
      deferrable: row.deferrable,
      initiallyDeferred: row.initially_deferred,
    };
  }
  for (const row of uniqueConstraintResult.rows) {
    const table = getTable(row.schema_name, row.table_name);
    if (!table) continue;
    table.uniqueConstraints[row.constraint_name] = {
      name: row.constraint_name,
      columns: parsePostgresTextArray(row.columns),
      nullsNotDistinct: row.nulls_not_distinct,
    };
  }
  for (const row of checkConstraintResult.rows) {
    const table = getTable(row.schema_name, row.table_name);
    if (!table) continue;
    table.checkConstraints[row.constraint_name] = {
      name: row.constraint_name,
      definition: row.definition,
    };
  }
  for (const row of policyResult.rows) {
    const table = getTable(row.schema_name, row.table_name);
    if (!table) continue;
    table.policies[row.policy_name] = {
      name: row.policy_name,
      as: row.policy_as,
      for: row.policy_for,
      to: parsePostgresTextArray(row.policy_to),
      using: row.using_expression,
      withCheck: row.with_check_expression,
    };
  }

  return { tables };
};

export type SchemaDrift = {
  kind: "missing" | "unexpected" | "changed";
  object: string;
  detail: string;
};

const compareNamedObjects = (
  drift: SchemaDrift[],
  tableName: string,
  objectType: string,
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): void => {
  for (const name of Object.keys(expected)) {
    if (!Object.hasOwn(actual, name)) {
      drift.push({
        kind: "missing",
        object: `${tableName}.${objectType} ${name}`,
        detail: "missing",
      });
    }
  }
  for (const name of Object.keys(actual)) {
    if (!Object.hasOwn(expected, name)) {
      drift.push({
        kind: "unexpected",
        object: `${tableName}.${objectType} ${name}`,
        detail: "unexpected",
      });
    }
  }
};

export const findSchemaDrift = (
  snapshot: DrizzleSnapshot,
  live: LiveSchema,
): SchemaDrift[] => {
  const drift: SchemaDrift[] = [];
  const expectedTables = Object.fromEntries(
    Object.entries(snapshot.tables).map(([key, table]) => [
      expectedTableName(key, table),
      table,
    ]),
  );

  for (const name of Object.keys(expectedTables)) {
    if (!Object.hasOwn(live.tables, name)) {
      drift.push({
        kind: "missing",
        object: `table ${name}`,
        detail: "missing",
      });
    }
  }
  for (const name of Object.keys(live.tables)) {
    if (!Object.hasOwn(expectedTables, name)) {
      drift.push({
        kind: "unexpected",
        object: `table ${name}`,
        detail: "unexpected",
      });
    }
  }

  for (const [name, expected] of Object.entries(expectedTables)) {
    const actual = live.tables[name];
    if (!actual) continue;

    compareNamedObjects(
      drift,
      name,
      "column",
      expected.columns,
      actual.columns,
    );
    for (const [columnName, expectedColumn] of Object.entries(
      expected.columns,
    )) {
      const actualColumn = actual.columns[columnName];
      if (!actualColumn) continue;
      if (
        normalizeType(expectedColumn.type) !== normalizeType(actualColumn.type)
      ) {
        drift.push({
          kind: "changed",
          object: `${name}.column ${columnName}`,
          detail: "type differs",
        });
      }
      if (Boolean(expectedColumn.notNull) !== actualColumn.notNull) {
        drift.push({
          kind: "changed",
          object: `${name}.column ${columnName}`,
          detail: "nullability differs",
        });
      }
      if (Boolean(expectedColumn.primaryKey) !== actualColumn.primaryKey) {
        drift.push({
          kind: "changed",
          object: `${name}.column ${columnName}`,
          detail: "primary-key membership differs",
        });
      }
      const expectedDefault = expectedColumn.default;
      const actualDefault = actualColumn.defaultExpression;
      const expectsDefault = Object.hasOwn(expectedColumn, "default");
      const hasActualDefault = actualDefault !== null;
      if (
        expectedColumn.type !== "serial" &&
        (expectsDefault !== hasActualDefault ||
          (expectedDefault !== undefined &&
            actualDefault !== null &&
            normalizeDefault(expectedDefault) !==
              normalizeDefault(actualDefault)))
      ) {
        drift.push({
          kind: "changed",
          object: `${name}.column ${columnName}`,
          detail: "default differs",
        });
      }
    }

    const expectedIndexes = expected.indexes ?? {};
    compareNamedObjects(drift, name, "index", expectedIndexes, actual.indexes);
    for (const [indexName, expectedIndex] of Object.entries(expectedIndexes)) {
      const actualIndex = actual.indexes[indexName];
      if (!actualIndex) continue;
      const expectedShape = {
        columns: normalizeIndexColumns(expectedIndex.columns),
        isUnique: expectedIndex.isUnique,
        method: expectedIndex.method,
        where: expectedIndex.where ? normalizeSql(expectedIndex.where) : null,
        with: expectedIndex.with ?? {},
      };
      const actualShape = {
        columns: normalizeIndexColumns(actualIndex.columns),
        isUnique: actualIndex.isUnique,
        method: actualIndex.method,
        where: actualIndex.where ? normalizeSql(actualIndex.where) : null,
        with: actualIndex.with,
      };
      if (JSON.stringify(expectedShape) !== JSON.stringify(actualShape)) {
        drift.push({
          kind: "changed",
          object: `${name}.index ${indexName}`,
          detail: "definition differs",
        });
      }
    }

    const expectedForeignKeys = expected.foreignKeys ?? {};
    compareNamedObjects(
      drift,
      name,
      "foreign key",
      expectedForeignKeys,
      actual.foreignKeys,
    );
    for (const [foreignKeyName, expectedKey] of Object.entries(
      expectedForeignKeys,
    )) {
      const actualKey = actual.foreignKeys[foreignKeyName];
      if (!actualKey) continue;
      const expectedShape = {
        tableTo: tableKey(
          expectedKey.tableTo.includes(".")
            ? expectedKey.tableTo.split(".")[0]
            : "public",
          expectedKey.tableTo.includes(".")
            ? expectedKey.tableTo.split(".").slice(1).join(".")
            : expectedKey.tableTo,
        ),
        columnsFrom: expectedKey.columnsFrom,
        columnsTo: expectedKey.columnsTo,
        onDelete: expectedKey.onDelete,
        onUpdate: expectedKey.onUpdate,
        validated: true,
        deferrable: false,
        initiallyDeferred: false,
      };
      const actualShape = {
        tableTo: actualKey.tableTo,
        columnsFrom: actualKey.columnsFrom,
        columnsTo: actualKey.columnsTo,
        onDelete: actualKey.onDelete,
        onUpdate: actualKey.onUpdate,
        validated: actualKey.validated,
        deferrable: actualKey.deferrable,
        initiallyDeferred: actualKey.initiallyDeferred,
      };
      if (JSON.stringify(expectedShape) !== JSON.stringify(actualShape)) {
        drift.push({
          kind: "changed",
          object: `${name}.foreign key ${foreignKeyName}`,
          detail: "definition differs",
        });
      }
    }

    const expectedUniqueConstraints = expected.uniqueConstraints ?? {};
    compareNamedObjects(
      drift,
      name,
      "unique constraint",
      expectedUniqueConstraints,
      actual.uniqueConstraints,
    );
    for (const [constraintName, expectedConstraint] of Object.entries(
      expectedUniqueConstraints,
    )) {
      const actualConstraint = actual.uniqueConstraints[constraintName];
      if (
        actualConstraint &&
        (JSON.stringify(expectedConstraint.columns) !==
          JSON.stringify(actualConstraint.columns) ||
          Boolean(expectedConstraint.nullsNotDistinct) !==
            actualConstraint.nullsNotDistinct)
      ) {
        drift.push({
          kind: "changed",
          object: `${name}.unique constraint ${constraintName}`,
          detail: "definition differs",
        });
      }
    }

    const expectedChecks = expected.checkConstraints ?? {};
    compareNamedObjects(
      drift,
      name,
      "check constraint",
      expectedChecks,
      actual.checkConstraints,
    );
    for (const [constraintName, expectedConstraint] of Object.entries(
      expectedChecks,
    )) {
      const actualConstraint = actual.checkConstraints[constraintName];
      if (
        actualConstraint &&
        normalizeCheck(expectedConstraint.value) !==
          normalizeCheck(actualConstraint.definition)
      ) {
        drift.push({
          kind: "changed",
          object: `${name}.check constraint ${constraintName}`,
          detail: "definition differs",
        });
      }
    }
    if (Boolean(expected.isRLSEnabled) !== actual.isRLSEnabled) {
      drift.push({
        kind: "changed",
        object: `${name}.row-level security`,
        detail: "enabled state differs",
      });
    }
    const expectedPolicies = expected.policies ?? {};
    const actualPolicies = actual.policies;
    compareNamedObjects(
      drift,
      name,
      "policy",
      expectedPolicies,
      actualPolicies,
    );
    for (const [policyName, expectedPolicy] of Object.entries(
      expectedPolicies,
    )) {
      const actualPolicy = actualPolicies[policyName];
      if (!actualPolicy) continue;
      const expectedShape = {
        as: expectedPolicy.as ?? "PERMISSIVE",
        for: expectedPolicy.for ?? "ALL",
        to: [...(expectedPolicy.to ?? ["public"])].sort(),
        using: expectedPolicy.using ? normalizeSql(expectedPolicy.using) : null,
        withCheck: expectedPolicy.withCheck
          ? normalizeSql(expectedPolicy.withCheck)
          : null,
      };
      const actualShape = {
        as: actualPolicy.as,
        for: actualPolicy.for,
        to: [...actualPolicy.to].sort(),
        using: actualPolicy.using ? normalizeSql(actualPolicy.using) : null,
        withCheck: actualPolicy.withCheck
          ? normalizeSql(actualPolicy.withCheck)
          : null,
      };
      if (JSON.stringify(expectedShape) !== JSON.stringify(actualShape)) {
        drift.push({
          kind: "changed",
          object: `${name}.policy ${policyName}`,
          detail: "definition differs",
        });
      }
    }
  }

  return drift;
};

export const formatSchemaDrift = (
  drift: SchemaDrift[],
  snapshotPath: string,
): string => {
  const maxDetails = 50;
  const lines = drift
    .slice(0, maxDetails)
    .map((item) => `- ${item.kind} ${item.object} (${item.detail})`);
  if (drift.length > maxDetails) {
    lines.push(
      `- ... ${drift.length - maxDetails} additional schema difference(s) omitted`,
    );
  }
  return [
    `Schema drift detected against ${snapshotPath}:`,
    ...lines,
    "The comparison inspected PostgreSQL catalog metadata only; resident and payment row values were not read.",
    "Reconcile the target schema with the reviewed Drizzle migrations, then rerun the release check.",
  ].join("\n");
};
