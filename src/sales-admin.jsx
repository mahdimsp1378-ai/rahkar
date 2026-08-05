import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive, BarChart3, Bell, Boxes, ChevronLeft, CircleDollarSign, CreditCard,
  Download, FileSpreadsheet, FileText, ImagePlus, LayoutDashboard, MapPin, Package,
  Pencil, Plus, RefreshCw, RotateCcw, Search, Send, Settings, ShieldCheck,
  ShoppingCart, Tag, Truck, TriangleAlert, Upload, UserRound, UsersRound, X,
  ScanBarcode, Printer,
} from 'lucide-react';
import { api, getToken } from './api';
import aronageLogo from './assets/brand/rahkar-logo.svg';
import './sales-admin.css';

const fa=value=>Number(value||0).toLocaleString('fa-IR');
const money=value=>`${fa(Math.round(Number(value||0)))} ریال`;
const percent=value=>`${Number(value||0).toLocaleString('fa-IR',{maximumFractionDigits:1})}٪`;
const date=value=>value?new Intl.DateTimeFormat('fa-IR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'—';
const labels={
  awaiting_payment:'در انتظار پرداخت',paid:'پرداخت‌شده',reviewing:'در حال بررسی',
  confirmed:'تأییدشده',processing:'آماده‌سازی',preparing:'در حال آماده‌سازی',
  ready_to_ship:'آماده ارسال',shipped:'ارسال‌شده',delivered:'تحویل‌شده',
  cancelled:'لغوشده',return_requested:'درخواست مرجوعی',returned:'مرجوع‌شده',
  refund_requested:'درخواست بازپرداخت',refunded:'بازپرداخت‌شده',
  draft:'پیش‌نویس',published:'منتشرشده',active:'فعال',suspended:'تعلیق‌شده',
  archived:'بایگانی‌شده',requested:'درخواست‌شده',approved:'تأییدشده',
  rejected:'ردشده',received:'دریافت‌شده',closed:'بسته',pending:'در انتظار',
  new:'جدید',resolved:'حل‌شده',
  failed:'ناموفق',gateway_disabled:'درگاه غیرفعال',redirect_ready:'آماده انتقال',
  processed:'پردازش‌شده',
  submitted:'ثبت‌شده',needs_information:'نیازمند تکمیل اطلاعات',
  in_progress:'در حال انجام',completed:'تحویل‌شده',
};
const engineeringServiceLabels={
  potential_assessment:'پتانسیل‌سنجی',site_plan:'سایت‌پلن',feasibility_study:'طرح توجیهی',
};
const blankProduct={
  name:'',subtitle:'',sku:'',productCode:'',internalBarcode:'',factoryBarcode:'',
  hasFactoryBarcode:false,slug:'',category:'',categoryId:'',
  subcategory:'',brand:'راهکار',brandId:'',shortDescription:'',description:'',productType:'service',unit:'پروژه',
  price:0,purchasePrice:0,inboundShippingCost:0,packagingCost:0,additionalCost:0,
  unitCost:0,salePrice:null,saleStartsAt:'',saleEndsAt:'',taxRate:0,comparePrice:null,
  stock:0,inventoryReason:'',lowStockThreshold:0,imageUrl:'',
  status:'draft',featured:false,seoTitle:'',seoDescription:'',socialImageUrl:'',
  tags:[],specifications:{},
};
const tabs=[
  ['dashboard',LayoutDashboard,'داشبورد درخواست‌ها و فروش','reports.view'],
  ['products',Boxes,'خدمات فروشگاه','products.view'],
  ['catalog',Tag,'دسته‌بندی خدمات','products.view'],
  ['orders',ShoppingCart,'درخواست‌ها و سفارش‌ها','orders.view'],
  ['support-tickets',Bell,'ارجاعات پشتیبانی','support-tickets.view'],
  ['payments',CreditCard,'پیشنهادها و پرداخت‌ها','payments.view'],
  ['customers',UsersRound,'سازمان‌ها و مشتریان','customers.view'],
  ['reports',BarChart3,'گزارش‌ها','reports.view'],
  ['notifications',Bell,'اعلان‌ها',null],
  ['profile',UserRound,'پروفایل مدیر',null],
  ['sessions',ShieldCheck,'نشست‌های فعال',null],
];
const mapProduct=row=>({
  ...row,subtitle:row.subtitle||'',shortDescription:row.short_description||'',
  productCode:row.product_code||'',internalBarcode:row.internal_barcode||'',
  factoryBarcode:row.barcode||'',hasFactoryBarcode:Boolean(row.barcode),
  categoryId:row.category_id||'',brandId:row.brand_id||'',unit:row.unit||'عدد',
  productType:row.product_type||'physical',salePrice:row.sale_price,
  saleStartsAt:row.sale_starts_at||'',saleEndsAt:row.sale_ends_at||'',
  taxRate:row.tax_rate||0,comparePrice:row.compare_price,
  purchasePrice:row.purchase_price||0,inboundShippingCost:row.inbound_shipping_cost||0,
  packagingCost:row.packaging_cost||0,additionalCost:row.additional_cost||0,
  unitCost:row.unit_cost||0,lowStockThreshold:row.low_stock_threshold||0,
  imageUrl:row.image_url||'',seoTitle:row.seo_title||'',
  seoDescription:row.seo_description||'',socialImageUrl:row.social_image_url||'',
  featured:Boolean(row.featured),inventoryReason:'',
  tagsText:Array.isArray(row.tags)?row.tags.join('، '):'',
  specificationsText:row.specifications&&typeof row.specifications==='object'
    ?Object.entries(row.specifications).map(([key,value])=>`${key}: ${value}`).join('\n'):'',
});
const download=async(path,name)=>{
  const base=String(import.meta.env.VITE_API_URL||'').replace(/\/$/,'');
  const csrfToken=document.cookie.split('; ').find(part=>part.startsWith('aronage_csrf='))?.split('=').slice(1).join('=')||'';
  const response=await fetch(`${base}/api${path}`,{
    credentials:'include',
    headers:csrfToken?{'X-CSRF-Token':decodeURIComponent(csrfToken)}:{},
  });
  if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||'ساخت خروجی ممکن نشد.')}
  const url=URL.createObjectURL(await response.blob()),anchor=document.createElement('a');
  anchor.href=url;anchor.download=name;anchor.click();URL.revokeObjectURL(url);
};

function Empty({text='داده‌ای برای نمایش وجود ندارد.'}){return <div className="sales-empty"><Boxes/><b>{text}</b><small>فیلترها را تغییر دهید یا داده جدید ثبت کنید.</small></div>}
function Loading(){return <div className="sales-skeleton" aria-label="در حال بارگذاری"><i/><i/><i/><i/></div>}
function Status({value}){return <span className={`sales-status ${value}`}>{labels[value]||value||'—'}</span>}
function Pager({pagination,onPage}){if(!pagination||pagination.pages<=1)return null;return <div className="sales-pager"><button disabled={pagination.page<=1} onClick={()=>onPage(pagination.page-1)}>قبلی</button><span>صفحه {fa(pagination.page)} از {fa(pagination.pages)}</span><button disabled={pagination.page>=pagination.pages} onClick={()=>onPage(pagination.page+1)}>بعدی</button></div>}

