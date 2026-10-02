import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAllUserAccessRules, saveUserAccessRule } from '../../../lib/services/userAccessService';

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

export async function GET() {
    try {
        const rules = await getAllUserAccessRules();
        return NextResponse.json({
            success: true,
            rules,
        });
    } catch (err: any) {
        console.error('Error in user-access-control GET route:', err);
        return NextResponse.json(
            { success: false, message: err?.message || 'Failed to fetch access rules.' },
            { status: 500 }
        );
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { rule, rules, updatedBy = 'Admin' } = body;

        // Extract caller session token to verify caller role
        const cookiesHeader = request.headers.get('cookie') || '';
        const cookieToken = cookiesHeader
            .split(';')
            .map(c => c.trim())
            .find(c => c.startsWith('sc_session_token=') || c.startsWith('session_token='))
            ?.split('=')[1];

        const callerSessionToken = request.headers.get('x-session-token') || cookieToken;
        let callerRole = 'admin';

        if (callerSessionToken) {
            const { data: callerSession } = await supabaseAdmin
                .from('sessions')
                .select(`
                    id,
                    user_id,
                    is_active,
                    users!inner (
                        role
                    )
                `)
                .eq('session_token', callerSessionToken)
                .eq('is_active', true)
                .maybeSingle();

            if (callerSession?.users) {
                callerRole = ((callerSession.users as any)?.role || '').toLowerCase().trim();
            }
        }

        // Support bulk rule updates
        if (Array.isArray(rules) && rules.length > 0) {
            for (const r of rules) {
                if (r && r.email) {
                    const targetRole = (r.role || '').toLowerCase().trim();
                    if (targetRole === 'executive') {
                        continue; // Cannot modify Executive
                    }
                    if (targetRole === 'admin' && callerRole !== 'executive') {
                        continue; // Only Executive can modify Admin
                    }
                    await saveUserAccessRule(r, updatedBy);
                }
            }
            const allRules = await getAllUserAccessRules();
            return NextResponse.json({
                success: true,
                message: `Successfully updated user access rules.`,
                rules: allRules,
            });
        }

        if (!rule || !rule.email) {
            return NextResponse.json(
                { success: false, message: 'Valid rule with email is required.' },
                { status: 400 }
            );
        }

        const targetRole = (rule.role || '').toLowerCase().trim();
        if (targetRole === 'executive') {
            return NextResponse.json(
                { success: false, message: 'Executive accounts are protected and cannot be modified.' },
                { status: 403 }
            );
        }

        if (targetRole === 'admin' && callerRole !== 'executive') {
            return NextResponse.json(
                { success: false, message: 'Only Executive accounts can allow or disallow Administrator access.' },
                { status: 403 }
            );
        }

        const success = await saveUserAccessRule(rule, updatedBy);

        if (!success) {
            return NextResponse.json(
                { success: false, message: 'Failed to update access rule.' },
                { status: 500 }
            );
        }

        const allRules = await getAllUserAccessRules();
        return NextResponse.json({
            success: true,
            message: 'User access rule updated successfully.',
            rules: allRules,
        });
    } catch (err: any) {
        console.error('Error in user-access-control POST route:', err);
        return NextResponse.json(
            { success: false, message: err?.message || 'Failed to update access rule.' },
            { status: 500 }
        );
    }
}
