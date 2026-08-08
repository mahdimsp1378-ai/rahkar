import { createHash, createHmac, randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { basename, dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import compression from 'compression';
import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import sharp from 'sharp';
import writeXlsxFile from 'write-excel-file/node';
import { sql } from 'kysely';
import { z } from 'zod';
import { catalog, rial } from './catalog.js';
import { db, dbKind, migrate } from './db.js';
import { preparePayment, sendAdminWelcome, sendOtp, verifyPayment } from './providers.js';
import { assertSmsReadyForProduction } from './sms-config.js';
import { scanUploadedFile } from './malware-scanner.js';
import { createSupportV5Router, requestSupportRebalance, SUPPORT_PERMISSION_KEYS } from './support-v5.js';
import { SUPPORT_TOPIC_IDS } from '../shared/support-topics.js';
import publicAiConsultationRouter from './public-ai-consultation.js';

const here = dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY_HOPS ? Number(process.env.TRUST_PROXY_HOPS) : false);
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
  crossOriginResourcePolicy: { policy: 'same-site' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
app.use(compression());
const publicRateWindows = new Map();
const RATE_LIMIT_MAX_KEYS = 10_000;
const pruneRateWindows = timestamp => {
  for (const [key, value] of publicRateWindows) {
    if (value.resetAt <= timestamp) publicRateWindows.delete(key);
  }
  while (publicRateWindows.size > RATE_LIMIT_MAX_KEYS) {
    publicRateWindows.delete(publicRateWindows.keys().next().value);
  }
};
app.use('/api', (req, res, next) => {
  const windowMs = Math.max(10_000, Number(process.env.API_RATE_WINDOW_MS || 60_000));
  const max = Math.max(20, Number(process.env.API_RATE_LIMIT || 1000));
  const key = String(req.ip || req.socket?.remoteAddress || 'unknown');
  const current = publicRateWindows.get(key);
  const timestamp = Date.now();
  if (publicRateWindows.size >= RATE_LIMIT_MAX_KEYS) pruneRateWindows(timestamp);
  if (!current || current.resetAt <= timestamp) {
    publicRateWindows.set(key, { count: 1, resetAt: timestamp + windowMs });
    return next();
  }
  current.count += 1;
  res.setHeader('RateLimit-Limit', String(max));
  res.setHeader('RateLimit-Remaining', String(Math.max(0, max - current.count)));
  res.setHeader('RateLimit-Reset', String(Math.ceil((current.resetAt - timestamp) / 1000)));
  if (current.count > max) return res.status(429).json({ error: 'تعداد درخواست‌ها بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید.' });
  next();
});
app.use((req, res, next) => {
  const allowed = String(process.env.APP_ORIGINS || '')
    .split(',').map(value => value.trim()).filter(Boolean);
  const origin = req.headers.origin;
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key, Last-Event-ID');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use('/api/public-ai', publicAiConsultationRouter);
app.use((req, res, next) => {
  req.correlationId = String(req.headers['x-correlation-id'] || randomUUID()).replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 100) || randomUUID();
  res.setHeader('X-Correlation-ID', req.correlationId);
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});
const uploadRoot = resolve(process.env.UPLOAD_DIR || resolve(here, '../.data/uploads'));
const serviceMapRoot = resolve(process.env.ENGINEERING_MAP_DIR || resolve(uploadRoot, '../engineering-service-maps'));
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.MAX_IMAGE_SIZE_BYTES || 8 * 1024 * 1024), files: 12 },
  fileFilter: (_req, file, callback) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
    callback(allowed.includes(file.mimetype) ? null : new Error('فرمت تصویر مجاز نیست.'), allowed.includes(file.mimetype));
  },
});
const serviceMapUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.MAX_MAP_SIZE_BYTES || 15 * 1024 * 1024), files: 1 },
  fileFilter: (_req, file, callback) => {
    const allowed = ['application/vnd.google-earth.kml+xml', 'application/vnd.google-earth.kmz', 'application/xml', 'text/xml'];
    callback(allowed.includes(file.mimetype) ? null : new Error('نوع فایل نقشه مجاز نیست.'), allowed.includes(file.mimetype));
  },
});
const validateKmlXml = buffer => {
  const text = buffer.toString('utf8');
  if (!/^\s*(?:<\?xml[^>]*>\s*)?<kml[\s>]/i.test(text)) return false;
  if (/<!DOCTYPE|<!ENTITY|<NetworkLink|\b(?:href|src)\s*=\s*["'](?:https?|file|ftp):/i.test(text)) return false;
  return true;
};
const validateKmz = buffer => {
  const minimum = 22;
  if (buffer.length < minimum || buffer[0] !== 0x50 || buffer[1] !== 0x4b) return false;
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || eocd + minimum > buffer.length) return false;
  const entries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (entries < 1 || entries > 100 || centralOffset + centralSize > buffer.length) return false;
  let offset = centralOffset;
  let totalCompressed = 0;
  let totalUncompressed = 0;
  let hasKml = false;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) return false;
    const compressed = buffer.readUInt32LE(offset + 20);
    const uncompressed = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (!name || name.includes('\0') || name.includes('..') || /^[\\/]|^[A-Za-z]:/.test(name)) return false;
    if (/\.kml$/i.test(name)) hasKml = true;
    totalCompressed += compressed; totalUncompressed += uncompressed;
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return hasKml && totalUncompressed <= 50 * 1024 * 1024 && totalUncompressed <= Math.max(1, totalCompressed) * 30;
};
const uuid = () => randomUUID();
const now = () => new Date().toISOString();
const later = minutes => new Date(Date.now() + minutes * 60_000).toISOString();
const ean13CheckDigit = value => {
  const digits = String(value).replace(/\D/g, '').padStart(12, '0').slice(-12);
  const sum = [...digits].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return `${digits}${(10 - (sum % 10)) % 10}`;
};
const priceTier = price => {
  const amount = Number(price || 0);
  if (amount < 50_000_000) return 'economy';
  if (amount < 500_000_000) return 'standard';
  if (amount < 5_000_000_000) return 'professional';
  return 'enterprise';
};
const nextSequence = async (trx, scope) => {
  await trx.insertInto('code_sequences').values({ scope, next_value: 0, updated_at: now() })
    .onConflict(conflict => conflict.column('scope').doNothing()).execute();
  const row = await trx.updateTable('code_sequences')
    .set({ next_value: sql`next_value + 1`, updated_at: now() })
    .where('scope', '=', scope).returning('next_value').executeTakeFirst();
  return Number(row?.next_value || 1);
};
const nextProductIdentity = async (trx, categoryId) => {
  const [category, prefixSetting, digitsSetting, barcodePrefixSetting] = await Promise.all([
    categoryId ? trx.selectFrom('product_categories').select(['id', 'name', 'code']).where('id', '=', categoryId).where('status', '=', 'active').executeTakeFirst() : null,
    trx.selectFrom('store_settings').select('value').where('key', '=', 'product_code_prefix').executeTakeFirst(),
    trx.selectFrom('store_settings').select('value').where('key', '=', 'product_sequence_digits').executeTakeFirst(),
    trx.selectFrom('store_settings').select('value').where('key', '=', 'internal_barcode_prefix').executeTakeFirst(),
  ]);
  const sequence = await nextSequence(trx, 'product');
  const prefix = String(prefixSetting?.value || 'ARN').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 8) || 'ARN';
  const digits = Math.min(9, Math.max(4, Number(digitsSetting?.value || 6)));
  const categoryCode = String(category?.code || '9999').padStart(4, '0').slice(-4);
  const productCode = `${prefix}-${categoryCode}-${String(sequence).padStart(digits, '0')}`;
  const barcodePrefix = String(barcodePrefixSetting?.value || '290').replace(/\D/g, '').padStart(3, '0').slice(0, 3);
  const internalBarcode = ean13CheckDigit(`${barcodePrefix}${String(sequence).padStart(9, '0')}`);
  return {
    sequence, productCode, sku: productCode, internalBarcode,
    slug: `product-${productCode.toLowerCase()}`, category,
  };
};
const ean13Svg = (value, caption = '') => {
  const digits = String(value);
  if (!/^\d{13}$/.test(digits)) throw new Error('invalid EAN-13');
  const left = { 0: 'LLLLLL', 1: 'LLGLGG', 2: 'LLGGLG', 3: 'LLGGGL', 4: 'LGLLGG', 5: 'LGGLLG', 6: 'LGGGLL', 7: 'LGLGLG', 8: 'LGLGGL', 9: 'LGGLGL' };
  const L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
  const G = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
  const R = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100'];
  let bits = '101';
  const parity = left[digits[0]];
  for (let index = 1; index <= 6; index += 1) bits += (parity[index - 1] === 'L' ? L : G)[Number(digits[index])];
  bits += '01010';
  for (let index = 7; index <= 12; index += 1) bits += R[Number(digits[index])];
  bits += '101';
  const bars = [...bits].map((bit, index) => bit === '1' ? `<rect x="${18 + index * 2}" y="12" width="2" height="${index < 3 || (index >= 45 && index < 50) || index >= 92 ? 76 : 68}" />` : '').join('');
  const safeCaption = String(caption).replace(/[<>&"']/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="226" height="126" viewBox="0 0 226 126"><rect width="226" height="126" fill="white"/><g fill="black">${bars}</g><text x="113" y="103" font-family="Arial,sans-serif" font-size="15" text-anchor="middle" letter-spacing="3">${digits}</text><text x="113" y="120" font-family="Arial,sans-serif" font-size="10" text-anchor="middle">${safeCaption}</text></svg>`;
};
const engineeringServiceLabels = {
  potential_assessment: 'پتانسیل‌سنجی احداث نیروگاه',
  site_plan: 'سایت‌پلن نیروگاه',
  feasibility_study: 'طرح توجیهی نیروگاه',
};
const engineeringServicePrice = (service, capacityKw) => {
  if (service === 'potential_assessment') return 50_000_000;
  if (service === 'site_plan') {
    if (capacityKw <= 500) return 200_000_000;
    if (capacityKw <= 1_000) return 300_000_000;
    if (capacityKw <= 10_000) return 400_000_000;
    return 500_000_000;
  }
  if (service === 'feasibility_study') {
    if (capacityKw <= 1_000) return 200_000_000;
    if (capacityKw <= 10_000) return 500_000_000;
    return 1_000_000_000;
  }
  throw Object.assign(new Error('خدمت انتخاب‌شده معتبر نیست.'), { status: 400 });
};
const engineeringPriceSnapshot = (services, capacityKw) => services.map(service => ({
  service,
  label: engineeringServiceLabels[service],
  price: engineeringServicePrice(service, capacityKw),
}));
const hash = value => createHash('sha256').update(value).digest('hex');
const cookieNames = portal => ({
  session: `${isProduction() ? '__Host-' : ''}aronage_session_${portal}`,
  csrf: `aronage_csrf_${portal}`,
});
const parseCookies = header => Object.fromEntries(String(header || '').split(';').map(item => {
  const index = item.indexOf('=');
  if (index < 1) return null;
  try { return [item.slice(0, index).trim(), decodeURIComponent(item.slice(index + 1).trim())]; }
  catch { return null; }
}).filter(Boolean));
const appendCookie = (res, value) => {
  const current = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', current ? [...(Array.isArray(current) ? current : [current]), value] : value);
};
const setSessionCookies = (res, portal, token, csrfToken, maxAgeSeconds) => {
  const names = cookieNames(portal);
  const secure = isProduction() ? '; Secure' : '';
  appendCookie(res, `${names.session}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=${maxAgeSeconds}`);
  appendCookie(res, `${names.csrf}=${encodeURIComponent(csrfToken)}; Path=/; SameSite=Strict${secure}; Max-Age=${maxAgeSeconds}`);
};
const clearSessionCookies = (res, portal) => {
  const names = cookieNames(portal || 'customer');
  const secure = isProduction() ? '; Secure' : '';
  appendCookie(res, `${names.session}=; Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=0`);
  appendCookie(res, `${names.csrf}=; Path=/; SameSite=Strict${secure}; Max-Age=0`);
};
const passwordHash = value => {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(String(value), salt, 64).toString('hex')}`;
};
const passwordMatches = (value, stored) => {
  try {
    const [salt, digest] = String(stored).split(':');
    const actual = scryptSync(String(value), salt, 64);
    const expected = Buffer.from(digest, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch { return false; }
};
const passwordIsStrong = value =>
  typeof value === 'string' &&
  value.length >= 10 &&
  /[a-z]/.test(value) &&
  /[A-Z]/.test(value) &&
  /\d/.test(value) &&
  /[^A-Za-z0-9]/.test(value);
const isProduction = () => process.env.NODE_ENV === 'production';
const isVercel = () => process.env.VERCEL === '1';
const isFixedDemo = () => !isProduction() && (process.env.SMS_PROVIDER || 'fixed') === 'fixed';
const portalMfaRequired = () => process.env.PORTAL_MFA_REQUIRED === 'true' ||
  (isProduction() && process.env.PORTAL_MFA_REQUIRED !== 'false');
const demoSecret = () => process.env.SESSION_SECRET?.trim() || process.env.DEMO_SESSION_SECRET?.trim() || '';
const isVercelDemo = () =>
  Boolean(process.env.VERCEL) &&
  isFixedDemo() &&
  !process.env.DATABASE_URL &&
  demoSecret().length >= 32;
const demoToken = user => {
  const payload = Buffer.from(JSON.stringify({
    id: user.id, mobile: user.mobile, role: user.role,
    exp: Date.now() + 30 * 24 * 60 * 60_000,
  })).toString('base64url');
  const signature = createHmac('sha256', demoSecret()).update(payload).digest('base64url');
  return `demo.${payload}.${signature}`;
};
const readDemoToken = token => {
  if (!isVercelDemo() || !token?.startsWith('demo.')) return null;
  try {
    const [, payload, signature] = token.split('.');
    const expected = createHmac('sha256', demoSecret()).update(payload).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const user = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return user.exp > Date.now() ? user : null;
  } catch {
    return null;
  }
};
const faToEn = value => String(value || '').replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
const normalizeMobile = value => {
  let mobile = faToEn(value).replace(/\D/g, '');
  if (mobile.startsWith('98')) mobile = `0${mobile.slice(2)}`;
  return mobile;
};
const provinceCodes = new Map([
  ['آذربایجان شرقی','01'],['آذربایجان غربی','02'],['اردبیل','03'],['اصفهان','04'],
  ['البرز','05'],['ایلام','06'],['بوشهر','07'],['تهران','08'],['چهارمحال و بختیاری','09'],
  ['خراسان جنوبی','10'],['خراسان رضوی','11'],['خراسان شمالی','12'],['خوزستان','13'],
  ['زنجان','14'],['سمنان','15'],['سیستان و بلوچستان','16'],['فارس','17'],['قزوین','18'],
  ['قم','19'],['کردستان','20'],['کرمان','21'],['کرمانشاه','22'],['کهگیلویه و بویراحمد','23'],
  ['گلستان','24'],['گیلان','25'],['لرستان','26'],['مازندران','27'],['مرکزی','28'],
  ['هرمزگان','29'],['همدان','30'],['یزد','31'],
]);
const locationCode = value => String(value || '').trim().replace(/\s+/g, '-').toLowerCase();
const orderNo = prefix => `${prefix}-${new Date().toISOString().slice(2, 10).replaceAll('-', '')}-${String(Date.now()).slice(-6)}`;
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const dashboardCache = new Map();
const audit = async (req, action, entityType, entityId, metadata = null) => {
  await db.insertInto('audit_events').values({
    id: uuid(), user_id: req.user?.id || null, action,
    entity_type: entityType || null, entity_id: entityId || null,
    ip: req.ip || null, user_agent: String(req.headers?.['user-agent'] || '').slice(0, 300) || null,
    metadata: metadata ? JSON.stringify(metadata) : null,
    correlation_id: req.correlationId || null, result: 'success', created_at: now(),
  }).execute();
  if (/(order|payment|product|inventory|refund|discount|return)/.test(action)) dashboardCache.clear();
};
const jsonError = (res, status, message, fields) => res.status(status).json({ error: message, fields });
const createSession = async (user, req = null, portal = 'customer', mfaVerified = false) => {
  const token = randomBytes(32).toString('hex');
  const csrfToken = randomBytes(24).toString('base64url');
  const configured = portal === 'customer'
    ? Number(process.env.CUSTOMER_SESSION_TTL_MINUTES || 720)
    : Number(process.env.PORTAL_SESSION_TTL_MINUTES || 480);
  await db.insertInto('sessions').values({
    id: uuid(), user_id: user.id, token_hash: hash(token),
    expires_at: later(Math.max(15, configured)),
    portal, ip: req?.ip || null,
    user_agent: String(req?.headers?.['user-agent'] || '').slice(0, 300) || null,
    last_seen_at: now(), csrf_hash: hash(csrfToken), role_snapshot: user.role,
    token_version: Number(user.token_version || 0), revoked_at: null, created_at: now(),
    mfa_verified_at: mfaVerified ? now() : null,
  }).execute();
  return { token, csrfToken, maxAgeSeconds: Math.max(15, configured) * 60 };
};
const bearerCompatibility = session => !isProduction() && process.env.API_BEARER_COMPAT === 'true'
  ? { token: session.token } : {};
const recordAttempt = async (scope, identifier, req, success) => {
  const normalizedIdentifier = String(identifier || '').toLowerCase();
  const ip = req.ip || null;
  if (success) {
    await db.deleteFrom('auth_attempts')
      .where('scope', '=', scope)
      .where('identifier', '=', normalizedIdentifier)
      .where('ip', '=', ip)
      .where('success', '=', 0)
      .execute();
  }
  await db.insertInto('auth_attempts').values({
    id: uuid(), scope, identifier: normalizedIdentifier,
    ip, success: success ? 1 : 0, created_at: now(),
  }).execute();
};
const enforceAttemptLimit = async (scope, identifier, req, max = 5, minutes = 15) => {
  const cutoff = new Date(Date.now() - minutes * 60_000).toISOString();
  await db.deleteFrom('auth_attempts')
    .where('scope', '=', scope)
    .where('created_at', '<', cutoff)
    .execute();
  const normalizedIdentifier = String(identifier || '').toLowerCase();
  const ip = req.ip || null;
  const [accountRow, ipRow] = await Promise.all([
    db.selectFrom('auth_attempts').select(({ fn }) => fn.countAll().as('count'))
      .where('scope', '=', scope).where('identifier', '=', normalizedIdentifier)
      .where('success', '=', 0).where('created_at', '>=', cutoff).executeTakeFirst(),
    db.selectFrom('auth_attempts').select(({ fn }) => fn.countAll().as('count'))
      .where('scope', '=', scope).where('ip', '=', ip)
      .where('success', '=', 0).where('created_at', '>=', cutoff).executeTakeFirst(),
  ]);
  // An attacker cannot reset the account limit by rotating IPs. The wider IP
  // ceiling still permits several legitimate users behind one office NAT.
  return Number(accountRow?.count || 0) < max && Number(ipRow?.count || 0) < max * 5;
};
const parseJson = (value, fallback) => {
  try { return JSON.parse(value || ''); } catch { return fallback; }
};
const publicProduct = row => {
  const {
    purchase_price, inbound_shipping_cost, packaging_cost, additional_cost, unit_cost,
    reserved_stock, stock, deleted_at, archive_reason, created_by, updated_by,
    ...safe
  } = row;
  return {
    ...safe,
    available_stock: Math.max(0, Number(stock || 0) - Number(reserved_stock || 0)),
  };
};
const present = value => typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined;
const profileCompletion = (profile, username) => {
  const legal = profile?.account_type === 'legal';
  const checks = legal ? [
    ['full_name', 8, 'نام نماینده'], ['display_name', 4, 'نام نمایشی'],
    ['email', 6, 'ایمیل'], ['company', 14, 'نام شرکت'],
    ['company_national_id', 14, 'شناسه ملی شرکت'], ['registration_no', 8, 'شماره ثبت'],
    ['economic_code', 8, 'کد اقتصادی'], ['representative_position', 6, 'سمت نماینده'],
    ['company_phone', 5, 'تلفن شرکت'], ['company_address', 10, 'نشانی شرکت'],
    ['invoice_details', 5, 'اطلاعات فاکتور رسمی'], ['username', 12, 'نام کاربری'],
  ] : [
    ['first_name', 9, 'نام'], ['last_name', 9, 'نام خانوادگی'],
    ['display_name', 5, 'نام نمایشی'], ['national_id', 12, 'کد ملی'],
    ['birth_date', 8, 'تاریخ تولد'], ['email', 8, 'ایمیل'],
    ['alternate_phone', 5, 'شماره جایگزین'], ['avatar_url', 5, 'تصویر پروفایل'],
    ['username', 14, 'نام کاربری'], ['mobile_verified_at', 15, 'تأیید شماره موبایل'],
  ];
  const values = { ...profile, username };
  const completed = checks.filter(([key]) => {
    const value = values[key];
    if (key === 'national_id') return /^\d{10}$/.test(String(value || ''));
    if (key === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
    return present(value);
  });
  const percent = completed.reduce((sum, [, weight]) => sum + weight, 0);
  const missing = checks.filter(item => !completed.includes(item)).map(([, , label]) => label);
  return {
    percent: Math.min(100, percent),
    status: percent >= 85 ? 'complete' : percent >= 50 ? 'incomplete' : 'critical',
    missing,
  };
};
const orderTransitions = {
  awaiting_payment: ['cancelled'],
  paid: ['reviewing', 'processing', 'cancelled', 'refund_requested'],
  reviewing: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready_to_ship', 'cancelled'],
  ready_to_ship: ['shipped', 'cancelled'],
  shipped: ['delivered', 'return_requested'],
  delivered: ['return_requested', 'returned'],
  return_requested: ['returned', 'delivered'],
  returned: ['refunded'],
  refund_requested: ['refunded', 'paid'],
  refunded: [],
  cancelled: [],
  // Backward-compatible statuses from earlier releases.
  processing: ['ready_to_ship', 'shipped', 'cancelled'],
};
const releaseOrderReservations = async (trx, orderId, reason, actorId = null) => {
  const reservations = await trx.selectFrom('inventory_reservations').selectAll()
    .where('order_id', '=', orderId).where('status', '=', 'active').execute();
  for (const reservation of reservations) {
    if (reservation.variant_id) {
      await trx.updateTable('product_variants')
        .set({ reserved_stock: sql`CASE WHEN reserved_stock >= ${reservation.quantity} THEN reserved_stock - ${reservation.quantity} ELSE 0 END`, updated_at: now() })
        .where('id', '=', reservation.variant_id).execute();
    } else {
      await trx.updateTable('products')
        .set({ reserved_stock: sql`CASE WHEN reserved_stock >= ${reservation.quantity} THEN reserved_stock - ${reservation.quantity} ELSE 0 END`, updated_at: now() })
        .where('id', '=', reservation.product_id).execute();
    }
    await trx.updateTable('inventory_reservations').set({
      status: reason, released_at: now(),
    }).where('id', '=', reservation.id).execute();
  }
  if (reason === 'cancelled' || reason === 'expired') {
    const usage = await trx.selectFrom('discount_usages').selectAll()
      .where('order_id', '=', orderId).where('status', '=', 'used').executeTakeFirst();
    if (usage) {
      await trx.updateTable('discount_usages').set({ status: 'restored' }).where('id', '=', usage.id).execute();
      await trx.updateTable('discount_codes')
        .set({ used_count: sql`CASE WHEN used_count > 0 THEN used_count - 1 ELSE 0 END` })
        .where('id', '=', usage.discount_id).execute();
      await trx.updateTable('discount_customer_counters')
        .set({ used_count: sql`CASE WHEN used_count > 0 THEN used_count - 1 ELSE 0 END`, updated_at: now() })
        .where('discount_id', '=', usage.discount_id).where('user_id', '=', usage.user_id).execute();
    }
  }
  return reservations.length;
};
const expireReservations = async () => {
  const expiredOrders = await db.selectFrom('inventory_reservations').select('order_id')
    .where('status', '=', 'active').where('expires_at', '<', now()).distinct().execute();
  for (const row of expiredOrders) {
    await db.transaction().execute(async trx => {
      await releaseOrderReservations(trx, row.order_id, 'expired');
      const order = await trx.selectFrom('orders').selectAll().where('id', '=', row.order_id).executeTakeFirst();
      if (order?.status === 'awaiting_payment') {
        await trx.updateTable('orders').set({ status: 'cancelled', updated_at: now() }).where('id', '=', row.order_id).execute();
        await trx.insertInto('order_status_history').values({
          id: uuid(), order_id: row.order_id, from_status: 'awaiting_payment', to_status: 'cancelled',
          note: 'انقضای مهلت پرداخت و آزادسازی رزرو', changed_by: null, created_at: now(),
        }).execute();
      }
    });
  }
  return expiredOrders.length;
};
const changeOrderStatus = async (req, order, nextStatus, note = null) => {
  if (order.status === nextStatus) return;
  const allowed = orderTransitions[order.status] || [];
  if (!allowed.includes(nextStatus)) {
    const error = new Error(`انتقال وضعیت از «${order.status}» به «${nextStatus}» مجاز نیست.`);
    error.status = 409;
    throw error;
  }
  const changedAt = now();
  await db.transaction().execute(async trx => {
    await trx.updateTable('orders').set({
      status: nextStatus,
      updated_at: changedAt,
    }).where('id', '=', order.id).execute();
    if (nextStatus === 'cancelled') {
      const converted = await trx.selectFrom('inventory_reservations').selectAll()
        .where('order_id', '=', order.id).where('status', '=', 'converted').execute();
      for (const reservation of converted) {
        if (reservation.variant_id) {
          await trx.updateTable('product_variants').set({
            stock: sql`stock + ${reservation.quantity}`, updated_at: changedAt,
          }).where('id', '=', reservation.variant_id).execute();
        } else {
          await trx.updateTable('products').set({
            stock: sql`stock + ${reservation.quantity}`, updated_at: changedAt,
          }).where('id', '=', reservation.product_id).execute();
        }
        await trx.updateTable('inventory_reservations').set({
          status: 'cancelled_restored', released_at: changedAt,
        }).where('id', '=', reservation.id).execute();
        await trx.insertInto('inventory_movements').values({
          id: uuid(), product_id: reservation.product_id, variant_id: reservation.variant_id, order_id: order.id,
          quantity: reservation.quantity, reason: 'paid_order_cancelled',
          created_by: req.user.id, created_at: changedAt,
        }).execute();
      }
      await releaseOrderReservations(trx, order.id, 'cancelled', req.user.id);
    }
    await trx.insertInto('order_status_history').values({
      id: uuid(), order_id: order.id, from_status: order.status, to_status: nextStatus,
      note: note || null, changed_by: req.user.id, created_at: changedAt,
    }).execute();
    await trx.insertInto('notifications').values({
      id: uuid(), user_id: order.user_id, title: 'وضعیت سفارش تغییر کرد',
      body: `سفارش ${order.order_no}: ${nextStatus}`, read_at: null, created_at: changedAt,
    }).execute();
  });
  await audit(req, 'order_status_updated', 'order', order.id, { from: order.status, to: nextStatus });
};

const finalizeSuccessfulPayment = async ({ paymentId, transactionId, actorId = null }) => {
  return db.transaction().execute(async trx => {
    const payment = await trx.selectFrom('payments').selectAll().where('id', '=', paymentId).executeTakeFirst();
    if (!payment) throw Object.assign(new Error('رکورد پرداخت پیدا نشد.'), { status: 404 });
    const order = await trx.selectFrom('orders').selectAll().where('id', '=', payment.order_id).executeTakeFirst();
    if (!order) throw Object.assign(new Error('سفارش پرداخت پیدا نشد.'), { status: 404 });
    if (Number(payment.amount) !== Number(order.total)) {
      throw Object.assign(new Error('مبلغ تراکنش با مبلغ سفارش مغایرت دارد.'), { status: 409 });
    }
    if (payment.status === 'paid' || order.payment_status === 'paid') {
      if (payment.transaction_id && payment.transaction_id !== transactionId) {
        throw Object.assign(new Error('این پرداخت قبلاً با شناسه تراکنش دیگری قطعی شده است.'), { status: 409 });
      }
      return { order, payment, alreadyProcessed: true };
    }
    const claimed = await trx.updateTable('payments').set({
      status: 'processing', transaction_id: transactionId, updated_at: now(),
    }).where('id', '=', payment.id)
      .where('status', 'in', ['prepared', 'redirect_ready', 'gateway_disabled', 'unknown', 'failed'])
      .executeTakeFirst();
    if (Number(claimed.numUpdatedRows || 0) !== 1) {
      throw Object.assign(new Error('این پرداخت هم‌زمان در حال پردازش است.'), { status: 409 });
    }
    const reservations = await trx.selectFrom('inventory_reservations').selectAll()
      .where('order_id', '=', order.id).where('status', '=', 'active').execute();
    if (!reservations.length || reservations.some(row => row.expires_at < now())) {
      throw Object.assign(new Error('رزرو موجودی این سفارش منقضی شده است.'), { status: 409 });
    }
    for (const reservation of reservations) {
      if (reservation.variant_id) {
        const changed = await trx.updateTable('product_variants').set({
          stock: sql`stock - ${reservation.quantity}`,
          reserved_stock: sql`reserved_stock - ${reservation.quantity}`,
          updated_at: now(),
        }).where('id', '=', reservation.variant_id)
          .where('stock', '>=', reservation.quantity)
          .where('reserved_stock', '>=', reservation.quantity).executeTakeFirst();
        if (Number(changed.numUpdatedRows || 0) !== 1) throw Object.assign(new Error('موجودی تنوع محصول تغییر کرده است.'), { status: 409 });
      } else {
        const changed = await trx.updateTable('products').set({
          stock: sql`stock - ${reservation.quantity}`,
          reserved_stock: sql`reserved_stock - ${reservation.quantity}`,
          updated_at: now(),
        }).where('id', '=', reservation.product_id)
          .where('stock', '>=', reservation.quantity)
          .where('reserved_stock', '>=', reservation.quantity).executeTakeFirst();
        if (Number(changed.numUpdatedRows || 0) !== 1) throw Object.assign(new Error('موجودی محصول تغییر کرده است.'), { status: 409 });
      }
      await trx.updateTable('inventory_reservations').set({ status: 'converted', released_at: now() })
        .where('id', '=', reservation.id).execute();
      await trx.insertInto('inventory_movements').values({
        id: uuid(), product_id: reservation.product_id, variant_id: reservation.variant_id, order_id: order.id,
        quantity: -reservation.quantity, reason: 'payment_confirmed',
        created_by: actorId, created_at: now(),
      }).execute();
    }
    const paidAt = now();
    await trx.updateTable('payments').set({
      status: 'paid', transaction_id: transactionId, paid_at: paidAt, failure_reason: null,
      reconciliation_status: 'verified', updated_at: paidAt,
    }).where('id', '=', payment.id).where('status', '=', 'processing').execute();
    await trx.updateTable('orders').set({
      status: 'paid', payment_status: 'paid', updated_at: paidAt,
    }).where('id', '=', order.id).execute();
    const invoice = await trx.selectFrom('invoices').select('id').where('order_id', '=', order.id).executeTakeFirst();
    if (!invoice) {
      await trx.insertInto('invoices').values({
        id: uuid(), invoice_no: orderNo('INV'), order_id: order.id,
        amount: order.total, status: 'paid', issued_at: paidAt, paid_at: paidAt,
      }).execute();
    }
    await trx.insertInto('order_status_history').values({
      id: uuid(), order_id: order.id, from_status: order.status, to_status: 'paid',
      note: 'تأیید معتبر تراکنش پرداخت', changed_by: actorId, created_at: paidAt,
    }).execute();
    await trx.insertInto('notifications').values({
      id: uuid(), user_id: order.user_id, title: 'پرداخت تأیید شد',
      body: `پرداخت سفارش ${order.order_no} با موفقیت تأیید و فاکتور صادر شد.`,
      read_at: null, created_at: paidAt,
    }).execute();
    return { order: { ...order, status: 'paid', payment_status: 'paid' }, payment: { ...payment, status: 'paid' }, alreadyProcessed: false };
  });
};

const auth = asyncRoute(async (req, res, next) => {
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const cookies = parseCookies(req.headers.cookie);
  const validPortals = ['customer', 'admin', 'support', 'sales'];
  const requestedPortal = String(req.headers['x-aronage-portal'] || '').toLowerCase();
  const cookiePortals = validPortals.filter(portal => cookies[cookieNames(portal).session]);
  const cookiePortal = validPortals.includes(requestedPortal) && cookiePortals.includes(requestedPortal)
    ? requestedPortal
    : cookiePortals.length === 1 ? cookiePortals[0] : null;
  const token = bearer || (cookiePortal ? cookies[cookieNames(cookiePortal).session] : null);
  if (!token) {
    if (!bearer && cookiePortals.length > 1) {
      return jsonError(res, 401, 'نشست پنل مشخص نیست. صفحه را تازه‌سازی و دوباره وارد شوید.');
    }
    return jsonError(res, 401, 'برای ادامه وارد حساب کاربری شوید.');
  }
  const demoUser = readDemoToken(token);
  if (demoUser) {
    let storedUser = await db.selectFrom('users').selectAll().where('id', '=', demoUser.id).executeTakeFirst();
    if (!storedUser) {
      storedUser = { id: demoUser.id, mobile: demoUser.mobile, role: demoUser.role, status: 'active', created_at: now() };
      await db.insertInto('users').values(storedUser).onConflict(oc => oc.column('id').doNothing()).execute();
      await db.insertInto('profiles').values({ user_id: storedUser.id, full_name: null, email: null, national_id: null, company: null, job_title: null, updated_at: now() }).onConflict(oc => oc.column('user_id').doNothing()).execute();
      storedUser = await db.selectFrom('users').selectAll().where('id', '=', demoUser.id).executeTakeFirst();
    }
    req.user = { ...storedUser, session_id: null, expires_at: new Date(demoUser.exp).toISOString() };
    return next();
  }
  const session = await db.selectFrom('sessions')
    .innerJoin('users', 'users.id', 'sessions.user_id')
    .select([
      'sessions.id as session_id', 'sessions.expires_at', 'sessions.portal', 'sessions.last_seen_at', 'sessions.user_agent',
      'sessions.csrf_hash', 'sessions.role_snapshot', 'sessions.token_version as session_token_version', 'sessions.revoked_at',
      'sessions.mfa_verified_at',
      'users.id', 'users.mobile', 'users.role', 'users.status', 'users.created_at', 'users.token_version',
    ])
    .where('sessions.token_hash', '=', hash(token))
    .executeTakeFirst();
  const idleMinutes = session?.portal === 'customer'
    ? Number(process.env.CUSTOMER_IDLE_TIMEOUT_MINUTES || 30)
    : Number(process.env.PORTAL_IDLE_TIMEOUT_MINUTES || 15);
  const idleExpired = session?.last_seen_at &&
    Date.now() - Date.parse(session.last_seen_at) > Math.max(5, idleMinutes) * 60_000;
  const currentUserAgent = String(req.headers?.['user-agent'] || '').slice(0, 300) || null;
  const deviceMismatch = session?.portal !== 'customer' && session?.user_agent &&
    currentUserAgent !== session.user_agent;
  const expectedRole = { customer: 'customer', admin: 'super_admin', support: 'support_agent', sales: 'sales_manager' }[session?.portal];
  const stalePrivilege = !expectedRole || session.role !== expectedRole || session.role_snapshot !== session.role ||
    Number(session.session_token_version || 0) !== Number(session.token_version || 0);
  if (!session || session.expires_at < now() || idleExpired || deviceMismatch || session.revoked_at || stalePrivilege || session.status !== 'active') {
    if (session?.session_id) await db.deleteFrom('sessions').where('id', '=', session.session_id).execute();
    if (session?.portal) clearSessionCookies(res, session.portal);
    return jsonError(res, 401, 'نشست شما منقضی شده است. دوباره وارد شوید.');
  }
  if (!bearer && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const csrf = String(req.headers['x-csrf-token'] || '');
    if (!csrf || !session.csrf_hash || hash(csrf) !== session.csrf_hash) {
      return jsonError(res, 403, 'اعتبار امنیتی درخواست نامعتبر است. صفحه را تازه‌سازی کنید.');
    }
  }
  req.user = session;
  await db.updateTable('sessions').set({ last_seen_at: now() }).where('id', '=', session.session_id).execute();
  await db.updateTable('users').set({ last_activity_at: now() }).where('id', '=', session.id).execute();
  if (session.portal !== 'customer' &&
      !['/api/me', '/api/auth/logout', '/api/portal-auth/credentials'].includes(req.path)) {
    const credential = await db.selectFrom('portal_credentials').select(['must_change', 'temporary_expires_at'])
      .where('user_id', '=', session.id).executeTakeFirst();
    if (credential?.temporary_expires_at && credential.temporary_expires_at < now()) {
      await db.deleteFrom('sessions').where('id', '=', session.session_id).execute();
      clearSessionCookies(res, session.portal);
      return jsonError(res, 401, 'رمز موقت منقضی شده است؛ از مدیر اصلی درخواست بازنشانی کنید.');
    }
    if (credential?.must_change) return jsonError(res, 403, 'پیش از ادامه باید نام کاربری و رمز موقت را تغییر دهید.');
  }
  next();
});

const adminOnly = (req, res, next) =>
  ['admin', 'super_admin'].includes(req.user?.role) ? next() : jsonError(res, 403, 'دسترسی مدیر اصلی لازم است.');

const readPermissions = value => {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
};
const SALES_PERMISSION_KEYS = [
  'products.view', 'products.create', 'products.update', 'products.archive', 'products.restore',
  'inventory.view', 'inventory.manage', 'orders.view', 'orders.manage', 'customers.view',
  'services.view', 'services.manage',
  'support-tickets.view', 'support-tickets.manage',
  'discounts.manage', 'payments.view', 'refunds.manage', 'reports.view', 'reports.export',
  'settings.manage',
];
const defaultSalesPermissions = Object.fromEntries(SALES_PERMISSION_KEYS.map(key => [key, key !== 'refunds.manage' && key !== 'settings.manage']));
const normalizeSalesPermissions = value => {
  const raw = typeof value === 'string' ? readPermissions(value) : (value || {});
  const explicitGranular = Object.keys(raw).some(key => key.includes('.'));
  if (explicitGranular) {
    return Object.fromEntries(SALES_PERMISSION_KEYS.map(key => {
      if (raw[key] !== undefined) return [key, Boolean(raw[key])];
      if (key === 'support-tickets.view') return [key, Boolean(raw['orders.view'])];
      if (key === 'support-tickets.manage') return [key, Boolean(raw['orders.manage'])];
      return [key, false];
    }));
  }
  const migrated = {
    'products.view': raw['products.view'] ?? raw.view,
    'products.create': raw['products.create'] ?? raw.create,
    'products.update': raw['products.update'] ?? raw.edit,
    'products.archive': raw['products.archive'] ?? raw.archive,
    'products.restore': raw['products.restore'] ?? raw.archive,
    'inventory.view': raw['inventory.view'] ?? raw.inventory ?? raw.view,
    'inventory.manage': raw['inventory.manage'] ?? raw.inventory,
    'orders.view': raw['orders.view'] ?? raw.view,
    'orders.manage': raw['orders.manage'] ?? raw.change_status,
    'customers.view': raw['customers.view'] ?? raw.view,
    'services.view': raw['services.view'] ?? raw['orders.view'] ?? raw.view,
    'services.manage': raw['services.manage'] ?? raw['orders.manage'] ?? raw.change_status,
    'support-tickets.view': raw['support-tickets.view'] ?? raw['orders.view'] ?? raw.view,
    'support-tickets.manage': raw['support-tickets.manage'] ?? raw['orders.manage'] ?? raw.change_status,
    'discounts.manage': raw['discounts.manage'] ?? raw.create ?? raw.edit,
    'payments.view': raw['payments.view'] ?? raw.view,
    'refunds.manage': raw['refunds.manage'] ?? raw.refunds,
    'reports.view': raw['reports.view'] ?? raw.view,
    'reports.export': raw['reports.export'] ?? raw.export,
    'settings.manage': raw['settings.manage'] ?? raw.sensitive,
  };
  return Object.fromEntries(SALES_PERMISSION_KEYS.map(key => [key, Boolean(migrated[key] ?? defaultSalesPermissions[key])]));
};
const supportOnly = asyncRoute(async (req, res, next) => {
  if (['admin', 'super_admin'].includes(req.user?.role)) {
    req.supportPermissions = { view: true, reply: true, assign: true, close: true, reports: true };
    return next();
  }
  if (req.user?.role !== 'support_agent') return jsonError(res, 403, 'دسترسی سامانه پشتیبانی لازم است.');
  const member = await db.selectFrom('admin_members').selectAll()
    .where('user_id', '=', req.user.id).where('section', '=', 'support').executeTakeFirst();
  if (!member || req.user.status !== 'active') return jsonError(res, 403, 'دسترسی پشتیبانی شما غیرفعال است.');
  req.supportPermissions = readPermissions(member.permissions);
  if (!req.supportPermissions.view) return jsonError(res, 403, 'مجوز مشاهده گفتگوها برای شما فعال نیست.');
  next();
});
const salesOnly = asyncRoute(async (req, res, next) => {
  if (req.user?.role === 'super_admin') {
    req.salesPermissions = Object.fromEntries(SALES_PERMISSION_KEYS.map(key => [key, true]));
    return next();
  }
  if (req.user?.role !== 'sales_manager' || req.user.status !== 'active') return jsonError(res, 403, 'دسترسی سامانه فروش لازم است.');
  const member = await db.selectFrom('admin_members').selectAll()
    .where('user_id', '=', req.user.id).where('section', '=', 'sales').executeTakeFirst();
  if (!member) return jsonError(res, 403, 'دسترسی فروش شما غیرفعال است.');
  req.salesPermissions = normalizeSalesPermissions(member.permissions);
  if (!req.salesPermissions['products.view'] && !req.salesPermissions['orders.view'] &&
      !req.salesPermissions['reports.view'] && !req.salesPermissions['services.view'] &&
      !req.salesPermissions['support-tickets.view']) {
    return jsonError(res, 403, 'هیچ مجوز فعالی برای سامانه فروش ندارید.');
  }
  next();
});
const requireSupportPermission = permission => (req, res, next) =>
  req.supportPermissions?.[permission] ? next() : jsonError(res, 403, 'این عملیات در سطح دسترسی شما فعال نیست.');
const requireSalesPermission = permission => (req, res, next) =>
  req.salesPermissions?.[permission] ? next() : jsonError(res, 403, 'این عملیات در سطح دسترسی فروش شما فعال نیست.');
const requireStepUp = (req, res, next) => {
  if (!isProduction()) return next();
  const verifiedAt = Date.parse(req.user?.mfa_verified_at || '');
  if (!Number.isFinite(verifiedAt) || Date.now() - verifiedAt > 15 * 60_000) return jsonError(res, 403, 'برای این عملیات تأیید دومرحله‌ای تازه لازم است.');
  next();
};

const mobileSchema = z.object({
  mobile: z.string().min(10),
  intent: z.enum(['login', 'register', 'reset']),
});
app.use('/api', createSupportV5Router({ db, auth, audit, uploadRoot }));
app.get('/api/health', asyncRoute(async (req, res) => {
  if (isProduction()) {
    const expected = String(process.env.HEALTHCHECK_TOKEN || '');
    const received = String(req.headers['x-health-token'] || '');
    if (expected.length < 24 || received.length !== expected.length ||
        !timingSafeEqual(Buffer.from(received), Buffer.from(expected))) {
      return res.status(404).end();
    }
  }
  await db.selectFrom('schema_migrations').select('id').limit(1).execute();
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true });
}));
app.get('/api/engineering-services/pricing', (_req, res) => {
  res.json({
    currency: 'IRR',
    capacityUnit: 'kW',
    services: [
      {
        id: 'potential_assessment',
        label: engineeringServiceLabels.potential_assessment,
        tiers: [{ maxKw: null, price: 50_000_000 }],
      },
      {
        id: 'site_plan',
        label: engineeringServiceLabels.site_plan,
        tiers: [
          { maxKw: 500, price: 200_000_000 },
          { minExclusiveKw: 500, maxKw: 1_000, price: 300_000_000 },
          { minExclusiveKw: 1_000, maxKw: 10_000, price: 400_000_000 },
          { minExclusiveKw: 10_000, maxKw: null, price: 500_000_000 },
        ],
      },
      {
        id: 'feasibility_study',
        label: engineeringServiceLabels.feasibility_study,
        tiers: [
          { maxKw: 1_000, price: 200_000_000 },
          { minExclusiveKw: 1_000, maxKw: 10_000, price: 500_000_000 },
          { minExclusiveKw: 10_000, maxKw: null, price: 1_000_000_000 },
        ],
      },
    ],
  });
});
app.get('/api/engineering-service-requests/mine', auth, asyncRoute(async (req, res) => {
  const rows = await db.selectFrom('engineering_service_requests').selectAll()
    .where('user_id', '=', req.user.id).orderBy('created_at', 'desc').execute();
  res.json(rows.map(row => ({
    ...row,
    services: parseJson(row.services, []),
    pricing_snapshot: parseJson(row.pricing_snapshot, []),
    map_file_path: undefined,
  })));
}));
app.post('/api/engineering-service-requests', auth, serviceMapUpload.single('mapFile'), asyncRoute(async (req, res) => {
  const services = (() => {
    try { return JSON.parse(String(req.body.services || '[]')); } catch { return []; }
  })();
  const normalized = {
    clientName: String(req.body.clientName || '').trim(),
    clientPhone: normalizeMobile(req.body.clientPhone),
    province: String(req.body.province || '').trim(),
    projectTitle: String(req.body.projectTitle || '').trim(),
    capacityKw: Number(faToEn(req.body.capacityKw)),
    siteAreaM2: req.body.siteAreaM2 ? Number(faToEn(req.body.siteAreaM2)) : null,
    landOwnership: String(req.body.landOwnership || '').trim(),
    projectUsage: String(req.body.projectUsage || '').trim(),
    gridConnectionStatus: String(req.body.gridConnectionStatus || '').trim(),
    services,
    investmentAmount: req.body.investmentAmount ? Number(faToEn(req.body.investmentAmount)) : null,
    employerContribution: req.body.employerContribution ? Number(faToEn(req.body.employerContribution)) : null,
    facilityAmount: req.body.facilityAmount ? Number(faToEn(req.body.facilityAmount)) : null,
    interestRate: String(faToEn(req.body.interestRate || '')).trim() || null,
    graceMonths: req.body.graceMonths ? Number(faToEn(req.body.graceMonths)) : null,
    repaymentMonths: req.body.repaymentMonths ? Number(faToEn(req.body.repaymentMonths)) : null,
    customerNotes: String(req.body.customerNotes || '').trim(),
  };
  const parsed = z.object({
    clientName: z.string().min(2).max(120),
    clientPhone: z.string().regex(/^09\d{9}$/),
    province: z.string().min(2).max(80),
    projectTitle: z.string().max(160),
    capacityKw: z.number().int().positive().max(1_000_000),
    siteAreaM2: z.number().int().positive().max(2_000_000_000).nullable(),
    landOwnership: z.string().max(100),
    projectUsage: z.string().max(120),
    gridConnectionStatus: z.string().max(120),
    services: z.array(z.enum(['potential_assessment', 'site_plan', 'feasibility_study'])).min(1).max(3),
    investmentAmount: z.number().int().nonnegative().nullable(),
    employerContribution: z.number().int().nonnegative().nullable(),
    facilityAmount: z.number().int().nonnegative().nullable(),
    interestRate: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/).nullable(),
    graceMonths: z.number().int().nonnegative().max(120).nullable(),
    repaymentMonths: z.number().int().positive().max(600).nullable(),
    customerNotes: z.string().max(2_000),
  }).safeParse(normalized);
  if (!parsed.success) return jsonError(res, 400, 'اطلاعات درخواست خدمات کامل یا معتبر نیست.', parsed.error.flatten().fieldErrors);
  if (new Set(parsed.data.services).size !== parsed.data.services.length) return jsonError(res, 400, 'هر خدمت فقط یک‌بار قابل انتخاب است.');
  if (parsed.data.services.includes('feasibility_study')) {
    const required = ['investmentAmount', 'employerContribution', 'facilityAmount', 'interestRate', 'graceMonths', 'repaymentMonths'];
    if (required.some(key => parsed.data[key] === null)) return jsonError(res, 400, 'اطلاعات مالی طرح توجیهی را کامل کنید.');
  }
  const id = uuid();
  let extension = '';
  let fileName = '';
  if (req.file) {
    extension = extname(req.file.originalname || '').toLowerCase();
    const kmlSignature = validateKmlXml(req.file.buffer);
    const kmzSignature = validateKmz(req.file.buffer);
    if (!((extension === '.kml' && kmlSignature) || (extension === '.kmz' && kmzSignature))) {
      return jsonError(res, 400, 'فایل نقشه باید KML یا KMZ معتبر باشد.');
    }
    fileName = `${id}${extension}`;
    await mkdir(serviceMapRoot, { recursive: true });
    const storedPath = resolve(serviceMapRoot, fileName);
    await writeFile(storedPath, req.file.buffer, { flag: 'wx' });
    const scan = await scanUploadedFile(storedPath);
    if (scan === 'infected' || (isProduction() && scan !== 'clean')) {
      await unlink(storedPath).catch(() => {});
      return jsonError(res, scan === 'infected' ? 422 : 503, scan === 'infected' ? 'فایل نقشه توسط اسکن امنیتی رد شد.' : 'اسکن امنیتی فایل در دسترس نیست.');
    }
  }
  const pricing = engineeringPriceSnapshot(parsed.data.services, parsed.data.capacityKw);
  const totalPrice = pricing.reduce((sum, item) => sum + item.price, 0);
  const requestNumber = orderNo('ENG');
  try {
    await db.insertInto('engineering_service_requests').values({
      id, request_no: requestNumber, user_id: req.user.id,
      client_name: parsed.data.clientName, client_phone: parsed.data.clientPhone,
      province: parsed.data.province, project_title: parsed.data.projectTitle || null,
      capacity_kw: parsed.data.capacityKw, site_area_m2: parsed.data.siteAreaM2,
      land_ownership: parsed.data.landOwnership || null, project_usage: parsed.data.projectUsage || null,
      grid_connection_status: parsed.data.gridConnectionStatus || null,
      services: JSON.stringify(parsed.data.services), pricing_snapshot: JSON.stringify(pricing),
      total_price: totalPrice, investment_amount: parsed.data.investmentAmount,
      employer_contribution: parsed.data.employerContribution, facility_amount: parsed.data.facilityAmount,
      interest_rate: parsed.data.interestRate, grace_months: parsed.data.graceMonths,
      repayment_months: parsed.data.repaymentMonths, customer_notes: parsed.data.customerNotes || null,
      map_file_path: fileName, map_original_name: req.file ? basename(req.file.originalname).slice(0, 240) : '',
      map_mime_type: req.file ? (extension === '.kml' ? 'application/vnd.google-earth.kml+xml' : 'application/vnd.google-earth.kmz') : '',
      map_size_bytes: req.file?.size || 0, status: 'submitted', admin_note: null,
      created_at: now(), updated_at: now(),
    }).execute();
  } catch (error) {
    if (fileName) await unlink(resolve(serviceMapRoot, fileName)).catch(() => {});
    throw error;
  }
  await audit(req, 'engineering_service_request_created', 'engineering_service_request', id, {
    requestNo: requestNumber, services: parsed.data.services, capacityKw: parsed.data.capacityKw, totalPrice,
  });
  res.status(201).json({ id, requestNo: requestNumber, totalPrice, pricing, currency: 'IRR' });
}));
app.get('/api/catalog/products', asyncRoute(async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(60, Math.max(1, Number(req.query.limit || 24)));
  const q = String(req.query.q || '').trim();
  const category = String(req.query.category || '').trim();
  let builder = db.selectFrom('products').selectAll()
    .where('status', 'in', ['active', 'published'])
    .where('deleted_at', 'is', null);
  if (q) builder = builder.where(eb => eb.or([
    eb('name', 'like', `%${q}%`), eb('sku', 'like', `%${q}%`),
    eb('brand', 'like', `%${q}%`),
  ]));
  if (category) builder = builder.where('category', '=', category);
  const rows = await builder.orderBy('featured', 'desc').orderBy('updated_at', 'desc')
    .limit(limit).offset((page - 1) * limit).execute();
  const items = rows.map(row => ({
    ...publicProduct(row),
    status: row.status === 'active' ? 'published' : row.status,
    tags: parseJson(row.tags, []),
    specifications: parseJson(row.specifications, {}),
    images: parseJson(row.images, []),
  }));
  if (!Object.keys(req.query).length) return res.json(items);
  let countBuilder = db.selectFrom('products').select(({ fn }) => fn.countAll().as('count'))
    .where('status', 'in', ['active', 'published']).where('deleted_at', 'is', null);
  if (q) countBuilder = countBuilder.where(eb => eb.or([
    eb('name', 'like', `%${q}%`), eb('sku', 'like', `%${q}%`), eb('brand', 'like', `%${q}%`),
  ]));
  if (category) countBuilder = countBuilder.where('category', '=', category);
  const total = Number((await countBuilder.executeTakeFirst())?.count || 0);
  res.json({ items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

app.get('/api/catalog/products/:id', asyncRoute(async (req, res) => {
  const product = await db.selectFrom('products').selectAll()
    .where('id', '=', req.params.id)
    .where('status', 'in', ['active', 'published'])
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!product) return jsonError(res, 404, 'محصول منتشرشده پیدا نشد.');
  const [imageRows, variants] = await Promise.all([
    db.selectFrom('product_images').selectAll().where('product_id', '=', product.id)
      .where('deleted_at', 'is', null).orderBy('sort_order').execute(),
    db.selectFrom('product_variants').selectAll().where('product_id', '=', product.id)
      .where('status', '=', 'active').orderBy('created_at').execute(),
  ]);
  const variantRows = await Promise.all(variants.map(async variant => ({
    ...publicProduct(variant),
    options: await db.selectFrom('variant_options').selectAll().where('variant_id', '=', variant.id)
      .orderBy('sort_order').execute(),
  })));
  res.json({
    ...publicProduct(product),
    status: product.status === 'active' ? 'published' : product.status,
    tags: parseJson(product.tags, []),
    specifications: parseJson(product.specifications, {}),
    images: imageRows.length ? imageRows : parseJson(product.images, []),
    variants: variantRows,
  });
}));

app.post('/api/auth/request-otp', asyncRoute(async (req, res) => {
  const parsed = mobileSchema.safeParse(req.body);
  if (!parsed.success) return jsonError(res, 400, 'شماره همراه معتبر وارد کنید.', { mobile: 'شماره همراه باید ۱۱ رقم باشد.' });
  const mobile = normalizeMobile(parsed.data.mobile);
  if (!/^09\d{9}$/.test(mobile)) return jsonError(res, 400, 'شماره همراه معتبر وارد کنید.', { mobile: 'نمونه صحیح: 09121234567' });
  if (!await enforceAttemptLimit('otp_request', mobile, req, 5, 30)) {
    return jsonError(res, 429, 'تعداد درخواست کد بیش از حد مجاز است. ۳۰ دقیقه بعد دوباره تلاش کنید.');
  }
  const recent = await db.selectFrom('otp_codes').select(['created_at', 'used_at']).where('mobile', '=', mobile).orderBy('created_at', 'desc').executeTakeFirst();
  if (recent && !recent.used_at && Date.now() - Date.parse(recent.created_at) < 45_000) return jsonError(res, 429, 'برای ارسال دوباره کمی صبر کنید.');
  const fixed = isFixedDemo();
  const code = fixed ? '1234' : String(randomInt(100000, 1000000));
  await db.insertInto('otp_codes').values({
    id: uuid(), mobile, code: hash(code), purpose: parsed.data.intent || null,
    portal: 'customer', attempts: 0, requested_ip: req.ip || null,
    expires_at: later(3), used_at: null, created_at: now(),
  }).execute();
  const delivery = await sendOtp({ mobile, code });
  // Requests themselves are counted to enforce a rolling delivery limit.
  await recordAttempt('otp_request', mobile, req, false);
  await audit({ user: null, ip: req.ip }, 'otp_requested', 'mobile', mobile);
  res.json({
    ok: true,
    expiresIn: 180,
    message: delivery.delivered ? 'کد ورود ارسال شد.' : 'کد توسعه محلی توسط ارائه‌دهنده آزمایشی تولید شد.',
    demo: !delivery.delivered,
  });
}));

app.post('/api/auth/verify', asyncRoute(async (req, res) => {
  const mobile = normalizeMobile(req.body?.mobile);
  const code = faToEn(req.body?.code).trim();
  const intent = ['login', 'register'].includes(req.body?.intent) ? req.body.intent : null;
  if (!/^09\d{9}$/.test(mobile) || !/^\d{4,6}$/.test(code) || !intent) return jsonError(res, 400, 'شماره همراه، هدف یا کد ورود صحیح نیست.');
  if (!await enforceAttemptLimit('otp_verify', mobile, req, 5, 15)) {
    return jsonError(res, 429, 'حساب موقتاً قفل شده است. ۱۵ دقیقه بعد دوباره تلاش کنید.');
  }
  let otpId = null;
  if (isVercelDemo()) {
    if (code !== '1234') {
      await recordAttempt('otp_verify', mobile, req, false);
      return jsonError(res, 400, 'کد ورود اشتباه است؛ در نسخه نمایشی 1234 را وارد کنید.');
    }
  } else {
    const otp = await db.selectFrom('otp_codes').selectAll()
      .where('mobile', '=', mobile).where('used_at', 'is', null)
      .orderBy('created_at', 'desc').executeTakeFirst();
    if (!otp || otp.expires_at < now() || otp.code !== hash(code) || otp.purpose !== intent || otp.portal !== 'customer') {
      await recordAttempt('otp_verify', mobile, req, false);
      return jsonError(res, 400, 'کد ورود اشتباه یا منقضی شده است.');
    }
    otpId = otp.id;
  }
  let user = await db.selectFrom('users').selectAll().where('mobile', '=', mobile).executeTakeFirst();
  if (!user && intent === 'login') {
    return jsonError(res, 404, 'حسابی با این شماره پیدا نشد. گزینه «ثبت‌نام کنید» را انتخاب کنید.');
  }
  if (user && intent === 'register') {
    const credential = await db.selectFrom('portal_credentials').select('user_id')
      .where('user_id', '=', user.id).executeTakeFirst();
    if (credential) return jsonError(res, 409, 'این شماره قبلاً ثبت‌نام کرده است. از گزینه ورود استفاده کنید.');
  }
  if (otpId) {
    const consumed = await db.updateTable('otp_codes').set({ used_at: now() }).where('id', '=', otpId)
      .where('used_at', 'is', null).executeTakeFirst();
    if (Number(consumed.numUpdatedRows || 0) !== 1) return jsonError(res, 409, 'این کد قبلاً مصرف شده است.');
  } else if (isVercelDemo()) {
    await db.updateTable('otp_codes').set({ used_at: now() })
      .where('mobile', '=', mobile).where('used_at', 'is', null).execute();
  }
  const adminMobile = normalizeMobile(process.env.ADMIN_MOBILE || '');
  const created = !user;
  if (!user) {
    const id = uuid();
    user = { id, mobile, role: mobile === adminMobile ? 'super_admin' : 'customer', status: 'active', created_at: now() };
    await db.insertInto('users').values(user).execute();
    const acquisition = req.body?.acquisition && typeof req.body.acquisition === 'object' ? req.body.acquisition : {};
    await db.insertInto('profiles').values({
      user_id: id, full_name: null, email: null, national_id: null, company: null,
      job_title: null, account_type: 'individual', mobile_verified_at: now(), updated_at: now(),
      acquisition_source: String(acquisition.source || '').slice(0, 100) || null,
      acquisition_campaign: String(acquisition.campaign || '').slice(0, 150) || null,
      acquisition_medium: String(acquisition.medium || '').slice(0, 100) || null,
      acquisition_referrer: String(acquisition.referrer || '').slice(0, 500) || null,
      acquisition_utm_source: String(acquisition.utm_source || '').slice(0, 150) || null,
      acquisition_utm_medium: String(acquisition.utm_medium || '').slice(0, 150) || null,
      acquisition_utm_campaign: String(acquisition.utm_campaign || '').slice(0, 150) || null,
      acquisition_utm_content: String(acquisition.utm_content || '').slice(0, 150) || null,
      acquisition_utm_term: String(acquisition.utm_term || '').slice(0, 150) || null,
    }).execute();
    await db.insertInto('notifications').values({ id: uuid(), user_id: id, title: 'به راهکار خوش آمدید', body: 'حساب اختصاصی شما آماده است. ابتدا پروفایل و آدرس را تکمیل کنید.', read_at: null, created_at: now() }).execute();
  }
  if (user.role !== 'customer') {
    return jsonError(res, 403, 'این حساب باید از صفحه ورود اختصاصی نقش خود وارد شود.');
  }
  const session = isVercelDemo()
    ? { token: demoToken(user), csrfToken: randomBytes(24).toString('base64url'), maxAgeSeconds: 1800 }
    : await createSession(user, req, 'customer');
  setSessionCookies(res, 'customer', session.token, session.csrfToken, session.maxAgeSeconds);
  await recordAttempt('otp_verify', mobile, req, true);
  await audit({ user, ip: req.ip }, created ? 'customer_registered' : 'login', 'user', user.id);
  res.json({ ...bearerCompatibility(session), created, user: { id: user.id, mobile: user.mobile, role: user.role } });
}));

app.post('/api/auth/password-login', asyncRoute(async (req, res) => {
  const parsed = z.object({
    username: z.string().trim().min(4).max(80),
    password: z.string().min(8).max(128),
  }).safeParse(req.body);
  if (!parsed.success) return jsonError(res, 400, 'نام کاربری یا رمز عبور معتبر نیست.');
  if (!await enforceAttemptLimit('customer_login', parsed.data.username, req)) {
    return jsonError(res, 429, 'ورود موقتاً قفل شده است. ۱۵ دقیقه بعد دوباره تلاش کنید.');
  }
  const credential = await db.selectFrom('portal_credentials')
    .innerJoin('users', 'users.id', 'portal_credentials.user_id')
    .select(['users.id', 'users.mobile', 'users.role', 'users.status', 'users.token_version', 'portal_credentials.password_hash'])
    .where('portal_credentials.username', '=', parsed.data.username).executeTakeFirst();
  if (!credential || credential.role !== 'customer' || credential.status !== 'active' ||
      !passwordMatches(parsed.data.password, credential.password_hash)) {
    await recordAttempt('customer_login', parsed.data.username, req, false);
    return jsonError(res, 401, 'نام کاربری یا رمز عبور اشتباه است.');
  }
  await recordAttempt('customer_login', parsed.data.username, req, true);
  const session = await createSession(credential, req, 'customer');
  setSessionCookies(res, 'customer', session.token, session.csrfToken, session.maxAgeSeconds);
  await audit({ user: credential, ip: req.ip }, 'customer_password_login', 'user', credential.id);
  res.json({ ...bearerCompatibility(session), user: { id: credential.id, mobile: credential.mobile, role: credential.role } });
}));

app.put('/api/auth/customer-credentials', auth, asyncRoute(async (req, res) => {
  if (req.user.role !== 'customer') return jsonError(res, 403, 'این بخش مخصوص حساب مشتری است.');
  const parsed = z.object({
    username: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9._-]{3,39}$/),
    password: z.string().min(10).max(128),
  }).safeParse(req.body);
  if (!parsed.success || !passwordIsStrong(parsed.data?.password)) return jsonError(res, 400, 'نام کاربری باید انگلیسی و رمز حداقل ۱۰ نویسه و شامل حروف بزرگ، کوچک، عدد و نماد باشد.');
  try {
    await db.insertInto('portal_credentials').values({
      user_id: req.user.id, username: parsed.data.username,
      password_hash: passwordHash(parsed.data.password), must_change: 0, updated_at: now(),
    }).onConflict(oc => oc.column('user_id').doUpdateSet({
      username: parsed.data.username, password_hash: passwordHash(parsed.data.password),
      must_change: 0, updated_at: now(),
    })).execute();
  } catch {
    return jsonError(res, 409, 'این نام کاربری قبلاً استفاده شده است.');
  }
  await db.deleteFrom('sessions').where('user_id', '=', req.user.id)
    .execute();
  await db.updateTable('users').set({ token_version: sql`COALESCE(token_version, 0) + 1` }).where('id', '=', req.user.id).execute();
  const refreshedUser = await db.selectFrom('users').selectAll().where('id', '=', req.user.id).executeTakeFirstOrThrow();
  const replacement = await createSession(refreshedUser, req, 'customer');
  setSessionCookies(res, 'customer', replacement.token, replacement.csrfToken, replacement.maxAgeSeconds);
  await audit(req, 'customer_credentials_changed', 'user', req.user.id);
  res.json({ ok: true, username: parsed.data.username, ...bearerCompatibility(replacement) });
}));

app.post('/api/auth/reset-password', asyncRoute(async (req, res) => {
  const mobile = normalizeMobile(req.body?.mobile);
  const code = faToEn(req.body?.code).trim();
  const password = String(req.body?.password || '');
  const username = req.body?.username === undefined ? undefined : String(req.body.username).trim();
  if (!/^09\d{9}$/.test(mobile) || !/^\d{4,6}$/.test(code) || !passwordIsStrong(password)) {
    return jsonError(res, 400, 'شماره، کد پیامکی یا رمز جدید معتبر نیست.');
  }
  if (!await enforceAttemptLimit('password_reset', mobile, req, 5, 30)) {
    return jsonError(res, 429, 'تعداد تلاش بازیابی رمز بیش از حد مجاز است. ۳۰ دقیقه بعد دوباره تلاش کنید.');
  }
  if (username !== undefined && !/^[A-Za-z][A-Za-z0-9._-]{3,39}$/.test(username)) {
    return jsonError(res, 400, 'نام کاربری جدید معتبر نیست.');
  }
  const otp = await db.selectFrom('otp_codes').selectAll()
    .where('mobile', '=', mobile).where('used_at', 'is', null)
    .orderBy('created_at', 'desc').executeTakeFirst();
  if (!otp || otp.expires_at < now() || otp.code !== hash(code) ||
      otp.purpose !== 'reset' || otp.portal !== 'customer') {
    await recordAttempt('password_reset', mobile, req, false);
    return jsonError(res, 400, 'کد پیامکی اشتباه یا منقضی شده است.');
  }
  const user = await db.selectFrom('users').selectAll().where('mobile', '=', mobile).where('role', '=', 'customer').executeTakeFirst();
  if (!user) return jsonError(res, 400, 'اطلاعات بازیابی معتبر نیست.');
  if (username) {
    const duplicate = await db.selectFrom('portal_credentials').select('user_id')
      .where('username', '=', username).where('user_id', '!=', user.id).executeTakeFirst();
    if (duplicate) return jsonError(res, 409, 'این نام کاربری قبلاً استفاده شده است.');
  }
  const credential = await db.selectFrom('portal_credentials').select('user_id').where('user_id', '=', user.id).executeTakeFirst();
  if (!credential) return jsonError(res, 400, 'ابتدا از داخل پروفایل نام کاربری تعریف کنید.');
  await db.transaction().execute(async trx => {
    const consumed = await trx.updateTable('otp_codes').set({ used_at: now() }).where('id', '=', otp.id)
      .where('used_at', 'is', null).executeTakeFirst();
    if (Number(consumed.numUpdatedRows || 0) !== 1) throw Object.assign(new Error('کد قبلاً مصرف شده است.'), { status: 409 });
    await trx.updateTable('portal_credentials').set({
      password_hash: passwordHash(password), ...(username ? { username } : {}), updated_at: now(),
    }).where('user_id', '=', user.id).execute();
    await trx.deleteFrom('sessions').where('user_id', '=', user.id).execute();
    await trx.updateTable('users').set({ token_version: sql`COALESCE(token_version, 0) + 1` }).where('id', '=', user.id).execute();
  });
  await recordAttempt('password_reset', mobile, req, true);
  await audit({ user, ip: req.ip }, 'password_reset_completed', 'user', user.id);
  res.json({ ok: true });
}));

app.post('/api/portal-auth/login', asyncRoute(async (req, res) => {
  const parsed = z.object({
    portal: z.enum(['admin', 'support', 'sales']),
    username: z.string().trim().min(3).max(80),
    password: z.string().min(8).max(128),
  }).safeParse(req.body);
  if (!parsed.success) return jsonError(res, 400, 'نام کاربری یا رمز عبور معتبر نیست.');
  const loginKey = `${parsed.data.portal}:${parsed.data.username}`;
  if (!await enforceAttemptLimit('portal_login', loginKey, req, 5, 5)) {
    return jsonError(res, 429, 'ورود موقتاً قفل شده است. حداکثر ۵ دقیقه بعد دوباره تلاش کنید.');
  }
  const credential = await db.selectFrom('portal_credentials')
    .innerJoin('users', 'users.id', 'portal_credentials.user_id')
    .leftJoin('profiles', 'profiles.user_id', 'users.id')
    .select([
      'users.id', 'users.mobile', 'users.role', 'users.status', 'users.token_version',
      'profiles.full_name', 'portal_credentials.username',
      'portal_credentials.password_hash', 'portal_credentials.must_change',
    ])
    .where('portal_credentials.username', '=', parsed.data.username)
    .executeTakeFirst();
  const allowed = parsed.data.portal === 'admin'
    ? credential?.role === 'super_admin'
    : parsed.data.portal === 'support'
      ? credential?.role === 'support_agent'
      : credential?.role === 'sales_manager';
  if (!credential || credential.status !== 'active' || !allowed || !passwordMatches(parsed.data.password, credential.password_hash)) {
    await recordAttempt('portal_login', loginKey, req, false);
    return jsonError(res, 401, 'نام کاربری یا رمز عبور اشتباه است.');
  }
  await recordAttempt('portal_login', loginKey, req, true);
  if (portalMfaRequired()) {
    const code = String(randomInt(100000, 1000000));
    const challengeId = uuid();
    await db.insertInto('otp_codes').values({
      id: challengeId, mobile: credential.mobile, code: hash(code),
      purpose: `portal_mfa:${parsed.data.portal}:${credential.id}`,
      expires_at: later(3), used_at: null, created_at: now(),
    }).execute();
    await sendOtp({ mobile: credential.mobile, code });
    await audit({ user: credential, ip: req.ip }, 'portal_mfa_requested', parsed.data.portal, credential.id);
    return res.json({
      mfaRequired: true, challengeId, expiresIn: 180,
      maskedMobile: `${credential.mobile.slice(0, 4)}***${credential.mobile.slice(-4)}`,
    });
  }
  const session = await createSession(credential, req, parsed.data.portal);
  setSessionCookies(res, parsed.data.portal, session.token, session.csrfToken, session.maxAgeSeconds);
  await db.updateTable('users').set({ last_login_at: now(), last_activity_at: now() }).where('id', '=', credential.id).execute();
  await audit({ user: credential, ip: req.ip }, 'portal_login', parsed.data.portal, credential.id);
  res.json({
    ...bearerCompatibility(session),
    csrfToken: session.csrfToken,
    user: {
      id: credential.id, mobile: credential.mobile, role: credential.role,
      full_name: credential.full_name, username: credential.username,
      mustChangeCredentials: Boolean(credential.must_change),
    },
  });
}));

app.post('/api/portal-auth/verify-mfa', asyncRoute(async (req, res) => {
  const parsed = z.object({
    challengeId: z.string().uuid(),
    code: z.string().regex(/^\d{6}$/),
  }).safeParse({ challengeId: req.body?.challengeId, code: faToEn(req.body?.code).trim() });
  if (!parsed.success) return jsonError(res, 400, 'کد امنیتی معتبر نیست.');
  const challenge = await db.selectFrom('otp_codes').selectAll()
    .where('id', '=', parsed.data.challengeId).where('used_at', 'is', null).executeTakeFirst();
  const purpose = String(challenge?.purpose || '');
  const [, portal, userId] = purpose.split(':');
  const attemptKey = `${portal || 'unknown'}:${userId || parsed.data.challengeId}`;
  if (!await enforceAttemptLimit('portal_mfa', attemptKey, req, 5, 15)) {
    return jsonError(res, 429, 'تعداد تلاش کد امنیتی بیش از حد مجاز است. ۱۵ دقیقه بعد دوباره تلاش کنید.');
  }
  if (!challenge || challenge.expires_at < now() || challenge.code !== hash(parsed.data.code) ||
      !['admin', 'support', 'sales'].includes(portal) || !userId) {
    await recordAttempt('portal_mfa', attemptKey, req, false);
    return jsonError(res, 401, 'کد امنیتی اشتباه یا منقضی شده است.');
  }
  const credential = await db.selectFrom('users')
    .leftJoin('profiles', 'profiles.user_id', 'users.id')
    .leftJoin('portal_credentials', 'portal_credentials.user_id', 'users.id')
    .select(['users.id', 'users.mobile', 'users.role', 'users.status', 'users.token_version', 'profiles.full_name',
      'portal_credentials.username', 'portal_credentials.must_change'])
    .where('users.id', '=', userId).executeTakeFirst();
  const allowed = portal === 'admin' ? credential?.role === 'super_admin'
    : portal === 'support' ? credential?.role === 'support_agent'
      : credential?.role === 'sales_manager';
  if (!credential || credential.status !== 'active' || !allowed) {
    await recordAttempt('portal_mfa', attemptKey, req, false);
    return jsonError(res, 403, 'دسترسی این حساب غیرفعال یا نامعتبر است.');
  }
  const consumed = await db.updateTable('otp_codes').set({ used_at: now() }).where('id', '=', challenge.id)
    .where('used_at', 'is', null).executeTakeFirst();
  if (Number(consumed.numUpdatedRows || 0) !== 1) return jsonError(res, 409, 'این چالش قبلاً مصرف شده است.');
  await recordAttempt('portal_mfa', attemptKey, req, true);
  const session = await createSession(credential, req, portal, true);
  setSessionCookies(res, portal, session.token, session.csrfToken, session.maxAgeSeconds);
  await db.updateTable('users').set({ last_login_at: now(), last_activity_at: now() }).where('id', '=', credential.id).execute();
  await audit({ user: credential, ip: req.ip }, 'portal_mfa_verified', portal, credential.id);
  res.json({
    ...bearerCompatibility(session),
    csrfToken: session.csrfToken,
    user: {
      id: credential.id, mobile: credential.mobile, role: credential.role,
      full_name: credential.full_name, username: credential.username,
      mustChangeCredentials: Boolean(credential.must_change),
    },
  });
}));

app.put('/api/portal-auth/credentials', auth, asyncRoute(async (req, res) => {
  if (!['super_admin', 'support_agent', 'sales_manager'].includes(req.user.role)) return jsonError(res, 403, 'این مسیر مخصوص حساب کارکنان است.');
  const parsed = z.object({
    currentPassword: z.string().min(8),
    username: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9._-]{3,39}$/, 'نام کاربری باید انگلیسی و حداقل ۴ نویسه باشد.'),
    password: z.string().min(10, 'رمز جدید حداقل ۱۰ نویسه باشد.').max(128),
  }).safeParse(req.body);
  if (!parsed.success || !passwordIsStrong(parsed.data?.password)) return jsonError(res, 400, 'رمز جدید باید شامل حروف بزرگ، کوچک، عدد و نماد باشد.', parsed.error?.flatten().fieldErrors);
  const current = await db.selectFrom('portal_credentials').selectAll().where('user_id', '=', req.user.id).executeTakeFirst();
  if (!current || !passwordMatches(parsed.data.currentPassword, current.password_hash)) return jsonError(res, 400, 'رمز عبور فعلی اشتباه است.');
  try {
    await db.transaction().execute(async trx => {
      await trx.updateTable('portal_credentials').set({
        username: parsed.data.username,
        password_hash: passwordHash(parsed.data.password),
        must_change: 0,
        temporary_expires_at: null,
        updated_at: now(),
      }).where('user_id', '=', req.user.id).execute();
      await trx.updateTable('users').set({ token_version: sql`COALESCE(token_version, 0) + 1` }).where('id', '=', req.user.id).execute();
      await trx.deleteFrom('sessions').where('user_id', '=', req.user.id).execute();
    });
  } catch {
    return jsonError(res, 409, 'این نام کاربری قبلاً استفاده شده است.');
  }
  await audit(req, 'portal_credentials_changed', 'user', req.user.id);
  const refreshedUser = await db.selectFrom('users').selectAll().where('id', '=', req.user.id).executeTakeFirstOrThrow();
  const replacement = await createSession(refreshedUser, req, req.user.portal);
  setSessionCookies(res, req.user.portal, replacement.token, replacement.csrfToken, replacement.maxAgeSeconds);
  res.json({
    ok: true,
    username: parsed.data.username,
    csrfToken: replacement.csrfToken,
    ...bearerCompatibility(replacement),
  });
}));

app.post('/api/auth/logout', auth, asyncRoute(async (req, res) => {
  if (req.user.session_id) await db.deleteFrom('sessions').where('id', '=', req.user.session_id).execute();
  await audit(req, 'logout', 'session', req.user.session_id);
  clearSessionCookies(res, req.user.portal);
  res.json({ ok: true });
}));

app.get('/api/me', auth, asyncRoute(async (req, res) => {
  const profile = await db.selectFrom('profiles').selectAll().where('user_id', '=', req.user.id).executeTakeFirst();
  const credential = await db.selectFrom('portal_credentials').select(['username', 'must_change']).where('user_id', '=', req.user.id).executeTakeFirst();
  const account = await db.selectFrom('users').select(['created_at', 'last_login_at', 'last_activity_at', 'status'])
    .where('id', '=', req.user.id).executeTakeFirst();
  const member = req.user.role === 'sales_manager'
    ? await db.selectFrom('admin_members').select('permissions').where('user_id', '=', req.user.id).where('section', '=', 'sales').executeTakeFirst()
    : null;
  const completion = profileCompletion(profile, credential?.username);
  res.json({
    ...profile, id: req.user.id, mobile: req.user.mobile, role: req.user.role,
    status: account?.status || req.user.status, member_since: account?.created_at || req.user.created_at,
    last_login_at: account?.last_login_at || null,
    online: Boolean(account?.last_activity_at && Date.now() - new Date(account.last_activity_at).getTime() < 5 * 60_000),
    username: credential?.username || null,
    mustChangeCredentials: req.user.role === 'super_admin' && Boolean(credential?.must_change),
    permissions: member ? normalizeSalesPermissions(member.permissions) : null,
    profileCompletion: completion,
  });
}));

app.put('/api/me', auth, asyncRoute(async (req, res) => {
  const schema = z.object({
    full_name: z.string().trim().min(2, 'نام کامل را وارد کنید.').max(100).optional(),
    first_name: z.string().trim().max(60).optional(),
    last_name: z.string().trim().max(80).optional(),
    display_name: z.string().trim().max(100).optional(),
    email: z.union([z.string().email('ایمیل معتبر نیست.'), z.literal('')]).optional(),
    national_id: z.string().regex(/^$|^\d{10}$/, 'کد ملی باید ۱۰ رقم باشد.').optional(),
    birth_date: z.string().max(20).optional(),
    gender: z.enum(['', 'male', 'female', 'other', 'unspecified']).optional(),
    avatar_url: z.union([z.string().url(), z.literal('')]).optional(),
    account_type: z.enum(['individual', 'legal']).optional(),
    alternate_phone: z.string().max(20).optional(),
    company: z.string().max(120).optional(),
    job_title: z.string().max(120).optional(),
    company_national_id: z.string().max(20).optional(),
    registration_no: z.string().max(30).optional(),
    economic_code: z.string().max(30).optional(),
    representative_name: z.string().max(120).optional(),
    representative_position: z.string().max(120).optional(),
    company_phone: z.string().max(20).optional(),
    company_address: z.string().max(500).optional(),
    invoice_details: z.string().max(1000).optional(),
    privacy_settings: z.string().max(2000).optional(),
    consent_version: z.string().max(40).optional(),
    consent_accepted_at: z.string().max(40).optional(),
    onboarding_completed_at: z.string().max(40).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return jsonError(res, 400, 'اطلاعات فرم را بررسی کنید.', parsed.error.flatten().fieldErrors);
  if (parsed.data.email) {
    const duplicate = await db.selectFrom('profiles').select('user_id')
      .where('email', '=', parsed.data.email.toLowerCase())
      .where('user_id', '!=', req.user.id).executeTakeFirst();
    if (duplicate) return jsonError(res, 409, 'این ایمیل قبلاً ثبت شده است.', { email: 'ایمیل تکراری است.' });
  }
  const before = await db.selectFrom('profiles').selectAll().where('user_id', '=', req.user.id).executeTakeFirst();
  const values = { ...parsed.data };
  if (values.email) values.email = values.email.toLowerCase();
  if (!values.full_name && (values.first_name || values.last_name)) {
    values.full_name = `${values.first_name || before?.first_name || ''} ${values.last_name || before?.last_name || ''}`.trim();
  }
  await db.updateTable('profiles').set({ ...values, updated_at: now() }).where('user_id', '=', req.user.id).execute();
  await audit(req, 'profile_updated', 'user', req.user.id, { fields: Object.keys(values) });
  const profile = await db.selectFrom('profiles').selectAll().where('user_id', '=', req.user.id).executeTakeFirst();
  const credential = await db.selectFrom('portal_credentials').select('username').where('user_id', '=', req.user.id).executeTakeFirst();
  res.json({ ok: true, profileCompletion: profileCompletion(profile, credential?.username) });
}));

app.get('/api/security/sessions', auth, asyncRoute(async (req, res) => {
  const rows = await db.selectFrom('sessions')
    .select(['id', 'portal', 'ip', 'user_agent', 'last_seen_at', 'created_at', 'expires_at'])
    .where('user_id', '=', req.user.id).where('expires_at', '>=', now())
    .orderBy('last_seen_at', 'desc').execute();
  res.json(rows.map(row => ({ ...row, current: row.id === req.user.session_id })));
}));
app.post('/api/security/logout-others', auth, asyncRoute(async (req, res) => {
  let query = db.deleteFrom('sessions').where('user_id', '=', req.user.id);
  if (req.user.session_id) query = query.where('id', '!=', req.user.session_id);
  const result = await query.executeTakeFirst();
  await audit(req, 'other_sessions_revoked', 'user', req.user.id);
  res.json({ ok: true, revoked: Number(result.numDeletedRows || 0) });
}));
app.post('/api/security/deactivate-request', auth, asyncRoute(async (req, res) => {
  const confirmation = String(req.body?.confirmation || '');
  if (confirmation !== 'غیرفعال‌سازی حساب') return jsonError(res, 400, 'عبارت تأیید را دقیق وارد کنید.');
  await db.updateTable('profiles').set({ deactivation_requested_at: now(), updated_at: now() }).where('user_id', '=', req.user.id).execute();
  await audit(req, 'account_deactivation_requested', 'user', req.user.id);
  res.json({ ok: true });
}));

app.get('/api/account/summary', auth, asyncRoute(async (req, res) => {
  const userId = req.user.id;
  const [orders, consultations, quotes, projects, tickets, notifications, payments, favorites, engineeringRequests] = await Promise.all([
    db.selectFrom('orders').selectAll().where('user_id', '=', userId).orderBy('created_at', 'desc').execute(),
    db.selectFrom('consultations').selectAll().where('user_id', '=', userId).orderBy('created_at', 'desc').execute(),
    db.selectFrom('quotes').selectAll().where('user_id', '=', userId).orderBy('created_at', 'desc').execute(),
    db.selectFrom('projects').selectAll().where('user_id', '=', userId).orderBy('created_at', 'desc').execute(),
    db.selectFrom('support_tickets').selectAll().where('user_id', '=', userId).orderBy('created_at', 'desc').execute(),
    db.selectFrom('notifications').selectAll().where('user_id', '=', userId).orderBy('created_at', 'desc').limit(8).execute(),
    db.selectFrom('payments').selectAll().where('user_id', '=', userId).orderBy('created_at', 'desc').execute(),
    db.selectFrom('favorites').innerJoin('products', 'products.id', 'favorites.product_id')
      .select(['products.id', 'products.name', 'products.price', 'products.image_url', 'favorites.created_at'])
      .where('favorites.user_id', '=', userId).where('products.status', '=', 'active')
      .orderBy('favorites.created_at', 'desc').execute(),
    db.selectFrom('engineering_service_requests')
      .select([
        'id', 'request_no', 'province', 'project_title', 'capacity_kw', 'services',
        'pricing_snapshot', 'total_price', 'status', 'admin_note', 'created_at', 'updated_at',
      ])
      .where('user_id', '=', userId).orderBy('created_at', 'desc').execute(),
  ]);
  res.json({
    orders, consultations, quotes, projects, tickets, notifications, payments, favorites,
    engineeringRequests: engineeringRequests.map(row => ({
      ...row,
      services: parseJson(row.services, []),
      pricing_snapshot: parseJson(row.pricing_snapshot, []),
    })),
  });
}));
app.post('/api/favorites/:productId', auth, asyncRoute(async (req, res) => {
  const product = await db.selectFrom('products').select('id').where('id', '=', req.params.productId)
    .where('status', '=', 'active').executeTakeFirst();
  if (!product) return jsonError(res, 404, 'محصول پیدا نشد.');
  await db.insertInto('favorites').values({
    user_id: req.user.id, product_id: product.id, created_at: now(),
  }).onConflict(oc => oc.columns(['user_id', 'product_id']).doNothing()).execute();
  res.status(201).json({ ok: true });
}));
app.delete('/api/favorites/:productId', auth, asyncRoute(async (req, res) => {
  await db.deleteFrom('favorites').where('user_id', '=', req.user.id)
    .where('product_id', '=', req.params.productId).execute();
  res.json({ ok: true });
}));

app.get('/api/cart', auth, asyncRoute(async (req, res) => {
  const rows = await db.selectFrom('customer_cart_items')
    .innerJoin('products', 'products.id', 'customer_cart_items.product_id')
    .leftJoin('product_variants', 'product_variants.id', 'customer_cart_items.variant_id')
    .select([
      'customer_cart_items.product_id', 'customer_cart_items.variant_id',
      'customer_cart_items.quantity', 'customer_cart_items.updated_at',
      'products.status as product_status', 'products.deleted_at',
      'product_variants.status as variant_status',
    ])
    .where('customer_cart_items.user_id', '=', req.user.id)
    .orderBy('customer_cart_items.updated_at', 'desc').execute();
  const unavailable = rows.filter(row =>
    !['active', 'published'].includes(row.product_status) || row.deleted_at ||
    (row.variant_id && row.variant_status !== 'active'));
  if (unavailable.length) {
    await db.deleteFrom('customer_cart_items').where('user_id', '=', req.user.id)
      .where('product_id', 'in', unavailable.map(row => row.product_id)).execute();
  }
  res.json(rows.filter(row => !unavailable.includes(row)).map(row => ({
    productId: row.product_id, variantId: row.variant_id || null, quantity: row.quantity,
  })));
}));

app.put('/api/cart', auth, asyncRoute(async (req, res) => {
  const parsed = z.object({
    mode: z.enum(['merge', 'replace']).default('merge'),
    items: z.array(z.object({
      productId: z.string(), variantId: z.string().nullable().optional(),
      quantity: z.number().int().min(1).max(20),
    })).max(100),
  }).safeParse(req.body);
  if (!parsed.success) return jsonError(res, 400, 'اقلام سبد معتبر نیستند.');
  const valid = [];
  for (const item of parsed.data.items) {
    const product = await db.selectFrom('products').select(['id', 'status', 'deleted_at'])
      .where('id', '=', item.productId).executeTakeFirst();
    if (!product || !['active', 'published'].includes(product.status) || product.deleted_at) continue;
    if (item.variantId) {
      const variant = await db.selectFrom('product_variants').select(['id', 'status'])
        .where('id', '=', item.variantId).where('product_id', '=', product.id).executeTakeFirst();
      if (!variant || variant.status !== 'active') continue;
    }
    valid.push(item);
  }
  await db.transaction().execute(async trx => {
    if (parsed.data.mode === 'replace') {
      await trx.deleteFrom('customer_cart_items').where('user_id', '=', req.user.id).execute();
    }
    for (const item of valid) {
      const variantKey = item.variantId || '';
      const previous = parsed.data.mode === 'merge'
        ? await trx.selectFrom('customer_cart_items').select('quantity')
          .where('user_id', '=', req.user.id).where('product_id', '=', item.productId)
          .where('variant_key', '=', variantKey).executeTakeFirst()
        : null;
      const quantity = parsed.data.mode === 'merge'
        ? Math.min(20, Math.max(Number(previous?.quantity || 0), item.quantity))
        : item.quantity;
      await trx.insertInto('customer_cart_items').values({
        user_id: req.user.id, product_id: item.productId, variant_key: variantKey,
        variant_id: item.variantId || null, quantity, updated_at: now(),
      }).onConflict(oc => oc.columns(['user_id', 'product_id', 'variant_key']).doUpdateSet({
        variant_id: item.variantId || null, quantity, updated_at: now(),
      })).execute();
    }
  });
  const rows = await db.selectFrom('customer_cart_items').select(['product_id', 'variant_id', 'quantity'])
    .where('user_id', '=', req.user.id).orderBy('updated_at', 'desc').execute();
  res.json({
    items: rows.map(row => ({ productId: row.product_id, variantId: row.variant_id || null, quantity: row.quantity })),
    omitted: parsed.data.items.length - valid.length,
  });
}));

app.get('/api/addresses', auth, asyncRoute(async (req, res) => {
  res.json(await db.selectFrom('addresses').selectAll().where('user_id', '=', req.user.id)
    .where('deleted_at', 'is', null).orderBy('is_default', 'desc').execute());
}));
app.post('/api/addresses', auth, asyncRoute(async (req, res) => {
  const schema = z.object({
    title: z.string().min(2), recipient: z.string().min(2), mobile: z.string().min(10),
    province: z.string().min(2), city: z.string().min(2),
    province_code: z.string().max(10).optional(), city_code: z.string().max(20).optional(),
    address: z.string().min(8),
    postal_code: z.string().optional(), latitude: z.string().max(30).optional(),
    longitude: z.string().max(30).optional(), is_default: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return jsonError(res, 400, 'اطلاعات آدرس کامل نیست.', parsed.error.flatten().fieldErrors);
  const mobile = normalizeMobile(parsed.data.mobile);
  if (!/^09\d{9}$/.test(mobile)) return jsonError(res, 400, 'شماره تماس تحویل‌گیرنده معتبر نیست.', { mobile: 'نمونه صحیح: 09121234567' });
  if (parsed.data.postal_code && !/^\d{10}$/.test(faToEn(parsed.data.postal_code).replace(/\D/g, ''))) {
    return jsonError(res, 400, 'کد پستی باید ۱۰ رقم باشد.', { postal_code: 'کد پستی را بدون خط تیره وارد کنید.' });
  }
  const id = uuid();
  await db.transaction().execute(async trx => {
    if (parsed.data.is_default) await trx.updateTable('addresses').set({ is_default: 0 }).where('user_id', '=', req.user.id).execute();
    await trx.insertInto('addresses').values({
      id, user_id: req.user.id, ...parsed.data, mobile,
      province_code: parsed.data.province_code || provinceCodes.get(parsed.data.province) || '00',
      city_code: parsed.data.city_code || `${provinceCodes.get(parsed.data.province) || '00'}:${locationCode(parsed.data.city)}`,
      postal_code: faToEn(parsed.data.postal_code || '').replace(/\D/g, ''),
      latitude: parsed.data.latitude || null, longitude: parsed.data.longitude || null,
      is_default: parsed.data.is_default ? 1 : 0, created_at: now(),
    }).execute();
  });
  res.status(201).json({ id });
}));
app.put('/api/addresses/:id', auth, asyncRoute(async (req, res) => {
  const schema = z.object({
    title: z.string().min(2), recipient: z.string().min(2), mobile: z.string().min(10),
    province: z.string().min(2), city: z.string().min(2),
    province_code: z.string().max(10).optional(), city_code: z.string().max(20).optional(),
    address: z.string().min(8),
    postal_code: z.string().optional(), latitude: z.string().max(30).optional(),
    longitude: z.string().max(30).optional(), is_default: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return jsonError(res, 400, 'اطلاعات آدرس کامل نیست.', parsed.error.flatten().fieldErrors);
  const current = await db.selectFrom('addresses').select('id').where('id', '=', req.params.id)
    .where('user_id', '=', req.user.id).where('deleted_at', 'is', null).executeTakeFirst();
  if (!current) return jsonError(res, 404, 'آدرس پیدا نشد.');
  await db.transaction().execute(async trx => {
    if (parsed.data.is_default) await trx.updateTable('addresses').set({ is_default: 0 }).where('user_id', '=', req.user.id).execute();
    await trx.updateTable('addresses').set({
      ...parsed.data, mobile: normalizeMobile(parsed.data.mobile),
      province_code: parsed.data.province_code || provinceCodes.get(parsed.data.province) || '00',
      city_code: parsed.data.city_code || `${provinceCodes.get(parsed.data.province) || '00'}:${locationCode(parsed.data.city)}`,
      postal_code: faToEn(parsed.data.postal_code || '').replace(/\D/g, ''),
      is_default: parsed.data.is_default ? 1 : 0,
    }).where('id', '=', current.id).execute();
  });
  await audit(req, 'address_updated', 'address', current.id);
  res.json({ ok: true });
}));
app.patch('/api/addresses/:id/default', auth, asyncRoute(async (req, res) => {
  const address = await db.selectFrom('addresses').select('id').where('id', '=', req.params.id).where('user_id', '=', req.user.id).executeTakeFirst();
  if (!address) return jsonError(res, 404, 'آدرس پیدا نشد.');
  await db.transaction().execute(async trx => {
    await trx.updateTable('addresses').set({ is_default: 0 }).where('user_id', '=', req.user.id).execute();
    await trx.updateTable('addresses').set({ is_default: 1 }).where('id', '=', address.id).execute();
  });
  res.json({ ok: true });
}));
app.delete('/api/addresses/:id', auth, asyncRoute(async (req, res) => {
  const address = await db.selectFrom('addresses').selectAll().where('id', '=', req.params.id)
    .where('user_id', '=', req.user.id).where('deleted_at', 'is', null).executeTakeFirst();
  if (!address) return jsonError(res, 404, 'آدرس پیدا نشد.');
  const referenced = await db.selectFrom('orders').select('id').where('address_id', '=', address.id).executeTakeFirst();
  if (referenced) {
    await db.updateTable('addresses').set({ deleted_at: now(), is_default: 0 }).where('id', '=', address.id).execute();
  } else {
    await db.deleteFrom('addresses').where('id', '=', address.id).execute();
  }
  await audit(req, 'address_deleted', 'address', address.id, { soft: Boolean(referenced) });
  res.json({ ok: true });
}));

app.get('/api/orders', auth, asyncRoute(async (req, res) => {
  res.json(await db.selectFrom('orders').selectAll().where('user_id', '=', req.user.id).orderBy('created_at', 'desc').execute());
}));
app.get('/api/orders/:id', auth, asyncRoute(async (req, res) => {
  const order = await db.selectFrom('orders').selectAll().where('id', '=', req.params.id).where('user_id', '=', req.user.id).executeTakeFirst();
  if (!order) return jsonError(res, 404, 'سفارش پیدا نشد.');
  const items = await db.selectFrom('order_items').selectAll().where('order_id', '=', order.id).execute();
  const payments = await db.selectFrom('payments').selectAll().where('order_id', '=', order.id).where('user_id', '=', req.user.id).execute();
  const [history, invoice, shipments, returns] = await Promise.all([
    db.selectFrom('order_status_history').selectAll().where('order_id', '=', order.id).orderBy('created_at').execute(),
    db.selectFrom('invoices').selectAll().where('order_id', '=', order.id).executeTakeFirst(),
    db.selectFrom('shipments').selectAll().where('order_id', '=', order.id).orderBy('created_at', 'desc').execute(),
    db.selectFrom('returns').selectAll().where('order_id', '=', order.id)
      .where('user_id', '=', req.user.id).orderBy('created_at', 'desc').execute(),
  ]);
  res.json({
    ...order, address_snapshot: parseJson(order.address_snapshot, null),
    items, payments, history, invoice, shipments, returns,
  });
}));

app.post('/api/checkout/preview', auth, asyncRoute(async (req, res) => {
  const parsed = z.object({
    items: z.array(z.object({
      productId: z.string(), variantId: z.string().nullable().optional(),
      quantity: z.number().int().min(1).max(20),
    })).min(1),
    discountCode: z.string().trim().max(40).optional(),
  }).safeParse(req.body);
  if (!parsed.success) return jsonError(res, 400, 'اقلام سبد خرید معتبر نیستند.');
  const pricedItems = [];
  for (const item of parsed.data.items) {
    const product = await db.selectFrom('products').selectAll().where('id', '=', item.productId)
      .where('status', 'in', ['active', 'published']).where('deleted_at', 'is', null).executeTakeFirst();
    if (!product) return jsonError(res, 409, 'یکی از محصولات سبد دیگر در فروشگاه موجود نیست.');
    const variant = item.variantId
      ? await db.selectFrom('product_variants').selectAll().where('id', '=', item.variantId)
        .where('product_id', '=', product.id).where('status', '=', 'active').executeTakeFirst()
      : null;
    if (item.variantId && !variant) return jsonError(res, 409, `تنوع انتخاب‌شده برای «${product.name}» دیگر فعال نیست.`);
    const saleActive = product.sale_price !== null && product.sale_price !== undefined &&
      (!product.sale_starts_at || product.sale_starts_at <= now()) &&
      (!product.sale_ends_at || product.sale_ends_at >= now());
    const unitPrice = Number(variant?.price ?? (saleActive ? product.sale_price : product.price));
    const available = Number(variant?.stock ?? product.stock ?? 0) - Number(variant?.reserved_stock ?? product.reserved_stock ?? 0);
    if (product.product_type === 'physical' && available < item.quantity) {
      return jsonError(res, 409, `موجودی «${product.name}» تغییر کرده است؛ حداکثر ${Math.max(0, available).toLocaleString('fa-IR')} عدد قابل سفارش است.`);
    }
    const lineTotal = rial(unitPrice * item.quantity);
    pricedItems.push({
      productId: product.id, variantId: variant?.id || null,
      name: variant ? `${product.name} - ${variant.name}` : product.name,
      quantity: item.quantity, unitPrice, lineTotal,
      taxRate: Number(product.tax_rate || 0), available,
      categoryId: product.category_id, category: product.category,
    });
  }
  const subtotal = pricedItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const taxTotal = pricedItems.reduce((sum, item) => sum + Math.round(item.lineTotal * item.taxRate / 100), 0);
  let discountTotal = 0;
  let discountMessage = '';
  if (parsed.data.discountCode) {
    const code = parsed.data.discountCode.toUpperCase();
    const discount = await db.selectFrom('discount_codes').selectAll()
      .where('code', '=', code).where('status', '=', 'active').executeTakeFirst();
    if (!discount) return jsonError(res, 400, 'کد تخفیف پیدا نشد یا غیرفعال است.');
    if (discount.starts_at && discount.starts_at > now()) return jsonError(res, 400, 'زمان استفاده از این کد هنوز شروع نشده است.');
    if (discount.ends_at && discount.ends_at < now()) return jsonError(res, 400, 'مهلت استفاده از این کد به پایان رسیده است.');
    if (discount.usage_limit && discount.used_count >= discount.usage_limit) return jsonError(res, 400, 'سقف استفاده این کد تکمیل شده است.');
    if (discount.minimum_order && subtotal < discount.minimum_order) {
      return jsonError(res, 400, `حداقل مبلغ سفارش برای این کد ${Number(discount.minimum_order).toLocaleString('fa-IR')} ریال است.`);
    }
    const customerUsage = Number((await db.selectFrom('discount_usages').select(({ fn }) => fn.countAll().as('count'))
      .where('discount_id', '=', discount.id).where('user_id', '=', req.user.id)
      .where('status', '=', 'used').executeTakeFirst())?.count || 0);
    if ((discount.per_customer_limit && customerUsage >= discount.per_customer_limit) ||
        (discount.single_use && customerUsage > 0)) return jsonError(res, 400, 'سقف استفاده این کد برای حساب شما تکمیل شده است.');
    if (discount.first_purchase_only) {
      const previous = await db.selectFrom('orders').select('id').where('user_id', '=', req.user.id)
        .where('payment_status', '=', 'paid').executeTakeFirst();
      if (previous) return jsonError(res, 400, 'این کد فقط برای اولین خرید قابل‌استفاده است.');
    }
    const allowedCustomers = parseJson(discount.customer_ids, []);
    const allowedProducts = parseJson(discount.product_ids, []);
    const allowedCategories = parseJson(discount.category_ids, []);
    if (allowedCustomers.length && !allowedCustomers.includes(req.user.id)) return jsonError(res, 400, 'این کد برای حساب شما تعریف نشده است.');
    if (allowedProducts.length && !pricedItems.some(item => allowedProducts.includes(item.productId))) return jsonError(res, 400, 'این کد برای محصولات این سبد قابل‌استفاده نیست.');
    if (allowedCategories.length && !pricedItems.some(item => allowedCategories.includes(item.categoryId) || allowedCategories.includes(item.category))) {
      return jsonError(res, 400, 'این کد برای دسته محصولات این سبد قابل‌استفاده نیست.');
    }
    discountTotal = discount.type === 'percent'
      ? Math.round(subtotal * Math.min(100, discount.value) / 100)
      : Math.min(subtotal, discount.value);
    if (discount.maximum_discount) discountTotal = Math.min(discountTotal, discount.maximum_discount);
    discountMessage = `کد ${code} اعمال شد.`;
  }
  const shipping = subtotal >= 250_000_000 ? 0 : 850_000;
  res.json({
    items: pricedItems, subtotal, discountTotal, taxTotal, shipping,
    total: Math.max(0, subtotal + taxTotal + shipping - discountTotal),
    discountMessage,
  });
}));

app.post('/api/orders/:id/cancel', auth, asyncRoute(async (req, res) => {
  const parsed = z.object({ reason: z.string().trim().min(5).max(500) }).safeParse(req.body);
  if (!parsed.success) return jsonError(res, 400, 'دلیل لغو را حداقل در ۵ نویسه وارد کنید.');
  const order = await db.selectFrom('orders').selectAll().where('id', '=', req.params.id)
    .where('user_id', '=', req.user.id).executeTakeFirst();
  if (!order) return jsonError(res, 404, 'سفارش پیدا نشد.');
  if (order.status !== 'awaiting_payment') {
    return jsonError(res, 409, 'لغو مستقیم فقط تا پیش از پرداخت ممکن است؛ برای سفارش پرداخت‌شده از پشتیبانی درخواست ثبت کنید.');
  }
  await changeOrderStatus(req, order, 'cancelled', `لغو توسط مشتری: ${parsed.data.reason}`);
  await db.insertInto('notifications').values({
    id: uuid(), user_id: req.user.id, title: 'سفارش لغو شد',
    body: `سفارش ${order.order_no} لغو و موجودی رزروشده آزاد شد.`,
    read_at: null, created_at: now(),
  }).execute();
  await audit(req, 'order_cancelled_by_customer', 'order', order.id, { reason: parsed.data.reason });
  res.json({ ok: true, status: 'cancelled' });
}));
app.post('/api/orders', auth, asyncRoute(async (req, res) => {
  const addressSchema = z.object({
    id: z.string(), title: z.string().min(2), recipient: z.string().min(2), mobile: z.string().min(10),
    province: z.string().min(2), city: z.string().min(2),
    province_code: z.string().max(10).optional(), city_code: z.string().max(20).optional(),
    address: z.string().min(8),
    postal_code: z.string().optional(), is_default: z.union([z.boolean(), z.number()]).optional(),
  });
  const schema = z.object({
    items: z.array(z.object({
      productId: z.string(), variantId: z.string().nullable().optional(),
      quantity: z.number().int().min(1).max(20),
    })).min(1),
    addressId: z.string().min(1).nullable().optional(), addressSnapshot: addressSchema.optional(),
    discountCode: z.string().trim().max(40).optional(), notes: z.string().max(500).optional(),
    clientOrderId: z.string().trim().min(8).max(100).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return jsonError(res, 400, 'سبد خرید معتبر نیست.', parsed.error.flatten().fieldErrors);
  await expireReservations();
  if (parsed.data.clientOrderId) {
    const previous = await db.selectFrom('orders').selectAll()
      .where('user_id', '=', req.user.id).where('idempotency_key', '=', parsed.data.clientOrderId).executeTakeFirst();
    if (previous) return res.status(200).json({
      id: previous.id, orderNo: previous.order_no, total: previous.total,
      subtotal: previous.subtotal, taxTotal: previous.tax_total,
      discountTotal: previous.discount_total, duplicatePrevented: true,
    });
  }
  const items = [];
  for (const item of parsed.data.items) {
    const product = await db.selectFrom('products').selectAll().where('id', '=', item.productId)
      .where('status', 'in', ['active', 'published']).where('deleted_at', 'is', null).executeTakeFirst();
    if (!product) return jsonError(res, 400, 'یکی از محصولات سبد منتشرشده نیست.');
    const variant = item.variantId
      ? await db.selectFrom('product_variants').selectAll().where('id', '=', item.variantId)
        .where('product_id', '=', product.id).where('status', '=', 'active').executeTakeFirst()
      : null;
    if (item.variantId && !variant) return jsonError(res, 400, `تنوع انتخاب‌شده برای «${product.name}» معتبر نیست.`);
    const saleIsActive = product.sale_price !== null && product.sale_price !== undefined &&
      (!product.sale_starts_at || product.sale_starts_at <= now()) &&
      (!product.sale_ends_at || product.sale_ends_at >= now());
    const unitPrice = Number(variant?.price ?? (saleIsActive ? product.sale_price : product.price));
    const availableStock = Number(variant?.stock ?? product.stock ?? 0) - Number(variant?.reserved_stock ?? product.reserved_stock ?? 0);
    if (product.product_type === 'physical' && availableStock < item.quantity) {
      return jsonError(res, 409, `موجودی قابل‌فروش «${product.name}${variant ? ` - ${variant.name}` : ''}» کافی نیست.`);
    }
    items.push({
      ...item, product, variant, name: variant ? `${product.name} - ${variant.name}` : product.name,
      unitPrice, taxRate: Number(product.tax_rate || 0),
      unitCost: Number(variant?.cost_price ?? product.unit_cost ?? product.purchase_price ?? 0),
      lineTotal: rial(unitPrice * item.quantity),
    });
  }
  const serviceOnly = items.every(item => item.product.product_type === 'service');
  let address = parsed.data.addressId ? await db.selectFrom('addresses').selectAll().where('id', '=', parsed.data.addressId)
    .where('user_id', '=', req.user.id).where('deleted_at', 'is', null).executeTakeFirst() : null;
  if (!address && isVercelDemo() && parsed.data.addressSnapshot?.id === parsed.data.addressId) {
    const snapshot = parsed.data.addressSnapshot;
    await db.insertInto('addresses').values({
      id: snapshot.id, user_id: req.user.id, title: snapshot.title, recipient: snapshot.recipient,
      mobile: normalizeMobile(snapshot.mobile), province: snapshot.province, city: snapshot.city,
      province_code: snapshot.province_code || provinceCodes.get(snapshot.province) || '00',
      city_code: snapshot.city_code || `${provinceCodes.get(snapshot.province) || '00'}:${locationCode(snapshot.city)}`,
      address: snapshot.address, postal_code: faToEn(snapshot.postal_code || '').replace(/\D/g, ''),
      is_default: snapshot.is_default ? 1 : 0, created_at: now(),
    }).onConflict(oc => oc.column('id').doNothing()).execute();
    address = await db.selectFrom('addresses').selectAll().where('id', '=', snapshot.id).executeTakeFirst();
  }
  if (!serviceOnly && !address) return jsonError(res, 400, 'برای ثبت سفارش یک آدرس تحویل معتبر انتخاب کنید.');
  const id = uuid();
  const number = orderNo('AR');
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const taxTotal = items.reduce((sum, item) => sum + Math.round(item.lineTotal * Number(item.taxRate || 0) / 100), 0);
  let discountTotal = 0;
  let discount = null;
  if (parsed.data.discountCode) {
    discount = await db.selectFrom('discount_codes').selectAll()
      .where('code', '=', parsed.data.discountCode.toUpperCase()).where('status', '=', 'active').executeTakeFirst();
    if (!discount) return jsonError(res, 400, 'کد تخفیف پیدا نشد یا متوقف شده است.');
    if (discount.starts_at && discount.starts_at > now()) return jsonError(res, 400, 'زمان استفاده از این کد هنوز شروع نشده است.');
    if (discount.ends_at && discount.ends_at < now()) return jsonError(res, 400, 'مهلت استفاده از این کد به پایان رسیده است.');
    if (discount.usage_limit && discount.used_count >= discount.usage_limit) return jsonError(res, 400, 'سقف استفاده کل این کد تکمیل شده است.');
    if (discount.minimum_order && subtotal < discount.minimum_order) return jsonError(res, 400, `حداقل مبلغ سفارش برای این کد ${Number(discount.minimum_order).toLocaleString('fa-IR')} ریال است.`);
    const customerUsage = Number((await db.selectFrom('discount_usages').select(({ fn }) => fn.countAll().as('count'))
      .where('discount_id', '=', discount.id).where('user_id', '=', req.user.id).where('status', '=', 'used').executeTakeFirst())?.count || 0);
    if (discount.per_customer_limit && customerUsage >= discount.per_customer_limit) return jsonError(res, 400, 'سقف استفاده این کد برای حساب شما تکمیل شده است.');
    if (discount.single_use && customerUsage > 0) return jsonError(res, 400, 'این کد فقط یک‌بار قابل‌استفاده است.');
    if (discount.first_purchase_only) {
      const previousOrder = await db.selectFrom('orders').select('id').where('user_id', '=', req.user.id)
        .where('payment_status', '=', 'paid').executeTakeFirst();
      if (previousOrder) return jsonError(res, 400, 'این کد فقط برای اولین خرید قابل‌استفاده است.');
    }
    const allowedCustomers = parseJson(discount.customer_ids, []);
    if (allowedCustomers.length && !allowedCustomers.includes(req.user.id)) return jsonError(res, 400, 'این کد برای حساب شما تعریف نشده است.');
    const allowedProducts = parseJson(discount.product_ids, []);
    if (allowedProducts.length && !items.some(item => allowedProducts.includes(item.productId))) return jsonError(res, 400, 'این کد برای محصولات سبد شما قابل‌استفاده نیست.');
    const allowedCategories = parseJson(discount.category_ids, []);
    if (allowedCategories.length && !items.some(item => allowedCategories.includes(item.product.category_id) || allowedCategories.includes(item.product.category))) {
      return jsonError(res, 400, 'این کد برای دسته محصولات سبد شما قابل‌استفاده نیست.');
    }
    discountTotal = discount.type === 'percent'
      ? Math.round(subtotal * Math.min(100, discount.value) / 100)
      : Math.min(subtotal, discount.value);
    if (discount.maximum_discount) discountTotal = Math.min(discountTotal, discount.maximum_discount);
  }
  const shipping = serviceOnly || subtotal >= 250_000_000 ? 0 : 850_000;
  const total = Math.max(0, subtotal + taxTotal + shipping - discountTotal);
  const createdAt = now();
  const reservationExpiresAt = later(Number(process.env.INVENTORY_RESERVATION_MINUTES || 30));
  await db.transaction().execute(async trx => {
    await trx.insertInto('orders').values({
      id, order_no: number, user_id: req.user.id, address_id: parsed.data.addressId || null,
      address_snapshot: address ? JSON.stringify(address) : null, status: serviceOnly ? 'reviewing' : 'awaiting_payment',
      payment_status: 'pending', subtotal, discount_total: discountTotal, tax_total: taxTotal,
      shipping, total, channel: 'website', notes: parsed.data.notes || null,
      customer_note: parsed.data.notes || null, idempotency_key: parsed.data.clientOrderId || null,
      reservation_expires_at: reservationExpiresAt, created_at: createdAt, updated_at: createdAt,
    }).execute();
    await trx.insertInto('order_items').values(items.map(item => ({
      id: uuid(), order_id: id, product_id: item.productId, variant_id: item.variant?.id || null,
      product_name: item.name, sku_snapshot: item.variant?.sku || item.product.sku,
      quantity: item.quantity, unit_price: item.unitPrice, cost_snapshot: item.unitCost,
      tax_snapshot: item.taxRate, discount_snapshot: 0, line_total: item.lineTotal,
    }))).execute();
    for (const item of items.filter(row => row.product.product_type === 'physical')) {
      const changed = item.variant
        ? await trx.updateTable('product_variants')
          .set({ reserved_stock: sql`reserved_stock + ${item.quantity}`, updated_at: createdAt })
          .where('id', '=', item.variant.id)
          .where(sql`stock - reserved_stock`, '>=', item.quantity).executeTakeFirst()
        : await trx.updateTable('products')
          .set({ reserved_stock: sql`reserved_stock + ${item.quantity}`, updated_at: createdAt })
          .where('id', '=', item.productId)
          .where(sql`stock - reserved_stock`, '>=', item.quantity).executeTakeFirst();
      if (Number(changed.numUpdatedRows || 0) !== 1) throw Object.assign(
        new Error(`موجودی «${item.name}» هم‌زمان تغییر کرده است؛ سبد را تازه‌سازی کنید.`), { status: 409 },
      );
      await trx.insertInto('inventory_reservations').values({
        id: uuid(), order_id: id, product_id: item.productId, variant_id: item.variant?.id || null,
        quantity: item.quantity, status: 'active', expires_at: reservationExpiresAt,
        released_at: null, created_at: createdAt,
      }).execute();
    }
    if (discount) {
      const customerLimit = discount.single_use ? 1 : Number(discount.per_customer_limit || 2147483647);
      await trx.insertInto('discount_customer_counters').values({
        discount_id: discount.id, user_id: req.user.id, used_count: 0, updated_at: createdAt,
      }).onConflict(conflict => conflict.columns(['discount_id', 'user_id']).doNothing()).execute();
      const customerChanged = await trx.updateTable('discount_customer_counters')
        .set({ used_count: sql`used_count + 1`, updated_at: createdAt })
        .where('discount_id', '=', discount.id).where('user_id', '=', req.user.id)
        .where('used_count', '<', customerLimit).executeTakeFirst();
      if (Number(customerChanged.numUpdatedRows || 0) !== 1) throw Object.assign(new Error('سقف استفاده این کد برای حساب شما هم‌زمان تکمیل شد.'), { status: 409 });
      let update = trx.updateTable('discount_codes').set({ used_count: sql`used_count + 1` }).where('id', '=', discount.id);
      if (discount.usage_limit) update = update.where('used_count', '<', discount.usage_limit);
      const changed = await update.executeTakeFirst();
      if (Number(changed.numUpdatedRows || 0) !== 1) throw Object.assign(new Error('سقف استفاده کد تخفیف هم‌زمان تکمیل شد.'), { status: 409 });
      await trx.insertInto('discount_usages').values({
        id: uuid(), discount_id: discount.id, order_id: id, user_id: req.user.id,
        amount: discountTotal, status: 'used', created_at: createdAt,
      }).execute();
    }
    await trx.insertInto('order_status_history').values({
      id: uuid(), order_id: id, from_status: null, to_status: serviceOnly ? 'reviewing' : 'awaiting_payment',
      note: serviceOnly ? 'ثبت درخواست خدمت توسط مشتری' : 'ثبت سفارش توسط مشتری', changed_by: req.user.id, created_at: createdAt,
    }).execute();
    await trx.insertInto('notifications').values({ id: uuid(), user_id: req.user.id, title: serviceOnly ? 'درخواست خدمت ثبت شد' : 'سفارش ثبت شد', body: serviceOnly ? `درخواست ${number} ثبت شد و در انتظار بررسی کارشناسی است.` : `سفارش ${number} ثبت شد و در انتظار پرداخت است.`, read_at: null, created_at: createdAt }).execute();
    await trx.deleteFrom('customer_cart_items').where('user_id', '=', req.user.id).execute();
  });
  await audit(req, 'order_created', 'order', id);
  res.status(201).json({ id, orderNo: number, total, subtotal, taxTotal, discountTotal, reservationExpiresAt });
}));

app.post('/api/payments/prepare', auth, asyncRoute(async (req, res) => {
  await expireReservations();
  const order = await db.selectFrom('orders').selectAll().where('id', '=', req.body?.orderId).where('user_id', '=', req.user.id).executeTakeFirst();
  if (!order) return jsonError(res, 404, 'سفارش پیدا نشد.');
  if (!['awaiting_payment', 'paid'].includes(order.status)) return jsonError(res, 409, 'این سفارش در وضعیت قابل پرداخت نیست.');
  if (order.payment_status === 'paid') return jsonError(res, 409, 'این سفارش قبلاً پرداخت شده است.');
  if (order.reservation_expires_at && order.reservation_expires_at < now()) return jsonError(res, 409, 'مهلت پرداخت این سفارش به پایان رسیده است.');
  const existing = await db.selectFrom('payments').selectAll().where('order_id', '=', order.id)
    .where('status', 'in', ['redirect_ready', 'gateway_disabled']).orderBy('created_at', 'desc').executeTakeFirst();
  if (existing) return res.json({
    id: existing.id, amount: order.total, orderNo: order.order_no,
    gatewayActive: existing.status === 'redirect_ready', gatewayUrl: existing.gateway_url,
    reused: true, message: 'درخواست پرداخت فعال قبلی بازیابی شد.',
  });
  const payment = await preparePayment({ amount: order.total, description: `پرداخت سفارش ${order.order_no}`, mobile: req.user.mobile, orderId: order.id });
  const id = uuid();
  await db.insertInto('payments').values({ id, user_id: req.user.id, order_id: order.id, amount: order.total, provider: payment.provider, status: payment.active ? 'redirect_ready' : 'gateway_disabled', authority: payment.authority, gateway_url: payment.gatewayUrl, created_at: now() }).execute();
  await audit(req, 'payment_prepared', 'payment', id);
  res.json({
    id, amount: order.total, orderNo: order.order_no,
    gatewayActive: payment.active, gatewayUrl: payment.gatewayUrl,
    message: payment.active ? 'درخواست پرداخت آماده است.' : 'تا مرحله اتصال به درگاه آماده شد؛ در نسخه آفلاین ورود به درگاه غیرفعال است.',
  });
}));

app.get('/api/orders/:id/payment-status', auth, asyncRoute(async (req, res) => {
  const order = await db.selectFrom('orders').selectAll().where('id', '=', req.params.id)
    .where('user_id', '=', req.user.id).executeTakeFirst();
  if (!order) return jsonError(res, 404, 'سفارش پیدا نشد.');
  const payment = await db.selectFrom('payments').selectAll().where('order_id', '=', order.id)
    .where('user_id', '=', req.user.id).orderBy('created_at', 'desc').executeTakeFirst();
  res.json({
    orderId: order.id, orderNo: order.order_no, orderStatus: order.status,
    paymentStatus: order.payment_status || payment?.status || 'pending',
    reservationExpiresAt: order.reservation_expires_at,
    payment: payment ? {
      id: payment.id, status: payment.status, provider: payment.provider,
      transactionId: payment.transaction_id, failureReason: payment.failure_reason,
      amount: payment.amount, paidAt: payment.paid_at, createdAt: payment.created_at,
    } : null,
  });
}));

app.get('/api/payments/callback', asyncRoute(async (req, res) => {
  const authority = String(req.query.Authority || req.query.authority || '');
  const status = String(req.query.Status || req.query.status || '').toUpperCase();
  const payment = await db.selectFrom('payments').selectAll().where('authority', '=', authority).executeTakeFirst();
  if (!authority || !payment) return jsonError(res, 400, 'Callback پرداخت معتبر نیست.');
  if (status !== 'OK') {
    await db.updateTable('payments').set({ status: 'failed', failure_reason: 'لغو یا رد در درگاه', updated_at: now() })
      .where('id', '=', payment.id).where('status', 'not in', ['paid', 'processing']).execute();
    return res.redirect(`${process.env.CUSTOMER_PAYMENT_RESULT_URL || '/customer.html#/payment/result'}?status=failed`);
  }
  try {
    const verified = await verifyPayment({ authority, amount: payment.amount });
    const result = await finalizeSuccessfulPayment({ paymentId: payment.id, transactionId: verified.transactionId });
    return res.redirect(`${process.env.CUSTOMER_PAYMENT_RESULT_URL || '/customer.html#/payment/result'}?status=success&order=${encodeURIComponent(result.order.id)}`);
  } catch (error) {
    await db.updateTable('payments').set({
      status: 'unknown', reconciliation_status: 'required',
      failure_reason: 'تأیید قطعی درگاه نیازمند تطبیق مجدد است.', updated_at: now(),
    }).where('id', '=', payment.id).where('status', 'not in', ['paid', 'processing']).execute();
    return res.redirect(`${process.env.CUSTOMER_PAYMENT_RESULT_URL || '/customer.html#/payment/result'}?status=failed`);
  }
}));

app.post('/api/sales/payments/:id/confirm-offline', auth, salesOnly, requireSalesPermission('orders.manage'), asyncRoute(async (req, res) => {
  if ((process.env.PAYMENT_PROVIDER || 'disabled') !== 'disabled') {
    return jsonError(res, 403, 'ثبت پرداخت آفلاین فقط در حالت درگاه غیرفعال مجاز است.');
  }
  const parsed = z.object({ reference: z.string().trim().min(3).max(100) }).safeParse(req.body);
  if (!parsed.success) return jsonError(res, 400, 'شناسه رسید آفلاین را وارد کنید.');
  const result = await finalizeSuccessfulPayment({
    paymentId: req.params.id, transactionId: `OFFLINE-${parsed.data.reference}`, actorId: req.user.id,
  });
  await audit(req, 'offline_payment_confirmed', 'payment', req.params.id, { orderId: result.order.id });
  res.json({ ok: true, orderId: result.order.id, alreadyProcessed: result.alreadyProcessed });
}));

app.get('/api/consultations', auth, asyncRoute(async (req, res) => {
  res.json(await db.selectFrom('consultations').selectAll().where('user_id', '=', req.user.id).orderBy('created_at', 'desc').execute());
}));
app.post('/api/consultations', auth, asyncRoute(async (req, res) => {
  const parsed = z.object({ subject: z.string().min(3), description: z.string().min(10) }).safeParse(req.body);
  if (!parsed.success) return jsonError(res, 400, 'موضوع و شرح درخواست را کامل کنید.', parsed.error.flatten().fieldErrors);
  const id = uuid();
  await db.insertInto('consultations').values({ id, user_id: req.user.id, ...parsed.data, status: 'new', created_at: now() }).execute();
  await audit(req, 'consultation_created', 'consultation', id);
  res.status(201).json({ id });
}));

app.get('/api/quotes', auth, asyncRoute(async (req, res) => {
  res.json(await db.selectFrom('quotes').selectAll().where('user_id', '=', req.user.id).orderBy('created_at', 'desc').execute());
}));
app.get('/api/projects', auth, asyncRoute(async (req, res) => {
  res.json(await db.selectFrom('projects').selectAll().where('user_id', '=', req.user.id).orderBy('created_at', 'desc').execute());
}));
app.get('/api/payments', auth, asyncRoute(async (req, res) => {
  res.json(await db.selectFrom('payments').selectAll().where('user_id', '=', req.user.id).orderBy('created_at', 'desc').execute());
}));

// The pre-v5 support API is intentionally retired. Keeping those handlers alive
// bypassed message visibility, idempotency, state-machine and abuse controls.
// Clients must use /api/support/tickets and its nested routes.
app.all('/api/support', auth, (_req, res) => jsonError(res, 410, 'این مسیر قدیمی حذف شده است؛ نسخه جدید گفتگو را باز کنید.'));
app.all('/api/support/:id/messages', auth, (_req, res) => jsonError(res, 410, 'این مسیر قدیمی حذف شده است؛ نسخه جدید گفتگو را باز کنید.'));

app.post('/api/notifications/read-all', auth, asyncRoute(async (req, res) => {
  await db.updateTable('notifications').set({ read_at: now() }).where('user_id', '=', req.user.id).where('read_at', 'is', null).execute();
  res.json({ ok: true });
}));
app.get('/api/notifications', auth, asyncRoute(async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 30)));
  res.json(await db.selectFrom('notifications').selectAll().where('user_id', '=', req.user.id)
    .orderBy('created_at', 'desc').limit(limit).execute());
}));
app.patch('/api/notifications/:id/read', auth, asyncRoute(async (req, res) => {
  const result = await db.updateTable('notifications').set({ read_at: now() })
    .where('id', '=', req.params.id).where('user_id', '=', req.user.id).executeTakeFirst();
  if (!Number(result.numUpdatedRows || 0)) return jsonError(res, 404, 'اعلان پیدا نشد.');
  res.json({ ok: true });
}));

app.get('/api/admin/summary', auth, adminOnly, asyncRoute(async (_req, res) => {
  const [users, orders, consultations, tickets, revenue, customerRows] = await Promise.all([
    db.selectFrom('users').select(({ fn }) => fn.countAll().as('count')).executeTakeFirst(),
    db.selectFrom('orders').select(({ fn }) => fn.countAll().as('count')).executeTakeFirst(),
    db.selectFrom('consultations').select(({ fn }) => fn.countAll().as('count')).executeTakeFirst(),
    db.selectFrom('support_tickets').select(({ fn }) => fn.countAll().as('count')).executeTakeFirst(),
    db.selectFrom('orders').select(({ fn }) => fn.sum('total').as('total')).executeTakeFirst(),
    db.selectFrom('users').leftJoin('profiles', 'profiles.user_id', 'users.id')
      .leftJoin('portal_credentials', 'portal_credentials.user_id', 'users.id')
      .selectAll('profiles').select('portal_credentials.username')
      .where('users.role', '=', 'customer').execute(),
  ]);
  const completions = customerRows.map(row => profileCompletion(row, row.username));
  res.json({
    users: Number(users.count), orders: Number(orders.count),
    consultations: Number(consultations.count), tickets: Number(tickets.count),
    orderValue: Number(revenue.total || 0),
    profiles: {
      complete: completions.filter(item => item.status === 'complete').length,
      incomplete: completions.filter(item => item.status === 'incomplete').length,
      critical: completions.filter(item => item.status === 'critical').length,
    },
  });
}));
app.get('/api/admin/orders', auth, adminOnly, asyncRoute(async (_req, res) => {
  res.json(await db.selectFrom('orders').innerJoin('users', 'users.id', 'orders.user_id').leftJoin('profiles', 'profiles.user_id', 'users.id').select(['orders.id', 'orders.order_no', 'orders.status', 'orders.total', 'orders.created_at', 'users.mobile', 'profiles.full_name']).orderBy('orders.created_at', 'desc').limit(100).execute());
}));
app.patch('/api/admin/orders/:id', auth, adminOnly, asyncRoute(async (req, res) => {
  const parsed = z.object({
    status: z.enum(['awaiting_payment', 'paid', 'reviewing', 'confirmed', 'preparing', 'ready_to_ship', 'shipped', 'delivered', 'cancelled', 'return_requested', 'returned', 'refund_requested', 'refunded', 'processing']),
    note: z.string().max(500).optional(),
  }).safeParse(req.body);
  if (!parsed.success) return jsonError(res, 400, 'وضعیت سفارش معتبر نیست.');
  const order = await db.selectFrom('orders').selectAll().where('id', '=', req.params.id).executeTakeFirst();
  if (!order) return jsonError(res, 404, 'سفارش پیدا نشد.');
  await changeOrderStatus(req, order, parsed.data.status, parsed.data.note);
  res.json({ ok: true });
}));
app.get('/api/admin/consultations', auth, adminOnly, asyncRoute(async (_req, res) => {
  res.json(await db.selectFrom('consultations').innerJoin('users', 'users.id', 'consultations.user_id').leftJoin('profiles', 'profiles.user_id', 'users.id').select(['consultations.id', 'consultations.subject', 'consultations.status', 'consultations.created_at', 'users.mobile', 'profiles.full_name']).orderBy('consultations.created_at', 'desc').limit(100).execute());
}));
app.patch('/api/admin/consultations/:id', auth, adminOnly, asyncRoute(async (req, res) => {
  const parsed = z.object({ status: z.enum(['new', 'reviewing', 'answered', 'closed']) }).safeParse(req.body);
  if (!parsed.success) return jsonError(res, 400, 'وضعیت درخواست معتبر نیست.');
  const item = await db.selectFrom('consultations').select(['id', 'user_id', 'subject']).where('id', '=', req.params.id).executeTakeFirst();
  if (!item) return jsonError(res, 404, 'درخواست پیدا نشد.');
  await db.transaction().execute(async trx => {
    await trx.updateTable('consultations').set({ status: parsed.data.status }).where('id', '=', item.id).execute();
    await trx.insertInto('notifications').values({ id: uuid(), user_id: item.user_id, title: 'وضعیت مشاوره به‌روزرسانی شد', body: `${item.subject}: ${parsed.data.status}`, read_at: null, created_at: now() }).execute();
  });
  res.json({ ok: true });
}));
app.get('/api/admin/customers', auth, adminOnly, asyncRoute(async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(10, Number(req.query.limit || 50)));
  const status = String(req.query.status || '');
  const query = String(req.query.q || '').trim();
  let builder = db.selectFrom('users').leftJoin('profiles', 'profiles.user_id', 'users.id')
    .leftJoin('portal_credentials', 'portal_credentials.user_id', 'users.id')
    .select([
      'users.id', 'users.mobile', 'users.status', 'users.created_at',
      'profiles.full_name', 'profiles.first_name', 'profiles.last_name', 'profiles.display_name',
      'profiles.email', 'profiles.company', 'profiles.account_type', 'profiles.national_id',
      'profiles.company_national_id', 'profiles.mobile_verified_at', 'portal_credentials.username',
    ]).where('users.role', '=', 'customer');
  if (status) builder = builder.where('users.status', '=', status);
  const rows = await builder.orderBy('users.created_at', 'desc').limit(limit).offset((page - 1) * limit).execute();
  const filtered = query
    ? rows.filter(row => `${row.full_name || ''} ${row.mobile} ${row.email || ''} ${row.company || ''}`.includes(query))
    : rows;
  res.json(filtered.map(row => ({ ...row, profileCompletion: profileCompletion(row, row.username) })));
}));
app.patch('/api/admin/customers/:id', auth, adminOnly, asyncRoute(async (req, res) => {
  const parsed = z.object({
    status: z.enum(['active', 'suspended', 'blocked', 'pending']).optional(),
    full_name: z.string().trim().min(2).max(100).optional(),
    email: z.union([z.string().email(), z.literal('')]).optional(),
    reason: z.string().trim().min(5).max(500),
  }).safeParse(req.body);
  if (!parsed.success) return jsonError(res, 400, 'اطلاعات تغییر مشتری و دلیل آن را کامل کنید.');
  const customer = await db.selectFrom('users').selectAll().where('id', '=', req.params.id).where('role', '=', 'customer').executeTakeFirst();
  if (!customer) return jsonError(res, 404, 'مشتری پیدا نشد.');
  await db.transaction().execute(async trx => {
    if (parsed.data.status) await trx.updateTable('users').set({ status: parsed.data.status }).where('id', '=', customer.id).execute();
    const profileChanges = {};
    if (parsed.data.full_name !== undefined) profileChanges.full_name = parsed.data.full_name;
    if (parsed.data.email !== undefined) profileChanges.email = parsed.data.email.toLowerCase();
    if (Object.keys(profileChanges).length) {
      profileChanges.updated_at = now();
      await trx.updateTable('profiles').set(profileChanges).where('user_id', '=', customer.id).execute();
    }
    if (parsed.data.status && parsed.data.status !== 'active') {
      await trx.deleteFrom('sessions').where('user_id', '=', customer.id).execute();
    }
  });
  await audit(req, 'customer_updated_by_admin', 'user', customer.id, {
    reason: parsed.data.reason, fields: Object.keys(parsed.data).filter(key => key !== 'reason'),
  });
  res.json({ ok: true });
}));
app.get('/api/admin/audit-log', auth, adminOnly, asyncRoute(async (req, res) => {
  const limit = Math.min(200, Math.max(10, Number(req.query.limit || 100)));
  res.json(await db.selectFrom('audit_events')
    .leftJoin('profiles', 'profiles.user_id', 'audit_events.user_id')
    .select([
      'audit_events.id', 'audit_events.user_id', 'audit_events.action',
      'audit_events.entity_type', 'audit_events.entity_id', 'audit_events.ip',
      'audit_events.metadata', 'audit_events.created_at', 'profiles.full_name',
    ]).orderBy('audit_events.created_at', 'desc').limit(limit).execute());
}));
app.post('/api/admin/quotes', auth, adminOnly, asyncRoute(async (req, res) => {
  const parsed = z.object({ userId: z.string(), title: z.string().min(3), amount: z.number().int().min(0), validUntil: z.string().optional() }).safeParse(req.body);
  if (!parsed.success) return jsonError(res, 400, 'اطلاعات پیش‌فاکتور معتبر نیست.', parsed.error.flatten().fieldErrors);
  const customer = await db.selectFrom('users').select('id').where('id', '=', parsed.data.userId).where('role', '=', 'customer').executeTakeFirst();
  if (!customer) return jsonError(res, 404, 'مشتری پیدا نشد.');
  const id = uuid(); const number = orderNo('QT');
  await db.transaction().execute(async trx => {
    await trx.insertInto('quotes').values({ id, user_id: customer.id, quote_no: number, title: parsed.data.title, amount: parsed.data.amount, status: 'approved', valid_until: parsed.data.validUntil || null, created_at: now() }).execute();
    await trx.insertInto('notifications').values({ id: uuid(), user_id: customer.id, title: 'پیش‌فاکتور جدید', body: `پیش‌فاکتور ${number} برای شما صادر شد.`, read_at: null, created_at: now() }).execute();
  });
  await audit(req, 'quote_created', 'quote', id);
  res.status(201).json({ id, quoteNo: number });
}));
app.post('/api/admin/projects', auth, adminOnly, asyncRoute(async (req, res) => {
  const parsed = z.object({ userId: z.string(), title: z.string().min(3) }).safeParse(req.body);
  if (!parsed.success) return jsonError(res, 400, 'اطلاعات پروژه معتبر نیست.');
  const customer = await db.selectFrom('users').select('id').where('id', '=', parsed.data.userId).where('role', '=', 'customer').executeTakeFirst();
  if (!customer) return jsonError(res, 404, 'مشتری پیدا نشد.');
  const id = uuid();
  await db.transaction().execute(async trx => {
    await trx.insertInto('projects').values({ id, user_id: parsed.data.userId, title: parsed.data.title, status: 'planning', progress: 0, created_at: now() }).execute();
    await trx.insertInto('notifications').values({ id: uuid(), user_id: parsed.data.userId, title: 'پروژه جدید', body: `پروژه «${parsed.data.title}» به حساب شما افزوده شد.`, read_at: null, created_at: now() }).execute();
  });
  res.status(201).json({ id });
}));
app.get('/api/admin/support-agents', auth, adminOnly, asyncRoute(async (_req, res) => {
  const rows = await db.selectFrom('admin_members')
    .innerJoin('users', 'users.id', 'admin_members.user_id')
    .leftJoin('profiles', 'profiles.user_id', 'users.id')
    .leftJoin('portal_credentials', 'portal_credentials.user_id', 'users.id')
    .select([
      'users.id', 'users.mobile', 'users.status', 'users.created_at',
      'profiles.full_name', 'profiles.email', 'profiles.job_title', 'profiles.avatar_url', 'admin_members.permissions',
      'portal_credentials.username',
    ])
    .where('admin_members.section', '=', 'support')
    .orderBy('users.created_at', 'desc').execute();
  const [workloads, memberships, agentProfiles, skillRows, teams] = await Promise.all([
    db.selectFrom('support_assignments').innerJoin('support_tickets', 'support_tickets.id', 'support_assignments.ticket_id')
      .select(['support_assignments.agent_id', 'support_tickets.status']).execute(),
    db.selectFrom('support_team_members').innerJoin('support_teams', 'support_teams.id', 'support_team_members.team_id')
      .select(['support_team_members.agent_id', 'support_team_members.team_id', 'support_team_members.is_primary', 'support_teams.name']).execute(),
    db.selectFrom('support_agent_profiles').selectAll().execute(),
    db.selectFrom('support_agent_skills').innerJoin('support_skills', 'support_skills.id', 'support_agent_skills.skill_id')
      .select(['support_agent_skills.agent_id', 'support_agent_skills.skill_id', 'support_agent_skills.level', 'support_skills.name', 'support_skills.slug']).execute(),
    db.selectFrom('support_teams').selectAll().where('status', '=', 'active').orderBy('name').execute(),
  ]);
  res.json(rows.map(row => ({
    ...row,
    permissions: readPermissions(row.permissions),
    assigned: workloads.filter(item => item.agent_id === row.id).length,
    open: workloads.filter(item => item.agent_id === row.id && !['resolved', 'closed'].includes(item.status)).length,
    teams: memberships.filter(item => item.agent_id === row.id),
    primaryTeamId: memberships.find(item => item.agent_id === row.id && Number(item.is_primary))?.team_id || null,
    supportProfile: agentProfiles.find(item => item.agent_id === row.id) || null,
    skills: skillRows.filter(item => item.agent_id === row.id),
  })).map((item, _index, all) => ({ ...item, availableTeams: teams, agentsCount: all.length })));
}));

app.post('/api/admin/support-agents', auth, adminOnly, asyncRoute(async (req, res) => {
  const parsed = z.object({
    mobile: z.string(), fullName: z.string().trim().min(2).max(100),
    username: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9._-]{3,39}$/),
    temporaryPassword: z.string().min(10).max(128),
    jobTitle: z.string().trim().min(2).max(100),
    avatarUrl: z.string().trim().max(500).nullable().optional(),
    topicIds: z.array(z.enum(SUPPORT_TOPIC_IDS)).min(1).max(SUPPORT_TOPIC_IDS.length),
    teamIds: z.array(z.string()).max(20).optional().default([]),
    primaryTeamId: z.string().optional().default(''),
    languages: z.array(z.string().trim().min(2).max(10)).min(1).max(10).default(['fa']),
    workingHours: z.record(z.string(), z.array(z.tuple([z.string(), z.string()]))).default({}),
    timezone: z.string().min(3).max(80).default('Asia/Tehran'),
    capacity: z.number().int().min(1).max(8).default(8),
    seniority: z.enum(['junior', 'mid', 'senior', 'lead']).default('mid'),
    permissions: z.record(z.string(), z.boolean()),
  }).safeParse(req.body);
  if (!parsed.success || !passwordIsStrong(parsed.data?.temporaryPassword)) return jsonError(res, 400, 'رمز موقت باید شامل حروف بزرگ، کوچک، عدد و نماد باشد.', parsed.error?.flatten().fieldErrors);
  if (new Set(parsed.data.topicIds).size !== parsed.data.topicIds.length) return jsonError(res, 400, 'موضوعات تخصصی تکراری هستند.');
  const unknownPermissions = Object.keys(parsed.data.permissions).filter(key => !SUPPORT_PERMISSION_KEYS.includes(key));
  if (unknownPermissions.length) return jsonError(res, 400, 'یک یا چند مجوز پشتیبانی معتبر نیست.');
  const mobile = normalizeMobile(parsed.data.mobile);
  if (!/^09\d{9}$/.test(mobile)) return jsonError(res, 400, 'شماره همراه پشتیبان معتبر نیست.');
  let user = await db.selectFrom('users').selectAll().where('mobile', '=', mobile).executeTakeFirst();
  if (user && ['admin', 'super_admin'].includes(user.role)) return jsonError(res, 409, 'این شماره متعلق به مدیر اصلی است.');
  const userId = user?.id || uuid();
  await db.transaction().execute(async trx => {
    if (!user) {
      await trx.insertInto('users').values({ id: userId, mobile, role: 'support_agent', status: 'active', created_at: now() }).execute();
      await trx.insertInto('profiles').values({ user_id: userId, full_name: parsed.data.fullName, email: null, national_id: null, company: 'راهکار', job_title: parsed.data.jobTitle, avatar_url: parsed.data.avatarUrl || null, updated_at: now() }).execute();
    } else {
      await trx.updateTable('users').set({ role: 'support_agent', status: 'active', token_version: sql`COALESCE(token_version, 0) + 1` }).where('id', '=', userId).execute();
      await trx.deleteFrom('sessions').where('user_id', '=', userId).execute();
      await trx.updateTable('profiles').set({ full_name: parsed.data.fullName, job_title: parsed.data.jobTitle, avatar_url: parsed.data.avatarUrl || null, updated_at: now() }).where('user_id', '=', userId).execute();
    }
    await trx.insertInto('admin_members').values({
      user_id: userId, section: 'support', permissions: JSON.stringify(parsed.data.permissions),
      created_by: req.user.id, updated_at: now(),
    }).onConflict(oc => oc.column('user_id').doUpdateSet({
      section: 'support', permissions: JSON.stringify(parsed.data.permissions),
      created_by: req.user.id, updated_at: now(),
    })).execute();
    await trx.insertInto('portal_credentials').values({
      user_id: userId,
      username: parsed.data.username,
      password_hash: passwordHash(parsed.data.temporaryPassword),
      must_change: 1,
      temporary_expires_at: later(24 * 60),
      updated_at: now(),
    }).onConflict(oc => oc.column('user_id').doUpdateSet({
      username: parsed.data.username,
      password_hash: passwordHash(parsed.data.temporaryPassword),
      must_change: 1,
      temporary_expires_at: later(24 * 60),
      updated_at: now(),
      })).execute();
    await trx.insertInto('support_agent_profiles').values({
      agent_id: userId, avatar_url: parsed.data.avatarUrl || null, title: parsed.data.jobTitle,
      languages: JSON.stringify(parsed.data.languages), seniority: parsed.data.seniority,
      timezone: parsed.data.timezone, working_hours: JSON.stringify(parsed.data.workingHours),
      capacity: parsed.data.capacity, presence_status: 'offline', last_heartbeat_at: null,
      last_seen_at: null, created_at: now(), updated_at: now(),
    }).onConflict(oc => oc.column('agent_id').doUpdateSet({
      avatar_url: parsed.data.avatarUrl || null, title: parsed.data.jobTitle,
      languages: JSON.stringify(parsed.data.languages), seniority: parsed.data.seniority,
      timezone: parsed.data.timezone, working_hours: JSON.stringify(parsed.data.workingHours),
      capacity: parsed.data.capacity, updated_at: now(),
    })).execute();
    await trx.deleteFrom('support_team_members').where('agent_id', '=', userId).execute();
    await trx.deleteFrom('support_agent_skills').where('agent_id', '=', userId).execute();
    for (const topicId of parsed.data.topicIds) await trx.insertInto('support_agent_skills').values({
      agent_id: userId, skill_id: `support-topic-${topicId}`, level: 5, created_at: now(),
    }).execute();
  });
  await audit(req, 'support_agent_saved', 'user', userId);
  await requestSupportRebalance();
  let smsSent = false;
  let smsWarning = null;
  try {
    const delivery = await sendAdminWelcome({
      mobile, username: parsed.data.username,
      temporaryPassword: parsed.data.temporaryPassword, portal: 'support',
    });
    smsSent = Boolean(delivery.delivered);
    if (!smsSent) smsWarning = 'حساب ساخته شد، اما سرویس پیامک در این محیط غیرفعال است.';
    await audit(req, smsSent ? 'support_agent_welcome_sms_sent' : 'support_agent_welcome_sms_skipped', 'user', userId);
  } catch (error) {
    console.error('Support welcome SMS failed:', error.message);
    smsWarning = 'حساب ساخته شد، اما ارسال پیامک ورود اول ناموفق بود؛ تنظیمات پیامک را بررسی و رمز موقت را دوباره تعیین کنید.';
    await audit(req, 'support_agent_welcome_sms_failed', 'user', userId, { providerStatus: error.providerStatus || null });
  }
  res.status(201).json({ id: userId, smsSent, smsWarning });
}));

app.patch('/api/admin/support-agents/:id', auth, adminOnly, asyncRoute(async (req, res) => {
  const parsed = z.object({
    status: z.enum(['active', 'suspended', 'retired']).optional(),
    username: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9._-]{3,39}$/).optional(),
    password: z.string().min(10).max(128).optional(),
    fullName: z.string().trim().min(2).max(100).optional(),
    jobTitle: z.string().trim().min(2).max(100).optional(),
    avatarUrl: z.string().trim().max(500).nullable().optional(),
    topicIds: z.array(z.enum(SUPPORT_TOPIC_IDS)).min(1).max(SUPPORT_TOPIC_IDS.length).optional(),
    languages: z.array(z.string().trim().min(2).max(10)).min(1).max(10).optional(),
    workingHours: z.record(z.string(), z.array(z.tuple([z.string(), z.string()]))).optional(),
    timezone: z.string().min(3).max(80).optional(),
    capacity: z.number().int().min(1).max(8).optional(),
    seniority: z.enum(['junior', 'mid', 'senior', 'lead']).optional(),
    permissions: z.record(z.string(), z.boolean()).optional(),
  }).safeParse(req.body);
  if (!parsed.success || (parsed.data?.password && !passwordIsStrong(parsed.data.password))) return jsonError(res, 400, 'تنظیمات پشتیبان یا قدرت رمز معتبر نیست.');
  const member = await db.selectFrom('admin_members').selectAll().where('user_id', '=', req.params.id).where('section', '=', 'support').executeTakeFirst();
  if (!member) return jsonError(res, 404, 'پشتیبان پیدا نشد.');
  if (parsed.data.permissions && Object.keys(parsed.data.permissions).some(key => !SUPPORT_PERMISSION_KEYS.includes(key))) return jsonError(res, 400, 'یک یا چند مجوز پشتیبانی معتبر نیست.');
  if (parsed.data.topicIds && new Set(parsed.data.topicIds).size !== parsed.data.topicIds.length) return jsonError(res, 400, 'موضوعات تخصصی تکراری هستند.');
  await db.transaction().execute(async trx => {
    if (parsed.data.status) {
      await trx.updateTable('users').set({ status: parsed.data.status, token_version: sql`COALESCE(token_version, 0) + 1` }).where('id', '=', req.params.id).execute();
      await trx.deleteFrom('sessions').where('user_id', '=', req.params.id).execute();
    }
    if (parsed.data.permissions) await trx.updateTable('admin_members').set({ permissions: JSON.stringify(parsed.data.permissions), updated_at: now() }).where('user_id', '=', req.params.id).execute();
    if (parsed.data.fullName || parsed.data.jobTitle || parsed.data.avatarUrl !== undefined) {
      const profileChanges = { updated_at: now() };
      if (parsed.data.fullName) profileChanges.full_name = parsed.data.fullName;
      if (parsed.data.jobTitle) profileChanges.job_title = parsed.data.jobTitle;
      if (parsed.data.avatarUrl !== undefined) profileChanges.avatar_url = parsed.data.avatarUrl || null;
      await trx.updateTable('profiles').set(profileChanges).where('user_id', '=', req.params.id).execute();
    }
    if (parsed.data.topicIds) {
      await trx.deleteFrom('support_agent_skills').where('agent_id', '=', req.params.id).execute();
      for (const topicId of parsed.data.topicIds) await trx.insertInto('support_agent_skills').values({
        agent_id: req.params.id, skill_id: `support-topic-${topicId}`, level: 5, created_at: now(),
      }).execute();
    }
    if (parsed.data.jobTitle || parsed.data.avatarUrl !== undefined || parsed.data.languages || parsed.data.workingHours || parsed.data.timezone || parsed.data.capacity || parsed.data.seniority) {
      const currentProfile = await trx.selectFrom('support_agent_profiles').selectAll().where('agent_id', '=', req.params.id).executeTakeFirst();
      const profileValues = {
        agent_id: req.params.id, avatar_url: parsed.data.avatarUrl ?? currentProfile?.avatar_url ?? null,
        title: parsed.data.jobTitle || currentProfile?.title || 'کارشناس پشتیبانی',
        languages: JSON.stringify(parsed.data.languages || parseJson(currentProfile?.languages, ['fa'])),
        seniority: parsed.data.seniority || currentProfile?.seniority || 'mid',
        timezone: parsed.data.timezone || currentProfile?.timezone || 'Asia/Tehran',
        working_hours: JSON.stringify(parsed.data.workingHours || parseJson(currentProfile?.working_hours, {})),
        capacity: parsed.data.capacity || currentProfile?.capacity || 8,
        presence_status: currentProfile?.presence_status || 'offline',
        last_heartbeat_at: currentProfile?.last_heartbeat_at || null, last_seen_at: currentProfile?.last_seen_at || null,
        created_at: currentProfile?.created_at || now(), updated_at: now(),
      };
      await trx.insertInto('support_agent_profiles').values(profileValues)
        .onConflict(oc => oc.column('agent_id').doUpdateSet(profileValues)).execute();
    }
    if (parsed.data.username || parsed.data.password) {
      const changes = { updated_at: now() };
      if (parsed.data.username) changes.username = parsed.data.username;
      if (parsed.data.password) {
        changes.password_hash = passwordHash(parsed.data.password);
        changes.must_change = 1;
        changes.temporary_expires_at = later(24 * 60);
      }
      try {
        await trx.updateTable('portal_credentials').set(changes).where('user_id', '=', req.params.id).execute();
      } catch {
        throw Object.assign(new Error('این نام کاربری قبلاً استفاده شده است.'), { status: 409 });
      }
      if (parsed.data.password) await trx.updateTable('users').set({ token_version: sql`COALESCE(token_version, 0) + 1` }).where('id', '=', req.params.id).execute();
      if (parsed.data.password) await trx.deleteFrom('sessions').where('user_id', '=', req.params.id).execute();
    }
  });
  await audit(req, 'support_agent_updated', 'user', req.params.id);
  await requestSupportRebalance();
  let smsSent = null;
  let smsWarning = null;
  if (parsed.data.password) {
    const recipient = await db.selectFrom('users').innerJoin('portal_credentials', 'portal_credentials.user_id', 'users.id')
      .select(['users.mobile', 'portal_credentials.username']).where('users.id', '=', req.params.id).executeTakeFirst();
    try {
      const delivery = await sendAdminWelcome({ mobile: recipient.mobile, username: recipient.username, temporaryPassword: parsed.data.password, portal: 'support' });
      smsSent = Boolean(delivery.delivered);
      if (!smsSent) smsWarning = 'رمز تغییر کرد، اما سرویس پیامک در این محیط غیرفعال است.';
      await audit(req, smsSent ? 'support_agent_credential_sms_sent' : 'support_agent_credential_sms_skipped', 'user', req.params.id);
    } catch (error) {
      console.error('Support credential SMS failed:', error.message);
      smsSent = false;
      smsWarning = 'رمز تغییر کرد، اما ارسال پیامک مشخصات جدید ناموفق بود.';
      await audit(req, 'support_agent_credential_sms_failed', 'user', req.params.id, { providerStatus: error.providerStatus || null });
    }
  }
  res.json({ ok: true, smsSent, smsWarning });
}));

app.get('/api/admin/sales-managers', auth, adminOnly, asyncRoute(async (_req, res) => {
  const rows = await db.selectFrom('admin_members')
    .innerJoin('users', 'users.id', 'admin_members.user_id')
    .leftJoin('profiles', 'profiles.user_id', 'users.id')
    .leftJoin('portal_credentials', 'portal_credentials.user_id', 'users.id')
    .select(['users.id', 'users.mobile', 'users.status', 'users.created_at', 'users.last_login_at',
      'users.last_activity_at', 'users.deleted_at', 'profiles.full_name', 'profiles.email',
      'profiles.avatar_url', 'portal_credentials.username', 'admin_members.permissions'])
    .where('admin_members.section', '=', 'sales').execute();
  res.json(rows.map(row => ({
    ...row,
    permissions: normalizeSalesPermissions(row.permissions),
    online: Boolean(row.last_activity_at && Date.now() - new Date(row.last_activity_at).getTime() < 5 * 60_000),
  })));
}));
app.post('/api/admin/sales-managers', auth, adminOnly, asyncRoute(async (req, res) => {
  const parsed = z.object({
    mobile: z.string(), fullName: z.string().trim().min(2),
    username: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9._-]{3,39}$/),
    temporaryPassword: z.string().min(10).max(128),
    permissions: z.record(z.string(), z.boolean()).optional(),
  }).safeParse(req.body);
  if (!parsed.success || !passwordIsStrong(parsed.data?.temporaryPassword)) return jsonError(res, 400, 'اطلاعات مدیر فروش یا قدرت رمز موقت کامل نیست.');
  const mobile = normalizeMobile(parsed.data.mobile);
  if (!/^09\d{9}$/.test(mobile)) return jsonError(res, 400, 'شماره همراه معتبر نیست.');
  let user = await db.selectFrom('users').selectAll().where('mobile', '=', mobile).executeTakeFirst();
  if (user && user.role === 'super_admin') return jsonError(res, 409, 'این شماره متعلق به مدیر اصلی است.');
  const userId = user?.id || uuid();
  const permissions = normalizeSalesPermissions(parsed.data.permissions || defaultSalesPermissions);
  await db.transaction().execute(async trx => {
    if (!user) {
      await trx.insertInto('users').values({ id: userId, mobile, role: 'sales_manager', status: 'active', created_at: now() }).execute();
      await trx.insertInto('profiles').values({ user_id: userId, full_name: parsed.data.fullName, email: null, national_id: null, company: 'راهکار', job_title: 'مدیر فروشگاه', updated_at: now() }).execute();
    } else {
      await trx.updateTable('users').set({ role: 'sales_manager', status: 'active', token_version: sql`COALESCE(token_version, 0) + 1` }).where('id', '=', userId).execute();
      await trx.deleteFrom('sessions').where('user_id', '=', userId).execute();
      await trx.updateTable('profiles').set({ full_name: parsed.data.fullName, job_title: 'مدیر فروشگاه', updated_at: now() }).where('user_id', '=', userId).execute();
    }
    await trx.insertInto('admin_members').values({ user_id: userId, section: 'sales', permissions: JSON.stringify(permissions), created_by: req.user.id, updated_at: now() })
      .onConflict(oc => oc.column('user_id').doUpdateSet({ section: 'sales', permissions: JSON.stringify(permissions), updated_at: now() })).execute();
    await trx.insertInto('portal_credentials').values({ user_id: userId, username: parsed.data.username, password_hash: passwordHash(parsed.data.temporaryPassword), must_change: 1, temporary_expires_at: later(24 * 60), updated_at: now() })
      .onConflict(oc => oc.column('user_id').doUpdateSet({ username: parsed.data.username, password_hash: passwordHash(parsed.data.temporaryPassword), must_change: 1, temporary_expires_at: later(24 * 60), updated_at: now() })).execute();
  });
  await audit(req, 'sales_manager_saved', 'user', userId);
  let smsSent = false;
  let smsWarning = null;
  try {
    const delivery = await sendAdminWelcome({
      mobile, username: parsed.data.username,
      temporaryPassword: parsed.data.temporaryPassword, portal: 'sales',
    });
    smsSent = Boolean(delivery.delivered);
    if (!smsSent) smsWarning = 'حساب ساخته شد، اما سرویس پیامک در این محیط غیرفعال است.';
    await audit(req, smsSent ? 'sales_manager_welcome_sms_sent' : 'sales_manager_welcome_sms_skipped', 'user', userId);
  } catch (error) {
    console.error('Sales manager welcome SMS failed:', error.message);
    smsWarning = 'حساب ساخته شد، اما ارسال پیامک ورود اول ناموفق بود؛ تنظیمات پیامک را بررسی و رمز موقت را دوباره تعیین کنید.';
    await audit(req, 'sales_manager_welcome_sms_failed', 'user', userId, { providerStatus: error.providerStatus || null });
  }
  res.status(201).json({ id: userId, smsSent, smsWarning });
}));
app.patch('/api/admin/sales-managers/:id', auth, adminOnly, asyncRoute(async (req, res) => {
  const parsed = z.object({
    status: z.enum(['active', 'suspended']).optional(),
    fullName: z.string().trim().min(2).optional(),
    email: z.string().email().nullable().optional(),
    mobile: z.string().optional(),
    username: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9._-]{3,39}$/).optional(),
    password: z.string().min(10).max(128).optional(),
    permissions: z.record(z.string(), z.boolean()).optional(),
    revokeSessions: z.boolean().optional(),
    softDelete: z.boolean().optional(),
  }).safeParse(req.body);
  if (!parsed.success || (parsed.data?.password && !passwordIsStrong(parsed.data.password))) return jsonError(res, 400, 'اطلاعات مدیر فروش یا قدرت رمز معتبر نیست.');
  const member = await db.selectFrom('admin_members').select('user_id').where('user_id', '=', req.params.id).where('section', '=', 'sales').executeTakeFirst();
  if (!member) return jsonError(res, 404, 'مدیر فروش پیدا نشد.');
  await db.transaction().execute(async trx => {
    const userChanges = {};
    if (parsed.data.status) userChanges.status = parsed.data.status;
    if (parsed.data.mobile) {
      const mobile = normalizeMobile(parsed.data.mobile);
      if (!/^09\d{9}$/.test(mobile)) throw Object.assign(new Error('شماره همراه معتبر نیست.'), { status: 400 });
      userChanges.mobile = mobile;
    }
    if (parsed.data.softDelete !== undefined) {
      userChanges.deleted_at = parsed.data.softDelete ? now() : null;
      userChanges.status = parsed.data.softDelete ? 'suspended' : 'active';
    }
    if (Object.keys(userChanges).length) await trx.updateTable('users').set(userChanges).where('id', '=', req.params.id).execute();
    if (parsed.data.fullName !== undefined || parsed.data.email !== undefined) {
      await trx.updateTable('profiles').set({
        ...(parsed.data.fullName !== undefined ? { full_name: parsed.data.fullName } : {}),
        ...(parsed.data.email !== undefined ? { email: parsed.data.email } : {}),
        updated_at: now(),
      }).where('user_id', '=', req.params.id).execute();
    }
    if (parsed.data.permissions) await trx.updateTable('admin_members').set({
      permissions: JSON.stringify(normalizeSalesPermissions(parsed.data.permissions)), updated_at: now(),
    }).where('user_id', '=', req.params.id).execute();
    const changes = { updated_at: now() };
    if (parsed.data.username) changes.username = parsed.data.username;
    if (parsed.data.password) {
      changes.password_hash = passwordHash(parsed.data.password);
      changes.must_change = 1;
      changes.temporary_expires_at = later(24 * 60);
    }
    if (parsed.data.username || parsed.data.password) await trx.updateTable('portal_credentials').set(changes).where('user_id', '=', req.params.id).execute();
    if (parsed.data.password || parsed.data.revokeSessions || parsed.data.softDelete || parsed.data.status) {
      await trx.updateTable('users').set({ token_version: sql`COALESCE(token_version, 0) + 1` }).where('id', '=', req.params.id).execute();
      await trx.deleteFrom('sessions').where('user_id', '=', req.params.id).execute();
    }
  });
  await audit(req, 'sales_manager_updated', 'user', req.params.id, {
    fields: Object.keys(parsed.data).filter(key => key !== 'password'),
  });
  let smsSent = null;
  let smsWarning = null;
  if (parsed.data.password) {
    const recipient = await db.selectFrom('users').innerJoin('portal_credentials', 'portal_credentials.user_id', 'users.id')
      .select(['users.mobile', 'portal_credentials.username']).where('users.id', '=', req.params.id).executeTakeFirst();
    try {
      const delivery = await sendAdminWelcome({ mobile: recipient.mobile, username: recipient.username, temporaryPassword: parsed.data.password, portal: 'sales' });
      smsSent = Boolean(delivery.delivered);
      if (!smsSent) smsWarning = 'رمز تغییر کرد، اما سرویس پیامک در این محیط غیرفعال است.';
      await audit(req, smsSent ? 'sales_manager_credential_sms_sent' : 'sales_manager_credential_sms_skipped', 'user', req.params.id);
    } catch (error) {
      console.error('Sales credential SMS failed:', error.message);
      smsSent = false;
      smsWarning = 'رمز تغییر کرد، اما ارسال پیامک مشخصات جدید ناموفق بود.';
      await audit(req, 'sales_manager_credential_sms_failed', 'user', req.params.id, { providerStatus: error.providerStatus || null });
    }
  }
  res.json({ ok: true, smsSent, smsWarning });
}));

app.get('/api/admin/sales-managers/:id/activity', auth, adminOnly, asyncRoute(async (req, res) => {
  const [events, sessions] = await Promise.all([
    db.selectFrom('audit_events').selectAll().where('user_id', '=', req.params.id).orderBy('created_at', 'desc').limit(100).execute(),
    db.selectFrom('sessions').select(['id', 'portal', 'ip', 'user_agent', 'last_seen_at', 'created_at', 'expires_at'])
      .where('user_id', '=', req.params.id).orderBy('last_seen_at', 'desc').execute(),
  ]);
  res.json({ events: events.map(row => ({ ...row, metadata: parseJson(row.metadata, null) })), sessions });
}));

app.get('/api/sales/dashboard', auth, salesOnly, requireSalesPermission('reports.view'), asyncRoute(async (req, res) => {
  await expireReservations();
  const current = new Date();
  const defaultFrom = new Date(current.getFullYear(), current.getMonth(), 1).toISOString();
  const from = String(req.query.from || defaultFrom);
  const to = String(req.query.to || now());
  const rangeEnd = to.length === 10 ? `${to}T23:59:59.999Z` : to;
  const filters = {
    status: String(req.query.status || ''), product: String(req.query.product || ''),
    category: String(req.query.category || ''), paymentMethod: String(req.query.paymentMethod || ''),
    shippingMethod: String(req.query.shippingMethod || ''), customerType: String(req.query.customerType || ''),
    channel: String(req.query.channel || ''),
  };
  const cacheKey = JSON.stringify({ from, to, filters });
  const cached = dashboardCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return res.json({ ...cached.value, cached: true });
  let orderQuery = db.selectFrom('orders').innerJoin('users','users.id','orders.user_id')
    .leftJoin('profiles','profiles.user_id','users.id')
    .selectAll('orders').select(['profiles.full_name','profiles.account_type'])
    .where('orders.created_at','>=',from).where('orders.created_at','<=',rangeEnd);
  if (filters.status) orderQuery = orderQuery.where('orders.status','=',filters.status);
  if (filters.customerType) orderQuery = orderQuery.where('profiles.account_type','=',filters.customerType);
  if (filters.channel) orderQuery = orderQuery.where('orders.channel','=',filters.channel);
  const baseOrders = await orderQuery.execute();
  const orderIds = baseOrders.map(row => row.id);
  const [allItems, allPayments, allRefunds, products, invoices, customerTotal] = await Promise.all([
    orderIds.length ? db.selectFrom('order_items').innerJoin('products','products.id','order_items.product_id')
      .selectAll('order_items').select(['products.category']).where('order_id','in',orderIds).execute() : [],
    orderIds.length ? db.selectFrom('payments').selectAll().where('order_id','in',orderIds).execute() : [],
    orderIds.length ? db.selectFrom('refunds').selectAll().where('order_id','in',orderIds).execute() : [],
    db.selectFrom('products').selectAll().execute(),
    orderIds.length ? db.selectFrom('invoices').selectAll().where('order_id','in',orderIds).execute() : [],
    db.selectFrom('users').select(({fn})=>fn.countAll().as('count')).where('role','=','customer').where('deleted_at','is',null).executeTakeFirst(),
  ]);
  const matchingOrderIds = new Set(orderIds.filter(orderId => {
    const itemRows = allItems.filter(item => item.order_id === orderId);
    return (!filters.product || itemRows.some(item => item.product_id === filters.product)) &&
      (!filters.category || itemRows.some(item => item.category === filters.category));
  }).filter(orderId => {
    const paymentRows = allPayments.filter(payment => payment.order_id === orderId);
    return !filters.paymentMethod || paymentRows.some(payment => payment.provider === filters.paymentMethod);
  }).filter(orderId => {
    const order = baseOrders.find(row => row.id === orderId);
    return !filters.shippingMethod || order?.shipping_company === filters.shippingMethod;
  }));
  const orders = baseOrders.filter(row => matchingOrderIds.has(row.id));
  const items = allItems.filter(row => matchingOrderIds.has(row.order_id));
  const payments = allPayments.filter(row => matchingOrderIds.has(row.order_id));
  const refunds = allRefunds.filter(row => matchingOrderIds.has(row.order_id));
  const paidStatuses = new Set(['paid','reviewing','confirmed','preparing','ready_to_ship','processing','shipped','delivered','return_requested','returned','refund_requested','refunded']);
  const paidOrders = orders.filter(order => paidStatuses.has(order.status) && order.payment_status === 'paid');
  const grossSales = orders.reduce((sum,row)=>sum+Number(row.subtotal||0),0);
  const discountGranted = orders.reduce((sum,row)=>sum+Number(row.discount_total||0),0);
  const netSales = grossSales-discountGranted;
  const collectedRevenue = payments.filter(row=>row.status==='paid').reduce((sum,row)=>sum+Number(row.amount||0),0);
  const receivables = orders.filter(row=>row.payment_status!=='paid'&&row.status!=='cancelled').reduce((sum,row)=>sum+Number(row.total||0),0);
  const tax = orders.reduce((sum,row)=>sum+Number(row.tax_total||0),0);
  const shippingRevenue = orders.reduce((sum,row)=>sum+Number(row.shipping||0),0);
  const refundedAmount = refunds.filter(row=>['processed','completed'].includes(row.status)).reduce((sum,row)=>sum+Number(row.amount||0),0);
  const finalRevenue = collectedRevenue-refundedAmount;
  const cogs = items.filter(item=>paidOrders.some(order=>order.id===item.order_id))
    .reduce((sum,row)=>sum+Number(row.cost_snapshot||0)*Number(row.quantity||0),0);
  const grossProfit = netSales-cogs;
  const margin = netSales>0 ? grossProfit/netSales*100 : 0;
  const inventoryValue = products.reduce((sum,row)=>sum+Number(row.unit_cost||row.purchase_price||0)*Number(row.stock||0),0);
  const orderCounts = Object.fromEntries(['awaiting_payment','paid','preparing','shipped','delivered','cancelled','returned','refunded']
    .map(status=>[status,orders.filter(row=>row.status===status).length]));
  const successfulPayments = payments.filter(row=>row.status==='paid').length;
  const failedPayments = payments.filter(row=>row.status==='failed').length;
  const customerIds = [...new Set(orders.map(row=>row.user_id))];
  const customerOrderCounts = Object.values(orders.reduce((acc,row)=>({...acc,[row.user_id]:(acc[row.user_id]||0)+1}),{}));
  const newCustomers = orders.filter(order => order.created_at === orders.filter(row=>row.user_id===order.user_id).map(row=>row.created_at).sort()[0]).length;
  const days = {};
  for (const order of orders) {
    const key=String(order.created_at).slice(0,10);
    days[key] ||= {date:key,gross:0,net:0,orders:0,collected:0,refunds:0};
    days[key].gross+=Number(order.subtotal||0);
    days[key].net+=Number(order.subtotal||0)-Number(order.discount_total||0);
    days[key].orders+=1;
    days[key].collected+=order.payment_status==='paid'?Number(order.total||0):0;
  }
  for(const refund of refunds){const key=String(refund.created_at).slice(0,10);if(days[key])days[key].refunds+=Number(refund.amount||0)}
  const productSales = Object.values(items.reduce((acc,item)=>{
    const key=item.product_id;
    acc[key] ||= {productId:key,name:item.product_name,quantity:0,revenue:0};
    acc[key].quantity+=Number(item.quantity||0);acc[key].revenue+=Number(item.line_total||0);return acc;
  },{})).sort((a,b)=>b.revenue-a.revenue);
  const lowStock=products.filter(p=>Number(p.stock||0)-Number(p.reserved_stock||0)<=Number(p.low_stock_threshold||0));
  const result={
    range:{from,to},filters,
    kpis:{grossSales,discountGranted,netSales,collectedRevenue,receivables,tax,shippingRevenue,
      refundedAmount,finalRevenue,cogs,grossProfit,margin,averageOrderValue:orders.length?netSales/orders.length:0,
      invoices:invoices.length,inventoryValue},
    orders:{total:orders.length,new:orders.filter(row=>String(row.created_at).slice(0,10)===String(now()).slice(0,10)).length,
      ...orderCounts,paymentSuccessRate:(successfulPayments+failedPayments)?successfulPayments/(successfulPayments+failedPayments)*100:0,
      cancellationRate:orders.length?orderCounts.cancelled/orders.length*100:0,
      returnRate:orders.length?(orderCounts.returned+orderCounts.refunded)/orders.length*100:0},
    customers:{total:Number(customerTotal?.count||0),inRange:customerIds.length,new:newCustomers,
      repeat:customerOrderCounts.filter(count=>count>1).length,repeatRate:customerIds.length?customerOrderCounts.filter(count=>count>1).length/customerIds.length*100:0,
      averagePurchase:customerIds.length?netSales/customerIds.length:0},
    charts:{daily:Object.values(days).sort((a,b)=>a.date.localeCompare(b.date)),productSales:productSales.slice(0,10),
      orderStatus:Object.entries(orderCounts).map(([status,value])=>({status,value}))},
    tables:{topProducts:productSales.slice(0,10),slowProducts:productSales.slice(-10).reverse(),lowStock},
    alerts:[
      ...lowStock.map(product=>({type:Number(product.stock||0)-Number(product.reserved_stock||0)<=0?'danger':'warning',code:'low_stock',message:`موجودی قابل فروش ${product.name} به ${Math.max(0,Number(product.stock||0)-Number(product.reserved_stock||0))} رسیده است.`})),
      ...orders.filter(row=>row.status==='awaiting_payment').slice(0,20).map(order=>({type:'warning',code:'unpaid_order',message:`سفارش ${order.order_no} هنوز پرداخت نشده است.`})),
      ...payments.filter(row=>row.status==='failed').slice(0,20).map(payment=>({type:'danger',code:'failed_payment',message:`پرداخت سفارش ${payment.order_id} ناموفق بوده است.`})),
    ],
    products:products.length,lowStock,outOfStock:lowStock.filter(p=>Number(p.stock||0)-Number(p.reserved_stock||0)<=0).length,
    revenue:finalRevenue,unpaid:orderCounts.awaiting_payment||0,
  };
  dashboardCache.set(cacheKey,{value:result,expiresAt:Date.now()+60_000});
  res.json(result);
}));
app.get('/api/sales/products', auth, salesOnly, requireSalesPermission('products.view'), asyncRoute(async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 25)));
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '').trim();
  let builder = db.selectFrom('products').selectAll();
  if (q) builder = builder.where(eb => eb.or([
    eb('name', 'like', `%${q}%`), eb('sku', 'like', `%${q}%`),
    eb('product_code', 'like', `%${q}%`), eb('internal_barcode', 'like', `%${q}%`),
    eb('barcode', 'like', `%${q}%`), eb('slug', 'like', `%${q}%`), eb('brand', 'like', `%${q}%`),
  ]));
  if (status) builder = builder.where('status', '=', status);
  const rows = await builder.orderBy('updated_at', 'desc').limit(limit).offset((page - 1) * limit).execute();
  const items = rows.map(row => ({
    ...row,
    status: row.status === 'active' ? 'published' : row.status,
    available_stock: Math.max(0, Number(row.stock || 0) - Number(row.reserved_stock || 0)),
    tags: parseJson(row.tags, []), specifications: parseJson(row.specifications, {}),
    images: parseJson(row.images, []),
  }));
  if (!Object.keys(req.query).length) return res.json(items);
  let countBuilder = db.selectFrom('products').select(({ fn }) => fn.countAll().as('count'));
  if (q) countBuilder = countBuilder.where(eb => eb.or([
    eb('name', 'like', `%${q}%`), eb('sku', 'like', `%${q}%`),
    eb('product_code', 'like', `%${q}%`), eb('internal_barcode', 'like', `%${q}%`),
    eb('barcode', 'like', `%${q}%`), eb('slug', 'like', `%${q}%`), eb('brand', 'like', `%${q}%`),
  ]));
  if (status) countBuilder = countBuilder.where('status', '=', status);
  const total = Number((await countBuilder.executeTakeFirst())?.count || 0);
  res.json({ items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));
app.post('/api/sales/products', auth, salesOnly, requireSalesPermission('products.create'), asyncRoute(async (req, res) => {
  const parsed = z.object({
    name: z.string().trim().min(2), sku: z.string().trim().optional(), category: z.string().trim().optional(),
    subtitle: z.string().max(160).optional(), subcategory: z.string().max(120).optional(),
    categoryId: z.string().nullable().optional(), brandId: z.string().nullable().optional(),
    brand: z.string().trim().optional(), factoryBarcode: z.string().trim().regex(/^\d{8,14}$/).nullable().optional(),
    generateBarcode: z.boolean().default(true), barcode: z.string().trim().optional(),
    slug: z.string().trim().optional(), unit: z.string().trim().max(40).optional(),
    shortDescription: z.string().max(400).optional(), description: z.string().optional(),
    tags: z.array(z.string()).optional(), specifications: z.record(z.string(), z.string()).optional(),
    images: z.array(z.string()).max(12).optional(), productType: z.enum(['physical', 'digital', 'service']).optional(),
    price: z.number().int().min(0), salePrice: z.number().int().min(0).nullable().optional(),
    purchasePrice: z.number().int().min(0).nullable().optional(),
    inboundShippingCost: z.number().int().min(0).optional(),
    packagingCost: z.number().int().min(0).optional(),
    additionalCost: z.number().int().min(0).optional(),
    unitCost: z.number().int().min(0).nullable().optional(),
    saleStartsAt: z.string().nullable().optional(), saleEndsAt: z.string().nullable().optional(),
    taxRate: z.number().int().min(0).max(100).optional(),
    comparePrice: z.number().int().min(0).nullable().optional(), stock: z.number().int().min(0),
    lowStockThreshold: z.number().int().min(0).default(3), imageUrl: z.string().optional(),
    status: z.enum(['draft', 'published', 'active', 'suspended', 'archived']).default('draft'), featured: z.boolean().default(false),
    seoTitle: z.string().max(120).optional(), seoDescription: z.string().max(300).optional(),
    socialImageUrl: z.string().max(1000).optional(),
  }).safeParse(req.body);
  if (!parsed.success) return jsonError(res, 400, 'اطلاعات محصول کامل نیست.', parsed.error.flatten().fieldErrors);
  const id = uuid(); const p = parsed.data;
  await db.transaction().execute(async trx => {
    const identity = await nextProductIdentity(trx, p.categoryId);
    const categoryName = identity.category?.name || p.category;
    if (!categoryName) throw new Error('یک دسته‌بندی معتبر انتخاب کنید.');
    const factoryBarcode = p.factoryBarcode || p.barcode || null;
    await trx.insertInto('products').values({
      id, product_code:identity.productCode, sku:identity.sku,
      barcode:factoryBarcode, internal_barcode:identity.internalBarcode,
      barcode_source:factoryBarcode?'factory':'internal', slug:identity.slug,
      name:p.name, subtitle:p.subtitle||null,
      category:categoryName, subcategory:p.subcategory||null, category_id:identity.category?.id||null,
      brand_id:p.brandId||null,
      brand:p.brand||null, short_description:p.shortDescription||null, description:p.description||null,
      tags:JSON.stringify(p.tags||[]), specifications:JSON.stringify(p.specifications||{}),
      images:JSON.stringify(p.images||[]), product_type:p.productType||'physical', unit:p.unit||'عدد',
      price:p.price, purchase_price:p.purchasePrice??null,
      inbound_shipping_cost:p.inboundShippingCost||0, packaging_cost:p.packagingCost||0,
      additional_cost:p.additionalCost||0,
      unit_cost:p.unitCost??((p.purchasePrice||0)+(p.inboundShippingCost||0)+(p.packagingCost||0)+(p.additionalCost||0)),
      sale_price:p.salePrice??null, sale_starts_at:p.saleStartsAt||null,
      sale_ends_at:p.saleEndsAt||null, tax_rate:p.taxRate||0, compare_price:p.comparePrice||null,
      stock:p.stock, reserved_stock:0, low_stock_threshold:p.lowStockThreshold, price_tier:priceTier(p.salePrice??p.price),
      image_url:p.imageUrl||null, status:p.status==='active'?'published':p.status, featured:p.featured?1:0,
      seo_title:p.seoTitle||null, seo_description:p.seoDescription||null, social_image_url:p.socialImageUrl||null,
      created_at:now(), updated_at:now(),
    }).execute();
    if (p.stock) await trx.insertInto('inventory_movements').values({
      id:uuid(), product_id:id, order_id:null, quantity:p.stock,
      reason:'initial_stock', created_by:req.user.id, created_at:now(),
    }).execute();
    await trx.insertInto('price_history').values({
      id:uuid(), product_id:id, variant_id:null, old_price:null, new_price:p.price,
      changed_by:req.user.id, created_at:now(),
    }).execute();
    await trx.insertInto('product_status_history').values({
      id:uuid(), product_id:id, from_status:null, to_status:p.status==='active'?'published':p.status,
      changed_by:req.user.id, created_at:now(),
    }).execute();
  });
  await audit(req, 'product_created', 'product', id);
  res.status(201).json({ id });
}));
app.put('/api/sales/products/:id', auth, salesOnly, requireSalesPermission('products.update'), asyncRoute(async (req, res) => {
  const parsed = z.object({
    name:z.string().trim().min(2), sku:z.string().trim().optional(), category:z.string().trim().optional(), brand:z.string().optional(),
    description:z.string().optional(), price:z.number().int().min(0), comparePrice:z.number().int().min(0).nullable().optional(),
    stock:z.number().int().min(0), lowStockThreshold:z.number().int().min(0), imageUrl:z.string().optional(),
    status:z.enum(['draft','published','active','suspended','archived']), featured:z.boolean(),
    factoryBarcode:z.string().trim().regex(/^\d{8,14}$/).nullable().optional(),
    generateBarcode:z.boolean().optional(), barcode:z.string().optional(), slug:z.string().optional(),
    unit:z.string().trim().max(40).optional(), shortDescription:z.string().optional(),
    salePrice:z.number().int().min(0).nullable().optional(), saleStartsAt:z.string().nullable().optional(),
    saleEndsAt:z.string().nullable().optional(), taxRate:z.number().int().min(0).max(100).optional(),
    productType:z.enum(['physical','digital','service']).optional(), tags:z.array(z.string()).optional(),
    specifications:z.record(z.string(),z.string()).optional(),
    seoTitle:z.string().optional(), seoDescription:z.string().optional(), inventoryReason:z.string().min(3).max(300).optional(),
    subtitle:z.string().max(160).optional(),subcategory:z.string().max(120).optional(),
    categoryId:z.string().nullable().optional(),brandId:z.string().nullable().optional(),
    purchasePrice:z.number().int().min(0).nullable().optional(),inboundShippingCost:z.number().int().min(0).optional(),
    packagingCost:z.number().int().min(0).optional(),additionalCost:z.number().int().min(0).optional(),
    unitCost:z.number().int().min(0).nullable().optional(),socialImageUrl:z.string().max(1000).optional(),
  }).partial().required({name:true,price:true,stock:true,lowStockThreshold:true,status:true,featured:true}).safeParse(req.body);
  if (!parsed.success) return jsonError(res, 400, 'اطلاعات محصول معتبر نیست.', parsed.error.flatten().fieldErrors);
  const p=parsed.data;
  const current=await db.selectFrom('products').selectAll().where('id','=',req.params.id).executeTakeFirst();
  if(!current)return jsonError(res,404,'محصول پیدا نشد.');
  const selectedCategory=p.categoryId
    ? await db.selectFrom('product_categories').selectAll().where('id','=',p.categoryId).where('status','=','active').executeTakeFirst()
    : null;
  if(p.categoryId&&!selectedCategory)return jsonError(res,400,'دسته‌بندی انتخاب‌شده معتبر یا فعال نیست.');
  const stockDelta=p.stock-Number(current.stock||0);
  if(stockDelta && !p.inventoryReason)return jsonError(res,400,'برای اصلاح دستی موجودی، علت تغییر را وارد کنید.');
  await db.transaction().execute(async trx=>{
    await trx.updateTable('products').set({
      name:p.name,subtitle:p.subtitle??current.subtitle,
      barcode:p.factoryBarcode!==undefined?p.factoryBarcode:(p.barcode??current.barcode),
      barcode_source:(p.factoryBarcode!==undefined?(p.factoryBarcode?'factory':'internal'):current.barcode_source),
      category:selectedCategory?.name??p.category??current.category,subcategory:p.subcategory??current.subcategory,
      category_id:p.categoryId??current.category_id,brand_id:p.brandId??current.brand_id,
      brand:p.brand??current.brand,short_description:p.shortDescription??current.short_description,
      description:p.description??current.description,
      price:p.price,purchase_price:p.purchasePrice??current.purchase_price,
      inbound_shipping_cost:p.inboundShippingCost??current.inbound_shipping_cost,
      packaging_cost:p.packagingCost??current.packaging_cost,additional_cost:p.additionalCost??current.additional_cost,
      unit_cost:p.unitCost??current.unit_cost,sale_price:p.salePrice??current.sale_price,sale_starts_at:p.saleStartsAt??current.sale_starts_at,
      sale_ends_at:p.saleEndsAt??current.sale_ends_at,tax_rate:p.taxRate??current.tax_rate,
      compare_price:p.comparePrice??current.compare_price,
      stock:p.stock,low_stock_threshold:p.lowStockThreshold,image_url:p.imageUrl??current.image_url,
      product_type:p.productType??current.product_type??'physical',unit:p.unit??current.unit??'عدد',
      price_tier:priceTier(p.salePrice??p.price),
      tags:JSON.stringify(p.tags||parseJson(current.tags,[])),
      specifications:JSON.stringify(p.specifications||parseJson(current.specifications,{})),
      images:current.images,status:p.status==='active'?'published':p.status,
      featured:p.featured?1:0,seo_title:p.seoTitle??current.seo_title,seo_description:p.seoDescription??current.seo_description,
      social_image_url:p.socialImageUrl??current.social_image_url,updated_at:now(),
    }).where('id','=',req.params.id).execute();
    if(stockDelta)await trx.insertInto('inventory_movements').values({
      id:uuid(),product_id:req.params.id,order_id:null,quantity:stockDelta,
      reason:`manual:${p.inventoryReason}`,created_by:req.user.id,created_at:now(),
    }).execute();
    if(Number(current.price)!==Number(p.price))await trx.insertInto('price_history').values({
      id:uuid(),product_id:req.params.id,variant_id:null,old_price:Number(current.price),new_price:Number(p.price),
      changed_by:req.user.id,created_at:now(),
    }).execute();
    const nextStatus=p.status==='active'?'published':p.status;
    const previousStatus=current.status==='active'?'published':current.status;
    if(previousStatus!==nextStatus)await trx.insertInto('product_status_history').values({
      id:uuid(),product_id:req.params.id,from_status:previousStatus,to_status:nextStatus,
      changed_by:req.user.id,created_at:now(),
    }).execute();
  });
  await audit(req, 'product_updated', 'product', req.params.id);
  const persisted=await db.selectFrom('products').select(['id','status','updated_at']).where('id','=',req.params.id).executeTakeFirst();
  res.json({ ok:true,id:persisted.id,status:persisted.status==='active'?'published':persisted.status,updatedAt:persisted.updated_at });
}));

app.patch('/api/sales/products/:id/archive', auth, salesOnly, requireSalesPermission('products.archive'), asyncRoute(async (req, res) => {
  const product = await db.selectFrom('products').selectAll().where('id', '=', req.params.id).executeTakeFirst();
  if (!product) return jsonError(res, 404, 'محصول پیدا نشد.');
  const reason = String(req.body?.reason || 'حذف از فروشگاه').trim().slice(0, 300);
  await db.transaction().execute(async trx => {
    await trx.updateTable('products').set({
      status: 'archived', archive_reason: reason, deleted_at: now(), updated_at: now(),
    }).where('id', '=', product.id).execute();
    await trx.insertInto('product_status_history').values({
      id: uuid(), product_id: product.id, from_status: product.status, to_status: 'archived',
      changed_by: req.user.id, created_at: now(),
    }).execute();
  });
  await audit(req, 'product_archived', 'product', product.id, { reason });
  res.json({ ok: true });
}));

app.patch('/api/sales/products/:id/restore', auth, salesOnly, requireSalesPermission('products.restore'), asyncRoute(async (req, res) => {
  const product = await db.selectFrom('products').selectAll().where('id', '=', req.params.id).executeTakeFirst();
  if (!product) return jsonError(res, 404, 'محصول پیدا نشد.');
  await db.transaction().execute(async trx => {
    await trx.updateTable('products').set({
      status: 'draft', archive_reason: null, deleted_at: null, updated_at: now(),
    }).where('id', '=', product.id).execute();
    await trx.insertInto('product_status_history').values({
      id: uuid(), product_id: product.id, from_status: product.status, to_status: 'draft',
      changed_by: req.user.id, created_at: now(),
    }).execute();
  });
  await audit(req, 'product_restored', 'product', product.id);
  res.json({ ok: true });
}));

app.delete('/api/admin/products/:id/permanent', auth, adminOnly, asyncRoute(async (req, res) => {
  if (String(req.body?.confirmation || '') !== 'حذف دائمی محصول') {
    return jsonError(res, 400, 'عبارت تأیید حذف دائمی صحیح نیست.');
  }
  const [orderItem, movement] = await Promise.all([
    db.selectFrom('order_items').select('id').where('product_id', '=', req.params.id).executeTakeFirst(),
    db.selectFrom('inventory_movements').select('id').where('product_id', '=', req.params.id).executeTakeFirst(),
  ]);
  if (orderItem || movement) return jsonError(res, 409, 'این محصول سابقه سفارش یا گردش موجودی دارد و قابل حذف دائمی نیست.');
  const result = await db.deleteFrom('products').where('id', '=', req.params.id).where('status', '=', 'archived').executeTakeFirst();
  if (Number(result.numDeletedRows || 0) !== 1) return jsonError(res, 404, 'محصول بایگانی‌شده پیدا نشد.');
  await audit(req, 'product_permanently_deleted', 'product', req.params.id);
  res.json({ ok: true });
}));

app.get('/api/sales/products/:id/detail', auth, salesOnly, requireSalesPermission('products.view'), asyncRoute(async (req, res) => {
  const product = await db.selectFrom('products').selectAll().where('id', '=', req.params.id).executeTakeFirst();
  if (!product) return jsonError(res, 404, 'محصول پیدا نشد.');
  const [images, variants, priceHistory, statusHistory] = await Promise.all([
    db.selectFrom('product_images').selectAll().where('product_id', '=', product.id).where('deleted_at', 'is', null).orderBy('sort_order').execute(),
    db.selectFrom('product_variants').selectAll().where('product_id', '=', product.id).orderBy('created_at').execute(),
    db.selectFrom('price_history').selectAll().where('product_id', '=', product.id).orderBy('created_at', 'desc').execute(),
    db.selectFrom('product_status_history').selectAll().where('product_id', '=', product.id).orderBy('created_at', 'desc').execute(),
  ]);
  const variantRows = await Promise.all(variants.map(async variant => ({
    ...variant,
    available_stock: Math.max(0, Number(variant.stock || 0) - Number(variant.reserved_stock || 0)),
    options: await db.selectFrom('variant_options').selectAll().where('variant_id', '=', variant.id).orderBy('sort_order').execute(),
  })));
  res.json({
    ...product, tags: parseJson(product.tags, []), specifications: parseJson(product.specifications, {}),
    images, variants: variantRows, priceHistory, statusHistory,
  });
}));

app.get('/api/sales/products/:id/barcode.svg', auth, salesOnly, requireSalesPermission('products.view'), asyncRoute(async (req, res) => {
  const product = await db.selectFrom('products').select(['name','product_code','internal_barcode'])
    .where('id', '=', req.params.id).executeTakeFirst();
  if (!product) return jsonError(res, 404, 'محصول پیدا نشد.');
  if (!product.internal_barcode) return jsonError(res, 409, 'برای این محصول هنوز بارکد داخلی ساخته نشده است.');
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${product.product_code || product.internal_barcode}.svg"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(ean13Svg(product.internal_barcode, `${product.product_code || ''} | ${product.name}`));
}));

app.get('/uploads/:productId/:fileName', asyncRoute(async (req, res) => {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(req.params.productId) || !/^[A-Fa-f0-9-]{36}\.webp$/.test(req.params.fileName)) {
    return jsonError(res, 404, 'تصویر پیدا نشد.');
  }
  const url = `/uploads/${req.params.productId}/${req.params.fileName}`;
  const image = await db.selectFrom('product_images').innerJoin('products', 'products.id', 'product_images.product_id')
    .select(['product_images.url', 'products.status', 'products.deleted_at'])
    .where('product_images.url', '=', url).where('product_images.deleted_at', 'is', null).executeTakeFirst();
  if (!image || image.deleted_at || !['active', 'published'].includes(image.status)) return jsonError(res, 404, 'تصویر پیدا نشد.');
  const target = resolve(uploadRoot, req.params.productId, req.params.fileName);
  if (!target.startsWith(`${resolve(uploadRoot)}${sep}`)) return jsonError(res, 404, 'تصویر پیدا نشد.');
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
  res.sendFile(target);
}));

app.post('/api/sales/products/:id/images', auth, salesOnly, requireSalesPermission('products.update'), imageUpload.array('images', 12), asyncRoute(async (req, res) => {
  const product = await db.selectFrom('products').selectAll().where('id', '=', req.params.id).executeTakeFirst();
  if (!product) return jsonError(res, 404, 'محصول پیدا نشد.');
  if (!req.files?.length) return jsonError(res, 400, 'حداقل یک تصویر معتبر انتخاب کنید.');
  const existingCount = Number((await db.selectFrom('product_images').select(({ fn }) => fn.countAll().as('count'))
    .where('product_id', '=', product.id).where('deleted_at', 'is', null).executeTakeFirst())?.count || 0);
  if (existingCount + req.files.length > 12) return jsonError(res, 400, 'حداکثر ۱۲ تصویر برای هر محصول مجاز است.');
  const directory = resolve(uploadRoot, product.id);
  await mkdir(directory, { recursive: true });
  const prepared = [];
  for (let index = 0; index < req.files.length; index += 1) {
    const file = req.files[index];
    let image;
    try {
      image = sharp(file.buffer, { failOn: 'error', limitInputPixels: 40_000_000 }).rotate();
      const metadata = await image.metadata();
      if (!['jpeg', 'png', 'webp', 'avif'].includes(metadata.format)) throw new Error('invalid');
    } catch {
      return jsonError(res, 400, 'محتوای یکی از فایل‌ها تصویر معتبر نیست.');
    }
    const imageId = uuid();
    const fileName = `${imageId}.webp`;
    const output = await image.resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 }).toBuffer();
    const row = {
      id: imageId, product_id: product.id, url: `/uploads/${product.id}/${fileName}`,
      alt_text: String(req.body?.altText || product.name).slice(0, 200),
      sort_order: existingCount + index, is_primary: existingCount === 0 && index === 0 ? 1 : 0,
      mime_type: 'image/webp', size_bytes: output.length, deleted_at: null, created_at: now(),
    };
    prepared.push({ row, output, temporaryPath: resolve(directory, `.${fileName}.pending`), finalPath: resolve(directory, fileName) });
  }
  try {
    for (const item of prepared) await writeFile(item.temporaryPath, item.output, { flag: 'wx' });
    await db.transaction().execute(async trx => {
      for (const item of prepared) await trx.insertInto('product_images').values(item.row).execute();
      for (const item of prepared) await rename(item.temporaryPath, item.finalPath);
      const primary = prepared.find(item => item.row.is_primary)?.row;
      if (primary) await trx.updateTable('products').set({ image_url: primary.url, updated_at: now() }).where('id', '=', product.id).execute();
    });
  } catch (error) {
    for (const item of prepared) {
      await unlink(item.temporaryPath).catch(() => {});
      await unlink(item.finalPath).catch(() => {});
    }
    throw error;
  }
  const created = prepared.map(item => item.row);
  await audit(req, 'product_images_uploaded', 'product', product.id, { count: created.length });
  res.status(201).json(created);
}));

app.patch('/api/sales/products/:productId/images/:imageId', auth, salesOnly, requireSalesPermission('products.update'), asyncRoute(async (req, res) => {
  const image = await db.selectFrom('product_images').selectAll().where('id', '=', req.params.imageId)
    .where('product_id', '=', req.params.productId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!image) return jsonError(res, 404, 'تصویر پیدا نشد.');
  const parsed = z.object({
    altText: z.string().max(200).optional(), sortOrder: z.number().int().min(0).optional(),
    isPrimary: z.boolean().optional(), deleted: z.boolean().optional(),
  }).safeParse(req.body);
  if (!parsed.success) return jsonError(res, 400, 'تنظیمات تصویر معتبر نیست.');
  await db.transaction().execute(async trx => {
    if (parsed.data.isPrimary) {
      await trx.updateTable('product_images').set({ is_primary: 0 }).where('product_id', '=', req.params.productId).execute();
      await trx.updateTable('products').set({ image_url: image.url, updated_at: now() }).where('id', '=', req.params.productId).execute();
    }
    await trx.updateTable('product_images').set({
      ...(parsed.data.altText !== undefined ? { alt_text: parsed.data.altText } : {}),
      ...(parsed.data.sortOrder !== undefined ? { sort_order: parsed.data.sortOrder } : {}),
      ...(parsed.data.isPrimary !== undefined ? { is_primary: parsed.data.isPrimary ? 1 : 0 } : {}),
      ...(parsed.data.deleted ? { deleted_at: now(), is_primary: 0 } : {}),
    }).where('id', '=', image.id).execute();
  });
  await audit(req, parsed.data.deleted ? 'product_image_archived' : 'product_image_updated', 'product_image', image.id);
  res.json({ ok: true });
}));

app.post('/api/sales/products/:id/variants', auth, salesOnly, requireSalesPermission('products.update'), asyncRoute(async (req, res) => {
  const parsed = z.object({
    name: z.string().trim().min(1), sku: z.string().trim().optional(),
    factoryBarcode: z.string().trim().regex(/^\d{8,14}$/).optional(), generateBarcode: z.boolean().default(true),
    barcode: z.string().optional(),
    price: z.number().int().min(0).nullable().optional(), costPrice: z.number().int().min(0).nullable().optional(),
    stock: z.number().int().min(0), status: z.enum(['active', 'suspended']).default('active'),
    options: z.array(z.object({ name: z.string().min(1), value: z.string().min(1) })).max(12).default([]),
  }).safeParse(req.body);
  if (!parsed.success) return jsonError(res, 400, 'اطلاعات تنوع محصول معتبر نیست.', parsed.error.flatten().fieldErrors);
  const product = await db.selectFrom('products').select(['id','sku']).where('id', '=', req.params.id).executeTakeFirst();
  if (!product) return jsonError(res, 404, 'محصول پیدا نشد.');
  const id = uuid();
  await db.transaction().execute(async trx => {
    const variantNumber = await nextSequence(trx, `variant:${product.id}`);
    const sku = `${product.sku}-V${String(variantNumber).padStart(2, '0')}`;
    const barcodeSequence = await nextSequence(trx, 'product');
    const internalBarcode = ean13CheckDigit(`291${String(barcodeSequence).padStart(9, '0')}`);
    const factoryBarcode = parsed.data.factoryBarcode || parsed.data.barcode || null;
    await trx.insertInto('product_variants').values({
      id, product_id: product.id, name: parsed.data.name, sku,
      barcode: factoryBarcode || internalBarcode, price: parsed.data.price ?? null,
      cost_price: parsed.data.costPrice ?? null, stock: parsed.data.stock, reserved_stock: 0,
      image_id: null, status: parsed.data.status, created_at: now(), updated_at: now(),
    }).execute();
    if (parsed.data.options.length) await trx.insertInto('variant_options').values(parsed.data.options.map((option, index) => ({
      id: uuid(), variant_id: id, option_name: option.name, option_value: option.value, sort_order: index,
    }))).execute();
    if (parsed.data.price !== null && parsed.data.price !== undefined) await trx.insertInto('price_history').values({
      id: uuid(), product_id: product.id, variant_id: id, old_price: null,
      new_price: parsed.data.price, changed_by: req.user.id, created_at: now(),
    }).execute();
    if (parsed.data.stock) await trx.insertInto('inventory_movements').values({
      id: uuid(), product_id: product.id, variant_id: id, order_id: null,
      quantity: parsed.data.stock, reason: 'variant_initial_stock',
      created_by: req.user.id, created_at: now(),
    }).execute();
  });
  await audit(req, 'product_variant_created', 'product_variant', id);
  res.status(201).json({ id });
}));

app.patch('/api/sales/variants/:id', auth, salesOnly, requireSalesPermission('products.update'), asyncRoute(async (req, res) => {
  const parsed = z.object({
    name: z.string().trim().min(1).optional(), sku: z.string().trim().min(2).optional(),
    barcode: z.string().nullable().optional(), price: z.number().int().min(0).nullable().optional(),
    costPrice: z.number().int().min(0).nullable().optional(), stock: z.number().int().min(0).optional(),
    status: z.enum(['active', 'suspended']).optional(), inventoryReason: z.string().trim().min(3).max(300).optional(),
    options: z.array(z.object({ name: z.string().min(1), value: z.string().min(1) })).max(12).optional(),
  }).safeParse(req.body);
  if (!parsed.success) return jsonError(res, 400, 'اطلاعات تنوع محصول معتبر نیست.', parsed.error.flatten().fieldErrors);
  const current = await db.selectFrom('product_variants').selectAll().where('id', '=', req.params.id).executeTakeFirst();
  if (!current) return jsonError(res, 404, 'تنوع محصول پیدا نشد.');
  const data = parsed.data;
  const stockDelta = data.stock === undefined ? 0 : data.stock - Number(current.stock || 0);
  if (stockDelta && !data.inventoryReason) return jsonError(res, 400, 'علت اصلاح موجودی تنوع را وارد کنید.');
  await db.transaction().execute(async trx => {
    await trx.updateTable('product_variants').set({
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.sku !== undefined ? { sku: data.sku } : {}),
      ...(data.barcode !== undefined ? { barcode: data.barcode } : {}),
      ...(data.price !== undefined ? { price: data.price } : {}),
      ...(data.costPrice !== undefined ? { cost_price: data.costPrice } : {}),
      ...(data.stock !== undefined ? { stock: data.stock } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      updated_at: now(),
    }).where('id', '=', current.id).execute();
    if (data.options !== undefined) {
      await trx.deleteFrom('variant_options').where('variant_id', '=', current.id).execute();
      if (data.options.length) await trx.insertInto('variant_options').values(data.options.map((option, index) => ({
        id: uuid(), variant_id: current.id, option_name: option.name, option_value: option.value, sort_order: index,
      }))).execute();
    }
    if (stockDelta) await trx.insertInto('inventory_movements').values({
      id: uuid(), product_id: current.product_id, variant_id: current.id, order_id: null,
      quantity: stockDelta, reason: `variant_manual:${data.inventoryReason}`,
      created_by: req.user.id, created_at: now(),
    }).execute();
    if (data.price !== undefined && Number(data.price) !== Number(current.price)) await trx.insertInto('price_history').values({
      id: uuid(), product_id: current.product_id, variant_id: current.id,
      old_price: current.price === null ? null : Number(current.price), new_price: data.price,
      changed_by: req.user.id, created_at: now(),
    }).execute();
  });
  await audit(req, 'product_variant_updated', 'product_variant', current.id);
  res.json({ ok: true });
}));

app.get('/api/sales/engineering-service-requests', auth, salesOnly, requireSalesPermission('services.view'), asyncRoute(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '').trim();
  let builder = db.selectFrom('engineering_service_requests')
    .innerJoin('users', 'users.id', 'engineering_service_requests.user_id')
    .leftJoin('profiles', 'profiles.user_id', 'users.id')
    .selectAll('engineering_service_requests')
    .select(['users.mobile as account_mobile', 'profiles.full_name as account_name', 'profiles.email', 'profiles.company']);
  if (status) builder = builder.where('engineering_service_requests.status', '=', status);
  if (q) builder = builder.where(eb => eb.or([
    eb('engineering_service_requests.request_no', 'like', `%${q}%`),
    eb('engineering_service_requests.client_name', 'like', `%${q}%`),
    eb('engineering_service_requests.client_phone', 'like', `%${q}%`),
    eb('engineering_service_requests.province', 'like', `%${q}%`),
  ]));
  const rows = await builder.orderBy('engineering_service_requests.created_at', 'desc').limit(250).execute();
  res.json(rows.map(row => ({
    ...row,
    services: parseJson(row.services, []),
    pricing_snapshot: parseJson(row.pricing_snapshot, []),
    map_file_path: undefined,
  })));
}));
app.get('/api/sales/engineering-service-requests/:id', auth, salesOnly, requireSalesPermission('services.view'), asyncRoute(async (req, res) => {
  const row = await db.selectFrom('engineering_service_requests')
    .innerJoin('users', 'users.id', 'engineering_service_requests.user_id')
    .leftJoin('profiles', 'profiles.user_id', 'users.id')
    .selectAll('engineering_service_requests')
    .select(['users.mobile as account_mobile', 'profiles.full_name as account_name', 'profiles.email', 'profiles.company'])
    .where('engineering_service_requests.id', '=', req.params.id).executeTakeFirst();
  if (!row) return jsonError(res, 404, 'درخواست خدمات مهندسی پیدا نشد.');
  res.json({
    ...row,
    services: parseJson(row.services, []),
    pricing_snapshot: parseJson(row.pricing_snapshot, []),
    map_file_path: undefined,
  });
}));
app.patch('/api/sales/engineering-service-requests/:id', auth, salesOnly, requireSalesPermission('services.manage'), asyncRoute(async (req, res) => {
  const parsed = z.object({
    status: z.enum(['submitted', 'reviewing', 'needs_information', 'in_progress', 'completed', 'rejected']),
    adminNote: z.string().trim().max(2_000).optional(),
  }).safeParse(req.body);
  if (!parsed.success) return jsonError(res, 400, 'وضعیت یا توضیحات درخواست معتبر نیست.');
  const current = await db.selectFrom('engineering_service_requests').select(['id', 'user_id', 'request_no'])
    .where('id', '=', req.params.id).executeTakeFirst();
  if (!current) return jsonError(res, 404, 'درخواست خدمات مهندسی پیدا نشد.');
  await db.transaction().execute(async trx => {
    await trx.updateTable('engineering_service_requests').set({
      status: parsed.data.status, admin_note: parsed.data.adminNote || null, updated_at: now(),
    }).where('id', '=', current.id).execute();
    await trx.insertInto('notifications').values({
      id: uuid(), user_id: current.user_id, title: 'وضعیت خدمات مهندسی به‌روزرسانی شد',
      body: `درخواست ${current.request_no} به وضعیت «${({
        submitted: 'ثبت‌شده', reviewing: 'در حال بررسی', needs_information: 'نیازمند تکمیل اطلاعات',
        in_progress: 'در حال انجام', completed: 'تحویل‌شده', rejected: 'ردشده',
      })[parsed.data.status]}» تغییر کرد.`, read_at: null, created_at: now(),
    }).execute();
  });
  await audit(req, 'engineering_service_request_updated', 'engineering_service_request', current.id, parsed.data);
  res.json({ ok: true });
}));
app.get('/api/sales/engineering-service-requests/:id/map', auth, salesOnly, requireSalesPermission('services.view'), asyncRoute(async (req, res) => {
  const row = await db.selectFrom('engineering_service_requests')
    .select(['map_file_path', 'map_original_name']).where('id', '=', req.params.id).executeTakeFirst();
  if (!row?.map_file_path || !row.map_original_name) return jsonError(res, 404, 'برای این درخواست فایل نقشه‌ای ارسال نشده است.');
  const safeStoredName = basename(row.map_file_path);
  res.download(resolve(serviceMapRoot, safeStoredName), basename(row.map_original_name));
}));

app.get('/api/sales/notification-counts', auth, salesOnly, asyncRoute(async (req, res) => {
  const [supportRow, messageRow] = await Promise.all([
    req.salesPermissions['support-tickets.view']
      ? db.selectFrom('support_sales_tickets').select(({ fn }) => fn.countAll().as('count'))
        .where('status', '=', 'new').executeTakeFirst()
      : Promise.resolve({ count: 0 }),
    db.selectFrom('notifications').select(({ fn }) => fn.countAll().as('count'))
      .where('user_id', '=', req.user.id).where('read_at', 'is', null).executeTakeFirst(),
  ]);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({
    supportTickets: Number(supportRow?.count || 0),
    messages: Number(messageRow?.count || 0),
  });
}));

app.get('/api/sales/support-tickets', auth, salesOnly, requireSalesPermission('support-tickets.view'), asyncRoute(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const statusFilter = String(req.query.status || '').trim();
  let query = db.selectFrom('support_sales_tickets')
    .innerJoin('users', 'users.id', 'support_sales_tickets.customer_id')
    .leftJoin('profiles', 'profiles.user_id', 'users.id')
    .leftJoin('support_tickets', 'support_tickets.id', 'support_sales_tickets.support_ticket_id')
    .leftJoin('orders', 'orders.id', 'support_sales_tickets.order_id')
    .selectAll('support_sales_tickets')
    .select([
      'users.mobile', 'profiles.full_name', 'profiles.company',
      'support_tickets.public_no as support_public_no', 'support_tickets.status as support_status',
      'orders.order_no', 'orders.status as order_status', 'orders.payment_status', 'orders.total as order_total',
    ]);
  if (statusFilter) query = query.where('support_sales_tickets.status', '=', statusFilter);
  if (q) query = query.where(eb => eb.or([
    eb('support_sales_tickets.sales_ticket_no', 'like', `%${q}%`),
    eb('support_sales_tickets.subject', 'like', `%${q}%`),
    eb('users.mobile', 'like', `%${q}%`),
    eb('profiles.full_name', 'like', `%${q}%`),
  ]));
  const items = await query.orderBy(sql`CASE support_sales_tickets.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END`)
    .orderBy('support_sales_tickets.due_at').orderBy('support_sales_tickets.created_at', 'desc').limit(300).execute();
  res.json(items);
}));

app.patch('/api/sales/support-tickets/:id', auth, salesOnly, requireSalesPermission('support-tickets.manage'), asyncRoute(async (req, res) => {
  const parsed = z.object({
    status: z.enum(['new', 'reviewing', 'needs_information', 'resolved', 'closed']),
    resolutionNote: z.string().trim().max(3000).optional(),
  }).safeParse(req.body);
  if (!parsed.success || (['resolved', 'closed'].includes(parsed.data.status) && !parsed.data.resolutionNote)) {
    return jsonError(res, 400, 'برای حل یا بستن تیکت، نتیجه بررسی را وارد کنید.');
  }
  const current = await db.selectFrom('support_sales_tickets').selectAll().where('id', '=', req.params.id).executeTakeFirst();
  if (!current) return jsonError(res, 404, 'تیکت ارجاعی فروشگاه پیدا نشد.');
  const changedAt = now();
  const completed = ['resolved', 'closed'].includes(parsed.data.status);
  await db.transaction().execute(async trx => {
    await trx.updateTable('support_sales_tickets').set({
      status: parsed.data.status, sales_manager_id: req.user.id,
      resolution_note: parsed.data.resolutionNote || current.resolution_note,
      resolved_at: completed ? changedAt : null, updated_at: changedAt,
    }).where('id', '=', current.id).execute();
    const supportTicket = await trx.selectFrom('support_tickets').selectAll()
      .where('id', '=', current.support_ticket_id).executeTakeFirst();
    const noteBody = `پاسخ ادمین فروشگاه برای ${current.sales_ticket_no}\nوضعیت: ${parsed.data.status}\n${parsed.data.resolutionNote || 'در حال بررسی'}`;
    await trx.insertInto('support_messages').values({
      id: uuid(), ticket_id: current.support_ticket_id, sender_id: req.user.id,
      sender_type: 'agent', message_type: 'internal_note', body: noteBody,
      sanitized_body: noteBody, delivery_status: 'read', channel: 'web',
      metadata: JSON.stringify({ salesTicketId: current.id, salesStatus: parsed.data.status }),
      record_version: 1, idempotency_key: `sales-update:${current.id}:${Date.now()}`, created_at: changedAt,
    }).execute();
    if (supportTicket && completed && supportTicket.status === 'waiting_internal') {
      const version = Number(supportTicket.state_version || 0) + 1;
      await trx.updateTable('support_tickets').set({
        status: supportTicket.agent_id ? 'agent_active' : 'queued',
        state_version: version, updated_at: changedAt, last_activity_at: changedAt,
      }).where('id', '=', supportTicket.id).execute();
      await trx.insertInto('support_status_history').values({
        id: uuid(), ticket_id: supportTicket.id, from_status: supportTicket.status,
        to_status: supportTicket.agent_id ? 'agent_active' : 'queued',
        actor_type: 'sales_manager', actor_id: req.user.id,
        reason: 'دریافت نتیجه از ادمین فروشگاه', state_version: version,
        metadata: JSON.stringify({ salesTicketId: current.id }), created_at: changedAt,
      }).execute();
    }
    if (supportTicket?.agent_id) await trx.insertInto('notifications').values({
      id: uuid(), user_id: supportTicket.agent_id, title: 'پاسخ ادمین فروشگاه',
      body: `${current.sales_ticket_no} به وضعیت ${parsed.data.status} تغییر کرد.`,
      read_at: null, created_at: changedAt,
    }).execute();
    await trx.insertInto('support_events').values({
      id: uuid(), ticket_id: current.support_ticket_id, event_type: 'ticket.sales_updated',
      actor_type: 'sales_manager', actor_id: req.user.id, target_user_id: supportTicket?.agent_id || null,
      team_id: supportTicket?.team_id || null,
      payload: JSON.stringify({ salesTicketId: current.id, status: parsed.data.status, customerId: current.customer_id }),
      created_at: changedAt,
    }).execute();
  });
  await audit(req, 'support_sales_ticket_updated', 'support_sales_ticket', current.id, parsed.data);
  res.json({ ok: true, status: parsed.data.status });
}));

app.get('/api/sales/catalog-settings', auth, salesOnly, requireSalesPermission('products.view'), asyncRoute(async (_req, res) => {
  const [categoryRows, brands, settingRows] = await Promise.all([
    db.selectFrom('product_categories').selectAll().orderBy('sort_order').orderBy('name').execute(),
    db.selectFrom('brands').selectAll().orderBy('name').execute(),
    db.selectFrom('store_settings').selectAll().execute(),
  ]);
  const counts = await db.selectFrom('products').select(['category_id','status'])
    .select(({ fn }) => fn.countAll().as('count')).groupBy(['category_id','status']).execute();
  const categories = categoryRows.map(category => ({
    ...category,
    attributes: parseJson(category.attributes, []),
    price_ranges: parseJson(category.price_ranges, []),
    products: counts.filter(row => row.category_id === category.id)
      .reduce((total, row) => total + Number(row.count || 0), 0),
    published: counts.filter(row => row.category_id === category.id && ['published','active'].includes(row.status))
      .reduce((total, row) => total + Number(row.count || 0), 0),
  }));
  const settings = Object.fromEntries(settingRows.map(row => [row.key,
    ['units','price_tiers'].includes(row.key) ? parseJson(row.value, []) : row.value]));
  res.json({ categories, brands, settings });
}));

app.post('/api/sales/catalog-settings/:kind', auth, salesOnly, requireSalesPermission('products.update'), asyncRoute(async (req, res) => {
  const kind = req.params.kind;
  if (!['categories', 'brands'].includes(kind)) return jsonError(res, 404, 'نوع تنظیمات کاتالوگ معتبر نیست.');
  const parsed = z.object({
    name: z.string().trim().min(2), parentId: z.string().nullable().optional(),
    description: z.string().max(500).optional(), attributes: z.array(z.string()).max(40).optional(),
  }).safeParse(req.body);
  if (!parsed.success) return jsonError(res, 400, 'نام معتبر وارد کنید.');
  const id = uuid();
  await db.transaction().execute(async trx => {
    const number = await nextSequence(trx, kind === 'categories' ? 'category' : 'brand');
    const slug = `${kind === 'categories' ? 'category' : 'brand'}-${String(number).padStart(4, '0')}`;
    if (kind === 'categories') await trx.insertInto('product_categories').values({
      id, name: parsed.data.name, slug, parent_id: parsed.data.parentId || null,
      code: String(number).padStart(4, '0'), description: parsed.data.description || null,
      sort_order: number, attributes: JSON.stringify(parsed.data.attributes || []), price_ranges: '[]',
      status: 'active', created_at: now(),
    }).execute();
    else await trx.insertInto('brands').values({
      id, name: parsed.data.name, slug, status: 'active', created_at: now(),
    }).execute();
  });
  await audit(req, `${kind}_created`, kind, id);
  res.status(201).json({ id });
}));

app.patch('/api/sales/catalog-settings/categories/:id', auth, salesOnly, requireSalesPermission('products.update'), asyncRoute(async (req, res) => {
  const parsed = z.object({
    name: z.string().trim().min(2).optional(), description: z.string().max(500).nullable().optional(),
    parentId: z.string().nullable().optional(), status: z.enum(['active','inactive']).optional(),
    sortOrder: z.number().int().min(0).optional(), attributes: z.array(z.string()).max(40).optional(),
  }).safeParse(req.body);
  if (!parsed.success) return jsonError(res, 400, 'اطلاعات دسته‌بندی معتبر نیست.');
  const current = await db.selectFrom('product_categories').selectAll().where('id','=',req.params.id).executeTakeFirst();
  if (!current) return jsonError(res,404,'دسته‌بندی پیدا نشد.');
  if (parsed.data.status === 'inactive') {
    const published = await db.selectFrom('products').select('id').where('category_id','=',current.id)
      .where('status','in',['published','active']).executeTakeFirst();
    if (published) return jsonError(res,409,'دسته دارای محصول منتشرشده است؛ ابتدا محصولات را منتقل یا غیرفعال کنید.');
  }
  await db.updateTable('product_categories').set({
    ...(parsed.data.name !== undefined ? { name:parsed.data.name } : {}),
    ...(parsed.data.description !== undefined ? { description:parsed.data.description } : {}),
    ...(parsed.data.parentId !== undefined ? { parent_id:parsed.data.parentId } : {}),
    ...(parsed.data.status !== undefined ? { status:parsed.data.status } : {}),
    ...(parsed.data.sortOrder !== undefined ? { sort_order:parsed.data.sortOrder } : {}),
    ...(parsed.data.attributes !== undefined ? { attributes:JSON.stringify(parsed.data.attributes) } : {}),
  }).where('id','=',current.id).execute();
  if (parsed.data.name) await db.updateTable('products').set({ category:parsed.data.name,updated_at:now() })
    .where('category_id','=',current.id).execute();
  await audit(req,'category_updated','product_category',current.id,parsed.data);
  res.json({ok:true});
}));

app.patch('/api/sales/store-settings', auth, salesOnly, requireSalesPermission('settings.manage'), asyncRoute(async (req,res)=>{
  const parsed=z.object({
    productCodePrefix:z.string().trim().regex(/^[A-Za-z0-9]{2,8}$/).optional(),
    defaultLowStockThreshold:z.number().int().min(0).max(100000).optional(),
    units:z.array(z.string().trim().min(1).max(40)).min(1).max(30).optional(),
  }).safeParse(req.body);
  if(!parsed.success)return jsonError(res,400,'تنظیمات کددهی معتبر نیست.');
  const updates={
    ...(parsed.data.productCodePrefix!==undefined?{product_code_prefix:parsed.data.productCodePrefix.toUpperCase()}:{ }),
    ...(parsed.data.defaultLowStockThreshold!==undefined?{default_low_stock_threshold:String(parsed.data.defaultLowStockThreshold)}:{ }),
    ...(parsed.data.units!==undefined?{units:JSON.stringify([...new Set(parsed.data.units)])}:{ }),
  };
  for(const [key,value] of Object.entries(updates))await db.insertInto('store_settings').values({key,value,updated_at:now()})
    .onConflict(conflict=>conflict.column('key').doUpdateSet({value,updated_at:now()})).execute();
  await audit(req,'store_identity_settings_updated','store_settings','product_identity',Object.keys(updates));
  res.json({ok:true});
}));
app.get('/api/sales/orders', auth, salesOnly, requireSalesPermission('orders.view'), asyncRoute(async (req, res) => {
  await expireReservations();
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 25)));
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '').trim();
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();
  let builder = db.selectFrom('orders').innerJoin('users','users.id','orders.user_id')
    .leftJoin('profiles','profiles.user_id','users.id').leftJoin('addresses','addresses.id','orders.address_id')
    .leftJoin('invoices','invoices.order_id','orders.id')
    .select(['orders.id','orders.order_no','orders.status','orders.payment_status','orders.total','orders.notes',
      'orders.customer_note','orders.internal_note','orders.reservation_expires_at','orders.created_at',
      'users.mobile','profiles.full_name','profiles.account_type','addresses.province','addresses.city',
      'addresses.address','addresses.postal_code','invoices.id as invoice_id','invoices.invoice_no','invoices.status as invoice_status']);
  if (q) builder = builder.where(eb => eb.or([
    eb('orders.order_no','like',`%${q}%`), eb('users.mobile','like',`%${q}%`), eb('profiles.full_name','like',`%${q}%`),
  ]));
  if (status) builder = builder.where('orders.status','=',status);
  if (from) builder = builder.where('orders.created_at','>=',from);
  if (to) builder = builder.where('orders.created_at','<=',`${to}T23:59:59.999Z`);
  const rows = await builder.orderBy('orders.created_at','desc').limit(limit).offset((page-1)*limit).execute();
  const items = rows.map(row => ({ ...row, allowedTransitions: orderTransitions[row.status] || [] }));
  if (!Object.keys(req.query).length) return res.json(items);
  let countBuilder = db.selectFrom('orders').innerJoin('users','users.id','orders.user_id')
    .leftJoin('profiles','profiles.user_id','users.id').select(({fn})=>fn.countAll().as('count'));
  if (q) countBuilder = countBuilder.where(eb => eb.or([
    eb('orders.order_no','like',`%${q}%`), eb('users.mobile','like',`%${q}%`), eb('profiles.full_name','like',`%${q}%`),
  ]));
  if (status) countBuilder = countBuilder.where('orders.status','=',status);
  if (from) countBuilder = countBuilder.where('orders.created_at','>=',from);
  if (to) countBuilder = countBuilder.where('orders.created_at','<=',`${to}T23:59:59.999Z`);
  const total=Number((await countBuilder.executeTakeFirst())?.count||0);
  res.json({items,pagination:{page,limit,total,pages:Math.ceil(total/limit)}});
}));
app.get('/api/sales/orders/:id', auth, salesOnly, requireSalesPermission('orders.view'), asyncRoute(async (req, res) => {
  const order = await db.selectFrom('orders').innerJoin('users','users.id','orders.user_id')
    .leftJoin('profiles','profiles.user_id','users.id')
    .selectAll('orders').select(['users.mobile','profiles.full_name','profiles.email','profiles.company','profiles.account_type'])
    .where('orders.id','=',req.params.id).executeTakeFirst();
  if (!order) return jsonError(res,404,'سفارش پیدا نشد.');
  const [items,payments,history,invoice,shipments,returns,refunds] = await Promise.all([
    db.selectFrom('order_items').selectAll().where('order_id','=',order.id).execute(),
    db.selectFrom('payments').selectAll().where('order_id','=',order.id).orderBy('created_at','desc').execute(),
    db.selectFrom('order_status_history').leftJoin('profiles','profiles.user_id','order_status_history.changed_by')
      .selectAll('order_status_history').select('profiles.full_name as manager_name').where('order_id','=',order.id).orderBy('order_status_history.created_at').execute(),
    db.selectFrom('invoices').selectAll().where('order_id','=',order.id).executeTakeFirst(),
    db.selectFrom('shipments').selectAll().where('order_id','=',order.id).orderBy('created_at','desc').execute(),
    db.selectFrom('returns').selectAll().where('order_id','=',order.id).orderBy('created_at','desc').execute(),
    db.selectFrom('refunds').selectAll().where('order_id','=',order.id).orderBy('created_at','desc').execute(),
  ]);
  res.json({...order,address_snapshot:parseJson(order.address_snapshot,null),items,payments,history,invoice,shipments,returns,refunds,allowedTransitions:orderTransitions[order.status]||[]});
}));
app.patch('/api/sales/orders/:id', auth, salesOnly, requireSalesPermission('orders.manage'), asyncRoute(async (req,res)=>{
  const parsed=z.object({
    status:z.enum(['reviewing','confirmed','preparing','ready_to_ship','shipped','delivered','cancelled','return_requested','returned','refund_requested','processing']),
    note:z.string().max(500).optional(),shippingCompany:z.string().max(100).optional(),
    trackingCode:z.string().max(100).optional(),estimatedDeliveryAt:z.string().nullable().optional(),
  }).safeParse(req.body);
  if(!parsed.success)return jsonError(res,400,'وضعیت سفارش معتبر نیست.');
  const order=await db.selectFrom('orders').selectAll().where('id','=',req.params.id).executeTakeFirst();
  if(!order)return jsonError(res,404,'سفارش پیدا نشد.');
  await changeOrderStatus(req,order,parsed.data.status,parsed.data.note);
  if(parsed.data.shippingCompany||parsed.data.trackingCode||parsed.data.estimatedDeliveryAt){
    await db.updateTable('orders').set({
      shipping_company:parsed.data.shippingCompany||order.shipping_company,
      tracking_code:parsed.data.trackingCode||order.tracking_code,
      estimated_delivery_at:parsed.data.estimatedDeliveryAt||order.estimated_delivery_at,
    }).where('id','=',order.id).execute();
  }
  res.json({ok:true});
}));
app.get('/api/sales/customers', auth, salesOnly, requireSalesPermission('customers.view'), asyncRoute(async (req,res)=>{
  const page=Math.max(1,Number(req.query.page||1)),limit=Math.min(100,Math.max(1,Number(req.query.limit||25))),q=String(req.query.q||'').trim();
  let query=db.selectFrom('users').leftJoin('profiles','profiles.user_id','users.id').leftJoin('addresses','addresses.user_id','users.id')
    .select(['users.id','users.mobile','profiles.full_name','profiles.email','profiles.company','addresses.title','addresses.province','addresses.city','addresses.address','addresses.postal_code'])
    .where('users.role','=','customer').where(eb=>eb.or([eb('addresses.deleted_at','is',null),eb('addresses.id','is',null)]));
  if(q)query=query.where(eb=>eb.or([eb('profiles.full_name','like',`%${q}%`),eb('users.mobile','like',`%${q}%`),eb('profiles.company','like',`%${q}%`)]));
  const rows=await query.orderBy('users.created_at','desc').limit(limit).offset((page-1)*limit).execute();
  let countQuery=db.selectFrom('users').select(({fn})=>fn.count('users.id').distinct().as('count')).where('users.role','=','customer');
  if(q)countQuery=countQuery.leftJoin('profiles','profiles.user_id','users.id').where(eb=>eb.or([eb('profiles.full_name','like',`%${q}%`),eb('users.mobile','like',`%${q}%`),eb('profiles.company','like',`%${q}%`)]));
  const total=Number((await countQuery.executeTakeFirst())?.count||0);
  const maskMobile=value=>value?`${String(value).slice(0,4)}***${String(value).slice(-4)}`:null;
  const maskEmail=value=>value?String(value).replace(/^(.{1,2}).*(@.*)$/,'$1***$2'):null;
  res.json({items:rows.map(row=>({...row,mobile:maskMobile(row.mobile),email:maskEmail(row.email),address:row.address?`${String(row.address).slice(0,18)}…`:null,postal_code:null})),pagination:{page,limit,total,pages:Math.ceil(total/limit)}});
}));
app.get('/api/sales/discounts', auth, salesOnly, requireSalesPermission('discounts.manage'), asyncRoute(async (_req,res)=>res.json(await db.selectFrom('discount_codes').selectAll().orderBy('created_at','desc').execute())));
app.post('/api/sales/discounts', auth, salesOnly, requireSalesPermission('discounts.manage'), asyncRoute(async (req,res)=>{
  const parsed=z.object({
    code:z.string().trim().min(3),type:z.enum(['percent','fixed']),value:z.number().int().positive(),
    usageLimit:z.number().int().positive().nullable().optional(),startsAt:z.string().nullable().optional(),
    endsAt:z.string().nullable().optional(),minimumOrder:z.number().int().min(0).nullable().optional(),
    maximumDiscount:z.number().int().min(0).nullable().optional(),
    perCustomerLimit:z.number().int().positive().nullable().optional(),
    productIds:z.array(z.string()).optional(),categoryIds:z.array(z.string()).optional(),
    customerIds:z.array(z.string()).optional(),firstPurchaseOnly:z.boolean().optional(),
    singleUse:z.boolean().optional(),
  }).safeParse(req.body);
  if(!parsed.success)return jsonError(res,400,'اطلاعات کد تخفیف معتبر نیست.');
  const id=uuid();await db.insertInto('discount_codes').values({
    id,code:parsed.data.code.toUpperCase(),type:parsed.data.type,value:parsed.data.value,
    usage_limit:parsed.data.usageLimit||null,used_count:0,starts_at:parsed.data.startsAt||now(),
    ends_at:parsed.data.endsAt||null,minimum_order:parsed.data.minimumOrder||null,
    maximum_discount:parsed.data.maximumDiscount||null,per_customer_limit:parsed.data.perCustomerLimit||null,
    product_ids:JSON.stringify(parsed.data.productIds||[]),category_ids:JSON.stringify(parsed.data.categoryIds||[]),
    customer_ids:JSON.stringify(parsed.data.customerIds||[]),first_purchase_only:parsed.data.firstPurchaseOnly?1:0,
    single_use:parsed.data.singleUse?1:0,
    status:'active',created_at:now(),
  }).execute();
  await audit(req,'discount_created','discount',id);
  res.status(201).json({id});
}));
app.get('/api/sales/inventory-movements', auth, salesOnly, requireSalesPermission('inventory.view'), asyncRoute(async (req,res)=>{
  const limit=Math.min(250,Math.max(10,Number(req.query.limit||100)));
  res.json(await db.selectFrom('inventory_movements')
    .innerJoin('products','products.id','inventory_movements.product_id')
    .leftJoin('profiles','profiles.user_id','inventory_movements.created_by')
    .select(['inventory_movements.id','inventory_movements.product_id','inventory_movements.order_id',
      'inventory_movements.quantity','inventory_movements.reason','inventory_movements.created_at',
      'products.name','products.sku','profiles.full_name as manager_name'])
    .orderBy('inventory_movements.created_at','desc').limit(limit).execute());
}));
app.get('/api/sales/invoices/:id', auth, salesOnly, requireSalesPermission('payments.view'), asyncRoute(async (req,res)=>{
  const invoice=await db.selectFrom('invoices').innerJoin('orders','orders.id','invoices.order_id')
    .innerJoin('users','users.id','orders.user_id').leftJoin('profiles','profiles.user_id','users.id')
    .select(['invoices.id','invoices.invoice_no','invoices.amount','invoices.status','invoices.issued_at',
      'invoices.paid_at','orders.id as order_id','orders.order_no','orders.address_snapshot',
      'orders.subtotal','orders.discount_total','orders.tax_total','orders.shipping','orders.total',
      'users.mobile','profiles.full_name','profiles.company','profiles.national_id',
      'profiles.company_national_id','profiles.economic_code','profiles.invoice_details'])
    .where('invoices.id','=',req.params.id).executeTakeFirst();
  if(!invoice)return jsonError(res,404,'فاکتور پیدا نشد.');
  const items=await db.selectFrom('order_items').selectAll().where('order_id','=',invoice.order_id).execute();
  res.json({...invoice,address_snapshot:parseJson(invoice.address_snapshot,null),items,
    seller:{name:process.env.SELLER_NAME||'راهکار',nationalId:process.env.SELLER_NATIONAL_ID||'',economicCode:process.env.SELLER_ECONOMIC_CODE||'',address:process.env.SELLER_ADDRESS||''}});
}));
app.get('/api/sales/reports.csv', auth, salesOnly, requireSalesPermission('reports.export'), requireStepUp, asyncRoute(async (req,res)=>{
  const from=String(req.query.from||'0000-01-01'),to=String(req.query.to||'9999-12-31');
  const exportLimit=Math.min(10000,Math.max(1,Number(process.env.EXPORT_MAX_ROWS||5000)));
  const rows=await db.selectFrom('orders').leftJoin('profiles','profiles.user_id','orders.user_id')
    .select(['orders.order_no','orders.status','orders.payment_status','orders.subtotal','orders.discount_total',
      'orders.tax_total','orders.shipping','orders.total','orders.created_at','profiles.full_name'])
    .where('orders.created_at','>=',from).where('orders.created_at','<=',`${to}T23:59:59.999Z`)
    .orderBy('orders.created_at','desc').limit(exportLimit).execute();
  const escape=value=>{
    let safe=String(value??'');
    if (/^[=+\-@]/.test(safe)) safe=`'${safe}`;
    return `"${safe.replaceAll('"','""')}"`;
  };
  const header=['شماره سفارش','مشتری','وضعیت سفارش','وضعیت پرداخت','جمع اقلام','تخفیف','مالیات','ارسال','مبلغ نهایی','تاریخ'];
  const csv='\\uFEFF'+[header,...rows.map(row=>[
    row.order_no,row.full_name,row.status,row.payment_status,row.subtotal,row.discount_total,
    row.tax_total,row.shipping,row.total,row.created_at,
  ])].map(line=>line.map(escape).join(',')).join('\\n');
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename=\"aronage-sales-report.csv\"');
  res.setHeader('X-Export-ID',req.correlationId);
  await audit(req,'sales_report_exported','orders',null,{format:'csv',from,to,count:rows.length});
  res.send(csv);
}));

