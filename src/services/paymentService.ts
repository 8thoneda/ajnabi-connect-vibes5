export class PaymentService {
  async createOrder(amountInRupees) {
    try {
      const response = await fetch("/api/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: amountInRupees }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: Failed to create order`);
      }

      return await response.json(); // Contains id, amount, currency
    } catch (err) {
      console.error("Order creation failed:", err);
      throw err;
    }
  }

  async initiatePayment(amountInRupees) {
    try {
      const order = await this.createOrder(amountInRupees);

      const options = {
        key: import.meta.env.VITE_RAZORPAY_KEY_ID,
        amount: order.amount,
        currency: order.currency,
        name: "Your App Name",
        description: "Premium Subscription",
        order_id: order.id,
        handler: async (response) => {
          await this.verifyPayment(response);
        },
        theme: { color: "#F6C343" },
      };

      const rzp = new window.Razorpay(options);
      rzp.open();
    } catch (err) {
      console.error("Payment initiation error:", err);
    }
  }

  async verifyPayment(paymentResponse) {
    try {
      const response = await fetch("/api/verify-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(paymentResponse),
      });

      const result = await response.json();
      if (result.status === "success") {
        alert("Payment successful!");
      } else {
        alert("Payment verification failed!");
      }
    } catch (err) {
      console.error("Payment verification error:", err);
    }
  }
}