function MiniLine({rows=[]}){
  const max=Math.max(1,...rows.map(row=>Number(row.net||0)));
  const points=rows.map((row,index)=>`${rows.length===1?50:index/(rows.length-1)*100},${54-Number(row.net||0)/max*48}`).join(' ');
  return <div className="sales-chart" role="img" aria-label="روند فروش خالص">
    <svg viewBox="0 0 100 60" preserveAspectRatio="none"><path d="M0 55H100"/><polyline points={points}/></svg>
    <div>{rows.map(row=><span key={row.date}><i style={{height:`${Math.max(4,Number(row.net||0)/max*100)}%`}}/><small>{row.date.slice(5)}</small></span>)}</div>
  </div>
}

function Dashboard({data,filters,setFilters,refresh,loading}){
  if(loading&&!data)return <Loading/>;if(!data)return <Empty/>;
  const k=data.kpis||{},orders=data.orders||{},customers=data.customers||{};
  const cards=[
    ['فروش ناخالص',k.grossSales,CircleDollarSign,'money'],['تخفیف اعطاشده',k.discountGranted,Tag,'money'],
    ['فروش خالص',k.netSales,BarChart3,'money'],['درآمد وصول‌شده',k.collectedRevenue,CreditCard,'money'],
    ['مطالبات',k.receivables,TriangleAlert,'money'],['بازپرداخت',k.refundedAmount,RotateCcw,'money'],
    ['سود ناخالص',k.grossProfit,CircleDollarSign,'money'],['حاشیه سود',k.margin,BarChart3,'percent'],
    ['میانگین سفارش',k.averageOrderValue,ShoppingCart,'money'],['ارزش موجودی',k.inventoryValue,Boxes,'money'],
  ];
  return <>
    <section className="sales-filterbar">
      <label>از<input type="date" value={filters.from} onChange={e=>setFilters({...filters,from:e.target.value})}/></label>
      <label>تا<input type="date" value={filters.to} onChange={e=>setFilters({...filters,to:e.target.value})}/></label>
      <label>وضعیت<select value={filters.status} onChange={e=>setFilters({...filters,status:e.target.value})}><option value="">همه سفارش‌ها</option>{Object.entries(labels).filter(([key])=>['awaiting_payment','paid','preparing','shipped','delivered','cancelled','returned','refunded'].includes(key)).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label>نوع مشتری<select value={filters.customerType} onChange={e=>setFilters({...filters,customerType:e.target.value})}><option value="">همه مشتریان</option><option value="individual">حقیقی</option><option value="legal">حقوقی</option></select></label>
      <button onClick={refresh} disabled={loading}><RefreshCw className={loading?'spin':''}/>{loading?'در حال محاسبه…':'به‌روزرسانی'}</button>
    </section>
    <section className="sales-kpis">{cards.map(([title,value,Icon,type])=><article key={title}><Icon/><small>{title}</small><b>{type==='percent'?percent(value):money(value)}</b></article>)}</section>
    <section className="sales-analytics-grid">
      <article className="sales-card chart-card"><div className="card-head"><div><h3>روند فروش خالص</h3><p>همه نمودارها از فیلتر مشترک بالا استفاده می‌کنند.</p></div></div><MiniLine rows={data.charts?.daily}/></article>
      <article className="sales-card"><h3>سلامت سفارش‌ها</h3><div className="metric-list"><span>کل سفارش‌ها<b>{fa(orders.total)}</b></span><span>نرخ پرداخت موفق<b>{percent(orders.paymentSuccessRate)}</b></span><span>نرخ لغو<b>{percent(orders.cancellationRate)}</b></span><span>نرخ مرجوعی<b>{percent(orders.returnRate)}</b></span></div></article>
      <article className="sales-card"><h3>شاخص مشتری</h3><div className="metric-list"><span>کل مشتریان<b>{fa(customers.total)}</b></span><span>خریدار در بازه<b>{fa(customers.inRange)}</b></span><span>تکرارشونده<b>{fa(customers.repeat)}</b></span><span>نرخ خرید مجدد<b>{percent(customers.repeatRate)}</b></span></div></article>
    </section>
    <section className="sales-analytics-grid">
      <article className="sales-card"><h3>محصولات پرفروش</h3>{data.tables?.topProducts?.length?data.tables.topProducts.map(row=><div className="rank-row" key={row.productId}><span><b>{row.name}</b><small>{fa(row.quantity)} عدد</small></span><strong>{money(row.revenue)}</strong></div>):<Empty/>}</article>
      <article className="sales-card"><h3>هشدارها</h3>{data.alerts?.length?data.alerts.slice(0,12).map((row,index)=><div className={`alert-row ${row.type}`} key={`${row.code}-${index}`}><TriangleAlert/><span>{row.message}</span></div>):<Empty text="هشداری برای این بازه وجود ندارد."/ >}</article>
    </section>
  </>;
}

function Products({data,query,setQuery,page,setPage,reload,onEdit,onNew,onArchive,onRestore,can}){
  const rows=data?.items||[];
  return <section className="sales-card"><div className="card-head"><div><h3>کاتالوگ خدمات راهکار</h3><p>خدمات هوشمندسازی، سامانه‌های اختصاصی و داشبوردهای مدیریتی را از اینجا مدیریت کنید.</p></div>{can('products.create')&&<button onClick={onNew}><Plus/>خدمت جدید</button>}</div>
    <label className="sales-inline-search"><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="نام خدمت، کد یا دسته‌بندی…"/></label>
    <div className="sales-table products"><div><b>خدمت</b><b>کد خدمت / SKU</b><b>برآورد اولیه</b><b>نوع ارائه</b><b>وضعیت</b><b>عملیات</b></div>{rows.map(row=><div key={row.id}><span><b>{row.name}</b><small>{row.category||'خدمات سازمانی'}</small></span><code>{row.product_code||row.sku}</code><span>{Number(row.sale_price??row.price)>0?money(row.sale_price??row.price):'پس از نیازسنجی'}</span><span>پروژه اختصاصی</span><Status value={row.status}/><span className="row-actions">{can('products.update')&&<button onClick={()=>onEdit(row)} aria-label={`ویرایش ${row.name}`}><Pencil/></button>}{row.status==='archived'?can('products.restore')&&<button onClick={()=>onRestore(row)}><RotateCcw/></button>:can('products.archive')&&<button className="danger" onClick={()=>onArchive(row)}><Archive/></button>}</span></div>)}</div>
    {!rows.length&&<Empty/>}<Pager pagination={data?.pagination} onPage={setPage}/>
  </section>;
}

function ProductForm({value,setValue,onClose,onSave,onAddVariant,onBarcode,catalog,loading,error}){
  const[files,setFiles]=useState([]),[variant,setVariant]=useState({name:'',price:'',costPrice:'',stock:0,status:'active',optionsText:'',factoryBarcode:''});
  const numberField=(key,label)=><label>{label}<input type="number" min="0" value={value[key]??''} onChange={e=>setValue({...value,[key]:Number(e.target.value)})}/></label>;
  const categories=(catalog?.categories||[]).filter(row=>row.status==='active');
  const brands=(catalog?.brands||[]).filter(row=>row.status==='active');
  const units=Array.isArray(catalog?.settings?.units)?catalog.settings.units:['عدد','بسته','متر','کیلوگرم'];
  const selectedCategory=categories.find(row=>row.id===value.categoryId);
  const autoUnitCost=Number(value.purchasePrice||0)+Number(value.inboundShippingCost||0)+Number(value.packagingCost||0)+Number(value.additionalCost||0);
  const effectivePrice=Number(value.salePrice??value.price??0),gross=Math.max(0,effectivePrice-autoUnitCost);
  const margin=effectivePrice?gross/effectivePrice*100:0;
  const tier=effectivePrice<50000000?'اقتصادی':effectivePrice<500000000?'میان‌رده':effectivePrice<5000000000?'حرفه‌ای':'سازمانی';
  const addVariant=async()=>{await onAddVariant(value.id,{...variant,price:variant.price===''?null:Number(variant.price),costPrice:variant.costPrice===''?null:Number(variant.costPrice),stock:Number(variant.stock),generateBarcode:!variant.factoryBarcode,factoryBarcode:variant.factoryBarcode||undefined,options:variant.optionsText.split('\n').filter(Boolean).map(line=>{const[name,...rest]=line.split(':');return{name:name.trim(),value:rest.join(':').trim()}})});setVariant({name:'',price:'',costPrice:'',stock:0,status:'active',optionsText:'',factoryBarcode:''})};
  return <div className="sales-modal"><form className="product-editor" onSubmit={event=>onSave(event,files,event.nativeEvent.submitter?.value||value.status)}><button type="button" className="close" onClick={onClose}><X/></button><small>{value.id?'ویرایش خدمت':'خدمت جدید'}</small><h2>تعریف خدمت سازمانی</h2>
    {error&&<div className="product-form-error" role="alert"><TriangleAlert/><span><b>ذخیره انجام نشد</b><small>{error}</small></span></div>}
    <fieldset><legend>اطلاعات پایه</legend><div className="form-grid"><label>نام خدمت<input value={value.name||''} onChange={e=>setValue({...value,name:e.target.value})} required/></label><label>عنوان کوتاه<input value={value.subtitle||''} onChange={e=>setValue({...value,subtitle:e.target.value})}/></label><label>دسته‌بندی<select value={value.categoryId||''} onChange={e=>{const row=categories.find(item=>item.id===e.target.value);setValue({...value,categoryId:e.target.value,category:row?.name||''})}} required><option value="">انتخاب دسته…</option>{categories.map(row=><option key={row.id} value={row.id}>{row.parent_id?'↳ ':''}{row.name} — {row.code}</option>)}</select></label><label>واحد ارائه<input value="پروژه اختصاصی" readOnly/></label><input type="hidden" value="service"/></div>
      <div className="auto-identity"><ScanBarcode/><div><b>شناسه‌های خودکار سامانه</b><small>پس از اولین ذخیره ساخته و ثابت می‌شوند.</small></div><code>{value.product_code||value.productCode||'کد محصول: خودکار'}<br/>{value.sku||'SKU: خودکار'}<br/>{value.slug||'Slug: خودکار'}</code></div>
      <label>برچسب‌ها — با ویرگول جدا کنید<input value={value.tagsText||''} onChange={e=>setValue({...value,tagsText:e.target.value})}/></label><label>مشخصات {selectedCategory?`«${selectedCategory.name}»`:''} — هر خط «عنوان: مقدار»<textarea rows="4" value={value.specificationsText||''} onChange={e=>setValue({...value,specificationsText:e.target.value})} placeholder={(selectedCategory?.attributes||[]).map(item=>`${item}: `).join('\n')}/></label><label>توضیح کوتاه<textarea rows="2" value={value.shortDescription||''} onChange={e=>setValue({...value,shortDescription:e.target.value})}/></label><label>توضیح کامل<textarea rows="5" value={value.description||''} onChange={e=>setValue({...value,description:e.target.value})}/></label></fieldset>
    <fieldset><legend>اطلاعات مالی — محاسبه خودکار</legend><div className="form-grid">{numberField('price','قیمت پایه (ریال)')}{numberField('salePrice','قیمت فروش (ریال)')}{numberField('purchasePrice','قیمت خرید (ریال)')}{numberField('inboundShippingCost','حمل ورودی هر واحد')}{numberField('packagingCost','بسته‌بندی هر واحد')}{numberField('additionalCost','هزینه جانبی هر واحد')}{numberField('taxRate','مالیات (درصد)')}</div><div className="calculated-strip"><span>بهای تمام‌شده<b>{money(autoUnitCost)}</b></span><span>سود ناخالص هر واحد<b>{money(gross)}</b></span><span>حاشیه سود<b>{percent(margin)}</b></span><span>رده قیمتی<b>{tier}</b></span></div></fieldset>
    <fieldset><legend>انتشار خدمت</legend><div className="form-grid"><label>وضعیت<select value={value.status} onChange={e=>setValue({...value,status:e.target.value,productType:'service',unit:'پروژه',stock:0,lowStockThreshold:0})}><option value="draft">پیش‌نویس</option><option value="published">منتشرشده</option><option value="suspended">تعلیق‌شده</option><option value="archived">بایگانی‌شده</option></select></label><label className="check"><input type="checkbox" checked={value.featured} onChange={e=>setValue({...value,featured:e.target.checked})}/> خدمت پیشنهادی</label></div></fieldset>
    <fieldset><legend>SEO و اشتراک‌گذاری</legend><div className="form-grid"><label>عنوان Meta<input value={value.seoTitle||''} onChange={e=>setValue({...value,seoTitle:e.target.value})}/></label><label>تصویر اشتراک‌گذاری<input value={value.socialImageUrl||''} onChange={e=>setValue({...value,socialImageUrl:e.target.value})}/></label></div><label>توضیح Meta<textarea rows="2" value={value.seoDescription||''} onChange={e=>setValue({...value,seoDescription:e.target.value})}/></label></fieldset>
    <fieldset><legend>تصاویر تبلیغاتی خدمت</legend>{value.images?.length?<div className="product-image-grid">{value.images.map(image=><figure key={image.id}><img src={image.url} alt={image.alt_text||value.name}/><figcaption>{image.is_primary?'تصویر اصلی':'تصویر خدمت'}</figcaption></figure>)}</div>:null}<label className="file-input"><ImagePlus/> انتخاب تصاویر JPEG، PNG، WebP یا AVIF<input type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple onChange={e=>setFiles([...e.target.files])}/><small>{files.length?`${fa(files.length)} فایل انتخاب شد`:'حداکثر ۱۲ تصویر و ۸ مگابایت برای هر فایل'}</small></label></fieldset>
    <div className="product-save-actions">
      <button type="submit" className="save secondary" value={value.status} disabled={loading}>{loading?'در حال ذخیره…':'ذخیره تغییرات'}</button>
      <button type="submit" className="save" value="published" disabled={loading}>{loading?'در حال انتشار…':'ذخیره و انتشار'}<ChevronLeft/></button>
    </div>
  </form></div>;
}

function Orders({data,onPage,onOpen}){const rows=data?.items||[];return <section className="sales-card"><div className="card-head"><div><h3>سفارش‌ها</h3><p>برای تغییر وضعیت و عملیات مالی، جزئیات سفارش را باز کنید.</p></div></div><div className="sales-table orders"><div><b>سفارش/مشتری</b><b>مبلغ</b><b>پرداخت</b><b>وضعیت</b><b>تاریخ</b></div>{rows.map(row=><button className="table-row-button" key={row.id} onClick={()=>onOpen(row.id)}><span><b>{row.order_no}</b><small>{row.full_name||row.mobile}</small></span><b>{money(row.total)}</b><Status value={row.payment_status}/><Status value={row.status}/><span>{date(row.created_at)}</span></button>)}</div>{!rows.length&&<Empty/>}<Pager pagination={data?.pagination} onPage={onPage}/></section>}

function EngineeringRequests({rows,onOpen}){
  return <section className="sales-card"><div className="card-head"><div><h3>درخواست‌های خدمات مهندسی</h3><p>پتانسیل‌سنجی، سایت‌پلن و طرح توجیهی همراه با اطلاعات مشتری و فایل نقشه.</p></div></div>
    <div className="sales-table engineering-requests"><div><b>درخواست/مشتری</b><b>خدمات</b><b>ظرفیت</b><b>مبلغ</b><b>وضعیت</b></div>{(rows||[]).map(row=><button className="table-row-button" key={row.id} onClick={()=>onOpen(row.id)}>
      <span><b>{row.request_no}</b><small>{row.client_name} · {row.client_phone}</small></span>
      <span>{row.services.map(value=>engineeringServiceLabels[value]||value).join('، ')}</span>
      <b>{fa(row.capacity_kw)} kW</b><b>{money(row.total_price)}</b><Status value={row.status}/>
    </button>)}</div>{!rows?.length&&<Empty text="درخواست خدمات مهندسی ثبت نشده است."/>}</section>
}

function EngineeringRequestDetail({data,onClose,onSave,onDownload,can}){
  const[statusValue,setStatusValue]=useState(data.status),[adminNote,setAdminNote]=useState(data.admin_note||'');
  const info=[
    ['نام کارفرما',data.client_name],['شماره تماس',data.client_phone],['استان',data.province],
    ['عنوان پروژه',data.project_title||'—'],['ظرفیت',`${fa(data.capacity_kw)} کیلووات`],
    ['مساحت زمین',data.site_area_m2?`${fa(data.site_area_m2)} مترمربع`:'—'],
    ['مالکیت زمین',data.land_ownership||'—'],['کاربری',data.project_usage||'—'],
    ['اتصال به شبکه',data.grid_connection_status||'—'],['حساب مشتری',data.account_name||data.account_mobile],
    ['شرکت',data.company||'—'],['ایمیل',data.email||'—'],
  ];
  const finance=[
    ['سرمایه‌گذاری',data.investment_amount],['آورده کارفرما',data.employer_contribution],
    ['تسهیلات',data.facility_amount],['نرخ بهره',data.interest_rate?`${data.interest_rate}٪`:null],
    ['مدت تنفس',data.grace_months!==null?`${fa(data.grace_months)} ماه`:null],
    ['بازپرداخت',data.repayment_months?`${fa(data.repayment_months)} ماه`:null],
  ].filter(([,value])=>value!==null&&value!==undefined);
  return <div className="sales-modal"><section className="order-detail engineering-request-detail"><button className="close" onClick={onClose}><X/></button><small>جزئیات کامل خدمات مهندسی</small><h2>{data.request_no}</h2>
    <div className="order-summary"><span>مبلغ کل<b>{money(data.total_price)}</b></span><span>تاریخ ثبت<b>{date(data.created_at)}</b></span><span>وضعیت<Status value={data.status}/></span><span>فایل نقشه<b>{data.map_original_name||'ارسال نشده'}</b></span></div>
    <h3>اطلاعات مشتری و پروژه</h3><div className="engineering-admin-grid">{info.map(([label,value])=><span key={label}><small>{label}</small><b>{value}</b></span>)}</div>
    <h3>خدمات و مبلغ ثبت‌شده</h3><div className="detail-items">{data.pricing_snapshot.map(item=><div key={item.service}><span><b>{item.label||engineeringServiceLabels[item.service]}</b><small>مبلغ ثبت‌شده در زمان درخواست</small></span><strong>{money(item.price)}</strong></div>)}</div>
    {finance.length?<><h3>اطلاعات مالی طرح توجیهی</h3><div className="engineering-admin-grid">{finance.map(([label,value])=><span key={label}><small>{label}</small><b>{typeof value==='number'?money(value):value}</b></span>)}</div></>:null}
    <h3>توضیحات مشتری</h3><p className="customer-service-note">{data.customer_notes||'توضیحی ثبت نشده است.'}</p>
    {data.map_original_name?<div className="engineering-map-card"><MapPin/><span><b>{data.map_original_name}</b><small>{(Number(data.map_size_bytes||0)/1024).toLocaleString('fa-IR',{maximumFractionDigits:1})} کیلوبایت · KML/KMZ</small></span><button onClick={onDownload}><Download/> دانلود فایل Google Maps</button></div>:<div className="engineering-map-card"><MapPin/><span><b>فایل نقشه ارسال نشده است</b><small>بارگذاری نقشه برای ثبت درخواست اختیاری است.</small></span></div>}
    {can('services.manage')&&<div className="operation-box"><label>وضعیت<select value={statusValue} onChange={event=>setStatusValue(event.target.value)}>{['submitted','reviewing','needs_information','in_progress','completed','rejected'].map(value=><option value={value} key={value}>{labels[value]}</option>)}</select></label><label>یادداشت ادمین<textarea rows="3" value={adminNote} onChange={event=>setAdminNote(event.target.value)}/></label><button onClick={()=>onSave(data.id,statusValue,adminNote)}>ذخیره وضعیت</button></div>}
  </section></div>;
}

function OrderDetail({data,onClose,onChange,reload,can}){
  const[status,setStatus]=useState(''),[note,setNote]=useState(''),[receipt,setReceipt]=useState(''),[shipping,setShipping]=useState({method:'پست',company:'',trackingCode:'',cost:0});
  if(!data)return <div className="sales-modal"><Loading/></div>;
  const change=async()=>{await onChange(data.id,status,note);setStatus('')};
  const confirmOffline=async payment=>{await api(`/sales/payments/${payment.id}/confirm-offline`,{method:'POST',body:{reference:receipt}});await reload()};
  const createShipment=async()=>{await api('/sales/shipments',{method:'POST',body:{orderId:data.id,...shipping}});await reload()};
  return <div className="sales-modal"><section className="order-detail"><button className="close" onClick={onClose}><X/></button><small>جزئیات سفارش</small><h2>{data.order_no}</h2><div className="order-summary"><span>مشتری<b>{data.full_name||data.mobile}</b></span><span>مبلغ نهایی<b>{money(data.total)}</b></span><span>پرداخت<Status value={data.payment_status}/></span><span>سفارش<Status value={data.status}/></span></div>
    <h3>اقلام و Snapshot قیمت</h3><div className="detail-items">{data.items.map(item=><div key={item.id}><span><b>{item.product_name}</b><small>{item.sku_snapshot} · {fa(item.quantity)} عدد</small></span><strong>{money(item.line_total)}</strong></div>)}</div>
    <h3>نشانی Snapshot</h3><p>{data.address_snapshot?`${data.address_snapshot.province}، ${data.address_snapshot.city}، ${data.address_snapshot.address}`:'—'}</p>
    {can('orders.manage')&&data.allowedTransitions?.length?<div className="operation-box"><label>انتقال مجاز<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">انتخاب وضعیت</option>{data.allowedTransitions.filter(value=>!['paid','refunded'].includes(value)).map(value=><option key={value} value={value}>{labels[value]}</option>)}</select></label><label>توضیح<input value={note} onChange={e=>setNote(e.target.value)}/></label><button disabled={!status} onClick={change}>ثبت تغییر</button></div>:null}
    {can('orders.manage')&&data.payments?.some(payment=>payment.status==='gateway_disabled')&&<div className="operation-box"><label>شناسه رسید آفلاین<input value={receipt} onChange={e=>setReceipt(e.target.value)}/></label><button disabled={receipt.length<3} onClick={()=>confirmOffline(data.payments.find(payment=>payment.status==='gateway_disabled'))}>تأیید پرداخت آفلاین</button></div>}
    {can('orders.manage')&&['paid','reviewing','confirmed','preparing','ready_to_ship','processing'].includes(data.status)&&<div className="operation-box"><label>روش ارسال<input value={shipping.method} onChange={e=>setShipping({...shipping,method:e.target.value})}/></label><label>شرکت حمل<input value={shipping.company} onChange={e=>setShipping({...shipping,company:e.target.value})}/></label><label>کد رهگیری<input value={shipping.trackingCode} onChange={e=>setShipping({...shipping,trackingCode:e.target.value})}/></label><button onClick={createShipment}><Truck/> ثبت ارسال</button></div>}
    <h3>تاریخچه</h3><div className="timeline">{data.history.map(row=><div key={row.id}><i/><span><b>{labels[row.to_status]||row.to_status}</b><small>{date(row.created_at)} · {row.manager_name||'سیستم'}</small>{row.note&&<p>{row.note}</p>}</span></div>)}</div>
  </section></div>;
}

function SimpleTable({title,children}){return <section className="sales-card"><h3>{title}</h3>{children}</section>}

function SupportSalesTickets({rows,onSave,onOpenOrder,can}){
  const[notes,setNotes]=useState({});
  return <section className="sales-card support-sales-tickets">
    <div className="card-head"><div><h3>تیکت‌های ارجاع‌شده از پشتیبانی</h3><p>مواردی که برای اقدام تخصصی فروشگاه، سفارش، پرداخت یا ارسال ارجاع شده‌اند.</p></div></div>
    {rows.length?<div className="sales-ticket-grid">{rows.map(row=>{
      const overdue=row.due_at&&new Date(row.due_at)<new Date()&&!['resolved','closed'].includes(row.status);
      return <article className={overdue?'overdue':''} key={row.id}>
        <header><span><b>{row.sales_ticket_no}</b><small>{row.support_public_no} · {date(row.created_at)}</small></span><Status value={row.status}/></header>
        <h4>{row.subject}</h4>
        <p>{row.summary}</p>
        <div><span>مشتری<b>{row.full_name||row.mobile}</b></span><span>دسته<b>{row.category}</b></span><span>مهلت<b>{date(row.due_at)}</b></span>{row.order_no&&<span>سفارش<b>{row.order_no} · {labels[row.order_status]||row.order_status}</b><small>{money(row.order_total)} · {labels[row.payment_status]||row.payment_status}</small></span>}{overdue&&<em><TriangleAlert/> از مهلت گذشته</em>}</div>
        {row.order_id&&can('orders.view')&&<button type="button" className="ticket-order-action" onClick={()=>onOpenOrder(row.order_id)}><ShoppingCart/> باز کردن سفارش مرتبط</button>}
        {can('support-tickets.manage')&&<form onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);onSave(row.id,form.get('status'),notes[row.id]||'')}}>
          <select name="status" defaultValue={row.status}><option value="new">جدید</option><option value="reviewing">در حال بررسی</option><option value="needs_information">نیازمند اطلاعات</option><option value="resolved">حل‌شده</option><option value="closed">بسته</option></select>
          <textarea rows="2" value={notes[row.id]??row.resolution_note??''} onChange={event=>setNotes(current=>({...current,[row.id]:event.target.value}))} placeholder="نتیجه بررسی یا توضیح برای کارشناس پشتیبانی…"/>
          <button><Send/>ثبت وضعیت</button>
        </form>}
      </article>;
    })}</div>:<Empty text="تیکت ارجاعی فعالی وجود ندارد."/>}
  </section>;
}

