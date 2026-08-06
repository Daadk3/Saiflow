# 🚀 SAIFLOW — MISSION CONTROL

**Open this every morning until 100 paying customers.**
One objective: **FIRST RIYAL.** Then the next hundred.

*Updated: 18 July 2026 · Update the date every time you touch this file. A stale dashboard is a lie.*

---

## 1 · CURRENT STATUS

| Area | Status | One honest line |
|---|---|---|
| **Engineering** | ✅ Complete | v1.0 RC staged; every route audited; build green. One task remains by design: Moyasar checkout (gated on Payments) |
| **Security** | ✅ Complete | Hardened twice, verified live; known accepted debts documented (in-memory rate limits, unhashed reset tokens) |
| **Operations** | ✅ Complete | 11-doc Operations Center; ≤15-min daily loop; runbooks for the bad days |
| **Legal** | 🟡 In progress | All policies live and bilingual; `[CR NUMBER]` placeholders await the real registration |
| **Compliance** | 🟡 In progress | PDPL stance done and disclosed; Maroof registration pending; ZATCA not yet applicable (0 revenue) |
| **Marketing** | 🟡 In progress | Brand, storefronts, share links, SEO ready; no channel activated, no audience warmed |
| **Business** | 🔴 Blocked | CR activities (4791 + 6201) not yet added; settlement bank unconfirmed — **this is the head of the chain** |
| **Payments** | 🔴 Blocked | No live rail. Moyasar KYC needs Business ↑ first. Stripe dormant by design |

**Read the table honestly: the code is done; the company is not. Every 🔴 is paperwork, not engineering.**

---

## 2 · THE PATH TO THE FIRST RIYAL

| # | Milestone | Objective | Definition of Done | Blocked by | Effort |
|---|---|---|---|---|---|
| 1 | **Repository complete** | Launch-ready, operationally-documented codebase | RC staged, build green, ops manual exists — *needs one commit* | Nothing — say the word | ✅ done + 5 min |
| 2 | **Production deployment** | Saiflow live on saiflow.io with real DB | Preview deployed → smoke test §4 passes → promoted → health 200 | M1; `ADMIN_EMAILS` set in Vercel | Half a day |
| 3 | **Business verification** | Legal entity able to accept payment | CR shows 4791+6201 · business bank account live · Maroof registered · real CR number in Terms/About · support@ receiving | Your time at mc.gov.sa + bank | 1–2 weeks (mostly waiting) |
| 4 | **Payment integration** | Real SAR can move | Moyasar account approved → checkout+webhook built → 1 SAR test purchase succeeds and settles | M3 (KYC needs M3 complete) | ~1 week code, after KYC clears |
| 5 | **First seller** | You, onboarded through the real flow | Shop created through the product like any stranger would | M2 | 1 hour |
| 6 | **First published product** | One real product, certified, reviewed, live | Uploaded with certification → approved in moderation queue → public URL shareable | M5 | 1 evening |
| 7 | **First successful purchase** | The full loop works with real money | Test buyer pays real SAR → order created → download works → receipt lands | M4 + M6; `PRE_LAUNCH_MODE=false` | 1 day incl. verification |
| 8 | **🏁 FIRST RIYAL** | A *stranger* pays for your product | Someone you didn't recruit personally completes a purchase | M7 + one marketing channel activated | Unknown — this one is earned, not built |

**Critical path: M3 is the bottleneck. Start it today; everything else can proceed in parallel behind it.**

---

## 3 · DAILY CEO DASHBOARD *(15 minutes, hard cap)*

```
☐ 1. TODAY'S MOST IMPORTANT TASK — name it before opening anything else.
      If it isn't on the M3/M4 critical path, ask why.
☐ 2. Production health      → saiflow.io/api/health          (10 sec)
☐ 3. Moderation queue       → /dashboard/moderation          (target: empty)
☐ 4. Support inbox          → support@saiflow.io             (reply < 1 business day)
☐ 5. Revenue                → Moyasar dashboard (post-M4)    (until then: skip, no guilt)
☐ 6. Paperwork pulse        → any reply from MC / bank / Moyasar? Chase if silent 3+ days.
☐ 7. Top risk check         → glance Section 4; did anything change?
☐ 8. ONE DECISION TODAY     → make exactly one; log it in Section 5 if strategic.
```

**Rules:** the loop is 15 minutes — operating is not building. If a task recurs three mornings unfinished, it's not a task, it's a blocker: move it to Section 4 and treat it as one. Detailed procedures live in [`docs/operations/`](docs/operations/OPERATIONS_INDEX.md).

---

## 4 · OPEN BLOCKERS

💰 = costs money · ⏳ = mostly waiting on others

**Business**
- 🔴 ⏳ Add activities 4791 + 6201 to NovaSphere Marketing CR (mc.gov.sa) — *the head of the chain*
- 🔴 💰 Business bank account in establishment name (settlement target)

**Legal**
- 🟡 Real CR number + establishment name into Terms/About (5-minute edit once M3 issues it)

**Compliance**
- 🟡 Maroof registration (~30 min, after CR update)
- 🟡 ⏳ Verify SDAIA controller-registration applicability (1 hour, non-blocking)

**Financial**
- 🔴 💰 ⏳ Moyasar merchant onboarding (KYC: CR + bank + reviewable site — site is ready)

**Engineering** *(the only code left)*
- 🟡 Moyasar checkout + webhook — deliberately unbuilt until KYC clears; ~1 week when it does
- 🟡 Commit + deploy the staged RC (waiting on your word)

