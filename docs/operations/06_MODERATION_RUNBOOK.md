# Moderation Runbook

Operational expansion of [`docs/TRUST_AND_SAFETY.md`](../TRUST_AND_SAFETY.md). The Content Policy (`/content-policy`) is the law; this is the courtroom procedure.

## Principles

1. **Nothing publishes unreviewed** — the PENDING default is the whole system. Never bypass it in the DB.
2. **Every decision gets a reason** — rejections require one (enforced); write approvals' reasons for anything borderline. The audit log is your defense in any dispute.
3. **Reversible beats right-first-try** — when unsure, REJECT with a reason and invite resubmission. Un-rejecting is one click; un-publishing harm is not.
4. **The seller certified; the seller answers.** Clarification requests go to the seller — the burden of proof is theirs, not yours.

## The queue decision tree (new product review)

```
Product in /dashboard/moderation
│
├─ File present, opens, matches title/description?
│    no → REJECT: "الملف غير مطابق للوصف / File does not match listing"
│
├─ Content type on the prohibited list? (/content-policy)
│    yes → REJECT with the specific category
│         → 2nd offense same seller → suspend shop
│
├─ Plausibly the seller's own work?
│    (stock-looking content, famous-brand assets, other platforms' watermarks)
│    doubt → EMAIL seller for proof of ownership/license, leave PENDING
│    no proof in 7 days → REJECT: "لم يثبت الحق في البيع / rights not established"
│
├─ Pricing sane? (not 10,000 SAR for a wallpaper — fraud signal)
│    absurd → REJECT: fraud_scam, ask seller to justify
│
└─ else → APPROVE
```

## Per-report-category actions (public reports)

| Category | First action | Then | Ban seller when |
|---|---|---|---|
| `copyright` | REJECT product pending review (reversible) | Complainant provides proof → stays down; seller shows license → restore | Pattern of infringing uploads |
| `illegal` | REJECT immediately | Verify against KSA law; lawyer if unclear | Confirmed intent |
| `explicit` | REJECT immediately | No clarification needed — policy is explicit | Repeat |
| `child_safety` | **REJECT + suspend shop immediately, no investigation delay** | Preserve everything; **report to Saudi authorities (Kollona Amn app / 911) — legal duty, not judgment call** | Always, permanently |
| `political` | Human review — is it *content about* politics (may be fine) or campaigning/incitement (not)? | Judgment call; when hot, REJECT + note | Incitement |
| `religious` | Human review — religious *content* is normal in this market; mockery/sectarianism is not | Apply public-morals clause carefully | Sectarian incitement |
| `hate_harassment` | REJECT if targeting anyone | If targeting a private person → remove first, review after | Targeted campaigns |
| `fraud_scam` | REJECT + check seller's other products | Unrealistic-returns content is fraud even when dressed as education | Confirmed scam |
| `malware` | REJECT + **do not open the file** | VirusTotal URL scan; suspend on confirmation; email purchasers | Confirmed upload |
| `other` | Read it — reporters often pick `other` for the worst things | Reclassify and follow that row | — |

**Escalate (lawyer / authorities) when:** any government contact, child safety (always), credible legal threat, or you cannot determine legality yourself. Escalation is a strength; guessing about KSA law is the risk.

## AI vs human (binding today and later)

**Today (Tier 0):** every decision is human — you. The AI columns in `ModerationEvent` stay empty.

**When Tier 2 ships** (thresholds from the T&S blueprint):
- AI may **auto-approve** only: confidence ≥ 0.9 AND no category flagged AND seller has no rejection history.
- AI may **auto-reject** only: malware (scanner-confirmed) or explicit content at ≥ 0.9 — the two categories with near-zero false-positive tolerance for staying up.
- **A human always decides:** `child_safety` (report duty is human), `political`, `religious` (cultural judgment), `copyright` (evidence weighing), any seller suspension, any appeal, anything the AI marks 0.5–0.9.
- Every AI decision carries model id + reasoning + confidence in the audit log, or it doesn't happen.

## Appeals (Tier 0 flow)
Seller emails support@ → you re-review with fresh eyes → outcome is a new `ModerationEvent` (RESUBMITTED → APPROVED/REJECTED) with reasoning. One appeal per product; second appeal only with new evidence.
