import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowLeft, BarChart3, Bot, BrainCircuit, Building2, Check, ChevronLeft,
  CircleUserRound, Database, Headphones, Layers3, Menu, MessageSquareText,
  Network, Route, Settings2, ShieldCheck, ShoppingBag, Sparkles, Workflow, X,
} from 'lucide-react';
import '@fontsource-variable/vazirmatn';
import './styles.css';
import './android-mobile.css';
import logo from './assets/brand/rahkar-logo.svg';
import heroImage from './assets/rahkar/hero-organization.webp';
import automationImage from './assets/rahkar/service-automation.webp';
import customSystemImage from './assets/rahkar/service-custom-system.webp';
import dashboardImage from './assets/rahkar/service-dashboard.webp';
import expertsImage from './assets/rahkar/expert-partnership.webp';
import { addToCart, api, getCart } from './api.js';

const LoginPage = lazy(() => import('./account.jsx').then(module => ({ default: module.LoginPage })));
const AccountPage = lazy(() => import('./account.jsx').then(module => ({ default: module.AccountPage })));
const CartPage = lazy(() => import('./account.jsx').then(module => ({ default: module.CartPage })));
const AdminPage = lazy(() => import('./account.jsx').then(module => ({ default: module.AdminPage })));
const SupportAdminPage = lazy(() => import('./account.jsx').then(module => ({ default: module.SupportAdminPage })));

export const serviceProducts = [
  {
    id: 'rahkar-ai-automation', name: 'هوشمندسازی فرایندها با هوش مصنوعی',
    short: 'کاهش کار دستی، خطا و زمان پاسخ با گردش‌کارهای هوشمند و قابل‌کنترل.',
    description: 'تحلیل فرایندهای موجود، طراحی گردش‌کار، اتصال به داده‌های سازمان و ساخت دستیارهای هوشمندی که فعالیت‌های تکراری را با کنترل انسانی انجام می‌دهند.',
    category: 'هوشمندسازی', brand: 'راهکار', price: 0, available_stock: 1,
    product_type: 'service', image: automationImage, image_url: automationImage,
    benefits: ['تحلیل و بازطراحی فرایند', 'اتوماسیون گردش تأییدها', 'دستیار هوشمند اختصاصی', 'ثبت رخداد و کنترل دسترسی'],
  },
  {
    id: 'rahkar-custom-platform', name: 'طراحی سامانه اختصاصی سازمان',
    short: 'سامانه‌ای منطبق با ساختار، نقش‌ها، فرایندها و نیازهای واقعی سازمان شما.',
    description: 'از کشف نیاز و معماری داده تا طراحی تجربه کاربری، توسعه، استقرار، آموزش و پشتیبانی؛ یک سامانه امن و قابل‌گسترش برای سازمان شما ساخته می‌شود.',
    category: 'سامانه اختصاصی', brand: 'راهکار', price: 0, available_stock: 1,
    product_type: 'service', image: customSystemImage, image_url: customSystemImage,
    benefits: ['تحلیل نیاز سازمانی', 'سطوح دسترسی چندلایه', 'پنل کاربر و مدیریت', 'استقرار و آموزش کامل'],
  },
  {
    id: 'rahkar-smart-dashboard', name: 'جمع‌آوری داده و داشبورد هوشمند',
    short: 'تبدیل فایل‌ها و داده‌های پراکنده به یک منبع معتبر برای تصمیم‌گیری مدیران.',
    description: 'طراحی مسیر ورود و کنترل کیفیت داده، شاخص‌های مدیریتی، گزارش‌های خودکار و داشبوردهای تحلیلی متناسب با سطوح هلدینگ، مؤسسه و پروژه.',
    category: 'داده و داشبورد', brand: 'راهکار', price: 0, available_stock: 1,
    product_type: 'service', image: dashboardImage, image_url: dashboardImage,
    benefits: ['ورود امن و کنترل‌شده داده', 'داشبورد مدیریتی چندسطحی', 'تحلیل روند و مغایرت', 'گزارش‌های قابل‌خروجی'],
  },
];

const capabilities = [
  [Workflow, 'خودکارسازی فرایندها', 'فرایندهای دستی، فرم‌ها، تأییدها و پیگیری‌ها به گردش‌کارهای روشن و قابل‌اندازه‌گیری تبدیل می‌شوند.'],
  [Database, 'یکپارچه‌سازی و جمع‌آوری داده', 'داده‌های پراکنده از فایل‌ها و واحدهای مختلف در یک ساختار کنترل‌شده و قابل‌اعتماد جمع می‌شوند.'],
  [BarChart3, 'داشبورد و گزارش هوشمند', 'مدیران در هر سطح فقط داده مرتبط با نقش خود را می‌بینند و به تحلیل قابل‌اقدام می‌رسند.'],
  [BrainCircuit, 'هوش مصنوعی اختصاصی سازمان', 'دستیارهای تخصصی با دانش و قواعد سازمان طراحی می‌شوند و در مسیر واقعی کار قرار می‌گیرند.'],
  [ShieldCheck, 'امنیت و سطوح دسترسی', 'هویت، نقش، محدوده داده، ثبت رخداد و حفاظت از اطلاعات از ابتدا در معماری لحاظ می‌شوند.'],
  [Network, 'اتصال سامانه‌ها و واحدها', 'اطلاعات بین پروژه، مؤسسه، ستاد و سامانه‌های موجود بدون دوباره‌کاری جریان پیدا می‌کند.'],
];

