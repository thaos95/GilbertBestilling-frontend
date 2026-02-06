import type { Metadata } from "next"
import "./globals.css"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Gilje Pipeline",
  description: "Document processing pipeline for architectural figure extraction",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50">
        <nav className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center space-x-8">
              <Link href="/" className="text-xl font-semibold text-gray-900">
                Gilje Pipeline
              </Link>
              <div className="flex space-x-6">
                <NavLink href="/dashboard">Dashboard</NavLink>
                <NavLink href="/runs">Runs</NavLink>
                <NavLink href="/settings">Settings</NavLink>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-500">
                {new Date().toLocaleDateString()}
              </span>
            </div>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-6 py-8">
          {children}
        </main>
      </body>
    </html>
  )
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-gray-600 hover:text-gray-900 font-medium transition-colors"
    >
      {children}
    </Link>
  )
}
