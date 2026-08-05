import { randomUUID } from 'node:crypto';
import app, { ready } from '../server/app.js';
import { db } from '../server/db.js';

let initialized;
let consultationTableReady;

async function ensureConsultationTable() {
  consultationTableReady ||= db.schema.createTable('consultation_requests').ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('full_name', 'text', col => col.notNull())
    .addColumn('organization', 'text', col => col.notNull())
    .addColumn('phone', 'text', col => col.notNull())
    .addColumn('topic', 'text', col => col.notNull())
    .addColumn('message', 'text', col => col.notNull())
    .addColumn('status', 'text', col => col.notNull().defaultTo('new'))
    .addColumn('source', 'text', col => col.notNull().defaultTo('website'))
    .addColumn('created_at', 'text', col => col.notNull())
    .execute();
  return consultationTableReady;
}

const clean = (value, max) => String(value || '').trim().slice(0, max);

export default async function handler(req, res) {
  initialized ||= ready();
  await initialized;

  const pathname = String(req.url || '').split('?')[0];
  if (pathname === '/api/consultation-requests' && req.method === 'POST') {
    const body = req.body || {};
    const row = {
      id: randomUUID(),
      full_name: clean(body.fullName, 120),
      organization: clean(body.organization, 160),
      phone: clean(body.phone, 24),
      topic: clean(body.topic, 160),
      message: clean(body.message, 4000),
      status: 'new',
      source: 'website',
      created_at: new Date().toISOString(),
    };
    if (row.full_name.length < 3 || row.organization.length < 2 || row.phone.length < 10 || row.topic.length < 3 || row.message.length < 10) {
      return res.status(400).json({ error: 'اطلاعات مشاوره را کامل وارد کنید.' });
    }
    await ensureConsultationTable();
    await db.insertInto('consultation_requests').values(row).execute();
    return res.status(201).json({ id: row.id, ok: true });
  }

  return app(req, res);
}
