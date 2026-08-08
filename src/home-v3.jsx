import React, { lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowLeft, BarChart3, Bot, BrainCircuit, Check, ChevronLeft,
  CircleUserRound, Database, Layers3, Menu, Network, Orbit,
  Route, ShoppingBag, Sparkles, Workflow, X,
} from 'lucide-react';
import '@fontsource-variable/vazirmatn';
import './home-v3.css';
import logo from './assets/brand/rahkar-logo.svg';
import heroImage from './assets/rahkar/hero-organization.webp';
import automationImage from './assets/rahkar/service-automation.webp';
import customSystemImage from './assets/rahkar/service-custom-system.webp';
import dashboardImage from './assets/rahkar/service-dashboard.webp';
import { addToCart, api } from './api.js';

const LoginPage = lazy(() => import('./account.jsx').then(module => ({ default: module.LoginPage })));
const AccountPage = lazy(() => import('./account.jsx').then(module => ({ default: module.AccountPage })));
const CartPage = lazy(() => import('./account.jsx').then(module => ({ default: module.CartPage })));
const AdminPage = lazy(() => import('./account.jsx').then(module => ({ default: module.AdminPage })));
const SupportAdminPage = lazy(() => import('./account.jsx').then(module => ({ default: module.SupportAdminPage })));

export const serviceProducts = [
  {
    id: 'rahkar-ai-automation', name: 'خودکارسازی و ایجنت‌های هوش مصنوعی',
    short: 'کاهش کار دستی، خطا و زمان پاسخ با ایجنت‌هایی که در جریان واقعی فرایند کار می‌کنند.',
    category: 'هوشمندسازی', brand: 'راهکار', price: 0, available_stock: 1,
    product_type: 'service', image: automationImage, image_url: automationImage,
    benefits: ['ایجنت اجرای فرایند', 'ایجنت تحلیل و تصمیم', 'ایجنت اتصال سامانه‌ها'],
  },
  {
    id: 'rahkar-custom-platform', name: 'طراحی سامانه اختصاصی سازمان',
    short: 'سامانه‌ای منطبق با ساختار، نقش‌ها، داده‌ها و نیازهای واقعی سازمان شما.',
    category: 'سامانه اختصاصی', brand: 'راهکار', price: 0, available_stock: 1,
    product_type: 'service', image: customSystemImage, image_url: customSystemImage,
    benefits: ['معماری داده و فرایند', 'سطوح دسترسی چندلایه', 'استقرار و آموزش'],
  },
  {
    id: 'rahkar-smart-dashboard', name: 'داده و داشبورد هوشمند',
    short: 'تبدیل داده‌های پراکنده به شاخص، نمودار، هشدار و گزارش قابل‌اقدام برای مدیران.',
    category: 'تحلیل داده', brand: 'راهکار', price: 0, available_stock: 1,
    product_type: 'service', image: dashboardImage, image_url: dashboardImage,
    benefits: ['جمع‌آوری و کنترل کیفیت داده', 'داشبورد مدیریتی چندسطحی', 'تحلیل و گزارش هوشمند'],
  },
];

const processSteps = [['۰۱', 'شناخت مسئله'], ['۰۲', 'طراحی راهکار'], ['۰۳', 'ساخت و اتصال'], ['۰۴', 'استقرار و همراهی']];
const consultationTopics = ['طراحی ایجنت‌های هوش مصنوعی', 'خودکارسازی فرایندهای سازمانی', 'طراحی سامانه اختصاصی', 'داشبورد و تحلیل داده‌های منابع انسانی', 'یکپارچه‌سازی داده و گزارش‌سازی'];
const navigateTo = path => { window.location.hash = path; window.scrollTo({ top: 0, behavior: 'auto' }); };

function Brand({ light = false }) { return <img className={light ? 'rahkar-logo logo-light' : 'rahkar-logo'} src={logo} alt="راهکار؛ سامانه‌های هوشمند سازمانی"/>; }
function PortalLoading() { return <div className="app-loading"><Brand/><span>در حال آماده‌سازی سامانه راهکار…</span></div>; }

function AnimatedAiIcon({ Icon = BrainCircuit, variant = 'blue' }) {
  return <div className={`animated-ai-icon ${variant}`} aria-hidden="true">
    <span className="ai-ring ring-one"/><span className="ai-ring ring-two"/>
    <Icon/><i className="ai-node node-one"/><i className="ai-node node-two"/><i className="ai-node node-three"/>
  </div>;
}

