import './home-v3.jsx';
import './final-enhancements.css';

const icon = type => ({
  brain: '<svg viewBox="0 0 24 24"><path d="M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-2 3 3 3 0 0 0 2 3v1a3 3 0 0 0 3 3M15 4a3 3 0 0 1 3 3v1a3 3 0 0 1 2 3 3 3 0 0 1-2 3v1a3 3 0 0 1-3 3M9 4v16M15 4v16M9 9h6M9 15h6"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3ZM18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14ZM6 13l.7 1.8L9 15.5l-2.3.7L6 18l-.7-1.8L3 15.5l2.3-.7L6 13Z"/></svg>',
  bot: '<svg viewBox="0 0 24 24"><path d="M9 4h6M12 4V2M6 8h12v9H6V8ZM9 12h.01M15 12h.01M9 16h6M4 11H2M22 11h-2"/></svg>',
}[type]);

function card(type, title, subtitle, body, insight) {
  const iconType = type === 'people' ? 'brain' : type === 'process' ? 'bot' : 'spark';
  return `<article class="rk-ai-dashboard-card rk-ai-${type}">
    <header><span>${icon(iconType)}</span><div><b>${title}</b><small>${subtitle}</small></div></header>
    ${body}
    <footer><span>${icon('spark')}</span><div><b>تحلیل هوشمند</b><p>${insight}</p></div></footer>
  </article>`;
}

function markup() {
  const people = card(
    'people',
    'سرمایه انسانی',
    'مشارکت، ریسک خروج و ترکیب کارکنان',
    `<div class="rk-card-kpis"><span><b>٪۷۶</b><small>مشارکت</small></span><span><b>۱۲</b><small>ریسک خروج</small></span><span><b>۱۳۲</b><small>کارکنان</small></span></div>
     <div class="rk-mini-bars">${[['عملیات', 88], ['فروش', 72], ['پشتیبانی', 61]].map(([label, value]) => `<div><small>${label}</small><span><i style="--v:${value}%"></i></span><b>${value}</b></div>`).join('')}</div>`,
    'افت مشارکت در واحد عملیات با افزایش اضافه‌کار هم‌زمان شده است.'
  );

  const process = card(
    'process',
    'فرایندهای هوشمند',
    'وضعیت گردش‌کار و زمان پاسخ',
    `<div class="rk-process-kpis"><span><b>۲۴</b><small>درخواست فعال</small></span><span><b>۱.۸ روز</b><small>زمان پاسخ</small></span></div>
     <div class="rk-flow-track"><i></i><span>ثبت درخواست</span><i></i><span>بررسی AI</span><i></i><span>تأیید نهایی</span></div>
     <div class="rk-flow-chart"><svg viewBox="0 0 300 90" preserveAspectRatio="none"><path d="M8 74 C55 70 65 48 112 52 S185 22 228 35 S270 16 292 12"/></svg></div>`,
    'گلوگاه اصلی در بررسی مدیر میانی است؛ خودکارسازی تأیید اولیه پیشنهاد می‌شود.'
  );

  const payroll = card(
    'payroll',
    'حقوق و بهره‌وری',
    'پرداخت، اضافه‌کار و روند هزینه',
    `<div class="rk-payroll-kpis"><span><b>۶۲.۸</b><small>میانگین پرداخت</small></span><span><b>٪۱۸</b><small>سهم اضافه‌کار</small></span></div>
     <div class="rk-ring-wrap"><div class="rk-mini-ring"><b>٪۳۱</b><small>مزایا و اضافه‌کار</small></div><ul><li><i></i>حقوق پایه</li><li><i></i>مزایا</li><li><i></i>اضافه‌کار</li></ul></div>`,
    'رشد اضافه‌کار از رشد تعداد کارکنان بیشتر است؛ بازبینی بار کاری توصیه می‌شود.'
  );

  return `<section class="rk-triple-dashboard" id="dashboard" data-rk-final-dashboard>
    <div class="rk-dashboard-shell">
      <div class="rk-dashboard-heading">
        <span>سه نمای تحلیلی</span>
        <h2>داشبوردهای هوشمند سازمان</h2>
        <p>سه داشبورد مکمل برای سرمایه انسانی، فرایندها و حقوق و بهره‌وری؛ هر کدام همراه با نمودار متحرک، تحلیل و پیشنهاد قابل‌اقدام هوش مصنوعی.</p>
      </div>
      <div class="rk-ai-dashboard-grid">${people}${process}${payroll}</div>
    </div>
  </section>`;
}

function replaceDashboard() {
  const current = document.querySelector('#dashboard');
  if (!current || current.hasAttribute('data-rk-final-dashboard')) return;
  current.outerHTML = markup();
}

const observer = new MutationObserver(replaceDashboard);
observer.observe(document.documentElement, { childList: true, subtree: true });
queueMicrotask(replaceDashboard);
window.addEventListener('hashchange', () => setTimeout(replaceDashboard, 40));
