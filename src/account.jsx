import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Bell, Bot, Building2, Check, ChevronLeft, CircleUserRound, ClipboardList,
  Clock, Copy, CreditCard, Eye, EyeOff, FileText, Filter, Headphones, Home, KeyRound, LogOut, MapPin, Menu, MessageCircle,
  Package, Paperclip, PauseCircle, Pencil, Plus, RefreshCw, Save, Search, Settings, ShieldCheck, ShoppingBag,
  Tag, ThumbsDown, ThumbsUp, Trash2, TriangleAlert, UserCog, UserPlus, UserRound, UsersRound, Wifi, WifiOff, X
} from 'lucide-react';
import {
  api, downloadApiFile, getApiFileObjectUrl, getCart, getToken, saveCart, setToken, syncCart,
  subscribeEvents,
} from './api';
import aronageLogo from './assets/brand/rahkar-logo.svg';
import { SUPPORT_TOPICS } from '../shared/support-topics.js';
import './account.css';

const fa = value => Number(value || 0).toLocaleString('fa-IR');
const money = value => `${fa(value)} ریال`;
const date = value => value ? new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium' }).format(new Date(value)) : '—';
const exactDate = value => value ? new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
const slaMetrics = ticket => {
  const dueAt = ticket?.next_response_due_at || ticket?.first_response_due_at || ticket?.resolution_due_at;
  if (!dueAt) return { tone: 'normal', percent: 0, remaining: 'بدون مهلت فعال' };
  const due = new Date(dueAt).getTime();
  const start = new Date(ticket.created_at || Date.now()).getTime();
  const total = Math.max(1, due - start);
  const left = due - Date.now();
  const percent = Math.max(0, Math.min(100, Math.round(((Date.now() - start) / total) * 100)));
  const tone = left <= 0 ? 'breached' : percent >= 80 ? 'warning' : 'normal';
  const minutes = Math.max(0, Math.ceil(left / 60_000));
  const remaining = left <= 0 ? 'نقض‌شده' : minutes >= 60 ? `${fa(Math.floor(minutes / 60))} ساعت و ${fa(minutes % 60)} دقیقه` : `${fa(minutes)} دقیقه`;
  return { tone, percent, remaining };
};
const parseSafeJson = (value, fallback) => {
  try { return JSON.parse(value || ''); } catch { return fallback; }
};
const statusMap = {
  pending: 'در انتظار بررسی', awaiting_payment: 'در انتظار پرداخت', paid: 'پرداخت‌شده',
  processing: 'در حال آماده‌سازی', shipped: 'ارسال‌شده', delivered: 'تحویل‌شده',
  confirmed: 'تأییدشده', preparing: 'در حال آماده‌سازی', ready_to_ship: 'آماده ارسال',
  return_requested: 'درخواست مرجوعی', returned: 'مرجوع‌شده',
  refund_requested: 'درخواست بازپرداخت', refunded: 'بازپرداخت‌شده',
  new: 'جدید', open: 'باز', answered: 'پاسخ داده‌شده', closed: 'بسته',
  ai_active: 'در حال پاسخ هوشمند', ai_waiting_customer: 'منتظر پاسخ شما', queued: 'در صف کارشناس',
  assigned: 'تخصیص‌یافته', agent_active: 'در حال بررسی کارشناس',
  waiting_customer: 'منتظر پاسخ مشتری', waiting_internal: 'بررسی داخلی',
  snoozed: 'یادآوری‌شده', resolved: 'حل‌شده', reopened: 'بازگشایی‌شده',
  online: 'آنلاین', busy: 'مشغول', away: 'دور از سیستم', offline: 'آفلاین',
  reviewing: 'در حال بررسی', cancelled: 'لغوشده',
  submitted: 'ثبت‌شده', needs_information: 'نیازمند تکمیل اطلاعات',
  in_progress: 'در حال انجام', completed: 'تحویل‌شده', rejected: 'ردشده',
  draft: 'پیش‌نویس', approved: 'تأییدشده', planning: 'برنامه‌ریزی',
  gateway_disabled: 'درگاه غیرفعال', redirect_ready: 'آماده انتقال',
};
const status = value => statusMap[value] || value || '—';
const orderNextStatuses = {
  awaiting_payment:['paid','cancelled'],paid:['reviewing','cancelled','refund_requested'],
  reviewing:['confirmed','cancelled'],confirmed:['preparing','cancelled'],
  preparing:['ready_to_ship','cancelled'],ready_to_ship:['shipped','cancelled'],
  shipped:['delivered','return_requested'],delivered:['return_requested'],
  return_requested:['returned','delivered'],returned:['refunded'],
  refund_requested:['refunded','paid'],processing:['ready_to_ship','shipped','cancelled'],
};
const iranProvinces = [
  'آذربایجان شرقی','آذربایجان غربی','اردبیل','اصفهان','البرز','ایلام','بوشهر','تهران',
  'چهارمحال و بختیاری','خراسان جنوبی','خراسان رضوی','خراسان شمالی','خوزستان','زنجان',
  'سمنان','سیستان و بلوچستان','فارس','قزوین','قم','کردستان','کرمان','کرمانشاه',
  'کهگیلویه و بویراحمد','گلستان','گیلان','لرستان','مازندران','مرکزی','هرمزگان','همدان','یزد',
];
const engineeringServiceNames = {
  potential_assessment: 'پتانسیل‌سنجی',
  site_plan: 'سایت‌پلن',
  feasibility_study: 'طرح توجیهی',
};

function LogoButton({ onClick }) {
  return <button className="portal-logo" onClick={onClick} aria-label="صفحه اصلی">
<img src={aronageLogo} alt="راهکار"/>
</button>;
}

function Notice({ children, type = 'info' }) {
  return children ? <div className={`portal-notice ${type}`}>{children}</div> : null;
}

function SecureAttachmentImage({ file }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    getApiFileObjectUrl(`/support/attachments/${file.id}?preview=1`).then(url => {
      objectUrl = url;
      if (active) setSrc(url);
      else URL.revokeObjectURL(url);
    }).catch(() => {});
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id]);
  return src ? <img src={src} alt={file.original_name}/> : <span className="attachment-preview-loading">در حال دریافت پیش‌نمایش امن…</span>;
}

