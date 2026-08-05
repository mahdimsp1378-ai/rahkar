import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, resolve, sep } from 'node:path';
import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { sql } from 'kysely';
import { z } from 'zod';
import { createEmbedding, generateGroundedAnswer, getAiConfig } from './ai-provider.js';
import { canonicalSupportTopic, SUPPORT_TOPIC_IDS } from '../shared/support-topics.js';
import { scanUploadedFile } from './malware-scanner.js';

const uuid = () => randomUUID();
const now = () => new Date().toISOString();
const parseJson = (value, fallback) => {
  try { return JSON.parse(value || ''); } catch { return fallback; }
};
const cleanText = value => String(value || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
const hashFile = value => createHash('sha256').update(value).digest('hex');
const publicNo = () => `AR-${new Date().toISOString().slice(2, 10).replaceAll('-', '')}-${String(Date.now()).slice(-6)}`;
let rebalanceRequester = async () => 0;
export const requestSupportRebalance = () => rebalanceRequester();

export const supportStatuses = [
  'new', 'ai_active', 'ai_waiting_customer', 'queued', 'assigned', 'agent_active',
  'waiting_customer', 'waiting_internal', 'snoozed', 'resolved', 'closed', 'reopened',
];
export const supportTransitions = {
  new: ['ai_active', 'queued', 'closed'],
  ai_active: ['ai_waiting_customer', 'queued', 'resolved'],
  ai_waiting_customer: ['ai_active', 'queued', 'resolved'],
  queued: ['assigned', 'closed'],
  assigned: ['agent_active', 'queued', 'waiting_internal', 'snoozed'],
  agent_active: ['waiting_customer', 'waiting_internal', 'snoozed', 'resolved'],
  waiting_customer: ['agent_active', 'resolved', 'snoozed'],
  waiting_internal: ['agent_active', 'waiting_customer', 'snoozed', 'resolved'],
  snoozed: ['queued', 'assigned', 'agent_active'],
  resolved: ['closed', 'reopened'],
  closed: ['reopened'],
  reopened: ['ai_active', 'queued', 'assigned', 'agent_active'],
};
const workloadStatuses = ['assigned', 'agent_active', 'waiting_customer', 'waiting_internal', 'reopened'];

export const SUPPORT_PERMISSION_KEYS = [
  'support.tickets.view', 'support.tickets.reply', 'support.tickets.assign',
  'support.tickets.transfer', 'support.tickets.close', 'support.tickets.reopen',
  'support.tickets.bulk_manage', 'support.notes.create', 'support.attachments.manage',
  'support.customers.context', 'support.macros.manage', 'support.tags.manage',
  'support.sla.manage', 'support.teams.manage', 'support.agents.manage',
  'support.reports.view', 'support.reports.export', 'support.audit.view',
  'support.knowledge.view', 'support.knowledge.manage', 'support.ai.configure',
  'support.ai.view_logs',
];

const normalizePermissions = rawValue => {
  const raw = typeof rawValue === 'string' ? parseJson(rawValue, {}) : (rawValue || {});
  const legacy = {
    'support.tickets.view': raw.view,
    'support.tickets.reply': raw.reply,
    'support.tickets.assign': raw.assign,
    'support.tickets.transfer': raw.assign,
    'support.tickets.close': raw.close,
    'support.tickets.reopen': raw.close,
    'support.tickets.bulk_manage': raw.assign,
    'support.notes.create': raw.reply,
    'support.attachments.manage': raw.reply,
    'support.customers.context': raw.view,
    'support.reports.view': raw.reports,
    'support.reports.export': raw.reports,
    'support.knowledge.view': raw.view,
  };
  return Object.fromEntries(SUPPORT_PERMISSION_KEYS.map(key => [key, Boolean(raw[key] ?? legacy[key])]));
};

const defaultWorkingHours = {
  saturday: [['08:00', '17:00']], sunday: [['08:00', '17:00']],
  monday: [['08:00', '17:00']], tuesday: [['08:00', '17:00']],
  wednesday: [['08:00', '17:00']], thursday: [['08:00', '13:00']], friday: [],
};
const weekdayMap = { Sat: 'saturday', Sun: 'sunday', Mon: 'monday', Tue: 'tuesday', Wed: 'wednesday', Thu: 'thursday', Fri: 'friday' };
const zonedParts = (date, timezone) => {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, weekday: 'short', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return {
    weekday: weekdayMap[values.weekday],
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  };
};
const addBusinessMinutes = (start, minutes, team) => {
  const timezone = team?.timezone || 'Asia/Tehran';
  const hours = parseJson(team?.working_hours, defaultWorkingHours);
  const holidays = new Set(parseJson(team?.holidays, []));
  let cursor = new Date(start);
  let remaining = Math.max(1, Number(minutes || 1));
  let guard = 0;
  while (remaining > 0 && guard < 60_000) {
    cursor = new Date(cursor.getTime() + 60_000);
    const local = zonedParts(cursor, timezone);
    const active = !holidays.has(local.date) && (hours[local.weekday] || []).some(([from, to]) => local.time >= from && local.time < to);
    if (active) remaining -= 1;
    guard += 1;
  }
  return cursor.toISOString();
};

const tokenize = value => cleanText(value).toLowerCase()
  .replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(token => token.length > 1);
const localEmbedding = value => {
  const vector = Array(128).fill(0);
  for (const token of tokenize(value)) {
    const digest = createHash('sha256').update(token).digest();
    const index = digest.readUInt16BE(0) % vector.length;
    vector[index] += (digest[2] & 1) ? 1 : -1;
  }
  const norm = Math.hypot(...vector) || 1;
  return vector.map(item => item / norm);
};
const cosine = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length
  ? a.reduce((sum, value, index) => sum + value * b[index], 0) : 0;
const chunkDocument = body => {
  const paragraphs = cleanText(body).split(/\n{2,}/).map(item => item.trim()).filter(Boolean);
  const chunks = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (current && `${current}\n\n${paragraph}`.length > 900) {
      chunks.push(current);
      current = paragraph;
    } else current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  if (current) chunks.push(current);
  return chunks.flatMap(item => item.length <= 1200 ? [item] : item.match(/[\s\S]{1,1100}(?:\s|$)/g) || [item]);
};

const injectionPattern = /(system prompt|developer message|ignore (all|previous)|دستور(?:های)? قبلی را نادیده|کلید api|api key|secret|متن سیستم|prompt injection)/i;
const severePattern = /(شکایت حقوقی|وکیل|آتش|برق.?گرفتگی|خطر جانی|انفجار|بازپرداخت|مغایرت پرداخت|پول کم شده|کلاهبرداری)/i;
const angryPattern = /(افتضاح|عصبانی|شاکی|بی.?مسئولیت|بدترین|مسخره|اعتراض شدید)/i;
const humanPattern = /(کارشناس انسانی|اپراتور|با آدم|انسان|مسئول پشتیبانی|وصل.*کارشناس)/i;
const classify = text => ({
  language: /[\u0600-\u06ff]/.test(text) ? 'fa' : 'unknown',
  intent: /پرداخت|فاکتور|بازپرداخت/.test(text) ? 'payment'
    : /سفارش|درخواست|پیگیری/.test(text) ? 'order'
      : /هوش مصنوعی|خودکار|اتوماسیون|گردش.?کار|\bai\b/i.test(text) ? 'ai_automation'
        : /داشبورد|گزارش|داده|اکسل|شاخص/.test(text) ? 'data_dashboard'
          : /سامانه|نرم.?افزار|سیستم اختصاصی|طراحی سیستم/.test(text) ? 'custom_system'
            : /استقرار|انتقال داده|آموزش|راه.?اندازی/.test(text) ? 'deployment' : 'general',
  sentiment: angryPattern.test(text) ? 'very_negative' : 'neutral',
  injection: injectionPattern.test(text),
  requestsHuman: humanPattern.test(text),
  sensitive: severePattern.test(text),
});

const sseClients = new Set();
const sendSse = (client, event) => {
  client.res.write(`id: ${event.id}\nevent: ${event.event_type}\ndata: ${JSON.stringify(event)}\n\n`);
};

export function createSupportV5Router({ db, auth, audit, uploadRoot }) {
  const router = express.Router();
  const rateLimit = async (key, max = 12, windowMs = 60_000) => {
    const timestamp = now();
    const resetAt = new Date(Date.now() + windowMs).toISOString();
    const row = await db.insertInto('rate_limit_buckets').values({ key, count: 1, reset_at: resetAt, updated_at: timestamp })
      .onConflict(conflict => conflict.column('key').doUpdateSet({
        count: sql`CASE WHEN reset_at <= ${timestamp} THEN 1 ELSE count + 1 END`,
        reset_at: sql`CASE WHEN reset_at <= ${timestamp} THEN ${resetAt} ELSE reset_at END`,
        updated_at: timestamp,
      })).returning(['count', 'reset_at']).executeTakeFirst();
    return Number(row?.count || 1) <= max;
  };
  const attachmentRoot = resolve(process.env.SUPPORT_UPLOAD_DIR || resolve(uploadRoot, '../support-private'));
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: Math.min(20 * 1024 * 1024, Number(process.env.SUPPORT_MAX_FILE_BYTES || 10 * 1024 * 1024)),
      files: Math.min(8, Number(process.env.SUPPORT_MAX_FILES || 5)),
    },
  });

  const createEvent = ({ ticketId = null, eventType, actorType = 'system', actorId = null, targetUserId = null, teamId = null, customerId = null, payload = {} }) => ({
    id: uuid(), ticket_id: ticketId, event_type: eventType, actor_type: actorType,
    actor_id: actorId, target_user_id: targetUserId, team_id: teamId,
    payload: JSON.stringify({ ...payload, customerId }), created_at: now(),
  });
  const broadcastEvent = async event => {
    const payload = parseJson(event.payload, {});
    const presented = { ...event, payload };
    const ticket = event.ticket_id
      ? await db.selectFrom('support_tickets').select(['agent_id']).where('id', '=', event.ticket_id).executeTakeFirst()
      : null;
    for (const client of sseClients) {
      const allowed = client.admin ||
        (!client.agent && (client.userId === event.target_user_id || client.userId === payload.customerId)) ||
        (client.agent && ticket && ticket.agent_id === client.userId);
      if (allowed) sendSse(client, presented);
    }
    return presented;
  };
  const emitEvent = async input => {
    const event = createEvent(input);
    await db.insertInto('support_events').values(event).execute();
    return await broadcastEvent(event);
  };
  const insertAudit = async (trx, req, action, entityType, entityId, metadata = null) => {
    await trx.insertInto('audit_events').values({
      id: uuid(), user_id: req.user?.id || null, action,
      entity_type: entityType || null, entity_id: entityId || null,
      ip: req.ip || null, user_agent: String(req.headers?.['user-agent'] || '').slice(0, 300) || null,
      metadata: metadata ? JSON.stringify(metadata) : null, created_at: now(),
    }).execute();
  };
  const insertStatusHistory = async (trx, { ticket, to, actorType, actorId, reason, stateVersion, metadata = {} }) => {
    await trx.insertInto('support_status_history').values({
      id: uuid(), ticket_id: ticket.id, from_status: ticket.status, to_status: to,
      actor_type: actorType, actor_id: actorId || null, reason: cleanText(reason) || null,
      state_version: stateVersion, metadata: JSON.stringify(metadata), created_at: now(),
    }).execute();
  };
  const upsertAssignment = async (trx, { ticketId, agentId, teamId, assignedBy, assignedAt, version }) => {
    await trx.insertInto('support_assignments').values({
      ticket_id: ticketId, agent_id: agentId, team_id: teamId || null,
      assigned_by: assignedBy || null, assigned_at: assignedAt,
      assignment_version: version, updated_at: assignedAt,
    }).onConflict(oc => oc.column('ticket_id').doUpdateSet({
      agent_id: agentId, team_id: teamId || null, assigned_by: assignedBy || null,
      assigned_at: assignedAt, assignment_version: version, updated_at: assignedAt,
    })).execute();
  };

  const ensureDefaults = async () => {
    const teams = [
      ['support-team-orders', 'پیگیری درخواست و سفارش', 'orders'],
      ['support-team-payments', 'پیشنهاد مالی، قرارداد و پرداخت', 'commercial'],
      ['support-team-solar', 'تحلیل نیاز و مشاوره اولیه', 'needs-analysis'],
      ['support-team-epc', 'سامانه اختصاصی سازمان', 'custom-system'],
      ['support-team-ups', 'هوش مصنوعی و خودکارسازی', 'ai-automation'],
      ['support-team-nano', 'داده، گزارش و داشبورد', 'data-dashboard'],
      ['support-team-academy', 'استقرار، انتقال داده و آموزش', 'deployment-training'],
    ];
    for (const [id, name, slug] of teams) {
      await db.insertInto('support_teams').values({
        id, name, slug, status: 'active', timezone: 'Asia/Tehran',
        working_hours: JSON.stringify(defaultWorkingHours), holidays: '[]',
        default_capacity: 8, created_by: null, created_at: now(), updated_at: now(),
      }).onConflict(oc => oc.column('id').doUpdateSet({ name, slug, status: 'active', updated_at: now() })).execute();
    }
    const policies = [
      ['sla-normal', 'SLA عادی', 'normal', 240, 480, 960],
      ['sla-high', 'SLA زیاد', 'high', 60, 120, 480],
      ['sla-critical', 'SLA بحرانی', 'critical', 15, 30, 240],
    ];
    for (const [id, name, priority, first, next, resolution] of policies) {
      await db.insertInto('support_sla_policies').values({
        id, name, priority, team_id: null, first_response_minutes: first,
        next_response_minutes: next, resolution_minutes: resolution,
        pause_on_waiting_customer: 1, warning_percent: 80, status: 'active',
        created_at: now(), updated_at: now(),
      }).onConflict(oc => oc.column('id').doNothing()).execute();
    }
  };

  const supportAccess = async (req, res, next) => {
    if (['admin', 'super_admin'].includes(req.user?.role)) {
      req.supportV5 = { admin: true, permissions: Object.fromEntries(SUPPORT_PERMISSION_KEYS.map(key => [key, true])), teamIds: [] };
      return next();
    }
    if (req.user?.role !== 'support_agent' || req.user.status !== 'active') return res.status(403).json({ error: 'دسترسی سامانه پشتیبانی لازم است.' });
    const member = await db.selectFrom('admin_members').select('permissions')
      .where('user_id', '=', req.user.id).where('section', '=', 'support').executeTakeFirst();
    if (!member) return res.status(403).json({ error: 'دسترسی پشتیبانی غیرفعال است.' });
    const teams = await db.selectFrom('support_team_members').select('team_id').where('agent_id', '=', req.user.id).execute();
    // teamIds are retained only for backward-compatible reporting and migration.
    // Ticket confidentiality is based on the canonical owner, never team membership.
    req.supportV5 = { admin: false, permissions: normalizePermissions(member.permissions), teamIds: teams.map(item => item.team_id) };
    if (!req.supportV5.permissions['support.tickets.view']) return res.status(403).json({ error: 'مجوز مشاهده تیکت فعال نیست.' });
    next();
  };
  const permission = key => (req, res, next) => req.supportV5?.permissions?.[key]
    ? next() : res.status(403).json({ error: 'این عملیات در سطح دسترسی شما فعال نیست.' });
  const customerOnly = (req, res, next) => req.user?.role === 'customer'
    ? next() : res.status(403).json({ error: 'این مسیر فقط برای حساب مشتری است.' });
  const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  const ownedTicket = async (req, id) => db.selectFrom('support_tickets').selectAll()
    .where('id', '=', id).where('user_id', '=', req.user.id).executeTakeFirst();
  const canViewTicket = (req, ticket) => {
    if (req.supportV5.admin) return ticket;
    return ticket.agent_id === req.user.id ? ticket : null;
  };
  const visibleTicket = async (req, id) => {
    const ticket = await db.selectFrom('support_tickets').selectAll().where('id', '=', id).executeTakeFirst();
    return ticket ? canViewTicket(req, ticket) : null;
  };
  const canOperateTicket = (req, ticket, overrideKey = 'support.tickets.transfer') =>
    req.supportV5.admin || ticket.agent_id === req.user.id;
  const rejectUnauthorizedOperation = async (req, res, ticket, action) => {
    await audit(req, 'support_unauthorized_operation', 'support_ticket', ticket.id, {
      attemptedAction: action, ownerId: ticket.agent_id || null,
    });
    return res.status(ticket.agent_id ? 409 : 403).json({
      error: ticket.agent_id ? 'این گفتگو در اختیار کارشناس دیگری است.' : 'این گفتگو هنوز در صف مرکزی و در انتظار تخصیص خودکار است.',
      ownerId: ticket.agent_id || null, readOnly: true,
    });
  };
  const chooseTeam = classification => ({
    payment: 'support-team-payments', order: 'support-team-orders',
    ai_automation: 'support-team-ups', data_dashboard: 'support-team-nano',
    custom_system: 'support-team-epc', deployment: 'support-team-academy',
    general: 'support-team-solar',
  }[classification.intent] || 'support-team-solar');
  const calculatePriority = ({ text, customerPriority, order }) => {
    let score = customerPriority === 'high' ? 2 : 0;
    if (severePattern.test(text)) score += 5;
    if (angryPattern.test(text)) score += 2;
    if (Number(order?.total || 0) >= Number(process.env.SUPPORT_VIP_ORDER_AMOUNT || 500_000_000)) score += 3;
    return score >= 6 ? 'critical' : score >= 3 ? 'high' : 'normal';
  };
  const applySla = async (priority, teamId, at = now()) => {
    const [policy, team] = await Promise.all([
      db.selectFrom('support_sla_policies').selectAll().where('priority', '=', priority)
        .where('status', '=', 'active')
        .where(eb => eb.or([eb('team_id', '=', teamId), eb('team_id', 'is', null)]))
        .orderBy(sql`CASE WHEN team_id = ${teamId} THEN 0 ELSE 1 END`)
        .executeTakeFirst(),
      db.selectFrom('support_teams').selectAll().where('id', '=', teamId).executeTakeFirst(),
    ]);
    return {
      first_response_due_at: addBusinessMinutes(at, policy?.first_response_minutes || 240, team),
      next_response_due_at: addBusinessMinutes(at, policy?.next_response_minutes || 480, team),
      resolution_due_at: addBusinessMinutes(at, policy?.resolution_minutes || 960, team),
    };
  };

  const agentWorkload = async (agentId, executor = db) => Number((await executor
    .selectFrom('support_tickets').select(({ fn }) => fn.countAll().as('count'))
    .where('agent_id', '=', agentId).where('status', 'in', workloadStatuses)
    .executeTakeFirst())?.count || 0);

  const capacityForAgent = async (agentId, executor = db) => {
    const profile = await executor.selectFrom('support_agent_profiles').select(['capacity', 'presence_status'])
      .where('agent_id', '=', agentId).executeTakeFirst();
    return {
      capacity: Math.min(8, Math.max(1, Number(profile?.capacity || 8))),
      open: await agentWorkload(agentId, executor),
      presence: profile?.presence_status || 'offline',
    };
  };

  const assignBestAvailableAgent = async (ticketId, classification = {}) => {
    const ticket = await db.selectFrom('support_tickets').selectAll().where('id', '=', ticketId).executeTakeFirst();
    if (!ticket || ticket.agent_id || ticket.status !== 'queued') return null;
    const candidates = await db.selectFrom('users')
      .innerJoin('admin_members', 'admin_members.user_id', 'users.id')
      .leftJoin('support_agent_profiles', 'support_agent_profiles.agent_id', 'users.id')
      .leftJoin('profiles', 'profiles.user_id', 'users.id')
      .select([
        'users.id', 'profiles.full_name', 'support_agent_profiles.capacity',
        'support_agent_profiles.presence_status', 'support_agent_profiles.last_seen_at',
      ])
      .where('users.role', '=', 'support_agent').where('users.status', '=', 'active')
      .where('admin_members.section', '=', 'support')
      .execute();
    if (!candidates.length) return null;
    const candidateIds = candidates.map(item => item.id);
    const [assignedRows, skillRows] = await Promise.all([
      db.selectFrom('support_tickets').select('agent_id')
        .where('agent_id', 'in', candidateIds).where('status', 'in', workloadStatuses).execute(),
      db.selectFrom('support_agent_skills')
        .innerJoin('support_skills', 'support_skills.id', 'support_agent_skills.skill_id')
        .select(['support_agent_skills.agent_id', 'support_skills.slug', 'support_agent_skills.level'])
        .where('support_agent_skills.agent_id', 'in', candidateIds).where('support_skills.status', '=', 'active').execute(),
    ]);
    const topicId = canonicalSupportTopic(ticket.category || classification.intent || ticket.intent || ticket.subcategory);
    const presenceRank = { online: 0, away: 1, offline: 2 };
    const ranked = candidates.map(agent => {
      const open = assignedRows.filter(item => item.agent_id === agent.id).length;
      const capacity = Math.min(8, Math.max(1, Number(agent.capacity || 8)));
      const topicLevel = Math.max(0, ...skillRows.filter(item => item.agent_id === agent.id && canonicalSupportTopic(item.slug) === topicId).map(item => Number(item.level || 0)));
      return { ...agent, open, capacity, topicLevel, isSpecialist: topicLevel > 0 };
    }).filter(agent => agent.open < agent.capacity).sort((a, b) =>
      Number(b.isSpecialist) - Number(a.isSpecialist) ||
      a.open - b.open ||
      b.topicLevel - a.topicLevel ||
      (presenceRank[a.presence_status] ?? 3) - (presenceRank[b.presence_status] ?? 3) ||
      String(a.last_seen_at || '').localeCompare(String(b.last_seen_at || '')));
    for (const agent of ranked) {
      const assignedAt = now();
      const stateVersion = Number(ticket.state_version || 0) + 1;
      const event = createEvent({
        ticketId: ticket.id, eventType: 'ticket.assigned', actorType: 'system',
        targetUserId: agent.id, teamId: ticket.team_id, customerId: ticket.user_id,
        payload: { agentId: agent.id, status: 'assigned', stateVersion, strategy: 'topic_skill_least_load' },
      });
      const assigned = await db.transaction().execute(async trx => {
        if (await agentWorkload(agent.id, trx) >= agent.capacity) return false;
        const changed = await trx.updateTable('support_tickets').set({
          agent_id: agent.id, status: 'assigned', state_version: stateVersion,
          updated_at: assignedAt, last_activity_at: assignedAt,
        }).where('id', '=', ticket.id).where('status', '=', 'queued').where('agent_id', 'is', null)
          .where(eb => eb.or([eb('state_version', '=', ticket.state_version), eb('state_version', 'is', null)]))
          .executeTakeFirst();
        if (Number(changed.numUpdatedRows || 0) !== 1) return false;
        await upsertAssignment(trx, {
          ticketId: ticket.id, agentId: agent.id, teamId: ticket.team_id,
          assignedBy: null, assignedAt, version: stateVersion,
        });
        await trx.insertInto('support_assignment_history').values({
          id: uuid(), ticket_id: ticket.id, from_agent_id: null, to_agent_id: agent.id,
          from_team_id: ticket.team_id, to_team_id: ticket.team_id, action: 'auto_assign',
          reason: agent.isSpecialist
            ? (agent.open === 0 ? 'تخصیص موضوعی به کارشناس بدون گفتگوی فعال' : 'تخصیص موضوعی به کم‌بارترین کارشناس')
            : 'تخصیص جایگزین به کم‌بارترین کارشناس زیر ظرفیت',
          actor_id: null, created_at: assignedAt,
        }).execute();
        await insertStatusHistory(trx, {
          ticket, to: 'assigned', actorType: 'system', actorId: null,
          reason: 'تخصیص خودکار ظرفیت‌محور', stateVersion,
          metadata: { strategy: 'topic_first_least_open_fallback', topicId, openBefore: agent.open, capacity: agent.capacity, topicLevel: agent.topicLevel, specialist: agent.isSpecialist },
        });
        await trx.insertInto('support_events').values(event).execute();
        await trx.insertInto('audit_events').values({
          id: uuid(), user_id: null, action: 'support_ticket_auto_assigned',
          entity_type: 'support_ticket', entity_id: ticket.id, ip: null, user_agent: null,
          metadata: JSON.stringify({ agentId: agent.id, topicId, openBefore: agent.open, capacity: agent.capacity, topicLevel: agent.topicLevel, specialist: agent.isSpecialist }),
          created_at: assignedAt,
        }).execute();
        return true;
      });
      if (assigned) {
        await broadcastEvent(event);
        return { agentId: agent.id, status: 'assigned', stateVersion };
      }
    }
    return null;
  };

  const searchKnowledge = async (query, scope = 'public', limit = 5) => {
    const docs = await db.selectFrom('knowledge_chunks')
      .innerJoin('knowledge_documents', 'knowledge_documents.id', 'knowledge_chunks.document_id')
      .innerJoin('knowledge_document_versions', 'knowledge_document_versions.id', 'knowledge_chunks.version_id')
      .select([
        'knowledge_chunks.id', 'knowledge_chunks.body', 'knowledge_chunks.embedding',
        'knowledge_chunks.version_id', 'knowledge_documents.id as document_id',
        'knowledge_documents.title', 'knowledge_documents.slug', 'knowledge_documents.scope',
        'knowledge_documents.valid_from', 'knowledge_documents.valid_until',
      ])
      .where('knowledge_documents.status', '=', 'published')
      .where('knowledge_documents.scope', 'in', scope === 'internal' ? ['public', 'internal'] : ['public'])
      .execute();
    const queryTerms = new Set(tokenize(query));
    const queryVector = localEmbedding(query);
    return docs.map(item => {
      const bodyTerms = tokenize(`${item.title} ${item.body}`);
      const hits = bodyTerms.filter(term => queryTerms.has(term)).length;
      const keyword = queryTerms.size ? Math.min(1, hits / Math.max(2, queryTerms.size)) : 0;
      const vector = cosine(queryVector, parseJson(item.embedding, localEmbedding(item.body)));
      return { ...item, score: keyword * 0.65 + Math.max(0, vector) * 0.35 };
    }).filter(item => item.score >= Number(process.env.AI_RETRIEVAL_THRESHOLD || 0.18))
      .sort((a, b) => b.score - a.score).slice(0, limit);
  };

  const escalate = async ({ ticket, reason, classification, aiRunId = null, confidence = 0, extra = {} }) => {
    const latest = await db.selectFrom('support_tickets').selectAll().where('id', '=', ticket.id).executeTakeFirstOrThrow();
    const alreadyHuman = ['queued', 'assigned', 'agent_active', 'waiting_customer', 'waiting_internal', 'snoozed'].includes(latest.status);
    const activeEscalation = await db.selectFrom('ai_escalations').selectAll()
      .where('ticket_id', '=', latest.id).where('active', '=', 1).executeTakeFirst();
    if (alreadyHuman || activeEscalation) {
      return {
        reused: true, status: latest.status, agentId: latest.agent_id,
        requestedAt: latest.escalation_requested_at || activeEscalation?.created_at || null,
      };
    }
    const summary = `آخرین درخواست مشتری: ${cleanText(extra.lastMessage || '').slice(0, 500)}\nدلیل انتقال: ${reason}`;
    const createdAt = now();
    const teamId = latest.team_id || chooseTeam(classification);
    const stateVersion = Number(latest.state_version || 0) + 1;
    const event = createEvent({
      ticketId: latest.id, eventType: 'ticket.escalated', actorType: 'ai',
      teamId, customerId: latest.user_id,
      payload: { reason, status: 'queued', ticketNo: latest.public_no || latest.ticket_no, requestedAt: createdAt },
    });
    await db.transaction().execute(async trx => {
      await trx.updateTable('support_tickets').set({
        status: 'queued', team_id: teamId, agent_id: null,
        escalation_reason: reason, intent: classification.intent, sentiment: classification.sentiment,
        escalation_requested_at: createdAt, state_version: stateVersion,
        updated_at: createdAt, last_activity_at: createdAt,
      }).where('id', '=', latest.id).where(eb => eb.or([
        eb('state_version', '=', latest.state_version), eb('state_version', 'is', null),
      ])).execute();
      await trx.updateTable('ai_escalations').set({ active: null, resolved_at: createdAt })
        .where('ticket_id', '=', latest.id).where('active', '=', 1).execute();
      await trx.insertInto('ai_escalations').values({
        id: uuid(), ticket_id: latest.id, ai_run_id: aiRunId, reason, summary,
        intent: classification.intent, sentiment: classification.sentiment,
        confidence: String(confidence), context: JSON.stringify(extra), active: 1,
        resolved_at: null, created_at: createdAt,
      }).execute();
      await insertStatusHistory(trx, {
        ticket: latest, to: 'queued', actorType: 'ai', actorId: null,
        reason, stateVersion, metadata: { handoff: true },
      });
      await trx.insertInto('support_events').values(event).execute();
      await trx.insertInto('notifications').values({
        id: uuid(), user_id: latest.user_id, title: 'درخواست اتصال ثبت شد',
        body: `گفتگوی ${latest.public_no || latest.ticket_no} در صف کارشناس انسانی قرار گرفت.`,
        read_at: null, created_at: createdAt,
      }).execute();
    });
    await broadcastEvent(event);
    const assignment = await assignBestAvailableAgent(latest.id, classification);
    return {
      reused: false, status: assignment?.status || 'queued',
      agentId: assignment?.agentId || null, requestedAt: createdAt,
    };
  };

  const runAi = async (ticket, customerMessage) => {
    const classification = classify(customerMessage.body);
    if (classification.requestsHuman) return escalate({ ticket, reason: 'درخواست صریح کارشناس انسانی', classification, extra: { lastMessage: customerMessage.body } });
    if (classification.injection) return escalate({ ticket, reason: 'تشخیص تلاش برای Prompt Injection', classification, extra: { lastMessage: customerMessage.body } });
    if (classification.sensitive || classification.sentiment === 'very_negative') {
      return escalate({ ticket, reason: classification.sensitive ? 'موضوع حساس یا نیازمند اقدام انسانی' : 'نارضایتی شدید مشتری', classification, extra: { lastMessage: customerMessage.body } });
    }
    const aiConfig = getAiConfig();
    const today = new Date().toISOString().slice(0, 10);
    const contexts = await searchKnowledge(customerMessage.body, 'public', 5);
    const confidence = contexts.length ? Math.min(0.98, contexts[0].score + (contexts.length > 1 ? 0.12 : 0)) : 0;
    const runId = uuid();
    await db.insertInto('ai_runs').values({
      id: runId, ticket_id: ticket.id, message_id: customerMessage.id,
      provider: aiConfig.provider, model: aiConfig.model, intent: classification.intent,
      sentiment: classification.sentiment, confidence: String(confidence), status: 'running',
      input_tokens: 0, output_tokens: 0, cost_micros: 0, tool_calls: '[]',
      error_code: null, created_at: now(), completed_at: null,
    }).execute();
    if (!contexts.length || confidence < Number(process.env.AI_CONFIDENCE_THRESHOLD || 0.48)) {
      await db.updateTable('ai_runs').set({ status: 'insufficient_evidence', completed_at: now() }).where('id', '=', runId).execute();
      return escalate({ ticket, reason: 'نبود منبع معتبر یا Confidence پایین', classification, aiRunId: runId, confidence, extra: { lastMessage: customerMessage.body, sources: contexts.map(item => item.document_id) } });
    }
    const reservedCost = aiConfig.provider === 'mock' ? 0 : Math.max(1, Number(process.env.AI_MAX_REQUEST_COST_MICROS || 200_000));
    if (reservedCost) {
      const reserved = await db.transaction().execute(async trx => {
        await trx.insertInto('ai_budget_daily').values({ budget_date: today, spent_micros: 0, reserved_micros: 0, updated_at: now() })
          .onConflict(conflict => conflict.column('budget_date').doNothing()).execute();
        return trx.updateTable('ai_budget_daily').set({ reserved_micros: sql`reserved_micros + ${reservedCost}`, updated_at: now() })
          .where('budget_date', '=', today)
          .where(sql`spent_micros + reserved_micros + ${reservedCost}`, '<=', aiConfig.dailyCostLimitMicros).executeTakeFirst();
      });
      if (Number(reserved.numUpdatedRows || 0) !== 1) {
        await db.updateTable('ai_runs').set({ status: 'budget_exceeded', completed_at: now() }).where('id', '=', runId).execute();
        return escalate({ ticket, reason: 'سقف هزینه روزانه هوش مصنوعی', classification, aiRunId: runId, confidence, extra: { lastMessage: customerMessage.body } });
      }
    }
    try {
      const answer = await generateGroundedAnswer({ question: customerMessage.body, contexts });
      if (/INSUFFICIENT_EVIDENCE/i.test(answer.text)) {
        if (reservedCost) await db.updateTable('ai_budget_daily').set({ reserved_micros: sql`CASE WHEN reserved_micros >= ${reservedCost} THEN reserved_micros - ${reservedCost} ELSE 0 END`, updated_at: now() }).where('budget_date', '=', today).execute();
        await db.updateTable('ai_runs').set({ status: 'insufficient_evidence', completed_at: now() }).where('id', '=', runId).execute();
        return escalate({ ticket, reason: 'Provider پاسخ مستند کافی تولید نکرد', classification, aiRunId: runId, confidence, extra: { lastMessage: customerMessage.body } });
      }
      const messageId = uuid();
      const createdAt = now();
      const inputRate = Math.max(0, Number(process.env.AI_INPUT_COST_MICROS_PER_MILLION || 500_000));
      const outputRate = Math.max(0, Number(process.env.AI_OUTPUT_COST_MICROS_PER_MILLION || 1_500_000));
      const actualCost = aiConfig.provider === 'mock' ? 0 : Math.max(1, Math.ceil((Number(answer.inputTokens || 0) * inputRate + Number(answer.outputTokens || 0) * outputRate) / 1_000_000));
      await db.transaction().execute(async trx => {
        await trx.insertInto('support_messages').values({
          id: messageId, ticket_id: ticket.id, sender_id: ticket.user_id,
          sender_type: 'ai', message_type: 'public_reply', body: cleanText(answer.text),
          sanitized_body: cleanText(answer.text), delivery_status: 'sent', channel: 'web',
          ai_run_id: runId, metadata: JSON.stringify({ identity: 'دستیار هوشمند راهکار' }),
          record_version: 1, idempotency_key: `ai:${runId}`, created_at: createdAt,
        }).execute();
        await trx.updateTable('ai_runs').set({
          provider: answer.provider, model: answer.model, status: 'completed',
          input_tokens: answer.inputTokens, output_tokens: answer.outputTokens,
          cost_micros: actualCost, completed_at: createdAt,
        }).where('id', '=', runId).execute();
        if (reservedCost) await trx.updateTable('ai_budget_daily').set({
          reserved_micros: sql`CASE WHEN reserved_micros >= ${reservedCost} THEN reserved_micros - ${reservedCost} ELSE 0 END`,
          spent_micros: sql`spent_micros + ${actualCost}`, updated_at: createdAt,
        }).where('budget_date', '=', today).execute();
        for (const item of contexts.slice(0, 3)) {
          await trx.insertInto('ai_citations').values({
            id: uuid(), ai_run_id: runId, message_id: messageId,
            document_id: item.document_id, version_id: item.version_id, chunk_id: item.id,
            title_snapshot: item.title, slug_snapshot: item.slug,
            excerpt: cleanText(item.body).slice(0, 280), created_at: createdAt,
          }).execute();
        }
        await trx.updateTable('support_tickets').set({
          status: 'ai_waiting_customer', intent: classification.intent,
          sentiment: classification.sentiment, language: classification.language,
          last_agent_message_at: createdAt, unread_customer: sql`COALESCE(unread_customer, 0) + 1`,
          state_version: sql`COALESCE(state_version, 0) + 1`,
          updated_at: createdAt, last_activity_at: createdAt,
        }).where('id', '=', ticket.id).execute();
        await insertStatusHistory(trx, {
          ticket, to: 'ai_waiting_customer', actorType: 'ai', actorId: null,
          reason: 'پاسخ مستند هوش مصنوعی', stateVersion: Number(ticket.state_version || 0) + 1,
          metadata: { aiRunId: runId },
        });
        await trx.insertInto('notifications').values({
          id: uuid(), user_id: ticket.user_id, title: 'پاسخ دستیار هوشمند',
          body: `برای گفتگوی ${ticket.public_no || ticket.ticket_no} پاسخ مستند ثبت شد.`,
          read_at: null, created_at: createdAt,
        }).execute();
      });
      await emitEvent({
        ticketId: ticket.id, eventType: 'message.created', actorType: 'ai',
        customerId: ticket.user_id, payload: { messageId, senderType: 'ai', status: 'ai_waiting_customer' },
      });
    } catch (error) {
      if (reservedCost) await db.updateTable('ai_budget_daily').set({ reserved_micros: sql`CASE WHEN reserved_micros >= ${reservedCost} THEN reserved_micros - ${reservedCost} ELSE 0 END`, updated_at: now() }).where('budget_date', '=', today).execute();
      await db.updateTable('ai_runs').set({ status: 'failed', error_code: error.code || 'provider_error', completed_at: now() }).where('id', '=', runId).execute();
      await escalate({ ticket, reason: error.code === 'timeout' ? 'Timeout Provider' : 'خطای Provider هوش مصنوعی', classification, aiRunId: runId, confidence, extra: { lastMessage: customerMessage.body, errorCode: error.code || 'provider_error' } });
    }
  };

  router.use(['/support', '/support-agent', '/support-admin'], asyncRoute(async (_req, _res, next) => { await ensureDefaults(); next(); }));

  router.get('/support/tickets', auth, customerOnly, asyncRoute(async (req, res) => {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));
    const statusFilter = cleanText(req.query.status);
    let query = db.selectFrom('support_tickets').selectAll().where('user_id', '=', req.user.id);
    if (statusFilter && supportStatuses.includes(statusFilter)) query = query.where('status', '=', statusFilter);
    const [items, count] = await Promise.all([
      query.orderBy('last_activity_at', 'desc').orderBy('created_at', 'desc').limit(limit).offset((page - 1) * limit).execute(),
      db.selectFrom('support_tickets').select(({ fn }) => fn.countAll().as('count')).where('user_id', '=', req.user.id).executeTakeFirst(),
    ]);
    res.json({ items, page, limit, total: Number(count?.count || 0), hasMore: page * limit < Number(count?.count || 0) });
  }));

  router.post('/support/tickets', auth, customerOnly, asyncRoute(async (req, res) => {
    if (!await rateLimit(`ticket:${req.user.id}`, 5, 10 * 60_000)) return res.status(429).json({ error: 'تعداد درخواست‌ها زیاد است؛ چند دقیقه بعد دوباره تلاش کنید.' });
    const parsed = z.object({
      subject: z.string().trim().min(3).max(160),
      message: z.string().trim().min(2).max(4000),
      priority: z.enum(['normal', 'high']).default('normal'),
      category: z.string().trim().max(100).optional(),
      orderId: z.string().nullable().optional(), productId: z.string().nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'موضوع یا متن پیام معتبر نیست.', fields: parsed.error.flatten().fieldErrors });
    const idempotencyKey = cleanText(req.headers['idempotency-key'] || req.body?.idempotencyKey);
    if (idempotencyKey.length < 8 || idempotencyKey.length > 100) return res.status(400).json({ error: 'شناسه Idempotency معتبر ارسال نشده است.' });
    const existing = await db.selectFrom('support_tickets').selectAll()
      .where('user_id', '=', req.user.id).where('idempotency_key', '=', idempotencyKey).executeTakeFirst();
    if (existing) return res.status(200).json({ id: existing.id, ticketNo: existing.public_no || existing.ticket_no, reused: true });
    let order = null;
    if (parsed.data.orderId) {
      order = await db.selectFrom('orders').selectAll().where('id', '=', parsed.data.orderId).where('user_id', '=', req.user.id).executeTakeFirst();
      if (!order) return res.status(404).json({ error: 'سفارش متعلق به این حساب پیدا نشد.' });
    }
    if (parsed.data.productId) {
      const product = await db.selectFrom('products').select('id').where('id', '=', parsed.data.productId).executeTakeFirst();
      if (!product) return res.status(404).json({ error: 'محصول پیدا نشد.' });
    }
    const classification = classify(parsed.data.message);
    const teamId = chooseTeam(classification);
    const finalPriority = calculatePriority({ text: parsed.data.message, customerPriority: parsed.data.priority, order });
    const sla = await applySla(finalPriority, teamId);
    const id = uuid();
    const messageId = uuid();
    const createdAt = now();
    const number = publicNo();
    await db.transaction().execute(async trx => {
      await trx.insertInto('support_tickets').values({
        id, user_id: req.user.id, ticket_no: number, public_no: number, subject: parsed.data.subject,
        status: 'ai_active', priority: finalPriority, customer_priority: parsed.data.priority,
        final_priority: finalPriority, category: canonicalSupportTopic(parsed.data.category || classification.intent), channel: 'web',
        intent: classification.intent, sentiment: classification.sentiment, language: classification.language,
        team_id: teamId, agent_id: null, order_id: parsed.data.orderId || null,
        product_id: parsed.data.productId || null, idempotency_key: idempotencyKey,
        state_version: 1, unread_customer: 0, unread_agent: 1, ai_failure_count: 0,
        last_customer_message_at: createdAt, last_activity_at: createdAt,
        ...sla, updated_at: createdAt, created_at: createdAt,
      }).execute();
      await trx.insertInto('support_messages').values({
        id: messageId, ticket_id: id, sender_id: req.user.id, sender_type: 'customer',
        message_type: 'public_reply', body: parsed.data.message, sanitized_body: cleanText(parsed.data.message),
        delivery_status: 'sent', channel: 'web', metadata: '{}', record_version: 1,
        idempotency_key: `${idempotencyKey}:initial`, created_at: createdAt,
      }).execute();
      await trx.insertInto('support_status_history').values({
        id: uuid(), ticket_id: id, from_status: null, to_status: 'ai_active',
        actor_type: 'customer', actor_id: req.user.id, reason: 'ایجاد گفتگو',
        state_version: 1, metadata: '{}', created_at: createdAt,
      }).execute();
    });
    const ticket = await db.selectFrom('support_tickets').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    await emitEvent({ ticketId: id, eventType: 'ticket.created', actorType: 'customer', actorId: req.user.id, teamId, customerId: req.user.id, payload: { ticketNo: number, status: 'ai_active' } });
    await audit(req, 'support_ticket_created_v5', 'support_ticket', id, { teamId, finalPriority });
    await runAi(ticket, { id: messageId, body: parsed.data.message });
    const current = await db.selectFrom('support_tickets').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    res.status(201).json({ id, ticketNo: number, status: current.status, reused: false });
  }));

  router.get('/support/tickets/:id/messages', auth, customerOnly, asyncRoute(async (req, res) => {
    const ticket = await ownedTicket(req, req.params.id);
    if (!ticket) return res.status(404).json({ error: 'گفتگو پیدا نشد.' });
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 40)));
    const before = cleanText(req.query.before);
    let query = db.selectFrom('support_messages').selectAll().where('ticket_id', '=', ticket.id)
      .where('message_type', '!=', 'internal_note').where('deleted_at', 'is', null);
    if (before) query = query.where('created_at', '<', before);
    const messages = await query.orderBy('created_at', 'desc').limit(limit).execute();
    const ids = messages.map(item => item.id);
    const [attachments, citations, reads, assignment, agent, team] = await Promise.all([
      ids.length ? db.selectFrom('support_attachments').selectAll().where('message_id', 'in', ids).where('deleted_at', 'is', null).execute() : [],
      ids.length ? db.selectFrom('ai_citations').selectAll().where('message_id', 'in', ids).execute() : [],
      ids.length ? db.selectFrom('support_message_reads').selectAll().where('message_id', 'in', ids).execute() : [],
      db.selectFrom('support_assignments').selectAll().where('ticket_id', '=', ticket.id).executeTakeFirst(),
      ticket.agent_id ? db.selectFrom('users').leftJoin('profiles', 'profiles.user_id', 'users.id')
        .leftJoin('support_agent_profiles', 'support_agent_profiles.agent_id', 'users.id')
        .select(['users.id', 'profiles.full_name', 'profiles.avatar_url', 'support_agent_profiles.presence_status', 'support_agent_profiles.last_heartbeat_at', 'support_agent_profiles.title'])
        .where('users.id', '=', ticket.agent_id).executeTakeFirst() : null,
      ticket.team_id ? db.selectFrom('support_teams').select(['id', 'name', 'timezone']).where('id', '=', ticket.team_id).executeTakeFirst() : null,
    ]);
    const freshAgent = agent && agent.last_heartbeat_at && Date.now() - new Date(agent.last_heartbeat_at).getTime() < 90_000
      ? agent : agent ? { ...agent, presence_status: 'offline' } : null;
    res.json({
      ticket: { ...ticket, agent_id: ticket.agent_id || assignment?.agent_id || null },
      agent: freshAgent,
      messages: messages.reverse().map(item => ({
        ...item,
        readReceipts: reads.filter(row => row.message_id === item.id),
        delivery_status: reads.some(row => row.message_id === item.id && row.read_at)
          ? 'read' : reads.some(row => row.message_id === item.id && row.delivered_at) ? 'delivered' : item.delivery_status,
        attachments: attachments.filter(row => row.message_id === item.id).map(({ storage_name, ...safe }) => safe),
        citations: citations.filter(row => row.message_id === item.id),
      })),
      team,
      hasMore: messages.length === limit,
    });
  }));

  router.post('/support/tickets/:id/messages', auth, customerOnly, asyncRoute(async (req, res) => {
    if (!await rateLimit(`message:${req.user.id}`, 15)) return res.status(429).json({ error: 'پیام‌ها خیلی سریع ارسال می‌شوند؛ کمی صبر کنید.' });
    const ticket = await ownedTicket(req, req.params.id);
    if (!ticket) return res.status(404).json({ error: 'گفتگو پیدا نشد.' });
    const parsed = z.object({
      body: z.string().trim().min(1).max(4000), replyToId: z.string().nullable().optional(),
      attachmentIds: z.array(z.string()).max(5).default([]),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'پیام باید بین ۱ تا ۴۰۰۰ نویسه باشد.' });
    const key = cleanText(req.headers['idempotency-key'] || req.body?.idempotencyKey);
    if (key.length < 8 || key.length > 100) return res.status(400).json({ error: 'شناسه Idempotency معتبر ارسال نشده است.' });
    const existing = await db.selectFrom('support_messages').selectAll().where('ticket_id', '=', ticket.id).where('idempotency_key', '=', key).executeTakeFirst();
    if (existing) return res.status(200).json({ message: existing, reused: true });
    if (['closed', 'resolved'].includes(ticket.status)) return res.status(409).json({ error: 'ابتدا گفتگو را دوباره باز کنید.' });
    if (parsed.data.replyToId) {
      const parent = await db.selectFrom('support_messages').select('id').where('id', '=', parsed.data.replyToId).where('ticket_id', '=', ticket.id).executeTakeFirst();
      if (!parent) return res.status(400).json({ error: 'پیام مرجع معتبر نیست.' });
    }
    const attachmentRows = parsed.data.attachmentIds.length ? await db.selectFrom('support_attachments').selectAll()
      .where('id', 'in', parsed.data.attachmentIds).where('ticket_id', '=', ticket.id)
      .where('uploader_id', '=', req.user.id).where('message_id', 'is', null).where('deleted_at', 'is', null).execute() : [];
    if (attachmentRows.length !== parsed.data.attachmentIds.length) return res.status(400).json({ error: 'یکی از پیوست‌ها معتبر نیست.' });
    const id = uuid();
    const createdAt = now();
    const nextStatus = ticket.agent_id ? 'agent_active' : (ticket.status.startsWith('ai_') ? 'ai_active' : 'queued');
    await db.transaction().execute(async trx => {
      await trx.insertInto('support_messages').values({
        id, ticket_id: ticket.id, sender_id: req.user.id, sender_type: 'customer',
        message_type: 'public_reply', body: parsed.data.body, sanitized_body: cleanText(parsed.data.body),
        reply_to_id: parsed.data.replyToId || null, delivery_status: 'sent', channel: 'web',
        metadata: '{}', record_version: 1, idempotency_key: key, created_at: createdAt,
      }).execute();
      if (attachmentRows.length) await trx.updateTable('support_attachments').set({ message_id: id }).where('id', 'in', attachmentRows.map(item => item.id)).execute();
      await trx.updateTable('support_tickets').set({
        status: nextStatus, last_customer_message_at: createdAt, last_activity_at: createdAt,
        unread_agent: sql`COALESCE(unread_agent, 0) + 1`, updated_at: createdAt,
        state_version: sql`COALESCE(state_version, 0) + 1`,
      }).where('id', '=', ticket.id).execute();
      if (nextStatus !== ticket.status) await insertStatusHistory(trx, {
        ticket, to: nextStatus, actorType: 'customer', actorId: req.user.id,
        reason: 'پیام جدید مشتری', stateVersion: Number(ticket.state_version || 0) + 1,
      });
    });
    await emitEvent({ ticketId: ticket.id, eventType: 'message.created', actorType: 'customer', actorId: req.user.id, targetUserId: ticket.agent_id, teamId: ticket.team_id, customerId: req.user.id, payload: { messageId: id, senderType: 'customer', status: nextStatus } });
    const current = { ...ticket, status: nextStatus };
    if (nextStatus === 'ai_active') await runAi(current, { id, body: parsed.data.body });
    res.status(201).json({ message: { id, created_at: createdAt, delivery_status: 'sent' }, reused: false });
  }));

  router.post('/support/tickets/:id/read', auth, customerOnly, asyncRoute(async (req, res) => {
    const ticket = await ownedTicket(req, req.params.id);
    if (!ticket) return res.status(404).json({ error: 'گفتگو پیدا نشد.' });
    const ids = await db.selectFrom('support_messages').select('id').where('ticket_id', '=', ticket.id)
      .where('sender_type', 'in', ['agent', 'ai', 'system']).where('message_type', '!=', 'internal_note').execute();
    const readAt = now();
    await db.transaction().execute(async trx => {
      for (const item of ids) {
        await trx.insertInto('support_message_reads').values({
          message_id: item.id, user_id: req.user.id, delivered_at: readAt, read_at: readAt, created_at: readAt,
        }).onConflict(oc => oc.columns(['message_id', 'user_id']).doUpdateSet({ delivered_at: readAt, read_at: readAt })).execute();
      }
      await trx.updateTable('support_messages').set({ delivery_status: 'read', delivered_at: readAt, read_at: readAt }).where('id', 'in', ids.map(item => item.id)).execute();
      await trx.updateTable('support_tickets').set({ unread_customer: 0 }).where('id', '=', ticket.id).execute();
    });
    await emitEvent({ ticketId: ticket.id, eventType: 'message.read', actorType: 'customer', actorId: req.user.id, targetUserId: ticket.agent_id, teamId: ticket.team_id, customerId: req.user.id, payload: { readAt } });
    res.json({ ok: true, readAt });
  }));

  router.post('/support/tickets/:id/human', auth, customerOnly, asyncRoute(async (req, res) => {
    const ticket = await ownedTicket(req, req.params.id);
    if (!ticket) return res.status(404).json({ error: 'گفتگو پیدا نشد.' });
    const classification = classify('کارشناس انسانی');
    const result = await escalate({ ticket, reason: 'درخواست صریح کارشناس انسانی', classification, extra: { lastMessage: cleanText(req.body?.reason) } });
    res.json({
      ok: true, reused: result.reused, status: result.status, agentId: result.agentId || ticket.agent_id || null,
      requestedAt: result.requestedAt || ticket.escalation_requested_at || null,
      teamId: ticket.team_id, ticketNo: ticket.public_no || ticket.ticket_no,
    });
  }));

  router.post('/support/tickets/:id/supervisor-review', auth, customerOnly, asyncRoute(async (req, res) => {
    const ticket = await ownedTicket(req, req.params.id);
    if (!ticket) return res.status(404).json({ error: 'گفتگو پیدا نشد.' });
    const existing = await db.selectFrom('support_supervisor_requests').selectAll()
      .where('ticket_id', '=', ticket.id).where('status', '=', 'open').executeTakeFirst();
    if (existing) return res.json({ ok: true, reused: true, id: existing.id, requestedAt: existing.created_at });
    const id = uuid();
    const createdAt = now();
    await db.transaction().execute(async trx => {
      await trx.insertInto('support_supervisor_requests').values({
        id, ticket_id: ticket.id, user_id: req.user.id,
        reason: cleanText(req.body?.reason).slice(0, 1000) || null,
        status: 'open', resolved_by: null, resolved_at: null, created_at: createdAt,
      }).execute();
      const event = createEvent({
        ticketId: ticket.id, eventType: 'ticket.supervisor_review_requested',
        actorType: 'customer', actorId: req.user.id, teamId: ticket.team_id,
        customerId: req.user.id, payload: { requestId: id },
      });
      await trx.insertInto('support_events').values(event).execute();
    });
    await audit(req, 'support_supervisor_review_requested', 'support_ticket', ticket.id);
    res.status(201).json({ ok: true, reused: false, id, requestedAt: createdAt });
  }));

  router.post('/support/tickets/:id/reopen', auth, customerOnly, asyncRoute(async (req, res) => {
    const ticket = await ownedTicket(req, req.params.id);
    if (!ticket) return res.status(404).json({ error: 'گفتگو پیدا نشد.' });
    if (!['resolved', 'closed'].includes(ticket.status)) return res.status(409).json({ error: 'این گفتگو در وضعیت قابل بازگشایی نیست.' });
    const reopenedAt = now();
    const stateVersion = Number(ticket.state_version || 0) + 1;
    await db.transaction().execute(async trx => {
      await trx.updateTable('support_tickets').set({ status: 'reopened', closed_at: null, resolved_at: null, updated_at: reopenedAt, last_activity_at: reopenedAt, state_version: stateVersion }).where('id', '=', ticket.id).execute();
      await insertStatusHistory(trx, { ticket, to: 'reopened', actorType: 'customer', actorId: req.user.id, reason: 'بازگشایی مشتری', stateVersion });
    });
    await emitEvent({ ticketId: ticket.id, eventType: 'ticket.status_changed', actorType: 'customer', actorId: req.user.id, targetUserId: ticket.agent_id, teamId: ticket.team_id, customerId: req.user.id, payload: { from: ticket.status, to: 'reopened' } });
    await audit(req, 'support_ticket_reopened_v5', 'support_ticket', ticket.id);
    res.json({ ok: true, status: 'reopened' });
  }));

  router.post('/support/tickets/:id/csat', auth, customerOnly, asyncRoute(async (req, res) => {
    const ticket = await ownedTicket(req, req.params.id);
    if (!ticket) return res.status(404).json({ error: 'گفتگو پیدا نشد.' });
    if (!['resolved', 'closed'].includes(ticket.status)) return res.status(409).json({ error: 'رضایت پس از حل گفتگو ثبت می‌شود.' });
    const parsed = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).optional(), targetType: z.enum(['overall', 'ai', 'agent']).default('overall') }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'امتیاز باید بین ۱ تا ۵ باشد.' });
    const existing = await db.selectFrom('support_csat').selectAll().where('ticket_id', '=', ticket.id).where('user_id', '=', req.user.id).where('target_type', '=', parsed.data.targetType).where('active', '=', 1).executeTakeFirst();
    if (existing && Date.now() - new Date(existing.created_at).getTime() > 7 * 86_400_000) return res.status(409).json({ error: 'مهلت ویرایش این نظر پایان یافته است.' });
    const id = existing?.id || uuid();
    if (existing) await db.updateTable('support_csat').set({ rating: parsed.data.rating, comment: parsed.data.comment || null, updated_at: now() }).where('id', '=', id).execute();
    else await db.insertInto('support_csat').values({ id, ticket_id: ticket.id, user_id: req.user.id, rating: parsed.data.rating, comment: parsed.data.comment || null, target_type: parsed.data.targetType, agent_id: ticket.agent_id, active: 1, created_at: now(), updated_at: now() }).execute();
    res.status(existing ? 200 : 201).json({ id, updated: Boolean(existing) });
  }));

  router.post('/support/ai-feedback', auth, customerOnly, asyncRoute(async (req, res) => {
    const parsed = z.object({ messageId: z.string(), helpful: z.boolean(), comment: z.string().trim().max(1000).optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'بازخورد معتبر نیست.' });
    const message = await db.selectFrom('support_messages').innerJoin('support_tickets', 'support_tickets.id', 'support_messages.ticket_id')
      .select(['support_messages.id', 'support_messages.ai_run_id', 'support_tickets.id as ticket_id', 'support_tickets.user_id'])
      .where('support_messages.id', '=', parsed.data.messageId).where('support_tickets.user_id', '=', req.user.id).where('support_messages.sender_type', '=', 'ai').executeTakeFirst();
    if (!message?.ai_run_id) return res.status(404).json({ error: 'پاسخ هوش مصنوعی پیدا نشد.' });
    await db.insertInto('ai_feedback').values({ id: uuid(), ai_run_id: message.ai_run_id, message_id: message.id, user_id: req.user.id, helpful: parsed.data.helpful ? 1 : 0, comment: parsed.data.comment || null, created_at: now() }).execute();
    if (!parsed.data.helpful) {
      const ticket = await db.selectFrom('support_tickets').selectAll().where('id', '=', message.ticket_id).executeTakeFirstOrThrow();
      await escalate({ ticket, reason: 'کاربر پاسخ AI را غیرمفید اعلام کرد', classification: classify('کارشناس انسانی'), aiRunId: message.ai_run_id, extra: { lastMessage: parsed.data.comment || 'بازخورد غیرمفید' } });
    }
    res.status(201).json({ ok: true });
  }));

  const magicType = buffer => {
    if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
    if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
    if (buffer.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
    if (!buffer.includes(0) && /^[\x09\x0a\x0d\x20-\x7e\u0600-\u06ff]*$/u.test(buffer.toString('utf8').slice(0, 4000))) return 'text/plain';
    return null;
  };
  router.post('/support/tickets/:id/attachments', auth, customerOnly, upload.array('files', 5), asyncRoute(async (req, res) => {
    const ticket = await ownedTicket(req, req.params.id);
    if (!ticket) return res.status(404).json({ error: 'گفتگو پیدا نشد.' });
    if (!req.files?.length) return res.status(400).json({ error: 'فایلی انتخاب نشده است.' });
    await mkdir(attachmentRoot, { recursive: true });
    const results = [];
    for (const file of req.files) {
      const detected = magicType(file.buffer);
      const declaredAllowed = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain'];
      if (!detected || !declaredAllowed.includes(file.mimetype) || detected !== file.mimetype) return res.status(400).json({ error: `نوع واقعی فایل «${file.originalname}» با نوع اعلام‌شده سازگار نیست.` });
      const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf', 'text/plain': 'txt' }[detected];
      const storageName = `${uuid()}.${extension}`;
      const target = resolve(attachmentRoot, storageName);
      if (!target.startsWith(`${attachmentRoot}${sep}`)) return res.status(400).json({ error: 'نام فایل نامعتبر است.' });
      let bytes = file.buffer;
      let thumbnailName = null;
      if (detected.startsWith('image/')) {
        bytes = await sharp(file.buffer).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).toFormat(extension === 'jpg' ? 'jpeg' : extension, { quality: 86 }).toBuffer();
        thumbnailName = `${storageName}.thumb.webp`;
        await writeFile(resolve(attachmentRoot, thumbnailName), await sharp(bytes).resize({ width: 420, height: 420, fit: 'inside' }).webp({ quality: 75 }).toBuffer());
      }
      await writeFile(target, bytes);
      const scanStatus = await scanUploadedFile(target);
      if (scanStatus === 'infected' || (process.env.NODE_ENV === 'production' && scanStatus !== 'clean')) {
        await unlink(target).catch(() => {});
        if (thumbnailName) await unlink(resolve(attachmentRoot, thumbnailName)).catch(() => {});
        return res.status(scanStatus === 'infected' ? 422 : 503).json({ error: scanStatus === 'infected' ? 'فایل توسط اسکن امنیتی رد شد.' : 'اسکن امنیتی فایل در دسترس نیست؛ فایل ذخیره نشد.' });
      }
      const id = uuid();
      await db.insertInto('support_attachments').values({
        id, ticket_id: ticket.id, message_id: null, uploader_id: req.user.id,
        original_name: basename(file.originalname).slice(0, 180), storage_name: storageName,
        mime_type: detected, size_bytes: bytes.length, sha256: hashFile(bytes),
        thumbnail_name: thumbnailName, scan_status: scanStatus, metadata: '{}',
        deleted_at: null, created_at: now(),
      }).execute();
      results.push({ id, originalName: basename(file.originalname), mimeType: detected, sizeBytes: bytes.length, scanStatus });
    }
    await audit(req, 'support_attachment_uploaded', 'support_ticket', ticket.id, { count: results.length });
    res.status(201).json({ items: results });
  }));

  router.post('/support-agent/tickets/:id/attachments', auth, supportAccess, permission('support.attachments.manage'), upload.array('files', 5), asyncRoute(async (req, res) => {
    const ticket = await visibleTicket(req, req.params.id);
    if (!ticket) return res.status(404).json({ error: 'تیکت پیدا نشد.' });
    if (!canOperateTicket(req, ticket)) return rejectUnauthorizedOperation(req, res, ticket, 'attachment_upload');
    if (!req.files?.length) return res.status(400).json({ error: 'فایلی انتخاب نشده است.' });
    await mkdir(attachmentRoot, { recursive: true });
    const results = [];
    for (const file of req.files) {
      const detected = magicType(file.buffer);
      const declaredAllowed = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain'];
      if (!detected || !declaredAllowed.includes(file.mimetype) || detected !== file.mimetype) {
        return res.status(400).json({ error: `نوع واقعی فایل «${file.originalname}» با نوع اعلام‌شده سازگار نیست.` });
      }
      const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf', 'text/plain': 'txt' }[detected];
      const storageName = `${uuid()}.${extension}`;
      const target = resolve(attachmentRoot, storageName);
      if (!target.startsWith(`${attachmentRoot}${sep}`)) return res.status(400).json({ error: 'مسیر فایل نامعتبر است.' });
      let bytes = file.buffer;
      let thumbnailName = null;
      if (detected.startsWith('image/')) {
        bytes = await sharp(file.buffer).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).toFormat(extension === 'jpg' ? 'jpeg' : extension, { quality: 86 }).toBuffer();
        thumbnailName = `${storageName}.thumb.webp`;
        await writeFile(resolve(attachmentRoot, thumbnailName), await sharp(bytes).resize({ width: 420, height: 420, fit: 'inside' }).webp({ quality: 75 }).toBuffer());
      }
      await writeFile(target, bytes);
      const scanStatus = await scanUploadedFile(target);
      if (scanStatus === 'infected' || (process.env.NODE_ENV === 'production' && scanStatus !== 'clean')) {
        await unlink(target).catch(() => {});
        if (thumbnailName) await unlink(resolve(attachmentRoot, thumbnailName)).catch(() => {});
        return res.status(scanStatus === 'infected' ? 422 : 503).json({ error: scanStatus === 'infected' ? 'فایل توسط اسکن امنیتی رد شد.' : 'اسکن امنیتی فایل در دسترس نیست؛ فایل ذخیره نشد.' });
      }
      const id = uuid();
      await db.insertInto('support_attachments').values({
        id, ticket_id: ticket.id, message_id: null, uploader_id: req.user.id,
        original_name: basename(file.originalname).slice(0, 180), storage_name: storageName,
        mime_type: detected, size_bytes: bytes.length, sha256: hashFile(bytes),
        thumbnail_name: thumbnailName, scan_status: scanStatus, metadata: '{}',
        deleted_at: null, created_at: now(),
      }).execute();
      results.push({ id, originalName: basename(file.originalname), mimeType: detected, sizeBytes: bytes.length, scanStatus });
    }
    await emitEvent({ ticketId: ticket.id, eventType: 'attachment.created', actorType: 'agent', actorId: req.user.id, targetUserId: ticket.user_id, teamId: ticket.team_id, customerId: ticket.user_id, payload: { count: results.length } });
    await audit(req, 'support_agent_attachment_uploaded', 'support_ticket', ticket.id, { count: results.length });
    res.status(201).json({ items: results });
  }));

  router.get('/support/attachments/:id', auth, asyncRoute(async (req, res) => {
    const attachment = await db.selectFrom('support_attachments').innerJoin('support_tickets', 'support_tickets.id', 'support_attachments.ticket_id')
      .selectAll('support_attachments').select(['support_tickets.user_id', 'support_tickets.team_id', 'support_tickets.agent_id'])
      .where('support_attachments.id', '=', req.params.id).where('support_attachments.deleted_at', 'is', null).executeTakeFirst();
    if (!attachment) return res.status(404).json({ error: 'پیوست پیدا نشد.' });
    let allowed = attachment.user_id === req.user.id;
    if (!allowed && ['admin', 'super_admin', 'support_agent'].includes(req.user.role)) {
      const member = await db.selectFrom('admin_members').select('permissions').where('user_id', '=', req.user.id).where('section', '=', 'support').executeTakeFirst();
      allowed = ['admin', 'super_admin'].includes(req.user.role) ||
        (normalizePermissions(member?.permissions)['support.attachments.manage'] &&
          (!attachment.agent_id || attachment.agent_id === req.user.id));
    }
    if (!allowed) return res.status(403).json({ error: 'اجازه دریافت این فایل را ندارید.' });
    const path = resolve(attachmentRoot, attachment.storage_name);
    if (!path.startsWith(`${attachmentRoot}${sep}`)) return res.status(400).json({ error: 'مسیر فایل نامعتبر است.' });
    await stat(path).catch(() => null);
    res.setHeader('Content-Type', attachment.mime_type);
    const inlinePreview = req.query.preview === '1' && attachment.mime_type.startsWith('image/');
    res.setHeader('Content-Disposition', `${inlinePreview ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(attachment.original_name)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    createReadStream(path).pipe(res);
    await audit(req, 'support_attachment_downloaded', 'support_attachment', attachment.id);
  }));

  const openSse = async (req, res, agent = false) => {
    const allowedOrigins = String(process.env.APP_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
    const sameOrigin = !req.headers.origin || req.headers.origin === `${req.protocol}://${req.get('host')}`;
    if (req.headers.origin && !sameOrigin && !allowedOrigins.includes(req.headers.origin)) return res.status(403).json({ error: 'مبدأ اتصال زنده مجاز نیست.' });
    const userConnections = [...sseClients].filter(item => item.userId === req.user.id).length;
    if (sseClients.size >= Number(process.env.SSE_MAX_CONNECTIONS || 500) || userConnections >= Number(process.env.SSE_MAX_PER_USER || 3)) {
      return res.status(429).json({ error: 'سقف اتصال‌های زنده تکمیل شده است.' });
    }
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    const client = {
      res, userId: req.user.id, agent, admin: Boolean(req.supportV5?.admin),
      teamIds: req.supportV5?.teamIds || [], sessionId: req.user.session_id, portal: req.user.portal,
    };
    sseClients.add(client);
    const lastId = cleanText(req.headers['last-event-id'] || req.query.lastEventId);
    if (lastId && (lastId.length > 100 || !/^[A-Za-z0-9-]+$/.test(lastId))) {
      sseClients.delete(client);
      return res.end();
    }
    let replay = db.selectFrom('support_events').selectAll().orderBy('created_at', 'desc').limit(100);
    if (lastId) {
      const last = await db.selectFrom('support_events').select('created_at').where('id', '=', lastId).executeTakeFirst();
      if (last) replay = db.selectFrom('support_events').selectAll().where('created_at', '>', last.created_at).orderBy('created_at').limit(100);
    }
    const events = await replay.execute();
    const replayTickets = new Map();
    for (const row of (lastId ? events : events.reverse())) {
      const payload = parseJson(row.payload, {});
      if (row.ticket_id && !replayTickets.has(row.ticket_id)) {
        replayTickets.set(row.ticket_id, await db.selectFrom('support_tickets').select('agent_id')
          .where('id', '=', row.ticket_id).executeTakeFirst());
      }
      const replayTicket = row.ticket_id ? replayTickets.get(row.ticket_id) : null;
      const allowed = client.admin ||
        (!client.agent && (row.target_user_id === client.userId || payload.customerId === client.userId)) ||
        (client.agent && replayTicket && (!replayTicket.agent_id || replayTicket.agent_id === client.userId));
      if (allowed) sendSse(client, { ...row, payload });
    }
    res.write(`event: ready\ndata: ${JSON.stringify({ connected: true, at: now() })}\n\n`);
    let checking = false;
    const heartbeat = setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        const active = client.sessionId ? await db.selectFrom('sessions')
          .innerJoin('users', 'users.id', 'sessions.user_id')
          .select(['sessions.id', 'sessions.expires_at', 'sessions.revoked_at', 'users.status', 'users.role'])
          .where('sessions.id', '=', client.sessionId).executeTakeFirst() : null;
        const roleOk = active && (client.agent ? ['support_agent', 'super_admin'].includes(active.role) : active.role === 'customer');
        if (!active || active.revoked_at || active.expires_at < now() || active.status !== 'active' || !roleOk) {
          clearInterval(heartbeat); sseClients.delete(client); return res.end();
        }
        res.write(`: heartbeat ${Date.now()}\n\n`);
      } finally { checking = false; }
    }, 10_000);
    req.on('close', () => { clearInterval(heartbeat); sseClients.delete(client); });
  };
  router.get('/support/events', auth, customerOnly, asyncRoute((req, res) => openSse(req, res, false)));
  router.get('/support-agent/events', auth, supportAccess, asyncRoute((req, res) => openSse(req, res, true)));

  let resumeJobRunning = false;
  const resumeDueTickets = async () => {
    if (resumeJobRunning) return 0;
    resumeJobRunning = true;
    let count = 0;
    try {
      const due = await db.selectFrom('support_tickets').selectAll()
        .where('status', '=', 'snoozed').where('snoozed_until', '<=', now()).limit(100).execute();
      for (const ticket of due) {
        const resumedAt = now();
        const nextStatus = ticket.agent_id ? 'agent_active' : 'queued';
        const stateVersion = Number(ticket.state_version || 0) + 1;
        const event = createEvent({
          ticketId: ticket.id, eventType: 'ticket.resumed', actorType: 'system',
          targetUserId: ticket.agent_id, teamId: ticket.team_id, customerId: ticket.user_id,
          payload: { from: 'snoozed', to: nextStatus, stateVersion },
        });
        const changed = await db.transaction().execute(async trx => {
          const update = await trx.updateTable('support_tickets').set({
            status: nextStatus, snoozed_until: null, snooze_reason: null,
            state_version: stateVersion, updated_at: resumedAt, last_activity_at: resumedAt,
          }).where('id', '=', ticket.id).where('status', '=', 'snoozed')
            .where('state_version', '=', ticket.state_version).executeTakeFirst();
          if (Number(update.numUpdatedRows || 0) !== 1) return false;
          await insertStatusHistory(trx, {
            ticket, to: nextStatus, actorType: 'system', actorId: null,
            reason: 'رسیدن زمان یادآوری', stateVersion,
          });
          await trx.insertInto('support_sla_events').values({
            id: uuid(), ticket_id: ticket.id, metric: 'all', event_type: 'resumed',
            due_at: null, occurred_at: resumedAt, metadata: '{}',
          }).execute();
          await trx.insertInto('support_events').values(event).execute();
          await trx.insertInto('audit_events').values({
            id: uuid(), user_id: null, action: 'support_ticket_resumed',
            entity_type: 'support_ticket', entity_id: ticket.id, ip: null,
            user_agent: null, metadata: JSON.stringify({ nextStatus }), created_at: resumedAt,
          }).execute();
          return true;
        });
        if (changed) { await broadcastEvent(event); count += 1; }
      }
      return count;
    } finally {
      resumeJobRunning = false;
    }
  };
  const resumeTimer = setInterval(() => resumeDueTickets().catch(() => {}), 60_000);
  resumeTimer.unref?.();
  let rebalanceRunning = false;
  const rebalanceQueue = async () => {
    if (rebalanceRunning) return 0;
    rebalanceRunning = true;
    try {
      const queued = await db.selectFrom('support_tickets').select(['id', 'intent'])
        .where('status', '=', 'queued').where('agent_id', 'is', null)
        .orderBy('final_priority', 'desc').orderBy('escalation_requested_at').limit(100).execute();
      let assigned = 0;
      for (const ticket of queued) {
        if (await assignBestAvailableAgent(ticket.id, { intent: ticket.intent })) assigned += 1;
      }
      return assigned;
    } finally {
      rebalanceRunning = false;
    }
  };
  rebalanceRequester = rebalanceQueue;
  const rebalanceTimer = setInterval(() => rebalanceQueue().catch(() => {}), 60_000);
  rebalanceTimer.unref?.();
  router.post('/support-agent/scheduler/resume-due', auth, supportAccess, permission('support.sla.manage'), asyncRoute(async (_req, res) => {
    res.json({ ok: true, resumed: await resumeDueTickets() });
  }));
  router.post('/support-agent/scheduler/rebalance', auth, supportAccess, permission('support.sla.manage'), asyncRoute(async (_req, res) => {
    res.json({ ok: true, assigned: await rebalanceQueue() });
  }));

  router.get('/support-agent/queue', auth, supportAccess, asyncRoute(async (req, res) => {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 30)));
    const q = cleanText(req.query.q).slice(0, 120);
    const statusFilter = cleanText(req.query.status);
    const priorityFilter = cleanText(req.query.priority);
    const owner = cleanText(req.query.owner);
    const teamFilter = cleanText(req.query.team);
    const agentFilter = cleanText(req.query.agent);
    const channelFilter = cleanText(req.query.channel);
    const from = cleanText(req.query.from);
    const to = cleanText(req.query.to);
    const sla = cleanText(req.query.sla);
    const unread = req.query.unread === 'true';
    const hasAttachment = req.query.hasAttachment === 'true';
    let query = db.selectFrom('support_tickets').innerJoin('users', 'users.id', 'support_tickets.user_id')
      .leftJoin('profiles', 'profiles.user_id', 'users.id')
      .leftJoin('support_teams', 'support_teams.id', 'support_tickets.team_id')
      .select([
        'support_tickets.id', 'support_tickets.public_no', 'support_tickets.ticket_no',
        'support_tickets.subject', 'support_tickets.status', 'support_tickets.final_priority',
        'support_tickets.priority', 'support_tickets.team_id', 'support_tickets.agent_id',
        'support_tickets.state_version',
        'support_tickets.last_activity_at', 'support_tickets.created_at', 'support_tickets.unread_agent',
        'support_tickets.first_response_due_at', 'support_tickets.resolution_due_at',
        'users.mobile', 'profiles.full_name', 'profiles.account_type', 'support_teams.name as team_name',
      ]);
    if (!req.supportV5.admin) query = query.where('support_tickets.agent_id', '=', req.user.id);
    if (statusFilter && supportStatuses.includes(statusFilter)) query = query.where('support_tickets.status', '=', statusFilter);
    if (priorityFilter && ['normal', 'high', 'critical'].includes(priorityFilter)) query = query.where('support_tickets.final_priority', '=', priorityFilter);
    if (owner === 'me') query = query.where('support_tickets.agent_id', '=', req.user.id);
    if (owner === 'unassigned') query = query.where('support_tickets.agent_id', 'is', null);
    if (teamFilter) query = query.where('support_tickets.team_id', '=', teamFilter);
    if (agentFilter) query = query.where('support_tickets.agent_id', '=', agentFilter);
    if (channelFilter) query = query.where('support_tickets.channel', '=', channelFilter);
    if (from) query = query.where('support_tickets.created_at', '>=', from);
    if (to) query = query.where('support_tickets.created_at', '<=', to);
    if (unread) query = query.where('support_tickets.unread_agent', '>', 0);
    if (hasAttachment) query = query.where('support_tickets.id', 'in',
      db.selectFrom('support_attachments').select('ticket_id').where('deleted_at', 'is', null));
    if (sla === 'breached') query = query.where('support_tickets.resolution_due_at', '<', now())
      .where('support_tickets.status', 'not in', ['resolved', 'closed']);
    if (sla === 'warning') query = query.where('support_tickets.resolution_due_at', '>=', now())
      .where('support_tickets.resolution_due_at', '<=', new Date(Date.now() + 60 * 60_000).toISOString())
      .where('support_tickets.status', 'not in', ['resolved', 'closed']);
    if (q) query = query.where(eb => eb.or([
      eb('support_tickets.subject', 'like', `%${q}%`), eb('support_tickets.public_no', 'like', `%${q}%`),
      eb('profiles.full_name', 'like', `%${q}%`), eb('users.mobile', 'like', `%${q}%`),
    ]));
    const items = await query.orderBy(sql`CASE support_tickets.final_priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END`)
      .orderBy('support_tickets.resolution_due_at').orderBy('support_tickets.last_activity_at', 'desc')
      .limit(limit).offset((page - 1) * limit).execute();
    res.json({
      items, page, limit, hasMore: items.length === limit,
      permissions: req.supportV5.permissions,
      currentUserId: req.user.id,
    });
  }));

  router.get('/support-agent/tickets/:id', auth, supportAccess, asyncRoute(async (req, res) => {
    const ticket = await visibleTicket(req, req.params.id);
    if (!ticket) return res.status(404).json({ error: 'تیکت در محدوده دسترسی شما نیست.' });
    const [customer, messages, attachments, citations, reads, notes, tags, history, statusHistory, escalation, orders, views, assignment, owner, supervisorRequest, salesTicket] = await Promise.all([
      db.selectFrom('users').leftJoin('profiles', 'profiles.user_id', 'users.id').selectAll('users').selectAll('profiles').where('users.id', '=', ticket.user_id).executeTakeFirst(),
      db.selectFrom('support_messages').leftJoin('profiles', 'profiles.user_id', 'support_messages.sender_id')
        .selectAll('support_messages').select('profiles.full_name').where('ticket_id', '=', ticket.id).where('support_messages.deleted_at', 'is', null).orderBy('support_messages.created_at').execute(),
      db.selectFrom('support_attachments').selectAll().where('ticket_id', '=', ticket.id).where('deleted_at', 'is', null).execute(),
      db.selectFrom('ai_citations').selectAll().where('message_id', 'in', db.selectFrom('support_messages').select('id').where('ticket_id', '=', ticket.id)).execute(),
      db.selectFrom('support_message_reads').selectAll().where('message_id', 'in', db.selectFrom('support_messages').select('id').where('ticket_id', '=', ticket.id)).execute(),
      db.selectFrom('support_messages').leftJoin('profiles', 'profiles.user_id', 'support_messages.sender_id').selectAll('support_messages').select('profiles.full_name').where('ticket_id', '=', ticket.id).where('message_type', '=', 'internal_note').orderBy('support_messages.created_at').execute(),
      db.selectFrom('support_ticket_tags').innerJoin('support_tags', 'support_tags.id', 'support_ticket_tags.tag_id').selectAll('support_tags').where('ticket_id', '=', ticket.id).execute(),
      db.selectFrom('support_assignment_history').selectAll().where('ticket_id', '=', ticket.id).orderBy('created_at', 'desc').execute(),
      db.selectFrom('support_status_history').selectAll().where('ticket_id', '=', ticket.id).orderBy('created_at', 'desc').execute(),
      db.selectFrom('ai_escalations').selectAll().where('ticket_id', '=', ticket.id).where('active', '=', 1).orderBy('created_at', 'desc').executeTakeFirst(),
      req.supportV5.permissions['support.customers.context'] ? db.selectFrom('orders').select(['id', 'order_no', 'status', 'total', 'payment_status', 'tracking_code', 'created_at']).where('user_id', '=', ticket.user_id).orderBy('created_at', 'desc').limit(10).execute() : [],
      db.selectFrom('support_agent_views').leftJoin('profiles', 'profiles.user_id', 'support_agent_views.agent_id').select(['support_agent_views.agent_id', 'support_agent_views.is_typing', 'support_agent_views.last_seen_at', 'profiles.full_name']).where('ticket_id', '=', ticket.id).where('last_seen_at', '>=', new Date(Date.now() - 90_000).toISOString()).execute(),
      db.selectFrom('support_assignments').selectAll().where('ticket_id', '=', ticket.id).executeTakeFirst(),
      ticket.agent_id ? db.selectFrom('users').leftJoin('profiles', 'profiles.user_id', 'users.id')
        .select(['users.id', 'profiles.full_name']).where('users.id', '=', ticket.agent_id).executeTakeFirst() : null,
      db.selectFrom('support_supervisor_requests').selectAll().where('ticket_id', '=', ticket.id).where('status', '=', 'open').executeTakeFirst(),
      db.selectFrom('support_sales_tickets').selectAll().where('support_ticket_id', '=', ticket.id).orderBy('created_at', 'desc').executeTakeFirst(),
    ]);
    await db.insertInto('support_agent_views').values({ ticket_id: ticket.id, agent_id: req.user.id, is_typing: 0, last_seen_at: now() })
      .onConflict(oc => oc.columns(['ticket_id', 'agent_id']).doUpdateSet({ last_seen_at: now() })).execute();
    res.json({
      ticket: { ...ticket, agent_id: assignment?.agent_id || ticket.agent_id },
      assignment, owner,
      readOnly: Boolean(ticket.agent_id && ticket.agent_id !== req.user.id && !req.supportV5.permissions['support.tickets.transfer'] && !req.supportV5.admin),
      allowedTransitions: (supportTransitions[ticket.status] || []).filter(value => value !== 'assigned'),
      customer: req.supportV5.permissions['support.customers.context'] ? customer : { full_name: customer?.full_name },
      messages: messages.filter(item => item.message_type !== 'internal_note').map(item => ({
        ...item,
        readReceipts: reads.filter(row => row.message_id === item.id),
        delivery_status: reads.some(row => row.message_id === item.id && row.read_at)
          ? 'read' : reads.some(row => row.message_id === item.id && row.delivered_at) ? 'delivered' : item.delivery_status,
        attachments: attachments.filter(row => row.message_id === item.id).map(({ storage_name, ...safe }) => safe),
        citations: citations.filter(row => row.message_id === item.id),
      })),
      internalNotes: notes, tags, assignmentHistory: history, statusHistory,
      supervisorRequest, salesTicket,
      escalation: escalation ? { ...escalation, context: parseJson(escalation.context, {}) } : null,
      orders, activeViewers: views, permissions: req.supportV5.permissions,
    });
  }));

  router.post('/support-agent/tickets/:id/sales-escalation', auth, supportAccess, permission('support.tickets.reply'), asyncRoute(async (req, res) => {
    const ticket = await visibleTicket(req, req.params.id);
    if (!ticket) return res.status(404).json({ error: 'تیکت در محدوده دسترسی شما نیست.' });
    if (!canOperateTicket(req, ticket)) return rejectUnauthorizedOperation(req, res, ticket, 'sales_escalation');
    const parsed = z.object({
      category: z.enum(['order', 'payment', 'contract', 'service', 'technical', 'store_support', 'refund', 'shipment', 'product']).default('store_support'),
      summary: z.string().trim().min(10).max(3000),
      orderId: z.string().nullable().optional(),
      priority: z.enum(['normal', 'high', 'critical']).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'دسته‌بندی و شرح ارجاع فروشگاهی معتبر نیست.' });
    const existing = await db.selectFrom('support_sales_tickets').selectAll()
      .where('support_ticket_id', '=', ticket.id).where('status', 'not in', ['resolved', 'closed'])
      .orderBy('created_at', 'desc').executeTakeFirst();
    if (existing) return res.status(200).json({ ticket: existing, reused: true });
    const orderId = parsed.data.orderId || ticket.order_id || null;
    if (orderId) {
      const order = await db.selectFrom('orders').select('id').where('id', '=', orderId)
        .where('user_id', '=', ticket.user_id).executeTakeFirst();
      if (!order) return res.status(409).json({ error: 'سفارش انتخاب‌شده متعلق به این مشتری نیست.' });
    }
    const id = uuid();
    const createdAt = now();
    const salesTicketNo = `AS-${new Date().toISOString().slice(2, 10).replaceAll('-', '')}-${String(Date.now()).slice(-5)}`;
    const stateVersion = Number(ticket.state_version || 0) + 1;
    const note = `ارجاع به ادمین فروشگاه (${salesTicketNo})\n${parsed.data.summary}`;
    const event = createEvent({
      ticketId: ticket.id, eventType: 'ticket.sales_escalated', actorType: 'agent',
      actorId: req.user.id, teamId: ticket.team_id, customerId: ticket.user_id,
      payload: { salesTicketId: id, salesTicketNo, category: parsed.data.category, status: 'new' },
    });
    await db.transaction().execute(async trx => {
      await trx.insertInto('support_sales_tickets').values({
        id, sales_ticket_no: salesTicketNo, support_ticket_id: ticket.id,
        customer_id: ticket.user_id, order_id: orderId, created_by: req.user.id,
        sales_manager_id: null, category: parsed.data.category,
        priority: parsed.data.priority || ticket.final_priority || 'normal',
        subject: ticket.subject, summary: parsed.data.summary, status: 'new',
        resolution_note: null, due_at: ticket.resolution_due_at || null,
        resolved_at: null, created_at: createdAt, updated_at: createdAt,
      }).execute();
      await trx.insertInto('support_messages').values({
        id: uuid(), ticket_id: ticket.id, sender_id: req.user.id, sender_type: 'agent',
        message_type: 'internal_note', body: note, sanitized_body: cleanText(note),
        delivery_status: 'read', channel: 'web', metadata: JSON.stringify({ salesTicketId: id }),
        record_version: 1, idempotency_key: `sales-escalation:${id}`, created_at: createdAt,
      }).execute();
      await trx.updateTable('support_tickets').set({
        status: 'waiting_internal', state_version: stateVersion,
        updated_at: createdAt, last_activity_at: createdAt,
      }).where('id', '=', ticket.id).execute();
      await insertStatusHistory(trx, {
        ticket, to: 'waiting_internal', actorType: 'agent', actorId: req.user.id,
        reason: 'ارجاع رسمی به ادمین فروشگاه', stateVersion,
        metadata: { salesTicketId: id, salesTicketNo },
      });
      const salesManagers = await trx.selectFrom('users').select('id')
        .where('role', '=', 'sales_manager').where('status', '=', 'active').execute();
      for (const manager of salesManagers) await trx.insertInto('notifications').values({
        id: uuid(), user_id: manager.id, title: 'تیکت جدید از پشتیبانی',
        body: `${salesTicketNo} · ${ticket.subject}`, read_at: null, created_at: createdAt,
      }).execute();
      await trx.insertInto('support_events').values(event).execute();
      await insertAudit(trx, req, 'support_ticket_escalated_to_sales', 'support_sales_ticket', id, {
        supportTicketId: ticket.id, salesTicketNo, category: parsed.data.category,
      });
    });
    await broadcastEvent(event);
    res.status(201).json({ id, salesTicketNo, status: 'new', reused: false });
  }));

  router.post('/support-agent/tickets/:id/claim', auth, supportAccess, asyncRoute(async (req, res) => {
    res.status(410).json({
      error: 'پذیرش دستی گفتگو غیرفعال است؛ هر گفتگو فقط از مسیر تخصیص خودکار به یک کارشناس می‌رسد.',
      code: 'MANUAL_CLAIM_DISABLED',
    });
  }));

  router.patch('/support-agent/tickets/:id/assignment', auth, supportAccess, permission('support.tickets.transfer'), asyncRoute(async (req, res) => {
    if (req.supportV5.admin) return res.status(403).json({ error: 'تخصیص مدیر غیرفعال است؛ گفتگوها فقط توسط سامانه تخصیص داده می‌شوند.' });
    const ticket = await visibleTicket(req, req.params.id);
    if (!ticket) return res.status(404).json({ error: 'تیکت پیدا نشد.' });
    const parsed = z.object({
      agentId: z.string().nullable().optional(), teamId: z.string().nullable().optional(),
      reason: z.string().trim().max(500).optional(), stateVersion: z.number().int().nonnegative(),
      notifyCustomer: z.boolean().default(true), summary: z.string().trim().max(2000).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'اطلاعات انتقال معتبر نیست.' });
    if (ticket.final_priority === 'critical' && !parsed.data.reason) return res.status(400).json({ error: 'برای گفتگوی حساس، دلیل انتقال الزامی است.' });
    const nextTeamId = parsed.data.teamId ?? ticket.team_id;
    const nextAgentId = parsed.data.agentId === undefined ? ticket.agent_id : parsed.data.agentId;
    const team = nextTeamId ? await db.selectFrom('support_teams').selectAll().where('id', '=', nextTeamId).where('status', '=', 'active').executeTakeFirst() : null;
    if (nextTeamId && !team) return res.status(404).json({ error: 'تیم فعال پیدا نشد.' });
    if (nextAgentId) {
      const agent = await db.selectFrom('users')
        .innerJoin('admin_members', 'admin_members.user_id', 'users.id')
        .select('users.id').where('users.id', '=', nextAgentId)
        .where('users.role', '=', 'support_agent').where('users.status', '=', 'active')
        .where('admin_members.section', '=', 'support')
        .executeTakeFirst();
      if (!agent) return res.status(409).json({ error: 'کارشناس مقصد فعال نیست یا دسترسی پشتیبانی ندارد.' });
      const workload = await capacityForAgent(nextAgentId);
      if (nextAgentId !== ticket.agent_id && workload.open >= workload.capacity) return res.status(409).json({
        error: `ظرفیت کارشناس مقصد تکمیل است (${workload.open} از ${workload.capacity} گفتگو).`,
        code: 'TARGET_AGENT_CAPACITY_REACHED', workload,
      });
    }
    const changedAt = now();
    const stateVersion = parsed.data.stateVersion + 1;
    const nextStatus = nextAgentId ? 'assigned' : 'queued';
    const event = createEvent({
      ticketId: ticket.id, eventType: 'ticket.transferred', actorType: 'agent',
      actorId: req.user.id, targetUserId: nextAgentId, teamId: nextTeamId,
      customerId: ticket.user_id,
      payload: { agentId: nextAgentId, teamId: nextTeamId, status: nextStatus, stateVersion },
    });
    const changed = await db.transaction().execute(async trx => {
      const update = await trx.updateTable('support_tickets').set({
        agent_id: nextAgentId, team_id: nextTeamId, status: nextStatus,
        state_version: stateVersion, updated_at: changedAt, last_activity_at: changedAt,
      }).where('id', '=', ticket.id).where(eb => eb.or([
        eb('state_version', '=', parsed.data.stateVersion), eb('state_version', 'is', null),
      ])).executeTakeFirst();
      if (Number(update.numUpdatedRows || 0) !== 1) return false;
      if (nextAgentId) await upsertAssignment(trx, {
        ticketId: ticket.id, agentId: nextAgentId, teamId: nextTeamId,
        assignedBy: req.user.id, assignedAt: changedAt, version: stateVersion,
      });
      else await trx.deleteFrom('support_assignments').where('ticket_id', '=', ticket.id).execute();
      await trx.insertInto('support_assignment_history').values({
        id: uuid(), ticket_id: ticket.id, from_agent_id: ticket.agent_id, to_agent_id: nextAgentId,
        from_team_id: ticket.team_id, to_team_id: nextTeamId, action: 'transfer',
        reason: parsed.data.reason || null, actor_id: req.user.id, created_at: changedAt,
      }).execute();
      await insertStatusHistory(trx, {
        ticket, to: nextStatus, actorType: 'agent', actorId: req.user.id,
        reason: parsed.data.reason || 'انتقال گفتگو', stateVersion,
        metadata: { summary: parsed.data.summary || null },
      });
      if (parsed.data.summary) await trx.insertInto('support_messages').values({
        id: uuid(), ticket_id: ticket.id, sender_id: req.user.id, sender_type: 'agent',
        message_type: 'internal_note', body: parsed.data.summary,
        sanitized_body: cleanText(parsed.data.summary), delivery_status: 'read',
        channel: 'web', metadata: JSON.stringify({ transferSummary: true }),
        record_version: 1, idempotency_key: `transfer-summary:${event.id}`, created_at: changedAt,
      }).execute();
      if (parsed.data.notifyCustomer) {
        const systemMessage = 'گفتگوی شما برای بررسی تخصصی‌تر به کارشناس/تیم مربوط منتقل شد.';
        await trx.insertInto('support_messages').values({
          id: uuid(), ticket_id: ticket.id, sender_id: req.user.id, sender_type: 'system',
          message_type: 'system', body: systemMessage, sanitized_body: systemMessage,
          delivery_status: 'sent', channel: 'web', metadata: '{}', record_version: 1,
          idempotency_key: `transfer-notice:${event.id}`, created_at: changedAt,
        }).execute();
        await trx.insertInto('notifications').values({
          id: uuid(), user_id: ticket.user_id, title: 'انتقال گفتگو',
          body: systemMessage, read_at: null, created_at: changedAt,
        }).execute();
      }
      await trx.insertInto('support_events').values(event).execute();
      await insertAudit(trx, req, 'support_ticket_transferred', 'support_ticket', ticket.id, { nextAgentId, nextTeamId });
      return true;
    });
    if (!changed) return res.status(409).json({ error: 'تیکت هم‌زمان تغییر کرده است؛ اطلاعات را تازه کنید.' });
    await broadcastEvent(event);
    res.json({ ok: true, stateVersion, status: nextStatus });
  }));

  router.get('/support-agent/transfer-options', auth, supportAccess, permission('support.tickets.transfer'), asyncRoute(async (_req, res) => {
    const [teams, agents, workloads, skills] = await Promise.all([
      db.selectFrom('support_teams').selectAll().where('status', '=', 'active').orderBy('name').execute(),
      db.selectFrom('users').innerJoin('admin_members', 'admin_members.user_id', 'users.id')
        .innerJoin('support_team_members', 'support_team_members.agent_id', 'users.id')
        .leftJoin('profiles', 'profiles.user_id', 'users.id')
        .leftJoin('support_agent_profiles', 'support_agent_profiles.agent_id', 'users.id')
        .select(['users.id', 'profiles.full_name', 'support_team_members.team_id', 'support_agent_profiles.presence_status', 'support_agent_profiles.capacity'])
        .where('users.role', '=', 'support_agent').where('users.status', '=', 'active')
        .where('admin_members.section', '=', 'support').execute(),
      db.selectFrom('support_assignments').innerJoin('support_tickets', 'support_tickets.id', 'support_assignments.ticket_id')
        .select(['support_assignments.agent_id', 'support_tickets.status'])
        .where('support_tickets.status', 'not in', ['resolved', 'closed']).execute(),
      db.selectFrom('support_agent_skills').innerJoin('support_skills', 'support_skills.id', 'support_agent_skills.skill_id')
        .select(['support_agent_skills.agent_id', 'support_agent_skills.level', 'support_skills.name']).execute(),
    ]);
    res.json({
      teams,
      agents: agents.map(agent => ({
        ...agent,
        openTickets: workloads.filter(item => item.agent_id === agent.id).length,
        skills: skills.filter(item => item.agent_id === agent.id).map(item => ({ name: item.name, level: item.level })),
      })),
    });
  }));
  router.get('/support-agent/filter-options', auth, supportAccess, asyncRoute(async (req, res) => {
    let teamsQuery = db.selectFrom('support_teams').select(['id', 'name']).where('status', '=', 'active').orderBy('name');
    if (!req.supportV5.admin) teamsQuery = teamsQuery.where('id', 'in', req.supportV5.teamIds);
    const [teams, agents] = await Promise.all([
      teamsQuery.execute(),
      db.selectFrom('users').innerJoin('admin_members', 'admin_members.user_id', 'users.id')
        .leftJoin('profiles', 'profiles.user_id', 'users.id')
        .select(['users.id', 'profiles.full_name']).where('users.role', '=', 'support_agent')
        .where('users.status', '=', 'active').where('admin_members.section', '=', 'support').orderBy('profiles.full_name').execute(),
    ]);
    res.json({ teams, agents, channels: ['web'] });
  }));

  router.patch('/support-agent/tickets/:id/operational-status', auth, supportAccess, asyncRoute(async (req, res) => {
    const ticket = await visibleTicket(req, req.params.id);
    if (!ticket) return res.status(404).json({ error: 'تیکت پیدا نشد.' });
    if (!canOperateTicket(req, ticket)) return rejectUnauthorizedOperation(req, res, ticket, 'operational_status_change');
    const parsed = z.object({
      status: z.enum(['open', 'reviewing', 'closed']),
      stateVersion: z.number().int().nonnegative(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'وضعیت گفتگو یا نسخه رکورد معتبر نیست.' });
    if (parsed.data.status === 'closed' && !req.supportV5.permissions['support.tickets.close']) {
      return res.status(403).json({ error: 'مجوز بستن گفتگو فعال نیست.' });
    }
    const targetStatus = parsed.data.status === 'closed'
      ? 'closed'
      : parsed.data.status === 'reviewing'
        ? 'waiting_internal'
        : ticket.agent_id ? 'agent_active' : 'queued';
    if (ticket.status === targetStatus) return res.json({ ok: true, status: parsed.data.status, internalStatus: targetStatus, stateVersion: Number(ticket.state_version || 0), reused: true });
    const changedAt = now();
    const stateVersion = parsed.data.stateVersion + 1;
    const event = createEvent({
      ticketId: ticket.id, eventType: 'ticket.status_changed', actorType: 'agent', actorId: req.user.id,
      targetUserId: ticket.agent_id, teamId: ticket.team_id, customerId: ticket.user_id,
      payload: { from: ticket.status, to: targetStatus, operationalStatus: parsed.data.status, stateVersion },
    });
    const changed = await db.transaction().execute(async trx => {
      const update = await trx.updateTable('support_tickets').set({
        status: targetStatus, state_version: stateVersion,
        resolved_at: parsed.data.status === 'closed' ? changedAt : null,
        closed_at: parsed.data.status === 'closed' ? changedAt : null,
        snoozed_until: null, snooze_reason: null,
        updated_at: changedAt, last_activity_at: changedAt,
      }).where('id', '=', ticket.id).where(eb => eb.or([
        eb('state_version', '=', parsed.data.stateVersion), eb('state_version', 'is', null),
      ])).executeTakeFirst();
      if (Number(update.numUpdatedRows || 0) !== 1) return false;
      await insertStatusHistory(trx, {
        ticket, to: targetStatus, actorType: 'agent', actorId: req.user.id,
        reason: `وضعیت عملیاتی: ${parsed.data.status}`, stateVersion,
        metadata: { operationalStatus: parsed.data.status },
      });
      if (parsed.data.status === 'closed') {
        await trx.insertInto('notifications').values({
          id: uuid(), user_id: ticket.user_id, title: 'گفتگوی پشتیبانی بسته شد',
          body: `گفتگوی ${ticket.public_no || ticket.ticket_no} پس از بررسی بسته شد. در صورت نیاز می‌توانید آن را دوباره باز کنید.`,
          read_at: null, created_at: changedAt,
        }).execute();
      }
      await trx.insertInto('support_events').values(event).execute();
      await insertAudit(trx, req, 'support_ticket_operational_status_changed', 'support_ticket', ticket.id, {
        from: ticket.status, to: targetStatus, operationalStatus: parsed.data.status,
      });
      return true;
    });
    if (!changed) return res.status(409).json({ error: 'وضعیت هم‌زمان تغییر کرده است؛ اطلاعات را تازه کنید.' });
    await broadcastEvent(event);
    res.json({ ok: true, status: parsed.data.status, internalStatus: targetStatus, stateVersion });
  }));

  router.patch('/support-agent/tickets/:id/status', auth, supportAccess, asyncRoute(async (req, res) => {
    const ticket = await visibleTicket(req, req.params.id);
    if (!ticket) return res.status(404).json({ error: 'تیکت پیدا نشد.' });
    if (!canOperateTicket(req, ticket)) return rejectUnauthorizedOperation(req, res, ticket, 'status_change');
    const parsed = z.object({ status: z.enum(supportStatuses), stateVersion: z.number().int().nonnegative(), reason: z.string().max(500).optional(), snoozedUntil: z.string().datetime().optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'وضعیت یا نسخه رکورد معتبر نیست.' });
    if (parsed.data.status === 'assigned') return res.status(409).json({ error: 'وضعیت «تخصیص‌یافته» فقط از مسیر پذیرش یا انتقال ایجاد می‌شود.' });
    const allowed = supportTransitions[ticket.status] || [];
    if (!allowed.includes(parsed.data.status)) return res.status(409).json({ error: `انتقال از ${ticket.status} به ${parsed.data.status} مجاز نیست.`, allowed });
    const closeAction = ['resolved', 'closed'].includes(parsed.data.status);
    if (closeAction && !req.supportV5.permissions['support.tickets.close']) return res.status(403).json({ error: 'مجوز حل یا بستن تیکت فعال نیست.' });
    if (parsed.data.status === 'snoozed' && (!parsed.data.snoozedUntil || new Date(parsed.data.snoozedUntil) <= new Date())) {
      return res.status(400).json({ error: 'تاریخ و ساعت معتبرِ آینده برای یادآوری الزامی است.' });
    }
    const changedAt = now();
    const stateVersion = parsed.data.stateVersion + 1;
    const eventType = parsed.data.status === 'snoozed' ? 'ticket.snoozed' : 'ticket.status_changed';
    const event = createEvent({
      ticketId: ticket.id, eventType, actorType: 'agent', actorId: req.user.id,
      targetUserId: ticket.agent_id, teamId: ticket.team_id, customerId: ticket.user_id,
      payload: { from: ticket.status, to: parsed.data.status, reason: parsed.data.reason || null, stateVersion, snoozedUntil: parsed.data.snoozedUntil || null },
    });
    const changed = await db.transaction().execute(async trx => {
      const update = await trx.updateTable('support_tickets').set({
        status: parsed.data.status, state_version: stateVersion,
        snoozed_until: parsed.data.status === 'snoozed' ? parsed.data.snoozedUntil : null,
        snooze_reason: parsed.data.status === 'snoozed' ? cleanText(parsed.data.reason) || null : null,
        resolved_at: parsed.data.status === 'resolved' ? changedAt : ticket.resolved_at,
        closed_at: parsed.data.status === 'closed' ? changedAt : null,
        updated_at: changedAt, last_activity_at: changedAt,
      }).where('id', '=', ticket.id).where(eb => eb.or([
        eb('state_version', '=', parsed.data.stateVersion), eb('state_version', 'is', null),
      ])).executeTakeFirst();
      if (Number(update.numUpdatedRows || 0) !== 1) return false;
      await insertStatusHistory(trx, {
        ticket, to: parsed.data.status, actorType: 'agent', actorId: req.user.id,
        reason: parsed.data.reason, stateVersion,
        metadata: { snoozedUntil: parsed.data.snoozedUntil || null },
      });
      if (parsed.data.status === 'snoozed') {
        await trx.insertInto('support_sla_events').values({
          id: uuid(), ticket_id: ticket.id, metric: 'all', event_type: 'paused',
          due_at: parsed.data.snoozedUntil, occurred_at: changedAt,
          metadata: JSON.stringify({ reason: parsed.data.reason || 'snoozed' }),
        }).execute();
      }
      await trx.insertInto('support_events').values(event).execute();
      await insertAudit(trx, req, 'support_ticket_status_changed_v5', 'support_ticket', ticket.id, { from: ticket.status, to: parsed.data.status });
      return true;
    });
    if (!changed) return res.status(409).json({ error: 'وضعیت هم‌زمان تغییر کرده است؛ اطلاعات را تازه کنید.' });
    await broadcastEvent(event);
    if (closeAction) queueMicrotask(() => rebalanceQueue().catch(() => {}));
    res.json({ ok: true, status: parsed.data.status, stateVersion });
  }));

  router.post('/support-agent/tickets/:id/messages', auth, supportAccess, asyncRoute(async (req, res) => {
    const ticket = await visibleTicket(req, req.params.id);
    if (!ticket) return res.status(404).json({ error: 'تیکت پیدا نشد.' });
    const parsed = z.object({
      body: z.string().trim().min(1).max(4000), type: z.enum(['public_reply', 'internal_note']).default('public_reply'),
      replyToId: z.string().nullable().optional(), stateVersion: z.number().int().nonnegative(),
      idempotencyKey: z.string().min(8).max(100), attachmentIds: z.array(z.string()).max(5).default([]),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'متن، نوع یا نسخه پیام معتبر نیست.' });
    const requiredPermission = parsed.data.type === 'internal_note' ? 'support.notes.create' : 'support.tickets.reply';
    if (!req.supportV5.permissions[requiredPermission]) return res.status(403).json({ error: 'مجوز این نوع پیام فعال نیست.' });
    if (ticket.agent_id && ticket.agent_id !== req.user.id && !req.supportV5.admin) {
      return rejectUnauthorizedOperation(req, res, ticket, 'message_create');
    }
    if (!ticket.agent_id) {
      return rejectUnauthorizedOperation(req, res, ticket, 'message_without_assignment');
    }
    const existing = await db.selectFrom('support_messages').selectAll().where('ticket_id', '=', ticket.id).where('idempotency_key', '=', parsed.data.idempotencyKey).executeTakeFirst();
    if (existing) return res.status(200).json({ message: existing, reused: true });
    const activeViewer = await db.selectFrom('support_agent_views').leftJoin('profiles', 'profiles.user_id', 'support_agent_views.agent_id')
      .select(['support_agent_views.agent_id', 'profiles.full_name']).where('ticket_id', '=', ticket.id)
      .where('agent_id', '!=', req.user.id).where('last_seen_at', '>=', new Date(Date.now() - 45_000).toISOString()).executeTakeFirst();
    const latestAgent = await db.selectFrom('support_messages').select(['body', 'sender_id', 'created_at']).where('ticket_id', '=', ticket.id)
      .where('sender_type', '=', 'agent').where('message_type', '=', 'public_reply').orderBy('created_at', 'desc').executeTakeFirst();
    if (parsed.data.type === 'public_reply' && latestAgent && latestAgent.sender_id !== req.user.id &&
      Date.now() - new Date(latestAgent.created_at).getTime() < 30_000 &&
      cleanText(latestAgent.body) === cleanText(parsed.data.body)) {
      return res.status(409).json({ error: 'پاسخ مشابه چند لحظه قبل توسط کارشناس دیگری ثبت شده است.', collision: true });
    }
    const id = uuid();
    const createdAt = now();
    const nextStatus = parsed.data.type === 'public_reply' ? 'waiting_customer' : ticket.status;
    const attachmentRows = parsed.data.attachmentIds.length ? await db.selectFrom('support_attachments').selectAll()
      .where('id', 'in', parsed.data.attachmentIds).where('ticket_id', '=', ticket.id)
      .where('uploader_id', '=', req.user.id).where('message_id', 'is', null).where('deleted_at', 'is', null).execute() : [];
    if (attachmentRows.length !== parsed.data.attachmentIds.length) return res.status(400).json({ error: 'یکی از پیوست‌ها معتبر نیست.' });
    const event = createEvent({
      ticketId: ticket.id, eventType: parsed.data.type === 'public_reply' ? 'message.created' : 'note.created',
      actorType: 'agent', actorId: req.user.id, targetUserId: ticket.user_id,
      teamId: ticket.team_id, customerId: ticket.user_id,
      payload: { messageId: id, senderType: 'agent', messageType: parsed.data.type, status: nextStatus, stateVersion: parsed.data.stateVersion + 1 },
    });
    const changed = await db.transaction().execute(async trx => {
      const update = await trx.updateTable('support_tickets').set({
        agent_id: ticket.agent_id, status: nextStatus,
        state_version: parsed.data.stateVersion + 1, updated_at: createdAt, last_activity_at: createdAt,
        first_response_at: parsed.data.type === 'public_reply' ? (ticket.first_response_at || createdAt) : ticket.first_response_at,
        last_agent_message_at: parsed.data.type === 'public_reply' ? createdAt : ticket.last_agent_message_at,
        unread_customer: parsed.data.type === 'public_reply' ? sql`COALESCE(unread_customer, 0) + 1` : ticket.unread_customer,
      }).where('id', '=', ticket.id).where(eb => eb.or([eb('state_version', '=', parsed.data.stateVersion), eb('state_version', 'is', null)])).executeTakeFirst();
      if (Number(update.numUpdatedRows || 0) !== 1) return false;
      await trx.insertInto('support_messages').values({
        id, ticket_id: ticket.id, sender_id: req.user.id, sender_type: 'agent',
        message_type: parsed.data.type, body: parsed.data.body, sanitized_body: cleanText(parsed.data.body),
        reply_to_id: parsed.data.replyToId || null, delivery_status: parsed.data.type === 'public_reply' ? 'sent' : 'read',
        channel: 'web', metadata: JSON.stringify({ collisionViewer: activeViewer?.full_name || null }),
        record_version: 1, idempotency_key: parsed.data.idempotencyKey, created_at: createdAt,
      }).execute();
      if (attachmentRows.length) await trx.updateTable('support_attachments').set({ message_id: id }).where('id', 'in', attachmentRows.map(item => item.id)).execute();
      if (nextStatus !== ticket.status) await insertStatusHistory(trx, {
        ticket, to: nextStatus, actorType: 'agent', actorId: req.user.id,
        reason: 'ثبت پاسخ کارشناس تخصیص‌یافته',
        stateVersion: parsed.data.stateVersion + 1,
      });
      await trx.insertInto('support_events').values(event).execute();
      if (parsed.data.type === 'public_reply') await trx.insertInto('notifications').values({
        id: uuid(), user_id: ticket.user_id, title: 'پاسخ جدید پشتیبانی',
        body: `برای گفتگوی ${ticket.public_no || ticket.ticket_no} پاسخ جدید ثبت شد.`,
        read_at: null, created_at: createdAt,
      }).execute();
      await insertAudit(trx, req, parsed.data.type === 'public_reply' ? 'support_public_reply_sent' : 'support_internal_note_created', 'support_ticket', ticket.id, { assignedAgentId: ticket.agent_id });
      return true;
    });
    if (!changed) return res.status(409).json({ error: 'گفتگو هم‌زمان تغییر کرده است؛ قبل از ارسال، اطلاعات را تازه کنید.' });
    await broadcastEvent(event);
    res.status(201).json({ message: { id, created_at: createdAt, delivery_status: parsed.data.type === 'public_reply' ? 'sent' : 'read' }, stateVersion: parsed.data.stateVersion + 1, reused: false, collisionViewer: activeViewer?.full_name || null });
  }));

  router.post('/support-agent/tickets/:id/read', auth, supportAccess, asyncRoute(async (req, res) => {
    const ticket = await visibleTicket(req, req.params.id);
    if (!ticket) return res.status(404).json({ error: 'تیکت پیدا نشد.' });
    const rows = await db.selectFrom('support_messages').select('id').where('ticket_id', '=', ticket.id).where('sender_type', '=', 'customer').execute();
    const at = now();
    await db.transaction().execute(async trx => {
      for (const row of rows) await trx.insertInto('support_message_reads').values({ message_id: row.id, user_id: req.user.id, delivered_at: at, read_at: at, created_at: at }).onConflict(oc => oc.columns(['message_id', 'user_id']).doUpdateSet({ delivered_at: at, read_at: at })).execute();
      if (rows.length) await trx.updateTable('support_messages').set({ delivery_status: 'read', delivered_at: at, read_at: at })
        .where('id', 'in', rows.map(row => row.id)).execute();
      await trx.updateTable('support_tickets').set({ unread_agent: 0 }).where('id', '=', ticket.id).execute();
    });
    await emitEvent({ ticketId: ticket.id, eventType: 'message.read', actorType: 'agent', actorId: req.user.id, customerId: ticket.user_id, payload: { readAt: at } });
    res.json({ ok: true, readAt: at });
  }));

  router.post('/support-agent/presence', auth, supportAccess, asyncRoute(async (req, res) => {
    const parsed = z.object({ status: z.enum(['online', 'busy', 'away', 'offline']), ticketId: z.string().nullable().optional(), typing: z.boolean().optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'وضعیت حضور معتبر نیست.' });
    const at = now();
    await db.insertInto('support_agent_profiles').values({
      agent_id: req.user.id, avatar_url: null, title: 'کارشناس پشتیبانی', languages: '["fa"]',
      seniority: 'mid', timezone: 'Asia/Tehran', working_hours: '{}', capacity: 8,
      presence_status: parsed.data.status, last_heartbeat_at: at, last_seen_at: at, created_at: at, updated_at: at,
    }).onConflict(oc => oc.column('agent_id').doUpdateSet({
      presence_status: parsed.data.status, last_heartbeat_at: at, last_seen_at: at, updated_at: at,
    })).execute();
    if (parsed.data.ticketId) await db.insertInto('support_agent_views').values({ ticket_id: parsed.data.ticketId, agent_id: req.user.id, is_typing: parsed.data.typing ? 1 : 0, last_seen_at: at })
      .onConflict(oc => oc.columns(['ticket_id', 'agent_id']).doUpdateSet({ is_typing: parsed.data.typing ? 1 : 0, last_seen_at: at })).execute();
    await emitEvent({ ticketId: parsed.data.ticketId || null, eventType: parsed.data.typing ? 'typing.changed' : 'presence.changed', actorType: 'agent', actorId: req.user.id, payload: { status: parsed.data.status, typing: Boolean(parsed.data.typing), at } });
    if (!parsed.data.typing && ['online', 'away'].includes(parsed.data.status)) queueMicrotask(() => rebalanceQueue().catch(() => {}));
    res.json({ ok: true, at });
  }));

  router.get('/support-agent/tickets/:id/ai-summary', auth, supportAccess, permission('support.knowledge.view'), asyncRoute(async (req, res) => {
    const ticket = await visibleTicket(req, req.params.id);
    if (!ticket) return res.status(404).json({ error: 'تیکت در محدوده دسترسی شما نیست.' });
    const messages = await db.selectFrom('support_messages')
      .select(['sender_type', 'message_type', 'body', 'created_at'])
      .where('ticket_id', '=', ticket.id).where('deleted_at', 'is', null)
      .orderBy('created_at', 'desc').limit(12).execute();
    const publicMessages = messages.filter(item => item.message_type !== 'internal_note').reverse();
    const latestCustomer = [...publicMessages].reverse().find(item => item.sender_type === 'customer');
    const summary = [
      `موضوع: ${ticket.subject}`,
      `وضعیت: ${ticket.status} | اولویت: ${ticket.final_priority || ticket.priority || 'normal'}`,
      `درخواست اخیر مشتری: ${cleanText(latestCustomer?.body).slice(0, 600) || 'ثبت نشده'}`,
      `روند گفتگو: ${publicMessages.slice(-6).map(item => `${item.sender_type}: ${cleanText(item.body).slice(0, 180)}`).join(' | ')}`,
      ticket.escalation_reason ? `علت انتقال: ${ticket.escalation_reason}` : null,
    ].filter(Boolean).join('\n');
    await audit(req, 'support_ai_summary_generated', 'support_ticket', ticket.id);
    res.json({ summary, generatedBy: 'deterministic-safe-summary', messageCount: publicMessages.length });
  }));

  router.post('/support-agent/tickets/:id/ai-suggestion', auth, supportAccess, permission('support.knowledge.view'), asyncRoute(async (req, res) => {
    const ticket = await visibleTicket(req, req.params.id);
    if (!ticket) return res.status(404).json({ error: 'تیکت در محدوده دسترسی شما نیست.' });
    if (!await rateLimit(`agent-assist:${req.user.id}`, 12)) return res.status(429).json({ error: 'محدودیت پیشنهاد هوشمند اعمال شد.' });
    const latestCustomer = await db.selectFrom('support_messages').select(['id', 'body'])
      .where('ticket_id', '=', ticket.id).where('sender_type', '=', 'customer')
      .where('deleted_at', 'is', null).orderBy('created_at', 'desc').executeTakeFirst();
    if (!latestCustomer) return res.status(409).json({ error: 'پیام مشتری برای پیشنهاد پاسخ پیدا نشد.' });
    const contexts = await searchKnowledge(latestCustomer.body, 'internal', 5);
    if (!contexts.length || Number(contexts[0].score || 0) < 0.18) {
      await audit(req, 'support_ai_suggestion_insufficient_evidence', 'support_ticket', ticket.id);
      return res.status(409).json({ error: 'منبع معتبر کافی برای پیشنهاد پاسخ وجود ندارد.' });
    }
    const answer = await generateGroundedAnswer({ question: latestCustomer.body, contexts });
    const citedIds = Array.isArray(answer.citationChunkIds) && answer.citationChunkIds.length
      ? answer.citationChunkIds : contexts.slice(0, 1).map(item => item.id);
    const sourceMap = new Map(contexts.map(item => [item.id, item]));
    const citations = citedIds.map(id => sourceMap.get(id)).filter(Boolean).map(item => ({
      documentId: item.document_id, versionId: item.version_id, chunkId: item.id,
      title: item.title, excerpt: item.body.slice(0, 280),
    }));
    if (!citations.length) return res.status(409).json({ error: 'پیشنهاد بدون Citation معتبر قابل استفاده نیست.' });
    await audit(req, 'support_ai_suggestion_generated', 'support_ticket', ticket.id, { sourceCount: citations.length });
    res.json({ suggestion: answer.text, citations, confidence: answer.confidence || Number(contexts[0].score.toFixed(2)), requiresAgentApproval: true, autoSent: false });
  }));

  router.get('/support-agent/macros', auth, supportAccess, asyncRoute(async (req, res) => {
    const rows = await db.selectFrom('support_macros').selectAll().where('status', '=', 'active')
      .where(eb => eb.or([eb('scope', '=', 'global'), eb('owner_id', '=', req.user.id), ...(req.supportV5.teamIds.length ? [eb('team_id', 'in', req.supportV5.teamIds)] : [])])).orderBy('name').execute();
    res.json(rows);
  }));
  router.post('/support-agent/macros', auth, supportAccess, permission('support.macros.manage'), asyncRoute(async (req, res) => {
    const parsed = z.object({ name: z.string().trim().min(2).max(100), body: z.string().trim().min(2).max(4000), scope: z.enum(['personal', 'team', 'global']), teamId: z.string().nullable().optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'اطلاعات پاسخ آماده معتبر نیست.' });
    if (parsed.data.scope === 'global' && !req.supportV5.admin) return res.status(403).json({ error: 'Macro عمومی فقط توسط مدیر ساخته می‌شود.' });
    const id = uuid();
    await db.insertInto('support_macros').values({ id, name: parsed.data.name, body: parsed.data.body, scope: parsed.data.scope, owner_id: req.user.id, team_id: parsed.data.teamId || null, status: 'active', created_at: now(), updated_at: now() }).execute();
    res.status(201).json({ id });
  }));

  router.get('/support-agent/tags', auth, supportAccess, asyncRoute(async (_req, res) => res.json(await db.selectFrom('support_tags').selectAll().where('status', '=', 'active').orderBy('name').execute())));
  router.post('/support-agent/tickets/:id/tags', auth, supportAccess, permission('support.tags.manage'), asyncRoute(async (req, res) => {
    const ticket = await visibleTicket(req, req.params.id);
    if (!ticket) return res.status(404).json({ error: 'تیکت پیدا نشد.' });
    const parsed = z.object({ tagIds: z.array(z.string()).max(20) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Tagها معتبر نیستند.' });
    await db.transaction().execute(async trx => {
      await trx.deleteFrom('support_ticket_tags').where('ticket_id', '=', ticket.id).execute();
      for (const tagId of parsed.data.tagIds) await trx.insertInto('support_ticket_tags').values({ ticket_id: ticket.id, tag_id: tagId, added_by: req.user.id, created_at: now() }).execute();
    });
    res.json({ ok: true });
  }));

  router.get('/support-agent/reports', auth, supportAccess, permission('support.reports.view'), asyncRoute(async (req, res) => {
    const from = cleanText(req.query.from) || new Date(Date.now() - 30 * 86_400_000).toISOString();
    const to = cleanText(req.query.to) || now();
    const rows = await db.selectFrom('support_tickets').selectAll().where('created_at', '>=', from).where('created_at', '<=', to).execute();
    const csat = await db.selectFrom('support_csat').selectAll().where('created_at', '>=', from).where('created_at', '<=', to).where('active', '=', 1).execute();
    const aiRuns = await db.selectFrom('ai_runs').selectAll().where('created_at', '>=', from).where('created_at', '<=', to).execute();
    const resolved = rows.filter(item => item.resolved_at);
    const average = values => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
    res.json({
      range: { from, to },
      kpis: {
        newTickets: rows.length, backlog: rows.filter(item => !['resolved', 'closed'].includes(item.status)).length,
        resolved: resolved.length, reopened: rows.filter(item => item.status === 'reopened').length,
        firstResponseMinutes: average(rows.filter(item => item.first_response_at).map(item => (new Date(item.first_response_at) - new Date(item.created_at)) / 60_000)),
        resolutionMinutes: average(resolved.map(item => (new Date(item.resolved_at) - new Date(item.created_at)) / 60_000)),
        slaBreached: rows.filter(item => item.resolved_at && item.resolution_due_at && item.resolved_at > item.resolution_due_at).length,
        csat: csat.length ? Number((csat.reduce((sum, item) => sum + item.rating, 0) / csat.length).toFixed(2)) : null,
        csatResponseRate: resolved.length ? Number((csat.length / resolved.length * 100).toFixed(1)) : 0,
        aiResolutionRate: aiRuns.length ? Number((aiRuns.filter(item => item.status === 'completed').length / aiRuns.length * 100).toFixed(1)) : 0,
        aiEscalationRate: aiRuns.length ? Number((aiRuns.filter(item => item.status !== 'completed').length / aiRuns.length * 100).toFixed(1)) : 0,
        aiCostMicros: aiRuns.reduce((sum, item) => sum + Number(item.cost_micros || 0), 0),
      },
    });
  }));

  router.get('/support-admin/teams', auth, supportAccess, permission('support.teams.manage'), asyncRoute(async (_req, res) => {
    res.json(await db.selectFrom('support_teams').selectAll().orderBy('name').execute());
  }));
  router.post('/support-admin/teams', auth, supportAccess, permission('support.teams.manage'), asyncRoute(async (req, res) => {
    const parsed = z.object({ name: z.string().trim().min(2).max(100), slug: z.string().regex(/^[a-z0-9-]{2,80}$/), timezone: z.string().min(3).max(80).default('Asia/Tehran'), capacity: z.number().int().min(1).max(100).default(8), workingHours: z.record(z.string(), z.array(z.tuple([z.string(), z.string()]))).optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'اطلاعات تیم معتبر نیست.' });
    const id = uuid();
    await db.insertInto('support_teams').values({ id, name: parsed.data.name, slug: parsed.data.slug, status: 'active', timezone: parsed.data.timezone, working_hours: JSON.stringify(parsed.data.workingHours || defaultWorkingHours), holidays: '[]', default_capacity: parsed.data.capacity, created_by: req.user.id, created_at: now(), updated_at: now() }).execute();
    res.status(201).json({ id });
  }));
  router.get('/support-admin/skills', auth, supportAccess, permission('support.agents.manage'), asyncRoute(async (_req, res) => {
    res.json(await db.selectFrom('support_skills').selectAll().orderBy('name').execute());
  }));
  router.post('/support-admin/skills', auth, supportAccess, permission('support.agents.manage'), asyncRoute(async (req, res) => {
    const parsed = z.object({ name: z.string().trim().min(2).max(100), slug: z.string().regex(/^[a-z0-9-]{2,80}$/) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'اطلاعات مهارت معتبر نیست.' });
    const id = uuid();
    await db.insertInto('support_skills').values({ id, name: parsed.data.name, slug: parsed.data.slug, status: 'active', metadata: '{}', created_at: now() }).execute();
    res.status(201).json({ id });
  }));
  router.put('/support-admin/agents/:id/skills', auth, supportAccess, permission('support.agents.manage'), asyncRoute(async (req, res) => {
    const parsed = z.object({ skills: z.array(z.object({ skillId: z.string(), level: z.number().int().min(1).max(5) })).max(30) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'مهارت‌های کارشناس معتبر نیستند.' });
    await db.transaction().execute(async trx => {
      await trx.deleteFrom('support_agent_skills').where('agent_id', '=', req.params.id).execute();
      for (const item of parsed.data.skills) await trx.insertInto('support_agent_skills').values({
        agent_id: req.params.id, skill_id: item.skillId, level: item.level, created_at: now(),
      }).execute();
    });
    await audit(req, 'support_agent_skills_updated', 'support_agent', req.params.id);
    res.json({ ok: true });
  }));
  router.put('/support-admin/agents/:id/teams', auth, supportAccess, permission('support.agents.manage'), asyncRoute(async (req, res) => {
    const parsed = z.object({ teamIds: z.array(z.string()).min(1).max(20), primaryTeamId: z.string() }).safeParse(req.body);
    if (!parsed.success || !parsed.data.teamIds.includes(parsed.data.primaryTeamId)) return res.status(400).json({ error: 'تیم‌های کارشناس معتبر نیستند.' });
    const agent = await db.selectFrom('users').innerJoin('admin_members', 'admin_members.user_id', 'users.id')
      .select('users.id').where('users.id', '=', req.params.id).where('users.role', '=', 'support_agent')
      .where('admin_members.section', '=', 'support').executeTakeFirst();
    if (!agent) return res.status(404).json({ error: 'کارشناس پشتیبانی پیدا نشد.' });
    const teams = await db.selectFrom('support_teams').select('id').where('id', 'in', parsed.data.teamIds).where('status', '=', 'active').execute();
    if (teams.length !== parsed.data.teamIds.length) return res.status(400).json({ error: 'یک یا چند تیم فعال پیدا نشد.' });
    await db.transaction().execute(async trx => {
      await trx.deleteFrom('support_team_members').where('agent_id', '=', agent.id).execute();
      for (const teamId of parsed.data.teamIds) await trx.insertInto('support_team_members').values({
        team_id: teamId, agent_id: agent.id, is_primary: teamId === parsed.data.primaryTeamId ? 1 : 0, created_at: now(),
      }).execute();
    });
    await audit(req, 'support_agent_teams_updated', 'support_agent', agent.id, { teamIds: parsed.data.teamIds });
    res.json({ ok: true });
  }));

  router.get('/support-admin/slas', auth, supportAccess, permission('support.sla.manage'), asyncRoute(async (_req, res) => res.json(await db.selectFrom('support_sla_policies').selectAll().orderBy('priority').execute())));
  router.get('/support-admin/alerts', auth, supportAccess, permission('support.sla.manage'), asyncRoute(async (_req, res) => {
    const current = now();
    const items = await db.selectFrom('support_tickets')
      .leftJoin('profiles', 'profiles.user_id', 'support_tickets.agent_id')
      .leftJoin('support_teams', 'support_teams.id', 'support_tickets.team_id')
      .select([
        'support_tickets.id', 'support_tickets.public_no', 'support_tickets.ticket_no',
        'support_tickets.subject', 'support_tickets.status', 'support_tickets.final_priority',
        'support_tickets.resolution_due_at', 'support_tickets.agent_id',
        'profiles.full_name as agent_name', 'support_teams.name as team_name',
      ])
      .where('support_tickets.status', 'not in', ['resolved', 'closed'])
      .where('support_tickets.resolution_due_at', '<', current)
      .orderBy('support_tickets.resolution_due_at').limit(200).execute();
    const capacityRows = await db.selectFrom('support_agent_profiles')
      .innerJoin('users', 'users.id', 'support_agent_profiles.agent_id')
      .leftJoin('profiles', 'profiles.user_id', 'users.id')
      .select(['support_agent_profiles.agent_id', 'support_agent_profiles.capacity', 'profiles.full_name'])
      .where('users.status', '=', 'active').execute();
    const capacities = [];
    for (const agent of capacityRows) capacities.push({
      ...agent, open: await agentWorkload(agent.agent_id),
      saturated: await agentWorkload(agent.agent_id) >= Number(agent.capacity || 8),
    });
    res.json({ generatedAt: current, breached: items, capacities });
  }));
  router.patch('/support-admin/slas/:id', auth, supportAccess, permission('support.sla.manage'), asyncRoute(async (req, res) => {
    const parsed = z.object({ firstResponseMinutes: z.number().int().min(1).max(100_000), nextResponseMinutes: z.number().int().min(1).max(100_000), resolutionMinutes: z.number().int().min(1).max(200_000), warningPercent: z.number().int().min(10).max(99) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'مقادیر SLA معتبر نیستند.' });
    const changed = await db.updateTable('support_sla_policies').set({ first_response_minutes: parsed.data.firstResponseMinutes, next_response_minutes: parsed.data.nextResponseMinutes, resolution_minutes: parsed.data.resolutionMinutes, warning_percent: parsed.data.warningPercent, updated_at: now() }).where('id', '=', req.params.id).executeTakeFirst();
    if (!Number(changed.numUpdatedRows || 0)) return res.status(404).json({ error: 'سیاست SLA پیدا نشد.' });
    res.json({ ok: true });
  }));

  router.get('/support-admin/knowledge', auth, supportAccess, permission('support.knowledge.view'), asyncRoute(async (req, res) => {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 30)));
    const items = await db.selectFrom('knowledge_documents').selectAll().orderBy('updated_at', 'desc').limit(limit).offset((page - 1) * limit).execute();
    res.json({ items, page, limit, hasMore: items.length === limit });
  }));
  router.post('/support-admin/knowledge', auth, supportAccess, permission('support.knowledge.manage'), asyncRoute(async (req, res) => {
    const parsed = z.object({
      title: z.string().trim().min(3).max(200), slug: z.string().regex(/^[a-z0-9-]{3,120}$/),
      body: z.string().trim().min(20).max(200_000), contentType: z.string().trim().max(50).default('article'),
      language: z.string().trim().max(10).default('fa'), scope: z.enum(['public', 'internal']).default('public'),
      status: z.enum(['draft', 'published']).default('draft'), changeNote: z.string().max(500).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'سند پایگاه دانش معتبر نیست.', fields: parsed.error.flatten().fieldErrors });
    const id = uuid();
    const versionId = uuid();
    const createdAt = now();
    await db.transaction().execute(async trx => {
      await trx.insertInto('knowledge_documents').values({
        id, title: parsed.data.title, slug: parsed.data.slug, content_type: parsed.data.contentType,
        status: parsed.data.status, language: parsed.data.language, scope: parsed.data.scope,
        author_id: req.user.id, approver_id: parsed.data.status === 'published' ? req.user.id : null,
        current_version: 1, index_status: 'pending', metadata: '{}', created_at: createdAt, updated_at: createdAt,
      }).execute();
      await trx.insertInto('knowledge_document_versions').values({ id: versionId, document_id: id, version: 1, body: parsed.data.body, change_note: parsed.data.changeNote || null, author_id: req.user.id, created_at: createdAt }).execute();
    });
    res.status(201).json({ id, versionId });
  }));

  router.patch('/support-admin/knowledge/:id', auth, supportAccess, permission('support.knowledge.manage'), asyncRoute(async (req, res) => {
    const parsed = z.object({
      title: z.string().trim().min(3).max(200).optional(),
      body: z.string().trim().min(20).max(200_000),
      status: z.enum(['draft', 'published']).optional(),
      changeNote: z.string().max(500).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'نسخه جدید سند معتبر نیست.' });
    const document = await db.selectFrom('knowledge_documents').selectAll().where('id', '=', req.params.id).executeTakeFirst();
    if (!document) return res.status(404).json({ error: 'سند پیدا نشد.' });
    const version = Number(document.current_version || 1) + 1;
    const versionId = uuid();
    const at = now();
    await db.transaction().execute(async trx => {
      await trx.insertInto('knowledge_document_versions').values({
        id: versionId, document_id: document.id, version, body: parsed.data.body,
        change_note: parsed.data.changeNote || null, author_id: req.user.id, created_at: at,
      }).execute();
      await trx.updateTable('knowledge_documents').set({
        title: parsed.data.title || document.title, status: parsed.data.status || document.status,
        approver_id: parsed.data.status === 'published' ? req.user.id : document.approver_id,
        current_version: version, index_status: 'pending', updated_at: at,
      }).where('id', '=', document.id).execute();
    });
    await audit(req, 'support_knowledge_version_created', 'knowledge_document', document.id, { version });
    res.json({ id: document.id, versionId, version, indexStatus: 'pending' });
  }));

  router.post('/support-admin/knowledge/:id/reindex', auth, supportAccess, permission('support.knowledge.manage'), asyncRoute(async (req, res) => {
    const document = await db.selectFrom('knowledge_documents').selectAll().where('id', '=', req.params.id).executeTakeFirst();
    if (!document) return res.status(404).json({ error: 'سند پیدا نشد.' });
    const version = await db.selectFrom('knowledge_document_versions').selectAll().where('document_id', '=', document.id).where('version', '=', document.current_version).executeTakeFirst();
    if (!version) return res.status(409).json({ error: 'نسخه فعال سند پیدا نشد.' });
    const chunks = chunkDocument(version.body);
    await db.transaction().execute(async trx => {
      await trx.deleteFrom('knowledge_chunks').where('document_id', '=', document.id).execute();
      let index = 0;
      for (const body of chunks) {
        const remote = await createEmbedding(body).catch(() => null);
        await trx.insertInto('knowledge_chunks').values({
          id: uuid(), document_id: document.id, version_id: version.id, chunk_index: index,
          heading: index === 0 ? document.title : null, body,
          embedding: JSON.stringify(remote || localEmbedding(body)), metadata: JSON.stringify({ embeddingProvider: remote ? 'configured-provider' : 'local-hash' }),
          created_at: now(),
        }).execute();
        index += 1;
      }
      await trx.updateTable('knowledge_documents').set({ index_status: 'indexed', updated_at: now() }).where('id', '=', document.id).execute();
    });
    res.json({ ok: true, chunks: chunks.length });
  }));

  router.post('/support/ai/tools/:tool', auth, customerOnly, asyncRoute(async (req, res) => {
    const allowed = ['search_knowledge', 'get_public_product', 'compare_products', 'get_customer_order', 'get_payment_status', 'get_shipment_status', 'get_invoice_status', 'get_return_status'];
    const tool = req.params.tool;
    if (!allowed.includes(tool)) return res.status(403).json({ error: 'ابزار در Allowlist نیست.' });
    if (!await rateLimit(`tool:${req.user.id}`, 20)) return res.status(429).json({ error: 'محدودیت فراخوانی ابزار اعمال شد.' });
    const input = z.object({ query: z.string().max(500).optional(), id: z.string().max(100).optional(), ids: z.array(z.string()).max(4).optional() }).safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: 'Schema ورودی ابزار معتبر نیست.' });
    let result;
    if (tool === 'search_knowledge') result = (await searchKnowledge(input.data.query || '', 'public', 5)).map(({ embedding, ...item }) => item);
    else if (tool === 'get_public_product') result = await db.selectFrom('products').select(['id', 'name', 'short_description', 'price', 'sale_price', 'stock', 'status']).where('id', '=', input.data.id || '').where('status', 'in', ['active', 'published']).executeTakeFirst();
    else if (tool === 'compare_products') result = await db.selectFrom('products').select(['id', 'name', 'short_description', 'price', 'sale_price', 'specifications']).where('id', 'in', input.data.ids || []).where('status', 'in', ['active', 'published']).execute();
    else if (tool === 'get_customer_order') result = await db.selectFrom('orders').select(['id', 'order_no', 'status', 'total', 'payment_status', 'tracking_code', 'estimated_delivery_at']).where('id', '=', input.data.id || '').where('user_id', '=', req.user.id).executeTakeFirst();
    else if (tool === 'get_payment_status') result = await db.selectFrom('payments').select(['id', 'order_id', 'amount', 'status', 'paid_at', 'failure_reason']).where('id', '=', input.data.id || '').where('user_id', '=', req.user.id).executeTakeFirst();
    else if (tool === 'get_shipment_status') result = await db.selectFrom('shipments').innerJoin('orders', 'orders.id', 'shipments.order_id').select(['shipments.id', 'shipments.status', 'shipments.carrier', 'shipments.tracking_code', 'shipments.shipped_at', 'shipments.delivered_at']).where('shipments.id', '=', input.data.id || '').where('orders.user_id', '=', req.user.id).executeTakeFirst();
    else if (tool === 'get_invoice_status') result = await db.selectFrom('invoices').innerJoin('orders', 'orders.id', 'invoices.order_id').select(['invoices.id', 'invoices.invoice_no', 'invoices.amount', 'invoices.status', 'invoices.issued_at', 'invoices.paid_at']).where('invoices.id', '=', input.data.id || '').where('orders.user_id', '=', req.user.id).executeTakeFirst();
    else result = await db.selectFrom('returns').innerJoin('orders', 'orders.id', 'returns.order_id').select(['returns.id', 'returns.return_no', 'returns.status', 'returns.reason', 'returns.created_at']).where('returns.id', '=', input.data.id || '').where('orders.user_id', '=', req.user.id).executeTakeFirst();
    if (!result || (Array.isArray(result) && !result.length)) return res.status(404).json({ error: 'رکورد مجاز پیدا نشد.' });
    await audit(req, `support_ai_tool_${tool}`, 'support_ai_tool', input.data.id || null);
    res.json({ tool, result });
  }));

  return router;
}
