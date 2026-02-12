/**
 * Shared NextAuth configuration
 * 
 * This module exports authOptions for use throughout the application.
 * Import this wherever you need getServerSession() or NextAuth configuration.
 */

import type { NextAuthOptions } from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";

export const authOptions: NextAuthOptions = {
    providers: [
        AzureADProvider({
            clientId: process.env.AZURE_AD_CLIENT_ID!,
            clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
            tenantId: process.env.AZURE_AD_TENANT_ID!,
            authorization: {
                params: {
                    // Dev-only: forces login each time (bypasses SSO)
                    //...(process.env.NODE_ENV === "development" ? { } : {prompt: "login"}),
                },
            },
        }),
    ],
    session: { strategy: "jwt" },
    callbacks: {
        async redirect({ url, baseUrl }) {
            // Allow relative URLs
            if (url.startsWith("/")) return `${baseUrl}${url}`;
            // Allow URLs on the same origin
            if (new URL(url).origin === baseUrl) return url;
            return baseUrl;
        },
        async jwt({ token, account }) {
            // Persist the user's email in the token
            if (account) {
                token.email = token.email;
            }
            return token;
        },
        async session({ session, token }) {
            // Include email in session for admin checks
            if (session.user && token.email) {
                session.user.email = token.email as string;
            }
            return session;
        },
    },
    pages: {
        signIn: "/login",
    },
    secret: process.env.NEXTAUTH_SECRET,
};