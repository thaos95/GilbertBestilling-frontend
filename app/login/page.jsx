"use client";

import { Suspense } from "react";
import Login from "@/components/Login";
import Image from "next/image";

function LoginContent() {
    return (
        <div className="min-h-dvh flex flex-col items-center justify-center">
            <div className="absolute inset-0 bg-black opacity-20"></div>
            <div className="relative z-10 w-full max-w-md px-6 py-12 bg-white bg-opacity-10 backdrop-filter backdrop-blur-sm rounded-lg shadow-xl">
                <div className="w-full flex justify-center mb-8">
                    <Image
                        src="/images/Logo_White.png"
                        alt="Logo"
                        width={200}
                        height={100}
                        className="max-w-sm w-1/2"
                    />
                </div>

                <Login />
            </div>
            <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-black to-transparent opacity-75"></div>
        </div>
    );
}

export default function LoginPage() {
    return (
        <Suspense fallback={
            <div className="min-h-dvh flex items-center justify-center">
                <div className="text-white">Loading...</div>
            </div>
        }>
            <LoginContent />
        </Suspense>
    );
}