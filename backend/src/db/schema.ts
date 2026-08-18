import {
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  customType,
} from "drizzle-orm/pg-core";

const binary = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const users = pgTable(
  "users",
  {
    userId: uuid("user_id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    avatar: text("avatar"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique("users_email_unique").on(table.email)],
);

export const documents = pgTable("documents", {
  docId: uuid("doc_id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.userId, { onDelete: "cascade" }),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const documentCollaborators = pgTable(
  "document_collaborators",
  {
    docId: uuid("doc_id")
      .notNull()
      .references(() => documents.docId, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.docId, table.userId] })],
);

export const docState = pgTable("doc_state", {
  docId: uuid("doc_id")
    .primaryKey()
    .references(() => documents.docId, { onDelete: "cascade" }),
  stateUpdate: binary("state_update").notNull(),
  version: integer("version").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
