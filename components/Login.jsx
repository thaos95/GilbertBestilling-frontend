"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

export default function Login() {
    const searchParams = useSearchParams();
    const callbackUrl = searchParams.get("callbackUrl") || "/";

    const handleSignIn = () => {
        signIn("azure-ad", { callbackUrl });
    };

    return (
        <>
            <div className="text-center">
                <h1 className="text-2xl font-bold text-white mb-6">
                    Sign in with Azure AD
                </h1>
                <button
                    onClick={handleSignIn}
                    className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-3 px-6 rounded-lg transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-opacity-50"
                >
                    Sign In
                </button>
            </div>
        </>
    );
}