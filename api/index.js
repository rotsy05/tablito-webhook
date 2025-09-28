import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// Configuration
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  console.log('🚀 Webhook called, method:', req.method);
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Traitement correct du body pour Stripe
  let body;
  if (typeof req.body === 'string') {
    body = req.body;
  } else if (Buffer.isBuffer(req.body)) {
    body = req.body;
  } else {
    body = JSON.stringify(req.body);
  }

  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  console.log('🔐 Debug signature:', {
    hasSignature: !!sig,
    hasSecret: !!endpointSecret,
    bodyType: typeof body,
    bodyLength: body?.length || 0
  });
  
  let event;

  try {
    event = stripe.webhooks.constructEvent(body, sig, endpointSecret);
    console.log('✅ Signature Stripe vérifiée');
  } catch (err) {
    console.log(`❌ Erreur signature: ${err.message}`);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  console.log('📦 Event type:', event.type);

  try {
    if (event.type === 'checkout.session.completed') {
      console.log('🛒 Traitement checkout.session.completed');
      await handleCheckoutCompleted(event.data.object);
    } else {
      console.log(`🤷 Event non traité: ${event.type}`);
    }

    console.log('✅ Webhook traité avec succès');
    return res.json({ received: true, event_type: event.type });

  } catch (error) {
    console.error('❌ Erreur traitement:', error);
    return res.status(500).json({ error: 'Erreur traitement webhook' });
  }
}

async function handleCheckoutCompleted(session) {
  console.log('🛒 Session:', session.id);
  console.log('👤 Customer:', session.customer);
  console.log('🏷️ Client reference:', session.client_reference_id);
  
  const customerId = session.customer;
  const clientReferenceId = session.client_reference_id;
  const subscriptionId = session.subscription;

  const userData = {
    customer_id: clientReferenceId || customerId,
    stripe_customer_id: customerId,
    subscription_id: subscriptionId,
    status: 'active',
    updated_at: new Date().toISOString()
  };

  console.log('💾 Sauvegarde Supabase:', userData);

  try {
    const { data, error } = await supabase
      .from('premium_users')
      .upsert([userData], {
        onConflict: 'customer_id'
      });

    if (error) {
      console.error('❌ Erreur Supabase:', error);
      throw error;
    }

    console.log('✅ Utilisateur premium sauvegardé');
    return data;

  } catch (error) {
    console.error('❌ Erreur sauvegarde:', error);
    throw error;
  }
}