function SiteHeader({ route }) {
  const [open, setOpen] = useState(false);
  const goSection = id => {
    setOpen(false);
    if (route !== '/') { navigateTo('/'); window.setTimeout(() => goSection(id), 80); return; }
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return <header className="site-header">
    <button className="brand-button" onClick={() => navigateTo('/')}><Brand/></button>
    <nav className={open ? 'open' : ''}>
      <button onClick={() => goSection('services')}>معرفی خدمات</button>
      <button onClick={() => goSection('dashboard')}>داشبورد هوشمند</button>
      <button onClick={() => goSection('consultation')}>دریافت مشاوره</button>
      <button onClick={() => navigateTo('/shop')}>فروشگاه خدمات</button>
    </nav>
    <div className="header-actions">
      <button className="login-link" onClick={() => navigateTo('/auth/login')}><CircleUserRound/> ورود و ثبت‌نام</button>
      <button className="menu-button" onClick={() => setOpen(value => !value)} aria-label="نمایش منو">{open ? <X/> : <Menu/>}</button>
    </div>
  </header>;
}

function Hero() {
  return <section className="hero" id="top">
    <img className="hero-image" src={heroImage} alt="سازمان هوشمند مبتنی بر داده و هوش مصنوعی"/><div className="hero-shade"/>
    <div className="hero-copy">
      <span className="hero-kicker"><Sparkles/> فناوری برای مسئله واقعی سازمان</span>
      <h1>سازمان شما،<br/><em>هوشمندتر از فرایندهای امروز.</em></h1>
      <p>راهکار داده، فرایند و هوش مصنوعی را در یک سامانه عملیاتی کنار هم قرار می‌دهد؛ از طراحی ایجنت و خودکارسازی تا داشبورد مدیریتی و سامانه اختصاصی.</p>
      <div className="hero-actions">
        <button className="primary-cta" onClick={() => { window.location.href = '/ai-consultation.html'; }}>دریافت مشاوره <ArrowLeft/></button>
        <button className="secondary-cta" onClick={() => { window.location.href = '/ai-consultation.html'; }}>چت با هوش مصنوعی</button>
      </div>
      <div className="hero-ai-cluster"><AnimatedAiIcon Icon={BrainCircuit}/><AnimatedAiIcon Icon={Workflow} variant="teal"/><AnimatedAiIcon Icon={Database} variant="violet"/></div>
    </div>
  </section>;
}

function Services({ compact = false }) {
  const [message, setMessage] = useState('');
  const select = product => { addToCart(product.id, 1); setMessage(`«${product.name}» به درخواست شما اضافه شد.`); window.setTimeout(() => navigateTo('/cart'), 450); };
  return <section className={`services-section ${compact ? 'shop-services' : ''}`} id="services">
    {!compact && <div className="section-heading light-heading"><span>معرفی خدمات</span><h2>سه مسیر اصلی برای هوشمندسازی سازمان</h2><p>خدمت، فناوری و مدل اجرا در یک بخش جمع شده‌اند تا مسیر همکاری روشن و کوتاه باشد.</p></div>}
    {message && <div className="selection-toast">{message}</div>}
    <div className="service-grid">{serviceProducts.map((product, index) => {
      const icons = [BrainCircuit, Layers3, BarChart3]; const Icon = icons[index];
      return <article className="service-card" key={product.id}>
        <div className="service-media"><img src={product.image} alt={product.name}/><AnimatedAiIcon Icon={Icon} variant={index === 1 ? 'violet' : index === 2 ? 'teal' : 'blue'}/></div>
        <div className="service-content"><small>{product.category}</small><h3>{product.name}</h3><p>{product.short}</p><ul>{product.benefits.map(item => <li key={item}><Check/>{item}</li>)}</ul><button onClick={() => select(product)}>ثبت درخواست <ChevronLeft/></button></div>
      </article>;
    })}</div>
    {!compact && <div className="process-strip"><div className="process-title"><Orbit/><div><b>مدل اجرای راهکار</b><small>از شناخت مسئله تا استقرار، در چهار مرحله فشرده</small></div></div><div className="process-steps">{processSteps.map(([number, title]) => <span key={number}><b>{number}</b>{title}</span>)}</div></div>}
  </section>;
}

function SmartDashboard() {
  const bars = [['عملیات', 88, '۴۸'], ['فروش', 72, '۳۹'], ['پشتیبانی', 61, '۳۲'], ['فناوری و داده', 49, '۲۴']];
  return <section className="dashboard-section" id="dashboard">
    <div className="section-heading dark-heading"><span>تحلیل سرمایه انسانی</span><h2>داشبورد هوشمند</h2><p>شاخص‌های منابع انسانی، نمودارهای زنده و تحلیل هوش مصنوعی در یک نمای مدیریتی منظم.</p></div>
    <div className="dashboard-layout">
      <div className="dashboard-copy"><AnimatedAiIcon Icon={Bot} variant="teal"/><h3>از نمایش عدد تا پیشنهاد اقدام</h3><p>داشبورد تغییرات مهم را شناسایی می‌کند و در کنار نمودارها، یک جمع‌بندی کوتاه و قابل‌اقدام ارائه می‌دهد.</p><div className="ai-insight"><Sparkles/><div><b>خلاصه هوشمند</b><span>افزایش اضافه‌کار واحد عملیات با افت مشارکت همراه شده است؛ بازبینی بار کاری پیشنهاد می‌شود.</span></div></div></div>
      <div className="dashboard-window" aria-label="نمونه داشبورد منابع انسانی">
        <div className="window-bar"><i/><i/><i/><span>داشبورد هوشمند سرمایه انسانی</span><em>به‌روزرسانی زنده</em></div>
        <div className="kpi-grid"><article><small>کارکنان فعال</small><strong>۱۳۲</strong><em>۴ واحد سازمانی</em></article><article><small>نرخ مشارکت</small><strong>٪۷۶</strong><em>۲.۴٪ رشد ماهانه</em></article><article><small>میانگین پرداخت</small><strong>۶۲.۸</strong><em>میلیون تومان</em></article><article><small>ریسک خروج</small><strong>۱۲ نفر</strong><em>نیازمند بررسی</em></article></div>
        <div className="chart-grid">
          <section className="chart-card bars-card"><header><b>ترکیب نیروی انسانی</b><span>تعداد کارکنان به تفکیک واحد</span></header>{bars.map(([label, value, count]) => <div className="bar-row" key={label}><small>{label}</small><span><i style={{ '--bar-width': `${value}%` }}/></span><b>{count}</b></div>)}</section>
          <section className="chart-card contract-card"><header><b>ترکیب قرارداد</b><span>سهم انواع همکاری</span></header><div className="contract-ring"><strong>٪۶۸</strong><small>رسمی و پیمانی</small></div><ul><li><i/> رسمی</li><li><i/> پیمانی</li><li><i/> قراردادی</li></ul></section>
          <section className="chart-card trend-card"><header><b>روند مشارکت کارکنان</b><span>چهار ماه اخیر</span></header><div className="line-chart"><svg viewBox="0 0 560 160" preserveAspectRatio="none"><defs><linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6ee7f9" stopOpacity=".28"/><stop offset="1" stopColor="#6ee7f9" stopOpacity="0"/></linearGradient></defs><path className="grid-lines" d="M12 40H548M12 82H548M12 124H548"/><path className="chart-area" d="M18 128 C90 116 118 120 175 91 S277 49 340 78 S446 55 542 27 L542 150 L18 150 Z"/><path className="chart-line" d="M18 128 C90 116 118 120 175 91 S277 49 340 78 S446 55 542 27"/></svg><i style={{ left: '3%', top: '80%' }}/><i style={{ left: '31%', top: '55%' }}/><i style={{ left: '61%', top: '48%' }}/><i style={{ left: '97%', top: '17%' }}/></div><div className="chart-labels"><span>اردیبهشت</span><span>خرداد</span><span>تیر</span><span>مرداد</span></div></section>
        </div>
      </div>
    </div>
  </section>;
}

function ConsultationSection() {
  const [form, setForm] = useState({ fullName: '', organization: '', phone: '', topic: consultationTopics[0], message: '' });
  const [status, setStatus] = useState({ loading: false, success: '', error: '' });
  const submit = async event => {
    event.preventDefault(); setStatus({ loading: true, success: '', error: '' });
    try { await api('/consultation-requests', { method: 'POST', body: form }); setStatus({ loading: false, success: 'درخواست شما ثبت شد. به‌زودی با شما تماس می‌گیریم.', error: '' }); setForm({ fullName: '', organization: '', phone: '', topic: consultationTopics[0], message: '' }); }
    catch (error) { setStatus({ loading: false, success: '', error: error.message || 'ثبت درخواست ناموفق بود.' }); }
  };
  return <section className="consultation-section" id="consultation"><div className="consultation-shell">
    <div className="consultation-copy"><div className="consultation-icons"><AnimatedAiIcon Icon={Bot}/><AnimatedAiIcon Icon={Network} variant="teal"/></div><span>از کجا شروع کنیم؟</span><h2>با هوش مصنوعی گفت‌وگو کنید یا درخواست جلسه ثبت کنید.</h2><p>برای صورت‌بندی اولیه مسئله، وارد گفت‌وگو با دستیار راهکار شوید؛ برای بررسی تخصصی‌تر نیز فرم را تکمیل کنید.</p><button className="chat-button" onClick={() => { window.location.href = '/ai-consultation.html'; }}><Bot/> چت با هوش مصنوعی <ArrowLeft/></button></div>
    <form className="consultation-form" onSubmit={submit}><label>نام و نام خانوادگی<input value={form.fullName} onChange={event => setForm({ ...form, fullName: event.target.value })} required/></label><label>نام سازمان<input value={form.organization} onChange={event => setForm({ ...form, organization: event.target.value })} required/></label><label>شماره تماس<input value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} placeholder="09xxxxxxxxx" required/></label><label>موضوع مشاوره<select value={form.topic} onChange={event => setForm({ ...form, topic: event.target.value })}>{consultationTopics.map(topic => <option key={topic}>{topic}</option>)}</select></label><label className="full-field">شرح نیاز<textarea rows="5" value={form.message} onChange={event => setForm({ ...form, message: event.target.value })} required/></label>{status.error && <div className="form-state error full-field">{status.error}</div>}{status.success && <div className="form-state success full-field">{status.success}</div>}<button className="submit-button full-field" type="submit" disabled={status.loading}>{status.loading ? 'در حال ثبت…' : 'ثبت درخواست گفت‌وگو'}</button></form>
  </div></section>;
}

