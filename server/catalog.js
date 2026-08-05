export const catalog = {
  'rahkar-ai-automation': {
    name: 'هوشمندسازی فرایندها با هوش مصنوعی', unitPrice: 0, productType: 'service',
    category: 'هوشمندسازی', imageUrl: '/assets/rahkar/service-automation.webp',
    description: 'تحلیل و خودکارسازی فرایندهای سازمان با گردش‌کار و دستیار هوشمند اختصاصی.',
  },
  'rahkar-custom-platform': {
    name: 'طراحی سامانه اختصاصی سازمان', unitPrice: 0, productType: 'service',
    category: 'سامانه اختصاصی', imageUrl: '/assets/rahkar/service-custom-system.webp',
    description: 'طراحی، توسعه، استقرار و پشتیبانی سامانه متناسب با ساختار و نقش‌های سازمان.',
  },
  'rahkar-smart-dashboard': {
    name: 'جمع‌آوری داده و داشبورد هوشمند', unitPrice: 0, productType: 'service',
    category: 'داده و داشبورد', imageUrl: '/assets/rahkar/service-dashboard.webp',
    description: 'یکپارچه‌سازی داده‌های پراکنده و ساخت داشبوردهای مدیریتی چندسطحی.',
  },
};

export const rial = value => Math.round(Number(value || 0));