export function LoginPage({ navigate }) {
  const [phase, setPhase] = useState('password');
  const [authIntent, setAuthIntent] = useState('login');
  const [showPassword, setShowPassword] = useState(false);
  const [login, setLogin] = useState({ username:'', password:'' });
  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [otpRemaining, setOtpRemaining] = useState(0);
  const [resendRemaining, setResendRemaining] = useState(0);
  const [verifiedUser, setVerifiedUser] = useState(null);
  const [profile, setProfile] = useState({ full_name: '', email: '', national_id: '', company: '', job_title: '' });
  const [credentials, setCredentials] = useState({ username: '', password: '', repeat: '' });
  const [consentAccepted, setConsentAccepted] = useState(false);
  useEffect(() => {
    if (!otpRemaining && !resendRemaining) return undefined;
    const timer = window.setInterval(() => {
      setOtpRemaining(value => Math.max(0, value - 1));
      setResendRemaining(value => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [otpRemaining > 0 || resendRemaining > 0]);
  const acquisition = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return {
      source: params.get('source') || params.get('utm_source') || 'direct',
      campaign: params.get('campaign') || params.get('utm_campaign') || '',
      medium: params.get('utm_medium') || '',
      referrer: document.referrer || '',
      utm_source: params.get('utm_source') || '',
      utm_medium: params.get('utm_medium') || '',
      utm_campaign: params.get('utm_campaign') || '',
      utm_content: params.get('utm_content') || '',
      utm_term: params.get('utm_term') || '',
    };
  }, []);
  const goToMobile = intent => {
    setAuthIntent(intent);
    setPhase('mobile');
    setMessage('');
    setError('');
  };
  const finishLogin = user => {
    const target = user.role === 'support_agent'
      ? '/admin/support'
      : ['admin', 'super_admin'].includes(user.role)
        ? '/admin'
        : sessionStorage.getItem('aronage_after_login') || '/account';
    sessionStorage.removeItem('aronage_after_login');
    navigate(target);
  };
  const passwordLogin = async event => {
    event.preventDefault(); setLoading(true); setError('');
    try {
      const result = await api('/auth/password-login', { method:'POST', body:login });
      setToken(result.token); await syncCart('merge'); finishLogin(result.user);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };
  const submitMobile = async event => {
    event.preventDefault(); setLoading(true); setError('');
    try {
      const result = await api('/auth/request-otp', { method: 'POST', body: { mobile, intent: authIntent } });
      setMessage(result.message); setOtpRemaining(result.expiresIn || 180); setResendRemaining(45); setPhase('otp');
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };
  const verify = async event => {
    event.preventDefault(); setLoading(true); setError('');
    try {
      if (authIntent === 'reset') {
        setMessage('کد را همراه رمز جدید تأیید کنید.');
        setPhase('reset');
        return;
      }
      const result = await api('/auth/verify', {
        method: 'POST', body: { mobile, code, intent: authIntent, acquisition },
      });
      setToken(result.token);
      await syncCart('merge');
      if (['admin', 'super_admin', 'support_agent'].includes(result.user.role)) { finishLogin(result.user); return; }
      const me = await api('/me');
      const current = me;
      if (authIntent === 'register' && current.full_name && !current.username) {
        setVerifiedUser(result.user); setPhase('credentials'); return;
      }
      if (current.full_name) { finishLogin(result.user); return; }
      setVerifiedUser(result.user);
      setProfile({
        full_name: current.full_name || '', email: current.email || '',
        national_id: current.national_id || '', company: current.company || '',
        job_title: current.job_title || '',
      });
      setMessage('');
      setPhase('profile');
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };
  const saveInitialProfile = async event => {
    event.preventDefault(); setLoading(true); setError('');
    try {
      await api('/me', { method: 'PUT', body: profile });
      if (authIntent === 'register') {
        await api('/me', {
          method: 'PUT',
          body: {
            consent_version: 'v1-1405-05', consent_accepted_at: new Date().toISOString(),
            onboarding_completed_at: new Date().toISOString(),
          },
        });
        setMessage('');
        setPhase('credentials');
      } else {
        finishLogin(verifiedUser);
      }
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };
  const saveRegistrationCredentials = async event => {
    event.preventDefault(); setError('');
    if (credentials.password !== credentials.repeat) {
      setError('تکرار رمز عبور با رمز انتخابی یکسان نیست.');
      return;
    }
    setLoading(true);
    try {
      await api('/auth/customer-credentials', {
        method: 'PUT',
        body: { username: credentials.username, password: credentials.password },
      });
      finishLogin(verifiedUser);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };
  const resetPassword = async event => {
    event.preventDefault(); setError('');
    if (credentials.password !== credentials.repeat) return setError('تکرار رمز عبور با رمز انتخابی یکسان نیست.');
    setLoading(true);
    try {
      await api('/auth/reset-password', {
        method: 'POST', body: { mobile, code, password: credentials.password },
      });
      setMessage('رمز عبور تغییر کرد. اکنون با رمز جدید وارد شوید.');
      setPhase('password'); setAuthIntent('login'); setCode('');
      setCredentials({ username: '', password: '', repeat: '' });
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };
  const title = phase === 'password'
    ? 'ورود به حساب'
    : phase === 'mobile'
      ? authIntent === 'register' ? 'ساخت حساب جدید' : 'ورود با رمز موقت'
      : phase === 'otp'
        ? authIntent === 'register' ? 'تأیید شماره برای ثبت‌نام' : 'تأیید شماره همراه'
        : phase === 'profile'
          ? 'تکمیل اطلاعات فردی'
          : phase === 'reset' ? 'ساخت رمز عبور جدید' : 'ساخت اطلاعات ورود';
  const description = phase === 'password'
    ? 'با نام کاربری و رمز وارد شوید یا ورود پیامکی را انتخاب کنید.'
    : phase === 'mobile'
      ? authIntent === 'register' ? 'شماره همراه خود را وارد کنید تا حساب اختصاصی شما ساخته شود.' : 'شماره همراه حساب ثبت‌شده را وارد کنید.'
      : phase === 'otp'
        ? `کد ارسال‌شده به ${mobile} را وارد کنید.`
        : phase === 'profile'
          ? 'برای ساخت فضای اختصاصی، اطلاعات اولیه خود را وارد کنید.'
          : phase === 'reset'
            ? 'رمز جدید باید حداقل ۱۰ نویسه و شامل حرف بزرگ، حرف کوچک، عدد و نماد باشد.'
            : 'یک نام کاربری انگلیسی و رمز امن برای ورودهای بعدی انتخاب کنید.';
  return <div className="auth-page" dir="rtl">
    <div className="auth-art">
      <LogoButton onClick={() => navigate('/')}/>
      <div>
<span className="auth-kicker">حساب اختصاصی مشتریان</span>
<h1>همه مسیر پروژه،<br/>
<em>در یک فضای امن.</em>
</h1>
<p>سفارش‌ها، پرداخت‌ها، پیش‌فاکتورها و گفتگو با تیم راهکار را یک‌جا دنبال کنید.</p>
</div>
      <div className="auth-trust">
<span>
<ShieldCheck/> اطلاعات هر مشتری کاملاً مجزا</span>
<span>
<Check/> نسخه آفلاین با ذخیره دائمی</span>
</div>
    </div>
    <main className="auth-panel">
      <button className="auth-back" onClick={() => navigate('/')}>
<ArrowLeft/> بازگشت به سایت</button>
      <div className="auth-card">
        <span className="auth-icon">{authIntent === 'register' && phase !== 'password' ? <UserPlus/> : <CircleUserRound/>}</span>
        <h2>{title}</h2>
        <p>{description}</p>
        <Notice type="error">{error}</Notice>
        <Notice>{message}</Notice>
        {phase === 'password' ? <form onSubmit={passwordLogin}>
          <label>نام کاربری<input autoFocus dir="ltr" autoComplete="username" value={login.username} onChange={e=>setLogin({...login,username:e.target.value})} required/>
</label>
          <label>رمز عبور<div className="password-field">
<input dir="ltr" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={login.password} onChange={e=>setLogin({...login,password:e.target.value})} required/>
<button type="button" onClick={()=>setShowPassword(value=>!value)}>{showPassword?<EyeOff/>:<Eye/>}</button>
</div>
</label>
          <button className="portal-primary" disabled={loading}>{loading?'در حال ورود…':'ورود با نام کاربری و رمز'}<ChevronLeft/>
</button>
          <button type="button" className="portal-text-btn forgot-password" onClick={()=>goToMobile('reset')}>رمز عبور را فراموش کرده‌ام</button>
          <button type="button" className="portal-text-btn" onClick={()=>goToMobile('login')}>ورود با کد پیامکی</button>
          <div className="auth-register-prompt">
<span>حساب کاربری ندارید؟</span>
<button type="button" onClick={()=>goToMobile('register')}>ثبت‌نام کنید</button>
</div>
        </form> : phase === 'mobile' ? <form onSubmit={submitMobile}>
          <label>شماره همراه<input autoFocus dir="ltr" inputMode="tel" value={mobile} onChange={e => setMobile(e.target.value)} placeholder="09121234567" required/>
</label>
          <button className="portal-primary" disabled={loading}>{loading ? 'در حال بررسی…' : authIntent === 'register' ? 'دریافت کد ثبت‌نام' : 'دریافت کد ورود'}<ChevronLeft/>
</button>
          <button type="button" className="portal-text-btn" onClick={()=>{setPhase('password');setError('');setMessage('')}}>{authIntent === 'register' ? 'حساب دارید؟ وارد شوید' : 'بازگشت به ورود با رمز'}</button>
        </form> : phase === 'otp' ? <form onSubmit={verify}>
          <label>کد ورود<input autoFocus className="otp-input" dir="ltr" inputMode="numeric" maxLength="6" value={code} onChange={e => setCode(e.target.value)} placeholder="1234" required/>
</label>
          <small className="demo-code">اعتبار کد: <b>{fa(Math.floor(otpRemaining / 60))}:{fa(String(otpRemaining % 60).padStart(2, '0'))}</b> · در نسخه نمایشی کد <b>1234</b> است.</small>
          <button className="portal-primary" disabled={loading}>{loading ? 'در حال بررسی…' : authIntent === 'register' ? 'تأیید و ادامه ثبت‌نام' : 'ورود به حساب'}<ChevronLeft/>
</button>
          <button type="button" className="portal-text-btn" disabled={resendRemaining > 0 || loading} onClick={submitMobile}>{resendRemaining > 0 ? `ارسال مجدد تا ${fa(resendRemaining)} ثانیه دیگر` : 'ارسال مجدد کد'}</button>
          <button type="button" className="portal-text-btn" onClick={() => { setPhase('mobile'); setMessage(''); }}>تغییر شماره همراه</button>
        </form> : phase === 'profile' ? <form onSubmit={saveInitialProfile}>
          <div className="form-grid onboarding-grid">
            <label>نام و نام خانوادگی<input autoFocus value={profile.full_name} onChange={e => setProfile({ ...profile, full_name: e.target.value })} required/>
</label>
            <label>کد ملی<input dir="ltr" inputMode="numeric" maxLength="10" value={profile.national_id} onChange={e => setProfile({ ...profile, national_id: e.target.value })}/>
</label>
            <label>ایمیل<input dir="ltr" type="email" value={profile.email} onChange={e => setProfile({ ...profile, email: e.target.value })}/>
</label>
            <label>شرکت / سازمان<input value={profile.company} onChange={e => setProfile({ ...profile, company: e.target.value })}/>
</label>
            <label>سمت سازمانی<input value={profile.job_title} onChange={e => setProfile({ ...profile, job_title: e.target.value })}/>
</label>
          </div>
          {authIntent === 'register' && <label className="consent-check">
<input type="checkbox" checked={consentAccepted} onChange={event => setConsentAccepted(event.target.checked)} required/>
<span>شرایط استفاده و سیاست حریم خصوصی راهکار را می‌پذیرم.</span>
</label>}
          <button className="portal-primary" disabled={loading || (authIntent === 'register' && !consentAccepted)}>{loading ? 'در حال ذخیره…' : authIntent === 'register' ? 'ادامه و ساخت اطلاعات ورود' : 'ذخیره و ورود به پنل'}<ChevronLeft/>
</button>
        </form> : phase === 'reset' ? <form onSubmit={resetPassword}>
          <label>رمز عبور جدید<div className="password-field">
<input autoFocus dir="ltr" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength="10" value={credentials.password} onChange={e=>setCredentials({...credentials,password:e.target.value})} required/>
<button type="button" onClick={()=>setShowPassword(value=>!value)}>{showPassword?<EyeOff/>:<Eye/>}</button>
</div>
</label>
          <label>تکرار رمز جدید<input dir="ltr" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength="10" value={credentials.repeat} onChange={e=>setCredentials({...credentials,repeat:e.target.value})} required/>
</label>
          <button className="portal-primary" disabled={loading}>{loading ? 'در حال بازنشانی…' : 'تأیید کد و تغییر رمز'}<ChevronLeft/>
</button>
        </form> : <form onSubmit={saveRegistrationCredentials}>
          <label>نام کاربری<input autoFocus dir="ltr" autoComplete="username" pattern="[A-Za-z][A-Za-z0-9._-]{3,39}" value={credentials.username} onChange={e=>setCredentials({...credentials,username:e.target.value})} placeholder="مثلاً mehdi.rahkar" required/>
<small>۴ تا ۴۰ نویسه انگلیسی؛ شروع با حرف</small>
</label>
          <label>رمز عبور<div className="password-field">
<input dir="ltr" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength="10" value={credentials.password} onChange={e=>setCredentials({...credentials,password:e.target.value})} required/>
<button type="button" onClick={()=>setShowPassword(value=>!value)} aria-label={showPassword?'مخفی‌کردن رمز':'نمایش رمز'}>{showPassword?<EyeOff/>:<Eye/>}</button>
</div>
<small>حداقل ۱۰ نویسه شامل حروف بزرگ، کوچک، عدد و نماد</small>
</label>
          <label>تکرار رمز عبور<input dir="ltr" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength="10" value={credentials.repeat} onChange={e=>setCredentials({...credentials,repeat:e.target.value})} required/>
</label>
          <button className="portal-primary" disabled={loading}>{loading ? 'در حال ساخت حساب…' : 'تکمیل ثبت‌نام و ورود'}<ChevronLeft/>
</button>
        </form>}
      </div>
    </main>
  </div>;
}

const navItems = [
  ['/account', Home, 'خانه'],
  ['/account/orders', Package, 'سفارش‌ها'],
  ['/account/ai-assistant', Bot, 'دستیار تخصصی'],
  ['/account/help', Headphones, 'پشتیبانی'],
  ['/account/quotes', FileText, 'پیش‌فاکتورها'],
  ['/account/payments', CreditCard, 'پرداخت‌ها'],
  ['/account/profile', UserRound, 'پروفایل'],
];

function PortalShell({ navigate, route, user, children }) {
  const [open, setOpen] = useState(false);
  const logout = async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch {}
    setToken(null); navigate('/');
  };
  const go = path => { navigate(path); setOpen(false); };
  return <div className="portal-shell" dir="rtl">
    <a className="skip-link" href="#portal-content">رفتن به محتوای اصلی</a>
    <aside className={open ? 'open' : ''}>
      <div className="portal-aside-head">
<LogoButton onClick={() => go('/')}/>
<button onClick={() => setOpen(false)} aria-label="بستن منو">
<X/>
</button>
</div>
      <div className="portal-user">
<span>{(user.full_name || 'مشتری راهکار').slice(0, 1)}</span>
<div>
<b>{user.full_name || 'مشتری راهکار'}</b>
<small>{user.mobile}</small>
</div>
</div>
      <nav>{navItems.map(([path, Icon, label]) => <button key={path} className={route === path || (path === '/account/help' && (route.startsWith('/account/help') || ['/account/support','/account/consultations'].includes(route))) ? 'active' : ''} onClick={() => go(path)}>
<Icon/>{label}</button>)}</nav>
      {['admin', 'super_admin'].includes(user.role) && <button className="admin-entry" onClick={() => go('/admin')}>
<Settings/> پنل مدیریت</button>}
      <button className="portal-logout" onClick={logout}>
<LogOut/> خروج از حساب</button>
    </aside>
    {open && <button className="portal-scrim" onClick={() => setOpen(false)} aria-label="بستن منو"/>}
    <section className="portal-main">
      <header>
<button className="portal-menu" onClick={() => setOpen(true)} aria-label="بازکردن منو">
<Menu/>
</button>
<div>
<small>حساب مشتریان راهکار</small>
<b>{user.full_name ? `سلام، ${user.full_name.split(' ')[0]}` : 'خوش آمدید'}</b>
</div>
<div className="portal-head-actions">
<span className="mode-chip">{location.hostname === 'localhost' ? 'حالت آفلاین' : 'نسخه آنلاین'}</span>
<button onClick={() => go('/account')} aria-label="اعلان‌ها">
<Bell/>
</button>
</div>
</header>
      <main id="portal-content">{children}</main>
      <nav className="portal-bottom-nav">{[navItems[0], navItems[1], navItems[2], navItems[3]].map(([path, Icon, label]) => <button key={path} className={route === path || (path === '/account/help' && (route.startsWith('/account/help') || ['/account/support','/account/consultations'].includes(route))) ? 'active' : ''} onClick={() => go(path)}>
<Icon/>
<span>{label}</span>
</button>)}</nav>
    </section>
  </div>;
}

function Empty({ icon: Icon = Package, title, text, action, actionLabel }) {
  return <div className="portal-empty">
<span>
<Icon/>
</span>
<h3>{title}</h3>
<p>{text}</p>{action && <button className="portal-primary compact" onClick={action}>
<Plus/>{actionLabel}</button>}</div>;
}
function Loader() { return <div className="portal-skeleton">
<i/>
<i/>
<i/>
</div>; }
function PageHead({ eyebrow, title, text, action }) {
  return <div className="portal-page-head">
<div>
<span>{eyebrow}</span>
<h1>{title}</h1>{text && <p>{text}</p>}</div>{action}</div>;
}

function Dashboard({ summary, navigate, user }) {
  const currentOrder = summary.orders[0];
  return <>
    <section className="portal-welcome">
<div>
<span>مرکز کنترل مشتری</span>
<h1>{user.full_name ? `${user.full_name.split(' ')[0]} عزیز،` : ''} مرکز همکاری سازمان شما آماده است.</h1>
<p>درخواست خدمات، پیشنهادها و گفتگو با دستیار تخصصی و کارشناسان راهکار را از اینجا دنبال کنید.</p>
</div>
<button onClick={() => navigate('/shop')}>مشاهده فروشگاه <ShoppingBag/>
</button>
</section>
    <div className="portal-kpis">
      <article>
<span>
<Package/>
</span>
<div>
<small>سفارش‌ها</small>
<b>{fa(summary.orders.length)}</b>
</div>
</article>
      <article>
<span>
<FileText/>
</span>
<div>
<small>پیش‌فاکتورهای فعال</small>
<b>{fa(summary.quotes.filter(q => q.status !== 'closed').length)}</b>
</div>
</article>
      <article>
<span>
<Building2/>
</span>
<div>
<small>پروژه‌های فعال</small>
<b>{fa(summary.projects.length)}</b>
</div>
</article>
      <article>
<span>
<MessageCircle/>
</span>
<div>
<small>گفتگوهای باز</small>
<b>{fa(summary.tickets.filter(t => t.status === 'open').length)}</b>
</div>
</article>
    </div>
    <div className="portal-dashboard-grid">
      <section className="portal-card current-order">
<div className="portal-card-title">
<div>
<span>آخرین سفارش</span>
<h2>{currentOrder ? currentOrder.order_no : 'هنوز سفارشی ندارید'}</h2>
</div>{currentOrder && <span className={`status ${currentOrder.status}`}>{status(currentOrder.status)}</span>}</div>
        {currentOrder ? <>
<div className="order-progress">
<i className="done"/>
<i className={['paid','reviewing','confirmed','preparing','ready_to_ship','processing','shipped','delivered','return_requested','returned','refunded'].includes(currentOrder.status) ? 'done' : ''}/>
<i className={['shipped','delivered','return_requested','returned','refunded'].includes(currentOrder.status) ? 'done' : ''}/>
<i className={['delivered','return_requested','returned','refunded'].includes(currentOrder.status) ? 'done' : ''}/>
</div>
<div className="order-progress-labels">
<span>ثبت سفارش</span>
<span>بررسی کارشناسی</span>
<span>پیشنهاد و اجرا</span>
<span>تحویل و پشتیبانی</span>
</div>
<div className="current-order-foot">
<span>مبلغ کل <b>{money(currentOrder.total)}</b>
</span>
<button onClick={() => navigate('/account/orders')}>جزئیات سفارش <ChevronLeft/>
</button>
</div>
</> : <Empty title="اولین درخواست را ثبت کنید" text="خدمات سازمانی راهکار را ببینید و مسیر مناسب را انتخاب کنید." action={() => navigate('/shop')} actionLabel="مشاهده خدمات"/>}
      </section>
      <section className="portal-card quick-actions">
<div className="portal-card-title">
<div>
<span>دسترسی سریع</span>
<h2>چه کاری دارید؟</h2>
</div>
</div>
<div>
<button onClick={() => navigate('/account/ai-assistant')}>
<Bot/>
<span>
<b>دستیار تخصصی هوش مصنوعی</b>
<small>صورت‌بندی نیاز و انتخاب مسیر شروع</small>
</span>
<ChevronLeft/>
</button>
<button onClick={() => navigate('/account/help')}>
<Headphones/>
<span>
<b>گفتگو با کارشناس</b>
<small>پیگیری درخواست و دریافت پشتیبانی</small>
</span>
<ChevronLeft/>
</button>
</div>
</section>
      <section className="portal-card notifications">
<div className="portal-card-title">
<div>
<span>آخرین رویدادها</span>
<h2>اعلان‌های شما</h2>
</div>
</div>{summary.notifications.length ? summary.notifications.map(n => <article key={n.id}>
<i className={n.read_at ? '' : 'unread'}/>
<div>
<b>{n.title}</b>
<p>{n.body}</p>
<small>{date(n.created_at)}</small>
</div>
</article>) : <Empty icon={Bell} title="اعلانی ندارید" text="رویدادهای جدید اینجا نمایش داده می‌شوند."/>}</section>
      <section className="portal-card advisor">
<span>
<Headphones/>
</span>
<h2>پشتیبانی راهکار</h2>
<p>برای تحلیل نیاز، پیگیری درخواست یا حل مشکل، مستقیم با تیم پشتیبانی در ارتباط باشید.</p>
<button onClick={() => navigate('/account/help')}>ورود به مرکز ارتباط <ArrowLeft/>
</button>
</section>
    </div>
  </>;
}

function OrdersPage({ orders, navigate, refresh }) {
  const [paying, setPaying] = useState('');
  const [notice, setNotice] = useState('');
  const pay = async order => {
    setPaying(order.id); setNotice('');
    try {
      const result = await api('/payments/prepare', { method: 'POST', body: { orderId: order.id } });
      setNotice(result.message);
      if (result.gatewayActive && result.gatewayUrl) location.href = result.gatewayUrl;
      await refresh();
    } catch (err) { setNotice(err.message); }
    finally { setPaying(''); }
  };
  return <>
<PageHead eyebrow="سفارش‌ها" title="تاریخچه سفارش‌های من" text="همه قیمت‌ها در زمان ثبت سفارش ثابت و در سوابق نگهداری می‌شوند." action={<button className="portal-primary compact" onClick={() => navigate('/shop')}>
<Plus/> سفارش جدید</button>}/>
<Notice>{notice}</Notice>
    {orders.length ? <div className="portal-list">{orders.map(order => <article key={order.id} className="order-list-card">
<div>
<span className={`status ${order.status}`}>{status(order.status)}</span>
<h3>{order.order_no}</h3>
<small>ثبت‌شده در {date(order.created_at)}</small>
</div>
<div className="order-list-price">
<small>مبلغ نهایی</small>
<b>{money(order.total)}</b>
</div>
<div className="order-list-actions">{order.status === 'awaiting_payment' && <button onClick={() => pay(order)} disabled={paying === order.id}>
<CreditCard/>{paying === order.id ? 'در حال آماده‌سازی…' : 'ادامه پرداخت'}</button>}<button onClick={() => navigate(`/account/orders/${order.id}`)}>مشاهده جزئیات <ChevronLeft/>
</button>
</div>
</article>)}</div> : <Empty title="هنوز سفارشی ثبت نشده" text="از فروشگاه محصول انتخاب کنید؛ سفارش مستقیماً در فضای اختصاصی شما ذخیره می‌شود." action={() => navigate('/shop')} actionLabel="مشاهده فروشگاه"/>}
  </>;
}

function EngineeringServicesPage({ records, navigate }) {
  return <>
    <PageHead
      eyebrow="خدمات مهندسی"
      title="درخواست‌های مطالعات نیروگاه"
      text="وضعیت پتانسیل‌سنجی، سایت‌پلن و طرح توجیهی را از اینجا پیگیری کنید."
      action={<button className="portal-primary compact" onClick={() => navigate('/shop/services/engineering')}><Plus/> درخواست جدید</button>}
    />
    {records.length ? <div className="engineering-account-list">{records.map(item => <article key={item.id}>
      <div className="engineering-account-head">
        <div><small>شماره درخواست</small><h2 dir="ltr">{item.request_no}</h2></div>
        <span className={`status ${item.status}`}>{status(item.status)}</span>
      </div>
      <div className="engineering-account-meta">
        <span><small>ظرفیت</small><b>{fa(item.capacity_kw)} کیلووات</b></span>
        <span><small>استان</small><b>{item.province}</b></span>
        <span><small>تاریخ ثبت</small><b>{date(item.created_at)}</b></span>
        <span><small>مبلغ قطعی</small><b>{money(item.total_price)}</b></span>
      </div>
      <div className="engineering-account-services">{item.services.map(service => <em key={service}>{engineeringServiceNames[service] || service}</em>)}</div>
      {item.project_title && <p><b>عنوان پروژه:</b> {item.project_title}</p>}
      {item.admin_note && <div className="engineering-account-note"><b>پیام واحد فروش و مهندسی</b><p>{item.admin_note}</p></div>}
    </article>)}</div> : <Empty
      icon={ClipboardList}
      title="هنوز درخواست خدمات مهندسی ندارید"
      text="برای پتانسیل‌سنجی، سایت‌پلن یا طرح توجیهی، اطلاعات پروژه را ثبت کنید؛ فایل نقشه اختیاری است."
      action={() => navigate('/shop/services/engineering')}
      actionLabel="ثبت درخواست"
    />}
  </>;
}

function OrderDetail({ id, navigate }) {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [returnForm, setReturnForm] = useState({ reason: '', description: '' });
  const refresh = () => api(`/orders/${id}`).then(setOrder).catch(err => setError(err.message));
  useEffect(refresh, [id]);
  const pay = async () => {
    setBusy(true); setNotice('');
    try {
      const result = await api('/payments/prepare', { method: 'POST', body: { orderId: id } });
      setNotice(result.message);
      if (result.gatewayActive && result.gatewayUrl) location.href = result.gatewayUrl;
      else await refresh();
    } catch (err) { setNotice(err.message); }
    finally { setBusy(false); }
  };
  const cancel = async event => {
    event.preventDefault(); setBusy(true); setNotice('');
    try {
      await api(`/orders/${id}/cancel`, { method: 'POST', body: { reason: cancelReason } });
      setNotice('سفارش لغو و موجودی رزروشده آزاد شد.'); setCancelReason(''); await refresh();
    } catch (err) { setNotice(err.message); }
    finally { setBusy(false); }
  };
  const requestReturn = async event => {
    event.preventDefault(); setBusy(true); setNotice('');
    try {
      await api(`/orders/${id}/returns`, {
        method: 'POST',
        body: {
          ...returnForm,
          items: order.items.map(item => ({ orderItemId: item.id, quantity: item.quantity })),
        },
      });
      setNotice('درخواست مرجوعی ثبت شد و نتیجه بررسی از همین صفحه اعلام می‌شود.');
      setReturnForm({ reason: '', description: '' }); await refresh();
    } catch (err) { setNotice(err.message); }
    finally { setBusy(false); }
  };
  if (error) return <Notice type="error">{error}</Notice>;
  if (!order) return <Loader/>;
  const address = order.address_snapshot;
  const shipment = order.shipments?.[0];
  const latestPayment = order.payments?.at(-1);
  const canReturn = ['shipped', 'delivered'].includes(order.status) && !order.returns?.some(item => ['requested', 'approved', 'received'].includes(item.status));
  return <div className="printable-order">
<div className="no-print">
<button className="portal-back" onClick={() => navigate('/account/orders')}>
<ArrowLeft/> بازگشت به سفارش‌ها</button>
</div>
<PageHead eyebrow={order.invoice ? `فاکتور ${order.invoice.invoice_no}` : 'جزئیات سفارش'} title={order.order_no} text={`ثبت‌شده در ${date(order.created_at)}`} action={order.invoice && <button className="portal-primary compact no-print" onClick={() => window.print()}>
<FileText/> چاپ یا ذخیره PDF</button>}/>
    <Notice type={/(ثبت شد|لغو و|آماده)/.test(notice) ? 'info' : 'error'}>{notice}</Notice>
    <div className="order-detail-grid">
<section className="portal-card">
<div className="portal-card-title">
<h2>اقلام سفارش</h2>
<span className={`status ${order.status}`}>{status(order.status)}</span>
</div>
<div className="order-items">{order.items.map(item => <div key={item.id}>
<div>
<b>{item.product_name}</b>
<small>تعداد {fa(item.quantity)} × {money(item.unit_price)}</small>
</div>
<span>{money(item.line_total)}</span>
</div>)}</div>
<div className="order-totals">
<span>جمع خدمات و اقلام <b>{money(order.subtotal)}</b>
</span>{Number(order.discount_total) > 0 && <span>تخفیف <b>− {money(order.discount_total)}</b>
</span>}{Number(order.tax_total) > 0 && <span>مالیات <b>{money(order.tax_total)}</b>
</span>}<span>ارسال <b>{order.shipping ? money(order.shipping) : 'رایگان'}</b>
</span>
<strong>مبلغ نهایی <b>{money(order.total)}</b>
</strong>
</div>
      {address && <div className="order-snapshot">
<h3>نشانی گیرنده در زمان خرید</h3>
<b>{address.recipient} — {address.mobile}</b>
<p>{address.province}، {address.city}، {address.address}</p>
<small>کدپستی: {address.postal_code || '—'}</small>
</div>}
      {shipment && <div className="shipment-card">
        <h3>رهگیری ارسال</h3>
        <span><b>{shipment.company || shipment.method}</b><em className={`status ${shipment.status}`}>{status(shipment.status)}</em></span>
        <p>کد رهگیری: <b dir="ltr">{shipment.tracking_code || 'هنوز ثبت نشده'}</b></p>
        <small>تحویل تقریبی: {exactDate(shipment.estimated_delivery_at)}</small>
      </div>}
      {latestPayment && <div className="payment-receipt">
        <h3>آخرین وضعیت پرداخت</h3>
        <span><b>{status(latestPayment.status)}</b><small>{money(latestPayment.amount)}</small></span>
        {latestPayment.transaction_id && <p>شناسه تراکنش: <b dir="ltr">{latestPayment.transaction_id}</b></p>}
        {latestPayment.failure_reason && <p className="danger-text">{latestPayment.failure_reason}</p>}
      </div>}
    </section>
<aside className="portal-card">
<h2>تاریخچه وضعیت</h2>
<div className="vertical-timeline">{(order.history?.length ? order.history : [{ id:'created', to_status:'awaiting_payment', created_at:order.created_at }]).map(step => <span className="done" key={step.id}>
<i/>
<b>{status(step.to_status)}</b>
<small>{exactDate(step.created_at)}</small>
{step.note && <p>{step.note}</p>}
</span>)}</div>{order.invoice && <div className="invoice-summary">
<small>شماره فاکتور</small>
<b dir="ltr">{order.invoice.invoice_no}</b>
<small>وضعیت: {status(order.invoice.status)}</small>
</div>}
      {order.status === 'awaiting_payment' && <div className="customer-order-actions no-print">
        <button className="portal-primary" onClick={pay} disabled={busy}><CreditCard/>{busy ? 'در حال بررسی…' : latestPayment?.status === 'failed' ? 'تلاش دوباره برای پرداخت' : 'ادامه پرداخت'}</button>
        <form onSubmit={cancel}>
          <label>دلیل لغو<input value={cancelReason} onChange={event => setCancelReason(event.target.value)} minLength="5" required/></label>
          <button className="danger-action" disabled={busy}><X/> لغو سفارش</button>
        </form>
      </div>}
      {canReturn && <form className="return-request-form no-print" onSubmit={requestReturn}>
        <h3>درخواست مرجوعی اقلام</h3>
        <label>دلیل مرجوعی<input value={returnForm.reason} onChange={event => setReturnForm({ ...returnForm, reason: event.target.value })} minLength="3" required/></label>
        <label>شرح مشکل<textarea rows="3" value={returnForm.description} onChange={event => setReturnForm({ ...returnForm, description: event.target.value })}/></label>
        <small>در این نسخه همه اقلام سفارش انتخاب می‌شوند؛ تیم فروش پس از بررسی تعداد نهایی را تأیید می‌کند.</small>
        <button className="portal-primary" disabled={busy}><RefreshCw/> ثبت درخواست مرجوعی</button>
      </form>}
      {order.returns?.length > 0 && <div className="return-history">
        <h3>سوابق مرجوعی</h3>
        {order.returns.map(item => <span key={item.id}><b>{item.return_no}</b><em className={`status ${item.status}`}>{status(item.status)}</em><small>{date(item.created_at)}</small></span>)}
      </div>}
    </aside>
</div>
  </div>;
}

function PaymentResultPage({ route, navigate }) {
  const params = new URLSearchParams(route.split('?')[1] || '');
  const orderId = params.get('order') || '';
  const callbackStatus = params.get('status') || 'pending';
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!orderId) return;
    let attempts = 0;
    const check = async () => {
      try {
        const data = await api(`/orders/${orderId}/payment-status`);
        setResult(data); setError('');
        attempts += 1;
        if (data.paymentStatus !== 'paid' && attempts < 5) window.setTimeout(check, 1800);
      } catch (err) { setError(err.message); }
    };
    check();
  }, [orderId]);
  const success = result?.paymentStatus === 'paid' || callbackStatus === 'success';
  const pending = !success && result && !['failed', 'cancelled'].includes(result.payment?.status);
  return <div className={`payment-result-card ${success ? 'success' : pending ? 'pending' : 'failed'}`}>
    <span>{success ? <Check/> : pending ? <Clock/> : <X/>}</span>
    <h1>{success ? 'پرداخت با موفقیت ثبت شد' : pending ? 'در حال دریافت نتیجه پرداخت' : 'پرداخت کامل نشد'}</h1>
    <p>{success ? 'رسید پرداخت و سفارش شما در حساب راهکار ذخیره شده است.' : pending ? 'Callback درگاه ممکن است با کمی تأخیر برسد؛ وضعیت به‌صورت خودکار بررسی می‌شود.' : result?.payment?.failureReason || 'می‌توانید بدون ساخت سفارش جدید، دوباره پرداخت را انجام دهید.'}</p>
    <Notice type="error">{error}</Notice>
    {result && <div><span>شماره سفارش <b>{result.orderNo}</b></span><span>وضعیت <b>{status(result.paymentStatus)}</b></span>{result.payment?.transactionId && <span>شناسه تراکنش <b dir="ltr">{result.payment.transactionId}</b></span>}</div>}
    <button className="portal-primary" onClick={() => navigate(orderId ? `/account/orders/${orderId}` : '/account/orders')}>{success ? 'مشاهده رسید و سفارش' : 'بازگشت و تلاش دوباره'}<ChevronLeft/></button>
  </div>;
}

function SimpleRecords({ type, records, navigate }) {
  const configs = {
    quotes: ['پیش‌فاکتورها', 'پیشنهادهای مالی و فنی', FileText],
    payments: ['پرداخت‌ها', 'تاریخچه درخواست‌های پرداخت', CreditCard],
    projects: ['پروژه‌ها', 'وضعیت پروژه‌های فعال', Building2],
  };
  const [eyebrow, title, Icon] = configs[type];
  return <>
<PageHead eyebrow={eyebrow} title={title}/>{records.length ? <div className="portal-list">{records.map(item => <article className="record-card" key={item.id}>
<span>
<Icon/>
</span>
<div>
<h3>{item.title || item.quote_no || item.provider}</h3>
<small>{date(item.created_at)}</small>
</div>{item.amount != null && <b>{money(item.amount)}</b>}<em className={`status ${item.status}`}>{status(item.status)}</em>
</article>)}</div> : <Empty icon={Icon} title={`هنوز ${eyebrow}ی وجود ندارد`} text="رکوردهای جدید پس از ثبت یا تأیید تیم راهکار اینجا نمایش داده می‌شوند."/>}</>;
}

function SupportPane({ records, refresh, user }) {
  const [tickets, setTickets] = useState(Array.isArray(records) ? records : []);
  const [form, setForm] = useState({ category: '', subject: '', message: '', priority: 'normal' });
  const [notice, setNotice] = useState('');
  const [active, setActive] = useState('');
  const [thread, setThread] = useState(null);
  const [reply, setReply] = useState('');
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [liveState, setLiveState] = useState('connecting');
  const [failedMessage, setFailedMessage] = useState(null);
  const [csat, setCsat] = useState({ rating: 0, comment: '', sent: false });
  const messageLog = useRef(null);
  const draftKey = active ? `aronage_support_draft:${active}` : '';
  const loadTickets = async () => {
    const result = await api('/support/tickets?page=1&limit=50');
    setTickets(result.items);
    return result.items;
  };
  const openThread = async id => {
    setActive(id); setThread(null); setNotice('');
    try {
      const data = await api(`/support/tickets/${id}/messages?limit=60`);
      setThread(data);
      setReply(localStorage.getItem(`aronage_support_draft:${id}`) || '');
      await api(`/support/tickets/${id}/read`, { method: 'POST', body: {} });
      window.setTimeout(() => messageLog.current?.scrollTo({ top: messageLog.current.scrollHeight, behavior: 'smooth' }), 20);
    } catch (err) { setNotice(err.message); }
  };
  useEffect(() => {
    loadTickets().catch(err => setNotice(err.message));
    return subscribeEvents('/support/events', event => {
      if (event.event === 'message.created' || event.event.startsWith('ticket.')) {
        loadTickets().catch(() => {});
        if (active && event.data.ticket_id === active) openThread(active);
      }
    }, setLiveState);
  }, [active]);
  useEffect(() => {
    if (!draftKey) return;
    const timer = window.setTimeout(() => localStorage.setItem(draftKey, reply), 250);
    return () => window.clearTimeout(timer);
  }, [reply, draftKey]);
  const submit = async event => {
    event.preventDefault(); setSending(true); setNotice('');
    try {
      const created = await api('/support/tickets', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: form,
      });
      setForm({ category: '', subject: '', message: '', priority: 'normal' });
      setNotice(created.status === 'queued' ? 'گفتگو ثبت و به صف کارشناس انسانی منتقل شد.' : 'گفتگو ثبت شد؛ دستیار هوشمند راهکار در حال بررسی منابع است.');
      await loadTickets(); await openThread(created.id); await refresh();
    } catch (err) { setNotice(err.message); }
    finally { setSending(false); }
  };
  const uploadPending = async () => {
    if (!files.length) return [];
    const data = new FormData();
    files.forEach(file => data.append('files', file));
    const uploaded = await api(`/support/tickets/${active}/attachments`, { method: 'POST', body: data });
    return uploaded.items.map(item => item.id);
  };
  const sendReply = async event => {
    event?.preventDefault?.();
    if (!reply.trim() || sending) return;
    const body = reply.trim();
    setSending(true); setNotice(''); setFailedMessage(null);
    try {
      const attachmentIds = await uploadPending();
      await api(`/support/tickets/${active}/messages`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: { body, attachmentIds },
      });
      setReply(''); setFiles([]); localStorage.removeItem(draftKey); await openThread(active); await loadTickets();
    } catch (err) {
      setNotice(err.message); setFailedMessage({ body, files });
    } finally { setSending(false); }
  };
  const retryFailed = () => {
    if (!failedMessage || sending) return;
    setReply(failedMessage.body);
    setFiles(failedMessage.files);
    window.setTimeout(() => document.querySelector('.customer-composer')?.requestSubmit(), 0);
  };
  const submitCsat = async () => {
    if (!csat.rating) return;
    try {
      await api(`/support/tickets/${active}/csat`, {
        method: 'POST', body: { rating: csat.rating, comment: csat.comment, targetType: thread?.agent ? 'agent' : 'ai' },
      });
      setCsat(current => ({ ...current, sent: true }));
      setNotice('نظر شما با موفقیت ثبت شد.');
    } catch (err) { setNotice(err.message); }
  };
  const requestHuman = async () => {
    try {
      await api(`/support/tickets/${active}/human`, { method: 'POST', body: { reason: 'درخواست مشتری از رابط گفتگو' } });
      setNotice('درخواست شما ثبت شد و گفتگو به صف کارشناس انسانی منتقل شد.');
      await openThread(active); await loadTickets();
    } catch (err) { setNotice(err.message); }
  };
  const feedback = async (messageId, helpful) => {
    try { await api('/support/ai-feedback', { method: 'POST', body: { messageId, helpful } }); setNotice(helpful ? 'از بازخورد شما متشکریم.' : 'بازخورد ثبت و گفتگو به کارشناس انسانی منتقل شد.'); await loadTickets(); }
    catch (err) { setNotice(err.message); }
  };
  const onComposerKey = event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent?.isComposing) {
      event.preventDefault(); sendReply();
    }
  };
  const selected = tickets.find(item => item.id === active);
  const isMobileThread = Boolean(active);
  const humanRequested = ['queued', 'assigned', 'agent_active', 'waiting_customer', 'waiting_internal', 'snoozed'].includes(thread?.ticket?.status);
  return <>
<Notice>{notice}</Notice>
    <div className={`support-live-state ${liveState}`}>{liveState === 'connected' ? <Wifi/> : <WifiOff/>}<span>
<b>{liveState === 'connected' ? 'ارتباط زنده برقرار است' : 'در حال اتصال مجدد…'}</b>
<small>پیام‌ها بدون Refresh دریافت می‌شوند</small>
</span>
</div>
    <div className={`support-layout support-v5-customer ${isMobileThread ? 'mobile-thread-open' : ''}`}>
      <section className="portal-card support-list">
        <div className="portal-card-title">
<div>
<span>تاریخچه ارتباط</span>
<h2>گفتگوهای من</h2>
</div>
<button className="portal-primary compact" onClick={() => { setActive(''); setThread(null); }}>
<Plus/> جدید</button>
</div>
        {tickets.length ? <div className="support-ticket-list">{tickets.map(item => <button className={active === item.id ? 'active' : ''} key={item.id} onClick={() => openThread(item.id)}>
          <span className={`status ${item.status}`}>{status(item.status)}</span>
<b>{item.subject}</b>
          <small>{item.public_no || item.ticket_no} · {exactDate(item.last_activity_at || item.created_at)}{Number(item.unread_customer) ? ` · ${fa(item.unread_customer)} جدید` : ''}</small>
        </button>)}</div> : <Empty icon={MessageCircle} title="گفتگویی ندارید" text="برای پیگیری سفارش یا دریافت راهنمایی، گفتگوی آنلاین را شروع کنید."/>}
      </section>
      {active ? <section className="portal-card support-thread" aria-label="گفتگوی پشتیبانی">
        <header className="customer-thread-head">
          <button className="mobile-thread-back" onClick={() => { setActive(''); setThread(null); }} aria-label="بازگشت به فهرست گفتگوها">
<ArrowRight/>
</button>
          <span className={`thread-avatar ${thread?.agent ? 'agent' : 'ai'}`}>{thread?.agent?.avatar_url ? <img src={thread.agent.avatar_url} alt=""/> : thread?.agent ? (thread.agent.full_name || 'ک').slice(0, 1) : <Bot/>}</span>
          <div>
<small>{thread?.ticket?.public_no || selected?.public_no || 'در حال دریافت'}</small>
<h2>{thread?.ticket?.subject || selected?.subject}</h2>
<p>{thread?.agent ? `${thread.agent.full_name || 'کارشناس راهکار'} · ${thread.agent.presence_status === 'online' ? 'آنلاین' : 'آفلاین'}` : 'دستیار هوشمند راهکار · پاسخ‌های AI مشخص و مستند هستند'}</p>
</div>
          <div>
<span className={`status ${thread?.ticket?.status || selected?.status}`}>{status(thread?.ticket?.status || selected?.status)}</span>
<button className="human-handoff" onClick={requestHuman} disabled={humanRequested}>
<UserRound/> {humanRequested ? 'درخواست اتصال ثبت شد' : 'اتصال به کارشناس انسانی'}</button>
</div>
        </header>
        {thread ? <>
          <div className="thread-entity-bar">
<span>اولویت: <b>{thread.ticket.final_priority === 'critical' ? 'بحرانی' : thread.ticket.final_priority === 'high' ? 'زیاد' : 'عادی'}</b>
</span>{thread.ticket.order_id && <span>سفارش متصل: <b>{thread.ticket.order_id}</b>
</span>}<span>تیم مسئول: <b>{thread.team?.name || 'صف عمومی'}</b>
</span><span>پاسخ تقریبی: <b>{thread.agent?.presence_status === 'online' ? 'در همین نوبت کاری' : 'طبق SLA صف'}</b>
</span>{thread.ticket.escalation_requested_at && <span>درخواست اتصال: <b>{exactDate(thread.ticket.escalation_requested_at)}</b>
</span>}{thread.ticket.snoozed_until && <span>بازگشت به صف: <b>{exactDate(thread.ticket.snoozed_until)}</b>
</span>}
</div>
          <div className="message-list customer-message-log" role="log" aria-live="polite" aria-relevant="additions" ref={messageLog}>
            {thread.messages.map(message => {
              const mine = message.sender_type === 'customer' || message.sender_id === user.id;
              const ai = message.sender_type === 'ai';
              return <article className={mine ? 'customer-message' : ai ? 'ai-message' : message.sender_type === 'system' ? 'system-message' : 'support-message'} key={message.id}>
                <div className="message-meta">
<b>{mine ? 'شما' : ai ? 'دستیار هوشمند راهکار' : message.full_name || thread.agent?.full_name || 'کارشناس راهکار'}</b>
<small>{exactDate(message.created_at)}</small>
</div>
                {message.reply_to_id && <small className="reply-reference">پاسخ به پیام قبلی</small>}
                <p>{message.body}</p>
                {message.attachments?.length ? <div className="message-attachments">{message.attachments.map(file => <div key={file.id}>
                  {file.mime_type?.startsWith('image/') && <SecureAttachmentImage file={file}/>}
                  <button onClick={() => downloadApiFile(`/support/attachments/${file.id}`, file.original_name).catch(err => setNotice(err.message))}>
<Paperclip/><span>{file.original_name}<small>{fa(Math.ceil(Number(file.size_bytes || 0) / 1024))} کیلوبایت · {file.mime_type}</small></span></button>
                </div>)}</div> : null}
                {message.citations?.length ? <details className="ai-citations">
<summary>منابع پاسخ ({fa(message.citations.length)})</summary>{message.citations.map(citation => <div key={citation.id}>
<b>{citation.title_snapshot}</b>
<p>{citation.excerpt}</p>
</div>)}</details> : null}
                <footer>
<span>{message.delivery_status === 'failed' ? 'ناموفق' : message.delivery_status === 'read' ? 'خوانده‌شده' : message.delivery_status === 'delivered' ? 'تحویل‌شده' : 'ارسال‌شده'}</span>
<button onClick={() => navigator.clipboard?.writeText(message.body)} aria-label="کپی پیام">
<Copy/>
</button>{ai && <>
<button onClick={() => feedback(message.id, true)} aria-label="پاسخ مفید بود">
<ThumbsUp/>
</button>
<button onClick={() => feedback(message.id, false)} aria-label="پاسخ مفید نبود">
<ThumbsDown/>
</button>
</>}</footer>
              </article>;
            })}
          </div>
          {!['resolved', 'closed'].includes(thread.ticket.status) ? <form className="customer-composer" onSubmit={sendReply}>
            {files.length ? <div className="pending-files">{files.map((file, index) => <span key={`${file.name}-${index}`}>
<Paperclip/>{file.name}<button type="button" onClick={() => setFiles(rows => rows.filter((_, itemIndex) => itemIndex !== index))} aria-label={`حذف ${file.name}`}>
<X/>
</button>
</span>)}</div> : null}
            <label className="attachment-button" aria-label="افزودن پیوست">
<Paperclip/>
<input type="file" multiple accept=".png,.jpg,.jpeg,.webp,.pdf,.txt" onChange={event => setFiles(Array.from(event.target.files || []).slice(0, 5))}/>
</label>
            <label className="sr-only" htmlFor="support-reply-v5">پیام شما</label>
            <textarea id="support-reply-v5" rows="3" maxLength="4000" value={reply} onChange={event => setReply(event.target.value)} onKeyDown={onComposerKey} placeholder="پیام خود را بنویسید… Enter برای ارسال، Shift+Enter برای خط جدید" required/>
            <button className="portal-primary" disabled={sending || !reply.trim()}>{sending ? <RefreshCw className="spin"/> : <MessageCircle/>}{sending ? 'در حال ارسال…' : 'ارسال پیام'}</button>
            <small>{fa(reply.length)} از ۴٬۰۰۰ نویسه</small>
            {failedMessage && <button type="button" className="retry-message" onClick={retryFailed}>
<RefreshCw/> تلاش مجدد</button>}
          </form> : <div className="resolved-actions">
<Check/>
<span>این گفتگو {thread.ticket.status === 'resolved' ? 'حل شده' : 'بسته شده'} است.</span>
            {!csat.sent && <div className="csat-inline" aria-label="ارزیابی رضایت">
<b>از این پاسخ چقدر راضی بودید؟</b>
<div>{[1,2,3,4,5].map(value => <button type="button" className={csat.rating === value ? 'active' : ''} key={value} onClick={() => setCsat(current => ({ ...current, rating: value }))} aria-label={`${value} از ۵`}>{fa(value)}</button>)}</div>
<input value={csat.comment} onChange={event => setCsat(current => ({ ...current, comment: event.target.value }))} maxLength="1000" placeholder="نظر تکمیلی (اختیاری)"/>
<button type="button" disabled={!csat.rating} onClick={submitCsat}>ثبت رضایت</button>
</div>}
            <button onClick={async () => { await api(`/support/tickets/${active}/reopen`, { method: 'POST', body: {} }); setCsat({ rating: 0, comment: '', sent: false }); await openThread(active); }}>بازگشایی گفتگو</button>
          </div>}
        </> : <Loader/>}
      </section> : <form className="portal-card portal-form new-chat-form" onSubmit={submit}>
        <div>
<span className="form-kicker">ارتباط مستقیم</span>
<h2>شروع گفتگوی آنلاین</h2>
<p>دستیار هوشمند فقط با منبع معتبر پاسخ می‌دهد و دکمه اتصال به انسان همیشه در دسترس است.</p>
</div>
        <label>دسته‌بندی *<select value={form.category} onChange={event => setForm({ ...form, category: event.target.value })} required>
<option value="">انتخاب کنید</option>
{SUPPORT_TOPICS.map(topic => <option key={topic.id} value={topic.id}>{topic.label}</option>)}
</select>
</label>
        <label>عنوان کوتاه درخواست *<input value={form.subject} minLength="3" maxLength="160" onChange={event => setForm({ ...form, subject: event.target.value })} placeholder="مثلاً خودکارسازی فرایند درخواست‌های منابع انسانی" required/>
</label>
        <label>فوریت اعلامی شما<select value={form.priority} onChange={event => setForm({ ...form, priority: event.target.value })}>
<option value="normal">عادی</option>
<option value="high">زیاد</option>
</select>
<small>اولویت نهایی با قواعد موضوع، سفارش و SLA تعیین می‌شود.</small>
</label>
        <label>پیام *<textarea rows="6" maxLength="4000" value={form.message} onChange={event => setForm({ ...form, message: event.target.value })} placeholder="سازمان، فرایند یا مسئله، کاربران و نتیجه مورد انتظار را توضیح دهید…" minLength="3" required/>
</label>
        <button className="portal-primary" disabled={sending}>
<MessageCircle/>{sending ? 'در حال ایجاد…' : 'شروع گفتگو'}</button>
      </form>}
    </div>
</>;
}

