// Deterministic sample data: one fullstack product (Kettle), 132 features, seeded, no randomness across runs.
// Usage: node scripts/fixtures/gen-kettle.mjs <out-dir> [--js]
//   writes <out-dir>/kettle.json (src/data/kettle.json is this output); --js also writes kettle.js (window.KETTLE)
//   for the static HTML prototypes. Schema: docs/fixtures/kettle-sample.md. The app reads the v3 map made
//   from this file by scripts/kettle-to-v3.ts.
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2];
const TODAY = new Date('2026-10-08T09:00:00Z');
let seed = 20261008;
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;
const day = (n) => { const d = new Date(TODAY); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const ts = (n, h = ri(0, n === 0 ? 8 : 23), m = ri(0, 59)) => { const d = new Date(TODAY); d.setUTCDate(d.getUTCDate() - n); d.setUTCHours(h, m, 0, 0); return d.toISOString().replace('.000', ''); };

const STAGES = ['idea', 'specified', 'in-dev', 'in-review', 'flagged', 'live', 'deprecated'];

const people = [
  { id: 'mara', name: 'Mara Ilić', kind: 'human', field: 'business', title: 'Founder & CEO' },
  { id: 'dev', name: 'Dev Okafor', kind: 'human', field: 'product', title: 'Product lead' },
  { id: 'tomas', name: 'Tomás Reyes', kind: 'human', field: 'development', title: 'Engineering lead' },
  { id: 'priya', name: 'Priya Nair', kind: 'human', field: 'operations', title: 'SRE' },
  { id: 'jonas', name: 'Jonas Berg', kind: 'human', field: 'security', title: 'Security & compliance' },
  { id: 'lea', name: 'Lea Novak', kind: 'human', field: 'design', title: 'Product designer' },
  { id: 'sam', name: 'Sam Adeyemi', kind: 'human', field: 'business', title: 'Customer success & sales' },
  { id: 'ines', name: 'Ines Costa', kind: 'human', field: 'quality', title: 'QA engineer' },
  { id: 'forge-1', name: 'Forge-1', kind: 'agent', field: 'development', title: 'Build agent (backend)' },
  { id: 'forge-2', name: 'Forge-2', kind: 'agent', field: 'development', title: 'Build agent (web)' },
  { id: 'forge-3', name: 'Forge-3', kind: 'agent', field: 'development', title: 'Build agent (mobile)' },
  { id: 'forge-4', name: 'Forge-4', kind: 'agent', field: 'development', title: 'Build agent (integrations)' },
  { id: 'warden', name: 'Warden', kind: 'agent', field: 'quality', title: 'Review agent (code review, tests)' },
  { id: 'tender', name: 'Tender', kind: 'agent', field: 'operations', title: 'Ops agent (deploys, flags, alerts)' },
];

const milestones = [
  { id: 'M1', name: 'Public beta', date: '2026-06-15', state: 'done', goal: 'First 100 paying studios can run their whole timetable and memberships on Kettle.' },
  { id: 'M2', name: 'Payments GA', date: '2026-10-22', state: 'active', goal: 'Kettle processes all studio payments end-to-end: dunning, tax, bank debit, payouts reconciled.' },
  { id: 'M3', name: 'Multi-location', date: '2026-12-03', state: 'planned', goal: 'Studio chains with several locations run from one account.' },
  { id: 'M4', name: 'Kettle Assistant', date: '2027-01-28', state: 'planned', goal: 'AI that fills classes and keeps members: schedule suggestions, chat booking, churn outreach.' },
];

// domain -> capability -> [id-suffix, name, summary, stage, priority, kind, milestone, surfaces]
const K = { C: 'customer', I: 'internal', P: 'platform', B: 'business' };
const D = [
  ['IAM', 'Identity & Access', 'Who can get in and what they may do.', [
    ['Sign-in', [
      ['Email & password sign-in', 'Members and staff sign in with email and password.', 'live', 'P0', 'C', 'M1', 'api,web-admin,web-member,mobile'],
      ['Magic-link login', 'Passwordless sign-in through a one-time email link.', 'live', 'P1', 'C', 'M1', 'api,web-member,mobile'],
      ['Google sign-in', 'Sign in with a Google account.', 'live', 'P2', 'C', 'M1', 'api,web-member,mobile'],
      ['Apple sign-in', 'Sign in with Apple, required for the iOS app store.', 'flagged', 'P1', 'C', 'M2', 'api,mobile'],
      ['Two-factor auth for staff', 'Staff accounts protect payouts and member data with a second factor.', 'in-review', 'P0', 'I', 'M2', 'api,web-admin'],
      ['Sessions & device list', 'See and revoke signed-in devices.', 'in-dev', 'P2', 'C', null, 'api,web-member,web-admin'],
    ]],
    ['Roles & permissions', [
      ['Staff roles & permissions', 'Owner, manager, front desk and instructor roles with fixed permissions.', 'live', 'P0', 'I', 'M1', 'api,web-admin'],
      ['Custom role builder', 'Studios define their own roles from individual permissions.', 'specified', 'P3', 'I', null, 'api,web-admin'],
      ['Multi-studio account switching', 'One login moves between studios and locations.', 'in-dev', 'P1', 'I', 'M3', 'api,web-admin,mobile'],
      ['Audit log', 'Every sensitive staff action recorded and searchable.', 'in-dev', 'P1', 'I', 'M2', 'api,web-admin,db'],
    ]],
  ]],
  ['STU', 'Studio Setup', 'Getting a studio onto Kettle and shaping it.', [
    ['Onboarding', [
      ['Studio onboarding wizard', 'Guided setup: studio, rooms, classes, prices, payments in 20 minutes.', 'live', 'P0', 'B', 'M1', 'web-admin,api'],
      ['Member import from CSV', 'Bring an existing member list in from a spreadsheet.', 'live', 'P1', 'I', 'M1', 'web-admin,api,workers'],
      ['Legacy system migration', 'One-click import of members, plans and history from the two incumbent studio systems.', 'in-dev', 'P0', 'B', 'M2', 'api,workers,integrations'],
      ['Branding & theme editor', 'Logo, colours and fonts for the booking page and member app.', 'live', 'P2', 'I', 'M1', 'web-admin,web-member,mobile'],
      ['Custom booking domain', 'Booking page on the studio\'s own domain with managed certificates.', 'flagged', 'P2', 'B', null, 'infra,web-member'],
    ]],
    ['Locations & rooms', [
      ['Locations & rooms', 'Rooms with capacity and layout per location.', 'live', 'P0', 'I', 'M1', 'web-admin,api'],
      ['Multi-location management', 'Chains manage several locations, shared plans and cross-location booking.', 'in-dev', 'P0', 'B', 'M3', 'api,web-admin,web-member,mobile,db'],
      ['Equipment & resource booking', 'Reserve reformers, bikes or courts as resources.', 'idea', 'P3', 'C', null, 'api,web-member'],
      ['Opening hours & holidays', 'Hours, closures and holiday schedules that block bookings.', 'live', 'P2', 'I', 'M1', 'web-admin,api'],
    ]],
  ]],
  ['SCH', 'Scheduling & Classes', 'The timetable: what happens, when, with whom.', [
    ['Timetable', [
      ['Class types catalog', 'Class types with description, level, duration and default capacity.', 'live', 'P0', 'I', 'M1', 'web-admin,api'],
      ['Recurring class schedule', 'Weekly repeating classes with exceptions.', 'live', 'P0', 'I', 'M1', 'api,web-admin,db'],
      ['Drag-and-drop timetable editor', 'Move and resize classes directly on the week grid.', 'live', 'P1', 'I', 'M1', 'web-admin'],
      ['Schedule templates', 'Save a season\'s timetable and roll it out again.', 'specified', 'P2', 'I', null, 'web-admin,api'],
      ['Class capacity rules', 'Capacity, minimum attendance and auto-cancel of empty classes.', 'live', 'P1', 'I', 'M1', 'api,workers'],
      ['Substitute instructor swap', 'Swap an instructor and notify booked members.', 'in-review', 'P1', 'I', 'M2', 'api,web-admin,mobile,workers'],
    ]],
    ['Appointments', [
      ['1:1 appointments', 'Members book private sessions with an instructor.', 'live', 'P1', 'C', 'M1', 'api,web-member,mobile'],
      ['Instructor availability', 'Instructors publish the hours they can take appointments.', 'live', 'P1', 'I', 'M1', 'api,mobile,web-admin'],
      ['Buffers & travel time', 'Gaps between appointments and travel time between locations.', 'idea', 'P3', 'I', null, 'api'],
      ['Small-group private sessions', 'Private sessions for 2 to 4 people sharing one booking.', 'specified', 'P3', 'C', null, 'api,web-member'],
    ]],
    ['Events & courses', [
      ['Workshops & events', 'One-off events with their own pricing and capacity.', 'flagged', 'P2', 'C', null, 'api,web-member,web-admin'],
      ['Multi-session courses', 'Six-week courses booked and paid as one.', 'in-dev', 'P2', 'C', 'M3', 'api,web-member,web-admin'],
      ['Virtual classes', 'Livestream link delivered to booked members before class.', 'live', 'P2', 'C', 'M1', 'api,workers,web-member'],
    ]],
  ]],
  ['BKG', 'Booking & Attendance', 'Members taking a spot and turning up.', [
    ['Booking', [
      ['Book a class', 'Members reserve a spot in two taps.', 'live', 'P0', 'C', 'M1', 'api,web-member,mobile'],
      ['Cancellation & late-cancel policy', 'Cancel windows, late-cancel fees and credit returns.', 'live', 'P0', 'C', 'M1', 'api,web-member,mobile,workers'],
      ['Waitlist with auto-promote', 'When a spot frees up, the next member on the waitlist is booked and told.', 'live', 'P0', 'C', 'M1', 'api,workers,mobile'],
      ['Spot selection', 'Pick your mat, bike or reformer from the room layout.', 'flagged', 'P2', 'C', null, 'api,web-member,mobile'],
      ['Book for friends & family', 'Book and pay for a guest or a family member.', 'in-dev', 'P2', 'C', 'M3', 'api,web-member,mobile'],
      ['Recurring auto-booking', 'Members hold their usual weekly class automatically.', 'specified', 'P1', 'C', null, 'api,workers'],
    ]],
    ['Check-in', [
      ['QR check-in', 'Members scan a code at the door.', 'live', 'P1', 'C', 'M1', 'mobile,api'],
      ['Front-desk check-in kiosk', 'A tablet at the desk with search, check-in and walk-in sales.', 'in-review', 'P1', 'I', 'M2', 'web-admin,api'],
      ['No-show tracking & penalties', 'Count no-shows and apply the studio\'s penalty rules.', 'live', 'P2', 'I', 'M1', 'api,workers'],
      ['Attendance history', 'Members and staff see every visit.', 'live', 'P2', 'C', 'M1', 'api,web-member,mobile,web-admin'],
    ]],
  ]],
  ['PAY', 'Memberships & Payments', 'What members buy and how the money moves.', [
    ['Plans & products', [
      ['Membership plans', 'Monthly and annual unlimited or capped memberships.', 'live', 'P0', 'B', 'M1', 'api,web-admin,web-member,db'],
      ['Class packs & credits', 'Packs of 5, 10 or 20 classes with expiry.', 'live', 'P0', 'B', 'M1', 'api,web-member,db'],
      ['Intro offers', 'First-week and first-month offers for new members.', 'live', 'P1', 'B', 'M1', 'api,web-member'],
      ['Family plans', 'One payer, several members, shared or separate credits.', 'specified', 'P2', 'B', 'M3', 'api,web-member,db'],
      ['Freeze & pause membership', 'Members pause for travel or injury, billing stops.', 'in-dev', 'P1', 'C', 'M2', 'api,web-member,mobile,workers'],
      ['Corporate memberships', 'Employers pay for staff memberships with monthly invoicing.', 'idea', 'P2', 'B', null, 'api,web-admin'],
    ]],
    ['Billing', [
      ['Card payments', 'Card payments through the payment processor, tokenized.', 'live', 'P0', 'C', 'M1', 'api,web-member,mobile,integrations'],
      ['Recurring billing engine', 'Charges memberships on schedule, prorates, retries.', 'live', 'P0', 'P', 'M1', 'api,workers,db'],
      ['Failed-payment dunning', 'Smart retries and reminder sequence when a card fails.', 'flagged', 'P0', 'B', 'M2', 'workers,api,integrations'],
      ['Invoices & receipts', 'Branded receipts and downloadable invoices.', 'live', 'P1', 'C', 'M1', 'api,workers'],
      ['Refunds & account credit', 'Full and partial refunds, or credit to the member account.', 'live', 'P1', 'I', 'M1', 'api,web-admin,integrations'],
      ['Tax handling', 'VAT and sales tax per location, tax-inclusive prices, tax reports.', 'in-dev', 'P0', 'B', 'M2', 'api,db,workers'],
      ['Bank debit (SEPA)', 'Direct debit from bank accounts, required by European studios.', 'in-review', 'P0', 'C', 'M2', 'api,integrations,web-member'],
      ['Payout reconciliation', 'Match processor payouts to bookings, fees and refunds.', 'in-dev', 'P0', 'I', 'M2', 'workers,api,web-admin'],
      ['Gift cards', 'Sell and redeem gift cards online and at the desk.', 'specified', 'P2', 'B', null, 'api,web-member,web-admin'],
      ['Retail point of sale', 'Sell water, mats and merchandise at the front desk.', 'idea', 'P3', 'B', null, 'web-admin,api'],
    ]],
  ]],
  ['MEM', 'Member Experience', 'What members see and touch.', [
    ['Member app', [
      ['Member mobile app', 'iOS and Android app: book, pay, check in.', 'live', 'P0', 'C', 'M1', 'mobile'],
      ['Push notifications', 'Booking confirmations, waitlist promotions, reminders.', 'live', 'P1', 'C', 'M1', 'mobile,workers,integrations'],
      ['Wallet pass', 'Membership card in Apple and Google Wallet.', 'specified', 'P3', 'C', null, 'api,mobile'],
      ['Member profile', 'Profile, emergency contact, health notes.', 'live', 'P1', 'C', 'M1', 'api,web-member,mobile'],
      ['Digital waiver signing', 'Sign the liability waiver before the first class.', 'live', 'P0', 'C', 'M1', 'api,web-member,mobile'],
      ['Progress & milestones', 'Streaks, class counts and celebrations.', 'flagged', 'P2', 'C', null, 'mobile,api'],
      ['Favourites & follow instructors', 'Follow instructors and get told when they add classes.', 'in-dev', 'P3', 'C', null, 'mobile,api,workers'],
    ]],
    ['Public booking page', [
      ['Embeddable booking widget', 'Timetable and booking embedded on the studio\'s own website.', 'live', 'P0', 'C', 'M1', 'web-member'],
      ['SEO class pages', 'Indexable pages per class and instructor.', 'in-dev', 'P2', 'B', null, 'web-member'],
      ['Reviews & ratings', 'Members rate classes and instructors.', 'idea', 'P3', 'C', null, 'api,mobile'],
    ]],
  ]],
  ['INS', 'Instructor Tools', 'What the people teaching need.', [
    ['Teaching', [
      ['Instructor app mode', 'Instructors see their week and rosters in the same app.', 'live', 'P1', 'I', 'M1', 'mobile'],
      ['Class roster & notes', 'Who is coming, first-timers, injuries, notes.', 'live', 'P1', 'I', 'M1', 'mobile,web-admin,api'],
      ['Sub request board', 'Instructors post classes they need covered and peers claim them.', 'in-review', 'P2', 'I', 'M2', 'mobile,api,workers'],
    ]],
    ['Pay & performance', [
      ['Pay rates & payroll export', 'Per-class and per-head rates, payroll file export.', 'in-dev', 'P1', 'I', 'M2', 'api,web-admin'],
      ['Instructor performance stats', 'Fill rate, retention and ratings per instructor.', 'specified', 'P3', 'I', null, 'api,web-admin'],
      ['Calendar availability sync', 'Two-way sync with instructors\' personal calendars.', 'flagged', 'P2', 'I', null, 'integrations,api'],
    ]],
  ]],
  ['COM', 'Communications', 'Every message Kettle sends on a studio\'s behalf.', [
    ['Messaging', [
      ['Transactional email', 'Confirmations, receipts, password resets.', 'live', 'P0', 'P', 'M1', 'workers,integrations'],
      ['SMS reminders', 'Text reminders before class and on waitlist promotion.', 'live', 'P1', 'C', 'M1', 'workers,integrations'],
      ['Notification preferences', 'Members choose channels and topics.', 'live', 'P1', 'C', 'M1', 'api,web-member,mobile'],
      ['Message template editor', 'Studios edit the wording and look of every message.', 'flagged', 'P2', 'I', null, 'web-admin,api'],
    ]],
    ['Campaigns', [
      ['Email campaigns', 'Newsletters and announcements to member segments.', 'in-dev', 'P2', 'B', null, 'web-admin,workers,integrations'],
      ['Automated journeys', 'Win-back, birthday and lapsed-member sequences.', 'specified', 'P1', 'B', 'M4', 'workers,api'],
      ['Two-way member inbox', 'Members and front desk chat inside the app.', 'idea', 'P3', 'C', null, 'mobile,web-admin,api'],
    ]],
  ]],
  ['GRO', 'Growth & Marketing', 'How studios win members, and how Kettle wins studios.', [
    ['Acquisition', [
      ['Promo codes', 'Discount codes with limits and expiry.', 'live', 'P1', 'B', 'M1', 'api,web-member,web-admin'],
      ['Referral program', 'Members invite friends; both get a reward.', 'flagged', 'P1', 'B', null, 'api,web-member,mobile'],
      ['Lead capture forms', 'Trial sign-up forms that feed a lead list.', 'in-dev', 'P2', 'B', null, 'web-member,api'],
      ['Trial-to-member funnel', 'Track and nudge trial members toward a membership.', 'specified', 'P1', 'B', 'M4', 'api,workers,web-admin'],
      ['Social booking button', 'Book directly from the studio\'s social profile.', 'idea', 'P3', 'B', null, 'integrations'],
    ]],
    ['Retention', [
      ['Loyalty points', 'Points for visits, redeemable for classes.', 'idea', 'P3', 'B', null, 'api,mobile'],
      ['Legacy landing page builder', 'Old drag-and-drop marketing page builder, replaced by the booking widget.', 'deprecated', 'P3', 'B', null, 'web-member'],
    ]],
  ]],
  ['ANA', 'Analytics & Reporting', 'What studio owners learn about their business.', [
    ['Dashboards', [
      ['Studio KPI dashboard', 'Revenue, active members, fill rate and churn on one screen.', 'live', 'P0', 'B', 'M1', 'web-admin,api'],
      ['Revenue reports', 'Revenue by plan, class, instructor and period.', 'live', 'P1', 'B', 'M1', 'web-admin,api,db'],
      ['Attendance & utilisation heatmap', 'Which hours and rooms are full or empty.', 'flagged', 'P2', 'B', null, 'web-admin,api'],
      ['Instructor reports', 'Classes taught, attendance and pay per instructor.', 'in-dev', 'P2', 'I', 'M2', 'web-admin,api'],
    ]],
    ['Insight', [
      ['Churn risk scores', 'Each member scored for risk of leaving, with reasons.', 'in-dev', 'P1', 'B', 'M4', 'workers,api,db'],
      ['Custom report builder', 'Studios build their own reports from any field.', 'idea', 'P3', 'B', null, 'web-admin,api'],
      ['Scheduled report emails', 'Weekly reports delivered to the owner\'s inbox.', 'specified', 'P3', 'B', null, 'workers'],
      ['CSV data export', 'Export members, bookings and payments.', 'live', 'P1', 'I', 'M1', 'api,web-admin'],
    ]],
  ]],
  ['INT', 'Integrations & API', 'Kettle talking to other systems.', [
    ['Developer platform', [
      ['Public REST API', 'Documented API for studios and partners.', 'flagged', 'P1', 'B', 'M3', 'api'],
      ['Webhooks', 'Events pushed to partner systems.', 'in-dev', 'P1', 'P', 'M3', 'api,workers'],
      ['Automation connector', 'Connect Kettle to no-code automation platforms.', 'specified', 'P3', 'B', null, 'integrations'],
    ]],
    ['Connected systems', [
      ['Calendar feed (iCal)', 'Members subscribe to their bookings in any calendar.', 'live', 'P2', 'C', 'M1', 'api'],
      ['Accounting sync', 'Daily sync of revenue and fees to accounting software.', 'in-dev', 'P1', 'B', 'M2', 'integrations,workers'],
      ['Wearables heart-rate', 'Show heart-rate zones from wearables during class.', 'idea', 'P3', 'C', null, 'integrations,mobile'],
      ['Door access control', 'Members unlock the studio door with their app outside staffed hours.', 'in-review', 'P2', 'C', null, 'integrations,mobile,api'],
      ['Payment terminal', 'Card-present payments at the desk through a terminal.', 'in-dev', 'P2', 'I', 'M2', 'integrations,web-admin'],
    ]],
  ]],
  ['AIA', 'Kettle Assistant', 'AI features for studios and members.', [
    ['For studios', [
      ['Schedule optimizer', 'Suggests timetable changes from fill rates and waitlists.', 'in-dev', 'P1', 'B', 'M4', 'workers,api,web-admin'],
      ['Auto-written class descriptions', 'Generates class descriptions from a few keywords.', 'flagged', 'P3', 'I', null, 'api,web-admin'],
      ['Churn outreach drafts', 'Drafts a personal message for each at-risk member.', 'specified', 'P2', 'B', 'M4', 'workers,web-admin'],
      ['Operations anomaly alerts', 'Tells owners when bookings or revenue move unusually.', 'idea', 'P3', 'B', null, 'workers'],
    ]],
    ['For members', [
      ['Chat booking assistant', 'Members book and change classes by chatting.', 'specified', 'P1', 'C', 'M4', 'mobile,api'],
      ['Waitlist odds prediction', 'Shows the chance of getting in from the waitlist.', 'in-dev', 'P2', 'C', 'M4', 'api,mobile'],
    ]],
  ]],
  ['PLT', 'Platform & Operations', 'What keeps Kettle running, safe and shippable.', [
    ['Infrastructure', [
      ['Multi-tenant data isolation', 'Every query scoped to one studio; no data crosses tenants.', 'live', 'P0', 'P', 'M1', 'api,db'],
      ['Background job queue', 'Queue and workers for billing, messages and imports.', 'live', 'P0', 'P', 'M1', 'workers,infra'],
      ['File storage & CDN', 'Images, waivers and exports stored and served fast.', 'live', 'P1', 'P', 'M1', 'infra'],
      ['Database backups & point-in-time restore', 'Continuous backups, restore to any minute in 14 days.', 'live', 'P0', 'P', 'M1', 'infra,db'],
      ['Disaster recovery plan', 'Tested recovery into a second region.', 'specified', 'P1', 'P', null, 'infra'],
      ['Rate limiting & abuse protection', 'Limits per key and IP, bot protection on sign-up and booking.', 'in-review', 'P0', 'P', 'M2', 'api,infra'],
      ['Feature flag service', 'Per-studio and percentage rollouts for every feature.', 'live', 'P0', 'P', 'M1', 'api,infra'],
    ]],
    ['Observability', [
      ['Structured logging', 'Searchable logs with tenant and request ids.', 'live', 'P1', 'P', 'M1', 'infra'],
      ['Distributed tracing', 'Follow one request across API, workers and integrations.', 'in-dev', 'P1', 'P', 'M2', 'infra,api,workers'],
      ['Uptime & SLO dashboards', 'Availability and latency objectives per service.', 'live', 'P1', 'P', 'M1', 'infra'],
      ['On-call alerting', 'Paging rules and escalation for the on-call engineer.', 'live', 'P0', 'P', 'M1', 'infra'],
      ['Cloud cost monitoring', 'Cost per service, per feature and per studio.', 'in-dev', 'P2', 'P', null, 'infra'],
    ]],
    ['Compliance', [
      ['GDPR export & erasure', 'Members download or delete their data on request.', 'in-dev', 'P0', 'P', 'M2', 'api,workers,db'],
      ['Card data tokenization', 'Card numbers never touch Kettle servers; keeps PCI scope minimal.', 'live', 'P0', 'P', 'M1', 'api,integrations'],
      ['SOC 2 controls', 'Policies, evidence collection and access reviews for SOC 2 Type I.', 'specified', 'P1', 'P', 'M3', 'infra'],
      ['Cookie consent', 'Consent banner and preference storage on public pages.', 'live', 'P2', 'P', 'M1', 'web-member'],
      ['Data retention policies', 'Automatic deletion of data past its retention period.', 'idea', 'P2', 'P', null, 'workers,db'],
    ]],
    ['Delivery', [
      ['CI pipeline', 'Build, lint, unit tests and security scan on every pull request.', 'live', 'P0', 'P', 'M1', 'infra'],
      ['Preview environments', 'Every pull request gets its own running copy.', 'live', 'P1', 'P', 'M1', 'infra'],
      ['End-to-end test suite', 'Browser tests over the critical member and staff journeys.', 'in-dev', 'P0', 'P', 'M2', 'web-admin,web-member,mobile'],
      ['Agent sandbox & guardrails', 'Where build agents run, what they may touch, and what needs a human.', 'live', 'P0', 'P', 'M1', 'infra'],
      ['Release train automation', 'Daily release with automatic promotion through staging.', 'in-dev', 'P1', 'P', null, 'infra'],
    ]],
  ]],
];

// ---------- build hierarchy ----------
const domains = [], capabilities = [], features = [];
const byName = new Map();
for (const [did, dname, dsum, caps] of D) {
  const dom = { id: did, name: dname, summary: dsum, capabilities: [] };
  domains.push(dom);
  let n = 0;
  caps.forEach(([cname, feats], ci) => {
    const cid = `${did}.${ci + 1}`;
    capabilities.push({ id: cid, domain: did, name: cname, features: [] });
    dom.capabilities.push(cid);
    for (const [name, summary, stage, priority, kind, milestone, surfaces] of feats) {
      n += 1;
      const id = `${did}-${String(n).padStart(2, '0')}`;
      const f = { id, name, summary, domain: did, capability: cid, stage, priority, kind: K[kind], milestone, surfaces: surfaces.split(',') };
      features.push(f); byName.set(name, f);
      capabilities[capabilities.length - 1].features.push(id);
    }
  });
}
const F = (name) => { const f = byName.get(name); if (!f) throw new Error('no feature ' + name); return f; };

// ---------- dependencies (feature depends on these) ----------
const deps = {
  'Magic-link login': ['Transactional email'],
  'Google sign-in': ['Email & password sign-in'],
  'Apple sign-in': ['Email & password sign-in'],
  'Two-factor auth for staff': ['Email & password sign-in', 'SMS reminders'],
  'Sessions & device list': ['Email & password sign-in'],
  'Staff roles & permissions': ['Email & password sign-in', 'Multi-tenant data isolation'],
  'Custom role builder': ['Staff roles & permissions', 'Audit log'],
  'Multi-studio account switching': ['Staff roles & permissions', 'Multi-location management'],
  'Audit log': ['Structured logging', 'Staff roles & permissions'],
  'Studio onboarding wizard': ['Locations & rooms', 'Class types catalog', 'Membership plans', 'Card payments'],
  'Member import from CSV': ['Background job queue'],
  'Legacy system migration': ['Member import from CSV', 'Membership plans', 'Class packs & credits', 'Background job queue'],
  'Branding & theme editor': ['File storage & CDN'],
  'Custom booking domain': ['Embeddable booking widget', 'File storage & CDN'],
  'Multi-location management': ['Locations & rooms', 'Staff roles & permissions', 'Tax handling', 'Multi-tenant data isolation'],
  'Equipment & resource booking': ['Locations & rooms', 'Book a class'],
  'Recurring class schedule': ['Class types catalog', 'Locations & rooms'],
  'Drag-and-drop timetable editor': ['Recurring class schedule'],
  'Schedule templates': ['Recurring class schedule'],
  'Class capacity rules': ['Recurring class schedule', 'Background job queue'],
  'Substitute instructor swap': ['Recurring class schedule', 'Push notifications', 'Sub request board'],
  '1:1 appointments': ['Instructor availability', 'Card payments'],
  'Buffers & travel time': ['1:1 appointments', 'Multi-location management'],
  'Small-group private sessions': ['1:1 appointments', 'Book for friends & family'],
  'Workshops & events': ['Card payments', 'Book a class'],
  'Multi-session courses': ['Workshops & events', 'Recurring billing engine'],
  'Virtual classes': ['Book a class', 'Transactional email'],
  'Book a class': ['Recurring class schedule', 'Membership plans', 'Class packs & credits'],
  'Cancellation & late-cancel policy': ['Book a class', 'Card payments'],
  'Waitlist with auto-promote': ['Book a class', 'Background job queue', 'Push notifications', 'SMS reminders'],
  'Spot selection': ['Book a class', 'Locations & rooms'],
  'Book for friends & family': ['Book a class', 'Card payments'],
  'Recurring auto-booking': ['Book a class', 'Background job queue'],
  'QR check-in': ['Book a class', 'Member mobile app'],
  'Front-desk check-in kiosk': ['QR check-in', 'Payment terminal', 'Staff roles & permissions'],
  'No-show tracking & penalties': ['Book a class', 'Card payments'],
  'Attendance history': ['Book a class'],
  'Membership plans': ['Recurring billing engine'],
  'Class packs & credits': ['Card payments'],
  'Intro offers': ['Membership plans', 'Promo codes'],
  'Family plans': ['Membership plans', 'Book for friends & family'],
  'Freeze & pause membership': ['Membership plans', 'Recurring billing engine'],
  'Corporate memberships': ['Membership plans', 'Invoices & receipts'],
  'Card payments': ['Card data tokenization'],
  'Recurring billing engine': ['Card payments', 'Background job queue'],
  'Failed-payment dunning': ['Recurring billing engine', 'Transactional email', 'SMS reminders'],
  'Invoices & receipts': ['Card payments', 'Transactional email'],
  'Refunds & account credit': ['Card payments'],
  'Tax handling': ['Invoices & receipts', 'Locations & rooms'],
  'Bank debit (SEPA)': ['Recurring billing engine', 'Failed-payment dunning'],
  'Payout reconciliation': ['Card payments', 'Refunds & account credit', 'Tax handling'],
  'Gift cards': ['Card payments'],
  'Retail point of sale': ['Payment terminal', 'Front-desk check-in kiosk'],
  'Member mobile app': ['Email & password sign-in', 'Book a class'],
  'Push notifications': ['Member mobile app', 'Background job queue'],
  'Wallet pass': ['Member mobile app', 'QR check-in'],
  'Member profile': ['Email & password sign-in'],
  'Digital waiver signing': ['Member profile', 'File storage & CDN'],
  'Progress & milestones': ['Attendance history', 'Member mobile app'],
  'Favourites & follow instructors': ['Push notifications'],
  'Embeddable booking widget': ['Book a class'],
  'SEO class pages': ['Embeddable booking widget', 'Class types catalog'],
  'Reviews & ratings': ['Attendance history'],
  'Instructor app mode': ['Member mobile app', 'Staff roles & permissions'],
  'Class roster & notes': ['Instructor app mode', 'Book a class'],
  'Sub request board': ['Instructor app mode', 'Push notifications'],
  'Pay rates & payroll export': ['Attendance history', 'Staff roles & permissions'],
  'Instructor performance stats': ['Instructor reports'],
  'Calendar availability sync': ['Instructor availability'],
  'Transactional email': ['Background job queue'],
  'SMS reminders': ['Background job queue'],
  'Notification preferences': ['Member profile'],
  'Message template editor': ['Transactional email'],
  'Email campaigns': ['Transactional email', 'Notification preferences'],
  'Automated journeys': ['Email campaigns', 'Churn risk scores'],
  'Two-way member inbox': ['Push notifications'],
  'Promo codes': ['Card payments'],
  'Referral program': ['Promo codes', 'Push notifications'],
  'Lead capture forms': ['Embeddable booking widget'],
  'Trial-to-member funnel': ['Intro offers', 'Lead capture forms', 'Automated journeys'],
  'Social booking button': ['Public REST API'],
  'Loyalty points': ['Attendance history'],
  'Studio KPI dashboard': ['Revenue reports', 'Attendance history'],
  'Revenue reports': ['Card payments', 'Recurring billing engine'],
  'Attendance & utilisation heatmap': ['Attendance history'],
  'Instructor reports': ['Attendance history', 'Pay rates & payroll export'],
  'Churn risk scores': ['Attendance history', 'Recurring billing engine'],
  'Custom report builder': ['Revenue reports'],
  'Scheduled report emails': ['Studio KPI dashboard', 'Transactional email'],
  'CSV data export': ['Background job queue'],
  'Public REST API': ['Rate limiting & abuse protection', 'Staff roles & permissions'],
  'Webhooks': ['Public REST API', 'Background job queue'],
  'Automation connector': ['Webhooks'],
  'Calendar feed (iCal)': ['Book a class'],
  'Accounting sync': ['Payout reconciliation', 'Tax handling'],
  'Wearables heart-rate': ['Member mobile app'],
  'Door access control': ['QR check-in', 'Member mobile app'],
  'Payment terminal': ['Card payments'],
  'Schedule optimizer': ['Attendance & utilisation heatmap', 'Recurring class schedule'],
  'Auto-written class descriptions': ['Class types catalog'],
  'Churn outreach drafts': ['Churn risk scores', 'Email campaigns'],
  'Operations anomaly alerts': ['Revenue reports'],
  'Chat booking assistant': ['Book a class', 'Public REST API'],
  'Waitlist odds prediction': ['Waitlist with auto-promote'],
  'Multi-tenant data isolation': [],
  'Background job queue': [],
  'Database backups & point-in-time restore': [],
  'Disaster recovery plan': ['Database backups & point-in-time restore'],
  'Rate limiting & abuse protection': ['Structured logging'],
  'Feature flag service': [],
  'Distributed tracing': ['Structured logging'],
  'Uptime & SLO dashboards': ['Structured logging'],
  'On-call alerting': ['Uptime & SLO dashboards'],
  'Cloud cost monitoring': ['Structured logging'],
  'GDPR export & erasure': ['Background job queue', 'Audit log'],
  'SOC 2 controls': ['Audit log', 'Disaster recovery plan', 'Two-factor auth for staff'],
  'Data retention policies': ['GDPR export & erasure'],
  'End-to-end test suite': ['Preview environments'],
  'Agent sandbox & guardrails': ['CI pipeline'],
  'Release train automation': ['CI pipeline', 'End-to-end test suite', 'Feature flag service'],
};
let edgeCount = 0;
for (const f of features) { f.dependsOn = (deps[f.name] || []).map((n) => F(n).id); edgeCount += f.dependsOn.length; }
for (const f of features) f.usedBy = features.filter((g) => g.dependsOn.includes(f.id)).map((g) => g.id);

// ---------- per-feature generation ----------
const STUDIOS = 412;
const humanOwnerByDomain = { IAM: 'tomas', STU: 'dev', SCH: 'dev', BKG: 'dev', PAY: 'mara', MEM: 'lea', INS: 'dev', COM: 'dev', GRO: 'sam', ANA: 'mara', INT: 'tomas', AIA: 'dev', PLT: 'priya' };
const agentBySurface = (s) => s.includes('mobile') ? 'forge-3' : s.includes('integrations') ? 'forge-4' : (s.includes('web-admin') || s.includes('web-member')) && !s.includes('api') ? 'forge-2' : 'forge-1';
const stageIdx = (s) => STAGES.indexOf(s);
const pastStage = (f, s) => f.stage === 'deprecated' ? true : stageIdx(f.stage) >= stageIdx(s);
const dataClassFor = (f) => f.domain === 'PAY' || /Card|terminal|Payout|Accounting|Gift/.test(f.name) ? 'payment'
  : ['IAM', 'MEM', 'BKG', 'COM'].includes(f.domain) || /GDPR|Churn|import|migration|export|profile|Audit|Wearables|Door|Lead/i.test(f.name) ? 'personal'
  : f.kind === 'platform' ? 'internal' : 'public';

for (const f of features) {
  const s = f.stage;
  // history of stage transitions
  const order = ['idea', 'specified', 'in-dev', 'in-review', 'flagged', 'live'];
  const target = s === 'deprecated' ? 'live' : s;
  // days ago the feature entered its current (target) stage
  const M1ago = 115; // 2026-06-15
  if (target === 'live' && f.milestone === 'M1' && chance(0.4)) f.milestone = null; // shipped after the beta
  const enteredAgo = target === 'live' ? (f.milestone === 'M1' ? ri(M1ago + 1, M1ago + 45) : ri(10, 110))
    : { idea: ri(3, 120), specified: ri(3, 60), 'in-dev': ri(2, 30), 'in-review': ri(1, 10), flagged: ri(5, 40) }[target];
  const steps = order.slice(0, order.indexOf(target) + 1);
  const history = [];
  let at = enteredAgo;
  for (let i = steps.length - 1; i >= 0; i--) {
    history.unshift({ stage: steps[i], date: day(at) });
    at += steps[i - 1] === 'idea' ? ri(2, 30) : steps[i - 1] === 'specified' ? ri(2, 10) : steps[i - 1] === 'in-dev' ? ri(3, 14) : ri(1, 7);
  }
  if (s === 'deprecated') { history.forEach((h) => { h.date = day((TODAY - new Date(h.date + 'T00:00:00Z')) / 864e5 + 60); }); history.push({ stage: 'deprecated', date: day(ri(20, 50)) }); }
  f.history = history;
  f.stageSince = history[history.length - 1].date;
  f.created = history[0].date;

  const owner = humanOwnerByDomain[f.domain];
  const builders = [];
  if (pastStage(f, 'in-dev')) {
    const a = agentBySurface(f.surfaces);
    builders.push(a);
    if (f.surfaces.length > 2 && chance(0.6)) builders.push(pick(['forge-1', 'forge-2', 'forge-3', 'forge-4'].filter((x) => x !== a)));
    if (chance(0.15)) builders.push('tomas');
  }
  f.owner = owner;
  f.builtBy = builders;

  const live = s === 'live' || s === 'deprecated';
  const shipped = live || s === 'flagged';
  const started = pastStage(f, 'in-dev');
  const dataClass = dataClassFor(f);

  // ----- business lens
  const value = { P0: ri(4, 5), P1: ri(3, 5), P2: ri(2, 4), P3: ri(1, 3) }[f.priority];
  const requests = f.kind === 'customer' || f.kind === 'business' ? ri(0, live ? 6 : 11) : ri(0, 3);
  const adoption = live ? Math.round((f.kind === 'platform' ? 100 : ri(18, 96))) : s === 'flagged' ? null : null;
  f.business = {
    value, // 1..5
    confidence: live ? 'measured' : pastStage(f, 'specified') ? pick(['validated', 'validated', 'hypothesis']) : 'hypothesis',
    customerRequests30d: requests,
    adoptionPct: adoption, // share of the 412 studios using it in the last 30 days
    revenueLink: ['PAY', 'GRO'].includes(f.domain) || f.priority === 'P0' ? pick(['direct', 'retention', 'direct']) : pick(['retention', 'indirect', 'none', 'indirect']),
    mrrImpactUsd: f.kind === 'business' || f.domain === 'PAY' ? ri(2, 30) * 500 : (value >= 4 ? ri(1, 8) * 250 : 0),
    health: 'good',
  };
  // ----- product & design lens
  const designStates = ['none', 'sketch', 'wireframe', 'hi-fi', 'implemented', 'polished'];
  const ux = f.kind === 'platform' && !f.surfaces.some((x) => x.startsWith('web') || x === 'mobile');
  f.design = ux ? { status: 'n/a', a11y: 'n/a', specDrift: false, health: 'na' } : {
    status: live ? pick(['implemented', 'polished', 'polished', 'implemented']) : shipped ? pick(['implemented', 'hi-fi']) : started ? pick(['hi-fi', 'wireframe', 'none']) : pastStage(f, 'specified') ? pick(['wireframe', 'sketch', 'none']) : 'none',
    a11y: shipped ? pick(['pass', 'pass', 'partial', 'unknown']) : 'unknown',
    specDrift: false,
    health: 'good',
  };
  // ----- development lens
  const progress = { idea: 0, specified: 0, 'in-dev': ri(15, 80), 'in-review': ri(85, 97), flagged: 100, live: 100, deprecated: 100 }[s];
  const aiShare = started ? (builders.includes('tomas') ? ri(40, 75) : ri(78, 100)) : 0;
  f.development = {
    status: { idea: 'not-started', specified: 'not-started', 'in-dev': 'in-progress', 'in-review': 'in-review', flagged: 'merged', live: 'done', deprecated: 'done' }[s],
    progressPct: progress,
    aiAuthoredPct: aiShare,
    humanReviewed: started ? (live ? chance(0.97) : s === 'in-review' ? false : s === 'flagged' ? chance(0.85) : chance(0.6)) : null,
    openPRs: s === 'in-dev' ? ri(1, 4) : s === 'in-review' ? ri(1, 3) : live && chance(0.25) ? 1 : 0,
    unitCoveragePct: started ? ri(live ? 55 : 30, 94) : null,
    techDebt: started ? pick([0, 0, 0, 1, 1, 1, 2]) : null, // 0 none .. 3 severe
    linesOfCode: started ? ri(4, 60) * 100 : 0,
    lastCommit: started ? day(live ? ri(2, 60) : ri(0, 6)) : null,
    health: 'good',
  };
  // ----- operations lens
  const env = live ? 'production' : s === 'flagged' ? 'production' : s === 'in-review' ? 'staging' : s === 'in-dev' ? (chance(0.5) ? 'preview' : 'none') : 'none';
  f.operations = {
    environment: env,
    flag: shipped || s === 'in-review' ? { key: f.id.toLowerCase().replace('-', '_') + '_' + f.name.toLowerCase().replace(/[^a-z]+/g, '_').slice(0, 18).replace(/_$/, ''), rolloutPct: live ? 100 : s === 'flagged' ? pick([5, 10, 25, 25, 50, 50]) : 0 } : null,
    sloTarget: shipped ? (f.priority === 'P0' ? 99.9 : 99.5) : null,
    sloActual: shipped ? +(99.5 + rnd() * 0.49).toFixed(2) : null,
    p95ms: shipped ? ri(80, 520) : null,
    errorRatePct: shipped ? +(rnd() * 0.4).toFixed(2) : null,
    incidents30d: shipped ? (chance(0.06) ? 1 : 0) : 0,
    alerting: shipped ? chance(0.9) : false,
    runbook: shipped ? chance(0.6) : false,
    costUsdMonth: shipped ? ri(1, 40) * 10 : 0,
    health: 'good',
  };
  if (shipped && f.operations.sloActual < f.operations.sloTarget) f.operations.sloActual = +(f.operations.sloTarget + 0.02).toFixed(2);
  // ----- security lens
  f.security = {
    dataClass, // public | internal | personal | payment
    review: dataClass === 'public' ? 'not-required' : live ? (chance(0.06) ? 'findings' : 'passed') : s === 'flagged' || s === 'in-review' ? (chance(0.8) ? 'passed' : 'pending') : started ? 'pending' : 'not-started',
    openFindings: 0,
    health: 'good',
  };
  if (f.security.review === 'findings') f.security.openFindings = ri(1, 2);
  // ----- quality lens
  const e2eTotal = shipped ? ri(3, 18) : s === 'in-review' ? ri(2, 8) : s === 'in-dev' ? ri(0, 4) : 0;
  f.quality = {
    status: shipped ? (chance(0.15) ? 'partial' : 'passed') : s === 'in-review' ? 'testing' : s === 'in-dev' ? 'untested' : 'n/a',
    e2eTests: e2eTotal, e2ePassing: e2eTotal,
    openBugs: { p1: 0, p2: shipped ? ri(0, 2) : 0, p3: shipped ? ri(0, 4) : 0 },
    health: 'good',
  };
  f.parts = null; f.notes = [];
}

// ---------- the stories: deliberate tensions between lenses ----------
const story = (name, fn) => fn(F(name));
story('Failed-payment dunning', (f) => {
  f.builtBy = ['forge-1', 'forge-4']; f.development.aiAuthoredPct = 100; f.development.humanReviewed = false;
  f.operations.flag.rolloutPct = 25; f.operations.incidents30d = 0; f.security.review = 'pending'; f.security.openFindings = 0; f.quality.status = 'partial'; f.quality.e2eTests = 6; f.quality.e2ePassing = 4;
  f.business.mrrImpactUsd = 14500; f.business.value = 5;
  f.notes.push({ by: 'jonas', date: day(1), text: 'Retries card charges and touches payment data. Security review not done; it is already live for a quarter of studios.' });
  f.notes.push({ by: 'tender', date: day(3), text: 'Rollout raised 10% -> 25% after 72h with no errors.' });
});
story('Waitlist with auto-promote', (f) => {
  f.operations.incidents30d = 2; f.operations.sloActual = 99.71; f.operations.sloTarget = 99.9; f.operations.p95ms = 1840; f.operations.errorRatePct = 1.3;
  f.quality.openBugs.p1 = 1; f.quality.status = 'failing'; f.quality.e2ePassing = f.quality.e2eTests - 2;
  f.notes.push({ by: 'priya', date: day(5), text: 'INC-212: two members promoted into the same last spot at 7am rush. Race in the promote job. Hotfix holds, real fix in PR.' });
  f.notes.push({ by: 'sam', date: day(2), text: 'Three studios asked this week whether the double-booking is fixed.' });
  f.development.openPRs = 1;
});
story('Progress & milestones', (f) => {
  f.operations.flag.rolloutPct = 50; f.business.adoptionPct = null; f.business.value = 2; f.business.confidence = 'hypothesis';
  f.business.usageNote = 'Opened by 3% of members who have it switched on.';
  f.notes.push({ by: 'mara', date: day(9), text: 'Hypothesis was retention. Usage says nobody looks. Decide: improve or remove.' });
});
story('Tax handling', (f) => {
  f.development.progressPct = 35; f.development.openPRs = 3; f.priority = 'P0';
  f.parts = [
    { name: 'Tax rates per location', done: true }, { name: 'Tax-inclusive price display', done: true },
    { name: 'Tax on invoices & receipts', done: false }, { name: 'EU VAT rules for digital services', done: false },
    { name: 'US sales tax by state', done: false }, { name: 'Tax report export', done: false },
  ];
  f.notes.push({ by: 'dev', date: day(1), text: 'Critical path for Payments GA. At this pace it lands Oct 29, a week late. Payout reconciliation and accounting sync wait on it.' });
});
story('Distributed tracing', (f) => {
  f.development.progressPct = 40;
  f.notes.push({ by: 'priya', date: day(4), text: 'Without tracing we cannot see where waitlist and billing jobs slow down.' });
});
story('Public REST API', (f) => {
  f.operations.flag.rolloutPct = 10; f.operations.alerting = false; f.operations.runbook = false;
  f.notes.push({ by: 'priya', date: day(6), text: 'Live for 41 partner studios, but rate limiting is still in review. One bad script can hurt everyone.' });
});
story('Audit log', (f) => { f.development.progressPct = 60; f.notes.push({ by: 'jonas', date: day(8), text: 'SOC 2 and GDPR erasure both depend on this.' }); });
story('Legacy landing page builder', (f) => {
  f.business.adoptionPct = 14; f.operations.costUsdMonth = 640; f.operations.alerting = false; f.security.review = 'findings'; f.security.openFindings = 2;
  f.notes.push({ by: 'sam', date: day(12), text: '58 studios still publish pages with it. Need a migration path before switching off.' });
});
story('Auto-written class descriptions', (f) => {
  f.design.specDrift = true; f.development.humanReviewed = false; f.development.aiAuthoredPct = 100;
  f.notes.push({ by: 'lea', date: day(2), text: 'Spec said suggest-then-confirm. Built version overwrites the description directly. Spec drift.' });
});
story('Legacy system migration', (f) => {
  f.business.customerRequests30d = 38; f.business.value = 5; f.development.progressPct = 45;
  f.notes.push({ by: 'sam', date: day(1), text: 'Asked in 38 sales calls this month. Most-requested thing we do not have.' });
});
story('Front-desk check-in kiosk', (f) => { f.design.status = 'wireframe'; f.design.a11y = 'fail'; f.notes.push({ by: 'lea', date: day(3), text: 'Touch targets too small, contrast fails. Built from a wireframe, never had a hi-fi pass.' }); });
story('SMS reminders', (f) => { f.operations.costUsdMonth = 2840; f.notes.push({ by: 'priya', date: day(7), text: 'SMS cost up 3.1x in four weeks. Waitlist promotions send duplicates.' }); });
story('Multi-location management', (f) => {
  f.development.progressPct = 25;
  f.parts = [
    { name: 'Location-scoped data model', done: true }, { name: 'Shared plans across locations', done: false },
    { name: 'Cross-location booking', done: false }, { name: 'Per-location reporting', done: false },
    { name: 'Location switcher in admin', done: true }, { name: 'Per-location tax', done: false },
  ];
});
story('End-to-end test suite', (f) => { f.development.progressPct = 30; f.notes.push({ by: 'ines', date: day(2), text: 'Covers booking and sign-in. Payments journeys have no browser tests at all.' }); });
story('Recurring auto-booking', (f) => { f.business.customerRequests30d = 24; f.business.value = 5; f.priority = 'P0'; f.notes.push({ by: 'sam', date: day(4), text: 'Members of three big studios churn citing "had to rebook every week".' }); });
story('Bank debit (SEPA)', (f) => { f.security.review = 'pending'; f.quality.status = 'testing'; f.quality.e2eTests = 4; f.quality.e2ePassing = 3; });
story('Door access control', (f) => { f.security.review = 'pending'; f.development.humanReviewed = false; f.notes.push({ by: 'jonas', date: day(5), text: 'Physical access. Needs threat model before any studio gets it.' }); });
story('Card data tokenization', (f) => { f.security.review = 'passed'; f.development.humanReviewed = true; });
story('Recurring billing engine', (f) => { f.development.techDebt = 3; f.development.unitCoveragePct = 61; f.notes.push({ by: 'tomas', date: day(10), text: 'Three agents have patched proration independently. Needs one owner and a rewrite of the proration module.' }); });
story('Background job queue', (f) => { f.operations.p95ms = 340; f.operations.alerting = true; f.operations.runbook = true; f.notes.push({ by: 'priya', date: day(5), text: 'Queue depth spikes at 06:45 daily when reminders, billing and waitlist all fire.' }); });
story('Churn risk scores', (f) => { f.security.review = 'pending'; f.notes.push({ by: 'jonas', date: day(11), text: 'Profiling members. Needs a DPIA before it reaches studios.' }); });
story('Rate limiting & abuse protection', (f) => { f.development.humanReviewed = false; });
story('Spot selection', (f) => { f.operations.flag.rolloutPct = 50; f.business.adoptionPct = null; f.business.usageNote = 'Used in 71% of bookings at studios that have it.'; f.business.value = 4; });
story('Agent sandbox & guardrails', (f) => { f.notes.push({ by: 'tomas', date: day(3), text: 'Guardrails require human review for payments and auth paths. Dunning slipped through via a flag change.' }); });
story('Cookie consent', (f) => { f.operations.alerting = false; });
story('Studio KPI dashboard', (f) => { f.business.adoptionPct = 88; });
story('Book a class', (f) => { f.business.adoptionPct = 100; f.quality.openBugs.p2 = 1; f.development.humanReviewed = true; f.security.review = 'passed'; f.security.openFindings = 0; });
// a few live features with no alerting/runbook (unwatched)
['Calendar feed (iCal)', 'Virtual classes', 'Attendance history', 'No-show tracking & penalties'].forEach((n) => { const f = F(n); f.operations.alerting = false; f.operations.runbook = false; });
// a few shipped without human review
['Message template editor', 'Workshops & events', 'Calendar availability sync'].forEach((n) => { F(n).development.humanReviewed = false; });
// stalled items (no commits for a while while in-dev)
['Favourites & follow instructors', 'Lead capture forms', 'SEO class pages'].forEach((n) => { const f = F(n); f.development.lastCommit = day(ri(16, 30)); f.development.stalled = true; });

// ---------- compute per-lens health ----------
for (const f of features) {
  const s = f.stage; const live = s === 'live' || s === 'deprecated'; const shipped = live || s === 'flagged';
  const b = f.business;
  b.health = (f.priority === 'P0' && !pastStage(f, 'in-dev')) || (b.customerRequests30d >= 15 && !shipped) ? 'bad'
    : (shipped && b.value <= 2) || (live && b.adoptionPct !== null && b.adoptionPct < 25 && f.kind !== 'platform') || s === 'deprecated' ? 'watch' : 'good';
  if (f.design.health !== 'na') f.design.health = f.design.a11y === 'fail' || f.design.specDrift ? 'bad' : (shipped && ['none', 'sketch', 'wireframe'].includes(f.design.status)) || f.design.a11y === 'partial' ? 'watch' : 'good';
  const d = f.development;
  d.health = !pastStage(f, 'in-dev') ? 'na' : (d.humanReviewed === false && shipped) || d.techDebt === 3 ? 'bad' : d.stalled || d.techDebt === 2 || (d.unitCoveragePct !== null && d.unitCoveragePct < 40) ? 'watch' : 'good';
  const o = f.operations;
  o.health = !shipped ? 'na' : o.incidents30d >= 2 || o.sloActual < o.sloTarget ? 'bad' : o.incidents30d === 1 || !o.alerting ? 'watch' : 'good';
  const sc = f.security;
  sc.health = sc.dataClass === 'public' && sc.review !== 'findings' ? (pastStage(f, 'in-dev') ? 'good' : 'na') : sc.openFindings > 0 || (shipped && sc.review === 'pending') ? 'bad' : sc.review === 'pending' ? 'watch' : sc.review === 'not-started' ? 'na' : 'good';
  const q = f.quality;
  q.health = q.status === 'n/a' ? 'na' : q.status === 'failing' || q.openBugs.p1 > 0 ? 'bad' : q.status === 'partial' || q.e2ePassing < q.e2eTests || (shipped && q.e2eTests < 3) ? 'watch' : q.status === 'untested' ? 'na' : 'good';
  const hs = [b.health, f.design.health, d.health, o.health, sc.health, q.health];
  f.health = hs.includes('bad') ? 'bad' : hs.includes('watch') ? 'watch' : 'good';
  f.flags = [];
  if (d.humanReviewed === false && shipped) f.flags.push('ai-unreviewed-in-production');
  if (shipped && !o.alerting) f.flags.push('unmonitored');
  if (o.incidents30d > 0) f.flags.push('incident');
  if (sc.health === 'bad') f.flags.push('security-gap');
  if (f.design.specDrift) f.flags.push('spec-drift');
  if (d.stalled) f.flags.push('stalled');
  if (f.priority === 'P0' && !pastStage(f, 'in-dev')) f.flags.push('priority-not-started');
  if (b.customerRequests30d >= 15 && !shipped) f.flags.push('demand-waiting');
  const blockers = f.dependsOn.map((id) => features.find((g) => g.id === id)).filter((g) => stageIdx(g.stage) < stageIdx('flagged') && g.stage !== 'deprecated');
  if (pastStage(f, 'in-dev') && !shipped && blockers.length) { f.blockedBy = blockers.map((g) => g.id); f.flags.push('blocked'); } else f.blockedBy = [];
}

// ---------- activity (last 14 days) ----------
const activity = [];
const product_asOf = TODAY.toISOString().replace('.000', '');
const ev = (n, type, f, actor, text, extra = {}) => activity.push({ at: ts(n), type, feature: f.id, actor, text, ...extra });
for (const f of features) {
  const s = f.stage;
  const agents = f.builtBy.filter((x) => x.startsWith('forge'));
  if (['in-dev', 'in-review'].includes(s) && !f.development.stalled) {
    for (let i = 0; i < ri(2, 6); i++) ev(ri(0, 13), 'commit', f, pick(agents.length ? agents : ['forge-1']), `${ri(1, 9)} commits: ${pick(['implement', 'refactor', 'add tests for', 'fix edge case in', 'wire up', 'migrate schema for'])} ${f.name.toLowerCase()}`);
    ev(ri(0, 9), 'pr-opened', f, pick(agents.length ? agents : ['forge-1']), `PR #${ri(1400, 1990)} opened`);
  }
  if (s === 'in-review') ev(ri(0, 4), 'review', f, 'warden', pick(['Review agent: 2 comments, changes requested', 'Review agent: approved, awaiting human', 'Review agent: test gaps flagged']));
  if (s === 'flagged' || s === 'live') {
    if (chance(s === 'flagged' ? 0.9 : 0.35)) ev(ri(0, 13), 'deploy', f, 'tender', 'Deployed to production');
    if (s === 'flagged') ev(ri(0, 13), 'flag', f, pick(['tender', 'dev', 'priya']), `Rollout set to ${f.operations.flag.rolloutPct}%`);
  }
  if (f.operations.incidents30d) ev(ri(3, 12), 'incident', f, 'priya', `Incident opened: ${pick(['elevated errors', 'latency spike', 'job backlog'])}`, { severity: f.operations.incidents30d > 1 ? 'SEV2' : 'SEV3' });
  for (const n of f.notes) activity.push({ at: n.date + 'T' + String(ri(8, 18)).padStart(2, '0') + ':' + String(ri(0, 59)).padStart(2, '0') + ':00Z', type: 'comment', feature: f.id, actor: n.by, text: n.text });
  const last = f.history[f.history.length - 1];
  const age = (TODAY - new Date(last.date + 'T00:00:00Z')) / 864e5;
  if (age <= 14 && f.history.length > 1) activity.push({ at: last.date + 'T' + String(ri(6, 22)).padStart(2, '0') + ':' + String(ri(0, 59)).padStart(2, '0') + ':00Z', type: 'stage', feature: f.id, actor: last.stage === 'flagged' ? 'tender' : last.stage === 'specified' ? f.owner : pick(f.builtBy.length ? f.builtBy : [f.owner]), text: `Stage: ${f.history[f.history.length - 2].stage} -> ${last.stage}`, from: f.history[f.history.length - 2].stage, to: last.stage });
  if (s === 'idea' && chance(0.3)) ev(ri(0, 13), 'comment', f, pick(['sam', 'mara', 'dev']), pick(['Another studio asked for this today.', 'Worth a spike next month?', 'Competitor launched this; watching uptake.']));
}
for (const a of activity) if (a.at > product_asOf) a.at = a.at.slice(0, 11) + '0' + ri(6, 8) + a.at.slice(13);
for (const a of activity) if (a.type === 'deploy') a.text = `Deployed to production (release ${a.at.slice(0, 10).replaceAll('-', '.')})`;
activity.sort((a, b) => (a.at < b.at ? 1 : -1));

// ---------- weekly snapshots from history ----------
const snapshots = [];
for (let w = 26; w >= 0; w--) {
  const date = day(w * 7);
  const counts = Object.fromEntries(STAGES.map((s) => [s, 0]));
  for (const f of features) {
    const st = [...f.history].reverse().find((h) => h.date <= date);
    if (st) counts[st.stage] += 1;
  }
  snapshots.push({ week: date, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) });
}

