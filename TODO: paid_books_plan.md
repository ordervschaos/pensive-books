# Paid Books on Pensive — Planning Doc

Date: 2026-05-21
Status: Research / planning. No code changes yet.

---

## 1. What we're building (in one sentence)

A marketplace where authors publish books on Pensive, readers buy them (with a free sample), and Pensive collects payment, handles taxes, and pays the author a royalty.

## 2. Why it matters

- Pensive today is a free reading/writing tool. Monetization is currently zero. Paid books unlocks creator GMV revenue and gives serious authors a reason to publish here vs Substack/Gumroad/Amazon KDP.
- It also lets *you* monetize your own books on the platform without bolting on Gumroad.

## 3. Where this fits in the codebase

Two existing apps:

```
pensive-books/
├── apps/
│   ├── web/         # Vite SPA   → app.pensive.me  (reader + editor, behind auth)
│   └── marketing/   # Next.js    → pensive.me      (statically generated, SEO-first)
└── supabase/        # Postgres + RLS + Edge Functions
```

Books table (`schema.sql`) already has: `is_public`, `published_at`, `slug`, `author`, `cover_url`, versioning (`book_versions`, `page_versions`), and a `book_access_level` enum (`view` / `edit`) for collaborator sharing.

What's missing: pricing, entitlements (who has paid for what), author payout accounts, a sample-pages concept, and any payment-processor integration.

---

## 4. Product model — decisions to make first

These shape everything downstream. Order matters.

### 4.1 What kind of sale?

| Option | Pros | Cons | Recommendation |
|---|---|---|---|
| **One-time purchase per book** | Simple. Maps to existing book unit. | No recurring revenue. | **Start here.** |
| **Subscription** ($X/mo, all books) | Predictable revenue. Reader-friendly. | Hard at low catalog size; complicated author payout math (Spotify-style streaming pool). | Phase 3. |
| **Bundles** (series, author packs) | Higher AOV. | Needs UI for grouping. | Phase 2. |
| **Pay-what-you-want** | Low friction. | Lower yield. | Optional toggle later. |

### 4.2 What does "free sample" mean?

Three viable models:

1. **First N% / first N pages** auto-sampled. Easiest. Most Kindle-like.
2. **Author-marked sample pages** (per-page `is_sample boolean`). Gives author control. Matches your existing per-page model.
3. **Hybrid**: default to first 10%, author can override.

→ Recommend **#2** (per-page `is_sample` flag). You already version pages individually; the data model fits.

### 4.3 Pricing structure

