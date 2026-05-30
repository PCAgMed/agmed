import Link from 'next/link'

export default function VerifyEmailPage() {
  return (
    <div className="space-y-4 rounded-md border border-yellow-200 bg-yellow-50 p-6 text-center">
      <p className="font-medium text-yellow-800">Verifique seu e-mail</p>
      <p className="text-sm text-yellow-700">
        Em produção, você receberia um link de confirmação por e-mail. O envio de e-mails será
        configurado em uma próxima tarefa.
      </p>
      <p className="text-sm text-yellow-700">
        Por ora, você já pode{' '}
        <Link href="/login" className="font-medium underline">
          fazer login
        </Link>{' '}
        diretamente.
      </p>
    </div>
  )
}