const product = {
  name: 'Kettle',
  tagline: 'Booking, memberships and payments for independent fitness studios.',
  asOf: TODAY.toISOString().replace('.000', ''),
  stack: {
    'web-admin': 'Studio admin web app (Next.js, TypeScript)',
    'web-member': 'Member booking site and embeddable widget (Next.js)',
    mobile: 'Member & instructor app (React Native, iOS + Android)',
    api: 'API server (Node.js, TypeScript, tRPC + REST)',
    workers: 'Background workers (job queue on Redis)',
    db: 'PostgreSQL, multi-tenant schema',
    integrations: 'Payment processor, SMS, email, calendars, accounting',
    infra: 'Cloud containers, CDN, CI/CD, observability',
  },
  business: { studios: STUDIOS, members: 61240, mrrUsd: 148300, mrrGrowthPct30d: 6.8, churnPct30d: 2.1 },
  team: 'Eight humans supervise four build agents, one review agent and one ops agent.',
};

const data = { product, lenses: ['business', 'design', 'development', 'operations', 'security', 'quality'], stages: STAGES, people, milestones, domains, capabilities, features, activity, snapshots };
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'kettle.json'), JSON.stringify(data, null, 1));
if (process.argv.includes('--js')) fs.writeFileSync(path.join(OUT, 'kettle.js'), '// Kettle product blueprint data. Loads as a global: window.KETTLE\nwindow.KETTLE = ' + JSON.stringify(data) + ';\n');

// summary
const cnt = (arr, k) => arr.reduce((m, x) => ((m[k(x)] = (m[k(x)] || 0) + 1), m), {});
console.log('domains', domains.length, 'capabilities', capabilities.length, 'features', features.length, 'edges', edgeCount, 'activity', activity.length);
console.log('stages', cnt(features, (f) => f.stage));
console.log('health', cnt(features, (f) => f.health));
console.log('flags', cnt(features.flatMap((f) => f.flags), (x) => x));
for (const l of data.lenses) console.log(l, cnt(features, (f) => f[l].health));
console.log('kinds', cnt(features, (f) => f.kind));
console.log('bytes', fs.statSync(path.join(OUT, 'kettle.json')).size);
