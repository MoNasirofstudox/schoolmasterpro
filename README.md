# SchoolMasterPro — Complete Application

16 pages, fully live-connected to Supabase. No build step. Open in browser.

---

## Setup (2 minutes)

**1. Set your Supabase credentials**

Open `smp-supabase.js` and replace the two values at the top:

```javascript
const SMP_CONFIG = {
  supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
  supabaseKey: 'YOUR-ANON-KEY',
}
```

Get these from: Supabase Dashboard → Project Settings → API

**2. Run SQL files** (from SchoolMasterPro_Supabase.zip, in order):
```
01_schema.sql
02_rls.sql
03_functions.sql
04_demo_seed.sql      ← optional, loads Greenwood Academy demo data
05_storage.sql
07_features.sql       ← promotion, bulk upload, notifications
08_notification_settings.sql
```

**3. Open `login.html`** in any browser. Done.

---

## Pages

| File | Description | Status |
|---|---|---|
| `login.html` | Operator sign-in | ✅ Live |
| `index.html` | Dashboard — real stats, alerts, quick actions | ✅ Live |
| `students.html` | Student list — search, filter, paginate, enroll | ✅ Live |
| `student-profile.html` | Full student record — results, fees, history, edit | ✅ Live |
| `scores.html` | Score entry — select assessment, enter, auto-grade, lock | ✅ Live |
| `fees.html` | Fee records — view all, record payments, filter | ✅ Live |
| `reports.html` | PDF report cards — preview + single/batch download | ✅ Live |
| `staff.html` | Staff register — add, edit, activate/deactivate | ✅ Live |
| `documents.html` | File upload to Supabase Storage — drag/drop, download, delete | ✅ Live |
| `promotion.html` | End-of-session promotion decisions — auto-recommend, bulk apply | ✅ Live |
| `bulk-upload.html` | CSV score import — validate, preview, import | ✅ Live |
| `notifications.html` | Fee reminders + results alerts — generate, preview, dispatch | ✅ Live |
| `notif-settings.html` | SMS (Termii) + Email (Resend) provider config | ✅ Live |
| `term-settings.html` | Sessions, terms, exam periods, classes, promotion rules | ✅ Live |
| `admin-login.html` | Platform admin sign-in | ✅ Live |
| `admin.html` | Platform admin panel — schools, operators, audit log | ✅ Live |

---

## How the app works end-to-end

**Login flow**
- Operators log in via `login.html` → Supabase Auth → scoped to their school
- Platform admins log in via `admin-login.html` → full access across all schools
- Sessions persist and auto-refresh — operators stay logged in all day

**Multi-tenancy**
- Every DB query is scoped by `school_id` via Row Level Security in Supabase
- Operators physically cannot see other schools' data — enforced at DB level

**Score entry flow**
1. Operator opens `scores.html` → selects term / class / subject
2. System loads enrolled students for that class
3. Operator enters CA1, CA2, Exam scores — totals and grades auto-compute
4. Save → scores saved to Supabase; positions auto-computed via RPC
5. Lock → assessment locked, cannot be edited

**Report card flow**
1. Open `reports.html` → select term → Load Students
2. Click any student → live preview renders from DB
3. Click Download → jsPDF generates PDF in browser, no server needed
4. Generate All → batch downloads all students one by one

**Promotion flow**
1. End of session: open `promotion.html`
2. Load students for the closing session
3. System auto-recommends Promoted/Repeated based on year average + promotion rules
4. Operator reviews and adjusts decisions
5. Apply → students enrolled in new term's classes in one click

**Notification flow**
1. Open `notifications.html` → Generate Fee Reminders (or Results Ready)
2. Messages generated and queued in DB — one per student
3. Review queue → Preview individual messages
4. Send All → calls Edge Function → dispatches via Termii (SMS) or Resend (email)

---

## Sending real notifications

The Edge Function must be deployed for real SMS/email dispatch:

```bash
# Install Supabase CLI
npm install -g supabase

# Link to your project
supabase link --project-ref YOUR-PROJECT-REF

# Set API keys as secrets
supabase secrets set TERMII_API_KEY=your-key
supabase secrets set RESEND_API_KEY=your-key

# Deploy
supabase functions deploy send-notifications
```

Without the Edge Function, clicking "Send All" marks messages as sent locally
(useful for testing the queue flow without spending SMS credits).

---

## Starting fresh (new school)

1. Log in as platform admin → Add School
2. Create an operator account for the school (requires service role key — see admin panel)
3. Operator logs in → goes to Term Settings
4. Create session (e.g. "2025/2026") + three terms
5. Add classes + subjects
6. Configure promotion rules
7. Start enrolling students

---

## File structure

```
ui/
├── smp-supabase.js       ← Supabase client + ALL API helpers (single file)
├── login.html            ← Start here
├── index.html            ← Main dashboard
├── students.html
├── student-profile.html
├── scores.html
├── fees.html
├── reports.html
├── staff.html
├── documents.html
├── promotion.html        ← NEW
├── bulk-upload.html      ← NEW
├── notifications.html    ← NEW
├── notif-settings.html   ← NEW
├── term-settings.html    ← NEW
├── admin-login.html
└── admin.html
```

Everything runs from `smp-supabase.js`. No framework, no build step,
no node_modules. Deploy to any static host.