- `price_cents` + `currency` per book, OR
- Multi-currency: store base price + Stripe/Paddle handles localized pricing.
- Minimum price (cover processor fees + tax): probably $1.99.
- Free books stay free (just don't set a price).

### 4.4 Revenue split

Industry benchmarks:
- **Amazon KDP**: 70% to author (with conditions), or 35%.
- **Substack**: 90% to author, 10% Substack.
- **Gumroad**: 90/10 + processing.
- **Apple/Google**: 70/30.

→ Suggest **author 80% / Pensive 20%** of *net* (after processor fees and tax). Aggressive enough to attract authors away from KDP-35% but leaves margin.

---

## 5. The system (visual)

```
                  ┌────────────────────────────────────────────────┐
                  │                  PENSIVE                       │
                  │                                                │
   ┌────────┐     │   ┌─────────┐    ┌──────────────┐              │
   │ Reader │────►│   │Marketing│────│ Reader app   │              │
   └────────┘     │   │  (SSG)  │    │   (SPA)      │              │
                  │   └─────────┘    └──────┬───────┘              │
                  │                         │                      │
                  │                         ▼                      │
                  │              ┌──────────────────┐              │
                  │              │  Entitlements    │              │
                  │              │   (RLS check)    │              │
                  │              └──────────────────┘              │
                  │                                                │
                  └──────────────┬─────────────────────────────────┘
                                 │
                ┌────────────────┼────────────────┐
                ▼                ▼                ▼
        ┌───────────────┐ ┌─────────────┐ ┌──────────────┐
        │ Payment proc. │ │  Supabase   │ │  Author      │
        │ (Paddle/Stripe)│ │  (DB+func)  │ │  payout rail │
        │                │ │             │ │ (Stripe Con.)│
        └───────┬───────┘ └─────────────┘ └──────┬───────┘
                │  webhook                         ▲
                ▼                                  │
        ┌───────────────┐                          │
        │  Author       │                  ┌──────────────┐
        │  (gets paid)  │◄─────────────────│  Pensive     │
        └───────────────┘   monthly payout │  (collects   │
                                           │   royalties) │
                                           └──────────────┘
```

**Stakeholders**: Reader, Author, Pensive (you), Payment processor, Tax authority (handled by processor if MoR).

---

## 6. Payment architecture — the most important choice

You have two fundamentally different paths.

### Path A — Merchant of Record (MoR): Paddle or Lemon Squeezy

**You sell to the reader. Paddle/LemonSqueezy is the legal seller.** They collect, remit VAT/GST/sales-tax worldwide, handle chargebacks, refunds, invoicing. You pay authors yourself.

- **Paddle**: ~5% + $0.50 per transaction. Handles 200+ countries. Strong VAT/MOSS support.
- **Lemon Squeezy** (now owned by Stripe): ~5% + $0.50. Better UX, slightly newer.

**Pros**:
- You are not on the hook for global tax compliance. This is *enormous*.
- Single integration covers ~every country.
- They handle EU 14-day refund, chargebacks, fraud.

**Cons**:
- Higher per-transaction fee (5% vs Stripe's 2.9%+$0.30).
- Less control over checkout UX.
- Paying authors becomes your problem (you'd still use Stripe Connect or Wise for that).

### Path B — Direct Stripe + Stripe Connect (marketplace)

**Reader buys directly from the author** via Stripe Connect Express accounts. Stripe routes funds to the author automatically, keeps your platform fee.

- Stripe: 2.9% + $0.30
- Connect: +0.25% + $0.25 per transfer
- Stripe Tax: +0.5% (and you still register where required)
- Stripe Express connected accounts: $2/mo per active payee

**Pros**:
- Lower fees.
- Author payouts are basically automatic.
- You own checkout UX.

**Cons**:
- **You** (or each author) must register for VAT/sales tax in each jurisdiction where you exceed nexus thresholds. EU MOSS, UK VAT, India GST, Australia GST, etc. This is the part that kills indie marketplaces.
- Stripe Tax helps compute but doesn't register/remit for you.
- Authors need KYC onboarding (Stripe Express handles this UI).

### Recommendation

**Start with Paddle (MoR).** Take the 2% fee hit in exchange for not having to register for VAT in 30+ countries before launch. When GMV justifies it (~$500k+/yr), migrate to Stripe Connect for margin.

There's a hybrid escape hatch: use **Paddle for international**, **Stripe for US-only** sellers. But that's complexity for later.

---

## 7. Paying authors (regardless of path A or B)

Even with Paddle handling the sale, you still need to send money to authors globally.

| Tool | Fee | Coverage | Notes |
|---|---|---|---|
| **Stripe Connect (Express)** | ~0.25% + $0.25 + $2/mo per active payee | 45+ countries | Best DX. Author onboards with hosted KYC. |
| **PayPal Payouts** | 2% capped at $20 | Wider country list | Worse author UX, but reaches countries Stripe doesn't (e.g., parts of Africa). |
| **Wise (formerly TransferWise) Business API** | 0.5–1.5% FX + small flat | Very wide | Good for low-volume, manual-ish flow. |
| **Tipalti / Payoneer** | Higher, enterprise | Global | Overkill until you have 1000+ payees. |

→ Use **Stripe Connect Express for payouts**, **Paddle for collection**. Yes, you're paying both — but each does what it's best at. You'll fall back to PayPal for the handful of unsupported countries.

---

## 8. Legalities — what you actually need

Grouped by category. Most of this is solved by picking an MoR; the rest you can't dodge.

### 8.1 Sales tax / VAT (the big one)
- **EU**: VAT applies on digital goods to consumers from the **first euro** (no threshold). Must register via OSS (One-Stop Shop).
- **UK**: 20% VAT, similar to EU.
- **India**: GST on imported digital services (OIDAR).
- **Australia**: GST on digital sales if AU revenue > A$75k.
- **Canada**: GST/HST/PST per province.
- **US**: Sales tax per state, economic nexus rules vary.
- **MoR solves all of this.** If you go direct-Stripe, plan for ~$5k/yr in tax filings + accountant.

### 8.2 Author agreements (contracts)
Need a clickwrap or signed agreement covering:
- Author **warrants they own the content** (or have rights to sell).
- Pensive gets a **non-exclusive license to host, distribute, sample, watermark, and process payment**.
- Revenue split, payout cadence, minimum payout threshold.
- Right to remove content for ToS violations / DMCA.
- Tax responsibility: author is responsible for income tax on royalties in their country.
- Termination clause.
- **Indemnification**: author indemnifies Pensive against copyright/defamation claims about their content.

You can draft a v1 of this yourself, but get a real lawyer to review before launch (~$1–3k one-time).

### 8.3 DMCA / copyright takedown
- Need designated DMCA agent (register with US Copyright Office, $6).
- Public takedown email + procedure.
- Counter-notice flow.
- "Repeat infringer" policy.

### 8.4 Refund policy
- **EU**: 14-day right of withdrawal for digital goods — but **waivable** if you make the user tick a box saying "I understand I lose my refund right by accessing this immediately." Standard pattern; Paddle handles this UI.
- Don't promise no-refunds globally; consumer protection laws override your ToS in many places.

### 8.5 Author tax forms (your obligation as payer)
- **US authors**: collect W-9. If you pay >$600/yr, issue 1099-NEC.
- **Non-US authors**: collect W-8BEN (treaty-rate exemption from US withholding). Without it, 30% US backup withholding applies.
- Stripe Connect collects these automatically. Big win for path B.

### 8.6 Content moderation
- Mature content gating (you already have this — keep it, expand it).
- Country-specific restrictions (e.g., certain religious/political content banned in some markets). Probably out of scope to handle pre-launch; rely on MoR's country list.
- Hate speech / illegal content reporting flow.

### 8.7 Data protection
- GDPR (EU), CCPA (California), UK DPA, LGPD (Brazil), India DPDP.
- You already collect emails; adding purchase history doesn't fundamentally change your posture.
- Need: privacy policy update, data export, data deletion (with carve-out for tax-record retention — must keep purchase records ~7 years).

### 8.8 KYC / AML
- For collecting: MoR handles.
- For paying out: Stripe Connect handles KYC on each author. They won't pay anyone they haven't verified.

### 8.9 Pensive itself
- Need a real legal entity (LLC or Ltd) for liability separation. If you don't have one, get one before taking money. ($300–500 to form in US/UK.)
- Business bank account.
- Bookkeeping (QuickBooks Self-Employed → Xero as you grow).

---

## 9. Database schema additions

Roughly what new tables/columns you'd need:

```sql
-- pricing on books
ALTER TABLE books ADD COLUMN price_cents integer;
ALTER TABLE books ADD COLUMN currency text DEFAULT 'USD';
ALTER TABLE books ADD COLUMN sale_status text DEFAULT 'free'; -- 'free' | 'paid' | 'withdrawn'

-- sample marker on pages
ALTER TABLE pages ADD COLUMN is_sample boolean DEFAULT false;

-- author payout accounts
CREATE TABLE author_payout_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users,
  stripe_connect_id text UNIQUE,
  payout_method text,           -- 'stripe' | 'paypal' | 'wise'
  country text,
  tax_form_status text,         -- 'pending' | 'on_file'
  agreement_accepted_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- purchases / entitlements
CREATE TABLE purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_user_id uuid REFERENCES auth.users,
  book_id integer REFERENCES books,
  processor text,               -- 'paddle' | 'stripe'
  processor_txn_id text UNIQUE, -- idempotency key from webhook
  amount_cents integer,
  currency text,
  fees_cents integer,           -- processor fee
  tax_cents integer,            -- VAT/sales tax collected
  net_cents integer,            -- amount we keep + author share
  status text,                  -- 'paid' | 'refunded' | 'disputed'
  purchased_at timestamptz,
  refunded_at timestamptz
);
CREATE INDEX ON purchases (buyer_user_id, book_id) WHERE status = 'paid';

-- royalty ledger (immutable accounting record)
CREATE TABLE royalty_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid REFERENCES purchases,
  author_user_id uuid REFERENCES auth.users,
  book_id integer REFERENCES books,
  gross_cents integer,
  author_share_cents integer,
  platform_share_cents integer,
  posted_at timestamptz DEFAULT now()
);

-- payouts (when we actually wire money)
CREATE TABLE author_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_user_id uuid REFERENCES auth.users,
  period_start date,
  period_end date,
  total_cents integer,
  currency text,
  stripe_transfer_id text,
  status text,                  -- 'pending' | 'paid' | 'failed'
  paid_at timestamptz
);
```

RLS for entitlements (the load-bearing rule):

```sql
-- A reader can read a page if:
--   page.is_sample = true, OR
--   they own the book (existing), OR
--   they have a paid, non-refunded purchase for the book
CREATE POLICY pages_paid_access ON pages FOR SELECT USING (
  is_sample = true
  OR EXISTS (SELECT 1 FROM books b WHERE b.id = pages.notebook_id AND b.owner_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM purchases p
    WHERE p.book_id = pages.notebook_id
      AND p.buyer_user_id = auth.uid()
      AND p.status = 'paid'
  )
);
```

(Adjust for your existing `is_public` and collaborator policies — this layers on top, not replaces.)

---

## 10. Anti-piracy (realistic version)

You **cannot** stop a determined pirate of digital text. Don't waste budget on DRM. Do:
- **Per-buyer watermark** in the page footer ("Licensed to alice@example.com — Purchase #abc123") — visible + steganographic in any PDF/EPUB export.
- **No bulk-export** button for paid books.
- **Signed, short-lived URLs** for cover assets.
- **Rate-limit page-fetch** per user (catches scraping).
- **Anomaly detection** on download patterns.

Accept that 1–2% leakage is the cost of doing business; the friction-vs-UX tradeoff sits there.

---

## 11. Cost model (back of envelope)

Assume Phase 1: 100 books, average price $9, 500 sales/mo = $4,500 GMV/mo.

| Line | Cost |
|---|---|
| Paddle fees (5% + $0.50) | ~$475/mo |
| Stripe Connect payouts (0.25%+$0.25+$2/payee, ~30 active payees) | ~$80/mo |
| Supabase Pro (you likely have already) | $25/mo |
| Mailgun (receipts/payout notices) | ~$15/mo |
| Crisp (already have) | — |
| Legal review (one-time) | $1,500 |
| LLC + bookkeeping (annual) | ~$1,000/yr |
| **Total monthly** | **~$595** + amortized legal |

Of remaining $3,905 net: 80% to authors = $3,124, **Pensive keeps ~$781/mo** at this volume. Doesn't pay rent yet — but the unit economics work and scale linearly.

---

## 12. Phased roadmap

### Phase 0 — Decide & set up (2–3 weeks, mostly off-keyboard)
- [ ] Form LLC if you haven't.
- [ ] Pick MoR (Paddle vs LemonSqueezy — recommend Paddle).
- [ ] Pick payout rail (Stripe Connect Express).
- [ ] Draft author agreement (template + lawyer review).
- [ ] Update privacy policy + ToS.
- [ ] Register DMCA agent.

### Phase 1 — First-party paid books (~3–4 weeks build)
You sell *your own* books only. No third-party authors yet. This proves the rails before you take on author management complexity.
- DB migrations for `price_cents`, `is_sample`, `purchases`.
- Paddle Checkout integration on a per-book "Buy" page.
- Webhook handler (Supabase edge function `paddle-webhook`) → inserts into `purchases`.
- RLS for sample vs paid pages.
- Reader-side UX: sample badge, paywall card, "Buy for $X" CTA, post-purchase success state.

### Phase 2 — Open to third-party authors (~4–6 weeks)
- Author onboarding flow: connect Stripe Express account, accept agreement, set price.
- Royalty ledger writes on every purchase webhook.
- Monthly payout cron (`generate_payouts`) → Stripe Transfer.
- Author dashboard: sales, royalties earned, next payout date.
- Admin tooling: approve/reject books, handle DMCA, refunds.

### Phase 3 — Growth features
- Bundles, promo codes, gift purchases.
- Subscriptions (all-you-can-read).
- Affiliate links.
- Localized currency display.

---

## 13. Tools/services shopping list

| Need | Tool | Why |
|---|---|---|
| Payment collection | Paddle | MoR — eats global tax complexity |
| Author payouts | Stripe Connect Express | Best KYC + payout DX |
| Edge backend | Supabase Edge Functions (already) | Webhook handlers |
| Email | Mailgun (already) | Receipts, payout notices |
| Support | Crisp (already) | Refund requests |
| Bookkeeping | Xero or QuickBooks | Track GMV, fees, payouts for taxes |
| Legal | Outside lawyer, one-time | Author agreement review |
| Analytics | PostHog or Plausible | Funnel: view → sample → buy |
| Watermarking | Custom (PDF.js + steganography lib) | Anti-piracy friction |

---

## 14. Open questions for you

Before I'd recommend writing migration #1, you need to answer:

1. **MoR or direct?** Paddle (5% all-in, no tax headache) vs Stripe Connect (~3.5% but you handle global VAT). Recommendation: Paddle to start.
2. **Sample model**: per-page flag, or first-N-pages auto?
3. **Revenue split**: 80/20 author/platform? Or different?
4. **Phase 1 scope**: only your own books, or open to authors immediately? (Strongly recommend phasing.)
5. **Legal entity**: do you have an LLC/Ltd already? If not, that gates everything.
6. **Country of incorporation**: affects which tax forms, which processors, banking. (Where are you operating from?)

Answer these and the next step is a concrete tech-design doc for Phase 1.

---

## Reference reading

- Paddle for digital products: https://www.paddle.com/blog/sell-digital-products
- Stripe Connect marketplaces guide: https://stripe.com/docs/connect
- EU VAT MOSS rules for digital goods: https://taxation-ec.europa.eu/oss_en
- Substack's revenue split (90/10) — public benchmark.
- Amazon KDP 70/35 royalty terms — public benchmark.
- Gumroad's creator-payout model — public docs.

---

## 15. Locked decisions (2026-05-21)

- **Operating jurisdiction**: Canada (Ontario)
- **Legal entity**: **Innerstack Technologies Inc.** — Ontario corporation under OBCA. Incorporated 2025-06-20. CRA BN 788696235. Fiscal year-end Dec 31.
- **Payment collection**: Paddle (MoR)
- **Author payout rail**: Stripe Connect Express
- **Revenue split**: 80% author / 20% Pensive (of net after Paddle fees + tax)
- **Sample model**: per-page `is_sample` boolean
- **Phase 1 scope**: first-party only (Pensive's own books)

### Pre-launch admin (do in next 2 weeks, parallel to build)
- [ ] **Voluntarily register for GST/HST** with CRA — unlocks Input Tax Credits on Canadian expenses. Do via CRA My Business Account.
- [ ] **Fill out ISC register** for Innerstack (Ontario requirement since 2023, fine up to C$5k if missing).
- [ ] **File Ontario annual return** due 2026-06-20.
- [ ] **Open Paddle seller account** in Innerstack's name with BN and CAD payout.
- [ ] **Open Stripe Connect platform account** as Innerstack (CAD platform balance, multi-currency payouts to authors).

---

## 16. Canada-specific tax & legal layer

Most of this is good news because Paddle absorbs global complexity. The **author-payout side has Canada-specific obligations** you cannot dodge.

### 16.1 GST/HST on sales — Paddle handles it

With Paddle as MoR:
- Paddle is the legal seller. Paddle collects GST/HST/QST from Canadian buyers and remits to CRA + Revenu Québec.
- You do **not** need to register for GST/HST *for the marketplace sales themselves*.
- **But**: once your worldwide revenue (including Paddle payouts) crosses **C$30k in any rolling 4-quarter window**, you must register as a Canadian "small supplier" graduate. Then any *other* services you bill (consulting, etc.) charge GST.
- Paddle's payouts to you are zero-rated B2B exports from Paddle's side. You report them as ordinary business income on T2.

→ **Action**: track gross revenue, register for GST/HST at C$30k. Voluntary early registration also lets you reclaim GST/HST input tax credits on Canadian expenses — usually net-positive once fees are non-trivial.

### 16.2 Paying authors — the gnarly part

Three regimes depending on author's residency:

#### Canadian authors
- Issue **T4A slip** by Feb 28 if you paid them > **C$500** in the calendar year.
- No tax withholding (they handle their own income tax).
- Collect their **SIN** or business number at onboarding.

#### US authors
- Get a **W-8BEN** to avoid US backup withholding (Stripe Connect collects this automatically).
- You do **not** issue 1099-NEC — that's a US-payer form; you're a Canadian payer.
- Canada-US tax treaty Article XII: copyright royalties paid by a Canadian to a US resident = **0% Canadian withholding**.

#### Other non-resident authors
- **Part XIII of the Income Tax Act**: default 25% withholding on royalties paid to non-residents.
- Tax treaties reduce this:
  - UK / Germany: 0% (copyright royalties)
  - Australia: 5%
  - India: 10–15%
- You must:
  1. Collect form **NR301** from the author certifying treaty residency.
  2. Withhold the correct amount.
  3. Remit to CRA monthly.
  4. Issue **NR4 slip** by March 31.
- Without NR301 → withhold 25%; author chases relief themselves.

→ **This is real ongoing work.** Budget ~C$2–4k/yr for an accountant who knows non-resident withholding, or build the workflow carefully. Stripe Connect's KYC gives you the country + treaty data needed.

### 16.3 PIPEDA + Quebec Law 25
- Federal PIPEDA: privacy policy must cover what you collect, why, retention, deletion procedure.
- **Quebec Law 25** is stronger (GDPR-like): explicit consent, breach notification, data portability. Applies if you have any Quebec customer data — i.e., always.

### 16.4 Quebec language (Bill 96)
- If you actively market to Quebec consumers, French-language version of consumer-facing pages is required. Out of scope for Phase 1; flag for marketing site later.

### 16.5 Currency
- Paddle pays out in **CAD** (preferred — avoids FX margin) or USD.
- Stripe Connect: keep platform balance in CAD; pay authors in their local currency (Stripe FX 1–2%).

### 16.6 Canadian tooling
- **Banking**: RBC/TD/BMO traditional; Wealthsimple Business or Float for fintech speed.
- **Accounting**: QuickBooks Online (Canadian edition) or Xero.
- **T2 corporate return** annually — use a CPA, DIY is a false economy.
- **Record retention**: CRA wants 6 years minimum.

### 16.7 Revised cost estimate

At ~C$6k GMV/mo:

| Line | Cost (CAD) |
|---|---|
| Paddle (5% + $0.50) | ~$640/mo |
| Stripe Connect payouts | ~$110/mo |
| Supabase Pro | ~$35/mo |
| Mailgun + Crisp | ~$25/mo |
| Accountant (incl. non-resident withholding) | ~$290/mo |
| Legal review (one-time) | $2,000–3,000 |
| Corp annual filing | ~$200/yr |
| **Ongoing total** | **~$1,100/mo CAD** |

### 16.8 Entity confirmation checklist

Before any code is written:
- [ ] Confirm entity is a **Canadian corporation** (not a US LLC). If it's a US LLC and you're Canadian-resident, CRA treats it as a foreign corp → no flow-through → double-taxation nightmare. Talk to a CPA *first*.
- [ ] CRA **business number** in hand.
- [ ] Canadian business bank account in the entity's name.
- [ ] Decide on voluntary GST/HST registration (recommended once you have meaningful Canadian expenses).


## Next step
write the Phase 1 tech design doc next —
  concrete DB migrations, Paddle webhook flow, paywall RLS, and reader-side
  paywall UX? That's the next planning artifact before any code lands.