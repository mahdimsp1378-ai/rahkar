import './main.jsx';
import './marketing-enhancements.css';

const topics = [
  'طراحی ایجنت‌های هوش مصنوعی',
  'خودکارسازی فرایندهای سازمانی',
  'داشبورد و تحلیل داده‌های منابع انسانی',
  'طراحی سامانه اختصاصی سازمان',
  'یکپارچه‌سازی داده و گزارش‌سازی',
];

const icons = {
  flow: '<svg viewBox="0 0 24 24"><path d="M5 4v5h5M19 20v-5h-5M7 9a7 7 0 0 1 11-3M17 15a7 7 0 0 1-11 3"/></svg>',
  brain: '<svg viewBox="0 0 24 24"><path d="M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-2 3 3 3 0 0 0 2 3v1a3 3 0 0 0 3 3M15 4a3 3 0 0 1 3 3v1a3 3 0 0 1 2 3 3 3 0 0 1-2 3v1a3 3 0 0 1-3 3M9 4v16M15 4v16M9 9h6M9 15h6"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 13a4 4 0 0 0 6 0l2-2a4 4 0 0 0-6-6l-1 1M14 11a4 4 0 0 0-6 0l-2 2a4 4 0 0 0 6 6l1-1"/></svg>',
};

const agentCards = [
  ['flow', 'ایجنت اجرای فرایند', 'درخواست‌ها، تأییدها و پیگیری‌های تکراری را اجرا می‌کند و وضعیت هر مرحله را ثبت می‌کند.'],
  ['brain', 'ایجنت تحلیل و تصمیم', 'داده‌های سازمان را تحلیل می‌کند و هشدار، جمع‌بندی و پیشنهاد اقدام در اختیار مدیر می‌گذارد.'],
  ['link', 'ایجنت اتصال سامانه‌ها', 'بین فرم‌ها، داده‌ها و واحدها ارتباط ایجاد می‌کند تا فرایند بدون دوباره‌کاری پیش برود.'],
];

function smartProcessesMarkup() {
  return `
    <section class="rk-enhance-section rk-agents" id="smart-processes" data-rk-enhancement>
      <div class="rk-section-heading rk-split-heading">
        <div><span>ایجنت‌های سازمانی</span><h2>فرایندها هوشمند می‌شوند</h2></div>
        <p>راهکار، ایجنت‌های هوش مصنوعی را برای اجرای واقعی کار طراحی می‌کند؛ از تحلیل و پاسخ‌گویی تا پیگیری گردش‌کار و اتصال سامانه‌ها.</p>
      </div>
      <div class="rk-agent-grid">${agentCards.map(([icon, title, text]) => `
        <article><div class="rk-agent-icon">${icons[icon]}</div><div><h3>${title}</h3><p>${text}</p></div></article>`).join('')}
      </div>
    </section>`;
}

function dashboardMarkup() {
  const units = [['عملیات', 88, '۴۸'], ['فروش', 72, '۳۹'], ['پشتیبانی', 61, '۳۲'], ['فناوری و داده', 49, '۲۴']];
  return `
    <section class="rk-enhance-section rk-dashboard-section" id="dashboards" data-rk-enhancement>
      <div class="rk-section-heading rk-split-heading">
        <div><span>تحلیل سرمایه انسانی</span><h2>داشبورد هوشمند</h2></div>
        <p>نمایی یکپارچه از شاخص‌های منابع انسانی که نمودارها، روندها و تحلیل هوش مصنوعی را در یک تجربه مدیریتی منظم کنار هم قرار می‌دهد.</p>
      </div>
      <div class="rk-dashboard-layout">
        <div class="rk-dashboard-copy">
          <article><b>نمای مدیریتی یکپارچه</b><p>ترکیب نیروی انسانی، مشارکت، وضعیت قرارداد، پرداخت و ریسک‌های منابع انسانی در یک قاب دیده می‌شود.</p></article>
          <article><b>تحلیل قابل‌اقدام</b><p>هوش مصنوعی تغییرات مهم را شناسایی می‌کند و به‌جای نمایش صرف عدد، پیشنهاد اقدام ارائه می‌دهد.</p></article>
          <div class="rk-ai-summary"><span class="rk-ai-badge">AI</span><div><b>خلاصه هوشمند</b><p>«افزایش اضافه‌کار واحد عملیات با افت مشارکت همراه شده است؛ بازبینی بار کاری و برنامه نگهداشت پیشنهاد می‌شود.»</p></div></div>
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
            <section class="rk-mini-panel rk-unit-panel"><header><b>ترکیب نیروی انسانی</b><span>تعداد کارکنان به تفکیک واحد</span></header>${units.map(([label, value, count]) => `<div class="rk-bar-row"><small>${label}</small><span><i style="--bar:${value}%"></i></span><b>${count}</b></div>`).join('')}</section>
            <section class="rk-mini-panel rk-contract-panel"><header><b>ترکیب قرارداد</b><span>سهم انواع همکاری</span></header><div class="rk-contract-ring"><strong>٪۶۸</strong><small>رسمی و پیمانی</small></div><ul><li><i></i>رسمی</li><li><i></i>پیمانی</li><li><i></i>قراردادی</li></ul></section>
            <section class="rk-mini-panel rk-wide-panel"><header><b>روند شاخص سرمایه انسانی</b><span>مشارکت کارکنان در چهار ماه اخیر</span></header><div class="rk-line-chart"><svg viewBox="0 0 560 160" preserveAspectRatio="none"><defs><linearGradient id="rkAreaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6ee7f9" stop-opacity=".28"/><stop offset="1" stop-color="#6ee7f9" stop-opacity="0"/></linearGradient></defs><path class="rk-grid-line" d="M12 40H548M12 82H548M12 124H548"/><path class="rk-area" d="M18 128 C90 116 118 120 175 91 S277 49 340 78 S446 55 542 27 L542 150 L18 150 Z"/><path class="rk-line" d="M18 128 C90 116 118 120 175 91 S277 49 340 78 S446 55 542 27"/></svg><i style="left:3%;top:80%"></i><i style="left:31%;top:55%"></i><i style="left:61%;top:48%"></i><i style="left:97%;top:17%"></i></div><div class="rk-chart-labels"><span>اردیبهشت</span><span>خرداد</span><span>تیر</span><span>مرداد</span></div></section>
          </div>
        </div>
      </div>
    </section>`;
}