**Infrastructure**
- 🟡 `ADMIN_EMAILS` env var in Vercel (2 min, at deploy)
- 🟡 support@saiflow.io inbound mail verified (part of M3)

*Nothing on this list is a surprise. That is the point of this file.*

---

## 5 · DECISION LOG *(why things are the way they are — don't re-litigate without new facts)*

| Decision | Why it stands |
|---|---|
| **Arabic-first, language-first** | The market gap is the language, not an ethnicity. Positioning targets "content in Arabic" — open to anyone who creates in it |
| **Saudi-first compliance** | KSA is home: CR, PDPL, E-Commerce Law, mada. Compliance is a moat competitors must also swim |
| **Moyasar over Stripe** | Stripe cannot settle SAR to a Saudi establishment. Stripe code kept dormant as cheap optionality |
| **Seller #1 is the founder** | Collapses the marketplace cold-start into one storefront sale. Prove the loop, then invite others |
| **Pre-launch honesty mode** | Checkout stayed off until payments are real. Nothing on the site claims what isn't true |
| **Moderation before growth** | Certification + review-before-publish + audit log existed before the first stranger. Retrofitting trust is 10× the cost |
| **Human review before AI** | At this volume a human is better and free. AI moderation activates at scale, with audit-logged reasoning (blueprint ready) |
| **Security before features** | Paid files, KSA law, and PDPL leave no room for "fix it after launch." Two hardening passes bought calm |
| **No fake metrics, testimonials, or blog authors** | Fabricated proof found in the codebase was deleted, not polished. Trust compounds; fakery compounds faster, in reverse |
| **Never hold seller funds** | Split-settlement via licensed PSP, always. Holding funds is a SAMA license problem this company refuses to have |
| **Web before iOS** | Apple takes 15–30% of digital goods via IAP; the web is commission-free. iOS is a pricing decision, not a milestone |
| **FounderOS frozen until First Riyal** | The cockpit is not the flight. Tools that manage the work must never replace the work |

---

## 6 · AFTER THE FIRST RIYAL *(by ROI, not by excitement)*

**30 days — prove it repeats**
First 10 sales · activate exactly one channel and measure it · signed download URLs + Redis rate limiting + offsite DB backup (protect revenue) · Arabic purchase email · fix what the first buyers complain about — nothing else.

**90 days — make it a habit**
Repeatable weekly sales · uptime monitor + error tracking · VAT-ready receipts · evaluate: does demand justify seller #2? If yes, T&S Tier 1 (malware scanning, seller history). Gate N1 review with the Board framework.

**6 months — open the doors**
Multi-seller onboarding + PSP split-settlement payouts · ratings (schema is waiting) · analytics funnel · ME-region DB migration · first paid marketing only if organic proved the message.

**12 months — the platform**
100 paying customers · AI moderation (Tier 2) if volume demands · subscriptions/memberships if sellers ask · enterprise/API only with revenue proof · revisit iOS with the commission math in hand.

*Rule carried from the backlog: every quarter, one deliberate promotion/demotion — not by mood.*

---

## 7 · CEO METRICS *(update weekly, Sunday; targets are for the first quarter after launch)*

| Metric | Now | Target |
|---|---|---|
| Products published | 0 | 3 (all yours) |
| Active sellers | 0 | 1 (you) |
| Paying customers | 0 | **1, then 10, then 100** |
| Revenue (SAR) | 0 | **> 0 — the only number that matters until it isn't** |
| MRR (SAR) | 0 | — (matters post-subscriptions) |
| Refund rate | — | < 5% |
| Moderation queue age | — | < 24h |
| Support first response | — | < 1 business day |
| Customer satisfaction | — | Every early buyer personally asked: "was this worth it?" |

*Nine numbers. If a metric doesn't change a decision, it doesn't belong here.*

---

## 8 · FOUNDER PROMISE

*To the founder opening this file some morning — probably tired, possibly discouraged, definitely busy:*

You built Saiflow because creators who work in Arabic deserved infrastructure built for them first — not a translation, not an afterthought. A place where someone in Riyadh or Jeddah or anywhere can turn what they know into what they earn, in their own language, paid in their own currency. That was true the day you started and it is true today. Read it again on the days it feels abstract.

You rejected every shortcut on the way here, and you should remember that you did it on purpose. The checkout stayed off until the money could be real. The fake blog authors were deleted, not dressed up. The stats badges say "free to start," not "10,000 creators," because one of those was true. Every product on this platform will have been certified by its seller and reviewed by a human before a single buyer sees it. None of that was the fast path. All of it was the right one.

Security mattered because you are asking strangers for their money and their trust in the same click. Compliance mattered because this company lives in the Kingdom, under its laws, serving its people — legitimacy is not overhead, it is the product's spine. Trust mattered because it is the only asset in this business that cannot be rebuilt quickly once spent. You paid for all three in weeks of careful work when weeks felt expensive. They will pay you back for years.

And remember this, because it is the discipline the whole company rests on: **the first riyal matters more than the hundredth feature.** A hundred features without a customer is a hobby with good documentation. One stranger, paying once, for one product — that is a business, small as a seed. Everything in this repository exists to make that moment possible and honest. Nothing in this repository is worth more than that moment.

The code is finished. The manual is written. What remains is the part only you can do: the form at the ministry, the account at the bank, the message to your audience, the nerve to press publish.

You have carried this far under more pressure than most founders ever admit to. Carry it one milestone further.

Go get the riyal.

— *Written at the completion of v1.0, July 2026*

---

*This file is the company's heartbeat. Update the status table when reality changes, log decisions when you make them, and let the metrics tell you the truth. When customer #100 pays — archive this file, keep the promise, and write the next one.*
