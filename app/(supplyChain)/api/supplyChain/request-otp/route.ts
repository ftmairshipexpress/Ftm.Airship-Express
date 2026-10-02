// app/(supplyChain)/api/supplyChain/request-otp/route.ts

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { sendOTPEmail } from '../../../lib/email/sendOTP';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPPLYCHAIN_SUPABASE_URL || '';
const serviceRoleKey = process.env.NEXT_PUBLIC_SUPPLYCHAIN_SUPABASE_SERVICE_ROLE_KEY || 
                       process.env.SUPPLYCHAIN_SUPABASE_SERVICE_ROLE_KEY || 
                       process.env.NEXT_PUBLIC_SUPPLYCHAIN_SUPABASE_ANON_KEY || '';

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false,
    },
});

function generateOTP(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function hashOTP(otp: string): string {
    return createHash('sha256').update(otp).digest('hex');
}

export async function POST(request: Request) {
    try {
        const { userId, email, loggedInUserId, employeeName } = await request.json();

        const effectiveUserId = userId || loggedInUserId;
        const effectiveLoggedInUserId = loggedInUserId || userId;

        if (!effectiveUserId || !email) {
            return NextResponse.json(
                { message: 'User ID and email are required' },
                { status: 400 }
            );
        }

        // validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return NextResponse.json(
                { message: 'Invalid email format' },
                { status: 400 }
            );
        }

        const isValidUuid = (str?: string | null) => !!str && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str.trim());
        const validUserId = isValidUuid(effectiveLoggedInUserId) ? effectiveLoggedInUserId : (isValidUuid(effectiveUserId) ? effectiveUserId : null);

        // rate limiting - max 3 per 5 minutes
        let countQuery = supabaseAdmin
            .from('otp_codes')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', new Date(Date.now() - 5 * 60 * 1000).toISOString());

        if (validUserId && email) {
            countQuery = countQuery.or(`user_id.eq.${validUserId},email.eq.${email}`);
        } else if (validUserId) {
            countQuery = countQuery.eq('user_id', validUserId);
        } else {
            countQuery = countQuery.eq('email', email);
        }

        const { count, error: countError } = await countQuery;

        if (countError) {
            console.error('Rate limit check error:', countError);
        }

        if (count && count >= 3) {
            return NextResponse.json(
                { message: 'Too many OTP requests. Please wait 5 minutes.' },
                { status: 429 }
            );
        }

        // generate otp (valid for 5 minutes)
        const otp = generateOTP();
        const hashedOTP = hashOTP(otp);
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

        // execute database insert and email dispatch concurrently in parallel
        const [insertResult, emailResult] = await Promise.all([
            supabaseAdmin
                .from('otp_codes')
                .insert({
                    user_id: validUserId,
                    code_hash: hashedOTP,
                    expires_at: expiresAt.toISOString(),
                    attempts: 0,
                    email: email,
                    employee_name: employeeName || 'Unknown',
                }),
            sendOTPEmail({
                to: email,
                otp: otp,
                userName: employeeName || 'HR Employee',
            }).then(() => ({ success: true, error: null })).catch((err) => ({ success: false, error: err?.message || 'Failed to send email' }))
        ]);

        if (insertResult.error) {
            console.error('OTP insert error:', insertResult.error);
            return NextResponse.json(
                { message: 'Failed to generate OTP: ' + insertResult.error.message },
                { status: 500 }
            );
        }

        if (!emailResult.success) {
            console.error('Email sending failed:', emailResult.error);
            return NextResponse.json(
                { message: 'Failed to send OTP email. Please check your email address or contact support.' },
                { status: 500 }
            );
        }

        return NextResponse.json({
            message: 'OTP sent successfully to your email',
            expiresAt: expiresAt.toISOString(),
        });
    } catch (error) {
        console.error('Error requesting OTP:', error);
        return NextResponse.json(
            { message: 'Failed to send OTP. Please try again.' },
            { status: 500 }
        );
    }
}