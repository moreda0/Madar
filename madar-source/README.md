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

## Meetings → minutes + tasks
`src/pages/Meetings.tsx` records a meeting in the browser (live speech-to-text in Chrome, raw audio as backup), takes an uploaded recording, or pasted text, and sends it to `supabase/functions/madar-meetings` (JWT verification off). Claude writes the minutes and proposes tasks; the person reviews them and they're saved with `meetingId`.

The same function has an inbox for outside senders such as a WhatsApp assistant (Instinct):
```
POST https://<project>.supabase.co/functions/v1/madar-meetings
x-madar-key: <MEETINGS_INBOX_KEY>
{"audio_url": "...", "from_phone": "2010...", "title": "optional", "company": "optional name"}   // or "transcript": "..."
```
It saves the meeting and tasks straight into Madar and answers `{ok, meetingId, minutes, tasks, link}` (minutes are ready to send back on WhatsApp).
Secrets: `ANTHROPIC_API_KEY`, `MEETINGS_INBOX_KEY`, and for audio `TRANSCRIBE_API_KEY` (OpenAI-compatible speech-to-text, Groq `whisper-large-v3` by default; override with `TRANSCRIBE_URL` / `TRANSCRIBE_MODEL`).

## Next phases
2. Supabase auth (phone OTP) + sync across devices and team
3. Ratings, monthly commitment score /100, annual review, promotions, KPIs
4. AI assistant in Egyptian Arabic, two-way WhatsApp (WhatsApp Business Cloud API)
