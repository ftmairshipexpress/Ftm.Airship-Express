"use client";

import { useState, useTransition } from "react";
import { Eye, EyeOff } from "lucide-react";

type AuthFormProps = {
    action: (formData: FormData) => Promise<{ error: string } | void>
    isRegister?: boolean;
}

export function AuthForm({ action, isRegister = false }: AuthFormProps) {
    const [name, setName] = useState("")
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition()

    const handleSubmit = async (formData: FormData) => {
        setError(null)
        startTransition(async () => {
            const result = await action(formData);
            if (result?.error) {
                setError(result.error)
            } else {
                setName("");
                setEmail("");
                setPassword("")
            }
        })
    }

    return (
        <form action={handleSubmit} className="w-full space-y-4">
            {error && (
                <div className="text-red-700 bg-red-50 border border-red-200 dark:text-red-400 dark:bg-red-950 dark:border-red-900 rounded-lg text-sm px-3 py-2.5">
                    {error}
                </div>
            )}

            {isRegister && (
                <div className="space-y-1.5">
                    <label htmlFor="name" className="text-xs font-medium text-muted tracking-wide block">
                        Name
                    </label>
                    <input
                        id="name" type="text" name="name" placeholder="Enter your name"
                        className="w-full text-sm bg-background border border-line text-foreground placeholder-muted/70 truncate transition-colors focus:border-accent focus:ring-4 focus:ring-accent/15 outline-none rounded-lg px-3 py-2.5"
                        required autoComplete="off"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                </div>
            )}

            <div className="space-y-1.5">
                <label htmlFor="email" className="text-xs font-medium text-muted tracking-wide block">
                    Email
                </label>
                <input
                    id="email" type="email" name="email" placeholder="Enter your email"
                    className="w-full text-sm bg-background border border-line text-foreground placeholder-muted/70 truncate transition-colors focus:border-accent focus:ring-4 focus:ring-accent/15 outline-none rounded-lg px-3 py-2.5"
                    required autoComplete="off"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                />
            </div>

            <div className="space-y-1.5">
                <label htmlFor="password" className="text-xs font-medium text-muted tracking-wide block">
                    Password
                </label>
                <div className="relative">
                    <input
                        id="password" type={showPassword ? "text" : "password"} name="password" placeholder="Enter your password"
                        className="w-full text-sm bg-background border border-line text-foreground placeholder-muted/70 transition-colors focus:border-accent focus:ring-4 focus:ring-accent/15 outline-none rounded-lg px-3 py-2.5 pr-10"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        tabIndex={-1}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                </div>
            </div>

            <button
                className="bg-accent text-primary-foreground p-2.5 rounded-lg cursor-pointer w-full text-sm font-medium tracking-wide transition-colors bg-primary hover:bg-foreground/90 focus:outline-none focus:ring-4 focus:ring-accent/20 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isPending}
            >
                {isPending ? "Loading…" : isRegister ? "Sign Up" : "Sign In"}
            </button>
        </form>
    )
}