function HomePage({ route }) { return <div className="marketing-page"><SiteHeader route={route}/><main><Hero/><Services/><SmartDashboard/><ConsultationSection/></main><SiteFooter/></div>; }
function ShopPage({ route }) { return <div className="marketing-page shop-page"><SiteHeader route={route}/><main><section className="shop-hero"><span><ShoppingBag/> فروشگاه خدمات راهکار</span><h1>برای هوشمندسازی سازمان،<br/>از یک درخواست روشن شروع کنید.</h1><p>خدمت را انتخاب کنید تا بعد از شناخت دامنه، پیشنهاد فنی و مدل همکاری متناسب با سازمان شما ارائه شود.</p></section><Services compact/><section className="shop-assurance"><Route/><div><h2>هنوز نمی‌دانید کدام مسیر مناسب است؟</h2><p>دستیار تخصصی راهکار مسئله را با چند سؤال مشخص می‌کند و شما را به مسیر درست هدایت می‌کند.</p></div><button onClick={() => navigateTo('/auth/login')}>شروع گفت‌وگو <ArrowLeft/></button></section></main><SiteFooter/></div>; }
function SiteFooter() { return <footer><div><Brand light/><p>طراحی سامانه، داشبورد و ایجنت‌های هوش مصنوعی متناسب با مسئله واقعی هر سازمان.</p></div><nav><button onClick={() => navigateTo('/')}>خانه</button><button onClick={() => navigateTo('/shop')}>خدمات</button><button onClick={() => navigateTo('/auth/login')}>حساب کاربری</button><button onClick={() => navigateTo('/account/help')}>پشتیبانی</button></nav><small>راهکار — سامانه‌های هوشمند سازمانی</small></footer>; }

