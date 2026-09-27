# Harmony API

Node/Express + Prisma/PostgreSQL service behind Immersive Learning. It handles:

- **Card payments** through Stripe Checkout (the original service). Fulfillment still happens only in the webhook handler, never from the success URL.
- **Mobile money across Africa**: Kenyan **M-Pesa goes through Safaricom Daraja** (M-Pesa Express / STK push). **pawaPay** carries the other wallets in 20 countries through one API (MTN MoMo, Airtel, Orange, Vodacom M-Pesa, Moov, Free, Yas/Tigo, Halotel, TNM, Zamtel...). Kenyan Airtel Money can also run direct.
- **Health help on any phone, in any supported country**: daily health tips, quizzes and questions over two-way SMS, a USSD menu and a voice IVR (Africa's Talking; Click Mobile as the fallback gateway). Numbers, currencies and wallets are per country (`src/lib/countries.ts`). Health content is general guidance (safe water, handwashing, cholera, ORS, malaria, danger signs), not a diagnosis. Possible emergencies are always told to go to a health facility first.
- **The learning agent**: one brain for every channel. It asks Aqua Ask (RAG over the research library), falls back to built-in lessons, and hands off to a **human guide** by SMS relay or a free call-back.

The student web app is `/mobile/` at the repo root. The guide desk is `/mobile/agent.html`.

Every gateway is optional. If a gateway's keys are missing, that channel runs in **practice mode**: SMS goes to an outbox, PIN prompts appear on the browser phone simulator, and no real money moves. You can demo the whole thing with zero accounts.

## Run locally

```bash
cd Guardians-of-the-Ocean/server
npm install
npx prisma generate
npm run dev            # API on :8787, in-memory store, practice mode
```

In another terminal, serve the site from the repo root:

```bash
python -m http.server 8765
```

Open `http://127.0.0.1:8765/mobile/`. On desktop the feature-phone simulator sits on the right. Dial the USSD code, text `HELP`, call Harmony, or pay from the Support tab and approve with any 4-digit PIN on the simulated phone.

If port 8787 is taken, run with `PORT=8790` and point the site at it in the browser console:

```js
localStorage.setItem('goo-api', 'http://127.0.0.1:8790');
```

Tests:

```bash
npm test                 # unit + API tests
npm run typecheck
npm run check:webhooks   # against a running server: Africa's Talking-style USSD/SMS in several countries
```

## Environment

See `.env.example` for the full list. The main groups:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL. Without it, students and mobile payments live in memory. Stripe also needs it. |
| `PUBLIC_API_URL` | This API's public origin, used in callback URLs. Render provides `RENDER_EXTERNAL_URL` automatically. |
| `CALLBACK_TOKEN` | Secret path segment on every provider callback. Use hex (`openssl rand -hex 24`), because it goes in URLs. |
| `ADMIN_TOKEN` | Bearer token for the guide desk and lesson broadcasts. |
| `DEV_TOOLS` | Simulator and practice payments. On by default outside production. In production it stays on only while no real gateway is configured. |
| `STRIPE_*`, `CHECKOUT_*` | Card checkout, unchanged. |
| `AT_USERNAME`, `AT_API_KEY`, `AT_SMS_FROM`, `AT_VOICE_NUMBER`, `USSD_CODE`, `SMS_SHORTCODE` | Africa's Talking. |
| `MPESA_*` | Daraja app keys, shortcode and passkey. `MPESA_TYPE=till` for Buy Goods. |
| `AIRTEL_*` | Airtel Africa collection app. |
| `AQUA_ASK_URL`, `GOOGLE_API_KEY`, `AGENT_PHONES` | The agent, voice transcription, and the human guides. |

## Providers and why

| Need | Primary | Fallback / alternative |
| --- | --- | --- |
| SMS, USSD, voice | **Africa's Talking**: self-serve, sandbox, multi-country | **Click Mobile** as the fallback gateway, once its API and keys are issued (no public docs or sandbox yet). The `Messenger` interface is where it plugs in. |
| M-Pesa (Kenya) | **Safaricom Daraja**, M-Pesa Express STK push | none (practice mode in development) |
| Other mobile money | **pawaPay** in 20 countries | Airtel Kenya direct |
| Cards | Stripe | none |

Routing per payment: the wallet's direct rail if it's configured, then pawaPay, then practice mode (only while `DEV_TOOLS` is on).

## Countries

Benin, Burkina Faso, Cameroon, Congo, Côte d'Ivoire, DR Congo, Ethiopia, Gabon, Ghana, Kenya, Lesotho, Malawi, Mozambique, Nigeria, Rwanda, Senegal, Sierra Leone, Tanzania, Uganda, Zambia. That's pawaPay's deposit coverage, plus Kenyan Airtel direct. Wallets that need an OTP or a browser redirect (Orange Burkina, Wave) are left out because a feature phone can't complete them.

When a number's network can't be told from its prefix (or the USSD gateway's `networkCode`), the student is asked which wallet to use: a USSD menu, `PAY 1000 MOOV` by SMS, or a button on the web.

## Connect the gateways

Replace `API` with your public API origin and `TOKEN` with `CALLBACK_TOKEN`.

### Africa's Talking (SMS, USSD, voice)

1. Create an app, then set `AT_USERNAME` and `AT_API_KEY`. The username `sandbox` targets the sandbox and its simulator.
2. **USSD**: create a service code, then set its callback to `API/api/at/TOKEN/ussd`.
3. **SMS**: on your shortcode, set the incoming-messages callback to `API/api/at/TOKEN/sms` and the delivery-reports callback to `API/api/at/TOKEN/delivery`. Set `AT_SMS_FROM` to the shortcode or sender ID.
4. **Voice**: on your voice number, set the callback to `API/api/at/TOKEN/voice`, and set `AT_VOICE_NUMBER`.
5. Set `AGENT_PHONES` to the numbers of your human guides.

### M-Pesa (Daraja, M-Pesa Express)

1. Create a Daraja app with M-Pesa Express, then set `MPESA_CONSUMER_KEY` and `MPESA_CONSUMER_SECRET`.
2. Sandbox: use the test shortcode and passkey from the Daraja portal. Production: use your paybill or till and the passkey Safaricom issues when you go live, and set `MPESA_ENV=production`.
3. The STK callback URL is sent with every request (`API/api/pay/mpesa/callback/TOKEN`), so there is nothing to configure on the portal. Daraja does not sign callbacks. The secret path, the idempotent settle and a status query fallback cover that.

### pawaPay (pan-African mobile money)

1. Sign up for the sandbox at `dashboard.sandbox.pawapay.io`, create an API token, then set `PAWAPAY_API_TOKEN`.
2. In the dashboard, set the deposit callback URL to `API/api/pay/pawapay/callback/TOKEN`.
3. Callbacks are not trusted on their own: each one is confirmed with pawaPay's Check Deposit Status before a payment is marked paid.
4. For live money, complete pawaPay's onboarding, then set `PAWAPAY_ENV=production` with the production token.

### Airtel Money (Airtel Africa Open API)

1. Create an app with the Collection product (KE / KES), then set `AIRTEL_CLIENT_ID` and `AIRTEL_CLIENT_SECRET`.
2. Set the collection callback URL on the app to `API/api/pay/airtel/callback/TOKEN`.
3. If your Airtel app has message signing turned on, the request encryption headers still need adding in `src/payments/airtel.ts`.

### Stripe

Unchanged. Run `stripe listen --forward-to localhost:8787/api/webhooks/stripe` locally. The site's Card option calls `POST /api/checkout`.

## Routes

**Web app**

- `GET /api/mobile/config`: codes, channel modes, lessons, amounts.
- `POST /api/students/join`: opts a student in and sends the first lesson by SMS.
- `POST /api/agent/ask`: asks the agent. Can also text the answer.
- `POST /api/agent/callback`: opens a guide ticket, alerts guides, and rings the student.
- `POST /api/pay/mobile` `{ phone, amount, wallet? }`: sends the PIN prompt. `phone` can be from any supported country (`+256…`). `wallet` is `mpesa`, `mtn`, `airtel`, `orange`… and is picked from the number when omitted.
- `GET /api/pay/mobile/:id`: status. It asks the provider directly if the callback is late.
- `GET /api/mobile/ledger`, `GET /api/ledger`: totals. `/api/ledger` also carries the Stripe figures.

**Provider callbacks** (all behind `CALLBACK_TOKEN`)

- `POST /api/pay/mpesa/callback/:token`, `POST /api/pay/airtel/callback/:token`, `POST /api/pay/pawapay/callback/:token`
- `POST /api/at/:token/ussd | sms | delivery | voice | voice/menu | voice/question | voice/pay`

**Guide desk** (`Authorization: Bearer ADMIN_TOKEN`)

- `GET /api/agent/tickets?status=handoff|answered|all`
- `POST /api/agent/tickets/:id/reply`, `POST /api/agent/tickets/:id/close`
- `POST /api/admin/broadcast`: sends the next lesson to every subscriber. You can call it from a daily cron.

**Simulator** (only with `DEV_TOOLS`): `/api/dev/ussd`, `/api/dev/sms`, `/api/dev/voice/*`, `/api/dev/phone/:phone`, `/api/dev/prompts/:ref`.

**Card**: `POST /api/checkout`, `POST /api/webhooks/stripe`, `GET /api/orders/status`. These answer 503 until Stripe is configured.

## What students can do without data

| Channel | How |
| --- | --- |
| USSD `*384*2026#` | Lessons, quiz, ask a question (answered by SMS), guide call-back, support with M-Pesa or Airtel, progress, daily SMS opt-in. |
| SMS to the shortcode | `JOIN`, `LESSON`, `QUIZ` then `A`/`B`/`C`, `ASK <question>` or any free text, `AGENT`, `PAY 100`, `POINTS`, `STOP`, `HELP`. Kiswahili aliases: `ANZA`, `SOMO`, `SWALI`, `ULIZA`, `MSAADA`, `CHANGIA`, `ACHA`. |
| Voice line | 1 lesson (read aloud), 2 say a question (answered by SMS), 3 talk to a guide, 4 support with mobile money. |
| Guides | Get an SMS for every ticket and reply from their own phone with `R <code> <message>`, or use the guide desk. |

## Safety notes

- Web endpoints that make a phone buzz (join, callback, pay) are rate-limited per number and per IP.
- Payments settle exactly once (a conditional update), so retried callbacks never double-count or re-send a receipt.
- Voice recordings are only fetched from Africa's Talking hosts before transcription.
- Logs mask phone numbers (`0712 ***678`).

## Deploy

`render.yaml` at the repo root deploys this as `guardians-stripe`. The build installs dev dependencies (TypeScript and the Prisma CLI) and runs migrations on start. Add the gateway keys in the Render dashboard as you get them. Each channel switches from practice to live on its own.