export function SalesAdminPage({user:initialUser}){
  const[tab,setTab]=useState('dashboard'),[user,setUser]=useState(initialUser),[loading,setLoading]=useState(false),[notice,setNotice]=useState('');
  const[dashboard,setDashboard]=useState(null),[products,setProducts]=useState(null),[orders,setOrders]=useState(null),[engineeringRequests,setEngineeringRequests]=useState(null);
  const[payments,setPayments]=useState(null),[customers,setCustomers]=useState(null),[discounts,setDiscounts]=useState(null),[supportTickets,setSupportTickets]=useState(null);
  const[inventory,setInventory]=useState(null),[returns,setReturns]=useState(null),[notifications,setNotifications]=useState(null),[sessions,setSessions]=useState(null),[catalog,setCatalog]=useState(null);
  const[counters,setCounters]=useState({supportTickets:0,messages:0});
  const previousCounters=useRef(null);
  const[editing,setEditing]=useState(null),[orderDetail,setOrderDetail]=useState(null),[engineeringDetail,setEngineeringDetail]=useState(null),[query,setQuery]=useState(''),[productPage,setProductPage]=useState(1),[orderPage,setOrderPage]=useState(1);
  const[filters,setFilters]=useState(()=>{const now=new Date(),from=new Date(now.getFullYear(),now.getMonth(),1);return{from:from.toISOString().slice(0,10),to:now.toISOString().slice(0,10),status:'',customerType:''}});
  const deferredQuery=useDeferredValue(query);
  const permissions=user?.permissions||initialUser?.permissions||{};
  const can=key=>initialUser?.role==='super_admin'||Boolean(permissions[key]);
  const availableTabs=tabs.filter(([, , ,permission])=>!permission||can(permission));
  const run=async task=>{setLoading(true);setNotice('');try{return await task()}catch(error){setNotice(error.message);throw error}finally{setLoading(false)}};
  const loadMe=()=>api('/me').then(value=>{setUser(value);return value});
  const refreshCounters=async(announce=false)=>{
    const next=await api('/sales/notification-counts');
    const previous=previousCounters.current;
    if(announce&&previous&&(next.supportTickets>previous.supportTickets||next.messages>previous.messages)){
      const parts=[];
      if(next.supportTickets>previous.supportTickets)parts.push(`${fa(next.supportTickets-previous.supportTickets)} تیکت ارجاعی جدید`);
      if(next.messages>previous.messages)parts.push(`${fa(next.messages-previous.messages)} پیام جدید`);
      setNotice(parts.join(' و '));
    }
    previousCounters.current=next;setCounters(next);return next;
  };
  const loadDashboard=()=>run(async()=>{const params=new URLSearchParams(Object.entries(filters).filter(([,value])=>value));setDashboard(await api(`/sales/dashboard?${params}`))});
  const loadProducts=()=>run(async()=>{
    const [productRows,catalogRows]=await Promise.all([
      api(`/sales/products?page=${productPage}&limit=25&q=${encodeURIComponent(deferredQuery)}`),
      api('/sales/catalog-settings'),
    ]);
    setProducts(productRows);setCatalog(catalogRows);
  });
  const loadOrders=()=>run(async()=>setOrders(await api(`/sales/orders?page=${orderPage}&limit=25`)));
  const loaders={
    dashboard:loadDashboard,products:loadProducts,catalog:()=>run(async()=>setCatalog(await api('/sales/catalog-settings'))),
    inventory:()=>run(async()=>setInventory(await api('/sales/inventory-movements?limit=200'))),
    orders:loadOrders,payments:()=>run(async()=>setPayments(await api('/sales/payments?page=1&limit=50'))),
    'engineering-services':()=>run(async()=>setEngineeringRequests(await api(`/sales/engineering-service-requests?q=${encodeURIComponent(deferredQuery)}`))),
    'support-tickets':()=>run(async()=>{setSupportTickets(await api(`/sales/support-tickets?q=${encodeURIComponent(deferredQuery)}`));await refreshCounters()}),
    shipping:()=>run(async()=>setReturns(await api('/sales/returns'))),
    customers:()=>run(async()=>{const result=await api(`/sales/customers?q=${encodeURIComponent(query)}&limit=100`);setCustomers(result.items||[])}),
    discounts:()=>run(async()=>setDiscounts(await api('/sales/discounts'))),
    notifications:()=>run(async()=>{setNotifications(await api('/notifications?limit=50'));await api('/notifications/read-all',{method:'POST'});previousCounters.current={...counters,messages:0};setCounters(current=>({...current,messages:0}))}),
    profile:loadMe,sessions:()=>run(async()=>setSessions(await api('/security/sessions'))),
  };
  useEffect(()=>{loadMe().catch(()=>{})},[]);
  useEffect(()=>{refreshCounters().catch(()=>{});const timer=window.setInterval(()=>refreshCounters(true).catch(()=>{}),20000);return()=>window.clearInterval(timer)},[]);
  useEffect(()=>{loaders[tab]?.().catch(()=>{})},[tab,productPage,orderPage,deferredQuery]);
  const saveProduct=async(event,files=[],intendedStatus)=>{event.preventDefault();await run(async()=>{
    const specifications=Object.fromEntries((editing.specificationsText||'').split('\n').filter(Boolean).map(line=>{const[key,...rest]=line.split(':');return[key.trim(),rest.join(':').trim()]}).filter(([key,value])=>key&&value));
    const body={
      name:String(editing.name||'').trim(),
      subtitle:String(editing.subtitle||'').trim(),
      category:String(editing.category||'').trim(),
      subcategory:String(editing.subcategory||'').trim(),
      categoryId:editing.categoryId||null,
      brandId:editing.brandId||null,
      brand:String(editing.brand||'').trim(),
      factoryBarcode:editing.hasFactoryBarcode?String(editing.factoryBarcode||'').trim():null,
      generateBarcode:!editing.hasFactoryBarcode,
      unit:String(editing.unit||'عدد'),
      shortDescription:String(editing.shortDescription||''),
      description:String(editing.description||''),
      tags:(editing.tagsText||'').split(/[،,]/).map(value=>value.trim()).filter(Boolean),
      specifications,
      status:intendedStatus||editing.status,
      featured:Boolean(editing.featured),
      productType:editing.productType||'physical',
      price:Number(editing.price),
      salePrice:editing.salePrice===''||editing.salePrice==null?null:Number(editing.salePrice),
      purchasePrice:editing.purchasePrice===''||editing.purchasePrice==null?null:Number(editing.purchasePrice),
      inboundShippingCost:Number(editing.inboundShippingCost||0),
      packagingCost:Number(editing.packagingCost||0),
      additionalCost:Number(editing.additionalCost||0),
      unitCost:Number(editing.purchasePrice||0)+Number(editing.inboundShippingCost||0)+Number(editing.packagingCost||0)+Number(editing.additionalCost||0),
      taxRate:Number(editing.taxRate||0),
      comparePrice:editing.comparePrice===''||editing.comparePrice==null?null:Number(editing.comparePrice),
      stock:Number(editing.stock),
      lowStockThreshold:Number(editing.lowStockThreshold),
      saleStartsAt:editing.saleStartsAt||null,
      saleEndsAt:editing.saleEndsAt||null,
      imageUrl:String(editing.imageUrl||''),
      seoTitle:String(editing.seoTitle||''),
      seoDescription:String(editing.seoDescription||''),
      socialImageUrl:String(editing.socialImageUrl||''),
      inventoryReason:String(editing.inventoryReason||'').trim()||undefined,
    };
    const result=await api(editing.id?`/sales/products/${editing.id}`:'/sales/products',{method:editing.id?'PUT':'POST',body});
    const productId=editing.id||result.id;
    if(files.length){const form=new FormData();files.forEach(file=>form.append('images',file));form.append('altText',editing.name);await api(`/sales/products/${productId}/images`,{method:'POST',body:form})}
    const persisted=await api(`/sales/products/${productId}/detail`);
    if(persisted.status!==body.status)throw new Error('وضعیت انتخاب‌شده در سامانه ثبت نشد؛ دوباره تلاش کنید.');
    setEditing(null);await loadProducts();
    setNotice(body.status==='published'?'محصول با موفقیت ذخیره و در فروشگاه منتشر شد.':'تغییرات محصول با موفقیت ذخیره شد.');
  })};
  const archive=async row=>{if(!confirm(`محصول «${row.name}» از فروشگاه پنهان و بایگانی شود؟`))return;await run(async()=>{await api(`/sales/products/${row.id}/archive`,{method:'PATCH',body:{reason:'بایگانی از پنل فروش'}});await loadProducts()})};
  const restore=async row=>run(async()=>{await api(`/sales/products/${row.id}/restore`,{method:'PATCH'});await loadProducts()});
  const editProduct=async row=>run(async()=>setEditing(mapProduct(await api(`/sales/products/${row.id}/detail`))));
  const addVariant=async(productId,body)=>run(async()=>{await api(`/sales/products/${productId}/variants`,{method:'POST',body});setEditing(mapProduct(await api(`/sales/products/${productId}/detail`)))});
  const getBarcode=async product=>run(async()=>download(`/sales/products/${product.id}/barcode.svg`,`${product.product_code||product.sku}-barcode.svg`));
  const openOrder=async id=>run(async()=>setOrderDetail(await api(`/sales/orders/${id}`)));
  const openEngineeringRequest=async id=>run(async()=>setEngineeringDetail(await api(`/sales/engineering-service-requests/${id}`)));
  const saveEngineeringRequest=async(id,status,adminNote)=>run(async()=>{await api(`/sales/engineering-service-requests/${id}`,{method:'PATCH',body:{status,adminNote}});setEngineeringDetail(await api(`/sales/engineering-service-requests/${id}`));setEngineeringRequests(await api(`/sales/engineering-service-requests?q=${encodeURIComponent(deferredQuery)}`));setNotice('وضعیت درخواست خدمات به‌روزرسانی شد.')});
  const saveSupportTicket=async(id,status,resolutionNote)=>run(async()=>{await api(`/sales/support-tickets/${id}`,{method:'PATCH',body:{status,resolutionNote}});setSupportTickets(await api(`/sales/support-tickets?q=${encodeURIComponent(deferredQuery)}`));await refreshCounters();setNotice('نتیجه تیکت برای کارشناس پشتیبانی ثبت شد.')});
  const reloadOrder=async()=>orderDetail&&setOrderDetail(await api(`/sales/orders/${orderDetail.id}`));
  const changeOrder=async(id,status,note)=>run(async()=>{await api(`/sales/orders/${id}`,{method:'PATCH',body:{status,note}});await reloadOrder();await loadOrders()});
  const profileSave=async event=>{event.preventDefault();const form=new FormData(event.currentTarget);await run(async()=>{await api('/me',{method:'PUT',body:{full_name:form.get('full_name'),email:form.get('email'),avatar_url:form.get('avatar_url')}});await loadMe();setNotice('پروفایل مدیر به‌روزرسانی شد.')})};
  return <div className="sales-shell">
    <aside><img src={aronageLogo} alt="راهکار"/><small>سامانه مستقل</small><h2>مدیریت خدمات</h2><nav>{availableTabs.map(([id,Icon,title])=>{const count=id==='support-tickets'?counters.supportTickets:id==='notifications'?counters.messages:0;return <button className={tab===id?'active':''} onClick={()=>setTab(id)} key={id}><Icon/><span>{title}</span>{count>0&&<em className="nav-count" aria-label={`${fa(count)} مورد جدید`}>{fa(count)} {id==='support-tickets'?'تیکت':'پیام'}</em>}</button>})}</nav><div className="sales-user">{user?.avatar_url?<img src={user.avatar_url} alt="تصویر مدیر"/>:<span>{(user?.full_name||'م خ').split(' ').map(x=>x[0]).slice(0,2).join('')}</span>}<div><b>{user?.full_name||'مدیر خدمات'}</b><small>{user?.online?'آنلاین':'آفلاین'} · {user?.status==='active'?'حساب فعال':'حساب محدود'}</small></div></div></aside>
    <main><header><div><small>راهکار</small><h1>{tabs.find(row=>row[0]===tab)?.[2]}</h1></div>{['products','orders','customers','engineering-services','support-tickets'].includes(tab)&&<label><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="جست‌وجو…"/></label>}</header>{notice&&<div className="sales-notice" role="alert">{notice}</div>}
      {tab==='dashboard'&&<Dashboard data={dashboard} filters={filters} setFilters={setFilters} refresh={loadDashboard} loading={loading}/>}
      {tab==='products'&&(loading&&!products?<Loading/>:<Products data={products} query={query} setQuery={setQuery} page={productPage} setPage={setProductPage} reload={loadProducts} onNew={()=>setEditing({...blankProduct,lowStockThreshold:Number(catalog?.settings?.default_low_stock_threshold||3)})} onEdit={editProduct} onArchive={archive} onRestore={restore} can={can}/>)}
      {tab==='orders'&&(loading&&!orders?<Loading/>:<Orders data={orders} onPage={setOrderPage} onOpen={openOrder}/>)}
      {tab==='engineering-services'&&(loading&&!engineeringRequests?<Loading/>:<EngineeringRequests rows={engineeringRequests||[]} onOpen={openEngineeringRequest}/>)}
      {tab==='support-tickets'&&(loading&&!supportTickets?<Loading/>:<SupportSalesTickets rows={supportTickets||[]} onSave={saveSupportTicket} onOpenOrder={openOrder} can={can}/>)}
      {tab==='inventory'&&<SimpleTable title="گردش کالا">{inventory?.length?<div className="sales-table compact"><div><b>محصول</b><b>SKU</b><b>مقدار</b><b>علت</b><b>زمان</b></div>{inventory.map(row=><div key={row.id}><span>{row.name}</span><code>{row.sku}</code><b>{fa(row.quantity)}</b><span>{row.reason}</span><small>{date(row.created_at)}</small></div>)}</div>:<Empty/>}</SimpleTable>}
      {tab==='payments'&&<SimpleTable title="پرداخت‌ها">{payments?.items?.length?<div className="sales-table compact"><div><b>سفارش</b><b>مشتری</b><b>مبلغ</b><b>وضعیت</b><b>تراکنش</b></div>{payments.items.map(row=><div key={row.id}><span>{row.order_no}</span><span>{row.full_name||'—'}</span><b>{money(row.amount)}</b><Status value={row.status}/><code>{row.transaction_id||row.authority||'—'}</code></div>)}</div>:<Empty/>}</SimpleTable>}
      {tab==='customers'&&<SimpleTable title="مشتریان">{customers?.length?<div className="customer-grid">{customers.map((row,index)=><article key={`${row.id}-${index}`}><UsersRound/><div><b>{row.full_name||'مشتری راهکار'}</b><small>{row.mobile} · {row.email||'بدون ایمیل'}</small><p><MapPin/>{row.province?`${row.province}، ${row.city}، ${row.address}`:'آدرسی ثبت نشده'}</p></div></article>)}</div>:<Empty/>}</SimpleTable>}
      {tab==='shipping'&&<SimpleTable title="مرجوعی‌ها">{returns?.length?<div className="sales-table compact"><div><b>شماره</b><b>سفارش</b><b>مشتری</b><b>دلیل</b><b>وضعیت</b></div>{returns.map(row=><div key={row.id}><span>{row.return_no}</span><span>{row.order_no}</span><span>{row.full_name||'—'}</span><span>{row.reason}</span><Status value={row.status}/></div>)}</div>:<Empty/>}</SimpleTable>}
      {tab==='catalog'&&<CatalogSettings data={catalog} reload={loaders.catalog}/>}
      {tab==='discounts'&&<Discounts rows={discounts||[]} reload={loaders.discounts}/>}
      {tab==='reports'&&<Reports filters={filters} setNotice={setNotice}/>}
      {tab==='notifications'&&<SimpleTable title="اعلان‌ها">{notifications?.length?notifications.map(row=><div className="notification-row" key={row.id}><Bell/><span><b>{row.title}</b><small>{row.body} · {date(row.created_at)}</small></span></div>):<Empty/>}</SimpleTable>}
      {tab==='profile'&&<form className="sales-card profile-form" onSubmit={profileSave}><h3>پروفایل واقعی مدیر فروش</h3><label>نام و نام خانوادگی<input name="full_name" defaultValue={user?.full_name||''} required/></label><label>ایمیل<input name="email" type="email" defaultValue={user?.email||''}/></label><label>آدرس تصویر<input name="avatar_url" defaultValue={user?.avatar_url||''}/></label><div className="profile-meta"><span>آخرین ورود<b>{date(user?.last_login_at)}</b></span><span>تاریخ ایجاد<b>{date(user?.member_since)}</b></span><span>وضعیت<b>{user?.status}</b></span></div><button disabled={loading}>ذخیره پروفایل</button></form>}
      {tab==='sessions'&&<SimpleTable title="نشست‌های فعال"><button className="danger-action" onClick={()=>run(async()=>{await api('/security/logout-others',{method:'POST'});setSessions(await api('/security/sessions'))})}>خروج از سایر دستگاه‌ها</button>{sessions?.map(row=><div className="session-row" key={row.id}><ShieldCheck/><span><b>{row.current?'این دستگاه':row.portal}</b><small>{row.ip||'IP نامشخص'} · {row.user_agent||'دستگاه نامشخص'}</small></span><time>{date(row.last_seen_at)}</time></div>)}</SimpleTable>}
    </main>
    {editing&&<ProductForm value={editing} setValue={setEditing} onClose={()=>setEditing(null)} onSave={saveProduct} onAddVariant={addVariant} onBarcode={getBarcode} catalog={catalog} loading={loading} error={notice}/>}
    {orderDetail&&<OrderDetail data={orderDetail} onClose={()=>setOrderDetail(null)} onChange={changeOrder} reload={reloadOrder} can={can}/>}
    {engineeringDetail&&<EngineeringRequestDetail data={engineeringDetail} onClose={()=>setEngineeringDetail(null)} onSave={saveEngineeringRequest} onDownload={()=>download(`/sales/engineering-service-requests/${engineeringDetail.id}/map`,engineeringDetail.map_original_name)} can={can}/>}
  </div>;
}

