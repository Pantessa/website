import ChatWorkspace from '@/components/ChatWorkspace'

export default async function ChatByIdPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <ChatWorkspace chatId={id} />
}
