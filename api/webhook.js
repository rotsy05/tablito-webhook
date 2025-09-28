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
  console.log('📦 Headers:', req.headers);
  
  if (req.method !== 'POST') {
    console.log('❌ Method not allowed:', req.method);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Gérer le body pour Vercel
  let body;
  if (typeof req.body === 'string') {
    body = req.body;
  } else if (Buffer.isBuffer(req.body)) {
    body = req.body.toString();
  } else {
    body = JSON.stringify(req.body);
  }

  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  console.log('🔐 Signature présente:', !!sig);
  console.log('🔐 Webhook secret configuré:', !!endpointSecret);
  
  let event;

  try {
    // Vérifier que la requête vient bien de Stripe
    event = stripe.webhooks.constructEvent(body, sig, endpointSecret);
    console.log('✅ Webhook signature verified');
  } catch (err) {
    console.log(`❌ Webhook signature verification failed: ${err.message}`);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  console.log('📦 Event type:', event.type);
  console.log('📦 Event data:', JSON.stringify(event.data, null, 2));

  // Gérer les différents événements Stripe
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        console.log('🛒 Processing checkout.session.completed');
        await handleCheckoutCompleted(event.data.object);
        break;
        
      case 'customer.subscription.created':
        console.log('📅 Processing customer.subscription.created');
        await handleSubscriptionCreated(event.data.object);
        break;
        
      case 'customer.subscription.updated':
        console.log('🔄 Processing customer.subscription.updated');
        await handleSubscriptionUpdated(event.data.object);
        break;
        
      case 'customer.subscription.deleted':
        console.log('🗑️ Processing customer.subscription.deleted');
        await handleSubscriptionDeleted(event.data.object);
        break;
        
      case 'invoice.payment_succeeded':
        console.log('💳 Processing invoice.payment_succeeded');
        await handlePaymentSucceeded(event.data.object);
        break;
        
      case 'invoice.payment_failed':
        console.log('❌ Processing invoice.payment_failed');
        await handlePaymentFailed(event.data.object);
        break;
        
      default:
        console.log(`🤷 Unhandled event type: ${event.type}`);
    }

    console.log('✅ Webhook processed successfully');
    res.json({ received: true, event_type: event.type });
  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ error: 'Webhook processing failed', message: error.message });
  }
}

// Gestion du checkout complété
async function handleCheckoutCompleted(session) {
  console.log('🛒 Checkout completed:', session.id);
  console.log('👤 Customer:', session.customer);
  console.log('🏷️ Client reference ID:', session.client_reference_id);
  console.log('📅 Subscription:', session.subscription);
  
  const customerId = session.customer;
  const clientReferenceId = session.client_reference_id; // Notre customer_id custom
  const subscriptionId = session.subscription;

  if (!clientReferenceId) {
    console.log('⚠️ No client_reference_id found, using Stripe customer ID');
  }

  // Sauvegarder dans Supabase
  const userData = {
    customer_id: clientReferenceId || customerId,
    stripe_customer_id: customerId,
    subscription_id: subscriptionId,
    status: 'active',
    updated_at: new Date().toISOString()
  };

  console.log('💾 Saving to Supabase:', userData);

  const { data, error } = await supabase
    .from('premium_users')
    .upsert([userData], {
      onConflict: 'customer_id'
    });

  if (error) {
    console.error('❌ Error saving to Supabase:', error);
    throw error;
  }

  console.log('✅ User premium status saved successfully');
  return data;
}

// Gestion création d'abonnement
async function handleSubscriptionCreated(subscription) {
  console.log('📅 Subscription created:', subscription.id);
  console.log('👤 Customer:', subscription.customer);
  console.log('📊 Status:', subscription.status);
  
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
  console.log('👤 Customer:', invoice.customer);
  
  if (invoice.subscription) {
    // Récupérer les infos de l'abonnement
    const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
    console.log('📅 Subscription status:', subscription.status);
    await updateUserStatus(subscription.customer, subscription.id, 'active');
  }
}

// Gestion échec de paiement
async function handlePaymentFailed(invoice) {
  console.log('❌ Payment failed for subscription:', invoice.subscription);
  console.log('👤 Customer:', invoice.customer);
  
  if (invoice.subscription) {
    const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
    console.log('📅 Subscription status after failed payment:', subscription.status);
    await updateUserStatus(subscription.customer, subscription.id, 'past_due');
  }
}

// Fonction utilitaire pour mettre à jour le statut utilisateur
async function updateUserStatus(stripeCustomerId, subscriptionId, status) {
  console.log('🔄 Updating user status:', { stripeCustomerId, subscriptionId, status });
  
  // Chercher l'utilisateur par stripe_customer_id
  const { data: users, error: searchError } = await supabase
    .from('premium_users')
    .select('*')
    .eq('stripe_customer_id', stripeCustomerId);

  if (searchError) {
    console.error('❌ Error searching user:', searchError);
    throw searchError;
  }

  console.log('👥 Found users:', users);

  if (users && users.length > 0) {
    // Mettre à jour l'utilisateur existant
    const updateData = {
      subscription_id: subscriptionId,
      status: status,
      updated_at: new Date().toISOString()
    };

    console.log('💾 Updating with data:', updateData);

    const { data, error } = await supabase
      .from('premium_users')
      .update(updateData)
      .eq('stripe_customer_id', stripeCustomerId);

    if (error) {
      console.error('❌ Error updating user status:', error);
      throw error;
    }

    console.log('✅ User status updated successfully');
    return data;
  } else {
    console.log('⚠️ User not found for customer:', stripeCustomerId);
    // Créer l'utilisateur s'il n'existe pas
    const newUserData = {
      customer_id: stripeCustomerId, // Fallback si pas de client_reference_id
      stripe_customer_id: stripeCustomerId,
      subscription_id: subscriptionId,
      status: status,
      updated_at: new Date().toISOString()
    };

    console.log('➕ Creating new user:', newUserData);

    const { data, error } = await supabase
      .from('premium_users')
      .insert([newUserData]);

    if (error) {
      console.error('❌ Error creating user:', error);
      throw error;
    }

    console.log('✅ New user created successfully');
    return data;
  }
}
