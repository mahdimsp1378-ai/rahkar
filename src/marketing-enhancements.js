import './main.jsx';
import './marketing-enhancements.css';

const topics = [
  'طراحی ایجنت‌های هوش مصنوعی',
  'خودکارسازی فرایندهای سازمانی',
  'داشبورد و تحلیل داده‌های منابع انسانی',
  'طراحی سامانه اختصاصی سازمان',
];

const icon = type => ({
  ai: '<svg viewBox="0 0 24 24"><path d="M12 3a4 4 0 0 0-4 4v1a3 3 0 0 0-2 3 3 3 0 0 0 2 3v1a4 4 0 0 0 4 4m0-16a4 4 0 0 1 4 4v1a3 3 0 0 1 2 3 3 3 0 0 1-2 3v1a4 4 0 0 1-4 4M9 9h6M9 15h6M12 3v18"/></svg>',
  flow: '<svg viewBox="0 0 24 24"><path d="M5 5h6v5H5zM13 14h6v5h-6zM8 10v4h8M16 10v4"/></svg>',
  dash: '<svg viewBox="0 0 24 24"><path d="M4 19V5M4 19h16M8 15l3-4 3 2 4-6"/></svg>',
  data: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.6 2.8 8.3 7 10 4.2-1.7 7-5.4 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4V5Z"/><path d="M8 9h8M8 12h5"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3ZM19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14Z"/></svg>',
}[type]);

const services = [
  {
    icon: 'ai', title: 'ایجنت‌ها و خودکارسازی هوشمند',
    text: 'طراحی ایجنت‌های تخصصی برای اجرای درخواست‌ها، پاسخ‌گویی، تحلیل داده و هماهنگی گردش‌کارها.',
    bullets: ['ایجنت اجرای فرایند', 'ایجنت تحلیل و تصمیم', 'ایجنت پاسخ‌گوی سازمانی'],
  },
  {
    icon: 'flow', title: 'سامانه اختصاصی سازمان',
    text: 'طراحی سامانه متناسب با ساختار، نقش‌ها، سطح دسترسی و فرایندهای واقعی سازمان شما.',
    bullets: ['پنل‌های چندسطحی', 'گردش تأیید و ثبت رخداد', 'اتصال واحدها و سامانه‌ها'],
  },
  {
    icon: 'dash', title: 'داده و داشبورد هوشمند',
    text: 'تبدیل داده‌های پراکنده به شاخص، نمودار، هشدار و تحلیل مدیریتی قابل‌اقدام.',
    bullets: ['ورود و کنترل کیفیت داده', 'داشبورد مدیریتی', 'گزارش و تحلیل هوشمند'],
  },
];

const steps = [
  ['۰۱', 'شناخت مسئله'], ['۰۲', 'طراحی راهکار'], ['۰۳', 'ساخت و یکپارچه‌سازی'], ['۰۴', 'استقرار و همراهی'],
];

function heroAiMarkup() {
  return `<div class="rk-hero-ai" data-rk-hero-ai aria-hidden="true">
    <span class="rk-orbit rk-orbit-a">${icon('ai')}</span>
    <span class="rk-orbit rk-orbit-b">${icon('data')}</span>
    <span class="rk-orbit rk-orbit-c">${icon('dash')}</span>
  </div>`;
}

function unifiedServicesMarkup() {
  return `
    <section class="rk-enhance-section rk-unified-services" id="services" data-rk-enhancement>
      <div class="rk-section-heading rk-split-heading">
        <div><span>معرفی خدمات</span><h2>از مسئله سازمان تا راهکار هوشمند</h2></div>
        <p>خدمات راهکار در سه محور به‌هم‌پیوسته ارائه می‌شوند؛ هوش مصنوعی، سامانه اختصاصی و داشبورد داده، همگی در یک مسیر اجرایی منسجم.</p>
      </div>
      <div class="rk-service-grid">${services.map(service => `
        <article>
          <div class="rk-service-icon"><span></span>${icon(service.icon)}</div>
          <h3>${service.title}</h3><p>${service.text}</p>
          <ul>${service.bullets.map(item => `<li>${item}</li>`).join('')}</ul>
        </article>`).join('')}</div>
      <div class="rk-process-strip">${steps.map(([no, title]) => `<div><b>${no}</b><span>${title}</span></div>`).join('')}</div>
      <div class="rk-service-cta">
        <div><span>گام بعدی</span><h3>با دستیار هوشمند گفت‌وگو کنید یا درخواست جلسه ثبت کنید.</h3><p>برای صورت‌بندی نیاز اولیه از چت هوشمند استفاده کنید؛ برای بررسی تخصصی‌تر نیز درخواست گفت‌وگو ثبت کنید.</p></div>
        <div class="rk-service-actions"><button type="button" data-rk-chat>${icon('chat')} چت با هوش مصنوعی</button><button type="button" data-rk-talk>درخواست گفت‌وگو</button></div>
      </div>
    </section>`;
}

