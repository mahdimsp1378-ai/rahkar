import { createHash, randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { z } from 'zod';
import { db } from './db.js';
import { generateConsultationAnswer } from './ai-provider.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 3, fields: 12 },
});
const MAX_QUESTIONS = 3;
const SESSION_HOURS = 2;
let tablesReady;

const initialSchema = z.object({
  org: z.string().trim().min(2).max(160),
  phone: z.string().trim().max(24).optional().default(''),
  size: z.string().trim().min(2).max(80),
  topic: z.string().trim().min(3).max(160),
  problem: z.string().trim().min(10).max(5000),
});
const questionSchema = z.object({
  sessionToken: z.string().min(32).max(160),
  question: z.string().trim().min(2).max(2000),
});
const hashToken = token => createHash('sha256').update(token).digest('hex');
const expiresAt = () => new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000).toISOString();

async function ensureTables() {
  tablesReady ||= db.schema.createTable('public_ai_consultations').ifNotExists()
    .addColumn('id', 'text', column => column.primaryKey())
    .addColumn('token_hash', 'text', column => column.notNull().unique())
    .addColumn('organization', 'text', column => column.notNull())
    .addColumn('phone', 'text')
    .addColumn('topic', 'text', column => column.notNull())
    .addColumn('context_json', 'text', column => column.notNull())
    .addColumn('messages_json', 'text', column => column.notNull())
    .addColumn('questions_answered', 'integer', column => column.notNull().defaultTo(0))
    .addColumn('expires_at', 'text', column => column.notNull())
    .addColumn('created_at', 'text', column => column.notNull())
    .addColumn('updated_at', 'text', column => column.notNull())
    .execute();
  return tablesReady;
}

const systemPrompt = `شما مشاور اولیه سازمانی «راهکار» هستید. پاسخ‌ها باید واقعی، مشخص، کاربردی و متناسب با اطلاعات همین سازمان باشند.
اگر داده کافی نیست، صریحاً محدودیت را بگویید و سؤال روشن‌کننده بپرسید؛ هرگز آمار، نتیجه، تجربه اجرایی یا قابلیت محصولی را جعل نکنید.
تشخیص قطعی حقوقی، پزشکی یا مالی ندهید. پاسخ فارسی، خوش‌خوان و حداکثر حدود ۵۰۰ کلمه باشد و شامل مسئله، علت‌های محتمل، اقدام‌های پیشنهادی و اطلاعات لازم برای ادامه بررسی باشد.
کاربر در این گفت‌وگوی عمومی فقط سه پرسش تکمیلی دارد. درباره این محدودیت چانه‌زنی نکنید و کاربر را مجبور به خرید نکنید.`;

const contextText = (data, files) => [
  `نام سازمان: ${data.org}`,
  `اندازه سازمان: ${data.size}`,
  `موضوع: ${data.topic}`,
  `شرح مسئله: ${data.problem}`,
  files.length ? `پیوست‌های اعلام‌شده: ${files.map(file => file.originalname).join('، ')} (محتوای فایل در این مرحله تحلیل نشده است)` : '',
].filter(Boolean).join('\n');

router.post('/consultation/start', upload.array('files', 3), async (req, res) => {
  const parsed = initialSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'اطلاعات مسئله را کامل و دقیق وارد کنید.' });
  await ensureTables();
  const context = contextText(parsed.data, req.files || []);
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `بر اساس اطلاعات زیر یک تحلیل اولیه واقعی ارائه کن. در پایان، کاربر را برای مطرح‌کردن اولین پرسش تکمیلی دعوت کن.\n\n${context}` },
  ];
  try {
    const answer = await generateConsultationAnswer({ messages });
    messages.push({ role: 'assistant', content: answer.text });
    const token = randomBytes(32).toString('base64url');
    const timestamp = new Date().toISOString();
    await db.insertInto('public_ai_consultations').values({
      id: randomUUID(), token_hash: hashToken(token), organization: parsed.data.org,
      phone: parsed.data.phone || null, topic: parsed.data.topic, context_json: JSON.stringify(parsed.data),
      messages_json: JSON.stringify(messages), questions_answered: 0, expires_at: expiresAt(),
      created_at: timestamp, updated_at: timestamp,
    }).execute();
    return res.status(201).json({ sessionToken: token, answer: answer.text, remainingQuestions: MAX_QUESTIONS });
  } catch (error) {
    console.error('public_ai_consultation_start_failed', { code: error?.code, message: error?.message });
    return res.status(503).json({ error: 'در حال حاضر دریافت پاسخ واقعی از هوش مصنوعی ممکن نیست. کمی بعد دوباره تلاش کنید.' });
  }
});

router.post('/consultation/message', async (req, res) => {
  const parsed = questionSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'پرسش معتبر ارسال نشده است.' });
  await ensureTables();
  const row = await db.selectFrom('public_ai_consultations').selectAll().where('token_hash', '=', hashToken(parsed.data.sessionToken)).executeTakeFirst();
  if (!row || Date.parse(row.expires_at) <= Date.now()) return res.status(410).json({ error: 'زمان این گفت‌وگو به پایان رسیده است. لطفاً یک گفت‌وگوی جدید آغاز کنید.' });
  if (Number(row.questions_answered) >= MAX_QUESTIONS) return res.status(403).json({ error: 'سه پرسش رایگان شما پاسخ داده شده است.', limitReached: true, remainingQuestions: 0 });
  const messages = JSON.parse(row.messages_json);
  messages.push({ role: 'user', content: parsed.data.question });
  try {
    const answer = await generateConsultationAnswer({ messages });
    messages.push({ role: 'assistant', content: answer.text });
    const answered = Number(row.questions_answered) + 1;
    await db.updateTable('public_ai_consultations').set({
      messages_json: JSON.stringify(messages), questions_answered: answered, updated_at: new Date().toISOString(),
    }).where('id', '=', row.id).where('questions_answered', '=', Number(row.questions_answered)).execute();
    return res.json({ answer: answer.text, remainingQuestions: Math.max(0, MAX_QUESTIONS - answered), limitReached: answered >= MAX_QUESTIONS });
  } catch (error) {
    console.error('public_ai_consultation_message_failed', { code: error?.code, message: error?.message });
    return res.status(503).json({ error: 'پاسخ واقعی دریافت نشد. پرسش شما از سهمیه کم نشده است؛ دوباره تلاش کنید.' });
  }
});

export default router;
