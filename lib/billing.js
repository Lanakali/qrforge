'use strict';

const db = require('./db');

let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  const Stripe = require('stripe');
  stripe = Stripe(process.env.STRIPE_SECRET_KEY);
}

const PRICE_FOR_PLAN = {
  pro: process.env.STRIPE_PRICE_PRO_ID || null,
  business: process.env.STRIPE_PRICE_BUSINESS_ID || null,
};

const PLAN_FOR_PRICE = {};
for (const [plan, priceId] of Object.entries(PRICE_FOR_PLAN)) {
  if (priceId) PLAN_FOR_PRICE[priceId] = plan;
}

function billingConfigured() {
  return !!stripe;
}

function priceForPlan(plan) {
  return PRICE_FOR_PLAN[plan] || null;
}

function keyRowById(id) {
  return db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id) || null;
}

function keyRowByCustomer(customerId) {
  if (!customerId) return null;
  return db.prepare('SELECT * FROM api_keys WHERE stripe_customer_id = ?').get(customerId) || null;
}

function customerOf(obj) {
  if (!obj) return null;
  return typeof obj === 'string' ? obj : obj.id || null;
}

async function createCheckoutSession(apiKeyId, plan, successUrl, cancelUrl) {
  const keyRow = keyRowById(apiKeyId);
  if (!keyRow) return null;
  const priceId = PRICE_FOR_PLAN[plan];
  if (!priceId) return null;

  let customerId = keyRow.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      name: keyRow.name,
      metadata: { api_key_id: String(apiKeyId) },
    });
    customerId = customer.id;
    db.prepare('UPDATE api_keys SET stripe_customer_id = ? WHERE id = ?').run(customerId, apiKeyId);
  }

  return stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { api_key_id: String(apiKeyId) },
    subscription_data: { metadata: { api_key_id: String(apiKeyId) } },
  });
}

async function createPortalSession(apiKeyId, returnUrl) {
  const keyRow = keyRowById(apiKeyId);
  if (!keyRow || !keyRow.stripe_customer_id) return null;
  return stripe.billingPortal.sessions.create({
    customer: keyRow.stripe_customer_id,
    return_url: returnUrl,
  });
}

function syncSubscription(sub) {
  const keyRow = keyRowByCustomer(customerOf(sub.customer));
  if (!keyRow) return null;
  let plan = 'free';
  const priceId =
    sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price
      ? sub.items.data[0].price.id
      : null;
  if ((sub.status === 'active' || sub.status === 'trialing') && PLAN_FOR_PRICE[priceId]) {
    plan = PLAN_FOR_PRICE[priceId];
  }
  db.prepare('UPDATE api_keys SET plan = ?, stripe_subscription_id = ?, stripe_status = ? WHERE id = ?')
    .run(plan, sub.id || null, sub.status || null, keyRow.id);
  db.prepare('INSERT INTO events (api_key_id, type, detail) VALUES (?, ?, ?)')
    .run(keyRow.id, 'subscription.synced', JSON.stringify({ plan, status: sub.status }));
  return { plan, status: sub.status };
}

async function handleWebhook(rawBody, signature) {
  if (!stripe) {
    return { ok: false, status: 503, error: 'Stripe is not configured on this instance.' };
  }

  let event = null;
  try {
    if (process.env.STRIPE_WEBHOOK_SECRET && signature) {
      event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
    } else if (process.env.ALLOW_UNVERIFIED_WEBHOOKS === '1') {
      event = JSON.parse(rawBody.toString('utf8'));
    }
  } catch (err) {
    return { ok: false, status: 400, error: 'Webhook signature verification failed.' };
  }
  if (!event) {
    return {
      ok: false,
      status: 400,
      error:
        'Unverified webhook. Configure STRIPE_WEBHOOK_SECRET, or set ALLOW_UNVERIFIED_WEBHOOKS=1 for local development.',
    };
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const subId =
        typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription && session.subscription.id;
      if (subId) {
        const sub = await stripe.subscriptions.retrieve(subId);
        syncSubscription(sub);
      }
      break;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      syncSubscription(event.data.object);
      break;

    case 'customer.subscription.deleted': {
      const keyRow = keyRowByCustomer(customerOf(event.data.object.customer));
      if (keyRow) {
        db.prepare("UPDATE api_keys SET plan = 'free', stripe_status = 'canceled' WHERE id = ?").run(
          keyRow.id
        );
        db.prepare('INSERT INTO events (api_key_id, type) VALUES (?, ?)').run(
          keyRow.id,
          'subscription.canceled'
        );
      }
      break;
    }

    case 'invoice.payment_failed': {
      const inv = event.data.object;
      const keyRow = keyRowByCustomer(customerOf(inv.customer));
      if (keyRow) db.prepare("UPDATE api_keys SET stripe_status = 'past_due' WHERE id = ?").run(keyRow.id);
      break;
    }

    default:
      // Ignored event types are intentionally accepted.
      break;
  }

  return { ok: true };
}

module.exports = {
  billingConfigured,
  priceForPlan,
  createCheckoutSession,
  createPortalSession,
  handleWebhook,
  syncSubscription,
};
