import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const homePath = resolve(root, 'src', 'home-v3.jsx');
const publicDir = resolve(root, 'public');
const consultationPath = resolve(publicDir, 'ai-consultation.html');
const aiTarget = "onClick={() => { window.location.href = '/ai-consultation.html'; }}";

function patchChatButtons(source) {
  const labels = ['چت با هوش مصنوعی', 'گفتگو با هوش مصنوعی', 'گفت‌وگو با هوش مصنوعی'];
  let changed = 0;
  for (const label of labels) {
    const safeLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp("onClick=\\{\\(\\)\\s*=>\\s*navigateTo\\('\\/auth\\/login'\\)\\}([\\s\\S]{0,420}?" + safeLabel + ")", 'g'),
      new RegExp("onClick=\\{\\(\\)\\s*=>\\s*navigateTo\\('\\/support'\\)\\}([\\s\\S]{0,420}?" + safeLabel + ")", 'g'),
      new RegExp("onClick=\\{\\(\\)\\s*=>\\s*goSection\\('consultation'\\)\\}([\\s\\S]{0,420}?" + safeLabel + ")", 'g'),
      new RegExp("onClick=\\{\\(\\)\\s*=>\\s*document\\.getElementById\\('consultation'\\)\\?\\.scrollIntoView\\(\\{ behavior: 'smooth' \\}\\)\\}([\\s\\S]{0,420}?" + safeLabel + ")", 'g'),
    ];
    for (const pattern of patterns) {
      source = source.replace(pattern, (...args) => {
        changed += 1;
        return `${aiTarget}${args[1]}`;
      });
    }
  }
  source = source.replace(/data-rk-chat(\s|>)/g, `data-rk-chat data-rk-ai-consultation$1`);
  return { source, changed };
}

