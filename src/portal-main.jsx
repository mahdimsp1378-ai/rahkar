import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity, Check, ChevronLeft, Eye, EyeOff, KeyRound, LockKeyhole, LogOut,
  PauseCircle, Pencil, Plus, ShieldCheck, ShoppingBag, Trash2, UserCog,
  UserRound, UsersRound, X,
} from 'lucide-react';
import '@fontsource-variable/vazirmatn';
import { AdminPage, SupportAdminPage } from './account.jsx';
import { SalesAdminPage } from './sales-admin.jsx';
import { api, getToken, setToken } from './api.js';
import aronageLogo from './assets/brand/rahkar-logo.svg';
import './portal.css';

const portalPath = window.location.pathname.toLowerCase();
const portal = portalPath.includes('support') ? 'support' : portalPath.includes('sales') ? 'sales' : 'admin';
const portalTitle = portal === 'admin' ? 'مرکز کنترل مدیر اصلی' : portal === 'support' ? 'سامانه پشتیبانی' : 'سامانه مدیریت خدمات';

function Login({ onLogin }) {
  const [form, setForm] = useState({ username: '', password: '' });
  const [mfa, setMfa] = useState(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const submit = async event => {
    event.preventDefault(); setLoading(true); setError('');
    try {
      const result = mfa
        ? await api('/portal-auth/verify-mfa', { method: 'POST', body: { challengeId:mfa.challengeId, code } })
        : await api('/portal-auth/login', { method: 'POST', body: { portal, ...form } });
      if (result.mfaRequired) {
        setMfa(result); setCode('');
        return;
      }
      setToken(result.token); onLogin(result.user);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };
  return <main className="portal-auth-page">
    <section className="portal-auth-brand">
      <img src={aronageLogo} alt="راهکار"/>
      <span>{portal === 'admin' ? <ShieldCheck/> : <UserRound/>}{portalTitle}</span>
      <h1>{portal === 'admin' ? 'فرماندهی سامانه‌های راهکار' : portal === 'support' ? 'گفتگوها، منظم و پاسخ‌گو' : 'خدمات، درخواست‌ها و قراردادها؛ یکپارچه'}</h1>
      <p>{portal === 'admin' ? 'مدیریت کاربران، دسترسی‌ها، سفارش‌ها و سامانه‌های مستقل از یک مرکز امن.' : portal === 'support' ? 'صف گفتگوها، تخصیص مشتری و پاسخ‌گویی در محیطی مستقل از سایت اصلی.' : 'مدیریت خدمات سازمانی، درخواست‌ها، پیشنهادها، پرداخت‌ها و ارتباط با مشتریان در یک سامانه مستقل.'}</p>
    </section>
    <section className="portal-auth-form">
      <form onSubmit={submit}>
        <div className="portal-auth-icon"><LockKeyhole/></div>
        <small>ورود امن</small><h2>{portalTitle}</h2>
        <p>{mfa ? `کد ۶ رقمی ارسال‌شده به ${mfa.maskedMobile} را وارد کنید.` : 'نام کاربری و رمز اختصاصی این سامانه را وارد کنید.'}</p>
        {error && <div className="portal-auth-error">{error}</div>}
        {!mfa ? <>
          <label>نام کاربری<div><UserRound/><input autoFocus dir="ltr" autoComplete="username" value={form.username} onChange={e => setForm({...form, username:e.target.value})} required/></div></label>
          <label>رمز عبور<div><KeyRound/><input dir="ltr" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={form.password} onChange={e => setForm({...form, password:e.target.value})} required/><button className="password-eye" type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'مخفی‌کردن رمز' : 'نمایش رمز'}>{showPassword ? <EyeOff/> : <Eye/>}</button></div></label>
        </> : <label>کد امنیتی<div><ShieldCheck/><input autoFocus dir="ltr" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength="6" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))} required/></div></label>}
        <button disabled={loading}>{loading ? 'در حال بررسی…' : mfa ? 'تأیید و ورود' : 'ورود به سامانه'}</button>
        {mfa && <button type="button" className="portal-auth-back" onClick={()=>{setMfa(null);setCode('');setError('')}}>بازگشت و ورود دوباره</button>}
      </form>
    </section>
  </main>;
}

