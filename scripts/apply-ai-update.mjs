import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const homePath = resolve(root, 'src', 'home-v3.jsx');
const publicDir = resolve(root, 'public');
const consultationPath = resolve(publicDir, 'ai-consultation.html');

function patchHomeButton() {
  let source = readFileSync(homePath, 'utf8');
  const before = source;
  source = source.replace(
    /onClick=\{\(\) => navigateTo\('\/auth\/login'\)\}>چت با هوش مصنوعی<\/button>/g,
    "onClick={() => { window.location.href = '/ai-consultation.html'; }}>چت با هوش مصنوعی</button>"
  );
  source = source.replace(
    /onClick=\{\(\) => navigateTo\('\/auth\/login'\)\}([^>]*?)>\s*چت با هوش مصنوعی\s*<\/button>/g,
    "onClick={() => { window.location.href = '/ai-consultation.html'; }}$1>چت با هوش مصنوعی</button>"
  );
  if (source !== before) {
    writeFileSync(homePath, source, 'utf8');
    console.log('Rahkar AI: homepage AI chat button now opens /ai-consultation.html.');
  } else {
    console.log('Rahkar AI: homepage AI chat button patch was not needed or pattern was already changed.');
  }
}

const consultationHtml = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>مشاوره هوش مصنوعی راهکار</title>
  <style>
    :root{color-scheme:light;--blue:#1d4ed8;--cyan:#06b6d4;--ink:#0f172a;--muted:#64748b;--line:#dbeafe;--bg:#eef7ff;--card:#ffffff}
    *{box-sizing:border-box}body{margin:0;font-family:Vazirmatn,Tahoma,Arial,sans-serif;background:radial-gradient(circle at top right,#dff8ff,transparent 34%),linear-gradient(135deg,#eff6ff,#f8fafc);color:var(--ink);min-height:100vh}
    .wrap{max-width:1120px;margin:0 auto;padding:28px 18px 56px}.top{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:26px}.brand{font-weight:900;font-size:24px;color:var(--blue)}.back{border:1px solid var(--line);background:#fff;border-radius:999px;padding:10px 16px;color:var(--blue);text-decoration:none;font-weight:800}
    .hero{display:grid;grid-template-columns:1.1fr .9fr;gap:22px;align-items:stretch}.panel{background:rgba(255,255,255,.86);border:1px solid var(--line);box-shadow:0 24px 70px rgba(37,99,235,.13);border-radius:28px;padding:28px}.hero h1{font-size:clamp(30px,5vw,58px);line-height:1.25;margin:0 0 14px}.hero p{color:var(--muted);line-height:2;font-size:16px}.badge{display:inline-flex;gap:8px;align-items:center;background:#e0f2fe;color:#075985;border-radius:999px;padding:8px 13px;font-weight:800;margin-bottom:14px}.steps{display:grid;gap:12px;margin-top:18px}.step{display:flex;gap:12px;align-items:flex-start;background:#f8fafc;border:1px solid #e2e8f0;border-radius:18px;padding:13px}.step b{display:grid;place-items:center;min-width:34px;height:34px;border-radius:12px;background:linear-gradient(135deg,var(--blue),var(--cyan));color:#fff}.form{display:grid;gap:14px}.field{display:grid;gap:7px}.field label{font-weight:800}.field input,.field select,.field textarea{width:100%;border:1px solid #cbd5e1;border-radius:16px;padding:13px 14px;font:inherit;background:#fff;color:var(--ink)}.field textarea{min-height:125px;resize:vertical}.hint{color:var(--muted);font-size:13px}.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.send{border:0;border-radius:18px;padding:15px 18px;background:linear-gradient(135deg,var(--blue),var(--cyan));color:#fff;font:inherit;font-weight:900;cursor:pointer;box-shadow:0 16px 35px rgba(37,99,235,.25)}.result{display:none;margin-top:16px;border:1px solid #bae6fd;background:#f0f9ff;border-radius:20px;padding:18px;line-height:2}.result.show{display:block}.cta{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.cta a{border-radius:999px;padding:10px 15px;text-decoration:none;font-weight:900}.primary{background:var(--blue);color:#fff}.secondary{background:#fff;color:var(--blue);border:1px solid var(--line)}
    @media(max-width:850px){.hero{grid-template-columns:1fr}.row{grid-template-columns:1fr}.top{align-items:flex-start;flex-direction:column}}
  </style>
</head>
<body>
  <main class="wrap">
    <div class="top"><div class="brand">راهکار</div><a class="back" href="/">بازگشت به صفحه اصلی</a></div>
    <section class="hero">
      <div class="panel">
        <span class="badge">مشاوره اولیه هوش مصنوعی</span>
        <h1>مسئله سازمانت را بگو؛ مسیر هوشمندسازی را بگیر.</h1>
        <p>این صفحه برای کاربران مهمان ساخته شده است. اطلاعات اولیه سازمان و مشکل را وارد کن تا یک جمع‌بندی اولیه و مسیر پیشنهادی دریافت کنی. برای تحلیل کامل، تاریخچه گفتگو، فایل‌های بیشتر و تنظیمات اختصاصی API باید وارد حساب شوی.</p>
        <div class="steps">
          <div class="step"><b>۱</b><span>اطلاعات سازمان و نوع مسئله را وارد کن.</span></div>
          <div class="step"><b>۲</b><span>در صورت نیاز یک فایل نمونه یا توضیح تکمیلی اضافه کن.</span></div>
          <div class="step"><b>۳</b><span>پاسخ اولیه را بگیر و برای ادامه وارد پنل اختصاصی شو.</span></div>
        </div>
      </div>
      <div class="panel">
        <form class="form" id="aiForm">
          <div class="row">
            <div class="field"><label>نام سازمان</label><input name="org" required placeholder="مثلاً شرکت راهکار" /></div>
            <div class="field"><label>اندازه سازمان</label><select name="size"><option>کمتر از ۵۰ نفر</option><option>۵۰ تا ۲۰۰ نفر</option><option>۲۰۰ تا ۱۰۰۰ نفر</option><option>بیش از ۱۰۰۰ نفر</option></select></div>
          </div>
          <div class="field"><label>حوزه نیاز</label><select name="topic"><option>خودکارسازی فرایندها</option><option>داشبورد مدیریتی و تحلیل داده</option><option>سامانه اختصاصی سازمانی</option><option>هوش مصنوعی منابع انسانی</option><option>یکپارچه‌سازی داده‌ها</option></select></div>
          <div class="field"><label>شرح مسئله</label><textarea name="problem" required placeholder="مشکل فعلی، داده‌های موجود، خروجی مورد انتظار و محدودیت‌ها را بنویسید..."></textarea></div>
          <div class="field"><label>فایل پیوست اختیاری</label><input name="file" type="file" /><span class="hint">در نسخه عمومی، فایل فقط برای آماده‌سازی درخواست ثبت می‌شود. تحلیل کامل فایل در پنل اختصاصی انجام می‌شود.</span></div>
          <button class="send" type="submit">دریافت پاسخ اولیه</button>
        </form>
        <div class="result" id="result"></div>
      </div>
    </section>
  </main>
  <script>
    const form = document.getElementById('aiForm');
    const result = document.getElementById('result');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const data = new FormData(form);
      const org = data.get('org') || 'سازمان شما';
      const topic = data.get('topic') || 'هوشمندسازی';
      const problem = data.get('problem') || '';
      result.className = 'result show';
      result.innerHTML = '<b>در حال آماده‌سازی پاسخ اولیه...</b>';
      try {
        const apiForm = new FormData();
        apiForm.append('organization_name', org);
        apiForm.append('organization_size', data.get('size') || 'نامشخص');
        apiForm.append('topic', topic);
        apiForm.append('problem', problem);
        const file = data.get('file');
        if (file && file.size) apiForm.append('files', file);
        const response = await fetch('/api/public-ai-consultation/message', { method: 'POST', body: apiForm });
        if (response.ok) {
          const payload = await response.json();
          if (payload?.answer) {
            result.innerHTML = '<b>پاسخ اولیه هوش مصنوعی:</b><br>' + String(payload.answer).replace(/\n/g, '<br>') + '<div class="cta"><a class="primary" href="/#/auth/register">ثبت‌نام و ادامه مشاوره</a><a class="secondary" href="/">بازگشت</a></div>';
            return;
          }
        }
        throw new Error('AI API is not ready');
      } catch (error) {
        result.innerHTML = '<b>جمع‌بندی اولیه:</b><br>برای «' + topic + '» در ' + org + '، مسیر پیشنهادی از شناخت دقیق فرایند، فهرست‌کردن داده‌های موجود، طراحی داشبورد یا ایجنت اولیه و سپس اجرای پایلوت شروع می‌شود. مسئله‌ای که نوشتید باید به خروجی قابل‌اندازه‌گیری تبدیل شود؛ مثل کاهش زمان گزارش‌گیری، کاهش خطا، خودکارسازی تأییدها یا تولید گزارش مدیریتی. برای تحلیل کامل‌تر، فایل‌ها، تاریخچه گفتگو و مدل اختصاصی باید در پنل کاربری فعال شود.<div class="cta"><a class="primary" href="/#/auth/register">ثبت‌نام و ادامه مشاوره</a><a class="secondary" href="/">بازگشت</a></div>';
      }
    });
  </script>
</body>
</html>`;

mkdirSync(publicDir, { recursive: true });
writeFileSync(consultationPath, consultationHtml, 'utf8');
patchHomeButton();
console.log('Rahkar AI safe deployment patch completed.');
