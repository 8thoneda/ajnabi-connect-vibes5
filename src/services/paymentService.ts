import { RAZORPAY_KEY_ID, PAYMENT_API_URL, PAYMENT_CONFIG } from '@/config/payments';

export interface PaymentResult {
  success: boolean;
  error?: string;
  paymentId?: string;
  orderId?: string;
}

declare global {
  interface Window {
    Razorpay: any;
  }
}

export class PaymentService {
  private static loadRazorpayScript(): Promise<boolean> {
    return new Promise((resolve) => {
      if (window.Razorpay) {
        resolve(true);
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  }

  static async testPaymentGateway(): Promise<{ available: boolean; error?: string }> {
    try {
      const scriptLoaded = await this.loadRazorpayScript();
      if (!scriptLoaded) {
        return { available: false, error: 'Razorpay script failed to load' };
      }

      if (!RAZORPAY_KEY_ID) {
        return { available: false, error: 'Razorpay key not configured' };
      }

      return { available: true };
    } catch (error) {
      return { available: false, error: 'Payment gateway test failed' };
    }
  }

  private static async createOrder(amountInRupees: number, description: string): Promise<any> {
    try {
      const response = await fetch(`${PAYMENT_API_URL}/create-order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          amount: amountInRupees,
          currency: 'INR',
          receipt: `receipt_${Date.now()}`,
          notes: {
            description,
            timestamp: new Date().toISOString()
          }
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}: Failed to create order`);
      }

      return await response.json();
    } catch (error: any) {
      console.error('Order creation failed:', error);
      throw new Error(error.message || 'Failed to create payment order');
    }
  }

  private static async verifyPayment(paymentData: any): Promise<PaymentResult> {
    try {
      const response = await fetch(`${PAYMENT_API_URL}/verify-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify(paymentData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Payment verification failed');
      }

      const result = await response.json();
      return {
        success: result.verified,
        paymentId: result.paymentId,
        orderId: result.orderId
      };
    } catch (error: any) {
      console.error('Payment verification failed:', error);
      return {
        success: false,
        error: error.message || 'Payment verification failed'
      };
    }
  }

  private static async initiatePayment(
    amountInRupees: number, 
    description: string,
    userInfo?: { name?: string; email?: string; phone?: string }
  ): Promise<PaymentResult> {
    try {
      // Load Razorpay script
      const scriptLoaded = await this.loadRazorpayScript();
      if (!scriptLoaded) {
        throw new Error('Payment gateway not available');
      }

      // Create order
      const order = await this.createOrder(amountInRupees, description);

      return new Promise((resolve) => {
        const options = {
          key: RAZORPAY_KEY_ID,
          amount: order.amount,
          currency: order.currency,
          name: PAYMENT_CONFIG.company.name,
          description: description,
          order_id: order.orderId,
          handler: async (response: any) => {
            try {
              const verificationResult = await this.verifyPayment({
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_signature: response.razorpay_signature,
              });
              resolve(verificationResult);
            } catch (error: any) {
              resolve({
                success: false,
                error: error.message || 'Payment verification failed'
              });
            }
          },
          modal: {
            ondismiss: () => {
              resolve({
                success: false,
                error: 'Payment cancelled by user'
              });
            }
          },
          prefill: {
            name: userInfo?.name || '',
            email: userInfo?.email || '',
            contact: userInfo?.phone || ''
          },
          theme: PAYMENT_CONFIG.company.theme
        };

        const rzp = new window.Razorpay(options);
        rzp.open();
      });
    } catch (error: any) {
      console.error('Payment initiation error:', error);
      return {
        success: false,
        error: error.message || 'Failed to initiate payment'
      };
    }
  }

  // Premium subscription with price parameter
  static async subscribeToPremium(
    planId: keyof typeof import('@/config/payments').PREMIUM_PLANS,
    userInfo?: { name?: string; email?: string; phone?: string }
  ): Promise<PaymentResult> {
    const { PREMIUM_PLANS } = await import('@/config/payments');
    const plan = PREMIUM_PLANS[planId];
    
    if (!plan) {
      return {
        success: false,
        error: 'Invalid premium plan selected'
      };
    }

    const description = `Premium Subscription - ${plan.duration}`;
    return this.initiatePayment(plan.price, description, userInfo);
  }

  // Coin package purchase
  static async buyCoinPackage(
    packageId: keyof typeof import('@/config/payments').COIN_PACKAGES,
    userInfo?: { name?: string; email?: string; phone?: string }
  ): Promise<PaymentResult> {
    const { COIN_PACKAGES } = await import('@/config/payments');
    const coinPackage = COIN_PACKAGES[packageId];
    
    if (!coinPackage) {
      return {
        success: false,
        error: 'Invalid coin package selected'
      };
    }

    const description = `${coinPackage.coins} Coins Package`;
    return this.initiatePayment(coinPackage.price, description, userInfo);
  }

  // Unlimited calls subscription
  static async subscribeToUnlimitedCalls(
    autoRenew: boolean,
    userInfo?: { name?: string; email?: string; phone?: string }
  ): Promise<PaymentResult> {
    const { UNLIMITED_CALLS_PLAN } = await import('@/config/payments');
    
    const description = `Unlimited Voice Calls - ${UNLIMITED_CALLS_PLAN.duration}${autoRenew ? ' (Auto-renew)' : ''}`;
    return this.initiatePayment(UNLIMITED_CALLS_PLAN.price, description, userInfo);
  }
}