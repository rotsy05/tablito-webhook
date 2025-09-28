// Configuration pour désactiver le parsing automatique du body
export const config = {
  api: {
    bodyParser: false,
  },
};

import { buffer } from 'micro';
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
    // Récupérer le body brut avec micro
    const buf = await buffer(req);
    const body = buf.toString('utf8');
    
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    
    console.log('🔐 Debug:', {
      hasSignature: !!sig,
      hasSecret: !!endpointSecret,
      bodyLength: body.length
    });

    // Vérifier la signature Stripe avec le body brut
    const event = stripe.webhooks.constructEvent(body, sig, endpointSecret);
    console.log('✅ Signature Stripe vérifiée');
    console.log('📦 Event type:', event.type);

    // Traiter l'événement
    if (event.type === 'checkout.session.completed') {
      console.log('🛒 Traitement checkout.session.completed');
      await handleCheckoutCompleted(event.data.object);
    } else if (event.type === 'customer.subscription.created') {
      console.log('📅 Traitement subscription.created');
      await handleSubscriptionCreated(event.data.object);
    } else if (event.type === 'customer.subscription.updated') {
      console.log('🔄 Traitement subscription.updated');
      await handleSubscriptionUpdated(event.data.object);
    } else if (event.type === 'customer.subscription.deleted') {
      console.log('🗑️ Traitement subscription.deleted');
      await handleSubscriptionDeleted(event.data.object);
    } else if (event.type === 'invoice.payment_succeeded') {
      console.log('💳 Traitement payment.succeeded');
      await handlePaymentSucceeded(event.data.object);
    } else if (event.type === 'invoice.payment_failed') {
      console.log('❌ Traitement payment.failed');
      await handlePaymentFailed(event.data.object);
    } else {
      console.log(`🤷 Event non traité: ${event.type}`);
    }

    return res.json({ received: true, event_type: event.type });

  } catch (err) {
    console.error('❌ Erreur:', err.message);
    return res.status(400).json({ error: err.message });
  }
}

// Gestion checkout complété
async function handleCheckoutCompleted(session) {
  console.log('🛒 Session:', session.id);
  console.log('👤 Customer:', session.customer);
  console.log('🏷️ Client reference:', session.client_reference_id);
  console.log('📅 Subscription:', session.subscription);
  
  const userData = {
    customer_id: session.client_reference_id || session.customer,
    stripe_customer_id: session.customer,
    subscription_id: session.subscription,
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
  } catch (error) {
    console.error('❌ Erreur sauvegarde:', error);
    throw error;
  }
}

// Gestion création d'abonnement
async function handleSubscriptionCreated(subscription) {
  console.log('📅 Subscription created:', subscription.id);
  await updateUserStatus(subscription.customer, subscription.id, subscription.status);
}

// Gestion mise à jour d'abonnement
async function handleSubscriptionUpdated(subscription) {
  console.log('🔄 Subscription updated:', subscription.id, 'Status:', subscription.status);
  await updateUserStatus(subscription.customer, subscription.id, subscription.status);
}

// Gestion suppression d'abonnement
async function handleSubscriptionDeleted(subscription) {
  console.log('🗑️ Subscription deleted:', subscription.id);
  await updateUserStatus(subscription.customer, subscription.id, 'canceled');
}

// Gestion paiement réussi
async function handlePaymentSucceeded(invoice) {
  console.log('💳 Payment succeeded for subscription:', invoice.subscription);
  
  if (invoice.subscription) {
    const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
    await updateUserStatus(subscription.customer, subscription.id, 'active');
  }
}

// Gestion échec de paiement
async function handlePaymentFailed(invoice) {
  console.log('❌ Payment failed for subscription:', invoice.subscription);
  
  if (invoice.subscription) {
    const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
    await updateUserStatus(subscription.customer, subscription.id, 'past_due');
  }
}

// Fonction utilitaire pour mettre à jour le statut utilisateur
async function updateUserStatus(stripeCustomerId, subscriptionId, status) {
  console.log('🔄 Updating user status:', { stripeCustomerId, subscriptionId, status });
  
  try {
    // Chercher l'utilisateur par stripe_customer_id
    const { data: users, error: searchError } = await supabase
      .from('premium_users')
      .select('*')
      .eq('stripe_customer_id', stripeCustomerId);

    if (searchError) {
      console.error('❌ Error searching user:', searchError);
      throw searchError;
    }

    if (users && users.length > 0) {
      // Mettre à jour l'utilisateur existant
      const { error } = await supabase
        .from('premium_users')
        .update({
          subscription_id: subscriptionId,
          status: status,
          updated_at: new Date().toISOString()
        })
        .eq('stripe_customer_id', stripeCustomerId);

      if (error) {
        console.error('❌ Error updating user status:', error);
        throw error;
      }

      console.log('✅ User status updated successfully');
    } else {
      console.log('⚠️ User not found for customer:', stripeCustomerId);
    }
  } catch (error) {
    console.error('❌ Error updating user status:', error);
    throw error;
  }
}
