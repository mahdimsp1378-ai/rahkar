import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const rootConfigPath = () => resolve(process.cwd(), process.env.SMS_CONFIG_FILE || 'sms.config.json');

const clean = value => String(value ?? '').trim();
const positiveInteger = value => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

async function readRootConfig() {
  try {
    const source = await readFile(rootConfigPath(), 'utf8');
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw new Error('فایل sms.config.json معتبر نیست یا JSON آن خطا دارد.');
  }
}

async function readSecret(path) {
  if (!clean(path)) return '';
  try { return clean(await readFile(path, 'utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

export async function getSmsConfig() {
  const file = await readRootConfig();
  const apiKeyFromFile = await readSecret(process.env.SMS_API_KEY_FILE);
  const environmentEnabled = clean(process.env.SMS_ENABLED).toLowerCase();
  const templates = file.templates && typeof file.templates === 'object' ? file.templates : {};
  const otp = templates.otp && typeof templates.otp === 'object' ? templates.otp : {};
  const adminWelcome = templates.adminWelcome && typeof templates.adminWelcome === 'object' ? templates.adminWelcome : {};
  return {
    enabled: environmentEnabled
      ? ['1', 'true', 'yes', 'on'].includes(environmentEnabled)
      : (process.env.SMS_PROVIDER ? true : file.enabled !== false),
    provider: clean(process.env.SMS_PROVIDER || file.provider || 'fixed').toLowerCase(),
    apiKey: clean(process.env.SMS_API_KEY || apiKeyFromFile || file.apiKey),
    timeoutMs: Math.min(30_000, Math.max(2_000, Number(file.timeoutMs || 10_000))),
    templates: {
      otp: {
        id: positiveInteger(process.env.SMS_TEMPLATE_ID || otp.id),
        name: clean(process.env.SMS_TEMPLATE || otp.name),
        parameters: { code: clean(otp.parameters?.code || process.env.SMS_TOKEN_NAME || 'CODE') },
      },
      adminWelcome: {
        id: positiveInteger(adminWelcome.id),
        name: clean(adminWelcome.name),
        parameters: {
          username: clean(adminWelcome.parameters?.username || 'USERNAME'),
          password: clean(adminWelcome.parameters?.password || 'PASSWORD'),
          portal: clean(adminWelcome.parameters?.portal || 'PORTAL'),
        },
      },
    },
    portalUrls: {
      support: clean(file.portalUrls?.support || process.env.SUPPORT_PORTAL_URL || '/support'),
      sales: clean(file.portalUrls?.sales || process.env.SALES_PORTAL_URL || '/sales'),
    },
  };
}

export async function assertSmsReadyForProduction() {
  const config = await getSmsConfig();
  // SMS is optional. When explicitly disabled, OTP endpoints can report that
  // the service is unavailable without preventing the whole app from starting.
  if (!config.enabled) return config;
  if (!['smsir', 'kavenegar'].includes(config.provider)) {
    throw new Error('در Production سرویس پیامک باید در sms.config.json با smsir یا kavenegar فعال شود.');
  }
  if (!config.apiKey) throw new Error('کلید API پیامک در sms.config.json تنظیم نشده است.');
  if (config.provider === 'smsir' && (!config.templates.otp.id || !config.templates.adminWelcome.id)) {
    throw new Error('شناسه قالب OTP و ورود اول مدیر در sms.config.json الزامی است.');
  }
  if (config.provider === 'kavenegar' && (!config.templates.otp.name || !config.templates.adminWelcome.name)) {
    throw new Error('نام قالب OTP و ورود اول مدیر در sms.config.json الزامی است.');
  }
  return config;
}