function workforceDashboard() {
  const units = [['عملیات', 88, '۴۸'], ['فروش', 72, '۳۹'], ['پشتیبانی', 61, '۳۲']];
  return `<article class="rk-dashboard-card">
    <header class="rk-card-title"><span class="rk-card-icon">${icon('ai')}</span><div><h3>سرمایه انسانی</h3><p>مشارکت، ریسک خروج و ترکیب کارکنان</p></div></header>
    <div class="rk-card-kpis"><section><strong>٪۷۶</strong><small>مشارکت</small></section><section><strong>۱۲</strong><small>ریسک خروج</small></section><section><strong>۱۳۲</strong><small>کارکنان</small></section></div>
    <div class="rk-card-chart rk-bars-chart">${units.map(([label, value, count]) => `<div class="rk-bar-row"><small>${label}</small><span><i style="--bar:${value}%"></i></span><b>${count}</b></div>`).join('')}</div>
    <div class="rk-smart-note"><span>${icon('spark')}</span><div><b>تحلیل هوشمند</b><p>افت مشارکت در واحد عملیات با افزایش اضافه‌کار هم‌زمان شده است.</p></div></div>
  </article>`;
}

function workflowDashboard() {
  return `<article class="rk-dashboard-card">
    <header class="rk-card-title"><span class="rk-card-icon">${icon('flow')}</span><div><h3>فرایندهای هوشمند</h3><p>وضعیت گردش‌کار و زمان پاسخ</p></div></header>
    <div class="rk-card-kpis"><section><strong>۲۴</strong><small>درخواست فعال</small></section><section><strong>۱.۸ روز</strong><small>زمان پاسخ</small></section></div>
    <div class="rk-flow-status"><span><i></i>ثبت درخواست</span><span><i></i>بررسی AI</span><span><i></i>تأیید نهایی</span></div>
    <div class="rk-card-chart rk-line-chart"><svg viewBox="0 0 360 132" preserveAspectRatio="none"><defs><linearGradient id="rkAreaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#67e8f9" stop-opacity=".28"/><stop offset="1" stop-color="#67e8f9" stop-opacity="0"/></linearGradient></defs><path class="rk-grid-line" d="M8 32H352M8 68H352M8 104H352"/><path class="rk-area" d="M8 108 C58 102 82 83 121 75 S196 84 238 58 S302 58 352 20 L352 126 L8 126 Z"/><path class="rk-line" d="M8 108 C58 102 82 83 121 75 S196 84 238 58 S302 58 352 20"/></svg></div>
    <div class="rk-smart-note"><span>${icon('spark')}</span><div><b>تحلیل هوشمند</b><p>گلوگاه اصلی در بررسی مدیر میانی است؛ تأیید اولیه قابل خودکارسازی است.</p></div></div>
  </article>`;
}

function payrollDashboard() {
  return `<article class="rk-dashboard-card">
    <header class="rk-card-title"><span class="rk-card-icon">${icon('dash')}</span><div><h3>حقوق و بهره‌وری</h3><p>پرداخت، اضافه‌کار و روند هزینه</p></div></header>
    <div class="rk-card-kpis"><section><strong>۶۲.۸</strong><small>میانگین پرداخت</small></section><section><strong>٪۱۸</strong><small>سهم اضافه‌کار</small></section></div>
    <div class="rk-payroll-chart"><div class="rk-contract-ring"><strong>٪۳۱</strong><small>مزایا و اضافه‌کار</small></div><ul><li><i></i>حقوق پایه</li><li><i></i>مزایا</li><li><i></i>اضافه‌کار</li></ul></div>
    <div class="rk-smart-note"><span>${icon('spark')}</span><div><b>تحلیل هوشمند</b><p>رشد اضافه‌کار از رشد تعداد کارکنان بیشتر است؛ بازبینی بار کاری توصیه می‌شود.</p></div></div>
  </article>`;
}

