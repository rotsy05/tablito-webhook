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

  // Récupérer le body brut
  const body = JSON.stringify(req.body);
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  console.log('🔐 Variables présentes:', {
    stripeKey: !!process.env.STRIPE_SECRET_KEY,
    webhookSecret: !!process.env.STRIPE_WEBHOOK_SECRET,
    supabaseUrl: !!process.env.SUPABASE_URL,
    signature: !!sig
  });
  
  let event;

  try {
    // Vérifier la signature Stripe
    event = stripe.webhooks.constructEvent(body, sig, endpointSecret);
    console.log('✅ Signature Stripe vérifiée');
  } catch (err) {
    console.log(`❌ Erreur signature: ${err.message}`);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  console.log('📦 Event type:', event.type);

  try {
    // Traiter l'événement
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

// Gestion checkout complété
async function handleCheckoutCompleted(session) {
  console.log('🛒 Session:', session.id);
  console.log('👤 Customer:', session.customer);
  console.log('🏷️ Client reference:', session.client_reference_id);
  console.log('📅 Subscription:', session.subscription);
  
  const customerId = session.customer;
  const clientReferenceId = session.client_reference_id;
  const subscriptionId = session.subscription;

  // Données à sauvegarder
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
