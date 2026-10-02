import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

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

export async function GET(request: Request) {
    try {
        let sessionToken = request.headers.get('x-session-token');

        // Fallback to query params or cookies if header is missing
        if (!sessionToken) {
            const { searchParams } = new URL(request.url);
            sessionToken = searchParams.get('session_token') || searchParams.get('token');
        }

        if (!sessionToken) {
            const cookieHeader = request.headers.get('cookie') || '';
            const match = cookieHeader.match(/(?:session_token|sc_session_token)=([^;]+)/);
            if (match && match[1]) {
                sessionToken = decodeURIComponent(match[1].trim());
            }
        }

        if (!sessionToken) {
            return NextResponse.json(
                { valid: false, message: 'No session token' },
                { status: 401 }
            );
        }

        const { data: session, error } = await supabaseAdmin
            .from('sessions')
            .select('*')
            .eq('session_token', sessionToken)
            .maybeSingle();

        if (error || !session) {
            return NextResponse.json(
                { valid: false, message: 'Invalid or non-existent session' },
                { status: 401 }
            );
        }

        if (!session.is_active) {
            return NextResponse.json(
                { valid: false, message: 'Session is inactive or terminated', session_cleared: true },
                { status: 401 }
            );
        }

        // check expiration for timed sessions
        const expiryDate = session.expires_at_remember || session.expires_at;
        if (expiryDate) {
            const expiresAt = new Date(expiryDate);
            if (expiresAt < new Date()) {
                await supabaseAdmin
                    .from('sessions')
                    .update({ is_active: false })
                    .eq('id', session.id);

                return NextResponse.json(
                    { valid: false, message: 'Session expired' },
                    { status: 401 }
                );
            }
        }

        // Resolve user information
        let userId = session.user_id;
        let userRole = 'Employee';
        let userDisplayName = session.hr_employee_name || '';
        let userEmail = session.email || '';
        let userDepartment = '';

        if (userId) {
            const { data: userData } = await supabaseAdmin
                .from('users')
                .select('*')
                .eq('id', userId)
                .maybeSingle();

            if (userData) {
                userRole = userData.role || userRole;
                userDisplayName = userData.display_name || userData.name || userDisplayName;
                userEmail = userData.email || userEmail;
                userDepartment = userData.department || '';
            }
        }

        if (!userId || userRole === 'Employee') {
            const { data: hrData } = await supabaseAdmin
                .from('mock_employees')
                .select('*')
                .eq('email', session.email)
                .maybeSingle();

            if (hrData) {
                const rawRole = (hrData.role || hrData.position || '').trim();
                if (/admin/i.test(rawRole)) userRole = 'Admin';
                else if (/manager|office-in-charge|project coordinator/i.test(rawRole)) userRole = 'Manager';
                else if (/operator|appraiser/i.test(rawRole)) userRole = 'Operator';
                else if (/executive/i.test(rawRole)) userRole = 'Executive';
                else userRole = hrData.role || userRole;

                userDisplayName = userDisplayName || hrData.name || hrData.full_name || '';
                userDepartment = userDepartment || hrData.department || '';
            } else {
                const { data: supData } = await supabaseAdmin
                    .from('suppliers_account')
                    .select('*')
                    .eq('email', session.email)
                    .maybeSingle();

                if (supData) {
                    userRole = 'Supplier';
                    userDisplayName = userDisplayName || supData.supplier_name || supData.contact_person || '';
                }
            }
        }

        // calculate remaining time
        let remainingHours = 0;
        let remainingMinutes = 0;
        if (session.expires_at) {
            const remainingMs = Math.max(0, new Date(session.expires_at).getTime() - new Date().getTime());
            remainingHours = Math.floor(remainingMs / 3600000);
            remainingMinutes = Math.floor((remainingMs % 3600000) / 60000);
        }

        return NextResponse.json({
            valid: true,
            remember_me: session.remember_me || false,
            expires_at: session.expires_at,
            remaining: {
                hours: remainingHours,
                minutes: remainingMinutes,
            },
            session: {
                id: session.id,
                email: session.email,
                hr_employee_name: session.hr_employee_name,
                allowed_time_start: session.allowed_time_start || '07:00',
                allowed_time_end: session.allowed_time_end || '17:00',
                allowed_days: session.allowed_days || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
                is_allow: session.is_allow !== null && session.is_allow !== undefined ? Boolean(session.is_allow) : true,
            },
            user: {
                id: userId,
                display_name: userDisplayName,
                email: userEmail,
                role: userRole,
                department: userDepartment,
                allowed_time_start: session.allowed_time_start || '07:00',
                allowed_time_end: session.allowed_time_end || '17:00',
                allowed_days: session.allowed_days || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
                is_allow: session.is_allow !== null && session.is_allow !== undefined ? Boolean(session.is_allow) : true,
            }
        });
    } catch (error) {
        console.error('Session validation error:', error);
        return NextResponse.json(
            { valid: false, message: 'Session validation failed' },
            { status: 500 }
        );
    }
}