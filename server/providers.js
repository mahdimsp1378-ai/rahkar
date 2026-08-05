import { getSmsConfig } from './sms-config.js';

const responseError = async (response, fallback) => {
  let detail = '';
  try { detail = JSON.stringify(await response.json()).slice(0, 500); } catch { detail = ''; }
  const error = new Error(fallback);
  error.providerStatus = response.status;
  error.providerDetail = detail;
  return error;
};

async function sendTemplate({ mobile, templateType, values }) {
  const config = await getSmsConfig();
  if (!config.enabled || config.provider === 'fixed') {
    return { provider: config.provider, delivered: false, demoCode: values.code || null };
  }
  if (!config.apiKey) throw new Error('کلید API پیامک در sms.config.json تنظیم نشده است.');
  const template = config.templates[templateType];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    if (config.provider === 'smsir') {
      if (!template?.id) throw new Error(`شناسه قالب ${templateType} در sms.config.json تنظیم نشده است.`);
      const parameters = Object.entries(values).map(([key, value]) => ({
        name: template.parameters[key], value: String(value),
      }));
      const response = await fetch('https://api.sms.ir/v1/send/verify', {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': config.apiKey },
        body: JSON.stringify({ mobile, templateId: template.id, parameters }),
      });
      if (!response.ok) throw await responseError(response, 'ارسال پیامک SMS.ir ناموفق بود.');
      return { provider: config.provider, delivered: true };
    }
    if (config.provider === 'kavenegar') {
      if (!template?.name) throw new Error(`نام قالب ${templateType} در sms.config.json تنظیم نشده است.`);
      const tokens = Object.values(values).map(value => String(value));
      const url = new URL(`https://api.kavenegar.com/v1/${config.apiKey}/verify/lookup.json`);
      url.searchParams.set('receptor', mobile);
      url.searchParams.set('template', template.name);
      tokens.slice(0, 3).forEach((value, index) => url.searchParams.set(index ? `token${index + 1}` : 'token', value));
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw await responseError(response, 'ارسال پیامک کاوه‌نگار ناموفق بود.');
      return { provider: config.provider, delivered: true };
    }
    throw new Error('سرویس پیامک پشتیبانی نمی‌شود.');
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('مهلت اتصال به سرویس پیامک به پایان رسید.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendOtp({ mobile, code }) {
  return sendTemplate({ mobile, templateType: 'otp', values: { code } });
}

export async function sendAdminWelcome({ mobile, username, temporaryPassword, portal }) {
  const config = await getSmsConfig();
  const portalUrl = config.portalUrls[portal];
  if (!portalUrl) throw new Error('آدرس سامانه مدیر در sms.config.json تنظیم نشده است.');
  return sendTemplate({
    mobile,
    templateType: 'adminWelcome',
    values: { username, password: temporaryPassword, portal: portalUrl },
  });
}

export async function preparePayment({ amount, description, mobile, orderId }) {
  const provider = (process.env.PAYMENT_PROVIDER || 'disabled').toLowerCase();
  if (provider === 'disabled') {
    return { provider, active: false, gatewayUrl: null, authority: null };
  }
  if (provider !== 'zarinpal') throw new Error('درگاه انتخاب‌شده پشتیبانی نمی‌شود.');
  const merchantId = process.env.ZARINPAL_MERCHANT_ID;
  if (!merchantId) throw new Error('ZARINPAL_MERCHANT_ID تنظیم نشده است.');
  const callbackUrl = `${process.env.PAYMENT_CALLBACK_URL}?order=${encodeURIComponent(orderId)}`;
  const response = await fetch('https://payment.zarinpal.com/pg/v4/payment/request.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      merchant_id: merchantId,
      amount: Number(amount) * 10,
      callback_url: callbackUrl,
      description,
      metadata: { mobile },
    }),
  });
  const result = await response.json();
  const authority = result?.data?.authority;
  if (!response.ok || !authority) throw new Error('ایجاد درخواست درگاه ناموفق بود.');
  return {
    provider,
    active: true,
    authority,
    gatewayUrl: `https://payment.zarinpal.com/pg/StartPay/${authority}`,
  };
}

export async function verifyPayment({ authority, amount }) {
  const provider = (process.env.PAYMENT_PROVIDER || 'disabled').toLowerCase();
  if (provider === 'disabled') throw new Error('درگاه پرداخت در این محیط فعال نیست.');
  if (provider !== 'zarinpal') throw new Error('درگاه انتخاب‌شده پشتیبانی نمی‌شود.');
  const merchantId = process.env.ZARINPAL_MERCHANT_ID;
  if (!merchantId || !authority) throw new Error('اطلاعات تأیید پرداخت کامل نیست.');
  const response = await fetch('https://payment.zarinpal.com/pg/v4/payment/verify.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      merchant_id: merchantId,
      amount: Number(amount) * 10,
      authority,
    }),
  });
  const result = await response.json();
  const code = Number(result?.data?.code);
  if (!response.ok || ![100, 101].includes(code)) {
    const error = new Error(`تأیید پرداخت ناموفق بود (کد ${code || 'نامشخص'}).`);
    error.providerCode = code || null;
    throw error;
  }
  return {
    verified: true,
    alreadyVerified: code === 101,
    transactionId: String(result.data.ref_id),
    cardHash: result.data.card_hash || null,
    fee: Number(result.data.fee || 0) / 10,
  };
}
