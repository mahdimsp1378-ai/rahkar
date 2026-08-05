import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Kysely, PostgresDialect, SqliteDialect, sql } from 'kysely';
import { migrateSupportV5 } from './support-schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const databaseUrl = process.env.DATABASE_URL?.trim();
export const dbKind = databaseUrl ? 'postgres' : 'sqlite';
const Database = databaseUrl ? null : (await import('better-sqlite3')).default;
const pg = databaseUrl ? (await import('pg')).default : null;

function createDatabase() {
  if (databaseUrl) {
    const hostname = new URL(databaseUrl).hostname;
    const internalHost = ['localhost', '127.0.0.1', '::1', 'db'].includes(hostname);
    const sslMode = String(process.env.DB_SSL || (internalHost ? 'false' : 'true')).toLowerCase();
    const ssl = sslMode === 'false' ? false : {
      rejectUnauthorized: true,
      ...(process.env.DB_SSL_CA_FILE ? { ca: readFileSync(resolve(process.env.DB_SSL_CA_FILE), 'utf8') } : {}),
    };
    return new Kysely({
      dialect: new PostgresDialect({
        pool: new pg.Pool({
          connectionString: databaseUrl,
          max: Number(process.env.DB_POOL_SIZE || 5),
          ssl,
        }),
      }),
    });
  }
  const fallbackFile = process.env.VERCEL
    ? '/tmp/aronage.db'
    : resolve(here, '../.data/aronage.db');
  const file = resolve(process.env.SQLITE_PATH || fallbackFile);
  mkdirSync(dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  // Favor committed-data durability over a small write-speed gain. FULL makes
  // SQLite fsync the WAL before acknowledging a successful save.
  sqlite.pragma('synchronous = FULL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('wal_autocheckpoint = 1000');
  return new Kysely({ dialect: new SqliteDialect({ database: sqlite }) });
}

export const db = createDatabase();
const nowDefault = dbKind === 'postgres' ? sql`CURRENT_TIMESTAMP::text` : sql`CURRENT_TIMESTAMP`;

async function ensureColumns(tableName, columns) {
  const tables = await db.introspection.getTables();
  const table = tables.find(item => item.name === tableName);
  const existing = new Set((table?.columns || []).map(column => column.name));
  for (const [name, type] of Object.entries(columns)) {
    if (!existing.has(name)) {
      await db.schema.alterTable(tableName).addColumn(name, type).execute();
    }
  }
}

export async function migrate() {
  await db.schema.createTable('schema_migrations').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('applied_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('users').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('mobile', 'text', col => col.notNull().unique())
    .addColumn('role', 'text', col => col.notNull().defaultTo('customer'))
    .addColumn('status', 'text', col => col.notNull().defaultTo('active'))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('profiles').ifNotExists()
    .addColumn('user_id', 'text', col => col.primaryKey().references('users.id').onDelete('cascade'))
    .addColumn('full_name', 'text')
    .addColumn('email', 'text')
    .addColumn('national_id', 'text')
    .addColumn('company', 'text')
    .addColumn('job_title', 'text')
    .addColumn('updated_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('otp_codes').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('mobile', 'text', col => col.notNull())
    .addColumn('code', 'text', col => col.notNull())
    .addColumn('expires_at', 'text', col => col.notNull())
    .addColumn('used_at', 'text')
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('sessions').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('user_id', 'text', col => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('token_hash', 'text', col => col.notNull().unique())
    .addColumn('expires_at', 'text', col => col.notNull())
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('portal_credentials').ifNotExists()
    .addColumn('user_id', 'text', col => col.primaryKey().references('users.id').onDelete('cascade'))
    .addColumn('username', 'text', col => col.notNull().unique())
    .addColumn('password_hash', 'text', col => col.notNull())
    .addColumn('must_change', 'integer', col => col.notNull().defaultTo(1))
    .addColumn('updated_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('addresses').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('user_id', 'text', col => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('title', 'text', col => col.notNull())
    .addColumn('recipient', 'text', col => col.notNull())
    .addColumn('mobile', 'text', col => col.notNull())
    .addColumn('province', 'text', col => col.notNull())
    .addColumn('city', 'text', col => col.notNull())
    .addColumn('address', 'text', col => col.notNull())
    .addColumn('postal_code', 'text')
    .addColumn('is_default', 'integer', col => col.notNull().defaultTo(0))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('orders').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('order_no', 'text', col => col.notNull().unique())
    .addColumn('user_id', 'text', col => col.notNull().references('users.id'))
    .addColumn('address_id', 'text', col => col.references('addresses.id'))
    .addColumn('status', 'text', col => col.notNull().defaultTo('pending'))
    .addColumn('subtotal', 'bigint', col => col.notNull())
    .addColumn('shipping', 'bigint', col => col.notNull().defaultTo(0))
    .addColumn('total', 'bigint', col => col.notNull())
    .addColumn('notes', 'text')
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('order_items').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('order_id', 'text', col => col.notNull().references('orders.id').onDelete('cascade'))
    .addColumn('product_id', 'text', col => col.notNull())
    .addColumn('product_name', 'text', col => col.notNull())
    .addColumn('quantity', 'integer', col => col.notNull())
    .addColumn('unit_price', 'bigint', col => col.notNull())
    .addColumn('line_total', 'bigint', col => col.notNull())
    .execute();
  await db.schema.createTable('payments').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('user_id', 'text', col => col.notNull().references('users.id'))
    .addColumn('order_id', 'text', col => col.notNull().references('orders.id'))
    .addColumn('amount', 'bigint', col => col.notNull())
    .addColumn('provider', 'text', col => col.notNull())
    .addColumn('status', 'text', col => col.notNull().defaultTo('prepared'))
    .addColumn('authority', 'text')
    .addColumn('gateway_url', 'text')
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('products').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('sku', 'text', col => col.notNull().unique())
    .addColumn('name', 'text', col => col.notNull())
    .addColumn('category', 'text', col => col.notNull())
    .addColumn('brand', 'text')
    .addColumn('description', 'text')
    .addColumn('price', 'bigint', col => col.notNull().defaultTo(0))
    .addColumn('compare_price', 'bigint')
    .addColumn('stock', 'integer', col => col.notNull().defaultTo(0))
    .addColumn('low_stock_threshold', 'integer', col => col.notNull().defaultTo(3))
    .addColumn('image_url', 'text')
    .addColumn('status', 'text', col => col.notNull().defaultTo('draft'))
    .addColumn('featured', 'integer', col => col.notNull().defaultTo(0))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .addColumn('updated_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('invoices').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('invoice_no', 'text', col => col.notNull().unique())
    .addColumn('order_id', 'text', col => col.notNull().references('orders.id').onDelete('cascade'))
    .addColumn('amount', 'bigint', col => col.notNull())
    .addColumn('status', 'text', col => col.notNull().defaultTo('issued'))
    .addColumn('issued_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .addColumn('paid_at', 'text')
    .execute();
  await db.schema.createTable('discount_codes').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('code', 'text', col => col.notNull().unique())
    .addColumn('type', 'text', col => col.notNull().defaultTo('percent'))
    .addColumn('value', 'bigint', col => col.notNull())
    .addColumn('usage_limit', 'integer')
    .addColumn('used_count', 'integer', col => col.notNull().defaultTo(0))
    .addColumn('starts_at', 'text')
    .addColumn('ends_at', 'text')
    .addColumn('status', 'text', col => col.notNull().defaultTo('active'))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('consultations').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('user_id', 'text', col => col.notNull().references('users.id'))
    .addColumn('subject', 'text', col => col.notNull())
    .addColumn('description', 'text', col => col.notNull())
    .addColumn('status', 'text', col => col.notNull().defaultTo('new'))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('engineering_service_requests').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('request_no', 'text', col => col.notNull().unique())
    .addColumn('user_id', 'text', col => col.notNull().references('users.id'))
    .addColumn('client_name', 'text', col => col.notNull())
    .addColumn('client_phone', 'text', col => col.notNull())
    .addColumn('province', 'text', col => col.notNull())
    .addColumn('project_title', 'text')
    .addColumn('capacity_kw', 'integer', col => col.notNull())
    .addColumn('site_area_m2', 'integer')
    .addColumn('land_ownership', 'text')
    .addColumn('project_usage', 'text')
    .addColumn('grid_connection_status', 'text')
    .addColumn('services', 'text', col => col.notNull())
    .addColumn('pricing_snapshot', 'text', col => col.notNull())
    .addColumn('total_price', 'bigint', col => col.notNull())
    .addColumn('investment_amount', 'bigint')
    .addColumn('employer_contribution', 'bigint')
    .addColumn('facility_amount', 'bigint')
    .addColumn('interest_rate', 'text')
    .addColumn('grace_months', 'integer')
    .addColumn('repayment_months', 'integer')
    .addColumn('customer_notes', 'text')
    .addColumn('map_file_path', 'text', col => col.notNull())
    .addColumn('map_original_name', 'text', col => col.notNull())
    .addColumn('map_mime_type', 'text', col => col.notNull())
    .addColumn('map_size_bytes', 'integer', col => col.notNull())
    .addColumn('status', 'text', col => col.notNull().defaultTo('submitted'))
    .addColumn('admin_note', 'text')
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .addColumn('updated_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('quotes').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('user_id', 'text', col => col.notNull().references('users.id'))
    .addColumn('quote_no', 'text', col => col.notNull().unique())
    .addColumn('title', 'text', col => col.notNull())
    .addColumn('amount', 'bigint', col => col.notNull().defaultTo(0))
    .addColumn('status', 'text', col => col.notNull().defaultTo('draft'))
    .addColumn('valid_until', 'text')
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('projects').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('user_id', 'text', col => col.notNull().references('users.id'))
    .addColumn('title', 'text', col => col.notNull())
    .addColumn('status', 'text', col => col.notNull().defaultTo('planning'))
    .addColumn('progress', 'integer', col => col.notNull().defaultTo(0))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('support_tickets').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('user_id', 'text', col => col.notNull().references('users.id'))
    .addColumn('ticket_no', 'text', col => col.notNull().unique())
    .addColumn('subject', 'text', col => col.notNull())
    .addColumn('status', 'text', col => col.notNull().defaultTo('open'))
    .addColumn('priority', 'text', col => col.notNull().defaultTo('normal'))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('support_messages').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('ticket_id', 'text', col => col.notNull().references('support_tickets.id').onDelete('cascade'))
    .addColumn('sender_id', 'text', col => col.notNull().references('users.id'))
    .addColumn('body', 'text', col => col.notNull())
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('admin_members').ifNotExists()
    .addColumn('user_id', 'text', col => col.primaryKey().references('users.id').onDelete('cascade'))
    .addColumn('section', 'text', col => col.notNull())
    .addColumn('permissions', 'text', col => col.notNull().defaultTo('{}'))
    .addColumn('created_by', 'text', col => col.references('users.id'))
    .addColumn('updated_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('support_assignments').ifNotExists()
    .addColumn('ticket_id', 'text', col => col.primaryKey().references('support_tickets.id').onDelete('cascade'))
    .addColumn('agent_id', 'text', col => col.notNull().references('users.id'))
    .addColumn('assigned_by', 'text', col => col.references('users.id'))
    .addColumn('assigned_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('notifications').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('user_id', 'text', col => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('title', 'text', col => col.notNull())
    .addColumn('body', 'text', col => col.notNull())
    .addColumn('read_at', 'text')
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('audit_events').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('user_id', 'text', col => col.references('users.id'))
    .addColumn('action', 'text', col => col.notNull())
    .addColumn('entity_type', 'text')
    .addColumn('entity_id', 'text')
    .addColumn('ip', 'text')
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('auth_attempts').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('scope', 'text', col => col.notNull())
    .addColumn('identifier', 'text', col => col.notNull())
    .addColumn('ip', 'text')
    .addColumn('success', 'integer', col => col.notNull().defaultTo(0))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('inventory_movements').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('product_id', 'text', col => col.notNull().references('products.id'))
    .addColumn('variant_id', 'text')
    .addColumn('order_id', 'text', col => col.references('orders.id'))
    .addColumn('quantity', 'integer', col => col.notNull())
    .addColumn('reason', 'text', col => col.notNull())
    .addColumn('created_by', 'text', col => col.references('users.id'))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('order_status_history').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('order_id', 'text', col => col.notNull().references('orders.id').onDelete('cascade'))
    .addColumn('from_status', 'text')
    .addColumn('to_status', 'text', col => col.notNull())
    .addColumn('note', 'text')
    .addColumn('changed_by', 'text', col => col.references('users.id'))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('support_notes').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('ticket_id', 'text', col => col.notNull().references('support_tickets.id').onDelete('cascade'))
    .addColumn('author_id', 'text', col => col.notNull().references('users.id'))
    .addColumn('body', 'text', col => col.notNull())
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('favorites').ifNotExists()
    .addColumn('user_id', 'text', col => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('product_id', 'text', col => col.notNull().references('products.id').onDelete('cascade'))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .addPrimaryKeyConstraint('pk_favorites', ['user_id', 'product_id'])
    .execute();
  await db.schema.createTable('product_categories').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('name', 'text', col => col.notNull())
    .addColumn('slug', 'text', col => col.notNull().unique())
    .addColumn('parent_id', 'text', col => col.references('product_categories.id'))
    .addColumn('status', 'text', col => col.notNull().defaultTo('active'))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('store_settings').ifNotExists()
    .addColumn('key', 'text', col => col.primaryKey())
    .addColumn('value', 'text', col => col.notNull())
    .addColumn('updated_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('code_sequences').ifNotExists()
    .addColumn('scope', 'text', col => col.primaryKey())
    .addColumn('next_value', 'integer', col => col.notNull().defaultTo(0))
    .addColumn('updated_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('brands').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('name', 'text', col => col.notNull())
    .addColumn('slug', 'text', col => col.notNull().unique())
    .addColumn('status', 'text', col => col.notNull().defaultTo('active'))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('product_images').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('product_id', 'text', col => col.notNull().references('products.id').onDelete('cascade'))
    .addColumn('url', 'text', col => col.notNull())
    .addColumn('alt_text', 'text')
    .addColumn('sort_order', 'integer', col => col.notNull().defaultTo(0))
    .addColumn('is_primary', 'integer', col => col.notNull().defaultTo(0))
    .addColumn('mime_type', 'text')
    .addColumn('size_bytes', 'integer')
    .addColumn('deleted_at', 'text')
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('product_variants').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('product_id', 'text', col => col.notNull().references('products.id').onDelete('cascade'))
    .addColumn('name', 'text', col => col.notNull())
    .addColumn('sku', 'text', col => col.notNull().unique())
    .addColumn('barcode', 'text')
    .addColumn('price', 'bigint')
    .addColumn('cost_price', 'bigint')
    .addColumn('stock', 'integer', col => col.notNull().defaultTo(0))
    .addColumn('reserved_stock', 'integer', col => col.notNull().defaultTo(0))
    .addColumn('image_id', 'text', col => col.references('product_images.id'))
    .addColumn('status', 'text', col => col.notNull().defaultTo('active'))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .addColumn('updated_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('customer_cart_items').ifNotExists()
    .addColumn('user_id', 'text', col => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('product_id', 'text', col => col.notNull().references('products.id').onDelete('cascade'))
    .addColumn('variant_key', 'text', col => col.notNull().defaultTo(''))
    .addColumn('variant_id', 'text', col => col.references('product_variants.id').onDelete('cascade'))
    .addColumn('quantity', 'integer', col => col.notNull())
    .addColumn('updated_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .addPrimaryKeyConstraint('pk_customer_cart_items', ['user_id', 'product_id', 'variant_key'])
    .execute();
  await db.schema.createTable('variant_options').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('variant_id', 'text', col => col.notNull().references('product_variants.id').onDelete('cascade'))
    .addColumn('option_name', 'text', col => col.notNull())
    .addColumn('option_value', 'text', col => col.notNull())
    .addColumn('sort_order', 'integer', col => col.notNull().defaultTo(0))
    .execute();
  await db.schema.createTable('inventory_reservations').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('order_id', 'text', col => col.notNull().references('orders.id').onDelete('cascade'))
    .addColumn('product_id', 'text', col => col.notNull().references('products.id'))
    .addColumn('variant_id', 'text', col => col.references('product_variants.id'))
    .addColumn('quantity', 'integer', col => col.notNull())
    .addColumn('status', 'text', col => col.notNull().defaultTo('active'))
    .addColumn('expires_at', 'text', col => col.notNull())
    .addColumn('released_at', 'text')
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('price_history').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('product_id', 'text', col => col.notNull().references('products.id').onDelete('cascade'))
    .addColumn('variant_id', 'text', col => col.references('product_variants.id').onDelete('cascade'))
    .addColumn('old_price', 'bigint')
    .addColumn('new_price', 'bigint', col => col.notNull())
    .addColumn('changed_by', 'text', col => col.references('users.id'))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('product_status_history').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('product_id', 'text', col => col.notNull().references('products.id').onDelete('cascade'))
    .addColumn('from_status', 'text')
    .addColumn('to_status', 'text', col => col.notNull())
    .addColumn('changed_by', 'text', col => col.references('users.id'))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('discount_usages').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('discount_id', 'text', col => col.notNull().references('discount_codes.id'))
    .addColumn('order_id', 'text', col => col.notNull().references('orders.id'))
    .addColumn('user_id', 'text', col => col.notNull().references('users.id'))
    .addColumn('amount', 'bigint', col => col.notNull())
    .addColumn('status', 'text', col => col.notNull().defaultTo('used'))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('discount_customer_counters').ifNotExists()
    .addColumn('discount_id', 'text', col => col.notNull().references('discount_codes.id').onDelete('cascade'))
    .addColumn('user_id', 'text', col => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('used_count', 'integer', col => col.notNull().defaultTo(0))
    .addColumn('updated_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .addPrimaryKeyConstraint('pk_discount_customer_counters', ['discount_id', 'user_id'])
    .execute();
  await db.schema.createTable('shipments').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('order_id', 'text', col => col.notNull().references('orders.id'))
    .addColumn('method', 'text', col => col.notNull())
    .addColumn('company', 'text')
    .addColumn('tracking_code', 'text')
    .addColumn('cost', 'bigint', col => col.notNull().defaultTo(0))
    .addColumn('status', 'text', col => col.notNull().defaultTo('pending'))
    .addColumn('estimated_delivery_at', 'text')
    .addColumn('shipped_at', 'text')
    .addColumn('delivered_at', 'text')
    .addColumn('created_by', 'text', col => col.references('users.id'))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .addColumn('updated_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('returns').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('return_no', 'text', col => col.notNull().unique())
    .addColumn('order_id', 'text', col => col.notNull().references('orders.id'))
    .addColumn('user_id', 'text', col => col.notNull().references('users.id'))
    .addColumn('reason', 'text', col => col.notNull())
    .addColumn('description', 'text')
    .addColumn('images', 'text')
    .addColumn('health_status', 'text')
    .addColumn('status', 'text', col => col.notNull().defaultTo('requested'))
    .addColumn('reviewed_by', 'text', col => col.references('users.id'))
    .addColumn('review_note', 'text')
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .addColumn('updated_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();
  await db.schema.createTable('return_items').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('return_id', 'text', col => col.notNull().references('returns.id').onDelete('cascade'))
    .addColumn('order_item_id', 'text', col => col.notNull().references('order_items.id'))
    .addColumn('quantity', 'integer', col => col.notNull())
    .execute();
  await db.schema.createTable('refunds').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('refund_no', 'text', col => col.notNull().unique())
    .addColumn('order_id', 'text', col => col.notNull().references('orders.id'))
    .addColumn('payment_id', 'text', col => col.notNull().references('payments.id'))
    .addColumn('return_id', 'text', col => col.references('returns.id'))
    .addColumn('amount', 'bigint', col => col.notNull())
    .addColumn('reason', 'text', col => col.notNull())
    .addColumn('status', 'text', col => col.notNull().defaultTo('pending'))
    .addColumn('provider_reference', 'text')
    .addColumn('created_by', 'text', col => col.references('users.id'))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .addColumn('processed_at', 'text')
    .execute();
  await db.schema.createTable('idempotency_records').ifNotExists()
    .addColumn('owner_id', 'text', col => col.notNull())
    .addColumn('scope', 'text', col => col.notNull())
    .addColumn('idempotency_key', 'text', col => col.notNull())
    .addColumn('payload_hash', 'text', col => col.notNull())
    .addColumn('resource_id', 'text')
    .addColumn('status', 'text', col => col.notNull().defaultTo('processing'))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .addPrimaryKeyConstraint('pk_idempotency_records', ['owner_id', 'scope', 'idempotency_key'])
    .execute();

  // Safe additive migration: existing rows and user data remain intact.
  await ensureColumns('profiles', {
    first_name: 'text', last_name: 'text', display_name: 'text',
    birth_date: 'text', gender: 'text', avatar_url: 'text',
    account_type: 'text', alternate_phone: 'text',
    mobile_verified_at: 'text', email_verified_at: 'text',
    registration_no: 'text', economic_code: 'text',
    company_national_id: 'text', representative_name: 'text',
    representative_position: 'text', company_phone: 'text',
    company_address: 'text', invoice_details: 'text',
    privacy_settings: 'text', deactivation_requested_at: 'text',
    acquisition_source: 'text', acquisition_campaign: 'text',
    acquisition_medium: 'text', acquisition_referrer: 'text',
    acquisition_utm_source: 'text', acquisition_utm_medium: 'text',
    acquisition_utm_campaign: 'text', acquisition_utm_content: 'text',
    acquisition_utm_term: 'text', consent_version: 'text',
    consent_accepted_at: 'text', onboarding_completed_at: 'text',
  });
  await ensureColumns('otp_codes', {
    purpose: 'text', portal: 'text', attempts: 'integer', requested_ip: 'text',
  });
  await ensureColumns('sessions', {
    portal: 'text', ip: 'text', user_agent: 'text', last_seen_at: 'text',
    csrf_hash: 'text', role_snapshot: 'text', token_version: 'integer', revoked_at: 'text',
    mfa_verified_at: 'text',
  });
  await ensureColumns('addresses', {
    latitude: 'text', longitude: 'text', deleted_at: 'text',
    province_code: 'text', city_code: 'text',
  });
  await ensureColumns('orders', {
    address_snapshot: 'text', discount_total: 'bigint', tax_total: 'bigint',
    payment_status: 'text', channel: 'text', shipping_company: 'text',
    tracking_code: 'text', estimated_delivery_at: 'text',
    idempotency_key: 'text', reservation_expires_at: 'text',
    customer_note: 'text', internal_note: 'text', updated_at: 'text',
  });
  await ensureColumns('order_items', {
    variant_id: 'text', sku_snapshot: 'text', cost_snapshot: 'bigint',
    tax_snapshot: 'integer', discount_snapshot: 'bigint',
  });
  await ensureColumns('payments', {
    transaction_id: 'text', paid_at: 'text', failure_reason: 'text',
    refunded_amount: 'bigint', updated_at: 'text', reconciliation_status: 'text',
  });
  await ensureColumns('refunds', {
    idempotency_key: 'text', payload_hash: 'text',
  });
  await ensureColumns('inventory_movements', {
    variant_id: 'text',
  });
  await ensureColumns('products', {
    barcode: 'text', slug: 'text', short_description: 'text',
    tags: 'text', specifications: 'text', images: 'text',
    product_type: 'text', sale_price: 'bigint', sale_starts_at: 'text',
    sale_ends_at: 'text', tax_rate: 'integer', reserved_stock: 'integer',
    deleted_at: 'text', seo_title: 'text', seo_description: 'text',
    subtitle: 'text', subcategory: 'text', category_id: 'text', brand_id: 'text',
    purchase_price: 'bigint', inbound_shipping_cost: 'bigint',
    packaging_cost: 'bigint', additional_cost: 'bigint', unit_cost: 'bigint',
    social_image_url: 'text', archive_reason: 'text',
    product_code: 'text', internal_barcode: 'text', barcode_source: 'text',
    unit: 'text', price_tier: 'text',
  });
  await ensureColumns('product_categories', {
    code: 'text', description: 'text', sort_order: 'integer',
    attributes: 'text', price_ranges: 'text',
  });
  await ensureColumns('discount_codes', {
    minimum_order: 'bigint', maximum_discount: 'bigint',
    per_customer_limit: 'integer', product_ids: 'text', customer_ids: 'text',
    category_ids: 'text', first_purchase_only: 'integer',
    single_use: 'integer', archived_at: 'text',
  });
  await ensureColumns('users', {
    deleted_at: 'text', last_login_at: 'text', last_activity_at: 'text',
    token_version: 'integer',
  });
  await ensureColumns('audit_events', {
    metadata: 'text', user_agent: 'text', correlation_id: 'text', result: 'text',
  });
  await ensureColumns('portal_credentials', {
    temporary_expires_at: 'text',
  });
  await ensureColumns('support_tickets', {
    updated_at: 'text', first_response_at: 'text', resolved_at: 'text',
  });
  await db.schema.createIndex('idx_sessions_token').ifNotExists().on('sessions').column('token_hash').execute();
  await db.schema.createIndex('idx_portal_credentials_username').ifNotExists().on('portal_credentials').column('username').execute();
  await db.schema.createIndex('idx_otp_mobile_created').ifNotExists().on('otp_codes').columns(['mobile', 'created_at']).execute();
  await db.schema.createIndex('idx_cart_user_updated').ifNotExists().on('customer_cart_items').columns(['user_id', 'updated_at']).execute();
  await db.schema.createIndex('idx_orders_user_created').ifNotExists().on('orders').columns(['user_id', 'created_at']).execute();
  await db.schema.createIndex('idx_products_status_category').ifNotExists().on('products').columns(['status', 'category']).execute();
  await db.schema.createIndex('idx_invoices_order').ifNotExists().on('invoices').column('order_id').execute();
  await db.schema.createIndex('idx_consultations_user').ifNotExists().on('consultations').column('user_id').execute();
  await db.schema.createIndex('idx_engineering_requests_user').ifNotExists().on('engineering_service_requests').columns(['user_id', 'created_at']).execute();
  await db.schema.createIndex('idx_engineering_requests_status').ifNotExists().on('engineering_service_requests').columns(['status', 'created_at']).execute();
  await db.schema.createIndex('idx_tickets_user_created').ifNotExists().on('support_tickets').columns(['user_id', 'created_at']).execute();
  await db.schema.createIndex('idx_support_assignment_agent').ifNotExists().on('support_assignments').column('agent_id').execute();
  await db.schema.createIndex('idx_notifications_user_created').ifNotExists().on('notifications').columns(['user_id', 'created_at']).execute();
  await db.schema.createIndex('idx_auth_attempts_lookup').ifNotExists().on('auth_attempts').columns(['scope', 'identifier', 'created_at']).execute();
  await db.schema.createIndex('idx_inventory_product_created').ifNotExists().on('inventory_movements').columns(['product_id', 'created_at']).execute();
  await db.schema.createIndex('idx_order_history_order_created').ifNotExists().on('order_status_history').columns(['order_id', 'created_at']).execute();
  await db.schema.createIndex('idx_audit_created').ifNotExists().on('audit_events').column('created_at').execute();
  await db.schema.createIndex('idx_products_slug').ifNotExists().on('products').column('slug').execute();
  await db.schema.createIndex('idx_products_sku').ifNotExists().on('products').column('sku').execute();
  await db.schema.createIndex('idx_products_product_code').ifNotExists().unique().on('products').column('product_code').execute();
  await db.schema.createIndex('idx_products_internal_barcode').ifNotExists().unique().on('products').column('internal_barcode').execute();
  await db.schema.createIndex('idx_orders_status_created').ifNotExists().on('orders').columns(['status', 'created_at']).execute();
  await db.schema.createIndex('uq_orders_idempotency').ifNotExists().unique().on('orders').columns(['user_id', 'idempotency_key']).execute();
  await db.schema.createIndex('uq_payments_transaction').ifNotExists().unique().on('payments').column('transaction_id').execute();
  await db.schema.createIndex('uq_invoices_order').ifNotExists().unique().on('invoices').column('order_id').execute();
  await db.schema.createIndex('uq_refunds_idempotency').ifNotExists().unique().on('refunds').columns(['created_by', 'idempotency_key']).execute();
  await db.schema.createIndex('uq_refunds_provider_reference').ifNotExists().unique().on('refunds').column('provider_reference').execute();
  await db.schema.createIndex('idx_reservations_expiry').ifNotExists().on('inventory_reservations').columns(['status', 'expires_at']).execute();
  await db.schema.createIndex('idx_variants_product').ifNotExists().on('product_variants').column('product_id').execute();
  await db.schema.createIndex('idx_product_images_product').ifNotExists().on('product_images').columns(['product_id', 'sort_order']).execute();
  await db.schema.createIndex('idx_product_categories_code').ifNotExists().unique().on('product_categories').column('code').execute();
  await db.schema.createIndex('idx_shipments_order').ifNotExists().on('shipments').column('order_id').execute();
  await db.schema.createIndex('idx_returns_order').ifNotExists().on('returns').column('order_id').execute();
  await db.schema.createIndex('idx_refunds_order').ifNotExists().on('refunds').column('order_id').execute();
  if (dbKind === 'postgres') {
    await db.transaction().execute(async trx => {
      const inserted = await trx.insertInto('schema_migrations')
        .values({ id: 'v57_money_bigint', applied_at: new Date().toISOString() })
        .onConflict(conflict => conflict.column('id').doNothing())
        .executeTakeFirst();
      if (Number(inserted.numInsertedOrUpdatedRows || 0) !== 1) return;
      const bigintMigrations = [
        sql`alter table products alter column price type bigint, alter column compare_price type bigint, alter column sale_price type bigint, alter column purchase_price type bigint, alter column inbound_shipping_cost type bigint, alter column packaging_cost type bigint, alter column additional_cost type bigint, alter column unit_cost type bigint`,
        sql`alter table product_variants alter column price type bigint, alter column cost_price type bigint`,
        sql`alter table price_history alter column old_price type bigint, alter column new_price type bigint`,
        sql`alter table orders alter column subtotal type bigint, alter column shipping type bigint, alter column total type bigint, alter column discount_total type bigint, alter column tax_total type bigint`,
        sql`alter table order_items alter column unit_price type bigint, alter column line_total type bigint, alter column cost_snapshot type bigint, alter column discount_snapshot type bigint`,
        sql`alter table payments alter column amount type bigint, alter column refunded_amount type bigint`,
        sql`alter table invoices alter column amount type bigint`,
        sql`alter table quotes alter column amount type bigint`,
        sql`alter table shipments alter column cost type bigint`,
        sql`alter table refunds alter column amount type bigint`,
        sql`alter table discount_usages alter column amount type bigint`,
        sql`alter table discount_codes alter column value type bigint, alter column minimum_order type bigint, alter column maximum_discount type bigint`,
      ];
      for (const statement of bigintMigrations) await statement.execute(trx);
    });
  }
  await db.transaction().execute(async trx => {
    const migrationId = 'v57_currency_rial';
    const inserted = await trx.insertInto('schema_migrations')
      .values({ id: migrationId, applied_at: new Date().toISOString() })
      .onConflict(conflict => conflict.column('id').doNothing())
      .executeTakeFirst();
    if (Number(inserted.numInsertedOrUpdatedRows || 0) !== 1) return;
    const statements = [
      sql`update products set price = price * 10, compare_price = compare_price * 10, sale_price = sale_price * 10, purchase_price = purchase_price * 10, inbound_shipping_cost = inbound_shipping_cost * 10, packaging_cost = packaging_cost * 10, additional_cost = additional_cost * 10, unit_cost = unit_cost * 10`,
      sql`update product_variants set price = price * 10, cost_price = cost_price * 10`,
      sql`update price_history set old_price = old_price * 10, new_price = new_price * 10`,
      sql`update orders set subtotal = subtotal * 10, shipping = shipping * 10, total = total * 10, discount_total = discount_total * 10, tax_total = tax_total * 10`,
      sql`update order_items set unit_price = unit_price * 10, line_total = line_total * 10, cost_snapshot = cost_snapshot * 10, discount_snapshot = discount_snapshot * 10`,
      sql`update payments set amount = amount * 10, refunded_amount = refunded_amount * 10`,
      sql`update invoices set amount = amount * 10`,
      sql`update quotes set amount = amount * 10`,
      sql`update shipments set cost = cost * 10`,
      sql`update refunds set amount = amount * 10`,
      sql`update discount_usages set amount = amount * 10`,
      sql`update discount_codes set value = case when type = 'fixed' then value * 10 else value end, minimum_order = minimum_order * 10, maximum_discount = maximum_discount * 10`,
    ];
    for (const statement of statements) await statement.execute(trx);
  });
  await db.transaction().execute(async trx => {
    const inserted = await trx.insertInto('schema_migrations')
      .values({ id: 'v511_product_identity', applied_at: new Date().toISOString() })
      .onConflict(conflict => conflict.column('id').doNothing())
      .executeTakeFirst();
    if (Number(inserted.numInsertedOrUpdatedRows || 0) !== 1) return;

    const defaults = {
      product_code_prefix: 'ARN',
      product_sequence_digits: '6',
      internal_barcode_prefix: '290',
      default_low_stock_threshold: '3',
      barcode_generation_enabled: 'true',
      units: JSON.stringify(['عدد', 'بسته', 'متر', 'کیلوگرم', 'لیتر', 'مترمربع', 'سرویس']),
      price_tiers: JSON.stringify([
        { key: 'economy', title: 'اقتصادی', max: 50_000_000 },
        { key: 'standard', title: 'میان‌رده', max: 500_000_000 },
        { key: 'professional', title: 'حرفه‌ای', max: 5_000_000_000 },
        { key: 'enterprise', title: 'سازمانی', max: null },
      ]),
    };
    for (const [key, value] of Object.entries(defaults)) {
      await trx.insertInto('store_settings').values({ key, value, updated_at: new Date().toISOString() })
        .onConflict(conflict => conflict.column('key').doNothing()).execute();
    }
    await trx.insertInto('code_sequences').values({ scope: 'product', next_value: 0, updated_at: new Date().toISOString() })
      .onConflict(conflict => conflict.column('scope').doNothing()).execute();
    await trx.insertInto('code_sequences').values({ scope: 'category', next_value: 0, updated_at: new Date().toISOString() })
      .onConflict(conflict => conflict.column('scope').doNothing()).execute();

    const products = await trx.selectFrom('products').selectAll().orderBy('created_at').execute();
    const existingCategories = await trx.selectFrom('product_categories').selectAll().orderBy('created_at').execute();
    for (const category of existingCategories) {
      if (category.code) continue;
      const changed = await trx.updateTable('code_sequences')
        .set({ next_value: sql`next_value + 1`, updated_at: new Date().toISOString() })
        .where('scope', '=', 'category').returning('next_value').executeTakeFirst();
      const number = Number(changed?.next_value || 1);
      await trx.updateTable('product_categories').set({
        code: String(number).padStart(4, '0'), sort_order: category.sort_order ?? number,
        attributes: category.attributes || '[]', price_ranges: category.price_ranges || '[]',
      }).where('id', '=', category.id).execute();
    }
    const categoryNames = [...new Set(products.map(row => String(row.category || '').trim()).filter(Boolean))];
    for (const name of categoryNames) {
      let category = await trx.selectFrom('product_categories').selectAll().where('name', '=', name).executeTakeFirst();
      if (!category) {
        const changed = await trx.updateTable('code_sequences')
          .set({ next_value: sql`next_value + 1`, updated_at: new Date().toISOString() })
          .where('scope', '=', 'category').returning('next_value').executeTakeFirst();
        const number = Number(changed?.next_value || 1);
        const slug = `category-${String(number).padStart(4, '0')}`;
        const id = `migrated-category-${String(number).padStart(4, '0')}`;
        await trx.insertInto('product_categories').values({
          id, name, slug, parent_id: null, status: 'active', created_at: new Date().toISOString(),
          code: String(number).padStart(4, '0'), description: null, sort_order: number,
          attributes: '[]', price_ranges: '[]',
        }).execute();
        category = { id, code: String(number).padStart(4, '0') };
      } else if (!category.code) {
        const changed = await trx.updateTable('code_sequences')
          .set({ next_value: sql`next_value + 1`, updated_at: new Date().toISOString() })
          .where('scope', '=', 'category').returning('next_value').executeTakeFirst();
        category.code = String(Number(changed?.next_value || 1)).padStart(4, '0');
        await trx.updateTable('product_categories').set({ code: category.code }).where('id', '=', category.id).execute();
      }
      await trx.updateTable('products').set({ category_id: category.id })
        .where('category', '=', name).where('category_id', 'is', null).execute();
    }

    let sequence = 0;
    for (const product of products) {
      sequence += 1;
      const category = product.category_id
        ? await trx.selectFrom('product_categories').select('code').where('id', '=', product.category_id).executeTakeFirst()
        : await trx.selectFrom('product_categories').select('code').where('name', '=', product.category).executeTakeFirst();
      const productCode = product.product_code || `ARN-${category?.code || '9999'}-${String(sequence).padStart(6, '0')}`;
      const base = `290${String(sequence).padStart(9, '0')}`.slice(-12);
      let sum = 0;
      for (let index = 0; index < 12; index += 1) sum += Number(base[index]) * (index % 2 === 0 ? 1 : 3);
      const internalBarcode = product.internal_barcode || `${base}${(10 - (sum % 10)) % 10}`;
      await trx.updateTable('products').set({
        product_code: productCode,
        sku: product.sku || productCode,
        slug: product.slug || `product-${productCode.toLowerCase()}`,
        internal_barcode: internalBarcode,
        barcode_source: product.barcode ? 'factory' : 'internal',
        unit: product.unit || 'عدد',
        price_tier: product.price_tier || (
          Number(product.sale_price ?? product.price ?? 0) < 50_000_000 ? 'economy' :
          Number(product.sale_price ?? product.price ?? 0) < 500_000_000 ? 'standard' :
          Number(product.sale_price ?? product.price ?? 0) < 5_000_000_000 ? 'professional' : 'enterprise'
        ),
      }).where('id', '=', product.id).execute();
    }
    await trx.updateTable('code_sequences').set({ next_value: Math.max(sequence, products.length), updated_at: new Date().toISOString() })
      .where('scope', '=', 'product').execute();
  });
  await migrateSupportV5(db, dbKind);
}
