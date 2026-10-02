import { NextResponse } from 'next/server';
import { requestLoginAuthorization } from '../../../lib/services/userAccessService';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { email, userId, displayName, role, message } = body;

        if (!email) {
            return NextResponse.json(
                { success: false, message: 'Email is required to request login authorization.' },
                { status: 400 }
            );
        }

        const result = await requestLoginAuthorization({
            email,
            userId,
            displayName,
            role,
            message,
        });

        if (!result.success) {
            return NextResponse.json(
                { success: false, message: result.message },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            message: result.message,
        });
    } catch (err: any) {
        console.error('Error in request-login-authorization route:', err);
        return NextResponse.json(
            { success: false, message: err?.message || 'Internal server error.' },
            { status: 500 }
        );
    }
}
