import { auth } from '@/auth'
import { signOut } from '@/auth'

export default async function DashboardPage() {
  const session = await auth()

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold tracking-tight text-gray-900">Clínica Agenda</h1>
      <p className="text-lg text-gray-500">hello dashboard</p>
      <p className="text-sm text-gray-400">
        Logado como <span className="font-medium text-gray-600">{session?.user?.email}</span>
      </p>
      <form
        action={async () => {
          'use server'
          await signOut({ redirectTo: '/login' })
        }}
      >
        <button
          type="submit"
          className="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
        >
          Sair
        </button>
      </form>
    </main>
  )
}