app.get('/api/sales/payments', auth, salesOnly, requireSalesPermission('payments.view'), asyncRoute(async (req,res)=>{
  const page=Math.max(1,Number(req.query.page||1)),limit=Math.min(100,Math.max(1,Number(req.query.limit||25)));
  const rows=await db.selectFrom('payments').innerJoin('orders','orders.id','payments.order_id')
    .leftJoin('profiles','profiles.user_id','orders.user_id')
    .selectAll('payments').select(['orders.order_no','orders.total as order_total','profiles.full_name'])
    .orderBy('payments.created_at','desc').limit(limit).offset((page-1)*limit).execute();
  const total=Number((await db.selectFrom('payments').select(({fn})=>fn.countAll().as('count')).executeTakeFirst())?.count||0);
  res.json({items:rows,pagination:{page,limit,total,pages:Math.ceil(total/limit)}});
}));

app.post('/api/sales/shipments', auth, salesOnly, requireSalesPermission('orders.manage'), asyncRoute(async (req,res)=>{
  const parsed=z.object({
    orderId:z.string(),method:z.string().trim().min(2),company:z.string().max(100).optional(),
    trackingCode:z.string().max(100).optional(),cost:z.number().int().min(0).default(0),
    estimatedDeliveryAt:z.string().nullable().optional(),
  }).safeParse(req.body);
  if(!parsed.success)return jsonError(res,400,'اطلاعات ارسال معتبر نیست.');
  const order=await db.selectFrom('orders').selectAll().where('id','=',parsed.data.orderId).executeTakeFirst();
  if(!order)return jsonError(res,404,'سفارش پیدا نشد.');
  if(!['paid','reviewing','confirmed','preparing','ready_to_ship','processing'].includes(order.status))return jsonError(res,409,'سفارش در وضعیت قابل ارسال نیست.');
  const id=uuid();
  await db.insertInto('shipments').values({
    id,order_id:order.id,method:parsed.data.method,company:parsed.data.company||null,
    tracking_code:parsed.data.trackingCode||null,cost:parsed.data.cost,status:'pending',
    estimated_delivery_at:parsed.data.estimatedDeliveryAt||null,shipped_at:null,delivered_at:null,
    created_by:req.user.id,created_at:now(),updated_at:now(),
  }).execute();
  await audit(req,'shipment_created','shipment',id,{orderId:order.id});
  res.status(201).json({id});
}));

