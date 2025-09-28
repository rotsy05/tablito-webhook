import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// Configuration
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  let event;

  try {
    // Vérifier que la requête vient bien de Stripe
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    console.log('✅ Webhook signature verified');
  } catch (err) {
    console.log(`❌ Webhook signature verification failed: ${err.message}`);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  console.log('📦 Event type:', event.type);

  // Gérer les différents événements Stripe
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;
        
      case 'customer.subscription.created':
        await handleSubscriptionCreated(event.data.object);
        break;
        
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;
        
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;
        
      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object);
        break;
        
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;
        
      default:
        console.log(`🤷 Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}

// Gestion du checkout complété
async function handleCheckoutCompleted(session) {
  console.log('🛒 Checkout completed:', session.id);
  
  const customerId = session.customer;
  const clientReferenceId = session.client_reference_id; // Notre customer_id custom
  const subscriptionId = session.subscription;

  // Sauvegarder dans Supabase
  const { data, error } = await supabase
    .from('premium_users')
    .upsert([
      {
        customer_id: clientReferenceId || customerId,
        stripe_customer_id: customerId,
        subscription_id: subscriptionId,
        status: 'active',
        updated_at: new Date().toISOString()
      }
    ], {
      onConflict: 'customer_id'
    });

  if (error) {
    console.error('❌ Error saving to Supabase:', error);
    throw error;
  }

  console.log('✅ User premium status saved:', data);
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
    // Récupérer les infos de l'abonnement
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
    const { data, error } = await supabase
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

    console.log('✅ User status updated:', { stripeCustomerId, subscriptionId, status });
  } else {
    console.log('⚠️ User not found for customer:', stripeCustomerId);
  }
}
