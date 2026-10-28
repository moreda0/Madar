# مدار (Madar)

إدارة المهام والحضور لكل شركاتك في مكان واحد. تطبيق ويب يتثبت على اللابتوب والموبايل (PWA)، عربي من اليمين للشمال.

## المرحلة 1 (الموجودة هنا)
- شركات متعددة + شاشة "اليوم" موحدة وفلتر لكل شركة بلونها
- هيكل تنظيمي: شركة ← قطاعات ← إدارات ← فرق، ومدير لكل وحدة
- صلاحيات: مدير عام / مدير / موظف (الشخص ممكن يبقى في أكتر من شركة بصلاحيات مختلفة)
- مهام: قائمة، كانبان بالسحب، تقويم شهري، مهام فرعية، تعليقات، أولوية، ميعاد وتذكير
- تنبيهات داخل التطبيق + إشعارات الجهاز: تكليف، تعليق، تغيير حالة، تذكير قبل الميعاد، تأخير
- حضور وانصراف بالموقع (GPS + نطاق حول المقر) أو بكود QR / كود يدوي، مربوط بخطة مهام اليوم، ولوحة حضور الفريق للمديرين

البيانات حالياً محفوظة على الجهاز (localStorage). `supabase/schema.sql` فيه قاعدة البيانات الحقيقية بالصلاحيات (RLS) للمرحلة 2.

## Run
```bash
npm install
npm run dev            # local dev
npm run build          # installable PWA in dist/ (host on any static host: Netlify, Vercel, Cloudflare Pages)
npm run build:preview  # single self-contained HTML in dist-preview/
```
GPS, camera QR scanning, system notifications and install need HTTPS (or localhost).

## Code map
- `src/lib/types.ts` data model · `store.ts` data + actions · `access.ts` roles/visibility · `reminders.ts` reminder engine · `seed.ts` sample data
- `src/pages/*` screens · `src/components/*` shared UI
- `public/sw.js` offline cache + notification clicks · `public/manifest.webmanifest`

## Next phases
2. Supabase auth (phone OTP) + sync across devices and team
3. Ratings, monthly commitment score /100, annual review, promotions, KPIs
4. AI assistant in Egyptian Arabic, two-way WhatsApp (WhatsApp Business Cloud API)