function App() {
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || '/');
  const [remoteProducts, setRemoteProducts] = useState(serviceProducts);
  useEffect(() => { const onChange = () => setRoute(window.location.hash.slice(1) || '/'); window.addEventListener('hashchange', onChange); return () => window.removeEventListener('hashchange', onChange); }, []);
  useEffect(() => { api('/catalog/products').then(result => { const rows = Array.isArray(result) ? result : result.items; const byId = new Map(rows.map(item => [item.id, item])); setRemoteProducts(serviceProducts.map(local => ({ ...local, ...(byId.get(local.id) || {}), image: local.image, available_stock: 1 }))); }).catch(() => {}); }, []);
  const portal = component => <Suspense fallback={<PortalLoading/>}>{component}</Suspense>;
  if (route === '/auth/login' || route === '/auth/verify') return portal(<LoginPage navigate={navigateTo}/>);
  if (route === '/cart' || route === '/checkout') return portal(<CartPage products={remoteProducts} navigate={navigateTo}/>);
  if (route.startsWith('/account') || route.startsWith('/payment/result')) return portal(<AccountPage route={route} navigate={navigateTo}/>);
  if (route === '/admin/support') return portal(<SupportAdminPage navigate={navigateTo}/>);
  if (route === '/admin') return portal(<AdminPage navigate={navigateTo}/>);
  if (route === '/shop') return <ShopPage route={route}/>;
  return <HomePage route={route}/>;
}

createRoot(document.getElementById('root')).render(<App/>);
