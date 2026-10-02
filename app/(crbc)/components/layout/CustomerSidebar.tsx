"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
    LayoutDashboard,
    Package,
    PlusCircle,
    FileText,
    Bell,
    User,
    Settings,
    LogOut,
    Sun,
    Moon,
    ChevronDown,
    Menu,
    X,
} from "lucide-react"
import { useState } from "react"
import { logout } from "../../actions/auth"
import { useTheme } from "@/app/components/ThemeProvider"
import type { Customers as Customer } from "../../types/customer"
import type { User as AuthUser } from "@supabase/supabase-js"
import Image from "next/image"
import AirshipExpressLogo from "../../../../public/images/airship.png"

const nav = [
    { href: "/customer/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/customer/shipments", label: "My Shipments", icon: Package },
    { href: "/customer/shipments/new", label: "Request Shipment", icon: PlusCircle },
    { href: "/customer/documents", label: "Documents", icon: FileText },
    { href: "/customer/notifications", label: "Notifications", icon: Bell },
]

type CustomerNavbarProps = {
    /**
     * The CRM/sender master record. Null for an online customer who has not
     * submitted a shipment request yet. Name and email fall back to the
     * authenticated user in that case.
     */
    customer: Customer | null
    user?: AuthUser | null
}

export default function CustomerNavbar({ customer, user }: CustomerNavbarProps) {
    const pathname = usePathname()
    const { theme, toggleTheme } = useTheme()
    const [menuOpen, setMenuOpen] = useState(false)
    const [drawerOpen, setDrawerOpen] = useState(false)

    // Display identity: prefer the CRM record, fall back to auth/profile data.
    const displayName = customer?.full_name ?? user?.user_metadata?.full_name ?? user?.email ?? "Customer"
    const displayEmail = customer?.email ?? customer?.customer_id ?? user?.email ?? ""

    return (
        <>
            <header className="fixed top-0 left-0 right-0 z-40 h-14 bg-background border-b border-line flex items-center px-4 gap-4">
                {/* Brand */}
                <Image src={AirshipExpressLogo} alt="Logo" width={36} height={36} className="shrink-0 w-auto" />
             

                {/* Nav links — desktop */}
                <nav className="hidden md:flex items-center justify-center gap-0.5 flex-1">
                    {nav.map(({ href, label, icon: Icon }) => {
                        const isActive = pathname === href
                        return (
                            <Link
                                key={href}
                                href={href}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] transition-colors ${
                                    isActive
                                        ? "bg-accent/10 text-accent font-medium"
                                        : "text-muted hover:text-foreground hover:bg-line/50"
                                }`}
                            >
                                <Icon size={14} className="shrink-0" />
                                {label}
                            </Link>
                        )
                    })}
                </nav>

                {/* Right side */}
                <div className="ml-auto flex items-center gap-1">
                    {/* Theme toggle */}
                    <button
                        onClick={toggleTheme}
                        aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                        className="p-2 rounded-md text-muted hover:text-foreground hover:bg-line/50 transition-colors cursor-pointer"
                    >
                        {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
                    </button>

                    {/* User menu — desktop */}
                    <div className="relative hidden md:block">
                        <button
                            onClick={() => setMenuOpen((o) => !o)}
                            className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] text-muted hover:text-foreground hover:bg-line/50 transition-colors cursor-pointer"
                        >
                            <User size={14} className="shrink-0" />
                            <span className="hidden sm:block max-w-30 truncate text-foreground font-medium">
                                {displayName}
                            </span>
                            <ChevronDown size={13} className={`transition-transform ${menuOpen ? "rotate-180" : ""}`} />
                        </button>

                        {menuOpen && (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                                <div className="absolute right-0 top-full mt-1.5 z-50 w-44 rounded-xl border border-line bg-background shadow-lg py-1 overflow-hidden">
                                    <Link
                                        href="/customer/profile"
                                        onClick={() => setMenuOpen(false)}
                                        className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-muted hover:text-foreground hover:bg-line/50 transition-colors"
                                    >
                                        <User size={13} />
                                        My Profile
                                    </Link>
                                    <Link
                                        href="/customer/settings"
                                        onClick={() => setMenuOpen(false)}
                                        className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-muted hover:text-foreground hover:bg-line/50 transition-colors"
                                    >
                                        <Settings size={13} />
                                        Settings
                                    </Link>
                                    <div className="border-t border-line my-1" />
                                    <button
                                        onClick={() => logout()}
                                        className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-muted hover:text-foreground hover:bg-line/50 transition-colors w-full cursor-pointer"
                                    >
                                        <LogOut size={13} />
                                        Logout
                                    </button>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Hamburger — mobile only */}
                    <button
                        onClick={() => setDrawerOpen(true)}
                        aria-label="Open menu"
                        className="md:hidden p-2 rounded-md text-muted hover:text-foreground hover:bg-line/50 transition-colors cursor-pointer"
                    >
                        <Menu size={18} />
                    </button>
                </div>
            </header>

            {/* Mobile drawer */}
            {drawerOpen && (
                <>
                    <div
                        className="fixed inset-0 z-50 bg-black/40 md:hidden"
                        onClick={() => setDrawerOpen(false)}
                    />
                    <div className="fixed top-0 left-0 z-50 h-full w-72 bg-background border-r border-line flex flex-col md:hidden">
                        {/* Drawer header */}
                        <div className="flex items-center justify-between px-4 h-14 border-b border-line shrink-0">
                            <span className="font-bricolage font-semibold text-sm text-foreground">
                                Airship Xpress
                            </span>
                            <button
                                onClick={() => setDrawerOpen(false)}
                                aria-label="Close menu"
                                className="p-2 rounded-md text-muted hover:text-foreground hover:bg-line/50 transition-colors cursor-pointer"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        {/* User info */}
                        <div className="px-4 py-4 border-b border-line shrink-0">
                            <div className="flex items-center gap-3">
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                                    <User size={16} />
                                </span>
                                <div className="min-w-0">
                                    <p className="text-sm font-medium text-foreground truncate">{displayName}</p>
                                    <p className="text-xs text-muted truncate">{displayEmail}</p>
                                </div>
                            </div>
                        </div>

                        {/* Nav links */}
                        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
                            {nav.map(({ href, label, icon: Icon }) => {
                                const isActive = pathname === href
                                return (
                                    <Link
                                        key={href}
                                        href={href}
                                        onClick={() => setDrawerOpen(false)}
                                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                                            isActive
                                                ? "bg-accent/10 text-accent font-medium"
                                                : "text-muted hover:text-foreground hover:bg-line/50"
                                        }`}
                                    >
                                        <Icon size={16} className="shrink-0" />
                                        {label}
                                    </Link>
                                )
                            })}
                        </nav>

                        {/* Bottom actions */}
                        <div className="px-3 py-3 border-t border-line space-y-0.5 shrink-0">
                            <Link
                                href="/customer/profile"
                                onClick={() => setDrawerOpen(false)}
                                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted hover:text-foreground hover:bg-line/50 transition-colors"
                            >
                                <User size={16} />
                                My Profile
                            </Link>
                            <Link
                                href="/customer/profile"
                                onClick={() => setDrawerOpen(false)}
                                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted hover:text-foreground hover:bg-line/50 transition-colors"
                            >
                                <Settings size={16} />
                                Settings
                            </Link>
                            <button
                                onClick={() => logout()}
                                className="flex w-full items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted hover:text-foreground hover:bg-line/50 transition-colors cursor-pointer"
                            >
                                <LogOut size={16} />
                                Logout
                            </button>
                        </div>
                    </div>
                </>
            )}
        </>
    )
}
