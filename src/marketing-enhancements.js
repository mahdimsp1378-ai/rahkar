import './main.jsx';
import './marketing-enhancements.css';
import automationImage from './assets/rahkar/service-automation.webp';
import customSystemImage from './assets/rahkar/service-custom-system.webp';
import dashboardImage from './assets/rahkar/service-dashboard.webp';

const agentCards = [
  ['گردش‌کار هوشمند', 'درخواست‌ها، تأییدها و پیگیری‌های تکراری را اجرا می‌کند و وضعیت هر مرحله را ثبت می‌کند.'],
  ['ایجنت تحلیل تصمیم', 'روی داده‌های سازمان تحلیل انجام می‌دهد و هشدار، جمع‌بندی و پیشنهاد اقدام ارائه می‌کند.'],
  ['ایجنت پاسخ‌گوی کارکنان', 'به پرسش‌های منابع انسانی براساس رویه‌ها، مستندات و دانش داخلی سازمان پاسخ می‌دهد.'],
  ['ایجنت گزارش‌ساز', 'داده‌های خام را به گزارش مدیریتی، تحلیل مغایرت و خروجی قابل ارائه تبدیل می‌کند.'],
  ['ایجنت هماهنگ‌ساز', 'بین فرم‌ها، واحدها و سامانه‌ها ارتباط ایجاد می‌کند تا فرایند بدون وقفه پیش برود.'],
  ['ایجنت پایش فرایند', 'گلوگاه‌ها، زمان‌های تأخیر و خطاهای پرتکرار را شناسایی و برای بهبود پیشنهاد می‌دهد.'],
];

const topics = [
  'طراحی ایجنت‌های هوش مصنوعی',
  'خودکارسازی فرایندهای سازمانی',
  'داشبورد جذب، تسویه و حقوق و دستمزد',
  'طراحی سامانه اختصاصی سازمان',
  'یکپارچه‌سازی داده و گزارش‌سازی',
];

const icon = name => ({
  flow: '<svg viewBox="0 0 24 24"><path d="M5 4v5h5M19 20v-5h-5M7 9a7 7 0 0 1 11-3M17 15a7 7 0 0 1-11 3"/></svg>',
  brain: '<svg viewBox="0 0 24 24"><path d="M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-2 3 3 3 0 0 0 2 3v1a3 3 0 0 0 3 3M15 4a3 3 0 0 1 3 3v1a3 3 0 0 1 2 3 3 3 0 0 1-2 3v1a3 3 0 0 1-3 3M9 4v16M15 4v16M9 9h6M9 15h6"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M5 5h14v11H9l-4 3V5Z"/><path d="M8 9h8M8 12h5"/></svg>',
  report: '<svg viewBox="0 0 24 24"><path d="M6 3h9l3 3v15H6V3Z"/><path d="M15 3v4h4M9 11h6M9 15h6"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 13a4 4 0 0 0 6 0l2-2a4 4 0 0 0-6-6l-1 1M14 11a4 4 0 0 0-6 0l-2 2a4 4 0 0 0 6 6l1-1"/></svg>',
  monitor: '<svg viewBox="0 0 24 24"><path d="M4 4h16v12H4V4ZM8 20h8M12 16v4"/><path d="m7 12 3-3 2 2 4-4"/></svg>',
}[name]);

function smartProcessesMarkup() {
  const icons = ['flow', 'brain', 'chat', 'report', 'link', 'monitor'];
  return `
    <section class="rk-enhance-section rk-agents" id="smart-processes" data-rk-enhancement>
      <div class="rk-section-heading rk-split-heading">
        <div><span>ایجنت‌های سازمانی</span><h2>فرایندها هوشمند می‌شوند</h2></div>
        <p>تمرکز راهکار بر طراحی ایجنت‌های هوش مصنوعی و خودکارسازی فرایندهاست؛ ابزارهایی که در جریان واقعی کار قرار می‌گیرند، فعالیت‌های تکراری را کاهش می‌دهند و تصمیم‌گیری را سریع‌تر می‌کنند.</p>
      </div>
      <div class="rk-agent-layout">
        <div class="rk-agent-visuals">
          <figure class="rk-agent-image rk-agent-image-main"><img src="${automationImage}" alt="خودکارسازی فرایندها با هوش مصنوعی"><figcaption>ایجنت‌های هوشمند در مسیر واقعی فرایند</figcaption></figure>
          <figure class="rk-agent-image rk-agent-image-small"><img src="${customSystemImage}" alt="طراحی سامانه هوشمند سازمانی"><figcaption>اتصال ایجنت به سامانه و داده سازمان</figcaption></figure>
        </div>
        <div class="rk-agent-grid">${agentCards.map(([title, text], index) => `
          <article><div class="rk-agent-icon">${icon(icons[index])}</div><h3>${title}</h3><p>${text}</p></article>`).join('')}
        </div>
      </div>
    </section>`;
}

