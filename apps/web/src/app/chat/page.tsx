import { redirect } from 'next/navigation'

import { CHAT_ROUTE_DESTINATION } from './chat-route'

export default function ChatPage(): never {
  redirect(CHAT_ROUTE_DESTINATION)
}
