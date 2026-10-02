'use client';

import React, { useRef, useState } from 'react';
import Portal from '../client/Portal';
import { AppButton } from '../ui/AppButton';
import { toast } from 'sonner';
import { 
    Printer, 
    Copy, 
    Check, 
    X, 
    FileText, 
    ShieldCheck, 
    Building2, 
    Truck, 
    Calendar, 
    Clock, 
    PackageCheck, 
    Download,
    CheckCircle2
} from 'lucide-react';

export interface DigitalReceiptData {
    id?: string;
    po_number: string;
    supplier_name: string;
    supplier_email?: string;
    supplier_phone?: string;
    total_amount: number;
    status: string;
    delivery_date?: string;
    notes?: string;
    items?: Array<{
        name?: string;
        item_name?: string;
        quantity: number;
        unit_price?: number;
        price?: number;
        total?: number;
    }>;
    created_at?: string;
    created_by?: string;
    paid?: boolean;
    verification?: any;
}

interface DigitalReceiptModalProps {
    isOpen: boolean;
    onClose: () => void;
    order?: DigitalReceiptData | null;
    purchaseOrder?: DigitalReceiptData | null;
}

export function DigitalReceiptModal({ isOpen, onClose, order: propOrder, purchaseOrder }: DigitalReceiptModalProps) {
    const receiptRef = useRef<HTMLDivElement>(null);
    const [copied, setCopied] = useState(false);
    const order = propOrder || purchaseOrder || null;

    if (!isOpen || !order) return null;

    const rawDate = order.created_at ? new Date(order.created_at) : new Date();
    const formattedDate = rawDate.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
    const formattedTime = rawDate.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
    });

    const items = (order.items && order.items.length > 0)
        ? order.items
        : [{
              name: order.notes || 'Purchase Order Items',
              item_name: order.notes || 'Purchase Order Items',
              quantity: 1,
              unit_price: order.total_amount,
              total: order.total_amount,
          }];

    const calculatedSubtotal = items.reduce((sum, it) => {
        const qty = Number(it.quantity) || 1;
        const price = Number(it.unit_price ?? it.price ?? 0);
        return sum + (it.total ? Number(it.total) : qty * price);
    }, 0);

    const grandTotal = order.total_amount || calculatedSubtotal;
    const poNum = order.po_number || 'PO-000000';
    const securityCode = `AESC-${poNum.replace(/[^a-zA-Z0-9]/g, '')}-${rawDate.getTime().toString().slice(-6)}`;

    const getStatusStyle = (status: string) => {
        const s = (status || '').toLowerCase();
        if (s === 'confirmed' || s === 'delivered' || s === 'completed' || s === 'paid') {
            return 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800/60';
        }
        if (s === 'sent') {
            return 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 border-indigo-300 dark:border-indigo-800/60';
        }
        if (s === 'approved') {
            return 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400 border-purple-300 dark:border-purple-800/60';
        }
        if (s === 'rejected' || s === 'cancelled') {
            return 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border-rose-300 dark:border-rose-800/60';
        }
        return 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800/60';
    };

    const handlePrint = () => {
        window.print();
    };

    const handleCopyDetails = async () => {
        const text = `================================================
AIRSHIP EXPRESS - OFFICIAL PROCUREMENT DIGITAL RECEIPT
================================================
PO Number: ${order.po_number}
Status: ${order.status.toUpperCase()}
Issue Date: ${formattedDate} at ${formattedTime}
Security Ref: ${securityCode}

BUYER DETAILS:
- Entity: Airship Express Logistics Corp.
- Division: Procurement & Fleet Operations
- Authorized Signatory: ${order.created_by || 'Authorized Officer'}

SUPPLIER / VENDOR DETAILS:
- Supplier: ${order.supplier_name}
- Email/Phone: ${order.supplier_email || order.supplier_phone || 'On File'}
- Expected Delivery: ${order.delivery_date ? new Date(order.delivery_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Standard Schedule'}

ITEMIZED BREAKDOWN:
${items.map((i, idx) => `${idx + 1}. ${i.name || i.item_name || 'Item'} (Qty: ${i.quantity}) @ ₱${Number(i.unit_price ?? i.price ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} = ₱${Number(i.total ?? (i.quantity * Number(i.unit_price ?? i.price ?? 0))).toLocaleString(undefined, { minimumFractionDigits: 2 })}`).join('\n')}

------------------------------------------------
Subtotal: ₱${calculatedSubtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
Grand Total: ₱${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
------------------------------------------------
Notes: ${order.notes || 'Official procurement requisition approved for fleet inventory and supply distribution.'}
Verified & Certified by Airship Express Procurement Management System
================================================`;

        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            toast.success('Digital receipt summary copied to clipboard');
            setTimeout(() => setCopied(false), 2500);
        } catch (e) {
            toast.error('Failed to copy receipt');
        }
    };

    const handleDownloadTxt = () => {
        const text = `================================================
AIRSHIP EXPRESS - OFFICIAL DIGITAL RECEIPT
================================================
PO Number: ${order.po_number}
Status: ${order.status.toUpperCase()}
Date: ${formattedDate} ${formattedTime}
Security Ref: ${securityCode}

Supplier: ${order.supplier_name}
Expected Delivery: ${order.delivery_date || 'Standard Schedule'}

Items:
${items.map((i, idx) => `${idx + 1}. ${i.name || i.item_name || 'Item'} (Qty: ${i.quantity}) @ ₱${(i.unit_price || 0).toLocaleString()} = ₱${(i.total || (i.quantity * (i.unit_price || 0))).toLocaleString()}`).join('\n')}

Subtotal: ₱${calculatedSubtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
Grand Total: ₱${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
Notes: ${order.notes || 'None'}
================================================`;
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `receipt_${order.po_number || 'order'}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success('Receipt details downloaded as .txt');
    };

    return (
        <Portal>
            <div
                className="fixed inset-0 bg-slate-950/70 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center z-[999999] p-3 sm:p-5 overflow-y-auto animate-in fade-in duration-200"
                onClick={onClose}
            >
                <div
                    className="bg-[#f8fafc] dark:bg-[#12131d] rounded-2xl max-w-3xl w-full my-auto shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[92vh]"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Action Bar Header */}
                    <div className="print:hidden px-5 sm:px-6 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-[#161724] shrink-0">
                        <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-pink-50 dark:bg-pink-950/40 border border-pink-200 dark:border-pink-900/50 text-pink-600 dark:text-pink-400 flex items-center justify-center">
                                <FileText className="h-4 w-4" />
                            </div>
                            <div>
                                <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                                    Digital Receipt
                                </span>
                                <span className="text-xs font-mono font-bold text-pink-600 dark:text-pink-400 ml-1.5">
                                    #{order.po_number}
                                </span>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={handleCopyDetails}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
                                title="Copy receipt details"
                            >
                                {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5 text-slate-500" />}
                                <span>{copied ? 'Copied' : 'Copy'}</span>
                            </button>

                            <button
                                type="button"
                                onClick={handleDownloadTxt}
                                className="hidden sm:inline-flex px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 active:scale-95 transition-all items-center gap-1.5 cursor-pointer"
                                title="Download as text file"
                            >
                                <Download className="h-3.5 w-3.5 text-slate-500" />
                                <span>Download</span>
                            </button>

                            <button
                                type="button"
                                onClick={handlePrint}
                                className="px-3.5 py-1.5 rounded-lg text-xs font-bold text-white bg-pink-600 hover:bg-pink-700 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
                                title="Print or save as PDF"
                            >
                                <Printer className="h-3.5 w-3.5" />
                                <span>Print / PDF</span>
                            </button>

                            <button
                                type="button"
                                onClick={onClose}
                                className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white flex items-center justify-center transition-all cursor-pointer ml-1 active:scale-95"
                                aria-label="Close"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                    </div>

                    {/* Scrollable Receipt Canvas */}
                    <div className="p-4 sm:p-6 overflow-y-auto flex-1 bg-slate-100/70 dark:bg-[#0c0d14]">
                        <div
                            ref={receiptRef}
                            id="printable-digital-receipt"
                            className="bg-white dark:bg-[#161724] text-slate-900 dark:text-slate-100 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm font-sans relative overflow-hidden print:p-0 print:border-none print:shadow-none print:bg-white print:text-black transition-all"
                        >
                            {/* Minimal Solid Pink Top Accent Strip */}
                            <div className="h-1.5 w-full bg-pink-600 receipt-top-accent" />

                            <div className="p-6 sm:p-7 space-y-5">
                                {/* Header: Brand, Title, Status */}
                                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800 receipt-header-border">
                                    <div className="flex items-center gap-3">
                                        <div className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-[#12131d] border border-slate-200 dark:border-slate-800 flex items-center justify-center p-2 shrink-0 receipt-logo-box">
                                            <img
                                                src="/images/logo-remove-bg.png"
                                                alt="Airship Express"
                                                className="w-full h-full object-contain dark:brightness-0 dark:invert"
                                            />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="font-extrabold text-base tracking-tight text-slate-900 dark:text-white leading-tight receipt-brand">
                                                    Airship<span className="text-pink-600 font-bold receipt-brand-accent">Express</span>
                                                </span>
                                                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-pink-50 dark:bg-pink-950/50 text-pink-600 dark:text-pink-400 border border-pink-200 dark:border-pink-900/50 receipt-official-pill">
                                                    Official
                                                </span>
                                            </div>
                                            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-0.5">
                                                Procurement & Supply Chain Operations
                                            </p>
                                        </div>
                                    </div>

                                    <div className="sm:text-right flex sm:flex-col items-center sm:items-end justify-between w-full sm:w-auto gap-2">
                                        <div className="flex items-center gap-2">
                                            <span className={`text-xs font-bold px-2.5 py-0.5 rounded-lg border ${getStatusStyle(order.status)}`}>
                                                {order.status}
                                            </span>
                                            <span className="font-mono text-xs font-bold text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-[#10111a] px-2.5 py-0.5 rounded-lg border border-slate-200 dark:border-slate-800 receipt-po-badge">
                                                #{order.po_number}
                                            </span>
                                        </div>
                                        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1 sm:mt-1">
                                            <Clock className="h-3 w-3 inline text-slate-400" />
                                            <span>{formattedDate} · {formattedTime}</span>
                                        </p>
                                    </div>
                                </div>

                                {/* Buyer & Supplier Cards Grid */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                                    {/* Buyer Entity Card */}
                                    <div className="bg-slate-50 dark:bg-[#131420] p-4 rounded-xl border border-slate-200 dark:border-slate-800 receipt-card">
                                        <div className="flex items-center gap-2 mb-2 text-pink-600 dark:text-pink-400 receipt-section-title">
                                            <Building2 className="h-3.5 w-3.5" />
                                            <span className="text-[10px] font-bold uppercase tracking-wider">Buyer (Issuer)</span>
                                        </div>
                                        <p className="text-xs font-bold text-slate-900 dark:text-slate-100">
                                            Airship Express Logistics Corp.
                                        </p>
                                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                            Procurement Department · Fleet Division
                                        </p>
                                        <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                                            <span>Authorized Signatory:</span>
                                            <span className="font-semibold text-slate-700 dark:text-slate-300 truncate max-w-[150px]">
                                                {order.created_by || 'Procurement Officer'}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Supplier / Vendor Card */}
                                    <div className="bg-slate-50 dark:bg-[#131420] p-4 rounded-xl border border-slate-200 dark:border-slate-800 receipt-card">
                                        <div className="flex items-center gap-2 mb-2 text-pink-600 dark:text-pink-400 receipt-section-title">
                                            <Truck className="h-3.5 w-3.5" />
                                            <span className="text-[10px] font-bold uppercase tracking-wider">Supplier / Vendor</span>
                                        </div>
                                        <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                                            {order.supplier_name}
                                        </p>
                                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 font-mono truncate">
                                            {order.supplier_email || order.supplier_phone || 'Verified Supplier'}
                                        </p>
                                        <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                                            <span className="flex items-center gap-1">
                                                <Calendar className="h-3 w-3 text-slate-400" />
                                                <span>Expected Delivery:</span>
                                            </span>
                                            <span className="font-semibold text-slate-800 dark:text-slate-200">
                                                {order.delivery_date ? new Date(order.delivery_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Standard Schedule'}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Itemized Line Items Table */}
                                <div className="space-y-2 pt-1">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-1.5 text-slate-800 dark:text-slate-200 font-bold text-xs">
                                            <PackageCheck className="h-3.5 w-3.5 text-pink-600 dark:text-pink-400" />
                                            <span className="uppercase tracking-wider">Line Items</span>
                                        </div>
                                        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                                            {items.length} {items.length === 1 ? 'item' : 'items'}
                                        </span>
                                    </div>

                                    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131420] receipt-table-wrapper">
                                        <table className="w-full text-left text-xs border-collapse">
                                            <thead>
                                                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#10111a] text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 receipt-table-header">
                                                    <th className="py-2.5 px-3 w-10 text-center">#</th>
                                                    <th className="py-2.5 px-3">Description</th>
                                                    <th className="py-2.5 px-3 text-center w-16">Qty</th>
                                                    <th className="py-2.5 px-3 text-right w-28">Unit Price</th>
                                                    <th className="py-2.5 px-3 text-right w-32">Total</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium text-slate-700 dark:text-slate-300 receipt-table-body">
                                                {items.map((item, idx) => {
                                                    const qty = Number(item.quantity) || 1;
                                                    const unitPrice = Number(item.unit_price ?? item.price ?? 0);
                                                    const total = item.total ? Number(item.total) : qty * unitPrice;

                                                    return (
                                                        <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                                                            <td className="py-2.5 px-3 text-center text-slate-400 font-mono text-[11px]">
                                                                {idx + 1}
                                                            </td>
                                                            <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-white">
                                                                {item.name || item.item_name || 'Inventory Item'}
                                                            </td>
                                                            <td className="py-2.5 px-3 text-center">
                                                                <span className="font-mono text-xs font-semibold">
                                                                    {qty}
                                                                </span>
                                                            </td>
                                                            <td className="py-2.5 px-3 text-right font-mono text-slate-600 dark:text-slate-400">
                                                                ₱{unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                            </td>
                                                            <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                                                                ₱{total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                {/* Financial Summary & Notes Panel */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 items-start pt-1">
                                    {/* Order Notes / Terms */}
                                    <div className="bg-slate-50 dark:bg-[#131420] p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 text-xs space-y-1 receipt-card">
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                                            Order Notes
                                        </span>
                                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed font-normal text-[11px]">
                                            {order.notes || 'Official procurement requisition approved for fleet inventory and supply distribution.'}
                                        </p>
                                    </div>

                                    {/* Calculated Totals Box */}
                                    <div className="bg-slate-50 dark:bg-[#131420] p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2 text-xs receipt-card receipt-totals-box">
                                        <div className="flex justify-between items-center text-slate-600 dark:text-slate-400 text-[11px]">
                                            <span>Subtotal</span>
                                            <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                                                ₱{calculatedSubtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center text-slate-600 dark:text-slate-400 text-[11px]">
                                            <span>Logistics / Handling</span>
                                            <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                                                ₱0.00
                                            </span>
                                        </div>
                                        <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex justify-between items-baseline receipt-grand-total-row">
                                            <div>
                                                <span className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider block">
                                                    Grand Total
                                                </span>
                                                <span className="text-[10px] text-slate-500 dark:text-slate-400">
                                                    PHP
                                                </span>
                                            </div>
                                            <div className="text-right">
                                                <span className="font-mono text-xl font-black text-pink-600 dark:text-pink-400 tracking-tight receipt-grand-total-amount">
                                                    ₱{grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Security Verification & Signatures */}
                                <div className="mt-4 pt-3.5 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs receipt-footer-border">
                                    {/* Digital Authentication */}
                                    <div className="flex items-center gap-2.5 bg-slate-50 dark:bg-[#131420] p-3 rounded-xl border border-slate-200 dark:border-slate-800 receipt-card">
                                        <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-200 dark:border-emerald-800">
                                            <ShieldCheck className="h-4 w-4" />
                                        </div>
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                <span className="font-bold text-[11px] text-slate-900 dark:text-white">
                                                    System Verified
                                                </span>
                                                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                                            </div>
                                            <p className="text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate mt-0.5">
                                                {securityCode}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Signatory Stamp */}
                                    <div className="flex items-center justify-between bg-slate-50 dark:bg-[#131420] p-3 rounded-xl border border-slate-200 dark:border-slate-800 receipt-card">
                                        <div>
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                                                Signatory
                                            </span>
                                            <p className="font-semibold text-xs text-slate-900 dark:text-slate-100 mt-0.5 truncate max-w-[140px]">
                                                {order.created_by || 'Procurement Executive'}
                                            </p>
                                        </div>
                                        <div className="px-2 py-0.5 rounded bg-pink-50 dark:bg-pink-950/40 border border-pink-200 dark:border-pink-900/50 text-pink-600 dark:text-pink-400 font-mono text-[10px] font-bold uppercase receipt-verified-badge">
                                            VERIFIED
                                        </div>
                                    </div>
                                </div>

                                {/* Bottom Minimal Footer */}
                                <div className="pt-3 border-t border-slate-100 dark:border-slate-800/60 flex flex-col sm:flex-row items-center justify-between gap-2 text-[10px] text-slate-400">
                                    <div className="font-mono tracking-widest text-[9px] uppercase">
                                        ||| | |||| || ||||| |||| || |||| | |||||
                                    </div>
                                    <div className="text-center sm:text-right font-medium">
                                        AirshipExpress Supply Chain Management System
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Modal Footer */}
                    <div className="print:hidden px-6 py-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#161724] flex items-center justify-between shrink-0">
                        <span className="text-xs text-slate-400 font-medium">
                            Press <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[10px] border border-slate-200 dark:border-slate-700">Esc</kbd> to close
                        </span>
                        <AppButton type="button" variant="neutral" size="sm" onClick={onClose}>
                            Close
                        </AppButton>
                    </div>
                </div>
            </div>

            {/* Print & PDF Styling using Primary Pink */}
            <style jsx global>{`
                @media print {
                    @page {
                        margin: 15mm;
                        size: auto;
                    }
                    body * {
                        visibility: hidden !important;
                    }
                    #printable-digital-receipt, #printable-digital-receipt * {
                        visibility: visible !important;
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }
                    #printable-digital-receipt {
                        position: absolute !important;
                        left: 0 !important;
                        top: 0 !important;
                        width: 100% !important;
                        margin: 0 !important;
                        padding: 20px !important;
                        background: #ffffff !important;
                        color: #0f172a !important;
                        box-shadow: none !important;
                        border: 1px solid #e2e8f0 !important;
                        border-radius: 8px !important;
                    }
                    .receipt-top-accent {
                        background-color: #db2777 !important;
                        height: 4px !important;
                    }
                    .receipt-brand-accent {
                        color: #db2777 !important;
                        font-weight: 800 !important;
                    }
                    .receipt-official-pill {
                        background-color: #fdf2f8 !important;
                        color: #db2777 !important;
                        border-color: #fbcfe8 !important;
                    }
                    .receipt-section-title {
                        color: #db2777 !important;
                    }
                    .receipt-card {
                        background-color: #fafafa !important;
                        border-color: #e2e8f0 !important;
                    }
                    .receipt-table-wrapper {
                        border-color: #cbd5e1 !important;
                        background-color: #ffffff !important;
                    }
                    .receipt-table-header {
                        background-color: #fdf2f8 !important;
                        color: #9d174d !important;
                        border-bottom: 2px solid #db2777 !important;
                    }
                    .receipt-table-header th {
                        color: #9d174d !important;
                    }
                    .receipt-grand-total-amount {
                        color: #db2777 !important;
                        font-weight: 900 !important;
                    }
                    .receipt-verified-badge {
                        background-color: #fdf2f8 !important;
                        color: #db2777 !important;
                        border-color: #fbcfe8 !important;
                    }
                }
            `}</style>
        </Portal>
    );
}