app.patch('/api/sales/shipments/:id', auth, salesOnly, requireSalesPermission('orders.manage'), asyncRoute(async (req,res)=>{
  const parsed=z.object({
    status:z.enum(['pending','ready','shipped','delivered','cancelled']),
    company:z.string().max(100).optional(),trackingCode:z.string().max(100).optional(),
    estimatedDeliveryAt:z.string().nullable().optional(),
  }).safeParse(req.body);
  if(!parsed.success)return jsonError(res,400,'وضعیت ارسال معتبر نیست.');
  const shipment=await db.selectFrom('shipments').selectAll().where('id','=',req.params.id).executeTakeFirst();
  if(!shipment)return jsonError(res,404,'رکورد ارسال پیدا نشد.');
  await db.updateTable('shipments').set({
    status:parsed.data.status,company:parsed.data.company??shipment.company,
    tracking_code:parsed.data.trackingCode??shipment.tracking_code,
    estimated_delivery_at:parsed.data.estimatedDeliveryAt??shipment.estimated_delivery_at,
    shipped_at:parsed.data.status==='shipped'?(shipment.shipped_at||now()):shipment.shipped_at,
    delivered_at:parsed.data.status==='delivered'?(shipment.delivered_at||now()):shipment.delivered_at,
    updated_at:now(),
  }).where('id','=',shipment.id).execute();
  const order=await db.selectFrom('orders').selectAll().where('id','=',shipment.order_id).executeTakeFirst();
  if(parsed.data.status==='shipped'&&order&&orderTransitions[order.status]?.includes('shipped'))await changeOrderStatus(req,order,'shipped','ثبت ارسال عملیاتی');
  if(parsed.data.status==='delivered'&&order&&orderTransitions[order.status]?.includes('delivered'))await changeOrderStatus(req,order,'delivered','تأیید تحویل محموله');
  await audit(req,'shipment_updated','shipment',shipment.id,{status:parsed.data.status});
  res.json({ok:true});
}));