function dashboardMarkup() {
  return `
    <section class="rk-enhance-section rk-dashboard-section" id="dashboards" data-rk-enhancement>
      <div class="rk-section-heading rk-split-heading">
        <div><span>نمونه داشبورد هوشمند</span><h2>جذب، تسویه و حقوق و دستمزد در یک نمای تحلیلی</h2></div>
        <p>این نمونه نشان می‌دهد داشبورد چگونه داده‌های منابع انسانی را با تحلیل هوش مصنوعی ترکیب می‌کند تا مدیر علاوه بر شاخص‌ها، هشدار و پیشنهاد اقدام نیز دریافت کند.</p>
      </div>
      <div class="rk-dashboard-layout">
        <div class="rk-dashboard-copy">
          <article><b>جذب و استخدام</b><p>تعداد درخواست‌ها، مرحله جذب، زمان تکمیل و نرخ تبدیل نامزدها قابل‌ردیابی است.</p></article>
          <article><b>تسویه و خروج</b><p>روند خروج، علت‌های تسویه، مصاحبه خروج و زمان بستن پرونده‌ها تحلیل می‌شود.</p></article>
          <article><b>حقوق و دستمزد</b><p>حقوق پایه، مزایا، اضافه‌کار و مغایرت‌های پرداخت در کنار روندهای ماهانه نمایش داده می‌شوند.</p></article>
          <div class="rk-ai-summary"><span class="rk-ai-badge">AI</span><div><b>جمع‌بندی هوشمند</b><p>«رشد اضافه‌کار واحد عملیات با افزایش تسویه هم‌زمان شده است؛ بررسی بار کاری و برنامه نگهداشت پیشنهاد می‌شود.»</p></div></div>
        </div>
        <div class="rk-dashboard-window">
          <div class="rk-window-bar"><i></i><i></i><i></i><span>داشبورد تحلیلی سرمایه انسانی</span></div>
          <div class="rk-kpis"><article><small>درخواست جذب فعال</small><strong>۲۴</strong><em>+۶ این ماه</em></article><article><small>تسویه این ماه</small><strong>۹</strong><em>۳ پرونده در بررسی</em></article><article><small>میانگین پرداخت</small><strong>۶۲.۸</strong><em>میلیون تومان</em></article></div>
          <div class="rk-dashboard-grid">
            <section class="rk-mini-panel"><header><b>قیف جذب</b><span>وضعیت مراحل استخدام</span></header>${[['درخواست',86],['مصاحبه',64],['پیشنهاد',43],['استخدام',29]].map(([label,value])=>`<div class="rk-bar-row"><small>${label}</small><span><i style="width:${value}%"></i></span><b>${value}</b></div>`).join('')}</section>
            <section class="rk-mini-panel"><header><b>ترکیب پرداخت</b><span>حقوق، مزایا و اضافه‌کار</span></header><div class="rk-payroll-ring"><strong>۳۱٪</strong><small>مزایا و اضافه‌کار</small></div><ul><li><i></i>حقوق پایه</li><li><i></i>مزایا</li><li><i></i>اضافه‌کار</li></ul></section>
            <section class="rk-mini-panel rk-wide-panel"><header><b>روند حقوق و تسویه</b><span>چهار ماه اخیر</span></header><div class="rk-line-chart"><svg viewBox="0 0 520 150" preserveAspectRatio="none"><path class="rk-area" d="M12 125 C90 112 125 120 180 82 S280 48 340 76 S430 45 508 28 L508 145 L12 145 Z"/><path class="rk-line" d="M12 125 C90 112 125 120 180 82 S280 48 340 76 S430 45 508 28"/></svg><i style="left:3%;top:78%"></i><i style="left:34%;top:49%"></i><i style="left:65%;top:46%"></i><i style="left:96%;top:14%"></i></div><div class="rk-chart-labels"><span>اردیبهشت</span><span>خرداد</span><span>تیر</span><span>مرداد</span></div></section>
          </div>
          <div class="rk-dashboard-image"><img src="${dashboardImage}" alt="نمونه داشبورد هوشمند راهکار"></div>
        </div>
      </div>
    </section>`;
}

