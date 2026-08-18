import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db, pool } from "./client.js";

describe("database schema", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("creates the required tables and column types", async () => {
    const result = await db.execute<{ table_name: string }>(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('users', 'documents', 'document_collaborators', 'doc_state')
      ORDER BY table_name
    `);

    expect(result.rows.map((row) => row.table_name)).toEqual([
      "doc_state",
      "document_collaborators",
      "documents",
      "users",
    ]);

    const columns = await db.execute<{
      table_name: string;
      column_name: string;
      data_type: string;
    }>(sql`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          (table_name = 'users' AND column_name = 'user_id')
          OR (table_name = 'documents' AND column_name = 'doc_id')
          OR (table_name = 'doc_state' AND column_name = 'state_update')
        )
    `);

    expect(columns.rows).toEqual(
      expect.arrayContaining([
        { table_name: "users", column_name: "user_id", data_type: "uuid" },
        { table_name: "documents", column_name: "doc_id", data_type: "uuid" },
        {
          table_name: "doc_state",
          column_name: "state_update",
          data_type: "bytea",
        },
      ]),
    );
  });

  it("enforces primary, unique, and foreign-key constraints", async () => {
    const primaryKeys = await db.execute<{ table_name: string }>(sql`
      SELECT c.relname AS table_name
      FROM pg_constraint AS con
      JOIN pg_class AS c ON c.oid = con.conrelid
      WHERE con.contype = 'p'
        AND c.relname IN ('users', 'documents', 'document_collaborators', 'doc_state')
      ORDER BY c.relname
    `);

    expect(primaryKeys.rows.map((row) => row.table_name)).toEqual([
      "doc_state",
      "document_collaborators",
      "documents",
      "users",
    ]);

    const uniqueConstraints = await db.execute<{ conname: string }>(sql`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'users'::regclass
        AND conname = 'users_email_unique'
    `);
    expect(uniqueConstraints.rows).toHaveLength(1);

    const foreignKeys = await db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count
      FROM pg_constraint AS con
      JOIN pg_class AS c ON c.oid = con.conrelid
      WHERE con.contype = 'f'
        AND c.relname IN ('documents', 'document_collaborators', 'doc_state')
    `);
    expect(foreignKeys.rows[0]?.count).toBe("4");
  });
});
