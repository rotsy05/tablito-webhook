// Version ultra-simplifiée pour debug
export default async function handler(req, res) {
  console.log('🚀 Webhook called, method:', req.method);
  
  try {
    // Test basique
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed', method: req.method });
    }

    // Réponse simple pour tester
    console.log('✅ Webhook POST received');
    return res.status(200).json({ 
      message: 'Webhook received successfully',
      timestamp: new Date().toISOString(),
      method: req.method
    });

  } catch (error) {
    console.error('❌ Error in webhook:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}