const processSteps = [
  ['۰۱', 'شناخت مسئله', 'فرایند، کاربران، داده‌ها، محدودیت‌ها و نتیجه مورد انتظار را دقیق می‌شناسیم.'],
  ['۰۲', 'طراحی راهکار', 'معماری سامانه، مدل داده، سطوح دسترسی و تجربه کاربر طراحی و تأیید می‌شود.'],
  ['۰۳', 'ساخت و یکپارچه‌سازی', 'نسخه‌های قابل‌آزمایش به‌صورت مرحله‌ای ساخته و با زیرساخت سازمان هماهنگ می‌شوند.'],
  ['۰۴', 'استقرار و همراهی', 'آموزش، انتقال داده، راه‌اندازی، پایش و بهبود مستمر کنار تیم شما ادامه دارد.'],
];

const navigateTo = path => {
  window.location.hash = path;
  window.scrollTo({ top: 0, behavior: 'auto' });
};

function Brand({ light = false }) {
  return <img className={light ? 'rahkar-logo logo-light' : 'rahkar-logo'} src={logo} alt="راهکار؛ سامانه‌های هوشمند سازمانی"/>;
}

function PortalLoading() {
  return <div className="app-loading"><Brand/><span>در حال آماده‌سازی سامانه راهکار…</span></div>;
}

function SiteHeader({ route }) {
  const [open, setOpen] = useState(false);
  const goSection = id => {
    setOpen(false);
    if (route !== '/') { navigateTo('/'); window.setTimeout(() => goSection(id), 80); return; }
    const node = document.getElementById(id);
    if (node) window.scrollTo({ top: node.offsetTop - 76, behavior: 'smooth' });
  };
  return <header className="site-header">
    <button className="brand-button" onClick={() => navigateTo('/')}><Brand/></button>
    <nav className={open ? 'open' : ''}>
      <button onClick={() => goSection('capabilities')}>توانمندی‌ها</button>
      <button onClick={() => goSection('services')}>خدمات</button>
      <button onClick={() => goSection('partnership')}>روش همکاری</button>
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
    <img className="hero-image" src={heroImage} alt="سازمان هوشمند مبتنی بر داده و هوش مصنوعی"/>
    <div className="hero-shade"/>
    <div className="hero-copy">
      <span className="hero-kicker"><Sparkles/> فناوری برای مسئله واقعی سازمان</span>
      <h1>سازمان شما،<br/><em>هوشمندتر از فرایندهای امروز.</em></h1>
      <p>راهکار سامانه‌های هوشمند اختصاصی می‌سازد؛ از جمع‌آوری و یکپارچه‌سازی داده تا خودکارسازی فرایندها، داشبوردهای مدیریتی و دستیارهای تخصصی هوش مصنوعی.</p>
      <div className="hero-actions">
        <button className="primary-cta" onClick={() => navigateTo('/auth/login')}>شروع گفت‌وگوی تخصصی <ArrowLeft/></button>
        <button className="secondary-cta" onClick={() => navigateTo('/shop')}>مشاهده خدمات</button>
      </div>
      <div className="hero-proof">
        <span><Check/> طراحی متناسب با ساختار سازمان</span>
        <span><Check/> همراهی از تحلیل تا استقرار</span>
        <span><Check/> امنیت و دسترسی چندسطحی</span>
      </div>
    </div>
  </section>;
}

function Capabilities() {
  return <section className="section capabilities" id="capabilities">
    <div className="section-heading split-heading">
      <div><span>دامنه توانمندی</span><h2>یک سامانه؛ متناسب با روش کار سازمان شما</h2></div>
      <p>راهکار از یک محصول آماده شروع نمی‌کند. مسئله، ساختار و داده‌های شما مبنای طراحی قرار می‌گیرند تا فناوری واقعاً بخشی از عملیات شود.</p>
    </div>
    <div className="capability-grid">{capabilities.map(([Icon, title, text]) => <article key={title}>
      <Icon/><h3>{title}</h3><p>{text}</p>
    </article>)}</div>
  </section>;
}

function AiBanner() {
  return <section className="ai-banner section">
    <div className="ai-banner-copy">
      <span><Bot/> دستیار تخصصی راهکار</span>
      <h2>مسئله سازمانتان را توضیح دهید؛ مسیر شروع را پیدا کنید.</h2>
      <p>پس از ورود، دستیار تخصصی راهکار به شما کمک می‌کند نیاز اولیه را صورت‌بندی کنید، خدمت مناسب را بشناسید و در صورت نیاز گفت‌وگو را به کارشناس مرتبط بسپارید.</p>
      <button onClick={() => navigateTo('/auth/login')}>چت با دستیار تخصصی هوش مصنوعی <ArrowLeft/></button>
    </div>
    <div className="ai-orbit" aria-hidden="true"><BrainCircuit/><i/><i/><i/></div>
  </section>;
}

