import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';

// Load environment variables
dotenv.config();

const PORT = 3000;

async function startServer() {
  const app = express();
  app.use(express.json());

  // -------------------------------------------------------------
  // Midtrans API Routes
  // -------------------------------------------------------------

  // Endpoint to fetch public configuration
  app.get('/api/midtrans/config', (req, res) => {
    const rawServerKey = process.env.MIDTRANS_SERVER_KEY || '';
    const rawClientKey = process.env.VITE_MIDTRANS_CLIENT_KEY || '';
    const rawIsProduction = process.env.MIDTRANS_IS_PRODUCTION || 'false';

    const serverKey = rawServerKey.replace(/^["']|["']$/g, '').trim();
    const clientKey = rawClientKey.replace(/^["']|["']$/g, '').trim();
    let isProduction = rawIsProduction.replace(/^["']|["']$/g, '').trim() === 'true';

    // Auto-detect production keys (they do not start with 'SB-')
    if (serverKey && !serverKey.startsWith('SB-')) {
      isProduction = true;
    }

    res.json({
      isConfigured: !!serverKey,
      clientKey: clientKey,
      isProduction: isProduction,
      message: serverKey 
        ? "Midtrans is configured and ready." 
        : "Midtrans keys are not set. The application is running in Demo Simulation Mode."
    });
  });

  // Endpoint to create a Midtrans Snap Token
  app.post('/api/midtrans/token', async (req, res) => {
    try {
      const { 
        orderId, 
        amount, 
        customerName, 
        customerEmail, 
        customerPhone, 
        serviceName 
      } = req.body;

      if (!orderId || !amount || !serviceName) {
        return res.status(400).json({ error: 'Missing required fields: orderId, amount, serviceName' });
      }

      const rawServerKey = process.env.MIDTRANS_SERVER_KEY || '';
      const rawIsProduction = process.env.MIDTRANS_IS_PRODUCTION || 'false';

      const serverKey = rawServerKey.replace(/^["']|["']$/g, '').trim();
      let isProduction = rawIsProduction.replace(/^["']|["']$/g, '').trim() === 'true';

      // Auto-detect production keys (they do not start with 'SB-')
      if (serverKey && !serverKey.startsWith('SB-')) {
        isProduction = true;
      }

      // Graceful fallback for Demo Simulation Mode if Server Key is missing
      if (!serverKey) {
        console.warn('MIDTRANS_SERVER_KEY is missing. Providing simulated Snap redirect URL.');
        
        // Build simulated query params
        const qParams = new URLSearchParams({
          id: orderId,
          amount: String(amount),
          service: serviceName,
          name: customerName || 'Guest Customer',
          email: customerEmail || 'sawahjayatrans@gmail.com',
          phone: customerPhone || '085212347289'
        });

        return res.json({
          token: `demo-token-${orderId}-${Math.floor(100000 + Math.random() * 900000)}`,
          redirect_url: `/#/midtrans-pay?${qParams.toString()}`,
          isDemo: true,
          message: 'Operating in Demo Simulation Mode. Set MIDTRANS_SERVER_KEY to use real Midtrans Snap.'
        });
      }

      // Midtrans Snap API Url
      const midtransUrl = isProduction
        ? 'https://app.midtrans.com/snap/v1/transactions'
        : 'https://app.sandbox.midtrans.com/snap/v1/transactions';

      // Midtrans Authorization: Basic base64(serverKey + ":")
      const authHeader = Buffer.from(`${serverKey}:`).toString('base64');

      // Setup payload matching Midtrans specifications
      const payload = {
        transaction_details: {
          order_id: `${orderId}-${Date.now()}`, // Append unique timestamp to bypass Sandbox duplicate ID limits
          gross_amount: Math.round(amount)
        },
        customer_details: {
          first_name: customerName || 'Guest Customer',
          email: customerEmail || 'customer@example.com',
          phone: customerPhone || '085212347289'
        },
        item_details: [
          {
            id: orderId,
            price: Math.round(amount),
            quantity: 1,
            name: serviceName.substring(0, 50) // Midtrans requires <= 50 characters for item names
          }
        ]
      };

      console.log(`Requesting Midtrans Snap token for order: ${orderId}, amount: IDR ${amount}`);

      const response = await fetch(midtransUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Basic ${authHeader}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Midtrans API Error response:', errorText);
        return res.status(response.status).json({
          error: `Midtrans Snap API returned error status ${response.status}`,
          details: errorText
        });
      }

      const data: any = await response.json();
      return res.json({
        token: data.token,
        redirect_url: data.redirect_url,
        isDemo: false
      });

    } catch (error: any) {
      console.error('Midtrans Snap backend handler crashed:', error);
      return res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
  });

  // -------------------------------------------------------------
  // Frontend Asset Handling (Vite / Static production)
  // -------------------------------------------------------------

  if (process.env.NODE_ENV !== 'production') {
    // Development Mode: Use Vite Dev Server Middleware
    console.log('Running in Development mode. Mounting Vite Dev Server Middleware...');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production Mode: Serve Compiled Frontend Assets from /dist
    console.log('Running in Production mode. Serving static assets from /dist...');
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SmartJourney Fullstack Engine] Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