function ChangeCredentials({ user, onDone }) {
  const [form, setForm] = useState({ currentPassword:'', username:user.username || '', password:'', repeat:'' });
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const passwordField = (key, label) => <label>{label}<div><input dir="ltr" type={showPassword?'text':'password'} minLength={key==='currentPassword'?8:10} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})} required/><button className="password-eye" type="button" onClick={()=>setShowPassword(value=>!value)} aria-label={showPassword?'مخفی‌کردن رمز':'نمایش رمز'}>{showPassword?<EyeOff/>:<Eye/>}</button></div></label>;
  const submit = async event => {
    event.preventDefault(); setError('');
    if (form.password !== form.repeat) return setError('تکرار رمز عبور با رمز جدید یکسان نیست.');
    try {
      await api('/portal-auth/credentials', { method:'PUT', body: { currentPassword:form.currentPassword, username:form.username, password:form.password } });
      onDone({...user, username:form.username, mustChangeCredentials:false});
    } catch (err) { setError(err.message); }
  };
  return <main className="credential-page"><form onSubmit={submit}>
    <span><ShieldCheck/></span><small>مرحله امنیتی الزامی</small><h1>اطلاعات ورود را تغییر دهید</h1>
    <p>این ورود اولیه است. قبل از دسترسی به سامانه، نام کاربری و رمز موقت را با اطلاعات اختصاصی خودتان جایگزین کنید.</p>
    {error && <div className="portal-auth-error">{error}</div>}
    {passwordField('currentPassword','رمز موقت فعلی')}
    <label>نام کاربری جدید<input dir="ltr" value={form.username} onChange={e=>setForm({...form,username:e.target.value})} pattern="[A-Za-z][A-Za-z0-9._-]{3,39}" required/></label>
    {passwordField('password','رمز عبور جدید')}
    {passwordField('repeat','تکرار رمز جدید')}
    <small className="password-guide">حداقل ۱۰ نویسه شامل حروف بزرگ، کوچک، عدد و نماد</small>
    <button>ثبت و ورود به سامانه</button>
  </form></main>;
}

