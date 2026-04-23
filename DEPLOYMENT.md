# Backend Deployment Guide — Render.com

## Quick Deploy

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your GitHub repo → select the `backend` folder
4. Render will auto-detect `render.yaml` — click **Apply**

---

## Manual Setup (if not using render.yaml)

| Setting | Value |
|---|---|
| **Runtime** | Node |
| **Build Command** | `npm install` |
| **Start Command** | `node server.js` |
| **Health Check Path** | `/api/health` |
| **Region** | Singapore (closest to India) |
| **Node Version** | 18+ |

---

## Required Environment Variables on Render

Set these in Render Dashboard → Environment:

### Core
| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `10000` |

### Supabase
| Key | Where to find |
|---|---|
| `SUPABASE_URL` | Supabase Dashboard → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Settings → API |
| `SUPABASE_ANON_KEY` | Supabase Dashboard → Settings → API |

### Auth
| Key | Value |
|---|---|
| `JWT_SECRET` | Any random 32+ char string |

### URLs
| Key | Value |
|---|---|
| `FRONTEND_URL` | `https://connectfreelance.in` |
| `CLIENT_URL` | `https://connectfreelance.in` |
| `BACKEND_URL` | `https://connect-backend-1-dm8d.onrender.com` |
| `ALLOWED_ORIGINS` | `https://connectfreelance.in,https://www.connectfreelance.in` |

### Email (Gmail)
| Key | Value |
|---|---|
| `EMAIL_HOST` | `smtp.gmail.com` |
| `EMAIL_PORT` | `587` |
| `EMAIL_USER` | your Gmail address |
| `EMAIL_PASS` | Gmail App Password (not your login password) |
| `EMAIL_FROM` | `Connectfreelance <noreply@connectfreelance.in>` |

> Get Gmail App Password: Google Account → Security → 2-Step Verification → App Passwords

### Payments
| Key | Where to find |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API Keys |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard → Webhooks → Signing Secret |
| `RAZORPAY_KEY_ID` | Razorpay Dashboard → Settings → API Keys |
| `RAZORPAY_KEY_SECRET` | Razorpay Dashboard → Settings → API Keys |

### AI
| Key | Where to find |
|---|---|
| `GROQ_API_KEY` | [console.groq.com](https://console.groq.com) |

### Video (Agora)
| Key | Where to find |
|---|---|
| `AGORA_APP_ID` | [console.agora.io](https://console.agora.io) |
| `AGORA_APP_CERTIFICATE` | Agora Console → Project → Certificate |
| `AGORA_CUSTOMER_ID` | Agora Console → RESTful API |
| `AGORA_CUSTOMER_SECRET` | Agora Console → RESTful API |

### Admin
| Key | Value |
|---|---|
| `SUPER_ADMIN_EMAIL` | your admin email |

---

## Stripe Webhook Setup

After deploying, register your webhook in Stripe:

1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. URL: `https://connect-backend-1-dm8d.onrender.com/api/payments/webhook`
3. Events to listen for:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `customer.subscription.created`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
4. Copy the **Signing Secret** → paste into `STRIPE_WEBHOOK_SECRET`

---

## Razorpay Webhook Setup

1. Razorpay Dashboard → Settings → Webhooks → Add New Webhook
2. URL: `https://connect-backend-1-dm8d.onrender.com/api/webhooks/razorpay`
3. Events: `payment.captured`, `payment.failed`, `order.paid`

---

## Health Check

After deploy, verify:
```
GET https://connect-backend-1-dm8d.onrender.com/api/health
→ { "success": true, "message": "Connect.com API is running 🚀" }
```

---

## Common Issues

| Problem | Fix |
|---|---|
| Cold start timeout | Render free tier sleeps after 15min — upgrade to Starter ($7/mo) or use a cron ping service |
| CORS errors | Make sure `ALLOWED_ORIGINS` includes your exact Vercel URL |
| Supabase connection timeout | Already fixed — `dns.setDefaultResultOrder('ipv4first')` is set in server.js |
| Email not sending | Use Gmail App Password, not your account password |
| Stripe webhook 400 | Make sure `/api/payments/webhook` uses `express.raw()` — already configured |