app.post('/api/orders/:id/returns', auth, asyncRoute(async (req,res)=>{
  const parsed=z.object({
    reason:z.string().trim().min(3).max(200),description:z.string().max(1000).optional(),
    images:z.array(z.string().max(1500)).max(5).optional(),
    items:z.array(z.object({orderItemId:z.string(),quantity:z.number().int().positive()})).min(1),
  }).safeParse(req.body);
  if(!parsed.success)return jsonError(res,400,'اطلاعات درخواست مرجوعی کامل نیست.');
  const order=await db.selectFrom('orders').selectAll().where('id','=',req.params.id).where('user_id','=',req.user.id).executeTakeFirst();
  if(!order)return jsonError(res,404,'سفارش پیدا نشد.');
  if(!['shipped','delivered'].includes(order.status))return jsonError(res,409,'این سفارش در وضعیت قابل مرجوعی نیست.');
  const orderItems=await db.selectFrom('order_items').selectAll().where('order_id','=',order.id).execute();
  for(const requested of parsed.data.items){
    const item=orderItems.find(row=>row.id===requested.orderItemId);
    if(!item||requested.quantity>item.quantity)return jsonError(res,400,'تعداد یکی از اقلام مرجوعی معتبر نیست.');
  }
  const id=uuid(),returnNo=orderNo('RET');
  await db.transaction().execute(async trx=>{
    await trx.insertInto('returns').values({
      id,return_no:returnNo,order_id:order.id,user_id:req.user.id,reason:parsed.data.reason,
      description:parsed.data.description||null,images:JSON.stringify(parsed.data.images||[]),
      health_status:null,status:'requested',reviewed_by:null,review_note:null,created_at:now(),updated_at:now(),
    }).execute();
    await trx.insertInto('return_items').values(parsed.data.items.map(item=>({
      id:uuid(),return_id:id,order_item_id:item.orderItemId,quantity:item.quantity,
    }))).execute();
    await trx.updateTable('orders').set({status:'return_requested',updated_at:now()}).where('id','=',order.id).execute();
    await trx.insertInto('order_status_history').values({
      id:uuid(),order_id:order.id,from_status:order.status,to_status:'return_requested',
      note:parsed.data.reason,changed_by:req.user.id,created_at:now(),
    }).execute();
  });
  await audit(req,'return_requested','return',id,{orderId:order.id});
  res.status(201).json({id,returnNo});
}));

