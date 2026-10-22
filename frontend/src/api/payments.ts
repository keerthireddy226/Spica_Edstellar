import { api } from "@/lib/api";

export interface Quote {
  kind: "org_licenses" | "individual_plan";
  currency: "INR" | "USD";
  // Full access months: credit for the unused part of a preparation purchase.
  credit?: number;
  provider: "stripe" | "razorpay" | "test";
  quantity: number;
  unitAmount: number;
  subtotal: number;
  taxLabel: string | null;
  taxRate: number;
  taxAmount: number;
  total: number;
  billingCountry: string | null;
  // Rate-card price per unit before plan, volume and education pricing.
  listUnitAmount: number;
  upgradesTo: "business" | "enterprise" | null;
  planMonths: number[] | null;
  testMode: boolean;
}

export interface RazorpayOptions {
  key: string;
  orderId: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill: { email?: string; name?: string };
}

export type CreatedOrder =
  | { orderId: string; provider: "stripe"; redirectUrl: string }
  | { orderId: string; provider: "razorpay"; razorpay: RazorpayOptions }
  | { orderId: string; provider: "test" };

export interface InvoiceSummary {
  id: string;
  invoiceNumber: string;
  issuedAt: string;
  description: string;
  quantity: number;
  currency: string;
  total: number;
  provider: string;
}

export interface Invoice extends InvoiceSummary {
  seller: { name: string; address: string; taxId: string; email: string };
  billTo: Record<string, string | null>;
  unitAmount: number;
  subtotal: number;
  taxLabel: string | null;
  taxRate: number;
  taxAmount: number;
  providerPaymentId: string | null;
  creditNotes?: { creditNoteNumber: string; issuedAt: string; licensesRemoved: number; currency: string; amount: number; reason: string }[];
}

export interface InvoiceOrder {
  id: string;
  quoteNumber: string;
  poNumber: string | null;
  quantity: number;
  currency: string;
  total: number;
  status: "created" | "paid" | "failed" | "cancelled";
  dueDate: string | null;
  createdAt: string;
}

export interface Proforma {
  id: string;
  quoteNumber: string;
  status: InvoiceOrder["status"];
  createdAt: string;
  dueDate: string | null;
  poNumber: string | null;
  seller: { name: string; address: string; taxId: string; email: string };
  billTo: Record<string, string | null>;
  quantity: number;
  currency: string;
  unitAmount: number;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
}

export function requestInvoiceOrder(quantity: number, poNumber?: string) {
  return api<{ orderId: string; quoteNumber: string }>("/payments/invoice-orders", { method: "POST", body: JSON.stringify({ quantity, poNumber }) });
}

export function listInvoiceOrders() {
  return api<{ orders: InvoiceOrder[] }>("/payments/invoice-orders");
}

export function cancelInvoiceOrder(id: string) {
  return api<{ ok: true }>(`/payments/invoice-orders/${id}/cancel`, { method: "POST" });
}

export function getProforma(id: string) {
  return api<Proforma>(`/payments/quotes/${id}`);
}

export function getQuote(quantity: number): Promise<Quote> {
  return api(`/payments/quote?quantity=${quantity}`);
}

export function createPaymentOrder(quantity: number): Promise<CreatedOrder> {
  return api("/payments/orders", { method: "POST", body: JSON.stringify({ quantity }) });
}

export function confirmPaymentOrder(
  orderId: string,
  body: Record<string, string> = {},
): Promise<{ status: "paid"; invoiceId: string; kind: Quote["kind"] | "product"; quantity: number; product: { name: string; kind: string; level: string | null } | null }> {
  return api(`/payments/orders/${orderId}/confirm`, { method: "POST", body: JSON.stringify(body) });
}

export function cancelPaymentOrder(orderId: string): Promise<void> {
  return api(`/payments/orders/${orderId}/cancel`, { method: "POST" });
}

export function getInvoices(): Promise<{ invoices: InvoiceSummary[] }> {
  return api("/payments/invoices");
}

