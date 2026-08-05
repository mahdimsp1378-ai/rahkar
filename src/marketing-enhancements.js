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

function dashboardMarkup() {
  const units = [['عملیات', 88, '۴۸'], ['فروش', 72, '۳۹'], ['پشتیبانی', 61, '۳۲'], ['فناوری و داده', 49, '۲۴']];
  return `
    <section class="rk-enhance-section rk-dashboard-section" id="dashboards" data-rk-enhancement>
      <div class="rk-section-heading rk-split-heading">
        <div><span>تحلیل سرمایه انسانی</span><h2>داشبورد هوشمند</h2></div>
        <p>شاخص‌های کلیدی، نمودارهای متحرک و تحلیل هوش مصنوعی در یک نمای مدیریتی منظم و خوانا کنار هم قرار می‌گیرند.</p>
      </div>
      <div class="rk-dashboard-window">
        <div class="rk-window-bar"><i></i><i></i><i></i><span>داشبورد هوشمند سرمایه انسانی</span><em>به‌روزرسانی زنده</em></div>
        <div class="rk-kpis">
          <article><small>کارکنان فعال</small><strong>۱۳۲</strong><em>۴ واحد سازمانی</em></article>
          <article><small>نرخ مشارکت</small><strong>٪۷۶</strong><em>۲.۴٪ رشد ماهانه</em></article>
          <article><small>میانگین پرداخت</small><strong>۶۲.۸</strong><em>میلیون تومان</em></article>
          <article><small>ریسک خروج</small><strong>۱۲ نفر</strong><em>نیازمند بررسی</em></article>
        </div>
        <div class="rk-dashboard-grid">
          <section class="rk-mini-panel"><header><b>ترکیب نیروی انسانی</b><span>تعداد کارکنان به تفکیک واحد</span></header>${units.map(([label, value, count]) => `<div class="rk-bar-row"><small>${label}</small><span><i style="--bar:${value}%"></i></span><b>${count}</b></div>`).join('')}</section>
          <section class="rk-mini-panel"><header><b>ترکیب قرارداد</b><span>سهم انواع همکاری</span></header><div class="rk-contract-ring"><strong>٪۶۸</strong><small>رسمی و پیمانی</small></div><ul><li><i></i>رسمی</li><li><i></i>پیمانی</li><li><i></i>قراردادی</li></ul></section>
          <section class="rk-mini-panel rk-wide-panel"><header><b>روند مشارکت کارکنان</b><span>چهار ماه اخیر</span></header><div class="rk-line-chart"><svg viewBox="0 0 560 160" preserveAspectRatio="none"><defs><linearGradient id="rkAreaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#67e8f9" stop-opacity=".28"/><stop offset="1" stop-color="#67e8f9" stop-opacity="0"/></linearGradient></defs><path class="rk-grid-line" d="M12 40H548M12 82H548M12 124H548"/><path class="rk-area" d="M18 128 C90 116 118 120 175 91 S277 49 340 78 S446 55 542 27 L542 150 L18 150 Z"/><path class="rk-line" d="M18 128 C90 116 118 120 175 91 S277 49 340 78 S446 55 542 27"/></svg><i style="left:3%;top:80%"></i><i style="left:31%;top:55%"></i><i style="left:61%;top:48%"></i><i style="left:97%;top:17%"></i></div><div class="rk-chart-labels"><span>اردیبهشت</span><span>خرداد</span><span>تیر</span><span>مرداد</span></div></section>
        </div>
        <div class="rk-ai-summary"><span class="rk-ai-badge">AI</span><div><b>خلاصه هوشمند</b><p>افزایش اضافه‌کار واحد عملیات با افت مشارکت همراه شده است؛ بازبینی بار کاری و برنامه نگهداشت پیشنهاد می‌شود.</p></div></div>
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