function patchMarketingEnhancements() {
  const candidates = [resolve(root, 'src', 'marketing-enhancements.js'), resolve(root, 'src', 'final-enhancements.js')];
  for (const path of candidates) {
    try {
      let source = readFileSync(path, 'utf8');
      const before = source;
      source = source.replace(/window\.location\.hash\s*=\s*['"]\/auth\/login['"]/g, "window.location.href = '/ai-consultation.html'");
      source = source.replace(/navigateTo\(['"]\/auth\/login['"]\)/g, "window.location.href = '/ai-consultation.html'");
      source = source.replace(/href\s*=\s*['"]#\/auth\/login['"]/g, "href='/ai-consultation.html'");
      if (source !== before) writeFileSync(path, source, 'utf8');
    } catch {}
  }
}

function patchHomeButton() {
  let source = readFileSync(homePath, 'utf8');
  const before = source;
  const result = patchChatButtons(source);
  source = result.source;
  if (source !== before) {
    writeFileSync(homePath, source, 'utf8');
    console.log(`Rahkar AI: ${result.changed} AI chat CTA target(s) now open /ai-consultation.html.`);
  } else {
    console.log('Rahkar AI: no additional homepage AI chat CTA patch was needed.');
  }
}

const consultationHtml = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>مشاوره هوش مصنوعی راهکار</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    :root{color-scheme:light;--blue:#0f4fcb;--cyan:#06b6d4;--dark:#061d37;--ink:#0f172a;--muted:#64748b;--line:#dbeafe;--bg:#eef7ff;--card:#fff;--font:'Vazirmatn','IRANSans','Segoe UI',Tahoma,Arial,sans-serif}
    *{box-sizing:border-box}html,body,input,select,textarea,button,a,label{font-family:var(--font)!important}body{margin:0;background:radial-gradient(circle at top right,#dff8ff,transparent 34%),linear-gradient(135deg,#eff6ff,#f8fafc);color:var(--ink);min-height:100vh}button,input,select,textarea{font:inherit!important;letter-spacing:0}::placeholder{font-family:var(--font);color:#94a3b8}.wrap{max-width:1120px;margin:0 auto;padding:28px 18px 56px}.top{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:26px}.brand{font-weight:900;font-size:24px;color:var(--blue)}.back{border:1px solid var(--line);background:#fff;border-radius:999px;padding:10px 16px;color:var(--blue);text-decoration:none;font-weight:800}.hero{display:grid;grid-template-columns:1fr 1fr;gap:22px;align-items:stretch}.panel{background:rgba(255,255,255,.92);border:1px solid var(--line);box-shadow:0 24px 70px rgba(37,99,235,.13);border-radius:28px;padding:28px}.dark{background:linear-gradient(145deg,#061d37,#0d355d);color:#fff}.dark p{color:#dbeafe}.hero h1{font-size:clamp(30px,5vw,56px);line-height:1.35;margin:0 0 14px;font-weight:900}.hero p{color:var(--muted);line-height:2;font-size:16px}.badge{display:inline-flex;gap:8px;align-items:center;background:#e0f2fe;color:#075985;border-radius:999px;padding:8px 13px;font-weight:900;margin-bottom:14px}.form{display:grid;gap:14px}.field{display:grid;gap:7px}.field label{font-weight:900;color:#0f172a}.field input,.field select,.field textarea{width:100%;border:1px solid #cbd5e1;border-radius:16px;padding:13px 14px;background:#fff;color:var(--ink);outline:none}.field input:focus,.field select:focus,.field textarea:focus{border-color:#0f4fcb;box-shadow:0 0 0 4px rgba(15,79,203,.11)}.field textarea{min-height:130px;resize:vertical}.hint{color:var(--muted);font-size:13px}.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.send{border:0;border-radius:18px;padding:15px 18px;background:linear-gradient(135deg,var(--blue),var(--cyan));color:#fff;font-weight:900;cursor:pointer;box-shadow:0 16px 35px rgba(37,99,235,.25)}.result{display:none;margin-top:16px;border:1px solid #bae6fd;background:#f0f9ff;border-radius:20px;padding:18px;line-height:2}.result.show{display:block}.result.error{border-color:#fecaca;background:#fff1f2;color:#9f1239}.cta{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.cta a{border-radius:999px;padding:10px 15px;text-decoration:none;font-weight:900}.primary{background:var(--blue);color:#fff}.secondary{background:#fff;color:var(--blue);border:1px solid var(--line)}.native-file{position:absolute;inline-size:1px;block-size:1px;opacity:0;pointer-events:none}.file-picker{display:flex;justify-content:space-between;align-items:center;gap:12px;border:1px dashed #93c5fd;border-radius:16px;background:#f8fbff;padding:13px 14px;cursor:pointer;color:#0f4fcb;font-weight:900}.file-picker small{font-weight:700;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.file-picker span{background:#dbeafe;border-radius:999px;padding:7px 12px;white-space:nowrap}.error-text{color:#dc2626;font-size:13px;font-weight:800;display:none}.field.invalid .error-text{display:block}.field.invalid input,.field.invalid select,.field.invalid textarea{border-color:#ef4444;box-shadow:0 0 0 4px rgba(239,68,68,.08)}
    @media(max-width:850px){.hero{grid-template-columns:1fr}.row{grid-template-columns:1fr}.top{align-items:flex-start;flex-direction:column}.panel{padding:22px}.file-picker{align-items:flex-start;flex-direction:column}}
  </style>
</head>
<body>
  <main class="wrap">
    <div class="top"><div class="brand">راهکار</div><a class="back" href="/">بازگشت به صفحه اصلی</a></div>
    <section class="hero">
      <div class="panel dark"><span class="badge">مشاوره اولیه AI</span><h1>با هوش مصنوعی گفت‌وگو کنید.</h1><p>مسئله سازمانی، وضعیت فعلی و نیاز خود را بنویسید تا یک جمع‌بندی اولیه و مسیر پیشنهادی دریافت کنید. برای بررسی تخصصی‌تر، ثبت‌نام را تکمیل کنید.</p></div>
      <form class="panel form" id="ai-form" novalidate>
        <div class="row"><div class="field"><label for="org">نام سازمان</label><input id="org" name="org" required placeholder="مثلاً شرکت راهکار" /><span class="error-text">لطفاً نام سازمان را وارد کنید.</span></div><div class="field"><label for="phone">شماره تماس</label><input id="phone" name="phone" inputmode="tel" placeholder="09xxxxxxxxx" /></div></div>
        <div class="row"><div class="field"><label for="size">اندازه سازمان</label><select id="size" name="size"><option>کمتر از ۵۰ نفر</option><option>۵۰ تا ۲۰۰ نفر</option><option>بیش از ۲۰۰ نفر</option></select></div><div class="field"><label for="topic">موضوع مشاوره</label><select id="topic" name="topic"><option>طراحی ایجنت‌های هوش مصنوعی</option><option>خودکارسازی فرایند</option><option>داشبورد مدیریتی</option><option>سامانه اختصاصی</option></select></div></div>
        <div class="field"><label for="problem">شرح نیاز</label><textarea id="problem" name="problem" required placeholder="مشکل، فرایند یا ایده‌ای که می‌خواهید هوشمند شود را توضیح دهید..."></textarea><span class="error-text">لطفاً شرح نیاز را وارد کنید.</span></div>
        <div class="field"><label for="files">فایل اختیاری</label><input class="native-file" id="files" name="files" type="file" multiple /><label class="file-picker" for="files"><span>انتخاب فایل</span><small id="file-label">فایلی انتخاب نشده است</small></label><span class="hint">در صورت نیاز می‌توانید نمونه فایل، تصویر یا توضیح تکمیلی بارگذاری کنید.</span></div>
        <button class="send" type="submit">دریافت پاسخ اولیه</button><div class="result" id="result"></div>
      </form>
    </section>
  </main>
  <script>
    var form = document.getElementById('ai-form');
    var result = document.getElementById('result');
    var fileInput = document.getElementById('files');
    var fileLabel = document.getElementById('file-label');
    fileInput.addEventListener('change', function () {
      var names = Array.prototype.slice.call(fileInput.files || []).map(function (file) { return file.name; });
      fileLabel.textContent = names.length ? names.join('، ') : 'فایلی انتخاب نشده است';
    });
    function showError(message) {
      result.className = 'result show error';
      result.textContent = message;
    }
    function validate() {
      var valid = true;
      Array.prototype.slice.call(form.querySelectorAll('[required]')).forEach(function (field) {
        var parent = field.closest('.field');
        var empty = !String(field.value || '').trim();
        if (parent) parent.classList.toggle('invalid', empty);
        if (empty && valid) field.focus();
        if (empty) valid = false;
      });
      if (!valid) showError('لطفاً فیلدهای ضروری را تکمیل کنید.');
      return valid;
    }
    form.addEventListener('input', function (event) {
      var parent = event.target.closest && event.target.closest('.field');
      if (parent && event.target.hasAttribute && event.target.hasAttribute('required')) parent.classList.toggle('invalid', !String(event.target.value || '').trim());
    });
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!validate()) return;
      result.className = 'result show';
      result.textContent = 'در حال آماده‌سازی پاسخ اولیه...';
      var data = new FormData(form);
      try {
        var response = await fetch('/api/public-ai/consultation', { method: 'POST', body: data });
        if (!response.ok) throw new Error('API unavailable');
        var json = await response.json();
        result.innerHTML = '<b>پاسخ اولیه:</b><br>' + (json.answer || json.message || 'درخواست شما ثبت شد. برای ادامه، ثبت‌نام را تکمیل کنید.') + '<div class="cta"><a class="primary" href="/#/auth/login">ادامه با ثبت‌نام</a><a class="secondary" href="/">بازگشت</a></div>';
      } catch (error) {
        result.innerHTML = '<b>جمع‌بندی اولیه:</b><br>برای پیشنهاد دقیق، لازم است فرایند فعلی، داده‌های موجود، نقش کاربران و خروجی مدیریتی مشخص شود. درخواست شما آماده بررسی است؛ برای ادامه ثبت‌نام را تکمیل کنید.<div class="cta"><a class="primary" href="/#/auth/login">ادامه با ثبت‌نام</a><a class="secondary" href="/">بازگشت</a></div>';
      }
    });
  </script>
</body>
</html>`;

mkdirSync(publicDir, { recursive: true });
patchHomeButton();
patchMarketingEnhancements();
writeFileSync(consultationPath, consultationHtml, 'utf8');
console.log('Rahkar AI: /ai-consultation.html is ready with normalized Persian typography.');