app.get('/api/sales/returns', auth, salesOnly, requireSalesPermission('orders.view'), asyncRoute(async (_req,res)=>{
  res.json(await db.selectFrom('returns').innerJoin('orders','orders.id','returns.order_id')
    .leftJoin('profiles','profiles.user_id','returns.user_id')
    .selectAll('returns').select(['orders.order_no','profiles.full_name'])
    .orderBy('returns.created_at','desc').execute());
}));

app.patch('/api/sales/returns/:id', auth, salesOnly, requireSalesPermission('orders.manage'), asyncRoute(async (req,res)=>{
  const parsed=z.object({
    status:z.enum(['reviewing','approved','rejected','received','closed']),
    healthStatus:z.enum(['healthy','damaged','incomplete']).nullable().optional(),
    reviewNote:z.string().max(1000).optional(),
  }).safeParse(req.body);
  if(!parsed.success)return jsonError(res,400,'نتیجه بررسی مرجوعی معتبر نیست.');
  const returnRow=await db.selectFrom('returns').selectAll().where('id','=',req.params.id).executeTakeFirst();
  if(!returnRow)return jsonError(res,404,'درخواست مرجوعی پیدا نشد.');
  await db.transaction().execute(async trx=>{
    await trx.updateTable('returns').set({
      status:parsed.data.status,health_status:parsed.data.healthStatus??returnRow.health_status,
      review_note:parsed.data.reviewNote??returnRow.review_note,reviewed_by:req.user.id,updated_at:now(),
    }).where('id','=',returnRow.id).execute();
    if(parsed.data.status==='received'&&parsed.data.healthStatus==='healthy'&&returnRow.status!=='received'){
      const rows=await trx.selectFrom('return_items').innerJoin('order_items','order_items.id','return_items.order_item_id')
        .select(['return_items.quantity','order_items.product_id','order_items.variant_id']).where('return_items.return_id','=',returnRow.id).execute();
      for(const row of rows){
        if(row.variant_id)await trx.updateTable('product_variants').set({stock:sql`stock + ${row.quantity}`,updated_at:now()}).where('id','=',row.variant_id).execute();
        else await trx.updateTable('products').set({stock:sql`stock + ${row.quantity}`,updated_at:now()}).where('id','=',row.product_id).execute();
        await trx.insertInto('inventory_movements').values({
          id:uuid(),product_id:row.product_id,variant_id:row.variant_id,order_id:returnRow.order_id,quantity:row.quantity,
          reason:'return_received_healthy',created_by:req.user.id,created_at:now(),
        }).execute();
      }
    }
  });
  await audit(req,'return_updated','return',returnRow.id,{status:parsed.data.status,healthStatus:parsed.data.healthStatus});
  res.json({ok:true});
}));