export function getInvoice(id: string): Promise<Invoice> {
  return api(`/payments/invoices/${id}`);
}

// Amounts are in minor units (cents / paise).
export function formatAmount(minor: number, currency: string): string {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: minor % 100 === 0 ? 0 : 2,
  }).format(minor / 100);
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void; on: (event: string, cb: (r: unknown) => void) => void };
  }
}

function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("razorpay_load_failed"));
    document.body.appendChild(script);
  });
}

export const CHECKOUT_RETURN_PATH = "/checkout/return";

// Sends the browser through whichever provider the server picked. Every path
// ends on /checkout/return, which asks the server to verify and fulfil.
export async function startCheckout(order: CreatedOrder, navigate: (to: string) => void): Promise<void> {
  if (order.provider === "stripe") {
    window.location.href = order.redirectUrl;
    return;
  }
  if (order.provider === "test") {
    navigate(`${CHECKOUT_RETURN_PATH}?order=${order.orderId}&test=1`);
    return;
  }
  await loadRazorpay();
  const o = order.razorpay;
  const rzp = new window.Razorpay!({
    key: o.key,
    order_id: o.orderId,
    amount: o.amount,
    currency: o.currency,
    name: o.name,
    description: o.description,
    prefill: o.prefill,
    handler: (resp: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
      const qs = new URLSearchParams({ order: order.orderId, ...resp });
      navigate(`${CHECKOUT_RETURN_PATH}?${qs.toString()}`);
    },
    modal: { ondismiss: () => cancelPaymentOrder(order.orderId).catch(() => {}) },
  });
  rzp.open();
}

// ---- Products: preparation + assessment, an assessment, a level test ----

export type ShopCurrency = "INR" | "USD" | "EUR" | "GBP" | "AED" | "SGD";

export interface PricedProduct {
  id: string;
  kind: "full" | "prep" | "assessment" | "level" | "pack" | "cert_extend" | "cert_lifetime" | "cert_print";
  testTypeId: string | null;
  testTypeName: string | null;
  name: string;
  description: string;
  durationDays: number;
  attempts: number;
  credits: number | null;
  amount: number;
  currency: ShopCurrency;
}

export function getPriceList(currency?: ShopCurrency): Promise<{ currency: ShopCurrency; currencies: ShopCurrency[]; canBuy: boolean; testMode: boolean; products: PricedProduct[] }> {
  return api(`/payments/products${currency ? `?currency=${currency}` : ""}`);
}

export interface ProductQuote {
  productId: string;
  productName: string;
  kind: string;
  level: string | null;
  currency: ShopCurrency;
  provider: "stripe" | "razorpay" | "test";
  price: number;
  credit: number;
  // A level test's discount: a retake at half price, or 25% off the next level.
  discount: number;
  discountReason: "level_retake" | "next_level" | null;
  subtotal: number;
  taxLabel: string | null;
  taxRate: number;
  taxAmount: number;
  total: number;
  durationDays: number;
  attempts: number;
}

// Where a printed certificate is posted.
export interface Shipping {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  postalCode: string;
  country: string;
  phone?: string;
}

export function getProductQuote(productId: string, currency: ShopCurrency, level?: string, certificateId?: string): Promise<ProductQuote> {
  const p = new URLSearchParams({ productId, currency });
  if (level) p.set("level", level);
  if (certificateId) p.set("certificateId", certificateId);
  return api(`/payments/product-quote?${p}`);
}

// Pays the difference to switch preparation to a dearer test; the switch is made once paid.
export function createSwitchOrder(entitlementId: string, testTypeId: string): Promise<CreatedOrder> {
  return api("/payments/switch-orders", { method: "POST", body: JSON.stringify({ entitlementId, testTypeId }) });
}

export function createProductOrder(productId: string, currency: ShopCurrency, level?: string, extra?: { certificateId?: string; shipping?: Shipping }): Promise<CreatedOrder> {
  return api("/payments/product-orders", { method: "POST", body: JSON.stringify({ productId, currency, level, ...extra }) });
}