function consultationMarkup() {
  return `
    <section class="rk-enhance-section rk-consultation" id="consultation" data-rk-enhancement>
      <div class="rk-consultation-shell">
        <div class="rk-consultation-copy"><span>دریافت مشاوره</span><h2>برای شروع، مسئله سازمانتان را با ما در میان بگذارید.</h2><p>اطلاعات تماس و شرح کوتاهی از نیازتان را ثبت کنید تا درباره طراحی ایجنت، خودکارسازی فرایند، داشبورد یا سامانه اختصاصی با شما تماس بگیریم.</p><div class="rk-consultation-points"><div><b>گفت‌وگوی تخصصی</b><small>شناخت دقیق فرایند، داده و نتیجه مورد انتظار</small></div><div><b>طراحی مسیر اجرا</b><small>پیشنهاد ترکیب مناسب از سامانه و هوش مصنوعی</small></div><div><b>فازبندی و برآورد</b><small>تعریف مراحل اجرا و مدل همکاری متناسب</small></div></div></div>
        <form class="rk-consultation-form"><label>نام و نام خانوادگی<input name="fullName" required></label><label>نام سازمان<input name="organization" required></label><label>شماره تماس<input name="phone" inputmode="tel" placeholder="09xxxxxxxxx" required></label><label>موضوع مشاوره<select name="topic">${topics.map(topic=>`<option>${topic}</option>`).join('')}</select></label><label class="rk-full-field">شرح نیاز<textarea name="message" rows="5" required></textarea></label><div class="rk-form-state rk-full-field" aria-live="polite"></div><button class="rk-full-field" type="submit">ثبت درخواست مشاوره</button></form>
      </div>
    </section>`;
}

function bindConsultation(root) {
  const form = root.querySelector('.rk-consultation-form');
  if (!form || form.dataset.bound) return;
  form.dataset.bound = '1';
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    const state = form.querySelector('.rk-form-state');
    const values = Object.fromEntries(new FormData(form).entries());
    button.disabled = true;
    button.textContent = 'در حال ثبت…';
    state.className = 'rk-form-state rk-full-field';
    state.textContent = '';
    try {
      const response = await fetch('/api/consultation-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'ثبت درخواست ناموفق بود.');
      form.reset();
      state.classList.add('success');
      state.textContent = 'درخواست شما ثبت شد. به‌زودی با شما تماس می‌گیریم.';
    } catch (error) {
      state.classList.add('error');
      state.textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = 'ثبت درخواست مشاوره';
    }
  });
}

function addNavigation(nav) {
  const items = [['smart-processes', 'فرایندهای هوشمند'], ['dashboards', 'داشبوردها'], ['consultation', 'دریافت مشاوره']];
  for (const [id, label] of items) {
    if (nav.querySelector(`[data-rk-nav="${id}"]`)) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.rkNav = id;
    button.textContent = label;
    button.addEventListener('click', () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    nav.append(button);
  }
}

function enhanceHome() {
  const main = document.querySelector('.marketing-page main');
  const capabilities = main?.querySelector('.capabilities');
  const aiBanner = main?.querySelector('.ai-banner');
  const process = main?.querySelector('.process');
  if (!main || !capabilities || !aiBanner || !process) return;

  if (!main.querySelector('#smart-processes')) capabilities.insertAdjacentHTML('afterend', smartProcessesMarkup());
  if (!main.querySelector('#dashboards')) aiBanner.insertAdjacentHTML('beforebegin', dashboardMarkup());
  if (!main.querySelector('#consultation')) process.insertAdjacentHTML('afterend', consultationMarkup());
  bindConsultation(main);

  const nav = document.querySelector('.site-header nav');
  if (nav) addNavigation(nav);

  const primary = document.querySelector('.hero .primary-cta');
  if (primary && !primary.dataset.rkConsultation) {
    primary.dataset.rkConsultation = '1';
    primary.innerHTML = 'دریافت مشاوره <span aria-hidden="true">←</span>';
    primary.onclick = event => { event.preventDefault(); document.getElementById('consultation')?.scrollIntoView({ behavior: 'smooth' }); };
  }
}

const observer = new MutationObserver(enhanceHome);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('hashchange', () => setTimeout(enhanceHome, 30));
queueMicrotask(enhanceHome);