app.post('/api/sales/refunds', auth, salesOnly, requireSalesPermission('refunds.manage'), requireStepUp, asyncRoute(async (req,res)=>{
  const parsed=z.object({
    paymentId:z.string(),returnId:z.string().nullable().optional(),amount:z.number().int().positive(),
    reason:z.string().trim().min(3).max(500),idempotencyKey:z.string().min(8).max(100).optional(),
  }).safeParse(req.body);
  if(!parsed.success)return jsonError(res,400,'اطلاعات بازپرداخت معتبر نیست.');
  const idempotencyKey=String(req.headers['idempotency-key']||parsed.data.idempotencyKey||'').trim();
  if(idempotencyKey.length<8||idempotencyKey.length>100)return jsonError(res,400,'شناسه Idempotency معتبر ارسال نشده است.');
  const payloadHash=hash(JSON.stringify({paymentId:parsed.data.paymentId,returnId:parsed.data.returnId||null,amount:parsed.data.amount,reason:parsed.data.reason}));
  const existing=await db.selectFrom('refunds').selectAll().where('created_by','=',req.user.id).where('idempotency_key','=',idempotencyKey).executeTakeFirst();
  if(existing){
    if(existing.payload_hash!==payloadHash)return jsonError(res,409,'این شناسه Idempotency قبلاً با اطلاعات متفاوت استفاده شده است.');
    return res.json({id:existing.id,refundNo:existing.refund_no,reused:true});
  }
  const id=uuid(),refundNo=orderNo('RF');
  await db.transaction().execute(async trx=>{
    let paymentQuery=trx.selectFrom('payments').selectAll().where('id','=',parsed.data.paymentId).where('status','=','paid');
    if(dbKind==='postgres')paymentQuery=paymentQuery.forUpdate();
    const payment=await paymentQuery.executeTakeFirst();
    if(!payment)throw Object.assign(new Error('پرداخت موفق پیدا نشد.'),{status:404});
    const previous=Number((await trx.selectFrom('refunds').select(({fn})=>fn.sum('amount').as('sum'))
      .where('payment_id','=',payment.id).where('status','in',['pending','processed','completed']).executeTakeFirst())?.sum||0);
    if(previous+parsed.data.amount>Number(payment.amount))throw Object.assign(new Error('مبلغ بازپرداخت از مبلغ پرداخت‌شده بیشتر می‌شود.'),{status:409});
    await trx.insertInto('refunds').values({
      id,refund_no:refundNo,order_id:payment.order_id,payment_id:payment.id,
      return_id:parsed.data.returnId||null,amount:parsed.data.amount,reason:parsed.data.reason,
      status:'pending',provider_reference:null,created_by:req.user.id,idempotency_key:idempotencyKey,payload_hash:payloadHash,created_at:now(),processed_at:null,
    }).execute();
  });
  await audit(req,'refund_created','refund',id,{amount:parsed.data.amount});
  res.status(201).json({id,refundNo});
}));

