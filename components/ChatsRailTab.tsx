'use client'

// The CHATS destination's body: New Chat first, then the history. Extracted
// from ChatRail (squad mobile-native, 2026-09-24) so the desktop drawer and
// the phone's chat list render ONE component. Chats are an account surface
// (connect to act, sign in to KEEP): a guest sees the sign-in door here.

import { useRouter } from 'next/navigation'
import { Globe, Loader2, MessageSquare, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useYeetfulStore } from '@/lib/store'
import { useSession } from '@/lib/session'
import { cdpEnabled } from '@/lib/cdp-embedded'
import CreateAccountButton from '@/components/CreateAccountButton'
import EmptyDoor from '@/components/guide/EmptyDoor'
import { CHATS_DOOR } from '@/lib/first-run'

export default function ChatsRailTab({
  /** The parent scrolls (the phone screen): lay the list out flat and keep
   *  the touch affordances visible. */
  flat,
  /** Called right before a row or New Chat navigates — the phone screen
   *  returns to the conversation on it. */
  onNavigate,
}: {
  flat?: boolean
  onNavigate?: () => void
}) {
  const router = useRouter()
  const { currentChatId, chats, chatsLoading, deleteChat } = useYeetfulStore()
  const { address, needsSignIn, signIn, signingIn } = useSession()

  const go = (href: string) => {
    onNavigate?.()
    router.push(href)
  }

  const handleDeleteChat = (id: string) => {
    deleteChat(id)
    if (currentChatId === id) go('/chat')
  }

  return (
    <>
      <div className={cn('px-3 pb-2', flat && 'pt-3')}>
        <button
          onClick={() => go('/chat')}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-2 min-h-[44px] md:min-h-0 rounded-xl bg-[var(--surf-2)] border border-[var(--line)] text-[color:var(--muted)] hover:text-white hover:border-[var(--line-2)] transition-all text-sm font-medium',
            flat && 'min-h-[48px] md:min-h-[48px] active:bg-[var(--surf-1)]',
          )}
        >
          <Plus className="w-4 h-4" />
          New Chat
        </button>
      </div>

      <div className={cn('px-2 pb-3 space-y-1', !flat && 'flex-1 overflow-y-auto')}>
        {chatsLoading && chats.length === 0 && (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-[color:var(--muted-2)]">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading chats…
          </div>
        )}

        {!chatsLoading && chats.length === 0 && (
          // THE EMPTY DOOR (squad pre-gtm): a guest used to meet one muted
          // sentence here and a stranger's first tap on CHATS was a wall.
          // The lesson (connect to act, sign in to KEEP) and ONE action that
          // works right now: the wallet's own sign-in when it is connected,
          // the unified door when nothing is (rule 6 — no redirectTo on a
          // working page), and a signed-in wallet's first chat.
          <div className="px-1 pt-1">
            <EmptyDoor
              id="chats"
              compact
              eyebrow={address ? 'Chats · none yet' : CHATS_DOOR.eyebrow}
              title={CHATS_DOOR.title}
              body={address && !needsSignIn ? CHATS_DOOR.bodySignedIn : CHATS_DOOR.body}
              lines={CHATS_DOOR.lines}
              primary={
                needsSignIn
                  ? { kind: 'button', label: signingIn ? 'Signing in…' : 'Sign in to keep them', onClick: () => void signIn(), disabled: signingIn }
                  : !address && cdpEnabled
                    ? { kind: 'node', node: <CreateAccountButton className="door__cta" label="Sign in to keep them" /> }
                    : { kind: 'button', label: 'Start a chat', onClick: () => go('/chat') }
              }
              secondary={!address || needsSignIn ? { kind: 'button', label: 'Start a chat first', onClick: () => go('/chat') } : undefined}
            />
          </div>
        )}

        {chats.map((chat) => (
          <div
            key={chat.id}
            className={cn(
              'group flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-all',
              flat && 'min-h-[48px] active:bg-[var(--surf-1)]',
              currentChatId === chat.id ? 'bg-[var(--surf-2)] text-white' : 'text-[color:var(--muted)] hover:text-white hover:bg-[var(--surf-1)]',
            )}
            onClick={() => go(`/chat/${chat.id}`)}
          >
            <MessageSquare className="w-3.5 h-3.5 flex-shrink-0" />
            <span className={cn('flex-1 truncate', flat ? 'text-[13px]' : 'text-xs')}>{chat.title}</span>
            {chat.isPublic && <Globe className="w-3 h-3 flex-shrink-0 text-emerald-400/80" aria-label="Shared publicly" />}
            <div className={cn('flex items-center gap-1 transition-opacity', flat ? 'opacity-70' : 'opacity-0 group-hover:opacity-100')}>
              {chat.activeServerIds.length > 0 && <span className="text-[10px] text-zinc-600">{chat.activeServerIds.length}</span>}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleDeleteChat(chat.id)
                }}
                className={cn('text-zinc-700 hover:text-red-400 transition-colors', flat ? 'grid w-10 h-10 place-items-center' : 'p-0.5')}
                aria-label="Delete chat"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