function AdminSalesManagers({ navigate }) {
  const permissionLabels={
    'products.view':'مشاهده خدمات','products.create':'ایجاد خدمت','products.update':'ویرایش خدمت',
    'products.archive':'بایگانی خدمت','products.restore':'بازگردانی خدمت',
    'inventory.view':'مشاهده ظرفیت ارائه','inventory.manage':'مدیریت ظرفیت ارائه',
    'orders.view':'مشاهده درخواست‌ها','orders.manage':'مدیریت درخواست‌ها',
    'customers.view':'مشاهده سازمان‌ها','discounts.manage':'مدیریت پیشنهادها',
    'services.view':'مشاهده خدمات تخصصی','services.manage':'مدیریت خدمات تخصصی',
    'support-tickets.view':'مشاهده تیکت‌های ارجاعی','support-tickets.manage':'رسیدگی به تیکت‌های ارجاعی',
    'payments.view':'مشاهده پرداخت','refunds.manage':'مدیریت بازپرداخت',
    'reports.view':'مشاهده گزارش','reports.export':'خروجی گزارش',
    'settings.manage':'تنظیمات فروش',
  };
  const defaultPermissions=Object.fromEntries(Object.keys(permissionLabels).map(key=>[key,!['refunds.manage','settings.manage'].includes(key)]));
  const [rows,setRows]=useState([]),[form,setForm]=useState({mobile:'',fullName:'',username:'',temporaryPassword:'',permissions:defaultPermissions}),[editing,setEditing]=useState(null),[show,setShow]=useState(false),[notice,setNotice]=useState('');
  const[activity,setActivity]=useState(null);
  const load=()=>api('/admin/sales-managers').then(setRows).catch(()=>{});
  useEffect(()=>{load()},[]);
  const create=async e=>{e.preventDefault();try{const result=await api('/admin/sales-managers',{method:'POST',body:form});setForm({mobile:'',fullName:'',username:'',temporaryPassword:'',permissions:defaultPermissions});setNotice(result.smsSent?'مدیر فروش ساخته شد و مشخصات ورود اول به شماره ثبت‌شده پیامک شد.':(result.smsWarning||'مدیر فروش ساخته شد، اما پیامک ارسال نشد.'));await load()}catch(err){setNotice(err.message)}};
  const save=async e=>{e.preventDefault();try{const result=await api(`/admin/sales-managers/${editing.id}`,{method:'PATCH',body:{fullName:editing.full_name,email:editing.email||null,mobile:editing.mobile,username:editing.username,permissions:editing.permissions,...(editing.password?{password:editing.password}:{})}});setNotice(result.smsSent===true?'اطلاعات مدیر فروش ذخیره و مشخصات ورود جدید پیامک شد.':(result.smsWarning||'اطلاعات مدیر فروش ذخیره شد.'));setEditing(null);await load()}catch(err){setNotice(err.message)}};
  const toggle=async row=>{await api(`/admin/sales-managers/${row.id}`,{method:'PATCH',body:{status:row.status==='active'?'suspended':'active'}});await load()};
  const softDelete=async row=>{if(!confirm(`حساب ${row.full_name} به‌صورت منطقی حذف و نشست‌ها خاتمه یابد؟`))return;await api(`/admin/sales-managers/${row.id}`,{method:'PATCH',body:{softDelete:true,revokeSessions:true}});await load()};
  const showActivity=async row=>setActivity({row,...await api(`/admin/sales-managers/${row.id}/activity`)});
  const permissions=(value,setter)=><div className="permission-checks sales-permission-checks">{Object.entries(permissionLabels).map(([key,label])=><label key={key}><input type="checkbox" checked={Boolean(value[key])} onChange={e=>setter({...value,[key]:e.target.checked})}/><span><Check/>{label}</span></label>)}</div>;
  return <section className="portal-card admin-section-control sales-manager-section" dir="rtl">
    <div className="admin-section-head">
      <div><span><ShoppingBag/></span><div><small>سامانه مستقل شماره ۲</small><h2>مدیریت خدمات و مدیران فروش</h2><p>تعریف مدیر، تعیین سطح دسترسی و کنترل درخواست‌های خدمات سازمانی</p></div></div>
      <button className="portal-primary compact" onClick={() => navigate('/admin/sales')}>ورود به سامانه مدیریت خدمات <ChevronLeft/></button>
    </div>
    {notice && <div className="sales-manager-notice">{notice}</div>}
    <div className="support-team-grid">
      <form className="portal-form support-agent-form" onSubmit={create}>
        <h3><UserCog/> تعریف مدیر فروش</h3>
        <div className="form-grid">
          <label>نام و نام خانوادگی<input value={form.fullName} onChange={e=>setForm({...form,fullName:e.target.value})} required/></label>
          <label>شماره همراه<input dir="ltr" inputMode="tel" placeholder="09121234567" value={form.mobile} onChange={e=>setForm({...form,mobile:e.target.value})} required/></label>
          <label>نام کاربری<input dir="ltr" placeholder="sales.name" pattern="[A-Za-z][A-Za-z0-9._-]{3,39}" value={form.username} onChange={e=>setForm({...form,username:e.target.value})} required/></label>
          <label>رمز عبور<div className="sales-password-field"><input dir="ltr" type={show?'text':'password'} minLength="10" placeholder="حداقل ۱۰ نویسه" value={form.temporaryPassword} onChange={e=>setForm({...form,temporaryPassword:e.target.value})} required/><button type="button" onClick={()=>setShow(!show)} aria-label={show?'مخفی‌کردن رمز':'نمایش رمز'}>{show?<EyeOff/>:<Eye/>}</button></div></label>
        </div>
        <fieldset><legend>سطح دسترسی</legend>{permissions(form.permissions,value=>setForm({...form,permissions:value}))}</fieldset>
        <button className="portal-primary"><Plus/> ایجاد حساب مدیر فروش</button>
      </form>
      <div className="support-team-list sales-manager-list">
        <h3><UsersRound/> مدیران فروش تعریف‌شده</h3>
        {rows.length ? rows.map(row=><article key={row.id}>
          <span className={`agent-avatar ${row.status}`}>{(row.full_name||'م').slice(0,1)}</span>
          <div><b>{row.full_name||'مدیر فروش راهکار'} {row.online?<i className="online-dot" title="آنلاین"/>:null}</b><small dir="ltr">{row.username} · {row.mobile}</small><div>{Object.entries(row.permissions||{}).filter(([,enabled])=>enabled).map(([key])=><em key={key}>{permissionLabels[key]||key}</em>)}</div></div>
          <div className="agent-row-actions sales-manager-actions">
            <button className="edit-soft" onClick={()=>setEditing({...row,permissions:{...defaultPermissions,...row.permissions},password:''})}><Pencil/>ویرایش</button>
            <button className="edit-soft" onClick={()=>showActivity(row)}><Activity/>فعالیت</button>
            <button className={row.status==='active'?'danger-soft':'success-soft'} onClick={()=>toggle(row)}><PauseCircle/>{row.status==='active'?'تعلیق':'فعال‌سازی'}</button>
            <button className="danger-soft" onClick={()=>softDelete(row)}><Trash2/>حذف منطقی</button>
          </div>
        </article>) : <div className="sales-manager-empty"><UsersRound/><b>هنوز مدیر فروشی تعریف نشده</b><small>اولین حساب مدیر فروش را از فرم کناری ایجاد کنید.</small></div>}
      </div>
    </div>
    {editing&&<div className="agent-credential-backdrop"><form onSubmit={save}><button type="button" className="agent-modal-close" onClick={()=>setEditing(null)}><X/></button><Pencil/><h2>ویرایش مدیر فروش</h2><label>نام کامل<input value={editing.full_name||''} onChange={e=>setEditing({...editing,full_name:e.target.value})}/></label><label>ایمیل<input type="email" value={editing.email||''} onChange={e=>setEditing({...editing,email:e.target.value})}/></label><label>موبایل<input dir="ltr" value={editing.mobile} onChange={e=>setEditing({...editing,mobile:e.target.value})}/></label><label>نام کاربری<input dir="ltr" value={editing.username} onChange={e=>setEditing({...editing,username:e.target.value})}/></label><label>رمز جدید<input dir="ltr" type={show?'text':'password'} value={editing.password} onChange={e=>setEditing({...editing,password:e.target.value})}/></label><fieldset><legend>سطح دسترسی</legend>{permissions(editing.permissions,value=>setEditing({...editing,permissions:value}))}</fieldset><button>ذخیره</button></form></div>}
    {activity&&<div className="agent-credential-backdrop"><section className="manager-activity"><button className="agent-modal-close" onClick={()=>setActivity(null)}><X/></button><h2>فعالیت‌های {activity.row.full_name}</h2><p>نشست فعال: {activity.sessions.length} · رویداد ثبت‌شده: {activity.events.length}</p>{activity.events.slice(0,30).map(event=><div key={event.id}><b>{event.action}</b><small>{new Date(event.created_at).toLocaleString('fa-IR')}</small></div>)}</section></div>}
  </section>;
}