function Services({ compact = false }) {
  const [message, setMessage] = useState('');
  const select = product => {
    addToCart(product.id, 1);
    setMessage(`«${product.name}» به درخواست شما اضافه شد.`);
    window.setTimeout(() => navigateTo('/cart'), 450);
  };
  return <section className={`section services ${compact ? 'shop-services' : ''}`} id="services">
    {!compact && <div className="section-heading"><span>فروشگاه خدمات</span><h2>از مسئله تا سامانه عملیاتی</h2><p>خدمت موردنظر را انتخاب کنید؛ بعد از ثبت درخواست، دامنه، زمان و برآورد متناسب با سازمان شما مشخص می‌شود.</p></div>}
    {message && <div className="selection-toast">{message}</div>}
    <div className="service-grid">{serviceProducts.map((product, index) => <article className="service-card" key={product.id}>
      <div className="service-image"><img src={product.image} alt={product.name}/><span>۰{index + 1}</span></div>
      <div className="service-content"><small>{product.category}</small><h3>{product.name}</h3><p>{product.short}</p>
        <ul>{product.benefits.map(item => <li key={item}><Check/>{item}</li>)}</ul>
        <div className="service-footer"><b>برآورد اختصاصی پس از تحلیل نیاز</b><button onClick={() => select(product)}>ثبت درخواست <ChevronLeft/></button></div>
      </div>
    </article>)}</div>
  </section>;
}

function Partnership() {
  return <section className="partnership" id="partnership">
    <img src={expertsImage} alt="همراهی کارشناسان راهکار در مسیر هوشمندسازی سازمان"/>
    <div className="partnership-copy"><span>همراه سازمان شما</span><h2>هوش مصنوعی به‌تنهایی کافی نیست؛ اجرای درست تفاوت را می‌سازد.</h2><p>کارشناسان راهکار در شناخت مسئله، طراحی، انتقال داده، استقرار، آموزش و پشتیبانی کنار تیم شما می‌مانند تا سامانه به ابزار واقعی کار تبدیل شود.</p>
      <button onClick={() => navigateTo('/auth/login')}>گفت‌وگو با کارشناس <ArrowLeft/></button>
    </div>
  </section>;
}

function Process() {
  return <section className="section process"><div className="section-heading"><span>مدل اجرا</span><h2>مسیر روشن، تحویل مرحله‌ای</h2></div>
    <div className="process-track">{processSteps.map(([no, title, text]) => <article key={no}><b>{no}</b><h3>{title}</h3><p>{text}</p></article>)}</div>
  </section>;
}

function HomePage({ route }) {
  return <div className="marketing-page"><SiteHeader route={route}/><main><Hero/><Capabilities/><AiBanner/><Services/><Partnership/><Process/></main><SiteFooter/></div>;
}

function ShopPage({ route }) {
  return <div className="marketing-page shop-page"><SiteHeader route={route}/><main>
    <section className="shop-hero"><span><ShoppingBag/> فروشگاه خدمات راهکار</span><h1>برای تحول دیجیتال سازمانتان،<br/>از یک درخواست روشن شروع کنید.</h1><p>قیمت ثابت و عمومی برای پروژه سازمانی دقیق نیست. خدمت را انتخاب کنید تا پس از شناخت دامنه، پیشنهاد فنی و مالی متناسب دریافت کنید.</p></section>
    <Services compact/>
    <section className="shop-assurance"><Route/><div><h2>هنوز نمی‌دانید کدام خدمت مناسب است؟</h2><p>دستیار تخصصی راهکار مسئله را با چند سؤال مشخص می‌کند و شما را به مسیر درست هدایت می‌کند.</p></div><button onClick={() => navigateTo('/auth/login')}>شروع گفت‌وگو <ArrowLeft/></button></section>
  </main><SiteFooter/></div>;
}

function SiteFooter() {
  return <footer><div><Brand light/><p>طراحی و ساخت سامانه‌های هوشمند سازمانی، متناسب با مسئله واقعی و زیرساخت هر سازمان.</p></div><nav><button onClick={() => navigateTo('/shop')}>فروشگاه خدمات</button><button onClick={() => navigateTo('/auth/login')}>حساب کاربری</button><button onClick={() => navigateTo('/account/help')}>پشتیبانی</button></nav><small>راهکار — سامانه‌های هوشمند سازمانی</small></footer>;
}

function App() {
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || '/');
  const [remoteProducts, setRemoteProducts] = useState(serviceProducts);
  useEffect(() => {
    const onChange = () => setRoute(window.location.hash.slice(1) || '/');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  useEffect(() => {
    api('/catalog/products').then(result => {
      const rows = Array.isArray(result) ? result : result.items;
      const byId = new Map(rows.map(item => [item.id, item]));
      setRemoteProducts(serviceProducts.map(local => ({ ...local, ...(byId.get(local.id) || {}), image: local.image, available_stock: 1 })));
    }).catch(() => {});
  }, []);
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