app.patch('/api/sales/refunds/:id/process', auth, salesOnly, requireSalesPermission('refunds.manage'), requireStepUp, asyncRoute(async (req,res)=>{
  const refund=await db.selectFrom('refunds').selectAll().where('id','=',req.params.id).executeTakeFirst();
  if(!refund)return jsonError(res,404,'بازپرداخت پیدا نشد.');
  if(refund.status!=='pending')return jsonError(res,409,'این بازپرداخت قبلاً پردازش شده است.');
  const reference=String(req.body?.reference||'').trim();
  if((process.env.PAYMENT_PROVIDER||'disabled')!=='disabled'&&!reference)return jsonError(res,400,'شناسه بازپرداخت درگاه را وارد کنید.');
  await db.transaction().execute(async trx=>{
    const claimed=await trx.updateTable('refunds').set({status:'processing'}).where('id','=',refund.id).where('status','=','pending').executeTakeFirst();
    if(Number(claimed.numUpdatedRows||0)!==1)throw Object.assign(new Error('این بازپرداخت قبلاً پردازش یا هم‌زمان دریافت شده است.'),{status:409});
    const paymentChanged=await trx.updateTable('payments').set({refunded_amount:sql`COALESCE(refunded_amount, 0) + ${refund.amount}`,updated_at:now()})
      .where('id','=',refund.payment_id).where(sql`COALESCE(refunded_amount, 0) + ${refund.amount}`,'<=',sql`amount`).executeTakeFirst();
    if(Number(paymentChanged.numUpdatedRows||0)!==1)throw Object.assign(new Error('سقف بازپرداخت پرداخت تکمیل شده است.'),{status:409});
    await trx.updateTable('refunds').set({status:'processed',provider_reference:reference||`OFFLINE-${refund.id}`,processed_at:now()}).where('id','=',refund.id).where('status','=','processing').execute();
    const payment=await trx.selectFrom('payments').selectAll().where('id','=',refund.payment_id).executeTakeFirst();
    if(Number(payment.refunded_amount||0)>=Number(payment.amount)){
      await trx.updateTable('orders').set({status:'refunded',updated_at:now()}).where('id','=',refund.order_id).execute();
    }
  });
  await audit(req,'refund_processed','refund',refund.id,{amount:refund.amount});
  res.json({ok:true});
}));