function consultationMarkup() {
  return `
    <section class="rk-enhance-section rk-consultation" id="consultation" data-rk-enhancement>
      <div class="rk-consultation-shell">
        <div class="rk-consultation-copy"><span>دریافت مشاوره</span><h2>برای شروع، مسئله سازمانتان را با ما در میان بگذارید.</h2><p>اطلاعات تماس و شرح کوتاهی از نیازتان را ثبت کنید تا درباره طراحی ایجنت، خودکارسازی فرایند، داشبورد یا سامانه اختصاصی با شما تماس بگیریم.</p><div class="rk-consultation-points"><div><b>گفت‌وگوی تخصصی</b><small>شناخت فرایند، داده و نتیجه مورد انتظار</small></div><div><b>طراحی مسیر اجرا</b><small>پیشنهاد ترکیب مناسب از سامانه و هوش مصنوعی</small></div></div></div>
        <form class="rk-consultation-form"><label>نام و نام خانوادگی<input name="fullName" required></label><label>نام سازمان<input name="organization" required></label><label>شماره تماس<input name="phone" inputmode="tel" placeholder="09xxxxxxxxx" required></label><label>موضوع مشاوره<select name="topic">${topics.map(topic => `<option>${topic}</option>`).join('')}</select></label><label class="rk-full-field">شرح نیاز<textarea name="message" rows="5" required></textarea></label><div class="rk-form-state rk-full-field" aria-live="polite"></div><button class="rk-full-field" type="submit">ثبت درخواست مشاوره</button></form>
      </div>
    </section>`;
}

function serviceCtaMarkup() {
  return `
    <div class="rk-service-cta" data-rk-service-cta>
      <div><span>گام بعدی</span><h3>با دستیار هوشمند گفت‌وگو کنید یا درخواست جلسه ثبت کنید.</h3><p>دستیار راهکار برای صورت‌بندی نیاز اولیه در دسترس است؛ برای بررسی تخصصی‌تر نیز می‌توانید درخواست گفت‌وگو ثبت کنید.</p></div>
      <div class="rk-service-actions"><button type="button" data-rk-chat>چت با هوش مصنوعی <b>←</b></button><button type="button" data-rk-talk>درخواست گفت‌وگو</button></div>
    </div>`;
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
  const items = [['smart-processes', 'فرایندهای هوشمند'], ['dashboards', 'داشبورد هوشمند'], ['consultation', 'دریافت مشاوره']];
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

function unifyServices(main) {
  const services = main.querySelector('.services');
  if (!services) return;
  const heading = services.querySelector('.section-heading');
  if (heading && !heading.dataset.rkUnified) {
    heading.dataset.rkUnified = '1';
    heading.innerHTML = '<span>معرفی خدمات</span><h2>خدماتی که برای سازمان شما طراحی می‌کنیم</h2><p>از خودکارسازی فرایندها تا طراحی سامانه و داشبورد، هر خدمت متناسب با مسئله و ساختار واقعی سازمان تعریف می‌شود.</p>';
  }
  if (!services.querySelector('[data-rk-service-cta]')) services.insertAdjacentHTML('beforeend', serviceCtaMarkup());
  const chatButton = services.querySelector('[data-rk-chat]');
  const talkButton = services.querySelector('[data-rk-talk]');
  if (chatButton && !chatButton.dataset.bound) {
    chatButton.dataset.bound = '1';
    chatButton.addEventListener('click', () => { location.hash = '/auth/login'; scrollTo({ top: 0 }); });
  }
  if (talkButton && !talkButton.dataset.bound) {
    talkButton.dataset.bound = '1';
    talkButton.addEventListener('click', () => document.getElementById('consultation')?.scrollIntoView({ behavior: 'smooth' }));
  }
}

function enhanceHome() {
  const main = document.querySelector('.marketing-page main');
  const capabilities = main?.querySelector('.capabilities');
  const services = main?.querySelector('.services');
  const process = main?.querySelector('.process');
  if (!main || !capabilities || !services || !process) return;

  main.querySelector('.ai-banner')?.remove();
  main.querySelector('.partnership')?.remove();

  if (!main.querySelector('#smart-processes')) capabilities.insertAdjacentHTML('afterend', smartProcessesMarkup());
  if (!main.querySelector('#dashboards')) document.getElementById('smart-processes')?.insertAdjacentHTML('afterend', dashboardMarkup());
  if (!main.querySelector('#consultation')) process.insertAdjacentHTML('afterend', consultationMarkup());

  unifyServices(main);
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