function AssistancePage({ records, refresh, user }) {
  return <>
<PageHead eyebrow="مرکز ارتباط مشتریان" title="پشتیبانی راهکار" text="گفتگوی آنلاین با تیم پشتیبانی و سابقه کامل پیگیری درخواست‌ها."/>
<SupportPane records={records} refresh={refresh} user={user}/></>;
}

function AddressesPage({ addresses, refresh, user }) {
  const initial = { title: '', recipient: '', mobile: '', province: '', province_code: '', city: '', city_code: '', address: '', postal_code: '', is_default: true };
  const [form, setForm] = useState(initial);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const submit = async event => {
    event.preventDefault(); setLoading(true); setNotice('');
    try {
      await api('/addresses', { method: 'POST', body: form });
      setForm({ ...initial, is_default: addresses.length === 0 }); setNotice('آدرس با موفقیت ذخیره شد و هنگام سفارش قابل انتخاب است.'); await refresh();
    }
    catch (err) { setNotice(err.message); }
    finally { setLoading(false); }
  };
  const remove = async id => {
    try { await api(`/addresses/${id}`, { method: 'DELETE' }); } catch {}
    await refresh();
  };
  const makeDefault = async id => {
    try { await api(`/addresses/${id}/default`, { method: 'PATCH' }); } catch {}
    await refresh();
  };
  return <>
<PageHead eyebrow="نشانی‌ها" title="آدرس‌های تحویل" text="می‌توانید چند آدرس ثبت کنید و هنگام هر سفارش، نشانی تحویل را انتخاب کنید."/>
<div className="portal-two-col addresses-layout">
<form className="portal-card portal-form" onSubmit={submit}>
<div>
<span className="form-kicker">نشانی جدید</span>
<h2>افزودن آدرس تحویل</h2>
</div>
<Notice>{notice}</Notice>
<div className="form-grid">{[['title','عنوان آدرس'],['recipient','نام تحویل‌گیرنده'],['mobile','شماره تماس'],['province','استان'],['city','شهر'],['postal_code','کد پستی ۱۰ رقمی']].map(([key,label]) => <label key={key}>{label}<input list={key === 'province' ? 'iran-provinces' : undefined} dir={['mobile','postal_code'].includes(key) ? 'ltr' : undefined} inputMode={['mobile','postal_code'].includes(key) ? 'numeric' : undefined} maxLength={key === 'postal_code' ? 10 : undefined} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} required={!['postal_code'].includes(key)}/>
</label>)}</div>
<datalist id="iran-provinces">{iranProvinces.map(name => <option value={name} key={name}/>)}</datalist>
<label>نشانی کامل<textarea rows="3" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="خیابان، کوچه، پلاک، واحد و توضیحات دسترسی" required/>
</label>
<label className="portal-check">
<input type="checkbox" checked={form.is_default} onChange={e => setForm({ ...form, is_default: e.target.checked })}/> این نشانی به‌صورت پیش‌فرض انتخاب شود</label>
<button className="portal-primary" disabled={loading}>
<Save/>{loading ? 'در حال ذخیره…' : 'ذخیره آدرس'}</button>
</form>
<section className="address-list">{addresses.length ? addresses.map(item => <article className={`portal-card ${item.is_default ? 'default-address' : ''}`} key={item.id}>
<span>
<MapPin/>
</span>
<div>
<div>
<h3>{item.title}</h3>{item.is_default ? <em>پیش‌فرض</em> : null}</div>
<b>{item.recipient} · {item.mobile}</b>
<p>{item.province}، {item.city}، {item.address}</p>
<small>کد پستی: {item.postal_code || 'ثبت نشده'}</small>
<div className="address-actions">{!item.is_default && <button onClick={() => makeDefault(item.id)}>
<Check/> انتخاب به‌عنوان پیش‌فرض</button>}<button className="danger" onClick={() => remove(item.id)}>
<Trash2/> حذف</button>
</div>
</div>
</article>) : <Empty icon={MapPin} title="آدرسی ذخیره نشده" text="اولین آدرس را ثبت کنید تا در مرحله تحویل سفارش نمایش داده شود."/>}</section>
</div>
</>;
}