function CatalogSettings({data,reload}){
  const[form,setForm]=useState({kind:'categories',name:'',parentId:'',description:'',attributesText:''});
  const[prefix,setPrefix]=useState(data?.settings?.product_code_prefix||'ARN');
  const[units,setUnits]=useState((data?.settings?.units||[]).join('، '));
  useEffect(()=>{setPrefix(data?.settings?.product_code_prefix||'ARN');setUnits((data?.settings?.units||[]).join('، '))},[data]);
  const save=async event=>{event.preventDefault();await api(`/sales/catalog-settings/${form.kind}`,{method:'POST',body:{name:form.name,parentId:form.kind==='categories'?(form.parentId||null):undefined,description:form.description,attributes:form.attributesText.split(/[،,\n]/).map(x=>x.trim()).filter(Boolean)}});setForm({...form,name:'',description:'',attributesText:''});await reload()};
  const saveSettings=async event=>{event.preventDefault();await api('/sales/store-settings',{method:'PATCH',body:{productCodePrefix:prefix,units:units.split(/[،,\n]/).map(x=>x.trim()).filter(Boolean)}});await reload()};
  return <section className="catalog-layout"><div className="sales-analytics-grid"><form className="sales-card" onSubmit={save}><h3>دسته یا برند جدید</h3><p>کد و Slug به‌صورت خودکار و یکتا ساخته می‌شوند.</p><label>نوع<select value={form.kind} onChange={e=>setForm({...form,kind:e.target.value})}><option value="categories">دسته‌بندی</option><option value="brands">برند</option></select></label><label>نام<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} required/></label>{form.kind==='categories'&&<><label>دسته مادر<select value={form.parentId} onChange={e=>setForm({...form,parentId:e.target.value})}><option value="">دسته اصلی</option>{data?.categories?.filter(row=>row.status==='active').map(row=><option value={row.id} key={row.id}>{row.name}</option>)}</select></label><label>ویژگی‌های اختصاصی — با ویرگول جدا کنید<textarea rows="3" value={form.attributesText} onChange={e=>setForm({...form,attributesText:e.target.value})} placeholder="توان، ولتاژ، ابعاد، ضمانت"/></label><label>توضیح<textarea rows="2" value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label></>}<button>ذخیره</button></form><form className="sales-card" onSubmit={saveSettings}><h3>تنظیمات کددهی</h3><label>پیشوند کد محصول<input dir="ltr" maxLength="8" value={prefix} onChange={e=>setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''))} required/></label><label>واحدهای شمارش<textarea rows="3" value={units} onChange={e=>setUnits(e.target.value)}/></label><div className="identity-example"><code>{prefix||'ARN'}-0102-000963</code><small>نمونه کد محصول؛ قیمت وارد کد نمی‌شود.</small></div><button><Settings/>ذخیره تنظیمات</button></form></div><div className="sales-card"><h3>دسته‌بندی‌های لیستی</h3>{data?.categories?.map(row=><div className="category-row" key={row.id}><span><b>{row.parent_id?'↳ ':''}{row.name}</b><small>{fa(row.products)} محصول · {fa(row.published)} منتشرشده</small></span><code>{row.code}</code><Status value={row.status}/></div>)}<h3>برندها</h3>{data?.brands?.map(row=><div className="rank-row" key={row.id}><b>{row.name}</b><code>{row.slug}</code></div>)}</div></section>
}