function PortalApp() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));
  useEffect(() => {
    if (!getToken()) return;
    api('/me').then(result => {
      const allowed = portal === 'admin' ? result.role === 'super_admin' : portal === 'support' ? result.role === 'support_agent' : result.role === 'sales_manager';
      if (!allowed) throw new Error('role');
      setUser(result);
    }).catch(() => setToken(null)).finally(() => setLoading(false));
  }, []);
  const navigate = path => {
    if (path === '/auth/login' || path === '/') { setToken(null); setUser(null); return; }
    if (path === '/admin/support') { window.location.href = import.meta.env.VITE_SUPPORT_URL || '/support.html'; return; }
    if (path === '/admin/sales') { window.location.href = import.meta.env.VITE_SALES_URL || '/sales.html'; return; }
    if (path === '/admin') { window.location.href = import.meta.env.VITE_ADMIN_URL || '/admin.html'; }
  };
  const logout = async () => {
    try { await api('/auth/logout', { method:'POST' }); } catch {}
    setToken(null); setUser(null);
  };
  if (loading) return <div className="portal-boot">در حال بررسی دسترسی…</div>;
  if (!user) return <Login onLogin={setUser}/>;
  if (user.mustChangeCredentials) {
    return <ChangeCredentials user={user} onDone={setUser}/>;
  }
  return <><button className="portal-global-logout" onClick={logout}><LogOut/> خروج از سامانه</button>{portal === 'admin' ? <AdminPage navigate={navigate} salesManagers={<AdminSalesManagers navigate={navigate}/>}/> : portal === 'support' ? <SupportAdminPage navigate={navigate}/> : <SalesAdminPage user={user}/>}</>;
}

createRoot(document.getElementById('root')).render(<PortalApp/>);