function ProfilePage({ user, refresh }) {
  const [form, setForm] = useState({
    account_type:user.account_type || 'individual',
    first_name:user.first_name || '', last_name:user.last_name || '',
    display_name:user.display_name || '', full_name:user.full_name || '',
    national_id:user.national_id || '', birth_date:user.birth_date || '',
    gender:user.gender || 'unspecified', avatar_url:user.avatar_url || '',
    email:user.email || '', alternate_phone:user.alternate_phone || '',
    company:user.company || '', job_title:user.job_title || '',
    company_national_id:user.company_national_id || '', registration_no:user.registration_no || '',
    economic_code:user.economic_code || '', representative_name:user.representative_name || '',
    representative_position:user.representative_position || '', company_phone:user.company_phone || '',
    company_address:user.company_address || '', invoice_details:user.invoice_details || '',
  });
  const [notice, setNotice] = useState('');
  const [credentials, setCredentials] = useState({ username:user.username || '', password:'', repeat:'', code:'' });
  const [showPassword, setShowPassword] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => { api('/security/sessions').then(setSessions).catch(() => {}); }, []);
  const submit = async event => {
    event.preventDefault(); setSaving(true);
    const payload = {
      ...form,
      full_name: form.account_type === 'legal'
        ? (form.representative_name || form.full_name)
        : (`${form.first_name} ${form.last_name}`.trim() || form.full_name),
    };
    try { await api('/me', { method: 'PUT', body: payload }); setNotice('اطلاعات پروفایل ذخیره شد.'); await refresh(); }
    catch (err) { setNotice(err.message); }
    finally { setSaving(false); }
  };
  const saveCredentials = async event => {
    event.preventDefault(); setNotice('');
    if (credentials.password !== credentials.repeat) return setNotice('تکرار رمز با رمز جدید یکسان نیست.');
    try {
      if (user.username) {
        if (!codeSent) {
          await api('/auth/request-otp', { method:'POST', body:{ mobile:user.mobile, intent:'reset' } });
          setCodeSent(true); return setNotice('کد تغییر رمز به شماره همراه ثبت‌شده ارسال شد.');
        }
        await api('/auth/reset-password', { method:'POST', body:{ mobile:user.mobile, code:credentials.code, password:credentials.password, username:credentials.username } });
      } else {
        await api('/auth/customer-credentials', { method:'PUT', body:{ username:credentials.username, password:credentials.password } });
      }
      setNotice('اطلاعات ورود با موفقیت ذخیره شد.'); setCodeSent(false);
      setCredentials(current => ({ ...current, password:'', repeat:'', code:'' })); await refresh();
    } catch (err) { setNotice(err.message); }
  };
  const completion=user.profileCompletion || {percent:0,status:'critical',missing:[]};
  const input=(key,label,props={})=>
<label key={key}>{label}<input {...props} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/>
</label>;
  const logoutOthers=async()=>{try{const result=await api('/security/logout-others',{method:'POST'});setNotice(`${result.revoked.toLocaleString('fa-IR')} نشست دیگر خارج شد.`);setSessions(rows=>rows.filter(row=>row.current));}catch(err){setNotice(err.message)}};
  return <>
<PageHead eyebrow="حساب کاربری" title="اطلاعات پروفایل" text="اطلاعات واقعی حساب، آدرس‌ها، فاکتورها و سفارش‌های آینده از همین پروفایل استفاده می‌کنند."/>
    <section className={`portal-card completion-card ${completion.status}`}>
<div>
<b>تکمیل پروفایل</b>
<strong>{completion.percent.toLocaleString('fa-IR')}٪</strong>
</div>
<span>
<i style={{width:`${completion.percent}%`}}/>
</span>{completion.missing?.length?<p>موارد باقی‌مانده: {completion.missing.join('، ')}</p>:<p>اطلاعات اصلی پروفایل کامل است.</p>}</section>
    <form className="portal-card portal-form profile-form" onSubmit={submit}>
<Notice>{notice}</Notice>
<div className="profile-mobile">
<span>
<CircleUserRound/>
</span>
<div>
<small>شماره همراه اصلی و تأییدشده</small>
<b>{user.mobile}</b>
</div>
<em>
<Check/> تأیید شده</em>
</div>
      <fieldset>
<legend>نوع حساب</legend>
<div className="account-type-switch">
<label>
<input type="radio" name="account-type" checked={form.account_type==='individual'} onChange={()=>setForm({...form,account_type:'individual'})}/> شخص حقیقی</label>
<label>
<input type="radio" name="account-type" checked={form.account_type==='legal'} onChange={()=>setForm({...form,account_type:'legal'})}/> شخص حقوقی</label>
</div>
</fieldset>
      {form.account_type==='individual'?<>
<h2>اطلاعات هویتی</h2>
<div className="form-grid">{[input('first_name','نام',{required:true}),input('last_name','نام خانوادگی',{required:true}),input('display_name','نام نمایشی'),input('national_id','کد ملی',{dir:'ltr',inputMode:'numeric',maxLength:10}),input('birth_date','تاریخ تولد',{type:'date'}),<label key="gender">جنسیت<select value={form.gender} onChange={e=>setForm({...form,gender:e.target.value})}>
<option value="unspecified">تمایلی به اعلام ندارم</option>
<option value="male">مرد</option>
<option value="female">زن</option>
<option value="other">سایر</option>
</select>
</label>,input('avatar_url','آدرس تصویر پروفایل',{dir:'ltr',type:'url'})]}</div>
</>:<>
<h2>اطلاعات حساب حقوقی و فاکتور رسمی</h2>
<div className="form-grid">{[input('company','نام شرکت',{required:true}),input('company_national_id','شناسه ملی',{dir:'ltr',required:true}),input('registration_no','شماره ثبت',{dir:'ltr'}),input('economic_code','کد اقتصادی',{dir:'ltr'}),input('representative_name','نام نماینده',{required:true}),input('representative_position','سمت نماینده'),input('company_phone','تلفن شرکت',{dir:'ltr',type:'tel'}),input('job_title','سمت سازمانی')]}</div>
<label>آدرس شرکت<textarea rows="3" value={form.company_address} onChange={e=>setForm({...form,company_address:e.target.value})}/>
</label>
<label>اطلاعات تکمیلی فاکتور رسمی<textarea rows="3" value={form.invoice_details} onChange={e=>setForm({...form,invoice_details:e.target.value})}/>
</label>
</>}
      <h2>اطلاعات تماس</h2>
<div className="form-grid">{[input('email','ایمیل',{dir:'ltr',type:'email'}),input('alternate_phone','شماره تماس جایگزین',{dir:'ltr',type:'tel'}),input('display_name','نام نمایشی')]}</div>
      <button className="portal-primary" disabled={saving}>
<Save/>{saving?'در حال ذخیره…':'ذخیره تغییرات'}</button>
</form>
    <form className="portal-card portal-form profile-form credential-card" onSubmit={saveCredentials}>
<h2>
<KeyRound/> نام کاربری و رمز عبور</h2>
<p>تغییر اطلاعات ورود با کد امنیتی شماره اصلی تأیید می‌شود و تمام نشست‌های قبلی را می‌بندد.</p>
<label>نام کاربری<input dir="ltr" value={credentials.username} onChange={e=>setCredentials({...credentials,username:e.target.value})} pattern="[A-Za-z][A-Za-z0-9._-]{3,39}" required/>
</label>
<label>رمز {user.username?'جدید':'عبور'}<div className="password-field">
<input dir="ltr" type={showPassword?'text':'password'} minLength="10" value={credentials.password} onChange={e=>setCredentials({...credentials,password:e.target.value})} required/>
<button type="button" onClick={()=>setShowPassword(value=>!value)} aria-label={showPassword?'مخفی‌کردن رمز':'نمایش رمز'}>{showPassword?<EyeOff/>:<Eye/>}</button>
</div>
<small>حداقل ۱۰ نویسه شامل حروف بزرگ، کوچک، عدد و نماد</small>
</label>
<label>تکرار رمز<input dir="ltr" type={showPassword?'text':'password'} minLength="10" value={credentials.repeat} onChange={e=>setCredentials({...credentials,repeat:e.target.value})} required/>
</label>{codeSent&&<label>کد پیامکی<input dir="ltr" inputMode="numeric" value={credentials.code} onChange={e=>setCredentials({...credentials,code:e.target.value})} required/>
</label>}<button className="portal-primary">
<Save/>{user.username?(codeSent?'تأیید کد و تغییر اطلاعات ورود':'ارسال کد امنیتی'):'ساخت نام کاربری و رمز'}</button>
</form>
    <section className="portal-card session-card">
<div className="portal-card-title">
<div>
<span>امنیت حساب</span>
<h2>نشست‌های فعال</h2>
</div>
<button onClick={logoutOthers}>خروج از سایر دستگاه‌ها</button>
</div>{sessions.length?sessions.map(row=>
<article key={row.id}>
<div>
<b>{row.current?'این دستگاه':row.portal||'حساب مشتری'}</b>
<small>{row.ip||'آفلاین'} · {date(row.last_seen_at||row.created_at)}</small>
</div>
<em>{row.current?'فعال':'نشست دیگر'}</em>
</article>):<p>نشست فعالی ثبت نشده است.</p>}</section>
</>;
}

