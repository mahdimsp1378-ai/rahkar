import { sql } from 'kysely';
import { SUPPORT_TOPICS } from '../shared/support-topics.js';

async function ensureColumns(db, tableName, columns) {
  const tables = await db.introspection.getTables();
  const table = tables.find(item => item.name === tableName);
  const existing = new Set((table?.columns || []).map(column => column.name));
  for (const [name, type] of Object.entries(columns)) {
    if (!existing.has(name)) await db.schema.alterTable(tableName).addColumn(name, type).execute();
  }
}

export async function migrateSupportV5(db, dbKind) {
  const nowDefault = dbKind === 'postgres' ? sql`CURRENT_TIMESTAMP::text` : sql`CURRENT_TIMESTAMP`;

  await db.schema.createTable('rate_limit_buckets').ifNotExists()
    .addColumn('key', 'text', col => col.primaryKey())
    .addColumn('count', 'integer', col => col.notNull().defaultTo(0))
    .addColumn('reset_at', 'text', col => col.notNull())
    .addColumn('updated_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();

  await db.schema.createTable('support_teams').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('name', 'text', col => col.notNull())
    .addColumn('slug', 'text', col => col.notNull().unique())
    .addColumn('status', 'text', col => col.notNull().defaultTo('active'))
    .addColumn('timezone', 'text', col => col.notNull().defaultTo('Asia/Tehran'))
    .addColumn('working_hours', 'text', col => col.notNull().defaultTo('{}'))
    .addColumn('holidays', 'text', col => col.notNull().defaultTo('[]'))
    .addColumn('default_capacity', 'integer', col => col.notNull().defaultTo(8))
    .addColumn('created_by', 'text', col => col.references('users.id'))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .addColumn('updated_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();

  await db.schema.createTable('support_skills').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('name', 'text', col => col.notNull())
    .addColumn('slug', 'text', col => col.notNull().unique())
    .addColumn('status', 'text', col => col.notNull().defaultTo('active'))
    .addColumn('metadata', 'text', col => col.notNull().defaultTo('{}'))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();

  for (const topic of SUPPORT_TOPICS) {
    await db.insertInto('support_skills').values({
      id: `support-topic-${topic.id}`,
      name: topic.label,
      slug: topic.id,
      status: 'active',
      metadata: JSON.stringify({ kind: 'conversation-topic', aliases: topic.aliases }),
      created_at: new Date().toISOString(),
    }).onConflict(oc => oc.column('id').doUpdateSet({
      name: topic.label,
      slug: topic.id,
      status: 'active',
      metadata: JSON.stringify({ kind: 'conversation-topic', aliases: topic.aliases }),
    })).execute();
  }

  await db.schema.createTable('support_team_members').ifNotExists()
    .addColumn('team_id', 'text', col => col.notNull().references('support_teams.id').onDelete('cascade'))
    .addColumn('agent_id', 'text', col => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('is_primary', 'integer', col => col.notNull().defaultTo(0))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .addPrimaryKeyConstraint('pk_support_team_members', ['team_id', 'agent_id'])
    .execute();

  await db.schema.createTable('support_agent_skills').ifNotExists()
    .addColumn('agent_id', 'text', col => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('skill_id', 'text', col => col.notNull().references('support_skills.id').onDelete('cascade'))
    .addColumn('level', 'integer', col => col.notNull().defaultTo(1))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .addPrimaryKeyConstraint('pk_support_agent_skills', ['agent_id', 'skill_id'])
    .execute();

  await db.schema.createTable('support_agent_profiles').ifNotExists()
    .addColumn('agent_id', 'text', col => col.primaryKey().references('users.id').onDelete('cascade'))
    .addColumn('avatar_url', 'text')
    .addColumn('title', 'text')
    .addColumn('languages', 'text', col => col.notNull().defaultTo('["fa"]'))
    .addColumn('seniority', 'text', col => col.notNull().defaultTo('mid'))
    .addColumn('timezone', 'text', col => col.notNull().defaultTo('Asia/Tehran'))
    .addColumn('working_hours', 'text', col => col.notNull().defaultTo('{}'))
    .addColumn('capacity', 'integer', col => col.notNull().defaultTo(8))
    .addColumn('presence_status', 'text', col => col.notNull().defaultTo('offline'))
    .addColumn('last_heartbeat_at', 'text')
    .addColumn('last_seen_at', 'text')
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .addColumn('updated_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();

  await db.schema.createTable('support_assignment_history').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('ticket_id', 'text', col => col.notNull().references('support_tickets.id').onDelete('cascade'))
    .addColumn('from_agent_id', 'text', col => col.references('users.id'))
    .addColumn('to_agent_id', 'text', col => col.references('users.id'))
    .addColumn('from_team_id', 'text', col => col.references('support_teams.id'))
    .addColumn('to_team_id', 'text', col => col.references('support_teams.id'))
    .addColumn('action', 'text', col => col.notNull())
    .addColumn('reason', 'text')
    .addColumn('actor_id', 'text', col => col.references('users.id'))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();

  await db.schema.createTable('support_status_history').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('ticket_id', 'text', col => col.notNull().references('support_tickets.id').onDelete('cascade'))
    .addColumn('from_status', 'text')
    .addColumn('to_status', 'text', col => col.notNull())
    .addColumn('actor_type', 'text', col => col.notNull())
    .addColumn('actor_id', 'text')
    .addColumn('reason', 'text')
    .addColumn('state_version', 'integer', col => col.notNull())
    .addColumn('metadata', 'text', col => col.notNull().defaultTo('{}'))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();

  await db.schema.createTable('support_events').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('ticket_id', 'text', col => col.references('support_tickets.id').onDelete('cascade'))
    .addColumn('event_type', 'text', col => col.notNull())
    .addColumn('actor_type', 'text', col => col.notNull())
    .addColumn('actor_id', 'text')
    .addColumn('target_user_id', 'text')
    .addColumn('team_id', 'text')
    .addColumn('payload', 'text', col => col.notNull().defaultTo('{}'))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();

  await db.schema.createTable('support_attachments').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('ticket_id', 'text', col => col.notNull().references('support_tickets.id').onDelete('cascade'))
    .addColumn('message_id', 'text', col => col.references('support_messages.id').onDelete('set null'))
    .addColumn('uploader_id', 'text', col => col.notNull().references('users.id'))
    .addColumn('original_name', 'text', col => col.notNull())
    .addColumn('storage_name', 'text', col => col.notNull().unique())
    .addColumn('mime_type', 'text', col => col.notNull())
    .addColumn('size_bytes', 'integer', col => col.notNull())
    .addColumn('sha256', 'text', col => col.notNull())
    .addColumn('thumbnail_name', 'text')
    .addColumn('scan_status', 'text', col => col.notNull().defaultTo('not_configured'))
    .addColumn('metadata', 'text', col => col.notNull().defaultTo('{}'))
    .addColumn('deleted_at', 'text')
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();

  await db.schema.createTable('support_message_reads').ifNotExists()
    .addColumn('message_id', 'text', col => col.notNull().references('support_messages.id').onDelete('cascade'))
    .addColumn('user_id', 'text', col => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('delivered_at', 'text')
    .addColumn('read_at', 'text')
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .addPrimaryKeyConstraint('pk_support_message_reads', ['message_id', 'user_id'])
    .execute();

  await db.schema.createTable('support_tags').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('name', 'text', col => col.notNull())
    .addColumn('color', 'text', col => col.notNull().defaultTo('#2f8f68'))
    .addColumn('status', 'text', col => col.notNull().defaultTo('active'))
    .addColumn('created_by', 'text', col => col.references('users.id'))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();

  await db.schema.createTable('support_ticket_tags').ifNotExists()
    .addColumn('ticket_id', 'text', col => col.notNull().references('support_tickets.id').onDelete('cascade'))
    .addColumn('tag_id', 'text', col => col.notNull().references('support_tags.id').onDelete('cascade'))
    .addColumn('added_by', 'text', col => col.references('users.id'))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .addPrimaryKeyConstraint('pk_support_ticket_tags', ['ticket_id', 'tag_id'])
    .execute();

  await db.schema.createTable('support_macros').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('name', 'text', col => col.notNull())
    .addColumn('body', 'text', col => col.notNull())
    .addColumn('scope', 'text', col => col.notNull().defaultTo('personal'))
    .addColumn('owner_id', 'text', col => col.references('users.id'))
    .addColumn('team_id', 'text', col => col.references('support_teams.id'))
    .addColumn('status', 'text', col => col.notNull().defaultTo('active'))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .addColumn('updated_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();

  await db.schema.createTable('support_sla_policies').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('name', 'text', col => col.notNull())
    .addColumn('priority', 'text', col => col.notNull())
    .addColumn('team_id', 'text', col => col.references('support_teams.id'))
    .addColumn('first_response_minutes', 'integer', col => col.notNull())
    .addColumn('next_response_minutes', 'integer', col => col.notNull())
    .addColumn('resolution_minutes', 'integer', col => col.notNull())
    .addColumn('pause_on_waiting_customer', 'integer', col => col.notNull().defaultTo(1))
    .addColumn('warning_percent', 'integer', col => col.notNull().defaultTo(80))
    .addColumn('status', 'text', col => col.notNull().defaultTo('active'))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .addColumn('updated_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();

  await db.schema.createTable('support_sla_events').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('ticket_id', 'text', col => col.notNull().references('support_tickets.id').onDelete('cascade'))
    .addColumn('metric', 'text', col => col.notNull())
    .addColumn('event_type', 'text', col => col.notNull())
    .addColumn('due_at', 'text')
    .addColumn('occurred_at', 'text', col => col.notNull())
    .addColumn('metadata', 'text', col => col.notNull().defaultTo('{}'))
    .execute();

  await db.schema.createTable('support_supervisor_requests').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('ticket_id', 'text', col => col.notNull().references('support_tickets.id').onDelete('cascade'))
    .addColumn('user_id', 'text', col => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('reason', 'text')
    .addColumn('status', 'text', col => col.notNull().defaultTo('open'))
    .addColumn('resolved_by', 'text', col => col.references('users.id'))
    .addColumn('resolved_at', 'text')
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();

  await db.schema.createTable('support_csat').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('ticket_id', 'text', col => col.notNull().references('support_tickets.id').onDelete('cascade'))
    .addColumn('user_id', 'text', col => col.notNull().references('users.id'))
    .addColumn('rating', 'integer', col => col.notNull())
    .addColumn('comment', 'text')
    .addColumn('target_type', 'text', col => col.notNull().defaultTo('overall'))
    .addColumn('agent_id', 'text', col => col.references('users.id'))
    .addColumn('active', 'integer', col => col.notNull().defaultTo(1))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .addColumn('updated_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();

  await db.schema.createTable('knowledge_documents').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('title', 'text', col => col.notNull())
    .addColumn('slug', 'text', col => col.notNull().unique())
    .addColumn('content_type', 'text', col => col.notNull().defaultTo('article'))
    .addColumn('status', 'text', col => col.notNull().defaultTo('draft'))
    .addColumn('language', 'text', col => col.notNull().defaultTo('fa'))
    .addColumn('scope', 'text', col => col.notNull().defaultTo('public'))
    .addColumn('entity_type', 'text')
    .addColumn('entity_id', 'text')
    .addColumn('valid_from', 'text')
    .addColumn('valid_until', 'text')
    .addColumn('author_id', 'text', col => col.references('users.id'))
    .addColumn('approver_id', 'text', col => col.references('users.id'))
    .addColumn('current_version', 'integer', col => col.notNull().defaultTo(1))
    .addColumn('index_status', 'text', col => col.notNull().defaultTo('pending'))
    .addColumn('metadata', 'text', col => col.notNull().defaultTo('{}'))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .addColumn('updated_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();

  await db.schema.createTable('knowledge_document_versions').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('document_id', 'text', col => col.notNull().references('knowledge_documents.id').onDelete('cascade'))
    .addColumn('version', 'integer', col => col.notNull())
    .addColumn('body', 'text', col => col.notNull())
    .addColumn('change_note', 'text')
    .addColumn('author_id', 'text', col => col.references('users.id'))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();

  await db.schema.createTable('knowledge_chunks').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('document_id', 'text', col => col.notNull().references('knowledge_documents.id').onDelete('cascade'))
    .addColumn('version_id', 'text', col => col.notNull().references('knowledge_document_versions.id').onDelete('cascade'))
    .addColumn('chunk_index', 'integer', col => col.notNull())
    .addColumn('heading', 'text')
    .addColumn('body', 'text', col => col.notNull())
    .addColumn('embedding', 'text')
    .addColumn('metadata', 'text', col => col.notNull().defaultTo('{}'))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();

  await db.schema.createTable('ai_runs').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('ticket_id', 'text', col => col.references('support_tickets.id').onDelete('cascade'))
    .addColumn('message_id', 'text', col => col.references('support_messages.id').onDelete('set null'))
    .addColumn('provider', 'text', col => col.notNull())
    .addColumn('model', 'text', col => col.notNull())
    .addColumn('intent', 'text')
    .addColumn('sentiment', 'text')
    .addColumn('confidence', 'text')
    .addColumn('status', 'text', col => col.notNull())
    .addColumn('input_tokens', 'integer', col => col.notNull().defaultTo(0))
    .addColumn('output_tokens', 'integer', col => col.notNull().defaultTo(0))
    .addColumn('cost_micros', 'integer', col => col.notNull().defaultTo(0))
    .addColumn('tool_calls', 'text', col => col.notNull().defaultTo('[]'))
    .addColumn('error_code', 'text')
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .addColumn('completed_at', 'text')
    .execute();
  await db.schema.createTable('ai_budget_daily').ifNotExists()
    .addColumn('budget_date', 'text', col => col.primaryKey())
    .addColumn('spent_micros', 'bigint', col => col.notNull().defaultTo(0))
    .addColumn('reserved_micros', 'bigint', col => col.notNull().defaultTo(0))
    .addColumn('updated_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();

  await db.schema.createTable('ai_citations').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('ai_run_id', 'text', col => col.notNull().references('ai_runs.id').onDelete('cascade'))
    .addColumn('message_id', 'text', col => col.references('support_messages.id').onDelete('set null'))
    .addColumn('document_id', 'text', col => col.notNull().references('knowledge_documents.id'))
    .addColumn('version_id', 'text', col => col.notNull().references('knowledge_document_versions.id'))
    .addColumn('chunk_id', 'text', col => col.notNull().references('knowledge_chunks.id'))
    .addColumn('title_snapshot', 'text', col => col.notNull())
    .addColumn('slug_snapshot', 'text', col => col.notNull())
    .addColumn('excerpt', 'text', col => col.notNull())
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();

  await db.schema.createTable('ai_feedback').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('ai_run_id', 'text', col => col.notNull().references('ai_runs.id').onDelete('cascade'))
    .addColumn('message_id', 'text', col => col.references('support_messages.id').onDelete('set null'))
    .addColumn('user_id', 'text', col => col.notNull().references('users.id'))
    .addColumn('helpful', 'integer', col => col.notNull())
    .addColumn('comment', 'text')
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();

  await db.schema.createTable('ai_escalations').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('ticket_id', 'text', col => col.notNull().references('support_tickets.id').onDelete('cascade'))
    .addColumn('ai_run_id', 'text', col => col.references('ai_runs.id').onDelete('set null'))
    .addColumn('reason', 'text', col => col.notNull())
    .addColumn('summary', 'text', col => col.notNull())
    .addColumn('intent', 'text')
    .addColumn('sentiment', 'text')
    .addColumn('confidence', 'text')
    .addColumn('context', 'text', col => col.notNull().defaultTo('{}'))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();

  await db.schema.createTable('support_agent_views').ifNotExists()
    .addColumn('ticket_id', 'text', col => col.notNull().references('support_tickets.id').onDelete('cascade'))
    .addColumn('agent_id', 'text', col => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('is_typing', 'integer', col => col.notNull().defaultTo(0))
    .addColumn('last_seen_at', 'text', col => col.notNull())
    .addPrimaryKeyConstraint('pk_support_agent_views', ['ticket_id', 'agent_id'])
    .execute();

  await db.schema.createTable('support_sales_tickets').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('sales_ticket_no', 'text', col => col.notNull().unique())
    .addColumn('support_ticket_id', 'text', col => col.notNull().references('support_tickets.id').onDelete('cascade'))
    .addColumn('customer_id', 'text', col => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('order_id', 'text', col => col.references('orders.id').onDelete('set null'))
    .addColumn('created_by', 'text', col => col.references('users.id').onDelete('set null'))
    .addColumn('sales_manager_id', 'text', col => col.references('users.id').onDelete('set null'))
    .addColumn('category', 'text', col => col.notNull().defaultTo('store_support'))
    .addColumn('priority', 'text', col => col.notNull().defaultTo('normal'))
    .addColumn('subject', 'text', col => col.notNull())
    .addColumn('summary', 'text', col => col.notNull())
    .addColumn('status', 'text', col => col.notNull().defaultTo('new'))
    .addColumn('resolution_note', 'text')
    .addColumn('due_at', 'text')
    .addColumn('resolved_at', 'text')
    .addColumn('created_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .addColumn('updated_at', 'text', col => col.notNull().defaultTo(nowDefault))
    .execute();

  await ensureColumns(db, 'support_tickets', {
    public_no: 'text', team_id: 'text', agent_id: 'text', category: 'text', subcategory: 'text',
    channel: 'text', customer_priority: 'text', final_priority: 'text', intent: 'text',
    sentiment: 'text', language: 'text', order_id: 'text', product_id: 'text',
    payment_id: 'text', shipment_id: 'text', return_id: 'text',
    last_customer_message_at: 'text', last_agent_message_at: 'text',
    first_response_due_at: 'text', next_response_due_at: 'text', resolution_due_at: 'text',
    closed_at: 'text', escalation_reason: 'text', state_version: 'integer',
    idempotency_key: 'text', snoozed_until: 'text', unread_customer: 'integer',
    unread_agent: 'integer', ai_failure_count: 'integer', last_activity_at: 'text',
    snooze_reason: 'text', escalation_requested_at: 'text', sla_paused_at: 'text',
    first_response_remaining_seconds: 'integer', next_response_remaining_seconds: 'integer',
    resolution_remaining_seconds: 'integer',
  });
  await ensureColumns(db, 'support_assignments', {
    team_id: 'text', assignment_version: 'integer', updated_at: 'text',
  });
  await ensureColumns(db, 'ai_escalations', {
    active: 'integer', resolved_at: 'text',
  });
  await ensureColumns(db, 'support_messages', {
    sender_type: 'text', message_type: 'text', reply_to_id: 'text', channel: 'text',
    sanitized_body: 'text', delivery_status: 'text', delivered_at: 'text', read_at: 'text',
    ai_run_id: 'text', metadata: 'text', edited_at: 'text', deleted_at: 'text',
    idempotency_key: 'text', record_version: 'integer',
  });
  await db.updateTable('support_agent_profiles').set({ capacity: 8 }).where('capacity', '>', 8).execute();

  const indexes = [
    ['idx_support_ticket_status_activity', 'support_tickets', ['status', 'last_activity_at']],
    ['idx_support_ticket_team_status', 'support_tickets', ['team_id', 'status']],
    ['idx_support_ticket_agent_status', 'support_tickets', ['agent_id', 'status']],
    ['idx_support_ticket_sla', 'support_tickets', ['status', 'first_response_due_at', 'resolution_due_at']],
    ['idx_support_ticket_entities', 'support_tickets', ['order_id', 'product_id']],
    ['idx_support_messages_ticket_created', 'support_messages', ['ticket_id', 'created_at']],
    ['idx_support_events_ticket_created', 'support_events', ['ticket_id', 'created_at']],
    ['idx_support_events_target_created', 'support_events', ['target_user_id', 'created_at']],
    ['idx_support_history_ticket_created', 'support_assignment_history', ['ticket_id', 'created_at']],
    ['idx_support_status_history_ticket_created', 'support_status_history', ['ticket_id', 'created_at']],
    ['idx_support_unread_activity', 'support_tickets', ['unread_agent', 'unread_customer', 'last_activity_at']],
    ['idx_support_snooze_due', 'support_tickets', ['status', 'snoozed_until']],
    ['idx_support_supervisor_status', 'support_supervisor_requests', ['status', 'created_at']],
    ['idx_support_sales_status_due', 'support_sales_tickets', ['status', 'due_at']],
    ['idx_support_sales_support_ticket', 'support_sales_tickets', ['support_ticket_id', 'created_at']],
    ['idx_knowledge_chunks_document', 'knowledge_chunks', ['document_id', 'chunk_index']],
    ['idx_ai_runs_ticket_created', 'ai_runs', ['ticket_id', 'created_at']],
  ];
  for (const [name, table, columns] of indexes) {
    await db.schema.createIndex(name).ifNotExists().on(table).columns(columns).execute();
  }
  await db.schema.createIndex('uq_support_ticket_idempotency').ifNotExists().unique()
    .on('support_tickets').columns(['user_id', 'idempotency_key']).execute();
  await db.schema.createIndex('uq_support_message_idempotency').ifNotExists().unique()
    .on('support_messages').columns(['ticket_id', 'idempotency_key']).execute();
  // Additive repair: old versions could persist assigned tickets without an owner or
  // write ticket.agent_id without the canonical assignment row.
  await db.updateTable('support_tickets').set({
    status: 'queued', updated_at: new Date().toISOString(),
  }).where('status', '=', 'assigned').where('agent_id', 'is', null).execute();
  const assignedTickets = await db.selectFrom('support_tickets')
    .select(['id', 'agent_id', 'team_id', 'updated_at'])
    .where('agent_id', 'is not', null).execute();
  for (const ticket of assignedTickets) {
    await db.insertInto('support_assignments').values({
      ticket_id: ticket.id,
      agent_id: ticket.agent_id,
      team_id: ticket.team_id,
      assigned_by: null,
      assigned_at: ticket.updated_at || new Date().toISOString(),
      assignment_version: 1,
      updated_at: ticket.updated_at || new Date().toISOString(),
    }).onConflict(oc => oc.column('ticket_id').doUpdateSet({
      agent_id: ticket.agent_id,
      team_id: ticket.team_id,
      updated_at: ticket.updated_at || new Date().toISOString(),
    })).execute();
  }
  // Historical rows remain inactive; the next handoff marks exactly one current row.
}
