import { createClient } from 'npm:@supabase/supabase-js@2.54.0';
import { createHmac } from 'node:crypto';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface CreateOrderRequest {
  amount: number;
  currency?: string;
  receipt?: string;
  notes?: Record<string, string>;
}

interface VerifyPaymentRequest {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayOrderResponse {
  id: string;
  entity: string;
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  receipt: string;
  status: string;
  attempts: number;
  notes: Record<string, string>;
  created_at: number;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const url = new URL(req.url);
    const path = url.pathname;

    // Get Razorpay credentials from environment
    const RAZORPAY_KEY_ID = Deno.env.get('RAZORPAY_KEY_ID');
    const RAZORPAY_KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET');

    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
      console.error('Missing Razorpay credentials');
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Payment service configuration error' 
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Create Razorpay Basic Auth header
    const authHeader = 'Basic ' + btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`);

    if (path.endsWith('/create-order') && req.method === 'POST') {
      const body: CreateOrderRequest = await req.json();
      
      // Validate request
      if (!body.amount || body.amount <= 0 || body.amount > 100000) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Invalid amount. Must be between ₹1 and ₹1,00,000' 
          }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }

      // Create order with Razorpay
      const orderData = {
        amount: Math.round(body.amount * 100), // Convert to paise
        currency: body.currency || 'INR',
        receipt: body.receipt || 'receipt_' + Date.now(),
        notes: body.notes || {}
      };

      try {
        const response = await fetch('https://api.razorpay.com/v1/orders', {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(orderData)
        });

        if (!response.ok) {
          const errorData = await response.text();
          console.error('Razorpay API error:', response.status, errorData);
          throw new Error(`Razorpay API error: ${response.status}`);
        }

        const order: RazorpayOrderResponse = await response.json();
        
        console.log('Order created successfully:', order.id);
        
        return new Response(
          JSON.stringify({
            success: true,
            orderId: order.id,
            amount: order.amount / 100, // Convert back to rupees
            currency: order.currency,
            receipt: order.receipt
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      } catch (error: any) {
        console.error('Order creation failed:', error);
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Failed to create payment order' 
          }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }
    }

    if (path.endsWith('/verify-payment') && req.method === 'POST') {
      const body: VerifyPaymentRequest = await req.json();
      
      // Validate request
      if (!body.razorpay_payment_id || !body.razorpay_order_id || !body.razorpay_signature) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Missing payment verification parameters' 
          }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }

      try {
        // Verify payment signature using Razorpay's algorithm
        const generatedSignature = createHmac('sha256', RAZORPAY_KEY_SECRET)
          .update(`${body.razorpay_order_id}|${body.razorpay_payment_id}`)
          .digest('hex');

        const isSignatureValid = generatedSignature === body.razorpay_signature;
        
        if (isSignatureValid) {
          console.log('Payment verified successfully:', body.razorpay_payment_id);
          
          // Optional: Fetch payment details from Razorpay for additional verification
          try {
            const paymentResponse = await fetch(`https://api.razorpay.com/v1/payments/${body.razorpay_payment_id}`, {
              headers: {
                'Authorization': authHeader
              }
            });

            if (paymentResponse.ok) {
              const paymentData = await paymentResponse.json();
              console.log('Payment details:', paymentData);
              
              // Additional checks can be performed here
              if (paymentData.status !== 'captured' && paymentData.status !== 'authorized') {
                return new Response(
                  JSON.stringify({ 
                    success: false, 
                    error: 'Payment not completed successfully' 
                  }),
                  {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                  }
                );
              }
            }
          } catch (fetchError) {
            console.warn('Could not fetch payment details, but signature is valid:', fetchError);
          }

          return new Response(
            JSON.stringify({
              success: true,
              verified: true,
              paymentId: body.razorpay_payment_id,
              orderId: body.razorpay_order_id
            }),
            {
              status: 200,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
          );
        } else {
          console.error('Invalid payment signature');
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: 'Invalid payment signature' 
            }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
          );
        }
      } catch (error: any) {
        console.error('Payment verification failed:', error);
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Payment verification failed' 
          }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }
    }

    // Handle unknown endpoints
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: 'Endpoint not found' 
      }),
      {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error: any) {
    console.error('Edge function error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: 'Internal server error' 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});