export function AccountPage({ route, navigate }) {
  const [user, setUser] = useState(null);
  const [summary, setSummary] = useState(null);
  const [addresses, setAddresses] = useState([]);
  const [error, setError] = useState('');
  const refresh = async () => {
    try {
      const [me, data, addressData] = await Promise.all([api('/me'), api('/account/summary'), api('/addresses')]);
      setUser(me); setSummary(data); setAddresses(addressData); setError('');
    } catch (err) {
      if (err.status === 401) { setToken(null); sessionStorage.setItem('aronage_after_login', route); navigate('/auth/login'); }
      else setError(err.message);
    }
  };
  useEffect(() => { if (!getToken()) { sessionStorage.setItem('aronage_after_login', route); navigate('/auth/login'); return; } refresh(); }, []);
  if (error) return <div className="standalone-error">
<Notice type="error">{error}</Notice>
<button onClick={refresh}>تلاش دوباره</button>
</div>;
  if (!user || !summary) return <div className="portal-loading">
<LogoButton onClick={() => navigate('/')}/>
<Loader/>
</div>;
  const orderMatch = route.match(/^\/account\/orders\/(.+)$/);
  let content;
  if (route.startsWith('/payment/result')) content = <PaymentResultPage route={route} navigate={navigate}/>;
  else if (orderMatch) content = <OrderDetail id={orderMatch[1]} navigate={navigate}/>;
  else if (route === '/account/orders') content = <OrdersPage orders={summary.orders} navigate={navigate} refresh={refresh}/>;
  else if (route === '/account/engineering-services') content = <EngineeringServicesPage records={summary.engineeringRequests || []} navigate={navigate}/>;
  else if (route === '/account/ai-assistant' || route === '/account/help' || route === '/account/help/chat' || route === '/account/support' || route === '/account/help/consultation' || route === '/account/consultations') content = <AssistancePage records={summary.tickets} refresh={refresh} user={user}/>;
  else if (route === '/account/quotes') content = <SimpleRecords type="quotes" records={summary.quotes}/>;
  else if (route === '/account/payments') content = <SimpleRecords type="payments" records={summary.payments || []} />;
  else if (route === '/account/addresses') content = <AddressesPage addresses={addresses} refresh={refresh} user={user}/>;
  else if (route === '/account/profile') content = <ProfilePage user={user} refresh={refresh}/>;
  else content = <Dashboard summary={summary} navigate={navigate} user={user}/>;
  return <PortalShell navigate={navigate} route={route} user={user}>{content}</PortalShell>;
}

export function CartPage({ products, navigate }) {
  const [cart, setCart] = useState(getCart());
  const [catalogProducts, setCatalogProducts] = useState(products);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [clientOrderId] = useState(() => globalThis.crypto?.randomUUID?.() || `order-${Date.now()}-${Math.random()}`);
  const [addresses, setAddresses] = useState([]);
  const [addressId, setAddressId] = useState('');
  const [notes, setNotes] = useState('');
  const [discountCode, setDiscountCode] = useState('');
  const [pricing, setPricing] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [addressForm, setAddressForm] = useState({ title: '', recipient: '', mobile: '', province: '', city: '', address: '', postal_code: '', is_default: true });
  const persistCart = next => {
    setCart(next); setPricing(null); setConfirmed(false); saveCart(next);
    if (getToken()) syncCart('replace', next).catch(() => {});
  };
  const items = useMemo(() => cart.map(item => {
    const base = catalogProducts.find(product => product.id === item.productId);
    const variant = base?.variants?.find(row => row.id === item.variantId);
    return {
      ...item,
      product: base ? {
        ...base,
        name: variant ? `${base.name} — ${variant.name}` : base.name,
        price: Number(variant?.price ?? base.price ?? 0),
        available_stock: Number(variant?.available_stock ?? base.available_stock ?? 0),
      } : null,
    };
  }).filter(item => item.product), [cart, catalogProducts]);
  const serviceOnly = Boolean(items.length) && items.every(item => item.product.product_type === 'service');
  const localPricing = useMemo(() => {
    const subtotal = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
    const taxTotal = items.reduce((sum, item) =>
      sum + Math.round(item.product.price * item.quantity * Number(item.product.tax_rate || 0) / 100), 0);
    const shipping = serviceOnly || subtotal >= 250_000_000 ? 0 : 850_000;
    return { subtotal, discountTotal: 0, taxTotal, shipping, total: subtotal + taxTotal + shipping };
  }, [items, serviceOnly]);
  const totals = pricing || localPricing;
  const update = (id, variantId, quantity) => {
    const product = items.find(item => item.productId === id && (item.variantId || null) === (variantId || null))?.product;
    const max = Math.max(1, Math.min(20, Number(product?.available_stock ?? 20)));
    const next = cart.map(item => item.productId === id && (item.variantId || null) === (variantId || null)
      ? { ...item, quantity: Math.max(1, Math.min(max, quantity)) } : item);
    persistCart(next);
  };
  const remove = (id, variantId) => {
    const next = cart.filter(item => !(item.productId === id && (item.variantId || null) === (variantId || null)));
    persistCart(next);
  };
  useEffect(() => {
    if (getToken()) {
      syncCart('merge', cart).then(setCart).catch(() => {});
    }
  }, []);
  useEffect(() => {
    api('/catalog/products').then(async result => {
      const rows = Array.isArray(result) ? result : result.items;
      const variantProductIds = [...new Set(cart.filter(item => item.variantId).map(item => item.productId))];
      const details = await Promise.all(variantProductIds.map(id => api(`/catalog/products/${id}`).catch(() => null)));
      const detailById = new Map(details.filter(Boolean).map(detail => [detail.id, detail]));
      setCatalogProducts(rows.map(listRow => {
        const row = detailById.get(listRow.id) || listRow;
        const fixed = products.find(product => product.id === row.id);
        return {
          ...fixed, ...row, image: fixed?.image || row.image_url,
          brand: row.brand || fixed?.brand || 'راهکار',
          available_stock: Number(row.available_stock ?? row.stock ?? 0),
          price: Number(row.sale_price ?? row.price ?? 0),
          variants: (row.variants || []).map(variant => ({
            ...variant,
            price: Number(variant.price ?? row.sale_price ?? row.price ?? 0),
            available_stock: Number(variant.available_stock ?? variant.stock ?? 0),
          })),
        };
      }));
    }).catch(err => setNotice(err.message)).finally(() => setCatalogLoading(false));
  }, [products]);
  useEffect(() => {
    if (!getToken()) return;
    Promise.all([api('/me'), api('/addresses')]).then(([me, remote]) => {
      setAddresses(remote);
      setAddressId(remote.find(a => a.is_default)?.id || remote[0]?.id || '');
      setAddressForm(current => ({ ...current, mobile: me.mobile, recipient: me.full_name || '' }));
    }).catch(() => {});
  }, []);
  const addCheckoutAddress = async event => {
    event.preventDefault(); setLoading(true); setNotice('');
    try {
      const created = await api('/addresses', { method: 'POST', body: addressForm });
      const next = [{ ...addressForm, id: created.id, is_default: 1, created_at: new Date().toISOString() }, ...addresses.map(item => ({ ...item, is_default: 0 }))];
      setAddresses(next); setAddressId(created.id); setShowAddressForm(false);
      setNotice('آدرس ذخیره و برای این سفارش انتخاب شد.');
    } catch (err) { setNotice(err.message); }
    finally { setLoading(false); }
  };
  const previewCheckout = async () => {
    if (!getToken()) {
      sessionStorage.setItem('aronage_after_login', '/cart');
      navigate('/auth/login');
      return;
    }
    setLoading(true); setNotice('');
    try {
      const result = await api('/checkout/preview', {
        method: 'POST',
        body: {
          items: cart.map(item => ({ productId: item.productId, variantId: item.variantId || null, quantity: item.quantity })),
          discountCode: discountCode.trim() || undefined,
        },
      });
      setPricing(result);
      setNotice(result.discountMessage || 'قیمت، مالیات، ارسال و موجودی دوباره بررسی شد.');
    } catch (err) { setPricing(null); setNotice(err.message); }
    finally { setLoading(false); }
  };
  const checkout = async () => {
    if (!getToken()) { sessionStorage.setItem('aronage_after_login', '/cart'); navigate('/auth/login'); return; }
    if (!serviceOnly && !addressId) { setNotice('ابتدا از حساب کاربری یک آدرس تحویل ثبت کنید.'); return; }
    setLoading(true); setNotice('');
    try {
      const order = await api('/orders', {
        method: 'POST',
        body: {
          items: cart.map(item => ({ productId:item.productId, variantId:item.variantId || null, quantity:item.quantity })),
          addressId: serviceOnly ? null : addressId,
          addressSnapshot: serviceOnly ? undefined : addresses.find(item => item.id === addressId),
          discountCode: discountCode.trim() || undefined, notes, clientOrderId,
        },
      });
      persistCart([]); navigate(`/account/orders/${order.id}`);
    } catch (err) { setNotice(err.message); }
    finally { setLoading(false); }
  };
  if(catalogLoading)return <div className="portal-loading">در حال بررسی قیمت و موجودی سبد…</div>;
  return <div className="cart-page" dir="rtl">
<header>
<LogoButton onClick={() => navigate('/')}/>
<button onClick={() => navigate('/shop')}>ادامه خرید <ArrowLeft/>
</button>
</header>
<main>
<PageHead eyebrow="درخواست خدمات" title="تکمیل درخواست" text={serviceOnly ? 'خدمت انتخابی و توضیحات سازمان را بررسی کنید؛ برآورد اختصاصی پس از تحلیل نیاز ارائه می‌شود.' : 'مرحله ۲ از ۳: آدرس تحویل را انتخاب کنید؛ سپس سفارش برای پرداخت آماده می‌شود.'}/>
<Notice type={/(ذخیره|اعمال|بررسی شد)/.test(notice) ? 'info' : 'error'}>{notice}</Notice>{items.length ? <div className="cart-grid">
<section className="portal-card cart-items">{items.map(({ product, productId, variantId, quantity }) => <article key={`${productId}:${variantId || 'base'}`}>
<img src={product.image} alt={product.name}/>
<div>
<small>{product.brand}</small>
<h3>{product.name}</h3>
<span>{product.product_type === 'service' && !product.price ? 'برآورد اختصاصی پس از تحلیل نیاز' : `${money(product.price)} · موجودی قابل فروش ${fa(product.available_stock)}`}</span>
</div>
{product.product_type !== 'service' && <label>تعداد<input type="number" min="1" max={Math.min(20,product.available_stock)} value={quantity} onChange={e => update(productId, variantId, Number(e.target.value))}/>
</label>}
<button onClick={() => remove(productId, variantId)} aria-label={`حذف ${product.name}`}>
<Trash2/>
</button>
</article>)}</section>
<aside className="portal-card checkout-card">
<div className="checkout-steps">
<span className="done">۱</span>
<i/>
<span className="active">۲</span>
<i/>
<span>۳</span>
</div>
<div className="checkout-title-row">
<div>
<small>{serviceOnly ? 'مرحله شناخت نیاز' : 'مرحله تحویل'}</small>
<h2>{serviceOnly ? 'اطلاعات درخواست' : 'انتخاب آدرس'}</h2>
</div>{!serviceOnly && getToken() && <button onClick={() => setShowAddressForm(value => !value)}>
<Plus/>{showAddressForm ? 'بستن' : 'آدرس جدید'}</button>}</div>{serviceOnly ? null : getToken() ? showAddressForm ? <form className="checkout-address-form" onSubmit={addCheckoutAddress}>
<div className="form-grid">{[['title','عنوان'],['recipient','تحویل‌گیرنده'],['mobile','شماره تماس'],['province','استان'],['city','شهر'],['postal_code','کد پستی']].map(([key,label]) => <label key={key}>{label}<input list={key === 'province' ? 'iran-provinces' : undefined} value={addressForm[key]} onChange={e => setAddressForm({ ...addressForm, [key]: e.target.value })} required={key !== 'postal_code'}/>
</label>)}</div>
<datalist id="iran-provinces">{iranProvinces.map(name => <option value={name} key={name}/>)}</datalist>
<label>نشانی کامل<textarea rows="3" value={addressForm.address} onChange={e => setAddressForm({ ...addressForm, address: e.target.value })} required/>
</label>
<button className="portal-primary" disabled={loading}>
<Save/>{loading ? 'در حال ذخیره…' : 'ذخیره و انتخاب آدرس'}</button>
</form> : addresses.length ? <div className="checkout-address-options" role="radiogroup" aria-label="انتخاب آدرس تحویل">{addresses.map(a => <label key={a.id} className={addressId === a.id ? 'selected' : ''}>
<input type="radio" name="delivery-address" value={a.id} checked={addressId === a.id} onChange={() => setAddressId(a.id)}/>
<span>
<b>{a.title}{a.is_default ? <em>پیش‌فرض</em> : null}</b>
<small>{a.recipient} · {a.mobile}</small>
<p>{a.province}، {a.city}، {a.address}</p>
</span>
<Check/>
</label>)}</div> : <div className="checkout-no-address">
<MapPin/>
<b>هنوز آدرسی ندارید</b>
<p>برای ادامه، همین‌جا اولین آدرس تحویل را ثبت کنید.</p>
<button className="portal-primary" onClick={() => setShowAddressForm(true)}>
<Plus/> ثبت آدرس</button>
</div> : <Notice>هنگام ثبت سفارش وارد حساب می‌شوید.</Notice>}
{serviceOnly && <div className="checkout-no-address"><Building2/><b>این خدمت نیازمند ارسال فیزیکی نیست</b><p>نام سازمان، مسئله اصلی، تعداد کاربران و محدودیت زمانی را در بخش توضیحات بنویسید.</p></div>}
<div className="discount-entry">
  <label>کد تخفیف
    <input dir="ltr" value={discountCode} onChange={event => { setDiscountCode(event.target.value); setPricing(null); }} placeholder="مثلاً RAHKAR10"/>
  </label>
  <button type="button" onClick={previewCheckout} disabled={loading}>{loading ? 'در حال بررسی…' : 'اعمال و محاسبه'}</button>
</div>
<div className="checkout-totals" aria-live="polite">
  <span>{serviceOnly ? 'برآورد اولیه' : 'جمع کالاها'} <b>{serviceOnly && !totals.subtotal ? 'پس از تحلیل نیاز' : money(totals.subtotal)}</b></span>
  <span>تخفیف <b>{totals.discountTotal ? `− ${money(totals.discountTotal)}` : '—'}</b></span>
  <span>مالیات <b>{totals.taxTotal ? money(totals.taxTotal) : '—'}</b></span>
  <span>هزینه ارسال <b>{totals.shipping ? money(totals.shipping) : 'رایگان'}</b></span>
  <strong>مبلغ نهایی <b>{money(totals.total)}</b></strong>
</div>
<label>{serviceOnly ? 'شرح نیاز سازمان' : 'توضیحات سفارش'}<textarea rows="4" value={notes} onChange={e => setNotes(e.target.value)} placeholder={serviceOnly ? 'نام سازمان، فرایند یا مسئله اصلی، کاربران و نتیجه مورد انتظار…' : 'زمان تحویل یا توضیحات فنی…'}/>
</label>
<label className="checkout-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/><span>{serviceOnly ? 'خدمت انتخابی و شرح اولیه نیاز را بررسی و تأیید کردم.' : 'آدرس، اقلام و جمع مالی سفارش را بررسی و تأیید کردم.'}</span></label>
<div className="checkout-security">
<ShieldCheck/>
<span>
<b>ثبت امن درخواست</b>
<small>{serviceOnly ? 'اطلاعات درخواست در حساب شما ذخیره و فقط برای بررسی کارشناسی استفاده می‌شود.' : 'آدرس، قیمت و مشخصات کالا در سفارش Snapshot می‌شوند.'}</small>
</span>
</div>
<button className="portal-primary" onClick={checkout} disabled={loading || !confirmed || (getToken() && !serviceOnly && !addressId)}>{loading ? 'در حال ثبت…' : serviceOnly ? 'ثبت درخواست برای بررسی کارشناسی' : 'ثبت نهایی و ادامه پرداخت'}<ChevronLeft/>
</button>
<small className="gateway-note">سامانه از ثبت تکراری جلوگیری می‌کند و درخواست در سوابق حساب شما باقی می‌ماند.</small>
</aside>
</div> : <Empty icon={ShoppingBag} title="سبد خرید خالی است" text="محصول موردنظر را از فروشگاه انتخاب کنید." action={() => navigate('/shop')} actionLabel="بازگشت به فروشگاه"/>}</main>
</div>;
}

