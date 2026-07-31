import { redirect } from 'next/navigation'

import { CHAT_ROUTE_DESTINATION } from '@/const/chat-route'

export default function ChatPage(): never {
  redirect(CHAT_ROUTE_DESTINATION)
}
