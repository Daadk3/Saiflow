# Customer Support

**Channel:** support@saiflow.io · **Promise (in Terms):** reply within 1 business day. Arabic first; mirror the customer's language. Warm, direct, no corporate filler.

## SOPs

### Refund request
Policy: `/refunds` — final after download unless defective/inaccessible/misdescribed, or law requires.
1. Verify the order (email ↔ `Order` row).
2. Qualifies (broken file, can't access, materially misdescribed)? → refund via the payment provider dashboard, confirm to buyer, note whether the seller's product needs a REJECT until fixed.
3. Doesn't qualify ("changed my mind" post-download)? → decline kindly, cite policy, offer help using the product instead.
4. When in doubt in the early days: **refund.** A riyal is cheaper than a dispute, a chargeback, or a bad review. Log a note if a product accumulates refunds — that's a moderation signal.

### Download problems
1. Ask for the purchase email + product name; find the `Order`.
2. Resend the download link: `/api/download/{productId}?orderId={orderId}`.
3. Link works but file doesn't open → check the product file yourself (via moderation view) — corrupted upload is the seller's to fix; REJECT until replaced; refund the buyer if not fixed in 48h.

### Duplicate purchase
Two orders, same email, same product, minutes apart → refund the duplicate without being asked twice. Keep the earliest.

### Wrong file delivered (seller uploaded the wrong thing)
1. Confirm by inspecting the file.
2. REJECT product ("wrong file"), email seller to replace.
3. Buyer choice: wait for the fix or immediate refund.

### Account deletion (PDPL right)
1. Verify the request comes from the account's email (reply-to check).
2. Delete the user row (cascades per schema). **Orders survive** (they're purchase records keyed by email — legal/financial retention); tell the user plainly that transaction records are retained as required.
3. Confirm completion in writing within 30 days (do it same-week).

### Privacy / data-access request (PDPL)
Compile what the DB holds for that email (user, profile, shop, products, orders), send as a readable summary within 30 days. No formal export tooling needed at this scale — honesty and completeness are the requirement.

### Seller disputes ("my product was rejected unfairly")
Appeal flow in [`06_MODERATION_RUNBOOK.md`](06_MODERATION_RUNBOOK.md). Re-review honestly; the audit log's reason is your reference; outcome in writing.

## Templates (adapt, don't paste robotically)

**Acknowledgment / استلام**
> وعليكم السلام، شكرًا لتواصلك مع سيفلو. استلمنا رسالتك وسنرد عليك خلال يوم عمل واحد.
> Thank you for contacting Saiflow. We've received your message and will reply within one business day.

**Refund approved / الموافقة على الاسترجاع**
> تمت الموافقة على استرجاع مبلغ طلبك ({المبلغ} ر.س). سيصلك المبلغ عبر وسيلة الدفع الأصلية خلال ٥–١٤ يوم عمل. نعتذر عن التجربة، وشكرًا لتفهمك.
> Your refund of SAR {amount} has been approved and will reach your original payment method within 5–14 business days. We're sorry about the experience.

**Refund declined / الاعتذار عن الاسترجاع**
> نظرًا لأن المنتج رقمي وتم تسليمه فور الشراء، لا يمكننا استرجاع المبلغ وفق سياسة الاسترجاع ({الرابط}). إذا كانت هناك مشكلة في الملف نفسه فأخبرنا فورًا — نحن هنا للمساعدة.
> Because digital products are delivered instantly, this order isn't eligible for a refund under our policy ({link}). If there's a problem with the file itself, tell us right away — we'll make it right.

**Download fix / إصلاح التحميل**
> هذا رابط تحميل جديد لمنتجك: {الرابط}. إذا واجهت أي مشكلة في فتح الملف فراسلنا مباشرة.
> Here's a fresh download link for your purchase: {link}. If the file won't open, reply and we'll sort it out.

**Copyright complaint acknowledgment / استلام بلاغ حقوق**
> استلمنا بلاغك بخصوص المحتوى المشار إليه، وتم إيقاف المنتج مؤقتًا ريثما نراجع البلاغ. نرجو تزويدنا بما يُثبت ملكيتك للحقوق وروابط المحتوى الأصلي.
> We've received your report and the product has been taken down pending review. Please send proof of your rights and links to the original work.

**Account deletion confirmed / تأكيد حذف الحساب**
> تم حذف حسابك وبياناتك الشخصية من سيفلو. تحتفظ المنصة بسجلات المعاملات المالية فقط وفق المتطلبات النظامية. نشكرك على تجربتك معنا.
> Your account and personal data have been deleted. Transaction records are retained only as required by law. Thank you for being with us.