export function AdminPage({ navigate, salesManagers = null }) {
  const [user, setUser] = useState(null);
  const [data, setData] = useState(null);
  const [orders, setOrders] = useState([]);
  const [consultations, setConsultations] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [agents, setAgents] = useState([]);
  const [supportSlas, setSupportSlas] = useState([]);
  const [supportAlerts, setSupportAlerts] = useState({ breached: [], capacities: [] });
  const [activeTicket, setActiveTicket] = useState('');
  const [thread, setThread] = useState(null);
  const [reply, setReply] = useState('');
  const [notice, setNotice] = useState('');
  const [quote, setQuote] = useState({ userId: '', title: '', amount: '', validUntil: '' });
  const [project, setProject] = useState({ userId: '', title: '' });
  const [agentForm, setAgentForm] = useState({
    mobile: '', fullName: '', username: '', temporaryPassword: '',
    jobTitle: 'کارشناس پشتیبانی', avatarUrl: '', topicIds: [],
    languages: 'fa', timezone: 'Asia/Tehran', capacity: 8, seniority: 'mid',
    workingHours: {},
    permissions: {
      'support.tickets.view': true, 'support.tickets.reply': true, 'support.tickets.assign': false,
      'support.tickets.transfer': false, 'support.tickets.close': true, 'support.tickets.reopen': true,
      'support.notes.create': true, 'support.attachments.manage': true, 'support.customers.context': true,
      'support.macros.manage': false, 'support.tags.manage': false, 'support.reports.view': false,
      'support.reports.export': false, 'support.knowledge.view': true, 'support.knowledge.manage': false,
      'support.ai.view_logs': false, 'support.sla.manage': false, 'support.teams.manage': false,
      'support.agents.manage': false,
    },
  });
  const [editingAgent, setEditingAgent] = useState(null);
  const [showAgentPassword, setShowAgentPassword] = useState(false);
  const load = async () => {
    const [me, summary, orderRows, consultationRows, customerRows, supportData, agentRows, slaRows, alertRows] = await Promise.all([
      api('/me'), api('/admin/summary'), api('/admin/orders'), api('/admin/consultations'), api('/admin/customers'),
      api('/admin/support'), api('/admin/support-agents'),
      api('/support-admin/slas'), api('/support-admin/alerts'),
    ]);
    setUser(me); setData(summary); setOrders(orderRows); setConsultations(consultationRows); setCustomers(customerRows); setTickets(supportData.tickets); setAgents(agentRows); setSupportSlas(slaRows); setSupportAlerts(alertRows);
  };
  useEffect(() => {
    load().catch(err => { if (err.status === 401 || err.status === 403) navigate('/auth/login'); else setNotice(err.message); });
  }, []);
  const changeOrder = async (id, value) => { await api(`/admin/orders/${id}`, { method: 'PATCH', body: { status: value } }); await load(); };
  const changeConsultation = async (id, value) => { await api(`/admin/consultations/${id}`, { method: 'PATCH', body: { status: value } }); await load(); };
  const issueQuote = async event => {
    event.preventDefault();
    try { await api('/admin/quotes', { method: 'POST', body: { ...quote, amount: Number(quote.amount) } }); setNotice('پیش‌فاکتور صادر و به مشتری اعلام شد.'); setQuote({ userId: '', title: '', amount: '', validUntil: '' }); }
    catch (err) { setNotice(err.message); }
  };
  const createProject = async event => {
    event.preventDefault();
    try { await api('/admin/projects', { method: 'POST', body: project }); setNotice('پروژه به حساب مشتری افزوده شد.'); setProject({ userId: '', title: '' }); }
    catch (err) { setNotice(err.message); }
  };
  const createAgent = async event => {
    event.preventDefault();
    try {
      const result = await api('/admin/support-agents', {
        method: 'POST',
        body: { ...agentForm, avatarUrl: agentForm.avatarUrl || null, languages: agentForm.languages.split(',').map(item => item.trim()).filter(Boolean) },
      });
      setNotice(result.smsSent
        ? 'حساب پشتیبان ایجاد و مشخصات ورود اول به شماره ثبت‌شده پیامک شد.'
        : (result.smsWarning || 'حساب پشتیبان ایجاد شد، اما پیامک ارسال نشد.'));
      setAgentForm(current => ({ ...current, mobile: '', fullName: '', username: '', temporaryPassword: '', topicIds: [] }));
      await load();
    } catch (err) { setNotice(err.message); }
  };
  const toggleAgent = async agent => {
    await api(`/admin/support-agents/${agent.id}`, { method: 'PATCH', body: { status: agent.status === 'active' ? 'suspended' : 'active' } });
    await load();
  };
  const saveAgentCredentials = async event => {
    event.preventDefault();
    try {
      const result = await api(`/admin/support-agents/${editingAgent.id}`, {
        method:'PATCH',
        body:{
          username: editingAgent.username, ...(editingAgent.password ? { password:editingAgent.password } : {}),
          fullName: editingAgent.full_name, jobTitle: editingAgent.job_title || editingAgent.supportProfile?.title || 'کارشناس پشتیبانی',
          topicIds: editingAgent.topicIds,
          permissions: editingAgent.permissions,
          capacity: Number(editingAgent.capacity || editingAgent.supportProfile?.capacity || 8),
          timezone: editingAgent.timezone || editingAgent.supportProfile?.timezone || 'Asia/Tehran',
          languages: editingAgent.languages || parseSafeJson(editingAgent.supportProfile?.languages, ['fa']),
          seniority: editingAgent.seniority || editingAgent.supportProfile?.seniority || 'mid',
        },
      });
      setEditingAgent(null); setNotice(result.smsSent === true ? 'اطلاعات پشتیبان به‌روزرسانی و مشخصات ورود جدید پیامک شد.' : (result.smsWarning || 'اطلاعات پشتیبان به‌روزرسانی شد.')); await load();
    } catch (err) { setNotice(err.message); }
  };
  const saveSla = async row => {
    try {
      await api(`/support-admin/slas/${row.id}`, {
        method: 'PATCH',
        body: {
          firstResponseMinutes: Number(row.first_response_minutes),
          nextResponseMinutes: Number(row.next_response_minutes),
          resolutionMinutes: Number(row.resolution_minutes),
          warningPercent: Number(row.warning_percent),
        },
      });
      setNotice(`زمان‌بندی ${row.name} ذخیره شد.`); await load();
    } catch (err) { setNotice(err.message); }
  };
  const logout = async () => { try { await api('/auth/logout', { method:'POST' }); } catch {} setToken(null); navigate('/'); };
  const openTicket = async id => { setActiveTicket(id); setThread(await api(`/admin/support/${id}/messages`)); };
  const answer = async event => {
    event.preventDefault(); await api(`/admin/support/${activeTicket}/messages`, { method: 'POST', body: { body: reply } }); setReply(''); await openTicket(activeTicket); await load();
  };
  if (!data || !user) return <div className="portal-loading">
<Loader/>
</div>;
  const CustomerOptions = () => <>
<option value="">انتخاب مشتری</option>{customers.map(c => <option key={c.id} value={c.id}>{c.full_name || c.mobile}{c.company ? ` — ${c.company}` : ''}</option>)}</>;
  const permissionLabels = {
    'support.tickets.view': 'مشاهده تیکت',
    'support.tickets.reply': 'پاسخ عمومی', 'support.notes.create': 'یادداشت داخلی',
    'support.customers.context': 'اطلاعات مشتری', 'support.tickets.transfer': 'انتقال تیکت',
    'support.tickets.close': 'حل و بستن', 'support.tickets.reopen': 'بازگشایی',
    'support.attachments.manage': 'مدیریت پیوست', 'support.tags.manage': 'مدیریت برچسب',
    'support.macros.manage': 'مدیریت پاسخ آماده', 'support.reports.view': 'مشاهده گزارش',
    'support.reports.export': 'خروجی گزارش', 'support.knowledge.view': 'مشاهده دانش',
    'support.knowledge.manage': 'مدیریت دانش', 'support.ai.view_logs': 'مشاهده لاگ AI',
    'support.sla.manage': 'مدیریت SLA',
    'support.agents.manage': 'مدیریت کارشناسان',
  };
  return <div className="admin-page" dir="rtl">
<header>
<LogoButton onClick={() => navigate('/')}/>
<div>
<span>ادمین اصلی سامانه</span>
<b>{user.full_name}</b>
</div>
<button onClick={() => navigate('/account')}>نمای مشتری <CircleUserRound/>
</button>
</header>
<main>
<PageHead eyebrow="مرکز کنترل" title="مدیریت یکپارچه راهکار" text="ادمین اصلی کاربران هر بخش را می‌سازد و دسترسی سامانه‌های مستقل را کنترل می‌کند."/>
<Notice>{notice}</Notice>
<div className="admin-kpis">{[['مشتریان',data.users,UserRound],['سفارش‌ها',data.orders,Package],['مشاوره‌ها',data.consultations,ClipboardList],['گفتگوهای پشتیبانی',data.tickets,MessageCircle]].map(([label,value,Icon]) => <article key={label}>
<Icon/>
<span>{label}</span>
<b>{fa(value)}</b>
</article>)}</div>{data.profiles&&<section className="profile-health">
<article>
<b>{fa(data.profiles.complete)}</b>
<span>پروفایل کامل</span>
</article>
<article>
<b>{fa(data.profiles.incomplete)}</b>
<span>پروفایل ناقص</span>
</article>
<article className="critical">
<b>{fa(data.profiles.critical)}</b>
<span>پروفایل بحرانی</span>
</article>
</section>}
    {(supportAlerts.breached?.length || supportAlerts.capacities?.some(item => item.saturated)) ? <section className="support-alert-center" aria-live="polite">
      <div><TriangleAlert/><span><b>{fa(supportAlerts.breached?.length)} گفتگوی خارج از مهلت</b><small>این موارد تا زمان حل یا بستن در هشدار ادمین اصلی باقی می‌مانند.</small></span></div>
      <div className="support-alert-items">{supportAlerts.breached?.slice(0, 8).map(item => <article key={item.id}><b>{item.public_no || item.ticket_no}</b><span>{item.subject}</span><small>{item.agent_name || 'بدون کارشناس'} · مهلت {exactDate(item.resolution_due_at)}</small></article>)}</div>
      {supportAlerts.capacities?.some(item => item.saturated) && <p><UserCog/> ظرفیت تکمیل: {supportAlerts.capacities.filter(item => item.saturated).map(item => `${item.full_name || 'کارشناس'} (${fa(item.open)}/${fa(item.capacity)})`).join('، ')}</p>}
    </section> : null}
    <section className="portal-card sla-admin-settings">
      <div className="admin-section-head"><div><span><Clock/></span><div><small>قابل ویرایش توسط ادمین اصلی</small><h2>زمان پاسخ و حل گفتگوها (SLA)</h2><p>زمان‌ها بر حسب دقیقه کاری هستند و هشدار در درصد تعیین‌شده فعال می‌شود.</p></div></div></div>
      <div>{supportSlas.map(row => <form key={row.id} onSubmit={event => { event.preventDefault(); saveSla(row); }}>
        <b>{row.name}</b>
        <label>پاسخ اول<input type="number" min="1" value={row.first_response_minutes} onChange={e => setSupportSlas(items => items.map(item => item.id === row.id ? { ...item, first_response_minutes: e.target.value } : item))}/></label>
        <label>پاسخ بعدی<input type="number" min="1" value={row.next_response_minutes} onChange={e => setSupportSlas(items => items.map(item => item.id === row.id ? { ...item, next_response_minutes: e.target.value } : item))}/></label>
        <label>مهلت حل<input type="number" min="1" value={row.resolution_minutes} onChange={e => setSupportSlas(items => items.map(item => item.id === row.id ? { ...item, resolution_minutes: e.target.value } : item))}/></label>
        <label>هشدار از درصد<input type="number" min="10" max="99" value={row.warning_percent} onChange={e => setSupportSlas(items => items.map(item => item.id === row.id ? { ...item, warning_percent: e.target.value } : item))}/></label>
        <button><Save/> ذخیره</button>
      </form>)}</div>
    </section>
    <section className="portal-card admin-section-control">
<div className="admin-section-head">
<div>
<span>
<Headphones/>
</span>
<div>
<small>سامانه مستقل شماره ۱</small>
<h2>مدیریت گفتگو و پشتیبانی</h2>
<p>ساخت پشتیبان، تعیین مجوز، تخصیص گفتگو و کنترل صف پاسخ‌گویی</p>
</div>
</div>
<button className="portal-primary compact" onClick={() => navigate('/admin/support')}>ورود به سامانه پشتیبانی <ChevronLeft/>
</button>
</div>
<div className="support-team-grid">
<form className="portal-form support-agent-form" onSubmit={createAgent}>
<h3>
<UserCog/> تعریف پشتیبان گفتگو</h3>
<div className="form-grid">
<label>نام و نام خانوادگی<input value={agentForm.fullName} onChange={e => setAgentForm({ ...agentForm, fullName: e.target.value })} required/>
</label>
<label>شماره همراه<input dir="ltr" inputMode="tel" value={agentForm.mobile} onChange={e => setAgentForm({ ...agentForm, mobile: e.target.value })} placeholder="09121234567" required/>
</label>
<label>نام کاربری موقت<input dir="ltr" value={agentForm.username} onChange={e => setAgentForm({ ...agentForm, username: e.target.value })} placeholder="support.name" pattern="[A-Za-z][A-Za-z0-9._-]{3,39}" required/>
</label>
<label>رمز عبور موقت<input dir="ltr" type="password" minLength="10" value={agentForm.temporaryPassword} onChange={e => setAgentForm({ ...agentForm, temporaryPassword: e.target.value })} placeholder="حداقل ۱۰ نویسه" required/>
</label>
<label>عنوان شغلی<input value={agentForm.jobTitle} onChange={e => setAgentForm({ ...agentForm, jobTitle: e.target.value })} required/>
</label>
<label>آدرس تصویر پروفایل<input dir="ltr" value={agentForm.avatarUrl} onChange={e => setAgentForm({ ...agentForm, avatarUrl: e.target.value })} placeholder="اختیاری"/>
</label>
<label>زبان‌های پاسخ‌گویی<input dir="ltr" value={agentForm.languages} onChange={e => setAgentForm({ ...agentForm, languages: e.target.value })} placeholder="fa,en" required/>
</label>
<label>منطقه زمانی<input dir="ltr" value={agentForm.timezone} onChange={e => setAgentForm({ ...agentForm, timezone: e.target.value })} required/>
</label>
<label>حداکثر گفتگوی فعال<input type="number" min="1" max="8" value={agentForm.capacity} onChange={e => setAgentForm({ ...agentForm, capacity: Number(e.target.value) })} required/>
</label>
<label>سطح ارشدیت<select value={agentForm.seniority} onChange={e => setAgentForm({ ...agentForm, seniority: e.target.value })}>
<option value="junior">تازه‌کار</option><option value="mid">میانی</option><option value="senior">ارشد</option><option value="lead">سرپرست</option>
</select></label>
</div>
<fieldset><legend>موضوعات قابل پاسخ‌گویی (حداقل یک مورد)</legend><div className="permission-checks">{SUPPORT_TOPICS.map(topic => <label key={topic.id}>
<input type="checkbox" checked={agentForm.topicIds.includes(topic.id)} onChange={e => setAgentForm(current => ({
  ...current, topicIds: e.target.checked ? [...current.topicIds, topic.id] : current.topicIds.filter(id => id !== topic.id),
}))}/><span><Check/>{topic.label}</span></label>)}</div></fieldset>
<fieldset>
<legend>سطح دسترسی</legend>
<div className="permission-checks">{Object.entries(permissionLabels).map(([key,label]) => <label key={key}>
<input type="checkbox" checked={agentForm.permissions[key]} onChange={e => setAgentForm({ ...agentForm, permissions: { ...agentForm.permissions, [key]: e.target.checked } })}/>
<span>
<Check/>{label}</span>
</label>)}</div>
</fieldset>
<button className="portal-primary">
<Plus/> ایجاد حساب پشتیبان</button>
</form>
<div className="support-team-list">
<h3>
<UsersRound/> پشتیبان‌های تعریف‌شده</h3>{agents.length ? agents.map(agent => <article key={agent.id}>
<span className={`agent-avatar ${agent.status}`}>{(agent.full_name || 'پ').slice(0,1)}</span>
<div>
<b>{agent.full_name || 'پشتیبان راهکار'}</b>
<small dir="ltr">{agent.username || 'بدون نام کاربری'} · {fa(agent.open)} گفتگوی باز</small>
<small>{agent.job_title || agent.supportProfile?.title || 'کارشناس پشتیبانی'} · ظرفیت {fa(agent.supportProfile?.capacity || 8)} · {status(agent.supportProfile?.presence_status || 'offline')}</small>
<div>{agent.skills?.filter(skill => skill.slug?.startsWith('order-') || SUPPORT_TOPICS.some(topic => topic.id === skill.slug)).map(skill => <em key={skill.skill_id}>{skill.name}</em>)}</div>
<div>{Object.entries(agent.permissions).filter(([,enabled]) => enabled).map(([key]) => <em key={key}>{permissionLabels[key] || key}</em>)}</div>
</div>
<div className="agent-row-actions">
<button className="edit-soft" onClick={() => { setShowAgentPassword(false); setEditingAgent({
  ...agent, password:'', topicIds: agent.skills?.map(item => item.slug).filter(slug => SUPPORT_TOPICS.some(topic => topic.id === slug)) || [],
  capacity: Math.min(8, agent.supportProfile?.capacity || 8),
  timezone: agent.supportProfile?.timezone || 'Asia/Tehran',
  languages: parseSafeJson(agent.supportProfile?.languages, ['fa']),
  seniority: agent.supportProfile?.seniority || 'mid',
}); }}>
<Pencil/>ویرایش</button>
<button className={agent.status === 'active' ? 'danger-soft' : 'success-soft'} onClick={() => toggleAgent(agent)}>
<PauseCircle/>{agent.status === 'active' ? 'تعلیق' : 'فعال‌سازی'}</button>
</div>
</article>) : <Empty icon={UsersRound} title="هنوز پشتیبانی تعریف نشده" text="اولین حساب پشتیبان را از فرم کناری ایجاد کنید."/ >}</div>
</div>
</section>
    {editingAgent && <div className="agent-credential-backdrop">
<form onSubmit={saveAgentCredentials}>
      <button type="button" className="agent-modal-close" onClick={() => setEditingAgent(null)} aria-label="بستن">
<X/>
</button>
      <Pencil/>
<h2>ویرایش حساب {editingAgent.full_name || 'پشتیبان'}</h2>
      <label>نام و نام خانوادگی<input value={editingAgent.full_name || ''} onChange={e => setEditingAgent({ ...editingAgent, full_name: e.target.value })} required/></label>
      <label>عنوان شغلی<input value={editingAgent.job_title || editingAgent.supportProfile?.title || ''} onChange={e => setEditingAgent({ ...editingAgent, job_title: e.target.value })} required/></label>
      <label>نام کاربری<input dir="ltr" value={editingAgent.username || ''} onChange={e => setEditingAgent({ ...editingAgent, username:e.target.value })} pattern="[A-Za-z][A-Za-z0-9._-]{3,39}" required/>
</label>
      <label>رمز جدید (اختیاری)<div>
<input dir="ltr" type={showAgentPassword ? 'text' : 'password'} minLength="8" value={editingAgent.password || ''} onChange={e => setEditingAgent({ ...editingAgent, password:e.target.value })}/>
<button type="button" onClick={() => setShowAgentPassword(value => !value)} aria-label={showAgentPassword ? 'مخفی‌کردن رمز' : 'نمایش رمز'}>{showAgentPassword ? <EyeOff/> : <Eye/>}</button>
</div>
</label>
      <label>حداکثر گفتگوی فعال<input type="number" min="1" max="8" value={editingAgent.capacity || 8} onChange={e => setEditingAgent({ ...editingAgent, capacity: Number(e.target.value) })}/></label>
      <fieldset><legend>موضوعات قابل پاسخ‌گویی</legend><div className="permission-checks">{SUPPORT_TOPICS.map(topic => <label key={topic.id}>
        <input type="checkbox" checked={editingAgent.topicIds?.includes(topic.id)} onChange={e => setEditingAgent({
          ...editingAgent, topicIds: e.target.checked ? [...editingAgent.topicIds, topic.id] : editingAgent.topicIds.filter(id => id !== topic.id),
        })}/><span><Check/>{topic.label}</span>
      </label>)}</div></fieldset>
      <fieldset><legend>مجوزها</legend><div className="permission-checks">{Object.entries(permissionLabels).map(([key, label]) => <label key={key}>
        <input type="checkbox" checked={Boolean(editingAgent.permissions?.[key])} onChange={e => setEditingAgent({ ...editingAgent, permissions: { ...editingAgent.permissions, [key]: e.target.checked } })}/><span><Check/>{label}</span>
      </label>)}</div></fieldset>
      <button>ذخیره تغییرات</button>
    </form>
</div>}
    {salesManagers}
    <div className="admin-grid">
<section className="portal-card admin-orders">
<h2>آخرین سفارش‌ها</h2>{orders.length ? <div className="admin-table">
<div>
<b>شماره</b>
<b>مشتری</b>
<b>مبلغ</b>
<b>وضعیت</b>
</div>{orders.map(o => <div key={o.id}>
<span>{o.order_no}</span>
<span>{o.full_name || o.mobile}</span>
<span>{money(o.total)}</span>
<select value={o.status} onChange={e => changeOrder(o.id, e.target.value)}>
<option value="awaiting_payment">در انتظار پرداخت</option>
<option value="paid">پرداخت‌شده</option>
<option value="processing">آماده‌سازی</option>
<option value="shipped">ارسال‌شده</option>
<option value="delivered">تحویل‌شده</option>
<option value="cancelled">لغوشده</option>
</select>
</div>)}</div> : <Empty title="سفارشی ثبت نشده" text="سفارش مشتریان اینجا نمایش داده می‌شود."/ >}</section>
<section className="portal-card">
<h2>درخواست‌های مشاوره</h2>{consultations.length ? <div className="admin-consult-list">{consultations.map(c => <div key={c.id}>
<div>
<b>{c.subject}</b>
<small>{c.full_name || c.mobile} · {date(c.created_at)}</small>
</div>
<select value={c.status} onChange={e => changeConsultation(c.id, e.target.value)}>
<option value="new">جدید</option>
<option value="reviewing">در حال بررسی</option>
<option value="answered">پاسخ داده‌شده</option>
<option value="closed">بسته</option>
</select>
</div>)}</div> : <Empty icon={ClipboardList} title="درخواستی نیست" text="درخواست‌های جدید در این صف قرار می‌گیرند."/ >}</section>
<section className="portal-card admin-issuance">
<h2>صدور برای مشتری</h2>
<div className="admin-form-tabs">
<form className="portal-form" onSubmit={issueQuote}>
<h3>پیش‌فاکتور</h3>
<label>مشتری<select value={quote.userId} onChange={e => setQuote({ ...quote, userId: e.target.value })} required>
<CustomerOptions/>
</select>
</label>
<label>عنوان<input value={quote.title} onChange={e => setQuote({ ...quote, title: e.target.value })} required/>
</label>
<label>مبلغ (ریال)<input type="number" min="0" value={quote.amount} onChange={e => setQuote({ ...quote, amount: e.target.value })} required/>
</label>
<label>اعتبار تا<input type="date" value={quote.validUntil} onChange={e => setQuote({ ...quote, validUntil: e.target.value })}/>
</label>
<button className="portal-primary">صدور پیش‌فاکتور</button>
</form>
<form className="portal-form" onSubmit={createProject}>
<h3>پروژه جدید</h3>
<label>مشتری<select value={project.userId} onChange={e => setProject({ ...project, userId: e.target.value })} required>
<CustomerOptions/>
</select>
</label>
<label>عنوان پروژه<input value={project.title} onChange={e => setProject({ ...project, title: e.target.value })} required/>
</label>
<button className="portal-primary">ایجاد پروژه</button>
</form>
</div>
</section>
</div>
</main>
</div>;
}