function dashboardMarkup() {
  return `
    <section class="rk-dashboard-section" id="dashboards" data-rk-enhancement>
      <div class="rk-dashboard-inner">
        <div class="rk-section-heading rk-dashboard-heading">
          <span>سه نمای تحلیلی</span>
          <h2>داشبوردهای هوشمند سازمان</h2>
          <p>سه داشبورد مکمل برای سرمایه انسانی، فرایندها و حقوق و بهره‌وری؛ هر کدام همراه با نمودار متحرک و پیشنهاد قابل‌اقدام هوش مصنوعی.</p>
        </div>
        <div class="rk-dashboard-cards">${workforceDashboard()}${workflowDashboard()}${payrollDashboard()}</div>
      </div>
    </section>`;
}

function consultationMarkup() {
  return `
    <section class="rk-enhance-section rk-consultation" id="consultation" data-rk-enhancement>
      <div class="rk-consultation-shell">
        <div class="rk-consultation-copy"><span>شروع همکاری</span><h2>از کجا شروع کنیم؟</h2><p>با دستیار هوشمند گفت‌وگو کنید یا اطلاعات تماس و شرح کوتاهی از نیازتان را ثبت کنید تا کارشناسان راهکار با شما تماس بگیرند.</p><div class="rk-consultation-icons"><span>${icon('ai')}</span><span>${icon('shield')}</span><span>${icon('chat')}</span></div></div>
        <form class="rk-consultation-form"><label>نام و نام خانوادگی<input name="fullName" required></label><label>نام سازمان<input name="organization" required></label><label>شماره تماس<input name="phone" inputmode="tel" placeholder="09xxxxxxxxx" required></label><label>موضوع مشاوره<select name="topic">${topics.map(topic => `<option>${topic}</option>`).join('')}</select></label><label class="rk-full-field">شرح نیاز<textarea name="message" rows="5" required></textarea></label><div class="rk-form-state rk-full-field" aria-live="polite"></div><button class="rk-full-field" type="submit">ثبت درخواست گفت‌وگو</button></form>
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
      button.textContent = 'ثبت درخواست گفت‌وگو';
    }
  });
}

function bindActions(main) {
  const chat = main.querySelector('[data-rk-chat]');
  const talk = main.querySelector('[data-rk-talk]');
  if (chat && !chat.dataset.bound) {
    chat.dataset.bound = '1';
    chat.addEventListener('click', () => { location.hash = '/auth/login'; scrollTo({ top: 0 }); });
  }
  if (talk && !talk.dataset.bound) {
    talk.dataset.bound = '1';
    talk.addEventListener('click', () => document.getElementById('consultation')?.scrollIntoView({ behavior: 'smooth' }));
  }
}

function rebuildNavigation() {
  const nav = document.querySelector('.site-header nav');
  if (!nav || nav.dataset.rkCondensed) return;
  nav.dataset.rkCondensed = '1';
  nav.innerHTML = '';
  [['services', 'خدمات'], ['dashboards', 'داشبورد هوشمند'], ['consultation', 'شروع همکاری']].forEach(([id, label]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    nav.append(button);
  });
}

function enhanceHome() {
  const main = document.querySelector('.marketing-page main');
  const hero = main?.querySelector('.hero');
  if (!main || !hero) return;

  if (!hero.querySelector('[data-rk-hero-ai]')) hero.insertAdjacentHTML('beforeend', heroAiMarkup());

  [...main.children].forEach(section => {
    if (section !== hero && !section.hasAttribute('data-rk-enhancement')) section.remove();
  });

  if (!main.querySelector('#services')) hero.insertAdjacentHTML('afterend', unifiedServicesMarkup());
  if (!main.querySelector('#dashboards')) document.getElementById('services')?.insertAdjacentHTML('afterend', dashboardMarkup());
  if (!main.querySelector('#consultation')) document.getElementById('dashboards')?.insertAdjacentHTML('afterend', consultationMarkup());

  bindActions(main);
  bindConsultation(main);
  rebuildNavigation();

  const primary = hero.querySelector('.primary-cta');
  if (primary && !primary.dataset.rkConsultation) {
    primary.dataset.rkConsultation = '1';
    primary.innerHTML = 'درخواست گفت‌وگو <span aria-hidden="true">←</span>';
    primary.onclick = event => { event.preventDefault(); document.getElementById('consultation')?.scrollIntoView({ behavior: 'smooth' }); };
  }
}

const observer = new MutationObserver(enhanceHome);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('hashchange', () => setTimeout(enhanceHome, 30));
queueMicrotask(enhanceHome);
