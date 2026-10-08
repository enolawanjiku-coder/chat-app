export type Profile = {
  id: string
  username: string
  display_name: string | null
  avatar_url: string | null
  last_seen: string | null
  created_at: string
}

export type Conversation = {
  id: string
  type: 'direct' | 'group'
  name: string | null
  avatar_url: string | null
  created_by: string | null
  direct_key: string | null
  created_at: string
}

export type ConversationMember = {
  conversation_id: string
  user_id: string
  role: 'admin' | 'member'
  joined_at: string
  last_read_at: string
}

export type Message = {
  id: string
  conversation_id: string
  sender_id: string
  type: 'text' | 'image'
  body: string | null
  image_path: string | null
  reply_to: string | null
  created_at: string
  edited_at: string | null
  deleted_at: string | null
}