export function SupportAdminPage({ navigate }) {
  const [me, setMe] = useState(null);
  const [payload, setPayload] = useState({ items: [], page: 1, hasMore: false });
  const [activeId, setActiveId] = useState('');
  const [thread, setThread] = useState(null);
  const [reply, setReply] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [advancedFilters, setAdvancedFilters] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('aronage_support_filters') || '{}'); } catch { return {}; }
  });
  const [notice, setNotice] = useState('');
  const [liveState, setLiveState] = useState('connecting');
  const [mode, setMode] = useState('public_reply');
  const [sending, setSending] = useState(false);
  const [macros, setMacros] = useState([]);
  const [report, setReport] = useState(null);
  const [aiAssist, setAiAssist] = useState(null);
  const [snoozeDialog, setSnoozeDialog] = useState(null);
  const [salesDialog, setSalesDialog] = useState(null);
  const [transferOptions, setTransferOptions] = useState({ teams: [], agents: [] });
  const [contextOpen, setContextOpen] = useState(false);
  const [agentFiles, setAgentFiles] = useState([]);
  const [failedAgentMessage, setFailedAgentMessage] = useState(null);
  const searchController = useRef(null);
  const activeIdRef = useRef('');
  const filtersRef = useRef({ query: '', stateFilter: '', ownerFilter: 'all', advancedFilters: {} });
  filtersRef.current = { query, stateFilter, ownerFilter, advancedFilters };
  const load = async (page = 1) => {
    searchController.current?.abort();
    searchController.current = new AbortController();
    const params = new URLSearchParams({ page: String(page), limit: '40' });
    const current = filtersRef.current;
    if (current.query.trim()) params.set('q', current.query.trim());
    if (current.stateFilter) params.set('status', current.stateFilter);
    if (current.ownerFilter !== 'all') params.set('owner', current.ownerFilter);
    Object.entries(current.advancedFilters || {}).forEach(([key, value]) => {
      if (value !== '' && value !== false && value != null) params.set(key, String(value));
    });
    const support = await api(`/support-agent/queue?${params}`, { signal: searchController.current.signal });
    setPayload(support);
    return support;
  };
  useEffect(() => {
    Promise.all([api('/me'), api('/support-agent/macros').catch(() => []), api('/support-agent/filter-options').catch(() => ({ teams: [], agents: [] }))]).then(([user, macroRows, filterOptions]) => {
      setMe(user); setMacros(macroRows); setTransferOptions(filterOptions); load();
    }).catch(err => {
      if ([401, 403].includes(err.status)) navigate('/auth/login');
      else setNotice(err.message);
    });
    const stop = subscribeEvents('/support-agent/events', event => {
      if (event.event === 'message.created' || event.event.startsWith('ticket.')) {
        load().catch(() => {});
        const openId = activeIdRef.current;
        if (openId && event.data.ticket_id === openId) openTicket(openId);
      }
    }, setLiveState);
    const heartbeat = window.setInterval(() => api('/support-agent/presence', {
      method: 'POST', body: { status: document.hidden ? 'away' : 'online', ticketId: activeIdRef.current || null, typing: false },
    }).catch(() => {}), 45_000);
    api('/support-agent/presence', { method: 'POST', body: { status: 'online', ticketId: null, typing: false } }).catch(() => {});
    return () => { stop(); window.clearInterval(heartbeat); searchController.current?.abort(); };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => load().catch(err => err.name !== 'AbortError' && setNotice(err.message)), 350);
    sessionStorage.setItem('aronage_support_filters', JSON.stringify(advancedFilters));
    return () => window.clearTimeout(timer);
  }, [query, stateFilter, ownerFilter, advancedFilters]);
  const openTicket = async id => {
    activeIdRef.current = id;
    setActiveId(id); setThread(await api(`/support-agent/tickets/${id}`)); setNotice('');
    await api(`/support-agent/tickets/${id}/read`, { method: 'POST', body: {} });
    await api('/support-agent/presence', { method: 'POST', body: { status: 'online', ticketId: id, typing: false } });
  };
  const sendMessage = async (event, retryPayload = null) => {
    event?.preventDefault?.(); setSending(true);
    const body = retryPayload?.body || (mode === 'internal_note' ? internalNote : reply);
    const messageMode = retryPayload?.mode || mode;
    const idempotencyKey = retryPayload?.idempotencyKey || crypto.randomUUID();
    try {
      let attachmentIds = [];
      const pending = retryPayload?.files || agentFiles;
      if (pending.length) {
        const formData = new FormData();
        pending.forEach(file => formData.append('files', file));
        const uploaded = await api(`/support-agent/tickets/${activeId}/attachments`, { method: 'POST', body: formData });
        attachmentIds = uploaded.items.map(item => item.id);
      }
      const result = await api(`/support-agent/tickets/${activeId}/messages`, {
        method: 'POST',
        body: {
          body, type: messageMode, stateVersion: Number(thread.ticket.state_version || 0),
          idempotencyKey, attachmentIds,
        },
      });
      if (messageMode === 'internal_note') setInternalNote(''); else setReply('');
      setAgentFiles([]); setFailedAgentMessage(null);
      if (result.collisionViewer) setNotice(`${result.collisionViewer} نیز این گفتگو را مشاهده می‌کند.`);
      await openTicket(activeId); await load();
    } catch (err) {
      setNotice(err.message);
      setFailedAgentMessage({ body, mode: messageMode, files: retryPayload?.files || agentFiles, idempotencyKey });
    }
    finally { setSending(false); }
  };
  const changeStatus = async statusValue => {
    try {
      await api(`/support-agent/tickets/${activeId}/operational-status`, {
        method: 'PATCH',
        body: { status: statusValue, stateVersion: Number(thread.ticket.state_version || 0) },
      });
      await load(); await openTicket(activeId);
    } catch (err) { setNotice(err.message); }
  };
  const openSnooze = () => {
    const defaultAt = new Date(Date.now() + 2 * 60 * 60_000);
    setSnoozeDialog({ until: defaultAt.toISOString().slice(0, 16), reason: '' });
  };
  const quickSnooze = minutes => setSnoozeDialog(current => ({
    ...(current || {}), until: new Date(Date.now() + minutes * 60_000).toISOString().slice(0, 16),
  }));
  const submitSnooze = async event => {
    event.preventDefault();
    try {
      await api(`/support-agent/tickets/${activeId}/status`, {
        method: 'PATCH',
        body: {
          status: 'snoozed', stateVersion: Number(thread.ticket.state_version || 0),
          reason: snoozeDialog.reason, snoozedUntil: new Date(snoozeDialog.until).toISOString(),
        },
      });
      setSnoozeDialog(null); await load(); await openTicket(activeId);
    } catch (err) { setNotice(err.message); }
  };
  const openSalesEscalation = () => setSalesDialog({
    category: thread?.ticket?.intent === 'payment' ? 'payment' : thread?.ticket?.intent === 'shipment' ? 'shipment' : thread?.ticket?.intent === 'order' ? 'order' : 'store_support',
    orderId: thread?.ticket?.order_id || '',
    priority: thread?.ticket?.final_priority || 'normal',
    summary: thread?.escalation?.summary || `موضوع مشتری: ${thread?.ticket?.subject || ''}`,
  });
  const submitSalesEscalation = async event => {
    event.preventDefault();
    try {
      const result = await api(`/support-agent/tickets/${activeId}/sales-escalation`, {
        method: 'POST', body: { ...salesDialog, orderId: salesDialog.orderId || null },
      });
      setSalesDialog(null); await load(); await openTicket(activeId);
      setNotice(result.reused ? 'این گفتگو از قبل یک تیکت فروشگاهی فعال دارد.' : `تیکت ${result.salesTicketNo} برای ادمین فروشگاه ایجاد شد.`);
    } catch (err) { setNotice(err.message); }
  };
  const showReport = async () => {
    try { setReport(await api('/support-agent/reports')); } catch (err) { setNotice(err.message); }
  };
  const getAiSummary = async () => {
    try { setAiAssist(await api(`/support-agent/tickets/${activeId}/ai-summary`)); } catch (err) { setNotice(err.message); }
  };
  const getAiSuggestion = async () => {
    try { setAiAssist(await api(`/support-agent/tickets/${activeId}/ai-suggestion`, { method: 'POST', body: {} })); }
    catch (err) { setNotice(err.message); }
  };
  const logout = async () => {
    try { await api('/support-agent/presence', { method: 'POST', body: { status: 'offline', ticketId: activeId || null, typing: false } }); } catch {}
    try { await api('/auth/logout', { method: 'POST' }); } catch {}
    setToken(null); navigate('/');
  };
  if (!me) return <div className="portal-loading">
<Loader/>
</div>;
  const tickets = payload.items || [];
  const selected = tickets.find(ticket => ticket.id === activeId) || thread?.ticket;
  const openCount = tickets.filter(ticket => !['resolved', 'closed'].includes(ticket.status)).length;
  const unassignedCount = tickets.filter(ticket => !ticket.agent_id).length;
  const breachedCount = tickets.filter(ticket => ticket.resolution_due_at && new Date(ticket.resolution_due_at) < new Date() && !['resolved', 'closed'].includes(ticket.status)).length;
  const ticketSla = slaMetrics(thread?.ticket);
  const isSupportAdmin = ['admin', 'super_admin'].includes(me.role);
  const can = key => Boolean(thread?.permissions?.[key] || payload.permissions?.[key] || ['admin', 'super_admin'].includes(me.role));
  const operationalStatus = ['resolved', 'closed'].includes(thread?.ticket?.status)
    ? 'closed' : ['waiting_internal', 'snoozed'].includes(thread?.ticket?.status) ? 'reviewing' : 'open';
  return <div className="support-admin-page" dir="rtl">
    <aside className="support-admin-nav">
      <LogoButton onClick={() => navigate('/')}/>
      <div className="support-admin-brand">
<span>
<Headphones/>
</span>
<div>
<small>سامانه مستقل</small>
<b>پشتیبانی راهکار</b>
</div>
</div>
      <nav>
        <button className={!stateFilter && ownerFilter === 'all' ? 'active' : ''} onClick={() => { setStateFilter(''); setOwnerFilter('all'); }}>
<MessageCircle/> همه گفتگوها <em>{fa(openCount)}</em>
</button>
        <button className={ownerFilter === 'me' ? 'active' : ''} onClick={() => setOwnerFilter('me')}>
<UserRound/> گفتگوهای من</button>
        {isSupportAdmin && <button className={ownerFilter === 'unassigned' ? 'active' : ''} onClick={() => setOwnerFilter('unassigned')}>
<UserCog/> تخصیص‌نیافته <em>{fa(unassignedCount)}</em>
</button>}
        <button className={stateFilter === 'waiting_customer' ? 'active' : ''} onClick={() => setStateFilter('waiting_customer')}>
<Clock/> منتظر مشتری</button>
        <button className={stateFilter === 'waiting_internal' ? 'active' : ''} onClick={() => setStateFilter('waiting_internal')}>
<ShieldCheck/> بررسی داخلی</button>
        <button className={stateFilter === 'snoozed' ? 'active' : ''} onClick={() => setStateFilter('snoozed')}>
<PauseCircle/> یادآوری در آینده</button>
        {can('support.reports.view') && <button onClick={showReport}>
<ClipboardList/> گزارش عملکرد</button>}
      </nav>
      {['admin', 'super_admin'].includes(me.role) && <button className="back-super" onClick={() => navigate('/admin')}>
<ShieldCheck/> بازگشت به ادمین اصلی</button>}
      <div className="support-admin-user">
<span>{(me.full_name || 'پ').slice(0,1)}</span>
<div>
<b>{me.full_name || 'پشتیبان راهکار'}</b>
<small>{liveState === 'connected' ? 'آنلاین واقعی' : 'اتصال مجدد…'}</small>
</div>
<button onClick={logout} aria-label="خروج">
<LogOut/>
</button>
</div>
    </aside>
    <main>
      <header>
<div>
<small>مرکز پاسخ‌گویی مشتریان</small>
<h1>فضای کار کارشناسان</h1>
</div>
<div className={`live-indicator ${liveState}`}>
<i/>{liveState === 'connected' ? 'ارتباط زنده' : 'اتصال مجدد'}</div>
<button className="manual-refresh" onClick={() => load().catch(err => setNotice(err.message))}>
<RefreshCw/> به‌روزرسانی</button>
</header>
      <Notice>{notice}</Notice>
      {report && <section className="support-report-strip">
<button onClick={() => setReport(null)} aria-label="بستن گزارش">
<X/>
</button>
<span>
<b>{fa(report.kpis.newTickets)}</b> تیکت جدید</span>
<span>
<b>{fa(report.kpis.backlog)}</b> Backlog</span>
<span>
<b>{report.kpis.csat ?? '—'}</b> CSAT</span>
<span>
<b>{fa(report.kpis.slaBreached)}</b> نقض SLA</span>
<span>
<b>{fa(report.kpis.aiResolutionRate)}٪</b> پاسخ مستند AI</span>
</section>}
      <div className="support-ops-kpis">
<article>
<MessageCircle/>
<span>نیازمند اقدام</span>
<b>{fa(openCount)}</b>
</article>
{isSupportAdmin && <article>
<UserCog/>
<span>بدون مسئول</span>
<b>{fa(unassignedCount)}</b>
</article>}
<article>
<Clock/>
<span>نقض SLA</span>
<b>{fa(breachedCount)}</b>
</article>
<article>{liveState === 'connected' ? <Wifi/> : <WifiOff/>}<span>ارتباط زنده</span>
<b>{liveState === 'connected' ? 'فعال' : 'وصل مجدد'}</b>
</article>
</div>
      <section className={`support-workspace ${activeId ? 'mobile-agent-thread-open' : ''}`}>
        <div className="support-inbox">
          <div className="support-inbox-tools">
