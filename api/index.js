// Configuration pour désactiver le parsing automatique du body
export const config = {
  api: {
    bodyParser: false,
  },
};

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

  try {
    // Récupérer le body brut sans micro
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString('utf8');
    });
    
    await new Promise(resolve => {
      req.on('end', resolve);
    });
    
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    
    console.log('🔐 Debug:', {
      hasSignature: !!sig,
      hasSecret: !!endpointSecret,
      bodyLength: body.length
    });

    // Vérifier la signature Stripe
    const event = stripe.webhooks.constructEvent(body, sig, endpointSecret);
    console.log('✅ Signature Stripe vérifiée');
    console.log('📦 Event type:', event.type);

    // Traiter l'événement
    if (event.type === 'checkout.session.completed') {
      console.log('🛒 Traitement checkout.session.completed');
      await handleCheckoutCompleted(event.data.object);
    }

    return res.json({ received: true, event_type: event.type });

  } catch (err) {
    console.error('❌ Erreur:', err.message);
    return res.status(400).json({ error: err.message });
  }
}

async function handleCheckoutCompleted(session) {
  console.log('🛒 Session:', session.id);
  console.log('👤 Customer:', session.customer);
  console.log('🏷️ Client reference:', session.client_reference_id);
  
  const userData = {
    customer_id: session.client_reference_id || session.customer,
    stripe_customer_id: session.customer,
    subscription_id: session.subscription,
    status: 'active',
    updated_at: new Date().toISOString()
  };

  console.log('💾 Sauvegarde Supabase:', userData);

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
}