app.patch('/api/sales/discounts/:id', auth, salesOnly, requireSalesPermission('discounts.manage'), asyncRoute(async (req,res)=>{
  const parsed=z.object({
    status:z.enum(['active','paused','archived']).optional(),endsAt:z.string().nullable().optional(),
    usageLimit:z.number().int().positive().nullable().optional(),minimumOrder:z.number().int().min(0).nullable().optional(),
  }).safeParse(req.body);
  if(!parsed.success)return jsonError(res,400,'تنظیمات تخفیف معتبر نیست.');
  const result=await db.updateTable('discount_codes').set({
    ...(parsed.data.status?{status:parsed.data.status,archived_at:parsed.data.status==='archived'?now():null}:{}),
    ...(parsed.data.endsAt!==undefined?{ends_at:parsed.data.endsAt}:{}),
    ...(parsed.data.usageLimit!==undefined?{usage_limit:parsed.data.usageLimit}:{}),
    ...(parsed.data.minimumOrder!==undefined?{minimum_order:parsed.data.minimumOrder}:{}),
  }).where('id','=',req.params.id).executeTakeFirst();
  if(Number(result.numUpdatedRows||0)!==1)return jsonError(res,404,'کد تخفیف پیدا نشد.');
  await audit(req,'discount_updated','discount',req.params.id);
  res.json({ok:true});
}));

app.get('/api/sales/reports.xlsx', auth, salesOnly, requireSalesPermission('reports.export'), requireStepUp, asyncRoute(async (req,res)=>{
  const from=String(req.query.from||'0000-01-01'),to=String(req.query.to||'9999-12-31');
  const exportLimit=Math.min(10000,Math.max(1,Number(process.env.EXPORT_MAX_ROWS||5000)));
  const [orders,items,customers,payments,refunds,products,discounts,movements]=await Promise.all([
    db.selectFrom('orders').leftJoin('profiles','profiles.user_id','orders.user_id').select([
      'orders.order_no','orders.status','orders.payment_status','orders.subtotal','orders.discount_total',
      'orders.tax_total','orders.shipping','orders.total','orders.channel','orders.created_at','profiles.full_name'])
      .where('orders.created_at','>=',from).where('orders.created_at','<=',`${to}T23:59:59.999Z`).limit(exportLimit).execute(),
    db.selectFrom('order_items').innerJoin('orders','orders.id','order_items.order_id').select([
      'orders.order_no','order_items.product_name','order_items.sku_snapshot','order_items.quantity',
      'order_items.unit_price','order_items.discount_snapshot','order_items.line_total'])
      .where('orders.created_at','>=',from).where('orders.created_at','<=',`${to}T23:59:59.999Z`).limit(exportLimit).execute(),
    db.selectFrom('users').leftJoin('profiles','profiles.user_id','users.id').select(['users.mobile','users.status','users.created_at','profiles.full_name','profiles.email','profiles.account_type','profiles.company']).where('users.role','=','customer').limit(exportLimit).execute(),
    db.selectFrom('payments').innerJoin('orders','orders.id','payments.order_id').select([
      'orders.order_no','payments.amount','payments.provider','payments.status','payments.transaction_id',
      'payments.created_at','payments.paid_at']).where('payments.created_at','>=',from).where('payments.created_at','<=',`${to}T23:59:59.999Z`).limit(exportLimit).execute(),
    db.selectFrom('refunds').innerJoin('orders','orders.id','refunds.order_id').select([
      'orders.order_no','refunds.amount','refunds.reason','refunds.status','refunds.created_at','refunds.processed_at'])
      .where('refunds.created_at','>=',from).where('refunds.created_at','<=',`${to}T23:59:59.999Z`).limit(exportLimit).execute(),
    db.selectFrom('products').select(['product_code','sku','name','category','brand','price','sale_price','stock','reserved_stock','low_stock_threshold','status','updated_at']).limit(exportLimit).execute(),
    db.selectFrom('discount_codes').select(['code','type','value','usage_limit','used_count','starts_at','ends_at','status']).limit(exportLimit).execute(),
    db.selectFrom('inventory_movements').leftJoin('products','products.id','inventory_movements.product_id').leftJoin('orders','orders.id','inventory_movements.order_id')
      .select(['products.product_code','orders.order_no','inventory_movements.quantity','inventory_movements.reason','inventory_movements.created_at'])
      .where('inventory_movements.created_at','>=',from).where('inventory_movements.created_at','<=',`${to}T23:59:59.999Z`).limit(exportLimit).execute(),
  ]);
  const summary=[{
    'تعداد سفارش':orders.length,'فروش ناخالص':orders.reduce((s,x)=>s+Number(x.subtotal||0),0),
    'تخفیف':orders.reduce((s,x)=>s+Number(x.discount_total||0),0),
    'فروش خالص':orders.reduce((s,x)=>s+Number(x.subtotal||0)-Number(x.discount_total||0),0),
    'وصولی':payments.filter(x=>x.status==='paid').reduce((s,x)=>s+Number(x.amount||0),0),
    'بازپرداخت':refunds.filter(x=>['processed','completed'].includes(x.status)).reduce((s,x)=>s+Number(x.amount||0),0),
  }];
  const daily=Object.values(orders.reduce((acc,row)=>{const day=String(row.created_at).slice(0,10);acc[day]||={'تاریخ':day,'تعداد سفارش':0,'فروش ناخالص':0,'فروش خالص':0};acc[day]['تعداد سفارش']+=1;acc[day]['فروش ناخالص']+=Number(row.subtotal||0);acc[day]['فروش خالص']+=Number(row.subtotal||0)-Number(row.discount_total||0);return acc},{}));
  const maskedCustomers=customers.map(row=>({...row,mobile:row.mobile?`${row.mobile.slice(0,4)}***${row.mobile.slice(-4)}`:null,email:row.email?row.email.replace(/^(.{1,2}).*(@.*)$/,'$1***$2'):null}));
  const groups=[['خلاصه مدیریتی',summary],['فروش روزانه',daily],['سفارش‌ها',orders],['اقلام',items],['مشتریان',maskedCustomers],
    ['پرداخت‌ها',payments],['بازپرداخت‌ها',refunds],['موجودی',products],['تخفیف‌ها',discounts],['گردش کالا',movements]];
  const sheets=groups.map(([,rows])=>{
    const keys=[...new Set(rows.flatMap(row=>Object.keys(row)))];
    if(!keys.length)return [[{value:'داده‌ای برای این بازه وجود ندارد',fontWeight:'bold'}]];
    const normalize=value=>{
      if(value===null||value===undefined)return '';
      if(typeof value==='object')return JSON.stringify(value);
      return typeof value==='string'&&/^[=+\-@]/.test(value)?`'${value}`:value;
    };
    return [
      keys.map(key=>({value:key,fontWeight:'bold',textColor:'#ffffff',backgroundColor:'#0d654f',align:'center'})),
      ...rows.map(row=>keys.map(key=>({value:normalize(row[key]),wrap:true}))),
    ];
  });
  const buffer=await writeXlsxFile(groups.map(([name],index)=>({
    data:sheets[index],sheet:name,stickyRowsCount:1,
  }))).toBuffer();
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition','attachment; filename="aronage-sales-report.xlsx"');
  res.setHeader('X-Export-ID',req.correlationId);
  await audit(req,'sales_report_exported','orders',null,{format:'xlsx',from,to,count:orders.length});
  res.send(buffer);
}));

app.get('/api/admin/support', auth, adminOnly, asyncRoute(async (req, res) => {
  const rows = await db.selectFrom('support_tickets')
    .innerJoin('users', 'users.id', 'support_tickets.user_id')
    .leftJoin('profiles', 'profiles.user_id', 'users.id')
    .leftJoin('support_assignments', 'support_assignments.ticket_id', 'support_tickets.id')
    .select([
      'support_tickets.id', 'support_tickets.ticket_no', 'support_tickets.subject',
      'support_tickets.status', 'support_tickets.priority', 'support_tickets.created_at',
      'users.mobile', 'profiles.full_name', 'support_assignments.agent_id',
    ]).orderBy('support_tickets.created_at', 'desc').limit(250).execute();
  const agents = await db.selectFrom('admin_members')
    .innerJoin('users', 'users.id', 'admin_members.user_id')
    .leftJoin('profiles', 'profiles.user_id', 'users.id')
    .select(['users.id', 'users.mobile', 'users.status', 'profiles.full_name'])
    .where('admin_members.section', '=', 'support').execute();
  const visibleRows = rows;
  res.json({
    tickets: visibleRows,
    agents: agents.filter(agent => agent.status === 'active'),
    permissions: { view: true, reply: true, assign: true, close: true, reports: true },
    currentUserId: req.user.id,
    metrics: {
      open: visibleRows.filter(row => row.status === 'open').length,
      waiting: visibleRows.filter(row => row.status === 'answered').length,
      closed: visibleRows.filter(row => row.status === 'closed').length,
    },
  });
}));
app.get('/api/admin/support/:id/messages', auth, adminOnly, asyncRoute(async (req, res) => {
  const ticket = await db.selectFrom('support_tickets').selectAll().where('id', '=', req.params.id).executeTakeFirst();
  if (!ticket) return jsonError(res, 404, 'گفتگو پیدا نشد.');
  const assignment = await db.selectFrom('support_assignments').selectAll().where('ticket_id', '=', ticket.id).executeTakeFirst();
  if (!['admin', 'super_admin'].includes(req.user.role) && !req.supportPermissions.assign && assignment?.agent_id && assignment.agent_id !== req.user.id) {
    return jsonError(res, 403, 'این گفتگو به پشتیبان دیگری تخصیص داده شده است.');
  }
  const messages = await db.selectFrom('support_messages')
    .innerJoin('users', 'users.id', 'support_messages.sender_id')
    .leftJoin('profiles', 'profiles.user_id', 'users.id')
    .select(['support_messages.id', 'support_messages.sender_id', 'support_messages.body', 'support_messages.created_at', 'users.role', 'profiles.full_name'])
    .where('ticket_id', '=', ticket.id).orderBy('support_messages.created_at').execute();
  const notes = await db.selectFrom('support_notes')
    .leftJoin('profiles', 'profiles.user_id', 'support_notes.author_id')
    .select(['support_notes.id', 'support_notes.author_id', 'support_notes.body',
      'support_notes.created_at', 'profiles.full_name'])
    .where('ticket_id', '=', ticket.id).orderBy('support_notes.created_at').execute();
  res.json({ ticket: { ...ticket, agent_id: assignment?.agent_id || null }, messages, internalNotes: notes });
}));
app.post('/api/admin/support/:id/messages', auth, adminOnly, asyncRoute(async (req, res) => {
  const ticket = await db.selectFrom('support_tickets').selectAll().where('id', '=', req.params.id).executeTakeFirst();
  if (!ticket) return jsonError(res, 404, 'گفتگو پیدا نشد.');
  const assignment = await db.selectFrom('support_assignments').selectAll().where('ticket_id', '=', ticket.id).executeTakeFirst();
  if (!['admin', 'super_admin'].includes(req.user.role) && assignment?.agent_id && assignment.agent_id !== req.user.id) return jsonError(res, 403, 'این گفتگو به پشتیبان دیگری تخصیص داده شده است.');
  const body = String(req.body?.body || '').trim();
  if (body.length < 2) return jsonError(res, 400, 'متن پاسخ را وارد کنید.');
  await db.transaction().execute(async trx => {
    await trx.insertInto('support_messages').values({ id: uuid(), ticket_id: ticket.id, sender_id: req.user.id, body, created_at: now() }).execute();
    await trx.updateTable('support_tickets').set({
      status: 'answered', updated_at: now(),
      first_response_at: ticket.first_response_at || now(),
    }).where('id', '=', ticket.id).execute();
    await trx.insertInto('notifications').values({ id: uuid(), user_id: ticket.user_id, title: 'پاسخ جدید پشتیبانی', body: `برای گفتگوی ${ticket.ticket_no} پاسخ جدید ثبت شد.`, read_at: null, created_at: now() }).execute();
  });
  await audit(req, 'support_reply_sent', 'support_ticket', ticket.id);
  res.status(201).json({ ok: true });
}));
app.post('/api/admin/support/:id/notes', auth, adminOnly, asyncRoute(async (req, res) => {
  const body = String(req.body?.body || '').trim();
  if (body.length < 2 || body.length > 2000) return jsonError(res, 400, 'یادداشت داخلی باید بین ۲ تا ۲۰۰۰ نویسه باشد.');
  const ticket = await db.selectFrom('support_tickets').select('id').where('id', '=', req.params.id).executeTakeFirst();
  if (!ticket) return jsonError(res, 404, 'گفتگو پیدا نشد.');
  const id = uuid();
  await db.insertInto('support_notes').values({
    id, ticket_id: ticket.id, author_id: req.user.id, body, created_at: now(),
  }).execute();
  await audit(req, 'support_internal_note_added', 'support_ticket', ticket.id);
  res.status(201).json({ id });
}));

app.patch('/api/admin/support/:id/assignment', auth, adminOnly, asyncRoute(async (req, res) => {
  const parsed = z.object({ agentId: z.string().nullable() }).safeParse(req.body);
  if (!parsed.success) return jsonError(res, 400, 'پشتیبان انتخاب‌شده معتبر نیست.');
  const ticket = await db.selectFrom('support_tickets').select('id').where('id', '=', req.params.id).executeTakeFirst();
  if (!ticket) return jsonError(res, 404, 'گفتگو پیدا نشد.');
  const previous = await db.selectFrom('support_assignments').select('agent_id').where('ticket_id', '=', ticket.id).executeTakeFirst();
  await db.transaction().execute(async trx => {
  if (parsed.data.agentId) {
    const agent = await db.selectFrom('admin_members').innerJoin('users', 'users.id', 'admin_members.user_id')
      .select('users.id').where('users.id', '=', parsed.data.agentId).where('users.status', '=', 'active')
      .where('admin_members.section', '=', 'support').executeTakeFirst();
    if (!agent) return jsonError(res, 404, 'پشتیبان فعال پیدا نشد.');
    await trx.insertInto('support_assignments').values({ ticket_id: ticket.id, agent_id: agent.id, assigned_by: req.user.id, assigned_at: now() })
      .onConflict(oc => oc.column('ticket_id').doUpdateSet({ agent_id: agent.id, assigned_by: req.user.id, assigned_at: now() })).execute();
    await trx.updateTable('support_tickets').set({ agent_id: agent.id, updated_at: now() }).where('id', '=', ticket.id).execute();
  } else {
    await trx.deleteFrom('support_assignments').where('ticket_id', '=', ticket.id).execute();
    await trx.updateTable('support_tickets').set({ agent_id: null, updated_at: now() }).where('id', '=', ticket.id).execute();
  }
  await trx.insertInto('support_assignment_history').values({
    id: uuid(), ticket_id: ticket.id, from_agent_id: previous?.agent_id || null,
    to_agent_id: parsed.data.agentId || null, from_team_id: null, to_team_id: null,
    action: parsed.data.agentId ? (previous?.agent_id ? 'transfer' : 'assign') : 'unassign',
    reason: 'تغییر توسط مدیر اصلی', actor_id: req.user.id, created_at: now(),
  }).execute();
  });
  await audit(req, 'support_ticket_assigned', 'support_ticket', ticket.id);
  res.json({ ok: true });
}));

app.patch('/api/admin/support/:id/status', auth, adminOnly, asyncRoute(async (req, res) => {
  const parsed = z.object({ status: z.enum(['open', 'answered', 'closed']) }).safeParse(req.body);
  if (!parsed.success) return jsonError(res, 400, 'وضعیت گفتگو معتبر نیست.');
  const result = await db.updateTable('support_tickets').set({
    status: parsed.data.status, updated_at: now(),
    resolved_at: parsed.data.status === 'closed' ? now() : null,
  }).where('id', '=', req.params.id).executeTakeFirst();
  await audit(req, 'support_ticket_status_updated', 'support_ticket', req.params.id);
  res.json({ ok: true, changed: Number(result.numUpdatedRows || 0) });
}));

if (process.env.SERVE_WEB === 'true') {
  const dist = resolve(here, '../dist');
  const sendHtml = (res, file) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return res.sendFile(resolve(dist, file));
  };
  app.use(express.static(dist, {
    maxAge: '1y',
    immutable: true,
    etag: true,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
    },
  }));
  app.get('/admin', (_req, res) => sendHtml(res, 'admin.html'));
  app.get('/support', (_req, res) => sendHtml(res, 'support.html'));
  app.get('/sales', (_req, res) => sendHtml(res, 'sales.html'));
  app.get('/sales-admin', (_req, res) => sendHtml(res, 'sales.html'));
  app.get('/customer', (_req, res) => sendHtml(res, 'customer.html'));
  app.use((req, res, next) => req.method === 'GET' ? sendHtml(res, 'index.html') : next());
}

app.use((error, req, res, _next) => {
  console.error(error);
  const status = Number(error.status || 500);
  const message = process.env.NODE_ENV === 'production' && status >= 500
    ? 'خطایی در پردازش درخواست رخ داد.'
    : error.message;
  jsonError(res, status, message);
});

export async function ready() {
  if (isProduction()) {
    const sessionSecret = String(process.env.SESSION_SECRET || '');
    if (sessionSecret.length < 32 || /replace|change.?me|example/i.test(sessionSecret)) {
      throw new Error('SESSION_SECRET امن با حداقل ۳۲ نویسه برای Production تنظیم نشده است.');
    }
    if (!String(process.env.APP_ORIGINS || '').split(',').some(origin => /^https:\/\//i.test(origin.trim()))) {
      throw new Error('APP_ORIGINS باید در Production شامل دامنه HTTPS معتبر باشد.');
    }
    if (!/^\d+$/.test(String(process.env.TRUST_PROXY_HOPS || ''))) {
      throw new Error('TRUST_PROXY_HOPS باید در Production دقیقاً مطابق تعداد Proxyهای مورد اعتماد تنظیم شود.');
    }
    // Vercel functions cannot run or reach a local ClamAV daemon. Upload routes
    // still fail closed when no scanner is configured; do not crash unrelated
    // pages and authentication during server startup.
    if (!isVercel() && !String(process.env.CLAMAV_HOST || process.env.CLAMAV_COMMAND || '').trim()) {
      throw new Error('سرویس ClamAV برای اسکن اجباری پیوست‌ها در Production تنظیم نشده است.');
    }
    if (String(process.env.HEALTHCHECK_TOKEN || '').length < 24) {
      throw new Error('HEALTHCHECK_TOKEN تصادفی با حداقل ۲۴ نویسه برای Production تنظیم نشده است.');
    }
  }
  if (isProduction()) await assertSmsReadyForProduction();
  if (isProduction() && !process.env.DATABASE_URL) throw new Error('اجرای Production بدون PostgreSQL مجاز نیست.');
  if (isProduction() && ['mock', 'fixed'].includes(String(process.env.AI_PROVIDER || 'mock').toLowerCase())) throw new Error('Provider ساختگی هوش مصنوعی در Production مجاز نیست؛ disabled یا Provider واقعی انتخاب کنید.');
  if (isProduction() && String(process.env.AI_PROVIDER || 'disabled').toLowerCase() !== 'disabled' &&
      process.env.AI_DATA_PROCESSING_APPROVED !== 'true') {
    throw new Error('فعال‌سازی AI فقط پس از تأیید شرایط پردازش داده و تنظیم AI_DATA_PROCESSING_APPROVED=true مجاز است.');
  }
  await migrate();
  for (const [id, item] of Object.entries(catalog)) {
    const exists = await db.selectFrom('products').select('id').where('id', '=', id).executeTakeFirst();
    if (!exists) {
      const sku = `LEGACY-${id.toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 42)}`;
      await db.insertInto('products').values({
        id, sku, name: item.name, category: item.category || 'خدمات سازمانی', brand: 'راهکار',
        description: item.description || 'خدمت تخصصی سازمانی راهکار',
        price: item.unitPrice, compare_price: null, stock: item.productType === 'service' ? 0 : 100, reserved_stock: 0,
        low_stock_threshold: 0, image_url: item.imageUrl || null, status: 'published', featured: 1,
        slug: id, product_type: item.productType || 'service', tax_rate: 0, deleted_at: null,
        created_at: now(), updated_at: now(),
      }).execute();
      if (item.productType !== 'service') await db.insertInto('inventory_movements').values({
        id: uuid(), product_id: id, order_id: null, quantity: 100,
        reason: 'initial_catalog_stock', created_by: null, created_at: now(),
      }).execute();
      await db.insertInto('price_history').values({
        id: uuid(), product_id: id, variant_id: null, old_price: null,
        new_price: item.unitPrice, changed_by: null, created_at: now(),
      }).execute();
    }
  }
  let adminMobile = normalizeMobile(process.env.ADMIN_MOBILE || '');
  let existingAdmin = await db.selectFrom('users').select(['id', 'role', 'mobile']).where('role', '=', 'super_admin').where('deleted_at', 'is', null).executeTakeFirst();
  if (!/^09\d{9}$/.test(adminMobile)) {
    if (!existingAdmin) throw new Error('ADMIN_MOBILE معتبر برای ایجاد مدیر اولیه تنظیم نشده است.');
    adminMobile = existingAdmin.mobile;
  }
  const exists = await db.selectFrom('users').select(['id', 'role']).where('mobile', '=', adminMobile).executeTakeFirst();
  if (!exists) {
    const id = uuid();
    await db.transaction().execute(async trx => {
      await trx.insertInto('users').values({ id, mobile: adminMobile, role: 'super_admin', status: 'active', created_at: now() }).execute();
      await trx.insertInto('profiles').values({ user_id: id, full_name: 'مدیر راهکار', email: null, national_id: null, company: 'راهکار', job_title: 'مدیر سامانه', updated_at: now() }).execute();
    });
  } else if (exists.role !== 'super_admin') {
    throw new Error('ADMIN_MOBILE متعلق به یک حساب غیرمدیر است؛ ارتقای خودکار برای جلوگیری از تصاحب حساب متوقف شد. شماره‌ای مستقل تعیین کنید.');
  }
  const admin = await db.selectFrom('users').select('id').where('mobile', '=', adminMobile).executeTakeFirstOrThrow();
  const credential = await db.selectFrom('portal_credentials').select('user_id').where('user_id', '=', admin.id).executeTakeFirst();
  const forceCredentialReset = isProduction() && process.env.ADMIN_FORCE_CREDENTIAL_RESET === 'true';
  if (!credential || forceCredentialReset) {
    const initialUsername = String(process.env.ADMIN_INITIAL_USERNAME || '').trim();
    const passwordFile = String(process.env.ADMIN_INITIAL_PASSWORD_FILE || '').trim();
    let initialPassword = String(process.env.ADMIN_INITIAL_PASSWORD || '');
    if (passwordFile) {
      try { initialPassword = await readFile(passwordFile, 'utf8'); }
      finally { await unlink(passwordFile).catch(() => {}); }
    }
    if (!/^[A-Za-z][A-Za-z0-9._-]{3,39}$/.test(initialUsername) || !passwordIsStrong(initialPassword)) {
      throw new Error('ADMIN_INITIAL_USERNAME و ADMIN_INITIAL_PASSWORD امن برای ایجاد مدیر اولیه الزامی است.');
    }
    const credentialValues = {
      username: initialUsername,
      password_hash: passwordHash(initialPassword),
      must_change: 1,
      updated_at: now(),
    };
    if (credential) {
      await db.updateTable('portal_credentials').set(credentialValues).where('user_id', '=', admin.id).execute();
    } else {
      await db.insertInto('portal_credentials').values({ user_id: admin.id, ...credentialValues }).execute();
    }
  }
  return app;
}

export default app;