function Discounts({rows,reload}){
  const[form,setForm]=useState({code:'',type:'percent',value:10,usageLimit:'',perCustomerLimit:'',minimumOrder:'',maximumDiscount:'',startsAt:'',endsAt:'',firstPurchaseOnly:false,singleUse:false});
  const save=async event=>{event.preventDefault();await api('/sales/discounts',{method:'POST',body:{...form,value:Number(form.value),usageLimit:form.usageLimit?Number(form.usageLimit):null,perCustomerLimit:form.perCustomerLimit?Number(form.perCustomerLimit):null,minimumOrder:form.minimumOrder?Number(form.minimumOrder):null,maximumDiscount:form.maximumDiscount?Number(form.maximumDiscount):null,startsAt:form.startsAt||null,endsAt:form.endsAt||null}});setForm({...form,code:''});await reload()};
  return <section className="sales-analytics-grid"><form className="sales-card discount-form" onSubmit={save}><h3>کمپین جدید</h3><div className="form-grid"><label>کد<input dir="ltr" value={form.code} onChange={e=>setForm({...form,code:e.target.value})} required/></label><label>نوع<select value={form.type} onChange={e=>setForm({...form,type:e.target.value})}><option value="percent">درصدی</option><option value="fixed">مبلغ ثابت</option></select></label><label>مقدار<input type="number" min="1" value={form.value} onChange={e=>setForm({...form,value:e.target.value})}/></label><label>حداقل سفارش<input type="number" min="0" value={form.minimumOrder} onChange={e=>setForm({...form,minimumOrder:e.target.value})}/></label><label>سقف مبلغ تخفیف<input type="number" min="0" value={form.maximumDiscount} onChange={e=>setForm({...form,maximumDiscount:e.target.value})}/></label><label>سقف کل استفاده<input type="number" min="1" value={form.usageLimit} onChange={e=>setForm({...form,usageLimit:e.target.value})}/></label><label>سقف هر مشتری<input type="number" min="1" value={form.perCustomerLimit} onChange={e=>setForm({...form,perCustomerLimit:e.target.value})}/></label><label>شروع<input type="date" value={form.startsAt} onChange={e=>setForm({...form,startsAt:e.target.value})}/></label><label>پایان<input type="date" value={form.endsAt} onChange={e=>setForm({...form,endsAt:e.target.value})}/></label></div><label className="check"><input type="checkbox" checked={form.firstPurchaseOnly} onChange={e=>setForm({...form,firstPurchaseOnly:e.target.checked})}/> فقط خرید اول</label><label className="check"><input type="checkbox" checked={form.singleUse} onChange={e=>setForm({...form,singleUse:e.target.checked})}/> یک‌بارمصرف</label><button>ایجاد کمپین</button></form><div className="sales-card"><h3>کدهای تخفیف</h3>{rows.map(row=><div className="rank-row" key={row.id}><span><b dir="ltr">{row.code}</b><small>{row.type==='percent'?`${fa(row.value)} درصد`:money(row.value)} · {fa(row.used_count)} استفاده</small></span><Status value={row.status}/></div>)}</div></section>
}

function Reports({filters,setNotice}){
  const[loading,setLoading]=useState('');
  const get=async(type)=>{setLoading(type);try{const params=new URLSearchParams({from:filters.from,to:filters.to});await download(`/sales/reports.${type}?${params}`,`aronage-sales.${type}`)}catch(error){setNotice(error.message)}finally{setLoading('')}};
  return <section className="sales-card report-center"><h3>مرکز خروجی فروش</h3><p>خروجی‌ها فقط با کلیک شما ساخته می‌شوند و پردازش دائمی پس‌زمینه ندارند.</p><div><button disabled={loading} onClick={()=>get('csv')}><FileText/> {loading==='csv'?'در حال ساخت…':'CSV فروش'}</button><button disabled={loading} onClick={()=>get('xlsx')}><FileSpreadsheet/> {loading==='xlsx'?'در حال ساخت…':'Excel چندشیتی'}</button><button onClick={()=>window.print()}><FileText/> نسخه چاپی</button></div></section>
}
