export const SUPPORT_TOPICS = Object.freeze([
  { id: 'needs-analysis', label: 'تحلیل نیاز و انتخاب راهکار', aliases: ['تحلیل نیاز', 'مشاوره اولیه', 'needs', 'consultation'] },
  { id: 'ai-automation', label: 'هوش مصنوعی و خودکارسازی فرایند', aliases: ['هوش مصنوعی', 'خودکارسازی', 'اتوماسیون', 'ai', 'automation'] },
  { id: 'custom-system', label: 'سامانه اختصاصی سازمان', aliases: ['سامانه اختصاصی', 'طراحی سیستم', 'نرم افزار سازمانی', 'custom system'] },
  { id: 'data-dashboard', label: 'داده، گزارش و داشبورد', aliases: ['داشبورد', 'گزارش', 'جمع آوری داده', 'data', 'dashboard'] },
  { id: 'deployment-training', label: 'استقرار، انتقال داده و آموزش', aliases: ['استقرار', 'آموزش', 'انتقال داده', 'deployment', 'training'] },
  { id: 'order-tracking', label: 'پیگیری درخواست و سفارش', aliases: ['پیگیری سفارش', 'پیگیری درخواست', 'order', 'order-status'] },
  { id: 'payment-invoice', label: 'پیشنهاد مالی، قرارداد و پرداخت', aliases: ['پیشنهاد مالی', 'قرارداد', 'پرداخت', 'پیش فاکتور', 'payment', 'invoice'] },
  { id: 'technical-support', label: 'مشکل فنی سامانه', aliases: ['مشکل فنی', 'ورود', 'خطا', 'technical', 'technical-support'] },
  { id: 'other', label: 'سایر موارد', aliases: ['سایر موارد', 'other', 'general', 'unknown'] },
]);

const normalized = value => String(value || '').trim().toLocaleLowerCase('fa-IR');
const topicAliases = new Map(SUPPORT_TOPICS.flatMap(topic =>
  [topic.id, topic.label, ...topic.aliases].map(alias => [normalized(alias), topic.id])));

export const canonicalSupportTopic = value => topicAliases.get(normalized(value)) || 'other';
export const supportTopicLabel = value => SUPPORT_TOPICS.find(topic => topic.id === canonicalSupportTopic(value))?.label || 'سایر موارد';
export const SUPPORT_TOPIC_IDS = Object.freeze(SUPPORT_TOPICS.map(topic => topic.id));