<label>
<Search/>
<input value={query} onChange={event => setQuery(event.target.value)} placeholder="جست‌وجوی سمت سرور…"/>
</label>
<div>
<Filter/>
<select value={stateFilter} onChange={event => setStateFilter(event.target.value)}>
<option value="">همه وضعیت‌ها</option>{['new','ai_active','ai_waiting_customer','queued','assigned','agent_active','waiting_customer','waiting_internal','snoozed','resolved','closed','reopened'].map(value => <option key={value} value={value}>{status(value)}</option>)}</select>
<select value={ownerFilter} onChange={event => setOwnerFilter(event.target.value)}>
<option value="all">همه مسئولان</option>
<option value="me">گفتگوهای من</option>
{isSupportAdmin && <option value="unassigned">بدون مسئول</option>}
</select>
</div>
            <details className="advanced-queue-filters">
              <summary>فیلترهای بیشتر</summary>
              <div>
                <select aria-label="اولویت" value={advancedFilters.priority || ''} onChange={e => setAdvancedFilters(v => ({ ...v, priority: e.target.value }))}>
                  <option value="">همه اولویت‌ها</option><option value="normal">عادی</option><option value="high">زیاد</option><option value="critical">بحرانی</option>
                </select>
                <select aria-label="تیم" value={advancedFilters.team || ''} onChange={e => setAdvancedFilters(v => ({ ...v, team: e.target.value }))}>
                  <option value="">همه تیم‌ها</option>{transferOptions.teams?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <select aria-label="کارشناس" value={advancedFilters.agent || ''} onChange={e => setAdvancedFilters(v => ({ ...v, agent: e.target.value }))}>
                  <option value="">همه کارشناسان</option>{transferOptions.agents?.map(item => <option key={item.id} value={item.id}>{item.full_name || item.id}</option>)}
                </select>
                <select aria-label="وضعیت SLA" value={advancedFilters.sla || ''} onChange={e => setAdvancedFilters(v => ({ ...v, sla: e.target.value }))}>
                  <option value="">همه SLAها</option><option value="warning">نزدیک نقض</option><option value="breached">نقض‌شده</option>
                </select>
                <label><input type="checkbox" checked={Boolean(advancedFilters.unread)} onChange={e => setAdvancedFilters(v => ({ ...v, unread: e.target.checked }))}/> پیام خوانده‌نشده</label>
                <label><input type="checkbox" checked={Boolean(advancedFilters.hasAttachment)} onChange={e => setAdvancedFilters(v => ({ ...v, hasAttachment: e.target.checked }))}/> دارای پیوست</label>
                <input type="date" aria-label="از تاریخ" value={advancedFilters.from?.slice(0,10) || ''} onChange={e => setAdvancedFilters(v => ({ ...v, from: e.target.value ? `${e.target.value}T00:00:00.000Z` : '' }))}/>
                <input type="date" aria-label="تا تاریخ" value={advancedFilters.to?.slice(0,10) || ''} onChange={e => setAdvancedFilters(v => ({ ...v, to: e.target.value ? `${e.target.value}T23:59:59.999Z` : '' }))}/>
                <button type="button" onClick={() => setAdvancedFilters({})}>پاک‌کردن فیلترها</button>
              </div>
            </details>
</div>
          <div className="support-inbox-list">{tickets.length ? tickets.map(ticket => <button key={ticket.id} className={activeId === ticket.id ? 'active' : ''} onClick={() => openTicket(ticket.id)}>
<span className={`priority-dot ${ticket.final_priority || ticket.priority}`}/>
<div>
<span>
<b>{ticket.full_name || ticket.mobile}</b>
<small>{exactDate(ticket.last_activity_at || ticket.created_at)}</small>
</span>
<h3>{ticket.subject}</h3>
<p>{ticket.public_no || ticket.ticket_no} · {ticket.team_name || 'صف عمومی'}{Number(ticket.unread_agent) ? ` · ${fa(ticket.unread_agent)} جدید` : ''}</p>
</div>
<em className={`status ${ticket.status}`}>{status(ticket.status)}</em>
</button>) : <Empty icon={MessageCircle} title="گفتگویی مطابق فیلتر نیست" text="فیلترها یا عبارت جست‌وجو را تغییر دهید."/ >}</div>
          <div className="queue-pagination">
            <button disabled={payload.page <= 1} onClick={() => load(payload.page - 1)}>صفحه قبلی</button>
            <span>صفحه {fa(payload.page)}</span>
            <button disabled={!payload.hasMore} onClick={() => load(payload.page + 1)}>صفحه بعد</button>
          </div>
        </div>
        <div className="support-conversation">{thread && selected ? <>
          <div className="conversation-head">
<div>
<button className="agent-mobile-back" onClick={() => { activeIdRef.current = ''; setActiveId(''); setThread(null); }} aria-label="بازگشت به صف">
<ArrowRight/>
</button>
<span className="customer-avatar">{(thread.customer?.full_name || selected.full_name || 'م').slice(0,1)}</span>
<div>
<h2>{thread.customer?.full_name || selected.full_name || 'مشتری راهکار'}</h2>
<p>{selected.mobile || thread.customer?.mobile} · {selected.public_no || selected.ticket_no}</p>
</div>
</div>
<div className="conversation-primary-actions">
<label className="conversation-status-control"><span>وضعیت گفتگو</span><select aria-label="وضعیت گفتگو" disabled={thread.readOnly || !thread.ticket.agent_id} value={operationalStatus} onChange={event => changeStatus(event.target.value)}>
<option value="open">باز</option><option value="reviewing">در حال بررسی</option><option value="closed">بسته</option></select></label>
{can('support.tickets.reply') && <button className="sales-ticket-action" onClick={openSalesEscalation} disabled={thread.readOnly}>
<ShoppingBag/>{thread.salesTicket && !['resolved','closed'].includes(thread.salesTicket.status) ? 'تیکت ثبت شده' : 'ثبت تیکت'}</button>}
</div>
</div>
          <div className="conversation-subject">
<span className={`priority ${thread.ticket.final_priority}`}>{thread.ticket.final_priority === 'critical' ? 'بحرانی' : thread.ticket.final_priority === 'high' ? 'زیاد' : 'عادی'}</span>
<b>{thread.ticket.subject}</b>
<button className="context-toggle" onClick={() => setContextOpen(true)}><UserRound/> اطلاعات مشتری</button>
<small>نسخه رکورد {fa(thread.ticket.state_version)}</small>{thread.activeViewers?.length ? <em>{thread.activeViewers.map(item => item.full_name || 'همکار').join('، ')} در گفتگو</em> : null}</div>
          {!thread.ticket.agent_id && isSupportAdmin && <div className="unassigned-claim"><span>این گفتگو در صف مرکزی است؛ پیش از پاسخ، آن را از بخش انتقال به یک کارشناس مشخص تخصیص دهید.</span></div>}
          {thread.escalation && <section className="handoff-summary">
<Bot/>
<div>
<b>خلاصه Handoff هوش مصنوعی</b>
<p>{thread.escalation.summary}</p>
<small>Intent: {thread.escalation.intent} · Sentiment: {thread.escalation.sentiment} · Confidence: {thread.escalation.confidence}</small>
</div>
</section>}
          {aiAssist && <section className="agent-ai-assist">
<Bot/>
<div>
<b>{aiAssist.suggestion ? 'پیشنهاد پاسخ هوش مصنوعی — نیازمند تأیید شما' : 'خلاصه امن گفتگو'}</b>
<p>{aiAssist.suggestion || aiAssist.summary}</p>{aiAssist.citations?.length ? <small>{fa(aiAssist.citations.length)} منبع معتبر · Confidence: {aiAssist.confidence}</small> : null}</div>{aiAssist.suggestion && <button type="button" onClick={() => { setReply(aiAssist.suggestion); setMode('public_reply'); }}>انتقال به Composer</button>}<button type="button" onClick={() => setAiAssist(null)} aria-label="بستن">
<X/>
</button>
</section>}
          <div className="conversation-messages" role="log" aria-live="polite">{thread.messages.map(message => {
            const isCustomer = message.sender_type === 'customer';
            const isAi = message.sender_type === 'ai';
            return <article key={message.id} className={isCustomer ? 'customer' : isAi ? 'ai' : 'agent'}>
<div>
<b>{isCustomer ? (thread.customer?.full_name || 'مشتری') : isAi ? 'دستیار هوشمند راهکار' : (message.full_name || 'کارشناس راهکار')}</b>
<p>{message.body}</p>{message.attachments?.length ? <div className="message-attachments">{message.attachments.map(file => <div key={file.id}>
  {file.mime_type?.startsWith('image/') && <SecureAttachmentImage file={file}/>}
  <button type="button" onClick={() => downloadApiFile(`/support/attachments/${file.id}`, file.original_name).catch(err => setNotice(err.message))}><Paperclip/><span>{file.original_name}<small>{fa(Math.ceil(Number(file.size_bytes || 0)/1024))} کیلوبایت</small></span></button>
</div>)}</div> : null}{message.citations?.length ? <details>
<summary>منابع</summary>{message.citations.map(item => <small key={item.id}>{item.title_snapshot}</small>)}</details> : null}<small>{exactDate(message.created_at)} · {message.delivery_status || 'sent'}</small>
</div>
</article>;
          })}</div>
          {thread.readOnly && <div className="readonly-ticket">این گفتگو در اختیار {thread.owner?.full_name || 'کارشناس دیگری'} است و برای شما فقط خواندنی است.</div>}
          {!thread.readOnly && (can('support.tickets.reply') || can('support.notes.create')) ? <form className={`agent-composer ${mode}`} onSubmit={sendMessage}>
            <div className="composer-modes">
<button type="button" className={mode === 'public_reply' ? 'active' : ''} onClick={() => setMode('public_reply')}>پاسخ عمومی</button>
<button type="button" className={mode === 'internal_note' ? 'active' : ''} onClick={() => setMode('internal_note')}>یادداشت داخلی</button>
<button type="button" onClick={getAiSummary}>
<Bot/> خلاصه AI</button>
<button type="button" onClick={getAiSuggestion}>
<Bot/> پیشنهاد مستند</button>
<select value="" onChange={event => { const macro = macros.find(item => item.id === event.target.value); if (macro) (mode === 'internal_note' ? setInternalNote : setReply)(macro.body.replaceAll('{{customer.name}}', thread.customer?.full_name || 'مشتری')); }}>
<option value="">پاسخ آماده / Macro</option>{macros.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
</div>
            {mode === 'internal_note' && <strong className="internal-note-warning">این یادداشت فقط برای کارشناسان نمایش داده می‌شود.</strong>}
            {agentFiles.length ? <div className="pending-files">{agentFiles.map((file, index) => <span key={`${file.name}-${index}`}><Paperclip/>{file.name}<button type="button" onClick={() => setAgentFiles(rows => rows.filter((_, i) => i !== index))}><X/></button></span>)}</div> : null}
            <textarea rows="3" maxLength="4000" value={mode === 'internal_note' ? internalNote : reply} onFocus={() => api('/support-agent/presence', { method: 'POST', body: { status: 'online', ticketId: activeId, typing: true } }).catch(() => {})} onBlur={() => api('/support-agent/presence', { method: 'POST', body: { status: 'online', ticketId: activeId, typing: false } }).catch(() => {})} onChange={event => mode === 'internal_note' ? setInternalNote(event.target.value) : setReply(event.target.value)} required placeholder={mode === 'internal_note' ? 'یادداشت داخلی؛ هرگز برای مشتری ارسال نمی‌شود…' : 'پاسخ عمومی برای مشتری…'}/>
            <div>
<label className="agent-attachment"><Paperclip/> پیوست<input type="file" multiple accept=".png,.jpg,.jpeg,.webp,.pdf,.txt" onChange={event => setAgentFiles(Array.from(event.target.files || []).slice(0,5))}/></label>
<small>{mode === 'internal_note' ? 'فقط کارشناسان مجاز می‌بینند.' : `${fa(reply.length)} از ۴٬۰۰۰ نویسه · پاسخ زنده برای مشتری`}</small>
<button className="portal-primary" disabled={sending}>{sending ? <RefreshCw className="spin"/> : <MessageCircle/>}{sending ? 'در حال ثبت…' : mode === 'internal_note' ? 'ثبت یادداشت' : 'ارسال پاسخ'}</button>
</div>
            {failedAgentMessage && <button type="button" className="retry-message" onClick={() => sendMessage(null, failedAgentMessage)}><RefreshCw/> تلاش مجدد</button>}
          </form> : !thread.readOnly ? <Notice>مجوز پاسخ‌گویی یا یادداشت داخلی فعال نیست.</Notice> : null}
        </> : <Empty icon={MessageCircle} title="یک گفتگو را انتخاب کنید" text="پیام‌ها، Handoff، SLA و زمینه مشتری اینجا نمایش داده می‌شود."/ >}</div>
        <aside className={`support-context ${contextOpen ? 'open' : ''}`}><button className="context-close" onClick={() => setContextOpen(false)} aria-label="بستن اطلاعات مشتری"><X/></button>{thread ? <>
          <section>
<small>زمینه مشتری</small>
<h3>{thread.customer?.account_type === 'legal' ? 'مشتری حقوقی' : 'مشتری حقیقی'}</h3>
<p>{thread.customer?.full_name || 'اطلاعات محدود'}</p>
<p dir="ltr">{thread.customer?.mobile}</p>
</section>
          <section>
<small>اتصال تجاری</small>{thread.orders?.length ? thread.orders.map(order => <article key={order.id}>
<b>{order.order_no}</b>
<span>{status(order.status)}</span>
<small>{money(order.total)}</small>
</article>) : <p>سفارش متصلی وجود ندارد.</p>}</section>
          <section>
<small>SLA</small>
<div className={`sla-meter ${ticketSla.tone}`}><span style={{ width: `${ticketSla.percent}%` }}/></div>
<p>وضعیت: <b>{ticketSla.remaining}</b> · مصرف {fa(ticketSla.percent)}٪</p>
<p>پاسخ اول: <b>{exactDate(thread.ticket.first_response_due_at)}</b>
</p>
<p>پاسخ بعدی: <b>{exactDate(thread.ticket.next_response_due_at)}</b>
</p>
<p>حل مسئله: <b>{exactDate(thread.ticket.resolution_due_at)}</b>
</p>
</section>
          <section>
<small>Tagها</small>
<div className="context-tags">{thread.tags?.length ? thread.tags.map(item => <em key={item.id} style={{ borderColor: item.color }}>
<Tag/>{item.name}</em>) : <p>بدون Tag</p>}</div>
</section>
          <section>
<small>یادداشت‌های داخلی</small>{thread.internalNotes?.slice(-5).map(note => <article key={note.id}>
<b>{note.full_name || 'کارشناس'}</b>
<p>{note.body}</p>
</article>)}</section>
          <section>
<small>تاریخچه تخصیص</small>{thread.assignmentHistory?.slice(0, 5).map(item => <p key={item.id}>{item.action} · {exactDate(item.created_at)}</p>)}</section>
          <section>
<small>تاریخچه وضعیت</small>{thread.statusHistory?.slice(0, 8).map(item => <p key={item.id}>{status(item.from_status)} ← {status(item.to_status)} · {exactDate(item.created_at)}</p>)}</section>
          {thread.salesTicket && <section className="sales-ticket-context"><small>تیکت فروشگاه</small><h3>{thread.salesTicket.sales_ticket_no}</h3><p>وضعیت: <b>{status(thread.salesTicket.status)}</b></p><p>{thread.salesTicket.resolution_note || thread.salesTicket.summary}</p></section>}
        </> : <Empty icon={UserRound} title="زمینه مشتری" text="با انتخاب گفتگو نمایش داده می‌شود."/>}</aside>
      </section>
      {snoozeDialog && <div className="support-modal-backdrop" role="presentation">
        <form className="support-operation-modal" onSubmit={submitSnooze} role="dialog" aria-modal="true" aria-labelledby="snooze-title">
          <button type="button" className="agent-modal-close" onClick={() => setSnoozeDialog(null)} aria-label="بستن"><X/></button>
          <h2 id="snooze-title">یادآوری در آینده</h2>
          <p>تیکت در زمان انتخاب‌شده با حفظ مسئول فعلی به صف عملیاتی بازمی‌گردد.</p>
          <div className="quick-times">
            <button type="button" onClick={() => quickSnooze(30)}>۳۰ دقیقه دیگر</button>
            <button type="button" onClick={() => quickSnooze(120)}>۲ ساعت دیگر</button>
            <button type="button" onClick={() => quickSnooze(24 * 60)}>فردا شروع کاری</button>
            <button type="button" onClick={() => quickSnooze(48 * 60)}>اولین روز کاری بعد</button>
          </div>
          <label>تاریخ و ساعت بازگشت<input type="datetime-local" value={snoozeDialog.until} min={new Date().toISOString().slice(0,16)} onChange={e => setSnoozeDialog(v => ({ ...v, until: e.target.value }))} required/></label>
          <label>علت (اختیاری)<textarea maxLength="500" value={snoozeDialog.reason} onChange={e => setSnoozeDialog(v => ({ ...v, reason: e.target.value }))}/></label>
          <button className="portal-primary">ثبت یادآوری</button>
        </form>
      </div>}
      {salesDialog && <div className="support-modal-backdrop" role="presentation">
        <form className="support-operation-modal sales-escalation-modal" onSubmit={submitSalesEscalation} role="dialog" aria-modal="true" aria-labelledby="sales-escalation-title">
          <button type="button" className="agent-modal-close" onClick={() => setSalesDialog(null)} aria-label="بستن"><X/></button>
          <h2 id="sales-escalation-title">ارجاع رسمی به ادمین فروشگاه</h2>
          <p>این ارجاع به‌صورت یک تیکت مستقل همراه با مشتری، سفارش، مهلت SLA و تاریخچه کامل ثبت می‌شود.</p>
          <label>نوع مشکل<select value={salesDialog.category} onChange={e => setSalesDialog(v => ({ ...v, category: e.target.value }))}>
            <option value="store_support">هماهنگی خدمات</option><option value="order">درخواست و سفارش</option><option value="payment">پیشنهاد و پرداخت</option><option value="service">خدمت سازمانی</option><option value="contract">قرارداد</option><option value="technical">موضوع فنی</option>
          </select></label>
          <label>سفارش مرتبط<select value={salesDialog.orderId} onChange={e => setSalesDialog(v => ({ ...v, orderId: e.target.value }))}>
            <option value="">بدون سفارش مشخص</option>{thread?.orders?.map(order => <option key={order.id} value={order.id}>{order.order_no} · {status(order.status)}</option>)}
          </select></label>
          <label>اولویت<select value={salesDialog.priority} onChange={e => setSalesDialog(v => ({ ...v, priority: e.target.value }))}>
            <option value="normal">عادی</option><option value="high">زیاد</option><option value="critical">بحرانی</option>
          </select></label>
          <label>شرح و اقدام موردنیاز<textarea minLength="10" maxLength="3000" value={salesDialog.summary} onChange={e => setSalesDialog(v => ({ ...v, summary: e.target.value }))} required/></label>
          <button className="portal-primary"><ShoppingBag/> ایجاد تیکت فروشگاه</button>
        </form>
      </div>}
    </main>
  </div>;
}
