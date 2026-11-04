# Founder bot API

A small private API so Daad's own assistants can open stores and upload products for her. It is not a public API, and it is not an admin API.

It can:

- Open a store owned by Daad's own account.
- Upload a product (file, title, description, price in SAR, category, and an optional cover) into a store she owns.
- List her stores and her products, including whether a product is still waiting for review.

It cannot:

- Approve or publish a product. Every upload stays **pending review**, the same as an upload from the dashboard, and still goes through the file check, page count, and the 8-point review checklist.
- Change the price of a product that is already live.
- See or change orders, payouts, or payments.
- Turn payments on or off.
- Create anything for any account except the one named in `FOUNDER_BOT_OWNER_EMAIL`.

Approval stays a manual step in the admin dashboard.

## Turn it off

Unset `FOUNDER_BOT_API_TOKEN` in Vercel (or set it to blank, or to anything shorter than 16 characters) and redeploy. Every founder-bot URL then answers **404**, as if it were not there. No code change is required.

## Environment variables

Set these in Vercel → Project → Settings → Environment Variables, for the environment you want the bot to use. Then redeploy.

| Variable | Required for the bot | What to put |
|---|---|---|
| `FOUNDER_BOT_API_TOKEN` | Yes, or the API stays off | A long random secret, one line, no spaces. Generate with `openssl rand -hex 32`. At least 16 characters. |
| `FOUNDER_BOT_OWNER_EMAIL` | Yes | Daad's own account email. It must already be listed in **both** `ADMIN_EMAILS` and `FOUNDER_TEST_EMAILS`. |
| `ADMIN_EMAILS` | Already used by the admin dashboard | Must include the owner email above. |
| `FOUNDER_TEST_EMAILS` | Already used for founder test payments | Must include the owner email above. |
| `UPLOADTHING_TOKEN` | Already required for uploads | Unchanged. |
| `UPLOADTHING_APP_ID` | Already required so product files stay on SaiFlow's storage | Unchanged. |

The token is compared on the server and is never written to the logs.

Vercel itself rejects request bodies larger than about 4.5 MB before this app sees them. Files bigger than that still have to be uploaded from the dashboard. The bot refuses any file the dashboard upload would refuse (same types, same size ceilings).

## Examples

Replace `YOUR_TOKEN_HERE` and the host. Do not commit a real token.

List her stores:

```bash
curl -sS https://www.saiflow.io/api/founder-bot/stores \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

Open a store:

```bash
curl -sS -X POST https://www.saiflow.io/api/founder-bot/stores \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{"name":"متجر داد","description":"ملفات رقمية","country":"SA","city":"الرياض"}'
```

`country` is the two-letter country code (`SA` for Saudi Arabia). `city` is optional.

Upload a product into that store. `price` is in SAR. `category` is one of `ebooks`, `courses`, `templates`, `music`, `art`, `software`. The product is created as pending review. It is not for sale until someone approves it in the dashboard.

```bash
curl -sS -X POST https://www.saiflow.io/api/founder-bot/products \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -F "shopId=SHOP_ID" \
  -F "title=دليل التخطيط" \
  -F "description=وصف المنتج للمشتري" \
  -F "price=49.00" \
  -F "category=ebooks" \
  -F "file=@./guide.pdf" \
  -F "cover=@./cover.jpg"
```

`cover` is optional. Without it, the review checklist flags the missing cover the same way the dashboard does.

List her products, and optionally one store:

```bash
curl -sS "https://www.saiflow.io/api/founder-bot/products?shopId=SHOP_ID" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

Each product includes `moderationStatus` (`PENDING`, `APPROVED`, or `REJECTED`) and the eight review-checklist states. `PENDING` means it is not on sale.

There is no endpoint that approves a product.
